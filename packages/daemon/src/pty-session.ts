import { EventEmitter } from 'node:events';
import { spawn as ptySpawn } from 'node-pty';
// A CommonJS bundle, so under ESM only the default import carries anything.
import xtermHeadless from '@xterm/headless';
import { Limits } from '@emerald/shared';
import { pluginDirs } from './launchers/shell.ts';
import { RingBuffer } from './ring-buffer.ts';

// The slice of node-pty's IPty that PtySession needs. Narrowed so tests can
// hand in a fake without spawning a real process.
export interface PtyHandle {
  readonly pid: number;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (ev: { exitCode: number; signal?: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pause(): void;
  resume(): void;
}

export interface SpawnOptions {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface EnvStamp {
  sessionId: string;
  // Absent when the daemon runs without a hook sink. The hook script no-ops
  // when the port is missing, so such a session is simply hook-less.
  hookPort?: number;
  hookToken?: string;
  // The PATH read from the registry at this spawn (M9 fix 971); absent
  // keeps the daemon's own.
  path?: string;
}

// Variables that mark a process as living inside another Claude Code session.
// When the app itself was launched from a Claude Code terminal they leak into
// every PTY and make Claude believe it is a child session ("Transcript saving
// is off", found in M2). Only these named markers go; the rest of CLAUDE_CODE_*
// is deliberate user configuration (Bedrock, limits) that must survive.
const PARENT_CLAUDE_MARKERS = new Set([
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_JOB_DIR',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
]);

// What describes the terminal the daemon happened to be started from. The
// pane is the terminal now, so none of it may reach a session: a daemon
// started from a Claude Code Bash tool in Windows Terminal carries NO_COLOR=1,
// which Claude Code honours, and the pane came out nearly all white.
const PARENT_TERMINAL_MARKERS = new Set([
  'NO_COLOR',
  'FORCE_COLOR',
  'CLICOLOR',
  'CLICOLOR_FORCE',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'WT_SESSION',
  'WT_PROFILE_ID',
  'CLAUDE_CODE_SESSION_ATTENDED',
]);

// What the pane answers when a program asks what terminal it is in. node-pty's
// `name` only sets TERM on posix, so the daemon sets both by hand.
export const PANE_TERMINAL_ENV: Readonly<Record<string, string>> = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
};

export function isStrippedEnvKey(key: string): boolean {
  // EMERALD_*: stale identity from a nested launch. ORCA_*: an Emerald app started
  // inside an Orca pane must not report its sessions to Orca as well.
  // ELECTRON_RUN_AS_NODE: the packaged daemon runs under Emerald.exe as Node
  // with this set, and a session inheriting it would start any Electron app
  // (VS Code from `code .`) as a bare Node process.
  return (
    key.startsWith('EMERALD_') ||
    key.startsWith('ORCA_') ||
    key === 'ELECTRON_RUN_AS_NODE' ||
    PARENT_CLAUDE_MARKERS.has(key) ||
    PARENT_TERMINAL_MARKERS.has(key)
  );
}

// Build the child environment: the parent's, minus anything that would tie the
// session to another supervisor or to the terminal the daemon was born in,
// plus what the pane is and our identity so every hook fired inside inherits it.
export function stampEnv(base: NodeJS.ProcessEnv, stamp: EnvStamp): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (isStrippedEnvKey(key)) continue;
    env[key] = value;
  }
  // A parent's emerald mod is identity too (M9 fix 833): the launch names
  // this daemon's own.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() !== 'CLAUDE_CODE_PLUGIN_DIRS') continue;
    const rest = pluginDirs(null, env[key]);
    if (rest === '') delete env[key];
    else env[key] = rest;
  }
  Object.assign(env, PANE_TERMINAL_ENV);
  // Our own home and pipe are identity too, not stale: an `emerald` command
  // typed into a pane of a daemon on a private pair (a verify harness, a
  // click-through) must reach this daemon, not the one on the default pipe,
  // which does not know the session (M9 fix 351: the collide demo's
  // checkpoints went to the wrong daemon that way). Under the real daemon
  // neither is set and nothing changes.
  for (const key of ['EMERALD_HOME', 'EMERALD_PIPE']) {
    const own = base[key];
    if (own !== undefined && own !== '') env[key] = own;
  }
  env['EMERALD_SESSION_ID'] = stamp.sessionId;
  if (stamp.hookPort !== undefined) env['EMERALD_HOOK_PORT'] = String(stamp.hookPort);
  if (stamp.hookToken !== undefined) env['EMERALD_HOOK_TOKEN'] = stamp.hookToken;
  // Windows' own spelling, every other one dropped: the block is read
  // case-blind, so two spellings would leave either.
  if (stamp.path !== undefined) {
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key];
    env['Path'] = stamp.path;
  }
  return env;
}

