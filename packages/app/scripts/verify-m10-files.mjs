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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
const { CTRL, SHIFT, emeraldHome, expect, freshPort, getLayout, getTabs, harnessClaudeHome, killTree, launch, leaves, repoRoot, setInput, sleep, startSession, startSessionByKey, step, stopDaemon, zreq } = await import('./cdp.mjs');

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
// M9 fix 1040's folder of its own, and the transcript it seeds.
let context1040 = null;
let transcript1040 = null;
// M9 fix 1056: the outside transcript, under os.tmpdir() beside the harness.
let transcript1056 = null;
// M9 fix 1102, on the poll since M9 fix 1125: the stand-in mod channel's abort.
let abort1102 = null;
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
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(seed)}`, 'focus back on pane 1 restores its tree');
  expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data', 'two.json')))})`), 'and data is still expanded');
  step('focus moves the tree between panes and keeps what was expanded');

  // The rail watches exactly the open set, so with pane 2 focused the seed
  // is not watched and a write there is missed; the click back on pane 1
  // re-lists the folder it shows again (its old listing was kept), and the
  // new file is there without Refresh. Then a synthetic window focus, the
  // other moment the rail re-lists, with the tree left as it is; a covered
  // harness window never gets the real one.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(other)}`, 'pane 2 focused, its tree shown');
  fs.writeFileSync(path.join(seed, 'late.txt'), 'late');
  await sleep(1200);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
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
  // M9 fix 885: Statistics is offered on every folder row, not the root's alone.
  expect(folderLabels[folderLabels.indexOf('Find in folder') + 1] === 'Statistics in a tab', `a folder row offers Statistics in a tab after Find in folder (fix 885): ${folderLabels.join(',')}`);
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
  // M9 fix 952: a click on data gives the tree the keyboard; hiding the rail
  // with it there hands it on.
  const treeKeys952 = `document.activeElement === document.querySelector('.files-list')`;
  await clickRow(s, path.join(seed, 'data'));
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data')))})?.dataset.expanded === 'true' && ${treeKeys952}`, 'a click on data opens it and gives the tree the keyboard', 3000);
  await clickRow(s, path.join(seed, 'data'));
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(path.join(seed, 'data')))})?.dataset.expanded === undefined && ${treeKeys952}`, 'a second click folds data, the tree keeping the keyboard', 3000);
  await s.key('F', 'KeyF', 70, CTRL | SHIFT);
  await s.waitFor(`!!document.querySelector('.files-rail-collapsed') && !document.querySelector('.files-rail')`, 'Ctrl+Shift+F hides the rail');
  await s.waitFor(`document.activeElement === document.querySelector('.pane.focused .xterm-helper-textarea')`, 'Ctrl+Shift+F with the keyboard on the tree gives it to the focused terminal (fix 952)', 3000);
  await s.evalJs(`document.querySelector('.files-expand').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail')`, 'the thin rail brings it back');
  const hide952 = path.join(seed, 'hide952.txt');
  fs.writeFileSync(hide952, 'hide\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(hide952))})`, 'hide952.txt listed', 5000);
  await clickRow(s, hide952);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(hide952)} && !!document.querySelector('.file-editor')?.emeraldEditor?.getModel() && ${treeKeys952}`, 'hide952.txt previewed, the tree keeping the keyboard', 5000);
  await s.evalJs(`document.querySelector('.files-collapse').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail-collapsed')`, 'the header button hides it');
  await s.waitFor(`!!document.activeElement?.closest('.monaco-editor')`, "the header's hide button with the keyboard on the tree gives it to the file tab in front (fix 952)", 3000);
  await s.evalJs(`document.querySelector('.files-rail-label').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail')`, 'the label brings it back');
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'hide952.txt closed', 3000);
  fs.rmSync(hide952, { force: true });
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(hide952))})`, 'hide952.txt gone', 5000);
  const edge = await s.evalJs(`(() => { const r = document.querySelector('.files-resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 100 }; })()`);
  await s.mouse('mousePressed', edge.x, edge.y);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: edge.x - 80, y: edge.y, button: 'left', buttons: 1 });
  await s.mouse('mouseReleased', edge.x - 80, edge.y);
  const width = await s.evalJs(`document.querySelector('.files-rail').getBoundingClientRect().width`);
  expect(Math.abs(width - 410) <= 2, `dragging the edge 80 px left widens the rail from its 330 default (fix 885) to 410 (${width})`);
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
  expect(Math.abs(after - 410) <= 2, `the width survives a reload (${after})`);
  expect((await s.evalJs(`document.querySelector('.files-mode[data-mode="contents"]').dataset.active`)) === 'true', 'Contents survives the reload');
  expect((await s.evalJs(`document.querySelector('.files-scope-name')?.textContent`)) === 'in data', 'and so does the scope');
  await s.evalJs(`document.querySelector('.files-scope-clear').click()`);
  await s.evalJs(`document.querySelector('.files-mode[data-mode="names"]').click()`);
  await s.waitFor(`!document.querySelector('.files-scope') && document.querySelector('.files-mode[data-mode="names"]').dataset.active === 'true'`, 'back to names, no scope');
  step('collapse all, the key, the thin rail, and the width, the mode and the scope across a reload; hiding the rail with the keyboard on the tree gives it to the terminal, or to the file tab in front (fix 952)');

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
  // tree's changed rows carry their counts, the untracked one too since
  // fix 965, and the Changed toggle lists the four flat, by path from the root,
  // where a click opens the file; the toggle survives a reload.
  // Since fix 965 the count is the Changed list's length, off its own poll
  // (the untracked counts add two gits to it), so it can land a poll after
  // the tree's letters above.
  const filesCount = `document.querySelector('.rail-tab[data-tab="files"] .rail-tab-count')?.textContent`;
  await s.waitFor(`${filesCount} === '4'`, 'the Files tab counts the four changed files', 8000).catch(() => {});
  const filesCount4 = await s.evalJs(filesCount);
  expect(filesCount4 === '4', `the Files tab counts the four changed files: ${filesCount4}`);
  expect((await s.evalJs(`document.querySelectorAll('.rail-tab').length`)) === 5, 'five rail tabs');
  const countsOf = (n) => `(document.querySelector('.files-row[data-path=' + JSON.stringify(${JSON.stringify(repo + '\\')} + ${JSON.stringify(n)}) + ']')?.querySelector('.changes-counts')?.textContent ?? null)`;
  await s.waitFor(`${countsOf('added.txt')} === '+1 −0' && ${countsOf('staged.txt')} === '+1 −1' && ${countsOf('tracked.txt')} === '+1 −1'`, 'the counts on the changed rows', 8000);
  expect((await s.evalJs(countsOf('new.txt'))) === '+1 −0', 'the untracked row carries its line count (M9 fix 965)');
  expect((await s.evalJs(countsOf('sub'))) === null, 'a folder row has no counts');
  expect((await s.evalJs(`document.querySelector('.files-rail').dataset.changed`)) === undefined, 'the tree shows by default');
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === 'true' && document.querySelectorAll('.files-changed-row').length === 4`, 'the Changed list', 8000);
  // Fix 492: a poll whose status ran before the git add above and whose
  // numstat ran after it is corrected by the next poll (the stamp carries the
  // status code now), so the read waits a poll and a half for the right list.
  const changeRowsRead = `[...document.querySelectorAll('.files-changed-row')].map(r => r.querySelector('.git-letter').textContent + '|' + r.querySelector('.files-name').textContent + '|' + (r.querySelector('.changes-counts')?.textContent ?? '') + '|' + r.dataset.git).join(';')`;
  const changeRowsWant = 'A|added.txt|+1 −0|staged;|new.txt|+1 −0|untracked;M|staged.txt|+1 −1|modified;M|tracked.txt|+1 −1|staged';
  await s.waitFor(`${changeRowsRead} === ${JSON.stringify(changeRowsWant)}`, 'the list by path with the letter, the counts and the status', 8000).catch(() => {});
  const changeRows = await s.evalJs(changeRowsRead);
  expect(
    changeRows === changeRowsWant,
    `the list by path with the letter, the counts and the status: ${changeRows}`,
  );
  // M9 fix 965: a new folder's files are rows of their own in the Changed
  // list, each with its count, where the status named the folder once with
  // none. The folder goes again before the four-row reads below.
  fs.mkdirSync(path.join(repo, 'fresh'));
  fs.writeFileSync(path.join(repo, 'fresh', 'one.txt'), 'one\n');
  fs.writeFileSync(path.join(repo, 'fresh', 'two.txt'), 'two\nlines\n');
  const freshRead = `[...document.querySelectorAll('.files-changed-row')].filter(r => r.querySelector('.files-name').textContent.startsWith('fresh')).map(r => r.querySelector('.files-name').textContent + '|' + (r.querySelector('.changes-counts')?.textContent ?? '') + '|' + r.dataset.git).join(';')`;
  const freshWant = 'fresh/one.txt|+1 −0|untracked;fresh/two.txt|+2 −0|untracked';
  await s.waitFor(`${freshRead} === ${JSON.stringify(freshWant)}`, "the new folder's files one row each", 8000).catch(() => {});
  const freshRows = await s.evalJs(freshRead);
  expect(freshRows === freshWant, `the new folder's files one row each with their counts: ${freshRows}`);
  const freshCount = await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"] .rail-tab-count')?.textContent`);
  expect(freshCount === '6', `the Files tab counts the new folder's two files one each (M9 fix 965): ${freshCount}`);
  fs.rmSync(path.join(repo, 'fresh'), { recursive: true, force: true });
  await s.waitFor(`document.querySelectorAll('.files-changed-row').length === 4`, 'the four rows back once the folder is gone', 8000);
  step("M9 fix 965: a new folder's files are rows of their own in the Changed list, each with its count");
  // M9 fix 984: a repository of its own under the root is one row drawn as
  // a folder reading `repository`, counted once, and a click opens its own
  // review. It goes again before the four-row reads below.
  const nestRepo = path.join(repo, 'nestrepo');
  fs.mkdirSync(nestRepo);
  execFileSync('git', ['init', '-q'], { cwd: nestRepo, stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync(path.join(nestRepo, 'n.txt'), 'n\n');
  await s.waitFor(`document.querySelectorAll('.files-changed-row').length === 5`, 'the nested repository as the fifth Changed row', 8000);
  const nestRow = await s.evalJs(
    `(() => { const r = document.querySelector(${JSON.stringify(rowSel(nestRepo))}); return { kind: r?.dataset.kind ?? null, repo: r?.dataset.repo ?? null, mark: r?.querySelector('.files-changed-repo')?.textContent ?? null, counts: !!r?.querySelector('.changes-counts'), icon: ${iconOf(nestRepo)}, count: document.querySelector('.rail-tab[data-tab="files"] .rail-tab-count')?.textContent ?? null }; })()`,
  );
  expect(
    nestRow.kind === 'dir' && nestRow.repo === 'true' && nestRow.mark === 'repository' && !nestRow.counts && nestRow.icon === 'folder' && nestRow.count === '5',
    `the nested repository is a folder row reading repository, no counts, counted once: ${JSON.stringify(nestRow)}`,
  );
  await clickRow(s, nestRepo);
  const nestReview = JSON.stringify(`.review-tab[data-folder=${JSON.stringify(nestRepo)}]`);
  await s.waitFor(
    `!!document.querySelector(${nestReview}) && document.querySelector('.tab-file[data-active] .tab-name')?.textContent === 'Review · nestrepo' && !document.querySelector('.tab-file[data-preview]')`,
    'the click opened the nested repository\'s own review, no preview tab',
    8000,
  );
  await s.evalJs(`document.querySelector('.tab[data-active] .tab-close')?.click()`);
  // Node 24 does not retry EPERM on Windows, and the review's git read or
  // the watch may still hold the folder a moment after the tab closes.
  for (let tries = 0; ; tries++) {
    try {
      fs.rmSync(nestRepo, { recursive: true, force: true });
      break;
    } catch (err) {
      if (tries >= 20) throw err;
      await sleep(300);
    }
  }
  await s.waitFor(
    `document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)} && document.querySelectorAll('.files-changed-row').length === 4`,
    'the rail back on repo with four Changed rows once the repository is gone',
    8000,
  );
  step('M9 fix 984: a nested repository is one Changed row with a folder icon reading repository, counted once, and a click opens its own review');
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
  // new.txt. The count is on the Changed list's poll (M9 fix 965), a
  // separate timer from the panel's, so it can be a poll behind the log.
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
    await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
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
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSelOf(c6))})?.dataset.owner === 'none' && document.querySelector(${JSON.stringify(nodeSel(c6))}) !== null`, 'the foreign trailer commit lands, its row nobody\'s', 8000);
  const outsideGroupSel = '.commits-lane-group[data-outside]';
  // M9 fix 945: c6 by hand on main lies above the start commit of the live
  // sessions here, so it draws as the earliest started one's square, in
  // that session's group, while its row and the outside card still count
  // it as nobody's.
  const c6Node = await s.evalJs(`(() => { const n = document.querySelector(${JSON.stringify(nodeSel(c6))}); return { tag: n.tagName, foreign: 'foreign' in n.dataset, outsideGroup: n.closest('.commits-lane-group')?.hasAttribute('data-outside') ?? null, session: n.dataset.session ?? null }; })()`);
  expect(c6Node.tag === 'rect' && c6Node.foreign && c6Node.outsideGroup === false && c6Node.session !== null, `the node is a square in a live session's group (${JSON.stringify(c6Node)})`);
  // The kind is the card's By line (M73 task 4), once the row's tooltip.
  const kinds = { seed: await rowBy(seedHash), foreign: await rowBy(c6) };
  expect(kinds.seed === 'made outside emerald, no trailer' && kinds.foreign === 'made outside emerald, its trailer naming a conversation this daemon never held', `the row cards say which kind (${JSON.stringify(kinds)})`);
  // The outside card opens on the seed commit, below every session's
  // start and so still a grey node in the outside block.
  const outsideAt = await hoverOver(nodeSel(seedHash));
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
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(rover590Pane)}]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  for (let i = 0; i < 50 && (await getLayout(s)).focusedPaneId !== rover590Pane; i++) await sleep(100);
  expect((await getLayout(s)).focusedPaneId === rover590Pane, 'the rover pane focused for closing');
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === ${panes590}`, 'the rover pane closed', 5000);
  await p1Focus();
  step('M9 fix 590: a shell spawned in a folder with no repository, back home from a repository, shows its own folder on the graph as the strip does, Not a git repository with it, while fix 114 keeps the repository for a bound session that steps out');

  // The strip at a narrow rail (three tabs since fix 70, every one with
  // an icon since M49, the third word Sessions since fix 83, a fourth,
  // Stats, since fix 885, a fifth, Context, since fix 1037): every word
  // from W5 (the first rail-tabs query's width plus one, plus the strip's
  // 12px of padding), only the active tab's word a pixel under it, every
  // tab an icon a pixel under W1 (the second query's), the strip still
  // fitting at 160px. The two numbers are read off the built rules, so a
  // remeasure of the fit rule moves this block with it.
  const stripAt = async (w) => {
    await s.evalJs(`document.querySelector('.files-rail').style.width = '${w}px'`);
    await sleep(120);
    return s.evalJs(`[...document.querySelectorAll('.rail-tab')].map(t => { const label = t.querySelector('.rail-tab-label'); const icon = t.querySelector('.files-icon'); return t.dataset.tab + '=' + (getComputedStyle(label).display !== 'none' ? 'w' : '') + (getComputedStyle(icon).display !== 'none' ? 'i' : ''); }).join(',') + ' ' + (document.querySelector('.rail-tabs').scrollWidth <= document.querySelector('.rail-tabs').clientWidth ? 'fits' : 'overflows')`);
  };
  const stripRules1037 = await s.evalJs(
    `(() => { const out = []; for (const sheet of document.styleSheets) { let rules; try { rules = sheet.cssRules; } catch { continue; } for (const r of rules) if (r instanceof CSSContainerRule && r.containerName === 'rail-tabs') { const m = /max-width:\\s*([\\d.]+)px/.exec(r.containerQuery); if (m) out.push(Number(m[1])); } } return out.sort((a, b) => b - a); })()`,
  );
  expect(stripRules1037.length === 2, `the strip has its two fit queries (fix 1037), got ${JSON.stringify(stripRules1037)}`);
  const w5Rail = stripRules1037[0] + 1 + 12;
  const w1Rail = stripRules1037[1] + 1 + 12;
  const tabKeys = ['files', 'timeline', 'history', 'stats', 'context'];
  const activeTab1037 = await s.evalJs(`document.querySelector('.rail-tab[data-active]')?.dataset.tab ?? null`);
  const stripWant = (worded) => tabKeys.map((k) => `${k}=${worded === 'all' || (worded === 'active' && k === activeTab1037) ? 'wi' : 'i'}`).join(',') + ' fits';
  const wide = await stripAt(w5Rail + 10);
  expect(wide === stripWant('all'), `at ${w5Rail + 10}px the five words show with their icons (${wide})`);
  const wideEdge = await stripAt(w5Rail);
  expect(wideEdge === stripWant('all'), `and still at ${w5Rail}px, the break (${wideEdge})`);
  const under5 = await stripAt(w5Rail - 1);
  expect(under5 === stripWant('active'), `at ${w5Rail - 1}px only the active tab (${activeTab1037}) keeps its word (${under5})`);
  const at1 = await stripAt(w1Rail);
  expect(at1 === stripWant('active'), `and still at ${w1Rail}px (${at1})`);
  const under1 = await stripAt(w1Rail - 1);
  expect(under1 === stripWant('none'), `at ${w1Rail - 1}px every tab is an icon (${under1})`);
  const least = await stripAt(160);
  expect(least === stripWant('none'), `and the strip still fits at 160px (${least})`);
  await s.evalJs(`document.querySelector('.files-rail').style.width = ''`);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'files'`, 'back on Files');
  await s.screenshot('m45-rail.png');
  step(`the tab strip keeps its five words from ${w5Rail}px, the active tab's word alone under it and every tab an icon under ${w1Rail}, fitting at 160px (fix 1037)`);

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
    await s.evalJs(`${editorJs}.focus()`);
    // Focus again on every poll: the row click gives the tree the keyboard
    // (fix 929) and a late pull back to it is answered, not timed out, as fix
    // 985 does for fix 574's step.
    await s.waitFor(`(${editorJs}.focus(), !!document.activeElement?.closest('.monaco-editor'))`, 'the keyboard in the editor', 3000);
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
  // the scheme section last, and the list past the shipped eight is the
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
  expect(editorMenu.schemes !== null && editorMenu.schemes.startsWith('Colour scheme,emerald,emerald gem,emerald light,emerald gem light,Dracula,One Dark,Solarized Dark,Tokyo Night'), `the scheme section closes the menu with the shipped eight, none checked (${editorMenu.schemes})`);
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
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(findMd)} && document.querySelector('.file-view')?.dataset.view === 'rendered' && !!document.querySelector('.markdown-view') && document.activeElement === document.querySelector('.files-list')`, 'find.md open rendered, the tree keeping the keyboard', 5000);
  await s.evalJs(`document.querySelector('.markdown-view').focus()`);
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
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(runsMd)} && document.querySelector('.file-view')?.dataset.view === 'rendered' && !!document.querySelector('.markdown-view') && document.activeElement === document.querySelector('.files-list')`, 'find-runs.md open rendered, the tree keeping the keyboard', 5000);
  await s.evalJs(`document.querySelector('.markdown-view').focus()`);
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
  const prettyRead = () => s.evalJs(`(() => { const v = document.querySelector('.file-view'); const e = ${editorJs}; const m = e?.getModel() ?? null; return { path: v?.dataset.path ?? null, view: v?.dataset.view ?? null, pretty: v?.dataset.pretty ?? null, dirty: v?.dataset.dirty ?? null, lines: m ? m.getLineCount() : null, scheme: m ? m.uri.scheme : null, readOnly: e ? e.getRawOptions().readOnly : null, message: e ? (e.getRawOptions().readOnlyMessage?.value ?? null) : null, text: m ? m.getValue(1) : null, tabSize: m ? m.getOptions().tabSize : null, format: !!v?.querySelector('.file-format'), switch: [...(v?.querySelectorAll('.file-view-switch button') ?? [])].map((b) => b.textContent.trim()).join(','), notice: v?.querySelector('.file-notice[data-kind="json"]')?.textContent ?? null }; })()`);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.path === ${JSON.stringify(prettyFile)} && v?.dataset.view === 'pretty' && v?.dataset.pretty === 'ok' && !!m && m.getLineCount() > 1; })()`, 'pretty.json open on its Pretty view, formatted', 15000);
  const prettyOpen = await prettyRead();
  expect(prettyOpen.readOnly === true && prettyOpen.scheme === 'emerald-pretty' && prettyOpen.switch === 'Pretty,Raw' && !prettyOpen.format, `the Pretty view is read-only on the derived model, the switch reads Pretty | Raw and no Format button (${JSON.stringify(prettyOpen)})`);
  expect(prettyOpen.text.split('\n')[1] === '  "a": 1,' && prettyOpen.tabSize === 2, `a one-line file formats two-space (${JSON.stringify(prettyOpen.text)})`);
  await s.screenshot('m9-339-pretty.png');
  // M9 fix 851: a key typed on Pretty says to switch to Raw, in the
  // editor's own message widget (an overflow widget, so read off the whole
  // document), and the Pretty text stays as it was.
  const overlayText = `(document.querySelector('.monaco-editor-overlaymessage')?.textContent ?? '')`;
  await s.evalJs(`${editorJs}.focus()`);
  await s.waitFor(`!!document.activeElement?.closest('.monaco-editor')`, 'fix 851: the Pretty editor has the keyboard', 3000);
  await s.type('x');
  await s.waitFor(`${overlayText}.includes('Switch to Raw')`, 'fix 851: a key typed on Pretty shows the switch-to-Raw message', 3000);
  expect(prettyOpen.message === 'Pretty is a formatted copy and does not take edits. Switch to Raw to edit the file.', `fix 851: the Pretty editor's read-only message is the sentence (${JSON.stringify(prettyOpen.message)})`);
  expect((await prettyRead()).text === prettyOpen.text, 'fix 851: the key typed on Pretty changed nothing');
  console.log('fix 851 Pretty message', JSON.stringify(await s.evalJs(overlayText)));
  await s.screenshot('m9-851-pretty-message.png');
  await s.evalJs(`document.querySelector('.file-view-switch [data-view="raw"]').click()`);
  await s.waitFor(`(() => { const v = document.querySelector('.file-view'); const m = ${editorJs}?.getModel(); return v?.dataset.view === 'raw' && !!m && m.uri.scheme === 'file' && m.getLineCount() === 1; })()`, 'Raw is the file, one line', 5000);
  const rawOpen = await prettyRead();
  expect(rawOpen.readOnly === false && rawOpen.format && rawOpen.pretty === null, `the Raw editor takes edits and has the Format button (${JSON.stringify(rawOpen)})`);
  // M9 fix 851: on Raw the message is gone (the model change closed it)
  // and a typed key lands; one undo puts the file back for the Format read.
  await s.waitFor(`!document.querySelector('.monaco-editor-overlaymessage')`, 'fix 851: the read-only message closes on the switch to Raw', 3000);
  await s.type('x');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true' && !document.querySelector('.monaco-editor-overlaymessage')`, 'fix 851: a key typed on Raw lands, with no message', 3000);
  await s.evalJs(`${editorJs}.trigger('verify', 'undo', null)`);
  await s.waitFor(`${editorJs}.getModel().getLineCount() === 1 && document.querySelector('.file-view')?.dataset.dirty === undefined`, 'fix 851: one undo takes the typed key back, clean', 5000);
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
  step('M9 fix 339: a .json file opens in a read-only Pretty view formatted in its own indent, Raw has a Format button that formats in place as one undo step, a Raw edit shows in Pretty, and a file that does not parse shows the Raw editor under a notice, a key typed on Pretty says to switch to Raw and one typed on Raw lands');

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
  // The row click gives the tree the keyboard since fix 929 and the file
  // view's model effect defers to it, so wait for the tree to hold it with
  // the model in before moving it, and focus again on every poll so a late
  // pull back to the tree is answered, not timed out (M9 fix 985).
  await s.waitFor(
    `${treeHasKeys} && document.querySelector('.file-view')?.dataset.state === 'text' && ${editorJs}.getModel()?.uri.path.endsWith('/ren-a.txt') === true`,
    'ren-a.txt open in a tab with the tree holding the keyboard',
    5000,
  );
  await s.waitFor(`(${editorJs}.focus(), !!document.activeElement?.closest('.monaco-editor'))`, 'the keyboard in the editor', 3000);
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
  // (6) A plain folder click selects the folder and gives the tree the keyboard (M9 fix 929; fix 574 read the opposite).
  await s.evalJs('document.querySelector(".pane.focused .xterm-helper-textarea").focus(); window.__ae574 = document.activeElement; true');
  await clickRow(s, renDir);
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(renDir))})?.dataset.expanded === 'true'`, 'ren-dir expanded');
  const plain = await s.evalJs(`({ tree: ${treeHasKeys}, selected: document.querySelector(${JSON.stringify(rowSel(renDir))}).dataset.selected ?? null })`);
  expect(plain.tree && plain.selected === 'true', `a plain click on a folder row expands it, selects it and gives the tree the keyboard, the reverse of fix 574's read (${JSON.stringify(plain)})`);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(innerFile))})`, 'inner.txt listed', 5000);
  await clickRow(s, innerFile);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(innerFile)}`, 'inner.txt open in a tab', 5000);
  await s.waitFor(`${editorJs}.getModel()?.uri.path.endsWith('/ren-dir/inner.txt') === true`, 'inner.txt in the editor', 5000);
  await s.evalJs(`${editorJs}.focus()`);
  await s.waitFor(`(${editorJs}.focus(), !!document.activeElement?.closest('.monaco-editor'))`, 'the keyboard in the editor before the right-click', 3000);
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
  step("M9 fix 574: Rename on a file's menu renames in place with the stem selected and a dirty tab follows and keeps its edits, the save landing at the new path; F2 after a second click on a file and after a right-click on a folder renames too, a taken name is refused with the box kept, a plain folder click selects it and gives the tree the keyboard (fix 929), and the open folder, its selection and the tab under it follow");

  // M9 fix 929: the Files tree takes the keyboard on a click, as VS Code's
  // explorer does. A folder click selects the folder and gives the tree the
  // keyboard; a file click previews the file with the tree keeping it; F2
  // then renames; the arrows, Home and End walk the rows and open nothing;
  // Enter pins the file and hands the keyboard to its editor. The selected
  // row draws its ring only while the tree holds the keyboard.
  const keysDir = path.join(repo, 'keys929');
  const keysSub = path.join(keysDir, 'sub929');
  const keysC = path.join(keysSub, 'c929.txt');
  const keysA = path.join(keysDir, 'a929.txt');
  const keysB = path.join(keysDir, 'b929.txt');
  fs.mkdirSync(keysSub, { recursive: true });
  fs.writeFileSync(keysC, 'c\n');
  fs.writeFileSync(keysA, 'a\n');
  fs.writeFileSync(keysB, 'b\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(keysDir))})`, 'keys929 listed', 5000);
  const selJs = `(document.querySelector('.files-list .files-row[data-selected]')?.dataset.path ?? null)`;
  const ringJs = `(() => { const r = document.querySelector('.files-list .files-row[data-selected]'); return r ? getComputedStyle(r).outlineStyle : null; })()`;
  const keysTab = (p) => `document.querySelector(${JSON.stringify(`.tab-file[data-tab=${JSON.stringify(p)}]`)})`;
  const walkTo = async (key, code, keyCode, want, what) => {
    await s.key(key, code, keyCode);
    await s.waitFor(`${selJs} === ${JSON.stringify(want)} && ${treeHasKeys}`, what, 3000);
  };
  // (1) A folder click.
  await clickRow(s, keysDir);
  await s.waitFor(
    `(() => { const r = document.querySelector(${JSON.stringify(rowSel(keysDir))}); return r?.dataset.expanded === 'true' && r?.dataset.selected === 'true' && ${treeHasKeys}; })()`,
    'a folder click opens it, selects it and gives the tree the keyboard (fix 574 read the opposite)',
    3000,
  );
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(keysA))}) && !!document.querySelector(${JSON.stringify(rowSel(keysSub))})`, "keys929's rows listed", 5000);
  // (2) A first click on a file previews it and the tree keeps the keyboard.
  await clickRow(s, keysA);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(keysA)} && ${editorJs}.getModel()?.uri.path.endsWith('/a929.txt') === true`, 'a929.txt in the editor', 5000);
  // The read lands after the wait, so a late focus would show.
  await sleep(300);
  const firstClick = await s.evalJs(`({ tree: ${treeHasKeys}, preview: ${keysTab(keysA)}?.dataset.preview !== undefined, selected: ${selJs}, ring: ${ringJs} })`);
  expect(
    firstClick.tree && firstClick.preview && firstClick.selected === keysA && firstClick.ring === 'solid',
    `a first click on a file previews it, the tree keeps the keyboard and its row draws the ring (${JSON.stringify(firstClick)})`,
  );
  // (3) F2 after a first click renames.
  await s.key('F2', 'F2', 113);
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(renSel(keysA) + ' .files-rename')})`, 'F2 after a first click opens the rename box', 3000);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.files-renaming') && ${treeHasKeys}`, 'Escape drops the box and the tree keeps the keyboard', 3000);
  // (4) The walk.
  await walkTo('ArrowUp', 'ArrowUp', 38, keysSub, 'ArrowUp to sub929');
  await s.key('ArrowRight', 'ArrowRight', 39);
  await s.waitFor(
    `!!document.querySelector(${JSON.stringify(rowSel(keysC))}) && document.querySelector(${JSON.stringify(rowSel(keysSub))})?.dataset.expanded === 'true' && ${selJs} === ${JSON.stringify(keysSub)} && ${treeHasKeys}`,
    'ArrowRight opens sub929 in place',
    5000,
  );
  await walkTo('ArrowRight', 'ArrowRight', 39, keysC, 'ArrowRight again steps into c929.txt');
  await walkTo('ArrowLeft', 'ArrowLeft', 37, keysSub, 'ArrowLeft on a file goes to its parent');
  await s.key('ArrowLeft', 'ArrowLeft', 37);
  await s.waitFor(
    `document.querySelector(${JSON.stringify(rowSel(keysSub))})?.dataset.expanded === undefined && ${selJs} === ${JSON.stringify(keysSub)} && ${treeHasKeys}`,
    'ArrowLeft on an open folder folds it in place',
    3000,
  );
  await walkTo('ArrowLeft', 'ArrowLeft', 37, keysDir, 'ArrowLeft on a closed folder goes to its parent');
  await walkTo('ArrowDown', 'ArrowDown', 40, keysSub, 'ArrowDown to sub929');
  await walkTo('ArrowDown', 'ArrowDown', 40, keysA, 'ArrowDown to a929.txt');
  await walkTo('ArrowDown', 'ArrowDown', 40, keysB, 'ArrowDown to b929.txt');
  await s.key('End', 'End', 35);
  await s.waitFor(`${selJs} === [...document.querySelectorAll('.files-list > .files-row')].at(-1).dataset.path && ${treeHasKeys}`, 'End selects the last row', 3000);
  const endRow = await s.evalJs(
    `(() => { const r = [...document.querySelectorAll('.files-list > .files-row')].at(-1).getBoundingClientRect(); const l = document.querySelector('.files-list').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, listTop: l.top, listBottom: l.bottom }; })()`,
  );
  expect(endRow.top >= endRow.listTop - 1 && endRow.bottom <= endRow.listBottom + 1, `the last row is scrolled into the list (${JSON.stringify(endRow)})`);
  await s.key('Home', 'Home', 36);
  await s.waitFor(`${selJs} === document.querySelector('.files-list > .files-row').dataset.path && ${treeHasKeys}`, 'Home selects the first row', 3000);
  expect(
    (await s.evalJs(`document.querySelector('.tab-strip')?.dataset.activeTab`)) === keysA,
    `the walk opened nothing (${await s.evalJs(`document.querySelector('.tab-strip')?.dataset.activeTab`)})`,
  );
  // (5) Enter pins the file and hands the keyboard to its editor.
  await clickRow(s, keysB);
  await s.waitFor(
    `document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(keysB)} && ${editorJs}.getModel()?.uri.path.endsWith('/b929.txt') === true && ${treeHasKeys} && ${keysTab(keysB)}?.dataset.preview !== undefined`,
    'b929.txt previewed in the tab a929.txt had, the tree keeping the keyboard',
    5000,
  );
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(
    `!!document.activeElement?.closest('.monaco-editor') && ${editorJs}.getModel().uri.path.endsWith('/b929.txt') && !!${keysTab(keysB)} && ${keysTab(keysB)}.dataset.preview === undefined`,
    'Enter pins b929.txt and hands the keyboard to its editor',
    3000,
  );
  const afterEnter = await s.evalJs(`({ text: ${editorJs}.getModel().getValue(), ring: ${ringJs} })`);
  expect(afterEnter.text === 'b\n' && afterEnter.ring === 'none', `Enter typed nothing into the file and the ring went with the keyboard (${JSON.stringify(afterEnter)})`);
  step('M9 fix 929: a click on a folder or a file gives the Files tree the keyboard and selects the row, a file previewing with the tree keeping it and its row ringed; F2 after a first click renames; Up, Down, Left, Right, Home and End walk, open, fold and go to the parent, opening nothing; Enter pins the file and hands the keyboard to its editor');
  // M9 fix 930: F2 with the editor holding the keyboard renames the file
  // from the rail, its folders opened for it. The collapse is a .click(),
  // so the editor keeps the keyboard.
  await s.evalJs(`document.querySelector('.files-button[title="Collapse all folders"]').click()`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(keysB))})`, 'b929.txt folded away', 3000);
  expect(await s.evalJs(`!!document.activeElement?.closest('.monaco-editor')`), 'the editor holds the keyboard before F2');
  await s.key('F2', 'F2', 113);
  await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(renSel(keysB) + ' .files-rename')})`, 'F2 in the editor opens the rail\'s rename box on b929.txt, keys929 opened for it', 5000);
  const renF2 = await renRead(keysB);
  expect(renF2.value === 'b929.txt' && renF2.start === 0 && renF2.end === 4, `the box holds b929.txt with the stem selected (${JSON.stringify(renF2)})`);
  expect((await s.evalJs(`${editorJs}.getModel().getValue()`)) === 'b\n', 'F2 typed nothing into the file');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.files-renaming') && ${treeHasKeys}`, 'Escape drops the box and gives the tree the keyboard', 3000);
  step("M9 fix 930: F2 in a file's editor opens the Files rail's rename box on that file, its folders opened for it, and Escape gives the keyboard to the tree");
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'Ctrl+W back to the panes after the tree keys');
  fs.rmSync(keysDir, { recursive: true, force: true });
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(keysDir))})`, 'the keys fixture gone from the tree', 5000);

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
  await s.evalJs(`${editorJs}.focus()`);
  // Focus again on every poll: the row click gives the tree the keyboard
  // (fix 929) and a late pull back to it is answered, not timed out, as fix
  // 985 does for fix 574's step.
  await s.waitFor(`(${editorJs}.focus(), !!document.activeElement?.closest('.monaco-editor'))`, 'the keyboard in the editor', 3000);
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
  // M9 fix 950: Space and Delete on the tree. The state fix 617's deletes
  // leave: the panes tab in front with the keyboard in the terminal.
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes' && document.querySelectorAll('.tab-file').length === 0`, "fix 617's deletes leave no file tab", 5000);
  const keysDir950 = path.join(repo, 'keys950');
  const sub950 = path.join(keysDir950, 'sub950');
  const inner950 = path.join(sub950, 'inner950.txt');
  const banana950 = path.join(keysDir950, 'banana950.txt');
  const plum950 = path.join(keysDir950, 'plum950.txt');
  const qmark950 = path.join(keysDir950, 'qmark950.txt');
  const qmore950 = path.join(keysDir950, 'qmore950.txt');
  fs.mkdirSync(sub950, { recursive: true });
  fs.writeFileSync(inner950, 'i\n');
  fs.writeFileSync(banana950, 'banana\n');
  fs.writeFileSync(plum950, 'plum\n');
  fs.writeFileSync(qmark950, 'q\n');
  fs.writeFileSync(qmore950, 'q\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(keysDir950))})`, 'keys950 listed', 5000);
  // (1) A click on the folder opens it and gives the tree the keyboard.
  await clickRow(s, keysDir950);
  await s.waitFor(
    `(() => { const r = document.querySelector(${JSON.stringify(rowSel(keysDir950))}); return r?.dataset.expanded === 'true' && r?.dataset.selected === 'true' && ${treeHasKeys}; })()`,
    'a click on keys950 opens it, selects it and gives the tree the keyboard',
    3000,
  );
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(sub950))}) && !!document.querySelector(${JSON.stringify(rowSel(banana950))})`, "keys950's rows listed", 5000);
  // (2) Space on a folder.
  await walkTo('ArrowDown', 'ArrowDown', 40, sub950, 'ArrowDown to sub950');
  await s.key(' ', 'Space', 32);
  await s.waitFor(
    `!!document.querySelector(${JSON.stringify(rowSel(inner950))}) && document.querySelector(${JSON.stringify(rowSel(sub950))})?.dataset.expanded === 'true' && ${selJs} === ${JSON.stringify(sub950)} && ${treeHasKeys}`,
    'Space opens sub950 in place',
    5000,
  );
  await s.key(' ', 'Space', 32);
  await s.waitFor(
    `document.querySelector(${JSON.stringify(rowSel(sub950))})?.dataset.expanded === undefined && ${selJs} === ${JSON.stringify(sub950)} && ${treeHasKeys}`,
    'Space again folds it',
    3000,
  );
  // (3) Space on a file previews it and the tree keeps the keyboard.
  await walkTo('ArrowDown', 'ArrowDown', 40, banana950, 'ArrowDown to banana950.txt');
  await s.key(' ', 'Space', 32);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(banana950)} && ${editorJs}.getModel()?.uri.path.endsWith('/banana950.txt') === true`, 'banana950.txt in the editor', 5000);
  await sleep(300);
  const space950 = await s.evalJs(`({ tree: ${treeHasKeys}, preview: ${keysTab(banana950)}?.dataset.preview !== undefined, selected: ${selJs} })`);
  expect(space950.tree && space950.preview && space950.selected === banana950, `Space on a file previews it and the tree keeps the keyboard (${JSON.stringify(space950)})`);
  // (4) Delete moves it at once, with a note, and the tree keeps the keyboard.
  await s.key('Delete', 'Delete', 46);
  await s.waitFor(
    `!document.querySelector(${JSON.stringify(rowSel(banana950))}) && !${keysTab(banana950)} && document.querySelector('.corner-note')?.textContent === 'banana950.txt moved to the recycle bin'`,
    'Delete moved banana950.txt away with a note in the corner',
    5000,
  );
  expect(!fs.existsSync(banana950) && fs.existsSync(path.join(trash644, '1-banana950.txt')), "Delete moved banana950.txt to the home's trash at once");
  await s.waitFor(`${selJs} === ${JSON.stringify(plum950)} && ${treeHasKeys} && document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, "the selection moves to the next row and the tree keeps the keyboard through the tab's close", 3000);
  // (5) A refusal: unsaved edits.
  await s.key(' ', 'Space', 32);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(plum950)} && !!${editorJs}.getModel()`, 'plum950.txt in the editor', 5000);
  await s.evalJs(`${editorJs}.focus()`);
  // Focus again on every poll: the row click gives the tree the keyboard
  // (fix 929) and a late pull back to it is answered, not timed out, as fix
  // 985 does for fix 574's step.
  await s.waitFor(`(${editorJs}.focus(), !!document.activeElement?.closest('.monaco-editor'))`, 'the keyboard in the editor', 3000);
  await typeAtEnd('x');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty === 'true'`, 'plum950.txt dirty', 3000);
  await clickRow(s, plum950);
  await s.waitFor(`${selJs} === ${JSON.stringify(plum950)} && ${treeHasKeys}`, 'the tree has the keyboard on plum950.txt', 3000);
  await s.key('Delete', 'Delete', 46);
  await s.waitFor(`document.querySelector('.corner-note')?.textContent === 'Unsaved edits in a tab: save or discard them first'`, 'Delete on a dirty file says why', 3000);
  expect(fs.existsSync(plum950) && (await s.evalJs(`!!document.querySelector(${JSON.stringify(rowSel(plum950))})`)), 'plum950.txt is still on disk and in the tree');
  await s.evalJs(`${editorJs}.focus()`);
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.dirty !== 'true'`, 'the save', 5000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'plum950.txt closed', 3000);
  step('M9 fix 950: Space on a folder row opens and folds it, on a file previews it with the tree keeping the keyboard; Delete moves the selected file to the recycle bin at once with a note in the corner, closes its tab, selects the next row and keeps the keyboard on the tree; on a file with unsaved edits it says why and moves nothing');
  // M9 fix 951: type-ahead, on the state above: the panes tab in front,
  // plum950.txt saved with its tab closed, the selection on it.
  await clickRow(s, plum950);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(plum950)} && !!${editorJs}.getModel() && ${selJs} === ${JSON.stringify(plum950)} && ${treeHasKeys}`, 'plum950.txt previewed, the tree keeping the keyboard', 5000);
  // (a) Back to back, with no wait between them (a wait could pass the
  // second's pause under load): only the buffer qmo reaches qmore950.txt.
  await s.key('q', 'KeyQ', 81);
  await s.key('m', 'KeyM', 77);
  await s.key('o', 'KeyO', 79);
  await s.waitFor(`${selJs} === ${JSON.stringify(qmore950)} && ${treeHasKeys}`, 'q, m and o typed together select qmore950.txt', 3000);
  expect(await s.evalJs(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(plum950)}`), 'type-ahead opens nothing');
  // (b) After the pause Shift+Q starts a new buffer and wraps.
  await sleep(1200);
  await s.key('Q', 'KeyQ', 81, SHIFT);
  await s.waitFor(`${selJs} === ${JSON.stringify(qmark950)}`, 'after the pause Shift+Q starts a new buffer, case-insensitively, and wraps past the last row to qmark950.txt', 3000);
  // (c) A Space while the buffer is live joins it.
  await sleep(1200);
  await s.key('q', 'KeyQ', 81);
  await s.key(' ', 'Space', 32);
  await sleep(300);
  const joined951 = await s.evalJs(`({ sel: ${selJs}, front: document.querySelector('.file-view')?.dataset.path ?? null, tab: !!${keysTab(qmore950)} })`);
  expect(joined951.sel === qmore950 && joined951.front === plum950 && !joined951.tab, `a Space while the buffer is live joins it and previews nothing (${JSON.stringify(joined951)})`);
  step('M9 fix 951: typing in the Files tree selects the next row whose name starts with what was typed, a second\'s pause starting over, Shift and the case not mattering, the search wrapping, nothing opened; a Space while typing joins the name');
  // The clean-up: the window as fix 644 left it, plus 1-banana950.txt in
  // the harness trash.
  if ((await s.evalJs(`document.querySelector('.tab-strip')?.dataset.activeTab`)) !== 'panes') {
    await s.key('w', 'KeyW', 87, CTRL);
    await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'the file tab closed', 3000);
  }
  fs.rmSync(keysDir950, { recursive: true, force: true });
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(keysDir950))})`, 'keys950 gone', 5000);
  // M9 fix 981: a row dragged within the tree moves into the folder under
  // the mouse. The window as fix 951's clean-up leaves it: the panes tab in
  // front, the rail on repo, no file tab.
  const drag981 = path.join(repo, 'drag981');
  const to981 = path.join(drag981, 'to981');
  const box981 = path.join(drag981, 'box981');
  const kid981 = path.join(box981, 'kid981');
  const open981 = path.join(drag981, 'open981.txt');
  const f1981 = path.join(drag981, 'f1981.txt');
  const f2981 = path.join(drag981, 'f2981.txt');
  const f3981 = path.join(drag981, 'f3981.txt');
  fs.mkdirSync(to981, { recursive: true });
  fs.mkdirSync(kid981, { recursive: true });
  fs.writeFileSync(path.join(box981, 'k981.txt'), 'k\n');
  for (const f of [open981, f1981, f2981, f3981]) fs.writeFileSync(f, 'x\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(drag981))})`, 'drag981 listed', 5000);
  const noteJs981 = `(document.querySelector('.corner-note')?.textContent ?? '')`;
  // The drag981 row at the top of the list, so every row of the fixture
  // under it is in view while the pointer moves.
  const topOf981 = () => s.evalJs(`document.querySelector(${JSON.stringify(rowSel(drag981))}).scrollIntoView({ block: 'start' })`);
  const centre981 = (p) => s.evalJs(`(() => { const { x, y, width, height } = document.querySelector(${JSON.stringify(rowSel(p))}).getBoundingClientRect(); return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }; })()`);
  const dragRow981 = async (from, to, modifiers = 0) => {
    await topOf981();
    const a = await centre981(from);
    const b = await centre981(to);
    await s.mouse('mousePressed', a.x, a.y);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 10, y: a.y, button: 'left', buttons: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left', buttons: 1, modifiers });
    const seen = await s.evalJs(`({ lit: [...document.querySelectorAll('[data-drop-into]')].map((e) => e.dataset.path ?? 'list'), ghost: document.querySelector('.drag-ghost')?.textContent ?? null, word: document.querySelector('[data-drop-into]')?.dataset.dropWord ?? null, effect: document.querySelector('.files-list')?.dataset.dropEffect ?? null })`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1, modifiers });
    return seen;
  };
  // (a) A file open in its preview tab, dragged onto a folder row.
  await clickRow(s, drag981);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(open981))}) && !!document.querySelector(${JSON.stringify(rowSel(to981))})`, "drag981's rows listed", 5000);
  await clickRow(s, open981);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(`.tab-file[data-tab=${JSON.stringify(open981)}]`)})`, 'open981.txt in its preview tab', 5000);
  const movedTo981 = path.join(to981, 'open981.txt');
  const seenA981 = await dragRow981(open981, to981);
  expect(JSON.stringify(seenA981.lit) === JSON.stringify([to981]) && seenA981.ghost === 'open981.txt', `the hover lights to981 alone and the ghost names the file (${JSON.stringify(seenA981)})`);
  // M9 fix 1152: one volume, no key: the word says a move and the effect is one.
  expect(seenA981.word === 'Move here · Ctrl copies' && seenA981.effect === 'move', `the hover says Move here · Ctrl copies with the effect move (${JSON.stringify(seenA981)})`);
  await s.waitFor(`${noteJs981} === 'Moved open981.txt into to981'`, 'the note says open981.txt moved', 5000);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(`.tab-file[data-tab=${JSON.stringify(movedTo981)}]`)}) && !!document.querySelector(${JSON.stringify(rowSel(movedTo981))})`, 'the tab follows the file and its row is at the new path', 5000);
  expect(fs.existsSync(movedTo981) && !fs.existsSync(open981), 'open981.txt moved into to981 on disk');
  // (b) Ctrl copies.
  const seenB981 = await dragRow981(f1981, to981, CTRL);
  expect(JSON.stringify(seenB981.lit) === JSON.stringify([to981]), `the Ctrl hover lights to981 (${JSON.stringify(seenB981)})`);
  expect(seenB981.word === 'Copy here' && seenB981.effect === 'copy', `the Ctrl hover says Copy here with the effect copy (${JSON.stringify(seenB981)})`);
  await s.waitFor(`${noteJs981} === 'Copied f1981.txt into to981'`, 'the note says f1981.txt copied', 5000);
  expect(fs.existsSync(f1981) && fs.existsSync(path.join(to981, 'f1981.txt')), 'Ctrl copied f1981.txt, both on disk');
  // M9 fix 1152: the word follows a key pressed or let go with the pointer
  // at rest over the folder, and Shift on the move says Move here.
  {
    await topOf981();
    const a = await centre981(f2981);
    const b = await centre981(to981);
    await s.mouse('mousePressed', a.x, a.y);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 10, y: a.y, button: 'left', buttons: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left', buttons: 1 });
    const word1152 = `(document.querySelector('[data-drop-into]')?.dataset.dropWord ?? null)`;
    await s.waitFor(`${word1152} === 'Move here · Ctrl copies'`, 'the word says Move here · Ctrl copies', 2000);
    const drawn1152 = await s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(rowSel(to981))}), '::before').content`);
    expect(drawn1152 === JSON.stringify('Move here · Ctrl copies'), `the lit row draws the word (${drawn1152})`);
    await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: CTRL });
    await s.waitFor(`${word1152} === 'Copy here'`, 'Ctrl pressed at rest says Copy here', 2000);
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, nativeVirtualKeyCode: 17, modifiers: 0 });
    await s.waitFor(`${word1152} === 'Move here · Ctrl copies'`, 'Ctrl let go at rest says Move here · Ctrl copies again', 2000);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left', buttons: 1, modifiers: SHIFT });
    await s.waitFor(`${word1152} === 'Move here'`, 'Shift on the move says Move here', 2000);
    await s.key('Escape', 'Escape', 27);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
    await sleep(300);
    const left1152 = await s.evalJs(`({ into: document.querySelectorAll('[data-drop-into]').length, word: document.querySelectorAll('[data-drop-word]').length })`);
    expect(left1152.into === 0 && left1152.word === 0, `Escape leaves no lit folder and no word (${JSON.stringify(left1152)})`);
    expect(fs.existsSync(f2981) && !fs.existsSync(path.join(to981, 'f2981.txt')), 'Escape moved nothing: f2981.txt still in drag981');
    step('M9 fix 1152: a drag from the tree over a folder says Move here · Ctrl copies, Copy here while Ctrl is held and Move here with Shift, following a key pressed with the pointer at rest');
  }
  // (c) A drop on the row's own folder lights nothing and says nothing.
  const seenC981 = await dragRow981(f2981, f3981);
  expect(seenC981.lit.length === 0, `a drop on its own folder lights nothing (${JSON.stringify(seenC981)})`);
  await sleep(800);
  const noteC981 = await s.evalJs(noteJs981);
  expect(fs.existsSync(f2981) && noteC981 !== 'Already in drag981', `f2981.txt stays where it was with no note (${noteC981})`);
  // (d) A folder row drags too.
  const seenD981 = await dragRow981(box981, to981);
  expect(seenD981.ghost === 'box981' && JSON.stringify(seenD981.lit) === JSON.stringify([to981]), `the folder's ghost names it and to981 lights (${JSON.stringify(seenD981)})`);
  await s.waitFor(`${noteJs981} === 'Moved box981 into to981'`, 'the note says box981 moved', 5000);
  const box981b = path.join(to981, 'box981');
  const kid981b = path.join(box981b, 'kid981');
  expect(!fs.existsSync(box981) && fs.existsSync(path.join(box981b, 'k981.txt')), 'box981 and k981.txt are under to981 on disk');
  // (e) A folder dropped into its own child is refused with main's note.
  if ((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(to981))})?.dataset.expanded`)) !== 'true') await clickRow(s, to981);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(box981b))})`, 'to981 open with box981 in it', 5000);
  if ((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(box981b))})?.dataset.expanded`)) !== 'true') await clickRow(s, box981b);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(kid981b))})`, 'box981 open with kid981 in it', 5000);
  const seenE981 = await dragRow981(box981b, kid981b);
  expect(JSON.stringify(seenE981.lit) === JSON.stringify([kid981b]), `the hover lights kid981 (${JSON.stringify(seenE981)})`);
  await s.waitFor(`${noteJs981} === 'box981 could not go: A folder cannot go into itself'`, 'the note says a folder cannot go into itself', 5000);
  expect(fs.existsSync(path.join(box981b, 'k981.txt')) && fs.readdirSync(kid981b).length === 0, 'the disk is unchanged');
  for (let i = 0; i < 4 && (await s.evalJs(`document.querySelector('.tab-strip')?.dataset.activeTab`)) !== 'panes'; i++) {
    await s.key('w', 'KeyW', 87, CTRL);
    await sleep(300);
  }
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'the file tab closed', 3000);
  step('M9 fix 981: a file row dragged onto a folder row moves there with its tab following, Ctrl copies, a drop on its own folder lights and says nothing, a folder row drags too, and a folder into its own child is refused with a note');
  // M9 fix 982: Ctrl+click and Shift+click pick several rows, and the set
  // drags into a folder or goes to the recycle bin. On fix 981's window:
  // the panes tab in front, the rail on repo, drag981 still there.
  const pick982 = path.join(repo, 'pick982');
  const dest982 = path.join(pick982, 'dest982');
  const m982 = path.join(pick982, 'm982');
  const p982 = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => [k, path.join(pick982, `${k}982.txt`)]));
  fs.mkdirSync(dest982, { recursive: true });
  fs.mkdirSync(m982, { recursive: true });
  fs.writeFileSync(path.join(m982, 'inner.txt'), 'i\n');
  for (const f of Object.values(p982)) fs.writeFileSync(f, 'x\n');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(pick982))})`, 'pick982 listed', 5000);
  const picked982 = `[...document.querySelectorAll('.files-list .files-row[data-picked]')].map((r) => r.dataset.path)`;
  const top982 = () => s.evalJs(`document.querySelector(${JSON.stringify(rowSel(pick982))}).scrollIntoView({ block: 'start' })`);
  const click982 = async (p, modifiers) => {
    await top982();
    const at = await centre981(p);
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 1, modifiers });
  };
  const pickedIs982 = (want, what) => s.waitFor(`JSON.stringify(${picked982}) === ${JSON.stringify(JSON.stringify(want))}`, what, 3000);
  // (a) Ctrl+click toggles a row in and out, opening nothing.
  await clickRow(s, pick982);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(p982.f))}) && !!document.querySelector(${JSON.stringify(rowSel(dest982))})`, "pick982's rows listed", 5000);
  await clickRow(s, p982.a);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(p982.a)}`, 'a982.txt in front', 5000);
  await click982(p982.c, CTRL);
  await pickedIs982([p982.a, p982.c], 'Ctrl+click picks c982.txt beside a982.txt');
  const frontA982 = await s.evalJs(`({ sel: ${selJs}, front: document.querySelector('.file-view')?.dataset.path ?? null })`);
  expect(frontA982.sel === p982.c && frontA982.front === p982.a, `c982.txt is focused and a982.txt still in front (${JSON.stringify(frontA982)})`);
  await click982(p982.a, CTRL);
  await pickedIs982([p982.c], 'a second Ctrl+click takes a982.txt out of the set');
  // (b) Shift+click picks a range across a folder, opening nothing.
  await clickRow(s, p982.b);
  await pickedIs982([p982.b], 'a plain click picks b982.txt alone');
  await click982(m982, SHIFT);
  await pickedIs982([m982, p982.a, p982.b], 'Shift+click picks m982 to b982.txt');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(m982))})?.dataset.expanded`)) === undefined, 'the Shift+click leaves m982 folded');
  await s.key('ArrowDown', 'ArrowDown', 40, SHIFT);
  await pickedIs982([p982.a, p982.b], 'Shift+ArrowDown narrows the range to a982 and b982');
  await s.key('ArrowUp', 'ArrowUp', 38, SHIFT);
  await pickedIs982([m982, p982.a, p982.b], 'Shift+ArrowUp widens it back');
  // (c) Escape clears the set and the tree keeps the keyboard.
  await s.key('Escape', 'Escape', 27);
  await pickedIs982([m982], 'Escape leaves the focused row alone');
  expect(await s.evalJs(treeHasKeys), 'the tree keeps the keyboard after the Escape');
  // (d) The set drags into a folder with one note.
  await clickRow(s, p982.b);
  await pickedIs982([p982.b], 'b982.txt alone again');
  await click982(m982, SHIFT);
  await pickedIs982([m982, p982.a, p982.b], 'the range again');
  await top982();
  const fromD982 = await centre981(p982.a);
  const toD982 = await centre981(dest982);
  await s.mouse('mousePressed', fromD982.x, fromD982.y);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromD982.x + 10, y: fromD982.y, button: 'left', buttons: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: toD982.x, y: toD982.y, button: 'left', buttons: 1 });
  const seenD982 = await s.evalJs(`({ lit: [...document.querySelectorAll('[data-drop-into]')].map((e) => e.dataset.path ?? 'list'), ghost: document.querySelector('.drag-ghost')?.textContent ?? null })`);
  await s.mouse('mouseReleased', toD982.x, toD982.y);
  expect(seenD982.ghost === '3 items' && JSON.stringify(seenD982.lit) === JSON.stringify([dest982]), `the set's ghost reads 3 items and dest982 lights (${JSON.stringify(seenD982)})`);
  await s.waitFor(`${noteJs981} === 'Moved 3 items into dest982'`, 'the note says three items moved', 5000);
  expect(['m982/inner.txt', 'a982.txt', 'b982.txt'].every((f) => fs.existsSync(path.join(dest982, f))) && !fs.existsSync(m982) && !fs.existsSync(p982.a), 'dest982 holds m982, a982.txt and b982.txt on disk');
  // (d2) M9 fix 1006: a folder row dragged onto a pane is refused with a
  // not-allowed cursor and, on the release, a note; nothing opens.
  await s.evalJs(`document.querySelector('.tab.tab-panes').click()`);
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'the panes tab in front for the refused drag', 3000);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(dest982))})`, 'dest982 listed on the panes tab', 5000);
  const layoutD2 = await getLayout(s);
  const paneCount982 = leaves(layoutD2).length;
  const paneAt982 = await s.evalJs(`(() => { const { x, y, width, height } = document.querySelector('[data-pane-id=' + ${JSON.stringify(JSON.stringify(layoutD2.focusedPaneId))} + ']').getBoundingClientRect(); return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }; })()`);
  await top982();
  const fromD2 = await centre981(dest982);
  await s.mouse('mousePressed', fromD2.x, fromD2.y);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromD2.x + 10, y: fromD2.y, button: 'left', buttons: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: paneAt982.x, y: paneAt982.y, button: 'left', buttons: 1 });
  const seenD2 = await s.evalJs(`({ mark: document.body.dataset.dragRefused ?? null, cursor: getComputedStyle(document.body).cursor })`);
  expect(seenD2.mark === 'folder' && seenD2.cursor === 'not-allowed', `a folder over a pane is marked refused with the not-allowed cursor (${JSON.stringify(seenD2)})`);
  await s.mouse('mouseReleased', paneAt982.x, paneAt982.y);
  await s.waitFor(`${noteJs981} === 'A folder opens in no pane; drop it on a folder in the tree'`, 'the note says a folder opens in no pane', 5000);
  expect(!(await s.evalJs(`'dragRefused' in document.body.dataset`)), 'the mark is gone after the release');
  expect(leaves(await getLayout(s)).length === paneCount982, 'the pane count is unchanged');
  expect(fs.existsSync(path.join(dest982, 'a982.txt')), 'the folder stayed where it was on disk');
  // (e) A right-click on the set offers Delete alone, on every row of it.
  await clickRow(s, p982.c);
  await pickedIs982([p982.c], 'c982.txt alone');
  await click982(p982.d, CTRL);
  await pickedIs982([p982.c, p982.d], 'c982 and d982 picked');
  // M9 fix 1006: the set dragged onto the + is refused, the rail's own
  // folder lights nothing and clears the mark, and the release says why.
  const tabsBefore982 = await s.evalJs(`document.querySelectorAll('.tab').length`);
  await top982();
  const fromE2 = await centre981(p982.d);
  const addAt982 = await s.evalJs(`(() => { const { x, y, width, height } = document.querySelector('.tab-add').getBoundingClientRect(); return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }; })()`);
  await s.mouse('mousePressed', fromE2.x, fromE2.y);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fromE2.x + 10, y: fromE2.y, button: 'left', buttons: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: addAt982.x, y: addAt982.y, button: 'left', buttons: 1 });
  expect((await s.evalJs(`document.body.dataset.dragRefused ?? null`)) === 'set', 'a set over the + is marked refused');
  const overRail982 = await centre981(p982.c);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: overRail982.x, y: overRail982.y, button: 'left', buttons: 1 });
  expect((await s.evalJs(`document.body.dataset.dragRefused ?? null`)) === null, 'the mark is gone over the rail');
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: addAt982.x, y: addAt982.y, button: 'left', buttons: 1 });
  await s.mouse('mouseReleased', addAt982.x, addAt982.y);
  await s.waitFor(`${noteJs981} === 'A pane takes one file at a time; drop the set on a folder'`, 'the note says a pane takes one file at a time', 5000);
  await s.screenshot('m10-1006-refused-set.png');
  expect((await s.evalJs(`document.querySelectorAll('.tab').length`)) === tabsBefore982 && fs.existsSync(p982.c) && fs.existsSync(p982.d), 'no tab was made and both files are still on disk');
  await pickedIs982([p982.c, p982.d], 'the refused drag keeps the set');
  await top982();
  const atE982 = await centre981(p982.d);
  await s.rightClick(atE982.x, atE982.y);
  await s.waitFor(`document.querySelector('.files-menu')?.dataset.picked === '2'`, "the set's menu", 3000);
  const menuE982 = await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].map((b) => ({ label: b.querySelector('.menu-label')?.textContent ?? b.textContent, disabled: b.disabled }))`);
  const lastE982 = menuE982[menuE982.length - 1];
  const copyLabels982 = ['Copy 2 paths', 'Copy 2 relative paths'];
  expect(menuE982.slice(0, -1).every((i) => i.disabled === !copyLabels982.includes(i.label)) && copyLabels982.every((l) => menuE982.some((i) => i.label === l)) && lastE982.label === 'Delete' && !lastE982.disabled, `the two copies are enabled, every other item but Delete is disabled (${JSON.stringify(menuE982)})`);
  await pickedIs982([p982.c, p982.d], 'the right-click keeps the set');
  // M9 fix 1006: the set's copies put every picked path on the held clipboard.
  const clickMenu982 = (label) => s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === ${JSON.stringify(label)}).click()`);
  const reopen982 = async () => {
    await top982();
    const at = await centre981(p982.d);
    await s.rightClick(at.x, at.y);
    await s.waitFor(`document.querySelector('.files-menu')?.dataset.picked === '2'`, "the set's menu again", 3000);
  };
  await clickMenu982('Copy 2 paths');
  await s.waitFor(`window.emerald.clipboard.read().then((r) => r.text === ${JSON.stringify(p982.c + '\n' + p982.d)})`, 'Copy 2 paths puts both paths on the clipboard, one per line', 3000);
  await reopen982();
  await clickMenu982('Copy 2 relative paths');
  await s.waitFor(`window.emerald.clipboard.read().then((r) => r.text === ${JSON.stringify(path.join('pick982', 'c982.txt') + '\n' + path.join('pick982', 'd982.txt'))})`, 'Copy 2 relative paths puts both relative paths on the clipboard', 3000);
  await reopen982();
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].at(-1).click()`);
  await s.waitFor(`[...document.querySelectorAll('.files-menu .menu-item')].at(-1)?.querySelector('.menu-label')?.textContent === 'Delete 2 items, to the recycle bin?'`, 'Delete asks once more, naming the count', 3000);
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].at(-1).click()`);
  await s.waitFor(`${noteJs981} === '2 items moved to the recycle bin' && !document.querySelector(${JSON.stringify(rowSel(p982.c))}) && !document.querySelector(${JSON.stringify(rowSel(p982.d))})`, 'the menu moved both to the recycle bin with one note', 5000);
  expect(!fs.existsSync(p982.c) && !fs.existsSync(p982.d) && fs.existsSync(path.join(trash644, '1-c982.txt')) && fs.existsSync(path.join(trash644, '1-d982.txt')), "c982 and d982 are in the home's trash");
  // (f) Delete on the set from the keyboard.
  await clickRow(s, p982.e);
  await pickedIs982([p982.e], 'e982.txt alone');
  await click982(p982.f, CTRL);
  await pickedIs982([p982.e, p982.f], 'e982 and f982 picked');
  await s.key('Delete', 'Delete', 46);
  await s.waitFor(`${noteJs981} === '2 items moved to the recycle bin' && !document.querySelector(${JSON.stringify(rowSel(p982.e))}) && !document.querySelector(${JSON.stringify(rowSel(p982.f))})`, 'Delete moved both to the recycle bin with one note', 5000);
  expect(!fs.existsSync(p982.e) && !fs.existsSync(p982.f), 'e982 and f982 are gone from disk');
  for (let i = 0; i < 4 && (await s.evalJs(`document.querySelector('.tab-strip')?.dataset.activeTab`)) !== 'panes'; i++) {
    await s.key('w', 'KeyW', 87, CTRL);
    await sleep(300);
  }
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'the file tabs closed', 3000);
  fs.rmSync(drag981, { recursive: true, force: true });
  fs.rmSync(pick982, { recursive: true, force: true });
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(drag981))}) && !document.querySelector(${JSON.stringify(rowSel(pick982))})`, 'drag981 and pick982 gone', 5000);
  step('M9 fix 982: Ctrl+click toggles rows in and out of a picked set and Shift+click and Shift+arrows pick a range across a folder, opening nothing; Escape clears the set; the set drags into a folder with one note; a set or a folder dragged onto a pane or the + is refused with a note, and the menu of a set copies both paths and offers Delete (fix 1006); Delete on the set or its menu moves every picked row to the recycle bin with one note');
  // M9 fix 1122: a row of the Files tab dragged past the window's edge with
  // no window of ours under the pointer goes to the OS as a file drag. Under
  // the harness main holds it to the open log (EMERALD_OPEN_LOG) as a
  // `drag-out` line per path and never starts one, since the OS loop reads
  // the real button. On fix 982's window: one window, the panes tab in
  // front, the rail on repo, drag981 and pick982 gone.
  const a1122 = path.join(repo, 'a1122.json');
  const b1122 = path.join(repo, 'b1122.txt');
  const out1122 = path.join(repo, 'out1122');
  fs.writeFileSync(a1122, '{"a":1}\n');
  fs.writeFileSync(b1122, 'b\n');
  fs.mkdirSync(out1122, { recursive: true });
  fs.writeFileSync(path.join(out1122, 'inner.txt'), 'i\n');
  await s.waitFor(`[${JSON.stringify(rowSel(a1122))}, ${JSON.stringify(rowSel(b1122))}, ${JSON.stringify(rowSel(out1122))}].every((q) => !!document.querySelector(q))`, 'the three rows of fix 1122 listed', 5000);
  const below1122 = await s.evalJs(`({ x: Math.round(innerWidth / 2), y: innerHeight + 200 })`);
  const at1122 = (p) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel(p))}); r.scrollIntoView({ block: 'center' }); const { x, y, width, height } = r.getBoundingClientRect(); return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) }; })()`);
  const drag1122 = async (p) => {
    const from = await at1122(p);
    await s.mouse('mousePressed', from.x, from.y);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + 10, y: from.y, button: 'left', buttons: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: below1122.x, y: below1122.y, button: 'left', buttons: 1 });
  };
  const release1122 = () => s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: below1122.x, y: below1122.y, button: 'left', clickCount: 1 });
  const openLines1122 = () => (fs.existsSync(openedPaths) ? fs.readFileSync(openedPaths, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('drag-out ')) : []);
  const mainLog1122 = () => fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8');
  const waitLines1122 = async (want, what) => {
    const by = Date.now() + 3000;
    while (JSON.stringify(openLines1122()) !== JSON.stringify(want) && Date.now() < by) await sleep(100);
    expect(JSON.stringify(openLines1122()) === JSON.stringify(want), `${what} (${JSON.stringify(openLines1122())})`);
  };
  const windows1122 = async () => (await getTabs(s)).windows?.length ?? 1;
  const windowsBefore1122 = await windows1122();
  const panesBefore1122 = leaves(await getLayout(s)).length;
  // (a) A file row.
  const linesA1122 = ['drag-out ' + a1122];
  await drag1122(a1122);
  await waitLines1122(linesA1122, 'a1122.json went to the OS, held as one drag-out line');
  const endedA1122 = await s.evalJs(`({ dragging: document.body.classList.contains('dragging-session'), ghost: !!document.querySelector('.drag-ghost') })`);
  expect(!endedA1122.dragging && !endedA1122.ghost, `the drag ended in the window at the hand-over (${JSON.stringify(endedA1122)})`);
  await release1122();
  await sleep(500);
  const logA1122 = mainLog1122();
  expect(logA1122.includes('window drag: a file from window ') && logA1122.includes(' handed to the OS at '), 'main.log says a file was handed to the OS');
  expect((await windows1122()) === windowsBefore1122 && leaves(await getLayout(s)).length === panesBefore1122, 'no window and no pane was opened');
  // (b) A picked set of two, dragged by its second row.
  const picked1122 = `[...document.querySelectorAll('.files-list .files-row[data-picked]')].map((r) => r.dataset.path)`;
  // M9 fix 1151: (a)'s drag ended at the hand-over, which clears the row's
  // drag flag, so a click with no press of its own picks the row.
  await clickRow(s, a1122);
  await s.waitFor(`JSON.stringify(${picked1122}) === ${JSON.stringify(JSON.stringify([a1122]))}`, 'a1122.json picked alone', 3000);
  const atB1122 = await at1122(b1122);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: atB1122.x, y: atB1122.y, button: 'left', clickCount: 1, modifiers: CTRL });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: atB1122.x, y: atB1122.y, button: 'left', clickCount: 1, modifiers: CTRL });
  await s.waitFor(`JSON.stringify(${picked1122}) === ${JSON.stringify(JSON.stringify([a1122, b1122]))}`, 'a1122.json and b1122.txt picked', 3000);
  const linesB1122 = [...linesA1122, 'drag-out ' + a1122, 'drag-out ' + b1122];
  await drag1122(b1122);
  await waitLines1122(linesB1122, 'the set went to the OS in its order, a1122.json then b1122.txt');
  await release1122();
  await sleep(300);
  expect(mainLog1122().includes('window drag: 2 files from window '), 'main.log says two files were handed to the OS');
  await s.waitFor(`JSON.stringify(${picked1122}) === ${JSON.stringify(JSON.stringify([a1122, b1122]))}`, 'the set is still picked after the hand-over', 3000);
  // (c) A folder row, the set cleared first.
  await s.key('Escape', 'Escape', 27);
  const linesC1122 = [...linesB1122, 'drag-out ' + out1122];
  await drag1122(out1122);
  await waitLines1122(linesC1122, 'out1122 went to the OS as a folder');
  await release1122();
  await sleep(800);
  const noteC1122 = await s.evalJs(noteJs981);
  expect(noteC1122 !== 'A folder opens in no pane; drop it on a folder in the tree', `no refusal note after a folder went to the OS (${noteC1122})`);
  for (let i = 0; i < 4 && (await s.evalJs(`document.querySelector('.tab-strip')?.dataset.activeTab`)) !== 'panes'; i++) {
    await s.key('w', 'KeyW', 87, CTRL);
    await sleep(300);
  }
  await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, "fix 1122's file tab closed", 3000);
  fs.rmSync(a1122, { force: true });
  fs.rmSync(b1122, { force: true });
  fs.rmSync(out1122, { recursive: true, force: true });
  await s.waitFor(`[${JSON.stringify(rowSel(a1122))}, ${JSON.stringify(rowSel(b1122))}, ${JSON.stringify(rowSel(out1122))}].every((q) => !document.querySelector(q))`, 'the rows of fix 1122 gone', 5000);
  step('M9 fix 1122: a file row, a picked set of two and a folder row dragged past the window\'s edge with no window under the pointer go to the OS as files, held to the open log under the harness, the drag ended in the window with no new window and no note');
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
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
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
  // A click in a pane focuses it (pointerdown since M9 fix 902), which the script's typing
  // by focus() does not; the layout's focused pane is what the key reads.
  await s.evalJs(`${viewOf(paneFile)}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
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
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
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
  await s.evalJs(`${viewOf(paneFile)}.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
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
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneSeedPaneId)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(paneSeed)}`, 'the pane-file shell focused for closing');
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(paneSeedPaneId)}]')`, 'the pane-file shell closed too');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
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
  // M9 fix 837: Statistics in a tab after Find in folder, on the root's
  // menu alone, under this script's daemon at level 70 or later.
  const rootLabels = 'New file,New folder,Find in folder,Statistics in a tab,Open in Explorer,Reveal in Explorer,Copy path,Insert path into pane';
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
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(rootMenuPaneId)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(rootMenuPaneId)}]')`, 'the root menu shell closed');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
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

  // M9 fix 1038: the rail's Context tab on a stub breakdown. The shell in
  // the followed folder stands in for a Claude: the sink's SessionStart and
  // a StatusLine with a 200k window bind it (its claudeSessionId), and a
  // Context post in the mod's shape (fix 1036) puts the handoff's invented
  // reading (docs/design/context-tab.md, section 6) on the record, its
  // first memory file the fixture's own CLAUDE.md. Squares are counted by
  // data-part, never by colour, since the seven context tokens are
  // light-tokens' and may not be on the branch.
  const claudeMd1038 = path.join(followed436, 'CLAUDE.md');
  fs.writeFileSync(claudeMd1038, '# fixture\n');
  const shell1038 = (await zreq(s, 'session.list', {})).sessions.find((x) => x.state !== 'exited' && (x.cwd === followed436 || x.groupCwd === followed436));
  expect(shell1038 !== undefined, 'the shell in the followed folder (fix 1038)');
  const daemon1038 = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const post1038 = async (payload, extraHeaders = {}) => {
    const res = await fetch(`http://127.0.0.1:${daemon1038.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon1038.hookToken, 'X-Emerald-Session': shell1038.id, ...extraHeaders },
      body: JSON.stringify({ session_id: 'sim-files-1038', cwd: followed436, ...payload }),
    });
    expect(res.status === 204, `the sink answered 204 for ${payload.hook_event_name} (fix 1038)`);
  };
  // M9 fix 1056: the Context tab's four states before a breakdown. shell
  // and none first, on the plain shell and then an empty pane beside it.
  const railState1056 = (state) => `!!document.querySelector('.files-rail .rail-context[data-state="${state}"]')`;
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="context"]').click()`);
  await s.waitFor(`${railState1056('shell')} && document.querySelector('.files-rail .rail-context .files-empty')?.textContent === 'This pane runs a shell, not Claude'`, 'the Context tab reads shell on a plain shell (fix 1056)', 10000);
  const pane1056 = (await getLayout(s)).focusedPaneId;
  await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(`.pane[data-pane-id=${JSON.stringify(pane1056)}] .pane-split-right`)}); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); })()`);
  await s.waitFor(`!!document.querySelector('.split-menu')`, 'the split menu opens (fix 1056)', 5000);
  await s.evalJs(`[...document.querySelectorAll('.split-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent.replace(/^✓/, '') === 'Split empty').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'the empty split makes a second pane (fix 1056)', 5000);
  let empty1056 = null;
  for (let i = 0; i < 40 && empty1056 === null; i++) {
    empty1056 = leaves(await getLayout(s)).find((p) => p.id !== pane1056 && p.sessionId === null) ?? null;
    if (empty1056 === null) await sleep(200);
  }
  expect(empty1056 !== null, 'the new leaf is an empty pane (fix 1056)');
  await s.waitFor(`${railState1056('none')} && document.querySelector('.files-rail .rail-context .files-empty')?.textContent === 'No session in this pane'`, 'the Context tab reads none on an empty pane (fix 1056)', 10000);
  await s.evalJs(`document.querySelector('.empty-close').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'the empty pane closes (fix 1056)', 5000);
  for (let i = 0; i < 40 && (await getLayout(s)).focusedPaneId !== pane1056; i++) await sleep(200);
  expect((await getLayout(s)).focusedPaneId === pane1056, 'the shell pane is focused again (fix 1056)');
  await s.waitFor(railState1056('shell'), 'the Context tab reads shell again (fix 1056)', 10000);
  // outside: the transcript's names, outside the harness Claude home so the
  // fix 1040 history does not count it.
  transcript1056 = path.join(os.tmpdir(), 'emerald-verify', `m10-transcript-1056-${process.pid}.jsonl`);
  fs.mkdirSync(path.dirname(transcript1056), { recursive: true });
  const attach1056 = (attachment) => JSON.stringify({ type: 'attachment', attachment });
  fs.writeFileSync(
    transcript1056,
    [
      attach1056({ type: 'instructions', files: [{ path: claudeMd1038, type: 'Project' }] }),
      attach1056({ type: 'skill_listing', names: ['ado', 'batch'], skillCount: 2 }),
      attach1056({ type: 'mcp_instructions_delta', addedNames: ['claude-in-chrome', 'Wispr_Flow'], removedNames: [] }),
      attach1056({ type: 'mcp_instructions_delta', addedNames: [], removedNames: ['Wispr_Flow'] }),
      attach1056({ type: 'agent_listing_delta', addedTypes: ['claude', 'emerald-batch-dev', 'Explore'], removedTypes: [], builtInTypes: ['Explore'] }),
    ].join('\n') + '\n',
  );
  await post1038({ hook_event_name: 'SessionStart', source: 'startup', transcript_path: transcript1056 });
  await post1038({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' }, workspace: { current_dir: followed436 }, context_window: { used_percentage: 43, context_window_size: 200000 } });
  await s.waitFor(`${railState1056('outside')} && document.querySelectorAll('.files-rail .rail-context-head-row[data-names]').length === 4`, 'the Context tab reads outside with the transcript names (fix 1056)', 15000);
  const outside1056 = await s.evalJs(
    `(() => { const r = document.querySelector('.files-rail .rail-context'); const rows = [...r.querySelectorAll('.rail-context-head-row[data-names]')]; return { asof: r.querySelector('.rail-context-asof')?.textContent ?? null, words: r.querySelector('.rail-context-outside')?.textContent ?? null, rows: rows.map((x) => x.dataset.part + ':' + (x.querySelector('.history-group-count')?.textContent ?? '')).join(','), skillsTitle: rows.find((x) => x.dataset.part === 'skills')?.getAttribute('title') ?? null, model: r.querySelector('.rail-context-model')?.textContent ?? null }; })()`,
  );
  expect(
    outside1056.asof === 'no breakdown' &&
      outside1056.words === 'emerald did not start this Claude, so it cannot ask for the breakdown; the names below are what its transcript lists' &&
      outside1056.rows === 'memory:1,mcp:1,skills:2,agents:2' &&
      outside1056.skillsTitle === 'ado, batch',
    `outside: no breakdown, the words, and the transcript's names: ${JSON.stringify(outside1056)}`,
  );
  const model1056 = outside1056.model;
  // reading: the mod seen and no channel. A ModSubmit with no submit_id
  // marks the mod and moves no state. The tab switch remounts the body, so
  // it asks again.
  const log1056 = path.join(process.env['EMERALD_HOME'], 'logs', 'emmerd.log');
  const id8_1056 = shell1038.id.slice(0, 8);
  const countLog1056 = (needle) => (fs.existsSync(log1056) ? fs.readFileSync(log1056, 'utf8').split('\n').filter((l) => l.includes(needle)).length : 0);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'files'`, 'the rail is on Files (fix 1056)', 5000);
  await post1038({ hook_event_name: 'ModSubmit' }, { 'X-Emerald-Hook': 'emerald-mod' });
  const noChannel1056 = countLog1056(`mod context for ${id8_1056}: no channel`);
  const waited1056 = countLog1056(`mod channel not up for ${id8_1056} after 3000 ms`);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="context"]').click()`);
  await s.waitFor(`${railState1056('reading')} && document.querySelector('.files-rail .rail-context-sections .files-empty')?.textContent === 'reading the context'`, 'the Context tab reads reading while the mod has no channel (fix 1056)', 5000);
  for (let i = 0; i < 40 && !(countLog1056(`mod context for ${id8_1056}: no channel`) === noChannel1056 + 1 && countLog1056(`mod channel not up for ${id8_1056} after 3000 ms`) === waited1056 + 1); i++) await sleep(200);
  expect(countLog1056(`mod channel not up for ${id8_1056} after 3000 ms`) === waited1056 + 1, 'the daemon waited the 3 s for the mod channel and logged it (fix 1056)');
  await sleep(300);
  expect(
    (await s.evalJs(`${railState1056('reading')} && document.querySelector('.files-rail .rail-context-sections .files-empty')?.textContent === 'reading the context'`)) === true,
    'a Claude with the mod and no channel stays reading after the 3 s wait (fix 1056)',
  );
  // M9 fix 1102: a mod channel up (a poll loop in this script standing in for the mod's own, M9 fix 1125) on a conversation with no reply: the ask reaches it as a context line, nothing answers, and at CONTEXT_ASK_MS the tab reads fresh rather than outside.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'files'`, 'the rail is on Files (fix 1102)', 5000);
  const up1102 = countLog1056(`mod channel up for ${id8_1056}`);
  const down1102 = countLog1056(`mod channel down for ${id8_1056}`);
  let out1102 = '';
  abort1102 = new AbortController();
  const poll1102 = async () => {
    for (;;) {
      const res = await fetch(`http://127.0.0.1:${daemon1038.hookPort}/channel`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': daemon1038.hookToken, 'X-Emerald-Session': shell1038.id, 'X-Emerald-Hook': 'emerald-mod' }, body: '{}', signal: abort1102.signal });
      if (res.status !== 200) return;
      for (const line of (await res.json()).lines) out1102 += JSON.stringify(line) + '\n';
    }
  };
  void poll1102().catch(() => undefined);
  for (let i = 0; i < 50 && countLog1056(`mod channel up for ${id8_1056}`) !== up1102 + 1; i++) await sleep(200);
  expect(countLog1056(`mod channel up for ${id8_1056}`) === up1102 + 1, 'the stand-in mod channel is up (fix 1102)');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="context"]').click()`);
  for (let i = 0; i < 25 && !out1102.includes('{"context":"summary"}\n'); i++) await sleep(200);
  expect(out1102.includes('{"context":"summary"}\n'), `fix 1102: the ask reached the channel as a context line, got ${JSON.stringify(out1102)}`);
  await s.waitFor(`${railState1056('fresh')} && document.querySelector('.files-rail .rail-context-sections .files-empty')?.textContent === 'A new conversation; the breakdown comes with its first reply' && !document.querySelector('.files-rail .rail-context-outside')`, 'the Context tab reads fresh at 10 s on a conversation with no reply (fix 1102)', 15000);
  abort1102.abort();
  abort1102 = null;
  for (let i = 0; i < 50 && countLog1056(`mod channel down for ${id8_1056}`) !== down1102 + 1; i++) await sleep(200);
  expect(countLog1056(`mod channel down for ${id8_1056}`) === down1102 + 1, 'the stand-in mod channel is down (fix 1102)');
  step('M9 fix 1102: with a mod channel up the Context tab\'s ask reaches it as {"context":"summary"}, and with no answer on a conversation with no reply the tab reads A new conversation; the breakdown comes with its first reply at 10 s, not outside');
  const used1038 =(name, tokens) => ({ name, tokens, color: 'x', isDeferred: false, kind: 'used' });
  const tools1038 = (server, n, total) => Array.from({ length: n }, (_, i) => ({ name: `mcp__${server}__t${i}`, serverName: server, tokens: Math.floor(total / n) + (i < total % n ? 1 : 0), isLoaded: true }));
  const breakdown1038 = {
    categories: [
      used1038('System prompt', 3100),
      used1038('System tools', 14200),
      used1038('MCP tools', 9800),
      used1038('MCP server instructions', 1600),
      used1038('Custom agents', 1200),
      used1038('Memory files', 11300),
      used1038('Skills', 7200),
      used1038('Messages', 38000),
      { name: 'Free space', tokens: 80600, color: 'x', isDeferred: false, kind: 'free' },
      { name: 'Autocompact buffer', tokens: 33000, color: 'x', isDeferred: false, kind: 'buffer' },
      { name: 'MCP tools (deferred)', tokens: 21400, color: 'x', isDeferred: true, kind: 'deferred' },
    ],
    totalTokens: 86400,
    maxTokens: 200000,
    rawMaxTokens: 200000,
    autocompactSource: 'default',
    percentage: 43,
    model: 'claude-opus-5-5',
    memoryFiles: [
      { path: claudeMd1038, type: 'Project', tokens: 8700 },
      { path: path.join(liftParent, 'MEMORY.md'), type: 'AutoMem', tokens: 1700 },
      { path: path.join(liftParent, 'user', 'CLAUDE.md'), type: 'User', tokens: 900 },
    ],
    mcpTools: [...tools1038('claude-in-chrome', 14, 6100), ...tools1038('Wispr_Flow', 16, 3700), ...Array.from({ length: 62 }, (_, i) => ({ name: `mcp__deferred__t${i}`, serverName: 'deferred', tokens: 300, isLoaded: false }))],
    agents: [
      { agentType: 'emerald-batch-dev', source: 'projectSettings', tokens: 520 },
      { agentType: 'claude', source: 'userSettings', tokens: 410 },
      { agentType: 'workflow-guide', source: 'plugin', tokens: 270 },
    ],
    skills: { totalSkills: 2, includedSkills: 2, tokens: 7200, skillFrontmatter: [{ name: 'ado', source: 'userSettings', tokens: 300 }, { name: 'batch', source: 'projectSettings', tokens: 400 }] },
    autoCompactThreshold: 167000,
    isAutoCompactEnabled: true,
    apiUsage: null,
    gridRows: [[{ color: 'x', isFilled: true, categoryName: 'System prompt', tokens: 3100, percentage: 1.55, squareFullness: 1 }]],
  };
  await post1038({ hook_event_name: 'Context', detail: 'summary', breakdown: breakdown1038 });
  let context1038 = null;
  for (let i = 0; i < 40 && context1038 === null; i++) {
    context1038 = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === shell1038.id)?.context ?? null;
    if (context1038 === null) await sleep(200);
  }
  expect(context1038 !== null && context1038.totalTokens === 86400 && context1038.detail === 'summary' && !('gridRows' in context1038), `the record carries the breakdown less its grid (fix 1036): ${JSON.stringify(context1038)?.slice(0, 200)}`);
  // M9 fix 1102 left the rail on Context, fresh; the Context post above turns it loaded in place and this click on the active tab is a no-op.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="context"]').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .rail-context[data-state="loaded"]')`, 'the Context tab loaded on the stub breakdown', 10000);
  const partsOrder1038 = ['prompt', 'tools', 'mcp', 'mcp-instructions', 'agents', 'memory', 'skills', 'messages', 'free', 'buffer'];
  const read1038 = () =>
    s.evalJs(
      `(() => { const r = document.querySelector('.files-rail .rail-context'); const sq = [...r.querySelectorAll('.rail-context-square')]; const by = {}; const lit = {}; for (const q of sq) { by[q.dataset.part] = (by[q.dataset.part] ?? 0) + 1; if (q.dataset.dim === undefined) lit[q.dataset.part] = (lit[q.dataset.part] ?? 0) + 1; } return { squares: sq.length, by, lit, hollow: r.querySelectorAll('.rail-context-square[data-fill="hollow"]').length, model: r.querySelector('.rail-context-model')?.textContent ?? null, asOf: r.querySelector('.rail-context-asof')?.textContent ?? null, fill: r.querySelector('.rail-context-fill')?.textContent ?? null, heads: [...r.querySelectorAll('.rail-context-section > .rail-context-head-row .rail-context-head-name')].map((n) => n.textContent), memory: r.querySelector('.rail-context-section[data-part="memory"] > .rail-context-head-row')?.getAttribute('aria-expanded') ?? null, items: r.querySelectorAll('.rail-context-section[data-part="memory"] .rail-context-item').length }; })()`,
    );
  const counts1038 = (by) => partsOrder1038.map((p) => `${p} ${by[p] ?? 0}`).join(', ');
  const ctx1038 = await read1038();
  expect(
    ctx1038.squares === 100 && counts1038(ctx1038.by) === 'prompt 2, tools 8, mcp 5, mcp-instructions 1, agents 1, memory 6, skills 4, messages 19, free 37, buffer 17' && ctx1038.hollow === 5,
    `a hundred squares by part, five hollow (fix 1037): ${ctx1038.squares}, ${counts1038(ctx1038.by)}, hollow ${ctx1038.hollow}`,
  );
  expect(ctx1038.model === 'Opus 5.5 · 200k' && ctx1038.asOf === 'estimated' && ctx1038.fill === '43% full, 86.4k of 200k tokens', `the header reads the model, size, estimated and the fill line: ${JSON.stringify([ctx1038.model, ctx1038.asOf, ctx1038.fill])}`);
  expect(
    ctx1038.heads.join(',') === 'Messages,System tools,Memory files,MCP tools,Skills,System prompt,MCP instructions,Custom agents',
    `the sections sort by tokens, largest first: ${ctx1038.heads.join(',')}`,
  );
  await s.evalJs(`document.querySelector('.files-rail .rail-context-section[data-part="memory"] > .rail-context-head-row').click()`);
  await s.waitFor(`document.querySelector('.files-rail .rail-context-section[data-part="memory"] > .rail-context-head-row')?.getAttribute('aria-expanded') === 'true'`, 'the Memory files section open');
  const open1038 = await read1038();
  const otherParts1038 = partsOrder1038.filter((p) => p !== 'memory' && p !== 'free' && p !== 'buffer');
  expect(
    open1038.lit.memory === 6 && otherParts1038.every((p) => (open1038.lit[p] ?? 0) === 0) && open1038.lit.free === 37 && open1038.lit.buffer === 17 && open1038.items === 3,
    `the open section lights its six squares, dims every other part's and never free or buffer, and lists three files: lit ${counts1038(open1038.lit)}, items ${open1038.items}`,
  );
  await s.evalJs(`document.querySelector('.files-rail .rail-context-section[data-part="memory"] .rail-context-item').click()`);
  await s.waitFor(`document.querySelector('.tab-file[data-active] .tab-name')?.textContent === 'CLAUDE.md'`, "the first memory file's click opened CLAUDE.md in a file tab", 8000);
  await s.evalJs(`document.querySelector('.tab[data-active] .tab-close')?.click()`);
  await s.waitFor(`!document.querySelector('.tab-file[data-active]')`, 'the file tab closed');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="context"]').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .rail-context[data-state="loaded"]')`, 'the Context tab loaded again', 10000);
  step('M9 fix 1038: the Context tab draws a stub breakdown as a hundred squares by part with five hollow, the header and fill line, the sections sorted by tokens, and Memory files open lights its part and opens its file');
  step(`M9 fix 1056: the Context tab reads shell on a plain shell, none on an empty pane, outside with the transcript's names on a Claude with no mod, and reading on one with the mod and no channel, past the 3 s wait (model ${model1056})`);

  // The strip at the 330px default with Context active: only its word,
  // fitting; and the widths the fit rule was measured from, printed.
  await s.evalJs(`document.querySelector('.files-rail').style.width = '330px'`);
  await sleep(150);
  const strip1037 = await s.evalJs(
    `(() => { const row = document.querySelector('.rail-tabs'); const shown = [...row.querySelectorAll('.rail-tab')].filter((t) => getComputedStyle(t.querySelector('.rail-tab-label')).display !== 'none').map((t) => t.dataset.tab); return { shown, fits: row.scrollWidth <= row.clientWidth, client: row.clientWidth }; })()`,
  );
  expect(strip1037.shown.join(',') === 'context' && strip1037.fits, `at a 330px rail only the active Context tab shows its word and the strip fits: ${JSON.stringify(strip1037)}`);
  const widthsAt = async (w) => {
    await s.evalJs(`document.querySelector('.files-rail').style.width = '${w}px'`);
    await sleep(150);
    return s.evalJs(
      `(() => { const row = document.querySelector('.rail-tabs'); const gap = parseFloat(getComputedStyle(row).columnGap) || 0; const kids = [...row.children].filter((k) => !k.classList.contains('rail-tabs-spacer')); const tabs = {}; for (const t of row.querySelectorAll('.rail-tab')) tabs[t.dataset.tab] = t.getBoundingClientRect().width; return { tabs, button: row.querySelector('.files-collapse').getBoundingClientRect().width, gaps: gap * (row.children.length - 1) }; })()`,
    );
  };
  const worded1037 = await widthsAt(700);
  const icons1037 = await widthsAt(160);
  const sum = (o) => Object.values(o).reduce((n, v) => n + v, 0);
  const w5Read = sum(worded1037.tabs) + worded1037.button + worded1037.gaps;
  const w1Read = Math.max(...tabKeys.map((k) => worded1037.tabs[k] + sum(icons1037.tabs) - icons1037.tabs[k] + icons1037.button + icons1037.gaps));
  step(`M9 fix 1037: the strip at 330px shows the active Context word alone in ${strip1037.client}px; measured W5 ${w5Read.toFixed(2)}px (the Files count as it stands here) and W1 ${w1Read.toFixed(2)}px of content, the rules at ${stripRules1037.join(' and ')}`);
  await s.evalJs(`document.querySelector('.files-rail').style.width = ''`);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'files'`, 'the rail back on Files');

  // M9 fix 1040: the Skills section's groups and dates off a seeded
  // transcript, a listing pick written to the folder's settings.local.json
  // and taken back by Undo (context-switch's writer end to end), and the
  // context in a pane. A folder of its own, since the seed's .claude/
  // settings.json is not JSON and the listing would meet it as a project
  // scope that does not parse. The transcript sits under the harness's
  // Claude home, where the reader lists every transcript, and its uses
  // fall at local noon on whole calendar days back, so no time of day
  // moves `3 days`.
  const rail1040 = await s.evalJs(`document.querySelector('.files-rail')?.dataset.tab ?? null`);
  const short1040 = path.join(os.tmpdir(), 'emerald-verify', `m10-context-${process.pid}`);
  fs.rmSync(short1040, { recursive: true, force: true });
  fs.mkdirSync(short1040, { recursive: true });
  context1040 = fs.realpathSync.native(short1040);
  transcript1040 = path.join(harnessClaudeHome(emeraldHome), 'projects', 'C--emerald-verify-m10-context', '10400000-0000-4000-8000-000000001040.jsonl');
  fs.mkdirSync(path.dirname(transcript1040), { recursive: true });
  const today1040 = new Date();
  const noon1040 = (daysBack) => new Date(today1040.getFullYear(), today1040.getMonth(), today1040.getDate() - daysBack, 12, 0, 0).getTime();
  const iso1040 = (at) => new Date(at).toISOString();
  const usage1040 = (total) => ({ input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: total - 2, output_tokens: 1 });
  const prompt1040 = (at, content) => ({ type: 'user', timestamp: iso1040(at), message: { role: 'user', content } });
  const reply1040 = (at, id, total, tools = []) => ({ type: 'assistant', timestamp: iso1040(at), message: { id, role: 'assistant', usage: usage1040(total), content: tools.map((t, i) => ({ type: 'tool_use', id: `toolu_${id}_${i}`, name: t.name, input: t.input ?? {} })) } });
  const old1040 = noon1040(10);
  const recent1040 = noon1040(3);
  const lines1040 = [
    prompt1040(old1040, 'start'),
    reply1040(old1040 + 1000, 'msg_1040_1', 5, [{ name: 'Skill', input: { skill: 'batch' } }]),
    reply1040(old1040 + 2000, 'msg_1040_2', 2000),
    prompt1040(old1040 + 3000, 'next'),
    prompt1040(recent1040, '<command-message>batch</command-message>\n<command-name>/batch</command-name>\n<command-args></command-args>'),
    { type: 'user', isMeta: true, timestamp: iso1040(recent1040 + 1), message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: C:\\x\\batch' }] } },
    reply1040(recent1040 + 1000, 'msg_1040_3', 1160),
    reply1040(recent1040 + 2000, 'msg_1040_4', 840, [{ name: 'mcp__claude-in-chrome__tabs_context_mcp' }]),
    prompt1040(recent1040 + 3000, 'done'),
  ];
  fs.writeFileSync(transcript1040, lines1040.map((l) => `${JSON.stringify(l)}\n`).join(''));
  await startSessionByKey(s, { kind: 'shell', cwd: context1040 });
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(context1040)}`, "the rail follows the new shell's folder (fix 1040)", 10000);
  const shell1040 = (await zreq(s, 'session.list', {})).sessions.find((x) => x.state !== 'exited' && x.cwd === context1040);
  expect(shell1040 !== undefined, 'the shell in the context folder (fix 1040)');
  // Read afresh: the fix 436 relaunch started another daemon.
  const daemon1040 = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const post1040 = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon1040.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon1040.hookToken, 'X-Emerald-Session': shell1040.id },
      body: JSON.stringify({ session_id: 'sim-files-1040', cwd: context1040, ...payload }),
    });
    expect(res.status === 204, `the sink answered 204 for ${payload.hook_event_name} (fix 1040)`);
  };
  await post1040({ hook_event_name: 'SessionStart', source: 'startup', transcript_path: transcript1040 });
  await post1040({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' }, workspace: { current_dir: context1040 }, context_window: { used_percentage: 43, context_window_size: 200000 } });
  const breakdown1040 = {
    ...breakdown1038,
    memoryFiles: [],
    mcpTools: [{ name: 'mcp__claude-in-chrome__tabs_context_mcp', serverName: 'claude-in-chrome', tokens: 400, isLoaded: true }],
    agents: [{ agentType: 'claude', source: 'userSettings', tokens: 410 }],
    skills: {
      totalSkills: 4,
      includedSkills: 4,
      tokens: 745,
      skillFrontmatter: [
        { name: 'ado', source: 'userSettings', tokens: 250 },
        { name: 'qa-story-refinement', source: 'userSettings', tokens: 230 },
        { name: 'batch', source: 'projectSettings', tokens: 250 },
        { name: 'anthropic-skills:pdf', source: 'syncedSkills', tokens: 15 },
      ],
    },
  };
  await post1040({ hook_event_name: 'Context', detail: 'summary', breakdown: breakdown1040 });
  for (let i = 0; i < 40; i++) {
    const got = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === shell1040.id);
    if (got?.context !== undefined && got.transcriptPath !== null) break;
    await sleep(200);
  }
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="context"]').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .rail-context[data-state="loaded"]')`, 'the Context tab loaded on the fix 1040 breakdown', 10000);
  const head1040 = (part) => `.files-rail .rail-context-section[data-part="${part}"] > .rail-context-head-row`;
  // MCP tools first: its server row counts this session's call off the
  // transcript's session part.
  await s.evalJs(`document.querySelector(${JSON.stringify(head1040('mcp'))}).click()`);
  await s.waitFor(`(document.querySelector('.files-rail .rail-context-server[data-server="claude-in-chrome"] .rail-context-item-sub')?.textContent ?? '').includes('call')`, "the server row's call count from the history", 20000);
  const mcp1040 = await s.evalJs(`document.querySelector('.files-rail .rail-context-server[data-server="claude-in-chrome"] .rail-context-item-sub')?.textContent ?? null`);
  expect(mcp1040 === '1 tool · 1 call', `the server row counts this session's one call: ${mcp1040}`);
  await s.evalJs(`document.querySelector(${JSON.stringify(head1040('skills'))}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .rail-context-skills [data-group="yours"]')`, 'the Skills section grouped by where each lives once the history is read', 20000);
  const rowSel1040 = (name) => `.files-rail .context-skills-row[data-skill=${JSON.stringify(name)}]`;
  const skills1040 = await s.evalJs(
    `(() => { const r = document.querySelector('.files-rail .rail-context-skills'); const batch = r.querySelector(${JSON.stringify(rowSel1040('batch').slice('.files-rail '.length))}); return { folder: r.querySelector('[data-group="folder"] .context-skills-group-head')?.textContent ?? null, yours: r.querySelector('[data-group="yours"] .context-skills-group-head')?.textContent ?? null, yoursRows: [...r.querySelectorAll('[data-group="yours"] .context-skills-row')].map((x) => x.dataset.skill).join(','), fold: r.querySelector('[data-group="yours"] .context-skills-fold .rail-context-item-name')?.textContent ?? null, last: batch?.querySelector('.context-skills-last')?.textContent ?? null, title: batch?.getAttribute('title') ?? null, groups: [...r.querySelectorAll('[data-group]')].map((g) => g.dataset.group).join(',') }; })()`,
  );
  expect(skills1040.folder === 'this folder, 1' && skills1040.yours === 'yours, 3, never used ~500 in every request' && skills1040.yoursRows === 'ado,qa-story-refinement' && skills1040.fold === '1 skill, < 20, pdf' && skills1040.groups === 'folder,yours', `the skills grouped by where each lives: ${JSON.stringify(skills1040)}`);
  expect(skills1040.last === '3 days' && skills1040.title === 'From this folder; 2k tokens in the turns it ran, over the last 7 days; 2 uses', `batch dated off the transcript, the ten-day use in its uses and not its tokens: ${JSON.stringify(skills1040)}`);
  const groupButton1105 = '.files-rail [data-group="yours"] > .listing-group-action > .listing-group-button';
  await s.waitFor(`document.querySelector(${JSON.stringify(groupButton1105)})?.textContent === 'Turn off these 2 ▾'`, 'fix 1105: the yours group\'s button counts its two never-used skills as these 2', 5000);
  // The listing: Off in this folder on qa-story-refinement.
  const local1040 = path.join(context1040, '.claude', 'settings.local.json');
  const user1040 = path.join(emeraldHome, 'claude-config', 'settings.json');
  await s.evalJs(`document.querySelector(${JSON.stringify(`${rowSel1040('qa-story-refinement')} .listing-switch`)}).click()`);
  await s.waitFor(`!!document.querySelector('.listing-menu[data-skill="qa-story-refinement"]')`, "qa-story-refinement's listing menu", 5000);
  const picked1040 = await s.evalJs(
    `(() => { let heading = null; for (const el of document.querySelectorAll('.listing-menu[data-skill="qa-story-refinement"] .menu-item')) { const label = el.querySelector('.menu-label'); const check = label?.querySelector('.menu-check')?.textContent ?? ''; const word = (label?.textContent ?? '').slice(check.length); if (el.classList.contains('menu-heading')) { heading = word; continue; } if (heading === 'In this folder' && word === 'Off') { el.click(); return true; } } return false; })()`,
  );
  expect(picked1040, 'Off under In this folder found in the menu');
  let wrote1040 = null;
  for (let i = 0; i < 50 && wrote1040 === null; i++) {
    try {
      const j = JSON.parse(fs.readFileSync(local1040, 'utf8'));
      if (j?.skillOverrides?.['qa-story-refinement'] === 'off') wrote1040 = j;
    } catch {
      // Not written yet.
    }
    if (wrote1040 === null) await sleep(100);
  }
  expect(wrote1040 !== null, `the folder's settings.local.json holds qa-story-refinement off: ${fs.existsSync(local1040) ? fs.readFileSync(local1040, 'utf8') : 'absent'}`);
  await s.waitFor(`document.querySelector(${JSON.stringify(`${rowSel1040('qa-story-refinement')} .rail-context-item-name`)})?.classList.contains('listing-off-name') === true && document.querySelector(${JSON.stringify(`${rowSel1040('qa-story-refinement')} .context-skills-last`)})?.textContent === 'off'`, 'the row struck through and its last used off', 5000);
  await s.waitFor(`document.querySelector(${JSON.stringify(groupButton1105)})?.textContent === 'Turn off ado ▾'`, 'fix 1105: with one left the button names it', 5000);
  let userOverride1040 = undefined;
  try {
    userOverride1040 = JSON.parse(fs.readFileSync(user1040, 'utf8'))?.skillOverrides?.['qa-story-refinement'];
  } catch {
    // No user settings file, or one that holds nothing for it.
  }
  expect(userOverride1040 === undefined, `the harness's every-folder settings hold nothing for it: ${userOverride1040}`);
  await s.evalJs(`document.querySelector('.files-rail .listing-undo').click()`);
  for (let i = 0; i < 50 && fs.existsSync(local1040); i++) await sleep(100);
  expect(!fs.existsSync(local1040), `Undo took the new settings.local.json back: ${fs.existsSync(local1040) ? fs.readFileSync(local1040, 'utf8') : 'absent'}`);
  // The context in a pane.
  await s.evalJs(`document.querySelector('.files-rail .rail-context-pane').click()`);
  await s.waitFor(`!!document.querySelector('.pane[data-view="context"] .context-view')`, 'the context opened in a pane', 10000);
  await s.waitFor(`!!document.querySelector('.pane[data-view="context"] .context-view-summary')`, "the pane's history read", 10000);
  const pane1040 = await s.evalJs(
    `(() => { const p = document.querySelector('.pane[data-view="context"]'); const cells = (name) => [...(p.querySelector('tr[data-row=' + JSON.stringify(name) + ']')?.querySelectorAll('td') ?? [])].slice(0, 5).map((c) => c.textContent).join(','); return { name: p.querySelector('.pane-name')?.textContent ?? null, picks: [...p.querySelectorAll('.context-view-pick')].map((b) => b.textContent).join(','), heads: [...p.querySelectorAll('.context-view-table th')].map((c) => c.textContent).join(','), batch: cells('batch'), qa: cells('qa-story-refinement'), sections: [...p.querySelectorAll('tr.context-view-section')].map((r) => r.dataset.section + ':' + r.textContent).join('|'), sort: p.querySelector('.context-view-sort')?.textContent ?? null, notes: [...p.querySelectorAll('.context-view-notes > div')].map((n) => n.textContent) }; })()`,
  );
  expect((pane1040.name ?? '').startsWith('Context of '), `the pane's title names the session: ${pane1040.name}`);
  expect(pane1040.picks === 'Skills 4,MCP servers 1,Custom agents 1,Memory files 0', `the four picks with their counts: ${pane1040.picks}`);
  expect(pane1040.heads === 'skill,context,7d tokens,uses,last used,in the listing', `the skills table's columns: ${pane1040.heads}`);
  expect(pane1040.batch === 'batch,~250,2k,2×,3 days' && pane1040.qa === 'qa-story-refinement,~230,-,0×,never', `the batch and qa-story-refinement rows: ${pane1040.batch} | ${pane1040.qa}`);
  expect(pane1040.sections === 'folder:this folder, 1|yours:yours, 3, never used ~500 in every request' && pane1040.sort === 'grouped by where each lives, the never used first in each', `the pane's section rows and sort word: ${pane1040.sections} | ${pane1040.sort}`);
  expect(
    pane1040.notes.length === 2 &&
      pane1040.notes[0] === "context: the skill's one-line listing, sent with every request; a dash is a skill not in the listing now, which costs nothing. The whole SKILL.md loads only when it runs." &&
      pane1040.notes[1] === '7d tokens: the tokens of the turns the skill ran in, over the last 7 days of sessions on this machine.',
    `the two column notes: ${JSON.stringify(pane1040.notes)}`,
  );
  await s.evalJs(`document.querySelector('.pane[data-view="context"] .context-view-pick[data-pick="servers"]').click()`);
  await s.waitFor(`!!document.querySelector('.pane[data-view="context"] tr[data-row="claude-in-chrome"]')`, 'the MCP servers table', 5000);
  const server1040 = await s.evalJs(`[...document.querySelectorAll('.pane[data-view="context"] tr[data-row="claude-in-chrome"] td')].map((c) => c.textContent)`);
  expect(server1040[3] === '1 call' && server1040[4] === '1', `claude-in-chrome: one call this session and one on the machine: ${server1040.join(',')}`);
  // Close the context pane through its menu and put the rail back.
  const box1040 = await s.evalJs(`(() => { const r = document.querySelector('.pane[data-view="context"] .context-view').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(box1040.x, box1040.y);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, "the context pane's menu", 5000);
  const closeTitle1040 = await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === 'Close pane')?.getAttribute('title') ?? null`);
  expect(closeTitle1040 === 'Close this pane; the Context tab of the files rail still has it', `the context pane's Close pane says the rail keeps it: ${closeTitle1040}`);
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === 'Close pane').click()`);
  await s.waitFor(`!document.querySelector('.pane[data-view="context"]')`, 'the context pane closed', 5000);
  if (rail1040 !== null) {
    await s.evalJs(`document.querySelector(${JSON.stringify(`.rail-tab[data-tab="${rail1040}"]`)}).click()`);
    await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === ${JSON.stringify(rail1040)}`, 'the rail back on the tab it was on');
  }
  step('M9 fix 1040: the Skills section groups the skills by where each lives and dates the used off a seeded transcript, a listing pick of Off writes the folder\'s settings.local.json and Undo takes it back, the group\'s button naming the one skill left (fix 1105), and the context opens in a pane with every column');

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
    if (context1040 !== null) fs.rmSync(context1040, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    if (transcript1056 !== null) fs.rmSync(transcript1056, { force: true });
    if (abort1102 !== null) abort1102.abort();
    if (transcript1040 !== null) fs.rmSync(path.dirname(transcript1040), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(rootMenuParent, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(openedPaths, { force: true });
  } catch {
    // Left for the next run.
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
