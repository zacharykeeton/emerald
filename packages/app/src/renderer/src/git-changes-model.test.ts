import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsText, defaultBranchOf, folderCounts, folderCountsTitle, parseGraph, parseLog, parseMerged, parseNameStatus, parseNumstat, parsePatchIds, parseWorktrees, remoteSessionOf, splitSince, twinGroups, twinOriginal } from './git-changes-model.ts';
import type { ChangedFile, GraphCommit } from '../../preload/api.ts';

test('parseNumstat: counts per path, a binary as nulls, a rename keyed by its new path', () => {
  const out = ['3\t1\tsrc/a.ts', '-\t-\timg/x.png', '0\t0\t', 'src/old.ts', 'src/new.ts', '12\t0\tdocs/new.md'].join('\0') + '\0';
  const c = parseNumstat(out, 'C:/repo');
  assert.deepEqual(c.get('c:\\repo\\src\\a.ts'), [3, 1]);
  assert.deepEqual(c.get('c:\\repo\\img\\x.png'), [null, null], 'a binary file');
  assert.deepEqual(c.get('c:\\repo\\src\\new.ts'), [0, 0], 'the renamed-to path');
  assert.equal(c.get('c:\\repo\\src\\old.ts'), undefined, 'the renamed-from path is gone');
  assert.deepEqual(c.get('c:\\repo\\docs\\new.md'), [12, 0], 'the entry after the rename is not swallowed');
  assert.equal(parseNumstat('', 'C:/repo').size, 0, 'a clean tree');
});

test('parseLog: one commit per line, the fields on the unit separator, a bad line skipped', () => {
  const out = 'abc1234\x1fdocs: the plan\x1fZachary\x1f1789200000\x1fhttps://claude.ai/code/session_01abc\nfff\x1fno time\n\ndef5678\x1fsubject with \t tab and | pipe\x1fClaude\x1f1789100000\x1f\n';
  const commits = parseLog(out);
  assert.deepEqual(commits, [
    { hash: 'abc1234', subject: 'docs: the plan', author: 'Zachary', at: 1789200000000, claudeSession: 'session_01abc' },
    { hash: 'def5678', subject: 'subject with \t tab and | pipe', author: 'Claude', at: 1789100000000, claudeSession: null },
  ]);
  assert.deepEqual(parseLog(''), []);
  // Two trailers on one commit come joined by NUL (M58); the first is taken.
  assert.equal(remoteSessionOf('https://claude.ai/code/session_first\0https://claude.ai/code/session_second'), 'session_first');
  assert.equal(remoteSessionOf('not a url'), null);
  assert.equal(remoteSessionOf(undefined), null);
});

test('splitSince: commits at or after the session started go first, by time alone', () => {
  const commits = parseLog('a\x1fnew\x1fx\x1f200\nb\x1fat the start\x1fx\x1f100\nc\x1fold\x1fx\x1f50\n');
  const { since, earlier } = splitSince(commits, 100_000);
  assert.deepEqual(
    since.map((c) => c.hash),
    ['a', 'b'],
  );
  assert.deepEqual(
    earlier.map((c) => c.hash),
    ['c'],
  );
  assert.deepEqual(splitSince(commits, null).since, [], 'no session, nothing is since');
  assert.deepEqual(
    splitSince(commits, 100_900).since.map((c) => c.hash),
    ['a', 'b'],
    'a session started 900 ms into the second of a commit counts the commit as since',
  );
});

test('countsText: the plus and the minus, nothing without numbers', () => {
  assert.equal(countsText(3, 1), '+3 \u22121');
  assert.equal(countsText(0, 0), '+0 \u22120');
  assert.equal(countsText(null, null), null, 'an untracked or binary file');
});

const graphLine = (hash: string, parents: string, decorations: string, subject: string, at: number) => [hash, parents, decorations, subject, 'x', String(at)].join('\x1f');

