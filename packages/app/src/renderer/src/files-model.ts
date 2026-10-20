import type { BrowserPaneView, Layout, SessionInfo } from '@emerald/shared';
import { allPanes, localPageOf } from '@emerald/shared';
import type { FileEntry, FileListing } from '../../preload/api.ts';

// The pure part of the files rail, with no DOM so node:test can cover it.
// The tree is a map from an absolute folder path to what the main process
// listed for it, plus the set of folders that are open. Listings and the
// open set outlive a root change on purpose: a shell that cds into a
// subfolder and back, or a focus change and back, finds the tree as it
// was left. Every path here is normalized (backslashes, no trailing
// separator) so a folder reported as C:/x and one as C:\x\ are one key.

export interface FilesModel {
  root: string | null;
  listings: ReadonlyMap<string, FileListing>;
  expanded: ReadonlySet<string>;
  selected: string | null;
}

export type Row =
  | { type: 'entry'; path: string; name: string; kind: FileEntry['kind']; depth: number; expanded: boolean }
  // An error in place of a folder's children, or the count of entries a
  // capped listing left out.
  | { type: 'note'; path: string; depth: number; text: string }
  // The name box of a file or folder being made (M9 fix 309), the first
  // child of the folder it goes in.
  | { type: 'pending'; dir: string; kind: FileEntry['kind']; depth: number };

// What the rail is making (M9 fix 309): the folder it goes in and which
// kind. The typed name and why it was turned down stay with the rail's
// box, since they are the box's and not the tree's.
export interface Pending {
  dir: string;
  kind: FileEntry['kind'];
}

export function emptyModel(): FilesModel {
  return { root: null, listings: new Map(), expanded: new Set(), selected: null };
}

// Forward slashes become backslashes, runs collapse, and a trailing
// separator goes unless the path is a drive root. A UNC path keeps its
// two leading backslashes.
export function normalizePath(p: string): string {
  const unc = p.startsWith('\\\\') || p.startsWith('//');
  let out = p.replace(/[\\/]+/g, '\\');
  if (unc) out = '\\' + out;
  if (out.length > 3 && out.endsWith('\\')) out = out.slice(0, -1);
  return out;
}

export function joinPath(dir: string, name: string): string {
  return normalizePath(`${dir}\\${name}`);
}

// The folder a path is in, keyed the way the tree keys folders, so a
// file tab can tell which watched folder's change is its own.
export function parentPath(p: string): string {
  const full = normalizePath(p);
  const i = full.lastIndexOf('\\');
  return normalizePath(`${full.slice(0, Math.max(i, 0))}\\`);
}

// The folders of every file view on any layout tab's panes (M9 fix 337):
// a file opened in a pane with no tab (M9 fix 180) is watched only
// through this, since it never joins tabs.files. Deduplicated, in pane
// order; the rail joins it with the open file tabs' folders for its
// watch set.
export function filePaneFolders(layout: Layout): string[] {
  return [...new Set(allPanes(layout).flatMap((p) => (p.view?.kind === 'file' ? [parentPath(p.view.path)] : [])))];
}

// M9 fix 898: the folders a page from the disk is read from, its own file's and its root, so the pane hears a change to the page or to a stylesheet a level up; deduplicated.
export function localPageFolders(view: BrowserPaneView): string[] {
  const local = localPageOf(view.url);
  if (local === null || view.root === undefined) return [];
  const file = normalizePath(joinPath(view.root, local.rel.split('/').join('\\')));
  return [...new Set([local.rel === '' ? normalizePath(view.root) : parentPath(file), normalizePath(view.root)])];
}

// Every browser view's localPageFolders across every tab, deduplicated.
export function browserPaneFolders(layout: Layout): string[] {
  return [...new Set(allPanes(layout).flatMap((p) => (p.view?.kind === 'browser' ? localPageFolders(p.view) : [])))];
}

