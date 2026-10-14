import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, TeamMember } from './session.ts';
import { agentsOut, folderRollup, markKind, memberLine, memberParts, rollupLines, rollupText, rollupWords, rosterLines, teamCounts, teamSummary, teamText, teamTitle } from './team.ts';

const T0 = 1_000_000;

function member(over: Partial<TeamMember>): TeamMember {
  return { id: 'a', kind: 'agent', type: null, description: null, command: null, startedAt: T0, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [], activity: null, ...over };
}

function session(over: Partial<SessionInfo>): SessionInfo {
  return {
    id: 'emerald-1',
    kind: 'claude',
    name: 'repo',
    spawnCwd: 'C:\\repo',
    args: [],
    autoName: true,
    branch: null,
    lastPrompt: null,
    lastReply: null,
    cwd: 'C:\\repo',
    groupCwd: 'C:\\repo',
    state: 'idle',
    stateSince: T0,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    model: null,
    contextPercent: null,
    contextWindow: null,
    tokens: null,
    comment: null,
    phase: null,
    color: '#61afef',
    title: null,
    claudeSessionId: 'c1',
    pid: 1,
    exitCode: null,
    createdAt: T0,
    ...over,
  };
}

const out = (id: string) => member({ id });
const returned = (id: string) => member({ id, outcome: 'returned', endedAt: T0 + 4000 });
const shell = (id: string, running = true) => member({ id, kind: 'shell', command: 'npm test', outcome: running ? 'running' : 'returned', endedAt: running ? null : T0 + 9000 });

test('teamCounts: agents out and returned, shells running now and finished this turn', () => {
  assert.deepEqual(teamCounts(session({})), { out: 0, returned: 0, shells: 0, shellsReturned: 0 });
  const s = session({ team: [out('a1'), out('a2'), returned('a3'), shell('s1'), shell('s2', false)] });
  assert.deepEqual(teamCounts(s), { out: 2, returned: 1, shells: 1, shellsReturned: 1 });
  assert.equal(teamText(teamCounts(s)), '✳2 ✳1 ❯1', 'the shell unit is the running count, as Claude Code prints it (fix 101)');
  assert.equal(teamText(teamCounts(session({ team: [returned('a3')] }))), '✳1', 'a unit at zero is left out');
  assert.equal(teamText(teamCounts(session({}))), '');
});

test('teamSummary: the units in words for a folded roster, a zero kind left out', () => {
  assert.equal(teamSummary({ out: 2, returned: 1, shells: 1, shellsReturned: 0 }), '2 out, 1 returned, 1 shell');
  assert.equal(teamSummary({ out: 0, returned: 0, shells: 3, shellsReturned: 2 }), '3 shells');
  assert.equal(teamSummary({ out: 1, returned: 0, shells: 0, shellsReturned: 0 }), '1 out');
  assert.equal(teamSummary({ out: 0, returned: 0, shells: 0, shellsReturned: 0 }), '');
});

test('folderRollup: the note\'s case, a working session with 2 out, a waiting session and 1 returned', () => {
  const working = session({ id: 'w', state: 'working', team: [out('a1'), out('a2')] });
  const waiting = session({ id: 'x', state: 'waiting', team: [returned('a3')] });
  const roll = folderRollup({ sessions: [working, waiting] });
  assert.deepEqual(roll, { agentsActive: 3, agentsInactive: 2, shellsRunning: 0, shellsIdle: 0 });
  assert.equal(rollupText(roll), '✳3 ✳2');
  // A stale working session is still on the heading as on the row.
  assert.equal(folderRollup({ sessions: [session({ state: 'working', stale: true })] }).agentsInactive, 1);
});

test('rollupWords: the units in words, the kind said once, a zero unit left out (fix 88)', () => {
  assert.equal(rollupWords({ agentsActive: 3, agentsInactive: 4, shellsRunning: 1, shellsIdle: 2 }), '3 agents active, 4 idle, 1 shell running, 2 idle');
  assert.equal(rollupWords({ agentsActive: 0, agentsInactive: 1, shellsRunning: 0, shellsIdle: 1 }), '1 agent idle, 1 shell idle');
  assert.equal(rollupWords({ agentsActive: 1, agentsInactive: 0, shellsRunning: 2, shellsIdle: 0 }), '1 agent active, 2 shells running');
  assert.equal(rollupWords({ agentsActive: 0, agentsInactive: 0, shellsRunning: 0, shellsIdle: 0 }), '');
});

