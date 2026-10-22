#!/usr/bin/env node
/**
 * Pre-upload checks for the rendered demo video.
 *
 *   node scripts/video/verify-video.mjs --video <project>/out/<project>.mp4 --project <ultrademo project folder>
 *        [--scenes <project>/scenes.json] [--upload-at <ISO, planned YouTube upload>]
 *        [--run <id> | --run-dir <path> | --expires-at <ms|ISO> | --phone-url <QR url> | --token <t>]
 *        [--out <dir, default <project>/out/verify>] [--max-seconds 175]
 *
 * 1. Length: ffprobe duration <= --max-seconds (175).
 * 2. Frames: PNG at each scene's midpoint and 1 s after each Cue starts (timing mirrored from render.mjs /
 *    Demo.tsx), for the evidence table (scene, claim, visible yes/no).
 * 3. 1 fps contact sheets (sheet-NN.png, 20 s per sheet) for the secrets sweep: terminals, emails, AWS account
 *    numbers, iPhone notifications, the Safari address bar, the TV serial / device name, third-party app tiles,
 *    the GitHub header, and a visible face.
 * 4. Loudness: EBU R128 integrated loudness (target about -16 LUFS) and true peak (no clipping).
 * 5. Words: "Ultrademo" anywhere in the storyboard / scenes text; "AI" in the sign-off (outro).
 * 6. Pairing QR: the Session's token must have expired before the planned upload (expiresAt < --upload-at).
 * 7. Chapters: printed from the scene start times (chapters.txt) for the YouTube description.
 * Writes <out>/report.json; exits 1 when any check FAILs.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { die, ffmpeg, parseArgs, probe, readJson, resolveRunDir, run } from './lib/cli.mjs';
import { chapters, checkTokenExpiry, expiryFromPhoneUrl, findForbidden, parseEbur128, sceneTimeline, tokenExpiry } from './lib/verify.mjs';

const TARGET_LUFS = -16;
const LUFS_TOLERANCE = 2;
const MAX_TRUE_PEAK_DBFS = -1;

const args = parseArgs(process.argv.slice(2));
if (typeof args.video !== 'string' || typeof args.project !== 'string') die('usage: verify-video.mjs --video <mp4> --project <ultrademo project folder> [...]');
const video = resolve(args.video);
const projectDir = resolve(args.project);
if (!existsSync(video)) die(`video not found: ${video}`);
const outDir = resolve(typeof args.out === 'string' ? args.out : join(projectDir, 'out', 'verify'));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const maxSeconds = Number(args['max-seconds'] ?? 175);

const results = [];
const check = (name, status, detail) => {
  results.push({ name, status, detail });
  console.log(`${status.padEnd(4)}  ${name}: ${detail}`);
};

// 1. length -------------------------------------------------------------------------------------------------------
const info = probe(video);
check('length', info.durationS <= maxSeconds ? 'PASS' : 'FAIL', `${info.durationS.toFixed(2)} s (max ${maxSeconds} s), ${info.width}x${info.height} @ ${info.fps?.toFixed(2)} fps`);

// 2. frames -------------------------------------------------------------------------------------------------------
const sb = readJson(join(projectDir, 'assets', 'storyboard.json'));
const tl = sceneTimeline(sb);
if (Math.abs(tl.totalS - info.durationS) > 0.5) {
  check('timing mirror', 'WARN', `storyboard math gives ${tl.totalS.toFixed(2)} s but the video is ${info.durationS.toFixed(2)} s: scene times below may be off (Demo.tsx changed?)`);
}
const grab = (t, name) => ffmpeg(['-ss', Math.max(0, Math.min(t, info.durationS - 0.05)).toFixed(3), '-i', video, '-frames:v', '1', join(outDir, name)]);
const pad = (i) => String(i + 1).padStart(2, '0');
if (tl.intro.durationS) grab(tl.intro.durationS / 2, '00-intro.png');
tl.scenes.forEach((s, i) => {
  grab(s.startS + s.durationS / 2, `scene-${pad(i)}-${s.id}.png`);
  s.cues.forEach((c, j) => grab(c.atS + 1, `cue-${pad(i)}-${s.id}-${j + 1}.png`));
});
if (tl.outro.durationS) grab(tl.outro.startS + tl.outro.durationS / 2, '99-outro.png');
check('frames', 'INFO', `${readdirSync(outDir).filter((f) => f.endsWith('.png')).length} PNGs (scene midpoints, Cue + 1 s): fill the evidence table`);

// 3. contact sheets ----------------------------------------------------------------------------------------------
ffmpeg(['-i', video, '-vf', 'fps=1,scale=384:-2,tile=5x4', join(outDir, 'sheet-%02d.png')]);
const sheets = readdirSync(outDir).filter((f) => f.startsWith('sheet-')).length;
check('secrets sweep', 'TODO', `${sheets} contact sheet(s) at 1 fps in ${outDir}: look for terminals, emails, AWS account numbers, notifications, the Safari address bar, the TV serial/device name, third-party tiles, the GitHub header, any unblurred face`);

// 4. loudness -----------------------------------------------------------------------------------------------------
if (!info.hasAudio) check('loudness', 'FAIL', 'no audio stream');
else {
  const { stderr } = run('ffmpeg', ['-hide_banner', '-nostats', '-nostdin', '-i', video, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const l = parseEbur128(stderr);
  if (!l || l.integratedLufs === null) check('loudness', 'FAIL', 'could not read the EBU R128 summary');
  else {
    const clipping = l.peakDbfs !== null && l.peakDbfs > 0;
    const onTarget = Math.abs(l.integratedLufs - TARGET_LUFS) <= LUFS_TOLERANCE && (l.peakDbfs ?? -99) <= MAX_TRUE_PEAK_DBFS;
    check('loudness', clipping ? 'FAIL' : onTarget ? 'PASS' : 'WARN', `I ${l.integratedLufs} LUFS (target ${TARGET_LUFS} ±${LUFS_TOLERANCE}), LRA ${l.lraLu} LU, true peak ${l.peakDbfs} dBFS (max ${MAX_TRUE_PEAK_DBFS})`);
  }
}

// 5. words --------------------------------------------------------------------------------------------------------
/** Every string inside a value, with a path for the report. */
function strings(value, where) {
  if (typeof value === 'string') return [{ where, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${where}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => strings(v, `${where}.${k}`));
  return [];
}
const textOf = (o) => ({ script: o?.script, title: o?.title, subtitle: o?.subtitle, url: o?.url, caption: o?.caption });
const scenesPath = typeof args.scenes === 'string' ? resolve(args.scenes) : join(projectDir, 'scenes.json');
const scenesDoc = existsSync(scenesPath) ? readJson(scenesPath) : null;
const sceneList = Array.isArray(scenesDoc) ? scenesDoc : scenesDoc?.scenes ?? [];
const texts = [
  ...strings(textOf(sb.intro), 'storyboard.intro'),
  ...(sb.scenes ?? []).flatMap((s) => [...strings(s.script, `storyboard.${s.id}.script`), ...strings((s.extraAudio ?? []).map((a) => a.caption), `storyboard.${s.id}.extraAudio`)]),
  ...strings(scenesDoc, 'scenes.json'),
];
const signOff = [
  ...strings(textOf(sb.outro), 'storyboard.outro'),
  ...(sb.outro ? [] : strings(sb.scenes?.at(-1)?.script, `storyboard.${sb.scenes?.at(-1)?.id}.script`)),
  ...sceneList.filter((s) => s?.id === 'outro').flatMap((s) => strings(s, 'scenes.json.outro')),
];
const found = findForbidden({ texts, signOff });
check('words', found.length ? 'FAIL' : 'PASS', found.length ? found.map((f) => `${f.term} in ${f.where}: "...${f.excerpt}..."`).join('; ') : `no "Ultrademo" in ${texts.length + signOff.length} strings, no "AI" in the sign-off`);

// 6. pairing token --------------------------------------------------------------------------------------------------
function expiresAt() {
  if (args['expires-at'] !== undefined) {
    const v = String(args['expires-at']);
    return { value: /^\d+$/.test(v) ? Number(v) : Date.parse(v), source: '--expires-at' };
  }
  if (typeof args['phone-url'] === 'string') return { value: expiryFromPhoneUrl(args['phone-url']), source: 'QR url token' };
  if (typeof args.token === 'string') return { value: tokenExpiry(args.token), source: 'token' };
  try {
    const session = readJson(join(resolveRunDir(args), 'session.json'), {});
    return { value: session.expiresAt ?? null, source: 'run session.json' };
  } catch {
    return { value: null, source: 'none' };
  }
}
const exp = expiresAt();
const uploadAt = typeof args['upload-at'] === 'string' ? Date.parse(args['upload-at']) : Date.now();
if (!Number.isFinite(uploadAt)) die(`--upload-at is not a date: ${args['upload-at']}`);
const token = checkTokenExpiry(Number.isFinite(exp.value) ? exp.value : null, uploadAt);
check(
  'QR token expiry',
  token.ok ? 'PASS' : 'FAIL',
  exp.value
    ? `expires ${new Date(exp.value).toISOString()} (${exp.source}), upload ${new Date(uploadAt).toISOString()}${args['upload-at'] ? '' : ' (now; pass --upload-at)'}: ${token.ok ? `expired ${(token.marginMs / 3_600_000).toFixed(1)} h before` : 'STILL VALID at upload'}`
    : 'unknown expiry: pass --phone-url (QR), --token, or --expires-at (CloudWatch "session created" expiresAt)',
);

// 7. chapters -------------------------------------------------------------------------------------------------------
const titleOf = (id) => sceneList.find((s) => s?.id === id)?.title ?? id;
const chapterLines = chapters([
  ...(tl.intro.durationS ? [{ startS: 0, title: titleOf('intro') }] : []),
  ...tl.scenes.map((s) => ({ startS: s.startS, title: titleOf(s.id) })),
  ...(tl.outro.durationS ? [{ startS: tl.outro.startS, title: titleOf('outro') }] : []),
]);
writeFileSync(join(outDir, 'chapters.txt'), `${chapterLines.join('\n')}\n`);
console.log(`\nchapters:\n${chapterLines.join('\n')}`);

const failed = results.filter((r) => r.status === 'FAIL');
writeFileSync(join(outDir, 'report.json'), `${JSON.stringify({ video, durationS: info.durationS, results, chapters: chapterLines, timeline: tl }, null, 2)}\n`);
console.log(`\n${failed.length ? `${failed.length} check(s) FAILED` : 'all automatic checks passed'}; frames + report in ${outDir}`);
process.exit(failed.length ? 1 : 0);
