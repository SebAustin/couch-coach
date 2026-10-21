const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** "1:48" for 108_000 ms; never negative. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Member tile caption: "New here", "Last seen today", "Last seen yesterday", "Last seen 3 days ago". */
export function lastSeenLabel(lastSeenAt: number | undefined, now: number): string {
  if (lastSeenAt === undefined) return 'New here';
  const elapsed = Math.max(0, now - lastSeenAt);
  if (elapsed < DAY_MS) return elapsed < 5 * MINUTE_MS ? 'Last seen just now' : 'Last seen today';
  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return 'Last seen yesterday';
  if (days < 30) return `Last seen ${days} days ago`;
  return 'Last seen a while ago';
}

/** Index of the Member with the newest `lastSeenAt`, or -1 when none has one. */
export function newestSeenIndex(members: readonly { lastSeenAt?: number }[]): number {
  let best = -1;
  let bestAt = -Infinity;
  members.forEach((member, index) => {
    if (member.lastSeenAt !== undefined && member.lastSeenAt > bestAt) {
      best = index;
      bestAt = member.lastSeenAt;
    }
  });
  return best;
}

/** `expiresAt` is documented as a timestamp; accept epoch seconds or milliseconds. */
export function expiresAtMs(expiresAt: number): number {
  return expiresAt < 1e11 ? expiresAt * 1000 : expiresAt;
}

const HOUR_MS = 3_600_000;
/** Above this, a countdown is noise: say how long the code is valid instead. */
export const COUNTDOWN_BELOW_MS = 10 * MINUTE_MS;

/**
 * Pairing code expiry copy: "Code valid for 2 hours" / "Code valid for 45 minutes" above 10 minutes,
 * "Code expires in 9:58" (m:ss) at or under 10 minutes.
 */
export function expiryLabel(remainingMs: number): string {
  if (remainingMs > COUNTDOWN_BELOW_MS) {
    if (remainingMs >= 90 * MINUTE_MS) {
      const hours = Math.round(remainingMs / HOUR_MS);
      return `Code valid for ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }
    return `Code valid for ${Math.round(remainingMs / MINUTE_MS)} minutes`;
  }
  return `Code expires in ${formatCountdown(remainingMs)}`;
}
