/**
 * Session timeline for the demo video: attaches to a live Session (like debug-session.ts, but read-only and
 * without creating a Session) and stamps every Phone Event and Coach message with the Mac clock.
 *
 * Writes into the run folder (scripts/video/runs/<runId>/):
 *   timeline.ndjson   one line per event: { macT, channel: events|coach|meta, event, data }
 *                     (hello, set_start, rep, set_end, control, thinking, cue; presence is skipped)
 *   cue-<setIndex>.mp3  each Cue's audio, downloaded the moment the Cue arrives (the signed audioUrl is only
 *                     valid 15 minutes, and it is the exact file the TV played; no AWS credentials needed)
 *   landmarks/couch-coach-landmarks-set<N>-<t>.json  every Set's pose frames (set_start..set_end), the same
 *                     couch-coach-landmarks/1 format as debug-session's RECORD_DIR, so filmed Sets double as data
 *   session.json      sessionId, attach time and the pairing token's expiry when --phone-url / --token is given
 *
 * Usage: cd scripts && npx tsx video/session-timeline.ts <sessionId> [--run <id> | --run-dir <path>]
 *          [--minutes 40] [--phone-url <url from the QR>] [--exit-after-end 60]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEventsClient } from '@couch-coach/events-client';
import {
  ClientConfig,
  channels,
  CoachMessage,
  PhoneEvent,
  PoseBatch,
  type PoseFrame,
  SessionId,
} from '@couch-coach/protocol';
import { newRunId, parseArgs, RUNS_DIR } from './lib/cli.mjs';
import { timelineRecord } from './lib/timeline.mjs';
import { expiryFromPhoneUrl, tokenExpiry } from './lib/verify.mjs';

const args = parseArgs(process.argv.slice(2));
const sessionId = SessionId.safeParse(args._[0]);
if (!sessionId.success) {
  console.error('usage: npx tsx video/session-timeline.ts <32-hex sessionId> [--run <id>] [--minutes 40] [--phone-url <url>]');
  process.exit(1);
}
const minutes = Number(args.minutes ?? 40);
const exitAfterEndS = Number(args['exit-after-end'] ?? 60);
const runDir =
  typeof args['run-dir'] === 'string' ? args['run-dir'] : join(RUNS_DIR, typeof args.run === 'string' ? args.run : newRunId());
const landmarksDir = join(runDir, 'landmarks');
const timelinePath = join(runDir, 'timeline.ndjson');
mkdirSync(landmarksDir, { recursive: true });

const config = ClientConfig.parse(
  JSON.parse(readFileSync(new URL('../../infra/client-config.json', import.meta.url), 'utf8')),
);

/** Appends one line per event right away, so a crash or Ctrl-C never loses what was already seen. */
function log(channel: string, payload: Record<string, unknown> & { type?: string }): void {
  appendFileSync(timelinePath, `${JSON.stringify(timelineRecord(Date.now(), channel, payload))}\n`);
}

const expiresAt =
  typeof args['phone-url'] === 'string'
    ? expiryFromPhoneUrl(args['phone-url'])
    : typeof args.token === 'string'
      ? tokenExpiry(args.token)
      : null;
writeFileSync(
  join(runDir, 'session.json'),
  `${JSON.stringify({ sessionId: sessionId.data, attachedAt: Date.now(), expiresAt, expiresAtSource: expiresAt ? 'phone token' : null }, null, 2)}\n`,
);

/** Downloads a Cue's signed audio the moment it arrives; logs where it went (never the signed URL). */
async function saveCueAudio(setIndex: number, audioUrl: string): Promise<void> {
  const started = Date.now();
  let file = `cue-${setIndex}.mp3`;
  for (let n = 2; existsSync(join(runDir, file)); n++) file = `cue-${setIndex}-${n}.mp3`;
  try {
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(runDir, file), bytes);
    log('meta', { type: 'cue_audio', setIndex, file, bytes: bytes.length, ms: Date.now() - started });
    console.log(`CUE AUDIO set ${setIndex} -> ${file} (${bytes.length} bytes)`);
  } catch (err) {
    log('meta', { type: 'cue_audio_error', setIndex, error: String(err) });
    console.log(`cue audio for set ${setIndex} FAILED: ${String(err)}; fall back to fetch-cues.mjs`);
  }
}

