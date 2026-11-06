import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout, findPane, replaceTab, setPaneSession } from '@emerald/shared';
import type { Layout, SessionInfo, SingleTree } from '@emerald/shared';
import { getRates, resetRates, runningShellsHeld, subscribeRates } from './rates-store.ts';
import { dismissCrash, editAllLayout, editLayout, endSessionColorPreview, getState, holdSessionColorPreview, initialDaemon, onPush, pickHeld, subscribe, whenSynced } from './store.ts';
import { aSession } from './test-support.ts';
import { effectiveState } from './hosts-model.ts';

// M9 fix 354: the output rate leaves the main store for one of its own,
// so a pty.rate push reaches the rates store's listeners and not the
// window's; and a reader that names its fields keeps the same pick
// while those fields hold, whatever else a push moves.

function session(id: string, kind: 'shell' | 'claude' = 'shell'): SessionInfo {
  return aSession({ id, kind, name: id });
}

const push = (msg: unknown) => onPush(msg as Parameters<typeof onPush>[0]);

test('a pty.rate push notifies the rates store and not the main store', () => {
  resetRates();
  let main = 0;
  let rates = 0;
  const offMain = subscribe(() => (main += 1));
  const offRates = subscribeRates(() => (rates += 1));
  push({ type: 'session.changed', session: session('r') });
  assert.equal(main, 1);
  assert.equal(rates, 0);
  push({ type: 'pty.rate', sessionId: 'r', samples: [0, 10, 20] });
  assert.equal(main, 1, 'the window did not hear the rate');
  assert.equal(rates, 1);
  assert.deepEqual(getRates().get('r'), [0, 10, 20]);
  assert.equal('rates' in getState(), false, 'the rates are not on State any more');
  // A removed session takes its samples with it, through the rates store.
  push({ type: 'session.removed', sessionId: 'r' });
  assert.equal(getRates().has('r'), false);
  assert.equal(rates, 2);
  offMain();
  offRates();
});

test('a keyed pick keeps its identity while its fields hold and moves when one does', () => {
  push({ type: 'session.changed', session: session('k') });
  const s1 = getState();
  const first = pickHeld(null, s1, ['sessions', 'layout']);
  assert.deepEqual(Object.keys(first), ['sessions', 'layout']);
  assert.equal(first.sessions, s1.sessions);
  // A push on another field: the same pick object comes back.
  push({ type: 'folders.changed', folders: [{ folder: 'C:\\repo', label: 'here' }] });
  const s2 = getState();
  assert.notEqual(s2.folders, s1.folders);
  assert.equal(pickHeld(first, s2, ['sessions', 'layout']), first);
  // A push on a named field: a new pick with the new field.
  push({ type: 'session.changed', session: session('k2') });
  const s3 = getState();
  const second = pickHeld(first, s3, ['sessions', 'layout']);
  assert.notEqual(second, first);
  assert.equal(second.sessions, s3.sessions);
  assert.equal(second.layout, first.layout);
});

test('the running shells Set holds while its members are the same', () => {
  const sessions = new Map([
    ['a', session('a')],
    ['b', session('b')],
    ['c', session('c', 'claude')],
  ]);
  const quiet = new Map<string, number[]>([['a', [0, 0]]]);
  const held = runningShellsHeld(new Set(), quiet, sessions);
  assert.deepEqual([...held], []);
  const busy = new Map<string, number[]>([
    ['a', [0, 40]],
    ['b', [0, 0]],
  ]);
  const running = runningShellsHeld(held, busy, sessions);
  assert.notEqual(running, held);
  assert.deepEqual([...running], ['a']);
  // Another window of output from the same shell: the same Set.
  const stillBusy = new Map<string, number[]>([
    ['a', [40, 90]],
    ['b', [0, 0]],
  ]);
  assert.equal(runningShellsHeld(running, stillBusy, sessions), running);
  // A second shell starts: a new Set.
  const both = new Map<string, number[]>([
    ['a', [40, 90]],
    ['b', [0, 5]],
  ]);
  const two = runningShellsHeld(running, both, sessions);
  assert.notEqual(two, running);
  assert.deepEqual([...two].sort(), ['a', 'b']);
});

