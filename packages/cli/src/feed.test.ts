import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { publishFeed, serveFeed, sha512Base64 } from './feed.ts';

// M9 fix 406: this file used to kill its own process at exit. About one
// run in three (twelve in twenty measured here) it died on libuv's
// `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file
// src\win\async.c, line 94` with every subtest still ok, which
// tests.ps1 reads as a not ok beside # fail 0, so the cli suite could
// not say whether anything was wrong.
//
// It is not a handle this file leaks. Without --test-force-exit the file
// exits cleanly twenty times in twenty, and by 20 ms after the server is
// closed getActiveResourcesInfo() and _getActiveHandles() are both
// empty. What is left is undici's socket teardown, which is invisible to
// both, and --test-force-exit calls process.exit() on top of it.
//
// Measured on a reproducer of the serve test with process.exit(0) in
// place of the runner, twenty runs per row: one byte-range fetch crashed
// 20 of 20; the same range through node:http 0 of 20; the same range
// with connection: close 0 of 20; a whole-file fetch 0 of 20; no request
// at all 0 of 20. So it is the client's pooled socket after a 206, not
// the server. Delaying the exit: 20 of 20 at 50 ms, 4 of 20 at 100 ms,
// 0 of 20 at 200 ms and at 400 ms.
//
// M9 fix 433: the runner (.claude/skills/batch/tests.ps1) stopped passing
// --test-force-exit for shared, cli and app at 2d425b2, and the daemon is
// the only package that still needs it (node-pty's console-less exit).
// The half-second after() this comment used to justify was a wait on
// that flag's own exit race, so it went with the flag rather than
// staying as dead weight; package.json's own `test` script for cli never
// carried the flag either.

// A release folder the way `npm run dist` leaves it: the manifest, the
// installer it names and the installer's blockmap, plus a stale file.
function release(version: string, withBlockmap = true): string {
  const dir = mkTemp('emerald-feed-release-');
  const name = `Emerald-setup-${version}-arm64.exe`;
  fs.writeFileSync(path.join(dir, name), `installer ${version}`);
  if (withBlockmap) fs.writeFileSync(path.join(dir, `${name}.blockmap`), 'blocks');
  fs.writeFileSync(path.join(dir, 'builder-debug.yml'), 'not published');
  const sha512 = sha512Base64(path.join(dir, name));
  fs.writeFileSync(
    path.join(dir, 'latest.yml'),
    `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: 9\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-09-17T00:00:00.000Z'\n`,
  );
  return dir;
}

test.after(removeTemps);

const feedDir = () => path.join(mkTemp('emerald-feed-'), 'feed');

test('publish copies the three files into a feed folder it creates', () => {
  const feed = feedDir();
  const out = publishFeed(release('0.1.240'), feed);
  assert.equal(out.manifest.version, '0.1.240');
  assert.deepEqual([...out.files].sort(), ['latest.yml', 'Emerald-setup-0.1.240-arm64.exe', 'Emerald-setup-0.1.240-arm64.exe.blockmap'].sort());
  assert.deepEqual(out.missing, []);
  assert.deepEqual(fs.readdirSync(feed).sort(), ['latest.yml', 'Emerald-setup-0.1.240-arm64.exe', 'Emerald-setup-0.1.240-arm64.exe.blockmap'].sort());
  assert.equal(fs.readFileSync(path.join(feed, 'Emerald-setup-0.1.240-arm64.exe'), 'utf8'), 'installer 0.1.240');
});

test('a second publish replaces the manifest and keeps the older installer', () => {
  const feed = feedDir();
  publishFeed(release('0.1.228'), feed);
  const out = publishFeed(release('0.1.240', false), feed);
  assert.deepEqual(out.missing, ['Emerald-setup-0.1.240-arm64.exe.blockmap']);
  assert.match(fs.readFileSync(path.join(feed, 'latest.yml'), 'utf8'), /^version: 0\.1\.240$/m);
  assert.ok(fs.existsSync(path.join(feed, 'Emerald-setup-0.1.228-arm64.exe')));
  assert.ok(fs.existsSync(path.join(feed, 'Emerald-setup-0.1.240-arm64.exe')));
  // M9 fix 486: each file goes through a .tmp and a rename, none left.
  assert.deepEqual(fs.readdirSync(feed).filter((f) => f.endsWith('.tmp')), []);
});

test('publish refuses a release whose installer does not match its manifest, and one without a manifest', () => {
  const feed = feedDir();
  const dir = release('0.1.240');
  fs.appendFileSync(path.join(dir, 'Emerald-setup-0.1.240-arm64.exe'), ' tampered');
  assert.throws(() => publishFeed(dir, feed), /does not match the sha512/);
  assert.ok(!fs.existsSync(feed), 'nothing was written');
  assert.throws(() => publishFeed(mkTemp('emerald-feed-empty-'), feed), /latest\.yml is missing/);
});

