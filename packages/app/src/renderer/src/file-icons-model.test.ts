import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { iconFor } from './file-icons-model.ts';
import type { IconMap } from './file-icons-model.ts';

// The theme's own map, as the renderer imports it, so a rename in the
// set shows here before it shows as a broken icon.
const map = createRequire(import.meta.url)('material-icon-theme/dist/material-icons.json') as IconMap;

test('iconFor: a file by its name beats its extension', () => {
  assert.equal(iconFor(map, 'package.json', 'file'), 'nodejs');
  assert.equal(iconFor(map, 'README.md', 'file'), 'readme', 'cased the way Windows shows it');
  assert.equal(iconFor(map, 'notes.md', 'file'), 'markdown');
});

test('iconFor: the longest dotted suffix wins, then the plain file', () => {
  assert.equal(iconFor(map, 'api.d.ts', 'file'), 'typescript-def');
  assert.equal(iconFor(map, 'api.ts', 'file'), 'typescript');
  assert.equal(iconFor(map, 'App.tsx', 'file'), 'react_ts');
  assert.equal(iconFor(map, 'thing.emerald', 'file'), 'file', 'an unknown extension');
  assert.equal(iconFor(map, 'Makefile.bak.zzz', 'file'), 'file', 'no suffix known');
  assert.equal(iconFor(map, 'noext', 'file'), 'file');
});

test('iconFor: a folder by its name, open and closed, else the plain folder', () => {
  assert.equal(iconFor(map, 'src', 'dir'), 'folder-src');
  assert.equal(iconFor(map, 'src', 'dir', true), 'folder-src-open');
  assert.equal(iconFor(map, 'emerald-wt', 'dir'), 'folder');
  assert.equal(iconFor(map, 'emerald-wt', 'dir', true), 'folder-open');
});
