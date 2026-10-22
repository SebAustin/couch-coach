/**
 * Plans the TV master: screenrecord chunks laid on one constant-fps grid in Mac time. Each chunk's slot runs
 * until the next chunk starts; a gap (~0.2 s at each chunk change) is filled by holding the last frame, an
 * overlap trims the tail. Frame positions are computed from absolute start times, so rounding never drifts.
 */

/**
 * @param {{ name: string, file: string, startTvMs: number, durationS: number }[]} chunks
 * @param {{ tvToMac: (tvMs: number) => number, startDelayMs: number, fps: number }} opts
 */
export function planTvMaster(chunks, { tvToMac, startDelayMs, fps }) {
  if (!chunks.length) throw new Error('no TV chunks to plan');
  const sorted = [...chunks].sort((a, b) => a.startTvMs - b.startTvMs);
  const macStarts = sorted.map((c) => tvToMac(c.startTvMs + startDelayMs));
  const startMac = macStarts[0];
  const startFrames = macStarts.map((m) => Math.round(((m - startMac) * fps) / 1000));

  const segments = sorted.map((c, i) => {
    const ownFrames = Math.round(c.durationS * fps);
    const frames = i + 1 < sorted.length ? startFrames[i + 1] - startFrames[i] : ownFrames;
    const contentFrames = Math.min(ownFrames, frames);
    return {
      name: c.name,
      file: c.file,
      macStart: startMac + (startFrames[i] * 1000) / fps,
      startFrame: startFrames[i],
      frames,
      contentFrames,
      holdFrames: frames - contentFrames,
      trimmedFrames: ownFrames - contentFrames,
    };
  });

  const gaps = segments
    .filter((s) => s.holdFrames > 0)
    .map((s) => ({
      afterChunk: s.name,
      atMac: s.macStart + (s.contentFrames * 1000) / fps,
      durationS: s.holdFrames / fps,
    }));
  const totalFrames = segments.reduce((n, s) => n + s.frames, 0);
  return { startMac, fps, segments, gaps, totalFrames, durationS: totalFrames / fps };
}
