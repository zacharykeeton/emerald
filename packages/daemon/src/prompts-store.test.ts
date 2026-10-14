import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { PromptsStore } from './prompts-store.ts';
import { silentLogger } from './log.ts';

function tempFile(): string {
  const dir = mkTemp('emerald-prompts-');
  // A nested directory proves persist() creates parents.
  return path.join(dir, 'nested', 'prompts.json');
}

test.after(removeTemps);

test('starts empty without a file, and a set writes the file another store reads back sorted', () => {
  const file = tempFile();
  const store = new PromptsStore(file, silentLogger);
  store.load();
  assert.deepEqual(store.list(), []);
  assert.equal(store.set('tests', 'run the tests and fix what fails'), true);
  assert.equal(store.set('commit', 'commit what is staged'), true);
  const again = new PromptsStore(file, silentLogger);
  again.load();
  assert.deepEqual(again.list(), [
    { name: 'commit', text: 'commit what is staged' },
    { name: 'tests', text: 'run the tests and fix what fails' },
  ]);
  assert.deepEqual(again.get('tests'), { name: 'tests', text: 'run the tests and fix what fails' });
  assert.equal(again.get('nope'), null);
});

test('a name already taken is replaced, the same text again changes nothing, and null removes', () => {
  const store = new PromptsStore(tempFile(), silentLogger);
  store.load();
  store.set('tests', 'one');
  assert.equal(store.set('tests', 'one'), false);
  assert.equal(store.set('tests', 'two'), true);
  assert.deepEqual(store.list(), [{ name: 'tests', text: 'two' }]);
  assert.equal(store.set('tests', null), true);
  assert.equal(store.set('tests', null), false);
  assert.deepEqual(store.list(), []);
});

test('a bad name or an empty text is refused as a bad request', () => {
  const store = new PromptsStore(tempFile(), silentLogger);
  store.load();
  assert.throws(() => store.set('', 'x'), /name must be/);
  assert.throws(() => store.set(' padded', 'x'), /name must be/);
  assert.throws(() => store.set('two\nlines', 'x'), /name must be/);
  assert.throws(() => store.set('a'.repeat(65), 'x'), /name must be/);
  assert.throws(() => store.set('ok', ''), /text must not be empty/);
  // A text past 64 KB is refused, one at the bound kept (M9 fix 511).
  assert.throws(() => store.set('ok', 'x'.repeat(65_537)), /text must be at most 65536 characters/);
  assert.deepEqual(store.list(), []);
  assert.equal(store.set('ok', 'x'.repeat(65_536)), true);
  store.set('ok', null);
  assert.deepEqual(store.list(), []);
});

test('a file that is not a list, or has an entry that is not a prompt, keeps what it can', () => {
  const file = tempFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"not": "a list"}');
  const store = new PromptsStore(file, silentLogger);
  store.load();
  assert.deepEqual(store.list(), []);
  // Set aside whole (M9 fix 457), so the next save does not overwrite it.
  const aside = fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith('prompts.json.bad-'));
  assert.equal(aside.length, 1);
  store.set('new', 'one');
  assert.equal(fs.readFileSync(path.join(path.dirname(file), aside[0]!), 'utf8'), '{"not": "a list"}', 'the save leaves it be');
  fs.writeFileSync(file, JSON.stringify([{ name: 'good', text: 'kept' }, { name: '', text: 'dropped' }, 'junk']));
  const again = new PromptsStore(file, silentLogger);
  again.load();
  assert.deepEqual(again.list(), [{ name: 'good', text: 'kept' }]);
});
