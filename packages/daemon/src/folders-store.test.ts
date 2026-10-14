import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { FoldersStore } from './folders-store.ts';
import { silentLogger } from './log.ts';

function tempFile(): string {
  const dir = mkTemp('emerald-folders-');
  // A nested directory proves persist() creates parents.
  return path.join(dir, 'nested', 'folders.json');
}

test.after(removeTemps);

// A real folder, so realFolder has something to resolve; its long form
// is what the store keys on.
function realDir(): string {
  return fs.realpathSync.native(mkTemp('emerald-folders-dir-'));
}

test('starts empty without a file, and a set writes the file another store reads back, surviving a restart', () => {
  const file = tempFile();
  const a = realDir();
  const b = realDir();
  const store = new FoldersStore(file, silentLogger);
  store.load();
  assert.deepEqual(store.list(), []);
  assert.equal(store.set(a, 'Work'), true);
  assert.equal(store.set(b, 'Play'), true);
  const again = new FoldersStore(file, silentLogger);
  again.load();
  assert.deepEqual(
    again.list(),
    [
      { folder: a, label: 'Work' },
      { folder: b, label: 'Play' },
    ].sort((x, y) => x.folder.localeCompare(y.folder)),
  );
  assert.equal(again.get(a), 'Work');
  assert.equal(again.get(path.join(a, '..', path.basename(a))), 'Work');
  assert.equal(again.get('C:\\nowhere\\at\\all'), null);
});

test('a folder already labelled is relabelled, the same label again changes nothing, and null removes the entry', () => {
  const file = tempFile();
  const a = realDir();
  const store = new FoldersStore(file, silentLogger);
  store.load();
  const changes: number[] = [];
  store.on('changed', (list: unknown[]) => changes.push(list.length));
  store.set(a, 'one');
  assert.equal(store.set(a, 'one'), false);
  assert.equal(store.set(a, 'two'), true);
  assert.deepEqual(store.list(), [{ folder: a, label: 'two' }]);
  assert.equal(store.set(a, null), true);
  assert.equal(store.set(a, null), false);
  assert.deepEqual(store.list(), []);
  // The file holds no entry once removed.
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
  assert.deepEqual(changes, [1, 1, 0]);
});

test('a label is one short trimmed line, and a bad file entry is dropped', () => {
  const file = tempFile();
  const a = realDir();
  const store = new FoldersStore(file, silentLogger);
  store.load();
  assert.throws(() => store.set(a, ''), /one short line/);
  assert.throws(() => store.set(a, ' padded '), /one short line/);
  assert.throws(() => store.set(a, 'two\nlines'), /one short line/);
  assert.throws(() => store.set('', 'x'), /folder must be a path/);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify([{ folder: a, label: 'Kept' }, { folder: a }, 'junk', { folder: '', label: 'x' }]));
  const again = new FoldersStore(file, silentLogger);
  again.load();
  assert.deepEqual(again.list(), [{ folder: a, label: 'Kept' }]);
});

test('a file that is not JSON or not a list is set aside before the store starts empty (M9 fix 457)', () => {
  for (const contents of ['{not json', '{"not": "a list"}']) {
    const file = tempFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    const store = new FoldersStore(file, silentLogger);
    store.load();
    assert.deepEqual(store.list(), [], contents);
    const aside = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('folders.json.bad-'));
    assert.equal(aside.length, 1, contents);
    store.set(realDir(), 'New');
    assert.equal(fs.readFileSync(path.join(path.dirname(file), aside[0]!), 'utf8'), contents, `${contents}: the save leaves it be`);
  }
});
