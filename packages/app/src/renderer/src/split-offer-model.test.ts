import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerDue, pairAfterStart, parsePairs } from './split-offer-model.ts';

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();

test('pairAfterStart counts a Claude start within 45 s of an empty split over any days, an old per-day count is read as its count, and offerDue fires from the third pair on the empty default once (M9 fixes 1132 and 1145)', () => {
  assert.deepEqual(pairAfterStart(null, NOW - 3000, NOW), { count: 1 });
  assert.deepEqual(pairAfterStart({ count: 2 }, NOW - 44_000, NOW), { count: 3 });
  assert.deepEqual(pairAfterStart(parsePairs('{"day":"2026-11-01","count":2}'), NOW - 3000, NOW), { count: 3 });
  assert.equal(pairAfterStart({ count: 2 }, undefined, NOW), null);
  assert.equal(pairAfterStart({ count: 2 }, NOW - 45_001, NOW), null);

  assert.equal(offerDue({ count: 3 }, false, 'empty'), true);
  assert.equal(offerDue({ count: 2 }, false, 'empty'), false);
  assert.equal(offerDue({ count: 3 }, true, 'empty'), false);
  assert.equal(offerDue({ count: 3 }, false, 'claude'), false);
  assert.equal(offerDue({ count: 3 }, false, 'shell'), false);

  assert.deepEqual(parsePairs('{"count":4}'), { count: 4 });
  assert.deepEqual(parsePairs('{"day":"2026-11-10","count":2}'), { count: 2 });
  for (const bad of ['x', '{"day":1}', '{"count":-1}', '{"count":1.5}', null]) assert.equal(parsePairs(bad), null);
});
