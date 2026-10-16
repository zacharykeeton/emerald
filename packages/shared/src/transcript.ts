import { summarize } from './state-machine.ts';
import { HEAD_TOOLS } from './command-dir.ts';
import { formatDuration } from './session-order.ts';
import type { ModRow } from './protocol.ts';

// One line of a Claude Code transcript (the JSONL at transcript_path) read
// for what the sidebar's agent line wants (M47): the text Claude wrote in
// an assistant turn, as the first line that says anything, cut the way a
// prompt or a reply is. Null for everything else: a user line, a tool call
// or a thinking block (an assistant line with no text part), a line from
// a subagent's side chain, a broken line (the tail can read one mid-write
// only across a newline, so this is belt and braces), and text that is
// blank.
export function assistantText(line: string): string | null {
  let entry: unknown;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof entry !== 'object' || entry === null) return null;
  const { type, isSidechain, message } = entry as { type?: unknown; isSidechain?: unknown; message?: unknown };
  if (type !== 'assistant' || isSidechain === true) return null;
  if (typeof message !== 'object' || message === null) return null;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue;
    const { type: partType, text } = part as { type?: unknown; text?: unknown };
    if (partType !== 'text') continue;
    const line = summarize(text);
    if (line !== null) return line;
  }
  return null;
}

// Whether a Bash command can move HEAD (M49): a commit, a merge, a rebase, a
// cherry-pick, a pull, a revert or an am, anywhere in the line, as long as
// the word git comes before it in the same simple command. `git status`,
// `git log` and `git commit --dry-run` alike are not worth a process; the
// last is a false positive the daemon's record absorbs, since HEAD has not
// moved and the same hash is never appended twice in a row. Shared since
// M53 counts a turn's commits off the transcript by the same rule. The
// daemon no longer gates on it (M9 fix 195: HEAD is compared around
// every Bash call in a repository, so a script's commit is credited
// too); the transcript keeps the rule, since it has no HEAD to compare.
export const GIT_WRITE = /\bgit\b[^\n|;&]*\b(commit|merge|rebase|cherry-pick|pull|revert|am)\b/;

export function movesHead(command: string): boolean {
  return GIT_WRITE.test(command);
}

// The claude.ai session token off a `https://claude.ai/code/session_<id>`
// URL (M58): the part a commit's Claude-Session trailer and a transcript's
// remote_session_change attachment share, which is how a commit is mapped
// to the conversation that made it. Shared since M70: the daemon reads it
// off a live session's transcript, the app's history scan off every
// transcript on disk.
export function remoteSessionIdOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = /\/(session_[A-Za-z0-9]+)\/?$/.exec(url.trim());
  return m === null ? null : m[1]!;
}

// The remote session id a parsed transcript line carries, or null: only
// an attachment line of type remote_session_change has one. Claude Code
// writes one near the head of a conversation and another wherever a
// resume was handed a new id, so a transcript can hold several.
export function remoteSessionIdOfLine(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const attachment = (entry as { attachment?: unknown }).attachment;
  if (typeof attachment !== 'object' || attachment === null) return null;
  const a = attachment as { type?: unknown; url?: unknown };
  if (a.type !== 'remote_session_change') return null;
  return remoteSessionIdOf(a.url);
}

