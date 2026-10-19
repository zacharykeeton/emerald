import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDINGS, CTRL_V, DEFAULT_PREFIX, KITTY_SHIFT_ENTER, LOOK_FIRST_ACTIONS, enterSequence, formatChord, isCopyKey, isModifierKey, isPasteKey, matchPlain, matchPrefixed, parseKeySpec, plainKeyFor } from './keys-model.ts';
import type { KeyLike } from './keys-model.ts';

const key = (code: string, mods: Partial<Omit<KeyLike, 'code'>> = {}): KeyLike => ({
  code,
  ctrlKey: mods.ctrlKey ?? false,
  shiftKey: mods.shiftKey ?? false,
  altKey: mods.altKey ?? false,
  metaKey: mods.metaKey ?? false,
});

test('parseKeySpec reads modifiers plus a key and rejects unusable specs', () => {
  assert.deepEqual(parseKeySpec(DEFAULT_PREFIX), { code: 'KeyB', ctrl: true, shift: false, alt: false, meta: false });
  assert.deepEqual(parseKeySpec(' ctrl + space '), { code: 'Space', ctrl: true, shift: false, alt: false, meta: false });
  assert.deepEqual(parseKeySpec('Alt+`'), { code: 'Backquote', ctrl: false, shift: false, alt: true, meta: false });
  assert.deepEqual(parseKeySpec('Ctrl+Shift+1'), { code: 'Digit1', ctrl: true, shift: true, alt: false, meta: false });
  assert.deepEqual(parseKeySpec('Ctrl+F12'), { code: 'F12', ctrl: true, shift: false, alt: false, meta: false });
  // No Ctrl, Alt or Meta would swallow typing; unknown modifiers and empty specs are out.
  assert.equal(parseKeySpec('B'), null);
  assert.equal(parseKeySpec('Shift+B'), null);
  assert.equal(parseKeySpec('Hyper+B'), null);
  assert.equal(parseKeySpec(''), null);
  assert.equal(parseKeySpec('Ctrl+'), null);
  assert.equal(parseKeySpec('Ctrl+not a key'), null);
});

test('formatChord round-trips the display form', () => {
  assert.equal(formatChord(parseKeySpec('Ctrl+B')!), 'Ctrl+B');
  assert.equal(formatChord(parseKeySpec('Ctrl+Shift+Alt+Space')!), 'Ctrl+Alt+Shift+Space');
  assert.equal(formatChord({ code: 'ArrowLeft', ctrl: false, shift: false, alt: true, meta: false }), 'Alt+Left');
  assert.equal(formatChord({ code: 'Slash', ctrl: true, shift: true, alt: false, meta: false }), 'Ctrl+Shift+?');
  assert.equal(formatChord({ code: 'Slash', ctrl: false, shift: false, alt: false, meta: false }), '/');
  assert.equal(formatChord({ code: 'BracketRight', ctrl: false, shift: false, alt: false, meta: false }), ']');
  assert.equal(formatChord({ code: 'BracketLeft', ctrl: false, shift: false, alt: false, meta: false }), '[');
});

