import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COUNT_LINES_CAP, countUntracked } from './git-status.ts';
import type { GitOptions } from './git-runner.ts';
import { normalizePath } from '../renderer/src/files-model.ts';

// The review tab's untracked counts (M9 fix 917): a stat pass, then two
// gits for every measured file at once on a scratch index, where fix 474
// spawned one git per file. The worker's file is not there under node
// --test, so the real-git cases hand in a runner that spawns git here with
// the job's stdin and env, as the worker does.
type Call = { args: string[]; opts: GitOptions | undefined };
function realGit(calls: Call[]) {
  return (args: string[], cwd: string, opts?: GitOptions): Promise<string | null> => {
    calls.push({ args, opts });
    try {
      return Promise.resolve(
        execFileSync('git', args, { cwd, encoding: 'utf8', input: opts?.stdin ?? '', env: { ...process.env, ...opts?.env }, stdio: ['pipe', 'pipe', 'ignore'] }),
      );
    } catch {
      return Promise.resolve(null);
    }
  };
}

const key = (file: string) => normalizePath(file).toLowerCase();

function scratchRepo(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-count-')));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 't\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'keep.txt'), 'k\n');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return dir;
}

test('every untracked file counted with two gits, binary, folders and big files null', async () => {
  const dir = scratchRepo();
  const f = (rel: string) => path.join(dir, ...rel.split('/'));
  fs.writeFileSync(f('three.txt'), 'x\ny\nz');
  fs.writeFileSync(f('crlf.txt'), 'q\r\nw\r\n');
  fs.writeFileSync(f('bin.dat'), Buffer.from([0x61, 0, 0x62]));
  fs.writeFileSync(f('empty.txt'), '');
  fs.writeFileSync(f('big.log'), Buffer.alloc(5 * 1024 * 1024, 'x\n'));
  assert.ok(fs.statSync(f('big.log')).size > COUNT_LINES_CAP);
  fs.writeFileSync(f('sub/new file ü.txt'), 'n1\nn2\n');
  fs.mkdirSync(f('fresh'));
  fs.writeFileSync(f('fresh/inside.txt'), 'i\n');
  const files = ['three.txt', 'crlf.txt', 'bin.dat', 'empty.txt', 'big.log', 'sub/new file ü.txt', 'fresh'].map(f);
  const calls: Call[] = [];
  const counts = await countUntracked(dir, files, realGit(calls));
  assert.deepEqual(
    files.map((file) => counts.get(key(file))),
    [3, 2, null, 0, null, 2, null],
  );
  assert.equal(calls.length, 2, 'the add and the diff, whatever the count');
  const named = (calls[0]!.opts?.stdin ?? '').split('\0').sort();
  assert.deepEqual(named, ['bin.dat', 'crlf.txt', 'sub/new file ü.txt', 'three.txt']);
  // The real index is untouched: every file is still untracked.
  const status = execFileSync('git', ['status', '--porcelain', '-z'], { cwd: dir, encoding: 'utf8' });
  assert.ok(status.split('\0').filter(Boolean).every((l) => l.startsWith('??')), status);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed add leaves every measured file null and the scratch index gone', async () => {
  const dir = scratchRepo();
  const files = ['a.txt', 'empty.txt', 'big.log'].map((n) => path.join(dir, n));
  fs.writeFileSync(files[0]!, 'a\n');
  fs.writeFileSync(files[1]!, '');
  fs.writeFileSync(files[2]!, Buffer.alloc(5 * 1024 * 1024, 'x\n'));
  let idx = '';
  const counts = await countUntracked(dir, files, (_args, _cwd, opts) => {
    idx = opts?.env?.GIT_INDEX_FILE ?? '';
    return Promise.resolve(null);
  });
  assert.deepEqual(files.map((file) => counts.get(key(file))), [null, 0, null]);
  assert.notEqual(idx, '');
  assert.equal(fs.existsSync(idx), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed diff after the add leaves every measured file null and the scratch index gone', async () => {
  const dir = scratchRepo();
  const files = ['a.txt', 'b.txt'].map((n) => path.join(dir, n));
  for (const file of files) fs.writeFileSync(file, 'a\n');
  const calls: Call[] = [];
  const real = realGit(calls);
  let idx = '';
  const counts = await countUntracked(dir, files, (args, cwd, opts) => {
    idx = opts?.env?.GIT_INDEX_FILE ?? '';
    return args.includes('add') ? real(args, cwd, opts) : Promise.resolve(null);
  });
  assert.deepEqual(files.map((file) => counts.get(key(file))), [null, null]);
  assert.equal(calls.length, 1, 'the add ran for real');
  assert.equal(fs.existsSync(idx), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every file empty, missing or past the cap runs no git', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-count-')));
  fs.writeFileSync(path.join(dir, 'empty.txt'), '');
  fs.writeFileSync(path.join(dir, 'trace.log'), Buffer.alloc(5 * 1024 * 1024, 'x\n'));
  const files = ['empty.txt', 'trace.log', 'gone.txt'].map((n) => path.join(dir, n));
  const counts = await countUntracked(dir, files, () => Promise.reject(new Error('no git expected')));
  assert.deepEqual(files.map((file) => counts.get(key(file))), [0, null, null]);
  fs.rmSync(dir, { recursive: true, force: true });
});
