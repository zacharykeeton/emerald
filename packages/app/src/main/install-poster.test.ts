import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_AUMID, GAP_POSTER_HEADER, INSTALL_POSTER_HEADER, POSTER_HOLD_MS, POSTER_WORKER_JS, gapLogPath, gapPosterFiles, gapScriptPath, gapWorkerPath, installPosterFiles, posterLogPath, posterScript, posterScriptPath, posterWorkerPath, posterWorkerSpawn, postGapPoster, postInstallPoster } from './install-poster.ts';

test('the script raises a ToastGeneric toast with the two lines under the app AUMID, falls back to the NSIS one and PowerShell own, then holds (M9 fix 323)', () => {
  const s = posterScript('Installing emerald 0.1.319', 'The window closes now and comes back on its own in about a minute.', 90000, APP_AUMID, 'C:\\h\\install-poster.log');
  assert.ok(s.includes('template="ToastGeneric"'));
  assert.ok(s.includes('<text>Installing emerald 0.1.319</text><text>The window closes now and comes back on its own in about a minute.</text>'));
  assert.ok(s.includes("@('electron.app.Emerald', 'dev.emerald.app', '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')"));
  assert.ok(s.includes('CreateToastNotifier($aumid).Show($toast)'));
  // The shortcut's spelling, capital and all (M9 fix 581).
  assert.equal(APP_AUMID, 'electron.app.Emerald');
  assert.ok(s.endsWith('Start-Sleep -Seconds 90\n'));
  assert.ok(s.includes("Add-Content -Path 'C:\\h\\install-poster.log'"));
  // Nothing in it lives under the install folder, which the installer
  // sweeps; the poster is powershell.exe on a script under the home.
  assert.ok(!/Programs\\emerald|emerald\.exe/i.test(s));
  assert.equal(POSTER_HOLD_MS, 90000);
  // The install poster's own header by default (M9 fix 447).
  assert.ok(s.startsWith(INSTALL_POSTER_HEADER + '\n'));
  assert.ok(!/emerald\.exe/i.test(GAP_POSTER_HEADER));
});

test("the toast's words are escaped for the xml and the quote for PowerShell", () => {
  const s = posterScript(`a & b's <tag>`, 'x', 0, 'app.id');
  assert.ok(s.includes('<text>a &amp; b&apos;s &lt;tag&gt;</text>'));
  assert.ok(s.includes(`$xml.LoadXml('<toast>`));
  assert.ok(s.endsWith('Start-Sleep -Seconds 0\n'));
  assert.ok(!s.includes('Add-Content'));
});

test('held: the script is written under the home with the version in it, the log says so, nothing spawns', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-poster-'));
  const log: string[] = [];
  postInstallPoster(home, '0.1.319', (m) => log.push(m), { held: true });
  const file = posterScriptPath(home);
  assert.equal(file, path.join(home, 'install-poster.ps1'));
  const s = fs.readFileSync(file, 'utf8');
  assert.ok(s.includes('<text>Installing emerald 0.1.319</text>'));
  assert.ok(s.includes(`'${APP_AUMID}'`));
  assert.ok(s.includes(`Add-Content -Path '${posterLogPath(home).replace(/'/g, "''")}'`));
  assert.deepEqual(log, ['install poster held (harness)']);
  assert.ok(s.startsWith('# emerald install poster (M9 fix 323)'));
  // M9 fix 385: the worker is written beside the script, held or not.
  assert.equal(fs.readFileSync(posterWorkerPath(home), 'utf8'), POSTER_WORKER_JS);
  fs.rmSync(home, { recursive: true, force: true });
});

