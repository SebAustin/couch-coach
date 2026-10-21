import { buildRecap } from '../recap';
import { initialLiveState, type LiveState } from '../liveState';

const withSets = (overrides: Partial<LiveState>): LiveState => ({ ...initialLiveState, ...overrides });

describe('buildRecap', () => {
  it('is empty when no Sets were seen', () => {
    const recap = buildRecap(initialLiveState);
    expect(recap).toMatchObject({ setCount: 0, repCount: 0, score: 0, coachNote: null });
  });

  it('summarises Sets, weights the Form Score by Reps and names the top Fault', () => {
    const recap = buildRecap(
      withSets({
        lastCueText: 'Keep your knees out.',
        sets: [
          { setIndex: 1, set: { exercise: 'squat', reps: 8, score: 84, faults: { knees_caving: 1 }, durationMs: 1 } },
          { setIndex: 2, set: { exercise: 'squat', reps: 8, score: 72, faults: { knees_caving: 3, torso_lean: 1 }, durationMs: 1 } },
          { setIndex: 3, set: { exercise: 'jumping_jack', reps: 8, score: 88, faults: {}, durationMs: 1 } },
        ],
      }),
    );
    expect(recap.setCount).toBe(3);
    expect(recap.repCount).toBe(24);
    expect(recap.score).toBe(81);
    expect(recap.rows[1]!.topFault).toEqual({ id: 'knees_caving', label: 'Knees caving', count: 3 });
    expect(recap.rows[2]!.topFault).toBeNull();
    expect(recap.coachNote).toBe('Keep your knees out.');
  });

  it('includes a Set that was still running when the Session ended', () => {
    const recap = buildRecap(
      withSets({
        inSet: true,
        exercise: 'squat',
        setIndex: 1,
        reps: 3,
        repScores: [100, 70, 70],
        lastRep: { index: 3, score: 70, faults: ['shallow_depth'], at: 0 },
      }),
    );
    expect(recap.setCount).toBe(1);
    expect(recap.rows[0]).toMatchObject({ reps: 3, score: 80 });
    expect(recap.rows[0]!.topFault?.id).toBe('shallow_depth');
  });
});
