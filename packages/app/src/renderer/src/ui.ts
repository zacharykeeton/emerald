import { useSyncExternalStore } from 'react';
import { isShellId, isSidebarOrder } from '@emerald/shared';
import type { DesignNote, PaneView, SessionState, ShellId, SidebarOrder } from '@emerald/shared';
import type { SplitKind } from './pane-menu-model.ts';
import type { EmptyKind } from './empty-pane-model.ts';
import { acknowledge, emptyAttention, hushAll, isAttentionSound, markUnread, nextSound, observe, setHushed } from './attention-model.ts';
import type { AttentionModel, AttentionSound } from './attention-model.ts';
import type { DropZone, TabDropTarget } from './drop-zone-model.ts';
import type { CornerNote } from './copy-note.ts';
import { emptyFocusHistory, recordFocus, stepFocus } from './focus-history-model.ts';
import type { FocusEntry, FocusHistory } from './focus-history-model.ts';
import type { ChimeMode } from '../../preload/api.ts';
import { isDirty } from './file-edits.ts';
import { PANES, WHATS_NEW_PATH, activate, closeAll, closeFile, closeOthers, defaultView, rawAtLine, emptyTabs, isDocument, openFile, pinTab, renameTabs, setTabQuery, setView, tabKey, tabsFromJson } from './tabs-model.ts';
import { renamedPath } from './files-model.ts';
import { tabsKeyFor, windowIdFromSearch, windowOfTabsKey } from './window-keys.ts';
import { cycleKeys, currentKey, layoutTabOf, moveKey, orderFromJson, orderWithNew, replaceKey, stripOrder } from './tab-order.ts';
import type { FileTabView, TabsModel } from './tabs-model.ts';
import { reviewFolderPath, reviewPath } from './review-model.ts';
import type { ReviewBase } from './review-model.ts';
import { updateReview } from './review-state.ts';
import { restoreOpenedFolds } from './history-model.ts';
import type { StoredHistoryFolds } from './history-model.ts';
import { defaultSearchSettings, scopeUnder, searchSettingsFromJson } from './rail-search-model.ts';
import type { SearchMode, SearchSettings } from './rail-search-model.ts';
import type { RemovalCount } from './close-countdown-model.ts';
import { isSidebarFilter } from './sidebar-filter-model.ts';
import type { SidebarFilter } from './sidebar-filter-model.ts';
import { isShowOffscreen } from './show-model.ts';
import type { ShowOffscreen } from './show-model.ts';
import { WHATS_NEW_SEEN_KEY, shouldOpenWhatsNew, whatsNewStamp } from './whats-new-model.ts';
import { parseChatModes, parseChatPanes, serializeChatPanes } from './chat-model.ts';
import { parsePlan } from './plan-model.ts';
import { FILE_TEXT_PREFIX } from './pane-text.ts';
import type { PlanEntry } from './plan-model.ts';
import type { ChatMode } from './chat-model.ts';
import { onOtherWindowWrite } from './other-window.ts';

// Renderer-only state that the daemon has no business knowing: which pane has
// the session picker or the new-session dialog open, and how the sidebar is
// shown. Kept apart from store.ts so that file stays a pure mirror of the
// daemon. The sidebar settings survive a restart through localStorage; the
// picker and the dialog do not.

export interface UiState {
  pickerPaneId: string | null;
  // M9 fix 202: the picker opened in its action mode (the open-actions
  // key); the box starts with > and lists actions rather than sessions.
  pickerActions: boolean;
  // Pane the new-session dialog will fill; null when the dialog is closed.
  newSessionPaneId: string | null;
  // What the dialog starts with when it was opened from a folder heading's
  // + (M32): that folder, and a split beside the pane on Start rather
  // than the pane itself. null when opened from a pane.
  newSessionPreset: NewSessionPreset | null;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  // How the sidebar orders its rows (M32): as created, or by state. The
  // picker, the jump palette and the headings' rollup follow it. Kept in
  // localStorage.
  sidebarOrder: SidebarOrder;
  // Which rows the sidebar shows (M44): every one, the ones that need a
  // person, or the finished turns. Kept in localStorage like the order.
  sidebarFilter: SidebarFilter;
  // The folder groups folded away from their headings (M9 fix 64), by
  // group key. A folded group renders no rows; its heading keeps the
  // rollup. Kept in localStorage like the order.
  sidebarFolded: ReadonlySet<string>;
  // The rows whose team is listed under them (M9 fix 90), by session
  // id; folded by default. Kept in localStorage like the group folds.
  teamUnfolded: ReadonlySet<string>;
  // What a click on a row whose session is on no pane does when the
  // focused pane holds a live session (M9 fix 91): ask each time, replace
  // it, or open a pane beside it. Kept in localStorage like the order.
  showOffscreen: ShowOffscreen;
  // The files rail on the right edge, kept like the sidebar.
  filesCollapsed: boolean;
  filesWidth: number;
  // Which panel the rail shows: the file tree, the commits (the key is
  // timeline from when the tab was called that, M45) or the session
  // history.
  railTab: RailTab;
  // The tree's Changed toggle (M9 fix 70): on, the tree gives way to the
  // flat list of the repo's changed files. Kept in localStorage.
  filesChanged: boolean;
  // The activity card at the top of the sidebar (M54) folded to its text
  // line. Kept in localStorage.
  activityFolded: boolean;
  // The pane filling the window, or null. The layout in the daemon is
  // untouched: zoom is a way of looking at it, like the sidebar width.
  zoomedPaneId: string | null;
  // Where the focus has been (M9 fix 184): the panes and the file tabs
  // it landed on, walked by the strip's back and forward. Per window and
  // never persisted; it is where this person's eye went.
  focusHistory: FocusHistory;
  // The prefix key was pressed and the next key picks an action.
  prefixArmed: boolean;
  // A line for the prefix indicator's corner when no prefix is armed (M9
  // fix 201: "Nothing is waiting" after the jump key found nothing), gone
  // after a moment; null is the usual state. With the pane a copy came
  // from, or null for a note of the window's (M9 fix 849).
  cornerNote: CornerNote | null;
  cheatSheetOpen: boolean;
  // Design Mode (M9 fix 674): the browser pane in the mode, one per
  // window. Fix 675: each browser pane's tray of notes, by pane id, and
  // the pane whose tray is open; never persisted, so a reload empties it.
  designPaneId: string | null;
  designNotes: Readonly<Record<string, readonly DesignNote[]>>;
  designTrayPaneId: string | null;
  // M9 fix 248: a close that met unsaved edits, waiting on the person:
  // the file asked about and what to do once it is saved or discarded
  // (the close again, which asks about the next dirty file if there is
  // one). Keep open clears it and nothing closes.
  closeAsk: CloseAsk | null;
  // Terminal text size in px by pane id; a pane with no entry is at the
  // default. Ctrl+wheel moves the pane under the mouse, Ctrl+plus/minus the
  // focused one, Ctrl+0 puts it back. A split gives the new pane the size
  // of the one it came from. Kept in localStorage, pruned as panes close.
  fontSizes: ReadonlyMap<string, number>;
  // A sidebar row being dragged over the panes, and the pane and half it
  // would land in, or null when the mouse is not over a pane. Only these
  // go through the store: every consumer re-renders on a change, so the
  // ghost that follows the mouse moves on the DOM directly (pane-drag.ts).
  // A folder dragged in from Explorer uses the same slot with no session
  // (explorer-drop.ts), so the panes draw the same overlay for both.
  sessionDrag: SessionDrag | null;
  // The tab strip: the panes and the files opened from the files rail.
  // Kept in localStorage so a restart brings the files back.
  tabs: TabsModel;
  // The order of the tabs on the strip (M9 fix 182): layout keys and file
  // keys mixed, kept in the same localStorage entry as the tabs, read
  // against what exists by stripOrder (tab-order.ts).
  tabOrder: readonly string[];
  // What a transcript tab is called once its view has read the
  // conversation's title (M9 fix 96): by tab path, not persisted, pruned
  // as tabs close; the strip prints the session id until then.
  tabTitles: ReadonlyMap<string, string>;
  // A line to show once a file tab is in: a contents hit clicked in the
  // rail (M27). One-shot, taken by the file view and never persisted;
  // seq makes a second click on the same hit count.
  reveal: Reveal | null;
  // A conversation to show in the rail's Sessions tab (M60, the lane card's
  // Transcript): its Claude session id, one-shot like reveal, taken by
  // the history panel once it has the row.
  revealConversation: RevealConversation | null;
  // A file to show in the Files rail (M9 fix 652, Reveal in Files):
  // one-shot like revealConversation, taken by the rail once its tree
  // holds the row or once it gives up.
  revealFile: RevealFile | null;
  // The rail's search mode and scope (M27), kept in localStorage so a
  // reload finds Contents and the scoped folder still set.
  search: SearchSettings;
  // The History panel's search text (M9 fix 367), in the rail search's
  // shape: kept here rather than the panel's own state so a rail
  // collapse, which unmounts the panel, does not lose it.
  historySearch: string;
  // Which of the History panel's projects are folded (M9 fix 417), here
  // for the same reason as the search above it. In memory only, not
  // localStorage: a fresh window folds from its own first scan.
  historyFolds: HistoryFolds;
  // Sessions that went to needs-input, done or errored and nobody has
  // clicked or typed since (attention-model.ts); per window, starts empty.
  attention: AttentionModel;
  // Whether a session arriving in that set chimes: never, once, or every
  // few seconds until acknowledged. Kept in localStorage.
  attentionSound: AttentionSound;
  // Whether an arrival while the window is not focused also posts a system
  // notification. Kept in localStorage beside the sound.
  attentionNotify: boolean;
  // Whether the usage record (M9 fix 676) writes logs/usage.jsonl. Off
  // until switched on from the app menu under the mark (M9 fix 887), kept
  // beside the two above.
  usageRecord: boolean;
  // Which chime this window plays (M9 fix 47): the real one, a muted one
  // under a private EMERALD_HOME, or the test chime when the run asked to
  // hear one. From the main process at start; real until it answers.
  chimeMode: ChimeMode;
  // Panes with a find bar open (M26), each with a count that goes up on
  // every open so a press while the bar is already there refocuses its
  // box. Not persisted: a split starts without one and so does a reload.
  findOpen: ReadonlyMap<string, number>;
  // Rows whose prompt from the sidebar's box did not get the session
  // working in time (M56): the row flashes and says so for a moment.
  stalled: ReadonlySet<string>;
  // M9 fix 787: the Exited rows counting down to their removal after a close, by session id. Not persisted: a reload or a closed window leaves the row under Exited, which fails safe.
  removing: ReadonlyMap<string, RemovalCount>;
  // M9 fix 842: Claude sessions whose pane is dropping to a shell after /exit (fix 813), from before the shell's spawn to the end of the drop; a pane on one hides its terminal meanwhile. Not persisted.
  dropping: ReadonlySet<string>;
  // Panes with the shade pulled over them (M63): the terminal hidden
  // behind one calm face. By pane id, kept in localStorage so a reload
  // finds the wall as calm as it was left; pruned as panes close.
  shadedPanes: ReadonlySet<string>;
  // The shaded panes the idle timer shaded rather than a person (M63):
  // a focus, a click or a key into one lifts it. Per window.
  autoShaded: ReadonlySet<string>;
  // The panes showing the chat view rather than the terminal (M9 fix
  // 689), each with the session it was turned to chat on: a pane shown
  // another session is on the terminal at once. Kept in localStorage as
  // the shade is; pruned as panes close.
  chatPanes: ReadonlyMap<string, string>;
  // What each chat pane's timeline shows (M9 fix 714), absent for
  // Normal; kept with the face in the same key and dropped with it.
  chatModes: ReadonlyMap<string, ChatMode>;
  // Minutes a pane's session sits idle, done or exited with no key into
  // the pane before the shade comes down by itself (M63); 0 for never,
  // the default. Kept in localStorage.
  shadeAfter: number;
  // Whether a selection in a terminal pane is copied as the mouse is let
  // go (M9 fix 441), as in PuTTY; off by default, set from the shade
  // button's menu beside the idle shade. Kept in localStorage.
  copyOnSelect: boolean;
  // What a plain click on a split button gives (M9 fixes 343, 537): the
  // title buttons, the empty pane's buttons and the pane menu's Split
  // items read this, an empty pane until the person picks a shell or a
  // Claude. The chords and the palette's Split keys always give an empty
  // pane. Kept in localStorage.
  splitKind: SplitKind;
  // The folder a pane was split from (M9 fix 546), for the empty pane's
  // first row. Not persisted; an entry goes once its pane holds a session
  // or a view, or closes.
  splitFolder: ReadonlyMap<string, string>;
  // Whether the file editor wraps long lines at the width (M9 fix 338):
  // one setting per window, on by default, kept in localStorage; Alt+Z
  // in the editor, the header's Wrap button and the file menu flip it.
  wrapLines: boolean;
  // The person's Claude plan over time (M9 fix 838), for the Statistics
  // tab's subscription line; the window's, not a folder's. Kept in
  // localStorage.
  plan: PlanEntry[];
}

