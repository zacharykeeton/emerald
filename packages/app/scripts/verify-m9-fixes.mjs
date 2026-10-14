// M9 acceptance, part 2: the click-through fixes 3 to 6. Fix 3, shells
// first: a shell starts without a dialog from the empty pane's button,
// Ctrl+Shift+N and the pane menu, in the folder of the session in that pane
// or else the last folder used, beside that session rather than over it
// since M9 fix 419; the title bar split menu's Split with shell starts a shell
// in the new pane in the same folder as the pane it came from (a plain split gives an empty pane since M9 fix 537); the dialog
// is still there for Claude. Later fixes append their own sections, up to
// 15: a sidebar row dragged onto a pane, and 18: the tab strip over the panes;
// then M32's order setting, the folder headings' rollup and their +, and
// M38's skin read off computed styles: seams, tints, a flat find bar.
// Uses a private home and pipe unless the environment already names them,
// so it can run beside a live emerald. Starts from an empty layout.
// Run: npm run verify:m9 -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm9-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m9';
// Fix 11: the private daemon reports itself as an older build than the
// app for the whole run, so the banner is up throughout and the last
// section drives its Restart. Sessions are stamped without EMERALD_* so the
// shells never see it. Level 1 leaves layout tabs (level 9, TABS_LEVEL in
// daemon-model.ts) and every later feature unsupported, and the Restart
// starts the new daemon at level 1 again, so a layout-tab, file-tab or
// pane-view step is a silent no-op in this script and belongs in
// verify:tabs (M9 fix 605).
process.env['EMERALD_DAEMON_FEATURE_LEVEL'] = '1';
// M34: the daemon is started by the app, which inherits this, the way a
// daemon started from a Claude Code Bash tool in Windows Terminal inherits
// NO_COLOR=1; the last section checks no shell sees it.
process.env['NO_COLOR'] = '1';
// M9 fix 204: a URL Ctrl+clicked in a pane goes to the main process, whose
// bridge is sealed against a page-level stub, so the harness names a file
// the main process writes the URL to instead of opening the browser.
const openedLinks = path.join(os.tmpdir(), 'emerald-verify', 'm9-opened-links.log');
fs.rmSync(openedLinks, { force: true });
process.env['EMERALD_OPEN_LOG'] = openedLinks;
// M9 fix 547: Another folder… answers this folder under the harness, the
// chooser being a native dialog no script can drive.
const pickedDir = path.join(os.tmpdir(), 'emerald-verify', 'm9-picked');
process.env['EMERALD_PICK_FOLDER'] = pickedDir;
const { blockRunner, CTRL, SHIFT, expect, focusedPaneIs, freshPort, getLayout, hoverForCard: hoverForCardIn, killTree, launch, leaves, profileOf, repoRoot, setInput, sleep, splitWithShell, startFromEmpty, startSession, startShellByKey, step, stopDaemon, zreq } =
  await import('./cdp.mjs');

// M9 fix 605: the steps after the prelude are blocks, each a closure a
// run can skip. The prelude always runs: the twin launch (fix 115), the
// pane and sidebar sections, the fix 11 Restart and fix 159, and the
// dropped shell every later section reads, with restarted and postTo off
// the new daemon.json. needs names the blocks whose sessions or bindings
// a block reads, and --only runs those with it, in file order. A name is
// a block's own, or any fix or milestone id a block carries (fix-344
// runs m46). A binding one block makes and another reads is a let above
// the first block, and a helper two blocks call is a const there. A new
// section joins the block whose sessions it reads, or starts a block of
// its own that removes what it spawned in its last lines, as fix 547's
// does.
// `layout` is scratch: the prelude has its own, and each block that reads
// it declares its own with its first read of getLayout, so none reads
// another block's value (M9 fix 623).
// m46 needs m33: the dropped row working, the turn M33 opens.
const BLOCKS = [
  { name: 'm33', fixes: ['m33', 'm46', 'fix-78', 'm41'], needs: [] },
  { name: 'm46', fixes: ['m46', 'fix-88', 'fix-82', 'fix-81', 'fix-89', 'fix-344', 'fix-90', 'fix-289', 'fix-101', 'fix-122'], needs: ['m33'] },
  { name: 'fix-76', fixes: ['fix-76', 'fix-102', 'fix-123', 'fix-77', 'fix-237'], needs: [] },
  { name: 'm39', fixes: ['m39', 'fix-86', 'fix-535', 'm40', 'fix-59', 'fix-34', 'fix-158', 'm73'], needs: ['m33'] },
  { name: 'm32', fixes: ['m32', 'm40', 'fix-69', 'fix-189', 'm73', 'fix-27', 'fix-51', 'm61', 'fix-64'], needs: [] },
  { name: 'fix-75', fixes: ['fix-75', 'fix-193', 'fix-345'], needs: [] },
  { name: 'm38', fixes: ['m38', 'fix-43', 'fix-22', 'fix-23', 'fix-24', 'fix-19', 'fix-20', 'fix-21', 'fix-57', 'fix-36', 'fix-37'], needs: ['m32'] },
  { name: 'm43', fixes: ['m43', 'fix-88', 'm73', 'fix-91', 'fix-578', 'fix-95'], needs: [] },
  { name: 'fix-93', fixes: ['fix-93', 'fix-143', 'fix-146', 'fix-154', 'fix-221', 'fix-155', 'fix-153', 'fix-156'], needs: [] },
  { name: 'fix-204', fixes: ['fix-204', 'fix-355', 'fix-356'], needs: [] },
  { name: 'fix-547', fixes: ['fix-547', 'fix-577', 'fix-575'], needs: [] },
];
const { block, blocksRun, partial } = blockRunner(BLOCKS);

// The daemon writes sessions.json up to a quarter second after a change
// (M9 fix 459), so a read of the file waits up to three seconds for the
// record to satisfy the check and answers it (or the last read); a read
// mid-rename is tried again.
const savedRecord = async (id, pred) => {
  let rec;
  for (const end = Date.now() + 3000; ; await sleep(100)) {
    try {
      rec = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'sessions.json'), 'utf8')).sessions.find((x) => x.id === id);
    } catch {}
    if ((rec !== undefined && pred(rec)) || Date.now() > end) return rec;
  }
};