test('rosterLines and rollupLines: what each unit shown stands for, one sentence per unit (fix 89)', () => {
  assert.deepEqual(rosterLines({ out: 1, returned: 2, shells: 1, shellsReturned: 1 }), ['1 agent out, working now', '2 agents returned this turn', '1 background shell running now', '1 background shell finished this turn']);
  assert.deepEqual(rosterLines({ out: 2, returned: 0, shells: 1, shellsReturned: 0 }), ['2 agents out, working now', '1 background shell running now']);
  assert.deepEqual(rosterLines({ out: 0, returned: 1, shells: 0, shellsReturned: 2 }), ['1 agent returned this turn', '2 background shells finished this turn']);
  assert.deepEqual(rosterLines({ out: 0, returned: 0, shells: 0, shellsReturned: 0 }), []);
  assert.deepEqual(rollupLines({ agentsActive: 3, agentsInactive: 1, shellsRunning: 1, shellsIdle: 2 }), ['3 agents active', '1 agent idle', '1 shell running a command', '2 shells at their prompt']);
  assert.deepEqual(rollupLines({ agentsActive: 0, agentsInactive: 0, shellsRunning: 0, shellsIdle: 1 }), ['1 shell at its prompt']);
});

test('memberParts splits a member line for the card, the task cut to its first line (fix 89)', () => {
  const out = memberParts(member({ id: 'a1', type: 'Explore', description: 'Find the render sites', startedAt: T0 }), T0 + 6000);
  assert.deepEqual(out, { kind: 'agent', working: true, type: 'agent Explore', elapsed: 'out 6s', task: 'Find the render sites', activity: null });
  const back = memberParts(member({ id: 'a2', outcome: 'returned', startedAt: T0, endedAt: T0 + 40_000 }), T0 + 60_000);
  assert.deepEqual(back, { kind: 'agent', working: false, type: 'agent', elapsed: 'returned after 40s', task: null, activity: null });
  const sh = memberParts(member({ id: 's1', kind: 'shell', command: 'npm run build\nnpm test', startedAt: T0 + 5000 }), T0 + 6000);
  assert.deepEqual(sh, { kind: 'shell', working: true, type: 'shell', elapsed: 'running 1s', task: 'npm run build', activity: null });
  assert.equal(memberLine(member({ id: 's1', kind: 'shell', command: 'npm run build', startedAt: T0 }), T0 + 1000), 'shell · running 1s · npm run build');
  // M65: the agent's activity line joins the member line after the task.
  assert.equal(memberLine(member({ id: 'a3', type: 'fork', description: 'the lanes', startedAt: T0, activity: 'Reading README.md' }), T0 + 1000), 'agent fork · out 1s · the lanes · Reading README.md');
  // M9 fix 289: the model word, already resolved by the caller, sits
  // right after the type; absent (the default) it is left out as before.
  assert.equal(memberLine(member({ id: 'a3', type: 'fork', description: 'the lanes', startedAt: T0 }), T0 + 1000, 'Opus'), 'agent fork · Opus · out 1s · the lanes');
  assert.equal(memberLine(member({ id: 's1', kind: 'shell', command: 'npm run build', startedAt: T0 }), T0 + 1000, null), 'shell · running 1s · npm run build');
});

