import type { Exercise } from '../vendor/protocol';
import { faultLabel } from './labels';
import type { LiveState } from './liveState';

export interface RecapRow {
  setIndex: number;
  exercise: Exercise;
  reps: number;
  score: number;
  topFault: { id: string; label: string; count: number } | null;
}

export interface Recap {
  rows: readonly RecapRow[];
  setCount: number;
  repCount: number;
  /** Rep-weighted mean Form Score across all Sets; 0 when there are no Reps. */
  score: number;
  /** The last Cue text, or null when the Coach never spoke. */
  coachNote: string | null;
}

function topFaultOf(faults: Record<string, number>): RecapRow['topFault'] {
  let best: RecapRow['topFault'] = null;
  for (const [id, count] of Object.entries(faults)) {
    if (count > 0 && (best === null || count > best.count)) best = { id, label: faultLabel(id), count };
  }
  return best;
}

/**
 * Builds the Recap from what the TV saw (there is no recap endpoint). A Set still in progress when the
 * Session ended is included from its Rep events so no work is lost.
 */
export function buildRecap(state: LiveState): Recap {
  const rows: RecapRow[] = state.sets.map(({ setIndex, set }) => ({
    setIndex,
    exercise: set.exercise,
    reps: set.reps,
    score: Math.round(set.score),
    topFault: topFaultOf(set.faults),
  }));

  if (state.inSet && state.reps > 0 && state.exercise) {
    const faults: Record<string, number> = {};
    // Per-Rep faults are only retained for the last Rep, so the partial Set reports that one.
    for (const id of state.lastRep?.faults ?? []) faults[id] = 1;
    const mean = state.repScores.reduce((a, b) => a + b, 0) / Math.max(1, state.repScores.length);
    rows.push({
      setIndex: state.setIndex,
      exercise: state.exercise,
      reps: state.reps,
      score: Math.round(mean),
      topFault: topFaultOf(faults),
    });
  }

  const repCount = rows.reduce((n, r) => n + r.reps, 0);
  const weighted = rows.reduce((n, r) => n + r.score * r.reps, 0);
  return {
    rows,
    setCount: rows.length,
    repCount,
    score: repCount === 0 ? 0 : Math.round(weighted / repCount),
    coachNote: state.lastCueText,
  };
}