// One turn of a conversation (M53): what was asked, what Claude last said
// before the next prompt, and what it did in between, read off the
// transcript's own lines so nothing is generated.
export interface Turn {
  // The whole prompt; a slash command as the command and its arguments.
  prompt: string;
  // When the prompt was sent and when the turn's last line landed (null
  // for a turn with the prompt alone), epoch ms.
  at: number | null;
  endAt: number | null;
  // The last assistant text before the next prompt, whole; null when the
  // turn had none (tool calls only, or cut off).
  reply: string | null;
  toolCalls: number;
  // Full paths, each once, in the order first touched.
  filesEdited: string[];
  filesRead: string[];
  // Bash commands that can move HEAD.
  commits: number;
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// Every turn of a transcript in order. A user line with text opens a turn
// (a tool result, a meta line and local command output do not); every
// later line up to the next prompt belongs to it: an assistant text part
// replaces the reply, a tool_use part counts, an Edit, Write, MultiEdit or
// NotebookEdit names a file edited, a Read one read, and a Bash command
// that can move HEAD is a commit. Side-chain lines (a subagent's) are
// skipped, and so is a broken line.
export function parseTurns(text: string): Turn[] {
  const turns: Turn[] = [];
  let turn: Turn | null = null;
  for (const raw of text.split('\n')) {
    const o = parseObject(raw);
    if (o === null || o['isSidechain'] === true) continue;
    const at = lineTime(o);
    const prompt = promptOf(o);
    if (prompt !== null) {
      turn = { prompt, at, endAt: null, reply: null, toolCalls: 0, filesEdited: [], filesRead: [], commits: 0 };
      turns.push(turn);
      continue;
    }
    if (turn === null) continue;
    if (at !== null && (turn.endAt === null || at > turn.endAt)) turn.endAt = at;
    if (o['type'] !== 'assistant') continue;
    const message = o['message'];
    if (!isObject(message) || !Array.isArray(message['content'])) continue;
    for (const part of message['content']) {
      if (!isObject(part)) continue;
      if (part['type'] === 'text' && typeof part['text'] === 'string' && part['text'].trim() !== '') turn.reply = part['text'];
      if (part['type'] !== 'tool_use') continue;
      turn.toolCalls += 1;
      const name = part['name'];
      const input = isObject(part['input']) ? part['input'] : {};
      const file = typeof input['file_path'] === 'string' ? input['file_path'] : typeof input['notebook_path'] === 'string' ? input['notebook_path'] : null;
      if (typeof name !== 'string') continue;
      if (EDIT_TOOLS.has(name) && file !== null && !turn.filesEdited.includes(file)) turn.filesEdited.push(file);
      if (name === 'Read' && file !== null && !turn.filesRead.includes(file)) turn.filesRead.push(file);
      if (HEAD_TOOLS.has(name) && typeof input['command'] === 'string' && movesHead(input['command'])) turn.commits += 1;
    }
  }
  return turns;
}

// A turn as the chat view draws it (M9 fix 688): the prompt, then every
// step in the order the transcript wrote it, each tool call carrying its
// result once the result line has landed. parseTurns stays the Sessions
// rail's and the Turns tab's reading; this one keeps what they fold away.
export interface StepTurn {
  prompt: string;
  at: number | null;
  endAt: number | null;
  steps: Step[];
  // M9 fix 718: the images pasted with the prompt, off the prompt line
  // itself or, for a slash command, off the meta line Claude Code writes
  // after it (the same promptId, or a parentUuid naming the prompt line).
  // The memory note at StepResult.image holds for these too.
  images: { mediaType: string; data: string }[];
}

export type Step =
  | { kind: 'thinking'; text: string; ms: number | null; at: number | null }
  | { kind: 'tool'; id: string; name: string; arg: string; input: Record<string, unknown>; at: number | null; result: StepResult | null }
  | { kind: 'text'; text: string; at: number | null }
  | { kind: 'note'; text: 'Interrupted'; at: number | null }
  // M9 fix 754: a message the person sent while the turn ran, which
  // Claude read mid-turn; `at` is its send time.
  | { kind: 'queued'; text: string; at: number | null };

export interface StepResult {
  error: boolean;
  exitCode: number | null;
  endAt: number | null;
  // A text Read's line count.
  lines: number | null;
  // An edit's lines added and removed.
  added: number | null;
  removed: number | null;
  // M9 fix 717: an image result with its base64 text, for the chat view's
  // thumbnail (data empty when the block had none, and then no thumbnail
  // is drawn). The memory it costs: the whole transcript is read and
  // parsed on every change, and the parse already made each image's
  // string once per pass; keeping it holds one copy per image beside the
  // file text until the next parse replaces it (five pastes of a real
  // session came to about 243 KB together), and a drawn thumbnail's
  // decoded bitmap is the image's full width by height by 4 bytes,
  // whatever its box (about 8 MB for a 1920 by 1080 screenshot).
  image: { mediaType: string; bytes: number; data: string } | null;
}

type ToolStep = Extract<Step, { kind: 'tool' }>;

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const AGENT_TOOLS = new Set(['Agent', 'Task']);

// The argument a tool row shows: the file it touches, the command it
// runs, the pattern it searches for and where, or what a subagent was
// sent to do.
function stepArg(name: string, input: Record<string, unknown>): string {
  if (typeof input['file_path'] === 'string') return input['file_path'];
  if (typeof input['notebook_path'] === 'string') return input['notebook_path'];
  if (typeof input['command'] === 'string') return input['command'];
  if (typeof input['pattern'] === 'string') return typeof input['path'] === 'string' ? `${input['pattern']} in ${input['path']}` : input['pattern'];
  if (AGENT_TOOLS.has(name)) {
    const kind = typeof input['subagent_type'] === 'string' ? input['subagent_type'] : '';
    const what = typeof input['description'] === 'string' ? input['description'] : '';
    return kind !== '' && what !== '' ? `${kind}: ${what}` : kind + what;
  }
  return '';
}

// A user line Claude Code writes when the person stops a turn: a note in
// the turn, never a prompt of its own.
function isInterrupt(o: Record<string, unknown>): boolean {
  if (o['type'] !== 'user') return false;
  if (o['interruptedMessageId'] !== undefined) return true;
  const message = o['message'];
  if (!isObject(message)) return false;
  const content = message['content'];
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => (isObject(p) && typeof p['text'] === 'string' ? p['text'] : '')).join('') : '';
  return text.trim().startsWith('[Request interrupted by user');
}

function resultContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((p) => (isObject(p) && p['type'] === 'text' && typeof p['text'] === 'string' ? p['text'] : '')).join('\n');
}

// Lines added and removed between two texts: the lines common to both
// ends are dropped and what is left on each side counted. Not a diff, but
// an edit's old and new strings are a hunk already.
export function editCounts(oldText: string, newText: string): { added: number; removed: number } {
  const a = oldText === '' ? [] : oldText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  return { added: b.length - head - tail, removed: a.length - head - tail };
}

function inputCounts(name: string, input: Record<string, unknown>): { added: number; removed: number } | null {
  const str = (k: string, o: Record<string, unknown> = input): string => (typeof o[k] === 'string' ? (o[k] as string) : '');
  if (name === 'Write') return editCounts('', str('content'));
  if (name === 'MultiEdit' && Array.isArray(input['edits'])) {
    let added = 0;
    let removed = 0;
    for (const e of input['edits']) {
      if (!isObject(e)) continue;
      const c = editCounts(str('old_string', e), str('new_string', e));
      added += c.added;
      removed += c.removed;
    }
    return { added, removed };
  }
  if (name === 'NotebookEdit') return editCounts('', str('new_source'));
  if (name === 'Edit') return editCounts(str('old_string'), str('new_string'));
  return null;
}

function patchCounts(patch: unknown): { added: number; removed: number } | null {
  if (!Array.isArray(patch)) return null;
  let added = 0;
  let removed = 0;
  for (const hunk of patch) {
    if (!isObject(hunk) || !Array.isArray(hunk['lines'])) continue;
    for (const l of hunk['lines']) {
      if (typeof l !== 'string') continue;
      if (l.startsWith('+')) added += 1;
      else if (l.startsWith('-')) removed += 1;
    }
  }
  return { added, removed };
}

function stepResult(tool: ToolStep, part: Record<string, unknown>, extra: unknown, at: number | null): StepResult {
  const error = part['is_error'] === true;
  const text = resultContentText(part['content']);
  let exitCode: number | null = null;
  if (SHELL_TOOLS.has(tool.name)) {
    if (!error) exitCode = 0;
    else {
      const m = /^Exit code (\d+)/.exec(text.trim());
      exitCode = m === null ? null : Number(m[1]);
    }
  }
  const file = isObject(extra) && isObject(extra['file']) ? extra['file'] : null;
  const lines = tool.name === 'Read' && file !== null && typeof file['numLines'] === 'number' ? file['numLines'] : null;
  let image: StepResult['image'] = null;
  if (Array.isArray(part['content'])) {
    const img = part['content'].find((p) => isObject(p) && p['type'] === 'image');
    if (isObject(img)) {
      const source = isObject(img['source']) ? img['source'] : {};
      const mediaType = typeof source['media_type'] === 'string' ? source['media_type'] : '';
      const data = typeof source['data'] === 'string' ? source['data'] : '';
      const bytes = file !== null && typeof file['originalSize'] === 'number' ? file['originalSize'] : Math.floor((data.length * 3) / 4);
      image = { mediaType, bytes, data };
    }
  }
  let counts: { added: number; removed: number } | null = null;
  if (EDIT_TOOLS.has(tool.name)) counts = (isObject(extra) ? patchCounts(extra['structuredPatch']) : null) ?? inputCounts(tool.name, tool.input);
  return { error, exitCode, endAt: at, lines, added: counts?.added ?? null, removed: counts?.removed ?? null, image };
}

