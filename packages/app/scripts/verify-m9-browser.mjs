// M9 fix 659 acceptance: a browser pane, a web page beside the shells.
// A fixture server on 127.0.0.1 (a port the script picks) serves two
// pages; the empty pane's Browser tile makes a browser pane, the
// address bar refuses a scheme it does not open, loads host:port and
// shows it without its scheme, takes a bare host over https and words as
// a search, drops two buttons in a narrow pane, the page's title
// reaches the title row, the page has no bridge, a link and Back work,
// Reload and its right-click hard reload reach the server, a new window
// goes to the system browser (held to the log under this private home),
// a popup to a sign-in host opens a small window in the page's session
// that hands back to the page and closes (fix 894),
// a navigation off the web is refused, a webview on another partition is
// still refused (fix 477's guarded case), a menu over the page reads on
// top, a hidden layout tab keeps the page, a split, a zoom, a close and
// a move beside it keep it too (fix 669), the app's chords and Ctrl+R
// pressed in the page reach the app and not the page (fix 670), the toolbar row hides from the pane menu and stays hidden across a link and the reload (fix 839), the record survives a
// renderer reload, and `emmer open <host:port>` opens a second browser
// pane, an HTML file in a folder the Files rail shows opens rendered from its row's menu and its tab's Browser button on emerald-file:, its stylesheet and a file a level up read, a path out of the folder refused and a web page unable to reach it (fix 896 and 897), and the page reloads when its file or stylesheet changes on disk (fix 898). Uses a private home and pipe unless the environment names them.
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
  console.error('[verify] WATCHDOG: run exceeded 240 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  server?.close();
  setTimeout(() => process.exit(3), 500);
}, 240000);

