// M10 acceptance: the files rail. A shell in a seeded temporary folder
// puts that folder's tree at the right edge, folders first with the
// dotfolder among them; expanding lists children; a file written from here
// appears and a deleted one goes without a refresh; cd moves the root and
// cd .. brings the expanded state back; focus switches the tree; an empty
// pane shows the empty text; the rail collapses to its thin form and the
// width survives a reload. Task 3 appends the filter and the entry menu.
// M20 appends the git status colours: a seeded repo with a file of each
// kind, a write turning a row orange, a git add turning it green. M25
// puts the contents search after the names filter: two hits with their
// line numbers, a hit opening a tab, Find in folder scoping it. M27 has
// the hit open the tab at its line, with the cursor on it and the flash,
// a markdown hit switching to Raw, and the mode and the scope across the
// reload at the end of the rail steps. M35 follows the focus step: a file
// written to a folder while another pane is focused (its watcher is gone
// with the open set) shows after a click back, without Refresh. M9 fix 33
// follows the markdown hit: a long line's hit is a window around its
// match, marked, and the cursor lands on the match's column; fix 32
// follows the git colours: an ignored file does not dim its folder.
// M45 follows the git colours: the status letters, the counts on the
// changed rows and the Changed list (M9 fix 70, where the Changes tab
// was), the Commits tab's two groups (M49 names the branch and draws the
// sessions' lanes) and the strip at a narrow rail.
// Uses a private home and pipe unless the environment already names them.
// Run: npm run verify:files -w @emerald/app
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm10-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m10';
// Reveal in Explorer's call lands in this file rather than opening
// Explorer beside the person (M9 fix 588); `launch` passes `process.env`
// on (cdp.mjs).
const openedPaths = path.join(os.tmpdir(), 'emerald-verify', `m10-opened-${process.pid}.log`);
fs.rmSync(openedPaths, { force: true });
process.env['EMERALD_OPEN_LOG'] = openedPaths;
const { CTRL, SHIFT, expect, freshPort, getLayout, getTabs, killTree, launch, leaves, repoRoot, setInput, sleep, startSession, step, stopDaemon, zreq } = await import('./cdp.mjs');

// `emmer open` against this window's pipe (the helper verify-m11-tabs.mjs
// has; M9 fixes 683, 685 and 686 open files through it).
const cliMain = path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js');
const cliOpen = (...args) => {
  const r = spawnSync(process.execPath, [cliMain, 'open', ...args], { env: process.env, encoding: 'utf8', windowsHide: true });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};

let app = null;
// 58 to 75 s quiet (the forks of fixes 450 to 493), so 120 s sat near it
// the way verify:cli's 150 did before fix 404.
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 240 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 240000);

// The seeded folder: two folders, a dotfolder and three files, one folder
// with a nested file for the filter. A fresh one per run so a leftover
// cannot pass a check.
// The temp directory comes back in 8.3 form on this machine and the shell
// reports the long form, so the seed is resolved to what the rail will say.
const seedShort = path.join(os.tmpdir(), 'emerald-verify', `m10-tree-${process.pid}`);
fs.rmSync(seedShort, { recursive: true, force: true });
for (const d of ['data', 'src/deep', '.claude']) fs.mkdirSync(path.join(seedShort, d), { recursive: true });
const seed = fs.realpathSync.native(seedShort);
for (const f of ['readme.md', 'b.txt', 'a.txt', 'data/one.json', 'src/deep/nested.ts', '.claude/settings.json']) fs.writeFileSync(path.join(seed, f), f);
// Two more under data for the type icons (M9 fix 71): a file the set
// knows by name and one with an extension it does not.
fs.writeFileSync(path.join(seed, 'data', 'package.json'), '{}\n');
fs.writeFileSync(path.join(seed, 'data', 'thing.emerald'), 'thing\n');
// For the contents search (M25): the word in two files at known lines in
// two cases, and the same word where it must not be found, under a
// node_modules and in a file with a NUL byte. Names that sort after the
// rows the tree steps count on. The text file is long enough that its
// hit, at line 40 of 80, is off the top of the editor (M27).
fs.mkdirSync(path.join(seed, 'src/deep/node_modules/pkg'), { recursive: true });
const HIT_LINE = 40;
const filler = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}`);
fs.writeFileSync(path.join(seed, 'src/deep/words.txt'), [...filler(1, HIT_LINE - 1), '   emeraldGrep here, the hit line', ...filler(HIT_LINE + 1, 80)].join('\n') + '\n');
fs.writeFileSync(path.join(seed, 'data/words.md'), 'EMERALDGREP at the top\n');
// A paragraph-length line with its word near the end, for the window a
// hit shows around its match (fix 33). The name sorts after two.json so
// the expand steps see the rows they count on.
const LONG_LEAD = 'x'.repeat(380);
fs.writeFileSync(path.join(seed, 'data/window.txt'), `${LONG_LEAD} emeraldWindow tail\n`);
fs.writeFileSync(path.join(seed, 'src/deep/node_modules/pkg/index.js'), 'emeraldgrep in node_modules\n');
fs.writeFileSync(path.join(seed, 'src/deep/blob.bin'), Buffer.concat([Buffer.from('emeraldgrep'), Buffer.from([0, 0, 1]), Buffer.from('binary')]));
// A second folder for the second pane.
const other = path.join(seed, 'src');
// A folder of its own for the pane-with-no-tab watch (M9 fix 337): kept
// apart from seed and repo so nothing else opens or expands a folder
// under it, which would watch it incidentally and hide a regression.
const paneSeedShort = path.join(os.tmpdir(), 'emerald-verify', `m10-panefile-${process.pid}`);
fs.rmSync(paneSeedShort, { recursive: true, force: true });
fs.mkdirSync(paneSeedShort, { recursive: true });
const paneSeed = fs.realpathSync.native(paneSeedShort);
const paneFile = path.join(paneSeed, 'note.txt');
fs.writeFileSync(paneFile, 'one\n');
// The folder's own menu (M9 fix 588): a folder holding one empty folder,
// the shell started in the empty one and the lift going up to the parent.
const rootMenuShort = path.join(os.tmpdir(), 'emerald-verify', `m10-rootmenu-${process.pid}`);
fs.rmSync(rootMenuShort, { recursive: true, force: true });
fs.mkdirSync(path.join(rootMenuShort, 'empty'), { recursive: true });
const rootMenuParent = fs.realpathSync.native(rootMenuShort);
const emptyFolder = path.join(rootMenuParent, 'empty');
// A git repo for the colours, seeded a file per status: one committed and
// left alone, one committed and then staged with a change, one new, one
// ignored. The identity is set in the repo so the commit works on a
// machine with no global one.
const repoShort = path.join(os.tmpdir(), 'emerald-verify', `m10-repo-${process.pid}`);
fs.rmSync(repoShort, { recursive: true, force: true });
fs.mkdirSync(repoShort, { recursive: true });
const repo = fs.realpathSync.native(repoShort);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
git('init', '-q');
git('config', 'user.name', 'verify');
git('config', 'user.email', 'verify@example.invalid');
git('config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored.log\n');
fs.writeFileSync(path.join(repo, 'tracked.txt'), 'tracked');
fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged');
// A committed file in a folder, so git lists the ignored file beside it
// and not the folder (fix 32: ignored must not roll up onto the folder).
fs.mkdirSync(path.join(repo, 'sub'));
fs.writeFileSync(path.join(repo, 'sub', 'keep.txt'), 'keep');
git('add', '.');
// Dated two seconds back: the app launches and starts its first session
// within the same second as this commit often enough that the seed read
// as made since the session started (the start is floored to its
// second), which failed the Commits tab step about one run in two.
const seedDate = `${Math.floor(Date.now() / 1000) - 2} +0000`;
execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: seedDate, GIT_COMMITTER_DATE: seedDate } });
fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged, changed');
git('add', 'staged.txt');
fs.writeFileSync(path.join(repo, 'new.txt'), 'new');
fs.writeFileSync(path.join(repo, 'ignored.log'), 'ignored');
fs.writeFileSync(path.join(repo, 'sub', 'ignored.log'), 'ignored');

const names = (s) => s.evalJs(`[...document.querySelectorAll('.files-row')].map(r => r.dataset.depth + ':' + r.dataset.kind + ':' + r.querySelector('.files-name').textContent)`);
const rootShown = (s) => s.evalJs(`document.querySelector('.files-rail')?.dataset.root ?? null`);
const rowSel = (p) => `.files-row[data-path=${JSON.stringify(p)}]`;
const clickRow = (s, p) => s.evalJs(`document.querySelector(${JSON.stringify(rowSel(p))}).click()`);
const typeInto = (s, sessionId, text) =>
  s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(sessionId)}, data: ${JSON.stringify(text)} + String.fromCharCode(13) })`);
const sessionOf = async (s, paneId) => {
  const layout = await getLayout(s);
  const pane = leaves(layout).find((p) => p.id === paneId);
  return (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === pane.sessionId);
};

