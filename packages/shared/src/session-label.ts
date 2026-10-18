import { tokensUp } from './session.ts';
import type { ContextWindow, SessionInfo, SessionKind, SessionTokens, ShellCommand, WaitingTask } from './session.ts';
import { formatUsd } from './rates.ts';
import { Limits } from './limits.ts';
import { formatDuration } from './session-order.ts';

// What is running in the session now, for the kind label on the row and
// in emmer ls: a shell that has started claude (its SessionStart bound the
// id) says claude until Claude leaves. `kind` itself stays what was
// spawned, since a resume starts what was spawned.
export function runningKind(session: Pick<SessionInfo, 'kind' | 'claudeSessionId'>): SessionKind {
  return session.kind === 'claude' || session.claudeSessionId !== null ? 'claude' : 'shell';
}

// The folder Claude Code keeps a cwd's transcripts in, under its home's
// projects: every character that is not a letter or digit turned into a dash.
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

// The last segment of a path, whichever slash style wrote it (hooks send
// forward slashes, the daemon backslashes). What a session is called until
// someone renames it. Empty for a bare drive root, so callers fall back.
export function folderName(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter((x) => x !== '');
  const last = parts[parts.length - 1] ?? '';
  // "C:" alone is a drive, not a folder.
  return /^[A-Za-z]:$/.test(last) ? '' : last;
}

// One place that turns a SessionInfo into the words a badge shows, so the
// pane title bar, the sidebar and emmer ls all say the same thing.

export interface StateLabel {
  // Short text for the badge.
  text: string;
  // Longer explanation for a tooltip; null when the text says it all.
  detail: string | null;
  // Class name suffix, for colour. Stale working sessions get their own.
  tone: SessionInfo['state'] | 'stale';
}

// A stale working session's word (M9 fix 232): `quiet 12m`, the silence
// since its last hook, in the muted tone; the same words on the row, the
// title, emmer ls and the wait's report, so a watchdog and a person read
// one thing. The detail names the threshold it tripped, the turn's own
// (three times the median tool gap) or the floor, and what to do about
// it; an older daemon sends no threshold and the detail says the floor.
export const QUIET_WORD = 'quiet';

// When the session last showed a sign of life, for the stale flag and
// its words alike: its own last hook, or a known member's (M9 fix 507),
// whichever is later.
export function staleSince(session: Pick<SessionInfo, 'lastEventAt' | 'stateSince' | 'teamEventAt'>): number {
  return Math.max(session.lastEventAt ?? session.stateSince, session.teamEventAt ?? 0);
}

export function quietText(session: Pick<SessionInfo, 'lastEventAt' | 'stateSince' | 'teamEventAt'>, now: number): string {
  return `${QUIET_WORD} ${formatDuration(staleSince(session), now)}`;
}

export function quietDetail(session: Pick<SessionInfo, 'lastEventAt' | 'stateSince' | 'staleThresholdMs' | 'teamEventAt'>, now: number): string {
  const since = staleSince(session);
  const threshold = session.staleThresholdMs ?? null;
  const floor = Limits.staleAfterMs;
  // A threshold at or under the built-in floor is the floor itself (the
  // daemon's own, which a script may have set to seconds); one above it
  // is the turn's pace. A floor set to seconds and a turn slower than
  // that reads as a floor too, which only a test knob can produce.
  const which = threshold === null ? `the ${formatDuration(now - floor, now)} floor` : threshold <= floor ? `the ${formatDuration(now - threshold, now)} floor` : `this turn's threshold of ${formatDuration(now - threshold, now)}, three times its median tool gap`;
  return `No hook event for ${formatDuration(since, now)}, past ${which}. Claude may be stuck, or the hooks may not be installed: read its screen, then nudge it or kill it.`;
}

// Whether the state is worth showing at all. The states are what Claude's
// hooks report, so a shell that has never heard one has nothing to say and
// the row and the title bar draw no badge for it (M22); once a hook has
// arrived (SessionStart binds the id, which is what survives a restart and
// a resume; lastEventAt covers a posted event without one) the shell is
// running Claude and the badge appears. An exit comes from the PTY, not a
// hook, so an exited shell (one restored after a daemon restart, say) still
// says so. The state itself is untouched: emmer ls prints it and wait --for
// idle still answers.
export function hasState(session: SessionInfo): boolean {
  return session.kind === 'claude' || session.claudeSessionId !== null || session.lastEventAt !== null || session.state === 'exited' || wantingCommand(session);
}

