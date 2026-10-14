import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivitySession } from './activity.ts';
import { commitCardModel, commitGroup, previousCommit, pricedAgents, sliceUsage, splitUsage, timesLine } from './commit-card.ts';
import type { SessionCommit } from './session.ts';
import type { UsageMessage } from './transcript.ts';

// M9 fix 252: the six states of docs/design/commit-price.md, as the pure
// model gives them. Times in minutes from a zero.
const min = (m: number) => m * 60_000;
const msg = (at: number, output: number, agentId: string | null = null, model: string | null = 'claude-opus-5'): UsageMessage => ({ at: min(at), agentId, model, fresh: 10, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 1000, output });
const row = (spans: Array<[number, number]>, agentId: string | null = null, lifetime = false): ActivitySession => ({
  sessionId: 's1',
  name: 'batch',
  color: '#fff',
  kind: agentId === null ? 'claude' : 'agent',
  claudeSessionId: 'c1',
  removedAt: null,
  cwd: null,
  groupCwd: null,
  requests: [],
  commits: [],
  lifetime,
  spans: spans.map(([a, b]) => ({ from: min(a), to: min(b), prompt: null })),
  debt: [],
  parentId: agentId === null ? null : 's1',
  agentId,
  agentType: agentId === null ? null : 'fork',
  outside: false,
});
const c = (hash: string, at: number, extra: Partial<SessionCommit> = {}): SessionCommit => ({ hash, at: min(at), ...extra });

test('sliceUsage: the requests inside the window summed, each agent apart, null on an empty window', () => {
  const messages = [msg(1, 100), msg(5, 200, 'a1'), msg(9, 300), msg(20, 400)];
  const got = sliceUsage(messages, min(2), min(10));
  assert.ok(got !== null);
  assert.equal(got.requests, 2);
  assert.deepEqual(got.tokens, { fresh: 20, cacheWrite: 0, cacheRead: 2000, output: 500 });
  // Opus 5: 10 fresh at $5/M, 1000 cache reads at $0.5/M, output at $25/M, per request.
  const price = (output: number) => (10 / 1e6) * 5 + (1000 / 1e6) * 0.5 + (output / 1e6) * 25;
  assert.ok(Math.abs(got.usd! - (price(200) + price(300))) < 1e-12);
  assert.deepEqual(got.agents.map((a) => a.id), ['a1']);
  assert.equal(got.agents[0]!.requests, 1);
  assert.equal(sliceUsage(messages, min(10), min(19)), null);
});

test('sliceUsage: a message with a 1-hour cache write prices that share at the 1-hour rate', () => {
  // Opus 5: $6.25/M at the 5-minute rate, $10/M at the 1-hour one.
  const m: UsageMessage = { at: min(1), agentId: null, model: 'claude-opus-5', fresh: 0, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000, cacheRead: 0, output: 0 };
  const got = sliceUsage([m], 0, min(2));
  assert.ok(got !== null && Math.abs(got.usd! - 10) < 1e-9, `a whole million written at the 1-hour rate is $10, got ${got?.usd}`);
  const half: UsageMessage = { ...m, cacheWrite1h: 500_000 };
  const gotHalf = sliceUsage([half], 0, min(2));
  const expected = (500_000 / 1e6) * 6.25 + (500_000 / 1e6) * 10;
  assert.ok(gotHalf !== null && Math.abs(gotHalf.usd! - expected) < 1e-9, `half at each rate, got ${gotHalf?.usd}`);
});

test('sliceUsage: a model the table lacks counts its tokens and no dollars', () => {
  const got = sliceUsage([msg(1, 100, null, 'claude-3-opus-20240229')], 0, min(2));
  assert.ok(got !== null);
  assert.equal(got.usd, null);
  assert.equal(got.tokens.output, 100);
  const mixed = sliceUsage([msg(1, 100, null, 'claude-3-opus-20240229'), msg(1, 100)], 0, min(2));
  assert.ok(mixed !== null && mixed.usd !== null && mixed.usd > 0);
});

test('state 1, a full slice: two spans clipped to the slice, the figures and the agents note', () => {
  const prev = c('3eaf6db', 2);
  const commit = c('9c1a', 40);
  const rows = [row([[0, 10], [30, 50]]), row([[20, 44]], 'a1')];
  const usage = sliceUsage([msg(1, 5), msg(5, 100), msg(25, 200, 'a1'), msg(35, 300), msg(45, 9)], min(2), min(40));
  const got = commitCardModel(commit, prev, min(0), rows, usage, null);
  assert.deepEqual(got.slice, { fromHash: '3eaf6db', from: min(2), to: min(40) });
  // 2 to 10 and 30 to 40 of the session's own spans.
  assert.equal(got.agentMs, min(18));
  assert.deepEqual(got.tokens, { fresh: 30, cacheWrite: 0, cacheRead: 3000, output: 600 });
  assert.ok(got.cost !== null && got.cost > 0);
  assert.ok(got.agents !== null);
  assert.equal(got.agents.count, 1);
  assert.equal(got.agents.ms, min(20));
  assert.ok(got.agents.usd !== null && got.agents.usd < got.cost);
  assert.equal(got.branch, null);
});

