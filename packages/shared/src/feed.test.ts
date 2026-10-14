import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedUrl, isNewerVersion, parseLatestYml } from './feed.ts';

// The shape electron-builder 26 writes for one NSIS target.
const SAMPLE = [
  'version: 0.1.240',
  'files:',
  '  - url: Emerald-setup-0.1.240-arm64.exe',
  '    sha512: AbC+/dEf==',
  '    size: 111222333',
  'path: Emerald-setup-0.1.240-arm64.exe',
  'sha512: AbC+/dEf==',
  "releaseDate: '2026-09-17T01:02:03.000Z'",
  '',
].join('\n');

test('parseLatestYml reads the version, the installer, its hash, its size and the date', () => {
  assert.deepEqual(parseLatestYml(SAMPLE), {
    version: '0.1.240',
    path: 'Emerald-setup-0.1.240-arm64.exe',
    sha512: 'AbC+/dEf==',
    size: 111222333,
    releaseDate: '2026-09-17T01:02:03.000Z',
  });
});

test('parseLatestYml takes CRLF and a manifest with no files list', () => {
  const m = parseLatestYml('version: 1.2.3\r\npath: a.exe\r\nsha512: xyz\r\n');
  assert.equal(m.version, '1.2.3');
  assert.equal(m.size, null);
  assert.equal(m.releaseDate, null);
});

test('parseLatestYml refuses a manifest missing the installer', () => {
  assert.throws(() => parseLatestYml('version: 1.2.3\n'), /no version, path or sha512/);
  assert.throws(() => parseLatestYml(''), /no version, path or sha512/);
});

test('isNewerVersion compares the parts as numbers', () => {
  assert.equal(isNewerVersion('0.1.240', '0.1.228'), true);
  assert.equal(isNewerVersion('0.1.228', '0.1.228'), false);
  assert.equal(isNewerVersion('0.1.228', '0.1.240'), false);
  // 0.1.1000 is a later batch than 0.1.999, not an earlier string.
  assert.equal(isNewerVersion('0.1.1000', '0.1.999'), true);
  assert.equal(isNewerVersion('0.2', '0.1.999'), true);
  assert.equal(isNewerVersion('0.1.240-beta', '0.1.228'), true);
  assert.equal(isNewerVersion('later', '0.1.228'), false);
});

test('feedUrl is the local feed on the shared port by default', () => {
  assert.equal(feedUrl(), 'http://127.0.0.1:7420/');
  assert.equal(feedUrl(0), 'http://127.0.0.1:0/');
  assert.equal(feedUrl(8080, '10.10.10.2'), 'http://10.10.10.2:8080/');
});
