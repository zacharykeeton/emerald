import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// The remote kit (M9 fix 1083): what emerald copies to a host so a pane can
// run there. Two archives per host OS and arch, assembled once on this PC and
// cached under the app's data folder: a pinned Node, repacked flat, shared by
// every app version, and the emerald part (the daemon, the CLI, shared, the
// headless xterm and node-pty for the host's arch) pinned to this app's
// version. Every download is checked: Node against its release's
// SHASUMS256.txt, node-pty against package-lock.json's integrity, which
// stage.mjs carries into the stage as kit-pins.json. Nothing here imports
// electron, so node --test runs its test; main passes in what it reads from
// the app.

// The one copy of the kit's Node version: stage.mjs cannot import this file,
// and two copies of the number would drift.
export const KIT_NODE_VERSION = '24.20.0';

export type KitOs = 'win32' | 'darwin';
export type KitArch = 'x64' | 'arm64';

export interface KitPins {
  nodePty: { version: string; integrity: string };
}

export interface KitManifest {
  version: string;
  node: { version: string; url: string; sha256: string };
  pty: { version: string; integrity: string };
  emerald: { files: string[]; sha256: string };
}

export interface AssembledKit {
  dir: string;
  manifest: KitManifest;
  nodeArchive: string;
  emeraldArchive: string;
}

export interface KitSources {
  daemon: string;
  cli: string;
  shared: string;
  headless: string;
  pins: KitPins;
}

export interface TarEntry {
  name: string;
  mode: number;
  data: Buffer;
}

function missing(where: string): Error {
  return new Error(`the remote kit's sources are missing: no kit-pins.json in ${where} (run npm run stage -w @emerald/app, or set EMERALD_KIT_STAGE)`);
}

// The stage-shaped tree the emerald part comes from: EMERALD_KIT_STAGE (a
// verify's own stage), else resources/ in the installed app (two above the
// daemon main's folder), else packages/app/stage in a checkout once
// npm run stage has run. The first holding kit-pins.json wins.
export function kitRoot(opts: { daemonMain: string; checkoutStage: string; env: NodeJS.ProcessEnv }): string {
  const forced = opts.env['EMERALD_KIT_STAGE'];
  if (forced !== undefined && forced !== '') {
    if (!fs.existsSync(path.join(forced, 'kit-pins.json'))) throw missing(forced);
    return forced;
  }
  const candidates = [path.resolve(path.dirname(opts.daemonMain), '..', '..'), opts.checkoutStage];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'kit-pins.json'))) return c;
  }
  throw missing(candidates[0]!);
}

export function kitSources(root: string): KitSources {
  const daemon = path.join(root, 'daemon');
  const cli = path.join(root, 'cli');
  const shared = path.join(root, 'node_modules', '@emerald', 'shared');
  const headless = path.join(root, 'node_modules', '@xterm', 'headless');
  for (const dir of [daemon, cli, shared, headless]) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) throw missing(dir);
  }
  const pinsFile = path.join(root, 'kit-pins.json');
  if (!fs.existsSync(pinsFile)) throw missing(root);
  const pins = JSON.parse(fs.readFileSync(pinsFile, 'utf8')) as KitPins;
  return { daemon, cli, shared, headless, pins };
}

function base(value: string | undefined, fallback: string): string {
  return (value ?? fallback).replace(/\/+$/, '');
}

export function nodeArchiveName(os: KitOs, arch: KitArch, v: string): string {
  return os === 'win32' ? `node-v${v}-win-${arch}.zip` : `node-v${v}-darwin-${arch}.tar.gz`;
}

export function nodeUrl(env: NodeJS.ProcessEnv, v: string, os: KitOs, arch: KitArch): string {
  return `${base(env['EMERALD_KIT_NODE_URL'], 'https://nodejs.org/dist')}/v${v}/${nodeArchiveName(os, arch, v)}`;
}