const { Terminal } = xtermHeadless;
type Terminal = InstanceType<typeof Terminal>;
type BufferLine = NonNullable<ReturnType<Terminal['buffer']['active']['getLine']>>;
type BufferCell = ReturnType<Terminal['buffer']['active']['getNullCell']>;

// The dim run on a prompt row (M9 fix 779), as Claude Code draws a
// suggested prompt, a stock placeholder or an inline completion: every
// placeholder goes through one renderer, the first character inverse when
// the cursor sits on it and the rest SGR 2 dim. The walk starts after the
// row's ❯ cell; the run starts at the first dim cell, a cell earlier when
// that one is the inverse cursor on a character, and ends before the next
// cell that is not dim. x is the index into the row's string, which stays
// right after a wide character where a cell index would not. Null when
// the row holds no ❯ or no dim run with text.
export function ghostRun(line: BufferLine, cell: BufferCell): { x: number; text: string } | null {
  const cols = line.length;
  let i = 0;
  while (i < cols && line.getCell(i, cell)?.getChars() !== '❯') i++;
  if (i >= cols) return null;
  const arrow = i;
  let start = -1;
  for (i = arrow + 1; i < cols; i++) {
    if (line.getCell(i, cell)?.isDim() !== 0) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  if (start - 1 > arrow) {
    const before = line.getCell(start - 1, cell);
    if (before !== undefined && before.isInverse() !== 0 && before.getChars().trim() !== '') start--;
  }
  let end = start + 1;
  while (end < cols && line.getCell(end, cell)?.isDim() !== 0) end++;
  const text = line.translateToString(true, start, end).trimEnd();
  if (text === '') return null;
  return { x: line.translateToString(false, 0, start).length, text };
}

// Lines of scrollback on the screen terminal; see its construction.
const SCREEN_SCROLLBACK_ROWS = 200;

export type OutputSink = (chunk: Buffer, replay: boolean) => void;

export interface PtySessionOptions {
  flushIntervalMs?: number;
  earlyFlushBytes?: number;
  ringBufferBytes?: number;
  // The size the screen is rendered at; defaults match the daemon's spawn.
  cols?: number;
  rows?: number;
  // How often at most 'activity' fires while output flows.
  activityIntervalMs?: number;
  // The window the output rate is counted over, and how many windows a
  // 'rate' event carries.
  rateWindowMs?: number;
  rateSamples?: number;
  // Told once in the session's life when a size is clamped at the ceiling
  // (M9 fix 504), with the text the manager logs.
  onClamp?: (text: string) => void;
}

// A pty size as node-pty and the headless terminal may take it: whole,
// at least 1 (ConPTY rejects zero), at most Limits.maxPtyCols by
// Limits.maxPtyRows (M9 fix 504).
export function clampPtySize(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Math.min(Limits.maxPtyCols, Math.max(1, Math.floor(cols))),
    rows: Math.min(Limits.maxPtyRows, Math.max(1, Math.floor(rows))),
  };
}

