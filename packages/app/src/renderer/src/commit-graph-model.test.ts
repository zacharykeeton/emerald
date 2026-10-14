import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_PREFIX, PERSON_PREFIX, REMOTE_PREFIX, agentLabel, agentRole, commitsTheBarSitsBelow, historyIdOf, holdGraph, laneAgents, laneSessions, memberTint, personNameOf, remoteBranchOf, remoteIdsByRecord, remoteOnlyCommits, sessionGraph, spanIdOf, spanIds, spanSessions, underFolder } from './commit-graph-model.ts';
import type { CommitItem, GraphSession } from './commit-graph-model.ts';
import type { GraphCommit, HistoryTranscript } from '../../preload/api.ts';
import { COLOR_FLOOR, SESSION_COLORS, colorDistance, colorForKey, farthestSessionColor, hueOf, oklabOf } from '@emerald/shared';
import type { TeamMember } from '@emerald/shared';

// Fixtures are newest first in date order, as git log --date-order
// gives them. The graph reads owners for the blocks (M65) and parents
// for the lanes inside a block (M68); a fixture with no parents draws
// each block's commits on its trunk with no segments between them.
const c = (hash: string, refs: string[] = [], claudeSession: string | null = null, parents: string[] = []): GraphCommit => ({ hash, parents, refs, subject: hash, author: 'x', at: 0, authoredAt: 0, claudeSession });

const member = (over: Partial<TeamMember>): TeamMember => ({ id: 'a', kind: 'agent', type: 'fork', description: null, command: null, startedAt: 0, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [], activity: null, ...over });

// A fixture session is a shell in the repo (no row of its own, M68), so
// the M65 pictures read as they did; a test about the session's own row
// makes it a Claude session with `claude`.
const ROOTS = ['C:/repo'];
const session = (over: Partial<GraphSession> & { id: string }): GraphSession => ({ name: over.id, color: '#123456', commits: [], team: [], removedAt: null, remoteSessionId: null, createdAt: 0, branch: null, kind: 'shell', claudeSessionId: null, lastEventAt: null, state: 'idle', cwd: 'C:/repo', spawnCwd: 'C:/repo', startHead: null, groupCwd: over.spawnCwd ?? 'C:/repo', ...over });
const claude = (over: Partial<GraphSession> & { id: string }): GraphSession => session({ kind: 'claude', branch: 'main', ...over });

const claim = (hashes: string[]) => hashes.map((hash) => ({ hash, at: 1 }));

// The rows as text: an agent row is its member id with the lane (~ for
// a commit-less worktree), a commit row its hash with the lane; the
// lines as kind, lane and rows (b for the bottom, ~ for dashed).
const picture = (g: ReturnType<typeof sessionGraph>) => g.items.map((it) => (it.kind === 'agent' ? `${it.member?.id ?? `own:${it.sessionId}`}${it.pending ? '~' : ''}${it.startRow !== null ? '^' : ''}@${it.lane}` : `${it.commit.hash}@${it.lane}`));
const dotsOf = (g: ReturnType<typeof sessionGraph>) => g.dots.map((d) => `${d.sessionId}@${d.lane}:${d.row}`);
const wires = (g: ReturnType<typeof sessionGraph>) => g.lines.map((l) => `${l.kind}:${l.lane}:${l.fromRow}-${l.toRow === 'bottom' ? 'b' : l.toRow}${l.toLane === null ? '' : `>${l.toLane}`}${l.dashed ? '~' : ''}`);

test('sessionGraph: commits sit on the lane of the session that made them, main is not a lane, outsiders go in a grey block at the end', () => {
  // Two sessions both commit to main; one commit nobody made.
  const commits = [c('e', ['main']), c('d'), c('x'), c('b'), c('a')];
  const s1 = session({ id: 's1', commits: claim(['e', 'b']) });
  const s2 = session({ id: 's2', color: '#00ff00', commits: claim(['d', 'a']) });
  const g = sessionGraph(commits, [s1, s2], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['e@0', 'd@1', 'x@2', 'b@0', 'a@1']);
  assert.deepEqual(g.lanes.map((l) => `${l.slot}:${l.block}:${l.sessionId}`), ['0:0:s1', '1:1:s2', '2:2:null']);
  assert.deepEqual(wires(g), ['session:0:0-3', 'session:1:1-4'], "each line from the session's newest commit to its oldest, through the rows between");
  const x = g.items[2]!;
  assert.ok(x.kind === 'commit' && x.sessionId === null, 'x has no session');
});

test('sessionGraph: a subagent worktree is a lane of its own in the parent block, its agent a row above its newest commit with the pending stretch and the merge-back into the parent line', () => {
  const commits = [c('p3', ['main'], null, ['p2']), c('w2', ['wt'], null, ['w1']), c('w1', [], null, ['p2']), c('p2', [], null, ['p1']), c('p1')];
  const parent = session({ id: 'p', commits: claim(['p3', 'p2', 'p1', 'w2', 'w1']), team: [member({ id: 'a1', branch: 'wt', commits: claim(['w1', 'w2']) })] });
  const g = sessionGraph(commits, [parent], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['p3@0', 'a1@1', 'w2@1', 'w1@1', 'p2@0', 'p1@0']);
  assert.deepEqual(wires(g), ['worktree:1:2-3', 'branch:1:3-4>0', 'session:0:0-5', 'pending:1:1-2~'], 'the worktree runs its commits and curves into the commit it forked from');
  const agent = g.items[1]!;
  assert.ok(agent.kind === 'agent' && agent.tipRow === 2 && !agent.pending);
  assert.deepEqual(g.lanes.map((l) => `${l.slot}:${l.block}:${l.memberId}:${l.branch}`), ['0:0:null:null', '1:0:a1:wt']);
});

test("sessionGraph (M9 fix 138): a member's commits folded into the record once it left the team keep its lane in the block, with no agent row; the pill's agent is read the same way", () => {
  // The M61 shape with the member dropped and its commits on the
  // session's own list with the agent on them.
  const commits = [c('p3', ['main'], null, ['p2']), c('w2', ['wt'], null, ['w1']), c('w1', [], null, ['p2']), c('p2', [], null, ['p1']), c('p1')];
  const agent = { id: 'a1', branch: 'wt', type: 'fork', description: 'the lane' };
  const own = [...claim(['p3', 'p2', 'p1']), { hash: 'w1', at: 1, agent }, { hash: 'w2', at: 2, agent }];
  const parent = session({ id: 'p', commits: own });
  const g = sessionGraph(commits, [parent], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['p3@0', 'w2@1', 'w1@1', 'p2@0', 'p1@0'], 'the worktree commits on a lane of their own, no row above them');
  assert.deepEqual(wires(g), ['worktree:1:1-2', 'branch:1:2-3>0', 'session:0:0-4'], 'the worktree line and its curve into the fork point, no pending stretch');
  assert.deepEqual(g.lanes.map((l) => `${l.slot}:${l.block}:${l.memberId}:${l.branch}`), ['0:0:null:null', '1:0:a1:wt'], "the lane carries the member's id and branch off the folded commits");
  assert.equal(g.items.find((it): it is CommitItem => it.kind === 'commit' && it.commit.hash === 'w2')?.memberId, 'a1');
  // A removed session keeps the lane the same way.
  const gone = sessionGraph(commits, [{ ...parent, removedAt: 5 }], 'graph', ROOTS);
  assert.deepEqual(picture(gone), ['p3@0', 'w2@1', 'w1@1', 'p2@0', 'p1@0']);
  // The pill on the worktree branch names the agent off the folded commits too.
  const agents = laneAgents(['wt'], [{ id: 'p', branch: 'main', color: '#123456', state: 'idle', team: [], commits: own }]);
  assert.deepEqual(agents.get('wt'), { sessionId: 'p', memberId: 'a1', label: 'the lane', working: false, color: '#123456' });
  // The live team wins over a folded copy of the same id.
  const live = session({ id: 'p', commits: own, team: [member({ id: 'a1', branch: 'wt', commits: claim(['w1', 'w2']) })] });
  assert.deepEqual(picture(sessionGraph(commits, [live], 'graph', ROOTS)), ['p3@0', 'a1@1', 'w2@1', 'w1@1', 'p2@0', 'p1@0'], 'the row is back while the member is on the team');
});

test('sessionGraph: a commit-less worktree forks dashed out of the commit its branch sits on, whatever lane that is; a fan off one commit is one row each', () => {
  // The plan on main fans out two agents off p2; a third agent forked off
  // the worktree commit w1 of the first (its branch sits on w1).
  const commits = [c('p3', ['main']), c('w1', ['wt1', 'wt3']), c('p2', ['wt2', 'wt4']), c('p1')];
  const parent = session({
    id: 'p',
    commits: claim(['p3', 'p2', 'p1', 'w1']),
    team: [member({ id: 'a1', branch: 'wt1', startedAt: 1, commits: claim(['w1']) }), member({ id: 'a2', branch: 'wt2', startedAt: 2 }), member({ id: 'a3', branch: 'wt3', startedAt: 3 }), member({ id: 'a4', branch: 'wt4', startedAt: 4 })],
  });
  const g = sessionGraph(commits, [parent], 'graph', ROOTS);
  // The commit-less members' lanes sit right after the session's line
  // and the walk's lane with w1 on it after them (M9 fix 374), so a2,
  // a3 and a4 are lanes 1 to 3 by start and a1's worktree lane is 4.
  assert.deepEqual(picture(g), ['p3@0', 'a3~@2', 'a1@4', 'w1@4', 'a2~@1', 'a4~@3', 'p2@0', 'p1@0']);
  const a3 = g.items[1]!;
  assert.ok(a3.kind === 'agent' && a3.pending && a3.forkRow === 3 && a3.forkLane === 4, 'a3 forks out of w1 on the worktree lane');
  assert.deepEqual(wires(g), ['session:0:0-7', 'fork:1:4-6>0~', 'fork:2:1-3>4~', 'fork:3:5-6>0~', 'merge:4:3-6>0', 'pending:4:2-3~'], "w1's fork point is not in the log, so M65's merge-back into the line below stands");
});

test("sessionGraph (M9 fix 150): an agent with no worktree has a lane of its own too, forking dashed into the parent's line at its newest commit; one before any commit sits at the top; a session with agents and nothing in the log has a block", () => {
  // Until fix 150 the explore agent sat on the parent's own line, over
  // its star; now only the session's own row is on the straight line.
  const commits = [c('p2', ['main']), c('p1')];
  const parent = session({ id: 'p', commits: claim(['p2', 'p1']), team: [member({ id: 'explore', type: 'Explore' })] });
  const fresh = session({ id: 'f', color: '#ff0000', createdAt: 5, team: [member({ id: 'a1' }), member({ id: 'a2', branch: 'wt', startedAt: 2 })] });
  const g = sessionGraph(commits, [parent, fresh], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['a1~@3', 'a2~@4', 'explore~@1', 'p2@0', 'p1@0']);
  assert.deepEqual(g.lanes.map((l) => `${l.slot}:${l.block}:${l.sessionId}:${l.memberId}:${l.branch}`), ['0:0:p:null:null', '1:0:p:explore:null', '2:1:f:null:null', '3:1:f:a1:null', '4:1:f:a2:wt'], 'a lane per member, by start, branch or none');
  assert.deepEqual(wires(g), ['session:0:3-4', 'fork:1:2-3>0~'], "the explore lane bends into the parent's line at p2, its fork point being where the session sits; nothing to draw for the fresh session yet");
  const explore = g.items[2]!;
  assert.ok(explore.kind === 'agent' && explore.pending && explore.forkRow === 3 && explore.forkLane === 0 && explore.tipRow === null, 'a commit-less member is pending whether or not it has a branch');
  assert.ok(g.items.every((it) => it.kind !== 'agent' || it.member === null || it.lane !== 0), "nothing of a member's on the parent's lane");
  // A member that gains a branch keeps its lane: a3 started between the
  // two, and its branch arriving moves nothing.
  const three = session({ id: 'f', color: '#ff0000', createdAt: 5, team: [member({ id: 'a1' }), member({ id: 'a3', startedAt: 1 }), member({ id: 'a2', branch: 'wt', startedAt: 2 })] });
  const lanesOf = (s: GraphSession) => sessionGraph(commits, [parent, s], 'graph', ROOTS).lanes.map((l) => `${l.slot}:${l.memberId}`);
  assert.deepEqual(lanesOf(three), ['0:null', '1:explore', '2:null', '3:a1', '4:a3', '5:a2']);
  const named = { ...three, team: three.team.map((m) => (m.id === 'a3' ? { ...m, branch: 'wt3' } : m)) };
  assert.deepEqual(lanesOf(named), ['0:null', '1:explore', '2:null', '3:a1', '4:a3', '5:a2'], 'the same lanes once a3 has a branch');
  // In the list a member with no worktree sits on the parent's line, as
  // every row does there.
  const list = sessionGraph(commits, [parent], 'list', ROOTS);
  assert.deepEqual(picture(list), ['explore~@0', 'p2@0', 'p1@0']);
  assert.deepEqual(wires(list), ['session:0:1-2', 'pending:0:0-1~']);
});