test('serve answers the manifest, a whole file, a byte range and a 404, and nothing outside the folder', async () => {
  const feed = feedDir();
  publishFeed(release('0.1.240'), feed);
  const lines: string[] = [];
  const server = await serveFeed(feed, 0, (l) => lines.push(l));
  try {
    const manifest = await fetch(`${server.url}latest.yml`);
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get('content-type'), 'text/yaml');
    assert.match(await manifest.text(), /^version: 0\.1\.240$/m);

    const whole = await fetch(`${server.url}Emerald-setup-0.1.240-arm64.exe`);
    assert.equal(whole.status, 200);
    assert.equal(whole.headers.get('content-length'), '17');
    assert.equal(whole.headers.get('accept-ranges'), 'bytes');
    assert.equal(await whole.text(), 'installer 0.1.240');

    const part = await fetch(`${server.url}Emerald-setup-0.1.240-arm64.exe`, { headers: { range: 'bytes=10-14' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), 'bytes 10-14/17');
    assert.equal(await part.text(), '0.1.2');

    const tail = await fetch(`${server.url}Emerald-setup-0.1.240-arm64.exe`, { headers: { range: 'bytes=-3' } });
    assert.equal(tail.status, 206);
    assert.equal(await tail.text(), '240');

    const head = await fetch(`${server.url}Emerald-setup-0.1.240-arm64.exe`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '17');

    assert.equal((await fetch(`${server.url}nothing.exe`)).status, 404);
    assert.equal((await fetch(`${server.url}`)).status, 404);
    assert.equal((await fetch(`${server.url}..%2F..%2Fetc%2Fpasswd`)).status, 404);
    assert.equal((await fetch(`${server.url}Emerald-setup-0.1.240-arm64.exe`, { headers: { range: 'bytes=99-' } })).status, 416);
    assert.equal(lines[0], 'GET /latest.yml 200');
    assert.equal(lines[2], 'GET /Emerald-setup-0.1.240-arm64.exe 206 10-14');

    // M9 fix 259: several ranges in one request come back as
    // multipart/byteranges, the shape electron-updater's differential
    // download parses (no CRLF before the first boundary, one between
    // parts, the closing boundary at the end).
    const multi = await fetch(`${server.url}Emerald-setup-0.1.240-arm64.exe`, { headers: { range: 'bytes=0-4, 10-14' } });
    assert.equal(multi.status, 206);
    const ct = multi.headers.get('content-type') ?? '';
    const boundary = /^multipart\/byteranges; boundary=(\S+)$/.exec(ct)?.[1];
    assert.ok(boundary !== undefined, `content-type ${ct}`);
    const body = await multi.text();
    const CRLF = String.fromCharCode(13, 10);
    const expected =
      `--${boundary}${CRLF}content-type: application/octet-stream${CRLF}content-range: bytes 0-4/17${CRLF}${CRLF}insta` +
      `${CRLF}--${boundary}${CRLF}content-type: application/octet-stream${CRLF}content-range: bytes 10-14/17${CRLF}${CRLF}0.1.2` +
      `${CRLF}--${boundary}--${CRLF}`;
    assert.equal(body, expected);
    assert.equal(multi.headers.get('content-length'), String(Buffer.byteLength(expected)));
    assert.equal(lines[lines.length - 1], 'GET /Emerald-setup-0.1.240-arm64.exe 206 2 ranges');
    assert.equal((await fetch(`${server.url}Emerald-setup-0.1.240-arm64.exe`, { headers: { range: 'bytes=0-4, 99-' } })).status, 416);
  } finally {
    await server.close();
  }
});

// M9 fix 554: the server answers the feed's three kinds of name alone, so
// a publish's .tmp, a stray file or a file in a subfolder reads as missing.
test('serve answers 404 for anything but the manifest, an installer or a blockmap (M9 fix 554)', async () => {
  const feed = feedDir();
  publishFeed(release('0.1.240'), feed);
  fs.writeFileSync(path.join(feed, 'latest.yml.tmp'), 'half');
  fs.writeFileSync(path.join(feed, 'Emerald-setup-0.1.240-arm64.exe.tmp'), 'half');
  fs.writeFileSync(path.join(feed, 'notes.txt'), 'stray');
  fs.mkdirSync(path.join(feed, 'sub'));
  fs.writeFileSync(path.join(feed, 'sub', 'x.exe'), 'nested');
  const server = await serveFeed(feed, 0);
  try {
    for (const name of ['latest.yml.tmp', 'Emerald-setup-0.1.240-arm64.exe.tmp', 'notes.txt', 'sub/x.exe']) {
      const res = await fetch(`${server.url}${name}`);
      await res.text();
      assert.equal(res.status, 404, name);
    }
    for (const name of ['latest.yml', 'Emerald-setup-0.1.240-arm64.exe.blockmap']) {
      const res = await fetch(`${server.url}${name}`);
      await res.text();
      assert.equal(res.status, 200, name);
    }
  } finally {
    await server.close();
  }
});

