import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { PROTOCOL_VERSION } from '@emerald/shared';
import type { Layout, ServerMessage, SessionInfo } from '@emerald/shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { currentTab, replaceTab, splitPane } from '@emerald/shared';
import { PipeClient } from '@emerald/shared/pipe-client';
import { ActivityLog, parseActivityLine } from './activity.ts';
import { LayoutStore } from './layout-store.ts';
import { silentLogger } from './log.ts';
import { FILE_OPEN_ANSWER_LEVEL, LIMITS_PUSH_LEVEL, LOAD_PUSH_LEVEL, PipeServer, ROW_PUSH_LEVEL, claimPipe } from './pipe-server.ts';
import { SessionManager } from './session-manager.ts';
import type { LoadTick } from './session-manager.ts';

// A private pipe name so the test never collides with a running emmerd.
const PIPE = `\\\\.\\pipe\\emmerd-test-${process.pid}`;

let server: PipeServer;
let manager: SessionManager;
let layouts: LayoutStore;

before(async () => {
  manager = new SessionManager(silentLogger);
  layouts = new LayoutStore(path.join(mkTemp('emerald-pipe-'), 'state.json'), silentLogger);
  layouts.load();
  server = new PipeServer(manager, layouts, { pipePath: PIPE, daemonVersion: 'test', log: silentLogger });
  await server.listen();
});

after(async () => {
  manager.killAll();
  await server.close();
  await removeTemps();
});

function waitFor(client: PipeClient, pred: (m: ServerMessage) => boolean, timeoutMs = 15_000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
    const onMsg = (m: ServerMessage) => {
      if (!pred(m)) return;
      clearTimeout(timer);
      client.off('message', onMsg);
      resolve(m);
    };
    client.on('message', onMsg);
  });
}

test('hello checks the protocol version', async () => {
  const client = await PipeClient.connect(PIPE);
  const res = await client.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
  assert.equal(res.daemonPid, process.pid);
  assert.equal(res.daemonVersion, 'test');
  // M9 fix 494: when this process started, for a client's kill check.
  const started = Date.now() - process.uptime() * 1000;
  assert.ok(typeof res.daemonStartedAt === 'number' && Math.abs(res.daemonStartedAt - started) < 2000, `daemonStartedAt ${res.daemonStartedAt} against ${started}`);
  // M9 fix 495: the home it serves, resolved; this server has none on its
  // options, so EMERALD_HOME's or the default's.
  assert.equal(res.home, path.resolve(process.env['EMERALD_HOME'] ?? path.join(os.homedir(), '.emerald')));
  await assert.rejects(client.request('hello', { client: 'cli', protocolVersion: 99 }), { code: 'protocol-mismatch' });
  client.close();
});

test('the hello carries the installed shells, and session.spawn refuses an unknown shell and a shell on a Claude (M9 fix 624)', async () => {
  const client = await PipeClient.connect(PIPE);
  try {
    const res = await client.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    const ids = (res.shells ?? []).map((o) => o.id);
    assert.ok(ids[0] === 'pwsh' || ids[0] === 'powershell', `the default is a PowerShell: ${ids.join(', ')}`);
    assert.equal(ids.at(-1), 'cmd');
    const cwd = process.cwd();
    await assert.rejects(client.request('session.spawn', { kind: 'shell', cwd, shell: 'zsh' as never, cols: 80, rows: 24 }), { code: 'bad-request', message: 'unknown shell zsh; one of pwsh, powershell, gitbash, cmd' });
    await assert.rejects(client.request('session.spawn', { kind: 'claude', cwd, shell: 'cmd', cols: 80, rows: 24 }), { code: 'bad-request', message: 'shell is for kind shell, not claude' });
  } finally {
    client.close();
  }
});

test('bad requests get error replies and the connection stays up', async () => {
  const client = await PipeClient.connect(PIPE);
  await assert.rejects(client.request('session.kill', { sessionId: 'nope' }), { code: 'not-found' });
  await assert.rejects(client.request('session.spawn', { kind: 'shell', cwd: 'C:\\definitely\\not\\here', cols: 80, rows: 24 }), { code: 'bad-request' });
  await assert.rejects(client.request('layout.set', { layout: 'nope' as never }), { code: 'bad-request' });
  const list = await client.request('session.list', {});
  assert.deepEqual(list.sessions, []);
  client.close();
});

test('a name, a comment and a scheme past their bounds are refused before the lookup (M9 fix 511)', async () => {
  const client = await PipeClient.connect(PIPE);
  try {
    const sessionId = 'no-such-session';
    await assert.rejects(client.request('session.rename', { sessionId, name: 'a'.repeat(201) }), { code: 'bad-request', message: 'name must be one line of at most 200 characters' });
    await assert.rejects(client.request('session.rename', { sessionId, name: 'a\nb' }), { code: 'bad-request', message: 'name must be one line of at most 200 characters' });
    await assert.rejects(client.request('session.set', { sessionId, comment: 'x'.repeat(2001) }), { code: 'bad-request', message: 'comment must be at most 2000 characters' });
    await assert.rejects(client.request('session.set', { sessionId, scheme: 's'.repeat(65) }), { code: 'bad-request', message: 'scheme must be at most 64 characters' });
    // At the bound the name reaches the manager, which knows no such session.
    await assert.rejects(client.request('session.rename', { sessionId, name: 'a'.repeat(200) }), { code: 'not-found' });
  } finally {
    client.close();
  }
});

test('layout.get, layout.set, stale rejection and layout.changed push', async () => {
  const subscriber = await PipeClient.connect(PIPE);
  await subscriber.request('subscribe', { topics: ['layout'] });
  const editor = await PipeClient.connect(PIPE);
  const silent = await PipeClient.connect(PIPE);

  const { layout: base } = await editor.request('layout.get', {});
  assert.equal(currentTab(base).root.kind, 'pane');

  const pushed = waitFor(subscriber, (m) => m.type === 'layout.changed');
  const silentGot: ServerMessage[] = [];
  silent.on('message', (m: ServerMessage) => silentGot.push(m));
  const split = (l: Layout, direction: 'row' | 'column') => replaceTab(l, splitPane(currentTab(l), currentTab(l).root.id, direction));
  const { layout: accepted } = await editor.request('layout.set', { layout: split(base, 'row') });
  assert.equal(accepted.revision, base.revision + 1);
  assert.equal(currentTab(accepted).root.kind, 'split');
  const push = await pushed;
  assert.ok(push.type === 'layout.changed');
  assert.deepEqual(push.layout, accepted);
  assert.equal(layouts.get().revision, accepted.revision, 'the store is what the server serves');

  // The same base revision a second time is stale now.
  await assert.rejects(editor.request('layout.set', { layout: split(base, 'column') }), { code: 'stale-revision' });
  const { layout: current } = await editor.request('layout.get', {});
  assert.deepEqual(current, accepted);

  // Unsubscribed clients hear nothing.
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(silentGot, []);

  subscriber.close();
  editor.close();
  silent.close();
});

