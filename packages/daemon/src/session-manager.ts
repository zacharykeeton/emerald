import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HEAD_TOOLS, Limits, MOD_APPEND, MOD_TOOL_RUNNING, appendTouched, autoNameFor, classifyHook, commandDir, folderName, initialState, isForeignHook, isKnownAgent, isSessionId, namesUnknownTask, pickSessionColor, pushSample, reduce, staleThresholdMs, toolPhrase, touchedPath } from '@emerald/shared';
import type { HookOutcome, HookPayload, KeptScreen, ModRow, LoadSample, UsageLimit, SessionInfo, SessionKind, SessionPhase, SessionTask, ShellId, ShellOption, TeamMember } from '@emerald/shared';
import type { HookResult } from './hook-sink.ts';
import { RequestError } from './errors.ts';
import { findGitDir, onReftableBranch, readBranch, repoKey } from './git-branch.ts';
import { listFirstParent, movesHead, readHead, readHeadFile, readMerges, readsOnly, revListFirstParent } from './git-head.ts';
import { readRemoteSessionId } from './transcript-head.ts';
import { readTaskFiles } from './task-files.ts';
import { realFolder, sameFolder } from './real-folder.ts';
import { CwdScanner } from './osc-cwd.ts';
import { MarkScanner } from './osc-marks.ts';
import { TitleScanner } from './osc-title.ts';
import { SpinnerScanner } from './spinner-word.ts';
import { PtySession, stampEnv } from './pty-session.ts';
import { TranscriptTail } from './transcript-tail.ts';
import { ClaudeLauncher } from './launchers/claude.ts';
import { BASH_RC, ShellLauncher } from './launchers/shell.ts';
import { findShells } from './shells.ts';
import type { SessionLauncher } from './launchers/types.ts';
import type { Logger } from './log.ts';
import { toPersisted } from './session-store.ts';
import { writeFileAtomic } from './store-file.ts';
import type { PersistedSession, SessionStore } from './session-store.ts';
import { LoadSampler } from './load-sampler.ts';
import type { SweepMethod, TreeReading } from './load-sampler.ts';

// One load tick (M9 fix 703), emitted as 'load' once per tick in place of
// a 'changed' per session: the samples in the sessions.load push's shape,
// and the updated records in the same order for a window too old for it.
export interface LoadTick {
  at: number;
  samples: Array<{ sessionId: string; sample: LoadSample; names: string[] }>;
  sessions: SessionInfo[];
}

export interface SpawnRequest {
  kind: SessionKind;
  cwd: string;
  name?: string;
  args?: string[];
  // Which installed shell a kind shell runs (M9 fix 624); the first when
  // left out.
  shell?: ShellId;
  cols: number;
  rows: number;
}

export interface SessionRecord {
  info: SessionInfo;
  // null for a session restored from sessions.json: its PTY died with the
  // previous daemon, so there is nothing to write to and no scrollback.
  pty: PtySession | null;
  // Set by kill(id, true): the record goes when the PTY exit lands, which
  // node-pty reports about a second after the process ends.
  removeOnExit?: boolean;
  // Once the emerald mod has posted a spinner word for this pty (M9 fix
  // 738), the screen's scanner yields, since both reading one spinner would
  // race; a new pty clears it, so a resume without the mod reads the screen.
  spinnerFromMod?: boolean;
  // The transcript tail while a turn runs (M47), started and stopped by
  // syncTail as the state and the transcript path move.
  tail?: TranscriptTail | null;
  // Publishes the record's info to subscribers without a store write, at
  // most every titlePublishMs: the title and the live reply both move
  // about once a second while Claude works, and neither is persisted.
  publish?: () => void;
  // A line to type once the shell's prompt reports in (M48): a resumed
  // shell that hosted a conversation gets claude --resume there. Nulled
  // when it is written or when the timer gives up.
  typeAtPrompt?: { line: string; timer: NodeJS.Timeout } | null;
  // HEAD as read before a git-writing Bash call (M58), by the call's id,
  // so the read after it can credit exactly what the call added. A call
  // whose end never lands leaves its entry until the next prompt. at is
  // the PreToolUse's time (M9 fix 470), so the read after credits only
  // commits made since.
  heads?: Map<string, { dir: string; head: string | null; at: number }>;
  // Whether each of info.commits was claimed by a command naming a git
  // write (M9 fix 472): such a claim takes a hash from another record
  // whose claim came from an unnamed command spanning the commit. Not
  // persisted, so after a restart nothing is taken over.
  claimNamed?: Map<string, boolean>;
  // HEAD as read before a subagent's git-writing command (M61), by agent
  // id, so the commits it added are the range up to the HEAD read after.
  agentHeads?: Map<string, string>;
  // One up per hook of the agent's (M9 fix 311), so a head read spawned
  // for a call keeps its value only while no later hook has landed.
  agentHeadSeq?: Map<string, number>;
  // The frame the emulator held when the PTY ended or the daemon stopped
  // (M9 fix 159), persisted with the record and answered by pty.screen
  // while the PTY is gone; cleared by a resume, whose new PTY starts over.
  kept?: KeptScreen | null;
  // The PostToolUse times of the current turn (M9 fix 232), oldest
  // first, for the stall threshold: three times their median gap, so a
  // turn's own pace says how long a silence is too long. Cleared by the
  // next prompt; not persisted, since a restored session is exited.
  toolAt?: number[];
}

export interface SessionManagerOptions {
  // Where hooks should report. Absent means sessions are spawned hook-less,
  // which the hook script treats as "do nothing".
  hook?: { port: number; token: string };
  // The emerald mod's folder (M9 fix 725), put on a Claude's command line
  // with --plugin-dir; absent or null launches without it, as every test
  // that builds a manager does.
  claudeModDir?: string | null;
  staleAfterMs?: number;
  // How often the stale timer looks; 0 disables it (tests call checkStale).
  staleCheckIntervalMs?: number;
  // How long a shell command must run for its end to mark the row (M9
  // fix 196, Limits.shellDoneAfterMs); tests and the verify harness
  // shorten it.
  shellDoneAfterMs?: number;
  // Persists the session list on every change; absent in most tests.
  store?: SessionStore;
  // How long a change waits for the next before sessions.json is written
  // (M9 fix 459, Limits.saveCoalesceMs in the daemon); absent or 0 writes
  // at once, which is what the tests reading the file after a change get.
  saveDelayMs?: number;
  // How often the transcript tail polls (M47); tests shorten it.
  transcriptPollMs?: number;
  // How long a resumed shell is given to show a prompt before the line it
  // was to be handed is dropped (tests shorten it).
  resumeTypeTimeoutMs?: number;
  // Reads HEAD in a folder around a Bash tool call (M49); tests hand in
  // one that runs no git. Without it the files are read first and git
  // asked only when they do not say (M9 fix 195).
  readHead?: (cwd: string) => Promise<string | null>;
  // The same off the files alone (M9 fix 311), stored before the hook is
  // acked; tests hand in one, and with readHead alone the files say
  // nothing, so every read is the stub's.
  readHeadFile?: (cwd: string) => string | null;
  // Lists the first-parent commits between two hashes (M58); tests hand
  // in one that runs no git. since is the hold's time (M9 fix 470).
  revList?: (cwd: string, before: string | null, after: string, since: number | null) => Promise<string[]>;
  // Which of a claim's hashes are merges (M9 fix 218); tests hand in one
  // that runs no git, and one absent with no git runs is an empty set.
  readMerges?: (cwd: string, hashes: string[]) => Promise<Set<string>>;
  // Reads the claude.ai session id off a transcript's head (M58); tests
  // hand in one that reads no file.
  readRemoteSessionId?: (transcriptPath: string) => Promise<string | null>;
  // The commits a subagent's command added between two HEADs (M61), and
  // the branch its folder is on; tests hand in ones that run no git.
  listCommits?: (cwd: string, before: string, after: string) => Promise<string[]>;
  readBranch?: (cwd: string) => string | null;
  // Reads Claude's task list off its files (M9 fix 153); tests hand in
  // one that reads no file.
  readTasks?: (claudeSessionId: string) => Promise<SessionTask[]>;
  // The load sampler (M9 fix 300), started with the manager and stopped
  // with it; absent means no sampling, which is every test. The stub
  // path replays a file instead of sweeping the box (the verify script).
  load?: { tickMs: number; method: SweepMethod; stubPath: string | null; scriptPath: string | null };
  // The shells found at the daemon's start (M9 fix 624, findShells), the
  // first the default; absent means the manager finds them itself, which
  // is every test that does not hand in a list.
  shells?: ShellOption[];
  // Where Git Bash's rc is written before each Git Bash launch (M9 fix
  // 624, paths.ts bashrcPath); absent means a folder of its own under the
  // temp folder, made at the first such launch, so no test writes under a
  // home.
  bashrcPath?: string;
}

// Kept as its own class so a stack trace says where the error came from.
export class SessionError extends RequestError {}

// What the mod hands Claude Code as the skip of an idle compaction (M9 fix
// 773); the engine writes no notice for a skip, so the words land in the
// mod's own log and the daemon's answer alone.
export const KEEP_WHOLE_SKIP = 'kept whole while idle by emerald';

// The hook events after which the branch is read again. SessionEnd can put
// a shell's folder back where its prompt last was (M9 fix 74).
const BRANCH_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'CwdChanged', 'SessionEnd']);

