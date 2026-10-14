import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBusy, promptRefusal } from './prompt-model.ts';

test('promptRefusal names the two states the text must not go to', () => {
  assert.equal(promptRefusal({ state: 'needs-input' }), 'Answer what it is waiting on first');
  assert.equal(promptRefusal({ state: 'exited' }), 'Resume it first');
});

test('promptRefusal lets the text go to every other state', () => {
  for (const state of ['starting', 'idle', 'working', 'waiting', 'done', 'errored'] as const) assert.equal(promptRefusal({ state }), null, state);
});

test('isBusy is working and waiting, the states that are taken as moving', () => {
  assert.equal(isBusy('working'), true);
  assert.equal(isBusy('waiting'), true);
  assert.equal(isBusy('idle'), false);
  assert.equal(isBusy('done'), false);
});
