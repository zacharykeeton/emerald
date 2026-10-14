import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo } from '@emerald/shared';
import { getRates, resetRates, runningShellsHeld, subscribeRates } from './rates-store.ts';
import { getState, onPush, pickHeld, subscribe } from './store.ts';
import { aSession } from './test-support.ts';

// M9 fix 354: the output rate leaves the main store for one of its own,
// so a pty.rate push reaches the rates store's listeners and not the
// window's; and a reader that names its fields keeps the same pick
// while those fields hold, whatever else a push moves.

function session(id: string, kind: 'shell' | 'claude' = 'shell'): SessionInfo {
  return aSession({ id, kind, name: id });
}

const push = (msg: unknown) => onPush(msg as Parameters<typeof onPush>[0]);

test('a pty.rate push notifies the rates store and not the main store', () => {
  resetRates();
  let main = 0;
  let rates = 0;
  const offMain = subscribe(() => (main += 1));
  const offRates = subscribeRates(() => (rates += 1));
  push({ type: 'session.changed', session: session('r') });
  assert.equal(main, 1);
  assert.equal(rates, 0);
  push({ type: 'pty.rate', sessionId: 'r', samples: [0, 10, 20] });
  assert.equal(main, 1, 'the window did not hear the rate');
  assert.equal(rates, 1);
  assert.deepEqual(getRates().get('r'), [0, 10, 20]);
  assert.equal('rates' in getState(), false, 'the rates are not on State any more');
  // A removed session takes its samples with it, through the rates store.
  push({ type: 'session.removed', sessionId: 'r' });
  assert.equal(getRates().has('r'), false);
  assert.equal(rates, 2);
  offMain();
  offRates();
});

test('a keyed pick keeps its identity while its fields hold and moves when one does', () => {
  push({ type: 'session.changed', session: session('k') });
  const s1 = getState();
  const first = pickHeld(null, s1, ['sessions', 'layout']);
  assert.deepEqual(Object.keys(first), ['sessions', 'layout']);
  assert.equal(first.sessions, s1.sessions);
  // A push on another field: the same pick object comes back.
  push({ type: 'folders.changed', folders: [{ folder: 'C:\\repo', label: 'here' }] });
  const s2 = getState();
  assert.notEqual(s2.folders, s1.folders);
  assert.equal(pickHeld(first, s2, ['sessions', 'layout']), first);
  // A push on a named field: a new pick with the new field.
  push({ type: 'session.changed', session: session('k2') });
  const s3 = getState();
  const second = pickHeld(first, s3, ['sessions', 'layout']);
  assert.notEqual(second, first);
  assert.equal(second.sessions, s3.sessions);
  assert.equal(second.layout, first.layout);
});

test('the running shells Set holds while its members are the same', () => {
  const sessions = new Map([
    ['a', session('a')],
    ['b', session('b')],
    ['c', session('c', 'claude')],
  ]);
  const quiet = new Map<string, number[]>([['a', [0, 0]]]);
  const held = runningShellsHeld(new Set(), quiet, sessions);
  assert.deepEqual([...held], []);
  const busy = new Map<string, number[]>([
    ['a', [0, 40]],
    ['b', [0, 0]],
  ]);
  const running = runningShellsHeld(held, busy, sessions);
  assert.notEqual(running, held);
  assert.deepEqual([...running], ['a']);
  // Another window of output from the same shell: the same Set.
  const stillBusy = new Map<string, number[]>([
    ['a', [40, 90]],
    ['b', [0, 0]],
  ]);
  assert.equal(runningShellsHeld(running, stillBusy, sessions), running);
  // A second shell starts: a new Set.
  const both = new Map<string, number[]>([
    ['a', [40, 90]],
    ['b', [0, 5]],
  ]);
  const two = runningShellsHeld(running, both, sessions);
  assert.notEqual(two, running);
  assert.deepEqual([...two].sort(), ['a', 'b']);
});
