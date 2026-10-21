import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRequestError, encodeRequestError } from './request-error.ts';

const wrap = (message: string) => new Error(`Error invoking remote method 'emerald:request': Error: ${message}`);

test('a coded daemon error rides in the message as JSON, the code first (M9 fix 947)', () => {
  const stale = Object.assign(new Error('layout edit was based on revision 1 but the current revision is 2'), { code: 'stale-revision' });
  const encoded = encodeRequestError(stale);
  assert.ok(encoded instanceof Error);
  assert.equal(encoded.message, '{"code":"stale-revision","message":"layout edit was based on revision 1 but the current revision is 2"}');
});

test("main's own uncoded error is answered as it is", () => {
  const err = new Error('emmerd did not come up');
  assert.equal(encodeRequestError(err), err);
});

test("the code and the plain message come back out of the invoke's wrapped message", () => {
  const encoded = encodeRequestError(Object.assign(new Error('layout edit was based on revision 1 but the current revision is 2'), { code: 'stale-revision' })) as Error;
  const decoded = decodeRequestError(wrap(encoded.message));
  assert.ok(decoded instanceof Error);
  assert.equal((decoded as { code?: string }).code, 'stale-revision');
  assert.equal(decoded.message, 'layout edit was based on revision 1 but the current revision is 2');
});

test('a message holding braces and quotes makes the round trip whole', () => {
  const encoded = encodeRequestError(Object.assign(new Error('layout must be {"tabs": [...]}'), { code: 'bad-request' })) as Error;
  const decoded = decodeRequestError(wrap(encoded.message)) as Error;
  assert.equal((decoded as { code?: string }).code, 'bad-request');
  assert.equal(decoded.message, 'layout must be {"tabs": [...]}');
});

test('a wrapped message with no marker, or a cut one, is answered as it is', () => {
  const plain = wrap('emmerd did not come up');
  assert.equal(decodeRequestError(plain), plain);
  const cut = wrap('{"code":"x"');
  assert.equal(decodeRequestError(cut), cut);
});
