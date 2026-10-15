// M7 acceptance, part 2: the packaged app. Launches release/win-arm64-unpacked/
// Emerald.exe (build it with npm run pack:dir) under a private EMERALD_HOME and
// EMERALD_PIPE, checks that it autostarted the daemon shipped under resources/
// running under Emerald.exe as Node, starts a shell through the window, then
// drives the same daemon from resources/bin/emmer.cmd: ls, send, read, and a
// check that the shell did not inherit ELECTRON_RUN_AS_NODE. Ends by closing
// the window and stopping the daemon through the shim. CLAUDE_SETTINGS points
// at a file that does not exist, so the hooks banner must appear, which
// proves the packaged app ran the shipped CLI under Emerald.exe as Node.
// M9 fix 49: the one script that launches the shipped exe also reads where
// the background window went, past every display, and that it goes back
// there when moved onto one.
// M9 fix 243: a second launch on the same daemon with EMERALD_CLAUDE_HOME on
// a folder that is not there, its exe read gone within 10 s with the log
// naming the missing home. M9 fix 631: both windows close through
// Page.close, the way a person closes one, so each quit goes through
// window-all-closed; the first gets 90 s and on a hang prints its
// `active resources` line, its `quit, exit code` line and the exes left,
// the second is judged at 10 s. M9 fix 671: the `active resources` line
// reads the same on a clean exit as on a hang and names no holder; the
// `quit, exit code` line, or its absence, says whether Electron reached
// its quit.
// Logs to %TEMP%\emerald-verify\package.log. Run: npm run verify:package -w @emerald/app
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, freshPort, sleep, startSession, zreq } from './cdp.mjs';
import { readIco } from './make-icon.mjs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unpacked = path.join(appDir, 'release', 'win-arm64-unpacked');
const exe = path.join(unpacked, 'Emerald.exe');
const shim = path.join(unpacked, 'resources', 'bin', 'emmer.cmd');
const verifyDir = path.join(os.tmpdir(), 'emerald-verify');
const home = process.env.EMERALD_HOME ?? path.join(verifyDir, 'package-home');
const pipe = process.env.EMERALD_PIPE ?? '\\\\.\\pipe\\emmerd-verify-package';
const logFile = path.join(verifyDir, 'package.log');
// An empty Claude home under the private home (M9 fix 163's rule for
// every harness), so the packed app reads none of the user's ~/.claude.
const claudeHome = path.join(home, 'claude-home');
const env = { ...process.env, EMERALD_HOME: home, EMERALD_PIPE: pipe, CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'), EMERALD_WINDOW: 'background', EMERALD_WHATS_NEW: 'off', EMERALD_CLAUDE_HOME: claudeHome };
const t0 = Date.now();
let child = null;
// The main process's console lines, where the window's placement is said.
const appLogs = [];

fs.mkdirSync(verifyDir, { recursive: true });
fs.writeFileSync(logFile, '');

// 6.6 to 9.8 s quiet, 22.9 s with fix 243's second window; one run under
// a batch's load spent 33.8 s on one `emmer ls --json` (fix 404's
// verify:cli precedent for the bound).
setTimeout(() => {
  log('WATCHDOG: run exceeded 240 s');
  cleanupHard();
  process.exit(3);
}, 240000);

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

function emerald(...args) {
  const started = Date.now();
  const r = spawnSync('cmd.exe', ['/d', '/c', shim, ...args], { env, encoding: 'utf8', windowsHide: true });
  const ms = Date.now() - started;
  const out = r.stdout ?? '';
  const err = r.stderr ?? '';
  fs.appendFileSync(logFile, `$ emerald ${args.join(' ')}\n${out}${err}[exit ${r.status}, ${(ms / 1000).toFixed(1)} s]\n`);
  return { code: r.status, out, err };
}

function emeraldJson(...args) {
  const r = emerald(...args);
  let json = null;
  try {
    json = JSON.parse(r.out);
  } catch {
    // Left null; the caller's expect names the command.
  }
  return { ...r, json };
}

function powershell(command) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  return (r.stdout ?? '').trim();
}

