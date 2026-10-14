// M7 acceptance, part 3: the installer, in two halves.
//
// The updater half (M9 fix 239, `--updater` runs it alone): the packed
// build under release/win-arm64-unpacked is launched on a private home,
// pipe and profile with EMERALD_UPDATE_URL pointing at a stub feed served
// by the CLI's own feed server from a release folder whose latest.yml is
// one version ahead of the build and names a copy of the real installer,
// published through `emmer feed publish`. The launch check's find must
// download on its own (M9 fix 625): with no click the installer lands in
// the updater's cache (the run's own under the home, pending\ in it) with
// the manifest's sha512, the title row shows no badge while it downloads,
// and the badge then reads `Restart to update`. The one click is made with
// the cached installer removed first (M9 fix 323), so its marker, its
// poster script and its daemon stop are read while nothing installs; the
// handoff itself (the silent install, the relaunch, the toast) is read by
// hand at the first real update. The command line is read beside it (M9
// fix 271): `emmer update --check` and `--download` through the shim on
// the private pipe, which on a window already downloading or ready relay
// no click, and `emerald update` reads the state back off the daemon; the
// badge in the title row is read after each to show it followed. The updater's cache is
// private to the run (M9 fix 330): electron-updater roots its cache at
// %LOCALAPPDATA% (AppAdapter.js, getAppCacheDir) and names the folder
// off app-update.yml's updaterCacheDirName, so the packed build is
// spawned with LOCALAPPDATA set to <home>\localappdata and its cache is
// <home>\localappdata\emerald-updater, removed whole at the end. Before
// that the cache was the user's own %LOCALAPPDATA%\emerald-updater, whose
// root holds the two files the next differential download is built
// from (M9 fix 259: installer.exe, which the NSIS installer copies there
// as it runs, and current.blockmap, which the updater copies up from
// pending\ once a download lands), and a stub run's download put this
// build's blockmap over the installed one's; the script saved and put
// back the root's blockmap, which held for one run at a time and not for
// two forks' runs overlapping, which corrupted it for both. The user's
// cache root is listed at the start and read again at the end, untouched.
// The daemon that build spawns inherits the variable too, so its
// %LOCALAPPDATA%\emerald-feed lookup (feed-server.ts) finds nothing under a
// harness and never tries port 7420, and the Windows Terminal scheme read
// (schemes.ts) finds nothing, which reaches no step. The launch in the
// install's gap (M9 fix 282) follows on the same home once the window is
// down: installing.json one version ahead makes the packed build post
// `Still installing` and quit with no window and no daemon, and the
// marker at the build's own version is removed by a launch that comes up.
//
// The updater half runs on EMERALD_HOME and EMERALD_PIPE when they are set,
// like every other script (M9 fix 330), with the stub feed's folders
// under the home; unset, it takes %TEMP%\emerald-verify\install-home and
// emmerd-verify-install as before. Two runs on two pairs can overlap;
// the install half cannot (one Programs\emerald), and runs through
// verify-slot.ps1 -Solo.
//
// The install half (`--install` runs it alone): runs release/Emerald-setup-
// <v>-arm64.exe silently (a real per-user install into
// %LOCALAPPDATA%\Programs\emerald), checks the install directory, the user
// PATH in the registry and that a fresh cmd finds `emmer --version`
// through that PATH, then runs the uninstaller silently and checks the
// directory and the PATH entry are gone. Leaves the machine as it found
// it, and needs no emerald installed, so it belongs to the install session.
// M9 fix 381: it also reads each extension's classic default before and
// after the install (untouched by it) and after the uninstall (cleared
// when it named one of our ProgIds). M9 fix 630: the half runs on a home,
// pipe and CLAUDE_SETTINGS of its own (<home>\install-half), puts the
// hooks into those private settings through the installed shim, installs
// over the install (the uninstaller under --updated must leave them) and,
// after the uninstall, reads the person's real Claude settings unchanged
// and the private ones without a hook of ours.
//
// The entries read (M9 fix 382, `--entries` runs it alone): reads the
// live install without an installer or an uninstaller, so it runs on the
// box the install session sits on, with the app up. The install
// directory's files, the user PATH entry and its registry kind, the
// ProgIds, their open commands, their OpenWithProgids entries and the
// extension keys' classic defaults (expected untouched, which fails on
// the fileAssociations installer of fixes 342 to 371 and passes on fix
// 381's), each checked against what electron-builder.yml and
// build/installer.nsh name rather than against a before-and-after; the
// version read off the install directory and off `emmer --version`
// through the installed shim, printed and not judged, since the session
// may be running a build the feed has moved past. No second install by
// `/D=`: it would write the same ProgIds and PATH entry as the person's
// own install, and its uninstall would take theirs away.
//
// Logs to %TEMP%\emerald-verify\install.log, or install-<the home's name>.log
// under EMERALD_HOME. Build first (npm run dist -w @emerald/app; the entries
// read needs no build). Run:
// npm run verify:install -w @emerald/app [-- --updater | --install | --entries]
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, freshPort, sleep } from './cdp.mjs';
import { readIco } from './make-icon.mjs';
import { publishFeed, serveFeed } from '../../cli/dist/feed.js';
import { HOOK_EVENTS } from '../../cli/dist/hooks-install.js';
import { GITHUB_RELEASES, UPDATER_CACHE_DIR_NAME } from '@emerald/shared';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const setup = path.join(appDir, 'release', `Emerald-setup-${version}-arm64.exe`);
const unpacked = path.join(appDir, 'release', 'win-arm64-unpacked');
const exe = path.join(unpacked, 'Emerald.exe');
const shim = path.join(unpacked, 'resources', 'bin', 'emmer.cmd');
const installDir = path.join(process.env['LOCALAPPDATA'], 'Programs', 'emerald');
const binDir = path.join(installDir, 'resources', 'bin');
const verifyDir = path.join(os.tmpdir(), 'emerald-verify');
const t0 = Date.now();
const only = process.argv.includes('--updater') ? 'updater' : process.argv.includes('--install') ? 'install' : process.argv.includes('--entries') ? 'entries' : 'both';

// The updater half's private pair, profile, stub feed and updater cache
// (M9 fix 330): the pair off the environment as cdp.mjs takes it, the
// rest under the home. The packed build gets LOCALAPPDATA pointed at
// <home>\localappdata, which is where electron-updater roots its cache.
const home = process.env['EMERALD_HOME'] ?? path.join(verifyDir, 'install-home');
const pipe = process.env['EMERALD_PIPE'] ?? '\\\\.\\pipe\\emmerd-verify-install';
const feedRelease = path.join(home, 'install-feed-release');
const feedDir = path.join(home, 'install-feed');
const localAppData = path.join(home, 'localappdata');
const cacheDir = path.join(localAppData, UPDATER_CACHE_DIR_NAME);
const logFile = path.join(verifyDir, process.env['EMERALD_HOME'] === undefined ? 'install.log' : `install-${path.basename(home)}.log`);
let child = null;
let feed = null;
// The fix 384 hold on the stand-in installer, killed on a FAIL too.
let holder = null;
const appLogs = [];
// A `look()` outstanding on the run (fix 412): a by-design read that
// cannot pass on every box, printed and counted rather than failed.
let looks = 0;
// The user's own updater cache is never the run's; its root is listed
// here and read again at the end to show the run left it alone.
const userCacheDir = path.join(process.env['LOCALAPPDATA'], UPDATER_CACHE_DIR_NAME);
const cacheRootFiles = ['current.blockmap', 'installer.exe'];
const userCacheRootBefore = listUserCacheRoot();

fs.mkdirSync(verifyDir, { recursive: true });
fs.writeFileSync(logFile, '');

setTimeout(() => {
  log('WATCHDOG: run exceeded 300 s');
  cleanupHard();
  process.exit(3);
}, 300000);

