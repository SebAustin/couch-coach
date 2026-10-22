import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chapters,
  checkTokenExpiry,
  expiryFromPhoneUrl,
  findForbidden,
  parseEbur128,
  sceneTimeline,
  tokenExpiry,
} from '../lib/verify.mjs';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('findForbidden flags "Ultrademo" anywhere and "AI" only as a word in the sign-off', () => {
  const found = findForbidden({
    texts: [
      { where: 'scene hook', text: 'He said it again.' },
      { where: 'scene arch', text: 'Rendered by ultrademo.net' },
    ],
    signOff: [
      { where: 'outro', text: 'Now get off the couch! Built with AI-powered magic.' },
      { where: 'outro title', text: 'Allow camera, said Aidan' },
    ],
  });
  assert.deepEqual(
    found.map((f) => `${f.where}: ${f.term}`),
    ['scene arch: Ultrademo', 'outro: AI'],
  );
});

test('findForbidden also catches a spelled-out "artificial intelligence" in the sign-off', () => {
  const found = findForbidden({ texts: [], signOff: [{ where: 'outro', text: 'Artificial Intelligence coach.' }] });
  assert.equal(found.length, 1);
});

test('parseEbur128 reads the summary block, not the per-frame lines', () => {
  const stderr = [
    '[Parsed_ebur128_0 @ 0x1] t: 0.4  TARGET:-23 LUFS    M: -30.1 S:-120.7     I: -30.1 LUFS       LRA:   0.0 LU',
    '[Parsed_ebur128_0 @ 0x1] Summary:',
    '',
    '  Integrated loudness:',
    '    I:         -16.3 LUFS',
    '    Threshold: -26.5 LUFS',
    '',
    '  Loudness range:',
    '    LRA:         4.3 LU',
    '    Threshold: -36.4 LUFS',
    '',
    '  True peak:',
    '    Peak:       -1.2 dBFS',
  ].join('\n');
  assert.deepEqual(parseEbur128(stderr), { integratedLufs: -16.3, lraLu: 4.3, peakDbfs: -1.2 });
  assert.equal(parseEbur128('no summary here'), null);
});

test('sceneTimeline mirrors the renderer timing, including lockRate and Cue audio', () => {
  const sb = {
    intro: { audioDuration: 3 },
    scenes: [
      { id: 'a', media: 'still', audioDuration: 2 },
      { id: 'b', media: 'clip', clipDuration: 10, audioDuration: 4, lockRate: true, extraAudio: [{ at: 8, duration: 3 }] },
      { id: 'c', media: 'clip', clipDuration: 10, audioDuration: 4 },
    ],
    outro: { title: 'x' },
  };
  const tl = sceneTimeline(sb);
  near(tl.intro.durationS, 134 / 30);
  near(tl.scenes[0].startS, 134 / 30);
  near(tl.scenes[0].durationS, 2.7);
  near(tl.scenes[1].durationS, 11);
  // c: rate min(1.3, 10 / 4.7) = 1.3 -> 10 / 1.3 + 0.4 = 8.0923 s -> 243 frames
  near(tl.scenes[2].durationS, 243 / 30);
  near(tl.scenes[1].cues[0].atS, tl.scenes[1].startS + 8);
  near(tl.outro.durationS, 3);
  near(tl.totalS, 134 / 30 + 2.7 + 11 + 243 / 30 + 3);
});

test('chapters start at 0:00 and use the scene start times', () => {
  const lines = chapters([
    { startS: 0, title: 'Intro' },
    { startS: 4.47, title: 'Hook' },
    { startS: 75.2, title: 'Architecture' },
  ]);
  assert.deepEqual(lines, ['0:00 Intro', '0:04 Hook', '1:15 Architecture']);
});

const SID = 'b'.repeat(32);
const token = `${Buffer.from(`${SID}.1792000000000`).toString('base64url')}.c2ln`;

test('tokenExpiry reads the expiry baked into a phone token without the secret', () => {
  assert.equal(tokenExpiry(token), 1792000000000);
  assert.equal(tokenExpiry('garbage'), null);
  assert.equal(expiryFromPhoneUrl(`https://phone.example/?s=${SID}&t=${encodeURIComponent(token)}`), 1792000000000);
});

test('checkTokenExpiry passes only when the token expired before the upload', () => {
  assert.deepEqual(checkTokenExpiry(1000, 5000), { ok: true, marginMs: 4000 });
  assert.equal(checkTokenExpiry(9000, 5000).ok, false);
  assert.equal(checkTokenExpiry(null, 5000).ok, false);
});
