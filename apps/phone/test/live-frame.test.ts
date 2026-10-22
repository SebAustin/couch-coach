import { afterEach, describe, expect, it, vi } from 'vitest';
import { PoseFrame, type Landmark, type Motion } from '@couch-coach/protocol';
import { describeMotion, processPose } from '../src/logic/live-frame';
import { createSetRunner, type CounterLike } from '../src/logic/set-runner';

const pose: Landmark[] = Array.from({ length: 33 }, (_, i) => ({ x: i / 40, y: 0.5, visibility: 0.9 }));
const detected = (t: number) => ({ pose, t, mono: t - 1_000 });

/** A counter whose live state follows the frames it has been fed, and whose 3rd frame completes a rep. */
function steppingCounter() {
  let pushed = 0;
  return {
    push: () => {
      pushed += 1;
      return pushed === 3 ? { index: 0, score: 90, faults: [] } : null;
    },
    state: (): Motion => ({ depth: pushed * 0.2345, phase: pushed >= 2 ? 'active' : 'rest', target: 0.6 }),
  };
}

const runnerWith = (counter: CounterLike<Landmark[]>) =>
  createSetRunner<Landmark[]>({ exercise: 'squat', setIndex: 1, startedAtMs: 0, counter });

describe('processPose (what the controller does with each detected pose)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('feeds the counter first, so the frame carries the motion that includes this very frame', () => {
    const runner = runnerWith(steppingCounter());
    const { frame, rep } = processPose(detected(5_000), runner);
    expect(rep).toBeNull();
    expect(frame.t).toBe(5_000);
    expect(frame.motion).toEqual({ depth: 0.23, phase: 'rest', target: 0.6 });
    expect(processPose(detected(5_040), runner).frame.motion).toEqual({ depth: 0.47, phase: 'active', target: 0.6 });
  });

  it('returns the rep event on the frame that completes a rep, stamped with the wall clock', () => {
    const runner = runnerWith(steppingCounter());
    processPose(detected(5_000), runner);
    processPose(detected(5_040), runner);
    const { frame, rep } = processPose(detected(5_080), runner);
    expect(rep).toEqual({ type: 'rep', exercise: 'squat', index: 1, score: 90, faults: [], t: 5_080 });
    expect(frame.motion?.depth).toBe(0.7);
  });

  it('encodes a frame that passes the wire schema with the motion intact', () => {
    const { frame } = processPose(detected(5_000), runnerWith(steppingCounter()));
    expect(PoseFrame.parse(frame)).toEqual(frame);
  });

  it('sends no motion outside a Set or while paused (no runner)', () => {
    const { frame, rep } = processPose(detected(5_000), null);
    expect(rep).toBeNull();
    expect(frame).not.toHaveProperty('motion');
    expect(frame.k).toHaveLength(99);
  });

  it('sends no motion when the counter has no live state (older pose-reps)', () => {
    const { frame } = processPose(detected(5_000), runnerWith({ push: () => null }));
    expect(frame).not.toHaveProperty('motion');
  });

  it('still sends the frame when the counter rejects it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const runner = runnerWith({
      push: () => {
        throw new RangeError('bad frame');
      },
      state: () => ({ depth: 0.1, phase: 'rest', target: 0.6 }),
    });
    const { frame, rep } = processPose(detected(5_000), runner);
    expect(rep).toBeNull();
    expect(frame.motion).toEqual({ depth: 0.1, phase: 'rest', target: 0.6 });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('describeMotion (debug line)', () => {
  it('shows depth with two decimals and the phase', () => {
    expect(describeMotion({ depth: 0.4234, phase: 'active', target: 0.6 })).toBe('depth 0.42 active');
    expect(describeMotion({ depth: 0, phase: 'calibrating', target: 0.6 })).toBe('depth 0.00 calibrating');
  });
});
