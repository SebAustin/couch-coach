import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * One shared subscription for the whole app. Every Focusable, the HUD and the Cue card read this flag; giving each
 * its own `AccessibilityInfo` listener (and its own async query) cost ~20 listeners and a state update per mount.
 */
let reduced = false;
let started = false;
const listeners = new Set<() => void>();

function publish(value: boolean): void {
  if (value === reduced) return;
  reduced = value;
  listeners.forEach((notify) => notify());
}

function start(): void {
  if (started) return;
  started = true;
  AccessibilityInfo.isReduceMotionEnabled()
    .then(publish)
    .catch(() => undefined);
  AccessibilityInfo.addEventListener('reduceMotionChanged', publish);
}

function subscribe(notify: () => void): () => void {
  start();
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** True when the system asks for reduced motion (TV: Accessibility setting; web: prefers-reduced-motion). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => reduced,
    () => false,
  );
}
