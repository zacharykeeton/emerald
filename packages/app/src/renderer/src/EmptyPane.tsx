import { useEffect, useRef, useState } from 'react';
import { hidePaneHere, paneFolder, placeSession, splitHere, startClaudeIn, startShellHere, startShellIn } from './actions.ts';
import type { DropZone } from './drop-zone-model.ts';
import { defaultKind, emptyKey, folderRows, nextTile, parentLabel, shellChoice, shellSub, startHead, startLabel } from './empty-pane-model.ts';
import { installedShells } from './daemon-model.ts';
import type { EmptyKind, EmptyTile } from './empty-pane-model.ts';
import { currentPrefix, runAction } from './keys.ts';
import { recordUse } from './use-record.ts';
import { formatChord, plainKeyFor } from './keys-model.ts';
import { describeState, folderName, groupSessions, hasState, setPaneView } from '@emerald/shared';
import type { SessionInfo, ShellId } from '@emerald/shared';
import { normalizeFolder } from './new-session-model.ts';
import { Menu, menuOpen } from './Menu.tsx';
import { ACTION_PREFIX, actionRows, isActionQuery, moveHighlight, orderRows, rankSessions, segments, waitText } from './palette-model.ts';
import type { ActionRow, Match } from './palette-model.ts';
import { paneMenuOf } from './pane-menus.ts';
import { lastFolder, loadRecent } from './recent-folders.ts';
import { colorStyle } from './session-color.ts';
import { shownSessions, shownWords } from './shown-sessions.ts';
import type { Shown } from './shown-sessions.ts';
import { useSkin } from './skin.ts';
import { browserViewSupported } from './daemon-model.ts';
import { editTab, useStore } from './store.ts';
import { getUiState, loadEmptyPaneKind, loadEmptyPaneShell, openNewSession, rememberEmptyPaneKind, rememberEmptyPaneShell, useUi } from './ui.ts';

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
export const PLACEHOLDER_LONG = 'Type to filter: name, folder, branch, last prompt. Enter shows it here, Shift+Enter beside, Ctrl+Enter below. > for actions.';
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
  const { sessions, layout, daemon } = useStore('sessions', 'layout', 'daemon');
  const { pickerPaneId, pickerActions, sidebarOrder, attention, splitFolder } = useUi();
  const skin = useSkin();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  // The split default, else the kind last started from an empty pane
  // (M9 fix 546), else a shell.
  const [kind, setKind] = useState<EmptyKind>(() => defaultKind(getUiState().splitKind, loadEmptyPaneKind()));
  // The Browser tile (M9 fix 666) is a pick Tab can land on, not a kind:
  // nothing is remembered of it and the folders do not apply.
  const [browserPick, setBrowserPick] = useState(false);
  // The folder the person moved the selection to, or null for row 1, so a
  // default row that arrives after mount is selected rather than pushed.
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [recent] = useState<string[]>(() => loadRecent());
  // The shell the Shell tile starts (M9 fix 647): the stored id, read
  // against the installed shells on every render so a daemon that arrives
  // after mount is read; null is the daemon's default.
  const [storedShell, setStoredShell] = useState<ShellId | null>(() => loadEmptyPaneShell());
  const shells = installedShells(daemon);
  const pick = shellChoice(storedShell, shells);
  const [shellMenu, setShellMenu] = useState<{ x: number; y: number } | null>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const actionMode = isActionQuery(query);
  const queryRef = useRef(query);
  queryRef.current = query;
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
      if (isActionQuery(queryRef.current)) {
        setQuery('');
        setHighlighted(0);
      }
      onDone();
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
        if (live) setHome(info.homeDir);
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
  const zoneFor = (ev: { shiftKey: boolean; ctrlKey: boolean }): DropZone | null => (ev.shiftKey ? 'right' : ev.ctrlKey ? 'bottom' : null);

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
  // read the layout tab as shown (M9 fix 269).
  const shown = shownSessions(layout, true);
  // The action mode (M9 fix 202): every key binding by its label, then
  // this pane's menu items no key reaches, the pane group only when the
  // pane has a session or a view (an empty pane's menu is the keys').
  const menuHandle = paneMenuOf(paneId);
  const paneForActions = menuHandle !== null && menuHandle.name() !== '' ? { name: menuHandle.name(), items: menuHandle.items() } : null;
  const actions = actionMode ? actionRows(query, formatChord(currentPrefix()), paneForActions) : [];
  const count = actionMode ? actions.length : rows.length;
  const current = Math.min(highlighted, Math.max(0, count - 1));
  const runRow = (row: ActionRow) => {
    onDone();
    if (row.kind === 'key') void runAction(row.action, 'menu').catch((err: unknown) => console.warn(`[emerald] ${row.action} failed`, err));
    else menuHandle?.run(row.run, row.shell);
  };

  // The folders, row 1 the default, and which is selected. The folder
  // the pane was split from (M9 fix 546) can arrive a moment after mount,
  // since it is written once the split's edit resolves.
  const folders = showSplits ? folderRows({ split: splitFolder.get(paneId) ?? null, recent, home, picked }) : [];
  const selectedIndex = selectedFolder === null ? 0 : Math.max(0, folders.findIndex((r) => normalizeFolder(r.folder) === normalizeFolder(selectedFolder)));
  const selected = folders[selectedIndex] ?? null;
  const filtering = query !== '';

  const selectFolder = (folder: string) => {
    setSelectedFolder(folder);
    setError(null);
  };
  const selectKind = (k: EmptyKind) => {
    setKind(k);
    setBrowserPick(false);
    setError(null);
  };
  const openBrowser = () => {
    if (starting) return;
    void editTab((t) => setPaneView(t, paneId, { kind: 'browser', url: '' }), paneId).catch((err: unknown) => console.warn('[emerald] browser pane failed', err));
  };
  const browserTile = browserViewSupported(daemon);
  const start = (k: EmptyKind, folder: string) => {
    recordUse(k === 'shell' ? 'empty-start-shell' : 'empty-start-claude');
    if (starting) return;
    setStarting(true);
    setError(null);
    const run = k === 'shell' ? startShellIn(paneId, folder, pick?.id) : startClaudeIn(paneId, folder);
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
      const act = emptyKey(ev, folders.length);
      if (act !== null) {
        ev.preventDefault();
        if (act.act === 'flip') {
          const to = nextTile(browserPick ? 'browser' : kind, act.delta, browserTile);
          if (to === 'browser') setBrowserPick(true);
          else selectKind(to);
        } else if (browserPick && (act.act === 'move' || act.act === 'row')) {
          // The Browser pick has no folder to move or choose.
        } else if (act.act === 'move') {
          const next = folders[moveHighlight(selectedIndex, act.delta, folders.length)];
          if (next !== undefined) selectFolder(next.folder);
        } else if (act.act === 'start') {
          if (browserPick) openBrowser();
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
            key={r.kind === 'key' ? `key:${r.action}` : `pane:${r.run}:${r.shell ?? ''}`}
            row={r}
            // A heading above the first row of each group.
            heading={i === 0 ? 'Keys' : r.kind === 'pane' && actions[i - 1]?.kind === 'key' ? 'Pane' : null}
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
      </div>
    );
  }

  const label = browserPick ? { head: 'Open web page', tail: '' } : selected === null ? { head: startHead(kind, pick), tail: '' } : startLabel(kind, selected.folder, pick);
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
            <div className="muted">Right-click any pane for more, or the {skin === 'emerald' ? 'gem' : 'Z'} at the top left.</div>
          </div>
        )}
        {/* What kind: a click on Shell or Claude session selects and never starts; Browser opens the page at once, having no folder to choose. */}
        <div className="empty-kinds" data-tiles={browserTile ? 3 : 2}>
          <KindTile kind="shell" pressed={!browserPick && kind === 'shell'} glyph=">_" name="Shell" hint={plainKeyFor('new-session')} sub={shellSub(pick, shells)} onPick={() => selectKind('shell')} onMouseDown={keepFocus} caret={shells.length > 1 ? { ref: caretRef, open: shellMenu !== null, onOpen: openShellMenu } : undefined} />
          <KindTile kind="claude" pressed={!browserPick && kind === 'claude'} glyph={skin === 'emerald' ? '✦' : '✳'} gem={skin === 'emerald'} name="Claude session" hint="Tab" sub="args and a first prompt under More…" onPick={() => selectKind('claude')} onMouseDown={keepFocus} />
          {browserTile && <KindTile kind="browser" pressed={browserPick} glyph="://" name="Browser" hint="" sub="a URL, a host or a search" onPick={openBrowser} onMouseDown={keepFocus} />}
        </div>
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
        {/* Which folder: row 1 is where a start would go now. */}
        <div className="empty-in-block">
          <div className="muted empty-in">in</div>
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
        <div className="empty-start-block">
          <div className="empty-row empty-start-row">
            <button className="empty-start" disabled={browserPick ? starting : selected === null || starting} onClick={() => (browserPick ? openBrowser() : selected !== null && start(kind, selected.folder))}>
              {/* One inline label, so the button's text reads as one line. */}
              <span className="empty-start-label">
                {label.head}
                <span className="empty-start-in">{label.tail}</span>
              </span>
              <span className="empty-start-key">⏎</span>
            </button>
            <button className="empty-other" onClick={other}>
              Another folder…
            </button>
            {kind === 'claude' && !browserPick && (
              <button className="empty-more" onClick={() => openNewSession(paneId, { folder: selected?.folder ?? '', split: false })}>
                More…
              </button>
            )}
          </div>
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
          {/* An empty pane has no title bar and so no × (M9 fix 103); the
              close lives here, beside the pane's other actions. */}
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
    </div>
  );
}

// One of the kind tiles: the glyph, the name, the key that picks it
// and a line on what it starts.
function KindTile({ kind, pressed, glyph, gem, name, hint, sub, onPick, onMouseDown, caret }: { kind: EmptyTile; pressed: boolean; glyph: string; gem?: boolean | undefined; name: string; hint: string; sub: string; onPick: () => void; onMouseDown: (ev: React.MouseEvent) => void; caret?: { ref: React.RefObject<HTMLSpanElement | null>; open: boolean; onOpen: () => void } | undefined }) {
  return (
    <button className="empty-kind" data-kind={kind} aria-pressed={pressed} onMouseDown={onMouseDown} onClick={onPick}>
      <span className="empty-kind-top">
        <span className="empty-kind-glyph" data-glyphs={gem ? 'gem' : undefined}>
          {glyph}
        </span>
        <span className="empty-kind-name">{name}</span>
        {hint !== '' && <span className="empty-kind-key">{hint}</span>}
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
        data-action={row.kind === 'key' ? row.action : undefined}
        data-run={row.kind === 'pane' ? row.run : undefined}
        data-shell={row.kind === 'pane' ? row.shell : undefined}
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
