import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveReviewBase } from './git-status.ts';

// The base a review compares against (M9 fix 790): since:<hash> is the
// session's start, the merge base of that commit and HEAD in the folder
// the review diffs. The worker gitText uses does not exist under node
// --test, so the cases hand in a runner that spawns git in the repo.
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const runIn = (cwd: string) => (args: string[]): Promise<string | null> => {
  try {
    return Promise.resolve(execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return Promise.resolve(null);
  }
};

function repo(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-review-base-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  return dir;
}

function commit(dir: string, file: string, text: string): string {
  fs.writeFileSync(path.join(dir, file), text);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', text.trim() || 'c');
  return git(dir, 'rev-parse', 'HEAD');
}

test('since:<hash> resolves to the start commit when HEAD grew from it', async () => {
  const dir = repo();
  const a = commit(dir, 'a.txt', 'a\n');
  const b = commit(dir, 'b.txt', 'b\n');
  const run = runIn(dir);
  assert.equal(await resolveReviewBase(`since:${a}`, 'main', 'main', run), a);
  assert.equal(await resolveReviewBase('HEAD', 'main', 'main', run), b);
  assert.equal(await resolveReviewBase(a, 'main', 'main', run), a, 'a bare hash stays as it is');
  assert.equal(await resolveReviewBase('default', 'main', 'main', run), b, 'on the default branch the whole story is HEAD');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('since:<hash> of a commit this repository lacks reads as HEAD', async () => {
  const dir = repo();
  commit(dir, 'a.txt', 'a\n');
  const b = commit(dir, 'b.txt', 'b\n');
  const other = repo();
  const foreign = commit(other, 'z.txt', 'zzz\n');
  assert.equal(await resolveReviewBase(`since:${foreign}`, 'main', 'main', runIn(dir)), b);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

test('since:<hash> in a worktree answers the fork point, not a newer commit of the main checkout', async () => {
  const dir = repo();
  const a = commit(dir, 'a.txt', 'a\n');
  const b = commit(dir, 'b.txt', 'b\n');
  const wt = path.join(path.dirname(dir), `${path.basename(dir)}-wt`);
  git(dir, 'worktree', 'add', '-q', '-b', 'side', wt, a);
  git(wt, 'config', 'user.name', 't');
  git(wt, 'config', 'user.email', 't@example.com');
  git(wt, 'config', 'commit.gpgsign', 'false');
  commit(wt, 'c.txt', 'c\n');
  assert.equal(await resolveReviewBase(`since:${b}`, 'main', 'side', runIn(wt)), a);
  git(dir, 'worktree', 'remove', '--force', wt);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('default on a branch is the merge base with main', async () => {
  const dir = repo();
  const a = commit(dir, 'a.txt', 'a\n');
  git(dir, 'checkout', '-q', '-b', 'topic');
  commit(dir, 'b.txt', 'b\n');
  assert.equal(await resolveReviewBase('default', 'main', 'topic', runIn(dir)), a);
  fs.rmSync(dir, { recursive: true, force: true });
});
