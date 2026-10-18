import { closePane, cycleFocus, findPane, focusPane, neighborPane, splitPane } from '@emerald/shared';
import type { Direction, SplitDirection, UseFrom } from '@emerald/shared';
import { cycleLayoutTab, cycleStripTabs, newTab, openFileByDialog, rememberSplitSource, showSession, shownTab, startShellHere } from './actions.ts';
import { waitingOrder } from './attention-model.ts';
import { toggleDesignMode } from './design.ts';
import { stepHistory } from './focus-history.ts';
import { BINDINGS, DEFAULT_PREFIX, chordMatches, formatChord, isModifierKey, matchPlain, matchPrefixed, parseKeySpec } from './keys-model.ts';
import type { Action, Chord, KeyLike } from './keys-model.ts';
import { hasModel, saveFile } from './monaco.ts';
import { editTab, getState } from './store.ts';
import { PANES } from './tabs-model.ts';
import { recordUse } from './use-record.ts';
import {
  adjustFontSize,
  closeCheatSheet,
  closeFileTab,
  flashCornerNote,
  getUiState,
  inheritFontSize,
  openCheatSheet,
  openFind,
  openPicker,
  openReviewTab,
  openWhatsNewTab,
  resetFontSize,
  setPrefixArmed,
  showTab,
  subscribeUi,
  toggleFiles,
  toggleSidebar,
  toggleZoom,
  setChatFace,
  liftPanes,
  shadePane,
  shadePanes,
} from './ui.ts';
import { markKind } from '@emerald/shared';
import { shadeAllNext, shadeablePanes } from './shade-model.ts';
import { liftByPerson } from './shade-touch.ts';
import { faceOf } from './chat-model.ts';

// Keybindings: the plain chords from M2 to M4 plus a tmux-style prefix.
// Press the prefix (Ctrl+B unless ~/.emerald/config.json says otherwise) and
// the next key picks an action from the same table: the chord letter on
// its own, an arrow, z for focus, Tab to cycle, ? for the cheat sheet.
// Escape cancels; the prefix twice sends one literal prefix to the
// terminal, as in tmux. The table itself lives in keys-model.ts.

// The file Ctrl+S saves for a key pressed at `target`, or null when the
// key is not ours: a terminal's (Ctrl+S is XOFF to the shell), the prompt
// dialog's (it saves a prompt under a name) or any other field's. A press
// inside a file view saves that view's file, so two views of two files
// each save their own; anywhere else it is the file tab in front, or on
// the panes tab the focused pane's file view.
function saveTarget(target: EventTarget | null): string | null {
  const el = target instanceof Element ? target : null;
  const view = el?.closest<HTMLElement>('.file-view') ?? null;
  if (view !== null) return view.dataset.path !== undefined && hasModel(view.dataset.path) ? view.dataset.path : null;
  if (el !== null && el.closest('.term-host, input, textarea, select, [contenteditable="true"], [role="dialog"]') !== null) return null;
  const tab = getUiState().tabs.active;
  let path: string | null = null;
  if (tab !== PANES) path = tab;
  else {
    const shown = shownTab();
    const pane = shown === null ? null : findPane(shown, shown.focusedPaneId);
    if (pane !== null && pane.view?.kind === 'file') path = pane.view.path;
  }
  return path !== null && hasModel(path) ? path : null;
}

let prefix: Chord = parseKeySpec(DEFAULT_PREFIX)!;
// The prefix keydown that is being handed to the terminal on purpose
// (prefix pressed twice), so the terminal's key filter lets it through.
let passThrough: KeyboardEvent | null = null;

export function currentPrefix(): Chord {
  return prefix;
}

// Applies the user's config. A bad spec keeps the default and says why in
// the console rather than leaving the app with no prefix at all.
export function configurePrefix(spec: string | undefined): void {
  if (spec === undefined) return;
  const parsed = parseKeySpec(spec);
  if (parsed === null) {
    console.warn(`[emerald] config prefixKey ${JSON.stringify(spec)} is not usable, keeping ${formatChord(prefix)}`);
    return;
  }
  prefix = parsed;
  console.log(`[emerald] prefix key ${formatChord(prefix)}`);
  sendGuestChords();
}

