import {
  ackable,
  addGroupTab,
  addTabHolding,
  addTab,
  browserUrl,
  closePane,
  closeTab,
  currentTab,
  dropAtRight,
  dropSession,
  dropView,
  findPane,
  findTab,
  findSplit,
  firstPane,
  focusPane,
  listPanes,
  markKind,
  paneShowing,
  paneShowingIn,
  parentSplit,
  renameTab,
  replaceTab,
  setPaneSession,
  setPaneView,
  splitPane,
  subtreeHas,
  switchTab,
  tabHolding,
} from '@emerald/shared';
import type { Layout, LayoutTab, PaneContent, PaneView, ShellId, SplitDirection, SplitPlace } from '@emerald/shared';
import type { SplitKind } from './pane-menu-model.ts';
import { newTabNameFor, viewName } from './show-model.ts';
import { zoneToSplit } from './drop-zone-model.ts';
import type { DropZone } from './drop-zone-model.ts';
import { markFresh } from './fresh-panes.ts';
import { lastFolder, rememberFolderUsed } from './recent-folders.ts';
import { tabsSupported } from './daemon-model.ts';
import { CLOSE_GRACE_MS, closeTyping } from './group-sweep-model.ts';
import type { SweepMode } from './group-sweep-model.ts';
import { CLAUDE_ENTER_DELAY_MS, STALL_MS, isBusy, promptRefusal } from './prompt-model.ts';
import { editLayout, editTab, getState, subscribe } from './store.ts';
import { PANES } from './tabs-model.ts';
import { layoutTabKey, nextLayoutTab } from './tab-order.ts';
import { clearZoom, closePicker, cycleStripTab, getUiState, inheritFontSize, markStalled, openFileTab, pinFileTab, placeNewTab, setChatFace, setSplitFolder, showTab, tabOrderFor } from './ui.ts';
import { normalizePath } from './files-model.ts';
import { setFileScheme } from './file-scheme-store.ts';
import { recordUse } from './use-record.ts';

// Layout and session actions shared by the sidebar, the picker and the
// keybindings, so the rules live in one place.

// A session can be shown in several panes at once (M50): the feed in
// terminal-feed.ts attaches once per session and mirrors the terminal
// into every pane on it. Showing a session already on screen still jumps
// to a pane showing it rather than adding one, the tab on show first and
// another tab's pane after that, switching to that tab (M36); a drop or
// the palette's split is how a second pane comes about. paneId null
// means the focused pane of the tab on show.
//
// M9 fix 40: the panes view comes back in front of a file tab as well,
// since every caller (a sidebar row, a History row, the palette, a
// notification click) means "put this session in front of me", and a
// layout edit under a file tab left it focused but out of sight. The
// file tab is renderer state (ui.ts), so it is switched here and not in
// the layout edit.
export function showSession(sessionId: string, paneId: string | null = null): Promise<Layout> {
  showTab(PANES);
  return editLayout((l) => {
    const already = paneShowingIn(l, sessionId, l.currentTabId);
    if (already !== null) return switchTab(replaceTab(l, focusPane(already.tab, already.pane.id)), already.tab.id);
    const tab = (paneId === null ? null : tabHolding(l, paneId)) ?? currentTab(l);
    return replaceTab(l, setPaneSession(tab, paneId ?? tab.focusedPaneId, sessionId));
  });
}

// M9 fix 91: the other answer to a row click, a new pane to the right of
// the focused one (the heading's + rule: an empty focused pane is taken
// as it is) rather than the focused pane's session pushed off screen. A
// session already on a pane is still jumped to, as showSession does.
export async function showSessionBeside(sessionId: string): Promise<void> {
  recordUse('show-beside');
  const layout = getState().layout;
  if (layout !== null && paneShowingIn(layout, sessionId, layout.currentTabId) !== null) {
    await showSession(sessionId);
    return;
  }
  showTab(PANES);
  const paneId = await roomBesideFocused();
  await editTab((t) => setPaneSession(t, paneId, sessionId));
}

// The chooser's third answer and the row menu's (M9 fix 578): a layout tab
// of its own holding one pane with the session, named after its folder
// heading as the heading's tab button names its tab. The panes view comes
// forward first, as in showSessionBeside, since a file tab in front would
// hide the new tab; a session on a pane of another tab gets a mirror, as
// the heading's button gives.
export async function showSessionInNewTab(sessionId: string): Promise<void> {
  recordUse('show-in-new-tab');
  const { sessions, folders } = getState();
  const session = sessions.get(sessionId);
  if (session === undefined) return;
  showTab(PANES);
  await newGroupTab(newTabNameFor(session, folders), [sessionId]);
}

// What a click means when there is no row to ask from: a notification
// click, a History row's Show. The remembered choice, and beside while
// none is, since a pane added is never the wrong thing to have done.
export function showSessionAuto(sessionId: string): Promise<unknown> {
  return getUiState().showOffscreen === 'replace' ? showSession(sessionId) : showSessionBeside(sessionId);
}

// A sidebar row dropped on a pane: an edge splits that pane with the
// session on that side, the center shows it in the pane itself. A
// session already on screen keeps its panes and gains this one, a mirror
// (M50); a pane dragged by its title bar (M9 fix 73) names itself as
// fromPaneId and is closed in the same edit, so that drag moves the pane,
// in whichever tab it sits, and a title dropped on its own pane is
// nothing. One layout edit so a retry on a stale revision re-applies the
// whole drop. Zoom is cleared first for an edge, since the new pane would
// be a sibling off the zoom path and so invisible until focus moved, and
// the new pane takes the target's text size. A picker open on the pane
// was asking what to show there, so a center drop closes it.
export function dropSessionOn(sessionId: string, paneId: string, zone: DropZone, fromPaneId: string | null = null): Promise<void> {
  recordUse('drop-session');
  return dropSessionOnUnrecorded(sessionId, paneId, zone, fromPaneId);
}

