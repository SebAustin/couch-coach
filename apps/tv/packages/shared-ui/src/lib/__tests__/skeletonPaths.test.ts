import {
  allLowVisibility,
  buildSkeletonPaths,
  DEFAULT_SIZES,
  projectionOf,
  skeletonSizes,
  stableFigurePx,
  strokeWidths,
  visibilityHysteresis,
} from '../skeletonPaths';
import { VISIBILITY_OFF, VISIBILITY_ON } from '../poseConnections';
import { KEYPOINT_COUNT } from '../../vendor/protocol';

const pose = (override: Record<number, Partial<{ x: number; y: number; visibility: number }>> = {}) =>
  Array.from({ length: KEYPOINT_COUNT }, (_, i) => ({ x: 0.5, y: i / 40, visibility: 1, ...override[i] }));

const box = (width: number, height: number) => projectionOf({ width, height });
/** Radii of the circle subpaths (`M..a r r ..a r r ..Z`) in a layer, in drawing order. */
const radii = (d: string) => [...d.matchAll(/a([\d.]+) /g)].filter((_, i) => i % 2 === 0).map((m) => Number(m[1]));
const count = (d: string) => d.split('M').length - 1;

describe('buildSkeletonPaths', () => {
  it('mirrors x so the TV acts like a mirror', () => {
    const paths = buildSkeletonPaths(pose({ 11: { x: 0.25, y: 0.5 }, 12: { x: 0.75, y: 0.5 } }), box(100, 200));
    // The bone 11-12 starts at landmark 11: x' = (1 - 0.25) * 100 = 75, y = 0.5 * 200 = 100
    expect(paths.bones).toContain('M75 100L25 100');
  });

  it('applies the auto-frame projection (scale, then offset)', () => {
    const paths = buildSkeletonPaths(pose({ 11: { x: 0.25, y: 0.5 }, 12: { x: 0.75, y: 0.5 } }), { sx: 200, sy: 100, tx: 10, ty: 20 });
    expect(paths.bones).toContain('M160 70L60 70');
  });

  it('moves bones with a low-visibility end into the dim layer', () => {
    const paths = buildSkeletonPaths(pose({ 15: { visibility: 0.2 } }), box(100, 100));
    expect(paths.bonesDim).toContain('M');
    expect(paths.bones).not.toBe(paths.bonesDim);
    // wrist 15 is dim: its dot must not be in the solid joint layer
    expect(paths.jointsDim.length).toBeGreaterThan(0);
  });

  it('draws joints as filled circles, bigger on shoulders, hips and knees', () => {
    const paths = buildSkeletonPaths(pose(), box(1000, 1000));
    expect(count(paths.joints)).toBe(16);
    expect(paths.joints.endsWith('Z')).toBe(true);
    const r = radii(paths.joints); // JOINTS order: 11, 12 (big), 13, 14 (small), ...
    expect(r[0]).toBe(DEFAULT_SIZES.bigJoint);
    expect(r[2]).toBe(DEFAULT_SIZES.joint);
    expect(r[0]!).toBeGreaterThan(r[2]!);
  });

  it('adds a neck from the shoulder midpoint to the nose, dimmed when a shoulder is unseen', () => {
    const neck = { 0: { x: 0.5, y: 0.2 }, 11: { x: 0.4, y: 0.3 }, 12: { x: 0.6, y: 0.3 } };
    expect(buildSkeletonPaths(pose(neck), box(100, 100)).bones).toContain('M50 30L50 20');
    const hidden = buildSkeletonPaths(pose({ ...neck, 12: { ...neck[12], visibility: 0.1 } }), box(100, 100));
    expect(hidden.bones).not.toContain('M50 30L50 20');
    expect(hidden.bonesDim).toContain('M50 30L50 20');
  });

  it('paints only visible Fault bones and joints, ringed 6 px outside the joint outline', () => {
    const fault = { bones: [[23, 25] as const], joints: [25, 26] };
    const clear = buildSkeletonPaths(pose(), box(100, 100), fault);
    expect(count(clear.faultBones)).toBe(1);
    expect(count(clear.faultJointRing)).toBe(2);
    expect(radii(clear.faultJointRing)[0]).toBe(DEFAULT_SIZES.bigJoint + DEFAULT_SIZES.outline / 2 + 6);
    const hidden = buildSkeletonPaths(pose({ 25: { visibility: 0.1 } }), box(100, 100), fault);
    expect(hidden.faultBones).toBe('');
    expect(count(hidden.faultJointRing)).toBe(1);
  });

  it('draws the clean-rep pulse on the four visible leg bones only when asked', () => {
    expect(buildSkeletonPaths(pose(), box(100, 100)).cleanPulse).toBe('');
    const clean = { bones: [], joints: [], clean: true };
    expect(count(buildSkeletonPaths(pose(), box(100, 100), clean).cleanPulse)).toBe(4);
    expect(count(buildSkeletonPaths(pose({ 27: { visibility: 0.1 } }), box(100, 100), clean).cleanPulse)).toBe(3);
  });

  it('draws the head as a filled disc around the nose and hides it when the nose is unseen', () => {
    const shown = buildSkeletonPaths(pose({ 0: { x: 0.5, y: 0.1 } }), box(100, 100), undefined, { ...DEFAULT_SIZES, head: 10 });
    expect(shown.head.startsWith('M40 10')).toBe(true);
    expect(shown.head.endsWith('Z')).toBe(true);
    expect(shown.headVisible).toBe(true);
    expect(buildSkeletonPaths(pose({ 0: { visibility: 0.1 } }), box(100, 100)).headVisible).toBe(false);
  });

  it('uses a visibility mask when given one (hysteresis)', () => {
    const mask = pose().map((_, i) => i !== 15);
    const paths = buildSkeletonPaths(pose(), box(100, 100), undefined, DEFAULT_SIZES, mask);
    expect(count(paths.jointsDim)).toBe(1);
  });

  it('returns empty paths for a malformed pose', () => {
    expect(buildSkeletonPaths([], box(1, 1)).bones).toBe('');
  });
});

