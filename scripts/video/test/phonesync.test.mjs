import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropNear, median, parseCreationTime, parseSceneScores, pickChange, refineStart } from '../lib/phonesync.mjs';

test('parseSceneScores reads ffmpeg metadata=print output', () => {
  const out = [
    'frame:0    pts:0       pts_time:0',
    'lavfi.scene_score=0.000000',
    'frame:1    pts:512     pts_time:0.0333333',
    'lavfi.scene_score=0.012000',
    'frame:2    pts:1024    pts_time:0.0666667',
    'lavfi.scene_score=0.410000',
  ].join('\n');
  assert.deepEqual(parseSceneScores(out), [
    { t: 0, score: 0 },
    { t: 0.0333333, score: 0.012 },
    { t: 0.0666667, score: 0.41 },
  ]);
});

test('parseSceneScores adds a window offset to every timestamp', () => {
  const out = 'frame:0 pts:0 pts_time:0.5\nlavfi.scene_score=0.2\n';
  assert.deepEqual(parseSceneScores(out, 10), [{ t: 10.5, score: 0.2 }]);
});

test('pickChange returns the biggest change inside the window, above the minimum score', () => {
  const scores = [
    { t: 3.0, score: 0.9 }, // outside the window
    { t: 4.0, score: 0.1 },
    { t: 5.2, score: 0.3 },
    { t: 6.4, score: 0.2 },
    { t: 7.0, score: 0.95 }, // outside the window
  ];
  assert.deepEqual(pickChange(scores, 5, 1.5, 0.05), { t: 5.2, score: 0.3 });
  assert.equal(pickChange(scores, 5, 1.5, 0.5), null);
});

test('dropNear removes scene changes at known cut points (TV chunk boundaries)', () => {
  const scores = [
    { t: 9.0, score: 0.2 },
    { t: 10.2, score: 0.9 },
    { t: 10.233, score: 0.5 },
    { t: 11, score: 0.1 },
  ];
  assert.deepEqual(dropNear(scores, [10.2], 0.05), [scores[0], scores[3]]);
  assert.deepEqual(dropNear(scores, [], 0.05), scores);
});

test('median handles odd, even and empty lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('refineStart moves the phone start earlier when changes land later than predicted', () => {
  const r = refineStart(100_000, [
    { predictedS: 10, detectedS: 10.5 },
    { predictedS: 20, detectedS: 20.4 },
    { predictedS: 30, detectedS: 30.6 },
  ]);
  assert.equal(r.refineMs, -500);
  assert.equal(r.startMac, 99_500);
  assert.equal(r.samples, 3);
});

test('refineStart keeps the creation date when nothing was detected', () => {
  const r = refineStart(100_000, []);
  assert.equal(r.startMac, 100_000);
  assert.equal(r.refineMs, 0);
  assert.equal(r.samples, 0);
});

test('parseCreationTime prefers the QuickTime local creation date over creation_time', () => {
  const ms = parseCreationTime({
    'com.apple.quicktime.creationdate': '2026-10-22T12:01:02-0500',
    creation_time: '2026-10-22T17:01:05.000000Z',
  });
  assert.equal(ms, Date.parse('2026-10-22T17:01:02Z'));
});

test('parseCreationTime falls back to creation_time, then null', () => {
  assert.equal(parseCreationTime({ creation_time: '2026-10-22T17:01:05.000000Z' }), Date.parse('2026-10-22T17:01:05Z'));
  assert.equal(parseCreationTime({}), null);
});
