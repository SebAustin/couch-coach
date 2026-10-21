import type { Exercise, Landmark } from '@couch-coach/protocol';

/** Why the Camera Phone can't count Reps right now; null when the Member is properly framed. */
export type FramingIssue = 'no_person' | 'step_back';

const VISIBLE = 0.5;
const DEFAULT_HOLD_MS = 1000;

/** MediaPipe landmark pairs (left, right). A body part counts as visible if either side is. */
const PART = {
  shoulders: [11, 12],
  wrists: [15, 16],
  hips: [23, 24],
  knees: [25, 26],
  ankles: [27, 28],
} as const;

/** The body parts each Exercise's rep counter needs (mirrors pose-reps' required landmarks). */
const REQUIRED: Record<Exercise, readonly (keyof typeof PART)[]> = {
  squat: ['shoulders', 'hips', 'knees', 'ankles'],
  jumping_jack: ['shoulders', 'wrists', 'hips', 'ankles'],
};

const isVisible = (pose: readonly Landmark[], i: number) => (pose[i]?.visibility ?? 0) >= VISIBLE;

export function framingIssue(pose: readonly Landmark[] | null, exercise: Exercise): FramingIssue | null {
  if (!pose || !pose.some((_, i) => isVisible(pose, i))) return 'no_person';
  const missing = REQUIRED[exercise].some((part) => !PART[part].some((i) => isVisible(pose, i)));
  return missing ? 'step_back' : null;
}

/** Debounces framingIssue so a single bad frame doesn't flash a banner; clears as soon as framing is fine. */
export function createFramingTracker({ holdMs = DEFAULT_HOLD_MS }: { holdMs?: number } = {}) {
  let issueSince: number | null = null;
  let current: FramingIssue | null = null;
  return {
    push(pose: readonly Landmark[] | null, exercise: Exercise, tMs: number): FramingIssue | null {
      const issue = framingIssue(pose, exercise);
      if (!issue) {
        issueSince = null;
        current = null;
      } else {
        issueSince ??= tMs;
        if (tMs - issueSince >= holdMs) current = issue;
      }
      return current;
    },
    reset(): void {
      issueSince = null;
      current = null;
    },
  };
}
