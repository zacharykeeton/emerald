import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultKind, emptyKey, folderRows, parentLabel, shellChoice, shellSub, startLabel } from './empty-pane-model.ts';

test('defaultKind: the split default wins, else the stored kind, else a shell (M9 fix 545)', () => {
  assert.equal(defaultKind('shell', 'claude'), 'shell');
  assert.equal(defaultKind('claude', null), 'claude');
  assert.equal(defaultKind('empty', 'claude'), 'claude');
  assert.equal(defaultKind('empty', null), 'shell');
});

test('folderRows: the split folder first, the recent list after it, each folder once (M9 fix 545)', () => {
  const recent = ['C:\\x', 'c:\\code\\emerald\\', 'C:\\y'];
  assert.deepEqual(folderRows({ split: 'C:\\code\\emerald', recent, home: 'C:\\Users\\Z', picked: null }), [
    { folder: 'C:\\code\\emerald', note: 'split from here' },
    { folder: 'C:\\x', note: null },
    { folder: 'C:\\y', note: null },
  ]);
  assert.deepEqual(folderRows({ split: null, recent, home: 'C:\\Users\\Z', picked: null })[0], { folder: 'C:\\x', note: 'last used' });
  assert.deepEqual(folderRows({ split: null, recent: [], home: 'C:\\Users\\Z', picked: null }), [{ folder: 'C:\\Users\\Z', note: null }]);
  assert.deepEqual(folderRows({ split: null, recent: [], home: null, picked: null }), []);
});

test('folderRows: a pick goes first and the default keeps its note in row 2 (M9 fix 545)', () => {
  const rows = folderRows({ split: 'C:\\code\\emerald', recent: ['C:\\x', 'C:\\picked'], home: null, picked: 'c:/picked' });
  assert.deepEqual(rows, [
    { folder: 'c:/picked', note: 'picked' },
    { folder: 'C:\\code\\emerald', note: 'split from here' },
    { folder: 'C:\\x', note: null },
  ]);
});

test('folderRows: ten recent folders give eight rows (M9 fix 545)', () => {
  const recent = Array.from({ length: 10 }, (_, i) => `C:\\f${i}`);
  const rows = folderRows({ split: null, recent, home: null, picked: null });
  assert.equal(rows.length, 8);
  assert.equal(rows[7]?.folder, 'C:\\f7');
});

test('parentLabel: the parent, home as ~, nothing for a drive root (M9 fix 545)', () => {
  assert.equal(parentLabel('C:\\Users\\Z\\code\\emerald', 'C:\\Users\\Z'), '~\\code');
  assert.equal(parentLabel('c:\\users\\z\\emerald', 'C:\\Users\\Z'), '~');
  assert.equal(parentLabel('D:\\work\\x', 'C:\\Users\\Z'), 'D:\\work');
  assert.equal(parentLabel('C:\\', 'C:\\Users\\Z'), '');
});

test('startLabel: the kind, then the folder by name (M9 fix 545)', () => {
  assert.deepEqual(startLabel('shell', 'C:\\code\\emerald'), { head: 'Start shell', tail: ' in emerald' });
  assert.deepEqual(startLabel('claude', 'C:\\code\\emerald'), { head: 'Start Claude', tail: ' in emerald' });
  assert.deepEqual(startLabel('shell', 'C:\\'), { head: 'Start shell', tail: ' in C:\\' });
});

test('emptyKey: Enter starts, Tab flips, a digit picks a row, arrows move (M9 fix 545)', () => {
  const k = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });
  assert.deepEqual(emptyKey(k('Enter'), 3), { act: 'start' });
  assert.deepEqual(emptyKey(k('Enter', { shiftKey: true }), 3), { act: 'swallow' });
  assert.deepEqual(emptyKey(k('Tab'), 3), { act: 'flip' });
  assert.deepEqual(emptyKey(k('Tab', { shiftKey: true }), 3), { act: 'flip' });
  assert.deepEqual(emptyKey(k('3'), 3), { act: 'row', index: 2 });
  assert.deepEqual(emptyKey(k('3'), 2), { act: 'swallow' });
  assert.equal(emptyKey(k('3', { ctrlKey: true }), 3), null);
  assert.deepEqual(emptyKey(k('ArrowDown'), 3), { act: 'move', delta: 1 });
  assert.equal(emptyKey(k('a'), 3), null);
});

// M9 fix 647: the Shell tile starts the picked shell, or the default.
const PS = { id: 'powershell', label: 'Windows PowerShell', file: 'powershell.exe' } as const;
const GB = { id: 'gitbash', label: 'Git Bash', file: 'bash.exe' } as const;
const CMD = { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe' } as const;

test('shellChoice: the stored shell when installed and not the default, else null', () => {
  assert.equal(shellChoice(null, [PS, GB, CMD]), null);
  assert.equal(shellChoice('cmd', [PS, GB, CMD]), CMD);
  assert.equal(shellChoice('gitbash', [PS, CMD]), null);
  assert.equal(shellChoice('powershell', [PS, CMD]), null);
  assert.equal(shellChoice('cmd', []), null);
});

test('startLabel names a picked shell for the shell kind alone', () => {
  assert.deepEqual(startLabel('shell', 'C:\\code\\emerald', CMD), { head: 'Start Command Prompt', tail: ' in emerald' });
  assert.deepEqual(startLabel('claude', 'C:\\code\\emerald', CMD), { head: 'Start Claude', tail: ' in emerald' });
});

test('shellSub: the default line with no pick, the swap with one', () => {
  assert.equal(shellSub(null, [PS, CMD]), 'your default shell, nothing else asked');
  assert.equal(shellSub(CMD, [PS, CMD]), 'Command Prompt in place of Windows PowerShell');
});