// The transcript folders of the panes on the chat face (M9 fix 689), so
// the chat view hears its transcript grow; deduplicated, in pane order.
// A pane whose stored session is not the one it shows is on the
// terminal and watches nothing.
export function chatPaneFolders(layout: Layout, chatPanes: ReadonlyMap<string, string>, sessions: ReadonlyMap<string, Pick<SessionInfo, 'transcriptPath'>>): string[] {
  return [
    ...new Set(
      allPanes(layout).flatMap((p) => {
        if (p.sessionId === null || chatPanes.get(p.id) !== p.sessionId) return [];
        const path = sessions.get(p.sessionId)?.transcriptPath ?? null;
        return path === null ? [] : [parentPath(path)];
      }),
    ),
  ];
}

// The path under root as the shell would type it, or the whole path when
// it is not under root.
export function relativePath(root: string, p: string): string {
  const base = normalizePath(root);
  const full = normalizePath(p);
  const prefix = base.endsWith('\\') ? base : `${base}\\`;
  return full.toLowerCase().startsWith(prefix.toLowerCase()) ? full.slice(prefix.length) : full;
}

export function folderName(p: string): string {
  const parts = normalizePath(p).split('\\').filter((s) => s !== '');
  return parts[parts.length - 1] ?? p;
}

// M9 fix 366: a drive root has no name of its own (folderName's "C:" for
// "C:\" reads as a truncated word), so the up button and the rail's
// header name it by its path instead; every other folder keeps its name.
export function pathLabel(p: string): string {
  const full = normalizePath(p);
  return parentPath(full) === full ? full : folderName(full);
}

export function setRoot(m: FilesModel, root: string | null): FilesModel {
  const next = root === null ? null : normalizePath(root);
  if (next === m.root) return m;
  return { ...m, root: next, selected: null };
}

export function applyListing(m: FilesModel, dir: string, listing: FileListing): FilesModel {
  const listings = new Map(m.listings);
  listings.set(normalizePath(dir), listing);
  return { ...m, listings };
}

export function toggleFolder(m: FilesModel, dir: string): FilesModel {
  const key = normalizePath(dir);
  const expanded = new Set(m.expanded);
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
  return { ...m, expanded };
}

// Open a folder that is not, and leave one that is (M9 fix 309: the
// name box of a new entry goes inside its folder, so the folder opens).
export function expandFolder(m: FilesModel, dir: string): FilesModel {
  const key = normalizePath(dir);
  if (m.expanded.has(key)) return m;
  const expanded = new Set(m.expanded);
  expanded.add(key);
  return { ...m, expanded };
}

export function collapseAll(m: FilesModel): FilesModel {
  return m.expanded.size === 0 ? m : { ...m, expanded: new Set() };
}

export function select(m: FilesModel, p: string | null): FilesModel {
  const next = p === null ? null : normalizePath(p);
  return next === m.selected ? m : { ...m, selected: next };
}

// The keys the Files tree walks by once it has the keyboard (M9 fix 929),
// as VS Code's explorer does: Up and Down to the row above or below, Home
// and End to the first and the last, Right opens a folder and on an open
// one steps to its first child, Left folds an open folder and otherwise
// goes to the row's parent. Only entry rows count; a note and a name box
// are stepped over. With no selected row on screen, End selects the last
// row and every other key the first. The model comes back unchanged, the
// same object, where a key has nowhere to go, and null for a key that is
// not one of these, so the rail lets that key pass.
const TREE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function moveSelection(m: FilesModel, rows: readonly Row[], key: string): FilesModel | null {
  if (!TREE_KEYS.has(key)) return null;
  const entries = rows.filter((r): r is Extract<Row, { type: 'entry' }> => r.type === 'entry');
  if (entries.length === 0) return m;
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;
  const i = m.selected === null ? -1 : entries.findIndex((r) => r.path === m.selected);
  if (i < 0) return select(m, (key === 'End' ? last : first).path);
  const row = entries[i]!;
  switch (key) {
    case 'ArrowUp':
      return i === 0 ? m : select(m, entries[i - 1]!.path);
    case 'ArrowDown':
      return i === entries.length - 1 ? m : select(m, entries[i + 1]!.path);
    case 'Home':
      return select(m, first.path);
    case 'End':
      return select(m, last.path);
    case 'ArrowRight': {
      if (row.kind !== 'dir') return m;
      if (!row.expanded) return expandFolder(m, row.path);
      const child = entries[i + 1];
      return child !== undefined && child.depth === row.depth + 1 ? select(m, child.path) : m;
    }
    default: {
      // ArrowLeft
      if (row.kind === 'dir' && row.expanded) return toggleFolder(m, row.path);
      for (let j = i - 1; j >= 0; j--) {
        if (entries[j]!.depth < row.depth) return select(m, entries[j]!.path);
      }
      return m;
    }
  }
}

