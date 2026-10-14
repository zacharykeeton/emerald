import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from './git-status.ts';

// The icon a sidebar folder heading draws in place of the folder outline
// (M9 fix 65): the project's favicon, found the way a browser or a site
// generator would leave it, or null when there is none. A folder inside a
// repository that has none of its own takes its repository root's, so a
// session grouped under a subfolder still gets the project's icon. The
// answer is cached per folder, re-read after a minute (M9 fix 521), and
// forgotten at once when the rail's watcher sees a change at that folder
// or above it.

// The file names tried, in order, at each place.
const NAMES = ['favicon.ico', 'favicon.png', 'favicon.svg'];
// The places tried, in order, relative to the folder; '' is the folder.
const PLACES = ['', 'public', 'static', 'assets', 'src', 'app', 'wwwroot'];
// After those, the one file an Electron app keeps its icon in.
const EXTRA = ['build/icon.png'];
// The html files read for a <link rel="icon">; only this much of each,
// since the link sits in the head and a huge file must not hold main.
const HTML = ['index.html', 'public/index.html'];
const HTML_CAP = 64 * 1024;
const LINK_TAG = /<link\b[^>]*>/gi;
const ATTR = /\b(rel|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

// An answer older than this is read again, so a favicon added to a folder
// the rail does not watch (most sidebar headings) still shows (M9 fix 521).
export const FOLDER_ICON_TTL_MS = 60_000;

const cache = new Map<string, { url: string | null; at: number }>();

function key(folder: string): string {
  return path.normalize(folder).replace(/[\\/]+$/, '').toLowerCase();
}

// A file: URL for an absolute Windows path, the form MarkdownView builds
// for an image beside a rendered file.
export function fileUrl(p: string): string {
  return `file:///${p.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(p)).isFile();
  } catch {
    return false;
  }
}

// The href of the first <link> whose rel names an icon, or null. A regex
// rather than a parser: the tag is one line in a head and nothing else
// in the file matters.
export function iconLinkHref(html: string): string | null {
  for (const tag of html.match(LINK_TAG) ?? []) {
    let rel: string | null = null;
    let href: string | null = null;
    for (const m of tag.matchAll(ATTR)) {
      const value = m[2] ?? m[3] ?? m[4] ?? '';
      if (m[1]!.toLowerCase() === 'rel') rel = value;
      else href = value;
    }
    if (rel === null || href === null) continue;
    if (!rel.toLowerCase().split(/\s+/).includes('icon')) continue;
    return href;
  }
  return null;
}

// The icon a <link> names, as an absolute path, or null when the href is
// not a file beside the html: a URL with a scheme (http, data) or a
// protocol-relative one is left alone, and a site-root href (/x) is read
// against the html's own folder, which is what a site served from there
// means by it.
async function linkedIcon(htmlPath: string): Promise<string | null> {
  let text: string;
  try {
    const fd = await fs.promises.open(htmlPath, 'r');
    try {
      const buf = Buffer.alloc(HTML_CAP);
      const { bytesRead } = await fd.read(buf, 0, HTML_CAP, 0);
      text = buf.toString('utf8', 0, bytesRead);
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
  const href = iconLinkHref(text);
  if (href === null || href === '' || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return null;
  const clean = href.split(/[?#]/, 1)[0]!;
  const htmlDir = path.dirname(htmlPath);
  const file = path.resolve(htmlDir, clean.replace(/^\/+/, ''));
  // Nothing outside the html's folder (M9 fix 482): a backslash spelling
  // (\\host\share, /\\host, \/host) resolves to a UNC path, and a stat of
  // that connects to the host with the person's credentials, so it is
  // refused before any stat; ../ reads nothing above the html either.
  const rel = path.relative(htmlDir, file);
  if (file.startsWith('\\\\') || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return (await isFile(file)) ? file : null;
}

// The icon file for one folder alone, no walk up: the usual places, then
// the html link.
async function iconIn(folder: string): Promise<string | null> {
  for (const place of PLACES) {
    for (const name of NAMES) {
      const file = path.join(folder, place, name);
      if (await isFile(file)) return file;
    }
  }
  for (const rel of EXTRA) {
    const file = path.join(folder, rel);
    if (await isFile(file)) return file;
  }
  for (const rel of HTML) {
    const found = await linkedIcon(path.join(folder, rel));
    if (found !== null) return found;
  }
  return null;
}

// The icon's absolute path for a folder, its repository root's when the
// folder has none, or null. Uncached; folderIcon is the cached form.
export async function findFolderIcon(folder: string): Promise<string | null> {
  const own = await iconIn(folder);
  if (own !== null) return own;
  const root = findRepoRoot(folder);
  if (root === null || key(root) === key(folder)) return null;
  return iconIn(root);
}

export async function folderIcon(folder: string, now = Date.now()): Promise<string | null> {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return null;
  const k = key(folder);
  const have = cache.get(k);
  if (have !== undefined && now - have.at < FOLDER_ICON_TTL_MS) return have.url;
  const file = await findFolderIcon(path.normalize(folder));
  const url = file === null ? null : fileUrl(file);
  cache.set(k, { url, at: now });
  return url;
}

// A change at dir: its own answer and every cached folder under it go,
// since a subfolder's icon may have been read from dir as its root.
export function folderIconForget(dir: string): void {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return;
  const k = key(dir);
  for (const cached of [...cache.keys()]) {
    if (cached === k || cached.startsWith(k + path.sep)) cache.delete(cached);
  }
}

// For the tests.
export function folderIconCacheSize(): number {
  return cache.size;
}