// The same unrecorded (M9 fix 676), for placeSession, which reaches it
// after an await where the turn gate no longer holds.
async function dropSessionOnUnrecorded(sessionId: string, paneId: string, zone: DropZone, fromPaneId: string | null): Promise<void> {
  const split = zoneToSplit(zone);
  if (split !== null) clearZoom();
  const after = await editLayout((l) => {
    const tab = tabHolding(l, paneId);
    if (tab === null || fromPaneId === paneId) return l;
    const dropped = replaceTab(l, dropSession(tab, sessionId, paneId, split));
    if (fromPaneId === null) return dropped;
    // A title dropped on the centre of a pane already showing its session
    // changes nothing there and still moves: the pane it came from goes.
    const from = tabHolding(dropped, fromPaneId);
    return from === null ? dropped : replaceTab(dropped, closePane(from, fromPaneId));
  });
  if (split !== null) inheritFontSize(paneId, currentTab(after).focusedPaneId);
  if (split === null && getUiState().pickerPaneId === paneId) closePicker();
  await ackIfDone(sessionId);
}

// The rail's Commits tab dropped on a pane (M52): an edge splits that
// pane with the view on that side, the centre fills an empty pane (the
// drag offers no centre over an occupied one, and the tree op refuses it
// anyway). A view pane dragged by its title names itself as fromPaneId
// and is closed in the same edit, so that drag moves the pane; a title
// dropped on its own pane is nothing. The new pane takes the target's
// text size, so a terminal put there later matches its neighbours.
// It answers the pane the view landed on, or null when the drop changed
// nothing (M9 fix 437: the drag of a contents hit reveals its line there).
export async function dropViewOn(view: PaneView, paneId: string, zone: DropZone, fromPaneId: string | null = null): Promise<string | null> {
  recordUse('drop-view');
  const split = zoneToSplit(zone);
  if (split !== null) clearZoom();
  let landed: string | null = null;
  const after = await editLayout((l) => {
    const tab = tabHolding(l, paneId);
    if (tab === null || fromPaneId === paneId) return l;
    const placed = dropView(tab, view, paneId, split);
    // dropView puts the view on the pane it focuses, the new one or the
    // empty one it filled.
    landed = placed === tab ? null : placed.focusedPaneId;
    const dropped = replaceTab(l, placed);
    if (fromPaneId === null) return dropped;
    const from = tabHolding(dropped, fromPaneId);
    return from === null ? dropped : replaceTab(dropped, closePane(from, fromPaneId));
  });
  if (split !== null) inheritFontSize(paneId, currentTab(after).focusedPaneId);
  if (split === null && getUiState().pickerPaneId === paneId) closePicker();
  return landed;
}

// A pane's title or a row dropped on another layout tab (M9 fix 651):
// the content lands at that tab's far right, full height, and a title
// (fromPaneId) is closed in the same edit, so the pane moves; the last
// pane of its tab becomes an empty pane, never a closed tab. A drop on
// the tab on show, or on the tab the title already sits in, is nothing.
// The window stays on its tab, so nothing is shown, zoomed or acked.
// It answers the pane the content landed on, or null when the drop changed nothing (M9 fix 765: a contents hit's line is revealed there once the tab is shown).
export async function dropOnLayoutTab(content: PaneContent, tabId: string, fromPaneId: string | null = null): Promise<string | null> {
  recordUse('drop-on-layout-tab');
  let landed: string | null = null;
  await editTabs((l) => {
    landed = null;
    const tab = findTab(l, tabId);
    if (tab === null || tabId === l.currentTabId) return l;
    if (fromPaneId !== null && tabHolding(l, fromPaneId)?.id === tabId) return l;
    const placed = dropAtRight(tab, content);
    landed = placed.focusedPaneId;
    const dropped = replaceTab(l, placed);
    if (fromPaneId === null) return dropped;
    const from = tabHolding(dropped, fromPaneId);
    return from === null ? dropped : replaceTab(dropped, closePane(from, fromPaneId));
  });
  return landed;
}

// The same dropped on the + (M9 fix 651): a tab of its own at the end of
// the strip holding the content alone, named as showSessionInNewTab names
// a session's and as the ghost names a view, and not shown, so the
// strip's kept order is written with the made tab's id (newGroupTab uses
// currentTabId, which here stays the source tab).
// It answers the pane the content landed on, or null when the drop changed nothing (M9 fix 765: a contents hit's line is revealed there once the tab is shown).
export async function dropOnNewTab(content: PaneContent, fromPaneId: string | null = null): Promise<string | null> {
  recordUse('drop-on-new-tab');
  let name: string;
  if (content.sessionId !== null) {
    const { sessions, folders } = getState();
    const session = sessions.get(content.sessionId);
    if (session === undefined) return null;
    name = newTabNameFor(session, folders);
  } else {
    name = viewName(content.view);
  }
  let oldLayoutTabIds: readonly string[] | null = null;
  let madeId: string | null = null;
  let landed: string | null = null;
  await editTabs((l) => {
    oldLayoutTabIds = l.tabs.map((t) => t.id);
    const added = addTabHolding(l, name, content);
    madeId = added.tabs[added.tabs.length - 1]!.id;
    landed = added.tabs[added.tabs.length - 1]!.focusedPaneId;
    if (fromPaneId === null) return added;
    const from = tabHolding(added, fromPaneId);
    return from === null ? added : replaceTab(added, closePane(from, fromPaneId));
  });
  if (madeId !== null && oldLayoutTabIds !== null) placeNewTab(layoutTabKey(madeId), oldLayoutTabIds);
  return landed;
}

