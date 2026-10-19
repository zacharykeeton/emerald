// M11 acceptance: file tabs. A click on a file in the rail opens a tab
// with the file read-only in Monaco; typing changes nothing; a write on
// disk shows within two seconds; a second file gives a second tab and the
// keys move between them; the Panes tab brings the terminals back with
// the keyboard in the terminal; Ctrl+W, the middle click and Close all
// close tabs; the tabs survive a reload; a deleted file says so and a
// binary one too. Then the layout tabs (M36): + makes a tab and switches
// to it, a shell started there is not on screen in the first tab and its
// row is not marked, n and p switch, a rename shows on the tab, closing
// the tab leaves the session listed and lands on the previous tab, the
// last tab cannot close, and a state.json from before M36 is read as one
// tab. M9 fix 40: a sidebar row click under a file tab puts the panes view
// back in front with the session focused, and one on a session in a hidden
// layout tab puts that tab on show. M9 fix 227, last, on a second window
// with EMERALD_WHATS_NEW=on: the What's New tab opens active on a profile
// that has not seen the notes' newest heading, closing it writes the
// heading as seen, a reload opens nothing, and the palette's `> what` row
// opens it again. Uses a private home and pipe unless the environment
// already names them.
// Run: npm run verify:tabs -w @emerald/app
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm11-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m11';
const { ALT, CTRL, SHIFT, expect, focusedPaneIs, freshPort, getLayout, getTabs, killTree, launch, leaves, profileOf, repoRoot, setInput, sleep, startSession, startShellByKey, step, stopDaemon, emeraldHome, windowPage, zreq } = await import('./cdp.mjs');

let app = null;
// 27 to 32 s quiet; it fired once at step 30 of 38 under a batch's load
// and the rerun took 77 s; a higher watchdog costs time only on a real hang.
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 240 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 240000);

// The seed: a JSON file, a nested TypeScript file, a markdown file and a
// binary one. Resolved to the long form, as verify:files does, since the
// rail keys paths by what the shell reports.
const seedShort = path.join(os.tmpdir(), 'emerald-verify', `m11-tree-${process.pid}`);
fs.rmSync(seedShort, { recursive: true, force: true });
fs.mkdirSync(path.join(seedShort, 'src'), { recursive: true });
const seed = fs.realpathSync.native(seedShort);
const hello = path.join(seed, 'hello.json');
const index = path.join(seed, 'src', 'index.ts');
const notes = path.join(seed, 'notes.md');
const blob = path.join(seed, 'blob.bin');
fs.writeFileSync(hello, '{\n  "a": 1,\n  "b": "two"\n}\n');
fs.writeFileSync(index, 'export function hi(name: string): string {\n  return `hi ${name}`;\n}\n');
fs.writeFileSync(notes, '# Notes\n\nSome text.\n');
fs.writeFileSync(blob, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]));

