import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DAEMON_FEATURE_LEVEL, Limits, PROTOCOL_VERSION } from '@emerald/shared';
import { pipePathOf, readPipeToken, sameHome } from '@emerald/shared/pipe-name';
import { processIdentityAsync } from '@emerald/shared/process-identity';
import type { ClientMessage, RequestType, Requests, ShellOption } from '@emerald/shared';
// The shared one-connection client (M9 fix 665); this class keeps the name
// PipeClient, since index.ts, update-relay.ts and the tests read it.
import { PipeClient as PipeConnection } from '@emerald/shared/pipe-client';
import type { Runner } from './node-runner.ts';
import { nodeCommand } from './node-runner.ts';

export interface PipeClientOptions {
  pipePath?: string;
  // This window's home (M9 fix 495), read against the hello's so a daemon
  // serving another home is named in the log and on the banner.
  home?: string;
  // Path to the daemon's dist/main.js, used to autostart it.
  daemonMain: string;
  // How to run it as Node; see node-runner.ts. Defaults to 'node'.
  runner?: Runner;
  log: (msg: string) => void;
  // How long hello may go unanswered before the connection is given up
  // (M9 fix 380); the tests shorten it.
  helloTimeoutMs?: number;
  // How long a window that finds no daemon.json on connecting waits for it
  // before its hello (M9 fix 632); the tests shorten it.
  daemonJsonWaitMs?: number;
  // How long a daemon that took daemon.stop is given before its tree is
  // killed; the tests shorten it.
  stopGraceMs?: number;
}

// A daemon that takes the connection and never answers hello (one dying
// on the pipe, its write side gone) held the connect loop for good, since
// the hello was settled only by a reply or by the socket's close (M9 fix
// 380, seen at verify:menus's relaunch as `pipe error: Error: write EPIPE`
// and then fifteen seconds of nothing).
const HELLO_TIMEOUT_MS = 5000;

// A window that connects to a daemon it just started reaches the pipe
// before the daemon has written daemon.json, so its hello carried no token
// and was refused at attach, or, on a start held 8.7 s by the antivirus,
// timed out against a daemon still loading, since the hello deadline runs
// from the connect and the daemon's from its attach (M9 fix 632). With a
// home and no daemon.json, the hello waits for the file, polled every
// DAEMON_JSON_POLL_MS under DAEMON_JSON_WAIT_MS from the connect. A
// daemon that is stopping unlinks its record before its pipe closes (its
// finish, M9 fix 380's dying daemon included), so a window reconnecting to
// one enters this wait too, and the socket's close ends it, not the 5 s
// hello deadline. A file present without a token (a daemon from before
// fix 612, a garbled one, a crashed daemon's stale record) keeps the old
// path: the hello at once, and the one immediate retry on a refusal.
const DAEMON_JSON_POLL_MS = 100;
const DAEMON_JSON_WAIT_MS = 30_000;

// The wait after each autostart before the next, while nothing owns the
// pipe (M9 fix 453): 3 s, 5 s, then every 30 s, so tries land at 0, 3, 8
// and 38 s. The first wait was 1 s until M9 fix 496, and a cold start
// takes longer than that (the x64 box's 1.2 s, this laptop's 1.6 to 3.9 s
// at installs), so every such start spawned a spare daemon that lost the
// pipe claim and exited 2 (the daemon claims the pipe before it loads
// anything, M9 fix 454, so the spare never did harm, only noise).
const AUTOSTART_BACKOFF_MS = [3000, 5000];
const AUTOSTART_EVERY_MS = 30_000;

function autostartBackoff(tries: number): number {
  return AUTOSTART_BACKOFF_MS[tries - 1] ?? AUTOSTART_EVERY_MS;
}

