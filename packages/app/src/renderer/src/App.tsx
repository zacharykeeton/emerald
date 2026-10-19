import { useEffect, useRef } from 'react';
import { allPanes, currentTab, findPane, windowsOf } from '@emerald/shared';
import { installAttention } from './attention.ts';
import { BrowserLayer } from './BrowserLayer.tsx';
import { CheatSheet, PrefixIndicator } from './CheatSheet.tsx';
import { DaemonBanner } from './DaemonBanner.tsx';
import { installExplorerDrop } from './explorer-drop.ts';
import { installExitToShell, openFileFromOutside, openFolderFromOutside } from './actions.ts';
import { FilesRail } from './FilesRail.tsx';
import { ActivityTab } from './ActivityView.tsx';
import { CommitsView } from './CommitsView.tsx';
import { StatsView } from './StatsView.tsx';
import { FileView } from './FileView.tsx';
import { ReviewTab } from './ReviewTab.tsx';
import { reviewFolder, reviewSessionId } from './review-model.ts';
import { useGitWatchRoots } from './git-watch.ts';
import { focusTerminal } from './focus.ts';
import { installFocusHistory } from './focus-history.ts';
import { HooksBanner } from './HooksBanner.tsx';
import { configurePrefix, installKeybindings } from './keys.ts';
import { installUseRecord, recordUse } from './use-record.ts';
import { outsideOpenUse } from './use-record-model.ts';
import { NewSessionDialog } from './NewSessionDialog.tsx';
import { UnsavedDialog } from './UnsavedDialog.tsx';
import { Sidebar } from './Sidebar.tsx';
import { SplitView } from './SplitView.tsx';
import { TabStrip } from './TabStrip.tsx';
import { TitleBar } from './TitleBar.tsx';
import { PANES, commitsFolder, isDocument, isWhatsNew, statsFolder } from './tabs-model.ts';
import { start, useStore } from './store.ts';
import { adoptWindowTabs, clearZoom, flashCornerNote, openWhatsNewOnStart, pruneChatPanes, pruneFontSizes, pruneShaded, pruneSplitFolders, pruneWindowTabs, useUi } from './ui.ts';
import { WhatsNewView } from './WhatsNewView.tsx';

