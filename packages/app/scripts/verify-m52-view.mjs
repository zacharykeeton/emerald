// M52 acceptance: a commits view in a pane. The rail's Commits tab,
// pressed and dragged onto the right band of a pane, lands as a pane of
// its own pinned to the folder the rail was on, with the repo's commits
// and its branch; over the centre of a pane holding a session it offers
// nothing; the pane keeps its folder when another folder's session takes
// focus; a folder heading's + menu puts a second view beside the focused
// pane; both come back after a renderer reload; the title bar's summary
// counts terminals only; and under a daemon that reports an older level
// the tab does not drag and the heading offers no view; the graph opens
// as a document tab from the rail's Expand and the heading (M61); a file
// row, the row menu and a file tab put a file in a pane (M9 fix 180); the
// rail follows a file tab or a file pane to its repository (M9 fix 331)
// and climbs above the folder it follows (M9 fix 332). Uses a private
// home and pipe unless the environment already names them.
// Run: npm run verify:view -w @emerald/app
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm52-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m52';
// M9 fix 225: the schemes handler reads this file as the person's Windows
// Terminal settings; the step writes it once the window is up.
const wtSettings = path.join(process.env['EMERALD_HOME'], 'wt-settings.json');
process.env['EMERALD_WT_SETTINGS'] = wtSettings;
// M9 fix 653: a folder's Ctrl+click and a file's Ctrl+Shift+click land in
// this file rather than opening Explorer beside the person (the
// verify-m10-files.mjs recipe); `launch` passes `process.env` on.
const openedPaths = path.join(os.tmpdir(), 'emerald-verify', `m52-opened-${process.pid}.log`);
fs.rmSync(openedPaths, { force: true });
process.env['EMERALD_OPEN_LOG'] = openedPaths;
const { clickNewShell, daemonPid, expect, focusedPaneIs, freshPort, getLayout, killTree, launch, leaves, sleep, startSessionByKey, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
// 71 s quiet at the close-out of fixes 494 to 541, and the load of a
// batch's first hour ran it past 180 s at step 26 to 32 of 34 three
// times, so 300 s is about four times a quiet run.
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 300 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 300000);

