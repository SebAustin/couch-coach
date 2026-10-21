import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { color, s, safe } from '../../theme';
import { LampGlow } from './LampGlow';

/** Full-screen Lamplight background with the lamp glow; children sit inside the 5% overscan safe area. */
export function Screen({
  children,
  padded = true,
  style,
}: {
  children: React.ReactNode;
  padded?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View style={styles.root}>
      <LampGlow />
      <View
        style={[
          styles.content,
          padded && { paddingHorizontal: s(safe.x), paddingVertical: s(safe.y) },
          style,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { flex: 1 },
});
