import { canCount } from 'pose-reps';
import type { Exercise, Landmark } from '@couch-coach/protocol';

/**
 * Why the Camera Phone can't count Reps well right now; null when the Member is properly framed.
 * `no_person` and `step_back` mean nothing is counted; `move_closer` means counting works but the body is
 * so small in the frame that the landmarks get noisy.
 */
export type FramingIssue = 'no_person' | 'step_back' | 'move_closer';

const VISIBLE = 0.5;
const DEFAULT_HOLD_MS = 1000;
const DEFAULT_CLOSER_HOLD_MS = 2000;
/** Below this visible body span (fraction of the frame height) the Member is asked to come closer. */
const MIN_BODY_SPAN = 0.4;

/** Nose, shoulders and hips: the top of the measured body. */
const TOP = [0, 11, 12, 23, 24] as const;
const ANKLES = [27, 28] as const;

const isVisible = (pose: readonly Landmark[], i: number) => (pose[i]?.visibility ?? 0) >= VISIBLE;

/**
 * Visible body height as a fraction of the frame: the lowest visible ankle minus the highest visible of
 * nose, shoulders and hips (y grows downward). Null when no ankle or none of the top landmarks is visible.
 */
export function bodySpan(pose: readonly Landmark[]): number | null {
  const ys = (ids: readonly number[]) => ids.filter((i) => isVisible(pose, i)).map((i) => pose[i]!.y);
  const top = ys(TOP);
  const ankles = ys(ANKLES);
  if (top.length === 0 || ankles.length === 0) return null;
  return Math.max(...ankles) - Math.min(...top);
}

/** Per-frame check. `step_back` exactly when pose-reps can't count the pose, so the hint matches the counter. */
export function framingIssue(pose: readonly Landmark[] | null, exercise: Exercise): FramingIssue | null {
  if (!pose || !pose.some((_, i) => isVisible(pose, i))) return 'no_person';
  if (!canCount(exercise, pose)) return 'step_back';
  const span = bodySpan(pose);
  return span !== null && span < MIN_BODY_SPAN ? 'move_closer' : null;
}

/**
 * Debounces framingIssue so a single bad frame doesn't flash a banner.
 * - `no_person` / `step_back` show once counting has been impossible for `holdMs`, and clear on the first
 *   countable frame.
 * - `move_closer` shows once the body has looked small for `closerHoldMs`. Only a frame where the body
 *   measures big enough restarts that clock: far away, the ankles flicker in and out, and those frames
 *   must not keep postponing the hint.
 */
export function createFramingTracker({
  holdMs = DEFAULT_HOLD_MS,
  closerHoldMs = DEFAULT_CLOSER_HOLD_MS,
}: { holdMs?: number; closerHoldMs?: number } = {}) {
  let blockedSince: number | null = null;
  let smallSince: number | null = null;
  let current: FramingIssue | null = null;
  return {
    push(pose: readonly Landmark[] | null, exercise: Exercise, tMs: number): FramingIssue | null {
      const issue = framingIssue(pose, exercise);
      const span = pose ? bodySpan(pose) : null;
      if (span !== null) smallSince = span < MIN_BODY_SPAN ? (smallSince ?? tMs) : null;
      if (issue === 'no_person' || issue === 'step_back') {
        blockedSince ??= tMs;
        if (tMs - blockedSince >= holdMs) current = issue;
      } else {
        blockedSince = null;
        current = smallSince !== null && tMs - smallSince >= closerHoldMs ? 'move_closer' : null;
      }
      return current;
    },
    reset(): void {
      blockedSince = null;
      smallSince = null;
      current = null;
    },
  };
}