// What xterm asks before handling a key: our chords and the prefix are
// never typed into the shell, and nothing is while the prefix is armed.
export function terminalMayHandle(ev: KeyboardEvent): boolean {
  if (ev === passThrough) return true;
  if (matchPlain(ev) !== null) return false;
  if (chordMatches(prefix, ev)) return false;
  return !getUiState().prefixArmed;
}

// M9 fix 189: the keys that switch tabs are a look-first move, not a look
// at the focused pane, so the attention listener (which runs after this
// one on the same keydown) must not acknowledge the focused session for
// them. The handler marks the event and attention.ts asks. The jump to
// the session waiting longest (fix 201) is the same kind of move: a
// press that acknowledged the pane it left would take the next waiting
// session out of the list it is walking.
const LOOK_FIRST: ReadonlySet<Action> = new Set(['next-tab', 'prev-tab', 'next-layout-tab', 'prev-layout-tab', 'jump-waiting']);
const lookFirstKeys = new WeakSet<Event>();

export function isLookFirstKey(ev: Event): boolean {
  return lookFirstKeys.has(ev);
}

// M9 fix 201: the jump key's place in the waiting list. A second press
// within this many ms takes the next session in waitingOrder's order,
// coming round at the end; a later press starts again from the longest
// wait. Kept here rather than in the UI state, since nothing draws it.
export const JUMP_AGAIN_MS = 4000;
let lastJump: { id: string; at: number } | null = null;

async function jumpToWaiting(now = Date.now()): Promise<void> {
  const order = waitingOrder(getState().sessions.values(), getUiState().attention.wanting);
  if (order.length === 0) {
    lastJump = null;
    flashCornerNote('Nothing is waiting');
    return;
  }
  let index = 0;
  const last = lastJump;
  if (last !== null && now - last.at <= JUMP_AGAIN_MS) {
    // The session last jumped to may have been acknowledged since and
    // left the list; then the longest wait is the right next one.
    const at = order.findIndex((s) => s.id === last.id);
    if (at !== -1) index = (at + 1) % order.length;
  }
  const target = order[index]!;
  lastJump = { id: target.id, at: now };
  await showSession(target.id);
}

