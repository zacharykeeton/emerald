import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFolder, rememberFolder, splitArgs } from './new-session-model.ts';

test('splitArgs splits on whitespace and drops empties', () => {
  assert.deepEqual(splitArgs(''), []);
  assert.deepEqual(splitArgs('   '), []);
  assert.deepEqual(splitArgs('--model opus'), ['--model', 'opus']);
  assert.deepEqual(splitArgs('  -p\t"hello"  '), ['-p', 'hello']);
});

test('splitArgs keeps quoted spaces and escaped quotes', () => {
  assert.deepEqual(splitArgs('--add-dir "C:\\My Docs" --verbose'), ['--add-dir', 'C:\\My Docs', '--verbose']);
  assert.deepEqual(splitArgs('-p "say \\"hi\\""'), ['-p', 'say "hi"']);
  // An empty quoted string is still an argument.
  assert.deepEqual(splitArgs('--name ""'), ['--name', '']);
  // An unterminated quote takes the rest of the line rather than failing.
  assert.deepEqual(splitArgs('-p "unterminated text'), ['-p', 'unterminated text']);
});

test('rememberFolder puts the newest first without duplicates and caps the list', () => {
  assert.deepEqual(rememberFolder([], 'C:\\a'), ['C:\\a']);
  assert.deepEqual(rememberFolder(['C:\\a', 'C:\\b'], 'C:\\b'), ['C:\\b', 'C:\\a']);
  // Same folder in another spelling replaces the old entry.
  assert.deepEqual(rememberFolder(['C:\\a', 'c:/A/'], 'C:\\A'), ['C:\\A']);
  const many = ['1', '2', '3', '4', '5', '6', '7', '8'];
  assert.deepEqual(rememberFolder(many, '9'), ['9', '1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(rememberFolder(many, '9', 3), ['9', '1', '2']);
});

test('normalizeFolder ignores case, slash style and trailing slashes', () => {
  assert.equal(normalizeFolder('C:/Users/Me/'), 'c:\\users\\me');
  assert.equal(normalizeFolder('  C:\\Users\\Me\\\\ '), 'c:\\users\\me');
});
