import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RUN_INLINE_TAGS, VIEW_FIND_LIMIT, findInRuns, scrollDelta, stepIndex } from './view-find-model.ts';

test('findInRuns: case-insensitive, each text in order, offsets in that text', () => {
  assert.deepEqual(findInRuns(['Hello the world', 'THE end'], [0, 1], 'the'), {
    hits: [
      { startNode: 0, start: 6, endNode: 0, end: 9 },
      { startNode: 1, start: 0, endNode: 1, end: 3 },
    ],
    capped: false,
  });
  assert.deepEqual(findInRuns(['anything'], [0], ''), { hits: [], capped: false });
  // Non-overlapping, left to right.
  assert.deepEqual(
    findInRuns(['aaaa'], [0], 'aa').hits.map((h) => h.start),
    [0, 2],
  );
});

test('findInRuns: the query is literal, never a pattern', () => {
  assert.deepEqual(findInRuns(['axb a.b'], [0], 'a.b').hits, [{ startNode: 0, start: 4, endNode: 0, end: 7 }]);
  assert.deepEqual(findInRuns(['(x) [y]'], [0], '[y]').hits, [{ startNode: 0, start: 4, endNode: 0, end: 7 }]);
});

test('findInRuns: a character whose lowercase is longer does not shift the offsets after it', () => {
  // 'İ'.toLowerCase() is two code units; a lowercased compare would put
  // the hit one past where it is.
  assert.equal('İx'.toLowerCase().length, 3);
  assert.deepEqual(findInRuns(['İx the needle'], [0], 'needle').hits, [{ startNode: 0, start: 7, endNode: 0, end: 13 }]);
});

test('findInRuns: a word split across two texts of one run is one hit spanning both (fix 635)', () => {
  assert.deepEqual(findInRuns(['nee', 'dle'], [0, 0], 'needle'), { hits: [{ startNode: 0, start: 0, endNode: 1, end: 3 }], capped: false });
  assert.deepEqual(findInRuns(['A nee', 'd', 'le here'], [0, 0, 0], 'needle').hits, [{ startNode: 0, start: 2, endNode: 2, end: 2 }]);
  assert.deepEqual(findInRuns(['nee', '', 'dle'], [0, 0, 0], 'needle').hits, [{ startNode: 0, start: 0, endNode: 2, end: 3 }]);
  // A hit ending at a text's end stays in it.
  assert.deepEqual(findInRuns(['the', ' end'], [0, 0], 'the').hits, [{ startNode: 0, start: 0, endNode: 0, end: 3 }]);
  assert.deepEqual(findInRuns(['İx nee', 'dle'], [0, 0], 'needle').hits, [{ startNode: 0, start: 3, endNode: 1, end: 3 }]);
});

test('findInRuns: two runs never join, adjacent or not, and the tag list leaves span out (fix 635)', () => {
  assert.deepEqual(findInRuns(['nee', 'dle'], [0, 1], 'needle').hits, []);
  assert.deepEqual(findInRuns(['nee', 'x', 'dle'], [0, 1, 0], 'needle').hits, []);
  assert.equal(RUN_INLINE_TAGS.has('STRONG'), true);
  assert.equal(RUN_INLINE_TAGS.has('A'), true);
  assert.equal(RUN_INLINE_TAGS.has('SPAN'), false);
  assert.equal(RUN_INLINE_TAGS.has('P'), false);
});

test('findInRuns: stops at the limit and says so, counting across runs', () => {
  const { hits, capped } = findInRuns(['a'.repeat(1500)], [0], 'a');
  assert.equal(hits.length, VIEW_FIND_LIMIT);
  assert.equal(capped, true);
  assert.equal(findInRuns(['a'.repeat(VIEW_FIND_LIMIT)], [0], 'a').capped, false);
  const across = findInRuns(['a'.repeat(600), 'a'.repeat(600)], [0, 1], 'a');
  assert.equal(across.hits.length, VIEW_FIND_LIMIT);
  assert.equal(across.capped, true);
  assert.equal(findInRuns(['a'.repeat(500), 'a'.repeat(500)], [0, 1], 'a').capped, false);
});

test('stepIndex: forward and back, wrapping at both ends', () => {
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(1, 3, -1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(-1, 3, 1), 0);
  assert.equal(stepIndex(-1, 3, -1), 2);
  assert.equal(stepIndex(0, 0, 1), -1);
  assert.equal(stepIndex(-1, 0, -1), -1);
});

test('scrollDelta: null inside the view below the bar, a third of the way down otherwise', () => {
  const view = { top: 100, bottom: 400 };
  assert.equal(scrollDelta({ top: 200, bottom: 220 }, view), null);
  // Exactly at the bar's band and exactly at the bottom are both inside.
  assert.equal(scrollDelta({ top: 136, bottom: 156 }, view), null);
  assert.equal(scrollDelta({ top: 380, bottom: 400 }, view), null);
  // Below: scroll down so the hit sits 100 px (a third of 300) down.
  assert.equal(scrollDelta({ top: 700, bottom: 720 }, view), 500);
  // Above, or under the bar: scroll up.
  assert.equal(scrollDelta({ top: 50, bottom: 70 }, view), -150);
  assert.equal(scrollDelta({ top: 135, bottom: 155 }, view), -65);
});
