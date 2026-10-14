import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layersTitle, nextLayers, readLayers, showsBand, showsLanes, writeLayers } from './activity-layers.ts';

test('the layers cycle both, band, lanes, both', () => {
  assert.equal(nextLayers('both'), 'band');
  assert.equal(nextLayers('band'), 'lanes');
  assert.equal(nextLayers('lanes'), 'both');
});

test('the tooltip names the state after the click', () => {
  assert.equal(layersTitle('both'), 'Show the band alone');
  assert.equal(layersTitle('band'), 'Show the lanes alone');
  assert.equal(layersTitle('lanes'), 'Show the band and the lanes');
});

test('band and lanes read off the value', () => {
  assert.deepEqual([showsBand('both'), showsLanes('both')], [true, true]);
  assert.deepEqual([showsBand('band'), showsLanes('band')], [true, false]);
  assert.deepEqual([showsBand('lanes'), showsLanes('lanes')], [false, true]);
});

test('a missing or bad stored value reads as both, and a write reads back', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  try {
    assert.equal(readLayers('k'), 'both');
    store.set('k', 'nonsense');
    assert.equal(readLayers('k'), 'both');
    writeLayers('k', 'lanes');
    assert.equal(readLayers('k'), 'lanes');
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test('no storage at all reads as both and a write does not throw', () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  assert.equal(readLayers('k'), 'both');
  assert.doesNotThrow(() => writeLayers('k', 'band'));
});
