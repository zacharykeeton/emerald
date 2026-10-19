import { isSessionId } from './session.ts';
import type { ContextWindow, NeedsInputReason, SessionCache, SessionCommit, SessionInfo, SessionKind, SessionSpan, SessionState, SessionTask, SessionTaskStatus, SessionTokens, SessionTouched, ShellCommand, TeamMember, WaitingTask } from './session.ts';
import { Limits } from './limits.ts';
import { ackable, folderName, runningKind, staleSince, titleGlyph, titleText } from './session-label.ts';
import { askWords, toolPhrase } from './tool-phrase.ts';
import { HEAD_TOOLS } from './command-dir.ts';
import { memberParts } from './team.ts';

// The session state machine from docs/PLAN.md as one pure function. The daemon
// owns the SessionInfo records and feeds every hook event, PTY exit, ack and
// stale check through reduce(); the renderer only ever sees the result.
//
// reduce() returns the very same object when nothing changed, so callers can
// skip a session.changed push with an identity check.

// The subset of a Claude Code hook payload the reducer reads. Everything else
// is carried along untouched into hooks.jsonl.
export interface HookPayload {
  session_id?: string;
  hook_event_name?: string;
  cwd?: string;
  // Present when the hook fired inside a subagent (Task tool), and on the
  // parent's own SubagentStart and SubagentStop, which name the subagent.
  agent_id?: string;
  // SubagentStart and SubagentStop: the subagent's type (fork, Explore,
  // general-purpose; empty for an inner agent). Neither carries a
  // description: that comes from the Agent tool's own PostToolUse.
  agent_type?: string;
  // PreToolUse and PostToolUse: the tool and what it was given. The Agent
  // tool's response names the subagent it launched, which is how a
  // description is bound to a SubagentStart (M46); the rest is what the
  // agent line's verb phrase reads (M9 fix 79).
  tool_name?: string;
  // The Bash tool's command is read after the call (M49) to see whether
  // it moved HEAD, and before it (fix 79) for the agent line's phrase.
  // The task tools' fields (M9 fix 153): TaskCreate's subject and
  // activeForm, TaskUpdate's taskId and what it sets, TodoWrite's whole
  // list. TaskCreate's id is in the response, not the input.
  tool_input?: { description?: string; subagent_type?: string; prompt?: string; command?: string; file_path?: string; notebook_path?: string; pattern?: string; url?: string; query?: string; skill?: string; subject?: unknown; activeForm?: unknown; taskId?: unknown; status?: unknown; todos?: unknown };
  tool_response?: unknown;
  // PreToolUse and PostToolUse name the call, so the HEAD read before a
  // git-writing command (M58) is matched to the read after it.
  tool_use_id?: string;
  // Every hook names the conversation's transcript file (M47).
  transcript_path?: string;
  // SessionStart: startup, resume, clear, compact, fork. Older docs call the
  // field `source`, newer ones `session_start_type`; both are read.
  source?: string;
  session_start_type?: string;
  // PreCompact and PostCompact: auto (the idle compactor's or a full window's) or manual (a typed /compact).
  trigger?: string;
  // Notification: permission_prompt, idle_prompt, elicitation_dialog, ...
  notification_type?: string;
  // StopFailure.
  error_type?: string;
  // CwdChanged puts the new directory in `cwd` and the old one here.
  previous_cwd?: string;
  // UserPromptSubmit carries what was typed; Stop carries the reply.
  prompt?: string;
  last_assistant_message?: string;
  // The emerald mod's own events (M9 fix 738), posted to the sink as hooks:
  // Spinner carries the spinner's word and the draw's id; TurnStart and
  // TurnComplete a turn's id, and TurnComplete how it ended and the turn's
  // summed usage. A subagent's turn names its agent in turn_agent_id, never
  // agent_id, which would send the event down the agent path.
  word?: string;
  spinner_id?: string;
  turn_id?: string;
  turn_agent_id?: string;
  reason?: string;
  is_aborted?: boolean;
  duration_ms?: number;
  usage?: unknown;
  // The mod's Measure (M9 fix 739): what $.session.usage() answers when a
  // unit moves, under one key so it meets none of the status line's fields.
  measure?: {
    context?: { tokens?: number; window?: number; percent?: number };
    rateLimits?: Array<{ kind?: string; percentUsed?: number; resetsAt?: string }>;
    cost?: { usd?: number };
    changed?: string[];
    model?: string | null;
  };
  // Stop: the background tasks (subagents and shells) still running when
  // the turn ended. Claude Code wakes the agent again when one finishes.
  background_tasks?: unknown;
  // StatusLine is not a Claude Code hook: it is the JSON Claude Code hands
  // its status line command after every turn, posted to the sink by the
  // wrapper the hooks installer sets, with hook_event_name added.
  model?: { id?: string; display_name?: string };
  context_window?: {
    used_percentage?: number;
    context_window_size?: number;
    total_input_tokens?: number;
    current_usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  // The same status line's cost block (M9 fix 154): the dollars so far at
  // API rates, beside durations and line counts the record does not keep.
  cost?: { total_cost_usd?: number };
  // The same status line's prompt cache block (M9 fix 772): its TTL, expiry in epoch seconds and warmth.
  prompt_cache?: { warm?: boolean; ttl?: string; expires_at?: number | null; [key: string]: unknown };
  // The same status line's effort (M9 fix 799): the level in force for the model, absent for a model with no effort setting. Claude Code's tool hooks carry the same block, unread.
  effort?: { level?: string };
  // The emerald mod's ToolAsk (M9 fix 742): the agent whose call asked,
  // under its own key since an agent_id would send the post to the agent
  // reducer, and the decision's rule; its reason is the `reason` above,
  // which TurnComplete uses for how a turn ended.
  ask_agent_id?: string;
  rule?: string;
  [key: string]: unknown;
}

// What the sidebar can show of a prompt or a reply: the first line that
// says anything, cut to a length that fits a row with room to spare.
export const SUMMARY_MAX = 200;

export function summarize(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '');
  if (line === undefined) return null;
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line;
}

// The first lines of an Agent call's prompt for its member's card (M9 fix 835): the first Limits.memberPromptLines lines that say anything, each trimmed and cut at SUMMARY_MAX as summarize cuts one, joined by a newline; null when none does.
export function promptHead(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .slice(0, Limits.memberPromptLines);
  if (lines.length === 0) return null;
  return lines.map((l) => (l.length > SUMMARY_MAX ? `${l.slice(0, SUMMARY_MAX - 1)}…` : l)).join('\n');
}

export type SessionEvent =
  | { type: 'hook'; payload: HookPayload; at: number }
  | { type: 'pty.exit'; exitCode: number | null; at: number }
  // The shell's prompt said where it is (OSC 9;9, read from the PTY bytes).
  | { type: 'cwd'; cwd: string; at: number }
  // The terminal title on the session changed (the daemon sets the field
  // first, then sends this so a name that follows it is recomputed).
  | { type: 'title'; at: number }
  // The user looked at a finished session.
  | { type: 'ack'; at: number }
  // Claude's task list read off its files (M9 fix 153): the daemon's
  // fallback when the hooks did not build it, a resumed conversation
  // or a call naming a task the list lacks.
  | { type: 'tasks'; tasks: SessionTask[]; at: number }
  // The daemon's periodic timer; flags a working session with no news.
  | { type: 'stale-check'; at: number; staleAfterMs: number }
  // A FinalTerm mark off the shell's PTY bytes (OSC 133, M9 fix 196): C
  // at the Enter that starts a command, D with the exit code at the
  // prompt after it (null when the prompt followed no command), A before
  // the prompt text, which changes nothing here. doneAfterMs is how long
  // a command must have run for its end to want a person.
  | { type: 'shell-mark'; mark: 'A' | 'C' | 'D'; code: number | null; at: number; doneAfterMs: number }
  // The daemon read Claude Code's folder trust dialog on the screen of a starting session, or read it gone (M9 fix 808).
  | { type: 'trust'; shown: boolean; at: number };

// applied-agent (M61): a known subagent's own Bash call, which the daemon
// reads for where the agent works and what it committed and which touches
// nothing on the parent's state; the reducer never sees one.
export type HookOutcome = 'applied' | 'applied-agent' | 'ignored-agent' | 'ignored-foreign' | 'unknown-event';

// Hook events that mean "Claude is busy on a turn". They also clear
// needs-input, because the prompt that blocked the turn was answered.
const WORKING_EVENTS = new Set([
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
  'PreCompact',
  'PostCompact',
]);

// Hook events about the team (M46): the parent's own SubagentStart and
// SubagentStop carry the subagent's agent_id, so they are read for the
// roster rather than dropped as fired inside it. They say nothing about
// the parent's state: a subagent starts mid-turn, and the Stop that ends
// the turn is what says whether the parent waits on it.
const TEAM_EVENTS = new Set(['SubagentStart', 'SubagentStop']);

// The tool hooks a subagent fires around its own Bash calls (M61). Read
// by the daemon for the member's folder, branch and commits when the
// agent is one the team knows; an inner agent's (which nobody started)
// stay dropped.
const AGENT_TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

