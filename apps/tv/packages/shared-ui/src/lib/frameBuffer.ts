import type { Landmark, Motion, PoseBatch } from '../vendor/protocol';
import { decodeFrame } from '../vendor/protocol';
import { lerpPose, smoothPose } from './smoothing';

export interface TimedPose {
  /** Capture time on the phone clock (ms). */
  t: number;
  pose: Landmark[];
  /** The phone's live rep-counter state for this frame (newer phones only). */
  motion?: Motion;
}

/** What to draw at a moment: the (interpolated) pose and the live motion, null when the frames carry none. */
export interface SampledFrame {
  pose: Landmark[];
  motion: Motion | null;
}

export interface FrameBufferOptions {
  /** Lower bound of the playout delay (ms). */
  minDelayMs?: number;
  /** Upper bound of the playout delay (ms). */
  maxDelayMs?: number;
  /** Extra margin added on top of the largest recent gap between batches (ms). */
  marginMs?: number;
  /** Window over which the clock offset minimum and batch gaps are tracked (ms). */
  windowMs?: number;
  /** How fast the delay may shrink back (ms of delay per second of wall time). */
  shrinkPerSecondMs?: number;
  /** Max frames kept. */
  maxFrames?: number;
  /** Batch gaps longer than this are treated as an outage, not jitter, and do not raise the delay (ms). */
  maxJitterGapMs?: number;
  /** EMA-smooth poses as they arrive (default true). */
  smoothing?: boolean;
}

const DEFAULTS: Required<FrameBufferOptions> = {
  minDelayMs: 150,
  maxDelayMs: 450,
  marginMs: 40,
  windowMs: 5000,
  shrinkPerSecondMs: 25,
  maxFrames: 90,
  maxJitterGapMs: 1000,
  smoothing: true,
};

export interface BufferStats {
  frames: number;
  playoutDelayMs: number;
  /** Times `sample` had to hold the newest frame because the next batch had not arrived. */
  starvedSamples: number;
  /** Total frames accepted. */
  received: number;
}

/**
 * Jitter buffer for Pose frames. The phone publishes ~3 frames per batch about 5 times a second, so frames
 * arrive in bursts; playing them back at their capture times (shifted by a small playout delay) turns the
 * bursts into smooth 15 fps motion.
 *
 * Clock mapping: phone and TV clocks differ, so for every frame we measure `arrival - t` and take the
 * minimum over a sliding window as the clock offset (the least-delayed packet best approximates the true
 * offset plus the minimum network latency). Playout time = now - offset - delay.
 *
 * The delay adapts to the burst spacing: it is the 90th-percentile recent gap between batch arrivals plus a margin,
 * growing at once and shrinking slowly, so the cursor does not run out of frames between bursts.
 *
 * Internal state is replaced, never mutated in place, except for the monotonic counters.
 */
export class FrameBuffer {
  private readonly opts: Required<FrameBufferOptions>;
  private frames: readonly TimedPose[] = [];
  private lastSmoothed: Landmark[] | null = null;
  private deltas: readonly { at: number; d: number }[] = [];
  private gaps: readonly { at: number; gap: number }[] = [];
  private lastBatchAt: number | null = null;
  private delayMs: number;
  private lastDelayUpdateAt: number | null = null;
  private starved = 0;
  private received = 0;

  constructor(options: FrameBufferOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.delayMs = this.opts.minDelayMs;
  }

  /** Add the frames of one PoseBatch (already decoded). `arrivalMs` is the TV clock when it arrived. */
  push(frames: readonly TimedPose[], arrivalMs: number): void {
    if (frames.length === 0) return;
    const known = new Set(this.frames.map((f) => f.t));
    const fresh = [...frames].sort((a, b) => a.t - b.t).filter((f) => !known.has(f.t));
    if (fresh.length === 0) return;

    // Smooth in time order against the previous smoothed pose.
    const smoothed: TimedPose[] = [];
    let previous = this.lastSmoothed;
    for (const f of fresh) {
      const pose = this.opts.smoothing ? smoothPose(previous, f.pose) : f.pose;
      smoothed.push(f.motion ? { t: f.t, pose, motion: f.motion } : { t: f.t, pose });
      previous = pose;
    }
    // Only advance the smoothing state if these frames are the newest we have seen.
    const newestKnown = this.frames.length > 0 ? this.frames[this.frames.length - 1]!.t : -Infinity;
    if (smoothed[smoothed.length - 1]!.t > newestKnown) this.lastSmoothed = previous;

    this.frames = [...this.frames, ...smoothed].sort((a, b) => a.t - b.t).slice(-this.opts.maxFrames);
    this.received += smoothed.length;

    const cutoff = arrivalMs - this.opts.windowMs;
    this.deltas = [
      ...this.deltas.filter((d) => d.at >= cutoff),
      ...fresh.map((f) => ({ at: arrivalMs, d: arrivalMs - f.t })),
    ];
    this.updateDelay(arrivalMs, cutoff);
  }

