import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CANVAS_COPY_IMAGE, declaredImageSize, icoSize, imageMime, svgSize } from './copy-image-read.ts';

test('svgSize reads width and height, else the viewBox, else a mix by ratio (M9 fix 1111)', () => {
  assert.deepEqual(svgSize('<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="40">'), { w: 3000, h: 40 });
  assert.deepEqual(svgSize('<svg viewBox="0 0 120 60">'), { w: 120, h: 60 });
  assert.deepEqual(svgSize('<svg viewBox="0,0,120,60">'), { w: 120, h: 60 });
  assert.deepEqual(svgSize('<svg width="100%" height="100%" viewBox="0 0 24 24">'), { w: 24, h: 24 });
  assert.deepEqual(svgSize('<svg width="48" viewBox="0 0 24 12">'), { w: 48, h: 24 });
  assert.deepEqual(svgSize('<svg width="10.5px" height="4">'), { w: 10.5, h: 4 });
  assert.deepEqual(svgSize('<svg stroke-width="2" viewBox="0 0 10 20">'), { w: 10, h: 20 });
  assert.deepEqual(svgSize('\ufeff<?xml version="1.0"?>\n<!-- c -->\n<svg width="5" height="6">'), { w: 5, h: 6 });
  assert.equal(svgSize('<svg xmlns="http://www.w3.org/2000/svg">'), null);
  assert.equal(svgSize('<svg width="12">'), null);
  assert.equal(svgSize('no tag here'), null);
});

function ico(entries: Array<[number, number]>): Uint8Array {
  const b = new Uint8Array(6 + 16 * entries.length);
  b[2] = 1;
  b[4] = entries.length;
  entries.forEach(([w, h], i) => {
    b[6 + 16 * i] = w;
    b[7 + 16 * i] = h;
  });
  return b;
}

test('icoSize takes the largest entry, a 0 meaning 256, and refuses a bad header (M9 fix 1111)', () => {
  assert.deepEqual(icoSize(ico([[1, 1]])), { w: 1, h: 1 });
  assert.deepEqual(icoSize(ico([[16, 16], [0, 0]])), { w: 256, h: 256 });
  assert.equal(icoSize(new Uint8Array(5)), null);
  const wrongType = ico([[1, 1]]);
  wrongType[2] = 2;
  assert.equal(icoSize(wrongType), null);
  const none = ico([[1, 1]]);
  none[4] = 0;
  assert.equal(icoSize(none), null);
  const short = ico([[1, 1]]);
  short[4] = 2;
  assert.equal(icoSize(short), null);
});

test('the canvas kinds, their mime and their declared size (M9 fix 1111)', () => {
  for (const f of ['a.gif', 'a.WEBP', 'a.bmp', 'a.ico', 'a.svg']) assert.ok(CANVAS_COPY_IMAGE.test(f), f);
  for (const f of ['a.png', 'a.jpg', 'a.jpeg']) assert.ok(!CANVAS_COPY_IMAGE.test(f), f);
  assert.equal(declaredImageSize('C:\\a\\b.gif', new Uint8Array(30)), null);
  assert.equal(imageMime('C:\\a\\b.SVG'), 'image/svg+xml');
  assert.equal(imageMime('x.ico'), 'image/x-icon');
  assert.equal(imageMime('x.txt'), 'application/octet-stream');
});
