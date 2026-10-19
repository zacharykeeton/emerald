import { useRef, useSyncExternalStore } from 'react';
import { currentTab, frontWindow, mergeWindowView, pushSample, replaceTab, tabHolding, windowView, windowsOf } from '@emerald/shared';
import { EMPTY_CONFLICTS } from '@emerald/shared';
import type { ConflictReport, Layout, LayoutTab, SessionInfo } from '@emerald/shared';
import type { DaemonCrash, DaemonInfo, RendererPush } from '../../preload/api.ts';
import { withPreview } from './color-preview-model.ts';
import type { ColorPreview } from './color-preview-model.ts';
import { conflictsSupported, folderLabelsSupported, keptSupported, layoutForWire, normalizeLayout, normalizeSession } from './daemon-model.ts';
import { dropRate, resetRates, setRate } from './rates-store.ts';
import { RATE_FEATURE_LEVEL } from './session-mark-model.ts';

// Mirror of the daemon's layout and session list. Never authoritative: every
// change goes to the daemon as a request and lands here only when the daemon
// pushes it back. Components read it with useStore('a', 'b'), naming
// the fields they use; the output rates live in rates-store.ts since M9
// fix 354, since a push a second per writing session is too many for a
// store the whole window reads.

export interface State {
  connected: boolean;
  // null until the first layout.get answers. This window's own view
  // (M9 fix 867): its tabs and its tab on show, windowView of allLayout,
  // which is allLayout itself while the layout has one window.
  layout: Layout | null;
  // The whole layout as the daemon pushed it, every window's tabs, for the
  // readers that mean every window (a session on a pane anywhere).
  allLayout: Layout | null;
  // The layout window this page shows, from the main process; null until
  // the sync has asked.
  windowId: string | null;
  sessions: ReadonlyMap<string, SessionInfo>;
  // The sessions removed from the list that the daemon still keeps (M57),
  // each with its removedAt, for the Commits tab's lanes; a daemon before
  // level 25 keeps none and the map stays empty. Never on the sidebar.
  removed: ReadonlyMap<string, SessionInfo>;
  // The person's own labels on folder groups (M9 fix 194), by the
  // group's key, the daemon's folders.json; empty on a daemon before
  // level 39.
  folders: ReadonlyMap<string, string>;
  // The conflict forecast (M9 fix 320): the pairs of live sessions
  // whose branches would conflict and each branch's base, as the
  // daemon last pushed it; the empty report on a daemon before level
  // 52 and until the first poll answers, which draw the same nothing.
  conflicts: ConflictReport;
  // What hello said about the daemon this window is on; null until connected.
  daemon: DaemonInfo | null;
  // The last daemon this window started that ended on a crash code (M9 fix 815), until Not now; kept across the disconnect, the next hello and a reload (M9 fix 832), the main process holding it.
  crashed: DaemonCrash | null;
  // The colour a Colour row's swatch is previewing on one session (M9
  // fix 157), laid over `sessions` in the snapshot getState hands out;
  // `sessions` here is what the daemon pushed.
  preview: ColorPreview | null;
}

// What the daemon pushed, and the snapshot components read: the same
// object until a preview is on, then a copy with the previewed colour
// on its one session, so a reader never sees the preview and the saved
// colour at once.
let state: State = { connected: true, layout: null, allLayout: null, windowId: null, sessions: new Map(), removed: new Map(), folders: new Map(), conflicts: EMPTY_CONFLICTS, daemon: null, crashed: null, preview: null };
let snapshot: State = state;
const listeners = new Set<() => void>();
let started = false;

function setState(patch: Partial<State>): void {
  state = { ...state, ...patch };
  snapshot = state.preview === null ? state : { ...state, sessions: withPreview(state.sessions, state.preview) };
  for (const listener of listeners) listener();
}

export function getState(): State {
  return snapshot;
}

// The whole layout and this window's view of it, set together (M9 fix 867).
function layoutPatch(all: Layout, windowId: string | null = state.windowId): Pick<State, 'allLayout' | 'layout'> {
  return { allLayout: all, layout: windowView(all, windowId) };
}

