import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { SavedPrompt, SessionInfo } from '@emerald/shared';
import { ackIfDone, clearExited, killSession, newGroupTab, openViewBeside, removeSession, renameSession, resumeAll, resumeSession, roomBesideFocused, sendPrompt, setSessionComment, showSession, showSessionBeside, showSessionInNewTab, setFolderLabel, startShellBeside, startShellBesideFocused, sweepSessions } from './actions.ts';
import { NEEDS_INPUT_WORD, activityText, agentLineText, compactPercent, contextPercentText, contextText, contextWords, describeState, formatUsd, hasState, needsInputWords, resumeTitle, shellCommand, stateMarker, tasksText, tokensRowText, workingMotion } from '@emerald/shared';
import { EXITED_GROUP, SIDEBAR_ORDERS, currentTab, folderRollup, folderTitle, formatDuration, groupSessions, markKind, memberLine, memberParts, modelWord, paneShowingIn, rollup, sessionsOnPanes, teamCounts } from '@emerald/shared';
import type { SessionGroup, SidebarOrder } from '@emerald/shared';
import { AnswerBadge } from './AnswerPopover.tsx';
import { ContextReading } from './ContextPopover.tsx';
import { useAgentsRunning, useAgentsRunningBeat } from './agents-running.ts';
import { runningFigure } from './agents-running-model.ts';
import { TasksReading } from './TasksPopover.tsx';
import { folderLabelsSupported, otherShells, viewStateSupported, viewsSupported } from './daemon-model.ts';
import { Menu } from './Menu.tsx';
import type { MenuItem } from './Menu.tsx';
import { useFolderChangeCount } from './git-changes-hook.ts';
import { sweepCounts, sweepLabel, sweepTitle } from './group-sweep-model.ts';
import { startSessionDrag } from './pane-drag.ts';
import { PromptBox } from './PromptBox.tsx';
import { historyEntries, loadRecentPrompts, rememberPromptSent } from './prompt-history.ts';
import type { HistoryEntry } from './prompt-history.ts';
import { promptsSupported } from './daemon-model.ts';
import { RenameBox } from './RenameBox.tsx';
import { colorStyle, colorSwatches } from './session-color.ts';
import { dialStyle } from './usage-model.ts';
import { shownData, shownSessions, shownWords } from './shown-sessions.ts';
import { SessionMark } from './session-mark.tsx';
import { HeadingUnits, RosterUnits } from './roster.tsx';
import { liveSamples, rateText, shellMarkTitle, shellRunning } from './session-mark-model.ts';
import { useRates, useRunningShells } from './rates-store.ts';
import { STALLED_TITLE } from './prompt-model.ts';
import { useSqueeze } from './squeeze.ts';
import type { Shown } from './shown-sessions.ts';
import { useStore } from './store.ts';
import { TurnLineAnchor } from './TurnCard.tsx';
import { UsageStrip } from './UsageStrip.tsx';
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, cycleAttentionSound, markSessionUnread, openFileTab, setSessionHushed, openNewSession, openReviewTab, openTranscriptTab, setAttentionNotify, setAttentionSound, setShowOffscreen, setSidebarFilter, setSidebarOrder, setSidebarWidth, setUsageRecord, toggleSidebar, toggleSidebarFold, toggleTeamUnfold, useUi } from './ui.ts';
import { useNow } from './use-now.ts';
import { FOLDER_LABEL_MAX, LOAD_SPAN_MS, Limits, loadCeiling, loadPeak } from '@emerald/shared';
import { SIDEBAR_FILTERS, emptyFilterText, filterCounts, filterGroups } from './sidebar-filter-model.ts';
import { wouldReplace } from './show-model.ts';
import type { ShowOffscreen } from './show-model.ts';
import type { FilterCounts, SidebarFilter } from './sidebar-filter-model.ts';
import { canMarkUnread, attentionState, waitOverlay } from './attention-model.ts';
import type { AttentionSound } from './attention-model.ts';
import type { ChimeMode } from '../../preload/api.ts';
import { PanesIcon } from './icons.tsx';
import { HushButton, SpeakerIcon } from './HushButton.tsx';
import { RollingFigure } from './RollingFigure.tsx';
import { plainKeyFor } from './keys-model.ts';
import { PANES, commitsPath } from './tabs-model.ts';
import { commitsQuery, commitsView, readRailCommits } from './view-state.ts';
import { useChangedCount } from './ReviewTab.tsx';
import { TokensText } from './TokensText.tsx';
import { LoadMark } from './LoadMark.tsx';
import { ConflictMark } from './ConflictMark.tsx';
import { conflictLines } from './conflict-model.ts';

