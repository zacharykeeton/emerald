// M9 fix 659: what the browser pane takes as an address. No node here:
// URL is a global in the renderer and in node alike.

// The one partition a <webview> may attach on; the main process refuses
// any other (browser-guard.ts).
export const BROWSER_PARTITION = 'persist:emerald-browser';

// host:port with an optional path, query or fragment. The host is two
// characters or more, so `c:3000` is a drive and never a page, and a
// Windows file name cannot hold a colon, so `localhost:3000` is never a
// file.
const HOST_PORT = /^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]:(\d{1,5})(?:[/?#]\S*)?$/;
const SCHEME = /^https?:\/\//i;

// Whether text reads as an address rather than a path: a CLI positional
// that does is taken as a page, one that does not as a file.
export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  return SCHEME.test(t) || HOST_PORT.test(t);
}

// The URL the pane loads for what was typed, or null. No search engine
// and no bare host: an http or https URL is taken whole, host:port gets
// http:// put before it, and anything else is refused. Every answer
// gives itself back, which is what the layout validator reads.
export function browserUrl(text: string): string | null {
  const t = text.trim();
  if (t === '') return null;
  let candidate: string;
  if (SCHEME.test(t)) {
    candidate = t;
  } else {
    const m = HOST_PORT.exec(t);
    if (m === null) return null;
    const port = Number(m[1]);
    if (port < 1 || port > 65535) return null;
    candidate = `http://${t}`;
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === '') return null;
  return url.href;
}

// Where a link in the page may take it: the web, nothing else (a file:
// or javascript: link is refused). Main's guard and the pane's error line
// (M9 fix 668) read the one rule.
// M9 fix 896: from is the URL of the page navigating. A page from the disk (emerald-file:) is reached only from a page of the same folder, so a web page can never link into the disk; any page may link out to the web.
export function guestNavigationAllowed(url: string, from = ''): boolean {
  const local = localPageOf(url);
  if (local === null) return SCHEME.test(url);
  const at = localPageOf(from);
  return at !== null && at.rootId === local.rootId;
}

// M9 fix 896: a page from the disk, served by main (local-page.ts) from a folder the person opened, never by file:. The host is the root's id, a random UUID the renderer mints and the pane's record keeps beside the folder (BrowserPaneView.root); the path is the file's, relative to that folder, each segment percent-encoded.
export const LOCAL_PAGE_SCHEME = 'emerald-file';

// Lowercase, as randomId writes it: Chromium lowercases a standard
// scheme's host and node keeps it as given, so a mixed-case host is
// refused rather than read two ways.
const ROOT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// What no Windows file name segment holds.
const BAD_SEGMENT = /[\\:/\0]/;

export function localPageUrl(rootId: string, rel: string): string {
  const segments = rel.split(/[\\/]/).filter((s) => s !== '');
  return `${LOCAL_PAGE_SCHEME}://${rootId}/${segments.map((s) => encodeURIComponent(s)).join('/')}`;
}

// The root id and the decoded path of a page from the disk, or null for
// anything else, including a path with a dot segment, an empty segment or
// a character no Windows file name holds.
export function localPageOf(url: string): { rootId: string; rel: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== `${LOCAL_PAGE_SCHEME}:`) return null;
  if (!ROOT_ID.test(u.host)) return null;
  // node gives '' for emerald-file://<id> where Chromium gives '/', so a
  // URL with no path is refused rather than read two ways.
  if (!u.pathname.startsWith('/')) return null;
  const raw = u.pathname.slice(1).split('/');
  if (raw[raw.length - 1] === '') raw.pop();
  const segments: string[] = [];
  for (const r of raw) {
    let d: string;
    try {
      d = decodeURIComponent(r);
    } catch {
      return null;
    }
    if (d === '' || d === '.' || d === '..' || BAD_SEGMENT.test(d)) return null;
    segments.push(d);
  }
  return { rootId: u.host, rel: segments.join('/') };
}

export function isLocalPageUrl(url: string): boolean {
  return localPageOf(url) !== null;
}

// M9 fix 931: whether a load keeps the page's own zoom: the same scheme
// and host, a port included, so a reload and a link within a site keep it
// and another site opens at the window's zoom. A page from the disk's host
// is its root's id, so its folder is its site.
export function zoomKeptAcross(from: string, to: string): boolean {
  let a: URL;
  let b: URL;
  try {
    a = new URL(from);
    b = new URL(to);
  } catch {
    return false;
  }
  // Not origin, which is the string null for emerald-file: in node.
  return a.protocol === b.protocol && a.host === b.host;
}

// What a browser pane's record may hold: whatever browserUrl takes, or a
// page from the disk whole. Every answer gives itself back, which is what
// the layout validator and the attach guard read.
export function paneUrl(text: string): string | null {
  const web = browserUrl(text);
  if (web !== null) return web;
  const t = text.trim();
  let href: string;
  try {
    href = new URL(t).href;
  } catch {
    return null;
  }
  return href === t && localPageOf(href) !== null ? href : null;
}

// M9 fix 667: the address bar's lax reading. The strict browserUrl above
// stays what `emmer open`, the layout validator, the daemon and the attach
// guard read; only the bar takes a bare host or a search. The engine is a
// constant here, never a setting.
export const SEARCH_URL = 'https://duckduckgo.com/?q=';

const BARE_HOST = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:[/?#]\S*)?$/;
const BARE_LOCALHOST = /^localhost(?:[/?#]\S*)?$/i;
// A first word with a colon or a backslash is a scheme or a drive
// (javascript:, file:, mailto:, c:3000, C:\notes.md), never a search.
const SCHEMEISH = /^\S*[:\\]/;

// What the address bar loads for what was typed, or null. Whatever
// browserUrl takes is its answer (localhost:3000 stays http://); a host
// with a dot is https://, a bare localhost http://; a scheme or a drive is
// refused; a space or one word with no dot goes to the search engine.
// Every answer goes through browserUrl, so it gives itself back.
export function addressUrl(text: string): string | null {
  const t = text.trim();
  if (t === '') return null;
  const strict = browserUrl(t);
  if (strict !== null) return strict;
  if (BARE_HOST.test(t)) return browserUrl('https://' + t);
  if (BARE_LOCALHOST.test(t)) return browserUrl('http://' + t);
  if (SCHEMEISH.test(t)) return null;
  return browserUrl(SEARCH_URL + encodeURIComponent(t));
}

// The address without its scheme and without a lone trailing slash, for
// the bar while it lacks the focus: http://127.0.0.1:5173/ reads
// 127.0.0.1:5173, https://docs.github.com/x reads docs.github.com/x.
// M9 fix 897: a page from the disk reads as its path under the folder
// (site/page.html), never its root id.
export function addressShown(href: string): string {
  const local = localPageOf(href);
  if (local !== null) return local.rel;
  const bare = href.replace(/^https?:\/\//i, '');
  const slash = bare.indexOf('/');
  return slash >= 0 && slash === bare.length - 1 ? bare.slice(0, -1) : bare;
}

// M9 fix 897: what a page is called where it has no title yet: a page
// from the disk its file's name, a web page its host.
export function pageLabel(url: string): string {
  const local = localPageOf(url);
  if (local !== null) return local.rel.split('/').pop() || local.rel;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
