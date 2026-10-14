import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { execFileSync } from 'node:child_process';
import { findGitDir, onReftableBranch, readBranch, repoKey } from './git-branch.ts';

function tempDir(): string {
  return mkTemp('emerald-branch-');
}

test.after(removeTemps);

test('readBranch reads the branch from .git/HEAD, from a subfolder too', () => {
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, '.git'));
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/fix/reorder-specs\n');
  fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
  assert.equal(readBranch(repo), 'fix/reorder-specs');
  assert.equal(readBranch(path.join(repo, 'src', 'deep')), 'fix/reorder-specs', 'found by walking up');
});

test('readBranch follows a worktree .git file to its own HEAD', () => {
  const main = tempDir();
  const worktree = tempDir();
  const wtGit = path.join(main, '.git', 'worktrees', 'wt');
  fs.mkdirSync(wtGit, { recursive: true });
  fs.writeFileSync(path.join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(wtGit, 'HEAD'), 'ref: refs/heads/feature\n');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${wtGit}\n`);
  assert.equal(readBranch(worktree), 'feature');
  assert.equal(readBranch(main), 'main');
});

test('readBranch gives the short id for a detached HEAD and null outside a repository', () => {
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, '.git'));
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
  assert.equal(readBranch(repo), '0123456');
  // A temp dir sits under the profile, which is not a repository on this machine.
  assert.equal(readBranch(tempDir()), null);
  assert.equal(readBranch(path.join(repo, 'does-not-exist')), '0123456', 'a missing subfolder still resolves to the repo above it');
  fs.writeFileSync(path.join(repo, '.git', 'HEAD'), 'garbage');
  assert.equal(readBranch(repo), null, 'an unreadable HEAD is no branch');
});

test("readBranch reads a reftable repository's branch through git (M9 fix 558)", async (t) => {
  const repo = tempDir();
  try {
    execFileSync('git', ['init', '-q', '--ref-format=reftable', '-b', 'trunk', repo], { stdio: 'ignore' });
  } catch {
    t.skip('git without reftable');
    return;
  }
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, stdio: 'ignore' });
  git('commit', '-q', '--allow-empty', '-m', 'one');
  // 20 s, not 5 (M9 fix 639): each wait is a spawned git, which a full suite run's load has held past 5 s.
  const until = async (check: () => boolean, ms = 20000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) return false;
      await new Promise((r) => setTimeout(r, 25));
    }
    return true;
  };
  const told: string[] = [];
  const off = onReftableBranch((gitDir) => told.push(gitDir));
  try {
    assert.equal(readBranch(repo), null, 'the first read answers null and starts the spawn');
    assert.ok(await until(() => readBranch(repo) === 'trunk'), `trunk within 20 s, read ${readBranch(repo)}`);
    assert.ok(told.includes(findGitDir(repo)!), 'the listener was told the gitdir');
    git('checkout', '-q', '-b', 'other');
    assert.ok(await until(() => readBranch(repo) === 'other'), `other within 20 s, read ${readBranch(repo)}`);
    git('checkout', '-q', '--detach');
    assert.ok(await until(() => /^[0-9a-f]{7}$/.test(readBranch(repo) ?? '')), `a detached HEAD reads as a short hash, read ${readBranch(repo)}`);
  } finally {
    off();
  }
});

test('repoKey (M9 fix 133): a repository, its subfolders and its linked worktrees share one key; a plain folder is its own', () => {
  const main = tempDir();
  const worktree = tempDir();
  const wtGit = path.join(main, '.git', 'worktrees', 'wt');
  fs.mkdirSync(wtGit, { recursive: true });
  fs.mkdirSync(path.join(main, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(wtGit, 'HEAD'), 'ref: refs/heads/feature\n');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${wtGit}\n`);
  assert.equal(findGitDir(worktree), wtGit, "the worktree's own git dir");
  const key = repoKey(main);
  assert.equal(key, path.join(fs.realpathSync.native(main), '.git').replace(/\\/g, '/').toLowerCase(), 'the real spelling, not the 8.3 one os.tmpdir() gives');
  assert.equal(repoKey(path.join(main, 'src', 'deep')), key, 'a subfolder');
  assert.equal(repoKey(worktree), key, 'a linked worktree');
  assert.equal(repoKey(main.toUpperCase()), key, 'either case');
  assert.equal(repoKey(main.replace(/\\/g, '/')), key, 'either slash');
  const plain = tempDir();
  assert.equal(repoKey(plain), fs.realpathSync.native(plain).replace(/\\/g, '/').toLowerCase(), 'outside any repository the folder is the key');
  assert.notEqual(repoKey(plain), repoKey(tempDir()), 'two plain folders are two keys');
});