// The hook events at which the transcript's head is read for the
// claude.ai session id (M58) while the session has none yet.
const REMOTE_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop']);
// How long after its last commit an exited or removed session keeps its
// colour out of the pool for new sessions (M68): the Commits graph draws
// a removed session's lane while its commits are in the shown log, and
// a day covers a sitting's worth of log at the panel's 200 entries.
const RESERVE_COLOR_MS = 24 * 60 * 60 * 1000;
// How many conversation ids the foreign SessionStart line remembers having
// told (M9 fix 734): a long-lived daemon meets a nested `claude -p` per run.
const FOREIGN_STARTS_TOLD_CAP = 256;

// Registry of live sessions. Emits 'changed' (SessionInfo) whenever a session's
// public info changes, 'exit' (SessionInfo) when its PTY exits and 'removed'
// (sessionId) when one is forgotten.
// All state transitions go through the shared reducer; this class only owns
// the PTYs and the clock.
export class SessionManager extends EventEmitter {
  private readonly sessions = new Map<string, SessionRecord>();
  // The sessions removed from the list (M57), kept so the activity
  // timeline and the Commits tab still know them: never listed by
  // default, never resumed, tailed or stale-checked, saved with the rest.
  private readonly removed = new Map<string, SessionInfo>();
  // The conversation ids whose ignored SessionStart has had its line in
  // emmerd.log (M9 fix 734), oldest first.
  private readonly foreignStartsTold = new Set<string>();
  // The rate limits last emitted (M9 fix 739), as JSON, so a measure that
  // moved only the context or the cost pushes nothing.
  private lastLimits: string | null = null;
  private readonly launchers: Record<SessionKind, SessionLauncher>;
  private readonly bashrcPath: string;
  private readonly log: Logger;
  private readonly opts: SessionManagerOptions;
  private readonly staleAfterMs: number;
  private readonly shellDoneAfterMs: number;
  private readonly staleTimer: NodeJS.Timeout | null;
  private readonly load: LoadSampler | null;
  // The coalesced save (M9 fix 459): the timer while a save is pending,
  // and whether close() has run, after which every save is written at once
  // (the kills of a stop land after it, and the exit follows).
  private saveTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly offReftable: () => void;
  private readonly shells: ShellOption[];

  constructor(log: Logger, opts: SessionManagerOptions = {}) {
    super();
    this.log = log;
    this.opts = opts;
    this.shells = opts.shells ?? findShells();
    this.bashrcPath = opts.bashrcPath ?? path.join(os.tmpdir(), `emerald-bashrc-${process.pid}-${randomUUID().slice(0, 8)}`, 'emerald.bashrc');
    this.launchers = { claude: new ClaudeLauncher({ modDir: opts.claudeModDir ?? null }), shell: new ShellLauncher({ bashrcPath: this.bashrcPath }) };
    this.staleAfterMs = opts.staleAfterMs ?? Limits.staleAfterMs;
    this.shellDoneAfterMs = opts.shellDoneAfterMs ?? Limits.shellDoneAfterMs;
    const interval = opts.staleCheckIntervalMs ?? 30_000;
    this.staleTimer = interval > 0 ? setInterval(() => this.checkStale(Date.now()), interval) : null;
    // The timer must not keep a daemon alive that is otherwise shutting down.
    this.staleTimer?.unref();
    // A reftable repository's branch arrives from git after the read that
    // asked for it (M9 fix 558), so every session in that gitdir takes it
    // when it lands.
    this.offReftable = onReftableBranch((gitDir) => {
      for (const rec of this.sessions.values()) if (findGitDir(rec.info.cwd) === gitDir) this.refreshBranch(rec);
    });
    this.load =
      opts.load === undefined
        ? null
        : new LoadSampler({
            log,
            tickMs: opts.load.tickMs,
            method: opts.load.method,
            stubPath: opts.load.stubPath,
            scriptPath: opts.load.scriptPath,
            // A session with no pty, or one whose pty has exited, samples
            // nothing; its ring stays as it was.
            targets: () => [...this.sessions.values()].filter((r) => r.pty !== null && r.info.state !== 'exited').map((r) => ({ id: r.info.id, name: r.info.name, pid: r.pty!.pid })),
            onTick: (readings) => this.applyLoad(readings),
          });
    this.load?.start();
  }

  // One tick's readings onto the records (M9 fix 300): each session that
  // got one has the sample pushed onto its ring and its names replaced,
  // with no store write, since neither field is persisted. The tick is
  // published once as 'load' (M9 fix 703), never a 'changed' per session:
  // fifty records a tick were 400 KB and 443 ms of renderer at fifty
  // sessions. Public so session-manager.test.ts can drive a tick without
  // a sampler.
  applyLoad(readings: Map<string, TreeReading>): void {
    const samples: LoadTick['samples'] = [];
    const sessions: SessionInfo[] = [];
    for (const [id, reading] of readings) {
      const rec = this.sessions.get(id);
      if (rec === undefined) continue;
      rec.info = { ...rec.info, load: pushSample(rec.info.load, reading.sample), loadNames: reading.names };
      samples.push({ sessionId: id, sample: reading.sample, names: reading.names });
      sessions.push({ ...rec.info });
    }
    if (samples.length > 0) this.emit('load', { at: Date.now(), samples, sessions } satisfies LoadTick);
  }

  // The shells a kind shell can run on this box (M9 fix 624), the first
  // the default, as the hello reports them.
  installedShells(): ShellOption[] {
    return this.shells.map((o) => ({ ...o }));
  }

  // The shell a spawn asked for, among the installed ones; none asked is
  // the default.
  private pickShell(id: ShellId | undefined): ShellOption {
    const first = this.shells[0]!;
    if (id === undefined) return first;
    const found = this.shells.find((o) => o.id === id);
    if (found === undefined) {
      throw new SessionError('bad-request', `shell ${id} is not installed on this box; installed: ${this.shells.map((o) => o.id).join(', ')}`);
    }
    return found;
  }

  // The listed sessions; with removed, the removed ones after them, each
  // carrying its removedAt (M57).
  list(opts: { removed?: boolean } = {}): SessionInfo[] {
    const live = [...this.sessions.values()].map((r) => ({ ...r.info }));
    return opts.removed ? [...live, ...[...this.removed.values()].map((s) => ({ ...s }))] : live;
  }

  // Loads the previous daemon's sessions as exited. Their PTYs are gone, but
  // keeping the ids means panes and sidebar rows still point at something
  // with a name, and a resume can bring them back in place.
  restore(): void {
    const store = this.opts.store;
    if (store === undefined) return;
    const now = Date.now();
    let count = 0;
    for (const p of store.load()) {
      if (this.sessions.has(p.id) || this.removed.has(p.id)) continue;
      if (p.removedAt !== null) {
        this.removed.set(p.id, restoredInfo(p, now));
        continue;
      }
      this.sessions.set(p.id, { info: restoredInfo(p, now), pty: null, kept: p.lastScreen });
      count++;
    }
    if (count > 0) this.log.info('sessions restored as exited', { count });
  }

  get(sessionId: string): SessionRecord {
    const rec = this.sessions.get(sessionId);
    if (rec === undefined) throw new SessionError('not-found', `no session ${sessionId}`);
    return rec;
  }

  spawn(req: SpawnRequest): SessionInfo {
    checkDirectory(req.cwd);
    // One spelling per folder (M9 fix 108): a shell spawned at the 8.3
    // form os.tmpdir() gives and a Claude reporting the long form of the
    // same folder sat under two headings, since the heading compares
    // the strings. The folder the session is placed in and grouped under
    // goes through realFolder, here, at a resume, at a restore and on
    // every report, and so does spawnCwd (M9 fix 711): no reader wants
    // the request's own spelling, and an 8.3 spawn folder read as away
    // from home in the rail's graph.
    const cwd = realFolder(req.cwd);

    const shell = req.kind === 'shell' ? this.pickShell(req.shell) : null;
    const id = randomUUID();
    const now = Date.now();
    const pty = this.launch(id, req.kind, req.args ?? [], req.cwd, req.cols, req.rows, shell);

    const given = req.name?.trim() ?? '';
    const info: SessionInfo = {
      id,
      kind: req.kind,
      name: given || folderName(req.cwd) || req.cwd,
      autoName: given === '',
      spawnCwd: cwd,
      args: [...(req.args ?? [])],
      shell: shell?.id ?? null,
      cwd,
      groupCwd: cwd,
      branch: readBranch(cwd),
      lastPrompt: null,
      lastReply: null,
      lastPromptAt: null,
      lastReplyAt: null,
      state: initialState(req.kind),
      stateSince: now,
      lastEventAt: null,
      stale: false,
      needsInputReason: null,
      askedFor: null,
      errorType: null,
      waitingOn: [],
      team: [],
      model: null,
      contextPercent: null,
      contextWindow: null,
      tokens: null,
      costUsd: null,
      tasks: [],
      comment: null,
      phase: null,
      color: pickSessionColor(this.takenColors(now), this.peerColors(cwd)),
      scheme: null,
      title: null,
      transcriptPath: null,
      liveReply: null,
      liveTool: null,
      liveVerb: null,
      claudeSessionId: null,
      remoteSessionId: null,
      startHead: null,
      conversation: null,
      commits: [],
      shellCwd: null,
      command: null,
      pid: pty.pid,
      exitCode: null,
      createdAt: now,
    };
    const rec: SessionRecord = { info, pty, tail: null };
    this.sessions.set(id, rec);
    this.log.info('session spawned', { id, kind: req.kind, pid: pty.pid, cwd: req.cwd, args: info.args, shell: info.shell });
    // Subscribers learn about new sessions the same way they learn about
    // state changes, so a renderer's session list never needs re-fetching.
    this.changed(rec);
    this.watch(rec, pty);
    void this.recordStartHead(rec);
    return { ...info };
  }

