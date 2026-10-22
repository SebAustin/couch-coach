/**
 * Phone-master timing: the iOS recording's creation date gives the start to about 1 s; screen changes found near
 * each set_start / set_end tap (phone clock) refine it. Pure helpers; sync.mjs runs ffmpeg.
 */

/** ffmpeg `select='gte(scene,0)',metadata=print:file=-` output -> [{ t, score }]; `offsetS` shifts a window back. */
export function parseSceneScores(text, offsetS = 0) {
  const out = [];
  let t = null;
  for (const line of String(text).split('\n')) {
    const time = /pts_time:([-\d.]+)/.exec(line);
    if (time) t = Number(time[1]) + offsetS;
    const score = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (score && t !== null) {
      out.push({ t, score: Number(score[1]) });
      t = null;
    }
  }
  return out;
}

/** The biggest screen change within ±windowS of predictedS, or null when none reaches minScore. */
export function pickChange(scores, predictedS, windowS, minScore) {
  let best = null;
  for (const s of scores) {
    if (Math.abs(s.t - predictedS) > windowS || s.score < minScore) continue;
    if (!best || s.score > best.score) best = s;
  }
  return best;
}

/** Drops scores within tolS of any cut time (e.g. the TV master's chunk boundaries, which are not UI changes). */
export function dropNear(scores, times, tolS) {
  return scores.filter((s) => !times.some((t) => Math.abs(s.t - t) <= tolS));
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * pairs: [{ predictedS, detectedS }] in video seconds. A change seen later than predicted means the recording
 * started earlier than the creation date says, so the start moves back by the median delay.
 */
export function refineStart(creationMac, pairs) {
  const deltas = pairs.map((p) => p.detectedS - p.predictedS);
  const d = median(deltas) ?? 0;
  const refineMs = Math.round(-d * 1000) || 0; // no -0
  return { startMac: creationMac + refineMs, refineMs, samples: pairs.length, deltasS: deltas };
}

/** ffprobe format tags -> ms. The QuickTime tag ("...T12:01:02-0500") is the local capture start on iOS. */
export function parseCreationTime(tags = {}) {
  const apple = tags['com.apple.quicktime.creationdate'];
  if (apple) {
    const iso = String(apple).replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
    const ms = Date.parse(iso);
    if (Number.isFinite(ms)) return ms;
  }
  if (tags.creation_time) {
    const ms = Date.parse(tags.creation_time);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}
