import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout } from '@emerald/shared';
import { closeOldOffer, normalizeFolder, panesShowing, rememberFolder, replacedFate, splitArgs } from './new-session-model.ts';

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

test('closeOldOffer offers the box over a live Claude alone, unticked when it is busy, and panesShowing counts every tab (M9 fix 1131)', () => {
  const none = { offered: false, busy: false };
  assert.deepEqual(closeOldOffer({ kind: 'claude', state: 'idle' }, 1, true), { offered: true, busy: false });
  assert.deepEqual(closeOldOffer({ kind: 'claude', state: 'working' }, 1, true), { offered: true, busy: true });
  assert.deepEqual(closeOldOffer({ kind: 'claude', state: 'needs-input' }, 1, true), { offered: true, busy: true });
  assert.deepEqual(closeOldOffer({ kind: 'shell', state: 'idle' }, 1, true), none);
  assert.deepEqual(closeOldOffer({ kind: 'claude', state: 'exited' }, 1, true), none);
  assert.deepEqual(closeOldOffer(undefined, 0, true), none);
  assert.deepEqual(closeOldOffer({ kind: 'claude', state: 'idle' }, 2, true), none);
  assert.deepEqual(closeOldOffer({ kind: 'claude', state: 'idle' }, 1, false), none);
  const layout: Layout = {
    tabs: [
      { id: 't1', name: 'Panes', root: { kind: 'split', id: 's', direction: 'row', ratio: 0.5, first: { kind: 'pane', id: 'a', sessionId: 'x' }, second: { kind: 'pane', id: 'b', sessionId: null } }, focusedPaneId: 'a' },
      { id: 't2', name: 'Two', root: { kind: 'pane', id: 'c', sessionId: 'x' }, focusedPaneId: 'c' },
    ],
    currentTabId: 't1',
    revision: 1,
  } as Layout;
  assert.equal(panesShowing(layout, 'x'), 2);
  assert.equal(panesShowing(layout, 'y'), 0);
});

test('replacedFate keeps, closes or forgets the replaced session by the box and its state at Start (M9 fix 1146)', () => {
  assert.equal(replacedFate(true, { state: 'idle' }), 'retire');
  assert.equal(replacedFate(true, { state: 'working' }), 'retire');
  assert.equal(replacedFate(true, { state: 'exited' }), 'forget');
  assert.equal(replacedFate(false, { state: 'exited' }), 'keep');
  assert.equal(replacedFate(false, { state: 'idle' }), 'keep');
  assert.equal(replacedFate(true, undefined), 'keep');
});
