import fs from 'node:fs';
import path from 'node:path';
import { claudeHome, claudeHomeExists } from './claude-home.ts';
import { isSessionId, parseTurns, saidFold, saidState, sliceUsage, tokensUp, usageFold, usageList, usageState } from '@emerald/shared';
import type { SaidState, UsageMessage, UsageState } from '@emerald/shared';
import { markKind, markOf, readWholeLines, statStamp } from './appended-read.ts';
import type { FileStamp, ReadMark } from './appended-read.ts';
import type { AgentsRunning, ConversationUsage, HistoryScan, HistorySession, TranscriptCost, TranscriptTurns } from '../preload/api.ts';
import { READ_CAP, readCapped } from './read-cap.ts';
import { watchFolder } from './watch-folder.ts';
import { CHUNK_BYTES, COUNT_CAP_BYTES, RECENT_CAP, buildSession, countPrompts, indexHistory, parseTranscriptHead, parseTranscriptTail, remoteIdsIn, sortNewest, transcriptsOf } from '../renderer/src/history-model.ts';

// The scan behind the History panel: every Claude Code conversation on
// the machine, read from the files Claude Code keeps under ~/.claude (the
// shapes are described in history-model.ts). history.jsonl is the index,
// one small line per prompt; each transcript is read at its head and its
// tail only, since one can run to tens of megabytes, and what was read is
// kept with the mark of where the read stopped, so a rescan touches only
// files that changed and reads an appended file on from where it stopped
// (M9 fixes 528 and 529, appended-read.ts).
// Nothing here writes under ~/.claude.
//
// EMERALD_CLAUDE_HOME points the scan elsewhere, for the verify script,
// the same as the usage strip (claude-home.ts); a home that is not there
// is an empty scan with no watcher (M9 fix 243).

export type HistoryLog = (msg: string) => void;

interface Cached {
  // Where the id sweep stopped (M9 fix 529): offset 0 while the file is
  // within the head chunk and nothing is swept.
  mark: ReadMark;
  head: ReturnType<typeof parseTranscriptHead>;
  tail: ReturnType<typeof parseTranscriptTail>;
  // Only counted for a session with no history lines, and only once.
  counted: number | null;
  // The remote session ids between the head and the tail (M70), off a
  // sweep of the file read on from where the last sweep stopped; empty
  // when the head chunk was the file.
  swept: string[];
}

const cache = new Map<string, Cached>();
// Repository roots by folder, and whether folders exist, for the scan;
// both are cheap to re-ask, so they are dropped at the end of each scan.
let roots = new Map<string, string | null>();
let exists = new Map<string, boolean>();

export async function scanHistory(log: HistoryLog): Promise<HistoryScan> {
  // A watcher that lost its watch (M9 fix 481) tries again on each scan.
  for (const w of [...lapsed]) w.retry();
  const home = claudeHome();
  if (!claudeHomeExists(log)) {
    cache.clear();
    return { sessions: [], total: 0, transcripts: [] };
  }
  const index = indexHistory(await readText(path.join(home, 'history.jsonl'), log));
  const transcripts = await listTranscripts(path.join(home, 'projects'), log);
  const sessions: HistorySession[] = [];
  for (const [id, file] of transcripts) {
    const entry = index.get(id);
    const meta = await readTranscript(file, entry === undefined, log);
    if (meta === null) continue;
    const session = buildSession(id, file, entry, meta.head, meta.tail, meta.counted, meta.swept);
    if (session === null) continue;
    session.cwdExists = await folderExists(session.cwd);
    session.project = (session.cwdExists ? await repoRoot(session.cwd) : null) ?? session.cwd;
    sessions.push(session);
  }
  // Transcripts that are gone leave the cache too.
  const live = new Set(transcripts.values());
  for (const file of cache.keys()) {
    if (!live.has(file)) cache.delete(file);
  }
  roots = new Map();
  exists = new Map();
  const newest = sortNewest(sessions);
  return { sessions: newest.slice(0, RECENT_CAP), total: newest.length, transcripts: transcriptsOf(newest) };
}

