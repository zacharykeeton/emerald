import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import type { SessionInfo } from '@emerald/shared';
import { lastEventsFor, parseHookLog, readHookLog, readLastHookEvents, readStoredSessions, renderExplain, subjectFromSession, subjectFromStored } from './explain.ts';

const SID = 'a1b2c3d4-0000-4000-8000-000000000001';
const OTHER = 'ffffffff-0000-4000-8000-000000000002';
// A fixed local afternoon so the rendered times are stable.
const NOW = new Date(2026, 8, 12, 14, 30, 0).getTime();
const at = (secondsAgo: number) => NOW - secondsAgo * 1000;

// A log the way the sink writes it: lines from two sessions, one written
// before M37 (no from and to), one dropped as foreign, one torn.
function seededLog(): string {
  const lines = [
    { at: at(300), sessionId: SID, event: 'SessionStart', outcome: 'applied', from: 'starting', to: 'idle', payload: { hook_event_name: 'SessionStart', session_id: 'c-1' } },
    { at: at(240), sessionId: OTHER, event: 'Stop', outcome: 'applied', payload: { hook_event_name: 'Stop', session_id: 'c-9' } },
    { at: at(200), sessionId: SID, event: 'UserPromptSubmit', outcome: 'applied', from: 'idle', to: 'working', payload: { hook_event_name: 'UserPromptSubmit', session_id: 'c-1', prompt: 'fix it' } },
    { at: at(190), sessionId: SID, event: 'PreToolUse', outcome: 'applied', payload: { hook_event_name: 'PreToolUse', session_id: 'c-1' } },
    { at: at(180), sessionId: SID, event: 'Stop', outcome: 'ignored-foreign', payload: { hook_event_name: 'Stop', session_id: 'c-nested' } },
    { at: at(120), sessionId: SID, event: 'PermissionRequest', outcome: 'applied', from: 'working', to: 'needs-input', payload: { hook_event_name: 'PermissionRequest', session_id: 'c-1' } },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n{"at": 1, "sessionId": "torn';
}

function session(over: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: SID,
    kind: 'claude',
    name: 'fix-login',
    autoName: false,
    spawnCwd: 'C:\\work',
    args: [],
    cwd: 'C:\\work',
    groupCwd: 'C:\\work',
    branch: null,
    lastPrompt: 'fix it',
    lastReply: null,
    state: 'needs-input',
    stateSince: at(120),
    lastEventAt: at(120),
    stale: false,
    needsInputReason: 'permission',
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
    claudeSessionId: 'c-1',
    pid: 1,
    exitCode: null,
    createdAt: at(300),
    ...over,
  };
}

test('parseHookLog keeps the shaped lines, reads from, to and the payload session id, and skips a torn one', () => {
  const lines = parseHookLog(seededLog());
  assert.equal(lines.length, 6);
  assert.deepEqual(lines[0], { at: at(300), sessionId: SID, event: 'SessionStart', outcome: 'applied', from: 'starting', to: 'idle', claudeSessionId: 'c-1' });
  // A line from before M37 has no transition.
  assert.equal(lines[1]!.from, null);
  assert.equal(lines[1]!.to, null);
  assert.equal(lines[4]!.claudeSessionId, 'c-nested');
});

test('lastEventsFor takes the session\'s lines, newest kept, oldest first, and counts them all', () => {
  const lines = parseHookLog(seededLog());
  const all = lastEventsFor(lines, SID, 20);
  assert.equal(all.total, 5);
  assert.deepEqual(all.events.map((e) => e.event), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'PermissionRequest']);
  const two = lastEventsFor(lines, SID, 2);
  assert.equal(two.total, 5);
  assert.deepEqual(two.events.map((e) => e.event), ['Stop', 'PermissionRequest']);
  assert.deepEqual(lastEventsFor(lines, 'nobody', 20), { events: [], total: 0 });
});

