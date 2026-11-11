import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePath } from './files-model.ts';
import type { MoveOutcome } from '../../preload/api.ts';
import { BYTE_NOTE_MIN_AVERAGE, byteSize, copyingNote, dropDirFor, HOVER_MOVE_EFFECT, hoverEffect, modeFor, moveNote, SPRING_OPEN_MS, springDirFor, treeDropPaths } from './files-drop-model.ts';

// M9 fix 953: a drop from Explorer on the Files rail.

test('dropDirFor lands in a folder row, a file row its folder, and the root for nothing', () => {
  assert.equal(dropDirFor({ path: 'C:\\w\\src', kind: 'dir' }, 'C:\\w'), 'C:\\w\\src');
  assert.equal(dropDirFor({ path: 'C:\\w\\src\\a.ts', kind: 'file' }, 'C:\\w'), 'C:\\w\\src');
  assert.equal(dropDirFor({ path: 'C:\\a.txt', kind: 'file' }, 'C:\\w'), 'C:\\');
  assert.equal(dropDirFor(null, 'C:\\w'), 'C:\\w');
});

test('treeDropPaths drops a path already in the folder and the folder itself, case-insensitively, and keeps the rest (M9 fix 981)', () => {
  assert.deepEqual(treeDropPaths(['C:\\w\\a.txt'], 'c:/w'), []);
  assert.deepEqual(treeDropPaths(['C:\\w\\src'], 'C:\\w\\src'), []);
  assert.deepEqual(treeDropPaths(['C:\\w\\a.txt', 'C:\\w\\src\\b.txt'], 'C:\\w\\src'), ['C:\\w\\a.txt']);
  assert.deepEqual(treeDropPaths(['C:\\w\\src\\b.txt'], 'C:\\w\\lib'), ['C:\\w\\src\\b.txt']);
  // A folder into its own child stays, so main's refusal is the note.
  assert.deepEqual(treeDropPaths(['C:\\w\\src'], 'C:\\w\\src\\kid'), ['C:\\w\\src']);
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

test('springDirFor opens a closed folder row only', () => {
  assert.equal(SPRING_OPEN_MS, 600);
  assert.equal(springDirFor({ path: 'C:/r/a', kind: 'dir' }, new Set()), 'C:/r/a');
  assert.equal(springDirFor({ path: 'C:\\r/a', kind: 'dir' }, new Set([normalizePath('C:/r/a')])), null);
  assert.equal(springDirFor({ path: 'C:/r/a.txt', kind: 'file' }, new Set()), null);
  assert.equal(springDirFor(null, new Set()), null);
});

// M9 fix 1008: the corner note while a drop's copy runs.
test('copyingNote says how many files of the whole copy are in, by the locale, the word files whatever the count', () => {
  assert.equal(copyingNote(1204, 3000, 'into'), `Copying ${(1204).toLocaleString()} of ${(3000).toLocaleString()} files into into`);
  assert.equal(copyingNote(1, 1, 'x'), 'Copying 1 of 1 files into x');
});

test('copyingNote counts bytes when the files average over 50 MB, files otherwise, and byteSize prints one decimal from KB on (M9 fix 1123)', () => {
  assert.equal(byteSize(0), '0 bytes');
  assert.equal(byteSize(1023), '1023 bytes');
  assert.equal(byteSize(1024), '1.0 KB');
  assert.equal(byteSize(72 * 1024 * 1024), '72.0 MB');
  assert.equal(byteSize(Math.round(1.2 * 1024 ** 3)), '1.2 GB');
  assert.equal(copyingNote(1, 4, 'x', Math.round(1.2 * 1024 ** 3), Math.round(4.8 * 1024 ** 3)), 'Copying 1.2 GB of 4.8 GB into x');
  assert.equal(copyingNote(0, 2, 'x', 0, 2 * BYTE_NOTE_MIN_AVERAGE), 'Copying 0 of 2 files into x');
  assert.equal(copyingNote(3, 400, 'x', 3, 400), 'Copying 3 of 400 files into x');
});

test('moveNote says what landed, then what a Cancel left out (M9 fix 1124)', () => {
  const a: MoveOutcome = { from: 'C:\\s\\a', to: 'C:\\f\\a', result: 'copied' };
  const b: MoveOutcome = { from: 'C:\\s\\b', to: 'C:\\f\\b', result: 'refused', why: 'Cancelled', cancelled: true };
  const c: MoveOutcome = { from: 'C:\\s\\c', to: 'C:\\f\\c', result: 'skipped', cancelled: true };
  assert.equal(moveNote([a, b, c], 'f'), 'Copied a into f; cancelled, 2 not copied');
  assert.equal(moveNote([a, b], 'f'), 'Copied a into f; cancelled, b not copied');
  assert.equal(moveNote([b], 'f'), 'Cancelled: nothing copied into f');
});
