/**
 * Try cameras in order and stop at the first that opens. Used by "Flip camera": [new, previous], so a
 * failed flip restores the camera that worked. On total failure the last result is returned.
 */
export async function openWithFallback<F, R extends { ok: boolean }>(
  facings: readonly F[],
  open: (facing: F) => Promise<R>,
): Promise<
  { ok: true; facing: F; result: Extract<R, { ok: true }>; usedFallback: boolean } | { ok: false; result: Extract<R, { ok: false }> }
> {
  let last: R | undefined;
  for (const [index, facing] of facings.entries()) {
    last = await open(facing);
    if (last.ok) return { ok: true, facing, result: last as Extract<R, { ok: true }>, usedFallback: index > 0 };
  }
  return { ok: false, result: last as Extract<R, { ok: false }> };
}