test('window.open, window.front and window.close over the wire, each pushed as layout.changed, the last window refused (M9 fix 865)', async () => {
  const subscriber = await PipeClient.connect(PIPE);
  await subscriber.request('subscribe', { topics: ['layout'] });
  const client = await PipeClient.connect(PIPE);
  try {
    const pushes: Layout[] = [];
    subscriber.on('message', (m: ServerMessage) => {
      if (m.type === 'layout.changed') pushes.push(m.layout);
    });
    const { layout: base } = await client.request('layout.get', {});
    const opened = await client.request('window.open', {});
    assert.equal(typeof opened.windowId, 'string');
    assert.deepEqual(opened.layout.windows!.map((w) => w.id), ['first', opened.windowId]);
    assert.equal(opened.layout.tabs.length, base.tabs.length + 1);
    const { layout: fronted } = await client.request('window.front', { windowId: 'first' });
    assert.equal(fronted.currentTabId, base.currentTabId);
    const { layout: closed } = await client.request('window.close', { windowId: opened.windowId });
    assert.equal('windows' in closed, false);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(pushes, [opened.layout, fronted, closed], 'three pushes, one per edit');

    // The last window: one left that is not the first, which cannot close.
    const again = await client.request('window.open', {});
    const { layout: lone } = await client.request('window.close', { windowId: 'first' });
    assert.deepEqual(lone.windows!.map((w) => w.id), [again.windowId]);
    await assert.rejects(client.request('window.close', { windowId: again.windowId }), { code: 'bad-request', message: 'the last window cannot close' });
    await assert.rejects(client.request('window.close', {} as never), { code: 'bad-request' });
    // Back to the shape the later tests expect: one first window, no field.
    const { layout: restored } = await client.request('layout.set', { layout: { ...lone, windows: [{ id: 'first', tabIds: lone.tabs.map((t) => t.id), currentTabId: lone.currentTabId }] } });
    assert.equal('windows' in restored, false);
  } finally {
    subscriber.close();
    client.close();
  }
});

test('malformed framing drops the client', async () => {
  const client = await PipeClient.connect(PIPE);
  const closed = once(client, 'close');
  // Reach past the typed API on purpose to send garbage.
  (client as unknown as { socket: { write(s: string): void } }).socket.write('this is not json\n');
  await closed;
});

// M9 fix 245: the presence edges. The first connection that says hello
// as the app is `back`, the last app connection closing is `away`; a
// second hello on one connection, a CLI's hello and a CLI's close
// change nothing; and presence.away and presence.back from any client
// (the app's lock, sleep and idle edges) pass through as they are.
test('the app edges and the presence requests reach onPresence (M9 fix 245)', async () => {
  const edges: string[] = [];
  const pipe = `${PIPE}-presence`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, onPresence: (kind) => edges.push(kind) });
  await own.listen();
  try {
    const cli = await PipeClient.connect(pipe);
    await cli.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    assert.deepEqual(edges, []);
    assert.equal(own.appClientCount, 0);
    const app = await PipeClient.connect(pipe);
    await app.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION });
    await app.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION });
    assert.deepEqual(edges, ['back']);
    assert.equal(own.appClientCount, 1);
    const second = await PipeClient.connect(pipe);
    await second.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION });
    assert.deepEqual(edges, ['back']);
    assert.equal(own.appClientCount, 2);
    await cli.request('presence.away', {});
    await cli.request('presence.back', {});
    assert.deepEqual(edges, ['back', 'away', 'back']);
    const untilOne = new Promise<void>((resolve) => {
      const tick = () => (own.appClientCount === 1 ? resolve() : setTimeout(tick, 20));
      tick();
    });
    second.close();
    await untilOne;
    assert.deepEqual(edges, ['back', 'away', 'back']);
    const untilNone = new Promise<void>((resolve) => {
      const tick = () => (own.appClientCount === 0 ? resolve() : setTimeout(tick, 20));
      tick();
    });
    app.close();
    await untilNone;
    assert.deepEqual(edges, ['back', 'away', 'back', 'away']);
    cli.close();
  } finally {
    await own.close();
  }
  // The server's own close fired no edge for the CLI, and none for an app
  // still on the pipe as the daemon stops.
  assert.deepEqual(edges, ['back', 'away', 'back', 'away']);
});

// M9 fix 271: the update relay. update.state is null with 0 apps before
// any window reported; a reported state comes back as sent; update.act
// reaches every connection on the app topic as update.requested and
// counts them, 0 when none is on it (the CLI's `no window to update`);
// a report of the wrong shape is refused; and the last state survives
// the window's close.
test('update.report, update.state and update.act relay the updater between the app and the CLI (M9 fix 271)', async () => {
  const pipe = `${PIPE}-update`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await own.listen();
  try {
    const cli = await PipeClient.connect(pipe);
    await cli.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    assert.deepEqual(await cli.request('update.state', {}), { state: null, apps: 0 });
    assert.deepEqual(await cli.request('update.act', {}), { apps: 0 });
    await assert.rejects(cli.request('update.report', { state: { phase: 'nope' } as never }), { code: 'bad-request' });
    // The check count (M9 fix 539) is optional and a number when present.
    await assert.rejects(cli.request('update.report', { state: { phase: 'idle', current: '0.1.240', latest: null, percent: null, message: null, checks: 'x' } as never }), { code: 'bad-request' });

    const app = await PipeClient.connect(pipe);
    await app.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION });
    await app.request('subscribe', { topics: ['app'] });
    const state = { phase: 'available' as const, current: '0.1.240', latest: '0.1.258', percent: null, message: null, checks: 3 };
    await app.request('update.report', { state });
    assert.deepEqual(await cli.request('update.state', {}), { state, apps: 1 });

    const requested = waitFor(app, (m) => m.type === 'update.requested');
    assert.deepEqual(await cli.request('update.act', {}), { apps: 1 });
    assert.deepEqual(await requested, { type: 'update.requested' });
    // A connection not on the topic (the CLI itself) hears nothing: the
    // reply is the only message it got.
    const heard: ServerMessage[] = [];
    cli.on('message', (m: ServerMessage) => heard.push(m));
    await cli.request('update.act', {});
    assert.deepEqual(heard, []);

    const untilGone = new Promise<void>((resolve) => {
      const tick = () => (own.clientCount === 1 ? resolve() : setTimeout(tick, 20));
      tick();
    });
    app.close();
    await untilGone;
    assert.deepEqual(await cli.request('update.state', {}), { state, apps: 0 });
    cli.close();
  } finally {
    await own.close();
  }
});

// M9 fix 836: activity.totals folds one folder's history on the daemon's
// side; the shared server, which has no activity log, answers zeros.
test('activity.totals answers one folder\'s totals and a row per month, and refuses a request with no folder or a window backwards (M9 fix 836)', async () => {
  const pipe = `${PIPE}-totals`;
  const activity = new ActivityLog();
  const conv = 'conv-totals';
  const at = Date.now() - 60 * 60_000;
  const payload = (event: string, extra: Record<string, unknown> = {}) => ({ hook_event_name: event, session_id: conv, cwd: 'C:/code/proj', ...extra });
  const lines = [
    { at, sessionId: conv, event: 'UserPromptSubmit', unhosted: true, outcome: 'applied', from: 'idle', to: 'working', payload: payload('UserPromptSubmit') },
    { at: at + 60_000, sessionId: conv, event: 'StatusLine', unhosted: true, outcome: 'applied', payload: payload('StatusLine', { model: { display_name: 'Opus 5' }, cost: { total_cost_usd: 0.2 }, context_window: { used_percentage: 5, current_usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } }) },
    { at: at + 120_000, sessionId: conv, event: 'Stop', unhosted: true, outcome: 'applied', from: 'working', to: 'done', payload: payload('Stop') },
  ];
  for (const l of lines) activity.record(parseActivityLine(JSON.stringify(l))!);
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, activity });
  await own.listen();
  try {
    const cli = await PipeClient.connect(pipe);
    await cli.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    const t = await cli.request('activity.totals', { folder: 'C:/code/proj' });
    assert.equal(t.total.requests, 1);
    assert.ok(Math.abs(t.total.usd - 0.2) < 1e-9);
    assert.equal(t.months.length, 1);
    assert.equal(t.historyFrom, at);
    await assert.rejects(cli.request('activity.totals', {} as never), { code: 'bad-request' });
    await assert.rejects(cli.request('activity.totals', { folder: '' }), { code: 'bad-request' });
    await assert.rejects(cli.request('activity.totals', { folder: 'C:/code/proj', from: 10, to: 5 }), { code: 'bad-request' });
    cli.close();
    const plain = await PipeClient.connect(PIPE);
    await plain.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    const none = await plain.request('activity.totals', { folder: 'C:/code/proj' });
    assert.equal(none.total.requests, 0);
    assert.equal(none.total.usd, 0);
    assert.deepEqual(none.months, []);
    assert.equal(none.historyFrom, null);
    plain.close();
  } finally {
    await own.close();
  }
});

