import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveAnchor, resolveBeat } from '../lib/beats.mjs';

const rec = (macT, channel, event, data) => ({ macT, channel, event, data: { type: event, ...data } });
const records = [
  rec(10_000, 'events', 'hello', { t: 9_900 }),
  rec(50_000, 'events', 'set_start', { exercise: 'squat', t: 49_800 }),
  rec(80_000, 'events', 'set_end', { setIndex: 1, t: 79_800 }),
  rec(80_300, 'coach', 'thinking', { setIndex: 1, t: 80_290 }),
  rec(83_000, 'coach', 'cue', { setIndex: 1, text: 'Go deeper.', t: 82_990 }),
  { macT: 83_400, channel: 'meta', event: 'cue_audio', data: { setIndex: 1, file: 'cue-1.mp3' } },
  rec(120_000, 'events', 'set_start', { exercise: 'squat', t: 119_800 }),
];
const ctx = {
  fps: 30,
  records,
  tv: { startMac: 1000, durationS: 600, gaps: [{ afterChunk: '01', atMac: 171_000, durationS: 0.2 }] },
  phone: { startMac: 1500, durationS: 500 },
};

test('resolveAnchor understands timeline events, master offsets, ISO and epoch ms', () => {
  assert.equal(resolveAnchor('set_start#1-2', ctx), 48_000);
  assert.equal(resolveAnchor('set_start#2', ctx), 120_000);
  assert.equal(resolveAnchor('set_end#1+1.5', ctx), 81_500);
  assert.equal(resolveAnchor('cue#1+0.5', ctx), 83_500);
  assert.equal(resolveAnchor('thinking#1', ctx), 80_300);
  assert.equal(resolveAnchor('hello#1', ctx), 10_000);
  assert.equal(resolveAnchor('tv:12.5', ctx), 13_500);
  assert.equal(resolveAnchor('phone:3', ctx), 4_500);
  assert.equal(resolveAnchor(123_456, ctx), 123_456);
  assert.equal(resolveAnchor('2026-10-22T17:00:00Z', ctx), Date.parse('2026-10-22T17:00:00Z'));
});

test('resolveAnchor rejects unknown events and missing occurrences', () => {
  assert.throws(() => resolveAnchor('jump#1', ctx), /unknown anchor/);
  assert.throws(() => resolveAnchor('cue#9', ctx), /no cue#9/);
});

test('resolveBeat snaps a split beat to the 30 fps grid and computes both seeks', () => {
  const b = resolveBeat({ id: 'reps', layout: 'split', in: 'set_start#1-2', out: 'set_end#1+1' }, ctx);
  assert.equal(b.inMac, 48_000);
  assert.equal(b.frames, 990);
  assert.equal(b.durationS, 33);
  assert.equal(b.outMac, 81_000);
  assert.equal(b.tvSeekS, 47);
  assert.equal(b.phoneSeekS, 46.5);
  assert.deepEqual(b.cues, []);
  assert.deepEqual(b.warnings, []);
});

test('resolveBeat moves the in point earlier so the narration ends 0.4 s before the cue', () => {
  const b = resolveBeat(
    { id: 'cue1', layout: 'split', in: 'set_end#1-1', out: 'cue#1+6', cue: 1, narrationS: 4 },
    ctx,
  );
  assert.equal(b.inMac, 78_600);
  assert.match(b.warnings[0], /0\.40 s earlier/);
  assert.deepEqual(b.cues, [{ setIndex: 1, atS: 4.4, file: 'cue-1.mp3', text: 'Go deeper.' }]);
});

test('resolveBeat leaves the in point alone when the narration already fits', () => {
  const b = resolveBeat(
    { id: 'cue1', layout: 'split', in: 'set_end#1-1', out: 'cue#1+6', cue: 1, narrationS: 3.5 },
    ctx,
  );
  assert.equal(b.inMac, 79_000);
  assert.deepEqual(b.warnings, []);
});

test('resolveBeat clamps a split beat to the phone recording and says so', () => {
  const b = resolveBeat({ id: 'early', layout: 'split', in: 1_200, out: 5_000 }, ctx);
  assert.equal(b.inMac, 1_500);
  assert.equal(b.phoneSeekS, 0);
  assert.match(b.warnings[0], /clamped/);
});

test('resolveBeat ignores phone bounds for a TV-only beat', () => {
  const b = resolveBeat({ id: 'device', layout: 'tv', in: 'tv:0.1', out: 'tv:8' }, ctx);
  assert.equal(b.phoneSeekS, null);
  assert.equal(b.tvSeekS, 0.1);
  assert.equal(b.frames, 237);
});

test('resolveBeat warns when a beat crosses a TV chunk gap', () => {
  const b = resolveBeat({ id: 'gap', layout: 'tv', in: 'tv:165', out: 'tv:175' }, ctx);
  assert.match(b.warnings.join('\n'), /chunk gap/);
});

test('resolveBeat refuses an empty beat and an unknown layout', () => {
  assert.throws(() => resolveBeat({ id: 'x', layout: 'split', in: 50_000, out: 50_000 }, ctx), /empty/);
  assert.throws(() => resolveBeat({ id: 'x', layout: 'pip', in: 50_000, out: 60_000 }, ctx), /layout/);
});

test('resolveBeat holds the first frame for holdStartS: longer clip, cue times shifted by the hold', () => {
  const b = resolveBeat({ id: 'cue1', layout: 'split', in: 'set_end#1-1', out: 'cue#1+6', holdStartS: 1.5 }, ctx);
  assert.equal(b.inMac, 79_000);
  assert.equal(b.frames, 300);
  assert.equal(b.holdFrames, 45);
  assert.equal(b.durationS, 11.5);
  assert.deepEqual(b.cues, [{ setIndex: 1, atS: 5.5, file: 'cue-1.mp3', text: 'Go deeper.' }]);
});

test('resolveBeat counts the start hold when it keeps the narration clear of the cue', () => {
  const b = resolveBeat(
    { id: 'cue1', layout: 'split', in: 'set_end#1-1', out: 'cue#1+6', cue: 1, narrationS: 4, holdStartS: 1 },
    ctx,
  );
  assert.equal(b.inMac, 79_000);
  assert.deepEqual(b.warnings, []);
});

test('resolveBeat refuses a negative or oversized holdStartS, and a plain beat has no hold', () => {
  assert.throws(() => resolveBeat({ id: 'x', layout: 'tv', in: 'tv:1', out: 'tv:5', holdStartS: -1 }, ctx), /holdStartS/);
  assert.throws(() => resolveBeat({ id: 'x', layout: 'tv', in: 'tv:1', out: 'tv:5', holdStartS: 9 }, ctx), /holdStartS/);
  assert.equal(resolveBeat({ id: 'x', layout: 'tv', in: 'tv:1', out: 'tv:5' }, ctx).holdFrames, 0);
});
