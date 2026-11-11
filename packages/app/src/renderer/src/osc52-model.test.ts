import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OSC52_MAX_BYTES, osc52Text } from './osc52-model.ts';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

test('osc52Text decodes a write to any known selection and refuses a read, a clear, bad base64 and no selection (M9 fix 1091)', () => {
  assert.equal(osc52Text(`c;${b64('clip-1091 é')}`), 'clip-1091 é');
  assert.equal(osc52Text(`;${b64('empty selection')}`), 'empty selection');
  assert.equal(osc52Text(`p;${b64('primary')}`), 'primary');
  assert.equal(osc52Text('c;?'), null, 'a read is never answered');
  assert.equal(osc52Text('c;'), null, 'a clear is not done');
  assert.equal(osc52Text('c;!!!'), null, 'not base64');
  assert.equal(osc52Text(b64('no selection')), null, 'no ; at all');
  assert.equal(osc52Text(`x;${b64('unknown')}`), null, 'a selection emerald does not know');
});

test('osc52Text takes a write of OSC52_MAX_BYTES and refuses one byte more (M9 fix 1091)', () => {
  const at = osc52Text(`c;${Buffer.alloc(OSC52_MAX_BYTES, 0x61).toString('base64')}`);
  assert.equal(at?.length, OSC52_MAX_BYTES);
  assert.equal(osc52Text(`c;${Buffer.alloc(OSC52_MAX_BYTES + 1, 0x61).toString('base64')}`), null);
});
