import { useEffect, useRef, useState } from 'react';
import { focusPane, folderTitle, setPaneView } from '@emerald/shared';
import type { PaneView } from '@emerald/shared';
import { hidePaneHere, splitHere } from './actions.ts';
import { readScope } from './activity-scope.ts';
import { ActivityView } from './ActivityView.tsx';
import { BrowserView } from './BrowserView.tsx';
import { useBrowserPage } from './browser-layer.ts';
import { driveMark, useBrowserDrive } from './browser-drive-store.ts';
import { designTargetOf } from './design.ts';
import { FileView } from './FileView.tsx';
import { fileIcon } from './file-icons.ts';
import { folderName, parentPath } from './files-model.ts';
import { CommitsPanel } from './CommitsPanel.tsx';
import { EmptyPane } from './EmptyPane.tsx';
import { ClockIcon } from './icons.tsx';
import { Menu } from './Menu.tsx';
import { menuHint, viewPaneMenu } from './pane-menu-model.ts';
import type { PaneMenuRun } from './pane-menu-model.ts';
import { registerPaneMenu } from './pane-menus.ts';
import { recordUse } from './use-record.ts';
import { PANE_USE } from './use-record-model.ts';
import { PaneActions } from './Pane.tsx';
import { startDrag } from './pane-drag.ts';
import { viewName } from './show-model.ts';
import { editTab, useStore } from './store.ts';
import { graphRemotesSupported, graphScaleSupported, hereScopeSupported, panesScopeSupported, rowsFlagSupported, viewStateSupported } from './daemon-model.ts';
import { activityView } from './view-state.ts';
import type { ActivitySnapshot } from './view-state.ts';
import { closePicker, openFileTab, openPicker, toggleZoom, useUi } from './ui.ts';
import { defaultView } from './tabs-model.ts';

interface Props {
  paneId: string;
  view: PaneView;
  focused: boolean;
  onlyPane: boolean;
}

const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);

// A commits view back at the graph's defaults drops the field, so the
// record reads as it did before fix 178.
function withoutGraph(view: PaneView): PaneView {
  if (view.kind !== 'commits') return view;
  const { graph: _graph, ...rest } = view;
  return rest;
}

