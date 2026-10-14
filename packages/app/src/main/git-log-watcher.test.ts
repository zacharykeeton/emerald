import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { GitLogWatcher, gitDirOf, gitInit, headOf, readHead } from './git-status.ts';

function tempDir(): string {
  return fs.realpathSync.native(mkTemp('emerald-logwatch-'));
}

test.after(removeTemps);

const until = (check: () => boolean, ms: number) =>
  new Promise<boolean>((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (check()) resolve(true);
      else if (Date.now() - start > ms) resolve(false);
      else setTimeout(tick, 25);
    };
    tick();
  });

test('gitDirOf: the .git folder of a checkout, where a worktree file points, null elsewhere', () => {
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, '.git'));
  assert.equal(gitDirOf(repo), path.join(repo, '.git'));
  const wt = tempDir();
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'wt')}\n`);
  assert.equal(gitDirOf(wt), path.join(repo, '.git', 'worktrees', 'wt'));
  assert.equal(gitDirOf(tempDir()), null);
});

test('GitLogWatcher pushes the root on a commit, from a repo with no logs yet and then from logs (M49)', async () => {
  const repo = tempDir();
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, windowsHide: true, stdio: 'pipe' });
  git('init', '-q');
  assert.ok(!fs.existsSync(path.join(repo, '.git', 'logs')), 'git init makes no logs folder');
  const pushes: string[] = [];
  const watcher = new GitLogWatcher((root) => pushes.push(root));
  try {
    // Set from a subfolder: the repo root above it is what is watched.
    fs.mkdirSync(path.join(repo, 'src'));
    watcher.set([path.join(repo, 'src')]);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'first');
    assert.ok(await until(() => pushes.length >= 1, 3000), 'the first commit, seen from the gitdir, pushed');
    assert.equal(pushes[0], repo, 'the push names the root');
    const before = pushes.length;
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    git('add', 'b.txt');
    git('commit', '-q', '-m', 'second');
    assert.ok(await until(() => pushes.length > before, 3000), 'the second commit, seen from logs, pushed');
    // The same root again keeps the watch; an empty list drops it.
    watcher.set([repo]);
    assert.deepEqual(watcher.roots(), [repo]);
    watcher.set([]);
    const after = pushes.length;
    fs.writeFileSync(path.join(repo, 'c.txt'), 'c\n');
    git('add', 'c.txt');
    git('commit', '-q', '-m', 'third');
    assert.equal(await until(() => pushes.length > after, 600), false, 'nothing pushed once unset');
    watcher.set([tempDir()]);
    assert.deepEqual(watcher.roots(), [], 'a folder outside a repo watches nothing');
    assert.equal(pushes.length, after);
  } finally {
    watcher.close();
  }
});

test('GitLogWatcher holds one watch per root over several folders and reconciles on set (M52)', async () => {
  const one = tempDir();
  const two = tempDir();
  const git = (repo: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, windowsHide: true, stdio: 'pipe' });
  for (const repo of [one, two]) {
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
    git(repo, 'add', 'a.txt');
    git(repo, 'commit', '-q', '-m', 'first');
  }
  assert.equal(readHead(one), 'main', 'the branch off HEAD');
  const pushes: string[] = [];
  const watcher = new GitLogWatcher((root) => pushes.push(root));
  try {
    fs.mkdirSync(path.join(two, 'src'));
    watcher.set([one, path.join(two, 'src'), two]);
    assert.deepEqual([...watcher.roots()].sort(), [one, two].sort(), 'two folders of one repo share a watch');
    fs.writeFileSync(path.join(two, 'b.txt'), 'b\n');
    git(two, 'add', 'b.txt');
    git(two, 'commit', '-q', '-m', 'second');
    assert.ok(await until(() => pushes.includes(two), 3000), 'a commit in the second repo pushes its root');
    watcher.set([one]);
    assert.deepEqual(watcher.roots(), [one], 'a root no longer named is dropped');
    const before = pushes.length;
    fs.writeFileSync(path.join(two, 'c.txt'), 'c\n');
    git(two, 'add', 'c.txt');
    git(two, 'commit', '-q', '-m', 'third');
    assert.equal(await until(() => pushes.length > before, 600), false, 'nothing from the dropped root');
    git(one, 'checkout', '-q', '--detach');
    assert.match(readHead(one) ?? '', /^[0-9a-f]{7}$/, 'a detached HEAD reads as a short sha');
  } finally {
    watcher.close();
  }
});

test("headOf reads a reftable repository's branch through git and caches it on tables.list (M9 fix 558)", async (t) => {
  const repo = tempDir();
  try {
    execFileSync('git', ['init', '-q', '--ref-format=reftable', '-b', 'trunk', repo], { windowsHide: true, stdio: 'pipe' });
  } catch {
    t.skip('git without reftable');
    return;
  }
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, windowsHide: true, stdio: 'pipe' });
  git('commit', '-q', '--allow-empty', '-m', 'one');
  const runs: string[] = [];
  const run = (args: string[], cwd: string): Promise<string | null> => {
    runs.push(args.join(' '));
    try {
      return Promise.resolve(execFileSync('git', args, { cwd, windowsHide: true, stdio: 'pipe' }).toString());
    } catch {
      return Promise.resolve(null);
    }
  };
  assert.equal(readHead(repo), null, 'the file reader no longer says .invalid');
  assert.equal(await headOf(repo, run), 'trunk');
  const asked = runs.length;
  assert.ok(asked > 0, 'git was asked');
  assert.equal(await headOf(repo, run), 'trunk', 'the kept answer');
  assert.equal(runs.length, asked, 'nothing run while tables.list is unchanged');
  git('checkout', '-q', '--detach');
  assert.match((await headOf(repo, run)) ?? '', /^[0-9a-f]{7}$/, 'a detached HEAD reads as a short hash');

  // A files repository reads HEAD and runs nothing.
  const files = tempDir();
  execFileSync('git', ['init', '-q', '-b', 'main', files], { windowsHide: true, stdio: 'pipe' });
  const before = runs.length;
  assert.equal(await headOf(files, run), 'main');
  assert.equal(runs.length, before, 'a files repository runs nothing');
});

test('gitInit (M9 fix 255): a bare folder becomes a repository the refreshed watch takes on; a folder in a repository answers its root and runs nothing; a missing folder is an error', async () => {
  const folder = tempDir();
  const runs: string[] = [];
  const run = (args: string[], cwd: string): Promise<string | null> => {
    runs.push(`${cwd} ${args.join(' ')}`);
    try {
      execFileSync('git', args, { cwd, windowsHide: true, stdio: 'pipe' });
      return Promise.resolve('');
    } catch {
      return Promise.resolve(null);
    }
  };
  const pushes: string[] = [];
  const watcher = new GitLogWatcher((root) => pushes.push(root));
  try {
    // Asked for before the init, the folder resolves to no root and gets
    // no watch.
    watcher.set([folder]);
    assert.deepEqual(watcher.roots(), []);
    const made = await gitInit(folder, run);
    assert.deepEqual(made, { root: folder, error: null });
    assert.deepEqual(runs, [`${folder} init -q`]);
    assert.ok(fs.existsSync(path.join(folder, '.git')), 'git init made the repository');
    // The same folders again take the new repository, on the gitdir
    // until the first commit makes logs.
    watcher.refresh();
    assert.deepEqual(watcher.roots(), [folder]);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: folder, windowsHide: true, stdio: 'pipe' });
    fs.writeFileSync(path.join(folder, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'first');
    assert.ok(await until(() => pushes.length >= 1, 3000), 'the first commit pushed through the refreshed watch');
    assert.equal(pushes[0], folder);
    // Inside a repository now: the root comes back and git does not run.
    const sub = path.join(folder, 'src');
    fs.mkdirSync(sub);
    assert.deepEqual(await gitInit(sub, run), { root: folder, error: null });
    assert.equal(runs.length, 1);
    const missing = path.join(tempDir(), 'not-there');
    const failed = await gitInit(missing, run);
    assert.equal(failed.root, null);
    assert.equal(failed.error, 'the folder is not there');
    assert.equal((await gitInit('relative/path', run)).error, 'not an absolute path');
  } finally {
    watcher.close();
  }
});