export function isAgentToolHook(session: SessionInfo, payload: HookPayload): boolean {
  const id = payload.agent_id;
  if (typeof id !== 'string' || id === '') return false;
  const tool = payload.tool_name ?? '';
  if (!AGENT_TOOL_EVENTS.has(payload.hook_event_name ?? '') || !(HEAD_TOOLS.has(tool) || AGENT_TASK_TOOLS.has(tool))) return false;
  return session.team.some((m) => m.id === id && m.kind === 'agent');
}

// The tools that write a file (M9 fix 198), whose PostToolUse names the
// path: Edit, Write and MultiEdit in file_path, NotebookEdit in
// notebook_path. Read for the session's touched list, its own calls and
// a known member's alike; the reducer's classification is untouched,
// since a member's Edit still says nothing about the parent's state.
export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// The path a PostToolUse of an edit tool wrote, or null for any other
// hook. A PreToolUse is not enough: the call may still be refused.
export function touchedPath(payload: HookPayload): string | null {
  if (payload.hook_event_name !== 'PostToolUse' || !EDIT_TOOLS.has(payload.tool_name ?? '')) return null;
  const input = payload.tool_input;
  const p = payload.tool_name === 'NotebookEdit' ? input?.notebook_path : input?.file_path;
  return typeof p === 'string' && p !== '' ? p : null;
}

// Whether a member's hook is one the team knows (M9 fix 198): a touched
// file from an agent nobody started is dropped as its Bash calls are.
export function isKnownAgent(session: SessionInfo, agentId: string | undefined): boolean {
  return typeof agentId === 'string' && agentId !== '' && session.team.some((m) => m.id === agentId && m.kind === 'agent');
}

// The touched list with one more write: the same path (compared without
// case, since Windows does) moves to the end with the new time and
// agent rather than being listed twice, and the oldest go once the list
// is past Limits.touchedKept. The same list back when nothing moves.
export function appendTouched(list: readonly SessionTouched[], entry: SessionTouched): SessionTouched[] {
  const key = entry.path.toLowerCase();
  const rest = list.filter((t) => t.path.toLowerCase() !== key);
  return [...rest, entry].slice(-Limits.touchedKept);
}

const NOTIFICATION_REASONS: Record<string, NeedsInputReason> = {
  permission_prompt: 'permission',
  elicitation_dialog: 'elicitation',
  elicitation_url_dialog: 'elicitation',
  agent_needs_input: 'question',
};

// Shell sessions have no hooks, so they are idle until they exit.
export function initialState(kind: SessionKind): SessionState {
  return kind === 'claude' ? 'starting' : 'idle';
}

// Why a hook event would be dropped before it touches state. Exposed so the
// daemon can log the reason without re-deriving it.
// A nested `claude -p` inherits our env and reports a different session_id.
// Until the first SessionStart binds an id we accept whatever arrives, since
// the outer session always starts before anything it could spawn. And a
// shell's late status line or measure from the Claude that just left it
// (M9 fix 871).
export function isForeignHook(session: SessionInfo, payload: HookPayload): boolean {
  return (session.claudeSessionId !== null && payload.session_id !== session.claudeSessionId && !startsAfterEnd(session, payload)) || lateFromLeft(session, payload);
}

export function classifyHook(session: SessionInfo, payload: HookPayload): HookOutcome {
  const foreign = isForeignHook(session, payload);
  if (typeof payload.agent_id === 'string' && payload.agent_id !== '' && !TEAM_EVENTS.has(payload.hook_event_name ?? '')) {
    return !foreign && isAgentToolHook(session, payload) ? 'applied-agent' : 'ignored-agent';
  }
  if (foreign) return 'ignored-foreign';
  return typeof payload.hook_event_name === 'string' ? 'applied' : 'unknown-event';
}

// A /clear, a fork or a /resume of another conversation posts a
// SessionStart under a new session_id (M9 fix 185; Claude Code 2.1.272
// posts SessionEnd reason=clear on the old id, then SessionStart
// source=clear on the new), which read as a nested claude's and dropped
// every later hook of a Claude pane. What tells the two apart is the
// SessionEnd before it: nothing of the ended conversation posts again,
// so the first SessionStart after a SessionEnd is the pane's own,
// whatever its id, where a nested claude -p runs during a tool call with
// the conversation still open.
function startsAfterEnd(session: SessionInfo, payload: HookPayload): boolean {
  if (payload.hook_event_name !== 'SessionStart') return false;
  const last = spansOf(session).at(-1);
  return last !== undefined && last.endedAt !== null;
}

// M9 fix 871: a status line or a measure posted after its Claude left (35
// ms after the SessionEnd, at the install of fixes 825 to 858) is the
// departed Claude's, not the shell's, and would put back the figures leave
// just cleared. A new claude's line carries its own id and still applies,
// and one after a resume's SessionStart finds the id bound again.
function lateFromLeft(session: SessionInfo, payload: HookPayload): boolean {
  if (payload.hook_event_name !== 'StatusLine' && payload.hook_event_name !== 'Measure') return false;
  if (session.claudeSessionId !== null) return false;
  const last = spansOf(session).at(-1);
  return last !== undefined && last.endedAt !== null && last.conversation === payload.session_id;
}

// The record's spans, with a record from before the field (M9 fix 185)
// read as one open span off its own fields, so its first clear closes a
// span that holds what came before. A fresh record has no spans and no
// id, so it reads as none here; openSpan is handed the record as it was
// before the SessionStart bound the id (M9 fix 378), since read after the
// bind the fallback saw the id it was about to open and took the "same
// conversation, still open" branch, and a shell opened at 09:00 whose
// person typed claude at 11:00 got a first span from 09:00 that held
// every commit made before Claude existed.
function spansOf(session: SessionInfo): readonly SessionSpan[] {
  if (session.spans !== undefined) return session.spans;
  if (session.claudeSessionId === null) return [];
  return [{ conversation: session.claudeSessionId, remoteSessionId: session.remoteSessionId, startedAt: session.createdAt, endedAt: null, startHead: session.startHead }];
}

// A SessionStart names the conversation now open: the same one going on
// (a resume after a restart, a compact never gets here) leaves the list
// alone and reopens a closed span; another one closes the open span and
// opens the next, whose start commit the daemon reads. The list is read
// off `before`, the record as it stood before this hook bound the id (M9
// fix 378), so a fresh record's first SessionStart pushes a span at `at`
// like every later one; the rest of the reduce keeps reading the bound
// record.
function openSpan(session: SessionInfo, before: SessionInfo, conversation: string, at: number): SessionInfo {
  const spans = [...spansOf(before)];
  const last = spans.at(-1);
  if (last !== undefined && last.conversation === conversation) {
    if (last.endedAt === null) return session.spans === undefined ? { ...session, spans } : session;
    spans[spans.length - 1] = { ...last, endedAt: null };
    return { ...session, spans };
  }
  if (last !== undefined && last.endedAt === null) spans[spans.length - 1] = { ...last, endedAt: at };
  spans.push({ conversation, remoteSessionId: null, startedAt: at, endedAt: null, startHead: null });
  return { ...session, spans: spans.slice(-Limits.spansKept) };
}

// A SessionEnd or the process going closes the open span.
function closeSpan(session: SessionInfo, at: number): SessionInfo {
  const spans = [...spansOf(session)];
  const last = spans.at(-1);
  if (last === undefined || last.endedAt !== null) return session.spans === undefined && spans.length > 0 ? { ...session, spans } : session;
  spans[spans.length - 1] = { ...last, endedAt: at };
  return { ...session, spans };
}

// Claude leaving, on a SessionEnd or on the prompt coming back without
// one (M9 fix 360). A shell that ran claude is a shell again once Claude
// leaves: the id is dropped so the label goes back and the next claude
// typed into the same shell binds, instead of every event being dropped
// as foreign, and lastEventAt goes with it so the badge goes too
// (hasState). A Claude session keeps its id, which a resume needs. The
// model and the context fill go with the Claude that reported them (M9
// fix 39): a shell back at its prompt has neither, where a Claude
// session keeps them as the row's last known reading. The row goes
// straight back to where the shell's own prompt last said it was (M9
// fix 74), which is also where the next prompt will report, so nothing
// moves twice; with no report yet both folders stay and the next one
// moves them together. The group follows the shell's cd's from here (M9
// fix 60), and the transcript goes with it too (M47): the next claude
// typed into the shell names its own. The conversation stays: a resume
// picks it up (M48). The conversation's span closes (M9 fix 185), before
// a shell drops the id the span was read from; the SessionStart that
// follows a /clear opens the next. Claude's conversation title went with
// it, whether or not the empty title it writes on exit has arrived yet.
// So did its team. A shell's keep-whole mark goes with its Claude (M9 fix
// 833); a Claude session's stays through its SessionEnd.
function leave(session: SessionInfo, at: number): SessionInfo {
  let next = closeSpan(session, at);
  if (session.kind === 'shell') {
    next = { ...next, claudeSessionId: null, lastEventAt: null, model: null, effort: null, contextPercent: null, contextWindow: null, tokens: null, costUsd: null, cache: null, tasks: [], cwd: next.shellCwd ?? next.cwd, groupCwd: next.shellCwd ?? next.groupCwd, transcriptPath: null, ...(next.keepWhole === true ? { keepWhole: false } : {}) };
  }
  return transition(followAutoName(clearTeam(next), null), 'idle', at, null);
}

