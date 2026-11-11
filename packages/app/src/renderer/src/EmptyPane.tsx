import { useEffect, useRef, useState } from 'react';
import { hidePaneHere, openFileFromOutside, paneFolder, placeSession, setSessionScheme, splitHere, startClaudeIn, startShellHere, startShellIn, typeInto } from './actions.ts';
import type { DropZone } from './drop-zone-model.ts';
import { cleanPath, defaultKind, emptyKey, escapeStep, folderRows, hostRecent, hostRefusal, hostSub, hostTail, hostWaiting, nextTile, onRowShown, resolvePath, parentLabel, setupFigure, shellChoice, shellSub, startHead, startLabel, tileTitle, wantsAuthRead } from './empty-pane-model.ts';
import { paneHost } from './hosts-model.ts';
import { installedShells } from './daemon-model.ts';
import type { EmptyKind, EmptyTile } from './empty-pane-model.ts';
import { currentPrefix, runAction } from './keys.ts';
import { recordUse } from './use-record.ts';
import { editKey, formatChord, isCtrlOrCmd, plainKeyFor } from './keys-model.ts';
import { currentTab, describeState, findPane, focusPane, folderName, groupSessions, hasState, setPaneSession, setPaneView } from '@emerald/shared';
import type { ClaudeAuth, SessionInfo, ShellId } from '@emerald/shared';
import { normalizeFolder } from './new-session-model.ts';
import { Menu, menuOpen } from './Menu.tsx';
import { HostChip } from './HostChip.tsx';
import { ACTION_PREFIX, actionGroup, actionKey, actionRows, isActionQuery, moveHighlight, orderRows, pickRows, rankSessions, segments, waitText } from './palette-model.ts';
import type { ActionRow, Match } from './palette-model.ts';
import { paneMenuOf } from './pane-menus.ts';
import { lastFolder, loadRecent } from './recent-folders.ts';
import { colorStyle } from './session-color.ts';
import { setScheme, useScheme } from './scheme-store.ts';
import { shownSessions, shownWords } from './shown-sessions.ts';
import type { Shown } from './shown-sessions.ts';
import { useSkin } from './skin.ts';
import { browserViewSupported, fileViewSupported } from './daemon-model.ts';
import { editTab, getState, useDaemonFor, useStore } from './store.ts';
import { closeSplitOffer, noteClaudeStart, setSplitKind } from './ui.ts';
import { getUiState, loadClaudeOpensOn, loadEmptyPaneKind, loadEmptyPaneShell, openNewSession, rememberClaudeOpensOn, rememberEmptyPaneKind, rememberEmptyPaneShell, useUi } from './ui.ts';

interface Props {
  paneId: string;
  // Called after a session is placed in the pane, or on Escape.
  onDone: () => void;
  // The empty pane itself (the kind tiles, the folders, the splits), not
  // the overlay over a pane that has a session or a view (the title bar
  // has the splits there).
  showSplits?: boolean;
  // Whether this is the layout tab's only pane (M9 fix 103): an empty last
  // pane has nothing to close, so the close button is left out rather
  // than shown dead.
  onlyPane?: boolean;
}

// The filter box's placeholder in three lengths (M9 fix 223): the whole
// thing, one without the chord hints, and the shortest that still says
// the two things a person can type. The CSS picks by the box's width.
export const PLACEHOLDER_LONG = `Type to filter: name, folder, branch, last prompt. Enter shows it here, Shift+Enter beside, ${editKey('Enter')} below. > for actions.`;
export const PLACEHOLDER_MID = 'Type to filter: name, folder, branch, last prompt. > for actions.';
export const PLACEHOLDER_SHORT = 'Type to filter · > for actions';
// With nothing running there is nothing to filter (M9 fix 545).
export const PLACEHOLDER_NONE = 'Type > for actions';

