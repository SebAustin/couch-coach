import { formatCountdown, lastSeenLabel, newestSeenIndex } from '../format';
import { faultLabel, exerciseLabel } from '../labels';
import { faultOpacity, highlightFor } from '../faultHighlight';
import { smoothPose, lerpPose } from '../smoothing';

describe('format', () => {
  it('formats the pairing countdown as m:ss and never goes negative', () => {
    expect(formatCountdown(108_000)).toBe('1:48');
    expect(formatCountdown(59_001)).toBe('1:00');
    expect(formatCountdown(5_000)).toBe('0:05');
    expect(formatCountdown(-10)).toBe('0:00');
  });

  it('describes when a Member was last seen', () => {
    const now = 10 * 86_400_000;
    expect(lastSeenLabel(undefined, now)).toBe('New here');
    expect(lastSeenLabel(now - 1000, now)).toBe('Last seen just now');
    expect(lastSeenLabel(now - 3_600_000, now)).toBe('Last seen today');
    expect(lastSeenLabel(now - 86_400_000 * 1.2, now)).toBe('Last seen yesterday');
    expect(lastSeenLabel(now - 86_400_000 * 3, now)).toBe('Last seen 3 days ago');
  });

  it('finds the most recently seen Member', () => {
    expect(newestSeenIndex([{}, { lastSeenAt: 5 }, { lastSeenAt: 9 }, { lastSeenAt: 2 }])).toBe(2);
    expect(newestSeenIndex([{}, {}])).toBe(-1);
  });
});

describe('labels', () => {
  it('names Faults and Exercises, degrading gracefully for unknown ids', () => {
    expect(faultLabel('knees_caving')).toBe('Knees caving');
    expect(faultLabel('new_fault_id')).toBe('New fault id');
    expect(exerciseLabel('jumping_jack')).toBe('Jumping jack');
  });
});

describe('faultHighlight', () => {
  it('maps Faults to limbs and merges duplicates', () => {
    const h = highlightFor(['shallow_depth', 'knees_caving']);
    expect(h.bones).toHaveLength(2);
    expect([...h.joints].sort()).toEqual([23, 24, 25, 26]);
    expect(highlightFor(['unknown'])).toEqual({ bones: [], joints: [] });
  });

  it('holds for 1.2 s then fades out over 400 ms', () => {
    expect(faultOpacity(0)).toBe(1);
    expect(faultOpacity(1200)).toBe(1);
    expect(faultOpacity(1400)).toBeCloseTo(0.5, 5);
    expect(faultOpacity(1600)).toBe(0);
    expect(faultOpacity(-5)).toBe(0);
  });
});

describe('smoothing', () => {
  const p = (x: number) => Array.from({ length: 33 }, () => ({ x, y: x, visibility: 1 }));
  it('passes the first pose through and moves halfway on the next', () => {
    expect(smoothPose(null, p(1))[0]!.x).toBe(1);
    expect(smoothPose(p(0), p(1))[0]!.x).toBe(0.5);
  });
  it('lerps linearly', () => {
    expect(lerpPose(p(0), p(1), 0.25)[3]!.x).toBeCloseTo(0.25, 5);
  });
});

import { expiresAtMs, expiryLabel } from '../format';
describe('expiresAtMs', () => {
  it('accepts epoch seconds or milliseconds', () => {
    expect(expiresAtMs(1_800_000_000)).toBe(1_800_000_000_000);
    expect(expiresAtMs(1_800_000_000_000)).toBe(1_800_000_000_000);
  });
});

describe('expiryLabel', () => {
  const MIN = 60_000;
  it('says how long the code is valid when there is plenty of time', () => {
    expect(expiryLabel(119 * MIN + 54_000)).toBe('Code valid for 2 hours');
    expect(expiryLabel(90 * MIN)).toBe('Code valid for 2 hours');
    expect(expiryLabel(60 * MIN * 5)).toBe('Code valid for 5 hours');
  });
  it('uses minutes between 10 and 90 minutes', () => {
    expect(expiryLabel(75 * MIN)).toBe('Code valid for 75 minutes');
    expect(expiryLabel(10 * MIN + 1000)).toBe('Code valid for 10 minutes');
  });
  it('switches to m:ss at 10 minutes and under', () => {
    expect(expiryLabel(10 * MIN)).toBe('Code expires in 10:00');
    expect(expiryLabel(9 * MIN + 58_000)).toBe('Code expires in 9:58');
    expect(expiryLabel(5_000)).toBe('Code expires in 0:05');
  });
});
