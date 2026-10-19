import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressShown, addressUrl, BROWSER_PARTITION, browserUrl, guestNavigationAllowed, isLocalPageUrl, localPageOf, localPageUrl, looksLikeUrl, pageLabel, paneUrl, SEARCH_URL } from './browser-url.ts';

test("a page from the disk shows as its path in the bar and its file's name as its label; a web page its host (M9 fix 897)", () => {
  const local = 'emerald-file://0f1e2d3c-4b5a-4968-8776-655443322110/site/my%20page.html';
  assert.equal(addressShown(local), 'site/my page.html');
  assert.equal(pageLabel(local), 'my page.html');
  assert.equal(pageLabel('http://localhost:3000/x'), 'localhost:3000');
});

const ID_A = '0f1e2d3c-4b5a-4968-8776-655443322110';
const ID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('localPageUrl and localPageOf round trip a path with a space, a hash, a percent and a non-ASCII name, and refuse a bad host, a dot segment, a backslash, a colon, an empty segment and no path (M9 fix 896)', () => {
  for (const rel of ['page.html', 'site/my page.html', 'a#b/c%d.html', 'café/naïve.html', '']) {
    const url = localPageUrl(ID_A, rel);
    assert.deepEqual(localPageOf(url), { rootId: ID_A, rel }, url);
    assert.equal(isLocalPageUrl(url), true, url);
  }
  // Backslashes in the path given are separators, as on Windows.
  assert.equal(localPageUrl(ID_A, 'site\\page.html'), `emerald-file://${ID_A}/site/page.html`);
  assert.equal(localPageOf(`emerald-file://${ID_A.toUpperCase()}/x.html`), null);
  assert.equal(localPageOf('emerald-file://notauuid/x.html'), null);
  assert.equal(localPageOf(`emerald-file://${ID_A}/a/%2e%2e/b`)?.rel.split('/').includes('..') ?? false, false);
  assert.equal(localPageOf(`emerald-file://${ID_A}/a/..%5Cb`), null);
  assert.equal(localPageOf(`emerald-file://${ID_A}/a%5Cb`), null);
  assert.equal(localPageOf(`emerald-file://${ID_A}/C%3A/x`), null);
  assert.equal(localPageOf(`emerald-file://${ID_A}/a//b`), null);
  assert.equal(localPageOf(`emerald-file://${ID_A}/a%00b`), null);
  assert.equal(localPageOf(`emerald-file://${ID_A}/a%E0%A4%A`), null);
  assert.equal(localPageOf(`emerald-file://${ID_A}`), null);
  assert.equal(localPageOf(`https://example.com/x`), null);
  assert.equal(localPageOf('not a url'), null);
  assert.deepEqual(localPageOf(`emerald-file://${ID_A}/site/`), { rootId: ID_A, rel: 'site' });
});