export function reduce(session: SessionInfo, event: SessionEvent): SessionInfo {
  switch (event.type) {
    case 'hook':
      return reduceHook(session, event.payload, event.at);
    case 'pty.exit':
      // Always wins, even over needs-input: a dead process needs nothing.
      // The open conversation span ends with the process (M9 fix 185).
      return {
        ...transition(closeSpan(session, event.at), 'exited', event.at),
        exitCode: event.exitCode,
        pid: null,
        stale: false,
        needsInputReason: null,
        team: [],
      };
    case 'cwd': {
      // Not a hook, so lastEventAt stays: a prompt says nothing about Claude.
      // The shell's own report is remembered apart from the hook cwd (M9
      // fix 74); a Claude-kind session has no prompt of its own.
      const reported = session.kind === 'shell' && event.cwd !== session.shellCwd ? { ...session, shellCwd: event.cwd } : session;
      return placeIn(reported, event.cwd);
    }
    case 'title':
      // A cleared title says nothing about the name: Claude writes an
      // empty one as it exits, and SessionEnd does the renaming, so the
      // row does not flip through the folder's name for a frame (M9 fix 74).
      return session.title === null ? session : followAutoName(session);
    case 'ack':
      // A plain shell's failed command (M9 fix 196) is looked at the same
      // way; a Claude's errored waits for the next prompt.
      return ackable(session) ? transition(session, 'idle', event.at) : session;
    case 'shell-mark':
      return reduceShellMark(session, event);
    case 'tasks': {
      // The files are the truth about the list; the same list twice is
      // no push. What the hooks attributed rides through the reread (M9
      // fix 394), since the files say nothing about who owns a task.
      const tasks = keepTaskAgents(event.tasks, session.tasks ?? []).slice(-Limits.tasksKept);
      return sameTaskList(session.tasks ?? [], tasks) ? session : { ...session, tasks };
    }
    case 'stale-check': {
      if (session.state !== 'working' || session.stale) return session;
      const since = staleSince(session);
      return event.at - since >= event.staleAfterMs ? { ...session, stale: true, staleThresholdMs: event.staleAfterMs } : session;
    }
    case 'trust':
      // Only a starting row takes the dialog, and only the dialog's own
      // ask goes back to starting, so a read that lands after the
      // SessionStart moves nothing (M9 fix 808).
      if (event.shown) return session.state === 'starting' ? transition(session, 'needs-input', event.at, 'trust') : session;
      return session.state === 'needs-input' && session.needsInputReason === 'trust' ? transition(session, 'starting', event.at, null) : session;
    default:
      return session;
  }
}

// The last command's record follows the marks (M9 fix 196). Only a plain
// shell (no Claude bound, see shellCommand) is moved between states by
// them: while Claude runs in the shell its hooks own the state, and the
// D that lands when Claude exits ends the `claude` command on the record
// without touching what SessionEnd set. A D with a code and no C before
// it (PSReadLine absent, so no Enter handler) still records the end, as
// a command of no length, so the mark can say failed; a D with no code
// (an empty Enter, a Ctrl+C at the prompt) and a D after a D change
// nothing. A long command that hosted a conversation (a span closed
// after its C) ends without wanting anyone: leaving Claude was the
// person's own act. And a command whose C opened the span still open
// when its D lands was that Claude, gone without a SessionEnd (M9 fix
// 360: Claude Code 2.1.272 and later post none on /exit under the
// daemon), so the prompt's return reports the leaving itself and the
// row is a shell again the instant the prompt is back. A cmd row has no
// C, so there it is the prompt itself: a D with Claude bound and a hook
// landed is the leaving (M9 fix 649).
function reduceShellMark(session: SessionInfo, event: { mark: 'A' | 'C' | 'D'; code: number | null; at: number; doneAfterMs: number }): SessionInfo {
  const plain = session.claudeSessionId === null && session.kind === 'shell';
  const command = session.command ?? null;
  switch (event.mark) {
    case 'C': {
      const next = { ...session, command: { state: 'running', exitCode: null, startedAt: event.at, endedAt: null } as ShellCommand };
      // The new command clears what the last one left: the wanting badge
      // and the mark's failed colour go with it.
      return plain && (session.state === 'done' || session.state === 'errored') ? { ...transition(next, 'idle', event.at), errorType: null } : next;
    }
    case 'D': {
      if (command !== null && command.state !== 'running') return session;
      // cmd writes no C (M9 fix 649), so its D never ends a command and
      // fix 360's leave below never fires in a cmd row. But cmd draws its
      // prompt only when nothing holds the console, so a D in a cmd row
      // with Claude bound and a hook of the conversation landed is the
      // leaving. A resumed row's first prompt has no hook yet.
      if (!plain && session.kind === 'shell' && session.shell === 'cmd' && command === null && session.lastEventAt !== null) return leave(session, event.at);
      if (command === null && event.code === null) return session;
      const startedAt = command?.startedAt ?? event.at;
      const failed = event.code !== null && event.code !== 0;
      const ended: ShellCommand = { state: failed ? 'failed' : 'ok', exitCode: event.code, startedAt, endedAt: event.at };
      const next = { ...session, command: ended };
      const lastSpan = spansOf(session).at(-1);
      // The command was `claude` and Claude is still bound: a hook of the
      // conversation landed while the command ran and no SessionEnd
      // closed its span, so the prompt's return is the leaving. The hook
      // clock is the read, not the span's start: a resumed conversation
      // reopens its old span with its old start, from before this
      // command (a fresh shell's first span starts at its SessionStart
      // since M9 fix 378, so it would read either way).
      if (!plain && session.kind === 'shell' && command !== null && session.lastEventAt !== null && session.lastEventAt >= startedAt && lastSpan !== undefined && lastSpan.endedAt === null) return leave(next, event.at);
      if (!plain || session.state !== 'idle' || event.at - startedAt < event.doneAfterMs) return next;
      // The command was `claude`: a conversation closed after it began.
      // Leaving Claude is the person's own act, so its end wants nobody.
      if (lastSpan !== undefined && lastSpan.endedAt !== null && lastSpan.endedAt >= startedAt) return next;
      return transition(next, failed ? 'errored' : 'done', event.at);
    }
    default:
      return session;
  }
}

function reduceHook(session: SessionInfo, payload: HookPayload, at: number): SessionInfo {
  const outcome = classifyHook(session, payload);
  if (outcome === 'ignored-foreign') return session;
  // A hook that lands after the process has gone says nothing about a
  // process (M9 fix 174): Claude Code 2.1.272 posts a killed session's
  // SessionEnd a moment after its PTY exits, and that SessionEnd's own
  // case put the row back at idle two milliseconds after `emmer kill`
  // had it exited, so `emmer wait --for exited` timed out on a session
  // whose process was gone. The event's fields still land (the shell's
  // unbinding, the transcript), the state and its clock do not, and the
  // team, the pause list and the ask stay as the exit left them (M9 fix
  // 506), so a late Agent or Stop counts no agents on a gone row.
  if (session.state === 'exited') {
    const applied = reduceLiveHook(session, payload, at);
    return { ...applied, state: 'exited', stateSince: session.stateSince, pid: null, team: session.team, waitingOn: session.waitingOn, needsInputReason: session.needsInputReason };
  }
  return reduceLiveHook(session, payload, at);
}

