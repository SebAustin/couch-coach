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
    return { ok: true, stream: finalStream, aspect: video.videoWidth / video.videoHeight };
  } catch (err) {
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

function waitForDimensions(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    setTimeout(resolve, 3000);
  });
}

/** Keeps the screen on while a Session is running (Wake Lock API, where supported). */
export function createWakeLock() {
  let sentinel: WakeLockSentinel | null = null;
  let wanted = false;
  const acquire = async () => {
    if (!wanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      sentinel = await navigator.wakeLock.request('screen');
    } catch {
      sentinel = null; // denied (e.g. low battery); the app still works
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
