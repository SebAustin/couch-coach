import { describe, expect, it } from 'vitest';
import type { PoseFrame } from '@couch-coach/protocol';
import { createFrameBatcher } from '../src/logic/frame-batcher';
import { createFrameRing } from '../src/logic/frame-ring';
import { idleStatus } from '../src/logic/idle';
import { parseSessionParams } from '../src/logic/session-params';
import { createSetRunner } from '../src/logic/set-runner';
import { summarizeSet } from '../src/logic/set-summary';

const frame = (t: number): PoseFrame => ({ t, k: new Array<number>(99).fill(0) });

describe('frame batcher', () => {
  it('emits a PoseBatch every 3 accepted frames', () => {
    const batches: PoseFrame[][] = [];
    const batcher = createFrameBatcher({ onBatch: (b) => batches.push(b) });
    for (let i = 0; i < 7; i++) batcher.add(frame(i * 66));
    expect(batches.map((b) => b.map((f) => f.t))).toEqual([
      [0, 66, 132],
      [198, 264, 330],
    ]);
  });

  it('throttles a 30 fps camera down to about 15 fps', () => {
    const accepted: number[] = [];
    const batcher = createFrameBatcher({ onBatch: (b) => accepted.push(...b.map((f) => f.t)) });
    for (let t = 0; t < 1000; t += 33) batcher.add(frame(t));
    batcher.flush();
    const fps = accepted.length; // frames accepted in ~1 s
    expect(fps).toBeGreaterThanOrEqual(14);
    expect(fps).toBeLessThanOrEqual(17);
  });

  it('reports whether each frame was accepted and flushes partial batches', () => {
    const batches: number[][] = [];
    const batcher = createFrameBatcher({ onBatch: (b) => batches.push(b.map((f) => f.t)), minIntervalMs: 60 });
    expect(batcher.add(frame(0))).toBe(true);
    expect(batcher.add(frame(20))).toBe(false);
    expect(batcher.add(frame(70))).toBe(true);
    batcher.flush();
    expect(batches).toEqual([[0, 70]]);
    batcher.flush(); // nothing pending: no empty batch
    expect(batches).toHaveLength(1);
  });

  it('never emits more than the protocol maximum of 10 frames per batch', () => {
    expect(() => createFrameBatcher({ batchSize: 11, onBatch: () => {} })).toThrow();
  });
});

describe('summarizeSet', () => {
  const rep = (index: number, score: number, faults: string[] = [], startMs = 0, endMs = 0) => ({
    index,
    score,
    faults,
    startMs,
    endMs,
  });

  it('aggregates reps, mean score and fault counts', () => {
    const summary = summarizeSet({
      exercise: 'squat',
      reps: [
        rep(1, 100),
        rep(2, 70, ['shallow_depth']),
        rep(3, 45, ['shallow_depth', 'knees_caving']),
      ],
      startedAtMs: 1_000,
      endedAtMs: 13_500,
    });
    expect(summary).toEqual({
      exercise: 'squat',
      reps: 3,
      score: 71.7,
      faults: { shallow_depth: 2, knees_caving: 1 },
      durationMs: 12_500,
    });
  });

  it('returns score 0 and no faults for an empty set, and never a negative duration', () => {
    expect(summarizeSet({ exercise: 'jumping_jack', reps: [], startedAtMs: 5_000, endedAtMs: 4_000 })).toEqual({
      exercise: 'jumping_jack',
      reps: 0,
      score: 0,
      faults: {},
      durationMs: 0,
    });
  });

  it('clamps the score into 0..100 as the protocol requires', () => {
    const s = summarizeSet({ exercise: 'squat', reps: [rep(1, 140)], startedAtMs: 0, endedAtMs: 1 });
    expect(s.score).toBe(100);
  });
});

