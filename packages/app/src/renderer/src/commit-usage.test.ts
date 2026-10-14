import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UsageMessage } from '@emerald/shared';
import type { ConversationUsage } from '../../preload/api.ts';
import { askUsage, askUsageLive, readUsage, resetUsage, subscribeUsage, usageStats } from './commit-usage.ts';

// The usage store's publishing (M9 fix 352): once per tick for the
// asks, a new lists map only when a held entry changed, and the
// landings that changed nothing coalesced on the settle timer. The
// bridge is a fake window.emerald.history.usage whose answers the test
// hands out one ask at a time.

type Answer = ConversationUsage | null;
const pendingAnswers: Array<{ conversation: string; known: string | null; resolve: (a: Answer) => void }> = [];
(globalThis as { window?: unknown }).window = {
  emerald: {
    history: {
      usage: (conversation: string, known: string | null) =>
        new Promise<Answer>((resolve) => {
          pendingAnswers.push({ conversation, known, resolve });
        }),
    },
  },
};
const message = (at: number): UsageMessage => ({ at, agentId: null, model: 'claude-opus-5', fresh: 10, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0, output: 5 });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const settle = () => new Promise<void>((r) => setTimeout(r, 150));
// Answer the oldest pending ask for the conversation and let its
// landing run (a resolved promise's then and finally are microtasks).
const answer = async (conversation: string, a: Answer) => {
  const i = pendingAnswers.findIndex((p) => p.conversation === conversation);
  assert.ok(i >= 0, `an ask is out for ${conversation}`);
  const p = pendingAnswers.splice(i, 1)[0]!;
  p.resolve(a);
  await tick();
};

test('a start publishes once, after the microtask', async () => {
  resetUsage();
  let notified = 0;
  const off = subscribeUsage(() => (notified += 1));
  askUsage('c1');
  assert.equal(usageStats.asks, 1);
  assert.equal(usageStats.publishes, 0, 'nothing published synchronously');
  await tick();
  assert.equal(usageStats.publishes, 1);
  assert.equal(notified, 1);
  assert.ok(readUsage().asking.has('c1'));
  off();
  await answer('c1', { stamp: 's1', messages: [message(1)] });
  await settle();
});

test('three asks in one tick publish once', async () => {
  resetUsage();
  askUsage('a');
  askUsage('b');
  askUsage('c');
  askUsage('a');
  assert.equal(usageStats.asks, 3, 'the repeat ask while one is in flight is dropped');
  await tick();
  assert.equal(usageStats.publishes, 1);
  assert.deepEqual([...readUsage().asking].sort(), ['a', 'b', 'c']);
  for (const c of ['a', 'b', 'c']) await answer(c, { stamp: 's', messages: [message(1)] });
  await settle();
});

test('a changed reply publishes a new lists object; an unchanged one keeps the old identity and only clears asking', async () => {
  resetUsage();
  askUsage('c2');
  await tick();
  const before = readUsage().lists;
  await answer('c2', { stamp: 's1', messages: [message(1), message(2)] });
  assert.equal(usageStats.publishes, 2, 'the changed landing published at once');
  const after = readUsage();
  assert.notEqual(after.lists, before);
  assert.equal(after.lists.get('c2')?.length, 2);
  assert.equal(after.asking.has('c2'), false);
  // The second ask names the stamp and gets "unchanged" back.
  askUsage('c2');
  await tick();
  assert.equal(pendingAnswers[0]?.known, 's1', 'the ask names the held stamp');
  const held = readUsage().lists;
  const publishesBefore = usageStats.publishes;
  await answer('c2', { stamp: 's1', messages: null });
  assert.equal(usageStats.publishes, publishesBefore, 'an unchanged landing publishes nothing at once');
  assert.equal(readUsage().lists, held, 'the lists map keeps its identity until then');
  assert.ok(readUsage().asking.has('c2'), 'the asking set is published on the settle timer');
  await settle();
  assert.equal(usageStats.publishes, publishesBefore + 1, 'one publish for the asking clear');
  assert.equal(readUsage().lists, held, 'the same lists object still');
  assert.equal(readUsage().asking.has('c2'), false);
});

