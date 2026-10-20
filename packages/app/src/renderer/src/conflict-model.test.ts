import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BranchBase, ConflictReport } from '@emerald/shared';
import { BEHIND_AT, baseLine, conflictLines, conflictReading, conflictWords, filesText } from './conflict-model.ts';
import type { AgentItem, CommitItem, GraphBlock, GraphDot, SessionGraph } from './commit-graph-model.ts';

const NOW = 1_700_000_000_000;
const H = 3_600_000;

// The board's reading: five sessions, each with its own agent row and
// its newest commit a row under it, on lanes 0 to 4; the fork dots on
// the oldest row. sweep is in no pair.
const IDS = ['pocket', 'live-count', 'sweep', 'week', 'debt'];

function agent(sessionId: string, row: number, lane: number, tipRow: number | null): AgentItem {
  return { kind: 'agent', row, lane, sessionId, member: null, working: true, pending: false, forkRow: null, forkLane: null, tipRow, tipLane: null, restRow: null, startRow: null };
}

function commit(sessionId: string | null, row: number, lane: number | null, n: number): CommitItem {
  return { kind: 'commit', row, lane, sessionId, memberId: null, commit: { hash: n.toString(16).padStart(40, '0'), subject: `c${n}`, author: 'x', at: NOW - n * H, authoredAt: NOW - n * H, parents: [], refs: [] } };
}

function graph(over: Partial<SessionGraph> = {}): SessionGraph {
  const items = IDS.flatMap((id, i) => [agent(id, i * 2, i, i * 2 + 1), commit(id, i * 2 + 1, i, i + 1)]);
  const blocks: GraphBlock[] = IDS.map((id) => ({ sessionId: id, color: null, gone: false, history: null, person: null, remote: null, layout: 'graph', drawn: true }));
  const dots: GraphDot[] = IDS.map((id, i) => ({ row: 10, lane: i, sessionId: id, block: i, shape: 'dot', kind: 'start' }));
  return { items, lanes: [], blocks, columns: 5, groups: 1, lines: [], dots, drawnRows: null, ...over };
}

const base = (ahead: number, behind: number, forkedAgo: number): BranchBase => ({ ahead, behind, forkedAt: NOW - forkedAgo, defaultBranch: 'main', repo: 'r' });

const report: ConflictReport = {
  conflicts: [
    { a: 'live-count', b: 'pocket', files: ['style.css'] },
    { a: 'debt', b: 'live-count', files: ['style.css', 'protocol.ts', 'session-manager.ts'] },
    { a: 'debt', b: 'week', files: ['style.css', 'ActivityRidges.tsx'] },
  ],
  base: { pocket: base(4, 0, 3 * H), 'live-count': base(6, 0, 3 * H), sweep: base(7, 1, 3 * H), week: base(9, 2, 3 * H), debt: base(12, 40, 48 * H) },
};

const peers = new Map(IDS.map((id, i) => [id, { name: `fix-${id}`, color: `#00000${i + 1}` }]));

test('filesText names one or two files whole and cuts three or more to the first and a count', () => {
  assert.equal(filesText([]), '');
  assert.equal(filesText(['style.css']), 'style.css');
  assert.equal(filesText(['style.css', 'protocol.ts']), 'style.css and protocol.ts');
  assert.equal(filesText(['style.css', 'protocol.ts', 'x.ts']), 'style.css and 2 more');
  assert.equal(filesText(['a', 'b', 'c', 'd', 'e']), 'a and 4 more');
});

