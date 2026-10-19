import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRepoRoot, gitProjectCounts, versionBumps } from './git-status.ts';

// The Statistics tab's git figures (M9 fix 836). The worker's file is not
// there under node --test, so the real-git cases hand in a runner that
// spawns git here, as git-count-lines.test.ts does.
const realGit = (args: string[], cwd: string): Promise<string | null> => {
  try {
    return Promise.resolve(execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return Promise.resolve(null);
  }
};

const FIRST = '2026-09-10T19:04:04';

function pkg(version: string): string {
  return `{\n  "name": "x",\n  "version": "${version}"\n}\n`;
}

function commit(dir: string, message: string, date?: string): void {
  const env = { ...process.env, ...(date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) };
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir, stdio: 'ignore', env });
}

test('gitProjectCounts reads the commits, the first commit, the tags and the version bumps of a package.json on the default branch (M9 fix 836)', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-project-counts-')));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Verify'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'verify@example.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' });
    fs.writeFileSync(path.join(dir, 'package.json'), pkg('0.1.0'));
    commit(dir, 'start', FIRST);
    fs.writeFileSync(path.join(dir, 'package.json'), pkg('0.2.0'));
    commit(dir, 'bump');
    fs.writeFileSync(path.join(dir, 'package.json'), pkg('0.3.0'));
    commit(dir, 'bump again');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'package.json'), pkg('1.0.0'));
    commit(dir, 'sub');
    fs.writeFileSync(path.join(dir, 'sub', 'package.json'), pkg('1.1.0'));
    commit(dir, 'sub bump');
    const counts = await gitProjectCounts(dir, null, realGit);
    const base = { root: dir, branch: 'main', commits: 5, firstCommitAt: new Date(FIRST).getTime(), tags: 0, bumps: 2, bumpsFile: 'package.json' };
    assert.deepEqual(counts, base);
    // M9 fix 885: from the day after the first commit on, the four commits
    // dated now, and package.json's 0.2.0 and 0.3.0.
    const from = new Date('2026-09-11T00:00:00').getTime();
    assert.deepEqual(await gitProjectCounts(dir, from, realGit), { ...base, since: { from, commits: 4, tags: 0, bumps: 2 } });
    execFileSync('git', ['tag', 'v1'], { cwd: dir, stdio: 'ignore' });
    assert.equal((await gitProjectCounts(path.join(dir, 'sub'), null, realGit)).tags, 1, 'a folder inside the repo reads the repo');
    assert.equal((await gitProjectCounts(dir, from, realGit)).since?.tags, 1, 'a tag made now is after the day');
    assert.equal((await gitProjectCounts(dir, Date.now() + 86_400_000, realGit)).since?.tags, 0, 'and none after tomorrow');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('gitProjectCounts outside any repo, or on a relative path, answers zeros and runs nothing (M9 fix 836)', async () => {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-project-none-')));
  try {
    const runs: string[][] = [];
    const run = (args: string[]) => {
      runs.push(args);
      return Promise.resolve('');
    };
    const none = { root: null, branch: null, commits: 0, firstCommitAt: null, tags: 0, bumps: 0, bumpsFile: null };
    // The temp folder sits under no repo on this box; findRepoRoot says so
    // first, so the case reads the answer rather than the box.
    assert.equal(findRepoRoot(dir), null);
    assert.deepEqual(await gitProjectCounts(dir, null, run), none);
    assert.deepEqual(runs, [] as string[][]);
    assert.deepEqual(await gitProjectCounts('relative/path', null, run), none);
    assert.deepEqual(runs, [] as string[][]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('versionBumps counts each file\'s distinct values less one, ties to the shorter path then the first, a deleted file adding nothing (M9 fix 836)', () => {
  const chunk = (hash: string, file: string, lines: string[]) => `\x1e${hash}\n\ndiff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -3 +3 @@\n${lines.join('\n')}\n`;
  // Newest first, as git log writes it: back to an earlier value is not a second bump.
  const back = chunk('c', 'package.json', ['-  "version": "0.2.0"', '+  "version": "0.1.0"']) + chunk('b', 'package.json', ['-  "version": "0.1.0"', '+  "version": "0.2.0"']) + chunk('a', 'package.json', ['+  "version": "0.1.0"']);
  assert.deepEqual(versionBumps(back), { bumps: 1, file: 'package.json' });
  const tie = chunk('b', 'packages/b/package.json', ['+  "version": "2.0.0"']) + chunk('a', 'packages/b/package.json', ['+  "version": "1.0.0"']) + chunk('d', 'packages/a/package.json', ['+  "version": "2.0.0"']) + chunk('c', 'packages/a/package.json', ['+  "version": "1.0.0"']) + chunk('f', 'apps/x/package.json', ['+  "version": "2.0.0"']) + chunk('e', 'apps/x/package.json', ['+  "version": "1.0.0"']);
  assert.deepEqual(versionBumps(tie), { bumps: 1, file: 'apps/x/package.json' }, 'the shorter path wins a tie');
  const sameLength = chunk('b', 'b/package.json', ['+  "version": "2.0.0"']) + chunk('a', 'b/package.json', ['+  "version": "1.0.0"']) + chunk('d', 'a/package.json', ['+  "version": "2.0.0"']) + chunk('c', 'a/package.json', ['+  "version": "1.0.0"']);
  assert.deepEqual(versionBumps(sameLength), { bumps: 1, file: 'a/package.json' }, 'then the alphabetically first');
  const deleted = `\x1eh\n\ndiff --git a/package.json b/package.json\n--- a/package.json\n+++ /dev/null\n@@ -3 +0,0 @@\n-  "version": "9.0.0"\n` + chunk('a', 'package.json', ['+  "version": "1.0.0"']);
  assert.deepEqual(versionBumps(deleted), { bumps: 0, file: null });
  assert.deepEqual(versionBumps(''), { bumps: 0, file: null });
});

test('versionBumps with since counts the picked file\'s bumps from that time on, the first value never one (M9 fix 885)', () => {
  const chunk = (hash: string, seconds: number, lines: string[]) => `\x1e${hash} ${seconds}\n\ndiff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -3 +3 @@\n${lines.join('\n')}\n`;
  const v = (n: string) => `+  "version": "${n}"`;
  // Newest first, as git log writes it.
  const log = chunk('c', 300, [v('0.3.0')]) + chunk('b', 200, [v('0.2.0')]) + chunk('a', 100, [v('0.1.0')]);
  assert.deepEqual(versionBumps(log, 250_000), { bumps: 2, file: 'package.json', bumpsSince: 1 });
  assert.deepEqual(versionBumps(log, 150_000), { bumps: 2, file: 'package.json', bumpsSince: 2 });
  assert.deepEqual(versionBumps(log, 50_000), { bumps: 2, file: 'package.json', bumpsSince: 2 }, 'the first value is where the file started');
  const back = chunk('c', 300, [v('0.1.0')]) + chunk('b', 200, [v('0.2.0')]) + chunk('a', 100, [v('0.1.0')]);
  assert.deepEqual(versionBumps(back, 250_000), { bumps: 1, file: 'package.json', bumpsSince: 0 }, 'back to an earlier value is no bump');
  assert.deepEqual(versionBumps('', 250_000), { bumps: 0, file: null, bumpsSince: 0 });
});
