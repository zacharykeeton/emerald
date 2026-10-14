import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barLines, commitsLine, fetchedLine, historyCardModel, historyCommitsLine, historyLine, laneCardModel, outsideCardModel, outsideKind, outsideLine, personCardModel, personLine, remoteCardModel, remoteLine } from './lane-card-model.ts';
import type { LaneCardSession } from './lane-card-model.ts';
import { aSession } from './test-support.ts';

const T0 = 1_700_000_000_000;
const NOW = T0 + 10 * 60_000;
const h = (n: number) => n.toString(16).padStart(40, '0');
// Newest first, as the log lists them.
const shown = [5, 4, 3, 2, 1].map((n) => ({ hash: h(n), subject: `c${n}`, author: 'x', at: NOW - (6 - n) * 60_000 }));

function session(over: Partial<LaneCardSession> = {}): LaneCardSession {
  return {
    ...aSession({
      id: 's1',
      kind: 'claude',
      name: 'graph work',
      autoName: true,
      branch: 'm51-graph',
      cwd: 'C:\\repo\\wt\\m51-graph',
      groupCwd: 'C:\\repo',
      state: 'working',
      stateSince: T0,
      color: '#61afef',
      claudeSessionId: 'c1',
      commits: [h(2), h(4), h(9)].map((hash) => ({ hash, at: T0 })),
      createdAt: T0,
    }),
    ...over,
  };
}

test('laneCardModel: a live session reads its name, state, branch, its commits in the log and Show plus Transcript', () => {
  const m = laneCardModel(session(), shown, NOW);
  assert.equal(m.name, 'graph work');
  assert.deepEqual(m.state, { text: 'working', tone: 'working' });
  assert.deepEqual(m.where, { kind: 'branch', text: 'm51-graph' });
  assert.equal(m.count, 2, 'the commit not in the shown log is not counted');
  assert.deepEqual(m.newest, { hash: h(4), subject: 'c4', age: '2m' }, 'the newest of its own, in log order');
  assert.deepEqual(m.actions, { show: true, resume: false, transcript: true, color: true });
  assert.equal(m.conversationId, 'c1');
  assert.equal(commitsLine(m), '2 commits here, the newest 2m ago');
});

test('laneCardModel: an exited session offers Resume in a new pane and no Show; the folder stands in for a missing branch', () => {
  const m = laneCardModel(session({ state: 'exited', exitCode: 0, branch: null }), shown, NOW);
  assert.equal(m.state.tone, 'exited');
  assert.deepEqual(m.where, { kind: 'folder', text: 'm51-graph' });
  assert.deepEqual(m.actions, { show: false, resume: true, transcript: true, color: true }, 'an exited session the daemon still lists keeps the Colour row (M9 fix 134)');
});

test('laneCardModel: a removed session (M57) reads removed with its age, resumes only through its conversation', () => {
  const gone = laneCardModel(session({ state: 'exited', removedAt: NOW - 3 * 3_600_000, conversation: null, claudeSessionId: null }), shown, NOW);
  assert.deepEqual(gone.state, { text: 'removed 3h ago', tone: 'exited' });
  assert.deepEqual(gone.actions, { show: false, resume: false, transcript: false, color: false }, 'a removed session has no Colour row: session.set on it answers not-found (M9 fix 134)');
  const withConversation = laneCardModel(session({ state: 'exited', removedAt: NOW - 1000, claudeSessionId: null, conversation: { id: 'c9', cwd: 'C:\\repo', args: [] } }), shown, NOW);
  assert.deepEqual(withConversation.actions, { show: false, resume: true, transcript: true, color: false });
  assert.equal(withConversation.conversationId, 'c9', 'the conversation names the transcript when the live id is gone');
});

test('laneCardModel: a plain shell at its prompt has no state word, and no commits reads as such', () => {
  const m = laneCardModel(session({ kind: 'shell', state: 'idle', claudeSessionId: null, commits: [] }), shown, NOW);
  assert.deepEqual(m.state, { text: 'shell', tone: undefined });
  assert.equal(m.count, 0);
  assert.equal(m.newest, null);
  assert.equal(commitsLine(m), 'no commits in this log');
  assert.deepEqual(m.actions, { show: true, resume: false, transcript: false, color: true });
});