function reduceLiveHook(session: SessionInfo, payload: HookPayload, at: number): SessionInfo {
  const outcome = classifyHook(session, payload);
  // The ask as it stood before this event, for the mod's ToolRunning
  // (M9 fix 775), which settleAsk clears.
  const askedBefore = session.askedFor ?? null;
  session = settleAsk(session, payload);
  // A subagent's own hooks say nothing about the parent's turn, with one
  // exception (M9 fix 109): its permission prompt blocks the agent, and
  // nothing but the agent's own next event answers it.
  if (outcome === 'ignored-agent' || outcome === 'applied-agent') return reduceAgentHook(session, payload, at);

  // A status line says what the session is running, not whether Claude is
  // busy, so it leaves the state and lastEventAt alone.
  if (payload.hook_event_name === 'StatusLine') return applyStatusLine(session, payload);
  // Nor does the mod's measure (M9 fix 739).
  if (payload.hook_event_name === 'Measure') return applyMeasure(session, payload);

  // Any accepted event proves the session is alive, whatever it says.
  let next: SessionInfo = { ...session, lastEventAt: at, stale: false, staleThresholdMs: null };
  const name = payload.hook_event_name;
  // Every hook says where the transcript is; the first one binds it and a
  // --resume's SessionStart says the same file again (M47). A new file is
  // a new conversation, whose claude.ai session (M58) is read afresh.
  if (typeof payload.transcript_path === 'string' && payload.transcript_path !== '' && payload.transcript_path !== next.transcriptPath) {
    next = { ...next, transcriptPath: payload.transcript_path, remoteSessionId: next.transcriptPath === null ? next.remoteSessionId : null };
  }
  // Every hook of the session's own says where Claude is now (M9 fix
  // 113). CwdChanged alone missed a move: Claude Code fires it when a tool
  // call's cd sticks, but not when the harness puts the tool shell back,
  // so a session sat in a folder it had left (a log folder outside any
  // repo, the rail saying "Not a git repository") until the next cd.
  // SessionEnd is left to its own case below (M9 fix 74 decides what it
  // moves), since its cwd is where Claude was started, not where it went;
  // and a shell nothing has bound yet keeps its prompt's folder, since
  // until SessionStart binds the id a hook is taken on trust and its cwd
  // says where some Claude is, not where this shell stands.
  if (name !== 'SessionEnd' && runningKind(next) === 'claude') next = placeIn(next, payload.cwd);

  if (name === 'SessionStart') {
    // The first binds the id; one after a SessionEnd rebinds it, since
    // a /clear or a fork is the same pane on a new conversation (M9 fix
    // 185, startsAfterEnd); any other with a different id was dropped as
    // foreign before this. An id of any other shape binds nothing (M9
    // fix 508), since a resume types it into a shell.
    if (isSessionId(payload.session_id) && next.claudeSessionId !== payload.session_id) {
      next = { ...next, claudeSessionId: payload.session_id };
    }
    // Where Claude started is where the session is: a shell that runs
    // claude in another folder is placed there the moment it starts, and
    // grouped there too, whatever placeIn kept (the id is bound above).
    // The title may have named the conversation before the hook bound
    // the id.
    next = followAutoName(placeIn(next, payload.cwd));
    // A new start is no longer the last one's end (M9 fix 813).
    if ((next.endReason ?? null) !== null) next = { ...next, endReason: null };
    // A compact restarts the session object mid-turn; Claude is still working.
    if ((payload.source ?? payload.session_start_type) === 'compact') return next;
    if (typeof payload.cwd === 'string' && payload.cwd !== '' && payload.cwd !== next.groupCwd) next = { ...next, groupCwd: payload.cwd };
    // The conversation a resume would pick up (M48): this one, in this
    // folder, with the args a Claude session was started with (a shell's
    // are the shell's, not Claude's, so a shell remembers none).
    if (isSessionId(payload.session_id) && typeof payload.cwd === 'string' && payload.cwd !== '') {
      const conversation = { id: payload.session_id, cwd: payload.cwd, args: next.kind === 'claude' ? [...next.args] : [] };
      if (!sameConversation(next.conversation, conversation)) next = { ...next, conversation };
    }
    // The span for the conversation (M9 fix 185): the same one going on,
    // or a new one after the last is closed.
    if (isSessionId(payload.session_id)) next = openSpan(next, session, payload.session_id, at);
    // A new conversation (a clear, a resume, a fork) sent nothing out yet.
    return transition(clearTeam(next), 'idle', at, null);
  }
  if (name !== undefined && TEAM_EVENTS.has(name)) return reduceTeam(next, payload, at);
  if (name !== undefined && WORKING_EVENTS.has(name)) {
    // A new prompt is a new turn, so the previous turn's failure and reply
    // are history. A prompt with no text (a slash command that expands to
    // nothing) keeps the last one rather than blanking the row.
    if (name === 'UserPromptSubmit') {
      const prompt = summarize(payload.prompt);
      // A task notification is Claude Code waking the agent for a finished
      // background task, not a person asking: the row keeps the last thing
      // the person asked and takes the reply Claude gives to this.
      const asked = prompt === null ? null : isTaskNotification(payload.prompt) ? null : prompt;
      next = { ...next, errorType: null, lastPrompt: asked ?? next.lastPrompt, lastPromptAt: asked === null ? (next.lastPromptAt ?? null) : at, lastReply: prompt === null ? next.lastReply : null, lastReplyAt: prompt === null ? (next.lastReplyAt ?? null) : null };
      // A person's prompt is a new turn, and the members that returned
      // during the last one have been seen; a task notification is the
      // same turn going on, so they stay.
      if (!isTaskNotification(payload.prompt)) next = dropReturned(next);
      // And so has the checklist it built (M9 fix 153): a list belongs
      // to a turn, and the files bring it back if Claude carries on with
      // it. A task notification is the same turn, so the list stays.
      if (!isTaskNotification(payload.prompt) && (next.tasks?.length ?? 0) > 0) next = { ...next, tasks: [] };
      // A new turn's transcript text starts over (M47), and its tool line.
      if (next.liveReply !== null || next.liveTool !== null || (next.liveVerb ?? null) !== null) next = { ...next, liveReply: null, liveTool: null, liveVerb: null };
      // And whatever an agent was waiting on belongs to the last turn.
      next = clearPermissions(next);
    }
    // The call Claude is making takes the agent line until its next text
    // lands (M9 fix 79): the latest of the two is what the pane shows.
    if (name === 'PreToolUse') {
      const phrase = toolPhrase(payload.tool_name, payload.tool_input);
      if (phrase !== null && (phrase !== next.liveTool || next.liveReply !== null)) next = { ...next, liveTool: phrase, liveReply: null };
    }
    if (name === 'PostToolUse' && payload.tool_name === 'Agent') next = reduceAgentTool(next, payload, at);
    if (name === 'PostToolUse' && TASK_TOOLS.has(payload.tool_name ?? '')) next = reduceTaskTool(next, payload);
    // The parent's own call answers nothing an agent asked: the prompt
    // stays on show until the agent's own event lands (M9 fix 109).
    if (name !== 'UserPromptSubmit' && awaitsAgent(next)) return next;
    // An automatic compaction of a row at rest (M9 fix 812): the idle
    // compactor's PreCompact found it idle, waiting or done, and its
    // PostCompact puts it back there with its age, since nobody asked for
    // a turn. A prompt, a Stop or an exit in between clears the record
    // (here for the prompt, in transition for the others).
    const from = next.compactFrom ?? null;
    if (name === 'PostCompact' && from !== null) {
      return { ...transition(next, from.state, at, null), stateSince: from.since, compactFrom: null };
    }
    if (name === 'PreCompact' && payload.trigger === 'auto' && (next.state === 'idle' || next.state === 'waiting' || next.state === 'done')) {
      const moved = transition({ ...next, compactFrom: { state: next.state, since: next.stateSince } }, 'working', at, null);
      // The label reads waitingOn only at waiting, so the list rides the
      // compaction unseen and comes back with the row.
      return next.state === 'waiting' ? { ...moved, waitingOn: next.waitingOn } : moved;
    }
    if (name === 'UserPromptSubmit' && from !== null) next = { ...next, compactFrom: null };
    return transition(next, 'working', at, null);
  }
  switch (name) {
    case 'PermissionRequest':
      // An AskUserQuestion's dialog is a question to the person, not a tool to allow (M9 fix 802).
      return transition(next, 'needs-input', at, payload.tool_name === 'AskUserQuestion' ? 'question' : 'permission');
    case 'Notification': {
      // Own keys only (M9 fix 510): `constructor` is no notification type.
      const type = payload.notification_type ?? '';
      const reason = Object.hasOwn(NOTIFICATION_REASONS, type) ? NOTIFICATION_REASONS[type] : undefined;
      // idle_prompt and friends carry no state we do not already know.
      if (reason === undefined) return next;
      // The parent's permission_prompt for an agent's request follows
      // the agent's own PermissionRequest, which already said whose it
      // is; the plain reason would lose that.
      if (reason === 'permission' && awaitsAgent(next)) return next;
      // Its permission_prompt follows and would put the plain reason back (M9 fix 802).
      if (reason === 'permission' && next.state === 'needs-input' && next.needsInputReason === 'question') return next;
      return transition(next, 'needs-input', at, reason);
    }
    case 'Stop': {
      if (next.turn && !next.turn.stopped) next = { ...next, turn: { ...next.turn, stopped: true } };
      // A turn that ends with tasks still running is a pause, not a finish:
      // the next task to end wakes the agent, so nobody needs to look yet.
      // The list is set after the transition, which clears it, so a second
      // pause replaces what the first one said (M9 fix 52).
      const running = parseRunning(payload.background_tasks);
      const waitingOn = running.map(({ type, description, command }) => ({ type, description, command }));
      const reply = summarize(payload.last_assistant_message);
      const paused = transition(reply === null ? next : { ...next, lastReply: reply, lastReplyAt: at }, waitingOn.length > 0 ? 'waiting' : 'done', at, null);
      const listed = sameTasks(paused.waitingOn, waitingOn) ? paused : { ...paused, waitingOn };
      // The list is the one word on background shells, and the last word
      // on what is still out: a member it does not name has returned.
      const settled = reconcileTeam(listed, running, at);
      // An agent still out and still asking is what the pause waits on.
      return settled.state === 'waiting' && settled.team.some(asksPermission) ? transition(settled, 'needs-input', at, 'agent-permission') : settled;
    }
    case 'StopFailure':
      if (next.turn && !next.turn.stopped) next = { ...next, turn: { ...next.turn, stopped: true } };
      return { ...transition(next, 'errored', at, null), errorType: payload.error_type ?? 'unknown' };
    case 'SessionEnd':
      // Claude left (leave says what goes with it and what stays). A
      // shell whose prompt already reported the leaving (M9 fix 360) is
      // plain by now, and leaving it again moves nothing. A Claude
      // session keeps the reason (M9 fix 813), by which an /exit drops its
      // pane to a shell; a shell hosting Claude is a shell already. The key
      // is touched only when there is a reason to keep or one to clear.
      if (next.kind === 'claude') {
        const reason = typeof payload.reason === 'string' ? payload.reason : null;
        if (reason !== null || (next.endReason ?? null) !== null) next = { ...next, endReason: reason };
      }
      return leave(next, at);
    case 'CwdChanged':
      return placeIn(next, payload.cwd);
    // The emerald mod's events (M9 fix 738). The spinner's word as the
    // engine draws it, where the screen's scanner guessed it off the pty.
    case 'Spinner': {
      const word = payload.word;
      if ((next.state !== 'working' && next.state !== 'needs-input') || typeof word !== 'string' || word === '' || word === next.liveVerb) return next;
      return { ...next, liveVerb: word };
    }
    // The line is the record and UserPromptSubmit stays what moves the row;
    // the turn's id is kept for TurnComplete below (M9 fix 830).
    case 'TurnStart':
      if (payload.turn_agent_id !== undefined || typeof payload.turn_id !== 'string' || payload.turn_id === '') return next;
      return { ...next, turn: { id: payload.turn_id, stopped: false } };
    // A turn that ends with no Stop (an Escape or Ctrl+C mid-turn, or an
    // Escape at a permission dialog, which 2.1.301 reports as reason
    // "answer" with is_aborted false) left the row at working or
    // needs-input. A finished turn's Stop lands about a second before its
    // TurnComplete and has moved the row on already, so a row still busy
    // here waits on the person: idle, never done, so no chime and no
    // attention. A subagent's turn moves nothing, nor does a paused turn
    // waiting on an asking member (M9 fixes 738 and 774). A prompt sent
    // within that second (M9 fix 830) is a new turn the late TurnComplete
    // must not end, so a TurnComplete is read against the turn TurnStart
    // opened: another turn's id, or a turn already stopped, moves nothing.
    case 'TurnComplete': {
      if (payload.turn_agent_id !== undefined) return next;
      const open = next.turn ?? null;
      if (open !== null) {
        if (open.id !== payload.turn_id) return next;
        if (open.stopped) return { ...next, turn: null };
        next = { ...next, turn: null };
      }
      if ((next.state === 'working' || next.state === 'needs-input') && !awaitsAgent(next)) return transition(next, 'idle', at, null);
      return next;
    }
    case 'ToolAsk':
      // The mod's ask at the decision (M9 fix 742) names what is asked
      // for and moves nothing: in auto mode an ask goes to the classifier
      // and nobody is asked, and a needs-input would chime falsely. The
      // PermissionRequest that follows a real dialog moves the row, and
      // transition keeps the field through it.
      return { ...next, askedFor: { words: askWords(payload.tool_name, payload.tool_input) ?? 'a tool call', toolUseId: payload.tool_use_id ?? null, agentId: payload.ask_agent_id ?? null, at } };
    // The mod's ToolRunning (M9 fix 775): the call's progress row drew, so
    // the call is running and its dialog was answered Allow. Only the
    // parent's own permission ask moves; an agent's is settled by the
    // agent's own events.
    case 'ToolRunning':
      if (next.state === 'needs-input' && next.needsInputReason === 'permission' && (askedBefore === null || askedBefore.toolUseId === null || askedBefore.toolUseId === payload.tool_use_id)) return transition(next, 'working', at, null);
      return next;
    default:
      return next;
  }
}

