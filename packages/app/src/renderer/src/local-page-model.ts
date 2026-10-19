import { allPanes, localPageOf, localPageUrl, randomId } from '@emerald/shared';
import type { BrowserPaneView, IdGenerator, Layout } from '@emerald/shared';
import { joinPath, normalizePath, parentPath } from './files-model.ts';

// M9 fix 897: an HTML file rendered in a browser pane, from the Files
// rail's row menu or a file tab's Browser button. No JSX, so its test
// reaches it.

export function isHtmlFile(path: string): boolean {
  return /\.html?$/i.test(path);
}

// The folder the Files rail shows (M9 fix 897), for the file tab's Browser button, which has no rail of its own; each window is its own renderer, so each has its own.
let railRootNow: string | null = null;

export function noteRailRoot(root: string | null): void {
  railRootNow = root;
}

export function railRoot(): string | null {
  return railRootNow;
}

// Whether the file sits under the folder, compared as normalizePath writes
// both, case-blind, at a separator (so C:\a never holds C:\ab\x.html).
function under(file: string, folder: string): boolean {
  const f = normalizePath(file).toLowerCase();
  const d = normalizePath(folder).toLowerCase();
  const prefix = d.endsWith('\\') ? d : d + '\\';
  return f.startsWith(prefix);
}

// The folder a page is served from: the rail's root when the file is
// under it, so its links and styles a level up resolve, else the file's
// own folder.
export function localPageRoot(file: string, root: string | null): string {
  if (root !== null && root !== '' && under(file, root)) return normalizePath(root);
  return parentPath(file);
}

// Where a browser pane's page is, for its title and its cwd line: a page
// from the disk its file's absolute path, a web page its URL.
export function pageWhere(view: BrowserPaneView): string {
  const local = localPageOf(view.url);
  if (local === null || view.root === undefined) return view.url;
  return local.rel === '' ? normalizePath(view.root) : joinPath(view.root, local.rel.split('/').join('\\'));
}

// The browser view for a file served from a root: the root id of any
// browser view across every tab already on the same folder (case-blind),
// so two pages of one folder share one origin and its storage, else a
// fresh one.
export function localPageView(layout: Layout | null, root: string, file: string, newId: IdGenerator = randomId): BrowserPaneView {
  const folder = normalizePath(root);
  let id: string | null = null;
  if (layout !== null) {
    for (const pane of allPanes(layout)) {
      const view = pane.view;
      if (view?.kind !== 'browser' || view.root === undefined) continue;
      if (normalizePath(view.root).toLowerCase() !== folder.toLowerCase()) continue;
      const at = localPageOf(view.url);
      if (at !== null) {
        id = at.rootId;
        break;
      }
    }
  }
  const full = normalizePath(file);
  const prefix = folder.endsWith('\\') ? folder : folder + '\\';
  const rel = full.slice(prefix.length).split('\\').join('/');
  return { kind: 'browser', url: localPageUrl(id ?? newId(), rel), root: folder };
}
