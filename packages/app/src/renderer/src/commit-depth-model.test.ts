import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitBranches, commitDepths, leanTitle } from './commit-depth-model.ts';
import type { GraphCommit } from '../../preload/api.ts';

const h = (n: number) => n.toString(16).padStart(40, '0');
const c = (n: number, parents: number[], refs: string[] = []): GraphCommit => ({ hash: h(n), parents: parents.map(h), refs, subject: `c${n}`, author: 'x', at: n * 1000, authoredAt: n * 1000 });
// The log is newest first, as git lists it; the numbers are the time.
const depthsOf = (commits: GraphCommit[], defaultBranch: string | null = 'main') => {
  const m = commitDepths([...commits].sort((a, b) => b.at - a.at), defaultBranch);
  return Object.fromEntries([...m].map(([hash, d]) => [commits.find((x) => x.hash === hash)!.subject, d]));
};

test('commitDepths: the trunk is 0, a branch off it 1, a branch off that 2 (M9 fix 214)', () => {
  // main: c1 c2 c5; a off c2: c3 c4 (tip c4); b off c3: c6 (tip c6).
  const log = [c(1, []), c(2, [1]), c(3, [2]), c(4, [3], ['a']), c(5, [2], ['main']), c(6, [3], ['b'])];
  assert.deepEqual(depthsOf(log), { c1: 0, c2: 0, c5: 0, c3: 1, c4: 1, c6: 2 });
});

test('commitDepths: a merged branch keeps its indent; the merge itself is on the trunk (M9 fix 214)', () => {
  // main: c1 c2 M(c4, merging c3); d: c3 off c1, ref kept.
  const log = [c(1, []), c(2, [1]), c(3, [1], ['d']), c(4, [2, 3], ['main'])];
  assert.deepEqual(depthsOf(log), { c1: 0, c2: 0, c4: 0, c3: 1 });
  // The same with d's ref gone: c3 is still in the log through the
  // merge, and still reads as off the trunk.
  const noRef = [c(1, []), c(2, [1]), c(3, [1]), c(4, [2, 3], ['main'])];
  assert.deepEqual(depthsOf(noRef), { c1: 0, c2: 0, c4: 0, c3: 1 });
});

test('commitDepths: a window without the trunk tip indents nothing (M9 fix 214)', () => {
  const log = [c(1, []), c(2, [1]), c(3, [2], ['a']), c(4, [3], ['b'])];
  assert.deepEqual(depthsOf(log), { c1: 0, c2: 0, c3: 0, c4: 0 }, 'main named, not in the window');
  assert.deepEqual(depthsOf(log, null), { c1: 0, c2: 0, c3: 0, c4: 0 }, 'no default branch at all');
});

test('commitDepths: a branch whose chain runs off the window is one deep, a ref on a trunk commit adds nothing (M9 fix 214)', () => {
  // c2 and c3 are on a branch whose base is past the window's edge (no
  // c0 in the log); the worktree ref w sits on main's tip.
  const log = [c(2, [0]), c(3, [2], ['x']), c(4, [1], ['main', 'w']), c(1, [])];
  assert.deepEqual(depthsOf(log), { c1: 0, c4: 0, c2: 1, c3: 1 });
});

// M9 fix 253: the branch's name beside the depth.
const branchesOf = (commits: GraphCommit[], defaultBranch: string | null = 'main') => {
  const m = commitBranches([...commits].sort((a, b) => b.at - a.at), defaultBranch);
  return Object.fromEntries([...m].map(([hash, b]) => [`c${parseInt(hash, 16)}`, `${b.depth}:${b.branch ?? '-'}${b.mergedInto === null ? '' : '>' + b.mergedInto}`]));
};

test('commitBranches: a ref names the chain its tip reached, the trunk is the default branch, a commit two tips hold takes the nearest (M9 fix 253)', () => {
  // main: c1 c2 c5; a off c2: c3 c4 (tip c4); b off c3: c6 (tip c6).
  const log = [c(1, []), c(2, [1]), c(3, [2]), c(4, [3], ['a']), c(5, [2], ['main']), c(6, [3], ['b'])];
  assert.deepEqual(branchesOf(log), { c1: '0:main', c2: '0:main', c5: '0:main', c3: '1:a', c4: '1:a', c6: '2:b' });
});

test("commitBranches: a chain whose ref went takes its name off the merge's subject, with the branch the merge landed on (M9 fix 253)", () => {
  const merge = (n: number, parents: number[], refs: string[], subject: string): GraphCommit => ({ ...c(n, parents, refs), subject });
  // main: c1 c2 M; fix-stall: c3 c4 off c1, ref gone, merged by M.
  const log = [c(1, []), c(2, [1]), c(3, [1]), c(4, [3]), merge(5, [2, 4], ['main'], "Merge branch 'fix-stall'")];
  assert.deepEqual(branchesOf(log), { c1: '0:main', c2: '0:main', c5: '0:main', c3: '1:fix-stall>main', c4: '1:fix-stall>main' });
  // The `into` form names the branch first too.
  const into = [c(1, []), c(2, [1]), c(3, [1]), merge(5, [2, 3], ['main'], "Merge branch 'fix-x' into main")];
  assert.deepEqual(branchesOf(into), { c1: '0:main', c2: '0:main', c5: '0:main', c3: '1:fix-x>main' });
});

test('commitBranches: a nameless chain has no name, and a window without the trunk names nothing (M9 fix 253)', () => {
  // c3 hangs off c1 through a merge whose subject is not git's.
  const log = [c(1, []), c(2, [1]), c(3, [1]), { ...c(4, [2, 3], ['main']), subject: 'land the fix' }];
  assert.deepEqual(branchesOf(log), { c1: '0:main', c2: '0:main', c4: '0:main', c3: '1:-' });
  assert.deepEqual(branchesOf([c(1, []), c(2, [1], ['a'])], null), { c1: '0:-', c2: '0:-' });
});

test('leanTitle: the leaning subject says which branch and how far off the trunk; the trunk and a nameless chain say nothing (M9 fix 253)', () => {
  assert.equal(leanTitle({ depth: 1, branch: 'fix-stall', mergedInto: 'main' }, 'main'), 'on fix-stall, one branch off main');
  assert.equal(leanTitle({ depth: 2, branch: 'b', mergedInto: null }, 'main'), 'on b, two branches off main');
  assert.equal(leanTitle({ depth: 0, branch: 'main', mergedInto: null }, 'main'), null);
  assert.equal(leanTitle({ depth: 1, branch: null, mergedInto: null }, 'main'), null);
});
