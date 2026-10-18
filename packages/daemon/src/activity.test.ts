import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import type { SessionInfo } from '@emerald/shared';
import { costParts, ratesFor } from '@emerald/shared';
import { spawn } from 'node:child_process';
import { isFullPayloadLine, slimHookLine } from '@emerald/shared/hook-log';
import { ActivityLog, generationPaths, parseActivityLine, parseLogLine, rotateHookLog, rotatedPath } from './activity.ts';

const quiet = { info() {}, warn() {}, error() {} };

// The sink's line shape, the parts the log reads plus the payload's prompt.
function line(at: number, sessionId: string, event: string, from: string | null, to: string | null, prompt?: string): string {
  return JSON.stringify({ at, sessionId, event, outcome: 'applied', ...(from === null ? {} : { from }), ...(to === null ? {} : { to }), payload: { hook_event_name: event, session_id: 'c-' + sessionId, ...(prompt === undefined ? {} : { prompt }) } });
}

function session(id: string, over: Partial<SessionInfo>): SessionInfo {
  return { id, kind: 'claude', name: id, color: '#123456', state: 'idle', stateSince: 0, createdAt: 0, ...over } as SessionInfo;
}

const T0 = 1_700_000_000_000;
const MIN = 60_000;

// a: two turns, 10 minutes and 5 minutes; b: one turn still open; a line
// the daemon tore mid-write; a shell in the list with no hooks at all.
const FIXTURE = [
  line(T0, 'a', 'SessionStart', null, 'idle'),
  line(T0 + 1 * MIN, 'a', 'UserPromptSubmit', 'idle', 'working', 'find every caller of dropSession'),
  line(T0 + 3 * MIN, 'a', 'PreToolUse', null, null),
  line(T0 + 11 * MIN, 'a', 'Stop', 'working', 'done'),
  line(T0 + 20 * MIN, 'a', 'UserPromptSubmit', 'done', 'working', 'now fix it'),
  line(T0 + 25 * MIN, 'a', 'Stop', 'working', 'done'),
  line(T0 + 22 * MIN, 'b', 'UserPromptSubmit', 'idle', 'working', 'plan the batch'),
  '{"at": 17, "sessionId": "b", "event": "PreToo',
].join('\n');

test('parseActivityLine reads the sink shape and skips a torn line', () => {
  const l = parseActivityLine(line(5, 'x', 'UserPromptSubmit', 'idle', 'working', 'hello\nthere'));
  assert.deepEqual(l, { at: 5, sessionId: 'x', event: 'UserPromptSubmit', from: 'idle', to: 'working', prompt: 'hello', claudeSessionId: 'c-x', agentId: null, agentType: null, description: null, running: null, usage: null, usd: null, model: null, effort: null, unhosted: false, cwd: null });
  assert.equal(parseActivityLine('{"at": 17, "sessionId": "b", "event": "PreToo'), null);
  assert.equal(parseActivityLine('{"sessionId": "b"}'), null);
});

test.after(removeTemps);