// Commits in a pane from a folder heading's + menu (M52): the view in a
// new pane beside the focused one, where the heading's shell would go.
export function openViewBeside(view: PaneView): Promise<void> {
  recordUse('open-view-beside');
  return openViewBesideUnrecorded(view);
}

// The same unrecorded (M9 fix 676), for openFileFromOutside, whose call
// is `emmer open`'s and comes after an await.
async function openViewBesideUnrecorded(view: PaneView): Promise<void> {
  const paneId = await roomBesideFocused();
  await editTab((t) => setPaneView(t, paneId, view), paneId);
}

// A file opened from outside the rail (M9 fix 341): the chooser, a drop
// on the strip or the rail, `emmer open`, a launch with a file. Pinned,
// since nothing will click a preview tab it did not open. With `pane`
// the file goes in a pane beside the focused one instead (fix 180's
// opener), on the panes tab so it can be seen. M9 fix 375: a scheme
// from `emmer open --scheme` is set as the file's own pick before the
// open, so a file already open takes it too, and checked against a
// fresh read of the list; with an openId the daemon is told whether the
// name was known, since it holds the CLI's reply for that. M9 fix 376:
// beside names a session, and the file goes in a pane split beside that
// session's pane on its own tab (pane implied); a session on no pane
// falls back to beside the focused pane, and the answer says so. M9 fix
// 404: paneShowingIn takes the tab in front first and then tab order, so
// a session on several panes has one picked for it; the answer names the
// pane and its tab so the CLI can say which. M9 fix 659: with url the
// path is a page for a browser pane, never a tab and never normalized,
// beside the named session's pane or the focused one.
export async function openFileFromOutside(path: string, pane = false, extra: { scheme?: string | null; openId?: number; beside?: string; url?: boolean } = {}): Promise<void> {
  const page = extra.url === true;
  const p = page ? path : normalizePath(path);
  const view: PaneView = page ? { kind: 'browser', url: p } : { kind: 'file', path: p };
  if (page) pane = true;
  let known = true;
  let besideFound = true;
  // Which of the session's panes paneShowingIn picked (M9 fix 404): a
  // session can be on several, and the CLI had no way to name the one
  // the file landed beside.
  let besidePane: string | undefined;
  let besideTab: string | undefined;
  if (extra.scheme !== undefined) {
    setFileScheme(p, extra.scheme);
    // scheme-store imports the shipped scheme's JSON, which node:test
    // cannot load through this file's other importers, so it is pulled
    // in here rather than at the top.
    if (extra.scheme !== null) known = (await (await import('./scheme-store.ts')).loadSchemes()).some((s) => s.name === extra.scheme);
  }
  try {
    if (page && browserUrl(p) !== p) {
      console.warn('[emerald] open from outside: not a page URL');
      return;
    }
    if (extra.beside !== undefined) {
      const layout = getState().layout;
      const shown = layout === null ? null : paneShowingIn(layout, extra.beside);
      if (shown !== null) {
        besidePane = shown.pane.id;
        besideTab = shown.tab.name;
        showTab(PANES);
        const paneId = await roomBeside(shown.pane.id);
        await editTab((t) => setPaneView(t, paneId, view), paneId);
        return;
      }
      besideFound = false;
      pane = true;
    }
    if (!pane) {
      openFileTab(p);
      pinFileTab(p);
      return;
    }
    showTab(PANES);
    await openViewBesideUnrecorded(view);
  } finally {
    if (extra.openId !== undefined) {
      void window.emerald
        .request('file.open.done', {
          openId: extra.openId,
          ...(extra.scheme === undefined ? {} : { known }),
          ...(extra.beside === undefined ? {} : { besideFound }),
          ...(besidePane === undefined ? {} : { besidePane }),
          ...(besideTab === undefined ? {} : { besideTab }),
        })
        .catch((err: unknown) => console.warn('[emerald] file.open.done failed', err));
    }
  }
}

// Open a file… (M9 fix 341): the native chooser, started in the rail's
// folder, and the pick as a pinned tab. The root is read off the rail's
// own data-root so this stays out of the component; a collapsed rail has
// none and the chooser starts where it last was.
export async function openFileByDialog(): Promise<void> {
  const root = document.querySelector<HTMLElement>('.files-rail')?.dataset['root'] ?? null;
  const picked = await window.emerald.pickFile(root);
  if (picked === null) return;
  await openFileFromOutside(picked);
}

// A folder from Explorer dropped on a pane: the same geometry as a session
// drop, but the session does not exist yet, so the layout edit only makes
// room (a split on the edge, or focus for the center) and then a shell
// starts in the folder and takes the pane, through the same call as the
// split buttons. A center drop puts the shell in place of whatever the pane
// showed; that session stays in the sidebar, as after a session drop.
export async function dropFolderOn(folder: string, paneId: string, zone: DropZone): Promise<void> {
  recordUse('drop-folder');
  const split = zoneToSplit(zone);
  if (split !== null) clearZoom();
  const after = await editTab((t) => (split === null ? focusPane(t, paneId) : splitPane(t, paneId, split.direction, undefined, split.place)), paneId);
  const target = split === null ? paneId : after.focusedPaneId;
  if (split !== null) inheritFontSize(paneId, target);
  if (split === null && getUiState().pickerPaneId === paneId) closePicker();
  await startShellIn(target, folder);
}

