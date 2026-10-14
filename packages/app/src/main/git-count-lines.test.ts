import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COUNT_LINES_CAP, countLines } from './git-status.ts';

// An untracked file's count on the review tab (M9 fix 474): a stat first
// and nothing read past the cap, then git's own count on the worker. The
// worker's file is not there under node --test, so the real-git cases
// hand in a runner that spawns git here, honouring okExits as the
// worker does.
const realGit = (args: string[], cwd: string, okExits?: number[]): Promise<string | null> => {
  try {
    return Promise.resolve(execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return Promise.resolve(typeof e.status === 'number' && (okExits ?? []).includes(e.status) ? (e.stdout ?? '') : null);
  }
};

test('a file past the cap answers null at once and runs nothing', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-count-')));
  const big = path.join(dir, 'trace.log');
  fs.writeFileSync(big, Buffer.alloc(5 * 1024 * 1024, 'x\n'));
  assert.ok(fs.statSync(big).size > COUNT_LINES_CAP);
  const runs: string[][] = [];
  const run = (args: string[]) => {
    runs.push(args);
    return Promise.resolve('1\t0\t');
  };
  const t0 = performance.now();
  assert.equal(await countLines(big, dir, run), null);
  assert.ok(performance.now() - t0 < 50, `took ${performance.now() - t0} ms`);
  assert.deepEqual(runs, [] as string[][]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an empty file is 0 and a missing one or a folder null, with no git', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-count-')));
  fs.writeFileSync(path.join(dir, 'empty.txt'), '');
  const run = () => Promise.reject(new Error('no git expected'));
  assert.equal(await countLines(path.join(dir, 'empty.txt'), dir, run), 0);
  assert.equal(await countLines(path.join(dir, 'gone.txt'), dir, run), null);
  assert.equal(await countLines(dir, dir, run), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('git counts the lines, a binary file is null, and exit 1 is an answer', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-count-')));
  fs.writeFileSync(path.join(dir, 'three.txt'), 'x\ny\nz');
  fs.writeFileSync(path.join(dir, 'crlf.txt'), 'q\r\nw\r\n');
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0x61, 0, 0x62]));
  assert.equal(await countLines(path.join(dir, 'three.txt'), dir, realGit), 3);
  assert.equal(await countLines(path.join(dir, 'crlf.txt'), dir, realGit), 2);
  assert.equal(await countLines(path.join(dir, 'bin.dat'), dir, realGit), null);
  // The runner is asked for exit 1 as an answer, and a failed run is null.
  let asked: number[] | undefined;
  await countLines(path.join(dir, 'three.txt'), dir, (_a, _c, ok) => {
    asked = ok;
    return Promise.resolve(null);
  });
  assert.deepEqual(asked, [1]);
  fs.rmSync(dir, { recursive: true, force: true });
});