// The last command of a plain shell (M9 fix 196): one with no Claude
// bound, so the marks own the record's state. Null for a Claude session,
// for a shell Claude runs in and for a shell whose prompt never reported.
export function shellCommand(session: Pick<SessionInfo, 'kind' | 'claudeSessionId' | 'command'>): ShellCommand | null {
  return session.kind === 'shell' && session.claudeSessionId === null ? (session.command ?? null) : null;
}

// Whether a plain shell is at done or errored for a long command's end
// (M9 fix 196), which is the one way a shell without hooks gets a badge.
function wantingCommand(session: SessionInfo): boolean {
  return shellCommand(session) !== null && (session.state === 'done' || session.state === 'errored');
}

// Whether a look at the session (a click, a key, session.ack) puts it
// back at idle: a done, and a plain shell's failed command (M9 fix 196).
// A Claude's errored waits for the next prompt instead.
export function ackable(session: SessionInfo): boolean {
  return session.state === 'done' || wantingCommand(session);
}

// The last command's words (M9 fix 196), for the mark's tooltip, emmer ls
// and explain: `running 40s`, `done 2m ago`, `failed (3) 2m ago`.
export function commandText(command: ShellCommand, now: number): string {
  if (command.state === 'running') return `running ${formatDuration(command.startedAt, now)}`;
  const ago = `${formatDuration(command.endedAt ?? now, now)} ago`;
  return command.state === 'failed' ? `failed (${command.exitCode ?? '?'}) ${ago}` : `done ${ago}`;
}

// How long a command ran, in the units a badge reads: 12s, 1m 12s, 1h 2m.
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}m` : `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
}

// The badge over a plain shell's finished command (M9 fix 196): the
// state word and how long it ran, `done 1m 12s`, `failed (1) after 1m 12s`.
function commandLabel(session: SessionInfo, command: ShellCommand): StateLabel {
  const ran = elapsedText((command.endedAt ?? command.startedAt) - command.startedAt);
  if (session.state === 'errored') {
    return { text: `failed (${command.exitCode ?? '?'}) after ${ran}`, detail: `The command exited with code ${command.exitCode ?? 'unknown'} after ${ran} and nobody has looked yet.`, tone: 'errored' };
  }
  return { text: `done ${ran}`, detail: `The command finished after ${ran} and nobody has looked yet.`, tone: 'done' };
}

// now is read for a plain shell's command words alone (M9 fix 196); the
// other labels do not move with the clock.
export function describeState(session: SessionInfo, now: number = Date.now()): StateLabel {
  const command = shellCommand(session);
  if (command !== null) {
    if (session.state === 'done' || session.state === 'errored') return commandLabel(session, command);
    // At idle the badge is hidden unless a hook once reached the shell;
    // the text still goes to the tooltip, emmer ls and explain. A passed
    // command is the ordinary case and reads as idle, with the end in
    // the detail.
    if (session.state === 'idle') {
      if (command.state === 'ok') return { text: 'idle', detail: `The last command finished ${formatDuration(command.endedAt ?? now, now)} ago.`, tone: 'idle' };
      return { text: commandText(command, now), detail: command.state === 'failed' ? 'The last command failed with that exit code.' : null, tone: 'idle' };
    }
  }
  switch (session.state) {
    case 'needs-input':
      return {
        text: `${NEEDS_INPUT_WORD}: ${needsInputWords(session.needsInputReason)}`,
        detail: needsInputDetail(session.needsInputReason),
        tone: 'needs-input',
      };
    case 'working':
      return session.stale ? { text: quietText(session, now), detail: quietDetail(session, now), tone: 'stale' } : { text: 'working', detail: null, tone: 'working' };
    case 'errored':
      return { text: `errored: ${session.errorType ?? 'unknown'}`, detail: 'The last turn ended with an API error. Send a new prompt to retry.', tone: 'errored' };
    case 'exited':
      return { text: exitLabel(session.exitCode), detail: exitDetail(session.exitCode), tone: 'exited' };
    case 'starting':
      return {
        text: 'starting',
        detail: session.kind === 'claude' ? 'Waiting for the SessionStart hook. If this never changes, run emmer hooks install.' : null,
        tone: 'starting',
      };
    case 'done':
      return { text: 'done', detail: 'Claude finished a turn and nobody has looked yet.', tone: 'done' };
    case 'waiting':
      // The count is in the word so emmer ls prints it as it is, and the
      // list is in the detail, so the tooltip and explain say which tasks
      // (M9 fix 52). An older daemon sends no list and keeps the old words.
      return session.waitingOn.length === 0
        ? { text: 'waiting', detail: 'Claude ended its turn with background tasks still running. It carries on when one finishes.', tone: 'waiting' }
        : { text: `waiting (${session.waitingOn.length})`, detail: waitingDetail(session.waitingOn), tone: 'waiting' };
    case 'idle':
      return { text: 'idle', detail: null, tone: 'idle' };
    default:
      return { text: session.state, detail: null, tone: session.state };
  }
}

