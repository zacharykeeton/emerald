// smoke:mac (M9 fix 1028): the acceptance of the Mac build, run by
// .github/workflows/mac.yml on a macOS runner against the packaged
// release-mac/mac-arm64/Emerald.app that `npm run dist:mac` wrote. Nobody
// here can run a Mac, so unlike verify:unix it runs every step it can and
// fails at the end: one run shows as much as it can. Every result line is
// `PASS <step>` or `FAIL <step>: <why>`, and a step whose input never came
// reads `FAIL <step>: not run, <the step it waited on> failed`.
//
//   npm run smoke:mac -w @emerald/app -- --out <dir>
//
// It writes every line it prints to <out>/smoke.log, the app's output to
// <out>/app.log and the private home's logs to <out>/home-logs, which the
// workflow keeps as the smoke-logs artifact. The app runs on a private home
// (its daemon on <home>/emmerd.sock), a private profile and a private
// Claude config; it never touches anything outside the home and the bundle,
// and never kills by name. It does not import cdp.mjs, whose module reads
// Windows paths at load: CDP is spoken here through Node's own WebSocket.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appUpdateTarget, macAssetNames } from '@emerald/shared/release';

if (process.platform !== 'darwin') {
  console.log('smoke-mac: runs on macOS only, against the packaged Emerald.app');
  process.exit(2);
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appDir, '..', '..');
const releaseDir = path.join(appDir, 'release-mac');
const version = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const [dmgName, zipName, ymlName] = macAssetNames(version);
const CDP_PORT = 9333;
const WATCHDOG_MS = 300_000;

const argv = process.argv.slice(2);
const outAt = argv.indexOf('--out');
const out = outAt !== -1 && argv[outAt + 1] !== undefined ? path.resolve(argv[outAt + 1]) : path.join(os.tmpdir(), 'emerald-smoke');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const smokeLog = path.join(out, 'smoke.log');
const appLog = path.join(out, 'app.log');

function say(line) {
  console.log(line);
  fs.appendFileSync(smokeLog, line + '\n');
}

// Each step's outcome by its key, so a later step can name the one it
// waited on; `failed` counts every FAIL line, not-run ones included.
const ok = new Map();
let failed = 0;
let steps = 0;
function pass(key, name) {
  ok.set(key, true);
  steps++;
  say(`PASS ${name}`);
}
function fail(key, name, why) {
  ok.set(key, false);
  steps++;
  failed++;
  say(`FAIL ${name}: ${why}`);
}
// The first of the steps named that did not pass, or null when all did.
function blocker(keys) {
  for (const k of keys) if (ok.get(k) !== true) return k;
  return null;
}
const NAMES = new Map();
function gated(key, name, deps) {
  NAMES.set(key, name);
  const b = blocker(deps);
  if (b === null) return true;
  fail(key, name, `not run, ${NAMES.get(b) ?? b} failed`);
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Polls fn until it answers something other than null or undefined, or the
// time is up; answers the last value (null on a timeout). A throw counts as
// not yet, and its message is kept for the FAIL line.
let lastPollError = null;
async function until(ms, fn, every = 250) {
  const end = Date.now() + ms;
  lastPollError = null;
  for (;;) {
    try {
      const v = await fn();
      if (v !== null && v !== undefined) return v;
    } catch (err) {
      lastPollError = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() >= end) return null;
    await sleep(every);
  }
}

function runSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 30_000, ...opts });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error ? r.error.message : null, pid: r.pid };
}

// An async child with a deadline, for the long runs, so the watchdog's
// timer still fires while one is going.
function runAsync(cmd, args, opts, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr, error: null });
    });
  });
}

// The CDP client: one WebSocket per target, requests by id, each with a
// deadline so a hung page fails its step rather than the run.
async function cdpOpen(wsUrl, ms = 10_000) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // never opened
      }
      reject(new Error(`${wsUrl} did not open in ${ms} ms`));
    }, ms);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`could not open ${wsUrl}`));
    };
  });
  let next = 0;
  const pending = new Map();
  ws.onclose = () => {
    for (const done of pending.values()) done({ error: { message: 'the devtools socket closed' } });
    pending.clear();
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    const done = pending.get(m.id);
    if (done !== undefined) {
      pending.delete(m.id);
      done(m);
    }
  };
  return {
    send(method, params = {}, ms = 5000) {
      const id = ++next;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} got no answer in ${ms} ms`));
        }, ms);
        pending.set(id, (m) => {
          clearTimeout(timer);
          if (m.error) reject(new Error(`${method}: ${m.error.message}`));
          else resolve(m.result);
        });
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        // already closed
      }
    },
  };
}
async function evalJs(page, expression) {
  const r = await page.send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`the page threw: ${r.exceptionDetails.text}`);
  return r.result.value;
}
// Every devtools read has a deadline: at the first runner run a read with
// none held the smoke to its watchdog with no step named.
async function cdpJson(route, ms = 5000) {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}${route}`, { signal: AbortSignal.timeout(ms) });
  return r.json();
}

