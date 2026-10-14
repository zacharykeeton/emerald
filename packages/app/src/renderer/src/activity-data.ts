import { useEffect, useMemo, useRef, useState } from 'react';
import { activityRowKey, dayBounds, dayKey, sessionDebt } from '@emerald/shared';
import type { ActivityRequest, ActivitySession, CappedSpan, DebtKind, SessionDebt } from '@emerald/shared';
import { activitySupported, debtSupported } from './daemon-model.ts';
import { ensureHistoryTitles, nameActivity, needsHistoryTitles, useHistoryTitles } from './history-index.ts';
import { useStore } from './store.ts';

// The daemon's answer to activity.spans for one day (M54), kept fresh:
// asked for on mount, every REFRESH_MS while the day is today, and
// DEBOUNCE_MS after any session change, since a state change is what
// opens or closes a span. A day in the past is asked for once. On a
// daemon older than the request the answer is null and the caller shows
// nothing. A track the daemon cannot name (M57) is named from the
// transcript's own title when the history has been read, and read once
// for that if it has not.
//
// M9 fix 217: each row carries its request points, a few hundred
// kilobytes for a full day, so every ask after the first for one window
// names the last ask's time as requestsSince, the daemon answers the
// points a status line has touched since it, and the answer's rows take
// the earlier points from the rows held, merged by the time the point
// opened (a point updated by a streaming line keeps its time and
// replaces itself).

// Exported for the agents' running spend (M9 fix 277), which beats
// with the activity so the two readings move together.
export const REFRESH_MS = 30_000;
const DEBOUNCE_MS = 2_000;

export interface Activity {
  sessions: ActivitySession[];
  // The account's capped bands inside the window (M9 fix 285); a daemon
  // before level 50 answers none.
  capped: CappedSpan[];
  // How far back the daemon's history reaches (M9 fix 607); null on an
  // empty log and on a daemon before level 59.
  historyFrom: number | null;
  askedAt: number;
}

export function useActivity(day: { from: number; to: number }): Activity | null {
  const { sessions, daemon, connected } = useStore('sessions', 'daemon', 'connected');
  const supported = activitySupported(daemon);
  const [activity, setActivity] = useState<Activity | null>(null);
  const titles = useHistoryTitles();
  const live = Date.now() >= day.from && Date.now() < day.to;
  // One in flight at a time; a change that lands while one is out asks again after it.
  const busy = useRef(false);
  const again = useRef(false);
  // The time of the last answered ask for this window (M9 fix 217), the
  // next ask's requestsSince; null before the first, and again when the
  // window changes.
  const lastAsked = useRef<number | null>(null);
  const fetchNow = useRef<() => void>(() => {});
  fetchNow.current = () => {
    if (!supported || !connected) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    const askedAt = Date.now();
    const since = lastAsked.current;
    window.emerald
      .request('activity.spans', { from: day.from, to: Math.min(day.to, askedAt), ...(since === null ? {} : { requestsSince: since }) })
      .then((res) => {
        lastAsked.current = askedAt;
        setActivity((prev) => ({ sessions: since === null || prev === null ? res.sessions : mergeRequests(prev.sessions, res.sessions), capped: res.capped ?? [], historyFrom: res.historyFrom ?? null, askedAt }));
      })
      .catch((err: unknown) => console.warn('[emerald] activity.spans failed', err))
      .finally(() => {
        busy.current = false;
        if (again.current) {
          again.current = false;
          fetchNow.current();
        }
      });
  };

  useEffect(() => {
    setActivity(null);
    lastAsked.current = null;
    fetchNow.current();
    if (!live) return;
    const timer = setInterval(() => fetchNow.current(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [day.from, day.to, live, supported, connected]);

  // The store's map is replaced on every push, so its identity is the
  // signal; the first render's fetch is the mount effect's.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!live) return;
    const timer = setTimeout(() => fetchNow.current(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sessions, live]);

  const unnamed = activity !== null && needsHistoryTitles(activity.sessions);
  useEffect(() => {
    if (unnamed) ensureHistoryTitles();
  }, [unnamed]);
  const named = useMemo(() => (activity === null ? null : { ...activity, sessions: nameActivity(activity.sessions, titles) }), [activity, titles]);

  return supported ? named : null;
}

// The answer's rows with the held rows' earlier points in front of their
// own (M9 fix 217), by the row's key; a point the answer carries again
// (one a streaming line updated) replaces the held copy. A row the
// answer lacks left the window and goes.
export function mergeRequests(held: readonly ActivitySession[], fresh: readonly ActivitySession[]): ActivitySession[] {
  const before = new Map(held.map((s) => [activityRowKey(s), s.requests ?? []]));
  return fresh.map((s) => {
    const earlier = before.get(activityRowKey(s));
    const own = s.requests ?? [];
    if (earlier === undefined || earlier.length === 0) return own === s.requests ? s : { ...s, requests: own };
    const byAt = new Map<number, ActivityRequest>();
    for (const r of earlier) byAt.set(r.at, r);
    for (const r of own) byAt.set(r.at, r);
    return { ...s, requests: [...byAt.values()].sort((a, b) => a.at - b.at) };
  });
}

// The rows the store says are live now, for the strip's growing ends: a
// session working, keyed by its id, and an agent its parent's team still
// lists as running (M62), keyed as its row is, so a fork out for an hour
// grows between two answers from the daemon like the session would.
export function workingIds(sessions: ReadonlyMap<string, { state: string; team?: ReadonlyArray<{ id: string; outcome: string }> }>): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [id, s] of sessions) {
    if (s.state === 'working') out.add(id);
    for (const m of s.team ?? []) if (m.outcome === 'running') out.add(activityRowKey({ sessionId: id, agentId: m.id }));
  }
  return out;
}

// The sessions the store lists as owed (M9 fix 231), by id, with the
// kind of stretch that grows while they are: needs-input is an asked
// stretch, done an unread one. An agent asks through its parent, so
// agents' keys are never in it.
export function owedIds(sessions: ReadonlyMap<string, { state: string }>): ReadonlyMap<string, DebtKind> {
  const out = new Map<string, DebtKind>();
  for (const [id, s] of sessions) {
    if (s.state === 'needs-input') out.set(id, 'asked');
    else if (s.state === 'done') out.set(id, 'unread');
  }
  return out;
}

// One session's debt today (M9 fix 231), for the lane card: asked once
// when the card opens, since a card is a reading taken at a glance and
// not a view kept fresh. Null until the answer lands, and on a daemon
// whose rows carry no stretches, where the card shows no line rather
// than a zero.
export function useSessionDebt(sessionId: string): SessionDebt | null {
  const { daemon, connected } = useStore('daemon', 'connected');
  const supported = debtSupported(daemon);
  const [debt, setDebt] = useState<SessionDebt | null>(null);
  useEffect(() => {
    setDebt(null);
    if (!supported || !connected) return;
    let gone = false;
    const now = Date.now();
    const day = dayBounds(dayKey(now)) ?? { from: now, to: now };
    window.emerald
      .request('activity.spans', { from: day.from, to: Math.min(day.to, now) })
      .then((res) => {
        if (gone) return;
        const row = res.sessions.find((s) => s.sessionId === sessionId && (s.agentId === null || s.agentId === undefined));
        setDebt(row === undefined ? { debtMs: 0, askedMs: 0, unreadMs: 0, waits: 0 } : sessionDebt(row, day.from, now));
      })
      .catch((err: unknown) => console.warn('[emerald] activity.spans failed', err));
    return () => {
      gone = true;
    };
  }, [sessionId, supported, connected]);
  return debt;
}
