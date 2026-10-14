import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { appendedBytesRead, markKind, markOf, readWholeLines, stampOf } from './appended-read.ts';

// M9 fixes 528 and 529: the helper both transcript readers use to read
// only what a file appended, driven at an 8-byte chunk so every edge is
// met inside a short fixture.
const dir = fs.realpathSync.native(mkTemp('emerald-appended-'));
test.after(removeTemps);

async function read(file: string, from: number, to: number): Promise<{ text: string; offset: number }> {
  const handle = await fs.promises.open(file, 'r');
  try {
    let text = '';
    const offset = await readWholeLines(handle, from, to, (t) => (text += t), 8);
    return { text, offset };
  } finally {
    await handle.close();
  }
}

test('readWholeLines: a file of whole lines read in two calls hands back what one call does', async () => {
  const file = path.join(dir, 'two.txt');
  const body = 'alpha\nbravo charlie\ndelta\necho foxtrot golf\n';
  fs.writeFileSync(file, body);
  const whole = await read(file, 0, body.length);
  assert.equal(whole.text, body);
  assert.equal(whole.offset, body.length);
  const cut = 'alpha\nbravo charlie\n'.length + 3;
  const first = await read(file, 0, cut);
  const second = await read(file, first.offset, body.length);
  assert.equal(first.text + second.text, body);
  assert.equal(second.offset, body.length);
});

test('readWholeLines: a two-byte character straddling a chunk edge comes back whole', async () => {
  const file = path.join(dir, 'utf8.txt');
  // 'abcdefg' puts the two bytes of é at offsets 7 and 8, across the
  // first 8-byte chunk's edge.
  const body = 'abcdefgé tail\nsecond line é\n';
  fs.writeFileSync(file, body, 'utf8');
  const size = fs.statSync(file).size;
  const got = await read(file, 0, size);
  assert.equal(got.text, body);
  assert.equal(got.offset, size);
});

test('readWholeLines: an unterminated last line is not handed back and the offset stops before it', async () => {
  const file = path.join(dir, 'torn.txt');
  const done = 'one\ntwo three four\n';
  fs.writeFileSync(file, done + 'five six sev');
  const size = fs.statSync(file).size;
  const before = appendedBytesRead();
  const got = await read(file, 0, size);
  assert.equal(got.text, done);
  assert.equal(got.offset, Buffer.byteLength(done));
  assert.equal(appendedBytesRead() - before, size, 'the counter counts every byte read');
});

test("markKind: same, grown, a shrink, a new inode and a new mtime at the same size", async () => {
  const file = path.join(dir, 'mark.txt');
  fs.writeFileSync(file, 'one\ntwo\n');
  const at = 1_700_000_000;
  fs.utimesSync(file, at, at);
  const stamp = () => stampOf(fs.statSync(file, { bigint: true }));
  const mark = markOf(stamp(), 8);
  assert.equal(markKind(undefined, stamp()), 'fresh', 'no mark');
  assert.equal(markKind(mark, stamp()), 'same');
  fs.appendFileSync(file, 'three\n');
  const grown = stamp();
  assert.equal(markKind(mark, grown), 'grown');
  // A new file id against the grown file, built rather than renamed for
  // (M9 fix 633): a rename on NTFS may land on an id equal to the old one
  // as a double, and the test is about the compare, not the volume.
  assert.equal(markKind({ ...mark, ino: mark.ino + 1n }, grown), 'fresh', 'a new file id');
  assert.equal(
    markKind({ ...mark, ino: 9851624187919028n }, { ...grown, ino: 9851624187919029n }),
    'fresh',
    'ids equal as doubles but not as bigints',
  );
  fs.truncateSync(file, 4);
  assert.equal(markKind(mark, stamp()), 'fresh', 'a shrink');
  // The same size with a new mtime: a rewrite in place, not an append.
  fs.writeFileSync(file, 'uno\ndos\n');
  fs.utimesSync(file, at + 5, at + 5);
  const same = stamp();
  assert.equal(same.size, mark.size);
  assert.equal(markKind({ ...mark, ino: same.ino }, same), 'fresh', 'the same size, a new mtime');
});
