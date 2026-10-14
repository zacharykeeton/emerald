import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DROPPING_NAME, ROTATING_NAME, SLIMMING_NAME, generationPaths } from '@emerald/shared/hook-log';
import { commandText, costText, describeState, exitLabel, formatDuration, shellCommand, taskProgress, tokensDetail, waitingOnText } from '@emerald/shared';
import type { SessionInfo, SessionTask, SessionKind, SessionState, SessionTouched } from '@emerald/shared';
import { emeraldHome } from './paths.ts';

// The parts of `emmer explain` that touch no daemon: the hooks.jsonl parse
// and the rendering, so a test can run them over a seeded log.

export const DEFAULT_EXPLAIN_LINES = 20;

export function hookLogPath(): string {
  return path.join(emeraldHome(), 'logs', 'hooks.jsonl');
}

// One line of hooks.jsonl as the daemon's sink writes it: the time, the
// emerald session the hook named, the event, why it was or was not applied,
// and (since M37) the state change it made. The payload is not kept; only
// the Claude session id is read from it, so a line dropped as foreign says
// whose it was.
export interface HookLogLine {
  at: number;
  sessionId: string;
  event: string | null;
  outcome: string;
  from: SessionState | null;
  to: SessionState | null;
  claudeSessionId: string | null;
}

// Lines that are not JSON, or not shaped like the sink's, are skipped: the
// log is append-only and a daemon killed mid-write leaves a torn last line.
export function parseHookLog(text: string): HookLogLine[] {
  const out: HookLogLine[] = [];
  for (const raw of text.split('\n')) {
    const line = parseHookLine(raw);
    if (line !== null) out.push(line);
  }
  return out;
}

export function parseHookLine(raw: string): HookLogLine | null {
  if (raw.trim() === '') return null;
  let line: unknown;
  try {
    line = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof line !== 'object' || line === null) return null;
  const l = line as Record<string, unknown>;
  if (typeof l['at'] !== 'number' || typeof l['sessionId'] !== 'string' || typeof l['outcome'] !== 'string') return null;
  const payload = typeof l['payload'] === 'object' && l['payload'] !== null ? (l['payload'] as Record<string, unknown>) : {};
  return {
    at: l['at'],
    sessionId: l['sessionId'],
    event: typeof l['event'] === 'string' ? l['event'] : null,
    outcome: l['outcome'],
    from: typeof l['from'] === 'string' ? (l['from'] as SessionState) : null,
    to: typeof l['to'] === 'string' ? (l['to'] as SessionState) : null,
    claudeSessionId: typeof payload['session_id'] === 'string' ? payload['session_id'] : null,
  };
}

// Every generation the daemon keeps (M9 fix 430; by a bytes budget
// since fix 629), oldest first, streamed line by line: the rotated file
// on a busy box is past 500 MB, and reading it whole took five seconds
// and sat a few MB under V8's string limit, while spreading its parsed
// lines into one array overflowed the stack outright. Given a session
// id, a line that does not contain it is skipped before the JSON parse,
// which is most of the time saved; `lastEventsFor` still filters on the
// parsed field, so the count stays exact. Since fix 541 this is `emerald
// explain --all`, and every file is opened before any is read.
export async function readHookLog(file: string = hookLogPath(), sessionId?: string): Promise<HookLogLine[]> {
  const out: HookLogLine[] = [];
  const held = openHookLogs(file);
  try {
    for (const each of held) {
      const stream = fs.createReadStream('', { fd: each.fd, encoding: 'utf8', autoClose: false, start: 0 });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const raw of lines) {
        if (sessionId !== undefined && !raw.includes(sessionId)) continue;
        const line = parseHookLine(raw);
        if (line !== null) out.push(line);
      }
    }
  } finally {
    closeHookLogs(held);
  }
  return out;
}

interface HeldLog {
  path: string;
  fd: number;
}

