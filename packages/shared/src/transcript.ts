import { summarize } from './state-machine.ts';
import { HEAD_TOOLS } from './command-dir.ts';

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
