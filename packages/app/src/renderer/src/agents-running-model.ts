import { formatTokens, formatUsd } from '@emerald/shared';
import type { SessionInfo, TeamMember } from '@emerald/shared';
import type { AgentsRunning } from '../../preload/api.ts';

// The rows whose figure can carry a running part: live, with a
// conversation bound and a figure to add to; and, since M9 fix 288, a
// live row with a team out and no status line yet, so its members'
// models are read before the first figure lands. The second element is
// the row's own figure, or null for a team-only row, and only goes into
// the beat's key. Live is read off the state (M9 fix 831): an exited row
// may carry a null exit code, the process having given none.
export function liveConversations(sessions: Iterable<SessionInfo>): Array<[string, number | null]> {
  const out: Array<[string, number | null]> = [];
  for (const s of sessions) {
    if (s.conversation === null || s.state === 'exited' || (s.removedAt ?? null) !== null) continue;
    const usd = s.costUsd ?? null;
    if (usd === null && s.team.length === 0) continue;
    out.push([s.conversation.id, usd]);
  }
  return out;
}

// The two-part dollar figure (M9 fix 277): Claude Code's own figure off
// the status line, which only moves when the main thread does, and the
// forks' spend since it, which the main process reads off the agents'
// files (history.ts readAgentsRunning). While the forks run the row
// reads the sum with a ~ after it, since half of it is our estimate,
// and the card names the two parts; once the next own request lands the
// answer's requests drop to zero and both read the bare figure again.

export interface RunningFigure {
  // The row's text: `$35 ~` while the forks run, else the bare figure.
  row: string;
  // The row's tooltip naming both parts, null with the bare figure.
  rowTitle: string | null;
  // The running part alone, `+ ~$25 running`, null with the bare figure.
  part: string | null;
  // The card's cost line: `$9.78 + ~$25 running`, else the bare figure.
  card: string;
  // The card's tokens line under the own counts, null when nothing runs.
  tokens: string | null;
  running: boolean;
}

export function runningFigure(cost: number | null, running: AgentsRunning | null): RunningFigure | null {
  if (cost === null) return null;
  const bare = formatUsd(cost);
  if (running === null || running.usd === null || running.usd <= 0 || running.requests === 0) return { row: bare, rowTitle: null, part: null, card: bare, tokens: null, running: false };
  const agents = `${running.agents} ${running.agents === 1 ? 'agent' : 'agents'}`;
  const part = `+ ~${formatUsd(running.usd)} running`;
  return {
    row: `${formatUsd(cost + running.usd)} ~`,
    rowTitle: `${bare} Claude Code's own figure + ~${formatUsd(running.usd)} by ${agents} running since its last request, an estimate from our rate table`,
    part,
    card: `${bare} ${part}`,
    tokens: `+ ${formatTokens(running.tokens.up)} sent, ${formatTokens(running.tokens.down)} received by ${agents} running`,
    running: true,
  };
}

// Whether a session has a fork out whose spend the files can still be
// growing (M9 fix 322): an agent member still running. A shell member
// has no agent file and a returned agent's requests are all in its
// file already, so neither keeps the shaded pane's faster beat going.
export function agentOut(team: readonly TeamMember[]): boolean {
  return team.some((m) => m.kind === 'agent' && m.outcome === 'running');
}

// Whether two answers say the same thing (M9 fix 354), so the store
// publishes nothing for a beat that read the same files: every row on
// the beat re-rendered on every answer before this, changed or not.
export function sameAgentsRunning(a: AgentsRunning | null | undefined, b: AgentsRunning | null): boolean {
  if (a === undefined) return false;
  if (a === null || b === null) return a === b;
  if (a.since !== b.since || a.usd !== b.usd || a.requests !== b.requests || a.agents !== b.agents) return false;
  if (a.tokens.up !== b.tokens.up || a.tokens.down !== b.tokens.down || a.tokens.cached !== b.tokens.cached) return false;
  const keys = Object.keys(a.models);
  if (keys.length !== Object.keys(b.models).length) return false;
  if (!keys.every((k) => a.models[k] === b.models[k])) return false;
  const spent = Object.keys(a.spend);
  if (spent.length !== Object.keys(b.spend).length) return false;
  if (!spent.every((k) => a.spend[k] === b.spend[k])) return false;
  // M9 fix 903: a changed now line with the same figures is news too.
  const heard = Object.keys(a.said);
  if (heard.length !== Object.keys(b.said).length) return false;
  return heard.every((k) => a.said[k]?.text === b.said[k]?.text && a.said[k]?.at === b.said[k]?.at);
}
