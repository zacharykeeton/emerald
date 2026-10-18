import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LayoutTab, SessionInfo } from '@emerald/shared';
import { describeState, findPane, markKind, workingMotion } from '@emerald/shared';
import { closeLayoutTab, newTab, renameLayoutTab, showLayoutTab } from './actions.ts';
import { shadeablePanes } from './shade-model.ts';
import { plainKeyFor } from './keys-model.ts';
import { Menu } from './Menu.tsx';
import { RenameBox } from './RenameBox.tsx';
import { colorStyle } from './session-color.ts';
import { SessionMark } from './session-mark.tsx';
import { ClaudeStar } from './skin-star.tsx';
import { reviewFolder, reviewSessionId } from './review-model.ts';
import { folderName } from './files-model.ts';
import { ClockIcon, FileIcon, FolderIcon, GraphIcon, NewsIcon, PanesIcon, StatsIcon } from './icons.tsx';
import { fileViewSupported, tabsSupported } from './daemon-model.ts';
import { startDrag } from './pane-drag.ts';
import { describeEntry, entryAlive, stepHistory } from './focus-history.ts';
import { nextStop } from './focus-history-model.ts';
import { useStore } from './store.ts';
import { PANES, commitsFolder, dirtyMark, isDocument, isPreview, isTranscript, isWhatsNew, statsFolder, tabName } from './tabs-model.ts';
import { useEditStates } from './file-edits.ts';
import { useRunningShells } from './rates-store.ts';
import { clearZoom, closeAllTabs, closeFileTab, closeOtherTabs, liftPanes, moveTabKey, pinFileTab, revealInFiles, shadePanes, showTab, tabOrderFor, useUi } from './ui.ts';
import { layoutTabKey, layoutTabOf } from './tab-order.ts';
import { ARROW_REPEAT_DELAY_MS, ARROW_REPEAT_MS, pageTarget, stripCut, tabMark, tabWanting, wheelStep } from './tab-strip-model.ts';
import type { StripCut } from './tab-strip-model.ts';
import { startTabDrag } from './tab-drag.ts';

const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);

