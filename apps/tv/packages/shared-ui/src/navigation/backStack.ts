import { useEffect, useRef } from 'react';

type BackHandlerFn = () => void;

const stack: BackHandlerFn[] = [];

/** Calls the most recently registered handler. Returns false when nobody handled it (let the OS exit the app). */
export function dispatchBack(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}

export function backStackDepth(): number {
  return stack.length;
}

/**
 * Registers `handler` for the Back key while `active` and mounted. Only the newest registration runs
 * (so a dialog opened over a screen gets Back first). The handler is read through a ref, so changing
 * its identity does not reorder the stack.
 */
export function useBackHandler(handler: BackHandlerFn, active = true): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!active) return undefined;
    const entry: BackHandlerFn = () => latest.current();
    stack.push(entry);
    return () => {
      const index = stack.lastIndexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active]);
}
