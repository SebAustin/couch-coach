#!/usr/bin/env node
/**
 * Fallback for Cue audio the timeline listener missed: copies s3://<bucket>/audio/<sessionId>/<call>.mp3 down
 * with the AWS CLI. READ-ONLY by construction: only `aws s3 ls` and `aws s3 cp s3://... <local file>` are built,
 * and each command passes assertReadOnly before it runs. Run it the same day: the audio objects expire after
 * a day.
 *
 *   node scripts/video/fetch-cues.mjs --bucket <audio bucket from CouchCoachStack> --session <sessionId>
 *        [--run <id> | --run-dir <path>] [--calls 1,2,3] [--profile <aws profile>] [--region <region>] [--dry-run]
 *
 * Without --calls, the call numbers come from the timeline's cue records (audio key audio/<sid>/<call>.mp3),
 * else from an `aws s3 ls` of the session folder. Files land as <run>/call-<n>.mp3; when the timeline maps the
 * call to a Set, a missing cue-<setIndex>.mp3 is filled from it (an existing one is never overwritten).
 * `call` is also the number in the coach Lambda's "coach call accepted" log line.
 */
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { die, parseArgs, resolveRunDir, run } from './lib/cli.mjs';
import { assertReadOnly, buildFetchCommands, parseS3Ls } from './lib/s3cues.mjs';
import { cuesOf, parseTimeline } from './lib/timeline.mjs';

const args = parseArgs(process.argv.slice(2));
const bucket = typeof args.bucket === 'string' ? args.bucket : die('--bucket <name> is required');
const sessionId = typeof args.session === 'string' ? args.session : die('--session <32-hex id> is required');
const dryRun = Boolean(args['dry-run']);
const runDir = resolveRunDir(args, { create: true });
const profile = typeof args.profile === 'string' ? args.profile : undefined;
const region = typeof args.region === 'string' ? args.region : undefined;

const timelinePath = join(runDir, 'timeline.ndjson');
const cues = existsSync(timelinePath) ? cuesOf(parseTimeline(readFileSync(timelinePath, 'utf8')).records) : [];

/** Runs one AWS CLI command after the read-only check (or prints it with --dry-run). */
function aws(cmdArgs) {
  assertReadOnly(cmdArgs);
  console.log(`aws ${cmdArgs.join(' ')}`);
  return dryRun ? '' : run('aws', cmdArgs, { timeoutMs: 120_000 }).stdout;
}

let calls = typeof args.calls === 'string' ? args.calls.split(',').map(Number) : cues.map((c) => c.call).filter((n) => n !== null);
let built;
try {
  built = buildFetchCommands({ bucket, sessionId, calls, outDir: runDir, profile, region });
} catch (err) {
  die(String(err.message ?? err));
}
const [list, ...copies] = built;
const listed = parseS3Ls(aws(list.args));
if (!calls.length) {
  calls = listed;
  if (!calls.length && !dryRun) die(`nothing under s3://${bucket}/audio/${sessionId}/ (expired, or wrong bucket/session?)`);
}
const commands = copies.length ? copies : buildFetchCommands({ bucket, sessionId, calls, outDir: runDir, profile, region }).slice(1);

for (const c of commands) {
  try {
    aws(c.args);
  } catch (err) {
    console.log(`  failed: ${String(err.message ?? err).split('\n')[0]}`);
  }
}

for (const n of calls) {
  const src = join(runDir, `call-${n}.mp3`);
  const cue = cues.find((c) => c.call === n);
  if (!cue || dryRun || !existsSync(src)) continue;
  const dst = join(runDir, `cue-${cue.setIndex}.mp3`);
  if (existsSync(dst)) console.log(`cue-${cue.setIndex}.mp3 already there (listener copy kept); call-${n}.mp3 is the S3 copy`);
  else {
    copyFileSync(src, dst);
    console.log(`call ${n} -> cue-${cue.setIndex}.mp3`);
  }
}
console.log(dryRun ? 'dry run: nothing was fetched' : `done: ${calls.length} call(s) into ${runDir}`);
