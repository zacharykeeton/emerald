import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOCUS_HISTORY_CAP, emptyFocusHistory, nextStop, recordFocus, sameEntry, stepFocus } from './focus-history-model.ts';
import type { FocusEntry } from './focus-history-model.ts';

const pane = (tabId: string, paneId: string): FocusEntry => ({ kind: 'pane', tabId, paneId });
const file = (path: string): FocusEntry => ({ kind: 'file', path });
const all = () => true;

test('a move appends and becomes current; the same place twice folds', () => {
  let h = recordFocus(emptyFocusHistory(), pane('t1', 'a'));
  assert.equal(h.at, 0);
  h = recordFocus(h, pane('t1', 'a'));
  assert.equal(h.entries.length, 1, 'a layout push that keeps the focus adds nothing');
  h = recordFocus(h, pane('t2', 'b'));
  h = recordFocus(h, file('C:\\f.md'));
  assert.deepEqual(h.entries, [pane('t1', 'a'), pane('t2', 'b'), file('C:\\f.md')]);
  assert.equal(h.at, 2);
});

test('back and forward walk the list; a move from the middle drops what was ahead', () => {
  let h = emptyFocusHistory();
  for (const e of [pane('t1', 'a'), pane('t2', 'b'), pane('t1', 'c')]) h = recordFocus(h, e);
  assert.equal(nextStop(h, 1, all), null, 'nothing ahead at the end');
  let i = nextStop(h, -1, all);
  assert.equal(i, 1);
  h = stepFocus(h, i!);
  i = nextStop(h, -1, all);
  assert.equal(i, 0);
  h = stepFocus(h, i!);
  assert.equal(nextStop(h, -1, all), null, 'nothing behind at the start');
  assert.equal(nextStop(h, 1, all), 1);
  h = stepFocus(h, 1);
  assert.ok(sameEntry(h.entries[h.at]!, pane('t2', 'b')));
  h = recordFocus(h, pane('t3', 'd'));
  assert.deepEqual(h.entries, [pane('t1', 'a'), pane('t2', 'b'), pane('t3', 'd')], 'the browser rule');
  assert.equal(h.at, 2);
});

test('an entry whose pane or file is gone is stepped over, not dropped', () => {
  let h = emptyFocusHistory();
  for (const e of [pane('t1', 'a'), pane('t1', 'hidden'), file('C:\\closed.md'), pane('t2', 'b')]) h = recordFocus(h, e);
  const alive = (e: FocusEntry) => (e.kind === 'pane' ? e.paneId !== 'hidden' : false);
  assert.equal(nextStop(h, -1, alive), 0, 'two dead entries skipped');
  h = stepFocus(h, 0);
  assert.equal(nextStop(h, 1, alive), 3);
  assert.equal(h.entries.length, 4, 'the dead entries stay for when the pane comes back');
  const dead = () => false;
  assert.equal(nextStop(h, 1, dead), null);
});

test('an entry for the place the focus is on now is stepped over too', () => {
  // A file tab opened from pane b and closed again: the focus lands on b
  // over the dead file entry, and back should go somewhere else.
  let h = emptyFocusHistory();
  for (const e of [pane('t1', 'a'), pane('t2', 'b'), file('C:\\closed.md'), pane('t2', 'b')]) h = recordFocus(h, e);
  const alive = (e: FocusEntry) => e.kind === 'pane';
  assert.equal(nextStop(h, -1, alive), 0);
  assert.equal(nextStop(h, 1, alive), null);
});

test('the list is capped and keeps the newest', () => {
  let h = emptyFocusHistory();
  for (let n = 0; n < FOCUS_HISTORY_CAP + 5; n++) h = recordFocus(h, pane('t', `p${n}`));
  assert.equal(h.entries.length, FOCUS_HISTORY_CAP);
  assert.equal(h.at, FOCUS_HISTORY_CAP - 1);
  assert.deepEqual(h.entries[0], pane('t', 'p5'));
  assert.deepEqual(h.entries[h.at], pane('t', `p${FOCUS_HISTORY_CAP + 4}`));
});

test('stepFocus to the current index hands the same history back', () => {
  const h = recordFocus(emptyFocusHistory(), file('C:\\a'));
  assert.equal(stepFocus(h, 0), h);
});