test("sessionGraph (M9 fix 150): a branchless member of a session with no commit forks into the start bar's row on the session's lane; under a shell with no row its lane ends under a bar", () => {
  const commits = [c('m2', ['main']), c('m1')];
  const fresh = claude({ id: 'f', color: '#ff0000', createdAt: 5, team: [member({ id: 'a1' })] });
  const g = sessionGraph(commits, [fresh], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['a1~@1', 'own:f^@0', 'm2@2', 'm1@2']);
  assert.deepEqual(wires(g), ['start:0:1-2~', 'fork:1:0-2>0~', 'outside:2:2-3'], "the member's fork lands on lane 0, where the bar is");
  assert.deepEqual(dotsOf(g), ['f@0:2']);
  // A shell in the repo on main with an agent out and no row of its own
  // (a shell that ran claude and left): nothing on lane 0 to land on, so
  // the lane ends under a bar at the tip's row (M9 fix 145).
  const shell = session({ id: 's', branch: 'main', team: [member({ id: 'a1' })] });
  const g2 = sessionGraph(commits, [shell], 'graph', ROOTS);
  assert.deepEqual(picture(g2), ['a1~@1', 'm2@2', 'm1@2']);
  assert.deepEqual(wires(g2), ['fork:1:0-1~', 'outside:2:1-2']);
  assert.deepEqual(dotsOf(g2), ['s@1:1']);
});

test("sessionGraph (M9 fix 374): a commit-less member's lane is the parent's plus one, before the walk's lanes, so its fork is a short bend beside the line rather than a line across every worktree lane", () => {
  // The rail on 2026-09-21: a Sonnet subagent with no commit sat seven
  // lanes out from its parent, its dashed fork a straight line across
  // every lane between, landing on the parent's bare line. Here one
  // worktree lane with a commit and one commit-less member with no
  // branch: the member is lane 1, the worktree lane 2.
  const commits = [c('w1', ['wt'], null, ['o1']), c('o1', ['main'], null, ['o0']), c('o0')];
  const parent = claude({ id: 'p', createdAt: 5, commits: claim(['o1', 'o0']), team: [member({ id: 'a1', branch: 'wt', startedAt: 1, commits: claim(['w1']) }), member({ id: 'idle', startedAt: 2 })] });
  const g = sessionGraph(commits, [parent], 'graph', ROOTS, 'main');
  assert.deepEqual(g.lanes.map((l) => `${l.slot}:${l.memberId}`), ['0:null', '1:idle', '2:a1'], "the commit-less member's lane right after the parent's line, the worktree lane after it");
  assert.deepEqual(picture(g), ['a1@2', 'w1@2', 'idle~@1', 'own:p@0', 'o1@0', 'o0@0']);
  const idle = g.items[2]!;
  assert.ok(idle.kind === 'agent' && idle.pending && idle.lane === 1 && idle.forkRow === 4 && idle.forkLane === 0, "the member forks into the parent's line at o1 from the lane beside it");
  assert.deepEqual(wires(g), ['branch:2:1-4>0', 'session:0:4-5', 'pending:0:3-4~', 'fork:1:2-4>0~', 'pending:2:0-1~']);
  // The same lanes once the member has a branch and still no commit:
  // its slot is by start (M9 fix 150), and the walk's lane keeps its
  // place after it.
  const named = { ...parent, team: parent.team.map((m) => (m.id === 'idle' ? { ...m, branch: 'wt-idle' } : m)) };
  assert.deepEqual(sessionGraph(commits, [named], 'graph', ROOTS, 'main').lanes.map((l) => `${l.slot}:${l.memberId}`), ['0:null', '1:idle', '2:a1']);
});

test('sessionGraph: the list is the same rows on one lane per session, the line from the newest commit to the oldest under a dashed stretch, no forks and no merges', () => {
  const commits = [c('p3', ['main']), c('w2', ['wt']), c('w1'), c('x'), c('p2'), c('p1')];
  const parent = session({ id: 'p', commits: claim(['p3', 'p2', 'p1', 'w2', 'w1']), team: [member({ id: 'a1', branch: 'wt', commits: claim(['w1', 'w2']) }), member({ id: 'a2', branch: 'wt2' })] });
  const graph = sessionGraph(commits, [parent], 'graph', ROOTS);
  const list = sessionGraph(commits, [parent], 'list', ROOTS);
  assert.equal(graph.items.length, list.items.length, 'the same rows');
  assert.deepEqual(
    list.items.map((it) => it.kind),
    graph.items.map((it) => it.kind),
    'in the same order',
  );
  assert.deepEqual(picture(list), ['a2~@0', 'p3@0', 'a1@0', 'w2@0', 'w1@0', 'x@1', 'p2@0', 'p1@0'], 'a2, with a branch the log has no ref for, sits above the parent line');
  assert.deepEqual(list.lanes.map((l) => `${l.slot}:${l.block}:${l.sessionId}`), ['0:0:p', '1:1:null']);
  // M9 fix 118: the stretch above the newest commit is dashed in the
  // list as in the graph; a1's own stretch sits inside the solid line.
  assert.deepEqual(wires(list), ['session:0:1-7', 'pending:0:0-1~'], 'one line per session from its newest commit down to its oldest, the dashed stretch above it, and a lone outsider draws no line');
});

test('sessionGraph: a removed session is marked gone (M57), the trailer owns a commit (M58)', () => {
  const commits = [c('t', ['main'], 'session_r2'), c('b'), c('a')];
  const s1 = session({ id: 's1', color: '#56b6c2', commits: claim(['a']) });
  const s2 = session({ id: 's2', color: '#61afef', commits: claim(['b']), removedAt: 9 });
  const s3 = session({ id: 's3', color: '#e06c75', remoteSessionId: 'session_r2' });
  const g = sessionGraph(commits, [s1, s2, s3], 'graph', ROOTS);
  // M71: s3 on row 0 and s1 on row 2 are a row apart, so they share a
  // column; s2 on row 1 touches both and sits beside.
  assert.deepEqual(picture(g), ['t@0', 'b@1', 'a@0']);
  assert.deepEqual(
    g.lanes.map((l) => `${l.sessionId}:${l.gone}`),
    ['s3:false', 's2:true', 's1:false'],
  );
});

test("sessionGraph (M68): a live Claude session with no commit is a row above the tip of its branch, a straight start stretch and a dot of its own on that row; a shell gets none", () => {
  const commits = [c('m2', ['main']), c('m1')];
  const fresh = claude({ id: 'f', color: '#ff0000', createdAt: 5 });
  const shell = session({ id: 'sh', createdAt: 6 });
  const g = sessionGraph(commits, [fresh, shell], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['own:f^@0', 'm2@1', 'm1@1']);
  assert.deepEqual(g.lanes.map((l) => `${l.slot}:${l.block}:${l.sessionId}`), ['0:0:f', '1:1:null'], 'the session block before the grey one, no block for the shell');
  assert.deepEqual(wires(g), ['start:0:0-1~', 'outside:1:1-2'], 'the stretch down to the tip, no session line');
  assert.deepEqual(dotsOf(g), ['f@0:1'], "the mark on main's tip row");
  assert.deepEqual(g.dots.map((d) => d.shape), ['bar'], 'a start is a bar (M9 fix 145)');
  const own = g.items[0]!;
  assert.ok(own.kind === 'agent' && own.member === null && own.startRow === 1 && !own.pending && !own.working, 'the row is the session own, idle');
});

test('sessionGraph (M68): six new sessions off one tip read as six lanes with six dots on one row, newest session first, and nothing below', () => {
  const commits = [c('m1', ['main'])];
  const sessions = [1, 2, 3, 4, 5, 6].map((n) => claude({ id: `s${n}`, createdAt: n }));
  const g = sessionGraph(commits, sessions, 'graph', ROOTS);
  assert.deepEqual(picture(g), ['own:s6^@5', 'own:s5^@4', 'own:s4^@3', 'own:s3^@2', 'own:s2^@1', 'own:s1^@0', 'm1@6']);
  assert.equal(g.lanes.length, 7);
  assert.deepEqual(dotsOf(g).sort(), ['s1@0:6', 's2@1:6', 's3@2:6', 's4@3:6', 's5@4:6', 's6@5:6']);
  assert.ok(g.lines.every((l) => l.kind === 'start' && l.toRow === 6), 'six start stretches and no other line');
});

test("sessionGraph (M68): a new session's commit-less members fork into its own dot, not into main's lane; a member of a session with commits still forks into the parent commit's lane", () => {
  const commits = [c('m1', ['main', 'wt1', 'wt2', 'wt3'])];
  const fresh = claude({ id: 'f', createdAt: 5, team: [member({ id: 'a1', branch: 'wt1', startedAt: 1 }), member({ id: 'a2', branch: 'wt2', startedAt: 2 })] });
  const g = sessionGraph(commits, [fresh], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['a1~@1', 'a2~@2', 'own:f^@0', 'm1@3'], "the members' rows above the session's own, all above the tip");
  assert.deepEqual(wires(g), ['start:0:2-3~', 'fork:1:0-3>0~', 'fork:2:1-3>0~'], 'both forks land on lane 0, where the dot is');
  assert.deepEqual(dotsOf(g), ['f@0:3']);
  // The same members under a session that has committed on the line:
  // the fork lands on the lane the tip commit sits on, as M65 drew it.
  const commits2 = [c('p1', ['main', 'wt3'])];
  const parent = claude({ id: 'p', createdAt: 5, commits: claim(['p1']), team: [member({ id: 'a3', branch: 'wt3', startedAt: 1 })] });
  const g2 = sessionGraph(commits2, [parent], 'graph', ROOTS);
  assert.deepEqual(picture(g2), ['a3~@1', 'own:p@0', 'p1@0']);
  assert.deepEqual(wires(g2), ['pending:0:1-2~', 'fork:1:0-2>0~'], 'one commit is a dot with no line below it');
  assert.deepEqual(dotsOf(g2), [], 'no dot for a session with a commit of its own');
});

test("sessionGraph (M68): the session's first commit turns the start row into a tip row with a session line; a worktree lane merges back into the start dot, and not at all into an empty line", () => {
  const before = [c('m1', ['main'])];
  const fresh = claude({ id: 'f', createdAt: 5 });
  assert.deepEqual(wires(sessionGraph(before, [fresh], 'graph', ROOTS)), ['start:0:0-1~']);
  const after = [c('f1', ['main']), c('m1')];
  const committed = claude({ id: 'f', createdAt: 5, commits: claim(['f1']) });
  const g = sessionGraph(after, [committed], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['own:f@0', 'f1@0', 'm1@1']);
  assert.deepEqual(wires(g), ['pending:0:0-1~'], 'the pending stretch above the commit, and no line below a single commit');
  assert.deepEqual(dotsOf(g), []);
  // A member committed in its worktree while the session itself has
  // not: the worktree lane runs its commits and curves back into the
  // session's start dot on main's tip row.
  const fan = [c('w2', ['wt'], null, ['w1']), c('w1', [], null, ['m1']), c('m1', ['main'])];
  const parent = claude({ id: 'p', createdAt: 5, team: [member({ id: 'a1', branch: 'wt', commits: claim(['w1', 'w2']) })] });
  const g3 = sessionGraph(fan, [parent], 'graph', ROOTS);
  assert.deepEqual(picture(g3), ['a1@1', 'w2@1', 'w1@1', 'own:p^@0', 'm1@2']);
  assert.deepEqual(wires(g3), ['worktree:1:1-2', 'branch:1:2-4>0', 'start:0:3-4~', 'pending:1:0-1~'], "the branch curves into the session's lane at the bar's row, since w1's parent is in the log in the grey block (M9 fix 145)");
  assert.deepEqual(dotsOf(g3), ['p@0:4']);
  // The same with the session's branch not in the log: no dot, no line
  // to join, so no merge-back and the lane ends at its oldest commit.
  const detached = claude({ id: 'p', createdAt: 5, branch: null, team: [member({ id: 'a1', branch: 'wt', commits: claim(['w1', 'w2']) })] });
  const g4 = sessionGraph(fan, [detached], 'graph', ROOTS);
  assert.deepEqual(picture(g4), ['own:p@0', 'a1@1', 'w2@1', 'w1@1', 'm1@2'], 'the own row at the top');
  assert.deepEqual(wires(g4), ['worktree:1:2-3', 'worktree:1:3-4', 'pending:1:1-2~'], "the lane runs on to m1's row and ends under a bar there, since the session has no line to join (M9 fix 145)");
  assert.deepEqual(dotsOf(g4), ['p@1:4']);
  // Two sessions taking turns on main: each one's own commits stay on
  // its line, though the chain runs through the other's block.
  const turns = [c('b2', ['main'], null, ['a2']), c('a2', [], null, ['b1']), c('b1', [], null, ['a1']), c('a1')];
  const sa = session({ id: 'a', commits: claim(['a2', 'a1']) });
  const sb = session({ id: 'b', color: '#00ff00', commits: claim(['b2', 'b1']) });
  const g5 = sessionGraph(turns, [sa, sb], 'graph', ROOTS);
  assert.deepEqual(picture(g5), ['b2@0', 'a2@1', 'b1@0', 'a1@1']);
  assert.deepEqual(wires(g5), ['session:0:0-2', 'session:1:1-3'], 'no edge crosses a block');
});

