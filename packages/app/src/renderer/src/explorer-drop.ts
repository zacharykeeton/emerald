import { findPane, markKind, tabHolding } from '@emerald/shared';
import type { LayoutTab } from '@emerald/shared';
import { dropFileOn, dropFolderOn, openFileFromOutside, typeInto } from './actions.ts';
import { isImageName, pastedPath } from './chat-model.ts';
import { fileViewSupported } from './daemon-model.ts';
import { zoneAt } from './drop-zone-model.ts';
import { getState } from './store.ts';
import { recordUse } from './use-record.ts';
import { beginSessionDrag, endSessionDrag, getUiState, setSessionDragFile, setSessionDropTarget } from './ui.ts';
import type { DropTarget } from './ui.ts';

// A folder or a file dragged in from Explorer and dropped on a pane. The
// sidebar drag (pane-drag.ts) is hand-rolled on mouse events, but a drag
// from outside the window can only arrive as HTML5 drag and drop, since
// that is the one way the OS hands the app a path. So this is a second
// driver for the same overlay and the same zoneAt, with dragover and drop
// where the other has mousemove and mouseup. There is no ghost: the OS
// draws its own.
//
// The renderer is sandboxed and a dropped File carries no path, so the
// preload's pathFor answers that, and the main process says whether the
// path is a folder. A folder becomes a shell in a new pane on the zone's
// side of the target (or in the target itself, for center). A file dropped
// on a pane with a session types its absolute path into that session, as
// the files rail's Insert path does: an image on a Claude session's pane
// is pasted as a terminal pastes it, so Claude Code takes it as an image,
// and the chat face shows its chip (M9 fix 747). It lights the whole pane
// on the way in so the two outcomes look different. A file dropped on an empty pane
// (M9 fix 387) opens a file view there instead, the same geometry as a
// folder: center into the pane, an edge splits it beside; gated on
// fileViewSupported, so an older daemon still lights and does nothing.
//
// Whether the drag is a file, a folder or unreadable while it hovers is
// read off the items: a folder from Explorer always has an empty type,
// and so does a file whose extension Windows has none registered for
// (.md, say); Chromium keeps the drag data store protected until the
// drop, so nothing else is readable while it hovers, and an empty type
// reads as unknown rather than folder (M9 fix 388). The preview then
// lights what either a folder or a file would take, the pane's zones and
// the strip or the rail, and the drop stats the path to pick between
// them, as it already does; no outcome changes, and a folder now lights
// the strip or the rail on the way in even though dropping it there does
// nothing.
//
// M9 fix 341: a file dropped on the tab strip or the files rail opens
// as a pinned tab, the way Explorer's own drop on an editor opens the
// file rather than typing its name; a folder there does nothing. The
// element under the mouse wears data-drop-target while a file hovers,
// so the strip or the rail lights the way a pane does.

// Chromium repeats dragover every few hundred milliseconds while a drag
// hovers, so a drag that ended without a dragleave (a cancelled one, say)
// goes quiet for longer than this and the overlay is taken down.
const QUIET_MS = 1000;

let active = false;
let quiet: ReturnType<typeof setTimeout> | null = null;
// The strip or the rail lit for a file or an unknown drag (fix 341, fix
// 388), or null.
let outside: HTMLElement | null = null;

type DragKind = 'file' | 'folder' | 'unknown';

const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') === true;
// 'folder' is never read here (see the comment above); it names the
// third case the drop itself resolves, once it stats the path, so a
// caller matching on this type stays exhaustive against that.
const dragKindOf = (e: DragEvent): DragKind => {
  const item = e.dataTransfer?.items[0];
  return item !== undefined && item.kind === 'file' && item.type !== '' ? 'file' : 'unknown';
};
const paneHasSession = (paneId: string): boolean => {
  const tab = paneTab(paneId);
  return tab !== null && findPane(tab, paneId)?.sessionId != null;
};

function begin(): void {
  if (active) return;
  active = true;
  beginSessionDrag(null);
  document.body.classList.add('dragging-session');
}

function end(): void {
  if (quiet !== null) clearTimeout(quiet);
  quiet = null;
  setOutside(null);
  if (!active) return;
  active = false;
  document.body.classList.remove('dragging-session');
  endSessionDrag();
}

// The strip or the rail under the point (fix 341); an opener for a file,
// nothing for a folder. The rail collapsed is its narrow bar, which is
// not it.
function outsideAt(x: number, y: number): HTMLElement | null {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>('.tab-strip, .files-rail') ?? null;
}

function setOutside(el: HTMLElement | null): void {
  if (outside === el) return;
  if (outside !== null) delete outside.dataset['dropTarget'];
  if (el !== null) el.dataset['dropTarget'] = '';
  outside = el;
}

function touch(): void {
  if (quiet !== null) clearTimeout(quiet);
  quiet = setTimeout(end, QUIET_MS);
}

function onEnter(e: DragEvent): void {
  if (!hasFiles(e)) return;
  e.preventDefault();
  begin();
  touch();
}

