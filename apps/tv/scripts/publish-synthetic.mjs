#!/usr/bin/env node
/**
 * Plays a synthetic phone against a real Session so the TV's Live screen can be exercised without a camera.
 *
 *   node scripts/publish-synthetic.mjs                       # create a Session, print attach links, then play a Set
 *   node scripts/publish-synthetic.mjs --session <32hex>     # play into a Session the TV already created (e.g. via QR)
 *   node scripts/publish-synthetic.mjs --wait 20 --reps 6 --faults knees_caving,torso_lean --real-coach
 *
 * Flags:
 *   --config <file>      client config (default ../../infra/client-config.json)
 *   --session <id>       reuse an existing Session id (the TV must already be subscribed, e.g. paired by QR)
 *   --member <name>      Member to create the Session for (default: first Member, or "Demo")
 *   --wait <seconds>     pause after `hello` so you can attach/open the TV (default 15; 0 to go straight on)
 *   --exercise <id>      squat | jumping_jack (default squat)
 *   --reps <n>           Reps in the Set (default 5)
 *   --sets <n>           Sets to play (default 1)
 *   --faults <ids>       comma list of Fault ids put on every 2nd Rep (default knees_caving)
 *   --real-coach         call POST /coach (Bedrock + Polly) instead of publishing a canned Cue
 *   --end                finish with control end_session (what the phone does on Finish Session)
 *   --end-delay <s>      wait this long after the Cue before ending (default 4)
 *   --stall <seconds>    stop sending poses for N seconds mid-Set (exercises "Lost your phone")
 *   --fps <n>            pose frame rate (default 15; the phone streams 3 frames per publish)
 *
 * It speaks the AppSync Events WebSocket protocol directly (global WebSocket, Node >= 22), no dependencies.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const configPath = resolve(args.config ?? join(here, '../../../infra/client-config.json'));
const cfg = JSON.parse(readFileSync(configPath, 'utf8'));

const FPS = Number(args.fps ?? 15);
const FRAMES_PER_BATCH = 3;
const REP_SECONDS = 2.4;
const FAULT_WEIGHTS = {
  shallow_depth: 30, knees_caving: 25, torso_lean: 20, heels_rising: 15, arms_not_overhead: 30, feet_not_wide: 30,
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

async function api(path, init) {
  const res = await fetch(`${cfg.apiBaseUrl}${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

// ---- AppSync Events (raw WebSocket) -----------------------------------------------------------------------
function connectEvents() {
  const auth = { host: cfg.eventsHttpHost, 'x-api-key': cfg.eventsApiKey };
  const header = Buffer.from(JSON.stringify(auth)).toString('base64url');
  const ws = new WebSocket(`wss://${cfg.eventsRealtimeHost}/event/realtime`, ['aws-appsync-event-ws', `header-${header}`]);
  const pending = new Map();
  let ready;
  const opened = new Promise((resolve, reject) => { ready = { resolve, reject }; });
  ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }));
  ws.onerror = (e) => ready.reject(new Error(`websocket error ${e.message ?? ''}`));
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.type === 'connection_ack') ready.resolve();
    else if (msg.type === 'publish_success' || msg.type === 'publish_error') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === 'publish_error' || msg.failed?.length) p.reject(new Error(JSON.stringify(msg.errors ?? msg.failed)));
      else p.resolve();
    }
  };
  let counter = 0;
  const publish = (channel, events) =>
    new Promise((resolve, reject) => {
      const id = `syn-${Date.now()}-${(counter += 1)}`;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ type: 'publish', id, channel, events: events.map((e) => JSON.stringify(e)), authorization: auth }));
      setTimeout(() => { if (pending.delete(id)) reject(new Error('publish timed out')); }, 10_000);
    });
  return { opened, publish, close: () => ws.close() };
}

// ---- synthetic MediaPipe pose -----------------------------------------------------------------------------
const lm = (x, y, v = 0.98) => [x, y, v];

/** 33 landmarks as [x, y, visibility]; `d` in 0..1 is how deep the squat is, `arms` 0..1 raises the arms. */
function pose({ d = 0, arms = 0, spread = 0, lean = 0, kneeIn = 0, sway = 0, heelLift = 0 }) {
  const cx = 0.5 + sway;
  const hipY = 0.55 + 0.15 * d;
  const shY = 0.3 + 0.14 * d;
  const kneeY = 0.74 + 0.02 * d;
  const wristY = 0.54 - 0.34 * arms - 0.1 * d;
  const wristX = 0.1 + 0.06 * (1 - arms);
  const out = new Array(33);
  const L = (i, x, y, v) => { out[i] = lm(x, y, v); };
  L(0, cx + lean, shY - 0.12); L(1, cx + lean + 0.01, shY - 0.14); L(2, cx + lean + 0.02, shY - 0.14); L(3, cx + lean + 0.03, shY - 0.14);
  L(4, cx + lean - 0.01, shY - 0.14); L(5, cx + lean - 0.02, shY - 0.14); L(6, cx + lean - 0.03, shY - 0.14);
  L(7, cx + lean + 0.05, shY - 0.11); L(8, cx + lean - 0.05, shY - 0.11); L(9, cx + lean + 0.02, shY - 0.09); L(10, cx + lean - 0.02, shY - 0.09);
  L(11, cx + 0.08 + lean, shY); L(12, cx - 0.08 + lean, shY);
  L(13, cx + 0.12 + 0.02 * arms + lean, shY + 0.12 - 0.2 * arms - 0.04 * d); L(14, cx - 0.12 - 0.02 * arms + lean, shY + 0.12 - 0.2 * arms - 0.04 * d);
  L(15, cx + wristX + lean, wristY); L(16, cx - wristX + lean, wristY);
  for (const [i, base, sign] of [[17, 15, 1], [19, 15, 1], [21, 15, 1], [18, 16, -1], [20, 16, -1], [22, 16, -1]]) {
    L(i, out[base][0] + sign * 0.01, out[base][1] - 0.02, 0.9);
  }
  L(23, cx + 0.06, hipY); L(24, cx - 0.06, hipY);
  L(25, cx + 0.07 + 0.04 * d + spread - kneeIn, kneeY); L(26, cx - 0.07 - 0.04 * d - spread + kneeIn, kneeY);
  L(27, cx + 0.07 + spread * 1.6, 0.92); L(28, cx - 0.07 - spread * 1.6, 0.92);
  L(29, cx + 0.065 + spread * 1.6, 0.94 - heelLift); L(30, cx - 0.065 - spread * 1.6, 0.94 - heelLift);
  L(31, cx + 0.11 + spread * 1.6, 0.96); L(32, cx - 0.11 - spread * 1.6, 0.96);
  return out;
}