  // The commit the session started on (M9 fix 117): HEAD in the start
  // folder, read once after the spawn; git answers in a moment, so the
  // record is patched and pushed rather than making the spawn wait. A
  // record that was resumed or removed meanwhile is left alone. Read
  // again from the folder Claude started in when that is another one
  // (M9 fix 148), so a shell opened here that ran claude in a second
  // repository starts on a commit of that repository, not this one's.
  private async recordStartHead(rec: SessionRecord, dir: string = rec.info.spawnCwd): Promise<void> {
    const pid = rec.info.pid;
    const head = await this.readHead(dir);
    if (head === null || this.sessions.get(rec.info.id) !== rec || rec.info.pid !== pid) return;
    rec.info = { ...rec.info, startHead: head };
    // The open span's start is the same read (M9 fix 185) when it has
    // none yet: one opened by the move that re-read, or the first span
    // when the spawn's read lands after its SessionStart (M9 fix 378
    // reads the first span on its own; a read this late is the same
    // folder within a moment).
    this.fillSpanHead(rec, head);
    this.changed(rec);
  }

  // The open conversation span's start commit (M9 fix 185), set once;
  // a null (the spawn's read still out, or no repository) leaves it for
  // the read to fill.
  private fillSpanHead(rec: SessionRecord, head: string | null): boolean {
    const spans = rec.info.spans ?? [];
    const last = spans.at(-1);
    if (head === null || last === undefined || last.startHead !== null) return false;
    rec.info = { ...rec.info, spans: [...spans.slice(0, -1), { ...last, startHead: head }] };
    return true;
  }

  // HEAD in the group folder when a conversation span opened (M9 fix
  // 185), kept on the span while it is still the open one; a record
  // resumed or removed meanwhile is left alone, as recordStartHead is.
  private async recordSpanHead(rec: SessionRecord, dir: string): Promise<void> {
    const pid = rec.info.pid;
    const conversation = rec.info.spans?.at(-1)?.conversation;
    const head = await this.readHead(dir);
    if (head === null || this.sessions.get(rec.info.id) !== rec || rec.info.pid !== pid) return;
    const spans = rec.info.spans ?? [];
    const last = spans.at(-1);
    if (last === undefined || last.conversation !== conversation || last.startHead !== null) return;
    rec.info = { ...rec.info, spans: [...spans.slice(0, -1), { ...last, startHead: head }] };
    this.changed(rec);
  }

  // A new PTY under the old id, so the pane and the sidebar row stay put.
  // Clients attached to the old PTY hear nothing from the new one until
  // they attach again; the renderer does that when it sees the session
  // leave `exited`.
  resume(sessionId: string, cols: number, rows: number): SessionInfo {
    const rec = this.get(sessionId);
    if (rec.info.state !== 'exited') throw new SessionError('bad-request', `session ${sessionId} is still running`);
    this.stopTail(rec);
    const plan = resumePlan(rec.info);
    // The conversation's folder can be gone (a worktree removed since);
    // the spawn folder is the fallback, and checkDirectory says if that
    // is gone too.
    let cwd = plan.cwd;
    if (cwd !== rec.info.spawnCwd && !isDirectory(cwd)) {
      this.log.warn('conversation folder is gone, resuming in the spawn folder', { id: sessionId, cwd, spawnCwd: rec.info.spawnCwd });
      cwd = rec.info.spawnCwd;
    }
    checkDirectory(cwd);
    const { args } = plan;
    // The shell the record ran, while it is still installed (M9 fix 624);
    // a record from before the field, or one whose shell has gone since,
    // resumes in the default.
    let shell: ShellOption | null = null;
    if (rec.info.kind === 'shell') {
      const recorded = rec.info.shell ?? null;
      const found = recorded === null ? undefined : this.shells.find((o) => o.id === recorded);
      shell = found ?? this.shells[0]!;
      if (recorded !== null && found === undefined) {
        this.log.warn('shell is not installed now, resuming in the default', { id: sessionId, shell: recorded, default: shell.id });
      }
    }
    const pty = this.launch(sessionId, rec.info.kind, args, cwd, cols, rows, shell);
    const now = Date.now();
    rec.pty = pty;
    rec.spinnerFromMod = false;
    rec.kept = null;
    if (rec.typeAtPrompt) clearTimeout(rec.typeAtPrompt.timer);
    rec.typeAtPrompt = plan.typed === null ? null : { line: plan.typed, timer: this.typeTimer(rec, plan.typed) };
    rec.info = {
      ...rec.info,
      // Live facts start over; identity (id, name, spawnCwd, createdAt) stays,
      // and so does the last turn: a resumed Claude picks that conversation
      // up, in the folder it was started in (M48).
      cwd: realFolder(cwd),
      groupCwd: realFolder(cwd),
      branch: readBranch(cwd),
      shell: shell?.id ?? null,
      shellCwd: null,
      command: null,
      state: initialState(rec.info.kind),
      stateSince: now,
      lastEventAt: null,
      stale: false,
      needsInputReason: null,
      askedFor: null,
      errorType: null,
      waitingOn: [],
      team: [],
      // Unbound so the resumed process's first SessionStart rebinds. Claude
      // keeps the same id on --resume, so this normally lands the same value;
      // if Claude ever hands out a new one the session is not stuck foreign.
      claudeSessionId: null,
      // The old process's title went with it, and so did the model and the
      // context fill it reported (M9 fix 39): the new process says its own
      // once its status line runs, and a bare prompt says nothing.
      title: null,
      model: null,
      contextPercent: null,
      contextWindow: null,
      tokens: null,
      costUsd: null,
      // The new process reports its own transcript (M47).
      transcriptPath: null,
      liveReply: null,
      liveTool: null,
      liveVerb: null,
      pid: pty.pid,
      exitCode: null,
    };
    this.log.info('session resumed', { id: sessionId, kind: rec.info.kind, pid: pty.pid, cwd, args, typed: plan.typed });
    this.changed(rec);
    this.watch(rec, pty);
    return { ...rec.info };
  }

  // With remove, the session is forgotten as soon as it has exited: the
  // renderer's Close on a shell pane wants the row gone, not an exited
  // entry to clear later. A session that already exited is removed at once.
  kill(sessionId: string, remove = false): void {
    const rec = this.get(sessionId);
    if (remove && rec.info.state === 'exited') {
      this.remove(sessionId);
      return;
    }
    if (remove) rec.removeOnExit = true;
    rec.pty?.kill();
  }

  // Only exited sessions can be forgotten; a live one has to be killed first
  // so nothing keeps running unlisted. The record is kept, marked removed
  // (M57), so the day's timeline and the Commits tab still name the
  // session. Emits 'removed' (sessionId).
  // The colours a new session must avoid. The live sessions' first, and
  // then (M68) any exited or removed record whose lane is likely still on
  // a Commits graph: one with a commit in the last day. M59 freed an
  // exited session's colour at once (with a batch of worktree sessions
  // plus the user's own every colour was out and the neighbours met),
  // and the Commits graph then dashed the removed lane against the
  // session that took its colour; M68 took the dash out, so a lane still
  // drawn keeps its colour out of the pool instead, and once the whole
  // palette is out the pick repeats the most isolated colour as before.
  private takenColors(now: number): Array<string | null> {
    const recent = (info: SessionInfo) => info.commits.some((c) => now - c.at < RESERVE_COLOR_MS);
    const taken: Array<string | null> = [];
    for (const r of this.sessions.values()) {
      if (r.info.state !== 'exited' || recent(r.info)) taken.push(r.info.color);
    }
    for (const info of this.removed.values()) if (recent(info)) taken.push(info.color);
    return taken;
  }

  // The colours a new session in cwd will share a screen with (M9 fix
  // 133): the live sessions of the same repository, by their live
  // folder, a worktree counting as its repository, so the blocks side
  // by side on one Commits graph are the ones the pick keeps apart.
  private peerColors(cwd: string): Array<string | null> {
    const key = repoKey(cwd);
    const peers: Array<string | null> = [];
    for (const r of this.sessions.values()) {
      if (r.info.state !== 'exited' && repoKey(r.info.cwd) === key) peers.push(r.info.color);
    }
    return peers;
  }

  remove(sessionId: string): void {
    const rec = this.get(sessionId);
    if (rec.info.state !== 'exited') throw new SessionError('bad-request', `session ${sessionId} is still running; kill it first`);
    this.stopTail(rec);
    this.sessions.delete(sessionId);
    this.removed.set(sessionId, { ...rec.info, removedAt: Date.now() });
    this.log.info('session removed', { id: sessionId });
    this.save();
    this.emit('removed', sessionId);
  }

  // An empty name hands the name back to what it would be by itself: the
  // conversation's title while Claude has named one, else the folder.
  rename(sessionId: string, name: string): void {
    const rec = this.get(sessionId);
    const given = name.trim();
    rec.info =
      given === ''
        ? { ...rec.info, name: autoNameFor(rec.info) ?? rec.info.cwd, autoName: true }
        : { ...rec.info, name: given, autoName: false };
    this.changed(rec);
  }

