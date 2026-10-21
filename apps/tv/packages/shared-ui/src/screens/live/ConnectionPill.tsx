import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { CheckIcon, CrossIcon } from '../../components/ui/Icons';
import { Txt } from '../../components/ui/Txt';
import type { ConnectionLevel } from '../../lib/connection';
import { color, s } from '../../theme';

const CONTENT: Record<ConnectionLevel, { text: string; tint: string }> = {
  connected: { text: 'Phone connected', tint: color.scoreGood },
  reconnecting: { text: 'Reconnecting...', tint: color.scoreOk },
  lost: { text: 'Phone lost', tint: color.scorePoor },
};

/** Status pill, top-left of the stage: icon + text, never color alone. */
export function ConnectionPill({ level, text }: { level: ConnectionLevel; text?: string }) {
  const { text: defaultText, tint } = CONTENT[level];
  const size = s(32);
  return (
    <View
      style={[styles.pill, { borderRadius: s(999), paddingHorizontal: s(20), paddingVertical: s(10), gap: s(12) }]}
      accessible
      accessibilityLabel={text ?? defaultText}
      accessibilityLiveRegion="polite"
    >
      {level === 'connected' && <CheckIcon size={size} color={tint} />}
      {level === 'reconnecting' && <ActivityIndicator size="small" color={tint} />}
      {level === 'lost' && <CrossIcon size={size} color={tint} />}
      <Txt variant="label" upper={false} style={{ textTransform: 'none' }} color={color.text}>
        {text ?? defaultText}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: color.overlay },
});
