import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchText, isDetachedName } from './branch-text.ts';

test('branchText says detached at for a seven-hex short id and leaves a branch name as it is (M9 fix 1160)', () => {
  assert.equal(branchText('1184019'), 'detached at 1184019');
  for (const name of ['main', 'm9-seat-a', 'abcdef01', 'abc123', 'ABCDEF0']) assert.equal(branchText(name), name);
  assert.equal(isDetachedName('0123456'), true);
  assert.equal(isDetachedName('main'), false);
});