// Every session the daemon knows, grouped by the folder it is in, in the
// order they were made (or most urgent first, from the heading's menu).
// The badge text and colour come from describeState so a row and the pane
// title never disagree. Clicking a row shows the session in the focused
// pane, or jumps to the pane already showing it.
export function Sidebar() {
  const { sessions, layout, daemon, folders } = useStore('sessions', 'layout', 'daemon', 'folders');
  // The shell sessions running a command (M46), by their output rate,
  // for the headings' units: one Set for every heading, held while its
  // members are the same (M9 fix 354). Above the collapsed rail's early
  // return, since it is a hook.
  const runningShells = useRunningShells(sessions);
  // The forks' spend behind the rows' dollars (M9 fix 277), on its beat.
  useAgentsRunningBeat(sessions.values());
  const { sidebarCollapsed, sidebarWidth, sidebarOrder, sidebarFilter, showOffscreen, tabs } = useUi();
  const now = useNow();
  // The scale every row's load sparkline shares (M9 fix 302): off each
  // listed session's five-minute peak, once a second at most with the
  // clock and only when the peaks change, so the lines do not breathe.
  const peaksKey = [...sessions.values()].map((s) => loadPeak(s.load, LOAD_SPAN_MS, now)).join(',');
  const ceiling = useMemo(() => loadCeiling(peaksKey === '' ? [] : peaksKey.split(',').map(Number)), [peaksKey]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // The chooser under a row whose click would push the focused pane's
  // live session off screen (M9 fix 91): show it there anyway, or open a
  // pane beside; remember is the tick that makes the answer stick.
  const [chooser, setChooser] = useState<{ sessionId: string; replacing: string; view: boolean; x: number; y: number; remember: boolean } | null>(null);
  // The heading's right-click menu, with the order setting.
  const [orderMenu, setOrderMenu] = useState<{ x: number; y: number } | null>(null);
  // A right click on a folder heading's +: the Claude choice for that folder.
  const [addMenu, setAddMenu] = useState<{ folder: string; x: number; y: number } | null>(null);
  // A right click on the heading itself (M9 fix 193): the sweep over
  // every session under it, by the group's key.
  const [groupMenu, setGroupMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // The folder heading whose label is being typed (M9 fix 194), by the
  // group's key; the same box as a row's rename.
  const [labelling, setLabelling] = useState<string | null>(null);
  // The row whose comment is being typed, in the same inline box as a rename.
  const [commenting, setCommenting] = useState<string | null>(null);
  // The row a prompt is being typed for (M56), with the refusal to show
  // under the box when the send was not allowed.
  const [prompting, setPrompting] = useState<{ sessionId: string; error: string | null } | null>(null);
  // What the box's arrows cycle: the daemon's saved prompts, read when the
  // box opens (and again after a save), then this window's recent ones.
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const canSave = promptsSupported(daemon);
  const promptingId = prompting?.sessionId ?? null;
  useEffect(() => {
    if (promptingId === null || !canSave) return;
    let live = true;
    void window.emerald
      .request('prompts.list', {})
      .then(({ prompts }) => {
        if (live) setSavedPrompts(prompts);
      })
      .catch((err: unknown) => console.warn('[emerald] prompts.list failed', err));
    return () => {
      live = false;
    };
  }, [promptingId, canSave]);
  const promptHistory: HistoryEntry[] = promptingId === null ? [] : historyEntries(savedPrompts, loadRecentPrompts());
  // Collapsed leaves a thin rail with the one button that brings it back,
  // so the sidebar is never a chord away from being lost.
  if (sidebarCollapsed) {
    return (
      <div className="sidebar-rail">
        <button className="sidebar-expand" title="Show sidebar (Ctrl+Shift+B)" onClick={toggleSidebar} onMouseDown={(ev) => ev.preventDefault()}>
          »
        </button>
        <span className="sidebar-rail-label" onClick={toggleSidebar}>
          Sessions
        </span>
      </div>
    );
  }
  // The chips filter what groupSessions gave (M44): rows drop, headings
  // and the order stay, and the counts on the chips are of every session.
  // The unshown chip (M9 fix 249) reads the sessions on a pane of any
  // tab, the same set the rows' "on no pane" word and the headings' count
  // read.
  const allGroups = groupSessions(sessions.values(), sidebarOrder, folders);
  const onPanes: ReadonlySet<string> = layout === null ? new Set() : sessionsOnPanes(layout);
  const groups = filterGroups(allGroups, sidebarFilter, onPanes);
  const counts = filterCounts(sessions.values(), onPanes);
  // With a file or view tab in front (M9 fix 269) no pane is on screen,
  // so every row on the current tab reads on that tab, as one a tab away.
  const shown = shownSessions(layout, tabs.active === PANES);
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  const showHere = (id: string) => void showSession(id).then(() => ackIfDone(id)).catch(warn('show'));
  const showBeside = (id: string) => void showSessionBeside(id).then(() => ackIfDone(id)).catch(warn('show beside'));
  const showInTab = (id: string) => void showSessionInNewTab(id).then(() => ackIfDone(id)).catch(warn('show in a new tab'));
  // A click on a row: beside with Shift held; else, when the session is
  // on no pane and a live one, or a view (M9 fix 95), sits in the focused
  // pane, whatever was remembered, or the chooser under the row while
  // nothing is.
  const onShow = (id: string, shift: boolean, rect: DOMRect) => {
    if (shift) return showBeside(id);
    const replacing = wouldReplace(layout, sessions, id);
    if (replacing === null || showOffscreen === 'replace') return showHere(id);
    if (showOffscreen === 'beside') return showBeside(id);
    const replacingName = replacing.kind === 'view' ? replacing.name : (sessions.get(replacing.sessionId)?.name ?? replacing.sessionId);
    setChooser({ sessionId: id, replacing: replacingName, view: replacing.kind === 'view', x: rect.left + 24, y: rect.bottom, remember: false });
  };
  const onScreen = (id: string) => layout !== null && paneShowingIn(layout, id, layout.currentTabId) !== null;
  return (
    <div className="sidebar" style={{ width: sidebarWidth }}>
      <div
        className="sidebar-header"
        data-order={sidebarOrder}
        title="Right click for the order of the rows"
        onContextMenu={(ev) => {
          ev.preventDefault();
          setOrderMenu({ x: ev.clientX, y: ev.clientY });
        }}
      >
        <span>Sessions</span>
        <button className="sidebar-collapse" title="Hide sidebar (Ctrl+Shift+B)" onClick={toggleSidebar}>
          «
        </button>
      </div>
      <FilterChips filter={sidebarFilter} counts={counts} />
      <div className="sidebar-list">
        {groups.length === 0 && <div className="sidebar-empty">{emptyFilterText(sidebarFilter)}</div>}
        {/* With nothing running at all (M9 fix 172) the list offers the empty
            pane's two starts, since a view pane in the only pane has a split
            button and nothing else that reads as a way to a session; a chip's
            empty has sessions behind it and offers nothing. Each goes beside
            the focused pane, so a view on show is split, not replaced. */}
        {groups.length === 0 && sidebarFilter === 'all' && (
          <div className="sidebar-empty-actions">
            <span className="empty-pair">
              <button className="empty-new" onClick={() => void startShellBesideFocused().catch(warn('shell from the empty sidebar'))}>
                New shell
              </button>
              <span className="muted">{plainKeyFor('new-session')}</span>
            </span>
            <button className="secondary empty-claude" onClick={() => void roomBesideFocused().then((paneId) => openNewSession(paneId)).catch(warn('Claude session from the empty sidebar'))}>
              Claude session
            </button>
          </div>
        )}
        {groups.map((g) => (
          <Group
            key={g.key}
            group={g}
            now={now}
            loadCeiling={ceiling}
            runningShells={runningShells}
            shown={shown}
            onPanes={onPanes}
            renaming={renaming}
            commenting={commenting}
            prompting={prompting}
            promptHistory={promptHistory}
            onSavePrompt={
              canSave
                ? (name, text) =>
                    void window.emerald
                      .request('prompts.set', { name, text })
                      .then(() => window.emerald.request('prompts.list', {}))
                      .then(({ prompts }) => setSavedPrompts(prompts))
                      .catch(warn('save prompt'))
                : null
            }
            onCommented={(id, comment) => {
              setCommenting(null);
              if (comment !== null) void setSessionComment(id, comment).catch(warn('set comment'));
            }}
            onPrompted={(id, text) => {
              if (text === null) {
                setPrompting(null);
                return;
              }
              void sendPrompt(id, text)
                .then((outcome) => {
                  if (outcome.kind === 'sent') rememberPromptSent(text);
                  setPrompting(outcome.kind === 'sent' ? null : { sessionId: id, error: outcome.reason });
                })
                .catch(warn('send prompt'));
            }}
            onShow={onShow}
            onResume={(id) => void resumeSession(id).catch(warn('resume'))}
            onMenu={(id, x, y) => setMenu({ sessionId: id, x, y })}
            onAdd={(folder) => void startShellBeside(folder).catch(warn('shell from the heading'))}
            onAddMenu={(folder, x, y) => setAddMenu({ folder, x, y })}
            onGroupMenu={(key, x, y) => setGroupMenu({ key, x, y })}
            labelling={labelling}
            canLabel={folderLabelsSupported(daemon)}
            onLabel={setLabelling}
            onLabelled={(key, label) => {
              setLabelling(null);
              if (label !== null) void setFolderLabel(key, label).catch(warn('folder label'));
            }}
            onGroupTab={(name, ids) => void newGroupTab(name, ids).catch(warn('tab for the group'))}
            onRenamed={(id, name) => {
              setRenaming(null);
              if (name !== null) void renameSession(id, name).catch(warn('rename'));
            }}
          />
        ))}
      </div>
      <div className="sidebar-footer">
        <UsageStrip />
        <AttentionSoundButton />
      </div>
      <SidebarResizer width={sidebarWidth} />
      {orderMenu !== null && <OrderMenu x={orderMenu.x} y={orderMenu.y} order={sidebarOrder} onClose={() => setOrderMenu(null)} />}
      {addMenu !== null && (
        <Menu
          x={addMenu.x}
          y={addMenu.y}
          onClose={() => setAddMenu(null)}
          className="group-menu"
          data={{ folder: addMenu.folder }}
          items={[
            {
              label: 'New Claude session here',
              title: `A Claude session in ${addMenu.folder}, in a new pane beside the focused one`,
              onClick: () => {
                setAddMenu(null);
                const paneId = layout === null ? undefined : currentTab(layout).focusedPaneId;
                if (paneId !== undefined) openNewSession(paneId, { folder: addMenu.folder, split: true });
              },
            },
            // The other installed shells (M9 fix 624), second so the first
            // row stays the Claude dialog's.
            ...(otherShells(daemon).length > 0
              ? [
                  {
                    label: 'Other shell here',
                    title: `Another installed shell in ${addMenu.folder}, beside the focused pane`,
                    submenu: otherShells(daemon).map((o) => ({
                      label: o.label,
                      title: `${o.label}, ${o.file}`,
                      onClick: () => {
                        setAddMenu(null);
                        void startShellBeside(addMenu.folder, o.id).catch(warn('shell from the heading'));
                      },
                    })),
                    onClick: () => undefined,
                  },
                ]
              : []),
            // The folder's commits as a pane (M52), where the shell would go;
            // an older daemon drops the view from the layout, so no offer.
            ...(viewsSupported(daemon)
              ? [
                  {
                    label: 'Commits in a pane',
                    title: `The commits of ${addMenu.folder} in a new pane beside the focused one, pinned to that folder`,
                    // M9 fix 178: a snapshot of the rail's section, off its
                    // keys, since the panel itself may be on another folder.
                    onClick: () => {
                      setAddMenu(null);
                      void openViewBeside(commitsView(addMenu.folder, viewStateSupported(daemon) ? readRailCommits() : null)).catch(warn('commits in a pane'));
                    },
                  },
                ]
              : []),
            // The folder's graph as a document tab in the strip (M61), the
            // renderer's own, so any daemon will do.
            {
              label: 'Commits in a tab',
              title: `The commit graph of ${addMenu.folder} as a tab in the strip`,
              onClick: () => {
                setAddMenu(null);
                openFileTab(commitsPath(addMenu.folder, commitsQuery(readRailCommits())));
              },
            },
          ]}
        />
      )}
      {groupMenu !== null && <GroupMenu x={groupMenu.x} y={groupMenu.y} group={groups.find((g) => g.key === groupMenu.key) ?? null} onRename={folderLabelsSupported(daemon) ? setLabelling : null} onClose={() => setGroupMenu(null)} />}
      {chooser !== null && (
        <Menu
          x={chooser.x}
          y={chooser.y}
          onClose={() => setChooser(null)}
          className="show-chooser"
          data={{ 'session-id': chooser.sessionId }}
          items={[
            {
              label: 'Show here',
              hint: chooser.view ? `replaces ${chooser.replacing}, which is not kept` : `replaces ${chooser.replacing}, which stays running`,
              onClick: () => {
                setChooser(null);
                if (chooser.remember) setShowOffscreen('replace');
                showHere(chooser.sessionId);
              },
            },
            {
              label: 'Open beside',
              hint: 'a new pane to the right',
              onClick: () => {
                setChooser(null);
                if (chooser.remember) setShowOffscreen('beside');
                showBeside(chooser.sessionId);
              },
            },
            // A one-off: chooser.remember is not read here, so a ticked
            // Remember my choice is ignored for this item and nothing is
            // stored (ShowOffscreen stays 'ask' | 'replace' | 'beside').
            { label: 'Open in a new tab', hint: 'a tab of its own', onClick: () => { setChooser(null); showInTab(chooser.sessionId); } },
            {
              label: 'Remember my choice',
              checked: chooser.remember,
              title: 'Remembers Show here or Open beside; Ask again on click, on the row menu, brings this back',
              separator: true,
              onClick: () => setChooser({ ...chooser, remember: !chooser.remember }),
            },
          ]}
        />
      )}
      {menu !== null && (
        <RowMenu
          menu={menu}
          session={sessions.get(menu.sessionId)}
          onScreen={onScreen(menu.sessionId)}
          showOffscreen={showOffscreen}
          onShowHere={() => {
            setMenu(null);
            showHere(menu.sessionId);
          }}
          onShowBeside={() => {
            setMenu(null);
            showBeside(menu.sessionId);
          }}
          onShowInTab={() => {
            setMenu(null);
            showInTab(menu.sessionId);
          }}
          onAskAgain={() => {
            setMenu(null);
            setShowOffscreen('ask');
          }}
          onClose={() => setMenu(null)}
          onRename={() => {
            setMenu(null);
            setRenaming(menu.sessionId);
          }}
          onComment={() => {
            setMenu(null);
            setCommenting(menu.sessionId);
          }}
          onPrompt={() => {
            setMenu(null);
            setPrompting({ sessionId: menu.sessionId, error: null });
          }}
          onKill={() => {
            setMenu(null);
            void killSession(menu.sessionId).catch(warn('kill'));
          }}
          onResume={() => {
            setMenu(null);
            void resumeSession(menu.sessionId).catch(warn('resume'));
          }}
          onRemove={() => {
            setMenu(null);
            void removeSession(menu.sessionId).catch(warn('remove'));
          }}
          onMarkUnread={() => {
            setMenu(null);
            markSessionUnread(menu.sessionId);
          }}
          onHush={(on) => {
            setMenu(null);
            setSessionHushed(menu.sessionId, on);
          }}
        />
      )}
    </div>
  );
}

interface MenuState {
  sessionId: string;
  x: number;
  y: number;
}

// The order setting (M32): rows where they were made, or most urgent
// first as the sidebar did before. The current one carries the hint.
// The filter chips under the header (M44): every row, the rows a person
// has to act on, the finished turns, and (M9 fix 249) the live rows no
// pane of any tab shows, each with its live count. The active chip is
// filled; the others carry their state's colour on a border.
const FILTER_LABELS: Record<SidebarFilter, string> = { all: 'All', needs: 'Needs you', done: 'Done', unshown: 'Unshown' };
const FILTER_TITLES: Record<SidebarFilter, string> = {
  all: 'Every session',
  needs: 'Sessions that need input or errored',
  done: 'Sessions whose turn finished and nobody has looked at',
  unshown: 'Live sessions on no pane of any tab',
};

function FilterChips({ filter, counts }: { filter: SidebarFilter; counts: FilterCounts }) {
  return (
    <div className="sidebar-filters" data-filter={filter}>
      {SIDEBAR_FILTERS.map((f) => (
        <button
          key={f}
          className="sidebar-filter"
          data-filter={f}
          data-active={f === filter || undefined}
          title={FILTER_TITLES[f]}
          onClick={() => setSidebarFilter(f)}
          onMouseDown={(ev) => ev.preventDefault()}
        >
          {FILTER_LABELS[f]} {counts[f]}
        </button>
      ))}
    </div>
  );
}

const ORDER_LABELS: Record<SidebarOrder, string> = {
  created: 'Order: as created',
  state: 'Order: by state',
};

const ORDER_TITLES: Record<SidebarOrder, string> = {
  created: 'Rows stay where they were made; a badge change never moves one',
  state: 'Most urgent first: needs input, errored, done, working, then the rest, newest first',
};

function OrderMenu({ x, y, order, onClose }: { x: number; y: number; order: SidebarOrder; onClose: () => void }) {
  return (
    <Menu
      x={x}
      y={y}
      onClose={onClose}
      className="order-menu"
      items={SIDEBAR_ORDERS.map((o) => ({
        label: ORDER_LABELS[o],
        title: ORDER_TITLES[o],
        hint: o === order ? 'current' : undefined,
        onClick: () => {
          onClose();
          setSidebarOrder(o);
        },
      }))}
    />
  );
}

// The heading's right-click menu (M9 fix 193): the sweep over every
// session under the folder as the chips show it (M9 fix 249: under a
// filter the rows on show are the ones swept, so Close all on the
// unshown chip takes the orphans alone; under All it is the whole
// group), with the count in each label and the working count in its
// title; no dialog, since the ask is one swoop. The Exited group's is
// Remove all, the same as its button. A group gone since the click
// closes.
function GroupMenu({ x, y, group, onRename, onClose }: { x: number; y: number; group: SessionGroup | null; onRename: ((key: string) => void) | null; onClose: () => void }) {
  useEffect(() => {
    if (group === null) onClose();
  }, [group, onClose]);
  if (group === null) return null;
  const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);
  const ids = group.sessions.map((s) => s.id);
  const counts = sweepCounts(group.sessions);
  const items: MenuItem[] =
    group.key === EXITED_GROUP
      ? [
          {
            label: `Resume all ${counts.count}`,
            title: 'Start every exited session again',
            onClick: () => {
              onClose();
              void resumeAll().catch(warn('resume all'));
            },
          },
          {
            label: `Remove all ${counts.count}`,
            title: 'Remove every exited session from the list',
            onClick: () => {
              onClose();
              void clearExited().catch(warn('remove all'));
            },
          },
        ]
      : [
          // The label of the person's own (M9 fix 194), the same box a
          // double-click on the name opens; null on a daemon too old to
          // keep one.
          ...(onRename === null
            ? []
            : [
                {
                  label: 'Rename',
                  title: "A name of your own on this heading; the grouping stays by folder, and an empty name goes back to the folder's",
                  onClick: () => {
                    onClose();
                    onRename(group.key);
                  },
                },
              ]),
          // M9 fix 345: the folder's own path, the same two the file
          // tabs' menu offers (TabStrip.tsx), through the main process's
          // clipboard (preload/api.ts) rather than navigator.clipboard,
          // which asks a permission this menu's click does not carry.
          {
            label: 'Copy path',
            title: group.key,
            onClick: () => {
              onClose();
              void window.emerald.clipboard.write(group.key).catch(warn('copy'));
            },
          },
          {
            label: 'Reveal in Explorer',
            title: group.key,
            onClick: () => {
              onClose();
              void window.emerald.files.reveal(group.key).catch(warn('reveal'));
            },
          },
          ...(['close', 'kill', 'remove'] as const).map((mode, i) => ({
            label: sweepLabel(mode, counts),
            title: sweepTitle(mode, counts),
            separator: i === 0,
            onClick: () => {
              onClose();
              void sweepSessions(ids, mode).catch(warn(`${mode} all`));
            },
          })),
        ];
  return <Menu x={x} y={y} onClose={onClose} className="group-heading-menu" data={{ group: group.key }} items={items} />;
}

interface GroupProps {
  group: SessionGroup;
  now: number;
  // The load sparklines' shared ceiling (M9 fix 302).
  loadCeiling: number;
  runningShells: ReadonlySet<string>;
  shown: ReadonlyMap<string, Shown>;
  // The sessions on a pane of any tab (M9 fix 249), for the heading's
  // count of the ones on none.
  onPanes: ReadonlySet<string>;
  renaming: string | null;
  commenting: string | null;
  prompting: { sessionId: string; error: string | null } | null;
  promptHistory: readonly HistoryEntry[];
  // Null when the daemon is too old to keep saved prompts.
  onSavePrompt: ((name: string, text: string) => void) | null;
  // shift is Shift held on the click (M9 fix 91: beside, no question);
  // rect is the row's box, where the chooser hangs.
  onShow: (sessionId: string, shift: boolean, rect: DOMRect) => void;
  onResume: (sessionId: string) => void;
  onMenu: (sessionId: string, x: number, y: number) => void;
  // The heading's + (M32): a shell in the group's folder, and its right
  // click for the Claude choice.
  onAdd: (folder: string) => void;
  onAddMenu: (folder: string, x: number, y: number) => void;
  // A right click on the heading itself: the sweep menu for the group.
  onGroupMenu: (key: string, x: number, y: number) => void;
  // The label box (M9 fix 194): which heading has it open, whether the
  // daemon keeps labels at all, and the open and the answer (label null
  // means cancelled, an empty string means back to the folder's name).
  labelling: string | null;
  canLabel: boolean;
  onLabel: (key: string) => void;
  onLabelled: (key: string, label: string | null) => void;
  onGroupTab: (name: string, sessionIds: string[]) => void;
  // name null means the rename was cancelled.
  onRenamed: (sessionId: string, name: string | null) => void;
  // comment null means cancelled; an empty string clears the comment.
  onCommented: (sessionId: string, comment: string | null) => void;
  // text null means the box was closed without sending.
  onPrompted: (sessionId: string, text: string | null) => void;
}

function Group({ group, runningShells, onPanes, onAdd, onAddMenu, onGroupMenu, onGroupTab, labelling, canLabel, onLabel, onLabelled, ...rowProps }: GroupProps) {
  const { attention, sidebarFolded } = useUi();
  // Folded (M9 fix 64): the rows are not rendered, so the shown marker and
  // the row menus go with them; the heading stays, units and all.
  const folded = sidebarFolded.has(group.key);
  // The rollup (M32): the most urgent state under the heading, for the
  // pulse's tone (and the scripts, on data-rollup); its dot and count
  // came off the heading with M46, since the pulse says attention and a
  // teal count would say it twice. One pulse per place (M9 fix 69): the
  // row pulses while it is on view, and the heading pulses in its place
  // only when the group is folded and the row is not, so a folded group
  // still says which project wants someone without two things pulsing
  // for one session; the acknowledge clears the pulse.
  const roll = group.key === EXITED_GROUP ? null : rollup(group);
  const acting = roll !== null && (roll.state === 'needs-input' || roll.state === 'errored' || roll.state === 'done');
  // A stalled session (M9 fix 232) is not a state the rollup ranks; a
  // folded group whose only wanting session is quiet pulses in that tone.
  const quiet = group.sessions.some((s) => attention.wanting.has(s.id) && attentionState(s) === 'quiet');
  const wanting = folded && group.sessions.some((s) => attention.wanting.has(s.id)) ? (acting ? roll?.state : quiet ? 'quiet' : undefined) : undefined;
  // The units (M46): every Claude under the heading, a session or sent
  // out, active or not, and every shell, running or at its prompt. A
  // folded heading whose units are all zero shows its dim session count
  // instead, so a folded group with five sessions and an empty one do
  // not look the same (M9 fix 75).
  const units = group.key === EXITED_GROUP ? null : folderRollup(group, runningShells);
  const anyUnit = units !== null && (units.agentsActive > 0 || units.agentsInactive > 0 || units.shellsRunning > 0 || units.shellsIdle > 0);
  // The live sessions under the heading on no pane of any tab (M9 fix
  // 249), said in words after the units when there are any, so the
  // orphans under a folder are counted before anyone unfolds it.
  const unshownCount = group.key === EXITED_GROUP ? 0 : group.sessions.filter((s) => s.state !== 'exited' && !onPanes.has(s.id)).length;
  // A labelled heading (M9 fix 194) says the folder's own name before
  // the path, so the label never hides where the group is.
  const labelled = group.key !== EXITED_GROUP && group.title !== folderTitle(group.key);
  const isLabelling = labelling === group.key;
  // The changes mark (M9 fix 200): a dot after the name while the
  // folder's tree has uncommitted changes, polled on the rail's cadence,
  // so a heading says the tree is dirty before anyone opens the rail.
  const changedCount = useFolderChangeCount(group.key === EXITED_GROUP ? null : group.key);
  return (
    <div className="sidebar-group" data-group={group.key} data-folded={folded || undefined}>
      <div
        className="sidebar-group-title"
        title={labelled ? `${folderTitle(group.key)}, ${group.key}` : group.key}
        data-label={labelled ? group.title : undefined}
        data-rollup={acting ? roll?.state : undefined}
        data-rollup-count={acting ? roll?.count : undefined}
        data-attention={wanting}
        // The heading's own menu (M9 fix 193); the + keeps its Claude
        // menu, stopping the event before it gets here.
        onContextMenu={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          onGroupMenu(group.key, ev.clientX, ev.clientY);
        }}
      >
        {group.key !== EXITED_GROUP && <FolderIcon folder={group.key} />}
        {isLabelling ? (
          <RenameBox initial={group.title} className="sidebar-rename sidebar-group-rename" maxLength={FOLDER_LABEL_MAX} onDone={(label) => onLabelled(group.key, label === null ? null : label === folderTitle(group.key) ? '' : label)} />
        ) : (
          <span className="sidebar-group-head">
            <span
              className="sidebar-group-name"
              // A double-click opens the label box (M9 fix 194), as on a row.
              onDoubleClick={(ev) => {
                if (!canLabel || group.key === EXITED_GROUP) return;
                ev.stopPropagation();
                onLabel(group.key);
              }}
            >
              {group.title}
            </span>
            {changedCount > 0 && <span className="sidebar-group-changes" data-count={changedCount} title={`${changedCount} changed ${changedCount === 1 ? 'file' : 'files'}`} />}
          </span>
        )}
        {units !== null && anyUnit && <HeadingUnits id={group.key} roll={units} sessions={group.sessions} />}
        {unshownCount > 0 && (
          <span className="sidebar-group-unshown" data-count={unshownCount} title={`${unshownCount} live ${unshownCount === 1 ? 'session' : 'sessions'} under ${group.title} on no pane of any tab`}>
            {unshownCount} on no pane
          </span>
        )}
        {units !== null && !anyUnit && folded && (
          <span className="sidebar-group-count" data-dim="" title={`${group.sessions.length} under ${group.title}`}>
            {group.sessions.length}
          </span>
        )}
        <button
          className="sidebar-group-fold"
          title={folded ? `Unfold ${group.title}` : `Fold ${group.title} away`}
          onClick={(ev) => {
            ev.stopPropagation();
            toggleSidebarFold(group.key);
          }}
          onMouseDown={(ev) => ev.preventDefault()}
        >
          {folded ? '▸' : '▾'}
        </button>
        {group.key !== EXITED_GROUP && (
          // M50: a layout tab named after the group with every session
          // of it in a pane, without touching the panes they have now.
          <button
            className="sidebar-group-tab"
            title={`New panes tab for ${group.title}, one pane per session`}
            onClick={(ev) => {
              ev.stopPropagation();
              onGroupTab(
                group.title,
                group.sessions.map((s) => s.id),
              );
            }}
            onMouseDown={(ev) => ev.preventDefault()}
          >
            <PanesIcon size={12} className="sidebar-group-tab-icon" />
          </button>
        )}
        {group.key !== EXITED_GROUP && (
          <button
            className="sidebar-group-add"
            title={`New shell in ${group.title}, beside the focused pane. Right click for a Claude session or another shell.`}
            onClick={(ev) => {
              ev.stopPropagation();
              onAdd(group.key);
            }}
            onContextMenu={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              onAddMenu(group.key, ev.clientX, ev.clientY);
            }}
            // Keyboard focus stays in the terminal, as with the row's buttons.
            onMouseDown={(ev) => ev.preventDefault()}
          >
            +
          </button>
        )}
        {group.key === EXITED_GROUP && (
          <button
            className="sidebar-resume-all"
            title="Start every exited session again, each in the pane it kept"
            onClick={() => void resumeAll().catch((err: unknown) => console.warn('[emerald] resume all failed', err))}
            onMouseDown={(ev) => ev.preventDefault()}
          >
            Resume all
          </button>
        )}
        {group.key === EXITED_GROUP && (
          <button
            className="sidebar-clear-exited"
            title="Remove every exited session from the list"
            onClick={() => void clearExited().catch((err: unknown) => console.warn('[emerald] clear exited failed', err))}
            onMouseDown={(ev) => ev.preventDefault()}
          >
            Clear exited
          </button>
        )}
      </div>
      {!folded && group.sessions.map((s) => (
        <Row key={s.id} session={s} {...rowProps} />
      ))}
    </div>
  );
}