test('a sessions.load push appends to the rings in one notify (M9 fix 703)', () => {
  push({ type: 'session.changed', session: { ...session('l1'), load: [{ at: 1, cpu: 1, rss: 1 }], loadNames: ['old'] } });
  push({ type: 'session.changed', session: session('l2') });
  let main = 0;
  const off = subscribe(() => (main += 1));
  const tick = {
    type: 'sessions.load',
    at: 9,
    samples: [
      { sessionId: 'l1', sample: { at: 2, cpu: 5, rss: 50 }, names: ['node', 'git'] },
      { sessionId: 'l2', sample: { at: 2, cpu: 6, rss: 60 }, names: [] },
      { sessionId: 'nobody', sample: { at: 2, cpu: 7, rss: 70 }, names: [] },
    ],
  };
  push(tick);
  assert.equal(main, 1, 'one notify for the tick');
  const l1 = getState().sessions.get('l1')!;
  assert.equal(l1.load!.length, 2);
  assert.deepEqual(l1.loadNames, ['node', 'git']);
  assert.equal(getState().sessions.get('l2')!.load!.length, 1);
  assert.equal(getState().sessions.has('nobody'), false);
  // The same tick again (a list reply overtook the push): nothing lands.
  push(tick);
  assert.equal(main, 1, 'no notify for a tick the rings hold');
  assert.equal(getState().sessions.get('l1')!.load!.length, 2);
  assert.equal(getState().sessions.get('l2')!.load!.length, 1);
  // A held colour preview waits for its record push, not a load tick.
  holdSessionColorPreview('l1', '#333333');
  push({ type: 'sessions.load', at: 10, samples: [{ sessionId: 'l1', sample: { at: 3, cpu: 1, rss: 1 }, names: [] }] });
  assert.notEqual(getState().preview, null);
  endSessionColorPreview('l1', true);
  off();
});

// M9 fix 815: the crash is kept across the disconnect and the next hello,
// and only Not now puts it away.
test('a daemon.crashed push is kept across a reconnect until dismissCrash', () => {
  // Not now tells the main process (M9 fix 832); no request, so the
  // hello's sync fails at once as it did before the stub.
  (globalThis as { window?: unknown }).window = { emerald: { dismissCrash: () => undefined } };
  const crash = { pid: 17500, code: 'C0000374' };
  push({ type: 'daemon.crashed', crash });
  assert.deepEqual(getState().crashed, crash);
  push({ type: 'daemon.disconnected' });
  assert.deepEqual(getState().crashed, crash, 'the disconnect leaves it');
  push({ type: 'daemon.connected', daemon: { pid: 17600, version: '0.1.797', featureLevel: 66, otherHome: null } });
  assert.deepEqual(getState().crashed, crash, 'the new hello leaves it');
  dismissCrash();
  assert.equal(getState().crashed, null);
});

// M9 fix 832: the main process holds the crash, so the sync after a
// reload reads it back, and Not now tells the main process to forget it.
function stubCrashWindow(held: { pid: number; code: string } | null): { dismissed: () => number } {
  let dismissed = 0;
  const request = async (type: string) => {
    if (type === 'layout.get') return { layout: { tabs: [{ id: 't1', name: 'Panes', root: { kind: 'pane', id: 'p1', sessionId: null } }], currentTabId: 't1', revision: 1 } };
    if (type === 'session.list') return { sessions: [] };
    return {};
  };
  (globalThis as { window?: unknown }).window = {
    emerald: {
      request,
      daemonInfo: async () => ({ pid: 17600, version: '0.1.825', featureLevel: 1, otherHome: null }),
      daemonCrash: async () => held,
      // M9 fix 867: the sync asks which window the page shows.
      windowId: async () => 'first',
      dismissCrash: () => (dismissed += 1),
    },
  };
  return { dismissed: () => dismissed };
}
const turns = async (n: number) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

