import {
  CENTER_DEADZONE,
  desiredZoom,
  ease,
  ENVELOPE_RELEASE,
  figureHeightPx,
  fitZoom,
  FRAME_FILL,
  initialFraming,
  LOST_AFTER_MS,
  MAX_ZOOM,
  poseBounds,
  projectionFor,
  retarget,
  stepEnvelope,
  stepFraming,
  zoomRatio,
  ZOOM_HYSTERESIS,
  type Bounds,
  type FramingContext,
  type FramingState,
} from '../autoFrame';
import { JOINTS, NOSE } from '../poseConnections';
import { KEYPOINT_COUNT, type Landmark } from '../../vendor/protocol';

const ASPECT = 9 / 16;
const VP = { width: 1056, height: 972 };
const CTX: FramingContext = { viewport: VP, aspect: ASPECT };
const K_FIT = fitZoom(VP, ASPECT); // 972: the 9:16 frame fits by height
const TRACKED = [NOSE, ...JOINTS];
const FRAME_MS = 33;

/**
 * A figure whose tracked landmarks (nose + joints) zig-zag from `top` to `bottom` across `width` around camera x `cx`.
 * Untracked landmarks (face, hands) sit in the far corner so a test notices if they leak into the bounds.
 */
function figure({ cx = 0.5, top = 0.2, bottom = 0.9, width = 0.2, hidden = [] as number[] } = {}): Landmark[] {
  const pose: Landmark[] = Array.from({ length: KEYPOINT_COUNT }, () => ({ x: 0, y: 0, visibility: 1 }));
  return pose.map((p, i) => {
    const k = TRACKED.indexOf(i);
    if (k < 0) return p;
    return {
      x: cx + (k % 2 === 0 ? -width / 2 : width / 2),
      y: top + ((bottom - top) * k) / (TRACKED.length - 1),
      visibility: hidden.includes(i) ? 0.2 : 1,
    };
  });
}

/** Bounds in camera units for a raw box (before padding), so scenario tests can drive stepFraming directly. */
const box = (left: number, top: number, right: number, bottom: number): Bounds => ({ left, top, right, bottom });

/** Steps the framing every 33 ms over [from, to) with bounds from `boundsAt(t)`, collecting each state. */
function run(state: FramingState, from: number, to: number, boundsAt: (t: number) => Bounds | null, ctx = CTX) {
  const states: FramingState[] = [];
  let s = state;
  for (let t = from; t < to; t += FRAME_MS) {
    s = stepFraming(s, boundsAt(t), t, ctx);
    states.push(s);
  }
  return { last: s, states };
}

describe('poseBounds', () => {
  it('mirrors x, scales it by the aspect and pads top 10%, sides 5%, bottom 3% of the height', () => {
    const b = poseBounds(figure({ cx: 0.3, top: 0.2, bottom: 0.8, width: 0.2 }), ASPECT)!;
    const h = 0.6;
    // Camera x 0.2..0.4 -> mirrored u = (1 - x) * aspect = 0.6a..0.8a: a person on the camera's left shows on the right.
    expect(b.left).toBeCloseTo(0.6 * ASPECT - 0.05 * h, 6);
    expect(b.right).toBeCloseTo(0.8 * ASPECT + 0.05 * h, 6);
    expect(b.top).toBeCloseTo(0.2 - 0.1 * h, 6);
    expect(b.bottom).toBeCloseTo(0.8 + 0.03 * h, 6);
  });

  it('ignores low-visibility points and untracked landmarks', () => {
    const base = poseBounds(figure(), ASPECT)!;
    const wild = figure().map((p, i) => (i === 15 ? { x: 0.99, y: 0.99, visibility: 0.3 } : p));
    expect(poseBounds(wild, ASPECT)).toEqual(base);
  });

  it('is null when fewer than 8 tracked points are visible', () => {
    expect(poseBounds(figure({ hidden: TRACKED.slice(0, 10) }), ASPECT)).toBeNull(); // 7 visible
    expect(poseBounds(figure({ hidden: TRACKED.slice(0, 9) }), ASPECT)).not.toBeNull(); // 8 visible
    expect(poseBounds([], ASPECT)).toBeNull();
  });
});

