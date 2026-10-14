import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { realFolder, sameFolder } from './real-folder.ts';

test('realFolder: the short and the long spelling of a folder meet, and a folder that is not there is returned as given (M9 fix 107)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-real-'));
  try {
    const real = fs.realpathSync.native(dir);
    assert.equal(realFolder(dir), real);
    assert.equal(realFolder(real), real);
    assert.equal(realFolder(dir.toLowerCase()), real, 'case is the file system\'s');
    assert.equal(realFolder(path.join(dir, 'missing')), path.join(dir, 'missing'));
    assert.equal(realFolder('/c/Users/nobody/wt'), '/c/Users/nobody/wt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sameFolder: one folder under two spellings, and two folders that do not exist compared by name (M9 fix 116)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-same-'));
  try {
    assert.ok(sameFolder(dir, fs.realpathSync.native(dir)));
    assert.ok(sameFolder(dir.replace(/\\/g, '/'), dir + '\\'));
    assert.ok(!sameFolder(dir, path.join(dir, 'sub')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(sameFolder('C:/code/emerald', 'c:\\code\\emerald\\'));
  assert.ok(!sameFolder('C:/code/emerald', 'C:/code/emerald-wt/m61'));
});
