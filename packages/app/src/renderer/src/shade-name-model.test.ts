import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameStep, shadeName } from './shade-name-model.ts';

// M9 fix 372: the handoff's examples (docs/design/shade-lid.md, section 7).
test('shadeName: a colon splits the identity from the subject, the step off the identity', () => {
  assert.deepEqual(shadeName('Batch 5257: board chrome and suite hygiene'), { identity: 'Batch 5257', subject: 'board chrome and suite hygiene', step: 1 });
  assert.deepEqual(shadeName('Plan batch 352: performance'), { identity: 'Plan batch 352', subject: 'performance', step: 2 });
  // A colon with nothing on one side is not a split.
  assert.deepEqual(shadeName('Batch 5:'), { identity: 'Batch 5:', subject: null, step: 1 });
  assert.deepEqual(shadeName(': odd'), { identity: ': odd', subject: null, step: 1 });
});

test('shadeName: past 18 characters a leading id token splits, under it nothing does', () => {
  assert.deepEqual(shadeName('Batch 5257 board chrome and suite hygiene'), { identity: 'Batch 5257', subject: 'board chrome and suite hygiene', step: 1 });
  assert.deepEqual(shadeName('fix-372 the shade becomes a lid'), { identity: 'fix-372', subject: 'the shade becomes a lid', step: 1 });
  assert.deepEqual(shadeName('#42 the widths of the rows'), { identity: '#42', subject: 'the widths of the rows', step: 1 });
  // A token that is letters and digits with no space or hyphen before the digit is not an id.
  assert.deepEqual(shadeName('M9.1 the rail and the strip'), { identity: 'M9.1 the rail and the strip', subject: null, step: 3 });
  // Short names stay whole whatever their shape.
  assert.deepEqual(shadeName('fix-runway-wrap'), { identity: 'fix-runway-wrap', subject: null, step: 2 });
  assert.deepEqual(shadeName('batch 329'), { identity: 'batch 329', subject: null, step: 1 });
});

test('shadeName: a plain sentence stays whole at the size its length earns; the name is trimmed', () => {
  const long = 'the activity strip grows a track on every change';
  assert.equal(long.length, 48);
  assert.deepEqual(shadeName(long), { identity: long, subject: null, step: 4 });
  assert.deepEqual(shadeName('  batch 329  '), { identity: 'batch 329', subject: null, step: 1 });
  assert.deepEqual(shadeName('the sidebar rows squeeze'), { identity: 'the sidebar rows squeeze', subject: null, step: 3 });
});

test('nameStep: the four steps at 12, 20 and 32 characters', () => {
  assert.deepEqual([0, 12, 13, 20, 21, 32, 33, 80].map(nameStep), [1, 1, 2, 2, 3, 3, 4, 4]);
});
