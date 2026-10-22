#!/usr/bin/env node
/**
 * Records the Fire TV's own screen for the demo video, driven from the Mac over adb. The recording loop runs ON
 * the TV (ccrec.sh under nohup) so it survives adb drops; this script starts, checks, stops and pulls it.
 *
 *   node scripts/video/tv-record.mjs start  [--size 1920x1080] [--bit-rate 8000000] [--chunk 170]
 *   node scripts/video/tv-record.mjs status
 *   node scripts/video/tv-record.mjs stop
 *   node scripts/video/tv-record.mjs pull   [--keep]
 *   node scripts/video/tv-record.mjs probe  [--seconds 5] [--bugreport]     # pre-flight test clip + clock offset
 *
 * Flags for every command:
 *   --run <id> | --run-dir <path>   run folder (default: a new runs/<YYYY-MM-DD-HHMM> for start, else the newest)
 *   --serial <adb serial>           default $FIRE_TV_IP:5555 from apps/tv/.env.local; any other serial (e.g. an
 *                                   emulator) is used as-is, without reconnecting
 *   --remote-dir <dir>              default /sdcard/ccrec
 *   --reconnect                     force `adb kill-server && adb connect $FIRE_TV_IP:5555` first
 *   --force                         start: delete un-pulled chunks left on the TV; pull: pull while still recording
 *
 * Writes <run>/tv/: state.json, clock.json (TV-vs-Mac offset at start and stop, best of 5 round trips),
 * index.txt (TV clock stamp per chunk), logcat.txt, ccrec.log, NN.mp4 and chunks.json (ffprobe of each chunk).
 * Chunks are only pulled after the run (no Wi-Fi contention with the live pose stream), probed, then deleted
 * from the TV.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { bestOffset, nsToMs, parseDfAvailableKb, parseIndex } from './lib/clock.mjs';
import { die, parseArgs, probe, readJson, REPO_DIR, resolveRunDir, run, VIDEO_DIR, writeJson } from './lib/cli.mjs';

const REMOTE_SCRIPT = '/data/local/tmp/ccrec.sh';
/** Free space must hold this much recording at the chosen bit rate, plus the margin (a filming run is ~12 min). */
const PLANNED_RECORD_S = 20 * 60;
const FREE_MARGIN = 1.25;
const minFreeKb = (bitRate) => Math.ceil(((bitRate / 8) * PLANNED_RECORD_S * FREE_MARGIN) / 1024);
const gb = (kb) => (kb / 1024 / 1024).toFixed(2);
const CLOCK_SAMPLES = 5;
const EXPECTED_MODEL = 'AFTSSS';
/** Audio-player and app tags: when the TV started playing each Cue (expo-audio uses ExoPlayer). */
const LOGCAT_FILTER = ['ReactNativeJS:V', 'ReactNative:V', 'ExoPlayerImpl:V', 'ExoPlayer:V', 'AudioTrack:I', 'MediaCodec:I', 'ActivityManager:I', '*:S'];

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const remoteDir = String(args['remote-dir'] ?? '/sdcard/ccrec');
if (!/^\/[\w./-]+$/.test(remoteDir)) die(`--remote-dir must be a plain absolute path: ${remoteDir}`);

const macNow = () => performance.timeOrigin + performance.now();

function envLocal() {
  const file = join(REPO_DIR, 'apps/tv/.env.local');
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*["']?([^"'#\s]*)["']?/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}

/** adb from apps/tv/scripts/android-env.sh (Homebrew SDK), else whatever is on PATH. */
function adbBinary() {
  const envScript = join(REPO_DIR, 'apps/tv/scripts/android-env.sh');
  const r = run('bash', ['-c', 'source "$1" >/dev/null 2>&1; command -v adb', '_', envScript], { allowFail: true });
  return r.stdout.trim() || 'adb';
}

const ADB = adbBinary();
const fireTvIp = envLocal().FIRE_TV_IP;
const serial = String(args.serial ?? (fireTvIp ? `${fireTvIp}:5555` : ''));
if (command && command !== 'help' && !serial) die('no --serial and no FIRE_TV_IP in apps/tv/.env.local');
const isNetworkSerial = /^\d+\.\d+\.\d+\.\d+:\d+$/.test(serial);

