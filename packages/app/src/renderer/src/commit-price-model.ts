import { commitGroup, previousCommit, pricedAgents, splitUsage } from '@emerald/shared';
import type { ActivitySession, BranchRun, CommitGroup, SessionCommit, SessionInfo, UsageMessage } from '@emerald/shared';
import type { GraphCommit } from '../../preload/api.ts';

// The commit's price as the panel finds it on a record (M9 fix 252): which
// credited commit a row's hash is, where its slice starts, which
// conversation's transcript holds the slice's requests, and, on a merge,
// which credited commits the branch brought in. The sums themselves are
// the shared model's (commit-card.ts); this is the walk from a record
// and a log to the model's inputs.

// Every commit a record credits, the session's own and its members'
// with the agent named the way the record names one once the member
// has left the team, oldest claim first.
export function creditedCommits(session: SessionInfo): SessionCommit[] {
  const out: SessionCommit[] = [...session.commits];
  for (const m of session.team ?? []) {
    for (const c of m.commits) {
      if (out.some((o) => o.hash === c.hash)) continue;
      out.push({ hash: c.hash, at: c.at, ...(c.merge === undefined ? {} : { merge: c.merge }), agent: { id: m.id, branch: m.branch, type: m.type, description: m.description } });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// The conversation the record was hosting at `at`: the last span opened
// by then, else the bound conversation; null on a shell that never ran
// Claude, whose commits have no transcript.
export function conversationAt(session: SessionInfo, at: number): string | null {
  let found: string | null = null;
  for (const span of session.spans ?? []) {
    if (span.startedAt <= at) found = span.conversation;
  }
  return found ?? session.conversation?.id ?? null;
}

// Where the commit's line began, for the first commit's slice: the
// member's start on an agent's commit while the member is on the team,
// else the start of the span the commit fell in, else the record's.
export function lineStart(session: SessionInfo, commit: SessionCommit): number {
  const agentId = commit.agent?.id ?? null;
  if (agentId !== null) {
    const member = (session.team ?? []).find((m) => m.id === agentId);
    if (member !== undefined) return member.startedAt;
  }
  let start = session.createdAt;
  for (const span of session.spans ?? []) {
    if (span.startedAt <= commit.at) start = span.startedAt;
  }
  return start;
}

export interface CommitSlice {
  commit: SessionCommit;
  prev: SessionCommit | null;
  start: number;
  from: number;
  to: number;
  conversation: string | null;
  // The agents the record prices on commits of their own (M9 fix 275),
  // whose requests an own commit's slice leaves out.
  priced: ReadonlySet<string>;
  // The commits credited with this one at one instant (M9 fix 276).
  group: CommitGroup;
}

// A row's slice on the record that credits it, or null when the record
// does not (the hash was credited to another session, or to nobody).
export function commitSlice(session: SessionInfo, hash: string): CommitSlice | null {
  const all = creditedCommits(session);
  const commit = all.find((c) => c.hash === hash);
  if (commit === undefined) return null;
  const prev = previousCommit(all, commit);
  const start = lineStart(session, commit);
  return { commit, prev, start, from: prev === null ? start : prev.at, to: commit.at, conversation: conversationAt(session, commit.at), priced: pricedAgents(all), group: commitGroup(all, commit) };
}

// The row's dollars (the board's 3d) with the two agent parts the cell's
// tooltip names (M9 fix 275): the agents counted in the figure and those
// priced on commits of their own and left out of it.
export interface RowCost {
  usd: number;
  agents: { count: number; usd: number | null } | null;
  elsewhere: { count: number; usd: number | null } | null;
}

// The row's dollars: the slice's estimate off the conversation's
// requests, an agent's own share on a member's commit; null while the
// list is not in yet, when no transcript names the conversation, or
// when the slice holds no priced request.
export function rowCost(slice: CommitSlice, lists: ReadonlyMap<string, UsageMessage[] | null>): RowCost | null {
  if (slice.conversation === null) return null;
  const messages = lists.get(slice.conversation);
  if (messages === undefined || messages === null) return null;
  const agentId = slice.commit.agent?.id ?? null;
  const { own, elsewhere } = splitUsage(messages, slice.from, slice.to, slice.priced, agentId);
  if (own === null) return null;
  if (agentId !== null) {
    const usd = own.agents.find((a) => a.id === agentId)?.usd ?? null;
    return usd === null ? null : { usd, agents: null, elsewhere: null };
  }
  if (own.usd === null) return null;
  return {
    usd: own.usd,
    agents: own.agents.length === 0 ? null : { count: own.agents.length, usd: own.agents.reduce<number | null>((a, b) => (b.usd === null ? a : (a ?? 0) + b.usd), null) },
    elsewhere: elsewhere === null || elsewhere.agents.length === 0 ? null : { count: elsewhere.agents.length, usd: elsewhere.usd },
  };
}

// One line's share of a merged branch (state 5): the credited commits
// the merge brought in on one session's own line or one agent's, as
// the stretch from before the first of them to the last.
export interface BranchGroup {
  sessionId: string;
  agentId: string | null;
  conversation: string | null;
  from: number;
  to: number;
  count: number;
  // The record's agents priced on commits of their own (M9 fix 275),
  // left out of an own line's stretch: an agent with a group of its
  // own here is among them, and so is one whose commit landed elsewhere.
  priced: ReadonlySet<string>;
}

// The commits a merge brought in: reachable from its second parent and
// not from its first, inside the log's window (an older ancestor is
// out, which only shortens the run). Those a record credits are grouped
// by line; a branch nobody here made gives no group and the note stays
// away.
export function branchGroups(merge: GraphCommit, commits: readonly GraphCommit[], recordOf: (hash: string) => SessionInfo | null): BranchGroup[] {
  if (merge.parents.length < 2) return [];
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const reach = (start: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const h = stack.pop()!;
      if (seen.has(h)) continue;
      const c = byHash.get(h);
      if (c === undefined) continue;
      seen.add(h);
      stack.push(...c.parents);
    }
    return seen;
  };
  const trunk = reach(merge.parents[0]!);
  const branch = [...reach(merge.parents[1]!)].filter((h) => !trunk.has(h));
  const groups = new Map<string, BranchGroup>();
  for (const hash of branch) {
    const session = recordOf(hash);
    if (session === null) continue;
    const slice = commitSlice(session, hash);
    if (slice === null) continue;
    const agentId = slice.commit.agent?.id ?? null;
    const key = `${session.id}\0${agentId ?? ''}`;
    const g = groups.get(key);
    if (g === undefined) groups.set(key, { sessionId: session.id, agentId, conversation: slice.conversation, from: slice.from, to: slice.to, count: 1, priced: slice.priced });
    else groups.set(key, { ...g, from: Math.min(g.from, slice.from), to: Math.max(g.to, slice.to), count: g.count + 1 });
  }
  return [...groups.values()];
}

// The window one activity.spans ask must cover for the groups.
export function branchWindow(groups: readonly BranchGroup[]): { from: number; to: number } | null {
  if (groups.length === 0) return null;
  return { from: Math.min(...groups.map((g) => g.from)), to: Math.max(...groups.map((g) => g.to)) };
}

// The branch's run summed over its groups: the commits, the dollars off
// each line's requests (an agent's own share on an agent's line) and
// the working time off each line's row, clipped to the group's stretch.
// rows null when the daemon was not asked, which leaves the time null.
export function branchRunOf(groups: readonly BranchGroup[], lists: ReadonlyMap<string, UsageMessage[] | null>, rows: readonly ActivitySession[] | null): BranchRun | null {
  if (groups.length === 0) return null;
  let usd: number | null = null;
  let ms = 0;
  let commits = 0;
  for (const g of groups) {
    commits += g.count;
    const messages = g.conversation === null ? null : (lists.get(g.conversation) ?? null);
    const usage = messages === null ? null : splitUsage(messages, g.from, g.to, g.priced, g.agentId).own;
    const share = usage === null ? null : g.agentId === null ? usage.usd : (usage.agents.find((a) => a.id === g.agentId)?.usd ?? null);
    if (share !== null) usd = (usd ?? 0) + share;
    const row = rows?.find((r) => r.sessionId === g.sessionId && (r.agentId ?? null) === g.agentId && (g.agentId !== null || !r.lifetime)) ?? rows?.find((r) => r.sessionId === g.sessionId && (r.agentId ?? null) === g.agentId);
    for (const span of row?.spans ?? []) {
      const a = Math.max(span.from, g.from);
      const b = Math.min(span.to, g.to);
      if (b > a) ms += b - a;
    }
  }
  return { commits, usd, ms: rows === null ? null : ms };
}
