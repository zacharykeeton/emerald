import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActivitySession } from '@emerald/shared';
import { addTab, currentTab, defaultLayout, replaceTab, sessionsOnPanes, sessionsOnTab, setPaneSession, splitPane, tabHolding } from '@emerald/shared';
import { nextScope, readScope, scopeWords, scopedSessions, underFolder } from './activity-scope.ts';
import { anActivitySession } from './test-support.ts';

function row(sessionId: string, agentId: string | null = null): ActivitySession {
  return anActivitySession({ sessionId, name: sessionId, kind: agentId === null ? 'claude' : 'agent', parentId: agentId === null ? null : sessionId, agentId });
}

const list = [row('a'), row('a', 'a1'), row('b'), row('gone')];
const source = {
  folders: new Map([
    ['a', { groupCwd: 'C:\\code\\emerald', cwd: 'C:\\code\\emerald\\packages' }],
    ['b', { groupCwd: 'C:\\code\\other', cwd: 'C:\\code\\other' }],
  ]),
  paneIds: new Set(['b']),
};

test('the folder scope keeps the folder sessions and their agents, drops the rest and the unlisted', () => {
  assert.deepEqual(
    scopedSessions(list, 'folder', 'C:/code/emerald', source).map((s) => `${s.sessionId}/${s.agentId ?? ''}`),
    ['a/', 'a/a1'],
  );
  assert.equal(scopedSessions(list, 'folder', 'C:\\code\\emerald\\packages', source).length, 2, 'the live cwd counts as well as the spawn folder');
});

test('the folder scope reads a removed session off its own record, and drops a track with no folders (M9 fix 215)', () => {
  const removed = { ...row('gone'), groupCwd: 'C:\\code\\emerald', cwd: 'C:\\code\\emerald\\packages\\app', removedAt: 5 };
  const moved = { ...row('moved'), groupCwd: 'C:\\code\\other', cwd: 'C:\\code\\emerald\\docs', removedAt: 5 };
  const nameless = { ...row('nameless'), removedAt: null };
  assert.deepEqual(
    scopedSessions([row('a'), removed, moved, nameless], 'folder', 'C:\\code\\emerald', source).map((s) => s.sessionId),
    ['a', 'gone', 'moved'],
  );
  // The store's folders win while the session is listed; the record's
  // are the fallback for a row the store no longer has.
  assert.deepEqual(scopedSessions([{ ...row('b'), groupCwd: 'C:\\code\\emerald', cwd: 'C:\\code\\emerald' }], 'folder', 'C:\\code\\emerald', source), []);
});

test('all and a folderless rail keep everything; the panes scope reads the pane ids', () => {
  assert.equal(scopedSessions(list, 'all', 'C:\\code\\emerald', source).length, 4);
  assert.equal(scopedSessions(list, 'folder', null, source).length, 4);
  assert.deepEqual(scopedSessions(list, 'panes', null, source).map((s) => s.sessionId), ['b']);
});

test('the panes scope off a two-tab layout takes every tab, agents with their parent (M9 fix 250)', () => {
  let n = 0;
  const ids = () => `n${++n}`;
  // Tab one holds a in its pane; tab two, not on show, holds b in one of
  // two panes; gone is on no pane.
  let layout = defaultLayout(ids);
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'a'));
  layout = addTab(layout, ids);
  layout = replaceTab(layout, splitPane(currentTab(layout), 'n3', 'row', ids));
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n5', 'b'));
  const onPanes = { ...source, paneIds: sessionsOnPanes(layout) };
  assert.deepEqual(
    scopedSessions(list, 'panes', 'C:\\code\\emerald', onPanes).map((s) => `${s.sessionId}/${s.agentId ?? ''}`),
    ['a/', 'a/a1', 'b/'],
    "a's agent follows a; gone is dropped",
  );
  assert.deepEqual(scopedSessions(list, 'panes', null, { ...source, paneIds: new Set() }), [], 'nothing on the panes is an empty list, no fallback');
});

