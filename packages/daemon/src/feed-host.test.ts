import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { mkTemp, removeTemps } from '@emerald/shared/test-temp';
import { feedHostSettings, startFeedHost } from './feed-host.ts';
import type { Logger } from './log.ts';

function logger(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (msg: string) => lines.push(`${level} ${msg}`);
  return { log: { info: push('INFO'), warn: push('WARN'), error: push('ERROR') }, lines };
}

test.after(removeTemps);

test('a feed folder is served on start and latest.yml reads back over http', async () => {
  const dir = mkTemp('emerald-feed-host-');
  fs.writeFileSync(path.join(dir, 'latest.yml'), 'version: 0.1.240\npath: Emerald-setup-0.1.240-arm64.exe\nsha512: abc\n');
  const { log, lines } = logger();
  const host = await startFeedHost({ dir, port: 0, log });
  assert.ok(host !== null, 'the host is up');
  try {
    assert.equal(host.dir, dir);
    assert.ok(host.port !== null && host.port > 0);
    assert.deepEqual(lines, [`INFO feed: serving ${dir} on ${host.port}`]);
    const res = await fetch(`http://127.0.0.1:${host.port}/latest.yml`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /^version: 0\.1\.240$/m);
  } finally {
    await host.close();
  }
});

test('no folder binds nothing and says so', async () => {
  const dir = path.join(mkTemp('emerald-feed-host-'), 'never-published');
  const { log, lines } = logger();
  const host = await startFeedHost({ dir, port: 0, log });
  assert.equal(host, null);
  assert.deepEqual(lines, [`INFO feed: no folder at ${dir}; not serving`]);
});

// M9 fix 486: a daemon that found the port taken at start used to have no
// feed for its life; it now tries again on a timer and binds once free.
test('a port already taken is one warning, and a bind once the port is free', async () => {
  const dir = mkTemp('emerald-feed-host-');
  fs.writeFileSync(path.join(dir, 'latest.yml'), 'version: 0.1.486\n');
  const holder = net.createServer();
  await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = (holder.address() as net.AddressInfo).port;
  const { log, lines } = logger();
  const host = await startFeedHost({ dir, port, log, retryMs: 50 });
  try {
    assert.ok(host !== null, 'a host waiting on the port');
    assert.equal(host.port, null);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, new RegExp(`^WARN feed: could not bind port ${port} for .*EADDRINUSE.*trying again`));
    // A few tries while the port is still held say nothing more.
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(host.port, null);
    assert.equal(lines.length, 1);
    await new Promise<void>((resolve) => holder.close(() => resolve()));
    const deadline = Date.now() + 5000;
    while (host.port === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    assert.equal(host.port, port);
    assert.deepEqual(lines.slice(1), [`INFO feed: serving ${dir} on ${port}`]);
    const res = await fetch(`http://127.0.0.1:${port}/latest.yml`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /^version: 0\.1\.486$/m);
  } finally {
    await host?.close();
    if (holder.listening) await new Promise<void>((resolve) => holder.close(() => resolve()));
  }
});

test('a host waiting on a taken port stops trying once closed', async () => {
  const dir = mkTemp('emerald-feed-host-');
  const holder = net.createServer();
  await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
  const port = (holder.address() as net.AddressInfo).port;
  const { log, lines } = logger();
  const host = await startFeedHost({ dir, port, log, retryMs: 50 });
  assert.ok(host !== null);
  await host.close();
  await new Promise<void>((resolve) => holder.close(() => resolve()));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(host.port, null);
  assert.equal(lines.length, 1);
});

test('the environment names the folder and the port, and off serves none', () => {
  const settings = feedHostSettings({});
  assert.match(settings.dir ?? '', /emerald-feed$/);
  assert.equal(settings.port, 7420);
  assert.deepEqual(feedHostSettings({ EMERALD_FEED_DIR: 'D:\\feed', EMERALD_FEED_PORT: '0' }), { dir: 'D:\\feed', port: 0 });
  assert.deepEqual(feedHostSettings({ EMERALD_FEED_DIR: 'off', EMERALD_FEED_PORT: 'many' }), { dir: null, port: 7420 });
});
