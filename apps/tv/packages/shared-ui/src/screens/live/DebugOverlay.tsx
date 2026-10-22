import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Txt } from '../../components/ui/Txt';
import type { Telemetry } from '../../hooks/useSessionStream';
import type { BufferStats, FrameBuffer } from '../../lib/frameBuffer';
import type { RenderStats } from './SkeletonStage';
import { color, s } from '../../theme';

interface Props {
  buffer: FrameBuffer;
  telemetry: React.MutableRefObject<Telemetry>;
  renderStats: React.MutableRefObject<RenderStats>;
  connection: string;
  sessionId: string;
}

interface Snapshot {
  renderFps: number;
  /** Mean / max time of one drawing tick over the last refresh window. */
  tick: string;
  zoom: string;
  inFps: number;
  latency: string;
  buffer: BufferStats;
  sinceBatch: string;
  invalid: number;
}

const REFRESH_MS = 500;

/** Toggled with the remote's Menu/Info key (or "D" on web). Shows what the skeleton is being fed. */
export function DebugOverlay({ buffer, telemetry, renderStats, connection, sessionId }: Props) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const last = useRef({ at: Date.now(), renders: 0, received: 0, tickSum: 0 });

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const stats = buffer.stats();
      const dt = Math.max(1, now - last.current.at) / 1000;
      const t = telemetry.current;
      const r = renderStats.current;
      const ticks = r.renders - last.current.renders;
      const tick = ticks > 0 ? `${((r.tickMs.sum - last.current.tickSum) / ticks).toFixed(1)} avg / ${r.tickMs.max.toFixed(1)} max ms` : 'n/a';
      r.tickMs.max = 0; // the max is per refresh window
      setSnap({
        renderFps: Math.round(ticks / dt),
        tick,
        zoom: `${r.zoom.toFixed(2)}x`,
        inFps: Math.round((stats.received - last.current.received) / dt),
        latency:
          t.receiveLatencyMs === null
            ? 'n/a (t is not epoch ms)'
            : `${Math.round(t.receiveLatencyMs)} ms${t.receiveLatencyMs < 0 ? ' (clock skew)' : ''}`,
        buffer: stats,
        sinceBatch: t.lastPoseAt === 0 ? 'never' : `${Math.round(now - t.lastPoseAt)} ms ago`,
        invalid: t.invalidMessages,
      });
      last.current = { at: now, renders: r.renders, received: stats.received, tickSum: r.tickMs.sum };
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [buffer, telemetry, renderStats]);

  const rows: [string, string][] = snap
    ? [
        ['Draw', `${snap.renderFps} fps`],
        ['Tick', snap.tick],
        ['Zoom', snap.zoom],
        ['Frames in', `${snap.inFps} fps`],
        ['Receive latency', snap.latency],
        ['Playout delay', `${snap.buffer.playoutDelayMs} ms`],
        ['Buffered / starved', `${snap.buffer.frames} / ${snap.buffer.starvedSamples}`],
        ['Last batch', snap.sinceBatch],
        ['Socket', connection],
        ['Bad messages', String(snap.invalid)],
        ['Session', sessionId.slice(0, 8)],
      ]
    : [['Debug', 'warming up...']];

  return (
    <View style={[styles.panel, { minWidth: s(460), top: s(54), left: s(800), padding: s(16), borderRadius: s(16), borderWidth: s(2), borderColor: color.line }]} pointerEvents="none">
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Txt variant="label" upper={false} style={{ textTransform: 'none' }} color={color.textMuted}>
            {k}
          </Txt>
          <Txt variant="label" upper={false} style={{ textTransform: 'none' }}>
            {v}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { position: 'absolute', backgroundColor: '#120D16', zIndex: 40 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 24 },
});
