import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deletedSchemes, FILE_SCHEMES_CAP, fileSchemeOf, getFileScheme, parseFileSchemes, renamedSchemes, setFileScheme, withFileScheme } from './file-scheme-store.ts';

// M9 fix 340: a file's own colour scheme, by path, capped.
test('a pick is set, read by any spelling of the path, and cleared', () => {
  let list = withFileScheme([], 'C:/repo/notes.md', 'Dracula');
  assert.deepEqual(list, [['C:\\repo\\notes.md', 'Dracula']]);
  assert.equal(fileSchemeOf(list, 'c:\\REPO\\notes.md'), 'Dracula');
  assert.equal(fileSchemeOf(list, 'C:/repo/other.md'), null);
  list = withFileScheme(list, 'C:\\repo\\notes.md', 'One Dark');
  assert.deepEqual(list, [['C:\\repo\\notes.md', 'One Dark']], 'a second pick replaces the first');
  const cleared = withFileScheme(list, 'c:/repo/notes.md', null);
  assert.deepEqual(cleared, []);
  assert.equal(withFileScheme(cleared, 'C:/repo/notes.md', null), cleared, 'clearing a file with no pick is no change');
});

test('the list keeps the newest picks up to the cap, a repeat moving to the newest end', () => {
  let list: ReturnType<typeof withFileScheme> = [];
  for (let i = 0; i < FILE_SCHEMES_CAP; i++) list = withFileScheme(list, `C:/repo/f${i}.txt`, 'emerald');
  assert.equal(list.length, FILE_SCHEMES_CAP);
  list = withFileScheme(list, 'C:/repo/f0.txt', 'Dracula');
  assert.equal(list.length, FILE_SCHEMES_CAP, 'a repeat does not grow the list');
  assert.deepEqual(list[list.length - 1], ['C:\\repo\\f0.txt', 'Dracula'], 'and sits at the newest end');
  list = withFileScheme(list, 'C:/repo/one-more.txt', 'emerald');
  assert.equal(list.length, FILE_SCHEMES_CAP);
  assert.equal(fileSchemeOf(list, 'C:/repo/f1.txt'), null, 'the oldest pick went');
  assert.equal(fileSchemeOf(list, 'C:/repo/f0.txt'), 'Dracula', 'the repeated one stayed');
  assert.equal(withFileScheme([], 'C:/a', 'x', 1).length, 1);
  assert.deepEqual(withFileScheme(withFileScheme([], 'C:/a', 'x', 1), 'C:/b', 'y', 1), [['C:\\b', 'y']]);
});

test('the stored form parses back and a malformed one reads as nothing', () => {
  const list = withFileScheme(withFileScheme([], 'C:/repo/a.md', 'Dracula'), 'C:/repo/b.json', 'One Dark');
  assert.deepEqual(parseFileSchemes(JSON.stringify(list)), list);
  assert.deepEqual(parseFileSchemes(null), []);
  assert.deepEqual(parseFileSchemes(''), []);
  assert.deepEqual(parseFileSchemes('{'), []);
  assert.deepEqual(parseFileSchemes('{"a":1}'), []);
  assert.deepEqual(parseFileSchemes('[["C:\\\\x","Dracula"],["bad"],[1,2],["","x"]]'), [['C:\\x', 'Dracula']]);
});

test('the store sets, reads and clears a pick without storage', () => {
  assert.equal(getFileScheme('C:/repo/store.md'), null);
  setFileScheme('C:/repo/store.md', 'Tokyo Night');
  assert.equal(getFileScheme('c:\\repo\\store.md'), 'Tokyo Night');
  setFileScheme('C:/repo/store.md', null);
  assert.equal(getFileScheme('C:/repo/store.md'), null);
});

// M9 fix 574: a pick follows the rail's rename.
test('renamedSchemes follows a renamed file and every file under a renamed folder', () => {
  const list = [['C:\\r\\a.md', 'Dracula'], ['C:\\r\\d\\b.md', 'Nord'], ['C:\\r\\c.md', 'Gruvbox']] as const;
  assert.deepEqual(renamedSchemes(list, 'C:\\r\\a.md', 'C:\\r\\z.md'), [['C:\\r\\z.md', 'Dracula'], list[1], list[2]]);
  assert.deepEqual(renamedSchemes(list, 'C:\\r\\D', 'C:\\r\\e'), [list[0], ['C:\\r\\e\\b.md', 'Nord'], list[2]]);
  assert.equal(renamedSchemes(list, 'C:\\other', 'C:\\x'), list);
});

// M9 fix 617: a pick goes with the rail's delete.
test('deletedSchemes drops a pick on a deleted file and every pick under a deleted folder, case-insensitively', () => {
  const list = [['C:\\r\\a.md', 'Dracula'], ['C:\\r\\d\\b.md', 'Nord'], ['C:\\r\\c.md', 'Gruvbox']] as const;
  assert.deepEqual(deletedSchemes(list, 'C:\\r\\A.md'), [list[1], list[2]]);
  assert.deepEqual(deletedSchemes(list, 'C:\\R\\D'), [list[0], list[2]]);
  assert.equal(deletedSchemes(list, 'C:\\other'), list);
});
