import { useEffect, useSyncExternalStore } from 'react';
import type { TranscriptCost } from '../../preload/api.ts';
import { sameTranscriptCost } from './history-model.ts';

// The price of a past conversation for its Sessions tab row (M9 fix
// 256), as the main process estimates it off the transcript's requests
// (history.ts readTranscriptCost). Each row asks on mount and again
// when its transcript's last write moves; the main process answers a
// re-ask from its cache when the file's size has not changed, so the
// asks cost a stat each. A few run at a time, since the first show of
// the tab is every row asking at once and each first answer is a read
// of the whole file. An answer that says what the held one says keeps
// the key and publishes nothing (M9 fix 354), since every row of the
// tab reads the map.

const AT_ONCE = 4;

interface Held {
  key: number | null;
  cost: TranscriptCost | null;
}

let costs: ReadonlyMap<string, TranscriptCost | null> = new Map();
const held = new Map<string, Held>();
const queue: Array<{ path: string; key: number | null }> = [];
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function publish(): void {
  const next = new Map<string, TranscriptCost | null>();
  for (const [p, h] of held) next.set(p, h.cost);
  costs = next;
  for (const l of listeners) l();
}

function pump(): void {
  while (inFlight.size < AT_ONCE && queue.length > 0) {
    const { path, key } = queue.shift()!;
    if (inFlight.has(path)) continue;
    inFlight.add(path);
    window.emerald.history
      .cost(path)
      .then((cost) => {
        const same = sameTranscriptCost(held.get(path)?.cost, cost);
        held.set(path, { key, cost });
        if (!same) publish();
      })
      .catch((err: unknown) => console.warn('[emerald] transcript cost failed', err))
      .finally(() => {
        inFlight.delete(path);
        pump();
      });
  }
}

function ask(path: string, key: number | null): void {
  const have = held.get(path);
  if (have !== undefined && have.key === key) return;
  if (queue.some((q) => q.path === path)) return;
  queue.push({ path, key });
  pump();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// The row's price: undefined until the answer lands, null when there is
// nothing to price (no requests, the file gone or over the cap), else
// the estimate and its counts. `key` is the transcript's last write
// time, which moves when the file grows.
export function useTranscriptCost(path: string, key: number | null): TranscriptCost | null | undefined {
  const all = useSyncExternalStore(subscribe, () => costs);
  useEffect(() => ask(path, key), [path, key]);
  return all.get(path);
}

// For tests: forget everything held.
export function resetTranscriptCosts(): void {
  held.clear();
  queue.length = 0;
  inFlight.clear();
  costs = new Map();
}
