import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout } from './layout.ts';
import { addTab, closeTab, currentTab, renameTab, replaceTab, switchTab } from './layout-tabs.ts';
import { FIRST_WINDOW_ID, closeWindow, fitWindows, frontWindow, mergeWindowView, openWindow, setFrontWindow, windowHolding, windowView, windowsOf } from './layout-windows.ts';
import { LayoutError, defaultLayout, setPaneSession, validateLayout } from './tree.ts';

function counter(prefix = 'n'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

// Three tabs in one window, no windows field: Panes (n2), Panes 2 (n4),
// Panes 3 (n6), the last one shown.
function threeTabs(): { layout: Layout; ids: () => string } {
  const ids = counter();
  let layout = defaultLayout(ids);
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 's1'));
  layout = addTab(layout, ids);
  layout = addTab(layout, ids);
  return { layout, ids };
}

// Two windows: first holds n2 and n6 (n6 current), w2 holds n4 alone, w2 in front.
function twoWindows(): { layout: Layout; ids: () => string } {
  const { layout, ids } = threeTabs();
  return { layout: openWindow(switchTab(layout, 'n6'), 'w2', 'n4'), ids };
}

test('windowsOf names the implied first window; windowView of a layout with no windows is the same object', () => {
  const { layout } = threeTabs();
  assert.equal(layout.windows, undefined);
  assert.deepEqual(windowsOf(layout), [{ id: FIRST_WINDOW_ID, tabIds: ['n2', 'n4', 'n6'], currentTabId: 'n6' }]);
  assert.equal(windowView(layout, null), layout);
  assert.equal(windowView(layout, 'w2'), layout);
  assert.equal(frontWindow(layout).id, FIRST_WINDOW_ID);
});

test('windowView of a two-window layout is the window\'s tabs in its order with its current tab, the tab objects the same', () => {
  const { layout } = twoWindows();
  const second = windowView(layout, 'w2');
  assert.deepEqual(second.tabs.map((t) => t.id), ['n4']);
  assert.equal(second.currentTabId, 'n4');
  assert.equal(second.revision, layout.revision);
  assert.equal(second.windows, undefined);
  assert.equal(second.tabs[0], layout.tabs.find((t) => t.id === 'n4'));
  const first = windowView(layout, FIRST_WINDOW_ID);
  assert.deepEqual(first.tabs.map((t) => t.id), ['n2', 'n6']);
  assert.equal(first.currentTabId, 'n6');
  assert.deepEqual(windowView(layout, null).tabs.map((t) => t.id), ['n2', 'n6'], 'a null id reads the first window');
  assert.deepEqual(windowView(layout, 'nope').tabs.map((t) => t.id), ['n2', 'n6'], 'an unknown id reads the first window');
  assert.equal(windowHolding(layout, 'n4')?.id, 'w2');
  assert.equal(frontWindow(layout).id, 'w2');
});

test('mergeWindowView round trips an addTab, a closeTab, a switchTab and a renameTab made on the second window\'s view', () => {
  const { layout, ids } = twoWindows();
  const firstRecord = layout.windows![0];
  const firstTabs = layout.tabs.filter((t) => t.id !== 'n4');

  const added = mergeWindowView(layout, addTab(windowView(layout, 'w2'), ids), 'w2');
  const w2 = added.windows!.find((w) => w.id === 'w2')!;
  assert.equal(w2.tabIds.length, 2);
  assert.equal(w2.currentTabId, w2.tabIds[1]);
  assert.equal(added.currentTabId, w2.tabIds[1], 'the view\'s current tab is the layout\'s');
  assert.deepEqual(added.windows![0], firstRecord);
  assert.deepEqual(added.tabs.map((t) => t.id), ['n2', 'n6', ...w2.tabIds], 'the tabs window by window');
  for (const t of firstTabs) assert.equal(added.tabs.find((x) => x.id === t.id), t);

  const view = windowView(added, 'w2');
  const closed = mergeWindowView(added, closeTab(view, w2.tabIds[1]!), 'w2');
  assert.deepEqual(closed.windows!.find((w) => w.id === 'w2')!.tabIds, ['n4']);
  assert.equal(closed.tabs.some((t) => t.id === w2.tabIds[1]), false, 'a tab the view dropped is gone');

  const switched = mergeWindowView(added, switchTab(view, 'n4'), 'w2');
  assert.equal(switched.windows!.find((w) => w.id === 'w2')!.currentTabId, 'n4');
  assert.equal(switched.currentTabId, 'n4');

  const renamed = mergeWindowView(layout, renameTab(windowView(layout, 'w2'), 'n4', 'Second'), 'w2');
  assert.equal(renamed.tabs.find((t) => t.id === 'n4')!.name, 'Second');
  assert.deepEqual(renamed.windows![0], firstRecord);

  const { layout: one } = threeTabs();
  const v = addTab(one, ids);
  assert.equal(mergeWindowView(one, v, null), v, 'on a layout with no windows it is the view itself');
});

