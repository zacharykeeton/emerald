import type { ActivitySession } from './activity.ts';
import { costParts, ratesFor } from './rates.ts';
import type { SessionCommit, SessionTokens } from './session.ts';
import type { UsageMessage } from './transcript.ts';

// The commit's price (M9 fix 252, docs/design/commit-price.md): what the
// stretch of work between a session's previous credited commit and this
// one cost, in dollars, tokens and the session's working time, with the
// forked agents' share as a note. The card prices the slice and never a
// running total, so the slice is stated first and every figure under it
// is that slice's. Absences are nulls, never zeros: a slice whose
// transcript is gone reads `not known`, which is not `$0.00`.

// The requests inside a window, summed, with each agent's share apart.
// usd is our estimate from the rates table (a transcript carries no cost
// figure), null when no request's model is in the table; requests with a
// model the table lacks still count in the tokens.
export interface SliceUsage {
  tokens: SessionTokens;
  usd: number | null;
  requests: number;
  agents: SliceAgentUsage[];
}

export interface SliceAgentUsage {
  id: string;
  tokens: SessionTokens;
  usd: number | null;
  requests: number;
}

const NO_TOKENS: SessionTokens = { fresh: 0, cacheWrite: 0, cacheRead: 0, output: 0 };

function addTokens(a: SessionTokens, m: UsageMessage): SessionTokens {
  return { fresh: a.fresh + m.fresh, cacheWrite: a.cacheWrite + m.cacheWrite, cacheRead: a.cacheRead + m.cacheRead, output: a.output + m.output };
}

function priceOf(m: UsageMessage): number | null {
  const rates = ratesFor(m.model);
  return rates === null ? null : costParts(m, rates).total;
}

function addUsd(a: number | null, b: number | null): number | null {
  if (b === null) return a;
  return a === null ? b : a + b;
}

// The requests whose line landed inside [from, to], the session's own
// and its agents' together in the totals and each agent's apart. Null
// when the window holds no request at all, so a slice with no traffic
// reads as not known rather than free. `keep` narrows the messages
// counted (M9 fix 275: the split between the agents priced here and
// those priced on their own commits); every message when not given.
export function sliceUsage(messages: readonly UsageMessage[], from: number, to: number, keep?: (m: UsageMessage) => boolean): SliceUsage | null {
  let tokens = NO_TOKENS;
  let usd: number | null = null;
  let requests = 0;
  const agents = new Map<string, SliceAgentUsage>();
  for (const m of messages) {
    if (m.at < from || m.at > to) continue;
    if (keep !== undefined && !keep(m)) continue;
    const price = priceOf(m);
    tokens = addTokens(tokens, m);
    usd = addUsd(usd, price);
    requests += 1;
    if (m.agentId === null) continue;
    const a = agents.get(m.agentId) ?? { id: m.agentId, tokens: NO_TOKENS, usd: null, requests: 0 };
    agents.set(m.agentId, { id: a.id, tokens: addTokens(a.tokens, m), usd: addUsd(a.usd, price), requests: a.requests + 1 });
  }
  if (requests === 0) return null;
  return { tokens, usd, requests, agents: [...agents.values()] };
}

// The agents a record prices on commits of their own (M9 fix 275): the
// agent named on any credited commit in the list. Their requests are
// that commit's, so a parent's slice leaves them out, else a fork's
// traffic is paid twice, once on the fork's commit and once on the
// parent's next (a 53-commit conversation summed to $334 on $187 of
// requests). An agent with no commit (an Explore, a research fork) has
// nowhere else to land and stays in the parent's slice.
export function pricedAgents(commits: readonly SessionCommit[]): Set<string> {
  const out = new Set<string>();
  for (const c of commits) if (c.agent !== undefined) out.add(c.agent.id);
  return out;
}

// The slice's requests split for a commit's card and row: `own` is what
// the commit is priced on, `elsewhere` the requests of the agents priced
// on their own commits, for the note. On an agent's own commit there is
// no split: the card takes the agent's share off the whole, and the
// agent is in `priced` by definition.
export interface SplitUsage {
  own: SliceUsage | null;
  elsewhere: SliceUsage | null;
}

