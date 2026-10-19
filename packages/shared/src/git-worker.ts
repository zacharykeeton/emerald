import { execFile, spawn } from 'node:child_process';
import type { ExecFileException, SpawnOptionsWithStdioTuple, StdioNull, StdioPipe } from 'node:child_process';
import { parentPort, type MessagePort } from 'node:worker_threads';

// The thread that runs git for the app's main process and the daemon
// alike (M9 fix 226, one copy since fix 916). A child process is started
// with CreateProcess on the thread that asks for it, and under load
// (several Claude turns, each redrawing and committing) one took 100 to
// 400 ms on this machine; the main process spawned git two or three times
// a second for the rail's colours, and the daemon ran `git rev-list` after
// every PostToolUse that moved HEAD, and a keystroke waiting behind either
// was one the typist felt. Here the wait lands on this thread's loop and
// the caller's loop only posts and reads back. One message in, one out,
// matched by id; the caller (git-runner.ts) times out on its own. A job
// with `pipe` (M9 fix 304) is two gits: the first fed `stdin`, its stdout
// into the second's stdin, the second's stdout the answer, which is how
// the graph's patch ids are read (`diff-tree -p --stdin` into `patch-id
// --stable`) without the diffs crossing to the caller's thread.

export interface GitJob {
  id: number;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxBuffer: number;
  // 'buffer' hands the bytes back untouched for `git show`; text is utf8.
  encoding: 'utf8' | 'buffer';
  // Exit codes besides 0 whose stdout is an answer (M9 fix 320:
  // `merge-tree --write-tree` exits 1 when the merge would conflict, and
  // the conflicted paths are what that read is for).
  okExits?: number[];
  // Fed to the first (or only) git's stdin (M9 fix 476: readMerges hands
  // its hashes to `rev-list --stdin`, since a long claim's hashes passed
  // Windows' 32,767-character command line).
  stdin?: string;
  // Laid over the worker's environment for every git the job starts (M9
  // fix 917: the review's line count points GIT_INDEX_FILE at a scratch
  // index).
  env?: Record<string, string>;
  // The second git of a pipe.
  pipe?: { args: string[] };
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

function envOf(job: GitJob): NodeJS.ProcessEnv | undefined {
  return job.env === undefined ? undefined : { ...process.env, ...job.env };
}

function runJob(port: MessagePort, job: GitJob): void {
  if (job.pipe !== undefined) {
    runPipe(port, job, job.pipe.args);
    return;
  }
  const env = envOf(job);
  const opts = { cwd: job.cwd, timeout: job.timeoutMs, maxBuffer: job.maxBuffer, windowsHide: true, ...(env === undefined ? {} : { env }) };
  // okExits is honoured for text and bytes alike (the app's bytes branch
  // used to ignore it).
  const answer = (err: ExecFileException | null, stdout: string | Uint8Array) => {
    const allowed = err !== null && typeof err.code === 'number' && (job.okExits ?? []).includes(err.code);
    port.postMessage(err && !allowed ? ({ id: job.id, ok: false } satisfies GitResult) : ({ id: job.id, ok: true, stdout } satisfies GitResult));
  };
  const child =
    job.encoding === 'buffer'
      ? execFile('git', job.args, { ...opts, encoding: 'buffer' }, (err, stdout) => answer(err, new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.byteLength)))
      : execFile('git', job.args, opts, (err, stdout) => answer(err, stdout));
  if (job.stdin !== undefined && child.stdin !== null) {
    // A git that exits before reading it all closes the pipe; that is its
    // answer's business, not the thread's.
    child.stdin.on('error', () => {});
    child.stdin.end(job.stdin);
  }
}

// The two-git job: any failure (either exits non-zero, the timeout, the
// output over the cap) answers not ok, as a single git's does; the timeout
// kills both.
function runPipe(port: MessagePort, job: GitJob, secondArgs: string[]): void {
  const env = envOf(job);
  const spawnOpts: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioNull> = { cwd: job.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], ...(env === undefined ? {} : { env }) };
  const first = spawn('git', job.args, spawnOpts);
  let second: typeof first;
  try {
    second = spawn('git', secondArgs, spawnOpts);
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
  first.stdin.end(job.stdin ?? '');
}
