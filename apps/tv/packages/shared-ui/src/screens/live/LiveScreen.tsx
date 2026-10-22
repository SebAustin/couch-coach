import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { SpatialNavigationNode, SpatialNavigationRoot, type SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import RemoteControlManager from '../../app/remote-control/RemoteControlManager';
import { SupportedKeys } from '../../app/remote-control/SupportedKeys';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { FocusVisibilityContext } from '../../components/ui/FocusVisibility';
import { LampGlow } from '../../components/ui/LampGlow';
import { Txt } from '../../components/ui/Txt';
import { useFadeIn } from '../../hooks/useFadeIn';
import { useNow } from '../../hooks/useNow';
import { useRetainedValue } from '../../hooks/useRetainedValue';
import type { SessionStream } from '../../hooks/useSessionStream';
import { deriveConnection, reconnectTick } from '../../lib/connection';
import { setRecapLine, runningScore } from '../../lib/liveState';
import { useBackHandler } from '../../navigation/backStack';
import { color, motion, radius, s, safe } from '../../theme';
import type { Member } from '../../vendor/protocol';
import { ConnectionPill } from './ConnectionPill';
import { CueCard } from './CueCard';
import { DebugOverlay } from './DebugOverlay';
import { HudPanel, HUD_WIDTH } from './HudPanel';
import { SKELETON_VIEWPORT, STAGE_REGION, STAGE_WIDTH } from './layout';
import { newRenderStats, SkeletonStage, type CleanFlash, type FaultFlash, type RenderStats } from './SkeletonStage';

const TICK_MS = 500;
/** The Cue card stays mounted this long after it is dismissed so its exit animation can play. */
const CUE_EXIT_HOLD_MS = motion.exit + 40;

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
  const { state, connection, buffer, telemetry, dismissCue, endSession, reconnect } = stream;
  const now = useNow(TICK_MS);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [debug, setDebug] = useState(false);
  const [noPose, setNoPose] = useState(false);
  const [focusShown, setFocusShown] = useState(false);
  const focusShownRef = useRef(false);
  const ending = useRef(false);
  const renderStats = useRef<RenderStats>(newRenderStats());
  const replayRef = useRef<SpatialNavigationNodeRef>(null);
  const endRef = useRef<SpatialNavigationNodeRef>(null);
  const downSince = useRef<number | null>(null);

  const cueVisible = state.coach.status !== 'none';
  const cue = useRetainedValue(state.coach.status !== 'none' ? state.coach : null, CUE_EXIT_HOLD_MS);
  const fade = useFadeIn();
  const score = runningScore(state);

  // --- connection health ------------------------------------------------------------------
  if (connection.state === 'connected') downSince.current = null;
  else if (downSince.current === null) downSince.current = Date.now();
  const link = deriveConnection({
    socket: connection.state,
    socketDownMs: downSince.current === null ? 0 : now - downSince.current,
    hasPhone: state.hasPhone,
    paused: state.paused,
    msSinceSignal: telemetry.current.lastSignalAt === 0 ? null : now - telemetry.current.lastSignalAt,
  });
  const msSinceSignal = telemetry.current.lastSignalAt === 0 ? null : now - telemetry.current.lastSignalAt;
  const quiet = link.card !== 'none';

  // --- ending the Session -----------------------------------------------------------------
  const finish = useCallback(() => {
    if (ending.current) return;
    ending.current = true;
    onEnded();
  }, [onEnded]);

  const endFromTv = useCallback(() => {
    if (ending.current) return;
    setConfirmOpen(false);
    // Publish in the background: the Recap shows at once and the stream stays open until the publish settles.
    void endSession();
    finish();
  }, [endSession, finish]);

  useEffect(() => {
    if (state.endRequested) finish(); // the phone ended it
  }, [state.endRequested, finish]);

  // A phone that stays silent may mean our own socket is half-dead: re-establish it every 10 s while lost.
  const reconnectCount = reconnectTick(link.card, msSinceSignal);
  useEffect(() => {
    if (reconnectCount > 0) reconnect();
  }, [reconnectCount, reconnect]);

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

  // --- skeleton -----------------------------------------------------------------------------
  // The whole viewport is the skeleton's: SkeletonStage auto-frames the person inside it.
  const viewport = {
    left: s(SKELETON_VIEWPORT.x),
    top: s(SKELETON_VIEWPORT.y),
    width: s(SKELETON_VIEWPORT.width),
    height: s(SKELETON_VIEWPORT.height),
  };

  const fault: FaultFlash | null = useMemo(
    () => (state.lastRep && state.lastRep.faults.length > 0 ? { seq: state.repSeq, ids: state.lastRep.faults } : null),
    [state.lastRep, state.repSeq],
  );
  const clean: CleanFlash | null = useMemo(
    () => (state.lastRep && state.lastRep.faults.length === 0 ? { seq: state.repSeq } : null),
    [state.lastRep, state.repSeq],
  );

  const lastSet = state.sets.length > 0 ? state.sets[state.sets.length - 1] : undefined;
  // "We can't see you" comes from the phone's presence events or from all-low-visibility poses. It is just a pill:
  // the stage is neither frozen nor dimmed (only a lost phone or lost TV link does that).
  const cantSee = (noPose || state.personPresent === false) && link.card === 'none';
  const readyHint = !state.inSet && state.sets.length === 0 && state.reps === 0 && link.card === 'none' && !cueVisible && !cantSee;
  const pillLevel = link.level;
  const handleNoPose = useCallback((value: boolean) => setNoPose(value), []);

  return (
    <FocusVisibilityContext.Provider value={focusShown}>
      <Animated.View style={[styles.root, { opacity: fade }]}>
        <View style={[styles.stage, { width: s(STAGE_WIDTH) }]}>
          <LampGlow />
        </View>

        <View style={{ position: 'absolute', ...viewport }}>
          <SkeletonStage
            buffer={buffer}
            width={viewport.width}
            height={viewport.height}
            aspect={state.aspect}
            fault={fault}
            clean={clean}
            dimmed={cueVisible || quiet}
            onNoPoseChange={handleNoPose}
            stats={renderStats}
          />
        </View>

        {/* After the skeleton, so the pill stays on top of the viewport's top-left corner. */}
        <View style={{ position: 'absolute', top: s(safe.y), left: s(safe.x) }}>
          <ConnectionPill level={pillLevel} />
        </View>

        {readyHint && <CenterPill text="Ready when you are. Pick an Exercise on your phone." />}
        {cantSee && (
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
              {cue.value && (
                <View style={[styles.cueSlot, { left: s(safe.x), bottom: s(safe.y), width: s(STAGE_REGION.width) }]}>
                  <CueCard
                    coach={cue.value}
                    recapLine={setRecapLine(lastSet)}
                    onDismiss={guarded(dismissCue)}
                    replayRef={replayRef}
                    leaving={cue.leaving}
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
      </Animated.View>
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