test('plain chords: the M2 to M4 bindings still match, plus focus, cycle and the cheat sheet', () => {
  assert.equal(matchPlain(key('KeyE', { ctrlKey: true, shiftKey: true })), 'split-vertical');
  assert.equal(matchPlain(key('KeyO', { ctrlKey: true, shiftKey: true })), 'split-horizontal');
  assert.equal(matchPlain(key('KeyW', { ctrlKey: true, shiftKey: true })), 'close-pane');
  assert.equal(matchPlain(key('KeyS', { ctrlKey: true, shiftKey: true })), 'pick-session');
  assert.equal(matchPlain(key('KeyN', { ctrlKey: true, shiftKey: true })), 'new-session');
  assert.equal(matchPlain(key('KeyB', { ctrlKey: true, shiftKey: true })), 'toggle-sidebar');
  assert.equal(matchPlain(key('ArrowLeft', { altKey: true })), 'focus-left');
  assert.equal(matchPlain(key('ArrowDown', { altKey: true })), 'focus-down');
  assert.equal(matchPlain(key('KeyZ', { ctrlKey: true, shiftKey: true })), 'toggle-focus');
  assert.equal(matchPlain(key('Tab', { ctrlKey: true })), 'focus-next');
  assert.equal(matchPlain(key('Tab', { ctrlKey: true, shiftKey: true })), 'focus-prev');
  assert.equal(matchPlain(key('Slash', { ctrlKey: true, shiftKey: true })), 'cheat-sheet');
  assert.equal(matchPlain(key('KeyH', { ctrlKey: true, shiftKey: true })), 'find');
  // M9 fix 364: the file chooser, plain, not only after the prefix.
  assert.equal(matchPlain(key('KeyG', { ctrlKey: true, shiftKey: true })), 'open-file');
  // M9 fix 674: Design Mode.
  assert.equal(matchPlain(key('KeyD', { ctrlKey: true, shiftKey: true })), 'design-mode');
  // M9 fix 689: a Claude pane's chat view or its terminal.
  assert.equal(matchPlain(key('KeyM', { ctrlKey: true, shiftKey: true })), 'toggle-chat');
  assert.equal(matchPlain(key('KeyF', { ctrlKey: true })), null, "Ctrl+F is the shell's");
  // Plain letters, Ctrl+letter and the default prefix itself are not chords.
  assert.equal(matchPlain(key('KeyE')), null);
  assert.equal(matchPlain(key('KeyE', { ctrlKey: true })), null);
  assert.equal(matchPlain(key('KeyB', { ctrlKey: true })), null);
  assert.equal(matchPlain(key('KeyE', { ctrlKey: true, shiftKey: true, metaKey: true })), null);
});

test('after the prefix the same letters work without modifiers', () => {
  assert.equal(matchPrefixed(key('KeyE')), 'split-vertical');
  assert.equal(matchPrefixed(key('KeyO')), 'split-horizontal');
  assert.equal(matchPrefixed(key('KeyW')), 'close-pane');
  assert.equal(matchPrefixed(key('KeyZ')), 'toggle-focus');
  assert.equal(matchPrefixed(key('ArrowRight')), 'focus-right');
  assert.equal(matchPrefixed(key('Tab')), 'focus-next');
  assert.equal(matchPrefixed(key('Tab', { shiftKey: true })), 'focus-prev');
  assert.equal(matchPrefixed(key('Slash', { shiftKey: true })), 'cheat-sheet');
  assert.equal(matchPrefixed(key('Slash')), 'find');
  assert.equal(matchPrefixed(key('KeyB')), 'toggle-sidebar');
  assert.equal(matchPrefixed(key('KeyD')), 'design-mode');
  assert.equal(matchPrefixed(key('KeyM')), 'toggle-chat');
  assert.equal(matchPrefixed(key('KeyE', { ctrlKey: true })), null, 'modifiers after the prefix mean something else');
  assert.equal(matchPrefixed(key('KeyQ')), null);
});

test('every action has a prefixed key and the table has no duplicate chords', () => {
  const seenPlain = new Set<string>();
  const seenPrefixed = new Set<string>();
  // The one action with no chord (M9 fix 227): the release notes open
  // themselves and are reopened from the palette or the cheat sheet.
  const chordless = new Set(['whats-new']);
  for (const b of BINDINGS) {
    if (chordless.has(b.action)) {
      assert.ok(b.prefixed === null && b.plain === null, `${b.action} is listed as chordless`);
      continue;
    }
    assert.ok(b.prefixed !== null, `${b.action} needs a prefixed key`);
    const p = JSON.stringify(b.prefixed);
    assert.ok(!seenPrefixed.has(p), `duplicate prefixed chord for ${b.action}`);
    seenPrefixed.add(p);
    if (b.plain !== null) {
      const q = JSON.stringify(b.plain);
      assert.ok(!seenPlain.has(q), `duplicate plain chord for ${b.action}`);
      seenPlain.add(q);
    }
    if (b.alias !== undefined) {
      const q = JSON.stringify(b.alias);
      assert.ok(!seenPlain.has(q), `duplicate plain chord (alias) for ${b.action}`);
      seenPlain.add(q);
    }
  }
});