test('renderExplain: the state line, the sentence behind it, the last turn, then one line per event with the transition', () => {
  const lines = parseHookLog(seededLog());
  const { events, total } = lastEventsFor(lines, SID, 20);
  const out = renderExplain(subjectFromSession(session()), events, total, 'C:\\h\\logs\\hooks.jsonl', NOW);
  assert.equal(out[0], 'a1b2c3d4 fix-login  claude  needs input: permission for 2m (since 14:28:00)');
  assert.equal(out[1], 'Claude is asking permission to use a tool.');
  assert.equal(out[2], 'Claude session c-1');
  assert.equal(out[3], 'last prompt: fix it');
  assert.equal(out[4], 'waiting on: Allow? a tool call', 'M55: what the permission is for; the fixture saw no tool call');
  assert.equal(out[5], 'last 5 of 5 hook events from C:\\h\\logs\\hooks.jsonl, oldest first:');
  assert.deepEqual(out.slice(6), [
    '  14:25:00  SessionStart       applied          starting -> idle',
    '  14:26:40  UserPromptSubmit   applied          idle -> working',
    '  14:26:50  PreToolUse         applied',
    '  14:27:00  Stop               ignored-foreign  (session_id c-nested)',
    '  14:28:00  PermissionRequest  applied          working -> needs-input',
  ]);
});

test('renderExplain with no events says so, and points a Claude session at hooks status', () => {
  const out = renderExplain(subjectFromSession(session({ state: 'starting', stateSince: at(30), lastPrompt: null, claudeSessionId: null })), [], 0, 'L', NOW);
  assert.equal(out[0], 'a1b2c3d4 fix-login  claude  starting for 30s (since 14:29:30)');
  assert.equal(out[2], 'no Claude session id bound (a shell, or Claude has not reported in)');
  assert.equal(out[3], 'no hook events for this session in L');
  assert.match(out[4]!, /emmer hooks status/);
  const shell = renderExplain(subjectFromSession(session({ kind: 'shell', state: 'idle', lastPrompt: null, claudeSessionId: null })), [], 0, 'L', NOW);
  assert.equal(shell.at(-1), 'no hook events for this session in L');
});

test("renderExplain carries a plain shell's last command as its prompt reported it (M9 fix 196)", () => {
  const running = renderExplain(subjectFromSession(session({ kind: 'shell', state: 'idle', lastPrompt: null, claudeSessionId: null, command: { state: 'running', exitCode: null, startedAt: NOW - 40_000, endedAt: null } }), NOW), [], 0, 'L', NOW);
  assert.equal(running[0], 'a1b2c3d4 fix-login  shell  running 40s for 2m (since 14:28:00)', 'the state column says the command runs');
  assert.ok(running.includes('last command: running 40s'), JSON.stringify(running));
  const failed = renderExplain(subjectFromSession(session({ kind: 'shell', state: 'errored', stateSince: NOW - 120_000, lastPrompt: null, claudeSessionId: null, command: { state: 'failed', exitCode: 3, startedAt: NOW - 192_000, endedAt: NOW - 120_000 } }), NOW), [], 0, 'L', NOW);
  assert.match(failed[0]!, /^a1b2c3d4 fix-login  shell  failed \(3\) after 1m 12s for 2m/);
  assert.ok(failed.includes('last command: failed (3) 2m ago'), JSON.stringify(failed));
  // A Claude session has no command line, whatever its record says.
  assert.equal(subjectFromSession(session({ command: { state: 'running', exitCode: null, startedAt: NOW, endedAt: null } }), NOW).command, null);
});

test('renderExplain names the tool call in flight after the last turn (M9 fix 79)', () => {
  const out = renderExplain(subjectFromSession(session({ state: 'working', liveTool: 'Reading BACKLOG.md' })), [], 0, 'L', NOW);
  const i = out.indexOf('doing: Reading BACKLOG.md');
  assert.equal(out[i - 1], 'last prompt: fix it', `the doing line follows the last turn, got ${JSON.stringify(out)}`);
  // The file never holds a turn in flight.
  assert.equal(subjectFromStored({ id: SID, kind: 'claude', name: 'n', claudeSessionId: null, lastPrompt: null, lastReply: null, exitCode: null, exitedAt: null }).liveTool, null);
});

