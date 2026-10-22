/**
 * timeline.ndjson: one line per Phone Event / Coach message seen by session-timeline.ts, stamped with the Mac
 * clock when it arrived: { macT, channel: 'events' | 'coach' | 'meta', event, data }.
 * Signed audio URLs never land on disk: a cue keeps only its S3 key (audio/<sessionId>/<call>.mp3).
 */
import { median } from './phonesync.mjs';

/** Signed S3 URL -> "audio/<sessionId>/<n>.mp3" (virtual-host or path style), or null. */
export function audioKeyOf(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const at = path.indexOf('/audio/');
    return at >= 0 ? path.slice(at + 1) : null;
  } catch {
    return null;
  }
}

/** "audio/<sid>/12.mp3" -> 12 (the coach call number in the "coach call accepted" log line). */
export function callOfAudioKey(key) {
  const m = /\/(\d+)\.mp3$/.exec(String(key ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * @param {number} macT
 * @param {string} channel
 * @param {Record<string, unknown> & { type?: string }} payload
 */
export function timelineRecord(macT, channel, payload) {
  const { audioUrl, ...rest } = payload;
  const data = typeof audioUrl === 'string' ? { ...rest, audioKey: audioKeyOf(audioUrl) } : rest;
  return { macT, channel, event: String(payload.type ?? 'unknown'), data };
}

/** @param {string} text */
export function parseTimeline(text) {
  const records = [];
  let bad = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r.macT === 'number' && typeof r.event === 'string') records.push(r);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { records, bad };
}

/** set_start (counted in order) paired with the next set_end; `startPhone`/`endPhone` are phone-clock ms. */
export function setWindows(records) {
  const sets = [];
  for (const r of records) {
    if (r.event === 'set_start') {
      sets.push({
        setIndex: sets.length + 1,
        exercise: r.data.exercise ?? null,
        startMac: r.macT,
        startPhone: r.data.t ?? null,
        endMac: null,
        endPhone: null,
      });
    } else if (r.event === 'set_end') {
      const open = sets.findLast((s) => s.endMac === null);
      if (open) Object.assign(open, { endMac: r.macT, endPhone: r.data.t ?? null });
    }
  }
  return sets;
}

/** Cues with their call number, the downloaded mp3 (cue_audio record) and when "thinking" arrived. */
export function cuesOf(records) {
  const files = new Map(records.filter((r) => r.event === 'cue_audio').map((r) => [r.data.setIndex, r.data.file]));
  const thinking = new Map(records.filter((r) => r.event === 'thinking').map((r) => [r.data.setIndex, r.macT]));
  return records
    .filter((r) => r.event === 'cue')
    .map((r) => ({
      setIndex: r.data.setIndex,
      macT: r.macT,
      text: r.data.text,
      audioKey: r.data.audioKey ?? null,
      call: callOfAudioKey(r.data.audioKey),
      file: files.get(r.data.setIndex) ?? null,
      thinkingMac: thinking.get(r.data.setIndex) ?? null,
    }));
}

/** Median Mac receive time minus phone send time over `rep` events (phone vs Mac clock check). */
export function repDelayMedianMs(records) {
  const d = records.filter((r) => r.event === 'rep' && typeof r.data.t === 'number').map((r) => r.macT - r.data.t);
  return median(d);
}