// The mod's ask is over (M9 fix 742) when the turn is, or when the call
// it was for ends: allowed and run, failed, or denied. Any agent's event
// counts, since the ask may be an agent's. One with no call id is ended
// by any call's end. The same object when nothing is cleared.
const ASK_ENDS_TURN = new Set(['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionStart', 'SessionEnd', 'TurnComplete']);
const ASK_ENDS_CALL = new Set(['PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'ToolRunning']);

function settleAsk(session: SessionInfo, payload: HookPayload): SessionInfo {
  const asked = session.askedFor;
  if (asked === undefined || asked === null) return session;
  const name = payload.hook_event_name ?? '';
  // A background member's turn ending while the parent's dialog is up
  // answers nothing (M9 fix 774).
  if (name === 'TurnComplete' && payload.turn_agent_id !== undefined) return session;
  const ended = ASK_ENDS_TURN.has(name) || (ASK_ENDS_CALL.has(name) && (asked.toolUseId === null || payload.tool_use_id === asked.toolUseId));
  return ended ? { ...session, askedFor: null } : session;
}

// Claude Code's task list tools (M9 fix 153), read off the parent's own
// PostToolUse: TaskCreate adds one (its id is in the response, the
// input has the subject and the activeForm), TaskUpdate sets one task's
// status or words by taskId (deleted takes it out), TodoWrite replaces
// the list whole (older builds; its entries have content in place of
// subject and no id, so they are numbered in order). A subagent's own
// TaskCreate and TaskUpdate come through reduceAgentHook and land in the
// same list (M9 fix 394), since Claude Code writes them into the parent's
// own task folder and the session's count has always held them; what the
// member's hook adds is the agentId the files cannot carry.
export const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite']);

// The task tools a member's hook is read for (M9 fix 394). TodoWrite is
// not among them: it replaces the list whole, which a member has no
// business doing to its parent's, so a member's TodoWrite is dropped as
// its other tool hooks are.
const AGENT_TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate']);

const TASK_STATUSES = new Set<string>(['pending', 'in_progress', 'completed']);

function readTaskStatus(v: unknown): SessionTaskStatus | null {
  return typeof v === 'string' && TASK_STATUSES.has(v) ? (v as SessionTaskStatus) : null;
}

const readWords = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

// One task as its file under ~/.claude/tasks/<id>/ holds it, or as a
// TodoWrite entry gives it (content for subject, no id). Null for
// anything without a subject or a known status, so a stray file is
// skipped rather than counted. agentId is read where it is written (M9
// fix 394): the record on disk carries it, a task file never does.
export function readTask(v: unknown, fallbackId: string | null = null): SessionTask | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const id = typeof r['id'] === 'string' && r['id'] !== '' ? r['id'] : typeof r['id'] === 'number' ? String(r['id']) : fallbackId;
  const subject = readWords(r['subject']) ?? readWords(r['content']);
  const status = readTaskStatus(r['status']);
  if (id === null || subject === null || status === null) return null;
  const agentId = readWords(r['agentId']);
  return { id, subject, activeForm: readWords(r['activeForm']), status, ...(agentId === null ? {} : { agentId }) };
}

// The whole list in file order: ids sort as numbers where they are
// numbers, which Claude Code's are, so task 10 follows task 9.
export function sortTasks(tasks: readonly SessionTask[]): SessionTask[] {
  return [...tasks].sort((a, b) => {
    const na = Number(a.id);
    const nb = Number(b.id);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.id.localeCompare(b.id);
  });
}

// Whether a TaskUpdate named a task the list lacks (M9 fix 153): the
// daemon then reads the files, since a list cleared by the last prompt
// is being carried on.
export function namesUnknownTask(session: Pick<SessionInfo, 'tasks'>, payload: HookPayload): boolean {
  if (payload.hook_event_name !== 'PostToolUse' || payload.tool_name !== 'TaskUpdate') return false;
  const id = taskIdOf(payload.tool_input?.taskId);
  return id !== null && !(session.tasks ?? []).some((t) => t.id === id);
}

const taskIdOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : null);