  // The checkpoint. A field left undefined is unchanged, so a comment can
  // be written without touching the phase and the other way round; a
  // blank comment is the same as clearing it. The colour (M29) rides the
  // same request since it is set the same way, from a menu or the CLI.
  set(sessionId: string, fields: { comment?: string | null; phase?: SessionPhase | null; color?: string; scheme?: string | null; keepWhole?: boolean }): void {
    const rec = this.get(sessionId);
    // Keep whole (M9 fix 773) is for a Claude session alone, since a
    // shell's hand-typed claude never loads the mod that asks; refused
    // before any field is applied, and false on a shell changes nothing.
    if (fields.keepWhole === true && rec.info.kind !== 'claude') {
      throw new SessionError('bad-request', `keep whole is for a Claude session emerald started; ${rec.info.name} is a shell`);
    }
    let info = rec.info;
    if (fields.comment !== undefined) {
      const trimmed = fields.comment === null ? '' : fields.comment.trim();
      const comment = trimmed === '' ? null : trimmed;
      if (comment !== info.comment) info = { ...info, comment };
    }
    if (fields.phase !== undefined && fields.phase !== info.phase) info = { ...info, phase: fields.phase };
    if (fields.color !== undefined && fields.color !== info.color) info = { ...info, color: fields.color };
    // The scheme (M9 fix 244) can be cleared, unlike the colour: null
    // puts the session back on the window's pick.
    if (fields.scheme !== undefined && fields.scheme !== (info.scheme ?? null)) info = { ...info, scheme: fields.scheme };
    if (fields.keepWhole !== undefined && fields.keepWhole !== (info.keepWhole === true)) info = { ...info, keepWhole: fields.keepWhole };
    if (info === rec.info) return;
    rec.info = info;
    this.log.info('session set', { id: sessionId, comment: info.comment, phase: info.phase, color: info.color, scheme: info.scheme ?? null, keepWhole: info.keepWhole === true });
    this.changed(rec);
  }

  // The emerald mod's question before a compaction (M9 fix 773, POST
  // /compact on the sink): the skip reason when the session is marked to
  // keep whole, sits idle, waiting or done, and the compaction is the
  // engine's own (auto, which the idle compactor and a full window both
  // pass, or precompute, its ahead-of-time summary); else null, let
  // through. A manual /compact or a plugin's is the person's or a mod's
  // own ask, and a compaction while the session works or needs input is a
  // full window's mid-turn, whose skip would end the turn in an error.
  compactAsk(sessionId: string, trigger: string): string | null {
    const id8 = sessionId.slice(0, 8);
    const rec = this.sessions.get(sessionId);
    if (rec === undefined) {
      this.log.info(`compact asked for an unknown session ${id8}: let through`);
      return null;
    }
    const { state } = rec.info;
    const kept = rec.info.keepWhole === true;
    const skip = kept && (state === 'idle' || state === 'waiting' || state === 'done') && (trigger === 'auto' || trigger === 'precompute');
    this.log.info(`compact asked for ${id8}: trigger ${trigger}, keep whole ${kept ? 'on' : 'off'}, state ${state}: ${skip ? 'skipped' : 'let through'}`);
    return skip ? KEEP_WHOLE_SKIP : null;
  }

  // The user looked at a finished session, so it no longer needs highlighting.
  ack(sessionId: string): void {
    const rec = this.get(sessionId);
    this.log.info('session ack', { id: sessionId, state: rec.info.state });
    this.apply(rec, { type: 'ack', at: Date.now() });
  }

  // Whether this session's Claude was started with the emerald mod (M9
  // fix 725), so the sink can say once when the mod posted nothing. A
  // shell pane's hand-typed claude posts under the shell's id with no mod
  // and is not one.
  launchedWithMod(sessionId: string): boolean {
    const launcher = this.launchers.claude;
    return launcher instanceof ClaudeLauncher && launcher.modDir !== null && this.sessions.get(sessionId)?.info.kind === 'claude';
  }

  // The rate-limit windows of a mod's measure (M9 fix 739), emitted as
  // `limits` when they differ from the last emitted; an entry without a
  // string kind and a finite percent is dropped.
  private noteLimits(payload: HookPayload, at: number): void {
    const given = payload.measure?.rateLimits;
    if (!Array.isArray(given) || given.length === 0) return;
    const limits: UsageLimit[] = [];
    for (const l of given) {
      if (typeof l?.kind !== 'string' || typeof l.percentUsed !== 'number' || !Number.isFinite(l.percentUsed)) continue;
      limits.push({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: typeof l.resetsAt === 'string' ? l.resetsAt : null });
    }
    if (limits.length === 0) return;
    const json = JSON.stringify(limits);
    if (json === this.lastLimits) return;
    this.lastLimits = json;
    this.emit('limits', { at, limits });
  }

  // A row of the conversation the mod kept (M9 fix 769), emitted as `row`
  // for the pipe server to push on, when it is the bound conversation's
  // and carries a uuid and a user or assistant row with blocks. A foreign
  // or malformed one emits nothing and logs nothing, since a line per row
  // would flood the log.
  private noteRow(rec: SessionRecord, payload: HookPayload, at: number, outcome: HookOutcome): HookResult {
    if (outcome !== 'applied') return { outcome };
    const uuid = payload.uuid;
    const row = payload.row as Partial<ModRow> | null | undefined;
    if (typeof uuid !== 'string' || uuid === '') return { outcome };
    if (row === null || typeof row !== 'object' || (row.type !== 'user' && row.type !== 'assistant') || !Array.isArray(row.content)) return { outcome };
    this.emit('row', { sessionId: rec.info.id, at, uuid, row: row as ModRow, cut: payload.cut === true });
    return { outcome };
  }

  // Entry point for the hook sink. Returns why an event was or was not used,
  // and the state change it made when it made one, so the sink can record
  // both next to the payload in hooks.jsonl.
  applyHook(sessionId: string, given: HookPayload, at: number): HookResult {
    // The account's rate limits, read before the record: they are not the
    // session's, and the post already carried the sink's token.
    if (given.hook_event_name === 'Measure') this.noteLimits(given, at);
    const rec = this.sessions.get(sessionId);
    if (rec === undefined) return { outcome: 'unknown-session' };
    // The folder a hook reports, in its one spelling (fix 108); the sink
    // keeps its own copy of the payload for hooks.jsonl.
    const payload = typeof given.cwd === 'string' && given.cwd !== '' ? { ...given, cwd: realFolder(given.cwd) } : given;
    // A known subagent's PreToolUse, whatever the tool, says what it is
    // doing now (M65); read before the classification, which keeps every
    // tool but the git-writing ones dropped.
    if (payload.hook_event_name === 'PreToolUse' && typeof payload.agent_id === 'string') this.noteAgentActivity(rec, payload.agent_id, payload);
    const outcome = classifyHook(rec.info, payload);
    // A kept row (M9 fix 769) says nothing about the state, so it never
    // reaches the reducer and leaves the record alone.
    if (payload.hook_event_name === MOD_APPEND) return this.noteRow(rec, payload, at, outcome);
    if (outcome === 'applied' && payload.hook_event_name === 'Spinner') rec.spinnerFromMod = true;
    if (outcome === 'applied-agent') {
      // A known subagent's own Bash call (M61): where the agent works and
      // what it committed. The reducer sees it too, for the one thing an
      // agent's hook says about the parent's row: its permission prompt
      // is answered (M9 fix 109).
      this.recordAgentCommand(rec, payload, at);
    } else if (outcome !== 'applied') {
      this.log.info('hook not applied', { id: sessionId, outcome, event: payload.hook_event_name, claudeSessionId: payload.session_id });
      // Say why once per new conversation, with the one it lost to (M9 fix
      // 734): the line above names neither the bound id nor the likely cause.
      if (outcome === 'ignored-foreign' && payload.hook_event_name === 'SessionStart' && typeof payload.session_id === 'string' && !this.foreignStartsTold.has(payload.session_id)) {
        if (this.foreignStartsTold.size >= FOREIGN_STARTS_TOLD_CAP) this.foreignStartsTold.delete(this.foreignStartsTold.values().next().value as string);
        this.foreignStartsTold.add(payload.session_id);
        this.log.info('hook SessionStart under another conversation ignored: a nested claude, or a new conversation with no SessionEnd before it; emmer explain shows its hooks', { sessionId, bound: rec.info.claudeSessionId, new: payload.session_id });
      }
    }
    const before = rec.info.state;
    const groupBefore = rec.info.groupCwd;
    const spanBefore = rec.info.spans?.at(-1);
    const taskListBefore = { tasks: rec.info.tasks ?? [] };
    this.apply(rec, { type: 'hook', payload, at });
    // Claude started somewhere else than the shell was opened (M9 fix
    // 148): the session is grouped there now, so its start commit is
    // that folder's HEAD.
    if (outcome === 'applied' && payload.hook_event_name === 'SessionStart' && rec.info.groupCwd !== groupBefore) void this.recordStartHead(rec, rec.info.groupCwd);
    // A conversation span opened (M9 fix 185): its own start commit is
    // the group folder's HEAD now, so the block for the work after a
    // /clear starts where the clear happened. The first span reads on
    // its own too (M9 fix 378): it starts at the SessionStart, not at
    // the spawn, and a shell that ran for two hours before its person
    // typed claude has moved HEAD since the spawn's read (the record's
    // own startHead keeps that one, for the sidebar and lineStart). A
    // span opened by a move takes the re-read above.
    const span = rec.info.spans?.at(-1);
    if (outcome === 'applied' && span !== undefined && span.startHead === null && span.conversation !== spanBefore?.conversation && rec.info.groupCwd === groupBefore) void this.recordSpanHead(rec, rec.info.groupCwd);
    // A checkout most likely happened between turns or with the cd, so the
    // branch is re-read at those points rather than on every tool call (a
    // move re-reads it inside apply).
    if (outcome === 'applied' && BRANCH_EVENTS.has(payload.hook_event_name ?? '')) this.refreshBranch(rec);
    // The transcript's head names the claude.ai session once, if ever
    // (M58); looked for at the turn boundaries until found, since the
    // attachment can land a few lines in.
    if (outcome === 'applied' && REMOTE_EVENTS.has(payload.hook_event_name ?? '') && rec.info.remoteSessionId === null && rec.info.transcriptPath !== null) void this.recordRemoteSession(rec);
    // Claude's checklist off its files (M9 fix 153) when the hooks did
    // not build it: a conversation that reports in with a list already
    // made (a resume), or a TaskUpdate naming a task the record lacks.
    // A member's TaskUpdate counts too (M9 fix 394): its tasks are in the
    // same folder and the same list, so a member carrying on with a list
    // the record never saw is behind the files exactly as the parent is.
    if ((outcome === 'applied' || outcome === 'applied-agent') && rec.info.claudeSessionId !== null && ((payload.hook_event_name === 'SessionStart' && (rec.info.tasks?.length ?? 0) === 0) || namesUnknownTask(taskListBefore, payload))) void this.recordTasks(rec);
    // HEAD is held before and read after every Bash call in a repository
    // (M9 fix 195), not only one whose text names a git write: a commit
    // made through a script (`node tools/land.mjs`) used to go uncredited
    // and then be swept into whichever session next ran a plain `git
    // commit`. The text rule stays as a second way in, for a folder whose
    // .git the daemon cannot see. The reads cost no process (readHeadFile).
    // A git read (`git log`, a gate poll) holds nothing (M9 fix 311): HEAD
    // moved under it by another session's merge is not this one's.
    if (outcome === 'applied' && HEAD_TOOLS.has(payload.tool_name ?? '')) {
      const command = payload.tool_input?.command;
      const dir = typeof command === 'string' ? realFolder(commandDir(command, payload.cwd ?? rec.info.cwd, os.homedir())) : null;
      if (typeof command === 'string' && dir !== null && !readsOnly(command) && (movesHead(command) || findGitDir(dir) !== null)) {
        const key = payload.tool_use_id ?? '';
        if (payload.hook_event_name === 'PreToolUse') void this.holdHead(rec, key, dir, at);
        else if (payload.hook_event_name === 'PostToolUse') void this.recordHead(rec, key, dir, at, movesHead(command));
        else if (payload.hook_event_name === 'PostToolUseFailure') rec.heads?.delete(key);
      }
    }
    // A new prompt is a new turn: a call whose end never landed is forgotten.
    if (outcome === 'applied' && payload.hook_event_name === 'UserPromptSubmit') rec.heads?.clear();
    // The turn's tool pace for the stall threshold (M9 fix 232): the
    // session's own PostToolUse lines, a subagent's not counted, since
    // the parent's silence is what the flag is about.
    if (outcome === 'applied') {
      if (payload.hook_event_name === 'UserPromptSubmit') rec.toolAt = [];
      else if (payload.hook_event_name === 'PostToolUse') (rec.toolAt ??= []).push(at);
    }
    // A file written (M9 fix 198), by the session's own Edit or a known
    // member's: the member's hook is dropped by the classification (it
    // says nothing about the parent's state) and read here on its own.
    const edited = touchedPath(payload);
    if (edited !== null && !isForeignHook(rec.info, payload) && (payload.agent_id === undefined || payload.agent_id === '' || isKnownAgent(rec.info, payload.agent_id))) {
      this.recordTouched(rec, edited, payload.agent_id ?? null, at);
    }
    const after = rec.info.state;
    return before === after ? { outcome } : { outcome, from: before, to: after };
  }

