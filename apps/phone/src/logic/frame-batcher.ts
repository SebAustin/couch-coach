import type { PoseFrame } from '@couch-coach/protocol';

/** Protocol limit: a PoseBatch carries 1..10 frames. */
const MAX_BATCH_SIZE = 10;
const DEFAULT_BATCH_SIZE = 3;
/** ~15 fps target: a 30 fps camera is thinned to every other frame. */
const DEFAULT_MIN_INTERVAL_MS = 60;

export interface FrameBatcherOptions {
  batchSize?: number;
  minIntervalMs?: number;
  onBatch: (frames: PoseFrame[]) => void;
}

export interface FrameBatcher {
  /** Offer a frame. Returns false when it was dropped by the throttle. */
  add(frame: PoseFrame): boolean;
  /** Emit whatever is pending (no-op when empty). */
  flush(): void;
  /** Forget pending frames and the throttle clock (e.g. after a pause). */
  reset(): void;
}

/** Throttles frames to ~15 fps and groups them into PoseBatch-sized arrays. */
export function createFrameBatcher(options: FrameBatcherOptions): FrameBatcher {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`batchSize must be an integer in 1..${MAX_BATCH_SIZE}`);
  }
  let pending: PoseFrame[] = [];
  let lastAcceptedT = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    options.onBatch(batch);
  };

  return {
    add(frame) {
      if (frame.t - lastAcceptedT < minIntervalMs) return false;
      lastAcceptedT = frame.t;
      pending = [...pending, frame];
      if (pending.length >= batchSize) flush();
      return true;
    },
    flush,
    reset() {
      pending = [];
      lastAcceptedT = Number.NEGATIVE_INFINITY;
    },
  };
}
