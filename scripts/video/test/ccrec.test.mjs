/**
 * Runs the on-TV loop (ccrec.sh) locally with stub `screenrecord` / `logcat` binaries: chunks are written back to
 * back, the stop flag + SIGINT ends the current chunk cleanly, and index.txt parses.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { nsToMs, parseIndex } from '../lib/clock.mjs';

const CCREC = fileURLToPath(new URL('../ccrec.sh', import.meta.url));

const SCREENRECORD_STUB = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const out = args.at(-1);
const limit = Number(args[args.indexOf('--time-limit') + 1] ?? 3);
fs.writeFileSync(out, 'partial');
const finish = (how) => { fs.writeFileSync(out, 'final ' + how); process.exit(0); };
process.on('SIGINT', () => finish('sigint'));
setTimeout(() => finish('limit'), limit * 1000);
`;
const LOGCAT_STUB = '#!/bin/sh\necho "logcat $*"\nexec sleep 600\n';

test('ccrec.sh now prints a nanosecond stamp close to the Mac clock', () => {
  const r = spawnSync('sh', [CCREC, 'now'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(Math.abs(nsToMs(r.stdout) - Date.now()) < 2000);
});

test('ccrec.sh run records chunks until the stop flag and ends the live chunk on SIGINT', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ccrec-'));
  const bin = join(root, 'bin');
  const dir = join(root, 'rec');
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'screenrecord'), SCREENRECORD_STUB);
  writeFileSync(join(bin, 'logcat'), LOGCAT_STUB);
  chmodSync(join(bin, 'screenrecord'), 0o755);
  chmodSync(join(bin, 'logcat'), 0o755);

  const child = spawn('sh', [CCREC, 'run', dir, '1280x720', '4000000', '1', 'ReactNativeJS:V', '*:S'], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    stdio: 'ignore',
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  await sleep(2600);
  writeFileSync(join(dir, 'stop'), '');
  const pidFile = join(dir, 'screenrecord.pid');
  if (existsSync(pidFile)) process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGINT');
  const code = await Promise.race([exited, sleep(10_000).then(() => 'timeout')]);
  assert.equal(code, 0);

  const index = parseIndex(readFileSync(join(dir, 'index.txt'), 'utf8'));
  assert.ok(['date', 'epochrealtime', 'seconds'].includes(index.method));
  assert.ok(index.chunks.length >= 2, JSON.stringify(index.chunks));
  assert.ok(index.chunks.every((c) => c.endTvMs !== null && c.exit === 0));
  assert.notEqual(index.doneTvMs, null);
  for (const c of index.chunks) assert.match(readFileSync(join(dir, `${c.name}.mp4`), 'utf8'), /^final /);
  assert.match(readFileSync(join(dir, 'logcat.txt'), 'utf8'), /logcat -v epoch -T 1 ReactNativeJS:V \*:S/);
  assert.equal(existsSync(pidFile), false);
});
