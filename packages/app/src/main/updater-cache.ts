// The updater's cache after an install (M9 fix 371). electron-updater
// downloads an installer into %LOCALAPPDATA%\emerald-updater\pending\ and
// runs it from there on the second click; nothing removes it afterwards,
// so the folder held the 118 MB installer of the build already running.
// The launch sweeps it, gated on what the folder names: update-info.json
// carries the installer's file name, and a version read off that name at
// or below the running one is an install that has happened. A pending
// version ahead of the running one is a download the person has not
// restarted into yet and stays. The cache root's installer.exe and
// current.blockmap are never touched: the next differential download is
// built from them (M9 fix 259).
//
// M9 fix 384: the first launch after the install of fixes 352 to 371 met
// EPERM on the installer exe (the installer that --force-run started the
// window from was still alive holding it), after rmSync had taken
// update-info.json and the blockmap first, so the gate answered null on
// every later launch and the exe stayed for good. So the gate reads the
// folder's own files when the info file is absent (an installer exe whose
// name says a version at or below the running one is sweepable on its
// own), the removal goes file by file with the exe first and the info
// file last (a failure leaves the gate intact), and the launch retries
// once a few minutes on (index.ts).
//
// M9 fix 409: that one retry is the ceiling, and deliberately so. On a
// box where the installer still holds the exe five minutes after the
// launch the pending folder stays until the next launch sweeps it, which
// is what the gate above is for: a failed removal leaves the folder
// whole and still sweepable, never half taken, so no later launch is
// worse off for this one having given up. The retry's failure says as
// much in the log (sweepGiveUpLine below) rather than growing a third
// attempt on a timer nobody is watching; the cost of waiting is one
// installer on disk until the next launch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UPDATER_CACHE_DIR_NAME } from '@emerald/shared';

export const PENDING_INFO = 'update-info.json';

export interface PendingSweep {
  dir: string;
  version: string;
  // What named the version: the info file, or an installer's file name
  // when the info file is gone (fix 384's half-swept folder).
  gate: 'info' | 'installer';
}

// Where electron-updater roots its cache on Windows (AppAdapter.js,
// getAppCacheDir): %LOCALAPPDATA%, or AppData\Local under the home
// when the variable is unset.
export function updaterCacheDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const local = env['LOCALAPPDATA'];
  return path.join(local !== undefined && local !== '' ? local : path.join(home, 'AppData', 'Local'), UPDATER_CACHE_DIR_NAME);
}

// The version in an installer's file name, `Emerald-setup-0.1.352-arm64.exe`
// (electron-builder.yml's artifactName, `-<arch>.<ext>` after the
// version, so a prerelease tail is read up to that), or null when the
// name holds none. update-info.json names the file and not the version,
// so this is where the version comes from.
export function versionInName(fileName: string): string | null {
  const shaped = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+?)?)-[0-9A-Za-z]+\.[A-Za-z]+$/.exec(fileName);
  if (shaped !== null) return shaped[1] ?? null;
  const bare = /(\d+\.\d+\.\d+)/.exec(fileName);
  return bare === null ? null : (bare[1] ?? null);
}

