// Chrome DevTools Protocol driver for the built app. Launches Electron with
// remote debugging, evaluates JS in the renderer, dispatches input, takes
// screenshots. Used by the verify-*.mjs scripts; build the app first.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const emeraldHome = process.env['EMERALD_HOME'] ?? path.join(os.homedir(), '.emerald');
export const shotsDir = path.join(os.tmpdir(), 'emerald-verify');
const electron = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
const appMain = path.join(repoRoot, 'packages', 'app', 'out', 'main', 'index.js');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// M9 fix 601: the verify scripts' <name>-<pid> fixture folders under
// shotsDir. Each script removes its own in a finally that a watchdog's
// process.exit, a killed runner or a taskkill skips, so a fresh launch sweeps
// the ones more than two hours old. The longest watchdog is 780 s
// (verify:graph) and no script dates a fixture back, so no live run's folder
// is that old by its mtime, which is set when the folder is made and moves
// only when an entry directly in it comes or goes. Never a file, never a name
// without the -<digits> tail (m9-home, stage, cli-claude-home), never the
// emerald-verify-<tag> homes beside the folder, and never a judgement by pid,
// which Windows recycles within minutes. A folder that will not go is left
// for the next sweep, and nothing here throws.
const FIXTURE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export function sweepFixtures() {
  const t0 = Date.now();
  let removed = 0;
  let left = 0;
  try {
    for (const entry of fs.readdirSync(shotsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/-\d+$/.test(entry.name)) continue;
      const dir = path.join(shotsDir, entry.name);
      try {
        if (t0 - fs.statSync(dir).mtimeMs <= FIXTURE_MAX_AGE_MS) continue;
        fs.rmSync(dir, { recursive: true, force: true });
        removed += 1;
      } catch {
        left += 1;
      }
    }
  } catch {
    /* no shotsDir yet: nothing to sweep */
  }
  console.log(`fixture sweep: ${removed} removed, ${left} left, ${Date.now() - t0} ms`);
  return { removed, left };
}

// When this module was loaded, so step() lines carry the seconds since
// the script started (M9 fix 566); nothing parses the prefix.
const loadedAt = Date.now();

// Debugging ports are not reusable right after the instance that owned one
// quits, so every launch in a script should get its own, and launch moves
// off a held one anyway (M9 fix 319): a just-closed harness window's port
// stays bound a while, so two scripts of one close-out run drew a held
// port and failed at launch with `no page target`. launch reads the port
// twice over, since the two reads see different things: the probe below
// binds a plain listener, which a port in TIME_WAIT or held by a live
// window refuses, and Chromium's own server can still refuse a port the
// probe passed (it binds differently), which only its stderr says, so the
// spawn is watched for that line too and tried again on the next port.
// EMERALD_CDP_PORT pins the first port, for fix 319's proof alone.
export function freshPort() {
  const pinned = Number(process.env['EMERALD_CDP_PORT']);
  return Number.isInteger(pinned) && pinned > 0 ? pinned : 9400 + (Date.now() % 400);
}

// One attempt to bind port on the loopback address; false when it is held.
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function freePortFrom(port) {
  for (let i = 0; i < 5; i++) {
    if (await portFree(port + i)) {
      if (i > 0) console.log(`devtools port ${port} held, using ${port + i}`);
      return port + i;
    }
  }
  throw new Error(`no free devtools port from ${port} to ${port + 4}`);
}

// What Chromium prints when it could not bind the debugging port it was
// given; the window is up with no way in, so the spawn is retried.
const refusedPort = (text) => /Cannot start http server for devtools|bind\(\) returned an error/.test(text);

// The Electron profile (localStorage, the caches) of every window a
// script launches on this home (M9 fix 115). Electron's default is one
// profile per app under %APPDATA%, shared by every run on the machine,
// and two launches close together fought over its cache (`Unable to
// move the cache: Access is denied`, then no page target); a profile
// under the run's own EMERALD_HOME is that run's alone, carries what a
// script writes across its own relaunches, and goes with stopDaemon.
export const profileOf = (home) => path.join(home, 'electron-profile');
export const profileDir = profileOf(emeraldHome);

// The Claude home a harness window reads (M9 fix 163): an empty folder
// under the run's own home unless the script seeded one, never the
// user's ~/.claude. Every window on the real home read the credentials
// file and polled the usage endpoint every five minutes and on every
// focus emulation, and three worktrees' runs put four or more clients on
// one account's rate limit; on an empty home the strip reads signed-out
// and never asks. The history scan and the daemon's task files read the
// same variable, so a script that needs transcripts seeds its own.
export function harnessClaudeHome(home) {
  const chosen = process.env['EMERALD_CLAUDE_HOME'] ?? path.join(home, 'claude-home');
  const real = path.join(os.homedir(), '.claude');
  if (path.resolve(chosen).toLowerCase() === path.resolve(real).toLowerCase()) throw new Error(`a harness must not read the real Claude home ${real}`);
  fs.mkdirSync(chosen, { recursive: true });
  return chosen;
}

