import React from 'react';
import { StyleSheet, View } from 'react-native';
import { DefaultFocus, SpatialNavigationNode, SpatialNavigationRoot } from 'react-tv-space-navigation';
import { Button } from '../components/ui/Button';
import { Screen } from '../components/ui/Screen';
import { Txt } from '../components/ui/Txt';
import { exerciseLabel } from '../lib/labels';
import type { Recap, RecapRow } from '../lib/recap';
import { useBackHandler } from '../navigation/backStack';
import { color, radius, s, scoreColor, scoreLabel } from '../theme';
import type { Member } from '../vendor/protocol';

interface Props {
  member: Member;
  recap: Recap;
  onDone: () => void;
  onSameMemberAgain: () => void;
}

/** Recap: built by the TV from the Sets it saw (there is no recap endpoint), plus the last Cue as the Coach's note. */
export function RecapScreen({ member, recap, onDone, onSameMemberAgain }: Props) {
  useBackHandler(onDone);
  const empty = recap.setCount === 0;
  return (
    <Screen>
      <SpatialNavigationRoot isActive>
      <Txt variant="display" accessibilityRole="header">
        {empty ? 'No Sets this time' : `Nice work, ${member.name}`}
      </Txt>

      {empty ? (
        <Txt variant="bodyL" color={color.textDim} style={{ marginTop: s(16) }}>
          Start a Session whenever you&apos;re ready.
        </Txt>
      ) : (
        <>
          <View style={[styles.stats, { gap: s(64), marginVertical: s(32) }]}>
            <Stat value={recap.setCount} label={recap.setCount === 1 ? 'Set' : 'Sets'} />
            <Stat value={recap.repCount} label={recap.repCount === 1 ? 'Rep' : 'Reps'} />
            <Stat value={recap.score} label="Form Score" tint={scoreColor(recap.score)} />
          </View>
          <View style={[styles.columns, { gap: s(32) }]}>
            <View style={[styles.rows, { borderRadius: s(radius.card), padding: s(16) }]}>
              {recap.rows.slice(0, 5).map((row) => (
                <SetRow key={row.setIndex} row={row} />
              ))}
            </View>
            <View style={[styles.note, { borderRadius: s(radius.card), padding: s(32) }]}>
              <Txt variant="label" color={color.textMuted}>
                Coach&apos;s note
              </Txt>
              <Txt variant="bodyL" style={{ marginTop: s(12) }}>
                {recap.coachNote ? `“${recap.coachNote}”` : "The Coach didn't have a note this time."}
              </Txt>
            </View>
          </View>
        </>
      )}

      <View style={{ marginTop: 'auto', alignItems: 'flex-end' }}>
        <SpatialNavigationNode orientation="horizontal">
          <View style={{ flexDirection: 'row', gap: s(32), padding: s(12) }}>
            <DefaultFocus>
              <Button label="Done" onSelect={onDone} />
            </DefaultFocus>
            {!empty && <Button label="Same Member again" variant="secondary" onSelect={onSameMemberAgain} minWidth={380} />}
          </View>
        </SpatialNavigationNode>
      </View>
      </SpatialNavigationRoot>
    </Screen>
  );
}

function Stat({ value, label, tint = color.text }: { value: number; label: string; tint?: string }) {
  return (
    <View accessible accessibilityLabel={`${value} ${label}`}>
      <Txt variant="h1" color={tint} style={{ fontSize: s(64) }}>
        {String(value)}
      </Txt>
      <Txt variant="label" color={color.textMuted}>
        {label}
      </Txt>
    </View>
  );
}

function SetRow({ row }: { row: RecapRow }) {
  const tint = scoreColor(row.score);
  return (
    <View style={[styles.row, { minHeight: s(88), paddingHorizontal: s(24), gap: s(24) }]}>
      <Txt variant="bodyBold" color={color.textMuted} style={{ width: s(110) }}>
        Set {row.setIndex}
      </Txt>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyBold">{exerciseLabel(row.exercise)}</Txt>
        {row.topFault && (
          <Txt variant="body" color={color.textDim} numberOfLines={1}>
            {row.topFault.label} x{row.topFault.count}
          </Txt>
        )}
      </View>
      <Txt variant="body" color={color.textDim}>
        {row.reps} {row.reps === 1 ? 'Rep' : 'Reps'}
      </Txt>
      <View style={[styles.pill, { borderRadius: s(radius.pill), paddingHorizontal: s(20), paddingVertical: s(8), backgroundColor: tint }]}>
        <Txt variant="bodyBold" color={color.onScore}>
          {row.score} {scoreLabel(row.score)}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row' },
  columns: { flexDirection: 'row', alignItems: 'stretch' },
  rows: { flex: 3, backgroundColor: color.raised },
  note: { flex: 2, backgroundColor: color.raised },
  row: { flexDirection: 'row', alignItems: 'center' },
  pill: { alignItems: 'center' },
});
