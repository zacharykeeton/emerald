import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitsLine } from './agent-card-model.ts';

test('M9 fix 821: commitsLine names the count and the newest hash, and nothing for none', () => {
  assert.equal(commitsLine([]), null);
  assert.equal(commitsLine([{ hash: '1a2b3c4d5e6f' }]), '1 commit, 1a2b3c4');
  assert.equal(commitsLine([{ hash: 'aaaaaaaaaa' }, { hash: 'bbbbbbbbbb' }, { hash: '1a2b3c4d5e6f' }]), '3 commits, newest 1a2b3c4');
});
