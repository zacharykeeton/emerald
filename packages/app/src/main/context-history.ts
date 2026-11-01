import fs from 'node:fs';
import path from 'node:path';
import { claudeHome, claudeHomeExists } from './claude-home.ts';
import { appendedBytesRead, markKind, markOf, readWholeLines, statStamp } from './appended-read.ts';
import type { ReadMark } from './appended-read.ts';
import { listTranscripts } from './history.ts';
import type { HistoryLog } from './history.ts';
import type { ContextHistory, ServerHistory, SessionUse, SkillHistory } from '../preload/api.ts';
import { promptText } from '../renderer/src/history-model.ts';
import { mcpServerKey } from '../renderer/src/skill-history-model.ts';

// The Context tab's history (M9 fix 1039): how often each skill ran and
// each MCP server was called, over every top-level transcript on the
// machine (the set the History panel lists), and what the turns a skill
// ran in cost over the last 7 days. Each transcript's fold is kept beside
// the mark of where its read stopped (appended-read.ts), so the first ask
// reads the whole set (13 s for 1.79 GB on the probe of 2026-10-31) and
// every later one reads only what grew.
//
// A use is a Skill tool call, or a typed slash command that Claude Code
// followed with the skill's `Base directory for this skill` meta line (a
// built-in command never gets that line). Its tokens are the requests
// after its call up to the next prompt, each request once by message id
// at its last streamed figures, the call's own request left out since it
// was spent before the skill's body loaded (claim 4 of the design,
// settled against /skill-doctor's own figures).

export const CONTEXT_HISTORY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SkillUse {
  name: string;
  at: number;
  tokens: number;
}

export interface OpenUse extends SkillUse {
  // The message id of the Skill call's own request, left out of the
  // tokens; null for a typed skill, whose meta line opens it.
  callMessage: string | null;
  requests: Map<string, number>;
}

export interface UseFoldState {
  uses: SkillUse[];
  open: OpenUse[];
  // A typed command waiting for the meta line that says it is a skill.
  pending: { name: string; at: number } | null;
  mcpTools: Map<string, { calls: number; lastUsedAt: number }>;
  agents: Map<string, number>;
}

export function useFoldState(): UseFoldState {
  return { uses: [], open: [], pending: null, mcpTools: new Map(), agents: new Map() };
}

// The words a line must hold to matter while nothing is open: about one
// line in nine on the probe, and parsing the rest was most of the time.
const WORTH_PARSING = ['"Skill"', '"mcp__', '<command-name>', '"Agent"', '"Task"'];

export function useFold(state: UseFoldState, text: string): void {
  for (const raw of text.split('\n')) {
    if (state.open.length === 0 && state.pending === null && !WORTH_PARSING.some((w) => raw.includes(w))) continue;
    const o = parseObject(raw);
    if (o === null || o['isSidechain'] === true) continue;
    const at = lineTime(o);
    if (at === null) continue;
    if (o['type'] === 'user') foldUser(state, o, at);
    else if (o['type'] === 'assistant') {
      state.pending = null;
      foldAssistant(state, o, at);
    }
  }
}

