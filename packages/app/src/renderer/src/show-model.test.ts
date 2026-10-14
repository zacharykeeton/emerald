import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTab, currentTab, defaultLayout, replaceTab, setPaneSession, setPaneView, splitPane, switchTab } from '@emerald/shared';
import { isShowOffscreen, newTabNameFor, viewName, wouldReplace } from './show-model.ts';

function counter(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

const sessions = new Map([
  ['a', { state: 'working' as const }],
  ['b', { state: 'idle' as const }],
  ['gone', { state: 'exited' as const }],
]);

test('wouldReplace names the live session in the focused pane when the clicked one is on no pane', () => {
  const ids = counter();
  let layout = defaultLayout(ids); // pane n1, tab n2
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'a'));
  assert.deepEqual(wouldReplace(layout, sessions, 'b'), { kind: 'session', sessionId: 'a' });
  // Nothing to ask about with no layout yet.
  assert.equal(wouldReplace(null, sessions, 'b'), null);
});

test('no question for an empty focused pane, an exited session there, or the same session', () => {
  const ids = counter();
  let layout = defaultLayout(ids);
  assert.equal(wouldReplace(layout, sessions, 'b'), null);
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'gone'));
  assert.equal(wouldReplace(layout, sessions, 'b'), null);
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'a'));
  assert.equal(wouldReplace(layout, sessions, 'a'), null);
  // A session the store has forgotten counts as nothing to lose.
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'unknown'));
  assert.equal(wouldReplace(layout, sessions, 'b'), null);
});

test('a session already on a pane, on any tab, is jumped to rather than asked about', () => {
  const ids = counter();
  let layout = defaultLayout(ids); // pane n1, tab n2
  layout = replaceTab(layout, splitPane(currentTab(layout), 'n1', 'row', ids)); // pane n3 focused, split n4
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'b'));
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n3', 'a'));
  assert.equal(wouldReplace(layout, sessions, 'b'), null);
  layout = addTab(layout, ids); // pane n5, tab n6 on show
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n5', 'a'));
  assert.equal(wouldReplace(layout, sessions, 'b'), null);
  assert.equal(wouldReplace(switchTab(layout, 'n2'), sessions, 'b'), null);
});

test('a view in the focused pane is asked about too, named by its folder (fix 95)', () => {
  const ids = counter();
  let layout = defaultLayout(ids); // pane n1, tab n2
  layout = replaceTab(layout, setPaneView(currentTab(layout), 'n1', { kind: 'commits', folder: 'C:\\Users\\z\\code\\emerald' }));
  assert.deepEqual(wouldReplace(layout, sessions, 'b'), { kind: 'view', name: 'Commits · emerald' });
  // A session already on another pane is still jumped to.
  layout = replaceTab(layout, splitPane(currentTab(layout), 'n1', 'row', ids)); // pane n3 focused
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n3', 'b'));
  layout = replaceTab(layout, { ...currentTab(layout), focusedPaneId: 'n1' });
  assert.equal(wouldReplace(layout, sessions, 'b'), null);
});

test('isShowOffscreen accepts the three words only', () => {
  assert.equal(isShowOffscreen('ask'), true);
  assert.equal(isShowOffscreen('replace'), true);
  assert.equal(isShowOffscreen('beside'), true);
  // A new tab is a one-off and is never remembered (fix 578).
  assert.equal(isShowOffscreen('tab'), false);
  assert.equal(isShowOffscreen('always'), false);
  assert.equal(isShowOffscreen(null), false);
});

test('newTabNameFor names the tab as the folder heading reads (fix 578)', () => {
  assert.equal(newTabNameFor({ groupCwd: 'C:\\work\\repo', name: 'shell 3' }, new Map()), 'repo');
  assert.equal(newTabNameFor({ groupCwd: 'C:\\work\\repo', name: 'shell 3' }, new Map([['C:\\work\\repo', 'Main']])), 'Main');
  assert.equal(newTabNameFor({ groupCwd: '', name: 'shell 3' }, new Map()), 'shell 3');
});

test('a browser view is named Browser, with its host once it has a page (M9 fix 659)', () => {
  assert.equal(viewName({ kind: 'browser', url: '' }), 'Browser');
  assert.equal(viewName({ kind: 'browser', url: 'http://localhost:3000/x' }), 'Browser · localhost:3000');
});
