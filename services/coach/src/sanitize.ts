import type { SetSummary } from '@couch-coach/protocol';

/** The closed set of Fault ids (docs/CONTRACTS.md). Anything else is client-supplied free text. */
export const KNOWN_FAULT_IDS: ReadonlySet<string> = new Set([
  'shallow_depth',
  'knees_caving',
  'torso_lean',
  'heels_rising',
  'arms_not_overhead',
  'feet_not_wide',
]);

const MAX_REPS = 500;
const MAX_DURATION_MS = 60 * 60 * 1000;
const MAX_FAULT_COUNT = 1_000;

export type SanitizedSet = { ok: true; set: SetSummary; dropped: number } | { ok: false; reason: string };

/**
 * Server-side validation on top of the wire schema: the schema accepts any string as a fault key, which
 * would let a caller store arbitrary text in a Member's coach memory. Unknown keys are dropped (not
 * rejected) so a newer client with an extra fault id still gets a Cue.
 */
export function sanitizeSet(set: SetSummary): SanitizedSet {
  if (set.reps > MAX_REPS) return { ok: false, reason: 'reps out of range' };
  if (set.durationMs > MAX_DURATION_MS) return { ok: false, reason: 'duration out of range' };

  const faults: Record<string, number> = {};
  let dropped = 0;
  for (const [id, count] of Object.entries(set.faults)) {
    if (!KNOWN_FAULT_IDS.has(id)) {
      dropped += 1;
    } else if (count > MAX_FAULT_COUNT) {
      return { ok: false, reason: 'fault count out of range' };
    } else {
      faults[id] = count;
    }
  }
  return { ok: true, set: { ...set, faults }, dropped };
}
