import { useRef, useSyncExternalStore } from 'react';
import type { SessionInfo } from '@emerald/shared';
import { runningShells } from './session-mark-model.ts';

// The output rate of each session the daemon has pushed one for (M41):
// the bytes of its last few windows, oldest first, for the state meter.
// Its own store since M9 fix 354: a `pty.rate` push lands every second
// for every session that writes, and while it sat on the main store's
// State every one of those re-rendered the window (every useStore()
// reader, the sidebar and the rail among them) for a tooltip and a
// caret. Here a row or pane subscribes to its one session's samples and
// the headings to the set of running shells, so a push moves only the
// mark it is about. The daemon keeps and saves nothing of the rates; a
// daemon before level 14 never sends any and the map stays empty.

let rates: ReadonlyMap<string, number[]> = new Map();
const listeners = new Set<() => void>();

function publish(): void {
  for (const l of listeners) l();
}

// The store's test subscribes by hand to count what a push reaches.
export function subscribeRates(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getRates(): ReadonlyMap<string, number[]> {
  return rates;
}

// The main store's onPush hands the push here; a resync clears the map
// as it always did, since the pushes start over after the subscribe.
export function setRate(sessionId: string, samples: number[]): void {
  const next = new Map(rates);
  next.set(sessionId, samples);
  rates = next;
  publish();
}

export function dropRate(sessionId: string): void {
  if (!rates.has(sessionId)) return;
  const next = new Map(rates);
  next.delete(sessionId);
  rates = next;
  publish();
}

export function resetRates(): void {
  if (rates.size === 0) return;
  rates = new Map();
  publish();
}

// One session's samples, undefined until a push has arrived for it.
// The daemon sends a fresh array each push, so the reader re-renders on
// its own session's pushes and on nobody else's.
export function useRates(sessionId: string | null | undefined): number[] | undefined {
  return useSyncExternalStore(subscribeRates, () => (sessionId === null || sessionId === undefined ? undefined : rates.get(sessionId)));
}

// The shell sessions running a command, for the headings' units and the
// title bar's (M9 fix 88), as one Set that keeps its identity while its
// members are the same, so the sidebar and the title bar render on a
// shell starting or stopping and not on every window of its output.
// Takes the map rather than an iterator, since React reads the snapshot
// more than once per render and an iterator is spent by the first read.
export function useRunningShells(sessions: ReadonlyMap<string, SessionInfo>): ReadonlySet<string> {
  const held = useRef<ReadonlySet<string>>(new Set());
  return useSyncExternalStore(subscribeRates, () => {
    const next = runningShellsHeld(held.current, rates, sessions);
    held.current = next;
    return next;
  });
}

// The held Set when the running shells are the same members, else the
// new one; exported for the store's test.
export function runningShellsHeld(held: ReadonlySet<string>, rates: ReadonlyMap<string, readonly number[]>, sessions: ReadonlyMap<string, SessionInfo>): ReadonlySet<string> {
  const next = runningShells(rates, sessions.values());
  return sameMembers(held, next) ? held : next;
}

function sameMembers(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