// The strip across the top, like Orca's: one tab per layout (M36), the one
// on show marked, then one per file open from the files rail, then a +
// that makes another layout tab (last since M9 fix 182). A layout tab renames from its menu or a double click
// and closes from its menu, its × or a middle click, which hides its
// panes and nothing else; the last one cannot close. The × or a middle
// click closes a file tab; the wheel scrolls the strip when it overflows,
// Shift+wheel too, and since M9 fix 616 an arrow at each cut edge pages it.
// Mousedown on a tab does not take keyboard focus, the switch itself
// decides where the keyboard goes (App.tsx). Since M9 fix 182 the tabs
// draw in the strip's own order (tab-order.ts), layout and file tabs
// mixed, and a tab picked up and moved along the strip lands where it is
// dropped; a press that does not move is the click it always was.
export function TabStrip() {
  const { tabs, tabTitles, attention, tabOrder, sessionDrag, zoomedPaneId } = useUi();
  // M9 fix 248: the files with unsaved edits, for the mark before the name.
  const edits = useEditStates();
  const dirty = new Set([...edits].filter(([, e]) => e.dirty).map(([k]) => k));
  const { layout, daemon, sessions } = useStore('layout', 'daemon', 'sessions');
  // M9 fix 627: the shells running output now, for a tab's shell mark.
  const runningShells = useRunningShells(sessions);
  // M9 fix 180: whether a file tab drags onto a pane, and the tab a
  // drag was released on, whose click is not a show.
  const filesDrag = fileViewSupported(daemon);
  const draggedTab = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ tab: LayoutTab; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const layoutTabs = layout?.tabs ?? [];
  const currentTabId = layout?.currentTabId ?? null;
  const layoutTabIds = layoutTabs.map((t) => t.id);
  // The order is read against the ui state's kept list, so the strip
  // re-renders when a move writes it (tabOrder is read for that alone).
  void tabOrder;
  const order = tabOrderFor(layoutTabIds);
  // filePath is the file a tab dropped on a pane would show (M9 fix 180):
  // the reorder drag hands the pointer over once it has left the strip,
  // and the pane drag starts from the strip's edge so it is under way at
  // once rather than four pixels later (its own threshold is measured
  // from the press it is given).
  const pickUp = (ev: React.MouseEvent<HTMLDivElement>, key: string, name: string, filePath: string | null = null) => {
    ev.preventDefault();
    draggedTab.current = null;
    // The × and the rename box are the tab's own controls, not handles.
    if (scrollRef.current === null || (ev.target instanceof Element && ev.target.closest('.tab-close, .tab-rename') !== null)) return;
    const strip = scrollRef.current;
    const onLeave =
      filePath === null
        ? undefined
        : (from: MouseEvent) => {
            const edge = new MouseEvent('mousedown', { clientX: from.clientX, clientY: strip.getBoundingClientRect().bottom, button: 0 });
            startDrag({ kind: 'view', view: { kind: 'file', path: filePath } }, edge, () => {
              draggedTab.current = filePath;
            });
            window.dispatchEvent(new MouseEvent('mousemove', { clientX: from.clientX, clientY: from.clientY }));
          };
    // A tab dragged anywhere is one the person means to keep (M9 fix 203).
    const pin = () => {
      if (filePath !== null) pinFileTab(filePath);
    };
    startTabDrag(
      strip,
      ev.currentTarget,
      key,
      name,
      ev.nativeEvent,
      (before) => {
        pin();
        moveTabKey(key, before, layoutTabIds);
      },
      onLeave === undefined
        ? undefined
        : (from) => {
            pin();
            onLeave(from);
          },
    );
  };

  // The active tab is brought into view when it changes, which matters
  // once the strip is wider than the window.
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('.tab[data-active]');
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tabs.active, currentTabId]);

  const onWheel = (ev: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (el === null) return;
    // The scroller scrolls itself on a horizontal delta, so deltaX counts
    // only from the chevrons, the arrows and the + (fix 616).
    const step = wheelStep(ev.deltaX, ev.deltaY, ev.shiftKey, el.contains(ev.target as Node));
    if (step === 0) return;
    el.scrollLeft += step;
  };
  const [cut, read] = useCutEdges(scrollRef, stripRef);
  // M9 fix 616: a press on an arrow pages once and keeps paging while held.
  // The arrows sit outside the scroller (so they stay put), are disabled
  // rather than removed on the side with nothing to show (so the tabs do
  // not jump), and scroll instantly with the cut read at once, since
  // nothing may wait on a scroll event.
  const stopRepeat = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRepeat.current?.(), []);
  const page = (side: 'start' | 'end'): boolean => {
    const el = scrollRef.current;
    if (el === null) return false;
    const base = el.getBoundingClientRect().left - el.scrollLeft;
    const slots = [...el.querySelectorAll<HTMLElement>('.tab[data-key]')].map((t) => {
      const r = t.getBoundingClientRect();
      return { left: r.left - base, right: r.right - base };
    });
    const before = el.scrollLeft;
    el.scrollLeft = pageTarget(slots, before, el.clientWidth, el.scrollWidth, side);
    read();
    return el.scrollLeft !== before;
  };
  const pressArrow = (ev: React.MouseEvent<HTMLButtonElement>, side: 'start' | 'end') => {
    ev.preventDefault();
    if (ev.button !== 0) return;
    stopRepeat.current?.();
    if (!page(side)) return;
    let delay: number | undefined;
    let timer: number | undefined;
    const stop = () => {
      window.clearTimeout(delay);
      window.clearInterval(timer);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
      stopRepeat.current = null;
    };
    stopRepeat.current = stop;
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
    delay = window.setTimeout(() => {
      timer = window.setInterval(() => {
        if (!page(side)) stop();
      }, ARROW_REPEAT_MS);
    }, ARROW_REPEAT_DELAY_MS);
  };
  const arrow = (side: 'start' | 'end') => (
    <button
      className="tab-strip-arrow"
      data-side={side}
      tabIndex={-1}
      disabled={cut !== 'both' && cut !== side}
      title={side === 'start' ? 'Scroll the tabs left (hold to keep going)' : 'Scroll the tabs right (hold to keep going)'}
      onMouseDown={(ev) => pressArrow(ev, side)}
    >
      {side === 'start' ? '◂' : '▸'}
    </button>
  );
  // A click on a layout tab shows it and comes back to the panes from a
  // file tab; the daemon's push moves the mark. M9 fix 702: a click on
  // the current tab while its zoom hides a pane that wants someone undoes
  // the zoom, the focus staying on the pane that was zoomed.
  const show = (tab: LayoutTab) => {
    showTab(PANES);
    if (tab.id !== currentTabId) void showLayoutTab(tab.id).catch(warn('switch tab'));
    else if (zoomedPaneId !== null && tabWanting(tab, true, zoomedPaneId, sessions, attention.wanting) !== undefined) clearZoom();
  };
  const rename = (tab: LayoutTab, name: string | null) => {
    setRenaming(null);
    if (name !== null && name !== '') void renameLayoutTab(tab.id, name).catch(warn('rename tab'));
  };
  const close = (tab: LayoutTab) => void closeLayoutTab(tab.id).catch(warn('close tab'));
  const layoutTab = (tab: LayoutTab) => {
    const current = tab.id === currentTabId;
    const focusedSession = focusedSessionOf(tab, sessions);
    const wanting = tabWanting(tab, current && tabs.active === PANES, current ? zoomedPaneId : null, sessions, attention.wanting);
    const mark = tabMark(tab, sessions, wanting, runningShells);
    return (
      <div
        key={tab.id}
        className="tab tab-panes"
        data-tab={PANES}
        data-tab-id={tab.id}
        data-key={layoutTabKey(tab.id)}
        data-current={current || undefined}
        data-active={(tabs.active === PANES && current) || undefined}
        data-pane-drop={(sessionDrag?.tabTarget != null && 'tabId' in sessionDrag.tabTarget && sessionDrag.tabTarget.tabId === tab.id) || undefined}
        data-attention={wanting}
        data-color={focusedSession?.color ?? undefined}
        style={focusedSession === undefined ? undefined : colorStyle(focusedSession)}
        title={layoutTabs.length > 1 ? `${tab.name} (Ctrl+B n and p switch)` : 'The panes'}
        onClick={() => show(tab)}
        onDoubleClick={() => setRenaming(tab.id)}
        onAuxClick={(ev) => {
          if (ev.button === 1 && layoutTabs.length > 1) close(tab);
        }}
        onContextMenu={(ev) => {
          ev.preventDefault();
          setTabMenu({ tab, x: ev.clientX, y: ev.clientY });
        }}
        onMouseDown={(ev) => pickUp(ev, layoutTabKey(tab.id), tab.name)}
      >
        {/* The mark first (M46), before the panes icon, so the eye finds the working mark at the edge; none on a tab with no session (M9 fix 220); the shell mark when the tab holds only shells or only its shells are active (M9 fix 627). */}
        {mark !== null && <SessionMark kind={mark.kind} tone={mark.kind === 'claude' ? mark.tone : undefined} working={mark.working} size="row" className="tab-mark" />}
        <PanesIcon />
        {renaming === tab.id ? (
          <RenameBox initial={tab.name} className="tab-rename" onDone={(name) => rename(tab, name)} />
        ) : (
          <span className="tab-name">{tab.name}</span>
        )}
        {layoutTabs.length > 1 && (
          <button
            className="tab-close"
            title="Close tab (the sessions keep running)"
            onClick={(ev) => {
              ev.stopPropagation();
              close(tab);
            }}
            onMouseDown={(ev) => ev.preventDefault()}
          >
            ×
          </button>
        )}
      </div>
    );
  };
  const fileTab = (path: string) => {
    // A review tab (M64) carries its session the way a pane title
    // does: the session's mark, its name and its colour as the bar.
    const reviewOf = reviewSessionId(path);
    const reviewed = reviewOf === null ? undefined : sessions.get(reviewOf);
    const reviewMark = reviewed === undefined ? null : { tone: describeState(reviewed).tone, working: workingMotion(reviewed) !== null };
    // A folder review (M9 fix 199) is named for its folder, with no
    // session's mark or colour.
    const reviewedFolder = reviewFolder(path);
    const name = reviewOf !== null ? `Review · ${reviewed?.name ?? reviewOf}` : reviewedFolder !== null ? `Review · ${folderName(reviewedFolder)}` : tabName(path, tabTitles);
    const mark = dirtyMark(path, dirty);
    return (
      <div
        key={path}
        className="tab tab-file"
        data-tab={path}
        data-key={path}
        data-dirty={mark !== null || undefined}
        data-review={reviewOf ?? undefined}
        // M9 fix 203: the preview tab's name is in italics, so the tab
        // the next rail click will reuse reads apart from the kept ones.
        data-preview={isPreview(tabs, path) || undefined}
        data-active={tabs.active === path || undefined}
        data-color={reviewed?.color ?? undefined}
        style={reviewed === undefined ? undefined : colorStyle(reviewed)}
        title={reviewOf !== null ? `Review of ${reviewed?.name ?? reviewOf}'s changes` : reviewedFolder !== null ? `Review of the changes in ${reviewedFolder}` : isPreview(tabs, path) ? `${path} (preview: the next single click in the rail opens here; double-click the tab or the row, or drag it, to keep it)` : path}
        // M9 fix 180: a file tab picked up and dropped on a pane shows
        // there; a document tab (a review, a commits or activity
        // document) has a kind of its own or none and only reorders.
        data-draggable={filesDrag && !isDocument(path) ? '' : undefined}
        onClick={() => {
          // The click that follows a drag released on the tab is not a show.
          if (draggedTab.current === path) {
            draggedTab.current = null;
            return;
          }
          showTab(path);
        }}
        // M9 fix 488: a double click on the tab keeps a preview, as the
        // rail's double click on the row does.
        onDoubleClick={() => pinFileTab(path)}
        onAuxClick={(ev) => {
          if (ev.button === 1) closeFileTab(path);
        }}
        onContextMenu={(ev) => {
          ev.preventDefault();
          setMenu({ path, x: ev.clientX, y: ev.clientY });
        }}
        onMouseDown={(ev) => pickUp(ev, path, name, filesDrag && !isDocument(path) ? path : null)}
      >
        {reviewMark !== null ? (
          <SessionMark kind={markKind(reviewed!)} tone={reviewMark.tone} working={reviewMark.working} size="row" className="tab-mark" />
        ) : commitsFolder(path) !== null ? (
          <GraphIcon />
        ) : statsFolder(path) !== null ? (
          <StatsIcon />
        ) : reviewedFolder !== null ? (
          <FolderIcon />
        ) : isWhatsNew(path) ? (
          <NewsIcon />
        ) : isDocument(path) ? (
          <ClockIcon />
        ) : isTranscript(path) ? (
          <ClaudeStar size={14} className="tab-icon" />
        ) : (
          <FileIcon />
        )}
        {mark !== null && (
          <span className="tab-dirty" title="Unsaved edits (Ctrl+S saves)">
            {mark}
          </span>
        )}
        <span className="tab-name">{name}</span>
        <button
          className="tab-close"
          title="Close (Ctrl+W)"
          onClick={(ev) => {
            ev.stopPropagation();
            closeFileTab(path);
          }}
          onMouseDown={(ev) => ev.preventDefault()}
        >
          ×
        </button>
      </div>
    );
  };
  return (
    <div className="tab-strip-box">
      <div className="tab-strip" ref={stripRef} onWheel={onWheel} data-active-tab={tabs.active}>
        <HistoryChevrons />
        {cut !== null && arrow('start')}
        <div className="tab-strip-clip">
          <div className="tab-strip-scroll" ref={scrollRef}>
            {order.map((key) => {
              const id = layoutTabOf(key);
              if (id === null) return fileTab(key);
              const tab = layoutTabs.find((t) => t.id === id);
              return tab === undefined ? null : layoutTab(tab);
            })}
          </div>
        </div>
        {/* M9 fix 182: the + sits after every tab, file tabs included, so with a dozen files open it is still the last thing on the strip. */}
        {layout !== null && tabsSupported(daemon) && (
          <button
            className="tab-add"
            data-pane-drop={(sessionDrag?.tabTarget != null && 'newTab' in sessionDrag.tabTarget) || undefined}
            title="New layout tab (Ctrl+B c)"
            onClick={() => void newTab().catch(warn('new tab'))}
            onMouseDown={(ev) => ev.preventDefault()}
          >
            +
          </button>
        )}
        {cut !== null && arrow('end')}
        {menu !== null && <TabMenu path={menu.path} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
        {tabMenu !== null && (
          <LayoutTabMenu
            tab={tabMenu.tab}
            last={layoutTabs.length === 1}
            x={tabMenu.x}
            y={tabMenu.y}
            onClose={() => setTabMenu(null)}
            onRename={() => setRenaming(tabMenu.tab.id)}
            onCloseTab={() => close(tabMenu.tab)}
          />
        )}
      </div>
    </div>
  );
}

