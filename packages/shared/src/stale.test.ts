import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STALE_GAP_FACTOR, staleThresholdMs } from './stale.ts';

const FLOOR = 600_000;

test('the stall threshold is three times the median tool gap, floored (M9 fix 232)', () => {
  assert.equal(STALE_GAP_FACTOR, 3);
  // No tool call yet, or one: nothing to measure, the floor stands.
  assert.equal(staleThresholdMs([], FLOOR), FLOOR);
  assert.equal(staleThresholdMs([1000], FLOOR), FLOOR);
  // Quick edits every ten seconds: three times that is under the floor.
  assert.equal(staleThresholdMs([0, 10_000, 20_000, 30_000], FLOOR), FLOOR);
  // A turn of five-minute builds: fifteen minutes before it is quiet.
  assert.equal(staleThresholdMs([0, 300_000, 600_000], FLOOR), 900_000);
  // The median, not the mean: one long gap among quick ones does not
  // stretch the threshold, and an even count takes the middle pair.
  assert.equal(staleThresholdMs([0, 10_000, 20_000, 3_600_000], FLOOR), FLOOR);
  assert.equal(staleThresholdMs([0, 200_000, 500_000, 1_100_000, 1_200_000], FLOOR), 3 * ((200_000 + 300_000) / 2));
  // The floor is whatever the caller says: a script sets it to seconds.
  assert.equal(staleThresholdMs([], 3000), 3000);
  assert.equal(staleThresholdMs([0, 2000, 4000], 3000), 6000);
});
