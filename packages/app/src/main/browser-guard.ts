import { BROWSER_PARTITION, browserUrl } from '@emerald/shared';

// The browser pane's hosting rules (M9 fix 659), pure so node:test
// reaches them; index.ts wires them to the web contents. Fix 477 refused
// every <webview>; this narrows it to the one the browser pane makes.

// Why a <webview> may not attach, or null when it may: only on the main
// window, only on the browser pane's own partition, and only with an
// empty src or a page browserUrl would write. A renderer that put a
// webview of its own choosing on the page (an injected script, a page
// that got the app's origin) is refused here.
export function attachRefusal(o: { partition: string | undefined; src: string | undefined; fromMain: boolean }): string | null {
  if (!o.fromMain) return 'not the main window';
  if (o.partition !== BROWSER_PARTITION) return `partition ${o.partition || '(none)'}; only ${BROWSER_PARTITION} attaches`;
  const src = o.src ?? '';
  if (src !== '' && src !== 'about:blank' && browserUrl(src) !== src) return `src ${src}`;
  return null;
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
// or javascript: link is refused).
export function guestNavigationAllowed(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