export interface Screen {
  // The viewport, trailing blank cells and trailing blank rows dropped.
  rows: string[];
  cursor: { x: number; y: number };
  // The ring's sequence number when the frame was rendered, so a reader
  // can go on with read --cursor from the same point.
  seq: number;
  // The dim run on the last row starting with ❯ (M9 fix 779, ghostRun),
  // y indexing rows; null when there is none, and on the exit frame.
  ghost: { y: number; x: number; text: string } | null;
}

// One PTY plus its scrollback and the fan-out to attached clients.
// Emits 'exit' (exitCode: number) exactly once, 'activity' (at: number)
// while output flows, at most once per activityIntervalMs, and 'rate'
// (samples: number[]) once per rate window while output flows (M41).
export class PtySession extends EventEmitter {
  readonly pid: number;
  readonly ring: RingBuffer;
  exited = false;
  exitCode: number | null = null;
  // When the last byte came out of the PTY, null before the first.
  lastOutputAt: number | null = null;

  private readonly pty: PtyHandle;
  private readonly sinks = new Set<OutputSink>();
  private readonly flushIntervalMs: number;
  private readonly earlyFlushBytes: number;
  private readonly activityIntervalMs: number;
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private paused = false;
  private lastActivityAt = 0;
  private activityTimer: NodeJS.Timeout | null = null;
  private readonly rateWindowMs: number;
  private readonly rateSamples: number;
  // Bytes seen in the window now open, the last windows' counts (oldest
  // first), and how many windows in a row were empty, which is what stops
  // the timer once a burst is over.
  private windowBytes = 0;
  private samples: number[];
  private quietWindows = 0;
  private rateTimer: NodeJS.Timeout | null = null;
  // A terminal emulator with no window, kept in step with the PTY so the
  // rendered screen can be read. The stripped ring buffer is what was
  // emitted over time; a TUI that repaints reads as fragments there.
  private readonly screenTerm: Terminal;
  // One render of the frame taken at the exit, after which the terminal is
  // disposed (about 0.9 MB each, M9 fix 502): every later read (the
  // manager's exit frame, the pipe, keepScreens, emmer explain) shares it.
  // The ring stays, since attach and pty.read replay a dead pane from it.
  private exitFrame: Promise<Screen> | null = null;
  private readonly onClamp: ((text: string) => void) | undefined;
  private clampTold = false;
  private disposed = false;

  static spawn(opts: SpawnOptions, sessionOpts: PtySessionOptions = {}): PtySession {
    const size = clampPtySize(opts.cols, opts.rows);
    const pty = ptySpawn(opts.file, opts.args, {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: opts.cwd,
      env: opts.env,
      useConpty: true,
    });
    // The unclamped size, so the constructor's clamp is the one that logs.
    return new PtySession(pty, { cols: opts.cols, rows: opts.rows, ...sessionOpts });
  }

  constructor(pty: PtyHandle, opts: PtySessionOptions = {}) {
    super();
    this.pty = pty;
    this.pid = pty.pid;
    this.flushIntervalMs = opts.flushIntervalMs ?? Limits.flushIntervalMs;
    this.earlyFlushBytes = opts.earlyFlushBytes ?? Limits.earlyFlushBytes;
    this.activityIntervalMs = opts.activityIntervalMs ?? Limits.activityIntervalMs;
    this.rateWindowMs = opts.rateWindowMs ?? Limits.rateWindowMs;
    this.rateSamples = opts.rateSamples ?? Limits.rateSamples;
    this.samples = new Array<number>(this.rateSamples).fill(0);
    this.onClamp = opts.onClamp;
    this.ring = new RingBuffer(opts.ringBufferBytes ?? Limits.ringBufferBytes);
    // The screen is the viewport and the ring already keeps the history,
    // so the scrollback here is not for reading: with none at all a
    // resize that takes rows away can leave xterm's base line above the
    // rows it still holds, and the next line feed throws from xterm's own
    // write timer, an uncaught TypeError that took the daemon down (seen
    // on a pane squeezed to 8 columns by 41 rows while a shell wrote). A
    // few screens of scrollback keep it on the resize path it is built for.
    const size = this.clamp(opts.cols ?? 80, opts.rows ?? 24);
    this.screenTerm = new Terminal({ cols: size.cols, rows: size.rows, scrollback: SCREEN_SCROLLBACK_ROWS, allowProposedApi: true });

    pty.onData((data) => this.onData(Buffer.from(data, 'utf8')));
    pty.onExit(({ exitCode }) => this.onExit(exitCode));
  }