  // Flags working sessions that have gone quiet, and re-reads the branch of
  // every live session, since a shell never reports its checkouts. Public
  // so tests can drive the clock.
  checkStale(now: number): void {
    for (const rec of this.sessions.values()) {
      this.apply(rec, { type: 'stale-check', at: now, staleAfterMs: staleThresholdMs(rec.toolAt ?? [], this.staleAfterMs) });
      if (rec.pty !== null) this.refreshBranch(rec);
    }
  }

  // The touched list gains the file (M9 fix 198), in its one spelling
  // (realFolder resolves a file as it does a folder; one that is gone
  // already is kept as named), the same path moved to the end rather
  // than listed twice. Pushed and saved like a commit, so the rail's dot
  // shows at once and a resume keeps it.
  private recordTouched(rec: SessionRecord, file: string, agentId: string | null, at: number): void {
    const touched = appendTouched(rec.info.touched ?? [], { path: realFolder(file), at, agentId: agentId === '' ? null : agentId });
    rec.info = { ...rec.info, touched };
    this.changed(rec);
  }

  // Reads HEAD after a git-writing command and keeps it when it moved
  // (M49). The read is a git process, so it runs off the hook's path and
  // lands whenever it lands; a record removed or resumed meanwhile is left
  // alone, and the same hash twice in a row (a dry run, a merge that was
  // already up to date) is not a second commit.
  // HEAD before the command runs (M58), held by the call's id in the
  // folder the command names, so the read after it knows what it added.
  // The files first, git only when they do not say (M9 fix 195), since
  // this now runs on every Bash call in a repository.
  private readHead(dir: string): Promise<string | null> {
    const fromFiles = this.headFromFiles(dir);
    return fromFiles !== null ? Promise.resolve(fromFiles) : this.readHeadSpawned(dir);
  }

  private headFromFiles(dir: string): string | null {
    if (this.opts.readHeadFile !== undefined) return this.opts.readHeadFile(dir);
    return this.opts.readHead !== undefined ? null : readHeadFile(dir);
  }

  private readHeadSpawned(dir: string): Promise<string | null> {
    return (this.opts.readHead ?? readHead)(dir);
  }

  // Which of a claim's hashes are merges (M9 fix 218). A test that fakes
  // the head read runs no git anywhere, so without a fake of its own it
  // gets none.
  private readMerges(dir: string, hashes: string[]): Promise<Set<string>> {
    if (this.opts.readMerges !== undefined) return this.opts.readMerges(dir, hashes);
    if (this.opts.readHead !== undefined) return Promise.resolve(new Set());
    return readMerges(dir, hashes);
  }

  private async holdHead(rec: SessionRecord, key: string, dir: string, at: number): Promise<void> {
    const pid = rec.info.pid;
    const head = await this.readHead(dir);
    if (this.sessions.get(rec.info.id) !== rec || rec.info.pid !== pid) return;
    if (rec.heads === undefined) rec.heads = new Map();
    rec.heads.set(key, { dir, head, at });
  }

  // HEAD after the command (M58): with a read from before the call, the
  // first-parent commits between the two are credited, so a merge credits
  // the merge commit alone and a command that did nothing credits nothing;
  // without one (an older hooks install, a missed event) the new HEAD is
  // credited when it differs from the last, as M49 did, and only when the
  // command's text names a git write (M9 fix 195): since every call in a
  // repository is measured now, an `ls` with no read before it must not
  // claim whatever HEAD happens to be. Each claim carries the time, so two
  // sessions claiming one hash are told apart by who was first. A record
  // removed or resumed meanwhile is left alone. Only commits made since
  // the hold are credited (M9 fix 470), so a checkout or a fast-forward
  // credits nothing. A held null (the read before failed) counts as no
  // hold (M9 fix 471), or an `ls` would credit whatever HEAD is. And a
  // hash another record already holds is not credited again (M9 fix
  // 472), except that a command naming a git write takes it from a record
  // whose claim came from an unnamed command, since a long build spanning
  // another session's commit can post first.
  private async recordHead(rec: SessionRecord, key: string, dir: string, at: number, named: boolean): Promise<void> {
    const id = rec.info.id;
    const pid = rec.info.pid;
    const held = rec.heads?.get(key);
    rec.heads?.delete(key);
    if ((held === undefined || held.head === null) && !named) return;
    const where = held?.dir ?? dir;
    const hash = await this.readHead(where);
    if (hash === null || this.sessions.get(id) !== rec || rec.info.pid !== pid) return;
    let added: string[];
    if (held !== undefined) {
      if (held.head === hash) return;
      added = await (this.opts.revList ?? revListFirstParent)(where, held.head, hash, held.at);
      if (this.sessions.get(id) !== rec || rec.info.pid !== pid) return;
    } else {
      added = [hash];
    }
    const known = new Set(rec.info.commits.map((c) => c.hash));
    const fresh = added.filter((h) => !known.has(h));
    if (fresh.length === 0) return;
    // M9 fix 218: which of them are merges, one git over the lot; the
    // record may have moved on meanwhile, so the guard runs once more.
    const merges = await this.readMerges(where, fresh);
    if (this.sessions.get(id) !== rec || rec.info.pid !== pid) return;
    const claimed = this.claimedHashes({ id, agentId: '' });
    const takes = named ? this.unnamedClaims(rec) : new Map<string, SessionRecord>();
    const own = fresh.filter((h) => !rec.info.commits.some((c) => c.hash === h) && (!claimed.has(h) || takes.has(h)));
    if (own.length === 0) return;
    for (const h of own) {
      const other = takes.get(h);
      if (other === undefined) continue;
      other.info = { ...other.info, commits: other.info.commits.filter((c) => c.hash !== h) };
      other.claimNamed?.delete(h);
      this.log.info('session commit taken', { id, from: other.info.id, hash: h });
      this.changed(other);
    }
    const kept = [...rec.info.commits, ...own.map((h) => ({ hash: h, at, ...(merges.has(h) ? { merge: true } : {}) }))].slice(-Limits.commitsKept);
    rec.info = { ...rec.info, commits: kept };
    if (rec.claimNamed === undefined) rec.claimNamed = new Map();
    for (const h of own) rec.claimNamed.set(h, named);
    for (const h of rec.claimNamed.keys()) if (!kept.some((c) => c.hash === h)) rec.claimNamed.delete(h);
    this.log.info('session commits', { id, hashes: own, dir: where });
    this.changed(rec);
  }

