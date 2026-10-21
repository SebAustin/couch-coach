import mitt from 'mitt';
import { Platform } from 'react-native';
import { SupportedKeys } from './SupportedKeys';
import { RemoteControlManagerInterface } from './RemoteControlManager.interface';

const KEY_MAPPING: Record<string, SupportedKeys> = {
  ArrowRight: SupportedKeys.Right,
  ArrowLeft: SupportedKeys.Left,
  ArrowUp: SupportedKeys.Up,
  ArrowDown: SupportedKeys.Down,
  Enter: SupportedKeys.Enter,
  Backspace: SupportedKeys.Back,
  Escape: SupportedKeys.Back,
  GoBack: SupportedKeys.Back, // For LG WebOS Magic Remote
  KeyD: SupportedKeys.Debug, // web preview stand-in for the remote's Menu/Info key
};

/** Backspace must keep editing text while a field has focus. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = el?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || el?.isContentEditable === true;
}

class RemoteControlManager implements RemoteControlManagerInterface {
  private eventEmitter = mitt<{ keyDown: SupportedKeys }>();

  constructor() {
    if (Platform.OS === 'web') {
      window.addEventListener('keydown', this.handleKeyDown);
    }
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const mappedKey = KEY_MAPPING[event.code] || KEY_MAPPING[event.key];
    if (isTypingTarget(event.target) && mappedKey !== SupportedKeys.Back) return;
    if (isTypingTarget(event.target) && event.key === 'Backspace') return;
    if (mappedKey) {
      this.eventEmitter.emit('keyDown', mappedKey);
    }
  };

  addKeydownListener = (listener: (event: SupportedKeys) => void): ((event: SupportedKeys) => void) => {
    this.eventEmitter.on('keyDown', listener);
    return listener;
  };

  removeKeydownListener = (listener: (event: SupportedKeys) => void): void => {
    this.eventEmitter.off('keyDown', listener);
  };

  emitKeyDown = (key: SupportedKeys): void => {
    this.eventEmitter.emit('keyDown', key);
  };
}

export default new RemoteControlManager();