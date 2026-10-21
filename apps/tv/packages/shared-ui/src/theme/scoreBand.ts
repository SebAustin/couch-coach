import { color } from './tokens';

export type ScoreBand = 'good' | 'ok' | 'poor';

export const GOOD_THRESHOLD = 85;
export const OK_THRESHOLD = 60;

/** Form Score band: >= 85 good, 60-84 ok, < 60 poor (docs/ux.md section 1). */
export function scoreBand(score: number): ScoreBand {
  if (score >= GOOD_THRESHOLD) return 'good';
  if (score >= OK_THRESHOLD) return 'ok';
  return 'poor';
}

const BAND_COLOR: Record<ScoreBand, string> = {
  good: color.scoreGood,
  ok: color.scoreOk,
  poor: color.scorePoor,
};

const BAND_LABEL: Record<ScoreBand, string> = {
  good: 'Strong form',
  ok: 'Decent form',
  poor: 'Form slipping',
};

export function scoreColor(score: number): string {
  return BAND_COLOR[scoreBand(score)];
}

export function scoreLabel(score: number): string {
  return BAND_LABEL[scoreBand(score)];
}
