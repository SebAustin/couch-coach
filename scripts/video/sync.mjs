#!/usr/bin/env node
/**
 * Puts the Fire TV and phone recordings on the Mac clock and writes <run>/sync/sync.json for compose.mjs.
 *
 *   node scripts/video/sync.mjs [--run <id> | --run-dir <path>] --phone <run>/phone/phone.blurred.mp4
 *        [--tv-start-delay-ms 0] [--window 1.5] [--min-score 0.03] [--phone-start-iso <ISO>]
 *        [--creation-is-end] [--rebuild] [--no-sheets] [--allow-unblurred]
 *
 * TV master (sync/tv-master.mp4, t=0 at tv.startMac): every chunk converted to a constant 30 fps (screenrecord only
 *   writes a frame when the screen changes) and placed by its TV clock stamp (tv/index.txt -> clock.json);
 *   the ~0.2 s gaps between chunks hold the last frame. Cached; --rebuild forces it.
 * Phone master: the blurred file from blur-face.py (already constant 30 fps). Start = its creation date (from
 *   blur-face's <file>.json, else the file tags; ~1 s accurate), refined by the median offset of the biggest
 *   screen change within ±window s of each set_start / set_end tap (phone clock, taken as = Mac clock).
 * Checks: phone->Mac receive delay over rep events (expect +100..400 ms) and the Cue card appearing on the TV
 *   vs the Cue's arrival at the listener (expect within 150 ms).
 * sync.json keeps a hand-edited `nudge: { tvMs, phoneMs }` across re-runs; compose.mjs adds it to each start.
 * Contact sheets: sync/contact-tv-NN.png and sync/contact-phone-NN.png (one tile per 10 s; times in
 *   sync/sheets.json) and sync/events/NN-<event>.png (TV | phone at each set_start, set_end and cue).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { makeTvToMac, parseIndex } from './lib/clock.mjs';
import { die, ffmpeg, FPS, parseArgs, probe, readJson, resolveRunDir, run, writeJson } from './lib/cli.mjs';
import { dropNear, median, parseCreationTime, parseSceneScores, pickChange, refineStart } from './lib/phonesync.mjs';
import { cuesOf, parseTimeline, repDelayMedianMs, setWindows } from './lib/timeline.mjs';
import { planTvMaster } from './lib/tvmaster.mjs';

const SHEET_EVERY_S = 10;
const CUE_CHECK_WINDOW_S = 2;
const CUE_CHECK_TOLERANCE_MS = 150;

const args = parseArgs(process.argv.slice(2));
const runDir = resolveRunDir(args);
const syncDir = join(runDir, 'sync');
const tvDir = join(runDir, 'tv');
mkdirSync(syncDir, { recursive: true });
const rel = (p) => (p.startsWith(runDir) ? relative(runDir, p) : p);
const abs = (p) => (isAbsolute(p) ? p : join(runDir, p));
const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.log(`warning: ${msg}`);
};

const { records } = parseTimeline(existsSync(join(runDir, 'timeline.ndjson')) ? readFileSync(join(runDir, 'timeline.ndjson'), 'utf8') : '');
if (!records.length) warn('no timeline.ndjson events: phone refinement and checks are skipped');
const previous = readJson(join(syncDir, 'sync.json'), {});
const nudge = { tvMs: 0, phoneMs: 0, ...(previous.nudge ?? {}) };

// --- TV master ------------------------------------------------------------------------------------------------
function buildTvMaster() {
  const clock = readJson(join(tvDir, 'clock.json'));
  const tvToMac = makeTvToMac(clock);
  const index = parseIndex(readFileSync(join(tvDir, 'index.txt'), 'utf8'));
  const probed = readJson(join(tvDir, 'chunks.json'), []);
  const startDelayMs = Number(args['tv-start-delay-ms'] ?? previous.tv?.startDelayMs ?? 0);
  const chunks = index.chunks
    .filter((c) => existsSync(join(tvDir, `${c.name}.mp4`)))
    .map((c) => {
      const file = join(tvDir, `${c.name}.mp4`);
      const p = probed.find((x) => x.name === c.name) ?? { ...probe(file), ok: true };
      if (p.ok === false) warn(`chunk ${c.name} failed its probe; skipped`);
      // A static screen gives a 1-frame chunk: the stamps, not the probe, say how long it really lasted.
      const stampedS = c.endTvMs ? (c.endTvMs - c.startTvMs - startDelayMs) / 1000 : 0;
      return { name: c.name, file, startTvMs: c.startTvMs, durationS: Math.max(p.durationS || 0, stampedS), ok: p.ok !== false };
    })
    .filter((c) => c.ok);
  if (!chunks.length) die(`no TV chunks in ${tvDir}: run tv-record.mjs pull first`);
  const plan = planTvMaster(chunks, { tvToMac, startDelayMs, fps: FPS });
  const master = join(syncDir, 'tv-master.mp4');
  const planKey = JSON.stringify(plan.segments.map(({ name, frames, contentFrames }) => [name, frames, contentFrames]));
  if (!args.rebuild && existsSync(master) && previous.tv?.planKey === planKey) {
    console.log(`TV master up to date (${plan.durationS.toFixed(1)} s)`);
  } else {
    const segDir = join(syncDir, 'segments');
    rmSync(segDir, { recursive: true, force: true });
    mkdirSync(segDir, { recursive: true });
    const list = plan.segments.map((s) => {
      const out = join(segDir, `${s.name}.mp4`);
      const padS = (s.holdFrames + FPS) / FPS;
      ffmpeg(['-i', s.file, '-an', '-vf', `fps=${FPS},tpad=stop_mode=clone:stop_duration=${padS.toFixed(3)},format=yuv420p`,
        '-frames:v', String(s.frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-r', String(FPS), out]);
      console.log(`segment ${s.name}: ${s.frames} frames (${s.holdFrames} held${s.trimmedFrames ? `, ${s.trimmedFrames} trimmed` : ''})`);
      return `file '${out.replace(/'/g, "'\\''")}'`;
    });
    writeFileSync(join(segDir, 'list.txt'), `${list.join('\n')}\n`);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', join(segDir, 'list.txt'), '-c', 'copy', '-movflags', '+faststart', master]);
    rmSync(segDir, { recursive: true, force: true });
  }
  const p = probe(master);
  for (const g of plan.gaps) console.log(`TV gap after chunk ${g.afterChunk}: ${(g.durationS * 1000).toFixed(0)} ms held at +${((g.atMac - plan.startMac) / 1000).toFixed(2)} s`);
  return {
    master: rel(master),
    startMac: plan.startMac,
    durationS: p.durationS,
    width: p.width,
    height: p.height,
    startDelayMs,
    gaps: plan.gaps,
    segments: plan.segments.map(({ file, ...s }) => ({ ...s, file: rel(file) })),
    clockMethod: index.method,
    clock,
    planKey,
  };
}

// --- scene changes ------------------------------------------------------------------------------------------------
/** Scene-change scores of `file` between fromS and toS (low-res decode, so it is quick). */
function sceneScores(file, fromS, toS) {
  const start = Math.max(0, fromS);
  const { stdout } = run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', start.toFixed(3), '-t', (toS - start).toFixed(3), '-i', file,
    '-an', '-vf', 'scale=160:-2,select=gte(scene\\,0),metadata=print:file=-', '-f', 'null', '-']);
  return parseSceneScores(stdout, start);
}

