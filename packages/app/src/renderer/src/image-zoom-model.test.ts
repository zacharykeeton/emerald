import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchoredScroll, clickCursor, clickTarget, fitScale, zoomChip, zoomStep } from './image-zoom-model.ts';

test('fitScale: shrinks a large picture, never grows a small one', () => {
  assert.equal(fitScale({ w: 3000, h: 40 }, { w: 700, h: 500 }), 700 / 3000);
  assert.equal(fitScale({ w: 3, h: 2 }, { w: 700, h: 500 }), 1);
  assert.equal(fitScale({ w: 0, h: 0 }, { w: 700, h: 500 }), 1);
  assert.equal(fitScale({ w: 100, h: 100 }, { w: 0, h: 0 }), 1);
});

test("zoomStep: the picture's own steps from any scale", () => {
  assert.equal(zoomStep(0.23, 1), 0.25);
  assert.equal(zoomStep(0.25, 1), 0.33);
  assert.equal(zoomStep(0.6700001, 1), 0.8);
  assert.equal(zoomStep(2, 1), 3);
  assert.equal(zoomStep(8, 1), 8);
  assert.equal(zoomStep(0.4, -1), 0.33);
  assert.equal(zoomStep(1, -1), 0.8);
  assert.equal(zoomStep(0.1, -1), 0.1);
  assert.equal(zoomStep(0.05, 1), 0.1);
});

test('zoomChip: 100% when the fit is actual size', () => {
  assert.equal(zoomChip('fit', 1), '100%');
  assert.equal(zoomChip('fit', 0.9995), '100%');
  assert.equal(zoomChip('fit', 0.23), 'Fit');
  assert.equal(zoomChip(0.33, 0.23), '33%');
  assert.equal(zoomChip(3, 1), '300%');
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
