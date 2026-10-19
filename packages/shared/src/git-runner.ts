import { Worker } from 'node:worker_threads';
import type { GitJob, GitResult } from './git-worker.ts';

// The one way to run git for the app's main process and the daemon (M9
// fix 226, one copy since fix 916): every call goes to the git worker
// thread (git-worker.ts), so CreateProcess never blocks the loop a
// keystroke crosses. Two identical calls while one is in flight share its
// answer: the rail's status colours, its Changes tab and the folder
// headings each poll on the same change push, and used to spawn the same
// `git status` three times in one tick. The worker is started on the first
// call and unref'd, so a process that never reads a repository never has
// one and an exit does not wait on it. A worker that dies (out of memory,
// a bug) fails every call in flight and is replaced on the next.
//
// The runner never names its worker file: each package hands it a thunk
// through setGitWorkerFile, called only when the worker starts. The app's
// main is bundled to CommonJS by electron-vite, whose asset and worker
// rewrites look for exactly `new URL(..., import.meta.url)`, so that shape
// stays out of this module; the daemon resolves the built file through
// shared's exports map.

// A git run slower than this is not worth the wait; the next poll may have
// better luck.
export const GIT_TIMEOUT_MS = 5000;
// Enough for a large tree of ignored entries, or a first-parent walk past
// 25,000 commits (Node's 1 MB default cut that to nothing, M9 fix 476);
// over this git is cut off and the answer is empty.
export const GIT_MAX_OUTPUT = 16 * 1024 * 1024;

export type GitOptions = { timeoutMs?: number; okExits?: number[]; stdin?: string; env?: Record<string, string> };

type Answer = string | Uint8Array | null;
type Waiter = { resolve: (r: Answer) => void; timer: NodeJS.Timeout };
type Flight = { cwd: string; promise: Promise<Answer> };

let worker: Worker | null = null;
let nextId = 1;
// Where a worker's death is written (main.log or emmerd.log); a broken
// worker answers null to every read, which is a rail with no colours or a
// session with no commits credited and nothing to say why, so the line
// matters.
let logLine: (msg: string) => void = () => {};
export function setGitRunnerLog(fn: (msg: string) => void): void {
  logLine = fn;
}
let workerFile: (() => string | URL) | null = null;
let noFileLogged = false;
export function setGitWorkerFile(file: () => string | URL): void {
  workerFile = file;
}
const waiting = new Map<number, Waiter>();
const inFlight = new Map<string, Flight>();

// A push (a commit, a checkout) shares only reads that started after it:
// every read in flight in that folder is forgotten, so its callers still
// get its answer and the next identical read starts its own git. Without
// this a `git log` begun a moment before a commit would be handed to the
// read the commit's push causes, and the new row would wait for the next
// poll.
export function forgetInFlight(cwd: string): void {
  for (const [key, flight] of inFlight) if (flight.cwd === cwd) inFlight.delete(key);
}

function ensureWorker(): Worker | null {
  if (worker !== null) return worker;
  let file: string | URL;
  try {
    if (workerFile === null) throw new Error('no file');
    file = workerFile();
  } catch {
    if (!noFileLogged) {
      noFileLogged = true;
      logLine('git worker has no file (setGitWorkerFile was never called); every read answers empty');
    }
    return null;
  }
  const w = new Worker(file);
  w.on('message', (r: GitResult) => {
    const waiter = waiting.get(r.id);
    if (waiter === undefined) return;
    waiting.delete(r.id);
    clearTimeout(waiter.timer);
    waiter.resolve(r.ok ? r.stdout : null);
  });
  // A death fires `error` then `exit`; one line and one sweep for it (M9
  // fix 476).
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

function run(args: string[], cwd: string, encoding: 'utf8' | 'buffer', opts: GitOptions, pipeArgs?: string[]): Promise<Answer> {
  // The timeout is not in the key: the first call's governs.
  const key = JSON.stringify([encoding, cwd, args, pipeArgs ?? null, opts.stdin ?? null, opts.okExits ?? null, opts.env ?? null]);
  const shared = inFlight.get(key);
  if (shared !== undefined) return shared.promise;
  const timeoutMs = opts.timeoutMs ?? GIT_TIMEOUT_MS;
  const promise = new Promise<Answer>((resolve) => {
    const id = nextId++;
    // The worker's execFile has the same timeout; this one covers a worker
    // that never answers.
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(null);
    }, timeoutMs + 1000);
    timer.unref();
    waiting.set(id, { resolve, timer });
    const job: GitJob = {
      id,
      args,
      cwd,
      timeoutMs,
      maxBuffer: GIT_MAX_OUTPUT,
      encoding,
      ...(opts.okExits === undefined ? {} : { okExits: opts.okExits }),
      ...(opts.stdin === undefined ? {} : { stdin: opts.stdin }),
      ...(opts.env === undefined ? {} : { env: opts.env }),
      ...(pipeArgs === undefined ? {} : { pipe: { args: pipeArgs } }),
    };
    try {
      const w = ensureWorker();
      if (w === null) throw new Error('no worker');
      w.postMessage(job);
    } catch {
      waiting.delete(id);
      clearTimeout(timer);
      resolve(null);
    }
  }).finally(() => {
    // Only this read's own entry: after forgetInFlight a newer identical
    // read may hold the key.
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
  });
  inFlight.set(key, { cwd, promise });
  return promise;
}

// git's stdout as text, or null when it failed, timed out or is missing.
// okExits names exit codes besides 0 whose stdout answers; stdin is fed to
// git; env is laid over the worker's environment.
export const gitText = (args: string[], cwd: string, opts: GitOptions = {}): Promise<string | null> => run(args, cwd, 'utf8', opts) as Promise<string | null>;

// The same as bytes, for a blob that may be binary.
export const gitBytes = (args: string[], cwd: string, opts: GitOptions = {}): Promise<Uint8Array | null> => run(args, cwd, 'buffer', opts) as Promise<Uint8Array | null>;

// Two gits in a pipe (M9 fix 304): the first run with `argsA` and fed
// `stdin`, its stdout into the second run with `argsB`, whose stdout comes
// back as text; null when either fails or the pair times out.
export const gitPipe = (argsA: string[], argsB: string[], stdin: string, cwd: string, opts: GitOptions = {}): Promise<string | null> => run(argsA, cwd, 'utf8', { ...opts, stdin }, argsB) as Promise<string | null>;
