import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { FormerStore } from './former-store.ts';
import { RequestError } from './errors.ts';

const quiet = { info() {}, warn() {}, error() {} };

test.after(removeTemps);

// M9 fix 1191: a folder's former folders, the folder in realFolder's
// spelling (a folder that does not exist keeps the spelling given).
test('the former store adds, repeats, removes, refuses the folder itself, inside it, around it and a ninth, and reads its file back', () => {
  const dir = mkTemp('emerald-former-');
  const file = path.join(dir, 'former-folders.json');
  const store = new FormerStore(file, quiet);
  store.load();
  const folder = path.join(dir, 'emerald');
  fs.mkdirSync(folder);
  const old = 'C:\\code\\zorca';
  assert.equal(store.set(folder, old, true), true);
  assert.equal(store.set(folder, 'c:/CODE/zorca', true), false, 'the same folder in another spelling is a repeat');
  assert.deepEqual(store.of(folder), [old]);
  const reasons = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      return err instanceof RequestError ? err.message : `not a RequestError: ${String(err)}`;
    }
    return 'no error';
  };
  const inside = 'a former folder cannot be the folder, inside it or around it';
  assert.equal(reasons(() => store.set(folder, folder, true)), inside);
  assert.equal(reasons(() => store.set(folder, path.join(folder, 'packages'), true)), inside);
  assert.equal(reasons(() => store.set(folder, dir, true)), inside);
  for (let i = 1; i < 8; i++) assert.equal(store.set(folder, `C:\\old\\${i}`, true), true);
  assert.equal(store.of(folder).length, 8);
  assert.match(reasons(() => store.set(folder, 'C:\\old\\9', true)), /has 8 former folders already; remove one first$/);
  // Read back from the file.
  const again = new FormerStore(file, quiet);
  again.load();
  assert.deepEqual(again.of(folder), store.of(folder));
  assert.equal(again.list().length, 1);
  // Removed, then gone.
  assert.equal(again.set(folder, old, false), true);
  assert.equal(again.set(folder, old, false), false);
  assert.equal(again.of(folder).includes(old), false);
  for (let i = 1; i < 8; i++) again.set(folder, `C:\\old\\${i}`, false);
  assert.deepEqual(again.list(), []);
});

test('a former folders file that is not a list is set aside and the store starts empty (M9 fix 1191)', () => {
  const dir = mkTemp('emerald-former-bad-');
  const file = path.join(dir, 'former-folders.json');
  fs.writeFileSync(file, '{"not": "a list"}');
  const warned: string[] = [];
  const store = new FormerStore(file, { info() {}, warn: (m: string) => warned.push(m), error() {} });
  store.load();
  assert.deepEqual(store.list(), []);
  assert.equal(fs.existsSync(file), false, 'set aside');
  assert.ok(warned.some((m) => m.includes('is not a list')));
});
