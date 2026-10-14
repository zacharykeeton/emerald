import type { SessionInfo, SessionKind, TeamMember } from './session.ts';
import { runningKind, workingMotion } from './session-label.ts';
import { formatDuration } from './session-order.ts';
import type { SessionGroup } from './session-order.ts';

// The roster's arithmetic (M46), in one place so the row, the pane title,
// the folder heading, the title bar and emmer ls cannot disagree. The
// glyphs are Claude Code's own transcript asterisk and a shell prompt.
export const AGENT_GLYPH = '✳';
export const SHELL_GLYPH = '❯';

// What the mark before a session's name says it is: a Claude session, or
// a shell that Claude is running in, is the asterisk; a plain shell is
// the prompt. Like runningKind, with one more sign: a hook has reached
// the shell (lastEventAt, which SessionEnd clears), since only Claude
// sends hooks and a script posting them binds no id first.
export function markKind(session: Pick<SessionInfo, 'kind' | 'claudeSessionId' | 'lastEventAt'>): SessionKind {
  return runningKind(session) === 'claude' || session.lastEventAt !== null ? 'claude' : 'shell';
}

// A session's team as the row shows it: agents still out, agents that
// returned this turn, and the background shells running now (a shell
// member is running until a Stop stops listing it; M9 fix 101 made the
// unit the running count, which is what Claude Code's own status line
// prints as "3 shells", and the ones that finished this turn stay on the
// roster card alone).
export interface TeamCounts {
  out: number;
  returned: number;
  shells: number;
  shellsReturned: number;
}

// A folder heading's units, under the note's definitions: an agent is
// every Claude in the folder, a session or something a session sent out,
// active when mid-turn or still out; a shell is every shell session plus
// every background shell, active when running a command.
export interface FolderRollup {
  agentsActive: number;
  agentsInactive: number;
  shellsRunning: number;
  shellsIdle: number;
}

interface MemberCounts {
  agentsRunning: number;
  agentsReturned: number;
  shellsRunning: number;
  shellsIdle: number;
}

function memberCounts(members: readonly TeamMember[]): MemberCounts {
  const c: MemberCounts = { agentsRunning: 0, agentsReturned: 0, shellsRunning: 0, shellsIdle: 0 };
  for (const m of members) {
    if (m.kind === 'agent') {
      if (m.outcome === 'running') c.agentsRunning += 1;
      else c.agentsReturned += 1;
    } else if (m.outcome === 'running') c.shellsRunning += 1;
    else c.shellsIdle += 1;
  }
  return c;
}

export function teamCounts(session: Pick<SessionInfo, 'team'>): TeamCounts {
  const c = memberCounts(session.team);
  return { out: c.agentsRunning, returned: c.agentsReturned, shells: c.shellsRunning, shellsReturned: c.shellsIdle };
}

const EMPTY: ReadonlySet<string> = new Set();

// The heading's units over a group's rows and their members. A session
// running Claude (markKind) is one agent, active while it works (a stale
// one is still, on the heading as on the row); any other is one shell,
// running when its id is in runningShells, which the renderer fills from
// the output rate (the daemon has no command-running signal for a shell)
// and the CLI leaves empty. The exited group is never passed in: its
// heading keeps a plain count. A session's background shells count only
// while they run (M9 fix 122, the rule fix 101 gave the row): a finished
// one has no prompt to sit at, it is a line on the roster card.
export function folderRollup(group: Pick<SessionGroup, 'sessions'>, runningShells: ReadonlySet<string> = EMPTY): FolderRollup {
  const roll: FolderRollup = { agentsActive: 0, agentsInactive: 0, shellsRunning: 0, shellsIdle: 0 };
  for (const s of group.sessions) {
    if (markKind(s) === 'claude') {
      if (workingMotion(s) !== null) roll.agentsActive += 1;
      else roll.agentsInactive += 1;
    } else if (runningShells.has(s.id)) roll.shellsRunning += 1;
    else roll.shellsIdle += 1;
    const c = memberCounts(s.team);
    roll.agentsActive += c.agentsRunning;
    roll.agentsInactive += c.agentsReturned;
    roll.shellsRunning += c.shellsRunning;
  }
  return roll;
}

// The title bar's count: every agent still out, over every session.
export function agentsOut(sessions: Iterable<Pick<SessionInfo, 'team'>>): number {
  let n = 0;
  for (const s of sessions) n += teamCounts(s).out;
  return n;
}

// The units as words, for emmer ls and the tooltips: the glyph and the
// count per unit, a unit at zero left out, empty when every one is.
export function teamText(counts: TeamCounts): string {
  return units([
    [AGENT_GLYPH, counts.out],
    [AGENT_GLYPH, counts.returned],
    [SHELL_GLYPH, counts.shells],
  ]);
}

export function rollupText(roll: FolderRollup): string {
  return units([
    [AGENT_GLYPH, roll.agentsActive],
    [AGENT_GLYPH, roll.agentsInactive],
    [SHELL_GLYPH, roll.shellsRunning],
    [SHELL_GLYPH, roll.shellsIdle],
  ]);
}

function units(pairs: Array<[string, number]>): string {
  return pairs
    .filter(([, n]) => n > 0)
    .map(([glyph, n]) => `${glyph}${n}`)
    .join(' ');
}