// The project's favicon at the icon's size when the folder has one (M9
// fix 65), else a folder outline in the slot (M9 fix 81: M46 had left
// the slot empty, the chevron saying group, and a heading with no
// favicon read as a name floating in the column). A file that fails to
// load falls back to the outline too.
function FolderIcon({ folder }: { folder: string }) {
  const [url, setUrl] = useFolderIcon(folder);
  if (url !== null) return <img className="sidebar-group-icon" src={url} width={14} height={14} alt="" onError={() => setUrl(null)} />;
  return (
    <svg className="sidebar-group-icon sidebar-group-outline" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M1.5 3.5h4l1.5 1.5h7.5v8h-13z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// How often a heading asks for its icon again (M9 fix 521); the main
// process re-reads an answer older than a minute, so a favicon added to a
// folder nobody watches shows within two minutes at most.
const FOLDER_ICON_REASK_MS = 60_000;

// The favicon's URL for a folder, asked of the main process when the
// heading appears, again when the rail's watcher reports a change at that
// folder, and re-read after a minute; null while unknown or when there is
// none. An answer that has not changed sets the same string, so nothing
// re-renders.
function useFolderIcon(folder: string): [string | null, (url: string | null) => void] {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let liveQuery = true;
    const ask = () => {
      void window.emerald.files
        .folderIcon(folder)
        .then((found) => {
          if (liveQuery) setUrl(found);
        })
        .catch((err: unknown) => console.warn('[emerald] folder icon failed', err));
    };
    ask();
    const off = window.emerald.files.onChanged((dir) => {
      if (sameFolder(dir, folder)) ask();
    });
    const again = setInterval(ask, FOLDER_ICON_REASK_MS);
    return () => {
      liveQuery = false;
      off();
      clearInterval(again);
    };
  }, [folder]);
  return [url, setUrl];
}

