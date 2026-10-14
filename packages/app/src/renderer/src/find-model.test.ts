import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCountText } from './find-model.ts';

test('findCountText: the index as people count, nothing before a search, no matches said plainly', () => {
  assert.equal(findCountText(null), '');
  assert.equal(findCountText({ index: 0, count: 11 }), '1 of 11');
  assert.equal(findCountText({ index: 10, count: 11 }), '11 of 11');
  assert.equal(findCountText({ index: 0, count: 0 }), 'No matches');
  assert.equal(findCountText({ index: -1, count: 0 }), 'No matches');
  // Past the highlight limit the addon has a count but no active index.
  assert.equal(findCountText({ index: -1, count: 1500 }), '1500 matches');
});
