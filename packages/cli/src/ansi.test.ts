import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastLines, stripAnsi, toLines } from './ansi.ts';

const ESC = '\x1b';

test('stripAnsi drops colours, cursor moves, erases, titles and charset selects', () => {
  const raw = `${ESC}[93mecho ${ESC}[37mhi${ESC}[m${ESC}[?25l${ESC}[2J${ESC}[H${ESC}]0;title${ESC}\\${ESC}(B${ESC}[K done`;
  assert.equal(stripAnsi(raw), 'echo hi done');
});

test('stripAnsi renders cursor forward as spaces', () => {
  assert.equal(stripAnsi(`PS>${ESC}[1Cecho`), 'PS> echo');
  assert.equal(stripAnsi(`a${ESC}[3Cb`), 'a   b');
  assert.equal(stripAnsi(`a${ESC}[Cb`), 'a b');
});

test('toLines treats CRLF as one line break and a bare CR as starting over', () => {
  assert.deepEqual(toLines('one\r\ntwo\r\n'), ['one', 'two', '']);
  assert.deepEqual(toLines('10%\r50%\r100%\ndone'), ['100%', 'done']);
  // Trailing blanks are the terminal padding the row to its width.
  assert.deepEqual(toLines('x     \r\n'), ['x', '']);
});

test('toLines drops the control characters that are not line breaks', () => {
  assert.deepEqual(toLines('a\x07b\x00c'), ['abc']);
});

test('toLines applies a backspace as stepping back one cell, the way PSReadLine redraws a keystroke', () => {
  assert.deepEqual(toLines('PS C:\\x> e\x1b[m\x1b[93m\becho hi'), ['PS C:\\x> echo hi']);
  assert.deepEqual(toLines('ab\b\b\bcd'), ['cd'], 'stepping back past the start is harmless');
});

test('lastLines keeps the last N lines with text and drops the blank tail', () => {
  const text = 'one\r\ntwo\r\n\r\nthree\r\n\r\n\r\n';
  assert.deepEqual(lastLines(text, undefined), ['one', 'two', '', 'three']);
  assert.deepEqual(lastLines(text, 2), ['', 'three']);
  assert.deepEqual(lastLines(text, 99), ['one', 'two', '', 'three']);
  assert.deepEqual(lastLines('', 3), []);
});