test('the here scope off a two-tab layout takes the pane\'s own tab alone, agents with their parent (M9 fix 261)', () => {
  let n = 0;
  const ids = () => `n${++n}`;
  // Tab one holds a in its pane; tab two holds b in one of two panes and
  // the activity pane (n3) in the other; gone is on no pane.
  let layout = defaultLayout(ids);
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'a'));
  layout = addTab(layout, ids);
  layout = replaceTab(layout, splitPane(currentTab(layout), 'n3', 'row', ids));
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n5', 'b'));
  const hereFor = (paneId: string) => ({ ...source, paneIds: sessionsOnPanes(layout), hereIds: sessionsOnTab(tabHolding(layout, paneId)!) });
  assert.deepEqual(
    scopedSessions(list, 'here', 'C:\\code\\emerald', hereFor('n3')).map((s) => s.sessionId),
    ['b'],
    'the activity pane on tab two reads b alone',
  );
  assert.deepEqual(
    scopedSessions(list, 'here', null, hereFor('n1')).map((s) => `${s.sessionId}/${s.agentId ?? ''}`),
    ['a/', 'a/a1'],
    "on tab one it reads a and a's agent",
  );
  assert.deepEqual(scopedSessions(list, 'here', null, source), [], 'a source with no tab ids (the tab form, the rail) reads as none');
});

test('the pill cycles all, folder, panes and round, skipping the folder without one (M9 fix 250)', () => {
  const folder = 'C:\\code\\emerald';
  assert.equal(nextScope('all', folder), 'folder');
  assert.equal(nextScope('folder', folder), 'panes');
  assert.equal(nextScope('panes', folder), 'all');
  assert.equal(nextScope('all', null), 'panes');
  assert.equal(nextScope('panes', null), 'all');
  assert.equal(nextScope('folder', folder, false), 'all', 'without the panes step the toggle is fix 178\'s');
  assert.equal(nextScope('all', folder, false), 'folder');
  assert.equal(nextScope('all', null, false), 'all');
  // M9 fix 261: the fourth step, this tab, after the panes and only
  // where the caller takes it.
  assert.equal(nextScope('panes', folder, true, true), 'here');
  assert.equal(nextScope('here', folder, true, true), 'all');
  assert.equal(nextScope('all', null, true, true), 'panes');
  assert.equal(nextScope('folder', folder, true, true), 'panes');
  assert.equal(nextScope('here', folder, true, false), 'all', 'a here scope on a caller that lost the step still steps on');
  assert.equal(readScope('here'), 'here');
  assert.equal(readScope('tab'), 'panes', "an old record's tab reads as panes");
  assert.equal(readScope('panes'), 'panes');
  assert.equal(readScope('folder'), 'folder');
  assert.equal(readScope(undefined), 'all');
  assert.equal(readScope('zzz'), 'all');
});

test('underFolder ignores slashes, case and a trailing separator, and never matches a sibling prefix', () => {
  assert.ok(underFolder('c:/Code/Emerald/', 'C:\\code\\emerald'));
  assert.ok(underFolder('C:\\code\\emerald\\packages\\app', 'C:\\code\\emerald'));
  assert.ok(!underFolder('C:\\code\\emerald-wt\\x', 'C:\\code\\emerald'));
});

test('the head names the folder or the tab, and nothing for all', () => {
  const name = (f: string) => f.split('\\').pop() ?? f;
  assert.equal(scopeWords('folder', 'C:\\code\\emerald', name), 'emerald');
  assert.equal(scopeWords('folder', null, name), null);
  assert.equal(scopeWords('all', 'C:\\code\\emerald', name), null);
  assert.equal(scopeWords('panes', null, name), 'on the panes');
  assert.equal(scopeWords('here', null, name, 'Panes 2'), 'on Panes 2', 'the here scope names the tab (M9 fix 261)');
  assert.equal(scopeWords('here', null, name), 'on this tab');
});
