import { boneKey, type Bone } from './poseConnections';

export interface Highlight {
  bones: readonly Bone[];
  joints: readonly number[];
}

/** Which limbs to paint in the Fault color for each Fault id (docs/ux.md section 3). */
const HIGHLIGHTS: Record<string, Highlight> = {
  shallow_depth: { bones: [[23, 25], [24, 26]], joints: [23, 24] },
  knees_caving: { bones: [[23, 25], [24, 26]], joints: [25, 26] },
  torso_lean: { bones: [[11, 23], [12, 24]], joints: [] },
  heels_rising: { bones: [[27, 29], [29, 31], [28, 30], [30, 32]], joints: [29, 30] },
  arms_not_overhead: { bones: [[11, 13], [13, 15], [12, 14], [14, 16]], joints: [15, 16] },
  feet_not_wide: { bones: [[25, 27], [26, 28]], joints: [27, 28] },
};

/** Union of the highlights for the given Fault ids (unknown ids contribute nothing). */
export function highlightFor(faultIds: readonly string[]): Highlight {
  const bones = new Map<string, Bone>();
  const joints = new Set<number>();
  for (const id of faultIds) {
    const h = HIGHLIGHTS[id];
    if (!h) continue;
    h.bones.forEach((bone) => bones.set(boneKey(bone), bone));
    h.joints.forEach((joint) => joints.add(joint));
  }
  return { bones: [...bones.values()], joints: [...joints] };
}

export const FAULT_HOLD_MS = 1200;
export const FAULT_FADE_MS = 400;

/** Opacity of the Fault highlight `elapsedMs` after the Rep event: hold 1.2 s, then fade over 400 ms. */
export function faultOpacity(elapsedMs: number): number {
  if (elapsedMs < 0) return 0;
  if (elapsedMs <= FAULT_HOLD_MS) return 1;
  const fade = (elapsedMs - FAULT_HOLD_MS) / FAULT_FADE_MS;
  return fade >= 1 ? 0 : 1 - fade;
}