test('sessionGraph (M9 fix 185): a record with two conversation spans is two blocks of its colour, each with its own start bar and the commits claimed while it was open; one span or none is the one block it was', () => {
  // Started on m1, committed s1 and s2, /clear on s2, then s3 and s4 in
  // the new conversation.
  const commits = [c('s4', ['main'], null, ['s3']), c('s3', [], null, ['s2']), c('s2', [], null, ['s1']), c('s1', [], null, ['m1']), c('m1')];
  const spans = [
    { conversation: 'conv-a', remoteSessionId: 'session_a', startedAt: 0, endedAt: 50, startHead: 'm1' },
    { conversation: 'conv-b', remoteSessionId: null, startedAt: 50, endedAt: null, startHead: 's2' },
  ];
  const claims = [{ hash: 's1', at: 10 }, { hash: 's2', at: 20 }, { hash: 's3', at: 60 }, { hash: 's4', at: 70 }];
  const r = claude({ id: 'r', name: 'emerald', createdAt: 0, commits: claims, startHead: 'm1', claudeSessionId: 'conv-b', spans });
  const drawn = spanSessions([r]);
  assert.deepEqual(drawn.map((s) => [s.id, s.name, s.state, s.claudeSessionId, s.remoteSessionId, s.startHead, s.commits.map((x) => x.hash)]), [
    ['r#span1', 'emerald', 'exited', 'conv-a', 'session_a', 'm1', ['s1', 's2']],
    ['r', 'emerald (2)', 'idle', 'conv-b', null, 's2', ['s3', 's4']],
  ]);
  assert.deepEqual(spanIdOf('r#span1'), { sessionId: 'r', ordinal: 1 });
  assert.equal(spanIdOf('r'), null);
  assert.deepEqual(spanIds(r), ['r#span1']);
  const g = sessionGraph(commits, [r], 'graph', ROOTS);
  assert.deepEqual(g.blocks.map((b) => [b.sessionId, b.color]), [['r', '#123456'], ['r#span1', '#123456'], [null, null]], "two blocks, the live one first by its newest commit, both the record's colour, then the outside block for m1");
  assert.deepEqual(picture(g), ['own:r@0', 's4@0', 's3@0', 's2@1', 's1@1', 'm1@2']);
  assert.deepEqual(wires(g), ['session:0:1-3', 'pending:0:0-1~', 'session:1:3-5'], "the live block's line runs from s4 down to its start on s2; the earlier span's from s2 down to its start on m1");
  assert.deepEqual(g.dots.map((d) => `${d.kind}:${d.sessionId}:${d.row}`), ['start:r:3', 'start:r#span1:5'], 'a start bar each');
  // A record with one span, or a record from before the field, is the one
  // block it was, off its own fields.
  const one = claude({ id: 'o', createdAt: 0, commits: claims, startHead: 'm1', spans: [spans[1]!] });
  assert.deepEqual(spanSessions([one]), [one]);
  const none = claude({ id: 'n', createdAt: 0, commits: claims, startHead: 'm1' });
  assert.deepEqual(spanSessions([none]), [none]);
  assert.equal(sessionGraph(commits, [none], 'graph', ROOTS).blocks.length, 2, 'one block and the outside one');
});

test('sessionGraph (M9 fix 400): a commit claimed before the first conversation opened sits on the record own live block, below its start bar, not inside the first conversation', () => {
  // A shell opened at 09:00 and committed p1 at 10:00 through the fix
  // 195 path; the person typed claude at 11:00, which made s1, and
  // cleared at 12:00, which made s2.
  const commits = [c('s2', ['main'], null, ['s1']), c('s1', [], null, ['p1']), c('p1', [], null, ['m1']), c('m1')];
  const spans = [
    { conversation: 'conv-a', remoteSessionId: null, startedAt: 11_000, endedAt: 12_000, startHead: 'p1' },
    { conversation: 'conv-b', remoteSessionId: null, startedAt: 12_000, endedAt: null, startHead: 's1' },
  ];
  const claims = [{ hash: 'p1', at: 10_000 }, { hash: 's1', at: 11_500 }, { hash: 's2', at: 12_500 }];
  const r = claude({ id: 'r', name: 'emerald', createdAt: 9_000, commits: claims, startHead: null, claudeSessionId: 'conv-b', spans });
  assert.deepEqual(spanSessions([r]).map((s) => [s.id, s.startHead, s.commits.map((x) => x.hash)]), [
    ['r#span1', 'p1', ['s1']],
    ['r', 's1', ['p1', 's2']],
  ], "p1 is the live block's, and the first conversation keeps only what it made");
  const g = sessionGraph(commits, [r], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['own:r@0', 's2@0', 's1@1', 'p1@0', 'm1@2'], "p1 on the record's own lane, below the conversation that came after it");
  assert.deepEqual(g.dots.map((d) => `${d.kind}:${d.sessionId}:${d.row}`), ['start:r:2', 'start:r#span1:3'], "the live block's start bar stays on its own startHead, s1, though p1 sits below it");
  assert.deepEqual(wires(g), ['session:0:1-3', 'pending:0:0-1~', 'session:1:2-3'], "the live block's line runs past its start bar down to p1, so the commit below the bar reads as from before Claude");
  // A claim older than the one span of a record with a single span has
  // nowhere else to go and stays where it was.
  const one = claude({ id: 'o', createdAt: 9_000, commits: claims, startHead: 's1', spans: [spans[1]!] });
  assert.deepEqual(spanSessions([one]), [one]);
  // A record with no spans (M9 fix 443) keeps today's reading: every
  // commit guards the bar, since there is no before-the-first-conversation
  // to speak of.
  const noSpans = claude({ id: 'z', createdAt: 0, commits: claim(['a', 'b']) });
  assert.deepEqual(commitsTheBarSitsBelow(noSpans), new Set(['a', 'b']));
});

test("sessionGraph (M9 fix 117): a session's line runs down to the commit it started on with a dot there; a start outside the log or above the oldest own commit stops at the oldest; a record with no start draws as before; the empty case dots on the start commit rather than the moved tip", () => {
  // The session started on m2 (main's tip then), read a while, then made
  // s1 and s2; another session put x on main in between.
  const commits = [c('s2', ['main'], null, ['s1']), c('s1', [], null, ['x']), c('x', [], null, ['m2']), c('m2', [], null, ['m1']), c('m1')];
  const started = claude({ id: 's', createdAt: 5, commits: claim(['s2', 's1']), startHead: 'm2' });
  const g = sessionGraph(commits, [started], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['own:s@0', 's2@0', 's1@0', 'x@1', 'm2@1', 'm1@1']);
  assert.deepEqual(wires(g), ['session:0:1-4', 'pending:0:0-1~', 'outside:1:3-5'], 'the line runs from s2 past s1 to the start row, solid');
  assert.deepEqual(dotsOf(g), ['s@0:4'], "a mark on the session's lane at m2's row");
  assert.deepEqual(g.dots.map((d) => d.shape), ['bar'], 'the start is a bar (M9 fix 145)');
  const own = g.items[0]!;
  assert.ok(own.kind === 'agent' && own.member === null && own.tipRow === 1 && own.startRow === null, 'the own row is still the tip kind above s2');
  // The same in the list: one lane per session, the same stretch and dot.
  const l = sessionGraph(commits, [started], 'list', ROOTS);
  assert.deepEqual(wires(l), ['session:0:1-4', 'pending:0:0-1~', 'outside:1:3-5'], 'the list line reaches the start row too, dashed above the newest commit (M9 fix 118)');
  assert.deepEqual(dotsOf(l), ['s@0:4']);
  // A start commit the log no longer holds: the line stops at s1 as before.
  const older = claude({ id: 's', createdAt: 5, commits: claim(['s2', 's1']), startHead: 'zz' });
  assert.deepEqual(wires(sessionGraph(commits, [older], 'graph', ROOTS)), ['session:0:1-2', 'pending:0:0-1~', 'outside:1:3-5']);
  assert.deepEqual(dotsOf(sessionGraph(commits, [older], 'graph', ROOTS)), []);
  // A record from before the daemon kept the start: the same, no guess.
  const legacy = claude({ id: 's', createdAt: 5, commits: claim(['s2', 's1']) });
  assert.deepEqual(wires(sessionGraph(commits, [legacy], 'graph', ROOTS)), ['session:0:1-2', 'pending:0:0-1~', 'outside:1:3-5']);
  // A start above the oldest own commit (a rebase put the commits under
  // it) draws nothing more.
  const rebased = claude({ id: 's', createdAt: 5, commits: claim(['x', 'm2']), startHead: 's1' });
  const gr = sessionGraph(commits, [rebased], 'graph', ROOTS);
  assert.deepEqual(wires(gr).filter((w) => w.startsWith('session')), ['session:0:3-4'], 'x to m2 only');
  // No start bar; the bar there is the head bar under the row (M9 fix
  // 151), since main's head s2 is nobody's here.
  assert.deepEqual(gr.dots.map((d) => `${d.kind}:${d.row}`), ['head:1']);
  // A session with no commit yet keeps its start bar on its start
  // commit, not on the tip its branch has moved to since; its row sits
  // over that tip (M9 fix 151), with a head bar there and the stretch
  // running on down to the start bar, solid under the head bar (M9 fix
  // 176: dashed is the air above the head, and under it has landed).
  const fresh = claude({ id: 'f', createdAt: 5, startHead: 'm2' });
  const gf = sessionGraph(commits, [fresh], 'graph', ROOTS);
  assert.deepEqual(picture(gf), ['own:f^@0', 's2@1', 's1@1', 'x@1', 'm2@1', 'm1@1']);
  assert.deepEqual(wires(gf), ['pending:0:0-1~', 'start:0:1-4', 'outside:1:1-5']);
  assert.deepEqual(gf.dots.map((d) => `${d.kind}:${d.lane}:${d.row}`), ['head:0:1', 'start:0:4']);
});

test('sessionGraph (M68): a session in another repository has no block, agents out or not; a removed or exited session keeps its lane by its commits alone', () => {
  const commits = [c('m1', ['main'])];
  const elsewhere = claude({ id: 'e', cwd: 'D:/other', spawnCwd: 'D:/other', team: [member({ id: 'a1', branch: 'x' })] });
  const removed = claude({ id: 'r', removedAt: 9, commits: claim(['m1']) });
  const exited = claude({ id: 'x', state: 'exited' });
  const g = sessionGraph(commits, [elsewhere, removed, exited], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['m1@0']);
  assert.deepEqual(g.lanes.map((l) => l.sessionId), ['r']);
  assert.deepEqual(wires(g), [], 'one commit, no line');
  // A shell that ran claude (its id bound) counts as Claude, as the
  // sidebar's star does.
  const shellClaude = session({ id: 'sc', claudeSessionId: 'abc', branch: 'main' });
  assert.deepEqual(picture(sessionGraph(commits, [shellClaude], 'graph', ROOTS)), ['own:sc^@0', 'm1@1']);
  // A worktree of the repository counts as in it.
  const inWt = claude({ id: 'w', cwd: 'C:/repo-wt/fix', spawnCwd: 'C:/repo-wt/fix' });
  assert.deepEqual(picture(sessionGraph(commits, [inWt], 'graph', ['C:/repo', 'C:/repo-wt/fix'])), ['own:w^@0', 'm1@1']);
  assert.deepEqual(picture(sessionGraph(commits, [inWt], 'graph', ROOTS)), ['m1@0']);
  // M9 fix 148: a shell opened in the repository that ran claude in
  // another one is grouped there by the sidebar and is that
  // repository's on the graph too, whatever its spawn folder.
  const moved = session({ id: 'mv', claudeSessionId: 'def', branch: 'main', spawnCwd: 'C:/repo', cwd: 'D:/other', groupCwd: 'D:/other' });
  assert.deepEqual(picture(sessionGraph(commits, [moved], 'graph', ROOTS)), ['m1@0'], 'no block on the spawn folder alone');
  assert.deepEqual(picture(sessionGraph(commits, [moved], 'graph', ['D:/other'])), ['own:mv^@0', 'm1@1'], 'a block where it is grouped');
  // A Claude session that entered a worktree keeps its repository's
  // group, and a live folder under a root counts on its own.
  const wandered = claude({ id: 'wd', cwd: 'C:/repo-wt/fix', groupCwd: 'C:/repo' });
  assert.deepEqual(picture(sessionGraph(commits, [wandered], 'graph', ['C:/repo-wt/fix'])), ['own:wd^@0', 'm1@1']);
});

