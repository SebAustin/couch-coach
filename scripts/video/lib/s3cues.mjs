/**
 * Read-only S3 access for the Cue audio fallback: `aws s3 ls` and `aws s3 cp s3://... <local file>` only.
 * Every command is checked by assertReadOnly before it runs, so this can never write to AWS.
 */
import { join } from 'node:path';

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const SESSION_RE = /^[0-9a-f]{32}$/;
const READ_VERBS = new Set(['ls', 'cp']);
const WRITE_FLAGS = new Set(['--delete', '--acl', '--grants', '--website-redirect']);

/** @param {string[]} args the argv after `aws` */
export function assertReadOnly(args) {
  const fail = (why) => {
    throw new Error(`refusing a non read-only AWS command (${why}): aws ${args.join(' ')}`);
  };
  if (args[0] !== 's3') fail('only "aws s3" is allowed');
  if (!READ_VERBS.has(args[1])) fail(`"s3 ${args[1]}" is not ls/cp`);
  if (args.some((a) => WRITE_FLAGS.has(a))) fail('write flag');
  if (args[1] === 'cp') {
    const [src, dst] = args.slice(2, 4);
    if (!src?.startsWith('s3://')) fail('cp source must be s3://');
    if (!dst || dst.startsWith('s3://')) fail('cp destination must be a local file');
  }
  return true;
}

/**
 * @param {{ bucket: string, sessionId: string, calls: number[], outDir: string, profile?: string, region?: string }} o
 * @returns {{ cmd: 'aws', args: string[] }[]} an `ls` of the session folder, then one `cp` per call
 */
export function buildFetchCommands({ bucket, sessionId, calls, outDir, profile, region }) {
  if (!BUCKET_RE.test(bucket ?? '')) throw new Error(`invalid bucket name: ${bucket}`);
  if (!SESSION_RE.test(sessionId ?? '')) throw new Error(`invalid session id: ${sessionId}`);
  for (const c of calls) if (!Number.isInteger(c) || c < 1) throw new Error(`invalid call number: ${c}`);
  const extra = [...(profile ? ['--profile', profile] : []), ...(region ? ['--region', region] : [])];
  const prefix = `s3://${bucket}/audio/${sessionId}/`;
  const cmds = [
    { cmd: 'aws', args: ['s3', 'ls', prefix, ...extra] },
    ...calls.map((n) => ({ cmd: 'aws', args: ['s3', 'cp', `${prefix}${n}.mp3`, join(outDir, `call-${n}.mp3`), ...extra] })),
  ];
  for (const c of cmds) assertReadOnly(c.args);
  return cmds;
}

/** `aws s3 ls s3://bucket/audio/<sid>/` -> sorted call numbers. */
export function parseS3Ls(text) {
  return String(text)
    .split('\n')
    .map((l) => /\s(\d+)\.mp3\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
}
