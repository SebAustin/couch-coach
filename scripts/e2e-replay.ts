/**
 * End-to-end replay against the deployed stack.
 *
 * Plays the Camera Phone and the TV at once: the "phone" publishes synthetic pose batches and
 * set summaries, the "TV" subscribes, and the script checks the PLAN success criteria
 *   SC1  keypoint latency phone publish → TV receive, p95 < 300 ms
 *   SC5  set end (POST /coach) → Cue on the coach channel, p95 < 5 s
 *
 * Usage: npm run e2e [-- --batches 75 --sets 3]
 */
import { readFileSync } from 'node:fs';
import { createEventsClient } from '@couch-coach/events-client';
import {
  ClientConfig,
  CoachMessage,
  channels,
  encodeFrame,
  KEYPOINT_COUNT,
  type Member,
  PoseBatch,
  SessionResponse,
  type SetSummary,
} from '@couch-coach/protocol';

const SC1_P95_MS = 300;
const SC5_P95_MS = 5000;
const BATCH_INTERVAL_MS = 200;
const FRAMES_PER_BATCH = 3;
const CUE_TIMEOUT_MS = 15_000;
const SETTLE_MS = 1500;
const E2E_MEMBER_NAME = 'E2E Replay';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!);
const batchCount = Number(args.get('batches') ?? 75);
const setCount = Number(args.get('sets') ?? 3);

const config = ClientConfig.parse(
  JSON.parse(readFileSync(new URL('../infra/client-config.json', import.meta.url), 'utf8')),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function findOrCreateMember(): Promise<Member> {
  const { members } = await api<{ members: Member[] }>('/members?includeHidden=1');
  const existing = members.find((m) => m.name === E2E_MEMBER_NAME);
  if (existing) return existing;
  return api<Member>('/members', { method: 'POST', body: JSON.stringify({ name: E2E_MEMBER_NAME }) });
}

/** A standing figure whose hips dip with `phase` so the frames are not all identical. */
function syntheticPose(phase: number) {
  return Array.from({ length: KEYPOINT_COUNT }, (_, i) => ({
    x: 0.3 + (i % 11) * 0.04,
    y: Math.min(0.98, 0.1 + i * 0.025 + (i >= 23 ? 0.05 * Math.sin(phase) : 0)),
    visibility: 0.95,
  }));
}

const SETS: SetSummary[] = [
  { exercise: 'squat', reps: 8, score: 74, faults: { knees_caving: 3, shallow_depth: 1 }, durationMs: 24_000 },
  { exercise: 'squat', reps: 10, score: 88, faults: { knees_caving: 1 }, durationMs: 28_000 },
  { exercise: 'jumping_jack', reps: 15, score: 80, faults: { arms_not_overhead: 2 }, durationMs: 20_000 },
];

async function main() {
  const member = await findOrCreateMember();
  const session = SessionResponse.parse(
    await api('/session', { method: 'POST', body: JSON.stringify({ memberId: member.memberId }) }),
  );
  const ch = channels(session.sessionId);
  console.log(`session ${session.sessionId} for member "${member.name}"`);

  const clientOptions = {
    httpHost: config.eventsHttpHost,
    realtimeHost: config.eventsRealtimeHost,
    apiKey: config.eventsApiKey,
  };
  const tv = createEventsClient(clientOptions);
  const phone = createEventsClient(clientOptions);
  tv.onStatus((s) => s.error && console.error('tv status', s.state, s.error));
  phone.onStatus((s) => s.error && console.error('phone status', s.state, s.error));

  const poseLatencies: number[] = [];
  tv.subscribe(ch.pose, (event) => {
    const batch = PoseBatch.safeParse(event);
    if (batch.success) poseLatencies.push(Date.now() - batch.data.frames.at(-1)!.t);
  });

  const cueWaiters = new Map<number, (msg: { text: string; audioUrl?: string }) => void>();
  tv.subscribe(ch.coach, (event) => {
    const msg = CoachMessage.safeParse(event);
    if (msg.success && msg.data.type === 'cue') cueWaiters.get(msg.data.setIndex)?.(msg.data);
  });
  await sleep(SETTLE_MS); // let both sockets ack and subscribe before measuring

  // SC1: stream pose batches at the phone's real cadence.
  for (let b = 0; b < batchCount; b++) {
    const now = Date.now();
    const frames = Array.from({ length: FRAMES_PER_BATCH }, (_, f) =>
      encodeFrame(syntheticPose((b * FRAMES_PER_BATCH + f) / 5), now - (FRAMES_PER_BATCH - 1 - f) * 66),
    );
    phone.publish(ch.pose, [{ type: 'pose', frames }]).catch((e) => console.error('pose publish', e));
    await sleep(BATCH_INTERVAL_MS);
  }
  await sleep(SETTLE_MS);

  // SC5: one coach call per set, sequential like a real Session.
  const cueLatencies: number[] = [];
  for (let i = 0; i < setCount; i++) {
    const setIndex = i + 1;
    const set = SETS[i % SETS.length]!;
    const cue = new Promise<{ text: string; audioUrl?: string }>((resolve, reject) => {
      cueWaiters.set(setIndex, resolve);
      setTimeout(() => reject(new Error(`no Cue for set ${setIndex} within ${CUE_TIMEOUT_MS} ms`)), CUE_TIMEOUT_MS);
    });
    const started = Date.now();
    await phone.publish(ch.events, [{ type: 'set_end', set, setIndex, t: started }]);
    await api('/coach', {
      method: 'POST',
      body: JSON.stringify({ sessionId: session.sessionId, token: session.phoneToken, setIndex, set }),
    });
    const msg = await cue;
    const elapsed = Date.now() - started;
    cueLatencies.push(elapsed);
    console.log(`set ${setIndex}: Cue in ${elapsed} ms${msg.audioUrl ? ' (with audio)' : ' (no audio)'}: "${msg.text}"`);
  }

  tv.close();
  phone.close();

  const sc1 = percentile(poseLatencies, 95);
  const sc5 = percentile(cueLatencies, 95);
  const received = `${poseLatencies.length}/${batchCount}`;
  const sc1Pass = poseLatencies.length >= batchCount * 0.95 && sc1 < SC1_P95_MS;
  const sc5Pass = cueLatencies.length === setCount && sc5 < SC5_P95_MS;
  console.log(
    `\nSC1 pose latency p50 ${percentile(poseLatencies, 50)} ms, p95 ${sc1} ms, received ${received} → ${sc1Pass ? 'PASS' : 'FAIL'} (< ${SC1_P95_MS} ms)`,
  );
  console.log(`SC5 coach turnaround p95 ${sc5} ms over ${cueLatencies.length} sets → ${sc5Pass ? 'PASS' : 'FAIL'} (< ${SC5_P95_MS} ms)`);
  process.exit(sc1Pass && sc5Pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