  // The rendered frame. xterm parses its input on its own schedule, so the
  // answer waits for everything written so far to have been applied.
  screen(): Promise<Screen> {
    if (this.exitFrame !== null) {
      // A session that has ended suggests nothing (M9 fix 779).
      return this.exitFrame.then((f) => ({ rows: [...f.rows], cursor: { ...f.cursor }, seq: f.seq, ghost: null }));
    }
    return this.renderFrame();
  }

  // For the tests: whether the headless terminal has been let go.
  get screenDisposed(): boolean {
    return this.disposed;
  }

  private renderFrame(): Promise<Screen> {
    return new Promise((resolve) => {
      this.screenTerm.write('', () => {
        const buffer = this.screenTerm.buffer.active;
        const rows: string[] = [];
        for (let y = 0; y < this.screenTerm.rows; y++) {
          // trimEnd as well: a shell that takes back typed letters overwrites
          // them with spaces, which are cells to xterm and blanks to a reader.
          rows.push((buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '').trimEnd());
        }
        while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
        let ghost: Screen['ghost'] = null;
        let y = rows.length - 1;
        while (y >= 0 && !rows[y]!.trimStart().startsWith('❯')) y--;
        if (y >= 0) {
          const line = buffer.getLine(buffer.viewportY + y);
          const run = line === undefined ? null : ghostRun(line, buffer.getNullCell());
          if (run !== null) ghost = { y, ...run };
        }
        // The screen was fed raw chunks; flush so the ring has seen the same bytes.
        this.flush();
        resolve({ rows, cursor: { x: buffer.cursorX, y: buffer.cursorY }, seq: this.ring.seq, ghost });
      });
    });
  }

  // Sends everything already in scrollback as one replay chunk, then live
  // chunks as they are flushed. Pending output is flushed first so the replay
  // and the live stream never overlap or reorder.
  attach(sink: OutputSink): void {
    this.flush();
    sink(this.ring.readAll(), true);
    this.sinks.add(sink);
  }

  detach(sink: OutputSink): void {
    this.sinks.delete(sink);
  }

  get attachedCount(): number {
    return this.sinks.size;
  }

