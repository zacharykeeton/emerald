import { currentTab, findPane, setPaneHost, splitPane, tabHolding } from '@emerald/shared';
import type { Layout, LayoutNode, PaneTree, RemoteHost, SessionInfo, SessionState, SplitDirection, SplitPlace } from '@emerald/shared';
import type { DaemonInfo, RendererPush } from '../../preload/api.ts';
import type { State } from './store.ts';

// The remote hosts as the renderer knows them (M9 fixes 1085 and 1086).
// Pure: it imports the store's State as a type alone, so its node test
// pulls in no runtime cycle. A session that runs on a remote host carries
// `host` on its record, stamped by main; this PC is the absent host and
// never has an entry in the map.

export type SetupPhase = 'probing' | 'copying' | 'unpacking' | 'starting' | 'done' | 'failed';

export type HostState = {
  record: RemoteHost;
  state: 'idle' | 'connecting' | 'setup' | 'up' | 'lost' | 'refused';
  // The host's own daemon record once up.
  daemon: DaemonInfo | null;
  // When the state was entered, epoch ms (the lost band's 14:02).
  since: number;
  // Seconds, while lost.
  retryIn: number | null;
  refusal: { kind: 'hostkey' | 'ssh' | 'nokit'; line: string } | null;
  setup: { phase: SetupPhase; bytes: number; startedAt: number; line: string | null } | null;
};

export type HostChangedPush = Extract<RendererPush, { type: 'host.changed' }>;
export type HostSetupPush = Extract<RendererPush, { type: 'host.setup' }>;

export function hostOf(session: SessionInfo): string | undefined {
  return session.host;
}

// The pane's own host field, which a local daemon before level 80 strips.
export function paneHost(layout: Layout | null, paneId: string): string | undefined {
  if (layout === null) return undefined;
  const tab = tabHolding(layout, paneId);
  if (tab === null) return undefined;
  return findPane(tab, paneId)?.host;
}

// The host of the session the pane shows when the store holds it, else the
// pane's field: every action reads this, since a level-79 local daemon's
// validator rebuilds a pane from its kind, id, session and view alone.
export function hostOfPane(state: State, paneId: string): string | undefined {
  const layout = state.layout;
  if (layout === null) return undefined;
  const tab = tabHolding(layout, paneId);
  const pane = tab === null ? null : findPane(tab, paneId);
  if (pane === null) return undefined;
  if (pane.sessionId !== null) {
    const session = state.sessions.get(pane.sessionId) ?? state.removed.get(pane.sessionId);
    if (session !== undefined) return session.host;
  }
  return pane.host;
}

// The host of the tab on show's focused pane, the on row's default.
export function focusedHost(state: State): string | undefined {
  if (state.layout === null) return undefined;
  return hostOfPane(state, currentTab(state.layout).focusedPaneId);
}

export function daemonFor(state: State, host: string | undefined): DaemonInfo | null {
  if (host === undefined) return state.daemon;
  return state.hosts.get(host)?.daemon ?? null;
}

export function hostState(state: State, host: string | undefined): HostState | null {
  if (host === undefined) return null;
  return state.hosts.get(host) ?? null;
}

// What a row or a title says of a session: its own state, unless its host
// has an entry that is not up, when the line to it is gone or not yet made.
export function effectiveState(session: SessionInfo, hosts: ReadonlyMap<string, HostState>): SessionState | 'unreachable' {
  // An exited session has nothing left to reach on its host, so a lost line
  // leaves it exited (the sidebar header counts the live ones alone).
  if (session.host === undefined || session.state === 'exited') return session.state;
  const h = hosts.get(session.host);
  if (h === undefined || h.state === 'up') return session.state;
  return 'unreachable';
}

function blankRecord(name: string, remote: readonly RemoteHost[]): RemoteHost {
  return remote.find((r) => r.name === name) ?? { name, destination: name, addedAt: 0, source: 'added' };
}

function blankHost(name: string, remote: readonly RemoteHost[], now: number): HostState {
  return { record: blankRecord(name, remote), state: 'idle', daemon: null, since: now, retryIn: null, refusal: null, setup: null };
}

