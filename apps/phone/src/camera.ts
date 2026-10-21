import { resolveAspect } from './logic/aspect';

export type Facing = 'user' | 'environment';

export type CameraResult =
  | { ok: true; stream: MediaStream; aspect: number }
  | { ok: false; reason: 'denied' | 'unavailable' | 'insecure'; message: string };

const PORTRAIT_ASPECT = 9 / 16;

/** Some browsers ignore `ideal` portrait sizes and hand back a landscape frame even when the phone is upright,
 * which leaves the Member tiny in frame and the landmarks noisy. Retry once with an exact 9:16 aspect. */
async function requestPortraitIfNeeded(video: HTMLVideoElement, stream: MediaStream, facing: Facing): Promise<MediaStream> {
  const screenIsPortrait = window.innerHeight > window.innerWidth;
  if (!screenIsPortrait || video.videoWidth <= video.videoHeight) return stream;
  try {
    const portrait = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        aspectRatio: { exact: PORTRAIT_ASPECT },
        height: { ideal: 1280 },
        frameRate: { ideal: 30 },
      },
    });
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = portrait;
    await video.play();
    await waitForDimensions(video);
    return portrait;
  } catch (err) {
    console.warn('portrait camera frame not available; keeping landscape', err);
    return stream;
  }
}

/** Open the camera. Portrait 720x1280 is requested; the real size is read back from the stream. */
export async function openCamera(video: HTMLVideoElement, facing: Facing): Promise<CameraResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      reason: window.isSecureContext ? 'unavailable' : 'insecure',
      message: window.isSecureContext
        ? 'This browser cannot open the camera.'
        : 'The camera needs a secure (HTTPS) connection.',
    };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 720 },
        height: { ideal: 1280 },
        aspectRatio: { ideal: PORTRAIT_ASPECT },
        frameRate: { ideal: 30 },
      },
    });
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await waitForDimensions(video);
    const finalStream = await requestPortraitIfNeeded(video, stream, facing);
    return { ok: true, stream: finalStream, aspect: await readAspect(video) };
  } catch (err) {
    closeCamera(video); // do not leak a half-opened stream
    const name = (err as DOMException).name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return { ok: false, reason: 'denied', message: 'Camera permission was denied.' };
    }
    return { ok: false, reason: 'unavailable', message: `Could not start the camera (${name || 'error'}).` };
  }
}

export function closeCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/** True when the browser already holds a camera grant, so the permission prime can be skipped. */
export async function cameraAlreadyGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false; // Safari does not support querying the camera permission
  }
}

/** Frame aspect with one wait-and-retry, then an explicit 9/16 fallback (never NaN). */
function readAspect(video: HTMLVideoElement): Promise<number> {
  return resolveAspect(
    () => ({ width: video.videoWidth, height: video.videoHeight }),
    () => waitForDimensions(video),
  );
}

/** The live video track of the element's stream, if any. */
export function videoTrack(video: HTMLVideoElement): MediaStreamTrack | null {
  const stream = video.srcObject;
  return stream instanceof MediaStream ? (stream.getVideoTracks()[0] ?? null) : null;
}

function waitForDimensions(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    setTimeout(resolve, 3000);
  });
}

export type WakeLockState = 'on' | 'unavailable';

/**
 * Keeps the screen on while a Session is running (Wake Lock API, where supported). `onChange` is
 * called with 'unavailable' when the browser lacks the API or denies the request, so the UI can say so.
 */
export function createWakeLock(onChange: (state: WakeLockState) => void = () => {}) {
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;
  const acquire = async () => {
    if (!wanted || document.visibilityState !== 'visible') return;
    if (!('wakeLock' in navigator)) {
      onChange('unavailable');
      return;
    }
    try {
      sentinel = await navigator.wakeLock.request('screen');
      onChange('on');
    } catch {
      sentinel = null; // denied (e.g. low battery); the app still works
      onChange('unavailable');
    }
  };
  document.addEventListener('visibilitychange', () => void acquire());
  return {
    async start() {
      wanted = true;
      await acquire();
    },
    async stop() {
      wanted = false;
      await sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}
