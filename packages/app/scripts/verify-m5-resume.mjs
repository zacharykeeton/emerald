// M5 acceptance, part 1: sessions outlive the daemon and come back. Two
// shells in two panes; one is killed from the sidebar and shows "killed";
// the daemon is killed and the app autostarts another, which lists both
// sessions as exited with their names on the panes; the killed one is
// resumed from the pane's Resume button and the other by double-clicking
// its row, each in the same pane under the same id, and typing reaches the
// new shells; then remove clears a session from the daemon, the file and
// its pane, and "Clear exited" empties the group. Since M24 every session
// has a colour, checked here because this is the script that restarts the
// daemon and resumes: the colour is in the record and the file, on the
// row's bar and the pane title's bar (M38: the title carries the colour as
// a bar at its left edge and its ground follows focus), and the same after
// the restart and the resume. Starts from an empty layout, so run it when
// no Emerald app is open.
// Run: npm run verify:resume -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { CTRL, SHIFT, daemonPid, expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, startSession, step, stopDaemon, emeraldHome, zreq } from './cdp.mjs';

setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 60 s');
  process.exit(3);
}, 60000);

const row = (id) => `document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]')`;
const rowBadge = (s, id) => s.evalJs(`${row(id)}?.querySelector('.sidebar-row-state')?.textContent ?? null`);
const rowIds = (s) => s.evalJs(`[...document.querySelectorAll('.sidebar-row')].map(r => r.dataset.sessionId)`);
const paneTitle = (s, paneId) => s.evalJs(`(() => { const p = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]'); return p ? { name: p.querySelector('.pane-name')?.textContent ?? null, state: p.querySelector('.pane-state')?.textContent ?? null, resume: !!p.querySelector('.pane-resume') } : null; })()`);
// The screen as text. WebGL draws to a canvas, so the DOM rows are empty; the
// terminal exposes itself on its host element for exactly this.
const termText = (s, paneId) => s.evalJs(`(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host')?.emeraldTerm; if (!t) return ''; const b = t.buffer.active; const lines = []; for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? ''); return lines.join('\\n'); })()`);
const waitRowState = (s, id, state, what) => s.waitFor(`${row(id)}?.dataset.state === ${JSON.stringify(state)}`, what, 8000);
const menuFor = async (s, id, item) => {
  await s.evalJs(`${row(id)}.querySelector('.sidebar-row-menu').click()`);
  await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(id)}`, `menu for ${id.slice(0, 8)}`);
  await s.evalJs(`[...document.querySelectorAll('.row-menu button')].find(b => b.textContent === ${JSON.stringify(item)}).click()`);
};
const sessionsFile = () => JSON.parse(fs.readFileSync(path.join(emeraldHome, 'sessions.json'), 'utf8')).sessions;
// The daemon writes sessions.json up to a quarter second after a change
// (M9 fix 459), so a read of the file waits up to three seconds for it to
// agree; a read mid-rename is tried again.
const fileAgrees = async (pred) => {
  for (const end = Date.now() + 3000; ; await sleep(100)) {
    let ok = false;
    try {
      ok = pred(sessionsFile());
    } catch {}
    if (ok || Date.now() > end) return ok;
  }
};
// M24: the colour as the row and the title carry it (data-color feeds the
// CSS), plus what the CSS made of it: the bar's colour on both, and the
// title's ground, which since M38 is the focused header's amber tint on
// pane 2 (the focused one) and the plain header on pane 1, so it differs
// between the two.
const rowColor = (s, id) => s.evalJs(`(() => { const r = ${row(id)}; if (!r) return null; return { data: r.dataset.color ?? null, bar: getComputedStyle(r, '::before').backgroundColor }; })()`);
const titleColor = (s, paneId) =>
  s.evalJs(
    `(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-title'); if (!t) return null; return { data: t.dataset.color ?? null, bg: getComputedStyle(t).backgroundColor, bar: getComputedStyle(t, '::before').backgroundColor }; })()`,
  );
const PALETTE = /^#[0-9a-f]{6}$/;
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const read = async (s, id) => Buffer.from((await zreq(s, 'session.read', { sessionId: id })).data, 'base64').toString();
const typeLine = async (s, text) => {
  await s.type(text);
  await s.key('Enter', 'Enter', 13);
};

