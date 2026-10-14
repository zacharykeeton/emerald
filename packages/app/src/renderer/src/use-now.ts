import { useSyncExternalStore } from 'react';

// One clock for every age on screen, ticking once a second, so a row's
// "4m" and the counter laid over its pane (M9 fix 247) move on the same
// beat and read one figure: a clock per hook instance ticked on its own
// phase, and the row read 1s while the pane read 2s. One interval runs
// while anything subscribes, every subscriber is told in the same tick,
// and React batches those into one render. `active` false subscribes
// to nothing and answers the last tick, so forty quiet panes do not
// re-render each second for nothing.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of listeners) l();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const noSubscribe = () => () => {};
const read = () => now;

export function useNow(active = true): number {
  return useSyncExternalStore(active ? subscribe : noSubscribe, read);
}
