import type { HistorySession, HistoryTranscript, TranscriptCost } from '../../preload/api.ts';
import { remoteSessionIdOfLine } from '@emerald/shared';
import type { Turn } from '@emerald/shared';

// The pure part of the session history panel: reading Claude Code's own
// files into rows, and sorting the rows into groups. The main process
// does the file reads (history.ts) and hands the text here; the panel
// does the search. Nothing here touches the disk.
//
// What Claude Code writes, as found on this machine (Claude Code 2.1):
// ~/.claude/history.jsonl has one line per prompt, {display, timestamp
// (ms), project (the cwd), sessionId}; ~/.claude/projects/<cwd with every
// character that is not a letter or digit turned into ->/<sessionId>.jsonl
// is the transcript, JSON lines, where an ai-title line near the top
// carries aiTitle, every user and assistant line carries cwd, gitBranch,
// sessionId, timestamp (ISO) and message, assistant lines carry
// message.model, and a user line with isMeta or a tool_result is not a
// prompt.

// How many bytes of a transcript's head and tail are read: the title,
// the cwd and the first prompt are at the top, the model and the last
// message at the bottom, and a transcript can run to tens of megabytes.
export const CHUNK_BYTES = 64 * 1024;
// A session with no history lines gets its prompt count from the
// transcript, read no further than this.
export const COUNT_CAP_BYTES = 4 * 1024 * 1024;
// The scan keeps this many sessions, newest first.
export const RECENT_CAP = 250;
// A preview is one line of about this length; the rest is in the tooltip.
export const PREVIEW_CHARS = 200;

// The folder Claude Code keeps a cwd's transcripts in.
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export interface HistoryLine {
  sessionId: string;
  display: string;
  timestamp: number;
  project: string;
}

// One line of history.jsonl, or null for one that is not what Claude
// Code writes (a partial last line included).
export function parseHistoryLine(line: string): HistoryLine | null {
  const o = parseObject(line);
  if (o === null) return null;
  const { sessionId, display, timestamp, project } = o;
  if (typeof sessionId !== 'string' || typeof display !== 'string' || typeof timestamp !== 'number' || typeof project !== 'string') return null;
  return { sessionId, display, timestamp, project };
}

export interface HistoryIndex {
  prompts: number;
  firstPrompt: string;
  firstAt: number;
  lastAt: number;
  project: string;
}

// history.jsonl grouped by session: how many prompts, the first one, and
// when the first and last were sent. A line's project is the cwd at that
// prompt; the latest one wins.
export function indexHistory(text: string): Map<string, HistoryIndex> {
  const index = new Map<string, HistoryIndex>();
  for (const raw of text.split('\n')) {
    const line = parseHistoryLine(raw);
    if (line === null) continue;
    const have = index.get(line.sessionId);
    if (have === undefined) {
      index.set(line.sessionId, { prompts: 1, firstPrompt: line.display, firstAt: line.timestamp, lastAt: line.timestamp, project: line.project });
      continue;
    }
    have.prompts += 1;
    if (line.timestamp < have.firstAt) {
      have.firstAt = line.timestamp;
      have.firstPrompt = line.display;
    }
    if (line.timestamp >= have.lastAt) {
      have.lastAt = line.timestamp;
      have.project = line.project;
    }
  }
  return index;
}

export interface TranscriptHead {
  title: string | null;
  cwd: string | null;
  branch: string | null;
  firstPrompt: string | null;
  startedAt: number | null;
  // The claude.ai session ids the head names (M70), in order of
  // appearance: the first lands within the first few lines.
  remoteIds: string[];
}

export interface TranscriptTail {
  model: string | null;
  lastAt: number | null;
  preview: { who: 'you' | 'agent'; text: string } | null;
  // The ids the tail names (M70): a resume that was handed a new id
  // writes it where the resumed conversation goes on.
  remoteIds: string[];
}

