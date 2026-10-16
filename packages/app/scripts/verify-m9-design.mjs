// M9 fixes 674 and 675 acceptance: Design Mode. A browser pane beside a
// stub Claude session (a shell a hook has reached counts as Claude, and a
// node raw-stdin stub in it records what is pasted); the toolbar toggle,
// the hint bar and the target in the title; the hover's outline and pill
// inside the page's closed shadow root; S and C to the clipboard; a click
// that pastes one markdown block into the stub with its crop on disk and
// the page seeing no click; the chord from the window and from the page,
// Escape and Cancel; and the tray, two picks with a comment each sent as
// one numbered block. Fix 695: the hint names the comment box while it
// holds the keys, and Escape or Ctrl+Enter there hands them back to the
// page. Fix 697: with no Claude session in the tab the tray's button
// copies the notes and keeps them. Fix 698: in a pane under 600 px the
// tray docks under the page, which keeps its width, and in a wider pane
// it sits beside the page as before. Fix 696: the launch removes the PNGs older than 14 days from the
// home's design and screenshots folders. Uses a private home and pipe
// unless the environment names them.
// Run: npm run verify:design -w @emerald/app
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'design-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-design';
const { CTRL, SHIFT, connect, expect, freshPort, getLayout, getTabs, killTree, launch, leaves, sleep, startFromEmpty, step, stopDaemon } = await import('./cdp.mjs');

let app = null;
let server = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 180 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  server?.close();
  setTimeout(() => process.exit(3), 500);
}, 180000);

// The fixture: one page, a paragraph and a button, and a count of every
// click the page sees, taken in the capture phase before any handler of
// the picker's could stop it at the target.
server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    '<!doctype html><html><head><title>Emerald design fixture</title><script>window.pageClicks = 0; document.addEventListener("click", () => { window.pageClicks++; }, true);</script></head>' +
      '<body><main><p id="intro">Plans and pricing</p><button id="cta" style="padding: 12px 20px; font-size: 16px">Start free trial</button></main></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const home = process.env['EMERALD_HOME'];
const stubFile = path.join(home, 'design-stub.cjs');
const stubOut = path.join(home, 'design-stub-out.bin');
const fwd = (p) => p.replace(/\\/g, '/');
const stubText = () => (fs.existsSync(stubOut) ? fs.readFileSync(stubOut, 'latin1') : '');

// Fix 696's seed: a PNG 15 days old in each of design, screenshots and
// downloads and a new one in design, before the launch prunes. launch's
// freshState removes only the state files and the profile, so these
// survive it.
const seedOld = ['design', 'screenshots', 'downloads'].map((d) => path.join(home, d, 'seed-old.png'));
const seedNew = path.join(home, 'design', 'seed-new.png');
const fifteenDaysBack = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
for (const f of [...seedOld, seedNew]) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'seed');
}
for (const f of seedOld) fs.utimesSync(f, fifteenDaysBack, fifteenDaysBack);

