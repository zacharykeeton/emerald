import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { gitText, setGitRunnerLog } from './git-runner.ts';

// 20 s, not 5 (M9 fix 639): these tests prove the NUL guard and that stdin
// reaches git, not speed, and a git spawned from the worker thread under a
// full suite run's load and the antivirus hold on spawns has taken past 5 s
// and answered null.
const LOAD_TIMEOUT_MS = 20000;

// The daemon's git worker (M9 fix 476): an argument holding a NUL made
// execFile throw inside the worker's message handler, which killed the
// thread and failed every other read in flight; it answers that job
// alone now, and the next job runs on the same worker.
test('a NUL argument answers null and the worker lives on for the next job', async () => {
  const lines: string[] = [];
  setGitRunnerLog((msg) => lines.push(msg));
  const cwd = os.tmpdir();
  assert.equal(await gitText(['--version', 'a\0b'], cwd, LOAD_TIMEOUT_MS), null);
  const next = await gitText(['--version'], cwd, LOAD_TIMEOUT_MS);
  assert.match(next ?? '', /^git version /);
  assert.deepEqual(lines, [] as string[], 'the worker never ended');
  setGitRunnerLog(() => {});
});

// A job's stdin (M9 fix 476), which readMerges hands its hashes through.
test('stdin reaches git', async () => {
  const out = await gitText(['hash-object', '--stdin'], os.tmpdir(), LOAD_TIMEOUT_MS, undefined, 'hello\n');
  assert.equal(out?.trim(), 'ce013625030ba8dba906f756967f9e9ca394464a');
});
