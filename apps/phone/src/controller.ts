import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { createCounter } from 'pose-reps';
import type { ClientConfig, CoachMessage, Exercise, PhoneEvent } from '@couch-coach/protocol';
import { closeCamera, createWakeLock, openCamera, videoTrack, type Facing } from './camera';
import { clear, h } from './dom';
import { createEngine, type DetectedPose, type Engine } from './engine';
import { openWithFallback } from './logic/camera-fallback';
import { createFrameBatcher } from './logic/frame-batcher';
import { createFrameRing } from './logic/frame-ring';
import { createFramingTracker } from './logic/framing';
import { idleStatus } from './logic/idle';
import { describeMotion, processPose } from './logic/live-frame';
import { createPresenceTracker } from './logic/presence';
import type { ModelVariant } from './logic/session-params';
import { createSetRunner, type SetRunner } from './logic/set-runner';
import { button } from './views/ui';
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
const PRESENCE_INTERVAL_MS = 2_000;

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
  framing: null,
  notice: null,
  cameraIssue: null,
  wakeLock: 'ok',
};

/**
 * Owns the Session: camera, pose engine, Set lifecycle and the wire. Views only render the Vm.
 * `model` picks the Pose Landmarker (`?model=full` in the URL; lite by default).
 */
export function createController(
  root: {
    ui: HTMLElement;
    stage: HTMLElement;
    chip: HTMLElement;
    notice: HTMLElement;
    debug: HTMLElement;
  },
  { model = 'lite' }: { model?: ModelVariant } = {},
) {
  let vm: Vm = INITIAL_VM;
  let view: View | null = null;
  let mounted: Vm['screen'] | null = null;

  // disablepictureinpicture / disableremoteplayback: keep Safari from offering PiP or AirPlay over the preview.
  const video = h('video', {
    playsinline: true,
    muted: true,
    autoplay: true,
    disablepictureinpicture: true,
    disableremoteplayback: true,
    'aria-hidden': 'true',
  });
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const frameEl = h('div', { class: 'frame' }, video, canvas);
  root.stage.append(frameEl);
  const overlay: SkeletonOverlay = createOverlay(canvas);
  const wakeLock = createWakeLock((state) => setVm({ wakeLock: state === 'on' ? 'ok' : 'unavailable' }));
  const ring = createFrameRing(EXPORT_WINDOW_MS);
  const framing = createFramingTracker();
  const presence = createPresenceTracker();

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
  let presenceTimer: ReturnType<typeof setInterval> | undefined;
  let isCameraOpen = false;
  let isRecovering = false;
  let hasEnded = false;
  let setCounter = 0;

  // ---- rendering ----------------------------------------------------------
  let noticeText: string | null = null;

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
    renderNotice();
    root.debug.hidden = !vm.debugOn || root.stage.hidden;
  }

  function renderChip(): void {
    const hidden = ['boot', 'invalid', 'config_error', 'ended'].includes(vm.screen);
    root.chip.hidden = hidden;
    root.chip.className = `chip ${vm.online ? 'chip--on' : 'chip--off'}`;
    // Rewriting identical text replaces the text node, which can make VoiceOver re-announce the status.
    const text = vm.online ? 'Connected' : 'Offline. Reconnecting…';
    if (root.chip.textContent !== text) root.chip.textContent = text;
  }

  /**
   * Persistent notice under the chip: camera trouble first (with a tap target), then the wake-lock note.
   * The wake-lock advice is skipped mid-Set: it cannot be acted on there, and the notice would take
   * room from the Rep count.
   */
  function renderNotice(): void {
    const onCameraScreen = ['paired', 'picker', 'set', 'after'].includes(vm.screen);
    const text =
      vm.cameraIssue === 'tap_to_resume'
        ? 'The camera paused while the app was in the background.'
        : vm.cameraIssue === 'lost'
          ? 'The camera stopped.'
          : vm.wakeLock === 'unavailable' && vm.screen !== 'set'
            ? 'Couldn’t keep the screen awake. Turn off auto-lock so your phone doesn’t sleep mid-Set.'
            : null;
    root.notice.hidden = !onCameraScreen || text === null;
    if (root.notice.hidden || text === noticeText) return;
    noticeText = text;
    clear(root.notice);
    root.notice.append(h('p', {}, text));
    if (vm.cameraIssue) root.notice.append(button('Tap to resume camera', () => void recoverCamera(true), 'secondary'));
  }

  function refreshDebug(): void {
    const latency = publishLatencyMs === null ? '--' : `${Math.round(publishLatencyMs)} ms`;
    const motion = runner && !vm.paused ? runner.motion() : undefined;
    root.debug.textContent = [
      `FPS ${engine?.fps() ?? 0}`,
      `publish ${latency}`,
      delegate ? `${delegate} ${model}` : 'no model',
      vm.online ? 'online' : 'offline',
      ...(motion ? [describeMotion(motion)] : []),
    ].join(' · ');
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

  function trackFraming(detected: DetectedPose | null): void {
    if (!runner || !vm.exercise || vm.paused) return;
    const issue = framing.push(detected?.pose ?? null, vm.exercise, detected?.t ?? Date.now());
    if (issue !== vm.framing) setVm({ framing: issue });
  }

  function sendPresence(): void {
    emit({ type: 'presence', person: presence.person(Date.now()), t: Date.now() });
  }

  function onPose(detected: DetectedPose | null): void {
    trackFraming(detected);
    if (!detected) return;
    presence.seen(detected.t);
    // The counter runs before encoding so the frame carries the TV's depth gauge state for this very frame.
    const active = runner && !vm.paused ? runner : null;
    const { frame, rep } = processPose(detected, active);
    ring.add(frame);
    batcher.add(frame);
    if (!rep || !active) return;
    activityAt = detected.t;
    emit(rep);
    setVm({ reps: active.repCount(), score: active.score(), idleSecondsLeft: null });
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
      const loaded = await loadPoseLandmarker(model);
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
    isCameraOpen = true;
    watchTrack();
    applyAspect(result.aspect);
    sendHello();
    void wakeLock.start();
    setVm({ busy: false, screen: 'paired' });
    void loadModel();
    clearInterval(debugTimer);
    debugTimer = setInterval(refreshDebug, DEBUG_REFRESH_MS);
    clearInterval(presenceTimer);
    sendPresence();
    presenceTimer = setInterval(sendPresence, PRESENCE_INTERVAL_MS);
  }

  /** iOS can end the video track when the app is interrupted; recover as soon as we notice. */
  function watchTrack(): void {
    const track = videoTrack(video);
    if (track) {
      track.onended = () => {
        if (document.visibilityState === 'visible') void recoverCamera(false);
      };
    }
  }

  /**
   * Get the preview running again after an interruption (page hidden, phone call, tab switch).
   * `fromTap` marks a user gesture, which iOS needs before it lets a stalled video play again.
   */
  async function recoverCamera(fromTap: boolean): Promise<void> {
    if (hasEnded || !isCameraOpen || isRecovering || vm.busy) return;
    isRecovering = true;
    try {
      const track = videoTrack(video);
      if (!track || track.readyState === 'ended') {
        await reopenCamera();
        return;
      }
      try {
        await video.play();
        setVm({ cameraIssue: null });
      } catch (err) {
        console.warn('video.play() was rejected after the app became visible', err);
        if (fromTap) await reopenCamera();
        else setVm({ cameraIssue: 'tap_to_resume' });
      }
    } finally {
      isRecovering = false;
    }
  }

  async function reopenCamera(): Promise<void> {
    engine?.stop();
    closeCamera(video);
    const out = await openWithFallback([facing], (f) => openCamera(video, f));
    if (!out.ok) {
      setVm({ cameraIssue: 'lost' });
      return;
    }
    watchTrack();
    applyAspect(out.result.aspect);
    engine?.start();
    setVm({ cameraIssue: null });
  }

  function onVisible(): void {
    if (document.visibilityState !== 'visible' || hasEnded) return;
    // The socket may have died while the page was frozen without the browser noticing.
    net?.client.reconnect();
    void recoverCamera(false);
  }

  function applyAspect(next: number): void {
    const changed = aspect === null || Math.abs(next - aspect) / aspect > ASPECT_RESEND_THRESHOLD;
    aspect = next;
    frameEl.style.setProperty('--aspect', String(next));
    if (changed && vm.screen !== 'denied' && vm.screen !== 'prime') sendHello();
  }

  async function flipCamera(): Promise<void> {
    if (vm.busy || hasEnded) return; // one flip at a time
    setVm({ busy: true, notice: null });
    const previous = facing;
    const next: Facing = previous === 'user' ? 'environment' : 'user';
    engine?.stop();
    closeCamera(video); // release the old tracks first: some phones cannot open two cameras at once
    const out = await openWithFallback([next, previous], (f) => openCamera(video, f));
    if (out.ok) {
      facing = out.facing;
      watchTrack();
      applyAspect(out.result.aspect);
      engine?.start();
      setVm({ busy: false, cameraIssue: null, notice: out.usedFallback ? 'Couldn’t switch cameras.' : null });
    } else {
      setVm({ busy: false, cameraIssue: 'lost', notice: 'Couldn’t open either camera.' });
    }
  }

  // ---- sets ---------------------------------------------------------------

  function startSet(): void {
    if (!vm.exercise || vm.modelState !== 'ready') return;
    const exercise: Exercise = vm.exercise;
    setCounter += 1;
    const now = Date.now();
    try {
      framing.reset();
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
      framing: null,
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
    clearInterval(presenceTimer);
    clearTimeout(coachTimer);
    runner = null;
    isCameraOpen = false;
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
      document.addEventListener('visibilitychange', onVisible);
      setVm({ screen: 'prime' });
      if (granted) await allowCamera();
    },
    show: (screen: Vm['screen']) => setVm({ screen }),
  };
}
