import type { Landmark } from '../vendor/protocol';
import { JOINTS, NOSE, VISIBILITY_THRESHOLD } from './poseConnections';
import type { Projection } from './skeletonPaths';

/**
 * Auto-framing: a slow, calm "camera operator" that zooms the skeleton so a small or off-centre person still fills
 * the stage. Pure functions over an immutable state; SkeletonStage steps it once per drawn frame.
 *
 * Coordinates are camera units: u = (1 - x) * aspect (mirrored like the drawing, same scale on both axes), v = y.
 * The whole camera frame is [0, aspect] x [0, 1]. A zoom `k` is device px per camera unit.
 *
 * Calm comes from three layers: an envelope that grows at once but shrinks slowly (a squat dip or jack arms never
 * shrink it enough to matter), a hysteresis on the zoom target and a dead zone on the centre (so changes are rare),
 * and a time-constant ease towards the target (so the rare changes glide, whatever the frame rate).
 */

/** An axis-aligned box in camera units. */
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** A framing: zoom (px per camera unit) and the camera point shown at the viewport centre. */
export interface Shot {
  zoom: number;
  u: number;
  v: number;
}

export interface FramingState {
  /** What the state was built for; stepping with a different viewport or aspect starts over. */
  viewport: Viewport;
  aspect: number;
  /** Time of the last step (ms), or null before the first. */
  at: number | null;
  /** Last time a person was tracked (ms), or null. */
  seenAt: number | null;
  /** Slow-release union of recent padded pose bounds; null while nobody is locked on. */
  envelope: Bounds | null;
  /** What is drawn now (eases towards `target`). */
  current: Shot;
  target: Shot;
}

export interface FramingContext {
  viewport: Viewport;
  aspect: number;
  /** Cut instead of gliding (tau 0); the hysteresis still keeps cuts rare. */
  reduceMotion?: boolean;
}

/** Fewer visible tracked points than this (nose + 16 joints) is not a person worth framing. */
export const MIN_TRACKED = 8;
/** Padding around the pose box as a fraction of its height: room for the head disc, hands and feet. */
export const PAD_TOP = 0.1;
export const PAD_SIDE = 0.05;
export const PAD_BOTTOM = 0.03;
/** How fast the envelope may shrink: this fraction of its height per second. */
export const ENVELOPE_RELEASE = 0.04;
/** The envelope fills this fraction of the viewport height (and at most of its width). */
export const FRAME_FILL = 0.8;
/** Max zoom relative to the full camera frame. Landmark jitter is magnified as much; drop to 2.5 if joints shimmer. */
export const MAX_ZOOM = 3;
/** The zoom target only moves when the wanted zoom differs from it by more than this fraction. */
export const ZOOM_HYSTERESIS = 0.12;
/** The centre target only moves when the wanted centre is further than this fraction of the envelope height. */
export const CENTER_DEADZONE = 0.06;
export const ZOOM_TAU_MS = 700;
export const CENTER_TAU_MS = 450;
/** After this long without tracking, ease back out to the full camera frame. */
export const LOST_AFTER_MS = 1000;

const TRACKED: readonly number[] = [NOSE, ...JOINTS];
const PAD_HEIGHT = 1 + PAD_TOP + PAD_BOTTOM;
const MIN_SPAN = 1e-6;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Padded box around the visible nose and joints, in camera units; null when fewer than 8 are visible. */
export function poseBounds(pose: readonly Landmark[], aspect: number): Bounds | null {
  let count = 0;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const i of TRACKED) {
    const p = pose[i];
    if (!p || p.visibility < VISIBILITY_THRESHOLD) continue;
    count += 1;
    const u = (1 - p.x) * aspect;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, p.y);
    maxV = Math.max(maxV, p.y);
  }
  if (count < MIN_TRACKED) return null;
  const h = maxV - minV;
  return {
    left: minU - PAD_SIDE * h,
    top: minV - PAD_TOP * h,
    right: maxU + PAD_SIDE * h,
    bottom: maxV + PAD_BOTTOM * h,
  };
}

/** Grows at once to include `bounds`; each edge creeps back in by at most ENVELOPE_RELEASE of the height per second. */
export function stepEnvelope(envelope: Bounds | null, bounds: Bounds, dtMs: number): Bounds {
  if (!envelope) return bounds;
  const release = (ENVELOPE_RELEASE * (envelope.bottom - envelope.top) * Math.max(0, dtMs)) / 1000;
  return {
    left: bounds.left < envelope.left ? bounds.left : Math.min(bounds.left, envelope.left + release),
    top: bounds.top < envelope.top ? bounds.top : Math.min(bounds.top, envelope.top + release),
    right: bounds.right > envelope.right ? bounds.right : Math.max(bounds.right, envelope.right - release),
    bottom: bounds.bottom > envelope.bottom ? bounds.bottom : Math.max(bounds.bottom, envelope.bottom - release),
  };
}