// main's host.changed: the state as pushed; an up clears a setup that did
// not fail.
export function applyHostChanged(
  hosts: ReadonlyMap<string, HostState>,
  remote: readonly RemoteHost[],
  push: Omit<HostChangedPush, 'type'>,
  now: number,
): ReadonlyMap<string, HostState> {
  const before = hosts.get(push.host) ?? blankHost(push.host, remote, now);
  // A forgotten host (idle) drops its setup too, failed or not.
  const setup = push.state === 'idle' || (push.state === 'up' && before.setup !== null && before.setup.phase !== 'failed') ? null : before.setup;
  const next: HostState = { ...before, state: push.state, daemon: push.daemon, since: push.since, retryIn: push.retryIn, refusal: push.refusal, setup };
  if (hosts.get(push.host) !== undefined && sameHost(before, next)) return hosts;
  const out = new Map(hosts);
  out.set(push.host, next);
  return out;
}

// main's host.setup: a running phase is the setup state, done hands over to
// the connect (an up that came first stays up), failed keeps its line and
// leaves the host idle.
export function applyHostSetup(hosts: ReadonlyMap<string, HostState>, remote: readonly RemoteHost[], push: Omit<HostSetupPush, 'type'>): ReadonlyMap<string, HostState> {
  const before = hosts.get(push.host) ?? blankHost(push.host, remote, push.startedAt);
  let next: HostState;
  if (push.phase === 'done') {
    next = { ...before, setup: null, state: before.state === 'setup' ? 'connecting' : before.state };
  } else if (push.phase === 'failed') {
    next = { ...before, setup: { phase: 'failed', bytes: push.bytes, startedAt: push.startedAt, line: push.line }, state: before.state === 'setup' ? 'idle' : before.state };
  } else {
    next = { ...before, setup: { phase: push.phase, bytes: push.bytes, startedAt: push.startedAt, line: push.line }, state: 'setup', since: push.startedAt };
  }
  if (hosts.get(push.host) !== undefined && sameHost(before, next)) return hosts;
  const out = new Map(hosts);
  out.set(push.host, next);
  return out;
}

// A fresh read of the hosts the on row offers: each entry's record by
// name, and an entry whose name left the list goes.
export function applyRemoteHosts(hosts: ReadonlyMap<string, HostState>, remote: readonly RemoteHost[]): ReadonlyMap<string, HostState> {
  let out: Map<string, HostState> | null = null;
  for (const [name, h] of hosts) {
    const record = remote.find((r) => r.name === name);
    if (record === undefined) {
      out ??= new Map(hosts);
      out.delete(name);
    } else if (!sameRecord(record, h.record)) {
      out ??= new Map(hosts);
      out.set(name, { ...h, record });
    }
  }
  return out ?? hosts;
}

function sameRecord(a: RemoteHost, b: RemoteHost): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof RemoteHost>;
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

function sameHost(a: HostState, b: HostState): boolean {
  return (
    a.record === b.record &&
    a.state === b.state &&
    a.daemon === b.daemon &&
    a.since === b.since &&
    a.retryIn === b.retryIn &&
    a.refusal === b.refusal &&
    (a.setup === b.setup ||
      (a.setup !== null && b.setup !== null && a.setup.phase === b.setup.phase && a.setup.bytes === b.setup.bytes && a.setup.startedAt === b.setup.startedAt && a.setup.line === b.setup.line))
  );
}

// A split whose new empty pane carries the source's host (M9 fix 1086),
// so the on row's default there is that host; with no host it is
// splitPane itself.
export function splitPaneOnHost<T extends PaneTree>(tree: T, paneId: string, direction: SplitDirection, host: string | undefined, place: SplitPlace = 'after'): T {
  const split = splitPane(tree, paneId, direction, undefined, place);
  return host === undefined ? split : setPaneHost(split, split.focusedPaneId, host);
}

// Every pane's host made to agree with what it shows (M9 fix 1086): a
// pane showing a session takes that session's host (null, a session the
// store does not hold yet, keeps the field), a view pane has none, an
// empty pane keeps its own (the split's default). The same layout when
// nothing moves.
export function withPaneHosts(layout: Layout, hostOfSession: (sessionId: string) => string | undefined | null): Layout {
  let changed = false;
  const fix = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'split') {
      const first = fix(node.first);
      const second = fix(node.second);
      return first === node.first && second === node.second ? node : { ...node, first, second };
    }
    let want: string | undefined;
    if (node.sessionId !== null) {
      const h = hostOfSession(node.sessionId);
      if (h === null) return node;
      want = h;
    } else if (node.view !== null) {
      want = undefined;
    } else {
      return node;
    }
    if (node.host === want) return node;
    changed = true;
    const { host: _old, ...rest } = node;
    return want === undefined ? rest : { ...rest, host: want };
  };
  const tabs = layout.tabs.map((t) => {
    const root = fix(t.root);
    return root === t.root ? t : { ...t, root };
  });
  return changed ? { ...layout, tabs } : layout;
}
