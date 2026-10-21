import type { SetSummary } from '@couch-coach/protocol';
import type { EvalCase } from './cases';

/**
 * Deterministic checks for one Cue. They are deliberately keyword-based: cheap, repeatable, and biased to
 * catch the failure modes seen live (contradicting the fault data, over-long Cues, invented body parts,
 * name overuse). They are not a judge of tone; read the Cues in the report too.
 */

export const MAX_WORDS = 35;
export const MAX_SENTENCES = 2;
/** A Fault on at least this share of Reps must never be praised or called absent. */
const SIGNIFICANT_SHARE = 0.3;

export interface CheckResult {
  name: CheckName;
  pass: boolean;
  detail?: string;
}

export type CheckName =
  | 'words<=35'
  | 'sentences<=2'
  | 'dominant-area-or-praise'
  | 'no-fault-contradiction'
  | 'no-false-trend'
  | 'no-unrelated-body-part'
  | 'name-policy';

interface FaultRules {
  /** The Cue must mention one of these when this is the dominant Fault. */
  area: RegExp;
  /** Nouns for the body area, used to spot "your <area> stayed great"-style claims. */
  nouns: string;
  /** Words that, attached to the area in a claim, say the Fault did not happen. */
  positives: string;
  /** Direct "it did not happen" phrasings. */
  absence: RegExp[];
}

