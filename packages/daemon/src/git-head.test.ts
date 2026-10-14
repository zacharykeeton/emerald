import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { movesHead, readHead, readHeadFile, readMerges, readsOnly, revListFirstParent } from './git-head.ts';

function tempDir(): string {
  return mkTemp('emerald-head-');
}

test.after(removeTemps);

// A branch named merge or a commit message with the word in it is a
// false positive the record absorbs with one rev-parse, so the test does
// not chase those.
test('movesHead names the git commands that can move HEAD and nothing else', () => {
  for (const c of [
    'git commit -m "x"',
    'git add -A && git commit -q -F msg.txt',
    'cd packages/app && git merge --no-ff fix-rail',
    'git rebase main',
    'git cherry-pick abc1234',
    'git pull --ff-only',
    'git revert HEAD',
    'git am < patch',
    'GIT_EDITOR=true git rebase --continue',
  ]) {
    assert.ok(movesHead(c), c);
  }
  for (const c of ['git status', 'git log --oneline -5', 'git diff', 'npm run commit', 'echo commit', 'commit && git status', 'git stash; echo merge']) {
    assert.ok(!movesHead(c), c);
  }
});

test('readsOnly names a command made of git reads alone, a cd and a plain filter allowed, and nothing that could write (M9 fix 311)', () => {
  for (const c of [
    'git rev-list --count main..fix-member-model',
    'git log --oneline main..fix-x',
    'cd ../emerald-wt/fix-x && git log --oneline -5',
    'git status --short',
    'git -C C:/code/emerald diff --stat',
    'git show HEAD:README.md',
    'git --no-pager rev-parse HEAD',
    'git branch --merged main',
    'git branch -a | grep fix',
    'git worktree list',
    'git log --oneline | head -20',
    'GIT_PAGER=cat git log -3; git status',
  ]) {
    assert.ok(readsOnly(c), c);
  }
  for (const c of [
    'git commit -m x',
    'git log && git cherry-pick abc1234',
    'git branch -d fix-x',
    'git branch -D fix-x',
    'git branch -m old new',
    'git worktree add ../emerald-wt/x -b x main',
    'git rev-list main..x | xargs git cherry-pick',
    'git log | node tools/land.mjs',
    'node tools/land.mjs',
    'cd ../emerald-wt/x',
    'git stash',
    'git checkout main',
    'git reset --hard origin/main',
    '',
  ]) {
    assert.ok(!readsOnly(c), c);
  }
});

test('readHead gives the full hash of HEAD in a repository and null elsewhere', async () => {
  const repo = tempDir();
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true, stdio: 'pipe' }).toString().trim();
  git('init', '-q');
  assert.equal(await readHead(repo), null, 'no commits yet');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first');
  const head = git('rev-parse', 'HEAD');
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(await readHead(repo), head);
  assert.equal(await readHead(path.join(repo, 'sub-that-does-not-exist')), null, 'a missing folder is null, not a throw');
  assert.equal(await readHead(tempDir()), null, 'outside a repository');
});

test('readHeadFile reads HEAD off the files through a commit, a branch switch, a packed ref and a linked worktree, and null elsewhere (M9 fix 195)', () => {
  const repo = tempDir();
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, windowsHide: true, stdio: 'pipe' }).toString().trim();
  git(repo, 'init', '-q', '-b', 'main');
  assert.equal(readHeadFile(repo), null, 'no commits yet');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'first');
  const first = git(repo, 'rev-parse', 'HEAD');
  assert.equal(readHeadFile(repo), first, 'the loose ref');
  assert.equal(readHeadFile(path.join(repo, 'sub-that-does-not-exist')), first, 'a subfolder walks up to the same .git');
  git(repo, 'checkout', '-q', '-b', 'topic');
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
  git(repo, 'add', 'b.txt');
  git(repo, 'commit', '-q', '-m', 'second');
  const second = git(repo, 'rev-parse', 'HEAD');
  assert.notEqual(second, first);
  assert.equal(readHeadFile(repo), second, 'the new branch');
  git(repo, 'pack-refs', '--all');
  assert.ok(!fs.existsSync(path.join(repo, '.git', 'refs', 'heads', 'topic')), 'the loose ref is gone');
  assert.equal(readHeadFile(repo), second, 'read off packed-refs');
  git(repo, 'checkout', '-q', 'main');
  assert.equal(readHeadFile(repo), first, 'the switch back, packed too');
  git(repo, 'checkout', '-q', '--detach', second);
  assert.equal(readHeadFile(repo), second, 'a detached HEAD is the hash itself');
  const wt = path.join(tempDir(), 'wt');
  git(repo, 'worktree', 'add', '-q', wt, 'topic');
  assert.equal(readHeadFile(wt), second, "a linked worktree's HEAD through its .git file and commondir");
  fs.writeFileSync(path.join(wt, 'c.txt'), 'c\n');
  git(wt, 'add', 'c.txt');
  git(wt, 'commit', '-q', '-m', 'third');
  const third = git(wt, 'rev-parse', 'HEAD');
  assert.equal(readHeadFile(wt), third, 'and its own commit, a loose ref under the common dir');
  assert.equal(readHeadFile(tempDir()), null, 'outside a repository');
});