// M9 fix 183: a strip wider than its box says so with a fade at each cut
// edge, as the upright gutter does (fix 141), so a tab past the edge shows
// as a tab half under a fade rather than nothing. data-cut on the strip is
// end, start or both for which edges hide something, read off scrollLeft
// and scrollWidth after every render (a tab opening or closing changes
// the width with no event of its own), on scroll and on a resize; the
// fades are the box's, so they stay put while the strip scrolls.
function useCutEdges(scroller: React.RefObject<HTMLDivElement | null>, row: React.RefObject<HTMLDivElement | null>): [StripCut, () => void] {
  const [cut, setCut] = useState<StripCut>(null);
  // The latest reader, for the page arrows' click, which runs between renders.
  const reader = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    const read = () => {
      // The arrows' own width is reserved so a strip that fits without
      // them does not flicker them in and out (fix 616).
      let reserve = 0;
      for (const a of row.current?.querySelectorAll<HTMLElement>('.tab-strip-arrow') ?? []) reserve += a.offsetWidth;
      const next = stripCut(el.scrollLeft, el.clientWidth, el.scrollWidth, reserve);
      if (next === null) delete el.dataset['cut'];
      else if (el.dataset['cut'] !== next) el.dataset['cut'] = next;
      setCut(next);
    };
    reader.current = read;
    read();
    el.addEventListener('scroll', read);
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', read);
      ro.disconnect();
    };
  });
  return [cut, () => reader.current()];
}