test('Ctrl+= and Ctrl+- zoom the window, with the Shift forms as aliases, and the text size keeps the prefix (M9 fix 900)', () => {
  assert.equal(matchPlain(key('Equal', { ctrlKey: true })), 'window-zoom-in');
  assert.equal(matchPlain(key('Equal', { ctrlKey: true, shiftKey: true })), 'window-zoom-in');
  assert.equal(matchPlain(key('Minus', { ctrlKey: true })), 'window-zoom-out');
  assert.equal(matchPlain(key('Minus', { ctrlKey: true, shiftKey: true })), 'window-zoom-out');
  assert.equal(matchPlain(key('Digit0', { ctrlKey: true })), 'window-zoom-reset');
  assert.equal(matchPlain(key('Digit0', { ctrlKey: true, shiftKey: true })), null, 'Windows may hold Ctrl+Shift+0');
  assert.equal(matchPrefixed(key('Equal')), 'text-bigger');
  assert.equal(matchPrefixed(key('Equal', { shiftKey: true })), 'window-zoom-in');
  assert.equal(plainKeyFor('text-bigger'), '');
  assert.equal(plainKeyFor('text-smaller'), '');
  assert.equal(plainKeyFor('text-reset'), '');
  assert.equal(plainKeyFor('window-zoom-in'), 'Ctrl+=');
});

test('isModifierKey', () => {
  assert.equal(isModifierKey('ShiftLeft'), true);
  assert.equal(isModifierKey('ControlRight'), true);
  assert.equal(isModifierKey('AltLeft'), true);
  assert.equal(isModifierKey('MetaLeft'), true);
  assert.equal(isModifierKey('KeyB'), false);
  assert.equal(isModifierKey('Tab'), false);
});

test('enterSequence sends the kitty Shift+Enter only to Claude, only on keydown', () => {
  const down = (mods: Partial<Omit<KeyLike, 'code'>> = {}, code = 'Enter', type = 'keydown') => ({ ...key(code, mods), type });
  assert.equal(enterSequence(down({ shiftKey: true }), 'claude'), KITTY_SHIFT_ENTER);
  assert.equal(KITTY_SHIFT_ENTER, '\x1b[13;2u');
  // A shell keeps xterm's CR; keyup and keypress of the same key are not sent twice.
  assert.equal(enterSequence(down({ shiftKey: true }), 'shell'), null);
  assert.equal(enterSequence(down({ shiftKey: true }, 'Enter', 'keyup'), 'claude'), null);
  assert.equal(enterSequence(down({ shiftKey: true }, 'Enter', 'keypress'), 'claude'), null);
  // Plain Enter submits; Ctrl+Enter and Alt+Enter are left alone; other keys with Shift are typing.
  assert.equal(enterSequence(down(), 'claude'), null);
  assert.equal(enterSequence(down({ ctrlKey: true }), 'claude'), null);
  assert.equal(enterSequence(down({ shiftKey: true, ctrlKey: true }), 'claude'), null);
  assert.equal(enterSequence(down({ altKey: true }), 'claude'), null);
  assert.equal(enterSequence(down({ shiftKey: true }, 'NumpadEnter'), 'claude'), null);
  assert.equal(enterSequence(down({ shiftKey: true }, 'KeyA'), 'claude'), null);
});