export type RailTab = 'files' | 'timeline' | 'history' | 'stats';
// A 'changes' saved before fix 70 folded the tab into Files falls back
// to the tree.
export const RAIL_TABS: readonly RailTab[] = ['files', 'timeline', 'history', 'stats'];

export interface NewSessionPreset {
  folder: string;
  split: boolean;
  // Set by the empty pane's More... alone (M9 fix 723): the dialog's Start then opens a Claude session on the face the `opens on` pair picks, read at the click.
  opensOn?: true;
}

export interface CloseAsk {
  path: string;
  proceed: () => void;
}

// The History panel's folds (M9 fix 417).
export interface HistoryFolds {
  // The projects folded shut, by their path.
  collapsed: ReadonlySet<string>;
  // The focused session the fix 84 fold last ran for, or false before
  // the window's first scan. The panel folds again when the focus moves
  // to another session, as it always has, but a remount (a rail
  // collapse, a tab switch) is not a move, so the folds ride across it.
  foldedFor: string | null | false;
}

export interface Reveal {
  path: string;
  line: number;
  // The cursor's column on the line; a contents hit gives its match's.
  column: number;
  seq: number;
  // The file pane the reveal is for (M9 fix 437: a contents hit dropped
  // on a pane); a tab's reveal has none, and each view takes only its own.
  paneId?: string;
}

export interface DropTarget {
  paneId: string;
  zone: DropZone;
}

export interface SessionDrag {
  // null while the drag is a folder or a file from outside the window,
  // or a view (M52).
  sessionId: string | null;
  // The view a drag off the rail's Commits tab carries (M52), null for
  // every other drag.
  view: PaneView | null;
  target: DropTarget | null;
  // the layout tab or the + under a drag, M9 fix 651; set only while
  // target is null.
  tabTarget: TabDropTarget | null;
  // true while a drag from outside is known to be a file rather than a
  // folder, so a pane with a session lights whole (its path will be typed)
  // and not by band (a shell would split it).
  file: boolean;
}

export const FONT_SIZE_DEFAULT = 14;
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
const FONT_SIZES_KEY = 'emerald.fontSizes';

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 260;
// M9 fix 885: the rail's default fits four tabs' words (Files, Activity, Sessions, Stats); the sidebar keeps 260. SIDEBAR_MAX_WIDTH (600) is above it.
const RAIL_DEFAULT_WIDTH = 330;
const STORAGE_KEY = 'emerald.sidebar';
const FILES_KEY = 'emerald.files';
// The document tabs' key is this window's own (M9 fix 867, window-keys.ts):
// read off the page's URL at load, and moved once the main process names
// the window (adoptWindowTabs) when the URL could not say.
let tabsKey = tabsKeyFor(windowIdFromSearch(typeof location === 'undefined' ? '' : location.search));
const RAIL_TAB_KEY = 'emerald.railTab';
const FILES_CHANGED_KEY = 'emerald.filesChanged';
const ATTENTION_KEY = 'emerald.attention';
const SEARCH_KEY = 'emerald.search';
const HISTORY_SEARCH_KEY = 'emerald.historySearch';
// M9 fix 439: the groups opened by hand for whichever session is
// currently focused, so the fold effect's first run after a reload can
// put them back before the panel ever draws (historyFolds itself, above,
// never touches localStorage).
const HISTORY_FOLDS_KEY = 'emerald.historyFolds';
const ORDER_KEY = 'emerald.sidebarOrder';
const FILTER_KEY = 'emerald.sidebarFilter';
const FOLDED_KEY = 'emerald.sidebarFolded';
const TEAM_KEY = 'emerald.teamUnfolded';
const SHOW_OFFSCREEN_KEY = 'emerald.showOffscreen';
const ACTIVITY_FOLDED_KEY = 'emerald.activityFolded';
const SHADED_KEY = 'emerald.shadedPanes';
const CHAT_KEY = 'emerald.chatPanes';
const CLAUDE_OPENS_ON_KEY = 'emerald.claudeOpensOn';
const SHADE_AFTER_KEY = 'emerald.shadeAfter';
const COPY_ON_SELECT_KEY = 'emerald.copyOnSelect';
const SPLIT_KIND_KEY = 'emerald.splitKind';
const EMPTY_PANE_KIND_KEY = 'emerald.emptyPaneKind';
const EMPTY_PANE_SHELL_KEY = 'emerald.emptyPaneShell';
const WRAP_LINES_KEY = 'emerald.wrapLines';
const PLAN_KEY = 'emerald.plan';
// A contents hit dropped outside every window (M9 fix 948): the source
// window makes the pane's tab and moves it to a new window, whose page has
// a ui state of its own, so the reveal goes across in storage, one shot,
// and the new page takes it at its load. Ten seconds, the span of
// window-drag.ts's DROP_PLACEMENT_MS; the page loads in well under it.
const REVEAL_HANDOFF_KEY = 'emerald.revealHandoff';
export const REVEAL_HANDOFF_MS = 10_000;

