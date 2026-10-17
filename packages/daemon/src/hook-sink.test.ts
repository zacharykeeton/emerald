import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { setTimeout as sleep } from 'node:timers/promises';
import type { HookPayload, SessionInfo } from '@emerald/shared';
import { HookSink, canonicalJson, readHeadFields, trimPayload, type HookHandler } from './hook-sink.ts';
import { silentLogger } from './log.ts';
import { SessionManager } from './session-manager.ts';

const TOKEN = 'test-token-0123456789';

interface Call {
  sessionId: string;
  payload: HookPayload;
  at: number;
  unhosted: boolean;
}

let sink: HookSink;
let logPath: string;
const calls: Call[] = [];
// A "fake session": the handler only knows one session id.
const handler: HookHandler = (sessionId, payload, at, unhosted) => {
  calls.push({ sessionId, payload, at, unhosted });
  if (payload.hook_event_name === 'Explode') throw new Error('handler blew up');
  return sessionId === 'known' ? { outcome: 'applied', from: 'idle', to: 'working' } : { outcome: 'unknown-session' };
};

before(async () => {
  logPath = path.join(mkTemp('emerald-hooks-'), 'logs', 'hooks.jsonl');
  sink = await HookSink.listen(handler, { preferredPort: 0, token: TOKEN, eventLogPath: logPath, log: silentLogger, maxBodyBytes: 4096 });
});

after(async () => {
  await sink.close();
  await removeTemps();
});

function post(body: string | object, headers: Record<string, string> = {}, url = '/hook'): Promise<Response> {
  return fetch(`http://127.0.0.1:${sink.port}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': TOKEN, 'X-Emerald-Session': 'known', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// The sink hands events to the handler on the next tick after replying.
async function settle(): Promise<void> {
  await sleep(30);
}

function logLines(): Array<Record<string, unknown>> {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

test('a good POST gets 204, reaches the handler and lands in hooks.jsonl', async () => {
  const payload = { hook_event_name: 'UserPromptSubmit', session_id: 'c1', cwd: 'C:\\x', prompt: 'hi' };
  const res = await post(payload);
  assert.equal(res.status, 204);
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.sessionId, 'known');
  assert.deepEqual(calls[0]!.payload, payload);
  assert.ok(Math.abs(calls[0]!.at - Date.now()) < 5000);
  const lines = logLines();
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!['event'], 'UserPromptSubmit');
  assert.equal(lines[0]!['sessionId'], 'known');
  assert.equal(lines[0]!['outcome'], 'applied');
  assert.equal(lines[0]!['from'], 'idle');
  assert.equal(lines[0]!['to'], 'working');
  assert.deepEqual(lines[0]!['payload'], payload);
});

test('a wrong or missing token is 401 and never reaches the handler', async () => {
  const n = calls.length;
  assert.equal((await post({ hook_event_name: 'Stop' }, { 'X-Emerald-Token': 'nope' })).status, 401);
  assert.equal((await post({ hook_event_name: 'Stop' }, { 'X-Emerald-Token': '' })).status, 401);
  // Same length, different bytes: the constant-time compare still says no.
  assert.equal((await post({ hook_event_name: 'Stop' }, { 'X-Emerald-Token': TOKEN.replace('0', '1') })).status, 401);
  await settle();
  assert.equal(calls.length, n);
  assert.equal(logLines().length, 1);
});

test('missing session header, bad JSON and non-object bodies are 400', async () => {
  const n = calls.length;
  assert.equal((await post({ hook_event_name: 'Stop' }, { 'X-Emerald-Session': '' })).status, 400);
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post('[1,2]')).status, 400);
  assert.equal((await post('"str"')).status, 400);
  await settle();
  assert.equal(calls.length, n);
});

test('other routes and methods are 404', async () => {
  assert.equal((await post({ hook_event_name: 'Stop' }, {}, '/other')).status, 404);
  const get = await fetch(`http://127.0.0.1:${sink.port}/hook`, { headers: { 'X-Emerald-Token': TOKEN } });
  assert.equal(get.status, 404);
});

test('an oversized body with no event name in its head is 413, read to its end (M9 fix 512)', async () => {
  const n = calls.length;
  const res = await post({ tool_input: 'x'.repeat(5000) });
  assert.equal(res.status, 413);
  await settle();
  assert.equal(calls.length, n);
});