const adb = (a, opts) => run(ADB, ['-s', serial, ...a], { timeoutMs: 120_000, ...opts });
const shell = (cmd, opts) => adb(['shell', cmd], opts).stdout;

function deviceState() {
  const { stdout } = run(ADB, ['devices'], { allowFail: true, timeoutMs: 20_000 });
  const line = stdout.split('\n').find((l) => l.split('\t')[0] === serial);
  return line?.split('\t')[1]?.trim() ?? 'absent';
}

function ensureConnected() {
  if (!args.reconnect && deviceState() === 'device') return;
  if (!isNetworkSerial) die(`adb device ${serial} is ${deviceState()}; check the emulator / USB connection`);
  console.log(`reconnecting: adb kill-server && adb connect ${serial}`);
  run(ADB, ['kill-server'], { allowFail: true, timeoutMs: 20_000 });
  run(ADB, ['connect', serial], { allowFail: true, timeoutMs: 20_000 });
  for (let i = 0; i < 10 && deviceState() !== 'device'; i++) run('sleep', ['1']);
  if (deviceState() !== 'device') die(`could not reach ${serial} (state ${deviceState()}): is the TV awake and on Wi-Fi, with ADB debugging on?`);
}

function pushScript() {
  adb(['push', join(VIDEO_DIR, 'ccrec.sh'), REMOTE_SCRIPT]);
  shell(`chmod 755 ${REMOTE_SCRIPT}`);
}

/** Best of CLOCK_SAMPLES round trips: { offsetMs (TV - Mac), rttMs, tvMs, macMid, n, method }. */
function sampleClock() {
  const samples = [];
  for (let i = 0; i < CLOCK_SAMPLES; i++) {
    const macBefore = macNow();
    const out = shell(`sh ${REMOTE_SCRIPT} now`);
    const macAfter = macNow();
    samples.push({ macBefore, macAfter, tvMs: nsToMs(out) });
  }
  return { ...bestOffset(samples), at: new Date().toISOString() };
}

function freeKb() {
  return parseDfAvailableKb(shell('df /sdcard'));
}

function remoteFiles() {
  const out = shell(`ls ${remoteDir} 2>/dev/null`, { allowFail: true });
  return out.split(/\s+/).filter(Boolean);
}

const remoteIndex = () => parseIndex(shell(`cat ${remoteDir}/index.txt 2>/dev/null`, { allowFail: true }));
const loopRunning = () => {
  const out = shell(`p=$(cat ${remoteDir}/screenrecord.pid 2>/dev/null); [ -n "$p" ] && kill -0 $p 2>/dev/null && echo yes`, { allowFail: true });
  return out.trim() === 'yes';
};

function tvDir() {
  return join(resolveRunDir(args, { create: command === 'start' || command === 'probe' }), 'tv');
}

async function start() {
  const size = String(args.size ?? '1920x1080');
  const bitRate = Number(args['bit-rate'] ?? 8_000_000);
  const chunkS = Number(args.chunk ?? 170);
  if (!/^\d{3,4}x\d{3,4}$/.test(size)) die(`--size must look like 1920x1080, got ${size}`);
  if (!Number.isInteger(bitRate) || bitRate < 500_000 || bitRate > 40_000_000) die(`--bit-rate out of range: ${bitRate}`);
  if (!Number.isInteger(chunkS) || chunkS < 1 || chunkS > 180) die(`--chunk must be 1..180 s (screenrecord's limit), got ${chunkS}`);
  const dir = tvDir();

  ensureConnected();
  const model = shell('getprop ro.product.model').trim();
  if (isNetworkSerial && model !== EXPECTED_MODEL) console.log(`warning: model is ${model}, expected ${EXPECTED_MODEL}`);
  const free = freeKb();
  const needKb = minFreeKb(bitRate);
  if (free < needKb) {
    die(`only ${gb(free)} GB free on /sdcard; ${PLANNED_RECORD_S / 60} min at ${bitRate / 1e6} Mbps needs ${gb(needKb)} GB (lower --bit-rate)`);
  }
  if (loopRunning()) die(`already recording into ${remoteDir}; run stop (and pull) first`);
  const leftovers = remoteFiles().filter((f) => /^\d+\.mp4$/.test(f));
  if (leftovers.length && !args.force) die(`un-pulled chunks on the TV (${leftovers.join(', ')}): run pull first, or pass --force to delete them`);

  pushScript();
  shell(`mkdir -p ${remoteDir} && rm -f ${remoteDir}/*.mp4 ${remoteDir}/index.txt ${remoteDir}/logcat.txt ${remoteDir}/ccrec.log ${remoteDir}/stop`);
  const clockStart = sampleClock();
  const filter = LOGCAT_FILTER.map((f) => `'${f}'`).join(' ');
  shell(`nohup sh ${REMOTE_SCRIPT} run ${remoteDir} ${size} ${bitRate} ${chunkS} ${filter} > ${remoteDir}/ccrec.log 2>&1 < /dev/null &`, { timeoutMs: 20_000 });
  writeJson(join(dir, 'state.json'), { serial, model, remoteDir, size, bitRate, chunkS, startedAt: new Date().toISOString(), freeKb: free });
  writeJson(join(dir, 'clock.json'), { start: clockStart });

  for (let i = 0; i < 20; i++) {
    await sleep(250);
    if (remoteIndex().chunks.length && loopRunning()) {
      console.log(`chunk 01 recording (${size} @ ${bitRate / 1e6} Mbps, ${chunkS} s chunks) on ${serial} (${model})`);
      console.log(`clock: TV - Mac = ${clockStart.offsetMs.toFixed(1)} ms (rtt ${clockStart.rttMs.toFixed(1)} ms); run folder ${dir}`);
      return;
    }
  }
  die(`recorder did not start; see: adb -s ${serial} shell cat ${remoteDir}/ccrec.log`);
}

