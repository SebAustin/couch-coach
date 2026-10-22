/**
 * MediaPipe Pose landmark indices used for the skeleton (docs/ux.md section 3).
 * Face landmarks are replaced by one head circle on the nose; hands are dropped;
 * heel and foot-index are kept for the `heels_rising` Fault.
 */
export const NOSE = 0;

export type Bone = readonly [number, number];

export const BONES: readonly Bone[] = [
  [11, 12], // shoulders
  [11, 13], [13, 15], // left arm
  [12, 14], [14, 16], // right arm
  [11, 23], [12, 24], [23, 24], // torso
  [23, 25], [25, 27], // left leg
  [24, 26], [26, 28], // right leg
  [27, 29], [29, 31], [27, 31], // left foot
  [28, 30], [30, 32], [28, 32], // right foot
];

/** Joints drawn as dots. */
export const JOINTS: readonly number[] = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

/** Larger dots on the big joints (spec: r 16 on shoulders, hips, knees). */
export const BIG_JOINTS: ReadonlySet<number> = new Set([11, 12, 23, 24, 25, 26]);

/** The neck is drawn from the midpoint of the shoulders to the nose (it is not a landmark pair). */
export const SHOULDERS: Bone = [11, 12];

/** Leg bones (thighs and shins) that pulse mint after a clean Rep. */
export const CLEAN_BONES: readonly Bone[] = [[23, 25], [25, 27], [24, 26], [26, 28]];

export const boneKey = (bone: Bone): string => `${bone[0]}-${bone[1]}`;

export const VISIBILITY_THRESHOLD = 0.5;
/** Hysteresis around the threshold for drawing: a dim landmark turns solid at 0.55, a solid one dims below 0.45. */
export const VISIBILITY_ON = 0.55;
export const VISIBILITY_OFF = 0.45;
