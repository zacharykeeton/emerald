import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_MENU_SUGGESTIONS, guestMenuOf, guestMenuSteps, windowSpellOf } from './guest-menu.ts';
import type { GuestMenuAct } from '../preload/api.ts';

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

// M9 fix 1192: a picked row's steps take no clipboard, so the person's
// branch is the held one's. Copy link address is the write already read
// working on the person's clipboard; Copy now has its shape.
const menu1192 = { link: '', image: '', suggestions: ['receive', 'relieve'] };

test('guestMenuSteps (M9 fix 1192): Copy and Cut write the selection as Copy link address writes the link', () => {
  const kept = { selection: 'copy these words', menu: menu1192 };
  assert.deepEqual(guestMenuSteps('copy', kept, undefined), [{ kind: 'write', text: 'copy these words' }]);
  assert.deepEqual(guestMenuSteps('cut', kept, undefined), [{ kind: 'write', text: 'copy these words' }, { kind: 'delete' }]);
  assert.deepEqual(guestMenuSteps('copy', { ...kept, selection: '' }, undefined), []);
  assert.deepEqual(guestMenuSteps('cut', { ...kept, selection: '' }, undefined), []);
  const link = guestMenuSteps('copy-link', { selection: '', menu: { ...menu1192, link: 'https://x.test/' } }, undefined);
  assert.deepEqual(link, [{ kind: 'write', text: 'https://x.test/' }]);
  assert.deepEqual(guestMenuSteps('copy', kept, undefined).map((s) => s.kind), link.map((s) => s.kind));
});

test('guestMenuSteps (M9 fix 1192): Paste, a listed spelling pick only, no image address and an unknown act', () => {
  const kept = { selection: '', menu: menu1192 };
  assert.deepEqual(guestMenuSteps('paste', kept, undefined), [{ kind: 'paste' }]);
  assert.deepEqual(guestMenuSteps('select-all', kept, undefined), [{ kind: 'select-all' }]);
  assert.deepEqual(guestMenuSteps('spell', kept, 'receive'), [{ kind: 'spell', word: 'receive' }]);
  assert.deepEqual(guestMenuSteps('spell', kept, 'other'), []);
  assert.deepEqual(guestMenuSteps('spell', kept, undefined), []);
  assert.deepEqual(guestMenuSteps('copy-image', kept, undefined), []);
  assert.deepEqual(guestMenuSteps('reload' as GuestMenuAct, kept, undefined), []);
});

test('windowSpellOf (M9 fix 1193): the window\'s own misspelt word and its suggestions cut to the cap, none without one', () => {
  const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.deepEqual(windowSpellOf({ misspelledWord: 'recieve', dictionarySuggestions: seven }), { misspelled: 'recieve', suggestions: seven.slice(0, GUEST_MENU_SUGGESTIONS) });
  assert.deepEqual(windowSpellOf({ misspelledWord: '', dictionarySuggestions: seven }), { misspelled: '', suggestions: [] });
});
