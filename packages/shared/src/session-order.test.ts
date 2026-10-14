import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, SessionState } from './session.ts';
import { EXITED_GROUP, compareCreated, compareSessions, folderTitle, formatDuration, groupSessions, isSidebarOrder, rollup, rollupLabel } from './session-order.ts';

function session(id: string, state: SessionState, stateSince: number, spawnCwd = 'C:\\work\\a', createdAt = stateSince): SessionInfo {
  return {
    id,
    kind: 'claude',
    name: id,
    spawnCwd,
    args: [],
    autoName: true,
    branch: null,
    lastPrompt: null,
    lastReply: null,
    cwd: spawnCwd,
    groupCwd: spawnCwd,
    state,
    stateSince,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    conversation: null,
    shellCwd: null,
    commits: [],
    model: null,
    contextPercent: null,
    contextWindow: null,
    tokens: null,
    comment: null,
    phase: null,
    color: '#61afef',
    title: null,
    claudeSessionId: null,
    pid: 1,
    exitCode: null,
    createdAt,
  };
}

test('sort follows the plan: needs-input, errored, done, working, idle, starting, exited', () => {
  const order: SessionState[] = ['needs-input', 'errored', 'done', 'working', 'idle', 'starting', 'exited'];
  const shuffled = [...order].reverse().map((state, i) => session(`s${i}`, state, 1000));
  const sorted = [...shuffled].sort(compareSessions).map((s) => s.state);
  assert.deepEqual(sorted, order);
});

test('needs-input is oldest first, everything else newest first', () => {
  const blockedOld = session('old', 'needs-input', 1000);
  const blockedNew = session('new', 'needs-input', 5000);
  assert.deepEqual([blockedNew, blockedOld].sort(compareSessions).map((s) => s.id), ['old', 'new']);
  const workingOld = session('old', 'working', 1000);
  const workingNew = session('new', 'working', 5000);
  assert.deepEqual([workingOld, workingNew].sort(compareSessions).map((s) => s.id), ['new', 'old']);
});

test('ties break on id so the order is stable', () => {
  const a = session('a', 'idle', 1000);
  const b = session('b', 'idle', 1000);
  assert.equal(compareSessions(a, b), -1);
  assert.equal(compareSessions(b, a), 1);
  assert.equal(compareSessions(a, a), 0);
});

test('groups by groupCwd, orders groups by their most urgent session, exited last', () => {
  const groups = groupSessions(stateOrderSessions, 'state');
  assert.deepEqual(
    groups.map((g) => [g.key, g.sessions.map((s) => s.id)]),
    [
      ['C:\\work\\b', ['blocked-b', 'moved-b']],
      ['C:\\work\\a', ['working-a', 'idle-a']],
      [EXITED_GROUP, ['gone-a']],
    ],
  );
  assert.equal(groups[0]!.title, 'b');
  assert.equal(groups[2]!.title, 'exited');
});

// Made in the order idle-a, blocked-b, moved-b, working-a, gone-a.
const stateOrderSessions: SessionInfo[] = [
  session('idle-a', 'idle', 1000, 'C:\\work\\a'),
  session('blocked-b', 'needs-input', 500, 'C:\\work\\b', 1100),
  session('working-a', 'working', 2000, 'C:\\work\\a', 1300),
  session('gone-a', 'exited', 3000, 'C:\\work\\a', 1400),
  // A shell started in a that cd'd to b: listed under b.
  { ...session('moved-b', 'idle', 1500, 'C:\\work\\a', 1200), cwd: 'C:\\work\\b', groupCwd: 'C:\\work\\b' },
];

test('a session is grouped by groupCwd, not by where it is now (M9 fix 60)', () => {
  // A Claude that entered a worktree: under its repo, the live folder elsewhere.
  const away = { ...session('away', 'working', 1000, 'C:\\repo'), cwd: 'C:\\repo-wt\\fix' };
  const groups = groupSessions([session('home', 'idle', 900, 'C:\\repo'), away]);
  assert.deepEqual(groups.map((g) => [g.key, g.sessions.map((s) => s.id)]), [['C:\\repo', ['home', 'away']]]);
});

test('the created order is the default: oldest first within a group, groups by their oldest session, exited last', () => {
  const groups = groupSessions(stateOrderSessions);
  assert.deepEqual(
    groups.map((g) => [g.key, g.sessions.map((s) => s.id)]),
    [
      ['C:\\work\\a', ['idle-a', 'working-a']],
      ['C:\\work\\b', ['blocked-b', 'moved-b']],
      [EXITED_GROUP, ['gone-a']],
    ],
  );
  assert.deepEqual(groupSessions(stateOrderSessions, 'created'), groups);
});