// The watchdog kills the window and the private daemon too, so a stalled
// run cannot leave an app behind for the next script to trip over.
let app = null;
// 75 s quiet for a whole run (the batches of fixes 426 to 449 and the M75
// floor) against 240 s; a run under --only is the prelude and a few
// blocks, held to 180 s as verify:skin's is (M9 fix 605).
const watchdogMs = partial ? 180000 : 240000;
setTimeout(() => {
  console.error(`[verify] WATCHDOG: run exceeded ${watchdogMs / 1000} s${partial ? ' (--only)' : ''}`);
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, watchdogMs);
step(`watchdog armed at ${watchdogMs / 1000} s${partial ? ' (--only)' : ''}`);

const home = os.homedir();
const sessionOf = async (s, paneId) => {
  const layout = await getLayout(s);
  const pane = leaves(layout).find((p) => p.id === paneId);
  if (pane === undefined || pane.sessionId === null) return null;
  return (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === pane.sessionId) ?? null;
};
const centerOf = (s, selector) =>
  s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const chooseMenu = async (s, paneId, label) => {
  const c = await centerOf(s, `[data-pane-id=${JSON.stringify(paneId)}]`);
  await s.rightClick(c.x, c.y);
  await s.waitFor(`document.querySelector('.pane-menu')?.dataset.paneId === ${JSON.stringify(paneId)}`, `menu on pane ${paneId.slice(0, 8)}`);
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
};
const document_dragging = (bodyClass) => /dragging-(col|row)/.test(bodyClass);

// M9 fix 115: two windows launched within a second of each other, on two
// private pairs, both reach a page target; the shared Electron profile
// used to lose one of them to `Unable to move the cache`. The second
// window is this step's alone and goes with its daemon and its profile.
step('M9 fix 115: two harness windows launched together each get a profile of their own');
const firstPort = freshPort();
const twin = { home: path.join(os.tmpdir(), 'emerald-verify', 'm9-twin-home'), pipe: '\\\\.\\pipe\\emmerd-verify-m9-twin' };
// M9 fix 355: the inspect port asked for on the first window, which the
// harness argument on the command line refuses (the step reads the line).
const [s, twinApp] = await Promise.all([launch(firstPort, { freshState: true, env: { EMERALD_INSPECT_PORT: String(firstPort) } }), launch(firstPort + 7, { freshState: true, pair: twin })]);
app = s;
try {
  expect(fs.existsSync(profileOf(process.env['EMERALD_HOME'])) && fs.existsSync(profileOf(twin.home)), 'each window has a profile folder under its own home');
  expect(!s.logs.join('').includes('Unable to') && !twinApp.logs.join('').includes('Unable to'), 'neither window logged a cache complaint');
  twinApp.close();
  killTree(twinApp.child);
  stopDaemon(twin.home);
  const gone = Date.now() + 8000;
  while (fs.existsSync(profileOf(twin.home)) && Date.now() < gone) await sleep(250);
  expect(!fs.existsSync(profileOf(twin.home)), 'the stopped window\'s profile folder is removed');
  expect(fs.existsSync(profileOf(process.env['EMERALD_HOME'])), 'the running window keeps its profile');
  step('M9 fix 115: PASS, both windows');

  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await s.waitFor(
    `(document.querySelector('.empty-pane .empty-start')?.innerText ?? '').startsWith(${JSON.stringify('Start shell in ' + path.basename(home))}) && document.querySelector('.empty-pane .empty-kind[data-kind="shell"]')?.getAttribute('aria-pressed') === 'true'`,
    'the empty pane offers Start shell in the home folder',
  );
  let layout = await getLayout(s);
  const p1 = leaves(layout)[0].id;

  // Two shells through the dialog so the last folder used is known: pane 1
  // in the repo, pane 2 at home.
  await startSession(s, { kind: 'shell', cwd: repoRoot });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell in pane 1');
  // M9 fix 181: the zoom button is hidden, not disabled, on the only pane.
  expect((await s.evalJs(`document.querySelectorAll('.pane-title-actions').length === 1 && document.querySelector('.pane-zoom') === null`)) === true, 'no zoom button on the only pane');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'chord split gives an empty pane');
  layout = await getLayout(s);
  const p2 = leaves(layout)[1].id;
  expect(leaves(layout)[1].sessionId === null, 'the chord left pane 2 empty');
  await startSession(s, { kind: 'shell', cwd: home });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'shell in pane 2');
  step('pane 1 is a shell in the repo, pane 2 a shell at home (last folder used)');

  // M9 fix 181: the zoom button on the title bar takes the pane to the
  // whole tab and back, the M5 zoom the chord and the menu reach, lit
  // while zoomed, the layout untouched either way.
  const zoomBtn = `[data-pane-id=${JSON.stringify(p1)}] .pane-zoom`;
  const zoomRead = () => s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(zoomBtn)}); return { present: b !== null, active: b?.hasAttribute('data-active') ?? null, title: b?.title ?? null, zoomed: document.querySelector('.splitview.zoomed') !== null, buttons: document.querySelectorAll('.pane-zoom').length }; })()`);
  const beforeZoom = await zoomRead();
  expect(beforeZoom.present && beforeZoom.active === false && !beforeZoom.zoomed && beforeZoom.buttons === 2 && beforeZoom.title.startsWith('Focus, this pane alone in the tab'), `both panes offer the zoom button, unlit, got ${JSON.stringify(beforeZoom)}`);
  layout = await getLayout(s);
  const revisionBeforeZoom = layout.revision;
  await s.evalJs(`document.querySelector(${JSON.stringify(zoomBtn)}).click()`);
  await s.waitFor(`!!document.querySelector('.splitview.zoomed')`, 'the button zoomed pane 1');
  const zoomedRead = await zoomRead();
  // The sibling is hidden under the zoom, not unmounted, so its button stays in the DOM.
  expect(zoomedRead.active === true && zoomedRead.title === 'Unfocus, back to the layout', `the button is lit while zoomed, got ${JSON.stringify(zoomedRead)}`);
  const zoomedWidth = await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect().width`);
  const panesWidth = await s.evalJs(`document.querySelector('.splitview').getBoundingClientRect().width`);
  expect(Math.abs(zoomedWidth - panesWidth) < 2, `the zoomed pane spans the tab: ${zoomedWidth} of ${panesWidth}`);
  await s.evalJs(`document.querySelector(${JSON.stringify(zoomBtn)}).click()`);
  await s.waitFor(`!document.querySelector('.splitview.zoomed')`, 'the button unzoomed');
  const afterZoom = await zoomRead();
  layout = await getLayout(s);
  expect(afterZoom.active === false && afterZoom.buttons === 2 && layout.focusedPaneId === p1 && leaves(layout).length === 2 && layout.revision <= revisionBeforeZoom + 1, `the layout is back with pane 1 focused and nothing but that focus changed, got ${JSON.stringify(afterZoom)} at revision ${layout.revision} of ${revisionBeforeZoom}`);
  // The button focused pane 1 (the zoom follows the focus); the steps
  // below start from pane 2 focused, as before the zoom.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .pane-title').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.pane.focused')?.dataset.paneId === ${JSON.stringify(p2)}`, 'pane 2 focused again');
  layout = await getLayout(s);
  step('M9 fix 181: the title bar zoom button zooms the pane, lights up, unzooms, and is absent on the only pane');

  // Title bar split from pane 1 through its menu's Split with shell: the new pane gets a shell in the repo, the
  // pane's folder, not the last folder used.
  await splitWithShell(s, `[data-pane-id=${JSON.stringify(p1)}] .pane-split-down`);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 3`, 'a third shell after the title bar split');
  layout = await getLayout(s);
  const p3 = layout.focusedPaneId;
  expect(p3 !== p1 && p3 !== p2, 'the new pane is focused');
  let info = await sessionOf(s, p3);
  expect(info?.kind === 'shell' && info.spawnCwd === repoRoot, `title bar split started a shell in the repo, got ${info?.spawnCwd}`);
  step('title bar split: new pane, new shell, same folder as pane 1');

  // Ctrl+Shift+E from pane 3 (focused) gives an empty pane 4; its Start
  // button, on Shell by default, starts a shell in the folder pane 4 was
  // split from, which is also the last folder used, the repo.
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'four panes');
  layout = await getLayout(s);
  const p4 = layout.focusedPaneId;
  await startFromEmpty(s, `[data-pane-id=${JSON.stringify(p4)}]`, { kind: 'shell' });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 4`, 'shell from the New shell button');
  info = await sessionOf(s, p4);
  expect(info?.kind === 'shell' && info.spawnCwd === repoRoot, `empty pane button used the last folder, got ${info?.spawnCwd}`);
  step('New shell button on an empty pane: last folder used, no dialog');

  // M9 fix 419: Ctrl+Shift+N over pane 3 (repo), which holds a live
  // shell, makes room beside it rather than taking the pane: a fifth
  // pane with a fifth shell in pane 3's folder, pane 3 still showing the
  // session it did, nothing pushed back to the sidebar on no pane.
  // Before the fix the new shell replaced the one on the pane. The new
  // pane is hidden again at the end, so the pane counts and the tree the
  // steps below read are the ones they were.
  const c3 = await centerOf(s, `[data-pane-id=${JSON.stringify(p3)}] .term-host`);
  await s.click(c3.x, c3.y);
  await s.waitFor(focusedPaneIs(p3), 'pane 3 focused');
  const before = (await sessionOf(s, p3)).id;
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p3)}]').classList.contains('focused')`, 'pane 3 drawn focused');
  await sleep(700);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(p3)}]').hasAttribute('data-flash')`, "pane 3's landing flash over", 2000);
  await s.evalJs(`(() => { window.__flash449 = new Set(); const add = (el) => { if (el.nodeType === 1 && el.hasAttribute('data-flash') && el.dataset.paneId) window.__flash449.add(el.dataset.paneId); }; window.__flashObs449 = new MutationObserver((records) => { for (const r of records) { if (r.type === 'attributes') add(r.target); for (const n of r.addedNodes) { add(n); if (n.nodeType === 1) n.querySelectorAll('[data-pane-id][data-flash]').forEach(add); } } }); window.__flashObs449.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-flash'] }); return true; })()`);
  await s.key('N', 'KeyN', 78, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 5 && document.querySelectorAll('.term-host').length === 5`, 'a fifth pane with a shell of its own beside pane 3');
  layout = await getLayout(s);
  const besideP3 = layout.focusedPaneId;
  // M9 fix 449: the new pane flashes once, the same cue fix 63 gives a
  // pane focus lands on (it opens focused already, so that effect alone
  // stays quiet for it); pane 3 held the focus before the split and kept
  // its own session, so it never carries data-flash.
  // The flash lives 600 ms on a timer, so it is caught by an observer
  // armed before the key rather than polled after the layout read.
  const besideP3Sel = `[data-pane-id=${JSON.stringify(besideP3)}]`;
  const flashed449 = await s.evalJs(`(() => { window.__flashObs449.disconnect(); return [...window.__flash449]; })()`);
  expect(flashed449.includes(besideP3), `the new pane flashes, got ${JSON.stringify(flashed449)} for ${besideP3}`);
  expect(!flashed449.includes(p3), `pane 3 never flashes, got ${JSON.stringify(flashed449)}`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(besideP3Sel)})?.hasAttribute('data-flash')`, 'the flash is over within a second', 1000);
  expect(besideP3 !== p3, 'the new pane is the focused one, not pane 3');
  expect((await sessionOf(s, p3))?.id === before, 'pane 3 still shows the shell it held');
  info = await sessionOf(s, besideP3);
  expect(info !== null && info.id !== before && info.spawnCwd === repoRoot, `Ctrl+Shift+N put a new shell beside pane 3 in the repo, got ${info?.spawnCwd}`);
  expect((await s.evalJs(`document.querySelectorAll('.sidebar-row').length`)) === 5, 'five sessions listed, none of them pushed off a pane');
  expect(!(await s.evalJs(`!!document.querySelector('.dialog')`)), 'no dialog opened');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(besideP3)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'the new pane hidden again, four panes');
  step('M9 fix 419: Ctrl+Shift+N splits beside the focused pane, a shell in its folder, the session it held still on it, no dialog; M9 fix 449: the new pane flashed once, pane 3 never did');

  // The menu: New shell here on pane 2 (home) takes the same route (M9
  // fix 419), and the Claude route still opens the dialog with Claude
  // preselected. Pane 2's new pane is hidden again as well.
  const p2Before = (await sessionOf(s, p2)).id;
  await chooseMenu(s, p2, 'New shell here');
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 6`, 'sixth session from the menu');
  await s.waitFor(`document.querySelectorAll('.pane').length === 5`, 'a fifth pane beside pane 2');
  await sleep(300);
  layout = await getLayout(s);
  const besideP2 = layout.focusedPaneId;
  expect(besideP2 !== p2, 'the menu made room beside pane 2 rather than taking it');
  expect((await sessionOf(s, p2))?.id === p2Before, 'pane 2 still shows the shell it held');
  info = await sessionOf(s, besideP2);
  expect(info?.spawnCwd === home, `menu New shell here used pane 2's folder, got ${info?.spawnCwd}`);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(besideP2)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'that pane hidden too, four panes again');
  await chooseMenu(s, p2, 'New Claude session here');
  await s.waitFor(`!!document.querySelector('.dialog')`, 'dialog for Claude');
  expect(await s.evalJs(`document.querySelector('.dialog input[name=kind][value=claude]').checked`), 'Claude preselected in the dialog');
  expect((await s.evalJs(`document.querySelector('.dialog input[name=cwd]').value`)) === home, 'dialog folder is the pane session folder');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.dialog')`, 'dialog closed');
  await s.screenshot('m9-fixes-shells.png');
  step('menu: New shell here beside the pane in its folder, New Claude session here opens the dialog');

  // M9 fix 448: New shell here used to take a view pane as it is (fix
  // 419's own line for it), replacing the view outright; now it takes the
  // same rule as a session pane, room made beside it. A view pane's own
  // menu has no New shell here row (pane-menu-model.ts's viewPaneMenu), so
  // the only way to reach startShellHere over one is Ctrl+Shift+N, the
  // chord the fix 419 step above already uses on pane 3. A throwaway
  // fifth pane carries the view so panes 1 to 4 are left exactly as they
  // are for the steps below.
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 5`, 'a fifth, empty pane');
  layout = await getLayout(s);
  const viewPane = layout.focusedPaneId;
  const asCommitsView = (node) =>
    node.kind === 'pane'
      ? node.id === viewPane
        ? { ...node, sessionId: null, view: { kind: 'commits', folder: repoRoot } }
        : node
      : { ...node, first: asCommitsView(node.first), second: asCommitsView(node.second) };
  await zreq(s, 'layout.set', { layout: { ...layout, root: asCommitsView(layout.root) } });
  await s.waitFor(`document.querySelector('.pane[data-view="commits"][data-pane-id=${JSON.stringify(viewPane)}]') !== null`, 'the fifth pane shows a commits view');
  await s.waitFor(focusedPaneIs(viewPane), 'the view pane still focused');
  await s.key('N', 'KeyN', 78, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 6`, 'a sixth pane beside the view');
  await sleep(300);
  layout = await getLayout(s);
  const besideView = layout.focusedPaneId;
  expect(besideView !== viewPane, 'Ctrl+Shift+N put the new shell beside the view, not over it');
  expect(leaves(layout).some((l) => l.id === viewPane && l.view?.kind === 'commits'), 'the view pane is still on the page');
  expect((await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(viewPane)}]')?.dataset.view`)) === 'commits', 'and still carries data-view="commits"');
  info = await sessionOf(s, besideView);
  expect(info?.kind === 'shell' && info.spawnCwd === repoRoot, `the new pane is a shell in the view's own repository, got ${info?.spawnCwd}`);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(besideView)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 5`, 'that pane hidden, the view pane alone again');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(viewPane)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'the view pane hidden too, four panes again');
  // Hiding a pane keeps its session in the sidebar (unlike the fix 419 and
  // menu steps above, this one is throwaway and no later step counts it),
  // so it is killed and removed here rather than left to inflate every
  // session count the rest of the file reads.
  await zreq(s, 'session.kill', { sessionId: info.id, remove: true });
  await s.waitFor(`!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(info.id)}]')`, 'the throwaway shell is gone from the sidebar too');
  step("M9 fix 448: Ctrl+Shift+N over a view pane splits beside it, a shell in the view's repository, the view still on the page");

  // Fix 4, names. Pane 4's shell gets hook events posted as if it were
  // Claude: a CwdChanged renames it after the new folder, a name typed into
  // the pane title sticks through the next CwdChanged, and an empty name
  // hands it back to the folder.
  const nameOf = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-name')?.textContent ?? null`);
  const rowName = (id) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}] .sidebar-row-name')?.textContent ?? null`);
  const waitName = (paneId, name, what) => s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-name')?.textContent === ${JSON.stringify(name)}`, what, 5000);
  const target = (await sessionOf(s, p4)).id;
  expect((await nameOf(p4)) === path.basename(repoRoot), 'pane 4 is named after its folder');
  const daemon = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const post = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': target },
      body: JSON.stringify({ session_id: 'sim-m9', cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  // Fix 12: SessionStart's cwd places the session, as a shell that runs
  // claude in another folder would be.
  await waitName(p4, 'sim', 'SessionStart placed the session in its folder');
  await post({ hook_event_name: 'CwdChanged', cwd: 'C:/sim/deeper', previous_cwd: 'C:/sim' });
  await waitName(p4, 'deeper', 'pane title follows the new folder');
  expect((await rowName(target)) === 'deeper', 'sidebar row follows too');
  step('CwdChanged renamed the session after its folder');

  // Fix 60: the name and the pane's folder follow the live directory, but
  // the row stays grouped under the folder Claude started in for the life
  // of the conversation; a SessionEnd makes it a shell again, grouped
  // where it is. A SessionStart then binds it again in that folder, so
  // the steps below see the same bound session as before.
  const groupOfRow = (id) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]')?.closest('.sidebar-group')?.dataset.group ?? null`);
  const paneCwd = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-cwd')?.textContent ?? null`);
  expect((await groupOfRow(target)) === 'C:/sim', `the row stays under the folder Claude started in, got ${await groupOfRow(target)}`);
  expect((await paneCwd(p4)) === 'C:/sim/deeper', 'and the pane title shows the live folder beside the name');
  const grouped = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(grouped.cwd === 'C:/sim/deeper' && grouped.groupCwd === 'C:/sim', `session.list has both folders, got ${grouped.cwd} under ${grouped.groupCwd}`);
  // Fix 74: SessionEnd puts the row, its group and its name straight back
  // where the shell's own prompt last reported (the real folder pane 4's
  // shell is in), not under the folder Claude's hooks said, so nothing
  // moves twice when the prompt comes back. The conversation the hooks
  // bound stays on the record for a resume (M48).
  const shellFolder = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target).shellCwd;
  expect(typeof shellFolder === 'string' && shellFolder.toLowerCase() === repoRoot.toLowerCase(), `the shell's own prompt reported the repo root, got ${shellFolder}`);
  await post({ hook_event_name: 'SessionEnd', cwd: 'C:/sim/deeper' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.closest('.sidebar-group')?.dataset.group?.toLowerCase() === ${JSON.stringify(repoRoot.toLowerCase())}`, 'the shell is grouped where its prompt is once Claude leaves');
  const backHome = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(backHome.cwd.toLowerCase() === repoRoot.toLowerCase() && backHome.groupCwd.toLowerCase() === repoRoot.toLowerCase(), 'both folders went back to the shell in one step');
  expect(backHome.conversation?.id === 'sim-m9' && backHome.conversation.cwd === 'C:/sim', `the conversation stays on the record, got ${JSON.stringify(backHome.conversation)}`);
  expect((await nameOf(p4)) === path.basename(repoRoot), 'the name went back to the folder with it');
  expect((await paneCwd(p4)) === null, 'and the pane title has no folder to add');
  await post({ hook_event_name: 'SessionStart', source: 'startup', cwd: 'C:/sim/deeper' });
  await s.waitFor(`(async () => (await window.emerald.request('session.list', {})).sessions.find(x => x.id === ${JSON.stringify(target)})?.claudeSessionId === 'sim-m9')()`, 'bound again in the deeper folder');
  step('fix 60 and 74: the row stayed under C:/sim through the CwdChanged, the pane showed the live folder, SessionEnd put it straight back where the shell is');

  // Pane 4 is a 170px sliver, whose title gives its name at fix 237's
  // sixth level (the zoom and the shade stay); the pane is zoomed for the
  // double-click, which needs the name on screen, and unzoomed after the
  // names step.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p4)}] .pane-zoom').click()`);
  await s.waitFor(`!!document.querySelector('.splitview.zoomed') && getComputedStyle(document.querySelector('[data-pane-id=${JSON.stringify(p4)}] .pane-name')).display !== 'none'`, 'pane 4 zoomed with its name on the title');
  const n = await centerOf(s, `[data-pane-id=${JSON.stringify(p4)}] .pane-name`);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: n.x, y: n.y, button: 'left', clickCount: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: n.x, y: n.y, button: 'left', clickCount: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: n.x, y: n.y, button: 'left', clickCount: 2 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: n.x, y: n.y, button: 'left', clickCount: 2 });
  await s.waitFor(`document.activeElement?.className === 'pane-rename'`, 'rename box in the pane title');
  await s.type('mine');
  await s.key('Enter', 'Enter', 13);
  await waitName(p4, 'mine', 'typed name shown in the title');
  expect((await rowName(target)) === 'mine', 'sidebar row shows the typed name');
  await post({ hook_event_name: 'CwdChanged', cwd: 'C:/sim/other', previous_cwd: 'C:/sim/deeper' });
  await s.waitFor(`(async () => (await window.emerald.request('session.list', {})).sessions.find(x => x.id === ${JSON.stringify(target)})?.cwd === 'C:/sim/other')()`, 'cwd moved again');
  expect((await nameOf(p4)) === 'mine', 'a chosen name stays through the next CwdChanged');
  step('double-click rename in the title sticks');

  await chooseMenu(s, p4, 'Rename session');
  await s.waitFor(`document.activeElement?.className === 'pane-rename'`, 'rename box from the menu');
  await s.key('Backspace', 'Backspace', 8);
  await s.key('Enter', 'Enter', 13);
  await waitName(p4, 'other', 'an empty name follows the folder again');
  const onDisk = await savedRecord(target, (r) => r.autoName === true && r.name === 'other');
  expect(onDisk?.autoName === true && onDisk.name === 'other', 'sessions.json says the name is automatic again');
  await s.screenshot('m9-fixes-names.png');
  step('names: follow the folder, stick when typed, come back when cleared');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p4)}] .pane-zoom').click()`);
  await s.waitFor(`!document.querySelector('.splitview.zoomed')`, 'pane 4 unzoomed');

  // Fix 5, pull a pane off a divider. Pane 2 (a shell at home) is focused
  // and sits on the far side of the root divider; a Ctrl+drag from that
  // divider to 30% into pane 2 makes a new pane between the divider and
  // pane 2, 30% of pane 2's old width, with a shell at home.
  const c2 = await centerOf(s, `[data-pane-id=${JSON.stringify(p2)}] .term-host`);
  await s.click(c2.x, c2.y);
  await s.waitFor(focusedPaneIs(p2), 'pane 2 focused');
  const box = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(p2)}]').getBoundingClientRect(); return { x: r.x, width: r.width }; })()`);
  const g = await s.evalJs(`(() => { const r = document.querySelector('.splitview > .split > .gutter').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const targetX = box.x + box.width * 0.3;
  const drag = (type, x) => s.send('Input.dispatchMouseEvent', { type, x, y: g.y, button: 'left', clickCount: 1, modifiers: CTRL });
  await drag('mousePressed', g.x);
  for (let i = 1; i <= 10; i++) await drag('mouseMoved', g.x + ((targetX - g.x) * i) / 10);
  await drag('mouseReleased', targetX);
  await s.waitFor(`document.querySelectorAll('.pane').length === 5`, 'five panes after the pull');
  await s.waitFor(`document.querySelectorAll('.term-host').length === 5`, 'a shell in the pulled pane');
  await sleep(500);
  layout = await getLayout(s);
  const p5 = layout.focusedPaneId;
  const holder = layout.root.second;
  expect(holder.kind === 'split' && holder.direction === 'row' && holder.first.id === p5 && holder.second.id === p2, 'the new pane sits between the divider and pane 2');
  expect(Math.abs(holder.ratio - 0.3) < 0.03, `the new pane is as wide as the drag, ratio ${holder.ratio.toFixed(3)}`);
  info = await sessionOf(s, p5);
  expect(info?.kind === 'shell' && info.spawnCwd === home, `the pulled pane has a shell in pane 2's folder, got ${info?.spawnCwd}`);
  expect(!document_dragging(await s.evalJs(`document.body.className`)), 'drag state cleared');
  await s.screenshot('m9-fixes-pull.png');
  step('Ctrl+drag on a divider pulled out a new shell pane sized by the drag');

  // Fix 6 and fix 17, text size. Ctrl+wheel over one terminal grows the
  // text in that pane alone and its PTY loses columns; Ctrl+minus and
  // Ctrl+0 act on the focused pane. The pulled pane (5) inherited the size
  // of pane 2, so both are checked. The sizes live in localStorage across
  // runs, so start by resetting.
  const fontOf = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host')?.emeraldTerm?.options.fontSize ?? null`);
  const colsOf = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host')?.emeraldTerm?.cols ?? null`);
  const waitFont = (paneId, px, what) => s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host')?.emeraldTerm?.options.fontSize === ${px}`, what, 5000);
  const sizesStored = async () => JSON.parse((await s.evalJs(`localStorage.getItem('emerald.fontSizes')`)) ?? '{}');
  await s.key('0', 'Digit0', 48, CTRL);
  await waitFont(p5, 14, 'text size at the default');
  expect((await fontOf(p2)) === 14, 'pane 2 at the default');
  await sleep(400);
  const cols0 = await colsOf(p5);
  // Wheel events are dispatched in the page: a synthetic one through the
  // debugger takes seconds to be acknowledged, like a mouse move. What is
  // checked is the pane's own listener; Chromium's Ctrl+wheel path was
  // tried by hand.
  const wheel = (paneId, deltaY) =>
    s.evalJs(
      `document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host .xterm-screen, [data-pane-id=${JSON.stringify(paneId)}] .term-host').dispatchEvent(new WheelEvent('wheel', { deltaY: ${deltaY}, ctrlKey: true, bubbles: true, cancelable: true }))`,
    );
  for (let i = 0; i < 3; i++) await wheel(p5, -100);
  await waitFont(p5, 17, 'three notches of Ctrl+wheel');
  await sleep(500);
  expect((await fontOf(p2)) === 14, 'pane 2 keeps its own size');
  const cols1 = await colsOf(p5);
  expect(cols1 < cols0, `the PTY has fewer columns at the bigger size (${cols0} to ${cols1})`);
  expect((await sizesStored())[p5] === 17, 'the size is remembered by pane');
  await wheel(p2, 100);
  await waitFont(p2, 13, 'Ctrl+wheel down on pane 2 shrinks pane 2');
  expect((await fontOf(p5)) === 17, 'pane 5 unmoved by it');
  await s.key('-', 'Minus', 189, CTRL);
  await waitFont(p5, 16, 'Ctrl+minus on the focused pane');
  expect((await fontOf(p2)) === 13, 'pane 2 unmoved by it');
  await s.screenshot('m9-fixes-zoom.png');
  // M9 fix 390: Reset text size on the pane menu does what Ctrl+0 did,
  // always shown, disabled at the default with a title saying so.
  const menuItemState = async (paneId, label) => {
    const c = await centerOf(s, `[data-pane-id=${JSON.stringify(paneId)}]`);
    await s.rightClick(c.x, c.y);
    await s.waitFor(`document.querySelector('.pane-menu')?.dataset.paneId === ${JSON.stringify(paneId)}`, `menu on pane ${paneId.slice(0, 8)}`);
    const state = await s.evalJs(
      `(() => { const b = [...document.querySelectorAll('.pane-menu .menu-item')].find(x => x.querySelector('.menu-label').textContent === ${JSON.stringify(label)}); return b === undefined ? null : { disabled: b.disabled, title: b.title }; })()`,
    );
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.pane-menu')`, 'menu closed');
    return state;
  };
  const beforeReset = await menuItemState(p5, 'Reset text size');
  expect(beforeReset !== null && beforeReset.disabled === false, `Reset text size is enabled off the default, got ${JSON.stringify(beforeReset)}`);
  await chooseMenu(s, p5, 'Reset text size');
  await waitFont(p5, 14, 'the pane menu resets the focused pane');
  await sleep(500);
  expect((await colsOf(p5)) === cols0, 'columns back to what they were');
  expect((await sizesStored())[p5] === undefined, 'a pane at the default has no entry');
  const afterReset = await menuItemState(p5, 'Reset text size');
  expect(afterReset !== null && afterReset.disabled === true && afterReset.title === 'Already at 14 px', `Reset text size disables itself at the default, got ${JSON.stringify(afterReset)}`);
  // A split takes its size from the pane it came from.
  await wheel(p2, -100);
  await waitFont(p2, 14, 'pane 2 back at the default');
  await wheel(p2, -100);
  await waitFont(p2, 15, 'pane 2 at 15');
  await splitWithShell(s, `[data-pane-id=${JSON.stringify(p2)}] .pane-split-right`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 6`, 'six panes after the split');
  layout = await getLayout(s);
  const p6 = layout.focusedPaneId;
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p6)}] .term-host')?.emeraldTerm !== undefined`, 'a shell in the split pane', 10_000);
  await waitFont(p6, 15, 'the split pane inherits 15');
  const s6 = (await sessionOf(s, p6)).id;
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p6)}] .pane-close').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 5`, 'five panes after the close');
  await s.waitFor(`JSON.parse(localStorage.getItem('emerald.fontSizes') ?? '{}')[${JSON.stringify(p6)}] === undefined`, 'the closed pane leaves storage');
  // The next section counts rows, so wait for the killed shell's to go.
  await s.waitFor(`!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s6)}]')`, 'the split pane shell left the sidebar', 5000);
  expect((await sizesStored())[p2] === 15, 'pane 2 still remembered');
  await wheel(p2, 100);
  await waitFont(p2, 14, 'pane 2 back at the default');
  step('text size: Ctrl+wheel changes one pane, Ctrl+minus and the pane menu the focused pane, a split inherits, a close forgets');

  // Fix 7, close kills and hide keeps. The × on pane 5 kills its shell and
  // the row leaves on its own once the exit lands (node-pty reports it
  // about a second late); the − on pane 3 takes the pane away and leaves
  // the shell listed and alive, so a click on its row puts it back in the
  // focused pane and it still answers input.
  const rows = () => s.evalJs(`document.querySelectorAll('.sidebar-row').length`);
  const listed = async (id) => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id) ?? null;
  const s5 = (await sessionOf(s, p5)).id;
  expect((await rows()) === 7, 'seven sessions listed before the close');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p5)}] .pane-close').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'four panes after the close');
  const closedAt = Date.now();
  await s.waitFor(`!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s5)}]')`, 'the closed shell left the sidebar', 5000);
  const removeMs = Date.now() - closedAt;
  expect(removeMs < 3000, `row gone within 3 s, took ${removeMs} ms`);
  expect((await listed(s5)) === null, 'and the daemon forgot it');
  expect((await rows()) === 6, 'six rows');
  step(`close (×) on a shell: pane gone, shell killed and dropped ${removeMs} ms later`);

  const s3 = (await sessionOf(s, p3)).id;
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p3)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'three panes after the hide');
  await sleep(300);
  expect((await rows()) === 6, 'hide keeps the row');
  expect((await listed(s3))?.state === 'idle', 'the hidden shell is still alive');
  layout = await getLayout(s);
  expect(leaves(layout).every((p) => p.sessionId !== s3), 'and off screen');
  // The focused pane holds a live shell, so the click asks first (M9 fix
  // 91, its own steps at the end); Show here is the old replace.
  await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s3)}]').click()`);
  await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(s3)}`, 'the chooser under the hidden shell row');
  await s.evalJs(`[...document.querySelectorAll('.show-chooser .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Show here').click()`);
  await s.waitFor(`(async () => { const l = (await window.emerald.request('layout.get', {})).layout; return JSON.stringify(l).includes(${JSON.stringify(s3)}); })()`, 'the hidden shell is back in a pane');
  layout = await getLayout(s);
  const shownIn = leaves(layout).find((p) => p.sessionId === s3).id;
  expect(layout.focusedPaneId === shownIn, 'in the focused pane');
  await sleep(500);
  // The typed text is echoed, so the check is on the command's output.
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(s3)}, data: 'echo (1234*2)' + String.fromCharCode(13) })`);
  let answered = false;
  for (let i = 0; i < 40 && !answered; i++) {
    await sleep(250);
    answered = Buffer.from((await zreq(s, 'session.read', { sessionId: s3 })).data, 'base64').toString().includes('2468');
  }
  expect(answered, 'the shell shown again answered input');
  step('hide (−) on a shell: pane gone, shell kept, shown again from the sidebar and answering');

  // Close on a pane whose session already exited removes the session. A
  // claude --version exits on its own, so this needs no Claude turn and
  // also covers the Claude launcher; the live Claude branch (killed, kept
  // under exited) is a one-line decision covered by the daemon's unit test.
  const { session: versioned } = await zreq(s, 'session.spawn', { kind: 'claude', cwd: repoRoot, args: ['--version'], cols: 80, rows: 24 });
  await s.waitFor(`(async () => (await window.emerald.request('session.list', {})).sessions.find(x => x.id === ${JSON.stringify(versioned.id)})?.state === 'exited')()`, 'claude --version exited', 15000);
  const withSession = (node, paneId, sessionId) =>
    node.kind === 'pane' ? (node.id === paneId ? { ...node, sessionId } : node) : { ...node, first: withSession(node.first, paneId, sessionId), second: withSession(node.second, paneId, sessionId) };
  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, shownIn, versioned.id) } });
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(shownIn)}] .pane-state')?.dataset.state === 'exited'`, 'the exited session is on screen');
  expect((await rows()) === 7, 'seven rows with the exited one');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(shownIn)}] .pane-close').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes after closing the exited one');
  await s.waitFor(`!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(versioned.id)}]')`, 'the exited session left the sidebar');
  expect((await listed(versioned.id)) === null, 'and the daemon forgot it');
  expect((await listed(s3))?.state === 'idle', 'the hidden-then-shown shell is untouched');
  await s.screenshot('m9-fixes-close.png');
  step('close (×) on an exited session removes it');

  // Fix 8, the sidebar. A shell in the repo shows the repo's branch, read
  // the same way the daemon reads it; the simulated session in C:/sim/other
  // is outside any repository and shows none. A posted UserPromptSubmit
  // then Stop fill the prompt line and the agent line, first lines only.
  // The row of the session in the focused pane is marked.
  const headOf = (dir) => {
    // In a worktree .git is a file naming the real git dir, as readBranch knows.
    let gitDir = path.join(dir, '.git');
    if (fs.statSync(gitDir).isFile()) gitDir = /^gitdir: (.+)$/m.exec(fs.readFileSync(gitDir, 'utf8'))[1].trim();
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const m = /^ref: refs\/heads\/(.+)$/.exec(head);
    return m === null ? head.slice(0, 7) : m[1];
  };
  const s1 = (await sessionOf(s, p1)).id;
  const rowText = (id, cls) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}] ${cls}')?.textContent ?? null`);
  expect((await rowText(s1, '.sidebar-row-branch')) === headOf(repoRoot), `the repo shell's row shows branch ${headOf(repoRoot)}`);
  expect((await rowText(target, '.sidebar-row-branch')) === null, 'a session outside a repository shows no branch');
  // M46: the mark says the kind, a shell prompt for a plain shell and the
  // asterisk for one running Claude; the kind word is gone from the sub line.
  const markKinds = (id) => s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}] .sidebar-row-main'); return { first: r.firstElementChild.className.split(' ')[0], claude: !!r.querySelector('.session-mark'), shell: !!r.querySelector('.shell-mark'), kind: r.parentElement.querySelector('.sidebar-row-kind')?.textContent ?? null }; })()`);
  const plainMark = await markKinds(s1);
  expect(plainMark.first === 'shell-mark' && plainMark.shell && !plainMark.claude && plainMark.kind === null, `a plain shell's row starts with the shell mark and has no kind word, got ${JSON.stringify(plainMark)}`);
  const boundMark = await markKinds(target);
  expect(boundMark.first === 'session-mark' && boundMark.claude && !boundMark.shell, `a shell running Claude starts with the asterisk, got ${JSON.stringify(boundMark)}`);
  expect((await s.evalJs(`document.querySelectorAll('.sidebar-group-name').length`)) >= 2, 'group headings carry the folder name');
  expect((await rowText(target, '.sidebar-row-line')) === null, 'no turn lines before any turn');
  await post({ hook_event_name: 'UserPromptSubmit', prompt: '  commit this\nand push it' });
  // M33: while the turn runs the agent line shows the terminal title (the
  // shell's own, its exe path, since this is a PowerShell made working by
  // posted hooks), and the reply takes the line when the turn ends; the
  // prompt sits on its own line above from the start (M40).
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'the row is working');
  await s.waitFor(`!!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-activity')`, 'the title on the agent line while working');
  expect((await rowText(target, '.sidebar-row-prompt')) === 'commit this', 'the prompt line shows the first line of the prompt');
  const workingTurn = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(workingTurn.lastPrompt === 'commit this' && workingTurn.lastReply === null, 'the daemon has the prompt and no reply yet');
  await post({ hook_event_name: 'Stop', last_assistant_message: '\nCommitted as 97af82b on main.\nTwelve files.' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-agent')?.textContent === 'Committed as 97af82b on main.'`, 'the reply on the agent line');
  expect((await rowText(target, '.sidebar-row-prompt')) === 'commit this', 'the prompt line stays');
  const onDiskTurn = await savedRecord(target, (r) => r.lastReply !== null);
  expect(onDiskTurn?.lastPrompt === 'commit this' && onDiskTurn.lastReply === 'Committed as 97af82b on main.', 'the last turn is in sessions.json');
  layout = await getLayout(s);
  const focusedSession = leaves(layout).find((p) => p.id === layout.focusedPaneId).sessionId;
  expect((await s.evalJs(`document.querySelector('.sidebar-row[data-shown=focused]')?.dataset.sessionId ?? null`)) === focusedSession, 'the focused pane session is marked in the list');
  expect((await s.evalJs(`document.querySelectorAll('.sidebar-row[data-shown]').length`)) === 2, 'the two sessions on screen are marked');
  await s.screenshot('m9-fixes-sidebar.png');
  step('sidebar: the mark before the name and the branch under it, the prompt and the reply on their own lines, shown sessions marked');

  // M47: while a turn runs the agent line follows the transcript. The
  // hooks name a transcript file (an empty one under the private home),
  // the daemon tails it once the prompt lands, and each assistant text
  // line appended takes the row's third line as it arrives; a tool call
  // changes nothing, and the Stop's reply keeps the line while the live
  // text is cleared. The level-1 override only changes the level the
  // daemon reports, so the fields still travel.
  const transcript = path.join(process.env['EMERALD_HOME'], 'm47-transcript.jsonl');
  fs.writeFileSync(transcript, '');
  const assistantLine = (text) => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text }] } }) + '\n';
  const toolUseLine = () => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } }) + '\n';
  const agentLineOf = (id) => s.evalJs(`(() => { const l = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}] .sidebar-row-turn'); return l === null ? null : { text: l.querySelector('.sidebar-row-agent')?.textContent ?? null, activity: l.classList.contains('sidebar-row-activity'), title: l.title }; })()`);
  // M73 task 1: the tooltip the turn line carried is its card now; a hover
  // past the delay opens it, and its Terminal title line is what the
  // tooltip said while the turn ran. Read, then the mouse moves off and
  // the card closes.
  const turnCardTitle = async (id) => {
    const sel = `.sidebar-row[data-session-id=${JSON.stringify(id)}] .sidebar-row-turn`;
    const c = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 }; })()`);
    expect(c !== null, `a turn line to hover on ${id}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
    const cardSel = `.turn-popover[data-session-id=${JSON.stringify(id)}]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(cardSel)})`, 'the turn card opens off the turn line', 3000);
    const title = await s.evalJs(`document.querySelector(${JSON.stringify(cardSel + ' [data-part="title"] .turn-card-text')})?.textContent ?? null`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'the turn card closes');
    return title;
  };
  // The same folder the row is already in, so nothing moves or renames.
  await post({ hook_event_name: 'SessionStart', source: 'startup', cwd: 'C:/sim/deeper', transcript_path: transcript });
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'read the log', transcript_path: transcript });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'the row is working again');
  expect((await rowText(target, '.sidebar-row-prompt')) === 'read the log', 'the new prompt is on the prompt line');
  const beforeText = await agentLineOf(target);
  expect(beforeText !== null && beforeText.activity && beforeText.text !== '', `with no text yet the agent line shows the title, got ${JSON.stringify(beforeText)}`);
  fs.appendFileSync(transcript, assistantLine('Reading the log'));
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-agent')?.textContent === 'Reading the log'`, 'the first assistant line on the agent line', 5000);
  const liveLine = await agentLineOf(target);
  expect(!liveLine.activity && liveLine.title === '', `the live text is not the title, and the line carries no tooltip (M73), got ${JSON.stringify(liveLine)}`);
  expect((await turnCardTitle(target)) !== null, 'the turn card keeps the terminal title while the turn runs');
  await sleep(200);
  fs.appendFileSync(transcript, assistantLine('  Found the hash\nin two commits'));
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-agent')?.textContent === 'Found the hash'`, 'the second assistant line replaces it, first line only', 5000);
  fs.appendFileSync(transcript, toolUseLine());
  await sleep(1200);
  expect((await rowText(target, '.sidebar-row-agent')) === 'Found the hash', 'a tool call line changes nothing');
  const liveOnDaemon = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(liveOnDaemon.liveReply === 'Found the hash' && liveOnDaemon.lastReply === null && liveOnDaemon.transcriptPath === transcript, `the daemon carries the live text, the path and no reply yet, got ${JSON.stringify([liveOnDaemon.liveReply, liveOnDaemon.lastReply, liveOnDaemon.transcriptPath])}`);
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Found the hash' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'done'`, 'the turn ended');
  expect((await rowText(target, '.sidebar-row-agent')) === 'Found the hash', 'the reply keeps the line');
  const stoppedOnDaemon = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(stoppedOnDaemon.liveReply === null && stoppedOnDaemon.lastReply === 'Found the hash', `the live text is cleared by the Stop and the reply stays, got ${JSON.stringify([stoppedOnDaemon.liveReply, stoppedOnDaemon.lastReply])}`);
  fs.appendFileSync(transcript, assistantLine('Too late'));
  await sleep(1200);
  expect((await rowText(target, '.sidebar-row-agent')) === 'Found the hash', 'a line after the Stop is not read');
  step('M47: the agent line follows the transcript while the turn runs, the Stop takes over');

  // M9 fix 79: while a turn runs and no text has landed since, the agent
  // line reads the tool call Claude is making, off the PreToolUse hook's
  // tool_input: the Bash description as it is, a phrase per tool for the
  // rest. Latest wins between the call and the transcript's text, and the
  // Stop's reply takes over as before. The transcript file is the M47
  // one, still bound to the row.
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'read the backlog', transcript_path: transcript });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'the row is working for the tool step');
  await post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat docs/BACKLOG.md', description: 'Reading the backlog file' }, transcript_path: transcript });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-agent')?.textContent === 'Reading the backlog file'`, 'the Bash description on the agent line');
  const toolLine = await agentLineOf(target);
  expect(!toolLine.activity, `the tool line is not the title, got ${JSON.stringify(toolLine)}`);
  await post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'cat docs/BACKLOG.md', description: 'Reading the backlog file' }, tool_response: { stdout: '' }, transcript_path: transcript });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\sim\\deeper\\docs\\BACKLOG.md' }, transcript_path: transcript });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-agent')?.textContent === 'Reading BACKLOG.md'`, 'the Read call as a phrase naming the file');
  const toolOnDaemon = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(toolOnDaemon.liveTool === 'Reading BACKLOG.md' && toolOnDaemon.liveReply === null, `the daemon carries the tool line and no live text, got ${JSON.stringify([toolOnDaemon.liveTool, toolOnDaemon.liveReply])}`);
  fs.appendFileSync(transcript, assistantLine('The backlog has ten entries'));
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-agent')?.textContent === 'The backlog has ten entries'`, 'the next assistant text replaces the tool line', 5000);
  const textOnDaemon = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(textOnDaemon.liveTool === null && textOnDaemon.liveReply === 'The backlog has ten entries', `the text nulls the tool line on the daemon, got ${JSON.stringify([textOnDaemon.liveTool, textOnDaemon.liveReply])}`);
  await post({ hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'liveTool', path: 'packages' }, transcript_path: transcript });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-agent')?.textContent === 'Searching for liveTool'`, 'a later call takes the line back from the text');
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Ten entries, four set aside' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'done'`, 'the tool turn ended');
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-agent')?.textContent === 'Ten entries, four set aside'`, 'the reply takes the line from the tool call');
  const toolStopped = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(toolStopped.liveTool === null && toolStopped.liveReply === null, `the Stop clears the tool line, got ${JSON.stringify([toolStopped.liveTool, toolStopped.liveReply])}`);
  step('M9 fix 79: the agent line reads the tool call as a verb phrase until text lands, and the Stop takes over');

  // Fix 25, a shown row lights on hover. The pointer is not real here, so
  // :hover is forced through the CSS domain on the row shown in the pane
  // that is not focused, and its ground must move off the shown ground.
  // The row is mid attention pulse from the Stop above, which animates its
  // ground, so the animation is held off inline for the two reads.
  const shownRowSel = '.sidebar-row[data-shown]:not([data-shown=focused])';
  await s.evalJs(`document.querySelector(${JSON.stringify(shownRowSel)}).style.animation = 'none'`);
  const shownGround = await s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(shownRowSel)})).backgroundColor`);
  await s.send('DOM.enable');
  await s.send('CSS.enable');
  const doc = await s.send('DOM.getDocument', { depth: 0 });
  const shownNode = await s.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: shownRowSel });
  await s.send('CSS.forcePseudoState', { nodeId: shownNode.nodeId, forcedPseudoClasses: ['hover'] });
  const hoverGround = await s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(shownRowSel)})).backgroundColor`);
  await s.send('CSS.forcePseudoState', { nodeId: shownNode.nodeId, forcedPseudoClasses: [] });
  await s.evalJs(`document.querySelector(${JSON.stringify(shownRowSel)}).style.animation = ''`);
  expect(shownGround === 'rgb(38, 38, 38)', `a shown row sits on the shown ground, got ${shownGround}`);
  expect(hoverGround === 'rgb(42, 45, 46)', `a shown row under the pointer takes the selected ground, got ${hoverGround}`);
  step('fix 25: a row shown in a pane lights on hover');

  // Fix 18, the tab strip over the panes. The strip starts where the
  // sidebar ends, not at the window's edge, and the sidebar runs the full
  // height of the body; with the sidebar collapsed the strip starts where
  // the rail ends. A pixel of tolerance covers the borders.
  const edges = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`);
  const near = (a, b) => Math.abs(a - b) <= 1;
  let strip = await edges('.tab-strip');
  let body = await edges('.app-body');
  let side = await edges('.sidebar');
  expect(near(strip.left, side.right), `the strip starts at the sidebar's right edge (${strip.left} vs ${side.right})`);
  expect(strip.left > body.left + 100, 'so it is not at the window edge');
  expect(near(side.top, body.top) && near(strip.top, body.top), 'the sidebar and the strip both start at the top of the body');
  expect(near(side.bottom, body.bottom), 'the sidebar runs the full height');
  expect(near((await edges('.files-rail')).top, body.top), 'so does the files rail');
  await s.key('B', 'KeyB', 66, CTRL | SHIFT);
  await s.waitFor(`!!document.querySelector('.sidebar-rail')`, 'the sidebar collapsed to its rail');
  strip = await edges('.tab-strip');
  const rail = await edges('.sidebar-rail');
  expect(near(strip.left, rail.right), `collapsed: the strip starts at the rail's right edge (${strip.left} vs ${rail.right})`);
  expect(near(rail.top, body.top) && near(rail.bottom, body.bottom), 'the rail runs the full height');
  await s.key('B', 'KeyB', 66, CTRL | SHIFT);
  await s.waitFor(`!!document.querySelector('.sidebar')`, 'the sidebar is back');
  await s.screenshot('m9-fixes-strip.png');
  step('the tab strip starts at the sidebar (or rail) edge and the sidebar runs the full height');

  // Fix 9, the empty state. Hide pane 4, then × on the last pane: the shell
  // is killed and the pane stays, empty. With every other session ended the
  // empty pane says "No sessions", the sidebar says "No sessions yet", and
  // its New shell button starts over.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p4)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'one pane left');
  expect(!(await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-close').disabled`)), 'the last pane can be closed');
  expect((await s.evalJs(`document.querySelector('.empty-state')`)) === null, 'no empty state while a session is shown');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-close').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1 && !!document.querySelector('.empty-pane .empty-start')`, 'the last pane emptied');
  await s.waitFor(`!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s1)}]')`, 'its shell left the list');
  expect((await s.evalJs(`document.querySelectorAll('.term-host').length`)) === 0, 'no terminal on screen');
  expect((await s.evalJs(`document.querySelector('.empty-state')`)) === null, 'sessions still run hidden, so no empty state yet');
  // End the rest: live ones killed and dropped, exited ones removed.
  for (const x of (await zreq(s, 'session.list', {})).sessions) {
    await zreq(s, x.state === 'exited' ? 'session.remove' : 'session.kill', x.state === 'exited' ? { sessionId: x.id } : { sessionId: x.id, remove: true });
  }
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 0`, 'every session gone', 8000);
  await s.waitFor(`document.querySelector('.empty-title')?.textContent === 'No sessions'`, 'the empty state');
  expect((await s.evalJs(`document.querySelector('.sidebar-empty')?.textContent`)) === 'No sessions yet', 'the sidebar agrees');
  const lastUsed = await s.evalJs(`(() => {
    const r = document.querySelector('.empty-pane .empty-folder');
    const box = document.querySelector('.empty-pane .palette-input');
    return { folder: r?.dataset.folder ?? null, note: r?.querySelector('.empty-folder-note')?.textContent ?? null, recent: JSON.parse(localStorage.getItem('emerald.recentFolders') ?? '[]')[0] ?? null, state: !!document.querySelector('.empty-state'), box: !!box, focused: box !== null && document.activeElement === box };
  })()`);
  expect(lastUsed.note === 'last used' && lastUsed.folder !== null && lastUsed.folder === lastUsed.recent && lastUsed.state && lastUsed.box && lastUsed.focused, `row 1 is the last folder used, the No sessions block is up and the box has the focus, got ${JSON.stringify(lastUsed)}`);
  step('M9 fix 547: the last pane with nothing running offers the last folder used, the No sessions block and a focused box');
  await s.screenshot('m9-fixes-empty.png');
  await startFromEmpty(s, '', { kind: 'shell' });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'a shell from the empty state');
  expect((await s.evalJs(`document.querySelector('.empty-state')`)) === null, 'the empty state went with it');
  step('empty state: the last pane empties on close, No sessions once everything is gone, a shell starts from it');

  // Fix 11, an older daemon. The private daemon has reported level 1 all
  // along, so the banner names its pid; Restart kills it, the app starts
  // another, the shell comes back as exited and resumes, and the banner
  // returns for the new pid because the override is still in the app's
  // environment (a real upgrade would start the shipped daemon and the
  // banner would go).
  const oldPid = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8')).pid;
  const bannerText = () => s.evalJs(`document.querySelector('.daemon-banner-text')?.textContent ?? null`);
  expect((await bannerText())?.includes(`pid ${oldPid}`) && (await bannerText()).includes('level 1'), `the banner names the daemon and its level, got ${await bannerText()}`);
  expect((await s.evalJs(`document.querySelector('.daemon-banner')?.dataset.daemonPid`)) === String(oldPid), 'banner for the current daemon');
  layout = await getLayout(s);
  const lastShell = leaves(layout)[0].sessionId;
  const lastPane = layout.focusedPaneId;
  // Fix 159: a marker on the shell's screen before the restart. Restart
  // asks the daemon to stop, so it keeps every live session's frame; the
  // new daemon replays the frame into the pane, dimmed under data-kept,
  // with Resume on the title, and the resume below clears it.
  const termText = (paneId) =>
    s.evalJs(
      `(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host')?.emeraldTerm; if (!t) return ''; const b = t.buffer.active; const lines = []; for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? ''); return lines.join('\\n'); })()`,
    );
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(lastShell)}, data: 'Write-Host kept-marker-159' + String.fromCharCode(13) })`);
  await s.waitFor(`(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(lastPane)}] .term-host')?.emeraldTerm; if (!t) return false; const b = t.buffer.active; for (let i = 0; i < b.length; i++) if ((b.getLine(i)?.translateToString(true) ?? '').includes('kept-marker-159') && !(b.getLine(i)?.translateToString(true) ?? '').includes('Write-Host')) return true; return false; })()`, 'the marker printed on the shell', 8000);
  const isKept = () => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(lastPane)}] .term-wrap')?.dataset.kept === ''`);
  expect((await isKept()) === false, 'a live pane is not marked kept');
  await s.evalJs(`document.querySelector('.daemon-restart').click()`);
  await s.waitFor(`!!document.querySelector('.banner')`, 'disconnected while the daemon restarts');
  await s.waitFor(`!document.querySelector('.banner')`, 'connected again', 15000);
  await s.waitFor(`document.querySelector('.daemon-banner')?.dataset.daemonPid !== ${JSON.stringify(String(oldPid))} && !!document.querySelector('.daemon-banner')`, 'the banner is for the new daemon');
  const newPid = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8')).pid;
  expect(newPid !== oldPid, `a new daemon, pid ${oldPid} to ${newPid}`);
  // The old one is gone within a moment of the stop (M9 fix 164): a
  // daemon that released the pipe must not stay alive holding nothing.
  const goneBy = Date.now() + 5000;
  const oldAlive = () => { try { process.kill(oldPid, 0); return true; } catch { return false; } };
  while (Date.now() < goneBy && oldAlive()) await sleep(200);
  expect(!oldAlive(), `the old daemon ${oldPid} exited after the stop`);
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(lastShell)}]')?.dataset.state === 'exited'`, 'the shell is listed as exited');
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(lastPane)}] .term-wrap')?.dataset.kept === ''`, 'the pane is marked kept once the new daemon answers', 8000);
  const keptText = await termText(lastPane);
  expect(keptText.includes('kept-marker-159'), `the kept frame holds the marker, got ${JSON.stringify(keptText.trim().slice(-200))}`);
  expect(!keptText.includes('scrollback lost'), 'no lost-scrollback note when the frame was kept');
  const keptStored = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'sessions.json'), 'utf8')).sessions.find((x) => x.id === lastShell)?.lastScreen ?? null;
  expect(keptStored !== null && keptStored.rows.some((r) => r.includes('kept-marker-159')), 'sessions.json holds the frame beside the record');
  const keptOpacity = await s.evalJs(`getComputedStyle(document.querySelector('[data-pane-id=${JSON.stringify(lastPane)}] .term-host')).opacity`);
  expect(Number(keptOpacity) < 1, `the kept frame is dimmed, opacity ${keptOpacity}`);
  const keptScreen = await zreq(s, 'pty.screen', { sessionId: lastShell });
  expect(keptScreen.kept === true && keptScreen.rows.some((r) => r.includes('kept-marker-159')), 'pty.screen answers the kept frame, marked kept');
  step(`M9 fix 159: Restart kept the shell's frame through the daemon restart, the pane shows it dimmed (opacity ${keptOpacity}) under data-kept with the marker and no lost note, sessions.json and pty.screen hold it`);
  // Fix 136: the exited row carries a Resume button of its own, with the
  // pane title's still there; the row's is the one clicked here, and no
  // row in any other state has one.
  expect((await s.evalJs(`!!document.querySelector('[data-pane-id=${JSON.stringify(layout.focusedPaneId)}] .pane-resume')`)) === true, 'the pane title offers Resume');
  const rowResume = `document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(lastShell)}] .sidebar-row-resume[data-action="resume"]')`;
  const rowResumeTitle = await s.evalJs(`${rowResume}?.title ?? null`);
  expect(rowResumeTitle !== null && rowResumeTitle.startsWith('Start ') && rowResumeTitle.includes(' again in '), `the exited row's Resume button says where it goes, got ${rowResumeTitle}`);
  expect((await s.evalJs(`document.querySelectorAll('.sidebar-row:not([data-state="exited"]) .sidebar-row-resume').length`)) === 0, 'no Resume button on a row that is not exited');
  await s.evalJs(`${rowResume}.click()`);
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(lastShell)}]')?.dataset.state === 'idle'`, 'and resumes under the new daemon');
  expect((await s.evalJs(`!!${rowResume}`)) === false, 'the button leaves with the exited state');
  // Fix 159: the resume starts the terminal over on the new PTY.
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(lastPane)}] .term-wrap')?.dataset.kept === undefined`, 'the kept mark leaves with the resume');
  await s.waitFor(`(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(lastPane)}] .term-host')?.emeraldTerm; if (!t) return false; const b = t.buffer.active; for (let i = 0; i < b.length; i++) if ((b.getLine(i)?.translateToString(true) ?? '').includes('kept-marker-159')) return false; return b.length > 0; })()`, 'the marker is gone from the resumed terminal', 8000);
  expect((await zreq(s, 'pty.screen', { sessionId: lastShell })).kept === undefined, 'pty.screen is the live PTY again');
  await s.evalJs(`document.querySelector('.daemon-dismiss').click()`);
  await s.waitFor(`!document.querySelector('.daemon-banner')`, 'Not now hides the banner');
  await s.screenshot('m9-fixes-daemon.png');
  step(`older daemon: banner named pid ${oldPid}, Restart brought up pid ${newPid}, the shell came back exited and resumed from its row's Resume button`);

  // Fixes 13 and 14. The resumed shell sits at home; a cd typed into it is
  // reported by its prompt, and the row moves to the repo's group with the
  // repo's name and branch. Groups are keyed by the live folder.
  const groupOf = (id) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]')?.closest('.sidebar-group')?.dataset.group ?? null`);
  expect((await groupOf(lastShell))?.toLowerCase() === home.toLowerCase(), `listed under home before the cd, got ${await groupOf(lastShell)}`);
  await sleep(500);
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(lastShell)}, data: 'cd ' + ${JSON.stringify(`'${repoRoot}'`)} + String.fromCharCode(13) })`);
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(lastShell)}]')?.closest('.sidebar-group')?.dataset.group?.toLowerCase() === ${JSON.stringify(repoRoot.toLowerCase())}`, 'the row moved to the repo group', 10000);
  const movedTo = (await listed(lastShell));
  expect(movedTo.cwd.toLowerCase() === repoRoot.toLowerCase() && movedTo.spawnCwd === home, `the daemon has the new cwd and the old spawnCwd, got ${movedTo.cwd}`);
  expect((await rowText(lastShell, '.sidebar-row-name')) === path.basename(repoRoot), 'named after the new folder');
  expect((await rowText(lastShell, '.sidebar-row-branch')) === headOf(repoRoot), 'and showing its branch');
  expect((await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(layout.focusedPaneId)}] .pane-name')?.textContent`)) === path.basename(repoRoot), 'the pane title followed');
  await s.screenshot('m9-fixes-cwd.png');
  step('a shell that cd\'s is regrouped, renamed and shows its branch');

  // Fixes 15 and 16. A shell spawned over the pipe is listed but not on
  // screen, like one whose pane was hidden. Its row dragged onto the right
  // band of the only pane previews that half and, on release, splits the
  // pane with the shell on the right and focused. Then a release over the
  // sidebar and an Escape over a pane each leave the layout alone.
  const { session: dropped } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 });
  const rowSel = `.sidebar-row[data-session-id=${JSON.stringify(dropped.id)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel)})`, 'the new shell is listed');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)}).dataset.shown ?? null`)) === null, 'and not on screen');
  layout = await getLayout(s);
  const dropPane = layout.focusedPaneId;
  const boxOf = (paneId) =>
    s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  let paneBox = await boxOf(dropPane);
  const rightBand = { x: paneBox.x + paneBox.width * 0.9, y: paneBox.y + paneBox.height / 2 };
  const middle = { x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height / 2 };
  const move = (p) => s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
  const zoneOn = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .drop-overlay')?.dataset.dropZone ?? null`);
  const dragOn = () => s.evalJs(`document.body.classList.contains('dragging-session')`);
  let row = await centerOf(s, rowSel);
  await s.mouse('mousePressed', row.x, row.y);
  expect(!(await dragOn()), 'a press alone is not a drag');
  await move({ x: row.x + 10, y: row.y });
  await move(rightBand);
  expect(await dragOn(), 'the drag is on once the mouse has moved');
  const ghost = await s.evalJs(`document.querySelector('.drag-ghost')?.textContent ?? null`);
  expect(ghost === (await rowText(dropped.id, '.sidebar-row-name')), `the ghost names the session, got ${ghost}`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)}).dataset.dragging`)) !== undefined, 'the row is marked as dragging');
  expect((await zoneOn(dropPane)) === 'right', `the right half is previewed, got ${await zoneOn(dropPane)}`);
  await move(middle);
  expect((await zoneOn(dropPane)) === 'center', `the middle previews the whole pane, got ${await zoneOn(dropPane)}`);
  await move(rightBand);
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(dropPane)}] .drop-overlay')?.dataset.dropZone === 'right'`, 'back to the right half');
  await s.screenshot('m9-fixes-drop-preview.png');
  await s.mouse('mouseReleased', rightBand.x, rightBand.y);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2 && document.querySelectorAll('.term-host').length === 2`, 'two panes with terminals after the drop');
  layout = await getLayout(s);
  const root = layout.root;
  expect(root.kind === 'split' && root.direction === 'row' && root.first.id === dropPane && root.second.sessionId === dropped.id, 'a row split: the old pane left, the dropped shell right');
  expect(layout.focusedPaneId === root.second.id, 'the new pane is focused');
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.shown === 'focused'`, 'the row says focused');
  expect(!(await s.evalJs(`!!document.querySelector('.drop-overlay')`)) && !(await dragOn()) && !(await s.evalJs(`!!document.querySelector('.drag-ghost')`)), 'the preview, the ghost and the drag state are gone');
  await s.screenshot('m9-fixes-drop.png');
  step('a row dragged onto the right band of a pane: the half lit up, the drop split the pane with the shell on the right');

  // Cancel paths. The shell is on screen now, so a drop elsewhere would
  // move it; neither of these gets that far.
  const afterDrop = layout.revision;
  const header = await centerOf(s, '.sidebar-header');
  row = await centerOf(s, rowSel);
  await s.mouse('mousePressed', row.x, row.y);
  await move({ x: row.x + 10, y: row.y });
  await move(header);
  expect((await dragOn()) && !(await s.evalJs(`!!document.querySelector('.drop-overlay')`)), 'dragging over the sidebar previews nothing');
  await s.mouse('mouseReleased', header.x, header.y);
  await sleep(300);
  expect(!(await dragOn()) && (await getLayout(s)).revision === afterDrop, 'a release off the panes changes nothing');
  paneBox = await boxOf(dropPane);
  const leftMiddle = { x: paneBox.x + paneBox.width / 2, y: paneBox.y + paneBox.height / 2 };
  await s.mouse('mousePressed', row.x, row.y);
  await move({ x: row.x + 10, y: row.y });
  await move(leftMiddle);
  expect((await zoneOn(dropPane)) === 'center', 'over the other pane the preview is up');
  await s.key('Escape', 'Escape', 27);
  expect(!(await dragOn()) && !(await s.evalJs(`!!document.querySelector('.drop-overlay')`)), 'Escape ends the drag');
  await s.mouse('mouseReleased', leftMiddle.x, leftMiddle.y);
  await sleep(300);
  layout = await getLayout(s);
  expect(layout.revision === afterDrop && leaves(layout).length === 2, 'a release after Escape changes nothing');
  step('a release over the sidebar and an Escape mid-drag both leave the layout alone');

  // M34. What a shell inherits: the pane's TERM and COLORTERM, and not the
  // NO_COLOR the harness put on the daemon. Spawned over the pipe at 120
  // columns and never shown, so the echoed line and the answer each fit
  // one screen row.
  const { session: envShell } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 });
  await sleep(1500);
  const envLine = 'echo "T=${env:TERM} C=${env:COLORTERM} N=[${env:NO_COLOR}]"' + String.fromCharCode(13);
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(envShell.id)}, data: ${JSON.stringify(envLine)} })`);
  let envRow = null;
  for (let i = 0; i < 40 && envRow === null; i++) {
    await sleep(250);
    // The typed line is echoed with the variable names; the answer is the
    // row that has the values.
    envRow = (await zreq(s, 'pty.screen', { sessionId: envShell.id })).rows.find((r) => r.startsWith('T=') && !r.includes('$env')) ?? null;
  }
  expect(envRow === 'T=xterm-256color C=truecolor N=[]', `the shell has the pane's TERM and COLORTERM and no NO_COLOR, got ${JSON.stringify(envRow)}`);
  step('a shell inherits TERM xterm-256color and COLORTERM truecolor, and not the NO_COLOR the daemon was started with');

  // The daemon was replaced at fix 11, so its hook port and token are
  // read again. postTo posts as the dropped shell; every block from M33
  // on reads these (M9 fix 605).
  const restarted = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const postTo = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${restarted.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': restarted.hookToken, 'X-Emerald-Session': dropped.id },
      body: JSON.stringify({ session_id: 'sim-m33', cwd: home, ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  const workingPane = leaves(await getLayout(s)).find((p) => p.sessionId === dropped.id).id;
  const paneStateSel = `[data-pane-id=${JSON.stringify(workingPane)}] .pane-state`;
  // The session mark's motion, read by M46, M41 and fix 122.
  const markMotion = (sel) =>
    s.evalJs(`(() => { const m = document.querySelector(${JSON.stringify(sel)}); if (!m) return null; const f = m.querySelector('.session-mark-frames'); return { working: m.dataset.working ?? null, tone: m.dataset.tone ?? null, frames: f ? f.children.length : 0, animation: f ? getComputedStyle(f.children[0]).animationName : null, own: getComputedStyle(m).animationName, title: m.title }; })()`);
  // The sidebar's width and its drag, read from fix 76 on. The drag sets
  // the width by state, which is what the hook's layout effect follows;
  // a ResizeObserver does not fire in a covered window.
  const sidebarWidthNow = () => s.evalJs(`document.querySelector('.sidebar').getBoundingClientRect().width`);
  const dragSidebar = async (dx) => {
    // Measured per drag: the resizer moves with the sidebar.
    const resizerAt = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: resizerAt.x, y: resizerAt.y, button: 'left', clickCount: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: resizerAt.x + dx, y: resizerAt.y, button: 'left' });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: resizerAt.x + dx, y: resizerAt.y, button: 'left', clickCount: 1 });
  };
  // The shared helpers since M9 fix 428; every card this script hovers
  // for is the roster card.
  const hoverForCard = (selector, what, opts) => hoverForCardIn(s, selector, '.roster-popover', what, opts);

  // Bindings one block makes and a later block reads (M9 fix 605); the
  // later block names the first in BLOCKS' needs, so --only runs both.
  let shellTitle, focusedBefore, addedPane, addedHolder;
  await block('m33', async () => {
    // M33, the working row. The dropped shell is made a working Claude
    // session by posted hooks. The row and the pane's state text carry
    // data-working=pulse, which is the attribute the CSS animates on; a
    // covered window draws no frames, so the check is the attribute, not a
    // frame. Then the shell writes an OSC 2 title with Claude's glyph, as
    // Claude Code does: the stripped text takes the agent line and the name
    // (fix 34), the meter keeps its place (fix 59), and a Stop puts the
    // last turn back.
    await postTo({ hook_event_name: 'SessionStart', source: 'startup' });
    await postTo({ hook_event_name: 'UserPromptSubmit', prompt: 'find the hash' });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'working'`, 'the row is working');
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.working === 'pulse'`, 'the row pulses without a glyph in the title');
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(paneStateSel)})?.dataset.working ?? null`)) === 'pulse', 'so does the pane state text');
    // M46: the mark is the session mark, four frames in one cell shown one
    // at a time (fix 86) while the row works (data-working, the attribute
    // the CSS animates on); the pane's state word sits still, the mark
    // being the one motion.
    const rowMotion = await markMotion(rowSel + ' .session-mark');
    expect(rowMotion !== null && rowMotion.working === 'true' && rowMotion.frames === 4 && rowMotion.animation === 'session-mark-frame', `the row's mark cycles while the session works, got ${JSON.stringify(rowMotion)}`);
    expect((await s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(paneStateSel)})).animationName`)) === 'none', 'and the state word sits still (M46)');
    // ConPTY reports a shell's own title (PowerShell's exe path) as it
    // starts, so the third line already shows a title here; a glyph is what
    // it has not got.
    shellTitle = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === dropped.id).title;
    expect(typeof shellTitle === 'string' && /^[A-Za-z]/.test(shellTitle), `the shell's own title has no glyph, got ${shellTitle}`);
    expect((await rowText(dropped.id, '.sidebar-row-activity .sidebar-row-agent')) === shellTitle, `the agent line shows it while working`);
    step('a working session: data-working=pulse on the row, the mark stepping and the state word still');

    // M46: the mark's geometry, on the row, in the pane title and on the
    // layout tab: a 16px cell holding the still star and four 16px glyph
    // frames laid over it, one shown at a time while working (fix 86), all
    // three in the working colour; the tab's mark is its first child,
    // before the panes icon, and the title's before the name.
    const markGeometry = (sel) =>
      s.evalJs(`(() => {
      const m = document.querySelector(${JSON.stringify(sel)});
      if (!m) return null;
      const frames = [...m.querySelector('.session-mark-frames').children];
      const h = (el) => el.getBoundingClientRect().height;
      // M9 fix 80: the still frame is the history rows' star as an SVG
      // with one path; fix 86: the stepping frames are the transcript's
      // four asterisks as text, one visible at a time, none moved.
      const still = m.querySelector('.session-mark-still svg path');
      const visible = frames.map((f) => getComputedStyle(f).opacity === '1');
      return { cell: h(m), width: m.getBoundingClientRect().width, frames: frames.length, frameHeights: frames.map(h), color: getComputedStyle(m).color, working: m.dataset.working ?? null, animation: getComputedStyle(frames[0]).animationName, first: m.parentElement.firstElementChild === m, star: still !== null, stillShown: getComputedStyle(m.querySelector('.session-mark-still')).visibility, glyphs: frames.map((f) => f.textContent).join(''), shown: visible.filter(Boolean).length, transform: getComputedStyle(m.querySelector('.session-mark-frames')).transform };
    })()`);
    const rowMark = await markGeometry(`${rowSel} .session-mark`);
    const titleMark = await markGeometry(`[data-pane-id=${JSON.stringify(workingPane)}] .pane-mark`);
    const tabMark = await markGeometry('.tab-panes[data-current] .tab-mark');
    for (const [where, m] of [['row', rowMark], ['pane title', titleMark], ['tab', tabMark]]) {
      expect(m !== null && m.cell === 16 && m.width === 16 && m.frames === 4 && m.frameHeights.every((x) => x === 16), `the ${where}'s mark is a 16px cell of four 16px frames, got ${JSON.stringify(m)}`);
      expect(m !== null && m.star && m.glyphs === '✳✱✻✽' && m.transform === 'none', `the ${where}'s still frame is the star and its stepping frames the four asterisks, nothing moved (fixes 80 and 86), got ${JSON.stringify(m)}`);
      expect(m !== null && m.working === 'true' && m.animation === 'session-mark-frame' && m.stillShown === 'hidden' && m.shown === 1, `the ${where}'s mark cycles while the session works, one frame shown and the star hidden, got ${JSON.stringify(m)}`);
    }
    expect(rowMark.first && titleMark.first && tabMark.first, `the mark is the first thing on the row, in the title and on the tab, got ${JSON.stringify([rowMark.first, titleMark.first, tabMark.first])}`);
    expect(rowMark.color === titleMark.color && titleMark.color === tabMark.color, `one colour on all three, got ${rowMark.color}, ${titleMark.color}, ${tabMark.color}`);
    // M9 fix 78: the mark was seen sitting still on a working session with
    // the animation named on it, which the reads above cannot tell from a
    // stepping one, and (fix 86) with its computed style moving too, since
    // the old slide ran on the compositor, which one GPU never redrew under
    // the cell's clip. So this reads motion twice: which frame the style
    // system shows, and what is painted, a screenshot of the cell through
    // the compositor, both of which must differ between two reads 300 ms
    // apart. The harness window sits off screen, where animation frames
    // run; a window covered by another does not run them (CLAUDE.md), so
    // this read would fail there, and the placement is what makes it safe.
    const frameShown = (sel) => s.evalJs(`[...document.querySelector(${JSON.stringify(sel)}).querySelector('.session-mark-frames').children].findIndex((f) => getComputedStyle(f).opacity === '1')`);
    const paintOf = async (sel) => {
      const r = await s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
      return (await s.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 4 }, fromSurface: true })).data;
    };
    const shownA = await frameShown(`${rowSel} .session-mark`);
    const paintA = await paintOf(`${rowSel} .session-mark`);
    await sleep(300);
    const shownB = await frameShown(`${rowSel} .session-mark`);
    const paintB = await paintOf(`${rowSel} .session-mark`);
    expect(shownA >= 0 && shownB >= 0 && shownA !== shownB, `the row's mark shows another frame 300 ms later, got ${shownA} then ${shownB}`);
    expect(paintA !== paintB, `and what is painted changes with it (fix 86)`);
    step(`M46: the session mark is a 16px cell, the star at rest and four asterisk frames cycling on the row, the pane title and the tab, all in ${rowMark.color}, and it moves on screen (frame ${shownA} then ${shownB})`);

    // M41, the fallback: this daemon reports level 1 (the older-daemon step
    // above), so the window never subscribes to the rate topic and the
    // mark's tooltip never gains the rate however much the shell prints;
    // the rate in the tooltip is read in verify:attention, whose daemon
    // reports its level. The mark steps either way.
    await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(dropped.id)}, data: '1..60 | % { "line $_"; Start-Sleep -m 20 }' + String.fromCharCode(13) })`);
    await sleep(1500);
    const fallbackMotion = await markMotion(rowSel + ' .session-mark');
    expect(fallbackMotion !== null && fallbackMotion.working === 'true' && fallbackMotion.animation === 'session-mark-frame' && !/output /.test(fallbackMotion.title), `on a level 1 daemon the mark steps while the shell prints and its tooltip has no rate, got ${JSON.stringify(fallbackMotion)}`);
    await sleep(1500);
    step('M41: on a daemon that reports an older level the mark steps while the shell prints and the tooltip never gets the rate');
  });

  await block('m46', async () => {
    // M46: the team. The working session's hooks send two subagents out
    // (the Agent tool's PostToolUse lands before the SubagentStart it
    // names, as the real log shows), one comes back, and the Stop that
    // ends the turn lists the other and a background shell as still
    // running: the row's roster reads out 1, returned 1, shells 1, the
    // pane title the same, the badge waiting (2), the title bar's summary
    // ends with the agent out, and the folder heading's units move by the
    // session's contribution (the group can hold other rows, so the reads
    // are against a baseline). Then the last subagent returns, a typed
    // prompt clears the returned unit, and a permission prompt gives the
    // mark the needs-pulse and never the step.
    const unitsOf = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}); if (!r) return null; const out = {}; for (const u of r.querySelectorAll('.roster-unit')) out[u.dataset.unit] = Number(u.querySelector('.roster-count').textContent); return out; })()`);
    // M9 fix 622: a roster hover that misses reads why. RosterUnits draws
    // nothing when every count is 0, so a miss means the row's counts went
    // to zero; the note puts the row's units and state beside the daemon's
    // own team for the session, so the next miss says whose side it is.
    const rosterMiss = async () => {
      const units = await unitsOf(rowSel + ' .roster');
      const state = await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state ?? null`);
      const listed = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === dropped.id);
      const team = listed === undefined ? 'no session' : `[${listed.team.map((m) => `${m.kind}:${m.outcome}`).join(', ')}]`;
      return `row units ${JSON.stringify(units)}, row state ${state}, daemon team ${team}`;
    };
    const groupOfDropped = await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)}).closest('.sidebar-group').dataset.group`);
    const droppedHeadingSel = `.sidebar-group[data-group=${JSON.stringify(groupOfDropped)}] .sidebar-group-title`;
    const headingUnits = () => unitsOf(droppedHeadingSel);
    const summaryText = () => s.evalJs(`document.querySelector('.title-bar-summary')?.textContent ?? null`);
    const unitsBefore = (await headingUnits()) ?? {};
    const barBefore = (await unitsOf('.title-bar .roster')) ?? {};
    expect((unitsBefore['agents-active'] ?? 0) >= 1, `the working session counts as an active agent on its heading, got ${JSON.stringify(unitsBefore)}`);
    expect(!/agent/.test(await summaryText()), `the title bar says nothing about agents before any are out, got ${await summaryText()}`);
    expect((await unitsOf(rowSel + ' .roster')) === null, 'no roster on the row before anything is sent out');
    await postTo({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { description: 'Read the log', subagent_type: 'Explore' } });
    await postTo({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'Read the log', subagent_type: 'Explore' }, tool_response: { agentId: 'm46-a1', description: 'Read the log', status: 'async_launched' } });
    await postTo({ hook_event_name: 'SubagentStart', agent_id: 'm46-a1', agent_type: 'Explore' });
    await postTo({ hook_event_name: 'SubagentStart', agent_id: 'm46-a2', agent_type: 'fork' });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .roster-unit[data-unit="out"] .roster-count')})?.textContent === '2'`, 'two agents out on the row');
    // Fix 88 moved the count off the summary's words and onto the units
    // after it: the two out are two active agents on the title bar.
    const barActive = ((await unitsOf('.title-bar .roster')) ?? {})['agents-active'];
    expect(barActive === (barBefore['agents-active'] ?? 0) + 2, `the title bar's active-agents unit counts the two out, ${barBefore['agents-active'] ?? 0} then ${barActive} (summary ${await summaryText()})`);
    await postTo({ hook_event_name: 'SubagentStop', agent_id: 'm46-a1', agent_type: 'Explore' });
    await postTo({
      hook_event_name: 'Stop',
      last_assistant_message: 'Waiting on the fork and the build.',
      background_tasks: [
        { id: 'm46-a2', type: 'subagent', status: 'running', description: 'Build the fork' },
        { id: 'm46-s1', type: 'shell', status: 'running', description: 'the build', command: 'npm run build' },
      ],
    });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'waiting'`, 'the row is waiting');
    const rowUnits = await unitsOf(rowSel + ' .roster');
    expect(JSON.stringify(rowUnits) === JSON.stringify({ out: 1, returned: 1, shells: 1 }), `the row's roster reads out 1, returned 1, shells 1, got ${JSON.stringify(rowUnits)}`);
    const titleUnits = await unitsOf(`[data-pane-id=${JSON.stringify(workingPane)}] .pane-title .roster`);
    expect(JSON.stringify(titleUnits) === JSON.stringify(rowUnits), `the pane title carries the same units, got ${JSON.stringify(titleUnits)}`);
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(paneStateSel)})?.textContent`)) === 'waiting (2)', 'the badge reads waiting (2)');
    const rosterMarks = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel + ' .roster')}); const u = (k) => r.querySelector('.roster-unit[data-unit="' + k + '"]'); const f = (el) => el.querySelector('.session-mark-frames').children[0]; return { out: getComputedStyle(f(u('out'))).animationName, returned: getComputedStyle(f(u('returned'))).animationName, shell: u('shells').querySelector('.shell-mark').dataset.running ?? null, caret: getComputedStyle(u('shells').querySelector('.shell-mark-caret')).animationName, cell: u('out').querySelector('.session-mark').getBoundingClientRect().height }; })()`);
    expect(rosterMarks.out === 'session-mark-frame' && rosterMarks.returned === 'none' && rosterMarks.shell === 'true' && rosterMarks.caret === 'shell-caret' && rosterMarks.cell === 12, `the out unit steps at unit size, the returned one is still, the shell's caret blinks, got ${JSON.stringify(rosterMarks)}`);
    // The members in spawn order were the roster's title tooltip; fix 89's
    // card lists them instead (read below), so the roster carries no title.
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel + ' .roster')}).getAttribute('title')`)) === null, 'the roster has no title tooltip; its card is the tooltip (fix 89)');
    const paused = await headingUnits();
    // The session went from active to inactive and its team adds one out
    // (active), one returned (inactive) and one shell running.
    expect(paused['agents-active'] === unitsBefore['agents-active'] && paused['agents-inactive'] === (unitsBefore['agents-inactive'] ?? 0) + 2 && paused['shells-running'] === (unitsBefore['shells-running'] ?? 0) + 1, `the heading's units follow the row's team, got ${JSON.stringify(unitsBefore)} then ${JSON.stringify(paused)}`);
    // Fix 88: the title bar carries the headings' units over every folder, so
    // it moves by the same contribution as the heading did.
    const barPaused = (await unitsOf('.title-bar .roster')) ?? {};
    expect(barPaused['agents-active'] === barBefore['agents-active'] && barPaused['agents-inactive'] === (barBefore['agents-inactive'] ?? 0) + 2 && barPaused['shells-running'] === (barBefore['shells-running'] ?? 0) + 1, `the title bar's units moved with the team: ${JSON.stringify(barBefore)} to ${JSON.stringify(barPaused)}`);
    const headingMarks = await s.evalJs(`(() => { const h = document.querySelector(${JSON.stringify(droppedHeadingSel)}); const u = (k) => h.querySelector('.roster-unit[data-unit="' + k + '"]'); const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; }; return { active: getComputedStyle(u('agents-active').querySelector('.session-mark-frames').children[0]).animationName, inactive: getComputedStyle(u('agents-inactive').querySelector('.session-mark')).opacity, inactiveCount: getComputedStyle(u('agents-inactive').querySelector('.roster-count')).opacity, cell: u('agents-active').querySelector('.session-mark').getBoundingClientRect().height, dot: !!h.querySelector('.sidebar-group-dot'), outline: !!h.querySelector('svg.sidebar-group-icon'), slot: h.querySelector('.sidebar-group-icon')?.getBoundingClientRect().width ?? null, nameMid: mid(h.querySelector('.sidebar-group-name')), markMid: mid(u('agents-active').querySelector('.session-mark')), countMid: mid(u('agents-active').querySelector('.roster-count')) }; })()`);
    expect(headingMarks.active === 'session-mark-frame' && headingMarks.cell === 13 && headingMarks.inactive === '0.7' && headingMarks.inactiveCount === '1', `the heading's active unit steps at heading size and the inactive glyph alone is dim, got ${JSON.stringify(headingMarks)}`);
    // M9 fix 82: the unit's mark and count sit on the name's line, their
    // vertical centres within a pixel of the name's (the text mark's 2px
    // nudge had put the star below it); the row's units are read the same
    // way against the sub line they sit in, which sat right and must stay
    // so.
    const level = (a, b) => Math.abs(a - b) <= 1;
    expect(level(headingMarks.markMid, headingMarks.nameMid) && level(headingMarks.countMid, headingMarks.nameMid), `the heading's unit sits on the name's line (fix 82), centres name ${headingMarks.nameMid}, mark ${headingMarks.markMid}, count ${headingMarks.countMid}`);
    const rowLevel = await s.evalJs(`(() => { const sub = document.querySelector(${JSON.stringify(rowSel + ' .sidebar-row-sub')}); const u = sub.querySelector('.roster-unit[data-unit="out"]'); const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; }; return { subMid: mid(sub), markMid: mid(u.querySelector('.session-mark')), countMid: mid(u.querySelector('.roster-count')) }; })()`);
    expect(level(rowLevel.markMid, rowLevel.subMid) && level(rowLevel.countMid, rowLevel.subMid), `the row's unit sits on its sub line, centres line ${rowLevel.subMid}, mark ${rowLevel.markMid}, count ${rowLevel.countMid}`);
    // M9 fix 81: the folder outline is back in the 14px slot of a heading
    // with no favicon (the harness folders have none).
    expect(!headingMarks.dot && headingMarks.outline && headingMarks.slot === 14, `no M32 dot, the folder outline in the heading's 14px slot (fix 81), got ${JSON.stringify(headingMarks)}`);
    await s.screenshot('m9-fixes-roster.png');

    // M9 fix 89: the roster explained, in a card. A hover on the row's
    // roster opens it after the delay; it says what each unit shown means,
    // in words, with the unit's own mark, then lists the members with the
    // running ones first; a click pins it, Escape closes it; the pane
    // title's roster and a heading's units open their own.
    const cardSel = '.roster-popover';
    const cardRead = () =>
      s.evalJs(
        `(() => { const c = document.querySelector(${JSON.stringify(cardSel)}); if (!c) return null; return { lines: [...c.querySelectorAll('.roster-card-unit')].map((u) => ({ unit: u.dataset.unit, text: u.querySelector('.roster-card-text').textContent, marks: u.querySelector('.session-mark, .shell-mark') !== null, working: u.querySelector('[data-working], [data-running]') !== null })), note: c.querySelector('.roster-card-note')?.textContent ?? null, members: [...c.querySelectorAll('.roster-card-member')].map((m) => ({ type: m.querySelector('.roster-card-member-type').textContent, elapsed: m.querySelector('.roster-card-member-elapsed')?.textContent ?? null, task: m.querySelector('.roster-card-member-task')?.textContent ?? null, working: 'working' in m.dataset, session: m.dataset.sessionId ?? null })) }; })()`,
      );
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel + ' .roster')}).getAttribute('title')`)) === null, 'the roster carries no title tooltip now, the card is the tooltip');
    const rosterAt = await hoverForCard(rowSel + ' .roster', 'the roster card opens on hover', { onMiss: rosterMiss });
    const card = await cardRead();
    expect(card.lines.map((l) => l.text).join('|') === '1 agent out, working now|1 agent returned this turn|1 background shell running now', `the card explains the three units, got ${JSON.stringify(card.lines)}`);
    expect(card.lines.every((l) => l.marks) && card.lines[0].working && !card.lines[1].working && card.lines[2].working, `each sentence carries its unit's mark, stepping for the active ones, got ${JSON.stringify(card.lines)}`);
    expect(/^Agents are the Claude sessions/.test(card.note ?? ''), `the note says where the counts come from, got ${JSON.stringify(card.note)}`);
    expect(card.members.length === 3 && card.members[0].working && card.members[1].working && !card.members[2].working, `three members, the running ones first, got ${JSON.stringify(card.members)}`);
    expect(card.members[0].type === 'agent fork' && card.members[0].task === 'Build the fork' && /^out \d+s$/.test(card.members[0].elapsed) && card.members[1].type === 'shell' && card.members[1].task === 'the build' && card.members[2].type === 'agent Explore' && /^returned after \d+s$/.test(card.members[2].elapsed), `the member rows carry type, elapsed and task, got ${JSON.stringify(card.members)}`);
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel + ' .roster')}).dataset.popoverOpen`)) === 'hover', 'the anchor says the card is open on hover');
    await s.click(rosterAt.x, rosterAt.y);
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .roster')}).dataset.popoverOpen === 'pinned'`, 'a click pins the card');
    // M9 fix 344: the same click also unfolds the team under the row.
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(rowSel + ' .sidebar-row-member')}).length === 3`, 'the click on the roster also lists the team under the row');
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await sleep(400);
    expect((await cardRead()) !== null, 'a pinned card stays when the mouse leaves');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'Escape closes the card');
    // A second click on the roster folds the team away again (and pins
    // the card again); folded back here so the fix 90 section below finds
    // it closed, as it does before the roster is ever clicked.
    const rosterAt2 = await hoverForCard(rowSel + ' .roster', 'the roster card opens on hover again', { onMiss: rosterMiss });
    await s.click(rosterAt2.x, rosterAt2.y);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(rowSel + ' .sidebar-row-member')}).length === 0`, 'a second click folds the team away again');
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .roster')}).dataset.popoverOpen === 'pinned'`, 'and pins its card again');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'Escape closes it');
    step('M9 fix 344: a click on the roster unfolds the team under the row and a second click folds it away, each still pinning the card');
    // The pane title's roster (the unfolded one is the one on show at this width).
    await hoverForCard(`[data-pane-id=${JSON.stringify(workingPane)}] .pane-title .roster`, "the pane title's roster opens the card", { onMiss: rosterMiss });
    const titleCard = await cardRead();
    expect(titleCard.lines.length === 3 && titleCard.members.length === 3, `the title's card is the same card, got ${JSON.stringify(titleCard.lines)}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'the card closes after the mouse leaves an unpinned card');
    // The heading's units: the sentences are the heading's four, and the
    // details are the group's sessions.
    await hoverForCard(droppedHeadingSel + ' .roster', "the heading's units open the card", { onMiss: rosterMiss });
    const headingCard = await cardRead();
    expect(headingCard.lines.length > 0 && headingCard.lines.every((l) => /^\d+ (agents?|shells?) /.test(l.text)), `the heading's card explains its units, got ${JSON.stringify(headingCard.lines)}`);
    expect(headingCard.members.some((m) => m.session === dropped.id), `the heading's card lists the group's sessions, got ${JSON.stringify(headingCard.members)}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, "the heading's card closes");
    step(`M9 fix 89: the roster card explains ${card.lines.map((l) => l.text).join(', ')} and lists ${card.members.length} members, pins on click, closes on Escape; the pane title and the heading open theirs`);

    // M9 fix 90: the team listed under the row. A chevron before the roster
    // unfolds one line per member, in spawn order, the mark stepping on the
    // running ones; the fold survives a reload and folds back on a click.
    const foldBtnSel = rowSel + ' .sidebar-row-team-fold';
    const teamRows = () =>
      s.evalJs(
        `[...document.querySelectorAll(${JSON.stringify(rowSel + ' .sidebar-row-member')})].map((m) => ({ type: m.querySelector('.sidebar-row-member-type').textContent, model: m.querySelector('.sidebar-row-member-model')?.textContent ?? null, task: m.querySelector('.sidebar-row-member-task').textContent, elapsed: m.querySelector('.sidebar-row-member-elapsed').textContent, working: 'working' in m.dataset, kind: m.dataset.kind, stepping: getComputedStyle(m.querySelector('.session-mark-frames > span, .shell-mark-caret')).animationName }))`,
      );
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(foldBtnSel)})?.textContent ?? null`)) === '▸', 'a chevron before the roster, folded');
    expect((await teamRows()).length === 0, 'no team lines while folded');
    await s.evalJs(`document.querySelector(${JSON.stringify(foldBtnSel)}).click()`);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(rowSel + ' .sidebar-row-member')}).length === 3`, 'three member lines under the row');
    const teamOpen = await teamRows();
    // M9 fix 289: no member has a model in this harness (no Claude home),
    // so every line reads model === null; the type is its own span now.
    expect(teamOpen[0].type === 'agent Explore' && teamOpen[0].task === 'Read the log' && teamOpen[0].model === null && !teamOpen[0].working && teamOpen[0].kind === 'agent' && /^returned after \d+s$/.test(teamOpen[0].elapsed), `the first line is the returned Explore in spawn order, got ${JSON.stringify(teamOpen[0])}`);
    expect(teamOpen[1].type === 'agent fork' && teamOpen[1].task === 'Build the fork' && teamOpen[1].model === null && teamOpen[1].working && teamOpen[1].stepping === 'session-mark-frame' && /^out \d+s$/.test(teamOpen[1].elapsed), `the fork's line steps and says how long it has been out, got ${JSON.stringify(teamOpen[1])}`);
    expect(teamOpen[2].type === 'shell' && teamOpen[2].task === 'the build' && teamOpen[2].model === null && teamOpen[2].working && teamOpen[2].kind === 'shell' && teamOpen[2].stepping === 'shell-caret', `the shell's line blinks its caret, got ${JSON.stringify(teamOpen[2])}`);
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)}).dataset.state`)) === 'waiting', 'the chevron click did not show or drag the session');
    // The chevron keeps its ▸ text and becomes a real disclosure: at least
    // a 16px hit box, data-open set once clicked open.
    const foldOpenState = await s.evalJs(
      `(() => { const b = document.querySelector(${JSON.stringify(foldBtnSel)}); const r = b.getBoundingClientRect(); return { text: b.textContent, open: 'open' in b.dataset, width: r.width, height: r.height }; })()`,
    );
    expect(foldOpenState.text === '▸' && foldOpenState.open && foldOpenState.width >= 16 && foldOpenState.height >= 16, `the chevron keeps its glyph, opens data-open and is at least 16px, got ${JSON.stringify(foldOpenState)}`);
    const hostsBeforeTeam = await s.evalJs(`document.querySelectorAll('.term-host').length`);
    await s.send('Page.reload');
    await s.waitFor(`document.querySelectorAll('.term-host').length === ${hostsBeforeTeam} && document.querySelectorAll(${JSON.stringify(rowSel + ' .sidebar-row-member')}).length === 3`, 'the team is still listed after the reload');
    await s.evalJs(`document.querySelector(${JSON.stringify(foldBtnSel)}).click()`);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(rowSel + ' .sidebar-row-member')}).length === 0`, 'the chevron folds the team away');
    step(`M9 fix 90: the chevron listed ${teamOpen.length} members under the row (${teamOpen.map((t) => t.task).join(', ')}), kept across a reload, folded back`);

    // The fork returns: nothing out, two returned, and the title bar drops
    // the agents; the typed prompt then clears the returned ones and the
    // shell (still listed as running by the last Stop) stays.
    await postTo({ hook_event_name: 'SubagentStop', agent_id: 'm46-a2', agent_type: 'fork' });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .roster-unit[data-unit="returned"] .roster-count')})?.textContent === '2'`, 'two returned on the row');
    expect((await unitsOf(rowSel + ' .roster')).out === undefined && !/agent/.test(await summaryText()), `nothing out and no agents in the title bar, got ${await summaryText()}`);
    await postTo({ hook_event_name: 'UserPromptSubmit', prompt: 'find the hash' });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'working' && !document.querySelector(${JSON.stringify(rowSel + ' .roster-unit[data-unit="returned"]')})`, 'the typed prompt clears the returned unit');
    expect(JSON.stringify(await unitsOf(rowSel + ' .roster')) === JSON.stringify({ shells: 1 }), `the shell unit stays, got ${JSON.stringify(await unitsOf(rowSel + ' .roster'))}`);
    // M9 fix 101: the shell unit is the running count, the number Claude
    // Code's own status line prints as "3 shells". A Stop listing three
    // running shells reads 3 on the row and the pane title; the next Stop
    // listing two reads 2, and the one it dropped is not in the unit but on
    // the card, under its own finished line and as a member. emmer ls
    // prints the same count (verify:cli reads that).
    await postTo({
      hook_event_name: 'Stop',
      last_assistant_message: 'Three builds running.',
      background_tasks: [
        { id: 'm46-s1', type: 'shell', status: 'running', description: 'the build', command: 'npm run build' },
        { id: 'm46-s2', type: 'shell', status: 'running', description: 'the app build', command: 'npm run build -w @emerald/app' },
        { id: 'm46-s3', type: 'shell', status: 'running', description: 'the tests', command: 'npm test' },
      ],
    });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .roster-unit[data-unit="shells"] .roster-count')})?.textContent === '3'`, 'three shells running on the row');
    expect(JSON.stringify(await unitsOf(`[data-pane-id=${JSON.stringify(workingPane)}] .pane-title .roster`)) === JSON.stringify({ shells: 3 }), `the pane title reads three shells, got ${JSON.stringify(await unitsOf(`[data-pane-id=${JSON.stringify(workingPane)}] .pane-title .roster`))}`);
    await postTo({
      hook_event_name: 'Stop',
      last_assistant_message: 'Two builds running.',
      background_tasks: [
        { id: 'm46-s1', type: 'shell', status: 'running', description: 'the build', command: 'npm run build' },
        { id: 'm46-s2', type: 'shell', status: 'running', description: 'the app build', command: 'npm run build -w @emerald/app' },
      ],
    });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .roster-unit[data-unit="shells"] .roster-count')})?.textContent === '2'`, 'two shells running on the row once the third is dropped');
    expect(JSON.stringify(await unitsOf(rowSel + ' .roster')) === JSON.stringify({ shells: 2 }), `the row's unit is the running count alone, got ${JSON.stringify(await unitsOf(rowSel + ' .roster'))}`);
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(paneStateSel)})?.textContent`)) === 'waiting (2)', 'the badge counts the Stop\'s own list, waiting (2)');
    // M9 fix 122: the heading follows the row's rule; the dropped shell is
    // not a shell at its prompt, so the heading's idle unit does not move
    // and its running unit is the session's two over the baseline.
    const headingAfterDrop = (await headingUnits()) ?? {};
    expect((headingAfterDrop['shells-idle'] ?? 0) === (unitsBefore['shells-idle'] ?? 0) && (headingAfterDrop['shells-running'] ?? 0) === (unitsBefore['shells-running'] ?? 0) + 2, `the heading counts the two running shells and no idle one for the finished shell, ${JSON.stringify(unitsBefore)} then ${JSON.stringify(headingAfterDrop)}`);
    step('M9 fix 122: a finished background shell adds nothing to the heading\'s idle shells');
    await hoverForCard(rowSel + ' .roster', 'the roster card opens for the shells', { onMiss: rosterMiss });
    const shellsCard = await cardRead();
    expect(shellsCard.lines.map((l) => l.text).join('|') === '2 background shells running now|1 background shell finished this turn', `the card says two running and one finished, got ${JSON.stringify(shellsCard.lines)}`);
    expect(shellsCard.lines[0].unit === 'shells' && shellsCard.lines[0].working && shellsCard.lines[1].unit === 'shells-returned' && !shellsCard.lines[1].working, `the finished line has a still unit of its own, got ${JSON.stringify(shellsCard.lines)}`);
    const finishedMember = shellsCard.members.find((m) => m.task === 'the tests');
    expect(shellsCard.members.length === 3 && finishedMember !== undefined && !finishedMember.working && /^finished after \d+s$/.test(finishedMember.elapsed ?? ''), `the dropped shell is a finished member on the card, got ${JSON.stringify(shellsCard.members)}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'the card closes');
    step(`M9 fix 101: three running shells read 3 on the row and the title, the next Stop's two read 2 with the badge at waiting (2), and the card says ${shellsCard.lines.map((l) => l.text).join(', ')} with the dropped shell finished among its ${shellsCard.members.length} members`);
    await postTo({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'needs-input'`, 'the row needs input');
    const needsMark = await markMotion(rowSel + ' .session-mark');
    expect(needsMark !== null && needsMark.tone === 'needs-input' && needsMark.working === null && needsMark.own === 'needs-pulse' && needsMark.animation === 'none', `a needs-input mark breathes on needs-pulse and never steps, got ${JSON.stringify(needsMark)}`);
    // Back to work for the steps that follow, which read the working row.
    await postTo({ hook_event_name: 'UserPromptSubmit', prompt: 'find the hash' });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.working === 'pulse'`, 'working again');
    step(`M46: two agents out then one back gave out 1, returned 1, shells 1 on the row and the title, waiting (2), the title bar's units moving with the heading's (fix 88), the heading units following and level with the name (fix 82: name ${headingMarks.nameMid}, mark ${headingMarks.markMid}, count ${headingMarks.countMid}); a typed prompt cleared the returned, a permission prompt put the mark on needs-pulse`);
  });

  await block('fix-76', async () => {
    // Fix 76: the row's sub line gives in whole steps. A shell in a folder
    // with a long branch (a bare .git/HEAD, which is all the daemon reads)
    // is given a team of three units, a status line (Opus 5 · ◔ 19%, with
    // the request's counts so the tokens span is on the row, M9 fix 146)
    // and the pane on the left, so its sub line carries everything the
    // backlog's row did; then the sidebar is dragged narrower a step at a
    // time and data-squeeze read at each width: the shown word goes first,
    // then the model's words and the percent together with the dial still
    // 11px and inside the line, then the tokens (fix 146: a level of their
    // own after the words, where fix 143 had them go with the shown word),
    // then the branch name's ellipsis with the icon still beside it and
    // the roster whole throughout; the level never falls as the width
    // does, and the default width brings level 0 back.
    const squeezeRepo = path.join(os.tmpdir(), 'emerald-verify', 'm9-squeeze-repo');
    fs.mkdirSync(path.join(squeezeRepo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(squeezeRepo, '.git', 'HEAD'), 'ref: refs/heads/fix/squeeze-line\n');
    const { session: squeezed } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: squeezeRepo, cols: 120, rows: 30 });
    const sqRowSel = `.sidebar-row[data-session-id=${JSON.stringify(squeezed.id)}]`;
    const sqSubSel = `${sqRowSel} .sidebar-row-sub`;
    const postSq = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${restarted.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': restarted.hookToken, 'X-Emerald-Session': squeezed.id },
        body: JSON.stringify({ session_id: 'sim-m9-76', cwd: squeezeRepo, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postSq({ hook_event_name: 'SessionStart', source: 'startup' });
    await postSq({ hook_event_name: 'UserPromptSubmit', prompt: 'squeeze the line' });
    await postSq({ hook_event_name: 'SubagentStart', agent_id: 'sq-a1', agent_type: 'Explore' });
    await postSq({ hook_event_name: 'SubagentStart', agent_id: 'sq-a2', agent_type: 'fork' });
    await postSq({ hook_event_name: 'SubagentStop', agent_id: 'sq-a1', agent_type: 'Explore' });
    await postSq({
      hook_event_name: 'Stop',
      last_assistant_message: 'Waiting on the fork and the build.',
      background_tasks: [
        { id: 'sq-a2', type: 'subagent', status: 'running', description: 'Build the fork' },
        { id: 'sq-s1', type: 'shell', status: 'running', description: 'the build', command: 'npm run build' },
      ],
    });
    await postSq({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, workspace: { current_dir: squeezeRepo }, context_window: { used_percentage: 19, context_window_size: 1000000, total_input_tokens: 54751, total_output_tokens: 130, current_usage: { input_tokens: 2, output_tokens: 130, cache_creation_input_tokens: 14649, cache_read_input_tokens: 40100 } } });
    let layout = await getLayout(s);
    const parkedInDrop = leaves(layout).find((p) => p.id === dropPane).sessionId;
    await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, dropPane, squeezed.id) } });
    await s.waitFor(`(() => { const r = document.querySelector(${JSON.stringify(sqRowSel)}); return r?.dataset.state === 'waiting' && r.dataset.shown !== undefined && r.querySelectorAll('.roster-unit').length === 3 && r.querySelector('.sidebar-row-context-percent')?.textContent === '19%' && r.querySelector('.sidebar-row-tokens')?.textContent === '↑54.8k (40.1k cached) ↓130' && r.querySelector('.sidebar-row-branch-name')?.textContent === 'fix/squeeze-line'; })()`, 'the squeezed row is waiting with three units, its branch, the reading, the tokens and a pane');
    const subRead = () =>
      s.evalJs(`(() => {
      const sub = document.querySelector(${JSON.stringify(sqSubSel)});
      const vis = (el) => el !== null && el.getClientRects().length > 0;
      const box = (el) => el?.getBoundingClientRect() ?? null;
      const name = sub.querySelector('.sidebar-row-branch-name');
      const dial = sub.querySelector('.context-dial');
      const line = box(sub);
      return {
        width: document.querySelector('.sidebar').getBoundingClientRect().width,
        level: sub.dataset.squeeze ?? null,
        shown: vis(sub.querySelector('.sidebar-row-shown')),
        words: vis(sub.querySelector('.sidebar-row-context-model')),
        percent: vis(sub.querySelector('.sidebar-row-context-percent')),
        tokens: vis(sub.querySelector('.sidebar-row-tokens')),
        dial: box(dial)?.width ?? null,
        dialInside: dial !== null && box(dial).right <= line.right + 0.5,
        units: [...sub.querySelectorAll('.roster-unit')].filter((u) => u.scrollWidth <= u.clientWidth + 1).length,
        nameClipped: name !== null && name.scrollWidth > name.clientWidth + 1,
        nameWidth: box(name)?.width ?? null,
        icon: box(sub.querySelector('.sidebar-row-branch-icon'))?.width ?? null,
        lineClipped: sub.scrollWidth > sub.clientWidth + 1,
      };
    })()`);
    const squeezeWidthBefore = await sidebarWidthNow();
    const initial = await subRead();
    // M9 fix 102: the on-screen word was the shells unit's blue, so the
    // two read as one phrase; it wears the sub line's dim colour now with a
    // dot before it (the word's ::before, off data-dot) when a roster
    // precedes it, and a row with no roster has no dot. Read on the
    // squeezed row, whole at this width.
    const shownColours = await s.evalJs(`(() => {
    const sub = document.querySelector(${JSON.stringify(sqSubSel)});
    const word = sub.querySelector('.sidebar-row-shown');
    const shells = sub.querySelector('.roster-unit[data-unit="shells"] .roster-count');
    const branch = sub.querySelector('.sidebar-row-branch-name');
    const order = [...sub.children].map((el) => el.className.split(' ')[0]);
    const bare = [...document.querySelectorAll('.sidebar-row[data-shown]')].filter((r) => r.querySelector('.roster') === null);
    return {
      word: word === null ? null : getComputedStyle(word).color,
      shells: shells === null ? null : getComputedStyle(shells).color,
      branch: branch === null ? null : getComputedStyle(branch).color,
      dot: word === null ? null : getComputedStyle(word, '::before').content,
      dotColour: word === null ? null : getComputedStyle(word, '::before').color,
      afterRoster: word !== null && order.indexOf('roster') !== -1 && order.indexOf('roster') < order.indexOf('sidebar-row-shown'),
      bareRows: bare.length,
      bareDots: bare.filter((r) => r.querySelector('.sidebar-row-shown[data-dot]') !== null).length,
    };
  })()`);
    expect(shownColours.word !== null && shownColours.shells !== null && shownColours.word !== shownColours.shells, `the on-screen word's colour differs from the shells unit's, got ${JSON.stringify(shownColours)}`);
    expect(shownColours.word === shownColours.branch, `the word takes the sub line's dim colour, the branch name's, got ${JSON.stringify(shownColours)}`);
    expect(shownColours.dot === '"· "' && shownColours.dotColour === shownColours.word && shownColours.afterRoster, `a dot in the same colour sits between the roster and the word, got ${JSON.stringify(shownColours)}`);
    expect(shownColours.bareDots === 0, `a row with no roster has no dot (${shownColours.bareRows} such rows on screen), got ${JSON.stringify(shownColours)}`);
    step(`M9 fix 102: the on-screen word is ${shownColours.word} beside the shells unit's ${shownColours.shells}, with a dot before it; ${shownColours.bareRows} rows without a roster carry none`);
    const readings = [initial];
    // From 560: with the tokens on the line (fix 146) 400px is level 1
    // already, and the cached share on the reading (fix 154) wants about
    // 540px for the line to be whole.
    for (let target = 560; target >= 180; target -= 20) {
      await dragSidebar(target - (await sidebarWidthNow()));
      await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === ${target}`, `the sidebar at ${target}px`);
      readings.push(await subRead());
    }
    const firstAt = {};
    let lastLevel = -1;
    for (const r of [...readings].sort((a, b) => b.width - a.width)) {
      const level = Number(r.level);
      expect(r.level !== null && level >= lastLevel, `the level never falls as the sidebar narrows, got ${JSON.stringify(readings.map((x) => [x.width, x.level]))}`);
      lastLevel = level;
      firstAt[level] ??= r.width;
      expect(r.shown === (level === 0) && r.words === (level < 2) && r.percent === (level < 2) && r.tokens === (level < 3), `at ${r.width}px level ${level} hides the right parts, got ${JSON.stringify(r)}`);
      expect(r.dial === 11 && r.dialInside && r.units === 3 && r.icon === 11 && r.nameWidth > 30, `at ${r.width}px the dial, the three units and the branch icon with its name are all whole, got ${JSON.stringify(r)}`);
      // M9 fix 221: the dollars are level 4, a level this row (no cost) drops nothing at and never lands on; the branch clips at 5.
      expect(r.level !== '4', `a row with no cost never lands on level 4, got ${JSON.stringify(r)}`);
      expect(r.nameClipped === (level === 5) && (level === 5 || !r.lineClipped), `at ${r.width}px the branch name is clipped at level 5 and nothing is clipped before it, got ${JSON.stringify(r)}`);
    }
    expect(firstAt[0] !== undefined && firstAt[3] !== undefined && firstAt[5] !== undefined, `the walk saw the line whole, the tokens gone and the branch name clipped, got ${JSON.stringify(firstAt)}`);
    await dragSidebar(squeezeWidthBefore - (await sidebarWidthNow()));
    await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === ${squeezeWidthBefore}`, 'the sidebar back at its width');
    const wide = await subRead();
    expect(wide.level === initial.level, `back at ${squeezeWidthBefore}px the level is ${initial.level} again, got ${wide.level}`);
    step(`fix 76: the sub line's levels by sidebar width, 0 at ${firstAt[0]}px, 1 at ${firstAt[1] ?? '-'}px, 2 at ${firstAt[2] ?? '-'}px, 3 at ${firstAt[3]}px, 5 at ${firstAt[5]}px; the shown word, then the words and the percent, then the tokens (fix 146), then the dollars' level 4 skipped on a row with no cost (fix 221), then the branch name's ellipsis, the dial and the units whole throughout`);
    // M9 fix 123: the first line gives one step. The fork asks permission,
    // so the squeezed row's badge reads the reason in words (`needs input:
    // an agent's permission`, not the key `agent-permission`); walking the
    // sidebar down, the badge drops the reason (data-squeeze 1 on the main
    // line, the reason span unrendered) before the name loses a letter,
    // and reads `needs input` whole from then on. The agent's PostToolUse
    // puts the row back at waiting for the fix 77 walk below.
    await postSq({ hook_event_name: 'PermissionRequest', agent_id: 'sq-a2', tool_name: 'Edit', tool_input: { file_path: 'fork.txt' } });
    await s.waitFor(`document.querySelector(${JSON.stringify(sqRowSel)})?.dataset.state === 'needs-input'`, 'the squeezed row needs input for the fork');
    const mainRead = () =>
      s.evalJs(`(() => {
      const main = document.querySelector(${JSON.stringify(sqRowSel + ' .sidebar-row-main')});
      const name = main.querySelector('.sidebar-row-name');
      const badge = main.querySelector('.sidebar-row-state');
      const reason = main.querySelector('.sidebar-row-reason');
      return {
        width: document.querySelector('.sidebar').getBoundingClientRect().width,
        level: main.dataset.squeeze ?? null,
        badge: badge?.innerText ?? null,
        reason: reason !== null && reason.getClientRects().length > 0,
        badgeClipped: badge !== null && badge.scrollWidth > badge.clientWidth + 1,
        nameClipped: name !== null && name.scrollWidth > name.clientWidth + 1,
      };
    })()`);
    // The whole phrase needs about 480px beside this row's name and age,
    // so the walk starts at 500 and ends at the sidebar's floor.
    await dragSidebar(500 - (await sidebarWidthNow()));
    await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === 500`, 'the sidebar at 500px for the main line walk');
    const wideMain = await mainRead();
    expect(wideMain.badge === "needs input: an agent's permission" && wideMain.reason && wideMain.level === '0', `at ${wideMain.width}px the badge says the reason in words, got ${JSON.stringify(wideMain)}`);
    const mainReadings = [wideMain];
    for (let target = 460; target >= 180; target -= 40) {
      await dragSidebar(target - (await sidebarWidthNow()));
      await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === ${target}`, `the sidebar at ${target}px`);
      mainReadings.push(await mainRead());
    }
    let lastMainLevel = -1;
    for (const r of [...mainReadings].sort((a, b) => b.width - a.width)) {
      const level = Number(r.level);
      expect(r.level !== null && level >= lastMainLevel, `the main line's level never falls as the sidebar narrows, got ${JSON.stringify(mainReadings.map((x) => [x.width, x.level]))}`);
      lastMainLevel = level;
      expect(r.reason === (level === 0) && (level === 0 ? r.badge === "needs input: an agent's permission" : r.badge === 'needs input'), `at ${r.width}px level ${level} shows the reason only at level 0, got ${JSON.stringify(r)}`);
      expect(level === 1 || (!r.nameClipped && !r.badgeClipped), `at ${r.width}px the reason gives before the name or the badge is cut, got ${JSON.stringify(r)}`);
      expect(level === 0 || !r.badgeClipped, `at ${r.width}px the two-word badge is whole, got ${JSON.stringify(r)}`);
    }
    const reasonGaveAt = mainReadings.find((r) => r.level === '1')?.width;
    expect(reasonGaveAt !== undefined, `the walk saw the reason give way, got ${JSON.stringify(mainReadings.map((x) => [x.width, x.level, x.nameClipped]))}`);
    await dragSidebar(squeezeWidthBefore - (await sidebarWidthNow()));
    await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === ${squeezeWidthBefore}`, 'the sidebar back at its width');
    expect(Number((await mainRead()).level) <= 1, 'back at the width before the walk the line has a level');
    await postSq({ hook_event_name: 'PostToolUse', agent_id: 'sq-a2', tool_name: 'Edit', tool_input: { file_path: 'fork.txt' } });
    await s.waitFor(`document.querySelector(${JSON.stringify(sqRowSel)})?.dataset.state === 'waiting'`, 'the fork\'s answered permission puts the row back at waiting');
    step(`M9 fix 123: the badge said needs input: an agent's permission at ${wideMain.width}px and dropped the reason at ${reasonGaveAt}px before the name lost a letter, reading needs input whole below that`);
    // Fix 77: the pane title's roster folds to a total. The squeezed
    // session is still in the left pane with its three units and the badge
    // waiting (2); the root split's ratio walks that pane from 600px down
    // to 300 and the title's data-squeeze is read at each width: 0 with
    // the three units while the badge has its room, then 1, the units
    // folded to one total of 3 in the colour of the out unit with the
    // units in words at the top of its hover, from the width at which the
    // badge would otherwise clip, so at that width the badge reads whole;
    // then 2 (M9 fix 146), the tokens gone from the reading, which held
    // whole until then, and the badge whole again at that width; the
    // ratio put back, the title reads as it did (the default pane is
    // 339px here, a folding width). The ratio is state, the path the
    // hook's layout effect follows.
    const sqTitleSel = `[data-pane-id=${JSON.stringify(dropPane)}] .pane-title`;
    const titleRead = () =>
      s.evalJs(`(() => {
      const title = document.querySelector(${JSON.stringify(sqTitleSel)});
      const vis = (el) => el !== null && el.getClientRects().length > 0;
      const rosters = [...title.querySelectorAll('.roster')].filter(vis);
      const units = rosters.flatMap((r) => [...r.querySelectorAll('.roster-unit')].map((u) => [u.dataset.unit, Number(u.querySelector('.roster-count').textContent)]));
      const total = title.querySelector('.roster-unit[data-unit="total"]');
      const badge = title.querySelector('.pane-state');
      return {
        width: title.getBoundingClientRect().width,
        level: title.dataset.squeeze ?? null,
        rosters: rosters.length,
        units: Object.fromEntries(units),
        totalShown: vis(total),
        totalColor: total === null ? null : getComputedStyle(total).color,
        totalAlive: total?.dataset.alive ?? null,
        totalStepping: total === null ? null : getComputedStyle(total.querySelector('.session-mark-frames').children[0]).animationName,
        foldedTitle: total?.closest('.roster')?.getAttribute('title') ?? null,
        foldedAnchor: total?.closest('.roster')?.dataset.popoverFor ?? null,
        badge: badge.textContent,
        badgeWhole: badge.scrollWidth <= badge.clientWidth + 1,
        tokensShown: vis(title.querySelector('.pane-tokens')),
        tokensWhole: (() => { const t = title.querySelector('.pane-tokens'); if (t === null || !vis(t)) return null; const r = t.getBoundingClientRect(); const c = t.closest('.pane-context').getBoundingClientRect(); return t.scrollWidth <= t.clientWidth + 1 && r.right <= c.right + 0.5; })(),
      };
    })()`);
    const outColor = await s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(sqRowSel + ' .roster-unit[data-unit="out"]')})).color`);
    const initialTitle = await titleRead();
    layout = await getLayout(s);
    const rootRatioBefore = layout.root.ratio;
    const rootWidth = await s.evalJs(`document.querySelector('.splitview .split').getBoundingClientRect().width`);
    const paneTo = async (target) => {
      layout = await getLayout(s);
      await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: target / rootWidth } } });
      await s.waitFor(`Math.abs(document.querySelector(${JSON.stringify(sqTitleSel)}).getBoundingClientRect().width - ${target}) < 4`, `the left pane at about ${target}px`);
    };
    // Wide to narrow in 20px steps: the level never falls, the three units
    // stand at 0 and the total at 1, and at the first width that folds the
    // badge reads whole, which is what the fold is for (narrower still the
    // badge clips as fix 56's order has it, after the total).
    const titleReadings = [];
    for (let target = 600; target >= 300; target -= 20) {
      await paneTo(target);
      titleReadings.push(await titleRead());
    }
    let lastTitleLevel = -1;
    let foldedAt = null;
    let tokensGoneAt = null;
    for (const r of titleReadings) {
      const level = Number(r.level);
      expect(r.level !== null && level >= lastTitleLevel, `the title's level never falls as the pane narrows, got ${JSON.stringify(titleReadings.map((x) => [Math.round(x.width), x.level]))}`);
      lastTitleLevel = level;
      if (level === 0) expect(r.rosters === 1 && JSON.stringify(r.units) === JSON.stringify({ out: 1, returned: 1, shells: 1 }) && !r.totalShown, `at ${Math.round(r.width)}px the title shows its three units and no total, got ${JSON.stringify(r)}`);
      // From fix 237's sixth level the total goes with the name; the walk ends at 300px, which stays under that.
      else if (level >= 6) expect(r.rosters === 0, `at ${Math.round(r.width)}px level ${level} the roster is gone with the name (fix 237), got ${JSON.stringify(r)}`);
      else {
        expect(r.rosters === 1 && JSON.stringify(r.units) === JSON.stringify({ total: 3 }) && r.totalShown, `at ${Math.round(r.width)}px the title folds its roster to a total of 3, got ${JSON.stringify(r)}`);
        if (foldedAt === null) {
          foldedAt = r;
          expect(r.badge === 'waiting (2)' && r.badgeWhole, `at ${Math.round(r.width)}px, the first width that folds, the badge reads whole beside the total, got ${JSON.stringify(r)}`);
          expect(r.totalAlive === 'out' && r.totalColor === outColor && r.totalStepping === 'session-mark-frame', `the total takes the out unit's colour and steps, got ${JSON.stringify(r)}`);
          // The folded hover carried the units in words and the members (fix 77); the card does now (fix 89), off the same anchor.
          expect(r.foldedTitle === null && /^roster:/.test(r.foldedAnchor ?? ''), `the folded roster carries no title and is the card's anchor, got ${JSON.stringify({ title: r.foldedTitle, anchor: r.foldedAnchor })}`);
        }
      }
      // Fix 146: the tokens hold whole through levels 0 and 1 and are gone at 2, the badge whole again at the first width that drops them.
      // Fix 208 put two more levels after it (the splits, then the shade), which a 20px step can land on straight from 1.
      expect(r.tokensShown === (level < 2) && (level >= 2 || r.tokensWhole === true), `at ${Math.round(r.width)}px level ${level} the tokens are ${level < 2 ? 'whole' : 'gone'}, got ${JSON.stringify(r)}`);
      if (level >= 2 && tokensGoneAt === null) {
        tokensGoneAt = r;
        expect(r.badgeWhole, `at ${Math.round(r.width)}px, the first width that drops the tokens, the badge reads whole, got ${JSON.stringify(r)}`);
      }
    }
    expect(titleReadings[0].level === '0' && foldedAt !== null && tokensGoneAt !== null, `the walk saw the units whole, then folded, then the tokens gone, got ${JSON.stringify(titleReadings.map((x) => [Math.round(x.width), x.level]))}`);
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: rootRatioBefore } } });
    await s.waitFor(`Math.abs(document.querySelector(${JSON.stringify(sqTitleSel)}).getBoundingClientRect().width - ${initialTitle.width}) < 4`, 'the left pane back at its width');
    const backTitle = await titleRead();
    expect(backTitle.level === initialTitle.level && JSON.stringify(backTitle.units) === JSON.stringify(initialTitle.units), `back at ${Math.round(backTitle.width)}px the title reads as it did, level ${initialTitle.level}, got ${JSON.stringify(backTitle)}`);
    step(`fix 77: the title's roster folded to a total of 3 from ${Math.round(foldedAt.width)}px with waiting (2) whole there, the units whole at ${Math.round(titleReadings[0].width)}px, the tokens whole down to ${Math.round(tokensGoneAt.width) + 20}px and gone from ${Math.round(tokensGoneAt.width)}px (fix 146), and back at level ${backTitle.level} at ${Math.round(backTitle.width)}px`);
    // M9 fix 237: narrower still, the same pane walked from 300px down to
    // 80 by the root ratio (the splitter's path, set as state): the state
    // word goes at the fifth level, the name at the sixth with the folded
    // roster and the reading, hide and close at the seventh, and the
    // zoom and the shade stay to the end, inside the title's box; from
    // the narrowest width the zoom gives the pane the tab and back, and
    // the shade pulls and lifts. The level never falls on the way down
    // and the ratio put back brings the title back where it was.
    const floorSel = `[data-pane-id=${JSON.stringify(dropPane)}]`;
    const floorRead = () =>
      s.evalJs(`(() => {
      const title = document.querySelector(${JSON.stringify(floorSel + ' .pane-title')});
      const box = title.getBoundingClientRect();
      // Any element matching: the title holds two rosters and shows one.
      const shown = (sel) => [...title.querySelectorAll(sel)].some((el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0);
      const inside = (sel) => { const el = title.querySelector(sel); if (el === null) return null; const r = el.getBoundingClientRect(); return r.left >= box.left - 0.5 && r.right <= box.right + 0.5; };
      return {
        width: Math.round(box.width),
        level: Number(title.dataset.squeeze ?? 0),
        state: shown('.pane-state'), name: shown('.pane-name'), roster: shown('.roster'), context: shown('.pane-context'),
        splits: shown('.pane-split-right') || shown('.pane-split-down'), hide: shown('.pane-hide'), close: shown('.pane-close'),
        zoom: shown('.pane-zoom'), shade: shown('.pane-shade-toggle'), mark: shown('.pane-mark'),
        zoomInside: inside('.pane-zoom'), shadeInside: inside('.pane-shade-toggle'),
      };
    })()`);
    const floorReadings = [];
    // The floor is about 75px (the mark, the two buttons and the tightened paddings), so the walk ends at 80.
    for (let target = 300; target >= 80; target -= 20) {
      await paneTo(target);
      floorReadings.push(await floorRead());
    }
    let lastFloorLevel = -1;
    let stateGoneAt = null;
    let nameGoneAt = null;
    let closeGoneAt = null;
    for (const r of floorReadings) {
      expect(r.level >= lastFloorLevel, `fix 237: the level never falls as the pane narrows, got ${JSON.stringify(floorReadings.map((x) => [x.width, x.level]))}`);
      lastFloorLevel = r.level;
      expect(r.state === (r.level < 5) && r.name === (r.level < 6) && r.roster === (r.level < 6) && r.context === (r.level < 6), `fix 237: at ${r.width}px level ${r.level} the state shows below 5 and the name, the roster and the reading below 6, got ${JSON.stringify(r)}`);
      expect(r.splits === (r.level < 3) && r.hide === (r.level < 7) && r.close === (r.level < 7), `fix 237: at ${r.width}px level ${r.level} the splits show below 3 and hide and close below 7, got ${JSON.stringify(r)}`);
      expect(r.mark && r.zoom && r.shade && r.zoomInside && r.shadeInside, `fix 237: at ${r.width}px level ${r.level} the mark, the zoom and the shade show inside the title, got ${JSON.stringify(r)}`);
      if (!r.state && stateGoneAt === null) stateGoneAt = r;
      if (!r.name && nameGoneAt === null) nameGoneAt = r;
      if (!r.close && closeGoneAt === null) closeGoneAt = r;
    }
    expect(stateGoneAt !== null && nameGoneAt !== null && closeGoneAt !== null, `fix 237: the walk saw the state, then the name, then hide and close go, got ${JSON.stringify(floorReadings.map((x) => [x.width, x.level]))}`);
    expect(stateGoneAt.width >= nameGoneAt.width && nameGoneAt.width >= closeGoneAt.width && stateGoneAt.level < nameGoneAt.level && nameGoneAt.level < closeGoneAt.level, `fix 237: the state goes before the name and the name before hide and close, got ${JSON.stringify({ stateGoneAt, nameGoneAt, closeGoneAt })}`);
    const narrowestFloor = floorReadings[floorReadings.length - 1];
    expect(narrowestFloor.level === 7 && narrowestFloor.width <= 84, `fix 237: at the narrowest the title is at its last level, got ${JSON.stringify(narrowestFloor)}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(floorSel + ' .pane-zoom')}).click()`);
    await s.waitFor(`!!document.querySelector('.splitview.zoomed')`, 'the zoom button zoomed the sliver');
    const zoomedFloor = await floorRead();
    expect(zoomedFloor.level === 0 && zoomedFloor.state && zoomedFloor.name && zoomedFloor.close && zoomedFloor.splits, `fix 237: zoomed, the title has its parts and buttons back, got ${JSON.stringify(zoomedFloor)}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(floorSel + ' .pane-zoom')}).click()`);
    await s.waitFor(`!document.querySelector('.splitview.zoomed')`, 'the zoom button unzoomed');
    const unzoomedFloor = await floorRead();
    expect(unzoomedFloor.level === 7 && unzoomedFloor.width === narrowestFloor.width, `fix 237: unzoomed, the sliver is back at its last level, got ${JSON.stringify(unzoomedFloor)}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(floorSel + ' .pane-shade-toggle')}).click()`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(floorSel + ' .pane-shade')})`, 'the shade button shaded the sliver');
    const shadedFloor = await floorRead();
    expect(shadedFloor.level === 7 && shadedFloor.zoom && shadedFloor.shade, `fix 237: the shaded sliver's title keeps the zoom and the shade at its last level, got ${JSON.stringify(shadedFloor)}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(floorSel + ' .pane-shade-toggle')}).click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(floorSel + ' .pane-shade')})`, 'the shade button lifted it');
    await s.screenshot('m9-fix237-floor.png');
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: rootRatioBefore } } });
    await s.waitFor(`Math.abs(document.querySelector(${JSON.stringify(sqTitleSel)}).getBoundingClientRect().width - ${initialTitle.width}) < 4`, 'the left pane back at its width after the floor walk');
    const backFloor = await titleRead();
    expect(backFloor.level === initialTitle.level, `back at ${Math.round(backFloor.width)}px the title is at level ${initialTitle.level} again, got ${JSON.stringify(backFloor)}`);
    step(`M9 fix 237: the state gone from ${stateGoneAt.width}px (level ${stateGoneAt.level}), the name from ${nameGoneAt.width}px (level ${nameGoneAt.level}), hide and close from ${closeGoneAt.width}px (level ${closeGoneAt.level}); at ${narrowestFloor.width}px the mark, the zoom and the shade stay, the zoom gives the pane the tab and back, the shade pulls and lifts`);
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, dropPane, parkedInDrop) } });
    await zreq(s, 'session.kill', { sessionId: squeezed.id, remove: true });
    await s.waitFor(`!document.querySelector(${JSON.stringify(sqRowSel)})`, 'the squeezed session gone');
  });


  await block('m39', async () => {
    // M39: the line under the working row (the title's text here) carries
    // the sheen, since fix 535 a band on the line's ::after over plain ink
    // (turn-band, a transform on the compositor); the name has none.
    const sheenOf = (sel) =>
      s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const cs = getComputedStyle(el); const band = getComputedStyle(el, '::after'); return { layers: cs.backgroundImage === 'none' ? 0 : cs.backgroundImage.split('linear-gradient').length - 1, animation: band.animationName, own: cs.animationName, color: cs.color, size: band.width }; })()`);
    const sheen = await sheenOf(`${rowSel} .sidebar-row-agent`);
    expect(sheen !== null && sheen.layers === 0 && sheen.animation === 'turn-band' && sheen.color !== 'rgba(0, 0, 0, 0)', `the working row's line has the band over its plain ink, got ${JSON.stringify(sheen)}`);
    expect(sheen.size === '170px', `the band is 170px in the default sidebar, got ${sheen.size}`);
    expect(!(await s.evalJs(`[...document.styleSheets].some((sh) => [...sh.cssRules].some((r) => r instanceof CSSKeyframesRule && r.name === 'turn-sheen'))`)), 'no turn-sheen keyframes are left in the sheet (fix 535)');
    const nameSheen = await sheenOf(`${rowSel} .sidebar-row-name`);
    expect(nameSheen.layers === 0 && nameSheen.animation === 'none', `the name has no band, got ${JSON.stringify(nameSheen)}`);
    // Fix 86's paint read again for the band (fix 535): a composited transform under an overflow clip is the shape one GPU once never redrew.
    const bandPaint = async () => {
      const r = await s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(rowSel + ' .sidebar-row-agent')}).getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
      return (await s.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 2 }, fromSurface: true })).data;
    };
    const bandA = await bandPaint();
    // The band is on the line for only part of its 2.6 s pass, so a pair 300 ms apart can both catch bare ink; the captures run across one whole cycle and any that differs from the first proves it draws.
    let bandMoved = false;
    for (let i = 0; i < 9 && !bandMoved; i++) { await sleep(300); bandMoved = (await bandPaint()) !== bandA; }
    expect(bandMoved, 'the band moves: a capture of the working line within one cycle differs from the first (fix 535, after fix 86)');
    step("M39: the working row's line has the turn-band on its ::after over plain ink and the name none, and what is painted moves");

    // M40, the turn lines. Under the sub line the row has two lines sharing
    // one 6px marker column: the prompt behind › and the agent line behind a
    // marker for the state, here the dot of a working session with no glyph
    // in its title, breathing on live-dot; the agent line is the title's
    // text (M33), the sheen is on that text and not on the marker.
    const turnLines = () =>
      s.evalJs(`(() => {
      const lines = [...document.querySelectorAll(${JSON.stringify(rowSel + ' .sidebar-row-line')})];
      return lines.map((l) => {
        const m = l.querySelector('.sidebar-row-marker');
        const dot = m.querySelector('.sidebar-row-marker-dot');
        const r = m.getBoundingClientRect();
        return { marker: m.textContent, tone: m.dataset.tone ?? null, left: r.left, width: r.width, dot: dot !== null, anim: getComputedStyle(dot ?? m).animationName, text: (l.querySelector('.sidebar-row-prompt') ?? l.querySelector('.sidebar-row-agent'))?.textContent ?? null };
      });
    })()`);
    const lines = await turnLines();
    expect(lines.length === 2, `two turn lines on the working row, got ${JSON.stringify(lines)}`);
    expect(lines[0].marker === '›' && lines[0].text === 'find the hash', `the prompt line behind ›, got ${JSON.stringify(lines[0])}`);
    expect(lines[1].dot && lines[1].tone === 'working' && lines[1].anim === 'live-dot' && lines[1].text === shellTitle, `the agent line behind the working dot, breathing, with the title's text, got ${JSON.stringify(lines[1])}`);
    expect(lines[0].width === 6 && lines[1].width === 6 && lines[0].left === lines[1].left, `both markers in one 6px column, got ${JSON.stringify(lines.map((l) => [l.left, l.width]))}`);
    const markerSheen = await sheenOf(`${rowSel} .sidebar-row-turn .sidebar-row-marker`);
    expect(markerSheen.layers === 0 && markerSheen.color !== 'rgba(0, 0, 0, 0)', `the marker keeps its own ink, got ${JSON.stringify(markerSheen)}`);
    step(`M40: two turn lines, › and the working dot in one column at x ${lines[0].left}, the sheen on the agent text only`);

    await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(dropped.id)}, data: 'Write-Host "$([char]27)]2;\\u25d0 Git log hash$([char]7)"' + String.fromCharCode(13) })`);
    // Fix 59: the title's glyph no longer takes the mark's place; the row
    // keeps its pulse and its mark, the glyph stays in the raw title.
    await waitName(workingPane, 'Git log hash', 'the pane title takes the conversation title as the name');
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.working`)) === 'pulse', 'the row still pulses under a titled turn (fix 59)');
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel + ' .session-mark')})?.dataset.working`)) === 'true', 'the mark stays on the row, stepping');
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(workingPane)}] .pane-mark`)})?.dataset.working`)) === 'true', 'and in the pane title');
    expect((await s.evalJs(`!!document.querySelector(${JSON.stringify(rowSel + ' .sidebar-row-glyph')})`)) === false, 'no glyph span on the row');
    // Fix 34: the session is bound (the SessionStart above) and nobody named
    // it, so the title's text becomes its name, and the third line, which
    // would say the same thing twice, keeps the last turn instead.
    expect((await rowName(dropped.id)) === 'Git log hash', 'and so does the row');
    expect((await s.evalJs(`!!document.querySelector(${JSON.stringify(rowSel + ' .sidebar-row-activity')})`)) === false, 'the agent line does not repeat the name');
    expect((await rowText(dropped.id, '.sidebar-row-prompt')) === 'find the hash' && (await rowText(dropped.id, '.sidebar-row-agent')) === '', 'the prompt line keeps the prompt and the agent line, with no reply and no transcript text yet, is empty behind its marker (M47)');
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(paneStateSel)})?.textContent`)) === 'working', 'the pane state text is the word alone, no glyph');
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(paneStateSel)})?.dataset.working`)) === 'pulse', 'and carries data-working');
    expect((await s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(paneStateSel)})).animationName`)) === 'none', 'the state word sits still, the mark being the one motion (M46)');
    const titledMarker = await s.evalJs(`(() => { const m = document.querySelector(${JSON.stringify(rowSel + ' .sidebar-row-turn .sidebar-row-marker')}); return { dot: !!m?.querySelector('.sidebar-row-marker-dot'), text: m?.textContent ?? null }; })()`);
    expect(titledMarker.dot && titledMarker.text === '', `the agent line's marker is the dot, not the title's glyph, got ${JSON.stringify(titledMarker)}`);
    const titled = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === dropped.id);
    expect(titled.title === '◐ Git log hash', `session.list has the raw title, got ${titled.title}`);
    // M9 fix 158: the agent line is blank here (the title says the name, no
    // reply, no tool, no last turn), so Claude Code's spinner word fills
    // it. The shell writes the line as Claude Code draws it, a glyph, the
    // word and the ellipsis at the start of a line; the daemon reads the
    // word off the stream, the latest of a burst, and the line shows it.
    const writeSpinner = (word) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(dropped.id)}, data: 'Write-Host "$([char]10)$([char]0x2736) ' + ${JSON.stringify(word)} + '$([char]0x2026) (esc to interrupt)"' + String.fromCharCode(13) })`);
    await writeSpinner('Grinding');
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .sidebar-row-agent')})?.textContent === 'Grinding'`, "the spinner word fills the blank agent line", 10000);
    expect((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === dropped.id).liveVerb === 'Grinding', 'session.list carries the word (level 38)');
    await writeSpinner('Discombobulating');
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .sidebar-row-agent')})?.textContent === 'Discombobulating'`, 'the latest word wins', 10000);
    expect((await rowText(dropped.id, '.sidebar-row-prompt')) === 'find the hash', 'the prompt line is untouched');
    expect((await rowName(dropped.id)) === 'Git log hash', 'and so is the name');
    step('M9 fix 158: the spinner word off the stream fills an empty agent line, the latest of two');
    await s.screenshot('m9-fixes-working.png');
    await postTo({ hook_event_name: 'Stop', last_assistant_message: 'It is 9e2293b.' });
    // The dropped shell sits in the focused pane, so when the harness window
    // holds focus and a key landed in the last ten seconds (M9 fix 30) the
    // pane acks done to idle at once; either says the turn ended.
    await s.waitFor(`['done', 'idle'].includes(document.querySelector(${JSON.stringify(rowSel)})?.dataset.state)`, 'the row is done');
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.working ?? null`)) === null, 'no motion once the turn ends');
    expect((await rowText(dropped.id, '.sidebar-row-prompt')) === 'find the hash' && (await rowText(dropped.id, '.sidebar-row-agent')) === 'It is 9e2293b.', 'the reply is on the agent line under the prompt');
    const endMarker = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel)}); const m = r.querySelector('.sidebar-row-turn .sidebar-row-marker'); return { state: r.dataset.state, glyph: m?.textContent ?? null, anim: m === null ? null : getComputedStyle(m).animationName }; })()`);
    expect((endMarker.state === 'done' && endMarker.glyph === '✓') || (endMarker.state === 'idle' && endMarker.glyph === '·'), `the marker follows the state once the turn ends (M40), got ${JSON.stringify(endMarker)}`);
    expect(endMarker.anim === 'none', `and sits still, got ${JSON.stringify(endMarker)}`);
    const idleSheen = await sheenOf(`${rowSel} .sidebar-row-agent`);
    expect(idleSheen.layers === 0 && idleSheen.animation === 'none' && idleSheen.color !== 'rgba(0, 0, 0, 0)', `no band once the turn ends, got ${JSON.stringify(idleSheen)}`);
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel + ' .session-mark')})?.dataset.working ?? null`)) === null, 'and the mark sits still');
    step('an OSC 2 title from the shell: its text as the name, the mark and the pulse kept (fix 59), the last turn on the two lines');

    // Fix 34, the auto name. A name typed in holds against the next title,
    // and while it holds the third line shows that title's text (M33) since
    // the name no longer does; an empty rename takes the title at once; a
    // shell with no Claude bound keeps its folder whatever it puts in its
    // title; and SessionEnd puts the name back on the folder.
    const writeTitle = (id, text) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(id)}, data: 'Write-Host "$([char]27)]2;' + ${JSON.stringify(text)} + '$([char]7)"' + String.fromCharCode(13) })`);
    const waitTitle = (id, title) => s.waitFor(`(async () => (await window.emerald.request('session.list', {})).sessions.find(x => x.id === ${JSON.stringify(id)})?.title === ${JSON.stringify(title)})()`, `title ${title} on the daemon`, 10000);
    await chooseMenu(s, workingPane, 'Rename session');
    await s.waitFor(`document.activeElement?.className === 'pane-rename'`, 'rename box for the titled session');
    await s.type('mine');
    await s.key('Enter', 'Enter', 13);
    await waitName(workingPane, 'mine', 'the typed name shows');
    await postTo({ hook_event_name: 'UserPromptSubmit', prompt: 'second question' });
    await writeTitle(dropped.id, '\u25d1 Second name');
    await waitTitle(dropped.id, '◑ Second name');
    expect((await nameOf(workingPane)) === 'mine', 'a chosen name holds against the next title');
    expect((await rowName(dropped.id)) === 'mine', 'on the row too');
    await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .sidebar-row-activity .sidebar-row-agent')})?.textContent === 'Second name'`, 'the agent line shows the title while the name says something else');
    expect((await turnCardTitle(dropped.id)) === '◑ Second name', 'with the raw title on the turn card (M73, once the tooltip)');
    // M73 task 4: the pane title's state word opens the same card, its
    // first line the state, with the terminal title on it, and carries no
    // title attribute.
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(paneStateSel)}).getAttribute('title')`)) === null, 'the pane state word carries no title tooltip');
    const stateAt = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(paneStateSel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: stateAt.x, y: stateAt.y });
    const stateCardSel = `.turn-popover[data-session-id=${JSON.stringify(dropped.id)}]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(stateCardSel)})`, "the state word opens the turn card", 3000);
    const stateCard = await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(stateCardSel)}); const part = (p) => c.querySelector('[data-part=' + JSON.stringify(p) + ']'); return { state: part('state')?.querySelector('.turn-card-label')?.textContent ?? null, title: part('title')?.querySelector('.turn-card-text')?.textContent ?? null, prompt: part('prompt')?.querySelector('.turn-card-text')?.textContent ?? null }; })()`);
    expect(stateCard.state === 'working' && stateCard.title === '◑ Second name' && stateCard.prompt === 'second question', `the card leads with the state and carries the title and the prompt, got ${JSON.stringify(stateCard)}`);
    await s.click(stateAt.x, stateAt.y);
    await s.waitFor(`document.querySelector(${JSON.stringify(paneStateSel)}).dataset.popoverOpen === 'pinned'`, 'a click on the word pins the card');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector(${JSON.stringify(stateCardSel)})`, 'Escape closes it');
    step('M73 task 4: the pane title\'s state word opens the turn card, the state first, the terminal title and the prompt on it, pinned by a click, no title attribute');
    await postTo({ hook_event_name: 'Stop', last_assistant_message: 'Second answer.' });
    await s.waitFor(`['done', 'idle'].includes(document.querySelector(${JSON.stringify(rowSel)})?.dataset.state)`, 'the second turn ended');
    await chooseMenu(s, workingPane, 'Rename session');
    await s.waitFor(`document.activeElement?.className === 'pane-rename'`, 'rename box again');
    await s.key('Backspace', 'Backspace', 8);
    await s.key('Enter', 'Enter', 13);
    await waitName(workingPane, 'Second name', 'an empty name takes the title at once');
    expect((await rowName(dropped.id)) === 'Second name', 'on the row too');
    const savedName = await savedRecord(dropped.id, (r) => r.name === 'Second name');
    expect(savedName?.name === 'Second name' && savedName.autoName === true, 'sessions.json has the title name and says it is automatic');
    // A shell of its own: the first live one with no Claude bound.
    const plain = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id !== dropped.id && x.claudeSessionId === null && x.state !== 'exited' && x.autoName);
    expect(plain !== undefined, 'a plain shell to write a title into');
    await writeTitle(plain.id, 'C:\\somewhere\\else');
    await waitTitle(plain.id, 'C:\\somewhere\\else');
    expect((await rowName(plain.id)) === plain.name, `a shell's own title leaves its name alone, still ${plain.name}`);
    await postTo({ hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    const folderOfDropped = path.basename((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === dropped.id).cwd);
    await waitName(workingPane, folderOfDropped, 'SessionEnd hands the name back to the folder');
    expect((await rowName(dropped.id)) === folderOfDropped, 'on the row too');
    step('fix 34: a typed name holds against a title, an empty one takes it, a shell keeps its folder, SessionEnd goes back to the folder');
  });

  await block('m32', async () => {
    // M32, the order. Two shells in a folder of their own, X then Y. Y goes
    // needs-input and stays under X, since rows sit where they were made;
    // Order: by state from the heading's right-click menu puts Y on top, the
    // choice lands in localStorage, and Order: as created puts it back.
    // The long form: the temp dir comes back as ZACHAR~1 and the shell's
    // prompt reports the real name, which is what the group is keyed on.
    const orderDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-m32-')));
    const { session: x } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: orderDir, cols: 120, rows: 30 });
    const { session: y } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: orderDir, cols: 120, rows: 30 });
    const groupSel = `.sidebar-group[data-group=${JSON.stringify(orderDir)}]`;
    const groupRows = () => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(`${groupSel} .sidebar-row`)})].map(r => r.dataset.sessionId)`);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(`${groupSel} .sidebar-row`)}).length === 2`, 'both shells listed under their folder');
    expect(JSON.stringify(await groupRows()) === JSON.stringify([x.id, y.id]), 'X above Y, as created');
    expect((await s.evalJs(`document.querySelector('.sidebar-header').dataset.order`)) === 'created', 'the header says the order is as created');
    const daemonNow = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
    const postHook = async (sessionId, payload) => {
      const res = await fetch(`http://127.0.0.1:${daemonNow.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemonNow.hookToken, 'X-Emerald-Session': sessionId },
        body: JSON.stringify({ session_id: 'sim-' + sessionId.slice(0, 8), cwd: 'C:/sim', ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postHook(y.id, { hook_event_name: 'UserPromptSubmit', prompt: 'run it' });
    await postHook(y.id, { hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(y.id)}]')?.dataset.state === 'needs-input'`, 'Y needs input');
    await sleep(300);
    expect(JSON.stringify(await groupRows()) === JSON.stringify([x.id, y.id]), 'Y stays under X when it needs input');
    // M40: a question's marker is ? in the row's teal, breathing on the
    // needs-input pulse; with no reply and no transcript text yet the
    // agent line was empty behind it (M47), and since M55 it says what is
    // waited on: a permission with no tool call seen is "Allow? a tool call".
    const yMarker = await s.evalJs(`(() => { const m = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(y.id)}] .sidebar-row-turn .sidebar-row-marker'); return m === null ? null : { glyph: m.textContent, tone: m.dataset.tone, anim: getComputedStyle(m).animationName, color: getComputedStyle(m).color, text: m.nextElementSibling?.textContent ?? null, textColor: getComputedStyle(m.nextElementSibling).color }; })()`);
    expect(yMarker !== null && yMarker.glyph === '?' && yMarker.tone === 'needs-input' && yMarker.anim === 'needs-pulse' && yMarker.text === 'Allow? a tool call' && yMarker.color === yMarker.textColor, `the needs-input marker is ? on the needs-pulse with the waited-on phrase beside it (M47, M55), got ${JSON.stringify(yMarker)}`);

    // The heading rolls the state up (M32) for its pulse: data-rollup says
    // needs-input, and the heading pulses in the row's place once the group
    // is folded (fix 69) until a click in the window, which clears the pulse. The dot and the "1 needs input" count
    // came off with M46, since the pulse says attention; the heading's
    // units say what is under it instead, here one shell at its prompt (X)
    // and one inactive agent (Y, a shell running Claude and blocked).
    const heading = () =>
      s.evalJs(
        `(() => { const h = document.querySelector(${JSON.stringify(`${groupSel} .sidebar-group-title`)}); const units = {}; for (const u of h.querySelectorAll('.roster-unit')) units[u.dataset.unit] = Number(u.querySelector('.roster-count').textContent); return { rollup: h.dataset.rollup ?? null, count: h.dataset.rollupCount ?? null, attention: h.dataset.attention ?? null, text: h.querySelector('.sidebar-group-count')?.textContent ?? null, dot: !!h.querySelector('.sidebar-group-dot'), anim: getComputedStyle(h).animationName, units }; })()`,
      );
    let h = await heading();
    expect(h.rollup === 'needs-input' && h.count === '1' && h.text === null && !h.dot, `the heading carries the rollup on its attributes and shows no dot or count, got ${JSON.stringify(h)}`);
    expect(JSON.stringify(h.units) === JSON.stringify({ 'agents-inactive': 1, 'shells-idle': 1 }), `the heading's units: one inactive agent and one shell at its prompt, got ${JSON.stringify(h.units)}`);
    // M9 fix 69: one pulse per place. The heading does not pulse while its
    // rows are on view; folded, it pulses in the row's place.
    expect(h.attention === null && h.anim === 'none', `the open heading does not pulse beside its row (fix 69), got ${JSON.stringify(h)}`);
    const foldGroup = async (want) => {
      await s.evalJs(`document.querySelector(${JSON.stringify(`${groupSel} .sidebar-group-fold`)}).click()`);
      await s.waitFor(`(document.querySelector(${JSON.stringify(groupSel)})?.dataset.folded === 'true') === ${want}`, want ? 'the group folds' : 'the group unfolds');
    };
    await foldGroup(true);
    await s.waitFor(`document.querySelector(${JSON.stringify(`${groupSel} .sidebar-group-title`)})?.dataset.attention === 'needs-input'`, 'the folded heading pulses');
    h = await heading();
    expect(h.attention === 'needs-input' && h.anim === 'attention-pulse', `the folded heading pulses in the row's place, got ${JSON.stringify(h)}`);
    expect(JSON.stringify(h.units) === JSON.stringify({ 'agents-inactive': 1, 'shells-idle': 1 }), `the folded heading keeps its units, got ${JSON.stringify(h.units)}`);
    // The dropped shell's group (home, as the shell spells it) is all idle.
    const homeHeading = await s.evalJs(`(() => { const h = document.querySelector(${JSON.stringify(rowSel)}).closest('.sidebar-group').querySelector('.sidebar-group-title'); return { rollup: h.dataset.rollup ?? null, dot: !!h.querySelector('.sidebar-group-dot') }; })()`);
    expect(homeHeading.rollup === null && !homeHeading.dot, 'a group with nothing to act on carries no rollup');
    await s.screenshot('m9-fixes-rollup.png');
    // M9 fix 189: a click in the focused pane, which shows another
    // session, is not a look at Y: its pulse stays (the folded heading
    // keeps pulsing for it) and only its chime is hushed. Unfolded, the
    // row carries the hush button of fix 190 in the hushed state, X's row
    // none, and a press on Y's own row (a right click on its name, a
    // mousedown inside the row that opens the row menu and no chooser) is
    // what acks it.
    const focusedTerm = await centerOf(s, '.pane.focused .term-host');
    await s.click(focusedTerm.x, focusedTerm.y);
    await sleep(400);
    h = await heading();
    expect(h.attention === 'needs-input' && h.anim === 'attention-pulse', `a click in another pane leaves the folded heading pulsing (fix 189), got ${JSON.stringify(h)}`);
    await foldGroup(false);
    expect(JSON.stringify(await groupRows()) === JSON.stringify([x.id, y.id]), 'the rows are back once unfolded');
    const hushOf = (id) => s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]'); const b = r?.querySelector('.sidebar-row-hush') ?? null; return { row: r?.dataset.hushed ?? null, button: b === null ? null : (b.dataset.hushed ?? 'shown') }; })()`);
    expect(JSON.stringify(await hushOf(y.id)) === JSON.stringify({ row: 'true', button: 'true' }), `Y's row is hushed and its hush button shows it (fix 190), got ${JSON.stringify(await hushOf(y.id))}`);
    expect(JSON.stringify(await hushOf(x.id)) === JSON.stringify({ row: null, button: null }), `X's quiet row has no hush button, got ${JSON.stringify(await hushOf(x.id))}`);
    const yName = await centerOf(s, `.sidebar-row[data-session-id=${JSON.stringify(y.id)}] .sidebar-row-name`);
    await s.rightClick(yName.x, yName.y);
    await s.waitFor(`!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(y.id)}]').dataset.attention`, 'a press on its own row acks Y');
    await s.waitFor(`!!document.querySelector('.row-menu')`, 'the row menu opened on the press');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.row-menu')`, 'the row menu closed');
    h = await heading();
    expect(h.attention === null && h.anim === 'none' && h.rollup === 'needs-input' && h.count === '1', `the rollup stays on the attributes after the acknowledge, got ${JSON.stringify(h)}`);
    expect(JSON.stringify(await hushOf(y.id)) === JSON.stringify({ row: null, button: null }), `the hush and its button went with the pulse, got ${JSON.stringify(await hushOf(y.id))}`);
    step('M32 rollup: the heading carried needs-input on its attributes with its units reading one inactive agent and one idle shell, pulsed in place of the row once folded (fix 69), kept pulsing through a click in another pane (fix 189) with the hush button on the row (fix 190), and kept the rollup after the press on the row');
    const orderItems = () => s.evalJs(`[...document.querySelectorAll('.order-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent + (b.querySelector('.menu-hint') ? ' (' + b.querySelector('.menu-hint').textContent + ')' : ''))`);
    const pickOrder = async (label) => {
      const header = await centerOf(s, '.sidebar-header');
      await s.rightClick(header.x, header.y);
      await s.waitFor(`!!document.querySelector('.order-menu')`, 'the order menu');
      await s.evalJs(`[...document.querySelectorAll('.order-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
      await s.waitFor(`!document.querySelector('.order-menu')`, 'the order menu closed');
    };
    const header0 = await centerOf(s, '.sidebar-header');
    await s.rightClick(header0.x, header0.y);
    await s.waitFor(`!!document.querySelector('.order-menu')`, 'the order menu');
    expect(JSON.stringify(await orderItems()) === JSON.stringify(['Order: as created (current)', 'Order: by state']), `the two orders with the current one marked, got ${JSON.stringify(await orderItems())}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.order-menu')`, 'Escape closed it');
    await pickOrder('Order: by state');
    await s.waitFor(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${groupSel} .sidebar-row`)})].map(r => r.dataset.sessionId)) === ${JSON.stringify(JSON.stringify([y.id, x.id]))}`, 'by state: Y on top');
    expect((await s.evalJs(`localStorage.getItem('emerald.sidebarOrder')`)) === 'state', 'the choice is in localStorage');
    expect((await s.evalJs(`document.querySelector('.sidebar-header').dataset.order`)) === 'state', 'the header says by state');
    expect((await s.evalJs(`[...document.querySelectorAll('.sidebar-group')].map(g => g.dataset.group)[0]`)) === orderDir, 'the group with the blocked session leads by state');
    await s.screenshot('m9-fixes-order.png');
    await pickOrder('Order: as created');
    await s.waitFor(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(`${groupSel} .sidebar-row`)})].map(r => r.dataset.sessionId)) === ${JSON.stringify(JSON.stringify([x.id, y.id]))}`, 'as created: X on top again');
    expect((await s.evalJs(`localStorage.getItem('emerald.sidebarOrder')`)) === 'created', 'and localStorage says so');
    step('M32 order: a needs-input row stayed put, Order: by state moved it up and the setting persisted, as created put it back');

    // The count follows the sessions: X blocked too makes it 2 need input;
    // Y finishing leaves X's needs-input on top, since done ranks lower.
    await postHook(x.id, { hook_event_name: 'UserPromptSubmit', prompt: 'run it too' });
    await postHook(x.id, { hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    await s.waitFor(`document.querySelector(${JSON.stringify(`${groupSel} .sidebar-group-title`)})?.dataset.rollupCount === '2'`, '2 need input on the rollup attributes');
    expect(JSON.stringify((await heading()).units) === JSON.stringify({ 'agents-inactive': 2 }), `both are inactive agents now, got ${JSON.stringify((await heading()).units)}`);
    await postHook(y.id, { hook_event_name: 'UserPromptSubmit', prompt: 'y' });
    await postHook(y.id, { hook_event_name: 'Stop', last_assistant_message: 'Ran it.' });
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(y.id)}]')?.dataset.state === 'done'`, 'Y done');
    await s.waitFor(`(() => { const h = document.querySelector(${JSON.stringify(`${groupSel} .sidebar-group-title`)}); return h?.dataset.rollup === 'needs-input' && h.dataset.rollupCount === '1'; })()`, 'back to 1 needs input, the done session ranks under it');
    expect(JSON.stringify(await groupRows()) === JSON.stringify([x.id, y.id]), 'and neither row moved');
    step('M32 rollup: the count followed X blocking and Y finishing');

    // M73 task 1: the row's prompt, turn and comment lines open the turn
    // card in place of their title tooltips. Y's turn is `y` and `Ran it.`
    // (both hooks above); a hover on the prompt line past the delay opens
    // the card with the two labelled blocks, each timed, a click pins it,
    // Escape closes it, and none of the three lines carries a title.
    const ySel = `.sidebar-row[data-session-id=${JSON.stringify(y.id)}]`;
    const turnCardSel = `.turn-popover[data-session-id=${JSON.stringify(y.id)}]`;
    const hoverLine = async (selector) => {
      const c = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 }; })()`);
      expect(c !== null, `a line to hover at ${selector}`);
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
      return c;
    };
    const readTurnCard = () =>
      s.evalJs(
        `(() => { const c = document.querySelector(${JSON.stringify(turnCardSel)}); if (!c) return null; const part = (p) => { const el = c.querySelector('[data-part=' + JSON.stringify(p) + ']'); return el ? { label: el.querySelector('.turn-card-label').textContent, text: el.querySelector('.turn-card-text').textContent, time: el.querySelector('.turn-card-time')?.textContent ?? null } : null; }; return { checkpoint: part('checkpoint'), phase: part('phase'), prompt: part('prompt'), reply: part('reply'), title: part('title') }; })()`,
      );
    await zreq(s, 'session.set', { sessionId: y.id, comment: 'halfway', phase: 'in-progress' });
    await s.waitFor(`!!document.querySelector(${JSON.stringify(ySel + ' .sidebar-row-comment')})`, "Y's comment line");
    expect((await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(ySel + ' .sidebar-row-prompt-line, ' + ySel + ' .sidebar-row-comment')})].map((l) => l.getAttribute('title'))`)).every((t) => t === null), 'the prompt and comment lines carry no title tooltip; the card is the tooltip');
    await sleep(600);
    const promptAt = await hoverLine(ySel + ' .sidebar-row-prompt-line');
    await s.waitFor(`!!document.querySelector(${JSON.stringify(turnCardSel)})`, 'the turn card opens on a hover over the prompt line', 3000);
    const turnCard = await readTurnCard();
    expect(turnCard.prompt?.label === 'You' && turnCard.prompt.text === 'y', `the prompt block says You: y, got ${JSON.stringify(turnCard.prompt)}`);
    expect(turnCard.reply?.label === 'Claude' && turnCard.reply.text === 'Ran it.', `the reply block says Claude: Ran it., got ${JSON.stringify(turnCard.reply)}`);
    expect(turnCard.prompt.time !== null && turnCard.reply.time !== null && /\d/.test(turnCard.prompt.time), `each block carries the clock time it landed, got ${JSON.stringify([turnCard.prompt.time, turnCard.reply.time])}`);
    expect(turnCard.checkpoint?.text === 'halfway' && turnCard.phase?.text === 'in-progress', `the checkpoint and the phase sit above the turn, got ${JSON.stringify([turnCard.checkpoint, turnCard.phase])}`);
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(ySel + ' .sidebar-row-prompt-line')}).dataset.popoverOpen`)) === 'hover', 'the line says the card is open on hover');
    await s.click(promptAt.x, promptAt.y);
    await s.waitFor(`document.querySelector(${JSON.stringify(ySel + ' .sidebar-row-prompt-line')}).dataset.popoverOpen === 'pinned'`, 'a click pins the card');
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await sleep(400);
    expect((await readTurnCard()) !== null, 'a pinned card stays when the mouse leaves');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector(${JSON.stringify(turnCardSel)})`, 'Escape closes the card');
    // The comment line opens the same card.
    await hoverLine(ySel + ' .sidebar-row-comment');
    await s.waitFor(`!!document.querySelector(${JSON.stringify(turnCardSel)})`, 'the comment line opens the turn card', 3000);
    expect((await readTurnCard()).checkpoint?.text === 'halfway', "the comment line's card is the same card");
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector(${JSON.stringify(turnCardSel)})`, 'the card closes after the mouse leaves an unpinned card');
    // Without the comment the turn line stands in its place and opens it too, no title on it either.
    await zreq(s, 'session.set', { sessionId: y.id, comment: null, phase: null });
    await s.waitFor(`!!document.querySelector(${JSON.stringify(ySel + ' .sidebar-row-turn')})`, "Y's turn line is back");
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(ySel + ' .sidebar-row-turn')}).getAttribute('title')`)) === null, 'the turn line carries no title tooltip');
    await hoverLine(ySel + ' .sidebar-row-turn');
    await s.waitFor(`!!document.querySelector(${JSON.stringify(turnCardSel)})`, 'the turn line opens the turn card', 3000);
    const turnCard2 = await readTurnCard();
    expect(turnCard2.checkpoint === null && turnCard2.phase === null && turnCard2.reply?.text === 'Ran it.', `no checkpoint or phase on the card now, got ${JSON.stringify(turnCard2)}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector(${JSON.stringify(turnCardSel)})`, 'the turn card closes');
    step('M73 task 1: the prompt, turn and comment lines open the turn card with You and Claude blocks, timed, the checkpoint and phase above; a click pins, Escape closes, no title on any of the three');

    // Fix 27, the name keeps a floor. X is needs input: permission, the
    // longest badge. The sidebar is dragged from 260 to 200px by its
    // resizer, where the badge must have given up its detail before the
    // name went under eight characters; since M9 fix 123 the line drops
    // the reason whole (data-squeeze 1 on the main line, the reason span
    // unrendered) instead of cutting it with an ellipsis, so at 200px the
    // badge reads `needs input` whole. Fix 27's rules still stand on the
    // full badge (read on a probe outside the squeezed line) for the
    // errored badge and for a needs-input line at level 0; then dragged
    // back so the later steps see the default width. The pane title's
    // rules are read on a probe badge, since X is off screen. dragSidebar
    // and sidebarWidthNow are shared helpers, above the first block.
    const widthBefore = await sidebarWidthNow();
    await dragSidebar(200 - widthBefore);
    await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === 200`, 'the sidebar at 200px');
    const xRowSel = `.sidebar-row[data-session-id=${JSON.stringify(x.id)}]`;
    const narrow = await s.evalJs(`(() => {
    const row = document.querySelector(${JSON.stringify(xRowSel)});
    const main = row.querySelector('.sidebar-row-main');
    const name = row.querySelector('.sidebar-row-name');
    const badge = row.querySelector('.sidebar-row-state');
    const reason = badge.querySelector('.sidebar-row-reason');
    const nameStyle = getComputedStyle(name);
    const probe = badge.cloneNode(true);
    row.appendChild(probe);
    const rules = getComputedStyle(probe);
    const out = {
      level: main.dataset.squeeze ?? null,
      badgeText: badge.innerText,
      reasonShown: reason !== null && reason.getClientRects().length > 0,
      badgeWidth: badge.getBoundingClientRect().width,
      badgeScroll: badge.scrollWidth,
      ruleFloor: parseFloat(rules.minWidth),
      ruleShrink: rules.flexShrink,
      ruleOverflow: rules.overflow,
      nameWidth: name.getBoundingClientRect().width,
      nameFloor: parseFloat(nameStyle.minWidth),
      nameShrink: nameStyle.flexShrink,
      nameBasis: nameStyle.flexBasis,
    };
    probe.remove();
    return out;
  })()`);
    expect(narrow.level === '1' && narrow.badgeText === 'needs input' && !narrow.reasonShown, `at 200px the line dropped the reason (M9 fix 123), got ${JSON.stringify(narrow)}`);
    expect(narrow.ruleShrink === '100' && narrow.ruleOverflow === 'hidden' && narrow.ruleFloor > 60, `the full badge can give up its detail (fix 27), got ${JSON.stringify(narrow)}`);
    expect(narrow.badgeScroll <= narrow.badgeWidth + 1, `at 200px the two-word badge is whole, got ${JSON.stringify(narrow)}`);
    expect(narrow.nameWidth >= narrow.nameFloor - 0.5 && narrow.nameFloor > 40, `the name keeps its eight-character floor, got ${JSON.stringify(narrow)}`);
    expect(narrow.nameShrink === '1' && narrow.nameBasis === 'auto', `the name shares the short row by weight, got ${JSON.stringify(narrow)}`);
    // The word must be whole: the floor is wider than the word plus the
    // ellipsis, measured on a clone that holds the word alone.
    const wordWidth = await s.evalJs(`(() => {
    const badge = document.querySelector(${JSON.stringify(xRowSel + ' .sidebar-row-state')});
    const probe = badge.cloneNode(false);
    probe.textContent = 'needs input\\u2026';
    probe.style.minWidth = '0';
    probe.style.flex = 'none';
    badge.parentElement.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    probe.remove();
    return w;
  })()`);
    expect(wordWidth <= narrow.ruleFloor, `the floor holds the word and the ellipsis, ${wordWidth} in ${narrow.ruleFloor}`);
    const titleRules = await s.evalJs(`(() => {
    const title = document.querySelector('.pane-title');
    const name = getComputedStyle(title.querySelector('.pane-name'));
    const probe = document.createElement('span');
    probe.className = 'pane-state state-needs-input';
    probe.textContent = 'needs input: permission';
    title.appendChild(probe);
    const badge = getComputedStyle(probe);
    const out = { nameFloor: parseFloat(name.minWidth), badgeFloor: parseFloat(badge.minWidth), badgeShrink: badge.flexShrink, badgeOverflow: badge.overflow };
    probe.remove();
    return out;
  })()`);
    // The pane's badge shrinks at the title's state weight, 20 since fix
    // 56 (the row's stays 100); the floors are the same as the row's.
    expect(titleRules.nameFloor > 40 && titleRules.badgeFloor > 60 && titleRules.badgeShrink === '20' && titleRules.badgeOverflow === 'hidden', `the pane title has the same floors, got ${JSON.stringify(titleRules)}`);
    await dragSidebar(widthBefore - 200);
    await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === ${widthBefore}`, 'the sidebar back at its width');
    step('fix 27: at 200px the needs-input badge gives up its detail (whole, since fix 123) and the name keeps eight characters');

    // Fix 51, a short name gives its slack to the badge. Back at the
    // default width, X renamed to `sim` beside the same badge: the floor
    // was on the box, so a three-letter name held eight characters of
    // empty room while the badge lost its detail. The floor is now the
    // smaller of 8ch and the name's own length, so the box sits on the
    // text (a Range measures the letters) and the badge gets the room. The
    // rename is undone so the folder name is back for the later steps.
    await zreq(s, 'session.rename', { sessionId: x.id, name: 'sim' });
    await s.waitFor(`document.querySelector(${JSON.stringify(xRowSel + ' .sidebar-row-name')})?.textContent === 'sim'`, 'X renamed to sim');
    const short = await s.evalJs(`(() => {
    const row = document.querySelector(${JSON.stringify(xRowSel)});
    const name = row.querySelector('.sidebar-row-name');
    const badge = row.querySelector('.sidebar-row-state');
    const range = document.createRange();
    range.selectNodeContents(name);
    return {
      sidebarWidth: document.querySelector('.sidebar').getBoundingClientRect().width,
      level: row.querySelector('.sidebar-row-main').dataset.squeeze ?? null,
      nameChars: name.style.getPropertyValue('--name-chars'),
      nameFloor: parseFloat(getComputedStyle(name).minWidth),
      nameWidth: name.getBoundingClientRect().width,
      textWidth: range.getBoundingClientRect().width,
      badgeText: badge.textContent,
      badgeWidth: badge.getBoundingClientRect().width,
      badgeScroll: badge.scrollWidth,
      rowRight: row.querySelector('.sidebar-row-main').getBoundingClientRect().right,
      badgeRight: badge.getBoundingClientRect().right,
    };
  })()`);
    expect(short.sidebarWidth === widthBefore, `the sidebar is back at its default width, got ${short.sidebarWidth}`);
    expect(short.nameChars === '3', `the row carries the name's length, got ${JSON.stringify(short.nameChars)}`);
    expect(short.nameFloor < 40 && short.nameFloor >= short.textWidth - 4, `the floor is the name's own width and not eight characters, got ${JSON.stringify(short)}`);
    // At level 1 (fix 123: the row has no room for the whole phrase even
    // beside three letters, so the reason is dropped) the line has slack
    // and the name's box, flex 1, holds it; the floor is what fix 51 set.
    expect(short.level === '1' || short.nameWidth <= short.textWidth + 4, `the name's box sits on its text when the line is tight, got ${JSON.stringify(short)}`);
    // Whole when the row has the room; the default row is a few pixels
    // short of it (the badge sat at its 12ch floor beside the 8ch box, and
    // the 37px the name gave up leaves it 5px under its 141px), so the line
    // sits at whichever squeeze level fits (fix 123) and the badge is whole
    // at that level: the full phrase, or the two words.
    expect(short.badgeText === 'needs input: permission' && short.badgeScroll <= short.badgeWidth + 1, `the badge reads whole at the level the line settled on, got ${JSON.stringify(short)}`);
    await zreq(s, 'session.rename', { sessionId: x.id, name: '' });
    await s.waitFor(`document.querySelector(${JSON.stringify(xRowSel + ' .sidebar-row-name')})?.textContent !== 'sim'`, 'X back to its folder name');
    step(`fix 51: at ${short.sidebarWidth}px a three-letter name keeps ${Math.round(short.nameWidth)}px for ${Math.round(short.textWidth)}px of letters and the badge has ${Math.round(short.badgeWidth)} of its ${short.badgeScroll}px`);

    // The + on the heading: a shell in that folder in a new pane split to
    // the right of the focused pane, focused, with its row under the same
    // heading. A right click on the + offers a Claude session there, which
    // opens the dialog with the folder filled in and makes no pane until
    // Start, so Escape leaves the layout alone.
    let layout = await getLayout(s);
    focusedBefore = layout.focusedPaneId;
    const panesBefore = leaves(layout).length;
    await s.evalJs(`document.querySelector(${JSON.stringify(`${groupSel} .sidebar-group-add`)}).click()`);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(`${groupSel} .sidebar-row`)}).length === 3`, 'a third row under the folder');
    await s.waitFor(`document.querySelectorAll('.pane').length === ${panesBefore + 1}`, 'one more pane');
    layout = await getLayout(s);
    addedPane = layout.focusedPaneId;
    expect(addedPane !== focusedBefore, 'the new pane took focus');
    addedHolder = (function find(node) {
      if (node.kind !== 'split') return null;
      if (node.second.kind === 'pane' && node.second.id === addedPane) return node;
      return find(node.first) ?? find(node.second);
    })(layout.root);
    expect(addedHolder !== null && addedHolder.direction === 'row' && addedHolder.first.kind === 'pane' && addedHolder.first.id === focusedBefore, 'split to the right of the pane that was focused');
    const added = await sessionOf(s, addedPane);
    expect(added?.kind === 'shell' && added.spawnCwd === orderDir, `a shell in the folder of the heading, got ${added?.spawnCwd}`);
    expect((await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(added.id)}]')?.closest('.sidebar-group')?.dataset.group ?? null`)) === orderDir, 'its row is under the heading that was clicked');
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(added.id)}]')?.dataset.shown === 'focused'`, 'and says focused');
    expect(JSON.stringify(await groupRows()) === JSON.stringify([x.id, y.id, added.id]), 'at the bottom of the group, as created');
    await s.screenshot('m9-fixes-group-add.png');
    const plus = await centerOf(s, `${groupSel} .sidebar-group-add`);
    await s.rightClick(plus.x, plus.y);
    await s.waitFor(`document.querySelector('.group-menu')?.dataset.folder === ${JSON.stringify(orderDir)}`, 'the + menu for the folder');
    const addItems = await s.evalJs(`[...document.querySelectorAll('.group-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent)`);
    // The commits tab (M61) is the renderer's own, so it is offered under this level 1 daemon too; the pane (M52) is not.
    expect(JSON.stringify(addItems) === JSON.stringify(['New Claude session here', 'Commits in a tab']), `the Claude choice and the commits tab, got ${JSON.stringify(addItems)}`);
    await s.evalJs(`document.querySelector('.group-menu .menu-item').click()`);
    await s.waitFor(`!!document.querySelector('.dialog.new-session')`, 'the new session dialog');
    expect((await s.evalJs(`document.querySelector('.dialog.new-session input[name="cwd"]').value`)) === orderDir, 'the folder is filled in');
    expect(await s.evalJs(`document.querySelector('.dialog.new-session input[name="kind"][value="claude"]').checked`), 'Claude is preselected');
    expect((await s.evalJs(`document.querySelectorAll('.pane').length`)) === panesBefore + 1, 'no pane made before Start');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.dialog.new-session')`, 'Escape closed the dialog');
    expect((await getLayout(s)).revision === layout.revision, 'and the layout is as it was');
    step('M32 +: a shell in the folder beside the focused pane, its row under the heading; the right click offered Claude with the folder filled in');

    // Fix 64, the fold. The chevron beside the + folds the group's rows
    // away; the heading keeps its name, its rollup and its units (M46), the
    // fold is kept in localStorage so a reload finds it, and the chevron
    // unfolds it.
    const foldSel = `${groupSel} .sidebar-group-fold`;
    const openHeading = await heading();
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)})?.textContent`)) === '▾', 'the chevron points down on an open group');
    await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)}).click()`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(groupSel)})?.dataset.folded`, 'the group says folded');
    expect((await groupRows()).length === 0, 'and renders no rows');
    const foldedHeading = await heading();
    expect(foldedHeading.rollup === openHeading.rollup && foldedHeading.count === openHeading.count && JSON.stringify(foldedHeading.units) === JSON.stringify(openHeading.units) && foldedHeading.text === null, `the heading keeps its rollup and its units, and shows no dim count while a unit is non-zero (M9 fix 75), ${JSON.stringify(openHeading)} then ${JSON.stringify(foldedHeading)}`);
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(`${groupSel} .sidebar-group-name`)})?.textContent`)) === path.basename(orderDir), 'and its name');
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)})?.textContent`)) === '▸', 'the chevron points right');
    expect((await s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(foldSel)})).opacity`)) === '1', 'and stays up without the hover');
    expect(JSON.parse(await s.evalJs(`localStorage.getItem('emerald.sidebarFolded')`)).includes(orderDir), 'the fold is in localStorage');
    expect((await s.evalJs(`document.querySelectorAll('.sidebar-row').length`)) > 0, 'the other groups still list their rows');
    await s.screenshot('m9-fixes-group-fold.png');
    const hostsBeforeFold = await s.evalJs(`document.querySelectorAll('.term-host').length`);
    await s.send('Page.reload');
    await s.waitFor(`document.querySelectorAll('.term-host').length === ${hostsBeforeFold} && !!document.querySelector(${JSON.stringify(groupSel)})`, 'the terminals and the heading are back after the reload');
    expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(groupSel)})?.dataset.folded`), 'the group is still folded');
    expect((await groupRows()).length === 0, 'with no rows');
    await s.evalJs(`document.querySelector(${JSON.stringify(foldSel)}).click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(groupSel)})?.dataset.folded && document.querySelectorAll(${JSON.stringify(`${groupSel} .sidebar-row`)}).length === 3`, 'the chevron unfolds the group and its three rows are back');
    expect(JSON.stringify(await groupRows()) === JSON.stringify([x.id, y.id, added.id]), 'in their order');
    expect(!JSON.parse(await s.evalJs(`localStorage.getItem('emerald.sidebarFolded')`)).includes(orderDir), 'and the fold is gone from localStorage');
    step('fix 64: the chevron folded the group, the heading kept its name, rollup and units, the fold survived a reload, the chevron unfolded it');
  });

  await block('fix-75', async () => {
    // M9 fix 75: a folded heading of idle rows. Every session under a
    // heading is one unit (an agent or a shell), so a folded group of two
    // idle shells reads its count as the dim shells-idle unit, and the
    // plain dim count (.sidebar-group-count[data-dim]) is the fallback for
    // a heading with no unit at all, which a non-empty group never has.
    const idleDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-m75-')));
    const { session: idleA } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: idleDir, cols: 120, rows: 30 });
    const { session: idleB } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: idleDir, cols: 120, rows: 30 });
    const idleGroupSel = `.sidebar-group[data-group=${JSON.stringify(idleDir)}]`;
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(`${idleGroupSel} .sidebar-row`)}).length === 2`, 'two idle shells under their heading');
    // The shells print their prompts as they start, which runs the mark for
    // a moment; wait for both to sit at the prompt.
    await s.waitFor(`(() => { const h = document.querySelector(${JSON.stringify(`${idleGroupSel} .sidebar-group-title`)}); return h?.querySelector('.roster-unit[data-unit="shells-idle"] .roster-count')?.textContent === '2' && !h.querySelector('.roster-unit[data-unit="shells-running"]'); })()`, 'both at their prompt', 10000);
    await s.evalJs(`document.querySelector(${JSON.stringify(`${idleGroupSel} .sidebar-group-fold`)}).click()`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(idleGroupSel)})?.dataset.folded`, 'folded');
    const foldedIdle = await s.evalJs(`(() => { const h = document.querySelector(${JSON.stringify(`${idleGroupSel} .sidebar-group-title`)}); const u = h.querySelector('.roster-unit[data-unit="shells-idle"]'); return { units: [...h.querySelectorAll('.roster-unit')].map((x) => x.dataset.unit), count: u?.querySelector('.roster-count')?.textContent ?? null, dim: h.querySelector('.sidebar-group-count[data-dim]')?.textContent ?? null, glyphOpacity: u ? getComputedStyle(u.querySelector('.shell-mark')).opacity : null, countColor: u ? getComputedStyle(u.querySelector('.roster-count')).color : null, running: u?.querySelector('.shell-mark').dataset.running ?? null }; })()`);
    expect(JSON.stringify(foldedIdle.units) === JSON.stringify(['shells-idle']) && foldedIdle.count === '2' && foldedIdle.dim === null, `a folded heading of two idle shells reads the dim shells-idle unit at 2, got ${JSON.stringify(foldedIdle)}`);
    expect(foldedIdle.glyphOpacity === '0.7' && foldedIdle.countColor === 'rgb(143, 180, 214)' && foldedIdle.running === null, `the glyph dim, the count in the full dim blue, the caret still, got ${JSON.stringify(foldedIdle)}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(`${idleGroupSel} .sidebar-group-fold`)}).click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(idleGroupSel)})?.dataset.folded`, 'unfolded again');
    for (const id of [idleA.id, idleB.id]) await zreq(s, 'session.kill', { sessionId: id, remove: true });
    step('fix 75: a folded heading of two idle shells says 2 through its dim shells-idle unit');

    // M9 fix 193: the heading's own right-click menu sweeps the group. Two
    // shells under a folder of their own, one at its prompt and one inside
    // a node that reads no exit; Close all 2 types exit into each, so the
    // first leaves by its own exit (code 0) and the second stays until the
    // fallback kill lands after the grace period. A second pair takes Kill
    // all 2 (the rows to Exited); a third Kill all 2 and remove (the rows
    // gone from the list and from sessions.json). The Exited heading's
    // menu reads Remove all with the count of its rows.
    const sweepGroup = async (tag) => {
      const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `emerald-m193-${tag}-`)));
      const { session: a } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: dir, cols: 120, rows: 30 });
      const { session: b } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: dir, cols: 120, rows: 30 });
      const sel = `.sidebar-group[data-group=${JSON.stringify(dir)}]`;
      await s.waitFor(`document.querySelectorAll(${JSON.stringify(`${sel} .sidebar-row`)}).length === 2`, `two shells under ${tag}`);
      await s.waitFor(`(() => { const h = document.querySelector(${JSON.stringify(`${sel} .sidebar-group-title`)}); return h?.querySelector('.roster-unit[data-unit="shells-idle"] .roster-count')?.textContent === '2' && !h.querySelector('.roster-unit[data-unit="shells-running"]'); })()`, `both at their prompt (${tag})`, 10000);
      return { dir, sel, ids: [a.id, b.id] };
    };
    const headingMenuItems = () => s.evalJs(`[...document.querySelectorAll('.group-heading-menu .menu-item')].map(b => ({ label: b.querySelector('.menu-label').textContent, title: b.getAttribute('title') }))`);
    const openHeadingMenu = async (sel, key) => {
      const name = await centerOf(s, `${sel} .sidebar-group-name`);
      await s.rightClick(name.x, name.y);
      await s.waitFor(`document.querySelector('.group-heading-menu')?.dataset.group === ${JSON.stringify(key)}`, 'the heading menu opens for its group');
    };
    const pickHeadingItem = async (label) => {
      await s.evalJs(`[...document.querySelectorAll('.group-heading-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
      await s.waitFor(`!document.querySelector('.group-heading-menu')`, 'the heading menu closed');
    };
    const rowsExited = (ids) => `${JSON.stringify(ids)}.every(id => document.querySelector('.sidebar-row[data-session-id=' + JSON.stringify(id) + ']')?.dataset.state === 'exited')`;
    const closeGroup = await sweepGroup('close');
    const [closeA, closeB] = closeGroup.ids;
    await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(closeB)}, data: 'node -e "setInterval(function () {}, 1000)"' + String.fromCharCode(13) })`);
    // A silent node writes nothing, so the heading's units never say
    // running; a pause is the only wait there is for it to be up.
    await sleep(1500);
    await openHeadingMenu(closeGroup.sel, closeGroup.dir);
    const sweepItems = await headingMenuItems();
    // M9 fix 345: Copy path and Reveal in Explorer lead the heading menu
    // now, ahead of the three sweeps, on every group (no Rename here, this
    // being a temp folder with no daemon behind it to hold a label).
    expect(JSON.stringify(sweepItems.map((i) => i.label)) === JSON.stringify(['Copy path', 'Reveal in Explorer', 'Close all 2', 'Kill all 2', 'Kill all 2 and remove']), `Copy path and Reveal in Explorer lead the heading menu above the three sweeps with the count, got ${JSON.stringify(sweepItems)}`);
    expect(sweepItems[2].title.startsWith('Type /exit into each Claude and exit into each shell') && !sweepItems[2].title.includes('working now'), `Close all names the typing and, with nothing working, no working count, got ${JSON.stringify(sweepItems[2].title)}`);
    const closeStarted = Date.now();
    await pickHeadingItem('Close all 2');
    await s.waitFor(rowsExited(closeGroup.ids), 'both shells exited on Close all', 12000);
    const closedInfo = (await zreq(s, 'session.list', {})).sessions.filter((x) => closeGroup.ids.includes(x.id));
    const closedA = closedInfo.find((x) => x.id === closeA);
    const closedB = closedInfo.find((x) => x.id === closeB);
    expect(closedA?.exitCode === 0, `the shell at its prompt left by its own exit with code 0, got ${JSON.stringify(closedA?.exitCode)}`);
    expect(closedB !== undefined && closedB.stateSince - closeStarted >= 4900, `the shell inside node stayed until the fallback kill after the 5 s grace, exited ${closedB === undefined ? 'never' : `${closedB.stateSince - closeStarted}ms after the click`}`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(closeGroup.sel)})`, 'the folder heading is gone with its rows');
    const killGroup = await sweepGroup('kill');
    await openHeadingMenu(killGroup.sel, killGroup.dir);
    await pickHeadingItem('Kill all 2');
    await s.waitFor(rowsExited(killGroup.ids), 'both shells exited on Kill all', 8000);
    await s.waitFor(`!document.querySelector(${JSON.stringify(killGroup.sel)})`, 'the second folder heading is gone');
    const removeGroup = await sweepGroup('remove');
    await openHeadingMenu(removeGroup.sel, removeGroup.dir);
    await pickHeadingItem('Kill all 2 and remove');
    await s.waitFor(`${JSON.stringify(removeGroup.ids)}.every(id => !document.querySelector('.sidebar-row[data-session-id=' + JSON.stringify(id) + ']'))`, 'both rows gone from the list on Kill all and remove', 8000);
    await s.waitFor(`!document.querySelector(${JSON.stringify(removeGroup.sel)})`, 'the third folder heading is gone');
    // The daemon keeps a removed record with its removedAt (M57), so the
    // file's entries are read as removed rather than gone; the list
    // without the removed flag no longer has them.
    const savedAfterRemove = () => JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'sessions.json'), 'utf8')).sessions.filter((x) => removeGroup.ids.includes(x.id) && typeof x.removedAt !== 'number').length;
    for (let i = 0; i < 40 && savedAfterRemove() !== 0; i += 1) await sleep(100);
    expect(savedAfterRemove() === 0, 'and marked removed in sessions.json');
    expect((await zreq(s, 'session.list', {})).sessions.every((x) => !removeGroup.ids.includes(x.id)), 'and gone from the list');
    const exitedSel = `.sidebar-group[data-group="exited"]`;
    const exitedCount = await s.evalJs(`document.querySelectorAll(${JSON.stringify(`${exitedSel} .sidebar-row`)}).length`);
    expect(exitedCount >= 4, `the exited group holds the closed and killed shells, ${exitedCount} rows`);
    await openHeadingMenu(exitedSel, 'exited');
    const exitedItems = await headingMenuItems();
    expect(JSON.stringify(exitedItems.map((i) => i.label)) === JSON.stringify([`Resume all ${exitedCount}`, `Remove all ${exitedCount}`]), `the Exited heading offers Resume all and Remove all with its count, got ${JSON.stringify(exitedItems)}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.group-heading-menu')`, 'Escape closed it');
    step('M9 fix 193: the heading menu offered Close all, Kill all and Kill all and remove with the count; Close all had the idle shell leave by its own exit and killed the one inside node after the grace, Kill all sent both to Exited, Kill all and remove forgot both, the Exited heading offers Resume all and Remove all (M9 fix 290)');
  });


  await block('m38', async () => {
    // M38, the 5A skin, read off computed styles on what is on screen: the
    // added pane sits to the right of the pane that was focused, so the
    // divider between them is a row gutter. The seam is 1px and the drag
    // target is a ::after strip three pixels either side of it, so a press
    // two pixels off the line still moves the split; the focused title is
    // the amber-tinted header and the other the plain one; the strip is
    // 28px with an amber top edge on the active tab; the find bar has no
    // radius and no shadow; a default button is amber with dark ink; the
    // session colour is a bar on the title, not its ground.
    const AMBER = 'rgb(232, 163, 61)';
    const holderSel = `[data-pane-id=${JSON.stringify(addedPane)}]`;
    const seam = await s.evalJs(
      `(() => { const pane = document.querySelector(${JSON.stringify(holderSel)}); const g = pane.parentElement.previousElementSibling; const r = g.getBoundingClientRect(); return { cls: g.className, width: r.width, x: r.x + r.width / 2, y: r.y + r.height / 2, cursor: getComputedStyle(g, '::after').cursor }; })()`,
    );
    expect(seam.cls.startsWith('gutter gutter-row') && seam.width === 1, `the divider is a 1px row gutter, got ${JSON.stringify(seam)}`);
    expect(seam.cursor === 'col-resize', `the strip over it carries the resize cursor, got ${seam.cursor}`);
    const ratioBefore = addedHolder.ratio;
    const seamDrag = (type, x) => s.send('Input.dispatchMouseEvent', { type, x, y: seam.y, button: 'left', clickCount: 1 });
    await seamDrag('mousePressed', seam.x + 2);
    for (let i = 1; i <= 8; i++) await seamDrag('mouseMoved', seam.x + 2 - 10 * i);
    await seamDrag('mouseReleased', seam.x - 78);
    await s.waitFor(`!/dragging-(col|row)/.test(document.body.className)`, 'drag state cleared');
    await sleep(500);
    let layout = await getLayout(s);
    const holderAfter = (function find(node) {
      if (node.kind !== 'split') return null;
      if (node.second.kind === 'pane' && node.second.id === addedPane) return node;
      return find(node.first) ?? find(node.second);
    })(layout.root);
    expect(holderAfter !== null && holderAfter.ratio < ratioBefore - 0.02, `a press 2px off the seam dragged the split, ratio ${ratioBefore.toFixed(3)} to ${holderAfter?.ratio.toFixed(3)}`);
    const titleStyle = (paneId) =>
      s.evalJs(
        `(() => { const p = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]'); const t = p.querySelector('.pane-title'); return { focused: p.classList.contains('focused'), ring: getComputedStyle(p, '::after').borderTopColor, bg: getComputedStyle(t).backgroundColor, bar: getComputedStyle(t, '::before').backgroundColor, color: t.dataset.color ?? null }; })()`,
      );
    await s.waitFor(focusedPaneIs(addedPane), 'the added pane is still focused');
    const tFocused = await titleStyle(addedPane);
    const tOther = await titleStyle(focusedBefore);
    const hex = (c) => `rgb(${parseInt(c.slice(1, 3), 16)}, ${parseInt(c.slice(3, 5), 16)}, ${parseInt(c.slice(5, 7), 16)})`;
    // M9 fix 43: the ring is the session's colour now, not the amber, and
    // so is the active tab's top line, since the added pane is the tab's
    // focused pane. The title's tint stays amber.
    expect(tFocused.focused && tFocused.bg === 'rgb(43, 36, 32)', `the focused title is amber-tinted, got ${JSON.stringify(tFocused)}`);
    expect(!tOther.focused && tOther.bg === 'rgb(37, 37, 38)', `the other title is the plain header, got ${JSON.stringify(tOther)}`);
    expect(tFocused.color !== null && tFocused.bar === hex(tFocused.color) && tFocused.bg !== hex(tFocused.color), `the session colour is the title's bar and not its ground, got ${JSON.stringify(tFocused)}`);
    expect(tFocused.ring === hex(tFocused.color), `fix 43: the focus ring is the session's colour, got ${tFocused.ring} for ${tFocused.color}`);
    const activeTabTop = () => s.evalJs(`(() => { const t = document.querySelector('.tab-strip .tab[data-active]'); return { top: getComputedStyle(t).borderTopColor, color: t.dataset.color ?? null }; })()`);
    const tabColoured = await activeTabTop();
    expect(tabColoured.color === tFocused.color && tabColoured.top === hex(tFocused.color), `fix 43: the active tab's top line is the focused session's colour, got ${JSON.stringify(tabColoured)}`);
    // An empty pane has no session: the ring and the line go back to amber.
    const emptyBefore = await s.evalJs(`document.querySelectorAll('.empty-pane').length`);
    await s.key('E', 'KeyE', 69, CTRL | SHIFT);
    await s.waitFor(`document.querySelector('.pane.focused .empty-pane') !== null`, 'an empty pane split off and focused');
    const emptyRing = await s.evalJs(`(() => { const p = document.querySelector('.pane.focused'); return { ring: getComputedStyle(p, '::after').borderTopColor, color: p.dataset.color ?? null }; })()`);
    const tabAmber = await activeTabTop();
    expect(emptyRing.color === null && emptyRing.ring === AMBER, `fix 43: an empty focused pane keeps the amber ring, got ${JSON.stringify(emptyRing)}`);
    expect(tabAmber.color === null && tabAmber.top === AMBER, `fix 43: the tab's line is amber with an empty pane focused, got ${JSON.stringify(tabAmber)}`);
    await s.key('W', 'KeyW', 87, CTRL | SHIFT);
    await s.waitFor(`document.querySelectorAll('.empty-pane').length === ${emptyBefore}`, 'the empty pane closed again');
    await s.evalJs(`document.querySelector(${JSON.stringify(holderSel)}).dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
    await s.waitFor(focusedPaneIs(addedPane), 'the added pane focused again');
    step('fix 43: the focus ring and the active tab line in the session colour, amber on an empty pane');
    const tabStrip = await s.evalJs(
      `(() => { const st = document.querySelector('.tab-strip'); const active = st.querySelector('.tab[data-active]'); const idle = [...st.querySelectorAll('.tab:not([data-active])')][0] ?? null; return { height: st.getBoundingClientRect().height, activeTop: getComputedStyle(active).borderTopColor, idleTop: idle === null ? null : getComputedStyle(idle).borderTopColor }; })()`,
    );
    expect(tabStrip.height >= 28 && tabStrip.height <= 29 && tabStrip.activeTop === hex(tFocused.color), `a 28px strip (its hairline may sit outside the box) with the active tab's top edge in the focused session's colour, got ${JSON.stringify(tabStrip)}`);
    expect(tabStrip.idleTop === null || tabStrip.idleTop === 'rgba(0, 0, 0, 0)', `an inactive tab reserves the edge in transparent, got ${tabStrip.idleTop}`);
    await s.key('H', 'KeyH', 72, CTRL | SHIFT);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(`${holderSel} .find-bar`)})`, 'the find bar on the focused pane');
    const bar = await s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(`${holderSel} .find-bar`)}); const c = getComputedStyle(b); const i = getComputedStyle(b.querySelector('.find-input')); return { radius: c.borderRadius, shadow: c.boxShadow, inputRadius: i.borderRadius }; })()`);
    expect(bar.radius === '0px' && bar.shadow === 'none' && bar.inputRadius === '0px', `the find bar is flat, got ${JSON.stringify(bar)}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.find-bar')`, 'Escape closed the bar');
    const button = await s.evalJs(`(() => { const b = document.createElement('button'); b.textContent = 'x'; document.body.append(b); const c = getComputedStyle(b); const out = { bg: c.backgroundColor, ink: c.color, radius: c.borderRadius }; b.remove(); return out; })()`);
    expect(button.bg === AMBER && button.ink === 'rgb(32, 22, 8)' && button.radius === '0px', `a default button is amber with dark ink and square, got ${JSON.stringify(button)}`);
    await s.screenshot('m38-skin.png');
    step('M38 skin: 1px seams with a 7px drag target, amber focus and title tints, flat find bar, amber buttons, the session colour as a bar');

    // Fix 22: the root declares the dark scheme, so Chromium's stock
    // scrollbars and form controls come out dark on every scrolling box.
    const scheme = await s.evalJs(`getComputedStyle(document.documentElement).colorScheme`);
    expect(scheme === 'dark', `the root's color-scheme is dark, got ${scheme}`);
    step('fix 22: color-scheme dark on the root');

    // Fix 23: the dialog's text boxes and the rename boxes take the find
    // bar's focus (no stock ring, an amber border), the Kind radios the
    // amber accent, and a selected run of text the terminal's blue.
    const focusStyle = (sel) =>
      s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); const c = getComputedStyle(el); return { active: document.activeElement === el, outline: c.outlineStyle, border: c.borderColor, radius: c.borderRadius }; })()`);
    await chooseMenu(s, addedPane, 'New Claude session here');
    await s.waitFor(`!!document.querySelector('.dialog.new-session input[name=cwd]')`, 'the new session dialog');
    const cwdBox = await focusStyle('.dialog.new-session input[name=cwd]');
    expect(cwdBox.active && cwdBox.outline === 'none' && cwdBox.border === AMBER && cwdBox.radius === '0px', `the folder box focused shows no stock ring and an amber border, got ${JSON.stringify(cwdBox)}`);
    const radio = await s.evalJs(`getComputedStyle(document.querySelector('.dialog.new-session input[name=kind][value=shell]')).accentColor`);
    expect(radio === AMBER, `the Kind radios take the amber accent, got ${radio}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.dialog.new-session')`, 'Escape closed the dialog');
    await chooseMenu(s, addedPane, 'Rename session');
    await s.waitFor(`document.activeElement?.className === 'pane-rename'`, 'rename box in the pane title');
    const renameBox = await focusStyle('.pane-rename');
    expect(renameBox.outline === 'none' && renameBox.border === AMBER, `the rename box shows no stock ring around its amber border, got ${JSON.stringify(renameBox)}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.pane-rename')`, 'Escape cancelled the rename');
    const selection = await s.evalJs(`(() => { const el = document.querySelector('.sidebar-row-name'); return getComputedStyle(el, '::selection').backgroundColor; })()`);
    expect(selection === 'rgba(74, 144, 217, 0.3)', `a selected run takes the terminal's blue at 30%, got ${selection}`);
    step('fix 23: amber focus on the dialog and rename boxes, amber radios, the terminal blue on a selection');

    // Fix 24: the hairline is on the strip's children and its ::after, not
    // on the strip, so the active tab's own bottom edge (the content
    // ground) is the last thing painted under it and it joins the pane.
    const GUTTER = 'rgb(45, 45, 45)';
    const BG = 'rgb(30, 30, 30)';
    const tabEdges = await s.evalJs(
      `(() => { const st = document.querySelector('.tab-strip'); const active = st.querySelector('.tab[data-active]'); const r = active.getBoundingClientRect(); const sr = st.getBoundingClientRect(); const under = document.elementFromPoint(r.x + r.width / 2, sr.bottom - 1); return { stripBottom: getComputedStyle(st).borderBottomWidth, activeBottom: getComputedStyle(active).borderBottomColor, filler: getComputedStyle(st, '::after').borderBottomColor, underIsActive: active.contains(under), height: sr.height }; })()`,
    );
    expect(tabEdges.stripBottom === '0px' && tabEdges.filler === GUTTER, `the strip has no border of its own and its ::after carries the hairline, got ${JSON.stringify(tabEdges)}`);
    // The daemon is pinned at level 1 here, so the strip holds the one Panes
    // tab and no +; verify:tabs reads the hairline under an inactive tab.
    expect(tabEdges.activeBottom === BG, `the active tab's bottom edge is the content ground, got ${JSON.stringify(tabEdges)}`);
    expect(tabEdges.underIsActive && tabEdges.height === 28, `the pixel row above the strip's bottom edge under the active tab belongs to the tab in a 28px strip, got ${JSON.stringify(tabEdges)}`);
    step('fix 24: the active tab joins the content, the hairline under the other tabs and the spare width');

    // M9 fix 19: the focus ring is a ::after over the whole pane, since the
    // header (positioned for its colour bar) painted over the pane's own
    // outline. Computed styles say nothing about paint order, so this reads
    // pixels: a CDP clip decoded in the page through a canvas (the CSP
    // allows data: images), which the compositor renders even when the
    // window is covered. The ring's colour, the focused session's since fix
    // 43, on the top edge and on the left edge beside the terminal (below
    // the header, since the colour bar inside the ring is the same colour
    // now), the header ground just under the edge as a control.
    const pixels = async (x, y, w, h) => {
      const r = await s.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 1 } });
      return s.evalJs(
        `new Promise((resolve) => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; const out = []; for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]); resolve(out); }; img.src = 'data:image/png;base64,' + ${JSON.stringify(r.data)}; })`,
      );
    };
    const hasPx = (px, [r, g, b]) => px.some(([pr, pg, pb]) => Math.abs(pr - r) < 10 && Math.abs(pg - g) < 10 && Math.abs(pb - b) < 10);
    const ringPx = [1, 3, 5].map((i) => parseInt(tFocused.color.slice(i, i + 2), 16));
    const ringBox = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(holderSel)}).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    const topEdge = await pixels(ringBox.x + Math.floor(ringBox.w / 2), ringBox.y, 2, 2);
    expect(hasPx(topEdge, ringPx), `the ring shows on the pane's top edge over the header in ${tFocused.color}, got ${JSON.stringify(topEdge.slice(0, 4))}`);
    // Four pixels across since the ring is 3px (fix 63): ring, then ground.
    const leftEdge = await pixels(ringBox.x, ringBox.y + 40, 4, 2);
    expect(hasPx(leftEdge, ringPx) && hasPx(leftEdge, [30, 30, 30]), `the ring's left edge shows beside the terminal ground, got ${JSON.stringify(leftEdge.slice(0, 8))}`);
    // Just under the 3px ring, the header ground and no ring.
    const underEdge = await pixels(ringBox.x + Math.floor(ringBox.w / 2), ringBox.y + 4, 2, 2);
    expect(!hasPx(underEdge, ringPx) && hasPx(underEdge, [43, 36, 32]), `the header ground sits under the edge, got ${JSON.stringify(underEdge.slice(0, 4))}`);
    await s.screenshot('m9-fix19-ring.png');
    step('M9 fix 19: the focused ring paints over the header and the colour bar');

    // M9 fix 20: the terminal's rows fit its box. The fit addon measures the
    // host's height and subtracts the padding of the .xterm element only, so
    // the 4px now lives there: rows times the cell height is at most the
    // host less 8px, and within one cell of it, at two heights five pixels
    // apart (a column gutter dragged), since which fault showed depended on
    // the height modulo the cell. The viewport ground is the app's, not
    // xterm's black, so any spare band is invisible. No column split is
    // left on screen by now, so the focused pane is split down first.
    const hostsBefore = await s.evalJs(`document.querySelectorAll('.term-host').length`);
    await splitWithShell(s, `${holderSel} .pane-split-down`);
    await s.waitFor(`document.querySelectorAll('.term-host').length === ${hostsBefore + 1} && !!document.querySelector('.gutter-column')`, 'a column split under the focused pane');
    await sleep(600);
    const termFit = () =>
      s.evalJs(
        `(() => { const g = document.querySelector('.gutter-column'); const host = g.parentElement.querySelector('.term-host'); const t = host.emeraldTerm; const cell = t._core._renderService.dimensions.css.cell.height; return { host: host.clientHeight, hostPad: getComputedStyle(host).paddingTop, xtermPad: getComputedStyle(host.querySelector('.xterm')).paddingTop, rows: t.rows, cell, viewport: getComputedStyle(host.querySelector('.xterm-viewport')).backgroundColor, gutter: (() => { const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })() }; })()`,
      );
    const fits = (f) => f.rows * f.cell <= f.host - 8 + 0.01 && f.host - 8 - f.rows * f.cell < f.cell;
    const fitBefore = await termFit();
    expect(fitBefore.hostPad === '0px' && fitBefore.xtermPad === '4px', `the padding is on .xterm, not the host, got ${JSON.stringify(fitBefore)}`);
    expect(fitBefore.viewport === 'rgb(30, 30, 30)', `the viewport ground is the app's, got ${fitBefore.viewport}`);
    expect(fits(fitBefore), `the rows fill the box without spilling: ${JSON.stringify(fitBefore)}`);
    const colDrag = (type, y) => s.send('Input.dispatchMouseEvent', { type, x: fitBefore.gutter.x, y, button: 'left', clickCount: 1 });
    await colDrag('mousePressed', fitBefore.gutter.y);
    for (let i = 1; i <= 5; i++) await colDrag('mouseMoved', fitBefore.gutter.y + i);
    await colDrag('mouseReleased', fitBefore.gutter.y + 5);
    await s.waitFor(`!/dragging-(col|row)/.test(document.body.className)`, 'column drag state cleared');
    await s.waitFor(`document.querySelector('.gutter-column').parentElement.querySelector('.term-host').clientHeight !== ${fitBefore.host}`, 'the pane above the gutter changed height');
    await sleep(600);
    const fitAfter = await termFit();
    expect(fitAfter.host !== fitBefore.host && fits(fitAfter), `the rows still fill the box at the new height: ${JSON.stringify(fitAfter)}`);
    step('M9 fix 20: the terminal rows fit the host at two heights, the padding on .xterm, the viewport on the app ground');

    // M9 fix 21: text an IME is still composing wraps inside the pane. The
    // composition events are dispatched on xterm's textarea, which is what
    // Windows voice typing does; xterm shows the string in its composition
    // view at the cursor, and the view's box must end inside the pane and
    // run to more than one row.
    const compose = (type, data) =>
      s.evalJs(
        `(() => { const ta = document.querySelector(${JSON.stringify(`${holderSel} .xterm-helper-textarea`)}); ta.dispatchEvent(new CompositionEvent(${JSON.stringify(type)}, { data: ${JSON.stringify(data)}, bubbles: true })); return true; })()`,
      );
    const spoken = 'the quick brown fox jumps over the lazy dog and keeps on running through the field until the pane runs out of room for one line of it '.repeat(2);
    await compose('compositionstart', '');
    await compose('compositionupdate', spoken);
    await s.waitFor(`document.querySelector(${JSON.stringify(`${holderSel} .composition-view.active`)})?.textContent.length > 100`, 'the composition view shows the string');
    const composed = await s.evalJs(
      `(() => { const v = document.querySelector(${JSON.stringify(`${holderSel} .composition-view`)}); const p = document.querySelector(${JSON.stringify(holderSel)}); const r = v.getBoundingClientRect(); const pr = p.getBoundingClientRect(); const cell = p.querySelector('.term-host').emeraldTerm._core._renderService.dimensions.css.cell.height; return { right: r.right, paneRight: pr.right, height: r.height, cell, wrap: getComputedStyle(v).whiteSpace, bg: getComputedStyle(v).backgroundColor, ink: getComputedStyle(v).color, helpers: getComputedStyle(v.parentElement).pointerEvents }; })()`,
    );
    expect(composed.right <= composed.paneRight + 0.5, `the composition view ends inside the pane, got ${JSON.stringify(composed)}`);
    expect(composed.height > composed.cell * 1.5, `the composition view wrapped to more than one row, got ${JSON.stringify(composed)}`);
    expect(composed.wrap === 'pre-wrap' && composed.bg === 'rgb(30, 30, 30)' && composed.ink === 'rgb(212, 212, 212)', `the view wraps in the theme's colours, got ${JSON.stringify(composed)}`);
    expect(composed.helpers === 'none', `the helper box does not catch the pointer, got ${composed.helpers}`);
    await s.screenshot('m9-fix21-composition.png');
    await compose('compositionend', '');
    await s.waitFor(`!document.querySelector(${JSON.stringify(`${holderSel} .composition-view.active`)})`, 'the composition view closed');
    step('M9 fix 21: a composing IME string wraps inside the pane in the theme colours');

    // M9 fix 57: a long composition low in the pane grows upward. The shell
    // in the holder prints past the bottom of its short pane so the prompt,
    // and xterm's cursor, sit on the last rows; a 200-character string
    // composed there wraps to rows that would run past the pane's edge, and
    // the view is shifted up by a transform so its bottom stays inside the
    // screen. A short composition at the same cursor needs no shift and
    // gets none. Nothing reaches the shell: the textarea's value stays
    // empty, so compositionend sends nothing.
    const holderShell = await sessionOf(s, addedPane);
    expect(holderShell !== null, 'the holder pane shows a session');
    const termOf = `document.querySelector(${JSON.stringify(`${holderSel} .term-host`)}).emeraldTerm`;
    await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(holderShell.id)}, data: '1..60 | % { "row $_" }' + String.fromCharCode(13) })`);
    await s.waitFor(`(() => { const t = ${termOf}; return t.buffer.active.cursorY >= t.rows - 4 && t.buffer.active.baseY > 0; })()`, 'the cursor sits on the last rows of the short pane', 15000);
    await sleep(300);
    const composedProbe = () =>
      s.evalJs(
        `(() => { const v = document.querySelector(${JSON.stringify(`${holderSel} .composition-view`)}); const screen = document.querySelector(${JSON.stringify(`${holderSel} .xterm-screen`)}); const r = v.getBoundingClientRect(); const sr = screen.getBoundingClientRect(); const t = ${termOf}; return { top: Math.round(r.top - sr.top), bottom: Math.round(r.bottom - sr.top), screen: Math.round(sr.height), height: Math.round(r.height), cursorY: t.buffer.active.cursorY, rows: t.rows, transform: v.style.transform, text: v.textContent.length }; })()`,
      );
    await compose('compositionstart', '');
    await compose('compositionupdate', spoken);
    await s.waitFor(`document.querySelector(${JSON.stringify(`${holderSel} .composition-view.active`)})?.textContent.length > 100`, 'the long composition shows');
    await sleep(200);
    const lifted = await composedProbe();
    expect(lifted.bottom <= lifted.screen + 0.5, `the long composition's bottom stays inside the screen, got ${JSON.stringify(lifted)}`);
    expect(lifted.transform.startsWith('translateY(-'), `the view was shifted up by a transform, got ${JSON.stringify(lifted)}`);
    expect(lifted.height > lifted.screen / 4, `the composition took several rows, got ${JSON.stringify(lifted)}`);
    await s.screenshot('m9-fix57-composition-lifted.png');
    await compose('compositionend', '');
    await s.waitFor(`!document.querySelector(${JSON.stringify(`${holderSel} .composition-view.active`)})`, 'the long composition closed');
    await compose('compositionstart', '');
    await compose('compositionupdate', 'hello');
    await s.waitFor(`document.querySelector(${JSON.stringify(`${holderSel} .composition-view.active`)})?.textContent === 'hello'`, 'the short composition shows');
    await sleep(200);
    const unlifted = await composedProbe();
    expect(unlifted.transform === '' && unlifted.bottom <= unlifted.screen + 0.5, `a short composition at the same cursor needs no shift, got ${JSON.stringify(unlifted)}`);
    await compose('compositionend', '');
    await s.waitFor(`!document.querySelector(${JSON.stringify(`${holderSel} .composition-view.active`)})`, 'the short composition closed');
    step(`M9 fix 57: a long composition low in the pane is lifted to stay inside (${JSON.stringify({ cursorY: lifted.cursorY, rows: lifted.rows, height: lifted.height, screen: lifted.screen, transform: lifted.transform })}), a short one is not`);

    // M9 fix 36: a split re-mounted the pane it split, and the new xterm
    // attached, replayed and drew no cursor until focused. The terminal is
    // parked across the re-mount now, so a tag put on the instance and on
    // its element before the split is still on the same pane's host after
    // it, the cursor is still initialised, and no pty.attach went out
    // (the refit after a split reflows the buffer, so its line count is
    // no measure). Closing the new pane moves the
    // holder up a level, the sibling-close re-mount (M2 gotcha 7), and the
    // tag survives that too.
    await s.evalJs(`document.querySelector(${JSON.stringify(holderSel)}).dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
    await s.waitFor(focusedPaneIs(addedPane), 'the holder pane focused for the split');
    const termProbe = () =>
      s.evalJs(
        `(() => { const h = document.querySelector(${JSON.stringify(`${holderSel} .term-host`)}); const t = h?.emeraldTerm; if (!t) return null; return { tag: t.__fix36 ?? null, elementTag: h.firstElementChild?.__fix36 ?? null, elementInHost: t.element?.parentElement === h, cursor: t._core.coreService.isCursorInitialized, searchTag: h.emeraldSearch?.__fix36 ?? null }; })()`,
      );
    await s.evalJs(
      `(() => { const h = document.querySelector(${JSON.stringify(`${holderSel} .term-host`)}); h.emeraldTerm.__fix36 = 'kept'; h.emeraldTerm.element.__fix36 = 'kept'; h.emeraldSearch.__fix36 = 'kept'; return true; })()`,
    );
    // Attaches are counted off the feed (M50): window.emerald is frozen by
    // the context bridge, so the request wrap that once stood here never
    // counted anything and the zero it reported was vacuous.
    const attachBase = await s.evalJs('window.emeraldFeed.stats.attaches');
    const attaches = async () => (await s.evalJs('window.emeraldFeed.stats.attaches')) - attachBase;
    const before36 = await termProbe();
    expect(before36 !== null && before36.tag === 'kept' && before36.cursor === true, `the holder's terminal is tagged and its cursor initialised, got ${JSON.stringify(before36)}`);
    const panesBefore36 = await s.evalJs(`document.querySelectorAll('.pane').length`);
    await s.key('E', 'KeyE', 69, CTRL | SHIFT);
    await s.waitFor(`document.querySelectorAll('.pane').length === ${panesBefore36 + 1}`, 'a pane split off the holder');
    layout = await getLayout(s);
    const splitPane = layout.focusedPaneId;
    const holderSplit = (function find(node) {
      if (node.kind !== 'split') return null;
      if (node.first.kind === 'pane' && node.first.id === addedPane && node.second.kind === 'pane' && node.second.id === splitPane) return node;
      return find(node.first) ?? find(node.second);
    })(layout.root);
    expect(holderSplit !== null && splitPane !== addedPane, `the holder and the new empty pane share a split, got ${JSON.stringify({ splitPane, addedPane })}`);
    await sleep(600);
    const after36 = await termProbe();
    expect(after36 !== null && after36.tag === 'kept' && after36.elementTag === 'kept' && after36.searchTag === 'kept', `the same terminal, element and search addon sit on the holder after the split, got ${JSON.stringify(after36)}`);
    expect(after36.elementInHost && after36.cursor === true && (await attaches()) === 0, `the element is inside the new host, the cursor still initialised and no attach went out, got ${JSON.stringify(after36)} with ${await attaches()} attaches`);
    expect(await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(splitPane)}] .empty-pane`)}) !== null`), 'the new pane is empty');
    step('M9 fix 36: a split keeps the terminal it splits, its cursor and its buffer, no replay');

    // M9 fix 37: the new empty pane is made about 160px wide through the
    // split's ratio. Its session list used to keep a min-content width of
    // about 150px and scroll sideways; now the rows give way and the pane
    // has no horizontal overflow.
    const splitBox = await s.evalJs(`(() => { const r = document.querySelector('[data-split-id=${JSON.stringify(holderSplit.id)}]').getBoundingClientRect(); return { width: r.width }; })()`);
    const narrowRatio = 1 - 160 / splitBox.width;
    const withRatio = (node) =>
      node.kind === 'pane' ? node : node.id === holderSplit.id ? { ...node, ratio: narrowRatio } : { ...node, first: withRatio(node.first), second: withRatio(node.second) };
    await zreq(s, 'layout.set', { layout: { ...layout, root: withRatio(layout.root) } });
    const emptySel = `[data-pane-id=${JSON.stringify(splitPane)}] .empty-pane`;
    await s.waitFor(`(document.querySelector(${JSON.stringify(emptySel)})?.getBoundingClientRect().width ?? 999) < 175`, 'the empty pane at about 160px');
    await sleep(300);
    const narrowEmpty = await s.evalJs(
      `(() => { const e = document.querySelector(${JSON.stringify(emptySel)}); const r = e.getBoundingClientRect(); const rows = [...e.querySelectorAll('.session-row')].map((x) => x.getBoundingClientRect().right); return { width: r.width, right: r.right, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, rows }; })()`,
    );
    expect(narrowEmpty.rows.length >= 2, `the empty pane lists the live sessions, got ${JSON.stringify(narrowEmpty)}`);
    expect(narrowEmpty.scrollWidth === narrowEmpty.clientWidth, `no sideways overflow in a ${Math.round(narrowEmpty.width)}px empty pane, got ${JSON.stringify(narrowEmpty)}`);
    expect(narrowEmpty.rows.every((x) => x <= narrowEmpty.right + 0.5), `every row ends inside the pane, got ${JSON.stringify(narrowEmpty)}`);
    await s.screenshot('m9-fix37-narrow-empty.png');
    step(`M9 fix 37: a ${Math.round(narrowEmpty.width)}px empty pane lists its sessions with no sideways scroll`);

    // The sibling-close half of fix 36: closing the empty pane collapses the
    // split and the holder moves up a level, which React re-mounts.
    await s.key('W', 'KeyW', 87, CTRL | SHIFT);
    await s.waitFor(`document.querySelectorAll('.pane').length === ${panesBefore36}`, 'the empty pane closed');
    await sleep(600);
    const collapsed36 = await termProbe();
    expect(collapsed36 !== null && collapsed36.tag === 'kept' && collapsed36.elementInHost && (await attaches()) === 0, `the terminal survived the sibling close too, got ${JSON.stringify(collapsed36)} with ${await attaches()} attaches`);
    step('M9 fix 36: the terminal survives its sibling closing as well');

    // A session moved to another pane (a drop, the palette, showSession)
    // gets a new handle there while the old pane's handle is parked, and
    // the parked one's dispose came 250 ms after the new attach; before
    // the fix its pty.detach took the new pane's attachment with it, so
    // the moved session's output stopped. Two sessions swap panes here,
    // and after the park timer both still receive what they print.
    layout = await getLayout(s);
    const holderSession = leaves(layout).find((p) => p.id === addedPane).sessionId;
    const other = leaves(layout).find((p) => p.id !== addedPane && p.sessionId !== null);
    expect(holderSession !== null && other !== undefined, 'a second pane with a session to swap with');
    const swapped = (node) =>
      node.kind === 'pane'
        ? node.id === addedPane
          ? { ...node, sessionId: other.sessionId }
          : node.id === other.id
            ? { ...node, sessionId: holderSession }
            : node
        : { ...node, first: swapped(node.first), second: swapped(node.second) };
    await zreq(s, 'layout.set', { layout: { ...layout, root: swapped(layout.root) } });
    const otherSel = `[data-pane-id=${JSON.stringify(other.id)}] .term-host`;
    await s.waitFor(`document.querySelector(${JSON.stringify(otherSel)})?.emeraldTerm?.__fix36 !== 'kept'`, 'a fresh terminal in the other pane');
    await sleep(700);
    const bufferHas = (sel, text) =>
      s.evalJs(`(() => { const t = document.querySelector(${JSON.stringify(sel)})?.emeraldTerm; if (!t) return false; const b = t.buffer.active; for (let i = 0; i < b.length; i++) if (b.getLine(i)?.translateToString(true).includes(${JSON.stringify(text)})) return true; return false; })()`);
    await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(holderSession)}, data: 'echo swap-ok-1\\r' })`);
    await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(other.sessionId)}, data: 'echo swap-ok-2\\r' })`);
    const until36 = Date.now() + 8000;
    while (Date.now() < until36 && !((await bufferHas(otherSel, 'swap-ok-1')) && (await bufferHas(`${holderSel} .term-host`, 'swap-ok-2')))) await sleep(200);
    expect(await bufferHas(otherSel, 'swap-ok-1'), 'the moved session still prints into its new pane after the park timer');
    expect(await bufferHas(`${holderSel} .term-host`, 'swap-ok-2'), 'and so does the one moved the other way');
    step('M9 fix 36: two sessions swapped between panes keep receiving output after the parked handles go');
  });

  await block('m43', async () => {
    // M43: the title row in the frame's place. It is the window's drag
    // region, 26px tall at the top of the page, as wide as the caption
    // buttons leave it (the overlay's titlebar area), and its summary counts
    // the live sessions and the panes on show, following a kill. In full
    // screen the row goes, told by the main process (the overlay's visible
    // flag stays true under Electron, so it is not read for that); the
    // Fullscreen API needs a user gesture, which CDP grants on the evaluate,
    // and it fires the same window events as F11.
    const titleProbe = () =>
      s.evalJs(
        `(() => { const bar = document.querySelector('.title-bar'); const r = bar.getBoundingClientRect(); const o = navigator.windowControlsOverlay; const area = o ? o.getTitlebarAreaRect() : null; return { x: r.x, y: r.y, width: r.width, height: r.height, region: getComputedStyle(bar).webkitAppRegion, hidden: bar.hidden, overlayVisible: o ? o.visible : null, area: area ? { x: area.x, y: area.y, width: area.width, height: area.height } : null, inner: window.innerWidth, summary: bar.querySelector('.title-bar-summary')?.textContent ?? null, mark: bar.querySelector('.title-bar-mark')?.textContent ?? null }; })()`,
      );
    const expectedSummary = async () => {
      const live = (await zreq(s, 'session.list', {})).sessions.filter((x) => x.state !== 'exited').length;
      const panes = leaves(await getLayout(s)).filter((p) => p.sessionId !== null).length;
      const word = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
      return `${word(live, 'session')}, ${word(panes, 'pane')} on screen`;
    };
    const titleBar = await titleProbe();
    expect(titleBar.height === 26 && titleBar.y === 0 && titleBar.x === 0, `the title bar is 26px at the top of the page (${JSON.stringify(titleBar)})`);
    expect(titleBar.region === 'drag', `the title bar is the drag region (${titleBar.region})`);
    expect(titleBar.overlayVisible === true && titleBar.area !== null, 'the window controls overlay is on and visible');
    expect(titleBar.area.height === 26 && titleBar.area.width < titleBar.inner - 100, `the caption buttons take the right end of the row (${JSON.stringify(titleBar.area)} of ${titleBar.inner})`);
    expect(Math.abs(titleBar.width - titleBar.area.width) <= 1, `the bar stops where the buttons start (${titleBar.width} vs ${titleBar.area.width})`);
    expect(titleBar.mark === 'Z', 'the amber Z');
    const summaryBefore = await expectedSummary();
    expect(titleBar.summary === summaryBefore, `the summary reads ${titleBar.summary} for ${summaryBefore}`);
    const victimPane = leaves(await getLayout(s)).find((p) => p.sessionId !== null);
    await zreq(s, 'session.kill', { sessionId: victimPane.sessionId, remove: true });
    await s.waitFor(`!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(victimPane.sessionId)}]')`, 'the killed session gone from the sidebar');
    const after = await titleProbe();
    const summaryAfter = await expectedSummary();
    expect(after.summary === summaryAfter, `the summary follows a kill: ${after.summary} for ${summaryAfter}`);
    expect(after.summary !== titleBar.summary, `and moved from ${titleBar.summary}`);
    await s.send('Runtime.evaluate', { expression: 'document.documentElement.requestFullscreen()', userGesture: true, awaitPromise: true });
    await s.waitFor(`document.querySelector('.title-bar').hidden && getComputedStyle(document.querySelector('.title-bar')).display === 'none'`, 'the title bar gone in full screen', 10000);
    await s.evalJs('document.exitFullscreen()');
    await s.waitFor(`!document.querySelector('.title-bar').hidden && document.querySelector('.title-bar').getBoundingClientRect().height === 26`, 'the title bar back after full screen', 10000);
    step(`M43: a 26px drag-region title bar ${Math.round(titleBar.width)}px wide beside ${titleBar.inner - Math.round(titleBar.area.width)}px of caption buttons, its summary ${titleBar.summary} then ${after.summary}, hidden in full screen`);

    // M9 fix 88: the four units of the folder headings, totalled over
    // every folder, sit on the title bar after the summary, so the box
    // reads with the sidebar collapsed; the summary no longer says the
    // agents out in words. Read both off the DOM and compare.
    const unitsIn = (scope) =>
      s.evalJs(
        `(() => { const out = {}; for (const u of document.querySelectorAll(${JSON.stringify(scope)} + ' .roster-unit')) { const k = u.dataset.unit; out[k] = (out[k] ?? 0) + Number(u.querySelector('.roster-count').textContent); } return Object.fromEntries(Object.entries(out).sort()); })()`,
      );
    const headingUnitSum = await unitsIn('.sidebar-group-title .roster[data-size="heading"]');
    const barUnitSum = await unitsIn('.title-bar .roster[data-size="title"]');
    expect(Object.keys(barUnitSum).length > 0, `the title bar carries units (${JSON.stringify(barUnitSum)})`);
    expect(JSON.stringify(barUnitSum) === JSON.stringify(headingUnitSum), `the title bar's units are the headings' summed: ${JSON.stringify(barUnitSum)} vs ${JSON.stringify(headingUnitSum)}`);
    // M73 task 3: the units' hover opens the headings' card with every
    // session, in place of the words the title attribute carried.
    expect((await s.evalJs(`document.querySelector('.title-bar .roster[data-size="title"]').getAttribute('title')`)) === null, 'the title bar\'s roster carries no title tooltip; its card is the tooltip (M73)');
    const barRosterAt = await hoverForCard('.title-bar .roster[data-size="title"]', "the title bar's roster opens the card on hover");
    const barCard = await s.evalJs(`(() => { const c = document.querySelector('.roster-popover'); return { lines: [...c.querySelectorAll('.roster-card-unit')].map((u) => u.querySelector('.roster-card-text').textContent), members: [...c.querySelectorAll('.roster-card-member')].map((m) => m.dataset.sessionId) }; })()`);
    const aliveIds = (await zreq(s, 'session.list', {})).sessions.filter((x) => x.state !== 'exited').map((x) => x.id).sort();
    const barTitle = barCard.lines.join(', ');
    expect(barCard.lines.length > 0 && barCard.lines.every((l) => /^\d+ (agents?|shells?) /.test(l)), `the card explains the units in words, got ${JSON.stringify(barCard.lines)}`);
    expect(JSON.stringify([...barCard.members].sort()) === JSON.stringify(aliveIds), `the card lists every live session over every folder, got ${barCard.members.length} for ${aliveIds.length}`);
    await s.click(barRosterAt.x, barRosterAt.y);
    await s.waitFor(`document.querySelector('.title-bar .roster[data-size="title"]').dataset.popoverOpen === 'pinned'`, 'a click on the roster pins the card');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.roster-popover')`, 'Escape closes it');
    // The bar stays a drag region everywhere but the roster. A synthetic
    // drag never reaches the native hit test, and the harness window pins
    // itself back on any move, so the regions are read as computed.
    const regions = await s.evalJs(`(() => { const region = (sel) => { const st = getComputedStyle(document.querySelector(sel)); return st.getPropertyValue('app-region') || st.getPropertyValue('-webkit-app-region') || st.appRegion || st.webkitAppRegion || null; }; return { bar: region('.title-bar'), name: region('.title-bar-name'), roster: region('.title-bar-roster') }; })()`);
    expect(regions.bar === 'drag' && regions.name === 'drag' && regions.roster === 'no-drag', `the bar and its name drag the window and the roster does not, got ${JSON.stringify(regions)}`);
    expect(!/agent/.test(after.summary), `the summary no longer says the agents in words (${after.summary})`);
    const barCell = await s.evalJs(`(() => { const m = document.querySelector('.title-bar .roster[data-size="title"] .session-mark, .title-bar .roster[data-size="title"] .shell-mark'); const r = m.getBoundingClientRect(); const bar = document.querySelector('.title-bar').getBoundingClientRect(); return { height: Math.round(r.height), inside: r.top >= bar.top && r.bottom <= bar.bottom }; })()`);
    expect(barCell.height <= 14 && barCell.inside, `a title-size mark fits the 26px bar (${JSON.stringify(barCell)})`);
    await s.evalJs(`document.querySelector('.sidebar-collapse').click()`);
    await s.waitFor(`document.querySelector('.sidebar-rail') !== null`, 'the sidebar collapsed');
    const barUnitsCollapsed = await unitsIn('.title-bar .roster[data-size="title"]');
    expect(JSON.stringify(barUnitsCollapsed) === JSON.stringify(barUnitSum), `the units stay with the sidebar collapsed: ${JSON.stringify(barUnitsCollapsed)}`);
    await s.evalJs(`document.querySelector('.sidebar-expand').click()`);
    await s.waitFor(`document.querySelector('.sidebar-collapse') !== null`, 'the sidebar back');
    step(`M9 fix 88 and M73 task 3: the title bar carries the headings' units ${JSON.stringify(barUnitSum)}, its card says "${barTitle}" and lists every live session, the roster alone is no-drag, the same units with the sidebar collapsed`);
    // M9 fix 91: a click on a row whose session is on no pane, while the
    // focused pane holds a live session, asks before it replaces. Two
    // shells spawned through the daemon sit on no pane; a pane holding a
    // session is focused by a click on it. The chooser hangs under the
    // row; Open beside adds a pane and leaves the old one; Show here with
    // Remember replaces and the next click asks nothing; Ask again on the
    // row menu brings the chooser back; Shift+click opens beside without
    // asking; the row menu's two chooserList say already on screen for a shown
    // session.
    const rowBox = (id) => s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    const clickRow = async (id, modifiers = 0) => {
      const c = await rowBox(id);
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers });
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers });
    };
    const chooserItems = () => s.evalJs(`[...document.querySelectorAll('.show-chooser .menu-item')].map(b => ({ label: b.querySelector('.menu-label').textContent, hint: b.querySelector('.menu-hint')?.textContent ?? null, checked: b.dataset.checked ?? null }))`);
    const chooserClick = (label) => s.evalJs(`[...document.querySelectorAll('.show-chooser .menu-item')].find(b => b.querySelector('.menu-label').textContent.endsWith(${JSON.stringify(label)})).click()`);
    const focusedNow = async () => {
      const l = await getLayout(s);
      return leaves(l).find((p) => p.id === l.focusedPaneId)?.sessionId ?? null;
    };
    const paneCount = async () => leaves(await getLayout(s)).length;
    const onPane = async (id) => leaves(await getLayout(s)).some((p) => p.sessionId === id);
    const noChooser = async () => {
      await sleep(300);
      return (await s.evalJs(`!document.querySelector('.show-chooser')`)) === true;
    };
    await s.evalJs(`localStorage.removeItem('emerald.showOffscreen')`);
    // The pane to start from holds a fresh shell placed through the daemon
    // (the steps above leave killed sessions about), and it is focused by a
    // click on its terminal.
    const liveHolder = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 })).session;
    const startTree = await getLayout(s);
    const livePane = leaves(startTree).find((p) => p.sessionId === null) ?? leaves(startTree)[0];
    const seeded = (node) => (node.kind === 'pane' ? (node.id === livePane.id ? { ...node, sessionId: liveHolder.id } : node) : { ...node, first: seeded(node.first), second: seeded(node.second) });
    await zreq(s, 'layout.set', { layout: { ...startTree, root: seeded(startTree.root), focusedPaneId: livePane.id } });
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(liveHolder.id)}]')?.dataset.shown === 'focused'`, 'the fresh shell placed and focused');
    await s.click(...Object.values(await centerOf(s, `[data-pane-id=${JSON.stringify(livePane.id)}] .term-host`)));
    await s.waitFor(focusedPaneIs(livePane.id), 'the pane holding a session is focused');
    const offX = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 })).session;
    const offY = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 })).session;
    await s.waitFor(`!!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(offY.id)}]')`, 'the two off-screen rows');
    expect(!(await onPane(offX.id)) && !(await onPane(offY.id)), 'neither spawned session is on a pane');
    const panesAtStart = await paneCount();
    await clickRow(offX.id);
    await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(offX.id)}`, 'the chooser under the row');
    const chooserList = await chooserItems();
    expect(chooserList.length === 4 && chooserList[0].label === 'Show here' && chooserList[1].label === 'Open beside' && chooserList[2].label === 'Open in a new tab' && chooserList[2].hint === 'a tab of its own' && chooserList[3].label.endsWith('Remember my choice') && chooserList[3].checked === 'false', `the chooser's four items (${JSON.stringify(chooserList)})`);
    expect(chooserList[0].hint === `replaces ${liveHolder.name}, which stays running`, `the hint names the session that would go off screen (${chooserList[0].hint})`);
    expect((await focusedNow()) === liveHolder.id, 'nothing changed while the chooser is open');
    await chooserClick('Open beside');
    await s.waitFor(`!document.querySelector('.show-chooser')`, 'the chooser closed on Open beside');
    await s.waitFor(`document.querySelectorAll('.pane').length === ${panesAtStart + 1}`, 'one more pane');
    expect((await focusedNow()) === offX.id, 'the new pane holds the clicked session and is focused');
    expect(await onPane(liveHolder.id), 'the old pane keeps its session');
    await clickRow(offY.id);
    await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(offY.id)}`, 'the chooser for the second row');
    await chooserClick('Remember my choice');
    await s.waitFor(`document.querySelector('.show-chooser [data-checked="true"]') !== null`, 'Remember ticked and the chooser still open');
    await chooserClick('Show here');
    await s.waitFor(`!document.querySelector('.show-chooser')`, 'the chooser closed on Show here');
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(offY.id)}]')?.dataset.shown === 'focused'`, 'the second session took the focused pane');
    expect((await paneCount()) === panesAtStart + 1 && !(await onPane(offX.id)), 'Show here replaced rather than split');
    expect((await s.evalJs(`localStorage.getItem('emerald.showOffscreen')`)) === 'replace', 'the choice is remembered');
    await clickRow(offX.id);
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(offX.id)}]')?.dataset.shown === 'focused'`, 'a third click replaces without asking');
    expect(await noChooser(), 'no chooser on the third click');
    await s.rightClick(...Object.values(await rowBox(offY.id)));
    await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(offY.id)}`, 'the row menu');
    const rowMenuLabels = await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent)`);
    expect(rowMenuLabels.includes('Ask again on click') && rowMenuLabels.includes('Show here') && rowMenuLabels.includes('Open beside'), `the row menu offers the two answers and Ask again (${rowMenuLabels.join(', ')})`);
    expect(rowMenuLabels.indexOf('Open in a new tab') === rowMenuLabels.indexOf('Open beside') + 1, `Open in a new tab sits right under Open beside (${rowMenuLabels.join(', ')})`);
    await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Ask again on click').click()`);
    await s.waitFor(`!document.querySelector('.row-menu')`, 'the row menu closed');
    expect((await s.evalJs(`localStorage.getItem('emerald.showOffscreen')`)) === 'ask', 'Ask again forgot the choice');
    await clickRow(offY.id);
    await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(offY.id)}`, 'the chooser is back');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.show-chooser')`, 'Escape closed it');
    expect((await focusedNow()) === offX.id, 'Escape changed nothing');
    await clickRow(offY.id, SHIFT);
    await s.waitFor(`document.querySelectorAll('.pane').length === ${panesAtStart + 2}`, 'Shift+click opened a pane beside');
    expect(await noChooser(), 'no chooser on Shift+click');
    expect((await focusedNow()) === offY.id && (await onPane(offX.id)), 'the new pane holds the Shift-clicked session and the old one stays');
    await s.rightClick(...Object.values(await rowBox(offY.id)));
    await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(offY.id)}`, 'the row menu of a shown session');
    const shownItems = await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].filter(b => ['Show here', 'Open beside', 'Open in a new tab'].includes(b.querySelector('.menu-label').textContent)).map(b => ({ disabled: b.disabled, title: b.title }))`);
    expect(shownItems.length === 3 && shownItems.every((i) => i.disabled && i.title === 'Already on screen'), `the three answers are off for a session on screen (${JSON.stringify(shownItems)})`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.row-menu')`, 'the row menu closed again');
    step('M9 fix 91: an off-screen row asks Show here or Open beside, beside adds a pane, Remember makes the answer stick, Ask again and Shift+click');
    // M9 fix 578: this script runs on a daemon that reports level 1, where layout tabs are unsupported, so the tab the chooser's and the row menu's Open in a new tab make is read in verify:tabs; the items themselves are read above.
    // M9 fix 95: a view pane (M52) in the focused pane is asked about too,
    // named by its folder, since a view is not kept anywhere once replaced.
    // The focused pane, holding offY, is given a commits view on the repo
    // through the daemon; a click on a fresh off-screen row reads the
    // chooser with the folder in its hint, Open beside leaves the view,
    // and Show here on the next row takes it.
    const viewTree = await getLayout(s);
    const viewPaneId = viewTree.focusedPaneId;
    const viewed = (node) => (node.kind === 'pane' ? (node.id === viewPaneId ? { ...node, sessionId: null, view: { kind: 'commits', folder: repoRoot } } : node) : { ...node, first: viewed(node.first), second: viewed(node.second) });
    await zreq(s, 'layout.set', { layout: { ...viewTree, root: viewed(viewTree.root) } });
    await s.waitFor(`document.querySelector('.pane[data-view="commits"][data-pane-id=${JSON.stringify(viewPaneId)}]') !== null`, 'the focused pane shows a commits view');
    await s.click(...Object.values(await centerOf(s, `[data-pane-id=${JSON.stringify(viewPaneId)}] .pane-view`)));
    await s.waitFor(focusedPaneIs(viewPaneId), 'the view pane is focused');
    const offZ = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 })).session;
    await s.waitFor(`!!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(offZ.id)}]')`, 'a third off-screen row');
    const panesBeforeView = await paneCount();
    await clickRow(offZ.id);
    await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(offZ.id)}`, 'the chooser over a view pane');
    const viewChooser = await chooserItems();
    const repoName = repoRoot.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    expect(viewChooser[0]?.hint === `replaces Commits · ${repoName}, which is not kept`, `the hint names the view by its folder (${viewChooser[0]?.hint})`);
    await chooserClick('Open beside');
    await s.waitFor(`document.querySelectorAll('.pane').length === ${panesBeforeView + 1}`, 'Open beside added a pane');
    expect(leaves(await getLayout(s)).some((l) => l.id === viewPaneId && l.view?.kind === 'commits'), 'the view pane is still there');
    await s.click(...Object.values(await centerOf(s, `[data-pane-id=${JSON.stringify(viewPaneId)}] .pane-view`)));
    await s.waitFor(focusedPaneIs(viewPaneId), 'the view pane is focused again');
    const offW = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 })).session;
    await s.waitFor(`!!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(offW.id)}]')`, 'a fourth off-screen row');
    await clickRow(offW.id);
    await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(offW.id)}`, 'the chooser over the view pane again');
    await chooserClick('Show here');
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(offW.id)}]')?.dataset.shown === 'focused'`, 'Show here put the session in the view pane');
    expect(!leaves(await getLayout(s)).some((l) => l.view !== null), 'the view is gone');
    step('M9 fix 95: a view pane in the focused pane is asked about, named by its folder, Open beside leaves it and Show here takes it');
  });

  await block('fix-93', async () => {
    // M9 fix 93: the rename box in a narrow pane title keeps the room the
    // name had (it was 0px wide once the squeeze unfolded the roster and
    // the context around it), a click outside keeps what was typed, and
    // Escape discards.
    // The narrowest pane wide enough to still show its name (the earlier
    // steps leave slivers of 30px whose name is hidden), between 200 and
    // 360px; the widest pane is split until one is in that band.
    // Shown, not merely present: fix 237's sixth level hides the name of a sliver.
    const thinPane = () => s.evalJs(`(() => { const ps = [...document.querySelectorAll('.pane')].filter(p => p.querySelector('.pane-name')?.getClientRects().length > 0).map(p => ({ id: p.dataset.paneId, width: p.getBoundingClientRect().width })); const fit = ps.filter(p => p.width >= 200 && p.width < 360).sort((a, b) => a.width - b.width); return { fit: fit[0] ?? null, widest: ps.sort((a, b) => b.width - a.width)[0] ?? null }; })()`);
    let thinPick = await thinPane();
    for (let i = 0; i < 4 && thinPick.fit === null && thinPick.widest !== null; i += 1) {
      await splitWithShell(s, `[data-pane-id=${JSON.stringify(thinPick.widest.id)}] .pane-split-right`);
      await sleep(400);
      thinPick = await thinPane();
    }
    const thin = thinPick.fit;
    expect(thin !== null && thin.width < 360, `a pane between 200 and 360px to rename in (${JSON.stringify(thinPick)})`);
    const thinSession = await sessionOf(s, thin.id);
    const nameBefore = await nameOf(thin.id);
    const nameSel = `[data-pane-id=${JSON.stringify(thin.id)}] .pane-name`;
    const nameWidth = await s.evalJs(`document.querySelector(${JSON.stringify(nameSel)}).getBoundingClientRect().width`);
    const dblclickName = async () => {
      const c = await centerOf(s, nameSel);
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 2 });
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 2 });
      await s.waitFor(`document.activeElement?.className === 'pane-rename'`, 'the rename box in the thin title');
    };
    await dblclickName();
    const box93 = await s.evalJs(`(() => { const el = document.querySelector('.pane-rename'); return { width: el.getBoundingClientRect().width, value: el.value, flex: getComputedStyle(el).flexGrow, squeeze: el.closest('.pane-title').dataset.squeeze ?? null }; })()`);
    expect(box93.value === nameBefore, `the box holds the name (${JSON.stringify(box93.value)} for ${JSON.stringify(nameBefore)})`);
    expect(box93.width >= 60 && box93.width >= nameWidth - 1, `the box is at least as wide as the name was (${box93.width}px for a ${nameWidth}px name) and never empty`);
    expect(box93.flex === '0', `the box takes no slack (flex-grow ${box93.flex})`);
    await s.type('kept by click');
    const terminalSpot = await centerOf(s, `[data-pane-id=${JSON.stringify(thin.id)}]`);
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: terminalSpot.x, y: terminalSpot.y, button: 'left', clickCount: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: terminalSpot.x, y: terminalSpot.y, button: 'left', clickCount: 1 });
    await waitName(thin.id, 'kept by click', 'a click outside kept the typed name on the title');
    expect((await rowName(thinSession.id)) === 'kept by click', 'and on the row');
    await dblclickName();
    await s.type('dropped');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.pane-rename')`, 'Escape closed the box');
    expect((await nameOf(thin.id)) === 'kept by click', 'Escape left the name as it was');
    step('M9 fix 93: the rename box keeps the name\'s room in a narrow title, a click outside keeps the name, Escape discards');

    // M9 fix 143: tokens sent and received since the process started, on
    // the row after the context percent, summed over requests from the
    // status line's per-request counts: a line with the same input split
    // as the last is the same request streaming and replaces its output
    // rather than adding; the card the reading opens holds the whole
    // counts with the sent side split; a shell row has no such span. The
    // session sits in a folder on main (a bare .git/HEAD) so its row
    // carries a branch, the shape fix 146 reads below.
    const tokensRepo = path.join(os.tmpdir(), 'emerald-verify', 'm9-tokens-repo');
    fs.mkdirSync(path.join(tokensRepo, '.git'), { recursive: true });
    fs.writeFileSync(path.join(tokensRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const { session: counted } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: tokensRepo, name: 'counted', cols: 100, rows: 30 });
    const countedRowSel = `.sidebar-row[data-session-id=${JSON.stringify(counted.id)}]`;
    const postCounted = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${restarted.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': restarted.hookToken, 'X-Emerald-Session': counted.id },
        body: JSON.stringify({ session_id: 'sim-m9-143', cwd: tokensRepo, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    const statusLine = (input, write, read, output) => ({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 8, context_window_size: 1000000, total_input_tokens: input + write + read, total_output_tokens: output, current_usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: write, cache_read_input_tokens: read } } });
    const tokensOnRow = () => s.evalJs(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-tokens')})?.textContent ?? null`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(countedRowSel)})`, 'the counted row');
    expect((await tokensOnRow()) === null && (await s.evalJs(`!!document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(thinSession.id)}] .sidebar-row-tokens`)})`)) === false, 'no tokens span on a shell row before any counted status line');
    await postCounted({ hook_event_name: 'SessionStart', source: 'startup' });
    await postCounted(statusLine(2, 14649, 40100, 130));
    await postCounted(statusLine(2, 3869, 54749, 134));
    // The row's text carries the cached share since M9 fix 154; the two requests read 94.8k from the cache.
    await s.waitFor(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-tokens')})?.textContent === '\u2191113.4k (94.8k cached) \u2193264'`, 'two requests summed on the row, the cached share in the reading');
    await postCounted(statusLine(2, 3869, 54749, 2665));
    await s.waitFor(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-tokens')})?.textContent === '\u2191113.4k (94.8k cached) \u21932.8k'`, 'the same split streaming replaces its output, 134 to 2665, and adds nothing sent');
    // The row is in a group of its own below the fold of the list; the hover needs it on screen.
    const tokensAt = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-tokens')}); el.closest('.sidebar-row').scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const p = el.previousElementSibling.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, afterPercent: r.left >= p.right - 0.5, percent: el.previousElementSibling.className, title: el.getAttribute('title') }; })()`);
    expect(tokensAt.afterPercent && tokensAt.percent === 'sidebar-row-context-percent' && tokensAt.title === null, `the span sits after the percent with no title of its own (${JSON.stringify(tokensAt)})`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tokensAt.x, y: tokensAt.y });
    await s.waitFor(`!!document.querySelector('.context-popover .context-popover-tokens')`, 'the context card opens on the tokens with its Since the start row', 3000);
    // Since M9 fix 154 the card's sum is a table, a row per part with its count whole.
    const tokensCard = await s.evalJs(`(() => { const c = document.querySelector('.context-popover .context-popover-tokens'); const rows = [...c.querySelectorAll('.context-popover-parts tr')].map((r) => [r.dataset.part, r.querySelector('.context-popover-count').textContent]); return { heading: c.querySelector('.context-popover-tokens-heading').textContent, rows, sent: c.querySelector('.context-popover-token-totals').textContent }; })()`);
    expect(tokensCard.heading === 'Since the start' && JSON.stringify(tokensCard.rows) === JSON.stringify([['fresh', '4'], ['cache-write', '18,518'], ['cache-read', '94,849'], ['output', '2,795']]) && tokensCard.sent.startsWith('sent 113,371, received 2,795'), `the card holds the whole counts with the sent side split (${JSON.stringify(tokensCard)})`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector('.context-popover')`, 'the card closes after the mouse leaves');
    step('M9 fix 143: two requests read \u2191113.4k \u2193264 on the row, a streaming line replaces its output to \u21932.8k, the card holds the whole counts, a shell row has no span');

    // M9 fix 146: the tokens stay on a row on screen with a branch at the
    // default sidebar width. Fix 143 put the span in the level-1 squeeze
    // with the shown word, which hid it on every such row at 260px; it has
    // a level of its own now, after the words and the percent. The
    // counted session (on main, with the reading and the tokens) goes
    // into the thin pane, so its row is on screen: at the default width
    // the span is visible and whole with the level at 2 or under; the
    // sidebar walked down to its minimum keeps the span until level 3 and
    // never brings it back below; the default width brings it back. Then
    // the title in the thin pane: with a tokens span the title has three
    // levels, the tokens whole at 0 and 1 and gone at 2, the state word
    // whole either way (the fix 77 walk above reads the thresholds).
    const defaultSidebar = await sidebarWidthNow();
    let layout = await getLayout(s);
    const parkedInThin = leaves(layout).find((p) => p.id === thin.id).sessionId;
    await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, thin.id, counted.id) } });
    await s.waitFor(`document.querySelector(${JSON.stringify(countedRowSel)})?.dataset.shown !== undefined && document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-branch-name')})?.textContent === 'main'`, 'the counted row is on screen with its branch');
    const countedSub = () =>
      s.evalJs(`(() => {
      const sub = document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-sub')});
      const vis = (el) => el !== null && el.getClientRects().length > 0;
      const t = sub.querySelector('.sidebar-row-tokens');
      return {
        width: document.querySelector('.sidebar').getBoundingClientRect().width,
        level: sub.dataset.squeeze ?? null,
        tokens: vis(t),
        // Whole by the squeeze's own rule (squeeze-model.ts): an overflow of a pixel or less is not clipped.
        tokensWhole: t !== null && vis(t) && t.scrollWidth <= t.clientWidth + 1 && t.getBoundingClientRect().right <= sub.getBoundingClientRect().right + 1,
        text: t?.textContent ?? null,
        tokensBox: t === null ? null : { sw: t.scrollWidth, cw: t.clientWidth, right: t.getBoundingClientRect().right, subRight: sub.getBoundingClientRect().right, subSw: sub.scrollWidth, subCw: sub.clientWidth },
        cached: vis(sub.querySelector('.sidebar-row-tokens .tokens-cached')),
        branch: vis(sub.querySelector('.sidebar-row-branch-name')),
        lineClipped: sub.scrollWidth > sub.clientWidth + 1,
      };
    })()`);
    const atDefault = await countedSub();
    // The box reads 261: the 260px default and its 1px border.
    expect(atDefault.width === defaultSidebar && Math.abs(atDefault.width - 260) <= 1, `the sidebar is at its default width, got ${atDefault.width}`);
    expect(atDefault.tokens && atDefault.tokensWhole && atDefault.text === '\u2191113.4k (94.8k cached) \u21932.8k' && Number(atDefault.level) <= 2 && atDefault.branch && !atDefault.lineClipped, `at the default width the row on screen with a branch keeps its tokens whole at level 2 or under, got ${JSON.stringify(atDefault)}`);
    const countedReadings = [];
    for (let target = 240; target >= 180; target -= 20) {
      await dragSidebar(target - (await sidebarWidthNow()));
      await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === ${target}`, `the sidebar at ${target}px`);
      countedReadings.push(await countedSub());
    }
    let tokensGone = null;
    for (const r of countedReadings) {
      const level = Number(r.level);
      expect(r.tokens === (level < 3) && (level >= 3 || r.tokensWhole), `at ${r.width}px level ${level} the tokens are ${level < 3 ? 'whole' : 'gone'}, got ${JSON.stringify(r)}`);
      // M9 fix 154: the cached share is the first drop, at level 1, the reading staying whole without it.
      expect(r.cached === (level === 0), `at ${r.width}px level ${level} the cached share is ${level === 0 ? 'shown' : 'dropped'}, got ${JSON.stringify(r)}`);
      if (!r.tokens && tokensGone === null) tokensGone = r;
      if (tokensGone !== null) expect(!r.tokens, `below ${tokensGone.width}px the tokens stay gone, got ${JSON.stringify(r)}`);
    }
    await dragSidebar(defaultSidebar - (await sidebarWidthNow()));
    await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === ${defaultSidebar}`, 'the sidebar back at its default width');
    const backDefault = await countedSub();
    expect(backDefault.tokens && backDefault.tokensWhole && backDefault.level === atDefault.level, `back at ${defaultSidebar}px the tokens are back at level ${atDefault.level}, got ${JSON.stringify(backDefault)}`);
    // The title in the thin pane: eight levels since fix 237 (the tokens go at 2, the buttons after, the line itself from 5); the state whole below the fifth level and gone from it.
    const thinTitle = await s.evalJs(`(() => {
    const title = document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-title`)});
    const vis = (el) => el !== null && el.getClientRects().length > 0;
    const t = title.querySelector('.pane-tokens');
    const state = title.querySelector('.pane-state');
    const context = title.querySelector('.pane-context');
    return {
      width: Math.round(title.getBoundingClientRect().width),
      level: title.dataset.squeeze ?? null,
      tokens: vis(t),
      tokensWhole: t !== null && vis(t) && t.scrollWidth <= t.clientWidth + 1 && t.getBoundingClientRect().right <= context.getBoundingClientRect().right + 0.5,
      stateWhole: state !== null && state.scrollWidth <= state.clientWidth + 1,
      stateShown: state !== null && getComputedStyle(state).display !== 'none',
      contextMin: getComputedStyle(context).minWidth,
    };
  })()`);
    expect(thinTitle.level !== null && Number(thinTitle.level) <= 7, `the thin title has a level with a tokens span, got ${JSON.stringify(thinTitle)}`);
    expect(thinTitle.tokens === (Number(thinTitle.level) < 2) && (Number(thinTitle.level) >= 2 || thinTitle.tokensWhole) && thinTitle.stateShown === (Number(thinTitle.level) < 5) && (!thinTitle.stateShown || thinTitle.stateWhole), `at ${thinTitle.width}px level ${thinTitle.level} the title's tokens are ${Number(thinTitle.level) < 2 ? 'whole' : 'gone'} and the state word ${Number(thinTitle.level) < 5 ? 'whole' : 'gone'} (fix 237), got ${JSON.stringify(thinTitle)}`);
    expect((Number(thinTitle.level) < 2) === (thinTitle.contextMin !== '11px'), `the reading's box holds its content only while the tokens show, got ${JSON.stringify(thinTitle)}`);
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, thin.id, parkedInThin) } });
    step(`M9 fix 146: the counted row on screen with main keeps \u2191113.4k \u21932.8k whole at ${defaultSidebar}px (level ${atDefault.level}), ${tokensGone === null ? 'and down to 180px' : `gone from ${tokensGone.width}px at level ${tokensGone.level}`}; the ${thinTitle.width}px title at level ${thinTitle.level} with the tokens ${thinTitle.tokens ? 'whole' : 'gone'} and the state whole`);
    // M9 fix 154: the context card prices the session. A status line on
    // the counted session carries Claude Code's cost block and a split;
    // the card's table then has a rate and a dollar figure per part from
    // the rate table (Opus 5). Since fix 209 the card's dollar lines come
    // in the order of what they cover: under the parts one line for this
    // pane's own requests, their table total and what the same traffic
    // would have cost uncached (the whole sent count at the fresh rate
    // plus the output at the out rate), then Claude Code's total, which
    // covers the forked agents' requests too, then the stale note blaming
    // the gap on what it can be. A line without the block keeps the
    // figure; the pane title's reading stays bare, with no cached share
    // (ruled 2026-09-14). The row's parenthetical dropping at level 1 with
    // the reading whole is the fix 146 walk's reading above.
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, thin.id, counted.id) } });
    await s.waitFor(`document.querySelector(${JSON.stringify(countedRowSel)})?.dataset.shown !== undefined`, 'the counted row is on screen for the cost');
    const cardCost = () =>
      s.evalJs(`(() => { const c = document.querySelector('.context-popover .context-popover-tokens'); if (!c) return null; const rows = [...c.querySelectorAll('.context-popover-parts tr')].map((r) => [r.dataset.part, r.querySelector('.context-popover-rate').textContent, r.querySelector('.context-popover-usd').textContent]); const order = [...c.querySelectorAll('.context-popover-parts, .context-popover-own, .context-popover-cost, .context-popover-stale')].map((el) => el.className.replace('context-popover-', '')); return { rows, order, own: c.querySelector('.context-popover-own')?.textContent ?? null, cost: c.querySelector('.context-popover-cost')?.textContent ?? null, stale: c.querySelector('.context-popover-stale')?.textContent ?? null }; })()`);
    const openTokensCard = async () => {
      const at = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-tokens')}); el.closest('.sidebar-row').scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
      await s.waitFor(`!!document.querySelector('.context-popover .context-popover-tokens')`, 'the context card opens on the tokens', 3000);
    };
    const closeTokensCard = async () => {
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
      await s.waitFor(`!document.querySelector('.context-popover')`, 'the card closes after the mouse leaves');
    };
    await openTokensCard();
    const before154 = await cardCost();
    expect(before154.cost === null && before154.stale === null && before154.rows.every(([, rate, usd]) => rate.endsWith('/M') && usd.startsWith('$')), `before a costed status line the card prices the parts and shows no total, got ${JSON.stringify(before154)}`);
    expect(before154.own === "this pane's requests: ~$0.23 cached, ~$0.64 uncached · the dollars are an estimate from our rate table" && before154.order.join(',') === 'parts,own', `the pane's own line under the parts before any total, got ${JSON.stringify(before154)}`);
    await closeTokensCard();
    // The same split again with the cost block: 113,371 sent, 2,795 received, Claude Code says $1.40; without caching that is 113,371 at $5 plus 2,795 at $25 per million, about $0.64.
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-cost')})`)) === null, 'no dollars on the row before a costed status line (fix 221)');
    await postCounted({ ...statusLine(2, 3869, 54749, 2665), cost: { total_cost_usd: 1.4029585, total_duration_ms: 4953726 } });
    await s.waitFor(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-tokens')})?.textContent === '\u2191113.4k (94.8k cached) \u21932.8k'`, 'the row reading is unchanged by the cost');
    // M9 fix 221: the dollars land on the row as one bare figure before the
    // tokens, inside the same reading, and squeeze after them: the tokens
    // go at level 3, the dollars at 4, so 180px shows the dollars alone.
    await s.waitFor(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-cost')})?.textContent === '$1.40'`, 'the row carries $1.40');
    const costRow = () => s.evalJs(`(() => {
    const sub = document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-sub')});
    const vis = (el) => el !== null && el.getClientRects().length > 0;
    const c = sub.querySelector('.sidebar-row-cost');
    const t = sub.querySelector('.sidebar-row-tokens');
    return { width: document.querySelector('.sidebar').getBoundingClientRect().width, level: sub.dataset.squeeze ?? null, cost: vis(c), costText: c?.textContent ?? null, costWhole: c !== null && vis(c) && c.scrollWidth <= c.clientWidth + 1 && c.getBoundingClientRect().right <= sub.getBoundingClientRect().right + 1, tokens: vis(t), beforeTokens: c !== null && t !== null && c.nextElementSibling === t, inReading: c?.parentElement.classList.contains('sidebar-row-context') ?? false, title: c?.getAttribute('title') ?? null, lineClipped: sub.scrollWidth > sub.clientWidth + 1 };
  })()`);
    const costDefault = await costRow();
    expect(costDefault.cost && costDefault.costWhole && costDefault.costText === '$1.40' && costDefault.beforeTokens && costDefault.inReading && costDefault.title === null && !costDefault.lineClipped, `at the default width the dollars sit whole before the tokens inside the reading, no title of their own, got ${JSON.stringify(costDefault)}`);
    const costReadings = [];
    for (let target = 240; target >= 180; target -= 20) {
      await dragSidebar(target - (await sidebarWidthNow()));
      await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === ${target}`, `the sidebar at ${target}px`);
      costReadings.push(await costRow());
    }
    for (const r of costReadings) {
      const level = Number(r.level);
      expect(r.tokens === (level < 3) && r.cost === (level < 4) && (level >= 4 || r.costWhole), `at ${r.width}px level ${level} the tokens are ${level < 3 ? 'shown' : 'gone'} and the dollars ${level < 4 ? 'whole' : 'gone'}, got ${JSON.stringify(r)}`);
    }
    expect(costReadings.some((r) => r.cost && !r.tokens), `some width showed the dollars alone, got ${JSON.stringify(costReadings.map((r) => [r.width, r.level, r.cost, r.tokens]))}`);
    await dragSidebar(defaultSidebar - (await sidebarWidthNow()));
    await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width === ${defaultSidebar}`, 'the sidebar back at its default width after the cost walk');
    // The dollars open the same card the tokens do.
    const costAt = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-cost')}); el.closest('.sidebar-row').scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: costAt.x, y: costAt.y });
    await s.waitFor(`!!document.querySelector('.context-popover .context-popover-tokens')`, 'the context card opens on the dollars', 3000);
    await closeTokensCard();
    await s.screenshot('m9-fix221-row-cost.png');
    step(`M9 fix 221: the row reads $1.40 before its tokens at ${defaultSidebar}px, the tokens gone from level 3 and the dollars from 4 (${costReadings.map((r) => `${r.width}:${r.level}`).join(' ')}), the dollars opening the card`);
    await openTokensCard();
    await s.waitFor(`document.querySelector('.context-popover .context-popover-cost') !== null`, 'the total line lands on the card');
    const costed154 = await cardCost();
    expect(JSON.stringify(costed154.rows) === JSON.stringify([['fresh', '$5/M', '$0.00'], ['cache-write', '$6.25/M', '$0.12'], ['cache-read', '$0.5/M', '$0.05'], ['output', '$25/M', '$0.07']]), `the table prices each part at Opus 5's rates, got ${JSON.stringify(costed154.rows)}`);
    expect(costed154.cost === "$1.40 at API rates, subagents included, Claude Code's own figure" && costed154.own === "this pane's requests: ~$0.23 cached, ~$0.64 uncached · the dollars are an estimate from our rate table" && costed154.order.join(',') === 'parts,own,cost,stale', `the pane's own line, then Claude Code's total as the line that covers everything, then the note, got ${JSON.stringify(costed154)}`);
    expect(costed154.stale === "well above this pane's own requests: subagents, an older rate table, or a change of model", `fix 209: the note blames the gap between $1.40 and the pane's $0.23 on what it can be, got ${JSON.stringify(costed154.stale)}`);
    await closeTokensCard();
    await postCounted({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 8 } });
    await sleep(300);
    await openTokensCard();
    expect((await cardCost()).cost === "$1.40 at API rates, subagents included, Claude Code's own figure", 'a status line without the block keeps the figure');
    await closeTokensCard();
    const titleTokens154 = await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-title .pane-tokens`)})?.textContent ?? null`);
    expect(titleTokens154 === '\u2191113.4k \u21932.8k', `the pane title keeps the bare reading, got ${JSON.stringify(titleTokens154)}`);
    const explained154 = await zreq(s, 'session.list', {});
    const counted154 = explained154.sessions.find((x) => x.id === counted.id);
    expect(counted154.costUsd === 1.4029585, `the record carries the cost on the pipe, got ${JSON.stringify(counted154.costUsd)}`);
    step("M9 fix 154: the card prices the four parts at Opus 5 rates, the pane's own line reads ~$0.23 cached and ~$0.64 uncached under them, the total is $1.40 from Claude Code with subagents included and a note blaming the gap (fix 209), a line without the block keeps the figure, the row reads the cached share and the title does not");

    // M9 fix 155: the arrows are marks, a filled SVG each at the text's
    // height on the row, the title and the shade, with the glyph kept in
    // the span but clipped to nothing, so the reading's text is unchanged
    // (the reads above) while what is drawn is an arrow, not a hairline.
    const arrows155 = await s.evalJs(`(() => {
    const read = (sel) => { const el = document.querySelector(sel); if (!el) return null; const arrows = [...el.querySelectorAll('.tokens-arrow')]; return { text: el.textContent, visible: el.getClientRects().length > 0, dirs: arrows.map((a) => a.dataset.dir), icons: arrows.map((a) => { const r = a.querySelector('.tokens-arrow-icon')?.getBoundingClientRect(); return r ? Math.round(r.width) : null; }), glyphs: arrows.map((a) => a.querySelector('.tokens-arrow-text')?.textContent ?? null), glyphBoxes: arrows.map((a) => a.querySelector('.tokens-arrow-text')?.getBoundingClientRect().width ?? null) }; };
    return { row: read(${JSON.stringify(countedRowSel + ' .sidebar-row-tokens')}), title: read(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-title .pane-tokens`)}) };
  })()`);
    for (const [where, r] of Object.entries(arrows155)) {
      expect(r !== null && r.dirs.join(',') === 'up,down' && r.glyphs.join('') === '\u2191\u2193', `the ${where} reading has an up and a down arrow span with its glyph, got ${JSON.stringify(r)}`);
      // The thin pane's title sits at level 2 with its tokens hidden (the fix 146 reading above), so the drawn sizes are read where the span shows.
      if (r.visible) expect(r.icons.every((w) => w !== null && w >= 5) && r.glyphBoxes.every((w) => w !== null && w <= 1), `the ${where} arrows are drawn icons with the glyph clipped away, got ${JSON.stringify(r)}`);
    }
    expect(arrows155.row.visible && arrows155.row.text === '\u2191113.4k (94.8k cached) \u21932.8k' && arrows155.title.text === '\u2191113.4k \u21932.8k', `the texts read as before, got ${JSON.stringify(arrows155)}`);
    step('M9 fix 155: the token arrows on the row and the title are drawn icons with the glyph kept as text');

    // M9 fix 153: how far along Claude's own checklist is. The counted
    // session goes back into the thin pane and gets a turn with a plan:
    // three TaskCreates (the id in the response, the subject and the
    // activeForm in the input) and three TaskUpdates, two done and one in
    // progress. The row reads 2/3 with a sliver bar after the context
    // reading, the title carries the same count beside its dial (hidden
    // at the title's second level with the tokens, as fix 146 hides
    // them), the row's agent line is the task in progress by its
    // activeForm rather than the tool phrase, the count opens a card with
    // the three tasks and the one in progress marked, and the next prompt
    // a person types clears all of it.
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, thin.id, counted.id) } });
    await s.waitFor(`document.querySelector(${JSON.stringify(countedRowSel)})?.dataset.shown !== undefined`, 'the counted row is on screen again');
    const countedTasks = () => s.evalJs(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-tasks .tasks-count')})?.textContent ?? null`);
    expect((await countedTasks()) === null, 'no count on the row before a checklist');
    await postCounted({ hook_event_name: 'UserPromptSubmit', prompt: 'plan the work' });
    await postCounted({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run the tests' } });
    const subjects = [['Extend the row', 'Extending the row'], ['Wire the hooks', 'Wiring the hooks'], ['Write the tests', 'Writing the tests']];
    for (const [i, [subject, activeForm]] of subjects.entries()) {
      await postCounted({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject, activeForm, description: subject }, tool_response: { task: { id: String(i + 1), subject } } });
    }
    await postCounted({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: { success: true, taskId: '1' } });
    await postCounted({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'completed' }, tool_response: { success: true, taskId: '2' } });
    await postCounted({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '3', status: 'in_progress' }, tool_response: { success: true, taskId: '3' } });
    await s.waitFor(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-tasks .tasks-count')})?.textContent === '2/3'`, 'the row reads 2/3');
    const tasksOnRow = await s.evalJs(`(() => {
    const row = document.querySelector(${JSON.stringify(countedRowSel)});
    row.scrollIntoView({ block: 'center' });
    const sub = row.querySelector('.sidebar-row-sub');
    const el = sub.querySelector('.sidebar-row-tasks');
    const bar = el.querySelector('.tasks-bar-done');
    const r = el.getBoundingClientRect();
    const reading = sub.querySelector('.sidebar-row-context').getBoundingClientRect();
    return {
      x: r.x + r.width / 2, y: r.y + r.height / 2,
      afterReading: r.left >= reading.right - 0.5,
      inside: r.right <= sub.getBoundingClientRect().right + 0.5,
      level: sub.dataset.squeeze ?? null,
      done: el.dataset.done, total: el.dataset.total,
      barWidth: bar.style.width,
      agent: row.querySelector('.sidebar-row-agent')?.textContent ?? null,
    };
  })()`);
    expect(tasksOnRow.afterReading && tasksOnRow.inside && tasksOnRow.done === '2' && tasksOnRow.total === '3' && tasksOnRow.barWidth === '67%', `the count sits after the reading, inside the line, with its bar two thirds full, got ${JSON.stringify(tasksOnRow)}`);
    expect(tasksOnRow.agent === 'Writing the tests', `the agent line is the task in progress by its activeForm, over the tool phrase, got ${JSON.stringify(tasksOnRow.agent)}`);
    const titleTasks = await s.evalJs(`(() => {
    const title = document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-title`)});
    const el = title.querySelector('.pane-tasks');
    const vis = (e) => e !== null && e.getClientRects().length > 0;
    return { text: el?.querySelector('.tasks-count')?.textContent ?? null, visible: vis(el), level: title.dataset.squeeze ?? null };
  })()`);
    expect(titleTasks.text === '2/3' && titleTasks.visible === (Number(titleTasks.level) < 2), `the title carries 2/3, shown while the level is under 2, got ${JSON.stringify(titleTasks)}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tasksOnRow.x, y: tasksOnRow.y });
    await s.waitFor(`!!document.querySelector('.tasks-popover')`, 'the checklist card opens on the count', 3000);
    const tasksCard = await s.evalJs(`(() => {
    const card = document.querySelector('.tasks-popover');
    return {
      heading: card.querySelector('.context-popover-heading').textContent,
      lines: [...card.querySelectorAll('.tasks-popover-task')].map((t) => [t.dataset.status, t.querySelector('.tasks-popover-subject').textContent]),
    };
  })()`);
    expect(tasksCard.heading.startsWith('2 of 3 done') && JSON.stringify(tasksCard.lines) === JSON.stringify([['completed', 'Extend the row'], ['completed', 'Wire the hooks'], ['in_progress', 'Writing the tests']]), `the card lists the three tasks with the one in progress marked by its activeForm, got ${JSON.stringify(tasksCard)}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector('.tasks-popover')`, 'the card closes after the mouse leaves');
    // M9 fix 156, as the lid draws it since fix 372: the shade shows the
    // checklist as the rule under the hero whenever there is a list, "2
    // of 3 tasks" over three segments with two lit, on the counted
    // session (a reading and counts), and "1 of 2 tasks" on a bare session
    // that has a list and no status line yet, where fix 153's span inside
    // the context block never showed.
    const shadeToggle = `[data-pane-id=${JSON.stringify(thin.id)}] .pane-shade-toggle`;
    const shadeRead = () => s.evalJs(`(() => { const sh = document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-shade`)}); if (!sh) return null; const rule = sh.querySelector('.pane-shade-rule'); const hero = sh.querySelector('.pane-shade-hero'); const ctx = sh.querySelector('.pane-shade-context'); return { caption: rule?.querySelector('.pane-shade-rule-caption')?.textContent ?? null, segments: rule === null ? null : [...rule.querySelectorAll('.pane-shade-rule-segment')].map((e) => 'done' in e.dataset), belowHero: rule !== null && rule.getBoundingClientRect().top >= hero.getBoundingClientRect().bottom - 0.5, context: ctx?.textContent ?? null, counts: sh.querySelector('.pane-shade-tokens') !== null }; })()`);
    await s.evalJs(`document.querySelector(${JSON.stringify(shadeToggle)}).click()`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-shade`)})`, 'the thin pane shaded');
    const shadeCounted = await shadeRead();
    expect(shadeCounted.caption === '2 of 3 tasks' && JSON.stringify(shadeCounted.segments) === '[true,true,false]' && shadeCounted.belowHero && shadeCounted.counts, `the counted face reads 2 of 3 tasks over a rule of three segments with two lit, under the hero, got ${JSON.stringify(shadeCounted)}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-shade`)}).click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-shade`)})`, 'the shade lifted');
    const { session: listed156 } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: tokensRepo, name: 'listed', cols: 100, rows: 30 });
    const postListed = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${restarted.hookPort}/hook`, { method: 'POST', headers: { 'X-Emerald-Token': restarted.hookToken, 'X-Emerald-Session': listed156.id }, body: JSON.stringify({ session_id: 'sim-m9-156', cwd: tokensRepo, ...payload }) });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postListed({ hook_event_name: 'SessionStart', source: 'startup' });
    await postListed({ hook_event_name: 'UserPromptSubmit', prompt: 'plan without a reading' });
    await postListed({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'One', activeForm: 'Doing one', description: 'One' }, tool_response: { task: { id: '1', subject: 'One' } } });
    await postListed({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject: 'Two', activeForm: 'Doing two', description: 'Two' }, tool_response: { task: { id: '2', subject: 'Two' } } });
    await postListed({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: { success: true, taskId: '1' } });
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, thin.id, listed156.id) } });
    await s.waitFor(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(listed156.id)}] .sidebar-row-tasks .tasks-count`)})?.textContent === '1/2' && document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-title .pane-tasks`)}) !== null`, 'the listed session reads 1/2 on its row and its title');
    await s.evalJs(`document.querySelector(${JSON.stringify(shadeToggle)}).click()`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-shade-rule`)})`, 'the listed face shows its rule');
    const shadeListed = await shadeRead();
    expect(shadeListed.caption === '1 of 2 tasks' && JSON.stringify(shadeListed.segments) === '[true,false]' && shadeListed.belowHero && shadeListed.context === null && !shadeListed.counts, `a face with a list and no reading shows 1 of 2 tasks over its rule alone, got ${JSON.stringify(shadeListed)}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-shade`)}).click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-shade`)})`, 'the shade lifted again');
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, thin.id, counted.id) } });
    await s.waitFor(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-title .pane-tasks .tasks-count`)})?.textContent === '2/3'`, 'the counted session back in the thin pane');
    step('M9 fix 156 on the lid: the shade reads 2 of 3 tasks as its rule under the hero, and 1 of 2 tasks on a face with a list and no context reading');
    await postCounted({ hook_event_name: 'UserPromptSubmit', prompt: 'carry on' });
    await s.waitFor(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-tasks')}) === null && document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(thin.id)}] .pane-tasks`)}) === null`, 'a fresh prompt clears the count from the row and the title');
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(countedRowSel + ' .sidebar-row-agent')})?.textContent ?? null`)) !== 'Writing the tests', 'and the agent line no longer names the task');
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, thin.id, parkedInThin) } });
    step(`M9 fix 153: three creates and three updates read 2/3 on the row (level ${tasksOnRow.level}) and the title (level ${titleTasks.level}), the agent line is the task in progress, the card lists the three, and a fresh prompt clears them`);
  });

  await block('fix-204', async () => {
    // M9 fix 204: a URL a shell prints is a link. The pointer over it puts
    // the addon's pointer cursor on the terminal and the URL on the host (the
    // WebGL renderer leaves no DOM for the underline itself), a plain click
    // opens nothing, and a Ctrl+click sends the URL to openExternal, which
    // the harness reads off EMERALD_OPEN_LOG. The events are the DOM's own on
    // the screen element, where xterm's linkifier listens, since a CDP
    // mouseMoved takes seconds to land in this build.
    // A live shell already shown in a pane (the kept-marker step's approach:
    // a session swapped into a pane over the pipe never has its terminal
    // fed, so a shell that has been on screen from the start is used). The
    // widest such pane, so the URL is on one row whatever the terminal fits.
    let layout = await getLayout(s);
    const liveList = (await zreq(s, 'session.list', {})).sessions;
    const shellLeaves = leaves(layout)
      .map((p) => ({ pane: p, info: liveList.find((x) => x.id === p.sessionId) }))
      .filter((x) => x.info?.kind === 'shell' && x.info.state !== 'exited')
      .map((x) => ({ ...x, width: null }));
    const withWidth = [];
    for (const x of shellLeaves) {
      const w = await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(x.pane.id)}]`)})?.getBoundingClientRect().width ?? 0`);
      withWidth.push({ ...x, width: w });
    }
    withWidth.sort((a, b) => b.width - a.width);
    expect(withWidth.length > 0 && withWidth[0].width > 0, `a shell shown in a pane for the link step, got ${JSON.stringify(withWidth.map((x) => x.width))}`);
    const linkPane = withWidth[0].pane;
    const linkShell = withWidth[0].info;
    const linkHost = `[data-pane-id=${JSON.stringify(linkPane.id)}] .term-host`;
    await s.waitFor(`document.querySelector(${JSON.stringify(linkHost)})?.emeraldTerm !== undefined`, 'the links shell in a pane', 10_000);
    // A short URL, so it sits on one screen row whatever the pane's width.
    const linkUrl = 'https://ex.io/204';
    await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(linkShell.id)}, data: 'Write-Host ' + ${JSON.stringify(linkUrl)} + String.fromCharCode(13) })`);
    const mid = Math.floor(linkUrl.length / 2);
    const linkCell = `(() => { const host = document.querySelector(${JSON.stringify(linkHost)}); const t = host?.emeraldTerm; if (!t) return null; const b = t.buffer.active; for (let i = 0; i < b.length; i++) { const text = b.getLine(i)?.translateToString(true) ?? ''; const at = text.indexOf(${JSON.stringify(linkUrl)}); if (at >= 0 && !text.includes('Write-Host')) { const cell = t._core._renderService.dimensions.css.cell; const r = host.querySelector('.xterm-screen').getBoundingClientRect(); return { x: r.left + (at + ${mid}) * cell.width, y: r.top + (i - b.viewportY) * cell.height + cell.height / 2, row: i - b.viewportY }; } } return null; })()`;
    const dumpBuf = `(() => { const t = document.querySelector(${JSON.stringify(linkHost)})?.emeraldTerm; if (!t) return 'no term'; const b = t.buffer.active; const out = []; for (let i = 0; i < b.length; i++) { const l = b.getLine(i)?.translateToString(true) ?? ''; if (l.trim() !== '') out.push(l); } return out.join(' | '); })()`;
    {
      const linkDeadline = Date.now() + 10000;
      while ((await s.evalJs(linkCell)) === null && Date.now() < linkDeadline) await sleep(250);
      if ((await s.evalJs(linkCell)) === null) throw new Error(`the URL never printed on the shell (${linkShell.name}, ${await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(linkPane.id)}]`)})?.getBoundingClientRect().width`)}px): ${await s.evalJs(dumpBuf)}`);
    }
    const cell204 = await s.evalJs(linkCell);
    expect(cell204.row >= 0 && cell204.row < (await s.evalJs(`document.querySelector(${JSON.stringify(linkHost)}).emeraldTerm.rows`)), `the URL is on a visible row (${cell204.row})`);
    const screenEvent = (type, extra = '') => s.evalJs(`document.querySelector(${JSON.stringify(linkHost + ' .xterm-screen')}).dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { clientX: ${cell204.x}, clientY: ${cell204.y}, bubbles: true, cancelable: true, button: 0 ${extra} }))`);
    await screenEvent('mousemove');
    await s.waitFor(`document.querySelector(${JSON.stringify(linkHost)})?.dataset.link === ${JSON.stringify(linkUrl)}`, 'the hovered URL written on the host', 5000);
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(linkHost)}).title`)) === `Ctrl+click opens ${linkUrl}`, 'the tooltip says how to open it');
    await s.screenshot('m9-fix204-link.png');
    await screenEvent('mousedown');
    await screenEvent('mouseup');
    await sleep(400);
    expect(!fs.existsSync(openedLinks), 'a plain click opens nothing');
    await screenEvent('mousedown', ', ctrlKey: true');
    await screenEvent('mouseup', ', ctrlKey: true');
    await s.waitFor(`true`, 'a tick');
    const openedAt = Date.now();
    while (!fs.existsSync(openedLinks) && Date.now() - openedAt < 5000) await sleep(100);
    expect(fs.existsSync(openedLinks) && fs.readFileSync(openedLinks, 'utf8').trim() === linkUrl, `the Ctrl+click sent the URL to openExternal: ${fs.existsSync(openedLinks) ? fs.readFileSync(openedLinks, 'utf8').trim() : '(nothing)'}`);
    await s.evalJs(`document.querySelector(${JSON.stringify(linkHost + ' .xterm-screen')}).dispatchEvent(new MouseEvent('mousemove', { clientX: ${cell204.x}, clientY: ${cell204.y + 200}, bubbles: true }))`);
    await s.waitFor(`document.querySelector(${JSON.stringify(linkHost)})?.dataset.link === undefined`, 'the pointer off the link clears the host', 5000);
    step('M9 fix 204: a URL in a pane is a link with a tooltip on hover, a plain click opens nothing and a Ctrl+click sends it to the browser');

    // M9 fix 355: EMERALD_INSPECT_PORT was set on this window's launch, and
    // the harness's own --remote-debugging-port on the command line wins,
    // which the main log says; and a renderer warning reaches the main
    // process's log as a `renderer:` line within a second.
    expect(s.logs.join('').includes('[emerald] inspect port: the command line already names one'), `the main log says the inspect port yielded to the command line: ${s.logs.join('').split('\n').filter((l) => l.includes('inspect port')).join(' | ') || '(no inspect line)'}`);
    await s.evalJs(`console.warn('[emerald] probe 355')`);
    const probeAt = Date.now();
    const probeLine = () => s.logs.join('').split('\n').find((l) => l.includes('renderer: warning [emerald] probe 355'));
    while (probeLine() === undefined && Date.now() - probeAt < 1000) await sleep(50);
    expect(probeLine() !== undefined, 'a renderer warning is in the main log within a second');
    expect(/renderer: warning \[emerald\] probe 355 \(.*:\d+\)$/.test(probeLine().trim()), `the line ends with the source and its line, got ${probeLine()}`);
    step('M9 fix 355: the inspect port yields to the command line and says so, and a renderer warning reaches the main log');

    // M9 fix 356: the links pane's WebGL context lost through the canvas
    // (the recipe the diagnosis driver used): the addon waits 3 s for a
    // restore before it says the context is lost, then the host reads dom,
    // webgl again within the first retry's wait, and the two changes are
    // renderer warnings in the main log.
    const rendererOf = () => s.evalJs(`document.querySelector(${JSON.stringify(linkHost)})?.dataset.renderer ?? null`);
    expect((await rendererOf()) === 'webgl', `the links pane is on the WebGL renderer, got ${await rendererOf()}`);
    // Two canvases sit under the screen and a canvas with no context yet
    // answers a fresh one, so the loss goes to every canvas that answers;
    // the addon's is among them.
    const lost = await s.evalJs(`(() => { let n = 0; for (const c of document.querySelectorAll(${JSON.stringify(linkHost + ' canvas')})) { const gl = c.getContext('webgl2') ?? c.getContext('webgl'); const ext = gl?.getExtension('WEBGL_lose_context'); if (!ext) continue; ext.loseContext(); n++; } return n > 0 ? 'lost' : 'no WebGL canvas in the host'; })()`);
    expect(lost === 'lost', `the context lost through the canvas: ${lost}`);
    await s.waitFor(`document.querySelector(${JSON.stringify(linkHost)})?.dataset.renderer === 'dom'`, 'the pane on the DOM renderer once the addon gives up on a restore (its own 3 s wait)', 6000);
    await s.waitFor(`document.querySelector(${JSON.stringify(linkHost)})?.dataset.renderer === 'webgl'`, 'the pane back on WebGL after the first retry', 4000);
    const rendererLines = s.logs.join('').split('\n').filter((l) => l.includes('renderer: warning [emerald] terminal renderer:'));
    expect(rendererLines.length === 2 && rendererLines[0].includes('terminal renderer: dom (context lost, retry 1 of 3 in 1000 ms)') && rendererLines[1].includes('terminal renderer: webgl (retry 1)'), `the two renderer changes are in the main log: ${rendererLines.join(' | ') || '(none)'}`);
    await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(linkShell.id)}, data: 'Write-Host after-356' + String.fromCharCode(13) })`);
    await s.waitFor(`(() => { const t = document.querySelector(${JSON.stringify(linkHost)})?.emeraldTerm; if (!t) return false; const b = t.buffer.active; for (let i = 0; i < b.length; i++) { const l = b.getLine(i)?.translateToString(true) ?? ''; if (l.includes('after-356') && !l.includes('Write-Host')) return true; } return false; })()`, 'the pane still takes output on the new addon', 10_000);
    step('M9 fix 356: a lost WebGL context puts the pane on the DOM renderer, a new addon brings WebGL back within the first wait, and both changes are logged');
  });

  await block('fix-547', async () => {
    const before547 = new Set((await zreq(s, 'session.list', {})).sessions.map((x) => x.id));
    // M9 fix 547: the empty pane's cases (the design handoff's section 11),
    // on the tab on show cut down to one empty pane, so the panes are known
    // (the strip's + is gone by now: fix 11's daemon left tabs unsupported).
    // Every start is a shell; a real Claude in the harness is a trust
    // dialog to sweep.
    const rowsDir = path.join(os.tmpdir(), 'emerald-verify', 'm9-rows');
    fs.mkdirSync(pickedDir, { recursive: true });
    fs.mkdirSync(rowsDir, { recursive: true });
    const sel547 = (id) => `[data-pane-id=${JSON.stringify(id)}]`;
    const sameFolder = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase().replace(/[\\/]+$/, '') === b.toLowerCase().replace(/[\\/]+$/, '');
    const rowsOf = (id) =>
      s.evalJs(`[...document.querySelectorAll(${JSON.stringify(sel547(id) + ' .empty-folder')})].map((r) => ({ folder: r.dataset.folder, note: r.querySelector('.empty-folder-note')?.textContent ?? null, selected: r.dataset.selected === 'true' }))`);
    const focusBox = (id) => s.evalJs(`document.querySelector(${JSON.stringify(sel547(id) + ' .palette-input')}).focus()`);
    const sessionCount = async () => (await zreq(s, 'session.list', {})).sessions.length;
    const paneSession = async (id) => leaves(await getLayout(s)).find((p) => p.id === id)?.sessionId ?? null;
    const waitPaneSession = async (id, what) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const sid = await paneSession(id);
        if (sid !== null) return (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === sid) ?? null;
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    const clickPane = async (id) => {
      const c = await centerOf(s, `${sel547(id)} .term-host`);
      await s.click(c.x, c.y);
      await s.waitFor(focusedPaneIs(id), 'the pane focused');
    };
    const waitLeaves = async (n, what) => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        const tree = await getLayout(s);
        if (leaves(tree).length === n) return tree;
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    const splitByChord = async () => {
      const before = leaves(await getLayout(s)).length;
      await s.key('E', 'KeyE', 69, CTRL | SHIFT);
      return (await waitLeaves(before + 1, 'a pane from Ctrl+Shift+E')).focusedPaneId;
    };
    expect((await s.evalJs(`localStorage.getItem('emerald.splitKind')`)) === null, 'the split default is an empty pane');
    await s.evalJs(`localStorage.setItem('emerald.recentFolders', ${JSON.stringify(JSON.stringify([repoRoot, home, rowsDir]))})`);
    const tree0 = await getLayout(s);
    const p0 = leaves(tree0)[0].id;
    await zreq(s, 'layout.set', { layout: { ...tree0, focusedPaneId: p0, root: { kind: 'pane', id: p0, sessionId: null, view: null } } });
    await waitLeaves(1, 'the tab cut down to one pane');
    await s.waitFor(`!!document.querySelector(${JSON.stringify(sel547(p0) + ' .empty-folder')})`, 'the one empty pane offers its rows');
    const e0rows = await rowsOf(p0);
    expect(sameFolder(e0rows[0]?.folder, repoRoot) && e0rows[0]?.note === 'last used', `the new tab's row 1 is the repo, last used, got ${JSON.stringify(e0rows)}`);
    await focusBox(p0);
    await s.key('Enter', 'Enter', 13);
    const p0Session = await waitPaneSession(p0, 'a shell from Enter in the new tab');
    expect(p0Session?.kind === 'shell' && sameFolder(p0Session.spawnCwd, repoRoot), `Enter started a shell in the repo, got ${JSON.stringify(p0Session && { kind: p0Session.kind, spawnCwd: p0Session.spawnCwd })}`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(sel547(p0) + ' .term-host')})`, 'the shell on screen');

    // Case 1: both split routes carry the folder, and Enter starts there.
    await s.evalJs(`document.querySelector(${JSON.stringify(sel547(p0) + ' .pane-split-right')}).click()`);
    const e1 = (await waitLeaves(2, 'an empty pane from the title button')).focusedPaneId;
    await clickPane(p0);
    const e2 = await splitByChord();
    for (const [id, how] of [[e1, 'the title button'], [e2, 'Ctrl+Shift+E']]) {
      await s.waitFor(`document.querySelector(${JSON.stringify(sel547(id) + ' .empty-folder .empty-folder-note')})?.textContent === 'split from here'`, `the pane from ${how} says split from here`);
      const r = await rowsOf(id);
      expect(sameFolder(r[0]?.folder, repoRoot) && r[0].selected, `row 1 of the pane from ${how} is the repo, selected, got ${JSON.stringify(r)}`);
    }
    await focusBox(e2);
    await s.key('Enter', 'Enter', 13);
    const e2Session = await waitPaneSession(e2, 'a shell from Enter in the chord split');
    expect(e2Session?.kind === 'shell' && sameFolder(e2Session.spawnCwd, repoRoot), `Enter in the chord split started a shell in the repo, got ${JSON.stringify(e2Session && e2Session.spawnCwd)}`);
    step('M9 fix 547: a split by the title button and by Ctrl+Shift+E both offer the folder they came from, and Enter starts there');

    // Case 3: Tab flips the kind and starts nothing.
    const count3 = await sessionCount();
    await focusBox(e1);
    const pressed = (id) => s.evalJs(`document.querySelector(${JSON.stringify(sel547(id) + ' .empty-kind[data-kind="claude"]')})?.getAttribute('aria-pressed')`);
    const startText = (id) => s.evalJs(`document.querySelector(${JSON.stringify(sel547(id) + ' .empty-start')})?.innerText ?? ''`);
    await s.key('Tab', 'Tab', 9);
    await s.waitFor(`document.querySelector(${JSON.stringify(sel547(e1) + ' .empty-kind[data-kind="claude"]')})?.getAttribute('aria-pressed') === 'true'`, 'Tab selected the Claude tile');
    expect((await startText(e1)).startsWith('Start Claude in'), `Start follows the kind, got ${JSON.stringify(await startText(e1))}`);
    expect((await s.evalJs('document.activeElement?.className')) === 'palette-input', 'the box keeps the focus through Tab');
    await s.key('Tab', 'Tab', 9);
    await s.waitFor(`document.querySelector(${JSON.stringify(sel547(e1) + ' .empty-kind[data-kind="shell"]')})?.getAttribute('aria-pressed') === 'true'`, 'Tab again selected the Shell tile');
    expect((await pressed(e1)) === 'false' && (await startText(e1)).startsWith('Start shell in'), 'the Claude tile is off again and Start says shell');
    expect((await sessionCount()) === count3, 'Tab started nothing');
    step('M9 fix 547: Tab flips the kind both ways, Start follows it, nothing starts');

    // Case 4: a digit starts in that row at once.
    const e1rows = await rowsOf(e1);
    expect(e1rows.length >= 3 && sameFolder(e1rows[2].folder, rowsDir), `row 3 is the rows folder, got ${JSON.stringify(e1rows)}`);
    await focusBox(e1);
    await s.key('3', 'Digit3', 51);
    const e1Session = await waitPaneSession(e1, 'a shell from the 3 key');
    expect(e1Session?.kind === 'shell' && sameFolder(e1Session.spawnCwd, rowsDir), `3 started a shell in row 3's folder, got ${JSON.stringify(e1Session && e1Session.spawnCwd)}`);
    const recent4 = await s.evalJs(`JSON.parse(localStorage.getItem('emerald.recentFolders') ?? '[]')[0] ?? null`);
    expect(sameFolder(recent4, rowsDir), `the rows folder is the last used now, got ${recent4}`);
    step('M9 fix 547: a digit with the box empty starts in that row at once, and the folder becomes the last used');

    // Case 5: typing makes the box the palette again.
    const filterId = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, name: 'emerald-547-filter', cols: 80, rows: 24 })).session.id;
    await clickPane(p0);
    const e3 = await splitByChord();
    await focusBox(e3);
    await s.type('emerald-547');
    await s.waitFor(`document.querySelector(${JSON.stringify(sel547(e3) + ' .session-row[data-highlighted="true"]')})?.dataset.sessionId === ${JSON.stringify(filterId)}`, 'the filter highlights the named shell');
    const filtered = await s.evalJs(`(() => {
    const pane = document.querySelector(${JSON.stringify(sel547(e3))});
    return {
      filtering: pane.querySelector('.empty-pane')?.dataset.filtering ?? null,
      numsHidden: [...pane.querySelectorAll('.empty-folder-num')].every((n) => n.offsetParent === null || getComputedStyle(n).display === 'none'),
      startGround: getComputedStyle(pane.querySelector('.empty-start')).backgroundColor,
      here: pane.querySelector('.session-row[data-highlighted="true"]')?.dataset.here ?? null,
    };
  })()`);
    expect(filtered.filtering === 'true' && filtered.numsHidden && filtered.startGround === 'rgba(0, 0, 0, 0)' && filtered.here === 'true', `filtering hides the numbers, unfills Start and marks the row Enter takes, got ${JSON.stringify(filtered)}`);
    await setInput(s, sel547(e3) + ' .palette-input', '');
    await focusBox(e3);
    await s.key('ArrowDown', 'ArrowDown', 40);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(sel547(e3) + ' .empty-folder')})[1]?.dataset.selected === 'true'`, 'ArrowDown with the box empty moved the folder to row 2');
    await s.type('emerald-547');
    await s.waitFor(`document.querySelector(${JSON.stringify(sel547(e3) + ' .session-row[data-highlighted="true"]')})?.dataset.sessionId === ${JSON.stringify(filterId)}`, 'the filter again');
    await s.key('Enter', 'Enter', 13);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(sel547(e3) + ' .term-host')})`, 'the named shell shown in the pane');
    expect((await paneSession(e3)) === filterId, 'Enter with text showed the named shell here');
    step('M9 fix 547: typing filters the running sessions, unfills Start and marks the row, Enter shows it here, and an empty box moves the folder again');

    // Case 6: Another folder… puts the pick first, and nothing is
    // remembered until a start.
    await clickPane(p0);
    const e4 = await splitByChord();
    await s.waitFor(`document.querySelector(${JSON.stringify(sel547(e4) + ' .empty-folder .empty-folder-note')})?.textContent === 'split from here'`, 'the fourth split offers its source');
    await s.evalJs(`document.querySelector(${JSON.stringify(sel547(e4) + ' .empty-other')}).click()`);
    await s.waitFor(`document.querySelector(${JSON.stringify(sel547(e4) + ' .empty-folder .empty-folder-note')})?.textContent === 'picked'`, 'the picked folder in row 1');
    const e4rows = await rowsOf(e4);
    const recent6 = await s.evalJs(`JSON.parse(localStorage.getItem('emerald.recentFolders') ?? '[]')`);
    expect(sameFolder(e4rows[0].folder, pickedDir) && e4rows[0].selected && e4rows[1]?.note === 'split from here' && !recent6.some((x) => sameFolder(x, pickedDir)), `the pick is row 1 and selected, the default keeps its note in row 2, and the pick is not remembered yet, got ${JSON.stringify({ e4rows, recent6 })}`);
    step('M9 fix 547: Another folder… puts the pick in row 1, selected, the default keeps its note below it, nothing remembered before a start');

    // Case 7: More… opens the dialog on the selected folder.
    const count7 = await sessionCount();
    await s.evalJs(`document.querySelector(${JSON.stringify(sel547(e4) + ' .empty-kind[data-kind="claude"]')}).click()`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(sel547(e4) + ' .empty-more')})`, 'More… with the Claude tile');
    await s.evalJs(`document.querySelector(${JSON.stringify(sel547(e4) + ' .empty-more')}).click()`);
    await s.waitFor(`!!document.querySelector('.dialog input[name=cwd]')`, 'the New session dialog');
    const dialogCwd = await s.evalJs(`document.querySelector('.dialog input[name=cwd]').value`);
    expect(sameFolder(dialogCwd, pickedDir), `the dialog opens on the selected folder, got ${dialogCwd}`);
    await s.evalJs(`[...document.querySelectorAll('.dialog .dialog-actions button')].find((b) => b.textContent.trim() === 'Cancel').click()`);
    await s.waitFor(`!document.querySelector('.dialog')`, 'Cancel closed the dialog');
    expect((await sessionCount()) === count7, 'Cancel started nothing');
    step('M9 fix 547: More… on the Claude tile opens the New session dialog on the selected folder');

    // Case 8: a 320px pane. The tab's tree is set to the repo shell and the
    // fourth pane side by side, the ratio putting the fourth at 320px; the
    // tree is put back after.
    const tree8 = await getLayout(s);
    const leafOf = (id) => leaves(tree8).find((p) => p.id === id);
    const pair8 = (ratio) => ({ ...tree8, focusedPaneId: e4, root: { kind: 'split', id: tree8.root.id, direction: 'row', ratio, first: leafOf(p0), second: leafOf(e4) } });
    await zreq(s, 'layout.set', { layout: pair8(0.5) });
    await waitLeaves(2, 'the two panes side by side');
    await s.waitFor(`!!document.querySelector(${JSON.stringify(sel547(e4) + ' .empty-pane')}) && !!document.querySelector(${JSON.stringify(sel547(p0) + ' .term-host')})`, 'both panes drawn');
    const surface8 = await s.evalJs(`(() => { const a = document.querySelector(${JSON.stringify(sel547(p0))}).getBoundingClientRect(); const b = document.querySelector(${JSON.stringify(sel547(e4))}).getBoundingClientRect(); return b.right - a.left; })()`);
    await zreq(s, 'layout.set', { layout: { ...(await getLayout(s)), root: { ...(await getLayout(s)).root, ratio: Math.min(0.9, Math.max(0.1, 1 - 320 / surface8)) } } });
    await s.waitFor(`Math.abs(document.querySelector(${JSON.stringify(sel547(e4))}).getBoundingClientRect().width - 320) < 12`, 'the fourth pane about 320px wide');
    // M9 fix 577: a shell with a long name, so a row presses on its kind.
    const long577 = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, name: 'emerald-577-a-session-named-at-length', cols: 80, rows: 24 })).session.id;
    await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(sel547(e4) + ' .session-row .pane-name')})].some((n) => n.textContent === 'emerald-577-a-session-named-at-length')`, 'the long-named shell has a row');
    const narrow547 = await s.evalJs(`(() => {
    const pane = document.querySelector(${JSON.stringify(sel547(e4))});
    const ep = pane.querySelector('.empty-pane');
    const tiles = [...pane.querySelectorAll('.empty-kind')].map((t) => t.getBoundingClientRect());
    const overlap = tiles.length === 2 && tiles[0].right > tiles[1].left && tiles[0].left < tiles[1].right && tiles[0].bottom > tiles[1].top && tiles[0].top < tiles[1].bottom;
    return {
      width: Math.round(pane.getBoundingClientRect().width),
      rows: [...pane.querySelectorAll('.session-row')].map((r) => { const kind = r.children[1]; const folder = r.lastElementChild; const st = r.querySelector('.pane-state'); return { name: r.querySelector('.pane-name').textContent, kind: kind.textContent, kindSW: kind.scrollWidth, kindCW: kind.clientWidth, folderSW: folder.scrollWidth, folderCW: folder.clientWidth, rowSW: r.scrollWidth, rowCW: r.clientWidth, state: st === null ? null : getComputedStyle(st).display }; }),
      sideways: ep.scrollWidth !== ep.clientWidth,
      overlap,
      names: [...pane.querySelectorAll('.empty-kind-name')].map((n) => n.textContent),
      start: pane.querySelector('.empty-start').innerText,
      pairs: [...pane.querySelectorAll('.empty-foot .empty-pair')].map((pair) => {
        const b = pair.querySelector('button').getBoundingClientRect();
        const k = pair.querySelector('.muted').getBoundingClientRect();
        return k.top < b.bottom && k.bottom > b.top && k.left > b.right;
      }),
    };
  })()`);
    expect(!narrow547.sideways && !narrow547.overlap && JSON.stringify(narrow547.names) === JSON.stringify(['Shell', 'Claude session']) && !narrow547.start.includes(' in ') && narrow547.pairs.length >= 2 && narrow547.pairs.every(Boolean), `at ${narrow547.width}px nothing overlaps or scrolls sideways, the tiles keep their names, Start drops its folder and every key sits beside its button, got ${JSON.stringify(narrow547)}`);
    console.log(`[577] rows at ${narrow547.width}px ${JSON.stringify(narrow547.rows)}`);
    expect(narrow547.rows.length >= 2 && narrow547.rows.every((r) => r.kindSW <= r.kindCW && r.rowSW <= r.rowCW && (r.state === null || r.state === 'none')), `at ${narrow547.width}px every row keeps its kind and shown words whole and shows no state, got ${JSON.stringify(narrow547.rows)}`);
    await s.screenshot('m9-547-narrow-320.png');
    await zreq(s, 'layout.set', { layout: { ...(await getLayout(s)), root: tree8.root, focusedPaneId: p0 } });
    await waitLeaves(leaves(tree8).length, 'the tree put back');
    step(`M9 fix 547: at ${narrow547.width}px the empty pane keeps both tiles apart, drops the folder from Start and keeps every key beside its button, and every session row keeps its kind whole`);

    // Case 9: Ctrl+J over a full pane is list first, with the start line
    // at its foot, and digits go into the box.
    await clickPane(p0);
    const count9 = await sessionCount();
    await s.key('J', 'KeyJ', 74, CTRL);
    const overlaySel = sel547(p0) + ' .picker-overlay';
    await s.waitFor(`!!document.querySelector(${JSON.stringify(overlaySel + ' .palette-input')})`, 'the overlay over the repo shell');
    await s.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(overlaySel + ' .palette-input')})`, "the overlay's box has the focus");
    const overlay = await s.evalJs(`(() => {
    const o = document.querySelector(${JSON.stringify(overlaySel)});
    return { kinds: o.querySelectorAll('.empty-kind').length, folders: o.querySelectorAll('.empty-folder').length, line: o.querySelector('.overlay-start')?.textContent ?? '', shell: !!o.querySelector('.overlay-shell'), claude: !!o.querySelector('.overlay-claude') };
  })()`);
    expect(overlay.kinds === 0 && overlay.folders === 0 && overlay.line.startsWith('Or start one beside, in ' + path.basename(repoRoot)) && overlay.shell && overlay.claude, `the overlay has no tiles or folders and one start line naming the pane's folder, got ${JSON.stringify(overlay)}`);
    await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49, nativeVirtualKeyCode: 49, text: '1' });
    await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49, nativeVirtualKeyCode: 49 });
    await s.waitFor(`document.querySelector(${JSON.stringify(overlaySel + ' .palette-input')})?.value === '1'`, 'the 1 went into the box');
    expect((await sessionCount()) === count9, 'the 1 started nothing');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector(${JSON.stringify(overlaySel)})`, 'Escape closed the overlay');
    step('M9 fix 547: Ctrl+J over a full pane lists first, offers one start line beside it in its folder, and a digit is just a character');

    // M9 fix 575: a double-click on a folder row starts the selected kind there
    // at once, like the digit keys; a shell only, since a real Claude in the
    // harness is a trust dialog.
    await clickPane(p0);
    const e5 = await splitByChord();
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(sel547(e5) + ' .empty-folder')}).length >= 2`, 'the new empty pane offers at least two rows');
    await s.evalJs(`document.querySelector(${JSON.stringify(sel547(e5) + ' .empty-kind[data-kind="shell"]')}).click()`);
    await s.waitFor(`document.querySelector(${JSON.stringify(sel547(e5) + ' .empty-kind[data-kind="shell"]')})?.getAttribute('aria-pressed') === 'true'`, 'the shell kind is pressed');
    const rows10 = await rowsOf(e5);
    const title10 = await s.evalJs(`document.querySelectorAll(${JSON.stringify(sel547(e5) + ' .empty-folder')})[1].title`);
    expect(title10 === `${rows10[1].folder}
Double-click to start here`, `row 2's title is the path then the hint, got ${JSON.stringify(title10)}`);
    const count10 = await sessionCount();
    const c10 = await centerOf(s, sel547(e5) + ' .empty-folder:nth-child(2)');
    for (const n of [1, 2, 3]) {
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c10.x, y: c10.y, button: 'left', clickCount: n });
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c10.x, y: c10.y, button: 'left', clickCount: n });
    }
    const e5Session = await waitPaneSession(e5, 'a shell from a double-click on row 2');
    expect(e5Session?.kind === 'shell' && sameFolder(e5Session.spawnCwd, rows10[1].folder), `a shell in row 2's folder, got ${JSON.stringify(e5Session && { kind: e5Session.kind, spawnCwd: e5Session.spawnCwd })}`);
    await sleep(600);
    const count10b = await sessionCount();
    expect(count10b === count10 + 1, `the triple click started one session, got ${count10b - count10}`);
    step('M9 fix 575: a double-click on a folder row starts the selected kind in that folder at once, a third click starts nothing more, and the row says so in its title');
    // The block removes every session it started, so a block after it
    // starts from the rows it found; the panes it split stay as it left
    // them (a later block that reads panes sets its own layout).
    const started547 = (await zreq(s, 'session.list', {})).sessions.filter((x) => !before547.has(x.id));
    for (const x of started547) await zreq(s, x.state === 'exited' ? 'session.remove' : 'session.kill', x.state === 'exited' ? { sessionId: x.id } : { sessionId: x.id, remove: true });
    for (const end = Date.now() + 10000; ; await sleep(100)) {
      if ((await zreq(s, 'session.list', {})).sessions.every((x) => before547.has(x.id))) break;
      if (Date.now() > end) throw new Error("timed out waiting for the fix 547 block's sessions to go");
    }
    step(`M9 fix 547: the block removed the ${started547.length} sessions it started, so a block after it starts from the rows it found`);
  });
  step(blocksRun());
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m9-fixes-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