// A file from Explorer dropped on an empty pane (M9 fix 387): the same
// geometry as dropFolderOn, but the pane gets a file view rather than a
// shell, since there is nothing to spawn. Center puts the view in the
// pane itself; an edge splits it and puts the view in the new pane, the
// way dropFolderOn starts a shell there. A centre drop also focuses the
// pane it landed on (M9 fix 418), as a folder dropped there does: the
// pane is what you just filled, and an edge drop already leaves the new
// pane focused through splitPane.
export async function dropFileOn(path: string, paneId: string, zone: DropZone): Promise<void> {
  recordUse('drop-file');
  const split = zoneToSplit(zone);
  if (split === null) {
    await editTab((t) => setPaneView(focusPane(t, paneId), paneId, { kind: 'file', path }), paneId);
    return;
  }
  clearZoom();
  const after = await editTab((t) => splitPane(t, paneId, split.direction, undefined, split.place), paneId);
  const target = after.focusedPaneId;
  inheritFontSize(paneId, target);
  await editTab((t) => setPaneView(t, target, { kind: 'file', path }), target);
}

// Bytes typed into a session's PTY from the renderer, as if at its
// keyboard: a path inserted or dropped, an answer sent from a card, a
// prompt sent from a row. Fire and forget, as the pane's own keystrokes
// are; what the program makes of them is on the screen.
export function typeInto(sessionId: string, data: string): void {
  window.emerald.send({ type: 'pty.input', sessionId, data });
}

export type PromptOutcome = { kind: 'sent' } | { kind: 'refused'; reason: string };

// A prompt from the sidebar's box (M56), with emmer prompt's two gates.
// Gate one refuses before anything is typed (prompt-model.ts). Then the
// text and, after the pause a Claude session needs, the Enter; gate two
// is a watch on the store: a Claude session (or a shell Claude runs in)
// that was not busy and has not gone working STALL_MS after the Enter is
// marked stalled, so the row says the text may be sitting in its input
// box; a plain shell posts no hooks, so nothing is expected of it.
// Resolves once the send is done, not once the session moves, so the box
// can close at once.
export async function sendPrompt(sessionId: string, text: string): Promise<PromptOutcome> {
  const session = getState().sessions.get(sessionId);
  if (session === undefined) return { kind: 'refused', reason: 'No such session' };
  const reason = promptRefusal(session);
  if (reason !== null) return { kind: 'refused', reason };
  typeInto(sessionId, text);
  const claude = markKind(session) === 'claude';
  if (claude) await new Promise((resolve) => setTimeout(resolve, CLAUDE_ENTER_DELAY_MS));
  typeInto(sessionId, '\r');
  if (claude && !isBusy(session.state)) watchForStall(sessionId);
  return { kind: 'sent' };
}

function watchForStall(sessionId: string): void {
  let done = false;
  const off = subscribe(() => {
    const s = getState().sessions.get(sessionId);
    // Gone, exited or moving: nothing to say either way.
    if (s === undefined || s.state === 'exited' || isBusy(s.state)) settle();
  });
  const timer = setTimeout(() => {
    settle();
    markStalled(sessionId);
  }, STALL_MS);
  function settle(): void {
    if (done) return;
    done = true;
    off();
    clearTimeout(timer);
  }
}

// The pane acks a done session once it is focused in a focused window; a
// click on the sidebar row is an even clearer "I looked", so it acks too
// and does not wait for the window to come forward. Acking a session that
// is not done is a no-op in the daemon.
export function ackIfDone(sessionId: string): Promise<void> {
  const session = getState().sessions.get(sessionId);
  if (session === undefined || !ackable(session)) return Promise.resolve();
  return window.emerald.request('session.ack', { sessionId }).then(() => undefined);
}

export function renameSession(sessionId: string, name: string): Promise<void> {
  recordUse('rename-session');
  return window.emerald.request('session.rename', { sessionId, name }).then(() => undefined);
}

// The checkpoint's comment, from the row menu; an empty string clears it,
// which the daemon treats as null. The phase stays the CLI's to set.
export function setSessionComment(sessionId: string, comment: string): Promise<void> {
  return window.emerald.request('session.set', { sessionId, comment }).then(() => undefined);
}

// The colour (M29), from the Colour row of the row menu or the pane menu;
// one of SESSION_COLORS, already lower-case hex.
export function setSessionColor(sessionId: string, color: string): Promise<void> {
  recordUse('set-colour');
  return window.emerald.request('session.set', { sessionId, color }).then(() => undefined);
}

// The session's own colour scheme (M9 fix 244), by name; null puts it
// back on the window's pick. The daemon keeps it on the record, so the
// scheme follows the session between panes and across a restart.
export function setSessionScheme(sessionId: string, scheme: string | null): Promise<void> {
  recordUse('set-scheme');
  return window.emerald.request('session.set', { sessionId, scheme }).then(() => undefined);
}

// The person's own label on a folder group (M9 fix 194), from the
// heading's box or its menu; an empty string clears it, which the daemon
// takes as null, and the heading goes back to the folder's name.
export function setFolderLabel(folder: string, label: string): Promise<void> {
  recordUse('set-folder-label');
  return window.emerald.request('folders.set', { folder, label: label === '' ? null : label }).then(() => undefined);
}

export function killSession(sessionId: string, remove = false): Promise<void> {
  recordUse('kill-session');
  return killSessionUnrecorded(sessionId, remove);
}

// The same unrecorded (M9 fix 676), for the closes and the sweep, each
// recorded under its own name and reaching the kill after an await.
function killSessionUnrecorded(sessionId: string, remove = false): Promise<void> {
  return window.emerald.request('session.kill', { sessionId, remove }).then(() => undefined);
}

