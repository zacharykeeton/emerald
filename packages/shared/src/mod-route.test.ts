import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modRoutable } from './mod-route.ts';

test('a plain prompt goes through the mod; a command, bash mode, the memory key or a mention is typed (M9 fix 741)', () => {
  assert.equal(modRoutable('fix the login bug'), true);
  assert.equal(modRoutable('first line\nsecond line'), true);
  assert.equal(modRoutable('/compact'), false);
  assert.equal(modRoutable('  /exit'), false);
  assert.equal(modRoutable('!ls'), false);
  assert.equal(modRoutable('# note'), false);
  assert.equal(modRoutable('look at @src/a.ts'), false);
  assert.equal(modRoutable('@a.ts first'), false);
  assert.equal(modRoutable('mail me at a@b.com'), true);
});
