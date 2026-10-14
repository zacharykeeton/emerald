import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atTarget } from './wait.ts';

test('wait --for stale is reached by a working session the daemon flagged, and by nothing else (M9 fix 232)', () => {
  assert.equal(atTarget({ state: 'working', stale: true }, 'stale'), true);
  assert.equal(atTarget({ state: 'working', stale: false }, 'stale'), false, 'working and posting is not a stall');
  assert.equal(atTarget({ state: 'needs-input', stale: false }, 'stale'), false, 'waiting on a person is not a stall');
  // A state target is the state alone: a stale working session is still working.
  assert.equal(atTarget({ state: 'working', stale: true }, 'working'), true);
  assert.equal(atTarget({ state: 'working', stale: true }, 'done'), false);
  assert.equal(atTarget({ state: 'done', stale: false }, 'done'), true);
});
