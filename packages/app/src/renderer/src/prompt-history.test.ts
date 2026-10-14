import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyEntries, rememberRecent, stepHistory } from './prompt-history.ts';

test('historyEntries puts the saved prompts first and the recent ones after, a recent copy of a saved text left out', () => {
  const entries = historyEntries(
    [
      { name: 'commit', text: 'commit what is staged' },
      { name: 'tests', text: 'run the tests' },
    ],
    ['run the tests', 'dir', 'git status'],
  );
  assert.deepEqual(entries, [
    { name: 'commit', text: 'commit what is staged' },
    { name: 'tests', text: 'run the tests' },
    { name: null, text: 'dir' },
    { name: null, text: 'git status' },
  ]);
});

test('rememberRecent moves a repeated text to the front and caps the list at twenty', () => {
  assert.deepEqual(rememberRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  const many = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const next = rememberRecent(many, 'new');
  assert.equal(next.length, 20);
  assert.equal(next[0], 'new');
  assert.equal(next.at(-1), 'p18');
});

test('stepHistory walks up into the list and down back to the typed line, stopping at both ends', () => {
  assert.equal(stepHistory(-1, 1, 3), 0);
  assert.equal(stepHistory(0, 1, 3), 1);
  assert.equal(stepHistory(2, 1, 3), 2);
  assert.equal(stepHistory(2, -1, 3), 1);
  assert.equal(stepHistory(0, -1, 3), -1);
  assert.equal(stepHistory(-1, -1, 3), -1);
  assert.equal(stepHistory(-1, 1, 0), -1);
});
