import { h } from '../dom';
import type { ViewFactory, Vm } from './types';
import { BAND_LABEL, button, EXERCISE_LABEL, prefersReducedMotion, scoreBand } from './ui';

const BUMP = [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.4 }, { transform: 'scale(1)' }];
const BUMP_MS = 220;
const FRAMING_TEXT = {
  step_back: 'Step back: I need to see you from head to feet to count Reps.',
  no_person: "I can't see you. Step into the camera's view.",
} as const;

export const setView: ViewFactory = (vm, actions) => {
  const title = h('span', { class: 'bar__title' });
  const setNo = h('span', { class: 'bar__set' });
  const debug = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Debug overlay', 'aria-pressed': 'false', onclick: actions.toggleDebug }, 'FPS');
  const pause = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Pause', onclick: actions.togglePause }, '⏸');
  const count = h('div', { class: 'rep-count' }, '0');
  const countLabel = h('div', { class: 'label' }, 'Reps');
  const band = h('div', { class: 'band' });
  const announce = h('div', { class: 'sr-only', role: 'status' });
  const banner = h(
    'div',
    { class: 'banner', role: 'alert', hidden: true },
    h('span', { class: 'banner__text' }),
    button('Keep going', actions.keepGoing, 'secondary'),
  );
  const framingBanner = h('div', { class: 'banner banner--framing', role: 'alert', hidden: true }, h('span', { class: 'banner__text' }));
  const paused = h(
    'div',
    { class: 'paused', hidden: true },
    h('h2', { class: 'h1' }, 'Paused'),
    button('Resume', actions.togglePause),
  );
  const end = h('button', { type: 'button', class: 'end-bar', onclick: actions.endSet }, 'End set');

  const el = h(
    'section',
    { class: 'screen screen--set' },
    h('header', { class: 'bar' }, h('div', { class: 'bar__id' }, title, setNo), h('div', { class: 'bar__tools' }, debug, pause)),
    h('div', { class: 'center' }, count, countLabel, band, framingBanner, banner),
    paused,
    announce,
    end,
  );

  let lastReps = vm.reps;
  const update = (next: Vm) => {
    title.textContent = next.exercise ? EXERCISE_LABEL[next.exercise] : '';
    setNo.textContent = `Set ${next.setIndex}`;
    count.textContent = String(next.reps);
    if (next.reps !== lastReps) {
      lastReps = next.reps;
      if (!prefersReducedMotion()) count.animate(BUMP, { duration: BUMP_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
    const b = next.score === null ? null : scoreBand(next.score);
    band.textContent = next.score === null ? 'Do your first Rep' : `${BAND_LABEL[b!]}  ${Math.round(next.score)}`;
    band.className = `band${b ? ` band--${b}` : ''}`;
    debug.setAttribute('aria-pressed', String(next.debugOn));
    pause.textContent = next.paused ? '▶' : '⏸';
    pause.setAttribute('aria-label', next.paused ? 'Resume' : 'Pause');
    paused.hidden = !next.paused;
    framingBanner.hidden = next.framing === null || next.paused;
    if (next.framing) framingBanner.querySelector('.banner__text')!.textContent = FRAMING_TEXT[next.framing];
    banner.hidden = next.idleSecondsLeft === null || next.paused;
    if (next.idleSecondsLeft !== null) {
      banner.querySelector('.banner__text')!.textContent = `No movement. Ending Set in ${next.idleSecondsLeft}...`;
    }
  };
  update(vm);
  return { el, update };
};
