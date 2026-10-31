import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { findNode } from './node-runner.ts';

// The dev build's node (M9 fix 1025): node.exe on Windows, node elsewhere,
// the first PATH entry that holds it.
test('findNode looks for node off Windows and node.exe on it', () => {
  const pathVar = ['/x', '/y'].join(path.delimiter);
  assert.equal(findNode(pathVar, 'darwin', (p) => p === path.join('/y', 'node')), path.join('/y', 'node'));
  assert.equal(findNode(pathVar, 'darwin', (p) => p === path.join('/y', 'node.exe')), null);
  assert.equal(findNode(pathVar, 'win32', (p) => p === path.join('/x', 'node.exe')), path.join('/x', 'node.exe'));
  assert.equal(findNode(pathVar, 'linux', () => false), null);
  assert.equal(findNode('', 'linux', () => true), null, 'an empty PATH has nothing to find');
});