test('a body past a megabyte is read on and its head fields land, marked truncated (M9 fix 512)', async () => {
  const bigLog = path.join(mkTemp('emerald-hooks-big-'), 'hooks.jsonl');
  const got: HookPayload[] = [];
  const big = await HookSink.listen((_id, payload) => {
    got.push(payload);
    return { outcome: 'applied', from: 'working', to: 'working' };
  }, { preferredPort: 0, token: TOKEN, eventLogPath: bigLog, log: silentLogger });
  try {
    const content = 'x'.repeat(1024 * 1024);
    const body = { session_id: 'c1', cwd: 'C:\\repo', hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: 'big-512', tool_input: { file_path: 'C:\\repo\\big.txt', content }, tool_response: { filePath: 'C:\\repo\\big.txt', content } };
    const res = await fetch(`http://127.0.0.1:${big.port}/hook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': TOKEN, 'X-Emerald-Session': 'known' }, body: JSON.stringify(body) });
    assert.equal(res.status, 204);
    await settle();
    assert.equal(got.length, 1);
    assert.equal(got[0]!.tool_name, 'Write');
    assert.equal(got[0]!.tool_input?.file_path, 'C:\\repo\\big.txt');
    assert.equal(got[0]!.tool_use_id, 'big-512');
    assert.equal(got[0]!['truncated'], true);
  } finally {
    await big.close();
  }
  const line = JSON.parse(fs.readFileSync(bigLog, 'utf8').trim().split('\n').at(-1)!) as { payload: Record<string, unknown> };
  assert.equal(line.payload['truncated'], true);
});

test('readHeadFields takes the first string of each key and none written inside a value (M9 fix 512)', () => {
  const head = JSON.stringify({ hook_event_name: 'PostToolUse', note: 'a "session_id": "evil" inside', session_id: 'c1', tool_input: { file_path: 'C:\\a "quoted" name.txt', content: 'x'.repeat(100) } }).slice(0, -20);
  const got = readHeadFields(head)!;
  assert.equal(got.hook_event_name, 'PostToolUse');
  assert.equal(got.session_id, 'c1');
  assert.equal(got.tool_input?.file_path, 'C:\\a "quoted" name.txt');
  assert.equal(got['truncated'], true);
  assert.equal(readHeadFields('{"tool_input": "x'), null);
});

test('an unknown session is still 204 and logged with that outcome', async () => {
  const res = await post({ hook_event_name: 'Stop', session_id: 'c9' }, { 'X-Emerald-Session': 'ghost' });
  assert.equal(res.status, 204);
  await settle();
  const last = logLines().at(-1)!;
  assert.equal(last['sessionId'], 'ghost');
  assert.equal(last['outcome'], 'unknown-session');
});

test('an unhosted post (M9 fix 233) reaches the handler flagged and its line carries the mark', async () => {
  const n = calls.length;
  const res = await post({ hook_event_name: 'UserPromptSubmit', session_id: 'conv-1' }, { 'X-Emerald-Session': 'conv-1', 'X-Emerald-Unhosted': '1' });
  assert.equal(res.status, 204);
  await settle();
  assert.equal(calls.length, n + 1);
  assert.equal(calls[n]!.sessionId, 'conv-1');
  assert.equal(calls[n]!.unhosted, true);
  assert.equal(calls[n - 1]!.unhosted, false, 'a hosted post is not flagged');
  const last = logLines().at(-1)!;
  assert.equal(last['sessionId'], 'conv-1');
  assert.equal(last['unhosted'], true);
  assert.equal('unhosted' in logLines()[0]!, false, 'a hosted line carries no mark');
});

test('an unhosted post with no session header takes the payload\'s session_id, and a BOM is dropped (M9 fix 580)', async () => {
  const unhosted = { 'X-Emerald-Session': '', 'X-Emerald-Unhosted': '1' };
  let n = calls.length;
  assert.equal((await post({ hook_event_name: 'UserPromptSubmit', session_id: 'conv-580' }, unhosted)).status, 204);
  await settle();
  assert.equal(calls.length, n + 1);
  assert.equal(calls[n]!.sessionId, 'conv-580');
  assert.equal(calls[n]!.unhosted, true);
  assert.equal(logLines().at(-1)!['sessionId'], 'conv-580');

  // No id anywhere, or one that is not a string, is refused before any handler.
  n = calls.length;
  const none = await post({ hook_event_name: 'Stop' }, unhosted);
  assert.equal(none.status, 400);
  assert.equal(await none.text(), 'missing session_id');
  const numeric = await post({ hook_event_name: 'Stop', session_id: 7 }, unhosted);
  assert.equal(numeric.status, 400);
  assert.equal(await numeric.text(), 'missing session_id');
  await settle();
  assert.equal(calls.length, n);

  // A payload piped by hand from PowerShell starts with a byte order mark.
  n = calls.length;
  assert.equal((await post('\uFEFF' + JSON.stringify({ hook_event_name: 'Stop', session_id: 'known' }))).status, 204);
  await settle();
  assert.equal(calls.length, n + 1);
  assert.equal(calls[n]!.sessionId, 'known');

  // Past the suite's 4096-byte limit the id still comes off the body's head.
  n = calls.length;
  const big = { hook_event_name: 'PostToolUse', session_id: 'conv-big', tool_input: { content: 'x'.repeat(5000) } };
  assert.equal((await post(big, unhosted)).status, 204);
  await settle();
  assert.equal(calls.length, n + 1);
  assert.equal(calls[n]!.sessionId, 'conv-big');
  assert.equal(calls[n]!.payload['truncated'], true);
});

test('a handler failure never reaches the hook: the 204 was already sent', async () => {
  const res = await post({ hook_event_name: 'Explode' });
  assert.equal(res.status, 204);
  await settle();
  const last = logLines().at(-1)!;
  assert.equal(last['event'], 'Explode');
  assert.equal(last['outcome'], 'handler-error');
});

test('events are logged in arrival order', async () => {
  const before = logLines().length;
  await Promise.all([1, 2, 3, 4, 5].map((i) => post({ hook_event_name: 'PostToolUse', i })));
  await settle();
  const lines = logLines().slice(before);
  assert.equal(lines.length, 5);
  // Arrival order is whatever order the sink saw them; every line is intact JSON with its at stamp.
  for (let i = 1; i < lines.length; i++) {
    assert.ok((lines[i]!['at'] as number) >= (lines[i - 1]!['at'] as number));
  }
});

const HOOK_A = { 'X-Emerald-Hook': 'C:/Users/me/.emerald/hooks/claude-hook.cmd' };
const HOOK_B = { 'X-Emerald-Hook': 'C:/work/repo/.claude/hooks/claude-hook.cmd' };

test('the same event posted by two hook files within a second reaches the handler once (M9 fix 260)', async () => {
  const before = calls.length;
  const payload = { hook_event_name: 'Stop', session_id: 'dup-1', stop_hook_active: false };
  await post(payload, HOOK_A);
  await post(payload, HOOK_B);
  await settle();
  assert.equal(calls.length - before, 1, 'the second post is folded');
  assert.equal(logLines().filter((l) => (l['payload'] as { session_id?: string }).session_id === 'dup-1').length, 1, 'one line in hooks.jsonl');
  // An old hook with no header beside a new one with it differ too.
  await post({ ...payload, n: 2 });
  await post({ ...payload, n: 2 }, HOOK_B);
  await settle();
  assert.equal(calls.length - before, 2, 'no header against a header is folded');
});

test('the same event two seconds apart, or twice from one hook file, reaches the handler twice (M9 fixes 260 and 740)', async () => {
  const before = calls.length;
  const payload = { hook_event_name: 'Stop', session_id: 'dup-2', stop_hook_active: false };
  await post(payload, HOOK_A);
  await sleep(2100);
  await post(payload, HOOK_B);
  await settle();
  assert.equal(calls.length - before, 2, 'two seconds apart');
  // The same file twice, and no header twice (the verify scripts' posts).
  await post({ ...payload, n: 2 }, HOOK_A);
  await post({ ...payload, n: 2 }, HOOK_A);
  await post({ ...payload, n: 3 });
  await post({ ...payload, n: 3 });
  await settle();
  assert.equal(calls.length - before, 6, 'the same file and no file at all both pass');
});

test('two events of one kind with different payloads at once both pass (M9 fix 260)', async () => {
  const before = calls.length;
  await Promise.all([post({ hook_event_name: 'PreToolUse', session_id: 'dup-3', tool_use_id: 'a' }, HOOK_A), post({ hook_event_name: 'PreToolUse', session_id: 'dup-3', tool_use_id: 'b' }, HOOK_B)]);
  await settle();
  assert.equal(calls.length - before, 2);
  // The same body from another session is that session's own event.
  await post({ hook_event_name: 'Stop', session_id: 'dup-3' }, HOOK_A);
  await post({ hook_event_name: 'Stop', session_id: 'dup-3' }, { ...HOOK_B, 'X-Emerald-Session': 'other' });
  await settle();
  assert.equal(calls.length - before, 4);
});

test("the mod's post and the hook file's copy of one Stop, keys in another order, reach the handler once and the line says mod (M9 fix 725)", async () => {
  const before = calls.length;
  await post({ hook_event_name: 'Stop', session_id: 'mod-1', stop_hook_active: false }, { 'X-Emerald-Hook': 'emerald-mod' });
  await post('{ "stop_hook_active": false,  "session_id": "mod-1", "hook_event_name": "Stop" }\r\n', HOOK_A);
  await settle();
  assert.equal(calls.length - before, 1, 'the hook file copy is folded');
  const lines = logLines().filter((l) => (l['payload'] as { session_id?: string }).session_id === 'mod-1');
  assert.equal(lines.length, 1, 'one line in hooks.jsonl');
  assert.equal(lines[0]!['mod'], true);
});

test('modSeenFor is true for a session whose mod posted and false for another (M9 fix 776)', async () => {
  await post({ hook_event_name: 'Stop', session_id: 'mod-776' }, { 'X-Emerald-Hook': 'emerald-mod', 'X-Emerald-Session': 'seen-776' });
  await settle();
  assert.equal(sink.modSeenFor('seen-776'), true);
  assert.equal(sink.modSeenFor('other-776'), false);
});

test('an over-limit hook-file PostToolUse and the mod\'s whole copy of one tool_use_id reach the handler once (M9 fix 740)', async () => {
  const before = calls.length;
  const filePath = 'C:/repo/big.txt';
  // In Claude Code's own key order: the id after the content, past the limit.
  const big = `{"session_id":"fold-740","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"${filePath}","content":"${'x'.repeat(6000)}"},"tool_response":{"ok":true},"tool_use_id":"tu-740","duration_ms":5}`;
  await post(big, HOOK_A);
  await post({ session_id: 'fold-740', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: filePath, content: 'short' }, tool_response: { ok: true }, tool_use_id: 'tu-740', duration_ms: 5 }, { 'X-Emerald-Hook': 'emerald-mod' });
  await settle();
  assert.equal(calls.length - before, 1, 'the two copies fold on the id');
  assert.equal(calls.at(-1)!.payload.tool_use_id, 'tu-740', 'the over-limit copy carries the id from its tail');
});

test('the fold holds at a second and a half with ten other events between (M9 fix 740)', async () => {
  const before = calls.length;
  const payload = { hook_event_name: 'Stop', session_id: 'fold-740b', stop_hook_active: false };
  await post(payload, HOOK_A);
  for (let i = 0; i < 10; i++) await post({ hook_event_name: 'Stop', session_id: `fold-740-other-${i}` }, { ...HOOK_A, 'X-Emerald-Session': `other-${i}` });
  await sleep(1500);
  await post(payload, HOOK_B);
  await settle();
  const ours = calls.slice(before).filter((c) => c.payload.session_id === 'fold-740b');
  assert.equal(ours.length, 1, 'the second copy is folded');
});

test('readHeadFields takes the tail\'s last tool_use_id, not one inside a string there (M9 fix 740)', () => {
  const head = '{"session_id":"s","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"content":"xxxx';
  const tail = 'xx \\"tool_use_id\\": \\"inside\\" xx"},"tool_response":{"ok":true},"tool_use_id":"tu-tail","duration_ms":5}';
  assert.equal(readHeadFields(head, tail)?.tool_use_id, 'tu-tail');
  const inString = 'xx \\"tool_use_id\\": \\"inside\\" xx"}}';
  assert.equal(readHeadFields(head, inString)?.tool_use_id, undefined, 'an escaped key inside a string is no key');
});

test('canonicalJson sorts keys at every depth and keeps arrays in order (M9 fix 725)', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: null } }), '{"a":{"c":null,"d":[2,{"x":0,"y":1}]},"b":1}');
});