test('a crash the main process holds is read at the sync after a reload, and Not now tells it (M9 fix 832)', async () => {
  const crash = { pid: 17500, code: 'C0000374' };
  const win = stubCrashWindow(crash);
  dismissCrash();
  assert.equal(getState().crashed, null);
  push({ type: 'daemon.connected', daemon: { pid: 17600, version: '0.1.825', featureLevel: 1, otherHome: null } });
  await turns(2);
  assert.deepEqual(getState().crashed, crash, 'the sync read the held crash');
  const before = win.dismissed();
  dismissCrash();
  assert.equal(getState().crashed, null);
  assert.equal(win.dismissed() - before, 1, 'Not now told the main process');
});

test('a crash push that lands while the sync\'s reads are out is kept (M9 fix 832)', async () => {
  stubCrashWindow(null);
  dismissCrash();
  const crash = { pid: 17501, code: 'C0000005' };
  push({ type: 'daemon.connected', daemon: { pid: 17600, version: '0.1.825', featureLevel: 1, otherHome: null } });
  push({ type: 'daemon.crashed', crash });
  await turns(2);
  assert.deepEqual(getState().crashed, crash);
});

test('whenSynced waits for the daemon and the layout, and gives up after its time (M9 fix 853)', async () => {
  // No window: fix 832's stub above answers the resync a connected push
  // starts, which then lands after the disconnected push and puts the
  // daemon back, so the give-up below would never come.
  delete (globalThis as { window?: unknown }).window;
  push({ type: 'layout.changed', layout: defaultLayout() });
  push({ type: 'daemon.disconnected' });
  let done = false;
  const waiting = whenSynced(1000).then(() => {
    done = true;
  });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(done, false, 'still waiting with no daemon');
  push({ type: 'daemon.connected', daemon: { pid: 17600, version: '0.1.825', featureLevel: 67, otherHome: null } });
  await waiting;
  assert.equal(done, true);
  push({ type: 'daemon.disconnected' });
  await assert.rejects(whenSynced(30), /the daemon did not come up/);
});

// A daemon holding the layout at a revision, refusing a set on any other
// as layout-store.ts does, or with `refuse` set refusing the next set
// with that error and moving its revision by `moveBy` first.
function stubLayoutDaemon(start: Layout): { sets: () => number; at: (layout: Layout) => void; refuse: (err: Error, moveBy: number) => void } {
  let held = start;
  let sets = 0;
  let refusal: { err: Error; moveBy: number } | null = null;
  const request = async (type: string, body: { layout?: Layout }) => {
    if (type === 'layout.get') return { layout: held };
    if (type === 'layout.set') {
      sets += 1;
      const sent = body.layout!;
      if (refusal !== null) {
        const { err, moveBy } = refusal;
        refusal = null;
        held = { ...held, revision: held.revision + moveBy };
        throw err;
      }
      if (sent.revision !== held.revision) {
        throw Object.assign(new Error(`layout edit was based on revision ${sent.revision} but the current revision is ${held.revision}`), { code: 'stale-revision' });
      }
      held = { ...sent, revision: held.revision + 1 };
      return { layout: held };
    }
    return {};
  };
  (globalThis as { window?: unknown }).window = { emerald: { request } };
  return {
    sets: () => sets,
    at: (layout) => (held = layout),
    refuse: (err, moveBy) => (refusal = { err, moveBy }),
  };
}

test('a layout edit that loses a race is read again and applied once more, and one refused otherwise is thrown (M9 fix 947)', async () => {
  const start = { ...defaultLayout(), revision: 5 };
  push({ type: 'layout.changed', layout: start });
  // The daemon has taken a write the window has not heard of.
  const daemon = stubLayoutDaemon({ ...start, revision: 6 });
  const rename = (l: Layout): Layout => ({ ...l, tabs: l.tabs.map((t) => ({ ...t, name: 'renamed 947' })) });
  const renamed = await editAllLayout(rename);
  assert.ok(renamed.tabs.every((t) => t.name === 'renamed 947'));
  assert.equal(daemon.sets(), 2, 'a set at 5 refused, then one at 6');

  const before = daemon.sets();
  const now = getState().allLayout!;
  daemon.at(now);
  daemon.refuse(new Error("Error invoking remote method 'emerald:request': Error: layout must be a layout"), 0);
  await assert.rejects(editAllLayout((l) => ({ ...l, tabs: l.tabs.map((t) => ({ ...t, name: 'refused 947' })) })), /layout must be a layout/);
  assert.equal(daemon.sets() - before, 1, 'a refusal with the revision unmoved is not tried again');
});

