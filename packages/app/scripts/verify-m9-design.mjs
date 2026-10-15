// M9 fixes 674 and 675 acceptance: Design Mode. A browser pane beside a
// stub Claude session (a shell a hook has reached counts as Claude, and a
// node raw-stdin stub in it records what is pasted); the toolbar toggle,
// the hint bar and the target in the title; the hover's outline and pill
// inside the page's closed shadow root; S and C to the clipboard; a click
// that pastes one markdown block into the stub with its crop on disk and
// the page seeing no click; the chord from the window and from the page,
// Escape and Cancel; and the tray, two picks with a comment each sent as
// one numbered block. Uses a private home and pipe unless the environment
// names them.
// Run: npm run verify:design -w @emerald/app
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'design-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-design';
const { CTRL, SHIFT, connect, expect, freshPort, getLayout, killTree, launch, leaves, sleep, startFromEmpty, step, stopDaemon } = await import('./cdp.mjs');

let app = null;
let server = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 120 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  server?.close();
  setTimeout(() => process.exit(3), 500);
}, 120000);

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
  // A key while the page has the keyboard. A CDP keyDown on the guest's
  // own target reaches the page but never the guest's before-input-event,
  // where the grab's keys are caught (read on the base commit at fix
  // 674); a rawKeyDown and keyUp sent to the window with the webview
  // focused go through it, as a person's key does.
  const guestKey = async (key, code, keyCode, modifiers = 0) => {
    await s.evalJs(`document.querySelector(${q(webview)}).focus()`);
    const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
    await s.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  await s.waitFor(`document.querySelector(${q(inPane('.pane-name'))})?.textContent === 'Emerald design fixture'`, 'the title row names the page');
  const stubName = await s.evalJs(`document.querySelector(${q(`[data-pane-id=${JSON.stringify(stubPane.id)}] .pane-name`)})?.textContent ?? ''`);

  // (a) The button, the hint bar and the target.
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.disabled === false`, 'the Design Mode button enabled');
  await click(inPane('.browser-design'));
  await s.waitFor(`document.querySelector(${q(inPane('.browser-design'))})?.getAttribute('aria-pressed') === 'true'`, 'Design Mode on');
  expect((await text(inPane('.design-hint .design-hint-text'))) === 'Hover and press C to copy, S for screenshot, or click to select', `the hint (${await text(inPane('.design-hint .design-hint-text'))})`);
  expect((await text(inPane('.design-cancel'))) === 'Cancel', 'the hint bar has Cancel');
  expect((await text(inPane('.design-target'))) === `Design Mode → ${stubName}`, `the title names the stub (${await text(inPane('.design-target'))}, the stub ${stubName})`);
  let until = Date.now() + 5000;
  while (!(await hostIn()) && Date.now() < until) await sleep(100);
  expect(await hostIn(), 'the picker is in the page');
  step('(a) the Design Mode button turns the mode on, with the hint bar, Cancel and the stub named in the title');

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
  await guestKey('s', 'KeyS', 83);
  await s.waitFor(`document.querySelector('.corner-note')?.textContent === "Copied the element's screenshot"`, 'the screenshot note');
  let clip = await s.evalJs(`window.emerald.clipboard.read()`);
  expect(clip.text === null && clip.image === true, `the clipboard holds an image (${JSON.stringify(clip)})`);
  await guestKey('c', 'KeyC', 67);
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
  await guestKey('Escape', 'Escape', 27);
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
  await guestKey('D', 'KeyD', 68, CTRL | SHIFT);
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
  const wideBefore = await ev('innerWidth');
  await click(inPane('.browser-design'));
  await s.waitFor(`!!document.querySelector(${q(inPane('.design-notes'))})`, 'the Notes button in the hint bar');
  await click(inPane('.design-notes'));
  await s.waitFor(`!!document.querySelector(${q(inPane('.design-tray'))})`, 'the tray open');
  // The tray narrows the page; a click sent before the page has taken
  // its new width went to the page under the picker on one run in three
  // (fix 675's send-back), so the picks wait for the narrower page.
  until = Date.now() + 5000;
  while ((await ev('innerWidth')) > wideBefore - 200 && Date.now() < until) await sleep(100);
  expect((await ev('innerWidth')) <= wideBefore - 200, `the page narrows beside the tray (${wideBefore} then ${await ev('innerWidth')})`);
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
  await addPick('intro', 'say what it costs', 2);
  expect((await text(inPane('.design-notes'))) === 'Notes (2)', `Notes (2) (${await text(inPane('.design-notes'))})`);
  expect((await text(inPane('.design-send'))) === 'Send 2 notes', `Send 2 notes (${await text(inPane('.design-send'))})`);
  await addPick('cta', null, 3);
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
  expect((await s.evalJs(`document.querySelector(${q(inPane('.design-send'))}).disabled`)) === true, 'Send disabled with no notes');
  expect((await noteCount()) === 0, 'no note left');
  await click(inPane('.design-cancel'));
  step('(g) the tray gathers two picks with a comment each and sends them as one numbered block');

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
