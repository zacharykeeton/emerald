import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UsageWindow } from '../../preload/api.ts';
import { USAGE_FOLDED_TEXT, fiveHourBounds, fiveHourUsage, fiveHourWindow, markUsageFolded, resetUsageReading, setUsageAge, setUsageReading, usageAge, usageAgeText, usageReading } from './usage-reading.ts';

// M9 fix 321: the strip's reading, lifted into a store for the activity
// view's five-hour unit.

const HOUR = 3_600_000;
const RESET = Date.parse('2026-09-19T18:40:27Z');
const five: UsageWindow = { key: 'five_hour', label: '5 hour', kind: 'time', percent: 17, resetsAt: RESET };
const week: UsageWindow = { key: 'seven_day', label: '7 day', kind: 'time', percent: 5, resetsAt: RESET + 6 * 24 * HOUR };
const odd: UsageWindow = { key: 'something_else', label: 'else', kind: 'model', percent: 1, resetsAt: RESET };

test('the five-hour window is the reading\'s five_hour entry, its bounds the reset less five hours to the reset', () => {
  assert.deepEqual(fiveHourUsage([week, five]), five);
  assert.deepEqual(fiveHourBounds([week, five]), { from: RESET - 5 * HOUR, to: RESET });
  assert.equal(fiveHourUsage(null), null);
  assert.equal(fiveHourBounds(null), null);
  assert.equal(fiveHourBounds([]), null);
  assert.equal(fiveHourBounds([week, odd]), null);
});

test('the store holds what the strip last wrote and forgets on reset', () => {
  resetUsageReading();
  assert.equal(usageReading(), null);
  assert.equal(fiveHourWindow(), null);
  const list = [five, week];
  setUsageReading(list);
  assert.equal(usageReading(), list);
  assert.deepEqual(fiveHourWindow(), { from: RESET - 5 * HOUR, to: RESET });
  // The same list again is no change.
  setUsageReading(list);
  setUsageReading(null);
  assert.equal(fiveHourWindow(), null);
  setUsageReading([week]);
  assert.equal(fiveHourWindow(), null);
  resetUsageReading();
  assert.equal(usageReading(), null);
});

test("the age's text is the strip's stale text, else the folded note, else none (M9 fix 766)", () => {
  resetUsageReading();
  assert.equal(usageAgeText(usageAge()), null);
  setUsageAge(RESET, 'Last read 4 min ago; the endpoint is not answering.');
  assert.equal(usageAgeText(usageAge()), 'Last read 4 min ago; the endpoint is not answering.');
  setUsageAge(RESET, null);
  assert.equal(usageAgeText(usageAge()), null);
  markUsageFolded();
  assert.equal(usageAge().folded, true);
  assert.equal(usageAge().fetchedAt, RESET, 'the fold keeps the reading time');
  assert.equal(usageAgeText(usageAge()), USAGE_FOLDED_TEXT);
  assert.equal(usageAgeText({ fetchedAt: RESET, stale: 'stale', folded: true }), 'stale', "the strip's own text wins");
  setUsageAge(RESET + 1000, null);
  assert.equal(usageAge().folded, false, 'a write from the strip clears the fold');
  assert.equal(usageAgeText(usageAge()), null);
  resetUsageReading();
  assert.deepEqual(usageAge(), { fetchedAt: null, stale: null, folded: false });
});
