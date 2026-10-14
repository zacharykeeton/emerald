import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UsageWindow } from '../preload/api.ts';
import { cappedEdges, cappedNow, usageByKey } from './usage-edges.ts';

const T0 = 1_700_000_000_000;
const win = (key: string, percent: number, resetsAt = T0): UsageWindow => ({ key, label: key, kind: key === 'five_hour' || key === 'seven_day' ? 'time' : 'model', percent, resetsAt });

// M9 fix 285: the edges are the crossings of 100 percent, from below or
// on the first reading, and back under; a reading between crossings is
// nothing, and a capped window that vanishes from the reply is freed.
test('cappedEdges posts capped at the crossing of 100 and freed under it, once each (M9 fix 285)', () => {
  // The first reading: a window already spent is capped from now.
  assert.deepEqual(cappedEdges(null, [win('five_hour', 17), win('seven_day', 100, T0 + 1000)]), [{ kind: 'capped', window: 'seven_day', resetsAt: T0 + 1000 }]);
  const first = usageByKey([win('five_hour', 17), win('seven_day', 100, T0 + 1000)]);
  // The same again: nothing.
  assert.deepEqual(cappedEdges(first, [win('five_hour', 40), win('seven_day', 100, T0 + 1000)]), []);
  // The five-hour window reaches 100, the weekly drops under.
  assert.deepEqual(cappedEdges(first, [win('five_hour', 100, T0 + 500), win('seven_day', 99)]), [
    { kind: 'capped', window: 'five_hour', resetsAt: T0 + 500 },
    { kind: 'freed', window: 'seven_day' },
  ]);
  // A window new to the reply at 100 is capped; one at 100 that vanished is freed.
  const second = usageByKey([win('five_hour', 100, T0 + 500), win('seven_day', 99)]);
  assert.deepEqual(cappedEdges(second, [win('five_hour', 100, T0 + 500), win('seven_day_fable', 100, T0 + 2000)]), [
    { kind: 'capped', window: 'seven_day_fable', resetsAt: T0 + 2000 },
  ]);
  const third = usageByKey([win('five_hour', 100, T0 + 500), win('seven_day_fable', 100, T0 + 2000)]);
  assert.deepEqual(cappedEdges(third, [win('five_hour', 3)]), [
    { kind: 'freed', window: 'five_hour' },
    { kind: 'freed', window: 'seven_day_fable' },
  ]);
  // The windows still capped, for a reconnect.
  assert.deepEqual(cappedNow(null), []);
  assert.deepEqual(cappedNow(third), [
    { kind: 'capped', window: 'five_hour', resetsAt: T0 + 500 },
    { kind: 'capped', window: 'seven_day_fable', resetsAt: T0 + 2000 },
  ]);
});
