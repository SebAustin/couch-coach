import React from 'react';
import { StyleSheet, View } from 'react-native';
import { DefaultFocus, SpatialNavigationNode, SpatialNavigationRoot } from 'react-tv-space-navigation';
import { Button } from '../components/ui/Button';
import { Screen } from '../components/ui/Screen';
import { Txt, type TxtVariant } from '../components/ui/Txt';
import { glyphCount, recapWindow, textTier, type TextTier } from '../lib/fit';
import { exerciseLabel } from '../lib/labels';
import type { Recap, RecapRow } from '../lib/recap';
import { useBackHandler } from '../navigation/backStack';
import { color, radius, s, scoreColor, scoreLabel } from '../theme';
import type { Member } from '../vendor/protocol';

/** "Nice work, <name>" stays at display size up to this many characters, then steps to two lines of h1. */
const TITLE_DISPLAY_MAX = 24;
/** The Coach's note steps 34 -> 30 -> 26 with length and clamps at 10 lines, so it can never push the buttons off screen. */
const NOTE_LARGE_MAX = 150;
const NOTE_MEDIUM_MAX = 260;
const NOTE_MAX_LINES = 10;
const NOTE_VARIANT: Record<TextTier, TxtVariant> = { large: 'bodyL', medium: 'body', small: 'bodyS' };
const COMPACT_ROW_HEIGHT = 46;

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
  const title = empty ? 'No Sets this time' : `Nice work, ${member.name}`;
  const longTitle = glyphCount(title) > TITLE_DISPLAY_MAX;
  const sets = recapWindow(recap.rows);
  const note = recap.coachNote;
  const noteTier = textTier(note ? glyphCount(note) : 0, NOTE_LARGE_MAX, NOTE_MEDIUM_MAX);
  return (
    <Screen>
      <SpatialNavigationRoot isActive>
        <Txt variant={longTitle ? 'h1' : 'display'} numberOfLines={longTitle ? 2 : 1} accessibilityRole="header">
          {title}
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
              <View style={[styles.rows, { borderRadius: s(radius.card), padding: s(sets.compact ? 12 : 16) }]}>
                {sets.earlier > 0 && (
                  <View style={[styles.row, { minHeight: s(COMPACT_ROW_HEIGHT), paddingHorizontal: s(24) }]}>
                    <Txt variant="bodyS" color={color.textMuted} numberOfLines={1}>
                      +{sets.earlier} earlier {sets.earlier === 1 ? 'Set' : 'Sets'}
                    </Txt>
                  </View>
                )}
                {sets.rows.map((row) =>
                  sets.compact ? <CompactSetRow key={row.setIndex} row={row} /> : <SetRow key={row.setIndex} row={row} />,
                )}
              </View>
              <View style={[styles.note, { borderRadius: s(radius.card), padding: s(32) }]}>
                <Txt variant="label" color={color.textMuted}>
                  Coach&apos;s note
                </Txt>
                <Txt
                  variant={NOTE_VARIANT[noteTier]}
                  numberOfLines={noteTier === 'small' ? NOTE_MAX_LINES : undefined}
                  style={{ marginTop: s(12) }}
                >
                  {note ? `“${note}”` : "The Coach didn't have a note this time."}
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
      <Txt variant="h1" color={tint} numberOfLines={1}>
        {String(value)}
      </Txt>
      <Txt variant="label" color={color.textMuted}>
        {label}
      </Txt>
    </View>
  );
}

/** "Knees caving x3" / null: the Fault that cost this Set the most Reps. */
const faultNote = (row: RecapRow): string | null => (row.topFault ? `${row.topFault.label} x${row.topFault.count}` : null);

/** Up to 5 Sets: two lines (Exercise, then top Fault), 88 high. */
function SetRow({ row }: { row: RecapRow }) {
  const tint = scoreColor(row.score);
  const fault = faultNote(row);
  return (
    <View style={[styles.row, { minHeight: s(88), paddingHorizontal: s(24), gap: s(24) }]}>
      <Txt variant="bodyBold" color={color.textMuted} style={{ width: s(110) }} numberOfLines={1}>
        Set {row.setIndex}
      </Txt>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyBold" numberOfLines={1}>
          {exerciseLabel(row.exercise)}
        </Txt>
        {fault && (
          <Txt variant="body" color={color.textDim} numberOfLines={1}>
            {fault}
          </Txt>
        )}
      </View>
      <Txt variant="body" color={color.textDim} numberOfLines={1}>
        {row.reps} {row.reps === 1 ? 'Rep' : 'Reps'}
      </Txt>
      <View style={[styles.pill, { borderRadius: s(radius.pill), paddingHorizontal: s(20), paddingVertical: s(8), backgroundColor: tint }]}>
        <Txt variant="bodyBold" color={color.onScore} numberOfLines={1}>
          {row.score} {scoreLabel(row.score)}
        </Txt>
      </View>
    </View>
  );
}

/** 6 to 10 Sets: one line each (46 high, 26 text) so ten Sets fit above the buttons. Score keeps its number AND band word. */
function CompactSetRow({ row }: { row: RecapRow }) {
  const tint = scoreColor(row.score);
  const fault = faultNote(row);
  return (
    <View style={[styles.row, { minHeight: s(COMPACT_ROW_HEIGHT), paddingHorizontal: s(24), gap: s(20) }]}>
      <Txt variant="bodySBold" color={color.textMuted} style={{ width: s(92) }} numberOfLines={1}>
        Set {row.setIndex}
      </Txt>
      <Txt variant="bodyS" style={{ flex: 1 }} numberOfLines={1}>
        {exerciseLabel(row.exercise)}
        {fault ? ` · ${fault}` : ''}
      </Txt>
      <Txt variant="bodyS" color={color.textDim} numberOfLines={1}>
        {row.reps} {row.reps === 1 ? 'Rep' : 'Reps'}
      </Txt>
      <View style={[styles.pill, { borderRadius: s(radius.pill), paddingHorizontal: s(16), backgroundColor: tint }]}>
        <Txt variant="bodySBold" color={color.onScore} numberOfLines={1}>
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
