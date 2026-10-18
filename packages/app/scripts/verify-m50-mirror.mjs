// M50 acceptance: a session in several panes, and a group as a panes tab.
// A sidebar row dropped on the right band of the pane already showing it
// gives a second pane on the same session with no second attach; what
// the shell prints lands in both terminals; the PTY follows the focused
// pane's size, so the narrower pane focused makes the PTY narrow and the
// wider pane focused makes it wide with the narrower pane scaled down to
// fit; a pane dragged by its title onto the centre of the other closes
// the pane it came from and leaves one; the folder heading's tab button
// opens a tab named after the group with one pane per session and the
// first tab's panes untouched, and a second press numbers the name; a
// session removed clears every pane on it in every tab. The layout is
// driven directly (layout.set) where a gesture would only add noise. Uses
// a private home and pipe unless the environment already names them.
// Run: npm run verify:mirror -w @emerald/app
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm50-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m50';
const { clickNewShell, expect, focusedPaneIs, freshPort, getLayout, getTabs, killTree, launch, leaves, sleep, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 150 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 150000);

const home = os.homedir();
const s = await launch(freshPort(), { freshState: true });
app = s;

const boxOf = (paneId) =>
  s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
const centerOf = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const move = (p) => s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1 });
const dragOn = () => s.evalJs(`document.body.classList.contains('dragging-session')`);
const zoneOn = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .drop-overlay')?.dataset.dropZone ?? null`);
const hostSel = (paneId) => `[data-pane-id=${JSON.stringify(paneId)}] .term-host`;
const termOf = (paneId) => s.evalJs(`(() => { const t = document.querySelector(${JSON.stringify(hostSel(paneId))})?.emeraldTerm; return t ? { cols: t.cols, rows: t.rows } : null; })()`);
const scaleOf = (paneId) =>
  s.evalJs(
    `(() => { const h = document.querySelector(${JSON.stringify(hostSel(paneId))}); const x = h?.querySelector('.xterm'); return { attr: h?.dataset.mirrorScale ?? null, transform: x?.style.transform ?? null, pointer: x?.style.pointerEvents ?? null }; })()`,
  );
// The buffer's lines, top to bottom, blanks trimmed.
const bufferLines = (paneId) =>
  s.evalJs(
    `(() => { const t = document.querySelector(${JSON.stringify(hostSel(paneId))})?.emeraldTerm; if (!t) return null; const b = t.buffer.active; const out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? ''); return out; })()`,
  );