test('sessionGraph (M68): inside a block the lanes follow the parents: a merged branch on a side lane with its merge and fork curves, the trunk straight through, two overlapping branches on two lanes and the second freeing below its fork', () => {
  // main: M2 merges y (y1 off B), B merges x (x2, x1 off A), A. In date
  // order: M2, y1, B, x2, x1, A. Nobody in emerald made them.
  const commits = [c('M2', ['main'], null, ['B', 'y1']), c('y1', ['y'], null, ['B']), c('B', [], null, ['A', 'x2']), c('x2', ['x'], null, ['x1']), c('x1', [], null, ['A']), c('A')];
  const g = sessionGraph(commits, [], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g), ['M2@0', 'y1@1', 'B@0', 'x2@1', 'x1@1', 'A@0'], 'the trunk on lane 0, y on lane 1, then x on lane 1 once y has folded in');
  assert.deepEqual(wires(g), ['merge:1:1-0>0', 'branch:1:1-2>0', 'merge:1:3-2>0', 'outside:1:3-4', 'branch:1:4-5>0', 'outside:0:0-5']);
  assert.equal(g.lanes.length, 2);
  // The same log with the default branch's tip not the newest commit:
  // the trunk waits for it and the newer branch takes a side lane.
  const later = [c('z1', ['z'], null, ['B']), c('B', ['main'], null, ['A', 'x1']), c('x1', ['x'], null, ['A']), c('A')];
  const g2 = sessionGraph(later, [], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g2), ['z1@1', 'B@0', 'x1@1', 'A@0'], "main's chain is the trunk, z beside it");
  assert.deepEqual(wires(g2), ['branch:1:0-1>0', 'merge:1:2-1>0', 'branch:1:2-3>0', 'outside:0:1-3']);
  // Without a default branch the newest commit is the trunk.
  const g3 = sessionGraph(later, [], 'graph', ROOTS);
  assert.deepEqual(picture(g3), ['z1@0', 'B@0', 'x1@1', 'A@0'], "the newest commit heads the trunk and main's tip sits on it below");
  // A parent outside the block draws nothing: a session's commit on top
  // of the grey history, and its members' lane merging at its own merge
  // commit.
  const mine = [c('S', ['main'], null, ['M2', 'w2']), c('w2', ['wt'], null, ['w1']), c('w1', [], null, ['M2']), c('M2')];
  const parent = session({ id: 'p', commits: claim(['S', 'w2', 'w1']), team: [member({ id: 'a1', branch: 'wt', commits: claim(['w1', 'w2']) })] });
  const g4 = sessionGraph(mine, [parent], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g4), ['S@0', 'a1@1', 'w2@1', 'w1@1', 'M2@2']);
  assert.deepEqual(wires(g4), ['merge:1:2-0>0', 'worktree:1:2-3', 'branch:1:3-4>0', 'session:0:0-4', 'pending:1:1-2~'], "the worktree curves up into the session's merge commit and down into the session's line at M2's row, which the line reaches (M9 fix 145); no merge-back is promised for a merged branch");
  assert.deepEqual(dotsOf(g4), [], 'no bar: the fork point is on the line');
  // With main's tip a session's, the grey trunk is main's history below
  // it (the first grey commit down the tip's first parents), not the
  // newest grey commit.
  const history = [c('S', ['main'], null, ['B']), c('z2', ['z'], null, ['z1']), c('z1', [], null, ['A']), c('B', [], null, ['A']), c('A')];
  const g5 = sessionGraph(history, [session({ id: 'p', commits: claim(['S']) })], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g5), ['S@0', 'z2@2', 'z1@2', 'B@1', 'A@1'], "B and A on the grey trunk, z beside them");
});

test("sessionGraph (M9 fix 131): a member's commit on top of the session's own, with no own commit above, leaves the session's chain on the trunk and bends into it; the commit-less members fork off the trunk too", () => {
  // The screenshot's shape: the session made o0 then o1 on main, a
  // member committed w1 on wt off o1, and two more members have
  // worktrees cut at o1 with nothing in them yet. Newest first: w1, o1,
  // o0. The member's commit used to reserve o1 on its own side lane and
  // take the session's whole chain with it, the star a lane to the left
  // with nothing under it.
  const commits = [c('w1', ['wt'], null, ['o1']), c('o1', ['main', 'wt2', 'wt3'], null, ['o0']), c('o0')];
  const parent = claude({ id: 'p', createdAt: 5, commits: claim(['o1', 'o0']), team: [member({ id: 'a1', branch: 'wt', startedAt: 1, commits: claim(['w1']) }), member({ id: 'a2', branch: 'wt2', startedAt: 2 }), member({ id: 'a3', branch: 'wt3', startedAt: 3 })] });
  const g = sessionGraph(commits, [parent], 'graph', ROOTS, 'main');
  // The two commit-less members take lanes 1 and 2, beside the line,
  // and a1's worktree lane is 3 (M9 fix 374).
  assert.deepEqual(picture(g), ['a1@3', 'w1@3', 'a2~@1', 'a3~@2', 'own:p@0', 'o1@0', 'o0@0'], "the own commits on lane 0 under the session's own row, the member's commit on lane 3");
  assert.deepEqual(wires(g), ['branch:3:1-5>0', 'session:0:5-6', 'pending:0:4-5~', 'fork:1:2-5>0~', 'fork:2:3-5>0~', 'pending:3:0-1~'], "w1's line bends into lane 0 at o1, the own row straight above o1, both forks out of lane 0");
  const own = g.items[4]!;
  assert.ok(own.kind === 'agent' && own.member === null && own.lane === 0 && own.tipRow === 5, 'the own row is the tip row above o1 on the trunk');
  assert.deepEqual(g.lanes.map((l) => `${l.slot}:${l.memberId}`), ['0:null', '1:a2', '2:a3', '3:a1']);
  // The same with an own commit above the member's: the trunk is taken
  // by then, so the picture is M68's, unchanged.
  const above = [c('o2', ['main'], null, ['o1']), c('w1', ['wt'], null, ['o1']), c('o1', [], null, ['o0']), c('o0')];
  const g2 = sessionGraph(above, [claude({ id: 'p', createdAt: 5, commits: claim(['o2', 'o1', 'o0']), team: [member({ id: 'a1', branch: 'wt', commits: claim(['w1']) })] })], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g2), ['own:p@0', 'o2@0', 'a1@1', 'w1@1', 'o1@0', 'o0@0']);
  assert.deepEqual(wires(g2), ['branch:1:3-4>0', 'session:0:1-5', 'pending:0:0-1~', 'pending:1:2-3~']);
  // A lane a merge reserved for its second parent holds: the merge
  // commit's first parent is in another block, so the trunk waits under
  // it, and the merged branch keeps its side lane and the merge curve
  // rather than sliding onto the trunk (the verify script's history
  // block opened up: HM merges HB1, both off another session's C4).
  const merged = [c('HM', ['main'], null, ['C4', 'HB1']), c('HB1', ['hb'], null, ['C4']), c('C4', [], null, [])];
  const sh = session({ id: 'h', commits: claim(['HM', 'HB1']) });
  const sc = session({ id: 'c', color: '#00ff00', commits: claim(['C4']) });
  const g3 = sessionGraph(merged, [sh, sc], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g3), ['HM@0', 'HB1@1', 'C4@2'], 'the merged branch beside the merge commit, not under it');
  assert.deepEqual(wires(g3), ['merge:1:1-0>0', 'branch:1:1-2>0', 'session:0:0-2'], "the merge curve out of HM into the branch lane, and the branch into the session's line at C4's row, the line reaching it (M9 fix 145)");
});

test("sessionGraph (M9 fix 151): the session's row sits over the head of its branch and its stretch reaches that commit: a member's commit main was fast-forwarded to, its own newest commit, someone else's on top under a head bar, or its newest own commit when it has no branch", () => {
  // The batch 145 shape in small: the session made P, its member b made
  // X on x and the session merged it as M; member a made W1 on fb,
  // merged main into it as W2 and made D, and main was fast-forwarded
  // to D. The session's chain M, P is the second-parent side of W2, so
  // M draws on a side lane; the star sits over D, main's head, and its
  // stretch bends into a's lane onto D rather than ending in the air
  // over M's lane.
  const ff = [c('D', ['main', 'fb'], null, ['W2']), c('W2', [], null, ['W1', 'M']), c('W1', [], null, ['P']), c('M', [], null, ['P', 'X']), c('X', ['x'], null, ['P']), c('P', [], null, ['Z']), c('Z')];
  const s = claude({ id: 's', createdAt: 5, commits: claim(['P', 'M']), startHead: 'Z', team: [member({ id: 'a', branch: 'fb', startedAt: 1, commits: claim(['W1', 'W2', 'D']) }), member({ id: 'b', branch: 'x', startedAt: 2, commits: claim(['X']) })] });
  const g = sessionGraph(ff, [s], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g), ['own:s@0', 'a@1', 'D@1', 'W2@1', 'W1@1', 'M@2', 'b@3', 'X@3', 'P@0', 'Z@4'], "the star at the top over D, the session's own merge M on a side lane");
  assert.deepEqual(wires(g), ['worktree:1:2-3', 'worktree:1:3-4', 'merge:2:5-3>1', 'branch:1:4-8>0', 'branch:2:5-8>0', 'merge:3:7-5>2', 'branch:3:7-8>0', 'session:0:8-9', 'pending:0:0-2>1~', 'pending:1:1-2~', 'pending:3:6-7~'], "the star's stretch bends into lane 1 onto D");
  assert.deepEqual(dotsOf(g), ['s@0:9'], 'the start bar alone');
  const own = g.items[0]!;
  assert.ok(own.kind === 'agent' && own.member === null && own.tipRow === 2 && own.tipLane === 1 && own.restRow === null, "the own row's tip is D's row on lane 1");
  // The list: one lane, the same rows, the stretch straight.
  assert.deepEqual(wires(sessionGraph(ff, [s], 'list', ROOTS, 'main')), ['session:0:2-9', 'pending:0:0-2~', 'pending:0:1-2~']);
  // The head is the session's own newest commit: as before.
  const own2 = [c('S2', ['main'], null, ['S1']), c('S1', [], null, ['Z']), c('Z')];
  const g2 = sessionGraph(own2, [claude({ id: 's', createdAt: 5, commits: claim(['S2', 'S1']), startHead: 'Z' })], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g2), ['own:s@0', 'S2@0', 'S1@0', 'Z@1']);
  assert.deepEqual(wires(g2), ['session:0:1-3', 'pending:0:0-1~']);
  assert.deepEqual(g.dots.map((d) => d.kind), ['start']);
  // Someone else's commit O on main over the session's: the star sits
  // over O, its stretch ends under a head bar on the session's lane at
  // O's row and goes on down to S2, solid from the bar (M9 fix 176),
  // the line below unchanged.
  const other = [c('O', ['main'], null, ['S2']), c('S2', [], null, ['S1']), c('S1', [], null, ['Z']), c('Z')];
  const sOther = claude({ id: 's', createdAt: 5, commits: claim(['S2', 'S1']), startHead: 'Z' });
  const g3 = sessionGraph(other, [sOther], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g3), ['own:s@0', 'O@1', 'S2@0', 'S1@0', 'Z@1']);
  assert.deepEqual(wires(g3), ['session:0:2-4', 'pending:0:0-1~', 'pending:0:1-2', 'outside:1:1-4'], "the stretch to O's row, then on to S2 solid");
  assert.deepEqual(g3.dots.map((d) => `${d.kind}:${d.lane}:${d.row}`), ['head:0:1', 'start:0:4'], "a head bar at O's row, the start bar at Z's");
  // A member with no branch forks into the head bar's row (M9 fix 150).
  const g4 = sessionGraph(other, [{ ...sOther, team: [member({ id: 'e' })] }], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g4), ['e~@1', 'own:s@0', 'O@2', 'S2@0', 'S1@0', 'Z@2']);
  assert.deepEqual(wires(g4), ['session:0:3-5', 'pending:0:1-2~', 'pending:0:2-3', 'fork:1:0-2>0~', 'outside:2:2-5']);
  // No branch (a detached checkout): the newest own commit anchors, as before.
  const g5 = sessionGraph(other, [{ ...sOther, branch: null }], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g5), ['O@1', 'own:s@0', 'S2@0', 'S1@0', 'Z@1']);
  assert.deepEqual(wires(g5), ['session:0:2-4', 'pending:0:1-2~', 'outside:1:0-4']);
  assert.deepEqual(g5.dots.map((d) => d.kind), ['start']);
  // A session with no commit whose start is under someone else's O: the
  // star over O, the head bar, and the start stretch on down to the
  // start bar, one lane in one piece; with O its start, as before.
  const fresh = [c('O', ['main'], null, ['Z']), c('Z')];
  const g6 = sessionGraph(fresh, [claude({ id: 'f', createdAt: 5, startHead: 'Z' })], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g6), ['own:f^@0', 'O@1', 'Z@1']);
  assert.deepEqual(wires(g6), ['pending:0:0-1~', 'start:0:1-2', 'outside:1:1-2']);
  assert.deepEqual(g6.dots.map((d) => `${d.kind}:${d.row}`), ['head:1', 'start:2']);
  const g7 = sessionGraph(fresh, [claude({ id: 'f', createdAt: 5, startHead: 'O' })], 'graph', ROOTS, 'main');
  assert.deepEqual(wires(g7), ['start:0:0-1~', 'outside:1:1-2']);
  assert.deepEqual(g7.dots.map((d) => d.kind), ['start']);
  // Two sessions on main both sit over its head, S2, which is s's own:
  // t's row goes on top with a head bar on its lane at S2's row and its
  // stretch on down to T1, and s's member stays next to s's own row
  // under it rather than t's row falling between them.
  const two = [c('S2', ['main'], null, ['T1']), c('T1', [], null, ['S1']), c('S1', [], null, ['Z']), c('Z')];
  const st = claude({ id: 's', createdAt: 5, commits: claim(['S2', 'S1']), team: [member({ id: 'e' })] });
  const tt = claude({ id: 't', color: '#00ff00', createdAt: 6, commits: claim(['T1']) });
  const g8 = sessionGraph(two, [st, tt], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g8), ['own:t@2', 'e~@1', 'own:s@0', 'S2@0', 'T1@2', 'S1@0', 'Z@3']);
  assert.deepEqual(wires(g8), ['session:0:3-5', 'pending:0:2-3~', 'fork:1:1-3>0~', 'pending:2:0-3~', 'pending:2:3-4'], "t's stretch to S2's row and on to T1 solid, e's fork into s's line at S2");
  assert.deepEqual(g8.dots.map((d) => `${d.kind}:${d.sessionId}:${d.lane}:${d.row}`), ['head:t:2:3']);
});

