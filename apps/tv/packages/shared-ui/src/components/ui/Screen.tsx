import React from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { useFadeIn } from '../../hooks/useFadeIn';
import { color, s, safe } from '../../theme';
import { LampGlow } from './LampGlow';

/**
 * Full-screen Lamplight background with the lamp glow; children sit inside the 5% overscan safe area.
 * The screen fades in on mount (the one screen transition: opacity only, native driver, so the D-pad navigator
 * never measures a moving container). The solid background stays put so there is no flash of black between screens.
 */
export function Screen({
  children,
  padded = true,
  style,
}: {
  children: React.ReactNode;
  padded?: boolean;
  style?: ViewStyle;
}) {
  const opacity = useFadeIn();
  return (
    <View style={styles.root}>
      <Animated.View style={[styles.fade, { opacity }]}>
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
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  fade: { flex: 1 },
  content: { flex: 1 },
});