// Every turn of a transcript with its steps (M9 fix 688). A turn opens on
// the lines parseTurns opens one on, except an interrupt, which is a note
// in the open turn. Claude Code writes one line per content block as a
// reply streams, so a tool_use id seen twice is kept once; a tool_result
// fills the result of the call with its id in the same turn and is
// dropped when none matches. Side-chain and broken lines are skipped.
export function parseSteps(text: string): StepTurn[] {
  const state = stepState();
  stepFold(state, text);
  return stepList(state);
}

// The step parse as a fold (M9 fix 769), so the chat view keeps its state
// and folds only what the transcript grew by (fix 770), and the mod's rows
// fold onto a copy of it. turn is the open turn (the last of turns), tools
// its calls by id, promptId and promptUuid its prompt line's (M9 fix 718),
// and uuids every line's uuid folded, so a mod row the file has caught up
// with is drawn once.
export interface StepState {
  turns: StepTurn[];
  turn: StepTurn | null;
  tools: Map<string, ToolStep>;
  promptId: string | null;
  promptUuid: string | null;
  uuids: Set<string>;
}

export function stepState(): StepState {
  return { turns: [], turn: null, tools: new Map(), promptId: null, promptUuid: null, uuids: new Set() };
}

// Every whole line of text folded in turn; a caller folding a tail hands
// whole lines only, since a line cut in two parses as nothing.
export function stepFold(state: StepState, text: string): void {
  for (const raw of text.split('\n')) {
    const o = parseObject(raw);
    if (o !== null) stepFoldEntry(state, o);
  }
}

// The turns as a new array each call; the turn objects are the state's,
// and the open one is changed by later folds.
export function stepList(state: StepState): StepTurn[] {
  return [...state.turns];
}

// A copy for the mod's rows to fold onto without touching the file's
// state: the open turn, its steps, its tool steps and its images are
// copied, the closed turns shared, and uuids starts empty.
export function stepFork(state: StepState): StepState {
  const turns = [...state.turns];
  const tools = new Map<string, ToolStep>();
  let turn: StepTurn | null = null;
  if (state.turn !== null && turns.length > 0 && turns[turns.length - 1] === state.turn) {
    const steps = state.turn.steps.map((step) => {
      if (step.kind !== 'tool') return step;
      const copy: ToolStep = { ...step };
      if (copy.id !== '' && state.tools.get(copy.id) === step) tools.set(copy.id, copy);
      return copy;
    });
    turn = { ...state.turn, steps, images: [...state.turn.images] };
    turns[turns.length - 1] = turn;
  }
  return { turns, turn, tools, promptId: state.promptId, promptUuid: state.promptUuid, uuids: new Set() };
}