// Starts an exited session again under the same id and puts it on screen:
// resuming something you cannot see would leave you guessing whether it
// worked. The pane sizes the PTY as soon as it attaches, so any sane
// starting size will do.
export function resumeSession(sessionId: string): Promise<void> {
  return window.emerald.request('session.resume', { sessionId, cols: 120, rows: 30 }).then(() => showSession(sessionId)).then(() => undefined);
}

// The lane card's Resume in a new pane (M60): the same resume, shown in
// a pane beside the focused one rather than in it, so a look at what an
// exited session did to the log does not push the pane's session out.
export async function resumeSessionBeside(sessionId: string): Promise<void> {
  recordUse('resume-beside');
  await window.emerald.request('session.resume', { sessionId, cols: 120, rows: 30 });
  showTab(PANES);
  const paneId = await roomBesideFocused();
  await editTab((t) => setPaneSession(t, paneId, sessionId));
}

// The palette's Enter: show the session in the pane (zone null), or split
// the pane with it on that side, the way a sidebar row dropped on an edge
// does. An exited session is started again first, since Enter on one in
// the sidebar resumes it and the palette lists the exited group too.
export async function placeSession(sessionId: string, paneId: string, zone: DropZone | null): Promise<void> {
  if (getState().sessions.get(sessionId)?.state === 'exited') {
    await window.emerald.request('session.resume', { sessionId, cols: 120, rows: 30 });
  }
  if (zone === null) await showSession(sessionId, paneId);
  else await dropSessionOnUnrecorded(sessionId, paneId, zone, null);
}

// The daemon empties the panes and drops the session from its list; the
// pushes that follow update the mirror.
export function removeSession(sessionId: string): Promise<void> {
  return window.emerald.request('session.remove', { sessionId }).then(() => undefined);
}

// Removes every exited session, one request each so a failure on one (say
// it was resumed a moment ago) leaves the rest removed.
export async function clearExited(): Promise<void> {
  recordUse('clear-exited');
  const exited = [...getState().sessions.values()].filter((s) => s.state === 'exited');
  const results = await Promise.allSettled(exited.map((s) => removeSession(s.id)));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed !== undefined) throw failed.reason;
}

// Resumes every exited session (M9 fix 290), one request each as
// clearExited does. No showSession: one click cannot choose a pane for
// four sessions at once, so a session a pane kept comes back live in it
// as the push lands, and one on no pane goes back to its folder group as
// a listed row with the unshown marker (M9 fix 91).
export async function resumeAll(): Promise<void> {
  recordUse('resume-all');
  const exited = [...getState().sessions.values()].filter((s) => s.state === 'exited');
  const results = await Promise.allSettled(exited.map((s) => window.emerald.request('session.resume', { sessionId: s.id, cols: 120, rows: 30 })));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed !== undefined) throw failed.reason;
}

// The gentle close (M9 fix 193): the program's own exit typed into the
// pane, then the kill once CLOSE_GRACE_MS has passed with the session
// still up. Resolves when the session has exited or is gone, or when
// the kill has been sent.
export async function closeSessionGently(sessionId: string): Promise<void> {
  const session = getState().sessions.get(sessionId);
  if (session === undefined) return;
  const typing = closeTyping(session);
  if (typing === null) return;
  typeInto(sessionId, typing.text);
  if (typing.enterDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, typing.enterDelayMs));
  typeInto(sessionId, '\r');
  const left = await new Promise<boolean>((resolve) => {
    const gone = () => {
      const s = getState().sessions.get(sessionId);
      return s === undefined || s.state === 'exited';
    };
    if (gone()) return resolve(true);
    const off = subscribe(() => {
      if (!gone()) return;
      off();
      clearTimeout(timer);
      resolve(true);
    });
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, CLOSE_GRACE_MS);
  });
  if (!left) await killSessionUnrecorded(sessionId);
}

// The folder heading's sweep (M9 fix 193) over the sessions named, one
// request each as clearExited does, so a failure on one leaves the rest
// swept. close types each session's exit and kills the ones that stay;
// kill is the row's Kill; remove kills and forgets each as it exits.
export async function sweepSessions(sessionIds: readonly string[], mode: SweepMode): Promise<void> {
  recordUse('sweep-sessions');
  const one = (id: string) => (mode === 'close' ? closeSessionGently(id) : killSessionUnrecorded(id, mode === 'remove'));
  const results = await Promise.allSettled(sessionIds.map(one));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed !== undefined) throw failed.reason;
}

// The pane-level edits behind the title bar buttons, the empty pane's
// buttons and the context menu. They name the pane rather than using the
// focused one: a right click focuses the pane too, but that round trip may
// not be back yet. The *Here variants log errors so every caller is one line.

// Hide: the pane goes, the session keeps running and stays in the sidebar.
// The chord does the same; only the title bar's × and the menu's Close kill.
export function hidePaneHere(paneId: string): void {
  recordUse('hide-pane');
  void editTab((t) => closePane(t, paneId), paneId).catch(warn('hide'));
}

// Close: the pane goes and the session with it. A shell is forgotten once
// it exits, since resuming one would just be a new shell; a Claude session
// stays in the exited group so its conversation can be resumed. One that
// already exited is removed, whatever its kind. The pane closes first so
// the screen answers the click before the kill lands.
export async function closeSession(paneId: string): Promise<void> {
  recordUse('close-session');
  const { layout, sessions } = getState();
  const pane = layout === null ? null : findPane(currentTab(layout), paneId);
  const session = pane?.sessionId === null || pane === null ? undefined : sessions.get(pane.sessionId);
  await editTab((t) => closePane(t, paneId), paneId);
  if (session === undefined) return;
  if (session.state === 'exited') await removeSession(session.id);
  else await killSessionUnrecorded(session.id, session.kind === 'shell');
}

