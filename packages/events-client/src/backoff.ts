/**
 * Jittered exponential backoff ("equal jitter"): the delay is uniformly spread
 * over [cap/2, cap] where cap = min(max, base * 2^attempt). `attempt` is 0 for
 * the first retry. The result never exceeds `max`.
 */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30));
  return cap * (0.5 + 0.5 * random());
}