// M9 fix 341: file.open reaches every connection on the app topic as
// file.open.requested with the path and the pane flag as sent, counts
// them (0 with no window, the CLI's `no window open`), and refuses a
// request with no path or no flag.
test('file.open relays a path to the windows on the app topic (M9 fix 341)', async () => {
  const pipe = `${PIPE}-open`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await own.listen();
  try {
    const cli = await PipeClient.connect(pipe);
    await cli.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    assert.deepEqual(await cli.request('file.open', { path: 'C:\\notes.md', pane: false }), { apps: 0 });
    await assert.rejects(cli.request('file.open', { path: 'C:\\notes.md' } as never), { code: 'bad-request' });
    await assert.rejects(cli.request('file.open', { pane: true } as never), { code: 'bad-request' });

    const app = await PipeClient.connect(pipe);
    await app.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION });
    await app.request('subscribe', { topics: ['app'] });
    const requested = waitFor(app, (m) => m.type === 'file.open.requested');
    assert.deepEqual(await cli.request('file.open', { path: 'C:\\notes.md', pane: true }), { apps: 1 });
    assert.deepEqual(await requested, { type: 'file.open.requested', path: 'C:\\notes.md', pane: true });
    const heard: ServerMessage[] = [];
    cli.on('message', (m: ServerMessage) => heard.push(m));
    await cli.request('file.open', { path: 'C:\\notes.md', pane: false });
    assert.deepEqual(heard, []);
    app.close();
    cli.close();
  } finally {
    await own.close();
  }
});

// M9 fix 672: browser.run reaches the windows at level 63 alone as
// browser.requested, the first browser.done answers it, a run nobody
// answers is given the verb's budget and the slack, and the shape is
// checked before any push.
test('browser.run relays a command to a window at level 63 and holds the reply (M9 fix 672)', async () => {
  const pipe = `${PIPE}-browser`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, browserRunSlackMs: 100 });
  await own.listen();
  try {
    const cli = await PipeClient.connect(pipe);
    await cli.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    const ask = { paneId: 'pane-1234567890', verb: 'snapshot' as const, args: [], by: 'alpha', timeoutMs: 1000 };
    assert.deepEqual(await cli.request('browser.run', ask), { apps: 0 });

    // An older window is counted and never pushed to.
    const old = await PipeClient.connect(pipe);
    await old.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION, featureLevel: 62 });
    await old.request('subscribe', { topics: ['app'] });
    const heardOld: ServerMessage[] = [];
    old.on('message', (m: ServerMessage) => heardOld.push(m));
    assert.deepEqual(await cli.request('browser.run', ask), { apps: 1, drivers: 0 });
    assert.deepEqual(heardOld.filter((m) => m.type === 'browser.requested'), []);
    const oldGone = new Promise<void>((resolve) => {
      const tick = () => (own.clientCount === 1 ? resolve() : setTimeout(tick, 20));
      tick();
    });
    old.close();
    await oldGone;

    const app = await PipeClient.connect(pipe);
    await app.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION, featureLevel: 63 });
    await app.request('subscribe', { topics: ['app'] });
    const requested = waitFor(app, (m) => m.type === 'browser.requested');
    const reply = cli.request('browser.run', ask);
    const push = await requested;
    assert.equal(push.type, 'browser.requested');
    const runId = (push as { runId: number }).runId;
    assert.deepEqual(push, { type: 'browser.requested', runId, paneId: 'pane-1234567890', verb: 'snapshot', args: [], by: 'alpha', timeoutMs: 1000 });
    const answer = { ok: true, text: 'page "x" http://127.0.0.1/' };
    await app.request('browser.done', { runId, answer });
    assert.deepEqual(await reply, { apps: 1, drivers: 1, answered: true, answer });
    // A late or unknown runId is dropped.
    await app.request('browser.done', { runId: runId + 99, answer });

    // Nobody answers: the budget and the slack, then answered false.
    const started = Date.now();
    assert.deepEqual(await cli.request('browser.run', ask), { apps: 1, drivers: 1, answered: false });
    const took = Date.now() - started;
    assert.ok(took >= 1050 && took < 3000, `answered false after ${took} ms`);

    await assert.rejects(cli.request('browser.run', { ...ask, verb: 'frob' } as never), { code: 'bad-request', message: 'verb must be one of snapshot, click, hover, drag, fill, key, eval, screenshot, wait, navigate, upload, events, resume' });
    // M9 fix 673: resume is a verb, relayed like the rest.
    const resumed = waitFor(app, (m) => m.type === 'browser.requested' && m.verb === 'resume');
    const resumeReply = cli.request('browser.run', { ...ask, verb: 'resume' });
    const resumePush = (await resumed) as { runId: number };
    await app.request('browser.done', { runId: resumePush.runId, answer: { ok: true, text: 'was not paused' } });
    assert.equal((await resumeReply).answered, true);
    await assert.rejects(cli.request('browser.run', { ...ask, args: ['a', 'b', 'c'] }), { code: 'bad-request', message: 'args must be at most two strings of 65536 characters or fewer' });
    await assert.rejects(cli.request('browser.run', { ...ask, args: ['x'.repeat(65537)] }), { code: 'bad-request', message: 'args must be at most two strings of 65536 characters or fewer' });
    await assert.rejects(cli.request('browser.run', { ...ask, timeoutMs: 500 }), { code: 'bad-request', message: 'timeoutMs must be a whole number from 1000 to 120000' });
    await assert.rejects(cli.request('browser.run', { ...ask, by: 'b'.repeat(101) }), { code: 'bad-request', message: 'by must be a name of 100 characters or fewer' });
    await assert.rejects(app.request('browser.done', { runId: 1, answer: { ok: false, text: 'x' } } as never), { code: 'bad-request', message: 'answer must be { ok, text } with a reason when not ok' });
    app.close();
    cli.close();
  } finally {
    await own.close();
  }
});

