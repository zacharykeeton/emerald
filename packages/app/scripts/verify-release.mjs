// M9 fix 609 acceptance: the release script's dry run on two fixture
// builds. Starts no app, no daemon and no gh: each arch's folder holds an
// installer of a few bytes named for the package's version, its blockmap,
// a latest.yml in electron-builder's shape with the installer's real
// sha512 and size, and an app-update.yml naming the github provider. The
// dry run must print the merged manifest, the notes' heading and the gh
// command; then three broken copies must be refused with their exact
// lines: an installer whose bytes changed, a stale version and a build
// that still points the updater at the local feed.
// Logs to %TEMP%\emerald-verify\release.log. Build first (npm run build).
// Run: npm run verify:release -w @emerald/app
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLatestYml } from '@emerald/shared';
import { installerName, mergeLatestYml } from '@emerald/shared/release';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..', '..');
const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const verifyDir = path.join(os.tmpdir(), 'emerald-verify');
const dryDir = path.join(verifyDir, 'release-dry');
const logFile = path.join(verifyDir, 'release.log');
const t0 = Date.now();

fs.mkdirSync(verifyDir, { recursive: true });
fs.writeFileSync(logFile, '');

setTimeout(() => {
  log('WATCHDOG: run exceeded 60 s');
  process.exit(3);
}, 60000).unref();