function status() {
  ensureConnected();
  const index = remoteIndex();
  const files = remoteFiles();
  const running = loopRunning();
  const last = index.chunks.at(-1);
  console.log(`${serial}: ${running ? 'RECORDING' : 'not recording'}${index.doneTvMs ? ' (loop finished)' : ''}`);
  console.log(`chunks: ${index.chunks.length}${last ? `, last ${last.name}${last.endTvMs ? ` ended (exit ${last.exit})` : ' in progress'}` : ''}`);
  console.log(`files on TV: ${files.join(' ') || '(none)'}`);
  console.log(`free on /sdcard: ${(freeKb() / 1024 / 1024).toFixed(2)} GB`);
  if (index.notes.length) console.log(`notes: ${index.notes.join(' | ')}`);
  try {
    const c = sampleClock();
    console.log(`clock now: TV - Mac = ${c.offsetMs.toFixed(1)} ms (rtt ${c.rttMs.toFixed(1)} ms)`);
  } catch {
    console.log(`clock: ${REMOTE_SCRIPT} not on the TV yet (start or probe pushes it)`);
  }
}

async function stop() {
  ensureConnected();
  const dir = tvDir();
  shell(`touch ${remoteDir}/stop; p=$(cat ${remoteDir}/screenrecord.pid 2>/dev/null); if [ -n "$p" ]; then kill -INT $p; else pkill -INT screenrecord; fi`, { allowFail: true });
  let index = remoteIndex();
  for (let i = 0; i < 80 && index.doneTvMs === null; i++) {
    await sleep(250);
    index = remoteIndex();
  }
  if (index.doneTvMs === null) console.log('warning: the loop has not written "done" yet; check status before pulling');
  const clock = readJson(join(dir, 'clock.json'), {});
  const stopClock = sampleClock();
  writeJson(join(dir, 'clock.json'), { ...clock, stop: stopClock });
  const drift = clock.start ? stopClock.offsetMs - clock.start.offsetMs : null;
  console.log(`stopped: ${index.chunks.length} chunk(s); clock TV - Mac = ${stopClock.offsetMs.toFixed(1)} ms${drift === null ? '' : ` (drift ${drift.toFixed(1)} ms since start)`}`);
  console.log('next: node scripts/video/tv-record.mjs pull');
}

