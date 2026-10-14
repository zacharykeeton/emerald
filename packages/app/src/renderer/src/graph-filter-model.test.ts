import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearLines, drawState, drawnBlocks, soloLines, toggleLines } from './graph-filter-model.ts';

const blocks = ['s1', 's2', 'history:t1', 'outside'];
const live = new Set(['s1']);

test('drawnBlocks (M72): all draws every block, active the live sessions alone, the hidden set comes off either, a solo the graph holds wins, one it does not is ignored', () => {
  assert.deepEqual([...drawnBlocks({ draw: 'all', hidden: [], solo: null }, blocks, live)], blocks);
  assert.deepEqual([...drawnBlocks({ draw: 'active', hidden: [], solo: null }, blocks, live)], ['s1'], 'history and the grey block are not active');
  assert.deepEqual([...drawnBlocks({ draw: 'all', hidden: ['s2', 'outside'], solo: null }, blocks, live)], ['s1', 'history:t1']);
  assert.deepEqual([...drawnBlocks({ draw: 'active', hidden: ['s1'], solo: null }, blocks, live)], [], 'active minus the one live session is nothing');
  assert.deepEqual([...drawnBlocks({ draw: 'active', hidden: ['s1'], solo: 'history:t1' }, blocks, live)], ['history:t1'], 'the solo wins over the mode and the hidden set');
  assert.deepEqual([...drawnBlocks({ draw: 'all', hidden: [], solo: 'elsewhere' }, blocks, live)], blocks, 'a solo from another repository is ignored');
  assert.deepEqual([...drawnBlocks({ draw: 'all', hidden: ['elsewhere'], solo: null }, blocks, live)], blocks);
});

test('drawState (M72): the chip reads the mode, or some while a solo or a hidden id the graph holds is in force', () => {
  assert.equal(drawState({ draw: 'all', hidden: [], solo: null }, blocks), 'all');
  assert.equal(drawState({ draw: 'active', hidden: [], solo: null }, blocks), 'active');
  assert.equal(drawState({ draw: 'all', hidden: ['s2'], solo: null }, blocks), 'some');
  assert.equal(drawState({ draw: 'active', hidden: [], solo: 's2' }, blocks), 'some');
  assert.equal(drawState({ draw: 'all', hidden: ['elsewhere'], solo: 'elsewhere' }, blocks), 'all', 'ids the graph does not hold count for nothing');
});

test('toggleLines, soloLines, clearLines (M72): hide and show one block, a solo, and the way back', () => {
  const start = { draw: 'all' as const, hidden: [], solo: null };
  const hid = toggleLines(start, 's2', true);
  assert.deepEqual(hid, { draw: 'all', hidden: ['s2'], solo: null });
  assert.deepEqual(toggleLines(hid, 's2', false), start, 'shown again');
  const solo = soloLines(hid, 's1');
  assert.deepEqual([...drawnBlocks(solo, blocks, live)], ['s1']);
  assert.deepEqual(toggleLines(solo, 's1', true), { draw: 'all', hidden: ['s2', 's1'], solo: null }, 'hiding the soloed block drops the solo');
  assert.deepEqual(toggleLines(solo, 'outside', false), { draw: 'all', hidden: ['s2'], solo: null }, 'showing another block under a solo drops the solo');
  assert.deepEqual(clearLines({ draw: 'active', hidden: ['s2'], solo: 's1' }), start);
});
