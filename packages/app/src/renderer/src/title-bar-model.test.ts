import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, TeamMember } from '@emerald/shared';
import { addTab, currentTab, defaultLayout, replaceTab, setPaneSession, splitPane, switchTab } from '@emerald/shared';
import { titleCounts, titleSummary } from './title-bar-model.ts';
import { aMember, aSession } from './test-support.ts';

function counter(): () => string {
  let n = 0;
  return () => `n${++n}`;
}

const T0 = 1_000_000;

function session(over: Partial<SessionInfo>): SessionInfo {
  return aSession({ id: 'emerald-1', kind: 'claude', name: 'repo', autoName: true, stateSince: T0, color: '#61afef', claudeSessionId: 'c1', createdAt: T0, ...over });
}

const member = (id: string, outcome: 'running' | 'returned'): TeamMember => aMember({ id, outcome });

test('titleCounts leaves out exited sessions and empty panes, and counts only the tab on show', () => {
  const ids = counter();
  let layout = defaultLayout(ids); // pane n1, tab n2
  layout = replaceTab(layout, splitPane(currentTab(layout), 'n1', 'row', ids)); // pane n3, split n4
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n1', 'a'));
  layout = addTab(layout, ids); // pane n5, tab n6, now on show
  layout = replaceTab(layout, setPaneSession(currentTab(layout), 'n5', 'b'));
  const sessions = [session({ id: 'a', state: 'working' }), session({ id: 'b' }), session({ id: 'c', state: 'exited' })];
  const roll = { agentsActive: 1, agentsInactive: 1, shellsRunning: 0, shellsIdle: 0 };
  assert.deepEqual(titleCounts(sessions, layout), { sessions: 2, panes: 1, roll });
  assert.deepEqual(titleCounts(sessions, switchTab(layout, 'n2')), { sessions: 2, panes: 1, roll });
  assert.deepEqual(titleCounts(sessions, null), { sessions: 2, panes: 0, roll });
});

test('titleSummary reads the mock at four and drops the s at one', () => {
  assert.equal(titleSummary({ sessions: 4, panes: 4 }), '4 sessions, 4 panes on screen');
  assert.equal(titleSummary({ sessions: 1, panes: 1 }), '1 session, 1 pane on screen');
  assert.equal(titleSummary({ sessions: 0, panes: 0 }), '0 sessions, 0 panes on screen');
});

test("the rollup is the headings' four units over every folder, the exited group left out (fix 88)", () => {
  const sessions = [
    session({ id: 'w', state: 'working', team: [member('a', 'running'), member('b', 'returned')] }),
    session({ id: 'x', state: 'working', team: [member('c', 'running')] }),
    session({ id: 's', kind: 'shell', claudeSessionId: null, cwd: 'C:\\other', groupCwd: 'C:\\other' }),
    session({ id: 't', kind: 'shell', claudeSessionId: null }),
    session({ id: 'gone', state: 'exited', team: [member('d', 'running')] }),
  ];
  assert.deepEqual(titleCounts(sessions, null, new Set(['s'])).roll, { agentsActive: 4, agentsInactive: 1, shellsRunning: 1, shellsIdle: 1 });
  // The phrase M46 put in the summary is gone: the unit says it.
  assert.ok(!titleSummary(titleCounts(sessions, null)).includes('agent'));
});