test('a null answer for a conversation held as null changes nothing; a burst of unchanged landings publishes once', async () => {
  resetUsage();
  askUsage('n');
  await tick();
  await answer('n', null);
  await settle();
  const held = readUsage().lists;
  assert.equal(held.get('n'), null);
  assert.equal(held.has('n'), true);
  const publishesBefore = usageStats.publishes;
  for (const c of ['n', 'p', 'q']) askUsage(c);
  await tick();
  assert.equal(usageStats.publishes, publishesBefore + 1);
  await answer('n', null);
  await answer('p', { stamp: 'sp', messages: null });
  await answer('q', { stamp: 'sq', messages: null });
  assert.equal(usageStats.publishes, publishesBefore + 1, 'no landing published before the timer');
  await settle();
  assert.equal(usageStats.publishes, publishesBefore + 2, 'the three landings published once');
  assert.equal(readUsage().lists, held, 'nothing held changed, so the map is the same object');
  assert.equal(readUsage().asking.size, 0);
});

// The cards' live ask (M9 fix 401): the rows' key does not move while a
// session works, so the cards ask again off the record's own
// lastEventAt, which a push moves on every hook.
test('the live ask asks once for a new event, nothing while the session is quiet, and once for a burst', async () => {
  resetUsage();
  askUsageLive('L', 100);
  assert.equal(usageStats.asks, 1, 'the first ask goes out');
  await tick();
  await answer('L', { stamp: 's1', messages: [message(1)] });
  await settle();

  // Quiet: the same stamp asks nothing, however often it is rendered.
  const asksAfterFirst = usageStats.asks;
  askUsageLive('L', 100);
  askUsageLive('L', 100);
  assert.equal(usageStats.asks, asksAfterFirst, 'a render with the event unmoved asks nothing');

  // A hook moved the record: one more ask, and the answer lands.
  askUsageLive('L', 200);
  assert.equal(usageStats.asks, asksAfterFirst + 1, 'a new event asks again');
  await tick();
  const outAsk = pendingAnswers.find((p) => p.conversation === 'L');
  assert.equal(outAsk?.known, 's1', 'the ask names the stamp it holds, so an unchanged transcript is a stat each');
  await answer('L', { stamp: 's2', messages: [message(1), message(2)] });
  await settle();
  assert.equal(readUsage().lists.get('L')?.length, 2, 'the card sees the newer list');

  // A burst while one is in flight: one ask, the rest dropped.
  const asksBeforeBurst = usageStats.asks;
  askUsageLive('L', 300);
  askUsageLive('L', 400);
  askUsageLive('L', 500);
  assert.equal(usageStats.asks, asksBeforeBurst + 1, 'the in-flight drop keeps a burst of hooks to one ask');
  await tick();
  await answer('L', { stamp: 's2', messages: null });
  await settle();
});

test('the live ask is per conversation and a reset forgets its stamps', async () => {
  resetUsage();
  askUsageLive('A', 10);
  askUsageLive('B', 10);
  assert.equal(usageStats.asks, 2, 'one ask each, the stamp is not shared between conversations');
  await tick();
  await answer('A', { stamp: 'sa', messages: null });
  await answer('B', { stamp: 'sb', messages: null });
  await settle();
  askUsageLive('A', 10);
  assert.equal(usageStats.asks, 2, 'still quiet');
  resetUsage();
  askUsageLive('A', 10);
  assert.equal(usageStats.asks, 1, 'a reset forgets the stamp, so the next mount asks');
  await tick();
  await answer('A', null);
  await settle();
});

// A session that has never had an event (lastEventAt null) still asks
// once, and goes on asking nothing until one arrives.
test('the live ask handles a record with no event yet', async () => {
  resetUsage();
  askUsageLive('N', null);
  assert.equal(usageStats.asks, 1);
  await tick();
  await answer('N', null);
  await settle();
  askUsageLive('N', null);
  assert.equal(usageStats.asks, 1, 'still no event, so no second ask');
  askUsageLive('N', 1);
  assert.equal(usageStats.asks, 2, 'the first event asks');
  await tick();
  await answer('N', null);
  await settle();
});
