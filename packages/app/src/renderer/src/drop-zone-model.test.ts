import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDGE_BAND, tabDropTarget, zoneAt, zoneToSplit } from './drop-zone-model.ts';

const box = { left: 100, top: 50, width: 400, height: 200 };

test('zoneAt: the middle half both ways is center', () => {
  assert.equal(zoneAt(box, { x: 300, y: 150 }), 'center');
  // The band boundary itself is still center.
  assert.equal(zoneAt(box, { x: 100 + 400 * EDGE_BAND, y: 150 }), 'center');
  assert.equal(zoneAt(box, { x: 300, y: 50 + 200 * EDGE_BAND }), 'center');
});

test('zoneAt: the midpoint of each band is its edge', () => {
  assert.equal(zoneAt(box, { x: 100 + 400 * 0.125, y: 150 }), 'left');
  assert.equal(zoneAt(box, { x: 100 + 400 * 0.875, y: 150 }), 'right');
  assert.equal(zoneAt(box, { x: 300, y: 50 + 200 * 0.125 }), 'top');
  assert.equal(zoneAt(box, { x: 300, y: 50 + 200 * 0.875 }), 'bottom');
});

test('zoneAt: in a corner the nearer edge wins, the horizontal one on the diagonal', () => {
  // 5% in from the left, 15% down from the top: left is nearer.
  assert.equal(zoneAt(box, { x: 120, y: 80 }), 'left');
  // 15% in from the left, 5% down: top is nearer.
  assert.equal(zoneAt(box, { x: 160, y: 60 }), 'top');
  // 10% in from both edges: the tie goes to the horizontal edge.
  assert.equal(zoneAt(box, { x: 140, y: 70 }), 'left');
  assert.equal(zoneAt(box, { x: 460, y: 230 }), 'right');
  assert.equal(zoneAt(box, { x: 120, y: 220 }), 'left');
  assert.equal(zoneAt(box, { x: 440, y: 55 }), 'top');
});

test('zoneAt: outside the box, or a box with no size, is null', () => {
  assert.equal(zoneAt(box, { x: 99, y: 150 }), null);
  assert.equal(zoneAt(box, { x: 501, y: 150 }), null);
  assert.equal(zoneAt(box, { x: 300, y: 49 }), null);
  assert.equal(zoneAt(box, { x: 300, y: 251 }), null);
  assert.equal(zoneAt({ ...box, width: 0 }, { x: 100, y: 150 }), null);
  // The edges themselves count as inside.
  assert.equal(zoneAt(box, { x: 100, y: 150 }), 'left');
  assert.equal(zoneAt(box, { x: 500, y: 150 }), 'right');
});

test('zoneToSplit maps edges to a side of a split and center to none', () => {
  assert.deepEqual(zoneToSplit('left'), { direction: 'row', place: 'before' });
  assert.deepEqual(zoneToSplit('right'), { direction: 'row', place: 'after' });
  assert.deepEqual(zoneToSplit('top'), { direction: 'column', place: 'before' });
  assert.deepEqual(zoneToSplit('bottom'), { direction: 'column', place: 'after' });
  assert.equal(zoneToSplit('center'), null);
});

test('tabDropTarget: another tab, the +, and never the tab on show (M9 fix 651)', () => {
  assert.deepEqual(tabDropTarget('t2', false, 't1'), { tabId: 't2' });
  assert.equal(tabDropTarget('t1', false, 't1'), null, 'the tab on show is no target');
  assert.deepEqual(tabDropTarget(null, true, 't1'), { newTab: true });
  assert.deepEqual(tabDropTarget('t2', true, 't1'), { newTab: true }, 'the + wins over a tab id');
  assert.equal(tabDropTarget(null, false, 't1'), null, 'nothing under the pointer');
  assert.equal(tabDropTarget('t2', false, null), null, 'no layout yet');
  assert.equal(tabDropTarget(null, true, null), null);
  assert.equal(tabDropTarget('t1', false, null), null);
});