let state: UiState = {
  pickerPaneId: null,
  pickerActions: false,
  newSessionPaneId: null,
  newSessionPreset: null,
  zoomedPaneId: null,
  focusHistory: emptyFocusHistory(),
  prefixArmed: false,
  cornerNote: null,
  cheatSheetOpen: false,
  designPaneId: null,
  designNotes: {},
  designTrayPaneId: null,
  closeAsk: null,
  fontSizes: loadFontSizes(),
  sessionDrag: null,
  tabs: loadTabs(),
  tabOrder: loadTabOrder(),
  tabTitles: new Map(),
  reveal: loadRevealHandoff(),
  revealConversation: null,
  revealFile: null,
  search: loadSearch(),
  historySearch: loadHistorySearch(),
  historyFolds: { collapsed: new Set(), foldedFor: false },
  attention: emptyAttention(),
  ...loadAttentionSettings(),
  chimeMode: 'real',
  findOpen: new Map(),
  stalled: new Set(),
  removing: new Map(),
  dropping: new Set(),
  railTab: loadRailTab(),
  filesChanged: loadFilesChanged(),
  activityFolded: loadActivityFolded(),
  sidebarOrder: loadSidebarOrder(),
  sidebarFilter: loadSidebarFilter(),
  sidebarFolded: loadSidebarFolded(),
  teamUnfolded: loadIds(TEAM_KEY),
  showOffscreen: loadShowOffscreen(),
  shadedPanes: loadIds(SHADED_KEY),
  autoShaded: new Set(),
  chatPanes: loadChatPanes(),
  chatModes: loadChatModes(),
  shadeAfter: loadShadeAfter(),
  copyOnSelect: loadCopyOnSelect(),
  splitKind: loadSplitKind(),
  splitFolder: new Map(),
  wrapLines: loadWrapLines(),
  plan: loadPlan(),
  ...loadSidebar(),
  ...loadFiles(),
};
const listeners = new Set<() => void>();

function setState(next: UiState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getUiState(): UiState {
  return state;
}

export function subscribeUi(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUi(): UiState {
  return useSyncExternalStore(subscribeUi, getUiState);
}

// The plan list alone (M9 fix 885): every setState but setPlan keeps its identity, so a reader of the plan does not render on the rest of the UI state.
export function usePlan(): PlanEntry[] {
  return useSyncExternalStore(subscribeUi, () => state.plan);
}

export function openPicker(paneId: string, mode: 'sessions' | 'actions' = 'sessions'): void {
  setState({ ...state, pickerPaneId: paneId, pickerActions: mode === 'actions' });
}

export function closePicker(): void {
  if (state.pickerPaneId !== null) setState({ ...state, pickerPaneId: null, pickerActions: false });
}

export function openNewSession(paneId: string, preset: NewSessionPreset | null = null): void {
  setState({ ...state, newSessionPaneId: paneId, newSessionPreset: preset, pickerPaneId: null });
}

export function closeNewSession(): void {
  if (state.newSessionPaneId !== null) setState({ ...state, newSessionPaneId: null, newSessionPreset: null });
}

export function toggleZoom(paneId: string): void {
  setState({ ...state, zoomedPaneId: state.zoomedPaneId === paneId ? null : paneId });
}

export function clearZoom(): void {
  if (state.zoomedPaneId !== null) setState({ ...state, zoomedPaneId: null });
}

export function recordFocusHistory(entry: FocusEntry): void {
  const focusHistory = recordFocus(state.focusHistory, entry);
  if (focusHistory !== state.focusHistory) setState({ ...state, focusHistory });
}

export function stepFocusHistory(at: number): void {
  const focusHistory = stepFocus(state.focusHistory, at);
  if (focusHistory !== state.focusHistory) setState({ ...state, focusHistory });
}

export function setPrefixArmed(armed: boolean): void {
  if (state.prefixArmed !== armed) setState({ ...state, prefixArmed: armed });
}

// Shows a line in the corner for a moment. A second note before the first
// has gone replaces it and restarts the clock.
let cornerTimer: ReturnType<typeof setTimeout> | null = null;
export const CORNER_NOTE_MS = 2000;

export function flashCornerNote(text: string, paneId: string | null = null): void {
  if (cornerTimer !== null) clearTimeout(cornerTimer);
  setState({ ...state, cornerNote: { text, paneId } });
  cornerTimer = setTimeout(() => {
    cornerTimer = null;
    if (state.cornerNote !== null) setState({ ...state, cornerNote: null });
  }, CORNER_NOTE_MS);
}

// Design Mode on one browser pane, or off (M9 fix 674); turning it on
// for one pane turns it off for any other.
export function setDesignPane(paneId: string | null): void {
  if (state.designPaneId !== paneId) setState({ ...state, designPaneId: paneId });
}

// A pane's tray (M9 fix 675): its notes, and whether it is the open one.
export function setDesignNotes(paneId: string, update: (notes: readonly DesignNote[]) => readonly DesignNote[]): void {
  setState({ ...state, designNotes: { ...state.designNotes, [paneId]: update(state.designNotes[paneId] ?? []) } });
}

export function setDesignTray(paneId: string | null): void {
  if (state.designTrayPaneId !== paneId) setState({ ...state, designTrayPaneId: paneId });
}

export function openCheatSheet(): void {
  setState({ ...state, cheatSheetOpen: true });
}

export function closeCheatSheet(): void {
  if (state.cheatSheetOpen) setState({ ...state, cheatSheetOpen: false });
}

export function openFind(paneId: string): void {
  const findOpen = new Map(state.findOpen);
  findOpen.set(paneId, (findOpen.get(paneId) ?? 0) + 1);
  setState({ ...state, findOpen });
}

export function closeFind(paneId: string): void {
  if (!state.findOpen.has(paneId)) return;
  const findOpen = new Map(state.findOpen);
  findOpen.delete(paneId);
  setState({ ...state, findOpen });
}

export function beginSessionDrag(sessionId: string | null, file = false): void {
  setState({ ...state, sessionDrag: { sessionId, view: null, target: null, tabTarget: null, file } });
}

export function beginViewDrag(view: PaneView): void {
  setState({ ...state, sessionDrag: { sessionId: null, view, target: null, tabTarget: null, file: false } });
}

// The explorer drag learns what it carries as it goes (the kind is read
// off the items on each dragover), so the flag can change mid-drag.
export function setSessionDragFile(file: boolean): void {
  const drag = state.sessionDrag;
  if (drag === null || drag.file === file) return;
  setState({ ...state, sessionDrag: { ...drag, file } });
}

// Skips the update when the pane and half are the same, so a mouse moving
// within one half of a pane costs no render.
export function setSessionDropTarget(target: DropTarget | null): void {
  const drag = state.sessionDrag;
  if (drag === null) return;
  const same = drag.target === target || (drag.target !== null && target !== null && drag.target.paneId === target.paneId && drag.target.zone === target.zone);
  if (same && drag.tabTarget === null) return;
  setState({ ...state, sessionDrag: { ...drag, target, tabTarget: null } });
}

// A layout tab or the + under the drag (M9 fix 651), which clears the
// pane target; skipped when the drag already holds the same one.
export function setTabDropTarget(tabTarget: TabDropTarget): void {
  const drag = state.sessionDrag;
  if (drag === null) return;
  const held = drag.tabTarget;
  const same = held !== null && (('newTab' in held && 'newTab' in tabTarget) || ('tabId' in held && 'tabId' in tabTarget && held.tabId === tabTarget.tabId));
  if (same && drag.target === null) return;
  setState({ ...state, sessionDrag: { ...drag, target: null, tabTarget } });
}

export function endSessionDrag(): void {
  if (state.sessionDrag !== null) setState({ ...state, sessionDrag: null });
}

export function toggleSidebar(): void {
  setState({ ...state, sidebarCollapsed: !state.sidebarCollapsed });
  saveSidebar();
}

export function setSidebarWidth(width: number): void {
  const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
  if (clamped === state.sidebarWidth) return;
  setState({ ...state, sidebarWidth: clamped });
  saveSidebar();
}

export function setSidebarOrder(order: SidebarOrder): void {
  if (order === state.sidebarOrder) return;
  setState({ ...state, sidebarOrder: order });
  try {
    localStorage.setItem(ORDER_KEY, order);
  } catch {
    // The choice just will not survive the restart.
  }
}

function loadSidebarOrder(): SidebarOrder {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    return isSidebarOrder(raw) ? raw : 'created';
  } catch {
    return 'created';
  }
}

export function setSidebarFilter(filter: SidebarFilter): void {
  if (filter === state.sidebarFilter) return;
  setState({ ...state, sidebarFilter: filter });
  try {
    localStorage.setItem(FILTER_KEY, filter);
  } catch {
    // The choice just will not survive the restart.
  }
}

function loadSidebarFilter(): SidebarFilter {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    return isSidebarFilter(raw) ? raw : 'all';
  } catch {
    return 'all';
  }
}

export function toggleSidebarFold(folder: string): void {
  // From the stored set, not this window's (M9 fix 949): a group another
  // window folded since this one loaded stays folded.
  const folded = new Set(loadIds(FOLDED_KEY));
  if (!folded.delete(folder)) folded.add(folder);
  setState({ ...state, sidebarFolded: folded });
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded]));
  } catch {
    // The fold just will not survive the restart.
  }
}

export function setShowOffscreen(mode: ShowOffscreen): void {
  if (mode === state.showOffscreen) return;
  setState({ ...state, showOffscreen: mode });
  try {
    localStorage.setItem(SHOW_OFFSCREEN_KEY, mode);
  } catch {
    // The choice just will not survive the restart.
  }
}

