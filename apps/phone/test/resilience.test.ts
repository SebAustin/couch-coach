import { describe, expect, it } from 'vitest';
import { openWithFallback } from '../src/logic/camera-fallback';
import { createPresenceTracker } from '../src/logic/presence';
import { FALLBACK_ASPECT, resolveAspect } from '../src/logic/aspect';
import { createSetRunner } from '../src/logic/set-runner';

describe('presence tracker', () => {
  it('reports no person before any pose has been seen', () => {
    expect(createPresenceTracker().person(1_000)).toBe(false);
  });

  it('reports a person while poses keep arriving and drops it after the window', () => {
    const tracker = createPresenceTracker({ windowMs: 1_500 });
    tracker.seen(10_000);
    expect(tracker.person(11_499)).toBe(true);
    expect(tracker.person(11_500)).toBe(false);
  });

  it('comes back as soon as a new pose is seen', () => {
    const tracker = createPresenceTracker({ windowMs: 1_000 });
    tracker.seen(0);
    expect(tracker.person(5_000)).toBe(false);
    tracker.seen(5_000);
    expect(tracker.person(5_100)).toBe(true);
  });
});

describe('resolveAspect', () => {
  const dims = (...sizes: [number, number][]) => {
    let i = 0;
    return () => {
      const [w, h] = sizes[Math.min(i++, sizes.length - 1)]!;
      return { width: w, height: h };
    };
  };

  it('uses the video size when it is already known, without waiting', async () => {
    let waits = 0;
    const aspect = await resolveAspect(dims([720, 1280]), async () => void waits++);
    expect(aspect).toBeCloseTo(0.5625);
    expect(waits).toBe(0);
  });

  it('waits and retries once when the size is not known yet', async () => {
    let waits = 0;
    const aspect = await resolveAspect(dims([0, 0], [480, 640]), async () => void waits++);
    expect(aspect).toBeCloseTo(0.75);
    expect(waits).toBe(1);
  });

  it('falls back to 9/16 explicitly after one failed retry (never NaN)', async () => {
    let waits = 0;
    const aspect = await resolveAspect(dims([0, 0]), async () => void waits++);
    expect(aspect).toBe(FALLBACK_ASPECT);
    expect(FALLBACK_ASPECT).toBe(9 / 16);
    expect(waits).toBe(1);
  });

  it.each([[NaN, 100], [100, 0], [Infinity, 100]])('treats %s x %s as unknown', async (w, h) => {
    expect(await resolveAspect(() => ({ width: w, height: h }), async () => {})).toBe(FALLBACK_ASPECT);
  });
});

describe('openWithFallback', () => {
  type R = { ok: true; id: string } | { ok: false; reason: string };
  const opener = (results: Record<string, R>, calls: string[] = []) => async (facing: string) => {
    calls.push(facing);
    return results[facing]!;
  };

  it('returns the first facing that opens and does not touch the others', async () => {
    const calls: string[] = [];
    const out = await openWithFallback(['environment', 'user'], opener({ environment: { ok: true, id: 'back' }, user: { ok: true, id: 'front' } }, calls));
    expect(out).toMatchObject({ ok: true, facing: 'environment', usedFallback: false });
    expect(calls).toEqual(['environment']);
  });

  it('falls back to the previous camera when the new one fails', async () => {
    const out = await openWithFallback(['environment', 'user'], opener({ environment: { ok: false, reason: 'x' }, user: { ok: true, id: 'front' } }));
    expect(out).toMatchObject({ ok: true, facing: 'user', usedFallback: true });
  });

  it('reports failure with the last result when every camera fails', async () => {
    const out = await openWithFallback(['environment', 'user'], opener({ environment: { ok: false, reason: 'a' }, user: { ok: false, reason: 'b' } }));
    expect(out).toEqual({ ok: false, result: { ok: false, reason: 'b' } });
  });
});

describe('set runner clocks', () => {
  it('feeds the counter the monotonic clock but stamps the wire event with the wall clock', () => {
    const seen: number[] = [];
    const runner = createSetRunner({
      exercise: 'squat',
      setIndex: 1,
      startedAtMs: 0,
      counter: {
        push: (_pose: unknown, tMs: number) => {
          seen.push(tMs);
          return { index: 0, score: 90, faults: [] };
        },
      },
    });
    const rep = runner.push({}, 5_000, 1_700_000_000_123);
    expect(seen).toEqual([5_000]);
    expect(rep?.t).toBe(1_700_000_000_123);
  });
});