// The first lines of a transcript. A chunk shorter than the file ends
// mid-line, and that line is dropped; `complete` says the text is the
// whole file, so its last line counts.
export function parseTranscriptHead(text: string, complete = false): TranscriptHead {
  const head: TranscriptHead = { title: null, cwd: null, branch: null, firstPrompt: null, startedAt: null, remoteIds: [] };
  for (const line of wholeLines(text, complete ? 'whole' : 'head')) {
    const o = parseObject(line);
    if (o === null) continue;
    addRemoteId(head.remoteIds, o);
    if (o['type'] === 'ai-title' && typeof o['aiTitle'] === 'string' && head.title === null) head.title = o['aiTitle'].trim() || null;
    if (typeof o['cwd'] === 'string' && head.cwd === null) head.cwd = o['cwd'];
    if (typeof o['gitBranch'] === 'string' && head.branch === null) head.branch = o['gitBranch'] || null;
    const at = lineTime(o);
    if (at !== null && head.startedAt === null) head.startedAt = at;
    if (head.firstPrompt === null) {
      const prompt = promptText(o);
      if (prompt !== null) head.firstPrompt = prompt;
    }
  }
  return head;
}

// The last lines of a transcript. A chunk shorter than the file starts
// mid-line, and that line is dropped. The preview is the later of the last
// prompt and the last reply with text in it, which is what Orca shows
// under the title.
export function parseTranscriptTail(text: string, complete = false): TranscriptTail {
  const tail: TranscriptTail = { model: null, lastAt: null, preview: null, remoteIds: [] };
  let previewAt = -1;
  for (const line of wholeLines(text, complete ? 'whole' : 'tail')) {
    const o = parseObject(line);
    if (o === null) continue;
    addRemoteId(tail.remoteIds, o);
    const at = lineTime(o);
    if (at !== null && (tail.lastAt === null || at > tail.lastAt)) tail.lastAt = at;
    const message = o['message'];
    if (o['type'] === 'assistant' && isObject(message) && typeof message['model'] === 'string') tail.model = message['model'];
    const prompt = promptText(o);
    if (prompt !== null && at !== null && at >= previewAt) {
      previewAt = at;
      tail.preview = { who: 'you', text: prompt };
    }
    const reply = replyText(o);
    if (reply !== null && at !== null && at >= previewAt) {
      previewAt = at;
      tail.preview = { who: 'agent', text: reply };
    }
  }
  return tail;
}

// The remote session ids named in a stretch of transcript text (M70):
// the lines that carry a remote_session_change attachment, in order,
// each id once. Cheap on a big file: a line is parsed only when it
// mentions the attachment's type, which the main process's sweep of a
// whole transcript relies on.
export function remoteIdsIn(text: string, complete = false, cut: 'head' | 'tail' | 'whole' = 'whole'): string[] {
  const ids: string[] = [];
  for (const line of wholeLines(text, complete ? 'whole' : cut)) {
    if (!line.includes('remote_session_change')) continue;
    const o = parseObject(line);
    if (o !== null) addRemoteId(ids, o);
  }
  return ids;
}

function addRemoteId(ids: string[], o: Record<string, unknown>): void {
  const id = remoteSessionIdOfLine(o);
  if (id !== null && !ids.includes(id)) ids.push(id);
}

// Counts the prompts in as much of a transcript as was read.
export function countPrompts(text: string, complete = false): number {
  let n = 0;
  for (const line of wholeLines(text, complete ? 'whole' : 'head')) {
    const o = parseObject(line);
    if (o !== null && promptText(o) !== null) n += 1;
  }
  return n;
}

// The text of a user line that is a prompt someone typed, else null: not a
// meta line, not a tool result, and a slash command shows as the command.
// Text is the first line, trimmed and capped, since a prompt can be pages.
function promptText(o: Record<string, unknown>): string | null {
  if (o['type'] !== 'user' || o['isMeta'] === true) return null;
  const message = o['message'];
  if (!isObject(message)) return null;
  const content = message['content'];
  if (typeof content === 'string') return firstLine(commandText(content));
  if (!Array.isArray(content)) return null;
  if (content.some((part) => isObject(part) && part['type'] === 'tool_result')) return null;
  const text = content.find((part): part is { type: 'text'; text: string } => isObject(part) && part['type'] === 'text' && typeof part['text'] === 'string');
  return text === undefined ? null : firstLine(commandText(text.text));
}