function loadShowOffscreen(): ShowOffscreen {
  try {
    const raw = localStorage.getItem(SHOW_OFFSCREEN_KEY);
    return isShowOffscreen(raw) ? raw : 'ask';
  } catch {
    return 'ask';
  }
}

function loadSidebarFolded(): ReadonlySet<string> {
  return loadIds(FOLDED_KEY);
}

function loadIds(key: string): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : []);
  } catch {
    // A corrupt entry just means every group is open.
    return new Set();
  }
}

// A row's team list folds and unfolds (M9 fix 90). Ids of sessions no
// longer listed are dropped as the set is written, so it never grows.
export function toggleTeamUnfold(sessionId: string, listed: ReadonlySet<string>): void {
  const unfolded = new Set([...state.teamUnfolded].filter((id) => listed.has(id)));
  if (!unfolded.delete(sessionId)) unfolded.add(sessionId);
  setState({ ...state, teamUnfolded: unfolded });
  try {
    localStorage.setItem(TEAM_KEY, JSON.stringify([...unfolded]));
  } catch {
    // The fold just will not survive the restart.
  }
}

// The shade (M63). A shade pulled by hand and one the idle timer pulled
// are the same set to the pane, and differ in what lifts them: a focus
// into an auto-shaded pane lifts it, since a person arrived, while a
// hand-pulled one waits for a click or a key.
export function shadePane(paneId: string, auto = false): void {
  if (state.shadedPanes.has(paneId)) return;
  // M9 fix 926: from what is stored, so another window's shades stay.
  const shadedPanes = new Set(loadIds(SHADED_KEY)).add(paneId);
  const autoShaded = new Set(state.autoShaded);
  if (auto) autoShaded.add(paneId);
  else autoShaded.delete(paneId);
  setState({ ...state, shadedPanes, autoShaded });
  saveShaded();
}

export function liftPane(paneId: string): void {
  if (!state.shadedPanes.has(paneId)) return;
  const shadedPanes = new Set(loadIds(SHADED_KEY));
  shadedPanes.delete(paneId);
  const autoShaded = new Set(state.autoShaded);
  autoShaded.delete(paneId);
  setState({ ...state, shadedPanes, autoShaded });
  saveShaded();
}

// Shade all and Lift all on a layout tab: its panes at once.
export function shadePanes(paneIds: Iterable<string>): void {
  const shadedPanes = new Set(loadIds(SHADED_KEY));
  const autoShaded = new Set(state.autoShaded);
  for (const id of paneIds) {
    shadedPanes.add(id);
    autoShaded.delete(id);
  }
  setState({ ...state, shadedPanes, autoShaded });
  saveShaded();
}

export function liftPanes(paneIds: Iterable<string>): void {
  const shadedPanes = new Set(loadIds(SHADED_KEY));
  const autoShaded = new Set(state.autoShaded);
  for (const id of paneIds) {
    shadedPanes.delete(id);
    autoShaded.delete(id);
  }
  setState({ ...state, shadedPanes, autoShaded });
  saveShaded();
}

// A closed pane takes its shade with it, so a pane id never sits in
// storage for good (pruneFontSizes does the same for the sizes).
export function pruneShaded(livePaneIds: ReadonlySet<string>): void {
  if ([...state.shadedPanes].every((id) => livePaneIds.has(id))) return;
  const shadedPanes = new Set([...loadIds(SHADED_KEY)].filter((id) => livePaneIds.has(id)));
  const autoShaded = new Set([...state.autoShaded].filter((id) => livePaneIds.has(id)));
  setState({ ...state, shadedPanes, autoShaded });
  saveShaded();
}

// The chat face (M9 fix 689): a pane on the chat view or back on its
// terminal, kept against the session it shows.
export function setChatFace(paneId: string, sessionId: string, chat: boolean): void {
  const has = state.chatPanes.get(paneId) === sessionId;
  if (has === chat && (chat || !state.chatPanes.has(paneId))) return;
  // M9 fix 926: from what is stored, so another window's faces stay.
  const chatPanes = new Map(loadChatPanes());
  if (chat) chatPanes.set(paneId, sessionId);
  else chatPanes.delete(paneId);
  // A face turned on opens on Normal, and leaving it leaves the mode.
  const chatModes = new Map(loadChatModes());
  chatModes.delete(paneId);
  setState({ ...state, chatPanes, chatModes });
  saveChatPanes();
}

// M9 fix 714: a chat pane's view mode, kept as long as its face is.
export function setChatMode(paneId: string, mode: ChatMode): void {
  if (!state.chatPanes.has(paneId) || (state.chatModes.get(paneId) ?? 'normal') === mode) return;
  const chatModes = new Map(loadChatModes());
  if (mode === 'normal') chatModes.delete(paneId);
  else chatModes.set(paneId, mode);
  setState({ ...state, chatPanes: loadChatPanes(), chatModes });
  saveChatPanes();
}

// A closed pane takes its face with it, as pruneShaded does the shade.
export function pruneChatPanes(livePaneIds: ReadonlySet<string>): void {
  if ([...state.chatPanes.keys()].every((id) => livePaneIds.has(id))) return;
  const chatPanes = new Map([...loadChatPanes()].filter(([id]) => livePaneIds.has(id)));
  const chatModes = new Map([...loadChatModes()].filter(([id]) => livePaneIds.has(id)));
  setState({ ...state, chatPanes, chatModes });
  saveChatPanes();
}

function loadChatPanes(): Map<string, string> {
  try {
    return parseChatPanes(localStorage.getItem(CHAT_KEY));
  } catch {
    return new Map();
  }
}

function loadChatModes(): Map<string, ChatMode> {
  try {
    return parseChatModes(localStorage.getItem(CHAT_KEY));
  } catch {
    return new Map();
  }
}

function saveChatPanes(): void {
  try {
    localStorage.setItem(CHAT_KEY, serializeChatPanes(state.chatPanes, state.chatModes));
  } catch {
    // The faces just will not survive the restart.
  }
}

export function setShadeAfter(minutes: number): void {
  const shadeAfter = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  if (shadeAfter === state.shadeAfter) return;
  setState({ ...state, shadeAfter });
  try {
    localStorage.setItem(SHADE_AFTER_KEY, String(shadeAfter));
  } catch {
    // The setting just will not survive the restart.
  }
}

function saveShaded(): void {
  try {
    localStorage.setItem(SHADED_KEY, JSON.stringify([...state.shadedPanes]));
  } catch {
    // The shades just will not survive the restart.
  }
}

