/**
 * TV clock math for the demo recorder: nanosecond stamps from ccrec.sh, the Mac-vs-TV clock offset and the
 * chunk index the on-TV loop writes. Pure functions; tv-record.mjs and sync.mjs do the I/O.
 */

/** "1729512345123456789" (ns since the epoch) -> ms with microsecond precision. Too big for a double as ns. */
export function nsToMs(ns) {
  const s = String(ns).trim();
  if (!/^\d{16,20}$/.test(s)) throw new Error(`not a nanosecond stamp: ${JSON.stringify(s)}`);
  return Number(s.slice(0, -6)) + Number(s.slice(-6)) / 1e6;
}

/**
 * Picks the sample with the fastest round trip and returns TV time minus the midpoint of the Mac's before/after
 * times. `samples`: [{ macBefore, macAfter, tvMs }] (all ms since the epoch).
 */
export function bestOffset(samples) {
  if (!samples.length) throw new Error('no clock samples');
  const best = samples.reduce((a, b) => (b.macAfter - b.macBefore < a.macAfter - a.macBefore ? b : a));
  const macMid = (best.macBefore + best.macAfter) / 2;
  return {
    offsetMs: best.tvMs - macMid,
    rttMs: best.macAfter - best.macBefore,
    tvMs: best.tvMs,
    macMid,
    n: samples.length,
  };
}

/**
 * TV ms -> Mac ms. With both the start and stop measurement the offset is interpolated linearly in TV time
 * (clock drift over a 15-minute run); with only one it is constant.
 */
export function makeTvToMac({ start, stop }) {
  if (!start) throw new Error('no start clock measurement');
  if (!stop || stop.tvMs === start.tvMs) return (tvMs) => tvMs - start.offsetMs;
  const slope = (stop.offsetMs - start.offsetMs) / (stop.tvMs - start.tvMs);
  return (tvMs) => tvMs - (start.offsetMs + slope * (tvMs - start.tvMs));
}

/**
 * Parses ccrec.sh's index.txt:
 *   "clock <date|epochrealtime|seconds>", "pid <n>", "NN <ns> start", "NN <ns> end <exit>", "done <ns>", "abort ..."
 */
export function parseIndex(text) {
  const chunks = new Map();
  let method = null;
  let doneTvMs = null;
  const notes = [];
  for (const line of String(text).split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0]) continue;
    if (parts[0] === 'clock') method = parts[1] ?? null;
    else if (parts[0] === 'done') doneTvMs = nsToMs(parts[1]);
    else if (/^\d+$/.test(parts[0]) && parts[2] === 'start') {
      chunks.set(parts[0], { name: parts[0], startTvMs: nsToMs(parts[1]), endTvMs: null, exit: null });
    } else if (/^\d+$/.test(parts[0]) && parts[2] === 'end' && chunks.has(parts[0])) {
      const c = chunks.get(parts[0]);
      chunks.set(parts[0], { ...c, endTvMs: nsToMs(parts[1]), exit: Number(parts[3] ?? NaN) });
    } else if (parts[0] !== 'pid') notes.push(line.trim());
  }
  return { method, chunks: [...chunks.values()], doneTvMs, notes };
}

const UNIT_KB = { K: 1, M: 1024, G: 1024 * 1024, T: 1024 * 1024 * 1024 };

/** Free space from `df /sdcard`, in KB: toybox "1K-blocks ... Available" or the older "Size Used Free" with units. */
export function parseDfAvailableKb(text) {
  const lines = String(text).trim().split('\n').filter(Boolean);
  if (lines.length < 2) throw new Error(`unexpected df output: ${text}`);
  const header = lines[0].trim().split(/\s+/);
  const row = lines.at(-1).trim().split(/\s+/);
  const col = header.findIndex((h) => h === 'Available' || h === 'Free' || h === 'Avail');
  if (col < 0) throw new Error(`no free-space column in df header: ${lines[0]}`);
  const cell = row[col] ?? '';
  const m = /^([\d.]+)([KMGT])?$/.exec(cell);
  if (!m) throw new Error(`unexpected df value: ${cell}`);
  return m[2] ? Math.round(Number(m[1]) * UNIT_KB[m[2]]) : Number(m[1]);
}