// A repo with two commits on main, so the view has rows and a branch to
// name. The identity is set in the repo so the commit works on a machine
// with no global one.
const repoShort = path.join(os.tmpdir(), 'emerald-verify', `m52-repo-${process.pid}`);
fs.rmSync(repoShort, { recursive: true, force: true });
fs.mkdirSync(repoShort, { recursive: true });
const repo = fs.realpathSync.native(repoShort);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'verify');
git('config', 'user.email', 'verify@example.invalid');
git('config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
git('add', '.');
git('commit', '-q', '-m', 'first');
fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
git('add', '.');
git('commit', '-q', '-m', 'second');

const home = os.homedir();
let s = await launch(freshPort(), { freshState: true });
app = s;

const boxOf = (paneId) =>
  s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
const centerOf = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const move = (p) => s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
const dragOn = () => s.evalJs(`document.body.classList.contains('dragging-session')`);
const zoneOn = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .drop-overlay')?.dataset.dropZone ?? null`);
const railRoot = () => s.evalJs(`document.querySelector('.files-rail')?.dataset.root ?? null`);
const tabSel = '.rail-tab[data-tab="timeline"]';
const viewPanes = () => s.evalJs(`[...document.querySelectorAll('.pane[data-view]')].map((p) => ({ id: p.dataset.paneId, view: p.dataset.view, folder: p.dataset.folder }))`);
const viewProbe = (paneId) =>
  s.evalJs(
    `(() => { const p = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]'); return { rows: p.querySelectorAll('.commits-row').length, branch: p.querySelector('.commits-branch-name')?.textContent ?? null, name: p.querySelector('.pane-name')?.textContent ?? null, cwd: p.querySelector('.pane-cwd')?.textContent ?? null, term: !!p.querySelector('.term-host'), buttons: p.querySelectorAll('.pane-title-actions button').length }; })()`,
  );
// A let: the fix 169 step below adds commits to the repo.
let commitCount = Number(git('rev-list', '--count', 'HEAD').trim());
// The + shows on hover, so its menu is opened by the event the right
// click would send, on the heading found by its group key in JS (a
// path in a CSS selector is a matter of escaping).
const addMenuItems = async (folder) => {
  const found = await s.evalJs(
    `(() => { const g = [...document.querySelectorAll('.sidebar-group')].find((x) => x.dataset.group === ${JSON.stringify(folder)}); const el = g?.querySelector('.sidebar-group-add'); if (!el) return [...document.querySelectorAll('.sidebar-group')].map((x) => x.dataset.group); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); return true; })()`,
  );
  expect(found === true, `the heading for ${folder} has a +, groups: ${JSON.stringify(found)}`);
  await s.waitFor(`!!document.querySelector('.group-menu')`, 'the + menu');
  return s.evalJs(`[...document.querySelectorAll('.group-menu .menu-item')].map((b) => b.querySelector('.menu-label').textContent)`);
};

try {
  // A shell in the home folder, then a second pane whose shell is in the
  // repo, focused, so the rail is on the repo.
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await clickNewShell(s, home);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'a shell in the first pane');
  let layout = await getLayout(s);
  const homePane = layout.focusedPaneId;
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(homePane)}] .pane-split-right').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2 && !!document.querySelector('.pane.focused .empty-pane')`, 'a second, empty pane');
  await startSessionByKey(s, { kind: 'shell', cwd: repo });
  layout = await getLayout(s);
  const repoPane = layout.focusedPaneId;
  expect(repoPane !== homePane, 'the repo shell took the second pane');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'the rail on the repo');
  await s.waitFor(`document.querySelector(${JSON.stringify(tabSel)})?.dataset.draggable !== undefined`, 'the Commits tab draggable');
  const summary = await s.evalJs(`document.querySelector('.title-bar-summary')?.textContent ?? null`);
  step(`a home shell and a repo shell, the rail on the repo; the title bar says ${summary}`);

  // The tab over the centre of the repo shell's pane: nothing offered.
  // Over its right band: the right half previewed; released, a pane of
  // its own pinned to the repo with the commits and the branch.
  const tab = await centerOf(tabSel);
  const repoBox = await boxOf(repoPane);
  const centre = { x: Math.round(repoBox.x + repoBox.width / 2), y: Math.round(repoBox.y + repoBox.height / 2) };
  const rightBand = { x: Math.round(repoBox.x + repoBox.width * 0.9), y: centre.y };
  await s.mouse('mousePressed', tab.x, tab.y);
  await move({ x: tab.x - 10, y: tab.y });
  await move(centre);
  expect(await dragOn(), 'the drag is on');
  expect((await zoneOn(repoPane)) === null, `no zone over the centre of a pane holding a session, got ${await zoneOn(repoPane)}`);
  await move(rightBand);
  expect((await zoneOn(repoPane)) === 'right', `the right band previewed, got ${await zoneOn(repoPane)}`);
  await s.mouse('mouseReleased', rightBand.x, rightBand.y);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === 1`, 'a view pane after the drop');
  expect(!(await dragOn()), 'the drag ended');
  let views = await viewPanes();
  const viewPane = views[0].id;
  expect(views[0].folder === repo, `the view is pinned to the repo, got ${views[0].folder}`);
  layout = await getLayout(s);
  const leaf = leaves(layout).find((p) => p.id === viewPane);
  expect(leaf !== undefined && leaf.sessionId === null && leaf.view?.kind === 'commits' && leaf.view.folder === repo, `the leaf holds the view and no session, got ${JSON.stringify(leaf)}`);
  expect(layout.focusedPaneId === viewPane, 'the new pane is focused');
  // The rail follows the focused view's folder, so the repo's files are
  // listed beside the graph rather than an empty rail.
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)} && [...document.querySelectorAll('.files-row .files-name')].some((n) => n.textContent === 'a.txt')`, 'the rail on the focused view\'s folder');
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(viewPane)}] .commits-branch-name')?.textContent === 'main'`, 'the branch off the log');
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(viewPane)}]').querySelectorAll('.commits-row').length === ${commitCount}`, 'the commits listed');
  const probe = await viewProbe(viewPane);
  expect(probe.name === path.basename(repo) && probe.cwd === repo && !probe.term && probe.buttons === 5, `the title names the folder with the five buttons (the focus button among them since M9 fix 181) and no terminal, got ${JSON.stringify(probe)}`);
  expect((await s.evalJs(`document.querySelectorAll('.term-host').length`)) === 2, 'the two terminals are untouched');
  const summaryAfter = await s.evalJs(`document.querySelector('.title-bar-summary')?.textContent ?? null`);
  expect(summaryAfter === summary, `the title bar counts terminals only, got ${summaryAfter} against ${summary}`);
  await s.screenshot('m52-view-drop.png');
  step(`the Commits tab dropped on the right band: a view pane on the repo, ${commitCount} commits on main, the summary still ${summaryAfter}`);

  // M9 fix 130: the commits pane is the graph alone. M66's strip above
  // the commits, with its folder, all and tab scopes, went with the pane
  // button each of the rail's sections now has: the strip stays in the
  // rail, where its folder and all scopes are read here since the pane
  // was where they used to be exercised, and the tab scope, which only
  // a pane had, is gone.
  const viewPaneSel = `[data-pane-id=${JSON.stringify(viewPane)}]`;
  const paneBody = await s.evalJs(`(() => { const p = document.querySelector(${JSON.stringify(viewPaneSel)}); const body = p.querySelector('.pane-view'); return { card: !!p.querySelector('.activity-card'), first: body?.firstElementChild?.className ?? null, rows: p.querySelectorAll('.commits-row').length }; })()`);
  expect(!paneBody.card && paneBody.first === 'commits-panel' && paneBody.rows === commitCount, `the view pane holds the commits panel first and no strip, got ${JSON.stringify(paneBody)}`);
  expect(leaves(await getLayout(s)).find((p) => p.id === viewPane)?.view?.strip === undefined, 'the view carries no strip scope');
  step('M9 fix 130: the view pane is the graph alone, no strip above it');

  // The rail's own strip section, on the repo since the view pane is
  // focused: folder and all, the tooltip saying which (M9 fix 125), the
  // choice in localStorage rather than the layout.
  const railScope = () => s.evalJs(`(() => { const c = document.querySelector('.files-rail .activity-card[data-place="rail"]'); const b = c?.querySelector('.activity-scope'); return c && b ? { scope: c.dataset.scope, sessions: Number(c.dataset.sessions), title: b.title, text: c.querySelector('.activity-text')?.textContent ?? null } : null; })()`);
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .activity-card[data-place="rail"] .activity-scope')`, "the rail's strip section on the repo with its scope toggle");
  let rail = await railScope();
  expect(rail.scope === 'folder' && rail.sessions === 1 && rail.title === 'This folder only; click for every session of the day' && rail.text.startsWith(`today · ${path.basename(repo)} · `), `the rail's strip keeps to the folder and names it, got ${JSON.stringify(rail)}`);
  const listed = await s.evalJs(`document.querySelectorAll('.sidebar-row').length`);
  await s.evalJs(`document.querySelector('.files-rail .activity-card[data-place="rail"] .activity-scope').click()`);
  await s.waitFor(`document.querySelector('.files-rail .activity-card[data-place="rail"]')?.dataset.scope === 'all'`, 'every session of the day');
  rail = await railScope();
  expect(rail.sessions === listed && rail.title === 'Every session of the day; click for this folder only', `all: as many as the sidebar lists (${listed}), got ${JSON.stringify(rail)}`);
  await s.evalJs(`document.querySelector('.files-rail .activity-card[data-place="rail"] .activity-scope').click()`);
  await s.waitFor(`document.querySelector('.files-rail .activity-card[data-place="rail"]')?.dataset.scope === 'folder'`, 'the folder again');
  step("M66: the rail's strip section scopes to the folder or every session, the tooltip saying which");

  // Focus on the home shell moves the rail to home; the view keeps its
  // folder.
  const homeBox = await boxOf(homePane);
  await s.click(Math.round(homeBox.x + homeBox.width / 2), Math.round(homeBox.y + homeBox.height / 2));
  await s.waitFor(focusedPaneIs(homePane), 'the home shell focused');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(home)}`, 'the rail on home');
  views = await viewPanes();
  expect(views.length === 1 && views[0].folder === repo, `the view stays on the repo, got ${JSON.stringify(views)}`);
  // The panel re-reads the log when focus moves (M35), so the branch line
  // is waited for rather than read at once; it read null once in a full run.
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(viewPane)}] .commits-branch-name')?.textContent === 'main'`, 'the branch line stays');
  step('another folder focused: the rail follows, the view pane keeps its folder');

  // Commits in a pane from the repo heading's + menu: a second view,
  // beside the focused (home) pane.
  const items = await addMenuItems(repo);
  expect(items.includes('Commits in a pane'), `the + menu offers a commits view, got ${JSON.stringify(items)}`);
  await s.evalJs(`[...document.querySelectorAll('.group-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Commits in a pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === 2`, 'a second view pane');
  views = await viewPanes();
  const second = views.find((v) => v.id !== viewPane);
  expect(second !== undefined && second.folder === repo, `the second view is on the repo, got ${JSON.stringify(views)}`);
  layout = await getLayout(s);
  expect(layout.focusedPaneId === second.id, 'the second view is focused');
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(second.id)}]').querySelectorAll('.commits-row').length === ${commitCount}`, 'the second view lists the commits');
  const beforeReload = leaves(layout).map((p) => ({ id: p.id, sessionId: p.sessionId, view: p.view }));
  step('Commits in a pane from the heading: a second view beside the focused pane');

  // A renderer reload: both views back from the daemon's layout.
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body')`, 'app after reload');
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === 2 && document.querySelectorAll('.term-host').length === 2`, 'two views and two terminals after reload');
  layout = await getLayout(s);
  const afterReload = leaves(layout).map((p) => ({ id: p.id, sessionId: p.sessionId, view: p.view }));
  expect(JSON.stringify(afterReload) === JSON.stringify(beforeReload), `the same leaves after reload, got ${JSON.stringify(afterReload)}`);
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(viewPane)}]').querySelectorAll('.commits-row').length === ${commitCount}`, 'the first view lists the commits again');
  step('renderer reload: both views back with their folder');

  // M69: the rail's Commits panel offers the graph in a pane beside the
  // focused one, the same view the heading's menu opens; closed again
  // through its title so the relaunch below still finds four panes.
  const focusedBefore = (await getLayout(s)).focusedPaneId;
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .commits-open-pane')`, 'the rail offers the graph in a pane');
  // M9 fix 219: the two open buttons wear icons that say tab and pane, no
  // text glyph left in either.
  const openIcons = await s.evalJs(`(() => { const t = document.querySelector('.files-rail .commits-expand'); const p = document.querySelector('.files-rail .commits-open-pane'); return { tab: !!t?.querySelector('svg.open-icon'), pane: !!p?.querySelector('svg.open-icon'), tabText: t?.textContent.trim() ?? null, paneText: p?.textContent.trim() ?? null, titles: [t?.title, p?.title] }; })()`);
  expect(openIcons.tab && openIcons.pane && openIcons.tabText === '' && openIcons.paneText === '' && openIcons.titles[0] === 'Open the graph as a tab' && openIcons.titles[1] === 'Open the graph in a pane', `the rail's commit open buttons carry a tab icon and a pane icon with their titles (${JSON.stringify(openIcons)})`);
  await s.evalJs(`document.querySelector('.files-rail .commits-open-pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === 3`, 'a third view pane');
  layout = await getLayout(s);
  const third = leaves(layout).find((p) => p.view !== null && !beforeReload.some((b) => b.id === p.id));
  expect(third !== undefined && third.view.kind === 'commits' && third.view.folder === repo && layout.focusedPaneId === third.id, `the new pane holds the repo's graph and is focused, got ${JSON.stringify(third)}`);
  expect(third.id !== focusedBefore, 'the pane is a new one beside the focused pane, not the focused pane itself');
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(third.id)}]').querySelectorAll('.commits-row').length === ${commitCount}`, 'the new pane lists the commits');
  const thirdProbe = await s.evalJs(`(() => { const p = document.querySelector('[data-pane-id=${JSON.stringify(third.id)}]'); return { name: p.querySelector('.pane-name')?.textContent ?? null, strip: !!p.querySelector('.activity-card'), rows: p.querySelectorAll('.commits-row').length }; })()`);
  expect(thirdProbe.name === path.basename(repo) && !thirdProbe.strip && thirdProbe.rows === commitCount, `the pane is titled for the folder with ${commitCount} commits and no strip (M9 fix 130), got ${JSON.stringify(thirdProbe)}`);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(third.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === 2`, 'the third pane closed again');
  step("M69: the rail's Commits panel opens the graph in a pane beside the focused one");

  // M9 fix 161: a commits pane folds its branch line and its tools row
  // away behind its own button, the graph staying; the rail's section
  // keeps its rows; the pane's menu is the way back, its item flipping;
  // the choice survives a reload. M9 fix 179: the fold is the pane's
  // chrome, the title bar going with the rows, one pane's own on its
  // view record, the menu on the bare box. The pane is opened from the
  // rail again (once the repo's view pane is focused again, since the
  // close above moved the focus and the rail follows it) and closed
  // through its title after, as above.
  const foldFocus = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(viewPane)}] .pane-view').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(Math.round(foldFocus.x), Math.round(foldFocus.y));
  await s.waitFor(focusedPaneIs(viewPane), 'the first view pane focused for the fold');
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .commits-open-pane')`, 'the rail offers the graph in a pane for the fold');
  await s.evalJs(`document.querySelector('.files-rail .commits-open-pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === 3`, 'a pane to fold');
  const foldPane = leaves(await getLayout(s)).find((p) => p.view !== null && !beforeReload.some((b) => b.id === p.id)).id;
  const foldSel = `[data-pane-id=${JSON.stringify(foldPane)}] .commits-panel`;
  const foldProbe = () => s.evalJs(`(() => { const p = document.querySelector(${JSON.stringify(foldSel)}); const pane = p.closest('.pane'); const other = document.querySelector('[data-pane-id=${JSON.stringify(viewPane)}]'); const rail = document.querySelector('.files-rail .commits-panel'); return { state: p.dataset.controls ?? null, chrome: pane.dataset.chrome, title: !!pane.querySelector('.pane-title'), otherChrome: other.dataset.chrome, otherTitle: !!other.querySelector('.pane-title'), branch: !!p.querySelector('.commits-branch'), tools: !!p.querySelector('.commits-tools'), fold: !!p.querySelector('.commits-controls-fold'), rows: p.querySelectorAll('.commits-row').length, railBranch: !!rail?.querySelector('.commits-branch'), railTools: !!rail?.querySelector('.commits-tools'), railState: rail?.dataset.controls ?? null }; })()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.querySelectorAll('.commits-row').length === ${commitCount} && !!document.querySelector('.files-rail .commits-panel .commits-branch')`, 'the pane and the rail both list the repo');
  let fold = await foldProbe();
  expect(fold.state === 'shown' && fold.chrome === 'shown' && fold.title && fold.branch && fold.tools && fold.fold && fold.railBranch && fold.railTools && fold.railState === null, `the pane starts with its chrome, its two rows and the fold button, the rail's section carries no flag (${JSON.stringify(fold)})`);
  // The bare box's top-left corner, where the title bar was, for the
  // right-click once the chrome is gone; the view's own menus yield there.
  const foldTitle = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(foldPane)}]').getBoundingClientRect(); return { x: r.x + 40, y: r.y + 10 }; })()`);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-controls-fold').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.dataset.controls === 'folded'`, 'the controls folded');
  fold = await foldProbe();
  expect(!fold.branch && !fold.tools && !fold.title && fold.chrome === 'hidden' && fold.rows === commitCount && fold.railBranch && fold.railTools && fold.otherChrome === 'shown' && fold.otherTitle, `the pane is the graph alone with no title bar, the rail keeps its rows, the other commits pane keeps its chrome (${JSON.stringify(fold)})`);
  expect(leaves(await getLayout(s)).find((p) => p.id === foldPane).view.chrome === false, 'the chrome flag rides the view record');
  await s.screenshot('m9-fix179-commits-chromeless.png');
  await s.rightClick(foldTitle.x, foldTitle.y);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, "the commits pane's menu on the bare box");
  const foldItems = await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].map((b) => b.querySelector('.menu-label').textContent)`);
  expect(foldItems[0] === 'Show the chrome' && !(await s.evalJs(`!!document.querySelector('.commits-menu, .commits-row-menu')`)), `the menu leads with Show the chrome and the graph's own menu stays shut, got ${JSON.stringify(foldItems)}`);
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Show the chrome').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.dataset.controls === 'shown' && !document.querySelector('.pane-menu')`, 'the rows back and the menu gone');
  fold = await foldProbe();
  expect(fold.branch && fold.tools && fold.fold && fold.title && fold.chrome === 'shown', `both rows and the title bar are back with the fold button (${JSON.stringify(fold)})`);
  expect(leaves(await getLayout(s)).find((p) => p.id === foldPane).view.chrome === undefined, 'the chrome shown reads as no field on the record');
  await s.rightClick(foldTitle.x, foldTitle.y);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, 'the menu again');
  expect((await s.evalJs(`document.querySelector('.pane-menu .menu-item .menu-label')?.textContent`)) === 'Hide the chrome', 'the menu now offers Hide the chrome');
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Hide the chrome').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.dataset.controls === 'folded' && !document.querySelector('.pane-menu')`, 'folded from the menu');
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body')`, 'app after the fold reload');
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.dataset.controls === 'folded'`, 'the fold survives the reload', 20000);
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .commits-panel .commits-branch') && document.querySelector(${JSON.stringify(foldSel)})?.querySelectorAll('.commits-row').length === ${commitCount}`, "the rail's section and the pane's rows after the reload");
  fold = await foldProbe();
  expect(!fold.branch && !fold.tools && !fold.title && fold.railBranch && fold.railTools && fold.otherTitle, `after the reload the pane is still the bare graph and the rail still has its rows (${JSON.stringify(fold)})`);
  await s.rightClick(foldTitle.x, foldTitle.y);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, 'the menu on the bare box after the reload');
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Show the chrome').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.dataset.controls === 'shown' && !document.querySelector('.pane-menu')`, 'the chrome back for the steps below', 20000);
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .commits-open-pane')`, 'the rail on the Activity tab again');
  step("M9 fix 161 and 179: a commits pane folds its title bar, branch line and tools row away, the rail and the other pane keep theirs, the menu on the bare box brings them back, the flag survives a reload on the record");

  // M9 fix 162: the rows button on the pane's tools row takes the commit
  // rows away, leaving the gutter alone with no labels in it (M9 fix
  // 173: the pills and agent labels it drew turned upright stacked into
  // one column of rotated text on a run of branch tips) and no leader
  // from a mark; the rail keeps its rows, its own button (M9 fix 171)
  // untouched; the flag rides the pane's view record, so it survives a
  // reload and reads back off the layout. The same pane as above.
  const rowsProbe = () => s.evalJs(`(() => { const p = document.querySelector(${JSON.stringify(foldSel)}); const svg = p.querySelector('.commits-graph') ?? document.createElement('svg'); const rail = document.querySelector('.files-rail .commits-panel'); const room = !!p.querySelector('.commits-room'); const labels = [...svg.querySelectorAll('.commits-label')].map((l) => ({ text: l.firstChild?.nodeValue ?? '', agent: 'agent' in l.dataset, turned: (l.getAttribute('transform') ?? '').startsWith('rotate(-90') })); return { state: p.dataset.rows, room, viewState: p.querySelector('.commits-graph-view')?.dataset.rows ?? null, rows: p.querySelectorAll('.commits-row').length, button: !!p.querySelector('.commits-rows'), pressed: p.querySelector('.commits-rows')?.dataset.active !== undefined, svgLabels: svg.dataset?.labels !== undefined, hasSvg: !!p.querySelector('.commits-graph'), labels, marks: svg.querySelectorAll('.commits-agent-node').length, railRows: rail.querySelectorAll('.commits-row').length, railButton: !!rail.querySelector('.commits-rows'), railPressed: rail.querySelector('.commits-rows')?.dataset.active !== undefined, leaders: svg.querySelectorAll('.commits-leader').length, nodes: svg.querySelectorAll('.commits-node').length }; })()`);
  let rowsOn = await rowsProbe();
  expect(rowsOn.state === 'on' && rowsOn.rows === commitCount && rowsOn.button && !rowsOn.pressed && !rowsOn.svgLabels && rowsOn.labels.length === 0 && rowsOn.railButton && !rowsOn.railPressed, `the pane starts with its rows, the button unpressed, no labels in the SVG, and the rail has a rows button of its own, unpressed (${JSON.stringify(rowsOn)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-rows').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.dataset.rows === 'off'`, 'the rows off');
  let rowsOff = await rowsProbe();
  expect(rowsOff.viewState === 'off' && rowsOff.rows === 0 && rowsOff.pressed && !rowsOff.svgLabels && rowsOff.labels.length === 0, `the pane is the gutter alone with the button pressed and no label in the SVG (${JSON.stringify(rowsOff)})`);
  expect(rowsOff.leaders === 0, `no leader toward rows that are not there (${JSON.stringify(rowsOff)})`);
  expect(rowsOff.railRows === commitCount && !rowsOff.railPressed, `the rail keeps its rows and its button stays unpressed (${JSON.stringify(rowsOff)})`);
  await s.screenshot('m9-fix162-lines.png');
  // M9 fix 169: with the rows off the upright view has room past both
  // ends, the list's height less 48px each, the newest end's before the
  // gutter when the newest commit is at the top; the first show parks
  // the tip 48px from the bottom edge, and a commit that lands walks
  // the tip up into the room while the scroll compensates so the old
  // rows stay put. Turned round, the room is after the gutter, the tip
  // sits 48px from the top and a commit walks it down under a scroll
  // that stays. With the rows on there is no room at all (read above,
  // before the rows went off). The tip is read against the box in
  // content coordinates, as the sideways step of verify:graph does.
  const roomProbe = () =>
    s.evalJs(
      `(() => { const p = document.querySelector(${JSON.stringify(foldSel)}); const v = p.querySelector('.commits-graph-view'); const box = v.parentElement; const svg = v.querySelector('.commits-graph'); const room = v.querySelector('.commits-room'); const old = v.querySelector('.commits-room-old'); const n = +svg.dataset.rows; const reverse = 'reverse' in v.dataset; const svgTop = svg.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop; const tip = svgTop + (reverse ? n - 1 : 0) * 22 + 11; const b = svg.getBBox(); return { n, reverse, boxH: box.clientHeight, scrollH: box.scrollHeight, scrollTop: box.scrollTop, tip, tipFromTop: tip - box.scrollTop, roomH: room ? room.getBoundingClientRect().height : null, oldH: old ? old.getBoundingClientRect().height : null, svgH: +svg.getAttribute('height'), roomFirst: room ? room.nextElementSibling?.classList.contains('commits-gutter-box') === true : null, column: getComputedStyle(v).flexDirection, anchor: getComputedStyle(box).overflowAnchor, drawnMid: svgTop + b.y + b.height / 2 - box.scrollTop }; })()`,
    );
  expect(rowsOn.room === false, `with the rows on there is no room (${JSON.stringify(rowsOn.room)})`);
  let room = await roomProbe();
  expect(room.n === commitCount && !room.reverse && room.column === 'column' && room.anchor === 'none', `the rows-off view stacks its parts with the box's anchoring off (${JSON.stringify(room)})`);
  // M9 fix 211: the old room is half of what the list has over the
  // drawing, what a centre needs and no more.
  expect(room.roomH !== null && Math.abs(room.roomH - (room.boxH - 48)) < 2 && room.oldH !== null && Math.abs(room.oldH - Math.max(0, (room.boxH - room.svgH) / 2)) < 2 && room.roomFirst, `a spacer before the gutter the list's height less 48px, and one after it half of what the list has over the drawing (${JSON.stringify(room)})`);
  // The extent is the two rooms plus the drawing (M9 fix 211), where it
  // was the tip plus a second full room before.
  expect(Math.abs(room.scrollH - (room.roomH + room.svgH + room.oldH)) < 2, `the list scrolls the two rooms plus the drawing (${JSON.stringify(room)})`);
  expect(Math.abs(room.tipFromTop - (room.boxH - 48)) < 12, `the first show parks the newest tip 48px from the bottom edge (${JSON.stringify(room)})`);
  await s.screenshot('m9-fix169-room.png');
  fs.writeFileSync(path.join(repo, 'd.txt'), 'd\n');
  git('add', '.');
  git('commit', '-q', '-m', 'fourth');
  await s.waitFor(`+document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph')?.dataset.rows === ${commitCount + 1}`, 'the fourth commit on the graph', 10000);
  let grown = await roomProbe();
  expect(grown.n === commitCount + 1 && Math.abs(grown.scrollTop - (room.scrollTop + 22)) < 2, `the scroll moved down one row with the commit that landed above, so the old rows stay put (${JSON.stringify(grown)})`);
  expect(Math.abs(grown.tipFromTop - (room.tipFromTop - 22)) < 2, `the new tip is one row further up, into the room (${JSON.stringify(grown)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-direction').click()`);
  await s.waitFor(`'reverse' in document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view').dataset`, 'the pane turned round');
  room = await roomProbe();
  expect(room.reverse && room.roomFirst === false && room.roomH !== null && Math.abs(room.roomH - (room.boxH - 48)) < 2, `turned round, the room past the newest end is after the gutter (${JSON.stringify(room)})`);
  expect(Math.abs(room.tipFromTop - 48) < 12, `the turn parks the newest tip 48px from the top edge (${JSON.stringify(room)})`);
  // The oldest drawn node sits at the top in reverse; a commit at the
  // bottom must leave it where it is (fix 210's anchor holds it, moving
  // the scroll as fix 211's old room resizes with the drawing), which is
  // the real invariant, where before fix 211 the old room was fixed and
  // the scroll stood still. verify:graph proves the same for a named node.
  const oldestNodeY = () =>
    s.evalJs(
      `(() => { const v = document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view'); const box = v.parentElement; const nodes = [...v.querySelectorAll('.commits-node')]; if (nodes.length === 0) return null; const top = box.getBoundingClientRect().top; return Math.min(...nodes.map((n) => n.getBoundingClientRect().top - top)); })()`,
    );
  const heldBefore = await oldestNodeY();
  fs.writeFileSync(path.join(repo, 'e.txt'), 'e\n');
  git('add', '.');
  git('commit', '-q', '-m', 'fifth');
  await s.waitFor(`+document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph')?.dataset.rows === ${commitCount + 2}`, 'the fifth commit on the graph', 10000);
  grown = await roomProbe();
  const heldAfter = await oldestNodeY();
  expect(heldBefore !== null && heldAfter !== null && Math.abs(heldAfter - heldBefore) < 2 && Math.abs(grown.tipFromTop - (room.tipFromTop + 22)) < 2, `newest at the bottom, the oldest node holds its place and the tip walks down into the room (before ${heldBefore}, after ${heldAfter}, ${JSON.stringify(grown)})`);
  commitCount += 2;
  step('M9 fix 169: with the rows off the upright graph has room past both ends, the tip parks 48px from the edge and a commit walks it into the room either way up');

  // M9 fix 170: the tools row's centre button and the menu's item put
  // the drawn extent in the middle of the list, from wherever it was
  // scrolled, either way up. The menu opens on a right click over the
  // view; the item sits under the direction pair.
  const centreProbe = async () => (await roomProbe()).drawnMid;
  // Scrolled to the bottom (M9 fix 211: at the top a short graph is
  // already in the middle, since the old room is exactly what puts it
  // there), the graph is off centre.
  await s.evalJs(`(() => { const box = document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view').parentElement; box.scrollTop = box.scrollHeight; })()`);
  expect(Math.abs((await centreProbe()) - room.boxH / 2) > 40, 'scrolled to the bottom, the graph is off centre');
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-centre').click()`);
  let mid = await centreProbe();
  expect(Math.abs(mid - room.boxH / 2) < 12, `the button centres the drawn graph in the list (${mid} of ${room.boxH})`);
  await s.screenshot('m9-fix170-centred.png');
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view').parentElement.scrollTop = 0`);
  const viewMid = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(foldSel)} + ' .commits-gutter-box').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(Math.round(viewMid.x), Math.round(viewMid.y));
  await s.waitFor(`!!document.querySelector('.commits-menu')`, "the graph's menu");
  const menuItems = await s.evalJs(`[...document.querySelectorAll('.commits-menu .menu-item')].map((b) => b.querySelector('.menu-label').textContent.trim())`);
  expect(menuItems.at(-1) === 'Centre the graph' && menuItems.at(-2).endsWith('Oldest first'), `Centre the graph closes the menu under the direction pair, got ${JSON.stringify(menuItems)}`);
  await s.evalJs(`[...document.querySelectorAll('.commits-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent.trim() === 'Centre the graph').click()`);
  await s.waitFor(`!document.querySelector('.commits-menu')`, 'the menu closed');
  mid = await centreProbe();
  expect(Math.abs(mid - room.boxH / 2) < 12, `the menu item centres it too (${mid} of ${room.boxH})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-direction').click()`);
  await s.waitFor(`!('reverse' in document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view').dataset)`, 'newest first again');
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view').parentElement.scrollTop = 0`);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-centre').click()`);
  mid = await centreProbe();
  expect(Math.abs(mid - room.boxH / 2) < 12, `newest first, the button centres it as well (${mid} of ${room.boxH})`);
  step('M9 fix 170: the centre button and the menu item put the drawn graph in the middle of the pane either way up');
  // M9 fix 175: the same click puts the drawing in the middle across
  // the pane too. The gutter takes the pane's width with the rows off
  // and the lone lane sat at its left edge; now a margin before the SVG
  // (`--commits-centre` on the view) carries it to the middle, and the
  // view drops the margin when the rows come back.
  const acrossProbe = () =>
    s.evalJs(
      `(() => { const v = document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view'); const gutter = v.querySelector('.commits-gutter'); const svg = v.querySelector('.commits-graph'); const b = svg.getBBox(); const left = svg.getBoundingClientRect().left - gutter.getBoundingClientRect().left; return { width: gutter.clientWidth, drawnMid: left + b.x + b.width / 2, offset: v.style.getPropertyValue('--commits-centre'), scrollLeft: gutter.scrollLeft }; })()`,
    );
  let across = await acrossProbe();
  expect(across.offset !== '' && Math.abs(across.drawnMid - across.width / 2) < 12 && across.scrollLeft === 0, `the button centres the drawn graph across the pane as well, by a margin (${JSON.stringify(across)})`);
  await s.screenshot('m9-fix175-centred-across.png');
  // M9 fix 188: the centre is held (`data-centred` on the view) and the
  // gutter's ResizeObserver runs the across half again, so the pane
  // made narrower keeps the drawing in the middle; the rows coming
  // back drop the hold with the margin. The viewport is emulated
  // narrower for the read and put back after.
  const heldProbe = () => s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view').dataset.centred !== undefined`);
  expect(await heldProbe(), 'the centre is held on the view');
  const viewportW = await s.evalJs(`({ width: window.innerWidth, height: window.innerHeight })`);
  await s.send('Emulation.setDeviceMetricsOverride', { width: viewportW.width - 200, height: viewportW.height, deviceScaleFactor: 0, mobile: false });
  await s.waitFor(`window.innerWidth === ${viewportW.width - 200}`, 'a narrower viewport');
  await sleep(300);
  const narrower = await acrossProbe();
  expect((await heldProbe()) && narrower.width < across.width && narrower.offset !== across.offset && Math.abs(narrower.drawnMid - narrower.width / 2) < 12, `the pane made narrower, the drawing is centred again by a new margin (${JSON.stringify([across, narrower])})`);
  await s.send('Emulation.clearDeviceMetricsOverride');
  await s.waitFor(`window.innerWidth === ${viewportW.width}`, 'the viewport back');
  await sleep(300);
  across = await acrossProbe();
  expect((await heldProbe()) && Math.abs(across.drawnMid - across.width / 2) < 12, `and back to its width, centred still (${JSON.stringify(across)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-rows').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view')?.dataset.rows === 'on'`, 'the rows back');
  across = await acrossProbe();
  expect(across.offset === '' && !(await heldProbe()), `the rows back, the margin and the hold are dropped (${JSON.stringify(across)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-rows').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view')?.dataset.rows === 'off'`, 'the rows off again');
  step('M9 fix 175 and 188: the centre button puts the drawn graph in the middle across the pane, holds it there when the pane is made narrower, and the rows coming back drops the margin');
  // Five branch tips a row apart, the case that stacked the turned pills
  // into one column: bare now, and gone again once the branches are.
  for (let i = 1; i <= 5; i++) {
    git('checkout', '-q', '-b', `tip${i}`);
    fs.writeFileSync(path.join(repo, `tip${i}.txt`), `${i}\n`);
    git('add', '.');
    git('commit', '-q', '-m', `tip ${i}`);
  }
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.querySelectorAll('.commits-node').length === ${commitCount + 5}`, 'five tips on the graph', 15000);
  // A poll that lands on a git write mid-way answers no commits and the
  // graph is gone for one render; the trailing poll puts it back.
  await sleep(600);
  rowsOff = await rowsProbe();
  expect(rowsOff.nodes === commitCount + 5 && rowsOff.labels.length === 0 && !rowsOff.svgLabels, `five tips a row apart draw with no pill turned beside them (${JSON.stringify(rowsOff)})`);
  await s.screenshot('m9-fix173-upright-bare.png');
  // M9 fix 187: on its side in a short pane the view is the box that fits
  // the pane and scrolls both ways, so the sideways scrollbar sits at
  // the bottom of what the person sees. It used to be its drawing's
  // height with a floor of the list's, inside a list that scrolled it,
  // so with the six lanes of the tips taller than a short pane the bar
  // went below the fold. The viewport is emulated short for the read
  // and put back after; the box around the view carries the fades of
  // fix 141 at its cut edges. The fold pane is narrow with four panes on
  // the row, so its wrapped header alone runs to about 250 px; at 260
  // the pane body kept a pixel or two on some runs and none on others,
  // and with none the view's `height: 100%` read 0 and its bottom sat
  // past the pane's (the fixes 288 and 303 close-outs each lost a run to
  // it). 300 leaves the header its room and the view about 40 px, still
  // under the 74 px drawing, which is what the step is about.
  const viewport = await s.evalJs(`({ width: window.innerWidth, height: window.innerHeight })`);
  await s.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: 300, deviceScaleFactor: 0, mobile: false });
  await s.waitFor(`window.innerHeight === 300`, 'a short viewport');
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-orient').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph')?.dataset.orientation === 'horizontal'`, 'the fold pane on its side');
  // The flip and the emulated short viewport both trigger a reflow, and
  // the view's height lands a frame or two after the orientation flag; a
  // fixed sleep read it collapsed (clientHeight 0) on a slow machine, so
  // wait for the view to fill the pane and settle before the reads.
  const viewH = () => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(foldPane)}] .commits-graph-view')?.clientHeight ?? 0`);
  {
    const deadline = Date.now() + 6000;
    let last = -1;
    while (Date.now() < deadline) {
      const h = await viewH();
      if (h > 20 && h === last) break;
      last = h;
      await sleep(200);
    }
  }
  const sideProbe = () =>
    s.evalJs(
      `(() => { const p = document.querySelector('[data-pane-id=${JSON.stringify(foldPane)}]'); const v = p.querySelector('.commits-graph-view'); const box = v.parentElement; const svg = v.querySelector('.commits-graph'); const pr = p.getBoundingClientRect(); const vr = v.getBoundingClientRect(); const on = (side) => getComputedStyle(box, side).content !== 'none'; return { paneBottom: pr.bottom, viewBottom: vr.bottom, viewHeight: vr.height, clientHeight: v.clientHeight, svgHeight: svg.getBoundingClientRect().height, scrollWidth: v.scrollWidth, clientWidth: v.clientWidth, scrollHeight: v.scrollHeight, overflow: getComputedStyle(v).overflowY, box: box.classList.contains('commits-view-box'), gutter: box.dataset.gutter ?? null, back: box.dataset.gutterBack !== undefined, right: on('::after'), left: on('::before'), scrollLeft: v.scrollLeft }; })()`,
    );
  let side = await sideProbe();
  expect(side.box && side.overflow === 'auto' && Math.abs(side.viewBottom - side.paneBottom) < 1 && side.viewHeight < 120, `the sideways view in a short pane ends at the pane's bottom edge, in a box of its own (${JSON.stringify(side)})`);
  expect(side.svgHeight > side.clientHeight && side.scrollHeight > side.clientHeight && side.scrollWidth > side.clientWidth, `its drawing is taller than the view, which scrolls both ways (${JSON.stringify(side)})`);
  expect(side.gutter === 'scrolls' && side.back && side.right && side.left, `scrolled in from the first show, the box fades both edges (${JSON.stringify(side)})`);
  await s.screenshot('m9-fix187-short-sideways.png');
  const scrollSide = (to) => s.evalJs(`(() => { const v = document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph-view'); v.scrollLeft = ${to}; v.dispatchEvent(new Event('scroll')); return v.scrollLeft; })()`);
  await scrollSide(0);
  side = await sideProbe();
  expect(side.gutter === 'scrolls' && !side.back && side.right && !side.left, `at the start the right fade alone (${JSON.stringify(side)})`);
  await scrollSide(100000);
  side = await sideProbe();
  expect(side.gutter === 'end' && side.back && !side.right && side.left, `at the end the left fade alone (${JSON.stringify(side)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-orient').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph')?.dataset.orientation === 'vertical'`, 'the fold pane upright again');
  await s.send('Emulation.clearDeviceMetricsOverride');
  await s.waitFor(`window.innerHeight === ${viewport.height}`, 'the viewport back');
  step("M9 fix 187: on its side in a short pane the view is the box that fits, its sideways scrollbar at the pane's bottom edge and the fades on the box around it");
  git('checkout', '-q', 'main');
  for (let i = 1; i <= 5; i++) git('branch', '-q', '-D', `tip${i}`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.querySelectorAll('.commits-node').length === ${commitCount}`, 'the tips gone with their branches', 15000);
  const rowsLayout = leaves(await getLayout(s)).find((p) => p.id === foldPane);
  expect(rowsLayout.view.rows === false, `the flag is on the pane's view record (${JSON.stringify(rowsLayout.view)})`);
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body')`, 'app after the rows reload');
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.dataset.rows === 'off' && !!document.querySelector(${JSON.stringify(foldSel)} + ' .commits-graph')`, 'the rows still off after the reload', 20000);
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .commits-panel .commits-branch')`, "the rail's section after the rows reload");
  rowsOff = await rowsProbe();
  expect(rowsOff.rows === 0 && !rowsOff.svgLabels && rowsOff.railRows === commitCount, `after the reload the pane is still the gutter alone and the rail has its rows (${JSON.stringify(rowsOff)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)} + ' .commits-rows').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(foldSel)})?.dataset.rows === 'on' && document.querySelector(${JSON.stringify(foldSel)}).querySelectorAll('.commits-row').length === ${commitCount}`, 'the rows back');
  rowsOn = await rowsProbe();
  expect(!rowsOn.svgLabels && rowsOn.labels.length === 0 && !rowsOn.pressed, `the rows back, the SVG's labels gone (${JSON.stringify(rowsOn)})`);
  expect(leaves(await getLayout(s)).find((p) => p.id === foldPane).view.rows === undefined, 'rows on reads as no field on the record');
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .commits-open-pane')`, 'the rail on the Activity tab again');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(foldPane)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === 2`, 'the fold pane closed again');
  step('M9 fix 162 and 173: the rows button leaves the gutter alone with no labels and no leaders, five tips a row apart bare, the rail keeps its rows, and the flag rides the view record across a reload');

  // M9 fix 178: the tab and the pane open as a snapshot of the rail's
  // section (graph or list, orientation, direction, which blocks draw,
  // the rows) and keep their own state from then on: the tab's in its
  // query, persisted with the tab list, the pane's on its view record;
  // a later change in the rail reaches neither.
  const panel178 = (sel) => s.evalJs(`(() => { const p = document.querySelector(${JSON.stringify(sel)}); if (!p) return null; return { view: p.dataset.view, orientation: p.dataset.orientation, reverse: p.dataset.reverse !== undefined, draw: p.dataset.draw, rows: p.dataset.rows }; })()`);
  const railSel178 = '.files-rail .commits-panel';
  const tabSel178 = '.commits-view .commits-panel';
  const tabQuery178 = () => s.evalJs(`document.querySelector('.commits-view')?.dataset.query ?? null`);
  await s.waitFor(`document.querySelector(${JSON.stringify(railSel178)})?.dataset.folder === ${JSON.stringify(repo)} && !!document.querySelector('.files-rail .commits-panel .commits-tools')`, "the rail's panel on the repo with its tools");
  await s.evalJs(`document.querySelector('.files-rail .commits-chip[data-view="list"]').click()`);
  await s.evalJs(`document.querySelector('.files-rail .commits-orient').click()`);
  await s.evalJs(`document.querySelector('.files-rail .commits-direction').click()`);
  await s.waitFor(`(() => { const p = document.querySelector(${JSON.stringify(railSel178)}); return p?.dataset.view === 'list' && p.dataset.orientation === 'horizontal' && p.dataset.reverse !== undefined; })()`, 'the rail set up: list, on its side, oldest first');
  await s.evalJs(`document.querySelector('.files-rail .commits-expand').click()`);
  await s.waitFor(`document.querySelectorAll('.commits-view .commits-node').length === ${commitCount}`, 'the tab draws the graph', 10000);
  let tab178 = await panel178(tabSel178);
  expect(tab178.view === 'list' && tab178.orientation === 'horizontal' && tab178.reverse && tab178.draw === 'all', `the tab opens as the rail was set up (${JSON.stringify(tab178)})`);
  let q178 = await tabQuery178();
  expect(q178 !== null && q178.includes('mode=list') && q178.includes('orientation=horizontal') && q178.includes('reverse'), `the state rides the tab's query (${JSON.stringify(q178)})`);
  expect(await s.evalJs(`JSON.parse(localStorage.getItem('emerald.tabs')).query[document.querySelector('.commits-view').dataset.path] === ${JSON.stringify(q178)} && !document.querySelector('.commits-view').dataset.path.includes('?')`), 'the query is kept with the tab list under the bare key');
  await s.evalJs(`document.querySelector('.files-rail .commits-chip[data-view="graph"]').click()`);
  await s.evalJs(`document.querySelector('.files-rail .commits-orient').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(railSel178)})?.dataset.view === 'graph' && document.querySelector(${JSON.stringify(railSel178)})?.dataset.orientation === 'vertical'`, 'the rail back to the graph, upright');
  tab178 = await panel178(tabSel178);
  expect(tab178.view === 'list' && tab178.orientation === 'horizontal', `the rail's later change reaches the tab not at all (${JSON.stringify(tab178)})`);
  await s.evalJs(`document.querySelector('.commits-view .commits-direction').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(tabSel178)})?.dataset.reverse === undefined`, "the tab's own direction back to newest first");
  const rail178 = await panel178(railSel178);
  q178 = await tabQuery178();
  expect(rail178.reverse && q178 !== null && !q178.includes('reverse') && q178.includes('mode=list'), `the tab's change is its own: the rail still oldest first, the query without reverse (${JSON.stringify({ rail178, q178 })})`);
  await s.send('Page.reload');
  await s.waitFor(`document.querySelectorAll('.commits-view .commits-node').length === ${commitCount}`, 'the tab back after a reload with its graph', 15000);
  tab178 = await panel178(tabSel178);
  expect(tab178.view === 'list' && tab178.orientation === 'horizontal' && !tab178.reverse, `the tab's state survives the reload with the tab list (${JSON.stringify(tab178)})`);
  await s.evalJs(`[...document.querySelectorAll('.tab.tab-file')].find((t) => t.textContent.includes('Commits ·')).querySelector('.tab-close').click()`);
  await s.waitFor(`document.querySelector('.commits-view') === null`, 'the document tab closed again');
  // The pane, from the rail (graph, upright, oldest first, active): the
  // record carries what is away from the defaults.
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .commits-open-pane') && document.querySelector(${JSON.stringify(railSel178)})?.dataset.reverse !== undefined`, 'the rail offers the pane, still oldest first');
  await s.evalJs(`document.querySelector('.files-rail .commits-chip[data-draw="active"]').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(railSel178)})?.dataset.draw === 'active'`, 'the rail on the active blocks');
  const panesBefore178 = leaves(await getLayout(s)).map((p) => p.id);
  const commitsPanes178 = await s.evalJs(`document.querySelectorAll('.pane[data-view="commits"]').length`);
  await s.evalJs(`document.querySelector('.files-rail .commits-open-pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === ${commitsPanes178 + 1}`, 'a pane from the set-up section');
  const pane178 = leaves(await getLayout(s)).find((p) => !panesBefore178.includes(p.id));
  expect(pane178 !== undefined && pane178.view.kind === 'commits' && JSON.stringify(pane178.view.graph) === JSON.stringify({ reverse: true, draw: 'active' }) && pane178.view.rows === undefined, `the pane's record carries the fields away from the defaults (${JSON.stringify(pane178?.view)})`);
  const paneSel178 = `[data-pane-id=${JSON.stringify(pane178.id)}] .commits-panel`;
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel178)})?.querySelectorAll('.commits-row').length === ${commitCount}`, 'the pane lists the commits');
  let paneProbe178 = await panel178(paneSel178);
  expect(paneProbe178.view === 'graph' && paneProbe178.orientation === 'vertical' && paneProbe178.reverse && paneProbe178.draw === 'active', `the pane draws the section's state (${JSON.stringify(paneProbe178)})`);
  await s.evalJs(`document.querySelector('.files-rail .commits-chip[data-draw="all"]').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(railSel178)})?.dataset.draw === 'all'`, 'the rail on all blocks');
  paneProbe178 = await panel178(paneSel178);
  expect(paneProbe178.draw === 'active', `the rail's change leaves the pane alone (${JSON.stringify(paneProbe178)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(paneSel178)} + ' .commits-direction').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel178)})?.dataset.reverse === undefined`, "the pane's own direction back");
  const record178 = leaves(await getLayout(s)).find((p) => p.id === pane178.id);
  expect(JSON.stringify(record178.view.graph) === JSON.stringify({ draw: 'active' }) && (await panel178(railSel178)).reverse, `the record follows the pane and the rail keeps its own (${JSON.stringify(record178.view)})`);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(pane178.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === ${commitsPanes178}`, 'the pane closed again');
  // The heading's + menu opens the tab off the rail's own keys; a shell
  // in the repo gives it a live heading.
  await s.evalJs(`window.emerald.request('session.spawn', { kind: 'shell', cwd: ${JSON.stringify(repo)}, cols: 120, rows: 30 })`);
  await s.waitFor(`[...document.querySelectorAll('.sidebar-group')].some((g) => g.dataset.group === ${JSON.stringify(repo)} && g.querySelector('.sidebar-group-add'))`, 'a live heading for the repo');
  await s.evalJs(`document.querySelector('.files-rail .commits-direction').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(railSel178)})?.dataset.reverse === undefined`, 'the rail newest first again');
  await s.evalJs(`document.querySelector('.files-rail .commits-chip[data-view="list"]').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(railSel178)})?.dataset.view === 'list'`, 'the rail as a list');
  await addMenuItems(repo);
  await s.evalJs(`[...document.querySelectorAll('.group-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Commits in a tab').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(tabSel178)})?.dataset.view === 'list'`, "the heading's tab opens as the rail's list");
  await s.evalJs(`[...document.querySelectorAll('.tab.tab-file')].find((t) => t.textContent.includes('Commits ·')).querySelector('.tab-close').click()`);
  await s.evalJs(`document.querySelector('.files-rail .commits-chip[data-view="graph"]').click()`);
  await s.waitFor(`document.querySelector('.commits-view') === null && document.querySelector(${JSON.stringify(railSel178)})?.dataset.view === 'graph'`, 'the tab closed and the rail a graph again');
  step("M9 fix 178: the tab and the pane open as a snapshot of the rail's section and keep their own graph state, the tab's in its query across a reload, the heading's menu off the rail's keys");

  // M9 fix 180: a file in a pane. A rail row dragged onto a pane's right
  // band lands as a file view named for the file, its body the tab's
  // (Monaco, read off the editor since an occluded window draws no
  // frames), the record holding the kind and the path and coming back
  // after a reload; the row menu's Open in a pane puts a markdown file
  // beside the focused pane, rendered, and its Raw and Rendered switch
  // rides the record; a file tab on the strip drags onto a pane the same
  // way; the pane's menu offers the file as a tab. The panes are closed
  // again so the relaunch below still finds four.
  const aPath = path.join(repo, 'a.txt');
  const notesPath = path.join(repo, 'notes.md');
  fs.writeFileSync(notesPath, '# Notes\n\nA line.\n');
  const repoBox180 = await boxOf(repoPane);
  await s.click(Math.round(repoBox180.x + repoBox180.width / 2), Math.round(repoBox180.y + repoBox180.height / 2));
  await s.waitFor(focusedPaneIs(repoPane), 'the repo shell focused for the file drop');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  const rowSel = (name) => `[...document.querySelectorAll('.files-row[data-kind="file"]')].find((r) => r.querySelector('.files-name')?.textContent === ${JSON.stringify(name)})`;
  await s.waitFor(`${rowSel('a.txt')}?.dataset.draggable !== undefined && !!${rowSel('notes.md')}`, 'the repo\'s file rows, draggable', 10000);
  const rowCentre = (name) => s.evalJs(`(() => { const r = ${rowSel(name)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const aRow = await rowCentre('a.txt');
  const band180 = { x: Math.round(repoBox180.x + repoBox180.width * 0.9), y: Math.round(repoBox180.y + repoBox180.height / 2) };
  await s.mouse('mousePressed', aRow.x, aRow.y);
  await move({ x: aRow.x + 10, y: aRow.y });
  await move(band180);
  expect(await dragOn(), 'the file drag is on');
  expect((await s.evalJs(`document.querySelector('.drag-ghost')?.textContent ?? null`)) === 'a.txt', 'the ghost names the file');
  expect((await zoneOn(repoPane)) === 'right', `the right band previewed for the file, got ${await zoneOn(repoPane)}`);
  await s.mouse('mouseReleased', band180.x, band180.y);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'a file pane after the drop');
  expect((await s.evalJs(`document.querySelectorAll('.tab-file').length`)) === 0, 'the drag opened no tab');
  // A pane found by a JS expression, since a path in a CSS selector is
  // a matter of escaping.
  const fileProbe = (el) =>
    s.evalJs(
      `(() => { const p = ${el}; const fv = p.querySelector('.file-view'); const host = p.querySelector('.file-editor'); return { path: p.dataset.path ?? null, name: p.querySelector('.pane-name')?.textContent ?? null, cwd: p.querySelector('.pane-cwd')?.textContent ?? null, place: fv?.dataset.place ?? null, state: fv?.dataset.state ?? null, lines: fv?.dataset.lines ?? null, view: fv?.dataset.view ?? null, first: host?.emeraldEditor?.getModel()?.getLineContent(1) ?? null, term: !!p.querySelector('.term-host'), icon: !!p.querySelector('.pane-view-file-icon') }; })()`,
    );
  const fileSel = '.pane[data-view="file"]';
  const fileEl = `document.querySelector('${fileSel}')`;
  await s.waitFor(`document.querySelector('${fileSel} .file-view')?.dataset.state === 'text'`, 'the file read into the pane');
  let fileP = await fileProbe(fileEl);
  expect(fileP.path === aPath && fileP.name === 'a.txt' && fileP.cwd === repo && fileP.place === 'pane' && fileP.lines === '2' && fileP.first === 'a' && !fileP.term && fileP.icon, `the pane is titled for the file with its folder and holds the file in the editor, got ${JSON.stringify(fileP)}`);
  layout = await getLayout(s);
  const filePaneId = await s.evalJs(`document.querySelector('${fileSel}').dataset.paneId`);
  let fileLeaf = leaves(layout).find((p) => p.id === filePaneId);
  expect(fileLeaf !== undefined && fileLeaf.sessionId === null && fileLeaf.view.kind === 'file' && fileLeaf.view.path === aPath && fileLeaf.view.view === undefined, `the leaf holds the file view, got ${JSON.stringify(fileLeaf)}`);
  expect(layout.focusedPaneId === filePaneId, 'the file pane is focused');
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body')`, 'app after the file reload');
  await s.waitFor(`document.querySelector('${fileSel} .file-view')?.dataset.state === 'text' && document.querySelectorAll('.pane').length === 5`, 'the file pane back after the reload', 20000);
  fileP = await fileProbe(fileEl);
  expect(fileP.path === aPath && fileP.lines === '2', `the file pane is back with the file, got ${JSON.stringify(fileP)}`);
  step('M9 fix 180: a file row dragged onto a pane lands as a file pane titled for the file, the record holding the kind and the path across a reload');

  // The row menu: Open in a pane, beside the focused (file) pane.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`!!${rowSel('notes.md')}`, 'the notes row again');
  await s.evalJs(`(() => { const r = ${rowSel('notes.md')}; const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 })); })()`);
  await s.waitFor(`!!document.querySelector('.files-menu')`, 'the row menu');
  const rowItems = await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].map((b) => b.querySelector('.menu-label').textContent)`);
  expect(rowItems[0] === 'Open in a tab' && rowItems[1] === 'Rename' && rowItems[2] === 'Open in a pane', `the row menu offers Rename then a pane after the tab, got ${JSON.stringify(rowItems)}`);
  await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Open in a pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 2`, 'a second file pane from the menu');
  const notesEl = `[...document.querySelectorAll('${fileSel}')].find((p) => p.dataset.path === ${JSON.stringify(notesPath)})`;
  await s.waitFor(`${notesEl}?.querySelector('.file-view')?.dataset.state === 'text'`, 'the markdown file read');
  let notesP = await fileProbe(notesEl);
  expect(notesP.name === 'notes.md' && notesP.view === 'rendered', `the markdown pane opens rendered, got ${JSON.stringify(notesP)}`);
  const notesPaneId = await s.evalJs(`${notesEl}.dataset.paneId`);
  const notesSel = `[data-pane-id=${JSON.stringify(notesPaneId)}]`;
  expect((await getLayout(s)).focusedPaneId === notesPaneId, 'the markdown pane is focused, beside the file pane');
  await s.evalJs(`document.querySelector('${notesSel} .file-view-switch [data-view="raw"]').click()`);
  await s.waitFor(`document.querySelector('${notesSel} .file-view')?.dataset.view === 'raw'`, 'the raw view');
  fileLeaf = leaves(await getLayout(s)).find((p) => p.id === notesPaneId);
  expect(fileLeaf.view.kind === 'file' && fileLeaf.view.view === 'raw', `raw rides the record, got ${JSON.stringify(fileLeaf.view)}`);
  notesP = await fileProbe(`document.querySelector('${notesSel}')`);
  expect(notesP.first === '# Notes', `the editor holds the markdown, got ${JSON.stringify(notesP)}`);
  await s.evalJs(`document.querySelector('${notesSel} .file-view-switch [data-view="rendered"]').click()`);
  await s.waitFor(`document.querySelector('${notesSel} .file-view')?.dataset.view === 'rendered'`, 'rendered again');
  fileLeaf = leaves(await getLayout(s)).find((p) => p.id === notesPaneId);
  expect(fileLeaf.view.view === undefined, `the file's own view reads as no field on the record, got ${JSON.stringify(fileLeaf.view)}`);
  step("M9 fix 180: the row menu's Open in a pane puts a markdown file beside the focused pane, rendered, and Raw and Rendered ride the record");

  // M9 fix 389: the header gives its parts up in a fixed order as the
  // pane narrows, squeeze.ts's rule (fix 76) worn here as the pane
  // title (verify:context) and the sidebar rows wear it. The notes.md
  // pane above sits several splits deep by now, so every ancestor split
  // on its way down is turned toward it first, or its own box is too
  // narrow to show more than the tightest level at any ratio; its raw
  // view puts the Wrap button up so its level shows too.
  await s.evalJs(`document.querySelector('${notesSel} .file-view-switch [data-view="raw"]').click()`);
  await s.waitFor(`document.querySelector('${notesSel} .file-view')?.dataset.view === 'raw'`, 'notes.md raw for the squeeze walk');
  const findSplitById389 = (node, id) => {
    if (node.kind !== 'split') return null;
    if (node.id === id) return node;
    return findSplitById389(node.first, id) ?? findSplitById389(node.second, id);
  };
  const findParentSplit389 = (node, id) => {
    if (node.kind !== 'split') return null;
    if ((node.first.kind === 'pane' && node.first.id === id) || (node.second.kind === 'pane' && node.second.id === id)) return node;
    return findParentSplit389(node.first, id) ?? findParentSplit389(node.second, id);
  };
  // The chain of splits from the root down to (not including) a target
  // split, each with the side that leads to it.
  const ancestorPath389 = (node, targetId, chain = []) => {
    if (node.kind !== 'split') return null;
    if (node.id === targetId) return chain;
    const viaFirst = ancestorPath389(node.first, targetId, [...chain, { id: node.id, side: 'first' }]);
    if (viaFirst !== null) return viaFirst;
    return ancestorPath389(node.second, targetId, [...chain, { id: node.id, side: 'second' }]);
  };
  const withRatios389 = (node, updates) => {
    if (node.kind === 'pane') return node;
    const rec = { ...node, first: withRatios389(node.first, updates), second: withRatios389(node.second, updates) };
    if (updates.has(node.id)) rec.ratio = updates.get(node.id);
    return rec;
  };
  const applyRatios389 = async (updates) => {
    const layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: withRatios389(layout.root, updates) } });
  };
  const layout389 = await getLayout(s);
  const split389 = findParentSplit389(layout389.root, notesPaneId);
  expect(split389 !== null && split389.direction === 'row', `the notes pane sits in a row split, got ${JSON.stringify(split389)}`);
  const notesFirst389 = split389.first.kind === 'pane' && split389.first.id === notesPaneId;
  const ancestors389 = ancestorPath389(layout389.root, split389.id) ?? [];
  const original389 = new Map();
  for (const a of ancestors389) original389.set(a.id, findSplitById389(layout389.root, a.id).ratio);
  original389.set(split389.id, split389.ratio);
  // Every ancestor turned as far toward the notes branch as the ratio
  // floor allows, so the split holding the notes pane gets as much of
  // the window as the tree has to give it.
  if (ancestors389.length > 0) {
    const maximize389 = new Map(ancestors389.map((a) => [a.id, a.side === 'first' ? 0.92 : 0.08]));
    await applyRatios389(maximize389);
    await sleep(300);
  }
  const splitBox389 = await s.evalJs(`document.querySelector('[data-split-id=${JSON.stringify(split389.id)}]').getBoundingClientRect().width`);
  const setSplitRatio389 = (ratio) => applyRatios389(new Map([[split389.id, ratio]]));
  const headerProbe389 = () =>
    s.evalJs(
      `(() => { const h = document.querySelector('${notesSel} .file-header'); const shown = (sel) => { const e = h.querySelector(sel); return e !== null && getComputedStyle(e).display !== 'none'; }; return { level: Number(h.dataset.squeeze ?? 0), width: Math.round(h.getBoundingClientRect().width), oneLine: h.scrollHeight <= h.clientHeight + 1, clipped: h.scrollWidth > h.clientWidth + 1, folder: shown('.file-path-folder'), name: shown('.file-path-name'), open: shown('.file-open'), reveal: shown('.file-reveal'), wrap: shown('.file-wrap'), switch: shown('.file-view-switch'), close: shown('.file-close') }; })()`,
    );
  // The switch and the close button never give (decided), and both are
  // flex: none, so their natural width holds at any container width;
  // measured rather than guessed, since the font and the theme vary.
  // The tightest width tried is this plus the header's own gap and
  // padding and a margin, comfortably short of the third level's (which
  // still carries the name's text on top), so the walk's last step
  // lands on the fourth level with room to spare rather than on the
  // fourth level's own bare edge.
  const alwaysWidth389 = await s.evalJs(
    `(() => { const h = document.querySelector('${notesSel} .file-header'); return h.querySelector('.file-view-switch').getBoundingClientRect().width + h.querySelector('.file-close').getBoundingClientRect().width; })()`,
  );
  const tightPx389 = Math.ceil(alwaysWidth389 + 6 + 16 + 25);
  const setNotesWidthPx389 = async (px) => {
    const ratio = notesFirst389 ? px / splitBox389 : 1 - px / splitBox389;
    await setSplitRatio389(ratio);
    await s.waitFor(`Math.abs(document.querySelector('${notesSel}').getBoundingClientRect().width - ${px}) < 10`, `the notes pane at about ${px}px`);
    await sleep(300);
  };
  // The wide steps stay strictly above the tight floor, since a fixed
  // fraction of the split's own box (which is a narrow branch of the
  // tree by now) can undercut it before the loop means to.
  const roomAbove389 = Math.max(0, splitBox389 * 0.9 - tightPx389);
  let probe389 = null;
  for (const fraction of [0.85, 0.6, 0.35]) {
    await setNotesWidthPx389(Math.round(tightPx389 + roomAbove389 * fraction));
    probe389 = await headerProbe389();
    expect(!probe389.clipped && probe389.oneLine, `the header keeps to one line with nothing cut at ${probe389.width}px (level ${probe389.level}), got ${JSON.stringify(probe389)}`);
    expect(probe389.switch && probe389.close, `the switch and the close button never give, got ${JSON.stringify(probe389)}`);
    if (probe389.level >= 1) expect(!probe389.folder && probe389.name, `the folder is what gives first (level ${probe389.level}), got ${JSON.stringify(probe389)}`);
    else expect(probe389.folder, `the folder stays before level 1, got ${JSON.stringify(probe389)}`);
    if (probe389.level >= 2) expect(!probe389.open && !probe389.reveal, `Open with Windows and Reveal give together at level 2, got ${JSON.stringify(probe389)}`);
    else expect(probe389.open && probe389.reveal, `Open with Windows and Reveal stay before level 2, got ${JSON.stringify(probe389)}`);
    if (probe389.level >= 3) expect(!probe389.wrap, `Wrap gives at level 3, got ${JSON.stringify(probe389)}`);
    else expect(probe389.wrap, `Wrap stays before level 3, got ${JSON.stringify(probe389)}`);
  }
  // The tightest: measured, not guessed.
  await setNotesWidthPx389(Math.min(tightPx389, Math.round(splitBox389 * 0.94)));
  probe389 = await headerProbe389();
  expect(probe389.level === 4, `the header reaches its fourth level at ${probe389.width}px (switch and close need about ${Math.ceil(alwaysWidth389)}px), got level ${probe389.level}`);
  expect(!probe389.folder && !probe389.name && !probe389.open && !probe389.reveal && !probe389.wrap, `everything but the switch and the close is gone at the fourth level, got ${JSON.stringify(probe389)}`);
  expect(probe389.switch && probe389.close && !probe389.clipped && probe389.oneLine, `at the tightest the switch and the close stay, whole and one line, got ${JSON.stringify(probe389)}`);
  await s.screenshot('m52-view-fix389-squeeze.png');
  step(`M9 fix 389: the header gives the folder, then Open with Windows and Reveal, then Wrap, then the name, reaching level ${probe389.level} at ${probe389.width}px with the switch and the close whole`);

  // Every ratio touched put back, for the steps after; the notes pane's
  // own resting place in the tree, after every drop this script has done
  // above it, is its own narrow branch (not this fix's concern), so the
  // header may still be squeezed or even clipped there, same as before
  // this fix, and nothing here asks otherwise.
  await applyRatios389(original389);
  await sleep(500);
  await s.evalJs(`document.querySelector('${notesSel} .file-view-switch [data-view="rendered"]').click()`);
  await s.waitFor(`document.querySelector('${notesSel} .file-view')?.dataset.view === 'rendered'`, 'rendered again after the squeeze walk');
  fileLeaf = leaves(await getLayout(s)).find((p) => p.id === notesPaneId);
  expect(fileLeaf.view.view === undefined, `back to no view field on the record, got ${JSON.stringify(fileLeaf.view)}`);

  // The pane's menu offers the file as a tab; then a file tab, opened by
  // a click on the row, is dragged onto the home pane's right band.
  const notesBox = await boxOf(notesPaneId);
  await s.evalJs(`document.querySelector('${notesSel} .pane-title').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${Math.round(notesBox.x + notesBox.width / 2)}, clientY: ${Math.round(notesBox.y + notesBox.height / 2)} }))`);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, 'the file pane menu');
  const paneItems = await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].map((b) => b.querySelector('.menu-label').textContent)`);
  expect(paneItems[0] === 'Open as a tab' && !paneItems.some((l) => l.startsWith('Hide the controls')), `the file pane's menu leads with the tab and folds no controls, got ${JSON.stringify(paneItems)}`);
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Open as a tab').click()`);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === 1 && document.querySelectorAll('.pane[data-view="file"]').length === 2`, 'the file as a tab, the pane still there');
  expect((await s.evalJs(`document.querySelector('.tab-strip').dataset.activeTab`)) !== 'panes', 'the tab is on show');
  // The panes are under the strip only while the panes tab is on show,
  // so a tab is dragged onto a pane from there.
  await s.evalJs(`document.querySelector('.tab[data-tab="panes"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'the panes on show again');
  const tabEl180 = `[...document.querySelectorAll('.tab-file')].find((t) => t.dataset.tab === ${JSON.stringify(notesPath)})`;
  expect((await s.evalJs(`${tabEl180}?.dataset.draggable`)) === '', 'the file tab drags');
  const homeBox180 = await boxOf(homePane);
  const tabCentre = await s.evalJs(`(() => { const r = ${tabEl180}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const homeBand = { x: Math.round(homeBox180.x + homeBox180.width * 0.9), y: Math.round(homeBox180.y + homeBox180.height / 2) };
  await s.mouse('mousePressed', tabCentre.x, tabCentre.y);
  await move({ x: tabCentre.x + 10, y: tabCentre.y + 6 });
  await move(homeBand);
  expect(await dragOn(), 'the tab drag is on');
  expect((await zoneOn(homePane)) === 'right', `the home pane's right band previewed for the tab, got ${await zoneOn(homePane)}`);
  await s.mouse('mouseReleased', homeBand.x, homeBand.y);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 3`, 'a third file pane from the tab');
  expect((await s.evalJs(`document.querySelectorAll('.tab-file').length`)) === 1, 'the tab stays on the strip');
  const thirdLeaf = leaves(await getLayout(s)).find((p) => p.view !== null && p.view.kind === 'file' && p.id !== filePaneId && p.id !== notesPaneId);
  expect(thirdLeaf !== undefined && thirdLeaf.view.path === notesPath, `the third pane holds the tab's file, got ${JSON.stringify(thirdLeaf)}`);
  // Back to four panes and no tab for the steps below.
  await s.evalJs(`${tabEl180}.querySelector('.tab-close').click()`);
  for (const id of [thirdLeaf.id, notesPaneId, filePaneId]) {
    await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(id)}] .pane-hide').click()`);
    await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(id)}]')`, 'a file pane closed');
  }
  await s.waitFor(`document.querySelectorAll('.pane').length === 4 && document.querySelectorAll('.tab-file').length === 0`, 'four panes and no file tab again');

  // M9 fix 331: the rail follows a file tab or a file pane to its
  // repository. A second repository's file, opened as a tab from a shell
  // there, then the repo shell focused again: the tab in front puts the
  // rail on the second repository (before the fix the panes tab's folder
  // stayed, since a file tab was never seen), the panes tab puts it back
  // on the focused pane's folder, and the same file dropped on a pane
  // moves the rail on focus. The extra pane and the tab go again so the
  // relaunch below still finds four panes.
  // In a folder of its own, so the lift below lists one entry (the
  // verify folder itself has thousands, past the rail's cap).
  const liftShort = path.join(os.tmpdir(), 'emerald-verify', `m52-lift-${process.pid}`);
  fs.rmSync(liftShort, { recursive: true, force: true });
  fs.mkdirSync(path.join(liftShort, 'repo2'), { recursive: true });
  const repo2 = fs.realpathSync.native(path.join(liftShort, 'repo2'));
  const git2 = (...args) => execFileSync('git', args, { cwd: repo2, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  git2('init', '-q');
  git2('config', 'user.name', 'verify');
  git2('config', 'user.email', 'verify@example.invalid');
  git2('config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repo2, 'src'));
  const twoPath = path.join(repo2, 'src', 'two.txt');
  fs.writeFileSync(twoPath, 'two\n');
  fs.writeFileSync(path.join(repo2, 'README.txt'), 'read me\n');
  git2('add', '.');
  git2('commit', '-q', '-m', 'only');
  const trunk2 = git2('rev-parse', '--abbrev-ref', 'HEAD').trim();
  // A shell in the second repository, in a pane split off the repo pane.
  // The repo pane is split twice below, so its box is measured at each
  // click rather than held.
  const clickRepoPane = async () => {
    const b = await boxOf(repoPane);
    await s.click(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
  };
  await clickRepoPane();
  await s.waitFor(focusedPaneIs(repoPane), 'the repo shell focused before the split');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(repoPane)}] .pane-split-right').click()`);
  await s.waitFor(`!!document.querySelector('.pane.focused .empty-pane')`, 'an empty pane split off the repo pane');
  await startSessionByKey(s, { kind: 'shell', cwd: repo2 });
  const twoPane = (await getLayout(s)).focusedPaneId;
  expect(twoPane !== repoPane && twoPane !== homePane, 'the second repository took the split pane');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo2)}`, 'the rail on the second repository');
  // The file's row, under src: the folder row opened by a click, the
  // file's row clicked for a tab (a preview tab, in front).
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  const dirRowSel = (name) => `[...document.querySelectorAll('.files-row[data-kind="dir"]')].find((r) => r.querySelector('.files-name')?.textContent === ${JSON.stringify(name)})`;
  await s.waitFor(`!!${dirRowSel('src')}`, "the second repository's src row", 10000);
  await s.evalJs(`${dirRowSel('src')}.click()`);
  await s.waitFor(`!!${rowSel('two.txt')}`, 'the file row under src', 10000);
  await s.evalJs(`${rowSel('two.txt')}.click()`);
  const twoTabSel = `[...document.querySelectorAll('.tab-file')].find((t) => t.dataset.tab === ${JSON.stringify(twoPath)})`;
  await s.waitFor(`!!${twoTabSel} && document.querySelector('.tab-strip').dataset.activeTab !== 'panes'`, 'the file as a tab in front');
  expect((await railRoot()) === repo2, `a file under the shown root moves nothing, got ${await railRoot()}`);
  // The repo shell focused again with the panes tab in front: the rail
  // on the repo. Then the tab in front: the rail on the second repository.
  await s.evalJs(`document.querySelector('.tab[data-tab="panes"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'the panes on show for the focus');
  await clickRepoPane();
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'the rail back on the repo with the repo shell focused');
  await s.evalJs(`${twoTabSel}.click()`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab !== 'panes'`, 'the tab in front again');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo2)}`, "the rail on the tab's repository");
  expect((await s.evalJs(`document.querySelector('.files-root')?.textContent ?? null`)) === path.basename(repo2), `the header names the second repository, got ${await s.evalJs(`document.querySelector('.files-root')?.textContent ?? null`)}`);
  await s.evalJs(`document.querySelector('.tab[data-tab="panes"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes' && document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'the panes tab puts the rail back on the focused pane');
  // The tab dropped on the repo pane's right band: a file pane, focused,
  // and the rail on its repository; the repo shell focused, the rail back.
  const twoTabCentre = await s.evalJs(`(() => { const r = ${twoTabSel}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const repoBox331 = await boxOf(repoPane);
  const band331 = { x: Math.round(repoBox331.x + repoBox331.width * 0.9), y: Math.round(repoBox331.y + repoBox331.height / 2) };
  await s.mouse('mousePressed', twoTabCentre.x, twoTabCentre.y);
  await move({ x: twoTabCentre.x + 10, y: twoTabCentre.y + 6 });
  await move(band331);
  expect((await zoneOn(repoPane)) === 'right', `the right band previewed for the tab, got ${await zoneOn(repoPane)}`);
  await s.mouse('mouseReleased', band331.x, band331.y);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="file"]').length === 1`, 'a file pane from the tab');
  const twoPaneFile = await s.evalJs(`document.querySelector('.pane[data-view="file"]').dataset.paneId`);
  expect((await getLayout(s)).focusedPaneId === twoPaneFile, 'the file pane is focused');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo2)}`, "the rail on the file pane's repository");
  await clickRepoPane();
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'the rail back on the repo once the repo shell has focus');
  step(`M9 fix 331: the rail follows a file tab and a file pane to their repository (trunk ${trunk2}) and the panes tab or a shell's focus puts it back`);

  // M9 fix 332: the header's up button lifts the rail above the followed
  // folder; the old root stays as an open row, a click on one of its
  // files keeps the lift, and another pane's focus drops it. From the
  // second repository, whose parent holds it alone.
  const twoBox332 = await boxOf(twoPane);
  await s.click(Math.round(twoBox332.x + twoBox332.width / 2), Math.round(twoBox332.y + twoBox332.height / 2));
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo2)}`, 'the rail on the second repository for the lift');
  const parentOfRepo2 = path.dirname(repo2);
  expect((await s.evalJs(`document.querySelector('.files-up')?.title ?? null`)) === `Up to ${path.basename(parentOfRepo2)}`, `the up button names the parent, got ${await s.evalJs(`document.querySelector('.files-up')?.title ?? null`)}`);
  await s.evalJs(`document.querySelector('.files-up').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(parentOfRepo2)}`, 'the rail lifted to the parent');
  expect((await s.evalJs(`document.querySelector('.files-root')?.textContent ?? null`)) === path.basename(parentOfRepo2), 'the header names the parent');
  const oldRootRow = `[...document.querySelectorAll('.files-row[data-kind="dir"]')].find((r) => r.dataset.path === ${JSON.stringify(repo2)})`;
  await s.waitFor(`${oldRootRow}?.dataset.expanded === 'true' && !!${rowSel('README.txt')}`, 'the old root open as a row with its files under it', 10000);
  expect((await s.evalJs(`${rowSel('README.txt')}.dataset.depth`)) === '1', "the old root's file sits one level down");
  await s.evalJs(`${rowSel('README.txt')}.click()`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab !== 'panes'`, 'the file as a preview tab');
  expect((await railRoot()) === parentOfRepo2, `a click into the tree keeps the lift, got ${await railRoot()}`);
  await s.evalJs(`document.querySelector('.tab[data-tab="panes"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'the panes on show again');
  expect((await railRoot()) === parentOfRepo2, `the panes tab keeps the lift too, got ${await railRoot()}`);
  step("M9 fix 332: the rail climbs above the folder it follows, the old root open as a row, and another pane's focus puts it back on following");

  // M9 fix 365: the header names the lift itself, and a click on it is
  // the way back down to the folder the rail follows.
  expect((await s.evalJs(`document.querySelector('.files-root')?.title ?? null`)) === 'Back to the folder the rail follows', 'the lifted header names the way back down');
  await s.evalJs(`document.querySelector('.files-root').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo2)}`, 'the click on the header drops the lift, the rail on the followed folder again');
  expect((await s.evalJs(`document.querySelector('.files-root')?.title ?? null`)) === repo2, `the header's title is the full path again with no lift, got ${await s.evalJs(`document.querySelector('.files-root')?.title ?? null`)}`);
  step('M9 fix 365: the header names the lift, and a click on it is the way back down to the folder the rail follows');

  // M9 fix 366: the up button and the header name a drive root as a
  // path, since folderName's "C:" reads as a truncated word; lift step
  // by step from the followed folder until one more step would be the
  // drive root itself.
  const driveRoot366 = path.parse(repo2).root;
  let liftedAt366 = repo2;
  while (path.dirname(liftedAt366) !== driveRoot366) {
    const next366 = path.dirname(liftedAt366);
    await s.evalJs(`document.querySelector('.files-up').click()`);
    await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(next366)}`, `lifted to ${next366}`);
    liftedAt366 = next366;
  }
  expect((await s.evalJs(`document.querySelector('.files-up')?.title ?? null`)) === `Up to ${driveRoot366}`, `the up button names the drive root as a path, got ${await s.evalJs(`document.querySelector('.files-up')?.title ?? null`)}`);
  step(`M9 fix 366: the up button names the drive root ${driveRoot366} as a path, not folderName's bare letter`);

  await clickRepoPane();
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, "another pane's focus drops the lift and the rail follows its folder");
  step("another pane's focus drops the lift, however many levels up it climbed, and the rail follows its folder again");

  // The tabs, the file pane and the second repository's pane go again.
  await s.evalJs(`[...document.querySelectorAll('.tab-file .tab-close')].forEach((b) => b.click())`);
  await s.waitFor(`document.querySelectorAll('.tab-file').length === 0`, 'the tabs closed');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(twoPaneFile)}] .pane-hide').click()`);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(twoPaneFile)}]')`, 'the file pane closed');
  const twoSession = leaves(await getLayout(s)).find((p) => p.id === twoPane)?.sessionId ?? null;
  expect(twoSession !== null, 'the second repository pane holds its session');
  await s.evalJs(`window.emerald.request('session.kill', { sessionId: ${JSON.stringify(twoSession)} })`);
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find((x) => x.id === ${JSON.stringify(twoSession)})?.state === 'exited'; })()`, "the second repository's shell exited", 8000);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(twoPane)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4 && document.querySelectorAll('.tab-file').length === 0`, 'four panes and no file tab again');

  // M9 fix 357: a file path a pane prints is a link. The repo shell
  // prints a relative path with a line and an absolute one; the hover
  // (the DOM's own events on the screen element, the fix 204 recipe,
  // since a CDP mouseMoved takes seconds to land) puts the resolved
  // path on the host with the tooltip, and a Ctrl+click on the relative
  // one opens a pinned tab with the editor's cursor on the line.
  const notesFile = path.join(repo, 'notes', 'lines.txt');
  fs.mkdirSync(path.dirname(notesFile), { recursive: true });
  fs.writeFileSync(notesFile, 'one\ntwo\nthree\nfour\nfive\n');
  const repoShell = leaves(await getLayout(s)).find((p) => p.id === repoPane)?.sessionId ?? null;
  expect(repoShell !== null, 'the repo pane holds its shell');
  const linkHost357 = `[data-pane-id=${JSON.stringify(repoPane)}] .term-host`;
  // The pane zoomed for the step, since the splits above leave it a few
  // columns wide and a path must sit on one row for the hover.
  await clickRepoPane();
  await s.waitFor(focusedPaneIs(repoPane), 'the repo shell focused for the path step');
  await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(repoPane)}] .pane-zoom`)}).click()`);
  await s.waitFor(`document.querySelector('.splitview.zoomed') !== null`, 'the repo pane zoomed');
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.emeraldTerm !== undefined`, 'the repo shell in its pane for the path step', 10000);
  const absToken = path.join(repo, 'a.txt');
  const relToken = 'notes/lines.txt:3';
  await s.waitFor(`(document.querySelector(${JSON.stringify(linkHost357)})?.emeraldTerm?.cols ?? 0) >= ${absToken.length + 2}`, `the zoomed pane wide enough for the absolute path (${absToken.length} columns)`, 10000);
  // One token a line, so each sits whole on its row.
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(repoShell)}, data: 'Write-Host ' + ${JSON.stringify(relToken)} + '; Write-Host ' + ${JSON.stringify(absToken)} + String.fromCharCode(13) })`);
  // The screen cell at the middle of a token, on the row that holds
  // the token alone (the output), not the command's echo, which wraps.
  const pathCell = (token) =>
    `(() => { const host = document.querySelector(${JSON.stringify(linkHost357)}); const t = host?.emeraldTerm; if (!t) return null; const b = t.buffer.active; for (let i = 0; i < b.length; i++) { const text = b.getLine(i)?.translateToString(true) ?? ''; const at = text.indexOf(${JSON.stringify(token)}); if (at >= 0 && text.trim() === ${JSON.stringify(token)}) { const cell = t._core._renderService.dimensions.css.cell; const r = host.querySelector('.xterm-screen').getBoundingClientRect(); return { x: r.left + (at + ${Math.floor(token.length / 2)}) * cell.width, y: r.top + (i - b.viewportY) * cell.height + cell.height / 2, row: i - b.viewportY }; } } return null; })()`;
  const dumpBuf357 = `(() => { const t = document.querySelector(${JSON.stringify(linkHost357)})?.emeraldTerm; if (!t) return 'no term'; const b = t.buffer.active; const out = []; for (let i = 0; i < b.length; i++) { const l = b.getLine(i)?.translateToString(true) ?? ''; if (l.trim() !== '') out.push(l); } return out.join(' | '); })()`;
  {
    const printed = Date.now() + 10000;
    while ((await s.evalJs(pathCell(absToken))) === null && Date.now() < printed) await sleep(250);
    if ((await s.evalJs(pathCell(absToken))) === null) throw new Error(`the paths never printed on the repo shell: ${await s.evalJs(dumpBuf357)}`);
  }
  const screenEvent357 = (type, at, extra = '') =>
    s.evalJs(`document.querySelector(${JSON.stringify(linkHost357 + ' .xterm-screen')}).dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { clientX: ${at.x}, clientY: ${at.y}, bubbles: true, cancelable: true, button: 0 ${extra} }))`);
  const hostTitle357 = () => s.evalJs(`document.querySelector(${JSON.stringify(linkHost357)})?.title ?? null`);
  const absCell = await s.evalJs(pathCell(absToken));
  await screenEvent357('mousemove', absCell);
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === ${JSON.stringify(absToken)}`, 'the absolute path on the host', 5000);
  expect((await hostTitle357()) === `Ctrl+click opens ${absToken}`, `the tooltip names the absolute path, got ${await hostTitle357()}`);
  await screenEvent357('mousemove', { x: absCell.x, y: absCell.y + 200 });
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === undefined`, 'the pointer off the path clears the host', 5000);
  const relCell = await s.evalJs(pathCell(relToken));
  expect(relCell !== null, `the relative path is on a row of its own, got ${JSON.stringify(relCell)}`);
  await screenEvent357('mousemove', relCell);
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === ${JSON.stringify(notesFile)}`, 'the relative path resolved against the shell folder on the host', 5000);
  expect((await hostTitle357()) === `Ctrl+click opens ${notesFile}`, `the tooltip names the resolved path, got ${await hostTitle357()}`);
  await s.screenshot('m52-fix357-path-link.png');
  const tabsBefore357 = await s.evalJs(`document.querySelectorAll('.tab-file').length`);
  await screenEvent357('mousedown', relCell);
  await screenEvent357('mouseup', relCell);
  await sleep(400);
  expect((await s.evalJs(`document.querySelectorAll('.tab-file').length`)) === tabsBefore357, 'a plain click opens nothing');
  await screenEvent357('mousedown', relCell, ', ctrlKey: true');
  await screenEvent357('mouseup', relCell, ', ctrlKey: true');
  const notesTabSel = `[...document.querySelectorAll('.tab-file')].find((t) => t.dataset.tab === ${JSON.stringify(notesFile)})`;
  await s.waitFor(`!!${notesTabSel} && document.querySelector('.tab-strip').dataset.activeTab !== 'panes'`, 'the Ctrl+click opened the file as a tab in front', 5000);
  expect((await s.evalJs(`${notesTabSel}.dataset.preview ?? null`)) === null, 'the tab is pinned, not a preview');
  // The tab's own view, since the fix 332 steps left a file pane up.
  const notesView = `[...document.querySelectorAll('.file-view')].find((v) => v.dataset.path === ${JSON.stringify(notesFile)})`;
  await s.waitFor(`(() => { const e = ${notesView}?.querySelector('.file-editor')?.emeraldEditor; return !!e && !!e.getModel() && e.getPosition().lineNumber === 3; })()`, "the editor's cursor on line 3", 5000);
  await s.screenshot('m52-fix357-pinned-tab.png');
  step('M9 fix 357: a path a pane prints is a link, the hover names the resolved file, a plain click opens nothing and a Ctrl+click pins a tab at its line');
  // The tab and the file go, so the steps below see the strip and the
  // repository as they were.
  await s.evalJs(`${notesTabSel}.querySelector('.tab-close').click()`);
  await s.waitFor(`!${notesTabSel}`, 'the path tab closed');
  fs.rmSync(path.dirname(notesFile), { recursive: true, force: true });
  await s.evalJs(`document.querySelector('.tab[data-tab="panes"]').click()`);
  await s.waitFor(`document.querySelector('.tab-strip').dataset.activeTab === 'panes'`, 'the panes on show after the path step');
  await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(repoPane)}] .pane-zoom`)}).click()`);
  await s.waitFor(`document.querySelector('.splitview.zoomed') === null`, 'the repo pane unzoomed after the path step');

  // M9 fix 423: a path wrapped across the pane's rows, by its own length
  // and no space to break it, is still one link. The repo pane is back
  // at its narrow, unzoomed width from the splits above, so a path with
  // enough padding in it wraps the way xterm wraps anything: no space
  // near the break, so the pattern's own walk (path-links.ts,
  // joinWrappedRows) has to find it across rows, the way the pane's
  // provider now does. A finder of its own, since pathCell above only
  // ever looks at one row.
  const cols423 = await s.evalJs(`document.querySelector(${JSON.stringify(linkHost357)})?.emeraldTerm?.cols ?? 0`);
  expect(cols423 >= 10, `the narrow repo pane has a usable width for the wrap step, got ${cols423} cols`);
  const dir423 = path.join(repo, 'wrap423');
  const targetLen423 = cols423 + Math.max(8, Math.floor(cols423 * 0.6));
  const tail423 = '\\file.ts';
  const padLen423 = Math.max(1, targetLen423 - dir423.length - 1 - tail423.length);
  const folder423 = 'w'.repeat(padLen423);
  const wrapToken = `${dir423}\\${folder423}${tail423}`;
  expect(wrapToken.length > cols423, `the token is longer than the pane is wide, got ${wrapToken.length} characters for ${cols423} cols`);
  fs.mkdirSync(path.join(dir423, folder423), { recursive: true });
  fs.writeFileSync(wrapToken, 'wrapped\n');
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(repoShell)}, data: 'Write-Host ' + ${JSON.stringify(wrapToken)} + String.fromCharCode(13) })`);
  // Every row from some start i, joined while the next continues it
  // (isWrapped), until it matches the token whole; the match must have
  // taken more than one row, or this found the single-row echo instead.
  const wrapCell = `(() => { const host = document.querySelector(${JSON.stringify(linkHost357)}); const t = host?.emeraldTerm; if (!t) return null; const b = t.buffer.active; const target = ${JSON.stringify(wrapToken)}; for (let i = 0; i < b.length; i++) { let joined = b.getLine(i)?.translateToString(true) ?? ''; let last = i; for (let steps = 0; steps < 8 && joined.length < target.length; steps++) { const next = b.getLine(last + 1); if (!next || !next.isWrapped) break; joined += next.translateToString(true); last += 1; } if (joined === target && last > i) { const l1 = b.getLine(last); const text = l1.translateToString(true); const x = Math.max(0, Math.min(Math.floor(text.length / 2), (l1.length || 1) - 1)); const cell = t._core._renderService.dimensions.css.cell; const r = host.querySelector('.xterm-screen').getBoundingClientRect(); return { x: r.left + (x + 0.5) * cell.width, y: r.top + (last - b.viewportY) * cell.height + cell.height / 2 }; } } return null; })()`;
  {
    const printed = Date.now() + 10000;
    while ((await s.evalJs(wrapCell)) === null && Date.now() < printed) await sleep(250);
    if ((await s.evalJs(wrapCell)) === null) throw new Error(`the wrapped path never printed across rows: ${await s.evalJs(dumpBuf357)}`);
  }
  const wrapPos = await s.evalJs(wrapCell);
  await screenEvent357('mousemove', wrapPos);
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === ${JSON.stringify(wrapToken)}`, "the wrapped path, hovered from its own row, resolves whole", 5000);
  expect((await hostTitle357()) === `Ctrl+click opens ${wrapToken}`, `the tooltip names the whole wrapped path, got ${await hostTitle357()}`);
  await screenEvent357('mousemove', { x: wrapPos.x, y: wrapPos.y + 200 });
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === undefined`, 'the pointer off the wrapped path clears the host', 5000);
  step("M9 fix 423: a path wrapped across the pane's rows by its own length is still one link, hovered whole from the row its wrap lands on");

  // M9 fix 425: the hover's stat is cached for five seconds, so hovering
  // the same link twice inside that window makes one call. A token of
  // its own, never hovered before this step, and window.emerald.files.stat
  // wrapped with a counter when the bridge allows the reassignment (the
  // fix 204 recipe in verify-m13-markdown.mjs).
  const cacheFile = path.join(repo, 'b425.txt');
  fs.writeFileSync(cacheFile, 'b\n');
  const cacheToken = 'b425.txt';
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(repoShell)}, data: 'Write-Host ' + ${JSON.stringify(cacheToken)} + String.fromCharCode(13) })`);
  {
    const printed = Date.now() + 10000;
    while ((await s.evalJs(pathCell(cacheToken))) === null && Date.now() < printed) await sleep(250);
    if ((await s.evalJs(pathCell(cacheToken))) === null) throw new Error(`the cache token never printed: ${await s.evalJs(dumpBuf357)}`);
  }
  const cacheCell = await s.evalJs(pathCell(cacheToken));
  const stubbed425 = await s.evalJs(
    `(() => { try { window.__origStat425 = window.emerald.files.stat.bind(window.emerald.files); window.__statCount425 = 0; window.emerald.files.stat = (p) => { window.__statCount425++; return window.__origStat425(p); }; return window.emerald.files.stat.toString().includes('__statCount425'); } catch { return false; } })()`,
  );
  await screenEvent357('mousemove', cacheCell);
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === ${JSON.stringify(cacheFile)}`, 'the first hover resolves the cache token', 5000);
  await screenEvent357('mousemove', { x: cacheCell.x, y: cacheCell.y + 200 });
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === undefined`, 'off the cache token between the two hovers', 5000);
  await screenEvent357('mousemove', cacheCell);
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === ${JSON.stringify(cacheFile)}`, 'the second hover resolves the cache token too', 5000);
  if (stubbed425) {
    const statCount425 = await s.evalJs(`window.__statCount425 ?? 0`);
    await s.evalJs(`window.emerald.files.stat = window.__origStat425; delete window.__origStat425; delete window.__statCount425;`);
    expect(statCount425 === 1, `two hovers of the same link inside the five-second window make one stat call, got ${statCount425}`);
    step("M9 fix 425: the path link's hover caches its stat for five seconds, so a second hover of the same link inside that window makes no new stat call");
  } else {
    step('M9 fix 425: the bridge is sealed, so the stat count is not driven (both hovers still resolved above)');
  }
  await screenEvent357('mousemove', { x: cacheCell.x, y: cacheCell.y + 200 });
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === undefined`, 'off the cache token after the cache step', 5000);
  fs.rmSync(dir423, { recursive: true, force: true });
  fs.rmSync(cacheFile, { force: true });

  // M9 fix 653: a folder a pane prints is a link too. Hovered, the host
  // names it with `in Explorer`; a plain click does nothing; a Ctrl+click
  // opens it in Explorer, held here as an `open-folder` line in the open
  // log, and opens no tab. A file keeps fix 357's tooltip word for word,
  // and a Ctrl+Shift+click on it shows it in its folder (a `reveal` line)
  // with no tab and no selection left on the pane. The repo pane is
  // narrow here (fix 423's width), so both tokens are short.
  const dir653 = path.join(repo, 'f653', 'in');
  const file653 = path.join(repo, 'r653.txt');
  fs.mkdirSync(dir653, { recursive: true });
  fs.writeFileSync(file653, 'r\n');
  const dirToken653 = 'f653/in';
  const fileToken653 = 'r653.txt';
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(repoShell)}, data: 'Write-Host ' + ${JSON.stringify(dirToken653)} + '; Write-Host ' + ${JSON.stringify(fileToken653)} + String.fromCharCode(13) })`);
  {
    const printed = Date.now() + 10000;
    while (((await s.evalJs(pathCell(dirToken653))) === null || (await s.evalJs(pathCell(fileToken653))) === null) && Date.now() < printed) await sleep(250);
    if ((await s.evalJs(pathCell(fileToken653))) === null) throw new Error(`the fix 653 tokens never printed: ${await s.evalJs(dumpBuf357)}`);
  }
  const openedLines653 = () => (fs.existsSync(openedPaths) ? fs.readFileSync(openedPaths, 'utf8').split(/\r?\n/) : []);
  const waitOpened653 = async (line, what) => {
    const until = Date.now() + 3000;
    while (!openedLines653().includes(line) && Date.now() < until) await sleep(100);
    expect(openedLines653().includes(line), `${what}: the open log holds ${JSON.stringify(line)} (${JSON.stringify(openedLines653())})`);
  };
  const tabCount653 = () => s.evalJs(`document.querySelectorAll('.tab-file').length`);
  const dirCell653 = await s.evalJs(pathCell(dirToken653));
  expect(dirCell653 !== null, 'the folder token is on a row of its own');
  await screenEvent357('mousemove', dirCell653);
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === ${JSON.stringify(dir653)}`, 'the folder path on the host', 5000);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(linkHost357)}).dataset.linkKind`)) === 'dir', 'the host says the link is a folder');
  expect((await hostTitle357()) === `Ctrl+click opens ${dir653} in Explorer`, `the folder's tooltip names Explorer, got ${await hostTitle357()}`);
  const openedBefore653 = openedLines653().length;
  const tabsBefore653 = await tabCount653();
  await screenEvent357('mousedown', dirCell653);
  await screenEvent357('mouseup', dirCell653);
  await sleep(400);
  expect(openedLines653().length === openedBefore653, `a plain click on the folder writes nothing (${JSON.stringify(openedLines653())})`);
  await screenEvent357('mousedown', dirCell653, ', ctrlKey: true');
  await screenEvent357('mouseup', dirCell653, ', ctrlKey: true');
  await waitOpened653(`open-folder ${dir653}`, 'the Ctrl+click on the folder');
  expect((await tabCount653()) === tabsBefore653, 'the folder opened no tab');
  await screenEvent357('mousemove', { x: dirCell653.x, y: dirCell653.y + 200 });
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === undefined`, 'the pointer off the folder clears the host', 5000);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(linkHost357)}).dataset.linkKind ?? null`)) === null, 'the leave clears the kind too');
  step('M9 fix 653: a folder a pane prints is a link, the hover names Explorer, a plain click does nothing and a Ctrl+click opens the folder, no tab');

  const fileCell653 = await s.evalJs(pathCell(fileToken653));
  await screenEvent357('mousemove', fileCell653);
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === ${JSON.stringify(file653)}`, 'the file path on the host', 5000);
  expect((await hostTitle357()) === `Ctrl+click opens ${file653}`, `the file's tooltip is fix 357's, unchanged, got ${await hostTitle357()}`);
  // The clicks on the folder above left xterm a selection start, so a
  // Shift+click would select from there to here unless the pane drops it.
  await screenEvent357('mousedown', fileCell653, ', ctrlKey: true, shiftKey: true');
  await screenEvent357('mouseup', fileCell653, ', ctrlKey: true, shiftKey: true');
  await waitOpened653(`reveal ${file653}`, 'the Ctrl+Shift+click on the file');
  await sleep(300);
  expect((await tabCount653()) === tabsBefore653, 'the Ctrl+Shift+click opened no tab');
  expect(!(await s.evalJs(`document.querySelector(${JSON.stringify(linkHost357)}).emeraldTerm.hasSelection()`)), 'the Ctrl+Shift+click left no selection on the pane');
  await screenEvent357('mousemove', { x: fileCell653.x, y: fileCell653.y + 200 });
  await s.waitFor(`document.querySelector(${JSON.stringify(linkHost357)})?.dataset.link === undefined`, 'the pointer off the file clears the host', 5000);
  fs.rmSync(path.join(repo, 'f653'), { recursive: true, force: true });
  fs.rmSync(file653, { force: true });
  step('M9 fix 653: a Ctrl+Shift+click on a file a pane prints shows it in its folder, no tab and no selection');

  fs.rmSync(notesPath, { force: true });
  step("M9 fix 180: the file pane's menu opens the file as a tab, and the tab dragged onto a pane lands as a file pane too");


  // The window closed and the daemon killed; the app relaunched with the
  // daemon told to report level 21 (before views): the leaves survive,
  // since the daemon's build is this one, but the tab does not drag and
  // the heading offers no view.
  const oldPid = daemonPid();
  const child = s.child;
  s.send('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {});
  s.close();
  await Promise.race([new Promise((r) => child.on('exit', r)), sleep(10000)]);
  // M9 fix 645: a window still up here shares the profile with the relaunch, which then never ran its renderer; end it through Node's handle, never a tree kill, which would take the daemon the relaunch reuses.
  if (child.exitCode === null && child.signalCode === null) {
    console.log('[verify] note: the old window had not exited after 10 s');
    child.kill();
    await Promise.race([new Promise((r) => child.once('exit', r)), sleep(5000)]);
  }
  execFileSync('taskkill', ['/pid', String(oldPid), '/f'], { stdio: 'ignore' });
  await sleep(1000);
  process.env['EMERALD_DAEMON_FEATURE_LEVEL'] = '21';
  s = await launch(s.port + 1);
  app = s;
  await s.waitFor(`!!document.querySelector('.app-body')`, 'app after relaunch');
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'four panes after relaunch', 20000);
  await s.waitFor(`!!document.querySelector('.daemon-banner, .banner')`, 'the older-daemon banner', 20000);
  expect((await s.evalJs(`document.querySelectorAll('.pane[data-view="commits"]').length`)) === 2, 'the views are still in the layout');
  expect(!(await s.evalJs(`!!document.querySelector('.pane[data-view] .activity-scope')`)), 'no scope toggle under an older daemon (M66)');
  // M69: neither pane button under a daemon that holds no views.
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .commits-panel')`, 'the rail on the Activity tab');
  expect(!(await s.evalJs(`!!document.querySelector('.files-rail .commits-open-pane, .files-rail .activity-open-pane')`)), 'no pane buttons on the rail under level 21 (M69)');
  // The sessions died with the daemon, so a fresh shell gives the home
  // folder a live heading with a +.
  await s.evalJs(`window.emerald.request('session.spawn', { kind: 'shell', cwd: ${JSON.stringify(home)}, cols: 120, rows: 30 })`);
  await s.waitFor(`[...document.querySelectorAll('.sidebar-group')].some((g) => g.dataset.group === ${JSON.stringify(home)})`, 'a live heading for home');
  const oldItems = await addMenuItems(home);
  expect(!oldItems.includes('Commits in a pane'), `no commits view offered under level 21, got ${JSON.stringify(oldItems)}`);
  await s.key('Escape', 'Escape', 27);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)})?.dataset.draggable`)) === undefined, 'the Commits tab does not drag under level 21');
  // M9 fix 180: nor does a file row, and its menu offers no pane.
  const viewBox21 = await boxOf(viewPane);
  await s.click(Math.round(viewBox21.x + viewBox21.width / 2), Math.round(viewBox21.y + viewBox21.height / 2));
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'the rail on the repo under level 21');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelectorAll('.files-row[data-kind="file"]').length > 0`, 'file rows under level 21', 10000);
  expect((await s.evalJs(`document.querySelectorAll('.files-row[data-draggable]').length`)) === 0, 'no file row drags under level 21');
  await s.evalJs(`(() => { const r = document.querySelector('.files-row[data-kind="file"]'); const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 })); })()`);
  await s.waitFor(`!!document.querySelector('.files-menu')`, 'the row menu under level 21');
  expect(!(await s.evalJs(`[...document.querySelectorAll('.files-menu .menu-item')].some((b) => b.querySelector('.menu-label').textContent === 'Open in a pane')`)), 'no Open in a pane under level 21');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.files-menu')`, 'the menu closed');
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  expect(oldItems.includes('Commits in a tab'), `the graph as a tab is the renderer's own and is offered under any daemon, got ${JSON.stringify(oldItems)}`);
  step('under a level 21 daemon the heading offers no view and the tab does not drag');

  // M61: the graph as a document tab. A second branch gives the repo a
  // graph; the view pane focused puts the rail on the repo, whose
  // Commits tab then offers Expand; the tab holds the same graph, comes
  // back after a reload, and the heading's + menu opens it too.
  git('checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(repo, 'c.txt'), 'c\n');
  git('add', '.');
  git('commit', '-q', '-m', 'third');
  git('checkout', '-q', 'main');
  const allCommits = Number(git('rev-list', '--count', '--branches').trim());
  const viewBox = await boxOf(viewPane);
  await s.click(Math.round(viewBox.x + viewBox.width / 2), Math.round(viewBox.y + viewBox.height / 2));
  await s.waitFor(focusedPaneIs(viewPane), 'the view pane focused');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'the rail on the repo');
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.view === 'graph' && document.querySelectorAll('.files-rail .commits-node').length === ${allCommits}`, `the rail draws the graph with ${allCommits} nodes once the branch is seen`, 10000);
  await s.evalJs(`document.querySelector('.files-rail .commits-expand').click()`);
  const viewSel = `.commits-view[data-folder=${JSON.stringify(repo)}]`;
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(viewSel + ' .commits-node')}).length === ${allCommits}`, 'the tab draws the same graph', 10000);
  const tabProbe = () => s.evalJs(`(() => { const t = [...document.querySelectorAll('.tab')].find((x) => x.textContent.includes('Commits ·')); return { name: t?.querySelector('.tab-name')?.textContent.trim() ?? null, active: t ? 'active' in t.dataset : null, icon: !!t?.querySelector('svg.tab-icon'), title: document.querySelector(${JSON.stringify(viewSel + ' .commits-view-title')})?.textContent ?? null, expand: !!document.querySelector(${JSON.stringify(viewSel + ' .commits-expand')}), tabs: document.querySelectorAll('.commits-view').length }; })()`);
  let docTab = await tabProbe();
  expect(docTab.name === `Commits · ${path.basename(repo)}` && docTab.active && docTab.icon, `the tab is named for the folder, active, with an icon (${JSON.stringify(docTab)})`);
  expect(docTab.title === `Commits · ${path.basename(repo)}` && !docTab.expand, `the tab's header names the folder and offers no Expand of its own (${JSON.stringify(docTab)})`);
  await s.screenshot('m61-commits-tab.png');
  step(`M61: Expand on the rail's Commits tab opens the graph as a tab, ${allCommits} nodes either way`);

  await s.send('Page.reload');
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(viewSel + ' .commits-node')}).length === ${allCommits}`, 'the tab is back after a reload with its graph', 15000);
  docTab = await tabProbe();
  expect(docTab.active && docTab.tabs === 1, `still the active tab, one of it (${JSON.stringify(docTab)})`);
  await s.evalJs(`window.emerald.request('session.spawn', { kind: 'shell', cwd: ${JSON.stringify(repo)}, cols: 120, rows: 30 })`);
  await s.waitFor(`[...document.querySelectorAll('.sidebar-group')].some((g) => g.dataset.group === ${JSON.stringify(repo)} && g.querySelector('.sidebar-group-add'))`, 'a live heading for the repo');
  const repoItems = await addMenuItems(repo);
  expect(repoItems.includes('Commits in a tab'), `the + menu offers the graph as a tab, got ${JSON.stringify(repoItems)}`);
  await s.evalJs(`[...document.querySelectorAll('.group-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Commits in a tab').click()`);
  await sleep(500);
  docTab = await tabProbe();
  expect(docTab.active && docTab.tabs === 1, `the same folder from the heading is the same tab, not a second (${JSON.stringify(docTab)})`);
  step('M61: the tab survives a reload and the heading opens the same one');

  // M9 fix 172: a fresh state with the activity view in the only pane
  // leaves the sidebar empty of sessions; its list offers New shell and
  // Claude session, each landing beside the focused pane, so the view
  // stays where it is. The window closed and the daemon killed as above,
  // the level pin dropped so the rail offers the view in a pane.
  const pidBefore172 = daemonPid();
  const child172 = s.child;
  s.send('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {});
  s.close();
  await Promise.race([new Promise((r) => child172.on('exit', r)), sleep(10000)]);
  if (child172.exitCode === null && child172.signalCode === null) {
    console.log('[verify] note: the old window had not exited after 10 s');
    child172.kill();
    await Promise.race([new Promise((r) => child172.once('exit', r)), sleep(5000)]);
  }
  execFileSync('taskkill', ['/pid', String(pidBefore172), '/f'], { stdio: 'ignore' });
  await sleep(1000);
  delete process.env['EMERALD_DAEMON_FEATURE_LEVEL'];
  s = await launch(s.port + 1, { freshState: true });
  app = s;
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'the empty pane on a fresh state');
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.activity-card .activity-open-pane')`, 'the rail offers the day in a pane');
  await s.evalJs(`document.querySelector('.activity-card .activity-open-pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1 && document.querySelectorAll('.pane[data-view="activity"]').length === 1`, 'the activity view in the only pane');
  await s.waitFor(`document.querySelector('.sidebar-empty')?.textContent === 'No sessions yet' && !!document.querySelector('.sidebar-empty-actions .empty-new') && !!document.querySelector('.sidebar-empty-actions .empty-claude')`, 'the empty sidebar with its two starts');
  await s.screenshot('m9-fix172-empty-sidebar.png');
  // Claude session: the dialog opens on a new pane beside the view.
  await s.evalJs(`document.querySelector('.sidebar-empty-actions .empty-claude').click()`);
  await s.waitFor(`!!document.querySelector('.dialog.new-session') && document.querySelectorAll('.pane').length === 2`, 'the new session dialog over a second pane');
  layout = await getLayout(s);
  const viewLeaf172 = leaves(layout).find((p) => p.view !== null);
  const emptyLeaf172 = leaves(layout).find((p) => p.view === null && p.sessionId === null);
  expect(viewLeaf172 !== undefined && viewLeaf172.view.kind === 'activity' && emptyLeaf172 !== undefined && layout.focusedPaneId === emptyLeaf172.id, `the view kept its pane and the dialog's pane is the new empty one, got ${JSON.stringify(leaves(layout))}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.dialog.new-session')`, 'the dialog closed');
  // New shell: the empty pane beside the view is taken as it is.
  await s.evalJs(`document.querySelector('.sidebar-empty-actions .empty-new').click()`);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1 && document.querySelectorAll('.pane').length === 2 && document.querySelectorAll('.pane[data-view="activity"]').length === 1`, 'a shell beside the view, the view still there');
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 1 && !document.querySelector('.sidebar-empty') && !document.querySelector('.sidebar-empty-actions')`, 'the sidebar shows the row and no starts');
  layout = await getLayout(s);
  const shellLeaf172 = leaves(layout).find((p) => p.sessionId !== null);
  expect(shellLeaf172 !== undefined && shellLeaf172.id === emptyLeaf172.id && leaves(layout).some((p) => p.id === viewLeaf172.id && p.view !== null), `the shell took the empty pane beside the view, got ${JSON.stringify(leaves(layout))}`);
  step("M9 fix 172: the empty sidebar's Claude session opens the dialog beside the view and its New shell starts a shell there, the view kept");

  // M9 fix 225: the terminal's colour scheme. The pane menu's last
  // section (M9 fix 648: Terminal colours, a This session row and a The
  // window row that opens the list) lists the shipped schemes, emerald first and checked; a pick
  // sets every terminal's theme and the pane's ground, and lands in
  // localStorage; a Windows Terminal settings.json with a scheme of the
  // person's lists it after the shipped ones and applies the same way;
  // the pick survives a reload; emerald picked back clears the key.
  const shellPaneSel = '.pane:not([data-view])';
  const openPaneMenu = async () => {
    await s.evalJs(`(() => { const t = document.querySelector(${JSON.stringify(shellPaneSel)} + ' .pane-title'); const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + r.height / 2 })); })()`);
    await s.waitFor(`!!document.querySelector('.pane-menu')`, 'the pane menu');
  };
  const menuLabels = () => s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].map((b) => ({ label: b.querySelector('.menu-label').textContent.replace(/^✓/, ''), checked: b.dataset.checked ?? null }))`);
  const subLabels = () => s.evalJs(`[...document.querySelectorAll('.menu-sub .menu-item')].map((b) => ({ label: b.querySelector('.menu-label').textContent.replace(/^✓/, ''), checked: b.dataset.checked ?? null }))`);
  // The window's list, opened when it is not open yet.
  const openWindowList = async () => {
    if (await s.evalJs(`!!document.querySelector('.menu-sub[data-parent="The window"]')`)) return;
    await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'The window').click()`);
    await s.waitFor(`!!document.querySelector('.menu-sub[data-parent="The window"]')`, "the window's scheme list");
  };
  const pickScheme = async (name) => {
    await openWindowList();
    await s.evalJs(`[...document.querySelectorAll('.menu-sub .menu-item')].find((b) => b.querySelector('.menu-label').textContent.replace(/^✓/, '') === ${JSON.stringify(name)}).click()`);
    await s.waitFor(`document.documentElement.dataset.scheme === ${JSON.stringify(name)}`, `the root names ${name}`);
  };
  const schemeProbe = () =>
    s.evalJs(
      `(() => { const host = document.querySelector('.term-host'); return { root: document.documentElement.dataset.scheme ?? null, theme: host.emeraldTerm.options.theme.background, ground: getComputedStyle(host).backgroundColor, viewport: getComputedStyle(host.querySelector('.xterm-viewport')).backgroundColor, stored: localStorage.getItem('emerald.scheme') }; })()`,
    );
  await openPaneMenu();
  let labels = await menuLabels();
  const headAt = labels.findIndex((l) => l.label === 'Terminal colours');
  expect(headAt > 0, `the menu ends in a Terminal colours section, got ${JSON.stringify(labels.map((l) => l.label))}`);
  // The section is two rows (M9 fix 648, verify:menus drives This session's
  // list); the window's list holds the scheme rows.
  expect(labels[headAt + 1]?.label === 'This session' && labels[headAt + 1].checked === null && labels[headAt + 2]?.label === 'The window', `This session and The window head the section, got ${JSON.stringify(labels.slice(headAt, headAt + 3))}`);
  await openWindowList();
  const schemeRows = await subLabels();
  expect(
    JSON.stringify(schemeRows.map((l) => l.label)) === JSON.stringify(['emerald', 'emerald gem', 'Dracula', 'One Dark', 'Solarized Dark', 'Tokyo Night']),
    `the six shipped schemes, emerald first and emerald gem second, got ${JSON.stringify(schemeRows.map((l) => l.label))}`,
  );
  expect(schemeRows[0].checked === 'true' && schemeRows.slice(1).every((l) => l.checked === 'false'), `emerald is the checked one, got ${JSON.stringify(schemeRows)}`);
  let sp = await schemeProbe();
  expect(sp.theme === '#1e1e1e' && sp.ground === 'rgb(30, 30, 30)' && sp.stored === null, `the default is the emerald scheme with no key stored, got ${JSON.stringify(sp)}`);
  await pickScheme('Solarized Dark');
  await s.waitFor(`document.querySelector('.term-host').emeraldTerm.options.theme.background === '#002b36'`, 'the terminal on Solarized Dark');
  sp = await schemeProbe();
  expect(sp.ground === 'rgb(0, 43, 54)' && sp.viewport === 'rgb(0, 43, 54)', `the pane's ground and the viewport take the scheme's background, got ${JSON.stringify(sp)}`);
  expect(sp.stored === 'Solarized Dark', `the pick is in localStorage, got ${JSON.stringify(sp.stored)}`);
  labels = await subLabels();
  expect(labels.some((l) => l.label === 'Solarized Dark' && l.checked === 'true') && labels.some((l) => l.label === 'emerald' && l.checked === 'false'), `the menu and the list stay open with the pick checked, got ${JSON.stringify(labels)}`);
  await s.screenshot('m9-fix225-scheme.png');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'the menu closed');
  // The person's own scheme, in a settings.json with the comments and the
  // trailing comma Windows Terminal writes.
  const teal = { name: 'Verify Teal', background: '#001F1F', foreground: '#C0FFEE', cursorColor: '#FFFFFF', selectionBackground: '#4A90D9', black: '#000000', red: '#AA0000', green: '#00AA00', yellow: '#AAAA00', blue: '#0000AA', purple: '#AA00AA', cyan: '#00AAAA', white: '#AAAAAA', brightBlack: '#555555', brightRed: '#FF5555', brightGreen: '#55FF55', brightYellow: '#FFFF55', brightBlue: '#5555FF', brightPurple: '#FF55FF', brightCyan: '#55FFFF', brightWhite: '#FFFFFF' };
  fs.writeFileSync(wtSettings, ['{', "  // the person's schemes", `  "colorSchemes": [ ${JSON.stringify(teal)}, ],`, '  "profiles": { "list": [] },', '}', ''].join('\n'));
  await openPaneMenu();
  await openWindowList();
  await s.waitFor(`[...document.querySelectorAll('.menu-sub .menu-item')].some((b) => b.textContent.includes('Verify Teal'))`, 'the Windows Terminal scheme listed');
  labels = await subLabels();
  const names = labels.map((l) => l.label);
  expect(names[names.length - 1] === 'Verify Teal' && names[names.length - 2] === 'Tokyo Night', `the person's scheme comes after the shipped ones, got ${JSON.stringify(names)}`);
  await pickScheme('Verify Teal');
  await s.waitFor(`document.querySelector('.term-host').emeraldTerm.options.theme.background === '#001f1f'`, 'the terminal on Verify Teal');
  sp = await schemeProbe();
  expect(sp.ground === 'rgb(0, 31, 31)' && sp.stored === 'Verify Teal', `the person's scheme applied and stored, got ${JSON.stringify(sp)}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'the menu closed again');
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.term-host') && document.documentElement.dataset.scheme === 'Verify Teal' && document.querySelector('.term-host').emeraldTerm?.options.theme.background === '#001f1f'`, 'the pick held across a reload', 20000);
  await openPaneMenu();
  await pickScheme('emerald');
  sp = await schemeProbe();
  expect(sp.theme === '#1e1e1e' && sp.ground === 'rgb(30, 30, 30)' && sp.stored === null, `emerald picked back clears the key, got ${JSON.stringify(sp)}`);
  await s.key('Escape', 'Escape', 27);
  step('M9 fix 225: the pane menu lists the shipped schemes and a Windows Terminal one, a pick themes the terminal and the pane ground, survives a reload, and emerald clears the key');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  try {
    await s.screenshot('m52-view-fail.png');
  } catch {
    // The window may be gone.
  }
  process.exitCode = 1;
} finally {
  try {
    s.close();
  } catch {
    // Already closed.
  }
  killTree(s.child);
  stopDaemon();
  // The last shell spawned sits in the repo (M61's step) and takes a
  // moment to die with the daemon, so the folder is retried and, failing
  // that, left for the next run.
  try {
    fs.rmSync(repoShort, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(path.join(os.tmpdir(), 'emerald-verify', `m52-lift-${process.pid}`), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Left for the next run.
  }
  setTimeout(() => process.exit(), 500);
}
