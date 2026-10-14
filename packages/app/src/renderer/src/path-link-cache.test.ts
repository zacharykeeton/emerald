import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStatCache, STAT_CACHE_MS } from './path-link-cache.ts';

test('a hit inside the five-second window, a miss once it has passed (M9 fix 425)', () => {
  let now = 1_000_000;
  const cache = createStatCache<string>(() => now);
  assert.equal(cache.get('C:\\a.ts'), undefined);
  cache.set('C:\\a.ts', 'file');
  assert.equal(cache.get('C:\\a.ts'), 'file');
  now += STAT_CACHE_MS - 1;
  assert.equal(cache.get('C:\\a.ts'), 'file');
  now += 1;
  assert.equal(cache.get('C:\\a.ts'), undefined);
});

test('a fresh answer restarts the window, and each path is kept apart', () => {
  let now = 0;
  const cache = createStatCache<number>(() => now);
  cache.set('a', 1);
  now += STAT_CACHE_MS - 1;
  assert.equal(cache.get('a'), 1);
  cache.set('a', 2);
  now += STAT_CACHE_MS - 1;
  assert.equal(cache.get('a'), 2);
  assert.equal(cache.get('b'), undefined);
});
