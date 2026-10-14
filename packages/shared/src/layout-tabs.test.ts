import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout } from './layout.ts';
import { addGroupTab, addTab, addTabHolding, allPanes, closeTab, currentTab, cycleTabs, findTab, freeTabName, nextTabName, paneShowingIn, renameTab, replaceTab, sessionsOnPanes, sessionsOnTab, switchTab, tabHolding } from './layout-tabs.ts';
import { LayoutError, defaultLayout, setPaneSession, setPaneView, splitPane, validateLayout } from './tree.ts';

function counter(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

// Three tabs: Panes (pane n1 holding session s1), Panes 2 (n3 | n5, n5
// holding s2) and Panes 3 (n7), the last one shown.
function threeTabs(): { layout: Layout; ids: () => string } {
  const ids = counter();
  let layout = defaultLayout(ids); // pane n1, tab n2
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 's1'));
  layout = addTab(layout, ids); // pane n3, tab n4
  layout = replaceTab(layout, splitPane(currentTab(layout), 'n3', 'row', ids)); // pane n5, split n6
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n5', 's2'));
  layout = addTab(layout, ids); // pane n7, tab n8
  return { layout, ids };
}

test('addTab appends an empty tab named Panes N and shows it; the revision is carried through', () => {
  const { layout } = threeTabs();
  assert.deepEqual(
    layout.tabs.map((t) => [t.id, t.name]),
    [
      ['n2', 'Panes'],
      ['n4', 'Panes 2'],
      ['n8', 'Panes 3'],
    ],
  );
  assert.equal(layout.currentTabId, 'n8');
  assert.equal(layout.revision, 0);
  assert.deepEqual(currentTab(layout).root, { kind: 'pane', id: 'n7', sessionId: null, view: null });
  const later = addTab({ ...layout, revision: 4 }, counter());
  assert.equal(later.revision, 4);
  assert.equal(later.tabs.length, 4);
});

test('nextTabName skips a name a tab already has', () => {
  const { layout } = threeTabs();
  assert.equal(nextTabName(layout), 'Panes 4');
  assert.equal(nextTabName(renameTab(layout, 'n8', 'Panes 4')), 'Panes 5');
  assert.equal(nextTabName(closeTab(layout, 'n4')), 'Panes 4', 'two tabs left, but Panes 3 is one of them');
});

test('findTab, tabHolding, allPanes and paneShowingIn look across every tab', () => {
  const { layout } = threeTabs();
  assert.equal(findTab(layout, 'n4')?.name, 'Panes 2');
  assert.equal(findTab(layout, 'zzz'), null);
  assert.equal(tabHolding(layout, 'n5')?.id, 'n4');
  assert.equal(tabHolding(layout, 'n1')?.id, 'n2');
  assert.equal(tabHolding(layout, 'n6'), null, 'a split is not a pane');
  assert.deepEqual(
    allPanes(layout).map((p) => p.id),
    ['n1', 'n3', 'n5', 'n7'],
  );
  const s2 = paneShowingIn(layout, 's2');
  assert.equal(s2?.tab.id, 'n4');
  assert.equal(s2?.pane.id, 'n5');
  assert.equal(paneShowingIn(layout, 'nope'), null);
});

test('sessionsOnPanes takes every tab, the one on show or not', () => {
  const { layout } = threeTabs();
  assert.deepEqual([...sessionsOnPanes(layout)].sort(), ['s1', 's2'], 's1 is on the first tab, s2 on the second, the third is empty');
  assert.deepEqual([...sessionsOnPanes(closeTab(layout, 'n4'))], ['s1'], 'a closed tab takes its sessions off the panes');
  // M9 fix 261: one tab's alone.
  assert.deepEqual([...sessionsOnTab(layout.tabs[0]!)], ['s1']);
  assert.deepEqual([...sessionsOnTab(layout.tabs[1]!)], ['s2']);
  assert.deepEqual([...sessionsOnTab(layout.tabs[2]!)], [], 'the empty tab has none');
});

test('replaceTab swaps one tab by id and hands the layout back for the same tab', () => {
  const { layout } = threeTabs();
  const tab = currentTab(layout);
  assert.equal(replaceTab(layout, tab), layout);
  const edited = replaceTab(layout, { ...tab, name: 'work' });
  assert.equal(edited.tabs[2]?.name, 'work');
  assert.equal(edited.tabs[0], layout.tabs[0], 'the other tabs keep their identity');
  assert.throws(() => replaceTab(layout, { ...tab, id: 'zzz' }), LayoutError);
});

test('renameTab trims, refuses an empty name and returns the layout itself for the same name', () => {
  const { layout } = threeTabs();
  assert.equal(renameTab(layout, 'n4', '  build  ').tabs[1]?.name, 'build');
  assert.equal(renameTab(layout, 'n4', 'Panes 2'), layout);
  assert.throws(() => renameTab(layout, 'n4', '   '), LayoutError);
  assert.throws(() => renameTab(layout, 'zzz', 'x'), LayoutError);
});

test('closeTab drops the tab, lands on the one to its left, else the right, and refuses the last one', () => {
  const { layout } = threeTabs();
  const closedCurrent = closeTab(layout, 'n8');
  assert.deepEqual(
    closedCurrent.tabs.map((t) => t.id),
    ['n2', 'n4'],
  );
  assert.equal(closedCurrent.currentTabId, 'n4', 'the one to the left');
  const closedFirst = closeTab(switchTab(layout, 'n2'), 'n2');
  assert.equal(closedFirst.currentTabId, 'n4', 'no left neighbour, so the right one');
  const closedOther = closeTab(layout, 'n2');
  assert.equal(closedOther.currentTabId, 'n8', 'closing another tab leaves the shown one alone');
  assert.equal(closedOther.tabs[0]?.id, 'n4');
  assert.throws(() => closeTab(layout, 'zzz'), LayoutError);
  const one = closeTab(closeTab(layout, 'n8'), 'n4');
  assert.throws(() => closeTab(one, 'n2'), /last tab/);
});