export function splitUsage(messages: readonly UsageMessage[], from: number, to: number, priced: ReadonlySet<string>, agentId: string | null): SplitUsage {
  if (agentId !== null || priced.size === 0) return { own: sliceUsage(messages, from, to), elsewhere: null };
  return {
    own: sliceUsage(messages, from, to, (m) => m.agentId === null || !priced.has(m.agentId)),
    elsewhere: sliceUsage(messages, from, to, (m) => m.agentId !== null && priced.has(m.agentId)),
  };
}

// A group of commits credited at one instant on one line (M9 fix 276):
// the daemon's first-parent walk credits every commit a merge or a
// rebase brought in with one `at`, so the stretch before the group is
// one slice, priced once and shown on each of them. size 1 on a commit
// credited alone.
export interface CommitGroup {
  size: number;
  // This commit's place in the group, 0 the oldest, whose row carries
  // the figure; the rest carry a dot.
  index: number;
  // The oldest's hash, for the dot's tooltip.
  first: string;
}

// The branch's own run on a merge (state 5 of the board): how many
// commits the merge brought in that the records credit, and what they
// cost. Priced on those commits and named in the note, never added into
// the merge's own Cost: the branch's commits already carry that money,
// so folding it in again would make every merge the most expensive
// commit in the log and the log's dollars would no longer sum to
// anything.
export interface BranchRun {
  commits: number;
  usd: number | null;
  ms: number | null;
}

export interface CommitCardModel {
  // The stretch priced: from the previous credited commit (fromHash) or
  // the session's start (null) to this commit's claim.
  slice: { fromHash: string | null; from: number; to: number };
  cost: number | null;
  tokens: SessionTokens | null;
  // The session's working time inside the slice, off its hook spans;
  // null when no span row was given (the daemon could not be asked).
  agentMs: number | null;
  // The forked agents' share: how many had a request or a span in the
  // slice, and what they cost and ran. Null when none did, and on a
  // subagent's own commit, whose every figure is the agent's.
  agents: { count: number; usd: number | null; ms: number | null } | null;
  // The agents that ran in the slice and are priced on commits of their
  // own (M9 fix 275), left out of Cost; null when none did.
  elsewhere: { count: number; usd: number | null } | null;
  // The branch's run, on a merge whose walk found credited commits.
  branch: BranchRun | null;
  // The commits credited with this one at one instant (M9 fix 276);
  // null when it was credited alone.
  group: CommitGroup | null;
}

// The card's line on a commit whose two times differ (M9 fix 303):
// `authored 6:27 PM, picked 6:45 PM` when the commit has a twin (fix
// 304), `authored 6:27 PM, committed 6:45 PM` otherwise (a rebase, an
// amend), in the card's clock format; null when they agree to the
// minute, which is every commit made in place.
export function timesLine(at: number, authoredAt: number, picked: boolean, clock: (ms: number) => string): string | null {
  if (Math.abs(at - authoredAt) < 60_000) return null;
  return `authored ${clock(authoredAt)}, ${picked ? 'picked' : 'committed'} ${clock(at)}`;
}

// How much of a row's working spans falls inside [from, to].
function clippedMs(row: ActivitySession | undefined, from: number, to: number): number {
  if (row === undefined) return 0;
  let ms = 0;
  for (const span of row.spans) {
    const a = Math.max(span.from, from);
    const b = Math.min(span.to, to);
    if (b > a) ms += b - a;
  }
  return ms;
}

// commit: the record's credited commit, whose `at` is the claim and whose
// `agent` names the member on a subagent's commit. prev: the previous
// credited commit on the same line (the session's own, or the agent's),
// null on the first. start: where the line began, the session's start
// or the agent's, for the first commit's slice. rows: activity.spans
// over the slice, the session's own row and its agents' rows (parentId
// set), or null when the daemon was not asked. usage: the slice's
// requests with the agents priced elsewhere already left out (the
// `own` of splitUsage), or null when the transcript is gone or holds
// none. priced: those agents (M9 fix 275), whose rows are left out of
// the agents note as their requests are, with `elsewhere` their
// requests for the note of their own. group: the commits credited with
// this one at one instant (M9 fix 276), size 1 when alone.
export interface CommitCardExtra {
  priced?: ReadonlySet<string>;
  elsewhere?: SliceUsage | null;
  group?: CommitGroup | null;
}

