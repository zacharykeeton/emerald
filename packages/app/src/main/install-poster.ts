// The install's word, posted by a process outside the install folder (M9
// fix 323). The badge's second click used to post `Installing emerald N`
// through the app's own notifier (M9 fix 282) and a launch in the gap
// its `Still installing` (M9 fix 312), but neither reached the screen
// at the install of fixes 303 to 318: electron-builder's NSIS installer
// stops every process whose path starts with the install folder in a
// loop the antivirus holds seconds per probe, so the clicked app and any
// gap launch, both `$INSTDIR\Emerald.exe`, are killed before a toast's
// show event lands. So the click writes a PowerShell script under the
// emerald home that raises the toast through WinRT under the app's own
// AUMID (the one the Start Menu shortcut carries, so the toast wears
// emerald's name) and then sleeps the hold, since a toast goes with its
// poster and powershell.exe lives outside the folder the installer
// sweeps. The gap launch keeps its refusal and its attempt as they are.
//
// M9 fix 385: the script was spawned on powershell.exe directly,
// detached, and never ran: PowerShell 5.1 as a DETACHED_PROCESS has no
// console to initialise its host on and exits 0 within a second having
// written nothing (two installs logged `install poster spawned` with no
// poster log and no toast), and spawned attached it dies in libuv's job
// object when the app exits 200 ms later. The shape that survives both,
// measured from node and from an Electron parent that exits at once, is
// a detached node worker (the app's own exe as node under
// ELECTRON_RUN_AS_NODE, the shape cdp.mjs's stopDaemon uses) that runs
// PowerShell attached to itself, hidden, and waits for it. The worker's
// body is written beside the script under the home.
//
// M9 fix 408: the gap launch's own `Still installing` went through the
// app's notifier and held the quit six seconds for the toast's show
// event, and it has never been seen either, for the same reason: the
// process raising it is `$INSTDIR\Emerald.exe`, which the installer's
// running-app loop kills. So the gap posts through a worker of this same
// shape and the in-app post goes; one toast, from one place. The writer
// below takes a notice (title, body, hold) rather than a version, and
// each poster has a script, a worker and a log of its own under the
// home, so a gap launch never overwrites the install poster still
// sleeping on its ninety seconds.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { gapNotice, installingNotice, secondsToGo, type InstallMarker } from './install-gap.ts';

// The AUMIDs the script tries in turn; a toast shows only under one a
// Start Menu shortcut or the registry carries, and the script's one-line
// log under the home says which took it. Electron's own default is
// `electron.app.<name>` (nothing in index.ts calls setAppUserModelId),
// which is what the installed shortcut on this box carries and what the
// app's own toasts show under; electron-builder.yml's appId is what its
// NSIS template writes on the shortcut, kept second in case a box has
// it; PowerShell's own is on every box, and the toast then wears
// PowerShell's name. The name is `electron.app.` and the productName as
// written in electron-builder.yml, capital included, since that is what
// the shortcut carries whether or not Windows matches the case (M9 fix
// 581).
export const APP_AUMID = 'electron.app.Emerald';
export const NSIS_AUMID = 'dev.emerald.app';
const POWERSHELL_AUMID = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';

// How long the poster lives after the toast: the install takes about a
// minute, and a toast is dropped when the process that raised it exits.
export const POSTER_HOLD_MS = 90 * 1000;

export const posterScriptPath = (home: string): string => path.join(home, 'install-poster.ps1');
export const posterLogPath = (home: string): string => path.join(home, 'install-poster.log');
export const posterWorkerPath = (home: string): string => path.join(home, 'poster-worker.js');

// The gap's own three names (M9 fix 408). The install poster is still
// sleeping out its ninety seconds when a gap launch lands, so the two
// must not share a file: writing over the script a running PowerShell
// holds would fail, and sharing the log would mix the two answers.
export const gapScriptPath = (home: string): string => path.join(home, 'gap-poster.ps1');
export const gapLogPath = (home: string): string => path.join(home, 'gap-poster.log');
export const gapWorkerPath = (home: string): string => path.join(home, 'gap-poster.js');

// Which poster this is: its three files and the word the app's log calls
// it by (`install poster spawned (worker pid N)`, `install-gap poster
// spawned (worker pid N)`), so install-check and verify:install can tell
// the two apart in one main.log. header is the script's first line, so
// gap-poster.ps1 names fix 408 rather than wearing the install's fix id
// (M9 fix 447).
export interface PosterFiles {
  script: string;
  log: string;
  worker: string;
  label: string;
  header: string;
}

export const INSTALL_POSTER_HEADER = "# emerald install poster (M9 fix 323): the install's word from outside the install folder.";
export const GAP_POSTER_HEADER = "# emerald install-gap poster (M9 fix 408): a launch in the install's gap, its word from outside the install folder.";

export const installPosterFiles = (home: string): PosterFiles => ({
  script: posterScriptPath(home),
  log: posterLogPath(home),
  worker: posterWorkerPath(home),
  label: 'install poster',
  header: INSTALL_POSTER_HEADER,
});

export const gapPosterFiles = (home: string): PosterFiles => ({
  script: gapScriptPath(home),
  log: gapLogPath(home),
  worker: gapWorkerPath(home),
  label: 'install-gap poster',
  header: GAP_POSTER_HEADER,
});

// What a poster says and how long it holds afterwards.
export interface PosterNotice {
  title: string;
  body: string;
  holdMs: number;
}

