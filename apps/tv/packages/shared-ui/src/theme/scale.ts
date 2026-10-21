import { Dimensions } from 'react-native';
import { DESIGN_WIDTH } from './tokens';

/**
 * Converts a 1920x1080 design px value to device-independent pixels:
 * `s(px) = px * windowWidth / 1920`. Evaluated against the window at call time, so it works whatever
 * the dp density of the TV (a 1080p Fire TV reports 960 dp wide, a web preview 1920 px).
 */
export function s(px: number): number {
  return Math.round(((px * Dimensions.get('window').width) / DESIGN_WIDTH) * 100) / 100;
}

/** Pure variant for tests and non-RN callers. */
export function scaleFor(windowWidth: number, px: number): number {
  return Math.round(((px * windowWidth) / DESIGN_WIDTH) * 100) / 100;
}
