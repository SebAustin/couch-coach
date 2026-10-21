import type { SetSummary } from '@couch-coach/protocol';
import { errorFields, log } from '../../shared/logger';
import { synthesizeToUrl } from './audio';
import { converseCue } from './bedrock';
import { publishCoachMessage } from './events';
import { loadHistory, loadMemberName, saveSet } from './memory';
import { buildCoachPrompt, cleanCueText, templatedCue, type HistorySet } from './prompt';

export interface CoachJob {
  sessionId: string;
  memberId: string;
  /** Per-session call number from the atomic counter; names the MP3. */
  call: number;
  setIndex: number;
  set: SetSummary;
}

const timed = async <T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
};

/**
 * thinking -> (history + Bedrock) -> Polly -> cue. Every stage degrades instead of failing so the TV always
 * gets a Cue: Bedrock down -> templated text; Polly/S3 down -> text-only Cue.
 */
export async function runCoachJob(job: CoachJob): Promise<void> {
  const { sessionId, memberId, setIndex, set } = job;
  const started = Date.now();
  const ctx = { sessionId, memberId, setIndex, call: job.call };

  const thinking = publishCoachMessage(sessionId, { type: 'thinking', setIndex, t: Date.now() });

  const [name, history] = await Promise.all([
    loadMemberName(memberId).catch((err) => {
      log('warn', 'member profile unavailable', { ...ctx, ...errorFields(err) });
      return 'there';
    }),
    loadHistory(memberId).catch((err): HistorySet[] => {
      log('warn', 'history unavailable', { ...ctx, ...errorFields(err) });
      return [];
    }),
  ]);

  let text: string;
  let bedrockMs: number | undefined;
  try {
    const prompt = buildCoachPrompt({ memberName: name, setIndex, set, history, nowMs: Date.now() });
    const result = await timed(() => converseCue(prompt));
    bedrockMs = result.ms;
    const cleaned = cleanCueText(result.value);
    if (!cleaned) throw new Error('Bedrock returned no text');
    text = cleaned;
  } catch (err) {
    log('warn', 'bedrock failed, using templated cue', { ...ctx, ...errorFields(err) });
    text = templatedCue({ memberName: name, set });
  }

  let audioUrl: string | undefined;
  let pollyMs: number | undefined;
  try {
    const result = await timed(() => synthesizeToUrl(text, sessionId, job.call));
    audioUrl = result.value;
    pollyMs = result.ms;
  } catch (err) {
    log('warn', 'polly/s3 failed, text-only cue', { ...ctx, ...errorFields(err) });
  }

  await thinking;
  const published = await publishCoachMessage(sessionId, {
    type: 'cue',
    text,
    ...(audioUrl ? { audioUrl } : {}),
    setIndex,
    t: Date.now(),
  });
  log(published ? 'info' : 'error', published ? 'cue published' : 'cue publish failed', {
    ...ctx,
    hasAudio: Boolean(audioUrl),
    bedrockMs,
    pollyMs,
    totalMs: Date.now() - started,
  });

  await saveSet({ memberId, sessionId, setIndex, set, cue: text, nowMs: Date.now() }).catch((err) =>
    log('error', 'saving set failed', { ...ctx, ...errorFields(err) }),
  );
}
