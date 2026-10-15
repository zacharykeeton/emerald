import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveMark } from './browser-drive-store.ts';

// M9 fixes 672 and 673: the driven mark's words. The module touches no
// window at import, which this import proves.
test('the mark says who drives, stays through the linger, and says when the person paused it', () => {
  assert.equal(driveMark(null), null);
  const running = { text: 'alpha is driving', title: 'alpha is driving this page with emmer browser; a click or a key in the page pauses it' };
  assert.deepEqual(driveMark({ by: 'alpha', running: true, paused: false }), running);
  assert.deepEqual(driveMark({ by: 'alpha', running: false, paused: false }), running);
  assert.deepEqual(driveMark({ by: 'alpha', running: false, paused: true }), { text: 'alpha paused', title: "A click or a key of yours paused alpha's commands" });
});