test('a session with two turns gives two spans carrying their prompts', async () => {
  const dir = mkTemp('emerald-activity-');
  const file = path.join(dir, 'hooks.jsonl');
  fs.writeFileSync(file, FIXTURE + '\n');
  const log = await ActivityLog.load(file, quiet);
  const now = T0 + 30 * MIN;
  const out = log.spans(T0, now, now, [session('a', { state: 'done', stateSince: T0 + 25 * MIN }), session('b', { state: 'working', stateSince: T0 + 22 * MIN })]);
  const a = out.find((s) => s.sessionId === 'a');
  assert.ok(a);
  assert.equal(a.lifetime, false);
  assert.deepEqual(a.spans, [
    { from: T0 + 1 * MIN, to: T0 + 11 * MIN, prompt: 'find every caller of dropSession' },
    { from: T0 + 20 * MIN, to: T0 + 25 * MIN, prompt: 'now fix it' },
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an open span runs to now while the session works, and to its state change once it does not', () => {
  const log = new ActivityLog();
  for (const raw of FIXTURE.split('\n')) {
    const l = parseActivityLine(raw);
    if (l !== null) log.record(l);
  }
  const now = T0 + 30 * MIN;
  const working = log.spans(T0, now, now, [session('b', { state: 'working', stateSince: T0 + 22 * MIN })]);
  assert.deepEqual(working.find((s) => s.sessionId === 'b')?.spans, [{ from: T0 + 22 * MIN, to: now, prompt: 'plan the batch' }]);
  const idle = log.spans(T0, now, now, [session('b', { state: 'idle', stateSince: T0 + 27 * MIN })]);
  assert.deepEqual(idle.find((s) => s.sessionId === 'b')?.spans, [{ from: T0 + 22 * MIN, to: T0 + 27 * MIN, prompt: 'plan the batch' }]);
  // Exited: at the earlier of the exit and the last line (M9 fix 461).
  const exited = log.spans(T0, now, now, [session('b', { state: 'exited', stateSince: T0 + 27 * MIN })]);
  assert.deepEqual(exited.find((s) => s.sessionId === 'b')?.spans, [{ from: T0 + 22 * MIN, to: T0 + 22 * MIN, prompt: 'plan the batch' }]);
  // Gone from the list: the span ends at the session's last line.
  const gone = log.spans(T0, now, now, []);
  const b = gone.find((s) => s.sessionId === 'b');
  assert.deepEqual(b?.spans, [{ from: T0 + 22 * MIN, to: T0 + 22 * MIN, prompt: 'plan the batch' }]);
  assert.equal(b?.name, null);
});

// M9 fix 461 (the ledger's M27): a session restored after a daemon that
// died without its exit reads exited with stateSince at the new daemon's
// start, so its open turn ends at its last line, not across the outage.
test('a restored exited session\'s open span and open wait end at its last line, not at the new daemon\'s start (M9 fix 461)', () => {
  const log = new ActivityLog();
  log.record(parseActivityLine(line(T0 + 1 * MIN, 'r', 'UserPromptSubmit', 'idle', 'working', 'overnight'))!);
  log.record(parseActivityLine(line(T0 + 3 * MIN, 'r', 'PreToolUse', null, null))!);
  log.record(parseActivityLine(line(T0 + 5 * MIN, 'q', 'Stop', 'working', 'done'))!);
  // The daemon died at 6 min; the next started at 9 h.
  const restart = T0 + 9 * 60 * MIN;
  const now = restart + 10 * MIN;
  const out = log.spans(T0, now, now, [session('r', { state: 'exited', stateSince: restart }), session('q', { state: 'exited', stateSince: restart })]);
  assert.deepEqual(out.find((s) => s.sessionId === 'r')?.spans, [{ from: T0 + 1 * MIN, to: T0 + 3 * MIN, prompt: 'overnight' }]);
  // The unread wait of q ends at its own last line, which is where it opened: nothing owed.
  assert.deepEqual(out.find((s) => s.sessionId === 'q')?.debt ?? [], []);
  // An exited session whose state changed before its last line (a hook after the exit) ends at the state change.
  const early = log.spans(T0, now, now, [session('r', { state: 'exited', stateSince: T0 + 2 * MIN })]);
  assert.deepEqual(early.find((s) => s.sessionId === 'r')?.spans, [{ from: T0 + 1 * MIN, to: T0 + 2 * MIN, prompt: 'overnight' }]);
});

// M9 fix 461 (the ledger's M30): a clock set back mid-turn closes the
// span at zero length rather than a negative one the renderer drops.
test('a line earlier than the open span\'s start closes it at zero length, and the day\'s other turns are unchanged (M9 fix 461)', () => {
  const log = new ActivityLog();
  log.record(parseActivityLine(line(T0 + 1 * MIN, 'k', 'UserPromptSubmit', 'idle', 'working', 'first'))!);
  log.record(parseActivityLine(line(T0 + 4 * MIN, 'k', 'Stop', 'working', 'done'))!);
  log.record(parseActivityLine(line(T0 + 10 * MIN, 'k', 'UserPromptSubmit', 'done', 'working', 'second'))!);
  // The clock went back two minutes before the Stop.
  log.record(parseActivityLine(line(T0 + 8 * MIN, 'k', 'Stop', 'working', 'done'))!);
  // And a new turn opened on the set-back clock, then a working line into working closes a stale open span.
  log.record(parseActivityLine(line(T0 + 20 * MIN, 'k', 'UserPromptSubmit', 'done', 'working', 'third'))!);
  log.record(parseActivityLine(line(T0 + 19 * MIN, 'k', 'UserPromptSubmit', 'idle', 'working', 'fourth'))!);
  log.record(parseActivityLine(line(T0 + 22 * MIN, 'k', 'Stop', 'working', 'done'))!);
  const now = T0 + 30 * MIN;
  const spans = log.spans(T0, now, now, [session('k', { state: 'done', stateSince: T0 + 22 * MIN })]).find((s) => s.sessionId === 'k')?.spans;
  assert.ok(spans);
  for (const s of spans) assert.ok(s.to >= s.from, `no negative span: ${JSON.stringify(s)}`);
  assert.deepEqual(spans, [
    { from: T0 + 1 * MIN, to: T0 + 4 * MIN, prompt: 'first' },
    { from: T0 + 10 * MIN, to: T0 + 10 * MIN, prompt: 'second' },
    { from: T0 + 19 * MIN, to: T0 + 22 * MIN, prompt: 'fourth' },
    { from: T0 + 20 * MIN, to: T0 + 20 * MIN, prompt: 'third' },
  ]);
});

test('spans are clipped to the window and sessions outside it are left out', () => {
  const log = new ActivityLog();
  for (const raw of FIXTURE.split('\n')) {
    const l = parseActivityLine(raw);
    if (l !== null) log.record(l);
  }
  const now = T0 + 30 * MIN;
  const out = log.spans(T0 + 5 * MIN, T0 + 21 * MIN, now, [session('a', { state: 'done', stateSince: T0 + 25 * MIN })]);
  assert.deepEqual(out.map((s) => s.sessionId), ['a']);
  assert.deepEqual(out[0]?.spans, [
    { from: T0 + 5 * MIN, to: T0 + 11 * MIN, prompt: 'find every caller of dropSession' },
    { from: T0 + 20 * MIN, to: T0 + 21 * MIN, prompt: 'now fix it' },
  ]);
  assert.deepEqual(log.spans(T0 + 40 * MIN, T0 + 50 * MIN, now, []), []);
});

test('a shell with no hooks is one lifetime span, dim, and a session recorded live is the same as one loaded', () => {
  const log = new ActivityLog();
  log.recordHook('c', { hook_event_name: 'UserPromptSubmit', prompt: 'ship it' }, T0 + 2 * MIN, { from: 'idle', to: 'working' });
  log.recordHook('c', { hook_event_name: 'Stop' }, T0 + 4 * MIN, { from: 'working', to: 'done' });
  const now = T0 + 10 * MIN;
  const out = log.spans(T0, now, now, [
    session('c', { state: 'done', stateSince: T0 + 4 * MIN }),
    session('sh', { kind: 'shell', createdAt: T0 + 1 * MIN, state: 'idle', stateSince: T0 + 1 * MIN }),
    session('old', { kind: 'shell', createdAt: T0 - 5 * MIN, state: 'exited', stateSince: T0 + 3 * MIN }),
  ]);
  assert.deepEqual(
    out.map((s) => [s.sessionId, s.lifetime, s.spans]),
    [
      ['old', true, [{ from: T0, to: T0 + 3 * MIN, prompt: null }]],
      ['sh', true, [{ from: T0 + 1 * MIN, to: now, prompt: null }]],
      ['c', false, [{ from: T0 + 2 * MIN, to: T0 + 4 * MIN, prompt: 'ship it' }]],
    ],
  );
});

test('a removed session names its track as it was, and an unnamed track carries the Claude id off its lines (M57)', () => {
  const log = new ActivityLog();
  for (const raw of FIXTURE.split('\n')) {
    const l = parseActivityLine(raw);
    if (l !== null) log.record(l);
  }
  const now = T0 + 30 * MIN;
  // b was cleared from the list; the daemon still hands its record in.
  const removed = session('b', { name: 'the batch', color: '#abcdef', state: 'exited', stateSince: T0 + 27 * MIN, claudeSessionId: 'c-b', removedAt: T0 + 29 * MIN, cwd: 'C:\\code\\emerald\\packages', groupCwd: 'C:\\code\\emerald' });
  const b = log.spans(T0, now, now, [removed]).find((s) => s.sessionId === 'b');
  assert.equal(b?.name, 'the batch');
  assert.equal(b?.color, '#abcdef');
  assert.equal(b?.claudeSessionId, 'c-b');
  assert.equal(b?.removedAt, T0 + 29 * MIN);
  // M9 fix 215: the record's folders ride the row, so a folder scope can
  // keep a removed session.
  assert.equal(b?.cwd, 'C:\\code\\emerald\\packages');
  assert.equal(b?.groupCwd, 'C:\\code\\emerald');
  assert.deepEqual(b?.commits, []);
  // No record at all: unnamed, but the conversation id is still known
  // from the lines, so a renderer can look the title up.
  const gone = log.spans(T0, now, now, []).find((s) => s.sessionId === 'b');
  assert.equal(gone?.name, null);
  assert.equal(gone?.claudeSessionId, 'c-b');
  assert.equal(gone?.removedAt, null);
  assert.equal(gone?.cwd, null);
  assert.equal(gone?.groupCwd, null);
});

// The team lines the sink writes (M62): the parent's SubagentStart and
// SubagentStop, the Agent tool's PostToolUse, and a Stop with the tasks
// still running.
function teamLine(at: number, sessionId: string, event: string, extra: Record<string, unknown>): string {
  return JSON.stringify({ at, sessionId, event, outcome: 'applied', payload: { hook_event_name: event, session_id: 'c-' + sessionId, ...extra } });
}

test('parseActivityLine reads the team lines: the agent id and type, the description, a Stop\'s running tasks', () => {
  const start = parseActivityLine(teamLine(1, 'p', 'SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }));
  assert.deepEqual([start?.agentId, start?.agentType, start?.description, start?.running], ['a1', 'Explore', null, null]);
  const tool = parseActivityLine(teamLine(2, 'p', 'PostToolUse', { tool_name: 'Agent', tool_input: { description: 'Read the log\nand more', subagent_type: 'fork' }, tool_response: { agentId: 'a2', description: 'Read the log' } }));
  assert.deepEqual([tool?.agentId, tool?.agentType, tool?.description], ['a2', 'fork', 'Read the log']);
  // An Agent call fired inside a subagent belongs to that agent, not the parent.
  const inner = parseActivityLine(teamLine(3, 'p', 'PostToolUse', { agent_id: 'a2', tool_name: 'Agent', tool_response: { agentId: 'a9' } }));
  assert.equal(inner?.agentId, null);
  const stop = parseActivityLine(teamLine(4, 'p', 'Stop', { background_tasks: [{ id: 'a2', status: 'running', type: 'agent' }, { id: 'a1', status: 'completed', type: 'agent' }, { status: 'running', type: 'shell', command: 'npm test' }] }));
  assert.deepEqual(stop?.running, ['a2']);
  assert.deepEqual(parseActivityLine(teamLine(5, 'p', 'Stop', {}))?.running, []);
});

test('an agent is a row of its own under its parent, named by its description or its type, closed by its stop or the parent\'s Stop', () => {
  const log = new ActivityLog();
  const raw = [
    line(T0, 'p', 'UserPromptSubmit', 'idle', 'working', 'run the batch'),
    teamLine(T0 + 1 * MIN, 'p', 'SubagentStart', { agent_id: 'a1', agent_type: 'fork' }),
    teamLine(T0 + 1 * MIN + 1, 'p', 'PostToolUse', { tool_name: 'Agent', tool_input: { description: 'fix-title: fixes 93 and 96', subagent_type: 'fork' }, tool_response: { agentId: 'a1', description: 'fix-title: fixes 93 and 96' } }),
    teamLine(T0 + 2 * MIN, 'p', 'SubagentStart', { agent_id: 'a2', agent_type: 'Explore' }),
    // An inner agent's stop, never started here: nothing.
    teamLine(T0 + 3 * MIN, 'p', 'SubagentStop', { agent_id: 'inner', agent_type: '' }),
    teamLine(T0 + 6 * MIN, 'p', 'SubagentStop', { agent_id: 'a1', agent_type: 'fork' }),
    JSON.stringify({ at: T0 + 8 * MIN, sessionId: 'p', event: 'Stop', outcome: 'applied', from: 'working', to: 'done', payload: { hook_event_name: 'Stop', session_id: 'c-p' } }),
  ];
  for (const r of raw) {
    const l = parseActivityLine(r);
    assert.ok(l, r);
    log.record(l);
  }
  const now = T0 + 10 * MIN;
  const parent = session('p', { state: 'done', stateSince: T0 + 8 * MIN, color: '#abcdef' });
  const out = log.spans(T0, now, now, [parent]);
  assert.deepEqual(
    out.map((s) => [s.sessionId, s.kind, s.name, s.color, s.parentId, s.agentId, s.agentType, s.spans]),
    [
      ['p', 'claude', 'p', '#abcdef', null, null, null, [{ from: T0, to: T0 + 8 * MIN, prompt: 'run the batch' }]],
      ['p', 'agent', 'fix-title: fixes 93 and 96', '#abcdef', 'p', 'a1', 'fork', [{ from: T0 + 1 * MIN, to: T0 + 6 * MIN, prompt: null }]],
      // No stop of its own: the parent's Stop listed no running task, so it returned there.
      ['p', 'agent', 'Explore', '#abcdef', 'p', 'a2', 'Explore', [{ from: T0 + 2 * MIN, to: T0 + 8 * MIN, prompt: null }]],
    ],
  );
});

test('an agent the parent\'s Stop still lists runs on: to now while the team says running, else to the parent\'s last line', () => {
  const log = new ActivityLog();
  const raw = [
    line(T0, 'p', 'UserPromptSubmit', 'idle', 'working', 'fork them'),
    teamLine(T0 + 1 * MIN, 'p', 'SubagentStart', { agent_id: 'a1', agent_type: 'fork' }),
    JSON.stringify({ at: T0 + 2 * MIN, sessionId: 'p', event: 'Stop', outcome: 'applied', from: 'working', to: 'waiting', payload: { hook_event_name: 'Stop', session_id: 'c-p', background_tasks: [{ id: 'a1', status: 'running', type: 'agent' }] } }),
    teamLine(T0 + 5 * MIN, 'p', 'PreToolUse', { tool_name: 'Read' }),
  ];
  for (const r of raw) {
    const l = parseActivityLine(r);
    assert.ok(l, r);
    log.record(l);
  }
  const now = T0 + 9 * MIN;
  const running = session('p', { state: 'waiting', stateSince: T0 + 2 * MIN, team: [{ id: 'a1', kind: 'agent', type: 'fork', description: null, command: null, startedAt: T0 + 1 * MIN, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [], activity: null }] });
  const live = log.spans(T0, now, now, [running]);
  assert.deepEqual(live.find((s) => s.agentId === 'a1')?.spans, [{ from: T0 + 1 * MIN, to: now, prompt: null }]);
  // The parent gone from the list: the agent ends at the parent's last line.
  const gone = log.spans(T0, now, now, []);
  assert.deepEqual(gone.map((s) => [s.agentId, s.name, s.spans[0]?.to]), [[null, null, T0 + 2 * MIN], ['a1', 'fork', T0 + 5 * MIN]]);
  // The window past the parent's own span: the agent's row stands alone.
  const later = log.spans(T0 + 3 * MIN, now, now, [running]);
  assert.deepEqual(later.map((s) => [s.agentId, s.parentId]), [['a1', 'p']]);
});

// A status line as the wrapper posts it (M9 fix 217): the request's
// input split and output, Claude Code's cost so far and the model, and
// the effort level when one is named (M9 fix 800).
function statusLine(at: number, sessionId: string, usage: { fresh: number; cacheWrite: number; cacheRead: number; output: number }, usd: number | null, model = 'Opus 5', effort?: string): string {
  const payload: Record<string, unknown> = {
    hook_event_name: 'StatusLine',
    session_id: 'c-' + sessionId,
    model: { display_name: model },
    context_window: { used_percentage: 12, current_usage: { input_tokens: usage.fresh, cache_creation_input_tokens: usage.cacheWrite, cache_read_input_tokens: usage.cacheRead, output_tokens: usage.output } },
  };
  if (usd !== null) payload['cost'] = { total_cost_usd: usd };
  if (effort !== undefined) payload['effort'] = { level: effort };
  return JSON.stringify({ at, sessionId, event: 'StatusLine', outcome: 'applied', payload });
}

test('status lines fold into request points: a streaming line updates the open point, a new split opens one, the cost is the delta and null when the line carried none (M9 fix 217)', () => {
  const log = new ActivityLog();
  const raw = [
    line(T0, 'a', 'UserPromptSubmit', 'idle', 'working', 'go'),
    // The first request streams: 2 output tokens, then 362, at one split.
    statusLine(T0 + 1 * MIN, 'a', { fresh: 400, cacheWrite: 8000, cacheRead: 12000, output: 2 }, 0.05),
    statusLine(T0 + 2 * MIN, 'a', { fresh: 400, cacheWrite: 8000, cacheRead: 12000, output: 362 }, 0.12),
    // A new split is a new request; its cost is the delta over 0.12.
    statusLine(T0 + 3 * MIN, 'a', { fresh: 30, cacheWrite: 500, cacheRead: 20000, output: 90 }, 0.2),
    // A third with no cost block: null, for the rates to price.
    statusLine(T0 + 4 * MIN, 'a', { fresh: 10, cacheWrite: 0, cacheRead: 20500, output: 40 }, null, 'Sonnet 5'),
    // A fake's status line with a percentage alone opens nothing.
    JSON.stringify({ at: T0 + 5 * MIN, sessionId: 'a', event: 'StatusLine', outcome: 'applied', payload: { hook_event_name: 'StatusLine', session_id: 'c-a', context_window: { used_percentage: 40 } } }),
  ];
  for (const r of raw) {
    const l = parseActivityLine(r);
    assert.ok(l, r);
    log.record(l);
  }
  const now = T0 + 10 * MIN;
  const a = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 })]).find((s) => s.sessionId === 'a');
  assert.deepEqual(a?.requests, [
    { at: T0 + 1 * MIN, fresh: 400, cacheWrite: 8000, cacheRead: 12000, output: 362, usd: 0.12, model: 'Opus 5', effort: null },
    { at: T0 + 3 * MIN, fresh: 30, cacheWrite: 500, cacheRead: 20000, output: 90, usd: 0.2 - 0.12, model: 'Opus 5', effort: null },
    { at: T0 + 4 * MIN, fresh: 10, cacheWrite: 0, cacheRead: 20500, output: 40, usd: null, model: 'Sonnet 5', effort: null },
  ]);
  // Clipped to the window by the time the point opened.
  const late = log.spans(T0 + 3 * MIN + 1, now, now, [session('a', { state: 'working', stateSince: T0 })]).find((s) => s.sessionId === 'a');
  assert.deepEqual(late?.requests.map((r) => r.at), [T0 + 4 * MIN]);
  // With a since: the points a line touched at or after it, so the first
  // point (opened at 1 min, its stream's last line at 2) is in a since of
  // 2 min and out of one at 3, where the later two are new.
  const since = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 })], T0 + 2 * MIN).find((s) => s.sessionId === 'a');
  assert.deepEqual(since?.requests.map((r) => r.at), [T0 + 1 * MIN, T0 + 3 * MIN, T0 + 4 * MIN]);
  const later = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 })], T0 + 3 * MIN).find((s) => s.sessionId === 'a');
  assert.deepEqual(later?.requests.map((r) => r.at), [T0 + 3 * MIN, T0 + 4 * MIN]);
  const none = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 })], T0 + 9 * MIN).find((s) => s.sessionId === 'a');
  assert.deepEqual(none?.requests, []);
});

test('a status line\'s effort rides on its line and its request point, the last one carried as the model is (M9 fix 800)', () => {
  const at = (r: string) => {
    const l = parseActivityLine(r);
    assert.ok(l, r);
    return l;
  };
  assert.equal(at(statusLine(T0, 'a', { fresh: 1, cacheWrite: 0, cacheRead: 0, output: 1 }, null, 'Opus 5', 'high')).effort, 'high');
  assert.equal(at(statusLine(T0, 'a', { fresh: 1, cacheWrite: 0, cacheRead: 0, output: 1 }, null)).effort, null, 'a line without the block');
  const log = new ActivityLog();
  const raw = [
    line(T0, 'a', 'UserPromptSubmit', 'idle', 'working', 'go'),
    // The first request streams: its first line has no effort, its last says high.
    statusLine(T0 + 1 * MIN, 'a', { fresh: 400, cacheWrite: 8000, cacheRead: 12000, output: 2 }, 0.05),
    statusLine(T0 + 2 * MIN, 'a', { fresh: 400, cacheWrite: 8000, cacheRead: 12000, output: 362 }, 0.12, 'Opus 5', 'high'),
    // A second request after an /effort: medium.
    statusLine(T0 + 3 * MIN, 'a', { fresh: 30, cacheWrite: 500, cacheRead: 20000, output: 90 }, 0.2, 'Opus 5', 'medium'),
    // A streaming line without the block keeps the point's level.
    statusLine(T0 + 4 * MIN, 'a', { fresh: 30, cacheWrite: 500, cacheRead: 20000, output: 120 }, 0.21),
  ];
  for (const r of raw) log.record(at(r));
  const now = T0 + 10 * MIN;
  const a = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 })]).find((s) => s.sessionId === 'a');
  assert.deepEqual(a?.requests.map((r) => [r.at, r.output, r.effort]), [
    [T0 + 1 * MIN, 362, 'high'],
    [T0 + 3 * MIN, 120, 'medium'],
  ]);
});

