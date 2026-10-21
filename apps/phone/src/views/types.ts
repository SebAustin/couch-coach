import type { Exercise, SetSummary } from '@couch-coach/protocol';
import type { FramingIssue } from '../logic/framing';

export type Screen =
  | 'boot'
  | 'invalid'
  | 'config_error'
  | 'prime'
  | 'denied'
  | 'paired'
  | 'picker'
  | 'set'
  | 'after'
  | 'ended';

export type CoachView =
  | { state: 'thinking' }
  | { state: 'cue'; text: string }
  | { state: 'quiet' }
  | { state: 'skipped' };

/** Everything the views render. Treated as immutable: the controller replaces it on every change. */
export interface Vm {
  screen: Screen;
  online: boolean;
  busy: boolean;
  cameraReason: 'denied' | 'unavailable' | 'insecure';
  modelState: 'idle' | 'loading' | 'ready' | 'error';
  exercise: Exercise | null;
  setIndex: number;
  reps: number;
  score: number | null;
  paused: boolean;
  idleSecondsLeft: number | null;
  coach: CoachView | null;
  lastSet: SetSummary | null;
  debugOn: boolean;
  /** Set when the Member is out of frame long enough that Reps can't be counted. */
  framing: FramingIssue | null;
  /** One-line message for the picker (e.g. an Exercise that cannot start). */
  notice: string | null;
  /** The camera stopped or paused (e.g. iOS interruption); the notice offers a tap to resume. */
  cameraIssue: 'tap_to_resume' | 'lost' | null;
  /** The browser refused to keep the screen awake. */
  wakeLock: 'ok' | 'unavailable';
}

export interface Actions {
  allowCamera(): void;
  goToPicker(): void;
  selectExercise(exercise: Exercise): void;
  startSet(): void;
  endSet(): void;
  togglePause(): void;
  keepGoing(): void;
  nextSet(): void;
  finishSession(): void;
  flipCamera(): void;
  toggleDebug(): void;
  exportFrames(): void;
  retryModel(): void;
  reload(): void;
}

export interface View {
  el: HTMLElement;
  /** Patch the DOM in place for a new view model (never rebuilds, so focus and animations survive). */
  update(vm: Vm): void;
}

export type ViewFactory = (vm: Vm, actions: Actions) => View;
