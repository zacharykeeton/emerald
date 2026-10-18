import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LayoutNode, SingleTree } from './layout.ts';
import type { Rect } from './tree.ts';
import {
  LayoutError,
  MAX_RATIO,
  MIN_RATIO,
  closePane,
  cycleFocus,
  defaultLayout,
  dropAtRight,
  dropSession,
  dropView,
  findPane,
  findSplit,
  firstPane,
  focusPane,
  gridTree,
  listPanes,
  neighborPane,
  paneRects,
  paneShowing,
  parentSplit,
  setPaneSession,
  setPaneView,
  setRatio,
  splitPane,
  subtreeHas,
  validateLayout,
  validateSingleTree,
  isSingleTree,
  wrapSingleTree,
} from './tree.ts';

// Deterministic ids: p1, p2, ... for the tests to name nodes by.
function counter(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

// One empty pane with the revision on it, the tree shape from before M36:
// the tree ops take any root with a focus, and this one costs one id, so
// the node names below stay as they were.
function defaultTree(ids: () => string): SingleTree {
  const id = ids();
  return { root: { kind: 'pane', id, sessionId: null, view: null }, focusedPaneId: id, revision: 0 };
}

// Builds A | (B / C): A on the left, B above C on the right.
//   +-----+-----+
//   |     |  B  |
//   |  A  +-----+
//   |     |  C  |
//   +-----+-----+
function threePanes(): { layout: SingleTree; a: string; b: string; c: string; outer: string; inner: string } {
  const ids = counter();
  let layout = defaultTree(ids); // n1 = A
  layout = splitPane(layout, 'n1', 'row', ids); // n2 = B, n3 = outer split
  layout = splitPane(layout, 'n2', 'column', ids); // n4 = C, n5 = inner split
  return { layout, a: 'n1', b: 'n2', c: 'n4', outer: 'n3', inner: 'n5' };
}

test('defaultLayout is one tab named Panes with one empty focused pane, at revision 0', () => {
  const layout = defaultLayout(counter());
  assert.deepEqual(layout, {
    tabs: [{ id: 'n2', name: 'Panes', root: { kind: 'pane', id: 'n1', sessionId: null, view: null }, focusedPaneId: 'n1' }],
    currentTabId: 'n2',
    revision: 0,
  });
});

test('splitPane can put the new pane before the old one, and parentSplit finds the split that holds a pane', () => {
  const ids = counter();
  const before = defaultTree(ids); // n1
  const after = splitPane(before, 'n1', 'row', ids, 'before'); // n2 new pane, n3 split
  assert.ok(after.root.kind === 'split');
  assert.equal(after.root.first.id, 'n2', 'new pane first');
  assert.equal(after.root.second.id, 'n1');
  assert.equal(after.focusedPaneId, 'n2');
  assert.equal(parentSplit(after, 'n1')?.id, 'n3');
  assert.equal(parentSplit(after, 'n2')?.id, 'n3');
  assert.equal(parentSplit(before, 'n1'), null, 'the root pane has no parent');
  assert.equal(subtreeHas(after.root.first, 'n2'), true);
  assert.equal(subtreeHas(after.root.first, 'n1'), false);
  assert.equal(firstPane(after.root).id, 'n2');
});

test('splitPane keeps the old pane first, adds an empty pane second and focuses it', () => {
  const ids = counter();
  const before = { ...defaultTree(ids), revision: 7 };
  const after = splitPane(before, 'n1', 'row', ids);
  assert.deepEqual(after.root, {
    kind: 'split',
    id: 'n3',
    direction: 'row',
    ratio: 0.5,
    first: { kind: 'pane', id: 'n1', sessionId: null, view: null },
    second: { kind: 'pane', id: 'n2', sessionId: null, view: null },
  });
  assert.equal(after.focusedPaneId, 'n2');
  assert.equal(after.revision, 7, 'revision is carried through for the daemon to check');
  assert.equal(before.root.kind, 'pane', 'input is not mutated');
});

test('splitPane on an unknown pane throws', () => {
  assert.throws(() => splitPane(defaultTree(counter()), 'nope', 'row'), LayoutError);
});

test('splitPane leaves untouched subtrees with the same identity', () => {
  const { layout, a, b } = threePanes();
  const after = splitPane(layout, b, 'row', counter());
  assert.ok(after.root.kind === 'split');
  assert.equal(after.root.first, findPane(layout, a), 'A subtree was not copied');
});

test('listPanes and findPane and findSplit', () => {
  const { layout, a, b, c, outer, inner } = threePanes();
  assert.deepEqual(listPanes(layout).map((p) => p.id), [a, b, c]);
  assert.equal(findPane(layout, c)?.id, c);
  assert.equal(findPane(layout, outer), null, 'a split is not a pane');
  assert.equal(findSplit(layout, inner)?.direction, 'column');
  assert.equal(findSplit(layout, a), null, 'a pane is not a split');
});

test('closePane collapses the parent split into the sibling', () => {
  const { layout, a, b, c, outer } = threePanes();
  const after = closePane(layout, b);
  assert.ok(after.root.kind === 'split' && after.root.id === outer);
  assert.deepEqual(listPanes(after).map((p) => p.id), [a, c]);
  assert.equal(after.root.second.id, c, 'C took the inner split slot');
});

test('closePane moves focus to a pane inside the sibling when the focused pane closes', () => {
  const { layout, a, b, c } = threePanes();
  const focusedOnA = focusPane(layout, a);
  const after = closePane(focusedOnA, a);
  assert.equal(after.focusedPaneId, b);
  assert.deepEqual(listPanes(after).map((p) => p.id), [b, c]);
  assert.ok(after.root.kind === 'split' && after.root.direction === 'column', 'the inner split became the root');
});

test('closePane keeps focus when another pane closes', () => {
  const { layout, a, c } = threePanes();
  const after = closePane(focusPane(layout, a), c);
  assert.equal(after.focusedPaneId, a);
});

test('closePane on the last pane empties it, is a no-op when it is empty, and on an unknown pane throws', () => {
  const layout = defaultTree(counter());
  assert.equal(closePane(layout, 'n1'), layout, 'already empty');
  const showing = setPaneSession(layout, 'n1', 'sess');
  const after = closePane(showing, 'n1');
  assert.equal(after.root.kind, 'pane', 'still one pane');
  assert.equal(findPane(after, 'n1')?.sessionId, null, 'now empty');
  assert.equal(after.focusedPaneId, 'n1');
  assert.throws(() => closePane(layout, 'nope'), LayoutError);
});

test('setRatio changes only the one split and clamps', () => {
  const { layout, outer, inner } = threePanes();
  const after = setRatio(layout, inner, 0.25);
  assert.equal(findSplit(after, inner)?.ratio, 0.25);
  assert.equal(findSplit(after, outer)?.ratio, 0.5, 'nothing propagates');
  assert.equal(findSplit(setRatio(layout, inner, 0), inner)?.ratio, MIN_RATIO);
  assert.equal(findSplit(setRatio(layout, inner, 2), inner)?.ratio, MAX_RATIO);
  assert.throws(() => setRatio(layout, inner, Number.NaN), LayoutError);
  assert.throws(() => setRatio(layout, 'n1', 0.5), LayoutError, 'a pane has no ratio');
});

// Three panes in one direction, every ratio 0.5, with the inner split on
// the outer's `nested` side: (A, (B, C)) for 'second', ((A, B), C) for
// 'first'. A is at the start, C at the end and B is the pane against the
// outer gutter either way.
function threeInARow(direction: 'row' | 'column', nested: 'first' | 'second'): { layout: SingleTree; a: string; b: string; c: string; outer: string; inner: string } {
  const ids = counter();
  let layout = defaultTree(ids); // n1
  layout = splitPane(layout, 'n1', direction, ids); // n2, n3 = outer
  if (nested === 'second') {
    layout = splitPane(layout, 'n2', direction, ids); // n4, n5 = inner: (n1, (n2, n4))
    return { layout, a: 'n1', b: 'n2', c: 'n4', outer: 'n3', inner: 'n5' };
  }
  layout = splitPane(layout, 'n1', direction, ids); // n4, n5 = inner: ((n1, n4), n2)
  return { layout, a: 'n1', b: 'n4', c: 'n2', outer: 'n3', inner: 'n5' };
}

function near(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

// The rects are products of ratios, so a pane that stayed put can be an
// ulp off; compare within a tolerance.
function sameRect(a: Map<string, Rect>, b: Map<string, Rect>, id: string): boolean {
  const ra = a.get(id);
  const rb = b.get(id);
  assert.ok(ra !== undefined && rb !== undefined, `pane ${id} has a rect on both sides`);
  return near(ra.x, rb.x, 1e-9) && near(ra.y, rb.y, 1e-9) && near(ra.width, rb.width, 1e-9) && near(ra.height, rb.height, 1e-9);
}

// Where a pane starts and how long it is along the direction.
function along(rects: Map<string, Rect>, id: string, direction: 'row' | 'column'): { start: number; length: number } {
  const r = rects.get(id);
  assert.ok(r !== undefined, `pane ${id} has a rect`);
  return direction === 'row' ? { start: r.x, length: r.width } : { start: r.y, length: r.height };
}

for (const direction of ['row', 'column'] as const) {
  test(`setRatio on the outer gutter of (A, (B, C)) keeps the inner divider still, ${direction}`, () => {
    const { layout, a, b, c, outer, inner } = threeInARow(direction, 'second');
    const before = paneRects(layout);
    const after = setRatio(layout, outer, 0.3);
    const rects = paneRects(after);
    assert.equal(findSplit(after, outer)?.ratio, 0.3);
    // A ended at 0.5 and B/C's divider sat at 0.75; A now ends at 0.3 and
    // the divider is still at 0.75, so B took the whole 0.2.
    assert.ok(sameRect(rects, before, c), 'C did not move');
    assert.ok(near(along(rects, b, direction).start, 0.3, 1e-9), 'B starts where A ends');
    assert.ok(near(along(rects, b, direction).length, 0.45, 1e-9), 'B took the change');
    assert.ok(near(along(rects, a, direction).length, 0.3, 1e-9));
    assert.ok(near(findSplit(after, inner)?.ratio ?? 0, 1 - (0.5 * 0.5) / 0.7, 1e-9), 'the inner ratio was rescaled');
    // Back again lands on the ratios it started from.
    const back = setRatio(after, outer, 0.5);
    assert.ok(near(findSplit(back, inner)?.ratio ?? 0, 0.5, 1e-9), 'a drag back restores the inner ratio');
  });

  test(`setRatio on the outer gutter of ((A, B), C) keeps the inner divider still, ${direction}`, () => {
    const { layout, a, b, c, outer, inner } = threeInARow(direction, 'first');
    const before = paneRects(layout);
    assert.ok(near(along(before, b, direction).start, 0.25, 1e-9), 'the fixture has A/B at 0.25');
    const after = setRatio(layout, outer, 0.7);
    const rects = paneRects(after);
    // C started at 0.5 and now at 0.7; A/B's divider stays at 0.25 and B
    // grew by the 0.2.
    assert.ok(sameRect(rects, before, a), 'A did not move');
    assert.ok(near(along(rects, b, direction).start, 0.25, 1e-9), 'the inner divider is where it was');
    assert.ok(near(along(rects, b, direction).length, 0.45, 1e-9), 'B took the change');
    assert.ok(near(along(rects, c, direction).start, 0.7, 1e-9));
    assert.ok(near(findSplit(after, inner)?.ratio ?? 0, (0.5 * 0.5) / 0.7, 1e-9), 'the inner ratio was rescaled');
  });
}

test('setRatio walks through a cross-direction split and down a chain', () => {
  // column(A, row(B, column(C, D))): the row is in the way of the outer
  // column drag, and C/D's divider under it must keep its y.
  const ids = counter();
  let layout = defaultTree(ids); // n1 = A
  layout = splitPane(layout, 'n1', 'column', ids); // n2 = B, n3 = outer column
  layout = splitPane(layout, 'n2', 'row', ids); // n4 = C, n5 = row
  layout = splitPane(layout, 'n4', 'column', ids); // n6 = D, n7 = inner column
  const before = paneRects(layout);
  const after = setRatio(layout, 'n3', 0.2);
  const rects = paneRects(after);
  assert.ok(sameRect(rects, before, 'n6'), 'D did not move');
  assert.ok(near(rects.get('n4')!.y, 0.2, 1e-9), 'C starts where A now ends');
  assert.ok(near(rects.get('n4')!.height, 0.55, 1e-9), 'C took the change');
  assert.ok(near(rects.get('n2')!.y, 0.2, 1e-9) && near(rects.get('n2')!.height, 0.8, 1e-9), 'B fills the row');
  assert.equal(findSplit(after, 'n5')?.ratio, 0.5, 'the row in the way keeps its ratio');

  // A chain two deep on the moving side: (A, (B, (C, D))) in a row; the
  // scale carried past the first rescaled split is against the box it
  // now fills, so D's divider stays too.
  const chain = counter();
  let deep = defaultTree(chain); // n1
  deep = splitPane(deep, 'n1', 'row', chain); // n2, n3
  deep = splitPane(deep, 'n2', 'row', chain); // n4, n5
  deep = splitPane(deep, 'n4', 'row', chain); // n6, n7
  const deepBefore = paneRects(deep);
  const deepAfter = paneRects(setRatio(deep, 'n3', 0.1));
  assert.ok(sameRect(deepAfter, deepBefore, 'n6'), 'the innermost pane did not move');
  assert.ok(sameRect(deepAfter, deepBefore, 'n4'), 'the next one did not either');
  assert.ok(near(deepAfter.get('n2')!.x, 0.1, 1e-9) && near(deepAfter.get('n2')!.width, 0.65, 1e-9), 'the pane against the gutter took it all');
});

test('setRatio clamps a rescaled nested ratio and walks on from the clamped value', () => {
  const { layout, b, c, outer, inner } = threeInARow('row', 'second');
  // The inner split at 0.1 gives B a tenth of the right half; dragging the
  // outer gutter to 0.9 asks B for less than nothing, so its ratio stops
  // at the floor and C gives up the rest.
  const thin = setRatio(layout, inner, 0.1);
  const after = setRatio(thin, outer, 0.9);
  assert.equal(findSplit(after, inner)?.ratio, MIN_RATIO);
  const rects = paneRects(after);
  assert.ok(near(rects.get(b)!.width, 0.1 * MIN_RATIO, 1e-9), 'B is at the floor of the remaining box');
  assert.ok(near(rects.get(c)!.width, 0.1 * (1 - MIN_RATIO), 1e-9), 'C fills the rest');
  // The other way, ((A, B), C) with B thin, the ceiling.
  const first = threeInARow('row', 'first');
  const wide = setRatio(first.layout, first.inner, 0.9);
  const ceiling = setRatio(wide, first.outer, 0.1);
  assert.equal(findSplit(ceiling, first.inner)?.ratio, MAX_RATIO);
});

test('setPaneSession and paneShowing', () => {
  const { layout, a, b } = threePanes();
  const after = setPaneSession(layout, b, 'sess-1');
  assert.equal(findPane(after, b)?.sessionId, 'sess-1');
  assert.equal(findPane(after, a)?.sessionId, null);
  assert.equal(paneShowing(after, 'sess-1')?.id, b);
  assert.equal(paneShowing(after, 'sess-2'), null);
  assert.equal(findPane(setPaneSession(after, b, null), b)?.sessionId, null);
  assert.throws(() => setPaneSession(layout, 'nope', 'x'), LayoutError);
});

test('dropSession in the center fills an empty pane and replaces in an occupied one', () => {
  const { layout, a, b } = threePanes();
  const filled = dropSession(layout, 'sess-1', b, null);
  assert.equal(findPane(filled, b)?.sessionId, 'sess-1');
  assert.equal(filled.focusedPaneId, b);
  assert.equal(listPanes(filled).length, 3);
  // A hidden session dropped on a pane that shows another takes it over;
  // the other is no longer shown anywhere.
  const replaced = dropSession(filled, 'sess-2', b, null);
  assert.equal(findPane(replaced, b)?.sessionId, 'sess-2');
  assert.equal(paneShowing(replaced, 'sess-1'), null);
  assert.equal(replaced.focusedPaneId, b);
  assert.equal(findPane(replaced, a)?.sessionId, null);
});

test('dropSession on an edge splits the target with the session on that side', () => {
  const ids = counter();
  const single = defaultTree(ids); // n1
  const right = dropSession(single, 'sess-1', 'n1', { direction: 'row', place: 'after' }, ids); // n2 pane, n3 split
  assert.deepEqual(right.root, {
    kind: 'split',
    id: 'n3',
    direction: 'row',
    ratio: 0.5,
    first: { kind: 'pane', id: 'n1', sessionId: null, view: null },
    second: { kind: 'pane', id: 'n2', sessionId: 'sess-1', view: null },
  });
  assert.equal(right.focusedPaneId, 'n2');
  // A fresh layout per side so the counter's ids never collide with n1.
  const drop = (direction: 'row' | 'column', place: 'before' | 'after') => {
    const fresh = counter();
    return dropSession(defaultTree(fresh), 'sess-1', 'n1', { direction, place }, fresh);
  };
  const left = drop('row', 'before');
  assert.equal(left.root.kind, 'split');
  if (left.root.kind !== 'split') return;
  assert.equal(left.root.direction, 'row');
  assert.deepEqual(left.root.first, { kind: 'pane', id: 'n2', sessionId: 'sess-1', view: null });
  const top = drop('column', 'before');
  assert.equal(top.root.kind === 'split' && top.root.direction === 'column' && top.root.first.id === 'n2', true);
  const bottom = drop('column', 'after');
  assert.equal(bottom.root.kind === 'split' && bottom.root.direction === 'column' && bottom.root.second.id === 'n2', true);
});

test('dropSession mirrors a session already on screen and ignores a centre drop on its own pane', () => {
  const { layout, a, b, c, outer } = threePanes();
  const shown = setPaneSession(layout, c, 'sess-1');
  // C's session onto A's right: C keeps it, and A's half of the outer
  // split now holds A and a new pane showing it too (M50).
  // Ids apart from the fixture's, or the new pane would share A's.
  const fresh = () => {
    let n = 0;
    return () => `m${++n}`;
  };
  const mirrored = dropSession(shown, 'sess-1', a, { direction: 'row', place: 'after' }, fresh());
  assert.equal(findPane(mirrored, c)?.sessionId, 'sess-1', 'the pane it was in keeps it');
  assert.equal(listPanes(mirrored).length, 4);
  const root = mirrored.root;
  assert.equal(root.kind === 'split' && root.id === outer && root.second.kind === 'split' && root.second.first.id === b, true);
  if (root.kind !== 'split' || root.first.kind !== 'split') throw new Error('expected A to be split');
  assert.equal(root.first.direction, 'row');
  assert.equal(root.first.first.id, a);
  assert.equal(root.first.second.kind === 'pane' && root.first.second.sessionId, 'sess-1');
  assert.equal(mirrored.focusedPaneId, root.first.second.id);
  // Center onto another pane shows it there too.
  const centered = dropSession(shown, 'sess-1', a, null);
  assert.equal(findPane(centered, c)?.sessionId, 'sess-1');
  assert.equal(findPane(centered, a)?.sessionId, 'sess-1');
  assert.equal(centered.focusedPaneId, a);
  // Its own pane's centre: the same object back. Its edge: a mirror beside it.
  assert.equal(dropSession(shown, 'sess-1', c, null), shown);
  const beside = dropSession(shown, 'sess-1', c, { direction: 'row', place: 'after' }, fresh());
  assert.equal(listPanes(beside).filter((p) => p.sessionId === 'sess-1').length, 2);
  assert.throws(() => dropSession(shown, 'sess-1', 'nope', null), LayoutError);
});

test('focusPane', () => {
  const { layout, a } = threePanes();
  assert.equal(focusPane(layout, a).focusedPaneId, a);
  assert.throws(() => focusPane(layout, 'nope'), LayoutError);
});

test('cycleFocus walks the panes in tree order and wraps both ways', () => {
  const { layout, a, b, c } = threePanes();
  const at = (id: string) => focusPane(layout, id);
  assert.equal(cycleFocus(at(a), 1).focusedPaneId, b);
  assert.equal(cycleFocus(at(b), 1).focusedPaneId, c);
  assert.equal(cycleFocus(at(c), 1).focusedPaneId, a, 'wraps forward');
  assert.equal(cycleFocus(at(a), -1).focusedPaneId, c, 'wraps backward');
  assert.equal(cycleFocus(at(c), -1).focusedPaneId, b);
  assert.equal(cycleFocus(at(a), 3).focusedPaneId, a, 'a full lap');
  const single = defaultTree(counter());
  assert.equal(cycleFocus(single, 1), single, 'nowhere to go with one pane');
  assert.throws(() => cycleFocus({ ...layout, focusedPaneId: 'ghost' }, 1), LayoutError);
});

test('paneRects tiles the unit square by ratio', () => {
  const { layout, a, b, c, outer } = threePanes();
  const rects = paneRects(setRatio(layout, outer, 0.25));
  assert.deepEqual(rects.get(a), { x: 0, y: 0, width: 0.25, height: 1 });
  assert.deepEqual(rects.get(b), { x: 0.25, y: 0, width: 0.75, height: 0.5 });
  assert.deepEqual(rects.get(c), { x: 0.25, y: 0.5, width: 0.75, height: 0.5 });
});

test('neighborPane follows geometry, not tree order', () => {
  const { layout, a, b, c } = threePanes();
  // From A both B and C touch the right edge; B and C overlap equally, so the
  // first one seen wins, which is B in tree order.
  assert.equal(neighborPane(layout, a, 'right')?.id, b);
  assert.equal(neighborPane(layout, b, 'left')?.id, a);
  assert.equal(neighborPane(layout, c, 'left')?.id, a);
  assert.equal(neighborPane(layout, b, 'down')?.id, c);
  assert.equal(neighborPane(layout, c, 'up')?.id, b);
  assert.equal(neighborPane(layout, a, 'left'), null);
  assert.equal(neighborPane(layout, a, 'up'), null);
  assert.equal(neighborPane(layout, b, 'right'), null);
  assert.equal(neighborPane(layout, b, 'up'), null);
  assert.equal(neighborPane(layout, c, 'down'), null);
  assert.throws(() => neighborPane(layout, 'nope', 'left'), LayoutError);
});

test('neighborPane picks the pane with the largest shared edge', () => {
  // Split A row-wise into A | X, then X column-wise into B / C with B tall,
  // then A column-wise into D / E with a low divider. E's right edge is
  // mostly shared with B even though C also touches it.
  const ids = counter();
  let layout = defaultTree(ids); // n1 = A
  layout = splitPane(layout, 'n1', 'row', ids); // n2 = X, n3
  layout = splitPane(layout, 'n2', 'column', ids); // n2 = B, n4 = C, n5
  layout = setRatio(layout, 'n5', 0.9);
  layout = splitPane(layout, 'n1', 'column', ids); // n1 = D, n6 = E, n7
  layout = setRatio(layout, 'n7', 0.2);
  assert.equal(neighborPane(layout, 'n6', 'right')?.id, 'n2', 'E sees B');
  assert.equal(neighborPane(layout, 'n1', 'right')?.id, 'n2', 'D sees B');
  assert.equal(neighborPane(layout, 'n4', 'left')?.id, 'n6', 'C sees E');
  assert.equal(neighborPane(layout, 'n2', 'left')?.id, 'n6', 'B overlaps E more than D');
});

test('neighborPane tolerates float noise on edges from nested ratios', () => {
  // Three nested row splits with ratios whose products do not land on clean
  // binary fractions. Every pane must still find its left and right neighbor.
  const ids = counter();
  let layout = defaultTree(ids);
  layout = splitPane(layout, 'n1', 'row', ids); // n2, split n3
  layout = setRatio(layout, 'n3', 0.3);
  layout = splitPane(layout, 'n2', 'row', ids); // n4, split n5
  layout = setRatio(layout, 'n5', 0.7);
  layout = splitPane(layout, 'n4', 'row', ids); // n6, split n7
  layout = setRatio(layout, 'n7', 0.1);
  assert.equal(neighborPane(layout, 'n1', 'right')?.id, 'n2');
  assert.equal(neighborPane(layout, 'n2', 'right')?.id, 'n4');
  assert.equal(neighborPane(layout, 'n4', 'right')?.id, 'n6');
  assert.equal(neighborPane(layout, 'n6', 'left')?.id, 'n4');
  assert.equal(neighborPane(layout, 'n4', 'left')?.id, 'n2');
  assert.equal(neighborPane(layout, 'n2', 'left')?.id, 'n1');
});

test('validateLayout accepts a good layout and returns an equal object', () => {
  const layout = wrapSingleTree(threePanes().layout, 't1');
  const parsed = validateLayout(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(parsed, layout);
});

type Obj = Record<string, unknown>;

test('validateLayout rejects bad shapes', () => {
  const good = wrapSingleTree(threePanes().layout, 't1');
  const mutate = (fn: (l: Obj, tab: Obj, root: Obj) => void): unknown => {
    const copy = JSON.parse(JSON.stringify(good)) as Obj;
    const tab = (copy['tabs'] as Obj[])[0]!;
    fn(copy, tab, tab['root'] as Obj);
    return copy;
  };
  const cases: Array<[string, unknown]> = [
    ['not an object', 'nope'],
    ['null', null],
    ['negative revision', mutate((l) => (l['revision'] = -1))],
    ['fractional revision', mutate((l) => (l['revision'] = 1.5))],
    ['no tabs', mutate((l) => delete l['tabs'])],
    ['empty tabs', mutate((l) => (l['tabs'] = []))],
    ['current tab on nothing', mutate((l) => (l['currentTabId'] = 'zzz'))],
    ['missing current tab', mutate((l) => delete l['currentTabId'])],
    ['tab without an id', mutate((_, tab) => delete tab['id'])],
    ['tab without a name', mutate((_, tab) => delete tab['name'])],
    ['tab with a blank name', mutate((_, tab) => (tab['name'] = '  '))],
    ['duplicate tab id', mutate((l, tab) => (l['tabs'] as Obj[]).push({ ...tab, root: { kind: 'pane', id: 'n9', sessionId: null, view: null }, focusedPaneId: 'n9' }))],
    ['pane id reused in a second tab', mutate((l, tab) => (l['tabs'] as Obj[]).push({ ...tab, id: 't2', root: { kind: 'pane', id: 'n1', sessionId: null, view: null }, focusedPaneId: 'n1' }))],
    ['missing focus', mutate((_, tab) => delete tab['focusedPaneId'])],
    ['focus on a split', mutate((_, tab) => (tab['focusedPaneId'] = 'n3'))],
    ['focus on nothing', mutate((_, tab) => (tab['focusedPaneId'] = 'zzz'))],
    ['unknown kind', mutate((_, __, root) => (root['kind'] = 'tab'))],
    ['bad direction', mutate((_, __, root) => (root['direction'] = 'diagonal'))],
    ['ratio too small', mutate((_, __, root) => (root['ratio'] = 0.01))],
    ['ratio not a number', mutate((_, __, root) => (root['ratio'] = '0.5'))],
    ['duplicate id', mutate((_, __, root) => ((root['first'] as Obj)['id'] = 'n2'))],
    ['empty id', mutate((_, __, root) => ((root['first'] as Obj)['id'] = ''))],
    ['bad sessionId', mutate((_, __, root) => ((root['first'] as Obj)['sessionId'] = 5))],
    ['missing child', mutate((_, __, root) => delete root['second'])],
  ];
  for (const [name, value] of cases) {
    assert.throws(() => validateLayout(value), LayoutError, name);
  }
});

test('a single tree from before M36 is told by its shape, validated on its own and wrapped as one tab named Panes', () => {
  const tree = threePanes().layout;
  const json: unknown = JSON.parse(JSON.stringify(tree));
  assert.equal(isSingleTree(json), true);
  assert.equal(isSingleTree(wrapSingleTree(tree, 't1')), false);
  assert.equal(isSingleTree('nope'), false);
  assert.deepEqual(validateSingleTree(json), tree);
  assert.throws(() => validateSingleTree({ ...tree, focusedPaneId: 'n3' }), LayoutError, 'focus on a split');
  assert.throws(() => validateSingleTree({ ...tree, revision: -1 }), LayoutError, 'bad revision');
  const wrapped = wrapSingleTree({ ...tree, revision: 7 }, 't1');
  assert.deepEqual(wrapped, { tabs: [{ id: 't1', name: 'Panes', root: tree.root, focusedPaneId: tree.focusedPaneId }], currentTabId: 't1', revision: 7 });
  assert.deepEqual(validateLayout(wrapped), wrapped, 'the wrapped layout is valid as it is');
  assert.equal(wrapSingleTree(tree).tabs[0]!.id.length > 0, true, 'an id is made when none is given');
});

test('gridTree lays n sessions out as ceil(sqrt(n)) columns of near-equal rows, read left to right and top to bottom', () => {
  const shape = (node: LayoutNode): string =>
    node.kind === 'pane' ? (node.sessionId ?? '-') : `${node.direction === 'row' ? 'R' : 'C'}${node.ratio.toFixed(2)}(${shape(node.first)},${shape(node.second)})`;
  const grid = (n: number) => gridTree(Array.from({ length: n }, (_, i) => `s${i + 1}`), counter());
  assert.equal(shape(grid(0).root), '-', 'no sessions: one empty pane');
  assert.equal(shape(grid(1).root), 's1');
  assert.equal(shape(grid(2).root), 'R0.50(s1,s2)', 'two side by side');
  assert.equal(shape(grid(3).root), 'R0.50(C0.50(s1,s3),s2)', 'two columns, the first taking the spare');
  assert.equal(shape(grid(4).root), 'R0.50(C0.50(s1,s3),C0.50(s2,s4))');
  assert.equal(shape(grid(5).root), 'R0.33(C0.50(s1,s4),R0.50(C0.50(s2,s5),s3))', 'three columns of 2, 2 and 1');
  assert.equal(shape(grid(6).root), 'R0.33(C0.50(s1,s4),R0.50(C0.50(s2,s5),C0.50(s3,s6)))');
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const tree = grid(n);
    assert.equal(listPanes(tree).length, n);
    assert.equal(tree.focusedPaneId, listPanes(tree)[0]!.id, 'the first pane is focused');
    const ids = new Set<string>();
    const walk = (node: LayoutNode): void => {
      assert.equal(ids.has(node.id), false, 'ids are unique');
      ids.add(node.id);
      if (node.kind === 'split') {
        walk(node.first);
        walk(node.second);
      }
    };
    walk(tree.root);
  }
});

test('a pane holds a session or a view, never both: setPaneView clears the session and setPaneSession the view (M52)', () => {
  const { layout, a, b } = threePanes();
  const view = { kind: 'commits' as const, folder: 'C:/repo' };
  const shown = setPaneSession(layout, a, 'sess-1');
  const viewed = setPaneView(shown, a, view);
  assert.deepEqual(findPane(viewed, a), { kind: 'pane', id: a, sessionId: null, view });
  const back = setPaneSession(viewed, a, 'sess-2');
  assert.deepEqual(findPane(back, a), { kind: 'pane', id: a, sessionId: 'sess-2', view: null });
  assert.equal(paneShowing(viewed, 'sess-1'), null, 'a view pane shows no session');
  assert.equal(findPane(setPaneView(viewed, b, null), b)?.view, null);
  assert.throws(() => setPaneView(layout, 'nope', view), LayoutError);
  // Closing the last pane of a tab empties a view as it empties a session.
  const ids = counter();
  const one = setPaneView(defaultTree(ids), 'n1', view);
  assert.equal(closePane(one, 'n1').root.kind === 'pane' && closePane(one, 'n1').root.view, null);
});

test('dropView splits a new pane for the view on an edge, fills an empty pane on the centre and refuses an occupied one (M52)', () => {
  const { layout, a, c } = threePanes();
  const view = { kind: 'commits' as const, folder: 'C:/repo' };
  const fresh = () => {
    let n = 0;
    return () => `v${++n}`;
  };
  const shown = setPaneSession(layout, c, 'sess-1');
  const beside = dropView(shown, view, c, { direction: 'row', place: 'after' }, fresh());
  assert.equal(listPanes(beside).length, 4);
  const added = findPane(beside, beside.focusedPaneId);
  assert.deepEqual(added?.view, view);
  assert.equal(added?.sessionId, null);
  assert.equal(findPane(beside, c)?.sessionId, 'sess-1', 'the session pane is untouched');
  // The centre of an empty pane takes the view and focus; a pane holding
  // a session or a view gives the layout back as it was.
  const filled = dropView(shown, view, a, null);
  assert.deepEqual(findPane(filled, a)?.view, view);
  assert.equal(filled.focusedPaneId, a);
  assert.equal(dropView(shown, view, c, null), shown);
  assert.equal(dropView(filled, { kind: 'commits', folder: 'C:/other' }, a, null), filled);
  assert.throws(() => dropView(shown, view, 'nope', null), LayoutError);
});

test('validateLayout reads a view, fills null for a pane without one and rejects a pane holding both (M52)', () => {
  const { layout, a } = threePanes();
  const view = { kind: 'commits' as const, folder: 'C:/repo' };
  const good = wrapSingleTree(setPaneView(layout, a, view), 't1');
  assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(good))), good);
  // A layout written before M52, or by an older daemon, has no view field.
  const bare = JSON.parse(JSON.stringify(wrapSingleTree(layout, 't1'))) as { tabs: Array<{ root: Record<string, unknown> }> };
  const walk = (node: Record<string, unknown>): void => {
    delete node['view'];
    if (node['kind'] === 'split') {
      walk(node['first'] as Record<string, unknown>);
      walk(node['second'] as Record<string, unknown>);
    }
  };
  walk(bare.tabs[0]!.root);
  assert.deepEqual(validateLayout(bare), wrapSingleTree(layout, 't1'));
  const mutate = (fn: (root: Record<string, unknown>) => void): unknown => {
    const copy = JSON.parse(JSON.stringify(good)) as { tabs: Array<{ root: Record<string, unknown> }> };
    fn(copy.tabs[0]!.root);
    return copy;
  };
  const paneA = (root: Record<string, unknown>) => root['first'] as Record<string, unknown>;
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['sessionId'] = 'sess-1'))), LayoutError, 'both');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'diff', folder: 'C:/repo' }))), LayoutError, 'kind');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: '' }))), LayoutError, 'folder');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = 'commits'))), LayoutError, 'shape');
  // M66: the strip's scope rides on the view, checked as it comes in.
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', strip: { scope: 'week' } }))), LayoutError, 'scope');
  const scoped = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', strip: { scope: 'tab' } })));
  assert.deepEqual((scoped.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'commits', folder: 'C:/repo', strip: { scope: 'tab' } });
  const plain = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo' })));
  assert.deepEqual((plain.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'commits', folder: 'C:/repo' });
  // M9 fix 162: the lines-only flag rides the view, kept only when false.
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', rows: 'no' }))), LayoutError, 'rows');
  const lines = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', rows: false })));
  assert.deepEqual((lines.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'commits', folder: 'C:/repo', rows: false });
  const rowsOn = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', rows: true })));
  assert.deepEqual((rowsOn.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'commits', folder: 'C:/repo' });
  // M69: an activity view names a window unitBounds can read; a window
  // it cannot read is refused (a folder on it is kept since M9 fix 178).
  for (const window of ['2026-09-13', '2026-09-13T14', '2026-09-13T14:05']) {
    const activity = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window, other: 'C:/repo' })));
    assert.deepEqual((activity.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'activity', window });
  }
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13T25' }))), LayoutError, 'window');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'activity' }))), LayoutError, 'no window');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: 7 }))), LayoutError, 'window type');
  // M9 fix 178: the state a pane keeps rides the record, each field kept
  // only away from its default; M9 fix 179: chrome, kept only when false.
  const viewOf = (layout: unknown) => (validateLayout(layout).tabs[0]!.root as { first: { view: unknown } }).first.view;
  const fullGraph = { mode: 'list', orientation: 'horizontal', reverse: true, draw: 'active', hidden: ['a', 'b'], solo: 'a', layout: { a: 'line', b: 'graph' }, scale: 1.25, remotes: true };
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: fullGraph, chrome: false, rows: false }))), { kind: 'commits', folder: 'C:/repo', rows: false, graph: fullGraph, chrome: false });
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: { mode: 'graph', orientation: 'vertical', reverse: false, draw: 'all', hidden: [], solo: null, layout: {} }, chrome: true }))), { kind: 'commits', folder: 'C:/repo' });
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: { reverse: true, extra: 1 } }))), { kind: 'commits', folder: 'C:/repo', graph: { reverse: true } });
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: { mode: 'tree' } }))), LayoutError, 'graph mode');
  // M9 fix 213: the zoom is one of the steps, dropped at 1.
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: { scale: 1 } }))), { kind: 'commits', folder: 'C:/repo' });
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: { scale: 3 } }))), LayoutError, 'graph scale');
  // M9 fix 286: remotes is a boolean, kept only when on.
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: { remotes: false } }))), { kind: 'commits', folder: 'C:/repo' });
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: { remotes: 'yes' } }))), LayoutError, 'graph remotes');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: { hidden: [1] } }))), LayoutError, 'graph hidden');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: { layout: { a: 'fold' } } }))), LayoutError, 'graph layout');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', graph: 'list' }))), LayoutError, 'graph shape');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'commits', folder: 'C:/repo', chrome: 'no' }))), LayoutError, 'chrome');
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', scope: 'folder', folder: 'C:/repo', layers: 'band', chrome: false }))), { kind: 'activity', window: '2026-09-13', scope: 'folder', folder: 'C:/repo', layers: 'band', chrome: false });
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', scope: 'all', folder: 'C:/repo', layers: 'both', chrome: true }))), { kind: 'activity', window: '2026-09-13', folder: 'C:/repo' });
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', scope: 'folder' }))), LayoutError, 'folder scope without a folder');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', scope: 'tab' }))), LayoutError, 'scope');
  // M9 fix 250: panes is kept, with or without a folder.
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', scope: 'panes' }))), { kind: 'activity', window: '2026-09-13', scope: 'panes' });
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', scope: 'panes', folder: 'C:/repo' }))), { kind: 'activity', window: '2026-09-13', scope: 'panes', folder: 'C:/repo' });
  // M9 fix 261: the fourth value, the panes of the pane's own tab.
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', scope: 'here' }))), { kind: 'activity', window: '2026-09-13', scope: 'here' });
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', layers: 'none' }))), LayoutError, 'layers');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', folder: '' }))), LayoutError, 'empty folder');
  // M9 fix 766: the usage row's flag is kept only when false.
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', usage: false }))), { kind: 'activity', window: '2026-09-13', usage: false });
  assert.deepEqual(viewOf(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', usage: true }))), { kind: 'activity', window: '2026-09-13' });
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'activity', window: '2026-09-13', usage: 'no' }))), LayoutError, 'usage');

  // M9 fix 180: a file view is a path and an optional view switch; an
  // unknown kind is still refused.
  const file = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'file', path: 'C:\repo\README.md' })));
  assert.deepEqual((file.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'file', path: 'C:\repo\README.md' });
  const raw = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'file', path: 'C:\repo\README.md', view: 'raw' })));
  assert.deepEqual((raw.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'file', path: 'C:\repo\README.md', view: 'raw' });
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'file' }))), LayoutError, 'no path');
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'file', path: 'C:\a', view: 'split' }))), LayoutError, 'view');
  // M9 fix 659: a browser view is a URL as browserUrl writes it, or ''
  // for an empty address bar; profile and toolbar are kept, nothing else.
  const page = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: 'http://localhost:3000/' })));
  assert.deepEqual((page.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'browser', url: 'http://localhost:3000/' });
  const blank = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: '' })));
  assert.deepEqual((blank.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'browser', url: '' });
  const extra = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: 'https://example.com/', chrome: false, title: 'x', toolbar: false })));
  assert.deepEqual((extra.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'browser', url: 'https://example.com/', toolbar: false });
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: 'localhost:3000' }))), /url must be an http or https URL/);
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: 'file:///C:/x' }))), /url must be an http or https URL/);
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: 3 }))), /url must be an http or https URL/);
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'notes', path: 'C:\a' }))), /kind must be commits, activity, file or browser/);
  // M9 fix 673: a profile's name is kept, an absent one leaves no key,
  // and anything BROWSER_PROFILE refuses is refused.
  const profiled = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: 'http://localhost:3000/', profile: 'b' })));
  assert.deepEqual((profiled.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'browser', url: 'http://localhost:3000/', profile: 'b' });
  assert.equal('profile' in ((page.tabs[0]!.root as { first: { view: object } }).first.view), false);
  // M9 fix 839: toolbar is kept only when false.
  const shown = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: '', toolbar: true })));
  assert.equal('toolbar' in ((shown.tabs[0]!.root as { first: { view: object } }).first.view), false);
  const both = validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: 'http://localhost:3000/', profile: 'b', toolbar: false })));
  assert.deepEqual((both.tabs[0]!.root as { first: { view: unknown } }).first.view, { kind: 'browser', url: 'http://localhost:3000/', profile: 'b', toolbar: false });
  assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: '', toolbar: 'no' }))), /toolbar must be a boolean/);
  for (const profile of ['B', '', 3]) {
    assert.throws(() => validateLayout(mutate((root) => (paneA(root)['view'] = { kind: 'browser', url: '', profile }))), /profile must be/);
  }
});