// A leaf of the split tree holding a view instead of a terminal (M52):
// the Commits panel pinned to a folder, so several repositories' graphs
// can sit side by side in one layout tab. The pane is a pane in every
// other way: it focuses on a press, zooms, splits, hides and closes
// through the same actions, and takes a dropped session on an edge. The
// folder is fixed at the drop and does not follow focus, which is what
// tells this from the rail's panel; Set folder changes it by hand. The
// title bar names the folder; the branch line inside the panel names the
// branch, off the log's own read of HEAD, since no session sits behind
// the pane to report one.
//
// M69: a second kind, the activity view of one window, the tab's body
// with its header inside the pane; ◀ ▶ and the unit picker rewrite the
// pane's own view, so the window is kept by the daemon like the folder.
// The title bar names the window the way the tab does.
//
// M9 fix 130: the commits pane is the graph alone. M66 put the day's
// strip above it, scoped to the folder, all or this tab, and M69 kept
// that; with a pane button on each of the rail's two sections the user
// wants each to open its own thing, so the strip stays in the rail and
// the activity pane. A commits view's `strip` field is still accepted
// from a layout on disk and read by nothing.
//
// M9 fix 180: a third kind, one file, the tab's body with its header
// inside the pane; the Rendered and Raw switch writes the pane's own
// record, so the view is kept by the daemon like the folder, and the
// header's x closes the pane. The title bar shows the file's icon, its
// name and its folder; the menu offers the same file as a tab.
//
// M9 fix 659: a fourth kind, a web page (BrowserView.tsx), its toolbar
// inside the pane; the title bar shows a globe, the page's title (else
// its host) and the URL. The title is the page's and is kept by the
// browser layer (fix 669), not on the record.
export function ViewPane({ paneId, view, focused, onlyPane }: Props) {
  const { pickerPaneId, zoomedPaneId, sessionDrag, splitKind, designPaneId } = useUi();
  // The layout and the sessions for Design Mode's target (fix 674).
  const { daemon, sessions, layout } = useStore('daemon', 'sessions', 'layout');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // M9 fix 128 folded the view's controls rows away behind a flag per
  // kind; M9 fix 179 makes it the pane's chrome, the title bar and the
  // controls together, on the view record, so it is one pane's and
  // survives with the layout. The menu on the bare box is the way back.
  // A file pane (M9 fix 180) keeps its chrome: its header is the tab's.
  const chrome = view.kind === 'file' || view.kind === 'browser' || view.chrome !== false;
  const setChrome = (shown: boolean) => {
    if (view.kind === 'file' || view.kind === 'browser') return;
    const { chrome: _chrome, ...rest } = view;
    void editTab((t) => setPaneView(t, paneId, shown ? rest : { ...rest, chrome: false }), paneId).catch(warn('chrome'));
  };
  const pickerOpen = pickerPaneId === paneId;
  const zoomed = zoomedPaneId === paneId;
  const dropZone = sessionDrag?.target?.paneId !== paneId ? null : sessionDrag.file ? 'file' : sessionDrag.target.zone;
  const onMouseDown = () => {
    if (focused) return;
    void editTab((t) => focusPane(t, paneId), paneId).catch(warn('focus'));
  };
  const folder = view.kind === 'commits' ? view.folder : null;
  const setFolder = () => {
    if (view.kind !== 'commits') return;
    void window.emerald
      .pickFolder(view.folder)
      .then((picked) => {
        if (picked === null) return;
        return editTab((t) => setPaneView(t, paneId, { ...view, folder: picked }), paneId);
      })
      .catch(warn('set folder'));
  };
  // M9 fix 178: the state the pane keeps on its record; on a daemon too
  // old to keep it the panel falls back to the shared prefs and the
  // activity view keeps its own for its life.
  const stateKept = viewStateSupported(daemon);
  // The scope read through readScope (M9 fix 250), so a record holding
  // M66's tab reads as panes.
  const activityState: ActivitySnapshot | undefined = view.kind === 'activity' ? { scope: readScope(view.scope), folder: view.folder ?? null, layers: view.layers ?? 'both' } : undefined;
  // The record's fields come from activityView (view-state.ts), the one
  // place that knows which scope needs a folder (M9 fix 250: panes does
  // not); the chrome flag rides along untouched.
  const setActivityState = (next: ActivitySnapshot) => {
    if (view.kind !== 'activity') return;
    void editTab((t) => setPaneView(t, paneId, { ...activityView(view.window, next), ...(view.chrome === undefined ? {} : { chrome: view.chrome }) }), paneId).catch(warn('activity state'));
  };
  const dragged = sessionDrag?.view ?? null;
  const dragging = dragged !== null && sameView(dragged, view);
  const file = view.kind === 'file' ? view : null;
  const page = view.kind === 'browser' ? view : null;
  // The page's title from the browser layer (M9 fix 669), so the title
  // row keeps it across a split that remounts this pane.
  const { title: pageTitle } = useBrowserPage(paneId);
  // emmer browser's mark (M9 fixes 672 and 673): who drives the page, or
  // whose commands the person's click or key paused.
  const drive = useBrowserDrive(paneId);
  const mark = page === null ? null : driveMark(drive);
  // Design Mode's target in the title (M9 fix 674), read on each render
  // so it follows a focus change on the tab.
  const designOn = page !== null && designPaneId === paneId;
  const designTargetId = designOn && layout !== null ? designTargetOf(paneId) : null;
  const designTargetName = designTargetId === null ? null : (sessions.get(designTargetId)?.name ?? designTargetId);
  const designChip = designTargetName === null ? 'Design Mode, no Claude session here' : `Design Mode → ${designTargetName}`;
  // The menu's items (M9 fix 202) are pane-menu-model's list, shared with
  // the action palette through the registry; this maps each to its
  // handler here.
  const runMenuItem = (run: PaneMenuRun): void => {
    recordUse(PANE_USE[run], 'menu');
    switch (run) {
      case 'open-as-tab':
        return file === null ? undefined : openFileTab(file.path);
      case 'toggle-chrome':
        return setChrome(!chrome);
      case 'split-right':
        return splitHere(paneId, 'row');
      case 'split-down':
        return splitHere(paneId, 'column');
      case 'zoom':
        return toggleZoom(paneId);
      case 'set-folder':
        return setFolder();
      case 'pick':
        return openPicker(paneId);
      case 'hide':
        return hidePaneHere(paneId);
      default:
        return;
    }
  };
  const menuItems = viewPaneMenu({ kind: view.kind, folder, zoomed, onlyPane, chrome, stateKept, splitKind });
  const menuHandle = useRef({ menuItems, runMenuItem, name: viewName(view) });
  menuHandle.current = { menuItems, runMenuItem, name: viewName(view) };
  useEffect(
    () =>
      registerPaneMenu(paneId, {
        name: () => menuHandle.current.name,
        items: () => menuHandle.current.menuItems,
        run: (run) => menuHandle.current.runMenuItem(run),
      }),
    [paneId],
  );
  return (
    <div
      className={focused ? 'pane focused' : 'pane'}
      data-pane-id={paneId}
      data-view={view.kind}
      data-folder={folder ?? undefined}
      data-window={view.kind === 'activity' ? view.window : undefined}
      data-chrome={chrome ? 'shown' : 'hidden'}
      data-path={file?.path}
      data-url={page?.url}
      onMouseDownCapture={onMouseDown}
      onContextMenu={(ev) => {
        ev.preventDefault();
        setMenu({ x: ev.clientX, y: ev.clientY });
      }}
    >
      {chrome && (
      <div
        className="pane-title"
        data-view={view.kind}
        data-dragging={dragging || undefined}
        // Picked up by its title like a terminal pane (M9 fix 73): the
        // drop closes this pane, so the view moves; the buttons keep
        // their own presses.
        onMouseDown={(ev) => {
          if (ev.button !== 0) return;
          const el = ev.target instanceof Element ? ev.target : null;
          if (el !== null && el.closest('button') !== null) return;
          startDrag({ kind: 'view', view }, ev.nativeEvent, () => {}, paneId);
        }}
      >
        <span className="pane-view-icon" aria-hidden="true">
          {view.kind === 'commits' ? (
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path d="M8 1.5v3.5M8 11v3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="8" cy="8" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : page !== null ? (
            <svg viewBox="0 0 16 16" width="14" height="14">
              <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <ellipse cx="8" cy="8" rx="2.8" ry="6.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.8 8h12.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : file !== null ? (
            <img className="pane-view-file-icon" src={fileIcon(folderName(file.path), 'file').url} width={14} height={14} alt="" draggable={false} />
          ) : (
            <ClockIcon className="pane-view-clock" />
          )}
        </span>
        {view.kind === 'commits' ? (
          <>
            <span className="pane-name" title={`Commits of ${view.folder}`}>
              {folderTitle(view.folder)}
            </span>
            <span className="pane-cwd">{view.folder}</span>
          </>
        ) : page !== null ? (
          <>
            <span className="pane-name" title={page.url === '' ? 'An empty browser pane' : page.url}>
              {pageTitle !== '' ? pageTitle : page.url !== '' ? new URL(page.url).host : 'Browser'}
            </span>
            {designOn && (
              <span className="design-target" title={designChip}>
                {designChip}
              </span>
            )}
            <span className="pane-cwd">{page.url}</span>
            {page.profile !== undefined && (
              <span className="browser-profile" title="Its own cookies and storage, apart from the other browser panes">
                profile {page.profile}
              </span>
            )}
            {mark !== null && drive !== null && (
              <span className={drive.paused ? 'browser-driven paused' : 'browser-driven'} title={mark.title}>
                {mark.text}
              </span>
            )}
            {drive?.paused === true && (
              <button
                className="browser-resume"
                aria-label="Resume"
                title={`Let ${drive.by} drive this page again`}
                // A press on a pane title focuses the pane and moves the
                // layout's revision (GOTCHAS of fixes 645 to 665, item 6).
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
                onClick={() => window.emerald.browser.resume(paneId)}
              >
                Resume
              </button>
            )}
          </>
        ) : file !== null ? (
          <>
            <span className="pane-name" title={file.path}>
              {viewName(file)}
            </span>
            <span className="pane-cwd">{parentPath(file.path)}</span>
          </>
        ) : (
          <span className="pane-name" title={`The activity of every session in this window`}>
            {viewName(view)}
          </span>
        )}
        <PaneActions paneId={paneId} onlyPane={onlyPane} session={undefined} folder={folder} view />
      </div>
      )}
      {menu !== null && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          className="pane-menu"
          data={{ 'pane-id': paneId }}
          items={menuItems.map((item) => ({
            label: item.label,
            hint: menuHint(item),
            disabled: item.disabled,
            title: item.title,
            separator: item.separator,
            onClick: () => {
              setMenu(null);
              runMenuItem(item.run);
            },
          }))}
        />
      )}
      {view.kind === 'commits' ? (
        // Focusable so a click here takes the keyboard from the terminal that had it; the ring already shows focus.
        <div className="pane-view" tabIndex={-1} data-view={view.kind}>
          <CommitsPanel
            folder={view.folder}
            branch={null}
            createdAt={null}
            tick={0}
            inPane
            rows={view.rows !== false}
            // M9 fix 162: the rows flag rides the pane's view record, so
            // only a daemon that keeps the field gets the button.
            onRows={rowsFlagSupported(daemon) ? (rows) => void editTab((t) => setPaneView(t, paneId, { ...view, rows }), paneId).catch(warn('commits rows')) : undefined}
            graph={stateKept ? (view.graph ?? {}) : undefined}
            zoom={graphScaleSupported(daemon)}
            remotes={graphRemotesSupported(daemon)}
            folded={!chrome}
            onFold={stateKept ? () => setChrome(false) : undefined}
            onGraph={stateKept ? (graph) => void editTab((t) => setPaneView(t, paneId, Object.keys(graph).length === 0 ? withoutGraph(view) : { ...view, graph }), paneId).catch(warn('commits state')) : undefined}
          />
        </div>
      ) : view.kind === 'file' ? (
        // The editor takes the keyboard itself; the view switch writes the
        // record, so it is kept like the folder and comes back after a
        // reload, the file's own default being the field's absence.
        <div className="pane-view" tabIndex={-1} data-view={view.kind}>
          <FileView
            path={view.path}
            view={view.view ?? defaultView(view.path) ?? 'raw'}
            onView={(next) => void editTab((t) => setPaneView(t, paneId, next === defaultView(view.path) ? { kind: 'file', path: view.path } : { ...view, view: next }), paneId).catch(warn('file view'))}
            onClose={() => hidePaneHere(paneId)}
            inPane
            paneId={paneId}
          />
        </div>
      ) : view.kind === 'browser' ? (
        // M9 fix 659: the page and its toolbar; the address bar writes the
        // record, so the pane comes back on its page after a reload.
        <div className="pane-view" tabIndex={-1} data-view={view.kind}>
          <BrowserView paneId={paneId} url={view.url} onUrl={(url) => void editTab((t) => setPaneView(t, paneId, { kind: 'browser', url }), paneId).catch(warn('browser url'))} />
        </div>
      ) : (
        // Focusable so a click here takes the keyboard from the terminal
        // that had it, and so Home reaches the view's own key handler.
        <div className="pane-view" tabIndex={-1} data-view={view.kind}>
          <ActivityView window={view.window} onShow={(next) => void editTab((t) => setPaneView(t, paneId, { ...view, window: next }), paneId).catch(warn('activity window'))} state={activityState} onState={stateKept ? setActivityState : undefined} folded={!chrome} onFold={stateKept ? () => setChrome(false) : undefined} panesScope={panesScopeSupported(daemon)} paneId={paneId} hereScope={hereScopeSupported(daemon)} />
        </div>
      )}
      {pickerOpen && (
        <div className="picker-overlay">
          <EmptyPane paneId={paneId} onDone={closePicker} />
        </div>
      )}
      {dropZone !== null && <div className="drop-overlay" data-drop-zone={dropZone} />}
    </div>
  );
}

// Whether a dragged view is this pane's, so the title dims while its own
// view is in the air.
function sameView(a: PaneView, b: PaneView): boolean {
  if (a.kind === 'commits') return b.kind === 'commits' && a.folder === b.folder;
  if (a.kind === 'activity') return b.kind === 'activity' && a.window === b.window;
  if (a.kind === 'browser') return b.kind === 'browser' && a.url === b.url && a.profile === b.profile;
  return b.kind === 'file' && a.path === b.path;
}
