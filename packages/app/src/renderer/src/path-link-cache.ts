// M9 fix 425: the path link's hover stats the same token again on every
// pointer entry, an IPC round trip each time; this is the map from a
// resolved path to its last answer with the time it was read, read
// before the IPC while under five seconds old and written after it. No
// size cap: a pane's hovered paths in one session are few. The clock is
// injected so the window can be tested without a wall clock.
export const STAT_CACHE_MS = 5000;

export interface StatCache<T> {
  get(path: string): T | undefined;
  set(path: string, result: T): void;
}

export function createStatCache<T>(now: () => number = Date.now): StatCache<T> {
  const map = new Map<string, { at: number; result: T }>();
  return {
    get(path) {
      const entry = map.get(path);
      if (entry === undefined) return undefined;
      if (now() - entry.at >= STAT_CACHE_MS) return undefined;
      return entry.result;
    },
    set(path, result) {
      map.set(path, { at: now(), result });
    },
  };
}