// The sentence behind a waiting badge: the count by type, then one line
// per task, its description first since that is what the agent said it
// was for, else the command, else the bare type.
export function waitingDetail(tasks: readonly WaitingTask[]): string {
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
  const parts = [...counts].map(([type, n]) => `${n} ${type}${n === 1 ? '' : 's'}`);
  const head = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`;
  const lines = tasks.map((t) => t.description ?? t.command ?? t.type);
  return [`${head} still running. Claude carries on when one finishes.`, ...lines].join('\n');
}

// What node-pty reports for a process the daemon killed (STATUS_CONTROL_C_EXIT).
// A shell you leave with `exit` and a Claude you leave with /exit both report
// 0, so on this code the honest word is "killed" rather than the raw number.
export const KILLED_EXIT_CODE = -1073741510;

// The badge word for an exited session. null means the daemon restarted
// while the session was live, so nobody saw it exit.
export function exitLabel(exitCode: number | null): string {
  if (exitCode === null) return 'exited';
  if (exitCode === KILLED_EXIT_CODE) return 'killed';
  return `exited (${exitCode})`;
}

// What Resume would do (M48), for the button's tooltip: pick the last
// conversation up in the folder it was in, typed into a shell that hosted
// one, or just the process again in its spawn folder.
export function resumeTitle(session: Pick<SessionInfo, 'name' | 'kind' | 'spawnCwd' | 'conversation'>): string {
  const c = session.conversation;
  if (c === null) return `Start ${session.name} again in ${session.spawnCwd}`;
  if (session.kind === 'claude') return `Pick ${session.name} up again in ${c.cwd} with claude --resume`;
  return `Start ${session.name} again in ${c.cwd} and type claude --resume there`;
}

function exitDetail(exitCode: number | null): string {
  if (exitCode === null) return 'The exit code is unknown: the process gave none, or it ended while emmerd was down. Resume to start it again.';
  if (exitCode === KILLED_EXIT_CODE) return 'Killed from emerald. Resume to start it again.';
  return 'The process exited. Resume to start it again in the same folder.';
}

// What a needs-input session is waiting on, for the row's agent line, the
// answer card and emmer ls (M55): the tool call the permission is for,
// which fix 79's liveTool still holds (transition() keeps it through
// needs-input), as a question; a question or an elicitation by its kind.
// Null in every other state. (waitingOn on SessionInfo is the waiting
// state's task list, a different thing, hence the name.)
// Since M9 fix 742 the mod's ask, when it posted one, names the tool and
// its subject (`Allow? Bash: npm publish`) ahead of the call's phrase.
export function waitingOnText(session: Pick<SessionInfo, 'state' | 'needsInputReason' | 'liveTool'> & Partial<Pick<SessionInfo, 'team' | 'askedFor'>>): string | null {
  if (session.state !== 'needs-input') return null;
  switch (session.needsInputReason) {
    case 'permission':
      return `Allow? ${session.askedFor?.words ?? session.liveTool ?? 'a tool call'}`;
    case 'agent-permission': {
      // The asking member, named as the roster names it (M9 fix 109).
      const asking = (session.team ?? []).find((m) => m.outcome === 'running' && m.permission !== null && m.permission !== undefined);
      if (asking !== undefined) return `Allow? ${asking.description ?? asking.type ?? 'an agent'}: ${asking.permission}`;
      return session.askedFor ? `Allow? an agent's ${session.askedFor.words}` : "Allow? an agent's tool call";
    }
    case 'question':
      return 'Question for you';
    case 'elicitation':
      return 'Waiting for your answer';
    case 'trust':
      return 'Trust this folder?';
    default:
      return 'Waiting on you';
  }
}

