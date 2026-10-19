import { closePane, listPanes, replaceTab, setPaneView } from '@emerald/shared';
import type { FilePaneView, FileTabView, Layout } from '@emerald/shared';
import { folderName, normalizePath, renamedPath } from './files-model.ts';

// The pure part of the tab strip, with no DOM so node:test can cover it.
// The first tab is the panes and every other one is a file opened from
// the files rail; a file is open once however often it is clicked. The
// active tab is PANES or one of the open paths. Paths are normalized the
// way the files rail normalizes them so a file reached two ways is one tab.
// A markdown tab has a view, rendered or raw, and a Claude Code
// transcript (M53) turns or raw; the first is the default for each, so
// the model only lists the tabs switched to raw, and a closed tab drops
// out of that list so a re-open starts on its default again.

export const PANES = 'panes';

// The switch a markdown or transcript tab keeps; shared with the layout
// since M9 fix 180, where a file pane's record carries the same one.
export type { FileTabView };

// A tab that is not a file (M54): a document of the app's own under the
// emerald:// scheme, today the activity view of one window,
// emerald://activity/YYYY-MM-DD (or YYYY-MM-DDTHH, or YYYY-MM-DDTHH:MM). It sits in the same list as the files so
// it opens, closes and cycles like one, and its key is the URL as it is,
// never normalized into a path.
export const DOCUMENT_SCHEME = 'emerald://';

export function isDocument(path: string): boolean {
  return path.startsWith(DOCUMENT_SCHEME);
}

// The window an activity document shows (a day, or since M67 an hour or
// a minute, or since M9 fix 230 a week, or since M9 fix 321 a five-hour
// usage window, the key's form saying which: `unitBounds` in shared
// reads it), or null for any other tab. Since M9 fix 518 an hour or a
// minute the autumn clock change repeats carries a `b` for its second
// occurrence (`T01b`, `T01:30b`, `T01:40bf`), and the path keeps it.
export function activityWindow(path: string): string | null {
  const m = /^emerald:\/\/activity\/(\d{4}-\d{2}-\d{2}(?:T\d{2}(?::\d{2}b?f?|b)?|w)?)$/.exec(documentKey(path));
  return m === null ? null : m[1]!;
}

// M9 fix 178: a document opened from the rail carries the section's
// state as a query on its path (`?scope=folder&layers=band`); the query
// is the tab's state, kept beside the tab list under the document's key,
// so a second open of the same window replaces the state rather than
// adding a tab, and the view rewrites it as its settings change.
export function activityPath(key: string, query?: string): string {
  return withQuery(`${DOCUMENT_SCHEME}activity/${key}`, query);
}

export function withQuery(path: string, query: string | undefined): string {
  return query === undefined || query === '' ? path : `${path}?${query}`;
}

// A document's path without its query: the key it is listed under.
export function documentKey(path: string): string {
  const q = path.indexOf('?');
  return q < 0 ? path : path.slice(0, q);
}

export function documentQuery(path: string): string | null {
  const q = path.indexOf('?');
  return q < 0 ? null : path.slice(q + 1);
}