// One parsed transcript line folded into the state.
export function stepFoldEntry(state: StepState, o: Record<string, unknown>): void {
  if (typeof o['uuid'] === 'string' && o['uuid'] !== '') state.uuids.add(o['uuid']);
  if (o['isSidechain'] === true) return;
  let turn = state.turn;
  const at = lineTime(o);
  if (isInterrupt(o)) {
    if (turn === null) return;
    if (at !== null && (turn.endAt === null || at > turn.endAt)) turn.endAt = at;
    turn.steps.push({ kind: 'note', text: 'Interrupted', at });
    return;
  }
  const prompt = promptOf(o);
  if (prompt !== null) {
    turn = { prompt, at, endAt: null, steps: [], images: imagesOf(o) };
    state.turn = turn;
    state.tools = new Map();
    state.promptId = typeof o['promptId'] === 'string' ? o['promptId'] : null;
    state.promptUuid = typeof o['uuid'] === 'string' ? o['uuid'] : null;
    state.turns.push(turn);
    return;
  }
  if (turn === null) return;
  if (o['type'] === 'user' && o['isMeta'] === true) {
    const sameId = state.promptId !== null && o['promptId'] === state.promptId;
    const noIds = state.promptId === null || typeof o['promptId'] !== 'string';
    if (sameId || (noIds && state.promptUuid !== null && o['parentUuid'] === state.promptUuid)) turn.images.push(...imagesOf(o));
  }
  if (at !== null && (turn.endAt === null || at > turn.endAt)) turn.endAt = at;
  // M9 fix 754: a message of the person's that Claude absorbed mid-turn
  // is an attachment line after the call it waited on; Claude Code's own
  // queued kinds (task notifications, peer messages) are skipped.
  if (o['type'] === 'attachment') {
    const queued = queuedStepOf(o['attachment']);
    if (queued !== null) turn.steps.push(queued);
    return;
  }
  const message = o['message'];
  if (!isObject(message) || !Array.isArray(message['content'])) return;
  if (o['type'] === 'assistant') {
    for (const part of message['content']) {
      if (!isObject(part)) continue;
      if (part['type'] === 'thinking') {
        const ms = typeof o['thinkingDurationMs'] === 'number' ? o['thinkingDurationMs'] : null;
        turn.steps.push({ kind: 'thinking', text: typeof part['thinking'] === 'string' ? part['thinking'] : '', ms, at });
      } else if (part['type'] === 'text') {
        if (typeof part['text'] === 'string' && part['text'].trim() !== '') turn.steps.push({ kind: 'text', text: part['text'], at });
      } else if (part['type'] === 'tool_use') {
        const id = typeof part['id'] === 'string' ? part['id'] : '';
        const name = typeof part['name'] === 'string' ? part['name'] : '';
        if (id !== '' && state.tools.has(id)) continue;
        const input = isObject(part['input']) ? part['input'] : {};
        const step: ToolStep = { kind: 'tool', id, name, arg: stepArg(name, input), input, at, result: null };
        if (id !== '') state.tools.set(id, step);
        turn.steps.push(step);
      }
    }
  } else if (o['type'] === 'user') {
    for (const part of message['content']) {
      if (!isObject(part) || part['type'] !== 'tool_result') continue;
      const tool = typeof part['tool_use_id'] === 'string' ? state.tools.get(part['tool_use_id']) : undefined;
      if (tool === undefined) continue;
      tool.result = stepResult(tool, part, o['toolUseResult'], at);
    }
  }
}

// A mod row (M9 fix 769) as the transcript line it will become, for
// stepFoldEntry; lineTime takes a number.
export function modRowLine(row: ModRow, uuid: string, at: number): Record<string, unknown> {
  return { type: row.type, uuid, isSidechain: false, timestamp: at, ...(row.isMeta ? { isMeta: true } : {}), message: { role: row.role ?? row.type, content: row.content } };
}

// The right-hand text of a tool row: what the call came to, then how
// long it took, in the Turns view's units.
export function resultText(step: Extract<Step, { kind: 'tool' }>): string {
  const r = step.result;
  if (r === null) return '';
  const length = step.at !== null && r.endAt !== null ? formatDuration(step.at, r.endAt) : null;
  const withLength = (head: string): string => (length === null ? head : `${head} · ${length}`);
  if (SHELL_TOOLS.has(step.name)) {
    if (r.exitCode !== null) return withLength(`exit ${r.exitCode}`);
    if (r.error) return withLength('error');
  }
  if (r.error) return 'error';
  if (step.name === 'Read' && r.image !== null) return `${Math.round(r.image.bytes / 1024)} KB`;
  if (step.name === 'Read' && r.lines !== null) return `${r.lines} lines`;
  if (EDIT_TOOLS.has(step.name) && r.added !== null && r.removed !== null) return `+${r.added} −${r.removed}`;
  if (AGENT_TOOLS.has(step.name)) return length === null ? 'returned' : `returned after ${length}`;
  return length ?? '';
}

// The effort the session's model answers at (M9 fix 713), off the last
// main-chain assistant line: Claude Code 2.1.300 writes a top-level
// `effort` on every assistant line (claim 3 of the chat claims), and the
// status line payload carries none. The last line alone decides, so a
// line written without it reads as unknown rather than as an older pick.
export function effortOf(text: string): string | null {
  const state = effortState();
  effortFold(state, text);
  return state.effort;
}

// The same read as a fold (M9 fix 770), for the chat view's tail read:
// how many main-chain assistant lines it has folded, and the last one's
// effort, so a pick in the footer is read against the count rather than
// a slice of the text.
export interface EffortState {
  assistants: number;
  effort: string | null;
}

export function effortState(): EffortState {
  return { assistants: 0, effort: null };
}

