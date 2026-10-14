import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MirrorRing, chooseSize, sameFit, scaleFor } from './mirror-model.ts';

const fit = (cols: number, rows: number) => ({ cols, rows });

test('chooseSize takes the focused pane when a handle sits in it', () => {
  const handles = [
    { paneId: 'a', fit: fit(80, 24) },
    { paneId: 'b', fit: fit(120, 40) },
  ];
  assert.deepEqual(chooseSize(handles, 'b', 'a'), { paneId: 'b', fit: fit(120, 40) });
  assert.deepEqual(chooseSize(handles, 'a', 'b'), { paneId: 'a', fit: fit(80, 24) });
});

test('chooseSize keeps the pane chosen last while the focus is elsewhere, then falls back to the first with a size', () => {
  const handles = [
    { paneId: 'a', fit: fit(80, 24) },
    { paneId: 'b', fit: fit(120, 40) },
  ];
  assert.deepEqual(chooseSize(handles, 'c', 'b'), { paneId: 'b', fit: fit(120, 40) }, 'a third pane focused: the last choice stands');
  assert.deepEqual(chooseSize(handles, 'c', 'gone'), { paneId: 'a', fit: fit(80, 24) }, 'the last choice is gone: the first sized handle');
  assert.deepEqual(chooseSize(handles, null, null), { paneId: 'a', fit: fit(80, 24) }, 'a lone pane sizes as it always did');
  assert.deepEqual(chooseSize([{ paneId: 'a', fit: null }, ...handles.slice(1)], 'a', 'a'), { paneId: 'b', fit: fit(120, 40) }, 'a focused pane with no size is skipped');
  assert.equal(chooseSize([{ paneId: 'a', fit: null }], 'a', null), null, 'nothing has a size');
  assert.equal(chooseSize([], 'a', null), null);
});

test('sameFit compares columns and rows and treats null as its own value', () => {
  assert.equal(sameFit(fit(80, 24), fit(80, 24)), true);
  assert.equal(sameFit(fit(80, 24), fit(80, 25)), false);
  assert.equal(sameFit(null, null), true);
  assert.equal(sameFit(fit(80, 24), null), false);
});

test('scaleFor shrinks to the tighter side and never grows', () => {
  assert.equal(scaleFor({ width: 400, height: 300 }, { width: 800, height: 300 }), 0.5, 'width is the tighter side');
  assert.equal(scaleFor({ width: 800, height: 150 }, { width: 800, height: 300 }), 0.5, 'height is the tighter side');
  assert.equal(scaleFor({ width: 1600, height: 900 }, { width: 800, height: 300 }), 1, 'a host with room shows 1:1');
  assert.equal(scaleFor({ width: 0, height: 300 }, { width: 800, height: 300 }), 1, 'a host with no size is left alone');
  assert.equal(scaleFor({ width: 400, height: 300 }, { width: 0, height: 0 }), 1);
});

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

test('MirrorRing keeps the last capacity bytes across wraps and clears', () => {
  const ring = new MirrorRing(8);
  assert.equal(ring.size, 0);
  ring.write(bytes('abc'));
  assert.equal(text(ring.readAll()), 'abc');
  ring.write(bytes('defgh'));
  assert.equal(text(ring.readAll()), 'abcdefgh', 'full to the byte');
  ring.write(bytes('ij'));
  assert.equal(text(ring.readAll()), 'cdefghij', 'the oldest two dropped, the write wrapped');
  ring.write(bytes('klm'));
  assert.equal(text(ring.readAll()), 'fghijklm');
  ring.write(bytes('0123456789'));
  assert.equal(text(ring.readAll()), '23456789', 'a chunk larger than the ring leaves its tail');
  ring.write(new Uint8Array(0));
  assert.equal(text(ring.readAll()), '23456789', 'an empty write changes nothing');
  ring.clear();
  assert.equal(ring.size, 0);
  assert.equal(ring.readAll().length, 0);
  ring.write(bytes('xy'));
  assert.equal(text(ring.readAll()), 'xy', 'writes after a clear start from the beginning');
  assert.throws(() => new MirrorRing(0), RangeError);
});