// What a failed window step leaves for whoever reads the artifact, since
// nobody can look at the runner's screen: the devtools targets, a
// screenshot, and a sample of the app's main process (a main thread blocked
// in a modal or a sync call shows there).
async function evidence(label) {
  try {
    fs.writeFileSync(path.join(out, `targets-${label}.json`), JSON.stringify(await cdpJson('/json'), null, 2));
  } catch (err) {
    fs.writeFileSync(path.join(out, `targets-${label}.json`), JSON.stringify({ error: err.message }));
  }
  runSync('screencapture', ['-x', path.join(out, `screen-${label}.png`)], { timeout: 15_000 });
  if (child !== null && !childExited) runSync('sample', [String(child.pid), '2', '-file', path.join(out, `sample-${label}.txt`)], { timeout: 30_000 });
  say(`smoke-mac: evidence for ${label} in ${out} (targets-${label}.json, screen-${label}.png, sample-${label}.txt)`);
}

// The state the clean-up reads.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'emsmoke-'));
const sock = path.join(home, 'emmerd.sock');
const mount = path.join(home, 'dmg');
let mounted = false;
let child = null;
let childExited = false;
let daemonPid = null;
let daemonCommand = null;
let page = null;
let appPath = null;
let emmer = null;

const env = { ...process.env };
delete env['EMERALD_PIPE'];
delete env['ELECTRON_RUN_AS_NODE'];
delete env['EMERALD_WINDOW'];
Object.assign(env, {
  EMERALD_HOME: home,
  EMERALD_WHATS_NEW: 'off',
  EMERALD_NO_UPDATE: '1',
  EMERALD_NOTIFY_LOG: path.join(home, 'notify.jsonl'),
  CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'),
  EMERALD_CLAUDE_HOME: path.join(home, 'claude-home'),
  CLAUDE_CONFIG_DIR: path.join(home, 'claude-config'),
});

function psCommand(pid) {
  const r = runSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' }, timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

let cleaned = false;
function cleanUp() {
  if (cleaned) return;
  cleaned = true;
  page?.close();
  if (mounted) runSync('hdiutil', ['detach', mount, '-force'], { timeout: 30_000 });
  if (child !== null && !childExited) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // the group is gone
    }
  }
  if (emmer !== null && fs.existsSync(path.join(home, 'daemon.json'))) {
    runSync('sh', [emmer, 'daemon', 'stop'], { env, timeout: 20_000 });
  }
  // Killed by pid only while the pid still runs the command read at the
  // daemon's start: a number remembered a minute ago may be another
  // process by now (CLAUDE.md's pid-reuse trap).
  if (daemonPid !== null && daemonCommand !== null && psCommand(daemonPid) === daemonCommand) {
    try {
      process.kill(daemonPid, 'SIGKILL');
    } catch {
      // gone between the read and the kill
    }
  }
  try {
    if (fs.existsSync(path.join(home, 'logs'))) fs.cpSync(path.join(home, 'logs'), path.join(out, 'home-logs'), { recursive: true });
  } catch (err) {
    say(`smoke-mac: could not copy the home's logs: ${err.message}`);
  }
  fs.rmSync(home, { recursive: true, force: true });
}

const watchdog = setTimeout(() => {
  say(`FAIL watchdog: the smoke ran past ${WATCHDOG_MS / 1000} s`);
  cleanUp();
  process.exit(3);
}, WATCHDOG_MS);