// M9 fix 620: the window writes two Electron lines about its sandboxed
// renderer bundle on about half the harness launches, whatever the run is
// doing; they sat in 187 of 188 kept FAIL dumps and one seat took them for
// the cause. They are dropped here, at the push, so no dump prints them;
// main.log still has them. A line can straddle two chunks, so each stream
// keeps a carry of the line not yet ended.
function windowLines(logs) {
  const dropped = (line) =>
    line.includes('(node:electron/js2c/sandbox_bundle:') &&
    (line.includes('sandboxed_renderer.bundle.js script failed to run') ||
      line.includes("Cannot destructure property 'preloadScripts' of 'binding.startupData'"));
  let carry = '';
  return {
    data(chunk) {
      const pieces = (carry + chunk.toString()).split('\n');
      carry = pieces.pop();
      const kept = pieces.filter((line) => !dropped(line));
      if (kept.length > 0) logs.push(kept.map((line) => line + '\n').join(''));
    },
    end() {
      if (carry !== '' && !dropped(carry)) logs.push(carry);
      carry = '';
    },
  };
}

// opts.pair = { home, pipe } launches on another home and pipe than the
// script's own, for the step that runs two windows side by side.
// opts.env adds to or overrides the window's environment; the two uses are
// EMERALD_WHATS_NEW=on for the step that tests the What's New tab's opening
// (M9 fix 227), which every other launch turns off so no script meets a
// surprise tab on its fresh profile, and EMERALD_SKIN: undefined for
// verify:skin's default block, which unsets the Classic pin (M9 fix 628).
export async function launch(port, opts = {}) {
  const home = opts.pair?.home ?? emeraldHome;
  const profile = profileOf(home);
  // A fresh run must not inherit panes pointing at sessions of a dead daemon,
  // nor that daemon's sessions listed as exited, nor the localStorage a
  // run killed on this home left behind.
  if (opts.freshState) {
    for (const f of ['state.json', 'sessions.json', 'daemon.json']) fs.rmSync(path.join(home, f), { force: true });
    // M9 fix 621: a window that has not quite let go of its profile (a
    // relaunch in verify:files, a rerun right after a failed run) failed
    // the whole run with EPERM here. It is tried again every 200 ms for
    // up to about 11 s, by hand, since rmSync's own maxRetries gives up on
    // EPERM at once on Windows (measured, Node 24); the note lets a
    // close-out count the holds in the logs.
    for (let attempt = 0; ; attempt += 1) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch (err) {
        if ((err.code !== 'EPERM' && err.code !== 'EBUSY') || attempt === 55) throw err;
        if (attempt === 0) console.log('[verify] note: the electron profile was held');
        await sleep(200);
      }
    }
    sweepFixtures();
  }
  fs.mkdirSync(shotsDir, { recursive: true });
  fs.mkdirSync(profile, { recursive: true });
  // The window is shown without focus and off the screen (M9 fix 48): a
  // run beside the user's own emerald used to pop its window up in front
  // and take the keyboard on every launch and again on Page.bringToFront.
  const pairEnv = opts.pair === undefined ? {} : { EMERALD_HOME: opts.pair.home, EMERALD_PIPE: opts.pair.pipe };
  // M9 fix 606: the window's hooks status, and since this fix its settings
  // watcher, read CLAUDE_SETTINGS; without it a harness read the user's own
  // settings and would have watched them.
  const env = {
    ...process.env,
    EMERALD_WINDOW: 'background',
    EMERALD_WHATS_NEW: 'off',
    // M9 fix 628: Emerald is the default skin; the harness runs on Classic,
    // where the Classic scripts hold the Classic colour reads and
    // verify:skin their Emerald twins. Before opts.env, so a launch can
    // override it.
    EMERALD_SKIN: 'classic',
    EMERALD_CLAUDE_HOME: harnessClaudeHome(home),
    CLAUDE_SETTINGS: process.env['CLAUDE_SETTINGS'] ?? path.join(home, 'claude-settings.json'),
    ...pairEnv,
    ...(opts.env ?? {}),
  };
  // Up to three spawns: a port the probe passed can still be refused by
  // Chromium's own server (the comment above freshPort), in which case
  // that window is killed and the next port tried.
  let child;
  let logs;
  let pages = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    port = await freePortFrom(port);
    // The scale is pinned to 1 so a pixel read means the same on any
    // display: with the box's only screen at 150% the window drew at a
    // device pixel ratio of 1.5 and a 1px border read 0.667px.
    child = spawn(electron, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--force-device-scale-factor=1', appMain], { stdio: ['ignore', 'pipe', 'pipe'], env });
    logs = [];
    const out = windowLines(logs);
    const err = windowLines(logs);
    child.stdout.on('data', out.data);
    child.stdout.on('end', out.end);
    child.stderr.on('data', err.data);
    child.stderr.on('end', err.end);
    const deadline = Date.now() + 20000;
    pages = [];
    let refused = false;
    while (Date.now() < deadline) {
      if (refusedPort(logs.join(''))) {
        refused = true;
        break;
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
        // The window is a page target before it has navigated, and on an
        // about:blank origin localStorage is denied, so wait for the app.
        pages = (await res.json()).filter((p) => p.type === 'page' && !p.url.startsWith('about:'));
        if (pages.length > 0) break;
      } catch {
        // Electron is still starting.
      }
      await sleep(200);
    }
    if (!refused) break;
    console.log(`devtools port ${port} refused by Chromium, respawning on ${port + 1}`);
    // The tree kill takes the daemon that window spawned; give it a
    // moment so the next window does not attach to a dying one.
    killTree(child);
    await sleep(1500);
    port += 1;
  }
  if (pages.length === 0) throw new Error('no page target: ' + logs.join(''));
  // M9 fix 645: a connect that gives up ends the window it spawned (Node's
  // handle alone, never killTree, which takes the daemon) and carries this
  // window's lines, since a relaunch's catch prints the old session's.
  let session;
  try {
    session = await connect(pages[0].webSocketDebuggerUrl);
  } catch (err) {
    child.kill();
    throw new Error(`${err.message}; the window's lines: ${logs.join('')}`);
  }
  session.port = port;
  // The page is told it has focus rather than being brought to the front,
  // so document.hasFocus() and the checks built on it (the focused pane's
  // ack, M9 fix 30) read as they would under a person, while the window
  // stays behind and off the screen. Animation frames and the visibility
  // state are not emulated; nothing under test may depend on them (M4).
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  session.child = child;
  session.logs = logs;
  // The target lists the app's URL as soon as the navigation is pending,
  // while the document is still the initial about:blank; a script's first
  // read used to land there under load, so hand back a committed app.
  await session.waitFor(`!!document.querySelector('.app-body')`, 'the app document', 20000);
  return session;
}