describe('stepEnvelope', () => {
  const env = box(0.2, 0.1, 0.4, 0.9); // height 0.8

  it('starts at the first bounds', () => {
    expect(stepEnvelope(null, env, 33)).toEqual(env);
  });

  it('grows at once to include new bounds', () => {
    expect(stepEnvelope(env, box(0.1, 0.05, 0.5, 0.95), 0)).toEqual(box(0.1, 0.05, 0.5, 0.95));
  });

  it('shrinks by at most 4% of its height per second, and never past the new bounds', () => {
    const shrunk = stepEnvelope(env, box(0.25, 0.3, 0.35, 0.8), 1000);
    const step = ENVELOPE_RELEASE * 0.8;
    expect(shrunk.top).toBeCloseTo(0.1 + step, 6);
    expect(shrunk.left).toBeCloseTo(0.2 + step, 6);
    expect(shrunk.right).toBeCloseTo(0.4 - step, 6);
    expect(shrunk.bottom).toBeCloseTo(0.9 - step, 6);
    expect(stepEnvelope(env, box(0.25, 0.3, 0.35, 0.8), 100_000)).toEqual(box(0.25, 0.3, 0.35, 0.8));
  });
});

describe('desiredZoom', () => {
  it('makes the envelope fill 80% of the viewport height', () => {
    const env = box(0.1, 0.3, 0.3, 0.7);
    const k = desiredZoom(env, VP, ASPECT);
    expect(((env.bottom - env.top) * k) / VP.height).toBeCloseTo(FRAME_FILL, 6);
  });

  it('also keeps a wide envelope inside the width', () => {
    const env = box(0, 0.4, 0.5, 0.7);
    const k = desiredZoom(env, VP, ASPECT);
    expect(k * 0.5).toBeCloseTo(FRAME_FILL * VP.width, 6);
  });

  it('clamps between the full camera frame (1x) and 3x', () => {
    expect(desiredZoom(box(0, 0, ASPECT, 1.1), VP, ASPECT)).toBe(K_FIT);
    expect(desiredZoom(box(0.25, 0.45, 0.3, 0.5), VP, ASPECT)).toBe(K_FIT * MAX_ZOOM);
  });

  it('fits a landscape frame by width', () => {
    expect(fitZoom(VP, 16 / 9)).toBeCloseTo(1056 / (16 / 9), 6);
  });
});

describe('retarget', () => {
  it('keeps the target within +-12% and follows a bigger change', () => {
    expect(retarget(1000, 1000 * (1 + ZOOM_HYSTERESIS) - 1)).toBe(1000);
    expect(retarget(1000, 1000 * (1 - ZOOM_HYSTERESIS) + 1)).toBe(1000);
    expect(retarget(1000, 1130)).toBe(1130);
    expect(retarget(1000, 870)).toBe(870);
  });
});

describe('ease', () => {
  it('gives the same result whether or not the step is split (frame-rate independent)', () => {
    const whole = ease(0, 100, 700, 700);
    expect(whole).toBeCloseTo(100 * (1 - Math.exp(-1)), 6);
    expect(ease(ease(0, 100, 300, 700), 100, 400, 700)).toBeCloseTo(whole, 6);
  });

  it('cuts straight to the target when tau is 0', () => {
    expect(ease(0, 100, 16, 0)).toBe(100);
  });
});