const rowSel = (p) => `.files-row[data-path=${JSON.stringify(p)}]`;
const clickRow = (s, p) => s.evalJs(`document.querySelector(${JSON.stringify(rowSel(p))}).click()`);
// M9 fix 203: a single click on a row opens into the preview tab, which
// the next single click reuses; a double click pins. `pinRow` is the
// double click's own event (the two clicks before it previewed the file),
// and `openRow` is a click and a double click, a pinned tab in one go.
const pinRow = (s, p) => s.evalJs(`document.querySelector(${JSON.stringify(rowSel(p))}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
const openRow = async (s, p) => {
  await clickRow(s, p);
  await pinRow(s, p);
};
// The preview tabs' paths, and whether each file tab's name is drawn in italics.
const previews = (s) => s.evalJs(`[...document.querySelectorAll('.tab-file')].filter(t => t.dataset.preview !== undefined).map(t => t.dataset.tab)`);
const italics = (s) => s.evalJs(`[...document.querySelectorAll('.tab-file')].map(t => t.querySelector('.tab-name').textContent + ':' + getComputedStyle(t.querySelector('.tab-name')).fontStyle)`);
const tabSel = (t) => `.tab[data-tab=${JSON.stringify(t)}]`;
const tabs = (s) => s.evalJs(`[...document.querySelectorAll('.tab')].map(t => (t.dataset.tab === 'panes' ? 'panes' : t.querySelector('.tab-name').textContent) + (t.dataset.active ? '*' : ''))`);
const activeTab = (s) => s.evalJs(`document.querySelector('.tab-strip').dataset.activeTab`);
const viewState = (s) => s.evalJs(`document.querySelector('.file-view')?.dataset.state ?? null`);
const viewLines = (s) => s.evalJs(`Number(document.querySelector('.file-view')?.dataset.lines ?? 0)`);
// An occluded window draws no frames and Monaco fills its lines in one,
// so a screenshot forces a frame before the DOM is read. Monaco draws a
// space as a no-break space, folded back here.
const shownText = async (s, name) => {
  await s.screenshot(name);
  return (await s.evalJs(`document.querySelector('.file-view .view-lines')?.textContent ?? ''`)).replace(/\u00a0/g, ' ');
};
const inEditor = (s) => s.evalJs(`!!document.activeElement?.closest('.monaco-editor')`);
const inTerminal = (s) => s.evalJs(`document.activeElement?.classList.contains('xterm-helper-textarea') === true`);

let s = await launch(freshPort(), { freshState: true });
app = s;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  expect((await tabs(s)).join(',') === 'panes*', `the strip starts with the panes tab alone: ${await tabs(s)}`);
  await startSession(s, { kind: 'shell', cwd: seed });
  await s.waitFor(`document.querySelectorAll('.files-row').length === 4`, 'the seed listed');
  step('a fresh window has the panes tab alone and active');

  // A click on a file opens its tab with the file in the editor.
  await clickRow(s, hello);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'text'`, 'hello.json read');
  // M9 fix 339: a .json opens on its read-only Pretty view; the steps
  // below type into the file, so Raw first.
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'pretty' && !!document.querySelector('.file-view-switch [data-view="raw"]')`, 'hello.json open Pretty with the switch');
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="raw"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'raw' && document.querySelector('.file-editor')?.emeraldEditor?.getModel()?.uri.scheme === 'file'`, 'Raw shows the file itself');
  expect((await tabs(s)).join(',') === 'panes,hello.json*', `the tab is there and active: ${await tabs(s)}`);
  expect((await activeTab(s)) === hello, 'the strip names the active path');
  expect((await viewLines(s)) === 5, `the view holds the file's lines (${await viewLines(s)})`);
  expect((await s.evalJs(`document.querySelector('.file-path').textContent`)) === hello, 'the header is the full path');
  const text = await shownText(s, 'm11-tabs.png');
  expect(text.includes('"a": 1') && text.includes('"b": "two"'), `the editor shows the file: ${text.slice(0, 60)}`);
  expect(await s.evalJs(`!!document.querySelector('.file-view .monaco-editor')`), 'it is a Monaco editor');
  expect(await inEditor(s), 'the keyboard is in the editor');
  expect(await s.evalJs(`document.querySelector('.panes-view').dataset.hidden === 'true'`), 'the panes are hidden underneath, not gone');
  expect(await s.evalJs(`document.querySelectorAll('.term-host').length === 1`), 'the terminal is still mounted');
  step('a click on a file in the rail opens it in a tab, in Monaco');

  // M9 fix 248: the tab is an editor. Typing lands in the view and marks
  // the tab, and nothing reaches the disk until a save; an undo clears
  // the mark, so the change on disk below lands on a clean model
  // (verify:files has the save, the ask and the changed-on-disk line).
  await s.type('zzz');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'the typing marks the view dirty', 3000);
  expect((await shownText(s, 'm11-typed.png')).includes('zzz'), 'typed text lands in the view');
  expect(await s.evalJs(`!!document.querySelector('.tab-file[data-dirty] .tab-dirty')`), 'the tab wears the dirty mark');
  expect(fs.readFileSync(hello, 'utf8') === '{\n  "a": 1,\n  "b": "two"\n}\n', 'the file on disk is untouched');
  await s.evalJs(`document.querySelector('.file-editor').emeraldEditor.trigger('verify', 'undo', null)`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === undefined && !document.querySelector('.tab-file[data-dirty]')`, 'undo clears the mark', 3000);
  step('the editor takes typing and marks the tab dirty; the disk waits for a save, and an undo clears the mark');

  // M9 fix 899: Ctrl+wheel over a file tab sizes its editor, the size kept
  // by the file's path since a tab has no pane.
  const tabWheel899 = (deltaY) =>
    s.evalJs(`document.querySelector('.file-editor').dispatchEvent(new WheelEvent('wheel', { deltaY: ${deltaY}, ctrlKey: true, bubbles: true, cancelable: true }))`);
  const bodyText899 = `getComputedStyle(document.querySelector('.file-body')).getPropertyValue('--pane-text').trim()`;
  await tabWheel899(-100);
  await s.waitFor(`${bodyText899} === '15px' && document.querySelector('.file-editor').emeraldEditor.getRawOptions().fontSize === 14`, 'one Ctrl+wheel notch up over the file tab', 3000);
  const tabStored899 = JSON.parse((await s.evalJs(`localStorage.getItem('emerald.fontSizes')`)) ?? '{}');
  expect(Object.keys(tabStored899).some((k) => k.startsWith('file:') && tabStored899[k] === 15), `fix 899: the tab's size is kept under its path, got ${JSON.stringify(tabStored899)}`);
  await tabWheel899(100);
  await s.waitFor(`${bodyText899} === '' && document.querySelector('.file-editor').emeraldEditor.getRawOptions().fontSize === 13`, 'one notch down takes the tab back', 3000);
  const tabBack899 = JSON.parse((await s.evalJs(`localStorage.getItem('emerald.fontSizes')`)) ?? '{}');
  expect(!Object.keys(tabBack899).some((k) => k.startsWith('file:')), `fix 899: a tab back at 14 leaves no file: key, got ${JSON.stringify(tabBack899)}`);
  step('M9 fix 899: Ctrl+wheel over a file tab sizes its editor, kept by path');

  // A write on disk shows without a refresh.
  fs.writeFileSync(hello, '{\n  "a": 1,\n  "b": "two",\n  "c": [1, 2, 3]\n}\n');
  await s.waitFor(`Number(document.querySelector('.file-view')?.dataset.lines) === 6`, 'the re-read after a change on disk', 3000);
  expect((await shownText(s, 'm11-changed.png')).includes('"c": [1, 2, 3]'), 'the new line is in the editor');
  expect((await tabs(s)).join(',') === 'panes,hello.json*', 'still the one tab');
  step('a change on disk shows in the tab within a second');

  // M9 fix 488: the typing above pinned hello.json (the first edit keeps
  // a preview), so the tab is closed and clicked again to be the preview
  // the fix 203 block below starts from.
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'the pinned hello.json closed');
  await clickRow(s, hello);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(hello)}`, 'hello.json opened again as the preview');
  // M9 fix 203: hello.json is the preview tab. Two more single clicks
  // reuse it, so three clicks are one tab whose path is the last, drawn
  // in italics; a double click pins it, and the next single click opens a
  // second tab beside it, the preview again.
  expect((await previews(s)).join() === hello, `the first click's tab is the preview: ${await previews(s)}`);
  expect((await italics(s)).join() === 'hello.json:italic', `its name is in italics: ${await italics(s)}`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(hello))}).title`)).includes('preview'), 'the tooltip says it is the preview');
  await clickRow(s, path.join(seed, 'src'));
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(index))})`, 'src expanded');
  await clickRow(s, index);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(index)} && document.querySelector('.file-view')?.dataset.state === 'text'`, 'index.ts read');
  expect((await tabs(s)).join(',') === 'panes,index.ts*', `the second click reused the tab: ${await tabs(s)}`);
  await clickRow(s, notes);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(notes)} && document.querySelector('.file-view')?.dataset.state === 'text'`, 'notes.md read');
  expect((await tabs(s)).join(',') === 'panes,notes.md*', `three clicks, one tab, the last path: ${await tabs(s)}`);
  expect((await italics(s)).join() === 'notes.md:italic', `still in italics: ${await italics(s)}`);
  await pinRow(s, notes);
  await s.waitFor(`document.querySelectorAll('.tab-file[data-preview]').length === 0`, 'the double click pinned it');
  expect((await italics(s)).join() === 'notes.md:normal', `pinned, the italics are off: ${await italics(s)}`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(notes))}).title`)) === notes, 'the tooltip is the path alone');
  await clickRow(s, hello);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(hello)}`, 'hello.json again');
  expect((await tabs(s)).join(',') === 'panes,notes.md,hello.json*', `a second tab beside the pinned one: ${await tabs(s)}`);
  expect((await previews(s)).join() === hello && (await italics(s)).join() === 'notes.md:normal,hello.json:italic', `the new one is the preview: ${await italics(s)}`);
  await clickRow(s, notes);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(notes)}`, 'the pinned file clicked');
  expect((await tabs(s)).join(',') === 'panes,notes.md*,hello.json' && (await previews(s)).join() === hello, `a pinned file re-clicked is activated and stays pinned, the preview untouched: ${await tabs(s)}`);
  await s.screenshot('m9-fix203-preview.png');
  step('fix 203: three single clicks in the rail are one italic preview tab; a double click pins it and the next click opens beside it');

  // M9 fix 488: a double click on the preview tab itself keeps it (the
  // italics go), the next single click opens a second tab beside it, and
  // the first edit typed into a fresh preview keeps that one too. The
  // edit is undone after, so index.ts is clean for the steps below; the
  // pin stays, which is what those steps expect of it anyway.
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(hello))}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await s.waitFor(`document.querySelectorAll('.tab-file[data-preview]').length === 0`, 'a double click on the tab pinned it');
  expect((await italics(s)).join() === 'notes.md:normal,hello.json:normal', `both tabs upright: ${await italics(s)}`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(hello))}).title`)) === hello, 'the tooltip is the path alone');
  await clickRow(s, index);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(index)} && document.querySelector('.file-view')?.dataset.state === 'text'`, 'index.ts read');
  expect((await tabs(s)).join(',') === 'panes,notes.md,hello.json,index.ts*' && (await previews(s)).join() === index, `a second tab beside the pinned ones, the preview: ${await tabs(s)}`);
  await s.evalJs(`(() => { const e = document.querySelector('.file-editor').emeraldEditor; e.focus(); e.executeEdits('verify', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'x' }]); })()`);
  await s.waitFor(`document.querySelectorAll('.tab-file[data-preview]').length === 0`, 'an edit pinned the preview tab');
  expect((await italics(s)).join() === 'notes.md:normal,hello.json:normal,index.ts:normal', `the edited tab is upright: ${await italics(s)}`);
  await s.evalJs(`document.querySelector('.file-editor').emeraldEditor.trigger('verify', 'undo', null)`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(tabSel(index))}).dataset.dirty`, 'the edit undone, index.ts clean');
  step('fix 488: a double click on the preview tab keeps it, and the first edit keeps a preview too');

  // A second file, then the keys between the tabs and back to the panes.
  // notes.md closes and hello.json is pinned, so the strip is the one the
  // steps below expect: hello.json pinned, index.ts the preview beside it.
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(notes))}).dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(tabSel(notes))})`, 'notes.md closed');
  await pinRow(s, hello);
  await s.waitFor(`document.querySelectorAll('.tab-file[data-preview]').length === 0`, 'hello.json pinned');
  await clickRow(s, index);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(index)} && document.querySelector('.file-view')?.dataset.state === 'text'`, 'index.ts read');
  expect((await tabs(s)).join(',') === 'panes,hello.json,index.ts*', `two file tabs, the new one active: ${await tabs(s)}`);
  // M9 fix 182: the + is the last thing on the strip, after the file tabs.
  expect(await s.evalJs(`document.querySelector('.tab-strip-clip').nextElementSibling?.classList.contains('tab-add')`), 'the + is last on the strip with two files open');
  expect((await shownText(s, 'm11-second.png')).includes('export function hi'), 'the second file is showing');
  await s.key('PageUp', 'PageUp', 33, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(hello)}`, 'Ctrl+PageUp goes left');
  // hello.json was closed and reopened by the fix 203 clicks above, so
  // it is back on its Pretty view (M9 fix 339), the array one item a
  // line; the key is what the read looks for.
  await s.waitFor(`document.querySelector('.file-view')?.dataset.pretty === 'ok'`, 'hello.json formatted', 5000);
  expect((await shownText(s, 'm11-back.png')).includes('"c": ['), 'and the first file is back');
  await s.key('PageUp', 'PageUp', 33, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'Ctrl+PageUp again reaches the panes');
  expect(!(await s.evalJs(`!!document.querySelector('.file-view')`)), 'no file view on the panes tab');
  expect(await s.evalJs(`document.querySelector('.panes-view').dataset.hidden === undefined`), 'the panes are visible again');
  expect(await inTerminal(s), 'the keyboard is back in the terminal');
  await s.key('PageUp', 'PageUp', 33, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(index)}`, 'Ctrl+PageUp wraps to the last tab');
  await s.key('PageDown', 'PageDown', 34, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'Ctrl+PageDown wraps to the panes');
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(hello))}).click()`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(hello)}`, 'a click on a tab');
  step('Ctrl+PageUp and Ctrl+PageDown move between the tabs and wrap; the Panes tab restores the terminal');

  // Ctrl+W closes the active file tab and the one on its right takes over.
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab').length === 2`, 'Ctrl+W closed a tab');
  expect((await tabs(s)).join(',') === 'panes,index.ts*', `the tab to the right is active: ${await tabs(s)}`);
  // A middle click on the remaining tab closes it and lands on the panes.
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(index))}).dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))`);
  await s.waitFor(`document.querySelectorAll('.tab').length === 1 && document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'the middle click');
  expect(await inTerminal(s), 'the keyboard is in the terminal after the last tab closed');
  step('Ctrl+W and the middle click close tabs');

  // The tab menu's Close all. hello.json is pinned so index.ts opens beside it (fix 203).
  await openRow(s, hello);
  await clickRow(s, index);
  await s.waitFor(`document.querySelectorAll('.tab').length === 3`, 'two tabs again');
  const tabBox = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(tabSel(hello))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(tabBox.x, tabBox.y);
  await s.waitFor(`document.querySelector('.tab-menu')?.dataset.path === ${JSON.stringify(hello)}`, 'the tab menu');
  const labels = await s.evalJs(`[...document.querySelectorAll('.tab-menu .menu-label')].map(b => b.textContent)`);
  expect(labels.join(',') === 'Close,Close others,Close all,Reveal in Explorer,Reveal in Files,Copy path', `the menu items: ${labels.join(',')}`);
  // M9 fix 370: Copy path goes through the app's own clipboard
  // (window.emerald.clipboard), read back the way fix 345's heading menu
  // is in verify:sidebar; the box's clipboard, so what was there is put
  // back after.
  const tabClipSaved = await s.evalJs(`window.emerald.clipboard.read().then(r => r.text)`);
  await s.evalJs(`[...document.querySelectorAll('.tab-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Copy path').click()`);
  await s.waitFor(`window.emerald.clipboard.read().then(r => r.text === ${JSON.stringify(hello)})`, 'Copy path puts the tab\'s absolute path on the clipboard', 3000);
  await s.evalJs(`window.emerald.clipboard.write(${JSON.stringify(tabClipSaved ?? '')})`);
  step("Copy path puts the tab's absolute path on the app's own clipboard");
  await s.rightClick(tabBox.x, tabBox.y);
  await s.waitFor(`document.querySelector('.tab-menu')?.dataset.path === ${JSON.stringify(hello)}`, 'the tab menu reopens');
  await s.evalJs(`[...document.querySelectorAll('.tab-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Close all').click()`);
  await s.waitFor(`document.querySelectorAll('.tab').length === 1`, 'Close all');
  step('the tab menu closes every file tab');

  // The tabs survive a reload, with the file showing again.
  await clickRow(s, notes);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'text'`, 'notes.md read');
  await s.send('Page.reload');
  await sleep(1500);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(notes)} && document.querySelector('.file-view')?.dataset.state === 'text'`, 'the tab is back after a reload');
  expect((await tabs(s)).join(',') === 'panes,notes.md*', `the strip is as it was: ${await tabs(s)}`);
  expect((await previews(s)).join() === notes, `the preview survives the reload as a preview (fix 203): ${await previews(s)}`);
  step('the tabs survive a renderer reload');

  // A file that goes away says so; its Close tab button lands on the panes.
  fs.rmSync(notes);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'error'`, 'the deleted file noticed', 3000);
  expect((await s.evalJs(`document.querySelector('.file-message div').textContent`)) === 'File not found', 'the tab says the file is not found');
  await s.evalJs(`document.querySelector('.file-message button').click()`);
  await s.waitFor(`document.querySelectorAll('.tab').length === 1`, 'Close tab');
  // And a binary file.
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(blob))})`, 'blob.bin listed');
  await clickRow(s, blob);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'binary'`, 'the binary file read');
  expect((await s.evalJs(`document.querySelector('.file-message div').textContent`)) === 'Binary file, 8 bytes', 'the tab says it is binary and how big');
  await s.screenshot('m11-binary.png');
  step('a deleted file and a binary file say so in the tab');

  // M9 fix 615: an image file shows as the picture. pic.png is a 1 by 1
  // PNG, rewritten later as 2 by 1 (both carry a NUL in the first eight
  // bytes, so the old code read each as binary); wide.svg is wider than
  // any pane, so fit and actual size differ. The step leaves blob.bin
  // the one file tab in front, as the blocks after it expect.
  const pic = path.join(seed, 'pic.png');
  const svgWide = path.join(seed, 'wide.svg');
  fs.writeFileSync(pic, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==', 'base64'));
  fs.writeFileSync(svgWide, '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="40"><rect width="3000" height="40" fill="#3a7"/><circle cx="20" cy="20" r="16" fill="#fff"/></svg>');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(pic))}) && !!document.querySelector(${JSON.stringify(rowSel(svgWide))})`, 'pic.png and wide.svg listed');
  await clickRow(s, pic);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'image' && document.querySelector('img.file-image')?.complete && document.querySelector('img.file-image')?.naturalWidth === 1`, 'the PNG shown as a picture');
  const png1 = await s.evalJs(`({ sw: !!document.querySelector('.file-view-switch'), zoom: document.querySelector('.file-view').dataset.zoom, size: document.querySelector('.file-image-size')?.textContent, pause: !!document.querySelector('.file-image-pause'), chip: document.querySelector('.file-image-zoom')?.textContent ?? null, cursor: document.querySelector('.file-view').dataset.cursor ?? null })`);
  expect(!png1.sw && !png1.pause && png1.zoom === 'fit' && png1.size === '1 \u00d7 1' && png1.chip === '100%' && png1.cursor === null, `the PNG has no view switch, no Pause button, is fitted, says its size and (fix 850) its chip reads 100% at a fit that is actual size, got ${JSON.stringify(png1)}`);
  await s.screenshot('m11-image.png');
  fs.writeFileSync(pic, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAAAAADRSSBWAAAAC0lEQVR4nGNgYAAAAAMAAbitOmMAAAAASUVORK5CYII=', 'base64'));
  await s.waitFor(`document.querySelector('img.file-image')?.naturalWidth === 2 && document.querySelector('.file-image-size')?.textContent === '2 \u00d7 1'`, 'the rewritten PNG shown', 3000);
  step('fix 615: a PNG shows in its tab as the picture with its size in the header, and a rewrite on disk shows the new one');
  await clickRow(s, svgWide);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'rendered' && document.querySelector('.file-view')?.dataset.state === 'image' && document.querySelector('img.file-image')?.naturalWidth === 3000`, 'the SVG shown rendered');
  await s.screenshot('m11-svg.png');
  const imgBox = () => s.evalJs(`(() => { const i = document.querySelector('img.file-image'); const h = document.querySelector('.file-image-host'); const r = i.getBoundingClientRect(); return { w: r.width, nat: i.naturalWidth, zoom: document.querySelector('.file-view').dataset.zoom, scroll: h.scrollWidth, client: h.clientWidth }; })()`);
  const fit = await imgBox();
  expect(fit.zoom === 'fit' && fit.w < fit.nat, `the SVG is fitted under the natural width, got ${JSON.stringify(fit)}`);
  await s.evalJs(`document.querySelector('img.file-image').click()`);
  await s.waitFor(`document.querySelector('.file-view').dataset.zoom === 'actual'`, 'a click shows actual size');
  await s.screenshot('m11-svg-actual.png');
  const actual = await imgBox();
  expect(Math.round(actual.w) === actual.nat && actual.scroll > actual.client, `actual size scrolls, got ${JSON.stringify(actual)}`);
  await s.evalJs(`document.querySelector('img.file-image').click()`);
  await s.waitFor(`document.querySelector('.file-view').dataset.zoom === 'fit'`, 'a second click fits again');
  // M9 fix 820: Ctrl+wheel steps the picture through its own zoom steps
  // (fix 850) about the pointer; 0 and = and the chip are the keys' side.
  const zoomRead = () => s.evalJs(`(() => { const v = document.querySelector('.file-view'); const i = document.querySelector('img.file-image'); const r = i.getBoundingClientRect(); return { zoom: v.dataset.zoom, scale: v.dataset.scale, cursor: v.dataset.cursor ?? null, w: r.width, chip: document.querySelector('.file-image-zoom')?.textContent ?? null }; })()`);
  const z0 = await zoomRead();
  expect(+z0.scale < 0.25 && z0.cursor === 'zoom-in' && z0.chip === 'Fit', `fix 820: the SVG at fit is under 25 percent with a zoom-in cursor and the chip Fit, got ${JSON.stringify(z0)}`);
  const wheelAt = await s.evalJs(`(() => { const r = document.querySelector('img.file-image').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  for (const want of ['0.25', '0.33']) {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheelAt.x, y: wheelAt.y, deltaX: 0, deltaY: -120, modifiers: 2 });
    await s.waitFor(`document.querySelector('.file-view').dataset.scale === ${JSON.stringify(want)}`, `Ctrl+wheel steps the picture to ${want}`, 4000);
  }
  const z1 = await zoomRead();
  // Within half a pixel of 990 (M9 fix 893): the inline width is kept; before flex: none the host shrank it to 989.06 px, its height's 13.2 px snapped to 13.1875 times the 75 to 1 ratio.
  expect(z1.zoom === 'scaled' && z1.scale === '0.33' && Math.abs(z1.w - 990) <= 0.5 && z1.chip === '33%', `fix 820: two Ctrl+wheel steps from fit take the picture to 33 percent about the pointer, got ${JSON.stringify(z1)}`);
  console.log('fix 820 picture point under the pointer after the wheel', JSON.stringify(await s.evalJs(`(() => { const r = document.querySelector('img.file-image').getBoundingClientRect(); return { x: ${wheelAt.x}, imageLeft: Math.round(r.left), width: Math.round(r.width) }; })()`)));
  await s.evalJs(`document.querySelector('.file-image-host').focus()`);
  await s.key('0', 'Digit0', 48);
  await s.waitFor(`document.querySelector('.file-view').dataset.zoom === 'fit' && document.querySelector('.file-image-zoom').textContent === 'Fit'`, '0 goes back to fit and the chip reads Fit', 4000);
  await s.key('=', 'Equal', 187);
  await s.waitFor(`document.querySelector('.file-view').dataset.scale === '0.25'`, '= steps the picture in from fit to 25 percent', 4000);
  await s.evalJs(`document.querySelector('.file-image-zoom').click()`);
  await s.waitFor(`document.querySelector('.file-view').dataset.zoom === 'fit'`, 'the chip goes back to fit', 4000);
  // M9 fix 850: = from fit runs past the graph's 200 percent to 300, one
  // press and one rendered scale at a time.
  for (const want of ['0.25', '0.33', '0.5', '0.67', '0.8', '1', '1.25', '1.5', '2', '3']) {
    await s.key('=', 'Equal', 187);
    await s.waitFor(`document.querySelector('.file-view').dataset.scale === ${JSON.stringify(want)}`, `fix 850: = steps the SVG to ${want}`, 4000);
  }
  const svg300 = await s.evalJs(`(() => { const r = document.querySelector('img.file-image').getBoundingClientRect(); return { chip: document.querySelector('.file-image-zoom')?.textContent ?? null, w: r.width, pixelated: document.querySelector('.file-view').hasAttribute('data-pixelated') }; })()`);
  expect(svg300.chip === '300%' && Math.round(svg300.w) === 9000, `fix 850: = takes the SVG past 200 percent to 300, got ${JSON.stringify(svg300)}`);
  await s.evalJs(`(() => { const h = document.querySelector('.file-image-host'); h.scrollLeft = 0; h.scrollTop = 0; })()`);
  await s.screenshot('m11-svg-300.png');
  console.log(`fix 850 SVG at 300 percent, data-pixelated ${svg300.pixelated}`);
  expect(svg300.pixelated === false, `fix 893: the SVG at 300 percent carries no data-pixelated, got ${JSON.stringify(svg300)}`);
  await s.key('0', 'Digit0', 48);
  await s.waitFor(`document.querySelector('.file-view').dataset.zoom === 'fit'`, 'fix 850: 0 goes back to fit from 300 percent', 4000);
  step('fix 820: Ctrl+wheel takes a picture through its own zoom steps about the pointer, = steps it, 0 and the chip go back to fit, and the cursor shows a magnifier at fit; fix 850: the steps run a tenth to eight times, = takes a wide SVG to 300 percent, and a 1 by 1 PNG\'s chip reads 100%');
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="raw"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'text'`, 'Raw is the editor');
  expect((await s.evalJs(`document.querySelector('.file-view').dataset.view`)) === 'raw', 'the SVG is on Raw');
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="rendered"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'image'`, 'Rendered is the picture again');
  step('fix 615: an SVG opens on Rendered as the picture fitted to the pane, a click shows it at actual size with scrolling and a second fits it again, and Raw is the editor');
  // M9 fix 638: a GIF has a Pause button. anim.gif is a looping 3 by 2 GIF
  // of two frames, red then a green row over a blue one.
  const gif = path.join(seed, 'anim.gif');
  fs.writeFileSync(gif, Buffer.from('R0lGODlhAwACAPEAAAAAAP8AAAD/AAAA/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQEFAAAACwAAAAAAwACAAACBQzDMAxTACH5BAQUAAAALAAAAAADAAIAAAIFFEVxHFcAOw==', 'base64'));
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(gif))})`, 'anim.gif listed');
  await clickRow(s, gif);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'image' && document.querySelector('img.file-image')?.complete && document.querySelector('img.file-image')?.naturalWidth === 3`, 'the GIF shown as a picture');
  const gif1 = await s.evalJs(`({ label: document.querySelector('.file-image-pause')?.textContent, canvas: !!document.querySelector('canvas.file-image'), size: document.querySelector('.file-image-size')?.textContent })`);
  expect(gif1.label === 'Pause' && !gif1.canvas && gif1.size === '3 \u00d7 2', `the GIF has a Pause button, no canvas, and says its size, got ${JSON.stringify(gif1)}`);
  const gifCursor = await s.evalJs(`({ cursor: document.querySelector('.file-view').dataset.cursor ?? null, css: getComputedStyle(document.querySelector('img.file-image')).cursor })`);
  expect(gifCursor.cursor === null && gifCursor.css !== 'zoom-in', `fix 820: the 3 by 2 GIF at fit has no magnifier, got ${JSON.stringify(gifCursor)}`);
  await s.evalJs(`document.querySelector('.file-image-pause').click()`);
  await s.waitFor(`document.querySelector('canvas.file-image')?.width === 3 && document.querySelector('canvas.file-image')?.height === 2 && document.querySelector('img.file-image').hidden === true && document.querySelector('.file-image-pause').textContent === 'Play'`, 'Pause shows a still canvas and the button reads Play');
  console.log('fix 638 paused pixel r,g,b,a', JSON.stringify(await s.evalJs(`Array.from(document.querySelector('canvas.file-image').getContext('2d').getImageData(0, 0, 1, 1).data)`)));
  await s.screenshot('m11-gif-paused.png');
  await s.evalJs(`document.querySelector('canvas.file-image').click()`);
  await s.waitFor(`document.querySelector('.file-view').dataset.zoom === 'actual'`, 'a click on the paused picture shows actual size');
  await s.evalJs(`document.querySelector('canvas.file-image').click()`);
  await s.waitFor(`document.querySelector('.file-view').dataset.zoom === 'fit'`, 'a second click fits again');
  await s.evalJs(`document.querySelector('.file-image-pause').click()`);
  await s.waitFor(`!document.querySelector('canvas.file-image') && document.querySelector('img.file-image').hidden === false && document.querySelector('.file-image-pause').textContent === 'Pause'`, 'Play shows the running picture again');
  step('fix 638: a GIF has a Pause button in its header; Pause holds a still frame the click to zoom still works on, and Play runs the picture again');
  // M9 fix 820: the 3 by 2 GIF fits at scale 1, so = twice steps it
  // through 125 to 150 percent.
  await s.evalJs(`document.querySelector('.file-image-host').focus()`);
  await s.key('=', 'Equal', 187);
  await s.key('=', 'Equal', 187);
  await s.waitFor(`document.querySelector('.file-view').dataset.scale === '1.5'`, 'two = presses take the small GIF to 150 percent', 4000);
  const gifPix = await s.evalJs(`({ pixelated: document.querySelector('.file-view').hasAttribute('data-pixelated'), css: getComputedStyle(document.querySelector('img.file-image')).imageRendering })`);
  expect(gifPix.pixelated && gifPix.css === 'pixelated', `fix 820: above 100 percent the picture draws its pixels, got ${JSON.stringify(gifPix)}`);
  await s.key('0', 'Digit0', 48);
  await s.waitFor(`document.querySelector('.file-view').dataset.zoom === 'fit'`, '0 goes back to fit', 4000);
  step('fix 820: a small picture has no magnifier at fit, steps to 150 percent by = and shows its pixels there');
  await clickRow(s, blob);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'binary'`, 'the binary file back in front');
  expect((await tabs(s)).join(',') === 'panes,blob.bin*', `the strip is back to the one file tab, blob.bin: ${await tabs(s)}`);

  // M9 fix 40: a sidebar click lands on the session. The binary tab is on
  // show, so a click on the shell's row brings the panes view back in
  // front of it, with the pane focused and the keyboard in the terminal,
  // where it used to leave the file tab up and the session out of sight.
  const layoutTabs = (s) => s.evalJs(`[...document.querySelectorAll('.tab.tab-panes')].map(t => t.querySelector('.tab-name').textContent + (t.dataset.current ? '*' : ''))`);
  const shownTabPanes = (s) => s.evalJs(`[...document.querySelectorAll('.layout-tab:not([hidden]) .pane')].map(p => p.dataset.paneId)`);
  const rowShown = (s, id) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]')?.dataset.shown ?? null`);
  const clickSessionRow = (s, id) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]').click()`);
  const prefix = (s) => s.key('b', 'KeyB', 66, CTRL);
  const firstShell = (await zreq(s, 'session.list', {})).sessions[0].id;
  expect((await activeTab(s)) === blob, 'the binary file tab is in front');
  // M9 fix 269: with the file tab in front no pane is visible, so the
  // shell's row reads on Panes, the one layout tab's name, with its
  // ground and edge off, as a session a tab away does.
  const rowPlace = (s, id) => s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]'); return { shown: r?.dataset.shown ?? null, place: r?.dataset.place ?? null, word: r?.querySelector('.sidebar-row-shown')?.textContent ?? null }; })()`);
  const underFile = await rowPlace(s, firstShell);
  expect(underFile.shown === null && underFile.place === 'elsewhere' && underFile.word === 'on Panes', `under a file tab the shell reads on Panes with data-shown off, got ${JSON.stringify(underFile)}`);
  step('fix 269: a row reads on Panes under a file tab over a one-tab layout');
  await clickSessionRow(s, firstShell);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'the row click brought the panes view back');
  expect(await s.evalJs(`document.querySelector('.panes-view').dataset.hidden === undefined`), 'the panes are visible');
  expect((await tabs(s)).join(',') === 'panes*,blob.bin', `the file tab stays open behind: ${await tabs(s)}`);
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(firstShell)}]')?.dataset.shown === 'focused'`, 'the session focused');
  expect(await inTerminal(s), 'the keyboard is in the terminal');
  step('fix 40: a row click under a file tab puts the panes view in front with the session focused');

  // The layout tabs (M36).
  const one = await getTabs(s);
  expect(one.tabs.length === 1 && one.tabs[0].name === 'Panes' && one.currentTabId === one.tabs[0].id, 'one layout tab named Panes to start');
  const firstTabId = one.tabs[0].id;
  const firstPanes = await shownTabPanes(s);
  expect((await rowShown(s, firstShell)) === 'focused', 'the first shell is marked focused in the sidebar');

  // + makes an empty tab named Panes 2 and switches to it.
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2`, 'a second layout tab');
  expect((await layoutTabs(s)).join(',') === 'Panes,Panes 2*', `the strip: ${await layoutTabs(s)}`);
  const two = await getTabs(s);
  const secondTabId = two.tabs[1].id;
  expect(two.currentTabId === secondTabId && two.tabs[1].root.kind === 'pane' && two.tabs[1].root.sessionId === null, 'the daemon shows the new tab, one empty pane');
  await s.waitFor(`!!document.querySelector('.layout-tab:not([hidden]) .empty-pane')`, 'the empty pane of the new tab on screen');
  const secondPanes = await shownTabPanes(s);
  expect(secondPanes.length === 1 && !firstPanes.includes(secondPanes[0]), 'the pane on screen is the new one');
  expect((await rowShown(s, firstShell)) === null, 'the first shell is not marked in the sidebar now');
  // M9 fix 220: a layout tab with no session in any pane draws no mark;
  // the first tab, with its shell, keeps one. M9 fix 627: a tab of shells
  // alone wears the shell mark, so the read names the kind, the tone (a
  // Claude mark's alone) and whether it runs.
  const tabMarkJs = (tabId) =>
    `(() => { const t = document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(tabId)}]'); if (t === null) return 'no tab'; const m = t.querySelector('.tab-mark'); return m === null ? null : { kind: m.classList.contains('shell-mark') ? 'shell' : 'claude', tone: m.dataset.tone ?? null, running: m.dataset.running === 'true' }; })()`;
  const tabMarkOf = (tabId) => s.evalJs(tabMarkJs(tabId));
  expect((await tabMarkOf(secondTabId)) === null, `the empty tab wears no mark, got ${JSON.stringify(await tabMarkOf(secondTabId))}`);
  // The start-up burst can run the shell mark for a moment (as
  // verify-m14-attention.mjs met), so the still shell mark is waited for.
  await s.waitFor(`(() => { const m = ${tabMarkJs(firstTabId)}; return m !== null && m.kind === 'shell' && !m.running; })()`, 'the first tab, a shell alone, wears the shell mark still (M9 fix 627)', 10000);
  step('+ makes an empty tab and switches to it');

  // M9 fix 363: the tab the + just made names its own last place on the
  // strip, after the file tab already open (blob.bin, the only one kept
  // at this point, M9 fix 182's "only files kept" starting case), rather
  // than stripOrder's fresh-profile guess of the panes tabs first.
  const stripKeys = () => s.evalJs(`[...document.querySelectorAll('.tab')].map(t => t.dataset.key)`);
  expect((await stripKeys()).join() === [`tab:${firstTabId}`, blob, `tab:${secondTabId}`].join(), `the new tab lands last, after the open file: ${await stripKeys()}`);
  // Then a kept order ending in a file, with a layout tab already named
  // (the shape tab-order.test.ts's stripOrder cases pin), written to
  // localStorage directly and read back on a reload: stripOrder's own
  // guess for the tab it does not yet know (secondTabId here) still
  // splices it right after the named layout tab, ahead of the file, as
  // fix 346 always did; a freshly pressed tab is the one this fix forces
  // to the end regardless.
  // blob.bin is still the preview tab from its single click above (fix
  // 203); keeping that in the written state matters for a later step
  // (M9 fix 40's second half) that reads it replaced, not kept beside a
  // newly opened file.
  await s.evalJs(`localStorage.setItem('emerald.tabs', JSON.stringify({ files: [${JSON.stringify(blob)}], active: 'panes', raw: [], query: {}, preview: ${JSON.stringify(blob)}, order: ['tab:${firstTabId}', ${JSON.stringify(blob)}] }))`);
  await s.send('Page.reload');
  await sleep(1500);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2`, 'the reload reads the daemon-held tabs back');
  expect((await stripKeys()).join() === [`tab:${firstTabId}`, `tab:${secondTabId}`, blob].join(), `the kept order restores with the unnamed tab spliced ahead of the file (fix 346, unchanged): ${await stripKeys()}`);
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 3`, 'a third layout tab');
  const thirdTabId = (await getTabs(s)).currentTabId;
  expect((await stripKeys()).join() === [`tab:${firstTabId}`, `tab:${secondTabId}`, blob, `tab:${thirdTabId}`].join(), `the freshly pressed tab still lands last, after the file: ${await stripKeys()}`);
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(thirdTabId)}] .tab-close').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2`, 'the third tab closed again');
  step('fix 363: a new layout tab lands last on a fresh profile too, and after a kept order restored from localStorage');

  // M9 fix 362: an idle session with an agent still out steps the tab's
  // mark in the idle tone rather than sitting still, so the star that
  // stands for its team keeps moving; a returned agent leaves it still
  // again.
  const daemonRecord = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const postHook = async (sessionId, payload) => {
    const res = await fetch(`http://127.0.0.1:${daemonRecord.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemonRecord.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ session_id: 'sim-362', cwd: seed, ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  const tabWorkingOf = (tabId) => s.evalJs(`(() => { const t = document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(tabId)}]'); return t.querySelector('.tab-mark')?.dataset.working ?? null; })()`);
  await postHook(firstShell, { hook_event_name: 'SubagentStart', agent_id: 'fix362-a1', agent_type: 'Explore' });
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}] .tab-mark')?.dataset.tone === 'idle'`, 'the tab mark steps once an agent is out');
  // data-working lands a frame after the tone on a fast box (two of five runs at the batch of fixes 372 to 393 read it too early), so it is waited for.
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}] .tab-mark')?.dataset.working === 'true'`, 'the tab mark carries motion while the agent is out');
  await postHook(firstShell, { hook_event_name: 'SubagentStop', agent_id: 'fix362-a1', agent_type: 'Explore' });
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}] .tab-mark')?.dataset.working !== 'true'`, 'the tab mark stops moving once the agent returns');
  const back362 = await tabMarkOf(firstTabId);
  expect(back362?.kind === 'claude' && back362.tone === 'idle', `the tab mark stays the idle Claude mark once the agent returns, got ${JSON.stringify(back362)}`);
  step('fix 362: the panes tab steps in the idle tone while an agent is out, and stops once it returns');

  // Fix 24: the hairline runs under the inactive tab and the +, not under
  // the active tab, which paints its bottom edge in the content ground.
  const edges = await s.evalJs(
    `(() => { const c = (sel) => getComputedStyle(document.querySelector(sel)).borderBottomColor; return { active: c('.tab.tab-panes[data-active]'), idle: c('.tab.tab-panes:not([data-active])'), add: c('.tab-add'), strip: getComputedStyle(document.querySelector('.tab-strip')).borderBottomWidth }; })()`,
  );
  expect(edges.strip === '0px' && edges.idle === 'rgb(45, 45, 45)' && edges.add === 'rgb(45, 45, 45)', `the hairline is under the inactive tab and the +, not on the strip, got ${JSON.stringify(edges)}`);
  expect(edges.active === 'rgb(30, 30, 30)', `the active tab's bottom edge is the content ground, got ${JSON.stringify(edges)}`);
  step('fix 24: the hairline under the inactive tab and the +, the active tab joined to the content');

  // A shell started in it is not on screen in the first tab and its row is not marked there.
  await startShellByKey(s);
  const secondShell = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id !== firstShell).id;
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(secondShell)}]')?.dataset.shown === 'focused'`, 'the new shell marked focused');
  await s.waitFor(`!!document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}] .tab-mark.shell-mark')`, 'the shell mark on the tab once a shell is in it (fix 220, M9 fix 627)');
  await prefix(s);
  await s.key('p', 'KeyP', 80);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(firstTabId)}`, 'p goes to the previous tab');
  expect((await getTabs(s)).currentTabId === firstTabId, 'the daemon says the first tab is on show');
  expect((await rowShown(s, secondShell)) === null && (await rowShown(s, firstShell)) === 'focused', 'in the first tab only its shell is marked');
  // M9 fix 249: the second tab's shell is on a pane, so its row says
  // which tab holds it rather than "on no pane", and data-place carries
  // elsewhere while data-shown stays off.
  const elsewhere = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(secondShell)}]'); return { place: r?.dataset.place ?? null, word: r?.querySelector('.sidebar-row-shown')?.textContent ?? null }; })()`);
  expect(elsewhere.place === 'elsewhere' && elsewhere.word === 'on Panes 2', `the second tab's shell reads on Panes 2 from the first tab, got ${JSON.stringify(elsewhere)}`);
  expect((await shownTabPanes(s)).join() === firstPanes.join(), 'the first tab shows its own panes');
  expect(await s.evalJs(`document.querySelectorAll('.term-host').length === 2`), 'both terminals stay mounted');
  expect(await s.evalJs(`document.querySelector('.layout-tab[hidden] .term-host') !== null`), 'the other tab keeps its terminal hidden, not gone');
  await prefix(s);
  await s.key('n', 'KeyN', 78);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'n goes to the next tab');
  await prefix(s);
  await s.key('n', 'KeyN', 78);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(firstTabId)}`, 'n wraps to the first tab');
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'a click on a layout tab');
  await s.screenshot('m36-two-tabs.png');
  step('a shell in the second tab is off screen in the first; n and p switch and wrap');

  // M9 fix 40, the other half: from the first tab with a file tab in
  // front, a click on the row of the shell in the second tab puts the
  // panes view back and that tab on show, with its pane focused.
  await prefix(s);
  await s.key('p', 'KeyP', 80);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(firstTabId)}`, 'back on the first tab');
  await clickRow(s, hello);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(hello)}`, 'a file tab in front');
  // blob.bin was the preview tab, so hello.json took its place (fix 203).
  expect(!(await s.evalJs(`!!document.querySelector(${JSON.stringify(tabSel(blob))})`)) && (await previews(s)).join() === hello, `the preview tab reused across layout tabs: ${await tabs(s)}`);
  // M9 fix 269: under the file tab the first tab's shell reads on Panes
  // as the second tab's reads on Panes 2; neither is focused or shown.
  const underFileTwo = { first: await rowPlace(s, firstShell), second: await rowPlace(s, secondShell) };
  expect(underFileTwo.first.shown === null && underFileTwo.first.word === 'on Panes' && underFileTwo.second.shown === null && underFileTwo.second.word === 'on Panes 2', `under a file tab on a two-tab layout both shells read their tab, got ${JSON.stringify(underFileTwo)}`);
  await clickSessionRow(s, secondShell);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'the row click brought the panes view back');
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'and put the second tab on show');
  const landed = await getTabs(s);
  expect(landed.currentTabId === secondTabId, 'the daemon says the second tab is on show');
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(secondShell)}]')?.dataset.shown === 'focused'`, 'the shell marked focused');
  const landedTab = landed.tabs.find((t) => t.id === secondTabId);
  expect(await s.evalJs(`document.querySelector('.layout-tab:not([hidden]) .pane.focused')?.dataset.paneId === ${JSON.stringify(landedTab.focusedPaneId)}`), 'its pane is the focused one on screen');
  expect(await inTerminal(s), 'the keyboard is in the terminal');
  // The file tab goes so the rest of the run sees the strip it expects.
  for (const file of [hello]) {
    await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(file))}).dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(tabSel(file))})`, 'the file tab closed');
  }
  expect((await activeTab(s)) === 'panes', 'still on the panes');
  step('fix 40: a row click on a session in a hidden layout tab, under a file tab, puts that tab and the panes in front');

  // M9 fix 578 (here rather than in verify:m9, whose daemon reports level 1 and cannot make layout tabs): the chooser's Open in a new tab, with Remember ticked, adds
  // a layout tab named after the row's folder heading holding one pane with
  // the session, leaves the old tab's panes as they were and stores nothing;
  // the row menu's item does the same; each new tab is closed again so fix
  // 95 starts on the tab it expects.
  const tabsNow = () => getTabs(s);
  const rowBox = (id) => s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const chooserClick = (label) => s.evalJs(`[...document.querySelectorAll('.show-chooser .menu-item')].find(b => b.querySelector('.menu-label').textContent.endsWith(${JSON.stringify(label)})).click()`);
  const offT = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: seed, cols: 120, rows: 30 })).session;
  await s.waitFor(`!!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(offT.id)}]')`, 'the row of the tab shell');
  const headingOf = (id) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]').closest('.sidebar-group').querySelector('.sidebar-group-name').textContent`);
  const freeName = (names, name) => {
    if (!names.includes(name)) return name;
    for (let n = 2; ; n++) if (!names.includes(`${name} ${n}`)) return `${name} ${n}`;
  };
  const before578 = await tabsNow();
  const origTab = before578.tabs.find((t) => t.id === before578.currentTabId);
  const expectName = freeName(before578.tabs.map((t) => t.name), await headingOf(offT.id));
  const backToOrig = async () => {
    await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(origTab.id)}]').click()`);
    await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(origTab.id)}`, 'the old tab current again');
  };
  const closeMade = async (id) => {
    await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(id)}] .tab-close').click()`);
    for (let i = 0; i < 50 && (await tabsNow()).tabs.length !== before578.tabs.length; i++) await sleep(100);
    expect((await tabsNow()).tabs.length === before578.tabs.length, 'the new tab closed again');
  };
  await clickSessionRow(s, offT.id);
  await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(offT.id)}`, 'the chooser for the tab shell');
  await chooserClick('Remember my choice');
  await s.waitFor(`document.querySelector('.show-chooser [data-checked="true"]') !== null`, 'Remember ticked for the tab');
  await chooserClick('Open in a new tab');
  await s.waitFor(`!document.querySelector('.show-chooser')`, 'the chooser closed on Open in a new tab');
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(offT.id)}]')?.dataset.shown === 'focused'`, 'the tab shell is on show');
  const after578 = await tabsNow();
  const made = after578.tabs.find((t) => !before578.tabs.some((b) => b.id === t.id));
  expect(after578.tabs.length === before578.tabs.length + 1 && made !== undefined && after578.currentTabId === made.id && made.name === expectName && made.root.kind === 'pane' && made.root.sessionId === offT.id && JSON.stringify(after578.tabs.find((t) => t.id === origTab.id).root) === JSON.stringify(origTab.root), `the new tab is current, named ${expectName}, one pane with the session, the old tab's panes unchanged (${JSON.stringify({ made, names: after578.tabs.map((t) => t.name) })})`);
  expect([null, 'ask'].includes(await s.evalJs(`localStorage.getItem('emerald.showOffscreen')`)), 'a ticked Remember stores nothing for a new tab');
  await backToOrig();
  await closeMade(made.id);
  await s.rightClick(...Object.values(await rowBox(offT.id)));
  await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(offT.id)}`, 'the row menu of the tab shell');
  const tabItem = await s.evalJs(`(() => { const b = [...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Open in a new tab'); return { disabled: b.disabled, title: b.title }; })()`);
  expect(!tabItem.disabled && tabItem.title === `Show ${offT.name} in a new panes tab of its own, named after its folder`, `the row menu's item is on with its title (${JSON.stringify(tabItem)})`);
  await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Open in a new tab').click()`);
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(offT.id)}]')?.dataset.shown === 'focused'`, 'the row menu put the tab shell on show');
  const afterMenu = await tabsNow();
  const madeMenu = afterMenu.tabs.find((t) => !before578.tabs.some((b) => b.id === t.id));
  expect(afterMenu.tabs.length === before578.tabs.length + 1 && madeMenu !== undefined && afterMenu.currentTabId === madeMenu.id && madeMenu.name === expectName && madeMenu.root.kind === 'pane' && madeMenu.root.sessionId === offT.id, `the row menu's tab is current, named ${expectName}, one pane with the session (${JSON.stringify(madeMenu)})`);
  await backToOrig();
  await closeMade(madeMenu.id);
  await zreq(s, 'session.kill', { sessionId: offT.id, remove: true });
  step('M9 fix 578: Open in a new tab, from the chooser with Remember ticked and from the row menu, adds a current tab named for the folder heading with the session alone, the old panes kept, nothing remembered');

  // M9 fix 182: the tabs draw in the strip's own order and a tab dragged
  // along the strip lands where it is dropped, a file tab between two
  // layout tabs included; the order survives a reload and the keys walk
  // it. The second tab is on show and the rail is on the seed.
  const move = (p) => s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
  const keys = () => s.evalJs(`[...document.querySelectorAll('.tab')].map(t => t.dataset.key)`);
  const boxOf = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
  const keySel = (k) => `.tab[data-key=${JSON.stringify(k)}]`;
  const firstKey = `tab:${firstTabId}`;
  const secondKey = `tab:${secondTabId}`;
  const dragTab = async (key, to) => {
    const from = await boxOf(keySel(key));
    await s.mouse('mousePressed', from.cx, from.cy);
    await move({ x: from.cx + 8, y: from.cy });
    await move(to);
  };
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(hello))})`, 'the rail on the seed');
  // hello.json pinned, index.ts the preview (fix 203), so both are tabs.
  await openRow(s, hello);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(hello)}`, 'hello.json open');
  // src folds back when the rail re-reads the seed, so open it again.
  if (!(await s.evalJs(`!!document.querySelector(${JSON.stringify(rowSel(index))})`))) {
    await clickRow(s, path.join(seed, 'src'));
    await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(index))})`, 'src expanded');
  }
  await clickRow(s, index);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(index)}`, 'index.ts open');
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'back on the panes');
  expect((await keys()).join() === [firstKey, secondKey, hello, index].join(), `the strip starts in the old order: ${await keys()}`);
  // index.ts picked up and dropped before the first layout tab: the
  // insertion line on that tab while the pointer is there, the dragged
  // tab dimmed, and after the release the order moved with nothing
  // switched to, since the click a drag's release fires is swallowed.
  const firstBox = await boxOf(keySel(firstKey));
  await dragTab(index, { x: firstBox.x + 4, y: firstBox.cy });
  expect(await s.evalJs(`document.body.classList.contains('dragging-tab')`), 'the drag is on');
  expect(await s.evalJs(`document.querySelector(${JSON.stringify(keySel(index))}).dataset.dragging !== undefined`), 'the dragged tab is marked');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(keySel(firstKey))}).dataset.drop`)) === 'before', 'the insertion line before the first layout tab');
  expect((await s.evalJs(`document.querySelector('.drag-ghost')?.textContent`)) === 'index.ts', 'the ghost carries the name');
  await s.screenshot('m9-fix182-drag.png');
  await s.mouse('mouseReleased', firstBox.x + 4, firstBox.cy);
  await s.waitFor(`[...document.querySelectorAll('.tab')].map(t => t.dataset.key)[0] === ${JSON.stringify(index)}`, 'index.ts first');
  expect((await keys()).join() === [index, firstKey, secondKey, hello].join(), `a file tab before the layout tabs: ${await keys()}`);
  expect((await previews(s)).length === 0, 'the drag pinned the preview tab (fix 203)');
  expect(!(await s.evalJs(`document.body.classList.contains('dragging-tab')`)) && (await s.evalJs(`document.querySelectorAll('.tab[data-drop], .tab[data-dragging], .drag-ghost').length`)) === 0, 'the drag ended clean');
  expect((await activeTab(s)) === 'panes' && (await getTabs(s)).currentTabId === secondTabId, 'nothing switched: still the panes, the second tab on show');
  // The first layout tab dragged to the end, over the +: the line after
  // the last tab, and the + still last after the drop.
  const addBox = await boxOf('.tab-add');
  await dragTab(firstKey, { x: addBox.cx, y: addBox.cy });
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(keySel(hello))}).dataset.drop`)) === 'after', 'the line after the last tab for a drop at the end');
  await s.mouse('mouseReleased', addBox.cx, addBox.cy);
  await s.waitFor(`[...document.querySelectorAll('.tab')].map(t => t.dataset.key).pop() === ${JSON.stringify(firstKey)}`, 'the first tab last');
  expect((await keys()).join() === [index, secondKey, hello, firstKey].join(), `the order after the second drag: ${await keys()}`);
  expect(await s.evalJs(`document.querySelector('.tab-strip-clip').nextElementSibling?.classList.contains('tab-add')`), 'the + is still last');
  // M9 fix 346: a new layout tab from the + still lands last on the
  // strip, after every file tab, even with the kept order already
  // interleaving one among the layout tabs (index, secondKey, hello,
  // firstKey here). The drag's release above arms the strip's click
  // swallow until the renderer's next timer tick, and a click sent
  // within a millisecond or two of it is the one swallowed (it was, on
  // one run in three), so the + waits a moment first.
  await sleep(100);
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 3`, 'a third layout tab');
  const newKey = (await keys()).pop();
  expect((await keys()).join() === [index, secondKey, hello, firstKey, newKey].join(), `the new tab lands last, after every file tab: ${await keys()}`);
  expect(await s.evalJs(`document.querySelector('.tab-strip-clip').nextElementSibling?.classList.contains('tab-add')`), 'and the + is still last after it');
  const newTabId = (await getTabs(s)).currentTabId;
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(newTabId)}] .tab-close').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2`, 'closed again');
  expect((await keys()).join() === [index, secondKey, hello, firstKey].join(), `back to the order before it: ${await keys()}`);
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'back on the second tab');
  // A press that moves and is cancelled by Escape moves nothing.
  const helloBox = await boxOf(keySel(hello));
  await dragTab(secondKey, { x: helloBox.x + helloBox.width - 4, y: helloBox.cy });
  expect(await s.evalJs(`document.body.classList.contains('dragging-tab')`), 'a third drag is on');
  await s.key('Escape', 'Escape', 27);
  await s.mouse('mouseReleased', helloBox.x + helloBox.width - 4, helloBox.cy);
  await sleep(200);
  expect((await keys()).join() === [index, secondKey, hello, firstKey].join(), `Escape cancelled the drag: ${await keys()}`);
  expect((await s.evalJs(`document.querySelectorAll('.tab[data-drop], .tab[data-dragging], .drag-ghost').length`)) === 0, 'and left no mark');
  // Ctrl+PageDown walks the strip as it reads, a panes tab and a file
  // each one stop: from the second tab to hello.json, to the first tab,
  // then wrapping to index.ts; PageUp back to the first tab.
  await s.key('PageDown', 'PageDown', 34, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(hello)}`, 'PageDown to hello.json');
  await s.key('PageDown', 'PageDown', 34, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes' && document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(firstTabId)}`, 'PageDown to the first layout tab');
  await s.key('PageDown', 'PageDown', 34, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(index)}`, 'PageDown wraps to index.ts');
  await s.key('PageUp', 'PageUp', 33, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes' && document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(firstTabId)}`, 'PageUp back to the first layout tab');
  // Ctrl+B n and p walk the layout tabs in the strip's order, the file
  // tabs skipped: from the first (last on the strip) n wraps to the second.
  await prefix(s);
  await s.key('n', 'KeyN', 78);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'n wraps to the second tab, first on the strip');
  await prefix(s);
  await s.key('p', 'KeyP', 80);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(firstTabId)}`, 'p back to the first');
  // The order survives a reload.
  await s.send('Page.reload');
  await sleep(1500);
  await s.waitFor(`document.querySelectorAll('.tab').length === 4`, 'the tabs back after the reload');
  expect((await keys()).join() === [index, secondKey, hello, firstKey].join(), `the order is as it was: ${await keys()}`);
  await s.screenshot('m9-fix182-order.png');
  // Back to the old order and the strip the rest of the run expects.
  for (const file of [hello, index]) {
    await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(file))}).dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(tabSel(file))})`, 'the file tab closed');
  }
  const secondBoxNow = await boxOf(keySel(secondKey));
  await dragTab(firstKey, { x: secondBoxNow.x + 4, y: secondBoxNow.cy });
  await s.mouse('mouseReleased', secondBoxNow.x + 4, secondBoxNow.cy);
  await s.waitFor(`[...document.querySelectorAll('.tab')].map(t => t.dataset.key).join() === ${JSON.stringify([firstKey, secondKey].join())}`, 'the old order back');
  await sleep(300);
  expect((await getTabs(s)).currentTabId === firstTabId, 'the drop switched nothing');
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'the second tab on show again');
  step('fix 182: tabs drag along the strip, a file tab between layout tabs, the + last, the order kept across a reload and walked by the keys');

  // M9 fix 183: a strip wider than its box fades its cut edges (data-cut
  // on the strip: end, start or both), so a tab past the edge shows as a
  // tab half under a fade rather than nothing. Layout tabs are added
  // until the strip overflows; each new one is current and scrolled into
  // view, so the strip lands scrolled to its end.
  const cut = () => s.evalJs(`document.querySelector('.tab-strip-scroll').dataset.cut ?? null`);
  const stripWidths = () => s.evalJs(`(() => { const e = document.querySelector('.tab-strip-scroll'); return { scroll: e.scrollWidth, client: e.clientWidth, left: e.scrollLeft }; })()`);
  expect((await cut()) === null, `two tabs fit: no cut edge, got ${await cut()}`);
  const before183 = (await getTabs(s)).tabs.length;
  // Tabs are added until the newest, scrolled into view as current, has
  // pushed the start past the edge. The + and the chevrons sit outside the
  // scroller since fix 616, so only the tabs overflow it.
  let added = 0;
  while (added < 12) {
    if (['start', 'both'].includes(await cut())) break;
    await s.evalJs(`document.querySelector('.tab-add').click()`);
    added++;
    await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === ${before183 + added}`, 'a layout tab added');
    await sleep(150);
  }
  const wide = await stripWidths();
  expect(wide.scroll > wide.client + 1, `the strip overflows after ${added} tabs (${wide.scroll} in ${wide.client})`);
  expect(['start', 'both'].includes(await cut()), `scrolled for the new tab: the start is cut, got ${await cut()}`);
  await s.evalJs(`(() => { const e = document.querySelector('.tab-strip-scroll'); e.scrollLeft = e.scrollWidth; })()`);
  await s.waitFor(`document.querySelector('.tab-strip-scroll').dataset.cut === 'start'`, 'scrolled to the very end: the start alone is cut');
  const fade = await s.evalJs(`(() => { const b = getComputedStyle(document.querySelector('.tab-strip-clip'), '::before'); const a = getComputedStyle(document.querySelector('.tab-strip-clip'), '::after'); return { before: b.content, after: a.content, width: b.width }; })()`);
  expect(fade.before === '""' && fade.after === 'none', `the start fade drawn and not the end one, got ${JSON.stringify(fade)}`);
  await s.screenshot('m9-fix183-cut-start.png');
  await s.evalJs(`document.querySelector('.tab-strip-scroll').scrollLeft = 0`);
  await s.waitFor(`document.querySelector('.tab-strip-scroll').dataset.cut === 'end'`, 'scrolled to the start: the end is cut');
  await s.evalJs(`(() => { const e = document.querySelector('.tab-strip-scroll'); e.scrollLeft = Math.round((e.scrollWidth - e.clientWidth) / 2); })()`);
  await s.waitFor(`document.querySelector('.tab-strip-scroll').dataset.cut === 'both'`, 'scrolled to the middle: both edges cut');
  expect(await s.evalJs(`(() => { const b = getComputedStyle(document.querySelector('.tab-strip-clip'), '::before'); const a = getComputedStyle(document.querySelector('.tab-strip-clip'), '::after'); return b.content === '""' && a.content === '""'; })()`), 'both fades drawn');
  await s.screenshot('m9-fix183-cut-both.png');
  // M9 fix 616: an arrow on each cut edge pages the strip on a press (real
  // mouse events, since it pages on the press), a held press keeps going.
  const arrowState = () => s.evalJs(`(() => { const e = document.querySelector('.tab-strip-scroll'); const a = (side) => document.querySelector('.tab-strip-arrow[data-side="' + side + '"]'); return { left: e.scrollLeft, client: e.clientWidth, cut: e.dataset.cut ?? null, startOff: a('start')?.disabled, endOff: a('end')?.disabled }; })()`);
  const press = async (side, holdMs = 0) => {
    const b = await boxOf(`.tab-strip-arrow[data-side="${side}"]`);
    await s.mouse('mousePressed', b.cx, b.cy);
    if (holdMs > 0) await sleep(holdMs);
    await s.mouse('mouseReleased', b.cx, b.cy);
  };
  await s.evalJs(`document.querySelector('.tab-strip-scroll').scrollLeft = 0`);
  await s.waitFor(`document.querySelector('.tab-strip-scroll').dataset.cut === 'end'`, 'scrolled to 0 for the arrows');
  const a0 = await arrowState();
  expect(a0.startOff === true && a0.endOff === false, `at the start the start arrow is disabled and the end one lit, got ${JSON.stringify(a0)}`);
  await press('end');
  const a1 = await arrowState();
  expect(a1.left > 0 && a1.left <= a1.client && ['both', 'start'].includes(a1.cut), `one click on the end arrow pages the strip, got ${JSON.stringify(a1)}`);
  for (let i = 0; i < 3 && (await arrowState()).left > 0; i++) await press('start');
  const a2 = await arrowState();
  expect(a2.left === 0 && a2.cut === 'end' && a2.startOff === true, `the start arrow pages back to 0, got ${JSON.stringify(a2)}`);
  await press('end', 900);
  const a3 = await arrowState();
  expect(a3.left > a1.left || a3.cut === 'start', `a held press pages more than one click, got ${JSON.stringify(a3)}`);
  await sleep(500);
  expect((await arrowState()).left === a3.left, 'the repeat stopped on the release');
  await s.screenshot('m9-fix616-arrows.png');
  // The reproduction of the demo's "wrapped": the activity tab's own
  // header at this width, read for whether it overflows (it cannot
  // wrap, being nowrap flex) so the Notes can say what the person saw.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`!!document.querySelector('.activity-card .activity-expand')`, 'the rail on Activity');
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.state === 'ready'`, 'the activity tab');
  const header = await s.evalJs(`(() => { const h = document.querySelector('.activity-view .file-header'); return { scroll: h.scrollWidth, client: h.clientWidth, height: h.getBoundingClientRect().height, buttons: h.querySelectorAll('button').length }; })()`);
  console.log(`[verify] fix 183 reproduction: the activity tab's header is ${header.client}px wide with ${header.scroll}px of controls (${header.buttons} buttons) at ${header.height}px tall`);
  expect(header.height < 40, `the header stays one line (${header.height}px)`);
  await s.waitFor(`document.querySelector('.tab-strip-scroll').dataset.cut === 'start' || document.querySelector('.tab-strip-scroll').dataset.cut === 'both'`, 'the new tab scrolled into view at the end');
  await s.screenshot('m9-fix183-activity-tab.png');
  // Back to two layout tabs and no file tab; the fades go with the overflow.
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector('.activity-view')`, 'the activity tab closed');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  for (const t of (await getTabs(s)).tabs.slice(before183)) {
    await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(t.id)}] .tab-close').click()`);
    await s.waitFor(`!document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(t.id)}]')`, 'an added tab closed');
  }
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2 && !document.querySelector('.tab-strip-scroll').dataset.cut && !document.querySelector('.tab-strip-arrow')`, 'two tabs again, no cut edge');
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'the second tab on show again');
  step(`fix 183 and fix 616: the strip past its width fades its cut edges and pages from its arrows, a held press repeating (${added} tabs added to overflow), neither once the tabs fit`);

  // M9 fix 184: back and forward through the focus history, the two
  // chevrons at the strip's left end. From the second tab's pane B: a
  // click on the first tab (pane A), a row click back to B, then back
  // lands on tab 1 with A focused and forward on tab 2 with B; the keys
  // and the mouse's back button do the same; a file tab is a place too
  // and, once closed, is stepped over; a pane hidden is stepped over.
  // The chevrons re-render a beat after the layout push, so a title is
  // waited for and the disabled flag read once it is there.
  const chevronTitle = (which, title) => s.waitFor(`document.querySelector('.tab-history-step[data-action=${JSON.stringify(which)}]')?.title === ${JSON.stringify(title)}`, `${which} says ${JSON.stringify(title)}`);
  const chevron = (which) => s.evalJs(`(() => { const b = document.querySelector('.tab-history-step[data-action=${JSON.stringify(which)}]'); return b === null ? null : { disabled: b.disabled, title: b.title }; })()`);
  const stepBy = (which) => s.evalJs(`document.querySelector('.tab-history-step[data-action=${JSON.stringify(which)}]').click()`);
  const onTab = (tabId) => `document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(tabId)}`;
  const named = (await zreq(s, 'session.list', {})).sessions;
  const firstName = named.find((x) => x.id === firstShell).name;
  const secondName = named.find((x) => x.id === secondShell).name;
  const paneB = landedTab.focusedPaneId;
  const paneA = (await getTabs(s)).tabs.find((t) => t.id === firstTabId).focusedPaneId;
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}]').click()`);
  await s.waitFor(onTab(firstTabId), 'the first tab by a click');
  await clickSessionRow(s, secondShell);
  await s.waitFor(onTab(secondTabId), 'the second tab by its row');
  await chevronTitle('back', `Back to ${firstName} in Panes (Ctrl+Alt+Left)`);
  await chevronTitle('forward', 'Nothing to go forward to');
  let back = await chevron('back');
  let forward = await chevron('forward');
  expect(!back.disabled && forward.disabled, `back is on and forward off at the end of the history, got ${JSON.stringify({ back, forward })}`);
  await stepBy('back');
  await s.waitFor(`${onTab(firstTabId)} && ${focusedPaneIs(paneA)}`, 'back lands on the first tab with pane A focused');
  await chevronTitle('forward', `Forward to ${secondName} in Panes 2 (Ctrl+Alt+Right)`);
  expect(!(await chevron('forward')).disabled, 'forward is on with a place ahead');
  await stepBy('forward');
  await s.waitFor(`${onTab(secondTabId)} && ${focusedPaneIs(paneB)}`, 'forward lands on the second tab with pane B focused');
  await s.waitFor(`document.activeElement?.classList.contains('xterm-helper-textarea') === true`, 'the keyboard is in the terminal after the step');
  await s.key('ArrowLeft', 'ArrowLeft', 37, CTRL | ALT);
  await s.waitFor(`${onTab(firstTabId)} && ${focusedPaneIs(paneA)}`, 'Ctrl+Alt+Left goes back');
  await s.key('ArrowRight', 'ArrowRight', 39, CTRL | ALT);
  await s.waitFor(`${onTab(secondTabId)} && ${focusedPaneIs(paneB)}`, 'Ctrl+Alt+Right goes forward');
  await s.evalJs(`document.querySelector('.panes-view').dispatchEvent(new MouseEvent('auxclick', { button: 3, bubbles: true }))`);
  await s.waitFor(onTab(firstTabId), 'the mouse back button goes back');
  await s.evalJs(`document.querySelector('.panes-view').dispatchEvent(new MouseEvent('auxclick', { button: 4, bubbles: true }))`);
  await s.waitFor(onTab(secondTabId), 'the mouse forward button goes forward');
  step('fix 184: back and forward walk the focus across the layout tabs by chevron, by key and by mouse button');

  await clickRow(s, hello);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(hello)}`, 'a file tab in front');
  await stepBy('back');
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes' && ${onTab(secondTabId)}`, 'back from the file tab lands on the panes');
  await chevronTitle('forward', 'Forward to hello.json (Ctrl+Alt+Right)');
  expect(!(await chevron('forward')).disabled, 'forward is on with the file tab ahead');
  await stepBy('forward');
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(hello)}`, 'forward brings the file tab back');
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel(hello))}).dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }))`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(tabSel(hello))}) && document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'the file tab closed, the panes in front');
  await chevronTitle('forward', 'Nothing to go forward to');
  expect((await chevron('forward')).disabled, 'nothing ahead once the file tab is closed');
  await chevronTitle('back', `Back to ${firstName} in Panes (Ctrl+Alt+Left)`);
  step('fix 184: a file tab is a place in the history; closed, it is stepped over');

  // A pane hidden: a split on tab 2 gives pane C the focus, a click on B
  // takes it back, so back would go to C; C hidden, back goes past it and
  // past B itself to tab 1.
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.layout-tab:not([hidden]) .pane').length === 2`, 'a split on the second tab');
  const paneC = (await getTabs(s)).tabs.find((t) => t.id === secondTabId).focusedPaneId;
  expect(paneC !== paneB, 'the new pane took the focus');
  const boxB = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneB)}]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(boxB.x, boxB.y);
  await s.waitFor(focusedPaneIs(paneB), 'pane B focused again by a click');
  await chevronTitle('back', 'Back to an empty pane in Panes 2 (Ctrl+Alt+Left)');
  const boxC = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneC)}]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(boxC.x, boxC.y);
  await s.waitFor(focusedPaneIs(paneC), 'pane C focused for the hide');
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.layout-tab:not([hidden]) .pane').length === 1 && ${focusedPaneIs(paneB)}`, 'C hidden, the focus back on B');
  await chevronTitle('back', `Back to ${firstName} in Panes (Ctrl+Alt+Left)`);
  await stepBy('back');
  await s.waitFor(`${onTab(firstTabId)} && ${focusedPaneIs(paneA)}`, 'back lands on tab 1');
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]').click()`);
  await s.waitFor(onTab(secondTabId), 'the second tab back on show for the rest of the run');
  step('fix 184: a hidden pane is stepped over');

  // A rename from the menu shows on the tab.
  const secondBox = await s.evalJs(`(() => { const r = document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(secondBox.x, secondBox.y);
  await s.waitFor(`document.querySelector('.layout-tab-menu')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'the layout tab menu');
  const tabLabels = await s.evalJs(`[...document.querySelectorAll('.layout-tab-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent + (b.disabled ? ' (disabled)' : ''))`);
  expect(tabLabels.join(',') === 'Rename,Shade all,Lift all,Move to new window,Close tab', `the menu items (M63 adds the shade pair, fix 867 Move to new window): ${tabLabels.join(',')}`);
  await s.evalJs(`[...document.querySelectorAll('.layout-tab-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Rename').click()`);
  await s.waitFor(`!!document.querySelector('.tab-rename')`, 'the rename box');
  await setInput(s, '.tab-rename', 'build');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}] .tab-name')?.textContent === 'build'`, 'the new name on the tab');
  expect((await getTabs(s)).tabs[1].name === 'build', 'the daemon has the name');
  step('a rename shows on the tab');

  // Closing the tab leaves the session listed and lands on the previous tab.
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}] .tab-close').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 1`, 'the tab closed');
  const afterClose = await getTabs(s);
  expect(afterClose.currentTabId === firstTabId && afterClose.tabs.length === 1, 'the first tab is on show');
  expect(await s.evalJs(`!!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(secondShell)}]')`), 'the shell is still listed');
  expect((await rowShown(s, secondShell)) === null && JSON.stringify(afterClose).includes(secondShell) === false, 'and in no pane');
  expect((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === secondShell).state !== 'exited', 'and still running');
  expect(await s.evalJs(`document.querySelectorAll('.term-host').length === 1`), 'its terminal went with the tab');
  step('closing the tab leaves the session listed and lands on the previous tab');

  // The last tab cannot close: no x on it, and the menu item is off.
  expect(await s.evalJs(`document.querySelector('.tab.tab-panes .tab-close') === null`), 'no close button on the last tab');
  const lastBox = await s.evalJs(`(() => { const r = document.querySelector('.tab.tab-panes').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(lastBox.x, lastBox.y);
  await s.waitFor(`!!document.querySelector('.layout-tab-menu')`, 'the menu on the last tab');
  const lastLabels = await s.evalJs(`[...document.querySelectorAll('.layout-tab-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent + (b.disabled ? ' (disabled)' : ''))`);
  expect(lastLabels.join(',') === 'Rename,Shade all,Lift all,Move to new window (disabled),Close tab (disabled)', `the last tab's menu: ${lastLabels.join(',')}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.layout-tab-menu')`, 'menu closed');
  step('the last tab cannot close');

  // A state.json from before M36 (one tree, no tabs) is read as one tab
  // named Panes holding that tree. The daemon is killed, the file written
  // under it, and the app's autostart brings a daemon up that reads it.
  const oldTree = { root: { kind: 'pane', id: 'pane-from-before', sessionId: firstShell }, focusedPaneId: 'pane-from-before', revision: 40 };
  stopDaemon();
  await s.waitFor(`!!document.querySelector('.banner')`, 'disconnected banner', 10000);
  fs.writeFileSync(path.join(emeraldHome, 'state.json'), JSON.stringify({ version: 1, layout: oldTree }, null, 2));
  await s.waitFor(`!document.querySelector('.banner')`, 'reconnect after daemon autostart', 20000);
  const migrated = await getTabs(s);
  expect(migrated.tabs.length === 1 && migrated.tabs[0].name === 'Panes' && migrated.currentTabId === migrated.tabs[0].id, 'one tab named Panes');
  expect(migrated.tabs[0].root.id === 'pane-from-before' && migrated.tabs[0].focusedPaneId === 'pane-from-before' && migrated.revision === 40, 'holding the stored tree at its revision');
  await s.waitFor(`document.querySelector('.layout-tab:not([hidden]) .pane')?.dataset.paneId === 'pane-from-before'`, 'the stored pane on screen');
  expect((await layoutTabs(s)).join(',') === 'Panes*', `the strip: ${await layoutTabs(s)}`);
  step('a state.json from before M36 is read as one tab');

  // M9 fix 227. The window so far ran with cdp.mjs's EMERALD_WHATS_NEW=off,
  // so its profile holds no emerald.whatsNewSeen; a second window on the
  // same daemon and profile with the check on must open the tab. The
  // heading expected is read off the checkout's file, so a later batch's
  // docs commit moves nothing here.
  const notesText = fs.readFileSync(path.join(repoRoot, 'docs', 'WHATS-NEW.md'), 'utf8');
  const newest = notesText.split(/\r?\n/).map((l) => /^##\s+(.+?)\s*$/.exec(l)).find((m) => m !== null)[1];
  const whatsNewTabs = () => s.evalJs(`[...document.querySelectorAll('.tab')].filter((t) => t.querySelector('.tab-name')?.textContent === "What's new").map((t) => (t.dataset.active ? 'active' : 'open'))`);
  s.close();
  killTree(s.child);
  // EMERALD_PICK_FILE answers the file chooser for the fix 341 step below.
  s = await launch(freshPort(), { env: { EMERALD_WHATS_NEW: 'on', EMERALD_PICK_FILE: notes } });
  app = s;
  await s.waitFor(`document.querySelector('.whats-new-view')?.dataset.state === 'text'`, "the What's New tab open with the notes read", 15000);
  // The layout too: the first window's kill takes its daemon, its
  // reconnect loop can start another before the window itself is gone,
  // and that one dies with the tree after this window has connected to
  // it, so the panes tab lands a second or two after the notes.
  await s.waitFor(`!!document.querySelector('.tab[data-tab="panes"]')`, 'the layout synced on the second window', 15000);
  expect(JSON.stringify(await whatsNewTabs()) === '["active"]', `one What's new tab, active, on the fresh profile: ${JSON.stringify(await whatsNewTabs())}`);
  expect((await s.evalJs(`document.querySelector('.whats-new-view').dataset.stamp`)) === newest, `the view's stamp is the file's newest heading (${newest})`);
  const h2 = await s.evalJs(`[...document.querySelectorAll('.whats-new-view .markdown h2')].map((h) => h.textContent)`);
  expect(h2[0] === newest, `the newest section is the first heading rendered: ${JSON.stringify(h2)}`);
  expect(await s.evalJs(`!!document.querySelector('.tab[data-active] svg.tab-icon path')`), 'the tab wears the spark icon');
  expect((await s.evalJs(`localStorage.getItem('emerald.whatsNewSeen')`)) === newest, 'the heading was written as seen at the open');
  await s.screenshot('m9-fix227-whats-new.png');
  // M9 fix 272: every ## and ### is a folding section. On this tab the
  // older batches open folded and the newest open; a click on a heading
  // folds its section, and the fold is kept across a tab switch, which
  // unmounts the view.
  const foldsJs = `[...document.querySelectorAll('.whats-new-view .markdown .md-fold[data-level="2"]')].map((f) => (f.hasAttribute('data-folded') ? 'folded' : 'open'))`;
  const folds = await s.evalJs(foldsJs);
  expect(folds.length === h2.length && folds[0] === 'open' && folds.slice(1).every((f) => f === 'folded'), `the newest batch open and the older ones folded: ${JSON.stringify(folds)}`);
  const olderShown = await s.evalJs(`[...document.querySelectorAll('.whats-new-view .markdown .md-fold[data-level="2"]')].slice(1).map((f) => [...f.children].slice(1).filter((c) => c.getBoundingClientRect().height > 0).length)`);
  expect(olderShown.every((n) => n === 0), `a folded batch shows its heading alone: ${JSON.stringify(olderShown)}`);
  const subJs = `document.querySelector('.whats-new-view .markdown .md-fold[data-level="2"] .md-fold[data-level="3"]')`;
  const subHeading = await s.evalJs(`${subJs}?.firstElementChild?.textContent ?? null`);
  expect(subHeading !== null, `the newest batch has a ### section (${subHeading})`);
  expect((await s.evalJs(`${subJs}.hasAttribute('data-folded')`)) === false, `${subHeading} opens unfolded`);
  const subShown = () => s.evalJs(`[...${subJs}.children].slice(1).filter((c) => c.getBoundingClientRect().height > 0).length`);
  expect((await subShown()) > 0, `${subHeading} shows its paragraphs`);
  await s.screenshot('fix-272-whats-new.png');
  await s.evalJs(`${subJs}.firstElementChild.click()`);
  await s.waitFor(`${subJs}.hasAttribute('data-folded')`, `a click on ${subHeading} folds it`);
  expect((await subShown()) === 0, `${subHeading}'s paragraphs are gone from view`);
  await s.evalJs(`document.querySelector('.tab[data-tab="panes"]').click()`);
  await s.waitFor(`!document.querySelector('.whats-new-view')`, 'the panes tab in front, the view unmounted');
  await s.evalJs(`[...document.querySelectorAll('.tab')].find((t) => t.querySelector('.tab-name')?.textContent === "What's new").click()`);
  await s.waitFor(`document.querySelector('.whats-new-view')?.dataset.state === 'text' && !!${subJs}`, "the What's New tab back with the notes");
  expect(JSON.stringify(await s.evalJs(foldsJs)) === JSON.stringify(folds), `the batches' folds kept across the switch: ${JSON.stringify(await s.evalJs(foldsJs))}`);
  expect((await s.evalJs(`${subJs}.hasAttribute('data-folded')`)) === true && (await subShown()) === 0, `${subHeading} still folded after the switch`);
  await s.evalJs(`${subJs}.firstElementChild.click()`);
  await s.waitFor(`!${subJs}.hasAttribute('data-folded')`, 'a second click unfolds it');
  expect((await subShown()) > 0, 'and its paragraphs are back');
  step('fix 272: the older batches open folded and the newest open, a heading click folds its section and the fold is kept across a tab switch');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector('.whats-new-view')`, 'Ctrl+W closed the tab');
  expect(JSON.stringify(await whatsNewTabs()) === '[]', "no What's new tab after the close");
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body') && !!document.querySelector('.tab-strip')`, 'the app back after the reload', 20000);
  await sleep(1500);
  expect(JSON.stringify(await whatsNewTabs()) === '[]', `a reload on a profile that has seen the heading opens nothing: ${JSON.stringify(await whatsNewTabs())}`);
  // The picker is the pane's own overlay, so the panes must be on show
  // for its box to take the focus (a file tab left active by the reload).
  await s.evalJs(`document.querySelector('.tab[data-tab="panes"]').click()`);
  await s.waitFor(`document.querySelector('.panes-view').dataset.hidden === undefined`, 'the panes on show');
  await s.key('j', 'KeyJ', 74, CTRL);
  await s.waitFor(`!!document.querySelector('.picker-overlay') && document.activeElement?.classList.contains('palette-input')`, 'Ctrl+J opened the palette');
  await s.type('>what');
  await s.waitFor(`document.querySelector('.picker-overlay .action-row')?.dataset.action === 'whats-new'`, "> what lists What's new first");
  expect((await s.evalJs(`document.querySelector('.picker-overlay .action-row .action-label, .picker-overlay .action-row')?.textContent`)).includes("What's new"), "the row is labelled What's new");
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`!document.querySelector('.picker-overlay') && document.querySelector('.whats-new-view')?.dataset.state === 'text'`, 'Enter opened the tab again with the notes');
  expect(JSON.stringify(await whatsNewTabs()) === '["active"]', 'the reopened tab is the one tab and active');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector('.whats-new-view')`, 'closed again');
  step("fix 227: the What's New tab opened active on a fresh profile with the newest heading, wrote it as seen, stayed shut across a reload and came back from the palette");

  // M9 fix 341: a file from anywhere. `emmer open <file>` against this
  // window's pipe opens it as a pinned tab; `--pane` puts it in a pane
  // beside the focused one on the panes tab; and the open-file action
  // through the palette runs the chooser, answered by EMERALD_PICK_FILE.
  const cliMain = path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js');
  const cliOpen = (...args) => {
    const r = spawnSync(process.execPath, [cliMain, 'open', ...args], { env: process.env, encoding: 'utf8', windowsHide: true });
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
  };
  const fileTabs = () => s.evalJs(`[...document.querySelectorAll('.tab-file')].map((t) => ({ tab: t.dataset.tab, preview: t.dataset.preview !== undefined, active: t.dataset.active !== undefined }))`);
  // The profile carries the earlier steps' tabs (index.ts in preview),
  // so the reads are against what was there; the two files this step
  // opens are closed first if a profile a crashed run left behind holds
  // them.
  for (const file of [hello, notes]) {
    if (!(await fileTabs()).some((t) => t.tab === file)) continue;
    await s.evalJs(`[...document.querySelectorAll('.tab-file')].find((t) => t.dataset.tab === ${JSON.stringify(file)}).click()`);
    await s.waitFor(`document.querySelector('.tab-file[data-active]')?.dataset.tab === ${JSON.stringify(file)}`, 'the leftover tab active');
    await s.key('w', 'KeyW', 87, CTRL);
    await s.waitFor(`![...document.querySelectorAll('.tab-file')].some((t) => t.dataset.tab === ${JSON.stringify(file)})`, 'the leftover tab closed');
  }
  const tabsBefore341 = await fileTabs();
  const activePinned = (file) => `document.querySelectorAll('.tab-file').length === ${tabsBefore341.length + 1} && document.querySelector('.tab-file[data-active]')?.dataset.tab === ${JSON.stringify(file)} && !document.querySelector('.tab-file[data-active][data-preview]')`;
  let cliRun = cliOpen(hello);
  expect(cliRun.code === 0 && cliRun.out.trim() === `opened ${hello}`, `emmer open exits 0 and says what it opened (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  await s.waitFor(activePinned(hello), 'the file is a pinned, active tab', 5000);
  cliRun = cliOpen(hello, '--json');
  expect(cliRun.code === 0 && JSON.parse(cliRun.out).apps === 1 && JSON.parse(cliRun.out).path === hello && JSON.parse(cliRun.out).answered === true, `--json answers the path, one window, and that the window answered (${JSON.stringify(cliRun.out)})`);
  await sleep(300);
  expect((await fileTabs()).length === tabsBefore341.length + 1, 'a second open of the same file is the same tab');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === ${tabsBefore341.length}`, 'Ctrl+W closed the tab');
  const panesBefore341 = (await s.evalJs(`document.querySelectorAll('.pane').length`));
  cliRun = cliOpen(index, '--pane');
  expect(cliRun.code === 0 && cliRun.out.trim() === `opened ${index} in a pane`, `--pane says so (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  await s.waitFor(`document.querySelectorAll('.pane').length === ${panesBefore341 + 1} && document.querySelectorAll('.pane[data-view="file"]').length === 1 && document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'a file pane beside the focused one, the panes on show', 5000);
  const filePane341 = leaves(await getLayout(s)).find((l) => l.view?.kind === 'file');
  expect(filePane341 !== undefined && filePane341.view.path === index, `the pane's view is the file, got ${JSON.stringify(filePane341?.view)}`);
  expect((await s.evalJs(`document.querySelectorAll('.tab-file').length`)) === tabsBefore341.length, 'no tab for the pane form');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(filePane341.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === ${panesBefore341}`, 'the file pane closed', 5000);
  // The chooser, through the palette (fix 202), answered by the harness.
  await s.key('j', 'KeyJ', 74, CTRL);
  await s.waitFor(`!!document.querySelector('.picker-overlay') && document.activeElement?.classList.contains('palette-input')`, 'Ctrl+J opened the palette for the chooser');
  await s.type('>open a file');
  await s.waitFor(`document.querySelector('.picker-overlay .action-row')?.dataset.action === 'open-file'`, '> open a file lists Open a file… first');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`!document.querySelector('.picker-overlay') && ${activePinned(notes)}`, "the chooser's answer opened as a pinned, active tab", 5000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === ${tabsBefore341.length}`, 'closed again');
  step('fix 341: emmer open puts a file in a pinned tab, --pane in a pane beside the focused one, and the Open a file… action runs the chooser into a pinned tab');

  // M9 fix 527: an `emmer open` sent while the window reloads is held by
  // the main process until the new page says it listens, then opened.
  // A busy-wait registered for the next document (M9 fix 550) runs after
  // the reload's commit and before any page script, holding App's mount,
  // and with it the ready, for 1.5 s; the CLI is sent inside that hold,
  // so the held line is written and judged. Since M9 fix 582 the CLI
  // waits up to 3 s for the window's answer and exits 75 when none
  // comes, so its spawnSync blocks through the hold; the line after fix
  // 550's prints its exit code, how long it took and its first line (M9
  // fix 604), read and not judged.
  const heldCount = (file) => fs.readFileSync(path.join(emeraldHome, 'logs', 'main.log'), 'utf8').split('\n').filter((l) => l.includes(`open: ${file} held until the window is listening`)).length;
  const heldBefore = heldCount(hello);
  const { identifier: holdScript550 } = await s.send('Page.addScriptToEvaluateOnNewDocument', { source: 'const t = performance.now(); while (performance.now() - t < 1500) {}' });
  const reloadAt550 = Date.now();
  await s.send('Page.reload');
  const cliAt604 = Date.now();
  cliRun = cliOpen(hello);
  const cliMs604 = Date.now() - cliAt604;
  await s.waitFor(`!!document.querySelector('.tab-strip')`, 'the page is back after the reload', 20000);
  await s.waitFor(activePinned(hello), 'the open sent during the reload landed as a pinned, active tab', 10000);
  console.log(`fix 550: the page and the tab were back ${Date.now() - reloadAt550} ms after the reload`);
  const cliFirst604 = [cliRun.out, cliRun.err].join('\n').split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  console.log(`fix 604: emmer open sent during the reload exited ${cliRun.code} after ${cliMs604} ms, first line ${JSON.stringify(cliFirst604)}`);
  await s.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: holdScript550 });
  expect(heldCount(hello) === heldBefore + 1, `the open sent during the reload was held until the page listened (held lines ${heldBefore} to ${heldCount(hello)}, cli exit ${cliRun.code})`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === ${tabsBefore341.length}`, 'Ctrl+W closed the tab');
  step('M9 fix 527: an emmer open sent while the window reloads is held and opened once the page listens');

  // M9 fix 375: `emmer open <file> --scheme <name>` sets the file's own
  // colour scheme (fix 340's pick, kept by path) before opening it, so a
  // file already open takes it too: the shipped Dracula on hello.json
  // puts its ground under the editor and its name on the view;
  // --clear-scheme puts the window's back; --scheme nosuch keeps the
  // pick, shows the window's ground, and the CLI says the name is not
  // among the window's schemes. The hex is read off the shipped file.
  const seededScheme = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages', 'app', 'resources', 'schemes', 'dracula.json'), 'utf8'));
  const hexToRgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  const viewJs375 = `[...document.querySelectorAll('.file-view')].find((v) => v.dataset.path === ${JSON.stringify(hello)})`;
  const groundRead = () => s.evalJs(`(() => { const v = ${viewJs375}; const host = v?.querySelector('.monaco-editor-background'); return { scheme: v?.dataset.scheme ?? null, ground: host ? getComputedStyle(host).backgroundColor : null }; })()`);
  const pickKept = () => s.evalJs(`JSON.parse(localStorage.getItem('emerald.fileSchemes') ?? '[]').filter(([p]) => p.toLowerCase() === ${JSON.stringify(hello.toLowerCase())}).map(([, n]) => n)`);
  cliRun = cliOpen(hello);
  expect(cliRun.code === 0, `hello.json opened plainly first (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  await s.waitFor(`${activePinned(hello)} && !!${viewJs375}?.querySelector('.monaco-editor-background')`, 'the file up with its editor', 10000);
  const windowGround375 = await groundRead();
  expect(windowGround375.scheme === null && windowGround375.ground !== null, `the file follows the window to begin with (${JSON.stringify(windowGround375)})`);
  cliRun = cliOpen(hello, '--scheme', seededScheme.name);
  expect(cliRun.code === 0 && cliRun.out.trim() === `opened ${hello} in ${seededScheme.name}`, `--scheme says the scheme and nothing more (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  await s.waitFor(`${viewJs375}?.dataset.scheme === ${JSON.stringify(seededScheme.name)}`, 'the open view takes the scheme', 5000);
  const schemed375 = await groundRead();
  expect(schemed375.ground === hexToRgb(seededScheme.background), `the editor's ground is the scheme's ${seededScheme.background} (${JSON.stringify(schemed375)})`);
  expect(JSON.stringify(await pickKept()) === JSON.stringify([seededScheme.name]), `the pick is kept by path (${JSON.stringify(await pickKept())})`);
  expect((await fileTabs()).length === tabsBefore341.length + 1, 'still the one tab');
  cliRun = cliOpen(hello, '--scheme', seededScheme.name, '--json');
  expect(cliRun.code === 0 && JSON.parse(cliRun.out).scheme === seededScheme.name && JSON.parse(cliRun.out).known === true, `--json carries the scheme and known: true (${JSON.stringify(cliRun.out)})`);
  cliRun = cliOpen(hello, '--clear-scheme');
  expect(cliRun.code === 0 && cliRun.out.trim() === `opened ${hello}, its own scheme cleared`, `--clear-scheme says so (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  await s.waitFor(`${viewJs375}?.dataset.scheme === undefined`, "the window's scheme back on the view", 5000);
  expect((await groundRead()).ground === windowGround375.ground && (await pickKept()).length === 0, `the window's ground back and no pick kept (${JSON.stringify(await groundRead())})`);
  cliRun = cliOpen(hello, '--scheme', 'nosuch');
  expect(cliRun.code === 0 && cliRun.out.trim().split(/\r?\n/).length === 2 && cliRun.out.includes(`opened ${hello} in nosuch`) && cliRun.out.includes("nosuch is not among the window's schemes"), `an unknown name opens the file and the CLI says the name is unknown, exit 0 (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  await s.waitFor(`JSON.parse(localStorage.getItem('emerald.fileSchemes') ?? '[]').some(([, n]) => n === 'nosuch')`, 'the unknown pick is kept', 5000);
  await sleep(300);
  expect((await groundRead()).scheme === null && (await groundRead()).ground === windowGround375.ground, `and the view shows no colour for it (${JSON.stringify(await groundRead())})`);
  cliRun = cliOpen(hello, '--clear-scheme');
  await s.waitFor(`JSON.parse(localStorage.getItem('emerald.fileSchemes') ?? '[]').length === 0`, 'the pick cleared for the next steps', 5000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === ${tabsBefore341.length}`, 'the tab closed');
  step('fix 375: emmer open --scheme sets the open file\'s own scheme (the ground and the name on the view, the pick kept by path), --clear-scheme puts the window\'s back, and an unknown name is kept with no colour and one line from the CLI');

  // M9 fix 364: the same chooser, no palette, straight off the plain
  // chord Ctrl+Shift+G.
  await s.key('g', 'KeyG', 71, CTRL | SHIFT);
  await s.waitFor(activePinned(notes), 'Ctrl+Shift+G ran the chooser into a pinned tab too', 5000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === ${tabsBefore341.length}`, 'closed again');
  step('fix 364: Ctrl+Shift+G opens a file, the same chooser as the palette action');

  // M9 fix 376: `emmer open <file> --beside <session>` puts the file in
  // a pane split beside that session's pane on its own tab, whatever
  // tab is in front (a file tab here), --pane implied; a bare --beside
  // is the session the command runs in (EMERALD_SESSION_ID); a session on
  // no pane falls back to beside the focused pane and the CLI says so.
  // The target is a fresh shell spawned as a row and given a pane of its
  // own by a shift-click on its row (every session from before the fix
  // 227 relaunch is exited, and Ctrl+Shift+N replaces the focused pane's
  // shell rather than making a pane).
  // The tab's name comes back too (M9 fix 404): the reply names the pane
  // the window picked and the tab it sits on, so the compare needs both.
  const paneOf376 = async (sessionId) => {
    const tabsNow = await getTabs(s);
    for (const t of tabsNow.tabs) {
      const i = leaves({ root: t.root }).findIndex((l) => l.sessionId === sessionId);
      if (i !== -1) return { tabId: t.id, tabName: t.name, index: i, leaves: leaves({ root: t.root }) };
    }
    return null;
  };
  await s.evalJs(`document.querySelector('.tab[data-tab="panes"]').click()`);
  await s.waitFor(`document.querySelector('.panes-view').dataset.hidden === undefined`, 'the panes on show for the target');
  const { session: target376 } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: seed, name: 'beside-target', cols: 80, rows: 24 });
  const targetRow376 = `.sidebar-row[data-session-id=${JSON.stringify(target376.id)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(targetRow376)})`, "the target's row", 10000);
  await s.evalJs(`document.querySelector(${JSON.stringify(targetRow376)}).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
  await s.waitFor(`document.querySelector(${JSON.stringify(targetRow376)})?.dataset.place === 'focused'`, 'the target in a pane of its own', 10000);
  const targetPane376 = await paneOf376(target376.id);
  expect(targetPane376 !== null, `the target is on a pane (${target376.id})`);
  const panesBefore376 = targetPane376.leaves.length;
  // A file tab in front, so the open must find the panes tab itself.
  cliRun = cliOpen(hello);
  await s.waitFor(activePinned(hello), 'a file tab in front', 5000);
  cliRun = cliOpen(index, '--beside', target376.id);
  // M9 fix 404: the line names the pane the window picked and its tab.
  const besideWord376 = `${target376.name} (${target376.id.slice(0, 8)})`;
  const pickedPane376 = targetPane376.leaves[targetPane376.index].id;
  // M9 fix 432: the printed line cuts the pane id to eight characters,
  // the same as a session's short id; --json below keeps the full one.
  expect(cliRun.code === 0 && cliRun.out.trim() === `opened ${index} beside ${besideWord376} in pane ${pickedPane376.slice(0, 8)} on tab ${targetPane376.tabName}`, `--beside says the session it opened beside and the pane and tab it picked (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes' && document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'the panes on show with one file pane', 5000);
  let after376 = await paneOf376(target376.id);
  expect(after376.leaves.length === panesBefore376 + 1 && after376.tabId === targetPane376.tabId, `one more pane on the target's tab (${after376.leaves.length} for ${panesBefore376 + 1})`);
  let filePane376 = after376.leaves[after376.index + 1];
  expect(filePane376?.view?.kind === 'file' && filePane376.view.path === index, `the file pane is the leaf right after the target's, its sibling (${JSON.stringify(filePane376?.view)})`);
  expect((await getTabs(s)).currentTabId === targetPane376.tabId, "the target's tab is the one in front");
  expect((await s.evalJs(`document.querySelectorAll('.tab-file').length`)) === tabsBefore341.length + 1, 'no tab for the beside form (the hello tab alone)');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(filePane376.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 0`, 'the file pane closed', 5000);
  // A bare --beside, with the session in the environment.
  cliRun = (() => {
    const r = spawnSync(process.execPath, [cliMain, 'open', index, '--beside', '--json'], { env: { ...process.env, EMERALD_SESSION_ID: target376.id }, encoding: 'utf8', windowsHide: true });
    return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
  })();
  expect(cliRun.code === 0 && JSON.parse(cliRun.out).beside === target376.id && JSON.parse(cliRun.out).besideFound === true && JSON.parse(cliRun.out).pane === true, `a bare --beside is the session the command runs in, --json saying so (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  // M9 fix 404: the record carries the pick as well as the session.
  expect(JSON.parse(cliRun.out).besidePane === pickedPane376 && JSON.parse(cliRun.out).besideTab === targetPane376.tabName, `--json carries the pane id and the tab name it picked (${JSON.stringify(cliRun.out)})`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'the file pane again', 5000);
  after376 = await paneOf376(target376.id);
  filePane376 = after376.leaves[after376.index + 1];
  expect(filePane376?.view?.kind === 'file', 'beside the target again');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(filePane376.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 0`, 'closed', 5000);
  // A session on no pane: a shell spawned as a listed row.
  const { session: rowOnly376 } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: seed, cols: 80, rows: 24 });
  await sleep(500);
  expect((await paneOf376(rowOnly376.id)) === null, 'the spawned shell is on no pane');
  const focusedBefore376 = (await getLayout(s)).focusedPaneId;
  cliRun = cliOpen(index, '--beside', rowOnly376.id);
  const lines376 = cliRun.out.trim().split(/\r?\n/);
  expect(cliRun.code === 0 && lines376.length === 2 && lines376[0] === `opened ${index} in a pane` && lines376[1] === `${rowOnly376.name} (${rowOnly376.id.slice(0, 8)}) is on no pane; opened beside the focused pane`, `a session on no pane: the file beside the focused pane and the CLI says so, exit 0 (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'the file pane beside the focused one', 5000);
  const fallback376 = leaves(await getLayout(s));
  const focusedAt376 = fallback376.findIndex((l) => l.id === focusedBefore376);
  expect(focusedAt376 !== -1 && fallback376[focusedAt376 + 1]?.view?.kind === 'file', `the file pane is the leaf after the pane that was focused (${JSON.stringify(fallback376.map((l) => l.view?.kind ?? l.sessionId?.slice(0, 8) ?? 'empty'))})`);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(fallback376[focusedAt376 + 1].id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 0`, 'the fallback pane closed', 5000);
  // The panes back as found (the file panes are closed above): the
  // target's pane hidden and both shells removed, the hello tab closed.
  await zreq(s, 'session.kill', { sessionId: rowOnly376.id, remove: true });
  const targetAt376 = await paneOf376(target376.id);
  const targetPaneId376 = targetAt376.leaves[targetAt376.index].id;
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(targetPaneId376)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(targetPaneId376)}]') === null`, "the target's pane hidden", 5000);
  await zreq(s, 'session.kill', { sessionId: target376.id, remove: true });
  await s.evalJs(`[...document.querySelectorAll('.tab-file')].find((t) => t.dataset.tab === ${JSON.stringify(hello)})?.click()`);
  await s.waitFor(`document.querySelector('.tab-file[data-active]')?.dataset.tab === ${JSON.stringify(hello)}`, 'the hello tab active for its close');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === ${tabsBefore341.length}`, 'the hello tab closed');
  step("fix 376: emmer open --beside <session> splits the file beside that session's pane on its own tab with a file tab in front, a bare --beside is the session the command runs in, and a session on no pane falls back to beside the focused pane with a line saying so");

  // M9 fix 404: a session can be on panes in several layout tabs (M50),
  // and paneShowingIn takes the tab in front first and then tab order,
  // so the file lands beside a pane the caller never named. The reply
  // now names the pane and its tab, and --json carries both; the read
  // is the same session on two tabs, opened once with each in front.
  const tabsBefore404 = (await getTabs(s)).tabs.length;
  const { session: target404 } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: seed, name: 'beside-two', cols: 80, rows: 24 });
  const row404 = `.sidebar-row[data-session-id=${JSON.stringify(target404.id)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(row404)})`, "the two-pane target's row", 10000);
  // A pane of its own on the tab in front (a shift-click, the fix 376
  // shape), then a second layout tab with the same session in its pane.
  await s.evalJs(`document.querySelector(${JSON.stringify(row404)}).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
  await s.waitFor(`document.querySelector(${JSON.stringify(row404)})?.dataset.place === 'focused'`, 'the target in a pane of its own', 10000);
  const tabA404 = await paneOf376(target404.id);
  expect(tabA404 !== null, `the target is on a pane of the first tab (${target404.id})`);
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === ${tabsBefore404 + 1}`, 'a layout tab for the second pane', 5000);
  // A row click on a session that is already on a pane jumps to that
  // pane and switches to its tab (M36, M50, and the fix 183 step above
  // reads exactly that), so the second pane is made through the layout
  // instead: the new tab's one empty pane takes the session, the root's
  // shape and its focusedPaneId untouched.
  const lay404 = await getTabs(s);
  const tabB404 = lay404.tabs.find((t) => t.id === lay404.currentTabId);
  const paneA404 = tabA404.leaves[tabA404.index];
  expect(tabB404 !== undefined && tabB404.id !== tabA404.tabId && tabB404.root.kind === 'pane' && tabB404.root.sessionId === null, `the new tab is in front with one empty pane (${JSON.stringify({ current: lay404.currentTabId, tabA: tabA404.tabId })})`);
  const paneB404 = tabB404.root;
  await zreq(s, 'layout.set', { layout: { ...lay404, tabs: lay404.tabs.map((t) => (t.id === tabB404.id ? { ...t, root: { ...t.root, sessionId: target404.id } } : t)) } });
  await s.waitFor(
    `(async () => { const l = (await window.emerald.request('layout.get', {})).layout; const t = l.tabs.find((x) => x.id === ${JSON.stringify(tabB404.id)}); return t !== undefined && t.root.sessionId === ${JSON.stringify(target404.id)}; })()`,
    "the session on the second tab's pane",
    5000,
  );
  expect(paneB404.id !== paneA404.id, `the session is on one pane per tab (${JSON.stringify({ a: paneA404?.id, b: paneB404?.id })})`);
  // The second tab is in front, so that is the pane the window picks.
  cliRun = cliOpen(index, '--beside', target404.id, '--json');
  const json404 = JSON.parse(cliRun.out);
  expect(cliRun.code === 0 && json404.besidePane === paneB404.id && json404.besideTab === tabB404.name, `with the second tab in front the pick is its pane, named on the record (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)}, wanted ${paneB404.id} on ${tabB404.name})`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'the file pane on the second tab', 5000);
  const fileP404 = leaves({ root: (await getTabs(s)).tabs.find((t) => t.id === tabB404.id).root }).find((l) => l.view?.kind === 'file');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(fileP404.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 0`, 'the file pane on the second tab closed', 5000);
  // The first tab in front: the same command picks its pane instead.
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(tabA404.tabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(tabA404.tabId)}][data-active]') !== null`, 'the first tab in front', 5000);
  cliRun = cliOpen(index, '--beside', target404.id);
  expect(cliRun.code === 0 && cliRun.out.trim() === `opened ${index} beside ${target404.name} (${target404.id.slice(0, 8)}) in pane ${paneA404.id.slice(0, 8)} on tab ${tabA404.tabName}`, `with the first tab in front the line names that tab's pane (${cliRun.code}: ${JSON.stringify(cliRun.out + cliRun.err)})`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'the file pane on the first tab', 5000);
  // The panes and the tabs back as found: both file panes gone, the
  // second layout tab closed, the session killed and its pane with it.
  const fileA404 = leaves({ root: (await getTabs(s)).tabs.find((t) => t.id === tabA404.tabId).root }).find((l) => l.view?.kind === 'file');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(fileA404.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 0`, 'the file pane on the first tab closed', 5000);
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(tabB404.id)}] .tab-close').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === ${tabsBefore404}`, 'the second layout tab closed', 5000);
  // The shift-click split a pane off only because the tab already held
  // a live one; the last pane of a tab cannot be hidden, so the hide is
  // asked for only when there is something to go back to.
  const backTab404 = (await getTabs(s)).tabs.find((t) => t.id === tabA404.tabId);
  if (leaves({ root: backTab404.root }).length > 1) {
    await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneA404.id)}] .pane-hide').click()`);
    await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(paneA404.id)}]') === null`, "the two-pane target's pane hidden", 5000);
  }
  await zreq(s, 'session.kill', { sessionId: target404.id, remove: true });
  step("fix 404: emmer open --beside names the pane and the tab it picked, the tab in front deciding which of a session's panes the file lands beside, and --json carries both");

  // M9 fix 342: a second launch with a file on its command line, on this
  // window's profile (the single-instance lock is keyed on it), hands
  // the path to this window and exits 0 at once; the file lands here as
  // a pinned tab. The spawn line is launch's own without the devtools
  // port, and the file is the last argument, as Explorer's open passes
  // it. A launch that took ten seconds or more would be one that opened
  // a window of its own.
  // M9 fix 700: the usage record on for this step, to read what the launch
  // is recorded as; the window's own switch, left off again after.
  const usageFile700 = path.join(process.env['EMERALD_HOME'], 'logs', 'usage.jsonl');
  const usageSize700 = () => {
    try {
      return fs.statSync(usageFile700).size;
    } catch {
      return 0;
    }
  };
  const pickUsage700 = async (label) => {
    const c = await s.evalJs(`(() => { const r = document.querySelector('.title-bar-mark').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.click(c.x, c.y);
    await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu open');
    await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
    await s.waitFor(`!document.querySelector('.app-menu')`, 'the app menu closed');
  };
  await s.waitFor(`!!document.querySelector('.title-bar-mark')`, 'the app menu mark for the usage switch', 5000);
  await pickUsage700('Usage record: off');
  await s.waitFor(`document.querySelector('.title-bar-mark')?.dataset.usage === 'on'`, 'the usage switch on', 5000);
  const usageOffset700 = usageSize700();
  const secondEnv = { ...process.env, EMERALD_WINDOW: 'background', EMERALD_WHATS_NEW: 'off', EMERALD_CLAUDE_HOME: process.env.EMERALD_CLAUDE_HOME ?? '' };
  const second = spawn(path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe'), [`--user-data-dir=${profileOf(emeraldHome)}`, path.join(repoRoot, 'packages', 'app', 'out', 'main', 'index.js'), hello], { stdio: ['ignore', 'pipe', 'pipe'], env: secondEnv });
  const secondLogs = [];
  const secondTail = () => secondLogs.join('').trim().split(/\r?\n/).slice(-3).join(' | ');
  second.stdout.on('data', (d) => secondLogs.push(d.toString()));
  second.stderr.on('data', (d) => secondLogs.push(d.toString()));
  const secondExit = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 10000);
    second.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (secondExit === 'timeout') killTree(second);
  expect(secondExit === 0, `the second launch exited 0 within ten seconds, got ${secondExit} (${secondTail()})`);
  expect(secondLogs.join('').includes('handed to the running window; quitting'), `the second launch said it handed the file over (${secondTail()})`);
  await s.waitFor(activePinned(hello), 'the file from the second launch is a pinned, active tab here', 5000);
  const actions700 = () => {
    let text = '';
    try {
      text = fs.readFileSync(usageFile700).subarray(usageOffset700).toString('utf8');
    } catch {
      // Not written yet.
    }
    return text
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l))
      .filter((l) => l.ev === 'action');
  };
  let launched700 = actions700();
  for (const end = Date.now() + 3000; launched700.length < 1 && Date.now() < end; await sleep(100)) launched700 = actions700();
  expect(launched700.length === 1 && launched700[0].name === 'file-launch' && launched700[0].from === 'click', `the launch with a file is recorded as file-launch from a click, not cli-open, got ${JSON.stringify(launched700)}`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === ${tabsBefore341.length}`, 'closed');
  await pickUsage700('Usage record: on');
  await s.waitFor(`document.querySelector('.title-bar-mark')?.dataset.usage === 'off'`, 'the usage switch off again', 5000);
  step('fix 342 and 700: a second launch with a file exits 0, the file opens as a pinned tab in the running window, and the record names it file-launch');

  // M9 fix 853: Explorer's Open in Emerald (shell) is a second launch with
  // --open-shell before the folder. Two of them on this window's profile:
  // one as a plain spawn, and one with the folder quoted as Explorer's
  // "%V" quotes a drive root, a backslash before the closing quote, which
  // Chromium's own parse hands the main process as <folder>" (the quote
  // read back as the backslash it was). Each exits 0 at once and the
  // running window opens a new tab with a shell in the folder.
  const folder853 = path.join(seed, 'src');
  const mainLog853 = path.join(emeraldHome, 'logs', 'main.log');
  const logFrom853 = (() => {
    try {
      return fs.statSync(mainLog853).size;
    } catch {
      return 0;
    }
  })();
  const electron853 = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  const mainJs853 = path.join(repoRoot, 'packages', 'app', 'out', 'main', 'index.js');
  const launch853 = async (label, args, opts) => {
    const tabsBefore = await getTabs(s);
    const idsBefore = tabsBefore.tabs.map((t) => t.id);
    const child = spawn(electron853, args, { stdio: ['ignore', 'pipe', 'pipe'], env: secondEnv, ...opts });
    const logs = [];
    child.stdout.on('data', (d) => logs.push(d.toString()));
    child.stderr.on('data', (d) => logs.push(d.toString()));
    const tail = () => logs.join('').trim().split(/\r?\n/).slice(-3).join(' | ');
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 10000);
      child.on('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    if (code === 'timeout') killTree(child);
    expect(code === 0, `${label}: the launch exited 0 within ten seconds, got ${code} (${tail()})`);
    expect(logs.join('').includes(`${folder853} (shell) handed to the running window; quitting`), `${label}: the launch said it handed the folder over as a shell (${tail()})`);
    let tab = null;
    for (const end = Date.now() + 10000; Date.now() < end; await sleep(100)) {
      const t = await getTabs(s);
      const cur = t.tabs.find((x) => x.id === t.currentTabId);
      if (cur !== undefined && !idsBefore.includes(cur.id) && cur.root.kind === 'pane' && cur.root.sessionId !== null) {
        tab = cur;
        break;
      }
    }
    expect(tab !== null, `${label}: a new tab in front with a session in its pane, got ${JSON.stringify((await getTabs(s)).currentTabId)} against ${JSON.stringify(idsBefore)}`);
    expect(tab.name === path.basename(folder853), `${label}: the new tab is named after the folder (fix 886), wanted ${path.basename(folder853)}, got ${tab.name}`);
    const { sessions } = await zreq(s, 'session.list', {});
    const sess = sessions.find((x) => x.id === tab.root.sessionId);
    expect(sess !== undefined && sess.kind === 'shell' && sess.spawnCwd.toLowerCase() === folder853.toLowerCase(), `${label}: the new tab's session is a shell in ${folder853}, got ${JSON.stringify(sess === undefined ? null : { kind: sess.kind, spawnCwd: sess.spawnCwd })}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(`.tab.tab-panes[data-tab-id=${JSON.stringify(tab.id)}] .tab-close`)}).click()`);
    await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === ${tabsBefore.tabs.length}`, `${label}: the new tab closed`, 5000);
    await zreq(s, 'session.kill', { sessionId: sess.id, remove: true });
  };
  await launch853('the plain launch', [`--user-data-dir=${profileOf(emeraldHome)}`, mainJs853, '--open-shell', folder853], {});
  await launch853('the drive-root quoting', [`"--user-data-dir=${profileOf(emeraldHome)}"`, `"${mainJs853}"`, '--open-shell', `"${folder853}\\"`], { windowsVerbatimArguments: true });
  const log853 = fs.readFileSync(mainLog853).subarray(logFrom853).toString('utf8').split(/\r?\n/);
  const holders853 = log853.filter((l) => l.includes('single-instance lock held'));
  const fromSecond853 = log853.filter((l) => l.trimEnd().endsWith(`${folder853} (shell) from a second launch`));
  expect(holders853.length === 0, `no second lock holder in main.log (a second window), got ${JSON.stringify(holders853)}`);
  expect(fromSecond853.length === 2, `main.log has the running window take both folders, got ${JSON.stringify(fromSecond853)}`);
  step('fix 853: a second launch with --open-shell and a folder, and one with the folder quoted as Explorer quotes a drive root, each exits 0 and opens a new tab with a shell in the folder in the running window, the tab named after the folder (fix 886), one lock holder in main.log');

  // M9 fix 627: a layout tab's mark says what it holds and whether any of
  // it is active. Four new tabs with a session each, made after every
  // count of the strip above: a shell with a prompt posted (a working
  // Claude), a shell running output for about twenty seconds, a shell with
  // SessionStart alone (an idle Claude) and a bare shell.
  const tabWith627 = async () => {
    await s.evalJs(`document.querySelector('.tab-add').click()`);
    await s.waitFor(`!!document.querySelector('.layout-tab:not([hidden]) .empty-pane')`, 'a new tab with its empty pane');
    await startShellByKey(s);
    const t = await getTabs(s);
    const tab = t.tabs.find((x) => x.id === t.currentTabId);
    expect(tab.root.kind === 'pane' && tab.root.sessionId !== null, `the new tab holds its shell, got ${JSON.stringify(tab.root)}`);
    return { tabId: tab.id, sessionId: tab.root.sessionId };
  };
  // The daemon has restarted since postHook read its record (fix 342's
  // second launch, and the level-pinned steps before it), so the hooks go
  // to the port daemon.json names now.
  const record627 = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const post627 = async (sessionId, payload) => {
    const res = await fetch(`http://127.0.0.1:${record627.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': record627.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ cwd: seed, ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  const claudeWorking627 = await tabWith627();
  await post627(claudeWorking627.sessionId, { session_id: 'sim-627-w', hook_event_name: 'SessionStart', source: 'startup' });
  await post627(claudeWorking627.sessionId, { session_id: 'sim-627-w', hook_event_name: 'UserPromptSubmit', prompt: 'fix 627' });
  const claudeIdle627 = await tabWith627();
  await post627(claudeIdle627.sessionId, { session_id: 'sim-627-i', hook_event_name: 'SessionStart', source: 'startup' });
  const bare627 = await tabWith627();
  const loop627 = await tabWith627();
  await s.waitFor(`window.emerald.request('session.list', {}).then(r => r.sessions.find(x => x.id === ${JSON.stringify(loop627.sessionId)})?.shellCwd !== null)`, 'the loop shell at its prompt', 10000);
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(loop627.sessionId)}, data: '1..80 | % { Write-Host tick$_; Start-Sleep -m 250 }' + String.fromCharCode(13) })`);
  // The record's command, from the shell's marks integration, says the
  // loop itself is running, so the blink read below is not the start-up
  // burst's.
  const loopCommand627 = `window.emerald.request('session.list', {}).then(r => r.sessions.find(x => x.id === ${JSON.stringify(loop627.sessionId)})?.command?.state ?? null)`;
  await s.waitFor(`${loopCommand627}.then(st => st === 'running')`, 'the loop running on the record', 10000);
  const markIs627 = (tabId, kind, active, what) =>
    s.waitFor(`(() => { const m = ${tabMarkJs(tabId)}; return m !== null && m !== 'no tab' && m.kind === ${JSON.stringify(kind)} && (m.kind === 'shell' ? m.running : (m.tone === 'working')) === ${active}; })()`, what, 10000);
  await markIs627(claudeWorking627.tabId, 'claude', true, 'the working Claude tab wears the Claude mark in the working tone');
  await markIs627(loop627.tabId, 'shell', true, 'the running shell tab wears the shell mark blinking');
  await markIs627(claudeIdle627.tabId, 'claude', false, 'the idle Claude tab wears the still Claude mark');
  await markIs627(bare627.tabId, 'shell', false, 'the bare shell tab wears the shell mark still');
  const working627 = await tabMarkOf(claudeWorking627.tabId);
  const idle627 = await tabMarkOf(claudeIdle627.tabId);
  expect(working627.tone === 'working' && idle627.tone === 'idle', `the Claude tabs' tones, got ${JSON.stringify({ working627, idle627 })}`);
  await s.waitFor(`${loopCommand627}.then(st => st === 'ok')`, 'the loop ended ok on the record', 40000);
  await s.waitFor(`(() => { const m = ${tabMarkJs(loop627.tabId)}; return m !== null && m.kind === 'shell' && !m.running; })()`, 'the loop tab wears the shell mark still once the loop has ended', 10000);
  step('M9 fix 627: a layout tab wears the Claude mark while a Claude in it works, the shell mark blinking while only its shells run, the still Claude mark with a Claude open and the shell mark still with shells alone');

  // M9 fixes 865 to 867: a second window. One window so far, its strip
  // holding the earlier steps' tabs and fix 627's four, loop627's in front,
  // and no windows field on the layout. Every id goes into a selector
  // through JSON.stringify (window and tab ids are UUIDs).
  const tabSel867 = (tabId) => `.tab.tab-panes[data-tab-id=${JSON.stringify(tabId)}]`;
  const stripIds867 = (w) => w.evalJs(`[...document.querySelectorAll('.tab.tab-panes')].map((t) => t.dataset.tabId)`);
  const currentIn867 = (w) => w.evalJs(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId ?? null`);
  const windowCount867 = (n) => `window.emerald.request('layout.get', {}).then((r) => (r.layout.windows ?? []).length === ${n})`;
  const moveToWindow867 = async (tabId) => {
    const box = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(tabSel867(tabId))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.rightClick(box.x, box.y);
    await s.waitFor(`document.querySelector('.layout-tab-menu')?.dataset.tabId === ${JSON.stringify(tabId)}`, 'the layout tab menu for the move');
    const labels = await s.evalJs(`[...document.querySelectorAll('.layout-tab-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent + (b.disabled ? ' (disabled)' : ''))`);
    expect(labels.join(',') === 'Rename,Shade all,Lift all,Move to new window,Close tab', `the tab's menu offers Move to new window, got ${labels.join(',')}`);
    await s.evalJs(`[...document.querySelectorAll('.layout-tab-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Move to new window').click()`);
    await s.waitFor(windowCount867(2), 'the layout holds two windows', 5000);
    return getTabs(s);
  };
  const mainLog867 = () => fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8');
  // Copied from verify-m50-mirror.mjs: the buffer's lines, blanks trimmed.
  const bufferLines867 = (w, paneId) =>
    w.evalJs(
      `(() => { const t = document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(paneId)}] .term-host`)})?.emeraldTerm; if (!t) return null; const b = t.buffer.active; const out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? ''); return out; })()`,
    );
  const countIn867 = async (w, paneId, text) => ((await bufferLines867(w, paneId)) ?? []).filter((l) => l.includes(text)).length;
  // A row click on a session on no pane of the first window, the focused
  // pane holding a live one, asks; Show here puts it in that pane.
  const showHere867 = async (sessionId) => {
    await s.evalJs(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(sessionId)}]`)}).click()`);
    await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(sessionId)}`, 'the chooser for the row', 5000);
    await s.evalJs(`[...document.querySelectorAll('.show-chooser .menu-item')].find(b => b.querySelector('.menu-label').textContent.endsWith('Show here')).click()`);
  };
  const until867 = async (fn, what, ms = 5000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (await fn()) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await sleep(150);
    }
  };

  // (a) Move to new window on bare627's tab.
  expect((await getTabs(s)).windows === undefined, 'one window: no windows field on the layout');
  let L867 = await moveToWindow867(bare627.tabId);
  const second867 = L867.windows[1].id;
  expect(L867.windows[0].id === 'first', `the first window keeps its id, got ${L867.windows[0].id}`);
  expect(JSON.stringify(L867.windows[1].tabIds) === JSON.stringify([bare627.tabId]) && L867.windows[1].currentTabId === bare627.tabId, `the new window holds bare627's tab alone, got ${JSON.stringify(L867.windows[1])}`);
  expect(L867.currentTabId === bare627.tabId, 'the new window is in front');
  expect(!L867.windows[0].tabIds.includes(bare627.tabId) && L867.windows[0].currentTabId === loop627.tabId, `the first window lost the tab and stays on loop627's, got ${JSON.stringify(L867.windows[0])}`);

  // (b) The second window's page.
  let s2 = await windowPage(s.port, second867);
  await s2.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 1`, "the second window's strip", 10000);
  expect(JSON.stringify(await stripIds867(s2)) === JSON.stringify([bare627.tabId]) && (await currentIn867(s2)) === bare627.tabId, `the second window's strip is bare627's tab, current, got ${JSON.stringify(await stripIds867(s2))}`);
  const barePane867 = L867.tabs.find((t) => t.id === bare627.tabId).root;
  expect(barePane867.kind === 'pane' && barePane867.sessionId === bare627.sessionId, "its tab's pane is on bare627's session");
  await s2.waitFor(`!!document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(barePane867.id)}] .term-host`)})`, "bare627's terminal in the second window", 10000);
  const rows867 = await s.evalJs(`document.querySelectorAll('.sidebar-row').length`);
  await s2.waitFor(`document.querySelectorAll('.sidebar-row').length === ${rows867}`, 'the second window lists every session', 10000);
  expect(!(await stripIds867(s)).includes(bare627.tabId), "the first window's strip lost the tab");
  const spots867 = mainLog867().split(/\r?\n/);
  const firstSpot867 = spots867.filter((l) => /background window at \d+,\d+/.test(l)).at(-1)?.match(/at (\d+),(\d+)/);
  const secondSpot867 = spots867.filter((l) => l.includes(`background window ${second867} at `)).at(-1)?.match(/at (\d+),(\d+)/);
  expect(firstSpot867 !== undefined && secondSpot867 !== undefined && Number(secondSpot867[1]) === Number(firstSpot867[1]) + 1300 && secondSpot867[2] === firstSpot867[2], `the second window sits 1300 px right of the first, got ${JSON.stringify([firstSpot867?.[0], secondSpot867?.[0]])}`);
  step('fix 867: Move to new window opens a second window holding that tab alone, in front, with its own strip and the full sidebar, beside the first off screen');

  // (c) A switch in one window leaves the other alone; + adds to its own.
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel867(claudeIdle627.tabId))}).click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(claudeIdle627.tabId)}`, "the first window on claudeIdle627's tab", 5000);
  L867 = await getTabs(s);
  expect(L867.windows[0].currentTabId === claudeIdle627.tabId && L867.windows[1].currentTabId === bare627.tabId, `each window on its own tab, got ${JSON.stringify(L867.windows)}`);
  expect((await currentIn867(s2)) === bare627.tabId, "the second window's current tab unchanged");
  const firstCount867 = (await stripIds867(s)).length;
  await s2.evalJs(`document.querySelector('.tab-add').click()`);
  await s2.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2`, "+ in the second window adds a tab there", 5000);
  L867 = await getTabs(s);
  const plus867 = L867.windows[1].tabIds.find((id) => id !== bare627.tabId);
  expect(L867.windows[1].tabIds.length === 2 && L867.windows[1].currentTabId === plus867, `the second window holds the new tab, current, got ${JSON.stringify(L867.windows[1])}`);
  expect((await stripIds867(s)).length === firstCount867, "the first window's strip unchanged");
  step('fix 867: a switch in one window leaves the other on its tab, and + in the second window adds its tab there alone');

  // (d) emmer open goes to the window in front, the second.
  const file867 = path.join(seed, 'window-867.md');
  fs.writeFileSync(file867, '# Window 867\n');
  const opened867 = cliOpen(file867);
  expect(opened867.code === 0, `emmer open exits 0, got ${opened867.code} ${opened867.err}`);
  await s2.waitFor(`document.querySelector('.tab-file[data-active]')?.dataset.tab === ${JSON.stringify(file867)} && !document.querySelector('.tab-file[data-active][data-preview]')`, 'the file pinned and active in the second window', 5000);
  expect(await s.evalJs(`!document.querySelector(${JSON.stringify(`.tab-file[data-tab=${JSON.stringify(file867)}]`)})`), 'the first window has no tab on it');
  const ownKey867 = await s2.evalJs(`localStorage.getItem(${JSON.stringify('emerald.tabs:' + second867)}) ?? ''`);
  const firstKey867 = await s.evalJs(`localStorage.getItem('emerald.tabs') ?? ''`);
  expect(ownKey867.includes(JSON.stringify(file867).slice(1, -1)) && !firstKey867.includes(JSON.stringify(file867).slice(1, -1)), "the file is in the second window's key alone");
  step('fix 867: emmer open lands in the window in front, which keeps its file tabs under its own key');

  // (e) One session on show in both windows.
  const firstPane867 = L867.tabs.find((t) => t.id === claudeIdle627.tabId).root.id;
  await s2.evalJs(`document.querySelector(${JSON.stringify(tabSel867(bare627.tabId))}).click()`);
  await s2.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(bare627.tabId)}`, "the second window back on bare627's tab", 5000);
  await s2.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(bare627.sessionId)}, data: "Write-Output ('pre' + '-867')" + String.fromCharCode(13) })`);
  await until867(async () => (await countIn867(s2, barePane867.id, 'pre-867')) > 0, 'pre-867 in the second window', 10000);
  await showHere867(bare627.sessionId);
  await s.waitFor(`window.emerald.request('layout.get', {}).then((r) => r.layout.tabs.find((t) => t.id === ${JSON.stringify(claudeIdle627.tabId)})?.root.sessionId === ${JSON.stringify(bare627.sessionId)})`, "bare627 in the first window's pane", 5000);
  await until867(async () => (await countIn867(s, firstPane867, 'pre-867')) > 0, 'pre-867 in the first window', 10000);
  await sleep(1000);
  const inSecond867 = await countIn867(s2, barePane867.id, 'pre-867');
  const inFirst867 = await countIn867(s, firstPane867, 'pre-867');
  expect(inSecond867 === 1 && inFirst867 === 1, `the line once in each window, got ${inSecond867} in the second and ${inFirst867} in the first`);
  await showHere867(claudeIdle627.sessionId);
  await s.waitFor(`window.emerald.request('layout.get', {}).then((r) => r.layout.tabs.find((t) => t.id === ${JSON.stringify(claudeIdle627.tabId)})?.root.sessionId === ${JSON.stringify(claudeIdle627.sessionId)})`, "claudeIdle627 back in the first window's pane", 5000);
  await sleep(1500);
  await s2.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(bare627.sessionId)}, data: "Write-Output ('post' + '-867')" + String.fromCharCode(13) })`);
  await until867(async () => (await countIn867(s2, barePane867.id, 'post-867')) > 0, 'post-867 in the second window after the first let the session go', 5000);
  step('fix 866 and 867: a session on show in both windows is written once in each, and keeps writing to the second after the first lets it go');

  // (f) Closing the second window closes its tabs and keeps their sessions.
  const firstTabs867 = (await stripIds867(s)).length;
  await s2.send('Page.close').catch(() => {});
  s2.close();
  await s.waitFor(windowCount867(0), 'the layout back to no windows field', 5000);
  L867 = await getTabs(s);
  expect(!L867.tabs.some((t) => t.id === bare627.tabId || t.id === plus867), "the second window's two tabs closed with it");
  const bareRecord867 = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === bare627.sessionId);
  expect(bareRecord867 !== undefined && bareRecord867.state !== 'exited', "bare627's session still listed and running");
  expect((await stripIds867(s)).length === firstTabs867 && (await s.evalJs(`!!document.querySelector('.app-body')`)), 'the first window and the app stay');
  await until867(async () => !(await (await fetch(`http://127.0.0.1:${s.port}/json`)).json()).some((p) => p.type === 'page' && p.url.includes(`window=${second867}`)), 'no page for the second window', 5000);
  expect(mainLog867().includes(`window ${second867} closed: its 2 tabs closed, their sessions kept`), "main.log says the window's two tabs closed");
  step('fix 866: closing the second window closes its tabs, their sessions running and listed, and the first window and the app stay');

  // (g) A restart opens every window again.
  L867 = await moveToWindow867(claudeWorking627.tabId);
  const third867 = L867.windows[1].id;
  const firstSet867 = [...L867.windows[0].tabIds].sort();
  s.close();
  killTree(s.child);
  s = await launch(freshPort());
  app = s;
  await s.waitFor(`!!document.querySelector('.tab[data-tab="panes"]')`, 'the layout synced on the relaunched window', 15000);
  const s3 = await windowPage(s.port, third867, 20000);
  L867 = await getTabs(s);
  expect(JSON.stringify(L867.windows?.map((w) => w.id)) === JSON.stringify(['first', third867]), `the layout's windows after the restart, got ${JSON.stringify(L867.windows?.map((w) => w.id))}`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === ${firstSet867.length}`, "the first window's strip after the restart", 10000);
  expect(JSON.stringify([...(await stripIds867(s))].sort()) === JSON.stringify(firstSet867), "the first window shows its own tabs");
  await s3.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 1`, "the second window's strip after the restart", 10000);
  expect(JSON.stringify(await stripIds867(s3)) === JSON.stringify([claudeWorking627.tabId]), `the second window shows claudeWorking627's tab, got ${JSON.stringify(await stripIds867(s3))}`);
  await s3.send('Page.close').catch(() => {});
  s3.close();
  await s.waitFor(windowCount867(0), 'the layout back to one window', 5000);
  step('fix 866: a restart opens every window of the layout again, each on its own tabs');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m11-tabs-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  try {
    fs.rmSync(seed, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Left for the next run.
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
