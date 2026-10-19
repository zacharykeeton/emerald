import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockTime, dayKey } from '@emerald/shared';
import type { ActivitySession, TeamMember } from '@emerald/shared';
import { sessionGraph } from './commit-graph-model.ts';
import type { GraphLine, GraphSession, SessionGraph } from './commit-graph-model.ts';
import { REPLAY_BEAT_MS, buildReplay, frameAt, nextChange, recordAt, replayAt, replayGraph, replayInput, replayKey, replayNote } from './replay-model.ts';
import type { GraphCommit } from '../../preload/api.ts';

// The helpers of commit-graph-model.test.ts, with the commit's time a
// parameter: the replay reads it.
const c = (hash: string, parents: string[] = [], at = 0): GraphCommit => ({ hash, parents, refs: [], subject: hash, author: 'x', at, authoredAt: at, claudeSession: null });
const member = (over: Partial<TeamMember>): TeamMember => ({ id: 'a', kind: 'agent', type: 'fork', description: null, command: null, startedAt: 0, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [], activity: null, ...over });
const ROOTS = ['C:/repo'];
const session = (over: Partial<GraphSession> & { id: string }): GraphSession => ({ name: over.id, color: '#123456', commits: [], team: [], removedAt: null, remoteSessionId: null, createdAt: 0, branch: null, kind: 'shell', claudeSessionId: null, lastEventAt: null, state: 'idle', cwd: 'C:/repo', spawnCwd: 'C:/repo', startHead: null, groupCwd: over.spawnCwd ?? 'C:/repo', ...over });
const claude = (over: Partial<GraphSession> & { id: string }): GraphSession => session({ kind: 'claude', branch: 'main', ...over });
// An activity row with every required field.
const row = (over: Partial<ActivitySession> & { sessionId: string }): ActivitySession => ({ name: null, color: null, kind: 'claude', claudeSessionId: null, removedAt: null, cwd: null, groupCwd: null, requests: [], commits: [], lifetime: false, spans: [], debt: [], awayMs: 0, cappedMs: 0, parentId: null, agentId: null, agentType: null, outside: false, ...over });

const picture = (g: SessionGraph) => g.items.map((it) => (it.kind === 'agent' ? `${it.member?.id ?? 'own'}@${it.lane}` : `${it.commit.hash}@${it.lane}`));
const rowOf = (g: SessionGraph, name: string): number => g.items.findIndex((it) => (it.kind === 'agent' ? (it.member?.id ?? 'own') : it.commit.hash) === name);

const F1 = { id: 'f1', branch: 'f1', type: 'fork', description: 'fork one' };
const folded = () => [c('r1', ['r0']), c('f1c', ['r0']), c('r0')];

test('replayInput: an exited record is made live for its spans, a member with a commit gets a stand-in row on its lane, one with none only its marks', () => {
  const record = claude({ id: 's', state: 'exited', commits: [{ hash: 'r1', at: 1 }, { hash: 'f1c', at: 1, agent: F1 }] });
  const rows = [
    row({ sessionId: 's', spans: [{ from: 10, to: 20, prompt: 'go' }] }),
    row({ sessionId: 's', agentId: 'f1', parentId: 's', name: 'fork one', agentType: 'fork', kind: 'agent', spans: [{ from: 12, to: 18, prompt: null }] }),
    row({ sessionId: 's', agentId: 'x1', parentId: 's', name: 'reader', agentType: 'Explore', kind: 'agent', spans: [{ from: 13, to: 14, prompt: null }] }),
  ];
  const commits = folded();
  const shown = new Set(commits.map((x) => x.hash));
  // Today's picture: no rows at all.
  assert.deepEqual(picture(sessionGraph(commits, [record], 'graph', ROOTS)), ['r1@0', 'f1c@1', 'r0@2']);
  const input = replayInput([record], rows, shown);
  assert.equal(input.sessions.length, 1);
  const part = input.sessions[0]!;
  assert.equal(part.state, 'idle');
  assert.equal(part.removedAt, null);
  assert.equal(part.team.length, 1);
  const f1 = part.team[0]!;
  assert.equal(f1.id, 'f1');
  assert.equal(f1.type, 'fork');
  assert.equal(f1.description, 'fork one');
  assert.equal(f1.branch, 'f1');
  assert.equal(f1.outcome, 'returned');
  assert.equal(f1.startedAt, 12);
  assert.equal(f1.endedAt, 18);
  assert.deepEqual([...input.marks.keys()].sort(), ['s f1', 's own', 's x1']);
  const g = sessionGraph(commits, input.sessions, 'graph', ROOTS);
  assert.deepEqual(picture(g), ['own@0', 'r1@0', 'f1@1', 'f1c@1', 'r0@2']);
  assert.equal(g.lanes.length, 3);
  // A shell's lifetime row adds nothing.
  const more = replayInput([record], [...rows, row({ sessionId: 's', lifetime: true, kind: 'shell', spans: [{ from: 0, to: 100, prompt: null }] })], shown);
  assert.deepEqual(more.marks.get(replayKey('s', null)), [{ from: 10, to: 20, prompt: 'go' }]);
  assert.deepEqual(more.sessions, input.sessions);
});