// Every generation's handle, oldest first, opened before any is read (M9
// fix 541). Node opens with delete sharing, so a rotation's rename after
// the open leaves each handle on its own file and no line is read twice
// or missed. A rotation between two of the opens is seen as a path whose
// file id no longer matches its handle's, and the whole set is opened
// once more; after that second try the handles are read as they are,
// each still one whole file. `onOpened` is the tests' way into that gap.
function openHookLogs(file: string, onOpened?: () => void): HeldLog[] {
  for (let attempt = 1; ; attempt++) {
    const held: HeldLog[] = [];
    // A listed generation gone by its open was renamed by a shift between
    // the listing and the open, like a moved file below.
    let moved = false;
    try {
      // Mid-drop (M9 fix 555): a generation on its way out sits under
      // DROPPING_NAME, older than every listed one since fix 629's drops
      // take the oldest, so it is read first.
      const dropping = path.join(path.dirname(file), DROPPING_NAME);
      const droppingFd = tryOpen(dropping);
      if (droppingFd !== null) held.push({ path: dropping, fd: droppingFd });
      for (const each of generationPaths(file)) {
        let at = each;
        let fd = tryOpen(each);
        // Mid-rotation (M9 fixes 465 and 629): the current file's lines
        // are under ROTATING_NAME for the length of the shift, then under
        // SLIMMING_NAME, whole, once the slim has finished.
        if (fd === null && each === file) {
          at = path.join(path.dirname(file), ROTATING_NAME);
          fd = tryOpen(at);
          if (fd === null) {
            at = path.join(path.dirname(file), SLIMMING_NAME);
            fd = tryOpen(at);
          }
        } else if (fd === null) {
          moved = true;
        }
        if (fd !== null) held.push({ path: at, fd });
      }
    } catch (err) {
      closeHookLogs(held);
      throw err;
    }
    if (attempt === 1) onOpened?.();
    if (attempt >= 2 || (!moved && held.every(stillThere))) return held;
    closeHookLogs(held);
  }
}

