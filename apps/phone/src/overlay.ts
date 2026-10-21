import { KEYPOINT_COUNT, type Landmark } from '@couch-coach/protocol';

/** Body bones (MediaPipe indices). The face is skipped; the overlay is deliberately faint. */
const BONES: readonly (readonly [number, number])[] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32],
];
const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32];
const MIN_VISIBILITY = 0.5;
const BONE_WIDTH = 6;
const JOINT_RADIUS = 6;

export interface SkeletonOverlay {
  /** Draw the pose (or clear when null). Coordinates are normalized to the canvas. */
  draw(pose: readonly Landmark[] | null): void;
  clear(): void;
}

/** Skeleton canvas. The parent is mirrored with CSS, so we draw in raw camera coordinates. */
export function createOverlay(canvas: HTMLCanvasElement): SkeletonOverlay {
  const ctx = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const boneColor = style.getPropertyValue('--cc-accent-soft').trim() || '#D9CCFF';
  const jointColor = style.getPropertyValue('--cc-text').trim() || '#FFF4E8';

  const syncSize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  const clear = () => ctx?.clearRect(0, 0, canvas.width, canvas.height);

  return {
    clear,
    draw(pose) {
      if (!ctx) return;
      syncSize();
      clear();
      if (!pose || pose.length < KEYPOINT_COUNT) return;
      const scale = canvas.width / Math.max(canvas.clientWidth, 1);
      const visible = (i: number) => (pose[i]?.visibility ?? 0) >= MIN_VISIBILITY;
      ctx.lineCap = 'round';
      ctx.lineWidth = BONE_WIDTH * scale;
      ctx.strokeStyle = boneColor;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (const [a, b] of BONES) {
        if (!visible(a) || !visible(b)) continue;
        ctx.moveTo(pose[a]!.x * canvas.width, pose[a]!.y * canvas.height);
        ctx.lineTo(pose[b]!.x * canvas.width, pose[b]!.y * canvas.height);
      }
      ctx.stroke();
      ctx.fillStyle = jointColor;
      for (const i of JOINTS) {
        if (!visible(i)) continue;
        ctx.beginPath();
        ctx.arc(pose[i]!.x * canvas.width, pose[i]!.y * canvas.height, JOINT_RADIUS * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}
