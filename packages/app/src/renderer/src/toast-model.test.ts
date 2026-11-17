import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refusalReason, refusedText } from './toast-model.ts';

test('refusedText says how many of how many and why (M9 fix 1181)', () => {
  assert.equal(refusedText('clear', 1, 1, 'stub is unreachable'), 'Could not clear 1 of 1 exited session: stub is unreachable');
  assert.equal(refusedText('clear', 2, 5, 'no session 8a1198f2'), 'Could not clear 2 of 5 exited sessions: no session 8a1198f2');
  assert.equal(refusedText('resume', 1, 3, 'x'), 'Could not resume 1 of 3 exited sessions: x');
  assert.equal(refusedText('kill', 1, 1, 'x'), 'Could not kill 1 of 1 session: x');
  assert.equal(refusedText('remove', 2, 2, 'x'), 'Could not remove 2 of 2 sessions: x');
});

test('refusalReason cuts Electron\'s prefix and leaves a clean message alone (M9 fix 1181)', () => {
  assert.equal(refusalReason(new Error("Error invoking remote method 'emerald:request': Error: stub is unreachable")), 'stub is unreachable');
  assert.equal(refusalReason(new Error('no session abc')), 'no session abc');
  assert.equal(refusalReason('x'), 'x');
});