// What an empty pane shows (M9 fix 545): what kind to start, then which
// folder, both filled in so a bare Enter in the box starts something
// useful; Tab and Shift+Tab move through the tiles, 1 to 9 start in that folder at once, the
// arrows move the folder. Under it the jump palette (M21) to show a
// session that is already running instead: type to filter, and the keys
// are the palette's again (Enter shows the row here, Shift+Enter beside,
// Ctrl+Enter below). Ctrl+Shift+S and Ctrl+J over a full pane mount the
// same component as an overlay, list first, with no tiles and no folders.
export function EmptyPane({ paneId, onDone, showSplits = false, onlyPane = false }: Props) {
  const { sessions, layout, daemon, remoteHosts, hosts } = useStore('sessions', 'layout', 'daemon', 'remoteHosts', 'hosts');
  const schemeState = useScheme();
  const { pickerPaneId, pickerActions, sidebarOrder, attention, splitFolder, zoomedPaneId, splitOfferPaneId } = useUi();
  // M9 fix 1132: a pane that starts something or closes takes the split offer with it.
  useEffect(
    () => () => {
      if (getUiState().splitOfferPaneId === paneId) closeSplitOffer();
    },
    [paneId],
  );
  const skin = useSkin();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  // The split default, else the kind last started from an empty pane
  // (M9 fix 546), else a shell.
  const [kind, setKind] = useState<EmptyKind>(() => defaultKind(getUiState().splitKind, loadEmptyPaneKind()));
  // The Browser tile (M9 fix 666) is a pick Tab can land on, not a kind:
  // nothing is remembered of it and the folders do not apply. The File tile
  // (M9 fix 990) is the same, with a path box in the folders' place.
  const [tilePick, setTilePick] = useState<'browser' | 'file' | null>(null);
  const browserPick = tilePick === 'browser';
  const filePick = tilePick === 'file';
  const pathRef = useRef<HTMLInputElement>(null);
  const [pathText, setPathText] = useState('');
  const [pathNote, setPathNote] = useState<string | null>(null);
  // The path box has the keyboard once File is picked, by a click or by
  // Tab; leaving File puts it back in the box, since the path box it was
  // in is gone.
  const lastPick = useRef(tilePick);
  useEffect(() => {
    if (tilePick === 'file') pathRef.current?.focus();
    else if (lastPick.current === 'file') inputRef.current?.focus();
    lastPick.current = tilePick;
  }, [tilePick]);
  // The folder the person moved the selection to, or null for row 1, so a
  // default row that arrives after mount is selected rather than pushed.
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [recent] = useState<string[]>(() => loadRecent());
  // The on row (M9 fix 1087): the host the person picked, null until they do
  // (then the pane's own host, else This PC), and the two boxes that can be
  // open on it: Add a host… and Another folder… on a host.
  const [chosenHost, setChosenHost] = useState<string | null>(null);
  const [hostBox, setHostBox] = useState(false);
  const [folderBox, setFolderBox] = useState(false);
  const hostBoxRef = useRef(hostBox);
  hostBoxRef.current = hostBox;
  const folderBoxRef = useRef(folderBox);
  folderBoxRef.current = folderBox;
  // '' is This PC; a name the config has since forgotten reads as This PC too.
  const wantedHost = chosenHost ?? paneHost(layout, paneId) ?? '';
  const pickedHost = wantedHost !== '' && remoteHosts.some((h) => h.name === wantedHost) ? wantedHost : '';
  const remote = pickedHost === '' ? undefined : pickedHost;
  const pickedState = remote === undefined ? null : hosts.get(remote) ?? null;
  const pickedDaemon = useDaemonFor(remote);
  // M9 fix 1088: the host's setup, drawn while it runs, and the tick that moves its seconds.
  const setupRunning = pickedState?.state === 'setup' && pickedState.setup !== null && pickedState.setup.phase !== 'done' && pickedState.setup.phase !== 'failed';
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!setupRunning) return;
    setTick(Date.now());
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [setupRunning]);
  const [appVersion, setAppVersion] = useState('');
  const [hostNote, setHostNote] = useState<string | null>(null);
  const waiting = remote !== undefined && hostWaiting(pickedState?.state ?? 'connecting');
  // The shell the Shell tile starts (M9 fix 647): the stored id, read
  // against the installed shells on every render so a daemon that arrives
  // after mount is read; null is the daemon's default.
  const [storedShell, setStoredShell] = useState<ShellId | null>(() => loadEmptyPaneShell());
  const shells = installedShells(pickedDaemon);
  const pick = shellChoice(storedShell, shells);
  const [shellMenu, setShellMenu] = useState<{ x: number; y: number } | null>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostText, setHostText] = useState('');
  const [folderText, setFolderText] = useState('');

  // Capture phase: xterm stops propagation of keys it handles, and Escape
  // is one of them when the terminal still has focus. The root's
  // data-picker says whether the picker is open on this pane (M9 fix
  // 548), the one read verify:prefix's Escape step needs, since nothing
  // else on the page exposes the ui state.
  // Escape in the action mode (M9 fix 202) also empties the box, since in
  // an empty pane the box stays on screen and would keep listing actions.
  // The handler reads the query through a ref kept current on every render
  // and must not hold a closure over it (M9 fix 548): it used to be
  // registered again on every change of the mode, by a passive effect that
  // runs after the > is painted, and an Escape in between reached the old
  // listener, which closed the picker and left the box full of actions.
  // The path text and the tile pick (M9 fix 1010) are read the same way.
  const actionMode = isActionQuery(query);
  const queryRef = useRef(query);
  queryRef.current = query;
  const pathTextRef = useRef(pathText);
  pathTextRef.current = pathText;
  const tilePickRef = useRef(tilePick);
  tilePickRef.current = tilePick;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // M9 fix 589: the Escape that closes a menu is the menu's, so the box keeps its query and the picker stays.
      if (menuOpen()) return;
      // M9 fix 576: every mounted empty pane has this listener, every
      // layout tab's included, so an Escape is this pane's only when the
      // picker is open on it or the focus is inside it; the focus read
      // covers the overlay over a focused terminal and the empty pane's own
      // box. The ui state is read at call time, not from a closure, as fix
      // 548's comment above says.
      if (getUiState().pickerPaneId !== paneId && !(rootRef.current?.contains(document.activeElement) ?? false)) return;
      // M9 fix 1010: a path in the box is cleared first, and nothing closes.
      switch (escapeStep({ actionQuery: isActionQuery(queryRef.current), filePick: tilePickRef.current === 'file', pathText: pathTextRef.current, openBox: hostBoxRef.current || folderBoxRef.current })) {
        case 'leave-box':
          setHostBox(false);
          setFolderBox(false);
          setHostText('');
          setFolderText('');
          inputRef.current?.focus();
          return;
        case 'clear-path':
          setPathText('');
          setPathNote(null);
          pathRef.current?.focus();
          return;
        case 'clear-query-and-close':
          setQuery('');
          setHighlighted(0);
          onDone();
          return;
        case 'close':
          onDone();
          return;
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onDone, paneId]);

  // Take keyboard focus once on mount so keys stop reaching the terminal
  // under the overlay. The box is always there, since Enter, Tab and the
  // digits are read on it. Not on every render: a session push would
  // otherwise yank focus away from a terminal elsewhere.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Ctrl+J on a pane that is already empty: this is mounted already, so the
  // mount effect has run; the box takes focus when the picker opens on it.
  useEffect(() => {
    if (pickerPaneId === paneId) inputRef.current?.focus();
  }, [pickerPaneId, paneId]);

  // The open-actions key (M9 fix 202) opens the same box in its action
  // mode: the query starts with >, which is also what typing > first does.
  useEffect(() => {
    if (pickerPaneId === paneId && pickerActions) {
      setQuery(ACTION_PREFIX);
      setHighlighted(0);
    }
  }, [pickerPaneId, pickerActions, paneId]);

  // Home is the last resort for row 1, and only the main process knows it.
  useEffect(() => {
    if (!showSplits) return;
    let live = true;
    window.emerald
      .info()
      .then((info) => {
        if (live) {
          setHome(info.homeDir);
          setAppVersion(info.version);
        }
      })
      .catch((err: unknown) => console.warn('[emerald] info failed', err));
    return () => {
      live = false;
    };
  }, [showSplits]);

  const place = (sessionId: string, zone: DropZone | null) => {
    void placeSession(sessionId, paneId, zone)
      .then(onDone)
      .catch((err: unknown) => console.warn('[emerald] show failed', err));
  };
  // Shift splits side by side, Ctrl stacked, neither shows it here.
  const zoneFor = (ev: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): DropZone | null => (ev.shiftKey ? 'right' : isCtrlOrCmd(ev) ? 'bottom' : null);

  // The sidebar's order, exited group last, so the palette and the sidebar
  // agree on what comes first; the sessions waiting for a person ahead of
  // it all (M9 fix 201), in the order the jump key takes them.
  const ordered = orderRows(
    groupSessions(sessions.values(), sidebarOrder).flatMap((g) => g.sessions),
    attention.wanting,
  );
  const rows = rankSessions(ordered, query);
  const now = Date.now();
  // The palette is only ever seen with the panes on show, so the rows
  // read the layout tab as shown (M9 fix 269), and a pane the zoom hides
  // reads behind the Focus (fix 728).
  const shown = shownSessions(layout, true, zoomedPaneId);
  // The action mode (M9 fix 202): every key binding by its label, then
  // this pane's menu items no key reaches, the pane group only when the
  // pane has a session or a view (an empty pane's menu is the keys').
  const menuHandle = paneMenuOf(paneId);
  const paneForActions = menuHandle !== null && menuHandle.name() !== '' ? { name: menuHandle.name(), items: menuHandle.items() } : null;
  // Then, once something is typed, the empty pane's shells and the terminal
  // colours (M9 fix 768); the Shell rows only on the empty pane itself, under
  // the caret's own rule.
  const leaf = layout === null ? null : findPane(currentTab(layout), paneId);
  const paneSession = leaf?.sessionId == null ? undefined : sessions.get(leaf.sessionId);
  const actions = actionMode
    ? [
        ...actionRows(query, formatChord(currentPrefix()), paneForActions),
        ...pickRows(query, {
          shells: showSplits && shells.length > 1 ? shells : [],
          shell: (pick ?? shells[0])?.id ?? null,
          schemes: schemeState.schemes.map((sc) => sc.name),
          windowScheme: schemeState.current.name,
          session: paneSession === undefined ? null : { own: paneSession.scheme ?? null },
          addHost: showSplits,
        }),
      ]
    : [];
  const count = actionMode ? actions.length : rows.length;
  const current = Math.min(highlighted, Math.max(0, count - 1));
  const runRow = (row: ActionRow) => {
    // Add a remote host… (M9 fix 1087) empties the box and opens the host box.
    if (row.kind === 'host') {
      setQuery('');
      setHighlighted(0);
      setHostBox(true);
      return;
    }
    // A shell or scheme pick empties the box, so the empty pane's tile keys work at once.
    if (row.kind === 'shell' || row.kind === 'scheme') {
      setQuery('');
      setHighlighted(0);
    }
    onDone();
    if (row.kind === 'key') void runAction(row.action, 'menu').catch((err: unknown) => console.warn(`[emerald] ${row.action} failed`, err));
    else if (row.kind === 'pane') menuHandle?.run(row.run, row.shell);
    else if (row.kind === 'shell') {
      const o = shells.find((x) => x.id === row.shell);
      if (o !== undefined) pickShell(o);
    } else if (row.scope === 'window') {
      if (row.scheme !== null) setScheme(row.scheme);
    } else if (paneSession !== undefined) {
      void setSessionScheme(paneSession.id, row.scheme).catch((err: unknown) => console.warn('[emerald] set scheme failed', err));
    }
  };

  // The folders, row 1 the default, and which is selected. The folder
  // the pane was split from (M9 fix 546) can arrive a moment after mount,
  // since it is written once the split's edit resolves.
  const remoteHome = pickedState?.record.home ?? null;
  const folders = !showSplits || waiting
    ? []
    : remote === undefined
      ? folderRows({ split: splitFolder.get(paneId) ?? null, recent, home, picked })
      : folderRows({ split: paneHost(layout, paneId) === remote ? splitFolder.get(paneId) ?? null : null, recent: hostRecent(sessions.values(), remote), home: remoteHome, picked });
  const selectedIndex = selectedFolder === null ? 0 : Math.max(0, folders.findIndex((r) => normalizeFolder(r.folder) === normalizeFolder(selectedFolder)));
  const selected = folders[selectedIndex] ?? null;
  const filtering = query !== '';
  const refusal =
    remote === undefined || pickedState === null
      ? null
      : hostRefusal({ name: remote, os: pickedState.record.os, refusal: pickedState.refusal, setup: pickedState.setup, state: pickedState.state, claude: pickedState.daemon?.claude ?? null }, kind);

  const selectFolder = (folder: string) => {
    setSelectedFolder(folder);
    setError(null);
  };
  const [opensOn, setOpensOn] = useState<'terminal' | 'chat'>(loadClaudeOpensOn);
  const pickOpensOn = (face: 'terminal' | 'chat') => {
    setOpensOn(face);
    rememberClaudeOpensOn(face);
  };
  // Picking a host (M9 fix 1087): the folder state starts over, and a host not yet reached is contacted.
  const pickHost = (name: string) => {
    setChosenHost(name);
    setPicked(null);
    setSelectedFolder(null);
    setError(null);
    setFolderBox(false);
    if (name === '') return;
    const st = getState().hosts.get(name)?.state ?? null;
    if (st === null || st === 'idle' || st === 'refused') {
      void window.emerald.hostConnect(name).catch((err: unknown) => console.warn('[emerald] host connect failed', err));
    } else if (st === 'lost') window.emerald.hostTryNow(name);
  };
  // The refusal's button (M9 fix 1088).
  const refusalAct = (reason: string) => {
    if (remote === undefined) return;
    if (reason === 'ssh') pickHost(remote);
    else if (reason === 'setup') void window.emerald.hostConnect(remote).catch((err: unknown) => console.warn('[emerald] host connect failed', err));
    else if (reason === 'no-claude') {
      selectKind('shell');
      if (selected !== null) start('shell', selected.folder);
    } else if (reason === 'hostkey') {
      void window.emerald
        .request('session.spawn', { kind: 'shell', cwd: home ?? '', cols: 120, rows: 30 })
        .then(({ session }) => editTab((t) => setPaneSession(t, paneId, session.id), paneId).then(() => {
          typeInto(session.id, `ssh ${remote}\r`);
          onDone();
        }))
        .catch((err: unknown) => console.warn('[emerald] open shell failed', err));
    }
  };
  const addHost = () => {
    const text = hostText.trim();
    if (text === '') return;
    window.emerald
      .hostAdd(text)
      .then((added) => {
        setHostBox(false);
        setHostText('');
        setHostNote(null);
        pickHost(added.name);
      })
      .catch((err: unknown) => setHostNote(`Could not add ${text}: ${err instanceof Error ? err.message : String(err)}`));
  };
  const onRow = showSplits && onRowShown(remoteHosts.length, hostBox, tilePick);
  // M9 fix 1094: the sign-in of the host last read, asked when a host is picked with kind Claude and kept until the next answer, so a re-pick shows the last read until the new one lands.
  const [auth, setAuth] = useState<{ host: string; read: ClaudeAuth | null } | null>(null);
  const authWanted = onRow && remote !== undefined && wantsAuthRead(kind, tilePick, pickedState?.state ?? 'idle', pickedState?.daemon?.featureLevel ?? null);
  const authDaemonPid = pickedState?.daemon?.pid;
  useEffect(() => {
    if (!authWanted || remote === undefined) return;
    let live = true;
    window.emerald
      .request('claude.auth', {}, remote)
      .then((r) => {
        if (live) setAuth({ host: remote, read: r.auth });
      })
      .catch((err: unknown) => {
        console.warn('[emerald] claude.auth failed', err);
        if (live) setAuth({ host: remote, read: null });
      });
    return () => {
      live = false;
    };
  }, [authWanted, remote, authDaemonPid]);
  const selectKind = (k: EmptyKind) => {
    setKind(k);
    setTilePick(null);
    setError(null);
  };
  const openBrowser = () => {
    if (starting) return;
    void editTab((t) => setPaneView(t, paneId, { kind: 'browser', url: '' }), paneId).catch((err: unknown) => console.warn('[emerald] browser pane failed', err));
  };
  const browserTile = browserViewSupported(daemon);
  const fileTile = fileViewSupported(daemon);
  // M9 fix 990: a click on File picks it and never opens anything.
  const pickFile = () => {
    setTilePick('file');
    setError(null);
  };
  // Browse… puts the chooser's pick in the box; Enter or Shift+Enter then
  // says where it opens, as for a pasted path.
  const browse = () => {
    void window.emerald
      .pickFile(selected?.folder ?? null)
      .then((picked) => {
        if (picked === null) return;
        setPathText(picked);
        setPathNote(null);
        pathRef.current?.focus();
      })
      .catch((err: unknown) => console.warn('[emerald] pick file failed', err));
  };
  // The path box's file: here fills this pane with the file view, as
  // Browser fills it; tab opens it as a pinned tab and leaves the pane as
  // it is. A folder or a missing path is said on the line under the box,
  // which keeps its text.
  const openTyped = async (where: 'here' | 'tab') => {
    const clean = cleanPath(pathText);
    if (clean === '' || starting) return;
    const target = resolvePath(clean, selected?.folder ?? null);
    if (target === null) {
      setPathNote(`Path not found: ${clean}`);
      return;
    }
    const st = await window.emerald.files.stat(target);
    if ('error' in st) {
      setPathNote(`${st.error}: ${target}`);
      return;
    }
    if (st.kind === 'dir') {
      setPathNote(`A folder, not a file: ${target}`);
      return;
    }
    if (where === 'here') {
      void editTab((t) => setPaneView(focusPane(t, paneId), paneId, { kind: 'file', path: target }), paneId).catch((err: unknown) => console.warn('[emerald] file pane failed', err));
      return;
    }
    setPathText('');
    setPathNote(null);
    void openFileFromOutside(target).catch((err: unknown) => console.warn('[emerald] file tab failed', err));
  };
  const onPathKey = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      const to = nextTile('file', ev.shiftKey ? -1 : 1, { browser: browserTile, file: fileTile });
      if (to === 'browser' || to === 'file') setTilePick(to);
      else selectKind(to);
      if (to !== 'file') inputRef.current?.focus();
    } else if (ev.key === 'Enter' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) {
      ev.preventDefault();
      void openTyped(ev.shiftKey ? 'tab' : 'here');
    }
  };
  const start = (k: EmptyKind, folder: string) => {
    recordUse(k === 'shell' ? 'empty-start-shell' : 'empty-start-claude');
    if (k === 'claude') noteClaudeStart(paneId);
    if (starting) return;
    setStarting(true);
    setError(null);
    const run = k === 'shell' ? startShellIn(paneId, folder, pick?.id, remote) : startClaudeIn(paneId, folder, { chat: loadClaudeOpensOn() === 'chat', ...(remote === undefined ? {} : { host: remote }) });
    run
      .then(() => {
        setStarting(false);
        // The next empty pane starts on this kind (M9 fix 546); More…
        // writes nothing, since its dialog can start either.
        rememberEmptyPaneKind(k);
        onDone();
      })
      .catch((err: unknown) => {
        setStarting(false);
        const name = folderName(folder) === '' ? folder : folderName(folder);
        setError(`Could not start ${k === 'shell' ? 'shell' : 'Claude'} in ${name}: ${err instanceof Error ? err.message : String(err)}`);
      });
  };
  const other = () => {
    if (remote !== undefined) {
      setFolderBox(true);
      return;
    }
    void window.emerald
      .pickFolder(selected?.folder ?? null)
      .then((folder) => {
        if (folder === null) return;
        setPicked(folder);
        setSelectedFolder(null);
        setError(null);
      })
      .catch((err: unknown) => console.warn('[emerald] pick folder failed', err));
  };

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    // The empty pane's own keys, only while the box is empty: what to
    // start, and where.
    if (showSplits && query === '') {
      const act = emptyKey(ev, folders.length, onRow);
      if (act !== null) {
        ev.preventDefault();
        if (act.act === 'flip') {
          const to = nextTile(tilePick ?? kind, act.delta, { browser: browserTile, file: fileTile });
          if (to === 'browser' || to === 'file') setTilePick(to);
          else selectKind(to);
        } else if (act.act === 'host') {
          const names = ['', ...remoteHosts.map((h) => h.name)];
          const at = Math.max(0, names.indexOf(pickedHost));
          pickHost(names[moveHighlight(at, act.delta, names.length)] ?? '');
        } else if (tilePick !== null && (act.act === 'move' || act.act === 'row')) {
          // The Browser and File picks have no folder to move or choose.
        } else if (act.act === 'move') {
          const next = folders[moveHighlight(selectedIndex, act.delta, folders.length)];
          if (next !== undefined) selectFolder(next.folder);
        } else if (act.act === 'start') {
          if (browserPick) openBrowser();
          else if (filePick) pathRef.current?.focus();
          else if (selected !== null) start(kind, selected.folder);
        } else if (act.act === 'row') {
          const row = folders[act.index];
          if (row !== undefined) start(kind, row.folder);
        }
        return;
      }
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      setHighlighted(moveHighlight(current, ev.key === 'ArrowDown' ? 1 : -1, count));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (actionMode) {
        const row = actions[current];
        if (row !== undefined) runRow(row);
        return;
      }
      const row = rows[current];
      if (row !== undefined) place(row.session.id, zoneFor(ev));
    }
  };

  // Keeps the box's focus through a click on a tile or a folder row, so
  // Enter still reaches the box after one.
  const keepFocus = (ev: React.MouseEvent) => ev.preventDefault();

  // The Shell tile's caret (M9 fix 647): picks the shell the tile starts,
  // remembered at the pick, and never starts.
  const openShellMenu = () => {
    selectKind('shell');
    const r = caretRef.current?.getBoundingClientRect();
    setShellMenu(shellMenu !== null || r === undefined ? null : { x: r.left, y: r.bottom + 2 });
  };
  const pickShell = (o: (typeof shells)[number]) => {
    const next = o.id === shells[0]?.id ? null : o.id;
    setStoredShell(next);
    rememberEmptyPaneShell(next);
    selectKind('shell');
    setShellMenu(null);
  };

  // The box and the rows it filters: the lower block of the empty pane,
  // the whole of the overlay.
  const list = (
    <>
      {/* The placeholder gives from the tail in steps by the box's width (M9 fix 223): a native placeholder is one string and the last hint written, fix 202's "> for actions", was the first cut. The box is a size container and the CSS shows one of three forms; the long one is the input's title. With nothing running it is the one short form (M9 fix 545). */}
      <div className="palette-box">
        <input
          ref={inputRef}
          className="palette-input"
          type="text"
          data-mode={actionMode ? 'actions' : 'sessions'}
          title={ordered.length === 0 ? PLACEHOLDER_NONE : PLACEHOLDER_LONG}
          value={query}
          onChange={(ev) => {
            setQuery(ev.target.value);
            setHighlighted(0);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        {query === '' && (
          <span className="palette-placeholder" aria-hidden="true">
            {ordered.length === 0 ? (
              <span data-form="none">{PLACEHOLDER_NONE}</span>
            ) : (
              <>
                <span data-form="long">{PLACEHOLDER_LONG}</span>
                <span data-form="mid">{PLACEHOLDER_MID}</span>
                <span data-form="short">{PLACEHOLDER_SHORT}</span>
              </>
            )}
          </span>
        )}
      </div>
      {actionMode && actions.length === 0 && <div className="muted palette-none">No action matches</div>}
      {actionMode &&
        actions.map((r, i) => (
          <ActionPaletteRow
            key={actionKey(r)}
            row={r}
            // A heading above the first row of each group.
            heading={i === 0 || actionGroup(actions[i - 1]!) !== actionGroup(r) ? actionGroup(r) : null}
            highlighted={i === current}
            onHover={() => setHighlighted(i)}
            onPick={() => runRow(r)}
          />
        ))}
      {!actionMode && ordered.length > 0 && rows.length === 0 && <div className="muted palette-none">No session matches</div>}
      {!actionMode &&
        rows.map((r, i) => (
          <PaletteRow
            key={r.session.id}
            session={r.session}
            match={r.match}
            shown={shown.get(r.session.id)}
            wait={waitText(r.session, attention.wanting, now)}
            highlighted={i === current}
            // Where Enter goes, shown on the row while it is the target:
            // always in the overlay, and in the empty pane once typing
            // has taken Enter from the Start button.
            here={i === current && (!showSplits || filtering)}
            onHover={() => setHighlighted(i)}
            onPick={(ev) => place(r.session.id, zoneFor(ev))}
          />
        ))}
    </>
  );

  // The overlay (M9 fix 546): list first, since Ctrl+J and Ctrl+Shift+S
  // are jump keys; a start is one line at the foot, beside the pane,
  // which is what its Shell button does to a pane holding a session or a
  // view (M9 fix 448). An activity view has no folder, so the clause goes.
  if (!showSplits) {
    const own = paneFolder(paneId);
    const ownName = own === null ? null : folderName(own) === '' ? own : folderName(own);
    return (
      <div className="empty-pane" data-mode="overlay" data-picker={pickerPaneId === paneId ? 'open' : undefined} ref={rootRef} tabIndex={-1}>
        <div className="empty-list">
          <div className="empty-heading">Show an existing session</div>
          {list}
        </div>
        <div className="empty-spacer" />
        <div className="empty-row overlay-start">
          <span className="muted">{ownName === null ? 'Or start one beside' : `Or start one beside, in ${ownName}`}</span>
          <span className="empty-pair">
            <button className="secondary overlay-shell" onClick={() => void startShellHere(paneId).then(onDone).catch((err: unknown) => console.warn('[emerald] new shell failed', err))}>
              Shell
            </button>
            <span className="muted">{plainKeyFor('new-session')}</span>
          </span>
          <button className="secondary overlay-claude" onClick={() => openNewSession(paneId, { folder: own ?? lastFolder() ?? '', split: true })}>
            Claude session…
          </button>
        </div>
        {/* M9 fix 792: the corner × does what Escape does; a click beside the list does not close. */}
        <button
          className="picker-x"
          title="Close (Esc)"
          aria-label="Close"
          onMouseDown={keepFocus}
          onClick={() => {
            if (isActionQuery(queryRef.current)) {
              setQuery('');
              setHighlighted(0);
            }
            onDone();
          }}
        >
          ×
        </button>
      </div>
    );
  }

  const label = browserPick ? { head: 'Open web page', tail: '' } : filePick ? { head: 'Open file here', tail: '' } : selected === null ? { head: startHead(kind, pick), tail: hostTail(remote) } : startLabel(kind, selected.folder, pick, remote);
  return (
    <div className="empty-pane" data-mode="empty" data-filtering={filtering ? 'true' : undefined} data-picker={pickerPaneId === paneId ? 'open' : undefined} ref={rootRef} tabIndex={-1}>
      {/* The body holds the padding and the gaps, since the narrow rules
          ask the pane's width (M9 fix 546) and a container query cannot
          restyle the container itself. */}
      <div className="empty-body">
        {/* With nothing running anywhere this pane is the whole window, so it
            says so rather than looking like a pane that happens to be empty. */}
        {ordered.length === 0 && (
          <div className="empty-state">
            <div className="empty-title">No sessions</div>
            <div className="muted">Start a shell here, or a Claude session in a folder of your choice. Closing the last pane brings you back here.</div>
            <div className="muted">Right-click any pane for more, or the {skin === 'emerald' ? 'gem' : 'Z'} at the top left. Over a terminal it is Shift+right-click, since a plain one copies or pastes.</div>
          </div>
        )}
        {/* What kind: a click on Shell or Claude session selects and never starts; Browser opens the page at once, having no folder to choose. */}
        {/* The mouse's form of Enter (M9 fix 705): the first click of the pair has pressed the tile, and start's starting guard keeps a triple click to one start. */}
        <div className="empty-kinds" data-tiles={2 + (browserTile ? 1 : 0) + (fileTile ? 1 : 0)}>
          <KindTile kind="shell" pressed={tilePick === null && kind === 'shell'} glyph=">_" name="Shell" hint={plainKeyFor('new-session')} sub={shellSub(pick, shells)} title={tileTitle(selected?.folder ?? null)} onStart={() => { if (selected !== null) start('shell', selected.folder); }} onPick={() => selectKind('shell')} onMouseDown={keepFocus} caret={shells.length > 1 ? { ref: caretRef, open: shellMenu !== null, onOpen: openShellMenu } : undefined} />
          <KindTile kind="claude" pressed={tilePick === null && kind === 'claude'} glyph={skin === 'emerald' ? '◆' : '✳'} gem={skin === 'emerald'} name="Claude session" hint="Tab" sub="args and a first prompt under More…" title={tileTitle(selected?.folder ?? null)} onStart={() => { if (selected !== null) start('claude', selected.folder); }} onPick={() => selectKind('claude')} onMouseDown={keepFocus} />
          {browserTile && <KindTile kind="browser" pressed={browserPick} glyph="://" name="Browser" hint="" sub="a URL, a host or a search" onPick={openBrowser} onMouseDown={keepFocus} />}
          {fileTile && <KindTile kind="file" pressed={filePick} glyph="{}" name="File" hint="" sub="a path, pasted or typed" onPick={pickFile} onMouseDown={keepFocus} />}
        </div>
        {onRow && (
          <div className="empty-on-block">
            <div className="empty-on-head">
              <span className="muted empty-on-label">on</span>
              <span className="empty-on-keys">← → switch</span>
            </div>
            <div className="empty-on-row">
              {[{ name: '', destination: '' }, ...remoteHosts].map((h) => {
                const sub = h.name === '' ? null : hostSub(hosts.get(h.name)?.state ?? 'idle', h.name, kind === 'claude' && tilePick === null && auth?.host === h.name ? auth.read : null, Date.now());
                return (
                  <button key={h.name} className="secondary empty-host" data-host={h.name} aria-pressed={h.name === pickedHost} title={h.destination === '' ? undefined : h.destination} onMouseDown={keepFocus} onClick={() => pickHost(h.name)}>
                    <span className="empty-host-name">{h.name === '' ? 'This PC' : h.name}</span>
                    {sub !== null && <span className="empty-host-sub">{sub}</span>}
                  </button>
                );
              })}
              {hostBox ? (
                <>
                  <input
                    className="empty-host-box"
                    type="text"
                    spellCheck={false}
                    autoFocus
                    value={hostText}
                    onChange={(ev) => {
                      setHostText(ev.target.value);
                      setHostNote(null);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter') {
                        ev.preventDefault();
                        addHost();
                      }
                    }}
                  />
                  <div className="muted empty-host-note" data-error={hostNote !== null || undefined}>
                    {hostNote ?? 'An ssh destination, or a Host from ~/.ssh/config. Enter adds it, Esc leaves it.'}
                  </div>
                </>
              ) : (
                <button className="secondary empty-host-add" onMouseDown={keepFocus} onClick={() => setHostBox(true)}>
                  Add a host…
                </button>
              )}
            </div>
          </div>
        )}
        {shellMenu !== null && (
          <Menu
            x={shellMenu.x}
            y={shellMenu.y}
            onClose={() => setShellMenu(null)}
            className="shell-menu"
            data={{ 'pane-id': paneId }}
            anchor={caretRef.current}
            items={shells.map((o, i) => ({
              label: o.label,
              title: `${o.label}, ${o.file}`,
              hint: i === 0 ? 'default' : undefined,
              checked: (pick ?? shells[0])?.id === o.id,
              onClick: () => pickShell(o),
            }))}
          />
        )}
        {/* M9 fix 990: with File picked, a path box where the folders were. */}
        {filePick && (
          <div className="empty-path-block">
            <div className="empty-path-row">
              <input
                ref={pathRef}
                className="empty-path"
                type="text"
                spellCheck={false}
                placeholder="Paste a file's path. Enter opens it here, Shift+Enter in a tab."
                value={pathText}
                title={pathText === '' ? undefined : pathText}
                onChange={(ev) => {
                  setPathText(ev.target.value);
                  setPathNote(null);
                }}
                onKeyDown={onPathKey}
              />
              <button className="secondary empty-browse" onMouseDown={keepFocus} onClick={browse}>
                Browse…
              </button>
            </div>
            <div className="muted empty-path-note" data-error={pathNote !== null || undefined}>
              {pathNote ?? (selected === null ? '' : `A relative path starts in ${folderName(selected.folder) === '' ? selected.folder : folderName(selected.folder)}`)}
            </div>
          </div>
        )}
        {/* Which folder: row 1 is where a start would go now. */}
        {!filePick && folderBox && (
          <div className="empty-path-block">
            <div className="empty-path-row">
              <input
                className="empty-path empty-folder-path"
                type="text"
                spellCheck={false}
                autoFocus
                placeholder={`A folder on ${remote ?? ''}, as that machine spells it. Enter picks it.`}
                value={folderText}
                onChange={(ev) => setFolderText(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && folderText.trim() !== '') {
                    ev.preventDefault();
                    setPicked(folderText.trim());
                    setSelectedFolder(null);
                    setFolderText('');
                    setFolderBox(false);
                    inputRef.current?.focus();
                  }
                }}
              />
            </div>
          </div>
        )}
        {!filePick && !folderBox && (
          <div className="empty-in-block">
            <div className="muted empty-in">in</div>
            {waiting && <div className="muted empty-in-wait">{`The folders on ${remote ?? ''} show once it answers.`}</div>}
            <div className="empty-folders">
              {folders.map((r, i) => (
                <button
                  key={r.folder}
                  className="empty-folder"
                  data-folder={r.folder}
                  data-selected={i === selectedIndex ? 'true' : undefined}
                  title={`${r.folder}
Double-click to start here`}
                  onMouseDown={keepFocus}
                  onClick={() => selectFolder(r.folder)}
                  // The mouse's form of the digit keys (M9 fix 575): the first click
                  // of the pair has already selected the row, and start's
                  // starting guard keeps a triple click to one start; a Claude
                  // start is the plain one the Start button makes, not More...'s
                  // dialog.
                  onDoubleClick={() => start(kind, r.folder)}
                >
                  <span className="empty-folder-num">{i + 1}</span>
                  <span className="empty-folder-name">{folderName(r.folder) === '' ? r.folder : folderName(r.folder)}</span>
                  <span className="empty-folder-parent">{parentLabel(r.folder, home)}</span>
                  {r.note !== null && <span className="empty-folder-note">{r.note}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="empty-start-block">
          <div className="empty-row empty-start-row">
            <button
              className="empty-start"
              data-dim={waiting ? 'true' : undefined}
              disabled={browserPick ? starting : filePick ? pathText.trim() === '' || starting : selected === null || starting || waiting || (refusal?.reason === 'no-claude' && kind === 'claude')}
              onClick={() => (browserPick ? openBrowser() : filePick ? void openTyped('here') : selected !== null && start(kind, selected.folder))}
            >
              {/* One inline label, so the button's text reads as one line. */}
              <span className="empty-start-label">
                {label.head}
                <span className="empty-start-in">{label.tail}</span>
              </span>
              <span className="empty-start-key">⏎</span>
            </button>
            {!filePick && (
              <button className="empty-other" onClick={other}>
                Another folder…
              </button>
            )}
            {/* M9 fix 1009: Shift+Enter's tab open, said on the row once the placeholder is gone; the focus stays in the box. */}
            {filePick && (
              <button className="empty-other empty-open-tab" disabled={pathText.trim() === '' || starting} onMouseDown={keepFocus} onClick={() => void openTyped('tab')}>
                In a tab ⇧⏎
              </button>
            )}
            {kind === 'claude' && tilePick === null && (
              <button className="empty-more" onClick={() => openNewSession(paneId, { folder: selected?.folder ?? '', split: false, opensOn: true })}>
                More…
              </button>
            )}
            {/* The face the Claude session opens on (M9 fix 689), remembered at the click; More…'s dialog follows it too (M9 fix 723). */}
            {kind === 'claude' && tilePick === null && (
              <span className="empty-opens" role="group" aria-label="The view the session opens on">
                <span className="muted">opens on</span>
                <button
                  className="secondary empty-opens-terminal"
                  aria-pressed={opensOn === 'terminal'}
                  title="Open the session on its terminal, the Claude Code TUI"
                  onMouseDown={keepFocus}
                  onClick={() => pickOpensOn('terminal')}
                >
                  Terminal
                </button>
                <button
                  className="secondary empty-opens-chat"
                  aria-pressed={opensOn === 'chat'}
                  title="Open the session on the chat view; the terminal stays one click away"
                  onMouseDown={keepFocus}
                  onClick={() => pickOpensOn('chat')}
                >
                  Chat
                </button>
              </span>
            )}
          </div>
          {/* M9 fix 1132: the one-time offer after three splits a day each followed by a Claude start; Yes sets the split default and starts nothing here. */}
          {splitOfferPaneId === paneId && (
            <div className="empty-row empty-split-offer">
              <span className="muted empty-split-offer-text">Always start a Claude on a split?</span>
              <button
                className="secondary empty-split-offer-yes"
                onMouseDown={keepFocus}
                onClick={() => {
                  recordUse('set-split-kind');
                  setSplitKind('claude');
                  closeSplitOffer();
                }}
              >
                Yes
              </button>
              <button className="empty-split-offer-close" title="Keep splits empty" aria-label="Close" onMouseDown={keepFocus} onClick={closeSplitOffer}>
                ×
              </button>
            </div>
          )}
          {setupRunning && pickedState?.setup != null && (
            <div className="empty-setup">
              <div className="empty-setup-line">{`Setting up ${remote ?? ''}: copying emerald's daemon ${appVersion} there, the first time only`}</div>
              <div className="empty-setup-figure">{setupFigure(pickedState.setup.bytes, pickedState.setup.startedAt, tick)}</div>
              <div className="empty-setup-bar" />
              <button
                className="secondary empty-setup-cancel"
                onMouseDown={keepFocus}
                onClick={() => {
                  if (remote !== undefined) void window.emerald.hostCancelSetup(remote).catch((err: unknown) => console.warn('[emerald] cancel setup failed', err));
                  pickHost('');
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {refusal !== null && (
            <>
              <div className="empty-error" data-reason={refusal.reason}>
                {refusal.text}
              </div>
              {refusal.act !== null && (
                <button className="secondary empty-error-act" onMouseDown={keepFocus} onClick={() => refusalAct(refusal.reason)}>
                  {refusal.act}
                </button>
              )}
            </>
          )}
          {error !== null && <div className="empty-error">{error}</div>}
        </div>
        <div className="empty-spacer" />
        <div className="empty-list empty-lower">
          {ordered.length > 0 && <div className="empty-heading">Or show a running session</div>}
          {list}
        </div>
        {/* A button and its key stay on one line (M9 fix 124): the row wraps
            between the pairs, never between a button and the key after it,
            which read as the next button's key in a half-width pane. */}
        <div className="empty-row empty-foot">
          <span className="empty-pair">
            <button className="secondary empty-split-right" onClick={() => splitHere(paneId, 'row')}>
              Split right
            </button>
            <span className="muted empty-chord">{plainKeyFor('split-vertical')}</span>
          </span>
          <span className="empty-pair">
            <button className="secondary empty-split-down" onClick={() => splitHere(paneId, 'column')}>
              Split down
            </button>
            <span className="muted empty-chord">{plainKeyFor('split-horizontal')}</span>
          </span>
          {/* The foot's word form of the corner × (M9 fixes 103 and 704), beside the pane's other actions; neither is drawn on a tab's only pane, which has nothing to close. */}
          {!onlyPane && (
            <span className="empty-pair">
              <button className="secondary empty-close" onClick={() => hidePaneHere(paneId)}>
                Close pane
              </button>
              <span className="muted empty-chord">{plainKeyFor('close-pane')}</span>
            </span>
          )}
        </div>
      </div>
      {!onlyPane && (
        <button className="empty-x" title={`Close pane (${plainKeyFor('close-pane')})`} aria-label="Close pane" onMouseDown={keepFocus} onClick={() => hidePaneHere(paneId)}>
          ×
        </button>
      )}
    </div>
  );
}

// One of the kind tiles: the glyph, the name, the key that picks it
// and a line on what it starts.
function KindTile({ kind, pressed, glyph, gem, name, hint, sub, onPick, onMouseDown, caret, title, onStart }: { title?: string | undefined; onStart?: (() => void) | undefined; kind: EmptyTile; pressed: boolean; glyph: string; gem?: boolean | undefined; name: string; hint: string; sub: string; onPick: () => void; onMouseDown: (ev: React.MouseEvent) => void; caret?: { ref: React.RefObject<HTMLSpanElement | null>; open: boolean; onOpen: () => void } | undefined }) {
  return (
    <button className="empty-kind" data-kind={kind} aria-pressed={pressed} title={title} onMouseDown={onMouseDown} onClick={onPick} onDoubleClick={onStart}>
      <span className="empty-kind-top">
        <span className="empty-kind-glyph" data-glyphs={gem ? 'gem' : undefined}>
          {glyph}
        </span>
        <span className="empty-kind-name">{name}</span>
        {hint !== '' && (
          <span className="empty-kind-hint">
            <span className="empty-kind-key">{hint}</span>
          </span>
        )}
        {caret !== undefined && (
          // A span, not a button: a button inside the tile's button is invalid HTML.
          <span
            ref={caret.ref}
            className="empty-kind-caret"
            role="button"
            aria-haspopup="menu"
            aria-expanded={caret.open}
            title="Pick the shell this tile starts"
            onMouseDown={(ev) => ev.preventDefault()}
            onDoubleClick={(ev) => ev.stopPropagation()}
            onClick={(ev) => {
              ev.stopPropagation();
              caret.onOpen();
            }}
          >
            ▾
          </span>
        )}
      </span>
      <span className="empty-kind-sub">{sub}</span>
    </button>
  );
}

interface RowProps {
  session: SessionInfo;
  match: Match | null;
  shown: Shown | undefined;
  // How long the session has waited for a person, or null (M9 fix 201).
  wait: string | null;
  highlighted: boolean;
  // Whether Enter would show this row here now (M9 fix 545); the hint is
  // the CSS's, so the row's children stay what the scripts read.
  here: boolean;
  onHover: () => void;
  onPick: (ev: React.MouseEvent) => void;
}

function PaletteRow({ session, match, shown, wait, highlighted, here, onHover, onPick }: RowProps) {
  const state = describeState(session);
  const { remoteHosts } = useStore('remoteHosts');
  // The last column shows where the match is when it is not in the name,
  // so the letters typed are always on screen; otherwise the folder, as
  // before there was a filter.
  const detail = match !== null && match.field !== 'name' ? match : null;
  return (
    <button
      className={`session-row${highlighted ? ' highlighted' : ''}`}
      data-session-id={session.id}
      data-highlighted={highlighted ? 'true' : undefined}
      data-here={here ? 'true' : undefined}
      data-shown={shown?.place === 'focused' || shown?.place === 'shown' ? shown.place : undefined}
      data-color={session.color ?? undefined}
      style={colorStyle(session)}
      onMouseMove={onHover}
      onClick={onPick}
    >
      {/* The whole name in the title, since a narrow pane cuts it to an ellipsis (M9 fix 127). */}
      <span className="pane-name" title={session.name}>
        {match?.field === 'name' ? <Bold match={match} /> : session.name}
      </span>
      <span className="muted">
        {session.kind}
        {shown !== undefined && <span className="palette-shown"> {shownWords(shown, false)}</span>}
      </span>
      {hasState(session) && (
        <span className={`pane-state state-${state.tone}`}>
          {state.text}
          {wait !== null && <span className="palette-wait"> {wait}</span>}
        </span>
      )}
      {/* M9 fix 1089: between the state and the folder, so the kind and the folder keep their places among the children */}
      {session.host !== undefined && <HostChip name={session.host} destination={remoteHosts.find((h) => h.name === session.host)?.destination ?? session.host} />}
      <span className="muted" title={detail === null ? session.cwd : `${detail.field}: ${detail.text}`}>
        {detail === null ? session.cwd : <Bold match={detail} />}
      </span>
    </button>
  );
}

// One action (M9 fix 202): the label with the hits in bold, the chords or
// the pane's name at the right in the muted weight.
function ActionPaletteRow({ row, heading, highlighted, onHover, onPick }: { row: ActionRow; heading: string | null; highlighted: boolean; onHover: () => void; onPick: () => void }) {
  return (
    <>
      {heading !== null && <div className="palette-group">{heading}</div>}
      <button
        className={`action-row${highlighted ? ' highlighted' : ''}`}
        data-kind={row.kind}
        data-action={row.kind === 'key' ? row.action : row.kind === 'host' ? 'add-host' : undefined}
        data-run={row.kind === 'pane' ? row.run : undefined}
        data-shell={row.kind === 'pane' || row.kind === 'shell' ? row.shell : undefined}
        data-scope={row.kind === 'scheme' ? row.scope : undefined}
        data-scheme={row.kind === 'scheme' ? row.scheme ?? undefined : undefined}
        data-checked={(row.kind === 'shell' || row.kind === 'scheme') && row.checked ? 'true' : undefined}
        data-highlighted={highlighted ? 'true' : undefined}
        onMouseMove={onHover}
        onClick={onPick}
      >
        <span className="action-label">{row.match === null ? row.label : <Bold match={row.match} />}</span>
        <span className="muted action-detail">{row.detail}</span>
      </button>
    </>
  );
}

function Bold({ match }: { match: Match }) {
  return (
    <>
      {segments(match.text, match.indices).map((seg, i) => (seg.hit ? <b key={i}>{seg.text}</b> : <span key={i}>{seg.text}</span>))}
    </>
  );
}