test("the board's reading: three ties between the newest commit nodes, the counts per row, the lines per card, the clean lane untouched", () => {
  const r = conflictReading(graph(), report, peers, NOW);
  assert.equal(r.ties.length, 3);
  // Newest tip first: pocket's tip is row 1 (with live-count's 3), then live-count with debt (rows 3 and 9), then week with debt (7 and 9).
  assert.deepEqual(r.ties.map((t) => [t.a, t.b, t.tipA, t.tipB, t.laneA, t.laneB]), [
    ['live-count', 'pocket', 3, 1, 1, 0],
    ['debt', 'live-count', 9, 3, 4, 1],
    ['debt', 'week', 9, 7, 4, 3],
  ]);
  assert.deepEqual([...r.pairsBySession], [['live-count', 2], ['pocket', 1], ['debt', 2], ['week', 1]]);
  assert.equal(r.pairsBySession.has('sweep'), false);
  assert.equal(r.linesBySession.has('sweep'), false);
  const debt = r.linesBySession.get('debt')!;
  assert.deepEqual(debt.map((l) => [l.name, l.color, l.files]), [['fix-live-count', '#000002', 'style.css and 2 more'], ['fix-week', '#000004', 'style.css and ActivityRidges.tsx']]);
  assert.equal(conflictWords(debt[0]!), 'conflicts with fix-live-count on style.css and 2 more');
  assert.deepEqual(r.baseBySession.get('debt'), { text: '12 ahead, 40 behind main, forked 2d ago', stale: true, behind: 40 });
  assert.deepEqual(r.baseBySession.get('sweep'), { text: '7 ahead, 1 behind main, forked 3h ago', stale: false, behind: 1 });
  assert.equal('figures' in r, false, 'no count on the graph; the card has it (M9 fix 938)');
});

test('a pair whose session is not drawn, exited or off the graph is dropped, and its lines with it', () => {
  const g = graph();
  g.blocks[0] = { ...g.blocks[0]!, drawn: false };
  const r = conflictReading(g, report, peers, NOW);
  assert.equal(r.ties.length, 2);
  assert.equal(r.pairsBySession.has('pocket'), false);
  assert.equal(r.pairsBySession.get('live-count'), 1);
  const gone = graph({ items: graph().items.filter((it) => it.sessionId !== 'debt'), blocks: graph().blocks.filter((b) => b.sessionId !== 'debt') });
  const r2 = conflictReading(gone, report, peers, NOW);
  assert.deepEqual(r2.ties.map((t) => [t.a, t.b]), [['live-count', 'pocket']]);
});

test('a session whose newest head is another block\'s commit ties there, and one with no tip in the log has no tie', () => {
  const g = graph();
  // pocket's head sits on lane 3 at row 7 (a fast-forward onto week's commit).
  g.items[0] = agent('pocket', 0, 0, 7);
  (g.items[0] as AgentItem).tipLane = 3;
  const r = conflictReading(g, report, peers, NOW);
  const t = r.ties.find((x) => x.b === 'pocket')!;
  assert.deepEqual([t.tipB, t.laneB], [7, 3]);
  g.items[0] = agent('pocket', 0, 0, null);
  g.items = g.items.filter((it) => !(it.kind === 'commit' && it.sessionId === 'pocket'));
  const r2 = conflictReading(g, report, peers, NOW);
  assert.equal(r2.ties.some((x) => x.b === 'pocket'), false);
  assert.equal(r2.pairsBySession.has('pocket'), false);
});

test('a session with no agent row ties on its newest commit item', () => {
  const g = graph({ items: graph().items.filter((it) => !(it.kind === 'agent' && it.sessionId === 'pocket')) });
  const r = conflictReading(g, report, peers, NOW);
  const t = r.ties.find((x) => x.b === 'pocket')!;
  assert.deepEqual([t.tipB, t.laneB], [1, 0]);
});

test('the base line is muted under forty behind and stale from it', () => {
  assert.equal(baseLine(base(1, 39, H), NOW)!.stale, false);
  assert.equal(baseLine(base(1, BEHIND_AT, H), NOW)!.stale, true);
  assert.equal(baseLine(undefined, NOW), null);
  assert.equal(baseLine(base(0, 0, 90_000), NOW)!.text, '0 ahead, 0 behind main, forked 1m ago');
});

test('conflictLines names the other lane by its session name and colour, and a peer the store lacks by its id', () => {
  const lines = conflictLines('week', report.conflicts, new Map());
  assert.deepEqual(lines.map((l) => [l.other, l.name, l.color, l.all]), [['debt', 'debt', null, ['style.css', 'ActivityRidges.tsx']]]);
  assert.deepEqual(conflictLines('sweep', report.conflicts, peers), []);
});
