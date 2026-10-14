import { test } from 'node:test';
import assert from 'node:assert/strict';
import { name, run } from '../src/orchard/plant.js';

test('plant treats every tree', () => {
  assert.equal(name, 'plant');
  assert.equal(run([{}, {}]).treated, 2);
});
