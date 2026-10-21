import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { FrameBuffer } from '../../lib/frameBuffer';
import { faultOpacity, highlightFor } from '../../lib/faultHighlight';
import { allLowVisibility, buildSkeletonPaths, EMPTY_PATHS, type SkeletonPaths } from '../../lib/skeletonPaths';
import { color, s } from '../../theme';

export interface FaultFlash {
  /** Increments per Rep so a repeat of the same Fault restarts the flash. */
  seq: number;
  ids: readonly string[];
}

export interface RenderStats {
  /** Frames drawn since mount (read once a second by the debug overlay). */
  renders: number;
}

interface Props {
  buffer: FrameBuffer;
  width: number;
  height: number;
  fault: FaultFlash | null;
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
const BRACKET = 24;

type PathHandle = { setNativeProps?: (props: object) => void } | null;
type LayerKey = Exclude<keyof SkeletonPaths, 'headVisible'>;

/**
 * Live skeleton. Drawn imperatively: a requestAnimationFrame loop samples the jitter buffer and writes
 * path data straight into the SVG elements via `setNativeProps`, so React never re-renders per frame.
 */
export function SkeletonStage({ buffer, width, height, fault, dimmed, onNoPoseChange, stats }: Props) {
  const reduceMotion = useReducedMotion();
  const handles = useRef<Record<string, PathHandle>>({});
  const lastPaths = useRef<SkeletonPaths>(EMPTY_PATHS);
  const faultAt = useRef(0);
  const faultRef = useRef<FaultFlash | null>(fault);
  const noPose = useRef({ since: 0, flagged: false });
  const dim = useRef(new Animated.Value(dimmed ? DIMMED_OPACITY : 1)).current;
  const highlight = useMemo(() => highlightFor(fault?.ids ?? []), [fault]);
  const highlightRef = useRef(highlight);

  useEffect(() => {
    faultRef.current = fault;
    highlightRef.current = highlight;
    faultAt.current = fault ? Date.now() : 0;
  }, [fault, highlight]);

  useEffect(() => {
    Animated.timing(dim, { toValue: dimmed ? DIMMED_OPACITY : 1, duration: reduceMotion ? 0 : 320, useNativeDriver: true }).start();
  }, [dimmed, dim, reduceMotion]);

  useEffect(() => {
    let frame = 0;
    let last = 0;
    let lastFlash = -1; // never equal to a real opacity, so the first frame writes all three fault layers
    // react-native-svg's web build expects setNativeProps({ style: props }); native takes the props directly.
    const set = (key: string, props: object) =>
      handles.current[key]?.setNativeProps?.(Platform.OS === 'web' ? { style: props } : props);

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = Date.now();
      if (now - last < MIN_FRAME_GAP_MS) return;
      last = now;

      const pose = reduceMotion ? buffer.latest() : buffer.sample(now);
      if (!pose) return;
      if (stats) stats.current.renders += 1;

      const flash = faultRef.current ? faultOpacity(now - faultAt.current) : 0;
      const sel = flash > 0 ? highlightRef.current : { bones: [], joints: [] };
      const next = buildSkeletonPaths(pose, { width, height }, sel, s(36));
      const prev = lastPaths.current;
      (Object.keys(next) as (keyof SkeletonPaths)[]).forEach((key) => {
        if (key === 'headVisible') return;
        if (next[key as LayerKey] !== prev[key as LayerKey]) set(key, { d: next[key as LayerKey] });
      });
      if (next.headVisible !== prev.headVisible) set('head', { opacity: next.headVisible ? 1 : 0.25 });
      lastPaths.current = next;
      // The fault layers only change while a Fault is flashing (about 1.6 s per Rep): skip three native prop
      // writes per frame the rest of the time.
      if (flash !== lastFlash) {
        lastFlash = flash;
        set('faultHalo', { opacity: 0.35 * flash });
        set('faultBones', { opacity: flash });
        set('faultJointRing', { opacity: flash });
      }

      // "We can't see you": every landmark below 0.5 for 2 s.
      const lost = allLowVisibility(pose);
      const state = noPose.current;
      if (!lost) {
        state.since = 0;
        if (state.flagged) {
          state.flagged = false;
          onNoPoseChange?.(false);
        }
      } else {
        if (state.since === 0) state.since = now;
        if (!state.flagged && now - state.since >= NO_POSE_AFTER_MS) {
          state.flagged = true;
          onNoPoseChange?.(true);
        }
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [buffer, width, height, reduceMotion, onNoPoseChange, stats]);

  const bind = (key: string) => (ref: unknown) => {
    handles.current[key] = ref as PathHandle;
  };
  const box: ViewStyle = { width, height };
  const corner = s(BRACKET);
  const bracket = { position: 'absolute' as const, width: corner, height: corner, borderColor: color.textMuted };
  const bw = s(3);

  return (
    <View style={box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: dim }]}>
        <Svg width={width} height={height}>
          <Path ref={bind('faultHalo')} d="" stroke={color.scorePoor} strokeWidth={s(36)} strokeLinecap="round" fill="none" opacity={0} />
          <Path ref={bind('bonesDim')} d="" stroke={color.accentSoft} strokeWidth={s(14)} strokeLinecap="round" fill="none" opacity={0.25} />
          <Path ref={bind('bones')} d="" stroke={color.accentSoft} strokeWidth={s(14)} strokeLinecap="round" fill="none" />
          <Path ref={bind('faultBones')} d="" stroke={color.scorePoor} strokeWidth={s(20)} strokeLinecap="round" fill="none" opacity={0} />
          <Path ref={bind('faultJointRing')} d="" stroke={color.scorePoor} strokeWidth={s(50)} strokeLinecap="round" fill="none" opacity={0} />
          <Path ref={bind('jointOutline')} d="" stroke={color.stage} strokeWidth={s(38)} strokeLinecap="round" fill="none" />
          <Path ref={bind('jointsDim')} d="" stroke={color.text} strokeWidth={s(30)} strokeLinecap="round" fill="none" opacity={0.25} />
          <Path ref={bind('joints')} d="" stroke={color.text} strokeWidth={s(30)} strokeLinecap="round" fill="none" />
          <Path ref={bind('head')} d="" stroke={color.accentSoft} strokeWidth={s(8)} fill="none" />
        </Svg>
      </Animated.View>
      {/* Camera-frame corner brackets */}
      <View style={[bracket, { top: 0, left: 0, borderTopWidth: bw, borderLeftWidth: bw }]} />
      <View style={[bracket, { top: 0, right: 0, borderTopWidth: bw, borderRightWidth: bw }]} />
      <View style={[bracket, { bottom: 0, left: 0, borderBottomWidth: bw, borderLeftWidth: bw }]} />
      <View style={[bracket, { bottom: 0, right: 0, borderBottomWidth: bw, borderRightWidth: bw }]} />
    </View>
  );
}