test("sessionGraph (M9 fix 144): the trunk is never handed out as a free lane once its chain has left the block, and a merged branch keeps its lane down to its last commit in the block", () => {
  // The emerald log of 2026-09-14 in small: session y made T on top of its
  // merge M of branch b (b2, b1), whose first parent r2 is session r's;
  // r committed r2 and r1 on main over y's own y2 and y1, and every
  // chain reaches r's F, which sits on y's y0. Date order interleaves
  // b1 between y2 and y1. The trunk's reservation for M is spent when M
  // is placed, and its first parent being r's left lane 0 empty for the
  // rest of that step, so b2 was reserved on the trunk: b drew as the
  // trunk, y2 opened a side lane, and y1 fell back onto the waiting
  // trunk, which read as y's own line forking off b and stopping at y2.
  const commits = [c('T', ['main'], null, ['M']), c('M', [], null, ['r2', 'b2']), c('b2', ['b'], null, ['b1']), c('r2', [], null, ['r1']), c('r1', [], null, ['y2']), c('y2', [], null, ['y1']), c('b1', [], null, ['F']), c('y1', [], null, ['F']), c('F', [], null, ['y0']), c('y0')];
  const y = session({ id: 'y', commits: claim(['T', 'M', 'b2', 'b1', 'y2', 'y1', 'y0']) });
  const r = session({ id: 'r', color: '#00ff00', commits: claim(['r2', 'r1', 'F']) });
  const g = sessionGraph(commits, [y, r], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g), ['T@0', 'M@0', 'b2@1', 'r2@2', 'r1@2', 'y2@0', 'b1@1', 'y1@0', 'F@2', 'y0@0'], "y's own chain on its trunk through r's rows, b on a side lane to its last commit");
  assert.deepEqual(wires(g), ['merge:1:2-1>0', 'worktree:1:2-6', 'branch:1:6-8>0', 'session:0:0-9', 'session:2:3-8'], "the merge curve out of M into b, b straight down to b1 and into y's line at F's row (M9 fix 145), which y's chain passes through");
  // The other half of the rule: a reserved commit whose first parent is
  // in the block still takes the waiting trunk, since it is the fork
  // point of a chain that ran through another block (M merges s1, r's
  // r1 sits between M and the fork point o on main).
  const forked = [c('M', ['main'], null, ['r1', 's1']), c('s1', ['s'], null, ['o']), c('r1', [], null, ['o']), c('o', [], null, ['o0']), c('o0')];
  const g2 = sessionGraph(forked, [session({ id: 'y', commits: claim(['M', 's1', 'o', 'o0']) }), session({ id: 'r', color: '#00ff00', commits: claim(['r1']) })], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g2), ['M@0', 's1@1', 'r1@2', 'o@0', 'o0@0']);
  assert.deepEqual(wires(g2), ['merge:1:1-0>0', 'branch:1:1-3>0', 'session:0:0-4'], 's forks off o on the trunk and merges into M');
});

test('sessionGraph (M68): the list gives a new session one lane with its start row and dot, its members on the same lane, no curves', () => {
  const commits = [c('m1', ['main', 'wt1'])];
  const fresh = claude({ id: 'f', createdAt: 5, team: [member({ id: 'a1', branch: 'wt1' })] });
  const g = sessionGraph(commits, [fresh], 'list', ROOTS);
  assert.deepEqual(picture(g), ['a1~@0', 'own:f^@0', 'm1@1']);
  assert.deepEqual(wires(g), ['pending:0:0-2~', 'start:0:1-2~'], "the member's dashed stretch over the session's, both down to the dot row (M9 fix 118)");
  assert.deepEqual(dotsOf(g), ['f@0:2']);
});

test("sessionGraph (M9 fix 145): a branch forked from another block's commit curves into the session's line at that row with no node there, the lane held across the rows between, and a member's fork off such a commit lands on lane 0 too", () => {
  // Session a made A1 on A0. Session b started on A1: it made B0 on A1,
  // a branch x (X1 off A1, X2) merged as BM, and Y on A0 off its own
  // chain. Date order puts Y between X1 and A1.
  const commits = [c('BM', ['main'], null, ['B0', 'X2']), c('X2', ['x'], null, ['X1']), c('B0', [], null, ['A1']), c('X1', [], null, ['A1']), c('Y', ['y'], null, ['A0']), c('A1', [], null, ['A0']), c('A0')];
  const a = session({ id: 'a', commits: claim(['A1', 'A0']) });
  const b = session({ id: 'b', color: '#00ff00', commits: claim(['BM', 'X2', 'B0', 'X1', 'Y']) });
  const g = sessionGraph(commits, [a, b], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g), ['BM@0', 'X2@1', 'B0@0', 'X1@1', 'Y@2', 'A1@3', 'A0@3'], "x holds its lane down to A1's row, so Y takes a third lane rather than x's; A1 and A0 are a's alone");
  assert.deepEqual(wires(g), ['merge:1:1-0>0', 'worktree:1:1-3', 'branch:1:3-5>0', 'branch:2:4-6>0', 'session:0:0-6', 'session:3:5-6'], "x curves into b's line at A1's row and Y into it at A0's row, both on b's ancestry, and b's line reaches A0's row");
  assert.deepEqual(dotsOf(g), [], 'no bars, since every fork point is on the line');
  assert.deepEqual(g.items.filter((it) => it.kind === 'commit' && it.lane === 0).map((it) => (it as { commit: GraphCommit }).commit.hash), ['BM', 'B0'], "nothing of b's sits on a's rows");
  // A commit-less member of b with its worktree cut at A1 forks into
  // b's lane 0 at A1's row, not into a's lane.
  const cut = [c('BM', ['main'], null, ['B0']), c('B0', [], null, ['A1']), c('A1', ['wt'], null, ['A0']), c('A0')];
  const p = claude({ id: 'b', color: '#00ff00', createdAt: 5, commits: claim(['BM', 'B0']), team: [member({ id: 'm1', branch: 'wt' })] });
  const g2 = sessionGraph(cut, [a, p], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(g2), ['own:b@0', 'BM@0', 'B0@0', 'm1~@1', 'A1@2', 'A0@2']);
  assert.deepEqual(wires(g2), ['session:0:1-4', 'pending:0:0-1~', 'fork:1:3-4>0~', 'session:2:4-5'], "the fork lands on b's lane 0 at A1's row and b's line reaches it");
  // The landing on b's bare line is marked with a fork bar (M9 fix 374;
  // no bar there until then, and the fork read as from nowhere).
  assert.deepEqual(dotsOf(g2), ['b@0:4'], "a fork bar on b's lane at A1's row");
  assert.deepEqual(g2.dots.map((d) => `${d.shape}:${d.kind}`), ['bar:fork']);
  // The bar carries the landing flag (M9 fix 399): forkBar alone sets
  // it, so the card's line can tell a fork's landing from a lane's end.
  assert.deepEqual(g2.dots.map((d) => d.landing), [true], "a member's fork landing on the bare line carries the flag");
  // Two members cut at the same commit share the one bar.
  const two = { ...p, team: [member({ id: 'm1', branch: 'wt' }), member({ id: 'm2', branch: 'wt', startedAt: 1 })] };
  assert.deepEqual(dotsOf(sessionGraph(cut, [a, two], 'graph', ROOTS, 'main')), ['b@0:5'], 'one bar however many members land on the row');
});

test("sessionGraph (M9 fix 145): a lane forked from another block's commit that the session's own chain runs past ends on itself under a bar, and so does a commit-less fork off such a commit", () => {
  // s made s1 then s2 on main; r made X on s1 on a branch of its own;
  // s's member committed w1 on X and s merged it as M. X's row sits
  // between s2 and s1, and s's chain there is s2 to s1, not X.
  const commits = [c('M', ['main'], null, ['s2', 'w1']), c('w1', ['wt'], null, ['X']), c('s2', [], null, ['s1']), c('X', ['x', 'wt2'], null, ['s1']), c('s1', [], null, [])];
  const s = claude({ id: 's', createdAt: 5, commits: claim(['M', 's2', 's1', 'w1']), team: [member({ id: 'a1', branch: 'wt', startedAt: 1, commits: claim(['w1']) }), member({ id: 'a2', branch: 'wt2', startedAt: 2 })] });
  const r = session({ id: 'r', color: '#00ff00', commits: claim(['X']) });
  const g = sessionGraph(commits, [s, r], 'graph', ROOTS, 'main');
  // a2, commit-less, is lane 1 beside the line and a1's worktree lane
  // is 2 (M9 fix 374).
  assert.deepEqual(picture(g), ['own:s@0', 'M@0', 'a1@2', 'w1@2', 's2@0', 'a2~@1', 'X@3', 's1@0']);
  assert.deepEqual(wires(g), ['merge:2:3-1>0', 'worktree:2:3-6', 'session:0:1-7', 'pending:0:0-1~', 'fork:1:5-6~', 'pending:2:2-3~'], "w1's lane runs straight down to X's row and stops, a2's fork ends on its own lane there, and neither touches s's line");
  assert.deepEqual(dotsOf(g), ['s@1:6', 's@2:6'], "a bar on each lane at X's row");
  assert.deepEqual(g.dots.map((d) => d.shape), ['bar', 'bar']);
  // Neither bar is a landing (M9 fix 399): a2's fork ends on its own
  // preassigned lane rather than the session's bare line, and w1's own
  // lane is the block's walk ending beside X.
  assert.deepEqual(g.dots.map((d) => d.landing ?? false), [false, false], "neither bar carries the landing flag");
});

