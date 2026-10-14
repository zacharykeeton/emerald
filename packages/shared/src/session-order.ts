import type { SessionInfo, SessionState } from './session.ts';

// Pure helpers behind the sidebar and emmer ls: the order sessions appear in, how they
// are grouped, and the "4m" text next to a badge. Kept out of the component
// so node:test can cover them without a DOM and the CLI can share them.

// How the sidebar orders its rows (M32). 'created' keeps every row where
// it was made, so a badge change never moves it; 'state' is the older
// order, most urgent first, for a person who wants the blocked session on
// top whatever the cost. The picker, the jump palette and emmer ls take
// the same setting so they all agree with the sidebar.
export type SidebarOrder = 'created' | 'state';
export const SIDEBAR_ORDERS: readonly SidebarOrder[] = ['created', 'state'];

export function isSidebarOrder(value: unknown): value is SidebarOrder {
  return value === 'created' || value === 'state';
}

// The state order. Lower comes first. Within needs-input the oldest
// stateSince comes first because the longest-blocked session deserves the
// top slot; every other state is newest first so a fresh event bubbles up.
const rank: Record<SessionState, number> = {
  'needs-input': 0,
  errored: 1,
  done: 2,
  working: 3,
  waiting: 4,
  idle: 5,
  starting: 6,
  exited: 7,
};

export function compareSessions(a: SessionInfo, b: SessionInfo): number {
  const byRank = rank[a.state] - rank[b.state];
  if (byRank !== 0) return byRank;
  if (a.state === 'needs-input') return a.stateSince - b.stateSince;
  if (a.stateSince !== b.stateSince) return b.stateSince - a.stateSince;
  return byId(a, b);
}

// The creation order: oldest first, so a new session lands at the bottom
// of its group and everything above it stays put.
export function compareCreated(a: SessionInfo, b: SessionInfo): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return byId(a, b);
}

// Stable tie-break so two sessions created in the same millisecond do not
// swap places on every render.
function byId(a: SessionInfo, b: SessionInfo): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function comparatorFor(order: SidebarOrder): (a: SessionInfo, b: SessionInfo) => number {
  return order === 'state' ? compareSessions : compareCreated;
}

export interface SessionGroup {
  // The folder the sessions are grouped under (groupCwd), or 'exited' for
  // the group of finished sessions.
  key: string;
  // What the heading shows: the person's own label for the folder (M9
  // fix 194) or its last path segment, with the full path as the tooltip.
  title: string;
  sessions: SessionInfo[];
}

export const EXITED_GROUP = 'exited';

// Live sessions are grouped by groupCwd: a shell's is the folder it is in
// now, a Claude session's the folder Claude started in (M9 fix 60). In the created
// order the groups sit in the order their oldest session was made, so a
// folder keeps its place as sessions come and go; in the state order they
// are ordered by their most urgent session so a folder with a blocked
// session rises to the top. Exited sessions go in one group at the bottom
// either way. labels (M9 fix 194) is the daemon's folder labels by the
// group's key; a group with one is titled by it.
export function groupSessions(sessions: Iterable<SessionInfo>, order: SidebarOrder = 'created', labels?: ReadonlyMap<string, string>): SessionGroup[] {
  const compare = comparatorFor(order);
  const byFolder = new Map<string, SessionInfo[]>();
  const exited: SessionInfo[] = [];
  for (const s of sessions) {
    if (s.state === 'exited') {
      exited.push(s);
      continue;
    }
    const list = byFolder.get(s.groupCwd);
    if (list === undefined) byFolder.set(s.groupCwd, [s]);
    else list.push(s);
  }
  const groups: SessionGroup[] = [];
  for (const [folder, list] of byFolder) {
    list.sort(compare);
    groups.push({ key: folder, title: labels?.get(folder) ?? folderTitle(folder), sessions: list });
  }
  // Each group's list is sorted, so its first session is the one the
  // order ranks highest: the most urgent, or the oldest.
  groups.sort((a, b) => compare(a.sessions[0]!, b.sessions[0]!));
  if (exited.length > 0) {
    exited.sort(compare);
    groups.push({ key: EXITED_GROUP, title: 'exited', sessions: exited });
  }
  return groups;
}

// What a folder heading says about the sessions under it (M32): the most
// urgent state among them and how many are in it, so a collapsed group
// or one scrolled past still says which project wants a person. null
// for an empty group.
export interface Rollup {
  state: SessionState;
  count: number;
}

export function rollup(group: SessionGroup): Rollup | null {
  let top: SessionState | null = null;
  let count = 0;
  for (const s of group.sessions) {
    if (top === null || rank[s.state] < rank[top]) {
      top = s.state;
      count = 1;
    } else if (s.state === top) {
      count += 1;
    }
  }
  return top === null ? null : { state: top, count };
}

// The heading's text for a rollup: only the three states a person acts
// on get one, so a folder whose sessions are all idle or working says
// nothing and the headings stay quiet most of the time.
export function rollupLabel(roll: Rollup): string | null {
  switch (roll.state) {
    case 'needs-input':
      return roll.count === 1 ? '1 needs input' : `${roll.count} need input`;
    case 'errored':
      return `${roll.count} errored`;
    case 'done':
      return `${roll.count} done`;
    default:
      return null;
  }
}

export function folderTitle(folder: string): string {
  const trimmed = folder.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  const last = parts[parts.length - 1];
  return last === undefined || last === '' ? folder : last;
}

// Time in state, in the shortest unit that still reads well: 12s, 4m, 2h, 3d.
// Clock skew or a future stateSince reads as 0s rather than a negative number.
export function formatDuration(sinceMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
