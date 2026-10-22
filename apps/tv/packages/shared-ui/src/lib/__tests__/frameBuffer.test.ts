import { FrameBuffer, looksLikeEpochMs, type TimedPose } from '../frameBuffer';
import { encodeFrame, KEYPOINT_COUNT, type Motion } from '../../vendor/protocol';

const pose = (x: number, y = 0.5, visibility = 1) =>
  Array.from({ length: KEYPOINT_COUNT }, () => ({ x, y, visibility }));

const frame = (t: number, x: number): TimedPose => ({ t, pose: pose(x) });
const moving = (t: number, x: number, motion: Motion): TimedPose => ({ t, pose: pose(x), motion });
const rest = (depth: number): Motion => ({ depth, phase: 'rest', target: 0.4 });
const active = (depth: number): Motion => ({ depth, phase: 'active', target: 0.5 });

/** Frames at 15 fps (66 ms apart) whose x equals their index, so interpolation is easy to assert. */
const burst = (startT: number, count: number, startX: number): TimedPose[] =>
  Array.from({ length: count }, (_, i) => frame(startT + i * 66, startX + i));

describe('FrameBuffer', () => {
  it('returns null before any frame arrives', () => {
    const buffer = new FrameBuffer();
    expect(buffer.sample(1000)).toBeNull();
    expect(buffer.clockOffsetMs()).toBeNull();
  });

  it('interpolates between the two frames that bracket the playout time', () => {
    const buffer = new FrameBuffer({ minDelayMs: 0, marginMs: 0, smoothing: false });
    // Offset = min(arrival - t) = 1000 - 200 = 800 (the newest frame is the least delayed).
    buffer.push([frame(100, 0), frame(200, 1)], 1000);
    // playout = now - 800 - 0 = 150 -> halfway between t=100 and t=200
    const sampled = buffer.sample(950)!;
    expect(sampled[0]!.x).toBeCloseTo(0.5, 5);
  });

  it('holds the newest frame instead of extrapolating when starved, and counts it', () => {
    const buffer = new FrameBuffer({ minDelayMs: 0, marginMs: 0, smoothing: false });
    buffer.push([frame(100, 0), frame(200, 1)], 1000);
    const sampled = buffer.sample(5000)!;
    expect(sampled[0]!.x).toBeCloseTo(1, 5);
    expect(buffer.stats().starvedSamples).toBe(1);
  });

  it('clamps to the oldest frame when the cursor is before the buffer', () => {
    const buffer = new FrameBuffer({ minDelayMs: 0, marginMs: 0, smoothing: false });
    buffer.push([frame(100, 0), frame(200, 1)], 1000);
    expect(buffer.sample(850)![0]!.x).toBeCloseTo(0, 5); // playout 50 < oldest t=100
  });

  it('takes the least-delayed packet as the clock offset (robust to jitter)', () => {
    const buffer = new FrameBuffer();
    buffer.push([frame(1000, 0)], 1500); // d = 500
    buffer.push([frame(1066, 0)], 1590); // d = 524 (late)
    buffer.push([frame(1133, 0)], 1600); // d = 467 (fastest)
    expect(buffer.clockOffsetMs()).toBe(467);
  });

  it('ignores duplicate timestamps and sorts out-of-order frames', () => {
    const buffer = new FrameBuffer({ minDelayMs: 0, marginMs: 0, smoothing: false });
    buffer.push([frame(200, 1), frame(100, 0)], 1000);
    buffer.push([frame(200, 99)], 1010); // duplicate t
    expect(buffer.stats().frames).toBe(2);
    expect(buffer.sample(1100)![0]!.x).toBeCloseTo(1, 5);
  });

  it('keeps at most maxFrames, dropping the oldest', () => {
    const buffer = new FrameBuffer({ maxFrames: 5 });
    buffer.push(burst(0, 20, 0), 2000);
    expect(buffer.stats().frames).toBe(5);
  });

  it('grows the playout delay to cover the gap between batches, then shrinks it slowly', () => {
    const buffer = new FrameBuffer({ minDelayMs: 150, marginMs: 40, shrinkPerSecondMs: 25 });
    buffer.push(burst(0, 3, 0), 1000);
    buffer.push(burst(200, 3, 3), 1200); // 200 ms gap -> delay 240
    expect(buffer.stats().playoutDelayMs).toBe(240);
    // Smaller gaps afterwards: the window still remembers the 200 ms gap, so no shrink yet.
    buffer.push(burst(266, 3, 6), 1266);
    expect(buffer.stats().playoutDelayMs).toBe(240);
    // Much later the old gap leaves the 5 s window; the delay then falls by at most 25 ms per second.
    buffer.push(burst(7000, 3, 9), 8000);
    buffer.push(burst(7066, 3, 12), 8066);
    const delay = buffer.stats().playoutDelayMs;
    expect(delay).toBeLessThan(240);
    expect(delay).toBeGreaterThanOrEqual(150);
  });

  it('plays a bursty stream back without starving (3 frames every 200 ms)', () => {
    const buffer = new FrameBuffer();
    const latency = 80;
    let starvedBefore = 0;
    for (let batch = 0; batch < 20; batch += 1) {
      const t0 = batch * 200;
      // Frames captured at t0, t0+66, t0+133; the batch is published after the last capture.
      buffer.push(burst(t0, 3, batch * 3), t0 + 133 + latency);
      if (batch === 5) starvedBefore = buffer.stats().starvedSamples;
      // Sample every 16 ms through the next 200 ms once warmed up.
      if (batch >= 5) {
        for (let dt = 0; dt < 200; dt += 16) buffer.sample(t0 + 133 + latency + dt);
      }
    }
    expect(buffer.stats().starvedSamples - starvedBefore).toBeLessThanOrEqual(3);
  });

  it('decodes a wire PoseBatch', () => {
    const buffer = new FrameBuffer();
    const batch = {
      type: 'pose' as const,
      frames: [encodeFrame(pose(0.25), 10), encodeFrame(pose(0.75), 20)],
    };
    buffer.pushBatch(batch, 100);
    expect(buffer.stats().frames).toBe(2);
  });

  it('smooths each landmark with an EMA across frames (alpha 0.5)', () => {
    const buffer = new FrameBuffer({ minDelayMs: 0, marginMs: 0 });
    buffer.push([frame(100, 0), frame(200, 1)], 1000);
    // Second frame smoothed: 0 + (1 - 0) * 0.5 for ordinary joints, 0.7 for wrists (index 15).
    const end = buffer.sample(5000)!;
    expect(end[0]!.x).toBeCloseTo(0.5, 5);
    expect(end[15]!.x).toBeCloseTo(0.7, 5);
  });

  it('keeps live motion: depth interpolated, phase and target from the nearest frame', () => {
    const buffer = new FrameBuffer({ minDelayMs: 0, marginMs: 0, smoothing: false });
    buffer.push([moving(100, 0, rest(0.2)), moving(200, 1, active(0.6))], 1000); // offset 800
    const early = buffer.sampleFrame(920)!; // playout 120: 20% of the way
    expect(early.pose[0]!.x).toBeCloseTo(0.2, 5);
    expect(early.motion!.depth).toBeCloseTo(0.28, 5);
    expect(early.motion).toMatchObject({ phase: 'rest', target: 0.4 });
    const late = buffer.sampleFrame(975)!; // playout 175: 75% of the way
    expect(late.motion!.depth).toBeCloseTo(0.5, 5);
    expect(late.motion).toMatchObject({ phase: 'active', target: 0.5 });
  });

  it("gives null motion when frames lack it, and the nearest frame's when only one side has it", () => {
    const plain = new FrameBuffer({ minDelayMs: 0, marginMs: 0, smoothing: false });
    plain.push([frame(100, 0), frame(200, 1)], 1000);
    expect(plain.sampleFrame(950)!.motion).toBeNull();

    const mixed = new FrameBuffer({ minDelayMs: 0, marginMs: 0, smoothing: false });
    mixed.push([moving(100, 0, rest(0.2)), frame(200, 1)], 1000);
    expect(mixed.sampleFrame(925)!.motion).toEqual(rest(0.2)); // playout 125: nearest is t=100
    expect(mixed.sampleFrame(975)!.motion).toBeNull(); // playout 175: nearest is t=200
  });

  it('holds the newest motion when starved; sample() delegates and counts each starved sample once', () => {
    const buffer = new FrameBuffer({ minDelayMs: 0, marginMs: 0, smoothing: false });
    buffer.push([moving(100, 0, rest(0.1)), moving(200, 1, active(0.9))], 1000);
    expect(buffer.sampleFrame(5000)!.motion).toEqual(active(0.9));
    expect(buffer.stats().starvedSamples).toBe(1);
    expect(buffer.sample(5000)![0]!.x).toBeCloseTo(1, 5);
    expect(buffer.stats().starvedSamples).toBe(2);
  });

  it('returns the newest frame with its motion for reduced motion', () => {
    const buffer = new FrameBuffer({ smoothing: false });
    expect(buffer.latestFrame()).toBeNull();
    buffer.push([moving(200, 1, active(0.7)), moving(100, 0, rest(0))], 1000);
    expect(buffer.latestFrame()).toEqual({ pose: pose(1), motion: active(0.7) });
    expect(buffer.latest()).toEqual(pose(1));
  });

  it('keeps the motion of a wire PoseBatch', () => {
    const buffer = new FrameBuffer({ minDelayMs: 0, marginMs: 0, smoothing: false });
    buffer.pushBatch(
      { type: 'pose', frames: [encodeFrame(pose(0.25), 10, active(0.333)), encodeFrame(pose(0.75), 20)] },
      100,
    );
    expect(buffer.sampleFrame(0)!.motion).toEqual(active(0.33)); // rounded on the wire
  });

  it('exposes the playout delay so flashes can wait for the drawn Rep', () => {
    const buffer = new FrameBuffer({ minDelayMs: 150, marginMs: 40 });
    expect(buffer.playoutDelayMs()).toBe(150);
    buffer.push(burst(0, 3, 0), 1000);
    buffer.push(burst(200, 3, 3), 1200); // 200 ms gap -> 240
    expect(buffer.playoutDelayMs()).toBe(240);
  });

  it('reset clears all state', () => {
    const buffer = new FrameBuffer();
    buffer.push(burst(0, 3, 0), 1000);
    buffer.reset();
    expect(buffer.sample(1100)).toBeNull();
    expect(buffer.stats().received).toBe(0);
  });
});

describe('looksLikeEpochMs', () => {
  it('distinguishes wall-clock stamps from monotonic ones', () => {
    expect(looksLikeEpochMs(Date.now())).toBe(true);
    expect(looksLikeEpochMs(123456)).toBe(false);
  });
});
