import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { envValue, findOnPath } from './launchers/find-on-path.ts';

test.after(removeTemps);

// A folder holding an empty tool.exe and tool.com: findOnPath only asks
// whether a candidate is a file.
function toolDir(): string {
  const dir = mkTemp('emerald-find-on-path-');
  fs.writeFileSync(path.join(dir, 'tool.exe'), '');
  fs.writeFileSync(path.join(dir, 'tool.com'), '');
  return dir;
}

test('findOnPath reads a PATH spelled in lower case (M9 fix 999)', () => {
  const dir = toolDir();
  assert.equal(findOnPath('tool', { path: dir }, 'win32'), path.join(dir, 'tool.exe'));
});

test('findOnPath reads a PATHEXT spelled in lower case (M9 fix 999)', () => {
  const dir = toolDir();
  assert.equal(findOnPath('tool', { Path: dir, pathext: '.COM' }, 'win32'), path.join(dir, 'tool.com'));
});

test('findOnPath with no PATH at all finds nothing (M9 fix 999)', () => {
  assert.equal(findOnPath('tool', {}, 'win32'), null);
});

test('envValue takes the exact key first, else any spelling, else undefined (M9 fix 999)', () => {
  assert.equal(envValue({ Path: 'a', PATH: 'b' }, 'PATH'), 'b');
  assert.equal(envValue({ comspec: 'c' }, 'ComSpec'), 'c');
  assert.equal(envValue({}, 'PATH'), undefined);
});

// An executable file of that exact name (off Windows the mode is read; on
// Windows X_OK is F_OK).
function exe(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '');
  fs.chmodSync(file, 0o755);
  return file;
}

test('off Windows findOnPath takes the exact name, no PATHEXT, and PATH by its exact key (M9 fix 1018)', () => {
  const dir = mkTemp('emerald-find-unix-');
  const tool = exe(dir, 'tool');
  assert.equal(findOnPath('tool', { PATH: dir }, 'linux'), tool);
  const other = mkTemp('emerald-find-unix-');
  exe(other, 'tool.exe');
  assert.equal(findOnPath('tool', { PATH: other }, 'linux'), null, 'tool.exe is not tool');
  assert.equal(findOnPath('tool', { path: dir }, 'linux'), null, 'a lower-case path key is not PATH');
  const slashed = tool.split(path.sep).join('/');
  assert.equal(findOnPath(slashed, {}, 'darwin'), slashed, 'a name with a slash is checked as it is');
});

test('off Windows a Tool is not found as tool where names are case-sensitive (M9 fix 1018)', { skip: process.platform === 'win32' ? 'NTFS is case-blind' : false }, () => {
  const dir = mkTemp('emerald-find-unix-');
  exe(dir, 'Tool');
  assert.equal(findOnPath('tool', { PATH: dir }, 'linux'), null);
});