// The folder a commits document shows (M61), emerald://commits/<folder>
// with the folder URL-encoded so its separators never read as the
// path's; null for any other tab.
export function commitsFolder(path: string): string | null {
  const m = /^emerald:\/\/commits\/(.+)$/.exec(documentKey(path));
  if (m === null) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

export function commitsPath(folder: string, query?: string): string {
  return withQuery(`${DOCUMENT_SCHEME}commits/${encodeURIComponent(normalizePath(folder))}`, query);
}

// A folder's statistics (M9 fix 837), a fifth document kind,
// emerald://stats/<folder> shaped as the commits tab's path, with no
// query: the tab keeps no state of its own; the plan it shows (fix 838)
// is the window's.
export function statsFolder(path: string): string | null {
  const m = /^emerald:\/\/stats\/(.+)$/.exec(documentKey(path));
  if (m === null) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
}

export function statsPath(folder: string): string {
  return `${DOCUMENT_SCHEME}stats/${encodeURIComponent(normalizePath(folder))}`;
}

// The release notes (M9 fix 227): a fourth document kind with one key
// and no query, opened by the app itself after an install and by the
// `whats-new` action. The text is docs/WHATS-NEW.md, read through the
// main process, so nothing on disk is the tab's path.
export const WHATS_NEW_PATH = `${DOCUMENT_SCHEME}whats-new`;

export function isWhatsNew(path: string): boolean {
  return documentKey(path) === WHATS_NEW_PATH;
}

// The key a tab is listed under: a file's normalized path, a document's
// URL without its query.
export function tabKey(path: string): string {
  return isDocument(path) ? documentKey(path) : normalizePath(path);
}

export interface TabsModel {
  files: readonly string[];
  active: string;
  raw: readonly string[];
  // M9 fix 178: a document tab's state, by its key; a document with no
  // state has no entry.
  query: Readonly<Record<string, string>>;
  // M9 fix 203: the one tab a single click in the rail opens into and the
  // next single click reuses, so ten clicks are one tab, not ten; null
  // when every open tab is pinned. A double click, a drag, a menu's Open
  // in a tab or any other opener pins.
  preview: string | null;
}

export function emptyTabs(): TabsModel {
  return { files: [], active: PANES, raw: [], query: {}, preview: null };
}

export interface OpenOptions {
  preview?: boolean;
}

// A path with a query sets the tab's state (a re-open from the rail is
// a new snapshot); one without leaves what the tab has.
// A preview open (M9 fix 203) of a path that is not open yet takes the
// preview tab's place, the same index so the strip does not jump, when
// there is one, and starts one when there is none; a path already open
// is only activated, pinned or preview as it was, so a pinned file
// re-clicked stays pinned. A pinned open of a new path leaves the
// preview tab where it is.
export function openFile(m: TabsModel, path: string, opts: OpenOptions = {}): TabsModel {
  const p = tabKey(path);
  const q = isDocument(path) ? documentQuery(path) : null;
  const query = q === null ? m.query : setQuery(m.query, p, q);
  if (m.files.includes(p)) return { ...m, active: p, query };
  const old = opts.preview === true && m.preview !== null && m.files.includes(m.preview) ? m.preview : null;
  if (old === null) {
    return { files: [...m.files, p], active: p, raw: m.raw, query, preview: opts.preview === true ? p : m.preview };
  }
  const files = m.files.map((f) => (f === old ? p : f));
  return { files, active: p, raw: keepRaw(m.raw, files), query: keepQuery(query, files), preview: p };
}

// The preview tab kept for good (M9 fix 203); a path that is not the
// preview is no change.
export function pinTab(m: TabsModel, path: string): TabsModel {
  return m.preview === tabKey(path) ? { ...m, preview: null } : m;
}

// True while the tab is the preview one; the strip draws its name in
// italics.
export function isPreview(m: TabsModel, path: string): boolean {
  return m.preview !== null && m.preview === tabKey(path);
}

function keepPreview(preview: string | null, files: readonly string[]): string | null {
  return preview !== null && files.includes(preview) ? preview : null;
}

// The view rewrites its tab's state as its settings change; an empty
// query drops the entry.
export function setTabQuery(m: TabsModel, path: string, query: string | null): TabsModel {
  const p = tabKey(path);
  if (!m.files.includes(p)) return m;
  const next = setQuery(m.query, p, query);
  return next === m.query ? m : { ...m, query: next };
}

export function tabQuery(m: TabsModel, path: string): string | null {
  return m.query[tabKey(path)] ?? null;
}

function setQuery(query: Readonly<Record<string, string>>, key: string, value: string | null): Readonly<Record<string, string>> {
  if (value === null || value === '') {
    if (!(key in query)) return query;
    const { [key]: _gone, ...rest } = query;
    return rest;
  }
  if (query[key] === value) return query;
  return { ...query, [key]: value };
}

function keepQuery(query: Readonly<Record<string, string>>, files: readonly string[]): Readonly<Record<string, string>> {
  const kept = Object.fromEntries(Object.entries(query).filter(([k]) => files.includes(k)));
  return Object.keys(kept).length === Object.keys(query).length ? query : kept;
}

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

// A mermaid file opens rendered as one diagram box (M9 fix 658).
export function isMermaidFile(path: string): boolean {
  return /\.(mmd|mermaid)$/i.test(path);
}

// A picture the tab shows as one (M9 fix 615). A network path is never an
// image, for fix 478's reason: loading it would offer the user's
// credentials to the host, so it falls through to the plain read.
export function isImage(path: string): boolean {
  return !/^[\\/]{2}/.test(path) && /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(path);
}

// A picture kind that can be animated gets the Pause button (M9 fix 638); by
// extension, so a still GIF has one that changes nothing visible, since
// telling the two apart needs the file's bytes, which the renderer cannot
// fetch from a file: URL.
export function isAnimatedKind(path: string): boolean {
  return isImage(path) && /\.(gif|webp)$/i.test(path);
}

// A .json file alone (M9 fix 339): a .jsonl is lines of JSON and stays
// on the editor, and a transcript is one but has its turns.
export function isJson(path: string): boolean {
  return /\.json$/i.test(path);
}

// A conversation's transcript, by where Claude Code keeps them: a
// <session id>.jsonl one level under a projects folder (the home need not
// be ~/.claude, the verify script points at another).
export function isTranscript(path: string): boolean {
  return /[\\/]projects[\\/][^\\/]+[\\/][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i.test(path);
}

// M9 fix 634: whether typing opens Monaco's suggestion box. Prose gets none
// as you type (Ctrl+Space still opens it); the object is Monaco's own default
// (editorOptions.js), given back explicitly because one editor shows many
// models in turn and the option stays on the editor.
export function quickSuggestionsFor(languageId: string): false | { other: 'offWhenInlineCompletions'; comments: 'off'; strings: 'off' } {
  return languageId === 'markdown' || languageId === 'plaintext' ? false : { other: 'offWhenInlineCompletions', comments: 'off', strings: 'off' };
}

// The view a kind of file starts on, or null for a file that is only ever
// the editor.
export function defaultView(path: string): FileTabView | null {
  if (isMarkdown(path)) return 'rendered';
  if (isMermaidFile(path)) return 'rendered';
  // An SVG is text and a picture: Rendered shows the picture, Raw the editor.
  if (isImage(path) && /\.svg$/i.test(path)) return 'rendered';
  if (isTranscript(path)) return 'turns';
  if (isJson(path)) return 'pretty';
  return null;
}

// The views that cannot show a line (M9 fix 892): a file with a view of its own opens on Raw at a line, but markdown keeps Rendered, which scrolls to the block holding the line (MarkdownView).
export function rawAtLine(path: string): boolean {
  return defaultView(path) !== null && !isMarkdown(path);
}

// The view a path opened beside at a line takes (M9 fix 864): Raw for a
// file with a view of its own other than markdown (fix 892), since only
// the editor shows a line, as a tab's open at a line does (ui.ts openTab).
export function fileViewAt(path: string, line: number | undefined): FilePaneView {
  return line !== undefined && rawAtLine(path) ? { kind: 'file', path, view: 'raw' } : { kind: 'file', path };
}

// A markdown, SVG, transcript or JSON tab has a view; anything else is the
// editor and asking says raw.
export function viewFor(m: TabsModel, path: string): FileTabView {
  const p = tabKey(path);
  const own = defaultView(p);
  return own !== null && !m.raw.includes(p) ? own : 'raw';
}

// A view that is not the file's own (rendered on a transcript, turns on
// markdown, pretty on either) is no change.
export function setView(m: TabsModel, path: string, view: FileTabView): TabsModel {
  const p = tabKey(path);
  const own = defaultView(p);
  if (!m.files.includes(p) || own === null || (view !== 'raw' && view !== own)) return m;
  const inRaw = m.raw.includes(p);
  if ((view === 'raw') === inRaw) return m;
  const raw = view === 'raw' ? [...m.raw, p] : m.raw.filter((f) => f !== p);
  return { ...m, raw };
}

function keepRaw(raw: readonly string[], files: readonly string[]): readonly string[] {
  return raw.filter((f) => files.includes(f));
}

// Closing the active tab moves to the one on its right, else the left,
// else the panes, as browsers do; closing another tab leaves the active
// one alone.
export function closeFile(m: TabsModel, path: string): TabsModel {
  const p = tabKey(path);
  const i = m.files.indexOf(p);
  if (i < 0) return m;
  const files = m.files.filter((f) => f !== p);
  const raw = keepRaw(m.raw, files);
  const query = keepQuery(m.query, files);
  const preview = keepPreview(m.preview, files);
  if (m.active !== p) return { files, active: m.active, raw, query, preview };
  const next = files[i] ?? files[i - 1] ?? PANES;
  return { files, active: next, raw, query, preview };
}

// The tabs after the rail renames a file or a folder (M9 fix 574): every
// file tab on the path or under it takes the new path in its place, and
// the active tab, the raw views and the preview with it. A document key
// and the query (document keys alone) stay as they are. The model itself
// comes back when nothing moved.
export function renameTabs(m: TabsModel, from: string, to: string): TabsModel {
  let moved = false;
  const move = (k: string): string => {
    if (k === PANES || isDocument(k)) return k;
    const next = renamedPath(k, from, to);
    if (next === null || next === k) return k;
    moved = true;
    return next;
  };
  const files = m.files.map(move);
  const active = move(m.active);
  const raw = m.raw.map(move);
  const preview = m.preview === null ? null : move(m.preview);
  return moved ? { files, active, raw, query: m.query, preview } : m;
}

// The panes after the rail renames a file or a folder (M9 fix 591): every
// file pane of every layout tab on the path or under it takes the new
// path, as renameTabs moves the tabs. A kept `raw` stays only where the
// new file has a view of its own to differ from, so a rename across
// extensions leaves no stale field. A session pane and the commits and
// activity views stay; the layout itself comes back when nothing moved,
// so applyEdit sends nothing.
export function renameFilePanes(layout: Layout, from: string, to: string): Layout {
  let out = layout;
  for (const tab of layout.tabs) {
    let next = tab;
    for (const pane of listPanes(tab)) {
      if (pane.view?.kind !== 'file') continue;
      const path = renamedPath(pane.view.path, from, to);
      if (path === null || path === pane.view.path) continue;
      const view: FilePaneView = pane.view.view === 'raw' && defaultView(path) !== null ? { kind: 'file', path, view: 'raw' } : { kind: 'file', path };
      next = setPaneView(next, pane.id, view);
    }
    if (next !== tab) out = replaceTab(out, next);
  }
  return out;
}

// The layout after the rail deletes a file or a folder (M9 fix 617):
// every file pane on the path or under it closes, on every tab; a tab's
// only pane is emptied rather than removed (closePane's rule). The
// layout itself comes back when nothing closed.
export function deletedFilePanes(layout: Layout, path: string): Layout {
  let out = layout;
  for (const tab of layout.tabs) {
    let next = tab;
    for (const pane of listPanes(tab)) {
      if (pane.view?.kind !== 'file' || renamedPath(pane.view.path, path, path) === null) continue;
      next = closePane(next, pane.id);
    }
    if (next !== tab) out = replaceTab(out, next);
  }
  return out;
}

export function closeOthers(m: TabsModel, path: string): TabsModel {
  const p = tabKey(path);
  if (!m.files.includes(p)) return m;
  return { files: [p], active: p, raw: keepRaw(m.raw, [p]), query: keepQuery(m.query, [p]), preview: keepPreview(m.preview, [p]) };
}

export function closeAll(m: TabsModel): TabsModel {
  return emptyTabs();
}

// A path that is not open falls back to the panes rather than showing a
// tab the strip does not have.
export function activate(m: TabsModel, tab: string): TabsModel {
  const t = tab === PANES ? PANES : tabKey(tab);
  const active = t === PANES || m.files.includes(t) ? t : PANES;
  return active === m.active ? m : { ...m, active };
}

export function isFileTab(m: TabsModel): boolean {
  return m.active !== PANES;
}

// The name a tab shows: the last segment of the path; an activity
// document says its day, a commits document its folder.
// A transcript tab is named by its conversation once the view has read
// the title (M9 fix 96, the titles map), the session id until then.
export function tabName(path: string, titles?: ReadonlyMap<string, string>): string {
  const title = titles?.get(path);
  if (title !== undefined) return title;
  const window = activityWindow(path);
  // `Activity 2026-09-13`, `Activity 2026-09-13 14:00`, `Activity 2026-09-13 14:07`, `Activity week of 2026-09-14`, `Activity 5h from 2026-09-19 13:40`.
  if (window !== null) {
    if (window.endsWith('w')) return `Activity week of ${window.slice(0, -1)}`;
    // The second occurrence of a repeated hour (M9 fix 518) drops its
    // `b` from the name and says so after it.
    const again = window.includes('b') ? ' (repeated)' : '';
    const key = window.replace('b', '');
    if (key.endsWith('f')) return `Activity 5h from ${key.slice(0, -1).replace('T', ' ')}${again}`;
    return `Activity ${key.includes(':') || !key.includes('T') ? key.replace('T', ' ') : `${key.replace('T', ' ')}:00`}${again}`;
  }
  const folder = commitsFolder(path);
  if (folder !== null) return `Commits · ${folderName(folder) || folder}`;
  const statsOf = statsFolder(path);
  if (statsOf !== null) return `Statistics · ${folderName(statsOf) || statsOf}`;
  if (isWhatsNew(path)) return "What's new";
  if (isTranscript(path)) return folderName(path).replace(/\.jsonl$/i, '');
  return isDocument(path) ? path.slice(DOCUMENT_SCHEME.length) : folderName(path);
}

// M9 fix 248: the mark a tab wears before its name while its file has
// unsaved edits. The dirty set is keyed the way the tabs are, so a path
// reached another way is the same file; a document tab is never dirty.
export const DIRTY_MARK = '●';

export function dirtyMark(path: string, dirty: ReadonlySet<string>): string | null {
  return !isDocument(path) && dirty.has(tabKey(path)) ? DIRTY_MARK : null;
}

// What goes to localStorage and comes back: unknown shapes give the empty
// model rather than a strip that cannot draw itself. A file before M13 had
// no `raw` list, which reads as every markdown tab rendered, and one
// before M9 fix 203 no `preview`, which reads as every tab pinned; the
// preview survives a restart as a preview.
export function tabsFromJson(json: unknown): TabsModel {
  if (typeof json !== 'object' || json === null) return emptyTabs();
  const { files, active, raw, query, preview } = json as { files?: unknown; active?: unknown; raw?: unknown; query?: unknown; preview?: unknown };
  if (!Array.isArray(files)) return emptyTabs();
  const clean = cleanPaths(files);
  const cleanRaw = Array.isArray(raw) ? cleanPaths(raw).filter((p) => clean.includes(p) && defaultView(p) !== null) : [];
  const cleanQuery: Record<string, string> = {};
  if (typeof query === 'object' && query !== null) {
    for (const [k, v] of Object.entries(query as Record<string, unknown>)) if (typeof v === 'string' && v !== '' && clean.includes(k) && isDocument(k)) cleanQuery[k] = v;
  }
  const cleanPreview = typeof preview === 'string' && preview !== '' ? keepPreview(tabKey(preview), clean) : null;
  return activate({ files: clean, active: PANES, raw: cleanRaw, query: cleanQuery, preview: cleanPreview }, typeof active === 'string' ? active : PANES);
}

function cleanPaths(list: unknown[]): string[] {
  const clean: string[] = [];
  for (const f of list) {
    if (typeof f !== 'string' || f === '') continue;
    const p = tabKey(f);
    if (!clean.includes(p)) clean.push(p);
  }
  return clean;
}