// M9 fix 385: the spawn is the running exe as node on the worker, which
// runs PowerShell attached to itself; nothing spawns powershell.exe
// detached any more, since a detached PowerShell 5.1 has no console and
// exits at once having run nothing.
test('the poster spawn is the app exe as node on the worker, with PowerShell and the script as its arguments', () => {
  const home = 'C:\\h';
  const s = posterWorkerSpawn(installPosterFiles(home), 'C:\\Programs\\emerald\\Emerald.exe', { SystemRoot: 'C:\\Windows', PATH: 'x' });
  assert.equal(s.exe, 'C:\\Programs\\emerald\\Emerald.exe');
  assert.deepEqual(s.args, [path.join(home, 'poster-worker.js'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', path.join(home, 'install-poster.ps1')]);
  assert.equal(s.env['ELECTRON_RUN_AS_NODE'], '1');
  assert.equal(s.env['PATH'], 'x');
  // The worker runs PowerShell attached (spawnSync, no detached), hidden, and
  // hands it the script by -File, which is the shape that has a console.
  assert.ok(POSTER_WORKER_JS.includes("spawnSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'ignore', windowsHide: true })"));
  assert.ok(!POSTER_WORKER_JS.includes('detached'));
});

test('a home that cannot be written is logged as a failure, not thrown', () => {
  const log: string[] = [];
  // A file where the home folder should be.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-poster-'));
  const home = path.join(dir, 'not-a-folder');
  fs.writeFileSync(home, '');
  postInstallPoster(home, '0.1.319', (m) => log.push(m), { held: true });
  assert.equal(log.length, 1);
  assert.ok(log[0]!.startsWith('install poster failed: could not write '));
  fs.rmSync(dir, { recursive: true, force: true });
});

// M9 fix 408: the gap launch's word goes through a worker of the same
// shape, on three files of its own so it never writes over the install
// poster still sleeping out its ninety seconds.
test("the gap's three files sit beside the install poster's and its spawn names its own two", () => {
  const home = 'C:\\h';
  assert.equal(gapScriptPath(home), path.join(home, 'gap-poster.ps1'));
  assert.equal(gapLogPath(home), path.join(home, 'gap-poster.log'));
  assert.equal(gapWorkerPath(home), path.join(home, 'gap-poster.js'));
  const files = gapPosterFiles(home);
  assert.equal(files.label, 'install-gap poster');
  assert.equal(installPosterFiles(home).label, 'install poster');
  // No file is shared with the install poster's three.
  const install = installPosterFiles(home);
  assert.ok(files.script !== install.script && files.log !== install.log && files.worker !== install.worker);
  const s = posterWorkerSpawn(files, 'C:\\Programs\\emerald\\Emerald.exe', { SystemRoot: 'C:\\Windows' });
  assert.deepEqual(s.args, [path.join(home, 'gap-poster.js'), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', path.join(home, 'gap-poster.ps1')]);
});

test("held: the gap poster writes gap-poster.ps1 with the gap's two lines and holds for the seconds it says are left", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-gap-poster-'));
  const t0 = Date.parse('2026-09-22T10:00:00.000Z');
  const marker = { version: '0.1.394', at: new Date(t0).toISOString() };
  const log: string[] = [];
  postGapPoster(home, marker, t0 + 20000, (m) => log.push(m), { held: true });
  const s = fs.readFileSync(gapScriptPath(home), 'utf8');
  // The gap's script names its own fix, not the install poster's (M9 fix 447).
  assert.ok(s.startsWith('# emerald install-gap poster (M9 fix 408)'));
  assert.ok(!s.includes('fix 323'));
  assert.ok(s.includes('<text>Still installing emerald 0.1.394</text><text>About 40 s to go; the window comes back on its own.</text>'));
  // The hold is the seconds the body names, so the poster goes when the
  // new build is due rather than sitting on the screen behind it.
  assert.ok(s.endsWith('Start-Sleep -Seconds 40\n'));
  assert.ok(s.includes(`Add-Content -Path '${gapLogPath(home).replace(/'/g, "''")}'`));
  assert.deepEqual(log, ['install-gap poster held (harness)']);
  assert.equal(fs.readFileSync(gapWorkerPath(home), 'utf8'), POSTER_WORKER_JS);
  // The install poster's own three are untouched by a gap launch.
  assert.ok(!fs.existsSync(posterScriptPath(home)) && !fs.existsSync(posterWorkerPath(home)));
  fs.rmSync(home, { recursive: true, force: true });
});
