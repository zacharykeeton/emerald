import type { SessionKind } from './session.ts';

// The day's activity (M54): what the daemon answers to activity.spans,
// one entry per session that was active in the window asked for. A span
// is a stretch the session spent working, from the hook that took it
// into `working` to the hook that took it out, clipped to the window,
// with the prompt that set it going; a shell posts no hooks, so a shell
// that never ran Claude in the window is one lifetime span instead
// (lifetime true), drawn dim. A subagent a session sent out is an entry
// of its own (M62), kind `agent`, one span from its SubagentStart to its
// SubagentStop, under the session that sent it; it counts as agent time
// like any other, which is what makes eight forks read as eight.
export interface ActivitySpan {
  from: number;
  to: number;
  prompt: string | null;
}

// Attention debt (M9 fix 231): the stretches a session spent waiting on
// the person, beside its working spans. `asked` runs from the hook that
// took the session into needs-input (a question, a permission) to the
// hook that took it out, with no grace, since a question asked is a
// question waiting; `unread` runs from the turn's end (done) plus the
// grace to the next prompt, so a person who answers within the minute
// owes nothing. Both are clipped to the window like the working spans;
// a stretch of no length is not sent. The user-facing word is never
// "blocked": that reads as a stall, and this is a queue.
export type DebtKind = 'asked' | 'unread';

export interface DebtSpan {
  from: number;
  to: number;
  kind: DebtKind;
}

// The grace on an unread stretch, one constant shared with nothing.
export const DEBT_GRACE_MS = 60_000;

// Presence (M9 fix 245): whether anyone is at the box. The daemon writes
// an `away` line when its last app window detaches, or when the app
// posts that the screen locked, the box slept or nobody has touched it
// for ten minutes, and a `back` line at the next attach, unlock, wake
// or keystroke. A waiting stretch that overlaps an away stretch is
// docked by the overlap, since a question asked at two in the morning
// could not have been answered either, and the grace on an unread
// stretch runs again from the return.
export type PresenceKind = 'away' | 'back';

// Capped (M9 fix 285): a stretch the account was cut off from Claude, a
// usage window at 100 percent (the five-hour window spent, the weekly or
// a model cap reached). The app's main process reads the windows and
// posts usage.capped when one reaches 100 and usage.freed when it drops
// under; the daemon writes each as a line beside the presence ones and
// keeps one open band per window, closed at the earlier of the freed
// edge and the window's reset (so a band closes at the reset when the
// app was gone). The bands are the account's, not a session's, so they
// ride activity.spans beside the rows, and they dock every waiting
// stretch as an away stretch does, since nobody could act.
export type UsageEdge = { kind: 'capped'; window: string; resetsAt: number } | { kind: 'freed'; window: string };

export interface CappedSpan {
  from: number;
  to: number;
  // The usage window's key, five_hour, seven_day or a model's.
  window: string;
  resetsAt: number;
}

// One request a session made (M9 fix 217), folded from the status lines
// Claude Code posts while a reply streams by the rule the record's
// running sum uses (state-machine's sumTokens): a line whose input split
// equals the last is the same request and replaces its output and cost,
// a new split opens a point at its line's time. `usd` is the delta of
// Claude Code's own `total_cost_usd` since the track's previous point,
// null when the line carried none, and then priced from the rates by
// the model. `at` is when the point opened; the window clips on it.
export interface ActivityRequest {
  at: number;
  fresh: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  usd: number | null;
  model: string | null;
}

// A commit the track landed (M9 fix 218), off the session record's
// credited commits (a session's own on its row, a subagent's on the
// agent's row), with the time of the claim and whether it is a merge.
export interface ActivityCommit {
  hash: string;
  at: number;
  merge: boolean;
}

export interface ActivitySession {
  sessionId: string;
  // Null for a session no record names: one from before the daemon kept
  // removed sessions (M57), or from a home whose sessions.json was lost;
  // the log still says it worked. A removed session is named as it was.
  name: string | null;
  color: string | null;
  // An agent's row (M62) is named by its description, else its type.
  kind: SessionKind | 'agent';
  // The Claude conversation the session's hooks reported (M57), from the
  // log line's payload, so a renderer can name an unnamed track from the
  // transcript's own title. Null for a track whose lines carried none.
  claudeSessionId: string | null;
  // When the session was removed from the list (M57), null while listed.
  removedAt: number | null;
  // The folder the session was started in and the one its shell is in
  // now (M9 fix 215), off the daemon's record, listed or removed, so the
  // activity view's folder scope keeps a removed session's row; null for
  // a track no record names, which a folder scope still drops. Absent
  // from a daemon older than level 42, which reads as null.
  cwd: string | null;
  groupCwd: string | null;
  // The requests the track's status lines described (M9 fix 217), those
  // whose point opened inside the window asked for, oldest first; empty
  // on a shell's lifetime row and on an agent's row (its tokens are in
  // its parent's status line). Absent from a daemon older than level 42,
  // which reads as empty.
  requests: ActivityRequest[];
  // The commits the track landed inside the window (M9 fix 218), by the
  // time of the claim, oldest first; a record from before the merge
  // flag counts them all as plain commits. Absent from a daemon older
  // than level 42, which reads as empty.
  commits: ActivityCommit[];
  lifetime: boolean;
  spans: ActivitySpan[];
  // The stretches the session spent waiting on the person (M9 fix 231),
  // asked and unread, inside the window, oldest first; empty on a
  // shell's lifetime row and on an agent's row (an agent asks through
  // its parent). Absent from a daemon older than level 44, which reads
  // as empty.
  debt: DebtSpan[];
  // The part of the row's waiting that fell while nobody was at the box
  // (M9 fix 245), in ms inside the window, already taken off `debt`, so
  // the stats line can say how much was not counted. Absent from a
  // daemon older than level 47, which reads as 0.
  awayMs: number;
  // The part of the row's waiting that fell while the account was capped
  // (M9 fix 285), in ms inside the window, taken off `debt` the same way,
  // for the tooltip's `capped not counted` line. Absent from a daemon
  // older than level 50, which reads as 0.
  cappedMs: number;
  // An agent's row (M62): the session that sent it out (its sessionId is
  // that session's too) and the agent's own id; both null on a session's
  // own row. Absent from a daemon older than level 25, which reads as null.
  parentId: string | null;
  agentId: string | null;
  // The agent's type (fork, Explore, general-purpose), for the tooltip and
  // emmer activity when the name is its description; null on a session.
  agentType: string | null;
  // The conversation was not emerald's (M9 fix 233): a Claude in a plain
  // terminal whose hooks found daemon.json and posted under its own id.
  // No record names it, so the name is null and the renderer reads the
  // transcript's title; cwd and groupCwd are the folder its hooks named.
  // Absent from a daemon older than level 45, which reads as false.
  outside: boolean;
}

// The key a row is drawn under: a session's id, or the agent's under its
// parent, so two rows never share one.
export function activityRowKey(s: Pick<ActivitySession, 'sessionId' | 'agentId'>): string {
  return s.agentId === null || s.agentId === undefined ? s.sessionId : `${s.sessionId}/${s.agentId}`;
}