// The entry a listing of dir must keep past the cap (M9 fix 524): the
// newest folder on the lift chain whose parent is dir, else none. Each
// folder on a chain has one kept child, so one name per listing is enough.
// The compare drops a trailing separator on both sides, since parentPath
// keeps one on a short root (`C:\`).
export function liftKeep(chain: readonly string[], dir: string): string | undefined {
  const bare = (p: string) => p.replace(/\\$/, '');
  const want = bare(normalizePath(dir));
  for (let i = chain.length - 1; i >= 0; i--) {
    if (bare(parentPath(chain[i]!)) === want) return chain[i];
  }
  return undefined;
}

// The folders the rail asks the main process to watch, in the order it
// should keep them when there are more than it will watch (M9 fix 523;
// the main process keeps the front of the list): the root first, then the
// folders of the open file tabs, then the rest of the open folders by when
// they were opened, newest first, so the cap drops the oldest open folder
// and never the root. Deduplicated, the first place kept.
export function watchOrder(open: string[], expanded: ReadonlySet<string>, tabFolders: string[]): string[] {
  const opened = [...expanded];
  const rest = open.slice(1).sort((a, b) => opened.indexOf(b) - opened.indexOf(a));
  return [...new Set([...open.slice(0, 1), ...tabFolders, ...rest])];
}

// The rows the rail draws, top to bottom, and the folders that are open on
// screen (the root and every expanded folder whose parents are expanded),
// which is what needs listing and watching. One walk gives both so they
// cannot disagree.
export function walk(m: FilesModel): { rows: Row[]; open: string[] } {
  const rows: Row[] = [];
  const open: string[] = [];
  if (m.root === null) return { rows, open };
  const visit = (dir: string, depth: number) => {
    open.push(dir);
    const listing = m.listings.get(dir);
    if (listing === undefined) return;
    if ('error' in listing) {
      rows.push({ type: 'note', path: dir, depth, text: listing.error });
      return;
    }
    for (const e of listing.entries) {
      const p = joinPath(dir, e.name);
      const expanded = e.kind === 'dir' && m.expanded.has(p);
      rows.push({ type: 'entry', path: p, name: e.name, kind: e.kind, depth, expanded });
      if (expanded) visit(p, depth + 1);
    }
    if (listing.truncated > 0) rows.push({ type: 'note', path: dir, depth, text: `${listing.truncated} more not shown` });
  };
  visit(m.root, 0);
  return { rows, open };
}

// M9 fix 588: the rail says `Empty folder` for a folder that holds
// nothing; a listing not yet landed or an error is not empty, so the line
// never flashes before the first listing.
export function rootIsEmpty(m: FilesModel): boolean {
  if (m.root === null) return false;
  const listing = m.listings.get(m.root);
  if (listing === undefined || 'error' in listing) return false;
  return listing.entries.length === 0 && listing.truncated === 0;
}

// The rows with the name box of a new entry (M9 fix 309) put in as the
// first child of its folder: right under the root's top, or right under
// the folder's own row, which is there and expanded when the rail asked
// for the box. A folder no longer on screen (collapsed above, gone from
// the tree) gets no box, and the rows come back as they were.
export function withPending(rows: Row[], root: string | null, pending: Pending | null): Row[] {
  if (pending === null || root === null) return rows;
  const dir = normalizePath(pending.dir);
  const row = (depth: number): Row => ({ type: 'pending', dir, kind: pending.kind, depth });
  if (dir === normalizePath(root)) return [row(0), ...rows];
  const i = rows.findIndex((r) => r.type === 'entry' && r.kind === 'dir' && r.path === dir && r.expanded);
  if (i < 0) return rows;
  const at = rows[i]!;
  return [...rows.slice(0, i + 1), row(at.depth + 1), ...rows.slice(i + 1)];
}