test('replayInput: a record of two spans splits into its parts, each with its own span, the stand-in on the part that claimed its commit and the own spans cut at the second start', () => {
  const span = (startedAt: number, conversation: string) => ({ conversation, remoteSessionId: null, startedAt, endedAt: null, startHead: null });
  const record = claude({ id: 's', spans: [span(0, 'one'), span(100, 'two')], commits: [{ hash: 'r1', at: 150 }, { hash: 'f1c', at: 50, agent: F1 }] });
  const rows = [
    row({ sessionId: 's', spans: [{ from: 10, to: 120, prompt: 'first' }, { from: 130, to: 160, prompt: 'second' }] }),
    row({ sessionId: 's', agentId: 'f1', parentId: 's', name: 'fork one', agentType: 'fork', kind: 'agent', spans: [{ from: 40, to: 60, prompt: null }] }),
  ];
  const input = replayInput([record], rows, new Set(['r1', 'f1c', 'r0']));
  assert.deepEqual(input.sessions.map((s) => s.id), ['s#span1', 's']);
  for (const s of input.sessions) assert.equal(s.spans?.length, 1);
  assert.deepEqual(input.sessions[0]!.team.map((m) => m.id), ['f1']);
  assert.deepEqual(input.sessions[1]!.team, []);
  assert.deepEqual(input.marks.get('s#span1 own'), [{ from: 10, to: 100, prompt: 'first' }]);
  assert.deepEqual(input.marks.get('s own'), [{ from: 100, to: 120, prompt: 'first' }, { from: 130, to: 160, prompt: 'second' }]);
  assert.ok(input.marks.has('s#span1 f1'));
  // Passed through sessionGraph's own split unchanged.
  const g = sessionGraph(folded(), input.sessions, 'graph', ROOTS);
  assert.ok(g.items.some((it) => it.kind === 'agent' && it.sessionId === 's#span1' && it.member?.id === 'f1'));
});

// A graph of commits and one live session whose rows the tests time.
const timed = (commits: GraphCommit[], team: TeamMember[] = []) => sessionGraph(commits, [claude({ id: 's', commits: commits.map((x) => ({ hash: x.hash, at: x.at })), team })], 'graph', ROOTS);

test('buildReplay: the commits land oldest first, never before the one below; a hash not in the model is null', () => {
  const commits = [c('d', ['c'], 40_000), c('c', ['b'], 25_000), c('b', ['a'], 30_000), c('a', [], 10_000)];
  const g = timed(commits);
  const r = buildReplay(g, new Map(), 'a', 1e12)!;
  assert.ok(r !== null);
  const at = (hash: string) => r.lands.get(rowOf(g, hash))!;
  assert.equal(r.from, 10_000);
  assert.equal(at('b'), replayAt(r, 30_000));
  assert.equal(at('c'), at('b'));
  assert.ok(at('d') > at('c'));
  assert.equal(r.lands.has(rowOf(g, 'a')), false);
  assert.equal(buildReplay(g, new Map(), 'nope', 1e12), null);
});

test('buildReplay: a busy stretch plays at speed, an idle one at most a beat; overlapping forks work at once and the first is idle at its own end', () => {
  // a at 0; fork p1 works 0 to 600 000; an idle hour; fork p2 works
  // 4 200 000 to 4 800 000 and p3 4 500 000 to 5 100 000; an idle five
  // minutes; b lands at 5 400 000.
  const commits = [c('b', ['a'], 5_400_000), c('a', [], 0)];
  const team = [member({ id: 'p1' }), member({ id: 'p2' }), member({ id: 'p3' })];
  const g = timed(commits, team);
  const marks = new Map([
    [replayKey('s', 'p1'), [{ from: 0, to: 600_000, prompt: 'one' }]],
    [replayKey('s', 'p2'), [{ from: 4_200_000, to: 4_800_000, prompt: null }]],
    [replayKey('s', 'p3'), [{ from: 4_500_000, to: 5_100_000, prompt: null }]],
  ]);
  const r = buildReplay(g, marks, 'a', 1e12)!;
  // 600 000 busy: 1000; 3 600 000 idle: 1000 (the beat); 900 000 busy:
  // 1500; 300 000 idle: 500.
  assert.equal(replayAt(r, 600_000), 1000);
  assert.equal(replayAt(r, 4_200_000), 1000 + REPLAY_BEAT_MS);
  assert.equal(replayAt(r, 5_100_000), 3500);
  assert.equal(r.lands.get(rowOf(g, 'b')), 4000);
  assert.equal(r.length, 4000);
  assert.equal(recordAt(r, 3500), 5_100_000);
  const p2 = rowOf(g, 'p2');
  const p3 = rowOf(g, 'p3');
  const both = frameAt(r, replayAt(r, 4_600_000));
  assert.ok(both.working.has(p2) && both.working.has(p3));
  const end = frameAt(r, replayAt(r, 4_800_000));
  assert.equal(end.working.has(p2), false);
  assert.equal(end.working.has(p3), true);
  assert.equal(frameAt(r, 500).prompts.get(rowOf(g, 'p1')), 'one');
});