// M9 fix 184: back and forward through the focus history, at the strip's
// left end since the history crosses layout tabs and file tabs and the
// strip is the row that navigates among them. Each chevron is off when
// there is nothing that way and says where it would go otherwise.
function HistoryChevrons() {
  const { focusHistory, tabs, tabTitles } = useUi();
  const { layout, sessions } = useStore('layout', 'sessions');
  const stop = (step: 1 | -1) => nextStop(focusHistory, step, (e) => entryAlive(e, layout, tabs));
  const chevron = (step: 1 | -1) => {
    const i = stop(step);
    const entry = i === null ? undefined : focusHistory.entries[i];
    const word = step === -1 ? 'Back' : 'Forward';
    const title = entry === undefined ? `Nothing to go ${word.toLowerCase()} to` : `${word} to ${describeEntry(entry, layout, sessions, tabTitles)} (Ctrl+Alt+${step === -1 ? 'Left' : 'Right'})`;
    return (
      <button
        className="tab-history-step"
        data-action={step === -1 ? 'back' : 'forward'}
        disabled={entry === undefined}
        title={title}
        onClick={() => void stepHistory(step).catch(warn('focus history'))}
        onMouseDown={(ev) => ev.preventDefault()}
      >
        {step === -1 ? '‹' : '›'}
      </button>
    );
  };
  return (
    <div className="tab-history">
      {chevron(-1)}
      {chevron(1)}
    </div>
  );
}