// The path p takes when `from` is renamed to `to` (M9 fix 574): `to` when
// p is `from`, `to` plus the rest when p is under it, null otherwise.
// Compared case-insensitively on normalized paths, as relativePath
// compares; the rest keeps its own case.
export function renamedPath(p: string, from: string, to: string): string | null {
  const full = normalizePath(p);
  const base = normalizePath(from);
  if (full.toLowerCase() === base.toLowerCase()) return normalizePath(to);
  const prefix = base.endsWith('\\') ? base : `${base}\\`;
  if (!full.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  return joinPath(to, full.slice(prefix.length));
}

// The tree after a rename (M9 fix 574): the open folders, the listings
// and the selection under the renamed path move with it, and the entry
// is renamed in place in its parent's listing, kind kept, so the row
// reads the new name before the relist sorts it.
export function renameInModel(m: FilesModel, from: string, to: string): FilesModel {
  const move = (p: string) => renamedPath(p, from, to) ?? p;
  const expanded = new Set([...m.expanded].map(move));
  const listings = new Map<string, FileListing>();
  for (const [k, v] of m.listings) listings.set(move(k), v);
  const parent = parentPath(from);
  const own = listings.get(parent);
  if (own !== undefined && !('error' in own)) {
    const oldName = folderName(from).toLowerCase();
    const newName = folderName(to);
    listings.set(parent, { ...own, entries: own.entries.map((e) => (e.name.toLowerCase() === oldName ? { ...e, name: newName } : e)) });
  }
  const selected = m.selected === null ? null : move(m.selected);
  return { ...m, expanded, listings, selected };
}

// Where the name box selects to on mount (M9 fix 574): a file's stem,
// before its last dot when that is not the first character, else the
// whole name; a folder's whole name.
export function stemEnd(name: string, kind: FileEntry['kind']): number {
  if (kind === 'dir') return name.length;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}

// Whether a live session stands in the folder or under it (M9 fix 574),
// for the words of a refused rename. A Claude session's process stands
// in spawnCwd while cwd follows its shell's cd, and Windows holds the
// process's own folder, so both are read.
export function sessionInFolder(dir: string, sessions: Iterable<SessionInfo>): boolean {
  for (const s of sessions) {
    if (s.state === 'exited') continue;
    for (const p of [s.cwd, s.spawnCwd]) {
      if (typeof p === 'string' && p !== '' && renamedPath(p, dir, dir) !== null) return true;
    }
  }
  return false;
}

// Where the row menu was opened (M9 fixes 588 and 618): a tree row
// (`row`), a names-mode search hit (`hit`), a contents hit (`line`), a
// Changed row (`changed`), a deleted file's Changed row (`gone`) or the
// rail's own folder (`root`).
export type MenuFrom = 'row' | 'hit' | 'line' | 'changed' | 'gone' | 'root';

// Whether the menu offers Rename (and fix 617's Delete) there: a contents
// hit is one of several rows of one file, a deleted file's Changed row
// has nothing on disk, and the root is the rail's own folder.
export function canEditFrom(from: MenuFrom): boolean {
  return from === 'row' || from === 'hit' || from === 'changed';
}

// The words of a refused name box (M9 fixes 309 and 574): the generic
// refusal is named by what was asked, a make or a rename.
export function refusalWords(refused: 'exists' | 'name' | 'refused' | 'in-use', rename: boolean): string {
  switch (refused) {
    case 'exists':
      return 'A file or folder of that name is already there';
    case 'name':
      return 'A name, not a path: no slashes';
    case 'in-use':
      return 'In use by a session';
    default:
      return rename ? 'Could not be renamed here' : 'Could not be made here';
  }
}

// Who touched a file (M9 fix 198): one entry per session that wrote the
// path, newest write first, with what the row's dot and tooltip need.
// The path is keyed the way the git indexes key theirs (normalized,
// lowercased) so a row is looked up by its own path.
export interface TouchedBy {
  sessionId: string;
  name: string;
  color: string | null;
  at: number;
  agentId: string | null;
}

export type TouchedIndex = Map<string, TouchedBy[]>;

// One index over every session in the store, built per render: a
// session's list is at most Limits.touchedKept long and the store holds
// a few dozen sessions, so the work is small next to the walk.
export function touchedIndex(sessions: Iterable<SessionInfo>): TouchedIndex {
  const index: TouchedIndex = new Map();
  for (const s of sessions) {
    for (const t of s.touched ?? []) {
      const key = normalizePath(t.path).toLowerCase();
      const list = index.get(key) ?? [];
      list.push({ sessionId: s.id, name: s.name, color: s.color, at: t.at, agentId: t.agentId });
      index.set(key, list);
    }
  }
  for (const list of index.values()) list.sort((a, b) => b.at - a.at);
  return index;
}

export function touchedAt(index: TouchedIndex, p: string): TouchedBy[] {
  return index.get(normalizePath(p).toLowerCase()) ?? [];
}

// The sessions that touched anything under a folder, one entry per
// session with its latest write, newest first; for a folded folder's
// row, so the mark says a session was at work in there.
export function touchedUnder(index: TouchedIndex, dir: string): TouchedBy[] {
  const prefix = normalizePath(dir).toLowerCase() + '\\';
  const bySession = new Map<string, TouchedBy>();
  for (const [key, list] of index) {
    if (!key.startsWith(prefix)) continue;
    for (const t of list) {
      const known = bySession.get(t.sessionId);
      if (known === undefined || t.at > known.at) bySession.set(t.sessionId, t);
    }
  }
  return [...bySession.values()].sort((a, b) => b.at - a.at);
}

// Reveal in Files (M9 fix 652): how long the rail waits for its root and
// the listings of the file's folders before it says it cannot show it.
export const REVEAL_IN_FILES_MS = 3000;

// Whether the relist of a reveal (M9 fix 707) has landed: every folder whose
// relist answered holds a listing other than the one it held when the relist
// started. Whoever applied the newer one counts, the relist or a watch push.
export function relistLanded(listings: ReadonlyMap<string, FileListing>, before: ReadonlyMap<string, FileListing | undefined>, landed: readonly string[]): boolean {
  return landed.every((d) => listings.get(d) !== before.get(d));
}

// The parts of a path under root, or null when it is not under root (or
// is root itself). Compared through relativePath's rule, so the case and
// the slashes of either side do not matter.
function partsUnder(root: string, file: string): string[] | null {
  const full = normalizePath(file);
  const rel = relativePath(root, full);
  if (rel === full) return null;
  const parts = rel.split('\\').filter((s) => s !== '');
  return parts.length === 0 ? null : parts;
}

export type RevealStep = { kind: 'outside' } | { kind: 'waiting'; open?: string } | { kind: 'missing' } | { kind: 'shown'; row: string };

// Where a reveal stands against the tree: the file is not under the root
// (outside), a folder on its way is not open or not listed yet (waiting;
// when it is not open, `open` names it in the listing's own case, which is
// what the rail expands, since the file's own case may differ from the
// disk's, M9 fix 685),
// a listing on its way failed or has no such entry (missing), or its row
// is drawn (shown, the path in the listing's own case so it matches the
// row's data-path). A name past a capped listing's cut is not drawn, so
// it reads as missing too.
export function revealStep(m: FilesModel, file: string): RevealStep {
  if (m.root === null) return { kind: 'outside' };
  const parts = partsUnder(m.root, file);
  if (parts === null) return { kind: 'outside' };
  let dir = m.root;
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && !m.expanded.has(dir)) return { kind: 'waiting', open: dir };
    const listing = m.listings.get(dir);
    if (listing === undefined) return { kind: 'waiting' };
    if ('error' in listing) return { kind: 'missing' };
    const last = i === parts.length - 1;
    const want = parts[i]!.toLowerCase();
    const entry = listing.entries.find((e) => e.name.toLowerCase() === want && e.kind === (last ? 'file' : 'dir'));
    if (entry === undefined) return { kind: 'missing' };
    dir = joinPath(dir, entry.name);
  }
  return { kind: 'shown', row: dir };
}
