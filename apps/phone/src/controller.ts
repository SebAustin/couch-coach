import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createCounter } from 'pose-reps';
import { encodeFrame, type ClientConfig, type CoachMessage, type Exercise, type PhoneEvent } from '@couch-coach/protocol';
import { closeCamera, createWakeLock, openCamera, type Facing } from './camera';
import { clear, h } from './dom';
import { createEngine, type DetectedPose, type Engine } from './engine';
import { createFrameBatcher } from './logic/frame-batcher';
import { createFrameRing } from './logic/frame-ring';
import { idleStatus } from './logic/idle';
import { createSetRunner, type SetRunner } from './logic/set-runner';
import { createSessionNet, type SessionNet } from './net';
import { createOverlay, type SkeletonOverlay } from './overlay';
import { loadPoseLandmarker } from './pose';
import { VIEWS, type Actions, type View, type Vm } from './views';

const IDLE_MS = 8_000;
const IDLE_WARN_MS = 3_000;
const IDLE_TICK_MS = 250;
const COACH_QUIET_AFTER_MS = 12_000;
const END_PUBLISH_GRACE_MS = 1_500;
const EXPORT_WINDOW_MS = 30_000;
const DEBUG_REFRESH_MS = 500;
const ASPECT_RESEND_THRESHOLD = 0.02;

export interface SessionInfo {
  sessionId: string;
  token: string;
  memberId: string;
}

const INITIAL_VM: Vm = {
  screen: 'boot',
  online: false,
  busy: false,
  cameraReason: 'denied',
  modelState: 'idle',
  exercise: null,
  setIndex: 0,
  reps: 0,
  score: null,
  paused: false,
  idleSecondsLeft: null,
  coach: null,
  lastSet: null,
  debugOn: false,
  notice: null,
};

