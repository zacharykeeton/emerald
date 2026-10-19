import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitsLine, nowLine } from './agent-card-model.ts';

test('M9 fix 821: commitsLine names the count and the newest hash, and nothing for none', () => {
  assert.equal(commitsLine([]), null);
  assert.equal(commitsLine([{ hash: '1a2b3c4d5e6f' }]), '1 commit, 1a2b3c4');
  assert.equal(commitsLine([{ hash: 'aaaaaaaaaa' }, { hash: 'bbbbbbbbbb' }, { hash: '1a2b3c4d5e6f' }]), '3 commits, newest 1a2b3c4');
});

test('M9 fix 903: nowLine gives the latest words, with their age once a minute old, and nothing for no text', () => {
  assert.equal(nowLine(undefined, 1_000_000), null);
  const said = { text: 'Reading the grid.', at: 1_000_000 };
  assert.deepEqual(nowLine(said, 1_005_000), { text: 'Reading the grid.', age: null }, 'no age at five seconds');
  assert.deepEqual(nowLine(said, 1_060_000), { text: 'Reading the grid.', age: '1m ago' }, 'a minute exactly');
  assert.deepEqual(nowLine(said, 1_125_000), { text: 'Reading the grid.', age: '2m ago' });
});
