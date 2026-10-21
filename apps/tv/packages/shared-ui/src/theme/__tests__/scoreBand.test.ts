import { color } from '../tokens';
import { scoreBand, scoreColor, scoreLabel } from '../scoreBand';

describe('scoreBand', () => {
  it.each([
    [100, 'good'],
    [85, 'good'],
    [84, 'ok'],
    [70, 'ok'],
    [60, 'ok'],
    [59, 'poor'],
    [0, 'poor'],
  ] as const)('maps %i to %s', (score, band) => {
    expect(scoreBand(score)).toBe(band);
  });

  it('treats one shallow_depth Fault (score 70) as decent and two Faults (45) as slipping', () => {
    expect(scoreLabel(70)).toBe('Decent form');
    expect(scoreLabel(45)).toBe('Form slipping');
  });

  it('colors each band with its token', () => {
    expect(scoreColor(90)).toBe(color.scoreGood);
    expect(scoreColor(75)).toBe(color.scoreOk);
    expect(scoreColor(10)).toBe(color.scorePoor);
  });

  it('labels the good band', () => {
    expect(scoreLabel(85)).toBe('Strong form');
  });
});