// Any positive number of minutes; the menu offers whole ones, and a
// verify script sets a fraction so the timer fires in seconds.
function loadShadeAfter(): number {
  try {
    const n = Number(localStorage.getItem(SHADE_AFTER_KEY) ?? '0');
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

// M9 fix 441: copy on select, off until the person turns it on.
export function setCopyOnSelect(on: boolean): void {
  if (on === state.copyOnSelect) return;
  setState({ ...state, copyOnSelect: on });
  try {
    localStorage.setItem(COPY_ON_SELECT_KEY, on ? 'on' : 'off');
  } catch {
    // The setting just will not survive the restart.
  }
}

function loadCopyOnSelect(): boolean {
  try {
    return localStorage.getItem(COPY_ON_SELECT_KEY) === 'on';
  } catch {
    return false;
  }
}

// M9 fixes 343, 537: the default a split gives, set from a right-click on
// either title button; an empty pane until the person says otherwise.
export function setSplitKind(kind: SplitKind): void {
  if (kind === state.splitKind) return;
  setState({ ...state, splitKind: kind });
  try {
    localStorage.setItem(SPLIT_KIND_KEY, kind);
  } catch {
    // The setting just will not survive the restart.
  }
}

function loadSplitKind(): SplitKind {
  try {
    const v = localStorage.getItem(SPLIT_KIND_KEY);
    return v === 'shell' || v === 'claude' ? v : 'empty';
  } catch {
    return 'empty';
  }
}

// The kind last started from an empty pane (M9 fix 546), which a fresh
// empty pane selects while the split default is an empty pane.
export function loadEmptyPaneKind(): EmptyKind | null {
  try {
    const v = localStorage.getItem(EMPTY_PANE_KIND_KEY);
    return v === 'shell' || v === 'claude' ? v : null;
  } catch {
    return null;
  }
}

export function rememberEmptyPaneKind(kind: EmptyKind): void {
  try {
    localStorage.setItem(EMPTY_PANE_KIND_KEY, kind);
  } catch {
    // A failed write just means the default does not follow.
  }
}

// The face a Claude session started from the empty pane opens on (M9 fix
// 689), the `opens on` pair's pick; the terminal unless Chat was picked.
export function loadClaudeOpensOn(): 'terminal' | 'chat' {
  try {
    return localStorage.getItem(CLAUDE_OPENS_ON_KEY) === 'chat' ? 'chat' : 'terminal';
  } catch {
    return 'terminal';
  }
}

export function rememberClaudeOpensOn(face: 'terminal' | 'chat'): void {
  try {
    localStorage.setItem(CLAUDE_OPENS_ON_KEY, face);
  } catch {
    // A failed write just means the pick does not follow.
  }
}

// The shell the empty pane's Shell tile starts when it is not the
// daemon's default (M9 fix 647), remembered at the pick.
export function loadEmptyPaneShell(): ShellId | null {
  try {
    const v = localStorage.getItem(EMPTY_PANE_SHELL_KEY);
    return isShellId(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberEmptyPaneShell(shell: ShellId | null): void {
  try {
    if (shell === null) localStorage.removeItem(EMPTY_PANE_SHELL_KEY);
    else localStorage.setItem(EMPTY_PANE_SHELL_KEY, shell);
  } catch {
    // A failed write just means the pick does not follow.
  }
}

// Where a split pane came from (M9 fix 546).
export function setSplitFolder(paneId: string, folder: string): void {
  if (state.splitFolder.get(paneId) === folder) return;
  const splitFolder = new Map(state.splitFolder);
  splitFolder.set(paneId, folder);
  setState({ ...state, splitFolder });
}

// Keeps the entries of panes that are still empty; a pane that took a
// session or a view, or closed, has no use for one.
export function pruneSplitFolders(emptyPaneIds: ReadonlySet<string>): void {
  if ([...state.splitFolder.keys()].every((id) => emptyPaneIds.has(id))) return;
  const splitFolder = new Map([...state.splitFolder].filter(([id]) => emptyPaneIds.has(id)));
  setState({ ...state, splitFolder });
}

export function setWrapLines(on: boolean): void {
  if (on === state.wrapLines) return;
  setState({ ...state, wrapLines: on });
  try {
    localStorage.setItem(WRAP_LINES_KEY, on ? 'on' : 'off');
  } catch {
    // The setting just will not survive the restart.
  }
}

export function toggleWrapLines(): void {
  setWrapLines(!state.wrapLines);
}

// On unless the key says off, so a fresh profile wraps.
function loadWrapLines(): boolean {
  try {
    return localStorage.getItem(WRAP_LINES_KEY) !== 'off';
  } catch {
    return true;
  }
}

// The plan list (M9 fix 838), set from the Statistics tab.
export function setPlan(plan: readonly PlanEntry[]): void {
  setState({ ...state, plan: [...plan] });
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  } catch {
    // The plan just will not survive the restart.
  }
}

function loadPlan(): PlanEntry[] {
  try {
    return parsePlan(localStorage.getItem(PLAN_KEY));
  } catch {
    return [];
  }
}

export function toggleFiles(): void {
  setState({ ...state, filesCollapsed: !state.filesCollapsed });
  saveFiles();
}

export function setFilesWidth(width: number): void {
  const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
  if (clamped === state.filesWidth) return;
  setState({ ...state, filesWidth: clamped });
  saveFiles();
}

export function setRailTab(tab: RailTab): void {
  if (tab === state.railTab) return;
  setState({ ...state, railTab: tab });
  try {
    localStorage.setItem(RAIL_TAB_KEY, tab);
  } catch {
    // The choice just will not survive the restart.
  }
}

export function setFilesChanged(on: boolean): void {
  if (on === state.filesChanged) return;
  setState({ ...state, filesChanged: on });
  try {
    localStorage.setItem(FILES_CHANGED_KEY, on ? '1' : '0');
  } catch {
    // The choice just will not survive the restart.
  }
}

export function toggleActivityFold(): void {
  const on = !state.activityFolded;
  setState({ ...state, activityFolded: on });
  try {
    localStorage.setItem(ACTIVITY_FOLDED_KEY, on ? '1' : '0');
  } catch {
    // The fold just will not survive the restart.
  }
}

function loadActivityFolded(): boolean {
  try {
    return localStorage.getItem(ACTIVITY_FOLDED_KEY) === '1';
  } catch {
    return false;
  }
}

function loadFilesChanged(): boolean {
  try {
    return localStorage.getItem(FILES_CHANGED_KEY) === '1';
  } catch {
    return false;
  }
}

function loadRailTab(): RailTab {
  try {
    const saved = localStorage.getItem(RAIL_TAB_KEY);
    return RAIL_TABS.find((t) => t === saved) ?? 'files';
  } catch {
    return 'files';
  }
}

// A collapsible panel's two settings as stored: { collapsed, width }.
// Corrupt or unavailable storage is not worth breaking the window over,
// so anything unusable is the default.
function loadPanel(key: string): { collapsed: boolean; width: number } {
  const fallback = { collapsed: false, width: RAIL_DEFAULT_WIDTH };
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const { collapsed, width } = parsed as { collapsed?: unknown; width?: unknown };
    return {
      collapsed: collapsed === true,
      // 260 was the old default: a profile that never moved the rail follows the new default.
      width: typeof width === 'number' && Number.isFinite(width) && width !== SIDEBAR_DEFAULT_WIDTH ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)) : RAIL_DEFAULT_WIDTH,
    };
  } catch {
    return fallback;
  }
}

function savePanel(key: string, collapsed: boolean, width: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ collapsed, width }));
  } catch {
    // The setting just will not survive the restart.
  }
}

// The sidebar's entry predates loadPanel and keeps its field names so an
// existing setting still loads.
function loadSidebar(): Pick<UiState, 'sidebarCollapsed' | 'sidebarWidth'> {
  const fallback = { sidebarCollapsed: false, sidebarWidth: SIDEBAR_DEFAULT_WIDTH };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const { sidebarCollapsed, sidebarWidth } = parsed as Partial<UiState>;
    return {
      sidebarCollapsed: sidebarCollapsed === true,
      sidebarWidth:
        typeof sidebarWidth === 'number' && Number.isFinite(sidebarWidth)
          ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, sidebarWidth))
          : SIDEBAR_DEFAULT_WIDTH,
    };
  } catch {
    return fallback;
  }
}

function saveSidebar(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebarCollapsed: state.sidebarCollapsed, sidebarWidth: state.sidebarWidth }));
  } catch {
    // Same as above: the setting just will not survive the restart.
  }
}

function loadFiles(): Pick<UiState, 'filesCollapsed' | 'filesWidth'> {
  const { collapsed, width } = loadPanel(FILES_KEY);
  return { filesCollapsed: collapsed, filesWidth: width };
}

function saveFiles(): void {
  savePanel(FILES_KEY, state.filesCollapsed, state.filesWidth);
}

function setTabs(tabs: TabsModel): void {
  if (tabs === state.tabs) return;
  let tabTitles = state.tabTitles;
  if ([...tabTitles.keys()].some((p) => !tabs.files.includes(p))) tabTitles = new Map([...tabTitles].filter(([p]) => tabs.files.includes(p)));
  // A closed file leaves the order; an opened one joins it at the end
  // (stripOrder would append it anyway, this keeps the kept list whole).
  // A preview tab whose path was replaced (M9 fix 203) keeps its spot.
  let tabOrder = state.tabOrder;
  const was = state.tabs.preview;
  if (was !== null && tabs.preview !== null && was !== tabs.preview && !tabs.files.includes(was) && !state.tabs.files.includes(tabs.preview)) tabOrder = replaceKey(tabOrder, was, tabs.preview);
  tabOrder = tabOrder.filter((k) => layoutTabOf(k) !== null || tabs.files.includes(k));
  for (const f of tabs.files) if (!tabOrder.includes(f)) tabOrder = [...tabOrder, f];
  setState({ ...state, tabs, tabTitles, tabOrder });
  saveTabs();
}

// The strip's order against the layout tabs that exist (M9 fix 182).
export function tabOrderFor(layoutTabIds: readonly string[]): string[] {
  return stripOrder(state.tabOrder, layoutTabIds, state.tabs.files);
}

// A tab dragged to a new place on the strip: before another tab, or at
// the end for null. The materialized order is written, so stale keys go.
export function moveTabKey(key: string, before: string | null, layoutTabIds: readonly string[]): void {
  const order = tabOrderFor(layoutTabIds);
  const moved = moveKey(order, key, before);
  if (moved === state.tabOrder) return;
  setState({ ...state, tabOrder: moved });
  saveTabs();
}

// A tab just made by the + or the group button (M9 fix 363) names its own
// last place on the strip; `oldLayoutTabIds` is read before the add, so
// the materialized order (tabOrderFor) does not already carry a guess at
// the new tab's spot.
export function placeNewTab(key: string, oldLayoutTabIds: readonly string[]): void {
  const order = orderWithNew(tabOrderFor(oldLayoutTabIds), state.tabs.files, key);
  if (order === state.tabOrder) return;
  setState({ ...state, tabOrder: order });
  saveTabs();
}

// Ctrl+PageDown and PageUp walk the strip's order (M9 fix 182): the key
// to go to, a file activated here, a layout tab handed back for the
// caller to show, since the daemon owns which tab is current.
export function cycleStripTab(delta: 1 | -1, layoutTabIds: readonly string[], currentTabId: string | null): string | null {
  const next = cycleKeys(tabOrderFor(layoutTabIds), currentKey(state.tabs.active, PANES, currentTabId), delta);
  if (next === null) return null;
  const id = layoutTabOf(next);
  setTabs(activate(state.tabs, id === null ? next : PANES));
  return id;
}

// The transcript view reports the conversation's title for its tab (M9
// fix 96); a path that is not a tab is ignored.
export function setTabTitle(path: string, title: string): void {
  if (!state.tabs.files.includes(path) || state.tabTitles.get(path) === title) return;
  setState({ ...state, tabTitles: new Map([...state.tabTitles, [path, title]]) });
}