test('folderRollup: shells are the plain shell sessions and the Stop-listed ones, running by the set the renderer passes', () => {
  const plain = session({ id: 'p', kind: 'shell', claudeSessionId: null });
  const paused = session({ id: 'q', state: 'waiting', team: [shell('s1')] });
  assert.deepEqual(folderRollup({ sessions: [plain, paused] }), { agentsActive: 0, agentsInactive: 1, shellsRunning: 1, shellsIdle: 1 });
  assert.deepEqual(folderRollup({ sessions: [plain, paused] }, new Set(['p'])), { agentsActive: 0, agentsInactive: 1, shellsRunning: 2, shellsIdle: 0 });
  // A shell that has started claude is an agent until Claude leaves.
  assert.deepEqual(folderRollup({ sessions: [session({ kind: 'shell', claudeSessionId: 'c9', state: 'working' })] }), { agentsActive: 1, agentsInactive: 0, shellsRunning: 0, shellsIdle: 0 });
  // A background shell that finished is on the roster card, not the heading (M9 fix 122, the row's fix 101 rule).
  const finished = session({ id: 'r', state: 'done', team: [shell('s2', false), shell('s3')] });
  assert.deepEqual(folderRollup({ sessions: [finished] }), { agentsActive: 0, agentsInactive: 1, shellsRunning: 1, shellsIdle: 0 });
  assert.equal(rollupText({ agentsActive: 3, agentsInactive: 2, shellsRunning: 1, shellsIdle: 1 }), '✳3 ✳2 ❯1 ❯1');
  assert.equal(rollupText({ agentsActive: 0, agentsInactive: 0, shellsRunning: 0, shellsIdle: 2 }), '❯2');
});

test('folderRollup equals the sum over its rows', () => {
  const rows = [
    session({ id: 'a', state: 'working', team: [out('a1'), shell('s1')] }),
    session({ id: 'b', kind: 'shell', claudeSessionId: null }),
    session({ id: 'c', state: 'done', team: [returned('a2'), returned('a3'), shell('s2', false)] }),
    session({ id: 'd', state: 'needs-input' }),
  ];
  const running = new Set(['b']);
  const whole = folderRollup({ sessions: rows }, running);
  const sum = { agentsActive: 0, agentsInactive: 0, shellsRunning: 0, shellsIdle: 0 };
  for (const row of rows) {
    const one = folderRollup({ sessions: [row] }, running);
    for (const k of Object.keys(sum) as Array<keyof typeof sum>) sum[k] += one[k];
  }
  assert.deepEqual(whole, sum);
  assert.deepEqual(whole, { agentsActive: 2, agentsInactive: 4, shellsRunning: 2, shellsIdle: 0 });
});

test('markKind: a Claude session, a shell with an id bound, or a shell a hook has reached, else a plain shell', () => {
  assert.equal(markKind(session({})), 'claude');
  assert.equal(markKind(session({ kind: 'shell', claudeSessionId: 'c1' })), 'claude');
  assert.equal(markKind(session({ kind: 'shell', claudeSessionId: null, lastEventAt: T0 })), 'claude');
  assert.equal(markKind(session({ kind: 'shell', claudeSessionId: null })), 'shell');
  // On the heading the same rule: the reached shell is an inactive agent.
  assert.deepEqual(folderRollup({ sessions: [session({ kind: 'shell', claudeSessionId: null, lastEventAt: T0, state: 'needs-input' })] }), { agentsActive: 0, agentsInactive: 1, shellsRunning: 0, shellsIdle: 0 });
});

test('agentsOut sums what is still out over every session', () => {
  assert.equal(agentsOut([session({ team: [out('a1'), returned('a2')] }), session({ team: [out('b1'), shell('s1')] }), session({})]), 2);
  assert.equal(agentsOut([]), 0);
});

test('teamTitle lists the members in spawn order with the kind, the type, the time and the task', () => {
  const members = [
    member({ id: 'a1', type: 'Explore', description: 'Find the render sites', startedAt: T0 }),
    member({ id: 'a2', type: null, outcome: 'returned', startedAt: T0, endedAt: T0 + 40_000 }),
    member({ id: 's1', kind: 'shell', command: 'npm run verify:m9', startedAt: T0 + 5000 }),
  ];
  assert.equal(teamTitle(members, T0 + 6000), 'agent Explore · out 6s · Find the render sites\nagent · returned after 40s\nshell · running 1s · npm run verify:m9');
  assert.equal(teamTitle([], T0), '');
});