test('renderExplain: the tokens since the start (M9 fix 143), nothing before a counted status line', () => {
  const counted = renderExplain(subjectFromSession(session({ state: 'working', tokens: { fresh: 4, cacheWrite: 18518, cacheRead: 94849, output: 264 } })), [], 0, 'L', NOW);
  assert.ok(counted.includes('tokens since the start: 113.4k sent (4 fresh, 18.5k written to the cache, 94.8k read from it), 264 received'), `the tokens line, got ${JSON.stringify(counted)}`);
  const none = renderExplain(subjectFromSession(session({ state: 'working' })), [], 0, 'L', NOW);
  assert.ok(!none.some((l) => l.startsWith('tokens since')), 'no line without a sum');
  assert.equal(subjectFromStored({ id: SID, kind: 'claude', name: 'n', claudeSessionId: null, lastPrompt: null, lastReply: null, exitCode: null, exitedAt: null }).tokens, null);
});

test("renderExplain: the cost line (M9 fix 154, reworded by fix 209), Claude Code's figure alone with no uncached half, nothing before a costed status line", () => {
  const t = { fresh: 4, cacheWrite: 18518, cacheRead: 94849, output: 264 };
  const costed = renderExplain(subjectFromSession(session({ state: 'working', model: 'Opus 5 (1M context)', tokens: t, costUsd: 1.4029585 })), [], 0, 'L', NOW);
  assert.ok(costed.includes("cost: $1.40 at API rates, subagents included, Claude Code's own figure"), `the cost line, got ${JSON.stringify(costed)}`);
  assert.ok(!costed.some((l) => l.includes('uncached')), `no uncached half on the line, got ${JSON.stringify(costed)}`);
  const unknown = renderExplain(subjectFromSession(session({ state: 'working', model: 'Some Model 9', tokens: t, costUsd: 1.4 })), [], 0, 'L', NOW);
  assert.ok(unknown.includes("cost: $1.40 at API rates, subagents included, Claude Code's own figure"), `the same line for a model the table lacks, got ${JSON.stringify(unknown)}`);
  const none = renderExplain(subjectFromSession(session({ state: 'working', tokens: t })), [], 0, 'L', NOW);
  assert.ok(!none.some((l) => l.startsWith('cost:')), 'no line without a figure');
  assert.equal(subjectFromStored({ id: SID, kind: 'claude', name: 'n', claudeSessionId: null, lastPrompt: null, lastReply: null, exitCode: null, exitedAt: null }).cost, null);
});

test("renderExplain: the colour scheme line (M9 fix 244) names the session's own, nothing on the window's pick", () => {
  const own = renderExplain(subjectFromSession(session({ state: 'working', scheme: 'Solarized Dark' })), [], 0, 'L', NOW);
  assert.ok(own.includes("colour scheme: Solarized Dark, this session's own (emmer set --scheme)"), `the scheme line, got ${JSON.stringify(own)}`);
  const none = renderExplain(subjectFromSession(session({ state: 'working' })), [], 0, 'L', NOW);
  assert.ok(!none.some((l) => l.startsWith('colour scheme:')), "no line on the window's pick");
  assert.equal(subjectFromStored({ id: SID, kind: 'claude', name: 'n', claudeSessionId: null, lastPrompt: null, lastReply: null, exitCode: null, exitedAt: null }).scheme, null);
});