test('switchTab and cycleTabs move the shown tab with wrap-around', () => {
  const { layout } = threeTabs();
  assert.equal(switchTab(layout, 'n8'), layout, 'already shown');
  assert.equal(switchTab(layout, 'n2').currentTabId, 'n2');
  assert.throws(() => switchTab(layout, 'zzz'), LayoutError);
  assert.equal(cycleTabs(layout, 1).currentTabId, 'n2', 'past the end wraps to the first');
  assert.equal(cycleTabs(layout, -1).currentTabId, 'n4');
  assert.equal(cycleTabs(switchTab(layout, 'n2'), -1).currentTabId, 'n8', 'before the start wraps to the last');
  const one = defaultLayout(counter());
  assert.equal(cycleTabs(one, 1), one, 'one tab has nowhere to go');
});

test('paneShowingIn looks at the tab named first, the shown one by default, when a session is in several panes', () => {
  const { layout } = threeTabs();
  // s1 in Panes (n1) and in Panes 3 (n7), the shown tab.
  const mirrored = replaceTab(layout, setPaneSession(currentTab(layout), 'n7', 's1'));
  assert.equal(paneShowingIn(mirrored, 's1')?.pane.id, 'n7', 'the shown tab first');
  assert.equal(paneShowingIn(mirrored, 's1', 'n2')?.pane.id, 'n1', 'the tab named first');
  assert.equal(paneShowingIn(mirrored, 's1', 'n4')?.pane.id, 'n1', 'a tab without it: the others in order');
  assert.equal(paneShowingIn(mirrored, 's1', 'zzz')?.pane.id, 'n1', 'an unknown tab: the tabs in order');
  assert.equal(paneShowingIn(mirrored, 's2', 'n2')?.pane.id, 'n5');
});

test('addGroupTab appends a grid of the sessions named after the group, a number when the name is taken, and shows it', () => {
  const { layout, ids } = threeTabs();
  const grouped = addGroupTab(layout, 'emerald', ['s1', 's3', 's4'], ids);
  assert.equal(grouped.tabs.length, 4);
  const tab = grouped.tabs[3]!;
  assert.equal(tab.name, 'emerald');
  assert.equal(grouped.currentTabId, tab.id);
  // Tree order is column by column: s1 over s4 in the first column, s3 in the second.
  assert.deepEqual(
    allPanes({ ...grouped, tabs: [tab] }).map((p) => p.sessionId),
    ['s1', 's4', 's3'],
  );
  assert.equal(tab.focusedPaneId, allPanes({ ...grouped, tabs: [tab] })[0]!.id);
  assert.equal(findTab(grouped, 'n2')?.root.kind, 'pane', 'the pane s1 already had is untouched');
  assert.equal(paneShowingIn(grouped, 's1', 'n2')?.pane.id, 'n1');
  const again = addGroupTab(grouped, 'emerald', ['s1'], ids);
  assert.equal(again.tabs[4]?.name, 'emerald 2');
  assert.equal(addGroupTab(again, 'emerald', [], ids).tabs[5]?.name, 'emerald 3');
  assert.equal(freeTabName(layout, 'Panes 2'), 'Panes 2 2', 'the rule applies to any base');
  assert.throws(() => addGroupTab(layout, '  ', ['s1'], ids), LayoutError);
});

test('addTabHolding appends a tab holding the content in one pane, named free, and leaves the shown tab and the revision alone (M9 fix 651)', () => {
  const { layout, ids } = threeTabs();
  const before = { ...layout, revision: 7 };
  const held = addTabHolding(before, 'emerald', { sessionId: 's1', view: null }, ids);
  assert.equal(held.tabs.length, 4);
  const tab = held.tabs[3]!;
  assert.equal(tab.name, 'emerald');
  assert.equal(tab.root.kind === 'pane' && tab.root.sessionId, 's1');
  assert.equal(tab.focusedPaneId, tab.root.id);
  assert.equal(held.currentTabId, before.currentTabId);
  assert.equal(held.revision, 7);
  const view = { kind: 'commits', folder: 'C:/repo' } as const;
  const again = addTabHolding(held, 'emerald', { sessionId: null, view }, ids);
  assert.equal(again.tabs[4]?.name, 'emerald 2');
  assert.deepEqual(again.tabs[4]?.root.kind === 'pane' && again.tabs[4].root.view, view);
  assert.equal(again.currentTabId, before.currentTabId);
  assert.throws(() => addTabHolding(layout, '  ', { sessionId: 's1', view: null }, ids), LayoutError);
});

test('a tab holding a browser pane reads back whole through validateLayout (M9 fix 659)', () => {
  const ids = counter();
  let layout = defaultLayout(ids); // pane n1, tab n2
  layout = addTab(layout, ids); // pane n3, tab n4
  layout = replaceTab(layout, setPaneView(currentTab(layout), 'n3', { kind: 'browser', url: 'http://localhost:3000/' }));
  const back = validateLayout(JSON.parse(JSON.stringify(layout)));
  assert.deepEqual(back, layout);
  assert.deepEqual(findTab(back, 'n4')!.root, { kind: 'pane', id: 'n3', sessionId: null, view: { kind: 'browser', url: 'http://localhost:3000/' } });
});
