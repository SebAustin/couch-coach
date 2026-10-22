#!/usr/bin/env node
/**
 * Cuts the synced device footage into Ultrademo clips: 1920x1080, 30 fps, H.264, no audio, plus an end-frame PNG,
 * written straight into <project>/assets/captures/ (the same shape capture.mjs produces).
 *
 *   node scripts/video/compose.mjs --project <ultrademo-workspace/projects/<name>> [--run <id> | --run-dir <path>]
 *        [--beats <run>/beats.json] [--phone <blurred file>] [--storyboard <project>/assets/storyboard.json]
 *        [--only id1,id2] [--ultrademo-root <workspace>] [--dry-run] [--allow-unblurred]
 *
 * beats.json: { "phoneCrop"?: { top, bottom, left, right } (source px), "beats": [
 *   { "id": "reps", "layout": "split", "in": "set_start#1-1.5", "out": "set_end#1+1" },
 *   { "id": "cue1", "layout": "split", "in": "set_end#1-1", "out": "cue#1+7", "cue": 1, "narrationS": 3.2 },
 *   { "id": "device", "layout": "tv", "in": "tv:21.5", "out": "tv:30" } ] }
 * Anchors are explained in lib/beats.mjs. With "cue" + a narration length (narrationS, or the scene's
 * audioDuration from --storyboard after `npm run tts`), the in point moves earlier so the narration ends 0.4 s
 * before the Cue; "narrationAfterCue": true skips that (Cue first, then narration).
 * A beat may carry "tvCrop": { x, y, w, h } (even source px, 16:9) to zoom into the TV frame before it is scaled
 * into its panel (legibility of small on-screen values), and "holdStartS" (0-5) to show the first composed frame
 * that long before the footage plays (both devices frozen together; cue times in the manifest include it).
 * Layouts (lib/layout.mjs): split = phone left (810 px tall, status bar + Safari bars cropped) and Fire TV right
 * (~1400x788) on templates/frame-split.html; tv = Fire TV alone, 1536x864 at the top. y > 870 stays free.
 * The phone input must be blur-face.py's output (*.blurred.*); --allow-unblurred overrides (never for a cut).
 * Also writes <project>/assets/cues/cue-<n>.mp3 and <project>/assets/captures/compose-manifest.json (clip
 * durations and ready-made extraAudio entries: { src, at, duration, caption }).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveBeat } from './lib/beats.mjs';
import { die, ffmpeg, FPS, parseArgs, probe, readJson, REPO_DIR, resolveRunDir, VIDEO_DIR, writeJson } from './lib/cli.mjs';
import { splitLayout, tvLayout } from './lib/layout.mjs';
import { parseTimeline } from './lib/timeline.mjs';

const args = parseArgs(process.argv.slice(2));
if (typeof args.project !== 'string') die('--project <ultrademo project folder> is required');
const projectDir = resolve(args.project);
if (!existsSync(projectDir)) die(`project folder not found: ${projectDir}`);
const runDir = resolveRunDir(args);
const capturesDir = join(projectDir, 'assets', 'captures');
const cuesDir = join(projectDir, 'assets', 'cues');
const workDir = join(runDir, 'compose');
const abs = (p) => (isAbsolute(p) ? p : join(runDir, p));

const sync = readJson(join(runDir, 'sync', 'sync.json'));
const nudge = { tvMs: 0, phoneMs: 0, ...(sync.nudge ?? {}) };
const beatsDoc = readJson(typeof args.beats === 'string' ? resolve(args.beats) : join(runDir, 'beats.json'));
const beats = (Array.isArray(beatsDoc) ? beatsDoc : beatsDoc.beats ?? []).filter(
  (b) => typeof args.only !== 'string' || args.only.split(',').includes(b.id),
);
if (!beats.length) die('no beats to compose');
const ids = new Set();
for (const b of beats) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(String(b.id ?? ''))) die(`beat id must be a plain file name: ${JSON.stringify(b.id)}`);
  if (ids.has(b.id)) die(`duplicate beat id ${b.id}`);
  ids.add(b.id);
}

const timelinePath = join(runDir, 'timeline.ndjson');
const { records } = parseTimeline(existsSync(timelinePath) ? readFileSync(timelinePath, 'utf8') : '');
const tvMaster = abs(sync.tv.master);
const tv = { ...sync.tv, startMac: sync.tv.startMac + nudge.tvMs, gaps: (sync.tv.gaps ?? []).map((g) => ({ ...g, atMac: g.atMac + nudge.tvMs })) };

const needsPhone = beats.some((b) => b.layout === 'split');
const phoneFile = needsPhone ? resolve(typeof args.phone === 'string' ? args.phone : abs(sync.phone?.master ?? '')) : null;
if (needsPhone) {
  if (!sync.phone) die('split beats need a phone master: run sync.mjs with --phone');
  if (!existsSync(phoneFile)) die(`phone file not found: ${phoneFile}`);
  if (!basename(phoneFile).includes('.blurred') && !args['allow-unblurred']) {
    die(`refusing ${basename(phoneFile)}: the phone input must be blur-face.py's output (*.blurred.*) so the face never reaches a clip`);
  }
}
const phoneProbe = needsPhone ? probe(phoneFile) : null;
const phone = needsPhone ? { ...sync.phone, startMac: sync.phone.startMac + nudge.phoneMs, durationS: phoneProbe.durationS } : null;

/** Narration lengths from a TTS'd storyboard, so cue beats can be trimmed (scene id = beat id or beat.scene). */
const storyboard = typeof args.storyboard === 'string' ? readJson(resolve(args.storyboard)) : null;
const narrationOf = (b) => b.narrationS ?? storyboard?.scenes?.find((s) => s.id === (b.scene ?? b.id))?.audioDuration;

