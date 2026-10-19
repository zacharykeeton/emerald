import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachRefusal, chromeUserAgent, forceGuestPreferences, guestNavigationAllowed, signInBounds, signInPopup } from './browser-guard.ts';

test('a webview attaches on the main window, our partition and a page src alone (M9 fix 659)', () => {
  const ours = 'persist:emerald-browser';
  assert.equal(attachRefusal({ partition: ours, src: 'http://127.0.0.1:5173/', fromMain: true }), null);
  assert.equal(attachRefusal({ partition: ours, src: '', fromMain: true }), null);
  assert.equal(attachRefusal({ partition: ours, src: undefined, fromMain: true }), null);
  assert.equal(attachRefusal({ partition: ours, src: 'about:blank', fromMain: true }), null);
  assert.equal(attachRefusal({ partition: ours, src: 'http://x.com/', fromMain: false }), 'not the main window');
  // M9 fix 673: a profile's partition attaches too, and the refusal's old
  // words are the new words' prefix.
  const tail = "; only persist:emerald-browser attaches, or a profile's persist:emerald-browser-<name>";
  assert.equal(attachRefusal({ partition: 'persist:other', src: 'http://x.com/', fromMain: true }), `partition persist:other${tail}`);
  assert.equal(attachRefusal({ partition: undefined, src: 'http://x.com/', fromMain: true }), `partition (none)${tail}`);
  assert.equal(attachRefusal({ partition: '', src: 'http://x.com/', fromMain: true }), `partition (none)${tail}`);
  assert.ok(attachRefusal({ partition: 'persist:other', src: '', fromMain: true })!.includes('partition persist:other; only persist:emerald-browser attaches'));
  assert.equal(attachRefusal({ partition: 'persist:emerald-browser-b', src: '', fromMain: true }), null);
  for (const partition of ['persist:emerald-browser-B', 'persist:emerald-browser-', 'persist:emerald-browserx']) {
    assert.equal(attachRefusal({ partition, src: '', fromMain: true }), `partition ${partition}${tail}`);
  }
  assert.equal(attachRefusal({ partition: ours, src: 'file:///C:/Windows/win.ini', fromMain: true }), 'src file:///C:/Windows/win.ini');
  assert.equal(attachRefusal({ partition: ours, src: 'localhost:3000', fromMain: true }), 'src localhost:3000');
  // M9 fix 896: a page from the disk attaches; a malformed one does not.
  assert.equal(attachRefusal({ partition: ours, src: 'emerald-file://0f1e2d3c-4b5a-4968-8776-655443322110/site/page.html', fromMain: true }), null);
  assert.equal(attachRefusal({ partition: ours, src: 'emerald-file://notauuid/x', fromMain: true }), 'src emerald-file://notauuid/x');
});

test('a guest runs with no node, no preload and no webview of its own (M9 fix 659)', () => {
  const prefs: Record<string, unknown> = { preload: 'C:\\evil.js', enableBlinkFeatures: 'X', nodeIntegration: true, contextIsolation: false, sandbox: false, webviewTag: true, webSecurity: false };
  forceGuestPreferences(prefs);
  assert.deepEqual(prefs, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
    webSecurity: true,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
  });
});

test('a guest navigates on the web alone (M9 fix 659)', () => {
  assert.equal(guestNavigationAllowed('http://127.0.0.1:3000/two'), true);
  assert.equal(guestNavigationAllowed('HTTPS://example.com/'), true);
  assert.equal(guestNavigationAllowed('file:///C:/Windows/win.ini'), false);
  assert.equal(guestNavigationAllowed('javascript:alert(1)'), false);
  assert.equal(guestNavigationAllowed('data:text/html,hi'), false);
});

test('a popup opens in emerald only to a sign-in host, over https, on its default port (M9 fix 894)', () => {
  for (const url of [
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
    'https://appleid.apple.com/auth/authorize',
    'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    'https://login.live.com/oauth20_authorize.srf',
    'https://github.com/login',
    'https://github.com/login/oauth/authorize?client_id=x',
  ]) assert.equal(signInPopup(url), true, url);
  for (const url of [
    'http://accounts.google.com/',
    'https://accounts.google.com.evil.example/',
    'https://evil.example/accounts.google.com',
    'https://mail.google.com/',
    'https://accounts.google.com:8443/',
    'https://user@accounts.google.com/',
    'https://github.com/loginx',
    'https://github.com/settings',
    'https://claude.ai/login',
    'about:blank',
    '',
    'not a url',
  ]) assert.equal(signInPopup(url), false, url);
});

test('the test prefix counts as a sign-in host and nothing else does (M9 fix 894)', () => {
  const prefix = 'http://127.0.0.1:5000/signin';
  assert.equal(signInPopup('http://127.0.0.1:5000/signin', prefix), true);
  assert.equal(signInPopup('http://127.0.0.1:5000/signin?x=1', prefix), true);
  assert.equal(signInPopup('http://127.0.0.1:5000/popup', prefix), false);
  assert.equal(signInPopup('http://127.0.0.1:5000/signin', null), false);
  assert.equal(signInPopup('http://127.0.0.1:5000/signin', ''), false);
});

test('the sign-in window is 500 by 650 centred on its parent (M9 fix 894)', () => {
  assert.deepEqual(signInBounds({ x: 100, y: 50, width: 1200, height: 800 }), { x: 450, y: 125, width: 500, height: 650 });
  assert.equal(signInBounds({ x: 5000, y: 50, width: 1200, height: 800 }).x, 5350);
});

test('the browser agent is Chrome\'s frozen form with the Electron and app tokens gone (M9 fix 895)', () => {
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
  assert.equal(chromeUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Emerald/0.1.859 Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36'), chrome);
  assert.equal(chromeUserAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) @emerald/app/0.1.859 Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36'), chrome);
  assert.equal(chromeUserAgent(chrome), chrome);
  assert.equal(chromeUserAgent('curl/8.0'), 'curl/8.0');
});
