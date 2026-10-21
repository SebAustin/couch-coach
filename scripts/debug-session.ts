/**
 * Live debug Session: stands in for the TV so a real Camera Phone can be checked without the APK.
 *
 * Creates a Session for the "Debug" Member, prints the phone link, then prints one summary line
 * every 2 s (pose batches, visibility of the joints rep counting needs) plus every Phone Event.
 *
 * Summary lines are only printed when the visibility profile changes (25% buckets) or every 20 s.
 *
 * With RECORD_DIR set, every Set is also saved (from set_start to set_end) as a
 * `couch-coach-landmarks/1` file, the same format as the phone's "Export last 30 s".
 *
 * Usage: [RECORD_DIR=dir] npx tsx debug-session.ts [minutes] [existing sessionId to re-attach to]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEventsClient } from '@couch-coach/events-client';
import {
  ClientConfig,
  channels,
  CoachMessage,
  decodeFrame,
  type Member,
  PhoneEvent,
  PoseBatch,
  type PoseFrame,
  SessionResponse,
} from '@couch-coach/protocol';

const SUMMARY_EVERY_MS = 2000;
const DEBUG_MEMBER_NAME = 'Debug';
/** MediaPipe indices: shoulders 11/12, hips 23/24, knees 25/26, ankles 27/28, wrists 15/16. */
const JOINTS: Record<string, readonly number[]> = {
  shoulders: [11, 12],
  wrists: [15, 16],
  hips: [23, 24],
  knees: [25, 26],
  ankles: [27, 28],
};
const VISIBLE = 0.5;

const QUIET_REPEAT_MS = 20_000;
const minutes = Number(process.argv[2] ?? 20);
const reattachSessionId = process.argv[3];
const recordDir = process.env.RECORD_DIR;
const config = ClientConfig.parse(
  JSON.parse(readFileSync(new URL('../infra/client-config.json', import.meta.url), 'utf8')),
);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function createSession(): Promise<string> {
  const { members } = await api<{ members: Member[] }>('/members');
  const member =
    members.find((m) => m.name === DEBUG_MEMBER_NAME) ??
    (await api<Member>('/members', { method: 'POST', body: JSON.stringify({ name: DEBUG_MEMBER_NAME }) }));
  const session = SessionResponse.parse(
    await api('/session', { method: 'POST', body: JSON.stringify({ memberId: member.memberId }) }),
  );
  console.log(`PHONE LINK: ${session.phoneUrl}&m=${member.memberId}`);
  return session.sessionId;
}

async function main() {
  const sessionId = reattachSessionId ?? (await createSession());
  const ch = channels(sessionId);
  let recording: { exercise: string; frames: PoseFrame[] } | null = null;
  let aspect: number | null = null;
  let lastProfile = '';
  let lastPrintedAt = 0;

  const tv = createEventsClient({
    httpHost: config.eventsHttpHost,
    realtimeHost: config.eventsRealtimeHost,
    apiKey: config.eventsApiKey,
  });
  tv.onStatus((s) => s.error && console.log(`status ${s.state}: ${String(s.error)}`));

  let batches = 0;
  let frames = 0;
  let emptyFrames = 0;
  const visibleCounts: Record<string, number> = Object.fromEntries(Object.keys(JOINTS).map((k) => [k, 0]));

  tv.subscribe(ch.pose, (event) => {
    const batch = PoseBatch.safeParse(event);
    if (!batch.success) return console.log(`bad pose batch: ${batch.error.issues[0]?.message}`);
    batches++;
    recording?.frames.push(...batch.data.frames);
    for (const frame of batch.data.frames) {
      frames++;
      const { pose } = decodeFrame(frame);
      if (pose.every((p) => p.visibility < VISIBLE)) emptyFrames++;
      for (const [name, idx] of Object.entries(JOINTS)) {
        if (idx.some((i) => (pose[i]?.visibility ?? 0) >= VISIBLE)) visibleCounts[name]!++;
      }
    }
  });
  tv.subscribe(ch.events, (event) => {
    const e = PhoneEvent.safeParse(event);
    console.log(e.success ? `event ${JSON.stringify(e.data)}` : `bad event ${JSON.stringify(event)}`);
    if (!e.success || !recordDir) return;
    if (e.data.type === 'hello') aspect = e.data.aspect ?? aspect;
    if (e.data.type === 'set_start') recording = { exercise: e.data.exercise, frames: [] };
    if (e.data.type === 'set_end' && recording) {
      mkdirSync(recordDir, { recursive: true });
      const path = join(recordDir, `couch-coach-landmarks-set${e.data.setIndex}-${e.data.t}.json`);
      const doc = { format: 'couch-coach-landmarks/1', exercise: recording.exercise, aspect, exportedAt: e.data.t, frames: recording.frames };
      writeFileSync(path, JSON.stringify(doc));
      console.log(`RECORDED ${recording.frames.length} frames → ${path}`);
      recording = null;
    }
  });
  tv.subscribe(ch.coach, (event) => {
    const m = CoachMessage.safeParse(event);
    if (m.success) console.log(`coach ${m.data.type}${m.data.type === 'cue' ? `: ${m.data.text}` : ''}`);
  });

  const timer = setInterval(() => {
    if (frames === 0) return;
    const pct = (n: number) => `${Math.round((100 * n) / frames)}%`;
    const joints = Object.entries(visibleCounts)
      .map(([k, n]) => `${k} ${pct(n)}`)
      .join(', ');
    const bucket = (n: number) => Math.round((4 * n) / frames);
    const profile = [emptyFrames, ...Object.values(visibleCounts)].map(bucket).join(',');
    if (profile !== lastProfile || Date.now() - lastPrintedAt > QUIET_REPEAT_MS) {
      console.log(`pose ${frames} frames/${SUMMARY_EVERY_MS / 1000}s; no person ${pct(emptyFrames)}; visible: ${joints}`);
      lastProfile = profile;
      lastPrintedAt = Date.now();
    }
    batches = 0;
    frames = 0;
    emptyFrames = 0;
    for (const k of Object.keys(visibleCounts)) visibleCounts[k] = 0;
  }, SUMMARY_EVERY_MS);

  setTimeout(() => {
    clearInterval(timer);
    tv.close();
    console.log('debug session finished');
    process.exit(0);
  }, minutes * 60_000);
}

main().catch((err) => {
  console.log(`debug session failed: ${String(err)}`);
  process.exit(1);
});
