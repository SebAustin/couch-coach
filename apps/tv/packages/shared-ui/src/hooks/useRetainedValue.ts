import { useEffect, useState } from 'react';

/**
 * Keeps showing the last non-null `value` for `holdMs` after it becomes null, so a component can play its exit
 * animation before it unmounts. `leaving` is true during that window.
 */
export function useRetainedValue<T>(value: T | null, holdMs: number): { value: T | null; leaving: boolean } {
  const [held, setHeld] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) {
      setHeld(value);
      return undefined;
    }
    const id = setTimeout(() => setHeld(null), holdMs);
    return () => clearTimeout(id);
  }, [value, holdMs]);
  const shown = value ?? held;
  return { value: shown, leaving: value === null && shown !== null };
}
