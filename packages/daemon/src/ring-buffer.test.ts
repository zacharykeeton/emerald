import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RingBuffer } from './ring-buffer.ts';

test('starts empty', () => {
  const rb = new RingBuffer(8);
  assert.equal(rb.size, 0);
  assert.equal(rb.readAll().length, 0);
});

test('rejects a non-positive capacity', () => {
  assert.throws(() => new RingBuffer(0), RangeError);
  assert.throws(() => new RingBuffer(-1), RangeError);
  assert.throws(() => new RingBuffer(1.5), RangeError);
});

test('stores writes in order when under capacity', () => {
  const rb = new RingBuffer(16);
  rb.write(Buffer.from('hello '));
  rb.write(Buffer.from('world'));
  assert.equal(rb.readAll().toString(), 'hello world');
  assert.equal(rb.size, 11);
});

test('ignores empty writes', () => {
  const rb = new RingBuffer(4);
  rb.write(Buffer.alloc(0));
  assert.equal(rb.size, 0);
});

test('fills exactly to capacity without wrapping', () => {
  const rb = new RingBuffer(5);
  rb.write(Buffer.from('abcde'));
  assert.equal(rb.readAll().toString(), 'abcde');
  assert.equal(rb.size, 5);
});

test('drops the oldest bytes once full', () => {
  const rb = new RingBuffer(5);
  rb.write(Buffer.from('abc'));
  rb.write(Buffer.from('defg'));
  assert.equal(rb.readAll().toString(), 'cdefg');
  assert.equal(rb.size, 5);
});

test('a write that straddles the physical end wraps correctly', () => {
  const rb = new RingBuffer(6);
  rb.write(Buffer.from('1234'));
  rb.write(Buffer.from('5678'));
  assert.equal(rb.readAll().toString(), '345678');
  rb.write(Buffer.from('9'));
  assert.equal(rb.readAll().toString(), '456789');
});

test('a chunk larger than capacity keeps only its tail', () => {
  const rb = new RingBuffer(4);
  rb.write(Buffer.from('x'));
  rb.write(Buffer.from('abcdefgh'));
  assert.equal(rb.readAll().toString(), 'efgh');
  assert.equal(rb.size, 4);
});

test('a chunk exactly at capacity replaces everything', () => {
  const rb = new RingBuffer(4);
  rb.write(Buffer.from('zz'));
  rb.write(Buffer.from('abcd'));
  assert.equal(rb.readAll().toString(), 'abcd');
});

test('many small writes match a sliding window over the same stream', () => {
  const capacity = 100;
  const rb = new RingBuffer(capacity);
  const chunks: Buffer[] = [];
  for (let i = 0; i < 1000; i++) {
    const len = (i * 7) % 13 + 1;
    const chunk = Buffer.alloc(len, i % 256);
    chunks.push(chunk);
    rb.write(chunk);
  }
  const all = Buffer.concat(chunks);
  const expected = all.subarray(all.length - capacity);
  assert.deepEqual(rb.readAll(), expected);
});

test('readAll returns a copy that later writes do not touch', () => {
  const rb = new RingBuffer(8);
  rb.write(Buffer.from('abc'));
  const snapshot = rb.readAll();
  rb.write(Buffer.from('def'));
  assert.equal(snapshot.toString(), 'abc');
});

test('clear empties the ring and it can be reused', () => {
  const rb = new RingBuffer(4);
  rb.write(Buffer.from('abcdef'));
  rb.clear();
  assert.equal(rb.size, 0);
  rb.write(Buffer.from('xy'));
  assert.equal(rb.readAll().toString(), 'xy');
});

test('seq counts every byte ever written, wrapped or not', () => {
  const rb = new RingBuffer(4);
  assert.equal(rb.seq, 0);
  rb.write(Buffer.from('abc'));
  assert.equal(rb.seq, 3);
  rb.write(Buffer.from('defgh'));
  assert.equal(rb.seq, 8);
  assert.equal(rb.size, 4);
});

test('readSince returns only the bytes after the cursor, with the next cursor', () => {
  const rb = new RingBuffer(16);
  rb.write(Buffer.from('hello '));
  const first = rb.readSince(0);
  assert.equal(first.data.toString(), 'hello ');
  assert.equal(first.next, 6);
  assert.equal(first.oldest, undefined);
  rb.write(Buffer.from('world'));
  const second = rb.readSince(first.next);
  assert.equal(second.data.toString(), 'world');
  assert.equal(second.next, 11);
  const third = rb.readSince(second.next);
  assert.equal(third.data.length, 0);
  assert.equal(third.next, 11);
});

test('readSince reports oldest when the cursor points at bytes the ring has dropped', () => {
  const rb = new RingBuffer(4);
  rb.write(Buffer.from('abcdefgh'));
  const got = rb.readSince(2);
  assert.equal(got.data.toString(), 'efgh');
  assert.equal(got.next, 8);
  assert.equal(got.oldest, 4);
  // A cursor at the oldest byte still held is not a loss.
  assert.equal(rb.readSince(4).oldest, undefined);
});