test('renderExplain: the start commit and the count since (M9 fix 117), nothing without one', () => {
  const started = renderExplain(subjectFromSession(session({ state: 'working', startHead: 'abcdef0123456789', commits: [{ hash: 'f'.repeat(40), at: 1 }, { hash: 'e'.repeat(40), at: 2 }] })), [], 0, 'L', NOW);
  assert.ok(started.includes('started on commit abcdef0, 2 commits since'), `the start line, got ${JSON.stringify(started)}`);
  const one = renderExplain(subjectFromSession(session({ state: 'working', startHead: 'abcdef0123456789', commits: [{ hash: 'f'.repeat(40), at: 1 }] })), [], 0, 'L', NOW);
  assert.ok(one.includes('started on commit abcdef0, 1 commit since'));
  const none = renderExplain(subjectFromSession(session({ state: 'working', startHead: 'abcdef0123456789' })), [], 0, 'L', NOW);
  assert.ok(none.includes('started on commit abcdef0'));
  const outside = renderExplain(subjectFromSession(session({ state: 'working' })), [], 0, 'L', NOW);
  assert.ok(!outside.some((l) => l.startsWith('started on')), 'no line without a start commit');
});

test('an event from another day carries its date', () => {
  const old = parseHookLog(JSON.stringify({ at: at(2 * 24 * 3600), sessionId: SID, event: 'Stop', outcome: 'applied', payload: {} }));
  const out = renderExplain(subjectFromSession(session()), old, 1, 'L', NOW);
  assert.equal(out.at(-1), '  2026-09-10 14:30:00  Stop  applied');
});

test.after(removeTemps);

test('readHookLog and readStoredSessions read the files, and a missing or bad file is empty', async () => {
  const dir = mkTemp('emerald-explain-');
  const log = path.join(dir, 'hooks.jsonl');
  assert.deepEqual(await readHookLog(log), []);
  fs.writeFileSync(log, seededLog());
  assert.equal((await readHookLog(log)).length, 6);
  // Every rotated generation (M9 fix 377, as many as the folder holds
  // since fix 629) comes first, oldest first (M9 fix 430: explain read
  // only hooks.1.jsonl).
  const gen = (n: number, secs: number, sessionId = SID): void =>
    fs.writeFileSync(path.join(dir, `hooks.${n}.jsonl`), JSON.stringify({ at: at(secs), sessionId, event: 'SessionStart', outcome: 'applied', to: 'idle', payload: { session_id: `c-${n}` } }) + '\n');
  gen(1, -100);
  const both = await readHookLog(log);
  assert.equal(both.length, 7);
  assert.equal(both[0]!.at, at(-100));
  gen(3, -300);
  fs.appendFileSync(path.join(dir, 'hooks.3.jsonl'), JSON.stringify({ at: at(-290), sessionId: 'someone-else', event: 'Stop', outcome: 'applied', payload: {} }) + '\n');
  gen(2, -200);
  // A fourth generation, a backup copied in as the oldest (M9 fix 629).
  gen(4, -400);
  const all = await readHookLog(log);
  assert.equal(all.length, 11, 'five files, every line');
  assert.deepEqual(
    all.slice(0, 5).map((l) => l.at),
    [at(-400), at(-300), at(-290), at(-200), at(-100)],
    'the generations oldest first, hooks.4.jsonl read first, the current file last',
  );
  // Given a session, a line naming another is skipped before the parse,
  // and the total over the five files is exact.
  const mine = await readHookLog(log, SID);
  assert.equal(mine.length, 9);
  assert.ok(mine.every((l) => l.sessionId === SID));
  assert.equal(lastEventsFor(mine, SID, 2).total, 9);

  const sessions = path.join(dir, 'sessions.json');
  assert.deepEqual(readStoredSessions(sessions), []);
  fs.writeFileSync(sessions, '{not json');
  assert.deepEqual(readStoredSessions(sessions), []);
  fs.writeFileSync(
    sessions,
    JSON.stringify({
      version: 1,
      sessions: [
        { id: SID, kind: 'claude', name: 'fix-login', claudeSessionId: 'c-1', lastPrompt: 'fix it', lastReply: 'Fixed.', exitCode: 0, exitedAt: at(60), color: '#61afef' },
        { id: OTHER, kind: 'shell', name: 'sh', claudeSessionId: null, lastPrompt: null, lastReply: null, exitCode: null, exitedAt: null },
        { id: 'broken' },
      ],
    }),
  );
  const stored = readStoredSessions(sessions);
  assert.equal(stored.length, 2);
  // An exited entry has a state; one that was live when the daemon died has none.
  const exited = subjectFromStored(stored[0]!);
  assert.equal(exited.state, 'exited');
  assert.equal(exited.label, 'exited (0)');
  assert.equal(exited.source, 'file');
  const live = subjectFromStored(stored[1]!);
  assert.equal(live.state, null);
  assert.equal(live.label, 'unknown');
  const out = renderExplain(live, [], 0, 'L', NOW);
  assert.equal(out[0], 'ffffffff sh  shell  unknown');
  assert.equal(out[1], 'emmerd is not running; the session is as sessions.json last wrote it');
  assert.match(out[2]!, /was live when it last wrote sessions.json/);
});

