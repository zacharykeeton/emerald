import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PresenceTracker } from './presence.ts';

// M9 fix 245: the tracker speaks only at the edges. A lock during an
// idle stretch is the same absence, and the unlock alone does not end
// it while the idle clock still says nobody has touched the box.
test('the presence tracker gives one away and one back per absence, whatever held it', () => {
  const t = new PresenceTracker();
  assert.equal(t.away, false);
  assert.equal(t.set('idle', true), 'away');
  assert.equal(t.set('locked', true), null);
  assert.equal(t.set('locked', false), null);
  assert.equal(t.away, true);
  assert.equal(t.set('idle', false), 'back');
  assert.equal(t.away, false);
  // A back with nothing held, and an away repeated, are nothing.
  assert.equal(t.set('asleep', false), null);
  assert.equal(t.set('asleep', true), 'away');
  assert.equal(t.set('asleep', true), null);
  assert.equal(t.set('asleep', false), 'back');
});
