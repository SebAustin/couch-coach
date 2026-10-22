import React, { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Animated, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import {
  figureHeightPx,
  initialFraming,
  poseBounds,
  projectionFor,
  stepFraming,
  zoomRatio,
  type FramingState,
} from '../../lib/autoFrame';
import type { FrameBuffer } from '../../lib/frameBuffer';
import { cleanPulseOpacity, faultOpacity, highlightFor } from '../../lib/faultHighlight';
import {
  allLowVisibility,
  buildSkeletonPaths,
  DEFAULT_SIZES,
  NO_EMPHASIS,
  skeletonSizes,
  stableFigurePx,
  strokeWidths,
  visibilityHysteresis,
  type Emphasis,
  type SkeletonPaths,
  type SkeletonSizes,
  type StrokedLayer,
} from '../../lib/skeletonPaths';
import type { Landmark } from '../../vendor/protocol';
import { color, s } from '../../theme';

export interface FaultFlash {
  /** Increments per Rep so a repeat of the same Fault restarts the flash. */
  seq: number;
  ids: readonly string[];
}

/** The last Rep had no Faults: pulse the legs mint once. `seq` increments per Rep. */
export interface CleanFlash {
  seq: number;
}

export interface RenderStats {
  /** Frames drawn since mount (read once a second by the debug overlay). */
  renders: number;
  /** Time spent in drawing ticks (ms): running sum, and the max since the debug overlay last reset it. */
  tickMs: { sum: number; max: number };
  /** Auto-frame zoom relative to the full camera frame (1 = whole frame). */
  zoom: number;
}

export const newRenderStats = (): RenderStats => ({ renders: 0, tickMs: { sum: 0, max: 0 }, zoom: 1 });

interface Props {
  buffer: FrameBuffer;
  /** Skeleton viewport in device px. */
  width: number;
  height: number;
  /** Camera frame width / height (from `hello`). */
  aspect: number;
  fault: FaultFlash | null;
  clean: CleanFlash | null;
  /** Drop to 35% opacity (Set over, or the phone went quiet). */
  dimmed: boolean;
  /** Called when "nobody in frame" starts or ends (all landmarks < 0.5 for 2 s). */
  onNoPoseChange?: (noPose: boolean) => void;
  stats?: React.MutableRefObject<RenderStats>;
}

/** Skip draws closer together than this: ~30 fps on a 60 Hz display, which is plenty for 15 fps input. */
const MIN_FRAME_GAP_MS = 28;
const NO_POSE_AFTER_MS = 2000;
const DIMMED_OPACITY = 0.35;
const DIM_LAYER_OPACITY = 0.25;
const FAULT_HALO_OPACITY = 0.35;
const CLEAN_EMPHASIS: Emphasis = { ...NO_EMPHASIS, clean: true };

type PathHandle = { setNativeProps?: (props: object) => void } | null;
type LayerKey = Exclude<keyof SkeletonPaths, 'headVisible'>;
const LAYERS: readonly LayerKey[] = [
  'faultHalo',
  'bonesDim',
  'bones',
  'faultBones',
  'cleanPulse',
  'faultJointRing',
  'jointsDim',
  'joints',
  'head',
];
const STROKED: readonly StrokedLayer[] = ['faultHalo', 'bonesDim', 'bones', 'faultBones', 'cleanPulse'];

/** What the loop last wrote into the native views. null / -1 never match a real value, so they force a rewrite. */
interface Written {
  paths: SkeletonPaths | null;
  bone: number;
  head: number;
  flash: number;
  pulse: number;
}
const unwritten = (): Written => ({ paths: null, bone: -1, head: -1, flash: -1, pulse: -1 });

const toDevice = (sizes: SkeletonSizes): SkeletonSizes => ({
  bone: s(sizes.bone),
  joint: s(sizes.joint),
  bigJoint: s(sizes.bigJoint),
  head: s(sizes.head),
  outline: s(sizes.outline),
});
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Live skeleton, auto-framed. Drawn imperatively: a requestAnimationFrame loop samples the jitter buffer, steps the
 * framing and writes path data straight into the SVG elements via `setNativeProps`, so React never re-renders per
 * frame. Each tick: sampleFrame -> poseBounds -> stepFraming -> projectionFor -> skeletonSizes -> buildSkeletonPaths.
 */
function SkeletonStageView({ buffer, width, height, aspect, fault, clean, dimmed, onNoPoseChange, stats }: Props) {
  const reduceMotion = useReducedMotion();
  const handles = useRef<Record<string, PathHandle>>({});
  const written = useRef<Written>(unwritten());
  const framing = useRef<FramingState>(initialFraming({ width, height }, aspect));
  const visible = useRef<boolean[] | null>(null);
  const figure = useRef<number | null>(null);
  const faultAt = useRef(0);
  const faultRef = useRef<FaultFlash | null>(fault);
  const cleanAt = useRef(0);
  const cleanRef = useRef<CleanFlash | null>(clean);
  const noPose = useRef({ since: 0, flagged: false });
  const dim = useRef(new Animated.Value(dimmed ? DIMMED_OPACITY : 1)).current;
  const highlight = useMemo(() => highlightFor(fault?.ids ?? []), [fault]);
  const highlightRef = useRef(highlight);

  // A React commit may re-apply the JSX props (empty d, opacity 0, default widths) over what setNativeProps wrote
  // (unverified on Fabric): forget what was written after every render so the next tick rewrites everything.
  useLayoutEffect(() => {
    written.current = unwritten();
  });

  // Rep events arrive in real time but the skeleton is drawn a playout delay late: start the flashes then, so rose
  // and mint land on the drawn Rep rather than before it.
  useEffect(() => {
    faultRef.current = fault;
    highlightRef.current = highlight;
    faultAt.current = fault ? Date.now() + buffer.playoutDelayMs() : 0;
  }, [fault, highlight, buffer]);

  useEffect(() => {
    cleanRef.current = clean;
    cleanAt.current = clean ? Date.now() + buffer.playoutDelayMs() : 0;
  }, [clean, buffer]);

  useEffect(() => {
    Animated.timing(dim, { toValue: dimmed ? DIMMED_OPACITY : 1, duration: reduceMotion ? 0 : 320, useNativeDriver: true }).start();
  }, [dimmed, dim, reduceMotion]);

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const ctx = { viewport: { width, height }, aspect, reduceMotion };
    /** Device px per design px: sizes are chosen in design px, drawn in device px. */
    const unit = s(1000) / 1000;
    // Sizes are recomputed only when the (hysteresis-held) figure height changes.
    let sizedFor: number | null = null;
    let designSizes = DEFAULT_SIZES;
    let deviceSizes = toDevice(DEFAULT_SIZES);
    // react-native-svg's web build expects setNativeProps({ style: props }); native takes the props directly.
    const set = (key: string, props: object) =>
      handles.current[key]?.setNativeProps?.(Platform.OS === 'web' ? { style: props } : props);

    // Sizes move in 2 px steps, so the five bone widths are only rewritten when the step changes.
    const writeWidths = (sizes: SkeletonSizes) => {
      if (sizes.bone === written.current.bone) return;
      written.current.bone = sizes.bone;
      const widths = strokeWidths(sizes);
      STROKED.forEach((key) => set(key, { strokeWidth: s(widths[key]) }));
    };

    const writePaths = (next: SkeletonPaths) => {
      const w = written.current;
      LAYERS.forEach((key) => {
        if (!w.paths || next[key] !== w.paths[key]) set(key, { d: next[key] });
      });
      w.paths = next;
      const head = next.headVisible ? 1 : DIM_LAYER_OPACITY;
      if (head !== w.head) {
        w.head = head;
        set('head', { opacity: head });
      }
    };

    // The flash layers only change while a flash runs (about 1.6 s per faulty Rep, 0.8 s per clean one).
    const writeFlashes = (flash: number, pulse: number) => {
      const w = written.current;
      if (flash !== w.flash) {
        w.flash = flash;
        set('faultHalo', { opacity: FAULT_HALO_OPACITY * flash });
        set('faultBones', { opacity: flash });
        set('faultJointRing', { opacity: flash });
      }
      if (pulse !== w.pulse) {
        w.pulse = pulse;
        set('cleanPulse', { opacity: pulse });
      }
    };

    // "We can't see you": every landmark below 0.5 for 2 s.
    const trackNoPose = (pose: readonly Landmark[], now: number) => {
      const state = noPose.current;
      if (!allLowVisibility(pose)) {
        state.since = 0;
        if (state.flagged) {
          state.flagged = false;
          onNoPoseChange?.(false);
        }
        return;
      }
      if (state.since === 0) state.since = now;
      if (!state.flagged && now - state.since >= NO_POSE_AFTER_MS) {
        state.flagged = true;
        onNoPoseChange?.(true);
      }
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = Date.now();
      if (now - last < MIN_FRAME_GAP_MS) return;
      last = now;
      const started = clock();

      const sampled = reduceMotion ? buffer.latestFrame() : buffer.sampleFrame(now);
      if (!sampled) return;
      const { pose } = sampled;
      visible.current = visibilityHysteresis(visible.current, pose);
      framing.current = stepFraming(framing.current, poseBounds(pose, aspect), now, ctx);
      figure.current = stableFigurePx(figure.current, figureHeightPx(framing.current));
      if (figure.current !== sizedFor) {
        sizedFor = figure.current;
        designSizes = sizedFor === null ? DEFAULT_SIZES : skeletonSizes(sizedFor / unit);
        deviceSizes = toDevice(designSizes);
      }
      writeWidths(designSizes);

      const flash = faultRef.current ? faultOpacity(now - faultAt.current) : 0;
      const pulse = cleanRef.current ? cleanPulseOpacity(now - cleanAt.current) : 0;
      const emphasis = flash > 0 ? highlightRef.current : pulse > 0 ? CLEAN_EMPHASIS : NO_EMPHASIS;
      writePaths(buildSkeletonPaths(pose, projectionFor(framing.current), emphasis, deviceSizes, visible.current));
      writeFlashes(flash, pulse);
      trackNoPose(pose, now);

      if (stats) {
        const tickMs = clock() - started;
        const st = stats.current;
        st.renders += 1;
        st.tickMs.sum += tickMs;
        st.tickMs.max = Math.max(st.tickMs.max, tickMs);
        st.zoom = zoomRatio(framing.current);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [buffer, width, height, aspect, reduceMotion, onNoPoseChange, stats]);

  const bind = (key: string) => (ref: unknown) => {
    handles.current[key] = ref as PathHandle;
  };
  const box: ViewStyle = { width, height };
  const widths = strokeWidths(DEFAULT_SIZES);
  const bone = { strokeLinecap: 'round' as const, fill: 'none' };
  const joint = { fill: color.text, stroke: color.stage, strokeWidth: s(DEFAULT_SIZES.outline) };

  return (
    <View style={box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: dim }]}>
        <Svg width={width} height={height}>
          <Path ref={bind('faultHalo')} d="" stroke={color.scorePoor} strokeWidth={s(widths.faultHalo)} {...bone} opacity={0} />
          <Path ref={bind('bonesDim')} d="" stroke={color.accentSoft} strokeWidth={s(widths.bonesDim)} {...bone} opacity={DIM_LAYER_OPACITY} />
          <Path ref={bind('bones')} d="" stroke={color.accentSoft} strokeWidth={s(widths.bones)} {...bone} />
          <Path ref={bind('faultBones')} d="" stroke={color.scorePoor} strokeWidth={s(widths.faultBones)} {...bone} opacity={0} />
          {/* Mint is reserved for Form Score; here it means the same thing: that Rep had good form. */}
          <Path ref={bind('cleanPulse')} d="" stroke={color.scoreGood} strokeWidth={s(widths.cleanPulse)} {...bone} opacity={0} />
          <Path ref={bind('faultJointRing')} d="" fill={color.scorePoor} opacity={0} />
          <Path ref={bind('jointsDim')} d="" {...joint} opacity={DIM_LAYER_OPACITY} />
          <Path ref={bind('joints')} d="" {...joint} />
          <Path ref={bind('head')} d="" fill={color.accentSoft} />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** Memoised: LiveScreen re-renders twice a second, and every render of this component forces a full native rewrite. */
export const SkeletonStage = memo(SkeletonStageView);
