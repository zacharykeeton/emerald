// M9 fix 659 acceptance: a browser pane, a web page beside the shells.
// A fixture server on 127.0.0.1 (a port the script picks) serves two
// pages; the empty pane's Browser tile makes a browser pane, the
// address bar refuses a scheme it does not open, loads host:port and
// shows it without its scheme, takes a bare host over https and words as
// a search, drops two buttons in a narrow pane, the page's title
// reaches the title row, the page has no bridge, a link and Back work,
// Reload and its right-click hard reload reach the server, a new window
// goes to the system browser (held to the log under this private home),
// a navigation off the web is refused, a webview on another partition is
// still refused (fix 477's guarded case), a menu over the page reads on
// top, a hidden layout tab keeps the page, a split, a zoom, a close and
// a move beside it keep it too (fix 669), the app's chords and Ctrl+R
// pressed in the page reach the app and not the page (fix 670), the record survives a
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
const { CTRL, SHIFT, connect, expect, freshPort, getLayout, getTabs, killTree, launch, leaves, repoRoot, sleep, step, stopDaemon } = await import('./cdp.mjs');

let app = null;
let server = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 150 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  server?.close();
  setTimeout(() => process.exit(3), 500);
}, 150000);

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
  // The keydown counter is fix 670's: a chord pressed in the page must
  // not reach it, a plain key must.
  if (req.url === '/') page('Emerald fixture one', `<a id="next" href="/two">two</a> <a id="blank" href="/blank-target" target="_blank">blank</a><script>window.__keys = 0; addEventListener('keydown', () => { window.__keys++; }, true);</script>`);
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
  const browserTile = `.empty-pane .empty-kind[data-kind="browser"]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(browserTile)})`, 'the Browser tile in the empty pane');
  // M9 fix 666: three tiles side by side over 760 px of pane, the Browser
  // tile on a row of its own under that; none clipped at either width, and
  // at the 320 px the narrow rules were written for. The harness window's
  // single pane is 678 px wide, so the wide and the narrow read emulate
  // the viewport (the sidebar and the window's chrome take 522 px of it
  // at these widths) and clear it after.
  const tileRead = () =>
    s.evalJs(`(() => { const tiles = [...document.querySelectorAll('.empty-pane .empty-kind')].map((t) => ({ name: t.querySelector('.empty-kind-name').textContent, r: t.getBoundingClientRect() })); return { pane: Math.round(document.querySelector('.empty-pane').getBoundingClientRect().width), names: tiles.map((t) => t.name), tops: tiles.map((t) => t.r.top), bottoms: tiles.map((t) => t.r.bottom), widths: tiles.map((t) => t.r.width), box: document.querySelector('.empty-kinds').getBoundingClientRect().width, clipped: [...document.querySelectorAll('.empty-pane .empty-kind-name')].some((n) => n.scrollWidth > n.clientWidth) }; })()`);
  const NAMES = JSON.stringify(['Shell', 'Claude session', 'Browser']);
  const viewportH = await s.evalJs(`window.innerHeight`);
  const emulate = async (width) => {
    await s.send('Emulation.setDeviceMetricsOverride', { width, height: viewportH, deviceScaleFactor: 0, mobile: false });
    await sleep(400);
  };
  const stacked = await tileRead();
  console.log(`[666] the empty pane is ${stacked.pane} px wide`);
  expect(JSON.stringify(stacked.names) === NAMES && !stacked.clipped, `the three tiles by name, none clipped (${JSON.stringify(stacked)})`);
  expect(stacked.pane <= 760 && stacked.tops[2] >= stacked.bottoms[0] - 0.5 && stacked.widths[2] >= stacked.box * 0.9, `under 760 px the Browser tile has a row of its own (${JSON.stringify(stacked)})`);
  await s.screenshot('browser-tiles.png');
  await emulate(1500);
  const wide = await tileRead();
  console.log(`[666] the empty pane is ${wide.pane} px wide`);
  expect(wide.pane > 760 && JSON.stringify(wide.names) === NAMES && !wide.clipped && Math.max(...wide.tops) - Math.min(...wide.tops) <= 1, `over 760 px the three tiles share one top and none is clipped (${JSON.stringify(wide)})`);
  await s.screenshot('browser-tiles-wide.png');
  await emulate(842);
  const narrow = await tileRead();
  console.log(`[666] the empty pane is ${narrow.pane} px wide`);
  expect(Math.abs(narrow.pane - 320) <= 4 && JSON.stringify(narrow.names) === NAMES && !narrow.clipped && narrow.tops[2] >= narrow.bottoms[0] - 0.5 && narrow.tops[2] >= narrow.bottoms[1] - 0.5 && narrow.widths[2] >= narrow.box * 0.9, `at 320 px the names are whole and the Browser tile sits under both (${JSON.stringify(narrow)})`);
  // M9 fix 706: two tiles a row and whole at 340, 328 and 312 px of pane,
  // one above another at 308 and 278.
  for (const w of [340, 328, 312]) {
    await emulate(w + 522);
    const r = await tileRead();
    console.log(`[706] the empty pane is ${r.pane} px wide`);
    expect(Math.abs(r.pane - w) <= 4 && JSON.stringify(r.names) === NAMES && !r.clipped && Math.abs(r.tops[0] - r.tops[1]) <= 1, `at ${w} px the names are whole with two tiles a row (${JSON.stringify(r)})`);
  }
  for (const w of [308, 278]) {
    await emulate(w + 522);
    const r = await tileRead();
    console.log(`[706] the empty pane is ${r.pane} px wide`);
    expect(Math.abs(r.pane - w) <= 4 && JSON.stringify(r.names) === NAMES && !r.clipped && r.tops[1] >= r.bottoms[0] - 0.5 && r.tops[2] >= r.bottoms[1] - 0.5, `at ${w} px the names are whole, one tile above another (${JSON.stringify(r)})`);
    if (w === 278) await s.screenshot('browser-tiles-278.png');
  }
  step('M9 fix 706: the tile names stay whole at 340, 328 and 312 px with two tiles a row, and at 308 and 278 px one above another');
  await s.send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  await s.evalJs(`document.querySelector(${JSON.stringify(browserTile)}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ''`, 'a browser pane with an empty url');
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(address)})`, 'the address bar has the keyboard');
  await typeAddress('javascript:alert(1)');
  await s.waitFor(`document.querySelector(${JSON.stringify(address)}).getAttribute('aria-invalid') === 'true'`, 'javascript:alert(1) marked invalid');
  expect((await recordUrls()).join() === '', `the record keeps an empty url after javascript:alert(1) (${await recordUrls()})`);
  await typeAddress(`127.0.0.1:${port}`);
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(home)}`, 'data-url on the fixture');
  expect((await recordUrls()).join() === home, `the record holds the fixture (${await recordUrls()})`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(address)}).getAttribute('aria-invalid')`)) === null, 'the invalid mark is cleared');
  // M9 fix 667: the bar shows the address without its scheme while it
  // lacks the focus, whole and selected while it has it.
  const addressRead = () => s.evalJs(`(() => { const i = document.querySelector(${JSON.stringify(address)}); return { value: i.value, start: i.selectionStart, end: i.selectionEnd, focused: document.activeElement === i }; })()`);
  await s.evalJs(`document.querySelector(${JSON.stringify(address)}).blur()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(address)}).value === ${JSON.stringify(`127.0.0.1:${port}`)}`, 'the unfocused bar drops the scheme and the slash');
  await s.evalJs(`document.querySelector(${JSON.stringify(address)}).focus()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(address)}).value === ${JSON.stringify(home)}`, 'the focused bar shows the address whole');
  const whole = await addressRead();
  expect(whole.start === 0 && whole.end === home.length, `focus selects the whole address (${JSON.stringify(whole)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(address)}).blur()`);
  // M9 fix 691: a click that brings the focus selects the whole address
  // too, and a second click into the focused bar places the caret.
  const { x: barX, y: barY } = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(address)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(barX, barY);
  await s.waitFor(`document.querySelector(${JSON.stringify(address)}).value === ${JSON.stringify(home)}`, 'the clicked bar shows the address whole');
  await sleep(150);
  const clicked = await addressRead();
  expect(clicked.focused && clicked.start === 0 && clicked.end === home.length, `a click into the bar selects the whole address (${JSON.stringify(clicked)})`);
  await s.click(barX, barY);
  await sleep(150);
  const second = await addressRead();
  expect(second.start === second.end, `a second click places the caret (${JSON.stringify(second)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(address)}).blur()`);
  step('(a) the Browser tile makes a browser pane; javascript:alert(1) is refused and 127.0.0.1:<port> loads, shown without its scheme');

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
  let guestId = found[0].id;
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

  // (c2) M9 fix 667: a bare host loads over https and words go to the
  // search engine. No bare host is servable by the fixture, so the loads
  // are held at the guest's network layer and the record is read.
  const blocked = [];
  guest.on('Fetch.requestPaused', (p) => {
    blocked.push(p.request.url);
    void guest.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' });
  });
  await guest.send('Fetch.enable', { patterns: [{ urlPattern: 'https://example.test/*' }, { urlPattern: 'https://duckduckgo.com/*' }] });
  const blockedBy = async (url, what) => {
    const until = Date.now() + 5000;
    while (!blocked.includes(url) && Date.now() < until) await sleep(100);
    expect(blocked.includes(url), `${what} reached the guest's network layer as ${url} (${JSON.stringify(blocked)}), so nothing left the box unheld`);
  };
  await typeAddress('example.test');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === 'https://example.test/'`, 'the record holds https://example.test/');
  await blockedBy('https://example.test/', 'example.test');
  console.log(`[667] the error line: ${await s.evalJs(`document.querySelector('.browser-error')?.textContent ?? null`)}`);
  await typeAddress('emerald fixture');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === 'https://duckduckgo.com/?q=emerald%20fixture'`, 'the record holds the search');
  await blockedBy('https://duckduckgo.com/?q=emerald%20fixture', 'the search');
  console.log(`[667] the error line: ${await s.evalJs(`document.querySelector('.browser-error')?.textContent ?? null`)}`);
  await guest.send('Fetch.disable').catch(() => {});
  await typeAddress(`127.0.0.1:${port}`);
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(home)}`, 'the record back on the fixture');
  // The failed loads may have swapped the target; take the guest again.
  guest.close();
  guest = null;
  for (let until = Date.now() + 15000; Date.now() < until; await sleep(200)) {
    const t = (await guestTargets()).filter((x) => x.url === home);
    if (t.length === 1) {
      guestId = t[0].id;
      guest = await connect(t[0].webSocketDebuggerUrl);
      break;
    }
  }
  expect(guest !== null, 'the guest is back on the fixture');
  await guest.waitFor(`document.readyState === 'complete' && location.pathname === '/'`, 'the guest loaded the fixture');
  step('(c2) a bare host loads over https and words go to the search engine, held at the guest');

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
  // M9 fix 668: the pane's console-message listener catches Chromium's own
  // "Not allowed to load local resource" and writes it on the error line.
  await s.waitFor(`(document.querySelector('.browser-error')?.textContent ?? '').includes('file:///C:/Windows/win.ini')`, 'the error line names the refused file: link', 3000);
  expect((await s.evalJs(`document.querySelector('.browser-error').textContent`)) === 'This page tried to open file:///C:/Windows/win.ini; a browser pane opens only http and https pages', 'the error line reads in full');
  expect((await guest.evalJs(`location.href`)) === home, 'the guest is still on / after a file: navigation');
  console.log(`[659] the guard logged the file: navigation: ${logText().includes('browser: navigation refused: file:///C:/Windows/win.ini')}`);
  step('(g) a file: navigation in the page goes nowhere and the error line names it');

  // (h) Fix 477's guarded case: a webview on another partition.
  await s.evalJs(`(() => { const w = document.createElement('webview'); w.id = 'rogue'; w.setAttribute('partition', 'persist:other'); w.setAttribute('src', ${JSON.stringify(home)}); document.body.appendChild(w); })()`);
  await sleep(1000);
  expect((await guestTargets()).length === 1, `still one guest target (${(await guestTargets()).length})`);
  await waitLog('webview refused: partition persist:other; only persist:emerald-browser attaches', 'a webview on another partition is refused');
  await s.evalJs(`document.getElementById('rogue')?.remove()`);
  step('(h) a webview on another partition is refused, as fix 477 refused every one');

  // (i) A menu over the page reads on top. The page lives in the
  // window's browser layer since fix 669, in a frame named by its pane.
  const pageIn = (paneId) => `.browser-frame[data-browser-pane="${paneId}"]`;
  const browserPaneId = await s.evalJs(`document.querySelector(${JSON.stringify(browserPane)}).dataset.paneId`);
  const centre = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(pageIn(browserPaneId) + ' .browser-page')}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
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
  // M9 fix 666: Tab twice in the new tab's empty pane lands on the Browser
  // tile, and Enter opens the page with the address focused.
  await s.evalJs(`document.querySelector('.layout-tab:not([hidden]) .empty-pane .palette-input').focus()`);
  await s.key('Tab', 'Tab', 9);
  await s.key('Tab', 'Tab', 9);
  const pressedTiles = await s.evalJs(`[...document.querySelectorAll('.layout-tab:not([hidden]) .empty-pane .empty-kind')].map((t) => t.dataset.kind + ':' + t.getAttribute('aria-pressed'))`);
  expect(pressedTiles.join() === 'shell:false,claude:false,browser:true', `Tab twice presses the Browser tile (${pressedTiles})`);
  const startText = await s.evalJs(`document.querySelector('.layout-tab:not([hidden]) .empty-start').textContent`);
  expect(startText.startsWith('Open web page'), `Start reads Open web page (${startText})`);
  // Tab wraps to Shell and Shift+Tab comes back, then Enter opens.
  const pressedNow = () => s.evalJs(`[...document.querySelectorAll('.layout-tab:not([hidden]) .empty-pane .empty-kind[aria-pressed="true"]')].map((t) => t.dataset.kind).join()`);
  await s.key('Tab', 'Tab', 9);
  expect((await pressedNow()) === 'shell', `Tab from Browser wraps to Shell (${await pressedNow()})`);
  await s.key('Tab', 'Tab', 9, SHIFT);
  expect((await pressedNow()) === 'browser', `Shift+Tab from Shell lands on Browser (${await pressedNow()})`);
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`document.querySelector('.layout-tab:not([hidden]) .pane[data-view="browser"]')?.dataset.url === ''`, 'Enter opened a browser pane with an empty url');
  await s.waitFor(`document.activeElement === document.querySelector('.layout-tab:not([hidden]) .pane[data-view="browser"] .browser-address')`, 'the address has the keyboard');
  await sleep(500);
  await s.waitFor(`document.querySelector(${JSON.stringify(pageIn(browserPaneId))})?.hidden === true`, 'the page frame hidden while the second tab is in front');
  await s.evalJs(`document.querySelectorAll('.tab.tab-panes')[0].click()`);
  await s.waitFor(`!!document.querySelector('.layout-tab:not([hidden]) ' + ${JSON.stringify(browserPane)})`, 'back on the first tab');
  await s.waitFor(`document.querySelector(${JSON.stringify(pageIn(browserPaneId))})?.hidden === false`, 'the page frame shown again');
  const stillId = (await guestTargets()).map((t) => t.id);
  const mark = await guest.evalJs(`window.__mark`).catch(() => undefined);
  expect(mark === 659 && stillId.includes(guestId), `a hidden layout tab kept the page (mark ${mark}, targets ${stillId.join(',')})`);
  step('(j) a hidden layout tab kept the page (the same target, the mark still set), its frame hidden meanwhile');
  const tabs = await getTabs(s);
  const extra = tabs.tabs[1];
  await s.evalJs(`window.emerald.request('layout.set', ${JSON.stringify({ layout: { ...tabs, tabs: [tabs.tabs[0]], currentTabId: tabs.tabs[0].id } })})`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 1`, `the extra tab ${extra.name} closed`);

  // (j2) M9 fix 669: a split, a zoom, a close and a move beside the page
  // keep it. The page lives in the window's browser layer, so the pane
  // re-parenting under a new split, the zoom hiding it, the sibling's
  // close lifting it back and a new pane id all leave the guest alone.
  const frameFits = async (paneId, what) => {
    const fit = await s.evalJs(`(() => {
      const slot = document.querySelector('.pane[data-pane-id="${paneId}"] .browser-body').getBoundingClientRect();
      const frame = document.querySelector(${JSON.stringify(pageIn(paneId))}).getBoundingClientRect();
      return { dl: frame.left - slot.left, dt: frame.top - slot.top, dw: slot.width - frame.width, dh: slot.height - frame.height };
    })()`);
    const near = (v, want) => Math.abs(v - want) <= 1;
    expect(near(fit.dl, 3) && near(fit.dt, 0) && near(fit.dw, 6) && near(fit.dh, 3), `${what}: the frame sits over the slot inset 3 px left, right and bottom (${JSON.stringify(fit)})`);
  };
  const keptPage = async (what) => {
    const ids = (await guestTargets()).map((t) => t.id);
    const m = await guest.evalJs(`window.__mark`).catch(() => undefined);
    expect(ids.includes(guestId) && m === 659, `${what}: the same guest target and the mark (mark ${m}, targets ${ids.join(',')})`);
  };
  await s.evalJs(`document.querySelector(${JSON.stringify(address)}).focus()`);
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes after the split');
  await frameFits(browserPaneId, 'after the split');
  await keptPage('after the split');
  await s.key('Z', 'KeyZ', 90, CTRL | SHIFT);
  await s.waitFor(`document.querySelector(${JSON.stringify(pageIn(browserPaneId))})?.hidden === true`, 'the page frame hidden while the new pane is zoomed');
  await s.key('Z', 'KeyZ', 90, CTRL | SHIFT);
  await s.waitFor(`document.querySelector(${JSON.stringify(pageIn(browserPaneId))})?.hidden === false`, 'the page frame shown after the zoom');
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'one pane after the close');
  await keptPage('after the close');
  await frameFits(browserPaneId, 'after the close');
  const beforeMove = await getTabs(s);
  const moved = JSON.parse(JSON.stringify(beforeMove).split(browserPaneId).join('moved-669'));
  await s.evalJs(`window.emerald.request('layout.set', ${JSON.stringify({ layout: moved })})`);
  await s.waitFor(`!!document.querySelector('.pane[data-pane-id="moved-669"]')`, 'the browser pane under its new id');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(pageIn('moved-669'))})`, 'the frame follows the new id');
  await keptPage('after the move');
  await frameFits('moved-669', 'after the move');
  expect((await s.evalJs(`document.querySelectorAll('.browser-frame').length`)) === 1, 'one frame after the move');
  expect((await s.evalJs(`document.querySelector('.pane[data-pane-id="moved-669"] .pane-name')?.textContent`)) === 'Emerald fixture one', 'the title row still names the page after the move');
  step('(j2) a split, a zoom, a close and a move beside the page keep it (the same target, the mark still set)');

  // (j3) M9 fix 670: the app's chords pressed in the page. The main
  // process hears the page's keys first and hands the app's to the
  // window; a plain key stays the page's, and Ctrl+R reloads the page,
  // never the window.
  const movedAddress = `.pane[data-pane-id="moved-669"] .browser-address`;
  const paneCount = () => s.evalJs(`document.querySelectorAll('.pane').length`);
  const pageCentre = async () => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(pageIn('moved-669') + ' .browser-page')}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.evalJs(`document.querySelector(${JSON.stringify(movedAddress)}).focus()`);
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes, the new one focused');
  let at = await pageCentre();
  await s.click(at.x, at.y);
  await s.waitFor(`!!document.querySelector('.pane.focused[data-view="browser"]')`, 'a click into the page focuses its pane', 3000);
  const keysBefore = await guest.evalJs('window.__keys');
  await guest.guestKey('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'Ctrl+Shift+E pressed in the page splits its pane', 5000);
  expect((await guest.evalJs('window.__keys')) === keysBefore, `the page did not hear Ctrl+Shift+E (${keysBefore} then ${await guest.evalJs('window.__keys')})`);
  // The split moved the focus to the new pane, as a split from the
  // window does, so the page takes the keyboard back with a click first.
  const clickPage = async () => {
    at = await pageCentre();
    await s.click(at.x, at.y);
    await s.waitFor(`!!document.querySelector('.pane.focused[data-pane-id="moved-669"]')`, 'the page pane focused again', 3000);
    await s.waitFor(`document.activeElement?.tagName === 'WEBVIEW'`, 'the page has the keyboard', 3000).catch(async (err) => {
      console.log(`[670] after the click: window active ${await s.evalJs('document.activeElement?.className')}, page focus ${await guest.evalJs('document.hasFocus()')}`);
      throw err;
    });
  };
  await clickPage();
  await guest.guestKey('a', 'KeyA', 65);
  expect((await guest.evalJs('window.__keys')) === keysBefore + 1, `a plain key still reaches the page (${await guest.evalJs('window.__keys')})`);
  expect((await paneCount()) === 3, 'still three panes after a plain key');
  // The prefix then z zooms the page's own pane (w would hide it, the
  // focused pane now); the same again unzooms it.
  await guest.guestKey('b', 'KeyB', 66, CTRL);
  await guest.guestKey('z', 'KeyZ', 90);
  await s.waitFor(`[...document.querySelectorAll('.splitview')].some((v) => v.dataset.zoomedPane === 'moved-669')`, 'the prefix and z pressed in the page zoom its pane', 5000);
  await clickPage();
  await guest.guestKey('b', 'KeyB', 66, CTRL);
  await guest.guestKey('z', 'KeyZ', 90);
  await s.waitFor(`![...document.querySelectorAll('.splitview')].some((v) => v.dataset.zoomedPane !== undefined)`, 'the prefix and z again unzoom it', 5000);
  expect((await guest.evalJs('window.__keys')) === keysBefore + 1, `the page did not hear the prefix or the z (${await guest.evalJs('window.__keys')})`);
  await clickPage();
  await s.evalJs(`window.__appMark = 670`);
  const loadsBefore = hits('/').length;
  await guest.guestKey('r', 'KeyR', 82, CTRL);
  until = Date.now() + 5000;
  while (hits('/').length === loadsBefore && Date.now() < until) await sleep(100);
  expect(hits('/').length === loadsBefore + 1, `Ctrl+R pressed in the page reloads it (${loadsBefore} then ${hits('/').length})`);
  await guest.waitFor(`document.readyState === 'complete' && location.pathname === '/'`, 'the page loaded again');
  expect((await guestTargets()).map((t) => t.id).includes(guestId), 'the same guest target after the reload');
  expect((await s.evalJs('window.__appMark')) === 670, 'the window was not reloaded');
  const afterKeys = await getTabs(s);
  const findLeaf = (node, id) => (node.id === id ? node : node.kind === 'pane' ? null : findLeaf(node.first, id) ?? findLeaf(node.second, id));
  const first = afterKeys.tabs[0];
  const leaf = findLeaf(first.root, 'moved-669');
  await s.evalJs(`window.emerald.request('layout.set', ${JSON.stringify({ layout: { ...afterKeys, tabs: [{ ...first, root: leaf, focusedPaneId: leaf.id }] } })})`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'back to the browser pane alone');
  step('(j3) Ctrl+Shift+E, the prefix and Ctrl+R pressed in the page reach the app and not the page; a plain key still reaches the page');

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
  // M9 fix 667: a pane under 260 px loses Forward and Developer tools and
  // keeps Back, Reload and a usable address; the wide pane keeps them all.
  const panesOf = `document.querySelectorAll(${JSON.stringify(browserPane)})`;
  const surface = await s.evalJs(`(() => { const p = [...${panesOf}].map((e) => e.getBoundingClientRect()); return Math.max(...p.map((r) => r.right)) - Math.min(...p.map((r) => r.left)); })()`);
  const wideTabs = await getTabs(s);
  const narrowTabs = { ...wideTabs, tabs: wideTabs.tabs.map((t, i) => (i === 0 ? { ...t, root: { ...t.root, ratio: 1 - 200 / surface } } : t)) };
  await s.evalJs(`window.emerald.request('layout.set', ${JSON.stringify({ layout: narrowTabs })})`);
  await s.waitFor(`[...${panesOf}].some((e) => e.querySelector('.browser-view').getBoundingClientRect().width < 260)`, 'a browser pane under 260 px');
  const toolbar = await s.evalJs(`(() => {
    const shown = (e, sel) => getComputedStyle(e.querySelector(sel)).display !== 'none';
    return [...${panesOf}].map((e) => ({ width: Math.round(e.querySelector('.browser-view').getBoundingClientRect().width), forward: shown(e, '.browser-forward'), devtools: shown(e, '.browser-devtools'), back: shown(e, '.browser-back'), reload: shown(e, '.browser-reload'), address: Math.round(e.querySelector('.browser-address').getBoundingClientRect().width) }));
  })()`);
  const tight = toolbar.find((t) => t.width < 260);
  const roomy = toolbar.find((t) => t.width >= 260);
  console.log(`[667] the narrow pane is ${tight?.width} px wide, its address ${tight?.address} px`);
  expect(tight !== undefined && !tight.forward && !tight.devtools && tight.back && tight.reload && tight.address >= 80, `the narrow pane drops Forward and Developer tools and keeps an address (${JSON.stringify(toolbar)})`);
  expect(roomy !== undefined && roomy.forward && roomy.devtools, `the wide pane keeps every button (${JSON.stringify(toolbar)})`);
  await s.screenshot('browser-two-panes-narrow.png');
  await s.evalJs(`window.emerald.request('layout.set', ${JSON.stringify({ layout: { ...(await getTabs(s)), tabs: (await getTabs(s)).tabs.map((t, i) => (i === 0 ? { ...t, root: { ...t.root, ratio: wideTabs.tabs[0].root.ratio } } : t)) } })})`);
  step('(l) emmer open 127.0.0.1:<port>/two opens a second browser pane, and --scheme with a URL is refused');

  // (m) M9 fix 694: closing a browser pane writes no renderer: error line
  // for its guest (Electron's own Invalid guestInstanceId is a note).
  const twoPane = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(browserPane)})].find((e) => e.dataset.url === ${JSON.stringify(`${origin}/two`)})?.dataset.paneId ?? null`);
  expect(twoPane !== null, 'the /two pane by its url');
  await s.evalJs(`document.querySelector(${JSON.stringify(`.pane[data-pane-id="${twoPane}"] .browser-address`)}).focus()`);
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.browser-frame').length === 1 && document.querySelectorAll(${JSON.stringify(browserPane)}).length === 1`, 'one browser pane and one frame after the close');
  await sleep(1000);
  const guestErrors = logText().split(/\r?\n/).filter((l) => /renderer: error .*Invalid guestInstanceId/.test(l));
  expect(guestErrors.length === 0, `closing a browser pane writes no renderer: error line for its guest (${JSON.stringify(guestErrors)})`);
  console.log(`[694] note: ${logText().split(/\r?\n/).filter((l) => /renderer: note .*Invalid guestInstanceId/.test(l)).length} renderer: note lines for Invalid guestInstanceId`);
  step('(m) closing a browser pane writes no renderer: error line for its guest');

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