const windowS = Number(args.window ?? 1.5);
const minScore = Number(args['min-score'] ?? 0.03);

// --- phone master -------------------------------------------------------------------------------------------------
function phoneMaster() {
  const file = resolve(String(args.phone ?? (previous.phone?.master ? abs(previous.phone.master) : '')));
  if (!args.phone && !previous.phone) die('--phone <phone.blurred.mp4> is required');
  if (!existsSync(file)) die(`phone file not found: ${file}`);
  if (!basename(file).includes('.blurred') && !args['allow-unblurred']) {
    die(`${basename(file)} is not a blur-face.py output (*.blurred.*): blur the face first, the contact sheets would show it`);
  }
  const p = probe(file);
  const sidecar = readJson(`${file}.json`, null);
  let creationMac = parseCreationTime(sidecar?.sourceTags ?? {}) ?? parseCreationTime(p.tags);
  let creationSource = sidecar?.sourceTags ? 'blur-face sidecar' : 'file tags';
  if (typeof args['phone-start-iso'] === 'string') {
    creationMac = Date.parse(args['phone-start-iso']);
    creationSource = '--phone-start-iso';
  }
  if (!Number.isFinite(creationMac)) die('no creation date on the phone file: AirDrop with "All Photos Data", or pass --phone-start-iso');
  if (args['creation-is-end']) creationMac -= p.durationS * 1000;

  const pairs = [];
  for (const s of setWindows(records)) {
    for (const [kind, phoneT] of [['set_start', s.startPhone], ['set_end', s.endPhone]]) {
      if (typeof phoneT !== 'number') continue;
      const predictedS = (phoneT - creationMac) / 1000;
      if (predictedS < 0 || predictedS > p.durationS) continue;
      const hit = pickChange(sceneScores(file, predictedS - windowS - 0.2, predictedS + windowS + 0.2), predictedS, windowS, minScore);
      if (hit) pairs.push({ kind, setIndex: s.setIndex, predictedS, detectedS: hit.t, score: hit.score });
      else warn(`no screen change near ${kind} #${s.setIndex} on the phone (±${windowS} s)`);
    }
  }
  const refined = refineStart(creationMac, pairs);
  const spread = pairs.length > 1 ? Math.max(...refined.deltasS) - Math.min(...refined.deltasS) : 0;
  if (spread > 0.5) warn(`phone refinement deltas spread ${spread.toFixed(2)} s: check sync/events/*.png and set nudge.phoneMs`);
  console.log(`phone: creation ${new Date(creationMac).toISOString()} (${creationSource}), refined ${refined.refineMs} ms from ${pairs.length} change(s)`);
  return {
    master: rel(file),
    creationMac,
    creationSource,
    refineMs: refined.refineMs,
    pairs,
    startMac: refined.startMac,
    durationS: p.durationS,
    width: p.width,
    height: p.height,
  };
}