  // The hashes other records hold from an unnamed command's claim (M9 fix
  // 472), by the record holding each; a command naming a git write may
  // take them. A claim from before a restart has no entry and is kept.
  private unnamedClaims(rec: SessionRecord): Map<string, SessionRecord> {
    const out = new Map<string, SessionRecord>();
    for (const other of this.sessions.values()) {
      if (other === rec || other.claimNamed === undefined) continue;
      for (const [h, named] of other.claimNamed) if (!named) out.set(h, other);
    }
    return out;
  }

  // Reads the claude.ai session id off the transcript's head (M58) and
  // keeps it; a record resumed or removed meanwhile is left alone, and a
  // transcript without one is looked at again at the next turn boundary.
  // The task files are read whenever a hook says the record's list is
  // behind them; the read lands whenever it lands, and a record removed
  // or resumed meanwhile is left alone, as the other reads are.
  private async recordTasks(rec: SessionRecord): Promise<void> {
    const id = rec.info.id;
    const pid = rec.info.pid;
    const claudeSessionId = rec.info.claudeSessionId;
    if (claudeSessionId === null) return;
    const tasks = await (this.opts.readTasks ?? readTaskFiles)(claudeSessionId);
    if (tasks.length === 0 || this.sessions.get(id) !== rec || rec.info.pid !== pid || rec.info.claudeSessionId !== claudeSessionId) return;
    this.apply(rec, { type: 'tasks', tasks, at: Date.now() });
  }

  private async recordRemoteSession(rec: SessionRecord): Promise<void> {
    const id = rec.info.id;
    const pid = rec.info.pid;
    const transcriptPath = rec.info.transcriptPath;
    if (transcriptPath === null) return;
    const remote = await (this.opts.readRemoteSessionId ?? readRemoteSessionId)(transcriptPath);
    if (remote === null || this.sessions.get(id) !== rec || rec.info.pid !== pid || rec.info.remoteSessionId !== null) return;
    // The open span keeps it too (M9 fix 185), so a block per span
    // credits the trailers of its own conversation.
    const spans = rec.info.spans ?? [];
    const last = spans.at(-1);
    const withSpan = last !== undefined && last.remoteSessionId === null ? [...spans.slice(0, -1), { ...last, remoteSessionId: remote }] : spans;
    rec.info = { ...rec.info, remoteSessionId: remote, ...(withSpan === spans ? {} : { spans: withSpan }) };
    this.log.info('session remote id', { id, remote });
    this.changed(rec);
  }

  // A subagent's Bash or PowerShell call (M61): the folder the command
  // ran in becomes the member's cwd (in its one real spelling, M9 fix
  // 107, so a Git Bash `cd /c/...` finds its .git) and the branch that
  // folder is on its branch, read from .git/HEAD as the session's own is
  // (a worktree's .git file points at its own HEAD, so no worktree list
  // is needed); around a git-writing
  // command HEAD is read there before and after, and what the range added
  // along the first parent is the member's commits, so a merge credits
  // the merge commit alone. A failed call credits nothing. A call in the
  // session's own folder places nothing (M9 fix 116): an agent that runs
  // `git worktree add` in the repository, or never leaves it, has no
  // worktree and sits on the parent's line, and one that comes back to
  // run something after its commits keeps the worktree it took, so the
  // card and `emmer ls --team` keep naming its branch. The head reads
  // still run in the call's folder, so a commit there is credited. The
  // session's own folder is the one its hooks report (M9 fix 113) or
  // it started in, not the call's own cwd: a hook whose cwd is the
  // worktree itself is the agent's, and that one does place it. And the
  // folder follows a command only into a repository (M9 fix 137): an
  // agent reading its verify logs with `cd ../emerald-wt/logs && grep`
  // used to lose its branch for the span of each such call, and with it
  // its lane on the graph, since a log folder or a temp folder says
  // nothing about where the agent works. A folder in another repository
  // still moves it, since a peek cannot be told from a move here.
  private recordAgentCommand(rec: SessionRecord, payload: HookPayload, at: number): void {
    const agentId = payload.agent_id;
    const command = payload.tool_input?.command;
    if (typeof agentId !== 'string' || typeof command !== 'string') return;
    const base = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : rec.info.cwd;
    const dir = realFolder(commandDir(command, base, os.homedir()));
    if (![rec.info.cwd, rec.info.spawnCwd].some((own) => sameFolder(dir, own))) {
      const branch = (this.opts.readBranch ?? readBranch)(dir);
      // A branch is proof enough; the .git walk is for a repository whose
      // HEAD cannot be read, so the member still follows a command there.
      if (branch !== null || findGitDir(dir) !== null) {
        this.patchMember(rec, agentId, (m) => (m.cwd === dir && m.branch === branch ? m : { ...m, cwd: dir, branch }));
      }
    }
    // Every call in a repository is measured, as the session's own are
    // (M9 fix 195); the text rule stays as the second way in.
    if (!movesHead(command) && findGitDir(dir) === null) return;
    const event = payload.hook_event_name;
    const heads = (rec.agentHeads ??= new Map());
    // A git read credits nothing (M9 fix 311): a gate poll in a checkout
    // another session is merging into found HEAD moved under it and was
    // credited the merge. Neither read runs for it; a value left from an
    // earlier call is consumed, and HEAD found moved under the read is
    // logged and dropped.
    const reads = readsOnly(command);
    // Every hook of the agent's is a new read (M9 fix 311): a git spawned
    // for the head before a call landed, under load, after a one-commit
    // cherry-pick had finished, so `before` read the new HEAD and the
    // pick went uncredited. The files are read first and stored at once,
    // before the hook is acked; only a null falls to the spawn, whose
    // value is kept while it is still the newest read for the agent.
    const seq = (rec.agentHeadSeq ??= new Map());
    const n = (seq.get(agentId) ?? 0) + 1;
    seq.set(agentId, n);
    if (event === 'PreToolUse') {
      if (reads) return;
      const fromFiles = this.headFromFiles(dir);
      if (fromFiles !== null) {
        heads.set(agentId, fromFiles);
        return;
      }
      void this.readHeadSpawned(dir).then((hash) => {
        if (hash !== null && seq.get(agentId) === n && this.sessions.get(rec.info.id) === rec) heads.set(agentId, hash);
      });
      return;
    }
    const before = heads.get(agentId) ?? null;
    heads.delete(agentId);
    if (event !== 'PostToolUse') return;
    if (reads) {
      if (before !== null) void this.noteHeadMovedUnderRead(rec, agentId, dir, before);
      return;
    }
    // With no read from before, only a command that names a git write
    // may claim the new HEAD (M9 fix 195), as on the session's own path.
    if (before === null && !movesHead(command)) return;
    void this.creditAgentCommits(rec, agentId, dir, before, at);
  }

  private async noteHeadMovedUnderRead(rec: SessionRecord, agentId: string, dir: string, before: string): Promise<void> {
    const after = await this.readHead(dir);
    if (after === null || after === before || this.sessions.get(rec.info.id) !== rec) return;
    this.log.info('head moved under a read-only call', { id: rec.info.id, agent: agentId, dir, before, after });
  }

  // Every hash some record already holds (M9 fix 311): the session's
  // own, its members', and every other record's; a member is credited
  // none of these a second time, so a merge landed by one session while
  // another's fork was mid-command is drawn once. The member's own are
  // left to the patch, which skips them anyway.
  private claimedHashes(except: { id: string; agentId: string }): Set<string> {
    const claimed = new Set<string>();
    for (const other of this.sessions.values()) {
      for (const c of other.info.commits) claimed.add(c.hash);
      for (const m of other.info.team) {
        if (other.info.id === except.id && m.id === except.agentId) continue;
        for (const c of m.commits) claimed.add(c.hash);
      }
    }
    return claimed;
  }

  private async creditAgentCommits(rec: SessionRecord, agentId: string, dir: string, before: string | null, at: number): Promise<void> {
    const after = await this.readHead(dir);
    if (after === null || before === after || this.sessions.get(rec.info.id) !== rec) return;
    let hashes: string[] = [];
    if (before !== null) hashes = await (this.opts.listCommits ?? listFirstParent)(dir, before, after);
    if (hashes.length === 0) hashes = [after];
    if (this.sessions.get(rec.info.id) !== rec) return;
    const claimed = this.claimedHashes({ id: rec.info.id, agentId });
    hashes = hashes.filter((h) => !claimed.has(h));
    if (hashes.length === 0) return;
    const merges = await this.readMerges(dir, hashes);
    if (this.sessions.get(rec.info.id) !== rec) return;
    this.patchMember(rec, agentId, (m) => {
      const last = m.commits[m.commits.length - 1]?.hash ?? null;
      const added = hashes.filter((h) => h !== last && !m.commits.some((c) => c.hash === h)).map((hash) => ({ hash, at, ...(merges.has(hash) ? { merge: true } : {}) }));
      if (added.length === 0) return m;
      this.log.info('agent commit', { id: rec.info.id, agent: agentId, hashes: added.map((c) => c.hash) });
      return { ...m, commits: [...m.commits, ...added].slice(-Limits.commitsKept) };
    });
  }

