import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { mkTemp, removeTemps } from './test-temp.ts';

test('mkTemp makes a folder under the temp folder with the prefix, and removeTemps removes every one it made', async () => {
  const a = mkTemp('emerald-test-temp-');
  const b = mkTemp('emerald-test-temp-');
  fs.writeFileSync(path.join(a, 'f.txt'), 'x');
  fs.mkdirSync(path.join(b, 'nested'));
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
  assert.ok(a.startsWith(path.join(os.tmpdir(), 'emerald-test-temp-')));
  assert.ok(b.startsWith(path.join(os.tmpdir(), 'emerald-test-temp-')));
  assert.notEqual(a, b);
  await removeTemps();
  assert.ok(!fs.existsSync(a) && !fs.existsSync(b));
  await assert.doesNotReject(removeTemps());
});

test('removeTemps keeps the event loop running while a folder is held, and removes it once let go', { skip: process.platform !== 'win32' }, async () => {
  const home = process.cwd();
  const dir = mkTemp('emerald-test-temp-held-');
  // A process's working folder cannot be removed on Windows (rmSync gives
  // EPERM), so this one holds dir until the timer lets it go.
  process.chdir(dir);
  let fired = false;
  const letGo = setTimeout(() => {
    fired = true;
    process.chdir(home);
  }, 200);
  try {
    await removeTemps();
    assert.ok(fired, 'the timer ran during the wait');
    assert.ok(!fs.existsSync(dir), 'the folder went once let go');
  } finally {
    clearTimeout(letGo);
    process.chdir(home);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
