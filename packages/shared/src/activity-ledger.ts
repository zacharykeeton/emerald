import type { ActivitySession, ActivityTotals, ActivityTotalsPart } from './activity.ts';
import { activityStats, drawnSessions, monthBounds, monthKey } from './activity-model.ts';
import { underFolder } from './folders.ts';

// The ledger of the hook log's dropped generations (M9 fix 1188): when a
// rotation drops a generation past the log's budget, the daemon folds it
// first and keeps each folder's figures per local month here, so the
// Statistics tab still counts a project's whole life once its oldest
// lines are gone. A month carries the price, the requests, the tokens and
// the agent time; no commits or merges, which are credited from session
// records the old months no longer have. Pure, so the daemon and its
// tests share one fold.

export type LedgerMonth = Pick<ActivityTotalsPart, 'requests' | 'up' | 'fresh' | 'cacheWrite' | 'cached' | 'down' | 'usd' | 'estimated' | 'agentMs'>;

// One folder pair's months: a place is the rows sharing a cwd and a groupCwd.
export interface LedgerPlace {
  cwd: string | null;
  groupCwd: string | null;
  firstAt: number | null;
  months: Record<string, LedgerMonth>;
}

// One dropped generation: its name and size when dropped, the first and
// last line it held (the key a drop interrupted after its ledger write is
// known by, since the name shifts at the next rotation), every row's
// price per month, and the placed rows' months.
export interface LedgerDrop {
  name: string;
  bytes: number;
  droppedAt: number;
  from: number;
  to: number;
  allUsd: Record<string, number>;
  places: LedgerPlace[];
}

export interface Ledger {
  version: 1;
  drops: LedgerDrop[];
}

const monthOf = (rows: readonly ActivitySession[], from: number, to: number): LedgerMonth => {
  const st = activityStats(rows, from, to);
  return { requests: st.requests, up: st.up, fresh: st.fresh, cacheWrite: st.cacheWrite, cached: st.cached, down: st.down, usd: st.usd, estimated: st.estimated, agentMs: st.agentMs };
};

const isEmpty = (m: LedgerMonth): boolean => m.requests === 0 && m.up === 0 && m.down === 0 && m.usd === 0 && m.agentMs === 0;

// The local months from `from` to `to` (inclusive), each cut to [from, to],
// the same clip activityTotals applies, so a request counts in the month of
// its own `at` and a span crossing midnight on the 1st is cut there.
function monthWindows(from: number, to: number): Array<{ key: string; from: number; to: number }> {
  const out: Array<{ key: string; from: number; to: number }> = [];
  let key = monthKey(from);
  const last = monthKey(to);
  while (key <= last) {
    const bounds = monthBounds(key)!;
    out.push({ key, from: Math.max(bounds.from, from), to: Math.min(bounds.to, to + 1) });
    key = monthKey(bounds.to);
  }
  return out;
}

export function ledgerDrop(rows: readonly ActivitySession[], from: number, to: number, meta: { name: string; bytes: number; droppedAt: number }): LedgerDrop {
  const windows = monthWindows(from, to);
  const allUsd: Record<string, number> = {};
  for (const w of windows) {
    const usd = activityStats(rows, w.from, w.to).usd;
    if (usd !== 0) allUsd[w.key] = usd;
  }
  const byPlace = new Map<string, { cwd: string | null; groupCwd: string | null; rows: ActivitySession[] }>();
  for (const row of rows) {
    if (row.cwd === null && row.groupCwd === null) continue;
    const key = `${row.cwd ?? ''}\0${row.groupCwd ?? ''}`;
    let place = byPlace.get(key);
    if (place === undefined) {
      place = { cwd: row.cwd, groupCwd: row.groupCwd, rows: [] };
      byPlace.set(key, place);
    }
    place.rows.push(row);
  }
  const places: LedgerPlace[] = [];
  for (const place of byPlace.values()) {
    const months: Record<string, LedgerMonth> = {};
    for (const w of windows) {
      const m = monthOf(place.rows, w.from, w.to);
      if (!isEmpty(m)) months[w.key] = m;
    }
    let firstAt: number | null = null;
    for (const s of drawnSessions(place.rows)) {
      for (const at of [s.spans[0]?.from, s.requests?.[0]?.at]) {
        if (at !== undefined && (firstAt === null || at < firstAt)) firstAt = at;
      }
    }
    places.push({ cwd: place.cwd, groupCwd: place.groupCwd, firstAt, months });
  }
  return { name: meta.name, bytes: meta.bytes, droppedAt: meta.droppedAt, from, to, allUsd, places };
}

// The drops a totals answer adds: those whose lines the log in memory no
// longer holds (to before heldFrom, the log's earliest line), so a drop
// whose daemon still holds its lines, or a generation copied back from a
// backup, is never counted twice. With `from` set, only a drop wholly
// inside the window, since a ledger month cannot be cut. Oldest first.
export function heldDrops(ledger: Ledger | null, from: number | null, to: number, heldFrom: number | null): LedgerDrop[] {
  if (ledger === null) return [];
  return ledger.drops
    .filter((d) => heldFrom === null || d.to < heldFrom)
    .filter((d) => from === null || (d.from >= from && d.to < to))
    .sort((a, b) => a.from - b.from);
}

const placeIn = (place: LedgerPlace, folder: string): boolean => (place.groupCwd !== null && underFolder(place.groupCwd, folder)) || (place.cwd !== null && underFolder(place.cwd, folder));

const addMonth = (part: ActivityTotalsPart, m: LedgerMonth): void => {
  part.requests += m.requests;
  part.up += m.up;
  part.fresh += m.fresh;
  part.cacheWrite += m.cacheWrite;
  part.cached += m.cached;
  part.down += m.down;
  part.usd += m.usd;
  part.agentMs += m.agentMs;
  part.estimated = part.estimated || m.estimated;
};

// The totals with the held drops' months added, in a copy: each place
// under any of the folders counts once, its months added to the parts of
// the same key and to the total, every row's price to allUsd, and the
// earlier firstAt kept. A month with no part in the answer is skipped.
export function addLedger(totals: ActivityTotals, drops: readonly LedgerDrop[], folders: readonly string[]): ActivityTotals {
  if (drops.length === 0) return totals;
  const total = { ...totals.total };
  const months = totals.months.map((m) => ({ ...m }));
  const byMonth = new Map(months.map((m) => [m.month, m]));
  let firstAt = totals.firstAt;
  for (const drop of drops) {
    for (const place of drop.places) {
      if (!folders.some((f) => placeIn(place, f))) continue;
      let counted = false;
      for (const [key, m] of Object.entries(place.months)) {
        const part = byMonth.get(key);
        if (part === undefined) continue;
        addMonth(part, m);
        addMonth(total, m);
        counted = true;
      }
      if (counted && place.firstAt !== null && (firstAt === null || place.firstAt < firstAt)) firstAt = place.firstAt;
    }
    for (const [key, usd] of Object.entries(drop.allUsd)) {
      const part = byMonth.get(key);
      if (part === undefined) continue;
      part.allUsd += usd;
      total.allUsd += usd;
    }
  }
  return { ...totals, total, months, firstAt };
}
