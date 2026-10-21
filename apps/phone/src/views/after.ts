import { h } from '../dom';
import type { ViewFactory, Vm } from './types';
import { BAND_LABEL, button, dots, scoreBand } from './ui';

export const afterView: ViewFactory = (vm, actions) => {
  const recap = h('p', { class: 'recap' });
  const coachLabel = h('div', { class: 'label' }, 'Coach says');
  const thinking = h('p', { class: 'thinking', role: 'status' }, 'Coach is thinking', dots());
  const cue = h('p', { class: 'cue', role: 'status' });
  const quiet = h('p', { class: 'cue cue--quiet', role: 'status' });
  const next = button('Next Set', actions.nextSet);
  const finish = button('Finish Session', actions.finishSession, 'quiet');
  const card = h('div', { class: 'coach-card' }, coachLabel, thinking, cue, quiet);
  const el = h('section', { class: 'screen screen--sheet' }, h('div', { class: 'sheet' }, recap, card, next, finish));

  const update = (state: Vm) => {
    const set = state.lastSet;
    recap.textContent = set
      ? set.reps === 0
        ? `Set ${state.setIndex}: no Reps counted`
        : `Set ${state.setIndex}: ${set.reps} Reps, ${BAND_LABEL[scoreBand(set.score)]} (${Math.round(set.score)})`
      : '';
    const c = state.coach;
    thinking.hidden = c?.state !== 'thinking';
    cue.hidden = c?.state !== 'cue';
    cue.textContent = c?.state === 'cue' ? c.text : '';
    quiet.hidden = c?.state !== 'quiet';
    quiet.textContent = 'The Coach is quiet this time. Your Reps are saved.';
    card.hidden = c === null || c.state === 'skipped';
  };
  update(vm);
  return { el, update };
};
