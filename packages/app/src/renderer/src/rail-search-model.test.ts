import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeUnder, searchSettingsFromJson } from './rail-search-model.ts';

test('searchSettingsFromJson: the stored shape, and the default for anything else', () => {
  assert.deepEqual(searchSettingsFromJson({ mode: 'contents', scope: 'C:/work/src/' }), { mode: 'contents', scope: 'C:\\work\\src' });
  assert.deepEqual(searchSettingsFromJson({ mode: 'names', scope: null }), { mode: 'names', scope: null });
  assert.deepEqual(searchSettingsFromJson({ mode: 'lines', scope: 7 }), { mode: 'names', scope: null }, 'unknown values fall back');
  assert.deepEqual(searchSettingsFromJson(null), { mode: 'names', scope: null });
  assert.deepEqual(searchSettingsFromJson('contents'), { mode: 'names', scope: null });
});

test('scopeUnder: kept under the root, dropped elsewhere, kept while there is no root', () => {
  assert.equal(scopeUnder('C:\\work\\src', 'C:\\work'), 'C:\\work\\src');
  assert.equal(scopeUnder('C:\\work\\src\\deep', 'c:/WORK/'), 'C:\\work\\src\\deep', 'case and slashes do not matter');
  assert.equal(scopeUnder('C:\\work\\src', 'C:\\work\\src'), null, 'the root itself is not a scope');
  assert.equal(scopeUnder('C:\\work\\src', 'C:\\other'), null);
  assert.equal(scopeUnder('C:\\worktree\\src', 'C:\\work'), null, 'a sibling that shares the prefix is not under it');
  assert.equal(scopeUnder('C:\\work\\src', null), 'C:\\work\\src');
  assert.equal(scopeUnder(null, 'C:\\work'), null);
});
