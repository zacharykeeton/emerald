// M9 fixes 672 and 673 acceptance: emmer browser drives the page in a
// browser pane while the person watches. A fixture server on 127.0.0.1
// serves the pages; a shell holds the window's focus, emmer browser open
// puts a browser pane beside it with the focus left where it was, and
// the verbs run on the page with that focus never moved: a snapshot's
// refs, a click, a fill, Escape, eval, a screenshot, wait and navigate,
// with the pane's driven mark while they run. Then a target=_blank link
// and a console error read in events with no window opened, a download
// saved to the home's downloads folder with no dialog, upload on a file
// input, a --profile b pane that does not see the default pane's cookie,
// and the person's click and key pausing the driver until emmer browser
// resume and the Resume button. Uses a private home and pipe unless the
// environment names them.
// Run: npm run verify:browser-drive -w @emerald/app
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'browser-drive-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-browser-drive';
const { CTRL, SHIFT, connect, expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, startFromEmpty, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
let server = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 240 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  server?.close();
  setTimeout(() => process.exit(3), 500);
}, 240000);

// The fixture, routed on the path alone so a query reaches the same page.
server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://127.0.0.1');
  const page = (title, body) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`);
  };
  if (pathname === '/') {
    page(
      'Drive fixture',
      [
        '<h1>Drive</h1>',
        `<button id="go" onclick="this.textContent='Clicked'">Go</button>`,
        `<input id="name" aria-label="Name" onkeydown="if (event.key === 'Escape') { this.value = ''; document.getElementById('log').textContent = 'escaped'; }">`,
        '<p id="log"></p>',
        '<a id="blank" href="/blank-target" target="_blank">New tab</a>',
        '<a id="export" href="/export.json" download>Export</a>',
        `<button id="err" onclick="console.error('fixture error one')">Error</button>`,
        '<input id="up" type="file" aria-label="Import">',
        '<style>#hov:hover { background: rgb(0, 128, 0); }</style>',
        `<button id="hov" onmouseover="document.getElementById('hovlog').textContent = 'over'" onmouseenter="this.dataset.entered = 'yes'">Hover me</button>`,
        '<p id="hovlog"></p>',
        '<textarea id="notes" aria-label="Notes" rows="3"></textarea>',
        `<button id="gate" onpointerenter="this.dataset.entered = 'yes'" onclick="document.getElementById('gatelog').textContent = this.dataset.entered === 'yes' && this.matches(':hover') ? 'entered first' : 'entered ' + (this.dataset.entered === 'yes') + ', hover ' + this.matches(':hover')">Gate</button>`,
        '<p id="gatelog"></p>',
        `<div id="menuwrap" onpointerleave="document.getElementById('item').style.visibility = 'hidden'"><button id="menu" onpointerenter="document.getElementById('item').style.visibility = 'visible'">Menu</button> <button id="item" style="visibility: hidden" onclick="document.getElementById('menulog').textContent = 'item clicked'">Item</button></div>`,
        '<p id="menulog"></p>',
        '<button id="bmenu" onclick="document.getElementById(\'bitems\').hidden = false">Blur menu</button><div id="bitems" hidden><button id="bitem">Blur item</button></div>',
        `<script>window.__focusLog = []; const note = (kind) => window.__focusLog.push({ kind, at: Date.now(), has: document.hasFocus() }); addEventListener('blur', () => { note('blur'); document.getElementById('bitems').hidden = true; }); addEventListener('focus', () => note('focus')); document.addEventListener('focusin', (e) => note('focusin ' + (e.target.id || e.target.tagName))); document.addEventListener('focusout', (e) => note('focusout ' + (e.target.id || e.target.tagName)));</script>`,
        `<select id="car" aria-label="Car" onchange="this.dataset.changes = String(Number(this.dataset.changes || 0) + 1)"><option value="v">Volvo</option><option value="s">Saab</option></select>`,
        '<select id="cars" aria-label="Cars" multiple><option>Volvo</option><option>Saab</option></select>',
        '<input id="ok" type="checkbox" aria-label="Agree">',
        '<input id="picky" aria-label="Picky">',
        `<script>{ const el = document.getElementById('picky'); Object.setPrototypeOf(el, Object.create(HTMLInputElement.prototype, { value: { get() { return ''; }, set() { throw new Error('picky refuses'); }, configurable: true } })); }</script>`,
        '<div id="rich" contenteditable="true" role="textbox" aria-label="Rich"></div>',
        '<a id="two" href="/two">Two</a>',
      ].join('\n'),
    );
  } else if (pathname === '/two') page('Drive fixture two', '<p>two</p>');
  else if (pathname === '/export.json') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="drive-export.json"' });
    res.end('{"ok":true}');
  } else if (pathname === '/drag') {
    // M9 fixes 874 and 875: a list reordered in dnd-kit's activation shape
    // (a press, a move past 5 px, a release; the row lands before the first
    // other row whose middle is below the pointer), a button outside a
    // dialog and three inside it.
    page(
      'Drive fixture drag',
      [
        '<h1>Drag</h1>',
        '<style>#steps { list-style: none; margin: 0; padding: 0; width: 240px } #steps li { box-sizing: border-box; height: 40px; border: 1px solid #888; user-select: none; touch-action: none }</style>',
        '<ul id="steps" aria-label="Steps"><li role="button" tabindex="0">Step A</li><li role="button" tabindex="0">Step B</li><li role="button" tabindex="0">Step C</li></ul>',
        '<p id="draglog"></p>',
        '<button id="draft">Save draft</button>',
        `<div role="dialog" aria-label="Edit step"><input aria-label="Step name"> <button id="save" onclick="document.getElementById('dlglog').textContent = 'saved'">Save</button> <button>Cancel</button></div>`,
        '<p id="dlglog"></p>',
        `<script>
