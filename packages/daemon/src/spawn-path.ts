// The environment a new session gets (M9 fix 971 for its PATH, fix 996 for
// the whole of it): read from the registry at each spawn and resume as a new
// Windows Terminal tab has it, the machine's variables, then the user's, then
// the logon's volatile ones, so a tool or a variable set after the daemon
// started is in the next pane without a daemon restart. A name the registry
// does not hold keeps the daemon's value. The daemon's own environment is
// left alone.
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { killTree } from '@emerald/shared/process-identity';
import type { Logger } from './log.ts';
import { loginShell } from './shells.ts';

export const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
export const USER_KEY = 'HKCU\\Environment';
// The logon's own variables: without it the machine key's USERNAME=SYSTEM
// would be every session's.
export const VOLATILE_KEY = 'HKCU\\Volatile Environment';
// A read held longer than this counts as failed; the session then gets the
// daemon's own environment rather than waiting.
export const REG_TIMEOUT_MS = 3000;
// A good read finished within this many ms of a later spawn is reused, so a
// burst of resumes makes one set of reads; a change made more than two
// seconds before a spawn is always seen.
export const REUSE_MS = 2000;
// How long an app's hello waits on a read before it answers the shells it
// holds (M9 fix 996); a read that lands later refreshes them for the next.
export const HELLO_WAIT_MS = 500;

// Off Windows (M9 fix 1019) the layer is the login shell's environment: a
// run held longer than LOGIN_TIMEOUT_MS fails, a good read is reused for
// LOGIN_REUSE_MS, and the names below are the shell's own bookkeeping and
// the read's own variable, none of which a session should inherit from it.
export const LOGIN_TIMEOUT_MS = 3000;
export const LOGIN_REUSE_MS = 30_000;
export const LOGIN_DROPPED: ReadonlySet<string> = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'ELECTRON_RUN_AS_NODE']);

// zsh, bash and fish read their rc files only when interactive, which is
// where a dev's PATH lines usually are.
export function loginShellArgs(shell: string, command: string): string[] {
  const base = path.basename(shell);
  return base === 'zsh' || base === 'bash' || base === 'fish' ? ['-i', '-l', '-c', command] : ['-l', '-c', command];
}

// The command the login shell runs: the daemon's own executable as node
// (ELECTRON_RUN_AS_NODE in the packaged app) printing the environment
// between two copies of the mark. Null when the path holds a single quote,
// which the read counts as a failure.
export function loginShellCommand(execPath: string, mark: string): string | null {
  if (execPath.includes("'")) return null;
  return `'${execPath}' -e 'process.stdout.write(process.argv[1]+JSON.stringify(process.env)+process.argv[1])' ${mark}`;
}

// The text between the first and the second mark, as an environment: every
// string value but the dropped names. Null when a mark is missing, the text
// does not parse, or it is not an object.
export function parseLoginEnv(out: string, mark: string): Record<string, string> | null {
  const start = out.indexOf(mark);
  if (start < 0) return null;
  const end = out.indexOf(mark, start + mark.length);
  if (end < 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(out.slice(start + mark.length, end));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && !LOGIN_DROPPED.has(k)) env[k] = v;
  return env;
}