test("sessionGraph (M9 fix 145): the trunk follows the session's ancestry through another block's rows, so an own commit off that ancestry takes a side lane and a member cut off it ends under a bar, and hiding the other block moves nothing", () => {
  // s made s2 on main over r's r1, which sits on s's s1; s also made f1
  // on a branch off r's r0, which is not on s2's ancestry, and has a
  // member with a worktree cut at r's q1, off the ancestry too.
  const commits = [c('s2', ['main'], null, ['r1']), c('q1', ['q', 'wt9'], null, ['r0']), c('f1', ['f'], null, ['r0']), c('r1', [], null, ['s1']), c('s1', [], null, ['r0']), c('r0')];
  const s = session({ id: 's', commits: claim(['s2', 's1', 'f1']), team: [member({ id: 'a9', branch: 'wt9' })] });
  const r = session({ id: 'r', color: '#00ff00', commits: claim(['r1', 'r0', 'q1']) });
  const g = sessionGraph(commits, [s, r], 'graph', ROOTS, 'main');
  // The commit-less member is lane 1 beside s's line and f1's side lane
  // is 2 (M9 fix 374).
  assert.deepEqual(picture(g), ['s2@0', 'a9~@1', 'q1@3', 'f1@2', 'r1@4', 's1@0', 'r0@3'], "s1 stays on s's line through r1's row; the member beside it, f1 on a third lane; in r's block q1 heads the trunk and r1 sits beside it");
  assert.deepEqual(wires(g), ['branch:2:3-6>0', 'worktree:4:4-5', 'session:0:0-6', 'fork:1:1-2~', 'session:3:2-6'], "f1 curves into s's line at r0's row, which s's ancestry reaches through s1; the member's fork ends on its own lane at q1's row; r1 runs down to s1's row and stops, its parent being s's while r's trunk runs past");
  assert.deepEqual(dotsOf(g), ['s@1:2', 'r@4:5'], "a bar on the member's lane at q1's row, since q1 is off the ancestry and nothing of s's reserved it, and one on r1's lane at s1's row");
  // Neither bar is a landing (M9 fix 399): a9's fork ends on its own
  // preassigned lane at q1's row, off the session's bare line, and
  // r1's own lane end is the block's walk.
  assert.deepEqual(g.dots.map((d) => d.landing ?? false), [false, false], "neither bar carries the landing flag");
  const hidden = sessionGraph(commits, [s, r], 'graph', ROOTS, 'main', new Map(), { drawn: () => new Set(['s']) });
  assert.deepEqual(picture(hidden), ['s2@0', 'a9~@1', 'q1@null', 'f1@2', 'r1@null', 's1@0', 'r0@null']);
  assert.deepEqual(wires(hidden), ['branch:2:3-6>0', 'session:0:0-6', 'fork:1:1-2~'], "the same lines with r's block hidden");
  assert.deepEqual(dotsOf(hidden), ['s@1:2']);
});

test('underFolder (M68): either slash, any case, the folder itself or one under it, never a sibling with the same prefix', () => {
  const back = String.fromCharCode(92);
  assert.ok(underFolder(`c:${back}Users${back}x${back}repo`, 'C:/Users/x/repo'));
  assert.ok(underFolder('C:/Users/x/repo/packages/app', `C:${back}Users${back}x${back}repo`));
  assert.ok(underFolder('C:/Users/x/repo', 'C:/Users/x/repo/'));
  assert.ok(!underFolder('C:/Users/x/repo-wt/fix', 'C:/Users/x/repo'));
  assert.ok(!underFolder(null, 'C:/Users/x/repo'));
  assert.ok(!underFolder('C:/Users/x/repo', ''));
});

test("laneAgents (M61): a branch no session is on takes the parent's colour and the agent's label", () => {
  const parent = {
    id: 'p',
    branch: 'main',
    color: '#123456',
    state: 'working' as const,
    team: [
      member({ id: 'a1', description: 'fix-title: fixes 93 and 96', branch: 'fix-title', startedAt: 10 }),
      member({ id: 'a2', type: 'Explore', branch: 'm59-colours', startedAt: 20, outcome: 'returned', endedAt: 30 }),
      // Two on one branch: the running one wins, then the newest.
      member({ id: 'a3', description: 'early', branch: 'm60-lane-card', startedAt: 5, outcome: 'returned', endedAt: 6 }),
      member({ id: 'a4', description: 'later', branch: 'm60-lane-card', startedAt: 7 }),
      // A shell member and one on the parent's own branch are nothing.
      member({ id: 'sh', kind: 'shell', branch: 'shell-branch' }),
      member({ id: 'a5', description: 'on main', branch: 'main' }),
    ],
  };
  const other = { id: 'o', branch: 'shell-branch', color: '#00ff00', state: 'idle' as const, team: [] };
  const branches = ['main', 'fix-title', 'm59-colours', 'm60-lane-card', 'shell-branch', 'nobody', null];
  const agents = laneAgents(branches, [parent, other]);
  assert.deepEqual([...agents.entries()], [
    ['fix-title', { sessionId: 'p', memberId: 'a1', label: 'fix-title: fixes 93 and 96', working: true, color: '#123456' }],
    ['m59-colours', { sessionId: 'p', memberId: 'a2', label: 'Explore', working: false, color: '#123456' }],
    ['m60-lane-card', { sessionId: 'p', memberId: 'a4', label: 'later', working: true, color: '#123456' }],
  ]);
});

test('laneSessions: the session a pill stands for is the coloured one on the branch, else the first on it, else the agent parent', () => {
  const sessions = [
    { id: 'a', branch: 'feature', color: null, state: 'idle' as const, team: [] },
    { id: 'b', branch: 'feature', color: '#abcdef', state: 'working' as const, team: [] },
    { id: 'c', branch: 'main', color: null, state: 'idle' as const, team: [member({ id: 'x', branch: 'wt' })] },
  ];
  const owners = laneSessions(['main', 'feature', null, 'other', 'wt'], sessions);
  assert.deepEqual(
    [...owners.entries()].map(([b, s]) => [b, s.id]),
    [
      ['main', 'c'],
      ['feature', 'b'],
      ['wt', 'c'],
    ],
    'the coloured session wins the branch, a branch with no session has no entry, an agent branch is its parent',
  );
});

// A transcript on disk (M70), as the history scan lists it, keyed in the
// map by each of its remote ids.
const transcript = (id: string, remoteIds: string[], over: Partial<HistoryTranscript> = {}): HistoryTranscript => ({ id, title: `Conversation ${id}`, cwd: 'C:/repo', cwdExists: true, path: `${id}.jsonl`, startedAt: 0, lastAt: 0, remoteIds, ...over });
const historyMap = (...list: HistoryTranscript[]) => new Map(list.flatMap((t) => t.remoteIds.map((r) => [r, t] as const)));

test('sessionGraph (M70): an outside commit whose trailer names a transcript draws on a history block of its own, gone, coloured by the transcript, named by the conversation; a trailer with no transcript stays outside', () => {
  const commits = [c('e', ['main'], 'session_r1', ['d']), c('d', [], 'session_r1', ['x']), c('x', [], 'session_none', ['a']), c('a', [], null, [])];
  const s1 = session({ id: 's1', commits: claim(['a']) });
  const g = sessionGraph(commits, [s1], 'graph', ROOTS, 'main', historyMap(transcript('t1', ['session_r1'])));
  // M71: the conversation's rows (0 and 1) and the session's (3) are a
  // row apart, so the two blocks share a column; the grey block never packs.
  assert.deepEqual(picture(g), ['e@0', 'd@0', 'x@1', 'a@0'], 'the conversation gets a block among the sessions, in order of first appearance, ahead of the grey one, and the session packs under it');
  assert.deepEqual(g.lanes.map((l) => `${l.slot}:${l.block}:${l.group}`), ['0:0:0', '0:1:0', '1:2:1'], 'two blocks in one column group, the grey one in its own');
  assert.equal(g.columns, 2);
  const lane = g.lanes[0]!;
  assert.equal(lane.sessionId, `${HISTORY_PREFIX}t1`);
  assert.deepEqual(lane.history, { transcriptId: 't1', title: 'Conversation t1' });
  assert.equal(lane.gone, true, 'nothing is live behind it');
  assert.equal(lane.color, farthestSessionColor(['#123456'], colorForKey('t1')), "the palette colour farthest from the session's own (M9 fix 133), the hashed one breaking ties");
  assert.equal(historyIdOf(lane.sessionId), 't1');
  assert.equal(g.lanes[2]!.sessionId, null, 'the trailer nobody has a transcript for stays in the grey block');
  assert.equal(g.lanes[2]!.history, null);
  assert.deepEqual(wires(g), ['session:0:0-1'], 'its own line from its newest commit to its oldest, no row above and no dot');
  assert.deepEqual(g.items.filter((it) => it.kind === 'agent'), [], 'no agent row for a conversation');
  // Without the map the same commits are outside, as before M70.
  assert.deepEqual(picture(sessionGraph(commits, [s1], 'graph', ROOTS, 'main')), ['e@1', 'd@1', 'x@1', 'a@0'], 'the outside block comes last, so the session is lane 0 there');
});

test('sessionGraph (M70): a record wins over a transcript for the same remote id, and a record whose Claude session id is the transcript owns every id the transcript names', () => {
  const commits = [c('e', ['main'], 'session_new', ['d']), c('d', [], 'session_old', ['a']), c('a', [], null, [])];
  const t = transcript('conv-1', ['session_old', 'session_new']);
  // The record holds the first id only: the resume in an external
  // terminal was handed session_new, which the transcript knows.
  const stale = claude({ id: 's1', remoteSessionId: 'session_old', claudeSessionId: 'conv-1', state: 'exited' });
  const g = sessionGraph(commits, [stale], 'graph', ROOTS, 'main', historyMap(t));
  assert.deepEqual(picture(g), ['e@0', 'd@0', 'a@1'], 'both commits on the record session lane, no history block');
  assert.equal(g.lanes.filter((l) => l.history !== null).length, 0);
  assert.deepEqual(remoteIdsByRecord([stale], historyMap(t)), new Map([['session_old', 's1'], ['session_new', 's1']]));
  // A record with the remote id and no Claude session id wins outright.
  const plain = session({ id: 's2', remoteSessionId: 'session_new' });
  const g2 = sessionGraph(commits, [plain], 'graph', ROOTS, 'main', historyMap(t));
  assert.equal(g2.items.find((it) => it.kind === 'commit' && it.commit.hash === 'e')!.sessionId, 's2');
  assert.equal(g2.items.find((it) => it.kind === 'commit' && it.commit.hash === 'd')!.sessionId, `${HISTORY_PREFIX}conv-1`, 'the id the record does not hold falls to the transcript');
});

test('sessionGraph (M70): two transcripts give two history blocks, one conversation reached by either of its ids, and the list lays them on one lane each', () => {
  const commits = [c('f', ['main'], 'session_b2', ['e']), c('e', [], 'session_a1', ['d']), c('d', [], 'session_b1', ['a']), c('a', [], null, [])];
  const map = historyMap(transcript('ta', ['session_a1'], { startedAt: 10 }), transcript('tb', ['session_b1', 'session_b2'], { startedAt: 20 }));
  const g = sessionGraph(commits, [], 'graph', ROOTS, 'main', map);
  assert.deepEqual(picture(g), ['f@0', 'e@1', 'd@0', 'a@2'], 'tb first by appearance, both of its ids on one block, then ta, then the grey block');
  assert.deepEqual(g.lanes.map((l) => l.history?.transcriptId ?? null), ['tb', 'ta', null]);
  assert.deepEqual(wires(g), ['session:0:0-2', 'outside:2:3-3'].filter((w) => !w.endsWith('3-3')), 'tb line from f to d; ta has one commit and no line');
  const l = sessionGraph(commits, [], 'list', ROOTS, 'main', map);
  assert.deepEqual(picture(l), ['f@0', 'e@1', 'd@0', 'a@2']);
});