// owner is the member the call came from (M9 fix 394), null for the
// session's own; a member's call stamps the task it names, so a task
// created before the member was known and updated after it still ends up
// attributed.
function reduceTaskTool(session: SessionInfo, payload: HookPayload, owner: string | null = null): SessionInfo {
  const tasks = session.tasks ?? [];
  const input = payload.tool_input ?? {};
  const own = owner === null ? {} : { agentId: owner };
  if (payload.tool_name === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? input.todos : [];
    const list = todos.map((t, i) => readTask(t, String(i + 1))).filter((t): t is SessionTask => t !== null).slice(-Limits.tasksKept);
    return sameTaskList(tasks, list) ? session : { ...session, tasks: list };
  }
  if (payload.tool_name === 'TaskCreate') {
    const response = typeof payload.tool_response === 'object' && payload.tool_response !== null ? (payload.tool_response as { task?: unknown }).task : undefined;
    // No id in the response (an older build): the next number up.
    const next = String(tasks.reduce((max, t) => Math.max(max, Number.isFinite(Number(t.id)) ? Number(t.id) : 0), 0) + 1);
    const made = readTask({ ...(typeof response === 'object' && response !== null ? response : {}), subject: input.subject, activeForm: input.activeForm, status: 'pending' }, next);
    if (made === null) return session;
    const task: SessionTask = { ...made, ...own };
    return { ...session, tasks: sortTasks([...tasks.filter((t) => t.id !== task.id), task]).slice(-Limits.tasksKept) };
  }
  // TaskUpdate: the named task takes what the call set.
  const id = taskIdOf(input.taskId);
  const task = tasks.find((t) => t.id === id);
  if (task === undefined) return session;
  if (input.status === 'deleted') return { ...session, tasks: tasks.filter((t) => t !== task) };
  const updated: SessionTask = {
    ...task,
    status: readTaskStatus(input.status) ?? task.status,
    subject: readWords(input.subject) ?? task.subject,
    activeForm: readWords(input.activeForm) ?? task.activeForm,
    ...own,
  };
  if (sameTask(updated, task)) return session;
  return { ...session, tasks: tasks.map((t) => (t === task ? updated : t)) };
}

function sameTask(a: SessionTask, b: SessionTask): boolean {
  return a.id === b.id && a.subject === b.subject && a.activeForm === b.activeForm && a.status === b.status && a.agentId === b.agentId;
}

function sameTaskList(a: readonly SessionTask[], b: readonly SessionTask[]): boolean {
  return a.length === b.length && a.every((t, i) => sameTask(t, b[i]!));
}

// The list off the task files with what the hooks attributed kept (M9
// fix 394): a task file has no owner, so a plain reread would drop the
// member a hook named it for. A task the hooks never saw stays unowned
// and draws no strip.
export function keepTaskAgents(files: readonly SessionTask[], held: readonly SessionTask[]): SessionTask[] {
  const owners = new Map(held.filter((t) => t.agentId !== undefined).map((t) => [t.id, t.agentId!]));
  return files.map((t) => {
    const owner = owners.get(t.id);
    return owner === undefined ? t : { ...t, agentId: owner };
  });
}

// The tasks of one member (M9 fix 394), in the session's own order, for
// the lid's strip and the card it opens. Empty for a member no hook ever
// attributed a task to, which is what says the box draws no strip.
export function tasksOfAgent(session: Pick<SessionInfo, 'tasks'>, agentId: string): SessionTask[] {
  return (session.tasks ?? []).filter((t) => t.agentId === agentId);
}

// One group of the whole-list card (M9 fix 435): the parent's own tasks
// carry no agentId, so a flat list read them mixed with every member's
// and did not say whose each was. name is null for the own group, which
// draws no heading; a member's is the name its lid box uses (the same
// call as ShadeTeam's: the description memberParts reads off the
// SubagentStart or Agent hook, else the type, else the bare kind).
export interface TaskGroup {
  agentId: string | null;
  name: string | null;
  tasks: SessionTask[];
}

export function groupTasksByOwner(session: Pick<SessionInfo, 'tasks' | 'team'>): TaskGroup[] {
  const tasks = session.tasks ?? [];
  const groups: TaskGroup[] = [];
  const own = tasks.filter((t) => t.agentId === undefined);
  if (own.length > 0) groups.push({ agentId: null, name: null, tasks: own });
  for (const m of session.team) {
    const mine = tasksOfAgent(session, m.id);
    if (mine.length === 0) continue;
    const { kind, task } = memberParts(m, 0);
    groups.push({ agentId: m.id, name: task ?? m.type ?? kind, tasks: mine });
  }
  return groups;
}

// The prompt Claude Code submits on the agent's behalf when a background
// task ends, which starts with the tag.
export function isTaskNotification(prompt: unknown): boolean {
  return typeof prompt === 'string' && prompt.trimStart().startsWith('<task-notification>');
}

// The running entries of a Stop's background_tasks, as the badge keeps
// them (M9 fix 52). The field is missing on an older Claude Code, which
// reads as none running. A shell's command can be a whole script; its
// first line, cut short, is enough to say which one.
export const COMMAND_MAX = 120;

// A running entry as the badge (waitingOn) and the roster (team) both read
// it: one parse, so the two cannot disagree. The id is Claude Code's task
// id, the agent_id for a subagent; an entry without one can still be
// waited on but cannot be a member.
export interface RunningTask extends WaitingTask {
  id: string | null;
}

export function parseRunning(tasks: unknown): RunningTask[] {
  if (!Array.isArray(tasks)) return [];
  const out: RunningTask[] = [];
  for (const t of tasks) {
    if (typeof t !== 'object' || t === null) continue;
    const { id, status, type, description, command } = t as { id?: unknown; status?: unknown; type?: unknown; description?: unknown; command?: unknown };
    if (status !== 'running') continue;
    const line = typeof command === 'string' ? (command.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '') ?? null) : null;
    out.push({
      id: typeof id === 'string' && id !== '' ? id : null,
      type: typeof type === 'string' && type !== '' ? type : 'task',
      description: typeof description === 'string' && description.trim() !== '' ? description.trim() : null,
      command: line === null ? null : line.length > COMMAND_MAX ? `${line.slice(0, COMMAND_MAX - 1)}…` : line,
    });
  }
  return out;
}

// The team's own events (M46). A SubagentStart with an id nobody has seen
// adds a running agent; a known one fills in the type if it was missing
// (the Agent tool's PostToolUse can land first, and carries no type when
// the caller named none). A SubagentStop for a member marks it returned;
// one for an unknown id (an inner agent, which starts inside a subagent
// and reports only its stop) is nothing.
function reduceTeam(session: SessionInfo, payload: HookPayload, at: number): SessionInfo {
  const id = payload.agent_id;
  if (typeof id !== 'string' || id === '') return session;
  const type = typeof payload.agent_type === 'string' && payload.agent_type !== '' ? payload.agent_type : null;
  if (payload.hook_event_name === 'SubagentStart') return upsertMember(session, id, 'agent', { type }, at);
  const member = session.team.find((m) => m.id === id);
  if (member === undefined || member.outcome !== 'running') return session;
  const done: TeamMember = { ...member, type: member.type ?? type, endedAt: at, outcome: 'returned' };
  // The key is only written where an ask was, so a member that never
  // asked reads as it did.
  const returned = withTeam(session, session.team.map((m) => (m === member ? (asksPermission(member) ? { ...done, permission: null } : done) : m)));
  return releaseAgentPermission(returned, at);
}

// A subagent's own hooks (M9 fix 109). Its PermissionRequest marks the
// member as asking and puts the row at needs-input for it, unless the
// parent's own permission already holds the row (that one blocks harder
// and only the parent's next event answers it); its PostToolUse,
// PostToolUseFailure or PermissionDenied clears the ask and releases the
// row once no agent is asking. Any tool counts, since a permission is
// asked for an Edit as much as for a Bash; the daemon reads the Bash
// ones for the member's folder before this runs. An inner agent nobody
// started, or a foreign conversation's, is not a member and changes
// nothing.
function reduceAgentHook(session: SessionInfo, payload: HookPayload, at: number): SessionInfo {
  const id = payload.agent_id;
  if (typeof id !== 'string' || id === '') return session;
  if (session.claudeSessionId !== null && payload.session_id !== session.claudeSessionId) return session;
  const member = session.team.find((m) => m.id === id && m.kind === 'agent' && m.outcome === 'running');
  if (member === undefined) return session;
  return reduceMemberHook(heardFromTeam(session, at), member, payload, at);
}

// A known member's hook is a sign of life for its parent (M9 fix 507): a
// parent blocked on a synchronous subagent posts nothing of its own for
// as long as the agent works. The clock steps a minute at a time, so a
// burst of tool calls is one push; a hook on a flagged row clears it.
function heardFromTeam(session: SessionInfo, at: number): SessionInfo {
  if (at - (session.teamEventAt ?? 0) < Limits.teamClockStepMs) return session;
  return { ...session, teamEventAt: at, stale: false, staleThresholdMs: null };
}

function reduceMemberHook(session: SessionInfo, member: TeamMember, payload: HookPayload, at: number): SessionInfo {
  const id = member.id;
  const name = payload.hook_event_name;
  if (name === 'PermissionRequest') {
    const tool = typeof payload.tool_name === 'string' && payload.tool_name !== '' ? payload.tool_name : 'a tool';
    const asking = withTeam(session, session.team.map((m) => (m === member ? { ...m, permission: tool } : m)));
    if (asking.state === 'needs-input' && asking.needsInputReason === 'permission') return asking;
    return transition(asking, 'needs-input', at, 'agent-permission');
  }
  if (name === 'PostToolUse' || name === 'PostToolUseFailure' || name === 'PermissionDenied') {
    // The member's own checklist (M9 fix 394): Claude Code writes a
    // subagent's tasks into the parent's task folder, so they are the
    // parent's list either way; the hook's agent_id is the only word on
    // whose they are, and it is read here before the permission release,
    // which the same PostToolUse may also be.
    const next = name === 'PostToolUse' && AGENT_TASK_TOOLS.has(payload.tool_name ?? '') ? reduceTaskTool(session, payload, id) : session;
    if (!asksPermission(member)) return next;
    return releaseAgentPermission(withTeam(next, next.team.map((m) => (m === member ? { ...m, permission: null } : m))), at);
  }
  return session;
}

