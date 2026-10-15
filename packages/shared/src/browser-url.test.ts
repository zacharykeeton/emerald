import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressShown, addressUrl, BROWSER_PARTITION, browserUrl, guestNavigationAllowed, looksLikeUrl, SEARCH_URL } from './browser-url.ts';

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
