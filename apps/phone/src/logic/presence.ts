const DEFAULT_WINDOW_MS = 1_500;

export interface PresenceTracker {
  /** Record that a pose was detected at `tMs`. */
  seen(tMs: number): void;
  /** True when a pose was seen within the window ending at `nowMs`. */
  person(nowMs: number): boolean;
}

/** Feeds the `presence` heartbeat: "someone is in frame" vs "the camera sees nobody". */
export function createPresenceTracker({ windowMs = DEFAULT_WINDOW_MS }: { windowMs?: number } = {}): PresenceTracker {
  let lastSeen = Number.NEGATIVE_INFINITY;
  return {
    seen: (tMs) => {
      lastSeen = tMs;
    },
    person: (nowMs) => nowMs - lastSeen < windowMs,
  };
}
