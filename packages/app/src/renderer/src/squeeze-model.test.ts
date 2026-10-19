import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipped, exactClipped, squeezeLevel, squeezeTolerance } from './squeeze-model.ts';

test('squeezeLevel: the first level that fits, tried from 0 each time', () => {
  const tried: number[] = [];
  const level = squeezeLevel(4, (l) => {
    tried.push(l);
    return l >= 2;
  });
  assert.equal(level, 2);
  assert.deepEqual(tried, [0, 1, 2]);
});

test('squeezeLevel: a line that fits whole stays at 0 after one measurement', () => {
  const tried: number[] = [];
  assert.equal(
    squeezeLevel(4, (l) => {
      tried.push(l);
      return true;
    }),
    0,
  );
  assert.deepEqual(tried, [0]);
});

test('squeezeLevel: the last level is kept without being measured when every other clips', () => {
  const tried: number[] = [];
  assert.equal(
    squeezeLevel(3, (l) => {
      tried.push(l);
      return false;
    }),
    2,
  );
  assert.deepEqual(tried, [0, 1]);
});

test('squeezeLevel: no levels means 0 and no measurement', () => {
  assert.equal(
    squeezeLevel(0, () => {
      throw new Error('measured');
    }),
    0,
  );
  assert.equal(
    squeezeLevel(1, () => {
      throw new Error('measured');
    }),
    0,
  );
});

test('clipped: one pixel of rounding is not a clip, two is', () => {
  assert.equal(clipped({ scrollWidth: 100, clientWidth: 100 }), false);
  assert.equal(clipped({ scrollWidth: 101, clientWidth: 100 }), false);
  assert.equal(clipped({ scrollWidth: 102, clientWidth: 100 }), true);
  assert.equal(clipped({ scrollWidth: 0, clientWidth: 0 }), false);
});

test('clipped: an ellipsis part has no tolerance and a box keeps the pixel (M9 fix 859)', () => {
  assert.equal(clipped({ scrollWidth: 101, clientWidth: 100 }, 0), true);
  assert.equal(clipped({ scrollWidth: 100, clientWidth: 100 }, 0), false);
  assert.equal(clipped({ scrollWidth: 0, clientWidth: 0 }, 0), false);
  assert.equal(clipped({ scrollWidth: 101, clientWidth: 100 }, 1), false);
  assert.equal(squeezeTolerance('ellipsis'), 0);
  assert.equal(squeezeTolerance('clip'), 1);
});

test('exactClipped: a part measured to the fraction gives once half a pixel is cut (M9 fix 859)', () => {
  assert.equal(exactClipped(100.4, 100), false);
  assert.equal(exactClipped(100.6, 100), true);
  assert.equal(exactClipped(100, 100), false);
  assert.equal(exactClipped(0, 0), false);
});
