import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { motion } from '../theme';
import { useReducedMotion } from './useReducedMotion';

/**
 * Opacity 0 -> 1 on mount, on the native driver (compositor only, no layout). Screens use opacity alone on purpose:
 * a moving or scaling ancestor would shift what the D-pad navigator measures while it animates.
 * Reduced motion keeps the fade but makes it shorter (opacity is not movement).
 */
export function useFadeIn(durationMs: number = motion.screen): Animated.Value {
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: reduceMotion ? motion.fadeReduced : durationMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    fade.start();
    return () => fade.stop();
  }, [opacity, reduceMotion, durationMs]);
  return opacity;
}