function log(msg) {
  const line = `[verify +${((Date.now() - t0) / 1000).toFixed(2)}s] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

function expect(cond, what) {
  if (!cond) {
    log(`FAIL: ${what}`);
    cleanupHard();
    process.exit(1);
  }
  log(`ok: ${what}`);
}

// A read that cannot pass on every box by design (fix 412): logged and
// counted, never failed. The script still exits 0 with one outstanding.
function look(what) {
  looks += 1;
  log(`look: ${what}`);
}

function powershell(command) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  return (r.stdout ?? '').trim();
}

// The user PATH exactly as stored, unexpanded, plus its registry kind.
function userPath() {
  const out = powershell(
    `$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); $k.GetValueKind('Path'); $k.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)`,
  );
  const [kind, ...rest] = out.split(/\r?\n/);
  return { kind, entries: (rest.join('') ?? '').split(';').filter(Boolean) };
}

function hasBinEntry(p) {
  return p.entries.some((e) => e.replace(/\\$/, '').toLowerCase() === binDir.toLowerCase());
}

// The opener candidates Windows lists for an extension (M9 fix 342): the
// value names under HKCU\Software\Classes\.<ext>\OpenWithProgids, empty
// when the key is not there. The ProgId the installer wrote is read as
// the name that appears, not guessed from the build config.
function openWithProgids(ext) {
  const out = powershell(`$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Classes\\.${ext}\\OpenWithProgids'); if ($k -ne $null) { $k.GetValueNames() -join ',' }`);
  return out === '' ? [] : out.split(',').map((n) => n.trim()).filter(Boolean);
}

// The open command a ProgId names, or null when the ProgId is not there.
function progIdCommand(progId) {
  const out = powershell(`$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Classes\\${progId}\\shell\\open\\command'); if ($k -ne $null) { $k.GetValue('') }`);
  return out === '' ? null : out;
}

// A ProgId's DefaultIcon, or null when the key is not there.
function progIdIcon(progId) {
  const out = powershell(`$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Classes\\${progId}\\DefaultIcon'); if ($k -ne $null) { $k.GetValue('') }`);
  return out === '' ? null : out;
}

// The extension key's classic default value (M9 fix 381), the ProgId
// Windows falls back on when the person has picked no opener, or null
// when the key or the value is not there. The installer never writes it
// and the uninstaller clears one that names our ProgId.
function classicDefault(ext) {
  const out = powershell(`$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\\Classes\\.${ext}'); if ($k -ne $null) { $v=$k.GetValue(''); if ($v -ne $null) { 'value:' + $v } }`);
  return out.startsWith('value:') ? out.slice('value:'.length) : null;
}

// The Open with entries the installer writes, read off build/installer.nsh's
// EMERALD_OPENWITH lines (M9 fix 381): [{ ext, progId, description }], so
// the reads below check the registry against what the install names
// rather than a copy of the names here.
function nshOpenWith() {
  const text = fs.readFileSync(path.join(appDir, 'build', 'installer.nsh'), 'utf8');
  const out = [];
  for (const m of text.matchAll(/^\s*!insertmacro EMERALD_OPENWITH "([^"]+)" "([^"]+)" "([^"]+)"/gm)) {
    out.push({ ext: m[1], progId: m[2], description: m[3] });
  }
  return out;
}

// What a terminal opened after the install would see: machine PATH then
// user PATH, both expanded, read fresh from the registry.
function freshPath() {
  return powershell(
    `[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`,
  );
}

async function until(what, fn, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function readDaemonInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
  } catch {
    return null;
  }
}