test('fitWindows keeps prev\'s windows for a next with none and puts a new tab in the window holding prev\'s current tab', () => {
  const { layout, ids } = twoWindows();
  const { windows: _w, ...bare } = layout;
  const withTab = addTab(bare, ids);
  const fitted = fitWindows(withTab, layout);
  const w2 = fitted.windows!.find((w) => w.id === 'w2')!;
  assert.deepEqual(w2.tabIds, ['n4', withTab.currentTabId]);
  assert.equal(w2.currentTabId, withTab.currentTabId);
  assert.deepEqual(fitted.windows![0], layout.windows![0]);
  assert.equal(fitWindows(bare, null), bare, 'no windows on either side: next unchanged');
});

test('fitWindows drops a duplicate and an unknown id, drops an emptied window and lands an emptied current on its left neighbour', () => {
  const { layout } = twoWindows();
  const next: Layout = {
    ...layout,
    windows: [
      { id: FIRST_WINDOW_ID, tabIds: ['n2', 'n6', 'ghost'], currentTabId: 'n6' },
      { id: 'w2', tabIds: ['n4', 'n2'], currentTabId: 'n4' },
    ],
  };
  const fitted = fitWindows(next, layout);
  assert.deepEqual(fitted.windows!.map((w) => w.tabIds), [['n2', 'n6'], ['n4']]);

  // n6 closed in the first window while w2 is in front: first lands on n2.
  const closed: Layout = { ...layout, tabs: layout.tabs.filter((t) => t.id !== 'n6') };
  const afterClose = fitWindows(closed, layout);
  assert.deepEqual(afterClose.windows![0], { id: FIRST_WINDOW_ID, tabIds: ['n2'], currentTabId: 'n2' });

  // Every tab of w2 gone: w2 dropped, back to one first window, no field.
  const emptied: Layout = { ...layout, tabs: layout.tabs.filter((t) => t.id !== 'n4'), currentTabId: 'n2' };
  const collapsed = fitWindows(emptied, layout);
  assert.equal('windows' in collapsed, false);
  assert.deepEqual(collapsed.tabs.map((t) => t.id), ['n2', 'n6']);
});

test('fitWindows gives the holding window next\'s current tab, and keeps a one-window list whose id is not first', () => {
  const { layout } = twoWindows();
  const switched = fitWindows({ ...layout, currentTabId: 'n2', windows: undefined } as unknown as Layout, layout);
  assert.equal(switched.windows![0]!.currentTabId, 'n2');
  assert.equal(switched.currentTabId, 'n2');
  assert.equal(frontWindow(switched).id, FIRST_WINDOW_ID);

  const lone: Layout = { ...layout, windows: [{ id: 'w9', tabIds: layout.tabs.map((t) => t.id), currentTabId: layout.currentTabId }] };
  const kept = fitWindows(lone, null);
  assert.deepEqual(kept.windows!.map((w) => w.id), ['w9']);
  const first: Layout = { ...layout, windows: [{ id: FIRST_WINDOW_ID, tabIds: layout.tabs.map((t) => t.id), currentTabId: layout.currentTabId }] };
  assert.equal('windows' in fitWindows(first, null), false, 'one first window collapses to no key');
});