test('state 2, the first commit: the slice runs from the start, no agents note without an agent', () => {
  const commit = c('9c1a', 11);
  const got = commitCardModel(commit, null, min(3), [row([[4, 9]])], sliceUsage([msg(5, 100)], min(3), min(11)), null);
  assert.deepEqual(got.slice, { fromHash: null, from: min(3), to: min(11) });
  assert.equal(got.agentMs, min(5));
  assert.equal(got.agents, null);
});

test('state 4, the transcript gone: cost and tokens not known, the time still off the hooks', () => {
  const got = commitCardModel(c('9c1a', 40), c('3eaf6db', 2), 0, [row([[0, 10]])], null, null);
  assert.equal(got.cost, null);
  assert.equal(got.tokens, null);
  assert.equal(got.agentMs, min(8));
  // And the other way: the daemon not asked, the transcript read.
  const noRows = commitCardModel(c('9c1a', 40), c('3eaf6db', 2), 0, null, sliceUsage([msg(5, 100)], min(2), min(40)), null);
  assert.equal(noRows.agentMs, null);
  assert.ok(noRows.cost !== null);
});

test('state 5, a merge: the branch run rides the model on a merge alone, and only when the walk found something', () => {
  const branch = { commits: 14, usd: 8.4, ms: min(192) };
  const merge = commitCardModel(c('m1', 40, { merge: true }), c('p0', 38), 0, [row([[38, 40]])], sliceUsage([msg(39, 10)], min(38), min(40)), branch);
  assert.deepEqual(merge.branch, branch);
  assert.ok(merge.cost !== null && merge.cost < 0.01, 'the merge prices its own slice, pennies');
  const plain = commitCardModel(c('m2', 40), c('p0', 38), 0, [], null, branch);
  assert.equal(plain.branch, null);
  const empty = commitCardModel(c('m3', 40, { merge: true }), c('p0', 38), 0, [], null, null);
  assert.equal(empty.branch, null);
});

test("state 6, a subagent's own commit: the agent's share is the whole and no agents note", () => {
  const commit = c('a9', 30, { agent: { id: 'a1', branch: 'm61-agent-lanes', type: 'fork', description: null } });
  const rows = [row([[0, 60]]), row([[10, 40]], 'a1')];
  const usage = sliceUsage([msg(12, 100, 'a1'), msg(15, 50), msg(20, 200, 'a1')], min(10), min(30));
  const got = commitCardModel(commit, null, min(10), rows, usage, null);
  assert.deepEqual(got.tokens, { fresh: 20, cacheWrite: 0, cacheRead: 2000, output: 300 });
  assert.equal(got.agentMs, min(20));
  assert.equal(got.agents, null);
});

test('previousCommit: the one before on the same line, the session\'s own and an agent\'s apart', () => {
  const a1 = { id: 'a1', branch: null, type: 'fork', description: null };
  const list = [c('h1', 1), c('h2', 5, { agent: a1 }), c('h3', 7), c('h4', 9, { agent: a1 })];
  assert.equal(previousCommit(list, list[2]!)?.hash, 'h1');
  assert.equal(previousCommit(list, list[3]!)?.hash, 'h2');
  assert.equal(previousCommit(list, list[1]!), null);
  assert.equal(previousCommit(list, list[0]!), null);
});

