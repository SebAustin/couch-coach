import { initialLiveState, liveReducer, runningScore, setRecapLine, DEFAULT_ASPECT, type LiveState } from '../liveState';
import type { CoachMessage, PhoneEvent } from '../../vendor/protocol';

const phone = (event: PhoneEvent) => ({ kind: 'phone' as const, event });
const coach = (message: CoachMessage) => ({ kind: 'coach' as const, message });
const run = (events: Parameters<typeof liveReducer>[1][], from: LiveState = initialLiveState) =>
  events.reduce(liveReducer, from);

const rep = (index: number, score: number, faults: string[] = []): PhoneEvent => ({
  type: 'rep', exercise: 'squat', index, score, faults, t: index * 1000,
});
const setEnd = (setIndex: number, reps: number, score: number, faults: Record<string, number> = {}): PhoneEvent => ({
  type: 'set_end', setIndex, t: 0, set: { exercise: 'squat', reps, score, faults, durationMs: 1000 },
});

describe('liveReducer', () => {
  it('marks the phone as joined on hello and defaults to a 9:16 portrait aspect', () => {
    const s = run([phone({ type: 'hello', memberId: 'm1', t: 1 })]);
    expect(s.hasPhone).toBe(true);
    expect(s.aspect).toBe(DEFAULT_ASPECT);
  });

  it.each([
    ['set_start', { type: 'set_start', exercise: 'squat', t: 1 }],
    ['rep', { type: 'rep', exercise: 'squat', index: 1, score: 100, faults: [], t: 1 }],
    ['set_end', { type: 'set_end', setIndex: 1, t: 1, set: { exercise: 'squat', reps: 1, score: 100, faults: {}, durationMs: 1 } }],
    ['control', { type: 'control', action: 'pause', t: 1 }],
  ] as const)('treats a %s event as proof a phone joined even without hello', (_name, event) => {
    expect(run([phone(event as PhoneEvent)]).hasPhone).toBe(true);
  });

  it('treats the first PoseBatch as proof a phone joined', () => {
    expect(liveReducer(initialLiveState, { kind: 'pose_seen' }).hasPhone).toBe(true);
    const joined = run([phone({ type: 'hello', memberId: 'm', t: 1 })]);
    expect(liveReducer(joined, { kind: 'pose_seen' })).toBe(joined);
  });

  it('uses the aspect from hello when present', () => {
    const s = run([phone({ type: 'hello', memberId: 'm1', aspect: 0.75, t: 1 })]);
    expect(s.aspect).toBe(0.75);
  });

  it('counts Reps and keeps a running Set mean', () => {
    const s = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      phone(rep(1, 100)),
      phone(rep(2, 70, ['shallow_depth'])),
    ]);
    expect(s.setIndex).toBe(1);
    expect(s.reps).toBe(2);
    expect(runningScore(s)).toBe(85);
    expect(s.lastRep?.faults).toEqual(['shallow_depth']);
    expect(s.repSeq).toBe(2);
  });

  it('has no running score before the first Rep', () => {
    expect(runningScore(initialLiveState)).toBeNull();
  });

  it('numbers Sets and records each one on set_end', () => {
    const s = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      phone(rep(1, 90)),
      phone(setEnd(1, 8, 84)),
      phone({ type: 'set_start', exercise: 'squat', t: 1 }),
    ]);
    expect(s.setIndex).toBe(2);
    expect(s.sets).toHaveLength(1);
    expect(s.reps).toBe(0);
    expect(s.lastRep).toBeNull();
  });

  it('replaces a Set that is reported twice rather than duplicating it', () => {
    const s = run([phone(setEnd(1, 8, 84)), phone(setEnd(1, 9, 80))]);
    expect(s.sets).toHaveLength(1);
    expect(s.sets[0]!.set.reps).toBe(9);
  });

  it('ignores a duplicate Rep (at-least-once delivery)', () => {
    const s = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      phone(rep(1, 100)),
      phone(rep(1, 100)),
      phone(rep(2, 70)),
      phone(rep(2, 70)),
    ]);
    expect(s.reps).toBe(2);
    expect(s.repScores).toEqual([100, 70]);
    expect(s.repSeq).toBe(2);
  });

  it('does not open a phantom Set for a Rep that arrives after its Set ended', () => {
    const s = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      phone(rep(1, 100)),
      phone(rep(2, 100)),
      phone(setEnd(1, 2, 100)),
      phone(rep(2, 100)), // late duplicate
    ]);
    expect(s.inSet).toBe(false);
    expect(s.setIndex).toBe(1);
    expect(s.reps).toBe(2);
    // a real next Set announces itself with set_start, so its first Rep is counted
    const next = run([phone({ type: 'set_start', exercise: 'squat', t: 9 }), phone(rep(1, 90))], s);
    expect(next.setIndex).toBe(2);
    expect(next.reps).toBe(1);
  });

  it('does not let a late duplicate set_end for an earlier Set end the running Set', () => {
    const s = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      phone(setEnd(1, 8, 84)),
      phone({ type: 'set_start', exercise: 'squat', t: 1 }),
      phone(rep(1, 90)),
      phone(setEnd(1, 8, 84)),
    ]);
    expect(s.inSet).toBe(true);
    expect(s.setIndex).toBe(2);
    expect(s.sets).toHaveLength(1);
  });

  it('treats a repeated hello as idempotent but updates the aspect', () => {
    const s = run([
      phone({ type: 'hello', memberId: 'm1', aspect: 0.5625, t: 1 }),
      phone({ type: 'hello', memberId: 'm1', aspect: 0.75, t: 2 }),
    ]);
    expect(s.hasPhone).toBe(true);
    expect(s.aspect).toBe(0.75);
  });

  it('starts a Set implicitly when a Rep arrives without set_start', () => {
    const s = run([phone(rep(1, 100))]);
    expect(s.inSet).toBe(true);
    expect(s.setIndex).toBe(1);
  });

  it('does not bump the Set number on a duplicate set_start', () => {
    const s = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      phone({ type: 'set_start', exercise: 'squat', t: 1 }),
    ]);
    expect(s.setIndex).toBe(1);
  });

  it('tracks pause/resume and end_session controls', () => {
    const paused = run([phone({ type: 'control', action: 'pause', t: 0 })]);
    expect(paused.paused).toBe(true);
    expect(liveReducer(paused, phone({ type: 'control', action: 'resume', t: 1 })).paused).toBe(false);
    expect(liveReducer(paused, phone({ type: 'control', action: 'end_session', t: 2 })).endRequested).toBe(true);
  });

  it('shows thinking, then the Cue, and remembers the Cue text', () => {
    const thinking = run([coach({ type: 'thinking', setIndex: 1, t: 0 })]);
    expect(thinking.coach).toEqual({ status: 'thinking', setIndex: 1 });
    const cue = liveReducer(thinking, coach({ type: 'cue', text: 'Sit deeper.', audioUrl: 'https://a/b.mp3', setIndex: 1, t: 1 }));
    expect(cue.coach).toMatchObject({ status: 'cue', text: 'Sit deeper.', audioUrl: 'https://a/b.mp3' });
    expect(cue.lastCueText).toBe('Sit deeper.');
  });

  it('keeps the Cue on screen until the next Set starts or it is dismissed', () => {
    const cue = run([coach({ type: 'cue', text: 'Nice.', setIndex: 1, t: 1 }), phone(setEnd(1, 8, 90))]);
    expect(cue.coach.status).toBe('cue');
    expect(liveReducer(cue, phone({ type: 'set_start', exercise: 'squat', t: 5 })).coach.status).toBe('none');
    expect(liveReducer(cue, { kind: 'dismiss_cue' }).coach.status).toBe('none');
    expect(liveReducer(cue, { kind: 'dismiss_cue' }).lastCueText).toBe('Nice.');
  });

  it('turns an unanswered thinking state into quiet on timeout, but ignores a stray timeout', () => {
    const thinking = run([coach({ type: 'thinking', setIndex: 2, t: 0 })]);
    expect(liveReducer(thinking, { kind: 'coach_timeout' }).coach).toEqual({ status: 'quiet', setIndex: 2 });
    const cue = run([coach({ type: 'cue', text: 'x', setIndex: 1, t: 0 })]);
    expect(liveReducer(cue, { kind: 'coach_timeout' })).toBe(cue);
  });

  it('does not mutate the previous state', () => {
    const before = run([phone({ type: 'set_start', exercise: 'squat', t: 0 })]);
    const snapshot = JSON.stringify(before);
    liveReducer(before, phone(rep(1, 90)));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('presence', () => {
  it('tracks whether a person is in frame and counts as a phone signal', () => {
    const s = run([phone({ type: 'presence', person: false, t: 1 })]);
    expect(s.hasPhone).toBe(true);
    expect(s.personPresent).toBe(false);
    expect(liveReducer(s, phone({ type: 'presence', person: true, t: 2 })).personPresent).toBe(true);
  });
  it('is unknown until the first presence event', () => {
    expect(initialLiveState.personPresent).toBeNull();
  });
});

describe('late Coach messages', () => {
  const cue = (setIndex: number): CoachMessage => ({ type: 'cue', text: 'Nice', setIndex, t: 1 });
  const thinking = (setIndex: number): CoachMessage => ({ type: 'thinking', setIndex, t: 1 });

  it('drops a Cue or thinking for an earlier Set so it cannot play over Set 2', () => {
    const inSet2 = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      phone(setEnd(1, 8, 84)),
      phone({ type: 'set_start', exercise: 'squat', t: 1 }),
    ]);
    expect(inSet2.setIndex).toBe(2);
    expect(liveReducer(inSet2, coach(cue(1)))).toBe(inSet2);
    expect(liveReducer(inSet2, coach(thinking(1)))).toBe(inSet2);
    expect(liveReducer(inSet2, coach(cue(1))).lastCueText).toBeNull();
  });

  it('still accepts a Cue for the Set that just ended, even if it beats the set_end event', () => {
    const inSet1 = run([phone({ type: 'set_start', exercise: 'squat', t: 0 })]);
    expect(liveReducer(inSet1, coach(thinking(1))).coach.status).toBe('thinking');
    expect(liveReducer(inSet1, coach(cue(1))).coach.status).toBe('cue');
  });

  it('accepts a Cue for a later Set than the TV has seen', () => {
    expect(liveReducer(initialLiveState, coach(cue(3))).coach.status).toBe('cue');
  });
});