// Finds the visible top-level window of the process and moves it, no size
// change, no z-order change, no activation; prints the position it was
// moved to, or "none" when the process has no such window.
function moveWindowScript(pid, x, y) {
  // The C# lines are joined with newlines and not the semicolons of the
  // PowerShell lines below, since a stray semicolon between members does
  // not compile and the powershell helper drops the error.
  const members = [
    '[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);',
    'public delegate bool EnumProc(IntPtr h, IntPtr l);',
    '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
    '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);',
    '[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);',
  ].join('\n');
  return [
    `Add-Type -Namespace Z -Name W -MemberDefinition '${members}'`,
    `$global:found = [IntPtr]::Zero`,
    `[Z.W]::EnumWindows({ param($h, $l) [uint32]$p = 0; [void][Z.W]::GetWindowThreadProcessId($h, [ref]$p); if ($p -eq ${pid} -and [Z.W]::IsWindowVisible($h)) { $global:found = $h; return $false }; return $true }, [IntPtr]::Zero) | Out-Null`,
    `if ($global:found -eq [IntPtr]::Zero) { 'none' } elseif ([Z.W]::SetWindowPos($global:found, [IntPtr]::Zero, ${x}, ${y}, 0, 0, 0x0001 -bor 0x0004 -bor 0x0010)) { 'moved to ${x},${y}' } else { 'SetWindowPos failed' }`,
  ].join('; ');
}

function readDaemonInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
  } catch {
    return null;
  }
}