// The watcher names a folder the way the rail sent it and the group key
// is the session's cwd; the same place either way, whatever the slashes.
function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

// Three lines: the state dot, name, badge and age; the branch, the kind,
// the phase and whether it is on screen; and the checkpoint's comment when
// there is one, else while the session works the terminal title (what
// Claude Code says it is doing, M33), else for a Claude session the last
// turn, "prompt - reply", on one line with the whole text in the tooltip.
function Row({ session, now, loadCeiling, shown, renaming, commenting, prompting, promptHistory, onSavePrompt, onShow, onResume, onMenu, onRenamed, onCommented, onPrompted }: Omit<GroupProps, 'group' | 'onAdd' | 'onAddMenu' | 'onGroupMenu' | 'onGroupTab' | 'runningShells' | 'onPanes' | 'labelling' | 'canLabel' | 'onLabel' | 'onLabelled'> & { session: SessionInfo }) {
  const label = describeState(session, now);
  // A plain shell has no state to show (hasState); the row keeps data-state
  // so a script can still read what the machine says. Its last command
  // (M9 fix 196) is on the record when the prompt reports one: the mark
  // blinks while it runs, goes --error when it failed, and its tooltip
  // says so; a long one's end is a done or errored like any other.
  const stated = hasState(session);
  const command = shellCommand(session);
  const isRenaming = renaming === session.id;
  const isCommenting = commenting === session.id;
  const isPrompting = prompting?.sessionId === session.id;
  const editing = isRenaming || isCommenting || isPrompting;
  // Where the session is (M9 fix 249): focused, on screen, on another
  // tab, or on no pane; data-shown keeps its two values (the ground and
  // the edge mean shown and focused, and the scripts read it as on
  // screen or not), data-place carries all four for the word's dimming.
  const where = shown.get(session.id);
  const onScreen = where?.place === 'focused' || where?.place === 'shown' ? where.place : undefined;
  const place = shownData(where, session.state === 'exited');
  const placeWords = shownWords(where, session.state === 'exited');
  const { sessionDrag, attention, attentionSound, sidebarWidth, teamUnfolded, stalled } = useUi();
  // The meter's live samples (M41), when the daemon sends them.
  const { daemon, sessions, conflicts } = useStore('daemon', 'sessions', 'conflicts');
  const rate = useRates(session.id);
  // The row's dollars with the forks' running spend (M9 fix 277).
  const agentsRunning = useAgentsRunning();
  const costFigure = runningFigure(session.costUsd ?? null, session.conversation === null ? null : (agentsRunning.get(session.conversation.id) ?? null));
  // The team's models (M9 fix 289): the same store, so the fold and the
  // card never ask a second time and never disagree.
  const models = session.conversation === null ? {} : (agentsRunning.get(session.conversation.id)?.models ?? {});
  const dragging = sessionDrag?.sessionId === session.id;
  // Set while the session waits for someone and nobody has clicked or typed
  // since (attention-model.ts); the value is the state, for the colour.
  const wanting = attention.wanting.has(session.id) ? attentionState(session) : undefined;
  // Set while the pulse goes on with its chime stopped (M9 fix 189).
  const hushed = attention.hushed.has(session.id) ? true : undefined;
  // M9 fix 190: the hush button shows while the row pulses and the repeat
  // is what would chime; with once or off there is nothing to hush.
  const hushable = wanting !== undefined && attentionSound === 'repeat';
  // The big figure (M9 fix 267): the same words and figure as the pane's
  // counter, for the two states a person is meant to answer.
  const wait = waitOverlay(wanting, session.stateSince, now);
  // Set when a press on the row became a drag, so the click that follows a
  // drag released back inside the row does not show the session in the
  // focused pane, which is exactly what the drag was for avoiding.
  const dragged = useRef(false);
  const onContextMenu = (ev: React.MouseEvent) => {
    ev.preventDefault();
    onMenu(session.id, ev.clientX, ev.clientY);
  };
  // While the session works its mark steps (M46); stale stops it. Claude's
  // own title glyph stays in the title (fix 59). A shell's mark runs while
  // the shell writes, which is the nearest thing to a command running.
  const motion = workingMotion(session);
  const kind = markKind(session);
  const samples = liveSamples(motion, daemon?.featureLevel, rate);
  const markTitle = samples === null ? label.text : `${label.text}, output ${rateText(samples)}`;
  // M40: under the sub line, two lines that read as what I asked and what
  // Claude is doing about it: the last prompt behind a › marker, then the
  // agent line behind a marker for the state (stateMarker), whose text is
  // Claude's latest text off the transcript while the turn runs (M47),
  // else the last reply, else the title's (M33), else nothing behind the
  // marker: the mark and the badge already say the state, so a state word
  // never sits there (M47). Neither line before the first prompt.
  const activity = activityText(session);
  const marker = stateMarker(session);
  // M9 fix 79: the tool call Claude is making, when no text has landed
  // since it, reads on the line before the last turn's reply and the title.
  // At needs-input the line says what is waited on instead (M55), the
  // tool call as a question, since the badge's reason word alone does not
  // tell a person what they are being asked. The rule is agentLineText,
  // shared with the session's row on the Commits graph (M68).
  const agentText = agentLineText(session);
  const agentLine = session.lastPrompt === null ? null : agentText;
  const agentIsTitle = agentLine !== null && activity !== null && agentText === activity;
  // The sub line gives in whole steps (M9 fix 76): the shown word and the
  // phase first, then the model's words and the percent together (the
  // dial stays, its card has both), then the tokens (M9 fix 146: a level
  // of their own, so a row on screen with a branch keeps the count at
  // the default width), then the dollars (M9 fix 221: a level of their
  // own after the tokens, so the figure outlives the split; a row with
  // no cost drops nothing here and walks on), then the branch name's
  // ellipsis, and last, on a row with a checklist count (M9 fix 153),
  // the count: a seventh level a row without one never has, so its
  // numbering is as it was. The levels are the CSS's; the hook finds the
  // first at which the line is not clipped, again whenever its width or
  // its text changes.
  const subRef = useRef<HTMLDivElement>(null);
  const team = teamCounts(session);
  // The team listed under the row (M9 fix 90): a chevron before the
  // roster unfolds one line per member, folded by default; the members
  // leave when the reducer drops them (M46, the next prompt).
  const hasTeam = session.team.length > 0;
  const teamOpen = hasTeam && teamUnfolded.has(session.id);
  const hasTasks = tasksText(session) !== null;
  // The forecast mark (M9 fix 320) is the last part to leave, a level
  // above the top a row in no pair never has, so every other row's
  // numbering is as it was; the count is in the deps so the level is
  // found again when a pair appears or clears.
  const pairs = session.state === 'exited' ? 0 : conflictLines(session.id, conflicts.conflicts, new Map()).length;
  useSqueeze(subRef, (hasTasks ? 7 : 6) + (pairs > 0 ? 1 : 0), null, [sidebarWidth, session.branch, team.out, team.returned, team.shells, session.phase, placeWords, contextText(session), tokensRowText(session), costFigure?.row ?? null, tasksText(session), hasTeam, pairs]);
  // The first line gives one step (M9 fix 123): a needs-input badge drops
  // its reason before the name or the badge itself is cut, since the
  // agent line under the row says what the ask is. The tell is the two
  // parts that can ellipsise, since the line itself never overflows.
  const mainRef = useRef<HTMLDivElement>(null);
  const reason = session.state === 'needs-input' ? needsInputWords(session.needsInputReason) : null;
  useSqueeze(mainRef, reason === null ? 1 : 2, '.sidebar-row-name, .sidebar-row-state', [sidebarWidth, session.name, label.text, session.stale, stated, isRenaming]);
  const badgeText = reason === null ? label.text : (
    <>
      {NEEDS_INPUT_WORD}
      <span className="sidebar-row-reason">: {reason}</span>
    </>
  );
  return (
    <div
      className="sidebar-row"
      data-session-id={session.id}
      data-state={session.state}
      data-working={motion ?? undefined}
      data-shown={onScreen}
      data-place={place}
      data-dragging={dragging || undefined}
      data-attention={wanting}
      data-hushed={hushed}
      data-color={session.color ?? undefined}
      data-flash={stalled.has(session.id) ? 'stalled' : undefined}
      title={stalled.has(session.id) ? STALLED_TITLE : undefined}
      style={colorStyle(session)}
      onClick={(ev) => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        if (!editing) onShow(session.id, ev.shiftKey, ev.currentTarget.getBoundingClientRect());
      }}
      // The first click already showed it; the second brings it back to life.
      onDoubleClick={() => {
        if (!editing && session.state === 'exited') onResume(session.id);
      }}
      onContextMenu={onContextMenu}
      // Keep keyboard focus in the terminal: the row itself never needs it,
      // and a click that changes nothing must not leave the shell deaf. A
      // left press may also become a drag onto a pane; nothing shows until
      // the mouse has moved, so a click is unchanged.
      onMouseDown={(ev) => {
        if (ev.target instanceof HTMLInputElement) return;
        ev.preventDefault();
        // A drag dropped on a pane never clicks the row, so the flag from
        // it would swallow the next real click: each press starts clean.
        dragged.current = false;
        const onControl = ev.target instanceof Element && ev.target.closest('button') !== null;
        if (ev.button === 0 && !isRenaming && !isCommenting && !onControl) {
          startSessionDrag(session.id, ev.nativeEvent, () => {
            dragged.current = true;
          });
        }
      }}
    >
      <div className="sidebar-row-main" ref={mainRef}>
        {/* The mark is always there (M46), a plain shell's included; stated gates the badge alone. */}
        <SessionMark kind={kind} tone={kind === 'claude' ? label.tone : undefined} working={kind === 'claude' ? motion !== null : shellRunning(rate, command)} failed={command?.state === 'failed'} size="row" title={stated ? markTitle : shellMarkTitle(command, now)} />
        {isRenaming ? (
          <RenameBox initial={session.name} className="sidebar-rename" maxLength={Limits.nameMaxChars} onDone={(name) => onRenamed(session.id, name)} />
        ) : (
          <span className="sidebar-row-name" title={session.cwd} style={{ '--name-chars': session.name.length } as CSSProperties}>
            {session.name}
          </span>
        )}
        {stated && session.state === 'needs-input' ? (
          // The badge opens the answer card (M55): the same span, as the
          // card's anchor, so the row's layout is unchanged.
          <AnswerBadge session={session} className={`sidebar-row-state state-${label.tone}`} title={`${label.detail ?? ''} Click to see the prompt and answer it here.`.trim()}>
            {badgeText}
          </AnswerBadge>
        ) : (
          stated && (
            <span className={`sidebar-row-state state-${label.tone}`} title={label.detail ?? undefined}>
              {label.text}
            </span>
          )
        )}
        {/* M9 fix 247: while the row pulses (data-attention on the row) the age takes the pulse's tone and a size up; under the big figure (fix 267) it is hidden, since the figure is the age. */}
        {stated && (
          <span className="sidebar-row-age" data-under={wait === null ? undefined : ''} title={`In this state since ${new Date(session.stateSince).toLocaleTimeString()}`}>
            {formatDuration(session.stateSince, now)}
          </span>
        )}
        {/* Fix 136: the row menu's Resume where the eye already is, so an
            exited session comes back without a right-click or a
            double-click; always visible, since a control that only shows
            on hover is the menu it replaces. */}
        {/* Fix 190: hush the chime for this one and keep the pulse, for
            a person mid-thought elsewhere who will get to it; the button
            sits where Resume sits on an exited row and stays visible while
            the row pulses. attention.ts leaves a press on it alone (it is
            neither an ack nor a hush of the rest), so the row goes on
            pulsing under it. A second press lets the chime through again. */}
        {hushable && wait === null && <HushButton sessionId={session.id} hushed={hushed === true} />}
        {session.state === 'exited' && (
          <button
            className="sidebar-row-resume"
            data-action="resume"
            title={resumeTitle(session)}
            onClick={(ev) => {
              ev.stopPropagation();
              onResume(session.id);
            }}
            // Two quick clicks would also reach the row's double-click and
            // ask for a second resume of a session already on its way.
            onDoubleClick={(ev) => ev.stopPropagation()}
          >
            Resume
          </button>
        )}
        <button
          className="sidebar-row-menu"
          title="Rename, set a comment, kill, resume or remove"
          onClick={(ev) => {
            ev.stopPropagation();
            const r = ev.currentTarget.getBoundingClientRect();
            onMenu(session.id, r.left, r.bottom);
          }}
        >
          ⋯
        </button>
      </div>
      <div className="sidebar-row-sub" ref={subRef}>
        {session.branch !== null && (
          <span className="sidebar-row-branch" title={`Branch of ${session.cwd}`}>
            <BranchIcon />
            <span className="sidebar-row-branch-name">{session.branch}</span>
          </span>
        )}
        {/* The roster (M46): what the session sent out, after the branch and before the model and the percent. */}
        {hasTeam && (
          <button
            className="sidebar-row-team-fold"
            title={teamOpen ? 'Fold the team away' : 'List the team under the row (a click on the roster does too)'}
            data-open={teamOpen || undefined}
            onClick={(ev) => {
              ev.stopPropagation();
              toggleTeamUnfold(session.id, new Set(sessions.keys()));
            }}
            onMouseDown={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
            }}
          >
            {/* M9 fix 289: the glyph stays ▸, CSS turns it 90 degrees
                open rather than swapping the character, so the fold
                reads as a disclosure. */}
            <span className="sidebar-row-team-fold-glyph">▸</span>
          </button>
        )}
        <RosterUnits id={session.id} counts={team} members={session.team} size="unit" now={now} models={models} onClick={() => toggleTeamUnfold(session.id, new Set(sessions.keys()))} />
        {session.phase !== null && (
          <span className="sidebar-row-phase" title="Phase, from emmer set --phase">
            {session.phase}
          </span>
        )}
        {/* A dot before the word when a roster precedes it (M9 fix 102, drawn by the CSS off data-dot so it costs no flex gap): the word left the shells' blue, and the dot keeps "3 on screen" from reading as one phrase. */}
        {placeWords !== null && (
          <span className="sidebar-row-shown" data-place={place} data-dot={team.out + team.returned + team.shells > 0 || undefined}>
            {placeWords}
          </span>
        )}
        {contextText(session) !== null && (
          <ContextReading session={session} className="sidebar-row-context">
            {/* The same reading as the pane title's, opening the same card (M9 fix 67), dial right before the percent (M9 fix 66; the row's dial overrules fix 28's "text alone", the kind word's room is its room). */}
            {contextWords(session) !== null && (
              <span className="sidebar-row-context-model">
                {contextWords(session)}
                {contextPercentText(session) !== null && ' · '}
              </span>
            )}
            {session.contextPercent !== null && (
              <span className="context-dial" style={dialStyle(session.contextPercent, session.contextWindow === null ? undefined : compactPercent(session.contextWindow))} />
            )}
            {contextPercentText(session) !== null && <span className="sidebar-row-context-percent">{contextPercentText(session)}</span>}
            {/* The API cost as one bare figure (M9 fix 221), Claude Code's own (fix 154), where the tokens were: the tokens follow it and drop a squeeze level before it, so a narrow sidebar keeps the dollars alone; until the first figure lands the tokens stand as before. */}
            {/* M9 fix 277: with the forks' spend since the main thread's last request added, a ~ after it, while they run. */}
            {costFigure !== null && (
              <span className="sidebar-row-cost" data-running={costFigure.running || undefined} title={costFigure.rowTitle ?? undefined}>
                {costFigure.row}
              </span>
            )}
            {/* Sent and received since the process started (M9 fix 143), the cached share between them (fix 154), the split on the card. */}
            <TokensText session={session} className="sidebar-row-tokens" cached />
          </ContextReading>
        )}
        {/* How far along Claude's checklist is (M9 fix 153), after the reading, its own card. */}
        <TasksReading session={session} className="sidebar-row-tasks" />
      </div>
      {session.lastPrompt !== null && (
        <TurnLineAnchor session={session} line="prompt" className="sidebar-row-line sidebar-row-prompt-line">
          <span className="sidebar-row-marker sidebar-row-marker-prompt">›</span>
          <span className="sidebar-row-prompt">{session.lastPrompt}</span>
        </TurnLineAnchor>
      )}
      {isPrompting ? (
        <div className="sidebar-row-line sidebar-row-turn">
          <PromptBox className="sidebar-prompt" placeholder={`Prompt for ${session.name}`} error={prompting?.error ?? null} history={promptHistory} onSubmit={(text) => onPrompted(session.id, text)} onCancel={() => onPrompted(session.id, null)} onSave={onSavePrompt} />
        </div>
      ) : isCommenting ? (
        <div className="sidebar-row-line sidebar-row-turn">
          <RenameBox initial={session.comment ?? ''} className="sidebar-rename" maxLength={Limits.commentMaxChars} onDone={(comment) => onCommented(session.id, comment)} />
        </div>
      ) : session.comment !== null ? (
        <TurnLineAnchor session={session} line="comment" className="sidebar-row-comment">
          <PinIcon />
          <span className="sidebar-row-comment-text">{session.comment}</span>
        </TurnLineAnchor>
      ) : (
        agentLine !== null && (
          <TurnLineAnchor session={session} line="turn" className={agentIsTitle ? 'sidebar-row-line sidebar-row-turn sidebar-row-activity' : 'sidebar-row-line sidebar-row-turn'}>
            <StateMarkerGlyph marker={marker} />
            <span className="sidebar-row-agent">{agentLine}</span>
            {/* The load sparkline and figure (M9 fix 302), on the agent line alone: it exists while the session works, which is when there is load, so an idle row gains nothing. */}
            <LoadMark session={session} now={now} ceiling={loadCeiling} />
            {/* The conflict forecast's mark and pair count (M9 fix 320), after the load figure, on the agent line alone for the same reason. */}
            <ConflictMark session={session} now={now} />
          </TurnLineAnchor>
        )
      )}
      {/* M9 fix 267: the wait as a big figure laid over the row's right
          half in the pulse's tone, the row's height, with the hush at
          the same scale beside it, so the figure is the first thing the
          eye lands on and the row reads as one thing at three sizes;
          the small age is hidden under it. The digits are RollingFigure's
          slots (fix 235), so a tick rolls like an odometer's drum. No
          pointer events but the button's, so the row's click and drag
          are what they were. */}
      {wait !== null && (
        <span className="sidebar-row-wait" data-word={wait.word} data-figure={wait.figure}>
          <span className="sidebar-row-wait-figure">
            <RollingFigure text={wait.figure} />
          </span>
          {hushable && <HushButton sessionId={session.id} hushed={hushed === true} className="sidebar-row-hush-big" />}
        </span>
      )}
      {teamOpen && <TeamList members={session.team} now={now} models={models} />}
    </div>
  );
}