export function runAction(action: Action, from: UseFrom = 'key'): Promise<unknown> {
  recordUse(action, from);
  switch (action) {
    // The chords give an empty pane, unlike the title bar buttons and the
    // menu, which also start a shell: the keyboard route stays the way to
    // get a pane to show an existing session in.
    case 'split-vertical':
      return splitFocused('row');
    case 'split-horizontal':
      return splitFocused('column');
    case 'close-pane':
      return editTab((t) => closePane(t, t.focusedPaneId));
    case 'focus-left':
      return focusToward('left');
    case 'focus-right':
      return focusToward('right');
    case 'focus-up':
      return focusToward('up');
    case 'focus-down':
      return focusToward('down');
    case 'focus-next':
      return editTab((t) => cycleFocus(t, 1));
    case 'focus-prev':
      return editTab((t) => cycleFocus(t, -1));
    case 'toggle-focus':
      return withFocusedPane(toggleZoom);
    case 'pick-session':
    case 'jump':
      return editTab((t) => {
        openPicker(t.focusedPaneId);
        return t;
      });
    case 'jump-waiting':
      return jumpToWaiting();
    case 'open-actions':
      return editTab((t) => {
        openPicker(t.focusedPaneId, 'actions');
        return t;
      });
    case 'new-session': {
      const tab = shownTab();
      return tab === null ? Promise.resolve() : startShellHere(tab.focusedPaneId);
    }
    case 'toggle-sidebar':
      toggleSidebar();
      return Promise.resolve();
    case 'toggle-files':
      toggleFiles();
      return Promise.resolve();
    case 'next-tab':
      return cycleStripTabs(1);
    case 'prev-tab':
      return cycleStripTabs(-1);
    // The layout tabs (M36). A file tab on show goes back to the panes,
    // since the new or next layout is what was asked to see.
    case 'new-layout-tab':
      showTab(PANES);
      return newTab();
    case 'next-layout-tab':
      showTab(PANES);
      return cycleLayoutTab(1);
    case 'prev-layout-tab':
      showTab(PANES);
      return cycleLayoutTab(-1);
    case 'cheat-sheet':
      openCheatSheet();
      return Promise.resolve();
    // The text size keys act on the focused pane; Ctrl+wheel on the pane
    // under the mouse.
    case 'text-bigger':
      return withFocusedPane((paneId) => adjustFontSize(paneId, 1));
    case 'text-smaller':
      return withFocusedPane((paneId) => adjustFontSize(paneId, -1));
    case 'text-reset':
      return withFocusedPane(resetFontSize);
    // An empty pane has no scrollback to search.
    case 'find': {
      const tab = shownTab();
      if (tab !== null && findPane(tab, tab.focusedPaneId)?.sessionId != null) openFind(tab.focusedPaneId);
      return Promise.resolve();
    }
    // The focused pane's session's changes (M64); an empty pane has none.
    case 'history-back':
      return stepHistory(-1);
    case 'history-forward':
      return stepHistory(1);
    case 'review': {
      const tab = shownTab();
      const sessionId = tab === null ? null : (findPane(tab, tab.focusedPaneId)?.sessionId ?? null);
      if (sessionId !== null) openReviewTab(sessionId);
      return Promise.resolve();
    }
    // The focused Claude pane's chat view or its terminal (M9 fix 689); a
    // shell or an empty pane has no chat face.
    case 'toggle-chat': {
      const tab = shownTab();
      const paneId = tab === null ? null : tab.focusedPaneId;
      const sessionId = tab === null ? null : (findPane(tab, tab.focusedPaneId)?.sessionId ?? null);
      const session = sessionId === null ? undefined : getState().sessions.get(sessionId);
      if (paneId !== null && session !== undefined && markKind(session) === 'claude') {
        setChatFace(paneId, session.id, faceOf(getUiState().chatPanes, paneId, session.id) !== 'chat');
      }
      return Promise.resolve();
    }
    // The release notes (M9 fix 227), from the palette or the cheat sheet.
    case 'whats-new':
      openWhatsNewTab();
      return Promise.resolve();
    // The file chooser (M9 fix 341), from the prefix, the palette or the
    // app menu.
    case 'open-file':
      return openFileByDialog();
    // Design Mode on the focused browser pane (M9 fix 674).
    case 'design-mode':
      toggleDesignMode();
      return Promise.resolve();
    // Shade all, or Lift all once every shade is down (M9 fix 844), on the
    // panes the menus' rows act on.
    case 'shade-all': {
      const tab = shownTab();
      if (tab === null) return Promise.resolve();
      const panes = shadeablePanes(tab);
      const next = shadeAllNext(panes, getUiState().shadedPanes);
      if (next === 'shade') shadePanes(panes);
      else if (next === 'lift') liftPanes(panes);
      return Promise.resolve();
    }
    // The focused pane's shade (M9 fix 844), lifted as a person's click
    // lifts it, so the idle shade leaves it up.
    case 'shade-pane': {
      const tab = shownTab();
      if (tab === null) return Promise.resolve();
      const paneId = tab.focusedPaneId;
      if (!shadeablePanes(tab).includes(paneId)) return Promise.resolve();
      if (getUiState().shadedPanes.has(paneId)) {
        const sessionId = findPane(tab, paneId)?.sessionId ?? null;
        liftByPerson(paneId, sessionId === null ? undefined : getState().sessions.get(sessionId));
      } else {
        shadePane(paneId);
      }
      return Promise.resolve();
    }
    default:
      return Promise.resolve();
  }
}

function focusToward(direction: Direction): Promise<unknown> {
  return editTab((t) => {
    const next = neighborPane(t, t.focusedPaneId, direction);
    return next === null ? t : focusPane(t, next.id);
  });
}