test('outsideCardModel (M68): the outside commits split into those with a trailer nobody here holds and those with none, with the words for each', () => {
  const outside: Array<(typeof shown)[number] & { claudeSession?: string | null }> = [{ ...shown[0]!, claudeSession: 'session_far' }, { ...shown[1]!, claudeSession: null }, { ...shown[2]! }];
  const model = outsideCardModel(outside);
  assert.deepEqual(model, { count: 3, trailer: 1, bare: 2, history: 0 });
  assert.equal(outsideLine(model), '3 commits in this log nobody here made');
  assert.equal(outsideLine(outsideCardModel([outside[0]!])), '1 commit in this log nobody here made');
  assert.deepEqual(outsideCardModel([]), { count: 0, trailer: 0, bare: 0, history: 0 });
  // The commits drawn on history lanes instead (M70) are named, not counted in.
  assert.deepEqual(outsideCardModel(outside, 2), { count: 3, trailer: 1, bare: 2, history: 2 });
  assert.equal(historyLine(outsideCardModel(outside, 2)), '2 more on history lanes');
  assert.equal(outsideKind(outside[0]!), 'made outside emerald, its trailer naming a conversation this daemon never held');
  assert.equal(outsideKind(outside[1]!), 'made outside emerald, no trailer');
  assert.equal(outsideKind(outside[2]!), 'made outside emerald, no trailer');
});

test('historyCardModel (M70): the conversation, its folder, its dates, its commits in the log, Resume only while the folder exists', () => {
  const t = { id: 'conv-1', title: 'Click through the batch', cwd: 'C:/code/emerald', cwdExists: true, path: 'C:/claude/conv-1.jsonl', startedAt: T0 - 3600_000, lastAt: T0 - 60_000, remoteIds: ['session_x'] };
  const model = historyCardModel(t, shown.slice(0, 2), T0);
  assert.equal(model.title, 'Click through the batch');
  assert.equal(model.folder, 'emerald');
  assert.equal(model.when, 'started 1h ago, last 1m ago');
  assert.equal(model.count, 2);
  assert.deepEqual(model.actions, { resume: true, transcript: true });
  assert.equal(historyCommitsLine(model), '2 commits here');
  assert.equal(historyCommitsLine(historyCardModel(t, [], T0)), 'no commits in this log');
  assert.equal(historyCommitsLine(historyCardModel(t, shown.slice(0, 1), T0)), '1 commit here');
  const gone = historyCardModel({ ...t, cwdExists: false, startedAt: null, lastAt: null }, [], T0);
  assert.equal(gone.actions.resume, false);
  assert.equal(gone.when, null);
});

test('barLines (M9 fix 152): a start bar and the fork bars each get a line, the fork hashes cut to three, and a block with no bar gets none', () => {
  const none = barLines([]);
  assert.deepEqual(none, { head: null, start: null, landing: null, ending: null });
  // M9 fix 151: the head bar under a session's row.
  const head = barLines([{ kind: 'head', hash: 'db2fbafd05e7ef72ec43ff4515126548c810faa7' }]);
  assert.equal(head.head, 'bar at db2fbaf: the head of the branch this session is on, a commit on another lane');
  assert.equal(head.start, null);
  const start = barLines([{ kind: 'start', hash: 'e6e114c92bad120993dffe980b1a19d14573051c' }]);
  assert.equal(start.start, 'bar at e6e114c: the commit HEAD was on when this session started');
  assert.equal(start.landing, null);
  assert.equal(start.ending, null);
  // M9 fix 399: a fork bar's own line names its kind, a fork landing on
  // this line or a lane ending at the commit it came from.
  const oneLanding = barLines([{ kind: 'fork', hash: 'bcee417b881f634ad5a84dc662710f2b48ca9b9c', landing: true }]);
  assert.equal(oneLanding.start, null);
  assert.equal(oneLanding.landing, '1 bar where a fork lands on this line (bcee417)');
  assert.equal(oneLanding.ending, null);
  const oneEnding = barLines([{ kind: 'fork', hash: 'bcee417b881f634ad5a84dc662710f2b48ca9b9c' }]);
  assert.equal(oneEnding.landing, null);
  assert.equal(oneEnding.ending, '1 bar ending a lane at the commit it came from (bcee417)');
  const three = barLines([
    { kind: 'start', hash: 'e6e114c92bad120993dffe980b1a19d14573051c' },
    { kind: 'fork', hash: 'bcee417b881f634ad5a84dc662710f2b48ca9b9c', landing: true },
    { kind: 'fork', hash: 'a5393e978c279e4da5684c64abac571b51da00f6', landing: true },
    { kind: 'fork', hash: '5ab9a35a8e3935fe4e2442a318b15accf6a82045', landing: true },
  ]);
  assert.equal(three.start, 'bar at e6e114c: the commit HEAD was on when this session started');
  assert.equal(three.landing, '3 bars where a fork lands on this line (bcee417, a5393e9, 5ab9a35)');
  assert.equal(three.ending, null);
  const five = barLines(forks(5).map((f) => ({ ...f, landing: true })));
  assert.equal(five.landing, '5 bars where a fork lands on this line (aaaaaa1, aaaaaa2, aaaaaa3 and 2 more)');
  assert.equal(five.ending, null);
  // The mixed case (M9 fix 399): a block with both kinds of fork bar
  // draws two lines, landings first, each cut to three hashes of its
  // own kind.
  const mixed = barLines([
    { kind: 'fork', hash: 'bcee417b881f634ad5a84dc662710f2b48ca9b9c', landing: true },
    { kind: 'fork', hash: 'a5393e978c279e4da5684c64abac571b51da00f6', landing: true },
    { kind: 'fork', hash: '5ab9a35a8e3935fe4e2442a318b15accf6a82045' },
  ]);
  assert.equal(mixed.landing, '2 bars where a fork lands on this line (bcee417, a5393e9)');
  assert.equal(mixed.ending, '1 bar ending a lane at the commit it came from (5ab9a35)');
});