test('renderExplain says what a needs-input session waits on (M55)', () => {
  const out = renderExplain(subjectFromSession(session({ state: 'needs-input', needsInputReason: 'permission', liveTool: 'Editing session.ts' })), [], 0, 'L', NOW);
  assert.ok(out.includes('waiting on: Allow? Editing session.ts'), `the waiting line, got ${JSON.stringify(out)}`);
  const working = renderExplain(subjectFromSession(session({ state: 'working', liveTool: 'Editing session.ts' })), [], 0, 'L', NOW);
  assert.ok(!working.some((l) => l.startsWith('waiting on:')), 'nothing to wait on while working');
});

test("renderExplain: Claude's checklist (M9 fix 153), the count and one line per task with the one in progress marked, nothing once the list is done", () => {
  const tasks = [
    { id: '1', subject: 'Extend the row', activeForm: 'Extending the row', status: 'completed' as const },
    { id: '2', subject: 'Wire the hooks', activeForm: 'Wiring the hooks', status: 'in_progress' as const },
    { id: '3', subject: 'Write the tests', activeForm: null, status: 'pending' as const },
  ];
  const lines = renderExplain(subjectFromSession(session({ state: 'working', tasks })), [], 0, 'L', NOW);
  const at = lines.indexOf('tasks: 1 of 3 done');
  assert.ok(at > 0, `the count line, got ${JSON.stringify(lines)}`);
  assert.deepEqual(lines.slice(at + 1, at + 4), ['  [x]  Extend the row', '  [>]  Wiring the hooks', '  [ ]  Write the tests']);
  const done = renderExplain(subjectFromSession(session({ tasks: tasks.map((t) => ({ ...t, status: 'completed' as const })) })), [], 0, 'L', NOW);
  assert.ok(!done.some((l) => l.startsWith('tasks:')), 'a finished list is quiet');
  assert.ok(!renderExplain(subjectFromSession(session({})), [], 0, 'L', NOW).some((l) => l.startsWith('tasks:')), 'no list, no line');
});

test("renderExplain: the files the session wrote (M9 fix 198), the latest first, at most five, a member's with its agent", () => {
  const touched = Array.from({ length: 7 }, (_, i) => ({ path: `C:/work/f${i}.ts`, at: NOW - (7 - i) * 60_000, agentId: i === 6 ? 'a1' : null }));
  const lines = renderExplain(subjectFromSession(session({ touched })), [], 0, 'L', NOW);
  const at = lines.indexOf('touched: 7 files, the last 5');
  assert.ok(at > 0, `the count line, got ${JSON.stringify(lines)}`);
  assert.equal(lines[at + 1], '  C:/work/f6.ts  1m ago  (agent a1)');
  assert.equal(lines[at + 5], '  C:/work/f2.ts  5m ago');
  assert.ok(!lines[at + 6]!.startsWith('  C:/work'), 'five and no more');
  const one = renderExplain(subjectFromSession(session({ touched: touched.slice(0, 1) })), [], 0, 'L', NOW);
  assert.ok(one.includes('touched: 1 file'), `one file, got ${JSON.stringify(one)}`);
  assert.ok(!renderExplain(subjectFromSession(session({})), [], 0, 'L', NOW).some((l) => l.startsWith('touched:')), 'no writes, no line');
});

