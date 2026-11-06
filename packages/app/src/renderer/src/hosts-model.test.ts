import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_CONFLICTS, findPane, splitPane } from '@emerald/shared';
import type { Layout, LayoutNode, RemoteHost } from '@emerald/shared';
import type { DaemonInfo } from '../../preload/api.ts';
import { applyHostChanged, applyHostSetup, applyRemoteHosts, daemonFor, effectiveState, focusedHost, hostOfPane, hostState, paneHost, splitPaneOnHost, withPaneHosts } from './hosts-model.ts';
import type { HostState } from './hosts-model.ts';
import type { State } from './store.ts';
import { aSession } from './test-support.ts';

// M9 fix 1085: the renderer's hosts, every reader of "the daemon" asking
// the right one, and a session on a lost host reading unreachable.

const local: DaemonInfo = { pid: 100, version: '0.1.1079', featureLevel: 80, otherHome: null };
const remoteDaemon: DaemonInfo = { pid: 200, version: '0.1.1079', featureLevel: 80, otherHome: null };
const wfs: RemoteHost = { name: 'wfs-db', destination: 'zacha@wfs-db.example', addedAt: 0, source: 'config', home: 'C:\\Users\\zacha' };

function layoutOf(root: LayoutNode, focusedPaneId: string): Layout {
  return { tabs: [{ id: 't1', name: 'Panes', root, focusedPaneId }], currentTabId: 't1', revision: 1 };
}

function stateWith(over: Partial<State>): State {
  return {
    connected: true,
    layout: null,
    allLayout: null,
    windowId: null,
    sessions: new Map(),
    removed: new Map(),
    folders: new Map(),
    conflicts: EMPTY_CONFLICTS,
    daemon: local,
    hosts: new Map(),
    remoteHosts: [],
    crashed: null,
    preview: null,
    ...over,
  };
}

function hostEntry(state: HostState['state'], over: Partial<HostState> = {}): HostState {
  return { record: wfs, state, daemon: state === 'up' ? remoteDaemon : null, since: 1, retryIn: null, refusal: null, setup: null, ...over };
}

const changed = (state: 'idle' | 'connecting' | 'up' | 'lost' | 'refused', over: Partial<{ daemon: DaemonInfo | null; since: number; retryIn: number | null; refusal: { kind: 'hostkey' | 'ssh' | 'nokit'; line: string } | null }> = {}) => ({
  host: 'wfs-db',
  state,
  daemon: state === 'up' ? remoteDaemon : null,
  since: 5,
  retryIn: null,
  refusal: null,
  ...over,
});

test('daemonFor gives the local daemon for no host, a host daemon once up, and null for an unknown host (M9 fix 1085)', () => {
  const s = stateWith({ hosts: new Map([['wfs-db', hostEntry('up')]]) });
  assert.equal(daemonFor(s, undefined), local);
  assert.equal(daemonFor(s, 'wfs-db'), remoteDaemon);
  assert.equal(daemonFor(s, 'other'), null);
  assert.equal(hostState(s, undefined), null);
  assert.equal(hostState(s, 'other'), null);
  assert.equal(hostState(s, 'wfs-db')?.state, 'up');
});

test('effectiveState reads a session on a host that is not up as unreachable, and every other session as its own state (M9 fix 1085)', () => {
  const localSession = aSession({ id: 'a', state: 'working' });
  const remote = aSession({ id: 'b', state: 'working', host: 'wfs-db' });
  assert.equal(effectiveState(localSession, new Map()), 'working');
  assert.equal(effectiveState(remote, new Map()), 'working', 'a host with no entry');
  assert.equal(effectiveState(remote, new Map([['wfs-db', hostEntry('up')]])), 'working');
  for (const st of ['lost', 'connecting', 'refused'] as const) {
    assert.equal(effectiveState(remote, new Map([['wfs-db', hostEntry(st)]])), 'unreachable', st);
  }
  assert.equal(effectiveState(localSession, new Map([['wfs-db', hostEntry('lost')]])), 'working', 'a local session never reads unreachable');
  const exited = aSession({ id: 'c', state: 'exited', host: 'wfs-db' });
  assert.equal(effectiveState(exited, new Map([['wfs-db', hostEntry('lost')]])), 'exited', 'an exited session on a lost host stays exited');
});

