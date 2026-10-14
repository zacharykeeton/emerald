import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, TeamMember, UsageMessage } from '@emerald/shared';
import { sliceUsage } from '@emerald/shared';
import { branchRunOf, commitSlice, creditedCommits, rowCost } from './commit-price-model.ts';
import type { BranchGroup } from './commit-price-model.ts';
import { aMember, aSession } from './test-support.ts';

// M9 fixes 275 and 276: the walk from a record to the row's dollars,
// with a member's commit priced on its own line and left out of the
// parent's, and a group credited at one instant read off the record.
// Times in minutes from a zero.
const min = (m: number) => m * 60_000;
const msg = (at: number, output: number, agentId: string | null = null): UsageMessage => ({ at: min(at), agentId, model: 'claude-opus-5', fresh: 10, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 1000, output });
const member = (id: string, commits: Array<{ hash: string; at: number }>): TeamMember =>
  aMember({ id, type: 'fork', startedAt: min(8), branch: `${id}-branch`, commits: commits.map((c) => ({ hash: c.hash, at: min(c.at) })) });
const session = (over: Partial<SessionInfo> = {}): SessionInfo =>
  aSession({ kind: 'claude', name: 's1', autoName: true, spawnCwd: 'C:\\work\\s1', cwd: 'C:\\work\\s1', groupCwd: 'C:\\work\\s1', conversation: { id: 'conv', cwd: 'C:\\work\\s1', args: [] }, color: '#61afef', ...over });

// One agent (b) commits at 20 on its own line, another (a) never does;
// the session's own commits at 5 and 40.
const rec = session({ commits: [{ hash: 'h1', at: min(5) }, { hash: 'h2', at: min(40) }], team: [member('b', [{ hash: 'hb', at: 20 }])] });
const messages = [msg(2, 50), msg(10, 100, 'a'), msg(15, 200, 'b'), msg(30, 300)];
const lists = new Map<string, UsageMessage[] | null>([['conv', messages]]);

test("fix 275: an own commit's row leaves the committing agent's requests out and names both agent parts", () => {
  const slice = commitSlice(rec, 'h2')!;
  assert.deepEqual([...slice.priced], ['b']);
  const got = rowCost(slice, lists)!;
  const own = sliceUsage(messages, min(5), min(40), (m) => m.agentId !== 'b')!;
  const b = sliceUsage(messages, min(5), min(40))!.agents.find((x) => x.id === 'b')!;
  assert.ok(Math.abs(got.usd - own.usd!) < 1e-12, "the figure is the slice less b's share");
  assert.equal(got.agents?.count, 1);
  assert.deepEqual(got.elsewhere, { count: 1, usd: b.usd });
  // The member's own row is its share of the whole, no elsewhere.
  const forB = rowCost(commitSlice(rec, 'hb')!, lists)!;
  assert.ok(Math.abs(forB.usd - b.usd!) < 1e-12);
  assert.equal(forB.elsewhere, null);
});

test('fix 275: branchRunOf leaves a priced agent out of an own line group', () => {
  const slice = commitSlice(rec, 'h2')!;
  const own: BranchGroup = { sessionId: 's1', agentId: null, conversation: 'conv', from: min(5), to: min(40), count: 1, priced: slice.priced };
  const bLine: BranchGroup = { sessionId: 's1', agentId: 'b', conversation: 'conv', from: min(8), to: min(20), count: 1, priced: slice.priced };
  const run = branchRunOf([own, bLine], lists, null)!;
  const whole = sliceUsage(messages, min(5), min(40))!;
  const b = whole.agents.find((x) => x.id === 'b')!;
  assert.equal(run.commits, 2);
  // The own line's share less b's, plus b's line: b's requests once.
  assert.ok(Math.abs(run.usd! - whole.usd!) < 1e-12, `b counted once (${run.usd} against ${whole.usd})`);
  const unsplit: BranchGroup = { ...own, priced: new Set() };
  assert.ok(branchRunOf([unsplit, bLine], lists, null)!.usd! > whole.usd! + b.usd! - 1e-12, 'without the split b is counted twice');
});

test('fix 276: a group credited at one instant reads its index off the record, the slice from before the group', () => {
  const grouped = session({ commits: [{ hash: 'h1', at: min(5) }, { hash: 'g1', at: min(30) }, { hash: 'g2', at: min(30) }, { hash: 'g3', at: min(30) }] });
  const all = creditedCommits(grouped);
  assert.deepEqual(all.map((c) => c.hash), ['h1', 'g1', 'g2', 'g3'], 'the sort keeps the walk order inside a group');
  const s2 = commitSlice(grouped, 'g2')!;
  assert.deepEqual(s2.group, { size: 3, index: 1, first: 'g1' });
  assert.equal(s2.prev?.hash, 'h1');
  assert.equal(s2.from, min(5));
  const s1 = commitSlice(grouped, 'g1')!;
  assert.equal(s1.group.index, 0);
  assert.equal(commitSlice(grouped, 'h1')!.group.size, 1);
  // Every one of the group prices the same slice.
  const costs = ['g1', 'g2', 'g3'].map((h) => rowCost(commitSlice(grouped, h)!, lists)!.usd);
  assert.ok(costs.every((c) => c === costs[0]));
});
