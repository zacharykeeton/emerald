// The PATH a new session gets (M9 fix 971): read from the registry at each
// spawn and resume, the machine's then the user's, as a new Windows Terminal
// tab has it, so a tool installed after the daemon started is found in the
// next pane without a daemon restart. The daemon's own PATH is left alone.
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { Logger } from './log.ts';

export const MACHINE_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment';
export const USER_KEY = 'HKCU\\Environment';
// A read held longer than this counts as failed; the session then gets the
// daemon's own PATH rather than waiting.
export const REG_TIMEOUT_MS = 3000;
// A good read finished within this many ms of a later spawn is reused, so a
// burst of resumes makes one pair of reads; a change made more than two
// seconds before a spawn is always seen.
export const REUSE_MS = 2000;

// reg.exe by its full path, never off the PATH this module is rebuilding.
// The whole key is queried, not `/v Path`: it costs the same, a missing
// value is then not an error, and the key's other values are there for the
// expansion.
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
  type: string;
  value: string;
}

// `    Path    REG_EXPAND_SZ    C:\a;%USERPROFILE%\b`, keyed by the name
// upper-cased; the header line and the blank lines match nothing.
export function parseRegQuery(out: string): Map<string, RegValue> {
  const values = new Map<string, RegValue>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (m === null) continue;
    values.set(m[1]!.toUpperCase(), { type: m[2]!, value: m[3] ?? '' });
  }
  return values;
}

function lookupEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const upper = name.toUpperCase();
  for (const [k, v] of Object.entries(env)) if (k.toUpperCase() === upper && v !== undefined) return v;
  return undefined;
}

const VAR = /%([^%]+)%/g;

function expandAgainstEnv(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(VAR, (whole, name: string) => lookupEnv(env, name) ?? whole);
}

// One key's Path, split. A REG_EXPAND_SZ value takes each %NAME% from the
// user key, then the machine key, then the daemon's environment; a value
// found in a key that is itself REG_EXPAND_SZ (a JAVA_HOME of
// %ProgramFiles%\Java) is expanded against the environment alone first, one
// level. A name found nowhere stays as written, as Windows leaves it.
function pathEntries(own: RegValue | undefined, machine: Map<string, RegValue>, user: Map<string, RegValue>, env: NodeJS.ProcessEnv): string[] {
  if (own === undefined) return [];
  let value = own.value;
  if (own.type === 'REG_EXPAND_SZ') {
    value = value.replace(VAR, (whole, name: string) => {
      const found = user.get(name.toUpperCase()) ?? machine.get(name.toUpperCase());
      if (found !== undefined) return found.type === 'REG_EXPAND_SZ' ? expandAgainstEnv(found.value, env) : found.value;
      return lookupEnv(env, name) ?? whole;
    });
  }
  return value.split(';').filter((e) => e.trim() !== '');
}

// Machine entries then user entries, duplicates kept; null when the machine
// key has no Path, which no working Windows has.
export function registryPath(machine: Map<string, RegValue>, user: Map<string, RegValue>, env: NodeJS.ProcessEnv): string | null {
  const machinePath = machine.get('PATH');
  if (machinePath === undefined) return null;
  return [...pathEntries(machinePath, machine, user, env), ...pathEntries(user.get('PATH'), machine, user, env)].join(';');
}

export interface SpawnPathOptions {
  log: Logger;
  env?: NodeJS.ProcessEnv;
  query?: (key: string) => Promise<string>;
  now?: () => number;
}

export class SpawnPath {
  private readonly log: Logger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly query: (key: string) => Promise<string>;
  private readonly now: () => number;
  private last: { path: string; at: number } | null = null;
  private inFlight: Promise<string | null> | null = null;
  private failing = false;

  constructor(opts: SpawnPathOptions) {
    this.log = opts.log;
    this.env = opts.env ?? process.env;
    this.query = opts.query ?? ((key) => regQuery(key, this.env));
    this.now = opts.now ?? Date.now;
  }

  // Never rejects: a failed read answers null, the session keeps the
  // daemon's PATH, and the next spawn tries again.
  read(): Promise<string | null> {
    if (this.last !== null && this.now() - this.last.at <= REUSE_MS) return Promise.resolve(this.last.path);
    if (this.inFlight !== null) return this.inFlight;
    const reading = this.readOnce().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = reading;
    return reading;
  }

  private async readOnce(): Promise<string | null> {
    try {
      // Both queries wrapped so a query that throws synchronously is a
      // failed read too.
      const [machineOut, userOut] = await Promise.all([MACHINE_KEY, USER_KEY].map((k) => Promise.resolve().then(() => this.query(k))));
      // reg.exe writes in the console's code page; a non-ASCII entry would
      // otherwise come through mangled.
      if (machineOut!.includes('\uFFFD') || userOut!.includes('\uFFFD')) throw new Error('reg.exe output is not UTF-8');
      const p = registryPath(parseRegQuery(machineOut!), parseRegQuery(userOut!), this.env);
      if (p === null) throw new Error('the machine key has no Path value');
      this.last = { path: p, at: this.now() };
      if (this.failing) {
        this.failing = false;
        this.log.info('spawn PATH: the registry read again');
      }
      return p;
    } catch (err) {
      this.last = null;
      if (!this.failing) {
        this.failing = true;
        this.log.warn("spawn PATH: the registry read failed, sessions get the daemon's own PATH until it reads again", { err: err instanceof Error ? err.message : String(err) });
      }
      return null;
    }
  }
}