test('openWindow moves a tab out of its window, the source landing on its left neighbour, the new window in front', () => {
  const { layout } = threeTabs();
  const moved = openWindow(layout, 'w2', 'n6');
  assert.deepEqual(moved.windows, [
    { id: FIRST_WINDOW_ID, tabIds: ['n2', 'n4'], currentTabId: 'n4' },
    { id: 'w2', tabIds: ['n6'], currentTabId: 'n6' },
  ]);
  assert.equal(moved.currentTabId, 'n6');
  assert.deepEqual(moved.tabs.map((t) => t.id), ['n2', 'n4', 'n6']);
  assert.throws(() => openWindow(moved, 'w3', 'n6'), /the only tab of a window/);
  assert.throws(() => openWindow(moved, 'w3', 'nope'), LayoutError);
});

test('openWindow with no tab makes an empty Panes N in a new window in front', () => {
  const { layout } = threeTabs();
  const opened = openWindow(layout, 'w2', null, counter('x'));
  const w2 = opened.windows!.find((w) => w.id === 'w2')!;
  assert.equal(w2.tabIds.length, 1);
  const tab = opened.tabs.find((t) => t.id === w2.tabIds[0])!;
  assert.equal(tab.name, 'Panes 4');
  assert.equal(tab.root.kind, 'pane');
  assert.equal(opened.currentTabId, tab.id);
  assert.deepEqual(opened.windows![0]!.tabIds, ['n2', 'n4', 'n6']);
});

test('closeWindow drops a window with its tabs, refuses the last, collapses back to no windows key, and is the same object for an unknown id', () => {
  const { layout } = twoWindows();
  const closed = closeWindow(layout, 'w2');
  assert.equal('windows' in closed, false);
  assert.deepEqual(closed.tabs.map((t) => t.id), ['n2', 'n6']);
  assert.equal(closed.currentTabId, 'n6', 'the front window\'s tab went, so the first remaining window\'s');
  assert.equal(closeWindow(layout, 'nope'), layout);
  const { layout: one } = threeTabs();
  assert.equal(closeWindow(one, FIRST_WINDOW_ID), one, 'no windows field: unchanged');
  const lone = closeWindow(layout, FIRST_WINDOW_ID);
  assert.deepEqual(lone.windows!.map((w) => w.id), ['w2']);
  assert.deepEqual(lone.tabs.map((t) => t.id), ['n4']);
  assert.throws(() => closeWindow(lone, 'w2'), /the last window cannot close/);
});

test('setFrontWindow moves currentTabId and is the same object when already in front', () => {
  const { layout } = twoWindows();
  assert.equal(setFrontWindow(layout, 'w2'), layout);
  const front = setFrontWindow(layout, FIRST_WINDOW_ID);
  assert.equal(front.currentTabId, 'n6');
  assert.equal(frontWindow(front).id, FIRST_WINDOW_ID);
  assert.equal(setFrontWindow(layout, 'nope'), layout);
  const { layout: one } = threeTabs();
  assert.equal(setFrontWindow(one, FIRST_WINDOW_ID), one);
});

test('validateLayout keeps a good windows field whole and refuses each bad shape by its message', () => {
  const { layout } = twoWindows();
  const parsed = validateLayout(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(parsed, layout);
  const { layout: one } = threeTabs();
  assert.equal('windows' in validateLayout(JSON.parse(JSON.stringify(one))), false);
  const bad: [unknown, RegExp][] = [
    [[], /layout\.windows must be a non-empty list/],
    ['x', /layout\.windows must be a non-empty list/],
    [[3], /layout\.windows\[0\] must be an object/],
    [[{ id: '', tabIds: [], currentTabId: 'n2' }], /layout\.windows\[0\]\.id must be a non-empty string/],
    [[{ id: 'a', tabIds: [], currentTabId: 'n2' }, { id: 'a', tabIds: [], currentTabId: 'n2' }], /layout\.windows\[1\]\.id a is used twice/],
    [[{ id: 'a', tabIds: [1], currentTabId: 'n2' }], /layout\.windows\[0\]\.tabIds must be a list of strings/],
    [[{ id: 'a', tabIds: ['n2'], currentTabId: 5 }], /layout\.windows\[0\]\.currentTabId must be a string/],
  ];
  for (const [windows, message] of bad) {
    assert.throws(() => validateLayout({ ...JSON.parse(JSON.stringify(one)), windows }), message);
  }
});
