import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figureSlots } from './figure-roll-model.ts';

// The odometer's slots (M9 fix 235): the digit that changed rolls with
// the old digit beside it, the rest stay still, a carry rolls every
// digit it touched, and a length change fades a slot in or out.

const text = (slots: ReturnType<typeof figureSlots>) => slots.map((s) => s.text).join('');
const moves = (slots: ReturnType<typeof figureSlots>) => slots.map((s) => s.move).join(',');

test('figureSlots with no previous figure is every character still', () => {
  const slots = figureSlots(null, '31.6k');
  assert.equal(text(slots), '31.6k');
  assert.equal(moves(slots), 'still,still,still,still,still');
  assert.ok(slots.every((s) => s.from === null));
});

test('figureSlots rolls the one digit that changed and keeps the rest still', () => {
  const slots = figureSlots('31.6k', '31.7k');
  assert.equal(text(slots), '31.7k');
  assert.equal(moves(slots), 'still,still,still,roll,still');
  assert.deepEqual(slots[3], { text: '7', from: '6', move: 'roll' });
});

test('figureSlots rolls every digit a carry touched, together', () => {
  const slots = figureSlots('19.9k', '20.0k');
  assert.equal(text(slots), '20.0k');
  assert.equal(moves(slots), 'roll,roll,still,roll,still');
  assert.equal(slots[0]!.from, '1');
  assert.equal(slots[1]!.from, '9');
  assert.equal(slots[3]!.from, '9');
});

test('figureSlots aligns on the right, so a figure that grows a digit enters one slot on the left', () => {
  const slots = figureSlots('9.9k', '10.0k');
  assert.equal(text(slots), '10.0k');
  assert.equal(moves(slots), 'enter,roll,still,roll,still');
  assert.deepEqual(slots[0], { text: '1', from: null, move: 'enter' });
});

test('figureSlots fades a change into a letter and leaves the slots a shorter figure gave up', () => {
  const slots = figureSlots('999', '1k');
  assert.equal(text(slots), '1k');
  assert.equal(moves(slots), 'leave,roll,fade');
  assert.deepEqual(slots[0], { text: '', from: '9', move: 'leave' });
  assert.deepEqual(slots[2], { text: 'k', from: '9', move: 'fade' });
});

test('figureSlots rolls a decrease up as well', () => {
  const slots = figureSlots('$1.52', '$1.40');
  assert.equal(text(slots), '$1.40');
  assert.equal(moves(slots), 'still,still,still,roll,roll');
});

test('figureSlots on the same figure twice is every slot still', () => {
  assert.equal(moves(figureSlots('844.7k', '844.7k')), 'still,still,still,still,still,still');
});