// The box's font-smoothing setting (M9 fix 329; CLAUDE.md's fixes 319 to
// 328 bullet): "best performance" turns it off along with animation
// effects, and the width fixtures in this repo were measured with it on,
// so a box with it off reads every pixel a few wider. Read once per
// process with `reg query`; it does not change while a script runs.
let fontSmoothingRaw;
function fontSmoothingOn() {
  if (fontSmoothingRaw === undefined) {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'FontSmoothing'], { encoding: 'utf8' });
      const m = out.match(/FontSmoothing\s+REG_\w+\s+(\S+)/);
      fontSmoothingRaw = m ? m[1] : '0';
    } catch {
      fontSmoothingRaw = '0';
    }
  }
  return fontSmoothingRaw === '2';
}

// The two lines a launch prints about the box's motion and font settings,
// pulled out pure so the off form is provable without changing the box.
export function boxLines(reducedMotion, fontSmoothingIsOn) {
  const anim = reducedMotion ? 'OFF' : 'on';
  const font = fontSmoothingIsOn ? 'on' : 'OFF (0)';
  const lines = [`[cdp] box: animation effects ${anim}, font smoothing ${font}`];
  if (reducedMotion || !fontSmoothingIsOn) {
    lines.push('[cdp] a box with either off fails every animation and width read; turn both on: Animation effects in Settings > Accessibility > Visual effects, and "Smooth edges of screen fonts" in System Properties > Advanced > Performance Settings');
  }
  return lines;
}