async function main() {
  const t0 = Date.now();
  say(`smoke-mac: Emerald ${version}, home ${home}, out ${out}`);

  // 1. The three files, and the socket path under macOS's cap (fix 1015).
  const s1 = `the build holds ${dmgName}, ${zipName} and ${ymlName}`;
  NAMES.set('build', s1);
  {
    const missing = [dmgName, zipName, ymlName].filter((f) => !fs.existsSync(path.join(releaseDir, f)));
    const yml = fs.existsSync(path.join(releaseDir, ymlName)) ? fs.readFileSync(path.join(releaseDir, ymlName), 'utf8') : '';
    const sockBytes = Buffer.byteLength(sock);
    if (missing.length > 0) fail('build', s1, `missing in ${releaseDir}: ${missing.join(', ')}`);
    else if (!yml.includes(zipName) || !new RegExp(`^version: ${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(yml)) fail('build', s1, `${ymlName} does not name ${zipName} at ${version}: ${JSON.stringify(yml.slice(0, 300))}`);
    else if (sockBytes > 100) fail('build', s1, `the home's socket path is ${sockBytes} bytes, over 100: ${sock}`);
    else pass('build', s1);
  }
  const bundle = path.join(releaseDir, 'mac-arm64', 'Emerald.app');
  if (fs.existsSync(bundle)) {
    appPath = fs.realpathSync(bundle);
    emmer = path.join(appPath, 'Contents', 'Resources', 'bin', 'emmer');
    ok.set('bundle', true);
  } else {
    ok.set('bundle', false);
  }
  NAMES.set('bundle', `the bundle at ${bundle}`);

  // 2. The dmg mounts and holds a signed app.
  const s2 = 'the dmg holds a signed Emerald.app';
  if (gated('dmg', s2, ['build'])) {
    fs.mkdirSync(mount, { recursive: true });
    const a = runSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, path.join(releaseDir, dmgName)], { timeout: 120_000 });
    if (a.status !== 0) {
      fail('dmg', s2, `hdiutil attach exited ${a.status}: ${(a.stderr || a.error || '').trim()}`);
    } else {
      mounted = true;
      const inDmg = path.join(mount, 'Emerald.app');
      if (!fs.existsSync(path.join(inDmg, 'Contents', 'MacOS', 'Emerald'))) {
        fail('dmg', s2, `no Emerald.app/Contents/MacOS/Emerald in the dmg: ${fs.readdirSync(mount).join(', ')}`);
      } else {
        const v = runSync('codesign', ['--verify', '--deep', inDmg], { timeout: 120_000 });
        if (v.status === 0) pass('dmg', s2);
        else fail('dmg', s2, `codesign --verify --deep exited ${v.status}: ${v.stderr.trim()}`);
      }
      const d = runSync('hdiutil', ['detach', mount], { timeout: 60_000 });
      if (d.status === 0) mounted = false;
    }
  }

  // 3. The bundle's signature is ad hoc.
  const s3 = 'the app is signed ad hoc';
  if (gated('adhoc', s3, ['bundle'])) {
    const r = runSync('codesign', ['-dv', appPath]);
    if (r.status === 0 && r.stderr.includes('Signature=adhoc')) pass('adhoc', s3);
    else fail('adhoc', s3, `codesign -dv exited ${r.status}: ${r.stderr.trim()}`);
  }

  // 4. The updater's target.
  const s4 = "the app's updater reads github zacharykeeton/emerald";
  if (gated('updater', s4, ['bundle'])) {
    const f = path.join(appPath, 'Contents', 'Resources', 'app-update.yml');
    const target = fs.existsSync(f) ? appUpdateTarget(fs.readFileSync(f, 'utf8')) : 'no app-update.yml';
    if (target === 'github zacharykeeton/emerald') pass('updater', s4);
    else fail('updater', s4, `it reads ${target}`);
  }

  // 5. The shim's mode, before anything uses it (asked by mac-hooks-shim).
  const s5 = 'the staged emmer is executable';
  if (gated('emmer', s5, ['bundle'])) {
    const r = runSync('sh', ['-c', 'test -x "$1"', 'sh', emmer]);
    if (r.status === 0) pass('emmer', s5);
    else fail('emmer', s5, `test -x exited ${r.status} on ${emmer}`);
  }

  // 6. The launch, on the private home and profile.
  const s6 = 'the app launches';
  if (gated('launch', s6, ['bundle'])) {
    const exe = path.join(appPath, 'Contents', 'MacOS', 'Emerald');
    child = spawn(exe, [`--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${path.join(home, 'profile')}`], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    child.stdout.on('data', (d) => fs.appendFileSync(appLog, d));
    child.stderr.on('data', (d) => fs.appendFileSync(appLog, d));
    let spawnError = null;
    child.on('error', (err) => (spawnError = err.message));
    child.on('exit', (code, signal) => {
      childExited = true;
      fs.appendFileSync(appLog, `\n[smoke-mac] the app exited, code ${code} signal ${signal}\n`);
    });
    await sleep(1000);
    if (spawnError !== null) fail('launch', s6, spawnError);
    else if (childExited) fail('launch', s6, 'the app exited within a second; see app.log');
    else pass('launch', s6);
  }

  // 7. The window: a page titled Emerald, its title row's name drawn.
  const s7 = 'the window is up';
  if (gated('window', s7, ['launch'])) {
    const target = await until(60_000, async () => {
      const list = await cdpJson('/json');
      return list.find((t) => t.type === 'page' && t.title === 'Emerald') ?? null;
    }, 500);
    if (target === null) {
      fail('window', s7, `no page titled Emerald on port ${CDP_PORT} in 60 s${lastPollError ? ` (${lastPollError})` : ''}`);
      await evidence('window');
    } else {
      try {
        page = await cdpOpen(target.webSocketDebuggerUrl);
        // As cdp.mjs does before its first evaluate.
        await page.send('Runtime.enable', {}, 20_000);
        const name = await until(20_000, async () => ((await evalJs(page, "document.querySelector('.title-bar-name')?.textContent ?? null")) === 'emerald' ? true : null));
        if (name === true) pass('window', s7);
        else fail('window', s7, `.title-bar-name never read emerald${lastPollError ? ` (${lastPollError})` : ''}`);
      } catch (err) {
        fail('window', s7, err.message);
      }
      if (ok.get('window') !== true) await evidence('window');
    }
  }

  // 8. The darwin inset for the traffic lights (fix 1023): these two
  // reads are that fix's only proof anywhere.
  const s8 = 'the window draws for darwin';
  if (gated('darwin', s8, ['window'])) {
    try {
      const r = await evalJs(page, "({ mark: document.documentElement.dataset.platform ?? null, inset: getComputedStyle(document.querySelector('.title-bar')).paddingLeft })");
      if (r.mark === 'darwin' && r.inset === '78px') pass('darwin', s8);
      else fail('darwin', s8, `data-platform ${JSON.stringify(r.mark)}, .title-bar padding-left ${JSON.stringify(r.inset)}`);
    } catch (err) {
      fail('darwin', s8, err.message);
    }
  }

  // 9. The app's daemon, on its socket, under the app's own executable.
  const s9 = 'the daemon is up on its socket';
  if (gated('daemon', s9, ['launch'])) {
    const info = await until(60_000, () => {
      const f = path.join(home, 'daemon.json');
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    }, 500);
    if (info === null) {
      fail('daemon', s9, `no daemon.json in ${home} in 60 s${lastPollError ? ` (${lastPollError})` : ''}`);
    } else {
      daemonPid = info.pid;
      // Read once, right after daemon.json appears, never by the pid alone later.
      daemonCommand = psCommand(info.pid);
      const exe = path.join(appPath, 'Contents', 'MacOS', 'Emerald');
      let isSock = false;
      try {
        isSock = fs.statSync(info.pipe).isSocket();
      } catch {
        // not there
      }
      if (info.pipe !== sock) fail('daemon', s9, `daemon.json names ${info.pipe}, not ${sock}`);
      else if (!isSock) fail('daemon', s9, `${info.pipe} is not a socket`);
      else if (daemonCommand === null || !daemonCommand.includes(exe) || !daemonCommand.includes('Contents/Resources/daemon/dist/main.js')) fail('daemon', s9, `pid ${info.pid} runs ${JSON.stringify(daemonCommand)}`);
      else pass('daemon', s9);
    }
  }

  // 10. The PATH banner (fix 1026): the runner has no emmer on any PATH.
  const s10 = "the PATH banner names the bundle's emmer";
  if (gated('banner', s10, ['window'])) {
    const want = `emmer is not on your PATH. Paste in a terminal: sudo mkdir -p /usr/local/bin && sudo ln -sf "${emmer}" /usr/local/bin/emmer`;
    let text = null;
    try {
      text = await until(10_000, async () => {
        const t = await evalJs(page, "document.querySelector('.path-banner .path-banner-text')?.textContent ?? null");
        return t === want ? t : null;
      });
      if (text === want) pass('banner', s10);
      else fail('banner', s10, `the banner reads ${JSON.stringify(await evalJs(page, "document.querySelector('.path-banner .path-banner-text')?.textContent ?? null"))}, not ${JSON.stringify(want)}`);
    } catch (err) {
      fail('banner', s10, err.message);
    }
  }

  // 11. verify:unix attached to the app's daemon through the staged shim.
  const s11 = "verify:unix on the app's daemon";
  if (gated('unix', s11, ['daemon'])) {
    const script = path.join(repoRoot, 'packages', 'cli', 'scripts', 'verify-unix.mjs');
    if (!fs.existsSync(script)) {
      fail('unix', s11, `${script} is not in this tree`);
    } else {
      const r = await runAsync(process.execPath, [script], { env: { ...env, EMERALD_HOME: home, EMERALD_CLI: emmer } }, 180_000);
      for (const line of `${r.stdout}${r.stderr}`.split('\n')) if (line.trim() !== '') say(`  unix| ${line}`);
      if (r.status === 0) pass('unix', s11);
      else fail('unix', s11, r.error ?? `it exited ${r.status}`);
    }
  }

  // 12. A shell started through the CLI reaches the window's sidebar. After
  // verify:unix, which reads an empty ls near its start.
  const s12 = "a shell's row reaches the window";
  if (gated('row', s12, ['daemon', 'window'])) {
    const work = path.join(home, 'work');
    fs.mkdirSync(work, { recursive: true });
    const r = runSync('sh', [emmer, 'shell', work, '--name', 'smoke-row', '--json'], { env });
    let id = null;
    try {
      id = JSON.parse(r.stdout).session.id;
    } catch {
      // not JSON
    }
    if (r.status !== 0 || typeof id !== 'string') {
      fail('row', s12, `emmer shell exited ${r.status}: ${(r.stdout + r.stderr).trim()}`);
    } else {
      // The id goes into the selector through JSON.stringify (CLAUDE.md's
      // trap: a uuid starting with a digit is an invalid bare selector).
      const sel = `.sidebar-row[data-session-id=${JSON.stringify(id)}]`;
      const expr = `document.querySelector(${JSON.stringify(sel)})?.querySelector('.sidebar-row-name')?.textContent ?? null`;
      try {
        const name = await until(15_000, async () => ((await evalJs(page, expr)) === 'smoke-row' ? true : null));
        if (name === true) pass('row', s12);
        else fail('row', s12, `no row ${sel} named smoke-row in 15 s: ${JSON.stringify(await evalJs(page, expr))}`);
      } catch (err) {
        fail('row', s12, err.message);
      }
    }
  }

  // 13. The window quits by CDP's Browser.close.
  const s13 = 'the window quits';
  if (gated('quit', s13, ['launch'])) {
    try {
      page?.close();
      page = null;
      if (!childExited) {
        const version = await cdpJson('/json/version');
        const browser = await cdpOpen(version.webSocketDebuggerUrl);
        await browser.send('Browser.close').catch(() => {
          // the browser can go before it answers
        });
        browser.close();
      }
      const gone = await until(20_000, () => (childExited ? true : null));
      if (gone === true) pass('quit', s13);
      else fail('quit', s13, 'the app was still running 20 s after Browser.close');
    } catch (err) {
      fail('quit', s13, err.message);
    }
  }

  // 14. The daemon stops through the CLI; its record and socket go.
  const s14 = 'the daemon stops';
  if (gated('stop', s14, ['daemon'])) {
    const r = runSync('sh', [emmer, 'daemon', 'stop'], { env, timeout: 30_000 });
    if (r.status !== 0) {
      fail('stop', s14, `emmer daemon stop exited ${r.status}: ${(r.stdout + r.stderr).trim()}`);
    } else {
      const gone = await until(10_000, () => (!fs.existsSync(path.join(home, 'daemon.json')) && !fs.existsSync(sock) ? true : null));
      if (gone === true) pass('stop', s14);
      else fail('stop', s14, `still there 10 s after the stop: ${[path.join(home, 'daemon.json'), sock].filter((f) => fs.existsSync(f)).join(', ')}`);
    }
  }

  // 15. Nothing of the bundle or the home left running.
  const s15 = 'nothing is left running';
  NAMES.set('left', s15);
  {
    let lines = [];
    const clear = await until(10_000, () => {
      const r = runSync('ps', ['-A', '-ww', '-o', 'pid=,command='], { env: { ...process.env, LC_ALL: 'C' }, timeout: 5000 });
      lines = r.stdout
        .split('\n')
        .filter((l) => l.trim() !== '')
        .filter((l) => {
          const pid = Number(l.trim().split(/\s+/)[0]);
          if (pid === process.pid || pid === r.pid) return false;
          return (appPath !== null && l.includes(appPath)) || l.includes(home);
        });
      return lines.length === 0 ? true : null;
    }, 500);
    if (clear === true) pass('left', s15);
    else fail('left', s15, `still running: ${lines.join(' | ')}`);
  }

  say(`smoke-mac: ${steps} steps, ${failed} failed, in ${Math.round((Date.now() - t0) / 1000)} s`);
}

try {
  await main();
} catch (err) {
  failed++;
  say(`FAIL smoke-mac: ${err instanceof Error ? err.stack : String(err)}`);
}
clearTimeout(watchdog);
cleanUp();
process.exit(failed > 0 ? 1 : 0);
