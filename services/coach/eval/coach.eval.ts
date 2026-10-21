import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { converseCue, INFERENCE_CONFIG } from '../src/bedrock';
import { buildCoachPrompt, cleanCueText } from '../src/prompt';
import { CASES, EVAL_NOW, type EvalCase } from './cases';
import { checkCue } from './checks';
import { formatReport, summarize, type CueRecord } from './report';

/**
 * Env knobs:
 *   EVAL_RUNS=2          passes over the case set (default 2 -> 24 Bedrock calls)
 *   EVAL_CASES=a,b       only these case ids
 *   EVAL_RESCORE=path    re-check saved Cues from a results file; makes no Bedrock calls
 *   EVAL_MIN_PASS=0.9    pass-rate gate
 *   EVAL_OUT=path        where to write the results JSON (default eval/results/latest.json)
 */
const RUNS = Number(process.env.EVAL_RUNS ?? 2);
const MIN_PASS = Number(process.env.EVAL_MIN_PASS ?? 0.9);
const CONCURRENCY = 4;
const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));
const OUT = process.env.EVAL_OUT ?? `${RESULTS_DIR}latest.json`;

const only = process.env.EVAL_CASES?.split(',').map((s) => s.trim());
const cases = CASES.filter((c) => !only || only.includes(c.id));
const byId = new Map(CASES.map((c) => [c.id, c]));

async function runOne(c: EvalCase, run: number): Promise<CueRecord> {
  const prompt = buildCoachPrompt({ memberName: c.memberName, setIndex: c.setIndex, set: c.set, history: c.history, nowMs: EVAL_NOW });
  const start = Date.now();
  try {
    const raw = (await converseCue(prompt)) ?? '';
    const cue = cleanCueText(raw);
    const ms = Date.now() - start;
    if (!cue) return { run, caseId: c.id, raw, cue: null, ms, error: 'empty output', checks: [] };
    return { run, caseId: c.id, raw, cue, ms, checks: checkCue(c, raw, cue) };
  } catch (err) {
    return { run, caseId: c.id, raw: null, cue: null, ms: Date.now() - start, error: String(err), checks: [] };
  }
}

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

function rescore(path: string): CueRecord[] {
  const saved = JSON.parse(readFileSync(path, 'utf8')) as { records: CueRecord[] };
  return saved.records.map((r) => {
    const c = byId.get(r.caseId);
    if (!c || r.error || r.raw === null) return r;
    const cue = cleanCueText(r.raw);
    return cue ? { ...r, cue, checks: checkCue(c, r.raw, cue) } : r;
  });
}

it(`Coach Cues pass the deterministic checks (gate ${MIN_PASS * 100}%)`, async () => {
  const rescoring = process.env.EVAL_RESCORE;
  const jobs = Array.from({ length: RUNS }, (_, i) => cases.map((c) => ({ c, run: i + 1 }))).flat();
  const records = rescoring ? rescore(rescoring) : await pool(jobs, CONCURRENCY, ({ c, run }) => runOne(c, run));
  const summary = summarize(records);
  const sample = cases[0] && buildCoachPrompt({ memberName: cases[0].memberName, setIndex: cases[0].setIndex, set: cases[0].set, history: cases[0].history, nowMs: EVAL_NOW });

  if (!rescoring) {
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(
      OUT,
      JSON.stringify(
        { at: new Date().toISOString(), modelId: process.env.MODEL_ID, inference: INFERENCE_CONFIG, bedrockCalls: jobs.length, system: sample?.system, summary, records },
        null,
        2,
      ),
    );
  }
  // stdout directly: vitest hides console output of passing tests, and the report matters most then.
  process.stdout.write(
    `${formatReport(records, summary)}\n\n${rescoring ? `Rescored ${rescoring} (0 Bedrock calls)` : `Bedrock calls: ${jobs.length}; results: ${OUT}`}\n`,
  );

  expect(summary.passRate).toBeGreaterThanOrEqual(MIN_PASS);
});