// The rail's rename (M9 fix 574): every file tab on the renamed path or
// under a renamed folder keeps its place, its title and its preview or
// pinned state. Not through setTabs, whose order rule would drop the old
// key and append the new one at the end of the strip.
export function renameFileTabs(from: string, to: string): void {
  let moved = false;
  const move = (p: string): string => {
    const next = renamedPath(p, from, to);
    if (next === null || next === p) return p;
    moved = true;
    return next;
  };
  const tabs = renameTabs(state.tabs, from, to);
  if (tabs !== state.tabs) moved = true;
  const tabOrder = state.tabOrder.map((k) => (layoutTabOf(k) === null && !isDocument(k) ? move(k) : k));
  const tabTitles = new Map([...state.tabTitles].map(([k, v]) => [isDocument(k) ? k : move(k), v] as const));
  const entries = state.focusHistory.entries.map((e) => (e.kind === 'file' && !isDocument(e.path) ? { ...e, path: move(e.path) } : e));
  const focusHistory = { ...state.focusHistory, entries };
  const reveal = state.reveal === null ? null : { ...state.reveal, path: move(state.reveal.path) };
  const scope = state.search.scope === null ? null : move(state.search.scope);
  if (!moved) return;
  setState({ ...state, tabs, tabOrder, tabTitles, focusHistory, reveal });
  saveTabs();
  if (scope !== state.search.scope) setSearchScope(scope);
}

// The rail's delete (M9 fix 617): every file tab on the deleted path or
// under a deleted folder closes, forced, since a tab with unsaved edits
// never gets here (the menu's Delete is disabled on one).
export function closeFileTabsUnder(path: string): void {
  for (const f of [...state.tabs.files]) {
    if (isDocument(f) || renamedPath(f, path, path) === null) continue;
    closeFileTab(f, true);
  }
}

function saveTabs(): void {
  try {
    localStorage.setItem(tabsKey, JSON.stringify({ ...state.tabs, order: state.tabOrder }));
  } catch {
    // The tabs just will not survive the restart.
  }
}

// With a line the tab also gets a one-shot reveal. A file with a view of its own is switched to Raw for it, but markdown stays as it is and its rendered view scrolls to the block holding the line (M9 fix 892); a contents hit asks for the exact line (exactLine), so markdown goes to Raw for it too, as before.
// This opener pins (M9 fix 203); the rail's single click goes through
// `openPreviewTab`, which is the same open into the preview tab.
export function openFileTab(path: string, line?: number, column = 1): void {
  openTab(path, false, line, column, false);
}

export function openPreviewTab(path: string, line?: number, column = 1, exactLine = false): void {
  openTab(path, true, line, column, exactLine);
}

// The preview tab kept for good: the rail's double click on a file, a
// drag of the tab.
export function pinFileTab(path: string): void {
  setTabs(pinTab(state.tabs, path));
}

function openTab(path: string, preview: boolean, line: number | undefined, column: number, exactLine: boolean): void {
  let tabs = openFile(state.tabs, path, { preview });
  if (line === undefined) {
    setTabs(tabs);
    return;
  }
  if (exactLine ? defaultView(path) !== null : rawAtLine(path)) tabs = setView(tabs, path, 'raw');
  const reveal = { path, line, column, seq: (state.reveal?.seq ?? 0) + 1 };
  setState({ ...state, tabs, reveal });
  saveTabs();
}

// A transcript opened as its turns (Expand, M53) or as the raw file (Open
// transcript, fix 85): the same tab either way, switched to the view asked.
export function openTranscriptTab(path: string, view: 'turns' | 'raw'): void {
  setTabs(setView(openFile(state.tabs, path), path, view));
}

// A session's review (M64): a document tab keyed by the session, so a
// second Review changes on the same row comes back to the tab it has.
// With a file (M9 fix 199, a changed row's letter or its menu) the tab
// opens on that file, or moves to it when the tab is already open.
// M9 fix 790: with a base the review is put on it first (the chat view's
// diff chip asks for the session's start); with none the tab keeps the
// base the review holds.
export function openReviewTab(sessionId: string, file?: string, base?: ReviewBase): void {
  if (base !== undefined) updateReview(sessionId, (s) => ({ ...s, base }));
  setTabs(openFile(state.tabs, reviewPath(sessionId, file)));
}

// The review of a folder no session is in (M9 fix 199): a view pane's
// rail, or a folder whose session has gone. Keyed by the folder, so a
// second open comes back to the same tab.
export function openFolderReviewTab(folder: string, file?: string): void {
  setTabs(openFile(state.tabs, reviewFolderPath(folder, file)));
}

// The release notes as a tab (M9 fix 227), pinned, from the `whats-new`
// action; one tab however often it is asked for.
export function openWhatsNewTab(): void {
  setTabs(openFile(state.tabs, WHATS_NEW_PATH));
}

// At a start, once the notes have read: the tab opens pinned and active
// when the file's newest heading is not the one this profile last saw,
// and the heading is written as seen then and there, so the close is the
// dismissal and a fresh profile meets the current batch's notes once. A
// harness sets EMERALD_WHATS_NEW=off (autoOpen false) and writes nothing,
// so its profile never carries a stamp a later run would read. A read
// that fails opens nothing: an empty text has no heading.
export function openWhatsNewOnStart(): void {
  void window.emerald.whatsNew
    .read()
    .then((r) => {
      if (!r.autoOpen) return;
      const stamp = whatsNewStamp(r.text);
      let seen: string | null = null;
      try {
        seen = localStorage.getItem(WHATS_NEW_SEEN_KEY);
      } catch {
        // No storage: the tab opens, and will again next time.
      }
      if (!shouldOpenWhatsNew(stamp, seen)) return;
      openWhatsNewTab();
      try {
        localStorage.setItem(WHATS_NEW_SEEN_KEY, stamp!);
      } catch {
        // The stamp just will not survive the restart.
      }
    })
    .catch((err: unknown) => console.warn('[emerald] could not read the release notes', err));
}

// A contents hit dropped on a pane (M9 fix 437), or on another layout tab
// or the + (M9 fix 765, taken when that tab is shown): the pane the view
// landed on shows the line with the same flash a tab's reveal gives.
export function revealInPane(paneId: string, path: string, line: number, column = 1): void {
  setState({ ...state, reveal: { path, line, column, seq: (state.reveal?.seq ?? 0) + 1, paneId } });
}

// M9 fix 948: the reveal for a pane about to move to a new window, written
// for that window's page to take at its load. On a throw the new window
// opens the file at its top.
export function handRevealToNewWindow(paneId: string, path: string, line: number, column = 1): void {
  try {
    localStorage.setItem(REVEAL_HANDOFF_KEY, JSON.stringify({ paneId, path, line, column, at: Date.now() }));
  } catch {
    // no storage
  }
}

// Read once and removed whatever it held; a hand-off ten seconds old or
// more is another drop's, left unread.
export function loadRevealHandoff(now = Date.now()): Reveal | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(REVEAL_HANDOFF_KEY);
    if (raw !== null) localStorage.removeItem(REVEAL_HANDOFF_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const { paneId, path, line, column, at } = v as Record<string, unknown>;
  if (typeof paneId !== 'string' || typeof path !== 'string' || typeof line !== 'number' || typeof column !== 'number' || typeof at !== 'number') return null;
  const age = now - at;
  if (age < 0 || age >= REVEAL_HANDOFF_MS) return null;
  return { path, line, column, seq: 1, paneId };
}

// The file view has shown the line; a later open of the same tab starts
// where it was left, as before.
export function clearReveal(seq: number): void {
  if (state.reveal?.seq !== seq) return;
  setState({ ...state, reveal: null });
}

export function setSearchMode(mode: SearchMode): void {
  if (mode === state.search.mode) return;
  setSearch({ ...state.search, mode });
}

export function setSearchScope(scope: string | null): void {
  if (scope === state.search.scope) return;
  setSearch({ ...state.search, scope });
}

// The rail calls this when its root moves: a scope the root is no longer
// above is dropped (rail-search-model.ts).
export function keepSearchScopeUnder(root: string | null): void {
  setSearchScope(scopeUnder(state.search.scope, root));
}

function setSearch(search: SearchSettings): void {
  setState({ ...state, search });
  try {
    localStorage.setItem(SEARCH_KEY, JSON.stringify(search));
  } catch {
    // The setting just will not survive the restart.
  }
}

function loadSearch(): SearchSettings {
  try {
    const raw = localStorage.getItem(SEARCH_KEY);
    return raw === null ? defaultSearchSettings() : searchSettingsFromJson(JSON.parse(raw));
  } catch {
    return defaultSearchSettings();
  }
}

// M9 fix 367: the History panel's search, kept here so it survives the
// panel unmounting (a rail collapse hides it, `RailTab` switch, or the
// whole rail closing) rather than the panel's own state losing it.
export function setHistorySearch(text: string): void {
  if (text === state.historySearch) return;
  setState({ ...state, historySearch: text });
  try {
    localStorage.setItem(HISTORY_SEARCH_KEY, text);
  } catch {
    // The setting just will not survive the restart.
  }
}