// M9 fix 484: in the daemon a throw out of the request listener is the
// uncaughtException shutdown, every pane with it. A malformed escape reads
// 400 and an empty file 200 with no body, and the server answers the next
// request either way.
test('serve answers a malformed escape with 400 and an empty file with an empty 200, and lives on', async () => {
  const feed = feedDir();
  publishFeed(release('0.1.240'), feed);
  fs.writeFileSync(path.join(feed, 'empty.exe'), '');
  const lines: string[] = [];
  const server = await serveFeed(feed, 0, (l) => lines.push(l));
  try {
    const bad = await fetch(`${server.url}%E0`);
    assert.equal(bad.status, 400);
    await bad.text();
    assert.equal(lines[0], 'GET /%E0 400');
    const after = await fetch(`${server.url}latest.yml`);
    assert.equal(after.status, 200);
    assert.match(await after.text(), /^version: 0\.1\.240$/m);

    const empty = await fetch(`${server.url}empty.exe`);
    assert.equal(empty.status, 200);
    assert.equal(empty.headers.get('content-length'), '0');
    assert.equal(await empty.text(), '');
    assert.equal((await fetch(`${server.url}latest.yml`)).status, 200);
  } finally {
    await server.close();
  }
});

// M9 fix 485: overlapping ranges answered the file once per spec (2,000
// `0-` specs answered 2,000 files), so past MAX_RANGES specs or a sum
// past the file's size the whole file is answered once.
test('serve answers too many or overlapping ranges with the whole file once', async () => {
  const feed = feedDir();
  publishFeed(release('0.1.240'), feed);
  const server = await serveFeed(feed, 0);
  try {
    const many = await fetch(`${server.url}Emerald-setup-0.1.240-arm64.exe`, { headers: { range: `bytes=${Array(2000).fill('0-').join(',')}` } });
    assert.equal(many.status, 200);
    assert.equal(await many.text(), 'installer 0.1.240');
    const overlap = await fetch(`${server.url}Emerald-setup-0.1.240-arm64.exe`, { headers: { range: 'bytes=0-9, 5-14' } });
    assert.equal(overlap.status, 200);
    assert.equal(await overlap.text(), 'installer 0.1.240');
  } finally {
    await server.close();
  }
});

// A GET through node:http that reads `readBytes` and then drops the
// connection, or with `pause` holds it open without reading on.
function getThenDrop(url: string, readBytes: number, headers: http.OutgoingHttpHeaders = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let got = 0;
      res.on('data', (chunk: Buffer) => {
        got += chunk.length;
        if (got >= readBytes) {
          req.destroy();
          resolve(got);
        }
      });
    });
    req.on('error', (err) => {
      if (!req.destroyed) reject(err);
    });
  });
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

// M9 fix 485: `pipe` never destroyed its source when the response closed
// early, so a dropped download left the installer's handle open for the
// daemon's life, and close() resolved with it still open.
test('serve closes the read stream of a dropped request, and close() closes those mid-flight', async () => {
  const feed = feedDir();
  publishFeed(release('0.1.240'), feed);
  fs.writeFileSync(path.join(feed, 'big.exe'), Buffer.alloc(4 * 1024 * 1024, 7));
  const server = await serveFeed(feed, 0);
  let closed = false;
  try {
    await getThenDrop(`${server.url}big.exe`, 256 * 1024);
    await getThenDrop(`${server.url}big.exe`, 256 * 1024, { range: 'bytes=0-2097151, 2097152-4194303' });
    await settle(200);
    assert.equal(server.openStreams(), 0, 'a dropped whole-file and a dropped multipart answer leave no stream open');

    // A client that stops reading holds its answer's stream open.
    const held = http.get(`${server.url}big.exe`, (res) => res.pause());
    held.on('error', () => {});
    const deadline = Date.now() + 5000;
    while (server.openStreams() === 0 && Date.now() < deadline) await settle(10);
    assert.equal(server.openStreams(), 1, 'the held answer has its stream open');
    await server.close();
    closed = true;
    assert.equal(server.openStreams(), 0, 'close() resolves with no stream open');
    held.destroy();
  } finally {
    if (!closed) await server.close();
  }
});
