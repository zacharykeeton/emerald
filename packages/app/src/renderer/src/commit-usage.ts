import { useSyncExternalStore } from 'react';
import type { UsageMessage } from '@emerald/shared';

// The conversations' requests for the commit card and the rows' dollars
// cell (M9 fix 252), one list per conversation id as the main process
// reads them off the transcripts (history.ts readUsage). A view that
// draws a session's commits asks for its conversations; the ask names
// the stamp the store holds so an unchanged set of files costs a stat
// each and no list over the bridge, and a conversation no transcript
// names is kept as null so the card can say the price is not known
// without asking on every hover. The lists are read through
// useConversationUsage and sliced per commit by the pure model; which
// asks are in flight is published beside them, so a card opened while
// its conversation is being read again shows nothing rather than a
// stale absence.
//
// The store publishes on a change, once per tick (M9 fix 352): the
// graph re-asks every conversation its records name whenever its
// commits change, a hundred and more on a long-lived home, and each
// ask used to publish twice, at its start and at its landing, every
// publish a new lists map and a full render of the rail's rows. Now the
// asks of one tick publish once through a microtask, the lists map
// keeps its identity while no held entry changed (a reply that says the
// stamp is unchanged, or null for a conversation held as null already),
// and the landings, which arrive one IPC reply at a time, coalesce
// their `asking` updates on a short timer; a landing that did change a
// list publishes at once. The counters are on the page as
// window.emeraldUsageStats so a script can read what a poll cost.

interface Held {
  stamp: string;
  messages: UsageMessage[];
}

export interface UsageStore {
  lists: ReadonlyMap<string, UsageMessage[] | null>;
  asking: ReadonlySet<string>;
}

export interface UsageStats {
  asks: number;
  publishes: number;
}

// How long a landing that changed no list waits for the others of its
// burst before the `asking` set is published.
const ASKING_SETTLE_MS = 100;

export const usageStats: UsageStats = { asks: 0, publishes: 0 };

let store: UsageStore = { lists: new Map(), asking: new Set() };
const held = new Map<string, Held | null>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
// Whether a held entry changed since the last publish, so the next one
// builds a new lists map; otherwise the old map object is kept.
let dirty = false;
let microtaskQueued = false;
let settleTimer: ReturnType<typeof setTimeout> | null = null;

function publish(): void {
  microtaskQueued = false;
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  let lists = store.lists;
  if (dirty) {
    const next = new Map<string, UsageMessage[] | null>();
    for (const [id, h] of held) next.set(id, h === null ? null : h.messages);
    lists = next;
    dirty = false;
  }
  store = { lists, asking: new Set(inFlight) };
  usageStats.publishes += 1;
  for (const l of listeners) l();
}

// One publish for every ask and changed landing of the current tick.
function publishSoon(): void {
  if (microtaskQueued) return;
  microtaskQueued = true;
  queueMicrotask(publish);
}

// One publish for a burst of landings that changed nothing but the
// `asking` set; a publish that comes sooner for another reason covers
// it and clears the timer.
function publishSettled(): void {
  if (microtaskQueued || settleTimer !== null) return;
  settleTimer = setTimeout(() => {
    settleTimer = null;
    publish();
  }, ASKING_SETTLE_MS);
}

// Ask the main process for the conversation's requests, keeping what
// the store has when the files have not changed. One ask per id at a
// time; an ask while one is in flight is dropped, since the answer on
// its way is read against the same files.
export function askUsage(conversation: string): void {
  if (inFlight.has(conversation)) return;
  inFlight.add(conversation);
  usageStats.asks += 1;
  publishSoon();
  const known = held.get(conversation)?.stamp ?? null;
  window.emerald.history
    .usage(conversation, known)
    .then((res) => {
      if (res === null) {
        if (held.get(conversation) !== null) {
          held.set(conversation, null);
          dirty = true;
        }
      } else if (res.messages !== null) {
        held.set(conversation, { stamp: res.stamp, messages: res.messages });
        dirty = true;
      }
    })
    .catch((err: unknown) => console.warn('[emerald] history usage failed', err))
    .finally(() => {
      inFlight.delete(conversation);
      if (dirty) publishSoon();
      else publishSettled();
    });
}

// The event stamp each conversation was last asked at through the live
// ask below.
const liveAt = new Map<string, number | null>();

// The cards' ask (M9 fix 401). The rows key their one-shot ask on the
// records' commit counts and span conversations (fix 352), which do not
// move while a session works, so a card opened on a working session
// asked once at its mount and then priced every later render on that
// first answer: the cache-write split it read went stale under it and
// the figure sat still while the session spent. This asks again
// whenever the record's own lastEventAt moves, which a push does on
// every hook, and asks nothing at all while the session is quiet. A
// burst of hooks needs no throttle of its own: askUsage drops an ask
// while one is in flight, and the one that does go out costs a stat per
// file whenever the transcript has not grown. The rows' key is
// deliberately left alone, so what a poll costs is unchanged.
export function askUsageLive(conversation: string, lastEventAt: number | null): void {
  if (liveAt.has(conversation) && liveAt.get(conversation) === lastEventAt) return;
  liveAt.set(conversation, lastEventAt);
  askUsage(conversation);
}

export function subscribeUsage(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function readUsage(): UsageStore {
  return store;
}

// The lists by conversation id: a list once read, null for a
// conversation no transcript names, absent while never asked; and the
// ids an ask is out for.
export function useConversationUsage(): UsageStore {
  return useSyncExternalStore(subscribeUsage, readUsage);
}

// For tests: forget everything held.
export function resetUsage(): void {
  held.clear();
  inFlight.clear();
  liveAt.clear();
  dirty = false;
  microtaskQueued = false;
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  store = { lists: new Map(), asking: new Set() };
  usageStats.asks = 0;
  usageStats.publishes = 0;
}

// Reachable from a verify script, like the emeraldFeed tag (terminal-feed.ts).
if (typeof window !== 'undefined') (window as Window & { emeraldUsageStats?: UsageStats }).emeraldUsageStats = usageStats;