// reg.exe by its full path, never off the PATH this module is rebuilding.
// The whole key is queried: it costs the same as one value, and every value
// of it is wanted.
export function regQuery(key: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const reg = path.join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'reg.exe');
  return new Promise((resolve, reject) => {
    execFile(reg, ['query', key], { windowsHide: true, timeout: REG_TIMEOUT_MS, encoding: 'utf8' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export interface RegValue {
  // The spelling reg.exe printed; the map is keyed by the upper case.
  name: string;
  type: string;
  value: string;
}

// `    Path    REG_EXPAND_SZ    C:\a;%USERPROFILE%\b`, keyed by the name
// upper-cased; the header line, a subkey's line and the blank lines match
// nothing.
export function parseRegQuery(out: string): Map<string, RegValue> {
  const values = new Map<string, RegValue>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (m === null) continue;
    values.set(m[1]!.toUpperCase(), { name: m[1]!, type: m[2]!, value: m[3] ?? '' });
  }
  return values;
}

const VAR = /%([^%]+)%/g;
// Joined across the keys rather than replaced, as Windows does.
const PATH_LIKE = new Set(['PATH', 'LIBPATH', 'OS2LIBPATH']);

// The layer of every variable the three keys hold, laid over the daemon's
// environment by withRegistry; null when the machine key has no Path, which
// no working Windows has. Windows Terminal's order (til/env.h's
// regenerate()): key by key, within a key the REG_SZ values, then the
// REG_EXPAND_SZ ones expanded one level against what is built so far, a name
// not there left as written. Different from the Terminal: the path-like
// names go last in a key, so a user Path naming a %JAVA_HOME% of the same
// key is expanded whatever order reg.exe prints (fix 971), and their entries
// empty after a trim are dropped. Every type but those two is skipped.
export function registryEnv(
  machine: Map<string, RegValue>,
  user: Map<string, RegValue>,
  volatile: Map<string, RegValue>,
  base: NodeJS.ProcessEnv,
): Record<string, string> | null {
  if (!machine.has('PATH')) return null;
  const working = new Map<string, string>();
  for (const [k, v] of Object.entries(base)) if (v !== undefined) working.set(k.toUpperCase(), v);
  const layer = new Map<string, { name: string; value: string }>();
  const expand = (value: string): string => value.replace(VAR, (whole, name: string) => working.get(name.toUpperCase()) ?? whole);
  const set = (upper: string, name: string, value: string): void => {
    working.set(upper, value);
    layer.set(upper, { name: upper === 'PATH' ? 'Path' : name, value });
  };
  for (const [index, key] of [machine, user, volatile].entries()) {
    const values = [...key.entries()];
    for (const [upper, v] of values) if (v.type === 'REG_SZ' && !PATH_LIKE.has(upper)) set(upper, v.name, v.value);
    for (const [upper, v] of values) if (v.type === 'REG_EXPAND_SZ' && !PATH_LIKE.has(upper)) set(upper, v.name, expand(v.value));
    for (const [upper, v] of values) {
      if (!PATH_LIKE.has(upper) || (v.type !== 'REG_SZ' && v.type !== 'REG_EXPAND_SZ')) continue;
      const entries = expand(v.value).split(';').filter((e) => e.trim() !== '');
      const before = index === 0 ? undefined : layer.get(upper)?.value;
      set(upper, v.name, [...(before === undefined || before === '' ? [] : [before]), ...entries].join(';'));
    }
  }
  return Object.fromEntries([...layer.values()].map(({ name, value }) => [name, value]));
}

// The base without its undefined values, each layer name's every spelling
// dropped and the layer's set: the block is read case-blind, so two
// spellings would leave either.
export function withRegistry(base: NodeJS.ProcessEnv, layer: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  for (const [name, value] of Object.entries(layer)) {
    const upper = name.toUpperCase();
    for (const k of Object.keys(env)) if (k.toUpperCase() === upper) delete env[k];
    env[name] = value;
  }
  return env;
}

export interface SpawnEnvOptions {
  log: Logger;
  env?: NodeJS.ProcessEnv;
  query?: (key: string) => Promise<string>;
  now?: () => number;
  // The platform whose read runs (M9 fix 1016), process.platform when
  // absent: the registry on win32, the login shell off it.
  platform?: NodeJS.Platform;
  // The test's stand-in for the login shell's run (M9 fix 1019): the
  // stdout as text for the read's mark.
  shellRead?: (mark: string) => Promise<string>;
}

export class SpawnEnv {
  private readonly log: Logger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly query: (key: string) => Promise<string>;
  private readonly now: () => number;
  private readonly platform: NodeJS.Platform;
  private readonly shellRead: (mark: string) => Promise<string>;
  private last: { layer: Record<string, string>; at: number } | null = null;
  // The login shell's last good read (M9 fix 1019), kept past a failure.
  private loginLast: { layer: Record<string, string>; at: number } | null = null;
  private inFlight: Promise<Record<string, string> | null> | null = null;
  private failing = false;

  constructor(opts: SpawnEnvOptions) {
    this.log = opts.log;
    this.env = opts.env ?? process.env;
    this.query = opts.query ?? ((key) => regQuery(key, this.env));
    this.now = opts.now ?? Date.now;
    this.platform = opts.platform ?? process.platform;
    this.shellRead = opts.shellRead ?? ((mark) => this.defaultShellRead(mark));
  }

  // Never rejects: a failed read answers null, the session keeps the
  // daemon's environment, and the next spawn tries again.
  read(): Promise<Record<string, string> | null> {
    if (this.last !== null && this.now() - this.last.at <= REUSE_MS) return Promise.resolve(this.last.layer);
    if (this.inFlight !== null) return this.inFlight;
    const reading = this.readOnce().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = reading;
    return reading;
  }

  private readOnce(): Promise<Record<string, string> | null> {
    return this.platform === 'win32' ? this.readRegistry() : this.readLoginShell();
  }

  // There is no registry off Windows (M9 fix 1016); the login shell's
  // environment is read instead (M9 fix 1019), so a Mac app started from
  // Finder, whose PATH is launchd's, still finds a claude from npm or
  // Homebrew. A good read is kept LOGIN_REUSE_MS; a failure answers the last
  // good read whatever its age, or null when there has been none, so a slow
  // or broken profile costs at most one LOGIN_TIMEOUT_MS wait per reuse
  // window and never the PATH a session had a minute ago.
  private async readLoginShell(): Promise<Record<string, string> | null> {
    if (this.loginLast !== null && this.now() - this.loginLast.at < LOGIN_REUSE_MS) return this.loginLast.layer;
    const mark = randomUUID().replace(/-/g, '');
    try {
      const layer = parseLoginEnv(await this.shellRead(mark), mark);
      if (layer === null) throw new Error('the login shell printed no environment between the marks');
      this.loginLast = { layer, at: this.now() };
      if (this.failing) {
        this.failing = false;
        this.log.info('spawn env: the login shell read again');
      }
      return layer;
    } catch (err) {
      if (!this.failing) {
        this.failing = true;
        this.log.warn("spawn env: the login shell read failed, sessions get the last good read or the daemon's own environment until it reads again", {
          shell: loginShell(this.env),
          err: err instanceof Error ? err.message : String(err),
        });
      }
      return this.loginLast?.layer ?? null;
    }
  }

  // The login shell run once (M9 fix 1019): its whole environment printed
  // as JSON between two marks by the daemon's own executable as node, since
  // a profile's banner or a distro's hint can write to stdout before it.
  private defaultShellRead(mark: string): Promise<string> {
    const shell = loginShell(this.env);
    const command = loginShellCommand(process.execPath, mark);
    if (command === null) return Promise.reject(new Error(`the daemon's path holds a quote: ${process.execPath}`));
    return new Promise((resolve, reject) => {
      // Its own session (detached), so an interactive shell never takes a
      // terminal's process group from a daemon run in the foreground.
      const child = spawn(shell, loginShellArgs(shell, command), {
        env: { ...this.env, ELECTRON_RUN_AS_NODE: '1' },
        cwd: os.homedir(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let settled = false;
      child.stdout!.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
      });
      // bash -i with no tty writes its job control notes here; dropped.
      child.stderr!.on('data', () => {});
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // killTree, not process.kill(-pid): the daemon's kill guard refuses
        // any pid at or under 0 (kill-guard.ts).
        if (child.pid !== undefined) killTree(child.pid);
        reject(new Error(`timed out after ${LOGIN_TIMEOUT_MS} ms`));
      }, LOGIN_TIMEOUT_MS);
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0 && !out.includes(mark)) reject(new Error(`the login shell exited ${code}`));
        else resolve(out);
      });
    });
  }

  private async readRegistry(): Promise<Record<string, string> | null> {
    try {
      // Every query wrapped so one that throws synchronously is a failed
      // read too.
      const outs = await Promise.all([MACHINE_KEY, USER_KEY, VOLATILE_KEY].map((k) => Promise.resolve().then(() => this.query(k))));
      // reg.exe writes in the console's code page; a non-ASCII entry would
      // otherwise come through mangled.
      if (outs.some((o) => o.includes('\uFFFD'))) throw new Error('reg.exe output is not UTF-8');
      const [machine, user, volatile] = outs.map(parseRegQuery);
      const layer = registryEnv(machine!, user!, volatile!, this.env);
      if (layer === null) throw new Error('the machine key has no Path value');
      this.last = { layer, at: this.now() };
      if (this.failing) {
        this.failing = false;
        this.log.info('spawn env: the registry read again');
      }
      return layer;
    } catch (err) {
      this.last = null;
      if (!this.failing) {
        this.failing = true;
        this.log.warn("spawn env: the registry read failed, sessions get the daemon's own environment until it reads again", { err: err instanceof Error ? err.message : String(err) });
      }
      return null;
    }
  }
}
