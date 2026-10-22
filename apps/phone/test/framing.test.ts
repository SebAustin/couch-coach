import { describe, expect, it } from 'vitest';
import { canCount } from 'pose-reps';
import type { Exercise, Landmark } from '@couch-coach/protocol';
import { bodySpan, createFramingTracker, framingIssue } from '../src/logic/framing';

const NOSE = 0;
const SHOULDERS = [11, 12];
const ELBOWS = [13, 14];
const WRISTS = [15, 16];
const HIPS = [23, 24];
const KNEES = [25, 26];
const ANKLES = [27, 28];
const ALL = Array.from({ length: 33 }, (_, i) => i);

/** How far below the nose each MediaPipe landmark sits, as a fraction of the nose-to-ankle span. */
function drop(i: number): number {
  if (i <= 10) return 0; // face
  if (i <= 12) return 0.18; // shoulders
  if (i <= 14) return 0.35; // elbows
  if (i <= 22) return 0.5; // wrists and hands
  if (i <= 24) return 0.52; // hips
  if (i <= 26) return 0.76; // knees
  return 1; // ankles, heels, feet
}

/**
 * A person standing facing the camera, nose at `top`, ankles `span` lower (normalized, y down).
 * Only the listed landmark indices are visible.
 */
function standing(visible: readonly number[], { span = 0.8, top = 0.1 } = {}): Landmark[] {
  return ALL.map((i) => ({
    x: 0.5 + (i < 11 ? 0 : i % 2 === 1 ? 0.08 : -0.08),
    y: top + span * drop(i),
    visibility: visible.includes(i) ? 0.9 : 0.1,
  }));
}

const upperBodyOnly = standing([NOSE, ...SHOULDERS, ...ELBOWS]);
const fullBody = standing(ALL);
/** Fully visible but far away: nose to ankles covers 30% of the frame height. */
const farAway = standing(ALL, { span: 0.3, top: 0.35 });
/** Far away and the ankles flicker out: not countable, and the span can't be measured. */
const farNoAnkles = standing(ALL.filter((i) => !ANKLES.includes(i)), { span: 0.3, top: 0.35 });

describe('framingIssue', () => {
  it('asks to step back when the squat legs are out of frame (the bug seen on a real phone)', () => {
    expect(framingIssue(upperBodyOnly, 'squat')).toBe('step_back');
  });

  it('is fine when the whole body is visible and fills the frame', () => {
    expect(framingIssue(fullBody, 'squat')).toBeNull();
    expect(framingIssue(fullBody, 'jumping_jack')).toBeNull();
  });

  it('needs hip, knee and ankle of one side for the squat, but no longer the shoulders', () => {
    expect(framingIssue(standing([NOSE, 23, 25, 27]), 'squat')).toBeNull();
    expect(framingIssue(standing([NOSE, 24, 26, 28]), 'squat')).toBeNull();
  });

  it('does not mix sides for the squat (left hip with a right knee and ankle)', () => {
    expect(framingIssue(standing([NOSE, ...SHOULDERS, 23, 26, 28]), 'squat')).toBe('step_back');
  });

  it('asks to step back when the feet are below the bottom edge, even if MediaPipe reports them visible', () => {
    expect(framingIssue(standing(ALL, { span: 1.2 }), 'squat')).toBe('step_back');
  });

  it('needs the nose, both wrists and both ankles for jumping jacks', () => {
    const noNose = standing([...SHOULDERS, ...WRISTS, ...HIPS, ...KNEES, ...ANKLES]);
    const noWrists = standing([NOSE, ...SHOULDERS, ...HIPS, ...KNEES, ...ANKLES]);
    const oneAnkle = standing([NOSE, ...SHOULDERS, ...WRISTS, ...HIPS, ...KNEES, 27]);
    expect(framingIssue(noNose, 'jumping_jack')).toBe('step_back');
    expect(framingIssue(noWrists, 'jumping_jack')).toBe('step_back');
    expect(framingIssue(oneAnkle, 'jumping_jack')).toBe('step_back');
  });

  it('reports no person when nothing was detected', () => {
    expect(framingIssue(null, 'squat')).toBe('no_person');
    expect(framingIssue(standing([]), 'squat')).toBe('no_person');
  });

  it('flags a countable but small body as move_closer (per frame, before any debounce)', () => {
    expect(framingIssue(farAway, 'squat')).toBe('move_closer');
    expect(framingIssue(farAway, 'jumping_jack')).toBe('move_closer');
  });

  it('says step_back exactly when pose-reps cannot count the pose', () => {
    // Deterministic pseudo-random visibility subsets of the key landmarks.
    const keys = [NOSE, ...SHOULDERS, ...WRISTS, ...HIPS, ...KNEES, ...ANKLES];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 300; n += 1) {
      const pose = standing(keys.filter(() => rand() < 0.7), { span: 0.5 + rand() * 0.8, top: rand() * 0.2 });
      for (const exercise of ['squat', 'jumping_jack'] as Exercise[]) {
        const issue = framingIssue(pose, exercise);
        if (issue === 'no_person') continue;
        expect(issue === 'step_back').toBe(!canCount(exercise, pose));
      }
    }
  });
});

