import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ConflictReport, SessionInfo } from '@emerald/shared';
import { ConflictWatch, parseMergeTree } from './conflicts.ts';

const quiet = { info() {}, warn() {} };

function session(id: string, cwd: string, branch: string | null, over: Partial<SessionInfo> = {}): SessionInfo {
  return { id, kind: 'shell', name: id, color: '#123456', state: 'idle', stateSince: 0, createdAt: 0, cwd, branch, commits: [], ...over } as SessionInfo;
}

// A repository with a default branch, two branches that rewrite the
// same line of one file (a and b), one that adds a file of its own (c),
// and worktrees for each so every session has a folder of its own.
function repo(): { root: string; wt: (b: string) => string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-conflicts-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString();
  git('init', '-q', '-b', 'main', '.');
  git('config', 'user.email', 'test@emerald');
  git('config', 'user.name', 'emerald test');
  fs.writeFileSync(path.join(root, 'f.txt'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(root, 'g.txt'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const wt = (b: string) => path.join(root, '..', path.basename(root) + '-' + b);
  for (const b of ['a', 'b', 'c']) git('worktree', 'add', '-q', '-b', b, wt(b), 'main');
  fs.writeFileSync(path.join(wt('a'), 'f.txt'), 'ONE\ntwo\nthree\n');
  execFileSync('git', ['commit', '-q', '-am', 'a'], { cwd: wt('a'), windowsHide: true });
  fs.writeFileSync(path.join(wt('b'), 'f.txt'), 'uno\ntwo\nthree\n');
  fs.writeFileSync(path.join(wt('b'), 'g.txt'), 'y\n');
  execFileSync('git', ['commit', '-q', '-am', 'b'], { cwd: wt('b'), windowsHide: true });
  fs.writeFileSync(path.join(wt('c'), 'c.txt'), 'z\n');
  execFileSync('git', ['add', 'c.txt'], { cwd: wt('c'), windowsHide: true });
  execFileSync('git', ['commit', '-q', '-m', 'c'], { cwd: wt('c'), windowsHide: true });
  // main moves on by one, so every branch is one behind.
  fs.writeFileSync(path.join(root, 'h.txt'), 'h\n');
  git('add', 'h.txt');
  git('commit', '-q', '-m', 'main moves');
  return { root, wt };
}

test('parseMergeTree reads the paths under the tree, none for a clean merge', () => {
  // `-z` answers (M9 fix 475): the tree, then each path, NUL-ended.
  assert.deepEqual(parseMergeTree('6ab5f0d614d5b683022d73b1995197d9eceaff1c\0f.txt\0src/x.ts\0'), ['f.txt', 'src/x.ts']);
  assert.deepEqual(parseMergeTree('ff028fca41233884910356b02e9af97d580ab460\0'), []);
  // A name git would quote without -z comes back as written, space and all.
  assert.deepEqual(parseMergeTree('e2851e5319c0cf46c0655e4fefa8e3770f20a4b1\0plain.txt\0ü f.txt\0'), ['plain.txt', 'ü f.txt']);
});

test('two branches that rewrite one line pair on the file, a branch that touches another does not, and every branch reads its base against main', async () => {
  const { root, wt } = repo();
  const sessions = [session('s-a', wt('a'), 'a'), session('s-b', wt('b'), 'b'), session('s-c', wt('c'), 'c'), session('s-main', root, 'main')];
  const watch = new ConflictWatch({ list: () => sessions, log: quiet });
  const changes: ConflictReport[] = [];
  watch.on('changed', (r: ConflictReport) => changes.push(r));
  await watch.poll();
  const report = watch.current();
  assert.deepEqual(report.conflicts, [{ a: 's-a', b: 's-b', files: ['f.txt'] }]);
  assert.equal(changes.length, 1);
  for (const id of ['s-a', 's-b', 's-c']) {
    const b = report.base[id]!;
    assert.equal(b.ahead, 1, id);
    assert.equal(b.behind, 1, id);
    assert.equal(b.defaultBranch, 'main');
    assert.ok(b.forkedAt > 1_600_000_000_000, `forkedAt is a time (${b.forkedAt})`);
    assert.equal(b.repo, report.base['s-main']!.repo, 'one repository key across the worktrees');
  }
  assert.deepEqual({ ahead: report.base['s-main']!.ahead, behind: report.base['s-main']!.behind }, { ahead: 0, behind: 0 });
  // A second poll with nothing moved changes nothing and emits nothing.
  await watch.poll();
  assert.equal(changes.length, 1);
  // An exited session leaves the forecast at once.
  sessions[0] = session('s-a', wt('a'), 'a', { state: 'exited' });
  await watch.poll();
  assert.deepEqual(watch.current().conflicts, []);
  assert.equal('s-a' in watch.current().base, false);
  assert.equal(changes.length, 2);
  watch.stop();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const b of ['a', 'b', 'c']) fs.rmSync(wt(b), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('a session with no branch, two on one branch, and one in another repository never pair', async () => {
  const { root, wt } = repo();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-conflicts-other-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: other, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).toString();
  git('init', '-q', '-b', 'main', '.');
  git('config', 'user.email', 'test@emerald');
  git('config', 'user.name', 'emerald test');
  fs.writeFileSync(path.join(other, 'f.txt'), 'ONE\n');
  git('add', '.');
  git('commit', '-q', '-m', 'other');
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-conflicts-plain-'));
  const sessions = [session('s-a', wt('a'), 'a'), session('s-a2', wt('a'), 'a'), session('s-b', wt('b'), 'b'), session('s-o', other, 'main'), session('s-p', plain, null)];
  const watch = new ConflictWatch({ list: () => sessions, log: quiet });
  await watch.poll();
  const report = watch.current();
  assert.deepEqual(report.conflicts, [{ a: 's-a', b: 's-b', files: ['f.txt'] }, { a: 's-a2', b: 's-b', files: ['f.txt'] }]);
  assert.equal('s-p' in report.base, false, 'no base without a branch');
  assert.equal(report.base['s-o']!.repo === report.base['s-a']!.repo, false, 'the other repository has its own key');
  watch.stop();
  for (const d of [root, other, plain, wt('a'), wt('b'), wt('c')]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('the manager pushes that move a record are gathered into one poll, a status line alone asks none', async () => {
  let listed = 0;
  const watch = new ConflictWatch({
    list: () => {
      listed += 1;
      return [];
    },
    debounceMs: 5,
    git: async () => null,
    head: async () => null,
  });
  const s = session('s', 'C:/x', 'main');
  watch.onSessionChanged(s);
  watch.onSessionChanged({ ...s, contextPercent: 5 } as SessionInfo);
  watch.onSessionChanged({ ...s, commits: [{ hash: 'a'.repeat(40), at: 1 }] } as SessionInfo);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(listed, 1, 'three pushes, one poll');
  watch.onSessionChanged({ ...s, contextPercent: 9, commits: [{ hash: 'a'.repeat(40), at: 1 }] } as SessionInfo);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(listed, 1, 'a status line moves nothing the forecast reads');
  watch.onSessionRemoved('s');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(listed, 2, 'a removal polls');
  watch.stop();
});

// A git older than 2.38 has no `merge-tree --write-tree` (the backlog
// entry of 2026-09-28): one warn at start and no merge-tree over two
// polls, where 2.38 runs the pair. Two folders of one fake repository,
// on two branches at two heads, so the pair would run.
test('a git older than 2.38 turns the pairs off with one warn, 2.38 runs them', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-conflicts-old-'));
  fs.mkdirSync(path.join(root, '.git'));
  for (const d of ['one', 'two']) fs.mkdirSync(path.join(root, d));
  const sessions = [session('s-1', path.join(root, 'one'), 'x'), session('s-2', path.join(root, 'two'), 'y')];
  for (const version of ['git version 2.37.1.windows.1', 'git version 2.38.0']) {
    const calls: string[] = [];
    const warns: string[] = [];
    const watch = new ConflictWatch({
      list: () => sessions,
      pollMs: 60_000,
      log: { info() {}, warn: (msg: string) => warns.push(msg) },
      git: async (args) => {
        calls.push(args.join(' '));
        return args.includes('--version') ? `${version}\n` : null;
      },
      head: async (cwd) => (cwd.endsWith('one') ? 'a'.repeat(40) : 'b'.repeat(40)),
    });
    watch.start();
    await watch.poll();
    await watch.poll();
    watch.stop();
    const mergeTrees = calls.filter((c) => c.includes('merge-tree')).length;
    if (version.includes('2.37')) {
      assert.deepEqual(warns, ['conflict forecast off: git 2.37.1 is older than 2.38, which merge-tree --write-tree needs']);
      assert.equal(mergeTrees, 0);
    } else {
      assert.deepEqual(warns, [] as string[]);
      assert.ok(mergeTrees > 0, 'the pair runs on 2.38');
    }
    assert.equal(calls.filter((c) => c.includes('--version')).length, 1, 'the version is read once');
  }
  fs.rmSync(root, { recursive: true, force: true });
});