// M9 fix 462 (the ledger's L33 and L34): a track's first kept point prices
// from nothing only when it is plainly a process's first (its total under
// fifty cents, or its SessionStart seen); a track whose earlier lines a
// rotation dropped is estimated from the rates instead. And a total below
// the one the point opened on is a new process (a resume), priced whole.
test('a first kept line carrying a whole running total is estimated, and a resume\'s first request is priced whole (M9 fix 462)', () => {
  const log = new ActivityLog();
  const split = (n: number) => ({ fresh: n, cacheWrite: 100, cacheRead: 5000, output: 50 });
  log.record(parseActivityLine(line(T0, 'started', 'SessionStart', null, 'idle'))!);
  for (const id of ['old', 'fresh', 'started', 'resumed']) log.record(parseActivityLine(line(T0 + 30_000, id, 'UserPromptSubmit', 'idle', 'working', 'go'))!);
  // A four-day process whose first days were rotated away: $60 on its first kept line.
  log.record(parseActivityLine(statusLine(T0 + 1 * MIN, 'old', split(1), 60))!);
  log.record(parseActivityLine(statusLine(T0 + 2 * MIN, 'old', split(2), 60.4))!);
  // A fresh process: a small first total prices from nothing.
  log.record(parseActivityLine(statusLine(T0 + 1 * MIN, 'fresh', split(1), 0.05))!);
  // A process whose SessionStart was seen (above) prices from nothing whatever its first total.
  log.record(parseActivityLine(statusLine(T0 + 1 * MIN, 'started', split(1), 0.9))!);
  // A resume: $40 in the old process, then the new process's $0.30 streaming to $0.45, then a next request.
  log.record(parseActivityLine(statusLine(T0 + 1 * MIN, 'resumed', split(1), 0.2))!);
  log.record(parseActivityLine(statusLine(T0 + 2 * MIN, 'resumed', split(2), 40))!);
  log.record(parseActivityLine(statusLine(T0 + 5 * MIN, 'resumed', split(3), 0.3))!);
  log.record(parseActivityLine(statusLine(T0 + 6 * MIN, 'resumed', split(3), 0.45))!);
  log.record(parseActivityLine(statusLine(T0 + 7 * MIN, 'resumed', split(4), 0.5))!);
  const now = T0 + 10 * MIN;
  const rows = log.spans(T0, now, now, ['old', 'fresh', 'started', 'resumed'].map((id) => session(id, { state: 'working', stateSince: T0 })));
  const usd = (id: string) => rows.find((s) => s.sessionId === id)?.requests.map((r) => (r.usd === null ? null : Math.round(r.usd * 100) / 100));
  assert.deepEqual(usd('old'), [null, 0.4]);
  assert.deepEqual(usd('fresh'), [0.05]);
  assert.deepEqual(usd('started'), [0.9]);
  assert.deepEqual(usd('resumed'), [0.2, 39.8, 0.45, 0.05]);
});

// M9 fix 218: a row carries the record's credited commits claimed inside
// the window, the merge flag read as false where a record predates it;
// a member's commits folded into the record (fix 138) stay off the
// session's own row, and an agent's row carries its member's.
test('a row carries its record\'s commits inside the window, merges flagged, an agent\'s its member\'s (M9 fix 218)', () => {
  const log = new ActivityLog();
  for (const raw of FIXTURE.split('\n')) {
    const l = parseActivityLine(raw);
    if (l !== null) log.record(l);
  }
  log.record(parseActivityLine(teamLine(T0 + 2 * MIN, 'a', 'SubagentStart', { agent_id: 'ag1', agent_type: 'fork' }))!);
  const now = T0 + 30 * MIN;
  const commits = [
    { hash: 'h1', at: T0 - 1 * MIN },
    { hash: 'h2', at: T0 + 5 * MIN },
    { hash: 'h3', at: T0 + 6 * MIN, merge: true },
    { hash: 'h4', at: T0 + 7 * MIN, agent: { id: 'ag1', branch: null, type: 'fork', description: null } },
  ];
  const team = [{ id: 'ag1', kind: 'agent', type: 'fork', description: null, command: null, startedAt: T0 + 2 * MIN, endedAt: null, outcome: 'running', cwd: null, branch: null, commits: [{ hash: 'h5', at: T0 + 8 * MIN, merge: true }], activity: null }];
  const out = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 + 20 * MIN, commits, team } as Partial<SessionInfo>)]);
  const a = out.find((s) => s.sessionId === 'a' && s.agentId === null);
  assert.deepEqual(a?.commits, [
    { hash: 'h2', at: T0 + 5 * MIN, merge: false },
    { hash: 'h3', at: T0 + 6 * MIN, merge: true },
  ]);
  const agent = out.find((s) => s.agentId === 'ag1');
  assert.deepEqual(agent?.commits, [{ hash: 'h5', at: T0 + 8 * MIN, merge: true }]);
  // A window before the claims: none.
  const early = log.spans(T0, T0 + 4 * MIN, now, [session('a', { state: 'working', stateSince: T0, commits } as Partial<SessionInfo>)]).find((s) => s.sessionId === 'a' && s.agentId === null);
  assert.deepEqual(early?.commits, []);
});

// M9 fix 231: the waiting stretches. An asked stretch runs from the line
// into needs-input to the line out with no grace; an unread one from the
// done line plus the minute's grace to the next prompt, so a done
// answered at 59 s is nothing and one answered at 61 s is one second; an
// open one runs to now while the record is still in that state, and to
// the record's state change once it is not.
test('asked and unread stretches ride the row beside the working spans, the grace on unread alone (M9 fix 231)', () => {
  const SEC = 1000;
  const log = new ActivityLog();
  const lines = [
    line(T0, 'a', 'SessionStart', null, 'idle'),
    // Turn one: a permission asked at +2m, answered at +6m.
    line(T0 + 1 * MIN, 'a', 'UserPromptSubmit', 'idle', 'working', 'one'),
    line(T0 + 2 * MIN, 'a', 'Notification', 'working', 'needs-input'),
    line(T0 + 6 * MIN, 'a', 'PostToolUse', 'needs-input', 'working'),
    // Done at +10m, the next prompt 59 s later: inside the grace.
    line(T0 + 10 * MIN, 'a', 'Stop', 'working', 'done'),
    line(T0 + 10 * MIN + 59 * SEC, 'a', 'UserPromptSubmit', 'done', 'working', 'two'),
    // Done at +20m, the next prompt 61 s later: one second unread.
    line(T0 + 20 * MIN, 'a', 'Stop', 'working', 'done'),
    line(T0 + 20 * MIN + 61 * SEC, 'a', 'UserPromptSubmit', 'done', 'working', 'three'),
    // A question at +25m, still open.
    line(T0 + 25 * MIN, 'a', 'Notification', 'working', 'needs-input'),
  ];
  for (const raw of lines) log.record(parseActivityLine(raw)!);
  const now = T0 + 30 * MIN;
  const asking = log.spans(T0, now, now, [session('a', { state: 'needs-input', stateSince: T0 + 25 * MIN })]).find((s) => s.sessionId === 'a');
  assert.deepEqual(asking?.debt, [
    { from: T0 + 2 * MIN, to: T0 + 6 * MIN, kind: 'asked' },
    { from: T0 + 21 * MIN, to: T0 + 20 * MIN + 61 * SEC, kind: 'unread' },
    { from: T0 + 25 * MIN, to: now, kind: 'asked' },
  ]);
  // The working spans close at an ask as they always did (the asked time
  // is not agent time), so the two kinds tile the turn between them.
  assert.deepEqual(asking?.spans.map((sp) => [sp.from, sp.to]), [
    [T0 + 1 * MIN, T0 + 2 * MIN],
    [T0 + 6 * MIN, T0 + 10 * MIN],
    [T0 + 10 * MIN + 59 * SEC, T0 + 20 * MIN],
    [T0 + 20 * MIN + 61 * SEC, T0 + 25 * MIN],
  ]);
  // The record answered since (no line yet): the open ask ends where
  // its state changed. Gone from the list: at its last line.
  const answered = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 + 28 * MIN })]).find((s) => s.sessionId === 'a');
  assert.deepEqual(answered?.debt[2], { from: T0 + 25 * MIN, to: T0 + 28 * MIN, kind: 'asked' });
  const gone = log.spans(T0, now, now, []).find((s) => s.sessionId === 'a');
  assert.equal(gone?.debt.length, 2);
  // Clipped to the window, and a stretch cut to nothing is not sent.
  const clipped = log.spans(T0 + 4 * MIN, T0 + 21 * MIN, now, [session('a', { state: 'needs-input', stateSince: T0 + 25 * MIN })]).find((s) => s.sessionId === 'a');
  assert.deepEqual(clipped?.debt, [{ from: T0 + 4 * MIN, to: T0 + 6 * MIN, kind: 'asked' }]);
  // A shell's lifetime row and an agent's row carry none.
  const sh = log.spans(T0, now, now, [session('sh', { kind: 'shell', createdAt: T0, state: 'idle', stateSince: T0 })]).find((s) => s.sessionId === 'sh');
  assert.deepEqual(sh?.debt, []);
});

test('a stretch left open by a daemon that died mid-wait closes where the next line finds another state (M9 fix 231)', () => {
  const log = new ActivityLog();
  log.record(parseActivityLine(line(T0 + 1 * MIN, 'a', 'UserPromptSubmit', 'idle', 'working', 'one'))!);
  log.record(parseActivityLine(line(T0 + 2 * MIN, 'a', 'Stop', 'working', 'done'))!);
  // The daemon came back to a session it read as idle, then a new turn.
  log.record(parseActivityLine(line(T0 + 9 * MIN, 'a', 'SessionStart', null, 'idle'))!);
  log.record(parseActivityLine(line(T0 + 12 * MIN, 'a', 'UserPromptSubmit', 'idle', 'working', 'two'))!);
  const now = T0 + 20 * MIN;
  const a = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 + 12 * MIN })]).find((s) => s.sessionId === 'a');
  assert.deepEqual(a?.debt, [{ from: T0 + 3 * MIN, to: T0 + 9 * MIN, kind: 'unread' }]);
});