test('dropAtRight fills an empty single pane in place, for a session and for a view (M9 fix 651)', () => {
  const ids = counter();
  const tree = defaultTree(ids); // n1
  const withSession = dropAtRight(tree, { sessionId: 's1', view: null }, ids);
  assert.deepEqual(withSession.root, { kind: 'pane', id: 'n1', sessionId: 's1', view: null });
  assert.equal(withSession.focusedPaneId, 'n1');
  assert.equal(listPanes(withSession).length, 1, 'no split');
  const view = { kind: 'commits', folder: 'C:/repo' } as const;
  const withView = dropAtRight(tree, { sessionId: null, view }, ids);
  assert.deepEqual(withView.root, { kind: 'pane', id: 'n1', sessionId: null, view });
  assert.equal(withView.focusedPaneId, 'n1');
});

test('dropAtRight puts the old root first and the new pane second, full height, with an even share of the width (M9 fix 651)', () => {
  const ids = counter();
  const one = setPaneSession(defaultTree(ids), 'n1', 's1');
  const old = one.root;
  const dropped = dropAtRight(one, { sessionId: 's2', view: null }, ids);
  assert.equal(dropped.root.kind, 'split');
  if (dropped.root.kind !== 'split') return;
  assert.equal(dropped.root.direction, 'row');
  assert.equal(dropped.root.ratio, 0.5);
  assert.equal(dropped.root.first, old, 'the old pane is the same object');
  assert.deepEqual(dropped.root.second, { kind: 'pane', id: 'n2', sessionId: 's2', view: null }, 'the pane id is taken before the split id');
  assert.equal(dropped.root.id, 'n3');
  assert.equal(dropped.focusedPaneId, 'n2');

  const { layout } = threePanes();
  const three = dropAtRight(layout, { sessionId: 's9', view: null }, counter());
  assert.equal(three.root.kind === 'split' && three.root.ratio, 0.75);
  assert.equal(three.root.kind === 'split' && three.root.first, layout.root, 'the old root untouched');

  let many = defaultTree(ids);
  while (listPanes(many).length < 25) many = splitPane(many, many.focusedPaneId, 'row', ids);
  const wide = dropAtRight(many, { sessionId: 's9', view: null }, ids);
  assert.equal(wide.root.kind === 'split' && wide.root.ratio, MAX_RATIO);

  const mirror = dropAtRight(one, { sessionId: 's1', view: null }, ids);
  assert.deepEqual(listPanes(mirror).map((p) => p.sessionId), ['s1', 's1'], 'a session already there gets a second pane');
});
