import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragOutFiles, FOLDER_REFUSED_NOTE, refusalNote, SET_REFUSED_NOTE, setCopy, treeRefusal } from './files-set-model.ts';

test('dragOutFiles takes the tree\'s paths, else the one file, else nothing (M9 fix 1122)', () => {
  assert.deepEqual(dragOutFiles(null, ['C:\\r\\d']), ['C:\\r\\d']);
  assert.deepEqual(dragOutFiles('C:\\r\\a', []), ['C:\\r\\a']);
  assert.deepEqual(dragOutFiles('C:\\r\\a', ['C:\\r\\a', 'C:\\r\\b']), ['C:\\r\\a', 'C:\\r\\b']);
  assert.equal(dragOutFiles(null, []), null);
});

// M9 fix 1006: a set or a folder dragged onto a pane says it cannot land.

test('treeRefusal names a set and a lone folder and stays silent for a lone file', () => {
  assert.equal(treeRefusal(3, 'file'), 'set');
  assert.equal(treeRefusal(2, 'dir'), 'set');
  assert.equal(treeRefusal(1, 'dir'), 'folder');
  assert.equal(treeRefusal(1, 'file'), null);
  assert.equal(treeRefusal(1, undefined), null);
});

test('refusalNote carries the exact words of each refusal', () => {
  assert.equal(refusalNote('set'), SET_REFUSED_NOTE);
  assert.equal(refusalNote('folder'), FOLDER_REFUSED_NOTE);
  assert.equal(SET_REFUSED_NOTE, 'A pane takes one file at a time; drop the set on a folder');
  assert.equal(FOLDER_REFUSED_NOTE, 'A folder opens in no pane; drop it on a folder in the tree');
});

test('setCopy joins the paths one per line, whole or relative to the root', () => {
  const paths = ['C:\\r\\a\\x.txt', 'C:\\r\\b'];
  assert.deepEqual(setCopy(paths, 'C:\\r', false), {
    label: 'Copy 2 paths',
    title: 'The 2 picked paths, one per line',
    text: 'C:\\r\\a\\x.txt\nC:\\r\\b',
  });
  assert.deepEqual(setCopy(paths, 'C:\\r', true), {
    label: 'Copy 2 relative paths',
    title: "The 2 picked paths relative to the tree's root, one per line",
    text: 'a\\x.txt\nb',
  });
});
