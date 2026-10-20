import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropWindowBounds, toClient, toScreen, windowAt } from './window-drag-model.ts';

test('windowAt picks the window under a screen point, the shared edge going right (M9 fix 927)', () => {
  const two = [
    { key: 1, bounds: { x: 0, y: 0, width: 1200, height: 800 }, focusedAt: 0 },
    { key: 2, bounds: { x: 1200, y: 0, width: 1200, height: 800 }, focusedAt: 0 },
  ];
  assert.equal(windowAt(two, { x: 1199, y: 10 }, null), 1);
  assert.equal(windowAt(two, { x: 1200, y: 10 }, null), 2);
  assert.equal(windowAt(two, { x: 3000, y: 10 }, null), null);
  assert.equal(windowAt(two, { x: 100, y: 900 }, null), null);
});

test('windowAt takes the window focused last where two overlap, and leaves out the one excepted', () => {
  const overlap = [
    { key: 1, bounds: { x: 0, y: 0, width: 1200, height: 800 }, focusedAt: 5 },
    { key: 2, bounds: { x: 600, y: 0, width: 1200, height: 800 }, focusedAt: 9 },
  ];
  assert.equal(windowAt(overlap, { x: 700, y: 10 }, null), 2);
  assert.equal(windowAt([{ ...overlap[0]!, focusedAt: 10 }, overlap[1]!], { x: 700, y: 10 }, null), 1);
  assert.equal(windowAt(overlap, { x: 700, y: 10 }, 2), 1);
});

test('toScreen and toClient round trip a point at zoom 1 and 1.25', () => {
  const content = { x: 2000, y: 50, width: 1184, height: 770 };
  assert.deepEqual(toScreen(content, 1, { x: 100, y: 40 }), { x: 2100, y: 90 });
  assert.deepEqual(toClient(content, 1, { x: 2100, y: 90 }), { x: 100, y: 40 });
  assert.deepEqual(toScreen(content, 1.25, { x: 100, y: 40 }), { x: 2125, y: 100 });
  assert.deepEqual(toClient(content, 1.25, { x: 2125, y: 100 }), { x: 100, y: 40 });
});

test('dropWindowBounds puts the title row under the drop point, kept inside the work area (M9 fix 928)', () => {
  const size = { width: 1200, height: 800 };
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(dropWindowBounds({ x: 500, y: 100 }, size, area), { x: 380, y: 87, width: 1200, height: 800 });
  // 880 + 1200 and 487 + 800 would cross the area's right and bottom edges.
  assert.deepEqual(dropWindowBounds({ x: 1000, y: 500 }, size, area), { x: 720, y: 240, width: 1200, height: 800 });
  assert.deepEqual(dropWindowBounds({ x: 1900, y: 1030 }, size, area), { x: 720, y: 240, width: 1200, height: 800 });
  assert.deepEqual(dropWindowBounds({ x: 5, y: 5 }, size, area), { x: 0, y: 0, width: 1200, height: 800 });
  const second = { x: 1920, y: 0, width: 2560, height: 1400 };
  assert.deepEqual(dropWindowBounds({ x: 2500, y: 300 }, size, second), { x: 2380, y: 287, width: 1200, height: 800 });
});