test('paneUrl takes what browserUrl takes and a local page whole, and every answer gives itself back (M9 fix 896)', () => {
  for (const text of ['https://example.com/', 'localhost:3000', localPageUrl(ID_A, 'site/my page.html'), localPageUrl(ID_A, '')]) {
    const once = paneUrl(text);
    assert.notEqual(once, null, text);
    assert.equal(paneUrl(once!), once, text);
  }
  assert.equal(paneUrl(localPageUrl(ID_A, 'p.html')), localPageUrl(ID_A, 'p.html'));
  assert.equal(paneUrl(`emerald-file://${ID_A}`), null);
  assert.equal(paneUrl('file:///C:/x'), null);
  assert.equal(paneUrl('emerald-file://notauuid/x'), null);
  assert.equal(paneUrl(''), null);
  assert.equal(paneUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(browserUrl(localPageUrl(ID_A, 'p.html')), null);
});

test('a page from the disk is reached only from a page of the same folder; any page links out to the web (M9 fix 896)', () => {
  const localA1 = localPageUrl(ID_A, 'one.html');
  const localA2 = localPageUrl(ID_A, 'sub/two.html');
  const localB = localPageUrl(ID_B, 'one.html');
  assert.equal(guestNavigationAllowed(localA1, 'http://x/'), false);
  assert.equal(guestNavigationAllowed(localA1, ''), false);
  assert.equal(guestNavigationAllowed(localA1), false);
  assert.equal(guestNavigationAllowed(localA2, localA1), true);
  assert.equal(guestNavigationAllowed(localB, localA1), false);
  assert.equal(guestNavigationAllowed('https://example.com/', localA1), true);
  assert.equal(guestNavigationAllowed('file:///C:/x', localA1), false);
});

test('browserUrl takes an http or https URL whole and host:port with http put before it (M9 fix 659)', () => {
  assert.equal(BROWSER_PARTITION, 'persist:emerald-browser');
  assert.equal(browserUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(browserUrl('127.0.0.1:5173/app'), 'http://127.0.0.1:5173/app');
  assert.equal(browserUrl('HTTP://X.com'), 'http://x.com/');
  assert.equal(browserUrl('localhost:3000?q=1'), 'http://localhost:3000/?q=1');
  assert.equal(browserUrl('  https://example.com/a  '), 'https://example.com/a');
});

// The address bar's lax reading is addressUrl's (fix 667); these refusals
// are the strict one, which `emmer open`, the validator and the guard keep.
test('browserUrl refuses a bare host, another scheme, a drive and a bad port (M9 fix 659)', () => {
  for (const text of ['', '   ', 'example.com', 'localhost', 'file:///C:/x', 'javascript:alert(1)', 'c:3000', 'localhost:0', 'localhost:70000', 'foo bar:3000', 'http://', 'https://a b.com', 'C:\\notes.md']) {
    assert.equal(browserUrl(text), null, text);
  }
});

test('every answer of browserUrl gives itself back, which the layout validator reads (M9 fix 659)', () => {
  for (const text of ['localhost:3000', '127.0.0.1:5173/app', 'HTTP://X.com', 'localhost:3000?q=1', 'https://example.com/a b?c=d#e']) {
    const once = browserUrl(text);
    assert.notEqual(once, null, text);
    assert.equal(browserUrl(once!), once, text);
  }
});

test('looksLikeUrl tells an address from a path (M9 fix 659)', () => {
  assert.equal(looksLikeUrl('localhost:3000'), true);
  assert.equal(looksLikeUrl('https://a b'), true);
  assert.equal(looksLikeUrl('http://x.com'), true);
  assert.equal(looksLikeUrl('notes.md'), false);
  assert.equal(looksLikeUrl('C:\\notes.md'), false);
  assert.equal(looksLikeUrl('c:3000'), false);
  assert.equal(looksLikeUrl('example.com'), false);
});

test('addressUrl takes a bare host as https, localhost as http and words as a search (M9 fix 667)', () => {
  assert.equal(SEARCH_URL, 'https://duckduckgo.com/?q=');
  const answers: Array<[string, string]> = [
    ['google.com', 'https://google.com/'],
    ['docs.github.com/x', 'https://docs.github.com/x'],
    ['localhost', 'http://localhost/'],
    ['localhost:3000', 'http://localhost:3000/'],
    ['example.com:8080', 'http://example.com:8080/'],
    ['notes.md', 'https://notes.md/'],
    ['https://example.com/a', 'https://example.com/a'],
    ['emerald', 'https://duckduckgo.com/?q=emerald'],
    ['react hooks', 'https://duckduckgo.com/?q=react%20hooks'],
    ['foo bar:3000', 'https://duckduckgo.com/?q=foo%20bar%3A3000'],
    ["what's new", 'https://duckduckgo.com/?q=what%27s%20new'],
  ];
  for (const [text, want] of answers) assert.equal(addressUrl(text), want, text);
});

test('addressUrl refuses empty text, another scheme and a drive (M9 fix 667)', () => {
  for (const text of ['', '  ', 'javascript:alert(1)', 'file:///C:/x', 'mailto:x@y.z', 'c:3000', 'C:\\notes.md', 'https://a b.com']) {
    assert.equal(addressUrl(text), null, text);
  }
});

test('every answer of addressUrl gives itself back under browserUrl (M9 fix 667)', () => {
  for (const text of ['google.com', 'localhost', 'localhost:3000', 'notes.md', 'emerald', 'react hooks', "what's new", 'foo bar:3000']) {
    const once = addressUrl(text);
    assert.notEqual(once, null, text);
    assert.equal(browserUrl(once!), once, text);
  }
});

test('a guest navigates on the web alone, the rule main and the pane share (M9 fix 668)', () => {
  assert.equal(guestNavigationAllowed('http://127.0.0.1:3000/two'), true);
  assert.equal(guestNavigationAllowed('HTTPS://example.com/'), true);
  assert.equal(guestNavigationAllowed('file:///C:/Windows/win.ini'), false);
  assert.equal(guestNavigationAllowed('javascript:alert(1)'), false);
  assert.equal(guestNavigationAllowed('data:text/html,hi'), false);
});

test('addressShown drops the scheme and a lone trailing slash (M9 fix 667)', () => {
  assert.equal(addressShown('http://127.0.0.1:5173/'), '127.0.0.1:5173');
  assert.equal(addressShown('https://docs.github.com/x'), 'docs.github.com/x');
  assert.equal(addressShown('https://duckduckgo.com/?q=a'), 'duckduckgo.com/?q=a');
  assert.equal(addressShown('google.com'), 'google.com');
  assert.equal(addressShown(''), '');
});
