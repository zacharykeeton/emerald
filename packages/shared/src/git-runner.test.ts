import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forgetInFlight, gitBytes, gitPipe, gitText, setGitWorkerFile } from './git-runner.ts';

// The one git runner for the app and the daemon (M9 fix 916). The worker
// is started from its source, which shared's suite runs under Node's type
// stripping. 20 s per git, the daemon test's reason (M9 fix 639): these
// prove the shape, not speed, and a spawn under a full run's load and the
// antivirus hold has taken past 5 s.
setGitWorkerFile(() => new URL('./git-worker.ts', import.meta.url));
const T = { timeoutMs: 20000 };
const tmp = os.tmpdir();

function scratchRepo(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(tmp, 'emerald-runner-')));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

test('two identical calls in one tick share one promise, and a forget starts a new one', async () => {
  const a = gitText(['--version'], tmp, T);
  const b = gitText(['--version'], tmp, T);
  assert.equal(a, b, 'the second call shares the first');
  forgetInFlight(tmp);
  const c = gitText(['--version'], tmp, T);
  assert.notEqual(c, a, 'after the forget the next call starts its own git');
  // A call made after the forget is shared with a later identical one.
  assert.equal(gitText(['--version'], tmp, T), c);
  assert.match((await a) ?? '', /^git version /);
  assert.match((await c) ?? '', /^git version /);
});

test('a different env or stdin is a different key', async () => {
  const a = gitText(['hash-object', '--stdin'], tmp, { ...T, stdin: 'one\n' });
  const b = gitText(['hash-object', '--stdin'], tmp, { ...T, stdin: 'two\n' });
  const c = gitText(['--version'], tmp, { ...T, env: { EMERALD_RUNNER_TEST: '1' } });
  const d = gitText(['--version'], tmp, T);
  assert.notEqual(a, b);
  assert.notEqual(c, d);
  await Promise.all([a, b, c, d]);
});

test('env reaches git', async () => {
  const dir = scratchRepo();
  const idx = path.join(dir, 'scratch.idx');
  const out = await gitText(['rev-parse', '--git-path', 'index'], dir, { ...T, env: { GIT_INDEX_FILE: idx } });
  assert.equal(path.resolve(dir, (out ?? '').trim()), idx);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('stdin reaches a single git', async () => {
  const out = await gitText(['hash-object', '--stdin'], tmp, { ...T, stdin: 'hello\n' });
  assert.equal(out?.trim(), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('a pipe feeds stdin to the first git and answers the second', async () => {
  const want = execFileSync('git', ['hash-object', '--stdin'], { input: 'ce013625030ba8dba906f756967f9e9ca394464a\n', encoding: 'utf8' }).trim();
  const out = await gitPipe(['hash-object', '--stdin'], ['hash-object', '--stdin'], 'hello\n', tmp, T);
  assert.equal(out?.trim(), want);
});

test('bytes come back as a Uint8Array', async () => {
  const out = await gitBytes(['--version'], tmp, T);
  assert.ok(out instanceof Uint8Array);
  assert.match(new TextDecoder().decode(out), /^git version /);
});

test('okExits makes a non-zero exit an answer, and without it null', async () => {
  const dir = scratchRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\nc\n');
  const args = ['diff', '--no-index', '--numstat', 'a.txt', 'b.txt'];
  assert.equal(await gitText(args, dir, T), null);
  const out = await gitText(args, dir, { ...T, okExits: [1] });
  assert.match(out ?? '', /^2\t1\t/);
  fs.rmSync(dir, { recursive: true, force: true });
});