describe('visibilityHysteresis', () => {
  const at = (visibility: number) => pose().map((p) => ({ ...p, visibility }));

  it('starts from the plain 0.5 threshold', () => {
    expect(visibilityHysteresis(null, at(0.5))[0]).toBe(true);
    expect(visibilityHysteresis(null, at(0.49))[0]).toBe(false);
  });

  it('turns on at 0.55, off below 0.45, and holds in between', () => {
    const off = visibilityHysteresis(null, at(0.2));
    expect(visibilityHysteresis(off, at(0.54))[0]).toBe(false);
    expect(visibilityHysteresis(off, at(VISIBILITY_ON))[0]).toBe(true);
    const on = visibilityHysteresis(null, at(0.9));
    expect(visibilityHysteresis(on, at(VISIBILITY_OFF))[0]).toBe(true);
    expect(visibilityHysteresis(on, at(0.44))[0]).toBe(false);
  });

  it('starts over when the landmark count changes', () => {
    expect(visibilityHysteresis([true], at(0.2))).toHaveLength(KEYPOINT_COUNT);
  });
});

describe('skeletonSizes', () => {
  it("gives the spec's 14 / 14 / 16 / 36 for a ~760 px figure", () => {
    expect(skeletonSizes(760)).toEqual(DEFAULT_SIZES);
    expect(DEFAULT_SIZES).toMatchObject({ bone: 14, joint: 14, bigJoint: 16, head: 36 });
  });

  it('grows with the figure, clamped, in even px steps', () => {
    const small = skeletonSizes(200);
    const big = skeletonSizes(2000);
    expect(small).toMatchObject({ bone: 10, joint: 10, head: 22 });
    expect(big).toMatchObject({ bone: 20, joint: 16, head: 44 });
    for (let fh = 100; fh <= 2000; fh += 37) {
      const s = skeletonSizes(fh);
      [s.bone, s.joint, s.bigJoint, s.head].forEach((v) => expect(v % 2).toBe(0));
      expect(s.bigJoint).toBeGreaterThan(s.joint);
      expect(s.bone).toBeGreaterThanOrEqual(skeletonSizes(fh - 37).bone);
    }
  });

  it('derives the stroke widths of the bone layers from the bone width', () => {
    expect(strokeWidths(DEFAULT_SIZES)).toEqual({ faultHalo: 36, bonesDim: 14, bones: 14, faultBones: 20, cleanPulse: 20 });
  });
});

describe('stableFigurePx', () => {
  it('ignores changes under 10% (a squat dip) and follows bigger ones', () => {
    expect(stableFigurePx(null, 700)).toBe(700);
    expect(stableFigurePx(700, 660)).toBe(700);
    expect(stableFigurePx(700, 600)).toBe(600);
    expect(stableFigurePx(700, null)).toBe(700);
  });
});

describe('allLowVisibility', () => {
  it('is true only when every landmark is below 0.5', () => {
    expect(allLowVisibility(pose(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i, { visibility: 0.1 }]))))).toBe(true);
    expect(allLowVisibility(pose({ 0: { visibility: 0.9 } }).map((p, i) => (i === 0 ? p : { ...p, visibility: 0.1 })))).toBe(false);
  });
});
