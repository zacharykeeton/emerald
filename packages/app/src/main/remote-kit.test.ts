import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  KIT_NODE_VERSION,
  assembleKit,
  kitRoot,
  kitSources,
  nodeUrl,
  ptyUrl,
  shasumOf,
  shasumsUrl,
  tarEntries,
  writeTgz,
  zipEntry,
  type TarEntry,
} from './remote-kit.ts';

// M9 fix 1083: the remote kit's assembly, every download read through the
// read option over buffers the test builds.

const temps: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-kit-'));
  temps.push(d);
  return d;
}
after(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});

function put(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const sha512 = (b: Buffer): string => `sha512-${createHash('sha512').update(b).digest('base64')}`;
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

// A zip as nodejs.org lays one out, stored or deflated, the sizes in the
// central directory and zero in the local header (the data-descriptor case).
function writeZip(files: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(zlib.crc32(f.data), 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    central.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function tgzBuffer(entries: TarEntry[]): Buffer {
  const file = path.join(tmp(), 'x.tgz');
  writeTgz(entries, file);
  return fs.readFileSync(file);
}

const V = KIT_NODE_VERSION;
const NODE_EXE = Buffer.from('fake node.exe bytes '.repeat(50));
const NODE_BIN = Buffer.from('fake darwin node');

function ptyTarball(): Buffer {
  const e = (name: string, text = name): TarEntry => ({ name: `package/${name}`, mode: 0o644, data: Buffer.from(text) });
  return tgzBuffer([
    e('package.json', '{"name":"node-pty","version":"1.1.0"}'),
    e('lib/index.js'),
    e('lib/worker/conoutSocketWorker.js'),
    e('lib/index.test.js'),
    e('lib/index.d.ts'),
    e('prebuilds/win32-x64/pty.node'),
    e('prebuilds/win32-x64/pty.pdb'),
    e('prebuilds/win32-x64/conpty/conpty.dll'),
    e('prebuilds/win32-arm64/pty.node'),
    e('prebuilds/darwin-arm64/pty.node'),
    e('prebuilds/darwin-arm64/spawn-helper'),
    e('src/unixTerminal.ts'),
  ]);
}

function stageTree(integrity: string): string {
  const root = tmp();
  put(path.join(root, 'daemon', 'package.json'), '{}');
  put(path.join(root, 'daemon', 'dist', 'main.js'), 'daemon');
  put(path.join(root, 'cli', 'package.json'), '{}');
  put(path.join(root, 'cli', 'dist', 'main.js'), 'cli');
  put(path.join(root, 'cli', 'hooks', 'claude-hook.cmd'), 'hook');
  put(path.join(root, 'node_modules', '@emerald', 'shared', 'package.json'), '{}');
  put(path.join(root, 'node_modules', '@emerald', 'shared', 'dist', 'index.js'), 'shared');
  put(path.join(root, 'node_modules', '@xterm', 'headless', 'package.json'), '{}');
  put(path.join(root, 'node_modules', '@xterm', 'headless', 'lib-headless', 'xterm-headless.js'), 'xterm');
  put(path.join(root, 'kit-pins.json'), JSON.stringify({ nodePty: { version: '1.1.0', integrity } }));
  return root;
}

const env = { EMERALD_KIT_NODE_URL: 'https://n.test/dist/', EMERALD_KIT_NPM_URL: 'https://r.test' };

function fixture(opts: { os?: 'win32' | 'darwin'; arch?: 'x64' | 'arm64'; badSum?: boolean; badPty?: boolean } = {}) {
  const kitOs = opts.os ?? 'win32';
  const arch = opts.arch ?? 'x64';
  const pty = ptyTarball();
  const root = stageTree(opts.badPty === true ? sha512(Buffer.from('other')) : sha512(pty));
  const name = kitOs === 'win32' ? `node-v${V}-win-${arch}.zip` : `node-v${V}-darwin-${arch}.tar.gz`;
  const top = name.replace(/\.(zip|tar\.gz)$/, '');
  const nodeBuf =
    kitOs === 'win32'
      ? writeZip([
          { name: `${top}/README.md`, data: Buffer.from('readme'), deflate: false },
          { name: `${top}/node.exe`, data: NODE_EXE, deflate: true },
        ])
      : tgzBuffer([
          { name: `${top}/bin/node`, mode: 0o644, data: NODE_BIN },
          { name: `${top}/bin/npm`, mode: 0o644, data: Buffer.from('../lib/node_modules/npm/bin/npm-cli.js') },
        ]);
  const sum = opts.badSum === true ? 'f'.repeat(64) : sha256(nodeBuf);
  const sums = `${'0'.repeat(64)}  node-v${V}-headers.tar.gz\n${sum}  ${name}\n`;
  const urls = new Map<string, Buffer>([
    [shasumsUrl(env, V), Buffer.from(sums)],
    [nodeUrl(env, V, kitOs, arch), nodeBuf],
    [ptyUrl(env, '1.1.0'), pty],
  ]);
  const calls: string[] = [];
  const read = async (url: string): Promise<Buffer> => {
    calls.push(url);
    const b = urls.get(url);
    if (b === undefined) throw new Error(`no fixture for ${url}`);
    return b;
  };
  return { root, read, calls, kitOs, arch, cacheRoot: tmp() };
}

test('kitRoot takes EMERALD_KIT_STAGE, then the installed resources, then the checkout stage, and names the first tried when none holds pins', () => {
  const resources = tmp();
  const daemonMain = path.join(resources, 'daemon', 'dist', 'main.js');
  const checkout = tmp();
  const forced = tmp();
  put(path.join(forced, 'kit-pins.json'), '{}');
  assert.equal(kitRoot({ daemonMain, checkoutStage: checkout, env: { EMERALD_KIT_STAGE: forced } }), forced);
  assert.throws(() => kitRoot({ daemonMain, checkoutStage: checkout, env: { EMERALD_KIT_STAGE: checkout } }), {
    message: `the remote kit's sources are missing: no kit-pins.json in ${checkout} (run npm run stage -w @emerald/app, or set EMERALD_KIT_STAGE)`,
  });
  assert.throws(() => kitRoot({ daemonMain, checkoutStage: checkout, env: {} }), { message: new RegExp(`no kit-pins.json in ${resources.replace(/\\/g, '\\\\')} `) });
  put(path.join(checkout, 'kit-pins.json'), '{}');
  assert.equal(kitRoot({ daemonMain, checkoutStage: checkout, env: {} }), checkout);
  put(path.join(resources, 'kit-pins.json'), '{}');
  assert.equal(kitRoot({ daemonMain, checkoutStage: checkout, env: {} }), resources);
});

test('kitSources reads a stage-shaped tree and refuses one missing cli/package.json', () => {
  const root = stageTree('sha512-x');
  const s = kitSources(root);
  assert.equal(s.cli, path.join(root, 'cli'));
  assert.equal(s.headless, path.join(root, 'node_modules', '@xterm', 'headless'));
  assert.deepEqual(s.pins, { nodePty: { version: '1.1.0', integrity: 'sha512-x' } });
  fs.rmSync(path.join(root, 'cli', 'package.json'));
  assert.throws(() => kitSources(root), { message: new RegExp(`no kit-pins.json in ${path.join(root, 'cli').replace(/\\/g, '\\\\')} `) });
});

test('shasumOf finds the line for a file and nothing for another', () => {
  const text = `${'a'.repeat(64)}  node-v1-win-x64.zip\r\n${'b'.repeat(64)}  node-v1-darwin-arm64.tar.gz\n`;
  assert.equal(shasumOf(text, 'node-v1-darwin-arm64.tar.gz'), 'b'.repeat(64));
  assert.equal(shasumOf(text, 'node-v1-win-x64.zip'), 'a'.repeat(64));
  assert.equal(shasumOf(text, 'node-v1-win-arm64.zip'), null);
});

test('zipEntry reads a stored and a deflated entry from the central directory, and names a missing one', () => {
  const zip = writeZip([
    { name: 'a/stored.txt', data: Buffer.from('stored'), deflate: false },
    { name: 'a/deflated.txt', data: Buffer.from('deflated '.repeat(20)), deflate: true },
  ]);
  assert.equal(zipEntry(zip, 'a/stored.txt').toString(), 'stored');
  assert.equal(zipEntry(zip, 'a/deflated.txt').toString(), 'deflated '.repeat(20));
  assert.throws(() => zipEntry(zip, 'a/none'), { message: 'a/none is not readable in the zip: no such entry' });
});

test('a 101-byte name round-trips through the prefix split', () => {
  const long = `${'d'.repeat(60)}/${'f'.repeat(40)}`;
  assert.equal(Buffer.byteLength(long), 101);
  const back = tarEntries(tgzBuffer([{ name: long, mode: 0o644, data: Buffer.from('x') }]));
  assert.deepEqual(back.map((e) => [e.name, e.data.toString()]), [[long, 'x']]);
  assert.throws(() => tgzBuffer([{ name: 'n'.repeat(101), mode: 0o644, data: Buffer.alloc(0) }]), /too long/);
});

test('assembleKit builds the win32 kit: node.exe repacked flat, the host prebuild alone, the manifest last', async () => {
  const f = fixture();
  const logs: string[] = [];
  const kit = await assembleKit({ os: 'win32', arch: 'x64', appVersion: '0.1.1079', cacheRoot: f.cacheRoot, root: f.root, env, log: (m) => logs.push(m), read: f.read });
  const nodeEntries = tarEntries(fs.readFileSync(kit.nodeArchive));
  assert.deepEqual(nodeEntries.map((e) => e.name), ['node.exe']);
  assert.ok(nodeEntries[0]!.data.equals(NODE_EXE));
  assert.equal(kit.nodeArchive, path.join(f.cacheRoot, 'win32-x64', `node-${V}.tgz`));
  assert.equal(kit.emeraldArchive, path.join(f.cacheRoot, 'win32-x64', '0.1.1079', 'emerald-0.1.1079.tgz'));
  const names = tarEntries(fs.readFileSync(kit.emeraldArchive)).map((e) => e.name);
  assert.deepEqual(names, [...names].sort());
  assert.deepEqual(
    names.filter((n) => n.startsWith('node_modules/node-pty/')),
    [
      'node_modules/node-pty/lib/index.js',
      'node_modules/node-pty/lib/worker/conoutSocketWorker.js',
      'node_modules/node-pty/package.json',
      'node_modules/node-pty/prebuilds/win32-x64/conpty/conpty.dll',
      'node_modules/node-pty/prebuilds/win32-x64/pty.node',
    ],
  );
  for (const n of ['daemon/dist/main.js', 'cli/hooks/claude-hook.cmd', 'node_modules/@emerald/shared/dist/index.js', 'node_modules/@xterm/headless/lib-headless/xterm-headless.js']) {
    assert.ok(names.includes(n), n);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(kit.dir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest, kit.manifest);
  assert.equal(manifest.version, '0.1.1079');
  assert.deepEqual(manifest.node, { version: V, url: `https://n.test/dist/v${V}/node-v${V}-win-x64.zip`, sha256: kit.manifest.node.sha256 });
  assert.equal(manifest.pty.version, '1.1.0');
  assert.deepEqual(manifest.emerald.files, names);
  assert.equal(manifest.emerald.sha256, sha256(fs.readFileSync(kit.emeraldArchive)));
  assert.match(logs.at(-1)!, new RegExp(`^remote kit win32-x64 0\\.1\\.1079: node-${V}\\.tgz \\d+\\.\\d MB, emerald-0\\.1\\.1079\\.tgz \\d+\\.\\d MB, assembled in \\d+\\.\\d s$`));

  // A second assembly answers from the cache with no read.
  const reads = f.calls.length;
  const again = await assembleKit({ os: 'win32', arch: 'x64', appVersion: '0.1.1079', cacheRoot: f.cacheRoot, root: f.root, env, log: (m) => logs.push(m), read: f.read });
  assert.equal(f.calls.length, reads);
  assert.equal(logs.at(-1), 'remote kit win32-x64 0.1.1079: cached');
  assert.deepEqual(again.manifest, kit.manifest);

  // A new app version reuses node-<v>.tgz and removes the old version folder.
  const next = await assembleKit({ os: 'win32', arch: 'x64', appVersion: '0.1.1091', cacheRoot: f.cacheRoot, root: f.root, env, log: (m) => logs.push(m), read: f.read });
  assert.ok(!f.calls.slice(reads).includes(nodeUrl(env, V, 'win32', 'x64')), 'the Node archive is not downloaded again');
  assert.equal(next.nodeArchive, kit.nodeArchive);
  assert.equal(next.manifest.node.sha256, kit.manifest.node.sha256);
  assert.ok(!fs.existsSync(kit.dir));
  assert.deepEqual(fs.readdirSync(path.join(f.cacheRoot, 'win32-x64')).sort(), ['0.1.1091', `node-${V}.tgz`]);
  assert.match(logs.at(-1)!, new RegExp(`node-${V}\\.tgz \\(cached\\), emerald-0\\.1\\.1091\\.tgz`));
});

test('assembleKit builds the darwin kit: bin/node at 0755, spawn-helper at 0755', async () => {
  const f = fixture({ os: 'darwin', arch: 'arm64' });
  const kit = await assembleKit({ os: 'darwin', arch: 'arm64', appVersion: '0.1.1079', cacheRoot: f.cacheRoot, root: f.root, env, log: () => {}, read: f.read });
  const nodeEntries = tarEntries(fs.readFileSync(kit.nodeArchive));
  assert.deepEqual(nodeEntries.map((e) => [e.name, e.mode, e.data.toString()]), [['bin/node', 0o755, NODE_BIN.toString()]]);
  const pty = tarEntries(fs.readFileSync(kit.emeraldArchive)).filter((e) => e.name.includes('prebuilds/'));
  assert.deepEqual(pty.map((e) => [e.name, e.mode]), [
    ['node_modules/node-pty/prebuilds/darwin-arm64/pty.node', 0o644],
    ['node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper', 0o755],
  ]);
});

test('assembleKit refuses a Node download that does not match SHASUMS256.txt and writes no manifest', async () => {
  const f = fixture({ badSum: true });
  await assert.rejects(
    assembleKit({ os: 'win32', arch: 'x64', appVersion: '0.1.1079', cacheRoot: f.cacheRoot, root: f.root, env, log: () => {}, read: f.read }),
    { message: `the Node download did not match SHASUMS256.txt: node-v${V}-win-x64.zip` },
  );
  assert.ok(!fs.existsSync(path.join(f.cacheRoot, 'win32-x64', '0.1.1079', 'manifest.json')));
});

test('assembleKit refuses a node-pty tarball whose integrity differs from the pins', async () => {
  const f = fixture({ badPty: true });
  await assert.rejects(
    assembleKit({ os: 'win32', arch: 'x64', appVersion: '0.1.1079', cacheRoot: f.cacheRoot, root: f.root, env, log: () => {}, read: f.read }),
    { message: "the node-pty download did not match package-lock.json's integrity: node-pty-1.1.0.tgz" },
  );
  assert.ok(!fs.existsSync(path.join(f.cacheRoot, 'win32-x64', '0.1.1079', 'manifest.json')));
});

test('assembleKit refuses an arch node-pty has no prebuild for', async () => {
  const f = fixture({ os: 'darwin', arch: 'x64' });
  await assert.rejects(
    assembleKit({ os: 'darwin', arch: 'x64', appVersion: '0.1.1079', cacheRoot: f.cacheRoot, root: f.root, env, log: () => {}, read: f.read }),
    { message: 'node-pty-1.1.0.tgz holds no prebuilds/darwin-x64' },
  );
});
