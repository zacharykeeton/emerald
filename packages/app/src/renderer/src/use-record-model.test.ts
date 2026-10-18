import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USE_FEATURES, USE_NAMES } from '@emerald/shared';
import type { LayoutTab, LayoutNode } from '@emerald/shared';
import { BINDINGS } from './keys-model.ts';
import { PANES, emptyTabs, statsPath } from './tabs-model.ts';
import { PANE_USE, createTurnGate, frontView, openViews, outsideOpenUse, paneKind, tabKind, viewDiff } from './use-record-model.ts';

test('M9 fix 700: a file from a launch records file-launch, any other open cli-open', () => {
  assert.deepEqual(outsideOpenUse({}), { name: 'cli-open', from: 'cli' });
  assert.deepEqual(outsideOpenUse({ launch: false }), { name: 'cli-open', from: 'cli' });
  assert.deepEqual(outsideOpenUse({ launch: true }), { name: 'file-launch', from: 'click' });
  // M9 fix 853: a folder from Explorer's Open in Emerald items.
  assert.deepEqual(outsideOpenUse({ launch: true, kind: 'shell' }), { name: 'folder-launch', from: 'click' });
});

const pane = (id: string, sessionId: string | null, view: Extract<LayoutNode, { kind: 'pane' }>['view'] = null) => ({ kind: 'pane' as const, id, sessionId, view });

test('tabKind names each kind of strip tab (M9 fix 676)', () => {
  assert.equal(tabKind('emerald://activity/2026-10-14'), 'activity-tab');
  assert.equal(tabKind('emerald://review/abc'), 'review-tab');
  assert.equal(tabKind('emerald://whats-new'), 'whats-new-tab');
  assert.equal(tabKind('emerald://something-else'), 'other-tab');
  assert.equal(tabKind('C:/Users/x/.claude/projects/p/0123abcd-0000-0000-0000-000000000000.jsonl'), 'transcript-tab');
  assert.equal(tabKind('C:/code/zorca/README.md'), 'file-tab');
  assert.equal(tabKind(statsPath('C:/x')), 'stats-tab', 'M9 fix 837');
});

test('paneKind names each kind of pane', () => {
  assert.equal(paneKind(pane('a', null)), 'empty-pane');
  assert.equal(paneKind(pane('a', 's1')), 'session-pane');
  assert.equal(paneKind(pane('a', null, { kind: 'commits', folder: 'C:/x' })), 'commits-pane');
  assert.equal(paneKind(pane('a', null, { kind: 'activity', window: '2026-10-14' })), 'activity-pane');
  assert.equal(paneKind(pane('a', null, { kind: 'file', path: 'C:/x/a.txt' })), 'file-pane');
  assert.equal(paneKind(pane('a', null, { kind: 'browser', url: 'http://localhost/' })), 'browser-pane');
});

test('frontView reads the strip tab, else the focused pane', () => {
  const tab: LayoutTab = {
    id: 't1',
    name: 'one',
    focusedPaneId: 'b',
    root: { kind: 'split', id: 's', direction: 'row', ratio: 0.5, first: pane('a', 's1'), second: pane('b', null, { kind: 'file', path: 'C:/x/a.txt' }) },
  };
  assert.equal(frontView(emptyTabs(), tab), 'file-pane');
  assert.equal(frontView({ ...emptyTabs(), files: ['emerald://whats-new'], active: 'emerald://whats-new' }, tab), 'whats-new-tab');
  assert.equal(frontView({ ...emptyTabs(), active: PANES }, null), undefined);
});

test('viewDiff: nothing on the baseline, an open, a close with its ms, and a kind change', () => {
  const base = new Map([['pane:a', 'file-pane' as const]]);
  const first = viewDiff(null, base, new Map(), 1000);
  assert.deepEqual(first.lines, []);
  assert.equal(first.openedAt.get('pane:a'), 1000);

  const opened = viewDiff(base, new Map([...base, ['cheat-sheet', 'cheat-sheet' as const]]), first.openedAt, 2000);
  assert.deepEqual(opened.lines, [{ ev: 'view-open', view: 'cheat-sheet' }]);

  const closed = viewDiff(new Map([...base, ['cheat-sheet', 'cheat-sheet' as const]]), base, opened.openedAt, 3500);
  assert.deepEqual(closed.lines, [{ ev: 'view-close', view: 'cheat-sheet', ms: 1500 }]);
  assert.equal(closed.openedAt.get('pane:a'), 1000, 'a view still open keeps its clock');

  const changed = viewDiff(base, new Map([['pane:a', 'browser-pane' as const]]), closed.openedAt, 4000);
  assert.deepEqual(changed.lines, [
    { ev: 'view-close', view: 'file-pane', ms: 3000 },
    { ev: 'view-open', view: 'browser-pane' },
  ]);
});

test('openViews lists the view panes, the strip tabs and the cheat sheet, not session or empty panes', () => {
  const layout = {
    revision: 1,
    currentTabId: 't1',
    tabs: [
      { id: 't1', name: 'one', focusedPaneId: 'a', root: { kind: 'split' as const, id: 's', direction: 'row' as const, ratio: 0.5, first: pane('a', 's1'), second: pane('b', null, { kind: 'commits', folder: 'C:/x' }) } },
      { id: 't2', name: 'two', focusedPaneId: 'c', root: pane('c', null) },
    ],
  };
  const views = openViews(layout, { ...emptyTabs(), files: ['C:/x/a.md'] }, true);
  assert.deepEqual([...views.values()].sort(), ['cheat-sheet', 'commits-pane', 'file-tab']);
});

test('the turn gate passes the first take of a turn, refuses the second, then passes after the clear', () => {
  const pending: Array<() => void> = [];
  const gate = createTurnGate((fn) => pending.push(fn));
  assert.equal(gate.take(), true);
  assert.equal(gate.take(), false);
  pending.shift()!();
  assert.equal(gate.take(), true);
});

test('every binding has a USE_FEATURES keys row with the same name and label', () => {
  for (const b of BINDINGS) {
    const row = USE_FEATURES.find((f) => f.name === b.action);
    assert.ok(row !== undefined, `${b.action} has no USE_FEATURES row`);
    assert.equal(row.group, 'keys', b.action);
    assert.equal(row.label, b.label, b.action);
  }
});

test('every pane menu run records under a known name', () => {
  for (const name of Object.values(PANE_USE)) assert.ok(USE_NAMES.has(name), name);
});
