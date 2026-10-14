import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { commonDirOf, gitGraph } from './git-status.ts';
import type { GraphGit } from './git-status.ts';

function tempDir(): string {
  return fs.realpathSync.native(mkTemp('emerald-graphcache-'));
}

test.after(removeTemps);

// One commit line in parseGraph's format, as git-changes-model.test.ts
// builds them, with the committer time after the author's.
const LOG = ['c1', '', 'HEAD -> refs/heads/main, refs/heads/main', 'first', 'verify', '300', '300', ''].join('\x1f') + '\n';

// A fake git that records every call and answers the five a graph read
// asks; `author` is what `config user.name` says, null for a git that
// failed.
function fakeGit(root: string) {
  const calls: string[] = [];
  let author: string | null = 'verify\n';
  const git: GraphGit = {
    text: async (args) => {
      const a = args.filter((x) => x !== '--no-optional-locks');
      calls.push(a.slice(0, 2).join(' '));
      if (a[0] === 'log') return LOG;
      if (a[0] === 'branch') return 'main\n';
      if (a[0] === 'worktree') return `worktree ${root}\nHEAD c1\nbranch refs/heads/main\n\n`;
      if (a[0] === 'config') return author;
      return null;
    },
    pipe: async (argsA) => {
      calls.push(argsA.filter((x) => x !== '--no-optional-locks')[0]!);
      return 'p1 c1\n';
    },
  };
  return { git, calls, setAuthor: (v: string | null) => (author = v) };
}

test('gitGraph: an unchanged repository spawns only log and branch --merged after the first read, and re-reads a fact when its file moves (M9 fix 557)', async () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, '.git'));
  const config = path.join(root, '.git', 'config');
  fs.writeFileSync(config, '[core]\n');
  const { git, calls, setAuthor } = fakeGit(root);

  const first = await gitGraph(root, {}, git);
  assert.equal(first.author, 'verify');
  assert.deepEqual(first.worktrees.length, 1);
  assert.deepEqual(calls, ['log --branches', 'branch --merged', 'worktree list', 'config user.name', 'diff-tree'], 'five calls on the first read, and no rev-parse');

  calls.length = 0;
  const second = await gitGraph(root, {}, git);
  assert.deepEqual(calls, ['log --branches', 'branch --merged'], 'two calls on a read of an unchanged repository');
  assert.equal(second.author, 'verify', 'the cached author');
  assert.equal(second.worktrees.length, 1, 'the cached worktree list');

  // A `git config user.name` in the repository moves the config's mtime.
  const earlier = new Date(Date.now() - 60_000);
  fs.utimesSync(config, earlier, earlier);
  calls.length = 0;
  await gitGraph(root, {}, git);
  assert.deepEqual(calls, ['log --branches', 'branch --merged', 'config user.name'], 'the config re-read and nothing else');

  // `git worktree add` writes worktrees/<name>/gitdir under the common dir.
  fs.mkdirSync(path.join(root, '.git', 'worktrees', 'wt1'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'worktrees', 'wt1', 'gitdir'), 'C:/elsewhere/wt1/.git\n');
  calls.length = 0;
  await gitGraph(root, {}, git);
  assert.deepEqual(calls, ['log --branches', 'branch --merged', 'worktree list'], 'the worktree list re-read and nothing else');

  // A git that fails on the author is not cached: the read after asks again.
  const later = new Date(Date.now() - 30_000);
  fs.utimesSync(config, later, later);
  setAuthor(null);
  calls.length = 0;
  const failed = await gitGraph(root, {}, git);
  assert.equal(failed.author, null);
  assert.ok(calls.includes('config user.name'));
  setAuthor('verify\n');
  calls.length = 0;
  const again = await gitGraph(root, {}, git);
  assert.ok(calls.includes('config user.name'), 'a null answer is asked again');
  assert.equal(again.author, 'verify');
});

test('commonDirOf: a checkout is its own .git, a worktree follows its commondir (M9 fix 557)', () => {
  const main = tempDir();
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
  fs.writeFileSync(path.join(main, '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
  assert.equal(commonDirOf(main), path.join(main, '.git'));
  const wt = tempDir();
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'wt')}\n`);
  assert.equal(commonDirOf(wt), path.join(main, '.git'));
  assert.equal(commonDirOf(tempDir()), null, 'no gitdir');
});
