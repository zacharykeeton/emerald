import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PtyBroker } from './pty-broker.ts';

test('two windows on one session: the first detach is not forwarded and the second is (M9 fix 866)', () => {
  const b = new PtyBroker();
  b.attach('s1', 1);
  b.attach('s1', 2);
  assert.equal(b.detach('s1', 1), false);
  assert.equal(b.detach('s1', 2), true);
});

test('a detach from a window that never attached is forwarded when no window holds the session and not when another does', () => {
  const b = new PtyBroker();
  assert.equal(b.detach('s1', 1), true);
  b.attach('s1', 2);
  assert.equal(b.detach('s1', 1), false);
  assert.equal(b.detach('s1', 2), true);
});

test('drop answers only the sessions no other window holds', () => {
  const b = new PtyBroker();
  b.attach('s1', 1);
  b.attach('s2', 1);
  b.attach('s2', 2);
  b.attach('s3', 2);
  assert.deepEqual(b.drop(1), ['s1']);
  assert.equal(b.detach('s2', 2), true, 's2 is window 2\'s alone now');
  assert.deepEqual(b.drop(2), ['s3']);
});

test('clear forgets everything', () => {
  const b = new PtyBroker();
  b.attach('s1', 1);
  b.attach('s1', 2);
  b.clear();
  assert.equal(b.detach('s1', 1), true);
  assert.deepEqual(b.drop(2), []);
});

test('held names every session a window holds, and clear spares what keep answers for (M9 fix 1081)', () => {
  const b = new PtyBroker();
  b.attach('local', 1);
  b.attach('remote', 1);
  b.attach('remote', 2);
  assert.deepEqual(b.held().sort(), ['local', 'remote']);
  b.clear((id) => id === 'remote');
  assert.deepEqual(b.held(), ['remote']);
  assert.equal(b.detach('remote', 1), false, 'window 2 still holds it');
});