test("a refusal whose code the bridge dropped is retried when the daemon's revision moved past the one sent (M9 fix 947)", async () => {
  const daemon = stubLayoutDaemon(getState().allLayout!);
  const before = daemon.sets();
  daemon.refuse(new Error('layout edit was based on revision 7 but the current revision is 8'), 1);
  const done = await editAllLayout((l) => ({ ...l, tabs: l.tabs.map((t) => ({ ...t, name: 'retried 947' })) }));
  assert.ok(done.tabs.every((t) => t.name === 'retried 947'));
  assert.equal(daemon.sets() - before, 2);
});

test("initialDaemon reads the main process's hello synchronously, and null with no window or a throw (M9 fix 1013)", () => {
  const g = globalThis as { window?: unknown };
  const held = g.window;
  try {
    g.window = { emerald: { daemonInfoNow: () => ({ pid: 17700, version: '0.1.997', featureLevel: 1, otherHome: null }) } };
    assert.equal(initialDaemon()?.pid, 17700);
    g.window = { emerald: { daemonInfoNow: () => { throw new Error('no handler'); } } };
    assert.equal(initialDaemon(), null);
    delete g.window;
    assert.equal(initialDaemon(), null);
  } finally {
    if (held === undefined) delete g.window;
    else g.window = held;
  }
});

// M9 fix 1085: the store knows every host from main's pushes and its
// sync, and a remote session keeps the host main stamped on it.
const hostDaemon = { pid: 4242, version: '0.1.1079', featureLevel: 80, otherHome: null };
const hostChanged = (state: string, over: Record<string, unknown> = {}) => ({ type: 'host.changed', host: 'wfs-db', state, daemon: state === 'up' ? hostDaemon : null, since: 7, retryIn: null, refusal: null, ...over });

test('a host.changed push to up holds the host daemon, and a stamped session.changed keeps its host (M9 fix 1085)', () => {
  push(hostChanged('up'));
  assert.deepEqual(getState().hosts.get('wfs-db')?.daemon, hostDaemon);
  push({ type: 'session.changed', session: aSession({ id: 'remote-1085', host: 'wfs-db', state: 'working' }) });
  const s = getState().sessions.get('remote-1085')!;
  assert.equal(s.host, 'wfs-db');
  assert.equal(effectiveState(s, getState().hosts), 'working');
  push(hostChanged('lost', { retryIn: 2 }));
  assert.equal(effectiveState(getState().sessions.get('remote-1085')!, getState().hosts), 'unreachable');
  push({ type: 'host.setup', host: 'wfs-db', phase: 'copying', bytes: 1024, startedAt: 30, line: null });
  assert.equal(getState().hosts.get('wfs-db')?.state, 'setup');
  push({ type: 'session.removed', sessionId: 'remote-1085' });
});