describe('stepFraming', () => {
  // A small person (about 35% of the frame high) off to one side, like --scale 0.45 --offset-x 0.12.
  const small = box(0.1, 0.4, 0.2, 0.75);

  it('starts on the full camera frame', () => {
    const start = initialFraming(VP, ASPECT);
    expect(start.current.zoom).toBe(K_FIT);
    expect(zoomRatio(start)).toBe(1);
    const p = projectionFor(start);
    // The whole 9:16 frame is centred: x 0..1 spans the middle 547 px.
    expect(p.tx).toBeCloseTo(VP.width / 2 - (ASPECT / 2) * K_FIT, 6);
    expect(p.ty).toBeCloseTo(0, 6);
  });

  it('pushes in on first lock-on and centres the envelope', () => {
    const first = stepFraming(initialFraming(VP, ASPECT), small, 0, CTX);
    expect(first.target.zoom).toBeCloseTo(desiredZoom(small, VP, ASPECT), 6);
    expect(first.current.zoom).toBe(K_FIT); // no time has passed yet: the push-in eases from here

    const { last } = run(first, FRAME_MS, 4000, () => small);
    expect(last.current.zoom / last.target.zoom).toBeCloseTo(1, 2);
    const p = projectionFor(last);
    const cx = (small.left + small.right) / 2;
    const cy = (small.top + small.bottom) / 2;
    expect(cx * (p.sx / ASPECT) + p.tx).toBeCloseTo(VP.width / 2, 0);
    expect(cy * p.sy + p.ty).toBeCloseTo(VP.height / 2, 0);
  });

  it('holds the zoom through a squat and a jumping jack (box +-20% at 0.4 Hz for 20 s)', () => {
    const wave = (t: number) => Math.sin(2 * Math.PI * 0.4 * (t / 1000));
    // Squat: feet stay put, the head dips (height +-20%).
    const squat = (t: number) => {
      const h = 0.35 * (1 + 0.2 * wave(t));
      return box(0.1, 0.75 - h, 0.2, 0.75);
    };
    // Jack: arms and feet open (width +-20%) and the hands go above the head (height +10%).
    const jack = (t: number) => {
      const w = 0.12 * (1 + 0.2 * wave(t));
      const h = 0.35 * (1 + 0.1 * Math.max(0, wave(t)));
      return box(0.15 - w / 2, 0.75 - h, 0.15 + w / 2, 0.75);
    };
    for (const boundsAt of [squat, jack]) {
      const { states } = run(initialFraming(VP, ASPECT), 0, 20_000, boundsAt);
      const settled = states.slice(Math.round(5000 / FRAME_MS));
      const retargets = settled.filter((s, i) => i > 0 && s.target.zoom !== settled[i - 1]!.target.zoom).length;
      expect(retargets).toBeLessThanOrEqual(1);
      const zooms = settled.map((s) => s.current.zoom);
      expect(Math.max(...zooms) / Math.min(...zooms) - 1).toBeLessThan(0.02);
      expect(zoomRatio(settled[settled.length - 1]!)).toBeGreaterThan(1.5); // it really is zoomed in
    }
  });

  it('ignores a centre shift inside the dead zone and follows a bigger one', () => {
    const locked = run(initialFraming(VP, ASPECT), 0, 3000, () => small).last;
    const h = locked.envelope!.bottom - locked.envelope!.top;
    const nudge = CENTER_DEADZONE * h; // moves the envelope centre by half this: inside the dead zone
    const nudged = stepFraming(
      locked,
      box(small.left + nudge, small.top, small.right + nudge, small.bottom),
      3000,
      CTX,
    );
    expect(nudged.target.u).toBe(locked.target.u);

    const moved = stepFraming(locked, box(small.left + 0.2, small.top, small.right + 0.2, small.bottom), 3000, CTX);
    expect(moved.target.u).toBeCloseTo((moved.envelope!.left + moved.envelope!.right) / 2, 6);
  });

  it('returns to the full frame after 1 s without tracking, and forgets the envelope', () => {
    const locked = run(initialFraming(VP, ASPECT), 0, 3000, () => small).last;
    const stillHolding = run(locked, 3000, 3000 + LOST_AFTER_MS - FRAME_MS, () => null).last;
    expect(stillHolding.target.zoom).toBe(locked.target.zoom);

    const lost = run(stillHolding, 3000 + LOST_AFTER_MS, 3000 + LOST_AFTER_MS + 1, () => null).last;
    expect(lost.envelope).toBeNull();
    expect(lost.target).toEqual({ zoom: K_FIT, u: ASPECT / 2, v: 0.5 });

    const back = run(lost, 4100, 8000, () => null).last;
    expect(zoomRatio(back)).toBeCloseTo(1, 2);
  });

  it('cuts instead of gliding under reduced motion, still gated by the hysteresis', () => {
    const reduced = { ...CTX, reduceMotion: true };
    const first = stepFraming(initialFraming(VP, ASPECT), small, 0, reduced);
    expect(first.current).toEqual(first.target);
    // 5% taller: inside the hysteresis, nothing moves.
    const taller = box(small.left, small.top - 0.0175, small.right, small.bottom);
    const held = stepFraming(first, taller, 33, reduced);
    expect(held.current.zoom).toBe(first.current.zoom);
  });

  it('starts over when the aspect or viewport changes', () => {
    const locked = run(initialFraming(VP, ASPECT), 0, 3000, () => small).last;
    const landscape = stepFraming(locked, null, 3033, { viewport: VP, aspect: 16 / 9 });
    expect(landscape.envelope).toBeNull();
    expect(landscape.current.zoom).toBeCloseTo(fitZoom(VP, 16 / 9), 6);
  });
});

describe('figureHeightPx', () => {
  it('is the unpadded envelope height on screen, or null before lock-on', () => {
    expect(figureHeightPx(initialFraming(VP, ASPECT))).toBeNull();
    const s = stepFraming(initialFraming(VP, ASPECT), box(0, 0.1, 0.3, 0.1 + 0.565), 0, { ...CTX, reduceMotion: true });
    expect(figureHeightPx(s)).toBeCloseTo((0.565 / 1.13) * s.current.zoom, 6);
  });
});
