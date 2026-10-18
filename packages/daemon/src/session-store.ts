import fs from 'node:fs';
import path from 'node:path';
import { encodeProjectDir, folderName, isSessionColor, isSessionId, isSessionPhase, isShellId, pickSessionColor, readTask } from '@emerald/shared';
import { claudeHome } from '@emerald/shared/claude-home';
import type { ContextWindow, KeptScreen, SessionCommit, SessionCommitAgent, SessionConversation, SessionInfo, SessionKind, SessionPhase, SessionSpan, SessionTask, SessionTokens, SessionTouched, ShellId } from '@emerald/shared';
import type { Logger } from './log.ts';
import { readFileRetried, setAsideBadFile, writeFileAtomic } from './store-file.ts';

// What survives a daemon restart about a session. PTYs cannot be carried
// across processes, so this is the identity and the exit, enough to list the
// session as exited, keep its pane and sidebar row, and resume it later
// (claude --resume needs claudeSessionId and the cwd).
export interface PersistedSession {
  id: string;
  kind: SessionKind;
  name: string;
  autoName: boolean;
  spawnCwd: string;
  args: string[];
  // The shell a plain shell session ran (M9 fix 624), so a resume after a
  // restart starts the same one; null for a Claude and for a file from
  // before the field.
  shell: ShellId | null;
  cwd: string;
  groupCwd: string;
  claudeSessionId: string | null;
  // The claude.ai session the conversation belongs to (M58), for the
  // Commits tab's trailer mapping after a restart.
  remoteSessionId: string | null;
  // HEAD in the start folder at spawn (M9 fix 117), for the Commits
  // graph's start dot after a restart.
  startHead: string | null;
  // The last conversation hosted, so a resume after a daemon restart still
  // knows the folder and the id (M48).
  conversation: SessionConversation | null;
  // The transcript the chat face draws (M9 fix 804), so an exited Claude still shows its conversation after a daemon restart.
  transcriptPath: string | null;
  // The conversations hosted (M9 fix 185), so the graph's block per
  // span outlives a restart as the commits do.
  spans: SessionSpan[];
  // The commits the session made (M49), so its lane on the Commits tab
  // outlives a daemon restart; with the time of each claim since M58.
  commits: SessionCommit[];
  // The files the session wrote (M9 fix 198), so a resumed session keeps
  // its marks in the files rail.
  touched: SessionTouched[];
  // The last turn, so an exited Claude session still says what it was about.
  lastPrompt: string | null;
  lastReply: string | null;
  // When they landed (M73), for the turn card.
  lastPromptAt: number | null;
  lastReplyAt: number | null;
  // From the last status line, so an exited session still says what it ran.
  model: string | null;
  contextPercent: number | null;
  contextWindow: ContextWindow | null;
  tokens: SessionTokens | null;
  // Claude Code's own dollars so far (M9 fix 154), kept with the sum.
  costUsd: number | null;
  // Claude's task list (M9 fix 153), so an exited session still says how
  // far it got and a resume carries on with the same list.
  tasks: SessionTask[];
  // The screen the emulator held when the PTY ended or the daemon stopped
  // (M9 fix 159), so the pane shows what the session was doing until it
  // is resumed. Null for a session the previous daemon never saw end.
  lastScreen: KeptScreen | null;
  // The checkpoint, so it outlives a daemon restart like the name does.
  comment: string | null;
  phase: SessionPhase | null;
  // The colour, so a session keeps it across a daemon restart. Always set
  // once loaded: an entry from a file older than M24 is given one.
  color: string;
  // The session's own colour scheme (M9 fix 244), null for the window's.
  scheme: string | null;
  // The keep-whole mark (M9 fix 773), so it outlives a restart and a resume.
  keepWhole: boolean;
  createdAt: number;
  // Both null while the session is live. A session that was still live when
  // the daemon died loads with both null: nobody saw it exit.
  exitCode: number | null;
  exitedAt: number | null;
  // When the session was removed from the list (M57); null while listed.
  // A removed record stays in the file so the activity timeline and the
  // Commits tab still know the session, up to REMOVED_KEPT of them.
  removedAt: number | null;
}

// How many removed records the file keeps, the oldest removed dropped
// beyond it, so the file cannot grow without end.
export const REMOVED_KEPT = 500;