// Races a promise against a timer and rejects with the message when the
// timer wins (M9 fix 645). The loser's later rejection, a socket closing
// on a send that never answered, is swallowed so it cannot surface as an
// unhandled rejection after the race is over.
function within(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function connect(wsUrl) {
  // One budget from here to the box read (M9 fix 645): a window whose
  // devtools never answered held two runs to the watchdog with no step named.
  const CONNECT_MS = 20000;
  const connectBy = Date.now() + CONNECT_MS;
  const connectLeft = () => Math.max(0, connectBy - Date.now());
  const tooSlow = "the window's devtools did not answer within 20 s";
  const ws = new WebSocket(wsUrl);
  try {
    await within(new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    }), connectLeft(), tooSlow);
  } catch (err) {
    ws.close();
    throw err;
  }
  let nextId = 1;
  const pending = new Map();
  // Page console output, timestamped, for post-mortems.
  const consoleLog = [];
  // Event handlers by method, for a caller that wants the protocol's own
  // events (the latency bench collects Tracing.dataCollected).
  const handlers = new Map();
  const on = (method, handler) => {
    handlers.set(method, handler);
    return () => handlers.delete(method);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description ?? a.type)).join(' ');
      consoleLog.push(`${new Date(msg.params.timestamp).toISOString()} ${msg.params.type} ${text}`);
      return;
    }
    if (msg.method !== undefined) {
      handlers.get(msg.method)?.(msg.params);
      return;
    }
    if (msg.id === undefined) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (p === undefined) return;
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  };
  // A closed socket must fail every waiting call instead of hanging forever,
  // which is what happens when the window being driven closes.
  ws.onclose = () => {
    for (const p of pending.values()) p.reject(new Error('devtools socket closed'));
    pending.clear();
  };
  // When the last real press went out (M9 fix 450): a mouse press or a key
  // down is fix 30's "recent input" for RECENT_INPUT_MS, and a focused pane
  // whose session goes done inside it is acknowledged straight to idle.
  let lastPressAt = 0;
  const isPress = (method, params) =>
    (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') ||
    (method === 'Input.dispatchKeyEvent' && (params.type === 'keyDown' || params.type === 'rawKeyDown'));
  // attention-model.ts RECENT_INPUT_MS (10_000), copied since a script
  // cannot import the renderer's TypeScript, plus half a second of slack.
  const RECENT_INPUT_MS = 10_000;
  const pastRecentInput = async () => {
    if (lastPressAt === 0) return;
    const wait = lastPressAt + RECENT_INPUT_MS + 500 - Date.now();
    if (wait > 0) await sleep(wait);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) {
        reject(new Error('devtools socket not open'));
        return;
      }
      if (isPress(method, params)) lastPressAt = Date.now();
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    await within(send('Runtime.enable'), connectLeft(), tooSlow);
    await within(send('Page.enable'), connectLeft(), tooSlow);
  } catch (err) {
    ws.close();
    throw err;
  }

  // Evaluates an expression in the page, awaits promises, returns the JSON value.
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  // With { quietMs } given, a pass at or after that many ms from the call
  // prints how long it took, so a wait's quiet readings exist before
  // anyone sets a bound from them ({ quietMs: 0 } prints every pass).
  const waitFor = async (expression, what, timeoutMs = 15000, { quietMs } = {}) => {
    const start = Date.now();
    const deadline = start + timeoutMs;
    while (Date.now() < deadline) {
      const v = await within(evalJs(expression), Math.max(0, deadline - Date.now()) + 1000, `timed out waiting for ${what} (the page did not answer)`);
      if (v) {
        const ms = Date.now() - start;
        if (quietMs !== undefined && ms >= quietMs) console.log(`[verify] note: ${what} took ${ms} ms`);
        return v;
      }
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  // A frame a person is looking at cannot be overwritten: Photos holds the
  // file open and Windows refuses the write (UNKNOWN on open), which
  // failed two runs during the batch of fixes 195 to 206 while the user
  // had the previous run's frame up. A refused write goes to a stamped
  // name beside it, said on stderr, so the run goes on and the new frame
  // is still there to look at.
  const screenshot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const png = Buffer.from(r.data, 'base64');
    const file = path.join(shotsDir, name);
    try {
      fs.writeFileSync(file, png);
      return file;
    } catch (err) {
      const stamped = file.replace(/\.png$/i, '') + `-${Date.now()}.png`;
      fs.writeFileSync(stamped, png);
      console.error(`[verify] frame ${name} is held open (${err.code ?? err.message}); written as ${path.basename(stamped)}`);
      return stamped;
    }
  };
  const type = (text) => send('Input.insertText', { text });
  const key = async (key, code, keyCode, modifiers = 0) => {
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  // No mouseMoved first: in this Electron build a synthetic move takes five
  // seconds to be acknowledged, while press and release land in milliseconds.
  const click = async (x, y) => {
    await mouse('mousePressed', x, y);
    await mouse('mouseReleased', x, y);
  };
  const rightClick = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 });
  };
  const close = () => ws.close();
  // What the box's settings are, at every launch (M9 fix 329): the batch
  // of fixes 319 to 328 lost ten fork runs to this before one fork found
  // the cause, and a changed box now says so in the log a report reads.
  let reducedMotion;
  try {
    reducedMotion = await within(evalJs(`matchMedia('(prefers-reduced-motion: reduce)').matches`), connectLeft(), tooSlow);
  } catch (err) {
    ws.close();
    throw err;
  }
  for (const line of boxLines(reducedMotion, fontSmoothingOn())) console.log(line);
  return { send, on, evalJs, waitFor, screenshot, type, key, mouse, click, rightClick, pastRecentInput, close, consoleLog };
}

// CDP modifier bits.
export const ALT = 1;
export const CTRL = 2;
export const SHIFT = 8;

// Runs an emerald request from inside the page and returns the result.
export const zreq = (s, type, body) => s.evalJs(`window.emerald.request(${JSON.stringify(type)}, ${JSON.stringify(body)})`);

