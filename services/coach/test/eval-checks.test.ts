import { describe, expect, it } from 'vitest';
import { CASES, type EvalCase } from '../eval/cases';
import { checkCue, countSentences, countWords, type CheckName } from '../eval/checks';

const caseById = (id: string): EvalCase => CASES.find((c) => c.id === id)!;
const failed = (c: EvalCase, cue: string, raw = cue): CheckName[] =>
  checkCue(c, raw, cue)
    .filter((r) => !r.pass)
    .map((r) => r.name);

describe('eval checks: the live failures are caught', () => {
  it('flags the "feet staying wider" Cue sent while feet_not_wide was on 8 of 10 reps', () => {
    const cue = 'Great effort Debug! Your feet are staying wider today, but get those arms all the way overhead.';

    expect(failed(caseById('jj-observed-feet-worse'), cue)).toEqual(expect.arrayContaining(['no-fault-contradiction', 'name-policy']));
  });

  it('flags an invented body part on a squat', () => {
    expect(failed(caseById('sq-knees-dominant-nohist'), 'Solid set! Push your knees out and get those elbows a little higher.')).toContain(
      'no-unrelated-body-part',
    );
  });

  it('flags Cues over 35 words or over two sentences', () => {
    const long = `Knees ${'out '.repeat(40)}now.`;
    expect(failed(caseById('sq-knees-dominant-nohist'), long)).toContain('words<=35');
    expect(failed(caseById('sq-knees-dominant-nohist'), 'Good set.', 'Good set. Knees out. Go again.')).toContain('sentences<=2');
  });

  it('flags claimed progress when the trend is worse, and invented history on a first set', () => {
    expect(failed(caseById('sq-depth-worse'), 'Your depth improved, keep sinking those hips lower.')).toContain('no-false-trend');
    expect(failed(caseById('sq-knees-dominant-nohist'), 'Better than last time! Push those knees out.')).toContain('no-false-trend');
  });

  it('flags the baseline misses: "deeper than yesterday" on a worse set, and a shortened name', () => {
    expect(failed(caseById('sq-depth-worse'), 'Hey, you\u2019re going deeper than yesterday, that\u2019s great! Sit into your hips.')).toEqual(
      expect.arrayContaining(['no-fault-contradiction', 'no-false-trend']),
    );
    expect(failed(caseById('sq-heels-every-rep-same'), 'Heels down, Joe. Nice work, Grandpa Joe!')).toContain('name-policy');
    expect(failed(caseById('sq-heels-every-rep-same'), 'Keep those heels flat, Joe.')).not.toContain('name-policy');
    expect(failed(caseById('jj-observed-feet-worse'), 'Land wide, Debug.')).toContain('name-policy');
  });

  it('flags a missing dominant fault area, and a clean set without praise', () => {
    expect(failed(caseById('sq-knees-dominant-nohist'), 'Good work, keep your chest up.')).toContain('dominant-area-or-praise');
    expect(failed(caseById('sq-clean-first'), 'Next set, go a bit faster.')).toContain('dominant-area-or-praise');
  });
});

describe('eval checks: good Cues pass', () => {
  it.each([
    ['jj-observed-feet-worse', 'Good energy! Your feet stayed narrow on most jumps, so land with them wide apart every rep.'],
    ['sq-knees-dominant-nohist', 'Solid start! Your knees caved on 7 of 10 reps, so push them out over your toes.'],
    ['sq-knees-improved', 'Knees caved less than yesterday, nice progress! Keep pushing them out over your toes.'],
    ['sq-clean-first', 'Great set, Sam, every rep was clean!'],
    ['sq-depth-worse', 'Depth slipped this time, Debug. Sit your hips down until your thighs are level with the floor.'],
    ['jj-arms-dominant-squat-hist', 'Good pace! Make sure your arms are all the way overhead on every jump.'],
    ['jj-feet-improved', 'Your feet are landing wider now, nice progress! Reach your arms all the way overhead too.'],
    ['sq-torso-same', 'Stay tall through your chest, like a string pulling you up from the floor.'],
  ])('%s: %s', (id, cue) => {
    expect(failed(caseById(id), cue)).toEqual([]);
  });
});

describe('eval checks: counting', () => {
  it('counts words and sentences the way a listener would', () => {
    expect(countWords('Great set, Sam! Knees out.')).toBe(5);
    expect(countSentences('Great set, Sam! Knees out.')).toBe(2);
    expect(countSentences('One sentence only')).toBe(1);
  });
});