test('sessionGraph (M9 fix 133): the history blocks take colours far from every colour on the graph, in start order, the same every time', () => {
  // Two sessions on colours of their own and two conversations, tb
  // first by appearance and ta first by start.
  const commits = [c('f', ['main'], 'session_b1', ['e']), c('e', [], 'session_a1', ['d']), c('d', [], null, ['x']), c('x', [], null, ['a']), c('a', [], null, [])];
  const s1 = session({ id: 's1', color: '#cd7578', commits: claim(['d']) });
  const s2 = session({ id: 's2', color: '#69ceaa', commits: claim(['x']) });
  const map = historyMap(transcript('ta', ['session_a1'], { startedAt: 10 }), transcript('tb', ['session_b1'], { startedAt: 20 }));
  const g = sessionGraph(commits, [s1, s2], 'graph', ROOTS, 'main', map);
  const colors = g.blocks.filter((b) => b.sessionId !== null).map((b) => b.color!);
  assert.equal(colors.length, 4);
  for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) assert.ok(colorDistance(colors[i]!, colors[j]!) > COLOR_FLOOR, `${colors[i]} and ${colors[j]} tell apart`);
  const ta = g.blocks.find((b) => b.history?.transcriptId === 'ta')!.color!;
  const tb = g.blocks.find((b) => b.history?.transcriptId === 'tb')!.color!;
  assert.equal(ta, farthestSessionColor(['#cd7578', '#69ceaa'], colorForKey('ta')), 'ta, started first, is farthest from the two sessions');
  assert.equal(tb, farthestSessionColor(['#cd7578', '#69ceaa', ta], colorForKey('tb')), 'tb is farthest from the sessions and ta');
  assert.deepEqual(sessionGraph(commits, [s1, s2], 'graph', ROOTS, 'main', map).blocks.map((b) => b.color), g.blocks.map((b) => b.color), 'the same log and sessions give the same colours again');
  // The lanes and the items carry the block's colour, not the hash's.
  assert.equal(g.lanes.find((l) => l.history?.transcriptId === 'ta')!.color, ta);
  // A session's stored colour off the palette (an older palette's) is
  // measured like any other, and a session with none takes no part.
  const g2 = sessionGraph(commits, [session({ id: 's1', color: '#61afef', commits: claim(['d']) }), session({ id: 's2', color: null, commits: claim(['x']) })], 'graph', ROOTS, 'main', map);
  const ta2 = g2.blocks.find((b) => b.history?.transcriptId === 'ta')!.color!;
  assert.equal(ta2, farthestSessionColor(['#61afef'], colorForKey('ta')));
  assert.ok(colorDistance(ta2, '#61afef') > COLOR_FLOOR);
});

test('sessionGraph (M9 fix 139): a history block keeps its colour across builds, and only a block whose colour a session takes is re-picked', () => {
  const commits = [c('f', ['main'], 'session_b1', ['e']), c('e', [], 'session_a1', ['d']), c('d', [], null, ['x']), c('x', [], null, ['a']), c('a', [], null, [])];
  const map = historyMap(transcript('ta', ['session_a1'], { startedAt: 10 }), transcript('tb', ['session_b1'], { startedAt: 20 }));
  const memo = new Map<string, string>();
  const colorsOf = (g: ReturnType<typeof sessionGraph>) => ({ ta: g.blocks.find((b) => b.history?.transcriptId === 'ta')!.color!, tb: g.blocks.find((b) => b.history?.transcriptId === 'tb')!.color! });
  // Alone on the graph, the two pick as fix 133 says and the memo holds them.
  const first = colorsOf(sessionGraph(commits, [], 'graph', ROOTS, 'main', map, { historyColors: memo }));
  assert.deepEqual([...memo], [['ta', first.ta], ['tb', first.tb]]);
  // A session block appears on a colour of its own: fix 133 alone would
  // re-pick both; with the memo neither moves.
  const s1 = session({ id: 's1', color: farthestSessionColor([first.ta, first.tb], '#cd7578'), commits: claim(['d']) });
  const second = colorsOf(sessionGraph(commits, [s1], 'graph', ROOTS, 'main', map, { historyColors: memo }));
  assert.deepEqual(second, first, 'the history blocks keep their colours when a session block appears');
  assert.notDeepEqual(colorsOf(sessionGraph(commits, [s1], 'graph', ROOTS, 'main', map)), first, 'without the memo the pick moves, which is what the memo is for');
  // The session recoloured to ta's hex: ta moves, tb stays.
  const s1b = session({ id: 's1', color: first.ta, commits: claim(['d']) });
  const third = colorsOf(sessionGraph(commits, [s1b], 'graph', ROOTS, 'main', map, { historyColors: memo }));
  assert.notEqual(third.ta, first.ta, 'ta is re-picked off the colour the session took');
  assert.ok(colorDistance(third.ta, first.ta) > COLOR_FLOOR);
  assert.equal(third.tb, first.tb, 'tb keeps its colour');
  assert.equal(memo.get('ta'), third.ta, 'the memo follows the re-pick');
  // A colour tb collides with next time round is re-picked the same way,
  // and the block whose colour is free keeps it.
  const s2 = session({ id: 's2', color: first.tb, commits: claim(['x']) });
  const fourth = colorsOf(sessionGraph(commits, [s2], 'graph', ROOTS, 'main', map, { historyColors: memo }));
  assert.equal(fourth.ta, third.ta);
  assert.notEqual(fourth.tb, first.tb);
});

test('sessionGraph (M71): blocks whose rows do not overlap share a column, one row of clearance between them; overlapping blocks keep separate groups; the grey block never packs', () => {
  // Four sessions one after another on main, each with a commit, a
  // hand-made commit between each pair so no two spans touch; the log
  // newest first: d1, z3, c1, z2, b1, z1, a1. Every block is one lane.
  const commits = [c('d1', ['main']), c('z3'), c('c1'), c('z2'), c('b1'), c('z1'), c('a1')];
  const sa = session({ id: 'a', color: '#111111', commits: claim(['a1']) });
  const sb = session({ id: 'b', color: '#222222', commits: claim(['b1']) });
  const sc = session({ id: 'c', color: '#333333', commits: claim(['c1']) });
  const sd = session({ id: 'd', color: '#444444', commits: claim(['d1']) });
  const g = sessionGraph(commits, [sa, sb, sc, sd], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['d1@0', 'z3@1', 'c1@0', 'z2@1', 'b1@0', 'z1@1', 'a1@0'], 'the four on one column, the grey block beside them');
  assert.equal(g.columns, 2, 'two columns, not five');
  assert.equal(g.groups, 2);
  assert.deepEqual(g.lanes.map((l) => `${l.sessionId}:${l.slot}:${l.group}`), ['d:0:0', 'c:0:0', 'b:0:0', 'a:0:0', 'null:1:1']);
  assert.deepEqual(g.blocks.map((b) => `${b.sessionId}:${b.color}`), ['d:#444444', 'c:#333333', 'b:#222222', 'a:#111111', 'null:null'], 'the blocks keep their own colours');
  assert.equal(g.lanes.length, 5, 'data-lanes still counts every block lane');
  // Two commits in a row (b1 right under c1's row) touch: no clearance,
  // so the second opens a group of its own.
  const tight = [c('c1', ['main']), c('b1'), c('z1'), c('a1')];
  const g2 = sessionGraph(tight, [sa, sb, sc], 'graph', ROOTS);
  assert.deepEqual(picture(g2), ['c1@0', 'b1@1', 'z1@2', 'a1@0'], 'c and a share a column with z1 between; b touches c and sits beside');
  assert.equal(g2.columns, 3);
  // A wider block sets its group's width, and a narrower one under it
  // takes the group's first column.
  const wide = [c('p3', ['main'], null, ['p2']), c('w2', ['wt'], null, ['w1']), c('w1', [], null, ['p2']), c('p2', [], null, ['p1']), c('p1'), c('z'), c('q1')];
  const parent = session({ id: 'p', commits: claim(['p3', 'p2', 'p1', 'w2', 'w1']), team: [member({ id: 'a1', branch: 'wt', commits: claim(['w1', 'w2']) })] });
  const q = session({ id: 'q', color: '#00ff00', commits: claim(['q1']) });
  const g3 = sessionGraph(wide, [parent, q], 'graph', ROOTS);
  assert.deepEqual(picture(g3), ['p3@0', 'a1@1', 'w2@1', 'w1@1', 'p2@0', 'p1@0', 'z@2', 'q1@0']);
  assert.equal(g3.columns, 3, "the parent's two lanes, then the grey column; q shares the parent's first");
  assert.deepEqual(wires(g3).filter((w) => w.startsWith('branch')), ['branch:1:3-4>0'], 'the lines keep their lanes through the remap');
  assert.ok(g3.lines.every((l) => l.block === 0), "every line here is the parent's");
  // The grey block spans the whole log, so it never joins a group, and
  // its lanes come last.
  assert.equal(g3.lanes[g3.lanes.length - 1]!.sessionId, null);
});

test("sessionGraph (M71): a session's line reaching a row keeps it apart from a block on that row; the outside block's lines and dots carry its block", () => {
  // s started on z (a dot there) and made s1; t made t1 right above z.
  // s spans s1 to z's row, t spans t1's row alone: they touch at z.
  const commits = [c('s1', ['main']), c('t1'), c('z')];
  const s = claude({ id: 's', createdAt: 5, state: 'exited', commits: claim(['s1']), startHead: 'z' });
  const t = session({ id: 't', color: '#00ff00', commits: claim(['t1']) });
  const g = sessionGraph(commits, [s, t], 'graph', ROOTS);
  assert.deepEqual(picture(g), ['s1@0', 't1@1', 'z@2']);
  assert.deepEqual(dotsOf(g), ['s@0:2']);
  assert.deepEqual(g.dots.map((d) => d.block), [0]);
  assert.deepEqual(g.lines.map((l) => `${l.kind}:${l.block}`), ['session:0']);
  // t on the row under z instead: apart from s by a row, so it packs.
  const apart = [c('s1', ['main']), c('z'), c('y'), c('t1')];
  const g2 = sessionGraph(apart, [s, t], 'graph', ROOTS);
  assert.deepEqual(picture(g2), ['s1@0', 'z@1', 'y@1', 't1@0']);
  assert.equal(g2.columns, 2);
});

test("sessionGraph (M71): a history block draws as one line whatever the mode, unless the layout map says graph; a session block folds to one line when the map says line; the block says which it took", () => {
  // The conversation merged a branch of its own: hm merges hb1 (off ha)
  // into ha's chain. Newest first: hm, hb1, ha.
  const commits = [c('hm', ['main'], 'session_h', ['ha', 'hb1']), c('hb1', [], 'session_h', ['ha']), c('ha', [], 'session_h', [])];
  const map = historyMap(transcript('th', ['session_h']));
  const line = sessionGraph(commits, [], 'graph', ROOTS, 'main', map);
  assert.deepEqual(picture(line), ['hm@0', 'hb1@0', 'ha@0'], 'one lane, the merge folded');
  assert.deepEqual(wires(line), ['session:0:0-2']);
  assert.equal(line.blocks[0]!.layout, 'line');
  assert.equal(line.columns, 1);
  const opened = sessionGraph(commits, [], 'graph', ROOTS, 'main', map, { layout: new Map([[`${HISTORY_PREFIX}th`, 'graph']]) });
  assert.deepEqual(picture(opened), ['hm@0', 'hb1@1', 'ha@0'], 'the merge on a side lane once opened up');
  assert.deepEqual(wires(opened), ['merge:1:1-0>0', 'branch:1:1-2>0', 'session:0:0-2']);
  assert.equal(opened.blocks[0]!.layout, 'graph');
  assert.equal(opened.columns, 2);
  // In the list the map's graph still wins for that block.
  assert.deepEqual(picture(sessionGraph(commits, [], 'list', ROOTS, 'main', map, { layout: new Map([[`${HISTORY_PREFIX}th`, 'graph']]) })), ['hm@0', 'hb1@1', 'ha@0']);
  // A session block with a worktree lane folds to a line on request,
  // the member's row on the line and no curve.
  const mine = [c('p3', ['main'], null, ['p2']), c('w2', ['wt'], null, ['w1']), c('w1', [], null, ['p2']), c('p2', [], null, ['p1']), c('p1')];
  const parent = session({ id: 'p', commits: claim(['p3', 'p2', 'p1', 'w2', 'w1']), team: [member({ id: 'a1', branch: 'wt', commits: claim(['w1', 'w2']) })] });
  const folded = sessionGraph(mine, [parent], 'graph', ROOTS, null, new Map(), { layout: new Map([['p', 'line']]) });
  assert.deepEqual(picture(folded), ['p3@0', 'a1@0', 'w2@0', 'w1@0', 'p2@0', 'p1@0']);
  assert.deepEqual(wires(folded), ['session:0:0-5'], "one straight line, the member's stretch inside it");
  assert.equal(folded.blocks[0]!.layout, 'line');
  assert.equal(sessionGraph(mine, [parent], 'graph', ROOTS).blocks[0]!.layout, 'graph');
});

