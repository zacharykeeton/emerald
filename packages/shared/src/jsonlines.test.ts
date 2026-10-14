import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonLinesDecoder, encodeJsonLine } from './jsonlines.ts';

test('encode appends exactly one newline', () => {
  assert.equal(encodeJsonLine({ a: 1 }), '{"a":1}\n');
});

test('decodes one complete line', () => {
  const d = new JsonLinesDecoder();
  assert.deepEqual(d.push(Buffer.from('{"type":"hello"}\n')), [{ type: 'hello' }]);
});

test('decodes several lines in one chunk', () => {
  const d = new JsonLinesDecoder();
  const out = d.push(Buffer.from('{"n":1}\n{"n":2}\n{"n":3}\n'));
  assert.deepEqual(out, [{ n: 1 }, { n: 2 }, { n: 3 }]);
});

test('holds a partial line until the newline arrives', () => {
  const d = new JsonLinesDecoder();
  assert.deepEqual(d.push(Buffer.from('{"type":"he')), []);
  assert.deepEqual(d.push(Buffer.from('llo","id":')), []);
  assert.deepEqual(d.push(Buffer.from('7}\n{"x":')), [{ type: 'hello', id: 7 }]);
  assert.deepEqual(d.push(Buffer.from('1}\n')), [{ x: 1 }]);
});

test('a chunk split in the middle of a multibyte character decodes correctly', () => {
  const d = new JsonLinesDecoder();
  const bytes = Buffer.from(encodeJsonLine({ name: 'café ünïcode 日本' }));
  // Cut inside the 'é' (2 bytes) and inside '日' (3 bytes) and check every cut point anyway.
  for (let cut = 1; cut < bytes.length; cut++) {
    const dd = new JsonLinesDecoder();
    const first = dd.push(bytes.subarray(0, cut));
    const second = dd.push(bytes.subarray(cut));
    assert.deepEqual([...first, ...second], [{ name: 'café ünïcode 日本' }], `cut at ${cut}`);
  }
  assert.deepEqual(d.push(bytes), [{ name: 'café ünïcode 日本' }]);
});

test('tolerates CRLF and blank lines', () => {
  const d = new JsonLinesDecoder();
  assert.deepEqual(d.push(Buffer.from('{"a":1}\r\n\n\r\n{"b":2}\n')), [{ a: 1 }, { b: 2 }]);
});

test('round trips through encode', () => {
  const d = new JsonLinesDecoder();
  const msg = { type: 'pty.output', sessionId: 'abc', data: Buffer.from('hi\n').toString('base64') };
  assert.deepEqual(d.push(Buffer.from(encodeJsonLine(msg))), [msg]);
});

test('throws on malformed JSON', () => {
  const d = new JsonLinesDecoder();
  assert.throws(() => d.push(Buffer.from('{not json}\n')), SyntaxError);
});

test('throws when a line grows past the limit without a newline', () => {
  const d = new JsonLinesDecoder(10);
  assert.doesNotThrow(() => d.push(Buffer.from('12345')));
  assert.throws(() => d.push(Buffer.from('1234567890')), /exceeds/);
});
