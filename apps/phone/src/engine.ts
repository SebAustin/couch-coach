import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from '@couch-coach/protocol';
import type { SkeletonOverlay } from './overlay';

/** A detected pose with the wall-clock capture time (epoch ms). */
export interface DetectedPose {
  pose: Landmark[];
  /** Wall-clock capture time (epoch ms): what goes on the wire. */
  t: number;
  /** Monotonic time in the same units (`timeOrigin + performance.now()`): what the rep counter gets. */
  mono: number;
}

export interface Engine {
  start(): void;
  stop(): void;
  /** Detection frames per second over the last ~second. */
  fps(): number;
}

const FPS_WINDOW_MS = 1000;

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * Per-frame detection loop. Runs on `requestVideoFrameCallback` where available (one callback per
 * camera frame) and on `requestAnimationFrame` otherwise. Pixels never leave the device: only the
 * landmarks are handed to `onPose`.
 */
export function createEngine(opts: {
  video: HTMLVideoElement;
  landmarker: PoseLandmarker;
  overlay: SkeletonOverlay;
  onPose: (detected: DetectedPose | null) => void;
}): Engine {
  const video = opts.video as VideoWithRvfc;
  let running = false;
  let handle = 0;
  let lastVideoTime = -1;
  let stamps: number[] = [];

  const schedule = () => {
    handle = video.requestVideoFrameCallback
      ? video.requestVideoFrameCallback(step)
      : requestAnimationFrame(step);
  };

  function step(): void {
    if (!running) return;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      detect();
    }
    schedule();
  }

  function detect(): void {
    const nowPerf = performance.now();
    let pose: Landmark[] | null = null;
    try {
      const result = opts.landmarker.detectForVideo(video, nowPerf);
      const first = result.landmarks[0];
      if (first) pose = first.map((l) => ({ x: l.x, y: l.y, visibility: l.visibility ?? 0 }));
    } catch (err) {
      console.warn('pose detection failed for one frame', err);
    }
    stamps = [...stamps.filter((s) => nowPerf - s < FPS_WINDOW_MS), nowPerf];
    opts.overlay.draw(pose);
    opts.onPose(pose ? { pose, t: Date.now(), mono: performance.timeOrigin + nowPerf } : null);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastVideoTime = -1;
      schedule();
    },
    stop() {
      running = false;
      if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      stamps = [];
      opts.overlay.clear();
    },
    fps: () => stamps.length,
  };
}
