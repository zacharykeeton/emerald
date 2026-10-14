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