// The fixture: two pages and two targets for the new-window reads, no
// caching header on any answer, every request's path and cache-control
// kept.
const requests = [];
server = http.createServer((req, res) => {
  requests.push({ path: req.url, cacheControl: req.headers['cache-control'] ?? '', ua: req.headers['user-agent'] ?? '' });
  const page = (title, body) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`);
  };
  // The keydown counter is fix 670's: a chord pressed in the page must
  // not reach it, a plain key must.
  if (req.url === '/') page('Emerald fixture one', `<a id="next" href="/two">two</a> <a id="blank" href="/blank-target" target="_blank">blank</a><script>window.__keys = 0; addEventListener('keydown', () => { window.__keys++; }, true);</script>`);
  else if (req.url === '/two') page('Emerald fixture two', '<p>two</p>');
  else if (req.url === '/signin') page('Emerald sign-in', '<a id="done" href="/signin-done">done</a>');
  else if (req.url === '/signin-done') page('Emerald sign-in done', '<p>done</p>');
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

const s = await launch(freshPort(), { freshState: true, env: { EMERALD_SIGNIN_TEST_PREFIX: `${origin}/signin` } });
app = s;
let guest = null;
// Block (n)'s fixture folder and its local page's connection (fixes 896 to 898).
let pageFixture = null;
let pageGuest = null;
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
  // the viewport and clear it after. The sidebar, the rail and the window's
  // chrome around the pane are measured, not written in: they took 522 px
  // until M9 fix 885 widened the rail's default to 330 (592 since).
  const tileRead = () =>
    s.evalJs(`(() => { const tiles = [...document.querySelectorAll('.empty-pane .empty-kind')].map((t) => ({ name: t.querySelector('.empty-kind-name').textContent, r: t.getBoundingClientRect() })); return { pane: Math.round(document.querySelector('.empty-pane').getBoundingClientRect().width), names: tiles.map((t) => t.name), tops: tiles.map((t) => t.r.top), bottoms: tiles.map((t) => t.r.bottom), widths: tiles.map((t) => t.r.width), box: document.querySelector('.empty-kinds').getBoundingClientRect().width, clipped: [...document.querySelectorAll('.empty-pane .empty-kind-name')].some((n) => n.scrollWidth > n.clientWidth) }; })()`);
  const NAMES = JSON.stringify(['Shell', 'Claude session', 'Browser']);
  const viewportH = await s.evalJs(`window.innerHeight`);
  const emulate = async (width) => {
    await s.send('Emulation.setDeviceMetricsOverride', { width, height: viewportH, deviceScaleFactor: 0, mobile: false });
    await sleep(400);
  };
  const stacked = await tileRead();
  const around = (await s.evalJs(`window.innerWidth`)) - stacked.pane;
  console.log(`[666] the empty pane is ${stacked.pane} px wide, ${around} px of the window around it`);
  expect(JSON.stringify(stacked.names) === NAMES && !stacked.clipped, `the three tiles by name, none clipped (${JSON.stringify(stacked)})`);
  expect(stacked.pane <= 760 && stacked.tops[2] >= stacked.bottoms[0] - 0.5 && stacked.widths[2] >= stacked.box * 0.9, `under 760 px the Browser tile has a row of its own (${JSON.stringify(stacked)})`);
  await s.screenshot('browser-tiles.png');
  await emulate(1500);
  const wide = await tileRead();
  console.log(`[666] the empty pane is ${wide.pane} px wide`);
  expect(wide.pane > 760 && JSON.stringify(wide.names) === NAMES && !wide.clipped && Math.max(...wide.tops) - Math.min(...wide.tops) <= 1, `over 760 px the three tiles share one top and none is clipped (${JSON.stringify(wide)})`);
  await s.screenshot('browser-tiles-wide.png');
  await emulate(320 + around);
  const narrow = await tileRead();
  console.log(`[666] the empty pane is ${narrow.pane} px wide`);
  expect(Math.abs(narrow.pane - 320) <= 4 && JSON.stringify(narrow.names) === NAMES && !narrow.clipped && narrow.tops[2] >= narrow.bottoms[0] - 0.5 && narrow.tops[2] >= narrow.bottoms[1] - 0.5 && narrow.widths[2] >= narrow.box * 0.9, `at 320 px the names are whole and the Browser tile sits under both (${JSON.stringify(narrow)})`);
  // M9 fix 706: two tiles a row and whole at 340, 328 and 312 px of pane,
  // one above another at 308 and 278.
  for (const w of [340, 328, 312]) {
    await emulate(w + around);
    const r = await tileRead();
    console.log(`[706] the empty pane is ${r.pane} px wide`);
    expect(Math.abs(r.pane - w) <= 4 && JSON.stringify(r.names) === NAMES && !r.clipped && Math.abs(r.tops[0] - r.tops[1]) <= 1, `at ${w} px the names are whole with two tiles a row (${JSON.stringify(r)})`);
  }
  for (const w of [308, 278]) {
    await emulate(w + around);
    const r = await tileRead();
    console.log(`[706] the empty pane is ${r.pane} px wide`);
    expect(Math.abs(r.pane - w) <= 4 && JSON.stringify(r.names) === NAMES && !r.clipped && r.tops[1] >= r.bottoms[0] - 0.5 && r.tops[2] >= r.bottoms[1] - 0.5, `at ${w} px the names are whole, one tile above another (${JSON.stringify(r)})`);
    if (w === 278) await s.screenshot('browser-tiles-278.png');
  }
  step('M9 fix 706: the tile names stay whole at 340, 328 and 312 px with two tiles a row, and at 308 and 278 px one above another');
  // M9 fix 791: in a narrow pane a tile's shortcut hint goes whole before
  // its name loses a letter. Shell's hint is the person's own binding, so
  // the widths are logged and the relations expected.
  const hintRead = () =>
    s.evalJs(`[...document.querySelectorAll('.empty-pane .empty-kind')].map((t) => { const n = t.querySelector('.empty-kind-name'); const k = t.querySelector('.empty-kind-key'); const box = t.querySelector('.empty-kind-hint'); const shown = k !== null && box !== null && getComputedStyle(box).display !== 'none' && k.getBoundingClientRect().top < box.getBoundingClientRect().bottom - 0.5; return { kind: t.dataset.kind, whole: n.scrollWidth <= n.clientWidth, over: n.scrollWidth - n.clientWidth, hint: k?.textContent ?? null, shown }; })`);
  for (const w of [380, 420, 600]) {
    await emulate(w + around);
    const pane = (await tileRead()).pane;
    expect(Math.abs(pane - w) <= 4, `the empty pane is ${w} px wide, got ${pane}`);
    const r = await hintRead();
    console.log(`[791] at ${w} px ${JSON.stringify(r)}`);
    expect(r.every((t) => !(t.shown && !t.whole)), `at ${w} px no name is clipped beside a hint (${JSON.stringify(r)})`);
    const shell = r.find((t) => t.kind === 'shell');
    const claude = r.find((t) => t.kind === 'claude');
    if (w < 600) expect(shell.whole && !shell.shown, `at ${w} px the Shell name is whole and its hint gone (${JSON.stringify(r)})`);
    else expect(shell.whole && shell.shown && claude.whole && claude.shown, `at ${w} px both hints show with both names whole (${JSON.stringify(r)})`);
    if (w < 600) expect(claude.whole, `fix 818: at ${w} px the Claude session name is whole (${JSON.stringify(r)})`);
    if (w === 380) await s.screenshot('browser-tiles-818-380.png');
    if (w === 420) await s.screenshot('browser-tiles-791-420.png');
  }
  step('M9 fix 791 and 818: at 380 and 420 px both names are whole and the Shell hint gone, no name is clipped beside a hint, and at 600 px both hints show with both names whole');
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

  // (f2) M9 fix 894: a popup to a sign-in host (the test prefix stands in
  // for one under this private home) opens a small window in the page's
  // session; it follows a link, hands a message and a cookie back to the
  // page through window.opener and closes itself.
  const signin = `${origin}/signin`;
  await guest.evalJs(`window.__signin = null; addEventListener('message', (e) => { window.__signin = e.data; }); true`);
  expect((await gesture(`window.open(${JSON.stringify(signin)}) !== null`)) === true, 'window.open to a sign-in host answers a window');
  let signinTarget = null;
  for (let until = Date.now() + 5000; Date.now() < until && signinTarget === null; await sleep(100)) signinTarget = (await pageTargets()).find((t) => t.url === signin) ?? null;
  expect(signinTarget !== null, `a page target on ${signin} (${JSON.stringify((await pageTargets()).map((t) => t.url))})`);
  expect((await pageTargets()).length === 2, `two page targets (${(await pageTargets()).length})`);
  const signinWin = await connect(signinTarget.webSocketDebuggerUrl);
  await waitLog(`browser: sign-in window opened: ${signin}`, 'the sign-in window opened', 5000);
  expect((await signinWin.evalJs(`window.opener !== null`)) === true, 'the sign-in window keeps window.opener');
  const signinSize = await signinWin.evalJs(`({ w: window.outerWidth, h: window.outerHeight })`);
  console.log(`[894] the sign-in window is ${signinSize.w} by ${signinSize.h}`);
  await signinWin.send('Runtime.evaluate', { expression: `document.getElementById('done').click()`, userGesture: true });
  await signinWin.waitFor(`location.pathname === '/signin-done'`, 'the sign-in window followed its link', 5000);
  await signinWin.evalJs(`document.cookie = 'signin894=1; path=/'; window.opener.postMessage('signin894', '*'); setTimeout(() => window.close(), 100); true`);
  await guest.waitFor(`window.__signin === 'signin894'`, 'the page heard the sign-in window', 5000);
  expect((await guest.evalJs(`document.cookie.includes('signin894=1')`)) === true, 'the sign-in window ran in the page\'s partition (its cookie is the page\'s)');
  for (let until = Date.now() + 5000; Date.now() < until && (await pageTargets()).length !== 1; await sleep(100));
  expect((await pageTargets()).length === 1, `one page target again (${(await pageTargets()).length})`);
  signinWin.close();
  await waitLog('browser: sign-in window closed', 'the sign-in window closed', 5000);
  expect((await guestTargets()).length === 1, `one guest target (${(await guestTargets()).length})`);
  expect((await guest.evalJs(`location.href`)) === home, 'the guest is still on /');
  expect(!logText().includes(`link held under a private EMERALD_HOME: ${signin}`), 'the sign-in popup did not go to the system browser');
  step('(f2) M9 fix 894: a popup to a sign-in host opens a 500 by 650 window in the page\'s session, follows a link, hands a message and a cookie back to the page and closes itself; a popup off the list still goes to the system browser');

  // (f3) M9 fix 895: the page and the server both read Chrome's own
  // frozen agent, with no Electron or Emerald token.
  const pageUa = await guest.evalJs(`navigator.userAgent`);
  const serverUa = hits('/').at(-1)?.ua ?? '';
  for (const [who, ua] of [['the page', pageUa], ['the server', serverUa]]) {
    expect(/Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/.test(ua), `${who} reads Chrome's frozen agent (${ua})`);
    expect(!/Electron|Emerald|@emerald/.test(ua), `${who} reads no Electron or Emerald token (${ua})`);
  }
  console.log(`[895] brands ${JSON.stringify(await guest.evalJs(`navigator.userAgentData?.brands ?? null`))}`);
  await waitLog('browser: persist:emerald-browser sends Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'the partition\'s agent is logged');
  step('(f3) M9 fix 895: the page and the server read Chrome\'s own user agent, no Electron or Emerald token');

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

  // (j4) M9 fix 839: Hide browser chrome hides the toolbar row alone.
  const boxes = () => s.evalJs(`(() => {
    const q = (sel) => { const e = document.querySelector(${JSON.stringify(browserPane)} + ' ' + sel); if (e === null) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
    return { title: q('.pane-title'), bar: q('.browser-toolbar'), body: q('.browser-body') };
  })()`);
  const hbBefore = await boxes();
  console.log(`[839] before: title bottom ${hbBefore.title.bottom}, toolbar top ${hbBefore.bar.top} (${hbBefore.bar.height} px), body top ${hbBefore.body.top}, body height ${hbBefore.body.height}`);
  const viewOf = async () => leaves(await getLayout(s)).find((p) => p.view?.kind === 'browser').view;
  const titleMenu = async () => {
    const c = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(browserPane + ' .pane-title')}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.evalJs(`document.querySelector(${JSON.stringify(browserPane + ' .pane-title')}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${c.x}, clientY: ${c.y} }))`);
    await s.waitFor(`!!document.querySelector('.pane-menu')`, 'the pane menu opened');
  };
  const clickMenu = (label) => s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
  await titleMenu();
  expect((await s.evalJs(`document.querySelector('.pane-menu .menu-label')?.textContent`)) === 'Hide browser chrome', 'the menu leads with Hide browser chrome');
  await clickMenu('Hide browser chrome');
  await s.waitFor(`!document.querySelector(${JSON.stringify(browserPane + ' .browser-toolbar')}) && !document.querySelector('.pane-menu')`, 'the toolbar row is gone and the menu closed');
  const hbAfter = await boxes();
  const bodyRef = Math.abs(hbBefore.bar.top - hbBefore.title.bottom) > 1 ? hbBefore.bar.top : hbBefore.title.bottom;
  expect(Math.abs(hbAfter.body.top - hbAfter.title.bottom) <= 1 || Math.abs(hbAfter.body.top - bodyRef) <= 1, `the body starts under the title (${hbAfter.body.top} against ${hbAfter.title.bottom})`);
  expect(Math.abs(hbAfter.body.height - (hbBefore.body.height + hbBefore.bar.height)) <= 1, `the body took the row's height (${hbBefore.body.height} + ${hbBefore.bar.height} then ${hbAfter.body.height})`);
  expect((await viewOf()).toolbar === false, 'the record carries toolbar: false');
  const slotTop = () => s.evalJs(`document.querySelector(${JSON.stringify(browserPane + ' .browser-body')}).getBoundingClientRect().top`);
  const frameTop = () => s.evalJs(`document.querySelector(${JSON.stringify(pageIn('moved-669'))}).getBoundingClientRect().top`);
  until = Date.now() + 3000;
  while (Math.abs((await frameTop()) - (await slotTop())) > 1 && Date.now() < until) await sleep(100);
  await frameFits('moved-669', 'with the toolbar hidden');
  await gesture(`document.getElementById('next').click()`);
  await guest.waitFor(`location.pathname === '/two'`, 'the guest on /two');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(origin + '/two')}`, 'the record follows the link');
  expect((await viewOf()).toolbar === false, 'the record keeps toolbar: false across a link');
  expect(!(await s.evalJs(`!!document.querySelector(${JSON.stringify(browserPane + ' .browser-toolbar')})`)), 'the row is still absent after a link');
  await gesture('history.back()');
  await guest.waitFor(`location.pathname === '/'`, 'the guest back on /');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(home)}`, 'the record back on /');
  expect((await viewOf()).toolbar === false, 'the record keeps toolbar: false across Back');
  step('(j4) M9 fix 839: Hide browser chrome hides the toolbar row alone, the page takes its room, and a link and Back keep it hidden');

  // (k) The record survives a renderer reload.
  guest.close();
  guest = null;
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body')`, 'app after reload');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(home)}`, 'the browser pane back on /');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane + ' .pane-name')})?.textContent === 'Emerald fixture one'`, 'titled one again', 15000);
  expect(!(await s.evalJs(`!!document.querySelector(${JSON.stringify(browserPane + ' .browser-toolbar')})`)), 'the row is still hidden after the reload');
  expect((await viewOf()).toolbar === false, 'the record is still at toolbar: false after the reload');
  await titleMenu();
  expect((await s.evalJs(`document.querySelector('.pane-menu .menu-label')?.textContent`)) === 'Show browser chrome', 'the menu now offers Show browser chrome');
  await clickMenu('Show browser chrome');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(browserPane + ' .browser-toolbar')}) && !document.querySelector('.pane-menu')`, 'the toolbar row is back and the menu closed');
  expect(!('toolbar' in (await viewOf())), 'the shown row leaves no toolbar key on the record');
  step('(k) the browser pane comes back on its page after a renderer reload, its toolbar row still hidden until Show browser chrome brings it back (fix 839)');

  // (k2) M9 fix 931: a page's own zoom is kept across a reload of the
  // page, and the pane menu's Reset page zoom puts it back. The wheel goes
  // through the tag's sendInputEvent, since a CDP mouseWheel carries no
  // ticks and zooms nothing (fix 899's close-out).
  const zoomPane = await s.evalJs(`document.querySelector(${JSON.stringify(browserPane)}).dataset.paneId`);
  const zoomTag = `.browser-frame[data-browser-pane=${JSON.stringify(zoomPane)}] webview`;
  const pageLevel = () => s.evalJs(`document.querySelector(${JSON.stringify(zoomTag)}).getZoomLevel()`);
  const inPage = (code) => s.evalJs(`document.querySelector(${JSON.stringify(zoomTag)}).executeJavaScript(${JSON.stringify(code)})`);
  const g0 = await pageLevel();
  console.log(`[931] window level ${await s.evalJs('window.emerald.zoom.level()')}, page level ${g0}`);
  await s.evalJs(`(() => { const w = document.querySelector(${JSON.stringify(zoomTag)}); const r = w.getBoundingClientRect(); w.sendInputEvent({ type: 'mouseWheel', x: Math.round(r.width / 2), y: Math.round(r.height / 2), deltaX: 0, deltaY: 120, wheelTicksX: 0, wheelTicksY: 1, canScroll: true, modifiers: ['control'] }); })()`);
  until = Date.now() + 3000;
  while (Math.abs((await pageLevel()) - g0) !== 1 && Date.now() < until) await sleep(100);
  await sleep(300);
  const stepped = await pageLevel();
  expect(Math.abs(stepped - g0) === 1, `a Ctrl+wheel steps the page one level (${g0} then ${stepped})`);
  await inPage('window.__mark931 = 1');
  await s.evalJs(`document.querySelector(${JSON.stringify(browserPane + ' .browser-reload')}).click()`);
  until = Date.now() + 10000;
  while (!(await inPage('window.__mark931 === undefined && document.readyState === "complete"').catch(() => false)) && Date.now() < until) await sleep(100);
  await sleep(1000);
  const reloaded = await pageLevel();
  expect(reloaded === stepped, `a reload keeps the page's zoom (${stepped} then ${reloaded})`);
  // M9 fix 966: a reload of the window keeps it too; main reads the level
  // as the window starts to reload and gives it to the new guest.
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body')`, 'app after reload (966)');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane)})?.dataset.url === ${JSON.stringify(home)}`, 'the browser pane back on / (966)');
  await s.waitFor(`document.querySelector(${JSON.stringify(browserPane + ' .pane-name')})?.textContent === 'Emerald fixture one'`, 'titled one again (966)', 15000);
  await waitLog(`browser: pane ${zoomPane.slice(0, 8)} keeps zoom ${stepped} across the window's reload`, 'main read the page zoom as the window reloaded (fix 966)');
  until = Date.now() + 10000;
  while (!(await inPage('document.readyState === "complete"').catch(() => false)) && Date.now() < until) await sleep(100);
  await sleep(1000);
  const windowReloaded = await pageLevel();
  expect(windowReloaded === stepped, `a reload of the window keeps the page's zoom (fix 966) (${stepped} then ${windowReloaded})`);
  const resetItem = () => s.evalJs(`(() => { const items = [...document.querySelectorAll('.pane-menu .menu-item')]; const at = items.findIndex((b) => b.querySelector('.menu-label')?.textContent === 'Reset page zoom'); if (at < 0) return null; const b = items[at]; return { before: items[at - 1]?.querySelector('.menu-label')?.textContent ?? null, disabled: b.disabled, title: b.title }; })()`);
  await titleMenu();
  const offItem = await resetItem();
  expect(offItem !== null && !offItem.disabled && offItem.before === 'Focus', `Reset page zoom is enabled, after Focus (${JSON.stringify(offItem)})`);
  await clickMenu('Reset page zoom');
  until = Date.now() + 3000;
  while ((await pageLevel()) !== g0 && Date.now() < until) await sleep(100);
  expect((await pageLevel()) === g0, `Reset page zoom puts the page back at ${g0} (${await pageLevel()})`);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'the menu closed after Reset page zoom');
  await titleMenu();
  const atItem = await resetItem();
  expect(atItem !== null && atItem.disabled && atItem.title === 'Already at 100%', `Reset page zoom is disabled at the default with Already at 100% (${JSON.stringify(atItem)})`);
  await s.evalJs(`document.querySelector('.pane-menu') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'the pane menu closed');
  step("(k2) M9 fixes 931 and 966: a Ctrl+wheel steps the page one level, a reload of the page and a reload of the window keep it, and the pane menu's Reset page zoom, after Focus, puts it back and is then disabled with Already at 100%");

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

  // (n) M9 fixes 896 and 897: an HTML file in a folder the Files rail
  // shows, rendered in a browser pane on emerald-file:. The fixture is
  // realpathed, since %TEMP% is in 8.3 form on this box and the rail's
  // data-paths are the long form.
  if (guest === null) {
    const t = (await targets()).find((x) => x.type === 'webview' && x.url === home);
    expect(t !== undefined, 'the web page guest on / to reconnect');
    guest = await connect(t.webSocketDebuggerUrl);
  }
  const fx = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-verify-page-')));
  pageFixture = fx;
  const site = path.join(fx, 'site');
  const pagePath = path.join(site, 'page.html');
  const pageHtml = (title) => `<!doctype html><html><head><title>${title}</title><link rel="stylesheet" href="style.css"></head><body><p id="p">local</p><a id="web" href="${origin}/two">web</a></body></html>`;
  fs.mkdirSync(site);
  fs.writeFileSync(pagePath, pageHtml('Local page one'));
  fs.writeFileSync(path.join(site, 'style.css'), '#p { color: rgb(1, 2, 3); }');
  fs.writeFileSync(path.join(fx, 'up.txt'), 'up text');
  fs.writeFileSync(path.join(site, 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  fs.mkdirSync(fx + '-outside');
  fs.writeFileSync(path.join(fx + '-outside', 'secret.txt'), 'secret');
  fs.symlinkSync(fx + '-outside', path.join(site, 'out'), 'junction');
  // A file opens pinned as a tab, and the rail follows it.
  r = await cliOpen(pagePath);
  expect(r.code === 0, `emmer open page.html (${r.code}: ${JSON.stringify(r.out)} ${JSON.stringify(r.err)})`);
  await s.waitFor(`document.querySelector('.file-view .file-header .file-path')?.title === ${JSON.stringify(pagePath)}`, 'the page.html file tab');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(site)}`, 'the rail on site', 8000).catch(() => {});
  console.log(`[897] the rail's root after the open: ${await s.evalJs(`document.querySelector('.files-rail')?.dataset.root ?? null`)}`);
  await s.evalJs(`document.querySelector('.files-up').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(fx)}`, 'the rail up on the fixture');
  // The tab's Browser button.
  expect((await s.evalJs(`document.querySelector('.file-view .file-browser')?.textContent ?? null`)) === 'Browser', 'the file tab offers Browser');
  await s.evalJs(`document.querySelector('.file-view .file-browser').click()`);
  const localView = async () => leaves(await getLayout(s)).filter((p) => p.view?.kind === 'browser' && p.view.url.startsWith('emerald-file://')).map((p) => p.view);
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(browserPane)}).length === 2 && [...document.querySelectorAll(${JSON.stringify(browserPane)})].every((e) => e.getBoundingClientRect().width > 0)`, 'two browser panes on show');
  await sleep(500);
  expect((await s.evalJs(`document.querySelector('.files-rail')?.dataset.root ?? null`)) === fx, "the Browser button kept the rail's Up lift (fix 932)");
  const firstLocal = (await localView())[0];
  expect(firstLocal !== undefined && /^emerald-file:\/\/[0-9a-f-]{36}\/site\/page\.html$/.test(firstLocal.url) && firstLocal.root === fx, `the new pane's record is the page on its root (${JSON.stringify(firstLocal)})`);
  const localUrl = firstLocal.url;
  const rootId = new URL(localUrl).host;
  let localTarget = null;
  const localDeadline = Date.now() + 15000;
  while (localTarget === null && Date.now() < localDeadline) {
    localTarget = (await targets()).find((x) => x.type === 'webview' && x.url.startsWith('emerald-file://')) ?? null;
    if (localTarget === null) await sleep(200);
  }
  expect(localTarget !== null, 'a guest target on emerald-file:');
  const local = await connect(localTarget.webSocketDebuggerUrl);
  pageGuest = local;
  const localGesture = async (expression) => {
    const res = await local.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (res.exceptionDetails) throw new Error('local page threw: ' + JSON.stringify(res.exceptionDetails).slice(0, 400));
    return res.result.value;
  };
  await local.waitFor(`document.title === 'Local page one' && document.readyState === 'complete'`, 'the local page loaded');
  expect((await local.evalJs(`getComputedStyle(document.getElementById('p')).color`)) === 'rgb(1, 2, 3)', 'the stylesheet came from the folder');
  expect((await local.evalJs(`fetch('../up.txt').then((x) => x.text())`)) === 'up text', 'a file a level up, under the rail root, reads');
  expect((await local.evalJs(`fetch('out/secret.txt').then((x) => x.status)`)) === 403, 'a junction out of the folder is 403');
  await waitLog('browser: local page refused (403 outside the folder): emerald-file://', 'the junction refusal');
  expect((await local.evalJs(`fetch('..%5C..%5Csecret.txt').then((x) => x.status)`)) === 400, 'a backslash path is 400');
  expect((await local.evalJs(`fetch('nope.html').then((x) => x.status)`)) === 404, 'a missing file is 404');
  expect((await local.evalJs(`[typeof window.emerald, typeof require, typeof process].join()`)) === 'undefined,undefined,undefined', 'the local page has no bridge');
  const localPaneSel = `.pane[data-view="browser"][data-url=${JSON.stringify(localUrl)}]`;
  await s.waitFor(`document.querySelector(${JSON.stringify(localPaneSel + ' .pane-name')})?.textContent === 'Local page one'`, 'the pane title names the local page');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(localPaneSel + ' .browser-address')})?.value`)) === 'site/page.html', 'the unfocused address reads site/page.html');
  // M9 fix 933: every text the error line shows on a frame, kept from the
  // observer's records, so a line drawn and cleared again before a read
  // still counts.
  const localPaneId = await s.evalJs(`document.querySelector(${JSON.stringify(localPaneSel)}).dataset.paneId`);
  const watchErrors = (paneId, key) =>
    s.evalJs(`(() => {
      const frame = document.querySelector(${JSON.stringify(`.browser-frame[data-browser-pane=${JSON.stringify(paneId)}]`)});
      const seen = (window[${JSON.stringify(key)}] = []);
      const obs = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'characterData' && r.target.parentElement?.closest('.browser-error')) seen.push(r.target.textContent);
          for (const n of r.addedNodes) {
            if (n.nodeType === 3 && n.parentElement?.closest('.browser-error')) seen.push(n.textContent);
            if (n.nodeType !== 1) continue;
            const line = n.matches('.browser-error') ? n : n.querySelector('.browser-error');
            if (line !== null) seen.push(line.textContent);
          }
        }
      });
      obs.observe(frame, { childList: true, subtree: true, characterData: true });
      window[${JSON.stringify(key + 'Stop')}] = () => obs.disconnect();
      return frame !== null;
    })()`);
  const stopWatch = (key) => s.evalJs(`(() => { window[${JSON.stringify(key + 'Stop')}](); return window[${JSON.stringify(key)}]; })()`);
  // Out to the web and Back.
  await localGesture(`document.getElementById('web').click()`);
  await local.waitFor(`location.href === ${JSON.stringify(`${origin}/two`)}`, 'the local page linked out to /two');
  const pageRecord = async () => leaves(await getLayout(s)).find((p) => p.view?.kind === 'browser' && p.view.url !== home)?.view ?? null;
  const outDeadline = Date.now() + 5000;
  let outView = await pageRecord();
  while (!(outView?.url === `${origin}/two`) && Date.now() < outDeadline) {
    await sleep(150);
    outView = await pageRecord();
  }
  expect(outView?.url === `${origin}/two` && !('root' in outView), `the record went to /two with no root (${JSON.stringify(outView)})`);
  expect(await watchErrors(localPaneId, '__error933'), 'the local pane\'s frame to watch');
  await localGesture('history.back()');
  await local.waitFor(`document.title === 'Local page one'`, 'Back on the local page');
  const backDeadline = Date.now() + 5000;
  let backView = await pageRecord();
  while (!(backView?.url === localUrl && backView.root === fx) && Date.now() < backDeadline) {
    await sleep(150);
    backView = await pageRecord();
  }
  expect(backView?.url === localUrl && backView.root === fx, `the record back on the local page with its root (${JSON.stringify(backView)})`);
  const backErrors = await stopWatch('__error933');
  expect(!backErrors.some((t) => t.includes('a web page cannot open a page from the disk')), `Back onto the page from the disk flashed no refusal (fix 933) (${JSON.stringify(backErrors)})`);
  // The control: the web page cannot navigate into, fetch or embed it.
  // Fix 933's observer is armed on the web page's frame too, as its
  // control: this refusal does reach the error line.
  const homePaneId = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(browserPane)})].find((e) => e.dataset.url === ${JSON.stringify(home)})?.dataset.paneId ?? null`);
  expect(homePaneId !== null && (await watchErrors(homePaneId, '__error933home')), 'the web page\'s frame to watch');
  await gesture(`location.href = ${JSON.stringify(localUrl)}`).catch(() => {});
  await sleep(1500);
  expect((await guest.evalJs('location.href')) === home, 'the web page stayed on / (it cannot navigate into the disk)');
  const homeErrors = await stopWatch('__error933home');
  expect(homeErrors.some((t) => t.includes('a web page cannot open a page from the disk')), `the web page's refusal reached the home frame's error line, from main's guard (fix 967) (${JSON.stringify(homeErrors)})`);
  await waitLog('browser: navigation refused: emerald-file://', 'the guard refused the local navigation (fix 896)');
  expect((await guest.evalJs(`fetch(${JSON.stringify(localUrl)}).then(() => 'read', () => 'refused')`)) === 'refused', 'the web page cannot fetch the local page');
  const dotUrl = `emerald-file://${rootId}/site/dot.png`;
  expect((await guest.evalJs(`new Promise((res) => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('error'); i.src = ${JSON.stringify(dotUrl)}; })`)) === 'error', 'the web page cannot embed a local image');
  // The row's menu.
  const pageRow = `.files-row[data-path=${JSON.stringify(pagePath)}]`;
  const styleRow = `.files-row[data-path=${JSON.stringify(path.join(site, 'style.css'))}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(pageRow)}) && !!document.querySelector(${JSON.stringify(styleRow)})`, 'the page.html and style.css rows under site');
  const rowCentre = (sel) => s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  const menuLabels = () => s.evalJs(`[...document.querySelectorAll('.files-menu .menu-label')].map((b) => b.textContent).join(',')`);
  let rowAt = await rowCentre(pageRow);
  await s.rightClick(rowAt.x, rowAt.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(pagePath)}`, 'the page row menu');
  const pageLabels = await menuLabels();
  expect(pageLabels === 'Open in a tab,Rename,Open in a pane,Open in browser,Open with Windows,Reveal in Explorer,Copy path,Copy relative path,Insert path into pane,Delete', `the page row menu offers Open in browser (${pageLabels})`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed');
  rowAt = await rowCentre(styleRow);
  await s.rightClick(rowAt.x, rowAt.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(path.join(site, 'style.css'))}`, 'the style row menu');
  expect(!(await menuLabels()).split(',').includes('Open in browser'), 'style.css offers no Open in browser');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed again');
  rowAt = await rowCentre(pageRow);
  await s.rightClick(rowAt.x, rowAt.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(pagePath)}`, 'the page row menu again');
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Open in browser').click()`);
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(browserPane)}).length === 3`, 'a third browser pane');
  await sleep(500);
  expect((await s.evalJs(`document.querySelector('.files-rail')?.dataset.root ?? null`)) === fx, "Open in browser kept the rail's Up lift (fix 932)");
  const locals = await localView();
  expect(locals.length === 2 && locals.every((v) => new URL(v.url).host === rootId && v.root === fx), `the newest pane shares the root id and its root (${JSON.stringify(locals)})`);
  step('(n) M9 fixes 896 and 897: an HTML file in a folder the rail shows opens rendered on emerald-file: from its tab\'s Browser button and its row\'s Open in browser, its stylesheet and a file a level up read, a junction out of the folder and a backslash path refused, a link out and Back, and a web page unable to navigate, fetch or embed it');

  // (n2) M9 fix 898: the page reloads on the Files rail's watcher. The
  // mark tells a reload from a script's own change.
  await local.evalJs('window.__mark = 898');
  fs.writeFileSync(pagePath, pageHtml('Local page two'));
  await local.waitFor(`document.title === 'Local page two'`, 'the page reloaded on its own change', 5000);
  expect((await local.evalJs('window.__mark')) === undefined, 'a reload, not a change in place');
  fs.writeFileSync(path.join(site, 'style.css'), '#p { color: rgb(4, 5, 6); }');
  await local.waitFor(`getComputedStyle(document.getElementById('p') ?? document.body).color === 'rgb(4, 5, 6)'`, 'the page reloaded on its stylesheet', 5000);
  fs.rmSync(pagePath);
  // The body is null for a moment while the page reloads.
  await local.waitFor(`document.body?.innerText.includes('is not there') === true`, 'the not-there page once the file is gone', 5000);
  fs.writeFileSync(pagePath, pageHtml('Local page three'));
  await local.waitFor(`document.title === 'Local page three'`, 'the page back once the file is written again', 5000);
  step('(n2) M9 fix 898: a page from the disk reloads when its file or its stylesheet changes on disk, shows the not-there page when the file is deleted and comes back when it is written again');

  // (n3) M9 fix 936: emmer open page.html --browser renders the page in a
  // pane on the root the rail gives it, and a page outside the rail's
  // folder on its own folder.
  const railAt = await s.evalJs(`document.querySelector('.files-rail')?.dataset.root ?? null`);
  console.log(`[936] the rail's root at the open: ${railAt}`);
  const urlsBefore = (await localView()).map((v) => v.url);
  r = await cliOpen(pagePath, '--browser');
  expect(r.code === 0 && r.out.trim() === `opened ${pagePath} in a pane`, `emmer open page.html --browser (${r.code}: ${JSON.stringify(r.out)} ${JSON.stringify(r.err)})`);
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(browserPane)}).length === 4`, 'a fourth browser pane');
  const localsSettled = async (done) => {
    const deadline = Date.now() + 5000;
    let views = await localView();
    while (!done(views) && Date.now() < deadline) {
      await sleep(150);
      views = await localView();
    }
    return views;
  };
  if (railAt === fx) {
    const views = await localsSettled((vs) => vs.filter((v) => v.url === localUrl).length === 3);
    expect(views.filter((v) => v.url === localUrl && v.root === fx).length === 3, `the --browser page on the rail's folder shares the root id (${JSON.stringify(views)})`);
  } else if (railAt === site) {
    const views = await localsSettled((vs) => vs.some((v) => !urlsBefore.includes(v.url)));
    const fresh = views.find((v) => !urlsBefore.includes(v.url));
    expect(fresh !== undefined && fresh.root === site && /^emerald-file:\/\/[0-9a-f-]{36}\/page\.html$/.test(fresh.url) && new URL(fresh.url).host !== rootId, `the --browser page on the rail's folder site (${JSON.stringify(views)})`);
  } else expect(false, `the rail's root at the open is ${railAt}, neither the fixture nor its site folder`);
  const outside = fx + '-outside';
  const alonePath = path.join(outside, 'alone.html');
  fs.writeFileSync(alonePath, pageHtml('Alone page'));
  r = await cliOpen(alonePath, '--browser');
  expect(r.code === 0 && r.out.trim() === `opened ${alonePath} in a pane`, `emmer open alone.html --browser (${r.code}: ${JSON.stringify(r.out)} ${JSON.stringify(r.err)})`);
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(browserPane)}).length === 5`, 'a fifth browser pane');
  const aloneViews = await localsSettled((vs) => vs.some((v) => v.root === outside));
  const alone = aloneViews.find((v) => v.root === outside);
  expect(alone !== undefined && /^emerald-file:\/\/[0-9a-f-]{36}\/alone\.html$/.test(alone.url) && new URL(alone.url).host !== rootId, `a page outside the rail's folder on its own folder (${JSON.stringify(aloneViews)})`);
  step('(n3) M9 fix 936: emmer open page.html --browser renders the page in a browser pane on the rail\'s folder, and a page outside it on its own folder');

  // (n4) M9 fix 967: once the local pane's history has dropped the page
  // from the disk, a link back onto it is refused by main's guard, and the
  // pane's error line says so from main's word rather than the renderer's
  // guess, which still counted the page as shown.
  const localTag = `.browser-frame[data-browser-pane=${JSON.stringify(localPaneId)}] webview`;
  await localGesture(`document.getElementById('web').click()`);
  await local.waitFor(`location.href === ${JSON.stringify(`${origin}/two`)}`, 'the local pane out on /two (967)');
  await s.evalJs(`document.querySelector(${JSON.stringify(localTag)}).clearHistory()`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(localTag)}).canGoBack()`, "the local pane's history cleared");
  const refusedBefore = logText().split(`browser: navigation refused: ${localUrl}`).length;
  expect(await watchErrors(localPaneId, '__error967'), "the local pane's frame to watch (967)");
  await localGesture(`location.href = ${JSON.stringify(localUrl)}`).catch(() => {});
  await sleep(1500);
  expect((await local.evalJs('location.href')) === `${origin}/two`, 'the page stayed on /two (main refused the page from the disk)');
  const droppedErrors = await stopWatch('__error967');
  expect(droppedErrors.some((t) => t === `This page tried to open ${localUrl}; a web page cannot open a page from the disk`), `the error line names a page from the disk the history dropped (fix 967) (${JSON.stringify(droppedErrors)})`);
  expect(logText().split(`browser: navigation refused: ${localUrl}`).length === refusedBefore + 1, 'main logged the refusal once');
  step('(n4) M9 fix 967: a link onto a page from the disk the history has dropped is refused by main, and the pane\'s error line says so');

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
  pageGuest?.close();
  s.close();
  killTree(s.child);
  stopDaemon();
  server.close();
  if (pageFixture !== null) {
    for (const dir of [pageFixture, pageFixture + '-outside']) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        console.log(`[896] note: the fixture ${dir} stays: ${err.message}`);
      }
    }
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