// M9 fix 245: attention debt while nobody is at the box. An away line
// (the last app window gone, the screen locked) opens an away stretch,
// a back line closes it, and every waiting stretch is docked by the
// away it overlaps: an asked one loses the overlap outright, an unread
// one loses it and then the grace runs again from the return, since a
// person back at nine who answers by 9:01 owes nothing. The docked
// time rides the row as awayMs for the tooltip.
test('waiting stretches are docked by the away stretches they overlap, the grace running again from the return (M9 fix 245)', async () => {
  const log = new ActivityLog();
  const presence = (at: number, kind: 'away' | 'back') => JSON.stringify({ at, presence: kind });
  const lines = [
    // a: asked at +10m, away from +20m to +30m, answered at +40m: the
    // question loses the ten minutes in the middle and splits in two.
    line(T0 + 1 * MIN, 'a', 'UserPromptSubmit', 'idle', 'working', 'one'),
    line(T0 + 10 * MIN, 'a', 'Notification', 'working', 'needs-input'),
    presence(T0 + 20 * MIN, 'away'),
    presence(T0 + 30 * MIN, 'back'),
    line(T0 + 40 * MIN, 'a', 'PostToolUse', 'needs-input', 'working'),
    // b: done at +50m, away from +49m to +55m, the next prompt at +58m:
    // the unread runs from the return plus the grace, +56m to +58m.
    line(T0 + 45 * MIN, 'b', 'UserPromptSubmit', 'idle', 'working', 'two'),
    presence(T0 + 49 * MIN, 'away'),
    line(T0 + 50 * MIN, 'b', 'Stop', 'working', 'done'),
    presence(T0 + 55 * MIN, 'back'),
    line(T0 + 58 * MIN, 'b', 'UserPromptSubmit', 'done', 'working', 'three'),
    // c: asked at +61m and answered at +63m, wholly inside an away from
    // +60m to +70m: nothing owed. A second away inside the open one and
    // a back with none open change nothing.
    line(T0 + 59 * MIN, 'c', 'UserPromptSubmit', 'idle', 'working', 'four'),
    presence(T0 + 60 * MIN, 'away'),
    presence(T0 + 62 * MIN, 'away'),
    line(T0 + 61 * MIN, 'c', 'Notification', 'working', 'needs-input'),
    line(T0 + 63 * MIN, 'c', 'PostToolUse', 'needs-input', 'working'),
    presence(T0 + 70 * MIN, 'back'),
    presence(T0 + 71 * MIN, 'back'),
    // d: done at +75m with the box left at +80m and nobody back: the
    // open away runs to now and the unread stops at its edge.
    line(T0 + 72 * MIN, 'd', 'UserPromptSubmit', 'idle', 'working', 'five'),
    line(T0 + 75 * MIN, 'd', 'Stop', 'working', 'done'),
    presence(T0 + 80 * MIN, 'away'),
  ];
  for (const raw of lines) log.record(parseLogLine(raw)!);
  assert.equal(log.isAway, true);
  const now = T0 + 100 * MIN;
  const rows = log.spans(T0, now, now, [session('d', { state: 'done', stateSince: T0 + 75 * MIN })]);
  const row = (id: string) => rows.find((s) => s.sessionId === id)!;
  assert.deepEqual(row('a').debt, [
    { from: T0 + 10 * MIN, to: T0 + 20 * MIN, kind: 'asked' },
    { from: T0 + 30 * MIN, to: T0 + 40 * MIN, kind: 'asked' },
  ]);
  assert.equal(row('a').awayMs, 10 * MIN);
  assert.deepEqual(row('b').debt, [{ from: T0 + 56 * MIN, to: T0 + 58 * MIN, kind: 'unread' }]);
  // What the window counted before the docking, +51m to +55m.
  assert.equal(row('b').awayMs, 4 * MIN);
  assert.deepEqual(row('c').debt, []);
  assert.equal(row('c').awayMs, 2 * MIN);
  assert.deepEqual(row('d').debt, [{ from: T0 + 76 * MIN, to: T0 + 80 * MIN, kind: 'unread' }]);
  assert.equal(row('d').awayMs, 20 * MIN);
  // The window clips the figure as it clips the stretches (the window
  // holds a's first working span, or it would have no row at all).
  const clipped = log.spans(T0 + 5 * MIN, T0 + 25 * MIN, now, []).find((s) => s.sessionId === 'a')!;
  assert.deepEqual(clipped.debt, [{ from: T0 + 10 * MIN, to: T0 + 20 * MIN, kind: 'asked' }]);
  assert.equal(clipped.awayMs, 5 * MIN);
  // The lines read back from the file at the next start say the same.
  const dir = mkTemp('emerald-activity-');
  const file = path.join(dir, 'hooks.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const reloaded = await ActivityLog.load(file, quiet);
  assert.equal(reloaded.isAway, true);
  assert.equal(reloaded.spans(T0, now, now, []).find((s) => s.sessionId === 'a')!.awayMs, 10 * MIN);
  // A hook's parser skips a presence line, as emmer explain does.
  assert.equal(parseActivityLine(presence(T0, 'away')), null);
  // recordPresence says whether the edge changed anything, so the
  // daemon writes only the lines that mean something.
  const fresh = new ActivityLog();
  assert.equal(fresh.recordPresence('back', T0), false);
  assert.equal(fresh.recordPresence('away', T0), true);
  assert.equal(fresh.recordPresence('away', T0 + MIN), false);
  assert.equal(fresh.recordPresence('back', T0 + 2 * MIN), true);
  assert.equal(fresh.recordPresence('back', T0 + 3 * MIN), false);
});

// M9 fix 285: capped bands. A capped line (a usage window at 100
// percent, with its reset) opens a band for that window, a freed line
// closes it at the earlier of the edge and the reset, and a band with
// no freed closes at its reset on its own; the bands ride the answer
// beside the rows, cut to the window, and every waiting stretch is
// docked by them as by the away stretches, the docked time on the row
// as cappedMs.
test('capped lines open bands per usage window, closed by freed or the reset, and dock the waiting like the away stretches (M9 fix 285)', async () => {
  const log = new ActivityLog();
  const capped = (at: number, window: string, resetsAt: number) => JSON.stringify({ at, capped: { window, resetsAt } });
  const freed = (at: number, window: string) => JSON.stringify({ at, freed: { window } });
  const lines = [
    // a: asked at +10m, the five-hour window spent from +20m to +30m
    // (freed at +30m, the reset an hour off): the question loses the
    // ten minutes and splits in two, as under an away.
    line(T0 + 1 * MIN, 'a', 'UserPromptSubmit', 'idle', 'working', 'one'),
    line(T0 + 10 * MIN, 'a', 'Notification', 'working', 'needs-input'),
    capped(T0 + 20 * MIN, 'five_hour', T0 + 90 * MIN),
    freed(T0 + 30 * MIN, 'five_hour'),
    line(T0 + 40 * MIN, 'a', 'PostToolUse', 'needs-input', 'working'),
    // b: done at +50m with the weekly window spent from +45m and never
    // freed, its reset at +55m: the band closes at the reset and the
    // unread runs from there plus the grace, +56m to +58m.
    line(T0 + 44 * MIN, 'b', 'UserPromptSubmit', 'idle', 'working', 'two'),
    capped(T0 + 45 * MIN, 'seven_day', T0 + 55 * MIN),
    line(T0 + 50 * MIN, 'b', 'Stop', 'working', 'done'),
    line(T0 + 58 * MIN, 'b', 'UserPromptSubmit', 'done', 'working', 'three'),
    // A second capped on the same window while its band is open is the
    // same cap; one after its reset is a new band, open to now.
    capped(T0 + 46 * MIN, 'seven_day', T0 + 55 * MIN),
    capped(T0 + 70 * MIN, 'seven_day', T0 + 200 * MIN),
    // A freed with no band open changes nothing.
    freed(T0 + 71 * MIN, 'five_hour'),
  ];
  for (const raw of lines) log.record(parseLogLine(raw)!);
  const now = T0 + 100 * MIN;
  assert.deepEqual(log.cappedSpans(T0, now, now), [
    { from: T0 + 20 * MIN, to: T0 + 30 * MIN, window: 'five_hour', resetsAt: T0 + 90 * MIN },
    { from: T0 + 45 * MIN, to: T0 + 55 * MIN, window: 'seven_day', resetsAt: T0 + 55 * MIN },
    { from: T0 + 70 * MIN, to: now, window: 'seven_day', resetsAt: T0 + 200 * MIN },
  ]);
  // Cut to the window, the open band to its end.
  assert.deepEqual(log.cappedSpans(T0 + 25 * MIN, T0 + 80 * MIN, now), [
    { from: T0 + 25 * MIN, to: T0 + 30 * MIN, window: 'five_hour', resetsAt: T0 + 90 * MIN },
    { from: T0 + 45 * MIN, to: T0 + 55 * MIN, window: 'seven_day', resetsAt: T0 + 55 * MIN },
    { from: T0 + 70 * MIN, to: T0 + 80 * MIN, window: 'seven_day', resetsAt: T0 + 200 * MIN },
  ]);
  const rows = log.spans(T0, now, now, [session('b', { state: 'working', stateSince: T0 + 58 * MIN })]);
  const row = (id: string) => rows.find((s) => s.sessionId === id)!;
  assert.deepEqual(row('a').debt, [
    { from: T0 + 10 * MIN, to: T0 + 20 * MIN, kind: 'asked' },
    { from: T0 + 30 * MIN, to: T0 + 40 * MIN, kind: 'asked' },
  ]);
  assert.equal(row('a').cappedMs, 10 * MIN);
  assert.equal(row('a').awayMs, 0);
  assert.deepEqual(row('b').debt, [{ from: T0 + 56 * MIN, to: T0 + 58 * MIN, kind: 'unread' }]);
  // What the window counted before the docking, +51m to +55m.
  assert.equal(row('b').cappedMs, 4 * MIN);
  // The lines read back from the file at the next start say the same.
  const dir = mkTemp('emerald-activity-');
  const file = path.join(dir, 'hooks.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const reloaded = await ActivityLog.load(file, quiet);
  assert.equal(reloaded.cappedSpans(T0, now, now).length, 3);
  assert.equal(reloaded.spans(T0, now, now, []).find((s) => s.sessionId === 'a')!.cappedMs, 10 * MIN);
  // A hook's parser skips a usage line, as emmer explain does.
  assert.equal(parseActivityLine(capped(T0, 'five_hour', T0 + MIN)), null);
  assert.equal(parseActivityLine(freed(T0, 'five_hour')), null);
  // recordCapped and recordFreed say whether the edge changed anything.
  const fresh = new ActivityLog();
  assert.equal(fresh.recordFreed('five_hour', T0), false);
  assert.equal(fresh.recordCapped('five_hour', T0 + 60 * MIN, T0), true);
  assert.equal(fresh.recordCapped('five_hour', T0 + 60 * MIN, T0 + MIN), false);
  assert.equal(fresh.recordFreed('five_hour', T0 + 2 * MIN), true);
  assert.equal(fresh.recordFreed('five_hour', T0 + 3 * MIN), false);
  // A band under an away stretch is cut once and counted in both figures.
  const both = new ActivityLog();
  for (const raw of [
    line(T0 + 1 * MIN, 'c', 'UserPromptSubmit', 'idle', 'working', 'four'),
    line(T0 + 10 * MIN, 'c', 'Notification', 'working', 'needs-input'),
    JSON.stringify({ at: T0 + 20 * MIN, presence: 'away' }),
    capped(T0 + 25 * MIN, 'five_hour', T0 + 35 * MIN),
    JSON.stringify({ at: T0 + 30 * MIN, presence: 'back' }),
    line(T0 + 40 * MIN, 'c', 'PostToolUse', 'needs-input', 'working'),
  ]) both.record(parseLogLine(raw)!);
  const c = both.spans(T0, now, now, []).find((s) => s.sessionId === 'c')!;
  assert.deepEqual(c.debt, [
    { from: T0 + 10 * MIN, to: T0 + 20 * MIN, kind: 'asked' },
    { from: T0 + 35 * MIN, to: T0 + 40 * MIN, kind: 'asked' },
  ]);
  assert.equal(c.awayMs, 10 * MIN);
  assert.equal(c.cappedMs, 10 * MIN);
});

// M9 fix 233: a Claude emerald did not start posts under its own
// conversation id with the unhosted mark, and the daemon's bare record
// for it (unhosted.ts) is handed in beside the sessions.
test('an unhosted track has spans and no record: outside, unnamed, in the folder its hooks named, live to now while its bare record works (M9 fix 233)', () => {
  const log = new ActivityLog();
  const conv = 'conv-outside';
  const unhostedLine = (at: number, event: string, from: string | null, to: string | null) => JSON.stringify({ at, sessionId: conv, event, unhosted: true, outcome: 'applied', ...(from === null ? {} : { from }), ...(to === null ? {} : { to }), payload: { hook_event_name: event, session_id: conv, cwd: 'C:/code/elsewhere' } });
  for (const raw of [unhostedLine(T0, 'SessionStart', 'starting', 'idle'), unhostedLine(T0 + 1 * MIN, 'UserPromptSubmit', 'idle', 'working'), unhostedLine(T0 + 4 * MIN, 'Stop', 'working', 'done'), unhostedLine(T0 + 6 * MIN, 'UserPromptSubmit', 'done', 'working')]) {
    const l = parseActivityLine(raw);
    assert.ok(l !== null && l.unhosted && l.cwd === 'C:/code/elsewhere', 'the line reads the mark and the folder');
    log.record(l);
  }
  const now = T0 + 10 * MIN;
  // No record and no bare record (a daemon restarted): the open span ends at the last line.
  const gone = log.spans(T0, now, now, []).find((s) => s.sessionId === conv);
  assert.ok(gone);
  assert.equal(gone.outside, true);
  assert.equal(gone.name, null);
  assert.equal(gone.claudeSessionId, conv);
  assert.equal(gone.cwd, 'C:/code/elsewhere');
  assert.equal(gone.groupCwd, 'C:/code/elsewhere');
  assert.deepEqual(gone.spans, [
    { from: T0 + 1 * MIN, to: T0 + 4 * MIN, prompt: null },
    { from: T0 + 6 * MIN, to: T0 + 6 * MIN, prompt: null },
  ]);
  // The bare record says it is working: the open span runs to now.
  const bare = session(conv, { state: 'working', stateSince: T0 + 6 * MIN, cwd: 'C:/code/elsewhere', groupCwd: 'C:/code/elsewhere', claudeSessionId: conv });
  const live = log.spans(T0, now, now, [], null, [bare]).find((s) => s.sessionId === conv);
  assert.deepEqual(live?.spans.at(-1), { from: T0 + 6 * MIN, to: now, prompt: null });
  assert.equal(live?.outside, true);
  assert.equal(live?.name, null, 'a bare record never names the track');
  // A hosted track is not outside.
  log.recordHook('h', { hook_event_name: 'UserPromptSubmit' }, T0 + 2 * MIN, { from: 'idle', to: 'working' });
  assert.equal(log.spans(T0, now, now, []).find((s) => s.sessionId === 'h')?.outside, false);
});

test('an outside track resumed in a pane joins its record\'s row (M9 fix 233)', () => {
  const log = new ActivityLog();
  const conv = 'conv-resumed';
  log.recordHook(conv, { hook_event_name: 'UserPromptSubmit', session_id: conv, cwd: 'C:/x' }, T0 + 1 * MIN, { from: 'idle', to: 'working' }, true);
  log.recordHook(conv, { hook_event_name: 'Stop', session_id: conv, cwd: 'C:/x' }, T0 + 3 * MIN, { from: 'working', to: 'done' }, true);
  // Then the pane's record, whose SessionStart bound the same conversation.
  log.recordHook('pane', { hook_event_name: 'UserPromptSubmit', session_id: conv }, T0 + 5 * MIN, { from: 'idle', to: 'working' });
  log.recordHook('pane', { hook_event_name: 'Stop', session_id: conv }, T0 + 7 * MIN, { from: 'working', to: 'done' });
  const now = T0 + 10 * MIN;
  const out = log.spans(T0, now, now, [session('pane', { state: 'done', stateSince: T0 + 7 * MIN, claudeSessionId: conv })]);
  assert.deepEqual(out.map((s) => s.sessionId), ['pane']);
  assert.deepEqual(out[0]?.spans, [
    { from: T0 + 1 * MIN, to: T0 + 3 * MIN, prompt: null },
    { from: T0 + 5 * MIN, to: T0 + 7 * MIN, prompt: null },
  ]);
  assert.equal(out[0]?.outside, false);
  assert.equal(out[0]?.name, 'pane');
  // The record not listed: the outside row stands on its own.
  const alone = log.spans(T0, now, now, []);
  assert.deepEqual(alone.map((s) => [s.sessionId, s.outside]), [[conv, true], ['pane', false]]);
});

// M9 fix 463 (the ledger's L37): the join carries the outside row's
// waiting and its docked figures, and its agents follow it to the owner.
test('an outside track joined to a pane\'s record keeps its asked stretch and its agent under the owner (M9 fix 463)', () => {
  const log = new ActivityLog();
  const conv = 'conv-asked';
  const out = (at: number, payload: Record<string, unknown>, result: { from?: string; to?: string }) => log.recordHook(conv, { session_id: conv, cwd: 'C:/x', ...payload } as never, at, result, true);
  out(T0 + 1 * MIN, { hook_event_name: 'UserPromptSubmit' }, { from: 'idle', to: 'working' });
  out(T0 + 2 * MIN, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'Explore' }, {});
  out(T0 + 4 * MIN, { hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_type: 'Explore' }, {});
  // A twenty-minute question.
  out(T0 + 5 * MIN, { hook_event_name: 'PermissionRequest' }, { from: 'working', to: 'needs-input' });
  out(T0 + 25 * MIN, { hook_event_name: 'PostToolUse' }, { from: 'needs-input', to: 'working' });
  out(T0 + 26 * MIN, { hook_event_name: 'Stop' }, { from: 'working', to: 'done' });
  // Then resumed in a pane.
  log.recordHook('pane', { hook_event_name: 'UserPromptSubmit', session_id: conv }, T0 + 30 * MIN, { from: 'idle', to: 'working' });
  log.recordHook('pane', { hook_event_name: 'Stop', session_id: conv }, T0 + 32 * MIN, { from: 'working', to: 'done' });
  const now = T0 + 33 * MIN;
  const rows = log.spans(T0, now, now, [session('pane', { state: 'idle', stateSince: T0 + 32 * MIN, claudeSessionId: conv, color: '#abcdef' })]);
  assert.deepEqual(rows.map((r) => [r.sessionId, r.kind, r.parentId]), [['pane', 'claude', null], ['pane', 'agent', 'pane']]);
  assert.deepEqual(rows[0]?.debt.filter((d) => d.kind === 'asked'), [{ from: T0 + 5 * MIN, to: T0 + 25 * MIN, kind: 'asked' }]);
  assert.equal(rows[1]?.color, '#abcdef', 'the agent wears its owner\'s colour');
  assert.deepEqual(rows[1]?.spans, [{ from: T0 + 2 * MIN, to: T0 + 4 * MIN, prompt: null }]);
});

test('the load streams the rotated generation then the current file, and rotates a file past the threshold first (M9 fix 377)', async () => {
  const dir = mkTemp('emerald-activity-');
  const file = path.join(dir, 'hooks.jsonl');
  const older = rotatedPath(file);
  assert.equal(path.basename(older), 'hooks.1.jsonl');
  // Two generations: a's first turn in the rotated file, its second in
  // the current one; the spans read as one history.
  fs.writeFileSync(older, [line(T0, 'a', 'SessionStart', null, 'idle'), line(T0 + 1 * MIN, 'a', 'UserPromptSubmit', 'idle', 'working', 'first'), line(T0 + 11 * MIN, 'a', 'Stop', 'working', 'done')].join('\n') + '\n');
  fs.writeFileSync(file, [line(T0 + 20 * MIN, 'a', 'UserPromptSubmit', 'done', 'working', 'second'), line(T0 + 25 * MIN, 'a', 'Stop', 'working', 'done'), '{"at": 17, "sessionId": "b", "event": "PreToo'].join('\n') + '\n');
  const loaded: Array<Record<string, unknown>> = [];
  const noting = { info: (_msg: string, data?: unknown) => loaded.push({ msg: _msg, ...(data as Record<string, unknown>) }), warn() {}, error() {} };
  const log = await ActivityLog.load(file, noting);
  const now = T0 + 30 * MIN;
  assert.deepEqual(log.spans(T0, now, now, [session('a', { state: 'done', stateSince: T0 + 25 * MIN })]).find((s) => s.sessionId === 'a')?.spans, [
    { from: T0 + 1 * MIN, to: T0 + 11 * MIN, prompt: 'first' },
    { from: T0 + 20 * MIN, to: T0 + 25 * MIN, prompt: 'second' },
  ]);
  const summary = loaded.find((l) => l['msg'] === 'activity log loaded')!;
  assert.equal(summary['hooks.1.jsonl'], 3);
  assert.equal(summary['hooks.jsonl'], 2, 'the torn line is not counted');
  assert.equal(typeof summary['ms'], 'number');
  assert.equal(loaded.some((l) => l['msg'] === 'hooks.jsonl rotated'), false, 'a small file is not rotated');
  // Past the threshold the current file becomes generation 1 and the one
  // that was generation 1 shifts to 2 (M9 fix 415: it used to be dropped
  // here), so both turns are still read and the current file is left for
  // the sink to make.
  loaded.length = 0;
  const size = fs.statSync(file).size;
  const again = await ActivityLog.load(file, noting, { rotateAtBytes: size - 1 });
  assert.equal(fs.existsSync(file), false, 'the current file was renamed');
  assert.ok(fs.readFileSync(older, 'utf8').includes('"second"'), 'the rotated file is the one that was current');
  assert.ok(fs.readFileSync(rotatedPath(file, 2), 'utf8').includes('"first"'), 'the generation before it shifted down rather than going');
  assert.equal(loaded.some((l) => l['msg'] === 'hooks.jsonl rotated'), true);
  const after = loaded.find((l) => l['msg'] === 'activity log loaded')!;
  assert.equal(after['hooks.2.jsonl'], 3);
  assert.equal(after['hooks.1.jsonl'], 2);
  assert.equal(after['hooks.jsonl'], 0);
  assert.deepEqual(again.spans(T0, now, now, [session('a', { state: 'done', stateSince: T0 + 25 * MIN })]).find((s) => s.sessionId === 'a')?.spans, [
    { from: T0 + 1 * MIN, to: T0 + 11 * MIN, prompt: 'first' },
    { from: T0 + 20 * MIN, to: T0 + 25 * MIN, prompt: 'second' },
  ]);
  // A missing file on both sides is an empty history, no warning.
  const empty = await ActivityLog.load(path.join(dir, 'none.jsonl'), noting);
  assert.deepEqual(empty.spans(T0, now, now, []), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a hook recorded while the log loads is held and lands once, after the files (M9 fix 517)', async () => {
  const dir = mkTemp('emerald-activity-open-');
  const file = path.join(dir, 'hooks.jsonl');
  fs.writeFileSync(file, [line(T0, 'a', 'UserPromptSubmit', 'idle', 'working', 'first'), line(T0 + 5 * MIN, 'a', 'Stop', 'working', 'done')].join('\n') + '\n');
  const loaded: Array<Record<string, unknown>> = [];
  const noting = { info: (_msg: string, data?: unknown) => loaded.push({ msg: _msg, ...(data as Record<string, unknown>) }), warn() {}, error() {} };
  const log = ActivityLog.open(file, noting);
  // The sink appends the line to the file as well; open took the size
  // before, so the file's copy is never read back.
  log.recordHook('a', { hook_event_name: 'UserPromptSubmit', prompt: 'second' }, T0 + 10 * MIN, { from: 'done', to: 'working' });
  fs.appendFileSync(file, line(T0 + 10 * MIN, 'a', 'UserPromptSubmit', 'done', 'working', 'second') + '\n');
  assert.equal(loaded.some((l) => l['msg'] === 'activity log loaded'), false, 'not loaded yet');
  await log.loaded;
  const now = T0 + 12 * MIN;
  const spans = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 + 10 * MIN })]).find((s) => s.sessionId === 'a')?.spans;
  assert.deepEqual(spans, [
    { from: T0, to: T0 + 5 * MIN, prompt: 'first' },
    { from: T0 + 10 * MIN, to: now, prompt: 'second' },
  ]);
  const summary = loaded.find((l) => l['msg'] === 'activity log loaded')!;
  assert.equal(summary['held'], 1);
  assert.equal(summary['hooks.jsonl'], 2, 'the line appended after the open is not read from the file');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('past the cap the oldest held line is dropped, with one warn (M9 fix 517)', async () => {
  const dir = mkTemp('emerald-activity-cap-');
  const file = path.join(dir, 'hooks.jsonl');
  fs.writeFileSync(file, line(T0, 'z', 'SessionStart', null, 'idle') + '\n');
  const warns: string[] = [];
  const noting = { info() {}, warn: (msg: string) => warns.push(msg), error() {} };
  const log = ActivityLog.open(file, noting, { heldCap: 2 });
  log.recordHook('a', { hook_event_name: 'UserPromptSubmit', prompt: 'one' }, T0 + 1 * MIN, { from: 'idle', to: 'working' });
  log.recordHook('a', { hook_event_name: 'Stop' }, T0 + 2 * MIN, { from: 'working', to: 'done' });
  log.recordHook('a', { hook_event_name: 'UserPromptSubmit', prompt: 'three' }, T0 + 3 * MIN, { from: 'done', to: 'working' });
  await log.loaded;
  assert.deepEqual(warns, ['activity log: more than 2 lines arrived during the load; dropping the oldest']);
  const now = T0 + 4 * MIN;
  // The first line went, so the Stop closes nothing it opened and the
  // third's turn is the one span.
  const spans = log.spans(T0, now, now, [session('a', { state: 'working', stateSince: T0 + 3 * MIN })]).find((s) => s.sessionId === 'a')?.spans;
  assert.deepEqual(spans, [{ from: T0 + 3 * MIN, to: now, prompt: 'three' }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('generations are kept while their total is under the budget, the oldest dropped first past it (M9 fix 415, 629)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-gen-'));
  const file = path.join(dir, 'hooks.jsonl');
  const loaded: Array<Record<string, unknown>> = [];
  const noting = { info: (_msg: string, data?: unknown) => loaded.push({ msg: _msg, ...(data as Record<string, unknown>) }), warn: (msg: string) => loaded.push({ msg }), error() {} };
  // One turn per rotation, numbered so the dropped one is named: turn n
  // is written as the current file and rotated by the load that follows.
  const turnAt = (n: number) => T0 + n * 60 * MIN;
  const writeTurn = (n: number) => fs.writeFileSync(file, [line(turnAt(n), 'a', 'UserPromptSubmit', 'done', 'working', `turn${n}`), line(turnAt(n) + 5 * MIN, 'a', 'Stop', 'working', 'done')].join('\n') + '\n');
  // A rotation of whatever the current file holds: the load is asked to
  // rotate by being given a threshold under the file's own size.
  const rotateCurrent = async (budgetBytes?: number) => {
    loaded.length = 0;
    await ActivityLog.load(file, noting, { rotateAtBytes: fs.statSync(file).size - 1, ...(budgetBytes === undefined ? {} : { budgetBytes }) });
  };
  const spansOf = (log: ActivityLog, last: number) => log.spans(T0, turnAt(last + 1), turnAt(last + 1), [session('a', { state: 'done', stateSince: turnAt(last) + 5 * MIN })]).find((s) => s.sessionId === 'a')?.spans;
  // Under the default budget nothing goes: turns 1 to 4 rotated in turn
  // sit in generations 4 to 1, with turn 5 left as the current file.
  for (const n of [1, 2, 3, 4]) {
    writeTurn(n);
    await rotateCurrent();
  }
  writeTurn(5);
  loaded.length = 0;
  const four = await ActivityLog.load(file, noting);
  assert.deepEqual(generationPaths(file).map((p) => path.basename(p)), ['hooks.4.jsonl', 'hooks.3.jsonl', 'hooks.2.jsonl', 'hooks.1.jsonl', 'hooks.jsonl'], 'the load order is oldest first, the current file last');
  const summary = loaded.find((l) => l['msg'] === 'activity log loaded')!;
  assert.deepEqual([summary['hooks.4.jsonl'], summary['hooks.3.jsonl'], summary['hooks.2.jsonl'], summary['hooks.1.jsonl'], summary['hooks.jsonl']], [2, 2, 2, 2, 2], 'every generation is counted on its own');
  assert.deepEqual(spansOf(four, 5), [1, 2, 3, 4, 5].map((n) => ({ from: turnAt(n), to: turnAt(n) + 5 * MIN, prompt: `turn${n}` })), 'five turns over five files, oldest first');
  assert.equal(loaded.some((l) => String(l['msg']).endsWith('dropped')), false);
  // A budget that holds three of these generations: the fifth rotation
  // makes five, and the two oldest go, oldest first.
  const each = fs.statSync(rotatedPath(file, 1)).size;
  const budgetBytes = 3 * each + Math.floor(each / 2);
  await rotateCurrent(budgetBytes);
  const dropped = loaded.filter((l) => String(l['msg']).endsWith('dropped'));
  assert.deepEqual(dropped.map((l) => l['msg']), ['hooks.5.jsonl dropped', 'hooks.4.jsonl dropped'], 'the oldest first');
  assert.equal(dropped[0]!['budget'], budgetBytes);
  assert.ok((dropped.at(-1)!['kept'] as number) <= budgetBytes);
  assert.equal(fs.existsSync(path.join(dir, 'hooks.dropping.jsonl')), false);
  writeTurn(6);
  loaded.length = 0;
  const kept = await ActivityLog.load(file, noting);
  assert.deepEqual(generationPaths(file).map((p) => path.basename(p)), ['hooks.3.jsonl', 'hooks.2.jsonl', 'hooks.1.jsonl', 'hooks.jsonl']);
  assert.deepEqual(spansOf(kept, 6), [3, 4, 5, 6].map((n) => ({ from: turnAt(n), to: turnAt(n) + 5 * MIN, prompt: `turn${n}` })), 'the two oldest turns went with their generations');
  fs.rmSync(dir, { recursive: true, force: true });
  // The listing is by number, not text, and skips the temporaries.
  const listed = fs.realpathSync.native(mkTemp('emerald-activity-list-'));
  const listFile = path.join(listed, 'hooks.jsonl');
  for (const name of ['hooks.9.jsonl', 'hooks.10.jsonl', 'hooks.2.jsonl', 'hooks.rotating.jsonl', 'hooks.slimming.jsonl', 'hooks.dropping.jsonl', 'hooks.1.jsonl.trimming', 'hooks.3.jsonl.slimming', 'hooks.0.jsonl', 'hooks.x.jsonl', 'other.1.jsonl']) fs.writeFileSync(path.join(listed, name), '');
  assert.deepEqual(generationPaths(listFile).map((p) => path.basename(p)), ['hooks.10.jsonl', 'hooks.9.jsonl', 'hooks.2.jsonl', 'hooks.jsonl']);
  assert.deepEqual(generationPaths(path.join(listed, 'none', 'hooks.jsonl')).map((p) => path.basename(p)), ['hooks.jsonl'], 'a missing folder is the current file alone');
  fs.rmSync(listed, { recursive: true, force: true });
});

// A backup copied in as the oldest generation, or a generation an older
// daemon rotated, holds payloads as the sink wrote them; the start slims
// it in place, and drops what is not history (M9 fix 629).
test('a full-payload generation is slimmed in place at the start, its overlap and its fixture lines dropped (M9 fix 629)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-restore-'));
  const file = path.join(dir, 'hooks.jsonl');
  const conv = (at: number, sessionId: string, event: string, claude: string) => JSON.stringify({ at, sessionId, event, outcome: 'applied', from: 'idle', to: 'working', payload: { hook_event_name: event, session_id: claude, prompt: 'a fixture' } });
  const real = [
    line(T0, 'a', 'UserPromptSubmit', 'idle', 'working', 'one'),
    line(T0 + 5 * MIN, 'a', 'Stop', 'working', 'done'),
    line(T0 + 20 * MIN, 'a', 'UserPromptSubmit', 'done', 'working', 'two'),
    line(T0 + 25 * MIN, 'a', 'Stop', 'working', 'done'),
  ];
  const newer = [line(T0 + 100 * MIN, 'a', 'UserPromptSubmit', 'done', 'working', 'three'), line(T0 + 105 * MIN, 'a', 'Stop', 'working', 'done')];
  const fixtures = [
    conv(T0 + 1 * MIN, 'nosuch', 'UserPromptSubmit', 'c-x'),
    conv(T0 + 2 * MIN, 'direct-test', 'Stop', 'c-y'),
    conv(T0 + 3 * MIN, 'b', 'UserPromptSubmit', 'sim-claude-1'),
    conv(T0 + 4 * MIN, 'b', 'UserPromptSubmit', 'nested-claude-p'),
  ];
  // verify:activity's own generations are under sim-gen-*, and load.
  const seeded = conv(T0 + 6 * MIN, 'g', 'Stop', 'sim-gen-two');
  fs.writeFileSync(rotatedPath(file, 2), [real[0], fixtures[0], fixtures[1], real[1], fixtures[2], fixtures[3], seeded, real[2], real[3], ...newer].join('\n') + '\n');
  fs.writeFileSync(rotatedPath(file, 1), newer.join('\n') + '\n');
  const logged: Array<Record<string, unknown>> = [];
  const noting = { info: (msg: string, data?: unknown) => logged.push({ msg, ...(data as Record<string, unknown>) }), warn: (msg: string) => logged.push({ msg }), error() {} };
  const log = await ActivityLog.load(file, noting);
  assert.equal(fs.readFileSync(rotatedPath(file, 2), 'utf8'), [real[0], real[1], seeded, real[2], real[3]].map((l) => slimHookLine(l!)).join('\n') + '\n');
  const slimmed = logged.find((l) => l['msg'] === 'hooks.2.jsonl slimmed')!;
  assert.equal(slimmed['overlap'], 2);
  assert.equal(slimmed['fixtures'], 4);
  assert.equal(slimmed['keptFrom'], new Date(T0).toISOString());
  assert.equal(typeof slimmed['ms'], 'number');
  assert.ok((slimmed['to'] as number) < (slimmed['from'] as number));
  // Generation 1 was full too, and is the newest: no overlap rule for it.
  assert.equal(logged.find((l) => l['msg'] === 'hooks.1.jsonl slimmed')!['overlap'], 0);
  assert.equal(fs.existsSync(`${rotatedPath(file, 2)}.slimming`), false);
  assert.equal(log.historyFrom, T0);
  const now = T0 + 110 * MIN;
  assert.deepEqual(log.spans(T0, now, now, [session('a', { state: 'done', stateSince: T0 + 105 * MIN })]).find((s) => s.sessionId === 'a')?.spans, [
    { from: T0, to: T0 + 5 * MIN, prompt: 'one' },
    { from: T0 + 20 * MIN, to: T0 + 25 * MIN, prompt: 'two' },
    { from: T0 + 100 * MIN, to: T0 + 105 * MIN, prompt: 'three' },
  ], 'the real turns once each');
  // A second start finds every generation slim and passes nothing.
  logged.length = 0;
  await ActivityLog.load(file, noting);
  assert.equal(logged.some((l) => String(l['msg']).endsWith('slimmed')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// Opens a file for read, sharing read and write but not delete, and holds
// it for two seconds in another process; resolves once the handle is
// open, to the holder's exit (wrapped, since an async function that
// returned the bare promise would wait for the exit itself).
async function holdWithoutDelete(file: string): Promise<{ exited: Promise<void> }> {
  const script = `$f = [IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'Read', 'ReadWrite'); [Console]::Out.WriteLine('open'); [Console]::Out.Flush(); Start-Sleep -Milliseconds 2000; $f.Close()`;
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise<void>((resolve) => holder.once('exit', () => resolve()));
  await new Promise<void>((resolve, reject) => {
    holder.stdout!.on('data', (d: Buffer) => { if (d.toString().includes('open')) resolve(); });
    holder.once('exit', () => reject(new Error('the holder exited before opening the file')));
  });
  return { exited };
}

// Another program holding the current file without delete sharing (an
// editor, PowerShell's Get-Content -Wait, a scan) makes the one rename
// that matters fail; the rotation used to have shifted and dropped the
// generations by then, and each hourly retry dropped one more (M9 fix
// 465, the ledger's H4).
test('a rotation that cannot rename the current file leaves every generation as it was (M9 fix 465)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-held-'));
  const file = path.join(dir, 'hooks.jsonl');
  const body = (n: number | 'current') => `{"generation":"${n}"}\n`;
  fs.writeFileSync(file, body('current'));
  for (const n of [1, 2, 3]) fs.writeFileSync(rotatedPath(file, n), body(n));
  const before = generationPaths(file).map((p) => fs.readFileSync(p, 'utf8'));
  const { exited } = await holdWithoutDelete(file);
  const warned: string[] = [];
  const noting = { info() {}, warn: (msg: string) => warned.push(msg), error() {} };
  assert.equal(rotateHookLog(file, noting), false, 'the rotation reports it did not rotate');
  assert.deepEqual(generationPaths(file).map((p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)), before, 'all four files are unchanged');
  assert.equal(fs.existsSync(path.join(dir, 'hooks.rotating.jsonl')), false, 'no temporary is left behind');
  assert.ok(warned.includes('hooks.jsonl could not be rotated'));
  await exited;
  // Released, the next rotation shifts as before: every generation one
  // up (nothing goes under the budget, M9 fix 629), the current file
  // generation 1.
  assert.equal(rotateHookLog(file, quiet), true);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual([4, 3, 2, 1].map((n) => fs.readFileSync(rotatedPath(file, n), 'utf8')), [body(3), body(2), body(1), body('current')]);
  assert.equal(fs.existsSync(path.join(dir, 'hooks.rotating.jsonl')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A generation held the same way used to cost the oldest one (it was
// removed before the held rename was met), and with generation 2 held the
// temporary was renamed over generation 1 while the call said it rotated
// (M9 fix 555): now every step is a rename that is undone.
test('a rotation over a held generation 1 leaves every generation as it was (M9 fix 555)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-heldgen-'));
  const file = path.join(dir, 'hooks.jsonl');
  const body = (n: number | 'current') => `{"generation":"${n}"}\n`;
  fs.writeFileSync(file, body('current'));
  for (const n of [1, 2, 3]) fs.writeFileSync(rotatedPath(file, n), body(n));
  const before = generationPaths(file).map((p) => fs.readFileSync(p, 'utf8'));
  const { exited } = await holdWithoutDelete(rotatedPath(file, 1));
  const warned: string[] = [];
  const noting = { info() {}, warn: (msg: string) => warned.push(msg), error() {} };
  assert.equal(rotateHookLog(file, noting), false, 'the rotation reports it did not rotate');
  assert.deepEqual(generationPaths(file).map((p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)), before, 'all four files are unchanged');
  assert.equal(fs.existsSync(path.join(dir, 'hooks.rotating.jsonl')), false, 'no temporary is left behind');
  assert.equal(fs.existsSync(path.join(dir, 'hooks.dropping.jsonl')), false, 'no dropped generation is left behind');
  assert.ok(warned.includes('hooks.jsonl could not be rotated'), warned.join('; '));
  await exited;
  assert.equal(rotateHookLog(file, quiet), true);
  assert.deepEqual([3, 2, 1].map((n) => fs.readFileSync(rotatedPath(file, n), 'utf8')), [body(2), body(1), body('current')]);
  assert.equal(fs.existsSync(path.join(dir, 'hooks.dropping.jsonl')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a rotation over a held generation 2 leaves every generation as it was (M9 fix 555)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-heldgen-'));
  const file = path.join(dir, 'hooks.jsonl');
  const body = (n: number | 'current') => `{"generation":"${n}"}\n`;
  fs.writeFileSync(file, body('current'));
  for (const n of [1, 2, 3]) fs.writeFileSync(rotatedPath(file, n), body(n));
  const before = generationPaths(file).map((p) => fs.readFileSync(p, 'utf8'));
  const { exited } = await holdWithoutDelete(rotatedPath(file, 2));
  const warned: string[] = [];
  const noting = { info() {}, warn: (msg: string) => warned.push(msg), error() {} };
  assert.equal(rotateHookLog(file, noting), false, 'the rotation reports it did not rotate');
  assert.deepEqual(generationPaths(file).map((p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null)), before, 'all four files are unchanged');
  assert.equal(fs.existsSync(path.join(dir, 'hooks.rotating.jsonl')), false, 'no temporary is left behind');
  assert.equal(fs.existsSync(path.join(dir, 'hooks.dropping.jsonl')), false, 'no dropped generation is left behind');
  assert.ok(warned.includes('hooks.jsonl could not be rotated'), warned.join('; '));
  await exited;
  assert.equal(rotateHookLog(file, quiet), true);
  assert.deepEqual([3, 2, 1].map((n) => fs.readFileSync(rotatedPath(file, n), 'utf8')), [body(2), body(1), body('current')]);
  assert.equal(fs.existsSync(path.join(dir, 'hooks.dropping.jsonl')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A drop a rotation left half done is removed by the next start (M9 fix
// 555), so it cannot hold up the next rotation's drop.
test('a hooks.dropping.jsonl left in the folder is gone after the start opens the log (M9 fix 555)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-dropping-'));
  const file = path.join(dir, 'hooks.jsonl');
  fs.writeFileSync(path.join(dir, 'hooks.dropping.jsonl'), '{"old":true}\n');
  const activity = ActivityLog.open(file, quiet);
  await activity.loaded;
  assert.equal(fs.existsSync(path.join(dir, 'hooks.dropping.jsonl')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A trim cut short leaves its temporary as a slim does (M9 fix 650): the
// start removes both, and the generations they were cut from stand whole.
test('a cut-short trim or slim leaves no temporary after the start opens the log, and the generations stand whole (M9 fix 650)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-temps-'));
  const file = path.join(dir, 'hooks.jsonl');
  const gen2 = [line(T0 - 10 * MIN, 'a', 'UserPromptSubmit', 'idle', 'working', 'old'), line(T0 - 9 * MIN, 'a', 'Stop', 'working', 'done')].map(slimHookLine).join('\n') + '\n';
  const gen1 = [line(T0, 'a', 'UserPromptSubmit', 'done', 'working', 'new'), line(T0 + MIN, 'a', 'Stop', 'working', 'done')].map(slimHookLine).join('\n') + '\n';
  fs.writeFileSync(rotatedPath(file, 2), gen2);
  fs.writeFileSync(rotatedPath(file, 1), gen1);
  fs.writeFileSync(path.join(dir, 'hooks.1.jsonl.trimming'), '{"partial":true}\n');
  fs.writeFileSync(path.join(dir, 'hooks.2.jsonl.slimming'), '{"partial":true}\n');
  await ActivityLog.open(file, quiet).loaded;
  assert.equal(fs.existsSync(path.join(dir, 'hooks.1.jsonl.trimming')), false, 'the trim\'s temporary is gone');
  assert.equal(fs.existsSync(path.join(dir, 'hooks.2.jsonl.slimming')), false, 'the slim\'s temporary is gone');
  assert.equal(fs.readFileSync(rotatedPath(file, 2), 'utf8'), gen2);
  assert.equal(fs.readFileSync(rotatedPath(file, 1), 'utf8'), gen1);
  fs.rmSync(dir, { recursive: true, force: true });
});

// A generation from before the live rotation can be hundreds of
// megabytes; past four times the threshold the load cuts it to its
// newest threshold's worth of whole lines (M9 fix 466, the ledger's M18).
test('an oversized generation is cut to its newest lines at the start, each kept line whole (M9 fix 466)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-trim-'));
  const file = path.join(dir, 'hooks.jsonl');
  const rotateAtBytes = 4096;
  // Two hundred turns of session a, a minute apart, about 50 KB: past
  // four times the threshold.
  const lines: string[] = [];
  for (let n = 0; n < 200; n++) {
    lines.push(line(T0 + n * 2 * MIN, 'a', 'UserPromptSubmit', 'done', 'working', `turn${n}`));
    lines.push(line(T0 + (n * 2 + 1) * MIN, 'a', 'Stop', 'working', 'done'));
  }
  const gen1 = rotatedPath(file, 1);
  fs.writeFileSync(gen1, lines.join('\n') + '\n');
  // Still past the ceiling once slimmed (M9 fix 629), so the trim runs.
  const slim = lines.map(slimHookLine);
  assert.ok(Buffer.byteLength(slim.join('\n') + '\n') > 4 * rotateAtBytes);
  // A generation under the ceiling is slimmed and not cut; its lines are
  // older than generation 1's, so no overlap drops them.
  const before = [0, 1, 2, 3].map((n) => line(T0 - (10 - n) * MIN, 'a', n % 2 === 0 ? 'UserPromptSubmit' : 'Stop', n % 2 === 0 ? 'done' : 'working', n % 2 === 0 ? 'working' : 'done', n % 2 === 0 ? `before${n}` : undefined));
  fs.writeFileSync(rotatedPath(file, 2), before.join('\n') + '\n');
  const small = before.map(slimHookLine).join('\n') + '\n';
  const logged: Array<Record<string, unknown>> = [];
  const noting = { info: (msg: string, data?: unknown) => logged.push({ msg, ...(data as Record<string, unknown>) }), warn: (msg: string) => logged.push({ msg }), error() {} };
  const log = await ActivityLog.load(file, noting, { rotateAtBytes });
  const size = fs.statSync(gen1).size;
  assert.ok(size <= rotateAtBytes && size > rotateAtBytes / 2, `cut to at most the threshold (${size})`);
  const kept = fs.readFileSync(gen1, 'utf8').split('\n').filter((l) => l !== '');
  assert.ok(kept.every((l) => parseActivityLine(l) !== null), 'every kept line parses');
  assert.equal(kept.at(-1), slim.at(-1), 'the newest line is kept');
  assert.equal(slim.slice(-kept.length).join('\n'), kept.join('\n'), 'the kept lines are the newest, slimmed, in order and whole');
  assert.equal(fs.readFileSync(rotatedPath(file, 2), 'utf8'), small);
  assert.equal(fs.existsSync(`${gen1}.trimming`), false);
  const trimmed = logged.find((l) => l['msg'] === 'hooks.1.jsonl trimmed')!;
  assert.equal(trimmed['to'], size);
  assert.equal(trimmed['keptFrom'], new Date(parseActivityLine(kept[0]!)!.at).toISOString());
  // The spans read the kept turns: the last one is turn199.
  const spans = log.spans(T0, T0 + 500 * MIN, T0 + 500 * MIN, [session('a', { state: 'done', stateSince: T0 + 399 * MIN })]).find((s) => s.sessionId === 'a')!.spans;
  assert.equal(spans.at(-1)?.prompt, 'turn199');
  assert.ok(spans.length < 200);
  fs.rmSync(dir, { recursive: true, force: true });
});

// M9 fix 607: how far back the history reaches is the earliest line any
// generation holds, whatever its kind and wherever it was read.
test('historyFrom is the earliest line across every generation, a presence line and a clock set back included (M9 fix 607)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-from-'));
  const file = path.join(dir, 'hooks.jsonl');
  fs.writeFileSync(rotatedPath(file, 3), JSON.stringify({ at: T0, presence: 'away' }) + '\n' + line(T0 + 5 * MIN, 'a', 'UserPromptSubmit', 'idle', 'working') + '\n');
  fs.writeFileSync(rotatedPath(file, 1), line(T0 + 60 * MIN, 'a', 'Stop', 'working', 'done') + '\n');
  // Stamped under a clock set back: the earliest, not the first read.
  fs.writeFileSync(file, line(T0 - 10 * MIN, 'b', 'UserPromptSubmit', 'idle', 'working') + '\n');
  const logged: Array<Record<string, unknown>> = [];
  const noting = { info: (msg: string, data?: unknown) => logged.push({ msg, ...(data as Record<string, unknown>) }), warn: (msg: string) => logged.push({ msg }), error() {} };
  const log = await ActivityLog.load(file, noting);
  assert.equal(log.historyFrom, T0 - 10 * MIN);
  const loaded = logged.find((l) => l['msg'] === 'activity log loaded')!;
  assert.equal(loaded['oldest'], new Date(T0 - 10 * MIN).toISOString());
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an empty log has no historyFrom until its first hook (M9 fix 607)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-from-empty-'));
  const file = path.join(dir, 'hooks.jsonl');
  const logged: Array<Record<string, unknown>> = [];
  const noting = { info: (msg: string, data?: unknown) => logged.push({ msg, ...(data as Record<string, unknown>) }), warn: (msg: string) => logged.push({ msg }), error() {} };
  const log = await ActivityLog.load(file, noting);
  assert.equal(log.historyFrom, null);
  assert.equal(logged.find((l) => l['msg'] === 'activity log loaded')!['oldest'], null);
  log.recordHook('a', { hook_event_name: 'UserPromptSubmit' }, T0, { from: 'idle', to: 'working' });
  assert.equal(log.historyFrom, T0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// The trim's fixture without the small second generation, whose lines
// are older than any kept one.
test('a trimmed generation\'s history starts at its first kept line (M9 fix 466, 607)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-from-trim-'));
  const file = path.join(dir, 'hooks.jsonl');
  const rotateAtBytes = 4096;
  const lines: string[] = [];
  for (let n = 0; n < 200; n++) {
    lines.push(line(T0 + n * 2 * MIN, 'a', 'UserPromptSubmit', 'done', 'working', `turn${n}`));
    lines.push(line(T0 + (n * 2 + 1) * MIN, 'a', 'Stop', 'working', 'done'));
  }
  const gen1 = rotatedPath(file, 1);
  fs.writeFileSync(gen1, lines.join('\n') + '\n');
  const logged: Array<Record<string, unknown>> = [];
  const noting = { info: (msg: string, data?: unknown) => logged.push({ msg, ...(data as Record<string, unknown>) }), warn: (msg: string) => logged.push({ msg }), error() {} };
  const log = await ActivityLog.load(file, noting, { rotateAtBytes });
  const kept = fs.readFileSync(gen1, 'utf8').split('\n').filter((l) => l !== '');
  const first = parseActivityLine(kept[0]!)!.at;
  assert.equal(log.historyFrom, first);
  assert.ok(first > T0, 'the trim cut the oldest lines');
  const iso = new Date(first).toISOString();
  assert.equal(logged.find((l) => l['msg'] === 'hooks.1.jsonl trimmed')!['keptFrom'], iso);
  assert.equal(logged.find((l) => l['msg'] === 'activity log loaded')!['oldest'], iso);
  fs.rmSync(dir, { recursive: true, force: true });
});