function cleanupHard() {
  if (child !== null) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
  const info = readDaemonInfo();
  if (info !== null) spawnSync('taskkill', ['/pid', String(info.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
}

async function until(what, fn, timeoutMs = 10000) {
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) {
      log(`${what} after ${Date.now() - start} ms`);
      return v;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Like cdp.mjs launch(), but for the packaged executable with our environment.
async function launchPackaged(port, extraEnv = {}) {
  // The packaged exe keeps its Electron profile, localStorage included, in
  // %APPDATA%\emerald, the user's own; a profile under the private home
  // keeps the run's tabs and folds out of theirs and theirs (the rail
  // left on Activity) out of the run (M68 found the icon check waiting on
  // a Files tree that was not on show).
  child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(home, 'electron-profile')}`], { env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  child.stdout.on('data', (d) => appLogs.push(d.toString()));
  child.stderr.on('data', (d) => appLogs.push(d.toString()));
  const deadline = Date.now() + 20000;
  let pages = [];
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
      pages = (await res.json()).filter((p) => p.type === 'page');
      if (pages.length > 0) break;
    } catch {
      // Still starting.
    }
    await sleep(200);
  }
  if (pages.length === 0) throw new Error('no page target from the packaged app');
  const session = await connect(pages[0].webSocketDebuggerUrl);
  // Focus emulated rather than the window raised (M9 fix 48, as cdp.mjs).
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  return session;
}

async function main() {
  log(`home ${home}, pipe ${pipe}`);
  expect(fs.existsSync(exe), `${exe} exists (run npm run pack:dir -w @emerald/app first)`);
  expect(fs.existsSync(path.join(unpacked, 'resources', 'daemon', 'dist', 'main.js')), 'resources/daemon/dist/main.js shipped');
  expect(fs.existsSync(path.join(unpacked, 'resources', 'node_modules', 'node-pty', 'prebuilds', 'win32-arm64', 'conpty.node')), 'resources/node_modules/node-pty prebuild shipped');
  expect(fs.existsSync(path.join(unpacked, 'resources', 'cli', 'hooks', 'claude-hook.cmd')), 'resources/cli/hooks/claude-hook.cmd shipped');
  expect(fs.existsSync(path.join(unpacked, 'resources', 'app.asar')), 'app.asar present');
  expect(fs.existsSync(path.join(unpacked, 'resources', 'WHATS-NEW.md')), 'resources/WHATS-NEW.md shipped (M9 fix 227)');
  const icon = readIco(fs.readFileSync(path.join(unpacked, 'resources', 'icon.ico')));
  expect(icon.map((e) => e.width).join(',') === '16,24,32,48,256' && icon.every((e) => e.pngWidth === e.width && e.pngHeight === e.height), `resources/icon.ico holds the five gem images, 16, 24, 32, 48 and 256 (M9 fix 571), got ${JSON.stringify(icon.map((e) => [e.width, e.pngWidth]))}`);
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(claudeHome, { recursive: true });

  const s = await launchPackaged(freshPort());
  log('packaged app is up');
  await until('sidebar rendered', () => s.evalJs(`document.querySelector('.sidebar') !== null`));
  expect(true, 'renderer loaded from app.asar');

  // M9 fix 49: the window sits past the right edge of every display, and
  // says where in the main log; the page's screenX is the same number in
  // the same units (DIP), so no display listing of our own is needed.
  // Since M43 the frame's title bar is hidden, and Windows then reports
  // the page's screenX up to the width of the invisible resize border (8
  // DIP) to the left of where Electron put the window; the same offset
  // holds after the re-pin below.
  const placement = await until('the placement line in the app log', () => appLogs.join('').match(/background window at (-?\d+),(-?\d+), past displays ending at (-?\d+)/));
  const spot = { x: Number(placement[1]), y: Number(placement[2]), right: Number(placement[3]) };
  const screenPos = () => s.evalJs(`({ x: window.screenX, y: window.screenY })`);
  const before = await screenPos();
  const border = spot.x - before.x;
  log(`placement: ${placement[0]}; screenX ${before.x}, screenY ${before.y}`);
  expect(border >= 0 && border <= 8 && before.y === spot.y, `the window is where the log says, less the frame's invisible border (${before.x},${before.y})`);
  expect(spot.x >= spot.right, `past the rightmost display's edge (${spot.x} >= ${spot.right})`);
  // Moved onto a display, as Windows does when a display goes away, it
  // goes straight back. Electron's CDP has no Browser.setWindowBounds, so
  // the move is SetWindowPos on the app's own window, without activating
  // it, the way the OS would move it.
  const movedTo = powershell(moveWindowScript(child.pid, 200, 120));
  expect(/^moved /.test(movedTo), `the window was moved onto a display by SetWindowPos (${movedTo})`);
  const moved = await until('the window back at its spot', async () => {
    const p = await screenPos();
    return p.x === spot.x - border && p.y === spot.y ? p : null;
  }, 1000);
  expect(moved.x === spot.x - border, `re-pinned after a move onto a display (${moved.x},${moved.y})`);

  await until('hooks banner', () => s.evalJs(`document.querySelector('.hooks-banner') !== null`));
  expect(true, 'the packaged app ran resources/cli for hooks status and offered to install');

  const info = await until('daemon.json in the private home', () => readDaemonInfo());
  expect(info.pipe === env.EMERALD_PIPE, 'the app autostarted a daemon on the private pipe');
  const exePath = powershell(`(Get-Process -Id ${info.pid}).Path`);
  expect(exePath.toLowerCase() === exe.toLowerCase(), `the daemon runs under Emerald.exe (${exePath})`);
  const cmdline = powershell(`(Get-CimInstance Win32_Process -Filter "ProcessId = ${info.pid}").CommandLine`);
  expect(cmdline.toLowerCase().includes(path.join('resources', 'daemon', 'dist', 'main.js').toLowerCase()), `the daemon is the shipped one (${cmdline})`);

  await startSession(s, { kind: 'shell', cwd: os.tmpdir() });
  const shellId = await until('shell listed by the app', async () => (await zreq(s, 'session.list', {})).sessions.find((x) => x.kind === 'shell')?.id);
  expect(true, `a shell started through the window (${shellId})`);
  const modules = powershell(`(Get-Process -Id ${info.pid}).Modules | ForEach-Object { $_.FileName }`);
  const conpty = modules.split(/\r?\n/).find((m) => m.toLowerCase().endsWith('conpty.node')) ?? '';
  expect(conpty.toLowerCase().startsWith(path.join(unpacked, 'resources').toLowerCase()), `conpty.node loaded from resources (${conpty})`);
  // The rail's type icons (M9 fix 71) are files beside the bundle in the
  // asar, so the tree in the temp folder must draw them from there.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]')?.click()`);
  await until('a type icon drawn from the asar', async () => {
    const loaded = await s.evalJs(`[...document.querySelectorAll('img.files-icon-img')].filter((i) => i.complete && i.naturalWidth > 0).length`);
    return loaded > 0 ? loaded : undefined;
  });
  const iconSrc = await s.evalJs(`[...document.querySelectorAll('img.files-icon-img')].find((i) => i.naturalWidth > 0)?.getAttribute('src') ?? ''`);
  expect(/[.]svg$/.test(iconSrc) && iconSrc.includes('app.asar'), `the icon's src is one of the set's files in the asar (${iconSrc})`);

  let r = emerald('--version');
  expect(r.code === 0 && r.out.trim() === JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version, `resources/bin/emmer.cmd --version says ${r.out.trim()}`);
  const ls = emeraldJson('ls', '--json');
  expect(ls.code === 0 && ls.json?.sessions?.some((x) => x.id === shellId), 'the shim lists the shell over the private pipe');
  const status = emeraldJson('daemon', 'status', '--json');
  expect(status.json?.pid === info.pid, 'the shim talks to the daemon the app started');

  await sleep(1500);
  r = emerald('send', shellId, 'echo "marker-$(1+1) run-as-node=[$env:ELECTRON_RUN_AS_NODE]"', '--enter');
  expect(r.code === 0, 'send through the shim');
  const line = await until('marker in read', () => emerald('read', shellId, '--lines', '40').out.split(/\r?\n/).find((l) => l.startsWith('marker-2')));
  expect(line === 'marker-2 run-as-node=[]', `the shell does not inherit ELECTRON_RUN_AS_NODE (${line})`);

  // Closing the window quits the app; the daemon stays up until the shim stops it.
  // M9 fix 631: the window is closed the way a person closes it, with
  // Page.close as fix 243's step below does, so the quit runs through
  // window-all-closed. Its `active resources` line reads the same on a
  // clean exit and names no holder (fix 671); the `quit, exit code` line
  // says whether Electron reached its quit. A hang past the 90 s prints
  // both and the exes left.
  const mainLog = path.join(home, 'logs', 'main.log');
  const closeLogSize = fs.existsSync(mainLog) ? fs.statSync(mainLog).size : 0;
  await s.send('Page.close').catch(() => {});
  s.close();
  await until('app exited', () => powershell(`(Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue) -eq $null`) === 'True', 90000).catch((err) => {
    const since = fs.existsSync(mainLog) ? fs.readFileSync(mainLog, 'utf8').slice(closeLogSize) : '';
    const line = since.split(/\r?\n/).filter((l) => l.includes('window-all-closed; active resources:')).pop();
    const quit = since.split(/\r?\n/).filter((l) => l.includes('quit, exit code')).pop();
    log(`the window's exit timed out; main log since the close: ${line ?? 'no window-all-closed line'}; ${quit ?? 'no quit line'}`);
    const list = powershell(`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Emerald.exe' -and $_.ExecutablePath -eq '${exe}' } | ForEach-Object { 'pid ' + $_.ProcessId + ' started ' + $_.CreationDate.ToString('HH:mm:ss.fff') + ': ' + $_.CommandLine }`).split(/\r?\n/).filter(Boolean).join('; ');
    log(`Emerald.exe under ${exe}: ${list || 'none'}`);
    throw err;
  });
  child = null;
  expect(readDaemonInfo()?.pid === info.pid, 'the daemon outlived the window');

  // M9 fix 243: the same exe on the same daemon with the Claude home on a
  // folder that is not there. The History tab is opened so the scan and
  // the watcher meet the missing folder, then the window is closed the
  // way a person closes it (Page.close is the window's own close, and
  // the quit runs through window-all-closed, as the first window's did;
  // that window's line falls before logSize, outside every read here),
  // and the exe must be gone within 10 s.
  const missingHome = path.join(home, 'claude-home-not-there');
  expect(!fs.existsSync(missingHome), `${missingHome} does not exist`);
  const logSize = fs.existsSync(mainLog) ? fs.statSync(mainLog).size : 0;
  const s2 = await launchPackaged(freshPort(), { EMERALD_CLAUDE_HOME: missingHome });
  await until('sidebar rendered again', () => s2.evalJs(`document.querySelector('.sidebar') !== null`));
  expect(readDaemonInfo()?.pid === info.pid, 'the second window attached to the same daemon');
  await s2.evalJs(`document.querySelector('.rail-tab[data-tab="history"]')?.click()`);
  await until('the history panel', () => s2.evalJs(`document.querySelector('.history-panel') !== null`));
  const mainLogSince = () => (fs.existsSync(mainLog) ? fs.readFileSync(mainLog, 'utf8').slice(logSize) : '');
  await until('the missing home said in the main log', () => mainLogSince().includes(`claude home ${missingHome} is not there; nothing to scan`));
  const said = mainLogSince().split(/\r?\n/).filter((l) => l.includes('is not there; nothing to scan')).length;
  expect(said === 1, `the missing home is said once for the scan, the watcher and the usage reader (${said})`);
  expect(!mainLogSince().includes('history watch not started'), 'no watcher error on the missing home');
  const pid2 = child.pid;
  const closedAt = Date.now();
  await s2.send('Page.close').catch(() => {});
  s2.close();
  const gone = await until('the exe gone after the window closed', () => powershell(`(Get-Process -Id ${pid2} -ErrorAction SilentlyContinue) -eq $null`) === 'True', 10000).then(() => Date.now() - closedAt, () => null);
  expect(gone !== null, `the exe quit within 10 s of the window's close on a missing Claude home (${gone} ms)`);
  child = null;
  const resources = mainLogSince().match(/window-all-closed; active resources: (.*)/);
  expect(resources !== null, `the quit named what was alive (${resources?.[1] ?? 'no line'})`);
  expect(readDaemonInfo()?.pid === info.pid, 'the daemon outlived the second window');
  r = emerald('daemon', 'stop');
  expect(r.code === 0 && /^stopped emmerd/.test(r.out), `daemon stop through the shim: ${r.out.trim()}`);
  const stoppedAt = Date.now();
  const exeCount = () => powershell(`(Get-Process -Name emerald -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exe}' }).Count`);
  const goneAfter = await until('no Emerald.exe left from the run', () => ['0', ''].includes(exeCount()), 6000).then(() => Date.now() - stoppedAt, () => null);
  const leftovers = goneAfter !== null ? '' : powershell(`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Emerald.exe' -and $_.ExecutablePath -eq '${exe}' } | ForEach-Object { 'pid ' + $_.ProcessId + ' started ' + $_.CreationDate.ToString('HH:mm:ss.fff') + ': ' + $_.CommandLine }`).split(/\r?\n/).join('; ');
  expect(goneAfter !== null, goneAfter !== null ? `no Emerald.exe processes left from the run (gone ${goneAfter} ms after the stop)` : `no Emerald.exe processes left from the run within 6 s of the stop, left: ${leftovers}`);
  log('PASS');
  process.exit(0);
}

main().catch((err) => {
  log(`ERROR: ${err.stack ?? err}`);
  cleanupHard();
  process.exit(1);
});