test('sessionGraph (M72): a block left out of the drawn set keeps its commits as rows with no lane, contributes no lane, line, dot or agent row, and takes no column', () => {
  const commits = [c('s2', ['main'], null, ['s1']), c('t1', [], null, ['s1']), c('s1', [], null, ['z']), c('z')];
  const s = claude({ id: 's', createdAt: 5, commits: claim(['s2', 's1']), startHead: 'z' });
  const t = session({ id: 't', color: '#00ff00', commits: claim(['t1']) });
  const all = sessionGraph(commits, [s, t], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(all), ['own:s@0', 's2@0', 't1@1', 's1@0', 'z@2']);
  assert.equal(all.columns, 3);
  const keys = (g: ReturnType<typeof sessionGraph>) => g.blocks.map((b) => `${b.sessionId}:${b.drawn}`);
  assert.deepEqual(keys(all), ['s:true', 't:true', 'null:true']);
  // s hidden: its rows stay in place with no lane, no own row, no dot,
  // no line; t and the grey block close up.
  const hid = sessionGraph(commits, [s, t], 'graph', ROOTS, 'main', new Map(), { drawn: (ks) => new Set(ks.filter((k) => k !== 's')) });
  assert.deepEqual(picture(hid), ['s2@null', 't1@0', 's1@null', 'z@1']);
  assert.deepEqual(keys(hid), ['s:false', 't:true', 'null:true']);
  assert.equal(hid.columns, 2);
  assert.deepEqual(hid.lanes.map((l) => l.sessionId), ['t', null]);
  assert.deepEqual(dotsOf(hid), []);
  assert.deepEqual(wires(hid), []);
  assert.equal(hid.items.length, 4, 'the same four commit rows, the own row gone with the lanes');
  // The grey block hidden by its key.
  const noGrey = sessionGraph(commits, [s, t], 'graph', ROOTS, 'main', new Map(), { drawn: (ks) => new Set(ks.filter((k) => k !== 'outside')) });
  assert.deepEqual(picture(noGrey), ['own:s@0', 's2@0', 't1@1', 's1@0', 'z@null']);
  assert.equal(noGrey.columns, 2);
  // Nothing drawn: rows and nothing else.
  const none = sessionGraph(commits, [s, t], 'graph', ROOTS, 'main', new Map(), { drawn: () => new Set() });
  assert.deepEqual(picture(none), ['s2@null', 't1@null', 's1@null', 'z@null']);
  assert.equal(none.columns, 0);
  assert.equal(none.lanes.length, 0);
});

test('sessionGraph (M9 fix 211): the drawn row range is the rows the drawing blocks touch, the whole list when every block draws, cut at the end whose block is hidden, null when none draws', () => {
  // s owns the two newest rows and t the one after; z is an outside
  // commit at the old end; s has no start commit, so its line ends at
  // s1 and nothing of its reaches z's row.
  const commits = [c('s2', ['main'], null, ['s1']), c('s1', [], null, ['t1']), c('t1', [], null, ['z']), c('z')];
  const s = claude({ id: 's', createdAt: 5, commits: claim(['s2', 's1']) });
  const t = session({ id: 't', color: '#00ff00', commits: claim(['t1']) });
  const all = sessionGraph(commits, [s, t], 'graph', ROOTS, 'main');
  assert.deepEqual(picture(all), ['own:s@0', 's2@0', 's1@0', 't1@1', 'z@2']);
  assert.deepEqual(all.drawnRows, { from: 0, to: 4 });
  // The grey block hidden: the old end is t1's row.
  const noGrey = sessionGraph(commits, [s, t], 'graph', ROOTS, 'main', new Map(), { drawn: (ks) => new Set(ks.filter((k) => k !== 'outside')) });
  assert.deepEqual(picture(noGrey), ['own:s@0', 's2@0', 's1@0', 't1@1', 'z@null']);
  assert.deepEqual(noGrey.drawnRows, { from: 0, to: 3 });
  // s hidden: its own row goes and its two commits keep their rows
  // with no lane, so the new end is t1's row (row 2 now).
  const noS = sessionGraph(commits, [s, t], 'graph', ROOTS, 'main', new Map(), { drawn: (ks) => new Set(ks.filter((k) => k !== 's')) });
  assert.deepEqual(picture(noS), ['s2@null', 's1@null', 't1@0', 'z@1']);
  assert.equal(noS.drawnRows?.from, 2);
  assert.equal(noS.drawnRows?.to, 3);
  // Nothing drawn.
  const none = sessionGraph(commits, [s, t], 'graph', ROOTS, 'main', new Map(), { drawn: () => new Set() });
  assert.equal(none.drawnRows, null);
});

test('holdGraph (M9 fix 210): an empty read on the same root keeps the last graph with commits; a root that never had one, or a new root, does not', () => {
  const g = (root: string | null, hashes: string[]) => ({ root, commits: hashes.map((hash) => ({ hash })) });
  const full = g('C:/r', ['a', 'b']);
  const empty = g('C:/r', []);
  assert.equal(holdGraph(full, empty), full, 'the empty read is held');
  const next = g('C:/r', ['c', 'a', 'b']);
  assert.equal(holdGraph(full, next), next, 'a read with commits replaces the held one');
  assert.equal(holdGraph(empty, empty), empty, 'nothing to hold on a repository with no commits yet');
  const other = g('C:/other', []);
  assert.equal(holdGraph(full, other), other, 'a new root drops the hold, even empty');
  const none = g(null, []);
  assert.equal(holdGraph(full, none), none, 'no repository at all is shown as such');
});

// M9 fix 286: the people on the repository and the branches only on
// the remote. A commit by another author, as the log's %an has it.
const by = (author: string, commit: GraphCommit): GraphCommit => ({ ...commit, author });
const remote = (refs: string[], commit: GraphCommit): GraphCommit => ({ ...commit, remoteRefs: refs });

test("sessionGraph (M9 fix 286): another author's unclaimed commits draw on a person block of their own, gone, named and coloured off the name, a trailer inside it staying the person's; the own author's stay outside", () => {
  const commits = [c('e', ['main'], null, ['d']), by('Ada', c('d', [], 'session_r9', ['x'])), by('Ada', c('x', [], null, ['a'])), c('a', [], null, [])];
  const s1 = session({ id: 's1', commits: claim(['a']) });
  const g = sessionGraph(commits, [s1], 'graph', ROOTS, 'main', new Map(), { author: 'x' });
  assert.deepEqual(picture(g), ['e@2', 'd@0', 'x@0', 'a@1'], "Ada's block is first among the blocks (first appearance), the session's next (a row too close to pack under it), the own author's tip outside");
  const lane = g.lanes[0]!;
  assert.equal(lane.sessionId, `${PERSON_PREFIX}Ada`);
  assert.deepEqual(lane.person, { name: 'Ada' });
  assert.equal(lane.remote, null);
  assert.equal(lane.gone, true, 'nobody is live behind a person block');
  assert.equal(lane.color, farthestSessionColor(['#123456'], colorForKey(`${PERSON_PREFIX}Ada`)), 'a colour of its own off the name, kept clear of the sessions as a history block is');
  assert.equal(personNameOf(lane.sessionId), 'Ada');
  const block = g.blocks[0]!;
  assert.deepEqual(block.person, { name: 'Ada' });
  assert.equal(block.layout, 'graph', 'a person block walks its own graph, unlike a history block');
  const d = g.items[1]!;
  assert.equal(d.kind === 'commit' ? d.sessionId : null, `${PERSON_PREFIX}Ada`, 'the trailer commit stays in the person block: their agent is their work');
  assert.equal(g.lanes[2]!.sessionId, null, 'the own author has an outside block for the tip');
  assert.deepEqual(g.items.filter((it) => it.kind === 'agent'), [], 'no row for a person');
  // With no author known nobody is a person and the picture is the M70 one.
  assert.equal(sessionGraph(commits, [s1], 'graph', ROOTS, 'main').lanes.some((l) => l.person !== null), false);
  // A record's claim comes first: a commit a session claims is never a person's, whoever the author.
  const claimed = sessionGraph(commits, [session({ id: 's1', commits: claim(['a', 'x']) })], 'graph', ROOTS, 'main', new Map(), { author: 'x' });
  assert.equal(claimed.items.find((it) => it.kind === 'commit' && it.commit.hash === 'x')?.sessionId, 's1');
});

test("sessionGraph (M9 fix 286): the own author's commits on a branch that lives only on the remote draw on a grey remote block; a person's on it stay the person's; a remote ref on a commit a local branch reaches is no block", () => {
  // f is origin/feature's tip, reachable from no local branch; r is
  // Ada's on the same branch; main holds e and a, and origin/old sits on
  // a commit main reaches.
  const commits = [remote(['origin/feature'], c('f', [], null, ['r'])), by('Ada', c('r', [], null, ['a'])), c('e', ['main'], null, ['a']), remote(['origin/old'], c('a', [], null, []))];
  assert.deepEqual([...remoteOnlyCommits(commits)], [['f', 'origin/feature'], ['r', 'origin/feature']], 'the walk from the remote tip over what no local branch reaches; a is local');
  const g = sessionGraph(commits, [], 'graph', ROOTS, 'main', new Map(), { author: 'x' });
  const of = (hash: string) => { const it = g.items.find((x) => x.kind === 'commit' && x.commit.hash === hash); return it === undefined ? 'missing' : it.sessionId; };
  assert.equal(of('f'), `${REMOTE_PREFIX}origin/feature`);
  assert.equal(of('r'), `${PERSON_PREFIX}Ada`, 'the person keeps hers');
  assert.equal(of('e'), null, 'outside, as before');
  assert.equal(of('a'), null, 'a remote ref on a local commit is a pill, not a block');
  const lane = g.lanes.find((l) => l.remote !== null)!;
  assert.deepEqual(lane.remote, { branch: 'origin/feature' });
  assert.equal(lane.color, null, 'grey, as the outside block is');
  assert.equal(lane.gone, true);
  assert.equal(remoteBranchOf(lane.sessionId), 'origin/feature');
  assert.deepEqual(g.blocks.find((b) => b.remote !== null)?.remote, { branch: 'origin/feature' });
  // Without the field (the read not asked with remotes) f is outside.
  const off = sessionGraph(commits.map((x) => {
    const c: GraphCommit = { ...x };
    delete c.remoteRefs;
    return c;
  }), [], 'graph', ROOTS, 'main', new Map(), { author: 'x' });
  assert.equal(off.items.find((it) => it.kind === 'commit' && it.commit.hash === 'f')?.sessionId, null);
});

test('memberTint (M9 fix 305): twelve members are twelve tints of the block colour, inside the readable range, the own lane the colour itself', () => {
  for (const color of SESSION_COLORS) {
    assert.equal(memberTint(color, 0, 12), color, `the own lane keeps ${color}`);
    const tints = Array.from({ length: 12 }, (_, i) => memberTint(color, i + 1, 12));
    assert.equal(new Set(tints).size, 12, `twelve distinct tints of ${color} (${tints.join(' ')})`);
    for (const t of tints) {
      assert.ok(/^#[0-9a-f]{6}$/.test(t), `a hex (${t})`);
      assert.notEqual(t, color, 'no member wears the block colour itself');
      const [l] = oklabOf(t);
      assert.ok(l >= 0.51 && l <= 0.87, `${t} within the clamp (${l})`);
      const hue = Math.abs(hueOf(t) - hueOf(color));
      assert.ok(Math.min(hue, 360 - hue) < 6, `${t} keeps the hue of ${color} (${hueOf(t)} against ${hueOf(color)})`);
    }
  }
  // Few members take the 0.06 steps, alternating around the block's own.
  const base = oklabOf('#b7893b')[0];
  const [up, down, up2] = [1, 2, 3].map((i) => oklabOf(memberTint('#b7893b', i, 3))[0]);
  assert.ok(Math.abs(up! - (base + 0.06)) < 0.01 && Math.abs(down! - (base - 0.06)) < 0.01 && Math.abs(up2! - (base + 0.12)) < 0.01, `+0.06, -0.06, +0.12 (${[up, down, up2].map((v) => v! - base).join(' ')})`);
});

test("agentRole (M9 fix 373): the role pill says subagent and the type Claude Code named the agent by, a fork's `subagent · fork`, a fresh agent's its own type, and a member with no type the bare word; the name is untouched", () => {
  const base: TeamMember = { id: 'a', kind: 'agent', type: null, description: null, command: null, startedAt: 0, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [], activity: null };
  assert.equal(agentRole({ ...base, type: 'fork', description: 'the merge' }), 'subagent · fork');
  assert.equal(agentRole({ ...base, type: 'general-purpose', description: 'a search' }), 'subagent · general-purpose');
  assert.equal(agentRole({ ...base, type: 'emerald-batch-dev', description: null }), 'subagent · emerald-batch-dev');
  assert.equal(agentRole(base), 'subagent');
  assert.equal(agentLabel({ ...base, type: 'fork', description: 'the merge' }), 'the merge', 'the name stays the description');
  assert.equal(agentLabel({ ...base, type: 'fork' }), 'fork', 'the name stays the type when there is no description');
});
