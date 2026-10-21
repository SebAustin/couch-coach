import type { Exercise, PoseFrame } from '@couch-coach/protocol';

export interface FrameRing {
  add(frame: PoseFrame): void;
  size(): number;
  /** Copy of the buffered frames, oldest first. */
  snapshot(): PoseFrame[];
  /** Document for the "Export last 30 s" button (regression fixtures). */
  toExport(meta: { exercise: Exercise | null; aspect: number | null; exportedAt: number }): LandmarkExport;
}

export interface LandmarkExport {
  format: 'couch-coach-landmarks/1';
  exercise: Exercise | null;
  aspect: number | null;
  exportedAt: number;
  frames: PoseFrame[];
}

/** Time-windowed buffer of the most recent landmark frames. */
export function createFrameRing(windowMs: number): FrameRing {
  let frames: PoseFrame[] = [];
  const snapshot = () => frames.slice();
  return {
    add(frame) {
      const cutoff = frame.t - windowMs;
      frames = [...frames.filter((f) => f.t >= cutoff), frame];
    },
    size: () => frames.length,
    snapshot,
    toExport: (meta) => ({ format: 'couch-coach-landmarks/1', ...meta, frames: snapshot() }),
  };
}