// The fix 436 step relaunches with a cap of 3 on a parent it seeds.
let liftParent = null;
// M9 fix 438: let, not const, since its own step below closes this window
// and relaunches pointed at a settings file with a new scheme, the way
// verify-m19-history.mjs and verify-m52-view.mjs already reassign theirs;
// the fix 436 step relaunches it too.
let s = await launch(freshPort(), { freshState: true });
app = s;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  expect(await s.evalJs(`!!document.querySelector('.files-rail')`), 'the rail is open by default');
  expect((await s.evalJs(`document.querySelector('.files-empty')?.textContent`)) === 'No session in this pane', 'an empty focused pane says so');
  const p1 = leaves(await getLayout(s))[0].id;

  await startSession(s, { kind: 'shell', cwd: seed });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell in pane 1');
  await s.waitFor(`document.querySelectorAll('.files-row').length === 6`, 'the seeded folder listed');
  expect((await rootShown(s)) === seed, `the rail's root is the shell's folder (${await rootShown(s)})`);
  expect((await s.evalJs(`document.querySelector('.files-root').textContent`)) === path.basename(seed), 'the header is the folder name');
  let rows = await names(s);
  expect(rows.join(',') === '0:dir:.claude,0:dir:data,0:dir:src,0:file:a.txt,0:file:b.txt,0:file:readme.md', `folders first, dotfolder shown, names sorted: ${rows.join(',')}`);
  step('a shell in the seeded folder lists it at the right edge, folders first');

  // M9 fix 335: no branch pill on a folder outside any repository.
  expect(!(await s.evalJs(`!!document.querySelector('.files-branch')`)), 'the seeded folder is not a repository, so the header shows no branch');

  // Expand data: its child appears under it, indented.
  await clickRow(s, path.join(seed, 'data'));
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data', 'one.json')))})`, 'data expanded');
  rows = await names(s);
  expect(rows[1] === '0:dir:data' && rows[2] === '1:file:one.json', `the child sits under its folder: ${rows.slice(0, 3).join(',')}`);
  expect(await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data')))}).dataset.expanded === 'true'`), 'the folder row is marked expanded');
  await s.screenshot('m10-files.png');
  step('expanding a folder lists its children');

  // M9 fix 421: Monaco's ESM json language, loaded on the first .json
  // model, pulls five more of its contributions in through its own
  // worker manager regardless of what monaco.ts imports for itself
  // (CodeLensContribution2, InlayHintsController2,
  // DropIntoEditorController2, SuggestController2, CodeActionController2);
  // their services must be registered before the standalone editor is
  // asked to create them, or each throws once, uncaught, into main.log.
  // one.json is the first file this script opens in the editor.
  const jsonOpenPath = path.join(seed, 'data', 'one.json');
  await clickRow(s, jsonOpenPath);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(jsonOpenPath)} && document.querySelector('.file-view')?.dataset.state === 'text'`, 'one.json open, the first file opened in the editor', 8000);
  await sleep(1000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  // The Electron sandbox lines (Cannot destructure ... preloadScripts) are
  // a harmless quirk of the sandboxed bundle, in passing logs since the
  // batch of fixes 93 (CLAUDE.md); only the five above are the regression.
  const rendererErrors = fs
    .readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('renderer: error') && !l.includes('sandboxed_renderer.bundle.js') && !l.includes('preloadScripts'));
  expect(rendererErrors.length === 0, `no renderer: error line after the first file open (${JSON.stringify(rendererErrors)})`);
  step('M9 fix 421: the first file opened in the editor logs no renderer: error line in main.log');

  // M9 fix 71: the type icons. Each row's img carries the Material set's
  // definition name: a file known by name (readme, nodejs), by its
  // extension (json, document), an unknown one as the plain file, a
  // folder by its name, open or closed; and the SVGs load from disk.
  const iconOf = (p) => `(document.querySelector(${JSON.stringify(rowSel(p))})?.querySelector('img.files-icon-img')?.dataset.icon ?? null)`;
  const icons = await s.evalJs(
    `[${['readme.md', 'a.txt', 'data', 'data/package.json', 'data/thing.emerald', 'data/one.json', 'src', '.claude'].map((n) => iconOf(path.join(seed, n))).join(',')}].join(',')`,
  );
  expect(icons === 'readme,document,folder-database-open,nodejs,file,json,folder-src,folder-claude', `the icons per row: ${icons}`);
  await s.waitFor(`[...document.querySelectorAll('img.files-icon-img')].every((i) => i.complete && i.naturalWidth > 0)`, 'every icon loaded', 5000);
  const iconSrc = await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data', 'one.json')))}).querySelector('img.files-icon-img').getAttribute('src')`);
  expect(/\/json-[\w-]+\.svg$/.test(iconSrc), `the json icon is the set's file (${iconSrc})`);
  const iconBox = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'readme.md')))}).querySelector('img.files-icon-img').getBoundingClientRect(); return r.width + 'x' + r.height; })()`);
  expect(iconBox === '14x14', `the icon is 14px (${iconBox})`);
  step('the rows carry the Material set\'s type icons by name, by extension and by folder, loaded from disk');

  // A change on disk in the open folder shows without a refresh.
  fs.writeFileSync(path.join(seed, 'data', 'two.json'), 'two');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data', 'two.json')))})`, 'a new file appears', 3000);
  fs.rmSync(path.join(seed, 'data', 'one.json'));
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data', 'one.json')))})`, 'a deleted file goes', 3000);
  // And in the root, which is watched too.
  fs.writeFileSync(path.join(seed, 'c.txt'), 'c');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'c.txt')))})`, 'a new file in the root appears', 3000);
  step('the watched folders follow the disk within a second');

  // cd in the shell moves the root; cd .. brings the tree back as it was.
  const shell1 = await sessionOf(s, p1);
  await typeInto(s, shell1.id, 'cd src');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(other)}`, 'root follows cd', 10000);
  await s.waitFor(`document.querySelectorAll('.files-row').length === 1`, 'src listed');
  expect((await names(s))[0] === '0:dir:deep', 'the tree is src');
  await typeInto(s, shell1.id, 'cd ..');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)}`, 'root follows cd ..', 10000);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data', 'two.json')))})`, 'data is still expanded after coming back');
  step('a cd moves the root and coming back finds the folder still expanded');

  // A second pane with a shell elsewhere: focus decides the tree.
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'a second pane');
  await s.waitFor(`document.querySelector('.files-empty')?.textContent === 'No session in this pane'`, 'the empty new pane has no tree');
  await startSession(s, { kind: 'shell', cwd: other });
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(other)}`, 'the second shell brings its folder');
  const p2 = (await getLayout(s)).focusedPaneId;
  expect(p2 !== p1, 'pane 2 is focused');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)}`, 'focus back on pane 1 restores its tree');
  expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data', 'two.json')))})`), 'and data is still expanded');
  step('focus moves the tree between panes and keeps what was expanded');

  // The rail watches exactly the open set, so with pane 2 focused the seed
  // is not watched and a write there is missed; the click back on pane 1
  // re-lists the folder it shows again (its old listing was kept), and the
  // new file is there without Refresh. Then a synthetic window focus, the
  // other moment the rail re-lists, with the tree left as it is; a covered
  // harness window never gets the real one.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(other)}`, 'pane 2 focused, its tree shown');
  fs.writeFileSync(path.join(seed, 'late.txt'), 'late');
  await sleep(1200);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)}`, 'focus back on pane 1');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'late.txt')))})`, 'the file written while pane 2 was focused shows after the click', 3000);
  expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data', 'two.json')))})`), 'and data is still expanded');
  await s.evalJs(`window.dispatchEvent(new Event('focus'))`);
  await sleep(500);
  expect((await rootShown(s)) === seed, 'a window focus keeps the tree');
  expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'late.txt')))})`), 'and its rows');
  step('a file written while another pane was focused shows after a click back, without Refresh');

  // The names filter: a nested file by its relative path, then Escape.
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.type('nest');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 1`, 'one hit for nest');
  expect(
    (await s.evalJs(`document.querySelector('.files-hit .files-name').textContent`)) === 'src/deep/nested.ts',
    'the hit is the nested file by its relative path',
  );
  expect(!(await s.evalJs(`!!document.querySelector('.files-row:not(.files-hit)')`)), 'the tree gives way to the hits');
  await s.screenshot('m10-filter.png');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 0 && document.querySelectorAll('.files-row').length > 0`, 'Escape brings the tree back');
  expect((await s.evalJs(`document.querySelector('.files-filter-input').value`)) === '', 'and clears the box');
  expect(await s.evalJs(`document.activeElement?.classList.contains('xterm-helper-textarea')`), 'and the terminal has the keyboard again');
  step('the filter lists a nested file by relative path and Escape clears it');

  // M9 fix 333: a search hit drags onto a pane the way a tree row does.
  // The nested file's hit is draggable; dropped on the shell's own pane
  // (the fix 180 gesture) it opens a second, file pane split from the
  // shell rather than a tab.
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.type('nest');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 1`, 'the nest hit again');
  expect((await s.evalJs(`document.querySelector('.files-hit').dataset.draggable`)) !== undefined, 'the file hit is draggable');
  const hitCentre333 = await s.evalJs(`(() => { const r = document.querySelector('.files-hit').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const p1Box333 = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const band333 = { x: Math.round(p1Box333.x + p1Box333.width * 0.9), y: Math.round(p1Box333.y + p1Box333.height / 2) };
  await s.mouse('mousePressed', hitCentre333.x, hitCentre333.y);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hitCentre333.x + 10, y: hitCentre333.y, button: 'left', buttons: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: band333.x, y: band333.y, button: 'left', buttons: 1 });
  expect(!!(await s.evalJs(`document.querySelector('.drag-ghost')`)), 'the drag ghost shows once the pointer has moved past the threshold');
  await s.mouse('mouseReleased', band333.x, band333.y);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'the search hit opened a file pane', 5000);
  const droppedPath333 = await s.evalJs(`document.querySelector('.pane[data-view="file"]').dataset.path`);
  expect(droppedPath333 === path.join(seed, 'src', 'deep', 'nested.ts'), `the file pane is titled for the hit, got ${droppedPath333}`);
  expect((await s.evalJs(`document.querySelectorAll('.tab-file').length`)) === 0, 'the drag opened no tab, only the pane');
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  // Two panes stood before the drag (p1 and p2, from the focus step
  // above); the drop split p1 into two, so closing it back leaves two,
  // not one.
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 0 && document.querySelectorAll('.pane').length === 2`, 'the file pane closed, the two shell panes again');
  // The drop and the close both moved the DOM focus off the filter box;
  // put it back, as every other Escape in this script does, so the key
  // actually reaches the input's own handler.
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 0 && document.querySelectorAll('.files-row').length > 0`, 'the search cleared again');
  step('M9 fix 333: a search hit drags onto a pane the way a tree row does, opening a file pane rather than a tab');

  // Contents search (M25): the switch, two hits with line numbers and
  // neither the node_modules nor the binary one, a click opening a tab,
  // Find in folder scoping to data, the x widening again, Escape.
  const hits = (s) => s.evalJs(`[...document.querySelectorAll('.files-hit')].map(h => h.querySelector('.files-name').textContent + ':' + h.dataset.line + ':' + h.querySelector('.files-hit-text')?.textContent)`);
  await s.evalJs(`document.querySelector('.files-mode[data-mode="contents"]').click()`);
  await s.waitFor(`document.querySelector('.files-mode[data-mode="contents"]').dataset.active === 'true' && document.querySelector('.files-filter-input').placeholder === 'Find in files'`, 'Contents mode');
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.type('EmeraldGrep');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 2`, 'two contents hits', 5000);
  let found = await hits(s);
  expect(found.join('|') === `data/words.md:1:EMERALDGREP at the top|src/deep/words.txt:${HIT_LINE}:emeraldGrep here, the hit line`, `the two hits with their lines, trimmed, either case, shallow first: ${found.join('|')}`);
  await s.screenshot('m25-contents.png');
  step('Contents finds the word in two files with the line numbers, not in node_modules or a binary file');

  // M27: the tab opens at the hit's line, read through the editor handle
  // the view puts on its host, since the window draws no frames.
  const editorState = (s) =>
    s.evalJs(
      `(() => { const e = document.querySelector('.file-editor')?.emeraldEditor; if (!e || !e.getModel()) return null; return { line: e.getPosition().lineNumber, scrollTop: e.getScrollTop(), flashed: e.getModel().getAllDecorations().some(d => d.options.className === 'file-line-flash'), lines: e.getModel().getLineCount() }; })()`,
    );
  await s.evalJs(`document.querySelector('.files-hit[data-line="${HIT_LINE}"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(path.join(seed, 'src', 'deep', 'words.txt'))}`, 'a click on a hit opens the file tab', 5000);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'text'`, 'the file is read');
  let ed = await editorState(s);
  expect(ed !== null && ed.line === HIT_LINE, `the cursor is on the hit's line (${JSON.stringify(ed)})`);
  expect(ed !== null && ed.lines === 81 && ed.scrollTop > 0, `the editor scrolled down to it, not the top of the file (${JSON.stringify(ed)})`);
  expect(ed !== null && ed.flashed, 'the line is lit');
  await s.waitFor(`document.querySelector('.file-editor').emeraldEditor.getModel().getAllDecorations().every(d => d.options.className !== 'file-line-flash')`, 'the flash goes on its own', 2500);
  await s.screenshot('m27-hit-line.png');
  // M9 fix 487: Ctrl+Right and Ctrl+Left jump words. Monaco's
  // wordOperations contribution used to arrive only with the .json
  // language's late load; this script opens one.json first (line 172), so
  // this step cannot tell an early import from the late one and reads the
  // keys, the import's own check being the absence of an UNKNOWN service
  // line in main.log on a first open.
  await s.evalJs(`(() => { const e = document.querySelector('.file-editor').emeraldEditor; e.focus(); e.setPosition({ lineNumber: 1, column: 1 }); })()`);
  await s.key('ArrowRight', 'ArrowRight', 39, CTRL);
  await s.waitFor(`document.querySelector('.file-editor').emeraldEditor.getPosition().column > 1`, 'Ctrl+Right jumps past the first word', 3000);
  const jumped = await s.evalJs(`document.querySelector('.file-editor').emeraldEditor.getPosition().column`);
  expect(jumped === 5, `Ctrl+Right lands at the end of "line" (column ${jumped})`);
  await s.key('ArrowLeft', 'ArrowLeft', 37, CTRL);
  await s.waitFor(`document.querySelector('.file-editor').emeraldEditor.getPosition().column === 1`, 'Ctrl+Left jumps back to the line start', 3000);
  step('M9 fix 487: Ctrl+Right and Ctrl+Left jump words in the file editor');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  expect((await s.evalJs(`document.querySelectorAll('.files-hit').length`)) === 2, 'the hits are still listed');
  step('a click on a hit opens the file in a tab at its line, lit for a moment');

  // M9 fix 686: sticky scroll is off whichever file opened first. one.json
  // was opened first in this window (the JSON chunk and the sticky scroll
  // contribution are loaded), so a .ts file opened now would show sticky
  // headers if the option were left on.
  const sticky686 = path.join(seed, 'src', 'deep', 'sticky686.ts');
  fs.mkdirSync(path.dirname(sticky686), { recursive: true });
  fs.writeFileSync(sticky686, ['export function outer(): void {', ...Array.from({ length: 80 }, (_, i) => `  const v${i} = ${i};`), '}', ''].join('\n'));
  expect(cliOpen(sticky686).code === 0, 'emmer open opens sticky686.ts');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(sticky686)} && !!document.querySelector('.file-editor')?.emeraldEditor`, 'sticky686.ts open in the editor', 8000);
  await s.evalJs(`document.querySelector('.file-editor').emeraldEditor.setScrollTop(600)`);
  await sleep(150);
  const sticky = await s.evalJs(`(() => { const e = document.querySelector('.file-editor'); return { enabled: e.emeraldEditor.getRawOptions().stickyScroll?.enabled, widgets: [...e.querySelectorAll('.sticky-widget')].filter((w) => w.children.length > 0).length }; })()`);
  expect(sticky.enabled === false && sticky.widgets === 0, `sticky scroll is off in the file editor (${JSON.stringify(sticky)})`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes after sticky686.ts');
  fs.rmSync(sticky686);
  step('M9 fix 686: sticky scroll is off in the file editor after a .json has loaded');

  // M9 fix 437: the same hit dragged onto a pane opens the file pane at
  // its line, with the whole-line flash a tab's reveal gives. Dropped on
  // pane 1's right band as fix 333's names hit is; the file pane closed
  // after, the two shell panes and the hits left as they were.
  const hitCentre437 = await s.evalJs(`(() => { const r = document.querySelector('.files-hit[data-line="${HIT_LINE}"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const p1Box437 = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const band437 = { x: Math.round(p1Box437.x + p1Box437.width * 0.9), y: Math.round(p1Box437.y + p1Box437.height / 2) };
  await s.mouse('mousePressed', hitCentre437.x, hitCentre437.y);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hitCentre437.x + 10, y: hitCentre437.y, button: 'left', buttons: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: band437.x, y: band437.y, button: 'left', buttons: 1 });
  await s.mouse('mouseReleased', band437.x, band437.y);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'the contents hit opened a file pane', 5000);
  const pane437 = `document.querySelector('.pane[data-view="file"]')`;
  expect((await s.evalJs(`${pane437}.dataset.path`)) === path.join(seed, 'src', 'deep', 'words.txt'), 'the file pane is titled for the hit');
  expect((await s.evalJs(`document.querySelectorAll('.tab-file').length`)) === 0, 'the drag opened no tab, only the pane');
  await s.waitFor(`${pane437}.querySelector('.file-view')?.dataset.state === 'text'`, 'the file read into the pane');
  const paneEd437 = `${pane437}.querySelector('.file-editor').emeraldEditor`;
  await s.waitFor(`${paneEd437}.getPosition()?.lineNumber === ${HIT_LINE}`, "the pane's cursor on the hit's line", 5000);
  const landed437 = await s.evalJs(
    `(() => { const e = ${paneEd437}; return { visible: e.getVisibleRanges().some((r) => r.startLineNumber <= ${HIT_LINE} && r.endLineNumber >= ${HIT_LINE}), flashed: e.getModel().getAllDecorations().some((d) => d.options.className === 'file-line-flash' && d.range.startLineNumber === ${HIT_LINE}), column: e.getPosition().column }; })()`,
  );
  expect(landed437.visible, `the hit's line is in the pane's visible range (${JSON.stringify(landed437)})`);
  expect(landed437.flashed, `the hit's line is lit in the pane (${JSON.stringify(landed437)})`);
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 0 && document.querySelectorAll('.pane').length === 2`, 'the file pane closed, the two shell panes again');
  expect((await s.evalJs(`document.querySelectorAll('.files-hit').length`)) === 2, 'the hits are still listed');
  step('M9 fix 437: a contents hit dropped on a pane opens the file pane at its line, lit, and no tab');

  // M9 fix 765: the same hit dropped on another layout tab, then on the +.
  // The file opens on a tab not on show and its view holds the reveal
  // while hidden (line 1, no flash); shown, the pane takes it: the cursor
  // on the hit's line, in view and lit. Each tab is closed after, so the
  // window is as fix 437's step left it.
  const tabPanes765 = (id) => `.tab-panes[data-tab-id=${JSON.stringify(id)}]`;
  const layoutTab765 = (id) => `.layout-tab[data-tab-id=${JSON.stringify(id)}]`;
  const currentIs765 = (id) => `(async () => (await window.emerald.request('layout.get', {})).layout.currentTabId === ${JSON.stringify(id)})()`;
  const centre765 = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const dragHitTo765 = async (targetSel) => {
    await s.waitFor(`!!document.querySelector('.files-hit[data-line="${HIT_LINE}"]')`, `fix 765: the hit still listed before the drag (${await s.evalJs(`JSON.stringify({ hits: document.querySelectorAll('.files-hit').length, root: document.querySelector('.files-rail')?.dataset.root ?? null, rail: document.querySelector('.rail-tab[data-active]')?.dataset.tab ?? null })`)})`, 5000);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(targetSel)})`, `fix 765: ${targetSel} drawn before the drag`, 5000);
    const from = await centre765(`.files-hit[data-line="${HIT_LINE}"]`);
    const to = await centre765(targetSel);
    await s.mouse('mousePressed', from.x, from.y);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + 10, y: from.y, button: 'left', buttons: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x, y: to.y, button: 'left', buttons: 1 });
    expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(targetSel + '[data-pane-drop]')})`), `fix 765: ${targetSel} is lit under the drag`);
    await s.mouse('mouseReleased', to.x, to.y);
  };
  const paneEd765 = (tabId) => `document.querySelector(${JSON.stringify(layoutTab765(tabId) + ' .pane[data-view="file"] .file-editor')})?.emeraldEditor`;
  const shownReveal765 = async (tabId, what) => {
    await s.evalJs(`document.querySelector(${JSON.stringify(tabPanes765(tabId))}).click()`);
    await s.waitFor(currentIs765(tabId), `${what}: the tab shown`);
    await s.waitFor(`${paneEd765(tabId)}?.getPosition()?.lineNumber === ${HIT_LINE}`, `${what}: the pane's cursor on the hit's line once shown`, 5000);
    const landed = await s.evalJs(
      `(() => { const e = ${paneEd765(tabId)}; return { visible: e.getVisibleRanges().some((r) => r.startLineNumber <= ${HIT_LINE} && r.endLineNumber >= ${HIT_LINE}), flashed: e.getModel().getAllDecorations().some((d) => d.options.className === 'file-line-flash' && d.range.startLineNumber === ${HIT_LINE}) }; })()`,
    );
    expect(landed.visible, `${what}: the hit's line is in the pane's visible range once shown (${JSON.stringify(landed)})`);
    expect(landed.flashed, `${what}: the hit's line is lit once shown (${JSON.stringify(landed)})`);
  };
  const closeTab765 = async (tabId, firstId, what) => {
    await s.evalJs(`document.querySelector(${JSON.stringify(tabPanes765(tabId) + ' .tab-close')}).click()`);
    await s.waitFor(`document.querySelectorAll('.tab-panes').length === 1`, `${what}: the tab closed`);
    await s.waitFor(currentIs765(firstId), `${what}: the first tab on show again`);
  };
  // (a) Another layout tab.
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab-panes').length === 2`, 'fix 765: a second layout tab');
  const tabs765 = await getTabs(s);
  const first765 = tabs765.tabs[0].id;
  const second765 = tabs765.tabs[1].id;
  await s.evalJs(`document.querySelector(${JSON.stringify(tabPanes765(first765))}).click()`);
  await s.waitFor(currentIs765(first765), 'fix 765: the first tab shown again');
  await dragHitTo765(tabPanes765(second765));
  await s.waitFor(`document.querySelector(${JSON.stringify(layoutTab765(second765) + ' .pane[data-view="file"] .file-view')})?.dataset.state === 'text'`, 'fix 765: the file read into a pane of the second tab', 10000);
  expect((await getTabs(s)).currentTabId === first765, 'fix 765: the window stays on the first tab after the drop');
  await sleep(300);
  const hidden765 = await s.evalJs(`(() => { const e = ${paneEd765(second765)}; return { line: e.getPosition()?.lineNumber ?? null, flashed: e.getModel().getAllDecorations().some((d) => d.options.className === 'file-line-flash') }; })()`);
  expect(hidden765.line === 1 && !hidden765.flashed, `the reveal waits while the tab is hidden (${JSON.stringify(hidden765)})`);
  await shownReveal765(second765, 'fix 765 on a tab');
  await closeTab765(second765, first765, 'fix 765 on a tab');
  step('M9 fix 765: a contents hit dropped on another layout tab waits hidden at line 1 and reveals its line, lit, when the tab is shown');

  // (b) The +.
  await dragHitTo765('.tab-add');
  await s.waitFor(`document.querySelectorAll('.tab-panes').length === 2`, 'fix 765: the + made a tab');
  const made765 = (await getTabs(s)).tabs.at(-1).id;
  expect((await getTabs(s)).currentTabId === first765, 'fix 765: the window stays on the first tab after the drop on the +');
  await s.waitFor(`document.querySelector(${JSON.stringify(layoutTab765(made765) + ' .pane[data-view="file"] .file-view')})?.dataset.state === 'text'`, 'fix 765: the file read into the new tab', 10000);
  await shownReveal765(made765, 'fix 765 on the +');
  await closeTab765(made765, first765, 'fix 765 on the +');
  step('M9 fix 765: a contents hit dropped on the + reveals its line when the new tab is shown');

  // A markdown hit: the tab opens in Raw for the jump, since the rendered
  // view has no lines.
  await s.evalJs(`document.querySelector('.files-hit[data-line="1"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(path.join(seed, 'data', 'words.md'))}`, 'the markdown hit opens its tab', 5000);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'text' && document.querySelector('.file-view').dataset.view === 'raw'`, 'the markdown tab is in Raw');
  ed = await editorState(s);
  expect(ed !== null && ed.line === 1 && ed.flashed, `the cursor is on line 1 and it is lit (${JSON.stringify(ed)})`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  step('a markdown hit opens its tab in Raw at the line');

  // Fix 33: a hit in a long line is a window around the match, the match
  // in a mark, and a click puts the cursor on its column.
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 0`, 'Escape clears the search');
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.type('emeraldwindow');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 1`, 'one hit for the long line', 5000);
  const windowed = await s.evalJs(`(() => { const t = document.querySelector('.files-hit .files-hit-text'); return { text: t.textContent, mark: t.querySelector('mark.files-hit-match')?.textContent ?? null, title: t.title }; })()`);
  expect(windowed.text.length === 200 && windowed.text.startsWith('…x') && windowed.text.endsWith(' emeraldWindow tail'), `the text is a window around the match, cut at the front: ${windowed.text.slice(0, 12)}... (${windowed.text.length})`);
  expect(windowed.mark === 'emeraldWindow', `the match is marked: ${windowed.mark}`);
  expect(windowed.title === windowed.text, 'the tooltip is the same window');
  await s.evalJs(`document.querySelector('.files-hit').click()`);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(path.join(seed, 'data', 'window.txt'))}`, 'the hit opens its tab', 5000);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'text'`, 'the file is read');
  const pos = await s.evalJs(`(() => { const p = document.querySelector('.file-editor').emeraldEditor.getPosition(); return { line: p.lineNumber, column: p.column }; })()`);
  expect(pos.line === 1 && pos.column === LONG_LEAD.length + 2, `the cursor is on the match's column (${JSON.stringify(pos)})`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 0`, 'Escape clears the search');
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.type('EmeraldGrep');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 2`, 'the two EmeraldGrep hits again', 5000);
  step('a hit in a long line shows a window around its match, marked, and a click lands the cursor on it');

  // Escape puts the tree back, so the data folder row is there to right-click.
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 0 && !!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data')))})`, 'Escape brings the tree back');
  expect((await s.evalJs(`document.querySelector('.files-mode[data-mode="contents"]').dataset.active`)) === 'true', 'the mode is kept');
  const dataBox = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data')))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(dataBox.x, dataBox.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(path.join(seed, 'data'))}`, 'the folder menu');
  const folderLabels = await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-label')].map(b => b.textContent)`);
  // M9 fix 309 puts New file and New folder above Find in folder; M9 fix 574 puts Rename above them.
  expect(folderLabels.slice(0, 4).join(',') === 'Rename,New file,New folder,Find in folder', `Rename, New file, New folder and Find in folder lead the folder menu: ${folderLabels.join(',')}`);
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Find in folder').click()`);
  await s.waitFor(`!document.querySelector('.files-menu') && document.activeElement?.classList.contains('files-filter-input')`, 'the box is focused');
  expect((await s.evalJs(`document.querySelector('.files-scope-name')?.textContent`)) === 'in data', 'the scope shows the folder');
  await s.type('emeraldgrep');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 1`, 'one hit under data', 5000);
  found = await hits(s);
  expect(found[0] === 'data/words.md:1:EMERALDGREP at the top', `the hit is shown relative to the root: ${found[0]}`);
  await s.evalJs(`document.querySelector('.files-scope-clear').click()`);
  await s.waitFor(`!document.querySelector('.files-scope') && document.querySelectorAll('.files-hit').length === 2`, 'the x widens the search to the root', 5000);
  await s.evalJs(`document.querySelector('.files-filter-input').focus()`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 0 && document.querySelectorAll('.files-row').length > 0`, 'Escape puts the tree back');
  await s.evalJs(`document.querySelector('.files-mode[data-mode="names"]').click()`);
  step('Find in folder scopes the search to the folder, the x widens it and Escape clears it');

  // The entry menu: Insert path types the relative path into the shell.
  const target = path.join(seed, 'data', 'two.json');
  const rowBox = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(target))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(rowBox.x, rowBox.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(target)}`, 'the entry menu');
  const labels = await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-label')].map(b => b.textContent)`);
  expect(
    // Open in a pane after the tab since M9 fix 180, Rename between them since M9 fix 574, Delete last since M9 fix 617.
    labels.join(',') === 'Open in a tab,Rename,Open in a pane,Open with Windows,Reveal in Explorer,Copy path,Copy relative path,Insert path into pane,Delete',
    `the menu items: ${labels.join(',')}`,
  );
  // M9 fix 370: Copy path and Copy relative path go through the app's
  // own clipboard (window.emerald.clipboard), read back the way fix 345's
  // heading menu is in verify:sidebar; the box's clipboard, so what was
  // there is put back after.
  const railClipSaved = await s.evalJs(`window.emerald.clipboard.read().then(r => r.text)`);
  const relTarget = path.join('data', 'two.json');
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Copy path').click()`);
  await s.waitFor(`window.emerald.clipboard.read().then(r => r.text === ${JSON.stringify(target)})`, 'Copy path puts the absolute path on the clipboard', 3000);
  await s.rightClick(rowBox.x, rowBox.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(target)}`, 'the entry menu reopens');
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Copy relative path').click()`);
  await s.waitFor(`window.emerald.clipboard.read().then(r => r.text === ${JSON.stringify(relTarget)})`, 'Copy relative path puts the relative path on the clipboard', 3000);
  await s.evalJs(`window.emerald.clipboard.write(${JSON.stringify(railClipSaved ?? '')})`);
  step("Copy path and Copy relative path put the absolute and relative paths on the app's own clipboard");
  await s.rightClick(rowBox.x, rowBox.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(target)}`, 'the entry menu reopens once more');
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Insert path into pane').click()`);
  await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed');
  const typed = async () => Buffer.from((await zreq(s, 'session.read', { sessionId: shell1.id })).data, 'base64').toString('utf8');
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.read', { sessionId: ${JSON.stringify(shell1.id)} }); return atob(r.data).includes('data\\\\two.json'); })()`, 'the relative path in the shell', 5000);
  expect(!(await typed()).includes(seed + '\\data\\two.json'), 'the path is relative, not absolute');
  // PSReadLine clears the line on Escape, so nothing runs.
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(shell1.id)}, data: String.fromCharCode(27) })`);
  step('Insert path from the entry menu types the relative path into the focused pane');

  // Collapse all, then the rail's own collapse, the key and the width.
  await s.evalJs(`document.querySelector('.files-button[title="Collapse all folders"]').click()`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data', 'two.json')))})`, 'collapse all closes data');
  await s.key('F', 'KeyF', 70, CTRL | SHIFT);
  await s.waitFor(`!!document.querySelector('.files-rail-collapsed') && !document.querySelector('.files-rail')`, 'Ctrl+Shift+F hides the rail');
  await s.evalJs(`document.querySelector('.files-expand').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail')`, 'the thin rail brings it back');
  await s.evalJs(`document.querySelector('.files-collapse').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail-collapsed')`, 'the header button hides it');
  await s.evalJs(`document.querySelector('.files-rail-label').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail')`, 'the label brings it back');
  const edge = await s.evalJs(`(() => { const r = document.querySelector('.files-resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 100 }; })()`);
  await s.mouse('mousePressed', edge.x, edge.y);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: edge.x - 80, y: edge.y, button: 'left', buttons: 1 });
  await s.mouse('mouseReleased', edge.x - 80, edge.y);
  const width = await s.evalJs(`document.querySelector('.files-rail').getBoundingClientRect().width`);
  expect(Math.abs(width - 340) <= 2, `dragging the edge 80 px left widens the rail to 340 (${width})`);
  // M27: Contents and a scope set through Find in folder are still set
  // after the reload, since the root comes back the same.
  const dataRow = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data')))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(dataRow.x, dataRow.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(path.join(seed, 'data'))}`, 'the folder menu again');
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Find in folder').click()`);
  await s.waitFor(`document.querySelector('.files-scope-name')?.textContent === 'in data' && document.querySelector('.files-mode[data-mode="contents"]').dataset.active === 'true'`, 'Contents and the scope set');
  await s.send('Page.reload');
  await sleep(1500);
  await s.waitFor(`document.querySelectorAll('.files-row').length > 0`, 'the tree is back after a reload');
  const after = await s.evalJs(`document.querySelector('.files-rail').getBoundingClientRect().width`);
  expect(Math.abs(after - 340) <= 2, `the width survives a reload (${after})`);
  expect((await s.evalJs(`document.querySelector('.files-mode[data-mode="contents"]').dataset.active`)) === 'true', 'Contents survives the reload');
  expect((await s.evalJs(`document.querySelector('.files-scope-name')?.textContent`)) === 'in data', 'and so does the scope');
  await s.evalJs(`document.querySelector('.files-scope-clear').click()`);
  await s.evalJs(`document.querySelector('.files-mode[data-mode="names"]').click()`);
  await s.waitFor(`!document.querySelector('.files-scope') && document.querySelector('.files-mode[data-mode="names"]').dataset.active === 'true'`, 'back to names, no scope');
  step('collapse all, the key, the thin rail, and the width, the mode and the scope across a reload');

  // Git status colours: cd the first shell into the seeded repo, then a
  // row per status, a write turning a tracked file orange without a
  // refresh, and a git add (which the folder watcher cannot see, it is
  // inside .git) caught by the poll.
  const gitOf = (p) => `document.querySelector(${JSON.stringify(rowSel(p))})?.dataset.git ?? 'clean'`;
  await typeInto(s, shell1.id, `cd ${JSON.stringify(repo)}`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'root follows cd into the repo', 10000);
  await s.waitFor(`${gitOf(path.join(repo, 'new.txt'))} === 'untracked'`, 'the new file is untracked', 5000);
  const tints = await s.evalJs(
    `['.git', '.gitignore', 'tracked.txt', 'staged.txt', 'new.txt', 'ignored.log'].map(n => n + '=' + (document.querySelector('.files-row[data-path=' + JSON.stringify(${JSON.stringify(repo + '\\')} + n) + ']')?.dataset.git ?? 'clean')).join(',')`,
  );
  expect(tints === '.git=clean,.gitignore=clean,tracked.txt=clean,staged.txt=staged,new.txt=untracked,ignored.log=ignored', `one tint per status: ${tints}`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(path.join(repo, 'new.txt')))}).title`)) === 'new.txt (untracked)', 'the status is in the tooltip');
  await s.screenshot('m20-git.png');
  step('a seeded repo shows untracked, staged and ignored rows in their colours');

  // M9 fix 335: the header names the branch under the folder, read
  // against git itself rather than assumed to be main.
  const headerBranch = git('branch', '--show-current').trim();
  expect((await s.evalJs(`document.querySelector('.files-branch-name')?.textContent`)) === headerBranch, `the header's pill names the repo's branch (${headerBranch})`);
  step("the rail header's branch pill names the repository's checked-out branch");

  // Fix 32: a folder whose only listed entry is ignored is not itself
  // dim; the file under it still is.
  expect((await s.evalJs(gitOf(path.join(repo, 'sub')))) === 'clean', 'a folder with an ignored file in it stays clean');
  await clickRow(s, path.join(repo, 'sub'));
  await s.waitFor(`${gitOf(path.join(repo, 'sub', 'ignored.log'))} === 'ignored'`, 'the ignored file under it is dim', 5000);
  expect((await s.evalJs(gitOf(path.join(repo, 'sub', 'keep.txt')))) === 'clean', 'and its committed neighbour is clean');
  await clickRow(s, path.join(repo, 'sub'));
  step('ignored does not roll up onto the folder');

  // M9 fix 334: a new untracked file must not paint its clean, tracked
  // siblings. sub rolls up to untracked once a file under it is new
  // (git never lists sub itself, so it is not in the codes index), but
  // keep.txt, listed and clean, must not inherit the rollup.
  await clickRow(s, path.join(repo, 'sub'));
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(path.join(repo, 'sub', 'keep.txt')))})`, 'sub expanded');
  expect((await s.evalJs(gitOf(path.join(repo, 'sub', 'keep.txt')))) === 'clean', 'keep.txt starts clean');
  fs.writeFileSync(path.join(repo, 'sub', 'fresh.txt'), 'fresh');
  await s.waitFor(`${gitOf(path.join(repo, 'sub'))} === 'untracked'`, 'the new file rolls sub up to untracked', 5000);
  expect((await s.evalJs(gitOf(path.join(repo, 'sub', 'keep.txt')))) === 'clean', 'keep.txt does not inherit the rollup');
  fs.rmSync(path.join(repo, 'sub', 'fresh.txt'));
  await s.waitFor(`${gitOf(path.join(repo, 'sub'))} === 'clean'`, 'sub is clean again once the new file is gone', 5000);
  await clickRow(s, path.join(repo, 'sub'));
  step('M9 fix 334: one new file no longer paints every tracked file beside it green');

  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'tracked, changed');
  await s.waitFor(`${gitOf(path.join(repo, 'tracked.txt'))} === 'modified'`, 'a write turns the row orange', 2000);
  git('add', 'tracked.txt');
  await s.waitFor(`${gitOf(path.join(repo, 'tracked.txt'))} === 'staged'`, 'git add turns it green', 8000);
  step('a write shows as modified within two seconds and a git add as staged');

  // M45: the status letter column, the Changes tab and the Commits tab.
  // The repo at this point: tracked.txt and staged.txt staged with a
  // change (M in the index), new.txt untracked, the ignored files; one
  // more file is added to the index so the A shows, and staged.txt gets
  // a second write so it is the work tree's M (amber) beside the index's
  // (green) on tracked.txt.
  fs.writeFileSync(path.join(repo, 'added.txt'), 'added');
  git('add', 'added.txt');
  fs.writeFileSync(path.join(repo, 'staged.txt'), 'staged, changed twice');
  const letterOf = (p) => `document.querySelector(${JSON.stringify(rowSel(p))})?.querySelector('.git-letter')?.textContent ?? null`;
  await s.waitFor(`(${letterOf(path.join(repo, 'added.txt'))}) === 'A' && (${gitOf(path.join(repo, 'staged.txt'))}) === 'modified'`, 'the added file has its A and the second write shows', 8000);
  const letters = await s.evalJs(
    `['tracked.txt', 'staged.txt', 'added.txt', 'new.txt', 'sub'].map(n => n + '=' + JSON.stringify(document.querySelector('.files-row[data-path=' + JSON.stringify(${JSON.stringify(repo + '\\')} + n) + ']')?.querySelector('.git-letter')?.textContent ?? null)).join(',')`,
  );
  expect(letters === 'tracked.txt="M",staged.txt="M",added.txt="A",new.txt="",sub=null', `the letters per row: ${letters}`);
  const letterBox = await s.evalJs(`(() => { const l = document.querySelector(${JSON.stringify(rowSel(path.join(repo, 'added.txt')))}).querySelector('.git-letter'); const r = l.getBoundingClientRect(); return { width: r.width, color: getComputedStyle(l).color, amber: getComputedStyle(document.querySelector(${JSON.stringify(rowSel(path.join(repo, 'staged.txt')))}).querySelector('.git-letter')).color }; })()`);
  expect(letterBox.width === 12, `the letter column is 12px (${letterBox.width})`);
  expect(letterBox.color === 'rgb(106, 196, 126)', `an added file's A is the done green (${letterBox.color})`);
  expect(letterBox.amber === 'rgb(232, 163, 61)', `a changed file's M is the working amber (${letterBox.amber})`);
  step('the tree shows M, A and no letter on an untracked file in the git colours');

  // M9 fix 70: the Changes tab folded into Files. The count of the four
  // changed files (the ignored ones left out) sits on the Files tab, the
  // tree's changed rows carry their counts and the untracked one none,
  // and the Changed toggle lists the four flat, by path from the root,
  // where a click opens the file; the toggle survives a reload.
  expect((await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"] .rail-tab-count')?.textContent`)) === '4', 'the Files tab counts the four changed files');
  expect((await s.evalJs(`document.querySelectorAll('.rail-tab').length`)) === 3, 'three rail tabs');
  const countsOf = (n) => `(document.querySelector('.files-row[data-path=' + JSON.stringify(${JSON.stringify(repo + '\\')} + ${JSON.stringify(n)}) + ']')?.querySelector('.changes-counts')?.textContent ?? null)`;
  await s.waitFor(`${countsOf('added.txt')} === '+1 −0' && ${countsOf('staged.txt')} === '+1 −1' && ${countsOf('tracked.txt')} === '+1 −1'`, 'the counts on the changed rows', 8000);
  expect((await s.evalJs(countsOf('new.txt'))) === null, 'the untracked row has no counts');
  expect((await s.evalJs(countsOf('sub'))) === null, 'a folder row has no counts');
  expect((await s.evalJs(`document.querySelector('.files-rail').dataset.changed`)) === undefined, 'the tree shows by default');
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === 'true' && document.querySelectorAll('.files-changed-row').length === 4`, 'the Changed list', 8000);
  // Fix 492: a poll whose status ran before the git add above and whose
  // numstat ran after it is corrected by the next poll (the stamp carries the
  // status code now), so the read waits a poll and a half for the right list.
  const changeRowsRead = `[...document.querySelectorAll('.files-changed-row')].map(r => r.querySelector('.git-letter').textContent + '|' + r.querySelector('.files-name').textContent + '|' + (r.querySelector('.changes-counts')?.textContent ?? '') + '|' + r.dataset.git).join(';')`;
  const changeRowsWant = 'A|added.txt|+1 −0|staged;|new.txt||untracked;M|staged.txt|+1 −1|modified;M|tracked.txt|+1 −1|staged';
  await s.waitFor(`${changeRowsRead} === ${JSON.stringify(changeRowsWant)}`, 'the list by path with the letter, the counts and the status', 8000).catch(() => {});
  const changeRows = await s.evalJs(changeRowsRead);
  expect(
    changeRows === changeRowsWant,
    `the list by path with the letter, the counts and the status: ${changeRows}`,
  );
  expect((await s.evalJs(`document.querySelectorAll('.files-row:not(.files-changed-row)').length`)) === 0, 'the tree gives way to the list');
  await s.evalJs(`[...document.querySelectorAll('.files-changed-row')].find(r => r.querySelector('.files-name').textContent === 'staged.txt').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'text'`, 'a click on a changed file opens it in a tab');
  await s.evalJs(`document.querySelector('.tab[data-active] .tab-close')?.click()`);
  // The filter box narrows the list by path, with no search asked for.
  await setInput(s, '.files-filter-input', 'staged');
  await s.waitFor(`document.querySelectorAll('.files-changed-row').length === 1 && document.querySelector('.files-changed-row .files-name')?.textContent === 'staged.txt'`, 'the filter narrows the Changed list', 3000);
  await setInput(s, '.files-filter-input', '');
  await s.waitFor(`document.querySelectorAll('.files-changed-row').length === 4`, 'the list back whole');
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === 'true' && document.querySelectorAll('.files-changed-row').length === 4`, 'the toggle across a reload', 15000);
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === undefined && document.querySelectorAll('.files-row').length > 4`, 'the tree back', 8000);
  step('the Files tab carries the count, the changed rows their counts, and the Changed toggle lists the four flat with a click opening the file');

  // M9 fix 197: a folded folder carries the sum of the changed files
  // under it, in the muted weight with the file count in its tooltip,
  // folded and expanded alike; the two files are then put back so the
  // steps after this one find the four changes they count on.
  fs.writeFileSync(path.join(repo, 'sub', 'keep.txt'), 'keep, changed\nand a line more');
  fs.writeFileSync(path.join(repo, 'sub', 'other.txt'), 'other');
  git('add', path.join('sub', 'other.txt'));
  const subCounts = `document.querySelector(${JSON.stringify(rowSel(path.join(repo, 'sub')))})?.querySelector('.changes-counts')`;
  await s.waitFor(`${subCounts}?.textContent === '+3 −1'`, 'the folded folder sums its two files', 8000);
  const rollup = await s.evalJs(`(() => { const c = ${subCounts}; return { title: c.title, rollup: c.dataset.rollup, opacity: getComputedStyle(c).opacity, expanded: document.querySelector(${JSON.stringify(rowSel(path.join(repo, 'sub')))}).dataset.expanded ?? null }; })()`);
  expect(rollup.title === '2 files, +3 −1', `the tooltip counts the files (${rollup.title})`);
  expect(rollup.rollup === 'true' && rollup.opacity === '0.7', `the rollup is in the muted weight (${rollup.rollup}, ${rollup.opacity})`);
  expect(rollup.expanded === null, 'read folded');
  await clickRow(s, path.join(repo, 'sub'));
  await s.waitFor(`${countsOf('sub\\keep.txt')} === '+2 −1' && ${countsOf('sub\\other.txt')} === '+1 −0'`, 'expanded, the files carry their own counts', 8000);
  expect((await s.evalJs(`${subCounts}?.textContent`)) === '+3 −1', 'and the folder keeps the sum');
  await clickRow(s, path.join(repo, 'sub'));
  git('checkout', '--', path.join('sub', 'keep.txt'));
  git('rm', '-q', '--cached', path.join('sub', 'other.txt'));
  fs.rmSync(path.join(repo, 'sub', 'other.txt'));
  await s.waitFor(`${subCounts} === null`, 'the folder is plain again once nothing under it has changed', 8000);
  step('M9 fix 197: a folded folder sums the changed files under it, with the file count in the tooltip');

  // The Commits tab (Timeline until M49): the branch line at the top,
  // the seed commit under earlier, a commit made now under the heading
  // for this session, both headings only once a commit has landed since
  // the session started.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'timeline' && document.querySelectorAll('.commits-row').length === 1`, 'the Commits tab lists the seed commit', 8000);
  expect((await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"] .rail-tab-label').textContent`)) === 'Activity', 'the tab reads Activity (M66)');
  const branchLine = await s.evalJs(`document.querySelector('.commits-branch-name')?.textContent ?? null`);
  expect(branchLine === git('branch', '--show-current').trim(), `the branch line names the checked out branch (${branchLine})`);
  expect((await s.evalJs(`document.querySelector('.commits-row .commits-subject').textContent`)) === 'seed', 'the seed commit');
  git('add', 'added.txt');
  git('commit', '-q', '-m', 'made in the session');
  // Within four seconds, still under the poll's five: the main process
  // watches the repository's logs (M49), then a 300 ms debounce there
  // and another in the renderer, then seven gits in sequence on the one
  // git worker thread, 100 to 400 ms a spawn under load (M9 fix 531;
  // main.log's files-changed push line is the watch's trace).
  await s.waitFor(`document.querySelectorAll('.commits-row').length === 2 && document.querySelector('.commits-row[data-recent]') !== null`, 'the new commit lands within four seconds', 4000, { quietMs: 0 });
  const timeline = await s.evalJs(`[...document.querySelectorAll('.commits-row')].map(e => (e.dataset.recent ? '*' : '') + e.querySelector('.commits-subject').textContent + '|' + e.querySelector('.commits-hash').textContent.length + '|' + e.dataset.hash.length).join(';')`);
  expect(timeline === '*made in the session|7|40;seed|7|40', `the commit since the session started brighter, the hash shown short and carried whole: ${timeline}`);
  // The commit took everything staged (added.txt, tracked.txt and the
  // index half of staged.txt), leaving staged.txt's work tree change and
  // new.txt. The count is on the tree's own status poll, a separate
  // timer from the panel's, so it can be a poll behind the log.
  await s.waitFor(`document.querySelector('.rail-tab[data-tab="files"] .rail-tab-count')?.textContent === '2'`, 'the commit takes the staged files off the Files count', 8000);
  step('the Commits tab names the branch, lists the seed commit and a commit made now, brighter since the session started, within four seconds');

  // M49: the sessions' lanes. A PostToolUse of a git commit posted for
  // the shell in the repo makes the daemon read HEAD and record it, and
  // the row of that commit gets the shell's lane and its colour on the
  // hash; a second session (spawned on the daemon, no pane) commits in
  // between two of the first's, so its dot sits inside the first's span
  // and the two lanes overlap on that row.
  const daemon = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  // The tool is Bash unless said otherwise: the third commit goes through
  // Claude Code's PowerShell tool with its own spelling of a folder
  // change, which credited nothing until M9 fix 106.
  const postCommit = async (sessionId, toolName = 'Bash', command = 'git commit -q -m "made in the session"') => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ session_id: `sim-${sessionId}`, hook_event_name: 'PostToolUse', tool_name: toolName, tool_input: { command }, tool_response: { stdout: '' } }),
    });
    expect(res.status === 204, 'sink answered 204 for the PostToolUse');
  };
  const headHash = () => git('rev-parse', 'HEAD').trim();
  const commitsOf = async (id) => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id).commits;
  const c2 = headHash();
  await postCommit(shell1.id);
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(shell1.id)}).commits.length === 1; })()`, 'the daemon recorded HEAD off the commit', 5000);
  expect((await commitsOf(shell1.id))[0].hash === c2, 'the recorded hash is HEAD, whole, with the time of the claim (M58)');
  const rowSelOf = (hash) => `.commits-row[data-hash=${JSON.stringify(hash)}]`;
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSelOf(c2))})?.dataset.owner === ${JSON.stringify(shell1.id)}`, 'the row is owned by the shell', 5000);
  const nodeSel = (hash) => `.commits-node[data-hash=${JSON.stringify(hash)}]`;
  const laneColor = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSelOf(c2))}); const n = document.querySelector(${JSON.stringify(nodeSel(c2))}); return { hash: getComputedStyle(r.querySelector('.commits-hash')).color, bar: getComputedStyle(n).fill, lanes: document.querySelector('.commits-panel').dataset.lanes, session: n.dataset.session ?? null }; })()`);
  const shellNow = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === shell1.id);
  const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  expect(laneColor.hash === rgb(shellNow.color) && laneColor.bar === rgb(shellNow.color), `the hash and the dot take the session's colour ${shellNow.color}: ${JSON.stringify(laneColor)}`);
  expect(laneColor.lanes === '2' && laneColor.session === shell1.id, `the session's lane and the grey one for the seed, the node the session's (${JSON.stringify(laneColor)})`);
  // The picture: a row's subject, the lane its node sits on, and whose it is.
  // The commit rows alone: since M68 a session bound to Claude by its
  // hook has a row of its own above its newest commit.
  const pictureOf = () => s.evalJs(`[...document.querySelectorAll('.commits-graph-rows .commits-row[data-hash]')].map(e => e.querySelector('.commits-subject').textContent + ':' + document.querySelector('.commits-node[data-hash=' + JSON.stringify(e.dataset.hash) + ']').dataset.lane + ':' + (e.dataset.owner === ${JSON.stringify(shell1.id)} ? 'A' : e.dataset.owner === 'none' ? '-' : 'B')).join(';')`);
  const second = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo, cols: 80, rows: 24 })).session;
  fs.writeFileSync(path.join(repo, 'b.txt'), 'b');
  git('add', 'b.txt');
  git('commit', '-q', '-m', 'by the other');
  const c3 = headHash();
  await postCommit(second.id);
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(second.id)}).commits.length === 1; })()`, 'the other session recorded its commit', 5000);
  fs.writeFileSync(path.join(repo, 'c.txt'), 'c');
  git('add', 'c.txt');
  git('commit', '-q', '-m', 'by the first again');
  const c4 = headHash();
  await postCommit(shell1.id, 'PowerShell', `Set-Location -Path ${JSON.stringify(repo)}; git commit -q -m "by the first again"`);
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(shell1.id)}).commits.length === 2; })()`, 'the first session recorded its second', 5000);
  expect((await commitsOf(shell1.id))[1].hash === c4, 'the PowerShell commit is credited with its hash');
  await s.waitFor(`document.querySelectorAll('.commits-row[data-hash]').length === 4 && document.querySelector('.commits-panel').dataset.lanes === '3'`, 'four commits, a lane per session and the grey one', 8000);
  const picture = await pictureOf();
  expect(picture === `by the first again:0:A;by the other:1:B;made in the session:0:A;seed:2:-`, `the first session's line holds its two commits, the other's its one between them, the seed on the grey lane: ${picture}`);
  await s.screenshot('m49-lanes.png');
  step('the Commits tab draws a line per session from the hashes the daemon recorded, the sessions side by side');

  // M9 fix 198: the files a session wrote, marked in its colour. An Edit
  // PostToolUse on the first shell puts a dot in its colour on the
  // folded folder and, expanded, on the file's row with the session's
  // name and the age in the tooltip; the other session's Edit on the
  // same file adds a second dot, the newest first, and the Changed list's
  // row carries the same cell. The tree is put back as it was (the
  // folder folded, the file clean, the Activity tab up) for the steps after.
  const postEdit = async (sessionId, file) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ session_id: `sim-${sessionId}`, hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: repo, tool_input: { file_path: file, old_string: 'keep', new_string: 'kept' }, tool_response: {} }),
    });
    expect(res.status === 204, 'sink answered 204 for the Edit');
  };
  const keepFile = path.join(repo, 'sub', 'keep.txt');
  const subDir = path.join(repo, 'sub');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'files' && document.querySelector(${JSON.stringify(rowSel(subDir))}) !== null && !document.querySelector(${JSON.stringify(rowSel(subDir))}).dataset.expanded`, 'the tree back, the folder folded', 8000);
  const dotsOf = (p) => `[...(document.querySelector(${JSON.stringify(rowSel(p))})?.querySelectorAll('.files-touched-dot') ?? [])].map((d) => getComputedStyle(d).backgroundColor)`;
  const tipOf = (p) => `document.querySelector(${JSON.stringify(rowSel(p))})?.querySelector('.files-touched')?.title ?? null`;
  await postEdit(shell1.id, keepFile);
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return (r.sessions.find((x) => x.id === ${JSON.stringify(shell1.id)}).touched ?? []).length === 1; })()`, 'the daemon kept the touched file', 5000);
  await s.waitFor(`${dotsOf(subDir)}.length === 1`, 'the folded folder carries a dot', 5000);
  const folderDot = await s.evalJs(`({ dots: ${dotsOf(subDir)}, tip: ${tipOf(subDir)} })`);
  expect(folderDot.dots[0] === rgb(shellNow.color), `the dot is the session's colour ${shellNow.color}: ${JSON.stringify(folderDot)}`);
  expect(folderDot.tip.startsWith(`${shellNow.name} `) && folderDot.tip.endsWith(' ago'), `the tooltip names the session and when: ${folderDot.tip}`);
  await clickRow(s, subDir);
  await s.waitFor(`${dotsOf(keepFile)}.length === 1 && ${dotsOf(subDir)}.length === 0`, 'expanded, the file has the dot and the folder none', 8000);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(keepFile))}).querySelector('.git-letter').textContent`)) === '', 'a dot with no letter keeps the dot');
  await postEdit(second.id, keepFile);
  await s.waitFor(`${dotsOf(keepFile)}.length === 2`, "the other session's Edit adds a second dot", 5000);
  const editor2 = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === second.id);
  const twoDots = await s.evalJs(`({ dots: ${dotsOf(keepFile)}, tip: ${tipOf(keepFile)} })`);
  expect(twoDots.dots[0] === rgb(editor2.color) && twoDots.dots[1] === rgb(shellNow.color), `the newest write first, each in its session's colour: ${JSON.stringify(twoDots)}`);
  expect(twoDots.tip.split(String.fromCharCode(10)).length === 2 && twoDots.tip.startsWith(`${editor2.name} `), `two lines in the tooltip: ${JSON.stringify(twoDots.tip)}`);
  // The Changed list's row gets the same cell.
  fs.writeFileSync(keepFile, 'kept');
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`[...document.querySelectorAll('.files-changed-row')].some((r) => r.dataset.path === ${JSON.stringify(keepFile)} && r.querySelectorAll('.files-touched-dot').length === 2)`, 'the Changed row carries the two dots', 8000);
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  git('checkout', '--', path.join('sub', 'keep.txt'));
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === undefined && (${gitOf(keepFile)}) === 'clean'`, 'the tree back and the file clean', 8000);
  await clickRow(s, subDir);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'timeline' && document.querySelectorAll('.commits-row[data-hash]').length === 4`, 'the Activity tab back with its four commits', 8000);
  step("M9 fix 198: the files a session wrote carry a dot in its colour, on the folded folder and the file's row, two sessions two dots, and on the Changed list");

  // M9 fix 199: a changed row's menu leads with Show diff; a clean row's
  // does not (the read at the seed folder above), nor an untracked one's.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'files' && !!document.querySelector(${JSON.stringify(rowSel(path.join(repo, 'staged.txt')))})`, 'the tree back', 8000);
  const menuOf = async (p) => {
    const box = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(p))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.rightClick(box.x, box.y);
    await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(p)}`, 'the row menu');
    // M9 fix 310: each label with its disabled flag, as `label` or `label (disabled)`.
    const items = await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].map((b) => b.querySelector('.menu-label').textContent + (b.disabled ? ' (disabled)' : ''))`);
    await s.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed');
    return items;
  };
  const stagedMenu = await menuOf(path.join(repo, 'staged.txt'));
  // M9 fix 310 puts Revert changes right under Show diff.
  expect(stagedMenu.slice(0, 3).join(',') === 'Show diff,Revert changes,Open in a tab', `Show diff then Revert changes head a changed row's menu: ${stagedMenu.join(',')}`);
  const newMenu = await menuOf(path.join(repo, 'new.txt'));
  expect(newMenu.slice(0, 2).join(',') === 'Revert changes (disabled),Open in a tab', `an untracked row's menu has no Show diff and Revert disabled: ${newMenu.join(',')}`);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'timeline' && document.querySelectorAll('.commits-row[data-hash]').length === 4`, 'the Activity tab back', 8000);
  step("M9 fix 199: Show diff heads a changed row's menu and stays off an untracked one's");

  // M68: M59 drew the second of two lanes on twin colours dashed; the
  // dash is gone for a bigger palette, so the old palette's teal and
  // blue (0.077 apart in OKLab) set by hand on the two sessions draw
  // solid both, and no edge carries a variant. The lines are read over
  // every solid edge, since a session with one commit draws no line of
  // its own once a line stops at the lowest dot (M68 task 4).
  await zreq(s, 'session.set', { sessionId: shell1.id, color: '#56b6c2' });
  await zreq(s, 'session.set', { sessionId: second.id, color: '#61afef' });
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(c3))})?.style.getPropertyValue('--lane') === '#61afef'`, 'the second lane took the twin colour', 5000);
  const twins = await s.evalJs(`(() => { const es = [...document.querySelectorAll('.commits-edge:not([data-dashed])')]; const n = document.querySelector(${JSON.stringify(nodeSel(c3))}); return { variants: document.querySelectorAll('[data-variant]').length, dashes: es.map(e => getComputedStyle(e).strokeDasharray).join(','), n: es.length, dot: getComputedStyle(n).fill }; })()`);
  expect(twins.variants === 0 && twins.n >= 1 && twins.dashes.split(',').every((d) => d === 'none') && twins.dot === rgb('#61afef'), `both session lines solid on twin colours, no variant, the node in its colour (${JSON.stringify(twins)})`);
  await zreq(s, 'session.set', { sessionId: second.id, color: '#e06c75' });
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(c3))})?.style.getPropertyValue('--lane') === '#e06c75'`, 'the colour set back', 5000);
  step('M68: two lanes on twin colours both draw solid and no edge carries a variant');
  // M60: the lane card. A hover on the other session's dot opens a card
  // naming it, with its state, folder and its one commit here, and Show;
  // a click pins it and Escape closes it. Killed, the same lane offers
  // Resume in a new pane, which brings the session back beside the
  // focused pane; the first session's Transcript opens the Sessions tab.
  const cardSel = '.lane-popover';
  const hoverOver = async (selector) => {
    const c = await s.evalJs(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.getClientRects().length > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    expect(c !== null, `something to hover at ${selector}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
    return c;
  };
  const readCard = () =>
    s.evalJs(
      `(() => { const c = document.querySelector(${JSON.stringify(cardSel)}); if (!c) return null; return { session: c.dataset.sessionId, mark: c.querySelector('.session-mark') ? 'claude' : c.querySelector('.shell-mark') ? 'shell' : null, name: c.querySelector('.lane-card-name')?.textContent ?? null, state: c.querySelector('.lane-card-state')?.textContent ?? null, where: c.querySelector('.lane-card-where')?.textContent ?? null, commits: c.querySelector('.lane-card-commits')?.textContent ?? null, newest: c.querySelector('.lane-card-newest')?.textContent ?? null, actions: [...c.querySelectorAll('.lane-card-action')].map((b) => b.dataset.action).join(',') }; })()`,
    );
  const postHook = async (sessionId, payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, { method: 'POST', headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId }, body: JSON.stringify({ session_id: `sim-${sessionId}`, cwd: repo, ...payload }) });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  const repoBranch = git('branch', '--show-current').trim();
  const dotSel = nodeSel(c3);
  const groupSel = `.commits-lane-group[data-session=${JSON.stringify(second.id)}]`;
  const secondNow = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === second.id);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(dotSel)}).closest('.commits-lane-group')?.dataset.session ?? null`)) === second.id, "the node sits in its session's group");
  const dotAt = await hoverOver(dotSel);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(cardSel)})`, 'the lane card opens on a hover over the dot', 3000);
  const card = await readCard();
  expect(card.session === second.id && card.name === secondNow.name, `the card is the other session's (${JSON.stringify(card)})`);
  // M9 fix 112: the second session is a shell whose posted hook bound it
  // as Claude, so the sidebar row draws the star, and the card draws the
  // same mark rather than the shell's prompt glyph.
  const rowMark = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=' + ${JSON.stringify(JSON.stringify(second.id))} + ']'); return r?.querySelector('.session-mark') ? 'claude' : r?.querySelector('.shell-mark') ? 'shell' : null; })()`);
  expect(card.mark === 'claude' && rowMark === 'claude', `the card's mark is the row's star (card ${card.mark}, row ${rowMark})`);
  expect(card.state === 'working' && card.where === `⑂ ${repoBranch}`, `the posted commit left it working, on the repo's branch (${JSON.stringify(card)})`);
  expect(/^1 commit here, the newest \d+s ago$/.test(card.commits) && card.newest.endsWith('by the other'), `its one commit here, the newest named (${JSON.stringify(card)})`);
  // M71 and M72 put the graph-or-line toggle and the two lane filters on
  // every card, after the ways to the session.
  expect(card.actions === 'show,layout,solo,lines', `a live session with no conversation bound offers Show alone before the graph actions (${card.actions})`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(groupSel)}).dataset.popoverOpen`)) === 'hover', 'the group says the card is open on hover');
  await s.click(dotAt.x, dotAt.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(groupSel)}).dataset.popoverOpen === 'pinned'`, 'a click pins the card');
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
  await sleep(400);
  expect((await readCard()) !== null, 'a pinned card stays when the mouse leaves');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'Escape closes the card');
  // Killed: the lane stays (the store keeps the exited session) and the
  // card offers Resume in a new pane.
  const panesBefore = leaves(await getLayout(s)).length;
  await zreq(s, 'session.kill', { sessionId: second.id });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(second.id)})?.state === 'exited'; })()`, 'the other session exited', 8000);
  await hoverOver(dotSel);
  await s.waitFor(`document.querySelector(${JSON.stringify(cardSel + ' [data-action="resume"]')}) !== null`, 'an exited session offers Resume in a new pane', 3000);
  const exitedCard = await readCard();
  expect(exitedCard.actions === 'resume,layout,solo,lines' && /^(exited|killed)/.test(exitedCard.state), `no Show for an exited session, its state on the card (${JSON.stringify(exitedCard)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(cardSel + ' [data-action="resume"]')}).click()`);
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(second.id)})?.state !== 'exited'; })()`, 'Resume in a new pane resumed it', 8000);
  await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'the card closed on the action');
  // The new pane lands in the layout before the resumed session is put in
  // it, so a read at once can see three panes and none holding it yet
  // (missed at the close-outs of fixes 450 to 493 and 494 to 541).
  let layoutAfter = await getLayout(s);
  for (let i = 0; i < 30 && !leaves(layoutAfter).some((p) => p.sessionId === second.id); i++) {
    await sleep(100);
    layoutAfter = await getLayout(s);
  }
  expect(leaves(layoutAfter).length === panesBefore + 1 && leaves(layoutAfter).some((p) => p.sessionId === second.id), `the session came back in a new pane (${panesBefore} to ${leaves(layoutAfter).length})`);
  // Transcript on the first session's lane, once a SessionStart has
  // bound a conversation to it: the rail goes to the Sessions tab (the
  // scan has no transcript for a simulated id, so the reveal is taken
  // and nothing unfolds).
  await postHook(shell1.id, { hook_event_name: 'SessionStart', source: 'startup' });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(shell1.id)})?.claudeSessionId !== null; })()`, 'the first session has a conversation bound', 5000);
  const probe = await s.evalJs(`(() => ({ tab: document.querySelector('.files-rail')?.dataset.tab, root: document.querySelector('.files-rail')?.dataset.root, rows: [...document.querySelectorAll('.commits-row[data-hash]')].map((r) => r.dataset.hash.slice(0, 7)).join(';') }))()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(c2))})?.dataset.session === ${JSON.stringify(shell1.id)}`, `the first session's node on its row (${JSON.stringify(probe)})`, 5000);
  await hoverOver(nodeSel(c2));
  await s.waitFor(`document.querySelector(${JSON.stringify(cardSel + ' [data-action="transcript"]')}) !== null`, "the first session's card offers Transcript", 3000);
  await s.evalJs(`document.querySelector(${JSON.stringify(cardSel + ' [data-action="transcript"]')}).click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'history'`, 'Transcript opens the Sessions tab', 3000);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'timeline'`, 'back on Commits');
  step(`M60: the lane card names the session, its state, folder and commit, draws the row's mark (fix 112), pins on a click, offers Resume in a new pane once exited (a pane added) and Transcript`);
  // M57: a lane is for good. The other session killed and cleared from
  // the list keeps its lane and its dot, marked gone, and the daemon
  // still lists it behind the flag with when it was removed.
  // The M60 step before this leaves the pane it added (the resumed
  // session, killed here) focused and empty, and the rail follows the
  // focused pane, so put the focus back on the first session's pane.
  const p1Focus = async () => {
    await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    await s.waitFor(`document.querySelector('.commits-panel') !== null && document.querySelectorAll('.commits-row').length > 0`, 'the commits list for the first session', 10000);
  };
  await zreq(s, 'session.kill', { sessionId: second.id, remove: true });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return !r.sessions.some(x => x.id === ${JSON.stringify(second.id)}); })()`, 'the other session left the list', 10000);
  await p1Focus();
  const kept = (await zreq(s, 'session.list', { removed: true })).sessions.find((x) => x.id === second.id);
  expect(kept !== undefined && typeof kept.removedAt === 'number' && kept.name === second.name && kept.commits.length === 1, `the daemon keeps the removed session with its name and its commit (${JSON.stringify(kept && [kept.name, kept.removedAt, kept.commits.length])})`);
  // The lane count is whatever the M60 resume left; the point is the lane marked gone.
  await s.waitFor(`document.querySelector('.commits-node[data-gone]') !== null`, 'a block still there, marked gone', 5000);
  const gone = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSelOf(c3))}); const n = document.querySelector(${JSON.stringify(nodeSel(c3))}); return { own: n.dataset.session === ${JSON.stringify(second.id)}, gone: 'gone' in n.dataset, line: document.querySelector('.commits-edge[data-session=' + JSON.stringify(${JSON.stringify(second.id)}) + '][data-gone]') !== null, owner: r.dataset.owner ?? null }; })()`);
  // M68: one commit is a lone dot with no line of its own, so the mark
  // is read off the node alone.
  expect(gone.own && gone.gone && gone.owner === second.id, `the removed session's node and ownership stay on its row, the block marked gone (${JSON.stringify(gone)})`);
  const pictureAfter = await pictureOf();
  expect(pictureAfter === `by the first again:0:A;by the other:1:B;made in the session:0:A;seed:2:-`, `the picture is unchanged by the clear: ${pictureAfter}`);
  await s.screenshot('m57-lanes-kept.png');
  step('M57: a session cleared from the list keeps its lane and its dot on the Commits tab, marked gone');
  // M9 fix 111: the gone lane opens a card too, saying the session was
  // removed; a shell with no conversation offers nothing to resume.
  await hoverOver(nodeSel(c3));
  await s.waitFor(`!!document.querySelector(${JSON.stringify(cardSel)})`, 'the gone lane opens a card on hover', 3000);
  const goneCard = await readCard();
  expect(goneCard.session === second.id && /^removed \d+s ago$/.test(goneCard.state) && goneCard.actions === 'layout,solo,lines', `the card is the removed session's, saying so (${JSON.stringify(goneCard)})`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
  await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'it closes when the mouse leaves');
  step("M9 fix 111: a removed session's lane opens its card");

  // M58: exactly one dot per commit. A third session in the same checkout
  // posts a git commit PostToolUse without having committed, so it reads
  // the same HEAD the first session already claimed: the row keeps its
  // one dot and the third session owns no commit; since M68 it has a lane
  // all the same, a row of its own above main's tip with its start dot,
  // since the hook bound it to Claude. Since M9 fix 472 the daemon does
  // not credit a hash another record holds from a named command at all
  // (before it, the third session held a losing second claim), so the
  // read waits out the hook and finds no commit on the third session.
  const third = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo, cols: 80, rows: 24 })).session;
  await postCommit(third.id);
  await sleep(1500);
  const thirdCommits = await s.evalJs(`(async () => (await window.emerald.request('session.list', {})).sessions.find(x => x.id === ${JSON.stringify(third.id)}).commits.length)()`);
  expect(thirdCommits === 0, `the third session does not claim a HEAD the first holds (M9 fix 472), got ${thirdCommits}`);
  const claimed = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSelOf(c4))}); const n = document.querySelector(${JSON.stringify(nodeSel(c4))}); return { owner: r.dataset.owner, dots: document.querySelectorAll(${JSON.stringify(nodeSel(c4))}).length, session: n.dataset.session, hollow: 'hollow' in n.dataset ? 1 : 0, lanes: document.querySelector('.commits-panel').dataset.lanes }; })()`);
  expect(claimed.owner === shell1.id && claimed.dots === 1 && claimed.session === shell1.id && claimed.hollow === 0 && claimed.lanes === '4', `the earlier claim keeps the commit, one node, the third session's block holding only its own row (${JSON.stringify(claimed)})`);
  const thirdRow = await s.evalJs(`(() => ({ own: document.querySelectorAll('.commits-agent-row[data-session=' + ${JSON.stringify(JSON.stringify(third.id))} + ']:not([data-member])').length, nodes: document.querySelectorAll('.commits-node[data-hash][data-session=' + ${JSON.stringify(JSON.stringify(third.id))} + ']').length, start: document.querySelectorAll('.commits-node[data-start][data-session=' + ${JSON.stringify(JSON.stringify(third.id))} + ']').length }))()`);
  expect(thirdRow.own === 1 && thirdRow.nodes === 0 && thirdRow.start === 1, `the third session is a row with a start dot and no commit node (M68) (${JSON.stringify(thirdRow)})`);
  // The seed commit, made by this script, has no owner: a filled node in
  // the grey block (M68 took the hollow dot away), the grey by computed
  // fill so a hollow rule that came back would be caught.
  const seedHash = git('rev-list', '--max-parents=0', 'HEAD').trim();
  const seedRow = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSelOf(seedHash))}); const n = document.querySelector(${JSON.stringify(nodeSel(seedHash))}); return { owner: r.dataset.owner, hollow: 'hollow' in n.dataset ? 1 : 0, outside: 'outside' in n.dataset ? 1 : 0, fill: getComputedStyle(n).fill, session: n.dataset.session ?? null, title: r.getAttribute('title') }; })()`);
  expect(seedRow.owner === 'none' && seedRow.hollow === 0 && seedRow.outside === 1 && seedRow.fill === 'rgb(110, 110, 110)' && seedRow.session === null && seedRow.title === null, `the seed commit is a filled grey node in the outside block with no owner and no tooltip (${JSON.stringify(seedRow)})`);
  // Who made it is on the row's card (M73 task 4), where the tooltip was:
  // rowBy hovers the row's subject, reads the card's By line and closes it.
  const rowBy = async (hash) => {
    const at = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSelOf(hash) + ' .commits-subject')}).getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; })()`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
    const cardSel = `.commit-popover[data-hash=${JSON.stringify(hash)}]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(cardSel)})`, `the row of ${hash.slice(0, 7)} opens its card on hover`, 3000);
    const by = await s.evalJs(`document.querySelector(${JSON.stringify(cardSel + ' [data-part="by"] .sweep-card-text')})?.textContent ?? null`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'Escape closes the card');
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    return by;
  };
  const seedBy = await rowBy(seedHash);
  expect(seedBy !== null && seedBy.includes('made outside emerald'), `the card says it was made outside emerald, got ${JSON.stringify(seedBy)}`);
  // The trailer: the third session's transcript names a claude.ai session
  // and a commit made with the matching Claude-Session trailer is credited
  // to it with no PostToolUse posted at all.
  const transcript = path.join(seed, 'third.jsonl');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }) + '\n' + JSON.stringify({ type: 'attachment', attachment: { type: 'remote_session_change', url: 'https://claude.ai/code/session_verify58' } }) + '\n');
  // The one postHook helper (M60's, kept at the merge) names no transcript; this hook does.
  await postHook(third.id, { hook_event_name: 'SessionStart', source: 'startup', transcript_path: transcript });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(third.id)}).remoteSessionId === 'session_verify58'; })()`, 'the daemon read the claude.ai session off the transcript head', 5000);
  fs.writeFileSync(path.join(repo, 'd.txt'), 'd');
  git('add', 'd.txt');
  git('commit', '-q', '-m', 'with a trailer', '-m', 'Claude-Session: https://claude.ai/code/session_verify58');
  const c5 = headHash();
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSelOf(c5))})?.dataset.owner === ${JSON.stringify(third.id)}`, 'the trailer credits the commit to the third session', 8000);
  const trailerRow = await s.evalJs(`(() => { const n = document.querySelector(${JSON.stringify(nodeSel(c5))}); return { session: n.dataset.session ?? null, hollow: 'hollow' in n.dataset ? 1 : 0, lanes: document.querySelector('.commits-panel').dataset.lanes }; })()`);
  expect(trailerRow.session === third.id && trailerRow.hollow === 0 && trailerRow.lanes === '4', `one node on the third session's block (${JSON.stringify(trailerRow)})`);
  const thirdNow = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === third.id);
  expect(thirdNow.commits.length === 0, `the daemon recorded no HEAD for it: the trailer alone credits the commit (M9 fix 472 left it no claim on ${c4.slice(0, 7)}), got ${JSON.stringify(thirdNow.commits.map((c) => c.hash.slice(0, 7)))}`);
  await s.screenshot('m58-one-dot.png');
  step('M58: a hash two sessions claim has one dot, a commit made outside emerald a filled grey one, and a trailer credits a commit with no HEAD read');

  // M68: the outside block's card. A commit with a trailer naming a
  // conversation no session here holds joins the seed commit in the
  // grey block, and a hover on the block's lane opens a card that counts
  // the two kinds; a click pins it, Escape closes it. The row tooltips
  // say which kind each is.
  fs.writeFileSync(path.join(repo, 'e.txt'), 'e');
  git('add', 'e.txt');
  git('commit', '-q', '-m', 'foreign trailer', '-m', 'Claude-Session: https://claude.ai/code/session_nobody');
  const c6 = headHash();
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSelOf(c6))})?.dataset.owner === 'none'`, 'the foreign trailer commit lands in the outside block', 8000);
  const outsideGroupSel = '.commits-lane-group[data-outside]';
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(nodeSel(c6))}).closest('.commits-lane-group')?.hasAttribute('data-outside')`)) === true, "the node sits in the outside block's group");
  // The kind is the card's By line (M73 task 4), once the row's tooltip.
  const kinds = { seed: await rowBy(seedHash), foreign: await rowBy(c6) };
  expect(kinds.seed === 'made outside emerald, no trailer' && kinds.foreign === 'made outside emerald, its trailer naming a conversation this daemon never held', `the row cards say which kind (${JSON.stringify(kinds)})`);
  const outsideAt = await hoverOver(nodeSel(c6));
  await s.waitFor(`!!document.querySelector('.outside-popover')`, 'the outside card opens on a hover over the block', 3000);
  const outsideCard = await s.evalJs(`(() => { const c = document.querySelector('.outside-popover'); return { name: c.querySelector('.lane-card-name')?.textContent ?? null, line: c.querySelector('.lane-card-commits')?.textContent ?? null, trailer: c.dataset.trailer, bare: c.dataset.bare, kinds: [...c.querySelectorAll('.outside-card-kind')].map((k) => k.dataset.kind).join(',') }; })()`);
  expect(outsideCard.name === 'outside emerald' && outsideCard.line === '2 commits in this log nobody here made' && outsideCard.trailer === '1' && outsideCard.bare === '1' && outsideCard.kinds === 'trailer,bare', `the card counts the two kinds (${JSON.stringify(outsideCard)})`);
  await s.click(outsideAt.x, outsideAt.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(outsideGroupSel)}).dataset.popoverOpen === 'pinned'`, 'a click pins the outside card');
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
  await sleep(400);
  expect((await s.evalJs(`!!document.querySelector('.outside-popover')`)) === true, 'the pinned card stays when the mouse leaves');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.outside-popover')`, 'Escape closes the outside card');
  await s.screenshot('m68-outside-card.png');
  step('M68: the outside block opens a card counting the trailer and no-trailer commits, and the row cards say which kind');

  // M9 fixes 113 and 114: a hook from a folder outside any repo moves the
  // session there (the daemon used to wait for CwdChanged, which the
  // harness's own reset of the tool shell never sends), and the Commits
  // graph stays on the session's repository all the same, reading the
  // folder it was started in while the live cwd has no branch.
  await p1Focus();
  await postHook(shell1.id, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: seed });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const me = r.sessions.find(x => x.id === ${JSON.stringify(shell1.id)}); return me.cwd === ${JSON.stringify(seed)} && me.branch === null; })()`, 'the hook moved the session to the tree folder, no branch there', 5000);
  await sleep(600);
  const away = await s.evalJs(`({ rows: document.querySelectorAll('.commits-row[data-hash]').length, empty: document.querySelector('.commits-panel .files-empty')?.textContent ?? null, folder: document.querySelector('.commits-panel')?.dataset.folder ?? null, railRoot: document.querySelector('.files-rail')?.dataset.root ?? null })`);
  expect(away.rows > 0 && away.empty === null, `the Commits graph still shows the repository from outside it (${JSON.stringify(away)})`);
  await postHook(shell1.id, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {} });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const me = r.sessions.find(x => x.id === ${JSON.stringify(shell1.id)}); return me.cwd === ${JSON.stringify(repo)} && me.branch !== null; })()`, 'the next hook brought the session back with its branch', 5000);
  step('M9 fixes 113 and 114: any hook moves the session to its cwd, and the Commits graph keeps the repository while the cwd is outside one');

  // M9 fix 590: a bare shell spawned in a folder with no repository, cd'd
  // into a repository and back home, shows its own folder on the graph as
  // the strip does (Not a git repository with it), while the bound shell
  // above keeps its repository from a hook's folder (fix 114).
  const panes590 = await s.evalJs("document.querySelectorAll('.pane').length");
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === ${panes590 + 1}`, 'a fresh pane for the rover', 5000);
  await startSession(s, { kind: 'shell', cwd: seed });
  const rover590Pane = (await getLayout(s)).focusedPaneId;
  const rover590 = await sessionOf(s, rover590Pane);
  const meIs590 = (cond) => `(async () => { const r = await window.emerald.request('session.list', {}); const me = r.sessions.find(x => x.id === ${JSON.stringify(rover590.id)}); return !!me && (${cond}); })()`;
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.folder === ${JSON.stringify(seed)} && document.querySelector('.commits-panel')?.dataset.graph === 'none'`, 'the rover at home in the tree folder, no repository there', 10000);
  await typeInto(s, rover590.id, `cd ${JSON.stringify(repo)}`);
  await s.waitFor(meIs590('me.branch !== null'), 'the rover in the repository with its branch', 10000);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.folder === ${JSON.stringify(repo)} && document.querySelector('.commits-panel')?.dataset.graph === 'ready'`, 'the graph on the repository', 10000);
  await typeInto(s, rover590.id, `cd ${JSON.stringify(seed)}`);
  await s.waitFor(meIs590(`me.cwd === ${JSON.stringify(seed)} && me.branch === null`), 'the rover back home, no branch', 10000);
  await s.waitFor(
    `document.querySelector('.commits-panel')?.dataset.folder === ${JSON.stringify(seed)} && document.querySelector('.commits-panel')?.dataset.graph === 'none' && document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)} && document.querySelector('.commits-norepo-note')?.textContent === 'Not a git repository'`,
    'the graph back on the home folder with the strip, Not a git repository',
    10000,
  );
  await zreq(s, 'session.kill', { sessionId: rover590.id, remove: true });
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(rover590Pane)}]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  for (let i = 0; i < 50 && (await getLayout(s)).focusedPaneId !== rover590Pane; i++) await sleep(100);
  expect((await getLayout(s)).focusedPaneId === rover590Pane, 'the rover pane focused for closing');
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === ${panes590}`, 'the rover pane closed', 5000);
  await p1Focus();
  step('M9 fix 590: a shell spawned in a folder with no repository, back home from a repository, shows its own folder on the graph as the strip does, Not a git repository with it, while fix 114 keeps the repository for a bound session that steps out');

  // The strip at a narrow rail (three tabs since fix 70, every one with
  // an icon since M49, the third word Sessions since fix 83): the three
  // words at 340px and at the 260px break,
  // every tab an icon under it, the strip still fitting at 160px.
  const stripAt = async (w) => {
    await s.evalJs(`document.querySelector('.files-rail').style.width = '${w}px'`);
    await sleep(120);
    return s.evalJs(`[...document.querySelectorAll('.rail-tab')].map(t => { const label = t.querySelector('.rail-tab-label'); const icon = t.querySelector('.files-icon'); return t.dataset.tab + '=' + (getComputedStyle(label).display !== 'none' ? 'w' : '') + (getComputedStyle(icon).display !== 'none' ? 'i' : ''); }).join(',') + ' ' + (document.querySelector('.rail-tabs').scrollWidth <= document.querySelector('.rail-tabs').clientWidth ? 'fits' : 'overflows')`);
  };
  const wide = await stripAt(340);
  expect(wide === 'files=wi,timeline=wi,history=wi fits', `at 340px the three words show with their icons (${wide})`);
  const wideEdge = await stripAt(260);
  expect(wideEdge === 'files=wi,timeline=wi,history=wi fits', `and still at 260px (${wideEdge})`);
  const narrow = await stripAt(250);
  expect(narrow === 'files=i,timeline=i,history=i fits', `at 250px every tab is an icon (${narrow})`);
  const least = await stripAt(160);
  expect(least === 'files=i,timeline=i,history=i fits', `and the strip still fits at 160px (${least})`);
  await s.evalJs(`document.querySelector('.files-rail').style.width = ''`);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'files'`, 'back on Files');
  await s.screenshot('m45-rail.png');
  step('the tab strip keeps its words at 340px and 260px and drops all three to icons under 260');

  // M9 fix 248: the file tab is an editor. A file with CRLF line ends
  // and a BOM is written into the repo and opened from the rail; typing
  // lands and marks the tab and the header dirty with the disk untouched;
  // Ctrl+S writes it back with the CRLF and the BOM kept and the marks
  // go; a dirty tab's Ctrl+W asks, Keep open leaves it, Discard puts the
  // disk text back and closes; a write from outside while dirty is the
  // changed-on-disk line with Reload and Keep mine rather than a silent
  // replace; and the dialog's Save writes and closes.
  const edited = path.join(repo, 'edited.txt');
  const BOM = String.fromCharCode(0xfeff);
  const CRLF = String.fromCharCode(13, 10);
  const onDisk = () => fs.readFileSync(edited, 'utf8');
  const editorJs = `document.querySelector('.file-editor').emeraldEditor`;
  const modelText = () => s.evalJs(`${editorJs}.getModel().getValue()`);
  const viewDirty = () => s.evalJs(`({ view: document.querySelector('.file-view')?.dataset.dirty ?? null, tab: document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(edited))} + ']')?.dataset.dirty ?? null, mark: document.querySelector('.file-dirty')?.textContent ?? null, save: !!document.querySelector('.file-save') })`);
  const openEdited = async () => {
    await clickRow(s, edited);
    await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(edited)} && document.querySelector('.file-view')?.dataset.state === 'text' && !!${editorJs}.getModel()`, 'edited.txt open in a tab', 5000);
    await s.waitFor(`!!document.activeElement?.closest('.monaco-editor')`, 'the keyboard in the editor', 3000);
  };
  const typeAtEnd = async (text) => {
    await s.evalJs(`(() => { const e = ${editorJs}; const m = e.getModel(); const n = m.getLineCount(); e.setPosition({ lineNumber: n, column: m.getLineMaxColumn(n) }); })()`);
    await s.type(text);
  };
  const dialogJs = `document.querySelector('.unsaved-dialog[data-path=' + ${JSON.stringify(JSON.stringify(edited))} + ']')`;
  const choose = (choice) => s.evalJs(`${dialogJs}.querySelector('button[data-choice="${choice}"]').click()`);
  fs.writeFileSync(edited, `${BOM}one${CRLF}two${CRLF}`);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(edited))})`, 'the file listed', 5000);
  await openEdited();
  expect(!(await s.evalJs(`${editorJs}.getRawOptions().readOnly`)), 'the editor is not read-only');
  expect(JSON.stringify(await viewDirty()) === JSON.stringify({ view: null, tab: null, mark: null, save: false }), `nothing is dirty on open (${JSON.stringify(await viewDirty())})`);
  await typeAtEnd('three');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'the typing marks the view dirty', 3000);
  const dirtyRead = await viewDirty();
  expect(dirtyRead.tab === 'true' && dirtyRead.mark === '●' && dirtyRead.save, `the tab, the header's mark and the Save button say so (${JSON.stringify(dirtyRead)})`);
  expect((await modelText()) === `one${CRLF}two${CRLF}three`, `the model has the typed line (${JSON.stringify(await modelText())})`);
  expect(onDisk() === `${BOM}one${CRLF}two${CRLF}`, 'the disk is untouched until the save');
  await s.screenshot('m9-248-dirty.png');
  step('M9 fix 248: typing into a file tab lands in the editor and marks the tab and the header dirty, the disk untouched');

  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === undefined`, 'the save clears the mark', 5000);
  expect(onDisk() === `${BOM}one${CRLF}two${CRLF}three`, `Ctrl+S wrote the text with the CRLF line ends and the BOM kept (${JSON.stringify(onDisk())})`);
  expect(JSON.stringify(await viewDirty()) === JSON.stringify({ view: null, tab: null, mark: null, save: false }), `every mark gone after the save (${JSON.stringify(await viewDirty())})`);
  await sleep(700);
  expect((await modelText()) === `one${CRLF}two${CRLF}three` && (await s.evalJs(`document.querySelector('.file-view')?.dataset.dirty`)) === undefined, 'the re-read after the save leaves the model as it is and clean');
  step('Ctrl+S writes the file back with its line ends and its BOM, and the marks go');

  await typeAtEnd(' more');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'dirty again', 3000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!!${dialogJs}`, 'Ctrl+W on a dirty tab asks', 3000);
  const choices = await s.evalJs(`[...${dialogJs}.querySelectorAll('.dialog-actions button')].map(b => b.textContent).join(',')`);
  expect(choices === 'Save,Discard,Keep open', `the three choices (${choices})`);
  expect((await s.evalJs(`${dialogJs}.querySelector('.dialog-title').textContent`)) === 'Save changes to edited.txt?', 'the title names the file');
  await s.screenshot('m9-248-ask.png');
  await choose('keep');
  await s.waitFor(`!${dialogJs}`, 'Keep open closes the dialog', 3000);
  expect((await s.evalJs(`document.querySelector('.file-view')?.dataset.path`)) === edited && (await viewDirty()).view === 'true', 'the tab is still there and still dirty');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!!${dialogJs}`, 'the ask again', 3000);
  await choose('discard');
  await s.waitFor(`!${dialogJs} && !document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(edited))} + ']')`, 'Discard closes the tab', 3000);
  expect(onDisk() === `${BOM}one${CRLF}two${CRLF}three`, 'the disk keeps the saved text, not the discarded edit');
  step('a dirty tab asks before it closes: Keep open leaves it, Discard drops the edits and closes');

  await openEdited();
  expect((await modelText()) === `one${CRLF}two${CRLF}three`, 'the re-opened file is the saved text');
  await typeAtEnd(' mine');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'dirty', 3000);
  fs.writeFileSync(edited, `${BOM}one${CRLF}two${CRLF}three${CRLF}four${CRLF}`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.conflict === 'true'`, 'a write from outside under the edits is a conflict', 5000);
  const notice = await s.evalJs(`(() => { const n = document.querySelector('.file-notice[data-kind="disk"]'); return n ? n.querySelector('span').textContent + '|' + [...n.querySelectorAll('button')].map(b => b.textContent).join(',') : null; })()`);
  expect(notice === 'Changed on disk while you were editing.|Reload,Keep mine', `the header's line and its two buttons (${notice})`);
  expect((await modelText()) === `one${CRLF}two${CRLF}three mine`, 'the model keeps the edit, the disk text is not forced in');
  await s.screenshot('m9-248-conflict.png');
  await s.evalJs(`document.querySelector('.file-notice[data-kind="disk"] button[title^="Keep"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.conflict === undefined`, 'Keep mine clears the line', 3000);
  expect((await viewDirty()).view === 'true' && (await modelText()) === `one${CRLF}two${CRLF}three mine`, 'the edits stand after Keep mine');
  fs.writeFileSync(edited, `${BOM}one${CRLF}two${CRLF}three${CRLF}five${CRLF}`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.conflict === 'true'`, 'a second write from outside is a conflict again', 5000);
  await s.evalJs(`document.querySelector('.file-notice[data-kind="disk"] button[title^="Take"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.conflict === undefined && document.querySelector('.file-view')?.dataset.dirty === undefined`, 'Reload clears the line and the mark', 3000);
  expect((await modelText()) === `one${CRLF}two${CRLF}three${CRLF}five${CRLF}`, `Reload put the disk text in (${JSON.stringify(await modelText())})`);
  step('a write from outside under unsaved edits shows the changed-on-disk line: Keep mine keeps the edits, Reload takes the disk');

  await typeAtEnd('six');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'dirty', 3000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!!${dialogJs}`, 'the ask', 3000);
  await choose('save');
  await s.waitFor(`!${dialogJs} && !document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(edited))} + ']')`, 'Save writes and closes the tab', 5000);
  expect(onDisk() === `${BOM}one${CRLF}two${CRLF}three${CRLF}five${CRLF}six`, `the dialog's Save wrote the edit (${JSON.stringify(onDisk())})`);
  step("the dialog's Save writes the file and closes the tab");

  // M9 fix 525: a save carries the stamp of the disk the editor last
  // agreed with, so a Ctrl+S that lands before the watcher's re-read of an
  // outside write writes nothing and raises the changed-on-disk line;
  // Keep mine then saves over it once. Whichever of the re-read and the
  // save lands first, the disk keeps the outside text.
  await openEdited();
  await typeAtEnd(' mine');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'dirty', 3000);
  fs.writeFileSync(edited, `${BOM}one${CRLF}two${CRLF}theirs${CRLF}`);
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.conflict === 'true'`, 'the save under a change on disk raises the changed-on-disk line', 5000);
  expect(onDisk() === `${BOM}one${CRLF}two${CRLF}theirs${CRLF}`, `the save under a change on disk wrote nothing (${JSON.stringify(onDisk())})`);
  await s.evalJs(`document.querySelector('.file-notice[data-kind="disk"] button[title^="Keep"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.conflict === undefined`, 'Keep mine clears the line', 3000);
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === undefined`, 'the save after Keep mine clears the mark', 5000);
  expect(onDisk() === `${BOM}one${CRLF}two${CRLF}three${CRLF}five${CRLF}six mine`, `Keep mine then Ctrl+S wins once (${JSON.stringify(onDisk())})`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(edited))} + ']')`, 'Ctrl+W closes the clean tab', 3000);
  step('M9 fix 525: a save under a change on disk writes nothing and shows the changed-on-disk line; Keep mine then saves over it once');

  // M9 fix 270: the file body's right-click menu. In the editor a
  // right-click inside a selection lists Copy enabled, Select all, Wrap
  // long lines (M9 fix 338, the editor's alone), Paste, then Copy path,
  // Reveal in Explorer and Open with Windows; Copy puts
  // the selection on the system clipboard, read back through the app's
  // own main-process read (the clipboard is the box's, so what was there
  // is put back at the end); a right-click outside the selection moves
  // the cursor there and lists Copy disabled; Paste lands the clipboard's
  // text at the cursor. The rendered view of a markdown file reads the
  // DOM selection and offers no Paste. The pane menu stays closed
  // throughout, since the body's menu takes the event.
  const clipboardBefore = await s.evalJs(`window.emerald.clipboard.read().then(r => r.text)`);
  const menuJs = `document.querySelector('.file-menu')`;
  // The items are read up to the Colour scheme heading (M9 fix 340 puts
  // the scheme section last, and the list past the shipped six is the
  // box's Windows Terminal settings); the section is read on its own.
  const menuRead = () => s.evalJs(`(() => { const m = ${menuJs}; if (!m) return null; const all = [...m.querySelectorAll('.menu-item')].map(b => b.querySelector('.menu-label').textContent + (b.disabled ? '!' : '') + (b.querySelector('.menu-hint') ? ' ' + b.querySelector('.menu-hint').textContent : '')); const at = all.indexOf('Colour scheme'); return { where: m.dataset.where, view: m.dataset.view, items: (at < 0 ? all : all.slice(0, at)).join(','), schemes: at < 0 ? null : all.slice(at).join(','), paneMenu: !!document.querySelector('.pane-menu'), monacoMenu: !!document.querySelector('.monaco-menu') }; })()`);
  const pick = (label) => s.evalJs(`[...${menuJs}.querySelectorAll('.menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
  const editorPoint = (line, column) => s.evalJs(`(() => { const e = ${editorJs}; const p = e.getScrolledVisiblePosition({ lineNumber: ${line}, column: ${column} }); const r = e.getDomNode().getBoundingClientRect(); return { x: r.x + p.left + 2, y: r.y + p.top + p.height / 2 }; })()`);
  await openEdited();
  await s.evalJs(`${editorJs}.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 })`);
  const inSelection = await editorPoint(1, 2);
  await s.rightClick(inSelection.x, inSelection.y);
  await s.waitFor(`!!${menuJs}`, 'the file menu on a right-click in the editor', 3000);
  const editorMenu = await menuRead();
  expect(editorMenu.where === 'editor' && editorMenu.view === 'raw' && !editorMenu.paneMenu, `the menu is the editor's, and the pane menu stayed shut (${JSON.stringify(editorMenu)})`);
  // M9 fix 359: the JSON worker's contributions brought Monaco's own
  // context menu in; contextmenu: false keeps it from showing under
  // emerald's, on the right-click and once emerald's own closes.
  expect(!editorMenu.monacoMenu, "no Monaco context menu under emerald's on the right-click");
  expect(editorMenu.items === 'Copy Ctrl+C,Select all Ctrl+A,Find Ctrl+F,✓Wrap long lines Alt+Z,Paste Ctrl+V,Copy path,Reveal in Explorer,Reveal in Files,Open with Windows', `the editor's items with their hints, Copy enabled, the wrap checked (${editorMenu.items})`);
  expect(editorMenu.schemes !== null && editorMenu.schemes.startsWith('Colour scheme,emerald,emerald gem,Dracula,One Dark,Solarized Dark,Tokyo Night'), `the scheme section closes the menu with the shipped six, none checked (${editorMenu.schemes})`);
  expect((await s.evalJs(`${menuJs}.querySelector('.menu-sep .menu-label').textContent`)) === 'Copy path', 'the rule sits above Copy path');
  await s.screenshot('m9-270-editor-menu.png');
  await pick('Copy');
  await s.waitFor(`!${menuJs}`, 'Copy closes the menu', 2000);
  expect(!(await s.evalJs(`!!document.querySelector('.monaco-menu')`)), "Monaco's own context menu does not show once emerald's closes (M9 fix 359)");
  await s.waitFor(`window.emerald.clipboard.read().then(r => r.text === 'one')`, 'the selection is on the clipboard', 3000);
  expect((await s.evalJs(`(() => { const sel = ${editorJs}.getSelection(); return sel.startLineNumber + ':' + sel.startColumn + '-' + sel.endLineNumber + ':' + sel.endColumn; })()`)) === '1:1-1:4', 'the selection stands after the copy');
  step("M9 fix 270: a right-click in the editor's selection lists Copy, Select all, Paste and the three ways out, and Copy puts the selection on the clipboard");

  // Outside the selection: the cursor moves there, nothing is selected.
  const outside = await editorPoint(2, 2);
  await s.rightClick(outside.x, outside.y);
  await s.waitFor(`!!${menuJs}`, 'the menu on a right-click outside the selection', 3000);
  const outsideMenu = await menuRead();
  expect(outsideMenu.items.startsWith('Copy! Ctrl+C,'), `Copy is disabled with nothing selected (${outsideMenu.items})`);
  expect((await s.evalJs(`${menuJs}.querySelector('.menu-item').title`)) === 'Nothing selected', 'and says why');
  const moved = await s.evalJs(`(() => { const p = ${editorJs}.getPosition(); const sel = ${editorJs}.getSelection(); return { line: p.lineNumber, column: p.column, empty: sel.isEmpty() }; })()`);
  expect(moved.line === 2 && moved.column === 2 && moved.empty, `the cursor moved under the pointer (${JSON.stringify(moved)})`);
  // Paste at that cursor: the clipboard is written through the app's
  // own write, the way the pane's paste step puts text there.
  await s.evalJs(`window.emerald.clipboard.write('PASTED')`);
  await pick('Paste');
  await s.waitFor(`${editorJs}.getModel().getLineContent(2) === 'tPASTEDwo'`, 'Paste lands the clipboard at the cursor', 3000);
  expect((await s.evalJs(`document.activeElement?.closest('.monaco-editor') !== null`)), 'the keyboard is back in the editor');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'the paste marks the view dirty', 3000);
  // Select all, then the tab closed without the edit.
  await s.rightClick(outside.x, outside.y);
  await s.waitFor(`!!${menuJs}`, 'the menu again', 3000);
  await pick('Select all');
  await s.waitFor(`(() => { const e = ${editorJs}; const sel = e.getSelection(); const m = e.getModel(); return sel.startLineNumber === 1 && sel.startColumn === 1 && sel.endLineNumber === m.getLineCount() && sel.endColumn === m.getLineMaxColumn(m.getLineCount()); })()`, 'Select all takes the whole model', 2000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!!${dialogJs}`, 'the ask', 3000);
  await choose('discard');
  await s.waitFor(`!${dialogJs} && !document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(edited))} + ']')`, 'Discard closes the tab', 3000);
  step('a right-click outside the selection moves the cursor there with Copy disabled, Paste lands the clipboard at the cursor, and Select all takes the whole file');

  // The rendered view: a markdown file in the repo opens rendered; a DOM
  // selection over its paragraph is what Copy takes, and Paste is not
  // offered.
  const notes = path.join(repo, 'notes.md');
  fs.writeFileSync(notes, '# Notes\n\nHello from the rendered view\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(notes))})`, 'notes.md listed', 5000);
  await clickRow(s, notes);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(notes)} && document.querySelector('.file-view')?.dataset.view === 'rendered' && !!document.querySelector('.markdown p')`, 'notes.md open rendered', 5000);
  const paraBox = await s.evalJs(`(() => { const p = document.querySelector('.markdown p'); window.getSelection().selectAllChildren(p); const r = p.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(paraBox.x, paraBox.y);
  await s.waitFor(`!!${menuJs}`, 'the file menu on the rendered view', 3000);
  const renderedMenu = await menuRead();
  expect(renderedMenu.where === 'dom' && renderedMenu.view === 'rendered' && !renderedMenu.paneMenu, `the menu reads the DOM selection (${JSON.stringify(renderedMenu)})`);
  expect(renderedMenu.items === 'Copy Ctrl+C,Select all Ctrl+A,Find Ctrl+F,Copy path,Reveal in Explorer,Reveal in Files,Open with Windows', `no Paste on the rendered view (${renderedMenu.items})`);
  await s.screenshot('m9-270-rendered-menu.png');
  await pick('Copy');
  await s.waitFor(`window.emerald.clipboard.read().then(r => r.text === 'Hello from the rendered view')`, "the paragraph's text is on the clipboard", 3000);
  await s.rightClick(paraBox.x, paraBox.y);
  await s.waitFor(`!!${menuJs}`, 'the menu again', 3000);
  await pick('Copy path');
  await s.waitFor(`window.emerald.clipboard.read().then(r => r.text === ${JSON.stringify(notes)})`, 'Copy path puts the path on the clipboard', 3000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(notes))} + ']')`, 'the tab closed', 3000);
  await s.evalJs(`window.emerald.clipboard.write(${JSON.stringify(clipboardBefore ?? '')})`);
  step("the rendered view's menu copies the DOM selection and the path, and offers no Paste");

  // M9 fix 652: Reveal in Files, after Reveal in Explorer on a file
  // tab's and a file pane's right-click and on the tab's menu, opens the
  // rail on Files with the file's folders opened, its row selected and
  // scrolled into the list, and flashed once; a file the rail cannot show
  // (deleted on disk) says `Not in the Files rail` in the corner note.
  // Eighty rows sort above the target, so the scroll is a real one. The
  // rail is hidden and its folders collapsed before each reveal, so the
  // read is the reveal's own work.
  const layout652 = await getTabs(s);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'the rail on the repo before fix 652');
  const dir652 = path.join(repo, 'reveal652');
  const deep652 = path.join(dir652, 'deep');
  const z652 = path.join(deep652, 'z652.txt');
  fs.mkdirSync(deep652, { recursive: true });
  for (let i = 0; i < 80; i++) fs.writeFileSync(path.join(deep652, `a${String(i).padStart(2, '0')}.txt`), `${i}\n`);
  fs.writeFileSync(z652, 'z652\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(dir652))})`, 'reveal652 listed', 5000);
  await clickRow(s, dir652);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(deep652))})`, 'deep listed', 5000);
  await clickRow(s, deep652);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(z652))})`, 'z652.txt listed', 5000);
  await clickRow(s, z652);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(z652)} && !!document.querySelector('.file-editor')?.emeraldEditor`, 'z652.txt open in a tab', 5000);
  const hideRail652 = async () => {
    await s.evalJs(`document.querySelector('.files-button[title="Collapse all folders"]').click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(deep652))})`, 'collapse all closes reveal652');
    await s.key('F', 'KeyF', 70, CTRL | SHIFT);
    await s.waitFor(`!!document.querySelector('.files-rail-collapsed') && !document.querySelector('.files-rail')`, 'Ctrl+Shift+F hides the rail');
  };
  const editorPoint652 = (editorSel) =>
    s.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(editorSel)}).emeraldEditor; const p = e.getScrolledVisiblePosition({ lineNumber: 1, column: 2 }); const r = e.getDomNode().getBoundingClientRect(); return { x: r.x + p.left + 2, y: r.y + p.top + p.height / 2 }; })()`);
  const revealRead652 = () =>
    s.evalJs(
      `(() => { const rail = document.querySelector('.files-rail'); const list = document.querySelector('.files-list'); const row = document.querySelector(${JSON.stringify(rowSel(z652))}); const open = (p) => document.querySelector('.files-row[data-path=' + JSON.stringify(p) + ']')?.dataset.expanded === 'true'; if (!rail || !list || !row) return { rail: !!rail, row: !!row }; const { top, bottom } = row.getBoundingClientRect(); const l = list.getBoundingClientRect(); return { rail: true, row: true, tab: rail.dataset.tab, dirs: [open(${JSON.stringify(dir652)}), open(${JSON.stringify(deep652)})], selected: row.dataset.selected === 'true', top, bottom, listTop: l.top, listBottom: l.bottom, scrolled: list.scrollTop }; })()`,
    );
  const flashRead652 = () => s.evalJs(`(() => { const row = document.querySelector(${JSON.stringify(rowSel(z652))}); return row ? { flash: row.dataset.flash !== undefined, value: row.dataset.flash ?? null, animation: getComputedStyle(row, '::after').animationName } : null; })()`);
  const expectRevealed652 = async (where) => {
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(z652))})?.dataset.selected === 'true'`, `z652.txt selected in the rail (${where})`, 5000);
    // Logged only: the flash lives a second, which a read under load can miss.
    console.log(`[verify] fix 652 flash on the revealed row (${where}): ${JSON.stringify(await flashRead652())}`);
    // The scroll lands on the render after the selection.
    await sleep(150);
    const read = await revealRead652();
    expect(read.rail && read.tab === 'files', `the rail is shown on Files (${where}, ${JSON.stringify(read)})`);
    expect(read.dirs?.[0] === true && read.dirs?.[1] === true, `reveal652 and deep are opened (${where}, ${JSON.stringify(read)})`);
    expect(read.selected, `z652.txt's row is selected (${where})`);
    expect(read.top >= read.listTop - 0.5 && read.bottom <= read.listBottom + 0.5, `z652.txt's row is inside the list, scrolled to (${where}, ${JSON.stringify(read)})`);
  };

  // The tab: a right-click in its editor.
  await hideRail652();
  const tabPoint652 = await editorPoint652('.file-editor');
  await s.rightClick(tabPoint652.x, tabPoint652.y);
  await s.waitFor(`!!${menuJs}`, 'the file menu in the tab', 3000);
  await pick('Reveal in Files');
  await s.waitFor(`!${menuJs}`, 'Reveal in Files closes the menu', 2000);
  await expectRevealed652('a file tab');
  await s.screenshot('m9-652-reveal-tab.png');
  step('M9 fix 652: Reveal in Files on a file tab opens the rail on Files with the folders opened and the row selected, scrolled into the list');

  // M9 fix 684: a second Reveal in Files on a row still flashing flashes it
  // again; the attribute alternates between 'a' and 'b' so the animation
  // name changes and the animation restarts.
  const v684 = (await flashRead652())?.value ?? null;
  await sleep(300);
  await s.rightClick(tabPoint652.x, tabPoint652.y);
  await s.waitFor(`!!${menuJs}`, 'the file menu in the tab (second reveal)', 3000);
  await pick('Reveal in Files');
  await s.waitFor(`!${menuJs}`, 'the second Reveal in Files closes the menu', 2000);
  await s.waitFor(`(() => { const v = document.querySelector(${JSON.stringify(rowSel(z652))})?.dataset.flash; return (v === 'a' || v === 'b') && v !== ${JSON.stringify(v684)}; })()`, "the second reveal flips the row's flash attribute", 2000);
  console.log(`[verify] fix 684 flash after the second reveal: ${JSON.stringify(await flashRead652())} (first ${v684})`);
  step('M9 fix 684: a second Reveal in Files on a row still flashing flashes it again');

  // The pane: the tab closed, the file opened in a pane from its row.
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(z652))} + ']')`, 'the z652 tab closed', 3000);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(z652))})`, 'z652.txt still listed', 3000);
  await s.evalJs(
    `(() => { const r = document.querySelector(${JSON.stringify(rowSel(z652))}); const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 })); })()`,
  );
  await s.waitFor(`!!document.querySelector('.files-menu')`, 'the row menu');
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Open in a pane').click()`);
  const pane652 = `.pane[data-view="file"][data-path=${JSON.stringify(z652)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(`${pane652} .file-editor`)})?.emeraldEditor`, 'z652.txt open in a pane', 5000);
  await hideRail652();
  const panePoint652 = await editorPoint652(`${pane652} .file-editor`);
  await s.rightClick(panePoint652.x, panePoint652.y);
  await s.waitFor(`!!${menuJs}`, 'the file menu in the pane', 3000);
  await pick('Reveal in Files');
  await s.waitFor(`!${menuJs}`, 'Reveal in Files closes the menu', 2000);
  await expectRevealed652('a file pane');
  step('M9 fix 652: Reveal in Files on a file pane does the same');
  // The layout read at the step's start put back, so the file pane goes
  // before the next file opens: with it up a row's click opened into the
  // pane rather than a tab, and the first .file-view was the pane's.
  await zreq(s, 'layout.set', { layout: { ...layout652, revision: (await getTabs(s)).revision } });
  await s.waitFor(`!document.querySelector('.pane[data-view="file"]')`, 'the file pane gone with the restored layout', 5000);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'the rail back on the repo after the pane', 5000);

  // The tab menu's Reveal in Files on a file tab of the given path.
  const revealFromTab = async (file) => {
    const tabSel = `.tab-file[data-tab=${JSON.stringify(file)}]`;
    await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(file)} && !!document.querySelector(${JSON.stringify(tabSel)})`, `${path.basename(file)} open in a tab`, 5000);
    const box = await s.evalJs(`(() => { const { x, y, width, height } = document.querySelector(${JSON.stringify(tabSel)}).getBoundingClientRect(); return { x: x + width / 2, y: y + height / 2 }; })()`);
    await s.rightClick(box.x, box.y);
    await s.waitFor(`document.querySelector('.tab-menu')?.dataset.path === ${JSON.stringify(file)}`, 'the tab menu', 3000);
    await s.evalJs(`[...document.querySelectorAll('.tab-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Reveal in Files').click()`);
  };
  const tabGone = (file) => `!document.querySelector('.tab-file[data-tab=' + JSON.stringify(${JSON.stringify(file)}) + ']')`;
  const noteRead = async () => (await s.evalJs(`document.querySelector('.corner-note')?.textContent ?? ''`)) ?? '';

  // M9 fix 683: deep was listed, closed, and a file made while it was
  // closed; the reveal lists it again before it says Not in the Files rail.
  await hideRail652();
  await sleep(300);
  const new683 = path.join(deep652, 'new683.txt');
  fs.writeFileSync(new683, 'new683\n');
  await sleep(300);
  expect(cliOpen(new683).code === 0, 'emmer open opens new683.txt');
  await revealFromTab(new683);
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(new683))})?.dataset.selected === 'true'`, 'new683.txt selected in the rail', 5000);
  expect(!/Not in the Files rail/.test(await noteRead()), 'no Not in the Files rail note for new683.txt');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(tabGone(new683), 'the new683 tab closed', 3000);
  step('M9 fix 683: Reveal in Files lists a collapsed folder again and shows a file made while it was closed');

  // M9 fix 685: a tab opened in another case opens the folders in the
  // disk's case.
  await hideRail652();
  const upper685 = path.join(repo, 'REVEAL652', 'DEEP', 'z652.txt');
  expect(cliOpen(upper685).code === 0, 'emmer open opens the upper-case path');
  await revealFromTab(upper685);
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(z652))})?.dataset.selected === 'true'`, 'z652.txt selected in the rail through the upper-case tab', 5000);
  expect(!/Not in the Files rail/.test(await noteRead()), 'no Not in the Files rail note for the upper-case tab');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(tabGone(upper685), 'the upper-case tab closed', 3000);
  step("M9 fix 685: Reveal in Files on a tab opened in another case opens the folders in the disk's case");

  // The tab menu on a file deleted on disk: the rail cannot show it.
  const gone652 = path.join(repo, 'gone652.txt');
  fs.writeFileSync(gone652, 'gone\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(gone652))})`, 'gone652.txt listed', 5000);
  await clickRow(s, gone652);
  const goneTab652 = `.tab-file[data-tab=${JSON.stringify(gone652)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(goneTab652)}) && document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(gone652)}`, 'gone652.txt open in a tab', 5000);
  fs.rmSync(gone652);
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(gone652))})`, 'gone652.txt leaves the tree', 5000);
  const goneBox652 = await s.evalJs(`(() => { const { x, y, width, height } = document.querySelector(${JSON.stringify(goneTab652)}).getBoundingClientRect(); return { x: x + width / 2, y: y + height / 2 }; })()`);
  await s.rightClick(goneBox652.x, goneBox652.y);
  await s.waitFor(`document.querySelector('.tab-menu')?.dataset.path === ${JSON.stringify(gone652)}`, 'the tab menu on gone652.txt', 3000);
  await s.evalJs(`[...document.querySelectorAll('.tab-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Reveal in Files').click()`);
  await s.waitFor(`document.querySelector('.corner-note')?.textContent === 'Not in the Files rail'`, 'the corner note says the rail cannot show it', 3000);
  step('M9 fix 652: Reveal in Files from the tab menu on a file deleted on disk says Not in the Files rail');

  // Back as the step found it: the tab closed, reveal652 removed, the
  // rail on the repo (the layout was put back above).
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector(${JSON.stringify(goneTab652)})`, 'the gone652 tab closed', 3000);
  fs.rmSync(dir652, { recursive: true, force: true });
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)} && !document.querySelector(${JSON.stringify(rowSel(dir652))})`, 'the rail back on the repo without reveal652', 5000);

  // M9 fix 619: Ctrl+F in a rendered markdown opens a find bar of the
  // view's own (no Monaco there), marks every hit with the CSS highlight
  // registry, steps and wraps with Enter, scrolls the current hit into
  // the view, and Escape hands the keyboard back; in Raw the same key is
  // Monaco's find, which no step read before. notes.md holds no word
  // twice, so the step writes a file of its own, its second hit eighty
  // paragraphs down.
  const findMd = path.join(repo, 'find.md');
  fs.writeFileSync(findMd, '# Find\n\nThe first needle is here.\n\n' + Array.from({ length: 80 }, (_, i) => `Line ${i + 1}.`).join('\n\n') + '\n\nThe last needle is at the end.\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(findMd))})`, 'find.md listed', 5000);
  await clickRow(s, findMd);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(findMd)} && document.querySelector('.file-view')?.dataset.view === 'rendered' && document.activeElement?.classList.contains('markdown-view') === true`, 'find.md open rendered with the keyboard', 5000);
  const findCountJs = `document.querySelector('.view-find-bar .find-count')?.textContent`;
  await s.key('f', 'KeyF', 70, CTRL);
  await s.waitFor(`!!document.activeElement?.closest('.view-find-bar') && document.activeElement?.classList.contains('find-input') === true`, 'Ctrl+F opens the view find bar with the keyboard in its box', 3000);
  await s.type('needle');
  await s.waitFor(`${findCountJs} === '1 of 2'`, 'the count reads 1 of 2', 3000);
  expect(await s.evalJs(`CSS.highlights.get('emerald-find')?.size === 2`), 'both hits are highlighted');
  // A check on the fixture, not the fix: the second hit starts out below
  // the view, so the step after it proves the scroll.
  expect(await s.evalJs(`[...CSS.highlights.get('emerald-find')][1].getBoundingClientRect().top > document.querySelector('.markdown-view').getBoundingClientRect().bottom`), 'the second hit starts below the view');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`${findCountJs} === '2 of 2'`, 'Enter steps to 2 of 2', 3000);
  await s.waitFor(
    `(() => { const { top, bottom } = [...CSS.highlights.get('emerald-find-current')][0].getBoundingClientRect(); const v = document.querySelector('.markdown-view').getBoundingClientRect(); return top >= v.top && bottom <= v.bottom; })()`,
    'the current hit is scrolled into the view',
    3000,
  );
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`${findCountJs} === '1 of 2'`, 'Enter past the last wraps to 1 of 2', 3000);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.view-find-bar') && !CSS.highlights.has('emerald-find') && document.activeElement?.classList.contains('markdown-view') === true`, 'Escape closes the bar, takes the marks and hands the keyboard back to the view', 3000);
  // Raw: the same key is Monaco's own find.
  await s.evalJs(`document.querySelector('.file-view-switch [data-view=raw]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'raw' && !!${editorJs}.getModel()`, 'find.md in Raw', 3000);
  await s.evalJs(`${editorJs}.focus()`);
  await s.key('f', 'KeyF', 70, CTRL);
  await s.waitFor(`!!document.querySelector('.monaco-editor .find-widget.visible')`, "Ctrl+F in Raw opens Monaco's find widget", 3000);
  expect(!(await s.evalJs(`!!document.querySelector('.view-find-bar')`)), 'and no view find bar under it');
  await s.key('Escape', 'Escape', 27);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(findMd))} + ']')`, 'the tab closed', 3000);
  step("M9 fix 619: Ctrl+F in a rendered markdown finds a word twice with its count, steps and wraps with Enter, scrolls the hit into view and closes on Escape, and opens Monaco's find in Raw");

  // M9 fix 635: the rendered find matches across the inline tags of one
  // block (a word half in bold, across a link's edge, half in italic, half
  // in code) as one hit each, while two paragraphs never join.
  const runsMd = path.join(repo, 'find-runs.md');
  fs.writeFileSync(runsMd, '# Runs\n\nA nee**dle** half in bold.\n\nA word [link](https://example.com/emerald)ed across a link\'s edge.\n\nSome *ital*ic text and `co`de text.\n\nnee\n\ndle\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(runsMd))})`, 'find-runs.md listed', 5000);
  await clickRow(s, runsMd);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(runsMd)} && document.querySelector('.file-view')?.dataset.view === 'rendered' && document.activeElement?.classList.contains('markdown-view') === true`, 'find-runs.md open rendered with the keyboard', 5000);
  await s.key('f', 'KeyF', 70, CTRL);
  await s.waitFor(`!!document.activeElement?.closest('.view-find-bar') && document.activeElement?.classList.contains('find-input') === true`, 'Ctrl+F opens the view find bar', 3000);
  for (const [q, name] of [
    ['needle', 'needle, half in bold, is one hit'],
    ['linked', "linked, across a link's edge, is one hit"],
    ['italic', 'italic, half in italic, is one hit'],
    ['code', 'code, half in code, is one hit'],
  ]) {
    await setInput(s, '.view-find-bar .find-input', q);
    await s.waitFor(`document.querySelector('.view-find-bar .find-count')?.textContent === '1 of 1'`, name, 3000);
    if (q === 'needle') {
      expect(await s.evalJs(`(() => { const r = [...CSS.highlights.get('emerald-find')][0]; return r.startContainer !== r.endContainer; })()`), 'the needle hit spans two text nodes');
    }
  }
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.view-find-bar')`, 'the bar closed', 3000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(runsMd))} + ']')`, 'the tab closed', 3000);
  step("M9 fix 635: the rendered find finds a word half in bold, one across a link's edge, one half in italic and one half in code, one hit each, and two paragraphs never join");

  // M9 fix 298: Monaco's folding contribution is registered for the file
  // tab (monaco.ts), so the gutter shows a chevron on hover and a click
  // folds the block; JSON folds by indentation, since foldingRanges stays
  // off. A nested object over four lines (the braces on lines 2 and 5)
  // is folded from its opening line's gutter, holds across a tab switch
  // (saveViewState, fix 248), and unfolds under Ctrl+Shift+].
  const foldedFile = path.join(repo, 'hello.json');
  fs.writeFileSync(foldedFile, ['{', '  "a": {', '    "b": 1,', '    "c": 2', '  }', '}', ''].join('\n'));
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(foldedFile))})`, 'hello.json listed', 5000);
  await clickRow(s, foldedFile);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(foldedFile)} && document.querySelector('.file-view')?.dataset.state === 'text' && !!${editorJs}.getModel()`, 'hello.json open in a tab', 5000);
  // The folding model computes its ranges off a debounced timer, not on
  // the model's creation, so the gutter's icons land a beat after the
  // read above.
  await s.waitFor(`document.querySelectorAll('.margin-view-overlays .codicon-folding-expanded, .margin-view-overlays .codicon-folding-collapsed').length >= 2`, 'the folding ranges are computed', 5000);
  const NESTED_LINE = 2;
  const gutterPoint = await s.evalJs(
    `(() => { const e = ${editorJs}; const p = e.getScrolledVisiblePosition({ lineNumber: ${NESTED_LINE}, column: 1 }); const info = e.getLayoutInfo(); const r = e.getDomNode().getBoundingClientRect(); return { x: r.x + info.decorationsLeft + info.decorationsWidth / 2, y: r.y + p.top + p.height / 2 }; })()`,
  );
  const iconAtGutter = () =>
    s.evalJs(
      `(() => { const els = [...document.querySelectorAll('.margin-view-overlays .codicon-folding-expanded, .margin-view-overlays .codicon-folding-collapsed')]; const el = els.find((c) => { const r = c.getBoundingClientRect(); return Math.abs(r.y + r.height / 2 - ${gutterPoint.y}) < 6; }); if (!el) return null; return { collapsed: el.classList.contains('codicon-folding-collapsed'), opacity: getComputedStyle(el).opacity }; })()`,
    );
  const collapsedAtGutter = `[...document.querySelectorAll('.margin-view-overlays .codicon-folding-collapsed')].some((c) => { const r = c.getBoundingClientRect(); return Math.abs(r.y + r.height / 2 - ${gutterPoint.y}) < 6; })`;
  const visible = (line) => `${editorJs}.getVisibleRanges().some((r) => ${line} >= r.startLineNumber && ${line} <= r.endLineNumber)`;
  expect(await s.evalJs(visible(3)), 'line 3 is visible before the fold');
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gutterPoint.x, y: gutterPoint.y });
  // Monaco fades the chevron in over half a second (folding.css). The read
  // used to be taken at once and passed only because the rendered step's
  // right-click had left the pointer over this gutter already; a step in
  // between that moves the pointer (fix 652's) read it at opacity 0.
  {
    const until = Date.now() + 2000;
    while (Date.now() < until && !(Number((await iconAtGutter())?.opacity ?? 0) > 0.5)) await sleep(100);
  }
  const hovered = await iconAtGutter();
  expect(hovered !== null && !hovered.collapsed && Number(hovered.opacity) > 0.5, `hovering the gutter shows the open chevron (${JSON.stringify(hovered)})`);
  await s.click(gutterPoint.x, gutterPoint.y);
  await s.waitFor(collapsedAtGutter, 'the click folds the nested object', 3000);
  expect(!(await s.evalJs(visible(3))) && !(await s.evalJs(visible(4))), 'the fold hides both interior lines from getVisibleRanges()');
  await s.screenshot('m9-298-fold.png');
  await s.evalJs(`document.querySelector('.tab.tab-panes').click()`);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'a click on Panes switches away from hello.json', 3000);
  const foldedTabSel = `.tab.tab-file[data-tab=${JSON.stringify(foldedFile)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(foldedTabSel)})`, "hello.json's tab is still on the strip", 3000);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldedTabSel)}).click()`);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(foldedFile)} && !!${editorJs}.getModel()`, 'back on hello.json', 3000);
  await s.waitFor(`!(${visible(3)})`, 'the restored fold hides line 3 again', 3000);
  expect(!(await s.evalJs(visible(4))), 'the fold survives the tab switch, line 4 with it');
  await s.evalJs(`${editorJs}.setPosition({ lineNumber: ${NESTED_LINE}, column: 1 }); ${editorJs}.focus();`);
  await s.key(']', 'BracketRight', 221, CTRL | SHIFT);
  await s.waitFor(visible(3), 'Ctrl+Shift+] on the cursor unfolds the block', 3000);
  expect(await s.evalJs(visible(4)), 'and line 4 with it');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  step('M9 fix 298: the gutter chevron folds a nested object on click, the fold survives a tab switch, and Ctrl+Shift+] unfolds it');

  // M9 fix 272: a plain markdown file's ## and ### headings are folding
  // sections, every one open on a file that is not the release notes.
  const sectioned = path.join(repo, 'sections.md');
  fs.writeFileSync(sectioned, ['# Title', '', 'Lead.', '', '## One', '', 'Under one.', '', '### One a', '', 'Under one a.', '', '## Two', '', 'Under two.', ''].join('\n'));
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(sectioned))})`, 'sections.md listed', 5000);
  await clickRow(s, sectioned);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(sectioned)} && document.querySelector('.file-view')?.dataset.view === 'rendered' && document.querySelectorAll('.file-view .markdown .md-fold').length === 3`, 'sections.md open rendered with three sections', 5000);
  const sectionReads = await s.evalJs(`[...document.querySelectorAll('.file-view .markdown .md-fold')].map((f) => f.dataset.level + ':' + f.dataset.key + ':' + (f.hasAttribute('data-folded') ? 'folded' : 'open') + ':' + [...f.children].slice(1).filter((c) => c.getBoundingClientRect().height > 0).length)`);
  expect(sectionReads.join('|') === '2:One:open:2|3:One / One a:open:1|2:Two:open:1', `every section open with its paragraphs shown, the ### keyed under its ## (${sectionReads.join('|')})`);
  await s.evalJs(`document.querySelector('.file-view .markdown .md-fold[data-level="3"] > h3').click()`);
  await s.waitFor(`document.querySelector('.file-view .markdown .md-fold[data-level="3"]').hasAttribute('data-folded')`, 'a click folds the ###');
  expect((await s.evalJs(`document.querySelector('.file-view .markdown .md-fold[data-level="2"]').hasAttribute('data-folded')`)) === false, 'and its ## stays open');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  step('M9 fix 272: a markdown file opens with every section unfolded and a heading click folds one');

  // M9 fix 338: the editor wraps long lines at the width by default. A
  // file of one 400-character line renders more view lines than the
  // model has; the header's Wrap button (on, data-active) turns it off
  // and the rendered count drops to the model's; a second click wraps
  // again; the setting is the window's (localStorage), so it survives
  // a reload. The view lines are the DOM's .view-line children, which
  // Monaco renders under the harness (the tabs script reads them).
  const wrapFile = path.join(repo, 'wide.txt');
  fs.writeFileSync(wrapFile, `${'x'.repeat(400)}\nshort\n`);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(wrapFile))})`, 'wide.txt listed', 5000);
  await clickRow(s, wrapFile);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(wrapFile)} && document.querySelector('.file-view')?.dataset.state === 'text' && !!${editorJs}.getModel()`, 'wide.txt open in a tab', 5000);
  const wrapRead = () => s.evalJs(`(() => { const e = ${editorJs}; const b = document.querySelector('.file-view .file-wrap'); return { option: e.getRawOptions().wordWrap, rendered: document.querySelectorAll('.file-view .view-lines .view-line').length, model: e.getModel().getLineCount(), button: b ? (b.hasAttribute('data-active') ? 'on' : 'off') : null, title: b?.title ?? null }; })()`);
  await s.waitFor(`document.querySelectorAll('.file-view .view-lines .view-line').length > ${editorJs}.getModel().getLineCount()`, 'the long line renders as more than one view line', 5000);
  const wrapOn = await wrapRead();
  expect(wrapOn.option === 'on' && wrapOn.button === 'on' && wrapOn.title === 'Wrap long lines at the width (Alt+Z)', `the wrap is on by default and the header's Wrap button says so (${JSON.stringify(wrapOn)})`);
  await s.screenshot('m9-338-wrap-on.png');
  await s.evalJs(`document.querySelector('.file-view .file-wrap').click()`);
  await s.waitFor(`document.querySelectorAll('.file-view .view-lines .view-line').length === ${editorJs}.getModel().getLineCount()`, 'a click on Wrap renders one view line per model line', 5000);
  const wrapOff = await wrapRead();
  expect(wrapOff.option === 'off' && wrapOff.button === 'off', `the wrap is off and the button reads so (${JSON.stringify(wrapOff)})`);
  await s.evalJs(`document.querySelector('.file-view .file-wrap').click()`);
  await s.waitFor(`document.querySelectorAll('.file-view .view-lines .view-line').length > ${editorJs}.getModel().getLineCount()`, 'a second click wraps again', 5000);
  expect((await wrapRead()).button === 'on', 'and the button is on again');
  // The file menu's item wears the check and flips it too.
  const wrapPoint = await s.evalJs(`(() => { const e = ${editorJs}; const p = e.getScrolledVisiblePosition({ lineNumber: 2, column: 2 }); const r = e.getDomNode().getBoundingClientRect(); return { x: r.x + p.left + 2, y: r.y + p.top + p.height / 2 }; })()`);
  await s.rightClick(wrapPoint.x, wrapPoint.y);
  await s.waitFor(`!!document.querySelector('.file-menu')`, 'the file menu', 3000);
  const wrapItem = await s.evalJs(`(() => { const b = [...document.querySelector('.file-menu').querySelectorAll('.menu-item')].find((x) => x.querySelector('.menu-label').textContent.endsWith('Wrap long lines')); return b ? { checked: b.dataset.checked, hint: b.querySelector('.menu-hint')?.textContent ?? null } : null; })()`);
  expect(wrapItem !== null && wrapItem.checked === 'true' && wrapItem.hint === 'Alt+Z', `the menu lists Wrap long lines checked with its key (${JSON.stringify(wrapItem)})`);
  await s.evalJs(`[...document.querySelector('.file-menu').querySelectorAll('.menu-item')].find((x) => x.querySelector('.menu-label').textContent.endsWith('Wrap long lines')).click()`);
  await s.waitFor(`!document.querySelector('.file-menu') && document.querySelectorAll('.file-view .view-lines .view-line').length === ${editorJs}.getModel().getLineCount()`, 'the item turns the wrap off', 5000);
  // Off survives a reload, since the setting is the window's.
  await s.send('Page.reload');
  await sleep(1500);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(wrapFile)} && !!${editorJs}?.getModel() && document.querySelectorAll('.file-view .view-lines .view-line').length > 0`, 'wide.txt back after the reload', 15000);
  const wrapKept = await wrapRead();
  expect(wrapKept.option === 'off' && wrapKept.button === 'off' && wrapKept.rendered === wrapKept.model, `the wrap stays off across a reload (${JSON.stringify(wrapKept)})`);
  await s.evalJs(`document.querySelector('.file-view .file-wrap').click()`);
  await s.waitFor(`document.querySelectorAll('.file-view .view-lines .view-line').length > ${editorJs}.getModel().getLineCount()`, 'wrap back on for the steps after', 5000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  step("M9 fix 338: the editor wraps long lines by default, the header's Wrap button and the menu's checked item turn it off and on, and the setting survives a reload");

  // M9 fix 339: a .json file opens in a Pretty view, the same editor
  // read-only on a second model holding the text as the JSON worker
  // formats it (two spaces for a one-line file); Raw is the file, with
  // a Format button that formats in place as one undoable edit marking
  // the model dirty; a file the worker cannot parse shows the Raw
  // editor under a notice naming the error and its line; a file with
  // its own indent formats in it.
  const prettyFile = path.join(repo, 'pretty.json');
  fs.writeFileSync(prettyFile, '{"a":1,"b":[1,2]}');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(prettyFile))})`, 'pretty.json listed', 5000);
  await clickRow(s, prettyFile);
  // The text is read with LF line ends (getValue(1) is
  // EndOfLinePreference.LF), since a one-line file's model starts on
  // the platform's CRLF and the formatted text follows it.
  const prettyRead = () => s.evalJs(`(() => { const v = document.querySelector('.file-view'); const e = ${editorJs}; const m = e?.getModel() ?? null; return { path: v?.dataset.path ?? null, view: v?.dataset.view ?? null, pretty: v?.dataset.pretty ?? null, dirty: v?.dataset.dirty ?? null, lines: m ? m.getLineCount() : null, scheme: m ? m.uri.scheme : null, readOnly: e ? e.getRawOptions().readOnly : null, text: m ? m.getValue(1) : null, tabSize: m ? m.getOptions().tabSize : null, format: !!v?.querySelector('.file-format'), switch: [...(v?.querySelectorAll('.file-view-switch button') ?? [])].map((b) => b.textContent.trim()).join(','), notice: v?.querySelector('.file-notice[data-kind="json"]')?.textContent ?? null }; })()`);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.path === ${JSON.stringify(prettyFile)} && v?.dataset.view === 'pretty' && v?.dataset.pretty === 'ok' && !!m && m.getLineCount() > 1; })()`, 'pretty.json open on its Pretty view, formatted', 15000);
  const prettyOpen = await prettyRead();
  expect(prettyOpen.readOnly === true && prettyOpen.scheme === 'emerald-pretty' && prettyOpen.switch === 'Pretty,Raw' && !prettyOpen.format, `the Pretty view is read-only on the derived model, the switch reads Pretty | Raw and no Format button (${JSON.stringify(prettyOpen)})`);
  expect(prettyOpen.text.split('\n')[1] === '  "a": 1,' && prettyOpen.tabSize === 2, `a one-line file formats two-space (${JSON.stringify(prettyOpen.text)})`);
  await s.screenshot('m9-339-pretty.png');
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="raw"]').click()`);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.view === 'raw' && !!m && m.uri.scheme === 'file' && m.getLineCount() === 1; })()`, 'Raw is the file, one line', 5000);
  const rawOpen = await prettyRead();
  expect(rawOpen.readOnly === false && rawOpen.format && rawOpen.pretty === null, `the Raw editor takes edits and has the Format button (${JSON.stringify(rawOpen)})`);
  await s.evalJs(`document.querySelector('.file-view .file-format').click()`);
  await s.waitFor(`${editorJs}.getModel().getLineCount() > 1 && document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'Format formats the file in place and marks it dirty', 5000);
  const formatted = await prettyRead();
  expect(formatted.text === prettyOpen.text, `the Format button and the Pretty view agree to the character (${JSON.stringify(formatted.text)})`);
  expect(fs.readFileSync(prettyFile, 'utf8') === '{"a":1,"b":[1,2]}', 'the disk is untouched until a save');
  await s.evalJs(`${editorJs}.trigger('verify', 'undo', null)`);
  await s.waitFor(`${editorJs}.getModel().getLineCount() === 1 && document.querySelector('.file-view')?.dataset.dirty === undefined`, 'one undo puts the one line back, clean', 5000);
  // The Pretty view follows a Raw edit: a key added in Raw shows
  // formatted on the switch back, and the Raw edit still stands.
  await s.evalJs(`(() => { const e = ${editorJs}; const m = e.getModel(); e.executeEdits('verify', [{ range: m.getFullModelRange(), text: '{"a":1,"c":true}' }]); })()`);
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="pretty"]').click()`);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.view === 'pretty' && !!m && m.uri.scheme === 'emerald-pretty' && m.getValue().includes('"c": true'); })()`, 'the Pretty view shows the Raw edit formatted', 5000);
  expect((await prettyRead()).dirty === 'true', 'the file stays dirty under the Pretty view');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!!document.querySelector('.unsaved-dialog')`, 'the close asks about the edit', 3000);
  await s.evalJs(`document.querySelector('.unsaved-dialog button[data-choice="discard"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Discard closes the tab');
  // A file that does not parse: the Raw editor under the notice.
  const badFile = path.join(repo, 'bad.json');
  fs.writeFileSync(badFile, '{\n  "a": 1,\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(badFile))})`, 'bad.json listed', 5000);
  await clickRow(s, badFile);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.path === ${JSON.stringify(badFile)} && v?.dataset.view === 'pretty' && v?.dataset.pretty === 'invalid' && !!m && m.uri.scheme === 'file'; })()`, 'bad.json shows the Raw editor under its Pretty view', 15000);
  const badOpen = await prettyRead();
  expect(badOpen.notice !== null && badOpen.notice === 'Not valid JSON: Property expected at line 2' && badOpen.readOnly === false, `the notice names the error and its line, and the editor takes edits (${JSON.stringify(badOpen)})`);
  await s.screenshot('m9-339-invalid.png');
  // Mending the file in place turns the Pretty view on by itself.
  await s.evalJs(`(() => { const e = ${editorJs}; const m = e.getModel(); e.executeEdits('verify', [{ range: m.getFullModelRange(), text: '{"a":1}' }]); })()`);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.pretty === 'ok' && !!m && m.uri.scheme === 'emerald-pretty' && !v.querySelector('.file-notice[data-kind="json"]'); })()`, 'a mended file goes Pretty and the notice goes', 5000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!!document.querySelector('.unsaved-dialog')`, 'the close asks', 3000);
  await s.evalJs(`document.querySelector('.unsaved-dialog button[data-choice="discard"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Discard closes the tab');
  // A file with its own indent formats in it.
  const indentFile = path.join(repo, 'indent.json');
  fs.writeFileSync(indentFile, '{\n    "a": {"b": 1}\n}\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(indentFile))})`, 'indent.json listed', 5000);
  await clickRow(s, indentFile);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.path === ${JSON.stringify(indentFile)} && v?.dataset.pretty === 'ok' && !!m && m.uri.scheme === 'emerald-pretty'; })()`, 'indent.json open Pretty', 15000);
  const indentOpen = await prettyRead();
  expect(indentOpen.tabSize === 4 && indentOpen.text.includes('\n        "b": 1'), `a four-space file formats four-space (${JSON.stringify(indentOpen.text)})`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  step('M9 fix 339: a .json file opens in a read-only Pretty view formatted in its own indent, Raw has a Format button that formats in place as one undo step, a Raw edit shows in Pretty, and a file that does not parse shows the Raw editor under a notice');

  // M9 fix 420: Format JSON selection, the file menu's item beside
  // Format JSON, runs the range formatter over the selection alone. A
  // one-line file with two members selects the second and formats just
  // it; the first member and the braces around it are untouched, and one
  // undo puts the line back exactly. With nothing selected the item is
  // disabled, as Copy is.
  const selectFile = path.join(repo, 'select.json');
  const selectOriginal = '{"a":1,"b":2}';
  fs.writeFileSync(selectFile, selectOriginal);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(selectFile))})`, 'select.json listed', 5000);
  await clickRow(s, selectFile);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); return v?.dataset.path === ${JSON.stringify(selectFile)} && v?.dataset.view === 'pretty'; })()`, 'select.json open on its Pretty view', 15000);
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="raw"]').click()`);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.view === 'raw' && !!m && m.uri.scheme === 'file' && m.getLineCount() === 1; })()`, 'Raw is the one-line file', 5000);
  // "b":2 is columns 8 to 12 of {"a":1,"b":2}.
  await s.evalJs(`${editorJs}.setSelection({ startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 13 })`);
  const midSelectionPoint = await editorPoint(1, 10);
  await s.rightClick(midSelectionPoint.x, midSelectionPoint.y);
  await s.waitFor(`!!${menuJs}`, 'the file menu on a right-click in the selection', 3000);
  const selectionMenu = await menuRead();
  const selectionItems = selectionMenu.items.split(',');
  expect(
    selectionItems.some((i) => i === 'Format JSON selection'),
    `Format JSON selection sits after Format JSON, enabled with a selection (${selectionMenu.items})`,
  );
  await pick('Format JSON selection');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'Format JSON selection marks the file dirty', 5000);
  const selectFormatted = await s.evalJs(`${editorJs}.getModel().getValue(1)`);
  expect(
    selectFormatted !== selectOriginal && selectFormatted.startsWith('{"a":1,') && selectFormatted.endsWith('}'),
    `the selection formatted, the rest of the line untouched (${JSON.stringify(selectFormatted)})`,
  );
  await s.evalJs(`${editorJs}.trigger('verify', 'undo', null)`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === undefined`, 'one undo puts the line back, clean', 5000);
  expect((await s.evalJs(`${editorJs}.getModel().getValue(1)`)) === selectOriginal, 'the undo is exact, one step');
  // Nothing selected: the item is disabled, Copy's shape.
  await s.evalJs(`${editorJs}.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 })`);
  const noSelectionPoint = await editorPoint(1, 1);
  await s.rightClick(noSelectionPoint.x, noSelectionPoint.y);
  await s.waitFor(`!!${menuJs}`, 'the file menu with nothing selected', 3000);
  const noSelectionMenu = await menuRead();
  expect(noSelectionMenu.items.split(',').some((i) => i === 'Format JSON selection!'), `Format JSON selection is disabled with nothing selected (${noSelectionMenu.items})`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!${menuJs}`, 'the menu closes');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  step('M9 fix 420: Format JSON selection formats the selection alone, leaves the rest of the line untouched, undoes in one step, and is disabled with nothing selected');

  // M9 fix 358: the reformat is live only while a Pretty tab is on
  // screen. A Raw edit while nobody is on Pretty must not pay the
  // worker on every debounce, so data-pretty-runs (the verify counter)
  // stays put while idle and steps by exactly one, at once, when a view
  // goes live on the stale edit.
  const idleFile = path.join(repo, 'idle.json');
  fs.writeFileSync(idleFile, '{"a":1}');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(idleFile))})`, 'idle.json listed', 5000);
  await clickRow(s, idleFile);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.path === ${JSON.stringify(idleFile)} && v?.dataset.pretty === 'ok' && !!m && m.uri.scheme === 'emerald-pretty'; })()`, 'idle.json open Pretty', 15000);
  const idleRuns = () => s.evalJs(`Number(document.querySelector('.file-view')?.dataset.prettyRuns ?? -1)`);
  const runsOnOpen = await idleRuns();
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="raw"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'raw'`, 'idle.json switches to Raw', 5000);
  await s.evalJs(`(() => { const e = ${editorJs}; const m = e.getModel(); e.executeEdits('verify', [{ range: m.getFullModelRange(), text: '{"a":1,"d":2}' }]); })()`);
  await sleep(1000);
  const runsIdle = await idleRuns();
  expect(runsIdle === runsOnOpen, `data-pretty-runs unchanged after a second typing in Raw with nobody on Pretty (${runsOnOpen} vs ${runsIdle})`);
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="pretty"]').click()`);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.view === 'pretty' && !!m && m.getValue().includes('"d": 2'); })()`, 'switching to Pretty reformats the stale Raw edit at once', 5000);
  const runsLive = await idleRuns();
  expect(runsLive === runsOnOpen + 1, `data-pretty-runs is up by one once Pretty is live again, with the edit formatted (${JSON.stringify({ runsOnOpen, runsLive })})`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!!document.querySelector('.unsaved-dialog')`, 'the close asks about the edit', 3000);
  await s.evalJs(`document.querySelector('.unsaved-dialog button[data-choice="discard"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Discard closes the tab');
  step("M9 fix 358: the Pretty view holds its reformat while nobody is on it (data-pretty-runs unmoved by a Raw edit) and reformats once, at once, when a view goes live again");

  // M9 fix 340: a file's own colour scheme. The second scheme of the
  // menu's section (the shipped list puts the default first) picked on
  // edited.txt puts its ground under the editor and marks the row; a
  // second file keeps the window's ground; the pick survives a reload;
  // Window's scheme puts the default back. The ground is read off
  // .monaco-editor-background as rgb, against the hex on the item's
  // title.
  const hexToRgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  const groundRead = () => s.evalJs(`(() => { const v = document.querySelector('.file-view'); const host = v?.querySelector('.monaco-editor-background'); return { path: v?.dataset.path ?? null, scheme: v?.dataset.scheme ?? null, ground: host ? getComputedStyle(host).backgroundColor : null, body: v ? getComputedStyle(v.querySelector('.file-body')).backgroundColor : null, header: v ? getComputedStyle(v.querySelector('.file-header')).backgroundColor : null }; })()`);
  const schemeRows = () => s.evalJs(`(() => { const m = ${menuJs}; if (!m) return null; const all = [...m.querySelectorAll('.menu-item')]; const at = all.findIndex((b) => b.querySelector('.menu-label').textContent === 'Colour scheme'); return all.slice(at + 1).map((b) => ({ label: b.querySelector('.menu-label').textContent.replace(/^✓/, ''), title: b.title, checked: b.dataset.checked ?? null })); })()`);
  await openEdited();
  const windowGround = await groundRead();
  expect(windowGround.scheme === null, `the file follows the window to begin with (${JSON.stringify(windowGround)})`);
  const groundPoint = await editorPoint(1, 2);
  await s.rightClick(groundPoint.x, groundPoint.y);
  await s.waitFor(`!!${menuJs}`, 'the file menu', 3000);
  const rowsBefore = await schemeRows();
  expect(rowsBefore.length >= 6 && rowsBefore[0].label === 'emerald' && rowsBefore.every((r) => r.checked === 'false') && !rowsBefore.some((r) => r.label === "Window's scheme"), `the section lists the schemes with none checked and nothing to clear (${JSON.stringify(rowsBefore)})`);
  const secondScheme = rowsBefore[1];
  const secondHex = secondScheme.title.match(/ground (#[0-9a-f]{6})/i)[1];
  await pick(secondScheme.label);
  await s.waitFor(`!${menuJs} && document.querySelector('.file-view')?.dataset.scheme === ${JSON.stringify(secondScheme.label)}`, 'the pick closes the menu and the view wears the scheme', 3000);
  const picked = await groundRead();
  expect(picked.ground === hexToRgb(secondHex) && picked.body === hexToRgb(secondHex), `the editor's ground and the body are the scheme's ${secondHex} (${JSON.stringify(picked)})`);
  expect(picked.header === windowGround.header, `the header keeps the window's ground (${picked.header} against ${windowGround.header})`);
  await s.screenshot('m9-340-scheme.png');
  await s.rightClick(groundPoint.x, groundPoint.y);
  await s.waitFor(`!!${menuJs}`, 'the menu again', 3000);
  const rowsAfter = await schemeRows();
  expect(rowsAfter[0].label === "Window's scheme" && rowsAfter.find((r) => r.label === secondScheme.label)?.checked === 'true', `Window's scheme heads the section and the pick is checked (${JSON.stringify(rowsAfter.slice(0, 3))})`);
  await s.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await s.waitFor(`!${menuJs}`, 'Escape closes the menu', 2000);
  // Another file keeps the window's ground.
  await clickRow(s, wrapFile);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(wrapFile)} && !!${editorJs}.getModel()`, 'wide.txt open', 5000);
  const otherGround = await groundRead();
  expect(otherGround.scheme === null && otherGround.ground === windowGround.ground, `another file keeps the window's ground (${JSON.stringify(otherGround)})`);
  // A row click opens a preview tab, which the next click's file takes
  // over, so edited.txt is opened again rather than wide.txt closed.
  await openEdited();
  await s.waitFor(`document.querySelector('.file-view')?.dataset.scheme === ${JSON.stringify(secondScheme.label)}`, 'edited.txt wears its scheme again', 3000);
  // The pick survives a reload, then Window's scheme clears it.
  await s.send('Page.reload');
  await sleep(1500);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(edited)} && document.querySelector('.file-view')?.dataset.scheme === ${JSON.stringify(secondScheme.label)} && !!${editorJs}?.getModel()`, 'the pick is kept across a reload', 15000);
  expect((await groundRead()).ground === hexToRgb(secondHex), 'and the ground with it');
  const groundPointAfter = await editorPoint(1, 2);
  await s.rightClick(groundPointAfter.x, groundPointAfter.y);
  await s.waitFor(`!!${menuJs}`, 'the menu after the reload', 3000);
  await pick("Window's scheme");
  await s.waitFor(`!${menuJs} && document.querySelector('.file-view')?.dataset.scheme === undefined`, "Window's scheme clears the pick", 3000);
  const cleared = await groundRead();
  expect(cleared.ground === windowGround.ground && cleared.body === windowGround.body, `the window's ground is back (${JSON.stringify(cleared)})`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  step("M9 fix 340: a scheme picked from the file menu's last section puts its ground under the file's document and not its header, another file keeps the window's, the pick survives a reload and Window's scheme clears it");

  // M9 fix 438: a file's own scheme colours its syntax too, not just its
  // ground. The menu only lists a Windows Terminal scheme once the main
  // process has reread EMERALD_WT_SETTINGS, and it rereads the file on
  // every call but the window already up inherited its own env at spawn
  // (cdp.mjs's launch hands the harness process.env), so this step closes
  // the window and relaunches pointed at a settings file with one light
  // scheme (the daemon stays up, verify-m2-persist.mjs's restart shape),
  // gives a JSON file that scheme from the menu, and reads the token
  // colour of its key and its string value against the scheme's blue
  // and green.
  const wtSettingsPath438 = path.join(process.env['EMERALD_HOME'], 'wt-settings-438.json');
  const lightScheme438 = {
    name: 'Verify Light',
    background: '#ffffff',
    foreground: '#101010',
    cursorColor: '#101010',
    selectionBackground: '#cce4ff',
    black: '#101010',
    red: '#aa0000',
    green: '#007a33',
    yellow: '#8a6d00',
    blue: '#0057b7',
    purple: '#7a3e9d',
    cyan: '#00728a',
    white: '#d0d0d0',
    brightBlack: '#5c5c5c',
    brightRed: '#c00000',
    brightGreen: '#009944',
    brightYellow: '#a68300',
    brightBlue: '#1a73e8',
    brightPurple: '#8e44ad',
    brightCyan: '#009bb0',
    brightWhite: '#ffffff',
  };
  fs.writeFileSync(wtSettingsPath438, JSON.stringify({ colorSchemes: [lightScheme438] }));
  const jsonFile438 = path.join(repo, 'scheme438.json');
  fs.writeFileSync(jsonFile438, `{\n  "note": "hello"\n}\n`);
  const childBefore438 = s.child;
  s.send('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {});
  s.close();
  await Promise.race([new Promise((r) => childBefore438.on('exit', r)), sleep(10000)]);
  // M9 fix 645: a window still up here shares the profile with the relaunch, which then never ran its renderer; end it through Node's handle, never a tree kill, which would take the daemon the relaunch reuses.
  if (childBefore438.exitCode === null && childBefore438.signalCode === null) {
    console.log('[verify] note: the old window had not exited after 10 s');
    childBefore438.kill();
    await Promise.race([new Promise((r) => childBefore438.once('exit', r)), sleep(5000)]);
  }
  await sleep(500);
  s = await launch(s.port + 1, { env: { EMERALD_WT_SETTINGS: wtSettingsPath438 } });
  app = s;
  await s.waitFor(`!!document.querySelector('.tab-strip')`, 'the window back after the relaunch for the new scheme', 20000);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(jsonFile438))})`, 'scheme438.json listed', 8000);
  await clickRow(s, jsonFile438);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(jsonFile438)} && !!${editorJs}.getModel()`, 'scheme438.json open', 5000);
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="raw"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'raw'`, 'scheme438.json in Raw', 3000);
  const point438 = await editorPoint(2, 4);
  await s.rightClick(point438.x, point438.y);
  await s.waitFor(`!!${menuJs}`, 'the file menu on scheme438.json', 3000);
  const rows438 = await schemeRows();
  const lightRow = rows438.find((r) => r.label === 'Verify Light');
  expect(lightRow !== undefined, `the light scheme reached the menu once the window reread EMERALD_WT_SETTINGS, got ${JSON.stringify(rows438.map((r) => r.label))}`);
  await pick('Verify Light');
  await s.waitFor(`!${menuJs} && document.querySelector('.file-view')?.dataset.scheme === 'Verify Light'`, 'the pick closes the menu and the view wears the light scheme', 3000);
  const tokenColor = (text) => s.evalJs(`(() => { const spans = [...document.querySelectorAll('.file-editor .view-line span')]; const hit = spans.find((sp) => sp.textContent === ${JSON.stringify(text)}); return hit ? getComputedStyle(hit).color : null; })()`);
  await s.waitFor(`[...document.querySelectorAll('.file-editor .view-line span')].some((sp) => sp.textContent === '"hello"')`, 'the value token drawn', 5000);
  const valueColor438 = await tokenColor('"hello"');
  const keyColor438 = await tokenColor('"note"');
  expect(valueColor438 === hexToRgb(lightScheme438.green), `a JSON string value's token wears the scheme's green, got ${valueColor438}`);
  expect(keyColor438 === hexToRgb(lightScheme438.blue), `a JSON key's token wears the scheme's blue, got ${keyColor438}`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes after the scheme check');
  step("M9 fix 438: once the window rereads EMERALD_WT_SETTINGS a Windows Terminal scheme reaches the file menu, and picking it for a JSON file colours a string value's token green and a key's token blue, its own colours and not vs-dark's");

  // M9 fix 309: New folder from a folder's menu puts a name box as the
  // folder's first row, Enter makes it and opens it; New file from the
  // header's + makes one at the root and opens it in a tab; a name
  // already there is refused with the box kept, and Escape drops it.
  const pendingSel = '.files-row.files-pending';
  const pendingRead = () => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(pendingSel)}); if (!r) return null; const rows = [...document.querySelectorAll('.files-row')]; return { kind: r.dataset.kind, dir: r.dataset.dir, refused: r.dataset.refused ?? null, at: rows.indexOf(r), value: r.querySelector('.files-rename')?.value ?? null, focused: document.activeElement === r.querySelector('.files-rename') }; })()`);
  const subFolder = path.join(repo, 'sub');
  const subBox = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(subFolder))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(subBox.x, subBox.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(subFolder)}`, "sub's folder menu");
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'New folder').click()`);
  await s.waitFor(`!document.querySelector('.files-menu') && !!document.querySelector(${JSON.stringify(pendingSel)})`, 'the name box row');
  const subRows = await s.evalJs(`[...document.querySelectorAll('.files-row')].map((r) => r.dataset.path ?? r.dataset.dir)`);
  let box = await pendingRead();
  expect(box.kind === 'dir' && box.dir === subFolder && box.at === subRows.indexOf(subFolder) + 1 && box.focused, `the box is sub's first child, a folder, focused (${JSON.stringify(box)})`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(subFolder))}).dataset.expanded`)) === 'true', 'sub opened for it');
  await s.type('made');
  await s.key('Enter', 'Enter', 13);
  const madeDir = path.join(subFolder, 'made');
  await s.waitFor(`!document.querySelector(${JSON.stringify(pendingSel)}) && document.querySelector(${JSON.stringify(rowSel(madeDir))})?.dataset.kind === 'dir'`, 'made/ listed under sub', 5000);
  expect(fs.statSync(madeDir).isDirectory(), 'the folder is on disk');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(madeDir))}).dataset.expanded`)) === 'true', 'the new folder is open');
  await s.evalJs(`document.querySelector('.files-new').click()`);
  await s.waitFor(`document.querySelector('.files-new-menu')?.dataset.path === ${JSON.stringify(repo)}`, "the header's + menu on the root");
  const newLabels = await s.evalJs(`[...document.querySelectorAll('.files-new-menu .menu-label')].map((b) => b.textContent).join(',')`);
  expect(newLabels === 'New file,New folder', `the + offers the two: ${newLabels}`);
  await s.evalJs(`[...document.querySelectorAll('.files-new-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'New file').click()`);
  await s.waitFor(`!document.querySelector('.files-new-menu') && !!document.querySelector(${JSON.stringify(pendingSel)})`, 'the name box row at the root');
  box = await pendingRead();
  expect(box.kind === 'file' && box.dir === repo && box.at === 0 && box.focused, `the box is the root's first row, a file (${JSON.stringify(box)})`);
  await s.type('note.txt');
  await s.key('Enter', 'Enter', 13);
  const noteFile = path.join(repo, 'note.txt');
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(noteFile)}`, 'note.txt opens in a tab', 5000);
  await s.waitFor(`!document.querySelector(${JSON.stringify(pendingSel)}) && document.querySelector(${JSON.stringify(rowSel(noteFile))})?.dataset.kind === 'file'`, 'note.txt listed at the root', 5000);
  expect(fs.readFileSync(noteFile, 'utf8') === '', 'the file is on disk, empty');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes');
  fs.writeFileSync(noteFile, 'kept');
  await s.evalJs(`document.querySelector('.files-new').click()`);
  await s.waitFor(`!!document.querySelector('.files-new-menu')`, 'the + menu again');
  await s.evalJs(`[...document.querySelectorAll('.files-new-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'New file').click()`);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(pendingSel)})`, 'the name box row again');
  await s.type('note.txt');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`document.querySelector(${JSON.stringify(pendingSel)})?.dataset.refused === 'exists' && document.activeElement === document.querySelector(${JSON.stringify(pendingSel + ' .files-rename')})`, 'the taken name is refused and the new box has the keyboard', 5000);
  box = await pendingRead();
  expect(box.value === 'note.txt' && box.focused, `the box keeps the name and the focus (${JSON.stringify(box)})`);
  expect(fs.readFileSync(noteFile, 'utf8') === 'kept', 'the file was not written over');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector(${JSON.stringify(pendingSel)})`, 'Escape drops the row');
  step("M9 fix 309: New folder from a folder's menu and New file from the header's + name the entry in place, the file opens in a tab, a taken name is refused with the box kept, and Escape drops it");

  // M9 fix 574: Rename on a file's menu renames in place with the stem
  // selected, and a dirty tab follows and keeps its edits; F2 after a
  // second click on a file and after a right-click on a folder renames
  // too; a taken name is refused with the box kept; a plain folder click
  // leaves the keyboard alone.
  const renA = path.join(repo, 'ren-a.txt');
  const renB = path.join(repo, 'ren-b.txt');
  const takenFile = path.join(repo, 'taken.txt');
  const renDir = path.join(repo, 'ren-dir');
  const renDir2 = path.join(repo, 'ren-dir2');
  const innerFile = path.join(renDir, 'inner.txt');
  const inner2 = path.join(renDir2, 'inner.txt');
  fs.writeFileSync(renA, 'alpha\n');
  fs.writeFileSync(takenFile, 'taken\n');
  fs.mkdirSync(renDir);
  fs.writeFileSync(innerFile, 'inner\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(renA))}) && !!document.querySelector(${JSON.stringify(rowSel(takenFile))}) && !!document.querySelector(${JSON.stringify(rowSel(renDir))})`, 'the rename fixture listed', 5000);
  const renSel = (p) => `.files-row.files-renaming[data-path=${JSON.stringify(p)}]`;
  const renRead = (p) =>
    s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(renSel(p))}); if (!r) return null; const b = r.querySelector('.files-rename'); return { value: b?.value ?? null, start: b?.selectionStart ?? null, end: b?.selectionEnd ?? null, focused: !!b && document.activeElement === b, refused: r.dataset.refused ?? null, title: r.title }; })()`);
  const centreOf = (p) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(p))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const treeHasKeys = `document.activeElement === document.querySelector('.files-list')`;
  // (1) A dirty tab on ren-a.txt.
  await clickRow(s, renA);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(renA)} && !!${editorJs}.getModel()`, 'ren-a.txt open in a tab', 5000);
  await s.waitFor(`!!document.activeElement?.closest('.monaco-editor')`, 'the keyboard in the editor', 3000);
  await typeAtEnd('beta');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'ren-a.txt dirty');
  // (2) Rename from the row's menu, the stem selected.
  let at = await centreOf(renA);
  await s.rightClick(at.x, at.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(renA)}`, "ren-a.txt's menu");
  const renLabels = await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-label')].map((b) => b.textContent)`);
  expect(renLabels[renLabels.indexOf('Open in a tab') + 1] === 'Rename', `Rename follows Open in a tab: ${renLabels.join(',')}`);
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Rename').click()`);
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(renSel(renA) + ' .files-rename')})`, 'the rename box focused', 3000);
  let ren = await renRead(renA);
  expect(ren.value === 'ren-a.txt' && ren.start === 0 && ren.end === 5, `the box holds the name with the stem selected (${JSON.stringify(ren)})`);
  // (3) The rename, the dirty tab following.
  await s.type('ren-b');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(
    `!document.querySelector('.files-renaming') && document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(renB)} && document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(renB)} && document.querySelector('.file-view')?.dataset.dirty === 'true' && !!document.querySelector(${JSON.stringify(rowSel(renB))}) && !document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(renA))} + ']') && !!document.querySelector('.file-editor')?.emeraldEditor?.getModel()?.uri.path.endsWith('/ren-b.txt')`,
    'the tab follows the rename',
    5000,
  );
  const renText = await s.evalJs(`(() => { const m = ${editorJs}.getModel(); return { text: m.getValue(), uri: m.uri.path }; })()`);
  expect(
    fs.existsSync(renB) && !fs.existsSync(renA) && fs.readFileSync(renB, 'utf8') === 'alpha\n' && renText.text.includes('beta') && renText.uri.endsWith('/ren-b.txt'),
    `the dirty tab followed the rename and kept its edits (${JSON.stringify(renText)})`,
  );
  // (4) The save lands at the new path.
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty !== 'true'`, 'the save', 5000);
  expect(fs.readFileSync(renB, 'utf8').includes('beta') && !fs.existsSync(renA), 'the save landed at the new path');
  // (5) F2 after a second click on the selected file; a taken name.
  await clickRow(s, renB);
  await s.waitFor(treeHasKeys, 'a second click on the selected file put the keyboard on the tree', 3000);
  await s.key('F2', 'F2', 113);
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(renSel(renB) + ' .files-rename')})`, 'F2 opens the rename box on ren-b.txt', 3000);
  ren = await renRead(renB);
  expect(ren.value === 'ren-b.txt', `the box holds ren-b.txt (${JSON.stringify(ren)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(renSel(renB) + ' .files-rename')}).select()`);
  await s.type('taken.txt');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`document.querySelector(${JSON.stringify(renSel(renB))})?.dataset.refused === 'exists' && document.activeElement === document.querySelector(${JSON.stringify(renSel(renB) + ' .files-rename')})`, 'the taken name is refused and the new box has the keyboard', 5000);
  ren = await renRead(renB);
  expect(
    ren.value === 'taken.txt' && ren.focused && ren.title === 'A file or folder of that name is already there' && fs.readFileSync(takenFile, 'utf8') === 'taken\n' && fs.existsSync(renB),
    `the box keeps the taken name and the focus, nothing written over (${JSON.stringify(ren)})`,
  );
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.files-renaming') && !!document.querySelector(${JSON.stringify(rowSel(renB))})`, 'Escape drops the box');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes after the rename');
  // (6) A plain folder click leaves the keyboard where it was.
  await s.evalJs('document.querySelector(".pane.focused .xterm-helper-textarea").focus(); window.__ae574 = document.activeElement; true');
  await clickRow(s, renDir);
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(renDir))})?.dataset.expanded === 'true'`, 'ren-dir expanded');
  const plain = await s.evalJs(`({ same: document.activeElement === window.__ae574, selected: document.querySelector(${JSON.stringify(rowSel(renDir))}).dataset.selected ?? null })`);
  expect(plain.same && plain.selected === null, `a plain click on a folder row expands it, selects nothing and leaves the keyboard in the terminal (${JSON.stringify(plain)})`);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(innerFile))})`, 'inner.txt listed', 5000);
  await clickRow(s, innerFile);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(innerFile)}`, 'inner.txt open in a tab', 5000);
  await s.waitFor(`${editorJs}.getModel()?.uri.path.endsWith('/ren-dir/inner.txt') === true`, 'inner.txt in the editor', 5000);
  await s.waitFor(`!!document.activeElement?.closest('.monaco-editor')`, 'the keyboard in the editor before the right-click', 3000);
  // F2 after a right-click on a folder.
  at = await centreOf(renDir);
  await s.rightClick(at.x, at.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(renDir)}`, "ren-dir's menu");
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.files-menu')`, 'Escape closes the menu');
  const afterMenu = await s.evalJs(`({ selected: document.querySelector(${JSON.stringify(rowSel(renDir))})?.dataset.selected ?? null, tree: ${treeHasKeys} })`);
  expect(afterMenu.selected === 'true' && afterMenu.tree, `a right-click selected the folder and the Escape that closed the menu left the keyboard on the tree (${JSON.stringify(afterMenu)})`);
  await s.key('F2', 'F2', 113);
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(renSel(renDir) + ' .files-rename')})`, 'F2 opens the rename box on ren-dir', 3000);
  ren = await renRead(renDir);
  expect(ren.value === 'ren-dir' && ren.start === 0 && ren.end === 7, `the folder's box holds its whole name selected (${JSON.stringify(ren)})`);
  await s.type('ren-dir2');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(
    `(() => { const d = document.querySelector(${JSON.stringify(rowSel(renDir2))}); return !!d && d.dataset.kind === 'dir' && d.dataset.expanded === 'true' && d.dataset.selected === 'true' && !!document.querySelector(${JSON.stringify(rowSel(inner2))}) && document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(inner2)} && document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(inner2)} && !document.querySelector('.tab-file[data-tab=' + ${JSON.stringify(JSON.stringify(innerFile))} + ']'); })()`,
    'the folder renamed, open, selected, its tab following',
    5000,
  );
  expect(fs.existsSync(renDir2) && !fs.existsSync(renDir), 'F2 renamed the selected folder, and its open state, its selection and the tab under it followed');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes after the folder rename');
  // The fixture goes, so the rows below keep the places the later steps'
  // right-clicks measure on screen.
  fs.rmSync(renDir2, { recursive: true, force: true });
  fs.rmSync(renB, { force: true });
  fs.rmSync(takenFile, { force: true });
  await s.waitFor(`![${[renDir2, renB, takenFile].map((p) => JSON.stringify(rowSel(p))).join(', ')}].some((q) => document.querySelector(q))`, 'the rename fixture gone from the tree', 5000);
  step("M9 fix 574: Rename on a file's menu renames in place with the stem selected and a dirty tab follows and keeps its edits, the save landing at the new path; F2 after a second click on a file and after a right-click on a folder renames too, a taken name is refused with the box kept, a plain folder click leaves the keyboard alone, and the open folder, its selection and the tab under it follow");

  // M9 fix 310: Revert changes on a changed row's menu asks once more,
  // then puts the committed version back and the letter goes; on an
  // untracked row the item is disabled with its reason.
  const trackedFile = path.join(repo, 'tracked.txt');
  const committedText = git('show', 'HEAD:tracked.txt');
  fs.writeFileSync(trackedFile, `${committedText}\nand a line the revert throws away\n`);
  await s.waitFor(`(${letterOf(trackedFile)}) === 'M'`, 'tracked.txt changed in the work tree', 8000);
  const menuItem = (label) => `[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)})`;
  const trackedBox = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(trackedFile))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(trackedBox.x, trackedBox.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(trackedFile)} && !!${menuItem('Revert changes')}`, "tracked.txt's menu with Revert changes");
  expect((await s.evalJs(`${menuItem('Revert changes')}.disabled`)) === false, 'Revert changes is enabled on a changed tracked file');
  await s.evalJs(`${menuItem('Revert changes')}.click()`);
  await s.waitFor(`!!document.querySelector('.files-menu') && !!${menuItem('Revert, are you sure?')} && !${menuItem('Revert changes')}`, 'the first click turns the label into the question and keeps the menu open');
  expect(fs.readFileSync(trackedFile, 'utf8').includes('throws away'), 'nothing reverted yet');
  await s.evalJs(`${menuItem('Revert, are you sure?')}.click()`);
  await s.waitFor(`!document.querySelector('.files-menu')`, 'the second click closes the menu');
  await s.waitFor(`(${letterOf(trackedFile)}) === ''`, "the row's letter goes", 8000);
  expect(fs.readFileSync(trackedFile, 'utf8') === committedText, 'the file is back to the committed text');
  const untrackedMenu = await menuOf(path.join(repo, 'new.txt'));
  expect(untrackedMenu[0] === 'Revert changes (disabled)', `Revert is disabled on the untracked row: ${untrackedMenu.join(',')}`);
  const newBox = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(path.join(repo, 'new.txt')))}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(newBox.x, newBox.y);
  await s.waitFor(`!!${menuItem('Revert changes')}`, "new.txt's menu");
  const revertTitle = await s.evalJs(`${menuItem('Revert changes')}.title`);
  expect(revertTitle === 'Nothing to go back to: this file has no committed version', `the disabled item says why: ${revertTitle}`);
  await s.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed');
  step("M9 fix 310: Revert changes asks once more, then puts the committed version back and the row's letter goes; an untracked row has it disabled with the reason");

  // M9 fix 618: Rename from a names-mode search hit and from a Changed
  // row, the box drawn on the row itself; the hit reads the new name and
  // the Changed list the new row at once (the search and the git read
  // run again after the rename), and the tab follows. A contents hit is
  // one of a file's lines and has no Rename. The rail is on repo, the
  // tree showing, names mode, an empty filter and Changed off.
  const hitA = path.join(repo, 'hitfile-a.txt');
  const hitB = path.join(repo, 'hitfile-b.txt');
  const chgA = path.join(repo, 'chg-a.txt');
  const chgB = path.join(repo, 'chg-b.txt');
  fs.writeFileSync(hitA, 'hitline618\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(hitA))})`, 'hitfile-a.txt listed', 5000);
  const hitSel618 = (p) => `.files-hit[data-path=${JSON.stringify(p)}]`;
  const labelsAt618 = async (sel, p) => {
    const box = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.rightClick(box.x, box.y);
    await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(p)}`, 'the menu on ' + path.basename(p));
    return s.evalJs(`[...document.querySelectorAll('.files-menu .menu-label')].map((b) => b.textContent)`);
  };
  const closeMenu618 = async () => {
    await s.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed');
  };
  // (a) A names hit.
  await setInput(s, '.files-filter-input', 'hitfile');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 1 && !!document.querySelector(${JSON.stringify(hitSel618(hitA))})`, 'one names hit for hitfile', 5000);
  await s.evalJs(`document.querySelector(${JSON.stringify(hitSel618(hitA))}).click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(hitA)}`, 'the hit opens in a tab', 5000);
  let labels618 = await labelsAt618(hitSel618(hitA), hitA);
  expect(labels618.includes('Rename'), `a names hit's menu has Rename: ${labels618.join(',')}`);
  await s.evalJs(`${menuItem('Rename')}.click()`);
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify('.files-hit' + renSel(hitA) + ' .files-rename')})`, 'the box on the hit, focused', 3000);
  ren = await renRead(hitA);
  expect(ren.value === 'hitfile-a.txt' && ren.start === 0 && ren.end === 9 && ren.focused, `the hit's box holds the name with the stem selected (${JSON.stringify(ren)})`);
  await s.type('hitfile-b');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(
    `!document.querySelector('.files-renaming') && document.querySelector(${JSON.stringify(hitSel618(hitB))})?.querySelector('.files-name')?.textContent === 'hitfile-b.txt' && !document.querySelector(${JSON.stringify(hitSel618(hitA))}) && document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(hitB)} && document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(hitB)}`,
    'the hit reads the new name and the tab follows',
    5000,
  );
  expect(fs.existsSync(hitB) && !fs.existsSync(hitA), 'the hit renamed the file on disk');
  // A contents hit has no Rename.
  await s.evalJs(`document.querySelector('.files-mode[data-mode="contents"]').click()`);
  await setInput(s, '.files-filter-input', 'hitline618');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 1 && document.querySelector('.files-hit')?.dataset.line === '1'`, 'one contents hit', 5000);
  labels618 = await labelsAt618('.files-hit', hitB);
  expect(!labels618.includes('Rename'), `a contents hit's menu has no Rename: ${labels618.join(',')}`);
  await closeMenu618();
  await s.evalJs(`document.querySelector('.files-mode[data-mode="names"]').click()`);
  await setInput(s, '.files-filter-input', '');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 0 && !!document.querySelector(${JSON.stringify(rowSel(hitB))})`, 'the tree back', 5000);
  // (b) An untracked Changed row, so the rename leaves no D row behind.
  fs.writeFileSync(chgA, 'changed618\n');
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  const chgSel618 = (p) => `.files-changed-row[data-path=${JSON.stringify(p)}]`;
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === 'true' && !!document.querySelector(${JSON.stringify(chgSel618(chgA))})`, 'chg-a.txt in the Changed list', 8000);
  await s.evalJs(`document.querySelector(${JSON.stringify(chgSel618(chgA))}).click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(chgA)}`, 'the Changed row opens in a tab', 5000);
  labels618 = await labelsAt618(chgSel618(chgA), chgA);
  expect(labels618.includes('Rename'), `a Changed row's menu has Rename: ${labels618.join(',')}`);
  await s.evalJs(`${menuItem('Rename')}.click()`);
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify('.files-changed-row' + renSel(chgA) + ' .files-rename')})`, 'the box on the Changed row, focused', 3000);
  await s.type('chg-b');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(
    `!document.querySelector('.files-renaming') && !!document.querySelector(${JSON.stringify(chgSel618(chgB))}) && !document.querySelector(${JSON.stringify(chgSel618(chgA))}) && document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(chgB)} && document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(chgB)}`,
    'the Changed list reads the new row and the tab follows',
    5000,
  );
  expect(fs.existsSync(chgB) && !fs.existsSync(chgA), 'the Changed row renamed the file on disk');
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === undefined && !!document.querySelector(${JSON.stringify(rowSel(chgB))})`, 'Changed off, the tree back', 8000);
  // The two files stay for fix 617's step, which deletes them from the
  // hit and the Changed row.
  step("M9 fix 618: Rename from a names hit and from a Changed row draws the box on the row, the hit and the row read the new name at once and the tab follows; a contents hit has no Rename");

  // M9 fix 617: Delete on a row's menu, last behind a rule, wherever
  // Rename shows. Disabled with the reason on a file with unsaved edits
  // in a tab; the first press asks with the menu held open, the second
  // moves the entry to the recycle bin and its tab goes. A harness window
  // moves each fixture into <EMERALD_HOME>\trash instead (fix 644), so
  // none reaches the person's recycle bin. The rail is on repo, the tree
  // showing, names mode, an empty filter and Changed off.
  const trash644 = path.join(process.env['EMERALD_HOME'], 'trash');
  fs.rmSync(trash644, { recursive: true, force: true });
  const delA = path.join(repo, 'del-a.txt');
  const delDir = path.join(repo, 'del-dir');
  const delInner = path.join(delDir, 'inner.txt');
  const tabSel617 = (p) => `.tab-file[data-tab=${JSON.stringify(p)}]`;
  const deleteTwice617 = async (sel, p) => {
    const box = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.rightClick(box.x, box.y);
    await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(p)} && !!${menuItem('Delete')}`, 'Delete on the menu of ' + path.basename(p));
    const first = await s.evalJs(`(() => { const b = ${menuItem('Delete')}; const items = [...document.querySelectorAll('.files-menu .menu-item')]; return { disabled: b.disabled, title: b.title, last: items[items.length - 1] === b }; })()`);
    expect(!first.disabled && first.title === 'Move it to the recycle bin; asks once more' && first.last, `Delete is the enabled last item, asking once more (${JSON.stringify(first)})`);
    await s.evalJs(`${menuItem('Delete')}.click()`);
    await s.waitFor(`!!document.querySelector('.files-menu') && !!${menuItem('Delete, to the recycle bin?')} && !${menuItem('Delete')}`, 'the first press asks with the menu held open');
    expect(fs.existsSync(p), path.basename(p) + ' still on disk after the first press');
    await s.evalJs(`${menuItem('Delete, to the recycle bin?')}.click()`);
    await s.waitFor(`!document.querySelector('.files-menu')`, 'the second press closes the menu');
  };
  // (a) A dirty tab on del-a.txt: Delete disabled with the reason.
  fs.writeFileSync(delA, 'delete me\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(delA))})`, 'del-a.txt listed', 5000);
  await clickRow(s, delA);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(delA)} && !!${editorJs}.getModel()`, 'del-a.txt open in a tab', 5000);
  await s.waitFor(`!!document.activeElement?.closest('.monaco-editor')`, 'the keyboard in the editor', 3000);
  await typeAtEnd('x');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'del-a.txt dirty');
  const dirtyMenu617 = await menuOf(delA);
  expect(dirtyMenu617[dirtyMenu617.length - 1] === 'Delete (disabled)', `Delete is the disabled last item on a dirty file: ${dirtyMenu617.join(',')}`);
  at = await centreOf(delA);
  await s.rightClick(at.x, at.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(delA)} && !!${menuItem('Delete')}`, "del-a.txt's menu");
  const dirtyTitle617 = await s.evalJs(`${menuItem('Delete')}.title`);
  expect(dirtyTitle617 === 'Unsaved edits in a tab: save or discard them first', `the disabled Delete says why: ${dirtyTitle617}`);
  await s.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed');
  // (b) Saved, Delete asks once more, then the row, the tab and the file go.
  await s.evalJs(`${editorJs}.focus()`);
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty !== 'true'`, 'the save', 5000);
  await deleteTwice617(rowSel(delA), delA);
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(delA))}) && !document.querySelector(${JSON.stringify(tabSel617(delA))})`, 'the row and the tab gone', 5000);
  expect(!fs.existsSync(delA), 'del-a.txt went to the recycle bin');
  // (c) A folder with a file open in a tab under it.
  fs.mkdirSync(delDir);
  fs.writeFileSync(delInner, 'inner\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(delDir))})`, 'del-dir listed', 5000);
  await clickRow(s, delDir);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(delInner))})`, 'del-dir open, inner.txt listed', 5000);
  await clickRow(s, delInner);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(delInner)}`, 'inner.txt open in a tab', 5000);
  await deleteTwice617(rowSel(delDir), delDir);
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(delDir))}) && !document.querySelector(${JSON.stringify(tabSel617(delInner))})`, 'the folder row and the tab under it gone', 5000);
  expect(!fs.existsSync(delDir), 'del-dir went to the recycle bin');
  // (d) Fix 618's two files, from the names hit and the Changed row.
  await setInput(s, '.files-filter-input', 'hitfile');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 1 && !!document.querySelector(${JSON.stringify(hitSel618(hitB))})`, 'the hitfile-b.txt hit', 5000);
  await deleteTwice617(hitSel618(hitB), hitB);
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 0 && !document.querySelector(${JSON.stringify(tabSel617(hitB))})`, 'the hit gone', 5000);
  expect(!fs.existsSync(hitB), 'hitfile-b.txt went to the recycle bin');
  await setInput(s, '.files-filter-input', '');
  await s.waitFor(`document.querySelectorAll('.files-hit').length === 0 && document.querySelectorAll('.files-row').length > 0`, 'the tree back', 5000);
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === 'true' && !!document.querySelector(${JSON.stringify(chgSel618(chgB))})`, 'chg-b.txt in the Changed list', 8000);
  await deleteTwice617(chgSel618(chgB), chgB);
  await s.waitFor(`!document.querySelector(${JSON.stringify(chgSel618(chgB))}) && !document.querySelector(${JSON.stringify(tabSel617(chgB))})`, 'the Changed row gone', 8000);
  expect(!fs.existsSync(chgB), 'chg-b.txt went to the recycle bin');
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === undefined && document.querySelectorAll('.files-row').length > 0`, 'Changed off, the tree back', 8000);
  step('M9 fix 617: Delete is the last item wherever Rename is, disabled with the reason on a dirty file, asks once with the menu held open, then moves a file, a folder, a names hit and a Changed row to the recycle bin and closes their tabs');

  expect(fs.readdirSync(trash644).sort().join(',') === '1-chg-b.txt,1-del-a.txt,1-del-dir,1-hitfile-b.txt', `the home's trash holds the four entries (${fs.existsSync(trash644) ? fs.readdirSync(trash644).join(',') : 'no folder'})`);
  expect(fs.existsSync(path.join(trash644, '1-del-dir', 'inner.txt')), 'the folder moved whole');
  const trashLines644 = fs.readFileSync(openedPaths, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('trash '));
  expect(JSON.stringify(trashLines644) === JSON.stringify([delA, delDir, hitB, chgB].map((p) => `trash ${p}`)), `the open log holds the four trash lines (${JSON.stringify(trashLines644)})`);
  step('M9 fix 644: under a private EMERALD_HOME the four deletes land in the home\'s trash under numbered names, and the open log holds their four trash lines');
  // M9 fix 337: a file open in a pane with no tab hears a change on
  // disk. A shell in a folder of its own, focused so the rail follows
  // it; the file opened beside it through the row menu's Open in a
  // pane, never a tab; then a different pane focused so the rail
  // leaves the folder, proving the watch rides the layout's own panes
  // now, not the rail's open set or the tab strip.
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelector('.files-empty')?.textContent === 'No session in this pane'`, 'a fresh empty pane');
  await startSession(s, { kind: 'shell', cwd: paneSeed });
  const paneSeedPaneId = (await getLayout(s)).focusedPaneId;
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(paneSeed)}`, 'the rail follows the new shell');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(paneFile))})`, 'note.txt listed');
  await s.evalJs(
    `(() => { const r = document.querySelector(${JSON.stringify(rowSel(paneFile))}); const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 })); })()`,
  );
  await s.waitFor(`!!document.querySelector('.files-menu')`, 'the row menu');
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Open in a pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'the file pane opened');
  const paneFileSel = `document.querySelector('.pane[data-view="file"]')`;
  await s.waitFor(`${paneFileSel}?.querySelector('.file-view')?.dataset.state === 'text'`, 'the file read into the pane');
  expect((await s.evalJs(`${paneFileSel}.dataset.path`)) === paneFile, 'the pane is titled for the file');
  expect(!(await s.evalJs(`[...document.querySelectorAll('.tab-file')].some((t) => t.dataset.tab === ${JSON.stringify(paneFile)})`)), 'the file has no tab of its own');

  await typeInto(s, shell1.id, `cd ${JSON.stringify(seed)}`);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)}`, 'the rail left the pane-file folder');

  fs.writeFileSync(paneFile, 'two\n');
  const paneEditorJs = `${paneFileSel}.querySelector('.file-editor').emeraldEditor`;
  await s.waitFor(`${paneEditorJs}.getModel().getValue() === 'two\\n'`, 'the pane text replaced within two seconds, tab or no tab', 2500);

  // Type into the pane's editor, then a write from outside while it is
  // dirty is the changed-on-disk notice, not a silent overwrite.
  await s.evalJs(`(() => { const e = ${paneEditorJs}; const m = e.getModel(); const n = m.getLineCount(); e.setPosition({ lineNumber: n, column: m.getLineMaxColumn(n) }); e.focus(); })()`);
  await s.type('mine');
  await s.waitFor(`${paneFileSel}.querySelector('.file-view')?.dataset.dirty === 'true'`, 'the pane dirty after typing', 3000);
  fs.writeFileSync(paneFile, 'two\nthree\n');
  await s.waitFor(`${paneFileSel}.querySelector('.file-view')?.dataset.conflict === 'true'`, 'a write under the edit is a conflict', 5000);
  const paneNotice = await s.evalJs(
    `(() => { const n = ${paneFileSel}.querySelector('.file-notice[data-kind="disk"]'); return n ? n.querySelector('span').textContent + '|' + [...n.querySelectorAll('button')].map((b) => b.textContent).join(',') : null; })()`,
  );
  expect(paneNotice === 'Changed on disk while you were editing.|Reload,Keep mine', `the notice and its two buttons (${paneNotice})`);
  await s.evalJs(`${paneFileSel}.querySelector('.file-notice[data-kind="disk"] button[title^="Take"]').click()`);
  await s.waitFor(`${paneFileSel}.querySelector('.file-view')?.dataset.conflict === undefined`, 'Reload clears the line', 3000);
  expect((await s.evalJs(`${paneEditorJs}.getModel().getValue()`)) === 'two\nthree\n', 'Reload put the disk text in');
  step('M9 fix 337: a file open in a pane with no tab hears a change on disk, tab or no tab');

  // M9 fix 489: Ctrl+S saves the file you are looking at. Two file
  // panes, the second (b.txt) mounted after the first (note.txt): the
  // key in the first's editor saves the first, not the newer one; the
  // second closed, it still does; and with the keyboard off the editor
  // (on the panes tab, then on a file tab) it saves the file in view.
  const saveRowB = path.join(seed, 'b.txt');
  const saveRowA = path.join(seed, 'a.txt');
  await s.evalJs(
    `(() => { const r = document.querySelector(${JSON.stringify(rowSel(saveRowB))}); const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 })); })()`,
  );
  await s.waitFor(`!!document.querySelector('.files-menu')`, 'the row menu for b.txt');
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Open in a pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 2`, 'the second file pane opened');
  const viewOf = (p) => `document.querySelector('.pane[data-view="file"][data-path=' + ${JSON.stringify(JSON.stringify(p))} + ']')`;
  await s.waitFor(`${viewOf(saveRowB)}?.querySelector('.file-view')?.dataset.state === 'text' && ${viewOf(paneFile)}?.querySelector('.file-view')?.dataset.state === 'text'`, 'both panes read');
  const endTypeIn = async (p, text) => {
    await s.evalJs(`(() => { const e = ${viewOf(p)}.querySelector('.file-editor').emeraldEditor; const m = e.getModel(); const n = m.getLineCount(); e.setPosition({ lineNumber: n, column: m.getLineMaxColumn(n) }); e.focus(); })()`);
    await s.waitFor(`!!document.activeElement?.closest('.monaco-editor') && document.activeElement.closest('.pane').dataset.path === ${JSON.stringify(p)}`, "the keyboard in that pane's editor", 3000);
    await s.type(text);
  };
  await endTypeIn(paneFile, 'S1');
  await s.waitFor(`${viewOf(paneFile)}.querySelector('.file-view').dataset.dirty === 'true'`, 'the first pane dirty');
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`${viewOf(paneFile)}.querySelector('.file-view').dataset.dirty === undefined`, 'Ctrl+S in the first pane saved it', 3000);
  expect(fs.readFileSync(paneFile, 'utf8').includes('S1') && fs.readFileSync(saveRowB, 'utf8') === 'b.txt', `the first file has the edit and the second is untouched: ${JSON.stringify(fs.readFileSync(paneFile, 'utf8'))}`);
  await s.evalJs(`${viewOf(saveRowB)}.querySelector('.files-button[title="Close pane"]').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'the second file pane closed');
  await endTypeIn(paneFile, 'S2');
  await s.waitFor(`${viewOf(paneFile)}.querySelector('.file-view').dataset.dirty === 'true'`, 'the first pane dirty again');
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`${viewOf(paneFile)}.querySelector('.file-view').dataset.dirty === undefined`, 'Ctrl+S after the other pane closed still saves', 3000);
  expect(fs.readFileSync(paneFile, 'utf8').includes('S2'), 'the second edit is on disk');
  // The keyboard off the editor: the pane is the focused one, the
  // editor's focus dropped, and the key still saves.
  await endTypeIn(paneFile, 'S3');
  await s.waitFor(`${viewOf(paneFile)}.querySelector('.file-view').dataset.dirty === 'true'`, 'dirty for the blurred save');
  // A click in a pane focuses it (mousedown), which the script's typing
  // by focus() does not; the layout's focused pane is what the key reads.
  await s.evalJs(`${viewOf(paneFile)}.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  const filePaneId = await s.evalJs(`${viewOf(paneFile)}.dataset.paneId`);
  for (let i = 0; i < 30 && (await getLayout(s)).focusedPaneId !== filePaneId; i++) await sleep(100);
  expect((await getLayout(s)).focusedPaneId === filePaneId, 'the file pane is the focused one');
  await s.evalJs(`document.activeElement.blur()`);
  expect(!(await s.evalJs(`!!document.activeElement?.closest('.monaco-editor')`)), 'the keyboard is off the editor');
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`${viewOf(paneFile)}.querySelector('.file-view').dataset.dirty === undefined`, "Ctrl+S with the keyboard off the editor saves the focused pane's file", 3000);
  expect(fs.readFileSync(paneFile, 'utf8').includes('S3'), 'the third edit is on disk');
  // A dirty file tab in front, the keyboard off the editor.
  // The rail followed the file pane's folder; back to the seed's.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)}`, 'the rail back on the seed');
  await clickRow(s, saveRowA);
  // The panes stay mounted under a file tab, so the tab's own view is the
  // one outside .panes-view.
  const tabViewJs = `[...document.querySelectorAll('.file-view')].find((v) => !v.closest('.panes-view'))`;
  const tabEditorJs = `${tabViewJs}.querySelector('.file-editor').emeraldEditor`;
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === ${JSON.stringify(saveRowA)} && ${tabViewJs}?.dataset.state === 'text' && !!${tabViewJs}.querySelector('.file-editor')?.emeraldEditor?.getModel()`, 'a.txt open in a tab', 5000);
  await s.evalJs(`(() => { const e = ${tabEditorJs}; const m = e.getModel(); const n = m.getLineCount(); e.setPosition({ lineNumber: n, column: m.getLineMaxColumn(n) }); e.focus(); })()`);
  await s.type('T1');
  await s.waitFor(`${tabViewJs}.dataset.dirty === 'true'`, 'a.txt dirty');
  await s.evalJs(`document.activeElement.blur()`);
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`${tabViewJs}.dataset.dirty === undefined`, 'Ctrl+S with the keyboard off the editor saved the tab', 3000);
  expect(fs.readFileSync(saveRowA, 'utf8').includes('T1'), `a.txt has the edit on disk: ${JSON.stringify(fs.readFileSync(saveRowA, 'utf8'))}`);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'back on the panes');
  step('M9 fix 489: Ctrl+S saves the file in view: the older of two panes, after a pane closes, with the keyboard off the editor, and a file tab');

  // M9 fix 591: a file shown in a pane follows a rail rename, its unsaved
  // edits with it (the model handed over until the layout edit lands),
  // and Ctrl+S on the focused pane saves at the new path.
  const movedFile = path.join(paneSeed, 'moved.txt');
  await endTypeIn(paneFile, 'R1');
  await s.waitFor(`${viewOf(paneFile)}.querySelector('.file-view').dataset.dirty === 'true'`, 'the file pane dirty before the rename');
  await s.evalJs(`${viewOf(paneFile)}.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(paneSeed)}`, "the rail on the file pane's folder", 5000);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(paneFile))})`, 'note.txt listed for the rename', 5000);
  at = await centreOf(paneFile);
  await s.rightClick(at.x, at.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(paneFile)}`, "note.txt's menu");
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Rename').click()`);
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(renSel(paneFile) + ' .files-rename')})`, 'the rename box on note.txt', 3000);
  await s.type('moved');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(
    `!document.querySelector('.files-renaming') && !${viewOf(paneFile)} && ${viewOf(movedFile)}?.querySelector('.file-view')?.dataset.path === ${JSON.stringify(movedFile)} && ${viewOf(movedFile)}?.querySelector('.file-view')?.dataset.state === 'text' && ${viewOf(movedFile)}?.querySelector('.file-view')?.dataset.dirty === 'true'`,
    'the file pane on moved.txt, read, still dirty',
    5000,
  );
  const moved591 = await s.evalJs(`(() => { const m = ${viewOf(movedFile)}.querySelector('.file-editor').emeraldEditor.getModel(); return { text: m.getValue(), uri: m.uri.path }; })()`);
  expect(moved591.text.includes('R1') && moved591.uri.endsWith('/moved.txt'), `the pane's editor holds the unsaved edit at the new path (${JSON.stringify(moved591)})`);
  expect(fs.existsSync(movedFile) && !fs.existsSync(paneFile), 'the file moved on disk');
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`${viewOf(movedFile)}.querySelector('.file-view').dataset.dirty === undefined`, 'Ctrl+S saved the moved file', 3000);
  expect(fs.readFileSync(movedFile, 'utf8').includes('R1'), `moved.txt has the edit on disk: ${JSON.stringify(fs.readFileSync(movedFile, 'utf8'))}`);
  step('M9 fix 591: a file shown in a pane follows a rail rename to its new path with its unsaved edits, and the save lands there');

  // Put the panes back: the file pane's own close button, then the
  // pane-file shell, focused by hand so Ctrl+Shift+W does not reach p1.
  await s.evalJs(`${paneFileSel}.querySelector('.files-button[title="Close pane"]').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 0`, 'the file pane closed');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneSeedPaneId)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(paneSeed)}`, 'the pane-file shell focused for closing');
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(paneSeedPaneId)}]')`, 'the pane-file shell closed too');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)}`, 'focus back on the first pane');
  step('the panes put back');

  // M9 fix 588: the rail's own folder has a menu, on its name in the
  // header and on the blank space of the list, in every view; it names
  // the lift when one is up, has no Rename and no Copy relative path and
  // leaves the keyboard where it was. An empty folder says so. A shell in
  // an empty folder of its own, on a fresh pane closed again at the end.
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelector('.files-empty')?.textContent === 'No session in this pane'`, 'a fresh empty pane for the root menu');
  await startSession(s, { kind: 'shell', cwd: emptyFolder });
  const rootMenuPaneId = (await getLayout(s)).focusedPaneId;
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(emptyFolder)}`, 'the rail follows the shell in the empty folder');
  await s.waitFor(
    `document.querySelector('.files-list .files-empty[data-empty="folder"]')?.textContent === 'Empty folder' && document.querySelectorAll('.files-list .files-row').length === 0`,
    'the empty folder says Empty folder',
    5000,
  );
  await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(rootMenuPaneId)}] .xterm-helper-textarea')`, 'the shell drawn');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(rootMenuPaneId)}] .xterm-helper-textarea').focus(); window.__ae588 = document.activeElement; true`);
  const rootLabels = 'New file,New folder,Find in folder,Open in Explorer,Reveal in Explorer,Copy path,Insert path into pane';
  const rootMenuRead = async (what, p) => {
    await s.waitFor(`document.querySelector('.files-menu')?.dataset.path === ${JSON.stringify(p)} && document.querySelector('.files-menu')?.dataset.from === 'root'`, `the folder's own menu ${what}`);
    return s.evalJs(`({ labels: [...document.querySelectorAll('.files-menu .menu-label')].map((b) => b.textContent).join(','), kept: document.activeElement === window.__ae588 })`);
  };
  const closeRootMenu = async () => {
    await s.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed');
  };
  const centreOfSel = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const blankOfList = () => s.evalJs(`(() => { const r = document.querySelector('.files-list').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.bottom - 12 }; })()`);
  // (a) The header's name.
  let at588 = await centreOfSel('.files-root');
  await s.rightClick(at588.x, at588.y);
  let read588 = await rootMenuRead('on the name', emptyFolder);
  expect(read588.labels === rootLabels && read588.kept, `the name's menu is the folder's, the keyboard left in the terminal (${JSON.stringify(read588)})`);
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Reveal in Explorer').click()`);
  const revealLine = `reveal ${emptyFolder}`;
  const revealBy = Date.now() + 3000;
  while (!(fs.existsSync(openedPaths) && fs.readFileSync(openedPaths, 'utf8').split(/\r?\n/).includes(revealLine)) && Date.now() < revealBy) await sleep(100);
  expect(fs.existsSync(openedPaths) && fs.readFileSync(openedPaths, 'utf8').split(/\r?\n/).includes(revealLine), `Reveal in Explorer was called on the folder (${fs.existsSync(openedPaths) ? JSON.stringify(fs.readFileSync(openedPaths, 'utf8')) : 'no log'})`);
  await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed by the click');
  // (b) The blank list.
  at588 = await blankOfList();
  await s.rightClick(at588.x, at588.y);
  read588 = await rootMenuRead('on the blank list', emptyFolder);
  expect(read588.labels === rootLabels && read588.kept, `the blank list's menu is the folder's, the keyboard left in the terminal (${JSON.stringify(read588)})`);
  await closeRootMenu();
  // (c) The Changed list, outside a repository.
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === 'true' && [...document.querySelectorAll('.files-list .files-empty')].some((e) => e.textContent === 'Not a git repository')`, 'the Changed list outside a repository', 8000);
  at588 = await blankOfList();
  await s.rightClick(at588.x, at588.y);
  read588 = await rootMenuRead('on the Changed list', emptyFolder);
  expect(read588.labels === rootLabels, `the Changed list's blank space gives the folder's menu (${JSON.stringify(read588)})`);
  await closeRootMenu();
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === undefined && !!document.querySelector('.files-list .files-empty[data-empty="folder"]')`, 'the tree back, still empty', 8000);
  // (d) A file in the folder: the line goes, the row keeps its own menu
  // and the blank space under it is still the folder's.
  const firstFile = path.join(emptyFolder, 'first.txt');
  fs.writeFileSync(firstFile, 'first\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(firstFile))}) && !document.querySelector('.files-list .files-empty[data-empty="folder"]')`, 'first.txt listed and the line gone', 8000);
  const firstMenu = await menuOf(firstFile);
  expect(
    firstMenu.join(',') === 'Open in a tab,Rename,Open in a pane,Open with Windows,Reveal in Explorer,Copy path,Copy relative path,Insert path into pane,Delete',
    `a row keeps its own menu: ${firstMenu.join(',')}`,
  );
  at588 = await blankOfList();
  await s.rightClick(at588.x, at588.y);
  read588 = await rootMenuRead('under the row', emptyFolder);
  expect(read588.labels === rootLabels, `the blank space under a row gives the folder's menu (${JSON.stringify(read588)})`);
  await closeRootMenu();
  // (e) The lift: the header names the parent, and so does its menu.
  await s.evalJs(`document.querySelector('.files-up').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(rootMenuParent)} && !!document.querySelector('.files-root[data-lift]')`, 'the lift on the parent', 8000);
  at588 = await centreOfSel('.files-root[data-lift]');
  await s.rightClick(at588.x, at588.y);
  read588 = await rootMenuRead('on the lift', rootMenuParent);
  expect(read588.labels === rootLabels, `the lift's name gives the parent's menu (${JSON.stringify(read588)})`);
  await closeRootMenu();
  await s.evalJs(`document.querySelector('.files-root[data-lift]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(emptyFolder)} && !document.querySelector('.files-root[data-lift]')`, 'back down to the followed folder', 8000);
  step("M9 fix 588: the folder's own menu opens on the header's name and the list's blank space, in the tree and the Changed list, names the lift when one is up, has no Rename and no Copy relative path, leaves the keyboard in the terminal, and Reveal is called; an empty folder says Empty folder and a row keeps its own menu");
  // Put the panes back as the fix 436 block expects them.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(rootMenuPaneId)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(rootMenuPaneId)}]')`, 'the root menu shell closed');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)}`, 'focus back on the first pane after the root menu');

  // M9 fix 436: the lift keeps the folder it came from in a listing the
  // cap cut. A relaunch with EMERALD_LIST_CAP at 3 (read once at the main
  // process's start) and two levels of six folders each, the followed one
  // named to sort last at each: each listing shows the first three and the
  // folder the lift came from open as a row in its sorted place, and each
  // note counts the two cut, the kept one counted out. Fix 524 adds the
  // second lift: the relist of the middle folder it sets off keeps the
  // first lift's row rather than dropping it.
  const liftShort = path.join(os.tmpdir(), 'emerald-verify', `m10-lift-${process.pid}`);
  fs.rmSync(liftShort, { recursive: true, force: true });
  for (const d of ['a1', 'a2', 'a3', 'a4', 'a5', 'zz-mid']) fs.mkdirSync(path.join(liftShort, d), { recursive: true });
  for (const d of ['b1', 'b2', 'b3', 'b4', 'b5', 'zz-followed']) fs.mkdirSync(path.join(liftShort, 'zz-mid', d), { recursive: true });
  liftParent = fs.realpathSync.native(liftShort);
  const mid524 = path.join(liftParent, 'zz-mid');
  const followed436 = path.join(mid524, 'zz-followed');
  fs.writeFileSync(path.join(followed436, 'inside.txt'), 'inside');
  killTree(s.child);
  s.close();
  // The daemon goes too: since fix 438's relaunch above the window is no
  // longer the daemon's parent, so the tree kill leaves it up with every
  // session of the run, and a fresh window attaches to it (CLAUDE.md's
  // stale-daemon trap) and follows the old focused pane.
  stopDaemon();
  await sleep(1500);
  s = await launch(s.port + 1, { freshState: true, env: { EMERALD_LIST_CAP: '3' } });
  app = s;
  // The kill took the first window's daemon; wait for the new window to
  // own its layout before touching it (the fixes 258 to 273 bullet).
  await s.waitFor(`!!document.querySelector('.tab[data-tab="panes"]') && !!document.querySelector('.empty-pane .empty-start')`, 'the relaunched window with its empty pane', 20000);
  await startSession(s, { kind: 'shell', cwd: followed436 });
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(followed436)}`, 'the rail follows the shell in the last-sorting folder', 10000);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(path.join(followed436, 'inside.txt')))})`, "the followed folder's file listed");
  const liftRows = `[...document.querySelectorAll('.files-rail .files-list .files-row, .files-rail .files-list .files-note')].map((r) => r.classList.contains('files-note') ? 'note:' + r.textContent : r.dataset.depth + ':' + r.querySelector('.files-name').textContent + (r.dataset.expanded === 'true' ? ':open' : ''))`;
  await s.evalJs(`document.querySelector('.files-up').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(mid524)}`, 'the rail lifted to the middle folder');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(path.join(followed436, 'inside.txt')))}) && !!document.querySelector('.files-note')`, "the old root's file under it and the note row", 5000);
  const lifted436 = await s.evalJs(liftRows);
  expect(lifted436.join(',') === '0:b1,0:b2,0:b3,0:zz-followed:open,1:inside.txt,note:2 more not shown', `the cut listing keeps the followed folder open in its place and counts the rest: ${lifted436.join(',')}`);
  await s.evalJs(`document.querySelector('.files-up').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(liftParent)}`, 'the rail lifted to the parent');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(path.join(followed436, 'inside.txt')))}) && document.querySelectorAll('.files-rail .files-note').length === 2`, "the first lift's file under both and two note rows", 5000);
  // Twice, the second after a Refresh: the lift's own listings keep the
  // row either way, and it was a relist of the middle folder (Refresh, a
  // watcher push, a focus change) that dropped the first lift's row, which
  // the base commit read as `1:b3,note:3 more not shown`.
  const lifted524 = [await s.evalJs(liftRows)];
  await s.evalJs(`document.querySelector('.files-rail .files-button[title="Refresh"]').click()`);
  await sleep(1000);
  lifted524.push(await s.evalJs(liftRows));
  const want524 = '0:a1,0:a2,0:a3,0:zz-mid:open,1:b1,1:b2,1:b3,1:zz-followed:open,2:inside.txt,note:2 more not shown,note:2 more not shown';
  expect(lifted524.every((r) => r.join(',') === want524), `two lifts keep both folders open among the cut rows: ${lifted524.map((r) => r.join(',')).join(' | ')}`);
  step('M9 fix 436 and 524: under a cap of 3 two lifts keep both folders they came from open among the rows, and each note counts the two the cap cut');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m10-files-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  // The shells sit in the seed and die with the daemon's console, a
  // moment after the kill; a leftover is harmless, the next run seeds anew.
  try {
    fs.rmSync(seed, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    if (liftParent !== null) fs.rmSync(liftParent, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(rootMenuParent, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(openedPaths, { force: true });
  } catch {
    // Left for the next run.
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