// M9 fix 43: the active tab's top line takes the colour of the session
// in the tab's focused pane, as the focus ring does, so a glance at the
// strip says which session is up. An empty focused pane leaves the amber.
function focusedSessionOf(tab: LayoutTab, sessions: ReadonlyMap<string, SessionInfo>): SessionInfo | undefined {
  const pane = findPane(tab, tab.focusedPaneId);
  return pane === null || pane.sessionId === null ? undefined : sessions.get(pane.sessionId);
}

function TabMenu({ path, x, y, onClose }: { path: string; x: number; y: number; onClose: () => void }) {
  const done = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Menu
      x={x}
      y={y}
      onClose={onClose}
      className="tab-menu"
      data={{ path }}
      items={[
        { label: 'Close', hint: 'Ctrl+W', onClick: done(() => closeFileTab(path)) },
        { label: 'Close others', onClick: done(() => closeOtherTabs(path)) },
        { label: 'Close all', onClick: done(closeAllTabs) },
        { label: 'Reveal in Explorer', disabled: isDocument(path), onClick: done(() => void window.emerald.files.reveal(path).catch(warn('reveal'))), separator: true },
        // M9 fix 652: the tab right-clicked may not be the one on show, and
        // the rail roots at the file in front, so the tab is shown first.
        {
          label: 'Reveal in Files',
          title: 'Show this file in the Files rail, its folders opened',
          disabled: isDocument(path),
          onClick: done(() => {
            showTab(path);
            revealInFiles(path);
          }),
        },
        // M9 fix 370: the main process's clipboard, the route the rail,
        // the history panel and the folder heading's menu use (Sidebar.tsx
        // fix 345), rather than navigator.clipboard, which asks a
        // permission this menu's click does not carry.
        { label: 'Copy path', title: path, onClick: done(() => void window.emerald.clipboard.write(path).catch(warn('copy'))) },
      ]}
    />
  );
}

