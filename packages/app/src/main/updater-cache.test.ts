import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareVersions, folderBytes, pendingToSweep, removalOrder, sweepGiveUpLine, sweepLine, sweepPending, updaterCacheDir, versionInName } from './updater-cache.ts';

function seed(cacheDir: string, info: string | null, installerBytes = 1024, installerName = 'Emerald-setup-x-arm64.exe'): string {
  const pending = path.join(cacheDir, 'pending');
  fs.rmSync(pending, { recursive: true, force: true });
  fs.mkdirSync(pending, { recursive: true });
  if (info !== null) fs.writeFileSync(path.join(pending, 'update-info.json'), info);
  fs.writeFileSync(path.join(pending, installerName), Buffer.alloc(installerBytes));
  // The root's two files the next differential download reads (M9 fix 259).
  fs.writeFileSync(path.join(cacheDir, 'installer.exe'), 'installed');
  fs.writeFileSync(path.join(cacheDir, 'current.blockmap'), 'blockmap');
  return pending;
}

const info = (fileName: string) => JSON.stringify({ fileName, sha512: 'abc', isAdminRightsRequired: false });

test('the version comes off the installer file name, and the compare is semver-shaped (M9 fix 371)', () => {
  assert.equal(versionInName('Emerald-setup-0.1.352-arm64.exe'), '0.1.352');
  assert.equal(versionInName('Emerald-setup-1.2.3-beta.1-arm64.exe'), '1.2.3-beta.1');
  assert.equal(versionInName('Emerald-setup-arm64.exe'), null);
  assert.equal(compareVersions('0.1.352', '0.1.352'), 0);
  assert.equal(compareVersions('0.1.329', '0.1.352'), -1);
  assert.equal(compareVersions('0.1.400', '0.1.352'), 1);
  assert.equal(compareVersions('0.2.0', '0.1.999'), 1);
  assert.equal(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-beta.1'), 1);
});

test('a pending version below or equal to the running one is swept, one ahead stays, no folder or a bad file is nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-updater-cache-'));
  const cache = path.join(dir, 'emerald-updater');
  const pending = path.join(cache, 'pending');
  assert.equal(pendingToSweep(pending, '0.1.352'), null, 'no folder');
  seed(cache, info('Emerald-setup-0.1.329-arm64.exe'));
  assert.deepEqual(pendingToSweep(pending, '0.1.352'), { dir: pending, version: '0.1.329', gate: 'info' }, 'below');
  seed(cache, info('Emerald-setup-0.1.352-arm64.exe'));
  assert.deepEqual(pendingToSweep(pending, '0.1.352'), { dir: pending, version: '0.1.352', gate: 'info' }, 'equal');
  seed(cache, info('Emerald-setup-0.1.400-arm64.exe'));
  assert.equal(pendingToSweep(pending, '0.1.352'), null, 'ahead');
  seed(cache, '{not json');
  assert.equal(pendingToSweep(pending, '0.1.352'), null, 'a bad update-info.json');
  seed(cache, JSON.stringify({ sha512: 'abc' }));
  assert.equal(pendingToSweep(pending, '0.1.352'), null, 'no file name in it');
  seed(cache, info('Emerald-setup-arm64.exe'));
  assert.equal(pendingToSweep(pending, '0.1.352'), null, 'no version in the name');
  fs.rmSync(path.join(pending, 'update-info.json'));
  assert.equal(pendingToSweep(pending, '0.1.352'), null, 'a folder with no update-info.json and no versioned installer');
  fs.rmSync(dir, { recursive: true, force: true });
});