test('browser.run relays drag to a window at level 72 alone (M9 fix 874)', async () => {
  const pipe = `${PIPE}-browser-drag`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, browserRunSlackMs: 100 });
  await own.listen();
  try {
    const cli = await PipeClient.connect(pipe);
    await cli.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    const ask = { paneId: 'pane-1234567890', verb: 'drag' as const, args: ['e1', '0,-60'], by: 'alpha', timeoutMs: 1000 };

    // A window at 71 drives the older verbs and is counted as no driver for drag.
    const old = await PipeClient.connect(pipe);
    await old.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION, featureLevel: 71 });
    await old.request('subscribe', { topics: ['app'] });
    const heardOld: ServerMessage[] = [];
    old.on('message', (m: ServerMessage) => heardOld.push(m));
    assert.deepEqual(await cli.request('browser.run', ask), { apps: 1, drivers: 0 });
    // M9 fix 875: a filtered snapshot needs 72 too, since an older window would print the whole page.
    assert.deepEqual(await cli.request('browser.run', { ...ask, verb: 'snapshot', args: [], filter: { name: 'Save' } }), { apps: 1, drivers: 0 });
    assert.deepEqual(heardOld.filter((m) => m.type === 'browser.requested'), []);
    const snapPushed = waitFor(old, (m) => m.type === 'browser.requested' && m.verb === 'snapshot');
    const snapReply = cli.request('browser.run', { ...ask, verb: 'snapshot', args: [] });
    const snapPush = (await snapPushed) as { runId: number };
    await old.request('browser.done', { runId: snapPush.runId, answer: { ok: true, text: 'page' } });
    assert.equal((await snapReply).answered, true);
    const oldGone = new Promise<void>((resolve) => {
      const tick = () => (own.clientCount === 1 ? resolve() : setTimeout(tick, 20));
      tick();
    });
    old.close();
    await oldGone;

    const app = await PipeClient.connect(pipe);
    await app.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION, featureLevel: 72 });
    await app.request('subscribe', { topics: ['app'] });
    const requested = waitFor(app, (m) => m.type === 'browser.requested');
    const reply = cli.request('browser.run', ask);
    const push = await requested;
    const runId = (push as { runId: number }).runId;
    assert.deepEqual(push, { type: 'browser.requested', runId, paneId: 'pane-1234567890', verb: 'drag', args: ['e1', '0,-60'], by: 'alpha', timeoutMs: 1000 });
    const answer = { ok: true, text: 'dragged @e1 by 0,-60' };
    await app.request('browser.done', { runId, answer });
    assert.deepEqual(await reply, { apps: 1, drivers: 1, answered: true, answer });

    // M9 fix 875: the filter rides on the push; an empty one is no filter.
    const snap = { ...ask, verb: 'snapshot' as const, args: [] };
    const filterPushed = waitFor(app, (m) => m.type === 'browser.requested' && m.runId > runId);
    const filterReply = cli.request('browser.run', { ...snap, filter: { name: 'Save', within: '@r2' } });
    const filterPush = (await filterPushed) as { runId: number };
    assert.deepEqual(filterPush, { type: 'browser.requested', runId: filterPush.runId, paneId: 'pane-1234567890', verb: 'snapshot', args: [], by: 'alpha', timeoutMs: 1000, filter: { name: 'Save', within: '@r2' } });
    await app.request('browser.done', { runId: filterPush.runId, answer });
    await filterReply;
    const emptyPushed = waitFor(app, (m) => m.type === 'browser.requested' && m.runId > filterPush.runId);
    const emptyReply = cli.request('browser.run', { ...snap, filter: {} });
    const emptyPush = (await emptyPushed) as { runId: number };
    assert.equal(Object.hasOwn(emptyPush, 'filter'), false);
    await app.request('browser.done', { runId: emptyPush.runId, answer });
    await emptyReply;
    await assert.rejects(cli.request('browser.run', { ...ask, verb: 'click', args: ['e1'], filter: { name: 'Save' } }), { code: 'bad-request', message: 'filter is for snapshot' });
    await assert.rejects(cli.request('browser.run', { ...snap, filter: 'x' } as never), { code: 'bad-request', message: 'filter must be { name?, within? }' });
    await assert.rejects(cli.request('browser.run', { ...snap, filter: { name: '' } }), { code: 'bad-request', message: 'filter.name must be a text of 1 to 200 characters' });
    await assert.rejects(cli.request('browser.run', { ...snap, filter: { within: 'x' } }), { code: 'bad-request', message: 'filter.within must be a ref such as @r1 or @e3' });
    app.close();
    cli.close();
  } finally {
    await own.close();
  }
});

// M9 fix 781: a channel answering each push as the mod does, posting its
// word on the submit (the hook sink hands it to modSubmitAnswered); a drop
// says the prompt did not enter. And a push read without its id.
function answerPushes(channel: PipeClient, srv: PipeServer, drop: string | null = null): void {
  channel.on('message', (m: ServerMessage) => {
    if (m.type === 'mod.submit' && m.submitId !== undefined) srv.modSubmitAnswered(m.sessionId, m.submitId, drop === null, drop);
  });
}
function withoutId(m: ServerMessage): unknown {
  const { submitId, ...rest } = m as ServerMessage & { submitId?: string };
  assert.equal(typeof submitId, 'string', 'the push carries a submitId');
  return rest;
}

test('mod.channel takes a session\'s prompts and session.submit routes through it while it is open (M9 fix 741)', async () => {
  const cli = await PipeClient.connect(PIPE);
  const { session } = await cli.request('session.spawn', { kind: 'shell', cwd: process.cwd(), cols: 80, rows: 24 });
  try {
    assert.deepEqual(await cli.request('session.submit', { sessionId: session.id, text: 'hi' }), { via: 'typed' }, 'no channel: the caller types');
    await assert.rejects(cli.request('mod.channel', { sessionId: 'nope' }), { code: 'not-found' });
    await assert.rejects(cli.request('session.submit', { sessionId: session.id } as never), { code: 'bad-request', message: 'text must be a string' });

    const first = await PipeClient.connect(PIPE);
    await first.request('mod.channel', { sessionId: session.id });
    answerPushes(first, server);
    const pushed = waitFor(first, (m) => m.type === 'mod.submit');
    assert.deepEqual(await cli.request('session.submit', { sessionId: session.id, text: 'hi' }), { via: 'mod' });
    assert.deepEqual(withoutId(await pushed), { type: 'mod.submit', sessionId: session.id, text: 'hi' });

    // A second registration takes the pushes from the first.
    const second = await PipeClient.connect(PIPE);
    await second.request('mod.channel', { sessionId: session.id });
    answerPushes(second, server);
    const firstHeard: ServerMessage[] = [];
    first.on('message', (m: ServerMessage) => firstHeard.push(m));
    const toSecond = waitFor(second, (m) => m.type === 'mod.submit');
    assert.deepEqual(await cli.request('session.submit', { sessionId: session.id, text: 'again' }), { via: 'mod' });
    assert.equal((await toSecond as { text: string }).text, 'again');
    assert.deepEqual(firstHeard.filter((m) => m.type === 'mod.submit'), []);

    // The first closing leaves the second's channel; the second closing ends it.
    first.close();
    await once(first, 'close');
    assert.deepEqual(await cli.request('session.submit', { sessionId: session.id, text: 'x' }), { via: 'mod' });
    second.close();
    await once(second, 'close');
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await cli.request('session.submit', { sessionId: session.id, text: 'y' }), { via: 'typed' });
  } finally {
    await cli.request('session.kill', { sessionId: session.id });
    cli.close();
  }
});

test('a send to a session whose mod posted waits for its channel, and one never seen or whose channel went is typed at once (M9 fix 776)', async () => {
  const pipe = `${PIPE}-776`;
  const seen = new Set<string>();
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, modSeen: (id) => seen.has(id), modChannelWaitMs: 400 });
  await own.listen();
  const cli = await PipeClient.connect(pipe);
  const { session: held } = await cli.request('session.spawn', { kind: 'shell', cwd: process.cwd(), cols: 80, rows: 24 });
  const { session: late } = await cli.request('session.spawn', { kind: 'shell', cwd: process.cwd(), cols: 80, rows: 24 });
  const { session: unseen } = await cli.request('session.spawn', { kind: 'shell', cwd: process.cwd(), cols: 80, rows: 24 });
  try {
    seen.add(held.id);
    seen.add(late.id);
    // (1) Held, then the channel opens 150 ms later and takes the push.
    const channel = await PipeClient.connect(pipe);
    answerPushes(channel, own);
    const pushed = waitFor(channel, (m) => m.type === 'mod.submit');
    const t1 = Date.now();
    const reply = cli.request('session.submit', { sessionId: held.id, text: 'early' });
    await new Promise((r) => setTimeout(r, 150));
    await channel.request('mod.channel', { sessionId: held.id });
    assert.deepEqual(await reply, { via: 'mod' }, 'a held send goes through the channel once it opens');
    assert.deepEqual(withoutId(await pushed), { type: 'mod.submit', sessionId: held.id, text: 'early' });
    assert.ok(Date.now() - t1 >= 140, 'the reply waited for the channel');
    // (2) Seen, no channel: typed at the deadline.
    const t2 = Date.now();
    assert.deepEqual(await cli.request('session.submit', { sessionId: late.id, text: 'x' }), { via: 'typed' });
    assert.ok(Date.now() - t2 >= 390, `typed after the wait, took ${Date.now() - t2} ms`);
    // (3) Never seen: typed at once.
    const t3 = Date.now();
    assert.deepEqual(await cli.request('session.submit', { sessionId: unseen.id, text: 'x' }), { via: 'typed' });
    assert.ok(Date.now() - t3 < 100, `typed at once, took ${Date.now() - t3} ms`);
    // (4) A channel that opened and closed: typed at once.
    channel.close();
    await once(channel, 'close');
    await new Promise((r) => setTimeout(r, 100));
    const t4 = Date.now();
    assert.deepEqual(await cli.request('session.submit', { sessionId: held.id, text: 'x' }), { via: 'typed' });
    assert.ok(Date.now() - t4 < 100, `typed at once after the channel went, took ${Date.now() - t4} ms`);
  } finally {
    for (const s of [held, late, unseen]) await cli.request('session.kill', { sessionId: s.id }).catch(() => undefined);
    cli.close();
    await own.close();
  }
});