// The first text block of an assistant line, else null (a line that is
// only tool calls has none).
function replyText(o: Record<string, unknown>): string | null {
  if (o['type'] !== 'assistant') return null;
  const message = o['message'];
  if (!isObject(message) || !Array.isArray(message['content'])) return null;
  const text = message['content'].find((part): part is { type: 'text'; text: string } => isObject(part) && part['type'] === 'text' && typeof part['text'] === 'string');
  return text === undefined ? null : firstLine(text.text);
}

// A slash command is recorded as XML-ish tags; the command and its
// arguments are what the person typed. Local command output is not a
// prompt at all.
function commandText(content: string): string | null {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('<local-command') || trimmed.startsWith('<bash-')) return null;
  const name = /<command-name>([^<]*)<\/command-name>/.exec(trimmed);
  if (name === null) return content;
  const args = /<command-args>([^<]*)<\/command-args>/.exec(trimmed);
  return `${name[1]!.trim()} ${args?.[1]?.trim() ?? ''}`.trim();
}

function firstLine(text: string | null): string | null {
  if (text === null) return null;
  const line = text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
  if (line === '') return null;
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line;
}

function lineTime(o: Record<string, unknown>): number | null {
  const ts = o['timestamp'];
  if (typeof ts === 'number') return ts;
  if (typeof ts !== 'string') return null;
  const at = Date.parse(ts);
  return Number.isNaN(at) ? null : at;
}

// The complete lines of a chunk: a head chunk may end mid-line, a tail
// chunk may start mid-line, and a whole file does neither.
function wholeLines(text: string, cut: 'head' | 'tail' | 'whole'): string[] {
  const lines = text.split('\n');
  if (cut === 'head' && !text.endsWith('\n')) lines.pop();
  if (cut === 'tail') lines.shift();
  return lines;
}