// M9 fix 629: the rotated generations keep only what the activity view
// reads. The fixture covers every branch of lineOf, each payload as full
// as the sink writes it; loaded whole and loaded slimmed, every answer the
// daemon gives over the fixture's window must be the same. This is the
// test that fails the day lineOf reads a field slimHookLine drops.
function slimFixture(): string[] {
  const full = (at: number, sessionId: string, event: string, from: string | null, to: string | null, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ at, sessionId, event, ...extra, outcome: 'applied', ...(from === null ? {} : { from }), ...(to === null ? {} : { to }), payload: { hook_event_name: event, session_id: 'c-p', transcript_path: 'C:/t/c-p.jsonl', cwd: 'C:/code/p', ...payload } });
  const conv = 'conv-outside';
  return [
    JSON.stringify({ at: T0 - 5 * MIN, presence: 'away' }),
    full(T0, 'p', 'SessionStart', 'starting', 'idle', { source: 'startup' }),
    JSON.stringify({ at: T0 + 1 * MIN, presence: 'back' }),
    full(T0 + 2 * MIN, 'p', 'UserPromptSubmit', 'idle', 'working', { prompt: '\n   \n  ' + 'word '.repeat(80) + '\nthe second line\nthe third' }),
    full(T0 + 3 * MIN, 'p', 'PreToolUse', null, null, { tool_name: 'Bash', tool_use_id: 'tu-1', tool_input: { command: 'x'.repeat(5000), description: 'a long command' } }),
    full(T0 + 4 * MIN, 'p', 'StatusLine', null, null, {
      model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
      effort: { level: 'high' },
      context_window: { used_percentage: 12, context_window_size: 200000, total_input_tokens: 9000, current_usage: { input_tokens: 120, output_tokens: 340, cache_creation_input_tokens: 2000, cache_read_input_tokens: 7000 } },
      cost: { total_cost_usd: 0.4321, total_duration_ms: 99999, total_lines_added: 12 },
      prompt_cache: { warm: true, ttl: '1h', expires_at: 1792090000, requests: 3, hit_ratio: 0.9 },
      workspace: { current_dir: 'C:/code/p' },
      version: '2.1.300',
    }),
    full(T0 + 5 * MIN, 'p', 'PostToolUse', null, null, {
      tool_name: 'Agent',
      tool_use_id: 'tu-2',
      tool_input: { description: 'read the ' + 'long '.repeat(60) + 'tree', subagent_type: 'Explore', prompt: 'p'.repeat(3000) },
      tool_response: { agentId: 'ag1', description: 'read the tree\nand more', content: [{ type: 'text', text: 'y'.repeat(2000) }], totalTokens: 5000 },
    }),
    full(T0 + 5 * MIN + 1000, 'p', 'SubagentStart', null, null, { agent_id: 'ag1', agent_type: 'Explore' }),
    full(T0 + 6 * MIN, 'p', 'PostToolUse', null, null, { agent_id: 'ag1', agent_type: 'Explore', tool_name: 'Agent', tool_input: { description: 'an inner agent', subagent_type: 'fork' }, tool_response: { agentId: 'inner', description: 'inner' } }),
    full(T0 + 6 * MIN + 1000, 'p', 'PreToolUse', null, null, { agent_id: 'ag1', tool_name: 'Grep', tool_input: { pattern: 'dropSession' } }),
    full(T0 + 7 * MIN, 'p', 'PostToolUse', null, null, { tool_name: 'Agent', tool_input: { description: 'a second agent', subagent_type: 'general-purpose' }, tool_response: { agentId: 'ag2', description: '   ' } }),
    full(T0 + 7 * MIN + 1000, 'p', 'SubagentStart', null, null, { agent_id: 'ag2', agent_type: 'general-purpose' }),
    full(T0 + 8 * MIN, 'p', 'SubagentStop', null, null, { agent_id: 'ag1', agent_type: 'Explore', last_assistant_message: 'z'.repeat(800) }),
    JSON.stringify({ at: T0 + 9 * MIN, capped: { window: 'five_hour', resetsAt: T0 + 30 * MIN } }),
    full(T0 + 10 * MIN, 'p', 'Stop', 'working', 'done', {
      last_assistant_message: 'done ' + 'w'.repeat(500),
      background_tasks: [
        { id: 'ag2', status: 'running', type: 'agent', description: 'a second agent' },
        { id: 'ag1', status: 'completed', type: 'agent', description: 'read the tree' },
        { id: 'sh1', status: 'running', type: 'shell', command: 'npm run build\nnpm test' },
      ],
    }),
    JSON.stringify({ at: T0 + 12 * MIN, freed: { window: 'five_hour' } }),
    full(T0 + 13 * MIN, conv, 'SessionStart', 'starting', 'idle', { session_id: conv, cwd: 'C:/code/elsewhere' }, { unhosted: true }),
    full(T0 + 14 * MIN, conv, 'UserPromptSubmit', 'idle', 'working', { session_id: conv, cwd: 'C:/code/elsewhere', prompt: 'outside' }, { unhosted: true }),
    full(T0 + 16 * MIN, conv, 'Stop', 'working', 'done', { session_id: conv, cwd: 'C:/code/elsewhere' }, { unhosted: true }),
    full(T0 + 17 * MIN, 'p', 'UserPromptSubmit', 'done', 'working', { prompt: 'again' }),
    full(T0 + 18 * MIN, 'p', 'PostToolUse', null, null, { tool_name: 'Read', tool_use_id: 'tu-9', tool_input: { file_path: 'C:/code/p/a.ts' }, tool_response: { file: { content: 'q'.repeat(4000) } }, truncated: true }),
    '{"at": 17, "sessionId": "p", "event": "PreToo',
  ];
}