// The whole transcript for the transcript view (M53): the same cap as a
// file tab, since the raw view is one; the facts come off the head and
// the tail read as one whole text, so a fresh read never disagrees with
// the panel's row.
export async function readTurns(file: string, log: HistoryLog): Promise<TranscriptTurns | { error: string }> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return { error: 'The transcript is gone' };
  }
  if (stat.size > READ_CAP) return { error: `Too large to show (${(stat.size / 1024 / 1024).toFixed(1)} MB)` };
  let text: string;
  try {
    // Read through a bounded handle (M9 fix 483), since a transcript
    // being written can grow past the cap after the stat.
    const buf = await readCapped(file, stat.size);
    if (buf === null) return { error: `Too large to show (over ${(READ_CAP / 1024 / 1024).toFixed(1)} MB)` };
    text = buf.toString('utf8');
  } catch (err) {
    log(`could not read ${file}: ${String(err)}`);
    return { error: 'The transcript could not be read' };
  }
  const head = parseTranscriptHead(text, true);
  const tail = parseTranscriptTail(text, true);
  return { title: head.title, cwd: head.cwd, branch: head.branch, model: tail.model, startedAt: head.startedAt, lastAt: tail.lastAt, turns: parseTurns(text) };
}

// Every <sessionId>.jsonl one level under projects/. A subfolder named
// after a session holds that session's subagents and is not listed.
async function listTranscripts(projects: string, log: HistoryLog): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  let dirs: fs.Dirent[];
  try {
    dirs = await fs.promises.readdir(projects, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not list ${projects}: ${String(err)}`);
    return found;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const full = path.join(projects, dir.name);
    let files: string[];
    try {
      files = await fs.promises.readdir(full);
    } catch (err) {
      log(`could not list ${full}: ${String(err)}`);
      continue;
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      found.set(name.slice(0, -'.jsonl'.length), path.join(full, name));
    }
  }
  return found;
}

async function readTranscript(file: string, wantCount: boolean, log: HistoryLog): Promise<Cached | null> {
  let stat: FileStamp;
  try {
    stat = await statStamp(file);
  } catch (err) {
    log(`could not stat ${file}: ${String(err)}`);
    return null;
  }
  const have = cache.get(file);
  const kind = markKind(have?.mark, stat);
  if (have !== undefined && kind === 'same' && (!wantCount || have.counted !== null)) return have;
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(file, 'r');
  } catch (err) {
    log(`could not open ${file}: ${String(err)}`);
    return null;
  }
  try {
    const whole = stat.size <= CHUNK_BYTES;
    const headText = await readAt(handle, 0, Math.min(CHUNK_BYTES, stat.size));
    const tailText = whole ? headText : await readAt(handle, stat.size - CHUNK_BYTES, CHUNK_BYTES);
    // The remote session ids anywhere in the transcript (M70). A resume
    // that is handed a new claude.ai session id writes the attachment
    // where the conversation goes on, which is the middle of the file as
    // often as not, so the head and the tail are not enough; the file is
    // read in chunks and only a line naming the attachment's type is
    // parsed. The sweep reads from where it stopped (M9 fix 529), so a
    // live transcript costs each rescan its new lines alone rather than
    // the whole file on every prompt; the new ids go after the held ones
    // in file order, so buildSession's merge gives what a fresh read
    // would. A session with no history line has its prompts counted off
    // the same sweep (M9 fix 552), carried on from the held count, so a
    // grown transcript costs its new lines rather than a fresh read of
    // its first 4 MB; a file whose held entry has no count (it had a
    // history line then) is read from the start.
    const carry = have !== undefined && kind !== 'fresh' && (!wantCount || have.counted !== null);
    const from = carry ? have.mark.offset : 0;
    const swept = carry ? [...have.swept] : [];
    let counted: number | null = null;
    let offset = 0;
    if (whole) {
      counted = wantCount ? countPrompts(headText, true) : null;
    } else {
      counted = wantCount ? (from > 0 ? have!.counted! : 0) : null;
      offset = await readWholeLines(handle, from, stat.size, (text, start) => {
        for (const id of remoteIdsIn(text, true)) if (!swept.includes(id)) swept.push(id);
        if (counted !== null && start < COUNT_CAP_BYTES) counted += countPrompts(underCap(text, start), true);
      });
    }
    const entry: Cached = {
      mark: markOf(stat, offset),
      head: parseTranscriptHead(headText, whole),
      tail: parseTranscriptTail(tailText, whole),
      counted,
      swept,
    };
    cache.set(file, entry);
    return entry;
  } catch (err) {
    log(`could not read ${file}: ${String(err)}`);
    return null;
  } finally {
    await handle.close();
  }
}

// The whole lines of a swept text that end before COUNT_CAP_BYTES, so the
// count stops where a 4 MB head read's did: a line whose newline lies
// past the cap is not counted.
function underCap(text: string, start: number): string {
  const bytes = Buffer.byteLength(text);
  if (start + bytes <= COUNT_CAP_BYTES) return text;
  const cut = Buffer.from(text).subarray(0, COUNT_CAP_BYTES - start);
  const last = cut.lastIndexOf(0x0a);
  return last === -1 ? '' : cut.subarray(0, last + 1).toString('utf8');
}

let scanBytes = 0;

// The bytes the scan's own reads (the head, the tail, and until M9 fix
// 552 the prompt count) have read, for the tests; the sweep's are
// appendedBytesRead.
export function scanBytesRead(): number {
  return scanBytes;
}

async function readAt(handle: fs.promises.FileHandle, position: number, length: number): Promise<string> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, position);
  scanBytes += bytesRead;
  return buf.subarray(0, bytesRead).toString('utf8');
}

async function readText(file: string, log: HistoryLog): Promise<string> {
  try {
    return await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not read ${file}: ${String(err)}`);
    return '';
  }
}

