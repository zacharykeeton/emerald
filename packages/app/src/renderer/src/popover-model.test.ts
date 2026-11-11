import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unionRect, armsOnMove } from './popover-model.ts';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height });

test('unionRect spans two rects', () => {
  const u = unionRect([rect(10, 20, 30, 15), rect(60, 18, 40, 15)]);
  assert.deepEqual(u, { left: 10, top: 18, right: 100, bottom: 35, width: 90, height: 17 });
});

test('unionRect of none is null, and an empty rect counts for nothing', () => {
  assert.equal(unionRect([]), null);
  assert.equal(unionRect([rect(0, 0, 0, 0)]), null);
  assert.deepEqual(unionRect([rect(0, 0, 0, 0), rect(5, 5, 10, 10)]), rect(5, 5, 10, 10));
});

test('unionRect of one rect is a copy of it', () => {
  const r = rect(3, 4, 5, 6);
  const u = unionRect([r]);
  assert.deepEqual(u, r);
  assert.notEqual(u, r);
});

test('armsOnMove arms a hover on a move only with the hover on, no card open, none pending and no close since the last enter or leave (M9 fix 1154)', () => {
  const clear = { hover: true, open: false, pending: false, quiet: false };
  assert.equal(armsOnMove(clear), true);
  assert.equal(armsOnMove({ ...clear, hover: false }), false);
  assert.equal(armsOnMove({ ...clear, open: true }), false);
  assert.equal(armsOnMove({ ...clear, pending: true }), false);
  assert.equal(armsOnMove({ ...clear, quiet: true }), false);
});
