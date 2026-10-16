import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { readTail } from './read-tail.ts';

// M9 fix 770: the chat view's tail read.
after(() => removeTemps());

const line = (n: number) => `${JSON.stringify({ type: 'user', n })}\n`;

test('readTail: a file under the cap reads whole and fresh; a read from the mark takes the appended lines alone', async () => {
  const file = path.join(mkTemp('emerald-tail-'), 't.jsonl');
  fs.writeFileSync(file, line(1) + line(2));
  const first = await readTail(file, null);
  assert.ok(!('error' in first));
  assert.equal(first.text, line(1) + line(2));
  assert.equal(first.fresh, true);
  assert.equal(first.cut, false);
  assert.equal(first.next.offset, Buffer.byteLength(line(1) + line(2)));
  fs.appendFileSync(file, line(3));
  const grown = await readTail(file, first.next);
  assert.ok(!('error' in grown));
  assert.equal(grown.text, line(3));
  assert.equal(grown.fresh, false);
  // Nothing new: empty text and the same mark.
  const same = await readTail(file, grown.next);
  assert.deepEqual(same, { text: '', next: grown.next, fresh: false, cut: false });
});

test('readTail: an unterminated last line waits for its newline', async () => {
  const file = path.join(mkTemp('emerald-tail-'), 't.jsonl');
  fs.writeFileSync(file, line(1) + '{"type":"user","n":');
  const first = await readTail(file, null);
  assert.ok(!('error' in first));
  assert.equal(first.text, line(1));
  fs.appendFileSync(file, '2}\n');
  const rest = await readTail(file, first.next);
  assert.ok(!('error' in rest));
  assert.equal(rest.text, '{"type":"user","n":2}\n');
});

test('readTail: a file over the cap starts at the first line start after its tail, cut, a character straddling the cut byte', async () => {
  const file = path.join(mkTemp('emerald-tail-'), 't.jsonl');
  // Lines of 100 bytes; the cut byte falls inside a three-byte character.
  const pad = (n: number) => `${JSON.stringify({ n, t: 'x'.repeat(80) })}`.padEnd(99, ' ') + '\n';
  let text = '';
  for (let n = 0; n < 40; n++) text += pad(n);
  const wide = `${JSON.stringify({ n: 'wide', t: '€€€€€€€€€€' })}\n`;
  text += wide;
  for (let n = 40; n < 60; n++) text += pad(n);
  fs.writeFileSync(file, text);
  const size = Buffer.byteLength(text);
  // A tail whose first byte is the second byte of a euro sign.
  const wideAt = Buffer.byteLength(text.slice(0, text.indexOf('€')));
  const tailBytes = size - (wideAt + 1);
  const r = await readTail(file, null, 1024, tailBytes);
  assert.ok(!('error' in r));
  assert.equal(r.cut, true);
  assert.equal(r.fresh, true);
  assert.ok(r.text.startsWith(pad(40)), `the tail starts on the line after the cut, got ${JSON.stringify(r.text.slice(0, 30))}`);
  assert.ok(!r.text.includes('€'));
  assert.equal(r.next.offset, size);
});

test('readTail: a file renamed over the name and a shrink read fresh', async () => {
  const dir = mkTemp('emerald-tail-');
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, line(1) + line(2));
  const first = await readTail(file, null);
  assert.ok(!('error' in first));
  const other = path.join(dir, 'other.jsonl');
  fs.writeFileSync(other, line(1) + line(2) + line(3));
  fs.renameSync(other, file);
  const renamed = await readTail(file, first.next);
  assert.ok(!('error' in renamed));
  assert.equal(renamed.fresh, true);
  assert.equal(renamed.text, line(1) + line(2) + line(3));
  fs.writeFileSync(file, line(9));
  const shrunk = await readTail(file, renamed.next);
  assert.ok(!('error' in shrunk));
  assert.equal(shrunk.fresh, true);
  assert.equal(shrunk.text, line(9));
});