// The badge's first word, on its own when the row has no room for the
// reason (M9 fix 123: the sidebar drops the reason before the name loses
// its letters, since the agent line under it says what the ask is).
export const NEEDS_INPUT_WORD = 'needs input';

// The reason in words rather than its key (M9 fix 123): the key
// `agent-permission` read as code on the badge, the pane title and the
// notification, and at 260px it squeezed the name to nothing.
export function needsInputWords(reason: SessionInfo['needsInputReason']): string {
  switch (reason) {
    case 'permission':
      return 'permission';
    case 'agent-permission':
      return "an agent's permission";
    case 'elicitation':
      return 'a form';
    case 'question':
      return 'a question';
    case 'trust':
      return 'folder trust';
    default:
      return 'unknown';
  }
}

function needsInputDetail(reason: SessionInfo['needsInputReason']): string {
  switch (reason) {
    case 'permission':
      return 'Claude is asking permission to use a tool.';
    case 'agent-permission':
      return 'A subagent is asking permission to use a tool; answer it in the pane and the agent carries on.';
    case 'elicitation':
      return 'An MCP server is asking for input.';
    case 'question':
      return 'Claude asked you a question.';
    case 'trust':
      return 'Claude Code asks whether to trust this folder before it starts.';
    default:
      return 'Claude is waiting on you.';
  }
}

// The model as the status line names it, less a trailing parenthetical:
// "Opus 5 (1M context)" is "Opus 5" on the row and the title, where the
// long form pushed the percent off a 260px sidebar (M9 fix 28). The
// tooltip (contextTitle) keeps the full name.
export function shortModel(model: string): string {
  return model.replace(/\s*\([^()]*\)\s*$/, '').trim() || model;
}

// What the status line reported, in two parts so the renderer can put
// the dial between them (M9 fix 66: "Opus 5 · ◔ 19%" on the row and the
// title, the dial right before the number it pictures): the words are
// the short model, the number is the percent, either null until Claude
// has reported it (a shell never does). contextText joins them for the
// CLI and the tests: "Fable · 42%", or the percent alone when the model
// is not known. contextText joins modelEffortWords: "Opus 5.5 · high ·
// 42%" once the status line has said the effort (M9 fix 800).
export function contextWords(session: SessionInfo): string | null {
  return session.model === null ? null : shortModel(session.model);
}

// The words before the dial with the effort level after the model (M9 fix
// 800): "Opus 5.5 · high". The chat view's chip and the context card keep
// the model alone (contextWords); an unknown effort shows the model alone,
// as before.
export function modelEffortWords(session: SessionInfo): string | null {
  const words = contextWords(session);
  const effort = session.effort ?? null;
  return words === null || effort === null ? words : `${words} · ${effort}`;
}

export function contextPercentText(session: SessionInfo): string | null {
  return session.contextPercent === null ? null : `${session.contextPercent}%`;
}

export function contextText(session: SessionInfo): string | null {
  const words = modelEffortWords(session);
  const percent = contextPercentText(session);
  if (words === null) return percent;
  return percent === null ? words : `${words} · ${percent}`;
}

// The running token sum for a row or a pane title (M9 fix 143), sent and
// received since the process started: "↑78k ↓12k", null while no status
// line has carried counts, which is every shell row. The whole split is
// tokensDetail, for the context card and emmer explain. The parts are
// tokensParts (M9 fix 154), for the renderer to lay out with the cached
// share between them on the row and a span per arrow (fix 155); the
// pane title keeps the bare text, ruled 2026-09-14.
export interface TokensParts {
  // "9.1M", the whole sent count.
  up: string;
  // "8.5M", the cache reads within it; null when nothing was cached, so
  // the row shows no parenthetical.
  cached: string | null;
  // "61.7k", the output.
  down: string;
}