describe('idleStatus (8 s auto-end)', () => {
  const base = { idleMs: 8_000, warnMs: 3_000 };

  it('does nothing until the first rep has been counted', () => {
    expect(idleStatus({ ...base, reps: 0, lastActivityMs: 0, nowMs: 60_000 })).toEqual({ kind: 'none' });
  });

  it('is quiet for the first 5 s after a rep', () => {
    expect(idleStatus({ ...base, reps: 1, lastActivityMs: 1_000, nowMs: 5_999 })).toEqual({ kind: 'none' });
  });

  it('warns with a 3-2-1 countdown during the last 3 s', () => {
    const at = (nowMs: number) => idleStatus({ ...base, reps: 2, lastActivityMs: 0, nowMs });
    expect(at(5_000)).toEqual({ kind: 'warn', secondsLeft: 3 });
    expect(at(6_100)).toEqual({ kind: 'warn', secondsLeft: 2 });
    expect(at(7_900)).toEqual({ kind: 'warn', secondsLeft: 1 });
  });

  it('ends the set after 8 s without a rep', () => {
    expect(idleStatus({ ...base, reps: 2, lastActivityMs: 0, nowMs: 8_000 })).toEqual({ kind: 'end' });
    expect(idleStatus({ ...base, reps: 2, lastActivityMs: 0, nowMs: 20_000 })).toEqual({ kind: 'end' });
  });

  it('a new rep (activity) restarts the clock', () => {
    expect(idleStatus({ ...base, reps: 3, lastActivityMs: 7_000, nowMs: 8_500 })).toEqual({ kind: 'none' });
  });
});

describe('frame ring (export last 30 s)', () => {
  it('keeps only frames within the window', () => {
    const ring = createFrameRing(30_000);
    for (let t = 0; t <= 45_000; t += 5_000) ring.add(frame(t));
    const ts = ring.snapshot().map((f) => f.t);
    expect(ts[0]).toBe(15_000);
    expect(ts.at(-1)).toBe(45_000);
    expect(ring.size()).toBe(7);
  });

  it('exports a JSON-serialisable document with metadata', () => {
    const ring = createFrameRing(30_000);
    ring.add(frame(100));
    const doc = ring.toExport({ exercise: 'squat', aspect: 0.5625, exportedAt: 123 });
    expect(JSON.parse(JSON.stringify(doc))).toEqual({
      format: 'couch-coach-landmarks/1',
      exercise: 'squat',
      aspect: 0.5625,
      exportedAt: 123,
      frames: [frame(100)],
    });
  });

  it('snapshot is a copy: later adds do not mutate it', () => {
    const ring = createFrameRing(1_000);
    ring.add(frame(1));
    const snap = ring.snapshot();
    ring.add(frame(2));
    expect(snap).toHaveLength(1);
  });
});

describe('parseSessionParams', () => {
  const sid = 'a'.repeat(32);
  it('reads session id, token and optional member id', () => {
    expect(parseSessionParams(`?s=${sid}&t=abc.def&m=mem_1`)).toEqual({
      ok: true,
      sessionId: sid,
      token: 'abc.def',
      memberId: 'mem_1',
    });
  });
  it("defaults memberId to 'unknown' when the URL has no m", () => {
    expect(parseSessionParams(`?s=${sid}&t=tok`)).toMatchObject({ ok: true, memberId: 'unknown' });
  });
  it.each(['', `?s=${sid}`, '?s=short&t=tok', `?s=${sid}&t=`])('rejects an invalid link: %j', (search) => {
    expect(parseSessionParams(search)).toEqual({ ok: false });
  });
});

describe('set runner', () => {
  const scripted = (results: ({ index: number; score: number; faults: string[] } | null)[]) => {
    let i = 0;
    return { push: () => results[i++] ?? null };
  };

  it('turns completed reps into wire events with a running index and tracks the score', () => {
    const runner = createSetRunner({
      exercise: 'squat',
      setIndex: 2,
      startedAtMs: 1_000,
      counter: scripted([null, { index: 0, score: 100, faults: [] }, { index: 1, score: 70, faults: ['shallow_depth'] }]),
    });
    expect(runner.score()).toBeNull();
    expect(runner.push({}, 1_100)).toBeNull();
    expect(runner.push({}, 2_000)).toEqual({ type: 'rep', exercise: 'squat', index: 1, score: 100, faults: [], t: 2_000 });
    expect(runner.push({}, 3_000)).toMatchObject({ index: 2, score: 70, faults: ['shallow_depth'] });
    expect(runner.repCount()).toBe(2);
    expect(runner.score()).toBe(85);
    expect(runner.lastRepAtMs()).toBe(3_000);
    expect(runner.summary(4_000)).toEqual({
      exercise: 'squat',
      reps: 2,
      score: 85,
      faults: { shallow_depth: 1 },
      durationMs: 3_000,
    });
  });

  it('starts the idle clock at the Set start', () => {
    const runner = createSetRunner({ exercise: 'jumping_jack', setIndex: 1, startedAtMs: 500, counter: scripted([]) });
    expect(runner.lastRepAtMs()).toBe(500);
  });
});