function foldUser(state: UseFoldState, o: Record<string, unknown>, at: number): void {
  if (state.pending !== null) {
    if (o['isMeta'] === true) {
      if (lineText(o)?.startsWith('Base directory for this skill') === true) {
        state.open.push({ name: state.pending.name, at: state.pending.at, tokens: 0, callMessage: null, requests: new Map() });
        state.pending = null;
      }
      // Another meta line (a caveat) keeps waiting.
      return;
    }
    state.pending = null;
  }
  if (promptText(o) === null) return;
  closeAll(state);
  const name = /<command-name>([^<]*)<\/command-name>/.exec(lineText(o) ?? '')?.[1]?.trim().replace(/^\//, '') ?? '';
  if (name !== '') state.pending = { name, at };
}

function foldAssistant(state: UseFoldState, o: Record<string, unknown>, at: number): void {
  const message = o['message'];
  if (!isObject(message)) return;
  const id = typeof message['id'] === 'string' && message['id'] !== '' ? message['id'] : null;
  const content = message['content'];
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!isObject(part) || part['type'] !== 'tool_use' || typeof part['name'] !== 'string') continue;
      const name = part['name'];
      const input = isObject(part['input']) ? part['input'] : {};
      if (name === 'Skill' && typeof input['skill'] === 'string' && input['skill'] !== '') {
        state.open.push({ name: input['skill'].replace(/^\//, ''), at, tokens: 0, callMessage: id, requests: new Map() });
      } else if (name.startsWith('mcp__')) {
        const have = state.mcpTools.get(name);
        state.mcpTools.set(name, { calls: (have?.calls ?? 0) + 1, lastUsedAt: Math.max(have?.lastUsedAt ?? 0, at) });
      } else if (name === 'Agent' || name === 'Task') {
        // Claude Code's default agent when the call names none.
        const type = typeof input['subagent_type'] === 'string' && input['subagent_type'] !== '' ? input['subagent_type'] : 'general-purpose';
        state.agents.set(type, (state.agents.get(type) ?? 0) + 1);
      }
    }
  }
  const usage = message['usage'];
  if (id === null || !isObject(usage)) return;
  const count = (k: string): number => (typeof usage[k] === 'number' ? (usage[k] as number) : 0);
  const total = count('input_tokens') + count('cache_creation_input_tokens') + count('cache_read_input_tokens') + count('output_tokens');
  // A streamed request's last line wins.
  for (const use of state.open) if (use.callMessage !== id) use.requests.set(id, total);
}

function closeAll(state: UseFoldState): void {
  for (const use of state.open) state.uses.push({ name: use.name, at: use.at, tokens: sumOf(use.requests) });
  state.open = [];
}

function sumOf(requests: Map<string, number>): number {
  let n = 0;
  for (const v of requests.values()) n += v;
  return n;
}

// The text of a user line: its string content, else its first text block.
function lineText(o: Record<string, unknown>): string | null {
  const message = o['message'];
  if (!isObject(message)) return null;
  const content = message['content'];
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content.find((p): p is { type: 'text'; text: string } => isObject(p) && p['type'] === 'text' && typeof p['text'] === 'string');
  return text?.text ?? null;
}

interface Cached {
  mark: ReadMark;
  state: UseFoldState;
}

const cache = new Map<string, Cached>();
let running: { transcript: string | null; read: Promise<ContextHistory> } | null = null;

export async function readContextHistory(transcript: string | null, log: HistoryLog, now = Date.now()): Promise<ContextHistory> {
  // Concurrent asks share one read; an ask for another transcript waits
  // for it and reads after it, by which time the machine's files are
  // held and only its own part is new.
  while (running !== null) {
    const r = running;
    if (r.transcript === transcript) return r.read;
    await r.read.catch(() => undefined);
    if (running === r) running = null;
  }
  const read = readAll(transcript, log, now);
  const mine = { transcript, read };
  running = mine;
  try {
    return await read;
  } finally {
    if (running === mine) running = null;
  }
}

async function readAll(transcript: string | null, log: HistoryLog, now: number): Promise<ContextHistory> {
  const started = Date.now();
  const before = appendedBytesRead();
  let readFiles = 0;
  const skills = new Map<string, SkillHistory>();
  const servers = new Map<string, ServerHistory>();
  const sessionKey = transcript !== null && transcript.endsWith('.jsonl') ? path.resolve(transcript) : null;
  const keep = new Set<string>();
  if (claudeHomeExists(log)) {
    const listed = await listTranscripts(path.join(claudeHome(), 'projects'), log);
    for (const file of listed.values()) {
      const key = path.resolve(file);
      keep.add(key);
      const got = await foldFile(key, log);
      if (got === null) continue;
      if (got.read) readFiles += 1;
      addMachine(got.state, skills, servers, now);
    }
  }
  let session: SessionUse | null = null;
  if (sessionKey !== null) {
    keep.add(sessionKey);
    const got = await foldFile(sessionKey, log);
    if (got !== null) {
      // A listed file was read above and answers from the cache here.
      if (got.read) readFiles += 1;
      session = { mcpTools: Object.fromEntries([...got.state.mcpTools].map(([k, v]) => [k, v.calls])), agents: Object.fromEntries(got.state.agents) };
    }
  }
  // Files gone from the listing leave the cache.
  for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key);
  const bytes = appendedBytesRead() - before;
  if (bytes > 0) log(`context history: read ${readFiles} transcripts (${(bytes / 1024 / 1024).toFixed(1)} MB) in ${Date.now() - started} ms`);
  return { skills: Object.fromEntries(skills), servers: Object.fromEntries(servers), session };
}

function addMachine(state: UseFoldState, skills: Map<string, SkillHistory>, servers: Map<string, ServerHistory>, now: number): void {
  const since = now - CONTEXT_HISTORY_DAYS * DAY_MS;
  const add = (name: string, at: number, tokens: number): void => {
    const have = skills.get(name) ?? { uses: 0, lastUsedAt: 0, tokens7d: 0 };
    have.uses += 1;
    have.lastUsedAt = Math.max(have.lastUsedAt, at);
    if (at >= since) have.tokens7d += tokens;
    skills.set(name, have);
  };
  for (const use of state.uses) add(use.name, use.at, use.tokens);
  // An open use counts what it has so far.
  for (const use of state.open) add(use.name, use.at, sumOf(use.requests));
  for (const [wire, tool] of state.mcpTools) {
    const key = mcpServerKey(wire);
    if (key === null) continue;
    const have = servers.get(key) ?? { calls: 0, lastUsedAt: 0 };
    have.calls += tool.calls;
    have.lastUsedAt = Math.max(have.lastUsedAt, tool.lastUsedAt);
    servers.set(key, have);
  }
}

// One transcript's fold, from the cache when the file has not moved, read
// on from the mark when it has only grown, from 0 otherwise. Null when the
// file cannot be read, which drops what was held for it.
async function foldFile(file: string, log: HistoryLog): Promise<{ state: UseFoldState; read: boolean } | null> {
  let stat;
  try {
    stat = await statStamp(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not stat ${file}: ${String(err)}`);
    cache.delete(file);
    return null;
  }
  const have = cache.get(file);
  const kind = markKind(have?.mark, stat);
  if (have !== undefined && kind === 'same') return { state: have.state, read: false };
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(file, 'r');
  } catch (err) {
    log(`could not open ${file}: ${String(err)}`);
    cache.delete(file);
    return null;
  }
  try {
    const grown = have !== undefined && kind === 'grown';
    const state = grown ? have.state : useFoldState();
    const offset = await readWholeLines(handle, grown ? have.mark.offset : 0, stat.size, (text) => useFold(state, text));
    cache.set(file, { mark: markOf(stat, offset), state });
    return { state, read: true };
  } catch (err) {
    log(`could not read ${file}: ${String(err)}`);
    cache.delete(file);
    return null;
  } finally {
    await handle.close();
  }
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