let drag = null;
const steps = document.getElementById('steps');
steps.addEventListener('pointerdown', (e) => { const row = e.target.closest('li'); if (row !== null) drag = { row, x: e.clientX, y: e.clientY, moves: 0, active: false, first: 0, last: 0 }; });
document.addEventListener('pointermove', (e) => { if (drag === null || (e.buttons & 1) === 0) return; drag.moves += 1; if (drag.moves === 1) drag.first = e.timeStamp; drag.last = e.timeStamp; if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.active = true; });
document.addEventListener('pointerup', (e) => { if (drag === null) return; const d = drag; drag = null; const log = document.getElementById('draglog'); if (!d.active) { log.textContent = 'not activated after ' + d.moves + ' moves'; return; } const before = [...steps.children].filter((r) => r !== d.row).find((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; }); steps.insertBefore(d.row, before ?? null); log.textContent = 'dropped ' + d.row.textContent + ' after ' + d.moves + ' moves over ' + Math.round(d.last - d.first) + ' ms'; });
</script>`,
      ].join('\n'),
    );
  } else if (pathname === '/canvas') {
    // M9 fix 915: a canvas at the page's top left that keeps where a press and a release landed and how many held moves came between, for a drag from a point.
    page(
      'Drive fixture canvas',
      [
        '<style>body { margin: 0 } #pad { display: block; width: 300px; height: 200px; touch-action: none }</style>',
        '<canvas id="pad" width="300" height="200"></canvas>',
        `<script>window.__pad = { down: null, moves: 0, up: null }; const pad = document.getElementById('pad'); pad.addEventListener('pointerdown', (e) => { window.__pad.down = [e.clientX, e.clientY]; }); pad.addEventListener('pointermove', (e) => { if ((e.buttons & 1) !== 0) window.__pad.moves += 1; }); pad.addEventListener('pointerup', (e) => { window.__pad.up = [e.clientX, e.clientY]; });</script>`,
      ].join('\n'),
    );
  } else page('Drive fixture other', '<p>other</p>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const homeDir = process.env['EMERALD_HOME'];
const mainLog = path.join(homeDir, 'logs', 'main.log');
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

// freshState leaves these, and a second run would save drive-export (2).json.
for (const dir of ['downloads', 'screenshots']) fs.rmSync(path.join(homeDir, dir), { recursive: true, force: true });

// The CLI against this window's pipe, async so the fixture server in this
// process answers the page meanwhile, as the shell's own session.
const cliMain = path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js');
let ownId = '';
const cli = (...args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [cliMain, 'browser', ...args], { env: { ...process.env, EMERALD_SESSION_ID: ownId }, windowsHide: true });
    // No input: a --stdin read through cli() meets the end at once rather than hanging to the watchdog.
    child.stdin.end();
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out: out.replace(/\r?\n$/, ''), err: err.replace(/\r?\n$/, '') }));
  });
// The same with text piped to its stdin (M9 fix 854's --stdin).
const cliIn = (input, ...args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [cliMain, 'browser', ...args], { env: { ...process.env, EMERALD_SESSION_ID: ownId }, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out: out.replace(/\r?\n$/, ''), err: err.replace(/\r?\n$/, '') }));
    child.stdin.end(input);
  });
const said = (r) => `${r.code}: ${JSON.stringify(r.out)} ${JSON.stringify(r.err)}`;

const s = await launch(freshPort(), { freshState: true, env: { EMERALD_BROWSER_HOLD_MS: '4000' } });
app = s;
const guests = [];
try {
  const targets = async () => (await (await fetch(`http://127.0.0.1:${s.port}/json`)).json());
  const guestTargets = async () => (await targets()).filter((t) => t.type === 'webview' || (t.type !== 'page' && typeof t.url === 'string' && t.url.startsWith(origin)));
  const pageTargets = async () => (await targets()).filter((t) => t.type === 'page');
  const browserPanes = async () => leaves(await getLayout(s)).filter((p) => p.view?.kind === 'browser');
  // The title row's driven mark of a pane, and the page element's box.
  const markOf = (paneId) => `[data-pane-id=${JSON.stringify(paneId)}] .browser-driven`;
  // The page lives in the window's browser layer (fix 669), in a frame
  // keyed by its pane, never inside the pane.
  const pageRect = (paneId) => s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(`.browser-frame[data-browser-pane=${JSON.stringify(paneId)}] .browser-page`)}); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  // Whether the shell's textarea still holds the window's focus; a miss
  // says what holds it instead.
  const activeIsShell = async () => {
    const ok = await s.evalJs(`document.activeElement === window.__driveShellInput`);
    if (!ok) console.log(`[verify] note: the focus is on ${await s.evalJs(`(() => { const a = document.activeElement; return a === null ? 'nothing' : a.tagName + '.' + a.className; })()`)}`);
    return ok;
  };
  const guestFor = async (urlStart) => {
    const deadline = Date.now() + 15000;
    for (;;) {
      const found = (await guestTargets()).filter((t) => t.url.startsWith(urlStart) && !guests.some((g) => g.id === t.id));
      if (found.length > 0) {
        const g = { id: found[0].id, cdp: await connect(found[0].webSocketDebuggerUrl) };
        guests.push(g);
        return g;
      }
      if (Date.now() > deadline) throw new Error(`no guest target at ${urlStart}`);
      await sleep(200);
    }
  };
  const inGuest = async (g, expression) => (await g.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;

  // (a) A shell with the window's focus, and emmer browser open beside it.
  await startFromEmpty(s, '', { kind: 'shell' });
  const shellPane = leaves(await getLayout(s)).find((p) => p.sessionId !== null);
  ownId = shellPane.sessionId;
  const ownName = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === ownId).name;
  const shellBox = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(shellPane.id)}] .term-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(shellBox.x, shellBox.y);
  await s.waitFor(`document.activeElement?.classList.contains('xterm-helper-textarea') && !!document.activeElement.closest('[data-pane-id=${JSON.stringify(shellPane.id)}]')`, 'the shell holds the keyboard');
  await s.evalJs(`window.__driveShellInput = document.activeElement`);
  let r = await cli('open', origin + '/');
  expect(r.code === 0 && new RegExp(`^opened ${origin}/ in pane [0-9a-f-]{8} on tab .+$`).test(r.out), `emmer browser open (${said(r)})`);
  await s.waitFor(`document.querySelectorAll('[data-pane-id] [data-view="browser"], .pane[data-view="browser"]').length >= 1`, 'a browser pane on screen');
  const [driven] = await browserPanes();
  expect(r.out.includes(`in pane ${driven.id.slice(0, 8)} `), `the line names the new pane (${r.out})`);
  const layoutA = (await zreq(s, 'layout.get', {})).layout;
  const tabA = layoutA.tabs.find((t) => t.id === layoutA.currentTabId);
  expect(tabA.focusedPaneId === shellPane.id, `the tab's focus is still the shell's pane (${tabA.focusedPaneId})`);
  expect(await activeIsShell(), 'the window keeps the shell textarea focused');
  expect(r.out.endsWith(` on tab ${tabA.name}`), `the line names the tab ${tabA.name} (${r.out})`);
  step('M9 fix 672: emmer browser open puts the page beside the shell and leaves the focus where it was');

  // (b) A snapshot with refs, and the driven mark.
  const g1 = await guestFor(origin + '/');
  await g1.cdp.send('Runtime.enable');
  const deadline = Date.now() + 10000;
  // A guest caught before its page's context exists answers "Cannot find
  // default execution context" (a run of fixes 854 to 858 died on it here);
  // that is a not-yet, read again.
  while ((await inGuest(g1, `document.readyState`).catch(() => '')) !== 'complete' && Date.now() < deadline) await sleep(100);
  r = await cli('snapshot');
  expect(r.code === 0, `snapshot exits 0 (${said(r)})`);
  const lines = r.out.split(/\r?\n/);
  expect(lines[0] === `page "Drive fixture" ${origin}/`, `the first line names the page (${lines[0]})`);
  expect(lines.includes('heading "Drive" level=1'), `the heading row (${r.out})`);
  const refOf = (re) => {
    const line = lines.find((l) => re.test(l));
    expect(line !== undefined, `a row matching ${re} (${r.out})`);
    return line.split(' ')[0];
  };
  let go = refOf(/^@e\d+ button "Go"$/);
  let nameRef = refOf(/^@e\d+ textbox "Name"$/);
  refOf(/^@e\d+ link "New tab"$/);
  await s.waitFor(`document.querySelector(${JSON.stringify(markOf(driven.id))})?.textContent === ${JSON.stringify(`${ownName} is driving`)}`, 'the driven mark', 1500);
  await sleep(7000);
  expect(await s.evalJs(`document.querySelector(${JSON.stringify(markOf(driven.id))}) === null`), 'the mark is gone 7 s after the command');
  step('M9 fix 672: a snapshot gives refs for the controls, and the pane says who is driving while it runs');

  // (c) A click.
  r = await cli('click', go);
  expect(r.code === 0 && r.out === `clicked ${go} button "Go"`, `click (${said(r)})`);
  expect((await inGuest(g1, `document.getElementById('go').textContent`)) === 'Clicked', 'the button reads Clicked');
  expect(await activeIsShell(), 'the window keeps the shell textarea focused after the click');
  step('M9 fix 672: a click lands on the page with the window focus left on the shell');

  // (d) A fill and Escape.
  r = await cli('fill', nameRef, 'hello');
  expect(r.code === 0 && (r.out === `filled ${nameRef} textbox "Name" with 5 characters` || r.out === `filled ${nameRef} textbox "Name" with 5 characters (set directly)`), `fill (${said(r)})`);
  console.log(`[verify] note: fill answered ${JSON.stringify(r.out)}; the page's focus is on ${await inGuest(g1, `(document.activeElement?.id || document.activeElement?.tagName) + ', hasFocus ' + document.hasFocus()`)}`);
  expect((await inGuest(g1, `document.getElementById('name').value`)) === 'hello', 'the field holds hello');
  r = await cli('key', 'Escape');
  expect(r.code === 0 && r.out === 'pressed Escape', `key Escape (${said(r)})`);
  expect((await inGuest(g1, `document.getElementById('name').value`)) === '', 'Escape emptied the field');
  expect((await inGuest(g1, `document.getElementById('log').textContent`)) === 'escaped', 'the page saw the Escape');
  expect(await activeIsShell(), 'the window keeps the shell textarea focused after the fill and the key');
  step('M9 fix 672: a fill and a key reach the field with the window focus never moved');

  // (d2) M9 fix 854: fill and eval read their text verbatim from --file
  // and --stdin, a newline, a double quote and a % included.
  const notesRef = refOf(/^@e\d+ textbox "Notes"$/);
  const notesFile = path.join(os.tmpdir(), 'notes-854.txt');
  fs.writeFileSync(notesFile, 'line one\nline "two" at 100%PATH%\nline three\n');
  r = await cli('fill', notesRef, '--file', notesFile);
  expect(r.code === 0 && (r.out === `filled ${notesRef} textbox "Notes" with 43 characters` || r.out === `filled ${notesRef} textbox "Notes" with 43 characters (set directly)`), `fill --file (${said(r)})`);
  r = await cliIn("document.getElementById('notes').value\n", 'eval', '--stdin');
  expect(r.code === 0 && r.out === JSON.stringify('line one\nline "two" at 100%PATH%\nline three'), `eval --stdin reads the field back verbatim (${said(r)})`);
  const evalFile = path.join(os.tmpdir(), 'eval-854.js');
  fs.writeFileSync(evalFile, "document.getElementById('notes').value.split('\\n').length");
  r = await cli('eval', '--file', evalFile);
  expect(r.code === 0 && r.out === '3', `eval --file (${said(r)})`);
  r = await cli('fill', notesRef, '--clear');
  expect(r.code === 0, `fill --clear (${said(r)})`);
  expect((await inGuest(g1, `document.getElementById('notes').value`)) === '', 'fill --clear emptied the field');
  r = await cliIn('hello\r\n', 'fill', notesRef, '--stdin');
  expect(r.code === 0 && (await inGuest(g1, `document.getElementById('notes').value`)) === 'hello', `fill --stdin drops the one trailing newline (${said(r)})`);
  r = await cliIn('', 'fill', notesRef, '--stdin');
  expect(r.code === 0 && (await inGuest(g1, `document.getElementById('notes').value`)) === '', `an empty --stdin empties the field (${said(r)})`);
  expect(await activeIsShell(), 'the window keeps the shell textarea focused after the text fills');
  step('M9 fix 854: fill and eval take their text verbatim from --file and --stdin, and fill --clear and an empty --stdin empty the field');

  // (e) eval.
  r = await cli('eval', '1+2');
  expect(r.code === 0 && r.out === '3', `eval 1+2 (${said(r)})`);
  r = await cli('eval', 'document.title');
  expect(r.code === 0 && r.out === '"Drive fixture"', `eval document.title (${said(r)})`);
  r = await cli('eval', "(() => { throw new Error('nope') })()");
  expect(r.code === 1 && r.err === 'emmer: the page threw: Error: nope', `eval that throws (${said(r)})`);
  step('M9 fix 672: eval prints a value as JSON and says what the page threw');

  // (f) A screenshot.
  r = await cli('screenshot');
  const shotDir = path.join(homeDir, 'screenshots') + path.sep;
  const shot = /^saved (.+\.png) \((\d+)x(\d+) CSS pixels, (\d+(?:\.\d+)?) device pixels? each\)$/.exec(r.out);
  console.log(`[915] screenshot: ${r.out}`);
  expect(r.code === 0 && shot !== null && shot[1].startsWith(shotDir), `screenshot under the home, its CSS size and scale (${said(r)})`);
  const png = fs.readFileSync(shot[1]);
  expect(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'the file is a PNG');
  expect(Math.abs(png.readUInt32BE(16) / Number(shot[2]) - Number(shot[4])) <= 0.006, "the PNG's width over the CSS width is the printed scale");
  step('M9 fixes 672 and 915: a screenshot is a PNG under the home, its answer the page\'s CSS size and the device pixels in each');

  // (g) wait.
  r = await cli('wait', 'Clicked');
  expect(r.code === 0 && /^"Clicked" is on the page \(after \d+ ms\)$/.test(r.out), `wait Clicked (${said(r)})`);
  r = await cli('wait', 'never here', '--timeout', '1');
  expect(r.code === 2 && r.err === 'emmer: gave up after 1 s waiting for "never here"', `wait never here (${said(r)})`);
  // M9 fix 856: a text in a field's value (#name, empty since (d)'s
  // Escape) and in an aria-label (the #notes textarea's; no page text
  // holds Notes).
  r = await cli('eval', "document.getElementById('name').value = 'Feature Implementation'");
  expect(r.code === 0, `set #name's value (${said(r)})`);
  r = await cli('wait', 'Feature Implementation', '--timeout', '3');
  expect(r.code === 0 && /^"Feature Implementation" is in a field on the page \(after \d+ ms\)$/.test(r.out), `wait finds a field's value (${said(r)})`);
  r = await cli('wait', 'Notes', '--timeout', '3');
  expect(r.code === 0 && /^"Notes" is in a label on the page \(after \d+ ms\)$/.test(r.out), `wait finds an aria-label (${said(r)})`);
  step('M9 fixes 672 and 856: wait finds text on the page, in a field\'s value and in an aria-label, and gives up at its timeout with exit 2');

  // (h) navigate, and a ref from before it.
  r = await cli('navigate', origin + '/two');
  expect(r.code === 0 && r.out === `on ${origin}/two, titled "Drive fixture two"`, `navigate /two (${said(r)})`);
  const deadlineH = Date.now() + 5000;
  while ((await browserPanes())[0].view.url !== `${origin}/two` && Date.now() < deadlineH) await sleep(100);
  expect((await browserPanes())[0].view.url === `${origin}/two`, `the record follows (${(await browserPanes())[0].view.url})`);
  r = await cli('click', go);
  expect(r.code === 1 && r.err === `emmer: ${go} is from before the page changed; take a new snapshot`, `a stale ref (${said(r)})`);
  r = await cli('navigate', origin + '/');
  expect(r.code === 0, `navigate back (${said(r)})`);
  r = await cli('snapshot');
  expect(r.code === 0, `a fresh snapshot (${said(r)})`);
  lines.length = 0;
  lines.push(...r.out.split(/\r?\n/));
  go = refOf(/^@e\d+ button "Go"$/);
  nameRef = refOf(/^@e\d+ textbox "Name"$/);
  const blank = refOf(/^@e\d+ link "New tab"$/);
  const exportRef = refOf(/^@e\d+ link "Export"$/);
  const errRef = refOf(/^@e\d+ button "Error"$/);
  // A file input is a button whose value is Chromium's "No file chosen".
  const upRef = refOf(/^@e\d+ button "Import"( value=".*")?$/);
  expect(await activeIsShell(), 'the window keeps the shell textarea focused through (h)');
  step('M9 fix 672: navigate loads a page, the record follows, and a ref from before it is refused');

  // (h2) M9 fix 692: hover answers promptly and the page reads hovered.
  // Read through the script's own CDP client on the guest, not the
  // driver's debugger.
  const hov = refOf(/^@e\d+ button "Hover me"$/);
  const hoverStarted = Date.now();
  r = await cli('hover', hov);
  const hoverMs = Date.now() - hoverStarted;
  console.log(`[692] hover answered in ${hoverMs} ms`);
  const hoverLine = logText().split(/\r?\n/).filter((l) => l.includes(`browser: hover on pane ${driven.id.slice(0, 8)} answered`)).pop();
  console.log(`[692] main.log: ${hoverLine ?? '(no answered line)'}`);
  expect(r.code === 0 && r.out === `hovering over ${hov} button "Hover me"`, `hover (${said(r)})`);
  const hovRead = async () => ({
    bg: await inGuest(g1, `getComputedStyle(document.getElementById('hov')).backgroundColor`),
    log: await inGuest(g1, `document.getElementById('hovlog').textContent`),
    entered: await inGuest(g1, `document.getElementById('hov').dataset.entered ?? ''`),
  });
  const hovered = await hovRead();
  console.log(`[692] the page reads ${JSON.stringify(hovered)}`);
  expect(hoverMs < 3000, `hover answers within 3 s (${hoverMs} ms)`);
  expect(hovered.bg === 'rgb(0, 128, 0)' && hovered.log === 'over' && hovered.entered === 'yes', `the page reads hovered: its :hover style, mouseover and mouseenter (${JSON.stringify(hovered)})`);
  expect(await activeIsShell(), 'the window keeps the shell textarea focused after the hover');
  step('M9 fix 692: hover answers within 3 s and the page reads hovered: its :hover style, mouseover and mouseenter');

  // (h3) M9 fix 858: a click on a control shown only while its menu is
  // hovered, and on a never-hovered button that reads its pointerenter and
  // :hover in its click. Its snapshot goes to menuLines, never lines, and
  // everything it adds sits after #hovlog, so (i) to (k)'s refs from (h)
  // keep their numbers.
  const menuRef = refOf(/^@e\d+ button "Menu"$/);
  r = await cli('hover', menuRef);
  expect(r.code === 0, `hover Menu (${said(r)})`);
  r = await cli('snapshot');
  expect(r.code === 0, `the snapshot with the menu open (${said(r)})`);
  const menuLines = r.out.split(/\r?\n/);
  const menuRefOf = (re) => {
    const line = menuLines.find((l) => re.test(l));
    expect(line !== undefined, `a row matching ${re} with the menu open (${r.out})`);
    return line.split(' ')[0];
  };
  const itemRef = menuRefOf(/^@e\d+ button "Item"$/);
  const gateRef = menuRefOf(/^@e\d+ button "Gate"$/);
  r = await cli('click', itemRef);
  const itemClick = said(r);
  const itemLog = await inGuest(g1, "document.getElementById('menulog').textContent");
  r = await cli('click', gateRef);
  const gateClick = said(r);
  const gateLog = await inGuest(g1, "document.getElementById('gatelog').textContent");
  console.log(`[858] item ${JSON.stringify(itemLog)}, gate ${JSON.stringify(gateLog)} (clicks ${itemClick}; ${gateClick})`);
  expect(itemLog === 'item clicked', `the item shown on hover takes the click (${itemClick}, ${JSON.stringify(itemLog)})`);
  expect(gateLog === 'entered first', `the gate reads its pointerenter and :hover in its click (${gateClick}, ${JSON.stringify(gateLog)})`);
  expect(await activeIsShell(), 'the window keeps the shell textarea focused after the hover-menu click');
  step('M9 fix 858: a click lands on a control shown on hover, and the clicked control reads its pointerenter and :hover first');

  // (i) A target=_blank link and a console error, read in events.
  r = await cli('click', blank);
  expect(r.code === 0 && r.out === `clicked ${blank} link "New tab"`, `click the blank link (${said(r)})`);
  await waitLog(`link held under a private EMERALD_HOME: ${origin}/blank-target`, 'the new window went to the system browser');
  expect((await pageTargets()).length === 1 && (await guestTargets()).length === 1, `one page and one guest (${JSON.stringify((await targets()).map((t) => [t.type, t.url]))})`);
  r = await cli('click', errRef);
  expect(r.code === 0, `click Error (${said(r)})`);
  r = await cli('events');
  expect(r.code === 0 && new RegExp(`^\\d\\d:\\d\\d:\\d\\d window http://127\\.0\\.0\\.1:\\d+/blank-target$`, 'm').test(r.out), `events has the window (${said(r)})`);
  expect(/^\d\d:\d\d:\d\d console error fixture error one \(http:\/\/127\.0\.0\.1:\d+\/:\d+\)$/m.test(r.out), `events has the console error (${said(r)})`);
  r = await cli('events');
  expect(r.code === 0 && r.out === 'nothing since the last read', `a second events (${said(r)})`);
  step('M9 fix 673: a target=_blank link and a console error read in events with no window opened');

  // (j) A download.
  r = await cli('click', exportRef);
  expect(r.code === 0, `click Export (${said(r)})`);
  const saved = path.join(homeDir, 'downloads', 'drive-export.json');
  const deadlineJ = Date.now() + 5000;
  while (!(fs.existsSync(saved) && fs.readFileSync(saved, 'utf8') === '{"ok":true}') && Date.now() < deadlineJ) await sleep(100);
  expect(fs.existsSync(saved) && fs.readFileSync(saved, 'utf8') === '{"ok":true}', `the download is saved at ${saved}`);
  expect((await pageTargets()).length === 1, `no new window or dialog (${JSON.stringify((await targets()).map((t) => [t.type, t.url]))})`);
  r = await cli('events');
  expect(r.code === 0 && /^\d\d:\d\d:\d\d download .+\\downloads\\drive-export\.json$/m.test(r.out), `events has the download (${said(r)})`);
  step('M9 fix 673: a download saved to the home\'s downloads folder with no dialog');

  // (k) upload.
  const file = path.join(os.tmpdir(), 'upload-me.txt');
  fs.writeFileSync(file, 'upload me');
  r = await cli('upload', upRef, file);
  expect(r.code === 0 && r.out === `set ${upRef} to ${file}`, `upload (${said(r)})`);
  expect((await inGuest(g1, `document.getElementById('up').files[0]?.name`)) === 'upload-me.txt', 'the input holds the file');
  r = await cli('upload', go, file);
  expect(r.code === 1 && r.err === `emmer: ${go} is not a file input`, `upload on a button (${said(r)})`);
  step('M9 fix 673: upload sets a file input and refuses a button');

  // (k2) M9 fix 874: drag on the /drag page's list, onto a row's ref and
  // then by dx,dy; the move count and span are logged, not expected, since
  // a coalesced move still reorders the rows.
  r = await cli('navigate', origin + '/drag');
  expect(r.code === 0 && r.out === `on ${origin}/drag, titled "Drive fixture drag"`, `navigate to /drag (${said(r)})`);
  r = await cli('snapshot');
  expect(r.code === 0, `the snapshot of /drag (${said(r)})`);
  console.log(`[874] the snapshot of /drag:\n${r.out}`);
  const dragLines = r.out.split(/\r?\n/);
  const dragRefOf = (re) => {
    const line = dragLines.find((l) => re.test(l));
    expect(line !== undefined, `a row matching ${re} on /drag (${r.out})`);
    return line.split(' ')[0];
  };
  const rowA = dragRefOf(/^@e\d+ button "Step A"$/);
  const rowC = dragRefOf(/^@e\d+ button "Step C"$/);
  const order = () => inGuest(g1, "[...document.querySelectorAll('#steps li')].map((li) => li.textContent).join(',')");
  const dragLog = () => inGuest(g1, "document.getElementById('draglog').textContent");
  r = await cli('drag', rowA, rowC);
  expect(r.code === 0 && r.out === `dragged ${rowA} button "Step A" onto ${rowC} button "Step C"`, `drag onto a ref (${said(r)})`);
  console.log(`[874] onto a ref: ${await dragLog()}`);
  let rows = await order();
  expect(rows === 'Step B,Step C,Step A', `Step A dropped after Step C (${rows})`);
  r = await cli('drag', rowA, '0,-60');
  expect(r.code === 0 && r.out === `dragged ${rowA} button "Step A" by 0,-60`, `drag by 0,-60 (${said(r)})`);
  console.log(`[874] by 0,-60: ${await dragLog()}`);
  rows = await order();
  expect(rows === 'Step B,Step A,Step C', `Step A dropped back between B and C (${rows})`);
  expect(await activeIsShell(), 'the window keeps the shell textarea focused after the drags');
  step('(k2) M9 fix 874: drag moves a row onto another row and by dx,dy, a press, ten moves and a release, with the window focus left on the shell');

  // (k2b) M9 fix 915: drag from a point x,y on a canvas, then back to /drag for (k3).
  r = await cli('navigate', origin + '/canvas');
  expect(r.code === 0 && r.out === `on ${origin}/canvas, titled "Drive fixture canvas"`, `navigate to /canvas (${said(r)})`);
  // A press sent the moment the load resolves can reach the page before it
  // has painted, and Chromium drops it while the moves still land, so the
  // pad read down null on every run at the close-out of fixes 888 to 917
  // (the ref drags above have a snapshot between their load and their press).
  await new Promise((resolve) => setTimeout(resolve, 500));
  r = await cli('drag', '50,40', '100,60');
  expect(r.code === 0 && r.out === 'dragged from 50,40 by 100,60', `drag from a point (${said(r)})`);
  const pad = await inGuest(g1, 'window.__pad');
  console.log(`[915] the pad: ${JSON.stringify(pad)}`);
  const within1 = (got, want) => Array.isArray(got) && Math.abs(got[0] - want[0]) <= 1 && Math.abs(got[1] - want[1]) <= 1;
  expect(within1(pad.down, [50, 40]) && within1(pad.up, [150, 100]), `the press at the point and the release dx,dy from it (${JSON.stringify(pad)})`);
  expect(await activeIsShell(), 'the window keeps the shell textarea focused after the drag from a point');
  r = await cli('navigate', origin + '/drag');
  expect(r.code === 0, `navigate back to /drag (${said(r)})`);
  step('(k2b) M9 fix 915: drag from a point x,y on a canvas, the press at the point and the release dx,dy from it, with the window focus left on the shell');

  // (k3) M9 fix 875: snapshot --name and --within on the same /drag page,
  // the printed lines read against the whole snapshot's, then back to /.
  r = await cli('snapshot');
  expect(r.code === 0, `the whole snapshot of /drag (${said(r)})`);
  console.log(`[875] the whole snapshot:\n${r.out}`);
  const whole = r.out.split(/\r?\n/);
  const wholeLine = (re) => {
    const line = whole.find((l) => re.test(l));
    expect(line !== undefined, `a row matching ${re} in the whole snapshot (${r.out})`);
    return line;
  };
  const dialogLine = wholeLine(/^@r\d+ dialog "Edit step" \(3 rows\)$/);
  const dialogRef = dialogLine.split(' ')[0];
  const saveDraftLine = wholeLine(/^@e\d+ button "Save draft"$/);
  const stepNameLine = wholeLine(/^@e\d+ textbox "Step name"$/);
  const saveLine = wholeLine(/^@e\d+ button "Save"$/);
  const cancelLine = wholeLine(/^@e\d+ button "Cancel"$/);
  const regions = whole.filter((l) => /^@r\d+ /.test(l)).length;
  console.log(`[875] ${regions} region rows: ${whole.filter((l) => /^@r\d+ /.test(l)).join('; ')}`);
  expect(regions >= 1, `at least the dialog is a region (${regions})`);
  r = await cli('snapshot', '--name', 'save');
  expect(r.code === 0 && r.out === [whole[0], saveDraftLine, saveLine].join('\n'), `snapshot --name save (${said(r)})`);
  r = await cli('snapshot', '--within', dialogRef);
  expect(r.code === 0 && r.out === [whole[0], dialogLine, stepNameLine, saveLine, cancelLine].join('\n'), `snapshot --within ${dialogRef} (${said(r)})`);
  r = await cli('snapshot', '--within', dialogRef, '--name', 'SAVE');
  expect(r.code === 0 && r.out === [whole[0], saveLine].join('\n'), `snapshot --within ${dialogRef} --name SAVE (${said(r)})`);
  const saveRef = saveLine.split(' ')[0];
  r = await cli('click', saveRef);
  expect(r.code === 0 && r.out === `clicked ${saveRef} button "Save"`, `click the ref from the filtered rows (${said(r)})`);
  const dlgLog = await inGuest(g1, "document.getElementById('dlglog').textContent");
  expect(dlgLog === 'saved', `the dialog's Save took the click (${JSON.stringify(dlgLog)})`);
  r = await cli('snapshot', '--name', 'nothing here');
  expect(r.code === 0 && r.out === [whole[0], 'no row matches "nothing here"'].join('\n'), `snapshot --name with no match (${said(r)})`);
  r = await cli('snapshot', '--within', '@r99');
  expect(r.code === 1 && r.err === `emmer: no @r99 in the last snapshot (it had @r1 to @r${regions})`, `snapshot --within an unknown region (${said(r)})`);
  r = await cli('navigate', origin + '/');
  expect(r.code === 0, `navigate back to / (${said(r)})`);
  expect(await activeIsShell(), 'the window keeps the shell textarea focused after the filtered snapshots');
  step("(k3) M9 fix 875: snapshot --name and --within print the rows asked for under the whole page's refs, a ref from the filtered rows clicks, and an unknown region is refused");

  // (l) A pane under profile b.
  r = await cli('eval', "document.cookie = 'who=one; path=/'");
  expect(r.code === 0, `the cookie set (${said(r)})`);
  r = await cli('open', origin + '/?profile=b', '--profile', 'b');
  expect(r.code === 0 && new RegExp(`^opened ${origin}/\\?profile=b in pane [0-9a-f-]{8} on tab .+ under profile b$`).test(r.out), `open --profile b (${said(r)})`);
  const second = (await browserPanes()).find((p) => p.view.profile === 'b');
  expect(second !== undefined, `the layout's new view carries profile b (${JSON.stringify((await browserPanes()).map((p) => p.view))})`);
  await s.waitFor(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(second.id)}] .browser-profile`)})?.textContent === 'profile b'`, 'the profile mark on the title row');
  await guestFor(origin + '/?profile=b');
  r = await cli('snapshot');
  expect(r.code === 1 && /^emmer: 2 browser panes on tab .+ \(.+, .+\); name one with --pane <id>$/m.test(r.err), `two panes need --pane (${said(r)})`);
  r = await cli('--pane', second.id, 'eval', 'document.cookie');
  expect(r.code === 0 && r.out === '""', `profile b sees no cookie (${said(r)})`);
  r = await cli('--pane', driven.id, 'eval', 'document.cookie');
  expect(r.code === 0 && r.out === '"who=one"', `the default pane keeps its cookie (${said(r)})`);
  step('M9 fix 673: a --profile b pane does not see the default pane\'s cookie');

  // (m) The takeover, on the default pane.
  const onDefault = (...args) => cli('--pane', driven.id, ...args);
  r = await onDefault('snapshot');
  expect(r.code === 0, `snapshot before the takeover (${said(r)})`);
  const box = await pageRect(driven.id);
  await s.click(box.x + box.width / 2, box.y + box.height / 2);
  const pausedLine = 'emmer: paused by the person; emmer browser resume or the Resume button on the pane';
  await waitLog(`browser: pane ${driven.id.slice(0, 8)} paused by the person's click`, 'the click paused the driver');
  r = await onDefault('snapshot');
  expect(r.code === 77 && r.err === pausedLine, `snapshot while paused (${said(r)})`);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(driven.id)}] .browser-driven.paused`)}) && !!document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(driven.id)}] .browser-resume`)})`, 'the paused mark and the Resume button');
  r = await onDefault('events');
  expect(r.code === 0, `events while paused (${said(r)})`);
  r = await onDefault('resume');
  expect(r.code === 0 && r.out === 'resumed', `resume (${said(r)})`);
  r = await onDefault('snapshot');
  expect(r.code === 0, `snapshot after resume (${said(r)})`);
  console.log(`[verify] note: before the key the window's focus is on ${await s.evalJs(`(() => { const a = document.activeElement; return a === null ? 'nothing' : a.tagName + '.' + a.className; })()`)}`);
  await s.key('a', 'KeyA', 65);
  await waitLog(`browser: pane ${driven.id.slice(0, 8)} paused by the person's key`, 'the key paused the driver');
  r = await onDefault('snapshot');
  expect(r.code === 77 && r.err === pausedLine, `snapshot after the key (${said(r)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(driven.id)}] .browser-resume`)}).click()`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(driven.id)}] .browser-driven.paused`)})`, 'the mark leaves its paused form');
  await waitLog(`browser: pane ${driven.id.slice(0, 8)} resumed by the Resume button`, 'the Resume button');
  r = await onDefault('snapshot');
  expect(r.code === 0, `snapshot after the button (${said(r)})`);
  r = await onDefault('resume');
  expect(r.code === 0 && r.out === 'was not paused', `resume when not paused (${said(r)})`);
  step('M9 fix 673: a click and a key of the person\'s pause the driver; emmer browser resume and the Resume button hand it back');

  // (n) M9 fix 693: a fresh page answers a snapshot with no wait for the
  // page; a pane never registered stays at "has no page yet" past 5 s.
  const seen = new Set((await browserPanes()).map((p) => p.id));
  for (let i = 0; i < 5; i++) {
    r = await cli('open', `${origin}/?n=${i}`);
    expect(r.code === 0, `open /?n=${i} (${said(r)})`);
    let fresh = null;
    const deadlineN = Date.now() + 5000;
    while (fresh === null && Date.now() < deadlineN) {
      fresh = (await browserPanes()).find((p) => !seen.has(p.id)) ?? null;
      if (fresh === null) await sleep(100);
    }
    expect(fresh !== null, `a new browser pane for /?n=${i}`);
    seen.add(fresh.id);
    const asked = Date.now();
    for (;;) {
      r = await cli('--pane', fresh.id, 'snapshot');
      if (!(r.code === 1 && r.err.includes('has no page yet')) || Date.now() - asked > 5000) break;
      await sleep(200);
    }
    expect(r.code === 0 && r.out.startsWith('page "Drive fixture" '), `the fresh page /?n=${i} answers a snapshot within 5 s (${said(r)})`);
    const count = (await browserPanes()).length;
    // Closed as a person would: a click into its address bar, then the chord.
    const freshBar = `.pane[data-pane-id=${JSON.stringify(fresh.id)}] .browser-address`;
    const bar = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(freshBar)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.click(bar.x, bar.y);
    await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(freshBar)})`, `the address bar of /?n=${i} holds the keyboard`);
    await s.key('W', 'KeyW', 87, CTRL | SHIFT);
    const deadlineC = Date.now() + 5000;
    while ((await browserPanes()).length !== count - 1 && Date.now() < deadlineC) await sleep(100);
    expect((await browserPanes()).length === count - 1, `the pane of /?n=${i} closed (${(await browserPanes()).length} browser panes, the focus on ${await s.evalJs(`(() => { const a = document.activeElement; return a === null ? 'nothing' : a.tagName + '.' + a.className; })()`)})`);
  }
  const notAt = (from) => logText().split(/\r?\n/).filter((l) => l.includes(`browser guest not registered at ${from}`)).length;
  console.log(`[693] note: ${notAt('attach')} browser guest not registered at attach lines, ${notAt('dom-ready')} at dom-ready`);
  step('M9 fix 693: five fresh pages each answer a snapshot without a wait for the page');

  // (o) M9 fix 876: the page stays focused from one command to the next,
  // read through the script's own CDP client on the guest. The Blur menu
  // closes on the window's blur, as Radix's menu does, so it is open for
  // the eval and the snapshot after the click only while the driver holds
  // the page; the launch's EMERALD_BROWSER_HOLD_MS lets go 4 s after the
  // last command, and the menu closes then.
  r = await cli('--pane', driven.id, 'navigate', origin + '/');
  expect(r.code === 0, `navigate back for the blur menu (${said(r)})`);
  r = await cli('--pane', driven.id, 'snapshot');
  expect(r.code === 0, `the snapshot for the blur menu (${said(r)})`);
  const blurLines = r.out.split(/\r?\n/);
  const blurRefOf = (re, from = blurLines) => {
    const line = from.find((l) => re.test(l));
    expect(line !== undefined, `a row matching ${re} (${from.join('\n')})`);
    return line.split(' ')[0];
  };
  const bmenuRef = blurRefOf(/^@e\d+ button "Blur menu"$/);
  const heldNameRef = blurRefOf(/^@e\d+ textbox "Name"$/);
  const shellBoxO = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(shellPane.id)}] .term-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(shellBoxO.x, shellBoxO.y);
  await s.waitFor(`document.activeElement?.classList.contains('xterm-helper-textarea') && !!document.activeElement.closest('[data-pane-id=${JSON.stringify(shellPane.id)}]')`, 'the shell holds the keyboard again');
  await s.evalJs(`window.__driveShellInput = document.activeElement`);
  await inGuest(g1, 'window.__focusLog.length = 0');
  const focusRead = async () => {
    await sleep(200);
    return JSON.parse(await inGuest(g1, "JSON.stringify({ events: window.__focusLog.splice(0).map((e) => e.kind), open: !document.getElementById('bitems').hidden, has: document.hasFocus() })"));
  };
  const focusLine = (verbName, f) => console.log(`[876] after ${verbName}: open ${f.open}, has ${f.has}, events ${f.events.join(', ')}`);
  r = await cli('--pane', driven.id, 'click', bmenuRef);
  expect(r.code === 0, `click Blur menu (${said(r)})`);
  const afterClick = await focusRead();
  focusLine('click', afterClick);
  expect(afterClick.open === true && afterClick.has === true, `the menu is open and the page focused after the click (${JSON.stringify(afterClick)})`);
  r = await cli('--pane', driven.id, 'eval', 'document.hasFocus()');
  expect(r.code === 0 && r.out === 'true', `eval document.hasFocus() (${said(r)})`);
  const afterEval = await focusRead();
  focusLine('eval', afterEval);
  expect(afterEval.open === true && afterEval.has === true, `the menu is open and the page focused after the eval (${JSON.stringify(afterEval)})`);
  r = await cli('--pane', driven.id, 'snapshot');
  expect(r.code === 0 && /^@e\d+ button "Blur item"$/m.test(r.out), `the snapshot lists the open menu's item (${said(r)})`);
  const afterSnap = await focusRead();
  focusLine('snapshot', afterSnap);
  expect(afterSnap.open === true && afterSnap.has === true, `the menu is open and the page focused after the snapshot (${JSON.stringify(afterSnap)})`);
  const blurred = [...afterClick.events, ...afterEval.events, ...afterSnap.events].filter((e) => e === 'blur');
  expect(blurred.length === 0, `no blur across the three commands (${blurred.length})`);
  r = await cli('--pane', driven.id, 'fill', heldNameRef, 'held');
  expect(r.code === 0, `fill the held page's Name (${said(r)})`);
  // The visible cost of a held page, for the seat to compare by eye: the
  // Name field's caret and ring while held, and after the release. Taken
  // from the guest's own target, since the off-screen window's capture
  // showed the guest's area stale (the menu still open after it closed).
  const guestShot = async (name) => {
    const file = path.join(os.tmpdir(), 'emerald-verify', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from((await g1.cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    return file;
  };
  const shotA = await guestShot('browser-drive-876-held-a.png');
  await sleep(600);
  const shotB = await guestShot('browser-drive-876-held-b.png');
  expect(await activeIsShell(), 'the window keeps the shell textarea focused while the page is held');
  await sleep(5500);
  const afterHold = await focusRead();
  focusLine('the hold', afterHold);
  expect(afterHold.open === false && afterHold.has === false && afterHold.events.includes('blur'), `the page let go: the menu closed on its blur (${JSON.stringify(afterHold)})`);
  await waitLog(`browser: pane ${driven.id.slice(0, 8)} released (idle 4 s)`, 'the page let go after the hold');
  const shotC = await guestShot('browser-drive-876-released.png');
  console.log(`[876] screenshots: ${shotA}, ${shotB}, ${shotC}`);
  step('M9 fix 876: a menu a click opened stays open for the next eval and snapshot, the page held focused until 4 s after the last command');

  // (p) M9 fix 877: fill picks a select's option by its value or its text,
  // refuses a missing option, a multiple select, a checkbox and a file
  // input, says when the page's own setter refuses the text, and leaves a
  // contenteditable's typed text with no "(set directly)".
  r = await cli('--pane', driven.id, 'navigate', origin + '/');
  expect(r.code === 0, `navigate back for the fill targets (${said(r)})`);
  r = await cli('--pane', driven.id, 'snapshot');
  expect(r.code === 0, `the snapshot for the fill targets (${said(r)})`);
  const fillLines = r.out.split(/\r?\n/);
  const rowOf = (re) => {
    const line = fillLines.find((l) => re.test(l));
    expect(line !== undefined, `a row matching ${re} (${r.out})`);
    return { ref: line.split(' ')[0], role: line.split(' ')[1] };
  };
  const car = rowOf(/^@e\d+ \S+ "Car"( |$)/);
  const cars = rowOf(/^@e\d+ \S+ "Cars"( |$)/);
  const ok = rowOf(/^@e\d+ checkbox "Agree"( |$)/).ref;
  const up = rowOf(/^@e\d+ button "Import"( value=".*")?$/).ref;
  const picky = rowOf(/^@e\d+ textbox "Picky"( |$)/).ref;
  const rich = rowOf(/^@e\d+ textbox "Rich"( |$)/).ref;
  if (car.role !== 'combobox') console.log(`[877] the select's role is ${car.role}`);
  const onFill = (...args) => cli('--pane', driven.id, 'fill', ...args);
  const carRead = async () => JSON.parse(await inGuest(g1, "JSON.stringify({ value: document.getElementById('car').value, changes: document.getElementById('car').dataset.changes ?? '' })"));
  r = await onFill(car.ref, 'Saab');
  let carNow = await carRead();
  expect(r.code === 0 && r.out === `selected ${car.ref} ${car.role} "Car" option "Saab"` && carNow.value === 's' && carNow.changes === '1', `fill a select by its option's text (${said(r)}, ${JSON.stringify(carNow)})`);
  r = await onFill(car.ref, 'v');
  carNow = await carRead();
  expect(r.code === 0 && r.out === `selected ${car.ref} ${car.role} "Car" option "Volvo"` && carNow.value === 'v' && carNow.changes === '2', `fill a select by its option's value (${said(r)}, ${JSON.stringify(carNow)})`);
  r = await onFill(car.ref, 'Audi');
  carNow = await carRead();
  expect(r.code === 1 && r.err === `emmer: no option "Audi" in ${car.ref} ${car.role} "Car"; its options are Volvo, Saab` && carNow.value === 'v', `a missing option is refused, listing them (${said(r)}, ${JSON.stringify(carNow)})`);
  r = await onFill(cars.ref, 'Saab');
  expect(r.code === 1 && r.err === 'emmer: fill takes a single select; a multiple select is not driven', `a multiple select is refused (${said(r)})`);
  r = await onFill(ok, 'yes');
  const okNow = JSON.parse(await inGuest(g1, "JSON.stringify({ checked: document.getElementById('ok').checked, value: document.getElementById('ok').getAttribute('value') })"));
  expect(r.code === 1 && r.err === `emmer: ${ok} is a checkbox; click it to tick it` && okNow.checked === false && okNow.value === null, `a checkbox is refused and left alone (${said(r)}, ${JSON.stringify(okNow)})`);
  r = await onFill(up, 'x');
  expect(r.code === 1 && r.err === `emmer: ${up} is a file input; emmer browser upload ${up} <path> sets its file`, `a file input is refused, naming upload (${said(r)})`);
  r = await onFill(picky, 'z');
  expect(r.code === 1 && r.err === `emmer: the page refused the text for ${picky} textbox "Picky": Error: picky refuses`, `a field whose setter throws says so (${said(r)})`);
  r = await onFill(rich, 'hi');
  expect(r.code === 0 && r.out === `filled ${rich} textbox "Rich" with 2 characters`, `a contenteditable keeps its typed text with no "(set directly)" (${said(r)})`);
  const richText = await inGuest(g1, "document.getElementById('rich').textContent");
  if (richText === 'hi') expect(true, 'the contenteditable reads hi');
  else console.log(`[877] rich reads ${JSON.stringify(richText)}`);
  expect(await activeIsShell(), 'the window keeps the shell textarea focused after the fills');
  step('M9 fix 877: fill picks a select\'s option by value or text and refuses a missing one, a multiple select, a checkbox and a file input, and says when the page refuses the text');

  // (q) M9 fix 878: the --profile b pane of (l), driven by nothing since,
  // follows a link and its record keeps profile b (fix 839's withPageUrl).
  r = await cli('--pane', second.id, 'snapshot');
  expect(r.code === 0, `the profile b pane's snapshot (${said(r)})`);
  const twoLine = r.out.split(/\r?\n/).find((l) => /^@e\d+ link "Two"$/.test(l));
  expect(twoLine !== undefined, `the Two link on the profile b page (${r.out})`);
  const twoRef = twoLine.split(' ')[0];
  r = await cli('--pane', second.id, 'click', twoRef);
  expect(r.code === 0 && r.out === `clicked ${twoRef} link "Two"`, `click Two on the profile b pane (${said(r)})`);
  const secondView = async () => (await browserPanes()).find((p) => p.id === second.id)?.view;
  const deadlineQ = Date.now() + 5000;
  while ((await secondView())?.url !== origin + '/two' && Date.now() < deadlineQ) await sleep(100);
  const afterLink = await secondView();
  expect(afterLink?.url === origin + '/two', `the profile b pane's record follows the link (${JSON.stringify(afterLink)})`);
  expect(afterLink?.profile === 'b', `the record keeps profile b across the link (${JSON.stringify(afterLink)})`);
  await s.waitFor(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(second.id)}] .browser-profile`)})?.textContent === 'profile b'`, 'the profile mark after the link');
  step('M9 fix 878: a --profile b pane keeps profile b across a link it follows (fix 839)');

  for (const line of s.consoleLog.filter((l) => /error/.test(l))) console.log(`[672] window console: ${line}`);
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('browser-drive-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  for (const g of guests) g.cdp.close();
  s.close();
  killTree(s.child);
  stopDaemon();
  server.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