// The team under a row (M9 fix 90): one line per member in spawn order,
// the mark stepping while it runs and still once returned, then what it
// was given to do, then how long it has been out or took, at the right.
// M9 fix 289: the line reads what the roster card says (type, model,
// task) rather than falling the task back to the type, so the two never
// disagree; the model comes from the same agents-running map the row's
// cost figure reads, keyed by member id.
function TeamList({ members, now, models }: { members: SessionInfo['team']; now: number; models: Record<string, string> }) {
  return (
    <div className="sidebar-row-team">
      {members.map((m) => {
        const p = memberParts(m, now);
        const model = modelWord(models[m.id] ?? null);
        return (
          <div key={m.id} className="sidebar-row-member" data-working={p.working || undefined} data-kind={p.kind} title={memberLine(m, now, model)}>
            <span className="roster-unit" data-unit={p.kind === 'shell' ? 'shells' : p.working ? 'out' : 'returned'}>
              <SessionMark kind={p.kind === 'shell' ? 'shell' : 'claude'} working={p.working} size="unit" family={model} />
            </span>
            <span className="sidebar-row-member-type">{p.type}</span>
            {model !== null && <span className="sidebar-row-member-model">{model}</span>}
            <span className="sidebar-row-member-task">{p.task ?? ''}</span>
            {/* M9 fix 654: the member's latest tool call, beside its task. */}
            {p.activity !== null && <span className="sidebar-row-member-activity">{p.activity}</span>}
            <span className="sidebar-row-member-elapsed">{p.elapsed}</span>
          </div>
        );
      })}
    </div>
  );
}

