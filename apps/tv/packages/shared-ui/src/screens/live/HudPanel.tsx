import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { SpatialNavigationNode, type SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import { Button } from '../../components/ui/Button';
import { CheckIcon, WarnIcon } from '../../components/ui/Icons';
import { Txt } from '../../components/ui/Txt';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { exerciseLabel, faultLabel } from '../../lib/labels';
import type { LiveState } from '../../lib/liveState';
import { color, motion, radius, s, scoreColor, scoreLabel } from '../../theme';

export const HUD_WIDTH = 432;
const PAD = 32;
const BAR_WIDTH = HUD_WIDTH - PAD * 2;

interface Props {
  memberName: string;
  state: LiveState;
  score: number | null;
  onEndSession: () => void;
  endRef?: React.Ref<SpatialNavigationNodeRef>;
}

/** Right-hand column: Member + Exercise + Set, rep counter, Form Score, last Rep's Faults, End session. */
export function HudPanel({ memberName, state, score, onEndSession, endRef }: Props) {
  const faults = state.lastRep?.faults ?? [];
  return (
    <View style={[styles.panel, { width: s(HUD_WIDTH), padding: s(PAD), borderRadius: s(radius.card) }]}>
      <View>
        <Txt variant="label" color={color.textMuted} numberOfLines={1}>
          {memberName}
        </Txt>
        <View style={styles.headerRow}>
          <Txt variant="h2" numberOfLines={1} style={{ flexShrink: 1 }}>
            {state.exercise ? exerciseLabel(state.exercise) : 'Ready'}
          </Txt>
          {state.setIndex > 0 && (
            <Txt variant="bodyBold" color={color.textDim}>
              Set {state.setIndex}
            </Txt>
          )}
        </View>
      </View>

      <View>
        <Txt variant="label" color={color.textMuted}>
          Reps
        </Txt>
        <RepCounter reps={state.reps} seq={state.repSeq} />
      </View>

      <FormScore score={score} />

      <View>
        <Txt variant="label" color={color.textMuted}>
          Last Rep
        </Txt>
        <View style={[styles.chips, { gap: s(12), marginTop: s(8) }]}>
          {state.lastRep && faults.length > 0 ? (
            faults.map((id) => <FaultChip key={id} label={faultLabel(id)} />)
          ) : state.lastRep ? (
            <View style={styles.noFaults}>
              <CheckIcon size={s(32)} />
              <Txt variant="body" color={color.textDim} style={{ flexShrink: 1 }}>
                No Faults on your last Rep
              </Txt>
            </View>
          ) : (
            <Txt variant="body" color={color.textMuted}>
              Waiting for your first Rep
            </Txt>
          )}
        </View>
      </View>

      <SpatialNavigationNode orientation="vertical">
        <Button label="End session" variant="secondary" onSelect={onEndSession} minWidth={BAR_WIDTH} nodeRef={endRef} />
      </SpatialNavigationNode>
    </View>
  );
}

function FaultChip({ label }: { label: string }) {
  return (
    <View
      style={[
        styles.chip,
        { minHeight: s(56), borderRadius: s(radius.chip), borderWidth: s(2), paddingHorizontal: s(16), gap: s(10) },
      ]}
      accessible
      accessibilityLabel={`Fault: ${label}`}
    >
      <WarnIcon size={s(30)} />
      <Txt variant="bodyBold" style={{ fontSize: s(28), lineHeight: s(36) }} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

/** Big number with a single bump per new Rep (scale 1 -> 1.18 -> 1) and a one-shot halo flash. */
function RepCounter({ reps, seq }: { reps: number; seq: number }) {
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scale.setValue(1);
    halo.setValue(0.5);
    const flash = Animated.timing(halo, { toValue: 0, duration: reduceMotion ? 120 : motion.bump, useNativeDriver: true });
    const bump = reduceMotion
      ? null
      : Animated.sequence([
          Animated.timing(scale, { toValue: 1.18, duration: 90, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 130, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]);
    Animated.parallel(bump ? [flash, bump] : [flash]).start();
  }, [seq, reduceMotion, scale, halo]);

  return (
    <View style={{ height: s(240), justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={[styles.halo, { opacity: halo, borderRadius: s(120) }]} />
      <Animated.View style={{ transform: [{ scale }], alignSelf: 'flex-start' }}>
        <Txt variant="repCounter" numberOfLines={1} adjustsFontSizeToFit style={{ minWidth: s(120) }}>
          {String(reps)}
        </Txt>
      </Animated.View>
    </View>
  );
}

function FormScore({ score }: { score: number | null }) {
  const fill = useRef(new Animated.Value(score === null ? 0 : score / 100)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    Animated.timing(fill, {
      toValue: score === null ? 0 : score / 100,
      duration: reduceMotion ? 0 : 250,
      useNativeDriver: true,
    }).start();
  }, [score, fill, reduceMotion]);

  const width = s(BAR_WIDTH);
  const tint = score === null ? color.textMuted : scoreColor(score);
  const label = score === null ? 'Do your first Rep' : scoreLabel(score);
  return (
    <View
      accessible
      accessibilityLabel={score === null ? 'Form Score: no Reps yet' : `Form Score ${score}, ${scoreLabel(score)}`}
    >
      <Txt variant="label" color={color.textMuted}>
        Form Score
      </Txt>
      <View style={styles.scoreRow}>
        <Txt variant="display" color={tint} style={{ minWidth: s(110) }}>
          {score === null ? '--' : String(score)}
        </Txt>
        <Txt variant="bodyBold" color={color.textDim} style={{ flex: 1 }} numberOfLines={2}>
          {label}
        </Txt>
      </View>
      <View style={[styles.track, { width, height: s(16), borderRadius: s(8) }]}>
        {/* Fill grows from the left: scale about the centre, then shift left by half the missing width. */}
        <Animated.View
          style={{
            width,
            height: s(16),
            borderRadius: s(8),
            backgroundColor: tint,
            transform: [{ translateX: fill.interpolate({ inputRange: [0, 1], outputRange: [-width / 2, 0] }) }, { scaleX: fill }],
          }}
        />
        {[60, 85].map((tick) => (
          <View key={tick} style={[styles.tick, { left: (width * tick) / 100 - 1, width: s(3), height: s(16) }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: color.raised, justifyContent: 'space-between' },
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.overlay, borderColor: color.scorePoor },
  noFaults: { flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%' },
  halo: { ...StyleSheet.absoluteFillObject, backgroundColor: color.accent },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  track: { backgroundColor: color.track, overflow: 'hidden', marginTop: 4 },
  tick: { position: 'absolute', top: 0, backgroundColor: color.raised },
});