function sha512(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

function cleanupHard() {
  // The entries read starts nothing, so a daemon.json under the home is
  // some other run's and stays.
  if (only === 'entries') return;
  if (holder !== null) holder.kill();
  if (child !== null) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  const info = readDaemonInfo();
  if (info !== null) spawnSync('taskkill', ['/pid', String(info.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  if (feed !== null) void feed.close();
  cleanCache();
}

// The run's private cache goes whole, with the localappdata folder it
// sits in; the home's logs stay as every script's do.
function cleanCache() {
  fs.rmSync(localAppData, { recursive: true, force: true });
}

// Names, sizes and mtimes of the user's cache root's files, for the
// before and after read.
function listUserCacheRoot() {
  return cacheRootFiles
    .filter((name) => fs.existsSync(path.join(userCacheDir, name)))
    .map((name) => {
      const st = fs.statSync(path.join(userCacheDir, name));
      return `${name} ${st.size} ${st.mtime.toISOString()}`;
    })
    .join(', ');
}

// The stub feed's version: one patch ahead of the packed build.
function stubVersion() {
  const parts = version.split('.').map(Number);
  parts[parts.length - 1] += 1;
  return parts.join('.');
}

// The version one patch behind the packed build: the stamp a home holds
// when this build is the one just installed (M9 fix 371).
function priorVersion() {
  const parts = version.split('.').map(Number);
  parts[parts.length - 1] -= 1;
  return parts.join('.');
}

async function updaterHalf() {
  const stub = stubVersion();
  expect(fs.existsSync(exe), `${exe} exists (run npm run dist -w @emerald/app first)`);
  expect(fs.existsSync(setup), `${setup} exists`);
  const updateYml = path.join(unpacked, 'resources', 'app-update.yml');
  expect(fs.existsSync(updateYml), 'resources/app-update.yml shipped by the publish block');
  const updateCfg = fs.readFileSync(updateYml, 'utf8');
  // Fix 608: the packed build reads the public releases repository; the
  // rest of this half runs on the stub by EMERALD_UPDATE_URL.
  expect(/^provider: github$/m.test(updateCfg) && new RegExp(`^owner: ${GITHUB_RELEASES.owner}$`, 'm').test(updateCfg) && new RegExp(`^repo: ${GITHUB_RELEASES.repo}$`, 'm').test(updateCfg) && new RegExp(`^updaterCacheDirName: ${UPDATER_CACHE_DIR_NAME}$`, 'm').test(updateCfg), `app-update.yml names the github provider on ${GITHUB_RELEASES.owner}/${GITHUB_RELEASES.repo} and the ${UPDATER_CACHE_DIR_NAME} cache (${updateCfg.replace(/\s+/g, ' ').trim()})`);
  const releaseYml = fs.readFileSync(path.join(appDir, 'release', 'latest.yml'), 'utf8');
  expect(new RegExp(`^version: ${version.replace(/\./g, '\\.')}$`, 'm').test(releaseYml) && /^sha512: /m.test(releaseYml), `release/latest.yml names ${version} with a sha512`);
  expect(fs.existsSync(`${setup}.blockmap`), "the installer's blockmap is beside it");

  // The stub release: latest.yml one patch ahead, naming a copy of the
  // real installer (its sha512 is the real one, so the library's check
  // passes), published by the CLI's own publish so what is served is
  // what a real feed holds.
  log(`home ${home}, pipe ${pipe}, updater cache ${cacheDir}`);
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(localAppData, { recursive: true });
  expect(!fs.existsSync(cacheDir), 'the run starts on an empty private updater cache');
  // The Claude home the harness reads must exist: the app never quits on
  // its window's close when the folder is missing (found while writing
  // this step; cdp.mjs's harnessClaudeHome creates it for every script).
  fs.mkdirSync(path.join(home, 'claude-home'), { recursive: true });
  fs.mkdirSync(feedRelease, { recursive: true });
  const stubName = `Emerald-setup-${stub}-arm64.exe`;
  fs.copyFileSync(setup, path.join(feedRelease, stubName));
  fs.copyFileSync(`${setup}.blockmap`, path.join(feedRelease, `${stubName}.blockmap`));
  const hash = sha512(setup);
  const size = fs.statSync(setup).size;
  fs.writeFileSync(
    path.join(feedRelease, 'latest.yml'),
    `version: ${stub}\nfiles:\n  - url: ${stubName}\n    sha512: ${hash}\n    size: ${size}\npath: ${stubName}\nsha512: ${hash}\nreleaseDate: '${new Date().toISOString()}'\n`,
  );
  const published = publishFeed(feedRelease, feedDir);
  expect(published.manifest.version === stub && published.files.length === 3 && published.missing.length === 0, `feed publish copied ${published.files.join(', ')} (${stub})`);
  const requests = [];
  feed = await serveFeed(feedDir, 0, (line) => requests.push(line));
  log(`stub feed at ${feed.url} from ${feedDir}`);

  // LOCALAPPDATA for the packed build alone (M9 fix 330, see the header);
  // the shim's commands below run with the same env, which reaches
  // nothing in the CLI.
  const env = {
    ...process.env,
    LOCALAPPDATA: localAppData,
    EMERALD_HOME: home,
    EMERALD_PIPE: pipe,
    EMERALD_UPDATE_URL: feed.url,
    CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'),
    EMERALD_WINDOW: 'background',
    EMERALD_WHATS_NEW: 'off',
    EMERALD_CLAUDE_HOME: path.join(home, 'claude-home'),
  };
  const port = freshPort();
  child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(home, 'electron-profile')}`], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  child.stdout.on('data', (d) => appLogs.push(d.toString()));
  child.stderr.on('data', (d) => appLogs.push(d.toString()));
  let pages = [];
  await until('a page target from the packaged app', async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
      pages = (await res.json()).filter((p) => p.type === 'page' && !p.url.startsWith('about:'));
    } catch {
      pages = [];
    }
    return pages.length > 0;
  }, 20000);
  const s = await connect(pages[0].webSocketDebuggerUrl);
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await s.waitFor(`!!document.querySelector('.title-bar')`, 'the title row', 20000);
  log('packaged app is up');
  // M9 fix 625: the badge is sampled from here to the ready read, since
  // the launch check's download runs on its own and the badge must show
  // nothing until the build is ready. M9 fix 296's frozen 0% or null is
  // covered by the same samples.
  const badge = () =>
    s.evalJs(
      `(() => { const b = document.querySelector('.title-bar-update'); return b === null ? null : { text: b.textContent, phase: b.dataset.phase, title: b.title, right: Math.round(b.getBoundingClientRect().right), rowRight: Math.round(document.querySelector('.title-bar').getBoundingClientRect().right) }; })()`,
    );
  const badgeSamples = [];
  let sampling = true;
  const sampleBadge = (async () => {
    while (sampling) {
      const b = await badge().catch(() => null);
      if (b !== null) badgeSamples.push(b.text);
      await sleep(20);
    }
  })();
  const state0 = await s.evalJs(`window.emerald.update.state()`);
  expect(state0.phase !== 'off' && state0.current === version, `the updater is on in the packed build, current ${state0.current} (${state0.phase})`);
  await until('the check line in the main log', () => appLogs.join('').includes(`update check against ${feed.url}`), 5000);
  expect(true, 'the main log names the stub feed');

  // M9 fix 271: the state off the daemon, once the window has reported
  // it (the report rides the app's connect, a moment after the title
  // row), then the check from the command line. The launch check runs 5
  // s in, so `--check` either runs the check itself from idle or, when
  // the launch check got there first, prints its answer; since M9 fix 625
  // the answer is the download it started on its own, or the build it
  // already downloaded, and the log says which. The CLI runs
  // asynchronously: the stub feed is served from this process, and a
  // spawnSync on a command that waits for the check would hold the feed's
  // answer until the command gave up (30 s, found writing this step).
  const emerald = (...args) =>
    new Promise((resolve) => {
      const p = spawn('cmd.exe', ['/d', '/c', shim, ...args], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => (stdout += d.toString()));
      p.stderr.on('data', (d) => (stderr += d.toString()));
      p.on('close', (status) => resolve({ status, stdout, stderr }));
    });
  const lastLine = (r) => r.stdout.trim().split(/\r?\n/).pop() ?? '';
  const first = await until('emmer update reading a reported state', async () => {
    const r = await emerald('update');
    return r.status === 0 && r.stdout.startsWith(`${version} installed, `) ? r : null;
  }, 15000);
  expect(/^\d+\.\d+\.\d+ installed, (not checked yet|checking the feed|downloading \d+\.\d+\.\d+( \d+%)?|\d+\.\d+\.\d+ ready)$/.test(first.stdout.trim()), `emmer update reads the window's state off the daemon: "${first.stdout.trim()}"`);
  const check = await emerald('update', '--check');
  log(`emmer update --check printed: ${check.stdout.trim().split(/\r?\n/).join(' | ')}${check.stderr.trim() === '' ? '' : ` (stderr: ${check.stderr.trim()})`}`);
  const esc = (v) => v.replace(/\./g, '\\.');
  const checkEnd = new RegExp(`^${esc(version)} installed, (downloading ${esc(stub)}( \\d+%)?|${esc(stub)} ready)$`);
  expect(check.status === 0 && checkEnd.test(lastLine(check)), `emmer update --check ends on "${lastLine(check)}"`);

  // The first check runs 5 s after launch; its find downloads on its own
  // (M9 fix 625), so with no click the badge comes up ready.
  const ready = await until('the badge', async () => {
    const b = await badge();
    if (b !== null && b.phase === 'error') throw new Error(`the download failed: ${b.title}`);
    return b !== null && b.phase === 'ready' ? b : null;
  }, 20000);
  sampling = false;
  await sampleBadge;
  expect(ready.text === 'Restart to update', `with no click the badge reads "${ready.text}"`);
  expect(ready.title.includes(stub) && ready.title.includes(version) && /restart/i.test(ready.title), `its tooltip names both versions and the restart (${ready.title})`);
  expect(ready.right <= ready.rowRight && ready.rowRight - ready.right < 40, `the badge sits at the row's right (${ready.right} of ${ready.rowRight})`);
  expect(requests.some((r) => r.startsWith('GET /latest.yml 200')), `the feed served the manifest (${requests.join('; ')})`);
  expect(fs.existsSync(path.join(cacheDir, 'pending', stubName)), 'the installer downloaded with no click');
  expect(badgeSamples.length > 0 && badgeSamples.every((t) => t === 'Restart to update'), `the badge showed nothing until the build was ready (${[...new Set(badgeSamples)].join(', ') || 'no samples'})`);

  // The unattended route's `--download` (M9 fix 271) on a window already
  // ready: it relays no click, exits 0 and ends on ready, never printing
  // a frozen 0% or null (M9 fix 296). It passes on the old code too; it
  // is a read that the route still works, not a proof of fix 625.
  const download = await emerald('update', '--download');
  log(`emmer update --download printed: ${download.stdout.trim().split(/\r?\n/).join(' | ')}${download.stderr.trim() === '' ? '' : ` (stderr: ${download.stderr.trim()})`}`);
  expect(download.status === 0 && lastLine(download) === `${version} installed, ${stub} ready`, `emmer update --download ends on "${lastLine(download)}"`);
  expect(!download.stdout.includes('downloading 0%') && !download.stdout.includes('null'), `emmer update --download never printed a frozen 0% or null (${download.stdout.trim().replace(/\s+/g, ' ')})`);
  // M9 fix 328: the badge sheens while downloading so a slow download
  // does not read as a stall. The differential download lands inside
  // one poll of the CLI, so the phase cannot be sampled mid-download;
  // it is set by hand instead, then set back.
  await s.evalJs(`document.querySelector('.title-bar-update').dataset.phase = 'downloading'`);
  const sheenOn = await s.evalJs(`getComputedStyle(document.querySelector('.title-bar-update'), '::after').animationName`);
  expect(sheenOn === 'turn-band', `the badge sheens while downloading (animationName ${sheenOn})`);
  await s.evalJs(`document.querySelector('.title-bar-update').dataset.phase = 'ready'`);
  const sheenOff = await s.evalJs(`getComputedStyle(document.querySelector('.title-bar-update'), '::after').animationName`);
  expect(sheenOff === 'none', `the sheen stops once the phase is back to ready (animationName ${sheenOff})`);
  const after = await emerald('update', '--json');
  let afterState = null;
  try {
    afterState = JSON.parse(after.stdout);
  } catch {
    afterState = null;
  }
  expect(after.status === 0 && afterState?.state?.phase === 'ready' && afterState.state.latest === stub && afterState.apps === 1, `emmer update --json reads ready for ${stub} with one window (${after.stdout.trim().replace(/\s+/g, ' ')})`);
  const daemonLog = fs.readFileSync(path.join(home, 'logs', 'emmerd.log'), 'utf8');
  // M9 fix 625: no click may be relayed at all now, so only the state is
  // read; the relay stays covered by pipe-server.test.ts and update.test.ts.
  expect(daemonLog.includes(`update: ${version} installed, ${stub} ready`), "the daemon's log has the ready state");
  expect(/daemon stops/.test(ready.title) && /Resume/.test(ready.title), `its tooltip says what the restart does to the panes (${ready.title})`);
  expect(requests.some((r) => new RegExp(`^GET /${stubName.replace(/\./g, '\\.')} 20[06]`).test(r)), `the feed served the installer (${requests.filter((r) => !r.startsWith('GET /latest.yml')).join('; ')})`);
  const pendingFile = path.join(cacheDir, 'pending', stubName);
  expect(fs.existsSync(pendingFile), `the installer landed in the updater's cache at ${pendingFile}`);
  expect(sha512(pendingFile) === hash, "the cached installer has the manifest's sha512");
  const info = JSON.parse(fs.readFileSync(path.join(cacheDir, 'pending', 'update-info.json'), 'utf8'));
  expect(info.fileName === stubName && info.sha512 === hash, `update-info.json names it (${JSON.stringify(info)})`);
  await s.screenshot('install-update-ready.png');

  // The stamp of the first launch: written on a home without one, and
  // the hooks install runs only from a stamp of another version.
  const stamp = JSON.parse(fs.readFileSync(path.join(home, 'installed.json'), 'utf8'));
  expect(stamp.version === version, `installed.json stamped ${stamp.version} on the fresh home`);
  expect(!appLogs.join('').includes('running emmer hooks install'), 'no hooks install on a home with no stamp');

  const daemon = readDaemonInfo();
  expect(daemon !== null && daemon.pipe === pipe, 'the app autostarted a daemon on the private pipe');

  // M9 fix 323: the click itself (the second click before M9 fix 625,
  // the one click since), with the pending installer
  // removed first so nothing installs: electron-updater spawns the
  // cached file, gets ENOENT, tries shell.openPath on the missing path
  // (nothing) and quits the app, which is the exit waited on below. The
  // click writes the marker, has the install's word posted from outside
  // the install folder (a PowerShell script under the home, whose spawn
  // a harness window holds and says so) and stops the daemon, in that
  // order.
  fs.rmSync(pendingFile, { force: true });
  const posterFile = path.join(home, 'install-poster.ps1');
  fs.rmSync(posterFile, { force: true });
  const mainLogFile = path.join(home, 'logs', 'main.log');
  const readMainLog = () => {
    try {
      return fs.readFileSync(mainLogFile, 'utf8');
    } catch {
      return '';
    }
  };
  s.evalJs(`window.emerald.update.act()`).catch(() => {});
  await until('the poster held in the main log', () => readMainLog().includes('install poster held (harness)'), 15000);
  const clickLog = readMainLog();
  const heldAt = clickLog.indexOf('install poster held (harness)');
  const stopAt = clickLog.indexOf('updater: restart to install: stopping the daemon first');
  expect(stopAt > heldAt, 'the word is posted before the daemon is asked to stop');
  expect(!clickLog.includes('install poster spawned'), 'no poster spawned under the harness window');
  const poster = fs.readFileSync(posterFile, 'utf8');
  expect(poster.includes(`<text>Installing emerald ${stub}</text>`) && poster.includes('CreateToastNotifier($aumid).Show($toast)') && poster.includes('Start-Sleep -Seconds 90'), `the poster script under the home names ${stub}, shows a toast and holds 90 s`);
  expect(poster.includes("'electron.app.Emerald'") && !/Programs\\emerald|emerald\.exe/i.test(poster), "it runs under the app's AUMID and names nothing under the install folder");
  const clickMarker = JSON.parse(fs.readFileSync(path.join(home, 'installing.json'), 'utf8'));
  expect(clickMarker.version === stub, `the click left installing.json at ${clickMarker.version}`);
  s.close();
  // The exit after a download took 8 s once and past 30 s twice on a
  // loaded box (Defender reads the 118 MB it just wrote), so the wait is
  // long.
  await until('app exited', () => powershell(`(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue) -eq $null`) === 'True', 90000);
  child = null;
  expect(readMainLog().includes('updater: running the installer silently and relaunching'), 'the click reached the install step and the app quit on its own');
  const r = spawnSync('cmd.exe', ['/d', '/c', shim, 'daemon', 'stop'], { env, encoding: 'utf8', windowsHide: true });
  expect(r.status === 0 && /^emmerd is not running/.test(r.stdout), `the click stopped the daemon; daemon stop through the shim reads: ${r.stdout.trim()}`);
  // The stub feed closes before the gap launches (M9 fix 625): the
  // second of them comes up and runs its launch check, and a feed still
  // serving the stub would have that check download it on its own into
  // pending\, replacing the folder the sweep step reads.
  await feed.close();
  feed = null;
  await gapLaunches(env, stub);
  // The download put this build's blockmap at the private cache's root
  // (electron-updater copies it up from pending\ for the next
  // differential download); under the user's cache that was the
  // installed build's blockmap overwritten (M9 fix 259).
  expect(fs.existsSync(path.join(cacheDir, 'current.blockmap')), "the download left the build's blockmap at the private cache's root");
  cleanCache();
  expect(!fs.existsSync(cacheDir), 'the private updater cache is removed whole');
  const userCacheRootAfter = listUserCacheRoot();
  log(`the user's cache root before: [${userCacheRootBefore}]; after: [${userCacheRootAfter}]`);
  expect(userCacheRootAfter === userCacheRootBefore, `the user's ${userCacheDir} reads as before the run (M9 fix 330)`);
  log('updater half PASS');
}

// M9 fix 282: the launch in the install's gap. The second click writes
// installing.json before the daemon stops (updater.test.ts reads that
// order); here the marker is written by hand, one version ahead as the
// click would, and the packed build launched on the same home. It must
// post `Still installing`, start no daemon and exit with no window; the
// marker stays for the next launch in the gap. Then the marker at the
// build's own version, the new build's first launch: removed, and the
// window comes up.
//
// M9 fix 408: that word went through the app's own notifier and was read
// here off EMERALD_NOTIFY_LOG, and no install ever showed it, since the
// installer kills this exe before the toast's show event lands. It goes
// through the install poster's worker now, so what is read here is the
// gap-poster.ps1 the launch wrote under the home: the same two lines, a
// hold of the seconds the body names, and the `install-gap poster held
// (harness)` line in main.log. Held is all a harness run can prove; the
// spawn itself is the next real install's eye, through install-check.
// The notification log is still set, to read that the in-app post is
// gone: one toast, from the worker.
async function gapLaunches(env, stub) {
  const marker = path.join(home, 'installing.json');
  const notifyLog = path.join(home, 'notify.log');
  const mainLog = path.join(home, 'logs', 'main.log');
  const gapScript = path.join(home, 'gap-poster.ps1');
  const gapWorker = path.join(home, 'gap-poster.js');
  const installScript = path.join(home, 'install-poster.ps1');
  fs.rmSync(path.join(home, 'daemon.json'), { force: true });
  fs.rmSync(notifyLog, { force: true });
  fs.rmSync(gapScript, { force: true });
  fs.rmSync(gapWorker, { force: true });
  // The install poster's own script is still on disk from the click
  // above; a gap launch must not write over it (M9 fix 408).
  const installScriptBefore = fs.existsSync(installScript) ? fs.readFileSync(installScript, 'utf8') : null;
  const mainLogBefore = fs.readFileSync(mainLog, 'utf8');
  fs.writeFileSync(marker, JSON.stringify({ version: stub, at: new Date(Date.now() - 20000).toISOString() }) + '\n');
  const gapEnv = { ...env, EMERALD_NOTIFY_LOG: notifyLog };
  const gap = spawn(exe, [`--user-data-dir=${path.join(home, 'electron-profile')}`], { env: gapEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  child = gap;
  const gapOut = [];
  gap.stdout.on('data', (d) => gapOut.push(d.toString()));
  gap.stderr.on('data', (d) => gapOut.push(d.toString()));
  const exit = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 30000);
    gap.on('exit', (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
  child = null;
  expect(exit !== null, `a launch in the gap exits on its own (code ${exit})`);
  const gapText = fs.existsSync(gapScript) ? fs.readFileSync(gapScript, 'utf8') : '';
  const gapBodySec = /<text>About (\d0) s to go; the window comes back on its own\.<\/text>/.exec(gapText)?.[1] ?? null;
  expect(gapText.includes(`<text>Still installing emerald ${stub}</text>`) && gapBodySec !== null, `the gap wrote gap-poster.ps1 with the install's word: ${gapBodySec === null ? gapText.slice(0, 120) || 'no script' : `Still installing emerald ${stub} / About ${gapBodySec} s to go`}`);
  const gapHoldSec = /Start-Sleep -Seconds (\d+)\r?\n?$/.exec(gapText)?.[1] ?? null;
  expect(gapHoldSec !== null && gapHoldSec === gapBodySec, `and holds for the seconds it says are left (${gapHoldSec ?? 'no hold'} s against ${gapBodySec ?? 'no body'} s)`);
  expect(fs.existsSync(gapWorker) && fs.readFileSync(gapWorker, 'utf8').includes('spawnSync(exe,'), 'and wrote gap-poster.js, the worker that outlives this exe');
  expect(installScriptBefore === null || fs.readFileSync(installScript, 'utf8') === installScriptBefore, "and left the install poster's own script as it was");
  let lines = [];
  try {
    lines = fs.readFileSync(notifyLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    lines = [];
  }
  const notice = lines.find((l) => l.sessionId === 'update') ?? null;
  expect(notice === null, `the in-app post is gone, one toast from the worker alone (${notice === null ? 'nothing posted' : `${notice.title}: ${notice.body}`})`);
  const gapLogLines = fs.readFileSync(mainLog, 'utf8').slice(mainLogBefore.length);
  expect(gapLogLines.includes('install-gap poster held (harness)'), 'the main log says the gap poster was held under the harness window');
  expect(!gapLogLines.includes('install-gap poster spawned') && !/install-gap toast (shown|not shown|failed|not posted)/.test(gapLogLines), 'nothing spawned under the harness, and the six-second wait on the app toast is gone');
  expect(!fs.existsSync(path.join(home, 'daemon.json')), 'and starts no daemon');
  expect(fs.existsSync(marker), 'and leaves the marker for the next launch in the gap');
  expect(!gapOut.join('').includes('connected to emmerd') && fs.readFileSync(mainLog, 'utf8').includes(`launched while ${stub} is installing`), 'the main log says it quit for the install');

  // The new build's first launch: the marker names this version.
  fs.writeFileSync(marker, JSON.stringify({ version, at: new Date().toISOString() }) + '\n');
  // M9 fix 371: that launch is also the one after an install, so the
  // home's stamp is set one version behind and the private cache's
  // pending\ is made to look as the installer of this build leaves it
  // (update-info.json naming this build's installer beside a stand-in
  // for the 118 MB file, the root's installer.exe the NSIS installer
  // copies there); the launch must remove pending\ whole and leave the
  // root's two files. The run's own download proof above ran on a stamp
  // at this version, so it never met the sweep.
  const pendingDir = path.join(cacheDir, 'pending');
  const thisInstaller = `Emerald-setup-${version}-arm64.exe`;
  fs.mkdirSync(pendingDir, { recursive: true });
  fs.writeFileSync(path.join(pendingDir, 'update-info.json'), JSON.stringify({ fileName: thisInstaller, sha512: 'stand-in', isAdminRightsRequired: false }));
  fs.writeFileSync(path.join(pendingDir, thisInstaller), Buffer.alloc(2 * 1024 * 1024));
  fs.writeFileSync(path.join(cacheDir, 'installer.exe'), 'stand-in');
  // The folder's size as the log line will say it: the stand-in, the
  // info file and the blockmap the download left in pending too.
  const pendingMb = (fs.readdirSync(pendingDir).reduce((sum, name) => sum + fs.statSync(path.join(pendingDir, name)).size, 0) / (1024 * 1024)).toFixed(1);
  expect(fs.existsSync(path.join(cacheDir, 'current.blockmap')), "the download left this build's blockmap at the cache's root before the sweep");
  const prior = priorVersion();
  fs.writeFileSync(path.join(home, 'installed.json'), JSON.stringify({ version: prior, at: new Date().toISOString() }) + '\n');
  // M9 fix 384: the install's own shape, the installer that started the
  // window still holding its exe when the sweep first runs. A PowerShell
  // child keeps the stand-in open with no sharing for the first
  // attempt's length and is killed once the main log says the attempt
  // failed, so the retry (its delay set short for the run) is what
  // removes the folder. The first attempt logs `could not remove`, the
  // retry `removed`, and the gate (update-info.json) is still there
  // between the two.
  const heldExe = path.join(pendingDir, thisInstaller);
  holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$f = [IO.File]::Open('${heldExe.replace(/'/g, "''")}', 'Open', 'Read', 'None'); Start-Sleep -Seconds 120`], { stdio: 'ignore', windowsHide: true });
  // Held with no sharing, so even a read open is refused.
  await until('the hold on the stand-in installer', () => {
    try {
      fs.closeSync(fs.openSync(heldExe, 'r'));
      return false;
    } catch {
      return true;
    }
  }, 15000);
  const sweepRetryMs = 10000;
  const launchEnv = { ...env, EMERALD_SWEEP_RETRY_MS: String(sweepRetryMs) };
  const port = freshPort();
  child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(home, 'electron-profile')}`], { env: launchEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  child.stdout.on('data', (d) => appLogs.push(d.toString()));
  child.stderr.on('data', (d) => appLogs.push(d.toString()));
  let pages = [];
  await until('a page target from the fresh launch', async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
      pages = (await res.json()).filter((p) => p.type === 'page' && !p.url.startsWith('about:'));
    } catch {
      pages = [];
    }
    return pages.length > 0;
  }, 20000);
  const s = await connect(pages[0].webSocketDebuggerUrl);
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await s.waitFor(`!!document.querySelector('.title-bar')`, 'the title row', 20000);
  expect(!fs.existsSync(marker), `a launch with the marker at its own version (${version}) removes it and comes up`);
  expect(fs.readFileSync(mainLog, 'utf8').includes(`installing.json (${version} at `), 'the main log says the marker was spent');
  // M9 fix 384: the sweep runs behind the daemon's connected, meets the
  // held exe, leaves the gate in place and says it will retry.
  await until('the first sweep attempt', () => /updater cache: could not remove pending /.test(fs.readFileSync(mainLog, 'utf8')), 25000);
  const firstSweep = fs.readFileSync(mainLog, 'utf8').match(/updater cache: could not remove pending .*/)?.[0] ?? '';
  expect(firstSweep.startsWith(`updater cache: could not remove pending ${version} at launch: `) && /EPERM|EBUSY/.test(firstSweep), `the sweep at launch met the held installer: ${firstSweep}`);
  expect(fs.readFileSync(mainLog, 'utf8').includes(`updater cache: retrying the sweep in ${sweepRetryMs / 1000} s`), 'and says it will retry');
  expect(fs.existsSync(path.join(pendingDir, 'update-info.json')) && fs.existsSync(heldExe), 'the failed attempt left update-info.json and the installer, the gate intact');
  expect(fs.readFileSync(mainLog, 'utf8').indexOf('connected to emmerd') < fs.readFileSync(mainLog, 'utf8').indexOf('updater cache: could not remove'), 'the sweep ran after the daemon connected');
  holder.kill();
  holder = null;
  await until('the hold released', () => {
    try {
      fs.closeSync(fs.openSync(heldExe, 'r+'));
      return true;
    } catch {
      return false;
    }
  }, 10000);
  await until('the retry', () => /updater cache: (removed|could not remove) pending .* on the retry/.test(fs.readFileSync(mainLog, 'utf8')), sweepRetryMs + 15000);
  expect(!fs.existsSync(pendingDir), `the retry removed ${pendingDir} whole`);
  expect(fs.existsSync(path.join(cacheDir, 'installer.exe')) && fs.existsSync(path.join(cacheDir, 'current.blockmap')), "and left the cache root's installer.exe and current.blockmap");
  const sweepLine = fs.readFileSync(mainLog, 'utf8').match(/updater cache: removed pending .*/)?.[0] ?? null;
  expect(sweepLine === `updater cache: removed pending ${version}, ${pendingMb} MB on the retry`, `the main log says so: ${sweepLine ?? 'no line'}`);
  expect(fs.readFileSync(mainLog, 'utf8').includes(`first launch of ${version} after ${prior}: running emmer hooks install`), `the launch read the stamp as ${prior} and ran the hooks install`);
  await until('the hooks install to exit', () => /emmer hooks install exited \d+/.test(fs.readFileSync(mainLog, 'utf8')), 20000);
  expect(fs.readFileSync(mainLog, 'utf8').includes('emmer hooks install exited 0, settings changed'), 'the hooks install exited 0 and changed the private settings file');
  // M9 fix 386: what that install wrote, the one path where the wrappers
  // are rendered with the installed Emerald.exe rather than a dev node.
  // The settings file is the run's private CLAUDE_SETTINGS, the hooks
  // folder under the private home, the skill beside the settings file.
  const settingsFile = env.CLAUDE_SETTINGS;
  const hooksDir = path.join(home, 'hooks');
  const hookCmd = path.join(hooksDir, 'claude-hook.cmd');
  const forward = (p) => p.replace(/\\/g, '/');
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  const hookOf = (group) => (Array.isArray(group?.hooks) ? group.hooks : []).find((h) => typeof h?.command === 'string' && h.command === `"${forward(hookCmd)}"`);
  const eventsWithout = HOOK_EVENTS.filter((event) => !(Array.isArray(settings.hooks?.[event]) && settings.hooks[event].some((g) => hookOf(g) !== undefined)));
  expect(HOOK_EVENTS.length > 0 && eventsWithout.length === 0, `every one of the ${HOOK_EVENTS.length} hook events has a group whose command is "${forward(hookCmd)}"${eventsWithout.length > 0 ? ` (missing: ${eventsWithout.join(', ')})` : ''}`);
  expect(typeof settings.statusLine?.command === 'string' && settings.statusLine.command.includes('claude-statusline.cmd'), `statusLine.command names claude-statusline.cmd (${JSON.stringify(settings.statusLine)})`);
  const wrappers = ['claude-hook.cmd', 'claude-statusline.cmd', 'claude-statusline.js'].map((name) => path.join(hooksDir, name));
  const skillFile = path.join(path.dirname(settingsFile), 'skills', 'emmer-cli', 'SKILL.md');
  const absent = [...wrappers, skillFile].filter((p) => !fs.existsSync(p));
  expect(absent.length === 0, `the three scripts and the skill exist under the home${absent.length > 0 ? ` (missing: ${absent.join(', ')})` : ''}`);
  const statusCmd = fs.readFileSync(path.join(hooksDir, 'claude-statusline.cmd'), 'utf8');
  const hookCmdText = fs.readFileSync(hookCmd, 'utf8');
  expect(statusCmd.includes(`"${exe}"`), `claude-statusline.cmd runs the packed Emerald.exe as node (${statusCmd.match(/^"[^"]+"/m)?.[0] ?? 'no exe line'})`);
  expect(!statusCmd.includes('__EMERALD_NODE__') && !hookCmdText.includes('__EMERALD_NODE__'), 'no __EMERALD_NODE__ placeholder is left in either wrapper');
  const hooksStatus = spawnSync('cmd.exe', ['/d', '/c', shim, 'hooks', 'status', '--json'], { env, encoding: 'utf8', windowsHide: true });
  let hooksJson = null;
  try {
    hooksJson = JSON.parse(hooksStatus.stdout);
  } catch {
    hooksJson = null;
  }
  expect(hooksStatus.status === 0 && hooksJson?.complete === true && Array.isArray(hooksJson.missing) && hooksJson.missing.length === 0, `emmer hooks status --json through the installed shim reads complete with nothing missing (exit ${hooksStatus.status}: ${(hooksStatus.stdout || hooksStatus.stderr).trim().replace(/\s+/g, ' ').slice(0, 300)})`);
  const stampAfter = JSON.parse(fs.readFileSync(path.join(home, 'installed.json'), 'utf8'));
  expect(stampAfter.version === version, `installed.json is stamped ${stampAfter.version} again`);
  await until("the fresh launch's daemon", () => readDaemonInfo() !== null, 20000);
  // M9 fix 631: closed the way a person closes the window, so the quit
  // runs through window-all-closed and a hang names its holders.
  const closeLogSize = fs.existsSync(mainLog) ? fs.statSync(mainLog).size : 0;
  await s.send('Page.close').catch(() => {});
  s.close();
  await until('app exited', () => powershell(`(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue) -eq $null`) === 'True', 90000).catch((err) => {
    const since = fs.existsSync(mainLog) ? fs.readFileSync(mainLog, 'utf8').slice(closeLogSize) : '';
    const line = since.split(/\r?\n/).filter((l) => l.includes('window-all-closed; active resources:')).pop();
    log(`the window's exit timed out; main log since the close: ${line ?? 'no window-all-closed line'}`);
    const list = powershell(`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Emerald.exe' -and $_.ExecutablePath -eq '${exe}' } | ForEach-Object { 'pid ' + $_.ProcessId + ' started ' + $_.CreationDate.ToString('HH:mm:ss.fff') + ': ' + $_.CommandLine }`).split(/\r?\n/).filter(Boolean).join('; ');
    log(`Emerald.exe under ${exe}: ${list || 'none'}`);
    throw err;
  });
  child = null;
  const r = spawnSync('cmd.exe', ['/d', '/c', shim, 'daemon', 'stop'], { env, encoding: 'utf8', windowsHide: true });
  expect(r.status === 0 && /^stopped emmerd/.test(r.stdout), `daemon stop after the fresh launch: ${r.stdout.trim()}`);
}

async function installHalf() {
  expect(fs.existsSync(setup), `${setup} exists (run npm run dist -w @emerald/app first)`);
  expect(powershell(`(Get-Process -Name emerald -ErrorAction SilentlyContinue).Count`) === '0' || powershell(`(Get-Process -Name emerald -ErrorAction SilentlyContinue).Count`) === '', 'no Emerald.exe running');
  expect(!fs.existsSync(installDir), `${installDir} does not exist before the install`);
  const before = userPath();
  expect(!hasBinEntry(before), `user PATH (${before.kind}, ${before.entries.length} entries) has no emerald entry before the install`);
  const openersBefore = { md: openWithProgids('md'), json: openWithProgids('json') };
  // M9 fix 381: the classic default as the box has it before the install,
  // whatever it names (another opener's ProgId, or nothing), to read
  // back untouched after.
  const defaultsBefore = { md: classicDefault('md'), json: classicDefault('json') };
  log(`classic defaults before the install: .md ${defaultsBefore.md ?? '(none)'}, .json ${defaultsBefore.json ?? '(none)'}`);
  const entries = nshOpenWith();
  expect(entries.length === 2 && entries.map((e) => e.ext).join(',') === 'md,json', `build/installer.nsh names two Open with entries (${entries.map((e) => `.${e.ext} as ${e.progId}`).join(', ')})`);

  // M9 fix 630: the install half's own private pair and Claude settings,
  // since updaterHalf's env is its own local. The uninstaller runs
  // `emmer hooks uninstall`, which would strip the real ~/.claude settings
  // of the real ~/.emerald hooks under the wrong environment, so the pair
  // and CLAUDE_SETTINGS travel together into every installer and
  // uninstaller spawn. Wiped whole first: a rerun on a used home starts on
  // the last run's files.
  const installHome = path.join(home, 'install-half');
  fs.rmSync(installHome, { recursive: true, force: true });
  fs.mkdirSync(installHome, { recursive: true });
  const installEnv = { ...process.env, EMERALD_HOME: installHome, EMERALD_PIPE: '\\\\.\\pipe\\emmerd-verify-install-half', CLAUDE_SETTINGS: path.join(installHome, 'claude-settings.json') };
  const forward = (p) => p.replace(/\\/g, '/');
  const privateHookCmd = path.join(installHome, 'hooks', 'claude-hook.cmd');
  // The events whose groups in the private settings hold a command that is
  // exactly the private hook script, the hookOf shape of the updater half.
  const privateHeld = () => {
    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(installEnv.CLAUDE_SETTINGS, 'utf8'));
    } catch {
      settings = {};
    }
    const held = HOOK_EVENTS.filter((event) => Array.isArray(settings.hooks?.[event]) && settings.hooks[event].some((g) => (Array.isArray(g?.hooks) ? g.hooks : []).some((h) => typeof h?.command === 'string' && h.command === `"${forward(privateHookCmd)}"`)));
    return { settings, held };
  };
  // The person's real Claude settings, read before anything runs and
  // again after the uninstall: its sha256 (or `absent`) and its count of
  // hook commands naming the real ~/.emerald hook script, compared as
  // isOurs compares (forward-slashed, lower-cased).
  const realSettings = path.join(process.env['CLAUDE_CONFIG_DIR']?.trim() || path.join(os.homedir(), '.claude'), 'settings.json');
  const realHookScript = forward(path.join(os.homedir(), '.emerald', 'hooks', 'claude-hook.cmd')).toLowerCase();
  const readReal = () => {
    if (!fs.existsSync(realSettings)) return { sha: 'absent', count: 0 };
    const bytes = fs.readFileSync(realSettings);
    let count = 0;
    try {
      const s = JSON.parse(bytes.toString('utf8'));
      for (const groups of Object.values(s.hooks ?? {})) {
        for (const g of Array.isArray(groups) ? groups : []) {
          for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
            if (typeof h?.command === 'string' && forward(h.command).toLowerCase().includes(realHookScript)) count += 1;
          }
        }
      }
    } catch {
      count = 0;
    }
    return { sha: crypto.createHash('sha256').update(bytes).digest('hex'), count };
  };
  const realBefore = readReal();
  const realCopy = path.join(installHome, 'real-settings-before.json');
  if (fs.existsSync(realSettings)) fs.copyFileSync(realSettings, realCopy);
  log(`real settings before the install: ${realSettings}, sha256 ${realBefore.sha.slice(0, 12)}, ${realBefore.count} Emerald entries`);

  log('running the installer silently (a per-user install, then an uninstall at the end)');
  const inst = spawnSync(setup, ['/S'], { env: installEnv, windowsHide: true });
  expect(inst.status === 0, `installer exited ${inst.status}`);
  expect(fs.existsSync(path.join(installDir, 'Emerald.exe')), 'Emerald.exe installed');
  expect(fs.existsSync(path.join(installDir, 'resources', 'daemon', 'dist', 'main.js')), 'resources/daemon installed');
  expect(fs.existsSync(path.join(installDir, 'resources', 'node_modules', 'node-pty', 'prebuilds', 'win32-arm64', 'conpty.node')), 'resources/node_modules/node-pty installed');
  expect(fs.existsSync(path.join(binDir, 'emmer.cmd')), 'resources/bin/emmer.cmd installed');
  expect(fs.existsSync(path.join(installDir, 'resources', 'app-update.yml')), 'resources/app-update.yml installed (M9 fix 239)');

  const after = userPath();
  expect(after.kind === before.kind, `user PATH kept its registry kind (${after.kind})`);
  expect(hasBinEntry(after), 'user PATH gained resources\\bin');
  expect(after.entries.length === before.entries.length + 1 && before.entries.every((e, i) => after.entries[i] === e), 'the other PATH entries are untouched and unexpanded');

  const fresh = freshPath();
  const r = spawnSync('cmd.exe', ['/d', '/c', 'emmer', '--version'], { env: { ...process.env, PATH: fresh, Path: fresh }, encoding: 'utf8', windowsHide: true });
  expect(r.status === 0 && r.stdout.trim() === version, `a fresh cmd finds emerald on PATH and gets ${r.stdout.trim()}`);
  const where = spawnSync('cmd.exe', ['/d', '/c', 'where', 'emmer'], { env: { ...process.env, PATH: fresh, Path: fresh }, encoding: 'utf8', windowsHide: true });
  expect(where.stdout.trim().toLowerCase() === path.join(binDir, 'emmer.cmd').toLowerCase(), `where emerald -> ${where.stdout.trim()}`);
  // M9 fix 342: the install registered emerald as an opener for .md and
  // .json under the per-user hive, one new ProgId per extension whose
  // open command runs the installed exe with the file; the uninstall
  // takes both away.
  const openersAdded = {};
  for (const ext of ['md', 'json']) {
    const now = openWithProgids(ext);
    const added = now.filter((n) => !openersBefore[ext].includes(n));
    expect(added.length === 1, `.${ext} gained one OpenWithProgids entry (${JSON.stringify(added)}, all ${JSON.stringify(now)})`);
    openersAdded[ext] = added[0];
    expect(added[0] === entries.find((e) => e.ext === ext)?.progId, `and it is the ProgId build/installer.nsh names (${added[0]})`);
    const command = progIdCommand(added[0]);
    expect(command !== null && command.toLowerCase().includes(path.join(installDir, 'Emerald.exe').toLowerCase()) && command.includes('"%1"'), `${added[0]} opens with the installed Emerald.exe and the file (${command})`);
    const icon = progIdIcon(added[0]);
    expect(icon !== null && icon.toLowerCase() === path.join(installDir, 'resources', 'icon.ico').toLowerCase() && fs.existsSync(icon), `${added[0]}'s DefaultIcon is the installed resources\\icon.ico (${icon})`);
    // M9 fix 381: the install wrote no classic default; whatever the box
    // had there is still there, a ProgId of another opener or nothing.
    const def = classicDefault(ext);
    expect(def === defaultsBefore[ext], `.${ext}'s classic default is untouched by the install (${def ?? '(none)'})`);
  }
  log(`openers registered: .md as ${openersAdded.md}, .json as ${openersAdded.json}`);
  const uninstallExe = path.join(installDir, 'Uninstall Emerald.exe');
  expect(fs.existsSync(uninstallExe), 'uninstaller present');

  // M9 fix 630 (a): the hooks into the private settings through the
  // installed shim, so the uninstall below has something of ours to take.
  const hooksIn = spawnSync('cmd.exe', ['/d', '/c', path.join(binDir, 'emmer.cmd'), 'hooks', 'install', '--json'], { env: installEnv, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  log(`emmer hooks install --json through the installed shim: exit ${hooksIn.status}, ${(hooksIn.stdout || hooksIn.stderr || '').trim().replace(/\s+/g, ' ').slice(0, 300)}`);
  expect(privateHeld().held.length === HOOK_EVENTS.length, `emmer hooks install through the installed shim wrote all ${HOOK_EVENTS.length} hooks into the private settings`);
  // (b) an install over the install, which runs this build's own
  // uninstaller with --updated: the hooks call sits inside the guard, so
  // nothing of ours goes. This passes on a build with no call at all; it
  // fails only if the call sits outside the guard, which is what it is for.
  log("installing over the install (this build's uninstaller under --updated)");
  const again = spawnSync(setup, ['/S'], { env: installEnv, windowsHide: true });
  expect(again.status === 0, `the second installer exited ${again.status}`);
  expect(privateHeld().held.length === HOOK_EVENTS.length, `an install over the install (this build's uninstaller under --updated) left all ${HOOK_EVENTS.length} hooks in place`);
  expect(fs.existsSync(path.join(installDir, 'Emerald.exe')), 'Emerald.exe installed again');

  log('running the uninstaller silently');
  // NSIS uninstallers copy themselves to %TEMP% and return at once, so wait
  // for the directory to go rather than for the process.
  const un = spawnSync(uninstallExe, ['/S'], { env: installEnv, windowsHide: true });
  expect(un.status === 0, `uninstaller exited ${un.status}`);
  await until('install directory removed', () => !fs.existsSync(path.join(installDir, 'Emerald.exe')), 60000);
  expect(true, 'Emerald.exe removed');
  // (c) the real settings first, then the private ones.
  const realAfter = readReal();
  const realSame = realAfter.sha === realBefore.sha && realAfter.count === realBefore.count;
  expect(
    realSame,
    realSame
      ? `the uninstaller left ${realSettings} as it was (sha256 ${realBefore.sha.slice(0, 12)}, ${realBefore.count} Emerald entries)`
      : `${realSettings} changed under the uninstall: sha256 ${realBefore.sha.slice(0, 12)} to ${realAfter.sha.slice(0, 12)}, Emerald entries ${realBefore.count} to ${realAfter.count}; the copy from before is ${fs.existsSync(realCopy) ? realCopy : '(none, the file was absent)'}. Stop: do not rerun, report`,
  );
  const privateAfter = privateHeld();
  const statusLeft = typeof privateAfter.settings.statusLine?.command === 'string' && privateAfter.settings.statusLine.command.includes('claude-statusline.cmd');
  expect(
    privateAfter.held.length === 0 && !statusLeft && !fs.existsSync(privateHookCmd),
    `the uninstaller took Emerald's hooks out of the private settings (${privateAfter.held.length} of ${HOOK_EVENTS.length} events still hold one${statusLeft ? '; the statusLine still names claude-statusline.cmd' : ''}${fs.existsSync(privateHookCmd) ? `; ${privateHookCmd} is still there` : ''})`,
  );
  const cleaned = userPath();
  expect(!hasBinEntry(cleaned), 'user PATH entry removed by the uninstaller');
  expect(cleaned.kind === before.kind && cleaned.entries.join(';') === before.entries.join(';'), 'user PATH is back to what it was');
  for (const ext of ['md', 'json']) {
    expect(!openWithProgids(ext).includes(openersAdded[ext]), `.${ext}'s OpenWithProgids entry ${openersAdded[ext]} removed by the uninstaller`);
    expect(progIdCommand(openersAdded[ext]) === null, `the ${openersAdded[ext]} ProgId is gone`);
    // M9 fix 381: a classic default that named our ProgId (left by the
    // fileAssociations installer of fixes 342 to 371) is cleared by the
    // uninstall; any other is left as it was.
    const def = classicDefault(ext);
    const expected = defaultsBefore[ext] === openersAdded[ext] ? null : defaultsBefore[ext];
    expect(def === expected, `.${ext}'s classic default after the uninstall is ${def ?? '(none)'}${defaultsBefore[ext] === openersAdded[ext] ? ' (it named ours before, cleared)' : ' (as before)'}`);
  }
  log('install half PASS');
}

// M9 fix 382: the live install read whole, nothing installed or removed.
async function entriesRead() {
  const entries = nshOpenWith();
  expect(entries.length === 2 && entries.map((e) => e.ext).join(',') === 'md,json', `build/installer.nsh names two Open with entries (${entries.map((e) => `.${e.ext} as ${e.progId}`).join(', ')})`);
  const yml = fs.readFileSync(path.join(appDir, 'electron-builder.yml'), 'utf8');
  expect(!/^\s*fileAssociations:/m.test(yml), 'electron-builder.yml has no fileAssociations block (the entries are installer.nsh\'s)');
  expect(/^\s*- from: build\/icon\.ico\n\s*to: icon\.ico$/m.test(yml), 'and carries build/icon.ico to resources/icon.ico');

  expect(fs.existsSync(path.join(installDir, 'Emerald.exe')), `${installDir}\\Emerald.exe is installed`);
  for (const rel of ['resources\\daemon\\dist\\main.js', 'resources\\node_modules\\node-pty\\prebuilds\\win32-arm64\\conpty.node', 'resources\\bin\\emmer.cmd', 'resources\\app-update.yml', 'resources\\icon.ico', 'resources\\WHATS-NEW.md', 'Uninstall Emerald.exe']) {
    expect(fs.existsSync(path.join(installDir, rel)), `${rel} is installed`);
  }
  const icon = readIco(fs.readFileSync(path.join(installDir, 'resources', 'icon.ico')));
  expect(icon.map((e) => e.width).join(',') === '16,24,32,48,256' && icon.every((e) => e.pngWidth === e.width && e.pngHeight === e.height), `the installed resources\icon.ico holds the five gem images (M9 fix 571), got ${JSON.stringify(icon.map((e) => [e.width, e.pngWidth]))}`);
  // The version two ways, printed: the staged CLI's package.json (the app's
  // own sits inside app.asar) and the shim's answer.
  let staged = null;
  try {
    staged = JSON.parse(fs.readFileSync(path.join(installDir, 'resources', 'cli', 'package.json'), 'utf8')).version ?? null;
  } catch {
    staged = null;
  }
  const r = spawnSync('cmd.exe', ['/d', '/c', path.join(binDir, 'emmer.cmd'), '--version'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const said = (r.stdout ?? '').trim();
  log(`installed version: ${staged ?? '(no resources\\cli\\package.json)'} by the staged CLI's package.json, ${said === '' ? `(nothing; exit ${r.status})` : said} by emmer --version through the installed shim; this checkout is ${version}`);
  expect(staged !== null && said === staged, 'the two agree');

  const p = userPath();
  expect(hasBinEntry(p), `user PATH (${p.kind}, ${p.entries.length} entries) holds resources\\bin`);
  expect(p.entries.filter((e) => e.replace(/\\$/, '').toLowerCase() === binDir.toLowerCase()).length === 1, 'once');
  expect(p.kind === 'ExpandString' || p.kind === 'String', `and its registry kind is ${p.kind}`);
  const fresh = freshPath();
  const where = spawnSync('cmd.exe', ['/d', '/c', 'where', 'emmer'], { env: { ...process.env, PATH: fresh, Path: fresh }, encoding: 'utf8', windowsHide: true });
  expect(where.stdout.trim().split(/\r?\n/)[0].toLowerCase() === path.join(binDir, 'emmer.cmd').toLowerCase(), `a fresh cmd's where emerald -> ${where.stdout.trim().split(/\r?\n/).join(' | ')}`);

  for (const { ext, progId } of entries) {
    const openers = openWithProgids(ext);
    expect(openers.includes(progId), `.${ext}'s OpenWithProgids names ${progId} (all: ${openers.join(', ') || '(none)'})`);
    const command = progIdCommand(progId);
    expect(command !== null && command.toLowerCase().includes(path.join(installDir, 'Emerald.exe').toLowerCase()) && command.includes('"%1"'), `${progId} opens with the installed Emerald.exe and the file (${command})`);
    const icon = progIdIcon(progId);
    expect(icon !== null && icon.toLowerCase() === path.join(installDir, 'resources', 'icon.ico').toLowerCase() && fs.existsSync(icon), `${progId}'s DefaultIcon is the installed resources\\icon.ico`);
    // M9 fix 381: the classic default is never ours. The fileAssociations
    // installer wrote it, so this read fails by design on a box that
    // build installed and no fix 381 build has uninstalled from yet (fix
    // 412: a look, not a FAIL, since a live install session cannot fix
    // the box's own history to pass it).
    const def = classicDefault(ext);
    if (def === progId) look(`.${ext}'s classic default is ours: the old fileAssociations installer wrote it, and installer.nsh's customUnInstall clears one naming ours at the next uninstall (${def})`);
    else expect(true, `.${ext}'s classic default is not ours (${def ?? '(none)'})`);
  }
  log(`entries read PASS, ${looks} look${looks === 1 ? '' : 's'}`);
}

async function main() {
  if (only === 'entries') {
    await entriesRead();
  } else {
    if (only !== 'install') await updaterHalf();
    if (only !== 'updater') await installHalf();
  }
  log('PASS');
  process.exit(0);
}

main().catch((err) => {
  log(`ERROR: ${err.stack ?? err}`);
  if (appLogs.length > 0) log(appLogs.join('').split(/\r?\n/).slice(-20).join('\n'));
  cleanupHard();
  process.exit(1);
});