function log(msg) {
  const line = `[verify +${((Date.now() - t0) / 1000).toFixed(2)}s] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

function expect(cond, what) {
  if (!cond) {
    log(`FAIL: ${what}`);
    process.exit(1);
  }
  log(`ok: ${what}`);
}

const UNPACKED = { arm64: 'win-arm64-unpacked', x64: 'win-unpacked' };
const GITHUB_UPDATE = 'owner: zacharykeeton\nrepo: emerald\nprovider: github\nupdaterCacheDirName: emerald-updater\n';

// One arch's build folder, as electron-builder leaves it, under `root`.
function writeBuild(root, arch) {
  const dir = path.join(root, arch);
  fs.mkdirSync(path.join(dir, UNPACKED[arch], 'resources'), { recursive: true });
  const name = installerName(version, arch);
  const bytes = Buffer.from(`fixture installer ${arch} ${version}\n`);
  fs.writeFileSync(path.join(dir, name), bytes);
  fs.writeFileSync(path.join(dir, `${name}.blockmap`), Buffer.from(`fixture blockmap ${arch}\n`));
  const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${bytes.length}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-10-07T01:02:03.000Z'",
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'latest.yml'), yml);
  fs.writeFileSync(path.join(dir, UNPACKED[arch], 'resources', 'app-update.yml'), GITHUB_UPDATE);
  return dir;
}

function fixtures(label) {
  const root = path.join(dryDir, label);
  fs.rmSync(root, { recursive: true, force: true });
  return { arm64: writeBuild(root, 'arm64'), x64: writeBuild(root, 'x64') };
}

function dryRun(dirs) {
  const r = spawnSync(process.execPath, ['scripts/release.mjs', '--dry-run', '--arm64-dir', dirs.arm64, '--x64-dir', dirs.x64], {
    cwd: appDir,
    encoding: 'utf8',
    windowsHide: true,
  });
  fs.appendFileSync(logFile, `$ release.mjs --dry-run\n${r.stdout ?? ''}${r.stderr ?? ''}[exit ${r.status}]\n`);
  return { code: r.status, out: (r.stdout ?? '').replace(/\r\n/g, '\n'), err: (r.stderr ?? '').replace(/\r\n/g, '\n') };
}

log(`version ${version}; fixtures under ${dryDir}`);
fs.rmSync(dryDir, { recursive: true, force: true });

// The good pair.
const good = fixtures('good');
const r = dryRun(good);
expect(r.code === 0, `the dry run exits 0 (exit ${r.code}${r.err ? `, ${r.err.trim()}` : ''})`);
const arm64Yml = path.join(good.arm64, 'latest.yml');
const x64Yml = path.join(good.x64, 'latest.yml');
expect(r.out.includes(`checked ${installerName(version, 'arm64')}: sha512 and size match ${arm64Yml}\n`), 'the arm64 installer is checked against its own latest.yml');
expect(r.out.includes(`checked ${installerName(version, 'x64')}: sha512 and size match ${x64Yml}\n`), 'the x64 installer is checked against its own latest.yml');
expect(r.out.includes(`release dry run for ${version}: nothing built or uploaded\n`), 'the dry run says it built and uploaded nothing');

const a = parseLatestYml(fs.readFileSync(arm64Yml, 'utf8'));
const x = parseLatestYml(fs.readFileSync(x64Yml, 'utf8'));
const merged = mergeLatestYml(a, x);
const block = /--- latest\.yml\n([\s\S]*?)--- notes: /.exec(r.out);
expect(block !== null && block[1] === merged, 'the printed latest.yml is the merge of the two manifests');
expect(parseLatestYml(block[1]).path === installerName(version, 'arm64'), 'the merged latest.yml reads back as the arm64 installer');
expect((block[1].match(/^ {2}- url: /gm) ?? []).length === 2, 'the merged latest.yml lists both installers');

const whatsNew = fs.readFileSync(path.join(repoRoot, 'docs', 'WHATS-NEW.md'), 'utf8');
const heading = /^##\s+(.+?)\s*$/m.exec(whatsNew)?.[1];
const notesLine = /^--- notes: (.+) \((\d+) lines\)$/m.exec(r.out);
expect(notesLine !== null && notesLine[1] === heading, `the notes are the newest section of docs/WHATS-NEW.md (${notesLine?.[1]}, ${notesLine?.[2]} lines)`);
expect(/^--- the code: v\S+ tags zacharykeeton\/emerald's default branch, /m.test(r.out), 'the code line names the public repo');

const ghLine = /^--- gh (.+)$/m.exec(r.out)?.[1] ?? '';
const prefix = `release create v${version} --draft --repo zacharykeeton/emerald --title "Emerald ${version}" --notes-file `;
expect(ghLine.startsWith(prefix), `the gh line drafts v${version} on the public repo: gh ${ghLine}`);
const rest = ghLine.slice(prefix.length).split(' ');
const expectedAssets = [
  path.join(good.arm64, installerName(version, 'arm64')),
  path.join(good.arm64, `${installerName(version, 'arm64')}.blockmap`),
  path.join(good.x64, installerName(version, 'x64')),
  path.join(good.x64, `${installerName(version, 'x64')}.blockmap`),
];
expect(rest.length === 6 && rest[0].endsWith('notes.md'), 'the notes file comes first, then five assets');
expect(expectedAssets.every((p, i) => rest[i + 1] === p) && rest[5].endsWith('latest.yml') && !rest[5].startsWith(good.arm64), 'the assets are the two installers and blockmaps in order, then the merged latest.yml');

// The refusals, each on a fresh copy.
function refused(label, breakIt, line) {
  const dirs = fixtures(label);
  breakIt(dirs);
  const res = dryRun(dirs);
  expect(res.code === 1 && res.err.includes(`${line}\n`), `${label}: refused with "${line}" (exit ${res.code}, ${res.err.trim()})`);
}

refused(
  'changed-bytes',
  (d) => fs.writeFileSync(path.join(d.x64, installerName(version, 'x64')), Buffer.from(`fixture installer x64 ${version}?\n`)),
  `release: ${installerName(version, 'x64')} does not match the sha512 in ${path.join(dryDir, 'changed-bytes', 'x64', 'latest.yml')}`,
);
refused(
  'stale-version',
  (d) => {
    const f = path.join(d.x64, 'latest.yml');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(`version: ${version}`, 'version: 0.1.450'));
  },
  `release: ${path.join(dryDir, 'stale-version', 'x64', 'latest.yml')} names 0.1.450, the build is ${version}; run without --no-build`,
);
refused(
  'generic-feed',
  (d) => fs.writeFileSync(path.join(d.arm64, UNPACKED.arm64, 'resources', 'app-update.yml'), 'provider: generic\nurl: http://127.0.0.1:7420/\n'),
  `release: ${path.join(dryDir, 'generic-feed', 'arm64', 'latest.yml')} points the updater at generic http://127.0.0.1:7420/, not github zacharykeeton/emerald (is fix 608 in this build?)`,
);

fs.rmSync(dryDir, { recursive: true, force: true });
log('PASS');