test("hostOfPane prefers the session's host over the pane's field and reads the field for an empty pane (M9 fix 1085)", () => {
  const root: LayoutNode = {
    kind: 'split',
    id: 'sp',
    direction: 'row',
    ratio: 0.5,
    first: { kind: 'pane', id: 'p1', sessionId: 's1', view: null },
    second: { kind: 'pane', id: 'p2', sessionId: null, view: null, host: 'wfs-db' },
  };
  const layout = layoutOf(root, 'p1');
  const s = stateWith({ layout, sessions: new Map([['s1', aSession({ id: 's1', host: 'other' })]]) });
  assert.equal(hostOfPane(s, 'p1'), 'other', "the session's host, though the pane has no field (a level-79 daemon strips it)");
  assert.equal(hostOfPane(s, 'p2'), 'wfs-db');
  assert.equal(paneHost(layout, 'p2'), 'wfs-db');
  assert.equal(paneHost(layout, 'p1'), undefined);
  assert.equal(paneHost(null, 'p1'), undefined);
  assert.equal(focusedHost(s), 'other');
  assert.equal(focusedHost(stateWith({ layout: layoutOf(root, 'p2') })), 'wfs-db');
  // A local session in a pane that still carries a stale field reads local.
  const stale = layoutOf({ kind: 'pane', id: 'p3', sessionId: 's3', view: null, host: 'wfs-db' }, 'p3');
  assert.equal(hostOfPane(stateWith({ layout: stale, sessions: new Map([['s3', aSession({ id: 's3' })]]) }), 'p3'), undefined);
});

test('applyHostChanged makes an entry from the record, sets the pushed state and clears a setup on up (M9 fix 1085)', () => {
  const empty = new Map<string, HostState>();
  const one = applyHostChanged(empty, [wfs], changed('connecting'), 9);
  const e = one.get('wfs-db')!;
  assert.equal(e.record, wfs);
  assert.equal(e.state, 'connecting');
  assert.equal(e.since, 5);
  // A name the hosts do not list gets a bare record.
  const bare = applyHostChanged(empty, [], { ...changed('up'), host: 'x' }, 9).get('x')!;
  assert.deepEqual(bare.record, { name: 'x', destination: 'x', addedAt: 0, source: 'added' });
  const lost = applyHostChanged(one, [wfs], changed('lost', { retryIn: 2 }), 9).get('wfs-db')!;
  assert.equal(lost.state, 'lost');
  assert.equal(lost.retryIn, 2);
  const refused = applyHostChanged(one, [wfs], changed('refused', { refusal: { kind: 'hostkey', line: 'Host key verification failed.' } }), 9).get('wfs-db')!;
  assert.deepEqual(refused.refusal, { kind: 'hostkey', line: 'Host key verification failed.' });
  // An up clears a running setup, but keeps a failed one's line.
  const running = new Map([['wfs-db', hostEntry('setup', { setup: { phase: 'starting', bytes: 10, startedAt: 1, line: null } })]]);
  assert.equal(applyHostChanged(running, [wfs], changed('up'), 9).get('wfs-db')!.setup, null);
  const failed = new Map([['wfs-db', hostEntry('idle', { setup: { phase: 'failed', bytes: 0, startedAt: 1, line: 'boom' } })]]);
  assert.equal(applyHostChanged(failed, [wfs], changed('up'), 9).get('wfs-db')!.setup?.line, 'boom');
  // A forgotten host reads idle, its daemon and any setup gone, so the next
  // pick contacts it afresh (the close-out of fixes 1079 to 1090).
  const up = new Map([['wfs-db', hostEntry('up')]]);
  const forgotten = applyHostChanged(failed, [wfs], changed('idle', { daemon: null }), 9).get('wfs-db')!;
  assert.equal(forgotten.state, 'idle');
  assert.equal(forgotten.setup, null);
  assert.equal(applyHostChanged(up, [wfs], changed('idle', { daemon: null }), 9).get('wfs-db')!.daemon, null);
});

test('applyHostSetup: a running phase is the setup state, done hands over to the connect, failed keeps its line (M9 fix 1085)', () => {
  const idle = new Map([['wfs-db', hostEntry('idle')]]);
  const copying = applyHostSetup(idle, [wfs], { host: 'wfs-db', phase: 'copying', bytes: 35651584, startedAt: 40, line: null });
  const c = copying.get('wfs-db')!;
  assert.equal(c.state, 'setup');
  assert.equal(c.since, 40);
  assert.deepEqual(c.setup, { phase: 'copying', bytes: 35651584, startedAt: 40, line: null });
  const done = applyHostSetup(copying, [wfs], { host: 'wfs-db', phase: 'done', bytes: 35651584, startedAt: 40, line: null }).get('wfs-db')!;
  assert.equal(done.setup, null);
  assert.equal(done.state, 'connecting');
  // An up that came before the done stays up.
  const upFirst = new Map([['wfs-db', hostEntry('up', { setup: { phase: 'starting', bytes: 1, startedAt: 40, line: null } })]]);
  assert.equal(applyHostSetup(upFirst, [wfs], { host: 'wfs-db', phase: 'done', bytes: 1, startedAt: 40, line: null }).get('wfs-db')!.state, 'up');
  const failed = applyHostSetup(copying, [wfs], { host: 'wfs-db', phase: 'failed', bytes: 0, startedAt: 40, line: 'cancelled' }).get('wfs-db')!;
  assert.equal(failed.state, 'idle');
  assert.deepEqual(failed.setup, { phase: 'failed', bytes: 0, startedAt: 40, line: 'cancelled' });
});