async function folderExists(dir: string): Promise<boolean> {
  const have = exists.get(dir);
  if (have !== undefined) return have;
  let ok: boolean;
  try {
    ok = (await fs.promises.stat(dir)).isDirectory();
  } catch {
    ok = false;
  }
  exists.set(dir, ok);
  return ok;
}

// The nearest folder at or above dir holding a .git (a folder, or the
// file a worktree has), or null when there is none up to the drive root.
export async function repoRoot(dir: string): Promise<string | null> {
  const have = roots.get(dir);
  if (have !== undefined) return have;
  let at = path.resolve(dir);
  let root: string | null = null;
  for (;;) {
    try {
      await fs.promises.stat(path.join(at, '.git'));
      root = at;
      break;
    } catch {
      // Not here; one level up.
    }
    const up = path.dirname(at);
    if (up === at) break;
    at = up;
  }
  roots.set(dir, root);
  return root;
}

// Watches history.jsonl, which Claude Code appends on every prompt, and
// calls back a second after the last change. The folder is watched
// rather than the file so a history.jsonl that does not exist yet is seen
// when it appears. The folder is watched under its long name: libuv's
// watcher asserts (and takes the process with it) when the folder was
// given in 8.3 form, as os.tmpdir() is on this machine, and the change
// comes back under the long form; watchFolder (M9 fix 481) does that,
// and ends the watch when the folder is deleted or the watch errors,
// after which the next scanHistory tries again rather than the panel
// going quiet until it is closed and opened.
export class HistoryWatcher {
  private watcher: fs.FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly onChange: () => void;
  private readonly log: HistoryLog;

  constructor(onChange: () => void, log: HistoryLog) {
    this.onChange = onChange;
    this.log = log;
  }

