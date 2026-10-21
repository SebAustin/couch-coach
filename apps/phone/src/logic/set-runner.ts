import type { Exercise, PhoneEvent, SetSummary } from '@couch-coach/protocol';
import { summarizeSet, type RepLike } from './set-summary';

type RepEvent = Extract<PhoneEvent, { type: 'rep' }>;

/** The slice of pose-reps' `Counter` the runner uses (keeps the runner testable without MediaPipe). */
export interface CounterLike<P> {
  push(pose: P, tMs: number): (RepLike & { index: number }) | null;
}

export interface SetRunner<P> {
  readonly exercise: Exercise;
  readonly setIndex: number;
  /**
   * Feed one frame. `tMs` is the counter's clock (monotonic); `wireT` stamps the `rep` event
   * (wall clock, defaults to `tMs`). Returns the `rep` event when a rep just completed.
   */
  push(pose: P, tMs: number, wireT?: number): RepEvent | null;
  repCount(): number;
  /** Running Set Form Score (mean of reps), or null before the first rep. */
  score(): number | null;
  /** Timestamp of the last rep (or the start), for the idle timer. */
  lastRepAtMs(): number;
  summary(endedAtMs: number): SetSummary;
}

/** Tracks one Set: runs the counter, collects reps and builds the wire events. */
export function createSetRunner<P>(opts: {
  exercise: Exercise;
  setIndex: number;
  counter: CounterLike<P>;
  startedAtMs: number;
}): SetRunner<P> {
  const reps: RepLike[] = [];
  let lastRepAt = opts.startedAtMs;
  return {
    exercise: opts.exercise,
    setIndex: opts.setIndex,
    push(pose, tMs, wireT = tMs) {
      const result = opts.counter.push(pose, tMs);
      if (!result) return null;
      reps.push({ score: result.score, faults: [...result.faults] });
      lastRepAt = tMs;
      return {
        type: 'rep',
        exercise: opts.exercise,
        index: reps.length,
        score: Math.min(100, Math.max(0, result.score)),
        faults: [...result.faults],
        t: wireT,
      };
    },
    repCount: () => reps.length,
    score: () => (reps.length === 0 ? null : summarizeSet({ ...opts, reps, endedAtMs: opts.startedAtMs }).score),
    lastRepAtMs: () => lastRepAt,
    summary: (endedAtMs) => summarizeSet({ exercise: opts.exercise, reps, startedAtMs: opts.startedAtMs, endedAtMs }),
  };
}