function loadHistorySearch(): string {
  try {
    return localStorage.getItem(HISTORY_SEARCH_KEY) ?? '';
  } catch {
    return '';
  }
}

// M9 fix 417: the History panel's folds live here beside its search, so
// a rail collapse (which unmounts the panel) no longer throws away a
// group opened by hand. The fix 84 fold itself is the call below; the
// panel makes it on the window's first scan and whenever the focused
// session changes, and never for the same focus twice, which is how a
// remount leaves the folds alone.
//
// M9 fix 439: the groups opened by hand also go to localStorage, under
// HISTORY_FOLDS_KEY, `{ for, opened }` (history-model.ts's shape), so a
// reload's first fold can put them back (restoreOpenedFolds there) before
// the panel ever draws. `for` is the session the opened list belongs to;
// foldHistoryProjects clears it to the new focus's, empty, on every focus
// change (fix 84 kept it in memory the fix 417 fold set never persisted
// this rule for, since a hand-open has always been the current focus's
// business and not the project's), and the two hand actions add or drop
// their project from it.
function loadHistoryFoldsStore(): StoredHistoryFolds {
  try {
    const raw = localStorage.getItem(HISTORY_FOLDS_KEY);
    if (raw === null) return { for: null, opened: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { for: null, opened: [] };
    const rec = parsed as Record<string, unknown>;
    const forId = typeof rec['for'] === 'string' ? rec['for'] : null;
    const opened = Array.isArray(rec['opened']) ? rec['opened'].filter((p): p is string => typeof p === 'string') : [];
    return { for: forId, opened };
  } catch {
    return { for: null, opened: [] };
  }
}

function saveHistoryFoldsStore(next: StoredHistoryFolds): void {
  try {
    localStorage.setItem(HISTORY_FOLDS_KEY, JSON.stringify(next));
  } catch {
    // The hand-opened groups just will not survive the restart.
  }
}

// foldedFor is false before the window's first scan; nothing has been
// saved for that yet, so it reads as null (the store's own "no session"),
// never its own case.
function foldedForId(): string | null {
  return state.historyFolds.foldedFor === false ? null : state.historyFolds.foldedFor;
}

export function foldHistoryProjects(focusedId: string | null, collapsed: ReadonlySet<string>): void {
  const stored = loadHistoryFoldsStore();
  const restored = restoreOpenedFolds(collapsed, focusedId, stored);
  setState({ ...state, historyFolds: { collapsed: restored, foldedFor: focusedId } });
  saveHistoryFoldsStore(stored.for === focusedId ? stored : { for: focusedId, opened: [] });
}

export function toggleHistoryFold(project: string): void {
  const opening = state.historyFolds.collapsed.has(project);
  const next = new Set(state.historyFolds.collapsed);
  if (opening) next.delete(project);
  else next.add(project);
  setState({ ...state, historyFolds: { ...state.historyFolds, collapsed: next } });
  const forId = foldedForId();
  const stored = loadHistoryFoldsStore();
  const opened = (stored.for === forId ? stored.opened : []).filter((p) => p !== project);
  saveHistoryFoldsStore({ for: forId, opened: opening ? [...opened, project] : opened });
}

// The one group a Transcript reveal has to open (M60).
export function openHistoryFold(project: string): void {
  if (!state.historyFolds.collapsed.has(project)) return;
  const next = new Set(state.historyFolds.collapsed);
  next.delete(project);
  setState({ ...state, historyFolds: { ...state.historyFolds, collapsed: next } });
  const forId = foldedForId();
  const stored = loadHistoryFoldsStore();
  const opened = stored.for === forId ? stored.opened : [];
  saveHistoryFoldsStore({ for: forId, opened: opened.includes(project) ? opened : [...opened, project] });
}

// M9 fix 248: a close that would drop unsaved edits asks first. The
// dialog saves or discards the one file and calls proceed, which is the
// same close again, so a Close all with three dirty files asks three
// times and closes once; a force close is the dialog's own.
export function askBeforeClose(path: string, proceed: () => void): boolean {
  if (!isDirty(path)) return false;
  setState({ ...state, closeAsk: { path, proceed } });
  return true;
}

export function clearCloseAsk(): void {
  if (state.closeAsk !== null) setState({ ...state, closeAsk: null });
}

export function closeFileTab(path: string, force = false): void {
  if (!force && askBeforeClose(path, () => closeFileTab(path, true))) return;
  setTabs(closeFile(state.tabs, path));
}

export function closeOtherTabs(path: string): void {
  const kept = tabKey(path);
  const dirty = state.tabs.files.find((f) => f !== kept && isDirty(f));
  if (dirty !== undefined && askBeforeClose(dirty, () => closeOtherTabs(path))) return;
  setTabs(closeOthers(state.tabs, path));
}

export function closeAllTabs(): void {
  const dirty = state.tabs.files.find((f) => isDirty(f));
  if (dirty !== undefined && askBeforeClose(dirty, closeAllTabs)) return;
  setTabs(closeAll(state.tabs));
}

export function showTab(tab: string): void {
  setTabs(activate(state.tabs, tab));
}

export function setFileTabView(path: string, view: FileTabView): void {
  setTabs(setView(state.tabs, path, view));
}

// M9 fix 178: a document tab's state, rewritten by its view.
export function setDocumentQuery(path: string, query: string | null): void {
  setTabs(setTabQuery(state.tabs, path, query));
}

function loadTabs(): TabsModel {
  try {
    const raw = localStorage.getItem(tabsKey);
    return raw === null ? emptyTabs() : tabsFromJson(JSON.parse(raw));
  } catch {
    return emptyTabs();
  }
}

// The kept strip order rides in the tabs entry under `order`; an entry
// from before M9 fix 182 has none, which reads as the old order.
function loadTabOrder(): string[] {
  try {
    const raw = localStorage.getItem(tabsKey);
    if (raw === null) return [];
    const json = JSON.parse(raw) as { order?: unknown } | null;
    return orderFromJson(json?.order, tabKey);
  } catch {
    return [];
  }
}

// The window the main process named for this page (M9 fix 867): the
// startup window bound to a window that is not the first (the first was
// closed in an earlier run) moves to that window's key and reads its
// file tabs from it. Nothing changes when the key is the one in use.
export function adoptWindowTabs(windowId: string | null): void {
  const key = tabsKeyFor(windowId);
  if (key === tabsKey) return;
  tabsKey = key;
  setState({ ...state, tabs: loadTabs(), tabOrder: loadTabOrder() });
}

// The keys of windows the layout no longer holds go.
export function pruneWindowTabs(liveIds: ReadonlySet<string>): void {
  try {
    const gone: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const id = key === null ? null : windowOfTabsKey(key);
      if (id !== null && !liveIds.has(id)) gone.push(key!);
    }
    for (const key of gone) localStorage.removeItem(key);
  } catch {
    // Storage denied; the keys stay until a later prune.
  }
}

// Runs the attention model over the session list; returns the sessions that
// joined the set, for the chime, and the ones settled as they arrived
// because the person was answering in their pane (M9 fix 701).
export function observeAttention(sessions: Iterable<{ id: string; state: SessionState; stale?: boolean }>, answering: string | null = null): { arrived: readonly string[]; settled: readonly string[] } {
  const { model, arrived, settled } = observe(state.attention, sessions, answering);
  if (model !== state.attention) setState({ ...state, attention: model });
  return { arrived, settled };
}

// One session looked at (M9 fix 189): its pulse stops and the others'
// chimes do.
export function acknowledgeAttention(sessionId: string): void {
  const attention = acknowledge(state.attention, sessionId);
  if (attention !== state.attention) setState({ ...state, attention });
}

// Input that names no session: every chime stops, every pulse stays.
export function hushAttention(): void {
  const attention = hushAll(state.attention);
  if (attention !== state.attention) setState({ ...state, attention });
}

// The row's hush button (M9 fix 190).
export function setSessionHushed(sessionId: string, on: boolean): void {
  const attention = setHushed(state.attention, sessionId, on);
  if (attention !== state.attention) setState({ ...state, attention });
}

// Mark unread from the row menu: back into the set with no chime.
export function markSessionUnread(sessionId: string): void {
  const attention = markUnread(state.attention, sessionId);
  if (attention !== state.attention) setState({ ...state, attention });
}

// How long a stalled row says so before the note goes; long enough to
// read, short enough that a person who typed into the pane meanwhile is
// not still told about it.
const STALLED_FOR_MS = 4000;

export function markStalled(sessionId: string): void {
  const stalled = new Set(state.stalled);
  stalled.add(sessionId);
  setState({ ...state, stalled });
  setTimeout(() => {
    if (!state.stalled.has(sessionId)) return;
    const next = new Set(state.stalled);
    next.delete(sessionId);
    setState({ ...state, stalled: next });
  }, STALLED_FOR_MS);
}

// M9 fix 787: sets or (null) clears a session's removal count.
export function setRemoval(sessionId: string, count: RemovalCount | null): void {
  const removing = new Map(state.removing);
  if (count === null) removing.delete(sessionId);
  else removing.set(sessionId, count);
  setState({ ...state, removing });
}

export function setDropping(sessionId: string, on: boolean): void {
  if (state.dropping.has(sessionId) === on) return;
  const dropping = new Set(state.dropping);
  if (on) dropping.add(sessionId);
  else dropping.delete(sessionId);
  setState({ ...state, dropping });
}

