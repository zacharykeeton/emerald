import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TeamMember } from '@emerald/shared';
import { sessionGraph } from './commit-graph-model.ts';
import { writeGraphInput, writeRel } from './write-graph-model.ts';
import type { WriteSession } from './write-graph-model.ts';

// M9 fix 255: the write graph, the commit graph's layout over a folder's
// sessions' touched lists.
const FOLDER = 'C:\\work\\notes';
const member = (over: Partial<TeamMember>): TeamMember => ({ id: 'a', kind: 'agent', type: 'fork', description: null, command: null, startedAt: 0, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [], activity: null, ...over });
const session = (over: Partial<WriteSession> & { id: string }): WriteSession => ({ name: over.id, color: '#123456', commits: [], team: [], removedAt: null, remoteSessionId: null, createdAt: 0, branch: null, kind: 'claude', claudeSessionId: null, lastEventAt: null, state: 'working', cwd: FOLDER, spawnCwd: FOLDER, startHead: null, groupCwd: FOLDER, ...over });
const picture = (g: ReturnType<typeof sessionGraph>) => g.items.map((it) => (it.kind === 'agent' ? `${it.member?.id ?? `own:${it.sessionId}`}@${it.lane}` : `${it.commit.subject}@${it.lane}`));
const wires = (g: ReturnType<typeof sessionGraph>) => g.lines.map((l) => `${l.kind}:${l.lane}:${l.fromRow}-${l.toRow === 'bottom' ? 'b' : l.toRow}${l.toLane === null ? '' : `>${l.toLane}`}${l.dashed ? '~' : ''}`);

test('writeRel: the path under the folder with forward slashes, the whole path outside it', () => {
  assert.equal(writeRel('C:\\work\\notes\\src\\a.ts', FOLDER), 'src/a.ts');
  assert.equal(writeRel('c:/work/notes/README.md', FOLDER), 'README.md');
  assert.equal(writeRel('C:\\elsewhere\\b.txt', FOLDER), 'C:\\elsewhere\\b.txt');
});

test("writeGraphInput: two sessions' touched lists are nodes on their own lanes, newest first, each session claiming its writes", () => {
  const s1 = session({ id: 's1', touched: [{ path: 'C:\\work\\notes\\a.md', at: 10, agentId: null }, { path: 'C:\\work\\notes\\b.md', at: 30, agentId: null }] });
  const s2 = session({ id: 's2', color: '#00ff00', touched: [{ path: 'C:\\work\\notes\\c.md', at: 20, agentId: null }] });
  // A session in another folder is not on the graph.
  const other = session({ id: 'other', cwd: 'C:\\other', spawnCwd: 'C:\\other', groupCwd: 'C:\\other', touched: [{ path: 'C:\\other\\z.md', at: 40, agentId: null }] });
  const input = writeGraphInput([s1, s2, other], FOLDER);
  assert.deepEqual(input.commits.map((c) => `${c.subject}:${c.at}:${c.parents.join(',')}`), ['b.md:30:write:s1:0', 'c.md:20:', 'a.md:10:'], 'newest first, a session\'s own writes chained');
  assert.deepEqual(input.sessions.map((s) => `${s.id}:${s.commits.map((c) => c.hash).join(',')}`), ['s1:write:s1:0,write:s1:1', 's2:write:s2:0']);
  assert.equal(input.writes.get('write:s1:1')?.by, 's1');
  const g = sessionGraph(input.commits, input.sessions, 'graph', [FOLDER]);
  assert.deepEqual(picture(g), ['own:s1@0', 'b.md@0', 'own:s2@1', 'c.md@1', 'a.md@0'], "each session a row above its newest write, the writes on the session's line");
  assert.deepEqual(wires(g), ['session:0:1-4', 'pending:0:0-1~', 'pending:1:2-3~']);
});

test("writeGraphInput: a member's writes are a lane of their own forking off the session's latest own write before them; a path written twice is one node at its last time", () => {
  const m = member({ id: 'ag1', description: 'the agent' });
  // The touched list as the daemon keeps it: one entry per path, the
  // second write of a.md having moved it to the end.
  const s = session({
    id: 's',
    team: [m],
    touched: [
      { path: 'C:\\work\\notes\\b.md', at: 20, agentId: null },
      { path: 'C:\\work\\notes\\x.md', at: 30, agentId: 'ag1' },
      { path: 'C:\\work\\notes\\y.md', at: 40, agentId: 'ag1' },
      { path: 'C:\\work\\notes\\a.md', at: 50, agentId: null },
    ],
  });
  const input = writeGraphInput([s], FOLDER);
  assert.deepEqual(input.commits.map((c) => `${c.subject}:${c.parents.join(',')}`), ['a.md:write:s:0', 'y.md:write:s:1', 'x.md:write:s:0', 'b.md:'], "the member's chain forks off b.md, the session's own chain runs a.md to b.md");
  assert.equal(input.commits.filter((c) => c.subject === 'a.md').length, 1, 'a.md is one node');
  assert.equal(input.writes.get('write:s:1')?.by, 's · subagent · fork · the agent', 'the author line says the role and the type the way the rail pill does (M9 fix 373)');
  const claim = input.sessions[0]!.commits.find((c) => c.hash === 'write:s:1');
  assert.equal(claim?.agent?.id, 'ag1', "the member's write is claimed with the agent on it");
  const g = sessionGraph(input.commits, input.sessions, 'graph', [FOLDER]);
  assert.deepEqual(picture(g), ['own:s@0', 'a.md@0', 'ag1@1', 'y.md@1', 'x.md@1', 'b.md@0'], "the member's writes on a lane of their own in the block, its row above its newest");
  assert.ok(wires(g).includes('branch:1:4-5>0'), `the member's lane curves into the session's line at b.md (${wires(g).join(' ')})`);
  assert.deepEqual(g.lanes.map((l) => `${l.slot}:${l.memberId}`), ['0:null', '1:ag1']);
});