export function shasumsUrl(env: NodeJS.ProcessEnv, v: string): string {
  return `${base(env['EMERALD_KIT_NODE_URL'], 'https://nodejs.org/dist')}/v${v}/SHASUMS256.txt`;
}

export function ptyUrl(env: NodeJS.ProcessEnv, v: string): string {
  return `${base(env['EMERALD_KIT_NPM_URL'], 'https://registry.npmjs.org')}/node-pty/-/node-pty-${v}.tgz`;
}

// A file: URL is read from disk (the global fetch takes none), anything else
// through fetch.
export async function readUrl(url: string): Promise<Buffer> {
  if (url.startsWith('file:')) return fs.promises.readFile(fileURLToPath(url));
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(`the kit download failed: ${url}: ${(err as Error).message}`);
  }
  if (res.status !== 200) throw new Error(`the kit download failed: ${url} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// The hex checksum SHASUMS256.txt gives a file, written by nodejs.org as
// "<64 hex>  <name>".
export function shasumOf(text: string, fileName: string): string | null {
  for (const raw of text.split('\n')) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/i.exec(raw.replace(/\r$/, ''));
    if (m !== null && m[2] === fileName) return m[1]!.toLowerCase();
  }
  return null;
}

export function integrityMatches(buf: Buffer, integrity: string): boolean {
  if (!integrity.startsWith('sha512-')) return false;
  return `sha512-${createHash('sha512').update(buf).digest('base64')}` === integrity;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// One entry of a zip, read from the central directory: nodejs.org's zips may
// set the data-descriptor bit, which leaves the local header's sizes zero.
export function zipEntry(buf: Buffer, name: string): Buffer {
  const fail = (why: string): Error => new Error(`${name} is not readable in the zip: ${why}`);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw fail('no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) throw fail('zip64');
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw fail('a bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entryName === name) {
      if (size === 0xffffffff || local === 0xffffffff) throw fail('zip64');
      if (buf.readUInt32LE(local) !== 0x04034b50) throw fail('a bad local header');
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      throw fail(`compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw fail('no such entry');
}

function cString(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return slice.toString('utf8', 0, nul < 0 ? len : nul);
}

function octal(buf: Buffer, start: number, len: number): number {
  const text = cString(buf, start, len).trim();
  return text === '' ? 0 : parseInt(text, 8);
}

// The files of a .tgz, ustar with pax and GNU long names; folders, links and
// global headers are skipped.
export function tarEntries(tgz: Buffer): TarEntry[] {
  const tar = zlib.gunzipSync(tgz);
  const out: TarEntry[] = [];
  let next: string | null = null;
  let p = 0;
  while (p + 512 <= tar.length) {
    const header = tar.subarray(p, p + 512);
    if (header.every((b) => b === 0)) break;
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156]!);
    const data = tar.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      for (const rec of data.toString('utf8').split('\n')) {
        const m = /^\d+ path=(.*)$/.exec(rec);
        if (m !== null) next = m[1]!;
      }
      continue;
    }
    if (type === 'L') {
      next = cString(data, 0, data.length);
      continue;
    }
    const prefix = cString(header, 345, 155);
    const plain = cString(header, 0, 100);
    const name = next ?? (prefix === '' ? plain : `${prefix}/${plain}`);
    next = null;
    if (type === '0' || type === '\0') out.push({ name, mode: octal(header, 100, 8), data: Buffer.from(data) });
  }
  return out;
}

function splitName(name: string): { prefix: string; name: string } {
  if (Buffer.byteLength(name) <= 100) return { prefix: '', name };
  for (let i = name.indexOf('/'); i >= 0; i = name.indexOf('/', i + 1)) {
    const prefix = name.slice(0, i);
    const rest = name.slice(i + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100 && rest !== '') return { prefix, name: rest };
  }
  throw new Error(`${name} is too long for a tar header`);
}

function writeOctal(header: Buffer, start: number, len: number, value: number): void {
  header.write(value.toString(8).padStart(len - 1, '0') + '\0', start, len, 'ascii');
}