function main(): void {
  const ch = channels(sessionId.data!);
  let recording: { exercise: string; frames: PoseFrame[] } | null = null;
  let aspect: number | null = null;
  let endTimer: NodeJS.Timeout | null = null;

  const client = createEventsClient({
    httpHost: config.eventsHttpHost,
    realtimeHost: config.eventsRealtimeHost,
    apiKey: config.eventsApiKey,
  });
  client.onStatus((s) => {
    log('meta', { type: 'status', state: s.state, ...(s.error ? { error: String(s.error) } : {}) });
    console.log(`status ${s.state}${s.error ? `: ${String(s.error)}` : ''}`);
  });

  client.subscribe(ch.pose, (event) => {
    const batch = PoseBatch.safeParse(event);
    if (batch.success) recording?.frames.push(...batch.data.frames);
  });

  client.subscribe(ch.events, (event) => {
    const e = PhoneEvent.safeParse(event);
    if (!e.success) return log('meta', { type: 'bad_event', raw: JSON.stringify(event).slice(0, 300) });
    if (e.data.type === 'presence') return;
    log('events', e.data);
    console.log(`event ${e.data.type}${'setIndex' in e.data ? ` #${e.data.setIndex}` : ''}`);
    if (e.data.type === 'hello') aspect = e.data.aspect ?? aspect;
    if (e.data.type === 'set_start') recording = { exercise: e.data.exercise, frames: [] };
    if (e.data.type === 'set_end' && recording) {
      const path = join(landmarksDir, `couch-coach-landmarks-set${e.data.setIndex}-${e.data.t}.json`);
      const doc = { format: 'couch-coach-landmarks/1', exercise: recording.exercise, aspect, exportedAt: e.data.t, frames: recording.frames };
      writeFileSync(path, JSON.stringify(doc));
      console.log(`RECORDED ${recording.frames.length} frames -> ${path}`);
      recording = null;
    }
    if (e.data.type === 'control' && e.data.action === 'end_session' && !endTimer) {
      console.log(`end_session: detaching in ${exitAfterEndS} s`);
      endTimer = setTimeout(() => finish('end_session'), exitAfterEndS * 1000);
    }
  });

  client.subscribe(ch.coach, (event) => {
    const m = CoachMessage.safeParse(event);
    if (!m.success) return log('meta', { type: 'bad_coach', raw: JSON.stringify(event).slice(0, 300) });
    log('coach', m.data);
    if (m.data.type === 'thinking') console.log(`coach thinking (set ${m.data.setIndex})`);
    if (m.data.type === 'cue') {
      console.log(`CUE set ${m.data.setIndex}: ${m.data.text}`);
      if (m.data.audioUrl) void saveCueAudio(m.data.setIndex, m.data.audioUrl);
      else console.log('cue has no audioUrl (text only)');
    }
  });

  function finish(reason: string): void {
    log('meta', { type: 'detach', reason });
    client.close();
    console.log(`timeline finished (${reason}): ${timelinePath}`);
    // Give an in-flight Cue download a moment to land.
    setTimeout(() => process.exit(0), 3000);
  }

  log('meta', { type: 'attach', sessionId: sessionId.data, expiresAt });
  console.log(`attached to ${sessionId.data}; writing ${timelinePath}`);
  process.on('SIGINT', () => finish('SIGINT'));
  process.on('SIGTERM', () => finish('SIGTERM'));
  setTimeout(() => finish('timeout'), minutes * 60_000);
}

main();