// The backward read (M9 fix 541). A folder of the daemon's four files:
// the session's first three lines in hooks.3.jsonl and its last three in
// hooks.jsonl, other sessions' lines between them and in the two files in
// the middle. Resolved long, since %TEMP% is the 8.3 form on this box.
function hookLine(secs: number, sessionId: string, event: string): string {
  return JSON.stringify({ at: at(secs), sessionId, event, outcome: 'applied', payload: { session_id: 'c-1' } });
}

function fourFiles(): { dir: string; log: string } {
  const dir = fs.realpathSync.native(mkTemp('emerald-explain-back-'));
  const log = path.join(dir, 'hooks.jsonl');
  const write = (name: string, lines: string[]) => fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
  write('hooks.3.jsonl', [hookLine(600, SID, 'SessionStart'), hookLine(590, OTHER, 'Stop'), hookLine(580, SID, 'UserPromptSubmit'), hookLine(570, SID, 'PreToolUse')]);
  write('hooks.2.jsonl', [hookLine(500, OTHER, 'SessionStart'), hookLine(490, OTHER, 'Stop')]);
  write('hooks.1.jsonl', [hookLine(400, OTHER, 'UserPromptSubmit')]);
  write('hooks.jsonl', [hookLine(300, SID, 'PostToolUse'), hookLine(290, OTHER, 'Stop'), hookLine(200, SID, 'Stop'), hookLine(100, SID, 'SessionEnd')]);
  return { dir, log };
}