// The agent line's marker: the state's glyph in the state's colour, or the
// dot while the session works. data-tone is what attention.ts syncs the ?
// pulse on.
function StateMarkerGlyph({ marker }: { marker: ReturnType<typeof stateMarker> }) {
  return (
    <span className={`sidebar-row-marker state-${marker.tone}`} data-tone={marker.tone}>
      {marker.glyph ?? <span className="sidebar-row-marker-dot" />}
    </span>
  );
}

// A pin, so a comment reads as something written on purpose.
function PinIcon() {
  return (
    <svg className="sidebar-row-pin" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path d="M6 2h4l-.5 3 2 2.5h-7l2-2.5zM8 7.5V14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

// Exported for the files rail's header pill (M9 fix 335), the same glyph
// a session row's branch pill draws.
export function BranchIcon() {
  return (
    <svg className="sidebar-row-branch-icon" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <circle cx="4" cy="3" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="13" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 4.6v6.8M12 6.6c0 3-8 2-8 4.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

interface RowMenuProps {
  menu: MenuState;
  session: SessionInfo | undefined;
  // M9 fix 91: the three answers to a click as plain items, and the way
  // back to being asked once a choice was remembered.
  onScreen: boolean;
  showOffscreen: ShowOffscreen;
  onShowHere: () => void;
  onShowBeside: () => void;
  onShowInTab: () => void;
  onAskAgain: () => void;
  onClose: () => void;
  onRename: () => void;
  onComment: () => void;
  onPrompt: () => void;
  onKill: () => void;
  onResume: () => void;
  onRemove: () => void;
  onMarkUnread: () => void;
  onHush: (on: boolean) => void;
}

function RowMenu({ menu, session, onScreen, showOffscreen, onShowHere, onShowBeside, onShowInTab, onAskAgain, onClose, onRename, onComment, onPrompt, onKill, onResume, onRemove, onMarkUnread, onHush }: RowMenuProps) {
  const { attention, attentionSound } = useUi();
  // Review changes (M64): the count of changed files in the session's
  // folder as the item's hint, read when the menu opens; off on a clean
  // tree.
  const changed = useChangedCount(session);
  if (session === undefined) return null;
  const exited = session.state === 'exited';
  // Mark unread (M14): back to pulsing, for a row to come back to later.
  const pulsing = attention.wanting.has(session.id);
  const markable = canMarkUnread(session.state) && !pulsing;
  const markTitle = pulsing ? 'Already pulsing' : markable ? `Pulse ${session.name} until you click or type` : 'Wait for the turn to end';
  // Hush (M9 fix 190): the row's button, for the person who reaches the
  // row by right-click; the same guard as the button.
  const hushed = attention.hushed.has(session.id);
  const hushable = pulsing && attentionSound === 'repeat';
  const hushTitle = !pulsing ? 'Nothing is chiming for it' : attentionSound !== 'repeat' ? 'The chime is not on repeat' : hushed ? `Let the chime through again for ${session.name}` : `Stop the chime for ${session.name}; the row keeps pulsing`;
  return (
    <Menu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      className="row-menu"
      data={{ 'session-id': menu.sessionId }}
      items={[
        { label: 'Rename', onClick: onRename },
        { label: 'Show here', onClick: onShowHere, disabled: onScreen || exited, title: onScreen ? 'Already on screen' : exited ? 'Resume it first' : `Show ${session.name} in the focused pane` },
        { label: 'Open beside', onClick: onShowBeside, disabled: onScreen || exited, title: onScreen ? 'Already on screen' : exited ? 'Resume it first' : `Show ${session.name} in a new pane to the right of the focused one` },
        { label: 'Open in a new tab', onClick: onShowInTab, disabled: onScreen || exited, title: onScreen ? 'Already on screen' : exited ? 'Resume it first' : `Show ${session.name} in a new panes tab of its own, named after its folder` },
        ...(showOffscreen === 'ask' ? [] : [{ label: 'Ask again on click', onClick: onAskAgain, title: `A click on an off-screen row ${showOffscreen === 'replace' ? 'replaces the focused pane' : 'opens a pane beside'} now; forget that` }]),
        { label: 'Set comment', onClick: onComment, title: 'A checkpoint shown in place of the last turn; empty clears it (emmer set --comment)', separator: true },
        // M56: a prompt typed into the session from here, without focusing
        // its pane, with emmer prompt's gates.
        { label: 'Send a prompt…', onClick: onPrompt, disabled: exited, title: exited ? 'Resume it first' : `Type a line into ${session.name} and press Enter for it (emmer prompt)` },
        colorSwatches(session, onClose),
        { label: 'Kill', onClick: onKill, disabled: exited, title: exited ? 'Already exited' : `Kill ${session.name}` },
        {
          label: 'Resume',
          onClick: onResume,
          disabled: !exited,
          title: exited ? resumeTitle(session) : 'Still running',
        },
        { label: 'Remove', onClick: onRemove, disabled: !exited, title: exited ? `Forget ${session.name}` : 'Kill it first' },
        { label: 'Mark unread', onClick: onMarkUnread, disabled: !markable, title: markTitle, separator: true },
        { label: hushed ? 'Unhush' : 'Hush', onClick: () => onHush(!hushed), disabled: !hushable, title: hushTitle },
        // M64: the session's changes as a diff to comment on and send
        // back, above Open transcript: the two items that open a
        // read-only tab for a row, kept together.
        {
          label: 'Review changes',
          onClick: () => {
            onClose();
            openReviewTab(session.id);
          },
          disabled: changed === 0,
          hint: changed === null || changed === 0 ? undefined : `${changed} ${changed === 1 ? 'file' : 'files'}`,
          title: changed === 0 ? 'Nothing changed in this worktree' : `The changes in ${session.cwd} as a diff, with comments sent back as one prompt (Ctrl+Shift+R)`,
          separator: true,
        },
        // M9 fix 85: the conversation's transcript as a read-only tab,
        // the way a file from the rail opens; the path is the one every
        // hook reports (M47), so a shell that never ran Claude has none.
        {
          label: 'Open transcript',
          onClick: () => {
            onClose();
            if (session.transcriptPath !== null) openTranscriptTab(session.transcriptPath, 'raw');
          },
          disabled: session.transcriptPath === null,
          title: session.transcriptPath ?? 'No Claude conversation in this session yet',
        },
      ]}
    />
  );
}

// The chime setting, cycled by a click: repeats until acknowledged, once
// per arrival, or off. The press must not count as an acknowledge, and
// attention.ts skips it by this class name.
const SOUND_TITLES: Record<AttentionSound, string> = {
  repeat: 'Chime when a session needs you, every 4 s until you click or type. Click for once only.',
  once: 'Chime once when a session needs you. Click to turn the chime off.',
  off: 'No chime; the row still pulses. Click to chime until you click or type.',
};

// A right click opens a menu with the sound and the notification settings,
// so the footer stays one button (M14 task 3). The menu carries the
// attention-menu class for the same reason as the button.
const SOUND_LABELS: Record<AttentionSound, string> = {
  repeat: 'Chime until acknowledged',
  once: 'Chime once',
  off: 'No chime',
};

// M9 fix 47: a window on a private EMERALD_HOME says so on the button, since
// its chime is not the real one and a person driving a test app should
// not wait to hear it; nor a toast, which a muted window holds in its log
// (fix 49).
const CHIME_NOTES: Record<ChimeMode, string> = {
  real: '',
  muted: ' Muted and no notifications under a private EMERALD_HOME.',
  test: ' Test chime under a private EMERALD_HOME.',
};

function AttentionSoundButton() {
  const { attentionSound, attentionNotify, usageRecord, chimeMode } = useUi();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const onContextMenu = (ev: React.MouseEvent) => {
    ev.preventDefault();
    setMenu({ x: ev.clientX, y: ev.clientY });
  };
  const pick = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };
  return (
    <>
      <button
        className="attention-sound"
        data-sound={attentionSound}
        data-notify={attentionNotify ? 'on' : 'off'}
        data-usage={usageRecord ? 'on' : 'off'}
        data-chime={chimeMode}
        title={`${SOUND_TITLES[attentionSound]} Right click for the notification setting.${CHIME_NOTES[chimeMode]}`}
        onClick={cycleAttentionSound}
        onContextMenu={onContextMenu}
        onMouseDown={(ev) => ev.preventDefault()}
      >
        <SpeakerIcon sound={attentionSound} />
      </button>
      {menu !== null && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          className="attention-menu"
          items={[
            ...ATTENTION_SOUND_ORDER.map((sound) => ({
              label: SOUND_LABELS[sound],
              onClick: pick(() => setAttentionSound(sound)),
              hint: sound === attentionSound ? 'current' : undefined,
            })),
            {
              label: attentionNotify ? 'Notifications: on' : 'Notifications: off',
              onClick: pick(() => setAttentionNotify(!attentionNotify)),
              title: 'A system notification when a session needs you and the window is not focused. Click to turn it ' + (attentionNotify ? 'off' : 'on'),
              separator: true,
            },
            // M9 fix 676: the usage record, off until turned on here.
            {
              label: usageRecord ? 'Usage record: on' : 'Usage record: off',
              onClick: pick(() => setUsageRecord(!usageRecord)),
              title:
                'A local record of which emerald actions and views you use, for emmer usage report; kept in logs/usage.jsonl under your emerald home and never sent anywhere. Click to turn it ' +
                (usageRecord ? 'off' : 'on'),
            },
          ]}
        />
      )}
    </>
  );
}

const ATTENTION_SOUND_ORDER: readonly AttentionSound[] = ['repeat', 'once', 'off'];

// Dragging the right edge sets the width. Local state only: the daemon never
// hears about it, and it is written to localStorage on release.
function SidebarResizer({ width }: { width: number }) {
  const [dragging, setDragging] = useState(false);
  const onMouseDown = (ev: React.MouseEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startWidth = width;
    setDragging(true);
    document.body.classList.add('dragging-col');
    const onMove = (e: MouseEvent) => setSidebarWidth(startWidth + e.clientX - startX);
    const onUp = (e: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('dragging-col');
      setDragging(false);
      setSidebarWidth(startWidth + e.clientX - startX);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return (
    <div
      className={dragging ? 'sidebar-resizer dragging' : 'sidebar-resizer'}
      onMouseDown={onMouseDown}
      title={`Drag to resize (${SIDEBAR_MIN_WIDTH} to ${SIDEBAR_MAX_WIDTH} px)`}
    />
  );
}

