import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchArgument, launchLabel } from './launch-argument.ts';

// M9 fix 853: a stat fake with two folders and one file; anything else is
// not there.
const dir = { isFile: () => false, isDirectory: () => true };
const file = { isFile: () => true, isDirectory: () => false };
function stat(p: string) {
  if (p === 'C:\\work' || p === 'C:\\') return dir;
  if (p === 'C:\\work\\a.md') return file;
  return null;
}

test('a file on the command line is a file launch, as fix 342 had it', () => {
  assert.deepEqual(launchArgument(['Emerald.exe', 'C:\\work\\a.md'], true, stat), { path: 'C:\\work\\a.md', kind: 'file' });
});

test('a folder after --open-claude or --open-shell opens with that kind (M9 fix 853)', () => {
  assert.deepEqual(launchArgument(['Emerald.exe', '--open-claude', 'C:\\work'], true, stat), { path: 'C:\\work', kind: 'claude' });
  assert.deepEqual(launchArgument(['Emerald.exe', '--open-shell', 'C:\\work'], true, stat), { path: 'C:\\work', kind: 'shell' });
});

test('a bare folder, or a file with a folder flag, is a plain launch (M9 fix 853)', () => {
  assert.equal(launchArgument(['Emerald.exe', 'C:\\work'], true, stat), null);
  assert.equal(launchArgument(['Emerald.exe', '--open-shell', 'C:\\work\\a.md'], true, stat), null);
});

test('a quoted path ending in a backslash reads its eaten quote back as the backslash (M9 fix 853)', () => {
  // Explorer's "%V" for a drive root is "C:\", which argv hands over as C:"
  assert.deepEqual(launchArgument(['Emerald.exe', '--open-shell', 'C:"'], true, stat), { path: 'C:\\', kind: 'shell' });
  assert.deepEqual(launchArgument(['Emerald.exe', '--open-shell', 'C:\\work"'], true, stat), { path: 'C:\\work', kind: 'shell' });
});

test('a missing path, or switches alone, is no launch argument', () => {
  assert.equal(launchArgument(['Emerald.exe', '--open-shell', 'C:\\gone'], true, stat), null);
  assert.equal(launchArgument(['Emerald.exe', '--updated', '--force-run'], true, stat), null);
});

test('the dev build skips its own main.js', () => {
  assert.deepEqual(launchArgument(['electron.exe', '--user-data-dir=x', 'C:\\repo\\out\\main\\index.js', '--open-shell', 'C:\\work'], false, stat), { path: 'C:\\work', kind: 'shell' });
});

test('launchLabel names a file by its path and a folder with its kind', () => {
  assert.equal(launchLabel({ path: 'C:\\work\\a.md', kind: 'file' }), 'C:\\work\\a.md');
  assert.equal(launchLabel({ path: 'C:\\work', kind: 'shell' }), 'C:\\work (shell)');
  assert.equal(launchLabel({ path: 'C:\\work', kind: 'claude' }), 'C:\\work (claude)');
});