  // The agent's activity line (M65): the tool phrase of its latest call,
  // the same words the sidebar's turn line gives the parent's own calls.
  private noteAgentActivity(rec: SessionRecord, agentId: string, payload: HookPayload): void {
    const activity = toolPhrase(payload.tool_name, payload.tool_input);
    if (activity === null) return;
    this.patchMember(rec, agentId, (m) => (m.kind !== 'agent' || m.activity === activity ? m : { ...m, activity }));
  }

  // Applies a change to one team member and publishes it; a member the
  // next prompt has already cleared, or an unchanged one, is nothing.
  // The team is not in the file, so nothing is saved (M9 fix 459): a
  // member's activity line on every subagent call used to rewrite it.
  private patchMember(rec: SessionRecord, agentId: string, patch: (m: TeamMember) => TeamMember): void {
    const member = rec.info.team.find((m) => m.id === agentId);
    if (member === undefined) return;
    const next = patch(member);
    if (next === member) return;
    rec.info = { ...rec.info, team: rec.info.team.map((m) => (m === member ? next : m)) };
    this.emit('changed', { ...rec.info });
  }

  // The branch is read again at every start and not in the file, so a
  // move of it is published without a save (M9 fix 459).
  private refreshBranch(rec: SessionRecord): void {
    const branch = readBranch(rec.info.cwd);
    if (branch === rec.info.branch) return;
    rec.info = { ...rec.info, branch };
    this.emit('changed', { ...rec.info });
  }

  killAll(): void {
    for (const rec of this.sessions.values()) rec.pty?.kill();
  }

  // Keeps every live PTY's frame on its record before a stop (M9 fix
  // 159), so the panes show what each session was doing until it is
  // resumed. The emulator answers on its own schedule, so a frame that
  // takes longer than the timeout is given up rather than holding the
  // stop; one save at the end, for the lot, written before it returns
  // along with any change still waiting on the timer. Returns how many
  // were kept.
  async keepScreens(timeoutMs: number = Limits.keepScreenTimeoutMs): Promise<number> {
    const live = [...this.sessions.values()].filter((rec) => rec.pty !== null);
    const frames = await Promise.all(live.map((rec) => withTimeout(rec.pty!.screen(), timeoutMs)));
    let kept = 0;
    frames.forEach((frame, i) => {
      if (frame === null) return;
      live[i]!.kept = { rows: frame.rows, cursor: frame.cursor };
      kept++;
    });
    if (kept > 0) this.saveNow();
    else this.flush();
    if (live.length > 0) this.log.info('screens kept', { kept, live: live.length });
    return kept;
  }

  // Writes a save still waiting on the coalescing timer, now (M9 fix
  // 459); nothing when none is.
  flush(): void {
    if (this.saveTimer !== null) this.saveNow();
  }

  close(): void {
    this.closed = true;
    this.offReftable();
    this.flush();
    if (this.staleTimer !== null) clearInterval(this.staleTimer);
    this.load?.stop();
    for (const rec of this.sessions.values()) {
      this.stopTail(rec);
      this.dropTypeAtPrompt(rec);
    }
  }

  // Starts the transcript tail when a turn is running (working, or paused
  // on a permission prompt) on a live PTY whose transcript is known, and
  // stops it otherwise (M47). Called whenever the state or the path
  // moves; a tail already on the right file is left alone, so the
  // offset it keeps is not lost mid-turn.
  private syncTail(rec: SessionRecord): void {
    const info = rec.info;
    const midTurn = info.state === 'working' || info.state === 'needs-input';
    const wanted = midTurn && rec.pty !== null && info.transcriptPath !== null ? info.transcriptPath : null;
    if (wanted === null) {
      this.stopTail(rec);
      return;
    }
    if (rec.tail != null && rec.tail.path === wanted) return;
    this.stopTail(rec);
    const id = info.id;
    const tail = new TranscriptTail(wanted, (text) => {
      // A record forgotten or resumed since has nothing to say. New text
      // takes the line from the tool call before it (M9 fix 79).
      if (this.sessions.get(id) !== rec || rec.tail !== tail || (rec.info.liveReply === text && rec.info.liveTool === null)) return;
      rec.info = { ...rec.info, liveReply: text, liveTool: null };
      rec.publish?.();
    }, this.opts.transcriptPollMs ?? Limits.transcriptPollMs);
    rec.tail = tail;
    tail.start();
    this.log.info('transcript tail started', { id, path: wanted });
  }

  private stopTail(rec: SessionRecord): void {
    if (rec.tail == null) return;
    rec.tail.stop();
    rec.tail = null;
  }

  // A publisher for the changes that are not written to disk (the title,
  // the live reply): the first change goes out at once and the rest of a
  // hold of ms is published when it ends, so a spinner glyph flipping in
  // the title or a transcript line a second does not push a session
  // update each time. A record forgotten during the hold says nothing.
  private throttledPublish(rec: SessionRecord, ms: number): () => void {
    const id = rec.info.id;
    let timer: NodeJS.Timeout | null = null;
    let pending = false;
    const publish = () => {
      if (timer !== null) {
        pending = true;
        return;
      }
      this.emit('changed', { ...rec.info });
      timer = setTimeout(() => {
        timer = null;
        if (pending && this.sessions.get(id) === rec) {
          pending = false;
          publish();
        }
      }, ms);
      timer.unref();
    };
    return publish;
  }

  // The prompt never reported: the line is dropped rather than typed blind.
  private typeTimer(rec: SessionRecord, line: string): NodeJS.Timeout {
    const timer = setTimeout(() => {
      if (rec.typeAtPrompt?.timer !== timer) return;
      rec.typeAtPrompt = null;
      this.log.warn('no prompt reported after the resume, not typing', { id: rec.info.id, line });
    }, this.opts.resumeTypeTimeoutMs ?? Limits.resumeTypeTimeoutMs);
    timer.unref();
    return timer;
  }

  private dropTypeAtPrompt(rec: SessionRecord): void {
    if (!rec.typeAtPrompt) return;
    clearTimeout(rec.typeAtPrompt.timer);
    rec.typeAtPrompt = null;
  }

  private launch(id: string, kind: SessionKind, args: string[], cwd: string, cols: number, rows: number, shell: ShellOption | null): PtySession {
    // Git Bash reads its rc from the file (M9 fix 624), written fresh at
    // every launch so a new build's rc reaches the next shell.
    if (shell?.id === 'gitbash' && args.length === 0) writeFileAtomic(this.bashrcPath, BASH_RC, this.log);
    const command = this.launchers[kind].command(args, shell);
    if (command.note !== undefined) this.log.warn(command.note, { id });
    const hook = this.opts.hook;
    const env = stampEnv(process.env, hook === undefined ? { sessionId: id } : { sessionId: id, hookPort: hook.port, hookToken: hook.token });
    // The launch's own variables (M9 fix 624: cmd's PROMPT) replace the
    // inherited ones whatever their case, since Windows reads the block
    // case-blind and two spellings of one name would leave either.
    for (const [key, value] of Object.entries(command.env ?? {})) {
      for (const k of Object.keys(env)) if (k.toUpperCase() === key.toUpperCase()) delete env[k];
      env[key] = value;
    }
    return PtySession.spawn({
      file: command.file,
      args: command.args,
      cwd,
      env,
      cols,
      rows,
    }, { onClamp: (text) => this.log.warn(text, { id }) });
  }