export function tokensParts(session: Pick<SessionInfo, 'tokens'>): TokensParts | null {
  const t = session.tokens ?? null;
  if (t === null) return null;
  return { up: formatTokens(tokensUp(t)), cached: t.cacheRead > 0 ? formatTokens(t.cacheRead) : null, down: formatTokens(t.output) };
}

export function tokensText(session: Pick<SessionInfo, 'tokens'>): string | null {
  const p = tokensParts(session);
  return p === null ? null : `↑${p.up} ↓${p.down}`;
}

// The row's reading with the cached share in it: "↑9.1M (8.5M cached)
// ↓61.7k", the bare text when nothing was cached.
export function tokensRowText(session: Pick<SessionInfo, 'tokens'>): string | null {
  const p = tokensParts(session);
  if (p === null) return null;
  return p.cached === null ? `↑${p.up} ↓${p.down}` : `↑${p.up} (${p.cached} cached) ↓${p.down}`;
}

// The cost so far as the shade and emmer explain print it (M9 fix 154,
// reworded by fix 209): "$1.40 at API rates, subagents included", Claude
// Code's own figure, which is every request the process made at API
// rates with the cache discounts in, the forked agents' included, so
// what a key would have paid; null before a status line has carried
// one. The uncached estimate from our table used to sit beside it, but
// that prices this pane's own requests alone, a tenth of the traffic on
// a batch session, and read as the cheaper of two figures for the same
// thing; it lives on the context card now, next to what it is computed
// from.
export function costText(session: Pick<SessionInfo, 'costUsd'>): string | null {
  const usd = session.costUsd ?? null;
  return usd === null ? null : `${formatUsd(usd)} at API rates, subagents included`;
}

// The shade's figures (M9 fix 205): each token reading as a figure with
// its word, "↑113.4k" over "sent", the three token cells first, then
// the cost as the largest figure with costText's words as its caption
// (fix 209 dropped the uncached figure that sat under it). The cost cell
// is absent until the record has a cost. The face draws them as a block; a line's
// text is its figure and word joined, which is what tokensLines gives
// and the scripts read.
export interface TokensFigure {
  // Which cell, for the face's sizes: the three token figures at one
  // size, the cost largest.
  kind: 'sent' | 'cached' | 'received' | 'cost';
  // The data-part the face has carried since fix 154: tokens or cost.
  part: 'tokens' | 'cost';
  figure: string;
  word: string;
}

export function tokensFigures(session: Pick<SessionInfo, 'tokens' | 'costUsd'>): TokensFigure[] {
  const p = tokensParts(session);
  if (p === null) return [];
  const cells: TokensFigure[] = [{ kind: 'sent', part: 'tokens', figure: `↑${p.up}`, word: 'sent' }];
  if (p.cached !== null) cells.push({ kind: 'cached', part: 'tokens', figure: p.cached, word: 'cached' });
  cells.push({ kind: 'received', part: 'tokens', figure: `↓${p.down}`, word: 'received' });
  const usd = session.costUsd ?? null;
  if (usd === null) return cells;
  cells.push({ kind: 'cost', part: 'cost', figure: formatUsd(usd), word: 'at API rates, subagents included' });
  return cells;
}

// The shade's stack as text (M9 fix 154): the reading taller than wide,
// one short line each, since the face is a narrow column and one wide
// line is wrong for it. Since fix 205 each line is a figure and its
// word, so the sent and received lines carry their words too.
export function tokensLines(session: Pick<SessionInfo, 'tokens' | 'costUsd'>): string[] {
  return tokensFigures(session).map((f) => `${f.figure} ${f.word}`);
}

export function tokensDetail(t: SessionTokens): string {
  return `${formatTokens(tokensUp(t))} sent (${formatTokens(t.fresh)} fresh, ${formatTokens(t.cacheWrite)} written to the cache, ${formatTokens(t.cacheRead)} read from it), ${formatTokens(t.output)} received`;
}

