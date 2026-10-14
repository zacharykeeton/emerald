import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LABEL_CAP_PX, LABEL_CHAR_PX, SIDE_LABEL_CHARS, cutLabel, labelWidth, overlaps, pillYields, textBox } from './commit-graph-labels.ts';

test('commit-graph-labels (M9 fix 142): a text box from its anchor, and the overlap between two', () => {
  const w = labelWidth('main');
  assert.equal(w, 4 * LABEL_CHAR_PX);
  assert.deepEqual(textBox(100, 20, 'main', 'start'), { x0: 100, x1: 100 + w, y0: 20 - LABEL_CAP_PX, y1: 20 });
  assert.deepEqual(textBox(100, 20, 'main', 'end'), { x0: 100 - w, x1: 100, y0: 20 - LABEL_CAP_PX, y1: 20 });
  assert.deepEqual(textBox(100, 20, 'main', 'middle'), { x0: 100 - w / 2, x1: 100 + w / 2, y0: 20 - LABEL_CAP_PX, y1: 20 });
  const a = textBox(0, 10, 'abcd', 'start');
  assert.ok(overlaps(a, textBox(10, 10, 'ab', 'start')), 'the same band, the ranges crossing');
  assert.ok(!overlaps(a, textBox(a.x1, 10, 'ab', 'start')), 'touching at an edge is not an overlap');
  assert.ok(!overlaps(a, textBox(0, 10 + LABEL_CAP_PX, 'ab', 'start')), 'the band below, touching, is not');
  assert.ok(overlaps(a, textBox(0, 10 + LABEL_CAP_PX - 1, 'ab', 'start')), 'a band one pixel into it is');
});

test('commit-graph-labels (M9 fix 142): a pill yields when an agent label crosses the band above its node, and not otherwise', () => {
  // The click-through's shape on its side: the session's mark on lane 0
  // at column x, its label running right from the mark's edge on the
  // lane's own baseline; W1 a column later on lane 1, its pill in the
  // band above, which is lane 0's.
  const lane0 = 20;
  const lane1 = 32;
  const sessionLabel = textBox(100 + 10, lane0 + 3, cutLabel('idle · Worktree agent with git commits'), 'start');
  const w1Pill = textBox(124, lane1 - 6, 'fx1', 'middle');
  assert.ok(pillYields(w1Pill, [sessionLabel]), 'the pill under the label yields');
  // A pill on a commit older than the mark is not crossed.
  const olderPill = textBox(76, lane1 - 6, 'fx1', 'middle');
  assert.ok(!pillYields(olderPill, [sessionLabel]));
  // A pill on the session's own lane sits in the band above lane 0,
  // where no label runs.
  const ownPill = textBox(124, lane0 - 6, 'fx2', 'middle');
  assert.ok(!pillYields(ownPill, [sessionLabel]));
  // Reversed the label runs left from the mark, and a pill past the
  // mark to the right is clear.
  const reversedLabel = textBox(100 - 10, lane0 + 3, cutLabel('idle · Worktree agent with git commits'), 'end');
  assert.ok(!pillYields(w1Pill, [reversedLabel]));
  assert.ok(pillYields(olderPill, [reversedLabel]));
  assert.ok(!pillYields(w1Pill, []), 'no labels, nothing yields');
});

test('commit-graph-labels (M9 fix 142): an agent label is cut to 24 characters with an ellipsis', () => {
  assert.equal(SIDE_LABEL_CHARS, 24);
  assert.equal(cutLabel('idle · Worktree agent with git commits'), 'idle · Worktree agent w…');
  assert.equal(cutLabel('idle · Worktree agent w…').length, 24);
  assert.equal(cutLabel('working · subagent · x'), 'working · subagent · x', 'under the cap, whole');
  assert.equal(cutLabel('subagent · fork · x'), 'subagent · fork · x', 'the M9 fix 398 form, whole');
  assert.equal(cutLabel('123456789012345678901234'), '123456789012345678901234', 'at the cap, whole');
  assert.equal(cutLabel('1234567890123456789012345'), '12345678901234567890123…');
  assert.equal(cutLabel('abcdef', 4), 'abc…');
});