// M9 fix 275: an agent with a credited commit of its own is priced on
// that commit, so a parent's slice leaves its requests out and names it
// in the elsewhere note; an agent with no commit stays in the slice.
test('fix 275: the priced agents come out of the parent slice and into the elsewhere note', () => {
  const list = [c('h1', 1), c('hb', 20, { agent: { id: 'b', branch: null, type: 'fork', description: null } }), c('h2', 40)];
  const priced = pricedAgents(list);
  assert.deepEqual([...priced], ['b']);
  const messages = [msg(5, 100), msg(10, 200, 'a'), msg(15, 300, 'b'), msg(30, 400)];
  const { own, elsewhere } = splitUsage(messages, min(1), min(40), priced, null);
  assert.ok(own !== null && elsewhere !== null);
  assert.equal(own.requests, 3);
  assert.deepEqual(own.agents.map((a) => a.id), ['a']);
  assert.equal(elsewhere.requests, 1);
  assert.deepEqual(elsewhere.agents.map((a) => a.id), ['b']);
  const whole = sliceUsage(messages, min(1), min(40))!;
  assert.ok(Math.abs(own.usd! + elsewhere.usd! - whole.usd!) < 1e-12, 'the two parts sum to the whole');
  const got = commitCardModel(list[2]!, list[0]!, 0, [row([[0, 40]]), row([[8, 12]], 'a'), row([[14, 16]], 'b')], own, null, { priced, elsewhere });
  assert.ok(Math.abs(got.cost! - own.usd!) < 1e-12, "the parent's cost holds the uncommitted agent's share only");
  assert.deepEqual(got.agents, { count: 1, usd: own.agents[0]!.usd, ms: min(4) }, "the priced agent's row is left out of the note too");
  assert.deepEqual(got.elsewhere, { count: 1, usd: elsewhere.usd });
  // The agent's own commit takes the whole list's share of it: no split.
  const forB = splitUsage(messages, min(1), min(20), priced, 'b');
  assert.equal(forB.elsewhere, null);
  const cardB = commitCardModel(list[1]!, null, min(1), null, forB.own, null, { priced, elsewhere: forB.elsewhere });
  assert.ok(Math.abs(cardB.cost! - whole.agents.find((a) => a.id === 'b')!.usd!) < 1e-12);
  assert.equal(cardB.elsewhere, null);
  // No priced agents: the same as before, no note.
  const plain = splitUsage(messages, min(1), min(40), new Set(), null);
  assert.equal(plain.elsewhere, null);
  assert.equal(plain.own!.requests, 4);
  assert.equal(commitCardModel(list[2]!, list[0]!, 0, null, plain.own, null, { elsewhere: plain.elsewhere }).elsewhere, null);
});

// M9 fix 276: three commits credited at one instant are one group, the
// slice runs from the commit before them, and each carries the group.
test('fix 276: a group credited at one instant shares the slice before it and the count on each', () => {
  const list = [c('h1', 5), c('g1', 30), c('g2', 30), c('g3', 30), c('h5', 50)];
  for (const g of list.slice(1, 4)) assert.equal(previousCommit(list, g)?.hash, 'h1', `${g.hash} prices from before the group`);
  assert.equal(previousCommit(list, list[4]!)?.hash, 'g3');
  assert.deepEqual(commitGroup(list, list[1]!), { size: 3, index: 0, first: 'g1' });
  assert.deepEqual(commitGroup(list, list[3]!), { size: 3, index: 2, first: 'g1' });
  assert.deepEqual(commitGroup(list, list[0]!), { size: 1, index: 0, first: 'h1' });
  const usage = sliceUsage([msg(10, 100), msg(20, 200)], min(5), min(30));
  const cards = list.slice(1, 4).map((g) => commitCardModel(g, previousCommit(list, g), 0, null, usage, null, { group: commitGroup(list, g) }));
  for (const card of cards) {
    assert.deepEqual(card.slice, { fromHash: 'h1', from: min(5), to: min(30) });
    assert.equal(card.cost, usage!.usd);
    assert.equal(card.group?.size, 3);
  }
  assert.equal(commitCardModel(list[0]!, null, 0, null, null, null, { group: commitGroup(list, list[0]!) }).group, null, 'a commit credited alone has no group');
  // An agent's group is its own line's.
  const a1 = { id: 'a1', branch: null, type: 'fork', description: null };
  const mixed = [c('h1', 5), c('a', 30, { agent: a1 }), c('g1', 30), c('g2', 30)];
  assert.deepEqual(commitGroup(mixed, mixed[1]!), { size: 1, index: 0, first: 'a' });
  assert.deepEqual(commitGroup(mixed, mixed[3]!), { size: 2, index: 1, first: 'g1' });
});

test('fix 303: the times line names both clocks when they differ by a minute or more, picked with a twin, committed without, and is absent when they agree', () => {
  const clock = (ms: number) => `t${ms / 60_000}`;
  assert.equal(timesLine(min(45), min(27), true, clock), 'authored t27, picked t45');
  assert.equal(timesLine(min(45), min(27), false, clock), 'authored t27, committed t45');
  assert.equal(timesLine(min(45), min(45), false, clock), null, 'the same instant');
  assert.equal(timesLine(min(45), min(45) - 59_000, true, clock), null, 'under a minute apart is in place');
  assert.equal(timesLine(min(45), min(46), false, clock), 'authored t46, committed t45', 'an author time after the commit (a clock skew) still reads');
});
