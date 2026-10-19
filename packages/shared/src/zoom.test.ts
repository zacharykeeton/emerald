import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseZoomLevel, stepZoomLevel, zoomPercent } from './zoom.ts';

test('stepZoomLevel clamps to the bounds (M9 fix 900)', () => {
  assert.equal(stepZoomLevel(5, 1), 5);
  assert.equal(stepZoomLevel(-3, -1), -3);
  assert.equal(stepZoomLevel(0, 1), 1);
});

test("zoomPercent is VS Code's 20 percent steps (M9 fix 900)", () => {
  assert.deepEqual(
    [-3, -2, -1, 0, 1, 2, 3, 4, 5].map(zoomPercent),
    [58, 69, 83, 100, 120, 144, 173, 207, 249],
  );
});

test('parseZoomLevel takes an integer within the bounds, else 0 (M9 fix 900)', () => {
  for (const raw of [null, 'x', '1.5', '9', '-4']) assert.equal(parseZoomLevel(raw), 0, String(raw));
  assert.equal(parseZoomLevel('2'), 2);
});