// --- background plates ------------------------------------------------------------------------------------------
function ultrademoRoot() {
  if (typeof args['ultrademo-root'] === 'string') return resolve(args['ultrademo-root']);
  if (basename(dirname(projectDir)) === 'projects') return dirname(dirname(projectDir));
  return resolve(REPO_DIR, '..', 'ultrademo-workspace');
}

async function renderPlates(layouts) {
  const root = ultrademoRoot();
  let chromium;
  try {
    ({ chromium } = createRequire(join(root, 'package.json'))('playwright'));
  } catch {
    die(`Playwright not found under ${root}/node_modules (pass --ultrademo-root <workspace>)`);
  }
  mkdirSync(workDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const out = {};
    for (const layout of layouts) {
      // A fresh page per layout: going to the same file URL with only a new #hash would not re-run the template.
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const url = `${pathToFileURL(join(VIDEO_DIR, 'templates', 'frame-split.html')).href}#${encodeURIComponent(JSON.stringify(layout))}`;
      await page.goto(url);
      await page.waitForSelector('body[data-ready="1"]');
      out[layout.layout] = join(workDir, `frame-${layout.layout}.png`);
      await page.screenshot({ path: out[layout.layout] });
      await page.close();
      writeJson(join(workDir, `layout-${layout.layout}.json`), layout);
    }
    return out;
  } finally {
    await browser.close();
  }
}

