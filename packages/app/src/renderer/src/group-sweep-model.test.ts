import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE_GRACE_MS, closeTyping, sweepCounts, sweepLabel, sweepTitle } from './group-sweep-model.ts';

test('closeTyping: /exit after the paste pause for a Claude, a bare exit for a shell, nothing for an exited one', () => {
  assert.deepEqual(closeTyping({ kind: 'claude', claudeSessionId: null, state: 'idle' }), { text: '/exit', enterDelayMs: 1500 });
  // A shell that started claude is a Claude until it leaves.
  assert.deepEqual(closeTyping({ kind: 'shell', claudeSessionId: 'abc', state: 'working' }), { text: '/exit', enterDelayMs: 1500 });
  assert.deepEqual(closeTyping({ kind: 'shell', claudeSessionId: null, state: 'idle' }), { text: 'exit', enterDelayMs: 0 });
  assert.equal(closeTyping({ kind: 'claude', claudeSessionId: 'abc', state: 'exited' }), null);
});

test('sweepCounts counts every session and the working ones', () => {
  assert.deepEqual(sweepCounts([]), { count: 0, working: 0 });
  assert.deepEqual(sweepCounts([{ state: 'idle' }, { state: 'working' }, { state: 'needs-input' }, { state: 'working' }]), { count: 4, working: 2 });
});

test('sweepLabel puts the count after the verb', () => {
  assert.equal(sweepLabel('close', { count: 2, working: 0 }), 'Close all 2');
  assert.equal(sweepLabel('kill', { count: 8, working: 3 }), 'Kill all 8');
  assert.equal(sweepLabel('remove', { count: 1, working: 0 }), 'Kill all 1 and remove');
});

test('sweepTitle names the fallback and how many are working', () => {
  assert.equal(sweepTitle('close', { count: 2, working: 0 }), `Type /exit into each Claude and exit into each shell, and kill any that has not gone after ${CLOSE_GRACE_MS / 1000} seconds`);
  assert.match(sweepTitle('close', { count: 2, working: 1 }), /; one of them is working now$/);
  assert.match(sweepTitle('kill', { count: 5, working: 2 }), /; 2 of them are working now$/);
  assert.match(sweepTitle('remove', { count: 5, working: 0 }), /forget each as it exits$/);
});