function asksPermission(m: TeamMember): boolean {
  return m.outcome === 'running' && m.permission !== null && m.permission !== undefined;
}

function awaitsAgent(session: SessionInfo): boolean {
  return session.state === 'needs-input' && session.needsInputReason === 'agent-permission';
}

// Back to where the row was before the agent asked: the pause, when the
// Stop's task list is still there (transition keeps it through
// needs-input for this), else the parent's own turn.
function releaseAgentPermission(session: SessionInfo, at: number): SessionInfo {
  if (!awaitsAgent(session) || session.team.some(asksPermission)) return session;
  return transition(session, session.waitingOn.length > 0 ? 'waiting' : 'working', at, null);
}

function clearPermissions(session: SessionInfo): SessionInfo {
  return session.team.some((m) => m.permission !== null && m.permission !== undefined) ? withTeam(session, session.team.map((m) => (m.permission === null || m.permission === undefined ? m : { ...m, permission: null }))) : session;
}

// The Agent tool's PostToolUse names the subagent it launched (agentId in
// the response) and what it was given (the description and the type in
// the input), which the SubagentStart does not carry. It can land before
// or after the start, so it binds by id, never by order.
function reduceAgentTool(session: SessionInfo, payload: HookPayload, at: number): SessionInfo {
  const response = typeof payload.tool_response === 'object' && payload.tool_response !== null ? (payload.tool_response as { agentId?: unknown; description?: unknown; resolvedModel?: unknown }) : null;
  const id = response?.agentId;
  if (typeof id !== 'string' || id === '') return session;
  const input = payload.tool_input;
  const description = summarize(typeof response?.description === 'string' ? response.description : input?.description);
  const type = typeof input?.subagent_type === 'string' && input.subagent_type !== '' ? input.subagent_type : null;
  // M9 fix 835: the prompt's first lines (the input's; the response's copy
  // is the same text) and the model the call resolved, a full id, never
  // the input's alias.
  const prompt = promptHead(input?.prompt);
  const model = typeof response?.resolvedModel === 'string' && response.resolvedModel !== '' ? response.resolvedModel : null;
  return upsertMember(session, id, 'agent', { type, description, ...(prompt === null ? {} : { prompt }), ...(model === null ? {} : { model }) }, at);
}

// Adds a running member, or fills in what a known one lacks. The same
// session comes back when nothing changed, so a repeated hook is no push.
// The prompt and the model (M9 fix 835) are spread in only when known, so a
// member without them has no such keys.
function upsertMember(session: SessionInfo, id: string, kind: TeamMember['kind'], fill: Partial<Pick<TeamMember, 'type' | 'description' | 'command' | 'prompt' | 'model'>>, at: number): SessionInfo {
  const member = session.team.find((m) => m.id === id);
  if (member === undefined) {
    return capTeam(session, [...session.team, { id, kind, type: fill.type ?? null, description: fill.description ?? null, command: fill.command ?? null, startedAt: at, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [], activity: null, ...(fill.prompt === undefined ? {} : { prompt: fill.prompt }), ...(fill.model === undefined ? {} : { model: fill.model }) }]);
  }
  const prompt = member.prompt ?? fill.prompt;
  const model = member.model ?? fill.model;
  const filled: TeamMember = { ...member, type: member.type ?? fill.type ?? null, description: member.description ?? fill.description ?? null, command: member.command ?? fill.command ?? null, ...(prompt === undefined ? {} : { prompt }), ...(model === undefined ? {} : { model }) };
  if (filled.type === member.type && filled.description === member.description && filled.command === member.command && filled.prompt === member.prompt && filled.model === member.model) return session;
  return withTeam(session, session.team.map((m) => (m === member ? filled : m)));
}

// A Stop's running list against the team: every listed entry with an id
// is a running member (a shell's only source), and every running member
// the list leaves out has returned, whether or not its SubagentStop was
// seen.
function reconcileTeam(session: SessionInfo, running: readonly RunningTask[], at: number): SessionInfo {
  let next = session;
  const listed = new Set<string>();
  for (const task of running) {
    if (task.id === null) continue;
    listed.add(task.id);
    const kind = task.type === 'shell' ? 'shell' : 'agent';
    next = upsertMember(next, task.id, kind, { type: null, description: task.description, command: task.command }, at);
  }
  if (next.team.some((m) => m.outcome === 'running' && !listed.has(m.id))) {
    next = withTeam(next, next.team.map((m) => (m.outcome === 'running' && !listed.has(m.id) ? { ...m, endedAt: at, outcome: 'returned' } : m)));
  }
  return next;
}

function dropReturned(session: SessionInfo): SessionInfo {
  return session.team.some((m) => m.outcome === 'returned') ? withTeam(foldCommits(session, session.team.filter((m) => m.outcome === 'returned')), session.team.filter((m) => m.outcome !== 'returned')) : session;
}

function clearTeam(session: SessionInfo): SessionInfo {
  return session.team.length === 0 ? session : withTeam(foldCommits(session, session.team), []);
}

// A member's own commits are the session's too (M61), and the record
// keeps them once the member is gone (M9 fix 138): each dropped agent's
// commits join the session's list with the agent on them, in time
// order, capped from the oldest end as the session's own are; a hash
// the session already holds (its first-parent walk credited it after a
// merge) takes the agent on the entry it has rather than a second one.
function foldCommits(session: SessionInfo, dropped: readonly TeamMember[]): SessionInfo {
  const agents = dropped.filter((m) => m.kind === 'agent' && m.commits.length > 0);
  if (agents.length === 0) return session;
  const held = new Map(session.commits.map((c, i) => [c.hash, i]));
  const commits: SessionCommit[] = [...session.commits];
  let added = false;
  for (const m of agents) {
    const agent = { id: m.id, branch: m.branch, type: m.type, description: m.description };
    for (const c of m.commits) {
      const i = held.get(c.hash);
      if (i !== undefined) {
        if (commits[i]!.agent === undefined) commits[i] = { ...commits[i]!, agent };
        continue;
      }
      held.set(c.hash, commits.length);
      commits.push({ hash: c.hash, at: c.at, agent });
      added = true;
    }
  }
  if (added) commits.sort((a, b) => a.at - b.at);
  return { ...session, commits: commits.slice(-Limits.commitsKept) };
}

// A team past its cap (M9 fix 509) sheds its oldest members, their
// commits folded into the session's as a return's are.
function capTeam(session: SessionInfo, team: TeamMember[]): SessionInfo {
  if (team.length <= Limits.teamKept) return withTeam(session, team);
  const cut = team.length - Limits.teamKept;
  return withTeam(foldCommits(session, team.slice(0, cut)), team.slice(cut));
}

function withTeam(session: SessionInfo, team: TeamMember[]): SessionInfo {
  return { ...session, team };
}

// The same conversation said twice (a resume's SessionStart carries the
// same id and folder), so the record is not rewritten for it.
function sameConversation(a: SessionInfo['conversation'], b: NonNullable<SessionInfo['conversation']>): boolean {
  return a !== null && a.id === b.id && a.cwd === b.cwd && a.args.length === b.args.length && a.args.every((x, i) => x === b.args[i]);
}

// Two lists that say the same thing, so a repeated Stop with the same
// tasks still returns the same object.
function sameTasks(a: readonly WaitingTask[], b: readonly WaitingTask[]): boolean {
  return a.length === b.length && a.every((x, i) => x.type === b[i]!.type && x.description === b[i]!.description && x.command === b[i]!.command);
}

// The model's display name (its id when there is none) and the context
// window's used percentage, rounded and clamped; a field that is missing or
// malformed keeps the last known value rather than blanking the row.
function applyStatusLine(session: SessionInfo, payload: HookPayload): SessionInfo {
  const m = payload.model;
  const name = typeof m?.display_name === 'string' && m.display_name !== '' ? m.display_name : typeof m?.id === 'string' && m.id !== '' ? m.id : null;
  const used = payload.context_window?.used_percentage;
  const percent = typeof used === 'number' && Number.isFinite(used) ? Math.min(100, Math.max(0, Math.round(used))) : null;
  const model = name ?? session.model;
  const contextPercent = percent ?? session.contextPercent;
  const contextWindow = mergeContextWindow(session.contextWindow, payload.context_window);
  const tokens = sumTokens(session.tokens, session.contextWindow, payload.context_window);
  // The cost so far (M9 fix 154), Claude Code's own running figure, so a
  // line without it keeps the last; a negative or a NaN is malformed.
  const usd = payload.cost?.total_cost_usd;
  const costUsd = typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : (session.costUsd ?? null);
  const cache = readCache(payload.prompt_cache, session.cache ?? null);
  // The effort level (M9 fix 799). A real status line always has the model
  // block, so one without effort is a model with no effort setting and
  // clears it; a line with no model block (the mod's measure) keeps it.
  const effort = m === undefined ? (session.effort ?? null) : typeof payload.effort?.level === 'string' && payload.effort.level !== '' ? payload.effort.level : null;
  if (model === session.model && contextPercent === session.contextPercent && contextWindow === session.contextWindow && tokens === session.tokens && costUsd === (session.costUsd ?? null) && cache === (session.cache ?? null) && effort === (session.effort ?? null)) return session;
  return { ...session, model, contextPercent, contextWindow, tokens, costUsd, cache, effort };
}