interface SessionsFile {
  version: 1;
  sessions: PersistedSession[];
}

// The fields are picked by name, so what the file does not keep (the
// team, the live lines, the load sampler's ring and names, M9 fix 300)
// is dropped here without a word.
export function toPersisted(info: SessionInfo, lastScreen: KeptScreen | null = null): PersistedSession {
  const exited = info.state === 'exited';
  return {
    id: info.id,
    kind: info.kind,
    name: info.name,
    autoName: info.autoName,
    spawnCwd: info.spawnCwd,
    args: [...info.args],
    shell: info.shell ?? null,
    cwd: info.cwd,
    groupCwd: info.groupCwd,
    claudeSessionId: info.claudeSessionId,
    remoteSessionId: info.remoteSessionId,
    startHead: info.startHead,
    conversation: info.conversation === null ? null : { ...info.conversation, args: [...info.conversation.args] },
    transcriptPath: info.transcriptPath ?? null,
    spans: (info.spans ?? []).map((c) => ({ ...c })),
    commits: info.commits.map((c) => ({ ...c })),
    touched: (info.touched ?? []).map((t) => ({ ...t })),
    lastPrompt: info.lastPrompt,
    lastReply: info.lastReply,
    lastPromptAt: info.lastPromptAt ?? null,
    lastReplyAt: info.lastReplyAt ?? null,
    model: info.model,
    contextPercent: info.contextPercent,
    contextWindow: info.contextWindow,
    tokens: info.tokens,
    costUsd: info.costUsd ?? null,
    tasks: (info.tasks ?? []).map((task) => ({ ...task })),
    lastScreen: lastScreen === null ? null : { rows: [...lastScreen.rows], cursor: { ...lastScreen.cursor } },
    comment: info.comment,
    phase: info.phase,
    // A daemon always has a colour on its own records; the null is for the
    // renderer's benefit and never reaches this file.
    color: info.color ?? pickSessionColor([]),
    scheme: info.scheme ?? null,
    keepWhole: info.keepWhole === true,
    createdAt: info.createdAt,
    exitCode: exited ? (info.exitCode ?? null) : null,
    // stateSince is when the state became exited.
    exitedAt: exited ? info.stateSince : null,
    removedAt: info.removedAt ?? null,
  };
}

// ~/.emerald/sessions.json: the whole session list, rewritten on every change.
// A synchronous temp file, flush and rename (store-file.ts) keeps it
// crash-safe without a queue.
export class SessionStore {
  private readonly filePath: string;
  private readonly log: Logger;

  constructor(filePath: string, log: Logger) {
    this.filePath = filePath;
    this.log = log;
  }

  // A missing file is the first run. A corrupt file is set aside (M9 fix
  // 457) and the daemon starts with no list rather than staying down; bad
  // entries inside a good file are skipped.
  load(): PersistedSession[] {
    let raw: string;
    try {
      raw = readFileRetried(this.filePath, this.log);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn('could not read sessions file', err);
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.log.warn(`sessions file ${this.filePath} is not JSON, starting with no sessions`, err);
      setAsideBadFile(this.filePath, this.log);
      return [];
    }
    if (!isRecord(parsed) || parsed['version'] !== 1 || !Array.isArray(parsed['sessions'])) {
      this.log.warn(`sessions file ${this.filePath} has an unknown shape, starting with no sessions`);
      setAsideBadFile(this.filePath, this.log);
      return [];
    }
    const out: PersistedSession[] = [];
    const seen = new Set<string>();
    // The colours the file already holds, so an entry from before M24 is
    // not given one that a later entry in the same file keeps.
    const taken: string[] = parsed['sessions'].map((e: unknown) => (isRecord(e) ? e['color'] : undefined)).filter(isSessionColor);
    for (const entry of parsed['sessions']) {
      const s = validateEntry(entry, taken);
      if (s !== null) taken.push(s.color);
      if (s === null || seen.has(s.id)) {
        this.log.warn('skipping unusable sessions file entry', entry);
        continue;
      }
      seen.add(s.id);
      out.push(s);
    }
    return out;
  }

