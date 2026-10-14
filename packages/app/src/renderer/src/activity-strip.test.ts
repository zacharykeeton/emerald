import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivitySession } from '@emerald/shared';
import { bandHeight, percentAt, stripAxis } from './activity-strip.ts';
import { anActivitySession } from './test-support.ts';

const HOUR = 3_600_000;
const day = { from: new Date(2026, 8, 13).getTime(), to: new Date(2026, 8, 14).getTime() };

function session(id: string, spans: Array<[number, number]>): ActivitySession {
  return anActivitySession({ sessionId: id, name: id, spans: spans.map(([f, t]) => ({ from: day.from + f * HOUR, to: day.from + t * HOUR, prompt: null })) });
}

test('the axis runs from the hour before the first span to the hour after now, labelled every hour when short', () => {
  const now = day.from + 11.5 * HOUR;
  const axis = stripAxis([session('a', [[9.25, 10]])], day, now);
  assert.equal(axis.from, day.from + 9 * HOUR);
  assert.equal(axis.to, day.from + 12 * HOUR);
  assert.deepEqual(
    axis.ticks.map((t) => t.label),
    ['09', '10', '11', '12'],
  );
  assert.equal(percentAt(axis, day.from + 10.5 * HOUR), 50);
});

test('with nothing yet the axis is the last hour, and a long day thins its labels', () => {
  const now = day.from + 8.25 * HOUR;
  const empty = stripAxis([], day, now);
  assert.equal(empty.from, day.from + 7 * HOUR);
  assert.equal(empty.to, day.from + 9 * HOUR);
  const long = stripAxis([session('a', [[1, 2]])], day, day.from + 21 * HOUR);
  assert.equal(long.from, day.from + 1 * HOUR);
  assert.equal(long.to, day.from + 22 * HOUR);
  assert.deepEqual(
    long.ticks.filter((t) => t.label !== null).map((t) => t.label),
    ['04', '08', '12', '16', '20'],
  );
});

test('a past day covers its spans only, and the axis never leaves the day', () => {
  const later = day.to + 5 * HOUR;
  const axis = stripAxis([session('a', [[14.5, 16.2]])], day, later);
  assert.equal(axis.from, day.from + 14 * HOUR);
  assert.equal(axis.to, day.from + 17 * HOUR);
  const edge = stripAxis([session('a', [[0, 0.5]]), session('b', [[23.5, 24]])], day, later);
  assert.equal(edge.from, day.from);
  assert.equal(edge.to, day.to);
  assert.equal(percentAt(edge, day.from - HOUR), 0);
  assert.equal(percentAt(edge, day.to + HOUR), 100);
});

test('an hour or a minute window (M67) is the axis whole, ticked in its own step', () => {
  const hour = { from: new Date(2026, 8, 13, 14).getTime(), to: new Date(2026, 8, 13, 15).getTime() };
  const axis = stripAxis([session('a', [[14.2, 14.3]])], hour, hour.from + 20 * 60_000, 'hour');
  assert.equal(axis.from, hour.from);
  assert.equal(axis.to, hour.to);
  assert.equal(axis.ticks.length, 13);
  assert.deepEqual(
    axis.ticks.filter((t) => t.label !== null).map((t) => t.label),
    ['14:00', '14:10', '14:20', '14:30', '14:40', '14:50', '15:00'],
  );
  const minute = { from: new Date(2026, 8, 13, 14, 7).getTime(), to: new Date(2026, 8, 13, 14, 8).getTime() };
  const fine = stripAxis([], minute, minute.to + HOUR, 'minute');
  assert.equal(fine.from, minute.from);
  assert.equal(fine.to, minute.to);
  assert.deepEqual(
    fine.ticks.map((t) => t.label),
    [':00', ':10', ':20', ':30', ':40', ':50', ':00'],
  );
  assert.equal(percentAt(fine, minute.from + 30_000), 50);
});

test("the card's band follows its tracks between a floor and the mock's cap (M9 fix 167)", () => {
  assert.equal(bandHeight(1, 5, 16), 10);
  assert.equal(bandHeight(2, 5, 16), 10);
  assert.equal(bandHeight(3, 5, 16), 15);
  assert.equal(bandHeight(4, 5, 16), 16);
  assert.equal(bandHeight(9, 5, 16), 16);
  assert.equal(bandHeight(9, 5, 22), 22);
});
