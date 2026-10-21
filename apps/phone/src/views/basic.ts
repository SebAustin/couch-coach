import { h } from '../dom';
import { button, glyph } from './ui';
import type { ViewFactory } from './types';

function card(...children: (Node | string)[]): HTMLElement {
  return h('section', { class: 'screen screen--card' }, h('div', { class: 'card-body' }, ...children));
}

export const bootView: ViewFactory = () => {
  const el = card(h('p', { class: 'body', role: 'status' }, 'Loading Couch Coach...'));
  return { el, update: () => {} };
};

export const invalidView: ViewFactory = () => {
  const el = card(
    h('h1', { class: 'h1' }, 'This Pairing Code expired'),
    h('p', { class: 'body' }, 'Scan the new code on your TV.'),
  );
  return { el, update: () => {} };
};

export const configErrorView: ViewFactory = (_vm, actions) => {
  const el = card(
    h('h1', { class: 'h1' }, "Couldn't reach Couch Coach"),
    h('p', { class: 'body' }, 'Check your connection and try again.'),
    button('Try again', actions.reload),
  );
  return { el, update: () => {} };
};

export const primeView: ViewFactory = (vm, actions) => {
  const allow = button('Allow camera', actions.allowCamera);
  const el = card(
    glyph('◎', 'glyph--hero'),
    h('h1', { class: 'h1' }, 'Couch Coach needs your camera'),
    h('p', { class: 'body' }, 'Your video never leaves this phone. Only body points are sent to the TV.'),
    allow,
  );
  const update = (next: typeof vm) => {
    allow.disabled = next.busy;
    allow.textContent = next.busy ? 'Starting camera...' : 'Allow camera';
  };
  update(vm);
  return { el, update };
};

const HELP: Record<'denied' | 'unavailable' | 'insecure', { title: string; body: string }> = {
  denied: {
    title: 'Camera is off',
    body: "Couch Coach can't see you without it. Open your browser's site settings, allow Camera, then come back.",
  },
  unavailable: {
    title: "Couldn't start the camera",
    body: 'Close other apps that use the camera, then try again.',
  },
  insecure: {
    title: 'Camera needs a secure link',
    body: 'Open the link from the TV again; it should start with https.',
  },
};

export const deniedView: ViewFactory = (vm, actions) => {
  const title = h('h1', { class: 'h1' });
  const body = h('p', { class: 'body' });
  const retry = button('Try again', actions.allowCamera);
  const help = h(
    'details',
    { class: 'help' },
    h('summary', {}, 'How to allow it'),
    h('p', {}, 'iPhone (Safari): tap aA in the address bar, then Website Settings, then set Camera to Allow.'),
    h('p', {}, 'Android (Chrome): tap the lock icon in the address bar, then Permissions, then set Camera to Allow.'),
  );
  const el = card(title, body, retry, help);
  const update = (next: typeof vm) => {
    const copy = HELP[next.cameraReason];
    title.textContent = copy.title;
    body.textContent = copy.body;
    retry.disabled = next.busy;
  };
  update(vm);
  return { el, update };
};

export const endedView: ViewFactory = () => {
  const el = card(
    glyph('✓', 'glyph--ok glyph--hero'),
    h('h1', { class: 'h1' }, 'Session ended'),
    h('p', { class: 'body' }, 'Nice work. You can close this page.'),
  );
  return { el, update: () => {} };
};

export const pairedView: ViewFactory = (_vm, actions) => {
  const el = h(
    'section',
    { class: 'screen screen--sheet' },
    h(
      'div',
      { class: 'sheet' },
      glyph('✓', 'glyph--ok glyph--hero'),
      h('h1', { class: 'h1' }, 'Paired with the TV'),
      h('p', { class: 'body' }, 'Your Session is ready.'),
      h('p', { class: 'hint' }, 'Prop your phone upright, 2-3 m away, with your whole body in frame.'),
      button('Choose Exercise', actions.goToPicker),
    ),
  );
  return { el, update: () => {} };
};
