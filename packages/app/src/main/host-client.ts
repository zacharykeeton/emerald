import { EventEmitter } from 'node:events';
import { spawn as spawnChild } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { Duplex } from 'node:stream';
import { DAEMON_FEATURE_LEVEL, PROTOCOL_VERSION, relayCommand } from '@emerald/shared';
import type { ClientMessage, RemoteHost, RequestType, Requests, ServerMessage, SessionInfo } from '@emerald/shared';
import { PipeClient as PipeConnection } from '@emerald/shared/pipe-client';
import type { DaemonInfo } from './pipe-client.ts';
import type { Runner } from './node-runner.ts';
import { nodeCommand } from './node-runner.ts';

// One remote host's connection (M9 fix 1081): a child `ssh` whose remote
// command is the host's `emmer relay`, its stdio carrying the same JSON
// lines the local pipe carries, spoken through the shared client. The hello
// carries no token (the relay adds the host daemon's own). Before the
// hello's reply a failure is a refusal and is not retried until connect()
// is called again; after one, a drop is retried on a backoff, each wait
// announced as lost, as main's own local reconnect does.

export type HostRefusal = { kind: 'hostkey' | 'ssh' | 'nokit'; line: string };
export type HostClientState = 'idle' | 'connecting' | 'up' | 'lost' | 'refused';

// The seconds before each retry after a drop, then RETRY_EVERY_S for good.
export const RETRY_BACKOFF_S = [2, 4, 8, 16, 32];
export const RETRY_EVERY_S = 60;
// main's own hello deadline (5 s) plus ssh's ConnectTimeout (10 s).
export const HOST_HELLO_TIMEOUT_MS = 15_000;
// How long a request on a client not up waits for it.
export const HOST_REQUEST_WAIT_MS = 10_000;
// M9 fix 1165: how long stopDaemon waits for the line to drop after the daemon took daemon.stop, above the daemon's own forced exit (stopExitGraceMs, 2 s) and its reaper (4 s).
export const HOST_STOP_DROP_MS = 10_000;
const STDERR_KEEP = 20;

export const HOST_KEY_FAILED = 'Host key verification failed.';

export type SpawnFn = (exe: string, args: readonly string[], opts: SpawnOptions) => ChildProcess;

export interface HostClientOptions {
  host: RemoteHost;
  runner: Runner;
  log: (msg: string) => void;
  // For the unit: a fake child and a fake clock.
  spawn?: SpawnFn;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  helloTimeoutMs?: number;
}

// The exe, the words before ssh's own and the environment for an ssh or
// scp override: unset is the system's `ssh`; a value ending .mjs or .js
// runs under Node with the script first (the verify's stubs); anything
// else is the exe itself.
export function sshCommand(value: string | undefined, runner: Runner, fallback = 'ssh'): { exe: string; prefix: string[]; env: NodeJS.ProcessEnv } {
  if (value === undefined || value === '') return { exe: fallback, prefix: [], env: { ...process.env } };
  if (/\.(mjs|js)$/i.test(value)) {
    const node = nodeCommand(runner);
    return { exe: node.exe, prefix: [value], env: node.env };
  }
  return { exe: value, prefix: [], env: { ...process.env } };
}

// What ssh is given: a config host by its name, so ssh reads its own config
// for it; an added one by the destination typed.
export function sshTarget(host: RemoteHost): string {
  return host.source === 'config' ? host.name : host.destination;
}

// ssh's argv for the relay: the options, the target, then the relay's words.
export function relayArgs(host: RemoteHost & { home: string; shell: 'powershell' | 'sh'; nodeVersion: string; kitVersion: string }): string[] {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', sshTarget(host), ...relayCommand(host)];
}