// True while this window is the one in front (the one holding the
// layout's current tab), and always with one window: the chime, the toast
// and the repeat are the front window's alone.
export function isFrontWindow(): boolean {
  const all = state.allLayout;
  if (all === null || all.windows === undefined) return true;
  return frontWindow(all).id === (state.windowId ?? windowsOf(all)[0]!.id);
}

// The colour the daemon has for a session, under any preview: undefined
// for a session the store does not list.
export function savedSessionColor(sessionId: string): string | null | undefined {
  return state.sessions.get(sessionId)?.color;
}

// A swatch under the pointer (M9 fix 157) paints its session; leaving it
// puts the saved colour back unless the swatch was clicked, when the
// preview holds until the daemon pushes the session with its new colour
// (or the request fails, `force`). A held preview is never displaced by
// a later hover on another session's row.
export function previewSessionColor(sessionId: string, color: string): void {
  if (state.preview?.held === true) return;
  setState({ preview: { sessionId, color, held: false } });
}

export function holdSessionColorPreview(sessionId: string, color: string): void {
  setState({ preview: { sessionId, color, held: true } });
}

export function endSessionColorPreview(sessionId: string, force = false): void {
  const p = state.preview;
  if (p === null || p.sessionId !== sessionId || (p.held && !force)) return;
  setState({ preview: null });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// M9 fix 853: resolves once the daemon is known and the layout is in. A
// launch's open is delivered at the page's first ready, before sync() has
// landed, and newTab leaves the layout unmade while the daemon is unknown,
// so a folder from Explorer would otherwise start its session in the old
// tab. Fifteen seconds: the main process gives the first connection ten
// (READY_DEADLINE_MS), and the sync's own requests follow it.
export const SYNC_WAIT_MS = 15_000;
export function whenSynced(timeoutMs = SYNC_WAIT_MS): Promise<void> {
  if (state.daemon !== null && state.layout !== null) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('the daemon did not come up'));
    }, timeoutMs);
    const unsubscribe = subscribe(() => {
      if (state.daemon === null || state.layout === null) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

// The fields named, as one object whose identity holds while every named
// field's identity holds (M9 fix 354): a push that moves another field
// then costs this reader no render. The pick is cached per hook, since
// React reads the snapshot twice a render and a fresh object each time
// would loop it.
export function useStore<K extends keyof State>(...keys: [K, ...K[]]): Pick<State, K> {
  const held = useRef<Pick<State, K> | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const pick = pickHeld(held.current, snapshot, keys);
    held.current = pick;
    return pick;
  });
}

// The held pick when every named field is the same object as the
// snapshot's, else a new one; exported for the store's test.
export function pickHeld<K extends keyof State>(held: Pick<State, K> | null, s: State, keys: readonly K[]): Pick<State, K> {
  if (held !== null && keys.every((k) => Object.is(held[k], s[k]))) return held;
  const pick = {} as Pick<State, K>;
  for (const k of keys) pick[k] = s[k];
  return pick;
}

export function start(): void {
  if (started) return;
  started = true;
  window.emerald.on(onPush);
  // If the pipe is not up yet this fails and the daemon.connected push retries it.
  // The main process gives the first connection ten seconds (M9 fix 453);
  // past that no disconnected push ever came, since there was never a
  // connection to lose, so the banner is put up here.
  void sync().catch((err: unknown) => {
    console.warn('[emerald] initial sync failed, waiting for the daemon', err);
    if (String(err).includes('emmerd did not come up') && state.daemon === null) setState({ connected: false });
  });
}