interface LayoutTabMenuProps {
  tab: LayoutTab;
  last: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onCloseTab: () => void;
}

// Rename and Close for a layout tab, and Shade all and Lift all (M63) for
// the panes of the tab, so a wall of sessions goes calm in one press. The
// close item is there but off on the last tab, so it can say why rather
// than vanish; the shade pair is off on a tab with no pane on a session.
function LayoutTabMenu({ tab, last, x, y, onClose, onRename, onCloseTab }: LayoutTabMenuProps) {
  const done = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const panes = shadeablePanes(tab);
  return (
    <Menu
      x={x}
      y={y}
      onClose={onClose}
      className="tab-menu layout-tab-menu"
      data={{ 'tab-id': tab.id }}
      items={[
        { label: 'Rename', onClick: done(onRename) },
        {
          label: 'Shade all',
          // M9 fix 844: the one chord does whichever of the two rows the tab needs.
          hint: plainKeyFor('shade-all'),
          disabled: panes.length === 0,
          title: panes.length === 0 ? 'No pane on a session' : 'Pull the shade over every pane of this tab',
          onClick: done(() => shadePanes(panes)),
          separator: true,
        },
        {
          label: 'Lift all',
          hint: plainKeyFor('shade-all'),
          disabled: panes.length === 0,
          title: panes.length === 0 ? 'No pane on a session' : 'Lift every shade on this tab',
          onClick: done(() => liftPanes(panes)),
        },
        {
          label: 'Close tab',
          disabled: last,
          title: last ? 'The last tab cannot close' : 'Hides its panes; the sessions keep running',
          onClick: done(onCloseTab),
          separator: true,
        },
      ]}
    />
  );
}
