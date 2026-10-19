import { BROWSER_PARTITION, isBrowserPartition, paneUrl } from '@emerald/shared';

// The browser pane's hosting rules (M9 fix 659), pure so node:test
// reaches them; index.ts wires them to the web contents. Fix 477 refused
// every <webview>; this narrows it to the one the browser pane makes.

// Why a <webview> may not attach, or null when it may: only on the main
// window, only on the browser pane's own partition, and only with an
// empty src or a page browserUrl would write. A renderer that put a
// webview of its own choosing on the page (an injected script, a page
// that got the app's origin) is refused here. M9 fix 896: or an
// emerald-file: page (paneUrl).
export function attachRefusal(o: { partition: string | undefined; src: string | undefined; fromMain: boolean }): string | null {
  if (!o.fromMain) return 'not the main window';
  // M9 fix 673: or a profile's own; the old words stay the prefix, which
  // verify-m9-browser.mjs reads with includes.
  if (!isBrowserPartition(o.partition)) return `partition ${o.partition || '(none)'}; only ${BROWSER_PARTITION} attaches, or a profile's ${BROWSER_PARTITION}-<name>`;
  const src = o.src ?? '';
  if (src !== '' && src !== 'about:blank' && paneUrl(src) !== src) return `src ${src}`;
  return null;
}

// M9 fix 894: the sign-in hosts whose popups open in emerald, in the pane's session, so a sign-in in the page lands in the pane; every other popup goes to the system browser (fix 477).
export const SIGN_IN_HOSTS = ['accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com', 'login.live.com'] as const;

// Whether a popup's URL is a sign-in host's: https on its default port,
// no credentials in the URL, the host exactly on the list (a suffix or a
// path naming one does not count), or GitHub's own /login. The test
// prefix is verify:browser's fixture, set only under a private home.
export function signInPopup(url: string, testPrefix: string | null = null): boolean {
  if (typeof testPrefix === 'string' && testPrefix !== '' && url.startsWith(testPrefix)) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return false;
  if ((SIGN_IN_HOSTS as readonly string[]).includes(u.hostname)) return true;
  return u.hostname === 'github.com' && (u.pathname === '/login' || u.pathname.startsWith('/login/'));
}

export const SIGN_IN_WIDTH = 500;
export const SIGN_IN_HEIGHT = 650;

// The sign-in window's box, centred on the window holding the page rather
// than the pane, since main does not know the pane's rect without a round
// trip to the renderer.
export function signInBounds(parent: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(parent.x + (parent.width - SIGN_IN_WIDTH) / 2),
    y: Math.round(parent.y + (parent.height - SIGN_IN_HEIGHT) / 2),
    width: SIGN_IN_WIDTH,
    height: SIGN_IN_HEIGHT,
  };
}

// M9 fix 895: the agent a browser pane sends is Chrome's own frozen form, so a sign-in host that refuses an embedded browser by its Electron or app token reads Chrome; the Chrome major is kept, its minor zeroed as Chrome sends it.
export function chromeUserAgent(ua: string): string {
  const m = / Chrome\/(\d+)\./.exec(ua);
  if (m === null) return ua;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${m[1]}.0.0.0 Safari/537.36`;
}

// What a guest page runs with, whatever the attribute asked for: no
// node, no preload, no webview of its own, isolated and sandboxed.
export function forceGuestPreferences(prefs: Record<string, unknown>): void {
  delete prefs['preload'];
  delete prefs['enableBlinkFeatures'];
  prefs['nodeIntegration'] = false;
  prefs['nodeIntegrationInSubFrames'] = false;
  prefs['nodeIntegrationInWorker'] = false;
  prefs['webviewTag'] = false;
  prefs['allowRunningInsecureContent'] = false;
  prefs['experimentalFeatures'] = false;
  prefs['contextIsolation'] = true;
  prefs['sandbox'] = true;
  prefs['webSecurity'] = true;
}

// Where a link in the page may take it: the web, nothing else (a file:
// or javascript: link is refused). It lives in @emerald/shared (M9 fix
// 668) so the pane can say on its error line what the guard refused;
// index.ts and the tests keep importing it from here.
export { guestNavigationAllowed } from '@emerald/shared';