// A claim of 1,000 commits (M9 fix 476): 41,000 characters of hashes,
// past Windows' 32,767-character command line, so they go on stdin. The
// history is written by fast-import in one git: a thousand commits on
// main, the last a merge of a side branch.
test('readMerges finds the one merge among 1,000 hashes', async () => {
  const dir = tempDir();
  execFileSync('git', ['init', '-q', '-b', 'main', '.'], { cwd: dir, windowsHide: true });
  const who = 'committer t <t@t> 1600000000 +0000\n';
  let stream = `commit refs/heads/main\nmark :1\n${who}data 2\nc\n\n`;
  stream += `commit refs/heads/side\nmark :9000\n${who}data 2\ns\nfrom :1\n\n`;
  for (let i = 2; i <= 1000; i++) stream += `commit refs/heads/main\nmark :${i}\n${who}data 2\nc\nfrom :${i - 1}\n${i === 1000 ? 'merge :9000\n' : ''}\n`;
  execFileSync('git', ['fast-import', '--quiet'], { cwd: dir, input: stream, windowsHide: true });
  const hashes = execFileSync('git', ['rev-list', '--first-parent', 'main'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
  assert.equal(hashes.length, 1000);
  assert.ok(hashes.join(' ').length > 32_767);
  const merges = await readMerges(dir, hashes);
  assert.deepEqual([...merges], [hashes[0]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('revListFirstParent with a since keeps a commit and a cherry-pick and credits nothing for a checkout or a fast-forward (M9 fix 470)', async () => {
  const repo = tempDir();
  // The history a call finds already there is an hour old; what the call
  // itself makes carries the clock's own committer date.
  const old = `${Math.floor(Date.now() / 1000) - 3600} +0000`;
  const run = (env: NodeJS.ProcessEnv, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo, windowsHide: true, stdio: 'pipe', env: { ...process.env, ...env } }).toString().trim();
  const past = (...args: string[]) => run({ GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old }, ...args);
  const now = (...args: string[]) => run({}, ...args);
  past('init', '-q', '-b', 'main');
  past('commit', '-q', '--allow-empty', '-m', 'one');
  past('branch', 'feat');
  for (const m of ['two', 'three', 'four']) past('commit', '-q', '--allow-empty', '-m', m);
  const main = past('rev-parse', 'HEAD');
  past('checkout', '-q', 'feat');
  const feat = past('rev-parse', 'HEAD');
  const since = Date.now();
  // A checkout onto a branch three commits ahead: all three are older.
  assert.equal((await revListFirstParent(repo, feat, main, null)).length, 3, 'without a since the walk answers all three, the bug');
  assert.deepEqual(await revListFirstParent(repo, feat, main, since), [], 'a checkout credits nothing');
  // A fast-forward merge moves onto the same three.
  past('merge', '-q', '--ff-only', 'main');
  assert.deepEqual(await revListFirstParent(repo, feat, main, since), [], 'a fast-forward credits nothing');
  // A commit made in the call is kept.
  now('commit', '-q', '--allow-empty', '-m', 'five');
  const five = now('rev-parse', 'HEAD');
  assert.deepEqual(await revListFirstParent(repo, main, five, since), [five], 'a commit is kept');
  // A cherry-pick of an old commit writes a fresh committer date.
  past('checkout', '-q', '-b', 'side', feat);
  fs.writeFileSync(path.join(repo, 'side.txt'), 'side');
  past('add', 'side.txt');
  past('commit', '-q', '-m', 'side');
  const side = past('rev-parse', 'HEAD');
  now('checkout', '-q', 'feat');
  now('cherry-pick', side);
  const picked = now('rev-parse', 'HEAD');
  assert.deepEqual(await revListFirstParent(repo, five, picked, since), [picked], 'a cherry-pick is kept');
  // A range of an old commit and a new one keeps the new one alone, oldest first.
  assert.deepEqual(await revListFirstParent(repo, feat, picked, since), [five, picked], 'the old ones dropped, the new ones in order');
});