test('a session launched with the mod whose Stops all came from the hook file is warned of once (M9 fix 725)', async () => {
  const warned: string[] = [];
  // The test's handler knows one session, so the unknown-session warns are left out.
  const log = { info() {}, warn(msg: string) { if (msg.startsWith('the emerald mod')) warned.push(msg); }, error() {} };
  const dir = mkTemp('emerald-hooks-mod-');
  const send = (s: HookSink, session: string, hook: string, body: object) =>
    fetch(`http://127.0.0.1:${s.port}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': TOKEN, 'X-Emerald-Session': session, 'X-Emerald-Hook': hook },
      body: JSON.stringify(body),
    });
  const a = await HookSink.listen(handler, { preferredPort: 0, token: TOKEN, eventLogPath: path.join(dir, 'a.jsonl'), log, expectsMod: () => true });
  try {
    await send(a, 'mod-2', HOOK_A['X-Emerald-Hook'], { hook_event_name: 'Stop', n: 1 });
    await sleep(1100);
    await send(a, 'mod-2', HOOK_A['X-Emerald-Hook'], { hook_event_name: 'Stop', n: 2 });
    await send(a, 'mod-3', 'emerald-mod', { hook_event_name: 'UserPromptSubmit' });
    await send(a, 'mod-3', HOOK_A['X-Emerald-Hook'], { hook_event_name: 'Stop' });
    await settle();
  } finally {
    await a.close();
  }
  assert.deepEqual(warned, ['the emerald mod posted nothing for mod-2: every hook came from the hook file']);
  const b = await HookSink.listen(handler, { preferredPort: 0, token: TOKEN, eventLogPath: path.join(dir, 'b.jsonl'), log, expectsMod: () => false });
  try {
    await send(b, 'mod-4', HOOK_A['X-Emerald-Hook'], { hook_event_name: 'Stop' });
    await settle();
  } finally {
    await b.close();
  }
  assert.equal(warned.length, 1, 'a session not launched with the mod is never warned of');
});

test('the preferred port is used when free and an ephemeral one otherwise', async () => {
  const a = await HookSink.listen(handler, { preferredPort: 0, eventLogPath: logPath, log: silentLogger });
  assert.ok(a.port > 0);
  assert.equal(a.token.length, 48, 'a generated token is 24 random bytes as hex');
  const b = await HookSink.listen(handler, { preferredPort: a.port, eventLogPath: logPath, log: silentLogger });
  assert.notEqual(b.port, a.port, 'fell back instead of failing');
  await a.close();
  const c = await HookSink.listen(handler, { preferredPort: a.port, eventLogPath: logPath, log: silentLogger });
  assert.equal(c.port, a.port, 'the preferred port is taken once it is free');
  await b.close();
  await c.close();
});

test('end to end: a real session moves through the sink and the manager', async () => {
  const manager = new SessionManager(silentLogger, { staleCheckIntervalMs: 0, staleAfterMs: 1000 });
  const changes: SessionInfo[] = [];
  manager.on('changed', (info: SessionInfo) => changes.push(info));
  const live = await HookSink.listen((id, payload, at) => manager.applyHook(id, payload, at), {
    preferredPort: 0,
    eventLogPath: logPath,
    log: silentLogger,
  });
  const session = manager.spawn({ kind: 'shell', cwd: process.cwd(), cols: 80, rows: 24 });
  try {
    const send = (payload: object) =>
      fetch(`http://127.0.0.1:${live.port}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': live.token, 'X-Emerald-Session': session.id },
        body: JSON.stringify(payload),
      });
    assert.equal((await send({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'real-1' })).status, 204);
    assert.equal((await send({ hook_event_name: 'UserPromptSubmit', session_id: 'real-1' })).status, 204);
    // A nested claude -p inside the session: different session_id, ignored.
    assert.equal((await send({ hook_event_name: 'Stop', session_id: 'nested-2' })).status, 204);
    await settle();
    let info = manager.list().find((s) => s.id === session.id)!;
    assert.equal(info.state, 'working');
    assert.equal(info.claudeSessionId, 'real-1');
    assert.ok(changes.some((c) => c.id === session.id && c.state === 'working'), 'subscribers saw working');

    // Stale after a quiet second, cleared by the next event.
    manager.checkStale(info.lastEventAt! + 999);
    assert.equal(manager.list().find((s) => s.id === session.id)!.stale, false);
    manager.checkStale(info.lastEventAt! + 1000);
    assert.equal(manager.list().find((s) => s.id === session.id)!.stale, true);
    assert.equal((await send({ hook_event_name: 'PermissionRequest', session_id: 'real-1', tool_name: 'Bash' })).status, 204);
    await settle();
    info = manager.list().find((s) => s.id === session.id)!;
    assert.equal(info.stale, false);
    assert.equal(info.state, 'needs-input');
    assert.equal(info.needsInputReason, 'permission');

    assert.equal((await send({ hook_event_name: 'Stop', session_id: 'real-1' })).status, 204);
    await settle();
    assert.equal(manager.list().find((s) => s.id === session.id)!.state, 'done');
    manager.ack(session.id);
    assert.equal(manager.list().find((s) => s.id === session.id)!.state, 'idle');

    const mine = logLines().filter((l) => l['sessionId'] === session.id);
    assert.deepEqual(
      mine.map((l) => l['outcome']),
      ['applied', 'applied', 'ignored-foreign', 'applied', 'applied'],
    );
    // The transition rides on the line when the event made one and is
    // absent when it did not: the SessionStart found a shell already idle,
    // and the foreign Stop was dropped.
    assert.deepEqual(
      mine.map((l) => (l['from'] === undefined ? null : `${l['from']} -> ${l['to']}`)),
      [null, 'idle -> working', null, 'working -> needs-input', 'needs-input -> done'],
    );
  } finally {
    manager.killAll();
    manager.close();
    await live.close();
  }
});

