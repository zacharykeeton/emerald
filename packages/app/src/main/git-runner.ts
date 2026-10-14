import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { GitJob, GitResult } from './git-worker.ts';

// The main process's way to run git (M9 fix 226): every call goes to the
// git worker thread (git-worker.ts), so CreateProcess never blocks the
// loop a keystroke crosses. Two reads of the same command in the same
// folder while one is in flight share its answer: the rail's status
// colours, its Changes tab and the folder headings each poll on the
// same change push, and used to spawn the same `git status` three times
// in one tick. The worker is started on the first call and unref'd, so
// an app with no repository open never has it and the app exits without
// waiting on it. A worker that dies (out of memory, a bug) fails every
// call in flight and is replaced on the next. The worker's file is the
// second entry of the main bundle (electron.vite.config.ts), beside this
// one's; the path is read when the worker starts, since the unit tests
// load this module under Node, where __dirname is not a thing.

// A git run slower than this is not worth the wait; the next poll may
// have better luck.
export const GIT_TIMEOUT_MS = 5000;
// Enough for a large tree of ignored entries; over this git is cut off
// and the answer is empty.
export const GIT_MAX_OUTPUT = 16 * 1024 * 1024;

type Waiter = { resolve: (r: string | Uint8Array | null) => void; timer: NodeJS.Timeout };

let worker: Worker | null = null;
let nextId = 1;
// Where a worker's death is written (main.log through index.ts's log);
// a broken worker answers null to every read, which is the rail with no
// colours and nothing to say why, so the line matters.
let logLine: (msg: string) => void = () => {};
export function setGitRunnerLog(fn: (msg: string) => void): void {
  logLine = fn;
}
const waiting = new Map<number, Waiter>();
const inFlight = new Map<string, Promise<string | Uint8Array | null>>();

function ensureWorker(): Worker {
  if (worker !== null) return worker;
  const w = new Worker(path.join(__dirname, 'git-worker.js'));
  w.on('message', (r: GitResult) => {
    const waiter = waiting.get(r.id);
    if (waiter === undefined) return;
    waiting.delete(r.id);
    clearTimeout(waiter.timer);
    waiter.resolve(r.ok ? r.stdout : null);
  });
  // A death fires `error` then `exit`; one line and one sweep for it
  // (M9 fix 476).
  let ended = false;
  const fail = (why: unknown) => {
    if (ended) return;
    ended = true;
    if (worker === w) worker = null;
    logLine(`git worker ended (${String(why)}); ${waiting.size} read(s) in flight answer empty, the next read starts another`);
    for (const [id, waiter] of waiting) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
      waiting.delete(id);
    }
  };
  w.on('error', (err) => fail(err));
  w.on('exit', (code) => fail(`exit ${code}`));
  w.unref();
  worker = w;
  return w;
}

function run(args: string[], cwd: string, encoding: 'utf8' | 'buffer', pipe?: { stdin: string; args: string[] }, okExits?: number[]): Promise<string | Uint8Array | null> {
  const key = `${encoding}\0${cwd}\0${args.join('\0')}${pipe === undefined ? '' : `\0|\0${pipe.args.join('\0')}\0${pipe.stdin}`}${okExits === undefined ? '' : `\0ok\0${okExits.join(',')}`}`;
  const shared = inFlight.get(key);
  if (shared !== undefined) return shared;
  const p = new Promise<string | Uint8Array | null>((resolve) => {
    const id = nextId++;
    // The worker's execFile has the same timeout; this one covers a
    // worker that never answers.
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(null);
    }, GIT_TIMEOUT_MS + 1000);
    waiting.set(id, { resolve, timer });
    const job: GitJob = { id, args, cwd, timeoutMs: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_OUTPUT, encoding, ...(pipe === undefined ? {} : { pipe }), ...(okExits === undefined ? {} : { okExits }) };
    try {
      ensureWorker().postMessage(job);
    } catch {
      waiting.delete(id);
      clearTimeout(timer);
      resolve(null);
    }
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// git's stdout as text, or null when it failed, timed out or is missing.
// okExits (M9 fix 474) names exit codes besides 0 whose stdout answers.
export const gitText = (args: string[], cwd: string, okExits?: number[]): Promise<string | null> => run(args, cwd, 'utf8', undefined, okExits) as Promise<string | null>;

// The same as bytes, for a blob that may be binary.
export const gitBytes = (args: string[], cwd: string): Promise<Uint8Array | null> => run(args, cwd, 'buffer') as Promise<Uint8Array | null>;

// Two gits in a pipe (M9 fix 304): the first run with `argsA` and fed
// `stdin`, its stdout into the second run with `argsB`, whose stdout
// comes back as text; null when either fails or the pair times out.
export const gitPipe = (argsA: string[], argsB: string[], stdin: string, cwd: string): Promise<string | null> => run(argsA, cwd, 'utf8', { stdin, args: argsB }) as Promise<string | null>;
