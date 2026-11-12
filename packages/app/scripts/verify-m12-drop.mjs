// M12 acceptance: a folder dropped from Explorer. A drag with files over
// a pane lights the same zones as a sidebar drag (each band and the
// centre), clears over the sidebar and when the drag leaves the window,
// and a drop on the right band splits the pane with a new shell in the
// folder on the right; a file over a shell pane lights the whole pane and
// a drop types its path there, and a file over an empty pane previews the
// same band a folder would and a drop opens a file view there, on an
// edge beside it and on the middle in the pane itself (M9 fix 387), the
// middle drop focusing the pane it landed on (M9 fix 418); then
// a pane dragged by its own title bar onto another (M9 fix 73), and a
// title or a row onto another layout tab or the + (M9 fix 651). CDP cannot start a
// native drag with a real file, so the drag events are dispatched from
// inside the page with a DataTransfer that carries a File, and that File
// is a real one: DOM.setFileInputFiles puts a path on a hidden file input,
// and a File from there answers the preload's pathFor the way a dropped
// one does. Uses a private home and pipe unless the environment already
// names them.
// Run: npm run verify:drop -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm12-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m12';
const { CTRL, SHIFT, clickNewShell, expect, focusedPaneIs, freshPort, getLayout, getTabs, killTree, launch, leaves, sleep, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 180 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 180000);

// The seed: a folder to drop and a file in it to drop on a shell. The
// file's name has a space so the typed path has to be quoted, and a .txt
// extension so Windows gives it a type and the hover knows it for a file.
// The second file's extension is one Windows has no registered type for
// (M9 fix 388), so it hovers the way a folder does.
const seedShort = path.join(os.tmpdir(), 'emerald-verify', `m12-drop-${process.pid}`);
fs.rmSync(seedShort, { recursive: true, force: true });
fs.mkdirSync(seedShort, { recursive: true });
const seed = fs.realpathSync.native(seedShort);
const seedFile = path.join(seed, 'my note.txt');
fs.writeFileSync(seedFile, 'not a folder\n');
const seedUnknown = path.join(seed, 'untyped.emeraldtest');
fs.writeFileSync(seedUnknown, 'a file with no registered type\n');
// M9 fix 953's source folder, on the seed's drive so a drop moves.
const src953Short = path.join(os.tmpdir(), 'emerald-verify', `m12-src-${process.pid}`);

// Puts a path on a hidden file input through the devtools protocol, the
// one way a page can hold a File that is backed by a real path (a File
// made in the page has none, and pathFor answers '' for it). The input
// takes a folder path as readily as a file's, which is what a dropped
// folder looks like: a File named after it with nothing in it.
async function setDropFile(s, p) {
  await s.evalJs(
    `(() => { let i = document.getElementById('verify-drop'); if (i === null) { i = document.createElement('input'); i.type = 'file'; i.id = 'verify-drop'; i.style.display = 'none'; document.body.appendChild(i); } })()`,
  );
  const r = await s.send('Runtime.evaluate', { expression: `document.getElementById('verify-drop')` });
  await s.send('DOM.setFileInputFiles', { files: [p], objectId: r.result.objectId });
  return s.evalJs(`window.emerald.files.pathFor(document.getElementById('verify-drop').files[0])`);
}

// Dispatches one drag event at the point, on whatever is there, with a
// DataTransfer holding the input's File so the driver takes it for a drop
// from outside. The effect the driver sets (copy over a pane, none
// elsewhere) cannot be read back: Chromium ignores dropEffect on a
// DataTransfer made with the constructor, so only a real drag shows it.
// A dragleave with no related target is how Chromium says the drag left
// the window.
// Every File on the input goes in (M9 fix 953 drops several), and the
// keys a drag from Explorer carries ride on the event (Ctrl copies, Shift
// moves).
const drag = (s, type, p, keys = {}) =>
  s.evalJs(
    `(() => { const dt = new DataTransfer(); for (const f of document.getElementById('verify-drop').files) dt.items.add(f); const el = document.elementFromPoint(${p.x}, ${p.y}) ?? document.body; el.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { dataTransfer: dt, clientX: ${p.x}, clientY: ${p.y}, ctrlKey: ${keys.ctrl === true}, shiftKey: ${keys.shift === true}, bubbles: true, cancelable: true, relatedTarget: null })); })()`,
  );
