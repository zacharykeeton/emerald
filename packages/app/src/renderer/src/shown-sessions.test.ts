import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTab, currentTab, defaultLayout, replaceTab, setPaneSession, splitPane, switchTab } from '@emerald/shared';
import { shownData, shownSessions, shownWords } from './shown-sessions.ts';

// Tab one (Panes, n2) holds a in its focused pane n3 and b in n1 beside
// it; tab two (Panes 2, n6) holds c in n5. The ids run n1, n2, ... in the
// order the tree makes them, and the split's new pane takes the focus.
function twoTabs() {
  let n = 0;
  const ids = () => `n${++n}`;
  let layout = defaultLayout(ids);
  layout = replaceTab(layout, splitPane(currentTab(layout), 'n1', 'row', ids));
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n3', 'a'));
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'b'));
  layout = addTab(layout, ids);
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n5', 'c'));
  return switchTab(layout, 'n2');
}

test('with the panes on show the current tab reads focused and shown, the other tab elsewhere by name', () => {
  const shown = shownSessions(twoTabs(), true);
  assert.deepEqual(shown.get('a'), { place: 'focused' });
  assert.deepEqual(shown.get('b'), { place: 'shown' });
  assert.deepEqual(shown.get('c'), { place: 'elsewhere', tab: 'Panes 2' });
  assert.equal(shown.get('d'), undefined);
  assert.equal(shownWords(shown.get('a'), false), 'focused');
  assert.equal(shownWords(shown.get('c'), false), 'on Panes 2');
  assert.equal(shownWords(undefined, false), 'on no pane');
});

test('a file tab in front reads every session elsewhere, the current tab by its name too (M9 fix 269)', () => {
  const shown = shownSessions(twoTabs(), false);
  assert.deepEqual(shown.get('a'), { place: 'elsewhere', tab: 'Panes' });
  assert.deepEqual(shown.get('b'), { place: 'elsewhere', tab: 'Panes' });
  assert.deepEqual(shown.get('c'), { place: 'elsewhere', tab: 'Panes 2' });
  assert.equal(shownWords(shown.get('a'), false), 'on Panes');
  assert.equal(shownData(shown.get('a'), false), 'elsewhere');
  assert.equal([...shown.values()].some((w) => w.place === 'focused' || w.place === 'shown'), false, 'no pane is visible under a file tab');
});

test('a file tab over a one-tab layout reads on Panes (M9 fix 269)', () => {
  let n = 0;
  const ids = () => `n${++n}`;
  let layout = defaultLayout(ids);
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'a'));
  assert.deepEqual(shownSessions(layout, true).get('a'), { place: 'focused' });
  assert.deepEqual(shownSessions(layout, false).get('a'), { place: 'elsewhere', tab: 'Panes' });
  assert.equal(shownSessions(null, false).size, 0);
});

test('a session on two tabs takes the first tab in order when neither is on show', () => {
  let layout = twoTabs();
  layout = replaceTab(layout, setPaneSession(layout.tabs[1]!, 'n5', 'a'));
  assert.deepEqual(shownSessions(layout, false).get('a'), { place: 'elsewhere', tab: 'Panes' });
  assert.deepEqual(shownSessions(layout, true).get('a'), { place: 'focused' });
});
