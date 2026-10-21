import { allLowVisibility, buildSkeletonPaths, fitContain } from '../skeletonPaths';
import { KEYPOINT_COUNT } from '../../vendor/protocol';

const pose = (override: Record<number, Partial<{ x: number; y: number; visibility: number }>> = {}) =>
  Array.from({ length: KEYPOINT_COUNT }, (_, i) => ({ x: 0.5, y: i / 40, visibility: 1, ...override[i] }));

describe('buildSkeletonPaths', () => {
  it('mirrors x so the TV acts like a mirror', () => {
    const paths = buildSkeletonPaths(pose({ 11: { x: 0.25, y: 0.5 }, 12: { x: 0.75, y: 0.5 } }), { width: 100, height: 200 });
    // The bone 11-12 starts at landmark 11: x' = (1 - 0.25) * 100 = 75, y = 0.5 * 200 = 100
    expect(paths.bones).toContain('M75 100L25 100');
  });

  it('moves bones with a low-visibility end into the dim layer', () => {
    const paths = buildSkeletonPaths(pose({ 15: { visibility: 0.2 } }), { width: 100, height: 100 });
    expect(paths.bonesDim).toContain('M');
    expect(paths.bones).not.toBe(paths.bonesDim);
    // wrist 15 is dim: its dot must not be in the solid joint layer
    expect(paths.jointsDim.length).toBeGreaterThan(0);
  });

  it('paints only visible Fault bones and joints', () => {
    const fault = { bones: [[23, 25] as const], joints: [25, 26] };
    const clear = buildSkeletonPaths(pose(), { width: 100, height: 100 }, fault);
    expect(clear.faultBones.split('M').length - 1).toBe(1);
    expect(clear.faultJointRing.split('M').length - 1).toBe(2);
    const hidden = buildSkeletonPaths(pose({ 25: { visibility: 0.1 } }), { width: 100, height: 100 }, fault);
    expect(hidden.faultBones).toBe('');
    expect(hidden.faultJointRing.split('M').length - 1).toBe(1);
  });

  it('draws the head around the nose and hides it when the nose is unseen', () => {
    const shown = buildSkeletonPaths(pose({ 0: { x: 0.5, y: 0.1 } }), { width: 100, height: 100 }, undefined, 10);
    expect(shown.head.startsWith('M40 10')).toBe(true);
    expect(shown.headVisible).toBe(true);
    expect(buildSkeletonPaths(pose({ 0: { visibility: 0.1 } }), { width: 100, height: 100 }).headVisible).toBe(false);
  });

  it('returns empty paths for a malformed pose', () => {
    expect(buildSkeletonPaths([], { width: 1, height: 1 }).bones).toBe('');
  });
});

describe('allLowVisibility', () => {
  it('is true only when every landmark is below 0.5', () => {
    expect(allLowVisibility(pose(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [i, { visibility: 0.1 }]))))).toBe(true);
    expect(allLowVisibility(pose({ 0: { visibility: 0.9 } }).map((p, i) => (i === 0 ? p : { ...p, visibility: 0.1 })))).toBe(false);
  });
});

describe('fitContain', () => {
  it('fits a 9:16 box into the 1200x972 stage region by height', () => {
    const box = fitContain(9 / 16, 1200, 972);
    expect(box.height).toBe(972);
    expect(box.width).toBeCloseTo(546.75, 2);
  });
  it('fits a wide frame by width', () => {
    const box = fitContain(16 / 9, 1200, 972);
    expect(box.width).toBe(1200);
    expect(box.height).toBeCloseTo(675, 1);
  });
  it('falls back to portrait for a bad aspect', () => {
    expect(fitContain(0, 1200, 972).height).toBe(972);
  });
});
