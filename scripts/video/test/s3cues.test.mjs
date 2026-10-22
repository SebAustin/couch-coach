import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertReadOnly, buildFetchCommands, parseS3Ls } from '../lib/s3cues.mjs';

const SID = 'c'.repeat(32);
const BUCKET = 'couchcoachstack-audiobucket-1a2b3c';

test('buildFetchCommands lists the session folder and copies each call down to disk', () => {
  const cmds = buildFetchCommands({ bucket: BUCKET, sessionId: SID, calls: [1, 2], outDir: '/tmp/run x', profile: 'cc', region: 'us-east-1' });
  assert.deepEqual(cmds[0], { cmd: 'aws', args: ['s3', 'ls', `s3://${BUCKET}/audio/${SID}/`, '--profile', 'cc', '--region', 'us-east-1'] });
  assert.deepEqual(cmds[1].args.slice(0, 4), ['s3', 'cp', `s3://${BUCKET}/audio/${SID}/1.mp3`, '/tmp/run x/call-1.mp3']);
  assert.equal(cmds.length, 3);
  for (const c of cmds) assertReadOnly(c.args);
});

test('buildFetchCommands validates the bucket and the session id', () => {
  assert.throws(() => buildFetchCommands({ bucket: 'Bad Bucket', sessionId: SID, calls: [], outDir: '/tmp' }), /bucket/);
  assert.throws(() => buildFetchCommands({ bucket: BUCKET, sessionId: 'abc', calls: [], outDir: '/tmp' }), /session/);
  assert.throws(() => buildFetchCommands({ bucket: BUCKET, sessionId: SID, calls: [0], outDir: '/tmp' }), /call/);
});

test('assertReadOnly refuses every command that could write to AWS', () => {
  assert.throws(() => assertReadOnly(['s3', 'cp', '/tmp/a.mp3', `s3://${BUCKET}/a.mp3`]), /read-only/);
  assert.throws(() => assertReadOnly(['s3', 'cp', `s3://${BUCKET}/a.mp3`, `s3://${BUCKET}/b.mp3`]), /read-only/);
  for (const verb of ['rm', 'mv', 'sync', 'mb', 'rb', 'presign', 'website']) {
    assert.throws(() => assertReadOnly(['s3', verb, `s3://${BUCKET}/a`]), /read-only/, verb);
  }
  assert.throws(() => assertReadOnly(['s3api', 'put-object']), /read-only/);
  assert.throws(() => assertReadOnly(['s3', 'ls', `s3://${BUCKET}/`, '--delete']), /read-only/);
});

test('parseS3Ls returns the call numbers found in an aws s3 ls listing, sorted', () => {
  const out = [
    '2026-10-22 12:04:11      48213 2.mp3',
    '2026-10-22 12:01:55      51022 1.mp3',
    '2026-10-22 12:09:40      39100 10.mp3',
    '                           PRE other/',
  ].join('\n');
  assert.deepEqual(parseS3Ls(out), [1, 2, 10]);
});