export function cycleAttentionSound(): void {
  setAttentionSound(nextSound(state.attentionSound));
}

// M9 fix 926: each setting is written over what is stored, so another
// window's change to the other two stays.
export function setAttentionSound(attentionSound: AttentionSound): void {
  setState({ ...state, ...loadAttentionSettings(), attentionSound });
  saveAttentionSettings();
}

export function setAttentionNotify(attentionNotify: boolean): void {
  setState({ ...state, ...loadAttentionSettings(), attentionNotify });
  saveAttentionSettings();
}

export function setUsageRecord(usageRecord: boolean): void {
  const stored = loadAttentionSettings();
  const changed = usageRecord !== stored.usageRecord;
  // M9 fix 699: the switch's own line marks when the record was on, so the report can tell a feature nobody used from a record that was off. Sent while the record is on: after the flip turning on, before it turning off.
  if (changed && !usageRecord) window.emerald.useRecord.write({ ev: 'switch', on: false });
  setState({ ...state, ...stored, usageRecord });
  if (changed && usageRecord) window.emerald.useRecord.write({ ev: 'switch', on: true });
  saveAttentionSettings();
}

export function setChimeMode(chimeMode: ChimeMode): void {
  if (chimeMode !== state.chimeMode) setState({ ...state, chimeMode });
}

function saveAttentionSettings(): void {
  try {
    localStorage.setItem(ATTENTION_KEY, JSON.stringify({ sound: state.attentionSound, notify: state.attentionNotify, usage: state.usageRecord }));
  } catch {
    // The settings just will not survive the restart.
  }
}

function loadAttentionSettings(): Pick<UiState, 'attentionSound' | 'attentionNotify' | 'usageRecord'> {
  const defaults = { attentionSound: 'repeat' as const, attentionNotify: true, usageRecord: false };
  try {
    const raw = localStorage.getItem(ATTENTION_KEY);
    if (raw === null) return defaults;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaults;
    const { sound, notify, usage } = parsed as { sound?: unknown; notify?: unknown; usage?: unknown };
    return {
      attentionSound: isAttentionSound(sound) ? sound : defaults.attentionSound,
      attentionNotify: typeof notify === 'boolean' ? notify : defaults.attentionNotify,
      usageRecord: typeof usage === 'boolean' ? usage : false,
    };
  } catch {
    return defaults;
  }
}

export function fontSizeFor(paneId: string): number {
  return state.fontSizes.get(paneId) ?? FONT_SIZE_DEFAULT;
}

// A pane at the default has no entry, so the map only names panes that
// were changed.
export function setFontSize(paneId: string, px: number): void {
  const clamped = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(px)));
  if (clamped === fontSizeFor(paneId)) return;
  // M9 fix 926: from what is stored, so another window's sizes stay.
  const fontSizes = new Map(storedFontSizes());
  if (clamped === FONT_SIZE_DEFAULT) fontSizes.delete(paneId);
  else fontSizes.set(paneId, clamped);
  setState({ ...state, fontSizes });
  saveFontSizes();
}

export function adjustFontSize(paneId: string, delta: number): void {
  setFontSize(paneId, fontSizeFor(paneId) + delta);
}

export function resetFontSize(paneId: string): void {
  setFontSize(paneId, FONT_SIZE_DEFAULT);
}

// A new pane split off another starts at that pane's size.
export function inheritFontSize(fromPaneId: string, toPaneId: string): void {
  setFontSize(toPaneId, fontSizeFor(fromPaneId));
}

// Drops the sizes of panes that are no longer in the layout, so a closed
// pane's id does not sit in storage for good.
// A file tab's size (M9 fix 899) is keyed by its path, not a pane, and
// stays until it is brought back to 14 px.
export function pruneFontSizes(livePaneIds: ReadonlySet<string>): void {
  const kept = (id: string): boolean => livePaneIds.has(id) || id.startsWith(FILE_TEXT_PREFIX);
  if ([...state.fontSizes.keys()].every(kept)) return;
  const fontSizes = new Map([...storedFontSizes()].filter(([id]) => kept(id)));
  setState({ ...state, fontSizes });
  saveFontSizes();
}

function loadFontSizes(): Map<string, number> {
  try {
    // Fix 6 kept one size for every pane under this key.
    localStorage.removeItem('emerald.fontSize');
  } catch {
    // Nothing to remove then.
  }
  return storedFontSizes();
}

// What is stored now (M9 fix 926), the base every write builds on.
function storedFontSizes(): Map<string, number> {
  try {
    return parseFontSizes(localStorage.getItem(FONT_SIZES_KEY));
  } catch {
    return new Map();
  }
}

function parseFontSizes(raw: string | null): Map<string, number> {
  const sizes = new Map<string, number>();
  try {
    if (raw === null) return sizes;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return sizes;
    for (const [id, px] of Object.entries(parsed)) {
      if (typeof px === 'number' && Number.isFinite(px) && px >= FONT_SIZE_MIN && px <= FONT_SIZE_MAX && px !== FONT_SIZE_DEFAULT) sizes.set(id, px);
    }
  } catch {
    // Same as the sidebar: a corrupt entry just means the default size.
  }
  return sizes;
}

function saveFontSizes(): void {
  try {
    localStorage.setItem(FONT_SIZES_KEY, JSON.stringify(Object.fromEntries(state.fontSizes)));
  } catch {
    // Same as the sidebar: the sizes just will not survive the restart.
  }
}

export interface RevealConversation {
  id: string;
  seq: number;
}

// The lane card's Transcript (M60): the rail opens on the Sessions tab
// with the conversation's row scrolled to and unfolded. The rail is
// shown if it was collapsed, since the point is to look at the row; the
// history panel takes the reveal once its scan holds the row and clears
// it, so a second Transcript on the same conversation counts again.
export function revealConversation(id: string): void {
  setState({ ...state, filesCollapsed: false, railTab: 'history', revealConversation: { id, seq: (state.revealConversation?.seq ?? 0) + 1 } });
  saveFiles();
  try {
    localStorage.setItem(RAIL_TAB_KEY, 'history');
  } catch {
    // The choice just will not survive the restart.
  }
}

export function clearRevealConversation(seq: number): void {
  if (state.revealConversation?.seq !== seq) return;
  setState({ ...state, revealConversation: null });
}

export interface RevealFile {
  path: string;
  seq: number;
  // The reveal ends in the rail's rename of the row (M9 fix 930), for F2 in a file's editor.
  rename?: true;
}

// Reveal in Files (M9 fix 652): the rail opens on the Files tab with the
// file's folders opened and its row selected. The rail is shown if it was
// collapsed; it takes the request once the row is in its tree, or says it
// cannot, and clears it, so a second reveal of the same file counts again.
export function revealInFiles(path: string, rename = false): void {
  setState({ ...state, filesCollapsed: false, railTab: 'files', revealFile: { path, seq: (state.revealFile?.seq ?? 0) + 1, ...(rename ? { rename: true as const } : {}) } });
  saveFiles();
  try {
    localStorage.setItem(RAIL_TAB_KEY, 'files');
  } catch {
    // The choice just will not survive the restart.
  }
}

export function clearRevealFile(seq: number): void {
  if (state.revealFile?.seq !== seq) return;
  setState({ ...state, revealFile: null });
}

// Another window of the profile wrote it (M9 fix 926): this window takes
// it as it lands, so it shows the same and its next write does not put the
// old value back.
onOtherWindowWrite(SHADED_KEY, () => {
  const shadedPanes = loadIds(SHADED_KEY);
  setState({ ...state, shadedPanes, autoShaded: new Set([...state.autoShaded].filter((id) => shadedPanes.has(id))) });
});
onOtherWindowWrite(CHAT_KEY, () => setState({ ...state, chatPanes: loadChatPanes(), chatModes: loadChatModes() }));
onOtherWindowWrite(FONT_SIZES_KEY, () => setState({ ...state, fontSizes: storedFontSizes() }));
onOtherWindowWrite(ATTENTION_KEY, () => setState({ ...state, ...loadAttentionSettings() }));
onOtherWindowWrite(SHADE_AFTER_KEY, () => setState({ ...state, shadeAfter: loadShadeAfter() }));
onOtherWindowWrite(COPY_ON_SELECT_KEY, () => setState({ ...state, copyOnSelect: loadCopyOnSelect() }));
onOtherWindowWrite(SPLIT_KIND_KEY, () => setState({ ...state, splitKind: loadSplitKind() }));
onOtherWindowWrite(WRAP_LINES_KEY, () => setState({ ...state, wrapLines: loadWrapLines() }));
// M9 fix 949: the sidebar's list choices follow too, since every window
// lists every session; its width and collapse, the rail's tab, the Changed
// toggle and the search stay each window's own, as a browser keeps each
// window's side panel.
onOtherWindowWrite(ORDER_KEY, () => setState({ ...state, sidebarOrder: loadSidebarOrder() }));
onOtherWindowWrite(FILTER_KEY, () => setState({ ...state, sidebarFilter: loadSidebarFilter() }));
onOtherWindowWrite(FOLDED_KEY, () => setState({ ...state, sidebarFolded: loadSidebarFolded() }));
