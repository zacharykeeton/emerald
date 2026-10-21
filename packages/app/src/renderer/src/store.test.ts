import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout } from '@emerald/shared';
import type { Layout, SessionInfo } from '@emerald/shared';
import { getRates, resetRates, runningShellsHeld, subscribeRates } from './rates-store.ts';
import { dismissCrash, editAllLayout, endSessionColorPreview, getState, holdSessionColorPreview, onPush, pickHeld, subscribe, whenSynced } from './store.ts';
import { aSession } from './test-support.ts';

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
