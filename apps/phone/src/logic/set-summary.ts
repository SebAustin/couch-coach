import type { Exercise, SetSummary } from '@couch-coach/protocol';

/** The slice of a pose-reps `RepResult` the summary needs. */
export interface RepLike {
  score: number;
  faults: readonly string[];
}

export interface SummarizeInput {
  exercise: Exercise;
  reps: readonly RepLike[];
  startedAtMs: number;
  endedAtMs: number;
}

const clampScore = (n: number) => Math.min(100, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Aggregate a Set: rep count, mean Form Score (1 decimal), fault counts and duration. */
export function summarizeSet({ exercise, reps, startedAtMs, endedAtMs }: SummarizeInput): SetSummary {
  const faults: Record<string, number> = {};
  for (const rep of reps) {
    for (const id of rep.faults) faults[id] = (faults[id] ?? 0) + 1;
  }
  const total = reps.reduce((sum, r) => sum + r.score, 0);
  return {
    exercise,
    reps: reps.length,
    score: reps.length === 0 ? 0 : clampScore(round1(total / reps.length)),
    faults,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
  };
}