test('session.submit answers typed when the mod says its prompt did not enter, mod when it entered or no word came in time (M9 fix 781)', async () => {
  const pipe = `${PIPE}-781`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, modSubmitAckMs: 300 });
  await own.listen();
  const cli = await PipeClient.connect(pipe);
  const { session } = await cli.request('session.spawn', { kind: 'shell', cwd: process.cwd(), cols: 80, rows: 24 });
  const channel = await PipeClient.connect(pipe);
  try {
    await channel.request('mod.channel', { sessionId: session.id });
    const answer = (drop: string | null, otherSession = false) => {
      const heard = waitFor(channel, (m) => m.type === 'mod.submit');
      void heard.then((m) => {
        const push = m as { sessionId: string; submitId: string };
        own.modSubmitAnswered(otherSession ? 'another' : push.sessionId, push.submitId, drop === null, drop);
      });
    };
    // A person's Stop stands: the engine dropped the prompt, so the caller types it.
    answer('the session was stopped and nobody has sent input since');
    let t = Date.now();
    assert.deepEqual(await cli.request('session.submit', { sessionId: session.id, text: 'after the stop' }), { via: 'typed' });
    assert.ok(Date.now() - t < 250, `answered on the word, took ${Date.now() - t} ms`);
    // Entered.
    answer(null);
    assert.deepEqual(await cli.request('session.submit', { sessionId: session.id, text: 'next' }), { via: 'mod' });
    // A word under another session's id is not this send's: no word, so mod at the bound.
    answer('x', true);
    t = Date.now();
    assert.deepEqual(await cli.request('session.submit', { sessionId: session.id, text: 'unanswered' }), { via: 'mod' });
    assert.ok(Date.now() - t >= 290, `mod after the bound, took ${Date.now() - t} ms`);
  } finally {
    channel.close();
    await cli.request('session.kill', { sessionId: session.id }).catch(() => undefined);
    cli.close();
    await own.close();
  }
});

// M9 fix 659: url says the path is a page for the browser pane; the
// daemon holds it to what browserUrl writes, refuses a scheme beside it,
// and the push carries url so the window opens a browser view.
test('file.open with url relays a page and refuses a path or a scheme (M9 fix 659)', async () => {
  const pipe = `${PIPE}-open-url`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await own.listen();
  try {
    const cli = await PipeClient.connect(pipe);
    await cli.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    const app = await PipeClient.connect(pipe);
    await app.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION });
    await app.request('subscribe', { topics: ['app'] });
    const requested = waitFor(app, (m) => m.type === 'file.open.requested');
    assert.deepEqual(await cli.request('file.open', { path: 'http://localhost:3000/', pane: true, url: true }), { apps: 1 });
    assert.deepEqual(await requested, { type: 'file.open.requested', path: 'http://localhost:3000/', pane: true, url: true });
    await assert.rejects(cli.request('file.open', { path: 'C:\\notes.md', pane: true, url: true }), { code: 'bad-request', message: 'url needs an http or https URL in path' });
    await assert.rejects(cli.request('file.open', { path: 'localhost:3000', pane: true, url: true }), { code: 'bad-request' });
    await assert.rejects(cli.request('file.open', { path: 'http://localhost:3000/', pane: true, url: true, scheme: 'Dracula' }), { code: 'bad-request', message: 'a url takes no scheme' });
    app.close();
    cli.close();
  } finally {
    await own.close();
  }
});

// M9 fix 375: a file.open with a scheme (a name, or null to clear the
// pick) carries it on the push with an openId, and the reply waits for
// the window's file.open.done so the CLI can say whether the name was
// known; a window that never answers is given the deadline and the
// reply is the count alone. The plain form is answered at once as
// before, with no openId on its push, and the name is trimmed the way
// session.set trims it.
test('file.open with a scheme holds the reply for the window\'s file.open.done (M9 fix 375)', async () => {
  const pipe = `${PIPE}-open-scheme`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, fileOpenAckMs: 300 });
  await own.listen();
  try {
    const cli = await PipeClient.connect(pipe);
    await cli.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    // No window: the count alone, at once.
    assert.deepEqual(await cli.request('file.open', { path: 'C:\\notes.md', pane: false, scheme: 'Dracula' }), { apps: 0 });

    const app = await PipeClient.connect(pipe);
    await app.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION });
    await app.request('subscribe', { topics: ['app'] });
    // The window answers: the push carries the trimmed name and an id,
    // and the reply carries the answer.
    let requested = waitFor(app, (m) => m.type === 'file.open.requested');
    const answered = cli.request('file.open', { path: 'C:\\notes.md', pane: true, scheme: ' Dracula ' });
    const push = (await requested) as { openId: number; scheme: string | null; path: string; pane: boolean };
    assert.equal(push.scheme, 'Dracula');
    assert.equal(push.path, 'C:\\notes.md');
    assert.equal(push.pane, true);
    assert.equal(typeof push.openId, 'number');
    await app.request('file.open.done', { openId: push.openId, known: false });
    assert.deepEqual(await answered, { apps: 1, known: false });
    // A clear rides as null.
    requested = waitFor(app, (m) => m.type === 'file.open.requested');
    const cleared = cli.request('file.open', { path: 'C:\\notes.md', pane: false, scheme: null });
    const clearPush = (await requested) as { openId: number; scheme: string | null };
    assert.equal(clearPush.scheme, null);
    await app.request('file.open.done', { openId: clearPush.openId, known: true });
    assert.deepEqual(await cleared, { apps: 1, known: true });
    // No answer: the deadline, and the count alone.
    const started = Date.now();
    assert.deepEqual(await cli.request('file.open', { path: 'C:\\notes.md', pane: false, scheme: 'Nope' }), { apps: 1 });
    assert.ok(Date.now() - started >= 250, 'the reply waited for the deadline');
    // An answer nobody waits for is ignored, and a bad one refused.
    await app.request('file.open.done', { openId: 999, known: true });
    await assert.rejects(app.request('file.open.done', { known: true } as never), { code: 'bad-request' });
    await assert.rejects(app.request('file.open.done', { openId: 1, known: 'yes' } as never), { code: 'bad-request' });
    // M9 fix 376: beside rides the push the same way and the answer
    // carries besideFound; a request with a beside of the wrong shape
    // is refused.
    requested = waitFor(app, (m) => m.type === 'file.open.requested');
    const besideAsk = cli.request('file.open', { path: 'C:\\a.md', pane: true, beside: 'sess-1' });
    const besidePush = (await requested) as { openId: number; beside?: string; scheme?: string | null };
    assert.equal(besidePush.beside, 'sess-1');
    assert.equal('scheme' in besidePush, false);
    await app.request('file.open.done', { openId: besidePush.openId, besideFound: false });
    assert.deepEqual(await besideAsk, { apps: 1, besideFound: false });
    await assert.rejects(cli.request('file.open', { path: 'C:\\a.md', pane: true, beside: 7 } as never), { code: 'bad-request' });
    // The plain form carries no openId.
    requested = waitFor(app, (m) => m.type === 'file.open.requested');
    assert.deepEqual(await cli.request('file.open', { path: 'C:\\a.md', pane: false }), { apps: 1 });
    assert.deepEqual(await requested, { type: 'file.open.requested', path: 'C:\\a.md', pane: false });
    app.close();
    cli.close();
  } finally {
    await own.close();
  }
});