test('applyRemoteHosts replaces each record by name, drops a host that left, and answers the same map when nothing moved (M9 fix 1085)', () => {
  const hosts = new Map([['wfs-db', hostEntry('up')], ['gone', hostEntry('lost', { record: { name: 'gone', destination: 'gone', addedAt: 3, source: 'added' } })]]);
  const kitted: RemoteHost = { ...wfs, kitVersion: '0.1.1079' };
  const next = applyRemoteHosts(hosts, [kitted]);
  assert.equal(next.get('wfs-db')!.record, kitted);
  assert.equal(next.has('gone'), false);
  assert.equal(next.get('wfs-db')!.state, 'up');
  assert.equal(applyRemoteHosts(next, [{ ...kitted }]), next, 'an equal record is no change');
});

// M9 fix 1086: a split carries its source's host, and every pane's host
// follows what it shows.
let n = 0;
const ids = () => `id${++n}`;

test('splitPaneOnHost with no host is splitPane, and with one gives the new pane the host and leaves the source as it was (M9 fix 1086)', () => {
  const tree = { root: { kind: 'pane', id: 'p1', sessionId: 's1', view: null } as LayoutNode, focusedPaneId: 'p1' };
  n = 0;
  const plain = splitPane(tree, 'p1', 'row', ids);
  n = 0;
  const onNone = splitPaneOnHost(tree, 'p1', 'row', undefined);
  // splitPaneOnHost takes no id generator, so compare the shape with the ids masked.
  const mask = (t: { root: LayoutNode; focusedPaneId: string }) => JSON.parse(JSON.stringify(t).replace(/"(id\d+|[0-9a-f-]{36})"/g, '"x"'));
  assert.deepEqual(mask(onNone), mask(plain));
  const fresh = findPane(onNone, onNone.focusedPaneId)!;
  assert.equal('host' in fresh, false, 'no host key on the new pane');
  const onHost = splitPaneOnHost(tree, 'p1', 'column', 'wfs-db', 'before');
  assert.equal(findPane(onHost, onHost.focusedPaneId)!.host, 'wfs-db');
  assert.equal('host' in findPane(onHost, 'p1')!, false, 'the source pane is unchanged');
  assert.equal(onHost.root.kind === 'split' && onHost.root.first.id === onHost.focusedPaneId, true, 'before puts the new pane first');
});

test("withPaneHosts sets a remote session's host, removes a local one's and a view's, keeps an empty pane's and an unknown session's (M9 fix 1086)", () => {
  const root: LayoutNode = {
    kind: 'split',
    id: 'a',
    direction: 'row',
    ratio: 0.5,
    first: {
      kind: 'split',
      id: 'b',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'pane', id: 'remote', sessionId: 'r', view: null },
      second: { kind: 'pane', id: 'local', sessionId: 'l', view: null, host: 'wfs-db' },
    },
    second: {
      kind: 'split',
      id: 'c',
      direction: 'row',
      ratio: 0.5,
      first: { kind: 'pane', id: 'view', sessionId: null, view: { kind: 'activity' }, host: 'wfs-db' } as LayoutNode,
      second: {
        kind: 'split',
        id: 'd',
        direction: 'row',
        ratio: 0.5,
        first: { kind: 'pane', id: 'empty', sessionId: null, view: null, host: 'wfs-db' },
        second: { kind: 'pane', id: 'unknown', sessionId: 'u', view: null, host: 'other' },
      },
    },
  };
  const layout = layoutOf(root, 'remote');
  const hostOf = (id: string) => (id === 'r' ? 'wfs-db' : id === 'l' ? undefined : null);
  const out = withPaneHosts(layout, hostOf);
  const tab = out.tabs[0]!;
  assert.equal(findPane(tab, 'remote')!.host, 'wfs-db');
  assert.equal('host' in findPane(tab, 'local')!, false);
  assert.equal('host' in findPane(tab, 'view')!, false);
  assert.equal(findPane(tab, 'empty')!.host, 'wfs-db');
  assert.equal(findPane(tab, 'unknown')!.host, 'other');
  assert.equal(withPaneHosts(out, hostOf), out, 'the same layout when nothing moves');
  const allLocal = layoutOf({ kind: 'pane', id: 'p', sessionId: 'l', view: null }, 'p');
  assert.equal(withPaneHosts(allLocal, hostOf), allLocal);
});
