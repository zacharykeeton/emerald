import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import type { GitJob, GitResult } from './git-worker.ts';

// The git worker (M9 fix 476, shared by the app and the daemon since fix
// 916): a NUL in an argument (a `rel` from the renderer into gitShow's
// `<hash>:<rel>`) threw inside the message handler and ended the thread
// with every read in flight. The worker is loaded from its source here.
test('a NUL argument answers not ok and the next job runs on the same worker', async () => {
  const w = new Worker(new URL('./git-worker.ts', import.meta.url));
  let exited = false;
  w.on('exit', () => {
    exited = true;
  });
  const ask = (job: GitJob) =>
    new Promise<GitResult>((resolve) => {
      const on = (r: GitResult) => {
        if (r.id !== job.id) return;
        w.off('message', on);
        resolve(r);
      };
      w.on('message', on);
      w.postMessage(job);
    });
  const base = { cwd: os.tmpdir(), timeoutMs: 5000, maxBuffer: 1024 * 1024 };
  assert.deepEqual(await ask({ id: 1, args: ['show', 'HEAD:a\0b'], encoding: 'buffer', ...base }), { id: 1, ok: false });
  assert.deepEqual(await ask({ id: 2, args: ['--version', 'a\0b'], encoding: 'utf8', ...base }), { id: 2, ok: false });
  assert.deepEqual(await ask({ id: 3, args: ['--version'], encoding: 'utf8', stdin: '', pipe: { args: ['x\0y'] }, ...base }), { id: 3, ok: false });
  const next = await ask({ id: 4, args: ['--version'], encoding: 'utf8', ...base });
  assert.equal(next.ok, true);
  assert.match(next.ok ? String(next.stdout) : '', /^git version /);
  assert.equal(exited, false, 'the worker lives on');
  await w.terminate();
});
