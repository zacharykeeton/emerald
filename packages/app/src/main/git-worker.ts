import { execFile, spawn } from 'node:child_process';
import type { SpawnOptionsWithStdioTuple, StdioNull, StdioPipe } from 'node:child_process';
import { parentPort, type MessagePort } from 'node:worker_threads';

// The thread that runs git for the main process (M9 fix 226). A child
// process is started with CreateProcess on the thread that asks for it,
// and under load (several Claude turns, each redrawing and committing)
// one took 100 to 400 ms on this machine; the main process spawned git
// two or three times a second for the rail's colours and its Changes
// tab, and every keystroke and its echo cross the main process, so the
// typist felt each spawn. Here the wait lands on this thread's loop
// and the main thread only posts and reads back. One message in, one
// out, matched by id; the caller (git-runner.ts) times out on its own.
// A job with `pipe` (M9 fix 304) is two gits: the first fed `stdin`,
// its stdout into the second's stdin, the second's stdout the answer,
// which is how the graph's patch ids are read (`diff-tree -p --stdin`
// into `patch-id --stable`) without the diffs crossing to the main
// thread.

export interface GitJob {
  id: number;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxBuffer: number;
  // 'buffer' hands the bytes back untouched for `git show`; text is utf8.
  encoding: 'utf8' | 'buffer';
  pipe?: { stdin: string; args: string[] };
  // Exit codes besides 0 whose stdout is an answer, as the daemon's
  // worker takes (M9 fix 474: `diff --no-index` exits 1 when the files
  // differ, which for an untracked file's count is always).
  okExits?: number[];
}

export type GitResult = { id: number; ok: true; stdout: string | Uint8Array } | { id: number; ok: false };

const port = parentPort;
if (port === null) throw new Error('git-worker runs as a worker thread');
port.on('message', (job: GitJob) => {
  // A spawn throws on an argument it cannot pass (a NUL in a `rel` the
  // renderer handed to gitShow, M9 fix 476), and a throw here would end
  // the thread and every read in flight with it; the job alone answers
  // not ok.
  try {
    runJob(port, job);
  } catch {
    port.postMessage({ id: job.id, ok: false } satisfies GitResult);
  }
});

function runJob(port: MessagePort, job: GitJob): void {
  const opts = { cwd: job.cwd, timeout: job.timeoutMs, maxBuffer: job.maxBuffer, windowsHide: true };
  if (job.pipe !== undefined) {
    runPipe(port, job, job.pipe);
    return;
  }
  if (job.encoding === 'buffer') {
    execFile('git', job.args, { ...opts, encoding: 'buffer' }, (err, stdout) => {
      if (err) port.postMessage({ id: job.id, ok: false } satisfies GitResult);
      else {
        const bytes = new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.byteLength);
        port.postMessage({ id: job.id, ok: true, stdout: bytes } satisfies GitResult);
      }
    });
    return;
  }
  execFile('git', job.args, opts, (err, stdout) => {
    const allowed = err !== null && typeof err.code === 'number' && (job.okExits ?? []).includes(err.code);
    port.postMessage(err && !allowed ? ({ id: job.id, ok: false } satisfies GitResult) : ({ id: job.id, ok: true, stdout } satisfies GitResult));
  });
}

// The two-git job: any failure (either exits non-zero, the timeout, the
// output over the cap) answers not ok, as a single git's does; the
// timeout kills both.
function runPipe(port: MessagePort, job: GitJob, pipe: { stdin: string; args: string[] }): void {
  const spawnOpts: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioNull> = { cwd: job.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] };
  const first = spawn('git', job.args, spawnOpts);
  let second: typeof first;
  try {
    second = spawn('git', pipe.args, spawnOpts);
  } catch (err) {
    // The first would sit on its open stdin for ever.
    first.kill();
    throw err;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let done = false;
  let firstOk: boolean | null = null;
  let secondOk: boolean | null = null;
  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (ok) port.postMessage({ id: job.id, ok: true, stdout: Buffer.concat(chunks).toString('utf8') } satisfies GitResult);
    else port.postMessage({ id: job.id, ok: false } satisfies GitResult);
  };
  const fail = () => {
    finish(false);
    first.kill();
    second.kill();
  };
  const timer = setTimeout(fail, job.timeoutMs);
  const settle = () => {
    if (firstOk === null || secondOk === null) return;
    finish(firstOk && secondOk);
  };
  first.on('error', fail);
  second.on('error', fail);
  first.on('close', (code) => {
    firstOk = code === 0;
    settle();
  });
  second.on('close', (code) => {
    secondOk = code === 0;
    settle();
  });
  first.stdout.pipe(second.stdin);
  // A second that quits early (an error) closes its stdin under the
  // first's pipe; the EPIPE is the first's failure, not the thread's.
  second.stdin.on('error', () => {});
  first.stdin.on('error', () => {});
  second.stdout.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > job.maxBuffer) {
      fail();
      return;
    }
    chunks.push(chunk);
  });
  first.stdin.end(pipe.stdin);
}
