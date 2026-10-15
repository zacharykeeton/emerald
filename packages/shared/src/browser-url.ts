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
export function guestNavigationAllowed(url: string): boolean {
  return SCHEME.test(url);
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
export function addressShown(href: string): string {
  const bare = href.replace(/^https?:\/\//i, '');
  const slash = bare.indexOf('/');
  return slash >= 0 && slash === bare.length - 1 ? bare.slice(0, -1) : bare;
}