// The tree of the layout tab on show with the layout's revision on it, the
// shape before M36, so a script reads root and focusedPaneId as it always
// did, and a layout.set of what it got back lands as an edit to that tab.
export const getLayout = async (s) => {
  const { layout } = await zreq(s, 'layout.get', {});
  const tab = layout.tabs.find((t) => t.id === layout.currentTabId);
  return { root: tab.root, focusedPaneId: tab.focusedPaneId, revision: layout.revision };
};

// The whole layout, tabs and all (M36).
export const getTabs = async (s) => (await zreq(s, 'layout.get', {})).layout;

// A page-side expression for waitFor: the focused pane of the tab on show
// is the one given.
export const focusedPaneIs = (paneId) =>
  `(async () => { const l = (await window.emerald.request('layout.get', {})).layout; return l.tabs.find(t => t.id === l.currentTabId).focusedPaneId === ${JSON.stringify(paneId)}; })()`;

export function leaves(layout) {
  const out = [];
  const walk = (n) => (n.kind === 'pane' ? out.push(n) : (walk(n.first), walk(n.second)));
  walk(layout.root);
  return out;
}

// Sets a React-controlled input's value so React sees the change.
export const setInput = (s, selector, value) =>
  s.evalJs(
    `(() => { const i = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );

// Starts a session through the dialog opened from the first empty pane's
// Claude tile, then More… (M9 fix 545; the dialog still offers both kinds,
// so this is how a script picks the folder). cwd defaults to the home
// directory; args only apply to claude.
export async function startSession(s, { kind = 'shell', cwd = null, args = '' } = {}) {
  await s.evalJs(`document.querySelector('.empty-pane .empty-kind[data-kind="claude"]').click()`);
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-more')`, 'the empty pane offers More…');
  await s.evalJs(`document.querySelector('.empty-pane .empty-more').click()`);
  await openDialogAndStart(s, { kind, cwd, args });
}

// A session from an empty pane's own Start button (M9 fix 547): the kind
// tile, then Start, in the pane's row 1 folder. It picks the kind
// explicitly so the stored emerald.emptyPaneKind never decides what a script
// gets. paneSel narrows it to one pane; '' takes the first empty pane.
export async function startFromEmpty(s, paneSel = '', { kind = 'shell' } = {}) {
  const before = await s.evalJs(`document.querySelectorAll('.term-host').length`);
  const tile = `${paneSel} .empty-pane .empty-kind[data-kind="${kind}"]`;
  const start = `${paneSel} .empty-pane .empty-start`;
  await s.evalJs(`document.querySelector(${JSON.stringify(tile)}).click()`);
  // Start is off until the pane knows its folder rows (home comes from
  // the main process a moment after mount).
  await s.waitFor(`document.querySelector(${JSON.stringify(start)})?.disabled === false && document.querySelector(${JSON.stringify(tile)})?.getAttribute('aria-pressed') === 'true'`, 'the empty pane ready to start');
  await s.evalJs(`document.querySelector(${JSON.stringify(start)}).click()`);
  await s.waitFor(`document.querySelectorAll('.term-host').length === ${before + 1}`, 'a session from the empty pane');
}

// Same, through the focused pane's menu. Ctrl+Shift+N itself starts a shell
// with no dialog since M9 (startShellByKey below).
export async function startSessionByKey(s, opts = {}) {
  const layout = await getLayout(s);
  const c = await s.evalJs(
    `(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(layout.focusedPaneId)}]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  await s.rightClick(c.x, c.y);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, 'pane menu for the dialog');
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'New Claude session here').click()`);
  await openDialogAndStart(s, opts);
}

