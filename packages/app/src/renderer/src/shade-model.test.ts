import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentTab, defaultLayout, setPaneSession, splitPane } from '@emerald/shared';
import { SHADE_AFTER_CHOICES, shadeActivity, shadeAfterLabel, shadeWait, shadeablePanes, shouldAutoShade } from './shade-model.ts';
import { aSession } from './test-support.ts';

const MIN = 60_000;
const T0 = 1_000_000;
const rest = (state: 'idle' | 'done' | 'exited' = 'done', stateSince = T0) => ({ state, stateSince });
const pane = (over: Partial<Parameters<typeof shouldAutoShade>[1]> = {}) => ({ focused: false, shaded: false, lastInputAt: null, liftedAtStateSince: null, ...over });

test('shouldAutoShade: a resting session past the setting with no key into the pane', () => {
  assert.equal(shouldAutoShade(rest(), pane(), 2, T0 + 2 * MIN), true);
  assert.equal(shouldAutoShade(rest('idle'), pane(), 2, T0 + 2 * MIN), true);
  assert.equal(shouldAutoShade(rest('exited'), pane(), 2, T0 + 2 * MIN), true);
  // Not yet.
  assert.equal(shouldAutoShade(rest(), pane(), 2, T0 + 2 * MIN - 1), false);
  // A fraction of a minute counts, for a script.
  assert.equal(shouldAutoShade(rest(), pane(), 0.05, T0 + 3000), true);
});

test('shouldAutoShade: off, focused, already shaded, or a session that is not at rest', () => {
  assert.equal(shouldAutoShade(rest(), pane(), 0, T0 + 60 * MIN), false);
  assert.equal(shouldAutoShade(rest(), pane({ focused: true }), 2, T0 + 60 * MIN), false);
  assert.equal(shouldAutoShade(rest(), pane({ shaded: true }), 2, T0 + 60 * MIN), false);
  for (const state of ['working', 'waiting', 'needs-input', 'starting', 'errored'] as const) {
    assert.equal(shouldAutoShade({ state, stateSince: T0 }, pane(), 2, T0 + 60 * MIN), false, state);
  }
});

test('shouldAutoShade: a key into the pane restarts the clock, and a lift holds until the state moves', () => {
  assert.equal(shouldAutoShade(rest(), pane({ lastInputAt: T0 + MIN }), 2, T0 + 2 * MIN), false);
  assert.equal(shouldAutoShade(rest(), pane({ lastInputAt: T0 + MIN }), 2, T0 + 3 * MIN), true);
  // Lifted during this rest: never again while stateSince stands.
  assert.equal(shouldAutoShade(rest(), pane({ liftedAtStateSince: T0 }), 2, T0 + 60 * MIN), false);
  // The state moved since the lift: the clock runs again.
  assert.equal(shouldAutoShade(rest('done', T0 + 5 * MIN), pane({ liftedAtStateSince: T0 }), 2, T0 + 7 * MIN), true);
});

test('shadeablePanes: the panes on a session, not the empty one', () => {
  let n = 0;
  const ids = () => `n${++n}`;
  const layout = defaultLayout(ids);
  let tab = currentTab(layout);
  tab = setPaneSession(tab, tab.focusedPaneId, 'a');
  const first = tab.focusedPaneId;
  tab = splitPane(tab, first, 'row', ids);
  const second = tab.focusedPaneId;
  assert.deepEqual(shadeablePanes(tab), [first]);
  tab = setPaneSession(tab, second, 'b');
  assert.deepEqual(shadeablePanes(tab).sort(), [first, second].sort());
});

test('shadeWait (M9 fix 434): needs-input off the record alone, a finished reply only while the pulse is armed for this pane', () => {
  assert.deepEqual(shadeWait({ state: 'needs-input' }, undefined), { kind: 'waiting' });
  // A needs-input row draws whether or not this pane's pulse is still
  // armed (fix 231's original reason: a stale pulse must not hide it).
  assert.deepEqual(shadeWait({ state: 'needs-input' }, 'done'), { kind: 'waiting' });
  assert.deepEqual(shadeWait({ state: 'done' }, 'done'), { kind: 'done' });
  // Acknowledged (the pane's pulse cleared): the row goes even though the
  // record still reads done, so it never counts up forever.
  assert.equal(shadeWait({ state: 'done' }, undefined), null);
  assert.equal(shadeWait({ state: 'working' }, undefined), null);
  assert.equal(shadeWait({ state: 'errored' }, 'errored'), null, 'errored is an age on the row, not a wait');
});

test('shadeActivity (M9 fix 654): the row line under the state word, never before a prompt and never twice', () => {
  const claude = { kind: 'claude' as const, lastPrompt: 'build the lid' };
  assert.equal(shadeActivity(aSession({ ...claude, lastPrompt: null, state: 'working', liveTool: 'Build the lid' }), 'working'), null);
  assert.equal(shadeActivity(aSession({ ...claude, state: 'working', liveTool: 'Build the lid' }), 'working'), 'Build the lid');
  assert.equal(shadeActivity(aSession({ ...claude, state: 'done', lastReply: 'lid built' }), 'done'), 'lid built');
  assert.equal(shadeActivity(aSession({ ...claude, state: 'needs-input', needsInputReason: 'permission', liveTool: 'Editing a.ts' }), 'Allow? Editing a.ts'), null);
  assert.equal(shadeActivity(aSession({ ...claude, state: 'idle' }), 'idle'), null);
});

test('the menu choices and their labels', () => {
  assert.deepEqual(SHADE_AFTER_CHOICES, [0, 2, 5, 15, 30]);
  assert.equal(shadeAfterLabel(0), 'Off');
  assert.equal(shadeAfterLabel(15), '15 min');
});
