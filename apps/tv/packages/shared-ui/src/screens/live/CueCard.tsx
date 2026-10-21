import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { SpatialNavigationNode, type SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import { Button } from '../../components/ui/Button';
import { SpeakerIcon } from '../../components/ui/Icons';
import { Txt } from '../../components/ui/Txt';
import { useCueAudio, type CueAudioState } from '../../hooks/useCueAudio';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { CoachState } from '../../lib/liveState';
import { color, motion, radius, s } from '../../theme';

const LONG_CUE_CHARS = 280;

interface Props {
  coach: Exclude<CoachState, { status: 'none' }>;
  /** "Set 2: 8 Reps, Form Score 84" shown under "Coach is thinking". */
  recapLine: string | null;
  onDismiss: () => void;
  /** Receives the Replay button's focus handle so the screen can focus it on the first D-pad press. */
  replayRef?: React.Ref<SpatialNavigationNodeRef>;
}

/** The Coach's card: thinking state, the Cue (caption of the spoken audio) with Replay/Dismiss, or the quiet notice. */
export function CueCard({ coach, recapLine, onDismiss, replayRef }: Props) {
  const reduceMotion = useReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: reduceMotion ? 120 : motion.enter,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: true,
    }).start();
  }, [coach.status, enter, reduceMotion]);

  const translateY = reduceMotion ? 0 : enter.interpolate({ inputRange: [0, 1], outputRange: [s(40), 0] });

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: enter,
          transform: [{ translateY }],
          borderRadius: s(radius.card),
          padding: s(32),
          gap: s(32),
          maxHeight: s(440),
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.badge, { width: s(72), height: s(72), borderRadius: s(36) }]}>
        <SpeakerIcon size={s(40)} />
      </View>
      <View style={styles.body}>
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
          <CueBody text={coach.text} audioUrl={coach.audioUrl} onDismiss={onDismiss} replayRef={replayRef} />
        )}
      </View>
    </Animated.View>
  );
}

function Thinking({ recapLine, reduceMotion }: { recapLine: string | null; reduceMotion: boolean }) {
  return (
    <>
      <Txt variant="label" color={color.textMuted}>
        Coach
      </Txt>
      <View style={styles.thinkingRow}>
        <Txt variant="bodyL">Coach is thinking</Txt>
        <Dots reduceMotion={reduceMotion} />
      </View>
      {recapLine && (
        <Txt variant="body" color={color.textDim}>
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
  onDismiss,
  replayRef,
}: {
  text: string;
  audioUrl?: string;
  onDismiss: () => void;
  replayRef?: React.Ref<SpatialNavigationNodeRef>;
}) {
  const audio = useCueAudio(audioUrl);
  return (
    <>
      <Txt variant="label" color={color.textMuted}>
        Coach
      </Txt>
      <Txt variant={text.length > LONG_CUE_CHARS ? 'body' : 'bodyL'}>{text}</Txt>
      <View style={[styles.actions, { gap: s(24), marginTop: s(8) }]}>
        {audio.state !== 'none' ? <AudioStatus state={audio.state} /> : <View />}
        <SpatialNavigationNode orientation="horizontal">
          <View style={{ flexDirection: 'row', gap: s(24) }}>
            {audioUrl ? (
              <Button label="Replay" variant="secondary" onOverlay onSelect={audio.replay} nodeRef={replayRef} minWidth={200} />
            ) : null}
            <Button label="Dismiss" variant="secondary" onOverlay onSelect={onDismiss} minWidth={200} nodeRef={audioUrl ? undefined : replayRef} />
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
  body: { flex: 1, gap: 8 },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  audio: { flexDirection: 'row', alignItems: 'center' },
});
