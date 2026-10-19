import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_FILTER_REF, BROWSER_VERBS, browserPartition, dragOffset, isBrowserAnswer, isBrowserPartition } from './browser-drive.ts';

test('the verbs are listed in the order the usage names them (M9 fixes 672 and 673)', () => {
  assert.deepEqual([...BROWSER_VERBS], ['snapshot', 'click', 'hover', 'drag', 'fill', 'key', 'eval', 'screenshot', 'wait', 'navigate', 'upload', 'events', 'resume']);
});

test('dragOffset takes dx,dy with a sign and a decimal point, nothing else (M9 fix 874)', () => {
  assert.deepEqual(dragOffset('0,-60'), { dx: 0, dy: -60 });
  assert.deepEqual(dragOffset('-20.5,3'), { dx: -20.5, dy: 3 });
  for (const s of ['', '1,2,3', 'a,b', ' 1,2', '1;2', '1,', '@e3']) assert.equal(dragOffset(s), null, JSON.stringify(s));
});

test('a snapshot filter\'s within is a region\'s or a control\'s ref (M9 fix 875)', () => {
  for (const s of ['@r1', 'r12', '@e3']) assert.equal(BROWSER_FILTER_REF.test(s), true, s);
  for (const s of ['@x1', '@r', '@r1234567890']) assert.equal(BROWSER_FILTER_REF.test(s), false, s);
});

test('a profile is a partition of its own beside the shared one (M9 fix 673)', () => {
  assert.equal(browserPartition(), 'persist:emerald-browser');
  assert.equal(browserPartition('b'), 'persist:emerald-browser-b');
  assert.equal(isBrowserPartition('persist:emerald-browser'), true);
  assert.equal(isBrowserPartition('persist:emerald-browser-viewer'), true);
  for (const p of ['persist:emerald-browser-B', 'persist:emerald-browser-', `persist:emerald-browser-${'a'.repeat(33)}`, 'persist:emerald-browserx', 'persist:other', undefined]) {
    assert.equal(isBrowserPartition(p), false, String(p));
  }
  assert.equal(isBrowserPartition(`persist:emerald-browser-${'a'.repeat(32)}`), true);
});

test('isBrowserAnswer takes { ok, text } and wants a reason exactly when not ok (M9 fix 672)', () => {
  assert.equal(isBrowserAnswer({ ok: true, text: 'clicked @e1 button "Go"' }), true);
  assert.equal(isBrowserAnswer({ ok: true, text: '3', data: 3 }), true);
  assert.equal(isBrowserAnswer({ ok: false, text: 'gave up', reason: 'timeout' }), true);
  assert.equal(isBrowserAnswer({ ok: false, text: 'paused by the person', reason: 'paused' }), true);
  assert.equal(isBrowserAnswer({ ok: true }), false);
  assert.equal(isBrowserAnswer({ ok: false, text: 'no reason' }), false);
  assert.equal(isBrowserAnswer({ ok: false, text: 'odd', reason: 'frob' }), false);
  assert.equal(isBrowserAnswer({ ok: true, text: 'x', reason: 'failed' }), false);
  assert.equal(isBrowserAnswer(null), false);
});
