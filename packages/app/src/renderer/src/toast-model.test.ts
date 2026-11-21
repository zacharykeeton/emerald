import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failedText, refusalReason, refusedText } from './toast-model.ts';
import { dismissToast, failedToast, getToast } from './toast-store.ts';

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

test('failedText and failedToast say what was refused and why, and log as warn did (M9 fix 1198)', () => {
  assert.equal(failedText('resume', new Error("Error invoking remote method 'emerald:request': Error: stub is unreachable")), 'Could not resume: stub is unreachable');
  assert.equal(failedText('rename', new Error('no session abc')), 'Could not rename: no session abc');
  const logged: unknown[] = [];
  const real = console.warn;
  console.warn = (...args: unknown[]) => {
    logged.push(args[0]);
  };
  try {
    failedToast('rename', 'rename tab')(new Error('x'));
  } finally {
    console.warn = real;
  }
  assert.equal(logged[0], '[emerald] rename tab failed');
  assert.equal(getToast()?.text, 'Could not rename: x');
  dismissToast();
});