// M9 fix 582: with every window on the app topic at level 58, a plain
// open carries an openId and waits for the window's answer like a scheme
// does, and the reply says whether it came (answered); a window older
// than the fix on the topic puts plain opens back to the at-once reply
// with no openId, and a level that is not a number is refused.
test('file.open to a window at level 58 waits on every open and says whether it answered (M9 fix 582)', async () => {
  const pipe = `${PIPE}-open-answer`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, fileOpenAckMs: 300 });
  await own.listen();
  try {
    const cli = await PipeClient.connect(pipe);
    await cli.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    const app = await PipeClient.connect(pipe);
    await app.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION, featureLevel: FILE_OPEN_ANSWER_LEVEL });
    await app.request('subscribe', { topics: ['app'] });
    // A plain open now carries an id and waits for the answer.
    let requested = waitFor(app, (m) => m.type === 'file.open.requested');
    const asked = cli.request('file.open', { path: 'C:\\notes.md', pane: false });
    const push = (await requested) as { openId?: number };
    assert.equal(typeof push.openId, 'number');
    await app.request('file.open.done', { openId: push.openId as number });
    assert.deepEqual(await asked, { apps: 1, answered: true });
    // Left unanswered: the deadline, and answered false.
    const started = Date.now();
    assert.deepEqual(await cli.request('file.open', { path: 'C:\\notes.md', pane: false }), { apps: 1, answered: false });
    assert.ok(Date.now() - started >= 250, 'the reply waited for the deadline');
    // A scheme open answered carries the answer and answered true.
    requested = waitFor(app, (m) => m.type === 'file.open.requested');
    const schemed = cli.request('file.open', { path: 'C:\\notes.md', pane: false, scheme: 'Dracula' });
    const schemePush = (await requested) as { openId: number };
    await app.request('file.open.done', { openId: schemePush.openId, known: true });
    assert.deepEqual(await schemed, { apps: 1, known: true, answered: true });
    // An older window joins the topic: plain opens are answered at once
    // again, with no openId on the push.
    const old = await PipeClient.connect(pipe);
    await old.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION });
    await old.request('subscribe', { topics: ['app'] });
    requested = waitFor(app, (m) => m.type === 'file.open.requested');
    assert.deepEqual(await cli.request('file.open', { path: 'C:\\a.md', pane: false }), { apps: 2 });
    assert.deepEqual(await requested, { type: 'file.open.requested', path: 'C:\\a.md', pane: false });
    // A level that is not a number is refused.
    const bad = await PipeClient.connect(pipe);
    await assert.rejects(bad.request('hello', { client: 'app', protocolVersion: PROTOCOL_VERSION, featureLevel: 'x' } as never), { code: 'bad-request' });
    bad.close();
    old.close();
    app.close();
    cli.close();
  } finally {
    await own.close();
  }
});

test('hooks.test asks the sink, and a server without one answers false (M9 fix 606)', async () => {
  const client = await PipeClient.connect(PIPE);
  await client.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
  assert.deepEqual(await client.request('hooks.test', { testId: 'x' }), { arrived: false });
  await assert.rejects(client.request('hooks.test', { testId: 7 } as never), { code: 'bad-request' });
  client.close();
  const pipe = `${PIPE}-606`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger, hookTestArrived: (id) => id === 'yes' });
  await own.listen();
  try {
    const asker = await PipeClient.connect(pipe);
    await asker.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    assert.deepEqual(await asker.request('hooks.test', { testId: 'yes' }), { arrived: true });
    assert.deepEqual(await asker.request('hooks.test', { testId: 'no' }), { arrived: false });
    asker.close();
  } finally {
    await own.close();
  }
});

test('spawn, attach with replay, input, exit and kill guard', async () => {
  const client = await PipeClient.connect(PIPE);
  await client.request('subscribe', { topics: ['sessions'] });

  const spawned = waitFor(client, (m) => m.type === 'session.changed' && m.session.state === 'idle');
  const { session } = await client.request('session.spawn', { kind: 'shell', cwd: process.cwd(), cols: 100, rows: 30 });
  assert.equal(session.kind, 'shell');
  assert.equal((await spawned as { session: { id: string } }).session.id, session.id, 'subscribers hear about the spawn');
  assert.equal(session.state, 'idle');
  assert.ok(session.pid !== null && session.pid > 0);

  // Let the shell print its prompt before attaching so the replay has something in it.
  await new Promise((r) => setTimeout(r, 1500));

  const received: ServerMessage[] = [];
  client.on('message', (m: ServerMessage) => received.push(m));
  await client.request('pty.attach', { sessionId: session.id });
  const replay = received.find((m) => m.type === 'pty.output');
  assert.ok(replay !== undefined && replay.type === 'pty.output', 'replay arrived before the attach reply');
  assert.equal(replay.replay, true);
  assert.ok(Buffer.from(replay.data, 'base64').length > 0, 'replay carries the prompt bytes');

  const marker = `EMERALD_SMOKE_${Date.now()}`;
  const seen = waitFor(client, (m) =>
    m.type === 'pty.output' && m.replay !== true && Buffer.from(m.data, 'base64').toString().includes(`OUT:${marker}`));
  client.send({ type: 'pty.input', sessionId: session.id, data: `Write-Output ('OUT:' + '${marker}')\r` });
  client.send({ type: 'pty.resize', sessionId: session.id, cols: 120, rows: 40 });
  await seen;

  // Killing ends the PTY; the attached client sees pty.exit and subscribers see session.changed.
  const exitMsg = waitFor(client, (m) => m.type === 'pty.exit' && m.sessionId === session.id);
  const changed = waitFor(client, (m) => m.type === 'session.changed' && m.session.id === session.id && m.session.state === 'exited');
  await client.request('session.kill', { sessionId: session.id });
  await Promise.all([exitMsg, changed]);

  // The M0 gotcha, over the wire: a second kill on an exited session is harmless.
  await client.request('session.kill', { sessionId: session.id });
  const list = await client.request('session.list', {});
  assert.equal(list.sessions.find((s) => s.id === session.id)?.state, 'exited');

  // Attaching to an exited session still replays and reports the exit.
  const late = await PipeClient.connect(PIPE);
  const lateMsgs: ServerMessage[] = [];
  late.on('message', (m: ServerMessage) => lateMsgs.push(m));
  await late.request('pty.attach', { sessionId: session.id });
  assert.deepEqual(lateMsgs.map((m) => m.type), ['pty.output', 'pty.exit']);

  const read = await client.request('session.read', { sessionId: session.id, maxBytes: 8 });
  assert.equal(Buffer.from(read.data, 'base64').length, 8);

  late.close();
  client.close();
});