const bufferHas = async (paneId, text) => ((await bufferLines(paneId)) ?? []).some((l) => l.includes(text));
const lastLine = async (paneId) => {
  const lines = ((await bufferLines(paneId)) ?? []).filter((l) => l.trim() !== '');
  return lines[lines.length - 1] ?? '';
};
const type = (sessionId, text) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(sessionId)}, data: ${JSON.stringify(text + '\r')} })`);
const waitBoth = async (a, b, text, what) => {
  const until = Date.now() + 10000;
  while (Date.now() < until && !((await bufferHas(a, text)) && (await bufferHas(b, text)))) await sleep(200);
  expect((await bufferHas(a, text)) && (await bufferHas(b, text)), what);
};
// The shell reports the PTY's width: the number after the marker, which
// the echoed command line does not carry (it shows the expression).
const ptyCols = async (paneId, sessionId, marker) => {
  await type(sessionId, `echo "${marker}=$($Host.UI.RawUI.WindowSize.Width)"`);
  const re = new RegExp(`${marker}=(\\d+)`);
  const until = Date.now() + 10000;
  let found = null;
  while (Date.now() < until && found === null) {
    for (const line of (await bufferLines(paneId)) ?? []) {
      const m = re.exec(line);
      if (m !== null) found = Number(m[1]);
    }
    if (found === null) await sleep(200);
  }
  expect(found !== null, `the shell printed ${marker}`);
  return found;
};

try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await clickNewShell(s, home);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'a shell in the first pane');
  let layout = await getLayout(s);
  const first = layout.focusedPaneId;
  const sessionId = leaves(layout)[0].sessionId;
  const rowSel = `.sidebar-row[data-session-id=${JSON.stringify(sessionId)}]`;
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.shown === 'focused'`, 'the row says focused');
  // From here every attach and detach is counted, off the feed's own
  // counters (window.emerald is frozen, so request cannot be wrapped).
  const base = await s.evalJs(`({ ...window.emeraldFeed.stats })`);
  const attaches = async () => (await s.evalJs('window.emeraldFeed.stats.attaches')) - base.attaches;
  const detaches = async () => (await s.evalJs('window.emeraldFeed.stats.detaches')) - base.detaches;
  await type(sessionId, 'echo before-mirror');
  await s.waitFor(`(() => { const t = document.querySelector(${JSON.stringify(hostSel(first))})?.emeraldTerm; if (!t) return false; const b = t.buffer.active; for (let i = 0; i < b.length; i++) if (b.getLine(i)?.translateToString(true).includes('before-mirror')) return true; return false; })()`, 'a line printed before the mirror opens');
  step('a shell on screen, attaches counted from here');

  // The row dropped on the right band of its own pane: a second pane on
  // the same session, the first still showing it, and no second attach.
  const box = await boxOf(first);
  const rightBand = { x: Math.round(box.x + box.width * 0.9), y: Math.round(box.y + box.height / 2) };
  const row = await centerOf(rowSel);
  await s.mouse('mousePressed', row.x, row.y);
  await move({ x: row.x + 10, y: row.y });
  await move(rightBand);
  expect(await dragOn(), 'the drag is on');
  expect((await zoneOn(first)) === 'right', `the right half of the pane showing the session is previewed, got ${await zoneOn(first)}`);
  await s.mouse('mouseReleased', rightBand.x, rightBand.y);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2 && document.querySelectorAll('.term-host').length === 2`, 'two panes with terminals after the drop');
  layout = await getLayout(s);
  const root = layout.root;
  expect(root.kind === 'split' && root.direction === 'row' && root.first.id === first && root.first.sessionId === sessionId && root.second.sessionId === sessionId, 'a row split: the old pane keeps the session and the new pane shows it too');
  const second = root.second.id;
  expect(layout.focusedPaneId === second, 'the new pane is focused');
  await sleep(400);
  expect((await attaches()) === 0, `no second attach for the mirror, got ${await attaches()}`);
  expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(hostSel(second))})?.emeraldTerm`), 'the mirror has a terminal');
  await s.screenshot('m50-mirror-drop.png');
  step('the row dropped on its own pane: a mirror beside it, one attachment');

  // What the shell prints lands in both, and the mirror was written the
  // scrollback the first pane had.
  await type(sessionId, 'echo mirror-ok');
  await waitBoth(first, second, 'mirror-ok', 'both terminals show the echo');
  const last1 = await lastLine(first);
  const last2 = await lastLine(second);
  expect(last1 === last2, `the same last line in both, got ${JSON.stringify(last1)} and ${JSON.stringify(last2)}`);
  expect(await bufferHas(second, 'before-mirror'), 'the mirror holds the scrollback from before it opened');
  step('what the shell prints lands in both panes, and the mirror has the scrollback');

  // The PTY follows the focused pane. The split is set to 0.7 so the left
  // pane is wide and the right narrow; the narrow one is focused, so both
  // terminals and the PTY take its width. Then the wide one is focused:
  // everything takes its width, and the narrow pane scales down to fit.
  await zreq(s, 'layout.set', { layout: { ...layout, root: { ...root, ratio: 0.7 } } });
  await s.waitFor(`(async () => (await window.emerald.request('layout.get', {})).layout.tabs[0].root.ratio === 0.7)()`, 'the ratio landed');
  await sleep(500);
  const narrow = await termOf(second);
  const wideBox = await boxOf(first);
  const narrowBox = await boxOf(second);
  expect(wideBox.width > narrowBox.width * 1.5, `the left pane is the wide one, got ${wideBox.width} and ${narrowBox.width}`);
  expect((await termOf(first))?.cols === narrow.cols, `the wide pane's terminal takes the focused narrow pane's columns, got ${JSON.stringify(await termOf(first))} against ${JSON.stringify(narrow)}`);
  expect((await scaleOf(first)).attr === null && (await scaleOf(second)).attr === null, `neither pane is scaled while the narrow one is focused, got ${JSON.stringify(await scaleOf(first))} ${JSON.stringify(await scaleOf(second))}`);
  const colsNarrow = await ptyCols(second, sessionId, 'm1cols');
  expect(colsNarrow === narrow.cols, `the PTY is ${narrow.cols} columns wide like the focused pane, got ${colsNarrow}`);
  step(`the narrow pane focused: both terminals and the PTY at its ${narrow.cols} columns, nothing scaled`);

  const wideMiddle = { x: Math.round(wideBox.x + wideBox.width / 2), y: Math.round(wideBox.y + wideBox.height / 2) };
  await s.click(wideMiddle.x, wideMiddle.y);
  await s.waitFor(focusedPaneIs(first), 'the wide pane focused');
  await s.waitFor(`document.querySelector(${JSON.stringify(hostSel(second))})?.emeraldTerm?.cols > ${narrow.cols}`, 'the mirror widened to the focused pane');
  const wide = await termOf(first);
  expect(wide.cols > narrow.cols && (await termOf(second))?.cols === wide.cols, `both terminals at the wide pane's ${wide.cols} columns`);
  const scaled = await scaleOf(second);
  expect(scaled.attr !== null && Number(scaled.attr) < 1 && Number(scaled.attr) > 0.3, `the narrow pane is scaled down, got ${JSON.stringify(scaled)}`);
  expect(scaled.transform.startsWith('scale(') && scaled.pointer === 'none', `a scale transform with no pointer, got ${JSON.stringify(scaled)}`);
  expect((await scaleOf(first)).attr === null, 'the focused pane is 1:1');
  const colsWide = await ptyCols(first, sessionId, 'm2cols');
  expect(colsWide === wide.cols, `the PTY followed to ${wide.cols} columns, got ${colsWide}`);
  await waitBoth(first, second, `m2cols=${wide.cols}`, 'the mirror shows the same output at the new width');
  await s.screenshot('m50-mirror-scaled.png');
  step(`the wide pane focused: both terminals and the PTY at its ${wide.cols} columns, the narrow pane scaled to ${scaled.attr}`);

  // A pane dragged by its title onto the centre of the other pane moves:
  // the other already shows the session, so nothing changes there and the
  // pane it came from goes, leaving one, still attached.
  // M9 fix 840: the narrow pane's title is about 200 px, where its words
  // give before its buttons and the name is hidden, so the press is on the
  // session mark, drawn at every level; the bar's drag takes a press
  // anywhere but a button, the rename box and the context reading.
  const title = await centerOf(`[data-pane-id=${JSON.stringify(second)}] .pane-mark`);
  await s.mouse('mousePressed', title.x, title.y);
  await move({ x: title.x + 10, y: title.y });
  await move(wideMiddle);
  expect((await zoneOn(first)) === 'center', `the whole other pane is previewed, got ${await zoneOn(first)}`);
  await s.mouse('mouseReleased', wideMiddle.x, wideMiddle.y);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1 && document.querySelectorAll('.term-host').length === 1`, 'one pane again');
  layout = await getLayout(s);
  expect(layout.root.kind === 'pane' && layout.root.id === first && layout.root.sessionId === sessionId, 'the wide pane is the one left, still on the session');
  await sleep(600);
  expect((await detaches()) === 0 && (await attaches()) === 0, `the attachment survived the mirror closing, got ${await detaches()} detaches and ${await attaches()} attaches`);
  await type(sessionId, 'echo still-here');
  await s.waitFor(`(() => { const t = document.querySelector(${JSON.stringify(hostSel(first))})?.emeraldTerm; if (!t) return false; const b = t.buffer.active; for (let i = 0; i < b.length; i++) if (b.getLine(i)?.translateToString(true).includes('still-here')) return true; return false; })()`, 'the pane left still receives output');
  step('the mirror dragged by its title onto the centre of the other pane: one pane left, the attachment kept');

  // The folder heading's tab button: a second shell in the same folder is
  // listed with no pane; the button opens a tab named after the folder
  // with a pane per session, and the first tab keeps its one pane.
  const { session: other } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 });
  const otherRow = `.sidebar-row[data-session-id=${JSON.stringify(other.id)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(otherRow)})`, 'the second shell is listed');
  const groupSel = `.sidebar-row[data-session-id=${JSON.stringify(sessionId)}]`;
  const groupTitle = await s.evalJs(`document.querySelector(${JSON.stringify(groupSel)}).closest('.sidebar-group').querySelector('.sidebar-group-name').textContent`);
  const tabButton = `.sidebar-row[data-session-id=${JSON.stringify(sessionId)}]`;
  const tabTitle = await s.evalJs(`document.querySelector(${JSON.stringify(tabButton)}).closest('.sidebar-group').querySelector('.sidebar-group-tab')?.title ?? null`);
  expect(tabTitle !== null && tabTitle.startsWith('New panes tab for'), `the heading has the tab button, got ${tabTitle}`);
  const tabsBefore = (await getTabs(s)).tabs.length;
  await s.evalJs(`document.querySelector(${JSON.stringify(tabButton)}).closest('.sidebar-group').querySelector('.sidebar-group-tab').click()`);
  await s.waitFor(`(async () => (await window.emerald.request('layout.get', {})).layout.tabs.length === ${tabsBefore + 1})()`, 'a tab added');
  let all = await getTabs(s);
  const groupTab = all.tabs[all.tabs.length - 1];
  expect(all.currentTabId === groupTab.id, 'the new tab is shown');
  expect(groupTab.name === groupTitle, `the tab is named after the group, got ${groupTab.name} for ${groupTitle}`);
  const groupPanes = leaves(groupTab).map((p) => p.sessionId);
  expect(groupPanes.length === 2 && groupPanes.includes(sessionId) && groupPanes.includes(other.id), `one pane per session of the group, got ${JSON.stringify(groupPanes)}`);
  expect(groupTab.root.kind === 'split' && groupTab.root.direction === 'row', 'two sessions side by side');
  expect(leaves(all.tabs[0]).length === 1 && leaves(all.tabs[0])[0].sessionId === sessionId, 'the first tab keeps its one pane on the session');
  // Every tab's panes stay mounted, the other tabs' hidden, so the first
  // tab's terminal is still there behind the group tab's two.
  await s.waitFor(`document.querySelectorAll('.layout-tab:not([hidden]) .term-host').length === 2 && document.querySelectorAll('.term-host').length === 3`, 'two terminals on the group tab and the first tab behind it');
  await sleep(400);
  const otherPane = leaves(groupTab).find((p) => p.sessionId === other.id).id;
  const otherHost = await s.evalJs(`(() => { const h = document.querySelector(${JSON.stringify(hostSel(otherPane))}); const t = h?.emeraldTerm; return { w: h?.clientWidth, h: h?.clientHeight, cols: t?.cols, rows: t?.rows, inHost: t?.element?.parentElement === h, hidden: !!h?.closest('.layout-tab[hidden]') }; })()`);
  expect((await attaches()) === 1, `one attach for the second shell, none for the mirrored one, got ${await attaches()} with ${JSON.stringify(otherHost)}`);
  await s.waitFor(`document.querySelector('.tab-panes[data-current] .tab-name')?.textContent === ${JSON.stringify(groupTitle)}`, 'the strip shows the tab under the group name');
  await s.screenshot('m50-group-tab.png');
  step(`the heading's tab button: a tab named ${groupTitle} with a pane per session, the first tab untouched`);

  await s.evalJs(`document.querySelector(${JSON.stringify(tabButton)}).closest('.sidebar-group').querySelector('.sidebar-group-tab').click()`);
  await s.waitFor(`(async () => (await window.emerald.request('layout.get', {})).layout.tabs.length === ${tabsBefore + 2})()`, 'a second tab added');
  all = await getTabs(s);
  expect(all.tabs[all.tabs.length - 1].name === `${groupTitle} 2`, `the second press numbers the name, got ${all.tabs[all.tabs.length - 1].name}`);
  step(`a second press names it ${groupTitle} 2`);

  // The mirrored session removed: every pane on it, in every tab, empties.
  await zreq(s, 'session.kill', { sessionId, remove: true });
  await s.waitFor(`(async () => { const l = (await window.emerald.request('layout.get', {})).layout; return l.tabs.every(t => JSON.stringify(t.root).indexOf(${JSON.stringify(sessionId)}) < 0); })()`, 'no pane holds the session');
  await s.waitFor(`document.querySelectorAll('.empty-pane').length >= 1`, 'an empty pane on the shown tab');
  all = await getTabs(s);
  expect(all.tabs.every((t) => leaves(t).every((p) => p.sessionId !== sessionId)), 'every tab is clear of the removed session');
  step('the session removed: every pane on it in every tab is clear');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m50-mirror-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
