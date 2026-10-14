import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { GitJob, GitResult } from './git-worker.ts';

// The daemon's way to run git (M9 fix 226): every call goes to the git
// worker thread (git-worker.ts), so CreateProcess never blocks the loop
// that pty.input waits in. The worker starts on the first call and is
// unref'd, so a daemon that never reads a repository never has one and
// a stop does not wait on it; one that dies fails every call in flight
// (each answers null) and is replaced on the next. The worker's file is
// named with this module's own extension, since the suite runs the
// source under Node's type stripping and the daemon runs the build.

const workerFile = new URL(`./git-worker${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url);

type Waiter = { resolve: (out: string | null) => void; timer: NodeJS.Timeout };

let worker: Worker | null = null;
let nextId = 1;
// Where a worker's death is written (emmerd.log through main.ts); a
// broken worker answers null to every read, which is a session with no
// commits credited and nothing to say why, so the line matters.
let logLine: (msg: string) => void = () => {};
export function setGitRunnerLog(fn: (msg: string) => void): void {
  logLine = fn;
}
const waiting = new Map<number, Waiter>();

function ensureWorker(): Worker {
  if (worker !== null) return worker;
  const w = new Worker(workerFile);
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

// git's stdout, or null when it failed, timed out or is missing. okExits
// (M9 fix 320) names exit codes besides 0 whose stdout still answers;
// stdin (M9 fix 476) is fed to git.
export function gitText(args: string[], cwd: string, timeoutMs: number, okExits?: number[], stdin?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const id = nextId++;
    // The worker's execFile has the same timeout; this one covers a
    // worker that never answers.
    const timer = setTimeout(() => {
      waiting.delete(id);
      resolve(null);
    }, timeoutMs + 1000);
    timer.unref();
    waiting.set(id, { resolve, timer });
    const job: GitJob = { id, args, cwd, timeoutMs, ...(okExits === undefined ? {} : { okExits }), ...(stdin === undefined ? {} : { stdin }) };
    try {
      ensureWorker().postMessage(job);
    } catch {
      waiting.delete(id);
      clearTimeout(timer);
      resolve(null);
    }
  });
}
