import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from './git-status.ts';
import { gitText, type GitOptions } from './git-runner.ts';

// The icon a sidebar folder heading draws in place of the folder outline
// (M9 fix 65): the project's favicon, found the way a browser or a site
// generator would leave it, or null when there is none. A folder inside a
// repository that has none of its own takes its repository root's, so a
// session grouped under a subfolder still gets the project's icon. The
// answer is cached per folder, re-read after a minute (M9 fix 521), and
// forgotten at once when the rail's watcher sees a change at that folder
// or above it. A folder in a repository with no icon at either takes the best
// match of one git ls-files over the whole repository (M9 fix 1121, GitHub
// zacharykeeton/emerald#1), kept ten minutes.

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

// A search answer is kept this long (M9 fix 1121): a heading re-asks every minute, and a project with no icon would otherwise spawn a git a minute. The fixed places are still read every minute, so an icon added at one shows within the minute; the watcher's forget drops both at once.
export const FOLDER_ICON_SEARCH_TTL_MS = 10 * 60_000;

type Kept = { file: string | null; at: number };
const cache = new Map<string, Kept>();
const searchCache = new Map<string, Kept>();

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
// means by it. A site-root href also tries public beside the html, where
// Vite keeps what it serves at the root (M9 fix 1121).
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
  const bare = clean.replace(/^\/+/, '');
  const candidates = [path.resolve(htmlDir, bare)];
  if (clean.startsWith('/')) candidates.push(path.resolve(htmlDir, 'public', bare));
  for (const file of candidates) {
    // Nothing outside the html's folder (M9 fix 482): a backslash spelling
    // (\\host\share, /\\host, \/host) resolves to a UNC path, and a stat of
    // that connects to the host with the person's credentials, so it is
    // refused before any stat; ../ reads nothing above the html either.
    const rel = path.relative(htmlDir, file);
    if (file.startsWith('\\\\') || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (await isFile(file)) return file;
  }
  return null;
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

// The repository search (M9 fix 1121, GitHub zacharykeeton/emerald#1): every tracked or untracked, not ignored, favicon or icon file at any depth. icon is exact, so icon-close.svg is no match; icase takes Favicon.ICO. Never --literal-pathspecs, which would read the magic as a file name.
export const ICON_SEARCH_ARGS = [
  '--no-optional-locks', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
  ':(glob,icase)**/favicon*.ico', ':(glob,icase)**/favicon*.png', ':(glob,icase)**/favicon*.svg',
  ':(glob,icase)**/icon.ico', ':(glob,icase)**/icon.png', ':(glob,icase)**/icon.svg',
];
// A bound on the lstats one search spends; a repository with more icons than this takes the best of the first twenty.
const SEARCH_TRIES = 20;
const AVOID_DIRS = new Set(['test', 'tests', '__tests__', 'fixture', 'fixtures', '__fixtures__', 'mock', 'mocks', '__mocks__', 'example', 'examples', 'demo', 'demos', 'doc', 'docs', 'vendor', 'vendored']);
const EXT_ORDER = ['.ico', '.png', '.svg'];

// The matches best first. folderRel is the asking folder relative to the
// root, with / and lower case, '' for the root. Each key is compared only
// when every earlier one ties.
export function rankIconMatches(paths: readonly string[], folderRel: string): string[] {
  const info = (p: string) => {
    const segs = p.toLowerCase().split('/');
    const name = segs[segs.length - 1]!;
    return {
      p,
      avoid: segs.slice(0, -1).some((d) => AVOID_DIRS.has(d)),
      outside: !(folderRel === '' || p.toLowerCase().startsWith(folderRel + '/')),
      icon: !name.startsWith('favicon'),
      depth: segs.length,
      ext: EXT_ORDER.indexOf(path.posix.extname(name)),
    };
  };
  return paths
    .map(info)
    .sort(
      (a, b) =>
        Number(a.avoid) - Number(b.avoid) ||
        Number(a.outside) - Number(b.outside) ||
        Number(a.icon) - Number(b.icon) ||
        a.depth - b.depth ||
        a.ext - b.ext ||
        (a.p < b.p ? -1 : a.p > b.p ? 1 : 0),
    )
    .map((x) => x.p);
}

// A path is taken when no segment of it is a link: git lists files through
// a directory junction, and following a tracked link could reach the UNC
// path linkedIcon refuses (fix 482), so lstat each prefix, never stat.
async function noLinkOnPath(root: string, segments: string[]): Promise<boolean> {
  for (let i = 1; i <= segments.length; i++) {
    try {
      const st = await fs.promises.lstat(path.join(root, ...segments.slice(0, i)));
      if (st.isSymbolicLink()) return false;
      if (i === segments.length && !st.isFile()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function searchRepoIcon(
  root: string,
  folder: string,
  git: (args: string[], cwd: string, opts?: GitOptions) => Promise<string | null> = gitText,
): Promise<string | null> {
  const out = await git(ICON_SEARCH_ARGS, root);
  if (out === null) return null;
  const paths = [...new Set(out.split('\0').filter((p) => p !== ''))];
  const folderRel = path.relative(root, folder).split(path.sep).join('/').toLowerCase();
  for (const rel of rankIconMatches(paths, folderRel).slice(0, SEARCH_TRIES)) {
    const segments = rel.split('/');
    if (await noLinkOnPath(root, segments)) return path.join(root, ...segments);
  }
  return null;
}

// The fixed-list answer for a folder: its own, then its repository root's.
async function fixedIcon(folder: string, root: string | null): Promise<string | null> {
  const own = await iconIn(folder);
  if (own !== null) return own;
  if (root === null || key(root) === key(folder)) return null;
  return iconIn(root);
}

// The icon's absolute path for a folder, its repository root's when the
// folder has none, then the repository search, or null. Uncached;
// folderIcon is the cached form.
export async function findFolderIcon(folder: string, git = gitText): Promise<string | null> {
  const root = findRepoRoot(folder);
  const fixed = await fixedIcon(folder, root);
  if (fixed !== null || root === null) return fixed;
  return searchRepoIcon(root, folder, git);
}

export async function folderIcon(folder: string, now = Date.now(), git = gitText): Promise<string | null> {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) return null;
  const k = key(folder);
  const dir = path.normalize(folder);
  const root = findRepoRoot(dir);
  let fixed = cache.get(k);
  if (fixed === undefined || now - fixed.at >= FOLDER_ICON_TTL_MS) {
    fixed = { file: await fixedIcon(dir, root), at: now };
    cache.set(k, fixed);
  }
  let file = fixed.file;
  if (file === null && root !== null) {
    let searched = searchCache.get(k);
    if (searched === undefined || now - searched.at >= FOLDER_ICON_SEARCH_TTL_MS) {
      searched = { file: await searchRepoIcon(root, dir, git), at: now };
      searchCache.set(k, searched);
    }
    file = searched.file;
  }
  return file === null ? null : fileUrl(file);
}

// A change at dir: its own answer and every cached folder under it go,
// since a subfolder's icon may have been read from dir as its root.
export function folderIconForget(dir: string): void {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return;
  const k = key(dir);
  for (const map of [cache, searchCache]) {
    for (const cached of [...map.keys()]) {
      if (cached === k || cached.startsWith(k + path.sep)) map.delete(cached);
    }
  }
}

// For the tests.
export function folderIconCacheSize(): number {
  return cache.size;
}