  // The removed records go after the listed ones, oldest removed first,
  // and only the newest REMOVED_KEPT of them are written. The kept
  // screens (M9 fix 159) ride beside the infos, by session id, since
  // they are the record's and not the info's.
  save(sessions: Iterable<SessionInfo>, screens: ReadonlyMap<string, KeptScreen> = new Map()): void {
    const all = [...sessions].map((info) => toPersisted(info, screens.get(info.id) ?? null));
    const listed = all.filter((s) => s.removedAt === null);
    const removed = all.filter((s) => s.removedAt !== null).sort((a, b) => a.removedAt! - b.removedAt!).slice(-REMOVED_KEPT);
    const file: SessionsFile = { version: 1, sessions: [...listed, ...removed] };
    try {
      writeFileAtomic(this.filePath, JSON.stringify(file, null, 2) + '\n', this.log);
    } catch (err) {
      // The live registry is still right; only the next restart loses out.
      this.log.error('could not persist sessions', err);
    }
  }
}

// `taken` is the colours of the entries already loaded, so a file older
// than M24 gets its sessions coloured apart from each other.
function validateEntry(value: unknown, taken: string[]): PersistedSession | null {
  if (!isRecord(value)) return null;
  const { id, kind, name, spawnCwd, cwd, claudeSessionId, createdAt, exitCode, exitedAt } = value;
  if (typeof id !== 'string' || id === '') return null;
  if (kind !== 'claude' && kind !== 'shell') return null;
  if (typeof name !== 'string' || typeof spawnCwd !== 'string' || typeof cwd !== 'string') return null;
  // Files written before M9 fix 60 have no group folder: the live one.
  const groupCwd = value['groupCwd'] === undefined ? cwd : value['groupCwd'];
  if (typeof groupCwd !== 'string') return null;
  // Files written before M8 have no args: those sessions were started with none.
  const args = value['args'] === undefined ? [] : value['args'];
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return null;
  // Files written before M9 fix 624 have no shell; a value of the wrong
  // shape reads as none, the default, rather than dropping the session.
  const shell = isShellId(value['shell']) ? value['shell'] : null;
  // Files written before M9 do not say whether the name was chosen; a name
  // that is still the spawn folder's was not.
  const autoName = value['autoName'] === undefined ? name === folderName(spawnCwd) : value['autoName'];
  if (typeof autoName !== 'boolean') return null;
  if (claudeSessionId !== null && typeof claudeSessionId !== 'string') return null;
  // Files written before M58 have no remote session; a value of the wrong
  // shape reads as none rather than dropping the session over decoration.
  const remoteSessionId = typeof value['remoteSessionId'] === 'string' ? value['remoteSessionId'] : null;
  // Files written before M9 fix 117 have no start commit.
  const startHead = typeof value['startHead'] === 'string' ? value['startHead'] : null;
  // Files written before M48 have no conversation: a bound id was one, in
  // the folder a resume used to go to (spawnCwd for a Claude session, the
  // live folder for a shell that ran claude). A value of the wrong shape
  // reads as none rather than dropping the session.
  const conversation =
    value['conversation'] === undefined
      ? claudeSessionId === null
        ? null
        : { id: claudeSessionId, cwd: kind === 'claude' ? spawnCwd : cwd, args: kind === 'claude' ? [...args] : [] }
      : readConversation(value['conversation']);
  // Files written before M9 fix 804 have no transcript path: a listed one
  // finds it where Claude Code keeps it, from the id and folder a resume
  // would use, when the file is there. A removed one derives nothing; it
  // draws no face, and up to REMOVED_KEPT of them would each cost a stat.
  const transcriptPath =
    value['transcriptPath'] !== undefined
      ? textOrNull(value['transcriptPath'])
      : (value['removedAt'] ?? null) === null
        ? derivedTranscript(conversation, claudeSessionId, spawnCwd)
        : null;
  // Files written before M49 have no commits; a value of the wrong shape
  // reads as none rather than dropping the session over decoration.
  const commits = readCommits(value['commits']);
  // Files written before M9 fix 185 have no spans and read as an empty
  // list; the reducer's fallback (spansOf) is for a record that never
  // came through here, the spawn's own.
  const spans = readSpans(value['spans']);
  // Files written before M9 fix 198 have no touched files; an entry of
  // the wrong shape is skipped rather than dropping the session.
  const touched = readTouched(value['touched']);
  // Files written before M9 fix 8 have no last turn, before M73 no times
  // on it, before M16 no status line fields. Each is decoration, so one
  // of the wrong type reads as none (M9 fix 458) rather than dropping the
  // record, which the next save would then erase for good.
  const lastPrompt = textOrNull(value['lastPrompt']);
  const lastReply = textOrNull(value['lastReply']);
  const lastPromptAt = numberOrNull(value['lastPromptAt']);
  const lastReplyAt = numberOrNull(value['lastReplyAt']);
  const model = textOrNull(value['model']);
  const contextPercent = numberOrNull(value['contextPercent']);
  // Files written before M42 have no token counts; a value of the wrong
  // shape reads as none rather than dropping the session over decoration.
  const contextWindow = readContextWindow(value['contextWindow']);
  // Files written before M9 fix 143 have no running sum.
  const tokens = readTokens(value['tokens']);
  // Files written before M9 fix 154 have no cost; a value of the wrong
  // shape reads as none.
  const costUsd = typeof value['costUsd'] === 'number' && Number.isFinite(value['costUsd']) ? value['costUsd'] : null;
  // Files written before M9 fix 153 have no task list; an entry of the
  // wrong shape is skipped rather than dropping the session.
  const tasks = Array.isArray(value['tasks']) ? value['tasks'].map((v) => readTask(v)).filter((task): task is SessionTask => task !== null) : [];
  // Files written before M9 fix 159 have no kept screen; one of the wrong
  // shape reads as none.
  const lastScreen = readKeptScreen(value['lastScreen']);
  // Files written before M18 have no checkpoint; one of the wrong shape
  // reads as none (M9 fix 458).
  const comment = textOrNull(value['comment']);
  const phase = isSessionPhase(value['phase']) ? value['phase'] : null;
  // Files written before M24 have no colour; a value of the wrong shape
  // is replaced rather than dropping the session over decoration.
  const color = isSessionColor(value['color']) ? value['color'] : pickSessionColor(taken);
  // Files written before M9 fix 244 have no scheme; a value of the wrong
  // shape reads as none, the window's pick.
  const scheme = typeof value['scheme'] === 'string' && value['scheme'] !== '' ? value['scheme'] : null;
  // Files written before M9 fix 773 have no mark; anything but true reads
  // as not marked.
  const keepWhole = value['keepWhole'] === true;
  // Files written by a daemon whose pty gave no exit code (M9 fix 831) have
  // no key, and a value of the wrong shape reads as unknown too, rather than
  // dropping the session over it.
  const exitCodeRead = typeof exitCode === 'number' ? exitCode : null;
  if (typeof createdAt !== 'number') return null;
  if (exitedAt !== null && typeof exitedAt !== 'number') return null;
  // Files written before M57 have no removed records.
  const removedAt = value['removedAt'] ?? null;
  if (removedAt !== null && typeof removedAt !== 'number') return null;
  return { id, kind, name, autoName, spawnCwd, args, shell, cwd, groupCwd, claudeSessionId, remoteSessionId, startHead, conversation, transcriptPath, spans, commits, touched, lastPrompt, lastReply, lastPromptAt, lastReplyAt, model, contextPercent, contextWindow, tokens, costUsd, tasks, lastScreen, comment, phase, color, scheme, keepWhole, createdAt, exitCode: exitCodeRead, exitedAt, removedAt };
}