function tryOpen(file: string): number | null {
  try {
    return fs.openSync(file, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

// Bigint, since a Windows file id is 64 bits and a number loses its low
// ones.
function stillThere(each: HeldLog): boolean {
  try {
    return fs.statSync(each.path, { bigint: true }).ino === fs.fstatSync(each.fd, { bigint: true }).ino;
  } catch {
    return false;
  }
}

function closeHookLogs(held: readonly HeldLog[]): void {
  for (const each of held) {
    try {
      fs.closeSync(each.fd);
    } catch {
      // Already closed.
    }
  }
}

// How much of a file one backward step reads.
export const EXPLAIN_CHUNK_BYTES = 1024 * 1024;

// The last `limit` events of one session (all of them when `limit` is 0),
// oldest first, read backward from the newest file (M9 fix 541): the
// current file in chunks from its end, then hooks.1.jsonl and each older the
// same way, stopping between chunks once `limit` events are held, so
// twenty lines on a box with 500 MB of history read a megabyte or two
// rather than all of it. `total` is exact when the read went through
// every file to its first byte and null when it stopped short. A chunk
// is split on the newline byte and each whole line decoded on its own,
// the partial line at a chunk's start carried into the chunk before it,
// so no line and no character is cut.
export async function readLastHookEvents(
  file: string,
  sessionId: string,
  limit: number,
  chunkBytes: number = EXPLAIN_CHUNK_BYTES,
  onOpened?: () => void,
): Promise<{ events: HookLogLine[]; total: number | null }> {
  const needle = Buffer.from(sessionId, 'utf8');
  const newestFirst: HookLogLine[] = [];
  const take = (bytes: Buffer): void => {
    if (bytes.indexOf(needle) === -1) return;
    const line = parseHookLine(bytes.toString('utf8'));
    if (line !== null && line.sessionId === sessionId) newestFirst.push(line);
  };
  const held = openHookLogs(file, onOpened).reverse();
  let stopped = false;
  try {
    for (let i = 0; i < held.length && !stopped; i++) {
      const fd = held[i]!.fd;
      let pos = fs.fstatSync(fd).size;
      let carry = Buffer.alloc(0);
      while (pos > 0) {
        const size = Math.min(chunkBytes, pos);
        pos -= size;
        const chunk = Buffer.alloc(size);
        let got = 0;
        while (got < size) {
          const n = fs.readSync(fd, chunk, got, size - got, pos + got);
          if (n === 0) break;
          got += n;
        }
        const buf = carry.length === 0 ? chunk.subarray(0, got) : Buffer.concat([chunk.subarray(0, got), carry]);
        // Whole lines newest first; the bytes before the first newline
        // are the end of a line that starts in the chunk before, unless
        // this chunk is the file's start.
        let end = buf.length;
        let nl = end === 0 ? -1 : buf.lastIndexOf(0x0a, end - 1);
        while (nl !== -1) {
          take(buf.subarray(nl + 1, end));
          end = nl;
          nl = end === 0 ? -1 : buf.lastIndexOf(0x0a, end - 1);
        }
        carry = Buffer.from(buf.subarray(0, end));
        if (pos === 0) take(carry);
        const more = pos > 0 || i < held.length - 1;
        if (limit > 0 && newestFirst.length >= limit && more) {
          stopped = true;
          break;
        }
      }
    }
  } finally {
    closeHookLogs(held);
  }
  const kept = limit > 0 ? newestFirst.slice(0, limit) : newestFirst;
  return { events: kept.reverse(), total: stopped ? null : newestFirst.length };
}

// The last `limit` lines for one session, oldest first, and how many there
// were in all so the header can say "of 133".
export function lastEventsFor(lines: readonly HookLogLine[], sessionId: string, limit: number): { events: HookLogLine[]; total: number } {
  const mine = lines.filter((l) => l.sessionId === sessionId);
  return { events: limit > 0 ? mine.slice(-limit) : mine, total: mine.length };
}

// What explain knows about the session. From session.list when the daemon
// is up; from sessions.json when it is down, where only an exited session
// has a state (a live one's died with the daemon and is reported so).
export interface ExplainSubject {
  id: string;
  name: string;
  kind: SessionKind;
  claudeSessionId: string | null;
  // Null when the daemon is down and the file has no exit for it.
  state: SessionState | null;
  stateSince: number | null;
  // The badge words and the sentence behind them, from describeState.
  label: string;
  detail: string | null;
  lastPrompt: string | null;
  lastReply: string | null;
  // The tool call Claude is making right now (M9 fix 79); the daemon's
  // alone, since the file never holds a turn in flight.
  liveTool: string | null;
  // What a needs-input session waits on (M55), the tool call as a question.
  waitingOn: string | null;
  // A plain shell's last command as its prompt reported it (M9 fix 196),
  // `running 40s` or `failed (3) 2m ago`; null for a Claude session and
  // for a shell whose prompt never reported.
  command: string | null;
  // The commit the session started on (M9 fix 117) and how many it has
  // made since, the daemon's alone; null when it is not in a repository
  // or the daemon is from before the field.
  startHead: string | null;
  commits: number;
  // Tokens sent and received since the process started (M9 fix 143), the
  // daemon's alone; null before the first counted status line.
  tokens: string | null;
  // What the process has cost so far (M9 fix 154), Claude Code's own
  // figure at API rates, the forked agents' requests in it; null before
  // a costed status line. The uncached estimate that sat beside it went
  // in fix 209, since it priced this session's own requests alone and
  // read as the cheaper of two figures for one thing.
  cost: string | null;
  // The colour scheme this session wears in place of the window's (M9 fix
  // 244), the daemon's alone; null on the window's pick.
  scheme: string | null;
  // Claude's own checklist (M9 fix 153), the daemon's alone: every task
  // with its status, empty when the turn made none or the list is done.
  tasks: SessionTask[];
  // The files the session wrote (M9 fix 198), the daemon's alone, the
  // latest few as `path, 2m ago` with the member's id on a subagent's.
  touched: SessionTouched[];
  // The screen kept when the PTY ended or the daemon stopped (M9 fix
  // 159); null while the session is live or when none was kept. From
  // the daemon's pty.screen, or the file, whose frame is there only for
  // a session whose process is gone, a stop included.
  screen: string[] | null;
  source: 'daemon' | 'file';
}

export function subjectFromSession(s: SessionInfo, now: number = Date.now()): ExplainSubject {
  const { text, detail } = describeState(s, now);
  const command = shellCommand(s);
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    claudeSessionId: s.claudeSessionId,
    state: s.state,
    stateSince: s.stateSince,
    label: text,
    detail,
    lastPrompt: s.lastPrompt,
    lastReply: s.lastReply,
    liveTool: s.liveTool ?? null,
    waitingOn: waitingOnText(s),
    command: command === null ? null : commandText(command, now),
    startHead: s.startHead ?? null,
    commits: s.commits?.length ?? 0,
    tokens: s.tokens === null || s.tokens === undefined ? null : tokensDetail(s.tokens),
    cost: costText(s),
    scheme: s.scheme ?? null,
    tasks: taskProgress(s) === null ? [] : (s.tasks ?? []),
    touched: s.touched ?? [],
    screen: null,
    source: 'daemon',
  };
}

// The subset of a sessions.json entry explain reads.
export interface StoredSession {
  id: string;
  name: string;
  kind: SessionKind;
  claudeSessionId: string | null;
  lastPrompt: string | null;
  lastReply: string | null;
  exitCode: number | null;
  exitedAt: number | null;
  lastScreen: string[] | null;
}

export function subjectFromStored(s: StoredSession): ExplainSubject {
  const exited = s.exitedAt !== null;
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    claudeSessionId: s.claudeSessionId,
    state: exited ? 'exited' : null,
    stateSince: s.exitedAt,
    label: exited ? exitLabel(s.exitCode) : 'unknown',
    detail: exited ? null : 'emmerd is not running, and the session was live when it last wrote sessions.json; it will list as exited once emmerd starts.',
    lastPrompt: s.lastPrompt,
    lastReply: s.lastReply,
    liveTool: null,
    waitingOn: null,
    command: null,
    startHead: null,
    commits: 0,
    tokens: null,
    cost: null,
    scheme: null,
    tasks: [],
    touched: [],
    screen: s.lastScreen,
    source: 'file',
  };
}

// The rows of a kept screen (M9 fix 159), or null for none or a value
// of another shape.
function readScreenRows(v: unknown): string[] | null {
  if (typeof v !== 'object' || v === null) return null;
  const rows = (v as Record<string, unknown>)['rows'];
  return Array.isArray(rows) && rows.every((r) => typeof r === 'string') ? [...(rows as string[])] : null;
}

// ~/.emerald/sessions.json read the way the daemon's store reads it, minus
// the repairs: an entry missing what explain needs is skipped.
export function readStoredSessions(file: string = path.join(emeraldHome(), 'sessions.json')): StoredSession[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const list = (parsed as Record<string, unknown>)['sessions'];
  if (!Array.isArray(list)) return [];
  const out: StoredSession[] = [];
  for (const e of list) {
    if (typeof e !== 'object' || e === null) continue;
    const r = e as Record<string, unknown>;
    if (typeof r['id'] !== 'string' || typeof r['name'] !== 'string' || (r['kind'] !== 'claude' && r['kind'] !== 'shell')) continue;
    out.push({
      id: r['id'],
      name: r['name'],
      kind: r['kind'],
      claudeSessionId: typeof r['claudeSessionId'] === 'string' ? r['claudeSessionId'] : null,
      lastPrompt: typeof r['lastPrompt'] === 'string' ? r['lastPrompt'] : null,
      lastReply: typeof r['lastReply'] === 'string' ? r['lastReply'] : null,
      exitCode: typeof r['exitCode'] === 'number' ? r['exitCode'] : null,
      exitedAt: typeof r['exitedAt'] === 'number' ? r['exitedAt'] : null,
      lastScreen: readScreenRows(r['lastScreen']),
    });
  }
  return out;
}

// One mark per task status on the explain lines: done, the one Claude is
// on, and not started.
const TASK_MARKS: Record<SessionTask['status'], string> = { completed: '[x]', in_progress: '[>]', pending: '[ ]' };

// How many touched files explain lists (M9 fix 198).
const TOUCHED_SHOWN = 5;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

// Local clock time; the date comes along when the event is not today's,
// since a log can hold a week.
export function formatTime(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? clock : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
}

export interface ExplainJson {
  session: ExplainSubject;
  log: string;
  // Null when the read stopped short of the oldest line (M9 fix 541).
  total: number | null;
  events: HookLogLine[];
}

// The text form: the session and its state, the sentence behind the badge,
// the last turn, then the events one per line with the transition where
// there was one. Every line is meant to be read top to bottom by someone
// asking "why does the row say that".
export function renderExplain(subject: ExplainSubject, events: readonly HookLogLine[], total: number | null, logFile: string, now: number): string[] {
  const out: string[] = [];
  const since = subject.stateSince === null ? '' : ` for ${formatDuration(subject.stateSince, now)} (since ${formatTime(subject.stateSince, now)})`;
  out.push(`${subject.id.slice(0, 8)} ${subject.name}  ${subject.kind}  ${subject.label}${since}`);
  if (subject.source === 'file') out.push('emmerd is not running; the session is as sessions.json last wrote it');
  if (subject.detail !== null) out.push(subject.detail);
  out.push(subject.claudeSessionId === null ? 'no Claude session id bound (a shell, or Claude has not reported in)' : `Claude session ${subject.claudeSessionId}`);
  if (subject.lastPrompt !== null) out.push(`last prompt: ${subject.lastPrompt}`);
  if (subject.lastReply !== null) out.push(`last reply: ${subject.lastReply}`);
  if (subject.liveTool !== null) out.push(`doing: ${subject.liveTool}`);
  if (subject.waitingOn !== null) out.push(`waiting on: ${subject.waitingOn}`);
  if (subject.command !== null) out.push(`last command: ${subject.command}`);
  if (subject.tokens !== null) out.push(`tokens since the start: ${subject.tokens}`);
  if (subject.cost !== null) out.push(`cost: ${subject.cost}, Claude Code's own figure`);
  if (subject.scheme !== null) out.push(`colour scheme: ${subject.scheme}, this session's own (emmer set --scheme)`);
  if (subject.startHead !== null) out.push(`started on commit ${subject.startHead.slice(0, 7)}${subject.commits === 0 ? '' : `, ${subject.commits} commit${subject.commits === 1 ? '' : 's'} since`}`);
  // The checklist as the row's card lists it: the count, then one line
  // per task with the one in progress marked.
  if (subject.tasks.length > 0) {
    const done = subject.tasks.filter((task) => task.status === 'completed').length;
    out.push(`tasks: ${done} of ${subject.tasks.length} done`);
    for (const task of subject.tasks) out.push(`  ${TASK_MARKS[task.status]}  ${task.status === 'in_progress' ? (task.activeForm ?? task.subject) : task.subject}`);
  }
  // The files written (M9 fix 198), the latest first and at most five,
  // since the list is for "what did it touch", not an audit.
  if (subject.touched.length > 0) {
    const shown = subject.touched.slice(-TOUCHED_SHOWN).reverse();
    out.push(`touched: ${subject.touched.length} file${subject.touched.length === 1 ? '' : 's'}${shown.length < subject.touched.length ? `, the last ${shown.length}` : ''}`);
    for (const t of shown) out.push(`  ${t.path}  ${formatDuration(t.at, now)} ago${t.agentId === null ? '' : `  (agent ${t.agentId})`}`);
  }
  // The frame the pane shows for an exited session (M9 fix 159), indented
  // so the rows read apart from the report.
  if (subject.screen !== null) {
    out.push(`last screen, ${subject.screen.length} row${subject.screen.length === 1 ? '' : 's'} kept when the process ended:`);
    for (const row of subject.screen) out.push(`  | ${row}`);
  }
  if (total === 0) {
    out.push(`no hook events for this session in ${logFile}`);
    if (subject.kind === 'claude' || subject.claudeSessionId !== null) out.push('a Claude session that never posts an event most likely has no hooks installed: emmer hooks status');
    return out;
  }
  // A read that stopped once it had enough (M9 fix 541) knows no total,
  // and says so whether or not an older event of the session exists.
  out.push(total === null ? `last ${events.length} hook events (more before) from ${logFile}, oldest first:` : `last ${events.length} of ${total} hook events from ${logFile}, oldest first:`);
  const eventWidth = Math.max(...events.map((e) => (e.event ?? '(no event)').length));
  const outcomeWidth = Math.max(...events.map((e) => e.outcome.length));
  for (const e of events) {
    const change = e.from !== null && e.to !== null ? `${e.from} -> ${e.to}` : '';
    // A foreign line is one a nested claude posted with another id; naming
    // it is what tells "ignored" apart from "the hooks are broken".
    const whose = e.outcome === 'ignored-foreign' && e.claudeSessionId !== null ? `(session_id ${e.claudeSessionId})` : '';
    const tail = [change, whose].filter((t) => t !== '').join('  ');
    out.push(`  ${formatTime(e.at, now)}  ${(e.event ?? '(no event)').padEnd(eventWidth)}  ${e.outcome.padEnd(outcomeWidth)}${tail === '' ? '' : `  ${tail}`}`.trimEnd());
  }
  return out;
}
