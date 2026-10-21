import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';
import { SpatialNavigationFocusableView, type SpatialNavigationNodeRef } from 'react-tv-space-navigation';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { color, motion, radius as radii, s } from '../../theme';
import { useFocusVisible } from './FocusVisibility';

export interface FocusableProps {
  onSelect?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** 1.06 for cards, 1.08 for buttons and chips (docs/ux.md "Focus"). */
  focusScale?: number;
  /** Corner radius of the element in design px, so the ring and glow follow its shape. */
  cornerRadius?: number;
  style?: ViewStyle;
  accessibilityLabel?: string;
  disabled?: boolean;
  children: React.ReactNode | ((state: { isFocused: boolean }) => React.ReactNode);
  nodeRef?: React.Ref<SpatialNavigationNodeRef>;
}

const RING = 4;
const GAP = 3;
/** Press feedback: a quick dip so Select visibly "lands" (never below 0.95). */
const PRESS_SCALE = 0.96;
/** Concentric rounded layers approximate the 36 px glow blur, which React Native cannot draw natively. */
const GLOW_LAYERS: readonly { spread: number; alpha: number }[] = [
  { spread: 36, alpha: 0.14 },
  { spread: 24, alpha: 0.22 },
  { spread: 12, alpha: 0.34 },
];

/**
 * The focused cell is drawn above its siblings. The ring and 36 px glow reach further than the 32 px grid gap, so
 * without this the next sibling's background painted over the halo and cut it off.
 */
const LIFTED: ViewStyle = { zIndex: 10 };

/**
 * D-pad focus wrapper. On focus (150 ms ease-out): scale up, a 4 px focus ring offset by a 3 px gap, and a
 * glow halo. The ring and glow are separate layers whose OPACITY animates; nothing animates layout or borders.
 * Under reduced motion there is no scale and the ring/glow appear instantly. Select plays a 100 ms press dip.
 */
export function Focusable({
  onSelect,
  onFocus,
  onBlur,
  focusScale = 1.08,
  cornerRadius = radii.button,
  style,
  accessibilityLabel,
  disabled,
  children,
  nodeRef,
}: FocusableProps) {
  const [lifted, setLifted] = useState(false);
  const [pressSeq, setPressSeq] = useState(0);

  const handleFocus = useCallback(() => {
    setLifted(true);
    onFocus?.();
  }, [onFocus]);
  const handleBlur = useCallback(() => {
    setLifted(false);
    onBlur?.();
  }, [onBlur]);
  const handleSelect = useCallback(() => {
    setPressSeq((n) => n + 1);
    onSelect?.();
  }, [onSelect]);

  return (
    <SpatialNavigationFocusableView
      ref={nodeRef}
      style={lifted ? LIFTED : undefined}
      onSelect={disabled ? undefined : handleSelect}
      onFocus={handleFocus}
      onBlur={handleBlur}
      viewProps={{ accessible: true, accessibilityRole: 'button', accessibilityLabel, accessibilityState: { disabled } }}
    >
      {({ isFocused }) => (
        <FocusFrame
          focused={isFocused && !disabled}
          focusScale={focusScale}
          cornerRadius={cornerRadius}
          pressSeq={pressSeq}
          style={style}
        >
          {typeof children === 'function' ? children({ isFocused }) : children}
        </FocusFrame>
      )}
    </SpatialNavigationFocusableView>
  );
}

function FocusFrame({
  focused,
  focusScale,
  cornerRadius,
  pressSeq,
  style,
  children,
}: {
  focused: boolean;
  focusScale: number;
  cornerRadius: number;
  pressSeq: number;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  const visible = useFocusVisible();
  const reduceMotion = useReducedMotion();
  const active = focused && visible;
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
  const press = useRef(new Animated.Value(1)).current;
  const lastPress = useRef(pressSeq);

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: reduceMotion ? 0 : motion.focus,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [active, reduceMotion, progress]);

  // A new Select (pressSeq changed): dip and recover. No movement at all under reduced motion.
  useEffect(() => {
    if (pressSeq === lastPress.current) return undefined;
    lastPress.current = pressSeq;
    if (reduceMotion) return undefined;
    press.setValue(1);
    const dip = Animated.sequence([
      Animated.timing(press, { toValue: PRESS_SCALE, duration: motion.press, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(press, { toValue: 1, duration: motion.focus, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]);
    dip.start();
    return () => dip.stop();
  }, [pressSeq, reduceMotion, press]);

  const scale = reduceMotion
    ? 1
    : progress.interpolate({ inputRange: [0, 1], outputRange: [1, focusScale] });
  const ringOffset = s(GAP + RING);

  return (
    <Animated.View style={[{ transform: [{ scale }, { scale: press }] }, style]}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: progress }]}>
        {GLOW_LAYERS.map((layer) => (
          <View
            key={layer.spread}
            style={{
              position: 'absolute',
              top: -s(layer.spread),
              left: -s(layer.spread),
              right: -s(layer.spread),
              bottom: -s(layer.spread),
              borderRadius: s(cornerRadius + layer.spread),
              backgroundColor: color.focusGlow,
              opacity: layer.alpha / 0.55,
            }}
          />
        ))}
        <View
          style={{
            position: 'absolute',
            top: -ringOffset,
            left: -ringOffset,
            right: -ringOffset,
            bottom: -ringOffset,
            borderRadius: s(cornerRadius + GAP + RING),
            borderWidth: s(RING),
            borderColor: color.focusRing,
          }}
        />
      </Animated.View>
      {children}
    </Animated.View>
  );
}