// What hello said about the daemon on the other end.
export interface DaemonInfo {
  pid: number;
  version: string;
  // Absent from daemons older than M9 fix 11; the renderer treats that as 1.
  featureLevel: number | null;
  // When its process started, in epoch ms (M9 fix 494); null from a
  // daemon older than level 57, which is then never killed by pid.
  startedAt: number | null;
  // Set when the daemon serves another home than this window's (M9 fix
  // 495); null when they agree or either side does not say.
  otherHome: { theirs: string; mine: string } | null;
  // The shells the daemon found at its start (M9 fix 624), the first the
  // default; empty from a daemon older than level 61.
  shells: ShellOption[];
}

// Pipe client for the Electron main process. Keeps one connection to emmerd,
// starts the daemon when nothing owns the pipe, and reconnects after a drop.
// Emits 'message' (ServerMessage push), 'connected' (DaemonInfo), 'disconnected',
// 'daemon-crashed' ({ pid, code }, a child daemon that ended on an NTSTATUS, M9 fix 815).
// How long a daemon that took daemon.stop is given to let go of the pipe
// before its tree is killed after all.
const STOP_GRACE_MS = 3000;

export class PipeClient extends EventEmitter {
  private readonly pipePath: string;
  private readonly opts: PipeClientOptions;
  private conn: PipeConnection | null = null;
  private stopped = false;
  private daemon: DaemonInfo | null = null;
  private connectedOnce: Promise<void>;
  private resolveConnectedOnce: () => void = () => {};

  constructor(opts: PipeClientOptions) {
    super();
    this.opts = opts;
    this.pipePath = opts.pipePath ?? pipePathOf();
    this.connectedOnce = new Promise((r) => (this.resolveConnectedOnce = r));
  }

  get connected(): boolean {
    return this.conn !== null;
  }

  // What hello said about the daemon on the current connection; null while
  // disconnected. The renderer asks for it on every sync because it may
  // load after the connection is up and miss the connected push.
  get daemonInfo(): DaemonInfo | null {
    return this.daemon;
  }

  // Resolves once the first connection is up. Later reconnects are silent.
  ready(): Promise<void> {
    return this.connectedOnce;
  }

  start(): void {
    void this.connectLoop();
  }

  stop(): void {
    this.stopped = true;
    this.conn?.close();
  }

  // Asks the daemon to stop (M9 fix 159), so it keeps every live
  // session's screen and exits on its own; a daemon from before the
  // request, or one still alive after a moment, has its whole process
  // tree killed as `emmer daemon stop` does (on Windows process.kill is
  // TerminateProcess and would leave the shells orphaned). The pipe then
  // vanishes, the connect loop sees ENOENT and starts the shipped daemon,
  // which lists the old sessions as exited. Alive, not still connected:
  // a daemon that took the request, released the pipe and logged
  // `exiting` was found still running with a child under it after the
  // new one was up (M9 fix 258; node-pty's exit hangs the process), and
  // the reconnect had made the old guard skip it.
  //
  // The kill goes only to the process the hello named (M9 fix 494): a pid
  // is a number Windows reuses within minutes, and in the three seconds
  // of the grace the new daemon's own spawns can draw the old number, so
  // the pid's start time is read against the one the daemon reported.
  restartDaemon(): void {
    const daemon = this.daemon;
    if (daemon === null) throw new Error('not connected to emmerd');
    const { pid, startedAt } = daemon;
    const kill = () => {
      void this.killIfSame(pid, startedAt, `restarting emmerd: killing pid ${pid} and its tree`);
    };
    this.opts.log(`restarting emmerd: asking pid ${pid} to stop`);
    this.request('daemon.stop', {}).then(
      ({ kept }) => {
        this.opts.log(`emmerd kept ${kept} screen${kept === 1 ? '' : 's'} and is stopping`);
        setTimeout(kill, this.opts.stopGraceMs ?? STOP_GRACE_MS);
      },
      (err: unknown) => {
        this.opts.log(`emmerd did not take daemon.stop (${err instanceof Error ? err.message : String(err)})`);
        kill();
      },
    );
  }

