export type IdleStatus = { kind: 'none' } | { kind: 'warn'; secondsLeft: number } | { kind: 'end' };

export interface IdleInput {
  /** Reps counted so far in this Set; the timer only runs once there is at least one. */
  reps: number;
  /** Time of the last rep, or of the last "Keep going" tap. */
  lastActivityMs: number;
  nowMs: number;
  /** Idle time after which the Set ends (CONTEXT.md: 8 s). */
  idleMs: number;
  /** Length of the visible 3-2-1 warning at the end of the idle period. */
  warnMs: number;
}

/** Pure auto-end decision: call it from a ~250 ms tick with the current clock. */
export function idleStatus({ reps, lastActivityMs, nowMs, idleMs, warnMs }: IdleInput): IdleStatus {
  if (reps < 1) return { kind: 'none' };
  const idle = nowMs - lastActivityMs;
  if (idle >= idleMs) return { kind: 'end' };
  if (idle >= idleMs - warnMs) return { kind: 'warn', secondsLeft: Math.ceil((idleMs - idle) / 1000) };
  return { kind: 'none' };
}