function parseObject(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (trimmed === '' || !trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Puts one session together from the pieces. The history index wins for
// counts and times since it is complete; the transcript fills in what the
// index does not have and is the only source of the title, the branch, the
// model and the preview.
export function buildSession(
  id: string,
  path: string,
  index: HistoryIndex | undefined,
  head: TranscriptHead,
  tail: TranscriptTail,
  counted: number | null,
  // The ids a sweep of the middle of a big transcript found (M70); the
  // head's and the tail's are theirs.
  swept: readonly string[] = [],
): HistorySession | null {
  const cwd = head.cwd ?? index?.project ?? null;
  if (cwd === null) return null;
  const firstPrompt = index?.firstPrompt ?? head.firstPrompt;
  const remoteIds: string[] = [];
  for (const r of [...head.remoteIds, ...swept, ...tail.remoteIds]) if (!remoteIds.includes(r)) remoteIds.push(r);
  return {
    id,
    path,
    title: head.title ?? firstLine(firstPrompt) ?? '(no prompt yet)',
    remoteIds,
    cwd,
    branch: head.branch,
    model: tail.model,
    prompts: index?.prompts ?? counted ?? 0,
    startedAt: index?.firstAt ?? head.startedAt,
    lastAt: latest(index?.lastAt ?? null, tail.lastAt),
    preview: tail.preview ?? (firstPrompt === null ? null : { who: 'you', text: firstLine(firstPrompt) ?? firstPrompt }),
    project: cwd,
    cwdExists: true,
  };
}

function latest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

// The conversations the Commits graph can name (M70): every transcript
// that names a claude.ai session id, whole (not capped like the panel's
// rows), keyed by transcript so one conversation's several ids read as
// one.
export function transcriptsOf(sessions: readonly HistorySession[]): HistoryTranscript[] {
  return sessions.filter((s) => s.remoteIds.length > 0).map((s) => ({ id: s.id, title: s.title, cwd: s.cwd, cwdExists: s.cwdExists, path: s.path, startedAt: s.startedAt, lastAt: s.lastAt, remoteIds: s.remoteIds }));
}

export function sortNewest(sessions: HistorySession[]): HistorySession[] {
  return [...sessions].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
}

// Windows paths compare case insensitively and either slash will do.
export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

function normalizePath(p: string): string {
  return p.replace(/[\\/]+/g, '\\').replace(/\\+$/, '').toLowerCase();
}

// Every word of the search must appear somewhere in the title, the
// preview, the folder or the branch, case insensitively.
export function matches(session: HistorySession, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return true;
  const hay = [session.title, session.preview?.text ?? '', session.cwd, session.branch ?? '', session.model ?? ''].join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}

export interface HistoryGroup {
  project: string;
  sessions: HistorySession[];
}

// Rows grouped by the repository they were in, in the order the rows come
// (newest first), so the group with the newest session is on top.
export function groupByProject(sessions: HistorySession[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const s of sessions) {
    const group = groups.find((g) => samePath(g.project, s.project));
    if (group === undefined) groups.push({ project: s.project, sessions: [s] });
    else group.sessions.push(s);
  }
  return groups;
}

// The session in the focused pane, cut down to what tells its project.
export interface FocusedForHistory {
  claudeSessionId: string | null;
  conversation: { id: string } | null;
  cwd: string;
}

// The group the focused pane's session belongs to (M9 fix 84), so the
// panel can fold every other one: the group holding the row of the
// conversation the session is on (its bound id, or the one it last
// hosted), else the group whose project is the folder the session is in
// or a parent of it (a shell has no conversation but sits in a
// repository), else null. Prefix means whole path segments, so C:\a
// does not claim C:\ab.
export function focusedProject(groups: HistoryGroup[], focused: FocusedForHistory | null): string | null {
  if (focused === null) return null;
  const ids = [focused.claudeSessionId, focused.conversation?.id ?? null].filter((id): id is string => id !== null);
  for (const g of groups) {
    if (g.sessions.some((s) => ids.includes(s.id))) return g.project;
  }
  const cwd = normalizePath(focused.cwd);
  let best: HistoryGroup | null = null;
  for (const g of groups) {
    const project = normalizePath(g.project);
    if (cwd !== project && !cwd.startsWith(`${project}\\`)) continue;
    if (best === null || project.length > normalizePath(best.project).length) best = g;
  }
  return best?.project ?? null;
}

// M9 fix 439: the History panel's folds across a reload. ui.ts keeps the
// groups opened by hand for whichever session is focused under
// emerald.historyFolds, `{ for, opened }`; this is the restore the first
// scan's fold (fix 84, above) takes them back through. A stored record
// for a different session (a focus change since, or none saved yet)
// leaves the fresh fold alone, since a hand-open belongs to the focus it
// was made under and not the project; a stored project the fresh fold
// does not hold collapsed (already open, or gone from the scan) is
// simply not there to remove.
export interface StoredHistoryFolds {
  for: string | null;
  opened: readonly string[];
}

export function restoreOpenedFolds(collapsed: ReadonlySet<string>, focusedId: string | null, stored: StoredHistoryFolds | null): ReadonlySet<string> {
  if (stored === null || stored.for !== focusedId || stored.opened.length === 0) return collapsed;
  const next = new Set(collapsed);
  for (const project of stored.opened) next.delete(project);
  return next;
}

// The prompt count off a transcript read whole (M9 fix 97): one per turn,
// since a turn opens on a prompt. The unfolded row and the transcript
// tab's header both print this, so the two cannot drift, and the folded
// row keeps the scan's count, which is capped at COUNT_CAP_BYTES and
// undercounts a long conversation.
export function promptsText(turns: readonly Turn[]): string {
  return `${turns.length} ${turns.length === 1 ? 'prompt' : 'prompts'}`;
}

// Whether two prices say the same thing (M9 fix 354), so the cost
// store publishes nothing for a re-ask the main process answered from
// its cache; undefined is no answer yet, which any answer differs from.
export function sameTranscriptCost(a: TranscriptCost | null | undefined, b: TranscriptCost | null): boolean {
  if (a === undefined) return false;
  if (a === null || b === null) return a === b;
  return a.usd === b.usd && a.tokens.up === b.tokens.up && a.tokens.down === b.tokens.down && a.tokens.cached === b.tokens.cached && a.agents.count === b.agents.count && a.agents.usd === b.agents.usd && a.agents.skipped === b.agents.skipped;
}