const home = os.homedir();
fs.rmSync(path.join(emeraldHome, 'sessions.json'), { force: true });
const s = await launch(freshPort(), { freshState: true });
let firstDaemon = null;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await startSession(s, { kind: 'shell', cwd: home });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell A');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes');
  await startSession(s, { kind: 'shell', cwd: repoRoot });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'shell B');
  await sleep(800);
  let layout = await getLayout(s);
  const [p1, p2] = leaves(layout);
  const A = p1.sessionId;
  const B = p2.sessionId;
  expect(layout.focusedPaneId === p2.id, 'pane 2 focused');
  const marker1 = 'EMERALD_BEFORE_' + Date.now();
  await typeLine(s, `Write-Output ('OUT:' + '${marker1}')`);
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.read', { sessionId: ${JSON.stringify(B)} }); return atob(r.data).includes('OUT:${marker1}'); })()`, 'marker in B');
  firstDaemon = daemonPid();
  step(`A=${A.slice(0, 8)} in pane 1, B=${B.slice(0, 8)} in pane 2, daemon pid ${firstDaemon}`);
  expect(await fileAgrees((f) => f.map((x) => x.id).sort().join() === [A, B].sort().join()), 'sessions.json lists both');

  // M24: a colour each, from the palette, apart from each other, on the
  // row's bar and the pane title's bar.
  const listed = (await zreq(s, 'session.list', {})).sessions;
  const colorA = listed.find((x) => x.id === A).color;
  const colorB = listed.find((x) => x.id === B).color;
  expect(PALETTE.test(colorA) && PALETTE.test(colorB), `both sessions have a hex colour, got ${colorA} and ${colorB}`);
  expect(colorA !== colorB, 'two sessions get different colours while the palette has free ones');
  expect(await fileAgrees((f) => f.find((x) => x.id === A).color === colorA && f.find((x) => x.id === B).color === colorB), 'sessions.json carries the colours');
  const rcA = await rowColor(s, A);
  const tcA = await titleColor(s, p1.id);
  const tcB = await titleColor(s, p2.id);
  expect(rcA.data === colorA && rcA.bar === rgb(colorA), `row A carries its colour and draws the bar in it, got ${JSON.stringify(rcA)}`);
  expect(tcA.data === colorA && tcB.data === colorB, `pane titles carry the colours, got ${JSON.stringify([tcA, tcB])}`);
  expect(tcA.bar === rgb(colorA) && tcB.bar === rgb(colorB), `pane titles draw the bar in their own colour, got ${JSON.stringify([tcA.bar, tcB.bar])}`);
  expect(
    tcA.bg !== tcB.bg && tcA.bg !== 'rgba(0, 0, 0, 0)' && tcB.bg !== 'rgba(0, 0, 0, 0)' && tcA.bg !== rgb(colorA) && tcB.bg !== rgb(colorB),
    `the focused title's ground differs from the other's and neither is the session's colour, got ${tcA.bg} and ${tcB.bg}`,
  );
  await s.screenshot('m5-colours.png');
  step(`colours: A ${colorA} (title bar ${tcA.bar} on ${tcA.bg}), B ${colorB} (title bar ${tcB.bar} on ${tcB.bg})`);

  // Kill B: the badge says killed, and so does the terminal.
  await menuFor(s, B, 'Kill');
  await waitRowState(s, B, 'exited', 'B exited after kill');
  expect((await rowBadge(s, B)) === 'killed', `row badge is killed, got ${await rowBadge(s, B)}`);
  await sleep(300);
  let t2 = await paneTitle(s, p2.id);
  expect(t2.state === 'killed' && t2.resume, `pane 2 title shows killed with a Resume button, got ${JSON.stringify(t2)}`);
  expect((await termText(s, p2.id)).includes('[killed from emerald]'), 'terminal shows the kill note');
  expect(await fileAgrees((f) => f.find((x) => x.id === B).exitCode === -1073741510), 'sessions.json records the kill');
  step('kill shows as "killed" in the row, the title and the terminal');

  // Daemon restart: both sessions come back as exited with their names.
  spawn('taskkill', ['/pid', String(firstDaemon), '/f'], { stdio: 'ignore' });
  await s.waitFor(`!!document.querySelector('.banner')`, 'disconnected banner');
  await s.waitFor(`!document.querySelector('.banner')`, 'reconnect after daemon autostart', 20000);
  const secondDaemon = daemonPid();
  expect(secondDaemon !== firstDaemon, 'a new daemon');
  await s.waitFor(`${row(A)}?.dataset.state === 'exited' && ${row(B)}?.dataset.state === 'exited'`, 'both rows exited after restart');
  await sleep(500);
  expect((await rowBadge(s, A)) === 'exited', `A was live, so no exit code: got ${await rowBadge(s, A)}`);
  expect((await rowBadge(s, B)) === 'killed', 'B keeps its recorded kill');
  const t1 = await paneTitle(s, p1.id);
  t2 = await paneTitle(s, p2.id);
  expect(t1.name === path.basename(home) && t1.state === 'exited' && t1.resume, `pane 1 labelled after restart, got ${JSON.stringify(t1)}`);
  expect(t2.name === path.basename(repoRoot) && t2.state === 'killed', `pane 2 labelled after restart, got ${JSON.stringify(t2)}`);
  expect(!(await s.evalJs(`document.body.textContent.includes('cannot attach')`)), 'no attach errors');
  expect((await termText(s, p1.id)).includes('scrollback lost'), 'pane 1 explains the lost scrollback');
  layout = await getLayout(s);
  expect(leaves(layout)[0].sessionId === A && leaves(layout)[1].sessionId === B, 'panes still point at A and B');
  const restored = (await zreq(s, 'session.list', {})).sessions;
  expect(restored.find((x) => x.id === A).color === colorA && restored.find((x) => x.id === B).color === colorB, 'the new daemon lists the same colours');
  expect((await rowColor(s, A)).data === colorA && (await titleColor(s, p2.id)).data === colorB, 'the row and the title keep their colours across the restart');
  await s.screenshot('m5-after-daemon-restart.png');
  step(`daemon restart: pid ${secondDaemon} listed A as exited and B as killed, panes kept their names`);

  // M9 fix 313: a key into pane 2, still exited, sends nothing and shows
  // the notice instead of reaching a session with no pty.
  await s.type('x');
  await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(p2.id)}] [data-exited-notice]')`, 'exited notice shows on a key');
  const notice = await s.evalJs(
    `(() => { const n = document.querySelector('[data-pane-id=${JSON.stringify(p2.id)}] [data-exited-notice]'); return n ? { title: n.querySelector('.pane-exited-notice-title')?.textContent ?? null, body: n.querySelector('.pane-exited-notice-body')?.textContent ?? null, resume: !!n.querySelector('.pane-exited-notice-resume') } : null; })()`,
  );
  expect(notice?.title === 'exited', `notice's first line, got ${JSON.stringify(notice)}`);
  expect(notice?.body === "This session's process has ended; its last screen is kept.", `notice's body line, got ${JSON.stringify(notice)}`);
  expect(notice?.resume === true, 'notice carries its own Resume button');
  expect((await termText(s, p2.id)).includes('[killed from emerald]'), 'the key did not reach the pty; the kept screen is unchanged');
  step('typing into the exited pane sends nothing and shows the notice instead');

  // Resume B from the notice's own button: same id, same pane, a live shell.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p2.id)}] .pane-exited-notice-resume').click()`);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(p2.id)}] [data-exited-notice]')`, 'notice gone after its Resume');
  await waitRowState(s, B, 'idle', 'B idle after resume');
  layout = await getLayout(s);
  expect(leaves(layout)[1].sessionId === B && layout.focusedPaneId === p2.id, 'B still in pane 2 and focused');
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(p2.id)}] .pane-resume')`, 'Resume button gone');
  await sleep(1500);
  expect(!(await termText(s, p2.id)).includes('killed from emerald'), 'terminal was cleared for the new process');
  const marker2 = 'EMERALD_RESUMED_' + Date.now();
  await typeLine(s, `Write-Output ('OUT:' + '${marker2}')`);
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.read', { sessionId: ${JSON.stringify(B)} }); return atob(r.data).includes('OUT:${marker2}'); })()`, 'typing reaches resumed B');
  expect((await termText(s, p2.id)).includes('OUT:' + marker2), 'resumed output on screen');
  const bInfo = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === B);
  expect(bInfo.pid !== null && bInfo.exitCode === null && bInfo.spawnCwd === repoRoot, 'B is live again in its spawn folder');
  expect(await fileAgrees((f) => f.find((x) => x.id === B).exitCode === null), 'sessions.json no longer records an exit for B');
  expect(bInfo.color === colorB && sessionsFile().find((x) => x.id === B).color === colorB && (await titleColor(s, p2.id)).data === colorB, 'the resume keeps the colour');
  step('pane Resume brought B back in pane 2 under the same id; typing reaches the new shell');

  // Resume A by double-clicking its row.
  const c = await s.evalJs(`(() => { const r = ${row(A)}.querySelector('.sidebar-row-name').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; })()`);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 2 });
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 2 });
  await waitRowState(s, A, 'idle', 'A idle after double-click');
  layout = await getLayout(s);
  expect(leaves(layout)[0].sessionId === A && layout.focusedPaneId === p1.id, 'A still in pane 1, now focused');
  expect(rowIdsEqual(await rowIds(s), [A, B]) || rowIdsEqual(await rowIds(s), [B, A]), 'no exited group left');
  step('row double-click resumed A in pane 1');
  await s.screenshot('m5-after-resume.png');

  // Remove: kill A, then remove it from the menu. It leaves the list, the
  // file and pane 1, which goes empty.
  await menuFor(s, A, 'Kill');
  await waitRowState(s, A, 'exited', 'A exited after kill');
  await menuFor(s, A, 'Remove');
  await s.waitFor(`!${row(A)}`, 'A row gone');
  await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(p1.id)}] .empty-pane')`, 'pane 1 empty');
  layout = await getLayout(s);
  expect(leaves(layout)[0].sessionId === null && leaves(layout)[1].sessionId === B, 'pane 1 cleared, pane 2 untouched');
  expect(await fileAgrees((f) => typeof f.find((x) => x.id === A)?.removedAt === 'number'), 'A kept in sessions.json as removed (M57)');
  expect(!(await zreq(s, 'session.list', {})).sessions.some((x) => x.id === A), 'A gone from the daemon');
  step('remove cleared A from the list, the file and its pane');

  // M9 fix 290: Resume all takes every exited row, each in the pane it
  // kept. C has never been shown, so a new pane cannot be chosen for it
  // either; it goes back to being a listed row (M9 fix 91).
  const { session: spawnedC } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 });
  const C = spawnedC.id;
  await s.waitFor(`!!${row(C)}`, 'C listed with no pane');
  await menuFor(s, B, 'Kill');
  await waitRowState(s, B, 'exited', 'B exited for Resume all');
  await menuFor(s, C, 'Kill');
  await waitRowState(s, C, 'exited', 'C exited for Resume all');
  await s.waitFor(`!!document.querySelector('.sidebar-group[data-group="exited"] .sidebar-resume-all')`, 'Resume all button');
  await s.evalJs(`document.querySelector('.sidebar-resume-all').click()`);
  await s.waitFor(`${row(B)}?.dataset.state !== 'exited' && ${row(C)}?.dataset.state !== 'exited'`, 'both rows left the exited group on Resume all');
  layout = await getLayout(s);
  expect(leaves(layout).some((leaf) => leaf.sessionId === B), 'B came back in the pane it kept');
  const bPlace = await s.evalJs(`${row(B)}?.dataset.place ?? null`);
  expect(bPlace === 'shown', `B's row reads shown on screen after Resume all, got ${bPlace}`);
  expect(!leaves(layout).some((leaf) => leaf.sessionId === C), 'C is not put in any pane');
  expect((await s.evalJs(`!!${row(C)}`)) === true, 'C is still listed, as a row with no pane');
  step('M9 fix 290: Resume all put B back in pane 2 and left C listed with no pane');

  // Kill both again so Clear exited below finds a plain exited group.
  await menuFor(s, B, 'Kill');
  await waitRowState(s, B, 'exited', 'B exited again before Clear exited');
  await menuFor(s, C, 'Kill');
  await waitRowState(s, C, 'exited', 'C exited again before Clear exited');

  // Clear exited: B and C are the last two sessions, then the group
  // button empties the list.
  await s.waitFor(`!!document.querySelector('.sidebar-group[data-group="exited"] .sidebar-clear-exited')`, 'Clear exited button');
  await s.evalJs(`document.querySelector('.sidebar-clear-exited').click()`);
  await s.waitFor(`document.querySelector('.sidebar-empty')?.textContent === 'No sessions yet'`, 'sidebar empty after clear');
  await s.waitFor(`document.querySelectorAll('.empty-pane').length === 2`, 'both panes empty');
  expect(await fileAgrees((f) => f.every((x) => typeof x.removedAt === 'number')), 'sessions.json holds removed records only (M57)');
  step('Clear exited emptied the list, the file and the last pane');
  await s.screenshot('m5-after-remove.png');
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m5-resume-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  if (firstDaemon !== null) spawn('taskkill', ['/pid', String(firstDaemon), '/f'], { stdio: 'ignore' });
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}

function rowIdsEqual(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