// The transcript of the conversation resumePlan would resume (the first of
// the conversation's id and the bound id that is a session id, in the
// conversation's folder, else the spawn folder), when Claude Code has it.
function derivedTranscript(conversation: SessionConversation | null, claudeSessionId: string | null, spawnCwd: string): string | null {
  const id = [conversation?.id, claudeSessionId].find(isSessionId);
  if (id === undefined) return null;
  const cwd = conversation?.cwd ?? spawnCwd;
  const file = path.join(claudeHome(), 'projects', encodeProjectDir(cwd), id + '.jsonl');
  return fs.existsSync(file) ? file : null;
}

function textOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function readSpans(v: unknown): SessionSpan[] {
  if (!Array.isArray(v)) return [];
  const out: SessionSpan[] = [];
  for (const item of v) {
    if (!isRecord(item) || typeof item['conversation'] !== 'string' || typeof item['startedAt'] !== 'number') continue;
    const endedAt = item['endedAt'] ?? null;
    if (endedAt !== null && typeof endedAt !== 'number') continue;
    out.push({
      conversation: item['conversation'],
      remoteSessionId: typeof item['remoteSessionId'] === 'string' ? item['remoteSessionId'] : null,
      startedAt: item['startedAt'],
      endedAt,
      startHead: typeof item['startHead'] === 'string' ? item['startHead'] : null,
    });
  }
  return out;
}