// Ctrl+Shift+N: a shell in the focused pane, in that pane's folder or the
// last one used. Resolves once one more terminal is on screen.
export async function startShellByKey(s) {
  const before = await s.evalJs(`document.querySelectorAll('.term-host').length`);
  await s.key('N', 'KeyN', 78, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.term-host').length === ${before + 1}`, 'shell from Ctrl+Shift+N');
}

// Open a split button's own menu with a synthetic contextmenu at the
// button's centre (M9 fix 537), the shape verify-m2-keys.mjs uses.
async function openSplitMenu(s, buttonSel) {
  await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(buttonSel)}); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); })()`);
  await s.waitFor(`!!document.querySelector('.split-menu')`, 'the split menu opens');
}
const clickSplitItem = (s, label) =>
  s.evalJs(`[...document.querySelectorAll('.split-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent.replace(/^✓/, '') === ${JSON.stringify(label)}).click()`);

// One split with a shell in the new pane, whatever the default is: the
// split menu's Split with shell (M9 fix 537; a plain click gives an empty pane).
export async function splitWithShell(s, buttonSel) {
  await openSplitMenu(s, buttonSel);
  await clickSplitItem(s, 'Split with shell');
  await s.waitFor(`!document.querySelector('.split-menu')`, 'the split menu closes');
}

// Set what a plain click on a split button gives: Empty pane, Shell or
// Claude under By default. The pick leaves the menu open, so Escape closes it.
export async function pickSplitDefault(s, buttonSel, label) {
  await openSplitMenu(s, buttonSel);
  await clickSplitItem(s, label);
  await s.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await s.waitFor(`!document.querySelector('.split-menu')`, 'the split menu closes');
}

async function openDialogAndStart(s, { kind = 'shell', cwd = null, args = '' }) {
  // The dialog fills its folder box asynchronously when nothing better is
  // known; starting before that lands sends an empty cwd.
  await s.waitFor(`(document.querySelector('.dialog input[name=cwd]')?.value ?? '') !== ''`, 'dialog folder box');
  if (cwd) await setInput(s, '.dialog input[name=cwd]', cwd);
  await s.evalJs(`document.querySelector('.dialog input[name=kind][value=${kind}]').click()`);
  if (kind === 'claude' && args) await setInput(s, '.dialog input[name=args]', args);
  await s.evalJs(`[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Start').click()`);
  await s.waitFor(`!document.querySelector('.dialog')`, 'dialog closed after start');
}

// Kept for the M2 and M3 scripts: a shell in the home directory. The
// directory is passed explicitly because the dialog prefills from the
// remembered folders, which persist across runs.
export const clickNewShell = (s, cwd) => startSession(s, { kind: 'shell', cwd: cwd ?? os.homedir() });

export function expect(cond, msg) {
  if (!cond) throw new Error('expected ' + msg);
}

export function step(msg) {
  console.log(`[verify +${((Date.now() - loadedAt) / 1000).toFixed(1)}s] ${msg}`);
}

// Kills Electron and its children. The daemon is detached and survives this
// on purpose; stopDaemon() handles it.
export function killTree(child) {
  spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
}

export function daemonPid(home = emeraldHome) {
  return JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8')).pid;
}

// The conversation ids the verify scripts and the daemon suite resume a
// real `claude` on (M9 fix 258): `stale-claude-id` is session-manager.test's
// restored shell, the d7d7d7d7 ids are verify:graph's transcripts. A claude
// whose shell has exited is re-parented and escapes a taskkill /t of the
// daemon, so a sweep lists claude.exe whose command line carries --resume
// and one of these and kills them by pid; verify-all.ps1 and tests.ps1
// hold the same list, and a new fixture joins all three.
export const harnessResumeIds = ['stale-claude-id', 'd7d7d7d7-'];

// The end of a run: the daemon, and the run's Electron profile with it
// (M9 fix 115) unless EMERALD_KEEP_PROFILE asks for a look. The daemon is
// asked to stop over its pipe first (M9 fix 258: daemon.stop kills its
// sessions, the ptys' shells and the Claudes resumed in them, which a
// taskkill of its pid alone left alive) and killed with /t /f if it has
// not gone in a few seconds; stop-daemon-worker.mjs does that, detached,
// since scripts exit half a second after this call. Electron still holds
// the profile's files for a moment after its taskkill too, so the removal
// is a detached node that retries for a few seconds and gives up quietly;
// a folder it could not take is wiped by the next fresh launch on the
// home. Node, not PowerShell: a child libuv does not detach dies with
// this process (it sits in a kill-on-close job), and PowerShell started
// detached, so with no console, exits 0 having run nothing.
export function stopDaemon(home = emeraldHome) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
    const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stop-daemon-worker.mjs');
    spawn(process.execPath, [worker, String(info.pid), String(info.pipe), String(info.pipeToken ?? '')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    // No daemon.json, nothing to stop.
  }
  const profile = profileOf(home);
  if (process.env['EMERALD_KEEP_PROFILE'] !== undefined || !fs.existsSync(profile)) return;
  const remove = `const fs = require('node:fs'); const dir = process.argv[1]; let n = 0; const tick = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} if (fs.existsSync(dir) && ++n < 12) setTimeout(tick, 500); }; setTimeout(tick, 500);`;
  spawn(process.execPath, ['-e', remove, profile], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

// The renderer's busy share over a span (M9 fix 353): the main thread
// sampled at 500 us for ms, and 1 - idle / total where idle is the
// profiler's own (idle) frame; a page doing nothing reads under a few
// percent, and the rail's render storm read 65 to 70 before fix 352.
// Twice, the lower taken, since a poll or a store push can land in one
// window. The profiler's own overhead is in the reading. busyProfile
// is the one sample with the frames that took the most self time, for
// a log to say what was busy when the share is high.
export async function busyProfile(s, ms) {
  await s.send('Profiler.enable');
  await s.send('Profiler.setSamplingInterval', { interval: 500 });
  await s.send('Profiler.start');
  await sleep(ms);
  const { profile } = await s.send('Profiler.stop');
  await s.send('Profiler.disable');
  const byNode = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i += 1) {
    const delta = profile.timeDeltas[i] ?? 0;
    total += delta;
    byNode.set(profile.samples[i], (byNode.get(profile.samples[i]) ?? 0) + delta);
  }
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const byFrame = new Map();
  let idleTime = 0;
  for (const [id, us] of byNode) {
    const n = nodes.get(id);
    const name = n.callFrame.functionName || '(anonymous)';
    if (name === '(idle)') idleTime += us;
    const file = (n.callFrame.url ?? '').split('/').pop();
    const key = file === '' ? name : `${name} ${file}:${n.callFrame.lineNumber + 1}`;
    byFrame.set(key, (byFrame.get(key) ?? 0) + us);
  }
  const top = [...byFrame].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([frame, us]) => ({ frame, ms: Math.round(us / 1000) }));
  return { share: total === 0 ? 0 : 1 - idleTime / total, totalMs: Math.round(total / 1000), top };
}

export async function busyShare(s, ms) {
  const a = await busyProfile(s, ms);
  const b = await busyProfile(s, ms);
  return Math.min(a.share, b.share);
}

// Wait for the first visible thing at a selector to stop moving: two
// reads of its rect 250 ms apart in the same place, within 4 s (M9 fix
// 428, from verify:graph's own copy). A row that moves out from under a
// pointer before a card's 400 ms hover timer (Popover.tsx) fires clears
// the timer, and the card never opens; a hover measured on a settled
// row does not meet that.
export async function settled(s, selector) {
  const at = () => s.evalJs(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.getClientRects().length > 0); if (!el) return null; const r = el.getBoundingClientRect(); return r.x + ',' + r.y; })()`);
  let last = await at();
  for (let i = 0; i < 16; i += 1) {
    await sleep(250);
    const next = await at();
    if (next !== null && next === last) return;
    last = next;
  }
}

// Hover the centre of the first visible thing at a selector for the card
// at cardSel, twice if need be (M9 fix 428, the shape of verify:m9's fix
// 391 roster hover): settled first, a 1500 ms wait each try, the pointer
// moved off to (5, 300) between them and a note on the second. A product
// bug fails both tries. Answers the point it hovered, for a click after.
// opts.onMiss (M9 fix 622), when given, is awaited before either throw and
// the string it answers logged as a note, so a miss prints what the caller
// can read about why (verify:m9's m46 block reads the row's units and the
// daemon's team); a failing read is noted and the hover's own error thrown.
export async function hoverForCard(s, selector, cardSel, what, { onMiss } = {}) {
  const noteMiss = async () => {
    if (onMiss === undefined) return;
    try {
      console.log(`[verify] note: ${what}: missed; ${await onMiss()}`);
    } catch (err) {
      console.log(`[verify] note: ${what}: the miss read failed: ${err.message}`);
    }
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await settled(s, selector);
    const point = await s.evalJs(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.getClientRects().length > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (point === null) await noteMiss();
    expect(point !== null, `something to hover at ${selector}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
    try {
      await s.waitFor(`!!document.querySelector(${JSON.stringify(cardSel)})`, what, 1500);
      return point;
    } catch (err) {
      if (attempt === 1) {
        await noteMiss();
        throw err;
      }
      console.log(`[verify] note: ${what}: nothing opened the first time; trying again`);
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
      await sleep(500);
    }
  }
}

