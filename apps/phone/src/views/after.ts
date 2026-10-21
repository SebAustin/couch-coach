import { h } from '../dom';
import type { ViewFactory, Vm } from './types';
import { announcer, BAND_LABEL, button, dots, scoreBand } from './ui';

export const afterView: ViewFactory = (vm, actions) => {
  const live = announcer();
  const recap = h('p', { class: 'recap' });
  const coachLabel = h('div', { class: 'label' }, 'Coach says');
  // The three card states are plain text. One persistent live region (below) announces them, so a screen
  // reader hears each state once instead of every hidden <p role="status"> firing as it is revealed.
  const thinking = h('p', { class: 'thinking' }, 'Coach is thinking', dots());
  const cue = h('p', { class: 'cue' });
  const quiet = h('p', { class: 'cue cue--quiet' });
  const next = button('Next Set', actions.nextSet);
  const finish = button('Finish Session', actions.finishSession, 'quiet');
  const card = h('div', { class: 'coach-card' }, coachLabel, thinking, cue, quiet);
  const el = h(
    'section',
    { class: 'screen screen--sheet' },
    h('h1', { class: 'sr-only' }, 'Set complete'),
    h('div', { class: 'sheet' }, recap, card, next, finish),
    live.el,
  );

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
    if (c?.state === 'cue') live.say(`Coach says: ${c.text}`);
    else if (c?.state === 'quiet') live.say(quiet.textContent);
    else if (set && c?.state === 'thinking') live.say(`${recap.textContent}. Coach is thinking.`);
    else if (set) live.say(recap.textContent);
  };
  update(vm);
  return { el, update };
};