  write(data: string): void {
    if (this.exited) return;
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exited) return;
    // ConPTY rejects zero-sized terminals; a collapsed pane must not kill
    // the session, and a huge one must not take the daemon's memory.
    const { cols: c, rows: r } = this.clamp(cols, rows);
    try {
      this.pty.resize(c, r);
      this.screenTerm.resize(c, r);
    } catch (err) {
      this.emit('warning', err);
    }
  }

  // What was written since `since`, for a reader that only wants the new
  // output; see RingBuffer.readSince. Flushed first so it is current.
  readSince(since: number): { data: Buffer; next: number; oldest?: number } {
    this.flush();
    return this.ring.readSince(since);
  }

  // Backpressure from a slow client. Idempotent so several clients can vote.
  pause(): void {
    if (this.exited || this.paused) return;
    this.paused = true;
    this.pty.pause();
  }

  resume(): void {
    if (this.exited || !this.paused) return;
    this.paused = false;
    this.pty.resume();
  }

  kill(): void {
    // node-pty's kill() throws "AttachConsole failed" once the process is gone
    // (found in M0), so never call it on an exited session.
    if (this.exited) return;
    try {
      this.pty.kill();
    } catch (err) {
      this.emit('warning', err);
    }
  }

  // clampPtySize, telling onClamp the first time a ceiling (not the floor
  // of 1) changes a size.
  private clamp(cols: number, rows: number): { cols: number; rows: number } {
    const size = clampPtySize(cols, rows);
    const c = Math.max(1, Math.floor(cols));
    const r = Math.max(1, Math.floor(rows));
    if ((size.cols !== c || size.rows !== r) && !this.clampTold) {
      this.clampTold = true;
      this.onClamp?.(`resize clamped to ${size.cols}x${size.rows} from ${c}x${r}`);
    }
    return size;
  }

  private onData(chunk: Buffer): void {
    if (chunk.length === 0) return;
    // Raw chunks as they arrive, before batching, for readers that look for
    // something in the stream (the prompt's folder) rather than render it.
    this.emit('data', chunk);
    if (!this.exited) this.screenTerm.write(chunk);
    this.noteActivity();
    this.noteRate(chunk.length);
    this.pending.push(chunk);
    this.pendingBytes += chunk.length;
    if (this.pendingBytes >= this.earlyFlushBytes) {
      this.flush();
      return;
    }
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingBytes === 0) return;
    const chunk = this.pending.length === 1 ? this.pending[0]! : Buffer.concat(this.pending, this.pendingBytes);
    this.pending = [];
    this.pendingBytes = 0;
    this.ring.write(chunk);
    for (const sink of this.sinks) {
      sink(chunk, false);
    }
  }

  // 'activity' fires on the first byte after a quiet spell and then at most
  // once per interval, with a trailing one so the last byte of a burst is
  // reported within the interval. A waiter can therefore take the latest
  // event's time as the last output time, give or take the interval.
  private noteActivity(): void {
    const now = Date.now();
    this.lastOutputAt = now;
    if (now - this.lastActivityAt >= this.activityIntervalMs) {
      this.lastActivityAt = now;
      this.emit('activity', now);
      return;
    }
    if (this.activityTimer === null) {
      this.activityTimer = setTimeout(() => {
        this.activityTimer = null;
        this.lastActivityAt = Date.now();
        this.emit('activity', this.lastOutputAt ?? Date.now());
      }, this.activityIntervalMs - (now - this.lastActivityAt));
    }
  }

  // The output rate (M41): the bytes of each window, the last few windows
  // reported together, one bar of the state meter per window. The timer
  // runs only while something comes out, from the first byte after quiet
  // until a whole set of windows has been empty, so the last report of a
  // burst is all zeros and the meter settles at its floor on its own;
  // nothing ticks for a session that is quiet.
  private noteRate(bytes: number): void {
    this.windowBytes += bytes;
    if (this.rateTimer !== null) return;
    this.rateTimer = setInterval(() => this.closeWindow(), this.rateWindowMs);
    this.rateTimer.unref();
  }

  private closeWindow(): void {
    this.samples = [...this.samples.slice(1), this.windowBytes];
    this.quietWindows = this.windowBytes === 0 ? this.quietWindows + 1 : 0;
    this.windowBytes = 0;
    this.emit('rate', [...this.samples]);
    if (this.quietWindows >= this.rateSamples) this.stopRate();
  }

  private stopRate(): void {
    if (this.rateTimer !== null) {
      clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
    this.quietWindows = 0;
  }

  private onExit(exitCode: number): void {
    if (this.exited) return;
    // Deliver whatever the process printed on its way out before announcing the exit.
    this.flush();
    if (this.activityTimer !== null) {
      clearTimeout(this.activityTimer);
      this.activityTimer = null;
    }
    this.stopRate();
    // Rendered before the flag so the render's write('') lands after every
    // chunk already written; the terminal goes once the frame is taken.
    this.exitFrame = this.renderFrame().then((frame) => {
      this.screenTerm.dispose();
      this.disposed = true;
      return frame;
    });
    this.exited = true;
    this.exitCode = exitCode;
    this.emit('exit', exitCode);
  }
}
