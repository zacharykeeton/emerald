import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey } from '@emerald/shared';
import { offerDue, pairAfterStart, parsePairs } from './split-offer-model.ts';

const NOW = new Date(2026, 10, 10, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

test('pairAfterStart counts a Claude start within 10 s of an empty split by the local day, and offerDue fires from the third pair on the empty default once (M9 fix 1132)', () => {
  const today = dayKey(NOW);
  const yesterday = dayKey(NOW - DAY);
  assert.deepEqual(pairAfterStart(null, NOW - 3000, NOW), { day: today, count: 1 });
  assert.deepEqual(pairAfterStart({ day: today, count: 2 }, NOW - 3000, NOW), { day: today, count: 3 });
  assert.deepEqual(pairAfterStart({ day: yesterday, count: 5 }, NOW - 3000, NOW), { day: today, count: 1 });
  assert.equal(pairAfterStart({ day: today, count: 2 }, undefined, NOW), null);
  assert.equal(pairAfterStart({ day: today, count: 2 }, NOW - 10_001, NOW), null);

  assert.equal(offerDue({ day: today, count: 3 }, false, 'empty', NOW), true);
  assert.equal(offerDue({ day: today, count: 2 }, false, 'empty', NOW), false);
  assert.equal(offerDue({ day: today, count: 3 }, true, 'empty', NOW), false);
  assert.equal(offerDue({ day: today, count: 3 }, false, 'claude', NOW), false);
  assert.equal(offerDue({ day: today, count: 3 }, false, 'shell', NOW), false);
  assert.equal(offerDue({ day: yesterday, count: 9 }, false, 'empty', NOW), false);

  assert.deepEqual(parsePairs('{"day":"2026-11-10","count":2}'), { day: '2026-11-10', count: 2 });
  assert.equal(parsePairs('x'), null);
  assert.equal(parsePairs('{"day":1}'), null);
  assert.equal(parsePairs(null), null);
});