function frameFor(kind, tau, faults, repIndex) {
  const wave = (1 - Math.cos(2 * Math.PI * tau)) / 2;
  const jitter = () => (Math.random() - 0.5) * 0.004;
  let p;
  if (kind === 'jumping_jack') {
    p = pose({ arms: wave, spread: 0.1 * wave, d: 0.05 * Math.sin(Math.PI * tau * 2) ** 2 });
  } else {
    const faulty = faults.length > 0 && repIndex % 2 === 0;
    p = pose({
      d: wave,
      arms: 0.55 * wave,
      kneeIn: faulty && faults.includes('knees_caving') ? 0.06 * wave : 0,
      lean: faulty && faults.includes('torso_lean') ? 0.08 * wave : 0,
      heelLift: faulty && faults.includes('heels_rising') ? 0.03 * wave : 0,
    });
  }
  return p.flatMap(([x, y, v]) => [Math.round((x + jitter()) * 1000) / 1000, Math.round((y + jitter()) * 1000) / 1000, v]);
}

const scoreFor = (faults) => Math.max(0, 100 - faults.reduce((n, id) => n + (FAULT_WEIGHTS[id] ?? 10), 0));

// ---- scenario ---------------------------------------------------------------------------------------------
async function main() {
  const exercise = args.exercise === 'jumping_jack' ? 'jumping_jack' : 'squat';
  const reps = Number(args.reps ?? 5);
  const sets = Number(args.sets ?? 1);
  const faultIds = typeof args.faults === 'string' ? args.faults.split(',').filter(Boolean) : ['knees_caving'];
  const waitSeconds = Number(args.wait ?? 15);

  let sessionId = typeof args.session === 'string' ? args.session : null;
  let token = null;
  let memberId = 'demo';
  if (!sessionId) {
    const { members } = await api('/members');
    let member = typeof args.member === 'string' ? members.find((m) => m.name === args.member) : members[0];
    member ??= await api('/members', { method: 'POST', body: JSON.stringify({ name: typeof args.member === 'string' ? args.member : 'Demo' }) });
    const session = await api('/session', { method: 'POST', body: JSON.stringify({ memberId: member.memberId }) });
    ({ sessionId, phoneToken: token, memberId } = session);
    const q = `s=${sessionId}&m=${encodeURIComponent(member.memberId)}&n=${encodeURIComponent(member.name)}`;
    console.log(`Session ${sessionId} for ${member.name}`);
    console.log(`  Android TV : adb shell am start -a android.intent.action.VIEW -d "couchcoach://attach?${q}" dev.sebaustin.couchcoach`);
    console.log(`  Web preview: http://localhost:8082/?attach=1&${q}`);
  }
  const channels = { pose: `/cc/${sessionId}/pose`, events: `/cc/${sessionId}/events`, coach: `/cc/${sessionId}/coach` };

  const events = connectEvents();
  await events.opened;
  const now = () => Date.now();
  await events.publish(channels.events, [{ type: 'hello', memberId, aspect: 9 / 16, t: now() }]);
  console.log(`hello sent; waiting ${waitSeconds}s for the TV...`);
  // Keep poses flowing while we wait so the skeleton is visible immediately.
  await streamPoses(events, channels, exercise, waitSeconds, faultIds, 0);

  for (let setIndex = 1; setIndex <= sets; setIndex += 1) {
    await events.publish(channels.events, [{ type: 'set_start', exercise, t: now() }]);
    console.log(`set ${setIndex} start (${exercise}, ${reps} reps)`);
    const repScores = [];
    const faultCounts = {};
    const repAcks = [];
    const startedAt = now();
    for (let rep = 1; rep <= reps; rep += 1) {
      const repFaults = exercise === 'squat' && rep % 2 === 0 ? faultIds : [];
      await streamPoses(events, channels, exercise, REP_SECONDS, repFaults, rep, rep === Math.ceil(reps / 2) ? Number(args.stall ?? 0) : 0);
      const score = scoreFor(repFaults);
      repScores.push(score);
      for (const id of repFaults) faultCounts[id] = (faultCounts[id] ?? 0) + 1;
      // Fire and forget: awaiting the ack would stall the pose stream for a round trip, which the phone never does.
      repAcks.push(events.publish(channels.events, [{ type: 'rep', exercise, index: rep, score, faults: repFaults, t: now() }]).catch((e) => console.warn(`rep publish: ${e.message}`)));
      console.log(`  rep ${rep} score ${score} ${repFaults.join(',')}`);
    }
    await Promise.all(repAcks); // keep set_end behind its Reps, as the phone's ordered queue does
    const mean = Math.round(repScores.reduce((a, b) => a + b, 0) / Math.max(1, repScores.length));
    const set = { exercise, reps, score: mean, faults: faultCounts, durationMs: now() - startedAt };
    await events.publish(channels.events, [{ type: 'set_end', set, setIndex, t: now() }]);
    console.log(`set ${setIndex} end, score ${mean}`);
    await coachTurn(events, channels, { sessionId, token, setIndex, set });
    await streamPoses(events, channels, exercise, Number(args['end-delay'] ?? 4), [], 0); // rest, skeleton keeps moving a little
  }

  if (args.end) {
    await events.publish(channels.events, [{ type: 'control', action: 'end_session', t: now() }]);
    console.log('control end_session sent');
  }
  await sleep(500);
  events.close();
}

