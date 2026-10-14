// M7 acceptance, part 1: the staged daemon and CLI are self-contained. Runs
// stage.mjs, copies the result to %TEMP%\emerald-verify\stage so Node's upward
// node_modules walk can never reach the repo, then drives bin\emmer.cmd (the
// shim falls back to node when there is no Emerald.exe above it) under a private
// EMERALD_HOME and EMERALD_PIPE: daemon start, a shell, send and read, kill, stop.
// Logs to %TEMP%\emerald-verify\stage.log. Build first (npm run build).
// Run: npm run verify:stage -w @emerald/app
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stage } from './stage.mjs';

const verifyDir = path.join(os.tmpdir(), 'emerald-verify');
const stageCopy = path.join(verifyDir, 'stage');
const home = path.join(verifyDir, 'stage-home');
const logFile = path.join(verifyDir, 'stage.log');
const shim = path.join(stageCopy, 'bin', 'emmer.cmd');
const env = { ...process.env, EMERALD_HOME: home, EMERALD_PIPE: '\\\\.\\pipe\\emmerd-verify-stage' };
const t0 = Date.now();

fs.mkdirSync(verifyDir, { recursive: true });
fs.writeFileSync(logFile, '');

setTimeout(() => {
  log('WATCHDOG: run exceeded 60 s');
  stopDaemonHard();
  process.exit(3);
}, 60000);

function log(msg) {
  const line = `[verify +${((Date.now() - t0) / 1000).toFixed(2)}s] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + '\n');
}

function expect(cond, what) {
  if (!cond) {
    log(`FAIL: ${what}`);
    stopDaemonHard();
    process.exit(1);
  }
  log(`ok: ${what}`);
}

function emerald(...args) {
  const r = spawnSync('cmd.exe', ['/d', '/c', shim, ...args], { env, encoding: 'utf8', windowsHide: true });
  const out = r.stdout ?? '';
  const err = r.stderr ?? '';
  fs.appendFileSync(logFile, `$ emerald ${args.join(' ')}\n${out}${err}[exit ${r.status}]\n`);
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

function readDaemonInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
  } catch {
    return null;
  }
}

function stopDaemonHard() {
  const info = readDaemonInfo();
  if (info !== null) spawnSync('taskkill', ['/pid', String(info.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function main() {
  const staged = stage();
  log(`staged ${staged}`);
  fs.rmSync(stageCopy, { recursive: true, force: true });
  fs.cpSync(staged, stageCopy, { recursive: true });
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  log(`copied to ${stageCopy}`);
  expect(!fs.existsSync(path.join(verifyDir, 'node_modules')), 'no node_modules above the copy that could hide a missing dependency');
  // M9 fix 225: the terminal's shipped colour schemes ride along, where
  // the installed app's resolveSchemesDir reads them.
  const schemes = fs.existsSync(path.join(stageCopy, 'schemes')) ? fs.readdirSync(path.join(stageCopy, 'schemes')).filter((f) => f.endsWith('.json')) : [];
  expect(schemes.length === 6 && schemes.includes('emerald.json') && schemes.includes('emerald-gem.json') && schemes.includes('solarized-dark.json'), `the six colour schemes are staged under schemes/ (${schemes.join(', ')})`);

  // M9 fix 602: the stage ships only what runs; no test helper or pipe client
  // in the staged daemon or shared, and every module there built from a
  // source that still exists.
  const packagesDir = path.resolve(import.meta.dirname, '..', '..');
  const stagedJs = (pkg, dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => ({ pkg, f }));
  const stagedModules = [...stagedJs('daemon', path.join(stageCopy, 'daemon', 'dist')), ...stagedJs('shared', path.join(stageCopy, 'node_modules', '@emerald', 'shared', 'dist'))];
  const testOnly = stagedModules.filter(({ f }) => f === 'test-temp.js' || f === 'client.js').map(({ pkg, f }) => `${pkg}/${f}`);
  expect(testOnly.length === 0, `no test-temp.js or client.js in the staged daemon or shared (${testOnly.join(', ') || 'none'})`);
  const orphans = stagedModules.filter(({ pkg, f }) => !fs.existsSync(path.join(packagesDir, pkg, 'src', f.replace(/\.js$/, '.ts')))).map(({ pkg, f }) => `${pkg}/${f}`);
  expect(orphans.length === 0, `every staged daemon and shared module has its source (${stagedModules.length} modules, ${orphans.join(', ') || 'no orphans'})`);

  let r = emerald('--version');
  expect(r.code === 0 && /^\d+\.\d+\.\d+$/.test(r.out.trim()), `emmer --version prints a version through the shim (${r.out.trim()})`);

  r = emerald('daemon', 'start');
  expect(r.code === 0 && /^started emmerd/.test(r.out), `daemon start through the shim: ${r.out.trim()}`);
  const info = readDaemonInfo();
  expect(info !== null && info.pipe === env.EMERALD_PIPE, 'daemon.json in the private home names the private pipe');

  const cmdline = powershell(`(Get-CimInstance Win32_Process -Filter "ProcessId = ${info.pid}").CommandLine`);
  expect(cmdline.toLowerCase().includes(path.join(stageCopy, 'daemon', 'dist', 'main.js').toLowerCase()), `daemon runs the staged main.js (${cmdline})`);

  const shell = emeraldJson('shell', os.tmpdir(), '--json');
  expect(shell.code === 0 && shell.json?.session?.kind === 'shell', 'emmer shell starts a shell in the staged daemon');
  const id = shell.json.session.id;
  // node-pty loads its .node files as DLLs on the first spawn, so the process
  // module list now says which copy answered: it must be the staged one, not
  // the repo's. %TEMP% comes back in short 8.3 form, so compare real paths.
  const modules = powershell(`(Get-Process -Id ${info.pid}).Modules | ForEach-Object { $_.FileName }`);
  const ptyModule = modules.split(/\r?\n/).find((m) => m.toLowerCase().endsWith('conpty.node'));
  const realStage = fs.realpathSync.native(stageCopy).toLowerCase();
  const realModule = ptyModule === undefined ? '' : fs.realpathSync.native(ptyModule).toLowerCase();
  expect(realModule.startsWith(realStage), `conpty.node loaded from the staged copy (${realModule})`);
  await sleep(1500);
  r = emerald('send', id, 'echo stage-marker-$(1+1)', '--enter');
  expect(r.code === 0, 'send with --enter');
  await until('marker in read', () => emerald('read', id, '--lines', '40').out.includes('stage-marker-2'));
  expect(true, 'read shows the shell output through the staged node-pty');
  // The screen read goes through the staged @xterm/headless, which the
  // stage left out from M17 until the M29 install; the daemon would not
  // have started at all without it, but this says the render works too.
  r = emerald('read', id, '--screen');
  expect(r.code === 0 && r.out.includes('stage-marker-2'), `read --screen renders through the staged headless xterm (${r.out.trim().slice(0, 80)})`);

  r = emerald('kill', id);
  expect(r.code === 0, 'kill');
  await until('session exited', () => emeraldJson('ls', '--json').json?.sessions?.[0]?.state === 'exited');
  expect(true, 'ls shows it exited');

  r = emerald('daemon', 'stop');
  expect(r.code === 0 && /^stopped emmerd/.test(r.out), `daemon stop: ${r.out.trim()}`);
  expect(readDaemonInfo() === null, 'daemon.json removed');
  log('PASS');
  process.exit(0);
}

main().catch((err) => {
  log(`ERROR: ${err.stack ?? err}`);
  stopDaemonHard();
  process.exit(1);
});
