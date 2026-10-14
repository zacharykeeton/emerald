import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { listFolder } from './list-folder.ts';

// Five folders a to e and a file, so a cap of 3 cuts d, e and the file.
function fixture(): string {
  const dir = mkTemp('emerald-list-');
  for (const name of ['c', 'a', 'e', 'b', 'd']) fs.mkdirSync(path.join(dir, name));
  fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
  return dir;
}

test.after(removeTemps);

const names = (l: Awaited<ReturnType<typeof listFolder>>) => ('error' in l ? l.error : l.entries.map((e) => e.name).join(','));

// The literal is what the per-call localeCompare gave this fixture on the
// base commit (M9 fix 520 moved the sort to one Intl.Collator); no two
// names are equal under base sensitivity, so readdir's order cannot show.
test('the order is the one localeCompare gave', async () => {
  const dir = mkTemp('emerald-list-order-');
  try {
    for (const name of ['Beta', 'a-dir']) fs.mkdirSync(path.join(dir, name));
    for (const name of ['b.txt', 'A.txt', '_x.txt', '10.txt', '9.txt', 'Zeta.txt', 'alpha.txt']) fs.writeFileSync(path.join(dir, name), '');
    const l = await listFolder(dir);
    assert.equal(names(l), 'a-dir,Beta,_x.txt,10.txt,9.txt,A.txt,alpha.txt,b.txt,Zeta.txt');
    // Only the entry's own fields leave the main process.
    assert.deepEqual('entries' in l ? Object.keys(l.entries[0]!) : [], ['name', 'kind']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a cap cuts the listing and counts the rest', async () => {
  const dir = fixture();
  const l = await listFolder(dir, undefined, 3);
  assert.equal(names(l), 'a,b,c');
  assert.equal('truncated' in l && l.truncated, 3);
});

test('a kept entry past the cap is listed in its sorted place and counted out of truncated (M9 fix 436)', async () => {
  const dir = fixture();
  const l = await listFolder(dir, path.join(dir, 'e'), 3);
  assert.equal(names(l), 'a,b,c,e');
  assert.equal('truncated' in l && l.truncated, 2);
  // A kept folder the cap already shows changes nothing.
  const inside = await listFolder(dir, path.join(dir, 'b'), 3);
  assert.equal(names(inside), 'a,b,c');
  assert.equal('truncated' in inside && inside.truncated, 3);
});

test('the kept name matches without case, and a keep outside the folder is ignored', async () => {
  const dir = fixture();
  const l = await listFolder(dir, path.join(dir, 'D'), 3);
  assert.equal(names(l), 'a,b,c,d');
  const elsewhere = await listFolder(dir, path.join(os.tmpdir(), 'e'), 3);
  assert.equal(names(elsewhere), 'a,b,c');
  const none = await listFolder(dir, path.join(dir, 'nope'), 3);
  assert.equal(names(none), 'a,b,c');
});

test('under the cap the keep does nothing and a missing folder says so', async () => {
  const dir = fixture();
  const l = await listFolder(dir, path.join(dir, 'e'));
  assert.equal(names(l), 'a,b,c,d,e,f.txt');
  assert.equal('truncated' in l && l.truncated, 0);
  assert.equal(names(await listFolder(path.join(dir, 'gone'))), 'Folder not found');
});
