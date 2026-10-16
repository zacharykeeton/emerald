import type { SessionGroup, SessionInfo, SessionState } from '@emerald/shared';
import { EXITED_GROUP } from '@emerald/shared';

// The sidebar's filter chips (M44): every row, the rows that want a
// person, the rows whose turn has finished, or (M9 fix 249) the live
// rows no pane of any tab shows, the orphans Hide and a closed tab
// leave. Pure functions over what groupSessions gives and the set of
// sessions on the panes (sessionsOnPanes), so the headings, the rollups
// and the order setting are untouched: a filter only hides rows, it
// never re-sorts them.

export type SidebarFilter = 'all' | 'needs' | 'done' | 'unshown';

export const SIDEBAR_FILTERS: readonly SidebarFilter[] = ['all', 'needs', 'done', 'unshown'];

export function isSidebarFilter(value: unknown): value is SidebarFilter {
  return value === 'all' || value === 'needs' || value === 'done' || value === 'unshown';
}

// Needs you is the pair of states a person has to act on; done is a turn
// nobody has looked at yet. The attention set also counts done, but a
// finished reply and a blocked prompt are different asks, so they are two
// chips.
const NEEDS: ReadonlySet<SessionState> = new Set(['needs-input', 'errored']);

// Unshown is a live session on no pane; an exited one is on no pane by
// nature and has its own group and sweep, so it is not one.
export function matchesFilter(filter: SidebarFilter, session: Pick<SessionInfo, 'id' | 'state'>, onPanes: ReadonlySet<string>): boolean {
  if (filter === 'all') return true;
  if (filter === 'needs') return NEEDS.has(session.state);
  if (filter === 'unshown') return session.state !== 'exited' && !onPanes.has(session.id);
  return session.state === 'done';
}

export interface FilterCounts {
  all: number;
  needs: number;
  done: number;
  unshown: number;
}

export function filterCounts(sessions: Iterable<Pick<SessionInfo, 'id' | 'state'>>, onPanes: ReadonlySet<string>): FilterCounts {
  const counts = { all: 0, needs: 0, done: 0, unshown: 0 };
  for (const s of sessions) {
    counts.all += 1;
    if (matchesFilter('needs', s, onPanes)) counts.needs += 1;
    if (matchesFilter('done', s, onPanes)) counts.done += 1;
    if (matchesFilter('unshown', s, onPanes)) counts.unshown += 1;
  }
  return counts;
}

// The groups with only the matching rows; a group with none left drops,
// and the exited group with it (an exited session is neither ask), except
// for the rows named in keep (M9 fix 787: the Exited rows counting down to
// their removal show whatever chip is on). Under all the groups come back
// as they are, the same array, so nothing re-renders for nothing.
export function filterGroups(groups: SessionGroup[], filter: SidebarFilter, onPanes: ReadonlySet<string>, keep: ReadonlySet<string> = new Set()): SessionGroup[] {
  if (filter === 'all') return groups;
  const out: SessionGroup[] = [];
  for (const g of groups) {
    if (g.key === EXITED_GROUP) {
      const kept = g.sessions.filter((s) => keep.has(s.id));
      if (kept.length > 0) out.push({ ...g, sessions: kept });
      continue;
    }
    const sessions = g.sessions.filter((s) => matchesFilter(filter, s, onPanes));
    if (sessions.length > 0) out.push({ ...g, sessions });
  }
  return out;
}

// What the empty list says under a filter that matched nothing.
export function emptyFilterText(filter: SidebarFilter): string {
  return filter === 'needs' ? 'Nothing needs you' : filter === 'done' ? 'Nothing done' : filter === 'unshown' ? 'Every session is on a pane' : 'No sessions yet';
}