test('frameAt and nextChange: at 0 the later rows are hidden, at the end nothing is', () => {
  const commits = [c('b', ['a'], 2_000_000), c('a', [], 0)];
  const g = timed(commits, [member({ id: 'p1' })]);
  const marks = new Map([[replayKey('s', 'p1'), [{ from: 600_000, to: 1_200_000, prompt: null }]]]);
  const r = buildReplay(g, marks, 'a', 1e12)!;
  const first = frameAt(r, 0);
  assert.ok(first.hidden.has(rowOf(g, 'b')));
  assert.ok(first.hidden.has(rowOf(g, 'p1')));
  assert.equal(first.hidden.has(rowOf(g, 'a')), false);
  assert.equal(first.done, false);
  const last = frameAt(r, r.length);
  assert.equal(last.hidden.size, 0);
  assert.equal(last.done, true);
  assert.equal(nextChange(r, 0), replayAt(r, 600_000));
  assert.equal(nextChange(r, r.length), r.length);
  assert.equal(frameAt(r, -5).at, 0);
  assert.equal(frameAt(r, r.length + 5).at, r.length);
});

test('replayGraph: a session line grows up its lane, an edge comes with its newer commit, a hidden dot goes, the marks follow the frame', () => {
  const line = (over: Partial<GraphLine>): GraphLine => ({ kind: 'session', lane: 0, fromRow: 1, toRow: 4, toLane: null, dashed: false, block: 0, ...over });
  const commits = [c('e'), c('d'), c('c'), c('b'), c('a')];
  const g = timed(commits, [member({ id: 'p1', outcome: 'returned' })]);
  // The model's rows: p1 and own above the commits; take the commit rows.
  const rows = commits.map((x) => rowOf(g, x.hash));
  const model: SessionGraph = {
    ...g,
    lines: [line({ fromRow: rows[1]!, toRow: rows[4]! }), line({ kind: 'branch', fromRow: rows[0]!, toRow: rows[1]! })],
    dots: [{ row: rows[0]!, lane: 0, sessionId: 's', block: 0, shape: 'bar', kind: 'start' }],
  };
  const p1 = rowOf(g, 'p1');
  const hidden = new Set([rows[0]!, rows[1]!, rows[2]!]);
  const frame = { at: 0, record: 0, hidden, working: new Set([p1]), prompts: new Map(), done: false };
  const out = replayGraph(model, frame);
  assert.deepEqual(out.lines.map((l) => `${l.kind}:${l.fromRow}-${l.toRow}`), [`session:${rows[3]}-${rows[4]}`]);
  assert.deepEqual(out.dots, []);
  const it = out.items[p1]!;
  assert.ok(it.kind === 'agent' && it.working);
  const off = replayGraph(model, { ...frame, hidden: new Set(), working: new Set() });
  const again = off.items[p1]!;
  assert.ok(again.kind === 'agent' && !again.working);
  assert.equal(off.lines.length, 2);
  assert.equal(off.dots.length, 1);
});

test('a start older than the record: the next commit lands one beat later with nothing working, and the note says where the record starts', () => {
  const commits = [c('b', ['a'], 3_600_000_000), c('a', [], 0)];
  const g = timed(commits, [member({ id: 'p1' })]);
  const marks = new Map([[replayKey('s', 'p1'), [{ from: 3_600_100_000, to: 3_600_700_000, prompt: null }]]]);
  const r = buildReplay(g, marks, 'a', 1e13)!;
  assert.equal(r.lands.get(rowOf(g, 'b')), REPLAY_BEAT_MS);
  assert.equal(frameAt(r, REPLAY_BEAT_MS / 2).working.size, 0);
  const h = 3_600_000_000;
  assert.equal(replayNote(0, h, true), `The working record starts ${dayKey(h)} ${clockTime(h)}; the commits before it replay without marks`);
  assert.equal(replayNote(0, null, true), 'No working record; the commits replay without marks');
  assert.equal(replayNote(0, 5, false), 'No working record; the commits replay without marks');
  assert.equal(replayNote(10, 5, true), null);
});