test('parseGraph: parents split on spaces, local branches kept as short names, the head marker read, the rest of the decorations dropped', () => {
  const out = [
    graphLine('c', 'b', 'HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1', 'merge', 300),
    graphLine('b', 'a', 'refs/heads/feature', 'on the branch', 200),
    graphLine('a', '', '', 'root', 100),
    'not a line',
  ].join('\n');
  const g = parseGraph(out);
  assert.equal(g.head, 'main');
  assert.equal(g.headHash, 'c');
  assert.deepEqual(
    g.commits.map((c) => [c.hash, c.parents, c.refs, c.subject, c.at]),
    [
      ['c', ['b'], ['main'], 'merge', 300000],
      ['b', ['a'], ['feature'], 'on the branch', 200000],
      ['a', [], [], 'root', 100000],
    ],
  );
});

test('parseGraph: with remotes the remote branches are kept apart, less the HEAD pointer and less one folded into the local branch of its name (M9 fix 286)', () => {
  const out = [
    graphLine('c', 'b', 'HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD', 'tip', 300),
    graphLine('b', 'a', 'refs/remotes/origin/feature, refs/remotes/upstream/main', 'only on the remote', 200),
    graphLine('a', '', 'refs/heads/feature', 'root', 100),
  ].join('\n');
  const g = parseGraph(out, true);
  assert.deepEqual(
    g.commits.map((c) => [c.hash, c.refs, c.remoteRefs]),
    [
      ['c', ['main'], []],
      ['b', [], ['origin/feature', 'upstream/main']],
      ['a', ['feature'], []],
    ],
  );
  // Without remotes the field is absent, so nothing downstream changes.
  assert.equal(parseGraph(out).commits[1]!.remoteRefs, undefined);
});

test('parseGraph: the committer time is the row\'s at and the author time rides beside it; a line without the second takes the one for both (M9 fix 303)', () => {
  const picked = [graphLine('p', 'a', 'refs/heads/main', 'picked', 100), '160', ''].join('\x1f');
  const g = parseGraph([picked, graphLine('a', '', 'refs/heads/first', 'original', 100)].join('\n'));
  assert.deepEqual(
    g.commits.map((c) => [c.hash, c.at, c.authoredAt]),
    [
      ['p', 160000, 100000],
      ['a', 100000, 100000],
    ],
  );
  // The trailer is still the last field when the committer time is there.
  const withTrailer = [graphLine('t', 'p', '', 'traced', 200), '200', 'https://claude.ai/code/session_01xyz'].join('\x1f');
  assert.equal(parseGraph(withTrailer).commits[0]!.claudeSession, 'session_01xyz');
});

test('parseGraph: a merge has two parents and a detached head marks the commit with no branch', () => {
  const g = parseGraph([graphLine('m', 'p1 p2', 'HEAD', 'merge', 3), graphLine('p1', 'r', 'refs/heads/main', 'one', 2)].join('\n'));
  assert.deepEqual(g.commits[0]!.parents, ['p1', 'p2']);
  assert.equal(g.head, null);
  assert.equal(g.headHash, 'm');
});

test('defaultBranchOf: main, else master, else the head', () => {
  const c = (refs: string[]): GraphCommit => ({ hash: 'h', parents: [], refs, subject: '', author: '', at: 0, authoredAt: 0 });
  assert.equal(defaultBranchOf([c(['feature']), c(['master']), c(['main'])], 'feature'), 'main');
  assert.equal(defaultBranchOf([c(['feature']), c(['master'])], 'feature'), 'master');
  assert.equal(defaultBranchOf([c(['feature'])], 'feature'), 'feature');
  assert.equal(defaultBranchOf([], null), null);
});

test('parseMerged: one name a line, the default left out', () => {
  assert.deepEqual(parseMerged('feature\nmain\n\nold\n', 'main'), ['feature', 'old']);
  assert.deepEqual(parseMerged('', 'main'), []);
  // The remote list (M9 fix 286): origin/HEAD is a pointer, not a branch.
  assert.deepEqual(parseMerged('origin/HEAD\norigin/main\norigin/old\n', 'main'), ['origin/main', 'origin/old']);
});

test('parseWorktrees (M68): the path of every entry, the main checkout first, as git prints it', () => {
  const out = ['worktree C:/Users/x/code/repo', 'HEAD abc', 'branch refs/heads/main', '', 'worktree C:/Users/x/code/repo-wt/fix', 'HEAD def', 'branch refs/heads/fix', '', ''].join(String.fromCharCode(10));
  assert.deepEqual(parseWorktrees(out), ['C:/Users/x/code/repo', 'C:/Users/x/code/repo-wt/fix']);
  assert.deepEqual(parseWorktrees(''), []);
});

