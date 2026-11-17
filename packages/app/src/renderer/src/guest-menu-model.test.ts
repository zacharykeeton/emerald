import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuestMenu } from '../../preload/api.ts';
import { guestMenuRows } from './guest-menu-model.ts';

// M9 fix 1178: the rows of a browser pane's page menu.

const base: GuestMenu = { webContentsId: 1, x: 0, y: 0, editable: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false, link: '', image: '', misspelled: '', suggestions: [] };
const m = (patch: Partial<GuestMenu>): GuestMenu => ({ ...base, ...patch });

test('guestMenuRows (M9 fix 1178): a selection in a page is Copy and Select all', () => {
  assert.deepEqual(guestMenuRows(m({ canCopy: true, canSelectAll: true })), [
    { label: 'Copy', act: 'copy' },
    { label: 'Select all', act: 'select-all' },
  ]);
});

test('guestMenuRows (M9 fix 1178): a field with nothing selected disables Cut and Copy', () => {
  assert.deepEqual(guestMenuRows(m({ editable: true, canPaste: true, canSelectAll: true })), [
    { label: 'Cut', act: 'cut', disabled: true },
    { label: 'Copy', act: 'copy', disabled: true },
    { label: 'Paste', act: 'paste' },
    { label: 'Select all', act: 'select-all' },
  ]);
});

test('guestMenuRows (M9 fix 1178): a link with no selection adds its address under a rule', () => {
  assert.deepEqual(guestMenuRows(m({ canSelectAll: true, link: 'https://x/two' })), [
    { label: 'Select all', act: 'select-all' },
    { label: 'Copy link address', act: 'copy-link', separator: true },
  ]);
});

test('guestMenuRows (M9 fix 1178): an image inside a link gives both address rows', () => {
  assert.deepEqual(guestMenuRows(m({ link: 'https://x/two', image: 'https://x/a.png' })), [
    { label: 'Copy link address', act: 'copy-link' },
    { label: 'Copy image address', act: 'copy-image', separator: true },
  ]);
});

test('guestMenuRows (M9 fix 1178): a misspelt word in a field lists its suggestions above Cut', () => {
  assert.deepEqual(guestMenuRows(m({ editable: true, canCopy: true, canCut: true, canPaste: true, canSelectAll: true, misspelled: 'recieve', suggestions: ['receive', 'relieve'] })), [
    { label: 'receive', act: 'spell', word: 'receive' },
    { label: 'relieve', act: 'spell', word: 'relieve' },
    { label: 'Cut', act: 'cut', separator: true },
    { label: 'Copy', act: 'copy' },
    { label: 'Paste', act: 'paste' },
    { label: 'Select all', act: 'select-all' },
  ]);
});

test('guestMenuRows (M9 fix 1178): a misspelt word with no suggestion is one disabled row', () => {
  assert.deepEqual(guestMenuRows(m({ misspelled: 'zzqx' })), [{ label: 'No suggestions', act: 'spell', disabled: true }]);
});

test('guestMenuRows (M9 fix 1178): nothing at all is an empty list', () => {
  assert.deepEqual(guestMenuRows(base), []);
});