// --- clips --------------------------------------------------------------------------------------------------------
const encode = ['-an', '-r', String(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

// Accurate input seeking drops every frame before the seek point, so a clip whose first source frame lands a hair
// after it (a 3-decimal seek a fraction of a ms before a 1/30 s frame time, or the VFR phone's last frame before the
// cut) started with ONE frame of the empty plate panel: a visible flash at split cuts. Both inputs now start on a
// real frame at t=0:
//   - TV (CFR, on the 1/30 s grid): seek half a frame early, so the cut frame is the first decoded one, then
//     rebase its timestamp to 0.
//   - phone (VFR): seek PHONE_PAD_S early, resample to 30 fps holding the latest frame (round=up: the frame shown
//     at t is the newest one with pts <= t, the same rule overlay used), then trim the pad away.
const PHONE_PAD_S = 1;

function renderClip(r, layout, plate, out) {
  const tvIn = ['-ss', Math.max(0, r.tvSeekS - 0.5 / FPS).toFixed(4), '-i', tvMaster];
  // Optional start hold: the first composed frame repeated holdFrames times before the footage plays.
  const finish = `${r.holdFrames ? `tpad=start_mode=clone:start=${r.holdFrames},` : ''}format=yuv420p[out]`;
  const frames = String(r.frames + (r.holdFrames ?? 0));
  // Optional per-beat zoom into the TV frame (source px, e.g. a small About-screen value); scaled to the same panel.
  const z = r.tvCrop;
  const tvScale = `setpts=PTS-STARTPTS,${z ? `crop=${z.w}:${z.h}:${z.x}:${z.y},` : ''}scale=${layout.tv.w}:${layout.tv.h}:flags=lanczos,setsar=1`;
  if (r.layout === 'tv') {
    ffmpeg(['-loop', '1', '-framerate', String(FPS), '-i', plate, ...tvIn, '-filter_complex',
      `[1:v]${tvScale}[tv];[0:v][tv]overlay=${layout.tv.x}:${layout.tv.y},${finish}`,
      '-map', '[out]', '-frames:v', frames, ...encode, out]);
    return;
  }
  const c = layout.crop;
  const pad = Math.min(PHONE_PAD_S, r.phoneSeekS);
  const phonePre = pad > 0 ? `fps=fps=${FPS}:round=up,trim=start=${pad.toFixed(4)},setpts=PTS-STARTPTS,` : 'setpts=PTS-STARTPTS,';
  ffmpeg(['-loop', '1', '-framerate', String(FPS), '-i', plate, ...tvIn, '-ss', (r.phoneSeekS - pad).toFixed(4), '-i', phoneFile, '-filter_complex',
    `[1:v]${tvScale}[tv];[2:v]${phonePre}crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${layout.phone.w}:${layout.phone.h}:flags=lanczos,setsar=1[ph];` +
      `[0:v][ph]overlay=${layout.phone.x}:${layout.phone.y}[a];[a][tv]overlay=${layout.tv.x}:${layout.tv.y},${finish}`,
    '-map', '[out]', '-frames:v', frames, ...encode, out]);
}

async function main() {
  const crop = beatsDoc.phoneCrop;
  const layouts = {
    split: needsPhone ? splitLayout({ phoneSrc: { w: phoneProbe.width, h: phoneProbe.height }, ...(crop ? { crop } : {}) }) : null,
    tv: tvLayout(),
  };
  const ctx = { fps: FPS, records, tv, phone };
  const resolved = beats.map((b) => {
    try {
      const z = b.tvCrop;
      if (z !== undefined) {
        const ok = ['x', 'y', 'w', 'h'].every((k) => Number.isInteger(z?.[k]) && z[k] >= 0 && z[k] % 2 === 0);
        if (!ok || z.w === 0 || z.h === 0 || z.x + z.w > 1920 || z.y + z.h > 1080) throw new Error(`tvCrop must be even integers inside 1920x1080: ${JSON.stringify(z)}`);
      }
      return { ...resolveBeat({ ...b, narrationS: b.cue !== undefined ? narrationOf(b) : b.narrationS }, ctx), tvCrop: z ?? null };
    } catch (err) {
      return die(`beat ${b.id}: ${err.message}`);
    }
  });
  for (const r of resolved) {
    console.log(`${r.id}: ${r.layout} ${r.durationS.toFixed(2)} s${r.holdFrames ? ` (incl. ${(r.holdFrames / FPS).toFixed(2)} s start hold)` : ''} (tv +${r.tvSeekS.toFixed(2)}${r.phoneSeekS !== null ? `, phone +${r.phoneSeekS.toFixed(2)}` : ''})${r.cues.length ? `, cue ${r.cues.map((c) => `#${c.setIndex}@${c.atS}s`).join(' ')}` : ''}`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
  }
  if (args['dry-run']) return;

  const plates = await renderPlates(Object.values(layouts).filter(Boolean));
  mkdirSync(capturesDir, { recursive: true });
  const manifestPath = join(capturesDir, 'compose-manifest.json');
  const manifest = readJson(manifestPath, { beats: [] });
  const entries = [];
  for (const r of resolved) {
    const clip = join(capturesDir, `${r.id}.mp4`);
    renderClip(r, layouts[r.layout], plates[r.layout], clip);
    ffmpeg(['-sseof', '-0.5', '-i', clip, '-update', '1', join(capturesDir, `${r.id}.png`)]);
    const extraAudio = [];
    for (const c of r.cues) {
      if (!c.file || !existsSync(join(runDir, c.file))) {
        console.log(`  warning: ${r.id}: cue ${c.setIndex} has no mp3 in the run (fetch-cues.mjs?)`);
        continue;
      }
      mkdirSync(cuesDir, { recursive: true });
      copyFileSync(join(runDir, c.file), join(cuesDir, c.file));
      extraAudio.push({ src: `cues/${c.file}`, at: c.atS, duration: Number(probe(join(cuesDir, c.file)).durationS.toFixed(3)), caption: `Coach: ${c.text}` });
    }
    const p = probe(clip);
    entries.push({
      id: r.id,
      layout: r.layout,
      clip: `captures/${r.id}.mp4`,
      screenshot: `captures/${r.id}.png`,
      clipDuration: Number(p.durationS.toFixed(3)),
      inMac: r.inMac,
      outMac: r.outMac,
      extraAudio,
      warnings: r.warnings,
    });
    console.log(`wrote ${clip} (${p.width}x${p.height}, ${p.fps} fps, ${p.durationS.toFixed(2)} s${p.hasAudio ? ', HAS AUDIO' : ''})`);
  }
  const kept = (manifest.beats ?? []).filter((b) => !entries.some((e) => e.id === b.id));
  writeJson(manifestPath, { run: runDir, updatedAt: new Date().toISOString(), fps: FPS, nudge, beats: [...kept, ...entries] });
  console.log(`manifest: ${manifestPath}`);
}

main().catch((err) => die(`compose failed: ${err.message ?? err}`));
