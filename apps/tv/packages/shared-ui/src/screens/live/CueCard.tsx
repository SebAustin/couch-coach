import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { SpatialNavigationNode, type SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import { Button } from '../../components/ui/Button';
import { SpeakerIcon } from '../../components/ui/Icons';
import { Txt, type TxtVariant } from '../../components/ui/Txt';
import { useCueAudio, type CueAudioState } from '../../hooks/useCueAudio';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { glyphCount, textTier, type TextTier } from '../../lib/fit';
import type { CoachState } from '../../lib/liveState';
import { color, motion, radius, s } from '../../theme';

/**
 * A Cue is captioned in full: it steps down 34 -> 30 -> 26 as it gets longer, and the card grows upward from its
 * bottom edge (max 640 high) so the Replay and Dismiss buttons are never pushed out of the card.
 * Only past ~800 characters at 26 does it clamp, and the screen reader still gets the whole text.
 */
const CUE_LARGE_MAX = 200;
const CUE_MEDIUM_MAX = 300;
const CUE_MAX_LINES = 11;
const CARD_MAX_HEIGHT = 640;
const CUE_VARIANT: Record<TextTier, TxtVariant> = { large: 'bodyL', medium: 'body', small: 'bodyS' };
/** Entrance travel and the (smaller, quicker) exit travel, design px. */
const ENTER_SHIFT = 40;
const EXIT_SHIFT = 16;
const SWAP_MS = 160;

interface Props {
  coach: Exclude<CoachState, { status: 'none' }>;
  /** "Set 2: 8 Reps, Form Score 84" shown under "Coach is thinking". */
  recapLine: string | null;
  onDismiss: () => void;
  /** Receives the Replay button's focus handle so the screen can focus it on the first D-pad press. */
  replayRef?: React.Ref<SpatialNavigationNodeRef>;
  /** The Cue was dismissed or replaced: play the exit (the screen unmounts the card after `motion.exit`). */
  leaving?: boolean;
}

/** The Coach's card: thinking state, the Cue (caption of the spoken audio) with Replay/Dismiss, or the quiet notice. */
export function CueCard({ coach, recapLine, onDismiss, replayRef, leaving = false }: Props) {
  const reduceMotion = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;
  const leave = useRef(new Animated.Value(0)).current;
  const swap = useRef(new Animated.Value(1)).current;
  const lastStatus = useRef(coach.status);

  // Both curves are built once from the two native-driven values; the card never re-renders to animate.
  const opacity = useMemo(
    () => Animated.multiply(enter, leave.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
    [enter, leave],
  );
  const translateY = useMemo(
    () =>
      Animated.add(
        enter.interpolate({ inputRange: [0, 1], outputRange: [s(ENTER_SHIFT), 0] }),
        leave.interpolate({ inputRange: [0, 1], outputRange: [0, s(EXIT_SHIFT)] }),
      ),
    [enter, leave],
  );

  // Entrance, once per card (not per status: thinking -> Cue is a content swap, not a new card).
  useEffect(() => {
    const entrance = Animated.timing(enter, {
      toValue: 1,
      duration: reduceMotion ? motion.fadeReduced : motion.enter,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    });
    entrance.start();
    return () => entrance.stop();
  }, [enter, reduceMotion]);

  // Exit: quicker than the entrance and with less travel. A new message arriving mid-exit cancels it.
  useEffect(() => {
    if (!leaving) {
      leave.setValue(0);
      return undefined;
    }
    const exit = Animated.timing(leave, {
      toValue: 1,
      duration: reduceMotion ? motion.fadeReduced : motion.exit,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    exit.start();
    return () => exit.stop();
  }, [leaving, leave, reduceMotion]);

  // thinking -> Cue (or quiet): cross-fade the body instead of replaying the whole card entrance.
  useEffect(() => {
    if (coach.status === lastStatus.current) return undefined;
    lastStatus.current = coach.status;
    swap.setValue(0);
    const fade = Animated.timing(swap, {
      toValue: 1,
      duration: reduceMotion ? motion.fadeReduced : SWAP_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [coach.status, swap, reduceMotion]);

  return (
    <Animated.View
      pointerEvents={leaving ? 'none' : 'auto'}
      style={[
        styles.card,
        {
          opacity,
          transform: reduceMotion ? undefined : [{ translateY }],
          borderRadius: s(radius.card),
          padding: s(32),
          gap: s(32),
          maxHeight: s(CARD_MAX_HEIGHT),
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.badge, { width: s(72), height: s(72), borderRadius: s(36) }]}>
        <SpeakerIcon size={s(40)} />
      </View>
      <Animated.View style={[styles.body, { opacity: swap, gap: s(8) }]}>
        {coach.status === 'thinking' && <Thinking recapLine={recapLine} reduceMotion={reduceMotion} />}
        {coach.status === 'quiet' && (
          <>
            <Txt variant="label" color={color.textMuted}>
              Coach
            </Txt>
            <Txt variant="bodyL">The Coach is quiet this time. Your Reps are saved.</Txt>
          </>
        )}
        {coach.status === 'cue' && (
          <CueBody
            text={coach.text}
            audioUrl={leaving ? undefined : coach.audioUrl}
            hasAudio={coach.audioUrl !== undefined}
            onDismiss={onDismiss}
            replayRef={replayRef}
          />
        )}
      </Animated.View>
    </Animated.View>
  );
}

function Thinking({ recapLine, reduceMotion }: { recapLine: string | null; reduceMotion: boolean }) {
  return (
    <>
      <Txt variant="label" color={color.textMuted}>
        Coach
      </Txt>
      <View style={[styles.thinkingRow, { gap: s(16) }]}>
        <Txt variant="bodyL">Coach is thinking</Txt>
        <Dots reduceMotion={reduceMotion} />
      </View>
      {recapLine && (
        <Txt variant="body" color={color.textDim} numberOfLines={2}>
          {recapLine}
        </Txt>
      )}
    </>
  );
}

/** Three dots with a staggered opacity loop; static "..." under reduced motion. */
function Dots({ reduceMotion }: { reduceMotion: boolean }) {
  const values = useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    if (reduceMotion) return undefined;
    const loops = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(v, { toValue: 1, duration: 450, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 450, useNativeDriver: true }),
          Animated.delay((2 - i) * 150),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [values, reduceMotion]);

  if (reduceMotion) return <Txt variant="bodyL">...</Txt>;
  return (
    <View style={{ flexDirection: 'row', gap: s(10) }}>
      {values.map((v, i) => (
        <Animated.View key={i} style={{ opacity: v, width: s(14), height: s(14), borderRadius: s(7), backgroundColor: color.text }} />
      ))}
    </View>
  );
}

function CueBody({
  text,
  audioUrl,
  hasAudio,
  onDismiss,
  replayRef,
}: {
  text: string;
  /** Undefined while the card is leaving, which stops the audio with the card. */
  audioUrl?: string;
  hasAudio: boolean;
  onDismiss: () => void;
  replayRef?: React.Ref<SpatialNavigationNodeRef>;
}) {
  const audio = useCueAudio(audioUrl);
  const tier = textTier(glyphCount(text), CUE_LARGE_MAX, CUE_MEDIUM_MAX);
  return (
    <>
      <Txt variant="label" color={color.textMuted}>
        Coach
      </Txt>
      <Txt variant={CUE_VARIANT[tier]} numberOfLines={tier === 'small' ? CUE_MAX_LINES : undefined}>
        {text}
      </Txt>
      <View style={[styles.actions, { gap: s(24), marginTop: s(8) }]}>
        {audio.state !== 'none' ? <AudioStatus state={audio.state} /> : <View />}
        <SpatialNavigationNode orientation="horizontal">
          <View style={{ flexDirection: 'row', gap: s(24) }}>
            {hasAudio ? (
              <Button label="Replay" variant="secondary" onOverlay onSelect={audio.replay} nodeRef={replayRef} minWidth={200} />
            ) : null}
            <Button label="Dismiss" variant="secondary" onOverlay onSelect={onDismiss} minWidth={200} nodeRef={hasAudio ? undefined : replayRef} />
          </View>
        </SpatialNavigationNode>
      </View>
    </>
  );
}

const LABELS: Record<CueAudioState, string> = {
  none: '',
  loading: 'Loading audio',
  playing: 'Playing',
  idle: 'Replay',
  unavailable: 'Audio unavailable',
};

function AudioStatus({ state }: { state: CueAudioState }) {
  return (
    <View style={[styles.audio, { gap: s(12) }]}>
      <Equalizer playing={state === 'playing'} />
      <Txt variant="bodyBold" color={color.textDim}>
        {LABELS[state]}
      </Txt>
    </View>
  );
}

/** Three bars; scaleY loops only while audio plays. */
function Equalizer({ playing }: { playing: boolean }) {
  const bars = useRef([0.5, 0.9, 0.65].map((v) => new Animated.Value(v))).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!playing || reduceMotion) return undefined;
    const loops = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 320 + i * 90, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 320 + i * 90, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [playing, bars, reduceMotion]);

  const h = s(28);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(5), height: h }}>
      {bars.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: s(6),
            height: h,
            borderRadius: s(3),
            backgroundColor: playing ? color.accent : color.textMuted,
            transform: [{ scaleY: playing ? v : 0.5 }],
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.overlay, flexDirection: 'row', alignItems: 'flex-start' },
  badge: { backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  audio: { flexDirection: 'row', alignItems: 'center' },
});