export function App() {
  const { connected, layout, allLayout, windowId } = useStore('connected', 'layout', 'allLayout', 'windowId');
  const { zoomedPaneId, tabs } = useUi();
  const fileTab = tabs.active === PANES ? null : tabs.active;
  const firstTab = useRef(true);
  useGitWatchRoots();

  useEffect(() => {
    start();
    // The default prefix works from the first keystroke; the configured one
    // takes over as soon as the main process has read the file.
    void window.emerald
      .info()
      .then((info) => configurePrefix(info.config.prefixKey))
      .catch((err: unknown) => console.warn('[emerald] could not read the config', err));
    // The release notes open once per build (M9 fix 227), after the
    // kept tabs are up so the new tab lands last and active.
    openWhatsNewOnStart();
    const uninstallKeys = installKeybindings();
    const uninstallUseRecord = installUseRecord();
    const uninstallDrop = installExplorerDrop();
    // A file from outside (M9 fix 341): emmer open, or a launch with one, recorded apart (fix 700), or a folder from Explorer's menu (fix 853).
    const uninstallOpen = window.emerald.files.onOpen((path, pane, extra) => {
      const use = outsideOpenUse(extra);
      recordUse(use.name, use.from);
      void (extra.kind === undefined ? openFileFromOutside(path, pane, extra) : openFolderFromOutside(path, extra.kind)).catch((err: unknown) => console.warn('[emerald] open from outside failed', err));
    });
    return () => {
      uninstallKeys();
      uninstallUseRecord();
      uninstallDrop();
      uninstallOpen();
    };
  }, []);

  // The pulse and the chime for a session that needs someone (attention.ts).
  useEffect(() => installAttention(), []);
  // A Claude left with /exit drops its pane to a shell (M9 fix 813).
  useEffect(() => installExitToShell(), []);
  // Where the focus has been, for the strip's back and forward (M9 fix 184).
  useEffect(() => installFocusHistory(), []);
  // Design Mode's notes from main, for C and S (M9 fix 674).
  useEffect(() => window.emerald.design.onNote(flashCornerNote), []);

  // Zoom follows tmux: it ends when the zoomed pane closes or focus moves
  // to another pane, and survives everything else (a session swap, a
  // sidebar toggle).
  useEffect(() => {
    if (zoomedPaneId === null || layout === null) return;
    const tab = currentTab(layout);
    if (findPane(tab, zoomedPaneId) === null || tab.focusedPaneId !== zoomedPaneId) clearZoom();
  }, [layout, zoomedPaneId]);

  // A closed pane takes its text size with it; a pane in another tab is
  // still a pane, and so is a pane in another window (M9 fix 867), whose
  // window shares this profile's storage.
  useEffect(() => {
    if (allLayout === null) return;
    const live = new Set(allPanes(allLayout).map((p) => p.id));
    pruneFontSizes(live);
    pruneShaded(live);
    pruneChatPanes(live);
    pruneSplitFolders(new Set(allPanes(allLayout).filter((p) => p.sessionId === null && p.view === null).map((p) => p.id)));
    pruneWindowTabs(new Set(windowsOf(allLayout).map((w) => w.id)));
  }, [allLayout]);

  // This window's file tabs under its own key (M9 fix 867), once the main
  // process has said which window this page is.
  useEffect(() => {
    if (windowId !== null) adoptWindowTabs(windowId);
  }, [windowId]);

  // Coming back to the panes puts the keyboard in the focused terminal;
  // a file tab takes it itself (FileView). The first render is left
  // alone so startup focus stays what it was.
  useEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    if (fileTab === null) focusTerminal();
  }, [fileTab]);

  // The split view stays mounted under a file tab, hidden rather than
  // gone, so the terminals keep their state and their fit. Every layout
  // tab (M36) is mounted the same way, the ones not on show with the
  // hidden attribute, so a switch back is instant and nothing is refit
  // until it is shown (a hidden pane has no size and skips its refit). The
  // tab strip sits over the middle column only, as VS Code's editor tabs
  // do, so the sidebar and the files rail run the full height beside it.
  return (
    <div className="app">
      <TitleBar />
      {!connected && <div className="banner">Disconnected from emmerd, reconnecting</div>}
      <DaemonBanner />
      <HooksBanner />
      <div className="app-body">
        <Sidebar />
        <div className="app-center">
          <TabStrip />
          <div className="app-main">
            <div className="panes-view" data-hidden={fileTab !== null || undefined}>
              {layout === null ? (
                <div className="status">Connecting to emmerd</div>
              ) : (
                layout.tabs.map((tab) => (
                  <div key={tab.id} className="layout-tab" data-tab-id={tab.id} hidden={tab.id !== layout.currentTabId}>
                    <SplitView tab={tab} current={tab.id === layout.currentTabId} zoomedPaneId={tab.id === layout.currentTabId ? zoomedPaneId : null} />
                  </div>
                ))
              )}
              {/* Every browser pane's page (M9 fix 669), laid over its
                  pane from here so a split or a move keeps it; after the
                  tabs so it paints above them and under a file tab. */}
              <BrowserLayer />
            </div>
            {/* The review is keyed by its path (M9 fix 199): a session's tab
                and a folder's can be open side by side, and one component
                switching between them kept the first's pinned base, its
                selection and its Sent banner for the second. */}
            {fileTab !== null && (reviewSessionId(fileTab) !== null || reviewFolder(fileTab) !== null ? <ReviewTab key={fileTab} path={fileTab} /> : commitsFolder(fileTab) !== null ? <CommitsView path={fileTab} /> : statsFolder(fileTab) !== null ? <StatsView key={fileTab} path={fileTab} /> : isWhatsNew(fileTab) ? <WhatsNewView path={fileTab} /> : isDocument(fileTab) ? <ActivityTab path={fileTab} /> : <FileView path={fileTab} />)}
          </div>
        </div>
        <FilesRail />
      </div>
      <NewSessionDialog />
      <UnsavedDialog />
      <CheatSheet />
      <PrefixIndicator />
    </div>
  );
}
