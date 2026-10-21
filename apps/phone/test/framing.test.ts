import { describe, expect, it } from 'vitest';
import type { Landmark } from '@couch-coach/protocol';
import { createFramingTracker, framingIssue } from '../src/logic/framing';

const HIPS = [23, 24];
const KNEES = [25, 26];
const ANKLES = [27, 28];
const WRISTS = [15, 16];

/** A 33-point pose where only the listed landmark indices are visible. */
function poseWith(visible: readonly number[]): Landmark[] {
  return Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.5, visibility: visible.includes(i) ? 0.9 : 0.1 }));
}
const upperBodyOnly = poseWith([0, 11, 12, 13, 14]);
const fullBody = poseWith([0, 11, 12, 13, 14, ...WRISTS, ...HIPS, ...KNEES, ...ANKLES]);

describe('framingIssue', () => {
  it('asks to step back when the squat legs are out of frame (the bug seen on a real phone)', () => {
    expect(framingIssue(upperBodyOnly, 'squat')).toBe('step_back');
  });

  it('is fine when the whole body is visible', () => {
    expect(framingIssue(fullBody, 'squat')).toBeNull();
    expect(framingIssue(fullBody, 'jumping_jack')).toBeNull();
  });

  it('accepts one visible side for the squat', () => {
    expect(framingIssue(poseWith([11, 23, 25, 27]), 'squat')).toBeNull();
  });

  it('needs the wrists for jumping jacks', () => {
    expect(framingIssue(poseWith([11, 12, ...HIPS, ...KNEES, ...ANKLES]), 'jumping_jack')).toBe('step_back');
  });

  it('reports no person when nothing was detected', () => {
    expect(framingIssue(null, 'squat')).toBe('no_person');
    expect(framingIssue(poseWith([]), 'squat')).toBe('no_person');
  });
});

describe('framing tracker', () => {
  it('only reports an issue that has lasted the hold time, and clears at once', () => {
    const tracker = createFramingTracker({ holdMs: 1000 });
    expect(tracker.push(upperBodyOnly, 'squat', 0)).toBeNull();
    expect(tracker.push(upperBodyOnly, 'squat', 900)).toBeNull();
    expect(tracker.push(upperBodyOnly, 'squat', 1000)).toBe('step_back');
    expect(tracker.push(fullBody, 'squat', 1100)).toBeNull();
  });

  it('ignores a brief dropout shorter than the hold time', () => {
    const tracker = createFramingTracker({ holdMs: 1000 });
    tracker.push(fullBody, 'squat', 0);
    expect(tracker.push(upperBodyOnly, 'squat', 100)).toBeNull();
    expect(tracker.push(fullBody, 'squat', 600)).toBeNull();
    expect(tracker.push(upperBodyOnly, 'squat', 700)).toBeNull();
  });
});