// How far along Claude's own checklist is (M9 fix 153): done of total
// and the task in progress, its activeForm ("Extending strength-history
// row") or failing that its subject. Null while there is no list and
// once every task is done, so a session that never made one, which is
// most short turns, shows nothing, and a finished list goes quiet
// rather than sitting at 8/8.
export interface TaskProgress {
  done: number;
  total: number;
  current: string | null;
}

export function taskProgress(session: Pick<SessionInfo, 'tasks'>): TaskProgress | null {
  const tasks = session.tasks ?? [];
  if (tasks.length === 0) return null;
  const done = tasks.filter((t) => t.status === 'completed').length;
  if (done === tasks.length) return null;
  const current = tasks.find((t) => t.status === 'in_progress');
  return { done, total: tasks.length, current: current === undefined ? null : (current.activeForm ?? current.subject) };
}

// The list's tally whatever its state (M9 fix 372): the shade's lid draws
// the checklist as the rule between the hero and the team, and a full
// bar is a finished plan worth seeing, so this sibling of taskProgress
// keeps a list once every task is done and is null only while there is
// no list at all. The row, the title and emmer ls keep taskProgress and
// go quiet at done.
export function taskTally(session: Pick<SessionInfo, 'tasks'>): TaskProgress | null {
  const tasks = session.tasks ?? [];
  if (tasks.length === 0) return null;
  const done = tasks.filter((t) => t.status === 'completed').length;
  const current = tasks.find((t) => t.status === 'in_progress');
  return { done, total: tasks.length, current: current === undefined ? null : (current.activeForm ?? current.subject) };
}

// The lid's caption over its rule: "1 of 3 tasks", "1 of 1 task".
export function tallyText(tally: TaskProgress): string {
  return `${tally.done} of ${tally.total} ${tally.total === 1 ? 'task' : 'tasks'}`;
}

// The count as the row, the pane title and emmer ls print it: "2/3".
export function tasksText(session: Pick<SessionInfo, 'tasks'>): string | null {
  const p = taskProgress(session);
  return p === null ? null : `${p.done}/${p.total}`;
}

export function contextTitle(session: SessionInfo): string {
  const parts: string[] = [];
  if (session.model !== null) parts.push(`Model: ${session.model}`);
  if (session.contextPercent !== null) parts.push(`Context window ${session.contextPercent}% full`);
  const cw = session.contextWindow;
  if (cw !== null) {
    parts.push(`${formatTokens(cw.used)} of ${formatTokens(cw.size)} tokens; auto-compact at ${compactPercent(cw).toFixed(1)}% (${formatTokens(COMPACT_BUFFER_TOKENS)} buffer)`);
    parts.push(`Last request: ${formatTokens(cw.cacheRead)} read from the cache, ${formatTokens(cw.cacheWrite)} written to it, ${formatTokens(cw.fresh)} fresh, ${formatTokens(cw.output)} out`);
  }
  const t = session.tokens ?? null;
  if (t !== null) parts.push(`Since the start: ${tokensDetail(t)}`);
  return parts.join('\n');
}

// M42, the compaction point. Claude Code compacts on its own when the
// context reaches the window's size less the output it reserves less a
// fixed margin: in 2.1.270 that is context_window_size less
// min(max_output_tokens, 20000) less 13000 (its functions cWe, GH and
// Hje and the constant T5n = 20000, read off the binary), 33k tokens
// below the window for every current model, the "Autocompact buffer" its
// /context prints. The status line does not send it, so this is a
// constant until the status line carries the number; a Claude Code that
// moves it moves the band and not the wedge, which stays what the status
// line said.
export const COMPACT_BUFFER_TOKENS = 33000;

// Where on the dial the wedge triggers a compaction, 0 to 100.
export function compactPercent(cw: Pick<ContextWindow, 'size'>): number {
  if (cw.size <= COMPACT_BUFFER_TOKENS) return 0;
  return ((cw.size - COMPACT_BUFFER_TOKENS) / cw.size) * 100;
}

