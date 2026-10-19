import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabsKeyFor, windowIdFromSearch, windowOfTabsKey } from './window-keys.ts';

test('windowIdFromSearch reads the window query, absent for the first window\'s page (M9 fix 867)', () => {
  assert.equal(windowIdFromSearch('?window=ab-1'), 'ab-1');
  assert.equal(windowIdFromSearch(''), null);
  assert.equal(windowIdFromSearch('?x=1'), null);
  assert.equal(windowIdFromSearch('?window='), null);
});

test('tabsKeyFor keeps the first window on emerald.tabs and gives any other a key of its own', () => {
  assert.equal(tabsKeyFor(null), 'emerald.tabs');
  assert.equal(tabsKeyFor('first'), 'emerald.tabs');
  assert.equal(tabsKeyFor('ab-1'), 'emerald.tabs:ab-1');
  assert.equal(windowOfTabsKey('emerald.tabs:ab-1'), 'ab-1');
  assert.equal(windowOfTabsKey('emerald.tabs'), null);
  assert.equal(windowOfTabsKey('emerald.tabsx'), null);
});
