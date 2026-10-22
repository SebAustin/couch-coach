/**
 * Shared CLI plumbing for the demo-video tools: flag parsing, run folders (scripts/video/runs/<runId>/), child
 * processes (ffmpeg/ffprobe/adb) and JSON files. Every path may contain spaces and commas, so commands are
 * always spawned with argument arrays, never through a shell.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIDEO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = resolve(VIDEO_DIR, '../..');
export const RUNS_DIR = join(VIDEO_DIR, 'runs');
export const FPS = 30;

/** @typedef {{ [key: string]: string | boolean | string[], _: string[] }} Args */

/**
 * `--key value` and bare `--flag` (true); anything else lands in `_`. Same convention as publish-synthetic.mjs.
 * @param {string[]} argv
 * @returns {Args}
 */
export function parseArgs(argv) {
  /** @type {Args} */
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

/** "2026-10-22-1201" in local time. */
export function newRunId(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** --run-dir <path> | --run <id> | the newest folder in runs/ (or a new one when `create`). */
export function resolveRunDir(args, { create = false } = {}) {
  let dir;
  if (typeof args['run-dir'] === 'string') dir = resolve(args['run-dir']);
  else if (typeof args.run === 'string') dir = join(RUNS_DIR, args.run);
  else if (!create) {
    const runs = existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR).filter((n) => !n.startsWith('.')).sort() : [];
    if (!runs.length) throw new Error('no runs yet: pass --run <id> or --run-dir <path>');
    dir = join(RUNS_DIR, runs.at(-1));
  } else dir = join(RUNS_DIR, newRunId());
  if (create) mkdirSync(dir, { recursive: true });
  else if (!existsSync(dir)) throw new Error(`run folder not found: ${dir}`);
  return dir;
}

export function readJson(path, fallback) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Atomic write (tmp + rename) so an interrupted run never leaves half a JSON file. */
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/**
 * Runs a command; returns { stdout, stderr, status }. Throws (with the stderr tail) on a non-zero exit unless
 * `allowFail`.
 */
export function run(cmd, args, { allowFail = false, input, timeoutMs, env } = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    input,
    timeout: timeoutMs,
    env: env ?? process.env,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.error) {
    if (allowFail) return { stdout: '', stderr: String(r.error), status: -1 };
    throw new Error(`${cmd} failed to start: ${r.error.message}`);
  }
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.slice(0, 6).join(' ')} ... exited ${r.status}: ${String(r.stderr).trim().split('\n').slice(-6).join('\n')}`);
  }
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

export const ffmpeg = (args, opts) => run('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], opts);

/** ffprobe -> { durationS, width, height, fps, codec, frames, hasAudio, tags }. */
export function probe(file) {
  const { stdout } = run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const [num, den] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const rotation = Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0);
  const swap = Math.abs(rotation) % 180 === 90;
  return {
    durationS: Number(j.format?.duration ?? v?.duration ?? NaN),
    width: swap ? v?.height : v?.width,
    height: swap ? v?.width : v?.height,
    fps: den ? num / den : null,
    codec: v?.codec_name ?? null,
    frames: v?.nb_frames ? Number(v.nb_frames) : null,
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
    tags: { ...(j.format?.tags ?? {}), ...(v?.tags ?? {}) },
  };
}

export function die(msg) {
  console.error(msg);
  process.exit(1);
}
