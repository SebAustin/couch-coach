import { h } from '../dom';
import type { FramingIssue } from '../logic/framing';
import type { ViewFactory, Vm } from './types';
import { announcer, BAND_LABEL, button, EXERCISE_LABEL, icon, prefersReducedMotion, scoreBand } from './ui';

const BUMP = [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.4 }, { transform: 'scale(1)' }];
const BUMP_MS = 220;
const FRAMING_TEXT = {
  step_back: 'Step back: I need to see you from head to feet to count Reps.',
  no_person: 'I can’t see you. Step into the camera’s view.',
  move_closer: 'Come closer: fill most of the screen, head to feet.',
} as const satisfies Record<FramingIssue, string>;
/** Read once when the warning opens. The visible countdown is aria-hidden so it never re-announces each second. */
const IDLE_ANNOUNCEMENT = 'No movement. Ending Set soon. Tap Keep going to continue.';

export const setView: ViewFactory = (vm, actions) => {
  const live = announcer();
  const title = h('h1', { class: 'bar__title' });
  const setNo = h('span', { class: 'bar__set' });
  const debug = h(
    'button',
    { type: 'button', class: 'icon-btn dev-only', 'aria-label': 'FPS debug overlay', 'aria-pressed': 'false', onclick: actions.toggleDebug },
    'FPS',
  );
  const pause = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Pause', onclick: actions.togglePause }, icon('pause'));
  // Not a live region on purpose (docs/ux.md section 6): announcing every Rep would spam a screen reader.
  const count = h('div', { class: 'rep-count' }, '0');
  const countLabel = h('div', { class: 'label' }, 'Reps');
  const band = h('div', { class: 'band' });
  const idleText = h('span', { class: 'banner__text', 'aria-hidden': 'true' });
  const banner = h(
    'div',
    { class: 'banner banner--idle', role: 'alert', hidden: true },
    h('span', { class: 'sr-only' }, IDLE_ANNOUNCEMENT),
    idleText,
    button('Keep going', actions.keepGoing),
  );
  const framingText = h('span', { class: 'banner__text' });
  const framingBanner = h('div', { class: 'banner banner--framing', role: 'status', hidden: true }, framingText);
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
    live.el,
    end,
  );

  let lastReps = vm.reps;
  let wasPaused = vm.paused;
  const update = (next: Vm) => {
    title.textContent = next.exercise ? EXERCISE_LABEL[next.exercise] : '';
    setNo.textContent = `Set ${next.setIndex}`;
    count.textContent = String(next.reps);
    if (next.reps !== lastReps) {
      lastReps = next.reps;
      if (!prefersReducedMotion()) count.animate(BUMP, { duration: BUMP_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
    const b = next.score === null ? null : scoreBand(next.score);
    band.textContent = next.score === null ? 'Do your first Rep' : `${BAND_LABEL[b!]} · ${Math.round(next.score)}`;
    band.className = `band${b ? ` band--${b}` : ''}`;
    debug.setAttribute('aria-pressed', String(next.debugOn));
    pause.replaceChildren(icon(next.paused ? 'play' : 'pause'));
    pause.setAttribute('aria-label', next.paused ? 'Resume' : 'Pause');
    paused.hidden = !next.paused;
    if (next.paused !== wasPaused) {
      wasPaused = next.paused;
      live.say(next.paused ? 'Set paused.' : 'Set resumed.');
    }
    // The idle countdown only runs for the last few seconds of a Set and wins the single alert slot.
    framingBanner.hidden = next.framing === null || next.paused || next.idleSecondsLeft !== null;
    if (next.framing) framingText.textContent = FRAMING_TEXT[next.framing];
    banner.hidden = next.idleSecondsLeft === null || next.paused;
    if (next.idleSecondsLeft !== null) idleText.textContent = `No movement. Ending Set in ${next.idleSecondsLeft}…`;
  };
  update(vm);
  return { el, update };
};
