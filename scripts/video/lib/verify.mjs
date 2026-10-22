/**
 * Pure checks behind verify-video.mjs: forbidden words in the script, loudness summary parsing, the renderer's
 * scene timing (mirror of ultrademo-workspace/scripts/render.mjs + the Demo.tsx patches: lockRate, narrationAt,
 * extraAudio), YouTube chapters and the pairing-token expiry.
 */

// --- forbidden words -----------------------------------------------------------------------------------------
const ULTRADEMO = /ultrademo/i;
const AI_CASED = /\bA\.?I\b/; // "AI" as a word, case-sensitive so "said", "again" and "Aidan" pass
const AI_SPELLED = /artificial intelligence/i;

/**
 * texts: every narration / caption / slide string; signOff: the closing lines (outro). "Ultrademo" is banned
 * everywhere, "AI" in the sign-off.
 */
export function findForbidden({ texts, signOff }) {
  const found = [];
  const excerpt = (text, idx) => text.slice(Math.max(0, idx - 30), idx + 40);
  for (const { where, text } of [...texts, ...signOff]) {
    const m = ULTRADEMO.exec(text ?? '');
    if (m) found.push({ where, term: 'Ultrademo', excerpt: excerpt(text, m.index) });
  }
  for (const { where, text } of signOff) {
    const s = text ?? '';
    const m = AI_CASED.exec(s) ?? AI_SPELLED.exec(s);
    if (m) found.push({ where, term: 'AI', excerpt: excerpt(s, m.index) });
  }
  return found;
}

// --- loudness ------------------------------------------------------------------------------------------------
/** ffmpeg ebur128 stderr -> { integratedLufs, lraLu, peakDbfs } from the Summary block, or null. */
export function parseEbur128(stderr) {
  const at = String(stderr).lastIndexOf('Summary:');
  if (at < 0) return null;
  const s = String(stderr).slice(at);
  const num = (re) => {
    const m = re.exec(s);
    return m ? Number(m[1]) : null;
  };
  return {
    integratedLufs: num(/\bI:\s+([-\d.]+) LUFS/),
    lraLu: num(/\bLRA:\s+([-\d.]+) LU/),
    peakDbfs: num(/Peak:\s+([-\d.inf]+) dBFS/),
  };
}

// --- renderer timing (keep in sync with render.mjs / Demo.tsx) ----------------------------------------------
const FPS = 30;
const HOLD_AFTER_AUDIO = 0.7;
const HOLD_AFTER_CLIP = 0.4;
const SLIDE_SECONDS = 3;
const SLIDE_LEAD_IN = 0.75;
const MAX_RATE = 1.3;

const frames = (s) => Math.round(s * FPS);

function slideSeconds(slide) {
  if (!slide) return 0;
  if (!slide.audioDuration) return SLIDE_SECONDS;
  return Math.max(frames(SLIDE_SECONDS), frames(SLIDE_LEAD_IN + slide.audioDuration + HOLD_AFTER_AUDIO)) / FPS;
}

function clipRate(s) {
  if (s.lockRate) return 1;
  const narration = (s.audioDuration ?? s.durationHint ?? 4) + HOLD_AFTER_AUDIO;
  const clip = s.clipDuration ?? 0;
  if (!clip || clip <= narration) return 1;
  return Math.min(MAX_RATE, clip / narration);
}

function sceneSeconds(s) {
  const narration = (s.narrationAt ?? 0) + (s.audioDuration ?? s.durationHint ?? 4) + HOLD_AFTER_AUDIO;
  const clip = s.clipDuration ? s.clipDuration / clipRate(s) + HOLD_AFTER_CLIP : 0;
  const cueEnd = Math.max(0, ...(s.extraAudio ?? []).map((a) => a.at + (a.duration ?? 0)));
  return Math.max(1, frames(Math.max(narration, clip, cueEnd))) / FPS;
}

/** storyboard.json -> start/duration of the intro, every scene (with its Cue starts) and the outro, in seconds. */
export function sceneTimeline(sb) {
  const intro = { startS: 0, durationS: slideSeconds(sb.intro) };
  let t = intro.durationS;
  const scenes = (sb.scenes ?? []).map((s) => {
    const startS = t;
    const durationS = sceneSeconds(s);
    t += durationS;
    return {
      id: s.id,
      startS,
      durationS,
      script: s.script ?? '',
      cues: (s.extraAudio ?? []).map((a) => ({ atS: startS + a.at, src: a.src, caption: a.caption ?? '' })),
    };
  });
  const outro = { startS: t, durationS: slideSeconds(sb.outro) };
  return { intro, scenes, outro, totalS: t + outro.durationS };
}

/** ["0:00 Intro", "0:04 Hook", ...]; YouTube needs the first chapter at 0:00. */
export function chapters(items) {
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return items.map((c, i) => `${i === 0 ? '0:00' : mmss(c.startS)} ${c.title}`);
}

// --- pairing token -------------------------------------------------------------------------------------------
/** Phone token = base64url("<sessionId>.<expMs>") + "." + signature; the expiry is readable without the secret. */
export function tokenExpiry(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2 || !parts[0]) return null;
  const signed = Buffer.from(parts[0], 'base64url').toString();
  const exp = Number(signed.slice(signed.lastIndexOf('.') + 1));
  return signed.includes('.') && Number.isFinite(exp) && exp > 0 ? exp : null;
}

export function expiryFromPhoneUrl(url) {
  try {
    return tokenExpiry(new URL(url).searchParams.get('t'));
  } catch {
    return null;
  }
}

/** The QR on screen is safe to publish only if its token expired before the planned upload. */
export function checkTokenExpiry(expiresAt, uploadAt) {
  if (typeof expiresAt !== 'number') return { ok: false, marginMs: null };
  return { ok: expiresAt < uploadAt, marginMs: uploadAt - expiresAt };
}