async function streamPoses(events, channels, kind, seconds, faults, repIndex, stallSeconds = 0) {
  const frameMs = 1000 / FPS;
  const total = Math.round((seconds * 1000) / frameMs);
  const stallFrom = stallSeconds > 0 ? Math.floor(total / 2) : -1;
  let batch = [];
  for (let i = 0; i < total; i += 1) {
    const tau = (i / total) % 1;
    batch.push({ t: Date.now(), k: frameFor(kind, tau, faults, repIndex) });
    if (batch.length === FRAMES_PER_BATCH) {
      events.publish(channels.pose, [{ type: 'pose', frames: batch }]).catch((e) => console.warn(`pose publish: ${e.message}`));
      batch = [];
    }
    if (i === stallFrom) {
      console.log(`  stalling poses for ${stallSeconds}s`);
      await sleep(stallSeconds * 1000);
    }
    await sleep(frameMs);
  }
}

async function coachTurn(events, channels, { sessionId, token, setIndex, set }) {
  if (args['real-coach'] && token) {
    await api('/coach', { method: 'POST', body: JSON.stringify({ sessionId, token, setIndex, set }) });
    console.log('POST /coach accepted; waiting for the Cue (Bedrock + Polly)...');
    await sleep(9000);
    return;
  }
  await events.publish(channels.coach, [{ type: 'thinking', setIndex, t: Date.now() }]);
  await sleep(2500);
  const text = typeof args.cue === 'string'
    ? args.cue
    : 'Nice depth on that Set. Your knees drifted in on every second Rep, so push them out over your toes. Same again, and slow the way down.';
  const cue = { type: 'cue', text, setIndex, t: Date.now() };
  if (typeof args.audio === 'string') cue.audioUrl = args.audio;
  await events.publish(channels.coach, [cue]);
  console.log('cue sent');
  await sleep(2000);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
