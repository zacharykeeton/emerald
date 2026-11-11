import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_STACK_CHARS, ERROR_STACK_PREFIX, ERROR_STACKS_KEPT, stackLine } from './error-stack.ts';

function errWith(stack: string): Error {
  const e = new TypeError('x');
  e.stack = stack;
  return e;
}

test("stackLine folds an uncaught error's stack into one line, kept once and twenty at most (M9 fix 1128)", () => {
  const seen = new Set<string>();
  const e = errWith('TypeError: x\n    at f (a.js:1:2)\n\n    at g (b.js:3:4)');
  assert.equal(stackLine(e, seen), '[emerald] uncaught stack: TypeError: x | at f (a.js:1:2) | at g (b.js:3:4)');
  assert.equal(stackLine(e, seen), null);

  const long = stackLine(errWith('y'.repeat(10000)), new Set());
  assert.equal(long?.length, ERROR_STACK_PREFIX.length + ERROR_STACK_CHARS);

  for (const v of ['boom', null, { stack: 'x' }, errWith('')]) assert.equal(stackLine(v, new Set()), null);

  const many = new Set<string>();
  for (let i = 0; i < ERROR_STACKS_KEPT; i++) assert.notEqual(stackLine(errWith(`E ${i}`), many), null);
  assert.equal(stackLine(errWith('E 21st'), many), null);
});
