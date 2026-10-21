import type { SetSummary } from '@couch-coach/protocol';
import type { HistorySet } from '../src/prompt';

/** What the data says about the dominant Fault vs the last Set of the same Exercise ("none" = no such Set). */
export type ExpectedTrend = 'improved' | 'worse' | 'same' | 'none';

export interface EvalCase {
  id: string;
  memberName: string;
  setIndex: number;
  set: SetSummary;
  history: HistorySet[];
  expect: {
    trend: ExpectedTrend;
    /** Product rule: the name may be used on the 1st Set of a Session and every 3rd Set after (1, 4, 7...). */
    nameAllowed: boolean;
  };
}

/** Fixed clock so relative days ("yesterday") are stable across runs. */
export const EVAL_NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const squat = (reps: number, faults: Record<string, number>, score: number): SetSummary => ({
  exercise: 'squat',
  reps,
  score,
  faults,
  durationMs: reps * 3_000,
});
const jacks = (reps: number, faults: Record<string, number>, score: number): SetSummary => ({
  exercise: 'jumping_jack',
  reps,
  score,
  faults,
  durationMs: reps * 1_500,
});
const past = (agoMs: number, s: SetSummary, cue?: string): HistorySet => ({
  createdAt: EVAL_NOW - agoMs,
  exercise: s.exercise,
  reps: s.reps,
  score: s.score,
  faults: s.faults,
  ...(cue ? { cue } : {}),
});

export const CASES: readonly EvalCase[] = [
  {
    id: 'sq-clean-first',
    memberName: 'Sam',
    setIndex: 1,
    set: squat(8, {}, 100),
    history: [],
    expect: { trend: 'none', nameAllowed: true },
  },
  {
    id: 'sq-knees-dominant-nohist',
    memberName: 'Priya',
    setIndex: 2,
    set: squat(10, { knees_caving: 7 }, 82.5),
    history: [],
    expect: { trend: 'none', nameAllowed: false },
  },
  {
    id: 'sq-mixed-other-exercise-hist',
    memberName: 'Sam',
    setIndex: 3,
    set: squat(9, { shallow_depth: 5, torso_lean: 3, heels_rising: 1 }, 75),
    history: [past(DAY, jacks(15, {}, 100), 'Great rhythm on those jumping jacks!')],
    expect: { trend: 'none', nameAllowed: false },
  },
  {
    id: 'sq-knees-improved',
    memberName: 'Priya',
    setIndex: 2,
    set: squat(10, { knees_caving: 3 }, 92.5),
    history: [past(DAY, squat(10, { knees_caving: 7 }, 82.5), 'Push those knees out over your toes.')],
    expect: { trend: 'improved', nameAllowed: false },
  },
  {
    id: 'sq-depth-worse',
    memberName: 'Debug',
    setIndex: 4,
    set: squat(8, { shallow_depth: 6 }, 77.5),
    history: [past(DAY, squat(10, { shallow_depth: 2 }, 94), 'Nice depth, keep sitting low.')],
    expect: { trend: 'worse', nameAllowed: true },
  },
  {
    id: 'sq-torso-same',
    memberName: 'Sam',
    setIndex: 3,
    set: squat(10, { torso_lean: 4, knees_caving: 1 }, 89.5),
    history: [
      past(2 * HOUR, jacks(12, { arms_not_overhead: 2 }, 95)),
      past(2 * DAY, squat(10, { torso_lean: 4 }, 92), 'Keep that chest up.'),
    ],
    expect: { trend: 'same', nameAllowed: false },
  },
  {
    id: 'sq-clean-after-knees',
    memberName: 'Priya',
    setIndex: 2,
    set: squat(10, {}, 100),
    history: [past(HOUR, squat(10, { knees_caving: 6 }, 85), 'Knees out on every rep.')],
    expect: { trend: 'improved', nameAllowed: false },
  },
  {
    id: 'jj-clean-first',
    memberName: 'Grandpa Joe',
    setIndex: 1,
    set: jacks(15, {}, 100),
    history: [],
    expect: { trend: 'none', nameAllowed: true },
  },
  {
    // The live bug: the Coach praised "feet staying wider" while feet_not_wide was flagged on 8 of 10 reps.
    id: 'jj-observed-feet-worse',
    memberName: 'Debug',
    setIndex: 3,
    set: jacks(10, { feet_not_wide: 8, arms_not_overhead: 3 }, 67),
    history: [past(HOUR, jacks(10, { feet_not_wide: 6, arms_not_overhead: 1 }, 79), 'Nice energy! Jump those feet out wider.')],
    expect: { trend: 'worse', nameAllowed: false },
  },
  {
    id: 'jj-arms-dominant-squat-hist',
    memberName: 'Sam',
    setIndex: 2,
    set: jacks(12, { arms_not_overhead: 9 }, 77.5),
    history: [past(DAY, squat(10, {}, 100), 'Clean squats, great work!')],
    expect: { trend: 'none', nameAllowed: false },
  },
  {
    id: 'jj-feet-improved',
    memberName: 'Debug',
    setIndex: 5,
    set: jacks(12, { feet_not_wide: 2, arms_not_overhead: 1 }, 92.5),
    history: [past(HOUR, jacks(12, { feet_not_wide: 7 }, 82.5), 'Land with your feet wide.')],
    expect: { trend: 'improved', nameAllowed: false },
  },
  {
    id: 'sq-heels-every-rep-same',
    memberName: 'Grandpa Joe',
    setIndex: 7,
    set: squat(10, { heels_rising: 10, knees_caving: 2 }, 80),
    history: [past(DAY, squat(10, { heels_rising: 10 }, 85), 'Keep those heels down.')],
    expect: { trend: 'same', nameAllowed: true },
  },
];