// The new pane keeps the text size of the one it split from.
async function splitFocused(direction: SplitDirection): Promise<unknown> {
  const before = shownTab();
  const after = await editTab((t) => splitPane(t, t.focusedPaneId, direction));
  if (before !== null) {
    inheritFontSize(before.focusedPaneId, after.focusedPaneId);
    rememberSplitSource(after.focusedPaneId, before.focusedPaneId);
  }
  return after;
}

// Nothing to act on until the first layout has arrived.
function withFocusedPane(act: (paneId: string) => void): Promise<void> {
  const tab = shownTab();
  if (tab !== null) act(tab.focusedPaneId);
  return Promise.resolve();
}

// Installs the window-level handler. Capture phase so a chord is consumed
// before xterm's textarea sees it; xterm also asks terminalMayHandle as a
// belt-and-braces measure.
//
// M9 fix 670: one key path for two sources. The window's own keydown and
// a key the main process heard in a browser pane's page and handed over
// (a page's keys never reach this window) both go through handleKey; a
// guest key has no target, nothing to consume (main already kept it from
// the page) and no event for the look-first mark, which attention's
// listener never hears for it anyway.
export function installKeybindings(): () => void {
  const run = (action: Action, mark: Event | null) => {
    if (mark !== null && LOOK_FIRST.has(action)) lookFirstKeys.add(mark);
    void runAction(action).catch((err: unknown) => console.warn(`[emerald] ${action} failed`, err));
  };
  const handleKey = (ev: KeyLike, target: EventTarget | null, consume: () => void, mark: KeyboardEvent | null) => {
    if (getUiState().cheatSheetOpen) {
      // Any key dismisses the sheet; the key itself is spent on that.
      closeCheatSheet();
      consume();
      return;
    }
    if (getUiState().prefixArmed) {
      if (isModifierKey(ev.code)) return;
      setPrefixArmed(false);
      if (chordMatches(prefix, ev)) {
        // Prefix twice: hand this one to the terminal untouched (a page
        // got its literal prefix from main).
        passThrough = mark;
        return;
      }
      consume();
      const action = matchPrefixed(ev);
      if (action !== null) run(action, mark);
      // Escape and any unbound key just cancel.
      return;
    }
    if (chordMatches(prefix, ev)) {
      consume();
      setPrefixArmed(true);
      return;
    }
    // Ctrl+W closes the file tab that is showing. On the panes tab it is
    // not ours: PowerShell uses it to delete a word.
    const tab = getUiState().tabs.active;
    if (tab !== PANES && ev.code === 'KeyW' && ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey) {
      consume();
      closeFileTab(tab);
      return;
    }
    // M9 fix 489: Ctrl+S saves the file in view wherever the keyboard is
    // on the page, not only while the editor has it.
    if (ev.code === 'KeyS' && ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey) {
      const path = saveTarget(target);
      if (path !== null) {
        consume();
        void saveFile(path).catch((err: unknown) => console.warn('[emerald] save failed', err));
        return;
      }
    }
    const action = matchPlain(ev);
    if (action === null) return;
    consume();
    run(action, mark);
  };
  const onKeyDown = (ev: KeyboardEvent) =>
    handleKey(
      ev,
      ev.target,
      () => {
        ev.preventDefault();
        ev.stopPropagation();
      },
      ev,
    );
  const onKeyUp = () => {
    passThrough = null;
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  // The main process's guest key rule needs the chords and the prefix to
  // tell an app chord from the page's key, and whether the next key is
  // the window's (the prefix armed here, or the cheat sheet up).
  sendGuestChords();
  let armed = false;
  const unsubUi = subscribeUi(() => {
    const ui = getUiState();
    const next = ui.prefixArmed || ui.cheatSheetOpen;
    if (next === armed) return;
    armed = next;
    window.emerald.keys.armed(next);
  });
  const unsubGuest = window.emerald.keys.onGuestKey((key) => handleKey(key, null, () => {}, null));
  return () => {
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    window.removeEventListener('keyup', onKeyUp, { capture: true });
    unsubUi();
    unsubGuest();
  };
}

function sendGuestChords(): void {
  const chords = BINDINGS.flatMap((b) => (b.plain === null ? [] : [b.plain]));
  window.emerald.keys.configure(chords, prefix);
}