/** Zoom at which the whole camera frame fits the viewport (the "1x" full frame). */
export function fitZoom(viewport: Viewport, aspect: number): number {
  return Math.min(viewport.height, viewport.width / aspect);
}

/** Zoom that makes the envelope fill 80% of the viewport height (and fit the width), clamped to 1x..3x. */
export function desiredZoom(envelope: Bounds, viewport: Viewport, aspect: number): number {
  const kFit = fitZoom(viewport, aspect);
  const h = Math.max(MIN_SPAN, envelope.bottom - envelope.top);
  const w = Math.max(MIN_SPAN, envelope.right - envelope.left);
  const k = Math.min((FRAME_FILL * viewport.height) / h, (FRAME_FILL * viewport.width) / w);
  return clamp(k, kFit, kFit * MAX_ZOOM);
}

/** The new zoom target: `desired` only when it differs from `current` by more than the hysteresis. */
export function retarget(current: number, desired: number): number {
  return Math.abs(desired - current) > ZOOM_HYSTERESIS * current ? desired : current;
}

/** Exponential approach: the same result however the time is split into frames. tau 0 cuts straight to the target. */
export function ease(current: number, target: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return target;
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs));
}

const fullFrame = (viewport: Viewport, aspect: number): Shot => ({
  zoom: fitZoom(viewport, aspect),
  u: aspect / 2,
  v: 0.5,
});

/** The resting state: the whole camera frame, nobody locked on. */
export function initialFraming(viewport: Viewport, aspect: number): FramingState {
  const shot = fullFrame(viewport, aspect);
  return { viewport, aspect, at: null, seenAt: null, envelope: null, current: shot, target: shot };
}

const sameContext = (state: FramingState, ctx: FramingContext) =>
  state.aspect === ctx.aspect &&
  state.viewport.width === ctx.viewport.width &&
  state.viewport.height === ctx.viewport.height;

/** Updates the envelope and target for this frame's bounds (or their absence). */
function track(state: FramingState, bounds: Bounds | null, now: number, dtMs: number): FramingState {
  if (bounds) {
    const envelope = stepEnvelope(state.envelope, bounds, dtMs);
    const wanted: Shot = {
      zoom: desiredZoom(envelope, state.viewport, state.aspect),
      u: (envelope.left + envelope.right) / 2,
      v: (envelope.top + envelope.bottom) / 2,
    };
    // First lock-on goes straight for the person: from the full frame that reads as a push-in.
    if (!state.envelope) return { ...state, envelope, seenAt: now, target: wanted };
    const { target } = state;
    const recentre =
      Math.hypot(wanted.u - target.u, wanted.v - target.v) > CENTER_DEADZONE * (envelope.bottom - envelope.top);
    return {
      ...state,
      envelope,
      seenAt: now,
      target: {
        zoom: retarget(target.zoom, wanted.zoom),
        u: recentre ? wanted.u : target.u,
        v: recentre ? wanted.v : target.v,
      },
    };
  }
  const lost = state.envelope !== null && state.seenAt !== null && now - state.seenAt >= LOST_AFTER_MS;
  return lost ? { ...state, envelope: null, target: fullFrame(state.viewport, state.aspect) } : state;
}

/** Advances the framing to `now` with this frame's pose bounds (null when nobody is tracked). */
export function stepFraming(
  state: FramingState,
  bounds: Bounds | null,
  now: number,
  ctx: FramingContext,
): FramingState {
  const base = sameContext(state, ctx) ? state : initialFraming(ctx.viewport, ctx.aspect);
  const dt = base.at === null ? 0 : Math.max(0, now - base.at);
  const next = track(base, bounds, now, dt);
  const zoomTau = ctx.reduceMotion ? 0 : ZOOM_TAU_MS;
  const centerTau = ctx.reduceMotion ? 0 : CENTER_TAU_MS;
  return {
    ...next,
    at: now,
    current: {
      zoom: ease(base.current.zoom, next.target.zoom, dt, zoomTau),
      u: ease(base.current.u, next.target.u, dt, centerTau),
      v: ease(base.current.v, next.target.v, dt, centerTau),
    },
  };
}

/** Maps landmarks to viewport px for the current shot: X = (1 - x) * sx + tx, Y = y * sy + ty. */
export function projectionFor(state: FramingState): Projection {
  const { zoom: k, u, v } = state.current;
  return { sx: k * state.aspect, sy: k, tx: state.viewport.width / 2 - u * k, ty: state.viewport.height / 2 - v * k };
}

/** Current zoom relative to the full camera frame (1 = whole frame), for the debug overlay. */
export function zoomRatio(state: FramingState): number {
  return state.current.zoom / fitZoom(state.viewport, state.aspect);
}

/** On-screen height of the figure (the envelope without its padding) in viewport px, or null before lock-on. */
export function figureHeightPx(state: FramingState): number | null {
  if (!state.envelope) return null;
  return ((state.envelope.bottom - state.envelope.top) / PAD_HEIGHT) * state.current.zoom;
}