  private watch(rec: SessionRecord, pty: PtySession): void {
    const id = rec.info.id;
    pty.on('warning', (err) => this.log.warn('pty warning', { id, err: String(err) }));
    // The shell's prompt reports its folder in the output stream; the
    // branch follows the folder.
    const scanner = new CwdScanner();
    // The title too: the latest one is kept on the record, and the change
    // goes to subscribers at most every titlePublishMs, since Claude Code's
    // spinner glyph would otherwise push a session update every second. A
    // change during the hold is published when it ends. Not written to
    // disk: the title is not persisted, and the file is meant for rare
    // writes. The name that follows it (M9 fix 34) is, through the reducer,
    // which only reports a change when the name itself moves. The live
    // reply off the transcript (M47) rides the same publisher.
    const titles = new TitleScanner();
    // And Claude Code's spinner word (M9 fix 158), for the agent line
    // when nothing else has landed: the latest one on the record, on the
    // title's publisher, cleared by the reducer with the live reply.
    const spinner = new SpinnerScanner();
    // And the prompt's FinalTerm marks (M9 fix 196): C when a command
    // starts, D with its code when it ends, on the record through the
    // reducer, which puts a plain shell at done or errored when a long
    // one ends. Only while this PTY is the record's, like the typed line.
    const marks = new MarkScanner();
    const publishTitle = this.throttledPublish(rec, Limits.titlePublishMs);
    rec.publish = publishTitle;
    pty.on('data', (chunk: Buffer) => {
      for (const { mark, code } of marks.push(chunk)) {
        if (rec.pty === pty) this.apply(rec, { type: 'shell-mark', mark, code, at: Date.now(), doneAfterMs: this.shellDoneAfterMs });
      }
      for (const reported of scanner.push(chunk)) {
        const cwd = realFolder(reported);
        this.apply(rec, { type: 'cwd', cwd, at: Date.now() });
        // The first prompt of a resumed shell is where the conversation
        // is picked up (M48); the line is written once and only while
        // this PTY is the record's, so a shell that died before its
        // prompt is not handed it on the next resume.
        if (rec.typeAtPrompt && rec.pty === pty) {
          const { line } = rec.typeAtPrompt;
          this.dropTypeAtPrompt(rec);
          this.log.info('typing at the resumed prompt', { id, line });
          pty.write(line + '\r');
        }
      }
      const words = spinner.push(chunk);
      const verb = words.length === 0 ? null : words[words.length - 1]!;
      // M9 fix 775: Claude Code hides its spinner while a permission dialog
      // is up and draws it again once the answered call runs, so a word on
      // a row at a permission ask says the call is running. The mod's own
      // ToolRunning, off the call's progress row, draws only at the end of
      // a run on Windows (the probe: 10 to 12 s into a ten-second run),
      // where the word came 0.6 and 1.75 s after the answer. The event is
      // the mod's, aimed at the ask's own call.
      if (verb !== null && rec.pty === pty && rec.info.state === 'needs-input' && rec.info.needsInputReason === 'permission') {
        const moved = this.applyHook(id, { hook_event_name: MOD_TOOL_RUNNING, ...(rec.info.claudeSessionId ? { session_id: rec.info.claudeSessionId } : {}), ...(rec.info.askedFor?.toolUseId ? { tool_use_id: rec.info.askedFor.toolUseId } : {}) }, Date.now());
        if (moved.to === 'working') this.log.info('permission answered: the spinner drew again', { id, word: verb });
      }
      if (verb !== null && verb !== (rec.info.liveVerb ?? null) && rec.pty === pty && rec.spinnerFromMod !== true) {
        rec.info = { ...rec.info, liveVerb: verb };
        publishTitle();
      }
      const found = titles.push(chunk);
      if (found.length === 0) return;
      // An empty title is a cleared one, which reads the same as none.
      const title = found[found.length - 1]!.trim() || null;
      if (title === rec.info.title) return;
      rec.info = { ...rec.info, title };
      publishTitle();
      this.apply(rec, { type: 'title', at: Date.now() });
    });
    // Throttled by the PTY session; the pipe server fans it out to whoever
    // subscribed to activity (a CLI waiting for the output to go quiet).
    pty.on('activity', (at: number) => this.emit('activity', { id, at }));
    // Likewise for the output rate (M41), fanned out on the rate topic to
    // the app, which draws it on the state meter.
    pty.on('rate', (samples: number[]) => this.emit('rate', { id, samples, at: Date.now() }));
    pty.on('exit', (exitCode: number) => {
      if (rec.pty === pty) this.dropTypeAtPrompt(rec);
      // The frame at the exit (M9 fix 159), read once the emulator has
      // applied the last bytes; it lands on the record a moment after
      // the exit itself and is saved on its own.
      void pty.screen().then((frame) => {
        if (rec.pty !== pty || this.sessions.get(id) !== rec) return;
        rec.kept = { rows: frame.rows, cursor: frame.cursor };
        this.save();
      });
      this.apply(rec, { type: 'pty.exit', exitCode, at: Date.now() });
      this.log.info('session exited', { id, exitCode });
      this.emit('exit', { ...rec.info });
      // After the exit has been announced, so attached clients still get
      // their pty.exit note before the session vanishes under them.
      if (rec.removeOnExit === true && this.sessions.get(id) === rec) this.remove(id);
    });
  }

  private apply(rec: SessionRecord, event: Parameters<typeof reduce>[1]): void {
    let next = reduce(rec.info, event);
    if (next === rec.info) return;
    const before = rec.info;
    // A move takes its branch with it in the same push (M9 fix 114): the
    // branch is the folder's, and a client that saw the new folder under
    // the old branch for one push took a folder outside any repo for one
    // with a branch. The re-read at the turn boundaries stays as it was.
    if (next.cwd !== before.cwd) next = { ...next, branch: readBranch(next.cwd) };
    rec.info = next;
    if (before.state !== next.state) {
      this.log.info('session state', { id: next.id, from: before.state, to: next.state, reason: next.needsInputReason });
    }
    if (before.state !== next.state || before.transcriptPath !== next.transcriptPath) this.syncTail(rec);
    // A change to a field the file does not keep (a shell's command, M9
    // fix 196) goes out to subscribers without a disk write, the way the
    // title does (its own publisher): the persisted form is compared, so
    // a state change the mark drives still saves, and a running-to-ok
    // update that moves no persisted field does not touch sessions.json.
    if (persistedUnchanged(before, next)) this.emit('changed', { ...rec.info });
    else this.changed(rec);
  }

  // Every change goes to subscribers at once and to disk from here, the
  // file at most saveDelayMs behind what clients were told (M9 fix 459).
  private changed(rec: SessionRecord): void {
    this.emit('changed', { ...rec.info });
    this.save();
  }

  // The save is coalesced (M9 fix 459): the first change starts the timer
  // and every change inside it rides the one write, since a hook storm
  // wrote the whole file up to four seconds a minute. keepScreens, close
  // and the exit path flush it.
  private save(): void {
    const delay = this.opts.saveDelayMs ?? 0;
    if (this.closed || delay <= 0) {
      this.saveNow();
      return;
    }
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => this.saveNow(), delay);
    // The stop flushes before its exit, so the timer need not hold the
    // process open.
    this.saveTimer.unref();
  }

  // The listed sessions and the removed ones, in one file, with the kept
  // screens beside them.
  private saveNow(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const recs = [...this.sessions.values()];
    const screens = new Map<string, KeptScreen>();
    for (const r of recs) if (r.kept != null) screens.set(r.info.id, r.kept);
    this.opts.store?.save([...recs.map((r) => r.info), ...this.removed.values()], screens);
  }
}

// Whether two infos persist the same, so a change to a field the file
// does not keep (a shell's command, M9 fix 196) can go out to subscribers
// without a disk write. The kept screen is not the info's, so both take
// null for it.
function persistedUnchanged(a: SessionInfo, b: SessionInfo): boolean {
  return JSON.stringify(toPersisted(a, null)) === JSON.stringify(toPersisted(b, null));
}

// The value, or null once the timeout has passed without it.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

// What a resumed session is launched as (M48): the folder, the args and a
// line to type at the first prompt. A Claude session with a conversation
// starts in the folder Claude was in with its args and --resume; ours goes
// last so a session that was itself started with --resume <old> picks up
// the bound conversation, not the one from before. A shell that hosted one
// comes back as a shell in that folder and gets claude --resume typed, so
// the pane is a shell again when Claude leaves, as it was. A session with
// no conversation behind it starts again in its spawn folder with its
// args. A bound id with no conversation (a SessionStart without a cwd)
// still resumes, in the spawn folder.
export interface ResumePlan {
  cwd: string;
  args: string[];
  typed: string | null;
}

export function resumePlan(info: Pick<SessionInfo, 'kind' | 'claudeSessionId' | 'args' | 'spawnCwd' | 'conversation'>): ResumePlan {
  // A malformed id already saved resumes like none (M9 fix 508): the
  // typed line would run whatever it held.
  const id = [info.conversation?.id, info.claudeSessionId].find(isSessionId) ?? null;
  const cwd = info.conversation?.cwd ?? info.spawnCwd;
  if (id === null) return { cwd: info.spawnCwd, args: [...info.args], typed: null };
  if (info.kind === 'claude') return { cwd, args: [...info.args, '--resume', id], typed: null };
  return { cwd, args: [...info.args], typed: `claude --resume ${id}` };
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function checkDirectory(cwd: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    throw new SessionError('bad-request', `cwd does not exist: ${cwd}`);
  }
  if (!stat.isDirectory()) throw new SessionError('bad-request', `cwd is not a directory: ${cwd}`);
}

function restoredInfo(p: PersistedSession, now: number): SessionInfo {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    autoName: p.autoName,
    spawnCwd: realFolder(p.spawnCwd),
    args: [...p.args],
    shell: p.shell,
    cwd: realFolder(p.cwd),
    groupCwd: realFolder(p.groupCwd),
    branch: readBranch(p.cwd),
    lastPrompt: p.lastPrompt,
    lastReply: p.lastReply,
    lastPromptAt: p.lastPromptAt,
    lastReplyAt: p.lastReplyAt,
    state: 'exited',
    // A session nobody saw exit is counted as exited from the restart.
    stateSince: p.exitedAt ?? now,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    model: p.model,
    contextPercent: p.contextPercent,
    contextWindow: p.contextWindow,
    tokens: p.tokens,
    costUsd: p.costUsd,
    tasks: p.tasks.map((task) => ({ ...task })),
    comment: p.comment,
    phase: p.phase,
    color: p.color,
    scheme: p.scheme,
    keepWhole: p.keepWhole,
    title: null,
    transcriptPath: null,
    liveReply: null,
    liveTool: null,
    liveVerb: null,
    claudeSessionId: p.claudeSessionId,
    remoteSessionId: p.remoteSessionId,
    startHead: p.startHead,
    conversation: p.conversation,
    spans: p.spans.map((c) => ({ ...c })),
    commits: p.commits.map((c) => ({ ...c })),
    touched: p.touched.map((t) => ({ ...t })),
    shellCwd: null,
    command: null,
    pid: null,
    exitCode: p.exitCode,
    createdAt: p.createdAt,
    removedAt: p.removedAt,
  };
}