// M9 fix 384: the half-swept folder of the install of fixes 352 to 371,
// the info file gone and the exe still there.
test('with no update-info.json the installer exe names the version itself: at the running one swept, above it kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-updater-cache-'));
  const cache = path.join(dir, 'emerald-updater');
  const pending = path.join(cache, 'pending');
  seed(cache, null, 1024, 'Emerald-setup-0.1.352-arm64.exe');
  assert.deepEqual(pendingToSweep(pending, '0.1.352'), { dir: pending, version: '0.1.352', gate: 'installer' }, 'the exe at the running version');
  seed(cache, null, 1024, 'Emerald-setup-0.1.329-arm64.exe');
  assert.deepEqual(pendingToSweep(pending, '0.1.352'), { dir: pending, version: '0.1.329', gate: 'installer' }, 'the exe below it');
  seed(cache, null, 1024, 'Emerald-setup-0.1.400-arm64.exe');
  assert.equal(pendingToSweep(pending, '0.1.352'), null, 'the exe above it stays');
  // A blockmap alone, or nothing with a version, is not the sweep's.
  seed(cache, null, 1024, 'Emerald-setup-0.1.400-arm64.exe.blockmap');
  assert.equal(pendingToSweep(pending, '0.1.352'), null, 'no exe at all');
  // The whole of the half-swept folder is swept, the root untouched.
  seed(cache, null, 2 * 1024 * 1024, 'Emerald-setup-0.1.352-arm64.exe');
  const outcome = sweepPending(cache, '0.1.352');
  assert.deepEqual(outcome, { removed: true, version: '0.1.352', mb: '2.0', gate: 'installer', error: null });
  assert.equal(sweepLine(outcome!, 'at launch'), "updater cache: removed pending 0.1.352, 2.0 MB at launch (read off the installer's name, no update-info.json)");
  assert.equal(fs.existsSync(pending), false);
  assert.equal(fs.existsSync(path.join(cache, 'installer.exe')), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the sweep removes the pending folder whole, says the version and the size, and leaves the root files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-updater-cache-'));
  const cache = path.join(dir, 'emerald-updater');
  const pending = seed(cache, info('Emerald-setup-0.1.352-arm64.exe'), 3 * 1024 * 1024);
  assert.equal(folderBytes(pending), 3 * 1024 * 1024 + info('Emerald-setup-0.1.352-arm64.exe').length);
  const outcome = sweepPending(cache, '0.1.352');
  assert.deepEqual(outcome, { removed: true, version: '0.1.352', mb: '3.0', gate: 'info', error: null });
  assert.equal(sweepLine(outcome!, 'at launch'), 'updater cache: removed pending 0.1.352, 3.0 MB at launch');
  assert.equal(fs.existsSync(pending), false);
  assert.equal(fs.existsSync(path.join(cache, 'installer.exe')), true);
  assert.equal(fs.existsSync(path.join(cache, 'current.blockmap')), true);
  // A pending download ahead of the running build is left where it is, silently.
  seed(cache, info('Emerald-setup-0.1.400-arm64.exe'));
  assert.equal(sweepPending(cache, '0.1.352'), null);
  assert.equal(fs.existsSync(pending), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// M9 fix 384: the exe goes first and the info file last, so the removal
// that fails on a held exe leaves the gate for the retry.
test('the removal goes exe first and info file last, and a failure on the exe leaves the info file in place', () => {
  assert.deepEqual(removalOrder(['update-info.json', 'Emerald-setup-0.1.352-arm64.exe.blockmap', 'Emerald-setup-0.1.352-arm64.exe']), [
    'Emerald-setup-0.1.352-arm64.exe',
    'Emerald-setup-0.1.352-arm64.exe.blockmap',
    'update-info.json',
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-updater-cache-'));
  const cache = path.join(dir, 'emerald-updater');
  const pending = seed(cache, info('Emerald-setup-0.1.352-arm64.exe'), 1024, 'Emerald-setup-0.1.352-arm64.exe');
  fs.writeFileSync(path.join(pending, 'Emerald-setup-0.1.352-arm64.exe.blockmap'), 'map');
  const tried: string[] = [];
  const holding = (file: string) => {
    tried.push(path.basename(file));
    if (/\.exe$/.test(file)) throw new Error('EPERM: operation not permitted, unlink');
    fs.unlinkSync(file);
  };
  const first = sweepPending(cache, '0.1.352', holding);
  assert.equal(first?.removed, false);
  assert.equal(first?.gate, 'info');
  assert.ok(first?.error?.includes('EPERM'));
  assert.deepEqual(tried, ['Emerald-setup-0.1.352-arm64.exe'], 'the exe is tried first and nothing after a failure');
  assert.equal(sweepLine(first!, 'at launch'), 'updater cache: could not remove pending 0.1.352 at launch: Error: EPERM: operation not permitted, unlink');
  assert.equal(fs.existsSync(path.join(pending, 'update-info.json')), true, 'the info file is still there');
  assert.equal(fs.existsSync(path.join(pending, 'Emerald-setup-0.1.352-arm64.exe.blockmap')), true, 'and the blockmap');
  // The retry with the hold released takes the folder whole.
  const second = sweepPending(cache, '0.1.352');
  assert.deepEqual(second, { removed: true, version: '0.1.352', mb: '0.0', gate: 'info', error: null });
  assert.equal(sweepLine(second!, 'on the retry'), 'updater cache: removed pending 0.1.352, 0.0 MB on the retry');
  assert.equal(fs.existsSync(pending), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// M9 fix 409: the retry is the last attempt a launch makes, and a second
// failure says which launch takes the folder instead. The removal leaves
// the folder whole (the case above), so the next launch's gate still
// reads it.
test('a retry that fails too gives up in one line naming the next launch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-updater-cache-'));
  const cache = path.join(dir, 'emerald-updater');
  const pending = seed(cache, info('Emerald-setup-0.1.394-arm64.exe'), 1024, 'Emerald-setup-0.1.394-arm64.exe');
  const holding = (file: string) => {
    if (/\.exe$/.test(file)) throw new Error('EPERM: operation not permitted, unlink');
    fs.unlinkSync(file);
  };
  const second = sweepPending(cache, '0.1.394', holding);
  assert.equal(second?.removed, false);
  assert.equal(sweepGiveUpLine(second!.version), "updater cache: could not remove pending 0.1.394 on the retry; the next launch's sweep takes it");
  // The gate the next launch reads is still in place.
  assert.equal(fs.existsSync(path.join(pending, 'update-info.json')), true);
  assert.notEqual(pendingToSweep(pending, '0.1.394'), null, 'so the next launch sweeps it');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the cache root is %LOCALAPPDATA%\\emerald-updater, or AppData\\Local under the home without the variable', () => {
  assert.equal(updaterCacheDir({ LOCALAPPDATA: 'D:\\local' }, 'C:\\Users\\me'), path.join('D:\\local', 'emerald-updater'));
  assert.equal(updaterCacheDir({}, 'C:\\Users\\me'), path.join('C:\\Users\\me', 'AppData', 'Local', 'emerald-updater'));
  assert.equal(updaterCacheDir({ LOCALAPPDATA: '' }, 'C:\\Users\\me'), path.join('C:\\Users\\me', 'AppData', 'Local', 'emerald-updater'));
});