// M9 fix 772: Claude Code's idle compaction, added in 2.1.299 (its
// changelog, read 2026-10-14): a conversation of IDLE_COMPACT_MIN_TOKENS or
// more on the one-hour cache is compacted 54 minutes into the cache's hour,
// 6 before it goes cold (the bundle's fireAtFraction of 0.9 over
// lastActivityAt to expiresAt, read 2026-10-15 off 2.1.301).
// CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS moves the floor and idleCompaction
// false in Claude's settings.json turns it off; emerald reads neither, so
// the count is what Claude Code does by default. Rerun the read after a
// Claude Code update that names idle compaction.
export const IDLE_COMPACT_AFTER_MS = 54 * 60_000;
export const IDLE_COMPACT_MIN_TOKENS = 200_000;

// What an idle session counts down to (M9 fix 772): Claude Code's idle
// compaction when one is due, else the prompt cache going cold, else, for a
// session kept whole (fix 773), the cache going cold with the mark said.
// `words` are the pane title's; `rowWords` the sidebar row's, the same but
// for the kept kind, whose full words do not fit a row at the default
// width (the tech lead's call at fixes 769 to 796), so the row says
// `kept whole · 50m` and its tooltip the rest.
export interface IdleClock {
  kind: 'compact' | 'cold' | 'kept';
  at: number;
  words: string;
  rowWords: string;
}

// The idle countdown (M9 fix 772), null when there is nothing to count: a
// session at work or asking (a prompt clears it, and PreCompact is a
// working event, so the compaction's own start clears it too), a shell
// whose Claude left, a cache that is not warm or already past its time
// (the status line runs again when a warm cache reaches its expiry, which
// turns warm false). The compaction is due only on the hour's TTL and at
// the floor's tokens, `used` being the last request's whole input.
export function idleClock(session: Pick<SessionInfo, 'state' | 'claudeSessionId' | 'contextWindow' | 'cache' | 'keepWhole'>, now: number): IdleClock | null {
  if (session.state !== 'idle' && session.state !== 'waiting' && session.state !== 'done') return null;
  if (session.claudeSessionId === null) return null;
  const cache = session.cache;
  if (cache === undefined || cache === null || !cache.warm || cache.expiresAt <= now) return null;
  const compactAt = cache.ttl === '1h' && (session.contextWindow?.used ?? 0) >= IDLE_COMPACT_MIN_TOKENS ? cache.expiresAt - 60 * 60_000 + IDLE_COMPACT_AFTER_MS : null;
  const minutes = (at: number): number => Math.max(1, Math.ceil((at - now) / 60_000));
  if (session.keepWhole === true) {
    const m = minutes(cache.expiresAt);
    return { kind: 'kept', at: cache.expiresAt, words: `kept whole · cache cold in ${m}m`, rowWords: `kept whole · ${m}m` };
  }
  if (compactAt !== null && compactAt > now) {
    const words = `compacts in ${minutes(compactAt)}m`;
    return { kind: 'compact', at: compactAt, words, rowWords: words };
  }
  const words = `cache cold in ${minutes(cache.expiresAt)}m`;
  return { kind: 'cold', at: cache.expiresAt, words, rowWords: words };
}

// The countdown's tooltip (M9 fix 772); `time` is the clock time of `at`
// as the renderer formats it.
export function idleClockTitle(clock: IdleClock, time: string): string {
  if (clock.kind === 'compact') {
    return `Claude Code compacts a conversation this size about 54 minutes into an idle hour, before its prompt cache goes cold at ${time}; a prompt before then keeps it whole. Its "idleCompaction": false setting turns idle compaction off for every session; emerald does not read that setting, so the count shows even when it is off.`;
  }
  if (clock.kind === 'kept') return `Kept whole while idle: emerald skips Claude Code's idle compaction for this session (the row menu or emmer set --keep-whole off undoes it). The prompt cache goes cold at ${time}.`;
  return `The prompt cache goes cold at ${time}; the first prompt after that sends the whole conversation again.`;
}

// A token count the way the mock's legend prints one: one decimal, a
// whole number when the decimal is 0, so 31.6k, 844.7k, 33k, 1M.
export function formatTokens(n: number): string {
  const short = (v: number): string => v.toFixed(1).replace(/\.0$/, '');
  if (n >= 1_000_000) return `${short(n / 1_000_000)}M`;
  if (n >= 1000) return `${short(n / 1000)}k`;
  return String(n);
}