test('a log loaded whole and slimmed answers the same spans over its whole window (M9 fix 629)', async () => {
  const fixture = slimFixture();
  const wholeDir = fs.realpathSync.native(mkTemp('emerald-activity-whole-'));
  const slimDir = fs.realpathSync.native(mkTemp('emerald-activity-slim-'));
  const wholeFile = path.join(wholeDir, 'hooks.jsonl');
  const slimFile = path.join(slimDir, 'hooks.jsonl');
  fs.writeFileSync(wholeFile, fixture.join('\n') + '\n');
  const slimmed = fixture.map(slimHookLine);
  fs.writeFileSync(slimFile, slimmed.join('\n') + '\n');
  const whole = await ActivityLog.load(wholeFile, quiet);
  const slim = await ActivityLog.load(slimFile, quiet);
  const from = T0 - 10 * MIN;
  const now = T0 + 20 * MIN;
  const sessions = [session('p', { state: 'working', stateSince: T0 + 17 * MIN, claudeSessionId: 'c-p' })];
  const bare = [session('conv-outside', { state: 'done', stateSince: T0 + 16 * MIN, cwd: 'C:/code/elsewhere', claudeSessionId: 'conv-outside' })];
  const wholeSpans = whole.spans(from, now, now, sessions, 0, bare);
  assert.ok(wholeSpans.length >= 3, 'the fixture has the session, its agents and the outside track');
  assert.ok(wholeSpans.some((s) => s.kind === 'agent'), 'the fixture reaches the agent branches');
  assert.deepEqual(slim.spans(from, now, now, sessions, 0, bare), wholeSpans);
  assert.deepEqual(slim.cappedSpans(from, now, now), whole.cappedSpans(from, now, now));
  assert.equal(slim.historyFrom, whole.historyFrom);
  assert.equal(whole.historyFrom, T0 - 5 * MIN);
  // Each line read alone reads the same too.
  fixture.forEach((raw, i) => assert.deepEqual(parseLogLine(slimmed[i]!), parseLogLine(raw), `line ${i}`));
  const slimText = fs.readFileSync(slimFile, 'utf8');
  assert.ok(slimText.length < fs.readFileSync(wholeFile, 'utf8').length / 4, 'the slimmed file is a fraction of the whole');
  assert.equal(slimText.includes('hook_event_name'), false);
  for (const each of slimmed) assert.equal(slimHookLine(each), each, 'a slimmed line slims to itself');
  assert.equal(isFullPayloadLine(fixture[1]!), true);
  assert.equal(isFullPayloadLine(slimmed[1]!), false);
  assert.equal(isFullPayloadLine(fixture[0]!), false, 'a presence line is not a hook line');
  fs.rmSync(wholeDir, { recursive: true, force: true });
  fs.rmSync(slimDir, { recursive: true, force: true });
});