/** Owns the Session: camera, pose engine, Set lifecycle and the wire. Views only render the Vm. */
export function createController(root: {
  ui: HTMLElement;
  stage: HTMLElement;
  chip: HTMLElement;
  debug: HTMLElement;
}) {
  let vm: Vm = INITIAL_VM;
  let view: View | null = null;
  let mounted: Vm['screen'] | null = null;

  const video = h('video', { playsinline: true, muted: true, autoplay: true, 'aria-hidden': 'true' });
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const frameEl = h('div', { class: 'frame' }, video, canvas);
  root.stage.append(frameEl);
  const overlay: SkeletonOverlay = createOverlay(canvas);
  const wakeLock = createWakeLock();
  const ring = createFrameRing(EXPORT_WINDOW_MS);

  let session: SessionInfo | null = null;
  let net: SessionNet | null = null;
  let landmarker: PoseLandmarker | null = null;
  let delegate = '';
  let engine: Engine | null = null;
  let facing: Facing = 'user';
  let aspect: number | null = null;
  let runner: SetRunner<DetectedPose['pose']> | null = null;
  let activityAt = 0;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let coachTimer: ReturnType<typeof setTimeout> | undefined;
  let debugTimer: ReturnType<typeof setInterval> | undefined;
  let publishLatencyMs: number | null = null;
  let hasEnded = false;
  let setCounter = 0;

  // ---- rendering ----------------------------------------------------------

  function setVm(patch: Partial<Vm>): void {
    vm = { ...vm, ...patch };
    if (vm.screen !== mounted) {
      mounted = vm.screen;
      view = VIEWS[vm.screen](vm, actions);
      clear(root.ui);
      root.ui.append(view.el);
      const cameraScreens: Vm['screen'][] = ['paired', 'picker', 'set', 'after'];
      root.stage.hidden = !cameraScreens.includes(vm.screen);
      root.ui.dataset.screen = vm.screen;
    } else {
      view?.update(vm);
    }
    renderChip();
    root.debug.hidden = !vm.debugOn || root.stage.hidden;
  }

  function renderChip(): void {
    const hidden = ['boot', 'invalid', 'config_error', 'ended'].includes(vm.screen);
    root.chip.hidden = hidden;
    root.chip.className = `chip ${vm.online ? 'chip--on' : 'chip--off'}`;
    root.chip.textContent = vm.online ? 'Connected' : 'Offline. Reconnecting...';
  }

  function refreshDebug(): void {
    const latency = publishLatencyMs === null ? '--' : `${Math.round(publishLatencyMs)} ms`;
    root.debug.textContent = `FPS ${engine?.fps() ?? 0} · publish ${latency} · ${delegate || 'no model'} · ${vm.online ? 'online' : 'offline'}`;
  }

  // ---- wire ---------------------------------------------------------------

  function emit(event: PhoneEvent): Promise<void> | undefined {
    return net?.publishEvent(event).catch((err: Error) => console.warn('publish failed', event.type, err.message));
  }

  const batcher = createFrameBatcher({
    onBatch: (frames) => {
      const started = performance.now();
      net
        ?.publishPose({ type: 'pose', frames })
        .then(() => {
          publishLatencyMs = performance.now() - started;
        })
        .catch(() => {
          /* ephemeral: dropped or lost batches are expected while reconnecting */
        });
    },
  });

  function sendHello(): void {
    if (!session) return;
    emit({ type: 'hello', memberId: session.memberId, ...(aspect ? { aspect } : {}), t: Date.now() });
  }

  function onCoach(msg: CoachMessage): void {
    if (msg.type === 'thinking') {
      setVm({ coach: { state: 'thinking' } });
      return;
    }
    clearTimeout(coachTimer);
    setVm({ coach: { state: 'cue', text: msg.text } });
  }

  function onRemoteEvent(event: PhoneEvent): void {
    // Only the TV's end_session matters; pause/resume echoes of our own publishes are ignored.
    if (event.type === 'control' && event.action === 'end_session') void endSession(false);
  }

  // ---- frames -------------------------------------------------------------

  function onPose(detected: DetectedPose | null): void {
    if (!detected) return;
    const frame = encodeFrame(detected.pose, detected.t);
    ring.add(frame);
    batcher.add(frame);
    if (!runner || vm.paused) return;
    let rep: PhoneEvent | null = null;
    try {
      rep = runner.push(detected.pose, detected.t);
    } catch (err) {
      console.warn('rep counter rejected a frame', err);
    }
    if (!rep) return;
    activityAt = detected.t;
    emit(rep);
    setVm({ reps: runner.repCount(), score: runner.score(), idleSecondsLeft: null });
  }

  function ensureEngine(): void {
    if (engine || !landmarker) return;
    engine = createEngine({ video, landmarker, overlay, onPose });
    engine.start();
  }

  async function loadModel(): Promise<void> {
    if (landmarker) return;
    setVm({ modelState: 'loading' });
    try {
      const loaded = await loadPoseLandmarker();
      landmarker = loaded.landmarker;
      delegate = loaded.delegate;
      ensureEngine();
      setVm({ modelState: 'ready' });
    } catch (err) {
      console.error(err);
      setVm({ modelState: 'error' });
    }
  }

  // ---- camera -------------------------------------------------------------

  async function allowCamera(): Promise<void> {
    if (vm.busy || hasEnded) return;
    setVm({ busy: true });
    const result = await openCamera(video, facing);
    if (!result.ok) {
      setVm({ busy: false, screen: 'denied', cameraReason: result.reason });
      return;
    }
    applyAspect(result.aspect);
    sendHello();
    void wakeLock.start();
    setVm({ busy: false, screen: 'paired' });
    void loadModel();
    clearInterval(debugTimer);
    debugTimer = setInterval(refreshDebug, DEBUG_REFRESH_MS);
  }

  function applyAspect(next: number): void {
    const changed = aspect === null || Math.abs(next - aspect) / aspect > ASPECT_RESEND_THRESHOLD;
    aspect = next;
    frameEl.style.setProperty('--aspect', String(next));
    if (changed && vm.screen !== 'denied' && vm.screen !== 'prime') sendHello();
  }

  async function flipCamera(): Promise<void> {
    const previous = facing;
    facing = facing === 'user' ? 'environment' : 'user';
    engine?.stop();
    closeCamera(video);
    const result = await openCamera(video, facing);
    if (result.ok) {
      applyAspect(result.aspect);
    } else {
      facing = previous;
      await openCamera(video, facing); // restore the camera that worked
    }
    engine?.start();
  }

  // ---- sets ---------------------------------------------------------------

  function startSet(): void {
    if (!vm.exercise || vm.modelState !== 'ready') return;
    const exercise: Exercise = vm.exercise;
    setCounter += 1;
    const now = Date.now();
    try {
      runner = createSetRunner({ exercise, setIndex: setCounter, counter: createCounter(exercise, aspect ? { aspectRatio: aspect } : {}), startedAtMs: now });
    } catch (err) {
      console.error('cannot start counter', err);
      setCounter -= 1;
      setVm({ notice: `${exercise === 'squat' ? 'Squat' : 'Jumping jack'} is not available yet.` });
      return;
    }
    sessionStorage.setItem(storageKey(), String(setCounter));
    activityAt = now;
    emit({ type: 'set_start', exercise, t: now });
    clearTimeout(coachTimer);
    setVm({
      screen: 'set',
      setIndex: setCounter,
      reps: 0,
      score: null,
      paused: false,
      idleSecondsLeft: null,
      coach: null,
      lastSet: null,
      notice: null,
    });
    clearInterval(idleTimer);
    idleTimer = setInterval(checkIdle, IDLE_TICK_MS);
  }

  function checkIdle(): void {
    if (!runner || vm.paused) return;
    const status = idleStatus({
      reps: runner.repCount(),
      lastActivityMs: activityAt,
      nowMs: Date.now(),
      idleMs: IDLE_MS,
      warnMs: IDLE_WARN_MS,
    });
    if (status.kind === 'end') void endSet();
    else setVm({ idleSecondsLeft: status.kind === 'warn' ? status.secondsLeft : null });
  }

  async function endSet(): Promise<void> {
    const finished = runner;
    if (!finished || !session || !net) return;
    runner = null;
    clearInterval(idleTimer);
    batcher.flush();
    const now = Date.now();
    const summary = finished.summary(now);
    emit({ type: 'set_end', set: summary, setIndex: finished.setIndex, t: now });
    setVm({
      screen: 'after',
      lastSet: summary,
      paused: false,
      idleSecondsLeft: null,
      coach: summary.reps > 0 ? { state: 'thinking' } : { state: 'skipped' },
    });
    if (summary.reps === 0) return; // nothing for the Coach to review
    coachTimer = setTimeout(() => {
      if (vm.coach?.state === 'thinking') setVm({ coach: { state: 'quiet' } });
    }, COACH_QUIET_AFTER_MS);
    const res = await net.requestCoach({
      sessionId: session.sessionId,
      token: session.token,
      setIndex: finished.setIndex,
      set: summary,
    });
    if (!res.ok) {
      console.warn('POST /coach failed', res.status);
      clearTimeout(coachTimer);
      if (vm.coach?.state !== 'cue') setVm({ coach: { state: 'quiet' } });
    }
  }

  function togglePause(): void {
    if (!runner) return;
    const paused = !vm.paused;
    if (!paused) activityAt = Date.now();
    emit({ type: 'control', action: paused ? 'pause' : 'resume', t: Date.now() });
    setVm({ paused, idleSecondsLeft: null });
  }

  async function endSession(local: boolean): Promise<void> {
    if (hasEnded) return;
    hasEnded = true;
    clearInterval(idleTimer);
    clearInterval(debugTimer);
    clearTimeout(coachTimer);
    runner = null;
    engine?.stop();
    if (local && net) {
      const grace = new Promise<void>((resolve) => setTimeout(resolve, END_PUBLISH_GRACE_MS));
      await Promise.race([emit({ type: 'control', action: 'end_session', t: Date.now() }) ?? grace, grace]);
    }
    net?.client.close();
    closeCamera(video);
    await wakeLock.stop();
    setVm({ screen: 'ended', paused: false, idleSecondsLeft: null });
  }

  // ---- misc ---------------------------------------------------------------

  const storageKey = () => `cc:setIndex:${session?.sessionId ?? ''}`;

  function exportFrames(): void {
    const doc = ring.toExport({ exercise: vm.exercise, aspect, exportedAt: Date.now() });
    const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `couch-coach-landmarks-${doc.exportedAt}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  const actions: Actions = {
    allowCamera: () => void allowCamera(),
    goToPicker: () => setVm({ screen: 'picker' }),
    selectExercise: (exercise) => setVm({ exercise, notice: null }),
    startSet,
    endSet: () => void endSet(),
    togglePause,
    keepGoing: () => {
      activityAt = Date.now();
      setVm({ idleSecondsLeft: null });
    },
    nextSet: () => setVm({ screen: 'picker' }),
    finishSession: () => void endSession(true),
    flipCamera: () => void flipCamera(),
    toggleDebug: () => setVm({ debugOn: !vm.debugOn }),
    exportFrames,
    retryModel: () => void loadModel(),
    reload: () => location.reload(),
  };

  return {
    /** Connect to the Session. `granted` skips the permission prime when the browser already allows the camera. */
    async start(info: SessionInfo, config: ClientConfig, granted: boolean): Promise<void> {
      session = info;
      setCounter = Number(sessionStorage.getItem(storageKey())) || 0;
      net = createSessionNet(config, info.sessionId);
      net.client.onStatus((s) => setVm({ online: s.state === 'connected' }));
      net.onCoach(onCoach);
      net.onRemoteEvent(onRemoteEvent);
      setVm({ screen: 'prime' });
      if (granted) await allowCamera();
    },
    show: (screen: Vm['screen']) => setVm({ screen }),
  };
}
