import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closePane, currentTab, defaultLayout, findPane, listPanes, parentSplit, replaceTab, setPaneSession, splitPane, tabHolding } from '@emerald/shared';
import type { IdGenerator, Layout } from '@emerald/shared';
import { REMOVE_AFTER_MS, closedSpot, holdsOnStart, reopenAt, removalWords, secondsLeft } from './close-countdown-model.ts';
import type { RemovalCount } from './close-countdown-model.ts';

// A counter for stable ids.
const counter = (prefix: string): IdGenerator => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

// One tab of two panes side by side, the first named "a", the second "b".
function twoPanes(): { layout: Layout; a: string; b: string } {
  const l0 = defaultLayout(counter('t'));
  const a = listPanes(currentTab(l0))[0]!.id;
  const tab = splitPane(currentTab(l0), a, 'row', counter('n'));
  const b = tab.focusedPaneId;
  return { layout: replaceTab(l0, tab), a, b };
}

const shape = (layout: Layout): string[] => listPanes(currentTab(layout)).map((p) => p.sessionId ?? '-');

test('closedSpot on a row split names the sibling, the side and the ratio', () => {
  const { layout, a, b } = twoPanes();
  const second = closedSpot(layout, b)!;
  assert.equal(second.siblingId, a);
  assert.equal(second.place, 'after');
  assert.equal(second.direction, 'row');
  assert.equal(second.ratio, parentSplit(currentTab(layout), b)!.ratio);
  const first = closedSpot(layout, a)!;
  assert.equal(first.siblingId, b);
  assert.equal(first.place, 'before');
  assert.equal(closedSpot(layout, 'gone'), null);
});

test('closedSpot on a lone root pane has no sibling', () => {
  const layout = defaultLayout(counter('t'));
  const p = listPanes(currentTab(layout))[0]!.id;
  const spot = closedSpot(layout, p)!;
  assert.equal(spot.siblingId, null);
  assert.equal(spot.paneId, p);
});

test('reopenAt puts the session back into a tree of the same shape, the new pane focused', () => {
  for (const which of ['second', 'first'] as const) {
    const { layout, a, b } = twoPanes();
    const withS = replaceTab(layout, setPaneSession(setPaneSession(currentTab(layout), a, 'sa'), b, 'sb'));
    const closing = which === 'second' ? b : a;
    const spot = closedSpot(withS, closing)!;
    const closed = replaceTab(withS, closePane(currentTab(withS), closing));
    assert.equal(listPanes(currentTab(closed)).length, 1);
    const back = reopenAt(closed, spot, 'sx', counter('r'))!;
    assert.deepEqual(shape(back), which === 'second' ? ['sa', 'sx'] : ['sx', 'sb']);
    assert.equal(findPane(currentTab(back), currentTab(back).focusedPaneId)!.sessionId, 'sx');
    const root = currentTab(back).root;
    assert.equal(root.kind, 'split');
    if (root.kind === 'split') {
      assert.equal(root.direction, 'row');
      assert.equal(root.ratio, spot.ratio);
    }
  }
});

test('reopenAt on a lone root pane sets the session into the emptied pane and focuses it', () => {
  const l0 = defaultLayout(counter('t'));
  const p = listPanes(currentTab(l0))[0]!.id;
  const withS = replaceTab(l0, setPaneSession(currentTab(l0), p, 'sa'));
  const spot = closedSpot(withS, p)!;
  const closed = replaceTab(withS, closePane(currentTab(withS), p));
  const back = reopenAt(closed, spot, 'sa', counter('r'))!;
  assert.deepEqual(shape(back), ['sa']);
  assert.equal(currentTab(back).focusedPaneId, p);
  assert.equal(tabHolding(back, p)!.id, spot.tabId);
});

test('reopenAt gives up when the spot has gone', () => {
  const { layout, a, b } = twoPanes();
  const spot = closedSpot(layout, b)!;
  const closed = replaceTab(layout, closePane(currentTab(layout), b));
  assert.equal(reopenAt(closed, { ...spot, tabId: 'no-such-tab' }, 'sx', counter('r')), null, 'a gone tab');
  assert.equal(reopenAt(closed, { ...spot, siblingId: 'no-such-node' }, 'sx', counter('r')), null, 'a gone sibling');
  const l0 = defaultLayout(counter('t'));
  const p = listPanes(currentTab(l0))[0]!.id;
  const lone = closedSpot(l0, p)!;
  const taken = replaceTab(l0, setPaneSession(currentTab(l0), p, 'other'));
  assert.equal(reopenAt(taken, lone, 'sx', counter('r')), null, 'a root pane that holds a session again');
  assert.ok(a);
});

test('secondsLeft counts down while running and holds while paused', () => {
  const run: RemovalCount = { spot: null, started: true, leftMs: REMOVE_AFTER_MS, runningSince: 1000 };
  assert.equal(secondsLeft(run, 1000), 10);
  assert.equal(secondsLeft(run, 3400), 8);
  assert.equal(secondsLeft(run, 10900), 1);
  assert.equal(secondsLeft(run, 20000), 1, 'never below one');
  assert.equal(secondsLeft(run, 500), 10, 'a clock a tick behind the start reads 10, not 11');
  const paused: RemovalCount = { spot: null, started: true, leftMs: 10_000 - 2400, runningSince: null };
  assert.equal(secondsLeft(paused, 5000), 8);
  assert.equal(secondsLeft(paused, 99999), 8);
});

test('removalWords', () => {
  assert.equal(removalWords(7), 'removing in 7s');
});

test('holdsOnStart: a pointer already on a running count holds it (M9 fix 814)', () => {
  const run: RemovalCount = { spot: null, started: true, leftMs: REMOVE_AFTER_MS, runningSince: 1000 };
  assert.equal(holdsOnStart(run, true), true);
  assert.equal(holdsOnStart(run, false), false, 'not hovered');
  assert.equal(holdsOnStart({ ...run, started: false, runningSince: null }, true), false, 'not started');
  assert.equal(holdsOnStart({ ...run, runningSince: null }, true), false, 'paused already');
  assert.equal(holdsOnStart(undefined, true), false, 'no count');
});
