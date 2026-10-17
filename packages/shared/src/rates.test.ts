import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_RATES, costParts, formatUsd, modelName, modelWord, ratesFor, ratesLookStale, uncachedCost } from './rates.ts';

test('M9 fix 154: the rate table prices each part of the sum and the uncached figure, and knows a model it lacks', () => {
  const opus = ratesFor('Opus 5 (1M context)');
  assert.ok(opus !== null);
  assert.equal(opus.family, 'Opus 5');
  assert.equal(ratesFor('claude-opus-5[1m]')?.family, 'Opus 5', 'the id form');
  assert.equal(ratesFor('Fable 5.1')?.family, 'Fable 5.1');
  assert.equal(ratesFor('claude-sonnet-5')?.family, 'Sonnet 5');
  assert.equal(ratesFor('Haiku 4.5')?.family, 'Haiku 4.5');
  // M9 fix 292: the id form spells the decimal point as a hyphen, which
  // the family's own name spells as a dot; each family with a dotted
  // number in the table (Fable, Haiku) needs its id form proved too, or
  // a status line naming one never matches its own rates.
  assert.equal(ratesFor('claude-fable-5-1')?.family, 'Fable 5.1', 'the id form');
  assert.equal(ratesFor('claude-haiku-4-5')?.family, 'Haiku 4.5', 'the id form');
  assert.equal(ratesFor('claude-sonnet-4-5'), null, 'an older model is not the family whose number it ends with');
  assert.equal(ratesFor('Some Model 9'), null);
  assert.equal(ratesFor(null), null);
  assert.equal(MODEL_RATES.length, 6);
  // M9 fix 444: Opus 5.5's row, and its id form the same way Fable 5.1
  // and Haiku 4.5 need theirs; "opus 5.5" must not read as "opus 5"
  // whichever row comes first in the table.
  assert.equal(ratesFor('Opus 5.5 (1M context)')?.family, 'Opus 5.5');
  assert.equal(ratesFor('claude-opus-5-5')?.family, 'Opus 5.5', 'the id form');
  assert.equal(ratesFor('Opus 5.5')?.fresh, 4);
  assert.equal(ratesFor('Opus 5.5')?.cacheWrite, 5);
  assert.equal(ratesFor('Opus 5.5')?.cacheWrite1h, 8);
  assert.equal(ratesFor('Opus 5.5')?.cacheRead, 0.2);
  assert.equal(ratesFor('Opus 5.5')?.output, 20);
  // A million of each part at Opus 5's rates: the four dollars of the entry.
  const parts = costParts({ fresh: 1_000_000, cacheWrite: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 }, opus);
  assert.deepEqual(parts, { fresh: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25, total: 36.75 });
  // M9 fix 278: a 1-hour cache write prices at 2x fresh, not the
  // 5-minute write's 1.25x; a message with no split (the status line's
  // shape) still prices the whole at the 5-minute rate.
  assert.equal(opus.cacheWrite1h, 10);
  assert.equal(ratesFor('Fable 5.1')?.cacheWrite1h, 20);
  assert.equal(ratesFor('claude-sonnet-5')?.cacheWrite1h, 4);
  assert.equal(ratesFor('Haiku 4.5')?.cacheWrite1h, 2);
  assert.equal(costParts({ fresh: 0, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000, cacheRead: 0, output: 0 }, opus).cacheWrite, 10);
  const mixed = costParts({ fresh: 0, cacheWrite: 1_000_000, cacheWrite1h: 400_000, cacheRead: 0, output: 0 }, opus);
  assert.ok(Math.abs(mixed.cacheWrite - (600_000 / 1e6) * 6.25 - (400_000 / 1e6) * 10) < 1e-9, `600k at the 5-minute rate and 400k at the 1-hour one, got ${mixed.cacheWrite}`);
  assert.equal(costParts({ fresh: 0, cacheWrite: 1_000_000, cacheRead: 0, output: 0 }, opus).cacheWrite, 6.25);
  // A real split: the parts sum to about what Claude Code reported.
  const real = { fresh: 4, cacheWrite: 18518, cacheRead: 1194849, output: 2640 };
  const est = costParts(real, opus);
  assert.ok(Math.abs(est.total - 0.7793) < 0.001, `got ${est.total}`);
  assert.ok(Math.abs(uncachedCost(real, opus) - 6.1329) < 0.001, `got ${uncachedCost(real, opus)}`);
  assert.equal(ratesLookStale(est.total, 0.78), false);
  assert.equal(ratesLookStale(est.total, 1.4), true, 'a total far from the parts says the table is old');
  assert.equal(ratesLookStale(0.5, 0), false, 'nothing to compare against yet');
  // M9 fix 395: dollars and cents at every figure, the dollar rounding
  // past ten gone, so a price that is moving is seen to move.
  assert.equal(formatUsd(1.4029585), '$1.40');
  assert.equal(formatUsd(0.004), '$0.00');
  assert.equal(formatUsd(9.999), '$10.00');
  assert.equal(formatUsd(47.2), '$47.20');
  assert.equal(formatUsd(47.5), '$47.50');
  assert.equal(formatUsd(125.881), '$125.88');
  assert.equal(formatUsd(0), '$0.00');
});

