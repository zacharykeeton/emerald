import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GraphCommit } from '../../preload/api.ts';
import { twinInfo, twinLineText, twinPillText, twinPillTitle } from './commit-twins-model.ts';

// M9 fix 304: one change on three branches, the original the oldest by
// committer time. The log is newest first.
const c = (hash: string, at: number, twins?: string[]): GraphCommit => ({ hash, parents: [], refs: [], subject: hash, author: 'x', at, authoredAt: at, ...(twins === undefined ? {} : { twins }) });
const commits = [c('p2', 300, ['p1', 'o']), c('p1', 300, ['p2', 'o']), c('o', 100, ['p2', 'p1']), c('lone', 50)];
const branchOf = (hash: string) => ({ p2: 'main', p1: 'second', o: 'first' })[hash] ?? hash.slice(0, 7);

test('twinInfo: the original counts every copy and lists the picks; a pick reads picked and lists the original first', () => {
  const o = twinInfo(commits[2]!, commits, branchOf)!;
  assert.deepEqual([o.original, o.count, o.others], [true, 3, ['p2', 'p1']]);
  assert.deepEqual(o.lines.map(twinLineText), ['picked onto main', 'picked onto second']);
  assert.equal(twinPillText(o), '×3');
  assert.equal(twinPillTitle(o), 'cherry-picked 2 times; hover to see where');
  const p = twinInfo(commits[0]!, commits, branchOf)!;
  assert.deepEqual([p.original, p.count, p.others], [false, 3, ['p1', 'o']]);
  assert.deepEqual(p.lines.map(twinLineText), ['original on first', 'picked onto second']);
  assert.equal(twinPillText(p), 'picked');
});

test('twinInfo: a commit with no twins has none', () => {
  assert.equal(twinInfo(commits[3]!, commits, branchOf), null);
  assert.equal(twinInfo(c('e', 1, []), commits, branchOf), null);
});
