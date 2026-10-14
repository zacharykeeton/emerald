import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectPort } from './inspect.ts';

const argv = ['Emerald.exe', '--updated'];

test('EMERALD_INSPECT_PORT names the devtools port (M9 fix 355)', () => {
  assert.deepEqual(inspectPort({ EMERALD_INSPECT_PORT: '9229' }, argv), { port: 9229, reason: null });
  assert.deepEqual(inspectPort({ EMERALD_INSPECT_PORT: ' 9300 ' }, argv), { port: 9300, reason: null });
});

test('no variable, or an empty one, asks for nothing', () => {
  assert.deepEqual(inspectPort({}, argv), { port: null, reason: 'not asked' });
  assert.deepEqual(inspectPort({ EMERALD_INSPECT_PORT: '' }, argv), { port: null, reason: 'not asked' });
});

test('the harness argument on the command line wins over the variable', () => {
  const under = inspectPort({ EMERALD_INSPECT_PORT: '9229' }, ['electron', '--remote-debugging-port=9412', '--user-data-dir=x', 'main.js']);
  assert.deepEqual(under, { port: null, reason: 'the command line already names one' });
  assert.equal(inspectPort({ EMERALD_INSPECT_PORT: '9229' }, ['electron', '--remote-debugging-port', '9412']).port, null);
});

test('a non-integer or an out-of-range value is refused with its text', () => {
  assert.deepEqual(inspectPort({ EMERALD_INSPECT_PORT: 'nine' }, argv), { port: null, reason: 'nine is not a port' });
  assert.deepEqual(inspectPort({ EMERALD_INSPECT_PORT: '92.29' }, argv), { port: null, reason: '92.29 is not a port' });
  assert.equal(inspectPort({ EMERALD_INSPECT_PORT: '70000' }, argv).port, null);
  assert.equal(inspectPort({ EMERALD_INSPECT_PORT: '0' }, argv).port, null);
});
