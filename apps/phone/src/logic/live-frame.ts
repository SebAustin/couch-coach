import { encodeFrame, type Landmark, type Motion, type PhoneEvent, type PoseFrame } from '@couch-coach/protocol';
import type { SetRunner } from './set-runner';

type RepEvent = Extract<PhoneEvent, { type: 'rep' }>;

export interface DetectedFrame {
  pose: Landmark[];
  /** Wall-clock capture time (epoch ms): what goes on the wire. */
  t: number;
  /** Monotonic time: what the rep counter gets. */
  mono: number;
}

/**
 * One detected pose through the Set. The counter sees the frame first, so the encoded frame carries the
 * motion (depth, phase, target) that already includes it. `runner` is null outside a Set and while paused:
 * nothing is counted and the frame goes out without motion.
 */
export function processPose(
  detected: DetectedFrame,
  runner: SetRunner<Landmark[]> | null,
): { frame: PoseFrame; rep: RepEvent | null } {
  let rep: RepEvent | null = null;
  if (runner) {
    try {
      rep = runner.push(detected.pose, detected.mono, detected.t);
    } catch (err) {
      console.warn('rep counter rejected a frame', err);
    }
  }
  return { frame: encodeFrame(detected.pose, detected.t, runner?.motion()), rep };
}

/** Debug-line text for the live motion, e.g. `depth 0.42 active`. */
export const describeMotion = (motion: Motion): string => `depth ${motion.depth.toFixed(2)} ${motion.phase}`;