test('close comes back with a keep-alive client still holding its socket (M9 fix 164)', async () => {
  const alone = await HookSink.listen(handler, { preferredPort: 0, token: TOKEN, eventLogPath: logPath, log: silentLogger });
  // An agent that keeps the connection open after the post, as a pooled
  // client does; the sink must not wait for it to let go.
  const agent = new http.Agent({ keepAlive: true });
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: alone.port, path: '/hook', method: 'POST', agent, headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': TOKEN, 'X-Emerald-Session': 'known' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ hook_event_name: 'Stop' }));
  });
  assert.equal(status, 204);
  const started = Date.now();
  await Promise.race([alone.close(), sleep(3000).then(() => Promise.reject(new Error('close hung on the keep-alive socket')))]);
  assert.ok(Date.now() - started < 1000, `close took ${Date.now() - started} ms`);
  agent.destroy();
});

test('the written line is trimmed: a tool response cut to its first kilobyte and marked, a StatusLine down to the fields the activity log reads, whole under EMERALD_HOOKS_FULL (M9 fix 377)', async () => {
  const dir = mkTemp('emerald-hooks-trim-');
  const file = path.join(dir, 'hooks.jsonl');
  const seen: HookPayload[] = [];
  const keep: HookHandler = (_sessionId, payload) => {
    seen.push(payload);
    return { outcome: 'applied' };
  };
  const trimming = await HookSink.listen(keep, { preferredPort: 0, token: TOKEN, eventLogPath: file, log: silentLogger });
  const postTo = (sink: HookSink, body: object) =>
    fetch(`http://127.0.0.1:${sink.port}/hook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': TOKEN, 'X-Emerald-Session': 'known' }, body: JSON.stringify(body) });
  const read = () =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  const big = 'x'.repeat(10 * 1024);
  const post = { hook_event_name: 'PostToolUse', session_id: 'c1', cwd: 'C:\\x', tool_name: 'Read', tool_use_id: 't1', tool_input: { file_path: 'C:\\x\\a.ts' }, tool_response: { type: 'text', file: { filePath: 'C:\\x\\a.ts', content: big, numLines: 400 } } };
  const status = { hook_event_name: 'StatusLine', session_id: 'c1', cwd: 'C:\\x', transcript_path: 'C:\\t.jsonl', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, effort: { level: 'high' }, cost: { total_cost_usd: 1.5, total_duration_ms: 100 }, context_window: { context_window_size: 200000, current_usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 4 }, used_percentage: 7 }, rate_limits: { five_hour: { used_percentage: 34 } }, prompt_cache: { warm: true, ttl: '1h', expires_at: 1792090000, requests: 3, hit_ratio: 0.9 }, workspace: { current_dir: 'C:\\x' }, version: '2.1.278' };
  // The Agent tool's response keeps the fields the activity log binds a
  // description by, whatever the report's length.
  const agent = { hook_event_name: 'PostToolUse', session_id: 'c1', tool_name: 'Agent', tool_input: { description: 'Look around', subagent_type: 'Explore', prompt: big }, tool_response: { agentId: 'a1', description: 'Look around', content: [{ type: 'text', text: big }] } };
  try {
    assert.equal((await postTo(trimming, post)).status, 204);
    assert.equal((await postTo(trimming, status)).status, 204);
    assert.equal((await postTo(trimming, agent)).status, 204);
    await settle();
    // The handler saw every byte.
    assert.equal(seen.length, 3);
    assert.deepEqual(seen[0], post);
    assert.deepEqual(seen[1], status);
    const lines = read();
    assert.equal(lines.length, 3);
    const written = lines[0]!['payload'] as Record<string, unknown>;
    assert.equal(written['truncated'], true);
    assert.equal(written['tool_name'], 'Read');
    assert.deepEqual(written['tool_input'], { file_path: 'C:\\x\\a.ts' });
    const response = written['tool_response'] as { type: string; file: { filePath: string; content: string; numLines: number } };
    assert.equal(response.type, 'text');
    assert.equal(response.file.filePath, 'C:\\x\\a.ts');
    assert.equal(response.file.content.length, 1024);
    assert.equal(response.file.numLines, 400);
    assert.ok(JSON.stringify(lines[0]).length < 1500, `the line is ${JSON.stringify(lines[0]).length} bytes`);
    assert.deepEqual(lines[1]!['payload'], { hook_event_name: 'StatusLine', session_id: 'c1', cwd: 'C:\\x', transcript_path: 'C:\\t.jsonl', model: status.model, effort: { level: 'high' }, cost: status.cost, context_window: status.context_window, prompt_cache: { warm: true, ttl: '1h', expires_at: 1792090000 } });
    const agentLine = lines[2]!['payload'] as Record<string, unknown>;
    assert.equal(agentLine['truncated'], true);
    assert.deepEqual(agentLine['tool_input'], { description: 'Look around', subagent_type: 'Explore', prompt: 'x'.repeat(1024) });
    assert.deepEqual(agentLine['tool_response'], { agentId: 'a1', description: 'Look around', content: [{ type: 'text', text: 'x'.repeat(1024) }] });
    // A line with nothing to cut is written as it came, with no mark.
    const small = { hook_event_name: 'PostToolUse', session_id: 'c1', tool_name: 'Bash', tool_input: { command: 'git status' }, tool_response: { stdout: 'clean', stderr: '' } };
    assert.equal((await postTo(trimming, small)).status, 204);
    await settle();
    assert.deepEqual(read()[3]!['payload'], small);
  } finally {
    await trimming.close();
  }
  // Under the variable the line keeps the whole payload.
  process.env['EMERALD_HOOKS_FULL'] = '1';
  let full: HookSink;
  try {
    full = await HookSink.listen(keep, { preferredPort: 0, token: TOKEN, eventLogPath: file, log: silentLogger });
  } finally {
    delete process.env['EMERALD_HOOKS_FULL'];
  }
  try {
    assert.equal((await postTo(full, post)).status, 204);
    assert.equal((await postTo(full, status)).status, 204);
    await settle();
    const lines = read();
    assert.deepEqual(lines[4]!['payload'], post);
    assert.deepEqual(lines[5]!['payload'], status);
  } finally {
    await full.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('trimPayload cuts an array past the kilobyte and leaves a scalar alone', () => {
  const many = { hook_event_name: 'PostToolUse', session_id: 'c1', tool_name: 'Glob', tool_input: { pattern: '**/*.ts' }, tool_response: { filenames: Array.from({ length: 500 }, (_, i) => `C:\\x\\src\\file-${i}.ts`), numFiles: 500 } };
  const out = trimPayload(many);
  const response = out.tool_response as { filenames: string[]; numFiles: number };
  assert.ok(response.filenames.length > 10 && response.filenames.length < 100, `${response.filenames.length} names kept`);
  assert.equal(response.numFiles, 500);
  assert.equal(out['truncated'], true);
  assert.equal(many.tool_response.filenames.length, 500, "the caller's payload is untouched");
  const bare = { hook_event_name: 'Stop', session_id: 'c1', last_assistant_message: 'y'.repeat(5000) };
  assert.equal(trimPayload(bare), bare, 'a payload with no tool fields is the same object');
});

test('the log rotates while the sink runs: every line present in order across hooks.1.jsonl and the fresh file, and the lines written mid-swap kept (M9 fix 429)', async () => {
  const file = path.join(mkTemp('emerald-hooks-rot-'), 'hooks.jsonl');
  const own = await HookSink.listen(() => ({ outcome: 'applied', from: 'idle', to: 'working' }), { preferredPort: 0, token: TOKEN, eventLogPath: file, log: silentLogger });
  const read = (p: string): number[] =>
    fs.existsSync(p)
      ? fs
          .readFileSync(p, 'utf8')
          .split('\n')
          .filter((l) => l !== '')
          .map((l) => (JSON.parse(l) as { n: number }).n)
      : [];
  // The fresh stream opens asynchronously and buffers until it is open, so the
  // disk can lag well past a fixed sleep under load; wait for the lines instead.
  // A deadline passed falls through to the deepEquals, which say what is missing.
  const until = async (ok: () => boolean, ms: number): Promise<boolean> => {
    const end = Date.now() + ms;
    while (!ok()) {
      if (Date.now() > end) return false;
      await sleep(20);
    }
    return true;
  };
  try {
    for (let n = 1; n <= 5; n++) own.append({ n });
    await until(() => read(file).length === 5, 5000);
    assert.equal(await own.rotateIfPast(1_000_000), false, 'under the threshold nothing moves');
    // The threshold sits just under the file's size: the trim after the
    // rotation cuts a generation past four times it, and since fix 629
    // generation 1 is a fresh file the trim can rename over (before, the
    // old stream's handle still held it and the trim failed quietly).
    const swap = own.rotateIfPast(39);
    // These land while the old stream is ending and the file is renamed.
    for (let n = 6; n <= 8; n++) own.append({ n });
    assert.equal(await swap, true);
    for (let n = 9; n <= 10; n++) own.append({ n });
    await until(() => read(file).length === 5, 5000);
    const rotated = path.join(path.dirname(file), 'hooks.1.jsonl');
    assert.deepEqual([...read(rotated), ...read(file)], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(read(rotated), [1, 2, 3, 4, 5], 'the rotated file holds what was written before the swap');
    // A second rotation shifts the first generation down.
    assert.equal(await own.rotateIfPast(40), true);
    own.append({ n: 11 });
    await until(() => read(file).length === 1, 5000);
    assert.deepEqual(read(path.join(path.dirname(file), 'hooks.2.jsonl')), [1, 2, 3, 4, 5]);
    assert.deepEqual(read(rotated), [6, 7, 8, 9, 10]);
    assert.deepEqual(read(file), [11]);
  } finally {
    await own.close();
  }
  assert.equal(await own.rotateIfPast(0), false, 'a closed sink never rotates');
});

test('a Test event is answered and remembered, and reaches no handler and no line of hooks.jsonl (M9 fix 606)', async () => {
  await settle();
  const callsBefore = calls.length;
  const linesBefore = logLines().length;
  const res = await post({ hook_event_name: 'Test', session_id: 'emerald-test', test_id: 'abc606' }, { 'X-Emerald-Session': 'emerald-test' });
  assert.equal(res.status, 204);
  await settle();
  assert.equal(calls.length, callsBefore, 'no handler call');
  assert.equal(logLines().length, linesBefore, 'no line in hooks.jsonl');
  assert.equal(sink.testArrived('abc606'), true);
  assert.equal(sink.testArrived('nope'), false);
  // The unhosted branch is remembered the same way.
  const unhosted = await post({ hook_event_name: 'Test', session_id: 'emerald-test', test_id: 'def606' }, { 'X-Emerald-Session': '', 'X-Emerald-Unhosted': '1' });
  assert.equal(unhosted.status, 204);
  assert.equal(sink.testArrived('def606'), true);
  // A Test with no test_id is answered and remembered under nothing.
  const bare = await post({ hook_event_name: 'Test', session_id: 'emerald-test' }, { 'X-Emerald-Session': 'emerald-test' });
  assert.equal(bare.status, 204);
  await settle();
  assert.equal(calls.length, callsBefore, 'still no handler call');
  assert.equal(logLines().length, linesBefore, 'still no line in hooks.jsonl');
});

test("an Append's hooks.jsonl line carries its uuid, door and the row's kind and block count, and no content (M9 fix 769)", async () => {
  const row = { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'a reply the transcript keeps' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:/x' } }] };
  const body = { hook_event_name: 'Append', session_id: 'c769', uuid: 'u-769', door: 'response', row };
  const before = logLines().length;
  assert.equal((await post(body)).status, 204);
  await settle();
  // The handler sees the row whole.
  assert.deepEqual(calls.at(-1)!.payload, body);
  const lines = logLines();
  assert.equal(lines.length, before + 1);
  assert.deepEqual(lines.at(-1)!['payload'], { hook_event_name: 'Append', session_id: 'c769', uuid: 'u-769', door: 'response', row: { type: 'assistant', blocks: 2 } });
  assert.ok(!JSON.stringify(lines.at(-1)).includes('a reply the transcript keeps'));
});

test("POST /compact answers the mod's question from the handler, with the session and trigger it got, and writes nothing to the log (M9 fix 773)", async () => {
  const dir = mkTemp('emerald-compact-');
  const asked: Array<[string, string]> = [];
  const ask = (id: string, trigger: string) => {
    asked.push([id, trigger]);
    if (trigger === 'boom') throw new Error('handler blew up');
    return trigger === 'auto' ? 'kept whole while idle by emerald' : null;
  };
  const withAsk = await HookSink.listen(handler, { preferredPort: 0, token: TOKEN, eventLogPath: path.join(dir, 'a.jsonl'), log: silentLogger, compactAsk: ask });
  const without = await HookSink.listen(handler, { preferredPort: 0, token: TOKEN, eventLogPath: path.join(dir, 'b.jsonl'), log: silentLogger });
  const compact = (s: HookSink, body: object, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${s.port}/compact`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': TOKEN, 'X-Emerald-Session': 'emerald-1', ...headers }, body: JSON.stringify(body) });
  try {
    const yes = await compact(withAsk, { trigger: 'auto' });
    assert.equal(yes.status, 200);
    assert.match(yes.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await yes.json(), { skip: 'kept whole while idle by emerald' });
    assert.deepEqual(asked, [['emerald-1', 'auto']], 'the handler got the session and the trigger');
    assert.deepEqual(await (await compact(withAsk, { trigger: 'manual' })).json(), { skip: null });
    assert.deepEqual(await (await compact(withAsk, { trigger: 'boom' })).json(), { skip: null }, 'a handler that throws lets the compaction through');
    assert.deepEqual(await (await compact(without, { trigger: 'auto' })).json(), { skip: null }, 'a sink with no handler lets every compaction through');
    assert.equal((await compact(withAsk, { trigger: 'auto' }, { 'X-Emerald-Token': 'nope' })).status, 401);
    assert.equal((await compact(withAsk, { trigger: 'auto' }, { 'X-Emerald-Session': '' })).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${withAsk.port}/compact`, { headers: { 'X-Emerald-Token': TOKEN } })).status, 404, 'a GET is 404');
    await settle();
    for (const f of ['a.jsonl', 'b.jsonl']) {
      const file = path.join(dir, f);
      assert.equal(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', '', `nothing written to ${f}`);
    }
  } finally {
    await withAsk.close();
    await without.close();
  }
});

test("the mod's ModSubmit goes to onModSubmit alone, never the handler or the log, and only from the mod (M9 fix 781)", async () => {
  const dir = mkTemp('emerald-modsubmit-');
  const file = path.join(dir, 'h.jsonl');
  const words: Array<[string, string, boolean, string | null]> = [];
  const handled: string[] = [];
  const own = await HookSink.listen((_id, payload) => {
    handled.push(String(payload.hook_event_name));
    return { outcome: 'applied', from: 'idle', to: 'idle' };
  }, { preferredPort: 0, token: TOKEN, eventLogPath: file, log: silentLogger, onModSubmit: (id, submitId, entered, drop) => words.push([id, submitId, entered, drop]) });
  const send = (body: object, hook: string) =>
    fetch(`http://127.0.0.1:${own.port}/hook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': TOKEN, 'X-Emerald-Session': 'emerald-781', 'X-Emerald-Hook': hook }, body: JSON.stringify(body) });
  try {
    assert.equal((await send({ hook_event_name: 'ModSubmit', session_id: 'c781', submit_id: 'emerald--1', entered: false, drop: 'the session was stopped and nobody has sent input since' }, 'emerald-mod')).status, 204);
    assert.equal((await send({ hook_event_name: 'ModSubmit', session_id: 'c781', submit_id: 'emerald--2', entered: true }, 'emerald-mod')).status, 204);
    // From the hook file, not the mod: ignored.
    await send({ hook_event_name: 'ModSubmit', session_id: 'c781', submit_id: 'emerald--3', entered: true }, HOOK_A['X-Emerald-Hook']);
    await settle();
    assert.deepEqual(words, [
      ['emerald-781', 'emerald--1', false, 'the session was stopped and nobody has sent input since'],
      ['emerald-781', 'emerald--2', true, null],
    ]);
    assert.deepEqual(handled, [], 'the session handler never sees a ModSubmit');
    assert.equal(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '', '', 'no hooks.jsonl line');
  } finally {
    await own.close();
  }
});