// A ustar .tgz of files, written to <file>.tmp and renamed.
export function writeTgz(entries: readonly TarEntry[], file: string, mtime = Math.floor(Date.now() / 1000)): void {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const header = Buffer.alloc(512);
    const { prefix, name } = splitName(e.name);
    header.write(name, 0, 100, 'utf8');
    writeOctal(header, 100, 8, e.mode);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, e.data.length);
    writeOctal(header, 136, 12, mtime);
    header.fill(0x20, 148, 156);
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\u000000', 257, 8, 'ascii');
    header.write(prefix, 345, 155, 'utf8');
    let sum = 0;
    for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    blocks.push(header, e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad > 0) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, zlib.gzipSync(Buffer.concat(blocks)));
  fs.renameSync(`${file}.tmp`, file);
}

function walkFiles(dir: string, rel = ''): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const r = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkFiles(abs, r));
    else if (entry.isFile()) out.push({ rel: r, abs });
  }
  return out;
}

function readManifest(file: string): KitManifest | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as KitManifest;
  } catch {
    return null;
  }
}

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1);
}

export async function assembleKit(opts: {
  os: KitOs;
  arch: KitArch;
  appVersion: string;
  cacheRoot: string;
  root: string;
  env: NodeJS.ProcessEnv;
  log: (msg: string) => void;
  read?: (url: string) => Promise<Buffer>;
}): Promise<AssembledKit> {
  const { os, arch, appVersion, env } = opts;
  const read = opts.read ?? readUrl;
  const v = KIT_NODE_VERSION;
  const t0 = Date.now();
  const sources = kitSources(opts.root);
  const pins = sources.pins.nodePty;
  const archDir = path.join(opts.cacheRoot, `${os}-${arch}`);
  const dir = path.join(archDir, appVersion);
  const nodeArchive = path.join(archDir, `node-${v}.tgz`);
  const emeraldArchive = path.join(dir, `emerald-${appVersion}.tgz`);
  const manifestFile = path.join(dir, 'manifest.json');
  const label = `remote kit ${os}-${arch} ${appVersion}`;

  const cached = readManifest(manifestFile);
  if (
    cached !== null &&
    cached.version === appVersion &&
    cached.node?.version === v &&
    cached.pty?.integrity === pins.integrity &&
    fs.existsSync(nodeArchive) &&
    fs.existsSync(emeraldArchive)
  ) {
    opts.log(`${label}: cached`);
    return { dir, manifest: cached, nodeArchive, emeraldArchive };
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const mtime = Math.floor(Date.now() / 1000);

  // (1) Node, repacked flat so the host untars node.exe or bin/node straight
  // into node-<v>/, where relayCommand runs it.
  const archiveName = nodeArchiveName(os, arch, v);
  const url = nodeUrl(env, v, os, arch);
  let nodeSha: string | null = null;
  const nodeWasCached = fs.existsSync(nodeArchive);
  if (nodeWasCached) {
    // The checksum the Node archive was checked against, from a sibling
    // version's manifest, so an app update does not download Node again.
    for (const sib of fs.existsSync(archDir) ? fs.readdirSync(archDir) : []) {
      const m = readManifest(path.join(archDir, sib, 'manifest.json'));
      if (m !== null && m.node?.version === v && typeof m.node.sha256 === 'string') {
        nodeSha = m.node.sha256;
        break;
      }
    }
    if (nodeSha === null) nodeSha = shasumOf((await read(shasumsUrl(env, v))).toString('utf8'), archiveName);
    if (nodeSha === null) throw new Error(`SHASUMS256.txt names no ${archiveName}`);
  } else {
    const sums = (await read(shasumsUrl(env, v))).toString('utf8');
    nodeSha = shasumOf(sums, archiveName);
    if (nodeSha === null) throw new Error(`SHASUMS256.txt names no ${archiveName}`);
    const buf = await read(url);
    if (sha256Hex(buf) !== nodeSha) throw new Error(`the Node download did not match SHASUMS256.txt: ${archiveName}`);
    const top = archiveName.replace(/\.(zip|tar\.gz)$/, '');
    let entry: TarEntry;
    if (os === 'win32') {
      entry = { name: 'node.exe', mode: 0o644, data: zipEntry(buf, `${top}/node.exe`) };
    } else {
      const found = tarEntries(buf).find((e) => e.name === `${top}/bin/node`);
      if (found === undefined) throw new Error(`${archiveName} holds no ${top}/bin/node`);
      entry = { name: 'bin/node', mode: 0o755, data: found.data };
    }
    writeTgz([entry], nodeArchive, mtime);
  }

  // (2) node-pty at the lockfile's version, only the host's prebuild.
  const ptyName = `node-pty-${pins.version}.tgz`;
  const ptyBuf = await read(ptyUrl(env, pins.version));
  if (!integrityMatches(ptyBuf, pins.integrity)) throw new Error(`the node-pty download did not match package-lock.json's integrity: ${ptyName}`);
  const prebuild = `prebuilds/${os}-${arch}/`;
  const entries: TarEntry[] = [];
  let prebuilds = 0;
  for (const e of tarEntries(ptyBuf)) {
    if (!e.name.startsWith('package/')) continue;
    const rel = e.name.slice('package/'.length);
    const keep =
      rel === 'package.json' ||
      (rel.startsWith('lib/') && rel.endsWith('.js') && !rel.endsWith('.test.js')) ||
      (rel.startsWith(prebuild) && !rel.endsWith('.pdb'));
    if (!keep) continue;
    if (rel.startsWith(prebuild)) prebuilds++;
    // The tarball's own mode is not trusted (stage.mjs chmods it too).
    const mode = os === 'darwin' && rel === `${prebuild}spawn-helper` ? 0o755 : 0o644;
    entries.push({ name: `node_modules/node-pty/${rel}`, mode, data: e.data });
  }
  if (prebuilds === 0) throw new Error(`${ptyName} holds no prebuilds/${os}-${arch}`);

  // (3) The emerald part, as the stage left it.
  const parts: [string, string][] = [
    [sources.daemon, 'daemon'],
    [sources.cli, 'cli'],
    [sources.shared, 'node_modules/@emerald/shared'],
    [sources.headless, 'node_modules/@xterm/headless'],
  ];
  for (const [from, to] of parts) {
    for (const f of walkFiles(from)) entries.push({ name: `${to}/${f.rel}`, mode: 0o644, data: fs.readFileSync(f.abs) });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // (4) The emerald archive, then the manifest last, which marks it cached.
  writeTgz(entries, emeraldArchive, mtime);
  const manifest: KitManifest = {
    version: appVersion,
    node: { version: v, url, sha256: nodeSha },
    pty: { version: pins.version, integrity: pins.integrity },
    emerald: { files: entries.map((e) => e.name), sha256: sha256Hex(fs.readFileSync(emeraldArchive)) },
  };
  fs.writeFileSync(`${manifestFile}.tmp`, JSON.stringify(manifest, null, 2));
  fs.renameSync(`${manifestFile}.tmp`, manifestFile);

  for (const sib of fs.readdirSync(archDir)) {
    const abs = path.join(archDir, sib);
    if (sib === appVersion || sib === `node-${v}.tgz`) continue;
    if (/^node-.*\.tgz$/.test(sib) || fs.statSync(abs).isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
  }

  const nodePart = nodeWasCached ? `node-${v}.tgz (cached)` : `node-${v}.tgz ${mb(fs.statSync(nodeArchive).size)} MB`;
  opts.log(`${label}: ${nodePart}, emerald-${appVersion}.tgz ${mb(fs.statSync(emeraldArchive).size)} MB, assembled in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { dir, manifest, nodeArchive, emeraldArchive };
}
