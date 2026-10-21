import type { Exercise } from '@couch-coach/protocol';
import { h } from '../dom';

export const EXERCISE_LABEL: Record<Exercise, string> = {
  squat: 'Squat',
  jumping_jack: 'Jumping jack',
};

export type ScoreBand = 'good' | 'ok' | 'poor';

/** Thresholds from docs/ux.md: >= 85 strong, 60-84 decent, below 60 slipping. */
export function scoreBand(score: number): ScoreBand {
  if (score >= 85) return 'good';
  return score >= 60 ? 'ok' : 'poor';
}

export const BAND_LABEL: Record<ScoreBand, string> = {
  good: 'Strong form',
  ok: 'Decent form',
  poor: 'Form slipping',
};

export function button(
  label: string,
  onClick: () => void,
  variant: 'primary' | 'secondary' | 'quiet' = 'primary',
  extra: Record<string, string | boolean> = {},
): HTMLButtonElement {
  return h('button', { type: 'button', class: `btn btn--${variant}`, onclick: onClick, ...extra }, label);
}

/** Decorative glyph that is hidden from screen readers (meaning always lives in adjacent text). */
export function glyph(char: string, cls = ''): HTMLElement {
  return h('span', { class: `glyph ${cls}`.trim(), 'aria-hidden': 'true' }, char);
}

export function dots(): HTMLElement {
  return h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'));
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