describe('bodySpan', () => {
  it('measures from the highest of nose, shoulders and hips down to the lowest ankle', () => {
    expect(bodySpan(fullBody)).toBeCloseTo(0.8);
    // Nose hidden: the shoulders are the top.
    expect(bodySpan(standing([...SHOULDERS, ...ANKLES]))).toBeCloseTo(0.8 * (1 - 0.18));
  });

  it('is null when no ankle or no upper-body landmark is visible', () => {
    expect(bodySpan(upperBodyOnly)).toBeNull();
    expect(bodySpan(standing([...KNEES, ...ANKLES]))).toBeNull();
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

  it('asks to come closer once the body has looked small for 2 s, and clears as soon as it is not', () => {
    const tracker = createFramingTracker();
    expect(tracker.push(farAway, 'squat', 0)).toBeNull();
    expect(tracker.push(farAway, 'squat', 1999)).toBeNull();
    expect(tracker.push(farAway, 'squat', 2000)).toBe('move_closer');
    expect(tracker.push(fullBody, 'squat', 2100)).toBeNull();
  });

  it('restarts the 2 s when one frame shows the body big enough', () => {
    const tracker = createFramingTracker();
    tracker.push(farAway, 'squat', 0);
    tracker.push(fullBody, 'squat', 1500);
    expect(tracker.push(farAway, 'squat', 1600)).toBeNull();
    expect(tracker.push(farAway, 'squat', 3599)).toBeNull();
    expect(tracker.push(farAway, 'squat', 3600)).toBe('move_closer');
  });

  it('still asks to come closer when the far-away ankles flicker in and out', () => {
    const tracker = createFramingTracker();
    let last: string | null = null;
    for (let t = 0; t <= 2400; t += 100) last = tracker.push(t % 200 === 0 ? farAway : farNoAnkles, 'squat', t);
    expect(last).toBe('move_closer');
  });

  it('keeps the come-closer hint through a brief detection dropout', () => {
    const tracker = createFramingTracker();
    tracker.push(farAway, 'jumping_jack', 0);
    expect(tracker.push(farAway, 'jumping_jack', 2000)).toBe('move_closer');
    expect(tracker.push(null, 'jumping_jack', 2100)).toBe('move_closer');
    expect(tracker.push(farAway, 'jumping_jack', 2200)).toBe('move_closer');
  });

  it('switches to step back once counting has been impossible for the hold time', () => {
    const tracker = createFramingTracker({ holdMs: 1000 });
    tracker.push(farAway, 'squat', 0);
    expect(tracker.push(farAway, 'squat', 2000)).toBe('move_closer');
    expect(tracker.push(upperBodyOnly, 'squat', 2100)).toBe('move_closer');
    expect(tracker.push(upperBodyOnly, 'squat', 3100)).toBe('step_back');
  });

  it('forgets everything on reset', () => {
    const tracker = createFramingTracker();
    tracker.push(farAway, 'squat', 0);
    tracker.push(farAway, 'squat', 2000);
    tracker.reset();
    expect(tracker.push(farAway, 'squat', 2100)).toBeNull();
    expect(tracker.push(farAway, 'squat', 4100)).toBe('move_closer');
  });
});
