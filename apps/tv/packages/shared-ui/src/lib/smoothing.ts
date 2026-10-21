import type { Landmark } from '../vendor/protocol';

/** EMA weight of the new sample (docs/ux.md section 3): 0.5 generally, 0.7 on the fast-moving wrists and ankles. */
const ALPHA_DEFAULT = 0.5;
const ALPHA_EXTREMITY = 0.7;
const EXTREMITIES: ReadonlySet<number> = new Set([15, 16, 27, 28]);

/** Exponential moving average per landmark; visibility is taken from the new frame (it is not a position). */
export function smoothPose(previous: readonly Landmark[] | null, next: readonly Landmark[]): Landmark[] {
  if (!previous || previous.length !== next.length) return next.map((p) => ({ ...p }));
  return next.map((p, i) => {
    const q = previous[i]!;
    const a = EXTREMITIES.has(i) ? ALPHA_EXTREMITY : ALPHA_DEFAULT;
    return { x: q.x + (p.x - q.x) * a, y: q.y + (p.y - q.y) * a, visibility: p.visibility };
  });
}

export function lerpPose(a: readonly Landmark[], b: readonly Landmark[], f: number): Landmark[] {
  if (a.length !== b.length) return b.map((p) => ({ ...p }));
  return a.map((p, i) => {
    const q = b[i]!;
    return {
      x: p.x + (q.x - p.x) * f,
      y: p.y + (q.y - p.y) * f,
      visibility: p.visibility + (q.visibility - p.visibility) * f,
    };
  });
}
