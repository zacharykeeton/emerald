// The environment a new session gets (M9 fix 971 for its PATH, fix 996 for
// the whole of it): read from the registry at each spawn and resume as a new
// Windows Terminal tab has it, the machine's variables, then the user's, then
// the logon's volatile ones, so a tool or a variable set after the daemon
// started is in the next pane without a daemon restart. A name the registry
// does not hold keeps the daemon's value. The daemon's own environment is
// left alone.
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { Logger } from './log.ts';

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
}

export class SpawnEnv {
  private readonly log: Logger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly query: (key: string) => Promise<string>;
  private readonly now: () => number;
  private last: { layer: Record<string, string>; at: number } | null = null;
  private inFlight: Promise<Record<string, string> | null> | null = null;
  private failing = false;

  constructor(opts: SpawnEnvOptions) {
    this.log = opts.log;
    this.env = opts.env ?? process.env;
    this.query = opts.query ?? ((key) => regQuery(key, this.env));
    this.now = opts.now ?? Date.now;
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

  private async readOnce(): Promise<Record<string, string> | null> {
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
