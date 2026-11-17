import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_MENU_SUGGESTIONS, guestMenuOf } from './guest-menu.ts';

// M9 fix 1178: what main reads off a page's right-click.

const flags = { canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false };
const params = { x: 12, y: 34, isEditable: true, editFlags: flags, linkURL: 'https://x/two', srcURL: 'https://x/a.png', mediaType: 'image' as const, misspelledWord: 'recieve', dictionarySuggestions: ['receive', 'relieve'] };

test('guestMenuOf (M9 fix 1178): every field read back', () => {
  assert.deepEqual(guestMenuOf(7, params, null), {
    webContentsId: 7,
    x: 12,
    y: 34,
    editable: true,
    canCut: true,
    canCopy: true,
    canPaste: true,
    canSelectAll: true,
    link: 'https://x/two',
    image: 'https://x/a.png',
    misspelled: 'recieve',
    suggestions: ['receive', 'relieve'],
  });
});

test('guestMenuOf (M9 fix 1178): no image address when the press was not on an image', () => {
  assert.equal(guestMenuOf(7, { ...params, mediaType: 'none' }, null).image, '');
});

test('guestMenuOf (M9 fix 1178): suggestions cut to the cap, and none without a misspelt word', () => {
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.equal(guestMenuOf(7, { ...params, dictionarySuggestions: seven }, null).suggestions.length, GUEST_MENU_SUGGESTIONS);
  assert.deepEqual(guestMenuOf(7, { ...params, misspelledWord: '' }, null).suggestions, []);
});

test('guestMenuOf (M9 fix 1178): under a held clipboard Paste follows the held text, in a field only', () => {
  assert.equal(guestMenuOf(7, params, { text: '' }).canPaste, false);
  assert.equal(guestMenuOf(7, params, { text: 'x' }).canPaste, true);
  assert.equal(guestMenuOf(7, { ...params, isEditable: false }, { text: 'x' }).canPaste, false);
});