// Subscribe before fetching so no change can slip between the snapshot and
// the first push.
async function sync(): Promise<void> {
  await window.emerald.request('subscribe', { topics: ['sessions', 'layout'] });
  const [{ layout }, { sessions }, daemon, crash, windowId] = await Promise.all([
    window.emerald.request('layout.get', {}),
    // The removed ones too (M57); a daemon before level 25 reads no flag
    // and answers the listed ones alone.
    window.emerald.request('session.list', { removed: true }),
    window.emerald.daemonInfo(),
    // The crash the main process holds (M9 fix 832), for a renderer that
    // reloaded before Not now.
    window.emerald.daemonCrash(),
    // The layout window this page shows (M9 fix 867).
    window.emerald.windowId(),
  ]);
  // The rate topic (M41) is its own request after the daemon is known: a
  // daemon before level 14 answers bad-request to a topic it has not got,
  // and that must not cost the sessions and layout above. Its pushes
  // start after this, so the map fills as sessions write.
  if (daemon !== null && daemon.featureLevel !== null && daemon.featureLevel >= RATE_FEATURE_LEVEL) {
    await window.emerald.request('subscribe', { topics: ['rate'] });
  }
  // The folder labels (M9 fix 194), after the daemon is known for the
  // same reason: an older one answers bad-request.
  const folders = folderLabelsSupported(daemon) ? (await window.emerald.request('folders.list', {})).folders : [];
  const conflicts = conflictsSupported(daemon) ? await window.emerald.request('conflicts.get', {}) : EMPTY_CONFLICTS;
  const listed = sessions.filter((s) => typeof s.removedAt !== 'number');
  const removed = sessions.filter((s) => typeof s.removedAt === 'number');
  setState({
    connected: true,
    windowId,
    ...layoutPatch(normalizeLayout(layout), windowId),
    sessions: new Map(listed.map((s) => [s.id, normalizeSession(s)])),
    removed: new Map(removed.map((s) => [s.id, normalizeSession(s)])),
    folders: new Map(folders.map((f) => [f.folder, f.label])),
    conflicts,
    daemon,
    // Read at the setState, so a crash push that landed while the reads
    // were out is kept, and a null answer never clears a banner on show.
    crashed: crash ?? state.crashed,
    // A resync is the daemon's word as a push is, so a held preview ends.
    preview: state.preview?.held === true ? null : state.preview,
  });
  resetRates();
}

// The crash banner's Not now (M9 fix 815).
export function dismissCrash(): void {
  setState({ crashed: null });
  window.emerald.dismissCrash();
}

// Exported for the store's test, which feeds it a push by hand.
export function onPush(msg: RendererPush): void {
  switch (msg.type) {
    case 'daemon.connected':
      // A reconnect is a fresh pipe connection with no subscriptions on the
      // daemon side, and the layout may have moved while we were away.
      setState({ daemon: msg.daemon });
      void sync().catch((err: unknown) => console.warn('[emerald] resync failed', err));
      return;
    case 'daemon.disconnected':
      setState({ connected: false, daemon: null });
      return;
    case 'daemon.crashed':
      setState({ crashed: msg.crash });
      return;
    case 'layout.changed': {
      const patch = layoutPatch(normalizeLayout(msg.layout));
      const layout = patch.layout!;
      const tab = currentTab(layout);
      const before = state.layout === null ? null : currentTab(state.layout);
      if (before?.id !== tab.id) console.log(`[emerald] tab -> ${tab.name} (revision ${layout.revision})`);
      if (before?.focusedPaneId !== tab.focusedPaneId) {
        console.log(`[emerald] focus -> pane ${tab.focusedPaneId.slice(0, 8)} (revision ${layout.revision})`);
      }
      setState(patch);
      return;
    }
    case 'session.changed': {
      const sessions = new Map(state.sessions);
      sessions.set(msg.session.id, normalizeSession(msg.session));
      // The push a held preview waited for (M9 fix 157): whatever colour
      // it carries is the daemon's word, so the preview goes.
      const preview = state.preview?.held === true && state.preview.sessionId === msg.session.id ? null : state.preview;
      setState({ sessions, preview });
      return;
    }
    case 'sessions.load': {
      // One load tick (M9 fix 703): each sample appended to its session's
      // ring in one copy of the map and one notify. A sample the ring
      // already holds is skipped, since a session.list reply (through
      // invoke) can overtake a push (through send) carrying the same tick.
      // A held colour preview stays: only the record push it waits for
      // drops it.
      let sessions: Map<string, SessionInfo> | null = null;
      for (const { sessionId, sample, names } of msg.samples) {
        const rec = (sessions ?? state.sessions).get(sessionId);
        if (rec === undefined) continue;
        const last = rec.load?.at(-1);
        if (last !== undefined && last.at >= sample.at) continue;
        sessions ??= new Map(state.sessions);
        sessions.set(sessionId, { ...rec, load: pushSample(rec.load, sample), loadNames: names });
      }
      if (sessions !== null) setState({ sessions });
      return;
    }
    case 'session.removed': {
      const sessions = new Map(state.sessions);
      const gone = sessions.get(msg.sessionId);
      sessions.delete(msg.sessionId);
      if (state.preview?.sessionId === msg.sessionId) setState({ preview: null });
      dropRate(msg.sessionId);
      // The daemon keeps the record (M57); the exact removedAt lands with
      // the next sync, and until then the moment the push arrived is it.
      const removed = new Map(state.removed);
      if (gone !== undefined && keptSupported(state.daemon)) removed.set(msg.sessionId, { ...gone, removedAt: Date.now() });
      setState({ sessions, removed });
      return;
    }
    case 'pty.rate':
      // The rates store's listeners alone hear this (M9 fix 354).
      setRate(msg.sessionId, msg.samples);
      return;
    case 'folders.changed':
      setState({ folders: new Map(msg.folders.map((f) => [f.folder, f.label])) });
      return;
    case 'conflicts.changed':
      setState({ conflicts: msg.report });
      return;
    default:
      return;
  }
}

