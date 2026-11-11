import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyImageRoute, pickCopySize } from './copy-image-model.ts';
import { isImage } from './tabs-model.ts';

test('copyImageRoute sends PNG and JPEG to main and the rest to the canvas (M9 fix 1111)', () => {
  for (const f of ['a.png', 'a.jpg', 'a.JPEG']) assert.equal(copyImageRoute(f), 'main', f);
  for (const f of ['a.gif', 'a.webp', 'a.bmp', 'a.ico', 'a.svg']) assert.equal(copyImageRoute(f), 'canvas', f);
  for (const f of ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.bmp', 'a.ico', 'a.svg']) {
    if (isImage(f)) assert.ok(['main', 'canvas'].includes(copyImageRoute(f)), f);
  }
});

test('pickCopySize takes declared, then the view, then natural, capped (M9 fix 1111)', () => {
  assert.deepEqual(pickCopySize({ w: 3000, h: 40 }, { w: 500, h: 7 }, { w: 300, h: 150 }), { w: 3000, h: 40 });
  assert.deepEqual(pickCopySize(null, { w: 120.4, h: 60.6 }, { w: 300, h: 150 }), { w: 120, h: 61 });
  assert.deepEqual(pickCopySize(null, null, { w: 3, h: 2 }), { w: 3, h: 2 });
  assert.deepEqual(pickCopySize({ w: 20000, h: 100 }, null, { w: 300, h: 150 }), { w: 8192, h: 41 });
  assert.deepEqual(pickCopySize({ w: 0, h: 10 }, null, { w: 3, h: 2 }), { w: 3, h: 2 });
  assert.equal(pickCopySize(null, null, { w: 0, h: 0 }), null);
});
