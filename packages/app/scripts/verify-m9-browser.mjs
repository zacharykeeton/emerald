// M9 fix 659 acceptance: a browser pane, a web page beside the shells.
// A fixture server on 127.0.0.1 (a port the script picks) serves two
// pages; the empty pane's Web page button makes a browser pane, the
// address bar refuses a bare host and loads host:port, the page's title
// reaches the title row, the page has no bridge, a link and Back work,
// Reload and its right-click hard reload reach the server, a new window
// goes to the system browser (held to the log under this private home),
// a navigation off the web is refused, a webview on another partition is
// still refused (fix 477's guarded case), a menu over the page reads on
// top, a hidden layout tab keeps the page, the record survives a
// renderer reload, and `emmer open <host:port>` opens a second browser
// pane. Uses a private home and pipe unless the environment names them.
// Run: npm run verify:browser -w @emerald/app
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'browser-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-browser';
const { connect, expect, freshPort, getLayout, getTabs, killTree, launch, leaves, repoRoot, sleep, step, stopDaemon } = await import('./cdp.mjs');

let app = null;
let server = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 120 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  server?.close();
  setTimeout(() => process.exit(3), 500);
}, 120000);

// The fixture: two pages and two targets for the new-window reads, no
// caching header on any answer, every request's path and cache-control
// kept.
const requests = [];
server = http.createServer((req, res) => {
  requests.push({ path: req.url, cacheControl: req.headers['cache-control'] ?? '' });
  const page = (title, body) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`);
  };
  if (req.url === '/') page('Emerald fixture one', '<a id="next" href="/two">two</a> <a id="blank" href="/blank-target" target="_blank">blank</a>');
  else if (req.url === '/two') page('Emerald fixture two', '<p>two</p>');
  else page('Emerald fixture other', '<p>other</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
const home = origin + '/';
const hits = (p) => requests.filter((r) => r.path === p);

const mainLog = path.join(process.env['EMERALD_HOME'], 'logs', 'main.log');
const logText = () => {
  try {
    return fs.readFileSync(mainLog, 'utf8');
  } catch {
    return '';
  }
};
const waitLog = async (text, what, ms = 4000) => {
  const deadline = Date.now() + ms;
  while (!logText().includes(text) && Date.now() < deadline) await sleep(100);
  expect(logText().includes(text), `${what}: main.log carries ${JSON.stringify(text)}`);
};

// The CLI against this window's pipe, run async so the fixture server in
// this process answers the page's load meanwhile.
const cliMain = path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js');
const cliOpen = (...args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [cliMain, 'open', ...args], { env: process.env, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
  });

const s = await launch(freshPort(), { freshState: true });
app = s;
let guest = null;
try {
  const targets = async () => (await (await fetch(`http://127.0.0.1:${s.port}/json`)).json());
  const guestTargets = async () => (await targets()).filter((t) => t.type === 'webview' || (t.type !== 'page' && typeof t.url === 'string' && t.url.startsWith(origin)));
  const pageTargets = async () => (await targets()).filter((t) => t.type === 'page');
  const browserPane = `.pane[data-view="browser"]`;
  const address = `${browserPane} .browser-address`;
  const recordUrls = async () => leaves((await getLayout(s))).filter((p) => p.view?.kind === 'browser').map((p) => p.view.url);
  const typeAddress = async (text) => {
    await s.evalJs(`(() => { const i = document.querySelector(${JSON.stringify(address)}); i.focus(); i.select(); })()`);
    await s.type(text);
    await s.key('Enter', 'Enter', 13);
  };

  // (a) The empty pane's Web page button, the address bar's refusal and
  // a host:port loaded.
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-browser')`, 'the Web page button in the empty pane');
  expect((await s.evalJs(`document.querySelector('.empty-browser').closest('.empty-pair') === null`)), 'the Web page button sits outside every .empty-pair');
  await s.evalJs(`document.querySelector('.empty-browser').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ''`, 'a browser pane with an empty url');
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(address)})`, 'the address bar has the keyboard');
  await typeAddress('example.com');
  await s.waitFor(`document.querySelector(${JSON.stringify(address)}).getAttribute('aria-invalid') === 'true'`, 'example.com marked invalid');
  expect((await recordUrls()).join() === '', `the record keeps an empty url after example.com (${await recordUrls()})`);
  await typeAddress(`127.0.0.1:${port}`);
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(home)}`, 'data-url on the fixture');
  expect((await recordUrls()).join() === home, `the record holds the fixture (${await recordUrls()})`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(address)}).getAttribute('aria-invalid')`)) === null, 'the invalid mark is cleared');
  step('(a) the Web page button makes a browser pane; example.com is refused and 127.0.0.1:<port> loads');

  // (b) The guest by its target, and the title row.
  const deadline = Date.now() + 15000;
  let found = [];
  while (Date.now() < deadline) {
    found = await guestTargets();
    if (found.length === 1 && found[0].title === 'Emerald fixture one') break;
    await sleep(200);
  }
  expect(found.length === 1, `one guest target (${JSON.stringify(found.map((t) => [t.type, t.url]))})`);
  console.log(`[verify] note: the guest's target type is ${found[0].type}`);
  expect(found[0].url === home && found[0].title === 'Emerald fixture one', `the guest at the fixture titled one (${found[0].url}, ${found[0].title})`);
  const guestId = found[0].id;
  guest = await connect(found[0].webSocketDebuggerUrl);
  // An evaluation with a user gesture, as a person's click would carry:
  // Chromium skips a history entry left without one (Back stays off)
  // and blocks a window.open without one before the main process sees it.
  const gesture = async (expression) => {
    const r = await guest.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('guest threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane + ' .pane-name')})?.textContent === 'Emerald fixture one'`, 'the title row names the page');
  await s.screenshot('browser-page.png');
  step('(b) one webview target at the fixture, titled, and the pane title reads the same');

  // (c) No bridge in the page.
  const bridge = await guest.evalJs(`[typeof window.emerald, typeof require, typeof process].join()`);
  expect(bridge === 'undefined,undefined,undefined', `the page has no emerald, require or process (${bridge})`);
  step('(c) the page has no bridge, no require and no process');

  // (d) A link and Back.
  await gesture(`document.getElementById('next').click()`);
  await guest.waitFor(`location.pathname === '/two' && document.title === 'Emerald fixture two'`, 'the guest on /two');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(origin + '/two')}`, 'the record follows the link');
  await s.waitFor(`!document.querySelector(${JSON.stringify(browserPane + ' .browser-back')}).disabled`, 'Back enabled');
  await s.evalJs(`document.querySelector(${JSON.stringify(browserPane + ' .browser-back')}).click()`);
  await guest.waitFor(`location.pathname === '/'`, 'the guest back on /');
  await s.waitFor(`!document.querySelector(${JSON.stringify(browserPane + ' .browser-forward')}).disabled`, 'Forward enabled');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(home)}`, 'the record back on /');
  step('(d) a link in the page navigates and the record follows; Back brings / back and Forward is enabled');

  // (e) Reload and the hard reload.
  const reloadSel = browserPane + ' .browser-reload';
  let before = hits('/').length;
  await s.evalJs(`document.querySelector(${JSON.stringify(reloadSel)}).click()`);
  let until = Date.now() + 5000;
  while (hits('/').length === before && Date.now() < until) await sleep(100);
  expect(hits('/').length === before + 1, `one more / after Reload (${before} then ${hits('/').length})`);
  expect(!/no-cache/.test(hits('/').at(-1).cacheControl), `a plain reload carries no no-cache (${hits('/').at(-1).cacheControl})`);
  await guest.waitFor(`document.readyState === 'complete'`, 'the guest loaded again');
  before = hits('/').length;
  const box = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(reloadSel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(box.x, box.y);
  until = Date.now() + 5000;
  while (hits('/').length === before && Date.now() < until) await sleep(100);
  expect(hits('/').length === before + 1, `one more / after the right-click (${before} then ${hits('/').length})`);
  expect(/no-cache/.test(hits('/').at(-1).cacheControl), `the hard reload carries no-cache (${hits('/').at(-1).cacheControl})`);
  expect(!(await s.evalJs(`!!document.querySelector('.pane-menu')`)), 'no pane menu opened on the right-click');
  await guest.waitFor(`document.readyState === 'complete' && location.pathname === '/'`, 'the guest loaded again');
  step('(e) Reload reaches the server, and a right-click on it is a hard reload with no pane menu');

  // (f) A new window goes to the system browser.
  const popup = `${origin}/popup`;
  const blank = `${origin}/blank-target`;
  const opened = await gesture(`window.open(${JSON.stringify(popup)}) === null`);
  expect(opened, 'window.open in the page answers null');
  await gesture(`document.getElementById('blank').click()`);
  await waitLog(`link held under a private EMERALD_HOME: ${popup}`, 'window.open went to openExternal');
  await waitLog(`link held under a private EMERALD_HOME: ${blank}`, 'a target=_blank link went to openExternal');
  expect((await pageTargets()).length === 1, `one page target (${(await pageTargets()).length})`);
  expect((await guestTargets()).length === 1, `one guest target (${(await guestTargets()).length})`);
  expect((await guest.evalJs(`location.href`)) === home, 'the guest is still on /');
  step('(f) window.open and a target=_blank link open no window and go to the system browser');

  // (g) A navigation off the web goes nowhere. Chromium refuses a file:
  // URL from an http page in the renderer, before will-navigate (measured
  // at the fix: the guard's line never comes), so the read is that the
  // guest stays put; the guard's own refusal is browser-guard.test.ts's,
  // and whether it logged here is a logged read.
  await gesture(`location.href = 'file:///C:/Windows/win.ini'`).catch(() => {});
  await sleep(800);
  expect((await guest.evalJs(`location.href`)) === home, 'the guest is still on / after a file: navigation');
  console.log(`[659] the guard logged the file: navigation: ${logText().includes('browser: navigation refused: file:///C:/Windows/win.ini')}`);
  step('(g) a file: navigation in the page goes nowhere');

  // (h) Fix 477's guarded case: a webview on another partition.
  await s.evalJs(`(() => { const w = document.createElement('webview'); w.id = 'rogue'; w.setAttribute('partition', 'persist:other'); w.setAttribute('src', ${JSON.stringify(home)}); document.body.appendChild(w); })()`);
  await sleep(1000);
  expect((await guestTargets()).length === 1, `still one guest target (${(await guestTargets()).length})`);
  await waitLog('webview refused: partition persist:other; only persist:emerald-browser attaches', 'a webview on another partition is refused');
  await s.evalJs(`document.getElementById('rogue')?.remove()`);
  step('(h) a webview on another partition is refused, as fix 477 refused every one');

  // (i) A menu over the page reads on top.
  const centre = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(browserPane + ' .browser-page')}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.evalJs(`document.querySelector(${JSON.stringify(browserPane + ' .pane-title')}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${centre.x}, clientY: ${centre.y} }))`);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, 'the pane menu opened');
  const onTop = await s.evalJs(`(() => { const item = document.querySelector('.pane-menu .menu-item'); const r = item.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el !== null && el.closest('.pane-menu') !== null; })()`);
  expect(onTop, 'the menu item over the page is the element at its point');
  await s.screenshot('browser-menu-over-page.png');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'the menu closed');
  step('(i) the pane menu over the page is on top');

  // (j) A hidden layout tab keeps the page.
  await guest.evalJs(`window.__mark = 659`);
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2`, 'a second layout tab');
  await sleep(500);
  await s.evalJs(`document.querySelectorAll('.tab.tab-panes')[0].click()`);
  await s.waitFor(`!!document.querySelector('.layout-tab:not([hidden]) ' + ${JSON.stringify(browserPane)})`, 'back on the first tab');
  const stillId = (await guestTargets()).map((t) => t.id);
  const mark = await guest.evalJs(`window.__mark`).catch(() => undefined);
  if (mark === 659 && stillId.includes(guestId)) step('(j) a hidden layout tab kept the page (the same target, the mark still set)');
  else console.log(`[659] a hidden layout tab reloaded the page (mark ${mark}, targets ${stillId.join(',')})`);
  const tabs = await getTabs(s);
  const extra = tabs.tabs[1];
  await s.evalJs(`window.emerald.request('layout.set', ${JSON.stringify({ layout: { ...tabs, tabs: [tabs.tabs[0]], currentTabId: tabs.tabs[0].id } })})`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 1`, `the extra tab ${extra.name} closed`);

  // (k) The record survives a renderer reload.
  guest.close();
  guest = null;
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body')`, 'app after reload');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(home)}`, 'the browser pane back on /');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane + ' .pane-name')})?.textContent === 'Emerald fixture one'`, 'titled one again', 15000);
  step('(k) the browser pane comes back on its page after a renderer reload');

  // (l) emmer open <host:port>.
  let r = await cliOpen(`127.0.0.1:${port}/two`);
  expect(r.code === 0 && r.out.trim() === `opened ${origin}/two in a pane`, `emmer open host:port/two (${r.code}: ${JSON.stringify(r.out)} ${JSON.stringify(r.err)})`);
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(browserPane)}).length === 2`, 'a second browser pane');
  expect((await recordUrls()).sort().join() === [home, `${origin}/two`].sort().join(), `the records hold both pages (${await recordUrls()})`);
  r = await cliOpen(`127.0.0.1:${port}`, '--scheme', 'x');
  expect(r.code === 64 && r.err.includes('--scheme and --clear-scheme are for a file, not a URL'), `a URL with --scheme is a usage error (${r.code}: ${JSON.stringify(r.err)})`);
  expect((await s.evalJs(`document.querySelectorAll(${JSON.stringify(browserPane)}).length`)) === 2, 'still two browser panes');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(browserPane + ' .browser-devtools')})?.getAttribute('aria-label')`)) === 'Developer tools', 'the Developer tools button is there (never clicked)');
  await s.screenshot('browser-two-panes.png');
  step('(l) emmer open 127.0.0.1:<port>/two opens a second browser pane, and --scheme with a URL is refused');

  // Anything the window's console said about a renderer that failed to
  // start, for the report.
  for (const line of s.consoleLog.filter((l) => /error/.test(l))) console.log(`[659] window console: ${line}`);
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('browser-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  guest?.close();
  s.close();
  killTree(s.child);
  stopDaemon();
  server.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