// A semver-shaped compare: the three dotted numbers, then a prerelease
// tail sorting below a release of the same numbers. The versions here
// are 0.1.<fix id>, so this is all of semver the sweep needs, and it
// keeps the main bundle from carrying a semver of its own.
export function compareVersions(a: string, b: string): number {
  const [aMain = '', aPre] = a.split('-', 2);
  const [bMain = '', bPre] = b.split('-', 2);
  const an = aMain.split('.').map((s) => Number(s));
  const bn = bMain.split('.').map((s) => Number(s));
  for (let i = 0; i < Math.max(an.length, bn.length); i++) {
    const x = an[i] ?? 0;
    const y = bn[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (aPre === undefined && bPre === undefined) return 0;
  if (aPre === undefined) return 1;
  if (bPre === undefined) return -1;
  return aPre < bPre ? -1 : aPre > bPre ? 1 : 0;
}

// A file's text, or null when it cannot be read; the default reader.
export function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// The files of a folder, one level deep, or none when it is not there;
// the default lister.
export function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

const isInstaller = (name: string): boolean => /\.exe$/i.test(name);

// The pending folder when it is the sweep's to remove: its
// update-info.json names an installer whose version is at or below the
// running one, or, with no info file there, the folder holds an
// installer exe whose own name says so (fix 384). Null when the folder
// is absent, the info file is not JSON or names no version, the folder
// without one holds no versioned installer, or the version is ahead.
export function pendingToSweep(
  pendingDir: string,
  runningVersion: string,
  read: (file: string) => string | null = readText,
  list: (dir: string) => string[] = listFiles,
): PendingSweep | null {
  const text = read(path.join(pendingDir, PENDING_INFO));
  if (text === null) {
    // The half-swept folder: the info file went with the first attempt
    // and the exe it named is still there. The exe's name carries the
    // same version the info file would have.
    const versions = list(pendingDir)
      .filter(isInstaller)
      .map((name) => versionInName(name))
      .filter((v): v is string => v !== null);
    if (versions.length === 0) return null;
    // Any installer ahead of the running build is a download not yet
    // restarted into; the folder stays whole for it.
    if (versions.some((v) => compareVersions(v, runningVersion) > 0)) return null;
    return { dir: pendingDir, version: versions[0]!, gate: 'installer' };
  }
  let fileName: unknown;
  try {
    fileName = (JSON.parse(text) as { fileName?: unknown }).fileName;
  } catch {
    return null;
  }
  if (typeof fileName !== 'string') return null;
  const version = versionInName(fileName);
  if (version === null) return null;
  return compareVersions(version, runningVersion) <= 0 ? { dir: pendingDir, version, gate: 'info' } : null;
}

// The bytes under a folder, one level deep (pending\ holds files only).
export function folderBytes(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) total += fs.statSync(path.join(dir, entry.name)).size;
    }
  } catch {
    // A folder gone between the read and the stat is 0 bytes.
  }
  return total;
}

// The order the pending folder's files go in: the installers first (the
// one file something else may still hold), then the rest, the info file
// last, so a failure anywhere leaves the info file, and with it the
// gate, in place for the retry.
export function removalOrder(names: string[]): string[] {
  const installers = names.filter(isInstaller);
  const others = names.filter((n) => !isInstaller(n) && n !== PENDING_INFO);
  const info = names.filter((n) => n === PENDING_INFO);
  return [...installers, ...others, ...info];
}

export interface SweepOutcome {
  removed: boolean;
  version: string;
  mb: string;
  gate: PendingSweep['gate'];
  // The error that stopped the removal, when it did not go through.
  error: string | null;
}

// The sweep itself: the pending folder under the cache removed file by
// file when pendingToSweep says so, the folder last. Null when there is
// nothing to sweep; otherwise what happened, for the caller's log line
// (index.ts says which launch path acted, so no line is written here).
// remove is the per-file unlink, replaceable by a test.
export function sweepPending(cacheDir: string, runningVersion: string, remove: (file: string) => void = (f) => fs.unlinkSync(f)): SweepOutcome | null {
  const pending = path.join(cacheDir, 'pending');
  const sweep = pendingToSweep(pending, runningVersion);
  if (sweep === null) return null;
  const mb = (folderBytes(pending) / (1024 * 1024)).toFixed(1);
  try {
    for (const name of removalOrder(listFiles(pending))) remove(path.join(pending, name));
    fs.rmSync(pending, { recursive: true, force: true });
    return { removed: true, version: sweep.version, mb, gate: sweep.gate, error: null };
  } catch (err) {
    return { removed: false, version: sweep.version, mb, gate: sweep.gate, error: String(err) };
  }
}

// The log line for a sweep's outcome, the launch path named so the
// install note can say which acted (`at launch`, `on the retry`).
export function sweepLine(outcome: SweepOutcome, when: string): string {
  const gate = outcome.gate === 'installer' ? " (read off the installer's name, no update-info.json)" : '';
  return outcome.removed
    ? `updater cache: removed pending ${outcome.version}, ${outcome.mb} MB ${when}${gate}`
    : `updater cache: could not remove pending ${outcome.version} ${when}: ${outcome.error}${gate}`;
}

// What the launch says when the retry failed too (M9 fix 409): there is
// no third attempt, and the folder is still whole, so the line names the
// launch that will take it. install-check.mjs prints it among the
// `updater cache:` lines, so the install note reads it without the log.
export function sweepGiveUpLine(version: string): string {
  return `updater cache: could not remove pending ${version} on the retry; the next launch's sweep takes it`;
}