const s = await launch(freshPort(), { freshState: true });
app = s;
let guest = null;
try {
  const browserPane = `.pane[data-view="browser"]`;
  const inPane = (sel) => `${browserPane} ${sel}`;
  const q = (sel) => JSON.stringify(sel);
  const text = (sel) => s.evalJs(`document.querySelector(${q(sel)})?.textContent ?? null`);
  const pressed = (sel) => s.evalJs(`document.querySelector(${q(sel)})?.getAttribute('aria-pressed') ?? null`);
  const click = (sel) => s.evalJs(`document.querySelector(${q(sel)}).click()`);
  const cornerNote = () => text('.corner-note');

  // The stub session: a shell from the one empty pane, a node stub that
  // asks for bracketed paste and appends every byte it reads, and a
  // SessionStart hook so markKind reads the shell as Claude.
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(
    stubFile,
    "const fs = require('fs'); const out = process.argv[2]; process.stdout.write('\\x1b[?2004h'); process.stdin.setRawMode(true); process.stdin.on('data', (d) => fs.appendFileSync(out, d)); fs.writeFileSync(out + '.ready', '');",
  );
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-kind[data-kind="shell"]')`, 'the empty pane');
  await startFromEmpty(s);
  const stubPane = leaves(await getLayout(s))[0];
  const stubSession = stubPane.sessionId;
  await sleep(1500);
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${q(stubSession)}, data: ${q(`& '${fwd(process.execPath)}' '${fwd(stubFile)}' '${fwd(stubOut)}'\r`)} })`);
  // The terminal draws on a canvas, so the stub says it is reading by a
  // file of its own.
  let ready = Date.now() + 15000;
  while (!fs.existsSync(stubOut + '.ready') && Date.now() < ready) await sleep(200);
  expect(fs.existsSync(stubOut + '.ready'), 'the stub is reading');
  const daemon = JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8'));
  const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
    method: 'POST',
    headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': stubSession },
    body: JSON.stringify({ session_id: 'sim-design', cwd: os.homedir(), hook_event_name: 'SessionStart', source: 'startup' }),
  });
  expect(res.status === 204, `the sink answered 204 for SessionStart (${res.status})`);

  // The browser pane: Split right on the stub, the new empty pane's
  // Browser tile (fix 666) and the fixture's address.
  await click(`[data-pane-id=${JSON.stringify(stubPane.id)}] .pane-split-right`);
  const browserTile = `.empty-pane .empty-kind[data-kind="browser"]`;
  await s.waitFor(`!!document.querySelector(${q(browserTile)})`, 'the Browser tile in the new empty pane');
  await click(browserTile);
  await s.waitFor(`!!document.querySelector(${q(inPane('.browser-address'))})`, 'a browser pane');
  const webPaneId = leaves(await getLayout(s)).find((p) => p.view?.kind === 'browser').id;
  // The page lives in the window's browser layer (fix 669), not in the pane.
  const webview = `.browser-frame[data-browser-pane="${webPaneId}"] webview`;
  await s.evalJs(`(() => { const i = document.querySelector(${q(inPane('.browser-address'))}); i.focus(); i.select(); })()`);
  await s.type(`127.0.0.1:${port}`);
  await s.key('Enter', 'Enter', 13);
  let found = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    found = (await (await fetch(`http://127.0.0.1:${s.port}/json`)).json()).find((t) => t.type === 'webview' && t.title === 'Emerald design fixture');
    if (found) break;
    await sleep(200);
  }
  expect(found !== null && found !== undefined, 'the guest target at the fixture');
  guest = await connect(found.webSocketDebuggerUrl);
  const ev = async (expression) => {
    const r = await guest.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('guest threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const hostIn = () => ev(`!!document.querySelector('[data-emerald-design-host]')`);
  const rectOf = (id) => ev(`(() => { const r = document.getElementById(${q(id)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const guestMouse = async (type, p) => guest.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  const guestClick = async (p) => {
    await guestMouse('mouseMoved', p);
    await guestMouse('mousePressed', p);
    await guestMouse('mouseReleased', p);
  };
  // The page takes the keyboard before each key; cdp.mjs's guestKey (fix 731) says why the key goes as a rawKeyDown.
  const focusPage = () => s.evalJs(`document.querySelector(${q(webview)}).focus()`);
  await s.waitFor(`document.querySelector(${q(inPane('.pane-name'))})?.textContent === 'Emerald design fixture'`, 'the title row names the page');
  const stubName = await s.evalJs(`document.querySelector(${q(`[data-pane-id=${JSON.stringify(stubPane.id)}] .pane-name`)})?.textContent ?? ''`);

  // (a) The button, the hint bar and the target.
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.disabled === false`, 'the Design Mode button enabled');
  await click(inPane('.browser-design'));
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.getAttribute('aria-pressed') === 'true'`, 'Design Mode on');
  expect((await text(inPane('.design-hint .design-hint-text'))) === 'Hover and press C to copy, S for screenshot, or click to select', `the hint (${await text(inPane('.design-hint .design-hint-text'))})`);
  expect((await text(inPane('.design-cancel'))) === 'Cancel', 'the hint bar has Cancel');
  expect((await text(inPane('.design-target'))) === `Design Mode → ${stubName}`, `the title names the stub (${await text(inPane('.design-target'))}, the stub ${stubName})`);
  expect((await s.evalJs(`document.querySelector(${q(inPane('.design-target'))}).title`)) === `Design Mode → ${stubName}`, 'the chip carries its words as a title');
  // Fix 730: the chip gives with an ellipsis before the title's buttons do,
  // so the close button stays inside the pane.
  const inside = await s.evalJs(`(() => { const p = document.querySelector(${q(browserPane)}).getBoundingClientRect(); const c = document.querySelector(${q(inPane('.pane-close'))}).getBoundingClientRect(); return { pane: p.right, close: c.right }; })()`);
  expect(inside.close <= inside.pane + 0.5, `the title's close button inside the pane with the mode on (${JSON.stringify(inside)})`);
  const chipSize = await s.evalJs(`(() => { const e = document.querySelector(${q(inPane('.design-target'))}); return { width: e.offsetWidth, text: e.scrollWidth }; })()`);
  console.log(`[730] the chip is ${chipSize.width} px wide, its text ${chipSize.text}`);
  let until = Date.now() + 5000;
  while (!(await hostIn()) && Date.now() < until) await sleep(100);
  expect(await hostIn(), 'the picker is in the page');
  step('(a) the Design Mode button turns the mode on, with the hint bar, Cancel and the stub named in the title, the chip ellipsed with the close button in the pane');

  // (b) The hover: the outline on the button and the pill's words, read
  // through a DOM walk that pierces the closed shadow root.
  const cta = await rectOf('cta');
  await guestMouse('mouseMoved', centre(cta));
  await sleep(200);
  const doc = await guest.send('DOM.getDocument', { depth: -1, pierce: true });
  const nodes = {};
  const walk = (n) => {
    const attrs = n.attributes ?? [];
    for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === 'data-emerald-design') nodes[attrs[i + 1]] = n;
    for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(c);
  };
  walk(doc.root);
  expect(nodes.outline && nodes.label, `the outline and the label in the shadow root (${Object.keys(nodes)})`);
  const quad = (await guest.send('DOM.getBoxModel', { nodeId: nodes.outline.nodeId })).model.border;
  const near = (a, b) => Math.abs(a - b) <= 1;
  expect(near(quad[0], cta.x) && near(quad[1], cta.y) && near(quad[4], cta.x + cta.width) && near(quad[5], cta.y + cta.height), `the outline on #cta (${quad}, ${JSON.stringify(cta)})`);
  const labelText = nodes.label.children?.find((c) => c.nodeType === 3)?.nodeValue;
  const wantLabel = `button role="button" "Start free trial" ${Math.round(cta.width)}x${Math.round(cta.height)}`;
  expect(labelText === wantLabel, `the pill reads ${JSON.stringify(wantLabel)} (${JSON.stringify(labelText)})`);
  step('(b) the hover outlines #cta within a pixel and the pill names it');

  // (c) S then C.
  await focusPage(); await s.guestKey('s','KeyS', 83);
  await s.waitFor(`document.querySelector('.corner-note')?.textContent === "Copied the element's screenshot"`, 'the screenshot note');
  let clip = await s.evalJs(`window.emerald.clipboard.read()`);
  expect(clip.text === null && clip.image === true, `the clipboard holds an image (${JSON.stringify(clip)})`);
  await focusPage(); await s.guestKey('c','KeyC', 67);
  await s.waitFor(`document.querySelector('.corner-note')?.textContent === 'Copied the element as markdown'`, 'the markdown note');
  clip = await s.evalJs(`window.emerald.clipboard.read()`);
  expect(typeof clip.text === 'string' && clip.text.startsWith('## Design Feedback: /') && clip.text.includes('Selector: `#cta`'), `the clipboard holds the block (${JSON.stringify(clip.text?.slice(0, 120))})`);
  expect((await pressed(inPane('.browser-design'))) === 'true' && (await hostIn()), 'the mode is still on');
  step('(c) S copies the crop and C the markdown, and the mode stays on');

  // (d) The click: one block pasted into the stub, the crop on disk, the
  // page seeing no click, and the mode ended.
  await guestClick(centre(cta));
  until = Date.now() + 5000;
  while (!stubText().includes('\x1b[201~') && Date.now() < until) await sleep(100);
  const first = stubText();
  expect(first.includes('\x1b[201~'), `the paste reached the stub (${JSON.stringify(first.slice(0, 80))})`);
  expect(first.startsWith('\x1b[200~## Design Feedback: /'), `the paste starts with the marker and the heading (${JSON.stringify(first.slice(0, 60))})`);
  for (const want of ['Selector: `#cta`', '- padding: 12px 20px', '```html', '<button id="cta"']) expect(first.includes(want), `the paste holds ${JSON.stringify(want)}`);
  expect(first.endsWith('**Feedback:** \x1b[201~'), `the paste ends with Feedback and the end marker, no Enter (${JSON.stringify(first.slice(-40))})`);
  const shotLine = first.split('\r').find((l) => l.startsWith('Screenshot: '));
  const shot = shotLine?.slice('Screenshot: '.length) ?? '';
  expect(shot.startsWith(path.join(home, 'design') + path.sep) && fs.existsSync(shot), `the crop is on disk under the home's design folder (${shot})`);
  const png = fs.readFileSync(shot);
  const dpr = await ev('devicePixelRatio');
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  expect(Math.abs(w - Math.round(cta.width * dpr)) <= 1 && Math.abs(h - Math.round(cta.height * dpr)) <= 1, `the crop is #cta's size at the device scale (${w}x${h}, rect ${cta.width}x${cta.height} at ${dpr})`);
  expect((await ev('window.pageClicks')) === 0, `the page saw no click (${await ev('window.pageClicks')})`);
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.getAttribute('aria-pressed') === 'false' && !document.querySelector(${q(inPane('.design-hint'))})`, 'the mode ended');
  expect(!(await hostIn()), 'the picker left the page');
  step('(d) a click pastes one block into the stub with its crop on disk, the page sees no click, and the mode ends');

  // (e) The chord from the window, Escape, the button and Cancel.
  // A press on the title row focuses the pane (its onMouseDown) and
  // takes the keyboard off the page.
  await s.evalJs(`(() => { const t = document.querySelector(${q(inPane('.pane-title .pane-name'))}); t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.activeElement?.blur(); })()`);
  await s.key('D', 'KeyD', 68, CTRL | SHIFT);
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.getAttribute('aria-pressed') === 'true'`, 'Ctrl+Shift+D turns the mode on');
  until = Date.now() + 5000;
  while (!(await hostIn()) && Date.now() < until) await sleep(100);
  await focusPage(); await s.guestKey('Escape','Escape', 27);
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.getAttribute('aria-pressed') === 'false' && !document.querySelector(${q(inPane('.design-hint'))})`, 'Escape ends the mode');
  expect(!(await hostIn()), 'the picker left the page after Escape');
  await click(inPane('.browser-design'));
  await s.waitFor(`!!document.querySelector(${q(inPane('.design-cancel'))})`, 'the mode on again by the button');
  await click(inPane('.design-cancel'));
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.getAttribute('aria-pressed') === 'false' && !document.querySelector(${q(inPane('.design-hint'))})`, 'Cancel ends the mode');
  until = Date.now() + 3000;
  while ((await hostIn()) && Date.now() < until) await sleep(100);
  expect(!(await hostIn()), 'the picker left the page after Cancel');
  step('(e) Ctrl+Shift+D on the window turns the mode on and Escape off; the button and Cancel do the same');

  // (f) The chord from the page, through the guest's key forwarding.
  await focusPage(); await s.guestKey('D','KeyD', 68, CTRL | SHIFT);
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.getAttribute('aria-pressed') === 'true'`, 'Ctrl+Shift+D from the page turns the mode on');
  await click(inPane('.design-cancel'));
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.getAttribute('aria-pressed') === 'false'`, 'Cancel ends it');
  // The picker leaves the page a moment after the button reads off (the
  // cancel goes to main and on into the page). Until it has, the wait for
  // a picker in (g) finds this one, and a click on it answers a grab that
  // has already ended, so no note ever comes.
  until = Date.now() + 3000;
  while ((await hostIn()) && Date.now() < until) await sleep(100);
  expect(!(await hostIn()), 'the picker left the page after Cancel');
  step('(f) Ctrl+Shift+D while the page has the keyboard turns the mode on');

  // (g) The tray: two picks with a comment each, a third deleted, sent as
  // one numbered block.
  // Fix 757: the page's size before the tray is read once the hint bar
  // has left and the page has taken its room back, so the drop below is
  // the tray's alone.
  await s.waitFor(`!document.querySelector(${q(inPane('.design-hint'))})`, 'the hint bar gone');
  const frameTall = () => s.evalJs(`(() => { const r = document.querySelector('.browser-frame[data-browser-pane="${webPaneId}"]')?.getBoundingClientRect(); return r ? r.height : null; })()`);
  until = Date.now() + 3000;
  while (Math.abs((await ev('innerHeight')) - ((await frameTall()) ?? 0)) > 1 && Date.now() < until) await sleep(100);
  console.log(`[757] before the tray: innerHeight ${await ev('innerHeight')}, frame ${await frameTall()} px`);
  const wideBefore = await ev('innerWidth');
  const tallBefore = await ev('innerHeight');
  // The page's innerWidth against its frame's width, read before the tray
  // opens and once it has (a log, not an expect; fix 698's probe).
  const frameWide = () => s.evalJs(`(() => { const r = document.querySelector('.browser-frame[data-browser-pane="${webPaneId}"]')?.getBoundingClientRect(); return r ? r.width : null; })()`);
  const paneWideOf = () => s.evalJs(`document.querySelector(${q(inPane('.browser-view'))}).getBoundingClientRect().width`);
  const boxOf = (sel) => s.evalJs(`(() => { const r = document.querySelector(${q(inPane(sel))}).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; })()`);
  const paneWide = await paneWideOf();
  console.log(`[698] the browser pane is ${paneWide} px wide`);
  console.log(`[698] before the tray: innerWidth ${wideBefore}, frame ${await frameWide()} px`);
  await click(inPane('.browser-design'));
  await s.waitFor(`!!document.querySelector(${q(inPane('.design-notes'))})`, 'the Notes button in the hint bar');
  await click(inPane('.design-notes'));
  await s.waitFor(`!!document.querySelector(${q(inPane('.design-tray'))})`, 'the tray open');
  // The tray narrows the page; a click sent before the page has taken
  // its new width went to the page under the picker on one run in three
  // (fix 675's send-back), so the picks wait for the page's new size. A
  // tray docked under the page (fix 698, a pane under 600 px) changes the
  // height instead: tallBefore is read once the hint bar has left and the
  // page has its room back (fix 757), so the drop is the empty tray's 46 px
  // floor and its 1 px border; 44 leaves 2 px for rounding.
  until = Date.now() + 5000;
  if (paneWide < 600) {
    while ((await ev('innerHeight')) > tallBefore - 44 && Date.now() < until) await sleep(100);
    console.log(`[698] with the tray open: innerWidth ${await ev('innerWidth')}, innerHeight ${tallBefore} then ${await ev('innerHeight')}, frame ${await frameWide()} px`);
    expect((await ev('innerHeight')) <= tallBefore - 44, `the page shortens over the docked tray (${tallBefore} then ${await ev('innerHeight')})`);
    expect(Math.abs((await ev('innerWidth')) - wideBefore) <= 4, `the page keeps its width over the docked tray (${wideBefore} then ${await ev('innerWidth')})`);
    const tray = await boxOf('.design-tray');
    const body = await boxOf('.browser-body');
    expect(tray.top >= body.bottom - 1, `the tray is under the page (tray top ${tray.top}, page bottom ${body.bottom})`);
    expect(tray.bottom - tray.top <= 60, `the empty docked tray takes its own height (${tray.bottom - tray.top} px)`);
    expect(!(await s.evalJs(`!!document.querySelector(${q(inPane('.design-send'))})`)) && (await text(inPane('.design-tray-empty'))) === 'Click an element on the page to add a note', 'the empty tray shows the line and no button');
    step(`(g0) the tray docks under the page in a ${paneWide} px pane, the page keeping its width`);
  } else {
    while ((await ev('innerWidth')) > wideBefore - 200 && Date.now() < until) await sleep(100);
    console.log(`[698] with the tray open: innerWidth ${await ev('innerWidth')}, frame ${await frameWide()} px`);
    expect((await ev('innerWidth')) <= wideBefore - 200, `the page narrows beside the tray (${wideBefore} then ${await ev('innerWidth')})`);
  }
  until = Date.now() + 5000;
  while (!(await hostIn()) && Date.now() < until) await sleep(100);
  const noteCount = () => s.evalJs(`document.querySelectorAll(${q(inPane('.design-note'))}).length`);
  const addPick = async (id, comment, n) => {
    await guestClick(centre(await rectOf(id)));
    try {
      await s.waitFor(`document.querySelectorAll(${q(inPane('.design-note'))}).length === ${n}`, `note ${n} in the tray`);
    } catch (err) {
      const mainLog = fs.readFileSync(path.join(home, 'logs', 'main.log'), 'utf8').split('\n').filter((l) => l.includes('design:'));
      console.error(`[verify] note: picker in the page ${await hostIn()} (${await ev(`document.querySelectorAll('[data-emerald-design-host]').length`)} hosts, shown ${await ev(`[...document.querySelectorAll('[data-emerald-design-host]')].map((h) => h.style.display || 'block').join()`)}), mode ${await pressed(inPane('.browser-design'))}, notes ${await noteCount()}, page clicks ${await ev('window.pageClicks')}; main.log: ${JSON.stringify(mainLog)}`);
      throw err;
    }
    await s.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Comment on note ${n}'`, `note ${n}'s comment box focused`);
    if (comment !== null) await s.type(comment);
    // The grab starts again at once for the next pick.
    until = Date.now() + 5000;
    while (!(await hostIn()) && Date.now() < until) await sleep(100);
  };
  await addPick('cta', 'make it green', 1);
  // (g1) The hint names the comment box while it holds the keys; a focus
  // on the webview stands in for a click into the page (a real click there
  // would answer the grab with a pick).
  const PAGE_HINT = 'Hover and press C to copy, S for screenshot, or click to select';
  const TRAY_HINT = 'Note · Esc back to the page';
  const hint = () => text(inPane('.design-hint .design-hint-text'));
  const activeLabel = () => s.evalJs(`document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? null`);
  expect((await activeLabel()) === 'Comment on note 1' && (await hint()) === TRAY_HINT, `the tray's hint while note 1's box is focused (${await activeLabel()}: ${await hint()})`);
  expect((await s.evalJs(`(() => { const t = document.querySelector(${q(inPane('.design-hint .design-hint-text'))}); return t.scrollWidth <= t.clientWidth && t.title.endsWith('Ctrl+Shift+D ends the mode'); })()`)) === true, 'the tray hint fits the narrow pane whole and its title names Ctrl+Shift+D');
  await s.evalJs(`document.querySelector(${q(webview)}).focus()`);
  await s.waitFor(`document.activeElement?.tagName === 'WEBVIEW'`, 'the page focused');
  await s.waitFor(`document.querySelector(${q(inPane('.design-hint .design-hint-text'))})?.textContent === ${q(PAGE_HINT)}`, 'the page hint again once the page has the keys');
  await addPick('intro', 'say what it costs', 2);
  expect((await hint()) === TRAY_HINT, `the tray's hint while note 2's box is focused (${await hint()})`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`document.activeElement?.tagName === 'WEBVIEW'`, 'Escape in the box hands the keys to the page');
  await s.waitFor(`document.querySelector(${q(inPane('.design-hint .design-hint-text'))})?.textContent === ${q(PAGE_HINT)}`, 'the page hint after Escape');
  expect((await pressed(inPane('.browser-design'))) === 'true', 'Escape in the box leaves the mode on');
  const note2 = await s.evalJs(`document.querySelector(${q(inPane('textarea[aria-label="Comment on note 2"]'))})?.value ?? null`);
  expect(note2 === 'say what it costs', `Escape leaves note 2's comment as it was (${JSON.stringify(note2)})`);
  await s.evalJs(`document.querySelector(${q(inPane('textarea[aria-label="Comment on note 1"]'))}).focus()`);
  await s.waitFor(`document.querySelector(${q(inPane('.design-hint .design-hint-text'))})?.textContent === ${q(TRAY_HINT)}`, "the tray's hint with note 1's box focused again");
  await s.key('Enter', 'Enter', 13, CTRL);
  await s.waitFor(`document.activeElement?.tagName === 'WEBVIEW'`, 'Ctrl+Enter in the box hands the keys to the page');
  await s.waitFor(`document.querySelector(${q(inPane('.design-hint .design-hint-text'))})?.textContent === ${q(PAGE_HINT)}`, 'the page hint after Ctrl+Enter');
  step('(g1) the hint names the comment box while it holds the keys, and Escape or Ctrl+Enter there hands them back to the page');
  expect((await text(inPane('.design-notes'))) === 'Notes (2)', `Notes (2) (${await text(inPane('.design-notes'))})`);
  expect((await text(inPane('.design-send'))) === 'Send 2 notes', `Send 2 notes (${await text(inPane('.design-send'))})`);
  const look = await s.evalJs(`(() => { const b = getComputedStyle(document.querySelector(${q(inPane('.design-send'))})); return { color: b.color, fg: getComputedStyle(document.getElementById('root')).color, border: b.borderTopWidth + ' ' + b.borderTopStyle, opacity: b.opacity }; })()`);
  expect(look.color === look.fg && look.border === '1px solid' && look.opacity === '1', `the button is drawn as one (${JSON.stringify(look)})`);
  const sendHeight = await s.evalJs(`document.querySelector(${q(inPane('.design-send'))}).getBoundingClientRect().height`);
  console.log(`[730] .design-send is ${sendHeight} px tall`);
  await addPick('cta', null, 3);
  if (paneWide < 600) {
    const trayTall = (await boxOf('.design-tray')).bottom - (await boxOf('.design-tray')).top;
    const mainTall = (await boxOf('.browser-main')).bottom - (await boxOf('.browser-main')).top;
    console.log(`[730] three notes: tray ${trayTall} px of ${mainTall}`);
    expect(trayTall <= mainTall * 0.4 + 1, `the docked tray stays within 40 percent (${trayTall} of ${mainTall})`);
  }
  await click(inPane('[aria-label="Delete note 3"]'));
  await s.waitFor(`document.querySelectorAll(${q(inPane('.design-note'))}).length === 2`, 'the third note deleted');
  const before = stubText().length;
  await click(inPane('.design-send'));
  until = Date.now() + 5000;
  while (!stubText().slice(before).includes('\x1b[201~') && Date.now() < until) await sleep(100);
  const second = stubText().slice(before);
  for (const want of ['\x1b[200~## Design Feedback: /', '### 1. button #cta', '**Feedback:** make it green', '### 2. p #intro', '**Feedback:** say what it costs']) expect(second.includes(want), `the tray's block holds ${JSON.stringify(want)}`);
  expect(second.endsWith('\x1b[201~'), `the tray's block ends with the end marker (${JSON.stringify(second.slice(-30))})`);
  await s.waitFor(`document.querySelectorAll(${q(inPane('.design-note'))}).length === 0`, 'the sent notes leave the tray');
  expect((await text(inPane('.design-notes'))) === 'Notes (0)', `Notes (0) (${await text(inPane('.design-notes'))})`);
  expect(!(await s.evalJs(`!!document.querySelector(${q(inPane('.design-send'))})`)) && (await text(inPane('.design-tray-empty'))) === 'Click an element on the page to add a note', 'no button and the empty line once the notes are sent');
  expect((await noteCount()) === 0, 'no note left');
  await click(inPane('.design-cancel'));
  step("(g) the tray gathers two picks with a comment each and sends them as one numbered block; the empty tray's line, the hint whole in a narrow pane, the button drawn");

  // (h) With no Claude session in the tab the tray's button copies (fix
  // 697). The stub's pane leaves the tab by layout.set; its session lives
  // on without a pane, so its output file still records anything pasted.
  const tabsNow = await getTabs(s);
  const findLeaf = (node, id) => (node.id === id ? node : node.kind === 'pane' ? null : (findLeaf(node.first, id) ?? findLeaf(node.second, id)));
  const webTab = tabsNow.tabs.find((t) => findLeaf(t.root, webPaneId) !== null);
  const webLeaf = findLeaf(webTab.root, webPaneId);
  await s.evalJs(`window.emerald.request('layout.set', ${JSON.stringify({ layout: { ...tabsNow, tabs: tabsNow.tabs.map((t) => (t === webTab ? { ...t, root: webLeaf, focusedPaneId: webLeaf.id } : t)) } })})`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'the browser pane alone in the tab');
  // Fix 698's wide case: the tray closed from the toolbar (the mode is
  // off), then opened beside the page in a pane of 600 px or more. The
  // page takes the pane's width before any read: the frame sits over the
  // slot inset by the 3 px ring, so its width is the slot's less 6.
  await click(inPane('.browser-toolbar .design-notes'));
  await s.waitFor(`!document.querySelector(${q(inPane('.design-tray'))})`, 'the tray closed');
  const bodyWide = () => s.evalJs(`document.querySelector(${q(inPane('.browser-body'))}).getBoundingClientRect().width`);
  until = Date.now() + 5000;
  while (Math.abs((await ev('innerWidth')) - ((await bodyWide()) - 6)) > 3 && Date.now() < until) await sleep(100);
  expect(Math.abs((await ev('innerWidth')) - ((await bodyWide()) - 6)) <= 3, `the page takes the wider pane (${await ev('innerWidth')} in a ${await bodyWide()} px slot)`);
  const paneWide2 = await paneWideOf();
  const wideBefore2 = await ev('innerWidth');
  console.log(`[698] the browser pane alone is ${paneWide2} px wide`);
  expect(paneWide2 >= 600, `the browser pane alone is 600 px or wider (${paneWide2})`);
  await click(inPane('.browser-design'));
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.getAttribute('aria-pressed') === 'true'`, 'the mode on with no Claude session in the tab');
  await s.waitFor(`!!document.querySelector(${q(inPane('.design-hint .design-notes'))})`, 'the Notes button in the hint bar');
  await click(inPane('.design-hint .design-notes'));
  await s.waitFor(`!!document.querySelector(${q(inPane('.design-tray'))})`, 'the tray open again');
  until = Date.now() + 5000;
  while ((await ev('innerWidth')) > wideBefore2 - 200 && Date.now() < until) await sleep(100);
  expect((await ev('innerWidth')) <= wideBefore2 - 200, `the page narrows beside the tray in the wide pane (${wideBefore2} then ${await ev('innerWidth')})`);
  const trayWide = await boxOf('.design-tray');
  const bodyWideBox = await boxOf('.browser-body');
  expect(trayWide.left >= bodyWideBox.right - 1 && Math.abs(trayWide.top - bodyWideBox.top) <= 1, `the tray is beside the page (tray ${JSON.stringify(trayWide)}, page ${JSON.stringify(bodyWideBox)})`);
  until = Date.now() + 5000;
  while (!(await hostIn()) && Date.now() < until) await sleep(100);
  await addPick('cta', 'make it green', 1);
  await addPick('intro', null, 2);
  const sendButton = () => s.evalJs(`(() => { const b = document.querySelector(${q(inPane('.design-send'))}); return { text: b.textContent, disabled: b.disabled, title: b.title }; })()`);
  const copyButton = await sendButton();
  expect(copyButton.text === 'Copy 2 notes' && copyButton.disabled === false && copyButton.title === 'No Claude session in this tab; copies the notes', `the button copies with no session (${JSON.stringify(copyButton)})`);
  const stubBefore = stubText().length;
  await click(inPane('.design-send'));
  await s.waitFor(`document.querySelector('.corner-note')?.textContent === 'No Claude session to send to in this tab; copied the notes instead'`, 'the copied note');
  clip = await s.evalJs(`window.emerald.clipboard.read()`);
  for (const want of ['### 1. button #cta', '**Feedback:** make it green', '### 2. p #intro']) expect(typeof clip.text === 'string' && clip.text.includes(want), `the copied block holds ${JSON.stringify(want)} (${JSON.stringify(clip.text?.slice(0, 120))})`);
  expect(clip.text.startsWith('## Design Feedback: /'), `the copied block starts with the heading (${JSON.stringify(clip.text.slice(0, 40))})`);
  expect((await noteCount()) === 2 && (await text(inPane('.design-notes'))) === 'Notes (2)', `the notes stay after the copy (${await noteCount()}, ${await text(inPane('.design-notes'))})`);
  await sleep(300);
  expect(stubText().length === stubBefore, `nothing reached the stub (${stubBefore} then ${stubText().length})`);
  await click(inPane('.design-cancel'));
  step('(h) with no Claude session in the tab the tray copies its notes as one numbered block and keeps them');

  // (i) The launch's prune (fix 696): the PNGs seeded 15 days back are gone
  // from design and screenshots; the new one, downloads and (d)'s crop stay.
  until = Date.now() + 5000;
  while ((fs.existsSync(seedOld[0]) || fs.existsSync(seedOld[1])) && Date.now() < until) await sleep(100);
  expect(!fs.existsSync(seedOld[0]) && !fs.existsSync(seedOld[1]), `the old PNGs in design and screenshots are gone (${seedOld.slice(0, 2).map((f) => fs.existsSync(f))})`);
  expect(fs.existsSync(seedNew), 'the new PNG in design stays');
  expect(fs.existsSync(seedOld[2]), 'the old PNG in downloads stays');
  expect(fs.existsSync(shot), `(d)'s crop stays (${shot})`);
  // A read, not an expect: logs/ is not cleared between runs on this home.
  for (const l of fs.readFileSync(path.join(home, 'logs', 'main.log'), 'utf8').split('\n').filter((x) => x.includes('shots:'))) console.log(`[696] ${l.trim()}`);
  step('(i) the launch removed the PNGs older than 14 days from design and screenshots and kept the new one and downloads');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('design-fail.png').catch(() => {});
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