export function commitCardModel(commit: SessionCommit, prev: SessionCommit | null, start: number, rows: readonly ActivitySession[] | null, usage: SliceUsage | null, branch: BranchRun | null, extra: CommitCardExtra = {}): CommitCardModel {
  const from = prev === null ? start : prev.at;
  const to = commit.at;
  const slice = { fromHash: prev === null ? null : prev.hash, from, to };
  const agentId = commit.agent?.id ?? null;
  const priced = extra.priced ?? new Set<string>();
  const elsewhere = extra.elsewhere ?? null;
  const group = extra.group ?? null;
  const grouped = group !== null && group.size > 1 ? group : null;
  if (agentId !== null) {
    // A subagent's own commit: the agent's share is the whole.
    const own = usage?.agents.find((a) => a.id === agentId) ?? null;
    const row = rows?.find((r) => r.agentId === agentId);
    return { slice, cost: own?.usd ?? null, tokens: own?.tokens ?? null, agentMs: rows === null ? null : clippedMs(row, from, to), agents: null, elsewhere: null, branch: null, group: grouped };
  }
  const ownRow = rows?.find((r) => r.agentId === null && !r.lifetime) ?? rows?.find((r) => r.agentId === null);
  const agentRows = rows?.filter((r) => r.agentId !== null && !priced.has(r.agentId)) ?? [];
  const seen = new Set<string>();
  let agentUsd: number | null = null;
  let agentMs = 0;
  for (const a of usage?.agents ?? []) {
    seen.add(a.id);
    agentUsd = addUsd(agentUsd, a.usd);
  }
  for (const r of agentRows) {
    const ms = clippedMs(r, from, to);
    if (ms === 0) continue;
    seen.add(r.agentId!);
    agentMs += ms;
  }
  const agents = seen.size === 0 ? null : { count: seen.size, usd: agentUsd, ms: rows === null ? null : agentMs };
  return {
    slice,
    cost: usage?.usd ?? null,
    tokens: usage?.tokens ?? null,
    agentMs: rows === null ? null : clippedMs(ownRow, from, to),
    agents,
    elsewhere: elsewhere === null || elsewhere.agents.length === 0 ? null : { count: elsewhere.agents.length, usd: elsewhere.usd },
    branch: commit.merge === true ? branch : null,
    group: grouped,
  };
}

// The previous credited commit on the same line as `commit` in a
// record's list: the session's own before an own commit, the same
// agent's before a member's, by claim time; null on the first. A commit
// credited at the same instant is in this one's group (M9 fix 276) and
// is skipped, so the group's slice runs from the commit before it.
export function previousCommit(commits: readonly SessionCommit[], commit: SessionCommit): SessionCommit | null {
  const agentId = commit.agent?.id ?? null;
  let prev: SessionCommit | null = null;
  for (const c of commits) {
    if (c.hash === commit.hash) continue;
    if ((c.agent?.id ?? null) !== agentId) continue;
    if (c.at < commit.at && (prev === null || c.at >= prev.at)) prev = c;
  }
  return prev;
}

// The group `commit` was credited in (M9 fix 276): the commits on its
// line with its `at`, in the list's order, which is the walk's, oldest
// first. Size 1 when it was credited alone.
export function commitGroup(commits: readonly SessionCommit[], commit: SessionCommit): CommitGroup {
  const agentId = commit.agent?.id ?? null;
  const members = commits.filter((c) => c.at === commit.at && (c.agent?.id ?? null) === agentId);
  const index = Math.max(0, members.findIndex((c) => c.hash === commit.hash));
  return { size: Math.max(1, members.length), index, first: members[0]?.hash ?? commit.hash };
}
