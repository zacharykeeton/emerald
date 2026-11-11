import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { ModPoll } from './mod-poll.ts';

function watched(): { poll: ModPoll; record: string[] } {
  const poll = new ModPoll({ holdMs: 200, graceMs: 300 });
  const record: string[] = [];
  poll.watch(
    (id) => record.push(`up:${id}`),
    (id, dropped) => record.push(`down:${id}:${dropped.length}`),
  );
  return { poll, record };
}

test('ModPoll: a push answers a held poll, an empty hold answers none, lines between polls wait for the next, and a poll not asked again within the grace or gone reads down (M9 fix 1125)', async () => {
  // A push answers the held poll at once.
  {
    const { poll, record } = watched();
    const { answer } = poll.poll('a');
    assert.equal(poll.push('a', { text: 'hi', submitId: 'a-1' }), true);
    assert.deepEqual(await answer, { lines: [{ text: 'hi', submitId: 'a-1' }] });
    assert.deepEqual(record, ['up:a']);
    poll.end('a');
  }
  // Nothing pushed: answered with no lines at the hold.
  {
    const { poll } = watched();
    const t = Date.now();
    assert.deepEqual(await poll.poll('a').answer, { lines: [] });
    const took = Date.now() - t;
    assert.ok(took >= 180 && took <= 400, `answered at the hold, took ${took} ms`);
    poll.end('a');
  }
  // Two pushes between polls come back in order on the next poll, at once.
  {
    const { poll } = watched();
    const first = poll.poll('a');
    poll.push('a', { text: 'one', submitId: 'a-1' });
    await first.answer;
    poll.push('a', { text: 'two', submitId: 'a-2' });
    poll.push('a', { context: 'summary' });
    const t = Date.now();
    assert.deepEqual(await poll.poll('a').answer, { lines: [{ text: 'two', submitId: 'a-2' }, { context: 'summary' }] });
    assert.ok(Date.now() - t < 50, 'answered at once');
    poll.end('a');
  }
  // A session never polled takes no push.
  {
    const { poll } = watched();
    assert.equal(poll.push('b', { text: 'x' }), false);
    assert.equal(poll.isUp('b'), false);
  }
  // An answer with no poll after it reads down once after the grace.
  {
    const { poll, record } = watched();
    const held = poll.poll('a');
    poll.push('a', { text: 'hi' });
    await held.answer;
    await sleep(200);
    assert.equal(poll.isUp('a'), true, 'still up inside the grace');
    await sleep(200);
    assert.deepEqual(record, ['up:a', 'down:a:0']);
    assert.equal(poll.push('a', { text: 'late' }), false);
  }
  // Lines queued after an answer and never taken are the dropped ones.
  {
    const { poll, record } = watched();
    const held = poll.poll('a');
    poll.push('a', { text: 'hi' });
    await held.answer;
    poll.push('a', { context: 'full' });
    poll.push('a', { context: 'full' });
    await sleep(400);
    assert.deepEqual(record, ['up:a', 'down:a:2']);
  }
  // gone() on a held poll reads down at once; on an answered one, nothing.
  {
    const { poll, record } = watched();
    const held = poll.poll('a');
    const t = Date.now();
    held.gone();
    assert.ok(Date.now() - t < 50);
    assert.deepEqual(record, ['up:a', 'down:a:0']);
    const { poll: p2, record: r2 } = watched();
    const answered = p2.poll('a');
    p2.push('a', { text: 'hi' });
    await answered.answer;
    answered.gone();
    assert.deepEqual(r2, ['up:a']);
    p2.end('a');
  }
  // A second poll while one is held answers the first replaced, and no second up.
  {
    const { poll, record } = watched();
    const first = poll.poll('a');
    const second = poll.poll('a');
    assert.deepEqual(await first.answer, { replaced: true });
    poll.push('a', { text: 'hi' });
    assert.deepEqual(await second.answer, { lines: [{ text: 'hi' }] });
    assert.deepEqual(record, ['up:a']);
    poll.end('a');
  }
  // end() on an up session answers its held poll with none and reads down.
  {
    const { poll, record } = watched();
    const held = poll.poll('a');
    poll.end('a');
    assert.deepEqual(await held.answer, { lines: [] });
    assert.deepEqual(record, ['up:a', 'down:a:0']);
    assert.equal(poll.isUp('a'), false);
  }
});
