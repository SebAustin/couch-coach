import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SpatialNavigationNode, SpatialNavigationRoot, type SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import RemoteControlManager from '../../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../../app/remote-control/SupportedKeys';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { FocusVisibilityContext } from '../../components/ui/FocusVisibility';
import { LampGlow } from '../../components/ui/LampGlow';
import { Txt } from '../../components/ui/Txt';
import { useNow } from '../../hooks/useNow';
import type { SessionStream } from '../../hooks/useSessionStream';
import { deriveConnection } from '../../lib/connection';
import { setRecapLine, runningScore } from '../../lib/liveState';
import { fitContain } from '../../lib/skeletonPaths';
import { useBackHandler } from '../../navigation/backStack';
import { color, radius, s, safe } from '../../theme';
import type { Member } from '../../vendor/protocol';
import { ConnectionPill } from './ConnectionPill';
import { CueCard } from './CueCard';
import { DebugOverlay } from './DebugOverlay';
import { HudPanel, HUD_WIDTH } from './HudPanel';
import { SkeletonStage, type FaultFlash, type RenderStats } from './SkeletonStage';

const STAGE_WIDTH = 1344;
const STAGE_REGION = { x: 96, y: 54, width: 1200, height: 972 } as const;
const TICK_MS = 500;

interface Props {
  member: Member;
  sessionId: string;
  stream: SessionStream;
  /** The Session is over (TV or phone ended it): go to the Recap. */
  onEnded: () => void;
  /** Abandon this pairing and show a fresh code. */
  onNewCode: () => void;
}

/** Live: skeleton stage on the left, HUD on the right, Coach card over the stage, status + debug overlays. */
export function LiveScreen({ member, sessionId, stream, onEnded, onNewCode }: Props) {
  const { state, connection, buffer, telemetry, dismissCue, endSession } = stream;
  const now = useNow(TICK_MS);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [debug, setDebug] = useState(false);
  const [noPose, setNoPose] = useState(false);
  const [focusShown, setFocusShown] = useState(false);
  const focusShownRef = useRef(false);
  const ending = useRef(false);
  const renderStats = useRef<RenderStats>({ renders: 0 });
  const replayRef = useRef<SpatialNavigationNodeRef>(null);
  const endRef = useRef<SpatialNavigationNodeRef>(null);
  const downSince = useRef<number | null>(null);

  const cueVisible = state.coach.status !== 'none';
  const score = runningScore(state);

  // --- connection health ------------------------------------------------------------------
  if (connection.state === 'connected') downSince.current = null;
  else if (downSince.current === null) downSince.current = Date.now();
  const link = deriveConnection({
    socket: connection.state,
    socketDownMs: downSince.current === null ? 0 : now - downSince.current,
    hasPhone: state.hasPhone,
    paused: state.paused,
    msSincePose: telemetry.current.lastPoseAt === 0 ? null : now - telemetry.current.lastPoseAt,
  });
  const quiet = link.card !== 'none';

  // --- ending the Session -----------------------------------------------------------------
  const finish = useCallback(() => {
    if (ending.current) return;
    ending.current = true;
    onEnded();
  }, [onEnded]);

  const endFromTv = useCallback(async () => {
    if (ending.current) return;
    setConfirmOpen(false);
    await endSession();
    finish();
  }, [endSession, finish]);

  useEffect(() => {
    if (state.endRequested) finish(); // the phone ended it
  }, [state.endRequested, finish]);

  // --- Back, Menu/Info, and first-press focus reveal --------------------------------------
  useBackHandler(() => {
    if (cueVisible) dismissCue();
    else setConfirmOpen(true);
  });

  const focusTarget = useCallback(() => {
    (cueVisible ? replayRef.current : endRef.current)?.focus();
  }, [cueVisible]);

  useEffect(() => {
    const listener = (key: SupportedKeys) => {
      if (key === SupportedKeys.Debug) {
        setDebug((v) => !v);
        return;
      }
      if (key === SupportedKeys.Back || focusShownRef.current) return;
      focusShownRef.current = true;
      setFocusShown(true);
      setTimeout(focusTarget, 0); // the press also moved focus; put it back on the intended control
    };
    RemoteControlManager.addKeydownListener(listener);
    return () => RemoteControlManager.removeKeydownListener(listener);
  }, [focusTarget]);

  // A new Cue (or its dismissal) resets the "first press reveals focus" behaviour and parks focus sensibly.
  useEffect(() => {
    focusShownRef.current = false;
    setFocusShown(false);
    focusTarget();
  }, [cueVisible, focusTarget]);

  const guarded = useCallback(
    (fn: () => void) => () => {
      if (focusShownRef.current) fn();
    },
    [],
  );

  // --- skeleton geometry --------------------------------------------------------------------
  const box = useMemo(() => {
    const fit = fitContain(state.aspect, STAGE_REGION.width, STAGE_REGION.height);
    return {
      width: s(fit.width),
      height: s(fit.height),
      left: s(STAGE_REGION.x + (STAGE_REGION.width - fit.width) / 2),
      top: s(STAGE_REGION.y + (STAGE_REGION.height - fit.height) / 2),
    };
  }, [state.aspect]);

  const fault: FaultFlash | null = useMemo(
    () => (state.lastRep && state.lastRep.faults.length > 0 ? { seq: state.repSeq, ids: state.lastRep.faults } : null),
    [state.lastRep, state.repSeq],
  );

  const lastSet = state.sets.length > 0 ? state.sets[state.sets.length - 1] : undefined;
  const readyHint = !state.inSet && state.sets.length === 0 && state.reps === 0 && link.card === 'none' && !cueVisible;
  const pillLevel = link.level;
  const handleNoPose = useCallback((value: boolean) => setNoPose(value), []);

  return (
    <FocusVisibilityContext.Provider value={focusShown}>
      <View style={styles.root}>
        <View style={[styles.stage, { width: s(STAGE_WIDTH) }]}>
          <LampGlow />
        </View>

        <View style={{ position: 'absolute', ...box }}>
          <SkeletonStage
            buffer={buffer}
            width={box.width}
            height={box.height}
            fault={fault}
            dimmed={cueVisible || quiet}
            onNoPoseChange={handleNoPose}
            stats={renderStats}
          />
        </View>

        <View style={{ position: 'absolute', top: s(safe.y), left: s(safe.x) }}>
          <ConnectionPill level={pillLevel} />
        </View>

        {readyHint && <CenterPill text="Ready when you are. Pick an Exercise on your phone." />}
        {noPose && !quiet && !readyHint && (
          <CenterPill text="We can't see you. Step back so your whole body is in the frame." />
        )}

        <SpatialNavigationRoot isActive={!confirmOpen}>
          <SpatialNavigationNode orientation="horizontal">
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {quiet && (
                <LostCard
                  service={link.card === 'service_lost'}
                  showActions={link.showRecoveryActions}
                  onNewCode={guarded(onNewCode)}
                  onEnd={guarded(() => setConfirmOpen(true))}
                />
              )}
              {cueVisible && state.coach.status !== 'none' && (
                <View style={[styles.cueSlot, { left: s(safe.x), bottom: s(safe.y), width: s(STAGE_REGION.width) }]}>
                  <CueCard
                    coach={state.coach}
                    recapLine={setRecapLine(lastSet)}
                    onDismiss={guarded(dismissCue)}
                    replayRef={replayRef}
                  />
                </View>
              )}
              <View style={[styles.hud, { right: s(96), top: s(safe.y), height: s(972) }]}>
                <HudPanel
                  memberName={member.name}
                  state={state}
                  score={score}
                  onEndSession={guarded(() => setConfirmOpen(true))}
                  endRef={endRef}
                />
              </View>
            </View>
          </SpatialNavigationNode>
        </SpatialNavigationRoot>

        {debug && (
          <DebugOverlay
            buffer={buffer}
            telemetry={telemetry}
            renderStats={renderStats}
            connection={connection.state}
            sessionId={sessionId}
          />
        )}

        {confirmOpen && (
          <ConfirmDialog
            title="End this Session?"
            body="Your Sets are saved. You'll see a Recap next."
            keepLabel="Keep going"
            confirmLabel="End session"
            onKeep={() => setConfirmOpen(false)}
            onConfirm={endFromTv}
          />
        )}
      </View>
    </FocusVisibilityContext.Provider>
  );
}