  set(on: boolean): void {
    if (!on) {
      this.close();
      return;
    }
    if (this.watcher !== null) return;
    // A home that is not there gets no watcher and no error line; the
    // refresh button is there, and a scan on it is empty.
    if (!claudeHomeExists(this.log)) return;
    const home = claudeHome();
    this.watcher = watchFolder(
      home,
      (name) => {
        if (name !== 'history.jsonl') return;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          this.onChange();
        }, 1000);
      },
      () => {
        this.log(`history watch ended (${home} went or the watch failed); trying again at the next scan`);
        this.watcher = null;
        lapsed.add(this);
      },
    );
    // The folder went between the check and the watch, or cannot be
    // watched; the next scan tries again.
    if (this.watcher === null) {
      this.log(`history watch not started on ${home}`);
      lapsed.add(this);
    }
  }

  // The next scan's second try at a watch that ended; a home still
  // missing (deleted and not yet back) stays on the list for the one
  // after.
  retry(): void {
    lapsed.delete(this);
    this.set(true);
    if (this.watcher === null) lapsed.add(this);
  }

  get watching(): boolean {
    return this.watcher !== null;
  }

  close(): void {
    lapsed.delete(this);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
  }
}

// The watchers whose watch ended while the panel still wanted it.
const lapsed = new Set<HistoryWatcher>();

// The commit card's usage (M9 fix 252): every request a conversation
// made, the session's own off its transcript and its subagents' off the
// files under <transcript folder>/<conversation>/subagents, each tagged
// with the agent, as one list the renderer slices per commit. The
// transcript is found by the conversation id under projects/ (the
// folder is the cwd's encoding, which the renderer does not know), the
// parse kept per file with the mark of where its read stopped, so a file
// that has only grown is read on from there and its new lines folded
// into the parse (M9 fix 528), and the answer carries a stamp of the
// whole set so the renderer's next ask with the same stamp gets `same`
// and no list: a graph of forty commits asks once per session, not once
// per row. Null when no transcript names the id.
interface UsageCached {
  mark: ReadMark;
  state: UsageState;
  messages: UsageMessage[];
  said: SaidState;
}

const usageCache = new Map<string, UsageCached>();
const transcriptPaths = new Map<string, string>();

export async function readUsage(conversation: string, known: string | null, log: HistoryLog): Promise<ConversationUsage | null> {
  const file = await findTranscript(conversation, log);
  if (file === null) return null;
  const set = await conversationFiles(file, log);
  if (set === null) {
    transcriptPaths.delete(conversation);
    return null;
  }
  if (known !== null && known === set.stamp) return { stamp: set.stamp, messages: null };
  const messages: UsageMessage[] = [];
  for (const f of set.files) messages.push(...(await parseUsage(f, log)));
  messages.sort((a, b) => a.at - b.at);
  return { stamp: set.stamp, messages };
}

// A conversation's files: the transcript and its agents' under
// <folder>/<conversation>/subagents, each with its stat, and a stamp of
// the whole set (name, size and mtime per file) that says whether any
// of them moved. Null when the transcript itself is gone.
interface ConversationFiles {
  files: Array<{ path: string; stat: FileStamp; agentId: string | null }>;
  stamp: string;
}

async function conversationFiles(file: string, log: HistoryLog): Promise<ConversationFiles | null> {
  const conversation = path.basename(file, '.jsonl');
  const agentFiles = await listAgentTranscripts(path.join(path.dirname(file), conversation, 'subagents'), log);
  const paths = [file, ...agentFiles];
  const stats = await Promise.all(paths.map((f) => statStamp(f).catch(() => null)));
  if (stats[0] === null) return null;
  const files: ConversationFiles['files'] = [];
  for (let i = 0; i < paths.length; i += 1) {
    const stat = stats[i];
    if (stat === null || stat === undefined) continue;
    // An agent file names its agent on every line; the name in the file
    // is the fallback for a line that does not.
    const agentId = i === 0 ? null : /^agent-(.+)\.jsonl$/.exec(path.basename(paths[i]!))?.[1] ?? null;
    files.push({ path: paths[i]!, stat, agentId });
  }
  const stamp = files.map((f) => `${path.basename(f.path)}:${f.stat.size}:${f.stat.mtimeMs}`).join('|');
  return { files, stamp };
}

