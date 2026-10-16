import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markFrameAt, msToNextStep } from './mark-clock.ts';

// M9 fix 767: the frame is the wall clock's quarter second, mod four.
test('markFrameAt steps a frame each quarter second and wraps at four', () => {
  assert.deepEqual([0, 249, 250, 500, 999, 1000].map(markFrameAt), [0, 0, 1, 2, 3, 0]);
});

test('msToNextStep counts down to the next quarter', () => {
  assert.deepEqual([0, 1, 249].map(msToNextStep), [250, 249, 1]);
});