function CenterPill({ text }: { text: string }) {
  return (
    <View style={[styles.center, { left: 0, width: s(STAGE_WIDTH) }]} pointerEvents="none">
      <View style={{ backgroundColor: color.overlay, borderRadius: s(radius.pill), paddingHorizontal: s(40), paddingVertical: s(20), maxWidth: s(1000) }}>
        <Txt variant="bodyBold" align="center" accessibilityLiveRegion="polite">
          {text}
        </Txt>
      </View>
    </View>
  );
}

function LostCard({
  service,
  showActions,
  onNewCode,
  onEnd,
}: {
  service: boolean;
  showActions: boolean;
  onNewCode: () => void;
  onEnd: () => void;
}) {
  return (
    <View style={[styles.center, { left: 0, width: s(STAGE_WIDTH) }]} pointerEvents="box-none">
      <View style={{ backgroundColor: color.overlay, borderRadius: s(radius.card), padding: s(48), width: s(900) }} accessibilityLiveRegion="polite">
        <Txt variant="h1">{service ? 'Lost connection to Couch Coach.' : 'Lost your phone'}</Txt>
        <Txt variant="bodyL" color={color.textDim} style={{ marginTop: s(12) }}>
          {service ? "Check that the TV is online. We'll keep trying." : 'Keep your phone on and in the app. Reconnecting...'}
        </Txt>
        {showActions && (
          <SpatialNavigationNode orientation="horizontal">
            <View style={{ flexDirection: 'row', gap: s(32), marginTop: s(32), padding: s(12) }}>
              <Button label="New code" onSelect={onNewCode} />
              <Button label="End session" variant="secondary" onSelect={onEnd} />
            </View>
          </SpatialNavigationNode>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  stage: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: color.stage },
  hud: { position: 'absolute' },
  cueSlot: { position: 'absolute' },
  center: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});

export { HUD_WIDTH };