test('M9 fix 287: modelWord names the family the row wears in front of the state', () => {
  assert.equal(modelWord('Opus 5 (1M context)'), 'Opus');
  assert.equal(modelWord('claude-opus-5[1m]'), 'Opus');
  assert.equal(modelWord('Fable 5.1'), 'Fable');
  assert.equal(modelWord('claude-sonnet-5'), 'Sonnet');
  assert.equal(modelWord('Haiku 4.5'), 'Haiku');
  assert.equal(modelWord('claude-fable-5-1'), 'Fable', 'the id form');
  assert.equal(modelWord('claude-haiku-4-5'), 'Haiku', 'the id form');
  assert.equal(modelWord('claude-sonnet-4-5'), null, 'an older model is not the family whose number it ends with');
  assert.equal(modelWord('Some Model 9'), null);
  assert.equal(modelWord(null), null);
  // M9 fix 444: Opus 5.5 reads its own word, and a future point release
  // (a bare, undotted number the table does not carry) still reads the
  // family word alone with ratesFor staying null, so no price is made up.
  assert.equal(modelWord('Opus 5.5 (1M context)'), 'Opus');
  assert.equal(modelWord('claude-opus-5-5'), 'Opus', 'the id form');
  assert.equal(modelWord('claude-opus-6'), 'Opus', 'an unknown point release still reads the family word');
  assert.equal(ratesFor('claude-opus-6'), null, 'but prices nothing made up for it');
});

test('M9 fix 464: a dated single-number id reads its family, and Opus 4.8 has a row', () => {
  assert.equal(ratesFor('claude-sonnet-5-20260301')?.family, 'Sonnet 5');
  assert.equal(ratesFor('claude-opus-5-20260101')?.family, 'Opus 5');
  assert.equal(modelWord('claude-sonnet-5-20260301'), 'Sonnet');
  assert.equal(modelWord('claude-opus-5-20260101'), 'Opus');
  // A dated dotted id still reads its dot.
  assert.equal(ratesFor('claude-haiku-4-5-20251001')?.family, 'Haiku 4.5');
  const o48 = ratesFor('claude-opus-4-8');
  assert.equal(o48?.family, 'Opus 4.8');
  assert.deepEqual([o48?.fresh, o48?.cacheWrite, o48?.cacheWrite1h, o48?.cacheRead, o48?.output], [5, 6.25, 10, 0.5, 25]);
  assert.equal(ratesFor('Opus 4.8')?.family, 'Opus 4.8');
  assert.equal(modelWord('claude-opus-4-8'), 'Opus');
  // Opus 4.8 is not Opus 5 and Opus 5 is not Opus 4.8.
  assert.equal(ratesFor('claude-opus-5')?.family, 'Opus 5');
});

test('M9 fix 821: modelName gives the whole name a card wears, and an id the table lacks as itself', () => {
  assert.equal(modelName('claude-opus-5'), 'Opus 5');
  assert.equal(modelName('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(modelName('claude-opus-6'), 'claude-opus-6');
  assert.equal(modelName(null), null);
});