// M33, the working row. Claude Code's terminal title is a glyph, a space
// and the conversation's name: ✳ at rest, ◐ and ◑ turn about once a
// second while it works (seen in a raw capture through node-pty). The
// glyph is one symbol character outside ASCII; a shell's title (a path, a
// program's name) starts with a letter and is taken whole.
const TITLE_GLYPH = /^([^\x00-\x7f])\s+/u;

export function titleGlyph(title: string | null): string | null {
  if (title === null) return null;
  const m = TITLE_GLYPH.exec(title);
  return m === null ? null : m[1]!;
}

// The title with any leading glyph and whitespace gone; null when nothing
// is left.
export function titleText(title: string | null): string | null {
  if (title === null) return null;
  const text = title.replace(TITLE_GLYPH, '').trim();
  return text === '' ? null : text;
}

// What the line under a working row says in place of the last turn: the
// title, stripped. Null outside working, or with no title, or when the
// title is what the row's name already says (an automatic name follows
// it), and the row keeps the last turn.
export function activityText(session: Pick<SessionInfo, 'state' | 'title' | 'name'>): string | null {
  if (session.state !== 'working') return null;
  const text = titleText(session.title);
  return text === session.name ? null : text;
}

// The sidebar row's agent line (M40, M47, M9 fix 79, M55), in one place
// since M68 draws the same line on the session's row in the Commits
// graph: what is waited on at needs-input, else Claude's latest text off
// the transcript while the turn runs, else the task Claude marked in
// progress on its checklist (M9 fix 153, a better line than the tool
// phrase while it holds), else the tool call it is making, else the last
// turn's reply, else the title's activity, else (M9 fix 158) Claude
// Code's own spinner word off the PTY while the row works, so the line is
// never a dot beside a blank, else nothing.
export function agentLineText(session: Pick<SessionInfo, 'state' | 'needsInputReason' | 'liveTool' | 'liveReply' | 'lastReply' | 'title' | 'name'> & Partial<Pick<SessionInfo, 'team' | 'tasks' | 'liveVerb'>>): string {
  return waitingOnText(session) ?? session.liveReply ?? taskProgress(session)?.current ?? session.liveTool ?? session.lastReply ?? activityText(session) ?? spinnerText(session) ?? '';
}

// The spinner word, only while the row works: the daemon clears it at
// the turn's end, but a reader with an older record may still hold one.
function spinnerText(session: Pick<SessionInfo, 'state'> & Partial<Pick<SessionInfo, 'liveVerb'>>): string | null {
  return session.state === 'working' ? (session.liveVerb ?? null) : null;
}

// How a working session's row and title bar move: the state meter's ripple
// or, under M41, the rate; null when there is nothing to show, which
// includes stale, since motion is the claim that something is happening.
// Until fix 59 Claude's own title glyph took the meter's place when the
// title had one, which on a real Claude session is always, so the meter
// was only ever seen on the tab; the glyph now stays in the title and the
// tooltip and the meter is the one working mark.
export type WorkingMotion = 'pulse';

export function workingMotion(session: Pick<SessionInfo, 'state' | 'stale'>): WorkingMotion | null {
  if (session.state !== 'working' || session.stale) return null;
  return 'pulse';
}

// M40: the marker on a row's agent line, one glyph per state in the state's
// colour (the tone), so the line under "what I asked" says at a glance
// what became of it. A working session shows a dot (glyph null), which
// pulses unless the session is stale. Motion is the renderer's: the dot
// animates under the row's data-working and the ? under its tone, so this
// table is only the symbol and the colour.
export interface StateMarker {
  glyph: string | null;
  tone: StateLabel['tone'];
}

const STATE_MARKERS: Record<Exclude<SessionInfo['state'], 'working'>, string> = {
  'needs-input': '?',
  done: '✓',
  idle: '·',
  waiting: '⋯',
  starting: '◦',
  errored: '!',
  exited: '×',
};

export function stateMarker(session: Pick<SessionInfo, 'state' | 'stale'>): StateMarker {
  if (session.state === 'working') return { glyph: null, tone: session.stale ? 'stale' : 'working' };
  return { glyph: STATE_MARKERS[session.state] ?? '·', tone: session.state };
}
