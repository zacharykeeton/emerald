import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { PROTOCOL_VERSION } from '@emerald/shared';
import type { Layout, ServerMessage } from '@emerald/shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { currentTab, replaceTab, splitPane } from '@emerald/shared';
import { PipeClient } from '@emerald/shared/pipe-client';
import { LayoutStore } from './layout-store.ts';
import { silentLogger } from './log.ts';
import { FILE_OPEN_ANSWER_LEVEL, PipeServer, claimPipe } from './pipe-server.ts';
import { SessionManager } from './session-manager.ts';

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

    await assert.rejects(cli.request('browser.run', { ...ask, verb: 'frob' } as never), { code: 'bad-request', message: 'verb must be one of snapshot, click, hover, fill, key, eval, screenshot, wait, navigate, upload, events, resume' });
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
