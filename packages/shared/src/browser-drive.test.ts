import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_VERBS, browserPartition, isBrowserAnswer, isBrowserPartition } from './browser-drive.ts';

test('the verbs are listed in the order the usage names them (M9 fixes 672 and 673)', () => {
  assert.deepEqual([...BROWSER_VERBS], ['snapshot', 'click', 'hover', 'fill', 'key', 'eval', 'screenshot', 'wait', 'navigate', 'upload', 'events', 'resume']);
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
