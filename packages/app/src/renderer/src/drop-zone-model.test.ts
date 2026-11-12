import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDGE_BAND, paneDragKind, paneDropLight, paneDropWord, pastEdge, tabDropTarget, zoneAt, zoneToSplit } from './drop-zone-model.ts';

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

test('pastEdge: the window\'s own box is in, from 0 to a pixel short of its size (M9 fix 927)', () => {
  const width = 1200;
  const height = 800;
  assert.equal(pastEdge({ x: 0, y: 0 }, width, height), false);
  assert.equal(pastEdge({ x: width - 1, y: height - 1 }, width, height), false);
  assert.equal(pastEdge({ x: -1, y: 5 }, width, height), true);
  assert.equal(pastEdge({ x: width, y: 5 }, width, height), true);
  assert.equal(pastEdge({ x: 5, y: -1 }, width, height), true);
  assert.equal(pastEdge({ x: 5, y: height }, width, height), true);
});

// M9 fix 1162: the words on the lit part of a pane.
test('paneDropWord: a known file from Explorer types its path on a session, opens by zone elsewhere', () => {
  for (const zone of ['center', 'left', 'right', 'top', 'bottom'] as const) assert.equal(paneDropWord('file', true, zone), 'Type the path');
  assert.equal(paneDropWord('file', false, 'center'), 'Open the file here');
  for (const zone of ['left', 'right', 'top', 'bottom'] as const) assert.equal(paneDropWord('file', false, zone), 'Open the file beside');
});

test('paneDropWord: a drag from Explorer that may be a folder names both outcomes on a session', () => {
  assert.equal(paneDropWord('unknown', true, 'center'), 'Open here, or type the path');
  for (const zone of ['left', 'right', 'top', 'bottom'] as const) assert.equal(paneDropWord('unknown', true, zone), 'Open beside, or type the path');
  assert.equal(paneDropWord('unknown', false, 'center'), 'Open here');
  for (const zone of ['left', 'right', 'top', 'bottom'] as const) assert.equal(paneDropWord('unknown', false, zone), 'Open beside');
});

test('paneDropWord: a Files row or a file tab opens the file whatever the pane holds', () => {
  for (const hasSession of [true, false]) {
    assert.equal(paneDropWord('file-view', hasSession, 'center'), 'Open the file here');
    for (const zone of ['left', 'right', 'top', 'bottom'] as const) assert.equal(paneDropWord('file-view', hasSession, zone), 'Open the file beside');
  }
});

test('paneDropWord: a session, a title or a Commits drag says nothing', () => {
  for (const hasSession of [true, false]) {
    for (const zone of ['center', 'left', 'right', 'top', 'bottom'] as const) assert.equal(paneDropWord('other', hasSession, zone), null);
  }
});

test('paneDragKind: the four shapes', () => {
  const base = { target: null, explorer: false, file: false, view: null };
  assert.equal(paneDragKind({ ...base, explorer: true, file: true }), 'file');
  assert.equal(paneDragKind({ ...base, explorer: true, file: false }), 'unknown');
  assert.equal(paneDragKind({ ...base, view: { kind: 'file' } }), 'file-view');
  assert.equal(paneDragKind({ ...base, view: { kind: 'commits' } }), 'other');
  assert.equal(paneDragKind(base), 'other', 'a session drag');
});

test('paneDropLight: the zone a drag lights and its words', () => {
  const at = (paneId: string, zone: 'left' | 'right' | 'center') => ({ paneId, zone });
  assert.equal(paneDropLight(null, 'p1', true), null);
  assert.equal(paneDropLight({ target: at('p2', 'center'), explorer: true, file: true, view: null }, 'p1', true), null, 'a different pane');
  assert.deepEqual(paneDropLight({ target: at('p1', 'left'), explorer: true, file: true, view: null }, 'p1', true), { zone: 'file', word: 'Type the path' });
  // A view has no session, so the drop goes by zone and the light follows it.
  assert.deepEqual(paneDropLight({ target: at('p1', 'right'), explorer: true, file: true, view: null }, 'p1', false), { zone: 'right', word: 'Open the file beside' });
  assert.deepEqual(paneDropLight({ target: at('p1', 'left'), explorer: false, file: false, view: null }, 'p1', true), { zone: 'left', word: null });
});
