import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MoveOutcome } from '../../preload/api.ts';
import { dropDirFor, HOVER_MOVE_EFFECT, hoverEffect, modeFor, moveNote } from './files-drop-model.ts';

// M9 fix 953: a drop from Explorer on the Files rail.

test('dropDirFor lands in a folder row, a file row its folder, and the root for nothing', () => {
  assert.equal(dropDirFor({ path: 'C:\\w\\src', kind: 'dir' }, 'C:\\w'), 'C:\\w\\src');
  assert.equal(dropDirFor({ path: 'C:\\w\\src\\a.ts', kind: 'file' }, 'C:\\w'), 'C:\\w\\src');
  assert.equal(dropDirFor({ path: 'C:\\a.txt', kind: 'file' }, 'C:\\w'), 'C:\\');
  assert.equal(dropDirFor(null, 'C:\\w'), 'C:\\w');
});

test('modeFor and hoverEffect follow Explorer\'s keys', () => {
  assert.equal(modeFor({ ctrl: false, shift: false }), 'auto');
  assert.equal(modeFor({ ctrl: false, shift: true }), 'move');
  assert.equal(modeFor({ ctrl: true, shift: false }), 'copy');
  assert.equal(modeFor({ ctrl: true, shift: true }), 'copy');
  assert.equal(hoverEffect({ ctrl: false, shift: false }), HOVER_MOVE_EFFECT);
  assert.equal(hoverEffect({ ctrl: false, shift: true }), HOVER_MOVE_EFFECT);
  assert.equal(hoverEffect({ ctrl: true, shift: false }), 'copy');
  assert.equal(hoverEffect({ ctrl: true, shift: true }), 'copy');
});

const o = (name: string, result: MoveOutcome['result'], extra: Partial<MoveOutcome> = {}): MoveOutcome => ({
  from: `D:\\src\\${name}`,
  to: `C:\\w\\into\\${name}`,
  result,
  ...extra,
});

test('moveNote says what landed, what was skipped, refused or kept, in that order', () => {
  assert.equal(moveNote([o('a.txt', 'moved')], 'into'), 'Moved a.txt into into');
  assert.equal(moveNote([o('a.txt', 'moved'), o('b.txt', 'moved', { replaced: true })], 'into'), 'Moved 2 items into into');
  assert.equal(moveNote([o('a.txt', 'copied')], 'into'), 'Copied a.txt into into');
  assert.equal(moveNote([o('a.txt', 'moved'), o('b.txt', 'copied')], 'into'), 'Moved 1 and copied 1 into into');
  assert.equal(moveNote([o('a.txt', 'skipped')], 'into'), 'Skipped a.txt: already in into');
  assert.equal(moveNote([o('a.txt', 'moved'), o('b.txt', 'moved'), o('c.txt', 'skipped')], 'into'), 'Moved 2 items into into; skipped c.txt');
  assert.equal(moveNote([o('a.txt', 'refused', { why: 'Not found' })], 'into'), 'a.txt could not go: Not found');
  assert.equal(
    moveNote([o('a.txt', 'refused', { why: 'Not found' }), o('b.txt', 'refused', { busy: true, why: 'Access denied or open in another program' })], 'into'),
    '2 could not go, a.txt: Not found',
  );
  assert.equal(
    moveNote([o('a.txt', 'moved'), o('src', 'inside', { why: 'A folder cannot go into itself' })], 'into'),
    'Moved a.txt into into; src could not go: A folder cannot go into itself',
  );
  assert.equal(
    moveNote([o('a.txt', 'copied', { sourceKept: true, why: 'Access denied' })], 'into'),
    'Copied a.txt into into; a.txt: copied, its original could not be removed',
  );
  assert.equal(moveNote([o('a.txt', 'here'), o('b.txt', 'here')], 'into'), 'Already in into');
  assert.equal(moveNote([], 'into'), null);
});