test('a slimmed StatusLine keeps the prompt cache\'s ttl, expires_at and warm and nothing else of it (M9 fix 772)', () => {
  const fixture = slimFixture();
  const i = fixture.findIndex((raw) => raw.includes('"event":"StatusLine"'));
  assert.ok(i >= 0, 'the fixture has a status line');
  const slim = JSON.parse(slimHookLine(fixture[i]!)) as { payload: Record<string, unknown> };
  assert.deepEqual(slim.payload['prompt_cache'], { warm: true, ttl: '1h', expires_at: 1792090000 });
});

test('a rotation slims generation 1 and leaves the current file whole (M9 fix 629)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-activity-rotslim-'));
  const file = path.join(dir, 'hooks.jsonl');
  const fixture = slimFixture();
  fs.writeFileSync(file, fixture.join('\n') + '\n');
  const logged: Array<Record<string, unknown>> = [];
  const noting = { info: (msg: string, data?: unknown) => logged.push({ msg, ...(data as Record<string, unknown>) }), warn: (msg: string) => logged.push({ msg }), error() {} };
  assert.equal(rotateHookLog(file, noting), true);
  const gen1 = rotatedPath(file, 1);
  assert.equal(fs.readFileSync(gen1, 'utf8'), fixture.map(slimHookLine).join('\n') + '\n');
  const rotated = logged.find((l) => l['msg'] === 'hooks.jsonl rotated')!;
  assert.equal(rotated['slimmed'], fs.statSync(gen1).size);
  assert.ok((rotated['bytes'] as number) > (rotated['slimmed'] as number));
  assert.equal(typeof rotated['ms'], 'number');
  assert.equal(fs.existsSync(path.join(dir, 'hooks.rotating.jsonl')), false);
  assert.equal(fs.existsSync(path.join(dir, 'hooks.slimming.jsonl')), false);
  // The current file the sink writes next is never slimmed by a load.
  const fresh = line(T0 + 30 * MIN, 'p', 'UserPromptSubmit', 'done', 'working', 'fresh');
  fs.writeFileSync(file, fresh + '\n');
  const log = await ActivityLog.load(file, noting);
  assert.equal(fs.readFileSync(file, 'utf8'), fresh + '\n');
  assert.ok(fs.readFileSync(file, 'utf8').includes('hook_event_name'));
  const spans = log.spans(T0, T0 + 31 * MIN, T0 + 31 * MIN, [session('p', { state: 'working', stateSince: T0 + 30 * MIN, claudeSessionId: 'c-p' })]).find((s) => s.sessionId === 'p')!.spans;
  assert.equal(spans.at(-1)?.prompt, 'fresh');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a rotation killed mid-slim is recovered at the next open (M9 fix 629)', async () => {
  const turn = (n: number) => [line(T0 + n * 10 * MIN, 'a', 'UserPromptSubmit', 'done', 'working', `turn${n}`), line(T0 + n * 10 * MIN + 5 * MIN, 'a', 'Stop', 'working', 'done')];
  const read = (log: ActivityLog) => log.spans(T0, T0 + 100 * MIN, T0 + 100 * MIN, [session('a', { state: 'done', stateSince: T0 + 95 * MIN })]).find((s) => s.sessionId === 'a')!.spans.map((s) => s.prompt);
  // Killed before the slim finished: ROTATING_NAME holds the current
  // file's lines whole, the temporary is partial, hooks.jsonl is gone.
  {
    const dir = fs.realpathSync.native(mkTemp('emerald-activity-midslim-'));
    const file = path.join(dir, 'hooks.jsonl');
    fs.writeFileSync(rotatedPath(file, 1), turn(1).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'hooks.rotating.jsonl'), turn(2).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'hooks.slimming.jsonl'), slimHookLine(turn(2)[0]!) + '\n{"at":');
    const logged: Array<Record<string, unknown>> = [];
    const noting = { info: (msg: string, data?: unknown) => logged.push({ msg, ...(data as Record<string, unknown>) }), warn: (msg: string) => logged.push({ msg }), error() {} };
    const log = await ActivityLog.load(file, noting);
    assert.ok(logged.some((l) => l['msg'] === 'hooks.rotating.jsonl recovered as hooks.jsonl'));
    assert.equal(fs.existsSync(path.join(dir, 'hooks.rotating.jsonl')), false);
    assert.equal(fs.existsSync(path.join(dir, 'hooks.slimming.jsonl')), false);
    assert.equal(fs.readFileSync(file, 'utf8'), turn(2).join('\n') + '\n');
    assert.deepEqual(read(log), ['turn1', 'turn2'], 'every line once');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // Killed after the slim finished: ROTATING_NAME gone, the temporary
  // whole, generation 1 not yet renamed into place.
  {
    const dir = fs.realpathSync.native(mkTemp('emerald-activity-postslim-'));
    const file = path.join(dir, 'hooks.jsonl');
    fs.writeFileSync(rotatedPath(file, 2), turn(1).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'hooks.slimming.jsonl'), turn(2).map(slimHookLine).join('\n') + '\n');
    fs.writeFileSync(file, turn(3).join('\n') + '\n');
    const logged: Array<Record<string, unknown>> = [];
    const noting = { info: (msg: string, data?: unknown) => logged.push({ msg, ...(data as Record<string, unknown>) }), warn: (msg: string) => logged.push({ msg }), error() {} };
    const log = await ActivityLog.load(file, noting);
    assert.ok(logged.some((l) => l['msg'] === 'hooks.slimming.jsonl recovered as hooks.1.jsonl'));
    assert.equal(fs.existsSync(path.join(dir, 'hooks.slimming.jsonl')), false);
    assert.equal(fs.readFileSync(rotatedPath(file, 1), 'utf8'), turn(2).map(slimHookLine).join('\n') + '\n');
    assert.deepEqual(read(log), ['turn1', 'turn2', 'turn3'], 'every line once');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M9 fix 836: one folder's totals over the whole log. a and b are the
