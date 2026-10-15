import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachRefusal, forceGuestPreferences, guestNavigationAllowed } from './browser-guard.ts';

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
