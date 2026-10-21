/**
 * Pure "does it fit?" rules for worst-case data on the 1920x1080 canvas (docs/ux.md, `.interface-design/system.md`).
 * Nothing here imports React Native, so every rule is unit-testable. Character thresholds assume Figtree at the
 * sizes in `theme/tokens.ts` and are deliberately conservative: a wrong guess costs a smaller font, never a clipped control.
 */

export type TextTier = 'large' | 'medium' | 'small';

/** Picks the type tier for free text of `length` characters: up to `largeMax` large, up to `mediumMax` medium, else small. */
export function textTier(length: number, largeMax: number, mediumMax: number): TextTier {
  if (length <= largeMax) return 'large';
  return length <= mediumMax ? 'medium' : 'small';
}

/**
 * First user-visible character of a name for the avatar. Walks code points (so an emoji is not cut into a lone
 * surrogate) and upper-cases it ("ß" upper-cases to "SS": keep only the first letter of that).
 */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  if (!first) return '?';
  const upper = first.toUpperCase();
  return Array.from(upper)[0] ?? first;
}

/** Number of user-visible characters (code points), not UTF-16 units: an emoji counts once. */
export function glyphCount(text: string): number {
  return Array.from(text).length;
}

/** Rep counter font size (design px). 1-2 digits use the spec size; 3 and 4+ digits step down to stay inside the HUD. */
export function repFontSize(reps: number): number {
  const digits = String(Math.max(0, Math.floor(reps))).length;
  if (digits <= 2) return 220;
  return digits === 3 ? 170 : 130;
}

/** At most `max` chip rows: when there are more, the last row becomes "+N more". */
export function visibleFaults<T>(faults: readonly T[], max: number): { shown: T[]; hidden: number } {
  if (faults.length <= max) return { shown: [...faults], hidden: 0 };
  const shown = faults.slice(0, Math.max(0, max - 1));
  return { shown, hidden: faults.length - shown.length };
}

export const MEMBERS_NORMAL_MAX = 7; // 7 Members + "Add member" = 2 rows of 4 full-size tiles
export const MEMBERS_COMPACT_MAX = 11; // 11 Members + "Add member" = 3 rows of 4 compact tiles

export interface MemberLayout {
  /** Compact tiles (3 rows) once the household outgrows two full-size rows. */
  compact: boolean;
  shown: number;
  /** Members that do not fit even compactly (older ones, by last seen). */
  hidden: number;
}

export function memberLayout(count: number): MemberLayout {
  if (count <= MEMBERS_NORMAL_MAX) return { compact: false, shown: count, hidden: 0 };
  const shown = Math.min(count, MEMBERS_COMPACT_MAX);
  return { compact: true, shown, hidden: count - shown };
}

export const RECAP_FULL_ROWS = 5; // two-line rows, 88 high
export const RECAP_COMPACT_ROWS = 10; // one-line rows, 48 high

export interface RecapWindow<T> {
  rows: T[];
  /** Sets older than the rows shown ("+N earlier Sets" takes the last line). */
  earlier: number;
  compact: boolean;
}

/** Which Set rows the Recap can show without overflowing: all up to 5; compact up to 10; else the latest 9 plus a summary line. */
export function recapWindow<T>(rows: readonly T[]): RecapWindow<T> {
  if (rows.length <= RECAP_FULL_ROWS) return { rows: [...rows], earlier: 0, compact: false };
  if (rows.length <= RECAP_COMPACT_ROWS) return { rows: [...rows], earlier: 0, compact: true };
  const kept = RECAP_COMPACT_ROWS - 1;
  return { rows: rows.slice(-kept), earlier: rows.length - kept, compact: true };
}
