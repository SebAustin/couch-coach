import type { Landmark } from '../vendor/protocol';
import {
  BIG_JOINTS,
  boneKey,
  BONES,
  CLEAN_BONES,
  JOINTS,
  NOSE,
  SHOULDERS,
  VISIBILITY_OFF,
  VISIBILITY_ON,
  VISIBILITY_THRESHOLD,
  type Bone,
} from './poseConnections';

/** Landmark -> drawing px. x is mirrored so the TV acts like a mirror: X = (1 - x) * sx + tx, Y = y * sy + ty. */
export interface Projection {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

/** The plain fit of the whole camera frame into a `width` x `height` box (no auto-framing). */
export function projectionOf(box: { width: number; height: number }): Projection {
  return { sx: box.width, sy: box.height, tx: 0, ty: 0 };
}

/** What to emphasise this frame: the Fault bones and joints in rose, or the clean-Rep legs in mint. */
export interface Emphasis {
  bones: readonly Bone[];
  joints: readonly number[];
  clean?: boolean;
}

export const NO_EMPHASIS: Emphasis = { bones: [], joints: [] };

/** Skeleton sizes in px: bone stroke width and circle radii. `skeletonSizes` gives them in design px. */
export interface SkeletonSizes {
  bone: number;
  joint: number;
  /** Shoulders, hips and knees. */
  bigJoint: number;
  head: number;
  /** `stage`-coloured stroke around each joint, centred on its circle. */
  outline: number;
}

/** SVG path data for each layer of the skeleton (docs/ux.md section 3), drawn back to front. */
export interface SkeletonPaths {
  faultHalo: string;
  bonesDim: string;
  bones: string;
  faultBones: string;
  /** Mint legs after a clean Rep. */
  cleanPulse: string;
  /** Rose discs behind the Fault joints, showing as a ring outside their outline. */
  faultJointRing: string;
  jointsDim: string;
  /** Filled circles; the outline is the same path's stroke. */
  joints: string;
  /** Filled disc centred on the nose. */
  head: string;
  headVisible: boolean;
}

export type StrokedLayer = 'faultHalo' | 'bonesDim' | 'bones' | 'faultBones' | 'cleanPulse';

export const EMPTY_PATHS: SkeletonPaths = {
  faultHalo: '',
  bonesDim: '',
  bones: '',
  faultBones: '',
  cleanPulse: '',
  faultJointRing: '',
  jointsDim: '',
  joints: '',
  head: '',
  headVisible: false,
};

/** Visible rose ring outside a Fault joint's outline (docs/ux.md: "an extra 6 px outer ring"). */
const FAULT_RING_PX = 6;
const OUTLINE_PX = 4;
/** At a 14 px bone: Fault bone 20, halo 36, clean pulse 20. */
const FAULT_BONE_EXTRA = 6;
const FAULT_HALO_EXTRA = 22;
const CLEAN_EXTRA = 6;
/** The figure height the spec's 14 / 14 / 16 / 36 sizes were drawn for (design px). */
export const DEFAULT_FIGURE_PX = 760;
/** Size changes smaller than this fraction of the figure (a squat dip) keep the current sizes. */
const FIGURE_HYSTERESIS = 0.1;

const f = (n: number) => (Math.round(n * 10) / 10).toString();
const isVisible = (p: Landmark | undefined) => !!p && p.visibility >= VISIBILITY_THRESHOLD;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Even px: sizes move in 2 px steps, so stroke widths are only rewritten when the step changes. */
const evenPx = (n: number) => 2 * Math.round(n / 2);

/** Closed circle subpath (two arcs), so many circles fit in one filled path. */
function circle(cx: number, cy: number, r: number): string {
  const rr = Math.round(r * 10) / 10;
  return `M${f(cx - rr)} ${f(cy)}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0Z`;
}

/** True when no landmark is confidently visible (the "We can't see you" condition). */
export function allLowVisibility(pose: readonly Landmark[]): boolean {
  return pose.every((p) => p.visibility < VISIBILITY_THRESHOLD);
}

/**
 * Which landmarks to draw solid, with hysteresis so a value hovering around 0.5 does not flicker between the solid
 * and dim layers: a dim landmark turns solid at 0.55, a solid one dims below 0.45. `prev` null starts at 0.5.
 */
export function visibilityHysteresis(prev: readonly boolean[] | null, pose: readonly Landmark[]): boolean[] {
  if (!prev || prev.length !== pose.length) return pose.map((p) => p.visibility >= VISIBILITY_THRESHOLD);
  return pose.map((p, i) => p.visibility >= (prev[i] ? VISIBILITY_OFF : VISIBILITY_ON));
}

/**
 * Sizes for a figure `figurePx` design px tall (head to feet on screen), in even design px: bones 0.0185 of it
 * (10-20), joints r 0.0185 (9-16), big joints r 0.021 (always above the joints), head r 0.047 (22-44).
 */
export function skeletonSizes(figurePx: number): SkeletonSizes {
  const fh = Number.isFinite(figurePx) ? figurePx : DEFAULT_FIGURE_PX;
  const sized = (ratio: number, lo: number, hi: number) => evenPx(clamp(ratio * fh, lo, hi));
  const joint = sized(0.0185, 9, 16);
  return {
    bone: sized(0.0185, 10, 20),
    joint,
    bigJoint: Math.max(sized(0.021, 10, 20), joint + 2),
    head: sized(0.047, 22, 44),
    outline: OUTLINE_PX,
  };
}

export const DEFAULT_SIZES: SkeletonSizes = skeletonSizes(DEFAULT_FIGURE_PX);

/** Stroke width of each bone layer for these sizes. */
export function strokeWidths(sizes: SkeletonSizes): Record<StrokedLayer, number> {
  return {
    faultHalo: sizes.bone + FAULT_HALO_EXTRA,
    bonesDim: sizes.bone,
    bones: sizes.bone,
    faultBones: sizes.bone + FAULT_BONE_EXTRA,
    cleanPulse: sizes.bone + CLEAN_EXTRA,
  };
}

/** The figure height to size the skeleton for: keeps `prev` through changes under 10% (and while nobody is tracked). */
export function stableFigurePx(prev: number | null, next: number | null): number | null {
  if (next === null) return prev;
  if (prev === null) return next;
  return Math.abs(next - prev) > FIGURE_HYSTERESIS * prev ? next : prev;
}

/**
 * Builds the path strings for one pose through `projection`. Sizes are in the projection's px. `visible` (from
 * `visibilityHysteresis`) overrides the plain 0.5 threshold. Pure: no side effects, safe to call every frame.
 */
export function buildSkeletonPaths(
  pose: readonly Landmark[],
  projection: Projection,
  emphasis: Emphasis = NO_EMPHASIS,
  sizes: SkeletonSizes = DEFAULT_SIZES,
  visible?: readonly boolean[],
): SkeletonPaths {
  if (pose.length < 33) return EMPTY_PATHS;
  const { sx, sy, tx, ty } = projection;
  const X = (i: number) => (1 - pose[i]!.x) * sx + tx;
  const Y = (i: number) => pose[i]!.y * sy + ty;
  const seen =
    visible && visible.length === pose.length ? (i: number) => visible[i] === true : (i: number) => isVisible(pose[i]);
  const segment = ([a, b]: Bone) => `M${f(X(a))} ${f(Y(a))}L${f(X(b))} ${f(Y(b))}`;
  const faultKeys = new Set(emphasis.bones.map(boneKey));

  const bones: string[] = [];
  const bonesDim: string[] = [];
  const faultBones: string[] = [];
  for (const bone of BONES) {
    const visibleBone = seen(bone[0]) && seen(bone[1]);
    (visibleBone ? bones : bonesDim).push(segment(bone));
    if (visibleBone && faultKeys.has(boneKey(bone))) faultBones.push(segment(bone));
  }
  const [ls, rs] = SHOULDERS;
  const neck = `M${f((X(ls) + X(rs)) / 2)} ${f((Y(ls) + Y(rs)) / 2)}L${f(X(NOSE))} ${f(Y(NOSE))}`;
  (seen(ls) && seen(rs) && seen(NOSE) ? bones : bonesDim).push(neck);

  const cleanPulse = emphasis.clean ? CLEAN_BONES.filter(([a, b]) => seen(a) && seen(b)).map(segment) : [];

  const radius = (j: number) => (BIG_JOINTS.has(j) ? sizes.bigJoint : sizes.joint);
  const joints: string[] = [];
  const jointsDim: string[] = [];
  for (const j of JOINTS) (seen(j) ? joints : jointsDim).push(circle(X(j), Y(j), radius(j)));
  const ringExtra = sizes.outline / 2 + FAULT_RING_PX;
  const faultRing = emphasis.joints.filter(seen).map((j) => circle(X(j), Y(j), radius(j) + ringExtra));

  return {
    faultHalo: faultBones.join(''),
    bonesDim: bonesDim.join(''),
    bones: bones.join(''),
    faultBones: faultBones.join(''),
    cleanPulse: cleanPulse.join(''),
    faultJointRing: faultRing.join(''),
    jointsDim: jointsDim.join(''),
    joints: joints.join(''),
    head: circle(X(NOSE), Y(NOSE), sizes.head),
    headVisible: seen(NOSE),
  };
}