  /** Convenience: decode a wire PoseBatch (keeping each frame's motion) and push it. */
  pushBatch(batch: PoseBatch, arrivalMs: number): void {
    this.push(
      batch.frames.map((frame) =>
        frame.motion ? { ...decodeFrame(frame), motion: frame.motion } : decodeFrame(frame),
      ),
      arrivalMs,
    );
  }

  private updateDelay(arrivalMs: number, cutoff: number): void {
    if (this.lastBatchAt !== null && arrivalMs - this.lastBatchAt <= this.opts.maxJitterGapMs) {
      this.gaps = [...this.gaps.filter((g) => g.at >= cutoff), { at: arrivalMs, gap: arrivalMs - this.lastBatchAt }];
    }
    this.lastBatchAt = arrivalMs;
    // 90th percentile of recent batch gaps: covers normal jitter without letting one stall inflate the delay.
    const sorted = this.gaps.map((g) => g.gap).sort((a, b) => a - b);
    const typicalGap = sorted.length === 0 ? 0 : sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)]!;
    const target = Math.min(this.opts.maxDelayMs, Math.max(this.opts.minDelayMs, typicalGap + this.opts.marginMs));
    const elapsed = this.lastDelayUpdateAt === null ? 0 : Math.max(0, arrivalMs - this.lastDelayUpdateAt);
    this.lastDelayUpdateAt = arrivalMs;
    if (target >= this.delayMs) this.delayMs = target;
    else this.delayMs = Math.max(target, this.delayMs - (this.opts.shrinkPerSecondMs * elapsed) / 1000);
  }

  /** Estimated `tvClock - phoneClock` (ms), or null before any frame. */
  clockOffsetMs(): number | null {
    if (this.deltas.length === 0) return null;
    return this.deltas.reduce((m, d) => Math.min(m, d.d), Infinity);
  }

  /** The phone-clock time being played out at TV time `nowMs`, or null before any frame. */
  playoutTime(nowMs: number): number | null {
    const offset = this.clockOffsetMs();
    return offset === null ? null : nowMs - offset - this.delayMs;
  }

  /** Playout delay currently applied (ms): a Rep event is drawn about this long after it arrives. */
  playoutDelayMs(): number {
    return this.delayMs;
  }

  /**
   * The frame to draw at TV time `nowMs`: the pose interpolated between the two bracketing frames (the newest is held
   * if starved), and the motion with its depth interpolated when both frames have one, otherwise the nearest frame's.
   * Null if empty.
   */
  sampleFrame(nowMs: number): SampledFrame | null {
    const target = this.playoutTime(nowMs);
    const frames = this.frames;
    if (target === null || frames.length === 0) return null;

    const first = frames[0]!;
    const last = frames[frames.length - 1]!;
    if (target <= first.t) return asSampled(first);
    if (target >= last.t) {
      this.starved += 1;
      return asSampled(last);
    }
    // Binary search for the bracketing pair.
    let lo = 0;
    let hi = frames.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid]!.t <= target) lo = mid;
      else hi = mid;
    }
    const a = frames[lo]!;
    const b = frames[hi]!;
    const span = b.t - a.t;
    const f = span <= 0 ? 1 : (target - a.t) / span;
    return { pose: lerpPose(a.pose, b.pose, f), motion: lerpMotion(a.motion, b.motion, f) };
  }

  /** The pose to draw at TV time `nowMs` (see `sampleFrame`), or null if empty. */
  sample(nowMs: number): Landmark[] | null {
    return this.sampleFrame(nowMs)?.pose ?? null;
  }

  /** The newest frame with no interpolation (reduced-motion rendering), or null if empty. */
  latestFrame(): SampledFrame | null {
    return this.frames.length === 0 ? null : asSampled(this.frames[this.frames.length - 1]!);
  }

  /** The newest pose with no interpolation, or null if empty. */
  latest(): Landmark[] | null {
    return this.latestFrame()?.pose ?? null;
  }

  stats(): BufferStats {
    return {
      frames: this.frames.length,
      playoutDelayMs: Math.round(this.delayMs),
      starvedSamples: this.starved,
      received: this.received,
    };
  }

  reset(): void {
    this.frames = [];
    this.lastSmoothed = null;
    this.deltas = [];
    this.gaps = [];
    this.lastBatchAt = null;
    this.lastDelayUpdateAt = null;
    this.delayMs = this.opts.minDelayMs;
    this.starved = 0;
    this.received = 0;
  }
}

const asSampled = (frame: TimedPose): SampledFrame => ({ pose: frame.pose, motion: frame.motion ?? null });

/** Depth is interpolated when both frames have motion; phase and target (and a one-sided motion) come from the nearest. */
function lerpMotion(a: Motion | undefined, b: Motion | undefined, f: number): Motion | null {
  const nearest = f < 0.5 ? a : b;
  if (!a || !b || !nearest) return nearest ?? null;
  return { depth: a.depth + (b.depth - a.depth) * f, phase: nearest.phase, target: nearest.target };
}

/** True when `t` looks like a Unix epoch in ms (so `now - t` is a meaningful receive latency). */
export function looksLikeEpochMs(t: number): boolean {
  return t > 1e12;
}