const FAULT_RULES: Record<string, FaultRules> = {
  shallow_depth: {
    area: /\b(depth|deep(er)?|low(er)?|sink|sit|hips?|thighs?|parallel|drop|all the way down|glutes|butt)\b/,
    nouns: 'depth|squats?|hips',
    positives: 'deep|deeper|low|lower|parallel|great|good|solid|perfect|better|nice|full',
    absence: [
      /\b(great|nice|good|solid|perfect|better|full|awesome|excellent) depth\b/,
      /\b(you|you're|you were)\s+(hit|hitting|sank|sinking|dropped|dropping|got|getting|went|going)\b[^.!?]{0,15}\b(deep|deeper|low|lower|parallel|depth)\b/,
    ],
  },
  knees_caving: {
    area: /\bknees?\b/,
    nouns: 'knees?',
    positives: 'out|held|holding|stable|tracking|tracked|strong|solid|great|good|better|aligned|steady|straight|wide|perfect',
    absence: [/\bno (more )?(knee )?cav/, /\b(didn't|did not|never|stopped|no longer) cav/, /\bwithout cav/],
  },
  torso_lean: {
    area: /\b(chest|torso|back|upright|tall|posture|lean\w*|shoulders?)\b/,
    nouns: 'chest|torso|back|posture',
    positives: 'up|upright|tall|proud|great|good|solid|better|straight|perfect|strong',
    absence: [/\b(great|nice|good|solid|perfect|better) posture\b/, /\b(didn't|did not|never|stopped|no longer) lean/, /\bno (more )?lean/],
  },
  heels_rising: {
    area: /\b(heels?|flat|whole foot)\b/,
    nouns: 'heels?',
    positives: 'down|flat|planted|grounded|great|good|solid|better|perfect|stable',
    absence: [/\b(didn't|did not|never|stopped|no longer) (rise|lift|come up|came up)/],
  },
  arms_not_overhead: {
    area: /\b(arms?|hands?|overhead|reach\w*|above your head)\b/,
    nouns: 'arms?|hands?',
    positives: 'overhead|up|high|higher|all the way|full|great|good|better|perfect|extended|straight',
    absence: [
      /\b(great|nice|good|solid|perfect|better|full) (arm|reach|extension)\b/,
      /\b(you|you're|you were)\s+(reached|reaching|got|getting)\b[^.!?]{0,15}\b(overhead|all the way)\b/,
    ],
  },
  feet_not_wide: {
    area: /\b(feet|foot|stance|wide|wider|width|legs?)\b/,
    nouns: 'feet|stance|legs',
    positives: 'wide|wider|out|great|good|solid|perfect|better|nice',
    absence: [
      /\b(great|nice|good|solid|perfect|better) (wide )?(stance|foot width|width|foot placement)\b/,
      /\bwider (today|than|this time)\b/,
      /\b(you|you're|you were)\s+(kept|keeping|landed|landing|got|getting)\b[^.!?]{0,15}\bwide/,
    ],
  },
};

const STATE_VERBS = "are|is|was|were|'re|stay|stays|stayed|staying|held|holding|look|looks|looked|looking|got|getting|went|going|been|kept|keeping|came|coming";

/** "your feet are staying wider", "knees held strong": a claim about the area's state, not an instruction. */
const stateClaim = (r: FaultRules, improved: boolean): RegExp => {
  const positives = r.positives.split('|').filter((w) => !(improved && COMPARATIVES.has(w)));
  return new RegExp(`\\b(${r.nouns})\\b[^.!?,]{0,12}\\b(${STATE_VERBS})\\b[^.!?,]{0,15}\\b(${positives.join('|')})\\b`);
};

/** Instructions ("make sure your knees are out") are fine; only claims about what happened count. */
const IMPERATIVE_BEFORE = /\b(make sure|ensure|keep|focus|try|aim|let's|lets|need|want|until|if|so|work on|get|remember|think)\b[^.!?]*$/;

const BODY_PARTS: Record<string, RegExp> = {
  head: /(?<!(?:above|over) (?:your|the) )\bhead\b/,
  neck: /\bneck\b/,
  chin: /\bchin\b/,
  eyes: /\b(eyes|gaze)\b/,
  shoulders: /\bshoulders?\b/,
  elbows: /\belbows?\b/,
  wrists: /\bwrists?\b/,
  hands: /\bhands?\b/,
  arms: /\barms?\b/,
  chest: /\bchest\b/,
  torso: /\btorso\b/,
  back: /\b(your|the|my|lower|upper) back\b|\bback (straight|flat|tall)\b/,
  core: /\b(core|abs)\b/,
  hips: /\bhips?\b/,
  glutes: /\b(glutes|butt)\b/,
  thighs: /\bthighs?\b/,
  knees: /\bknees?\b/,
  shins: /\bshins?\b/,
  calves: /\bcalf|calves\b/,
  ankles: /\bankles?\b/,
  heels: /\bheels?\b/,
};

/** Body parts that have nothing to do with any Fault this Exercise can produce (docs/CONTRACTS.md, docs/ux.md). */
const UNRELATED_BODY_PARTS: Record<SetSummary['exercise'], readonly string[]> = {
  squat: ['head', 'neck', 'chin', 'eyes', 'elbows', 'wrists', 'hands', 'arms', 'shins', 'calves', 'ankles'],
  jumping_jack: ['head', 'neck', 'chin', 'eyes', 'chest', 'torso', 'back', 'core', 'hips', 'glutes', 'thighs', 'knees', 'calves', 'heels'],
};

const PRAISE = /\b(great|nice|clean|solid|perfect|excellent|awesome|strong|well done|good|crushed|smooth|beautiful|fantastic|brilliant|love|textbook|spot on|nailed|flawless)\b/;
const OVERALL_CLEAN_CLAIM = /\b(perfect|flawless|clean|spotless|textbook) (form|reps?|set)\b|\bno (form )?faults\b|\bevery rep (was )?(perfect|clean)\b|\bzero faults\b/;
const PROGRESS_CLAIM =
  /\b(improv\w*|progress\w*|better than|getting better|way better|fewer|less (than|caving|leaning)|cleaner than|up from (last|yesterday|before|earlier)|(deeper|wider|higher|lower|taller|steadier|straighter|flatter) than (yesterday|last|before|earlier|this morning))\b/;
/** Comparatives are fair game when the data says the Fault improved ("feet landing wider now"). */
const COMPARATIVES = new Set(['better', 'wider', 'deeper', 'lower', 'higher']);
const PAST_REFERENCE = /\b(last time|yesterday|than before|last session|previous|earlier today|last set)\b/;

export const countWords = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export const countSentences = (text: string): number =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => /[\p{L}\p{N}]/u.test(s)).length;

const normalize = (text: string): string => text.toLowerCase().replace(/[\u2018\u2019]/g, "'");
const sentencesOf = (text: string): string[] => normalize(text).split(/(?<=[.!?])\s+/);

/** True when `re` matches as a claim somewhere (not inside an instruction). */
function hasClaim(text: string, re: RegExp): string | undefined {
  for (const sentence of sentencesOf(text)) {
    const global = new RegExp(re.source, 'g');
    for (const m of sentence.matchAll(global)) {
      const before = sentence.slice(Math.max(0, m.index - 30), m.index);
      if (!IMPERATIVE_BEFORE.test(before)) return m[0];
    }
  }
  return undefined;
}

/** Fault ids with counts, most frequent first, ignoring zero counts. */
export function rankedFaults(set: SetSummary): Array<[string, number]> {
  return Object.entries(set.faults)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
}

function significantFaults(set: SetSummary): string[] {
  const reps = Math.max(set.reps, 1);
  return rankedFaults(set)
    .filter(([, n]) => n / reps >= SIGNIFICANT_SHARE)
    .map(([id]) => id);
}

function checkDominant(set: SetSummary, text: string): CheckResult {
  const cue = normalize(text);
  const [top] = rankedFaults(set);
  if (!top) {
    const ok = PRAISE.test(cue);
    return { name: 'dominant-area-or-praise', pass: ok, ...(ok ? {} : { detail: 'clean set but no praise' }) };
  }
  const rules = FAULT_RULES[top[0]];
  const ok = rules ? rules.area.test(cue) : true;
  return { name: 'dominant-area-or-praise', pass: ok, ...(ok ? {} : { detail: `does not mention ${top[0]} area` }) };
}

function checkContradiction(c: EvalCase, cue: string): CheckResult {
  const { set } = c;
  const hits: string[] = [];
  if (rankedFaults(set).length > 0) {
    const overall = hasClaim(cue, OVERALL_CLEAN_CLAIM);
    if (overall) hits.push(`"${overall}" but the set had faults`);
  }
  for (const id of significantFaults(set)) {
    const rules = FAULT_RULES[id];
    if (!rules) continue;
    for (const re of [stateClaim(rules, c.expect.trend === 'improved'), ...rules.absence]) {
      const m = hasClaim(cue, re);
      if (m) hits.push(`"${m}" but ${id} x${set.faults[id]}/${set.reps}`);
    }
  }
  return { name: 'no-fault-contradiction', pass: hits.length === 0, ...(hits.length ? { detail: hits.join('; ') } : {}) };
}

function checkTrend(c: EvalCase, cue: string): CheckResult {
  const { trend } = c.expect;
  const hits: string[] = [];
  if (trend !== 'improved') {
    const m = hasClaim(cue, PROGRESS_CLAIM);
    if (m) hits.push(`claims progress ("${m}") but trend is ${trend}`);
  }
  if (c.history.length === 0) {
    const m = PAST_REFERENCE.exec(normalize(cue));
    if (m) hits.push(`refers to an earlier set ("${m[0]}") but this is the first set`);
  }
  return { name: 'no-false-trend', pass: hits.length === 0, ...(hits.length ? { detail: hits.join('; ') } : {}) };
}

function checkBodyParts(set: SetSummary, cue: string): CheckResult {
  const lower = normalize(cue);
  const hits = UNRELATED_BODY_PARTS[set.exercise].filter((part) => BODY_PARTS[part]!.test(lower));
  return { name: 'no-unrelated-body-part', pass: hits.length === 0, ...(hits.length ? { detail: hits.join(', ') } : {}) };
}

/** Counts the full name or any 3+ letter part of it ("Joe" for "Grandpa Joe"), once per occurrence. */
function checkName(c: EvalCase, cue: string): CheckResult {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = c.memberName.trim();
  const parts = [name, ...name.split(/\s+/).filter((p) => p.length >= 3)].map(escape);
  const uses = (cue.match(new RegExp(`\\b(${parts.join('|')})\\b`, 'gi')) ?? []).length;
  const max = c.expect.nameAllowed ? 1 : 0;
  return {
    name: 'name-policy',
    pass: uses <= max,
    ...(uses <= max ? {} : { detail: `name used ${uses}x, allowed ${max}` }),
  };
}

/**
 * Runs every check. `raw` is the model output (sentence count is judged there, since cleanCueText would
 * silently truncate); `cue` is the cleaned text the Member actually sees and hears.
 */
export function checkCue(c: EvalCase, raw: string, cue: string): CheckResult[] {
  const words = countWords(cue);
  const sentences = countSentences(raw);
  return [
    { name: 'words<=35', pass: words <= MAX_WORDS, ...(words > MAX_WORDS ? { detail: `${words} words` } : {}) },
    { name: 'sentences<=2', pass: sentences <= MAX_SENTENCES, ...(sentences > MAX_SENTENCES ? { detail: `${sentences} sentences` } : {}) },
    checkDominant(c.set, cue),
    checkContradiction(c, cue),
    checkTrend(c, cue),
    checkBodyParts(c.set, cue),
    checkName(c, cue),
  ];
}
