import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copiedNote, noteIn } from './copy-note.ts';

test('copiedNote: a text within one line is counted in characters, by code point (M9 fix 806)', () => {
  assert.equal(copiedNote('abc'), 'Copied 3 characters');
  assert.equal(copiedNote('a'), 'Copied 1 character');
  assert.equal(copiedNote('👍🏽'), 'Copied 2 characters', 'an emoji and its skin tone are two code points');
  assert.equal(copiedNote('a😀b'), 'Copied 3 characters');
});

test('copiedNote: a text holding a line break is counted in lines, a trailing break not a line of its own (M9 fix 806)', () => {
  assert.equal(copiedNote('a\nb\nc'), 'Copied 3 lines');
  assert.equal(copiedNote('a\r\nb'), 'Copied 2 lines');
  assert.equal(copiedNote('abc\n'), 'Copied 1 line');
  assert.equal(copiedNote('a\nb\n'), 'Copied 2 lines');
  assert.equal(copiedNote('\n'), 'Copied 1 line');
});

test("noteIn: a copy's note in its own pane, a window's note in the corner alone (M9 fix 849)", () => {
  const copy = { text: 'Copied 3 characters', paneId: 'p1' };
  assert.equal(noteIn(copy, 'p1'), 'Copied 3 characters');
  assert.equal(noteIn(copy, 'p2'), null);
  assert.equal(noteIn(copy, null), null);
  const windowNote = { text: 'Nothing is waiting', paneId: null };
  assert.equal(noteIn(windowNote, null), 'Nothing is waiting');
  assert.equal(noteIn(windowNote, 'p1'), null);
  assert.equal(noteIn(null, null), null);
});
