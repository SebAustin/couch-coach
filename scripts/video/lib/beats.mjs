/**
 * beats.json -> exact cut points. A beat is { id, layout: 'split' | 'tv', in, out, cue?, narrationS?,
 * narrationAfterCue?, holdStartS? }, where in/out are anchors in Mac time:
 *   - epoch ms (number) or an ISO date string,
 *   - "<event>#<n>[+-seconds]" on the session timeline: set_start#2-1.5 (n-th set_start), set_end#1, cue#2,
 *     thinking#2 (by setIndex), hello#1 (n-th hello),
 *   - "tv:<seconds>" / "phone:<seconds>" into the TV / phone master (read off the contact sheets).
 * Cuts are snapped to the TV master's frame grid and clamped to the footage that exists.
 * holdStartS (0-5 s) shows the first frame (both devices) that long before the footage plays, e.g. so a line
 * lands on a static page before an alert covers it; the clip is that much longer and cue times shift with it.
 */
import { cuesOf } from './timeline.mjs';

export const CUE_LEAD_S = 0.4; // narration must end at least this long before a Cue starts
export const MAX_HOLD_START_S = 5;

const ORDINAL_EVENTS = new Set(['set_start', 'hello']);
const INDEXED_EVENTS = new Set(['set_end', 'cue', 'thinking']);

/** @returns {number} Mac ms */
export function resolveAnchor(spec, ctx) {
  if (typeof spec === 'number') return spec;
  const s = String(spec).trim();
  const master = /^(tv|phone):([-\d.]+)$/.exec(s);
  if (master) {
    const src = ctx[master[1]];
    if (!src) throw new Error(`anchor ${s}: no ${master[1]} master in sync.json`);
    return src.startMac + Number(master[2]) * 1000;
  }
  const ev = /^([a-z_]+)#(\d+)([+-][\d.]+)?$/.exec(s);
  if (ev) {
    const [, event, nStr, shift] = ev;
    const n = Number(nStr);
    let hit;
    if (ORDINAL_EVENTS.has(event)) hit = ctx.records.filter((r) => r.event === event)[n - 1];
    else if (INDEXED_EVENTS.has(event)) hit = ctx.records.find((r) => r.event === event && r.data?.setIndex === n);
    else throw new Error(`unknown anchor event "${event}" in ${s}`);
    if (!hit) throw new Error(`no ${event}#${n} in the timeline`);
    return hit.macT + Number(shift ?? 0) * 1000;
  }
  const iso = Date.parse(s);
  if (Number.isFinite(iso) && /\d{4}-\d\d-\d\d/.test(s)) return iso;
  throw new Error(`unknown anchor: ${s}`);
}

const fmt = (s) => s.toFixed(2);

/** Resolves one beat to cut points and seeks, with human-readable warnings for anything adjusted. */
export function resolveBeat(beat, ctx) {
  if (beat.layout !== 'split' && beat.layout !== 'tv') throw new Error(`beat ${beat.id}: unknown layout "${beat.layout}"`);
  const { fps, tv, phone } = ctx;
  const frameMs = 1000 / fps;
  const warnings = [];
  const holdStartS = beat.holdStartS ?? 0;
  if (!(typeof holdStartS === 'number' && holdStartS >= 0 && holdStartS <= MAX_HOLD_START_S)) {
    throw new Error(`beat ${beat.id}: holdStartS must be 0-${MAX_HOLD_START_S} seconds`);
  }
  const holdFrames = Math.round(holdStartS * fps);
  let inMac = resolveAnchor(beat.in, ctx);
  let outMac = resolveAnchor(beat.out, ctx);
  const cues = cuesOf(ctx.records);

  if (beat.cue !== undefined && beat.narrationS !== undefined && !beat.narrationAfterCue) {
    const cue = cues.find((c) => c.setIndex === beat.cue);
    if (!cue) throw new Error(`beat ${beat.id}: no cue#${beat.cue} in the timeline`);
    const latestIn = cue.macT - ((beat.narrationAtS ?? 0) + beat.narrationS + CUE_LEAD_S - holdFrames / fps) * 1000;
    if (inMac > latestIn) {
      warnings.push(`in moved ${fmt((inMac - latestIn) / 1000)} s earlier so the narration ends ${CUE_LEAD_S} s before Cue ${beat.cue}`);
      inMac = latestIn;
    }
  }

  const sources = beat.layout === 'split' ? [tv, phone] : [tv];
  if (sources.some((s) => !s)) throw new Error(`beat ${beat.id}: ${beat.layout} layout needs ${beat.layout === 'split' ? 'TV and phone masters' : 'a TV master'}`);
  const lo = Math.max(...sources.map((s) => s.startMac));
  const hi = Math.min(...sources.map((s) => s.startMac + s.durationS * 1000));
  if (inMac < lo) {
    warnings.push(`in clamped ${fmt((lo - inMac) / 1000)} s later to the start of the footage`);
    inMac = lo;
  }
  if (outMac > hi) {
    warnings.push(`out clamped ${fmt((outMac - hi) / 1000)} s earlier to the end of the footage`);
    outMac = hi;
  }

  let tvSeekFrames = Math.round((inMac - tv.startMac) / frameMs);
  if (tv.startMac + tvSeekFrames * frameMs < lo - 1e-6) tvSeekFrames += 1;
  const snappedIn = tv.startMac + tvSeekFrames * frameMs;
  const frames = Math.round((outMac - snappedIn) / frameMs);
  if (frames <= 0) throw new Error(`beat ${beat.id}: empty (out is not after in)`);
  const snappedOut = snappedIn + frames * frameMs;

  for (const g of tv.gaps ?? []) {
    if (g.atMac < snappedOut && g.atMac + g.durationS * 1000 > snappedIn) {
      warnings.push(`crosses a TV chunk gap (${fmt(g.durationS)} s held frame) at +${fmt((g.atMac - snappedIn) / 1000)} s`);
    }
  }

  const round3 = (x) => Math.round(x * 1000) / 1000;
  return {
    id: beat.id,
    layout: beat.layout,
    inMac: round3(snappedIn),
    outMac: round3(snappedOut),
    frames,
    holdFrames,
    durationS: round3((frames + holdFrames) / fps),
    tvSeekS: round3(tvSeekFrames / fps),
    phoneSeekS: beat.layout === 'split' ? round3((snappedIn - phone.startMac) / 1000) : null,
    cues: cues
      .filter((c) => c.macT >= snappedIn && c.macT < snappedOut)
      .map((c) => ({ setIndex: c.setIndex, atS: round3((c.macT - snappedIn) / 1000 + holdFrames / fps), file: c.file, text: c.text })),
    warnings,
  };
}
