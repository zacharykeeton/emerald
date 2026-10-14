import { execFile } from 'node:child_process';
import { parentPort } from 'node:worker_threads';

// The thread that runs git for the daemon (M9 fix 226). CreateProcess
// runs on the thread that asks for it, and under load (several Claude
// turns committing at once) one took 100 to 400 ms on this machine; the
// daemon's `git rev-list` after every PostToolUse that moved HEAD held
// its one loop, and a pty.input waiting in that queue was a keystroke the
// typist felt. Here the wait lands on this thread and the daemon's loop
// only posts and reads back. One message in, one out, matched by id;
// git-runner.ts times out on its own. The app's main process has the
// same pair (app/src/main/git-worker.ts).

export interface GitJob {
  id: number;
  args: string[];
  cwd: string;
  timeoutMs: number;
  // Exit codes besides 0 whose stdout is an answer (M9 fix 320:
  // `merge-tree --write-tree` exits 1 when the merge would conflict,
  // and the conflicted paths are what that read is for).
  okExits?: number[];
  // Fed to git's stdin (M9 fix 476: readMerges hands its hashes to
  // `rev-list --stdin`, since a long claim's hashes passed Windows'
  // 32,767-character command line).
  stdin?: string;
}

export type GitResult = { id: number; ok: true; stdout: string } | { id: number; ok: false };

// The app's worker reads up to this much; Node's 1 MB default cut a
// first-parent walk past about 25,000 commits to nothing (M9 fix 476).
const MAX_OUTPUT = 16 * 1024 * 1024;

const port = parentPort;
if (port === null) throw new Error('git-worker runs as a worker thread');
port.on('message', (job: GitJob) => {
  // execFile throws on an argument it cannot pass (a NUL, M9 fix 476),
  // and a throw here would end the thread and every read in flight with
  // it; the job alone answers not ok.
  try {
    const child = execFile('git', job.args, { cwd: job.cwd, timeout: job.timeoutMs, maxBuffer: MAX_OUTPUT, windowsHide: true }, (err, stdout) => {
      const allowed = err !== null && typeof err.code === 'number' && (job.okExits ?? []).includes(err.code);
      port.postMessage(err && !allowed ? ({ id: job.id, ok: false } satisfies GitResult) : ({ id: job.id, ok: true, stdout } satisfies GitResult));
    });
    if (job.stdin !== undefined && child.stdin !== null) {
      // A git that exits before reading it all closes the pipe; that is
      // its answer's business, not the thread's.
      child.stdin.on('error', () => {});
      child.stdin.end(job.stdin);
    }
  } catch {
    port.postMessage({ id: job.id, ok: false } satisfies GitResult);
  }
});