test('parseNameStatus: a letter per path, a rename keyed by its new path and marked R', () => {
  const out = ['M', 'src/a.ts', 'A', 'docs/new.md', 'R100', 'src/old.ts', 'src/new.ts', 'D', 'gone.txt'].join('\0') + '\0';
  const f = parseNameStatus(out, 'C:/repo');
  assert.deepEqual(f.get('c:\\repo\\src\\a.ts'), { rel: 'src/a.ts', letter: 'M' });
  assert.deepEqual(f.get('c:\\repo\\docs\\new.md'), { rel: 'docs/new.md', letter: 'A' });
  assert.deepEqual(f.get('c:\\repo\\src\\new.ts'), { rel: 'src/new.ts', letter: 'R' }, 'the renamed-to path, without the score');
  assert.equal(f.get('c:\\repo\\src\\old.ts'), undefined);
  assert.deepEqual(f.get('c:\\repo\\gone.txt'), { rel: 'gone.txt', letter: 'D' }, 'the entry after the rename is not swallowed');
  assert.equal(parseNameStatus('', 'C:/repo').size, 0, 'a clean tree');
});

test('folderCounts (M9 fix 197): the files under a folder summed, whatever is expanded; nothing under a clean one', () => {
  const file = (rel: string, added: number | null, removed: number | null): ChangedFile => ({ path: 'C:/repo/' + rel, rel, code: ' M', status: 'modified', added, removed });
  const changes = { root: 'C:/repo', files: [file('src/a.ts', 3, 1), file('src/deep/b.ts', 52, 21), file('new.txt', null, null), file('srcx/c.ts', 9, 9)] };
  const src = folderCounts(changes, 'C:\\repo\\src');
  assert.deepEqual(src, { files: 2, added: 55, removed: 22 }, 'two files under src, the nested one included, srcx not taken for src');
  assert.equal(folderCountsTitle(src), '2 files, +55 −22');
  assert.equal(folderCounts(changes, 'C:\\repo\\docs'), null, 'a folder with no changed file under it');
  assert.deepEqual(folderCounts(changes, 'C:\\repo'), { files: 4, added: 64, removed: 31 }, 'the root sums everything');
  const fresh = folderCounts({ root: 'C:/repo', files: [file('lib/x.ts', null, null)] }, 'C:/repo/lib');
  assert.deepEqual(fresh, { files: 1, added: null, removed: null }, 'an untracked file counts with no numbers');
  assert.equal(folderCountsTitle(fresh), '1 file');
});

test('fix 304: the patch-id lines answer the hashes asked, a merge with no line is null, and a hash not asked is dropped', () => {
  const ids = parsePatchIds('p1 a\np1 b\np2 c\np9 zzz\n\n', ['a', 'b', 'c', 'm']);
  assert.deepEqual([...ids], [['a', 'p1'], ['b', 'p1'], ['c', 'p2'], ['m', null]]);
});

test('fix 304: twins are the other hashes sharing a patch id, in the log order; a lone id and a null are not in the answer', () => {
  const twins = twinGroups(new Map([['a', 'p1'], ['m', null], ['b', 'p1'], ['c', 'p2'], ['d', 'p1']]));
  assert.deepEqual([...twins], [['a', ['b', 'd']], ['b', ['a', 'd']], ['d', ['a', 'b']]]);
  assert.equal(twinGroups(new Map([['a', 'p1'], ['b', null]])).size, 0);
});

test('fix 304: the original is the earliest committer time, the lowest row on a tie', () => {
  const at = (hash: string, t: number, ...rest: string[]) => [graphLine(hash, '', '', hash, t), String(t), ...rest].join('\x1f');
  const g = parseGraph([at('c', 300), at('b', 300), at('a', 100)].join('\n'));
  assert.equal(twinOriginal(['c', 'b', 'a'], g.commits), 'a');
  assert.equal(twinOriginal(['c', 'b'], g.commits), 'b', 'the same second: the row further down');
  assert.equal(twinOriginal(['zzz'], g.commits), null, 'a twin not on the graph');
});