  // Stops the daemon for good (M9 fix 239, the update's restart): no
  // reconnect and no autostart after it, the daemon asked to stop as
  // restartDaemon asks, its tree killed if it is still on the pipe after
  // the grace, and the promise resolves once the pipe is gone (or after
  // one more grace), so the installer never meets an Emerald.exe still
  // running the daemon.
  async stopDaemon(): Promise<void> {
    this.stopped = true;
    const daemon = this.daemon;
    if (daemon === null) {
      this.conn?.close();
      return;
    }
    const { pid, startedAt } = daemon;
    const gone = new Promise<void>((resolve) => this.once('disconnected', () => resolve()));
    this.opts.log(`stopping emmerd for the update: asking pid ${pid} to stop`);
    try {
      const { kept } = await this.request('daemon.stop', {});
      this.opts.log(`emmerd kept ${kept} screen${kept === 1 ? '' : 's'} and is stopping`);
    } catch (err) {
      this.opts.log(`emmerd did not take daemon.stop (${err instanceof Error ? err.message : String(err)})`);
    }
    const timeout = (ms: number) => new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms));
    const grace = this.opts.stopGraceMs ?? STOP_GRACE_MS;
    if ((await Promise.race([gone, timeout(grace)])) === 'timeout') {
      if (await this.killIfSame(pid, startedAt, `emmerd pid ${pid} is still on the pipe, killing its tree`)) await Promise.race([gone, timeout(grace)]);
    }
    this.conn?.destroy();
  }

  // Kills pid's tree only while it is still the daemon the hello named
  // (M9 fix 494), and says so when it is not; true when the kill went.
  private async killIfSame(pid: number, startedAt: number | null, line: string): Promise<boolean> {
    if (startedAt === null) {
      this.opts.log(`not killing pid ${pid}: emmerd did not say when it started`);
      return false;
    }
    const identity = await processIdentityAsync(pid, startedAt);
    if (identity === 'gone') return false;
    if (identity === 'other') {
      this.opts.log(`not killing pid ${pid}: it is not the daemon that was started at ${new Date(startedAt).toISOString()}`);
      return false;
    }
    this.opts.log(line);
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }).on('error', (err) => this.opts.log(`taskkill failed: ${String(err)}`));
    return true;
  }

  request<K extends RequestType>(type: K, body: Requests[K]['req']): Promise<Requests[K]['res']> {
    const conn = this.conn;
    if (conn === null) return Promise.reject(new Error('not connected to emmerd'));
    return conn.request(type, body);
  }

  send(msg: ClientMessage): void {
    // Keystrokes sent while disconnected are dropped; the renderer shows a banner instead.
    const conn = this.conn;
    if (conn === null) return;
    if (msg.type === 'pty.input' && msg.data.length > Limits.inputChunkChars) {
      // A long paste goes in pieces, in order on the one socket (M9 fix 498).
      for (const data of inputPieces(msg.data, Limits.inputChunkChars)) conn.send({ ...msg, data });
      return;
    }
    conn.send(msg);
  }

  private async connectLoop(): Promise<void> {
    // Autostarts since the last connection, and when the next may go.
    // A daemon that dies at start used to be spawned once and never again,
    // the window left on "reconnecting" for good (M9 fix 453, M75's H1);
    // it is started again on AUTOSTART_BACKOFF_MS while ENOENT holds, and
    // a connection starts the count over.
    let tries = 0;
    let nextStartAt = 0;
    // A token refusal whose re-read token differs connects again at once,
    // one time (M9 fix 612); the next refusal waits the usual sleep.
    let retriedToken = false;
    while (!this.stopped) {
      try {
        const conn = await PipeConnection.connect(this.pipePath);
        tries = 0;
        nextStartAt = 0;
        // onConnected resolves when the connection closes.
        const retryNow = await this.onConnected(conn);
        if (retryNow && !retriedToken) {
          retriedToken = true;
          continue;
        }
        retriedToken = false;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          if (Date.now() >= nextStartAt) {
            tries += 1;
            this.startDaemon(tries);
            nextStartAt = Date.now() + autostartBackoff(tries);
          }
        } else {
          this.opts.log(`pipe connect failed: ${String(err)}`);
        }
      }
      await sleep(tries > 0 && !this.connected ? 250 : 1000);
    }
  }

  // Resolves when the socket closes: true when the hello was refused for its
  // token and daemon.json now holds another one, so the loop tries again at
  // once (M9 fix 612, the start race: a window that connects while the
  // daemon starts reaches the pipe before daemon.json is written).
  private async onConnected(conn: PipeConnection): Promise<boolean> {
    this.conn = conn;
    // Every request still waiting is settled on the close itself, rather
    // than after the await below: the hello is one of them, and the await
    // sat behind the hello (M9 fix 380). The shared client settles them
    // before it emits 'close'.
    let isClosed = false;
    const closed = new Promise<void>((resolve) =>
      conn.once('close', () => {
        isClosed = true;
        resolve();
      }),
    );
    // A write error on a pipe whose read side is still open brings no
    // 'close' of its own, and everything below waits on 'close' (M9 fix
    // 380); the shared client destroys the socket on an error, so 'close'
    // follows and the loop goes on to its reconnect and, on ENOENT, its
    // autostart.
    conn.on('error', (err) => this.opts.log(`pipe error: ${String(err)}`));
    conn.on('bad-frame', (err) => this.opts.log(`bad frame from daemon, reconnecting: ${String(err)}`));
    conn.on('message', (m) => this.emit('message', m));

    const home = this.opts.home;
    // Wait for daemon.json before the hello (M9 fix 632, the comment at
    // DAEMON_JSON_WAIT_MS); absent by existence, so a file without a token
    // keeps the old path. A client with no home (the tests) never waits.
    if (home !== undefined && !fs.existsSync(path.join(home, 'daemon.json'))) {
      const waitMs = this.opts.daemonJsonWaitMs ?? DAEMON_JSON_WAIT_MS;
      const until = Date.now() + waitMs;
      while (!isClosed && !this.stopped && !fs.existsSync(path.join(home, 'daemon.json'))) {
        if (Date.now() >= until) {
          this.opts.log(`daemon.json still missing ${waitMs / 1000} s after connecting; saying hello without a token`);
          break;
        }
        await sleep(DAEMON_JSON_POLL_MS);
      }
      if (isClosed || this.stopped) {
        // stop()'s end() brings no close on a socket the daemon never
        // reads, so a stop during the wait destroys it.
        conn.destroy();
        await closed;
        this.conn = null;
        this.daemon = null;
        this.opts.log('disconnected from emmerd');
        this.emit('disconnected');
        return false;
      }
    }
    // The hello deadline runs from here, after the wait above.
    let helloTimer: NodeJS.Timeout | undefined;
    const helloDeadline = new Promise<never>((_, reject) => {
      const ms = this.opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
      helloTimer = setTimeout(() => reject(new Error(`hello timed out after ${ms} ms`)), ms);
    });
    // The pipe token (M9 fix 612), read off daemon.json right before the
    // hello; a client with no home (the tests) has none.
    const token = home === undefined ? undefined : readPipeToken(home);
    let retryNow = false;
    try {
      // The level this build answers at (M9 fix 582), so the daemon waits for this window's answer to every open.
      const hello = await Promise.race([this.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION, featureLevel: DAEMON_FEATURE_LEVEL, ...(token !== undefined ? { token } : {}) }), helloDeadline]);
      this.daemon = { pid: hello.daemonPid, version: hello.daemonVersion, featureLevel: hello.featureLevel ?? null, startedAt: hello.daemonStartedAt ?? null, otherHome: null, shells: hello.shells ?? [] };
      // The prefix stays as it was: install-check.mjs reads it.
      this.opts.log(`connected to emmerd ${hello.daemonVersion} pid ${hello.daemonPid} feature level ${hello.featureLevel ?? 'unknown'}`);
      const mine = this.opts.home;
      if (hello.home !== undefined && mine !== undefined && !sameHome(hello.home, mine)) {
        this.daemon.otherHome = { theirs: hello.home, mine };
        this.opts.log(`connected to a daemon on another home: ${hello.home} (mine ${mine})`);
      }
      this.emit('connected', this.daemon);
      this.resolveConnectedOnce();
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if ((code === 'token-required' || code === 'bad-token') && home !== undefined) {
        const again = readPipeToken(home);
        retryNow = again !== undefined && again !== token;
      }
      // The start race named for what it is (M9 fix 632): the old line
      // blamed the client's age.
      if (retryNow) this.opts.log('hello sent before the daemon wrote its token; retrying with it');
      else this.opts.log(`hello failed: ${String(err)}`);
      conn.destroy();
    } finally {
      clearTimeout(helloTimer);
    }

    await closed;
    this.conn = null;
    this.daemon = null;
    this.opts.log('disconnected from emmerd');
    this.emit('disconnected');
    return retryNow;
  }

  private startDaemon(attempt: number): void {
    if (!fs.existsSync(this.opts.daemonMain)) {
      this.opts.log(`daemon not built: ${this.opts.daemonMain} is missing (run npm run build at the repo root)`);
      return;
    }
    const { exe, env } = nodeCommand(this.opts.runner ?? 'node');
    this.opts.log(`starting emmerd: ${exe} ${this.opts.daemonMain} (try ${attempt})`);
    const child = spawn(exe, [this.opts.daemonMain], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    });
    child.on('error', (err) => this.opts.log(`failed to start emmerd: ${String(err)}`));
    // M9 fix 762: a lost daemon left no line in either log, and the exit
    // code tells a kill (1, a TerminateProcess) from a crash (an NTSTATUS
    // such as 0xC0000005). `>>> 0` keeps the hex right whether Node hands
    // the status over signed or unsigned.
    child.on('exit', (code, signal) => {
      if (code === null) {
        this.opts.log(`emmerd pid ${child.pid} exited: code null, signal ${signal}`);
        return;
      }
      const hex = (code >>> 0).toString(16).toUpperCase().padStart(8, '0');
      this.opts.log(`emmerd pid ${child.pid} exited: code ${code} (0x${hex}), signal ${signal}`);
      const crash = crashCode(code);
      if (crash !== null) this.emit('daemon-crashed', { pid: child.pid, code: crash });
    });
    child.unref();
  }
}

// The NTSTATUS a daemon ended on, as eight upper-case hex digits, or null
// when the code is not a crash (M9 fix 815). A JS crash, a kill and a
// failed start all exit 1, a stop 0 and a lost start race 2, so only a
// native fail-fast (0xC0000000 and up) is told apart; 0xFFFFFFFF is
// TerminateProcess(h, -1), PowerShell's Stop-Process, a kill too.
export function crashCode(code: number | null): string | null {
  if (code === null) return null;
  const u = code >>> 0;
  if (u < 0xc0000000 || u === 0xffffffff) return null;
  return u.toString(16).toUpperCase().padStart(8, '0');
}

// A string cut into pieces of at most `size` characters, never between the
// two halves of a surrogate pair, so no piece carries a lone half.
export function inputPieces(data: string, size: number): string[] {
  const pieces: string[] = [];
  let at = 0;
  while (at < data.length) {
    let end = Math.min(at + size, data.length);
    const last = data.charCodeAt(end - 1);
    if (end < data.length && end - 1 > at && last >= 0xd800 && last <= 0xdbff) end -= 1;
    pieces.push(data.slice(at, end));
    at = end;
  }
  return pieces;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
