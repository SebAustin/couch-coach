import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { SpatialNavigationNode, type SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import { Button } from '../../components/ui/Button';
import { CheckIcon, WarnIcon } from '../../components/ui/Icons';
import { Txt } from '../../components/ui/Txt';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { repFontSize, visibleFaults } from '../../lib/fit';
import { exerciseLabel, faultLabel } from '../../lib/labels';
import type { LiveState } from '../../lib/liveState';
import { color, motion, radius, s, scoreColor, scoreLabel } from '../../theme';

export const HUD_WIDTH = 432;
const PAD = 32;
const BAR_WIDTH = HUD_WIDTH - PAD * 2;
/** Chip rows the Last Rep zone can hold above the End session button; more Faults fold into "+N more". */
const MAX_CHIP_ROWS = 3;
const CHIP_HEIGHT = 56;
const CHIP_GAP = 8;
/** Reserve two chip rows so 0, 1 or 2 Faults (and the two-line "No Faults" text) never move the blocks above. */
const LAST_REP_MIN = CHIP_HEIGHT * 2 + CHIP_GAP;
const COUNTER_BOX = 240;

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
  const { shown, hidden } = visibleFaults(faults, MAX_CHIP_ROWS);
  return (
    <View style={[styles.panel, { width: s(HUD_WIDTH), padding: s(PAD), borderRadius: s(radius.card) }]}>
      <View>
        <Txt variant="label" color={color.textMuted} numberOfLines={1}>
          {memberName}
        </Txt>
        <View style={[styles.headerRow, { gap: s(12) }]}>
          <Txt variant="h2" numberOfLines={1} style={{ flexShrink: 1 }}>
            {state.exercise ? exerciseLabel(state.exercise) : 'Ready'}
          </Txt>
          {state.setIndex > 0 && (
            <Txt variant="bodyBold" color={color.textDim} numberOfLines={1} style={{ flexShrink: 0 }}>
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
        <View style={[styles.chips, { gap: s(CHIP_GAP), marginTop: s(8), minHeight: s(LAST_REP_MIN) }]}>
          {state.lastRep && faults.length > 0 ? (
            <>
              {shown.map((id) => (
                <FaultChip key={id} label={faultLabel(id)} />
              ))}
              {hidden > 0 && <MoreChip count={hidden} names={faults.slice(shown.length).map(faultLabel)} />}
            </>
          ) : state.lastRep ? (
            <View style={[styles.noFaults, { gap: s(12) }]}>
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
        { minHeight: s(CHIP_HEIGHT), borderRadius: s(radius.chip), borderWidth: s(2), paddingHorizontal: s(16), gap: s(10), maxWidth: '100%' },
      ]}
      accessible
      accessibilityLabel={`Fault: ${label}`}
    >
      <WarnIcon size={s(30)} />
      {/* flexShrink + one line: a long Fault name ends in an ellipsis inside the panel instead of overflowing it. */}
      <Txt variant="bodyBold" style={{ fontSize: s(28), lineHeight: s(36), flexShrink: 1 }} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

/** The fourth and later Faults, folded into one neutral chip so the Last Rep zone never outgrows the panel. */
function MoreChip({ count, names }: { count: number; names: string[] }) {
  return (
    <View
      style={[
        styles.chip,
        { minHeight: s(CHIP_HEIGHT), borderRadius: s(radius.chip), borderWidth: s(2), paddingHorizontal: s(16), borderColor: color.textMuted },
      ]}
      accessible
      accessibilityLabel={`${count} more Faults: ${names.join(', ')}`}
    >
      <Txt variant="bodyBold" style={{ fontSize: s(28), lineHeight: s(36) }} numberOfLines={1}>
        +{count} more
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
      return undefined;
    }
    scale.setValue(1);
    halo.setValue(0.5);
    const flash = Animated.timing(halo, { toValue: 0, duration: reduceMotion ? motion.fadeReduced : motion.bump, useNativeDriver: true });
    const bump = reduceMotion
      ? null
      : Animated.sequence([
          Animated.timing(scale, { toValue: 1.18, duration: 90, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 130, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]);
    const run = Animated.parallel(bump ? [flash, bump] : [flash]);
    run.start();
    return () => run.stop();
  }, [seq, reduceMotion, scale, halo]);

  // 1-2 digits use the spec size; 100+ steps down so the number plus its 1.18 bump stay inside the panel.
  const size = repFontSize(reps);
  return (
    <View style={{ height: s(COUNTER_BOX), justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={[styles.halo, { opacity: halo, borderRadius: s(120) }]} />
      <Animated.View style={{ transform: [{ scale }], alignSelf: 'flex-start' }}>
        <Txt
          variant="repCounter"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{ fontSize: s(size), lineHeight: s((size * 240) / 220), minWidth: s(120) }}
        >
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
    const grow = Animated.timing(fill, {
      toValue: score === null ? 0 : Math.min(1, Math.max(0, score / 100)),
      duration: reduceMotion ? 0 : 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    grow.start();
    return () => grow.stop();
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
      <View style={[styles.scoreRow, { gap: s(16) }]}>
        <Txt variant="display" color={tint} numberOfLines={1} style={{ minWidth: s(110), flexShrink: 0 }}>
          {score === null ? '--' : String(score)}
        </Txt>
        <Txt variant="bodyBold" color={color.textDim} style={{ flex: 1 }} numberOfLines={2}>
          {label}
        </Txt>
      </View>
      <View style={[styles.track, { width, height: s(16), borderRadius: s(8), marginTop: s(4) }]}>
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
  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.overlay, borderColor: color.scorePoor },
  noFaults: { flexDirection: 'row', alignItems: 'center', width: '100%' },
  halo: { ...StyleSheet.absoluteFillObject, backgroundColor: color.accent },
  scoreRow: { flexDirection: 'row', alignItems: 'center' },
  track: { backgroundColor: color.track, overflow: 'hidden' },
  tick: { position: 'absolute', top: 0, backgroundColor: color.raised },
});
