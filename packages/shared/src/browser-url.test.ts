import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_PARTITION, browserUrl, looksLikeUrl } from './browser-url.ts';

test('browserUrl takes an http or https URL whole and host:port with http put before it (M9 fix 659)', () => {
  assert.equal(BROWSER_PARTITION, 'persist:emerald-browser');
  assert.equal(browserUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(browserUrl('127.0.0.1:5173/app'), 'http://127.0.0.1:5173/app');
  assert.equal(browserUrl('HTTP://X.com'), 'http://x.com/');
  assert.equal(browserUrl('localhost:3000?q=1'), 'http://localhost:3000/?q=1');
  assert.equal(browserUrl('  https://example.com/a  '), 'https://example.com/a');
});

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
