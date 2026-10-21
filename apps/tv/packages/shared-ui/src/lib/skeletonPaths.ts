import type { Landmark } from '../vendor/protocol';
import { boneKey, BONES, JOINTS, NOSE, VISIBILITY_THRESHOLD, type Bone } from './poseConnections';

export interface Geometry {
  /** Drawing box in device px. */
  width: number;
  height: number;
}

export interface FaultSelection {
  bones: readonly Bone[];
  joints: readonly number[];
}

/** SVG path data for each layer of the skeleton (docs/ux.md section 3), drawn back to front. */
export interface SkeletonPaths {
  faultHalo: string;
  bonesDim: string;
  bones: string;
  faultBones: string;
  faultJointRing: string;
  jointOutline: string;
  jointsDim: string;
  joints: string;
  /** Head circle centered on the nose. */
  head: string;
  headVisible: boolean;
}

export const EMPTY_PATHS: SkeletonPaths = {
  faultHalo: '',
  bonesDim: '',
  bones: '',
  faultBones: '',
  faultJointRing: '',
  jointOutline: '',
  jointsDim: '',
  joints: '',
  head: '',
  headVisible: false,
};

const f = (n: number) => (Math.round(n * 10) / 10).toString();
/** Round caps draw a dot for a (near) zero-length segment; the tiny offset keeps every renderer happy. */
const dot = (x: number, y: number) => `M${f(x)} ${f(y)}l0.01 0`;
const isVisible = (p: Landmark | undefined) => !!p && p.visibility >= VISIBILITY_THRESHOLD;

/** True when no landmark is confidently visible (the "We can't see you" condition). */
export function allLowVisibility(pose: readonly Landmark[]): boolean {
  return pose.every((p) => p.visibility < VISIBILITY_THRESHOLD);
}

/**
 * Builds the path strings for one pose. x is mirrored (x' = 1 - x) so the TV acts like a mirror.
 * `headRadius` is in device px. Pure: no side effects, safe to call every frame.
 */
export function buildSkeletonPaths(
  pose: readonly Landmark[],
  geometry: Geometry,
  fault: FaultSelection = { bones: [], joints: [] },
  headRadius = 36,
): SkeletonPaths {
  if (pose.length < 33) return EMPTY_PATHS;
  const X = (i: number) => (1 - pose[i]!.x) * geometry.width;
  const Y = (i: number) => pose[i]!.y * geometry.height;
  const faultKeys = new Set(fault.bones.map(boneKey));

  const bones: string[] = [];
  const bonesDim: string[] = [];
  const faultBones: string[] = [];
  for (const bone of BONES) {
    const [a, b] = bone;
    const segment = `M${f(X(a))} ${f(Y(a))}L${f(X(b))} ${f(Y(b))}`;
    const visible = isVisible(pose[a]) && isVisible(pose[b]);
    (visible ? bones : bonesDim).push(segment);
    if (visible && faultKeys.has(boneKey(bone))) faultBones.push(segment);
  }

  const joints: string[] = [];
  const jointsDim: string[] = [];
  for (const j of JOINTS) (isVisible(pose[j]) ? joints : jointsDim).push(dot(X(j), Y(j)));
  const faultRing = fault.joints.filter((j) => isVisible(pose[j])).map((j) => dot(X(j), Y(j)));

  const nose = pose[NOSE]!;
  const cx = X(NOSE);
  const cy = Y(NOSE);
  const r = headRadius;
  const head = `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

  return {
    faultHalo: faultBones.join(''),
    bonesDim: bonesDim.join(''),
    bones: bones.join(''),
    faultBones: faultBones.join(''),
    faultJointRing: faultRing.join(''),
    jointOutline: joints.join(''),
    jointsDim: jointsDim.join(''),
    joints: joints.join(''),
    head,
    headVisible: isVisible(nose),
  };
}

/** Largest box with the given aspect (width / height) that fits inside `maxWidth` x `maxHeight` (fit-contain). */
export function fitContain(aspect: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 9 / 16;
  const byHeight = { width: maxHeight * safeAspect, height: maxHeight };
  if (byHeight.width <= maxWidth) return byHeight;
  return { width: maxWidth, height: maxWidth / safeAspect };
}