// folder's (b by its groupCwd), w is a worktree beside it and o another
// folder, both left out of the folder's figures and in every folder's
// price beside them.
test('activity totals fold one folder\'s rows over the whole log into a total and a row per month, a worktree beside it and another folder left out (M9 fix 836)', () => {
  const S = new Date(2026, 8, 30, 10).getTime();
  const O = new Date(2026, 9, 2, 10).getTime();
  const bUsage = { fresh: 300, cacheWrite: 0, cacheRead: 24000, output: 90 };
  const log = new ActivityLog();
  const raw = [
    line(S, 'a', 'UserPromptSubmit', 'idle', 'working', 'go'),
    statusLine(S + 1 * MIN, 'a', { fresh: 4000, cacheWrite: 8000, cacheRead: 12000, output: 500 }, 0.25),
    line(S + 30 * MIN, 'a', 'Stop', 'working', 'done'),
    line(O, 'b', 'UserPromptSubmit', 'idle', 'working', 'go'),
    statusLine(O + 1 * MIN, 'b', bUsage, null, 'Sonnet 5'),
    line(O + 20 * MIN, 'b', 'Stop', 'working', 'done'),
    line(O, 'w', 'UserPromptSubmit', 'idle', 'working', 'go'),
    statusLine(O + 1 * MIN, 'w', { fresh: 10, cacheWrite: 0, cacheRead: 0, output: 10 }, 0.1),
    line(O + 5 * MIN, 'w', 'Stop', 'working', 'done'),
    line(O, 'o', 'UserPromptSubmit', 'idle', 'working', 'go'),
    statusLine(O + 1 * MIN, 'o', { fresh: 10, cacheWrite: 0, cacheRead: 0, output: 10 }, 0.4),
    line(O + 5 * MIN, 'o', 'Stop', 'working', 'done'),
  ];
  for (const r of raw) log.record(parseActivityLine(r)!);
  const records = [
    session('a', { cwd: 'C:/code/proj', groupCwd: 'C:/code/proj', commits: [{ hash: 'h1', at: S + 10 * MIN }] } as Partial<SessionInfo>),
    session('b', { cwd: 'C:/code/proj/packages/app', groupCwd: 'C:/code/proj' }),
    session('w', { cwd: 'C:/code/proj-wt/fix-x', groupCwd: 'C:/code/proj-wt/fix-x' }),
    session('o', { cwd: 'C:/code/other', groupCwd: 'C:/code/other' }),
  ];
  const now = new Date(2026, 9, 3).getTime();
  const priced = costParts(bUsage, ratesFor('Sonnet 5')!).total;
  const t = log.totals('C:\\CODE\\proj\\', null, null, now, records);
  assert.equal(t.from, S, 'from the log\'s first line');
  assert.equal(t.historyFrom, S);
  assert.equal(t.to, now);
  assert.equal(t.total.requests, 2);
  assert.equal(t.total.estimated, true);
  assert.ok(Math.abs(t.total.usd - (0.25 + priced)) < 1e-9, `usd ${t.total.usd}`);
  assert.equal(t.total.agentMs, 50 * MIN);
  assert.equal(t.total.commits, 1);
  assert.deepEqual(t.months.map((m) => m.month), ['2026-09', '2026-10']);
  const [sep, oct] = t.months;
  assert.equal(sep!.requests, 1);
  assert.ok(Math.abs(sep!.usd - 0.25) < 1e-9);
  assert.ok(Math.abs(sep!.allUsd - 0.25) < 1e-9);
  assert.equal(sep!.commits, 1);
  assert.equal(sep!.from, S, 'the first month is cut to the window');
  assert.equal(oct!.requests, 1);
  assert.ok(Math.abs(oct!.allUsd - (priced + 0.1 + 0.4)) < 1e-9, `allUsd ${oct!.allUsd}`);
  assert.equal(oct!.to, now, 'the last month is cut to the window');
  assert.equal(t.firstAt, S);
  const late = log.totals('C:/code/proj', O, null, now, records);
  assert.deepEqual(late.months.map((m) => m.month), ['2026-10']);
  assert.equal(late.total.requests, 1);
});