async function parseUsage(f: ConversationFiles['files'][number], log: HistoryLog): Promise<UsageMessage[]> {
  const have = usageCache.get(f.path);
  const kind = markKind(have?.mark, f.stat);
  if (have !== undefined && kind === 'same') return have.messages;
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(f.path, 'r');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not read ${f.path}: ${String(err)}`);
    return [];
  }
  try {
    const grown = have !== undefined && kind === 'grown';
    const state = grown ? have.state : usageState();
    const said = grown ? have.said : saidState();
    const offset = await readWholeLines(handle, grown ? have.mark.offset : 0, f.stat.size, (text) => {
      usageFold(state, text, f.agentId);
      saidFold(said, text);
    });
    const messages = usageList(state);
    usageCache.set(f.path, { mark: markOf(f.stat, offset), state, messages, said });
    return messages;
  } catch (err) {
    log(`could not read ${f.path}: ${String(err)}`);
    usageCache.delete(f.path);
    return [];
  } finally {
    await handle.close();
  }
}

// The whole conversation's price for a Sessions tab row (M9 fix 256):
// the transcript at the path and its agents' files beside it (M9 fix
// 273, the set readUsage reads; the row's live figure, Claude Code's
// own, has the agents in, and the estimate that replaces it at the
// session's end left out two thirds of the money on this repo's home)
// summed and priced from the rates table; cached by path under the
// set's stamp, so a re-ask is a stat per file and an agent file that
// grew after the transcript re-prices the row; refused over READ_CAP as
// readTurns is, per file, so a row never starts a read of tens of
// megabytes: the transcript itself over the cap is nothing to price, an
// agent file over it is left out and counted in the answer. Null when
// there is nothing to price.
const costCache = new Map<string, { stamp: string; cost: TranscriptCost | null }>();

export async function readTranscriptCost(file: string, log: HistoryLog): Promise<TranscriptCost | null> {
  const set = await conversationFiles(file, log);
  if (set === null) {
    costCache.delete(file);
    return null;
  }
  const have = costCache.get(file);
  if (have !== undefined && have.stamp === set.stamp) return have.cost;
  let cost: TranscriptCost | null = null;
  if (set.files[0]!.stat.size <= READ_CAP) {
    const messages: UsageMessage[] = [];
    let skipped = 0;
    for (const f of set.files) {
      if (f.stat.size > READ_CAP) {
        skipped += 1;
        continue;
      }
      messages.push(...(await parseUsage(f, log)));
    }
    const usage = sliceUsage(messages, -Infinity, Infinity);
    if (usage !== null) {
      const agents = usage.agents.reduce((a, agent) => ({ count: a.count + 1, usd: a.usd === null ? agent.usd : a.usd + (agent.usd ?? 0) }), { count: 0, usd: null as number | null });
      cost = { usd: usage.usd, tokens: { up: tokensUp(usage.tokens), down: usage.tokens.output, cached: usage.tokens.cacheRead }, agents: { ...agents, skipped } };
    }
  }
  costCache.set(file, { stamp: set.stamp, cost });
  return cost;
}

// The forked agents' spend since the main thread's last request (M9
// fix 277): the requests in the conversation's agent files after the
// transcript's last own message, priced from the rates table. The
// status line is posted with the main thread's requests, so the agents'
// requests after its last one are the ones no status line has counted,
// and the next own request moves the cut past them. Read through the
// same set and parse cache as readUsage, and cached by the set's stamp,
// so the sidebar's beat costs a stat per file. Null when no transcript
// names the id; a conversation whose agents are all counted answers
// zero requests, not null, so the renderer can tell the two apart.
const runningCache = new Map<string, { stamp: string; running: AgentsRunning }>();

export async function readAgentsRunning(conversation: string, log: HistoryLog): Promise<AgentsRunning | null> {
  const file = await findTranscript(conversation, log);
  if (file === null) return null;
  const set = await conversationFiles(file, log);
  if (set === null) {
    transcriptPaths.delete(conversation);
    runningCache.delete(conversation);
    return null;
  }
  const have = runningCache.get(conversation);
  if (have !== undefined && have.stamp === set.stamp) return have.running;
  const own = await parseUsage(set.files[0]!, log);
  const since = own.length === 0 ? 0 : own[own.length - 1]!.at;
  const after: UsageMessage[] = [];
  // The model per agent (M9 fix 288): the last request in the agent's
  // file that names one, over the whole file, since a member's model
  // does not change with the running cut. An agent with no usage line
  // yet has no entry.
  const models: Record<string, string> = {};
  // And the price per agent (M9 fix 372), every request in the agent's
  // file at the rates table, whatever the running cut: the lid's box
  // says what each member has cost so far, a breakdown of the
  // session's own figure and never a second total.
  const whole: UsageMessage[] = [];
  // And the latest words per agent (M9 fix 903), off the same parse, for
  // the card's now line; keyed by the file's agent id, which is the
  // member's id.
  const said: Record<string, { text: string; at: number }> = {};
  for (const f of set.files.slice(1)) {
    const messages = await parseUsage(f, log);
    for (const m of messages) {
      if (m.at > since) after.push(m);
      if (m.agentId !== null && m.model !== null) models[m.agentId] = m.model;
      whole.push(m);
    }
    const heard = usageCache.get(f.path)?.said;
    if (f.agentId !== null && heard !== undefined && heard.text !== null && heard.at !== null) said[f.agentId] = { text: heard.text, at: heard.at };
  }
  const spend: Record<string, number> = {};
  for (const a of sliceUsage(whole, -Infinity, Infinity)?.agents ?? []) if (a.usd !== null) spend[a.id] = a.usd;
  const usage = sliceUsage(after, -Infinity, Infinity);
  const running: AgentsRunning =
    usage === null
      ? { since, usd: null, tokens: { up: 0, down: 0, cached: 0 }, requests: 0, agents: 0, models, spend, said }
      : { since, usd: usage.usd, tokens: { up: tokensUp(usage.tokens), down: usage.tokens.output, cached: usage.tokens.cacheRead }, requests: usage.requests, agents: usage.agents.length, models, spend, said };
  runningCache.set(conversation, { stamp: set.stamp, running });
  return running;
}

async function findTranscript(conversation: string, log: HistoryLog): Promise<string | null> {
  const known = transcriptPaths.get(conversation);
  if (known !== undefined) {
    try {
      await fs.promises.access(known);
      return known;
    } catch {
      transcriptPaths.delete(conversation);
    }
  }
  if (!isSessionId(conversation)) return null;
  const projects = path.join(claudeHome(), 'projects');
  let dirs: fs.Dirent[];
  try {
    dirs = await fs.promises.readdir(projects, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not list ${projects}: ${String(err)}`);
    return null;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const file = path.join(projects, dir.name, `${conversation}.jsonl`);
    try {
      await fs.promises.access(file);
      transcriptPaths.set(conversation, file);
      return file;
    } catch {
      // Not in this project's folder.
    }
  }
  return null;
}

async function listAgentTranscripts(dir: string, log: HistoryLog): Promise<string[]> {
  try {
    const names = await fs.promises.readdir(dir);
    return names.filter((n) => /^agent-.+\.jsonl$/.test(n)).sort().map((n) => path.join(dir, n));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not list ${dir}: ${String(err)}`);
    return [];
  }
}