export function closeSessionHere(paneId: string): void {
  void closeSession(paneId).catch(warn('close'));
}

const warn = (what: string) => (err: unknown) => console.warn(`[emerald] ${what} failed`, err);

// Where the session in the pane is now, the folder a commits view is
// pinned to (M52), or null for an empty pane or an activity view (M69),
// which is pinned to a window, not a place.
export function paneFolder(paneId: string): string | null {
  const { layout, sessions } = getState();
  const pane = layout === null ? null : findPane(currentTab(layout), paneId);
  if (pane === null) return null;
  if (pane.view !== null) return pane.view.kind === 'commits' ? pane.view.folder : null;
  if (pane.sessionId === null) return null;
  return sessions.get(pane.sessionId)?.cwd ?? null;
}

// The folder a new shell should start in: where the named pane's session
// or view is now, else the folder an empty pane was split from (M9 fix
// 546, so Ctrl+Shift+N starts where the empty pane's row 1 says), else
// the last folder a session was started in, else home, which only the
// main process knows. null when there is no pane to read (M9 fix 448: the
// sidebar's New shell with no focused pane).
async function folderFor(paneId: string | null): Promise<string> {
  const own = paneId === null ? null : (paneFolder(paneId) ?? getUiState().splitFolder.get(paneId) ?? null);
  return own ?? lastFolder() ?? (await window.emerald.info()).homeDir;
}

// Records where a new pane was split from (M9 fix 546): the source's
// folder, or, when the source is an empty pane itself, the folder it was
// split from, so a chain of empty splits keeps it. A split off an
// activity view records nothing, and the empty pane falls to last used.
export function rememberSplitSource(newPaneId: string, sourcePaneId: string): void {
  const folder = paneFolder(sourcePaneId) ?? getUiState().splitFolder.get(sourcePaneId);
  if (folder !== undefined) setSplitFolder(newPaneId, folder);
}

// Starts a shell in the folder and shows it in the pane. The common case
// since M9: a shell next to the one you are in, with no dialog. The pane
// resizes the PTY as soon as the terminal mounts, so any sane starting
// size will do. shell (M9 fix 624) is one of the daemon's other shells;
// none is the default.
export async function startShellIn(paneId: string, folder: string, shell?: ShellId): Promise<void> {
  const { session } = await window.emerald.request('session.spawn', { kind: 'shell', cwd: folder, ...(shell === undefined ? {} : { shell }), cols: 120, rows: 30 });
  rememberFolderUsed(folder);
  await editTab((t) => setPaneSession(t, paneId, session.id), paneId);
}

// Starts a Claude session in the folder and shows it in the pane, the
// Claude twin of startShellIn: the split's Claude arm (M9 fix 343) and the
// empty pane's Start (M9 fix 545). No dialog and no args, the shape
// NewSessionDialog.tsx's Start button uses. opts.chat opens the pane on
// the chat face (M9 fix 689), the empty pane's `opens on` pick.
export async function startClaudeIn(paneId: string, folder: string, opts: { chat?: boolean } = {}): Promise<void> {
  const { session } = await window.emerald.request('session.spawn', { kind: 'claude', cwd: folder, cols: 120, rows: 30 });
  rememberFolderUsed(folder);
  await editTab((t) => setPaneSession(t, paneId, session.id), paneId);
  if (opts.chat === true) setChatFace(paneId, session.id, true);
}

// Resume from the History panel: a Claude session started in the
// transcript's folder with --resume, which is what the daemon does for its
// own exited sessions, and shown in the focused pane, or beside it in a
// new pane at the same text size. The row turns live on the next scan
// once the session's SessionStart hook binds the id.
export async function resumeTranscript(folder: string, claudeSessionId: string, split: boolean): Promise<void> {
  recordUse('resume-transcript');
  const layout = getState().layout;
  let paneId = layout === null ? null : currentTab(layout).focusedPaneId;
  if (split) {
    const from = paneId;
    const after = await editTab((t) => splitPane(t, t.focusedPaneId, 'row'));
    paneId = after.focusedPaneId;
    if (from !== null) inheritFontSize(from, paneId);
  }
  const { session } = await window.emerald.request('session.spawn', { kind: 'claude', cwd: folder, args: ['--resume', claudeSessionId], cols: 120, rows: 30 });
  rememberFolderUsed(folder);
  const target = paneId;
  await editTab((t) => setPaneSession(t, target ?? t.focusedPaneId, session.id));
}

// Where a session started from a folder heading's + goes (M32): a new
// pane split to the right of the focused pane, at its text size. A
// focused pane that is empty is taken as it is, since a shell beside an
// empty pane is not what anyone meant; with no focused pane in the tree
// the first empty pane is taken, else the first pane is split. Resolves
// with the pane to fill. M9 fix 449: only the split branch is room made,
// so only it is flashed once it mounts; a pane taken as it is stays quiet.
// markFresh runs inside the edit itself, before the request to the daemon
// even goes out: the daemon's own layout.changed push can otherwise reach
// the store and mount the pane before an await here resumes, which raced
// and lost every time (verify:m9 read it as the flash never arriving).
export async function roomBesideFocused(): Promise<string> {
  const layout = getState().layout;
  if (layout === null) throw new Error('no layout yet');
  // The tab on show (M36): the heading was clicked there.
  const tab = currentTab(layout);
  const focused = findPane(tab, tab.focusedPaneId);
  const isEmpty = (p: { sessionId: string | null; view: unknown }) => p.sessionId === null && p.view === null;
  if (focused !== null && isEmpty(focused)) return focused.id;
  if (focused === null) {
    const empty = listPanes(tab).find(isEmpty);
    if (empty !== undefined) return empty.id;
  }
  const from = focused?.id ?? firstPane(tab.root).id;
  clearZoom();
  const after = await editTab((t) => {
    const split = splitPane(t, from, 'row');
    markFresh(split.focusedPaneId);
    return split;
  });
  inheritFontSize(from, after.focusedPaneId);
  return after.focusedPaneId;
}

