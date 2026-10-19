import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { blockAtLine, installSourceLines } from './markdown-source-line.ts';

test('installSourceLines: each block carries its 1-based start line, a fence on its code, a table row on the row (M9 fix 892)', () => {
  const md = new MarkdownIt({ html: false });
  installSourceLines(md);
  const text = ['# Title', '', 'Para one', 'still one', '', '- a', '- b', '', '```js', 'x', 'y', '```', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '---', '', '## Two', '', 'text', ''].join('\n');
  const html = md.render(text);
  for (const want of ['<h1 data-source-line="1">', '<p data-source-line="3">', '<li data-source-line="7">', '<code data-source-line="9" class="language-js">', '<tr data-source-line="16">', '<hr data-source-line="18">', '<h2 data-source-line="20">']) {
    assert.ok(html.includes(want), `${want} in ${html}`);
  }
});

test('blockAtLine: the last block starting at or before the line, the innermost on a tie, the first before any (M9 fix 892)', () => {
  const lines = [1, 3, 6, 6, 7, 9, 14, 16, 18];
  assert.equal(blockAtLine(lines, 10), 5);
  assert.equal(blockAtLine(lines, 4), 1);
  assert.equal(blockAtLine(lines, 6), 3);
  assert.equal(blockAtLine(lines, 0), 0);
  assert.equal(blockAtLine(lines, 99), 8);
  assert.equal(blockAtLine([], 5), -1);
});