test('readLastHookEvents stops once it has enough and says it knows no total; given room it reads every file for the exact count (M9 fix 541)', async () => {
  const { dir, log } = fourFiles();
  try {
    const short = await readLastHookEvents(log, SID, 2);
    assert.equal(short.total, null);
    assert.deepEqual(short.events.map((e) => e.event), ['Stop', 'SessionEnd'], 'the two newest, oldest first');
    const lines = renderExplain(subjectFromSession(session()), short.events, short.total, log, NOW);
    assert.ok(lines.includes(`last 2 hook events (more before) from ${log}, oldest first:`), JSON.stringify(lines));

    const whole = await readLastHookEvents(log, SID, 20);
    assert.equal(whole.total, 6);
    assert.deepEqual(whole.events.map((e) => e.at), [at(600), at(580), at(570), at(300), at(200), at(100)]);
    // --lines 0 is every event, never a stop.
    assert.equal((await readLastHookEvents(log, SID, 0)).total, 6);

    // The --all path reads every file too.
    assert.equal(lastEventsFor(await readHookLog(log, SID), SID, 2).total, 6);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a session whose lines all sit in the current file gets its exact total from a stopped read (M9 fix 541)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-explain-one-'));
  const log = path.join(dir, 'hooks.jsonl');
  try {
    fs.writeFileSync(log, [500, 400, 300, 200, 100].map((s) => hookLine(s, SID, 'Stop')).join('\n') + '\n');
    const got = await readLastHookEvents(log, SID, 2);
    assert.equal(got.total, 5);
    assert.deepEqual(got.events.map((e) => e.at), [at(200), at(100)]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('chunks smaller than a line cut no line and no character (M9 fix 541)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-explain-chunk-'));
  const log = path.join(dir, 'hooks.jsonl');
  try {
    const lines: string[] = [];
    for (let i = 0; i < 12; i++) {
      // Each line well past 64 bytes, with a two-byte character at every
      // offset in turn so one straddles a chunk boundary.
      const pad = 'x'.repeat(i * 7);
      lines.push(JSON.stringify({ at: at(1000 - i), sessionId: i % 3 === 0 ? OTHER : SID, event: `Stop${pad}é${pad}é`, outcome: 'applied', payload: {} }));
    }
    fs.writeFileSync(log, lines.join('\n') + '\n');
    const forward = lastEventsFor(await readHookLog(log, SID), SID, 0);
    const back = await readLastHookEvents(log, SID, 0, 64);
    assert.equal(back.total, forward.total);
    assert.deepEqual(back.events, forward.events);
    assert.ok(back.events.every((e) => e.event !== null && e.event.endsWith('é')), 'every multibyte character intact');
    // A file with no newline at its end reads its last line too.
    fs.writeFileSync(log, lines.join('\n'));
    assert.deepEqual((await readLastHookEvents(log, SID, 0, 64)).events, forward.events);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mid-rotation, the current file under the temporary name is read by both reads (M9 fix 541)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-explain-rot-'));
  const log = path.join(dir, 'hooks.jsonl');
  try {
    fs.writeFileSync(path.join(dir, 'hooks.rotating.jsonl'), [hookLine(300, SID, 'Stop'), hookLine(200, SID, 'SessionEnd')].join('\n') + '\n');
    assert.deepEqual((await readLastHookEvents(log, SID, 20)).events.map((e) => e.event), ['Stop', 'SessionEnd']);
    assert.deepEqual((await readHookLog(log, SID)).map((e) => e.event), ['Stop', 'SessionEnd']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mid-drop, the oldest generation under the dropping name is read by both reads (M9 fix 555)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-explain-drop-'));
  const log = path.join(dir, 'hooks.jsonl');
  try {
    fs.writeFileSync(path.join(dir, 'hooks.dropping.jsonl'), [hookLine(500, SID, 'SessionStart'), hookLine(400, SID, 'UserPromptSubmit')].join('\n') + '\n');
    fs.writeFileSync(log, [hookLine(300, SID, 'Stop')].join('\n') + '\n');
    assert.deepEqual((await readLastHookEvents(log, SID, 20)).events.map((e) => e.event), ['SessionStart', 'UserPromptSubmit', 'Stop']);
    assert.deepEqual((await readHookLog(log, SID)).map((e) => e.event), ['SessionStart', 'UserPromptSubmit', 'Stop']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mid-rotation, the current file under the slimming name once the slim has finished is read by both reads (M9 fix 629)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-explain-slim-'));
  const log = path.join(dir, 'hooks.jsonl');
  try {
    fs.writeFileSync(path.join(dir, 'hooks.1.jsonl'), hookLine(500, SID, 'SessionStart') + '\n');
    fs.writeFileSync(path.join(dir, 'hooks.slimming.jsonl'), [hookLine(300, SID, 'Stop'), hookLine(200, SID, 'SessionEnd')].join('\n') + '\n');
    assert.deepEqual((await readLastHookEvents(log, SID, 20)).events.map((e) => e.event), ['SessionStart', 'Stop', 'SessionEnd']);
    assert.deepEqual((await readHookLog(log, SID)).map((e) => e.event), ['SessionStart', 'Stop', 'SessionEnd']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a rotation between the opens is seen by the file ids and the set opened again: every line once (M9 fix 541)', async () => {
  const dir = fs.realpathSync.native(mkTemp('emerald-explain-race-'));
  const log = path.join(dir, 'hooks.jsonl');
  try {
    fs.writeFileSync(path.join(dir, 'hooks.1.jsonl'), [hookLine(500, SID, 'SessionStart'), hookLine(400, SID, 'UserPromptSubmit')].join('\n') + '\n');
    fs.writeFileSync(log, [hookLine(300, SID, 'PreToolUse'), hookLine(200, SID, 'Stop')].join('\n') + '\n');
    let rotated = 0;
    const got = await readLastHookEvents(log, SID, 0, undefined, () => {
      rotated++;
      fs.renameSync(path.join(dir, 'hooks.1.jsonl'), path.join(dir, 'hooks.2.jsonl'));
      fs.renameSync(log, path.join(dir, 'hooks.1.jsonl'));
      fs.writeFileSync(log, hookLine(100, SID, 'SessionEnd') + '\n');
    });
    assert.equal(rotated, 1, 'the hook runs after the first opens only');
    assert.equal(got.total, 5);
    assert.deepEqual(got.events.map((e) => e.at), [at(500), at(400), at(300), at(200), at(100)], 'none twice, none missed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
