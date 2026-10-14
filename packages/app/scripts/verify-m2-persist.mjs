// M2 acceptance, part 2: two panes on two sessions with a dragged ratio
// survive a renderer reload, an app restart (daemon keeps running) and a
// daemon restart (layout reloaded from ~/.emerald/state.json). Starts from an
// empty layout, so run it when no Emerald app is open.
// Run: npm run verify:persist -w @emerald/app
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CTRL, SHIFT, clickNewShell, daemonPid, expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, step, stopDaemon, emeraldHome, zreq } from './cdp.mjs';

setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 150 s');
  process.exit(3);
}, 150000);

const names = (s) => s.evalJs(`[...document.querySelectorAll('.pane-name')].map(e => e.textContent).join(' | ')`);
const shape = (l) => JSON.stringify({ root: l.root, focusedPaneId: l.focusedPaneId });
// state.json holds the layout with its tabs (M36); the tree on show is the
// one getLayout hands back.
const treeOnDisk = (l) => l.tabs.find((t) => t.id === l.currentTabId);
const waitExit = (child) => new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));
const expectedNames = `${path.basename(process.env['USERPROFILE'] ?? 'home')} | ${path.basename(repoRoot)}`;

let s = await launch(freshPort(), { freshState: true });
let firstDaemon = null;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane')`, 'empty pane');
  await clickNewShell(s);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'first terminal');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes');
  await clickNewShell(s, repoRoot);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'second terminal');
  await sleep(1000);
  const g = await s.evalJs(`(() => { const r = document.querySelector('.gutter').getBoundingClientRect(); const c = document.querySelector('.split').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: c.x, width: c.width }; })()`);
  await s.mouse('mousePressed', g.x, g.y);
  await s.mouse('mouseMoved', g.left + g.width * 0.35, g.y);
  await s.mouse('mouseReleased', g.left + g.width * 0.35, g.y);
  await sleep(400);
  const marker = 'EMERALD_PERSIST_' + Date.now();
  await s.type(`Write-Output ('OUT:' + '${marker}')`);
  await s.key('Enter', 'Enter', 13);
  await sleep(1500);
  const before = await getLayout(s);
  const [p1, p2] = leaves(before);
  expect(Math.abs(before.root.ratio - 0.35) < 0.02, 'ratio 0.35');
  expect(p1.sessionId && p2.sessionId && p1.sessionId !== p2.sessionId, 'two different sessions');
  const read = async (id) => Buffer.from((await zreq(s, 'session.read', { sessionId: id })).data, 'base64').toString();
  expect((await read(p2.sessionId)).includes('OUT:' + marker), 'marker in pane 2');
  firstDaemon = daemonPid();
  step(`two panes on different sessions, ratio ${before.root.ratio.toFixed(3)}, revision ${before.revision}, daemon pid ${firstDaemon}`);
  const onDisk = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'state.json'), 'utf8'));
  expect(shape(treeOnDisk(onDisk.layout)) === shape(before) && onDisk.layout.revision === before.revision, 'state.json matches the live layout');
  step('state.json on disk matches the daemon layout');

  // 1. Renderer reload.
  await s.send('Page.reload');
  await sleep(500);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'terminals after reload');
  await sleep(2000);
  expect(shape(await getLayout(s)) === shape(before), 'same layout after renderer reload');
  expect((await names(s)) === expectedNames, 'pane titles after reload');
  const firstW = await s.evalJs(`document.querySelector('.split-first').getBoundingClientRect().width / document.querySelector('.split').getBoundingClientRect().width`);
  expect(Math.abs(firstW - 0.35) < 0.02, `first pane at 35% after reload, got ${firstW}`);
  await s.screenshot('m2-persist-after-reload.png');
  step('renderer reload: same tree, ratio, focus and sessions');

  // 2. App restart. Closing the window quits Electron; the detached daemon stays up.
  const child = s.child;
  // The reply never comes back once the window is gone, so do not wait for it.
  s.send('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {});
  s.close();
  await Promise.race([waitExit(child), sleep(10000)]);
  expect(child.exitCode !== null, 'electron exited on window close');
  await sleep(500);
  const alive = spawn('tasklist', ['/FI', `PID eq ${firstDaemon}`]);
  let tl = '';
  alive.stdout.on('data', (d) => (tl += d));
  await new Promise((r) => alive.on('exit', r));
  expect(tl.includes(String(firstDaemon)), 'daemon survived the app quitting');
  step('app quit, daemon still running');

  s = await launch(s.port + 1);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'terminals after app restart');
  await sleep(2500);
  const afterRestart = await getLayout(s);
  expect(shape(afterRestart) === shape(before), 'same layout after app restart');
  expect(afterRestart.revision === before.revision, 'same revision after app restart');
  expect((await names(s)) === expectedNames, 'pane titles after app restart');
  expect(await s.evalJs(`!document.body.textContent.includes('cannot attach')`), 'no attach errors after app restart');
  expect((await read(p2.sessionId)).includes('OUT:' + marker), 'scrollback still in the daemon');
  await s.screenshot('m2-persist-after-app-restart.png');
  step('app restart: layout came back from the daemon with both sessions live');

  // 3. Daemon restart. The app autostarts a fresh daemon, which loads
  // state.json. Sessions died with the old daemon (M5 brings them back as
  // exited), so the panes report that; the tree, ratio and focus survive.
  spawn('taskkill', ['/pid', String(firstDaemon), '/f'], { stdio: 'ignore' });
  await s.waitFor(`!!document.querySelector('.banner')`, 'disconnected banner');
  step('daemon killed, app shows the disconnected banner');
  await s.waitFor(`!document.querySelector('.banner')`, 'reconnect after daemon autostart', 20000);
  await sleep(1500);
  const afterDaemon = await getLayout(s);
  expect(shape(afterDaemon) === shape(before), 'same layout after daemon restart');
  expect(afterDaemon.revision === before.revision, 'revision persisted through daemon restart');
  expect((await s.evalJs(`document.querySelectorAll('.term-host').length`)) === 2, 'both panes still mounted');
  const newPid = daemonPid();
  expect(newPid !== firstDaemon, 'a new daemon was started');
  await s.screenshot('m2-persist-after-daemon-restart.png');
  step(`daemon restart: app autostarted pid ${newPid}, reconnected, layout restored from state.json`);
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m2-persist-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  if (firstDaemon !== null) spawn('taskkill', ['/pid', String(firstDaemon), '/f'], { stdio: 'ignore' });
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
