import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerOptions, promptExcerpt } from './screen-prompt-model.ts';

// A permission dialog as Claude Code 2.1 draws it, the transcript above
// it, the cursor on the dialog's last row.
const PERMISSION = [
  '● I will edit the file now.',
  '',
  '╭──────────────────────────────────────────────╮',
  '│ Edit file                                    │',
  '│                                              │',
  '│ Do you want to make this edit to session.ts? │',
  '│ ❯ 1. Yes                                     │',
  '│   2. Yes, allow all edits during this session │',
  '│   3. No, and tell Claude what to do differently │',
  '╰──────────────────────────────────────────────╯',
  '',
  '',
];

test('promptExcerpt takes the rows from the last blank row above the cursor to the cursor, the frame stripped', () => {
  const out = promptExcerpt(PERMISSION, { x: 0, y: 9 });
  assert.deepEqual(out, ['Edit file', '', 'Do you want to make this edit to session.ts?', '❯ 1. Yes', '2. Yes, allow all edits during this session', '3. No, and tell Claude what to do differently']);
});

test('promptExcerpt drops trailing blank rows and caps the height', () => {
  assert.deepEqual(promptExcerpt(PERMISSION, { x: 0, y: 11 }), [], 'a cursor below the dialog on blank rows finds nothing above the last blank');
  const tall = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  assert.equal(promptExcerpt(tall, { x: 0, y: 39 }).length, 14);
  assert.deepEqual(promptExcerpt([], { x: 0, y: 0 }), []);
});

test('answerOptions reads the numbered options with the digit as the key', () => {
  assert.deepEqual(answerOptions(PERMISSION), [
    { key: '1', label: 'Yes' },
    { key: '2', label: 'Yes, allow all edits during this session' },
    { key: '3', label: 'No, and tell Claude what to do differently' },
  ]);
});

test('answerOptions keeps the last list when an older dialog is still on screen', () => {
  const rows = ['1. Old', '2. Older', '', 'Trust this folder?', '❯ 1. Yes, proceed', '  2. No, exit'];
  assert.deepEqual(answerOptions(rows), [
    { key: '1', label: 'Yes, proceed' },
    { key: '2', label: 'No, exit' },
  ]);
});

test('answerOptions gives a y/n pair for a yes-or-no question and nothing otherwise', () => {
  assert.deepEqual(answerOptions(['> 1. Yes', '  2. No']), [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }], 'a plain > pointer');
  assert.deepEqual(answerOptions(['Overwrite the file? (y/n)']), [
    { key: 'y', label: 'Yes' },
    { key: 'n', label: 'No' },
  ]);
  assert.deepEqual(answerOptions(['What should the function be called?', '> ']), []);
});