// --- checks ---------------------------------------------------------------------------------------------------------
function checks(tv) {
  const repDelay = repDelayMedianMs(records);
  if (repDelay !== null) {
    console.log(`rep receive delay (phone -> Mac): median ${repDelay.toFixed(0)} ms`);
    if (repDelay < 0 || repDelay > 1000) warn(`rep delay ${repDelay.toFixed(0)} ms is outside 0..1000 ms: the phone clock may be off; adjust nudge.phoneMs`);
  }
  const tvStart = tv.startMac + nudge.tvMs;
  // Chunk switches (and the end of each held gap) jump the picture; they are not the Cue card appearing.
  const cuts = tv.segments.slice(1).flatMap((s) => [s.startFrame / FPS, (s.startFrame - s.holdFrames) / FPS]);
  const cueCard = cuesOf(records).map((c) => {
    const predictedS = (c.macT - tvStart) / 1000;
    if (predictedS < 0 || predictedS > tv.durationS) return { setIndex: c.setIndex, deltaMs: null, note: 'outside the TV footage' };
    const scores = dropNear(sceneScores(abs(tv.master), predictedS - CUE_CHECK_WINDOW_S, predictedS + CUE_CHECK_WINDOW_S), cuts, 1.5 / FPS);
    const hit = pickChange(scores, predictedS, CUE_CHECK_WINDOW_S, minScore);
    const deltaMs = hit ? Math.round((hit.t - predictedS) * 1000) : null;
    console.log(`cue ${c.setIndex}: TV card ${deltaMs === null ? 'not found' : `${deltaMs > 0 ? '+' : ''}${deltaMs} ms`} vs listener`);
    if (deltaMs !== null && Math.abs(deltaMs) > CUE_CHECK_TOLERANCE_MS) warn(`cue ${c.setIndex} card is ${deltaMs} ms off the listener: check tv start delay / nudge.tvMs`);
    return { setIndex: c.setIndex, deltaMs };
  });
  const latency = cuesOf(records)
    .map((c) => {
      const end = records.find((r) => r.event === 'set_end' && r.data.setIndex === c.setIndex);
      return end ? { setIndex: c.setIndex, setEndToCueS: Math.round(c.macT - end.macT) / 1000 } : null;
    })
    .filter(Boolean);
  for (const l of latency) console.log(`set ${l.setIndex}: "End set" -> Cue in ${l.setEndToCueS.toFixed(2)} s`);
  const median_ = median(cueCard.map((c) => c.deltaMs).filter((d) => d !== null));
  return { repDelayMedianMs: repDelay, cueCard, cueCardMedianMs: median_, setEndToCue: latency };
}

