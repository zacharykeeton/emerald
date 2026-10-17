import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchoredScroll, clickCursor, clickTarget, fitScale, zoomStep } from './image-zoom-model.ts';

test('fitScale: shrinks a large picture, never grows a small one', () => {
  assert.equal(fitScale({ w: 3000, h: 40 }, { w: 700, h: 500 }), 700 / 3000);
  assert.equal(fitScale({ w: 3, h: 2 }, { w: 700, h: 500 }), 1);
  assert.equal(fitScale({ w: 0, h: 0 }, { w: 700, h: 500 }), 1);
  assert.equal(fitScale({ w: 100, h: 100 }, { w: 0, h: 0 }), 1);
});

test('zoomStep: the commit graph steps from any scale', () => {
  assert.equal(zoomStep(0.23, 1), 0.5);
  assert.equal(zoomStep(0.5, 1), 0.67);
  assert.equal(zoomStep(0.6700001, 1), 0.8);
  assert.equal(zoomStep(2, 1), 2);
  assert.equal(zoomStep(0.4, -1), 0.4);
  assert.equal(zoomStep(1, -1), 0.8);
});

test('clickTarget and clickCursor: a magnifier only where a click changes the size', () => {
  assert.equal(clickTarget('fit'), 1);
  assert.equal(clickTarget(1.5), 'fit');
  assert.equal(clickCursor('fit', 0.3), 'zoom-in');
  assert.equal(clickCursor('fit', 1), null);
  assert.equal(clickCursor(1, 0.3), 'zoom-out');
  assert.equal(clickCursor(1, 1), null);
  assert.equal(clickCursor(1.5, 1), 'zoom-out');
});

test('anchoredScroll: the point under the pointer stays under it', () => {
  assert.equal(anchoredScroll({ scroll: 0, imageStart: 0, hostStart: 0, into: 100, offset: 200, from: 1, to: 2 }), 0);
  assert.equal(anchoredScroll({ scroll: 300, imageStart: -300, hostStart: 0, into: 400, offset: 100, from: 1, to: 2 }), 700);
  assert.equal(anchoredScroll({ scroll: 0, imageStart: 0, hostStart: 0, into: 10, offset: 500, from: 1, to: 2 }), 0);
});
