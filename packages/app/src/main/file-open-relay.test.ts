import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { openExtraOf, reloadHolding, wireFileOpenRelay } from './file-open-relay.ts';
import type { OpenRequest } from './file-open-relay.ts';

function setup(windowUp = true) {
  const client = new EventEmitter();
  const delivered: OpenRequest[] = [];
  let lifts = 0;
  const log: string[] = [];
  const relay = wireFileOpenRelay(client, { deliver: (req) => (windowUp ? (delivered.push(req), true) : false), lift: () => lifts++ }, (m) => log.push(m));
  return { client, delivered, relay, log, lifts: () => lifts };
}

test('a file.open.requested push reaches the renderer once it is listening, and lifts the window (M9 fix 341)', () => {
  const { client, delivered, relay, lifts } = setup();
  relay.ready();
  client.emit('message', { type: 'file.open.requested', path: 'C:\\notes.md', pane: false });
  client.emit('message', { type: 'file.open.requested', path: 'C:\\a.json', pane: true });
  client.emit('message', { type: 'session.removed' });
  client.emit('message', { type: 'file.open.requested' });
  // M9 fix 375: a scheme (a name, or null for a clear) and the openId
  // the renderer answers with ride along; a push without them delivers
  // neither, and one of the wrong shape is dropped.
  client.emit('message', { type: 'file.open.requested', path: 'C:\\b.md', pane: false, scheme: 'Dracula', openId: 7 });
  client.emit('message', { type: 'file.open.requested', path: 'C:\\c.md', pane: true, scheme: null, openId: 8 });
  client.emit('message', { type: 'file.open.requested', path: 'C:\\d.md', pane: false, scheme: 3, openId: '9' });
  // M9 fix 376: beside, a session id, rides the same way.
  client.emit('message', { type: 'file.open.requested', path: 'C:\\e.md', pane: true, openId: 10, beside: 'sess-1' });
  assert.deepEqual(delivered, [
    { path: 'C:\\notes.md', pane: false },
    { path: 'C:\\a.json', pane: true },
    { path: 'C:\\b.md', pane: false, scheme: 'Dracula', openId: 7 },
    { path: 'C:\\c.md', pane: true, scheme: null, openId: 8 },
    { path: 'C:\\d.md', pane: false },
    { path: 'C:\\e.md', pane: true, openId: 10, beside: 'sess-1' },
  ]);
  assert.equal(lifts(), 6);
});

// A launch with a file (M9 fix 342) hands the path over before the
// renderer has loaded; it is held and opened at the renderer's ready, in
// order, and nothing is lifted until then.
test('a path before the renderer is listening is held for its ready', () => {
  const { delivered, relay, lifts, log } = setup();
  relay.open({ path: 'C:\\first.md', pane: false });
  relay.open({ path: 'C:\\second.md', pane: false });
  assert.deepEqual(delivered, [] as OpenRequest[]);
  assert.equal(lifts(), 0);
  assert.ok(log.some((l) => l.includes('held until the window is listening')));
  relay.ready();
  assert.deepEqual(delivered.map((r) => r.path), ['C:\\first.md', 'C:\\second.md']);
  assert.equal(lifts(), 2);
  // A later ready (a reload) has nothing left to send.
  relay.ready();
  assert.equal(delivered.length, 2);
});

// M9 fix 527: a reload (did-navigate) or a crashed page puts the relay
// back to holding, and the new page's ready delivers what came between.
test('an open while the page reloads is held and delivered at the next ready', () => {
  const { delivered, relay, lifts, log } = setup();
  relay.ready();
  relay.open({ path: 'C:\\before.md', pane: false });
  assert.deepEqual(delivered.map((r) => r.path), ['C:\\before.md']);
  assert.equal(lifts(), 1);
  relay.loading();
  relay.open({ path: 'C:\\during.md', pane: false });
  assert.equal(delivered.length, 1);
  assert.equal(lifts(), 1);
  assert.ok(log.some((l) => l === 'open: C:\\during.md held until the window is listening'));
  relay.ready();
  assert.deepEqual(delivered.map((r) => r.path), ['C:\\before.md', 'C:\\during.md']);
  assert.equal(lifts(), 2);
});

test('a request with no window to send to is held too', () => {
  const { delivered, relay } = setup(false);
  relay.ready();
  relay.open({ path: 'C:\\notes.md', pane: false });
  assert.deepEqual(delivered, []);
});

// M9 fix 549: the View menu's reload puts the relay to holding before it
// reloads, so an open that lands while the old page unloads (here, from
// inside reload() itself) waits for the new page's ready.
test('reloadHolding holds an open that lands during the reload until the new page is ready', () => {
  const { delivered, relay, log } = setup();
  relay.ready();
  const calls: string[] = [];
  const contents = {
    reload: () => {
      calls.push('reload');
      relay.open({ path: 'C:\\x\\a.txt', pane: false });
    },
    reloadIgnoringCache: () => calls.push('reloadIgnoringCache'),
  };
  reloadHolding(contents, relay, false);
  assert.deepEqual(calls, ['reload']);
  assert.deepEqual(delivered, [] as OpenRequest[]);
  assert.ok(log.some((l) => l === 'open: C:\\x\\a.txt held until the window is listening'));
  relay.ready();
  assert.deepEqual(delivered.map((r) => r.path), ['C:\\x\\a.txt']);
});

test('reloadHolding with ignoreCache reloads ignoring the cache', () => {
  const { relay } = setup();
  const calls: string[] = [];
  reloadHolding({ reload: () => calls.push('reload'), reloadIgnoringCache: () => calls.push('reloadIgnoringCache') }, relay, true);
  assert.deepEqual(calls, ['reloadIgnoringCache']);
});

// M9 fix 700: launch marks a file from a launch; the daemon's push never
// carries it, even when a message says so.
test('launch rides openExtraOf for a launch and never for a push (M9 fix 700)', () => {
  const { client, delivered, relay } = setup();
  relay.ready();
  client.emit('message', { type: 'file.open.requested', path: 'C:\\x.md', pane: false, launch: true });
  assert.equal('launch' in delivered[0]!, false);
  assert.equal(openExtraOf(delivered[0]!).launch, undefined);
  assert.equal(openExtraOf({ path: 'C:/x.md', pane: false, launch: true }).launch, true);
});

// M9 fix 659: url, a page for the browser pane, rides as true alone; a
// push without it carries no url key.
test('a page from emmer open rides the relay with url set (M9 fix 659)', () => {
  const { client, delivered, relay } = setup();
  relay.ready();
  client.emit('message', { type: 'file.open.requested', path: 'http://localhost:3000/', pane: true, url: true });
  client.emit('message', { type: 'file.open.requested', path: 'C:\\notes.md', pane: false });
  client.emit('message', { type: 'file.open.requested', path: 'http://x.com/', pane: true, url: 'yes' });
  assert.deepEqual(delivered, [
    { path: 'http://localhost:3000/', pane: true, url: true },
    { path: 'C:\\notes.md', pane: false },
    { path: 'http://x.com/', pane: true },
  ]);
  assert.equal('url' in delivered[1]!, false);
});