// The status line's prompt cache (M9 fix 772). A line without the block
// keeps the last, as a measure does; a TTL Claude Code does not write or an
// expiry that is no time (null when the last response reported no cache
// tokens) reads as no cache; the last object itself when nothing moved, so
// a repeated line returns the same record.
function readCache(pc: HookPayload['prompt_cache'], last: SessionCache | null): SessionCache | null {
  if (pc === undefined || pc === null || typeof pc !== 'object') return last;
  const ttl = pc.ttl;
  const exp = pc.expires_at;
  if ((ttl !== '5m' && ttl !== '1h') || typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null;
  const expiresAt = Math.round(exp * 1000);
  const warm = pc.warm === true;
  if (last !== null && last.ttl === ttl && last.expiresAt === expiresAt && last.warm === warm) return last;
  return { ttl, expiresAt, warm };
}

// The mod's measure (M9 fix 739) as a status line: its context and cost
// read the same as the status line's of the same moment (the capture of fix
// 738), and it arrives whenever one moves rather than after a turn. No
// model, so the row keeps the status line's display name and never flips
// between it and an id; no current_usage, so the token sum is left alone.
function applyMeasure(session: SessionInfo, payload: HookPayload): SessionInfo {
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const context = payload.measure?.context;
  const usd = payload.measure?.cost?.usd;
  const contextWindow: NonNullable<HookPayload['context_window']> = {
    ...(finite(context?.percent) ? { used_percentage: context.percent } : {}),
    ...(finite(context?.window) ? { context_window_size: context.window } : {}),
    ...(finite(context?.tokens) ? { total_input_tokens: context.tokens } : {}),
  };
  return applyStatusLine(session, { hook_event_name: 'StatusLine', context_window: contextWindow, ...(finite(usd) ? { cost: { total_cost_usd: usd } } : {}) });
}

// The running sum of the status line's counts (M9 fix 143). Claude Code
// posts a status line more than once per request while the reply streams
// (the same input split with the output growing, 2 then 362), so a line
// whose three input parts equal the last known ones is the same request:
// it adds nothing to the input and its output replaces the request's last
// contribution. A different split is a new request and adds all four. A
// line with no input counts leaves the sum alone; a sum that has not
// started (a record from before the field, restored with its window)
// starts with this request, whatever the window says.
function sumTokens(last: SessionTokens | null, window: ContextWindow | null, cw: HookPayload['context_window']): SessionTokens | null {
  const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const usage = cw?.current_usage;
  const fresh = count(usage?.input_tokens);
  const cacheWrite = count(usage?.cache_creation_input_tokens);
  const cacheRead = count(usage?.cache_read_input_tokens);
  if (fresh === null || cacheWrite === null || cacheRead === null) return last;
  const output = count(usage?.output_tokens) ?? 0;
  if (last !== null && window !== null && window.fresh === fresh && window.cacheWrite === cacheWrite && window.cacheRead === cacheRead) {
    if (window.output === output) return last;
    return { ...last, output: Math.max(0, last.output - window.output + output) };
  }
  const base = last ?? { fresh: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  return { fresh: base.fresh + fresh, cacheWrite: base.cacheWrite + cacheWrite, cacheRead: base.cacheRead + cacheRead, output: base.output + output };
}

// The token counts of the status line over the last known ones (M42): a
// count that is missing or malformed keeps its previous value, the way the
// percentage does, and a payload with no counts at all (the fake ones the
// verify scripts post send used_percentage alone) leaves the record as it
// was. Null stays null until a size arrives, since every share is taken
// over the size.
function mergeContextWindow(last: ContextWindow | null, cw: HookPayload['context_window']): ContextWindow | null {
  const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const usage = cw?.current_usage;
  const next: ContextWindow = {
    size: count(cw?.context_window_size) ?? last?.size ?? 0,
    used: count(cw?.total_input_tokens) ?? last?.used ?? 0,
    cacheRead: count(usage?.cache_read_input_tokens) ?? last?.cacheRead ?? 0,
    cacheWrite: count(usage?.cache_creation_input_tokens) ?? last?.cacheWrite ?? 0,
    fresh: count(usage?.input_tokens) ?? last?.fresh ?? 0,
    output: count(usage?.output_tokens) ?? last?.output ?? 0,
  };
  if (next.size <= 0) return last;
  if (last !== null && (Object.keys(next) as Array<keyof ContextWindow>).every((k) => next[k] === last[k])) return last;
  return next;
}

// What Claude Code's title says before the conversation has a name: a bare
// `claude` as the process starts and `✳ Claude Code` once its TUI is up
// (M33's capture), and `Session`, which its naming pass gives a short
// exchange with nothing to name (a one-turn `Reply with the single word
// OK` read `Session` on the row, M9 fix 55). None says anything the
// folder does not.
const UNNAMED_TITLES: ReadonlySet<string> = new Set(['Claude Code', 'Session']);

// The name a session nobody named would carry now: the conversation's
// title while a Claude is bound and has named it, else the folder. A name
// from the title needs Claude's glyph in front, which every title Claude
// Code writes has: the shell's own title (its exe path, a program's name)
// sits on the record between the hook that binds the id and Claude's
// first title, and must not name anything. Null for a drive root, which
// has no folder name; the caller keeps what it had.
export function autoNameFor(session: Pick<SessionInfo, 'cwd' | 'claudeSessionId' | 'title'>): string | null {
  if (session.claudeSessionId !== null && titleGlyph(session.title) !== null) {
    const text = titleText(session.title);
    if (text !== null && !UNNAMED_TITLES.has(text)) return text;
  }
  return folderName(session.cwd) || null;
}

// Recomputes an automatic name from the session's folder and title, reading
// the title as `title` when given (SessionEnd passes null: the title on the
// record is Claude's and Claude has left). Identity when nothing moved.
function followAutoName(session: SessionInfo, title: string | null = session.title): SessionInfo {
  if (!session.autoName) return session;
  const name = autoNameFor({ cwd: session.cwd, claudeSessionId: session.claudeSessionId, title }) ?? session.name;
  return name === session.name ? session : { ...session, name };
}

// Moves the session's live folder. A session nobody named follows it, so a
// Claude that cd's shows where it is (unless its title names it, which
// wins); a name set by hand stays. The folder the sidebar groups under
// follows too, unless a Claude is bound: a Claude session stays under the
// folder Claude started in for the life of the conversation, however its
// working directory moves (M9 fix 60).
function placeIn(session: SessionInfo, cwd: unknown): SessionInfo {
  if (typeof cwd !== 'string' || cwd === '' || cwd === session.cwd) return session;
  const groupCwd = runningKind(session) === 'claude' ? session.groupCwd : cwd;
  return followAutoName({ ...session, cwd, groupCwd });
}

// stateSince moves only when the state itself changes, so "blocked for 4m"
// keeps counting across repeated needs-input events with the same reason.
// The tasks a waiting session was waiting on go with the state (M9 fix 52),
// and so does the transcript's live text (M47) and the tool line with
// it (M9 fix 79) unless the new state is still mid-turn: a permission prompt pauses the turn, and the row keeps
// saying what Claude was doing when it asked. Once the turn ends the
// Stop's lastReply takes the line.
function transition(session: SessionInfo, state: SessionState, at: number, reason?: NeedsInputReason | null): SessionInfo {
  const next = reason === undefined ? session : { ...session, needsInputReason: reason };
  if (next.state === state) return next;
  const midTurn = state === 'working' || state === 'needs-input';
  // The pause's list survives a needs-input and the way back, so an
  // agent's answered prompt puts the row back at waiting with its count
  // (M9 fix 109); a Stop sets its own list after this either way.
  const keepList = next.waitingOn.length === 0 || state === 'needs-input' || state === 'waiting';
  // An automatic compaction's record (M9 fix 812) goes with any move off
  // working; the key is touched only when set, so a session that never
  // had one stays without it.
  const cleared = state !== 'working' && (next.compactFrom ?? null) !== null ? { ...next, compactFrom: null } : next;
  return { ...cleared, state, stateSince: at, waitingOn: keepList ? next.waitingOn : [], liveReply: midTurn ? next.liveReply : null, liveTool: midTurn ? next.liveTool : null, liveVerb: midTurn ? (next.liveVerb ?? null) : null };
}