test('the sync fills the hosts and the sessions, local and stamped, from one list and the host states (M9 fix 1085)', async () => {
  const g = globalThis as { window?: unknown };
  const held = g.window;
  const wfs = { name: 'wfs-db', destination: 'zacha@wfs-db.example', addedAt: 0, source: 'config', home: 'C:\\Users\\zacha' };
  try {
    g.window = {
      emerald: {
        request: async (type: string) => {
          if (type === 'layout.get') return { layout: defaultLayout() };
          if (type === 'session.list') return { sessions: [aSession({ id: 'local-sync' }), aSession({ id: 'remote-sync', host: 'wfs-db' })] };
          return {};
        },
        daemonInfo: async () => ({ pid: 17600, version: '0.1.1079', featureLevel: 1, otherHome: null }),
        daemonCrash: async () => null,
        windowId: async () => 'first',
        remoteHosts: async () => [wfs],
        hostStates: async () => [{ host: 'wfs-db', state: 'up', daemon: hostDaemon, since: 3, retryIn: null, refusal: null }],
      },
    };
    push({ type: 'daemon.connected', daemon: { pid: 17600, version: '0.1.1079', featureLevel: 1, otherHome: null } });
    await turns(6);
    const s = getState();
    assert.equal(s.sessions.get('local-sync')?.host, undefined);
    assert.equal(s.sessions.get('remote-sync')?.host, 'wfs-db');
    assert.deepEqual(s.remoteHosts, [wfs]);
    assert.equal(s.hosts.get('wfs-db')?.state, 'up');
    assert.equal(s.hosts.get('wfs-db')?.record.home, 'C:\\Users\\zacha');
    // A window without the host methods (every older stub) syncs the local
    // side all the same.
    g.window = {
      emerald: {
        request: async (type: string) => {
          if (type === 'layout.get') return { layout: defaultLayout() };
          if (type === 'session.list') return { sessions: [aSession({ id: 'local-only' })] };
          return {};
        },
        daemonInfo: async () => ({ pid: 17601, version: '0.1.1079', featureLevel: 1, otherHome: null }),
        daemonCrash: async () => null,
        windowId: async () => 'first',
      },
    };
    push({ type: 'daemon.connected', daemon: { pid: 17601, version: '0.1.1079', featureLevel: 1, otherHome: null } });
    await turns(6);
    assert.equal(getState().sessions.has('local-only'), true);
    assert.equal(getState().daemon?.pid, 17601);
  } finally {
    if (held === undefined) delete g.window;
    else g.window = held;
  }
});

// M9 fix 1086: whichever edit puts a remote session in a pane, the
// layout.set carries the pane's host.
test('an edit that puts a remote session in a pane sends the pane with its host (M9 fix 1086)', async () => {
  const g = globalThis as { window?: unknown };
  const held = g.window;
  const start = { ...defaultLayout(), revision: 40 };
  // The wire is one tree for a daemon before tabs (the store's daemon
  // here is an earlier test's level 1), the layout otherwise.
  const box: { sent: Layout | SingleTree | null } = { sent: null };
  const sentTree = () => {
    const l = box.sent!;
    return 'tabs' in l ? l.tabs[0]! : l;
  };
  try {
    g.window = {
      emerald: {
        request: async (type: string, body: { layout?: Layout | SingleTree }) => {
          if (type === 'layout.get') return { layout: start };
          if (type === 'layout.set') {
            box.sent = body.layout!;
            return { layout: { ...box.sent, revision: box.sent.revision + 1 } };
          }
          return {};
        },
      },
    };
    push({ type: 'layout.changed', layout: start });
    push({ type: 'session.changed', session: aSession({ id: 'remote-1086', host: 'wfs-db' }) });
    const paneId = start.tabs[0]!.focusedPaneId;
    await editLayout((l) => replaceTab(l, setPaneSession(l.tabs[0]!, paneId, 'remote-1086')));
    assert.notEqual(box.sent, null);
    const pane = findPane(sentTree(), paneId)!;
    assert.equal(pane.sessionId, 'remote-1086');
    assert.equal(pane.host, 'wfs-db');
    // A local session put into that pane takes the host off.
    push({ type: 'session.changed', session: aSession({ id: 'local-1086' }) });
    await editLayout((l) => replaceTab(l, setPaneSession(l.tabs[0]!, paneId, 'local-1086')));
    assert.equal('host' in findPane(sentTree(), paneId)!, false);
  } finally {
    if (held === undefined) delete g.window;
    else g.window = held;
    push({ type: 'session.removed', sessionId: 'remote-1086' });
    push({ type: 'session.removed', sessionId: 'local-1086' });
  }
});