const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
// Inside a single-quoted PowerShell string only the quote itself needs
// doubling.
const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`;

// The script text: a ToastGeneric toast with the two lines, shown under
// aumid with the NSIS one and PowerShell's own as the fallbacks, then the
// hold. logPath, if given, takes one line saying which AUMID showed it
// or why none did. header is the first line (PosterFiles.header).
export function posterScript(title: string, body: string, holdMs: number, aumid: string, logPath: string | null = null, header: string = INSTALL_POSTER_HEADER): string {
  const xml = `<toast><visual><binding template="ToastGeneric"><text>${xmlEscape(title)}</text><text>${xmlEscape(body)}</text></binding></visual></toast>`;
  const holdSec = Math.max(0, Math.round(holdMs / 1000));
  const logLine = logPath === null ? '' : `Add-Content -Path ${psQuote(logPath)} -Value ("$(Get-Date -Format o) " + $msg)\n`;
  return [
    header,
    `$ErrorActionPreference = 'Stop'`,
    `$msg = ''`,
    `try {`,
    `  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null`,
    `  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null`,
    `  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument`,
    `  $xml.LoadXml(${psQuote(xml)})`,
    `  foreach ($aumid in @(${psQuote(aumid)}, ${psQuote(NSIS_AUMID)}, ${psQuote(POWERSHELL_AUMID)})) {`,
    `    try {`,
    `      $toast = New-Object Windows.UI.Notifications.ToastNotification $xml`,
    `      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid).Show($toast)`,
    `      $msg = "shown under $aumid"`,
    `      break`,
    `    } catch {`,
    `      $msg = "$aumid failed: $($_.Exception.Message); $msg"`,
    `    }`,
    `  }`,
    `} catch {`,
    `  $msg = "setup failed: $($_.Exception.Message)"`,
    `}`,
    logLine + `Start-Sleep -Seconds ${holdSec}`,
    '',
  ].join('\n');
}

// The worker's body (M9 fix 385): plain CommonJS for a node of any
// version, taking the PowerShell exe and the script as its two
// arguments, running PowerShell attached to itself with a hidden window
// and waiting for it, so the toast has a console-owning host and a
// parent that outlives the app.
export const POSTER_WORKER_JS = [
  `// emerald poster worker (M9 fixes 385 and 408): runs a poster script on PowerShell attached to this process, outside the app's job object.`,
  `const { spawnSync } = require('node:child_process');`,
  `const [exe, script] = process.argv.slice(2);`,
  `spawnSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'ignore', windowsHide: true });`,
  '',
].join('\n');

export const powershellExe = (env: NodeJS.ProcessEnv = process.env): string => path.join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

export interface PosterSpawn {
  exe: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

// What the spawn is: the running exe as node (Emerald.exe under the packed
// app, electron.exe under a dev build; ELECTRON_RUN_AS_NODE makes either
// behave as node and is harmless for a plain node), the worker, then
// the worker's two arguments. Pure, so a test reads it without spawning.
export function posterWorkerSpawn(files: PosterFiles, execPath: string = process.execPath, env: NodeJS.ProcessEnv = process.env): PosterSpawn {
  return {
    exe: execPath,
    args: [files.worker, powershellExe(env), files.script],
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  };
}

export interface PosterOpts {
  // True under a harness window (EMERALD_WINDOW=background): the script and
  // the worker are written and the spawn held, so a test run never pops
  // a toast on the person; the spawn itself is the next install's eye.
  held: boolean;
  aumid?: string;
}

// Writes the script and the worker under home and spawns the worker,
// detached and unreferenced, so the app's own exit takes nothing with
// it; the worker runs PowerShell attached to itself. The two callers
// below are the badge's second click and a launch in the install's gap.
export function postPoster(home: string, notice: PosterNotice, files: PosterFiles, log: (msg: string) => void, opts: PosterOpts): void {
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(files.script, posterScript(notice.title, notice.body, notice.holdMs, opts.aumid ?? APP_AUMID, files.log, files.header), 'utf8');
    fs.writeFileSync(files.worker, POSTER_WORKER_JS, 'utf8');
  } catch (err) {
    log(`${files.label} failed: could not write ${files.script}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (opts.held) {
    log(`${files.label} held (harness)`);
    return;
  }
  try {
    const { exe, args, env } = posterWorkerSpawn(files);
    const child = spawn(exe, args, {
      env,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', (err) => log(`${files.label} failed: ${err.message}`));
    child.unref();
    log(`${files.label} spawned (worker pid ${child.pid ?? '?'})`);
  } catch (err) {
    log(`${files.label} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// The badge's second click: the install's word, held ninety seconds so
// the toast outlives the install.
export function postInstallPoster(home: string, version: string, log: (msg: string) => void, opts: PosterOpts & { holdMs?: number }): void {
  postPoster(home, { ...installingNotice(version), holdMs: opts.holdMs ?? POSTER_HOLD_MS }, installPosterFiles(home), log, opts);
}

// A launch inside the install's gap (M9 fix 408): the same word the
// in-app toast used to carry, held for the seconds it says are left, so
// the poster goes when the new build is due rather than sitting on the
// screen behind it.
export function postGapPoster(home: string, marker: InstallMarker, now: number, log: (msg: string) => void, opts: PosterOpts): void {
  postPoster(home, { ...gapNotice(marker, now), holdMs: secondsToGo(marker, now) * 1000 }, gapPosterFiles(home), log, opts);
}