// A heading's or the title bar's units in words (M9 fix 88), for the
// hover: "3 agents active, 4 idle, 1 shell running, 2 idle", the kind
// word once per kind, a unit at zero left out, empty for none.
export function rollupWords(roll: FolderRollup): string {
  const parts: string[] = [];
  const unit = (n: number, kind: string, word: string, named: boolean) => `${n} ${named ? '' : `${kind}${n === 1 ? '' : 's'} `}${word}`;
  if (roll.agentsActive > 0) parts.push(unit(roll.agentsActive, 'agent', 'active', false));
  if (roll.agentsInactive > 0) parts.push(unit(roll.agentsInactive, 'agent', 'idle', roll.agentsActive > 0));
  if (roll.shellsRunning > 0) parts.push(unit(roll.shellsRunning, 'shell', 'running', false));
  if (roll.shellsIdle > 0) parts.push(unit(roll.shellsIdle, 'shell', 'idle', roll.shellsRunning > 0));
  return parts.join(', ');
}

// The units in words, for a roster folded to one total (M9 fix 77):
// "2 out, 1 returned, 1 shell", a kind at zero left out, empty for none.
export function teamSummary(counts: TeamCounts): string {
  const parts: string[] = [];
  if (counts.out > 0) parts.push(`${counts.out} out`);
  if (counts.returned > 0) parts.push(`${counts.returned} returned`);
  if (counts.shells > 0) parts.push(`${counts.shells} ${counts.shells === 1 ? 'shell' : 'shells'}`);
  return parts.join(', ');
}

// What a roster's units mean, in words a first-timer can read (M9 fix
// 89), one sentence per unit shown in the roster's order, for the card
// that opens on it; a unit at zero has no sentence.
export function rosterLines(counts: TeamCounts): string[] {
  const lines: string[] = [];
  if (counts.out > 0) lines.push(`${counts.out} ${counts.out === 1 ? 'agent' : 'agents'} out, working now`);
  if (counts.returned > 0) lines.push(`${counts.returned} ${counts.returned === 1 ? 'agent' : 'agents'} returned this turn`);
  if (counts.shells > 0) lines.push(`${counts.shells} ${counts.shells === 1 ? 'background shell' : 'background shells'} running now`);
  if (counts.shellsReturned > 0) lines.push(`${counts.shellsReturned} ${counts.shellsReturned === 1 ? 'background shell' : 'background shells'} finished this turn`);
  return lines;
}

// The same for a heading's four units.
export function rollupLines(roll: FolderRollup): string[] {
  const lines: string[] = [];
  if (roll.agentsActive > 0) lines.push(`${roll.agentsActive} ${roll.agentsActive === 1 ? 'agent' : 'agents'} active`);
  if (roll.agentsInactive > 0) lines.push(`${roll.agentsInactive} ${roll.agentsInactive === 1 ? 'agent' : 'agents'} idle`);
  if (roll.shellsRunning > 0) lines.push(`${roll.shellsRunning} ${roll.shellsRunning === 1 ? 'shell' : 'shells'} running a command`);
  if (roll.shellsIdle > 0) lines.push(`${roll.shellsIdle} ${roll.shellsIdle === 1 ? 'shell' : 'shells'} at ${roll.shellsIdle === 1 ? 'its' : 'their'} prompt`);
  return lines;
}

// Where the counts come from, one line under the sentences.
export const ROSTER_NOTE = 'Agents are the Claude sessions in this folder and the subagents they send out; shells are their background commands; a click lists the team under the row';

// The hover on a roster: the team as a list in spawn order, one line per
// member with its kind, its type, how long it has been out (or took), and
// what it was given to do. Empty for no team.
export function teamTitle(members: readonly TeamMember[], now: number): string {
  return members.map((m) => memberLine(m, now)).join('\n');
}

// One member's line in parts (M9 fix 89), for the card and the team list
// under a row, which draw the mark and colour the elapsed themselves;
// memberLine joins them for the tooltip and the CLI.
export interface MemberParts {
  kind: 'agent' | 'shell';
  working: boolean;
  // "agent Explore", "shell"
  type: string;
  // "out 2m", "returned after 40s", "running 5s", "finished after 1m"
  elapsed: string;
  // The description, or the command's first line; null for none.
  task: string | null;
  // What the agent is doing now (M65), its latest tool phrase; null for
  // a shell and an agent that has called no tool.
  activity: string | null;
}

export function memberParts(m: TeamMember, now: number): MemberParts {
  const kind = m.kind === 'agent' ? 'agent' : 'shell';
  const type = m.type === null ? kind : `${kind} ${m.type}`;
  const elapsed = m.outcome === 'running' ? `${m.kind === 'agent' ? 'out' : 'running'} ${formatDuration(m.startedAt, now)}` : `${m.kind === 'agent' ? 'returned' : 'finished'} after ${formatDuration(m.startedAt, m.endedAt ?? now)}`;
  const raw = m.description ?? m.command;
  const task = raw === null ? null : raw.split('\n')[0] ?? raw;
  return { kind, working: m.outcome === 'running', type, elapsed, task, activity: m.activity ?? null };
}

// model is the word the mark's family reads ("Opus", "Sonnet", ...),
// already resolved from the agent's raw model string by the caller
// (session-mark-model.ts, app-side); team.ts stays a plain string in,
// plain string out. Absent when no request has come in yet, as the
// caller's map leaves it (M9 fix 289).
export function memberLine(m: TeamMember, now: number, model: string | null = null): string {
  const { type, elapsed, task, activity } = memberParts(m, now);
  return [type, model, elapsed, task, activity].filter((part) => part !== null).join(' · ');
}
