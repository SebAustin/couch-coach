import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  audioKeyOf,
  callOfAudioKey,
  cuesOf,
  parseTimeline,
  repDelayMedianMs,
  setWindows,
  timelineRecord,
} from '../lib/timeline.mjs';

const SID = 'a'.repeat(32);

test('audioKeyOf keeps the S3 key and drops the signature, for virtual-host and path-style URLs', () => {
  assert.equal(
    audioKeyOf(`https://bucket.s3.us-east-1.amazonaws.com/audio/${SID}/3.mp3?X-Amz-Signature=abc&X-Amz-Expires=900`),
    `audio/${SID}/3.mp3`,
  );
  assert.equal(audioKeyOf(`https://s3.us-east-1.amazonaws.com/bucket/audio/${SID}/12.mp3?sig=1`), `audio/${SID}/12.mp3`);
  assert.equal(audioKeyOf('not a url'), null);
});

test('callOfAudioKey reads the coach call number', () => {
  assert.equal(callOfAudioKey(`audio/${SID}/12.mp3`), 12);
  assert.equal(callOfAudioKey('audio/x/final.mp3'), null);
});

test('timelineRecord replaces a signed audioUrl by its key so no signature lands on disk', () => {
  const rec = timelineRecord(1000, 'coach', {
    type: 'cue',
    text: 'Nice depth.',
    setIndex: 2,
    t: 990,
    audioUrl: `https://b.s3.amazonaws.com/audio/${SID}/2.mp3?X-Amz-Signature=s`,
  });
  assert.deepEqual(rec, {
    macT: 1000,
    channel: 'coach',
    event: 'cue',
    data: { type: 'cue', text: 'Nice depth.', setIndex: 2, t: 990, audioKey: `audio/${SID}/2.mp3` },
  });
});

const ndjson = [
  JSON.stringify({ macT: 100, channel: 'meta', event: 'attach', data: { sessionId: SID } }),
  JSON.stringify({ macT: 1000, channel: 'events', event: 'hello', data: { type: 'hello', t: 900 } }),
  JSON.stringify({ macT: 2000, channel: 'events', event: 'set_start', data: { type: 'set_start', exercise: 'squat', t: 1800 } }),
  JSON.stringify({ macT: 2500, channel: 'events', event: 'rep', data: { type: 'rep', t: 2300 } }),
  JSON.stringify({ macT: 3200, channel: 'events', event: 'rep', data: { type: 'rep', t: 3000 } }),
  JSON.stringify({ macT: 4000, channel: 'events', event: 'set_end', data: { type: 'set_end', setIndex: 1, t: 3900 } }),
  'not json',
  JSON.stringify({ macT: 4100, channel: 'coach', event: 'thinking', data: { type: 'thinking', setIndex: 1, t: 4090 } }),
  JSON.stringify({ macT: 6000, channel: 'coach', event: 'cue', data: { type: 'cue', setIndex: 1, text: 'Go deeper.', t: 5990, audioKey: `audio/${SID}/1.mp3` } }),
  JSON.stringify({ macT: 6400, channel: 'meta', event: 'cue_audio', data: { setIndex: 1, file: 'cue-1.mp3', bytes: 1234 } }),
  JSON.stringify({ macT: 9000, channel: 'events', event: 'set_start', data: { type: 'set_start', exercise: 'jumping_jack', t: 8800 } }),
  '',
].join('\n');

test('parseTimeline keeps valid records in order and counts bad lines', () => {
  const { records, bad } = parseTimeline(ndjson);
  assert.equal(records.length, 10);
  assert.equal(bad, 1);
  assert.equal(records[1].event, 'hello');
});

test('setWindows pairs each set_start with the next set_end; an open set has no end', () => {
  const { records } = parseTimeline(ndjson);
  assert.deepEqual(setWindows(records), [
    { setIndex: 1, exercise: 'squat', startMac: 2000, startPhone: 1800, endMac: 4000, endPhone: 3900 },
    { setIndex: 2, exercise: 'jumping_jack', startMac: 9000, startPhone: 8800, endMac: null, endPhone: null },
  ]);
});

test('cuesOf joins each cue with its downloaded file and call number', () => {
  const { records } = parseTimeline(ndjson);
  assert.deepEqual(cuesOf(records), [
    { setIndex: 1, macT: 6000, text: 'Go deeper.', audioKey: `audio/${SID}/1.mp3`, call: 1, file: 'cue-1.mp3', thinkingMac: 4100 },
  ]);
});

test('repDelayMedianMs measures phone-to-Mac receive delay over rep events', () => {
  const { records } = parseTimeline(ndjson);
  assert.equal(repDelayMedianMs(records), 200);
});
