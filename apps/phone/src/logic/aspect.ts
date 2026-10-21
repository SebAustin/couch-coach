/** Portrait phone frame, used when the camera never reports a size. */
export const FALLBACK_ASPECT = 9 / 16;

const aspectOf = ({ width, height }: { width: number; height: number }): number | null =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : null;

/**
 * Camera frame aspect (width / height). If the size is not known yet, wait once and read it again;
 * if it still is not, fall back to 9/16 explicitly so no NaN ever reaches the TV or the counter.
 */
export async function resolveAspect(
  read: () => { width: number; height: number },
  waitForSize: () => Promise<unknown>,
): Promise<number> {
  const first = aspectOf(read());
  if (first !== null) return first;
  await waitForSize();
  return aspectOf(read()) ?? FALLBACK_ASPECT;
}