test('one connection\'s second pty.attach replays the ring again and its one pty.detach ends the stream (what the app\'s attach broker counts on, M9 fix 866)', async () => {
  const client = await PipeClient.connect(PIPE);
  const { session } = await client.request('session.spawn', { kind: 'shell', cwd: process.cwd(), cols: 100, rows: 30 });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const received: ServerMessage[] = [];
    const onMsg = (m: ServerMessage) => received.push(m);
    client.on('message', onMsg);
    const replays = () => received.filter((m) => m.type === 'pty.output' && m.sessionId === session.id && m.replay === true).length;
    await client.request('pty.attach', { sessionId: session.id });
    assert.equal(replays(), 1, 'the first attach replays');
    // A second window of the same main process attaches on the same
    // connection: the daemon starts the stream over and replays again.
    await client.request('pty.attach', { sessionId: session.id });
    assert.equal(replays(), 2, 'the second attach on one connection replays the ring again');

    const marker = `ATTACH866_${Date.now()}`;
    const seen = waitFor(client, (m) => m.type === 'pty.output' && m.replay !== true && Buffer.from(m.data, 'base64').toString().includes(`OUT:${marker}`));
    client.send({ type: 'pty.input', sessionId: session.id, data: `Write-Output ('OUT:' + '${marker}')\r` });
    await seen;

    // One detach drops the connection's only sink, whoever else was watching.
    await client.request('pty.detach', { sessionId: session.id });
    const after = `DETACH866_${Date.now()}`;
    const from = received.length;
    client.send({ type: 'pty.input', sessionId: session.id, data: `Write-Output ('OUT:' + '${after}')\r` });
    await new Promise((r) => setTimeout(r, 1000));
    const heard = received.slice(from).some((m) => m.type === 'pty.output' && Buffer.from(m.data, 'base64').toString().includes(`OUT:${after}`));
    assert.equal(heard, false, 'after the one detach the connection hears no more output');
    client.off('message', onMsg);
  } finally {
    await client.request('session.kill', { sessionId: session.id }).catch(() => {});
    client.close();
  }
});

// M9 fix 454: the daemon claims the pipe before its start and the server
// takes it over after, so a client that connected in between is held and
// then served, in order, and one that gave up meanwhile is skipped.
test('attach serves a client held since the claim, then new ones', async () => {
  const pipe = `${PIPE}-claim`;
  const claimed = await claimPipe(pipe);
  const early = await PipeClient.connect(pipe);
  const quitter = await PipeClient.connect(pipe);
  let answered = false;
  const hello = early.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION }).then((res) => {
    answered = true;
    return res;
  });
  quitter.close();
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(answered, false, 'no answer while the start runs');
  assert.equal(claimed.held.length, 1, 'the client that gave up is no longer held');
  const attached = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'attached', log: silentLogger });
  attached.attach(claimed);
  try {
    assert.equal((await hello).daemonVersion, 'attached');
    const late = await PipeClient.connect(pipe);
    assert.equal((await late.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION })).daemonVersion, 'attached');
    late.close();
    await assert.rejects(claimPipe(pipe), { code: 'EADDRINUSE' });
  } finally {
    early.close();
    await attached.close();
  }
});

// M9 fix 553: the server builds no net.Server of its own, so one that was
// never listened or attached closes at once, and one that attached a
// claimed pipe releases it on close.
test('a server that only attached closes cleanly (M9 fix 553)', async () => {
  const idle = new PipeServer(manager, layouts, { pipePath: `${PIPE}-closed`, daemonVersion: 'idle', log: silentLogger });
  await idle.close();
  const pipe = `${PIPE}-attached`;
  const attached = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'attached', log: silentLogger });
  attached.attach(await claimPipe(pipe));
  await attached.close();
  const again = await claimPipe(pipe);
  await new Promise<void>((resolve) => again.server.close(() => resolve()));
});

// A logger that keeps its warnings, for the tests that read them.
function warnings(): { log: { info(): void; warn(msg: string): void; error(): void }; lines: string[] } {
  const lines: string[] = [];
  return { log: { info() {}, warn: (msg: string) => lines.push(msg), error() {} }, lines };
}

// M9 fix 497: a client that stops reading grew the daemon's heap for as
// long as it stayed connected, since only a pty's output paused on the
// high-water mark; past the drop mark the connection is destroyed, said
// once, and a client that reads is untouched.
test('a client that stops reading is dropped past the unread mark (M9 fix 497)', async () => {
  const pipe = `${PIPE}-drop`;
  const { log, lines } = warnings();
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log, dropUnreadBytes: 256 * 1024 });
  await own.listen();
  try {
    const stalled = net.createConnection(pipe);
    await once(stalled, 'connect');
    stalled.on('error', () => {});
    stalled.write(JSON.stringify({ id: 1, type: 'hello', client: 'cli', protocolVersion: PROTOCOL_VERSION }) + '\n');
    stalled.pause();
    // Each reply is about sixty bytes; 20,000 of them are over a megabyte,
    // well past the mark and past what the pipe itself buffers.
    let batch = '';
    for (let id = 2; id < 20_002; id++) batch += JSON.stringify({ id, type: 'session.list' }) + '\n';
    stalled.write(batch);
    // The server may meet the connection a tick after the client does.
    const seen = Date.now() + 2000;
    while (own.clientCount === 0 && lines.length === 0 && Date.now() < seen) await new Promise((r) => setTimeout(r, 10));
    const deadline = Date.now() + 5000;
    while (own.clientCount > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    assert.equal(own.clientCount, 0, `the stalled client is dropped within 5 s: ${JSON.stringify(lines)}`);
    const drops = lines.filter((l) => /^dropping client \d+: \d+ MB unread$/.test(l));
    assert.equal(drops.length, 1, JSON.stringify(lines));
    stalled.destroy();

    const reader = await PipeClient.connect(pipe);
    await reader.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    assert.ok(Array.isArray((await reader.request('session.list', {})).sessions), 'a reading client is answered');
    reader.close();
  } finally {
    await own.close();
  }
});

// M9 fix 499: keystrokes into a session the daemon no longer holds were
// one warning, a sync disk write, each; now once a minute per session.
test('a removed session warns once a minute, not per keystroke (M9 fix 499)', async () => {
  const pipe = `${PIPE}-warn`;
  const { log, lines } = warnings();
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log });
  await own.listen();
  try {
    const client = await PipeClient.connect(pipe);
    await client.request('hello', { client: 'cli', protocolVersion: PROTOCOL_VERSION });
    for (let i = 0; i < 5; i++) client.send({ type: 'pty.input', sessionId: 'gone', data: 'x' });
    // A request after them, answered in order, so the five have been read.
    await client.request('session.list', {});
    assert.equal(lines.filter((l) => l === 'pty.input failed').length, 1, JSON.stringify(lines));
    client.close();
  } finally {
    await own.close();
  }
});