test('isPasteKey is Ctrl+V alone (M9 fix 92); Ctrl+Shift+V and the Alt and Meta chords stay xterm keys', () => {
  assert.equal(isPasteKey(key('KeyV', { ctrlKey: true })), true);
  assert.equal(isPasteKey(key('KeyV', { ctrlKey: true, shiftKey: true })), false);
  assert.equal(isPasteKey(key('KeyV', { ctrlKey: true, altKey: true })), false);
  assert.equal(isPasteKey(key('KeyV', { ctrlKey: true, metaKey: true })), false);
  assert.equal(isPasteKey(key('KeyV')), false);
  assert.equal(isPasteKey(key('KeyC', { ctrlKey: true })), false);
  assert.equal(CTRL_V, '\x16');
});

test('isPasteKey takes a Ctrl+V with no code, as a dictation tool sends it (M9 fix 637); a physical key still goes by code', () => {
  assert.equal(isPasteKey({ ...key('', { ctrlKey: true }), key: 'v' }), true);
  assert.equal(isPasteKey({ ...key('', { ctrlKey: true }), key: 'V' }), true);
  assert.equal(isPasteKey({ ...key('', { ctrlKey: true }), key: 'Unidentified', keyCode: 86 }), true);
  assert.equal(isPasteKey({ ...key(''), key: 'v' }), false);
  assert.equal(isPasteKey({ ...key('', { ctrlKey: true, shiftKey: true }), key: 'V' }), false);
  assert.equal(isPasteKey({ ...key('', { ctrlKey: true, altKey: true }), key: 'v' }), false);
  assert.equal(isPasteKey({ ...key('', { ctrlKey: true }), key: 'c', keyCode: 67 }), false);
  assert.equal(isPasteKey({ ...key('Period', { ctrlKey: true }), key: 'v', keyCode: 86 }), false);
});

test("isCopyKey is Ctrl+Shift+C alone (M9 fix 441); Ctrl+C stays the program's ^C and the prefix chord is untouched", () => {
  assert.equal(isCopyKey(key('KeyC', { ctrlKey: true, shiftKey: true })), true);
  assert.equal(isCopyKey(key('KeyC', { ctrlKey: true })), false);
  assert.equal(isCopyKey(key('KeyC', { ctrlKey: true, shiftKey: true, altKey: true })), false);
  assert.equal(isCopyKey(key('KeyC', { ctrlKey: true, shiftKey: true, metaKey: true })), false);
  assert.equal(isCopyKey(key('KeyC')), false);
  assert.equal(isCopyKey(key('KeyV', { ctrlKey: true, shiftKey: true })), false);
  assert.equal(matchPrefixed(key('KeyC')), 'new-layout-tab');
});

test('the shade chords: Ctrl+Shift+U and U after the prefix for Shade or lift all, Ctrl+Shift+K and K for the pane (M9 fix 844)', () => {
  const cs = (code: string) => key(code, { ctrlKey: true, shiftKey: true });
  assert.equal(matchPlain(cs('KeyU')), 'shade-all');
  assert.equal(matchPlain(cs('KeyK')), 'shade-pane');
  assert.equal(matchPrefixed(key('KeyU')), 'shade-all');
  assert.equal(matchPrefixed(key('KeyK')), 'shade-pane');
  for (const code of ['KeyU', 'KeyK']) {
    assert.equal(isCopyKey(cs(code)), false);
    assert.equal(isPasteKey(cs(code)), false);
  }
  assert.equal(matchPlain(key('KeyU', { ctrlKey: true })), null, "Ctrl+U alone stays the shell's ^U");
  assert.equal(plainKeyFor('shade-all'), 'Ctrl+Shift+U');
  assert.equal(plainKeyFor('shade-pane'), 'Ctrl+Shift+K');
});

test('the look-first actions: the tab keys, the jump to the waiting session and the shade chords (M9 fixes 189, 201 and 873)', () => {
  assert.deepEqual([...LOOK_FIRST_ACTIONS].sort(), ['jump-waiting', 'next-layout-tab', 'next-tab', 'prev-layout-tab', 'prev-tab', 'shade-all', 'shade-pane']);
});