export function effortFold(state: EffortState, text: string): void {
  for (const raw of text.split('\n')) {
    const o = parseObject(raw);
    if (o === null || o['isSidechain'] === true || o['type'] !== 'assistant') continue;
    const effort = o['effort'];
    state.assistants += 1;
    state.effort = typeof effort === 'string' && effort !== '' ? effort : null;
  }
}

// One API request of a conversation as its transcript records it (M9 fix
// 252): the usage block on an assistant line, with when the line landed,
// the model that answered and, on a subagent's line, the agent's id. The
// commit card prices the stretch between two commits by summing these
// over it, so a commit made before the daemon kept any figure has a
// price too. The counts are the status line's four (session.ts's
// SessionTokens), read off the API's own names.
export interface UsageMessage {
  at: number;
  agentId: string | null;
  model: string | null;
  fresh: number;
  cacheWrite: number;
  // The share of cacheWrite written at the 1-hour TTL (M9 fix 278), off
  // usage.cache_creation.ephemeral_1h_input_tokens; 0 on a line whose
  // usage carries no cache_creation object, which is every line from
  // before Claude Code split the two.
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

// Every request in a transcript, in order, one per message id. Claude
// Code writes one line per content block as a reply streams in, each
// carrying the message's usage as it stood, so a message id repeats and
// the last line's figures are the whole request's; an earlier line's are
// dropped. A line with no message id (an older transcript) counts on its
// own. A side-chain line is a subagent's: it counts under the agent it
// names, or under `agent` when the caller reads an agent's own file
// (the files under the conversation's subagents folder, whose lines
// carry the id too), and is skipped when nothing names the agent, since
// it cannot be credited.
export function usageOf(text: string, agent: string | null = null): UsageMessage[] {
  const state = usageState();
  usageFold(state, text, agent);
  return usageList(state);
}

// The parse usageOf keeps between lines, split out (M9 fix 528) so a
// reader of a growing transcript can fold only the lines appended since
// its last read into what it held: a message id's later streamed line
// replaces its entry in place (Map.set keeps the first position), so a
// fold over two halves of a text equals a fold over the whole.
export interface UsageState {
  byId: Map<string, UsageMessage>;
  loose: UsageMessage[];
}

export function usageState(): UsageState {
  return { byId: new Map(), loose: [] };
}

export function usageFold(state: UsageState, text: string, agent: string | null): void {
  for (const raw of text.split('\n')) {
    const o = parseObject(raw);
    if (o === null || o['type'] !== 'assistant') continue;
    const message = o['message'];
    if (!isObject(message) || !isObject(message['usage'])) continue;
    const at = lineTime(o);
    if (at === null) continue;
    const agentId = typeof o['agentId'] === 'string' && o['agentId'] !== '' ? o['agentId'] : agent;
    if (o['isSidechain'] === true && agentId === null) continue;
    const u = message['usage'];
    const count = (k: string): number => (typeof u[k] === 'number' ? (u[k] as number) : 0);
    const cacheCreation = u['cache_creation'];
    const cacheWrite1h = isObject(cacheCreation) && typeof cacheCreation['ephemeral_1h_input_tokens'] === 'number' ? cacheCreation['ephemeral_1h_input_tokens'] : 0;
    const entry: UsageMessage = {
      at,
      agentId,
      model: typeof message['model'] === 'string' ? message['model'] : null,
      fresh: count('input_tokens'),
      cacheWrite: count('cache_creation_input_tokens'),
      cacheWrite1h,
      cacheRead: count('cache_read_input_tokens'),
      output: count('output_tokens'),
    };
    const id = message['id'];
    if (typeof id === 'string' && id !== '') state.byId.set(id, entry);
    else state.loose.push(entry);
  }
}

export function usageList(state: UsageState): UsageMessage[] {
  return [...state.byId.values(), ...state.loose].sort((a, b) => a.at - b.at);
}

// M9 fix 754: Claude Code's queue of messages sent while a turn runs, off
// its `queue-operation` lines, in usageFold's shape so a reader of a
// growing transcript can fold only what was appended. The state holds the
// whole queue in order, Claude Code's own items too (task notifications,
// agent and cross-session messages), so a `dequeue`, which names no
// content, takes the right one; the list is the person's alone.
export interface QueuedMessage {
  text: string;
  at: number | null;
}

export interface QueueState {
  items: { content: string | null; at: number | null; mine: boolean }[];
}

const MACHINE_QUEUED = ['<task-notification>', '<agent-message', '<cross-session-message'];

export function queueState(): QueueState {
  return { items: [] };
}

export function queueFold(state: QueueState, text: string): void {
  const take = (content: unknown) => {
    if (typeof content !== 'string') return;
    const k = state.items.findIndex((i) => i.content === content);
    if (k >= 0) state.items.splice(k, 1);
  };
  for (const raw of text.split('\n')) {
    const o = parseObject(raw);
    if (o === null) continue;
    if (o['type'] === 'queue-operation') {
      const op = o['operation'];
      if (op === 'enqueue') {
        const content = typeof o['content'] === 'string' ? o['content'] : null;
        const mine = content !== null && !MACHINE_QUEUED.some((m) => content.startsWith(m));
        state.items.push({ content, at: lineTime(o), mine });
      } else if (op === 'dequeue') state.items.shift();
      else if (op === 'remove' || op === 'popOne' || op === 'popAll') take(o['content']);
      continue;
    }
    // A message that waited for the turn's end goes in as a prompt; when
    // its dequeue was missed the prompt line still takes it.
    if (o['isSidechain'] !== true) take(promptOf(o));
  }
}

export function queueList(state: QueueState): QueuedMessage[] {
  return state.items.filter((i) => i.mine && i.content !== null).map((i) => ({ text: i.content!, at: i.at }));
}

export function queuedOf(text: string): QueuedMessage[] {
  const state = queueState();
  queueFold(state, text);
  return queueList(state);
}

// A `queued_command` attachment's step when it is the person's (a human
// origin or a human turn), its prompt a string or text parts joined; an
// image part is not drawn in this cut.
function queuedStepOf(a: unknown): Step | null {
  if (!isObject(a) || a['type'] !== 'queued_command') return null;
  const origin = a['origin'];
  if (!((isObject(origin) && origin['kind'] === 'human') || a['humanTurn'] === true)) return null;
  const prompt = a['prompt'];
  let text = '';
  if (typeof prompt === 'string') text = prompt;
  else if (Array.isArray(prompt)) text = prompt.filter((p): p is { type: 'text'; text: string } => isObject(p) && p['type'] === 'text' && typeof p['text'] === 'string').map((p) => p.text).join('\n');
  if (text.trim() === '') return null;
  return { kind: 'queued', text, at: lineTime(a) };
}

// The image parts of a user line's content, each with its base64 text;
// one with no string data is skipped (M9 fix 718).
function imagesOf(o: Record<string, unknown>): { mediaType: string; data: string }[] {
  const message = o['message'];
  if (!isObject(message) || !Array.isArray(message['content'])) return [];
  const out: { mediaType: string; data: string }[] = [];
  for (const part of message['content']) {
    if (!isObject(part) || part['type'] !== 'image' || !isObject(part['source'])) continue;
    const source = part['source'];
    if (typeof source['data'] !== 'string') continue;
    out.push({ mediaType: typeof source['media_type'] === 'string' ? source['media_type'] : '', data: source['data'] });
  }
  return out;
}

// The text of a user line that is a prompt someone typed, else null: not
// a meta line, not a tool result, and a slash command as the command and
// its arguments (the same reading the Sessions rows give a prompt).
function promptOf(o: Record<string, unknown>): string | null {
  if (o['type'] !== 'user' || o['isMeta'] === true) return null;
  const message = o['message'];
  if (!isObject(message)) return null;
  const content = message['content'];
  let text: string | null = null;
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    if (content.some((part) => isObject(part) && part['type'] === 'tool_result')) return null;
    const first = content.find((part): part is { type: 'text'; text: string } => isObject(part) && part['type'] === 'text' && typeof part['text'] === 'string');
    text = first === undefined ? null : first.text;
  }
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.startsWith('<local-command') || trimmed.startsWith('<bash-')) return null;
  const name = /<command-name>([^<]*)<\/command-name>/.exec(trimmed);
  if (name === null) return trimmed;
  const args = /<command-args>([^<]*)<\/command-args>/.exec(trimmed);
  return `${name[1]!.trim()} ${args?.[1]?.trim() ?? ''}`.trim();
}

function lineTime(o: Record<string, unknown>): number | null {
  const ts = o['timestamp'];
  if (typeof ts === 'number') return ts;
  if (typeof ts !== 'string') return null;
  const at = Date.parse(ts);
  return Number.isNaN(at) ? null : at;
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