// M9 fix 612: the pipe token. A server with one refuses a hello without
// it or with another, and anything but a hello before a good one, each
// with one error reply when the message has an id and then the close; a
// hello with the token is answered, and so is what follows it.
test('a server with a token refuses a hello without it and anything before it (M9 fix 612)', async () => {
  const pipe = `${PIPE}-token`;
  const token = 'a'.repeat(64);
  const warned: string[] = [];
  const log = { info() {}, warn: (msg: string) => warned.push(msg), error() {} };
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log, token });
  await own.listen();
  // Sends lines on a bare socket and answers every line the server wrote
  // back once it has closed the pipe, or the first reply when it does not.
  const exchange = (lines: object[], waitClose: boolean): Promise<{ replies: Array<{ id?: number; ok: boolean; error?: { code: string; message: string } }>; closed: boolean }> =>
    new Promise((resolve, reject) => {
      const socket = net.connect(pipe);
      let buffer = '';
      const replies: Array<{ id?: number; ok: boolean; error?: { code: string; message: string } }> = [];
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ replies, closed: false });
      }, 3000);
      socket.setEncoding('utf8');
      socket.on('data', (text: string) => {
        buffer += text;
        for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
          replies.push(JSON.parse(buffer.slice(0, nl)));
          buffer = buffer.slice(nl + 1);
        }
        if (!waitClose && replies.length >= lines.filter((l) => 'id' in l).length) {
          clearTimeout(timer);
          socket.destroy();
          resolve({ replies, closed: false });
        }
      });
      socket.on('error', reject);
      socket.on('close', () => {
        clearTimeout(timer);
        resolve({ replies, closed: true });
      });
      socket.on('connect', () => socket.write(lines.map((l) => JSON.stringify(l) + '\n').join('')));
    });
  try {
    const none = await exchange([{ id: 1, type: 'hello', client: 'cli', protocolVersion: PROTOCOL_VERSION }], true);
    assert.deepEqual(none.replies, [
      { type: 'reply', id: 1, ok: false, error: { code: 'token-required', message: 'hello without a token: this client predates the pipe token of M9 fix 612; use the emmer and the Emerald window of the same install as this emmerd' } },
    ]);
    assert.equal(none.closed, true, 'closed after a hello without the token');
    const wrong = await exchange([{ id: 1, type: 'hello', client: 'cli', protocolVersion: PROTOCOL_VERSION, token: 'b'.repeat(64) }], true);
    assert.equal(wrong.replies.length, 1);
    assert.deepEqual(wrong.replies[0]!.error, { code: 'bad-token', message: "hello token does not match this emmerd's (M9 fix 612): the client read another daemon.json, from another home or an older daemon" });
    assert.equal(wrong.closed, true, 'closed after a wrong token');
    // The request after the refused hello in the same write is not served.
    const first = await exchange([{ id: 1, type: 'session.list' }, { id: 2, type: 'hello', client: 'cli', protocolVersion: PROTOCOL_VERSION, token }], true);
    assert.equal(first.replies.length, 1, JSON.stringify(first.replies));
    assert.deepEqual(first.replies[0]!.error, { code: 'hello-first', message: 'say hello with the token from daemon.json first (M9 fix 612)' });
    assert.equal(first.closed, true, 'closed after a request before hello');
    const input = await exchange([{ type: 'pty.input', sessionId: 'nope', data: 'x' }], true);
    assert.deepEqual(input.replies, [], 'pty.input before hello gets no reply');
    assert.equal(input.closed, true, 'closed after pty.input before hello');
    const good = await exchange([{ id: 1, type: 'hello', client: 'cli', protocolVersion: PROTOCOL_VERSION, token }, { id: 2, type: 'session.list' }], false);
    assert.equal(good.replies.length, 2, JSON.stringify(good.replies));
    assert.ok(good.replies.every((r) => r.ok), JSON.stringify(good.replies));
    assert.equal(good.closed, false);
    assert.deepEqual(warned, ['hello refused: no token', 'hello refused: wrong token', 'dropping client: session.list before hello', 'dropping client: pty.input before hello']);
  } finally {
    await own.close();
  }
});

test('a load tick goes to a level 64 window as one sessions.load, to an older window as records, and to a CLI not at all (M9 fix 703)', async () => {
  const pipe = `${PIPE}-load`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await own.listen();
  const clients: PipeClient[] = [];
  try {
    const join = async (hello: Record<string, unknown>) => {
      const c = await PipeClient.connect(pipe);
      clients.push(c);
      await c.request('hello', { protocolVersion: PROTOCOL_VERSION, ...hello } as never);
      await c.request('subscribe', { topics: ['sessions'] });
      const heard: ServerMessage[] = [];
      c.on('message', (m: ServerMessage) => heard.push(m));
      return { c, heard };
    };
    const fresh = await join({ client: 'app', featureLevel: LOAD_PUSH_LEVEL });
    const older = await join({ client: 'app', featureLevel: 63 });
    const cli = await join({ client: 'cli' });
    const samples = [
      { sessionId: 'load-a', sample: { at: 5000, cpu: 3, rss: 30 }, names: ['node'] },
      { sessionId: 'load-b', sample: { at: 5000, cpu: 4, rss: 40 }, names: [] },
    ];
    const sessions = [{ id: 'load-a', name: 'a' }, { id: 'load-b', name: 'b' }] as unknown as SessionInfo[];
    const tick: LoadTick = { at: 5001, samples, sessions };
    const freshHeard = waitFor(fresh.c, (m) => m.type === 'sessions.load');
    const olderHeard = waitFor(older.c, (m) => m.type === 'session.changed' && m.session.id === 'load-b');
    manager.emit('load', tick);
    await Promise.all([freshHeard, olderHeard]);
    // A moment for anything else in flight to land before the counts.
    await new Promise((r) => setTimeout(r, 200));
    const ours = (heard: ServerMessage[]) => heard.filter((m) => m.type === 'sessions.load' || (m.type === 'session.changed' && m.session.id.startsWith('load-')));
    assert.deepEqual(ours(fresh.heard), [{ type: 'sessions.load', at: 5001, samples }]);
    assert.deepEqual(
      ours(older.heard).map((m) => (m.type === 'session.changed' ? m.session.id : m.type)),
      ['load-a', 'load-b'],
    );
    assert.deepEqual(ours(cli.heard), []);
  } finally {
    for (const c of clients) c.close();
    await own.close();
  }
});

test('a mod measure\'s rate limits go to a level 65 window subscribed to app, and not to one at 64 (M9 fix 739)', async () => {
  const pipe = `${PIPE}-limits`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await own.listen();
  const clients: PipeClient[] = [];
  try {
    const join = async (hello: Record<string, unknown>) => {
      const c = await PipeClient.connect(pipe);
      clients.push(c);
      await c.request('hello', { protocolVersion: PROTOCOL_VERSION, ...hello } as never);
      await c.request('subscribe', { topics: ['app'] });
      const heard: ServerMessage[] = [];
      c.on('message', (m: ServerMessage) => heard.push(m));
      return { c, heard };
    };
    const fresh = await join({ client: 'app', featureLevel: LIMITS_PUSH_LEVEL });
    const older = await join({ client: 'app', featureLevel: 64 });
    const limits = [{ kind: 'five_hour', percentUsed: 37, resetsAt: '2026-10-15T23:20:00.000Z' }];
    const freshHeard = waitFor(fresh.c, (m) => m.type === 'usage.limits');
    manager.emit('limits', { at: 7001, limits });
    await freshHeard;
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(fresh.heard.filter((m) => m.type === 'usage.limits'), [{ type: 'usage.limits', at: 7001, limits }]);
    assert.deepEqual(older.heard.filter((m) => m.type === 'usage.limits'), []);
  } finally {
    for (const c of clients) c.close();
    await own.close();
  }
});

test('a row the mod kept goes to a level 66 window subscribed to sessions as transcript.row, and not to one at 65 (M9 fix 769)', async () => {
  const pipe = `${PIPE}-rows`;
  const own = new PipeServer(manager, layouts, { pipePath: pipe, daemonVersion: 'test', log: silentLogger });
  await own.listen();
  const clients: PipeClient[] = [];
  try {
    const join = async (hello: Record<string, unknown>) => {
      const c = await PipeClient.connect(pipe);
      clients.push(c);
      await c.request('hello', { protocolVersion: PROTOCOL_VERSION, ...hello } as never);
      await c.request('subscribe', { topics: ['sessions'] });
      const heard: ServerMessage[] = [];
      c.on('message', (m: ServerMessage) => heard.push(m));
      return { c, heard };
    };
    const fresh = await join({ client: 'app', featureLevel: ROW_PUSH_LEVEL });
    const older = await join({ client: 'app', featureLevel: 65 });
    const row = { type: 'assistant' as const, role: 'assistant' as const, content: [{ type: 'text', text: 'From the mod.' }] };
    const freshHeard = waitFor(fresh.c, (m) => m.type === 'transcript.row');
    manager.emit('row', { sessionId: 's-769', at: 7002, uuid: 'u-769', row, cut: false });
    await freshHeard;
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(fresh.heard.filter((m) => m.type === 'transcript.row'), [{ type: 'transcript.row', sessionId: 's-769', at: 7002, uuid: 'u-769', row }]);
    assert.deepEqual(older.heard.filter((m) => m.type === 'transcript.row'), []);
  } finally {
    for (const c of clients) c.close();
    await own.close();
  }
});
