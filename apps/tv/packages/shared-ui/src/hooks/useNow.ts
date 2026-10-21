import { useEffect, useState } from 'react';

/** Re-renders every `intervalMs` with the current time (ms). Pass `null` to pause. */
export function useNow(intervalMs: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