describe('duplicate set_start', () => {
  it('is ignored while the same Set is already running, keeping its Reps and scores', () => {
    const s = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      phone(rep(1, 100)),
      phone(rep(2, 70)),
      phone({ type: 'set_start', exercise: 'squat', t: 5 }),
    ]);
    expect(s.reps).toBe(2);
    expect(s.repScores).toEqual([100, 70]);
    expect(s.lastRep?.index).toBe(2);
    expect(s.setIndex).toBe(1);
  });

  it('does not dismiss a Cue either', () => {
    const s = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      coach({ type: 'thinking', setIndex: 1, t: 1 }),
      phone({ type: 'set_start', exercise: 'squat', t: 2 }),
    ]);
    expect(s.coach.status).toBe('thinking');
  });

  it('a different Exercise while in a Set still starts fresh', () => {
    const s = run([
      phone({ type: 'set_start', exercise: 'squat', t: 0 }),
      phone(rep(1, 100)),
      phone({ type: 'set_start', exercise: 'jumping_jack', t: 5 }),
    ]);
    expect(s.exercise).toBe('jumping_jack');
    expect(s.reps).toBe(0);
  });
});

describe('setRecapLine', () => {
  it('formats the thinking-card recap', () => {
    expect(setRecapLine({ setIndex: 2, set: { exercise: 'squat', reps: 8, score: 84, faults: {}, durationMs: 1 } })).toBe(
      'Set 2: 8 Reps, Form Score 84',
    );
    expect(setRecapLine(undefined)).toBeNull();
  });
});