// Every dragover is prevented, so the window never navigates to a dropped
// file; the effect says whether a drop here does anything, which is what
// the cursor shows. The target follows the mouse the way the sidebar drag's
// does, and clears over anything that is not a pane.
function onOver(e: DragEvent): void {
  if (!hasFiles(e) || e.dataTransfer === null) return;
  e.preventDefault();
  begin();
  touch();
  const kind = dragKindOf(e);
  setSessionDragFile(kind === 'file');
  let target = targetAt(e.clientX, e.clientY);
  // A file over an empty pane opens a file view there (fix 387) on a
  // daemon that can hold one; a folder always can, so only a definite
  // file is gated on the daemon here, and an unknown drag (fix 388, it
  // might be a folder) keeps its target on any daemon.
  if (kind === 'file' && target !== null && !paneHasSession(target.paneId) && !fileViewSupported(getState().daemon)) target = null;
  setSessionDropTarget(target);
  // The strip or the rail lights for anything that might be a file (fix
  // 341, fix 388): a definite file, or a drag whose kind is only known
  // once the drop stats it.
  const over = outsideAt(e.clientX, e.clientY);
  setOutside(over);
  e.dataTransfer.dropEffect = target === null && over === null ? 'none' : 'copy';
}

// dragleave fires between elements too; only leaving the window (no
// related target inside the document) ends the drag.
function onLeave(e: DragEvent): void {
  if (!active) return;
  const to = e.relatedTarget;
  if (to === null || !(to instanceof Node) || !document.contains(to)) end();
}

function onDrop(e: DragEvent): void {
  if (!hasFiles(e)) return;
  // The chat box took an image itself (M9 fix 721): it pastes the path,
  // which Claude Code turns into an image, where typing it here stays
  // text.
  if (e.defaultPrevented) {
    end();
    return;
  }
  e.preventDefault();
  const target = getUiState().sessionDrag?.target ?? targetAt(e.clientX, e.clientY);
  const over = outsideAt(e.clientX, e.clientY);
  const file = e.dataTransfer?.files[0];
  end();
  if (file === undefined) return;
  if (target !== null) {
    void dropFile(file, target).catch((err: unknown) => console.warn('[emerald] explorer drop failed', err));
    return;
  }
  // The strip or the rail (fix 341): the drop is read off the point
  // rather than the hover's guess, since a .md looks like a folder until
  // it is stat'ed.
  if (over !== null) void dropOutside(file).catch((err: unknown) => console.warn('[emerald] explorer drop failed', err));
}

async function dropOutside(file: File): Promise<void> {
  const path = window.emerald.files.pathFor(file);
  if (path === '') return;
  const stat = await window.emerald.files.stat(path);
  if ('error' in stat || stat.kind === 'dir') return;
  recordUse('drop-file-tab');
  await openFileFromOutside(path);
}

// The drop stats the path rather than trusting the hover's guess. A file
// is typed the way Insert path types one: quoted when it has a space,
// no Enter, so the person can finish the command. An image on a Claude
// session is pasted rather than typed (M9 fix 747).
async function dropFile(file: File, target: DropTarget): Promise<void> {
  const path = window.emerald.files.pathFor(file);
  if (path === '') return;
  const stat = await window.emerald.files.stat(path);
  if ('error' in stat) return;
  if (stat.kind === 'dir') {
    await dropFolderOn(path, target.paneId, target.zone);
    return;
  }
  const tab = paneTab(target.paneId);
  const sessionId = tab === null ? null : findPane(tab, target.paneId)?.sessionId;
  if (sessionId == null) {
    if (fileViewSupported(getState().daemon)) await dropFileOn(path, target.paneId, target.zone);
    return;
  }
  recordUse('drop-path');
  const session = getState().sessions.get(sessionId);
  if (session !== undefined && markKind(session) === 'claude' && isImageName(path)) {
    typeInto(sessionId, pastedPath(path));
    window.dispatchEvent(new CustomEvent('emerald:chat-image', { detail: { paneId: target.paneId, path } }));
    return;
  }
  typeInto(sessionId, path.includes(' ') ? `"${path}"` : path);
}

// The pane under the point and the half of it the mouse is in, as in
// pane-drag.ts. A pane under a file tab is hidden, so nothing is found.
function targetAt(x: number, y: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-pane-id]') ?? null;
  const paneId = el?.dataset['paneId'];
  if (el === null || paneId === undefined) return null;
  const zone = zoneAt(el.getBoundingClientRect(), { x, y });
  return zone === null ? null : { paneId, zone };
}

export function installExplorerDrop(): () => void {
  window.addEventListener('dragenter', onEnter);
  window.addEventListener('dragover', onOver);
  window.addEventListener('dragleave', onLeave);
  window.addEventListener('drop', onDrop);
  return () => {
    window.removeEventListener('dragenter', onEnter);
    window.removeEventListener('dragover', onOver);
    window.removeEventListener('dragleave', onLeave);
    window.removeEventListener('drop', onDrop);
    end();
  };
}

// The layout tab holding the pane (M36); a pane under the mouse is in the
// tab on show, but the lookup is by pane so it cannot be wrong.
function paneTab(paneId: string): LayoutTab | null {
  const layout = getState().layout;
  return layout === null ? null : tabHolding(layout, paneId);
}