// --- contact sheets -----------------------------------------------------------------------------------------------
function sheets(tv, phone) {
  for (const f of readdirSync(syncDir)) if (/^contact-.*\.png$/.test(f)) rmSync(join(syncDir, f));
  const eventsDir = join(syncDir, 'events');
  rmSync(eventsDir, { recursive: true, force: true });
  mkdirSync(eventsDir, { recursive: true });
  ffmpeg(['-i', abs(tv.master), '-vf', `fps=1/${SHEET_EVERY_S},scale=320:-2,tile=6x6`, join(syncDir, 'contact-tv-%02d.png')]);
  if (phone) ffmpeg(['-i', abs(phone.master), '-vf', `fps=1/${SHEET_EVERY_S},scale=-2:360,tile=12x3`, join(syncDir, 'contact-phone-%02d.png')]);
  const tvStart = tv.startMac + nudge.tvMs;
  const phoneStart = phone ? phone.startMac + nudge.phoneMs : null;
  const at = (start, durationS, mac) => {
    const t = (mac - start) / 1000;
    return t >= 0 && t < durationS ? t : null;
  };
  const marks = records.filter((r) => ['set_start', 'set_end', 'cue'].includes(r.event));
  marks.forEach((r, i) => {
    const tvT = at(tvStart, tv.durationS, r.macT);
    const phT = phone ? at(phoneStart, phone.durationS, r.macT) : null;
    if (tvT === null && phT === null) return;
    const out = join(eventsDir, `${String(i + 1).padStart(2, '0')}-${r.event}${r.data?.setIndex ? `-${r.data.setIndex}` : ''}.png`);
    const inputs = [...(tvT !== null ? ['-ss', tvT.toFixed(3), '-i', abs(tv.master)] : []), ...(phT !== null ? ['-ss', phT.toFixed(3), '-i', abs(phone.master)] : [])];
    const graph = tvT !== null && phT !== null ? '[0:v]scale=-2:540[a];[1:v]scale=-2:540[b];[a][b]hstack=inputs=2' : '[0:v]scale=-2:540';
    ffmpeg([...inputs, '-filter_complex', graph, '-frames:v', '1', out]);
  });
  writeJson(join(syncDir, 'sheets.json'), {
    everyS: SHEET_EVERY_S,
    tv: { tilesPerSheet: 36, startMac: tvStart },
    phone: phone ? { tilesPerSheet: 36, startMac: phoneStart } : null,
    note: 'tile k (0-based, across sheets) shows master time k * everyS; Mac time = startMac + k * everyS * 1000',
  });
  console.log(`contact sheets and ${readdirSync(eventsDir).length} event frame(s) in ${syncDir}`);
}

// --- main -----------------------------------------------------------------------------------------------------------
const tv = buildTvMaster();
const phone = args.phone || previous.phone ? phoneMaster() : null;
if (!phone) warn('no --phone: TV-only sync');
const result = {
  version: 1,
  fps: FPS,
  createdAt: new Date().toISOString(),
  tv,
  phone,
  checks: checks(tv),
  nudge,
  warnings,
};
writeJson(join(syncDir, 'sync.json'), result);
if (!args['no-sheets']) sheets(tv, phone);
console.log(`wrote ${join(syncDir, 'sync.json')}${nudge.tvMs || nudge.phoneMs ? ` (nudge tv ${nudge.tvMs} ms, phone ${nudge.phoneMs} ms)` : ''}`);