// `git worktree remove --force` on a folder something still holds (a
// shell's process a moment after its session was removed, the daemon's
// git read of the folder) fails on Windows, and one such removal failed
// the whole of verify:graph once (M9 fix 427). Tried twenty times 500 ms
// apart on sleep, never Atomics.wait, which would block the CDP socket;
// a note when it starts waiting and one when it gets through. Past that
// the folder goes by rmSync with the same patience and `git worktree
// prune` forgets it, so a `branch -D` after this still works. A failed
// remove has usually deleted the files and the `.git` link already and
// left only the held folder, which git then no longer calls a worktree
// (measured: every later git try failed, and the scratch proof waited
// out all twenty), so a try on a folder with no `.git` in it is the
// rmSync and the prune at once. `gitFn` is the script's git runner for
// the repository the worktree is of.
export async function removeWorktree(gitFn, dir) {
  const through = (i, how) => {
    if (i > 0) console.log(`[verify] note: the worktree ${dir} came free after ${i * 500} ms${how}`);
  };
  for (let i = 0; i < 40; i += 1) {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        gitFn('worktree', 'prune');
        through(i, ', the rest removed by hand and pruned');
        return;
      } catch {
        // Still held; the next try.
      }
    } else if (i < 20) {
      try {
        gitFn('worktree', 'remove', '--force', dir);
        through(i, '');
        return;
      } catch (err) {
        if (i === 0) console.log(`[verify] note: git worktree remove ${dir} failed (${String(err.stderr ?? err.message).trim().split(/\r?\n/)[0]}); waiting for whatever holds it`);
      }
    } else {
      break;
    }
    await sleep(500);
  }
  throw new Error(`the worktree ${dir} is still held after the retries`);
}