function pull() {
  ensureConnected();
  const dir = tvDir();
  const index = remoteIndex();
  if (loopRunning() && !args.force) die('still recording: run stop first (or --force to pull finished chunks only)');
  for (const f of ['index.txt', 'logcat.txt', 'ccrec.log']) adb(['pull', `${remoteDir}/${f}`, join(dir, f)], { allowFail: true });
  const live = loopRunning() ? index.chunks.at(-1)?.name : null;
  const names = remoteFiles().filter((f) => /^\d+\.mp4$/.test(f) && f !== `${live}.mp4`).sort();
  const previous = readJson(join(dir, 'chunks.json'), []);
  const chunks = [...previous.filter((c) => !names.includes(c.file))];
  for (const file of names) {
    const local = join(dir, file);
    adb(['pull', `${remoteDir}/${file}`, local]);
    const entry = { name: file.replace('.mp4', ''), file, bytes: statSync(local).size };
    try {
      const p = probe(local);
      // screenrecord only writes a frame when the screen changes: a static screen gives 1 frame and 0 s.
      const ok = p.codec === 'h264' && ((p.frames ?? 0) >= 1 || p.durationS > 0);
      const durationS = Number.isFinite(p.durationS) ? p.durationS : 0;
      chunks.push({ ...entry, ok, durationS, width: p.width, height: p.height, frames: p.frames, fps: p.fps });
      if (ok && !args.keep) shell(`rm -f ${remoteDir}/${file}`);
      console.log(`${file}: ${ok ? 'ok' : 'BAD'} ${durationS.toFixed(1)} s, ${p.frames ?? '?'} frames, ${p.width}x${p.height}, ${(entry.bytes / 1e6).toFixed(1)} MB${ok && !args.keep ? ', deleted from TV' : ''}`);
    } catch (err) {
      chunks.push({ ...entry, ok: false, error: String(err.message ?? err) });
      console.log(`${file}: UNREADABLE (${String(err.message ?? err).split('\n')[0]}); kept on the TV`);
    }
  }
  chunks.sort((a, b) => a.name.localeCompare(b.name));
  writeJson(join(dir, 'chunks.json'), chunks);
  // Wall-clock length from the TV stamps: a static screen makes the probed duration meaningless.
  const stamped = (c) => {
    const i = index.chunks.find((x) => x.name === c.name);
    return i?.endTvMs ? (i.endTvMs - i.startTvMs) / 1000 : c.durationS;
  };
  const total = chunks.filter((c) => c.ok).reduce((s, c) => s + stamped(c), 0);
  console.log(`${chunks.filter((c) => c.ok).length}/${chunks.length} chunk(s) ok, ${total.toFixed(1)} s of TV recording in ${dir}`);
  if (live) console.log(`chunk ${live} is still recording and was left on the TV`);
}

function probeRun() {
  const seconds = Number(args.seconds ?? 5);
  if (!(seconds > 0 && seconds <= 30)) die('--seconds must be 1..30');
  const size = String(args.size ?? '1920x1080');
  const bitRate = Number(args['bit-rate'] ?? 8_000_000);
  if (!/^\d{3,4}x\d{3,4}$/.test(size)) die(`--size must look like 1920x1080, got ${size}`);
  const dir = tvDir();
  ensureConnected();
  pushScript();
  const remote = '/sdcard/ccrec-probe.mp4';
  const clock = sampleClock();
  const before = nsToMs(shell(`sh ${REMOTE_SCRIPT} now`));
  shell(`screenrecord --size ${size} --bit-rate ${bitRate} --time-limit ${seconds}${args.bugreport ? ' --bugreport' : ''} ${remote}`, { timeoutMs: (seconds + 30) * 1000 });
  const local = join(dir, `probe${args.bugreport ? '-bugreport' : ''}.mp4`);
  adb(['pull', remote, local]);
  shell(`rm -f ${remote}`);
  const p = probe(local);
  writeJson(join(dir, 'probe.json'), { size, bitRate, seconds, tvStampBeforeMs: before, clock, probe: p });
  console.log(`probe ok: ${p.durationS.toFixed(2)} s, ${p.width}x${p.height}, ${p.frames ?? '?'} frames (screenrecord only writes changed frames), ${local}`);
  console.log(`clock: TV - Mac = ${clock.offsetMs.toFixed(1)} ms (rtt ${clock.rttMs.toFixed(1)} ms)`);
  if (args.bugreport) console.log('bugreport overlay: read the TV time on the first frame vs tvStampBeforeMs in probe.json -> recording start delay');
}

const commands = { start, status, stop, pull, probe: probeRun };
if (!commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n?/, '').replace(/^ \* ?/gm, ''));
  process.exit(command ? 1 : 0);
}
Promise.resolve(commands[command]()).catch((err) => die(`tv-record ${command} failed: ${err.message ?? err}`));