test('a state change does not move a row in the created order', () => {
  const before = groupSessions(stateOrderSessions).flatMap((g) => g.sessions.map((s) => s.id));
  const changed = stateOrderSessions.map((s) => (s.id === 'working-a' ? { ...s, state: 'needs-input' as const, stateSince: 9000 } : s));
  const after = groupSessions(changed).flatMap((g) => g.sessions.map((s) => s.id));
  assert.deepEqual(after, before);
});

test('compareCreated is oldest first with the id as the tie-break', () => {
  const older = session('b', 'working', 5000, 'C:\\work\\a', 100);
  const newer = session('a', 'needs-input', 100, 'C:\\work\\a', 200);
  assert.deepEqual([newer, older].sort(compareCreated).map((s) => s.id), ['b', 'a']);
  const twinA = session('a', 'idle', 1, 'C:\\work\\a', 100);
  const twinB = session('b', 'idle', 1, 'C:\\work\\a', 100);
  assert.equal(compareCreated(twinB, twinA), 1);
});

test('isSidebarOrder takes the two names and nothing else', () => {
  assert.equal(isSidebarOrder('created'), true);
  assert.equal(isSidebarOrder('state'), true);
  assert.equal(isSidebarOrder('urgent'), false);
  assert.equal(isSidebarOrder(null), false);
});

test('no exited group when nothing has exited', () => {
  const groups = groupSessions([session('a', 'idle', 1)]);
  assert.equal(groups.length, 1);
  assert.notEqual(groups[0]!.key, EXITED_GROUP);
});

test('folderTitle is the last path segment for either slash style', () => {
  assert.equal(folderTitle('C:\\Users\\me\\code\\emerald'), 'emerald');
  assert.equal(folderTitle('C:/Users/me/code/emerald/'), 'emerald');
  assert.equal(folderTitle('C:\\'), 'C:');
  assert.equal(folderTitle(''), '');
});

test('formatDuration picks the largest unit that fits', () => {
  const now = 1_000_000_000;
  assert.equal(formatDuration(now, now), '0s');
  assert.equal(formatDuration(now - 12_000, now), '12s');
  assert.equal(formatDuration(now - 59_999, now), '59s');
  assert.equal(formatDuration(now - 60_000, now), '1m');
  assert.equal(formatDuration(now - 4 * 60_000 - 30_000, now), '4m');
  assert.equal(formatDuration(now - 2 * 3_600_000, now), '2h');
  assert.equal(formatDuration(now - 3 * 86_400_000, now), '3d');
  // A stateSince in the future reads as zero, never negative.
  assert.equal(formatDuration(now + 5000, now), '0s');
});

test('rollup is the most urgent state and how many sessions are in it', () => {
  const group = (...states: SessionState[]) => ({ key: 'k', title: 'k', sessions: states.map((state, i) => session(`s${i}`, state, 1000)) });
  assert.deepEqual(rollup(group('idle', 'needs-input', 'done', 'needs-input')), { state: 'needs-input', count: 2 });
  assert.deepEqual(rollup(group('working', 'done')), { state: 'done', count: 1 });
  assert.deepEqual(rollup(group('errored', 'done', 'errored', 'errored')), { state: 'errored', count: 3 });
  assert.deepEqual(rollup(group('idle', 'working')), { state: 'working', count: 1 });
  assert.equal(rollup(group()), null);
});

test('rollupLabel names the three states a person acts on and nothing else', () => {
  assert.equal(rollupLabel({ state: 'needs-input', count: 1 }), '1 needs input');
  assert.equal(rollupLabel({ state: 'needs-input', count: 2 }), '2 need input');
  assert.equal(rollupLabel({ state: 'done', count: 1 }), '1 done');
  assert.equal(rollupLabel({ state: 'errored', count: 3 }), '3 errored');
  assert.equal(rollupLabel({ state: 'working', count: 4 }), null);
  assert.equal(rollupLabel({ state: 'idle', count: 1 }), null);
  assert.equal(rollupLabel({ state: 'exited', count: 1 }), null);
});

test('a folder label titles its group and the others keep the folder name (M9 fix 194)', () => {
  const labels = new Map([['C:\\work\\a', 'Work']]);
  const groups = groupSessions(stateOrderSessions, 'created', labels);
  assert.deepEqual(
    groups.map((g) => [g.key, g.title]),
    [
      ['C:\\work\\a', 'Work'],
      ['C:\\work\\b', 'b'],
      [EXITED_GROUP, 'exited'],
    ],
  );
  // No map, or a map without the folder, is the folder's name.
  assert.equal(groupSessions(stateOrderSessions)[0]!.title, 'a');
  assert.equal(groupSessions(stateOrderSessions, 'created', new Map())[0]!.title, 'a');
});
