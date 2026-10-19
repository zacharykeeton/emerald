import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WindowSets, backgroundSpot, cascadeBounds, planWindows } from './window-plan.ts';

test('planWindows binds the unbound startup window to the first id and opens the rest (M9 fix 866)', () => {
  assert.deepEqual(planWindows(['first'], [], true, true), { bind: 'first', open: [], close: [] });
  assert.deepEqual(planWindows(['first', 'w2'], [], true, true), { bind: 'first', open: ['w2'], close: [] });
  // The first window closed in an earlier run: the startup window takes the one left.
  assert.deepEqual(planWindows(['w2'], [], true, true), { bind: 'w2', open: [], close: [] });
});

test('planWindows opens a new record\'s window and closes a window whose record went', () => {
  assert.deepEqual(planWindows(['first', 'w2'], ['first'], false, true), { bind: null, open: ['w2'], close: [] });
  assert.deepEqual(planWindows(['first'], ['first', 'w2'], false, true), { bind: null, open: [], close: ['w2'] });
  assert.deepEqual(planWindows(['first', 'w3'], ['first', 'w2'], false, true), { bind: null, open: ['w3'], close: ['w2'] });
});

test('planWindows plans nothing to open or close without the lock, but still binds', () => {
  assert.deepEqual(planWindows(['first', 'w2'], [], true, false), { bind: 'first', open: [], close: [] });
  assert.deepEqual(planWindows(['first'], ['first', 'w2'], false, false), { bind: null, open: [], close: [] });
});

test('backgroundSpot keeps the startup window\'s spot and steps later ones a window and a gap right', () => {
  assert.deepEqual(backgroundSpot(3840, 0), [3890, 50]);
  assert.deepEqual(backgroundSpot(3840, 1), [5190, 50]);
});

test('cascadeBounds steps 32 px and wraps at the work area\'s edge', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(cascadeBounds({ x: 100, y: 100, width: 1200, height: 800 }, work), { x: 132, y: 132, width: 1200, height: 800 });
  assert.deepEqual(cascadeBounds({ x: 700, y: 100, width: 1200, height: 800 }, work), { x: 0, y: 0, width: 1200, height: 800 }, 'past the right edge');
  assert.deepEqual(cascadeBounds({ x: 100, y: 220, width: 1200, height: 800 }, work), { x: 0, y: 0, width: 1200, height: 800 }, 'past the bottom edge');
  assert.deepEqual(cascadeBounds({ x: 1940, y: 10, width: 1200, height: 800 }, { x: 1920, y: 0, width: 1920, height: 1040 }), { x: 1972, y: 42, width: 1200, height: 800 }, 'a second display');
});

test('WindowSets answers the union across two windows and drops one window\'s alone', () => {
  const sets = new WindowSets();
  assert.deepEqual(sets.set(1, ['C:\\a', 'C:\\b']), ['C:\\a', 'C:\\b']);
  assert.deepEqual(sets.set(2, ['C:\\b', 'C:\\c']), ['C:\\a', 'C:\\b', 'C:\\c']);
  assert.deepEqual(sets.set(1, ['C:\\a']), ['C:\\a', 'C:\\b', 'C:\\c']);
  assert.deepEqual(sets.drop(2), ['C:\\a']);
  assert.deepEqual(sets.drop(1), []);
  assert.deepEqual(sets.set(3, ['c:\\A', 'C:\\a']), ['c:\\A', 'C:\\a'], 'exact strings');
});
