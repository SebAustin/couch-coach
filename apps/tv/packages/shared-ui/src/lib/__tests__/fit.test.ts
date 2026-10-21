import {
  glyphCount,
  initialOf,
  memberLayout,
  recapWindow,
  repFontSize,
  textTier,
  visibleFaults,
} from '../fit';

describe('textTier', () => {
  it('steps down as text gets longer', () => {
    expect(textTier(0, 200, 300)).toBe('large');
    expect(textTier(200, 200, 300)).toBe('large');
    expect(textTier(201, 200, 300)).toBe('medium');
    expect(textTier(300, 200, 300)).toBe('medium');
    expect(textTier(600, 200, 300)).toBe('small');
  });
});

describe('initialOf', () => {
  it('upper-cases the first letter', () => {
    expect(initialOf('maya')).toBe('M');
    expect(initialOf('  jon')).toBe('J');
  });
  it('keeps a whole emoji and non-Latin letters, never a lone surrogate', () => {
    expect(initialOf('\u{1F3CB}\u{FE0F} Lifter')).toBe('\u{1F3CB}');
    expect(initialOf('王小明')).toBe('王');
    expect(initialOf('العربية')).toBe('ا');
  });
  it('keeps one letter of a multi-letter upper-case ("ß" becomes "SS")', () => {
    expect(initialOf('ßeta')).toBe('S');
  });
  it('falls back for an empty name', () => {
    expect(initialOf('   ')).toBe('?');
  });
});

describe('glyphCount', () => {
  it('counts an emoji once', () => {
    expect(glyphCount('ab\u{1F3CB}')).toBe(3);
  });
});

describe('repFontSize', () => {
  it('keeps the spec size for 0 to 99 Reps and steps down for 3 and 4 digits', () => {
    expect(repFontSize(0)).toBe(220);
    expect(repFontSize(99)).toBe(220);
    expect(repFontSize(100)).toBe(170);
    expect(repFontSize(999)).toBe(170);
    expect(repFontSize(1000)).toBe(130);
  });
});

describe('visibleFaults', () => {
  it('shows up to the maximum as they are', () => {
    expect(visibleFaults(['a', 'b', 'c'], 3)).toEqual({ shown: ['a', 'b', 'c'], hidden: 0 });
  });
  it('folds the overflow into the last row', () => {
    expect(visibleFaults(['a', 'b', 'c', 'd', 'e', 'f'], 3)).toEqual({ shown: ['a', 'b'], hidden: 4 });
    expect(visibleFaults(['a', 'b', 'c', 'd'], 3)).toEqual({ shown: ['a', 'b'], hidden: 2 });
  });
});

describe('memberLayout', () => {
  it('uses full tiles up to 7 Members', () => {
    expect(memberLayout(0)).toEqual({ compact: false, shown: 0, hidden: 0 });
    expect(memberLayout(7)).toEqual({ compact: false, shown: 7, hidden: 0 });
  });
  it('goes compact from 8 and reports Members that still do not fit', () => {
    expect(memberLayout(8)).toEqual({ compact: true, shown: 8, hidden: 0 });
    expect(memberLayout(11)).toEqual({ compact: true, shown: 11, hidden: 0 });
    expect(memberLayout(15)).toEqual({ compact: true, shown: 11, hidden: 4 });
  });
});

describe('recapWindow', () => {
  const sets = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  it('shows up to 5 Sets as two-line rows', () => {
    expect(recapWindow(sets(5))).toEqual({ rows: sets(5), earlier: 0, compact: false });
  });
  it('compacts 6 to 10 Sets', () => {
    expect(recapWindow(sets(10))).toEqual({ rows: sets(10), earlier: 0, compact: true });
  });
  it('keeps the latest 9 and counts the rest', () => {
    const window = recapWindow(sets(14));
    expect(window.rows).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(window.earlier).toBe(5);
    expect(window.compact).toBe(true);
  });
});