function readKeptScreen(v: unknown): KeptScreen | null {
  if (!isRecord(v) || !Array.isArray(v['rows']) || !v['rows'].every((r) => typeof r === 'string')) return null;
  const cursor = v['cursor'];
  if (!isRecord(cursor) || typeof cursor['x'] !== 'number' || typeof cursor['y'] !== 'number') return null;
  return { rows: [...(v['rows'] as string[])], cursor: { x: cursor['x'], y: cursor['y'] } };
}

function readConversation(v: unknown): SessionConversation | null {
  if (!isRecord(v)) return null;
  const { id, cwd, args } = v;
  if (typeof id !== 'string' || id === '' || typeof cwd !== 'string' || cwd === '') return null;
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return null;
  return { id, cwd, args: [...args] };
}

// Full hashes only; anything else is dropped, entry by entry. A file
// written before M58 holds bare hashes: those are read with a time of
// zero, so any later claim on the same hash wins over them.
function readCommits(v: unknown): SessionCommit[] {
  if (!Array.isArray(v)) return [];
  const out: SessionCommit[] = [];
  for (const entry of v) {
    if (typeof entry === 'string' && isHash(entry)) out.push({ hash: entry, at: 0 });
    else if (isRecord(entry) && typeof entry['hash'] === 'string' && isHash(entry['hash']) && typeof entry['at'] === 'number') {
      const agent = readCommitAgent(entry['agent']);
      out.push(agent === null ? { hash: entry['hash'], at: entry['at'] } : { hash: entry['hash'], at: entry['at'], agent });
    }
  }
  return out;
}

// A touched file (M9 fix 198): a path and a time, the agent id when a
// member wrote it; an entry of the wrong shape is skipped.
function readTouched(v: unknown): SessionTouched[] {
  if (!Array.isArray(v)) return [];
  const out: SessionTouched[] = [];
  for (const entry of v) {
    if (!isRecord(entry) || typeof entry['path'] !== 'string' || entry['path'] === '' || typeof entry['at'] !== 'number') continue;
    out.push({ path: entry['path'], at: entry['at'], agentId: typeof entry['agentId'] === 'string' && entry['agentId'] !== '' ? entry['agentId'] : null });
  }
  return out;
}

// The agent on a folded commit (M9 fix 138); one of the wrong shape is
// dropped and the commit read as the session's own.
function readCommitAgent(v: unknown): SessionCommitAgent | null {
  if (!isRecord(v) || typeof v['id'] !== 'string' || v['id'] === '') return null;
  const text = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
  return { id: v['id'], branch: text(v['branch']), type: text(v['type']), description: text(v['description']) };
}

function isHash(s: string): boolean {
  return /^[0-9a-f]{40}$/.test(s);
}

const CONTEXT_WINDOW_KEYS = ['size', 'used', 'cacheRead', 'cacheWrite', 'fresh', 'output'] as const;

function readContextWindow(v: unknown): ContextWindow | null {
  if (!isRecord(v)) return null;
  const out: Partial<ContextWindow> = {};
  for (const k of CONTEXT_WINDOW_KEYS) {
    const n = v[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[k] = n;
  }
  return out as ContextWindow;
}

const TOKENS_KEYS = ['fresh', 'cacheWrite', 'cacheRead', 'output'] as const;

function readTokens(v: unknown): SessionTokens | null {
  if (!isRecord(v)) return null;
  const out: Partial<SessionTokens> = {};
  for (const k of TOKENS_KEYS) {
    const n = v[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    out[k] = n;
  }
  return out as SessionTokens;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