// Room beside a named pane (M9 fix 376): its tab put in front and the
// pane split to its right, the way roomBesideFocused splits the focused
// one; the pane named holds a session, so it is never taken as it is.
// Resolves with the new pane. M9 fix 449: always a split, so always
// flashed once it mounts; markFresh runs inside the edit, same reason as
// roomBesideFocused's above.
export async function roomBeside(paneId: string): Promise<string> {
  let newId: string | null = null;
  clearZoom();
  await editLayout((l) => {
    const tab = tabHolding(l, paneId);
    if (tab === null) return l;
    const split = splitPane(tab, paneId, 'row');
    newId = split.focusedPaneId;
    markFresh(newId);
    return switchTab(replaceTab(l, split), tab.id);
  });
  if (newId === null) throw new Error(`no pane ${paneId}`);
  inheritFontSize(paneId, newId);
  markFresh(newId);
  return newId;
}

// The three ways to start a shell beside something: New shell here (the
// pane menu's row, the empty pane's button, Ctrl+Shift+N), the empty
// sidebar's New shell, and a folder heading's +. M9 fix 448: these used to
// disagree (New shell here alone took a view pane as it is), so one rule
// now covers all three. A named pane, or the focused one for 'focused',
// is taken as it is only when it is wholly empty, since there is no
// session or view there to push aside; anything else is split beside,
// room made through roomBeside or roomBesideFocused the way a folder
// heading's + already did (M9 fix 172). The folder is read off the
// source pane before any split, since a fresh pane from the split has no
// folder of its own to read back (this was the sidebar's New shell's own
// bug: it asked the new empty pane for the folder it should have asked
// the focused one for). An explicit folder (the heading's +) wins over
// whatever the source pane holds.
export async function startShell(opts: { pane: string | 'focused'; folder?: string; shell?: ShellId }): Promise<void> {
  const layout = getState().layout;
  if (layout === null) throw new Error('no layout yet');
  const sourceId = opts.pane === 'focused' ? currentTab(layout).focusedPaneId : opts.pane;
  const folder = opts.folder ?? (await folderFor(sourceId));
  const target =
    sourceId !== null && isEmptyPane(sourceId)
      ? sourceId
      : opts.pane === 'focused'
        ? await roomBesideFocused()
        : await roomBeside(opts.pane);
  await startShellIn(target, folder, opts.shell);
}

// New shell here: the pane menu's row, the empty pane's button and
// Ctrl+Shift+N over a pane.
export async function startShellHere(paneId: string, shell?: ShellId): Promise<void> {
  return startShell({ pane: paneId, ...(shell === undefined ? {} : { shell }) });
}

// The empty sidebar's New shell (M9 fix 172): a shell beside the focused
// pane, in the folder a shell there would get.
export async function startShellBesideFocused(): Promise<void> {
  return startShell({ pane: 'focused' });
}

// The + on a folder heading: a shell in that folder, beside the focused
// pane. The row lands under the heading it was clicked on, since groups
// are keyed by the live folder.
export async function startShellBeside(folder: string, shell?: ShellId): Promise<void> {
  recordUse('shell-beside');
  return startShell({ pane: 'focused', folder, ...(shell === undefined ? {} : { shell }) });
}

// Whether the pane holds nothing at all, no session and no view. The one
// pane a split leaves empty: its buttons keep giving you another empty
// pane to fill.
function isEmptyPane(paneId: string): boolean {
  const { layout } = getState();
  const pane = layout === null ? null : findPane(currentTab(layout), paneId);
  return pane !== null && pane.sessionId === null && pane.view === null;
}

// Split, then, when the kind is a shell or a Claude, a session in the new
// pane in the folder of the pane it came from, at its text size. A view
// pane with no folder of its own (an activity view, M69) gets the session
// its buttons promise all the same (M9 fix 147), where folderFor says: the
// last folder used, else home. A plain split, an empty pane, when the kind
// is empty (M9 fix 537) or the pane is empty itself.
export async function splitWith(paneId: string, direction: SplitDirection, kind: SplitKind): Promise<void> {
  if (kind === 'empty' || isEmptyPane(paneId)) {
    const after = await editTab((t) => splitPane(t, paneId, direction), paneId);
    inheritFontSize(paneId, after.focusedPaneId);
    rememberSplitSource(after.focusedPaneId, paneId);
    return;
  }
  const folder = await folderFor(paneId);
  const after = await editTab((t) => splitPane(t, paneId, direction), paneId);
  inheritFontSize(paneId, after.focusedPaneId);
  rememberSplitSource(after.focusedPaneId, paneId);
  if (folder === null) return;
  if (kind === 'shell') {
    await startShellIn(after.focusedPaneId, folder);
    return;
  }
  await startClaudeIn(after.focusedPaneId, folder);
}

