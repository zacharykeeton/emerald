import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitRevert, revertTarget } from './git-status.ts';

// The path guard of the rail's revert (M9 fix 310): a file inside the
// repository and nothing else, since the two git commands take whatever
// path they are handed.
test('revertTarget keeps a file inside the root and refuses the rest', () => {
  const root = path.join(os.tmpdir(), 'emerald-revert-root');
  assert.equal(revertTarget(root, 'notes.txt'), 'notes.txt');
  assert.equal(revertTarget(root, 'sub/keep.txt'), 'sub/keep.txt');
  assert.equal(revertTarget(root, 'sub\\keep.txt'), 'sub/keep.txt');
  assert.equal(revertTarget(root, 'sub/../notes.txt'), 'notes.txt');
  assert.equal(revertTarget(root, ''), null);
  assert.equal(revertTarget(root, '.'), null);
  assert.equal(revertTarget(root, '../outside.txt'), null);
  assert.equal(revertTarget(root, 'sub/../../outside.txt'), null);
  assert.equal(revertTarget(root, path.join(root, 'notes.txt')), null);
  assert.equal(revertTarget(root, 'C:notes.txt'), null);
  assert.equal(revertTarget(root, '/notes.txt'), null);
  // Glob characters stay as written (M9 fix 473): git reads them
  // literally under --literal-pathspecs. A leading `:` is pathspec magic
  // (`:/` is the whole tree) and is refused.
  assert.equal(revertTarget(root, '[ab].txt'), '[ab].txt');
  assert.equal(revertTarget(root, '*'), '*');
  assert.equal(revertTarget(root, ':/'), null);
  assert.equal(revertTarget(root, ':(glob)**'), null);
});

test('gitRevert runs the reset then the checkout at the root, and nothing on a bad path or outside a repo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-revert-'));
  const runs: string[] = [];
  const run = (args: string[], cwd: string) => {
    runs.push(`${path.basename(cwd)}: ${args.join(' ')}`);
    return Promise.resolve('');
  };
  // Not a repository: nothing runs.
  assert.equal(await gitRevert(dir, 'notes.txt', run), false);
  assert.deepEqual(runs, [] as string[]);
  fs.mkdirSync(path.join(dir, '.git'));
  fs.mkdirSync(path.join(dir, 'sub'));
  assert.equal(await gitRevert(path.join(dir, 'sub'), 'sub/keep.txt', run), true);
  assert.deepEqual(runs, [`${path.basename(dir)}: --literal-pathspecs reset -q HEAD -- sub/keep.txt`, `${path.basename(dir)}: --literal-pathspecs checkout HEAD -- sub/keep.txt`]);
  runs.length = 0;
  assert.equal(await gitRevert(dir, '[ab].txt', run), true);
  assert.deepEqual(runs, [`${path.basename(dir)}: --literal-pathspecs reset -q HEAD -- [ab].txt`, `${path.basename(dir)}: --literal-pathspecs checkout HEAD -- [ab].txt`]);
  runs.length = 0;
  assert.equal(await gitRevert(dir, '../outside.txt', run), false);
  assert.equal(await gitRevert('notes.txt', 'notes.txt', run), false);
  assert.deepEqual(runs, [] as string[]);
  // A failed reset stops short of the checkout.
  const failing = (args: string[]) => {
    runs.push(args[1]!);
    return Promise.resolve(args[1] === 'reset' ? null : '');
  };
  assert.equal(await gitRevert(dir, 'notes.txt', failing), false);
  assert.deepEqual(runs, ['reset']);
  fs.rmSync(dir, { recursive: true, force: true });
});