// Whether a process is still up, by its pid and its image name together
// (M9 fix 427, for a session's shell after its session is removed): a
// pid alone may have been handed to another process by the time it is
// read (docs/GOTCHAS.md, fixes 394 to 425), and a recycled pid with the same
// image a few seconds on is a wait that runs to its deadline, never a
// wrong "gone". imageOf answers null for a pid that is not running.
export function imageOf(pid) {
  const out = execFileSync('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).trim();
  const m = /^"([^"]+)","(\d+)"/.exec(out);
  return m !== null && Number(m[2]) === pid ? m[1] : null;
}
export async function processGone(pid, image, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (imageOf(pid) !== image) return true;
    await sleep(200);
  }
  return false;
}

// `--only <block>[,<block>]` (or `--only=`) and `--list` for a script
// cut into blocks (M9 fix 426, verify:graph first; verify:cli carries a
// copy, since the cli package does not import this file). `blocks` is
// the script's table of { name, fixes, needs }: a name on --only is a
// block's own or a fix id some block carries, and every block it needs
// runs with it. `block(name, fn)` runs fn or prints that it skipped it;
// `blocksRun()` is the summary line, and on a run with no --only it
// throws unless every block in the table ran, so the table cannot drift
// from the script. --list prints the table and exits before anything
// is launched. A block's own name wins over the ids other blocks carry,
// and the run prints a note when another block carries the name too.
// `partial` is true when --only narrowed the run, so a script can arm
// a watchdog for the prelude and a few blocks rather than the whole run.
export function blockRunner(blocks, argv = process.argv.slice(2)) {
  const byName = new Map(blocks.map((b) => [b.name, b]));
  if (argv.includes('--list')) {
    console.log('the prelude always runs; the blocks, in order:');
    for (const b of blocks) {
      const also = b.fixes.filter((f) => f !== b.name);
      const neededBy = blocks.filter((x) => x.needs.includes(b.name)).map((x) => x.name);
      console.log(`  ${b.name}${also.length ? ` (also ${also.join(', ')})` : ''}${b.needs.length ? `; needs ${b.needs.join(', ')}` : ''}${neededBy.length ? `; needed by ${neededBy.join(', ')}` : ''}`);
    }
    process.exit(0);
  }
  let only = null;
  const at = argv.findIndex((a) => a === '--only' || a.startsWith('--only='));
  if (at !== -1) {
    const raw = argv[at] === '--only' ? (argv[at + 1] ?? '') : argv[at].slice('--only='.length);
    only = new Set();
    const add = (name) => {
      if (only.has(name)) return;
      only.add(name);
      for (const n of byName.get(name).needs) add(n);
    };
    for (const want of raw.split(',').map((x) => x.trim()).filter((x) => x !== '')) {
      const hits = byName.has(want) ? [want] : blocks.filter((b) => b.fixes.includes(want)).map((b) => b.name);
      if (hits.length === 0) {
        console.error(`[verify] no block named ${want}; --list names them`);
        process.exit(2);
      }
      // A block's own name wins over the ids other blocks carry; say so when
      // another block carries the name too, since its steps do not run.
      if (byName.has(want)) {
        const others = blocks.filter((b) => b.name !== want && b.fixes.includes(want)).map((b) => b.name);
        if (others.length > 0) console.log(`[verify] note: ${want} is also carried by ${others.join(', ')}; name it too for those steps`);
      }
      hits.forEach(add);
    }
    if (only.size === 0) {
      console.error('[verify] --only names no block; --list names them');
      process.exit(2);
    }
    console.log(`[verify] --only: the prelude, then ${blocks.filter((b) => only.has(b.name)).map((b) => b.name).join(', ')}`);
  }
  const ran = [];
  const skipped = [];
  const block = async (name, fn) => {
    if (!byName.has(name)) throw new Error(`block ${name} is not in the script's table`);
    if (only !== null && !only.has(name)) {
      console.log(`[verify] skipped ${name} (--only)`);
      skipped.push(name);
      return;
    }
    await fn();
    ran.push(name);
  };
  const blocksRun = () => {
    if (only === null && ran.length !== blocks.length) throw new Error(`expected every block to run, missing ${blocks.filter((b) => !ran.includes(b.name)).map((b) => b.name).join(', ')}`);
    return `blocks run: ${ran.join(', ')}${skipped.length ? `; skipped (--only): ${skipped.join(', ')}` : ''}`;
  };
  return { block, blocksRun, partial: only !== null };
}
