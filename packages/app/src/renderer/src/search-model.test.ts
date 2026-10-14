import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HIT_TEXT_MAX, matchLines } from './search-model.ts';

test('matchLines: case-insensitive substring, 1-based lines, CRLF and LF alike, the match marked', () => {
  const hits = matchLines('first\r\nThe Needle here\nnothing\n  needle again', 'needle');
  assert.deepEqual(hits, [
    { line: 2, text: 'The Needle here', at: 4, len: 6, col: 5 },
    { line: 4, text: 'needle again', at: 0, len: 6, col: 3 },
  ]);
});

test('matchLines: a long line is a window around the match, trimmed, with the cut ends marked', () => {
  const long = '   ' + 'x'.repeat(300) + ' needle';
  const [hit] = matchLines(long, 'NEEDLE');
  assert.ok(hit !== undefined);
  assert.equal(hit.text.length, HIT_TEXT_MAX);
  assert.ok(hit.text.startsWith('…x'), 'the front is cut and marked, the leading spaces gone');
  assert.ok(hit.text.endsWith(' needle'), 'the match is in the window');
  assert.equal(hit.text.slice(hit.at, hit.at + 6), 'needle', 'at says where');
  assert.equal(hit.col, 3 + 300 + 1 + 1, 'the column counts the leading spaces');
  const middle = 'a'.repeat(300) + 'needle' + 'b'.repeat(300);
  const [mid] = matchLines(middle, 'needle');
  assert.ok(mid !== undefined);
  assert.equal(mid.text.length, HIT_TEXT_MAX);
  assert.ok(mid.text.startsWith('…a') && mid.text.endsWith('b…'), 'both ends cut');
  assert.equal(mid.text.slice(mid.at, mid.at + 6), 'needle');
  const front = 'needle' + 'b'.repeat(300);
  const [first] = matchLines(front, 'needle');
  assert.ok(first !== undefined);
  assert.ok(first.text.startsWith('needle') && first.text.endsWith('…'), 'a match at the front cuts the tail only');
  assert.equal(first.at, 0);
});

test('matchLines: a needle that is not there, an empty needle, and the per-file cap', () => {
  assert.deepEqual(matchLines('a\nb\nc', 'z'), []);
  assert.deepEqual(matchLines('a\nb\nc', ''), [], 'an empty needle matches nothing');
  assert.equal(matchLines('hit\nhit\nhit\nhit', 'hit', 2).length, 2);
});