const hover = async (s, p, keys = {}) => {
  await drag(s, 'dragenter', p, keys);
  await drag(s, 'dragover', p, keys);
};
// Several paths on the input at once (M9 fix 953), setDropFile's shape.
async function setDropFiles(s, paths) {
  await s.evalJs(
    `(() => { let i = document.getElementById('verify-drop'); if (i === null) { i = document.createElement('input'); i.type = 'file'; i.id = 'verify-drop'; i.style.display = 'none'; document.body.appendChild(i); } i.multiple = true; })()`,
  );
  const r = await s.send('Runtime.evaluate', { expression: `document.getElementById('verify-drop')` });
  await s.send('DOM.setFileInputFiles', { files: paths, objectId: r.result.objectId });
}
const dragOn = (s) => s.evalJs(`document.body.classList.contains('dragging-session')`);
// M9 fix 1161: a drag from Explorer wears dragging-files, so a browser pane's page keeps the pointer; the mouse drags keep dragging-session.
const filesOn = (s) => s.evalJs(`document.body.classList.contains('dragging-files')`);
const zoneOn = (s, paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .drop-overlay')?.dataset.dropZone ?? null`);
// M9 fix 1162: the words on a pane's overlay and the text its ::after draws (Chromium hands a string content back in double quotes).
const wordOn = (s, paneId) => s.evalJs(`(() => { const o = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .drop-overlay'); return o === null ? null : { word: o.dataset.dropWord ?? null, shown: getComputedStyle(o, '::after').content }; })()`);
const expectWord = async (s, paneId, word, what) => {
  const w = await wordOn(s, paneId);
  expect(w !== null && w.word === word && w.shown === JSON.stringify(word), `fix 1162: ${what} says ${JSON.stringify(word)}, got ${JSON.stringify(w)}`);
};
const overlays = (s) => s.evalJs(`document.querySelectorAll('.drop-overlay').length`);
const boxOf = (s, paneId) =>
  s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
const centerOf = (s, sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const sessionCount = async (s) => (await zreq(s, 'session.list', {})).sessions.length;

// M9 fix 1008: 2 ms after each copied file, so the 400 files take long
// enough to read a progress note; nothing else in the script copies more
// than one file.
const s = await launch(freshPort(), { freshState: true, env: { EMERALD_COPY_PACE_MS: '2' } });
app = s;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await clickNewShell(s, os.homedir());
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'a shell in the first pane');
  // M9 fix 727: the usage record, switched on through the speaker's right-click
  // menu (fix 700's way) and read from the size it had at on(). off() puts the
  // window's switch back; actions(name) polls up to 3 s for the lines since
  // on() whose ev is action and whose name matches, and returns what it has.
  const usage727 = (() => {
    const file = path.join(process.env['EMERALD_HOME'], 'logs', 'usage.jsonl');
    let offset = 0;
    const size = () => {
      try {
        return fs.statSync(file).size;
      } catch {
        return 0;
      }
    };
    const pick = async (label) => {
      const c = await s.evalJs(`(() => { const r = document.querySelector('.title-bar-mark').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await s.click(c.x, c.y);
      await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu open');
      await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
      await s.waitFor(`!document.querySelector('.app-menu')`, 'the app menu closed');
    };
    const read = (name) => {
      let text = '';
      try {
        text = fs.readFileSync(file).subarray(offset).toString('utf8');
      } catch {
        // Not written yet.
      }
      return text
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l))
        .filter((l) => l.ev === 'action' && l.name === name);
    };
    return {
      async on() {
        await s.waitFor(`!!document.querySelector('.title-bar-mark')`, 'the app menu mark for the usage switch', 5000);
        await pick('Usage record: off');
        await s.waitFor(`document.querySelector('.title-bar-mark')?.dataset.usage === 'on'`, 'the usage switch on', 5000);
        offset = size();
      },
      async off() {
        await pick('Usage record: on');
        await s.waitFor(`document.querySelector('.title-bar-mark')?.dataset.usage !== 'on'`, 'the usage switch off', 5000);
      },
      // Polls until `want` lines arrive (or 3 s), then waits a beat so a
      // stray extra line would show in the count.
      async actions(name, want = 1) {
        let got = read(name);
        for (const end = Date.now() + 3000; got.length < want && Date.now() < end; await sleep(100)) got = read(name);
        await sleep(300);
        return read(name);
      },
    };
  })();
  let layout = await getLayout(s);
  const first = layout.focusedPaneId;
  expect((await setDropFile(s, seed)) === seed, 'the preload answers the folder path for the File that will be dropped');
  step('a shell on screen, and a File backed by the seeded folder ready to drop');

  // Each band and the centre light up, the same overlay as the sidebar drag.
  const box = await boxOf(s, first);
  const at = (u, v) => ({ x: Math.round(box.x + box.width * u), y: Math.round(box.y + box.height * v) });
  const bands = [
    ['right', at(0.9, 0.5)],
    ['left', at(0.1, 0.5)],
    ['top', at(0.5, 0.1)],
    ['bottom', at(0.5, 0.9)],
    ['center', at(0.5, 0.5)],
  ];
  for (const [zone, p] of bands) {
    await hover(s, p);
    expect(await filesOn(s), `the drag is on over the ${zone} band`);
    expect(!(await dragOn(s)), 'an Explorer drag leaves dragging-session off');
    expect((await zoneOn(s, first)) === zone, `the ${zone} zone is previewed, got ${await zoneOn(s, first)}`);
    await expectWord(s, first, zone === 'center' ? 'Open here, or type the path' : 'Open beside, or type the path', `a folder over the shell's ${zone}`);
  }
  expect(!(await s.evalJs(`!!document.querySelector('.drag-ghost')`)), 'no ghost: the OS draws its own');
  await s.screenshot('m12-drop-preview.png');
  step('a drag with files lights each band and the centre of the pane under it');

  // Over the sidebar nothing is previewed.
  const header = await centerOf(s, '.sidebar-header');
  await drag(s, 'dragover', header);
  expect((await filesOn(s)) && (await overlays(s)) === 0, 'over the sidebar the drag is on and nothing is previewed');
  // Leaving the window takes the drag down.
  await drag(s, 'dragleave', header);
  expect(!(await filesOn(s)) && (await overlays(s)) === 0, 'a dragleave out of the window ends the drag');
  step('over the sidebar nothing lights up; leaving the window clears the drag');

  // The drop: a row split with a shell in the folder on the right.
  const before = await sessionCount(s);
  const rightBand = at(0.9, 0.5);
  await hover(s, rightBand);
  expect((await zoneOn(s, first)) === 'right', 'the right band is previewed again');
  await drag(s, 'drop', rightBand);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2 && document.querySelectorAll('.term-host').length === 2`, 'two panes with terminals after the drop');
  expect(!(await filesOn(s)) && (await overlays(s)) === 0, 'the preview and the drag state are gone after the drop');
  layout = await getLayout(s);
  const root = layout.root;
  expect(root.kind === 'split' && root.direction === 'row' && root.first.id === first && root.second.sessionId !== null, 'a row split: the old pane left, a new session right');
  expect(layout.focusedPaneId === root.second.id, 'the new pane is focused');
  const { sessions } = await zreq(s, 'session.list', {});
  const dropped = sessions.find((x) => x.id === root.second.sessionId);
  expect(sessions.length === before + 1, `one new session, got ${sessions.length - before}`);
  expect(dropped !== undefined && dropped.kind === 'shell', 'it is a shell');
  expect(dropped !== undefined && dropped.spawnCwd === seed, `started in the dropped folder, got ${dropped?.spawnCwd}`);
  const recent = await s.evalJs(`localStorage.getItem('emerald.recentFolders')`);
  expect(recent !== null && JSON.parse(recent)[0] === seed, 'the folder is first in the recent list');
  await s.screenshot('m12-drop.png');
  step('a drop on the right band split the pane with a shell in the dropped folder on the right');

  // A file over a shell pane lights the whole pane, on any band, and the
  // drop types its quoted path into that shell with no Enter.
  expect((await setDropFile(s, seedFile)) === seedFile, 'the File to drop is now backed by a file');
  const revision = layout.revision;
  const newPane = root.second.id;
  const b = await boxOf(s, newPane);
  const m = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  const edge = { x: Math.round(b.x + b.width * 0.9), y: m.y };
  await hover(s, edge);
  expect((await zoneOn(s, newPane)) === 'file', `the whole pane is lit for a file over the right band, got ${await zoneOn(s, newPane)}`);
  await expectWord(s, newPane, 'Type the path', "a known file over the shell's right band");
  await hover(s, m);
  expect((await zoneOn(s, newPane)) === 'file', 'and over the middle');
  await expectWord(s, newPane, 'Type the path', "a known file over the shell's middle");
  await s.screenshot('m12-drop-file-preview.png');
  await usage727.on();
  await drag(s, 'drop', m);
  await sleep(800);
  expect(!(await filesOn(s)) && (await overlays(s)) === 0, 'the preview is cleared');
  expect((await sessionCount(s)) === before + 1, 'no session started for a file');
  expect((await getLayout(s)).revision === revision, 'the layout did not change');
  const quoted = `"${seedFile}"`;
  await s.waitFor(
    `(async () => { const r = await window.emerald.request('session.read', { sessionId: ${JSON.stringify(dropped.id)} }); return atob(r.data).includes(${JSON.stringify(quoted)}); })()`,
    'the quoted path typed into the shell',
    5000,
  );
  const typed = Buffer.from((await zreq(s, 'session.read', { sessionId: dropped.id })).data, 'base64').toString('utf8');
  expect(!typed.slice(typed.indexOf(quoted) + quoted.length).includes('\n'), 'no Enter after the path');
  const dropPath727 = await usage727.actions('drop-path');
  expect(dropPath727.length === 1 && dropPath727[0].from === 'click', `the drop on a shell pane is recorded once as drop-path from a click, got ${JSON.stringify(dropPath727)}`);
  await usage727.off();
  step('a file over a shell pane lights the whole pane, and the drop types its quoted path with no Enter');

  // A file over an empty pane (Ctrl+Shift+E splits the focused pane with
  // one) previews the same band a folder would (M9 fix 387), not the
  // whole-pane light a shell pane gets: a drop on an edge splits it with
  // a file view on that side, the pane it landed on left empty; a drop
  // on the middle puts the file view in the pane itself. Both file panes
  // are closed afterwards, back to the two shells this block started with.
  const fileViewOf = (paneId) =>
    s.evalJs(
      `(() => { const el = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]'); return el === null ? null : { view: el.dataset.view ?? null, path: el.querySelector('.pane-name')?.title ?? null }; })()`,
    );
  const isEmptyPane = (paneId) => s.evalJs(`!!document.querySelector(${JSON.stringify(`[data-pane-id="${paneId}"] .empty-pane`)})`);
  const closePaneButton = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] [title="Close pane"]')?.click() ?? false`);

  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3 && !!document.querySelector('.empty-pane')`, 'an empty third pane');
  const emptyPane = (await getLayout(s)).focusedPaneId;
  const eb = await boxOf(s, emptyPane);
  const em = { x: Math.round(eb.x + eb.width / 2), y: Math.round(eb.y + eb.height / 2) };
  const eRight = { x: Math.round(eb.x + eb.width * 0.9), y: em.y };

  await hover(s, eRight);
  expect((await zoneOn(s, emptyPane)) === 'right', `the right band is previewed over the empty pane, got ${await zoneOn(s, emptyPane)}`);
  await expectWord(s, emptyPane, 'Open the file beside', "a known file over the empty pane's right band");
  await drag(s, 'drop', eRight);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'a fourth pane after the edge drop');
  expect(!(await filesOn(s)) && (await overlays(s)) === 0, 'the preview and the drag state are gone');
  expect((await sessionCount(s)) === before + 1, 'no session started for the file');
  expect(await isEmptyPane(emptyPane), 'the pane dropped on is still empty');
  const edgeFilePane = (await getLayout(s)).focusedPaneId;
  expect(edgeFilePane !== emptyPane, 'the new pane is not the one dropped on');
  const edgeView = await fileViewOf(edgeFilePane);
  expect(edgeView !== null && edgeView.view === 'file' && edgeView.path === seedFile, `a file pane to its right, got ${JSON.stringify(edgeView)}`);
  step('a file dropped on the right band of an empty pane leaves it empty and opens a file pane beside it');

  // The middle: the pane dropped on takes the file itself. The edge
  // split resized it, so its centre is read again rather than trusting
  // the box measured before that drop.
  const eb2 = await boxOf(s, emptyPane);
  const em2 = { x: Math.round(eb2.x + eb2.width / 2), y: Math.round(eb2.y + eb2.height / 2) };
  await hover(s, em2);
  expect((await zoneOn(s, emptyPane)) === 'center', `the centre is previewed over the empty pane, got ${await zoneOn(s, emptyPane)}`);
  await expectWord(s, emptyPane, 'Open the file here', "a known file over the empty pane's centre");
  await drag(s, 'drop', em2);
  await s.waitFor(`!document.querySelector(${JSON.stringify(`[data-pane-id="${emptyPane}"] .empty-pane`)})`, 'the pane dropped on is no longer empty');
  expect((await s.evalJs(`document.querySelectorAll('.pane').length`)) === 4, 'still four panes, no split for the middle');
  expect(!(await filesOn(s)) && (await overlays(s)) === 0, 'the preview and the drag state are gone');
  expect((await sessionCount(s)) === before + 1, 'still no session started');
  const centerView = await fileViewOf(emptyPane);
  expect(centerView !== null && centerView.view === 'file' && centerView.path === seedFile, `the pane itself opened the file, got ${JSON.stringify(centerView)}`);
  step('a file dropped on the middle of an empty pane opens it there');

  // Back to the two shell panes this block started with.
  await closePaneButton(edgeFilePane);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'the edge file pane closed');
  await closePaneButton(emptyPane);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'the empty pane closed too');
  step('the panes are back to the two shells this block started with');

  // M9 fix 418: a file dropped on a pane's centre focuses that pane, the
  // way a folder dropped there always has. The pane is a fresh empty one
  // and the focus is taken off it by a click on the first shell before
  // the drop, so what the read shows is the drop's doing and not the
  // split's. The pane goes again at the end, back to the two shells.
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3 && !!document.querySelector('.empty-pane')`, 'an empty third pane for the focus read');
  const focusPaneId = (await getLayout(s)).focusedPaneId;
  const firstShell = await centerOf(s, `[data-pane-id=${JSON.stringify(first)}] .term-host`);
  await s.click(firstShell.x, firstShell.y);
  await s.waitFor(focusedPaneIs(first), 'the first shell pane holds the focus, not the empty one');
  const fb = await boxOf(s, focusPaneId);
  const fm = { x: Math.round(fb.x + fb.width / 2), y: Math.round(fb.y + fb.height / 2) };
  await hover(s, fm);
  expect((await zoneOn(s, focusPaneId)) === 'center', `the centre is previewed over the empty pane, got ${await zoneOn(s, focusPaneId)}`);
  await expectWord(s, focusPaneId, 'Open the file here', "a known file over an empty pane's centre");
  await drag(s, 'drop', fm);
  await s.waitFor(`!document.querySelector(${JSON.stringify(`[data-pane-id="${focusPaneId}"] .empty-pane`)})`, 'the pane dropped on took the file');
  await s.waitFor(focusedPaneIs(focusPaneId), 'the centre drop focused the pane it landed on');
  expect((await s.evalJs(`document.querySelectorAll('.pane').length`)) === 3, 'still three panes: a centre drop splits nothing');
  expect((await sessionCount(s)) === before + 1, 'and starts no session');
  await closePaneButton(focusPaneId);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'the file pane closed, the two shells back');
  step("M9 fix 418: a file dropped on a pane's centre focuses that pane, as a folder dropped there does");

  // M9 fix 73: a pane picked up by its title bar. The first pane's title
  // pressed clear of its buttons and moved onto the right band of the
  // second pane previews that half, as a sidebar row would; the release
  // moves the session there, a row split with it second, and the pane it
  // came from is gone (dropSession closes it first). Then a press and a
  // release on a title without any movement is a click: it focuses the
  // pane and nothing else.
  // A spot on the title bar just right of the mark rather than the name's
  // centre: a sliver of a pane gives its name up (M9 fix 237, level 6),
  // and a hidden name's rect is 0 by 0 at the window's corner.
  const titleOf = (paneId) => s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-title').getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 }; })()`);
  const titleDragging = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-title')?.dataset.dragging ?? null`);
  const move = (p) => s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
  const paneOf = (layout, sessionId) => leaves(layout).find((l) => l.sessionId === sessionId) ?? null;
  const parentOf = (node, paneId) => {
    if (node.kind !== 'split') return null;
    if (node.first.id === paneId || node.second.id === paneId) return node;
    return parentOf(node.first, paneId) ?? parentOf(node.second, paneId);
  };
  layout = await getLayout(s);
  const movedSession = leaves(layout).find((l) => l.id === first).sessionId;
  const movedName = await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(first)}] .pane-name').textContent`);
  const panesBefore = await s.evalJs(`document.querySelectorAll('.pane').length`);
  const titleA = await titleOf(first);
  const bb = await boxOf(s, newPane);
  const bRight = { x: Math.round(bb.x + bb.width * 0.9), y: Math.round(bb.y + bb.height / 2) };
  await s.mouse('mousePressed', titleA.x, titleA.y);
  expect(!(await dragOn(s)), 'a press on the title alone is not a drag');
  await move({ x: titleA.x + 10, y: titleA.y });
  await move(bRight);
  expect(await dragOn(s), 'the drag is on once the mouse has moved');
  expect((await s.evalJs(`document.querySelector('.drag-ghost')?.textContent ?? null`)) === movedName, `the ghost names the session, got ${await s.evalJs(`document.querySelector('.drag-ghost')?.textContent ?? null`)}`);
  expect((await titleDragging(first)) !== null, 'the title it came from is marked as dragging');
  expect((await zoneOn(s, newPane)) === 'right', `the right half of the other pane is previewed, got ${await zoneOn(s, newPane)}`);
  expect((await wordOn(s, newPane))?.word === null, `fix 1162: a pane's own drag says nothing, got ${JSON.stringify(await wordOn(s, newPane))}`);
  await s.screenshot('m12-drop-title-preview.png');
  await s.mouse('mouseReleased', bRight.x, bRight.y);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(first)}]') && document.querySelectorAll('.pane').length === ${panesBefore}`, 'the old pane gone and the moved session in a new one');
  layout = await getLayout(s);
  const landed = paneOf(layout, movedSession);
  const holder = landed === null ? null : parentOf(layout.root, landed.id);
  expect(holder !== null && holder.direction === 'row' && holder.first.id === newPane && holder.second.id === landed.id, 'a row split with the other pane first and the moved session second');
  expect(layout.focusedPaneId === landed.id, 'the pane holding the moved session is focused');
  expect(!(await dragOn(s)) && (await overlays(s)) === 0 && !(await s.evalJs(`!!document.querySelector('.drag-ghost')`)), 'the preview, the ghost and the drag state are gone');
  expect((await titleDragging(landed.id)) === null, 'the new title is not marked as dragging');
  await s.screenshot('m12-drop-title.png');
  step('a pane dragged by its title bar onto the right band of another: the half lit up, the drop moved it there and closed the pane it left');

  // The click case: the unfocused pane's title pressed and released in
  // place focuses it and moves nothing.
  const revBefore = layout.revision;
  const titleB = await titleOf(newPane);
  await s.mouse('mousePressed', titleB.x, titleB.y);
  await s.mouse('mouseReleased', titleB.x, titleB.y);
  await s.waitFor(focusedPaneIs(newPane), 'the pressed pane is focused');
  expect(!(await dragOn(s)) && !(await s.evalJs(`!!document.querySelector('.drag-ghost')`)), 'no drag from a press and release in place');
  layout = await getLayout(s);
  expect(paneOf(layout, movedSession)?.id === landed.id && (await s.evalJs(`document.querySelectorAll('.pane').length`)) === panesBefore, 'the panes are as they were');
  step('a press and release on a title bar without movement focuses the pane and nothing else');

  // M9 fix 651: a pane's title or a sidebar row dropped on another layout
  // tab lands at its far right, full height, and one dropped on the +
  // makes a last tab of its own; the window stays on the tab it was on.
  // A title over its own tab lights nothing. The block ends with the
  // panes as it found them: one tab, newPane holding the seed folder's
  // shell, which fix 341 and fix 388 below read.
  const seedShell = dropped.id;
  const sessionsBefore651 = await sessionCount(s);
  const tabPanes = (id) => `.tab-panes[data-tab-id=${JSON.stringify(id)}]`;
  const paneDropLit = () => s.evalJs(`[...document.querySelectorAll('[data-pane-drop]')].map((e) => (e.classList.contains('tab-add') ? 'add' : e.dataset.tabId))`);
  const tabById = (l, id) => l.tabs.find((t) => t.id === id);
  // A page-side wait on the whole layout, the body reading it as l.
  const layoutIs = (body) => `(async () => { const l = (await window.emerald.request('layout.get', {})).layout; return ${body}; })()`;
  const rowCentre = (id) => centerOf(s, `.sidebar-row[data-session-id=${JSON.stringify(id)}]`);

  // (a) A second, empty layout tab, then the first shown again.
  expect(await s.evalJs(`!!document.querySelector('.tab-add')`), 'the + is drawn: this daemon makes tabs');
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab-panes').length === 2`, 'a second layout tab');
  let tabs651 = await getTabs(s);
  const tab1 = tabs651.tabs[0].id;
  const tab2 = tabs651.tabs[1].id;
  await s.evalJs(`document.querySelector(${JSON.stringify(tabPanes(tab1))}).click()`);
  await s.waitFor(layoutIs(`l.currentTabId === ${JSON.stringify(tab1)}`), 'the first tab shown again');
  await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(landed.id)}] .pane-title')`, 'the first tab painted');
  step('fix 651: a second, empty layout tab made and the first shown again');

  // (b) A title over its own tab: nothing lit, nothing changed. The
  // press focuses its pane first (the pane's capture handler), a layout
  // edit of its own, so the revision is read once that has landed.
  let from = await titleOf(landed.id);
  let over = await centerOf(s, tabPanes(tab1));
  await s.mouse('mousePressed', from.x, from.y);
  await s.waitFor(focusedPaneIs(landed.id), 'the pressed pane focused');
  const rev651 = (await getTabs(s)).revision;
  await move({ x: from.x + 10, y: from.y });
  await move(over);
  expect(await dragOn(s), 'the drag is on over its own tab');
  expect(JSON.stringify(await paneDropLit()) === '[]', `nothing is lit over its own tab, got ${JSON.stringify(await paneDropLit())}`);
  expect((await overlays(s)) === 0, 'no pane overlay over the strip');
  await s.mouse('mouseReleased', over.x, over.y);
  await sleep(500);
  expect((await getTabs(s)).revision === rev651, 'the layout did not change');
  expect((await s.evalJs(`document.querySelectorAll('.layout-tab:not([hidden]) .pane').length`)) === 2, 'still two panes on the tab on show');
  step('fix 651: a title over its own layout tab lights nothing and the drop changes nothing');

  // (b2) M9 fix 1044: the moved session plays Claude (one SessionStart to
  // the sink, in the record's own folder so the + tab's name below reads as
  // before), and its pane goes to 16 px, onto the chat face, in Thinking.
  {
    const daemon1044 = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
    const rec1044 = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === movedSession);
    const res1044 = await fetch(`http://127.0.0.1:${daemon1044.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon1044.hookToken, 'X-Emerald-Session': movedSession },
      body: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'sim-m12-1044', cwd: rec1044.groupCwd }),
    });
    expect(res1044.status === 204, `fix 1044: the sink answered the SessionStart with 204, got ${res1044.status}`);
    const sel1044 = `[data-pane-id=${JSON.stringify(landed.id)}]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(`${sel1044} .pane-face-toggle`)})`, 'fix 1044: the face button on the moved session\'s pane');
    for (let i = 0; i < 2; i++) {
      await s.evalJs(`document.querySelector(${JSON.stringify(`${sel1044} .term-host`)}).dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }))`);
    }
    await s.waitFor(`JSON.parse(localStorage.getItem('emerald.fontSizes') ?? '{}')[${JSON.stringify(landed.id)}] === 16`, 'fix 1044: the pane at 16 px');
    await s.evalJs(`document.querySelector(${JSON.stringify(`${sel1044} .pane-face-toggle`)}).click()`);
    await s.waitFor(`document.querySelector(${JSON.stringify(sel1044)})?.dataset.face === 'chat'`, 'fix 1044: the pane on its chat face');
    await s.waitFor(`!!document.querySelector(${JSON.stringify(`${sel1044} .chat-box`)})`, 'fix 1044: the chat box drawn');
    await s.evalJs(`document.querySelector(${JSON.stringify(`${sel1044} .chat-box`)}).focus()`);
    await s.key('o', 'KeyO', 79, CTRL);
    await s.waitFor(`document.querySelector(${JSON.stringify(`${sel1044} .chat-view`)})?.dataset.chatView === 'thinking'`, 'fix 1044: the chat view in Thinking');
  }
  step('fix 1044: the moved session\'s pane at 16 px on the chat face in Thinking');

  // (c) A title dropped on the +: a last tab holding that session alone.
  const headingOf = (id) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]').closest('.sidebar-group').querySelector('.sidebar-group-name').textContent`);
  const freeName = (names, name) => {
    if (!names.includes(name)) return name;
    for (let n = 2; ; n++) if (!names.includes(`${name} ${n}`)) return `${name} ${n}`;
  };
  const expectName = freeName((await getTabs(s)).tabs.map((t) => t.name), await headingOf(movedSession));
  from = await titleOf(landed.id);
  over = await centerOf(s, '.tab-add');
  await s.mouse('mousePressed', from.x, from.y);
  await move({ x: from.x + 10, y: from.y });
  await move(over);
  expect(await s.evalJs(`!!document.querySelector('.tab-add[data-pane-drop]')`), 'the + is lit');
  expect(JSON.stringify(await paneDropLit()) === '["add"]', `the + alone is lit, got ${JSON.stringify(await paneDropLit())}`);
  expect((await overlays(s)) === 0, 'no pane overlay over the +');
  expect(await s.evalJs(`getComputedStyle(document.querySelector('.tab-add')).boxShadow !== 'none'`), 'the + draws its ring');
  await s.screenshot('fix-651-drop-add.png');
  await s.mouse('mouseReleased', over.x, over.y);
  await s.waitFor(`document.querySelectorAll('.tab-panes').length === 3`, 'a third layout tab');
  await s.waitFor(layoutIs(`l.tabs.length === 3 && l.tabs[2].root.kind === 'pane' && l.tabs[2].root.sessionId === ${JSON.stringify(movedSession)}`), 'the new tab holds the moved session');
  tabs651 = await getTabs(s);
  const tab3 = tabs651.tabs[2].id;
  expect(tabs651.currentTabId === tab1, 'the window is still on the first tab');
  expect(tabById(tabs651, tab3).name === expectName, `the new tab is named ${expectName}, got ${tabById(tabs651, tab3).name}`);
  const t1root = tabById(tabs651, tab1).root;
  expect(t1root.kind === 'pane' && t1root.id === newPane, `the first tab holds newPane alone, got ${JSON.stringify(t1root)}`);
  expect(await s.evalJs(`(() => { const all = document.querySelectorAll('.tab-strip-scroll .tab'); return all[all.length - 1]?.dataset.tabId === ${JSON.stringify(tab3)}; })()`), 'the new tab is last on the strip');
  expect(await s.evalJs(`document.querySelector('.tab-strip-clip').nextElementSibling?.classList.contains('tab-add') === true`), 'the + is still after the strip');
  expect(JSON.stringify(await paneDropLit()) === '[]' && !(await dragOn(s)) && !(await s.evalJs(`!!document.querySelector('.drag-ghost')`)), 'nothing lit, no ghost, the drag off');
  step('fix 651: a title dropped on the + makes a last tab holding that session alone, the pane it left closed, the window still on its tab');

  // (d) A row dropped on a tab holding one empty pane fills that pane.
  const t2pane = tabById(tabs651, tab2).root.id;
  from = await rowCentre(movedSession);
  over = await centerOf(s, tabPanes(tab2));
  await s.mouse('mousePressed', from.x, from.y);
  await move({ x: from.x + 10, y: from.y });
  await move(over);
  expect(JSON.stringify(await paneDropLit()) === JSON.stringify([tab2]), `the second tab alone is lit, got ${JSON.stringify(await paneDropLit())}`);
  await s.mouse('mouseReleased', over.x, over.y);
  await s.waitFor(layoutIs(`l.tabs.find((t) => t.id === ${JSON.stringify(tab2)}).root.sessionId === ${JSON.stringify(movedSession)}`), 'the second tab holds the session');
  tabs651 = await getTabs(s);
  const t2root = tabById(tabs651, tab2).root;
  expect(t2root.kind === 'pane' && t2root.id === t2pane, 'the empty pane was filled, its id kept');
  expect(tabById(tabs651, tab1).root.id === newPane && tabById(tabs651, tab1).root.sessionId === seedShell, 'the first tab unchanged');
  expect(tabById(tabs651, tab3).root.sessionId === movedSession, 'the third tab unchanged');
  expect(tabs651.currentTabId === tab1, 'the window is still on the first tab');
  step('fix 651: a sidebar row dropped on a layout tab with one empty pane fills that pane, a mirror, the window still on its tab');

  // (e) A title onto a tab with a pane, its own tab's last pane leaving.
  from = await titleOf(newPane);
  over = await centerOf(s, tabPanes(tab2));
  await s.mouse('mousePressed', from.x, from.y);
  await move({ x: from.x + 10, y: from.y });
  await move(over);
  await s.mouse('mouseReleased', over.x, over.y);
  await s.waitFor(layoutIs(`l.tabs.find((t) => t.id === ${JSON.stringify(tab2)}).root.kind === 'split'`), 'the second tab split');
  tabs651 = await getTabs(s);
  const t2split = tabById(tabs651, tab2);
  expect(
    t2split.root.direction === 'row' && t2split.root.ratio === 0.5 && t2split.root.first.sessionId === movedSession && t2split.root.second.sessionId === seedShell,
    `a row split, the session first and the dropped shell second at 0.5, got ${JSON.stringify(t2split.root)}`,
  );
  expect(t2split.focusedPaneId === t2split.root.second.id, 'the new pane is focused on that tab');
  const t1after = tabById(tabs651, tab1).root;
  expect(t1after.kind === 'pane' && t1after.id === newPane && t1after.sessionId === null, `the first tab keeps newPane, empty, got ${JSON.stringify(t1after)}`);
  expect(tabs651.tabs.length === 3 && tabs651.currentTabId === tab1, 'three tabs still, the window on the first');
  step('fix 651: a title dropped on a layout tab lands at its far right, full height, and the last pane of its own tab becomes an empty pane');

  // (e2) M9 fix 1044: the + landed the moved session on its chat face; a
  // drag of that pane's title onto another layout tab keeps all three.
  {
    const faceRead = (paneId) => s.evalJs(`(() => { const p = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]'); return { face: p?.dataset.face ?? null, view: p?.querySelector('.chat-view')?.dataset.chatView ?? null, size: JSON.parse(localStorage.getItem('emerald.fontSizes') ?? '{}')[${JSON.stringify(paneId)}] ?? null }; })()`);
    const want = JSON.stringify({ face: 'chat', view: 'thinking', size: 16 });
    await s.evalJs(`document.querySelector(${JSON.stringify(tabPanes(tab3))}).click()`);
    await s.waitFor(layoutIs(`l.currentTabId === ${JSON.stringify(tab3)}`), 'fix 1044: the third tab shown');
    const pane3 = tabById(await getTabs(s), tab3).root.id;
    await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(pane3)}] .pane-title')`, 'fix 1044: the third tab painted');
    const onPlus = await faceRead(pane3);
    expect(JSON.stringify(onPlus) === want, `fix 1044: the + landed the pane on its chat face in Thinking at 16 px, got ${JSON.stringify(onPlus)}`);
    from = await titleOf(pane3);
    over = await centerOf(s, tabPanes(tab2));
    await s.mouse('mousePressed', from.x, from.y);
    await move({ x: from.x + 10, y: from.y });
    await move(over);
    await s.mouse('mouseReleased', over.x, over.y);
    await s.waitFor(layoutIs(`(() => { const n = (x) => (x.kind === 'pane' ? 1 : n(x.first) + n(x.second)); return n(l.tabs.find((t) => t.id === ${JSON.stringify(tab2)}).root) === 3; })()`), 'fix 1044: the second tab holds three panes');
    const t2three = tabById(await getTabs(s), tab2);
    const dropLanded = t2three.focusedPaneId;
    await s.evalJs(`document.querySelector(${JSON.stringify(tabPanes(tab2))}).click()`);
    await s.waitFor(layoutIs(`l.currentTabId === ${JSON.stringify(tab2)}`), 'fix 1044: the second tab shown');
    await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(dropLanded)}] .pane-title')`, 'fix 1044: the second tab painted');
    const onDrop = await faceRead(dropLanded);
    expect(JSON.stringify(onDrop) === want, `fix 1044: the drop on a layout tab kept the chat face, Thinking and 16 px, got ${JSON.stringify(onDrop)}`);
    const mirror = await faceRead(t2split.root.first.id);
    expect(mirror.face === null, `fix 1044: the row's mirror stays on the terminal, got ${JSON.stringify(mirror)}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(tabPanes(tab1))}).click()`);
    await s.waitFor(layoutIs(`l.currentTabId === ${JSON.stringify(tab1)}`), 'fix 1044: the first tab shown again');
  }
  step('fix 1044: the + and a drop on another layout tab both land the pane on its chat face, its mode and its size kept; the row\'s mirror stays on the terminal');

  // (f) Back to the state fix 341 expects.
  await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(newPane)}] .empty-pane')`, 'newPane drawn empty');
  from = await rowCentre(seedShell);
  over = await centerOf(s, `[data-pane-id=${JSON.stringify(newPane)}]`);
  await s.mouse('mousePressed', from.x, from.y);
  await move({ x: from.x + 10, y: from.y });
  await move(over);
  expect((await zoneOn(s, newPane)) === 'center', `the centre of newPane is previewed, got ${await zoneOn(s, newPane)}`);
  await s.mouse('mouseReleased', over.x, over.y);
  await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(newPane)}] .term-host')`, 'newPane holds a terminal again');
  expect(leaves(await getLayout(s)).find((l) => l.id === newPane)?.sessionId === seedShell, 'newPane holds the seed folder shell');
  await s.evalJs(`document.querySelector(${JSON.stringify(`${tabPanes(tab3)} .tab-close`)}).click()`);
  await s.waitFor(`document.querySelectorAll('.tab-panes').length === 2`, 'the third tab closed');
  await s.evalJs(`document.querySelector(${JSON.stringify(`${tabPanes(tab2)} .tab-close`)}).click()`);
  await s.waitFor(`document.querySelectorAll('.tab-panes').length === 1`, 'the second tab closed');
  expect((await sessionCount(s)) === sessionsBefore651, 'no session started or lost');
  step('fix 651: the panes back to one tab with the seed folder\'s shell in newPane');

  // M9 fix 341: the seeded file dropped on the tab strip opens as a
  // pinned tab (a hover lights the strip, and a drop on it with nothing
  // lit from a pane still opens), and the folder dropped there does
  // nothing. The strip alone opens a file: the Files rail moves or copies
  // instead (fix 953's block below). The rail is opened first when the
  // profile has it collapsed.
  expect((await setDropFile(s, seedFile)) === seedFile, 'the File to drop is the seeded file again');
  if (!(await s.evalJs(`!!document.querySelector('.files-rail')`))) {
    await s.key('F', 'KeyF', 70, CTRL | SHIFT);
    await s.waitFor(`!!document.querySelector('.files-rail')`, 'the files rail open');
  }
  const litOutside = () => s.evalJs(`[...document.querySelectorAll('[data-drop-target]')].map((e) => e.className.split(' ')[0])`);
  const fileTabs = () => s.evalJs(`[...document.querySelectorAll('.tab-file')].map((t) => ({ path: t.dataset.path ?? t.title ?? null, preview: t.dataset.preview !== undefined, active: t.dataset.active !== undefined }))`);
  await usage727.on();
  for (const sel of ['.tab-strip']) {
    const spot = await centerOf(s, sel);
    await hover(s, spot);
    expect((await filesOn(s)) && (await overlays(s)) === 0, `a file over ${sel} is a drag with no pane overlay`);
    expect(JSON.stringify(await litOutside()) === JSON.stringify([sel.slice(1)]), `${sel} is lit for the file, got ${JSON.stringify(await litOutside())}`);
    await drag(s, 'drop', spot);
    await s.waitFor(`document.querySelectorAll('.tab-file').length === 1 && document.querySelector('.tab-file[data-active]') !== null && !document.querySelector('.tab-file[data-preview]')`, `the drop on ${sel} opened the file as a pinned, active tab`, 5000);
    expect(JSON.stringify(await litOutside()) === '[]' && !(await filesOn(s)), `${sel} is unlit and the drag over after the drop`);
    const opened = await fileTabs();
    expect(opened.length === 1 && !opened[0].preview && opened[0].active, `one pinned active file tab, got ${JSON.stringify(opened)}`);
    const want727 = 1;
    const tabDrops727 = (await usage727.actions('drop-file-tab', want727)).filter((l) => l.from === 'click');
    expect(tabDrops727.length === want727, `${want727} drop-file-tab from a click after the ${sel} drop, got ${tabDrops727.length}`);
    expect(await s.evalJs(`document.querySelector('.tab-file .tab-name')?.textContent === ${JSON.stringify(path.basename(seedFile))}`), 'the tab is named for the file');
    await s.key('w', 'KeyW', 87, CTRL);
    await s.waitFor(`document.querySelectorAll('.tab-file').length === 0`, `Ctrl+W closed the tab after the ${sel} drop`);
  }
  await s.screenshot('fix-341-drop-strip.png');

  // M9 fix 388: a file whose extension Windows has no registered type
  // for reads as unknown, the same as a folder, until the drop stats
  // it. The preview lights what either would take: a zone over a pane
  // (not the whole-pane file light a typed file gets), and the strip
  // too, since it might still be a file; the drop opens it exactly as
  // a typed file would.
  expect((await setDropFile(s, seedUnknown)) === seedUnknown, 'the File to drop is the untyped file');
  const boxNewPane = await boxOf(s, newPane);
  const centerNewPane = { x: Math.round(boxNewPane.x + boxNewPane.width / 2), y: Math.round(boxNewPane.y + boxNewPane.height / 2) };
  await hover(s, centerNewPane);
  expect((await zoneOn(s, newPane)) === 'center', `an untyped file previews a zone over a shell pane, got ${await zoneOn(s, newPane)}`);
  await expectWord(s, newPane, 'Open here, or type the path', "an untyped file over the shell's centre");
  const stripSpotUnknown = await centerOf(s, '.tab-strip');
  await hover(s, stripSpotUnknown);
  expect(JSON.stringify(await litOutside()) === JSON.stringify(['tab-strip']), `the strip lights for the untyped file too, got ${JSON.stringify(await litOutside())}`);
  await drag(s, 'drop', stripSpotUnknown);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === 1 && document.querySelector('.tab-file[data-active]') !== null`, 'the untyped file opened as a pinned tab');
  expect(await s.evalJs(`document.querySelector('.tab-file .tab-name')?.textContent === ${JSON.stringify(path.basename(seedUnknown))}`), 'the tab is named for the untyped file');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === 0`, 'Ctrl+W closed the tab');
  step('fix 388: a file with no registered type previews a zone over a pane and lights the strip too, and the drop opens it like any other file');

  // The folder on the strip: it lights too now (fix 388, it might be a
  // file), but the drop still opens nothing.
  expect((await setDropFile(s, seed)) === seed, 'the File to drop is the folder again');
  const stripSpot = await centerOf(s, '.tab-strip');
  await hover(s, stripSpot);
  expect(JSON.stringify(await litOutside()) === JSON.stringify(['tab-strip']), `a folder over the strip lights it too, got ${JSON.stringify(await litOutside())}`);
  await drag(s, 'drop', stripSpot);
  await sleep(800);
  expect((await s.evalJs(`document.querySelectorAll('.tab-file').length`)) === 0 && (await sessionCount(s)) === before + 1, 'a folder dropped on the strip opens no tab and starts no session');
  const tabDrops727 = (await usage727.actions('drop-file-tab', 2)).filter((l) => l.from === 'click');
  expect(tabDrops727.length === 2, `two drop-file-tab in all (the strip, the untyped file), the folder added none, got ${tabDrops727.length}`);
  await usage727.off();
  step('fix 341: a file dropped on the tab strip opens as a pinned tab, lit on the way in; a folder there lights it too but opens nothing');

  // M9 fix 953: a drop from Explorer on the Files rail moves or copies
  // into the folder under the mouse, Explorer's way: the folder's row lit
  // on the way in (the list for the rail's own folder), a move on the same
  // drive, Ctrl a copy, a name already there asked once for the drop, and
  // what was open following a moved file. The source folder is on the
  // seed's drive, so auto moves; a move across drives and the effect a
  // real drag shows are read at the install.
  fs.rmSync(path.join(process.env['EMERALD_HOME'], 'trash'), { recursive: true, force: true });
  fs.rmSync(src953Short, { recursive: true, force: true });
  fs.mkdirSync(path.join(src953Short, 'dir953'), { recursive: true });
  const src953 = fs.realpathSync.native(src953Short);
  const a953 = path.join(src953, 'a953.txt');
  const b953 = path.join(src953, 'b953.txt');
  const c953 = path.join(src953, 'c953.txt');
  const clash953 = path.join(src953, 'clash953.txt');
  const clash953b = path.join(src953, 'clash953b.txt');
  const dir953 = path.join(src953, 'dir953');
  fs.writeFileSync(a953, 'a');
  fs.writeFileSync(b953, 'b');
  fs.writeFileSync(c953, 'c');
  fs.writeFileSync(clash953, 'new');
  fs.writeFileSync(clash953b, 'new b');
  fs.writeFileSync(path.join(dir953, 'inner.txt'), 'inner');
  const into953 = path.join(seed, 'into953');
  fs.mkdirSync(into953, { recursive: true });
  fs.writeFileSync(path.join(into953, 'clash953.txt'), 'old');
  fs.writeFileSync(path.join(into953, 'clash953b.txt'), 'old b');
  const moveEffect953 = 'copy'; // files-drop-model.ts, fix 953's reading (none taken, the safe copy)
  const read953 = (p) => {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  };
  const rowSel953 = (p) => `.files-list .files-row[data-path=${JSON.stringify(p)}]`;
  const lit953 = () => s.evalJs(`[...document.querySelectorAll('[data-drop-into]')].map((e) => e.dataset.path ?? 'list')`);
  const drop953 = () => s.evalJs(`({ dir: document.querySelector('.files-list')?.dataset.dropDir ?? null, effect: document.querySelector('.files-list')?.dataset.dropEffect ?? null })`);
  const note953 = async () => (await s.evalJs(`document.querySelector('.corner-note')?.textContent ?? ''`)) ?? '';
  const noteIs953 = (text, what) => s.waitFor(`document.querySelector('.corner-note')?.textContent === ${JSON.stringify(text)}`, what, 5000);
  const blank953 = async () => {
    const p = await s.evalJs(`(() => { const r = document.querySelector('.files-list').getBoundingClientRect(); const x = r.x + r.width / 2; const y = r.bottom - 6; return { x, y, row: document.elementFromPoint(x, y)?.closest('.files-row') != null, list: document.elementFromPoint(x, y)?.closest('.files-list') != null }; })()`);
    expect(!p.row && p.list, `the blank under the rows is on the list and on no row, got ${JSON.stringify(p)}`);
    return { x: p.x, y: p.y };
  };
  const waitDisk953 = async (test, what, ms = 5000) => {
    const until = Date.now() + ms;
    while (!test()) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
      await sleep(100);
    }
  };

  // (a) The light and the effect while a drag hovers.
  const term953 = await centerOf(s, `[data-pane-id=${JSON.stringify(newPane)}] .term-host`);
  await s.click(term953.x, term953.y);
  await s.waitFor(
    `document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)} && document.querySelector(${JSON.stringify(rowSel953(into953))})?.dataset.kind === 'dir'`,
    'the rail on the seed folder with into953 in it',
    5000,
  );
  await setDropFiles(s, [a953]);
  const into953Spot = await centerOf(s, rowSel953(into953));
  await hover(s, into953Spot);
  expect(JSON.stringify(await lit953()) === JSON.stringify([into953]), `into953's row is lit, got ${JSON.stringify(await lit953())}`);
  let d953 = await drop953();
  expect(d953.dir === into953 && d953.effect === moveEffect953, `the drop would land in into953 with ${moveEffect953}, got ${JSON.stringify(d953)}`);
  expect((await overlays(s)) === 0 && (await s.evalJs(`document.querySelectorAll('[data-drop-target]').length`)) === 0, 'no pane overlay and no strip or rail lit whole');
  await hover(s, into953Spot, { ctrl: true });
  d953 = await drop953();
  expect(d953.effect === 'copy', `Ctrl over the rail answers copy, got ${JSON.stringify(d953)}`);
  await hover(s, await centerOf(s, rowSel953(seedFile)));
  d953 = await drop953();
  expect(JSON.stringify(await lit953()) === JSON.stringify(['list']) && d953.dir === seed, `a file row at the root lights the list for the seed, got ${JSON.stringify(await lit953())} ${JSON.stringify(d953)}`);
  await drag(s, 'dragleave', await blank953());
  d953 = await drop953();
  expect(JSON.stringify(await lit953()) === '[]' && d953.dir === null && d953.effect === null, `the light is gone after the drag left, got ${JSON.stringify(await lit953())} ${JSON.stringify(d953)}`);
  step('fix 953: a drag from Explorer over the Files rail lights the folder it would land in, a folder row itself and a file row its folder, the list for the root, and the effect follows Ctrl');

  // M9 fix 1152: the word on the lit folder for a drag from Explorer, whose
  // paths are unreadable until the drop: the rule with no key, the plain
  // word with one, and the OS effect left at the safe copy.
  {
    const word1152 = (sel) => s.evalJs(`document.querySelector(${JSON.stringify(sel)})?.dataset.dropWord ?? null`);
    await setDropFiles(s, [a953]);
    await hover(s, into953Spot);
    let w1152 = await word1152('[data-drop-into]');
    d953 = await drop953();
    expect(w1152 === 'Ctrl copies, Shift moves' && d953.effect === 'copy', `no key says the rule with the effect copy, got ${w1152} ${JSON.stringify(d953)}`);
    await hover(s, into953Spot, { ctrl: true });
    w1152 = await word1152('[data-drop-into]');
    expect(w1152 === 'Copy here', `Ctrl says Copy here, got ${w1152}`);
    await hover(s, into953Spot, { shift: true });
    w1152 = await word1152('[data-drop-into]');
    d953 = await drop953();
    expect(w1152 === 'Move here' && d953.effect === 'copy', `Shift says Move here with the effect still copy, got ${w1152} ${JSON.stringify(d953)}`);
    await hover(s, await centerOf(s, rowSel953(seedFile)));
    const lit1152 = await lit953();
    w1152 = await word1152('.files-list');
    expect(JSON.stringify(lit1152) === JSON.stringify(['list']) && w1152 === 'Ctrl copies, Shift moves', `the lit list says the rule, got ${JSON.stringify(lit1152)} ${w1152}`);
    await s.screenshot('m12-drop-word-1152.png');
    await drag(s, 'dragleave', await blank953());
    const left1152 = await s.evalJs(`document.querySelectorAll('[data-drop-word]').length`);
    expect(left1152 === 0, `no word is left after the drag left, got ${left1152}`);
    step('fix 1152: a drag from Explorer over the Files rail shows the rule Ctrl copies, Shift moves, Copy here with Ctrl and Move here with Shift, the OS effect still copy');
  }

  // (b) Two entries onto a folder row.
  await setDropFiles(s, [a953, dir953]);
  await hover(s, into953Spot);
  await drag(s, 'drop', into953Spot);
  await waitDisk953(
    () => read953(path.join(into953, 'a953.txt')) === 'a' && read953(path.join(into953, 'dir953', 'inner.txt')) === 'inner' && !fs.existsSync(a953) && !fs.existsSync(dir953),
    'a953.txt and dir953 moved into into953',
  );
  await noteIs953('Moved 2 items into into953', 'the note says two items moved');
  await s.waitFor(
    `document.querySelector(${JSON.stringify(rowSel953(into953))})?.dataset.expanded === 'true' && !!document.querySelector(${JSON.stringify(rowSel953(path.join(into953, 'dir953')))}) && document.querySelector(${JSON.stringify(rowSel953(path.join(into953, 'a953.txt')))})?.dataset.selected === 'true'`,
    'into953 open on the moved entries, a953.txt selected',
    5000,
  );
  const mainLog953 = fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8');
  expect(mainLog953.includes(`files-move into ${into953} (auto): a953.txt moved, dir953 moved`), 'main.log has the move line');
  expect(JSON.stringify(await lit953()) === '[]', `nothing lit after the drop, got ${JSON.stringify(await lit953())}`);
  step('fix 953: two entries dropped on a folder row move into it on the same drive, the tree opens on them and the note says so');

  // (c) A file open in a tab, dropped on the blank under the rows: the
  // tab follows it.
  await setDropFiles(s, [b953]);
  const strip953 = await centerOf(s, '.tab-strip');
  await hover(s, strip953);
  await drag(s, 'drop', strip953);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(`.tab-file[data-tab=${JSON.stringify(b953)}][data-active]`)}) && !document.querySelector('.tab-file[data-preview]')`, 'b953.txt open as a pinned, active tab', 5000);
  const panesTab953 = await centerOf(s, '.tab-panes');
  await s.click(panesTab953.x, panesTab953.y);
  await s.waitFor(
    `document.querySelector('.tab-strip')?.dataset.activeTab === 'panes' && document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)}`,
    'the panes in front and the rail on the seed again',
    5000,
  );
  const blankSpot953 = await blank953();
  await hover(s, blankSpot953);
  await drag(s, 'drop', blankSpot953);
  const seedB953 = path.join(seed, 'b953.txt');
  await waitDisk953(() => read953(seedB953) === 'b' && !fs.existsSync(b953), 'b953.txt moved into the seed');
  await noteIs953(`Moved b953.txt into ${path.basename(seed)}`, 'the note says b953.txt moved');
  await s.waitFor(
    `!!document.querySelector(${JSON.stringify(`.tab-file[data-tab=${JSON.stringify(seedB953)}]`)}) && !document.querySelector(${JSON.stringify(`.tab-file[data-tab=${JSON.stringify(seedB953)}][data-preview]`)}) && !document.querySelector(${JSON.stringify(`.tab-file[data-tab=${JSON.stringify(b953)}]`)})`,
    'the tab follows b953.txt into the seed, still pinned',
    5000,
  );
  const tabSpot953 = await centerOf(s, `.tab-file[data-tab=${JSON.stringify(seedB953)}]`);
  await s.click(tabSpot953.x, tabSpot953.y);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === 0`, 'Ctrl+W closed the moved file\'s tab', 5000);
  step('fix 953: a file dropped on the blank under the rows moves into the rail\'s folder, and its open tab follows it, still pinned');

  // (d) A name already in the folder.
  const buttons953 = () => s.evalJs(`[...document.querySelectorAll('.move-clash-dialog .dialog-actions button')].map((b) => b.textContent)`);
  await setDropFiles(s, [clash953]);
  await hover(s, into953Spot);
  await drag(s, 'drop', into953Spot);
  await s.waitFor(`!!document.querySelector('.move-clash-dialog')`, 'the clash dialog', 5000);
  const ask953 = await s.evalJs(
    `({ title: document.querySelector('.move-clash-dialog .dialog-title')?.textContent ?? null, rows: document.querySelectorAll('.move-clash-row').length, row: !!document.querySelector('.move-clash-row[data-name="clash953.txt"]'), focus: document.activeElement?.dataset.choice ?? null })`,
  );
  expect(ask953.title === 'Replace clash953.txt in into953?' && ask953.rows === 1 && ask953.row && ask953.focus === 'skip', `one clash asked about, Skip focused, got ${JSON.stringify(ask953)}`);
  expect(JSON.stringify(await buttons953()) === JSON.stringify(['Replace', 'Skip', 'Cancel']), `the buttons for one, got ${JSON.stringify(await buttons953())}`);
  await s.evalJs(`document.querySelector('.move-clash-dialog [data-choice="skip"]').click()`);
  await s.waitFor(`!document.querySelector('.move-clash-dialog')`, 'the dialog gone after Skip', 3000);
  await noteIs953('Skipped clash953.txt: already in into953', 'the note says it was skipped');
  expect(read953(path.join(into953, 'clash953.txt')) === 'old' && fs.existsSync(clash953), 'Skip left both files where they were');
  await setDropFiles(s, [clash953, clash953b]);
  await hover(s, into953Spot);
  await drag(s, 'drop', into953Spot);
  await s.waitFor(`document.querySelector('.move-clash-dialog')?.dataset.count === '2'`, 'the clash dialog for two', 5000);
  const ask953b = await s.evalJs(`({ title: document.querySelector('.move-clash-dialog .dialog-title')?.textContent ?? null, rows: document.querySelectorAll('.move-clash-row').length })`);
  expect(ask953b.title === '2 names are already in into953' && ask953b.rows === 2, `two clashes asked about, got ${JSON.stringify(ask953b)}`);
  expect(JSON.stringify(await buttons953()) === JSON.stringify(['Replace all', 'Skip all', 'Cancel']), `the buttons for several, got ${JSON.stringify(await buttons953())}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.move-clash-dialog')`, 'the dialog gone after Escape', 3000);
  await sleep(500);
  expect(
    read953(path.join(into953, 'clash953.txt')) === 'old' && read953(path.join(into953, 'clash953b.txt')) === 'old b' && fs.existsSync(clash953) && fs.existsSync(clash953b),
    'Escape cancelled the whole drop',
  );
  await setDropFiles(s, [clash953]);
  await hover(s, into953Spot);
  await drag(s, 'drop', into953Spot);
  await s.waitFor(`!!document.querySelector('.move-clash-dialog')`, 'the clash dialog again', 5000);
  await s.evalJs(`document.querySelector('.move-clash-dialog [data-choice="replace"]').click()`);
  const trashed953 = path.join(process.env['EMERALD_HOME'], 'trash', '1-clash953.txt');
  await waitDisk953(() => read953(path.join(into953, 'clash953.txt')) === 'new' && !fs.existsSync(clash953) && read953(trashed953) === 'old', 'the new clash953.txt in, the old one in the trash');
  await noteIs953('Moved clash953.txt into into953', 'the note says the replace moved it');
  step('fix 953: a name already in the folder asks once for the drop: Skip leaves it, Escape cancels the whole drop, Replace sends what was there to the recycle bin and moves the new one in');

  // (e) Ctrl copies; a file already there and a folder onto itself.
  await setDropFiles(s, [c953]);
  await hover(s, into953Spot, { ctrl: true });
  expect((await drop953()).effect === 'copy', 'Ctrl shows copy');
  await drag(s, 'drop', into953Spot, { ctrl: true });
  await waitDisk953(() => read953(path.join(into953, 'c953.txt')) === 'c' && fs.existsSync(c953), 'c953.txt copied, its source kept');
  await noteIs953('Copied c953.txt into into953', 'the note says it was copied');
  await setDropFiles(s, [seedFile]);
  const blankSpot953e = await blank953();
  await hover(s, blankSpot953e);
  await drag(s, 'drop', blankSpot953e);
  await noteIs953(`Already in ${path.basename(seed)}`, 'the note says the file is already there');
  expect(fs.existsSync(seedFile), 'the seed file stays put');
  await setDropFiles(s, [into953]);
  const into953Again = await centerOf(s, rowSel953(into953));
  await hover(s, into953Again);
  await drag(s, 'drop', into953Again);
  await noteIs953('into953 could not go: A folder cannot go into itself', 'the note says a folder cannot go into itself');
  expect(fs.existsSync(into953), 'into953 still there');
  expect(
    JSON.stringify(await lit953()) === '[]' &&
      (await s.evalJs(`document.querySelectorAll('[data-drop-target]').length`)) === 0 &&
      (await s.evalJs(`document.querySelectorAll('.tab-file').length`)) === 0 &&
      !(await s.evalJs(`!!document.querySelector('.move-clash-dialog')`)),
    `the block ends unlit with no file tab and no dialog, note ${await note953()}`,
  );
  step('fix 953: Ctrl copies, a file already in the folder stays put, and a folder dropped on itself is refused');

  // M9 fix 983: a folder held under a drag opens after 600 ms. The rail is
  // on `seed` with into953 open and nothing lit; the folders are made on
  // disk, so the watch on the root lists them.
  const still983 = path.join(seed, 'still983');
  const spring983 = path.join(seed, 'spring983');
  const inner983 = path.join(spring983, 'inner983');
  const a983 = path.join(src953, 'a983.txt');
  fs.mkdirSync(still983, { recursive: true });
  fs.mkdirSync(inner983, { recursive: true });
  fs.writeFileSync(a983, 'a983');
  const open983 = (p) => s.evalJs(`document.querySelector(${JSON.stringify(rowSel953(p))})?.dataset.expanded ?? null`);
  await s.waitFor(
    `${JSON.stringify([still983, spring983].map(rowSel953))}.every((sel) => document.querySelector(sel)?.dataset.kind === 'dir')`,
    'the rows for still983 and spring983',
    5000,
  );
  expect((await open983(still983)) === null && (await open983(spring983)) === null, 'both folders start closed');
  await setDropFiles(s, [a983]);
  // (a) Cancelled by a move.
  await hover(s, await centerOf(s, rowSel953(still983)));
  await hover(s, await centerOf(s, rowSel953(seedFile)));
  await sleep(900);
  expect((await open983(still983)) === null, 'a drag moved off still983 within 600 ms leaves it closed');
  await drag(s, 'dragleave', await centerOf(s, rowSel953(seedFile)));
  // (b) Opened by a hold.
  const spot983 = await centerOf(s, rowSel953(spring983));
  const t983 = Date.now();
  await hover(s, spot983);
  let closedReads983 = 0;
  let openAt983 = -1;
  while (Date.now() - t983 < 3000) {
    const v = await open983(spring983);
    const at = Date.now() - t983;
    if (v === 'true') {
      openAt983 = at;
      break;
    }
    closedReads983++;
    await drag(s, 'dragover', spot983);
    await sleep(150);
  }
  expect(closedReads983 >= 1 && openAt983 >= 600, `spring983 read closed first and opened no earlier than 600 ms, got ${closedReads983} closed reads, open at ${openAt983}`);
  // (c) Left open, dropped into the child.
  await drag(s, 'dragleave', spot983);
  await sleep(300);
  expect((await open983(spring983)) === 'true', 'spring983 stays open after the drag leaves');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel953(inner983))})`, 'the row for inner983', 5000);
  const innerSpot983 = await centerOf(s, rowSel953(inner983));
  await hover(s, innerSpot983);
  await drag(s, 'drop', innerSpot983);
  await waitDisk953(() => read953(path.join(inner983, 'a983.txt')) === 'a983' && !fs.existsSync(a983), 'a983.txt moved into inner983');
  await noteIs953('Moved a983.txt into inner983', 'the note says a983.txt moved into inner983');
  step('fix 983: a folder held under a drag opens after 600 ms, not before, not once the drag moves off it, stays open after the drag leaves, and takes a drop into its child');

  // M9 fix 1066: the spring opens a folder only while the tree is on
  // show. A folder held under a drag in the name search's hits stays
  // closed in the tree behind them, its hit still lit as the drop's
  // target. hold1066 is empty, so the search for it gives one hit.
  const hold1066 = path.join(seed, 'hold1066');
  fs.mkdirSync(hold1066, { recursive: true });
  const b1066 = path.join(src953, 'b1066.txt');
  fs.writeFileSync(b1066, 'b1066');
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel953(hold1066))})?.dataset.kind === 'dir'`, 'the row for hold1066', 5000);
  await s.evalJs(`document.querySelector('.files-mode[data-mode="names"]').click()`);
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.type('hold1066');
  const hitFind1066 = `[...document.querySelectorAll('.files-list .files-hit[data-kind="dir"]')].filter((e) => e.querySelector('.files-name')?.textContent === 'hold1066')`;
  await s.waitFor(`${hitFind1066}.length === 1`, 'one folder hit for hold1066', 5000);
  const spot1066 = await s.evalJs(`(() => { const r = ${hitFind1066}[0].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await setDropFiles(s, [b1066]);
  await hover(s, spot1066);
  const t1066 = Date.now();
  while (Date.now() - t1066 < 900) {
    await drag(s, 'dragover', spot1066);
    await sleep(150);
  }
  const lit1066 = await lit953();
  expect(lit1066.length === 1, `fix 1066: the folder hit is still lit as the drop's target, got ${JSON.stringify(lit1066)}`);
  await drag(s, 'dragleave', spot1066);
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(
    `document.querySelectorAll('.files-hit').length === 0 && document.querySelector(${JSON.stringify(rowSel953(hold1066))})?.dataset.kind === 'dir'`,
    'the hits gone and the tree row for hold1066 back',
    5000,
  );
  const open1066 = await s.evalJs(`document.querySelector(${JSON.stringify(rowSel953(hold1066))})?.dataset.expanded ?? null`);
  expect(open1066 === null, `fix 1066: a drag held over a folder hit leaves the folder closed in the tree, got expanded ${open1066}`);
  step('fix 1066: a folder held under a drag in the name search hits stays closed in the tree behind them, its hit lit as the target');

  // M9 fix 1008: a copy of 400 files dropped with Ctrl on into953 shows
  // its progress in the window's corner note, updating, until the final
  // note lands, and the note then goes after its usual moment. Every note
  // the corner shows is recorded as it changes, so the read does not
  // race the copy.
  const many1008 = path.join(src953, 'many1008');
  fs.mkdirSync(path.join(many1008, 'a'), { recursive: true });
  fs.mkdirSync(path.join(many1008, 'b'), { recursive: true });
  for (let i = 0; i < 400; i++) fs.writeFileSync(path.join(many1008, i < 200 ? 'a' : 'b', `f${String(i).padStart(3, '0')}.txt`), 'x');
  const filesIn1008 = (dir) => {
    try {
      return fs.readdirSync(dir, { recursive: true }).filter((p) => fs.statSync(path.join(dir, p)).isFile()).length;
    } catch {
      return 0;
    }
  };
  await s.evalJs(
    `(() => { window.__notes1008 = []; const read = () => { const t = document.querySelector('.corner-note:not(.in-pane) .corner-note-text')?.textContent ?? null; if (t !== null && window.__notes1008.at(-1) !== t) window.__notes1008.push(t); }; window.__obs1008 = new MutationObserver(read); window.__obs1008.observe(document.body, { subtree: true, childList: true, characterData: true }); return true; })()`,
  );
  await setDropFiles(s, [many1008]);
  const spot1008 = await centerOf(s, rowSel953(into953));
  await hover(s, spot1008, { ctrl: true });
  expect((await drop953()).effect === 'copy', 'Ctrl shows copy over into953');
  await drag(s, 'drop', spot1008, { ctrl: true });
  // The frame for the user: the note mid-copy, taken the moment it shows.
  await s.waitFor(`/^Copying /.test(document.querySelector('.corner-note')?.textContent ?? '')`, 'a progress note in the corner', 10000);
  await s.screenshot('m12-drop-copying-1008.png');
  // M9 fix 1124: a progress note carries the Cancel, the final note none.
  // The note and its button read in one go, so a copy that ended since the
  // screenshot is not read as a missing button.
  const cancelRead = () =>
    s.evalJs(`({ text: document.querySelector('.corner-note .corner-note-text')?.textContent ?? null, action: document.querySelector('.corner-note .corner-note-action')?.textContent ?? null })`);
  const mid1008 = await cancelRead();
  expect(!/^Copying /.test(mid1008.text ?? '') || mid1008.action === 'Cancel', `fix 1124: the progress note carries a Cancel, got ${JSON.stringify(mid1008)}`);
  await waitDisk953(() => filesIn1008(path.join(into953, 'many1008')) === 400 && filesIn1008(many1008) === 400, 'many1008 copied whole into into953, its source kept', 15000);
  await noteIs953('Copied many1008 into into953', 'the final note says the folder was copied');
  expect((await cancelRead()).action === null, 'fix 1124: the final note of 1008 has no Cancel');
  const notes1008 = await s.evalJs(`(() => { window.__obs1008.disconnect(); return window.__notes1008; })()`);
  const counts1008 = notes1008.map((t) => /^Copying (\d+) of 400 files into into953$/.exec(t)).filter((m) => m !== null).map((m) => Number(m[1]));
  const lastProgress1008 = notes1008.findLastIndex((t) => t.startsWith('Copying '));
  expect(
    counts1008.length >= 1 &&
      counts1008.every((n, i) => n >= 1 && n <= 400 && (i === 0 || n >= counts1008[i - 1])) &&
      lastProgress1008 < notes1008.length - 1 &&
      notes1008.at(-1) === 'Copied many1008 into into953',
    `the progress notes rise to the final note, got ${JSON.stringify(notes1008)}`,
  );
  const mainLog1008 = fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8');
  expect(mainLog1008.includes(`files-move into ${into953} (copy): many1008 copied`), 'main.log has the copy line');
  await s.waitFor(`!document.querySelector('.corner-note')`, 'the note goes after its usual moment, the progress not held', 3500);
  step('fix 1008: a copy of 400 files dropped with Ctrl shows its progress in the corner note, updating, before the final note, and the note goes after its usual moment');

  // M9 fix 1123: one 72 MB file dropped with Ctrl on into953 is copied by stream, 2 ms after each 64 KB chunk under the pace, so the note counts bytes and moves inside the one file before the final note.
  // The 2 ms pace sleeps about 14 ms a chunk under Windows' timer, so the
  // one file takes about 16 s and the waits below are sized for that.
  const MB72 = 72 * 1024 * 1024;
  const stamp1123 = new Date('2024-01-02T03:04:05Z');
  const big1123 = path.join(src953, 'big1123.bin');
  // A truncate, so the fixture costs no write.
  fs.closeSync(fs.openSync(big1123, 'w'));
  fs.truncateSync(big1123, MB72);
  fs.utimesSync(big1123, stamp1123, stamp1123);
  const sizeOf = (p) => {
    try {
      return fs.statSync(p).size;
    } catch {
      return -1;
    }
  };
  await s.evalJs(
    `(() => { window.__notes1123 = []; const read = () => { const t = document.querySelector('.corner-note:not(.in-pane) .corner-note-text')?.textContent ?? null; if (t !== null && window.__notes1123.at(-1) !== t) window.__notes1123.push(t); }; window.__obs1123 = new MutationObserver(read); window.__obs1123.observe(document.body, { subtree: true, childList: true, characterData: true }); return true; })()`,
  );
  await setDropFiles(s, [big1123]);
  const spot1123 = await centerOf(s, rowSel953(into953));
  await hover(s, spot1123, { ctrl: true });
  expect((await drop953()).effect === 'copy', 'Ctrl shows copy over into953 for big1123');
  await drag(s, 'drop', spot1123, { ctrl: true });
  await s.waitFor(`/^Copying .* of 72\\.0 MB into into953$/.test(document.querySelector('.corner-note .corner-note-text')?.textContent ?? '')`, 'a byte note in the corner', 10000);
  await s.screenshot('m12-drop-bytes-1123.png');
  const mid1123 = await cancelRead();
  expect(!/^Copying /.test(mid1123.text ?? '') || mid1123.action === 'Cancel', `fix 1124: the byte note carries a Cancel, got ${JSON.stringify(mid1123)}`);
  await waitDisk953(() => sizeOf(path.join(into953, 'big1123.bin')) === MB72 && sizeOf(big1123) === MB72, 'big1123.bin copied whole into into953, its source kept', 45000);
  await noteIs953('Copied big1123.bin into into953', 'the final note says the big file was copied');
  expect((await cancelRead()).action === null, 'fix 1124: the final note of 1123 has no Cancel');
  const notes1123 = await s.evalJs(`(() => { window.__obs1123.disconnect(); return window.__notes1123; })()`);
  const perMB = { bytes: 1048576, KB: 1024, MB: 1 };
  const mbs1123 = notes1123
    .map((t) => /^Copying ([\d.]+) (bytes|KB|MB) of 72\.0 MB into into953$/.exec(t))
    .filter((m) => m !== null)
    .map((m) => Number(m[1]) / perMB[m[2]]);
  // The last chunk's push can read 72.0 of 72.0 MB before the file counts
  // as done, so a note at the whole size is allowed; two must come before it.
  const lastProgress1123 = notes1123.findLastIndex((t) => t.startsWith('Copying '));
  expect(
    mbs1123.length >= 2 &&
      mbs1123.every((n, i) => n <= 72 && (i === 0 || n > mbs1123[i - 1])) &&
      mbs1123.filter((n) => n < 72).length >= 2 &&
      !notes1123.some((t) => t.includes('files into')) &&
      lastProgress1123 < notes1123.length - 1 &&
      notes1123.at(-1) === 'Copied big1123.bin into into953',
    `fix 1123: the byte notes rise inside the one file to the final note, got ${JSON.stringify(notes1123)}`,
  );
  const mtime1123 = fs.statSync(path.join(into953, 'big1123.bin')).mtimeMs;
  expect(Math.abs(mtime1123 - fs.statSync(big1123).mtimeMs) <= 2, `fix 1123: the streamed copy keeps its modified time, got ${mtime1123} against ${fs.statSync(big1123).mtimeMs}`);
  const mainLog1123 = fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8');
  expect(mainLog1123.includes(`files-move into ${into953} (copy): big1123.bin copied`), 'fix 1123: main.log has the copy line');
  await s.waitFor(`!document.querySelector('.corner-note')`, 'the byte note goes after its usual moment', 3500);
  step('fix 1123: a 72 MB file dropped with Ctrl counts its copy in bytes in the corner note, moving inside the one file, before the final note, its modified time kept');

  // M9 fix 1124: three 72 MB files dropped with Ctrl on into953, and the corner note's Cancel clicked while the second copies: the first stays whole, the second is taken back, the third never starts.
  const c1124 = [1, 2, 3].map((i) => path.join(src953, `c1124-${i}.bin`));
  for (const p of c1124) {
    fs.closeSync(fs.openSync(p, 'w'));
    fs.truncateSync(p, MB72);
  }
  await s.evalJs(
    `(() => { window.__notes1124 = []; const read = () => { const t = document.querySelector('.corner-note:not(.in-pane) .corner-note-text')?.textContent ?? null; if (t !== null && window.__notes1124.at(-1) !== t) window.__notes1124.push(t); }; window.__obs1124 = new MutationObserver(read); window.__obs1124.observe(document.body, { subtree: true, childList: true, characterData: true }); return true; })()`,
  );
  await setDropFiles(s, c1124);
  const spot1124 = await centerOf(s, rowSel953(into953));
  await hover(s, spot1124, { ctrl: true });
  expect((await drop953()).effect === 'copy', 'Ctrl shows copy over into953 for the three c1124 files');
  await drag(s, 'drop', spot1124, { ctrl: true });
  // The second file well under way, so the click never lands on the
  // first file's last chunk.
  await s.waitFor(
    `(() => { const m = /^Copying ([\\d.]+) MB of 216\\.0 MB into into953$/.exec(document.querySelector('.corner-note .corner-note-text')?.textContent ?? ''); return m !== null && Number(m[1]) >= 80 && Number(m[1]) <= 136; })()`,
    'the byte note inside the second of three files',
    60000,
  );
  expect((await cancelRead()).action === 'Cancel', 'fix 1124: the note mid-copy carries a Cancel');
  await s.screenshot('m12-drop-cancel-1124.png');
  // A real click: an evalJs .click() would pass under pointer-events none.
  const cancelSpot1124 = await centerOf(s, '.corner-note .corner-note-action');
  await s.click(cancelSpot1124.x, cancelSpot1124.y);
  await noteIs953('Copied c1124-1.bin into into953; cancelled, 2 not copied', 'the final note says what the Cancel left out');
  const notes1124 = await s.evalJs(`(() => { window.__obs1124.disconnect(); return window.__notes1124; })()`);
  expect(sizeOf(path.join(into953, 'c1124-1.bin')) === MB72, `fix 1124: the first file stays whole, got ${sizeOf(path.join(into953, 'c1124-1.bin'))}`);
  expect(sizeOf(path.join(into953, 'c1124-2.bin')) === -1 && sizeOf(path.join(into953, 'c1124-3.bin')) === -1, 'fix 1124: the second is taken back and the third never lands');
  expect(c1124.every((p) => sizeOf(p) === MB72), 'fix 1124: the three sources are whole');
  const mainLog1124 = fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8');
  expect(mainLog1124.includes(`files-cancel into ${into953}: 1 running`), 'fix 1124: main.log has the cancel line');
  expect(
    mainLog1124.includes(`files-move into ${into953} (copy): c1124-1.bin copied, c1124-2.bin refused cancelled, c1124-3.bin skipped cancelled`),
    'fix 1124: main.log has the cancelled copy line',
  );
  const cancelAt1124 = notes1124.indexOf('Cancelling the copy into into953');
  expect(
    notes1124.at(-1) === 'Copied c1124-1.bin into into953; cancelled, 2 not copied' && (cancelAt1124 === -1 || !notes1124.slice(cancelAt1124 + 1).some((t) => t.startsWith('Copying '))),
    `fix 1124: no progress note after the Cancel, the final note last, got ${JSON.stringify(notes1124)}`,
  );
  await s.waitFor(`!document.querySelector('.corner-note')`, 'the cancelled note goes after its usual moment', 3500);
  step("fix 1124: the corner note's Cancel, clicked while the second of three 72 MB files copies, keeps the first whole, takes the second back and leaves the third, the note saying so");

  // M9 fix 1153: three 60 MB files, under the 64 MB stream floor but over
  // the byte note's 50 MB average, so each streams from 8 MB and the note
  // moves inside the first file; and the copy cancelled from the palette's
  // Cancel the copy while the second copies.
  const MB60 = 60 * 1024 * 1024;
  const s1153 = [1, 2, 3].map((i) => path.join(src953, `s1153-${i}.bin`));
  for (const p of s1153) {
    fs.closeSync(fs.openSync(p, 'w'));
    fs.truncateSync(p, MB60);
  }
  await s.evalJs(
    `(() => { window.__notes1153 = []; const read = () => { const t = document.querySelector('.corner-note:not(.in-pane) .corner-note-text')?.textContent ?? null; if (t !== null && window.__notes1153.at(-1) !== t) window.__notes1153.push(t); }; window.__obs1153 = new MutationObserver(read); window.__obs1153.observe(document.body, { subtree: true, childList: true, characterData: true }); return true; })()`,
  );
  await setDropFiles(s, s1153);
  const spot1153 = await centerOf(s, rowSel953(into953));
  await hover(s, spot1153, { ctrl: true });
  await drag(s, 'drop', spot1153, { ctrl: true });
  await s.waitFor(
    `(() => { const m = /^Copying ([\\d.]+) MB of 180\\.0 MB into into953$/.exec(document.querySelector('.corner-note .corner-note-text')?.textContent ?? ''); return m !== null && Number(m[1]) >= 70 && Number(m[1]) <= 110; })()`,
    'the byte note inside the second of three 60 MB files',
    60000,
  );
  // M9 fix 1163: the note's Cancel names the palette's route in its tooltip.
  const title1163 = await s.evalJs(`document.querySelector('.corner-note .corner-note-action')?.title ?? null`);
  expect(title1163 === 'Or Ctrl+Shift+P, then Cancel the copy', `fix 1163: the copy's Cancel names its keyboard route (${JSON.stringify(title1163)})`);
  await s.key('P', 'KeyP', 80, CTRL | SHIFT);
  const row1153 = '.picker-overlay .action-row[data-kind="note"][data-action="cancel-copy"]';
  await s.waitFor(`!!document.querySelector(${JSON.stringify(row1153)})`, 'the palette lists Cancel the copy', 5000);
  const seen1153 = await s.evalJs(
    `(() => { const row = document.querySelector(${JSON.stringify(row1153)}); let el = row.previousElementSibling; while (el && !el.classList.contains('palette-group')) el = el.previousElementSibling; return { label: row.querySelector('.action-label')?.textContent ?? null, group: el?.textContent ?? null }; })()`,
  );
  expect(seen1153.label === 'Cancel the copy' && seen1153.group === 'Copy', `the row reads Cancel the copy under Copy, got ${JSON.stringify(seen1153)}`);
  await s.evalJs(`document.querySelector(${JSON.stringify(row1153)}).click()`);
  await s.waitFor(`!document.querySelector('.picker-overlay')`, 'the palette closed on the pick', 5000);
  await noteIs953('Copied s1153-1.bin into into953; cancelled, 2 not copied', 'the final note says what Cancel the copy left out');
  const notes1153 = await s.evalJs(`(() => { window.__obs1153.disconnect(); return window.__notes1153; })()`);
  expect(sizeOf(path.join(into953, 's1153-1.bin')) === MB60, `fix 1153: the first file stays whole, got ${sizeOf(path.join(into953, 's1153-1.bin'))}`);
  expect(sizeOf(path.join(into953, 's1153-2.bin')) === -1 && sizeOf(path.join(into953, 's1153-3.bin')) === -1, 'fix 1153: the second is taken back and the third never lands');
  expect(s1153.every((p) => sizeOf(p) === MB60), 'fix 1153: the three sources are whole');
  const mainLog1153 = fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8');
  expect(
    mainLog1153.includes(`files-move into ${into953} (copy): s1153-1.bin copied, s1153-2.bin refused cancelled, s1153-3.bin skipped cancelled`),
    'fix 1153: main.log has the cancelled copy line',
  );
  const perMB1153 = { bytes: 1048576, KB: 1024, MB: 1 };
  const mbs1153 = notes1153
    .map((t) => /^Copying ([\d.]+) (bytes|KB|MB) of 180\.0 MB into into953$/.exec(t))
    .filter((m) => m !== null)
    .map((m) => Number(m[1]) / perMB1153[m[2]]);
  const firstWhole1153 = mbs1153.findIndex((n) => n >= 60);
  const inside1153 = (firstWhole1153 === -1 ? mbs1153 : mbs1153.slice(0, firstWhole1153)).filter((n) => n > 0 && n < 60);
  expect(inside1153.length >= 2, `fix 1153: the byte note moves inside the first 60 MB file, got ${JSON.stringify(notes1153)}`);
  await s.waitFor(`!document.querySelector('.corner-note')`, 'the cancelled note goes after its usual moment', 3500);
  step('fix 1153: three 60 MB files dropped with Ctrl count bytes inside the first file, and Cancel the copy from the palette, run while the second copies, keeps the first and leaves the other two');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m12-drop-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  try {
    fs.rmSync(seed, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(src953Short, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Left for the next run.
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