// The refusal an ssh exit before the hello's reply means: 255 with the key
// line is an unknown or changed host key; any other 255 is ssh's own
// failure (a refused connection, a refused login); anything else is the
// remote command not found, so no kit there.
export function refusalOf(code: number | null, lastLine: string | null): HostRefusal {
  const line = lastLine ?? (code === null ? 'no answer' : `exit ${code}`);
  if (code === 255 && lastLine === HOST_KEY_FAILED) return { kind: 'hostkey', line };
  if (code === 255) return { kind: 'ssh', line };
  return { kind: 'nokit', line };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Attempt = { kind: 'refused'; refusal: HostRefusal } | { kind: 'dropped' } | { kind: 'stopped' };

export class HostClient extends EventEmitter {
  readonly name: string;
  private host: RemoteHost;
  private readonly opts: HostClientOptions;
  private conn: PipeConnection | null = null;
  private child: ChildProcess | null = null;
  private running = false;
  private stopped = false;
  private quietStop = false;
  private runDone: Promise<void> = Promise.resolve();
  private cutWait: (() => void) | null = null;
  state: HostClientState = 'idle';
  daemon: DaemonInfo | null = null;
  since = Date.now();
  retryIn: number | null = null;
  refusal: HostRefusal | null = null;

  constructor(opts: HostClientOptions) {
    super();
    this.opts = opts;
    this.host = opts.host;
    this.name = opts.host.name;
  }

  // The record main merged last; a setup that wrote the kit's facts hands
  // the new one in before the next connect.
  setHost(host: RemoteHost): void {
    this.host = host;
  }

  get record(): RemoteHost {
    return this.host;
  }

  // Starts contact when idle or refused; resolves once the client is up or
  // refused (a refusal is in the events, not a rejection). On a lost client
  // it cuts the wait and resolves at the next state it reaches.
  connect(): Promise<void> {
    if (this.state === 'up') return Promise.resolve();
    const settled = new Promise<void>((resolve) => {
      const done = (): void => {
        this.off('connected', done);
        this.off('refused', done);
        this.off('lost', done);
        resolve();
      };
      this.once('connected', done);
      this.once('refused', done);
      if (this.state === 'lost') this.once('lost', done);
    });
    if (this.state === 'lost') this.tryNow();
    else if (!this.running) {
      this.stopped = false;
      this.runDone = this.run();
    }
    return settled;
  }

  // Cuts a lost client's wait.
  tryNow(): void {
    const cut = this.cutWait;
    this.cutWait = null;
    cut?.();
  }

  // Kills the child and its tree (the relay under ssh goes too) and
  // retries no more.
  stop(): void {
    this.stopped = true;
    this.tryNow();
    this.killChild();
    this.conn?.destroy();
  }

  // M9 fix 1165: asks the host's daemon to stop over this line and waits
  // for the line to drop, leaving the client idle with nothing announced,
  // so the caller's next connect() starts afresh and the relay, finding no
  // daemon, starts the kit's own. Resolves with the screens the daemon
  // kept; rejects when not up or when the daemon refuses. A daemon that
  // takes the request and keeps the line past HOST_STOP_DROP_MS has the
  // line cut here; the next connect meets it again.
  async stopDaemon(): Promise<number> {
    if (!(this.state === 'up' && this.conn !== null && this.daemon !== null)) throw new Error(`${this.name} is not up`);
    const pid = this.daemon.pid;
    this.opts.log(`host ${this.name}: asking emmerd pid ${pid} to stop`);
    const { kept } = await this.conn.request('daemon.stop', {});
    // The reply precedes the drop on the one stream, so a drop before the
    // reply is a real loss and is announced as one.
    this.quietStop = true;
    const timedOut = await Promise.race([this.runDone.then(() => false), (this.opts.sleep ?? defaultSleep)(HOST_STOP_DROP_MS).then(() => true)]);
    if (timedOut && this.running) {
      this.opts.log(`host ${this.name}: emmerd pid ${pid} took daemon.stop and kept the line ${HOST_STOP_DROP_MS / 1000} s; cutting it`);
      this.killChild();
      this.conn?.destroy();
      await this.runDone;
    }
    this.opts.log(`host ${this.name}: emmerd pid ${pid} kept ${kept} screen${kept === 1 ? '' : 's'} and stopped`);
    return kept;
  }

  request<K extends RequestType>(type: K, body: Requests[K]['req']): Promise<Requests[K]['res']> {
    if (this.state === 'up' && this.conn !== null) return this.conn.request(type, body);
    if (this.state === 'refused' && this.refusal !== null) return Promise.reject(new Error(this.refusal.line));
    if (this.state === 'idle') void this.connect();
    const lost = this.state === 'lost';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${this.name} did not answer`));
      }, HOST_REQUEST_WAIT_MS);
      const onUp = (): void => {
        cleanup();
        if (this.conn === null) reject(new Error(`${this.name} did not answer`));
        else this.conn.request(type, body).then(resolve, reject);
      };
      const onRefused = (r: HostRefusal): void => {
        cleanup();
        reject(new Error(r.line));
      };
      const onLost = (): void => {
        cleanup();
        reject(new Error(`${this.name} is unreachable`));
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        this.off('connected', onUp);
        this.off('refused', onRefused);
        this.off('lost', onLost);
      };
      this.once('connected', onUp);
      this.once('refused', onRefused);
      // M9 fix 1095: a lost client is tried at once, and the request settles at that try: through on connected, unreachable at the next lost; the timer stays as the upper bound.
      if (lost) {
        this.once('lost', onLost);
        this.tryNow();
      }
    });
  }

  // pty.input and pty.resize; dropped while the line is down, as typing
  // into a pane whose local daemon is gone is.
  send(msg: ClientMessage): void {
    if (this.state === 'up' && this.conn !== null) this.conn.send(msg);
  }

  private setState(state: HostClientState): void {
    this.state = state;
    this.since = Date.now();
  }

  private async run(): Promise<void> {
    this.running = true;
    let lostAt: number | null = null;
    let tries = 0;
    try {
      while (!this.stopped) {
        if (lostAt === null) {
          this.setState('connecting');
          this.refusal = null;
          this.retryIn = null;
          this.emit('connecting');
        }
        const outcome = await this.attempt(() => {
          lostAt = null;
          tries = 0;
        });
        if (outcome.kind === 'stopped' || this.stopped) return;
        // M9 fix 1165: a drop stopDaemon asked for ends the run quietly: idle, no disconnected, no lost, no retry.
        if (this.quietStop) {
          this.quietStop = false;
          this.daemon = null;
          this.retryIn = null;
          this.setState('idle');
          return;
        }
        if (outcome.kind === 'refused') {
          // Before any hello, or a changed key while lost: refused, never
          // retried blindly. ssh and nokit while lost wait on.
          if (lostAt === null || outcome.refusal.kind === 'hostkey') {
            this.daemon = null;
            this.refusal = outcome.refusal;
            this.retryIn = null;
            this.setState('refused');
            this.opts.log(`host ${this.name}: refused (${outcome.refusal.kind}): ${outcome.refusal.line}`);
            this.emit('refused', outcome.refusal);
            return;
          }
          this.opts.log(`host ${this.name}: still lost (${outcome.refusal.kind}): ${outcome.refusal.line}`);
        }
        if (outcome.kind === 'dropped' && lostAt === null) {
          lostAt = Date.now();
          this.daemon = null;
          this.emit('disconnected');
        }
        if (lostAt === null) lostAt = Date.now();
        const retryIn = RETRY_BACKOFF_S[tries] ?? RETRY_EVERY_S;
        tries++;
        this.retryIn = retryIn;
        this.state = 'lost';
        this.since = lostAt;
        this.opts.log(`host ${this.name}: lost, trying again in ${retryIn} s`);
        this.emit('lost', { at: lostAt, retryIn });
        await this.wait(retryIn * 1000);
      }
    } finally {
      this.running = false;
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        this.cutWait = null;
        resolve();
      };
      this.cutWait = finish;
      void (this.opts.sleep ?? defaultSleep)(ms).then(finish);
    });
  }

  private killChild(): void {
    const child = this.child;
    if (child === null || child.exitCode !== null || child.pid === undefined) return;
    if (process.platform === 'win32' && this.opts.spawn === undefined) {
      // As main's own killIfSame: async, so the main process never blocks.
      spawnChild('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true }).on('error', (err) => this.opts.log(`taskkill failed: ${String(err)}`));
    } else {
      child.kill();
    }
  }

  private async attempt(onUp: () => void): Promise<Attempt> {
    const h = this.host;
    if (h.home === undefined || h.shell === undefined || h.nodeVersion === undefined || h.kitVersion === undefined) {
      return { kind: 'refused', refusal: { kind: 'nokit', line: `emerald is not set up on ${this.name} yet` } };
    }
    const env = this.opts.env ?? process.env;
    const cmd = sshCommand(env['EMERALD_SSH'], this.opts.runner);
    const args = [...cmd.prefix, ...relayArgs({ ...h, home: h.home, shell: h.shell, nodeVersion: h.nodeVersion, kitVersion: h.kitVersion })];
    const spawn = this.opts.spawn ?? spawnChild;
    let child: ChildProcess;
    try {
      child = spawn(cmd.exe, args, { windowsHide: true, stdio: 'pipe', env: cmd.env });
    } catch (err) {
      return { kind: 'refused', refusal: { kind: 'ssh', line: (err as Error).message } };
    }
    this.child = child;
    const stderr: string[] = [];
    let partial = '';
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (d: string) => {
      partial += d;
      const lines = partial.split('\n');
      partial = lines.pop() ?? '';
      for (const l of lines) {
        const t = l.replace(/\r$/, '').trim();
        if (t === '') continue;
        stderr.push(t);
        if (stderr.length > STDERR_KEEP) stderr.shift();
      }
    });
    const lastLine = (): string | null => {
      const tail = partial.replace(/\r$/, '').trim();
      return tail !== '' ? tail : (stderr[stderr.length - 1] ?? null);
    };
    let spawnError: Error | null = null;
    const exited = new Promise<number | null>((resolve) => {
      child.once('error', (err) => {
        spawnError = err;
        resolve(null);
      });
      child.once('exit', (code) => resolve(code));
    });
    const stdout = child.stdout;
    const stdin = child.stdin;
    if (stdout === null || stdin === null) {
      this.killChild();
      return { kind: 'refused', refusal: { kind: 'ssh', line: 'ssh gave no stdio' } };
    }
    const conn = PipeConnection.over(Duplex.from({ readable: stdout, writable: stdin }), `ssh ${this.name}`);
    const closed = new Promise<void>((resolve) => conn.once('close', () => resolve()));
    conn.on('error', (err: Error) => this.opts.log(`host ${this.name}: line error: ${err.message}`));
    conn.on('bad-frame', (err: Error) => this.opts.log(`host ${this.name}: bad frame, dropping the line: ${err.message}`));
    conn.on('message', (m: ServerMessage) => this.emit('message', m));
    // Whatever the composed stream makes of the exit, the shared client's
    // close settles what is pending.
    void exited.then(() => conn.destroy());
    let timer: NodeJS.Timeout | undefined;
    const deadlineMs = this.opts.helloTimeoutMs ?? HOST_HELLO_TIMEOUT_MS;
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(() => resolve('deadline'), deadlineMs);
    });
    let hello: Requests['hello']['res'];
    try {
      const raced = await Promise.race([conn.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION, featureLevel: DAEMON_FEATURE_LEVEL }), deadline]);
      if (raced === 'deadline') throw new Error(`hello timed out after ${deadlineMs / 1000} s`);
      hello = raced;
    } catch (err) {
      clearTimeout(timer);
      if (this.stopped) {
        this.killChild();
        return { kind: 'stopped' };
      }
      // The exit says why; a hello that timed out on a live child kills it.
      const code = await Promise.race([exited, new Promise<'alive'>((r) => setTimeout(() => r('alive'), 1000))]);
      if (code === 'alive') {
        this.killChild();
        conn.destroy();
        return { kind: 'refused', refusal: { kind: 'ssh', line: lastLine() ?? (err as Error).message } };
      }
      if (spawnError !== null) return { kind: 'refused', refusal: { kind: 'ssh', line: (spawnError as Error).message } };
      return { kind: 'refused', refusal: refusalOf(code, lastLine()) };
    }
    clearTimeout(timer);
    try {
      await conn.request('subscribe', { topics: ['sessions'] });
      const listed = await conn.request('session.list', { removed: true });
      this.conn = conn;
      this.daemon = {
        pid: hello.daemonPid,
        version: hello.daemonVersion,
        featureLevel: hello.featureLevel ?? null,
        startedAt: hello.daemonStartedAt ?? null,
        otherHome: null,
        shells: hello.shells ?? [],
        claude: hello.claude ?? null,
      };
      this.refusal = null;
      this.retryIn = null;
      this.setState('up');
      onUp();
      this.opts.log(`host ${this.name}: connected to emmerd ${hello.daemonVersion} pid ${hello.daemonPid} feature level ${hello.featureLevel ?? 'unknown'}`);
      const sessions: SessionInfo[] = listed.sessions;
      this.emit('connected', this.daemon, sessions);
    } catch (err) {
      this.opts.log(`host ${this.name}: the first list failed: ${(err as Error).message}`);
      conn.destroy();
    }
    await closed;
    this.conn = null;
    this.killChild();
    if (this.stopped) return { kind: 'stopped' };
    if (this.state !== 'up') {
      const code = await Promise.race([exited, new Promise<null>((r) => setTimeout(() => r(null), 1000))]);
      return { kind: 'refused', refusal: refusalOf(code, lastLine()) };
    }
    this.opts.log(`host ${this.name}: the line dropped${lastLine() !== null ? `: ${lastLine()}` : ''}`);
    return { kind: 'dropped' };
  }
}