function forks(n: number): Array<{ kind: 'fork'; hash: string }> {
  return Array.from({ length: n }, (_, i) => ({ kind: 'fork' as const, hash: `aaaaaa${i + 1}000000000000000000000000000000000` }));
}

test('personCardModel, remoteCardModel and fetchedLine (M9 fix 286): the counts and the fetch age as words', () => {
  const c = (claudeSession: string | null) => ({ hash: 'h', subject: '', author: 'Ada', at: 0, claudeSession });
  assert.equal(personLine(personCardModel('Ada', [c(null), c('session_x'), c(null)])), '3 commits here by Ada, 1 with a Claude-Session trailer');
  assert.equal(personLine(personCardModel('Ada', [c(null)])), '1 commit here by Ada');
  assert.equal(personLine(personCardModel('Ada', [c('session_x'), c('session_y')])), '2 commits here by Ada, 2 with a Claude-Session trailer');
  const now = 10 * 3600 * 1000;
  assert.equal(fetchedLine(null, now), 'never fetched');
  assert.equal(fetchedLine(now - 2 * 3600 * 1000, now), 'fetched 2h ago');
  const r = remoteCardModel('origin/feature', [c(null), c(null)], now - 60 * 1000, now);
  assert.equal(remoteLine(r), '2 commits only on origin/feature');
  assert.equal(r.fetched, 'fetched 1m ago');
});

test('the forecast lines (M9 fix 320): one per other lane in its name and colour, the base line stale from forty behind, none for a gone session', () => {
  const report = { conflicts: [{ a: 's1', b: 's2', files: ['style.css', 'protocol.ts', 'x.ts'] }, { a: 's1', b: 's3', files: ['a.ts'] }], base: { s1: { ahead: 12, behind: 40, forkedAt: NOW - 2 * 24 * 3_600_000, defaultBranch: 'main', repo: 'r' }, s2: { ahead: 1, behind: 0, forkedAt: NOW - 3_600_000, defaultBranch: 'main', repo: 'r' } } };
  const peers = new Map([['s2', { name: 'fix-live-count', color: '#00ff00' }], ['s3', { name: 'fix-week', color: null }]]);
  const m = laneCardModel(session(), shown, NOW, { report, peers });
  assert.deepEqual(m.conflicts.map((l) => [l.name, l.color, l.files]), [['fix-live-count', '#00ff00', 'style.css and 2 more'], ['fix-week', null, 'a.ts']]);
  assert.deepEqual(m.base, { text: '12 ahead, 40 behind main, forked 2d ago', stale: true, behind: 40 });
  const other = laneCardModel(session({ id: 's2' }), shown, NOW, { report, peers: new Map([['s1', { name: 'graph work', color: '#ff0000' }]]) });
  assert.deepEqual(other.conflicts.map((l) => [l.name, l.files]), [['graph work', 'style.css and 2 more']]);
  assert.equal(other.base!.stale, false);
  assert.equal(laneCardModel(session({ id: 's4' }), shown, NOW, { report, peers }).base, null, 'no base line without a reading');
  assert.deepEqual(laneCardModel(session({ state: 'exited' }), shown, NOW, { report, peers }).conflicts, [], 'an exited session left the forecast');
  assert.deepEqual(laneCardModel(session(), shown, NOW).conflicts, [], 'no forecast handed in reads as none');
});
