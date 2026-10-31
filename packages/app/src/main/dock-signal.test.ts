import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDockSignal } from './dock-signal.ts';
import type { DockLike } from './dock-signal.ts';

// The dock on a Mac (M9 fix 1024): one badge for every window, the
// largest count, set only when its text changes; one bounce held until
// cleared.
function fakeDock(): DockLike & { calls: string[] } {
  const calls: string[] = [];
  let next = 1;
  return {
    calls,
    setBadge: (t) => calls.push(`badge ${JSON.stringify(t)}`),
    bounce: (type) => {
      const id = next++;
      calls.push(`bounce ${type} ${id}`);
      return id;
    },
    cancelBounce: (id) => calls.push(`cancel ${id}`),
  };
}

test('dock signal: the badge is the largest count over the windows', () => {
  const dock = fakeDock();
  const sig = createDockSignal(dock);
  const a = sig.windowFor(0);
  const b = sig.windowFor(1);
  a.setOverlay(2, true);
  b.setOverlay(5, true);
  assert.deepEqual(dock.calls, ['badge "2"', 'badge "5"']);
  b.setOverlay(null, true);
  assert.deepEqual(dock.calls.slice(2), ['badge "2"'], 'the 5 dropping to none badges the other window\'s 2');
  sig.drop(0);
  assert.deepEqual(dock.calls.slice(3), ['badge ""'], 'the last window dropped clears the badge');
});

test('dock signal: a repeated count sets the badge once', () => {
  const dock = fakeDock();
  const w = createDockSignal(dock).windowFor(0);
  w.setOverlay(3, true);
  w.setOverlay(3, false);
  w.setOverlay(3, true);
  assert.deepEqual(dock.calls, ['badge "3"']);
});

test('dock signal: one bounce held, cancelled by its id, a second clear does nothing', () => {
  const dock = fakeDock();
  const w = createDockSignal(dock).windowFor(0);
  w.flashFrame(true);
  w.flashFrame(true);
  assert.deepEqual(dock.calls, ['bounce informational 1']);
  w.flashFrame(false);
  w.flashFrame(false);
  assert.deepEqual(dock.calls, ['bounce informational 1', 'cancel 1']);
  w.setProgress(0.5);
  w.setTooltip('x');
  assert.equal(dock.calls.length, 2, 'the bar and the tooltip do nothing on a dock');
});