// The title buttons, the empty pane's buttons and the pane menu's Split
// items (M9 fixes 343, 537): an empty pane unless the person has set a
// shell or a Claude as the default (ui.ts's splitKind). The chords and the
// palette's Split keys are plain splits and never come here.
export function splitHere(paneId: string, direction: SplitDirection): void {
  recordUse('split-here');
  void splitWith(paneId, direction, getUiState().splitKind).catch(warn('split'));
}

// Ctrl+drag on a divider pulls a new pane out against it. The pane it comes
// from is the focused pane when that sits on either side of the divider,
// else the first pane past the divider; the new pane goes on the source's
// divider side, so it appears under the mouse. null when the layout is not
// known yet.
export function pullSource(splitId: string): { paneId: string; place: SplitPlace } | null {
  const layout = getState().layout;
  const tab = layout === null ? null : currentTab(layout);
  const split = tab === null ? null : findSplit(tab, splitId);
  if (tab === null || split === null) return null;
  if (subtreeHas(split.first, tab.focusedPaneId)) return { paneId: tab.focusedPaneId, place: 'after' };
  if (subtreeHas(split.second, tab.focusedPaneId)) return { paneId: tab.focusedPaneId, place: 'before' };
  return { paneId: firstPane(split.second).id, place: 'before' };
}

// Splits the source pane with the new pane on its divider side, starts a
// shell there in the source's folder, and resolves with the id of the split
// that now holds both, for the drag to keep sizing. The shell is not
// awaited: the drag must not wait on a spawn.
export async function pullPane(paneId: string, direction: SplitDirection, place: SplitPlace): Promise<string> {
  recordUse('pull-pane');
  const folder = paneFolder(paneId);
  const after = await editTab((t) => splitPane(t, paneId, direction, undefined, place), paneId);
  const newPaneId = after.focusedPaneId;
  const holder = parentSplit(after, newPaneId);
  if (holder === null) throw new Error('the pulled pane has no parent split');
  inheritFontSize(paneId, newPaneId);
  if (folder !== null) void startShellIn(newPaneId, folder).catch(warn('shell for the pulled pane'));
  return holder.id;
}

// The layout tabs (M36), from the strip and the prefix keys. Each is one
// layout edit, so a stale revision re-applies it on the fresh layout. On
// a daemon from before tabs the edit is left unmade (daemon-model.ts).
function editTabs(fn: (layout: Layout) => Layout): Promise<Layout> {
  return editLayout((l) => (tabsSupported(getState().daemon) ? fn(l) : l));
}

// An empty tab named Panes N at the end of the strip, shown at once. M9
// fix 363: the strip's kept order is read before the add (a fresh
// profile's guess otherwise puts the new tab ahead of a file already
// open), and the new tab's key is written back last, after every file.
export function newTab(): Promise<Layout> {
  let oldLayoutTabIds: readonly string[] | null = null;
  return editTabs((l) => {
    oldLayoutTabIds = l.tabs.map((t) => t.id);
    return addTab(l);
  }).then((next) => {
    if (oldLayoutTabIds !== null) placeNewTab(layoutTabKey(next.currentTabId), oldLayoutTabIds);
    return next;
  });
}

// The folder heading's tab button (M50): a tab named after the group
// with every one of its sessions in a pane, mirrors of the panes they
// already have elsewhere. M9 fix 363: named last on the strip, as newTab.
export function newGroupTab(name: string, sessionIds: readonly string[]): Promise<Layout> {
  let oldLayoutTabIds: readonly string[] | null = null;
  return editTabs((l) => {
    oldLayoutTabIds = l.tabs.map((t) => t.id);
    return addGroupTab(l, name, sessionIds);
  }).then((next) => {
    if (oldLayoutTabIds !== null) placeNewTab(layoutTabKey(next.currentTabId), oldLayoutTabIds);
    return next;
  });
}

export function showLayoutTab(tabId: string): Promise<Layout> {
  return editTabs((l) => switchTab(l, tabId));
}

// Ctrl+B n and p walk the strip's order (M9 fix 182), not the daemon's,
// so the keys and the eye agree once a tab has been dragged; the file
// tabs are skipped, since these are the layout tabs' keys.
export function cycleLayoutTab(step: 1 | -1): Promise<Layout> {
  return editTabs((l) => {
    const next = nextLayoutTab(tabOrderFor(l.tabs.map((t) => t.id)), l.currentTabId, step);
    return next === null ? l : switchTab(l, next);
  });
}

// Ctrl+PageDown and PageUp (M11) walk the same order, a panes tab and a
// file tab each one stop: a file is put in front here, a layout tab
// shown on the daemon with the panes in front.
export function cycleStripTabs(step: 1 | -1): Promise<void> {
  const layout = getState().layout;
  const next = cycleStripTab(step, layout?.tabs.map((t) => t.id) ?? [], layout?.currentTabId ?? null);
  if (next === null || layout === null || next === layout.currentTabId) return Promise.resolve();
  return showLayoutTab(next).then(() => undefined);
}

export function renameLayoutTab(tabId: string, name: string): Promise<Layout> {
  recordUse('rename-layout-tab');
  return editTabs((l) => renameTab(l, tabId, name));
}

// The sessions in the tab's panes keep running and stay listed; only the
// panes go. Zoom is a way of looking at a pane and the pane is gone.
export function closeLayoutTab(tabId: string): Promise<Layout> {
  recordUse('close-layout-tab');
  clearZoom();
  return editTabs((l) => closeTab(l, tabId));
}

// The tab on show, or null before the first layout has arrived.
export function shownTab(): LayoutTab | null {
  const layout = getState().layout;
  return layout === null ? null : currentTab(layout);
}
