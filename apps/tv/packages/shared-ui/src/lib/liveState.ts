import type { CoachMessage, Exercise, PhoneEvent, SetSummary } from '../vendor/protocol';

export const DEFAULT_ASPECT = 9 / 16;

export interface RepInfo {
  index: number;
  score: number;
  faults: readonly string[];
  at: number;
}

export interface CompletedSet {
  setIndex: number;
  set: SetSummary;
}

export type CoachState =
  | { status: 'none' }
  | { status: 'thinking'; setIndex: number }
  | { status: 'cue'; setIndex: number; text: string; audioUrl?: string }
  /** No Cue arrived in time; the card shows a short apology and then hides. */
  | { status: 'quiet'; setIndex: number };

/** Everything the Live HUD shows, derived purely from the Session's event stream. */
export interface LiveState {
  hasPhone: boolean;
  /** Camera width / height from `hello`, default 9:16 portrait. */
  aspect: number;
  inSet: boolean;
  exercise: Exercise | null;
  /** 1-based number of the current (or most recent) Set; 0 before the first Set. */
  setIndex: number;
  reps: number;
  repScores: readonly number[];
  lastRep: RepInfo | null;
  /** Increments on every Rep so the UI can restart its bump animation. */
  repSeq: number;
  /** Sets finished so far, in order. */
  sets: readonly CompletedSet[];
  paused: boolean;
  /** The phone asked to end the Session (or the TV did). */
  endRequested: boolean;
  coach: CoachState;
  /** Last Cue text seen in this Session (kept for the Recap). */
  lastCueText: string | null;
}

export const initialLiveState: LiveState = {
  hasPhone: false,
  aspect: DEFAULT_ASPECT,
  inSet: false,
  exercise: null,
  setIndex: 0,
  reps: 0,
  repScores: [],
  lastRep: null,
  repSeq: 0,
  sets: [],
  paused: false,
  endRequested: false,
  coach: { status: 'none' },
  lastCueText: null,
};

export type LiveAction =
  | { kind: 'phone'; event: PhoneEvent }
  | { kind: 'coach'; message: CoachMessage }
  | { kind: 'coach_timeout' }
  | { kind: 'dismiss_cue' }
  | { kind: 'end_requested' }
  /** A new Session started: forget everything from the previous one. */
  | { kind: 'reset' };

/** Mean of the Rep scores so far in the current Set, or null before the first Rep. */
export function runningScore(state: Pick<LiveState, 'repScores'>): number | null {
  if (state.repScores.length === 0) return null;
  const sum = state.repScores.reduce((a, b) => a + b, 0);
  return Math.round(sum / state.repScores.length);
}

const lastCompletedIndex = (sets: readonly CompletedSet[]) => sets.reduce((m, s) => Math.max(m, s.setIndex), 0);

function applyPhoneEvent(state: LiveState, event: PhoneEvent): LiveState {
  switch (event.type) {
    case 'hello': {
      const aspect = event.aspect && Number.isFinite(event.aspect) ? event.aspect : DEFAULT_ASPECT;
      return { ...state, hasPhone: true, aspect };
    }
    case 'set_start':
      return {
        ...state,
        hasPhone: true,
        inSet: true,
        exercise: event.exercise,
        setIndex: Math.max(state.setIndex, lastCompletedIndex(state.sets)) + (state.inSet ? 0 : 1),
        reps: 0,
        repScores: [],
        lastRep: null,
        paused: false,
        // A new Set ends the previous Cue's life (docs/ux.md 2.3).
        coach: { status: 'none' },
      };
    case 'rep': {
      // Delivery is at-least-once: a Rep index we already counted in this Set is a duplicate.
      if (state.inSet && event.index <= state.reps) return state;
      // A Rep that arrives after its Set already ended (late or re-delivered) must not open a phantom Set.
      const justEnded = state.sets.find((c) => c.setIndex === state.setIndex);
      if (!state.inSet && justEnded && event.index <= justEnded.set.reps) return state;
      const wasInSet = state.inSet;
      const repScores = wasInSet ? [...state.repScores, event.score] : [event.score];
      return {
        ...state,
        hasPhone: true,
        inSet: true,
        exercise: event.exercise,
        setIndex: wasInSet ? state.setIndex : Math.max(state.setIndex, lastCompletedIndex(state.sets)) + 1,
        reps: wasInSet ? Math.max(state.reps + 1, event.index) : event.index,
        repScores,
        lastRep: { index: event.index, score: event.score, faults: event.faults, at: event.t },
        repSeq: state.repSeq + 1,
      };
    }
    case 'set_end': {
      const done: CompletedSet = { setIndex: event.setIndex, set: event.set };
      const sets = [...state.sets.filter((s) => s.setIndex !== event.setIndex), done].sort(
        (a, b) => a.setIndex - b.setIndex,
      );
      // A late duplicate for an earlier Set must not end the Set that is running now.
      if (event.setIndex < state.setIndex) return { ...state, sets };
      return {
        ...state,
        inSet: false,
        exercise: event.set.exercise,
        setIndex: event.setIndex,
        reps: event.set.reps,
        sets,
        paused: false,
      };
    }
    case 'control':
      if (event.action === 'end_session') return { ...state, endRequested: true };
      return { ...state, paused: event.action === 'pause' };
  }
}

function applyCoach(state: LiveState, message: CoachMessage): LiveState {
  if (message.type === 'thinking') return { ...state, coach: { status: 'thinking', setIndex: message.setIndex } };
  return {
    ...state,
    coach: { status: 'cue', setIndex: message.setIndex, text: message.text, audioUrl: message.audioUrl },
    lastCueText: message.text,
  };
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.kind) {
    case 'phone':
      return applyPhoneEvent(state, action.event);
    case 'coach':
      return applyCoach(state, action.message);
    case 'coach_timeout':
      return state.coach.status === 'thinking' ? { ...state, coach: { status: 'quiet', setIndex: state.coach.setIndex } } : state;
    case 'dismiss_cue':
      return state.coach.status === 'none' ? state : { ...state, coach: { status: 'none' } };
    case 'end_requested':
      return { ...state, endRequested: true };
    case 'reset':
      return initialLiveState;
  }
}

/** One line for the "Coach is thinking" card: "Set 2: 8 Reps, Form Score 84". */
export function setRecapLine(set: CompletedSet | undefined): string | null {
  if (!set) return null;
  const { reps, score } = set.set;
  return `Set ${set.setIndex}: ${reps} ${reps === 1 ? 'Rep' : 'Reps'}, Form Score ${Math.round(score)}`;
}
