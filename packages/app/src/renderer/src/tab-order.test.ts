import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleKeys, currentKey, dropBefore, layoutTabKey, layoutTabOf, moveKey, nextLayoutTab, orderFromJson, orderWithNew, stripOrder, replaceKey } from './tab-order.ts';

const a = 'C:\\repo\\a.ts';
const b = 'C:\\repo\\b.ts';
const t1 = layoutTabKey('n2');
const t2 = layoutTabKey('n4');

test('a layout key names its tab and a file key does not', () => {
  assert.equal(t1, 'tab:n2');
  assert.equal(layoutTabOf(t1), 'n2');
  assert.equal(layoutTabOf(a), null);
  assert.equal(layoutTabOf('emerald://activity/2026-09-15'), null);
});

test('stripOrder keeps the kept order, drops what is gone and places what is new', () => {
  // Nothing kept: the layout tabs in the daemon's order, then the files.
  assert.deepEqual(stripOrder([], ['n2', 'n4'], [a, b]), [t1, t2, a, b]);
  // Only files kept (a strip from before the order existed): the layout
  // tabs still come first.
  assert.deepEqual(stripOrder([a, b], ['n2', 'n4'], [a, b]), [t1, t2, a, b]);
  // A file between two panes tabs stays there; a closed file and a closed
  // layout tab drop out; a new layout tab with nothing kept trailing the
  // last one this window still holds (M9 fix 346) joins at the end,
  // after the files, rather than ahead of the new file b.
  assert.deepEqual(stripOrder([t1, a, t2, 'C:\\gone.ts', 'tab:n9'], ['n2', 'n4', 'n6'], [a, b]), [t1, a, t2, b, 'tab:n6']);
  // A file already kept still trails the last layout tab this window
  // holds, so a new one joins right after it, as it always did.
  assert.deepEqual(stripOrder([t1, a, b], ['n2', 'n4'], [a, b]), [t1, t2, a, b]);
  // A duplicate is one key.
  assert.deepEqual(stripOrder([a, a, t1], ['n2'], [a]), [a, t1]);
});

test('orderWithNew names its own key last, after every file, on any starting order (M9 fix 363)', () => {
  // A fresh profile: nothing materialized yet, the new tab is the whole order.
  assert.deepEqual(orderWithNew([], [], t1), [t1]);
  // An order ending in a file: the new tab still goes after it, not with
  // the panes tabs first as stripOrder's fresh-profile guess would put it.
  assert.deepEqual(orderWithNew([t1, a], [a], t2), [t1, a, t2]);
  // An order ending in a layout tab: the new tab lands right after it.
  assert.deepEqual(orderWithNew([a, t1], [a], t2), [a, t1, t2]);
  // A file open but not yet in the given order still lands before the
  // new key.
  assert.deepEqual(orderWithNew([t1], [a, b], t2), [t1, a, b, t2]);
  // The new key already in the order (a retried add) moves to the end
  // rather than doubling up.
  assert.deepEqual(orderWithNew([t1, t2, a], [a], t2), [t1, a, t2]);
});

test('moveKey puts a key before another or at the end, and is a no-op otherwise', () => {
  const order = [t1, t2, a, b];
  assert.deepEqual(moveKey(order, b, t2), [t1, b, t2, a], 'a file tab before a layout tab');
  assert.deepEqual(moveKey(order, t1, null), [t2, a, b, t1], 'to the end');
  assert.deepEqual(moveKey(order, t1, a), [t2, t1, a, b]);
  assert.equal(moveKey(order, a, b), order, 'already before it');
  assert.equal(moveKey(order, b, null), order, 'already last');
  assert.equal(moveKey(order, a, a), order, 'onto itself');
  assert.equal(moveKey(order, 'C:\\x.ts', a), order, 'an unknown key');
  assert.equal(moveKey(order, a, 'C:\\x.ts'), order, 'before an unknown key');
});

test('currentKey is the active file or the layout tab on show', () => {
  assert.equal(currentKey(a, 'panes', 'n2'), a);
  assert.equal(currentKey('panes', 'panes', 'n2'), t1);
  assert.equal(currentKey('panes', 'panes', null), null);
});

test('cycleKeys walks the strip both ways with wrap-around, a panes tab and a file each one stop', () => {
  const order = [t1, a, t2, b];
  assert.equal(cycleKeys(order, t1, 1), a);
  assert.equal(cycleKeys(order, a, 1), t2);
  assert.equal(cycleKeys(order, b, 1), t1, 'past the end wraps');
  assert.equal(cycleKeys(order, t1, -1), b, 'before the start wraps');
  assert.equal(cycleKeys(order, null, 1), t1, 'no current: the first');
  assert.equal(cycleKeys(order, null, -1), b, 'no current: the last');
  assert.equal(cycleKeys([t1], t1, 1), null, 'one tab has nowhere to go');
  assert.equal(cycleKeys([], null, 1), null);
});

test('nextLayoutTab skips the file tabs and wraps', () => {
  const order = [t1, a, t2, b, 'tab:n6'];
  assert.equal(nextLayoutTab(order, 'n2', 1), 'n4');
  assert.equal(nextLayoutTab(order, 'n6', 1), 'n2', 'wraps');
  assert.equal(nextLayoutTab(order, 'n2', -1), 'n6');
  assert.equal(nextLayoutTab(order, 'zzz', 1), 'n2', 'an unknown current: the first');
  assert.equal(nextLayoutTab([t1, a], 'n2', 1), null, 'one layout tab');
});

test('dropBefore lands before the first slot whose middle the pointer is left of', () => {
  const slots = [
    { key: t1, left: 0, right: 100 },
    { key: a, left: 100, right: 200 },
    { key: b, left: 200, right: 300 },
  ];
  assert.equal(dropBefore(slots, 10), t1);
  assert.equal(dropBefore(slots, 60), a);
  assert.equal(dropBefore(slots, 149), a);
  assert.equal(dropBefore(slots, 151), b);
  assert.equal(dropBefore(slots, 260), null, 'past the last middle: the end');
  assert.equal(dropBefore(slots, 900), null, 'over the + or the filler: the end');
  assert.equal(dropBefore([], 5), null);
});

test('orderFromJson keeps strings, normalizes file keys and drops duplicates', () => {
  const norm = (p: string) => p.replace(/\//g, '\\');
  assert.deepEqual(orderFromJson(null, norm), []);
  assert.deepEqual(orderFromJson('x', norm), []);
  assert.deepEqual(orderFromJson([t1, 'C:/repo/a.ts', 3, '', a, t1], norm), [t1, a]);
});

test('replaceKey puts the new key where the old one sat (M9 fix 203)', () => {
  assert.deepEqual(replaceKey(['tab:1', 'a', 'tab:2'], 'a', 'b'), ['tab:1', 'b', 'tab:2']);
  const same = ['tab:1', 'a'];
  assert.equal(replaceKey(same, 'x', 'b'), same, 'an old key not in the list is no change');
  assert.equal(replaceKey(same, 'a', 'a'), same);
  assert.deepEqual(replaceKey(['a', 'b', 'tab:1'], 'a', 'b'), ['b', 'tab:1'], 'a new key already listed is listed once, at the old key\'s spot');
});
