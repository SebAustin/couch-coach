import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planTvMaster } from '../lib/tvmaster.mjs';

const tvToMac = (tv) => tv - 5000;

test('planTvMaster places chunks on one 30 fps grid and holds the last frame over the gap', () => {
  const plan = planTvMaster(
    [
      { name: '01', file: '01.mp4', startTvMs: 10_000, durationS: 170 },
      { name: '02', file: '02.mp4', startTvMs: 10_000 + 170_200, durationS: 100 },
    ],
    { tvToMac, startDelayMs: 300, fps: 30 },
  );
  assert.equal(plan.startMac, 10_000 + 300 - 5000);
  assert.deepEqual(
    plan.segments.map(({ name, startFrame, frames, contentFrames, holdFrames }) => ({ name, startFrame, frames, contentFrames, holdFrames })),
    [
      { name: '01', startFrame: 0, frames: 5106, contentFrames: 5100, holdFrames: 6 },
      { name: '02', startFrame: 5106, frames: 3000, contentFrames: 3000, holdFrames: 0 },
    ],
  );
  assert.equal(plan.totalFrames, 8106);
  assert.equal(plan.durationS, 8106 / 30);
  assert.equal(plan.gaps.length, 1);
  assert.equal(plan.gaps[0].afterChunk, '01');
  assert.equal(plan.gaps[0].atMac, plan.startMac + 170_000);
  assert.ok(Math.abs(plan.gaps[0].durationS - 0.2) < 1e-9);
});

test('planTvMaster trims the tail of a chunk that overlaps the next one', () => {
  const plan = planTvMaster(
    [
      { name: '01', file: '01.mp4', startTvMs: 10_000, durationS: 170 },
      { name: '02', file: '02.mp4', startTvMs: 10_000 + 169_900, durationS: 10 },
    ],
    { tvToMac, startDelayMs: 0, fps: 30 },
  );
  assert.equal(plan.segments[0].frames, 5097);
  assert.equal(plan.segments[0].contentFrames, 5097);
  assert.equal(plan.segments[0].holdFrames, 0);
  assert.equal(plan.segments[0].trimmedFrames, 3);
  assert.equal(plan.gaps.length, 0);
});

test('planTvMaster sorts chunks by their TV start stamp', () => {
  const plan = planTvMaster(
    [
      { name: '02', file: '02.mp4', startTvMs: 20_000, durationS: 5 },
      { name: '01', file: '01.mp4', startTvMs: 10_000, durationS: 10 },
    ],
    { tvToMac, startDelayMs: 0, fps: 30 },
  );
  assert.deepEqual(plan.segments.map((s) => s.name), ['01', '02']);
});

test('planTvMaster refuses an empty chunk list', () => {
  assert.throws(() => planTvMaster([], { tvToMac, startDelayMs: 0, fps: 30 }), /no TV chunks/);
});
