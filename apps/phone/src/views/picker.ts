import type { Exercise } from '@couch-coach/protocol';
import { h } from '../dom';
import type { ViewFactory, Vm } from './types';
import { button, EXERCISE_LABEL } from './ui';

const HINTS: Record<Exercise, string> = {
  squat: 'Feet shoulder-width, sit back and down.',
  jumping_jack: 'Arms overhead, feet wide.',
};
const ORDER: Exercise[] = ['squat', 'jumping_jack'];

export const pickerView: ViewFactory = (vm, actions) => {
  const cards = new Map<Exercise, HTMLButtonElement>();
  for (const exercise of ORDER) {
    const card = h(
      'button',
      { type: 'button', role: 'radio', class: 'pick', onclick: () => actions.selectExercise(exercise) },
      h('span', { class: 'pick__name' }, EXERCISE_LABEL[exercise]),
      h('span', { class: 'pick__hint' }, HINTS[exercise]),
      h('span', { class: 'pick__check', 'aria-hidden': 'true' }, '✓'),
    );
    cards.set(exercise, card);
  }
  const status = h('p', { class: 'hint', role: 'status' });
  const retry = button('Try loading again', actions.retryModel, 'quiet');
  const start = button('Start Set', actions.startSet);
  const debug = button('Debug', actions.toggleDebug, 'quiet', { 'aria-pressed': 'false' });
  const el = h(
    'section',
    { class: 'screen screen--sheet' },
    h(
      'div',
      { class: 'sheet' },
      h('h1', { class: 'h2' }, 'Choose an Exercise'),
      h('div', { class: 'picks', role: 'radiogroup', 'aria-label': 'Exercise' }, ...cards.values()),
      status,
      retry,
      start,
      h(
        'div',
        { class: 'tools' },
        button('Flip camera', actions.flipCamera, 'quiet'),
        debug,
        button('Export last 30 s', actions.exportFrames, 'quiet'),
      ),
    ),
  );

  const update = (next: Vm) => {
    for (const [exercise, card] of cards) {
      const selected = next.exercise === exercise;
      card.setAttribute('aria-checked', String(selected));
      card.classList.toggle('pick--on', selected);
    }
    const ready = next.modelState === 'ready';
    start.disabled = !ready || next.exercise === null;
    retry.hidden = next.modelState !== 'error';
    debug.setAttribute('aria-pressed', String(next.debugOn));
    status.textContent = next.notice
      ? next.notice
      : next.modelState === 'loading' || next.modelState === 'idle'
        ? 'Loading the pose model...'
        : next.modelState === 'error'
          ? "Couldn't load the pose model. Check your connection."
          : next.exercise === null
            ? 'Pick an Exercise to begin.'
            : '';
  };
  update(vm);
  return { el, update };
};
