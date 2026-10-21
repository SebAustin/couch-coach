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

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_PATHS = {
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  play: 'M7 4l13 8-13 8z',
} as const;

/**
 * Inline SVG icon (hidden from screen readers; the button carries the aria-label). Used instead of the
 * pause and play characters, which iOS Safari renders as colour emoji.
 */
export function icon(name: keyof typeof ICON_PATHS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name]);
  svg.append(path);
  return svg;
}

const ANNOUNCE_DELAY_MS = 120;

export interface Announcer {
  el: HTMLElement;
  /** Politely announce `text` once; repeats of the same text are ignored. */
  say(text: string): void;
}

/**
 * A persistent visually-hidden live region. Screen readers announce text that changes inside a region
 * that already exists, so the text is written a beat after the view is mounted.
 */
export function announcer(): Announcer {
  const el = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  let last = '';
  return {
    el,
    say(text) {
      if (text === '' || text === last) return;
      last = text;
      setTimeout(() => {
        el.textContent = text;
      }, ANNOUNCE_DELAY_MS);
    },
  };
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