// Applies a pure tree operation to the current layout and sends the result to
// the daemon. Edits are serialized: two chords in quick succession must see
// each other's result, and the mirror only learns a result when the daemon
// answers. If another client's edit landed first the daemon answers
// stale-revision and the edit is re-applied once on top of the fresh layout,
// which is the right thing for every operation we have.
let editQueue: Promise<unknown> = Promise.resolve();

// Resolves with the layout as the daemon saved it, so a caller that needs
// something from the result (the id of a pane a split just made) has it.
export function editLayout(fn: (layout: Layout) => Layout): Promise<Layout> {
  const run = editQueue.then(() => applyEdit(fn));
  // Keep the chain alive after a failure so later edits still run.
  editQueue = run.catch(() => {});
  return run;
}

async function applyEdit(fn: (layout: Layout) => Layout): Promise<Layout> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // The edit runs on this window's view and is folded back into the
    // whole before it goes (M9 fix 867); with one window the view is the
    // whole and the fold is the view itself.
    let base = state.layout;
    if (base === null) {
      const patch = layoutPatch(normalizeLayout((await window.emerald.request('layout.get', {})).layout));
      setState(patch);
      base = patch.layout!;
    }
    const next = fn(base);
    if (next === base) return base;
    try {
      // The push carries the same layout, but the reply is what this edit
      // awaited on, so apply it here too and the next queued edit sees it.
      const whole = mergeWindowView(state.allLayout ?? next, next, state.windowId);
      const reply = await window.emerald.request('layout.set', { layout: layoutForWire(whole, state.daemon) });
      const patch = layoutPatch(normalizeLayout(reply.layout));
      if (state.allLayout === null || patch.allLayout!.revision > state.allLayout.revision) setState(patch);
      return patch.layout!;
    } catch (err) {
      if ((err as { code?: string }).code !== 'stale-revision') throw err;
      const { layout } = await window.emerald.request('layout.get', {});
      setState(layoutPatch(normalizeLayout(layout)));
    }
  }
  throw new Error('layout edit lost to another client twice');
}

// A tree edit on one tab (M36): the tab on show, or with a pane named the
// tab holding that pane, which is the tab on show for anything clicked
// but not for a session shown elsewhere. Resolves with the tab as the
// daemon saved it, so a caller has the new focused pane. A pane that is
// in no tab any more (closed under a queued edit) leaves the layout as it
// is rather than editing the wrong tab.
export function editTab(fn: (tab: LayoutTab) => LayoutTab, paneId: string | null = null): Promise<LayoutTab> {
  let editedId: string | null = null;
  return editLayout((l) => {
    const tab = paneId === null ? currentTab(l) : tabHolding(l, paneId);
    if (tab === null) return l;
    editedId = tab.id;
    const next = fn(tab);
    return next === tab ? l : replaceTab(l, next);
  }).then((l) => (editedId === null ? currentTab(l) : (l.tabs.find((t) => t.id === editedId) ?? currentTab(l))));
}
