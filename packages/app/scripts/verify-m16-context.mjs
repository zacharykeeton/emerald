// M16 acceptance: the model and the context fill on a Claude row. A shell
// stands in for Claude: hook events are posted to the private daemon's
// sink as the wrapper would post them. A SessionStart then a StatusLine
// put "Fable · 42%" on the sidebar row and the pane title; a second
// StatusLine changes it; the state badge does not move for either; a
// plain shell shows nothing; the values survive a daemon restart; and a
// StatusLine for another session id is ignored. M9 fix 39: a resume comes
// up with neither, and a SessionEnd on a shell clears both with the badge.
// M42: the status line's token counts land as contextWindow, the dial gets
// its red band from the compaction point, the rail's footer shows the
// stacked bar for the focused pane's session, and a status line without
// the counts keeps them. M9 fix 53: the divider after the reading. M9
// fix 66: the dial sits right before the percent in the title and on
// the row, which has a dial of its own now. M9 fix 67: the footer bar is
// gone; a click on either reading opens the context card with the bar,
// the legend, the compaction point and the last request's counts.
// The private daemon runs at the current feature level, so no banner.
// Uses a private home and pipe unless the environment already names them.
// Run: npm run verify:context -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { processIdentity } from '@emerald/shared/process-identity';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm16-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m16';
const { CTRL, SHIFT, daemonPid, expect, freshPort, getLayout, killTree, launch, leaves, railAtOldWidth, shotsDir, sleep, startSession, step, stopDaemon, zreq } =
  await import('./cdp.mjs');

// M9 fix 586: the Claude shell runs in a fixture repository of the script's
// own, one clean commit on main, so its row's second line and its title read
// the same on every checkout and branch. The pid sits in the parent folder so
// the basename, which the title shows, keeps one width.
const fixtureParent = path.join(os.tmpdir(), 'emerald-verify', `m16-${process.pid}`);
fs.rmSync(fixtureParent, { recursive: true, force: true });
fs.mkdirSync(path.join(fixtureParent, 'repo'), { recursive: true });
// The long form, since os.tmpdir() is in 8.3 form on this box and the hook's cwd must equal the session's.
const fixture = fs.realpathSync.native(path.join(fixtureParent, 'repo'));
fs.writeFileSync(path.join(fixture, 'notes.md'), 'fixture\n');
const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'verify');
git('config', 'user.email', 'verify@example.invalid');
git('config', 'commit.gpgsign', 'false');
git('add', '.');
git('commit', '-q', '-m', 'seed');

let app = null;
// The first daemon as daemon.json names it, pid and start time (M9 fix
// 735): it is killed by pid at the restart step and again by the watchdog
// and the finally, long after, when Windows may have given the number to
// another process, so every kill asks first whether it is still the same.
let firstDaemon = null;
const readDaemon = () => {
  const { pid, startedAt } = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  return { pid, startedAt };
};
const killFirstDaemon = () => {
  if (firstDaemon !== null && processIdentity(firstDaemon.pid, firstDaemon.startedAt) === 'same') spawn('taskkill', ['/pid', String(firstDaemon.pid), '/f'], { stdio: 'ignore' });
};
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 180 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  killFirstDaemon();
  setTimeout(() => process.exit(3), 500);
}, 180000);

// The reading without the tokens span (M9 fix 143), which sits inside
// the same element once a status line with counts has landed and is
// the token script's to read, not this one's.
const readingText = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el === null) return null; return [...el.childNodes].filter((n) => !(n.classList && (n.classList.contains('sidebar-row-tokens') || n.classList.contains('sidebar-row-cost') || n.classList.contains('pane-tokens') || n.classList.contains('pane-cost')))).map((n) => n.textContent).join(''); })()`;
const rowContext = (s, id) => s.evalJs(readingText(`.sidebar-row[data-session-id=${JSON.stringify(id)}] .sidebar-row-context`));
const rowState = (s, id) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}] .sidebar-row-state')?.textContent ?? null`);
const paneContext = (s, paneId) => s.evalJs(readingText(`[data-pane-id=${JSON.stringify(paneId)}] .pane-context`));
const paneState = (s, paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-state')?.textContent ?? null`);
// M9 fix 67: the card a reading opens, read whole. openCard clicks the
// reading (the title's or the row's) and waits for the card for that
// session; closeCard presses Escape and waits for it to go.
const cardProbe = (s, id) =>
  s.evalJs(
    `(() => { const card = document.querySelector('.context-popover[data-session-id=${JSON.stringify(id)}]'); if (card === null) return null; const track = card.querySelector('.context-bar-track'); const tr = track?.getBoundingClientRect() ?? null; const r = (sel) => { const el = card.querySelector(sel); if (el === null) return null; const b = el.getBoundingClientRect(); return { width: el.style.width, left: Math.round((b.left - tr.left) * 10) / 10, right: Math.round((tr.right - b.right) * 10) / 10, px: Math.round(b.width * 10) / 10 }; }; const box = card.getBoundingClientRect(); return { heading: card.querySelector('.context-popover-heading').textContent, fill: card.querySelector('.context-popover-fill')?.textContent ?? null, used: r('.context-bar-used'), buffer: r('.context-bar-buffer'), track: tr === null ? null : Math.round(tr.width * 10) / 10, legend: [...card.querySelectorAll('.context-bar-key')].map((k) => k.textContent), compact: card.querySelector('.context-popover-compact')?.textContent ?? null, request: card.querySelector('.context-popover-request')?.textContent ?? null, inWindow: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight, position: getComputedStyle(card).position }; })()`,
  );
const openCard = async (s, readingSel, id, what) => {
  await s.evalJs(`document.querySelector(${JSON.stringify(readingSel)}).click()`);
  await s.waitFor(`!!document.querySelector('.context-popover[data-session-id=${JSON.stringify(id)}]')`, `the card from ${what}`);
  return cardProbe(s, id);
};
const closeCard = async (s) => {
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.context-popover')`, 'the card closed on Escape');
};
const waitRowContext = (s, id, text, what) =>
  s.waitFor(`${readingText(`.sidebar-row[data-session-id=${JSON.stringify(id)}] .sidebar-row-context`)} === ${JSON.stringify(text)}`, what, 5000);

const s = await launch(freshPort(), { freshState: true });
app = s;
try {
  // M9 fix 885 widened the rail's default to 330 px; the title walks below
  // were written against the old pane area (pane 1 wide past 450 px beside a
  // 160 px pane 2, the 330 px default split), and they are about the panes,
  // not the rail.
  await railAtOldWidth(s);
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  // Pane 1 plays Claude, pane 2 is a plain shell that never reports.
  await startSession(s, { kind: 'shell', cwd: fixture });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell in pane 1');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'a second pane');
  await startSession(s, { kind: 'shell', cwd: os.homedir() });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'shell in pane 2');
  let layout = await getLayout(s);
  const [p1, p2] = leaves(layout).map((p) => p.id);
  const claude = leaves(layout)[0].sessionId;
  const plain = leaves(layout)[1].sessionId;
  firstDaemon = readDaemon();
  expect((await rowContext(s, claude)) === null && (await paneContext(s, p1)) === null, 'nothing shown before any status line');
  step(`two shells, daemon pid ${firstDaemon.pid}; no model or context shown yet`);

  // Read per post: the daemon is restarted below and the new one has a
  // hook port and token of its own.
  const daemonInfo = () => JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const post = async (sessionId, payload) => {
    const daemon = daemonInfo();
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ session_id: 'sim-m16', cwd: fixture, ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  // What the wrapper posts: Claude Code's status line JSON plus the event name.
  const statusLine = (model, percent, extra = {}) => ({
    hook_event_name: 'StatusLine',
    model: { id: `claude-${model.toLowerCase()}-5`, display_name: model },
    workspace: { current_dir: fixture },
    context_window: { used_percentage: percent, context_window_size: 200000 },
    ...extra,
  });

  await post(claude, { hook_event_name: 'SessionStart', source: 'startup' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}]')?.dataset.state === 'idle'`, 'SessionStart made it idle');
  await post(claude, statusLine('Fable', 41.6));
  await waitRowContext(s, claude, 'Fable · 42%', 'the row shows the model and the rounded percent');
  expect((await paneContext(s, p1)) === 'Fable · 42%', `the pane title agrees, got ${await paneContext(s, p1)}`);
  expect((await rowState(s, claude)) === 'idle' && (await paneState(s, p1)) === 'idle', 'the state badge did not move');
  // M9 fix 44: the title carries the fill as a dial, at the right of the
  // title, which shows as the context sitting against the title buttons
  // with only the flex gap between (the title is about 290px here, so
  // "past the middle" would say nothing). Since M9 fix 53 the divider
  // stands between the two, so the distance is two gaps and the
  // divider's width. M9 fix 66: the dial is the second child of the
  // reading, right before the percent, and the row has the same dial.
  const dial = await s.evalJs(
    `(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-title'); const c = t.querySelector('.pane-context'); const d = c.querySelector('.context-dial'); const cr = c.getBoundingClientRect(); const ar = t.querySelector('.pane-title-actions').getBoundingClientRect(); const gap = parseFloat(getComputedStyle(t).columnGap); const divider = t.querySelector('.pane-title-divider')?.getBoundingClientRect().width ?? 0; const row = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}] .sidebar-row-context'); const rd = row?.querySelector('.context-dial') ?? null; return { pct: d?.style.getPropertyValue('--pct') ?? null, w: d?.getBoundingClientRect().width ?? 0, index: [...c.children].indexOf(d), last: c.lastElementChild.className, toButtons: ar.left - cr.right, gap, divider, rowPct: rd?.style.getPropertyValue('--pct') ?? null, rowW: rd?.getBoundingClientRect().width ?? 0, rowIndex: row === null || rd === null ? -1 : [...row.children].indexOf(rd), rowLast: row?.lastElementChild.className ?? null }; })()`,
  );
  expect(dial.pct === '42%' && dial.w === 11, `the pane title's context dial reads 42% at 11px, got ${JSON.stringify(dial)}`);
  expect(dial.divider > 0 && dial.toButtons >= 0 && dial.toButtons <= 2 * dial.gap + dial.divider + 1, `the context sits against the divider and the title buttons, got ${JSON.stringify(dial)}`);
  expect(dial.index === 1 && dial.last === 'pane-context-percent', `fix 66: the title's dial is the second child of the reading, right before the percent, got ${JSON.stringify(dial)}`);
  expect(dial.rowPct === '42%' && dial.rowW === 11 && dial.rowIndex === 1 && dial.rowLast === 'sidebar-row-context-percent', `fix 66: the row has the same dial before its percent, got ${JSON.stringify(dial)}`);
  await s.screenshot('m16-context-first.png');
  step('SessionStart then StatusLine: "Fable · 42%" on the row and the title, state still idle; fix 66: the dial right before the percent in both');

  // Claude works, then a later status line while working changes the
  // numbers and leaves working alone; a percent without a model keeps the
  // model; a status line for another Claude session is ignored.
  await post(claude, { hook_event_name: 'UserPromptSubmit', prompt: 'go' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}]')?.dataset.state === 'working'`, 'working');
  await post(claude, statusLine('Opus', 57.2));
  await waitRowContext(s, claude, 'Opus · 57%', 'a second status line changes the text');
  expect((await rowState(s, claude)) === 'working' && (await paneContext(s, p1)) === 'Opus · 57%', 'still working, title follows');
  await post(claude, { hook_event_name: 'StatusLine', context_window: { used_percentage: 60 } });
  await waitRowContext(s, claude, 'Opus · 60%', 'a percent alone keeps the model');
  await post(claude, statusLine('Sonnet', 3, { session_id: 'someone-else' }));
  await sleep(700);
  expect((await rowContext(s, claude)) === 'Opus · 60%', 'a status line from another session id is ignored');
  const info = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === claude);
  expect(info.model === 'Opus' && info.contextPercent === 60, 'the daemon holds the values');
  expect((await rowContext(s, plain)) === null && (await paneContext(s, p2)) === null, 'the plain shell still shows nothing');
  step('later status lines update the text without touching the state; the plain shell shows nothing');

  // M9 fix 800: the effort level after the model, inside the model span,
  // so a narrow row or a short title drops the two together; a percent
  // alone keeps it, the written log line keeps effort.level, and a line
  // with a model and no effort shows the model alone again, as the steps
  // after this one expect.
  await post(claude, statusLine('Opus', 61, { effort: { level: 'medium' } }));
  await waitRowContext(s, claude, 'Opus · medium · 61%', 'fix 800: the row reads the effort after the model');
  expect((await paneContext(s, p1)) === 'Opus · medium · 61%', `fix 800: the title reads the effort after the model, got ${JSON.stringify(await paneContext(s, p1))}`);
  {
    const spans = await s.evalJs(`[document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}] .sidebar-row-context-model')?.textContent ?? null, document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-context-model')?.textContent ?? null]`);
    expect(spans[0] === 'Opus · medium · ' && spans[1] === 'Opus · medium · ', `fix 800: the effort sits in the model span on the row and the title, got ${JSON.stringify(spans)}`);
  }
  await post(claude, { hook_event_name: 'StatusLine', context_window: { used_percentage: 62 } });
  await waitRowContext(s, claude, 'Opus · medium · 62%', 'fix 800: a percent alone keeps the effort');
  {
    const hooksLog = path.join(process.env['EMERALD_HOME'], 'logs', 'hooks.jsonl');
    const lastEffort = () => {
      const lines = (fs.existsSync(hooksLog) ? fs.readFileSync(hooksLog, 'utf8') : '').split('\n').filter((l) => l !== '');
      const mine = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((l) => l !== null && l.sessionId === claude && l.event === 'StatusLine' && l.payload?.model !== undefined);
      return mine.length === 0 ? undefined : (mine[mine.length - 1].payload?.effort?.level ?? null);
    };
    const until = Date.now() + 3000;
    while (Date.now() < until && lastEffort() !== 'medium') await sleep(100);
    expect(lastEffort() === 'medium', `fix 800: the last written status line with a model keeps effort.level medium, got ${JSON.stringify(lastEffort())}`);
  }
  await post(claude, statusLine('Opus', 60));
  await waitRowContext(s, claude, 'Opus · 60%', 'fix 800: a line with no effort shows the model alone');
  expect((await paneContext(s, p1)) === 'Opus · 60%', `fix 800: and the title, got ${JSON.stringify(await paneContext(s, p1))}`);
  {
    const back = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === claude);
    expect(back.effort === null, `fix 800: a model block without effort clears the record's effort, got ${JSON.stringify(back.effort)}`);
  }
  step('fix 800: a status line at medium reads Opus · medium · 61% on the row and the title, the effort inside the model span; a percent alone keeps it, the log line keeps effort.level, and a line with no effort shows the model alone');

  // Fix 28: the model loses its trailing parenthetical on the row and the
  // title (the tooltip keeps it), and the percent is never cut in a
  // sidebar too narrow for the whole second line: since fix 76 the line
  // gives in whole steps, the shown word first, then the words and the
  // percent together with the dial staying, then the branch name's
  // ellipsis. The width is calibrated from the line itself: room for the
  // branch and the dial and not for the words.
  await post(claude, statusLine('Opus 5 (1M context)', 5));
  await waitRowContext(s, claude, 'Opus 5 · 5%', 'the parenthetical is gone from the row');
  expect((await paneContext(s, p1)) === 'Opus 5 · 5%', `and from the title, got ${await paneContext(s, p1)}`);
  // Fix 67: the reading has no title tooltip; the card it opens keeps
  // the full name, and a click on the row's reading opens it without
  // showing the session (pane 2 stays focused).
  const noTitle = await s.evalJs(`[document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}] .sidebar-row-context').getAttribute('title'), document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-context').getAttribute('title')]`);
  expect(noTitle[0] === null && noTitle[1] === null, `neither reading has a title tooltip, got ${JSON.stringify(noTitle)}`);
  const rowCard = await openCard(s, `.sidebar-row[data-session-id=${JSON.stringify(claude)}] .sidebar-row-context`, claude, "the row's reading");
  expect(rowCard.heading === 'Opus 5 (1M context) · 200k' && rowCard.fill === '5% full, 0 of 200k tokens', `the card keeps the full name and the window, got ${JSON.stringify(rowCard)}`);
  expect(rowCard.inWindow && rowCard.position === 'fixed', `the card is a fixed box inside the window, got ${JSON.stringify({ inWindow: rowCard.inWindow, position: rowCard.position })}`);
  const stillPane2 = await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p2)}]').classList.contains('focused')`);
  expect(stillPane2, "the click on the row's reading did not show the session");
  await closeCard(s);
  const lineSel = `document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}] .sidebar-row-sub')`;
  const measure = () =>
    s.evalJs(`(() => {
      const line = ${lineSel};
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
      const box = line.getBoundingClientRect();
      const vis = (el) => el !== null && el.getClientRects().length > 0;
      const items = [...line.children].map((el) => ({ cls: el.className, width: el.getBoundingClientRect().width, right: el.getBoundingClientRect().right }));
      const name = line.querySelector('.sidebar-row-branch-name');
      const dial = line.querySelector('.context-dial');
      return { sidebarWidth: sidebar.width, lineLeft: box.left, lineRight: box.right, items, gap: parseFloat(getComputedStyle(line).gap),
        level: line.dataset.squeeze ?? null,
        shown: vis(line.querySelector('.sidebar-row-shown')),
        words: vis(line.querySelector('.sidebar-row-context-model')),
        percent: vis(line.querySelector('.sidebar-row-context-percent')),
        dialWidth: dial === null ? null : dial.getBoundingClientRect().width,
        dialInside: dial !== null && dial.getBoundingClientRect().right <= box.right + 0.5,
        branchClipped: name !== null && name.scrollWidth > name.clientWidth + 1,
        branchWidth: name === null ? null : name.getBoundingClientRect().width };
    })()`);
  const wide = await measure();
  const branch = wide.items.find((it) => it.cls.includes('sidebar-row-branch'));
  expect(branch !== undefined, 'the repo shell has a branch on its second line');
  expect(wide.level === '0' && wide.words && wide.percent, `at ${wide.sidebarWidth}px the line is whole, got ${JSON.stringify(wide)}`);
  // The sidebar is wider than the line by its paddings and the resizer.
  const chrome = wide.sidebarWidth - (wide.lineRight - wide.lineLeft);
  // Room for the branch, the dial and their gap, and a little more, but
  // not for the words and the percent: level 2, or 3 if the shown word
  // alone does not make the room.
  const target = Math.max(160, Math.round(chrome + branch.width + wide.gap + 11 + 16));
  const resizer = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.mouse('mousePressed', resizer.x, resizer.y);
  await s.mouse('mouseReleased', resizer.x + (target - wide.sidebarWidth), resizer.y);
  await s.waitFor(`Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - ${target}) <= 1`, `sidebar at ${target}px`);
  const narrow = await measure();
  expect(narrow.level === '2' || narrow.level === '3', `at ${target}px the line gave its words and its percent, got ${JSON.stringify(narrow)}`);
  expect(!narrow.shown && !narrow.words && !narrow.percent, `the shown word, the words and the percent are hidden whole, got ${JSON.stringify(narrow)}`);
  expect(narrow.dialWidth === 11 && narrow.dialInside, `the dial stays, 11px and inside the line (${JSON.stringify({ dialWidth: narrow.dialWidth, dialInside: narrow.dialInside, lineRight: narrow.lineRight })})`);
  // The fixture's branch is main (M9 fix 586), under the name's six-character
  // floor, so it is never clipped; it keeps its icon and its width.
  expect(!narrow.branchClipped && Math.abs(narrow.branchWidth - wide.branchWidth) < 1, `the branch name is whole, got ${JSON.stringify({ narrow: narrow.branchWidth, wide: wide.branchWidth, clipped: narrow.branchClipped })}`);
  expect((await rowContext(s, claude)) === 'Opus 5 · 5%', 'the text is whole');
  await s.screenshot('m16-context-narrow.png');
  await s.mouse('mousePressed', resizer.x + (target - wide.sidebarWidth), resizer.y);
  await s.mouse('mouseReleased', resizer.x, resizer.y);
  await s.waitFor(`Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - ${wide.sidebarWidth}) <= 1`, 'sidebar back');
  expect((await measure()).level === '0', 'the line is whole again at the default width');
  step(`fix 28 and 76: "Opus 5 (1M context)" reads "Opus 5 · 5%", and at ${target}px the line hides its words and its percent whole (level ${narrow.level}) with the dial inside and the branch untouched`);

  // A status line is not a sign of life: a working session with only
  // status lines for news goes stale exactly as one with none. The stale
  // check is on a daemon timer, so this is read from lastEventAt instead.
  const lastEventBefore = info.lastEventAt;
  await post(claude, statusLine('Opus', 61));
  await waitRowContext(s, claude, 'Opus · 61%', 'one more');
  const after = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === claude);
  expect(after.lastEventAt === lastEventBefore, `lastEventAt unchanged by a status line (${lastEventBefore} then ${after.lastEventAt})`);
  expect(after.stateSince === info.stateSince, 'stateSince steady');
  step('a status line does not count as a hook event for staleness');

  // The daemon dies; the app starts another, which lists the session as
  // exited with the last model and percent from sessions.json. The file is
  // written through fix 459's coalesce (Limits.saveCoalesceMs), and a /f
  // kill is TerminateProcess and flushes nothing, so the kill waits until
  // the file holds the 61 (M9 fix 735); a miss past eight windows is the
  // daemon never writing it, a finding rather than a flake.
  let lastSeen = null;
  const saved = () => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'sessions.json'), 'utf8')).sessions.find((x) => x.id === claude);
      lastSeen = entry === undefined ? null : { model: entry.model, contextPercent: entry.contextPercent };
      return entry?.model === 'Opus' && entry?.contextPercent === 61;
    } catch {
      return false; // mid-rename
    }
  };
  const savedBy = Date.now() + 2000;
  while (!saved() && Date.now() < savedBy) await sleep(50);
  expect(saved(), `sessions.json holds Opus at 61 before the kill (last read: ${JSON.stringify(lastSeen)})`);
  expect(processIdentity(firstDaemon.pid, firstDaemon.startedAt) === 'same', `the first daemon is still pid ${firstDaemon.pid} before its kill`);
  killFirstDaemon();
  await s.waitFor(`!!document.querySelector('.banner')`, 'disconnected');
  await s.waitFor(`!document.querySelector('.banner')`, 'reconnected after the daemon autostart', 20000);
  const secondDaemon = daemonPid();
  expect(secondDaemon !== firstDaemon.pid, `a new daemon, pid ${firstDaemon.pid} to ${secondDaemon}`);
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}]')?.dataset.state === 'exited'`, 'the session is listed as exited');
  await waitRowContext(s, claude, 'Opus · 61%', 'the row still says what it ran');
  expect((await paneContext(s, p1)) === 'Opus · 61%', 'and so does the title');
  expect((await rowContext(s, plain)) === null, 'the plain shell still nothing');
  await s.screenshot('m16-context-restart.png');
  step(`daemon restart: pid ${secondDaemon} brought the model and the percent back`);

  // M9 fix 39: a resume starts the values over, since they described the
  // process that is gone (a resumed shell comes up at a bare prompt; a
  // resumed Claude reports its own once its status line runs). The daemon
  // reports the level the app expects, so no banner.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-resume').click()`);
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}]')?.dataset.state === 'idle'`, 'resumed');
  await waitRowContext(s, claude, null, 'a resume clears the last values from the row');
  expect((await paneContext(s, p1)) === null, `and from the title, got ${await paneContext(s, p1)}`);
  const resumedInfo = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === claude);
  expect(resumedInfo.model === null && resumedInfo.contextPercent === null, 'the daemon holds neither');
  expect((await s.evalJs(`document.querySelector('.daemon-banner')`)) === null, 'no outdated-daemon banner at the current level');
  step('fix 39: a resume comes up with no model or percent; the daemon is at the level the app expects');

  // M9 fix 39: the resumed shell runs Claude again and shows its status
  // line; when Claude leaves (SessionEnd) the shell is a plain shell again
  // and the model and the percent go with the badge, on the row and on
  // the title, where before they outlived the Claude that reported them.
  await post(claude, { hook_event_name: 'SessionStart', source: 'startup' });
  await post(claude, statusLine('Opus', 6));
  await waitRowContext(s, claude, 'Opus · 6%', 'a new Claude in the resumed shell reports in');
  expect((await paneState(s, p1)) === 'idle', 'the badge is back with it');
  await post(claude, { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
  await waitRowContext(s, claude, null, 'SessionEnd on the shell takes the context text off the row');
  expect((await paneContext(s, p1)) === null, `and off the title, got ${await paneContext(s, p1)}`);
  expect((await rowState(s, claude)) === null && (await paneState(s, p1)) === null, 'a plain shell again, with no badge');
  const ended = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === claude);
  expect(ended.model === null && ended.contextPercent === null && ended.claudeSessionId === null, 'the daemon cleared both with the id');
  await s.screenshot('m16-context-ended.png');
  step('fix 39: SessionEnd on a shell clears the model and the percent with the badge');

  // M9 fix 50: an exited Claude title with a context reading in a 330px
  // pane (a half split of the default window) used to need about 373px,
  // and since only the cwd gave, the title's overflow clipped the hide
  // and close buttons off its right edge. Now the context's words give
  // first, then the state, then the name to its floor, and the buttons
  // never. The shell plays Claude once more and then exits by itself, so
  // the badge is the long form, exited (0), with the reading kept. Fix
  // 56: the parts give in that order rather than all at once, since the
  // weights sit an order of magnitude apart now, so at the narrow width
  // the state is whole unless the cwd has already gone, and the name is
  // cut only once the state has given.
  await post(claude, { hook_event_name: 'SessionStart', source: 'startup' });
  await post(claude, statusLine('Opus 5', 5));
  await waitRowContext(s, claude, 'Opus 5 · 5%', 'Claude reports in again');
  // The resume above typed `claude --resume sim-m16` into the shell (M48),
  // and the real Claude's picker comes up some seconds later with no
  // match for that id and would swallow the exit. The picker leaves on
  // Escape, not Ctrl+C (the batch 131 close-out found two Ctrl+Cs a
  // second apart leave it standing with `exit` typed into its search),
  // so wait for it on the pane's screen, then Escape it, then a pair of
  // quick Ctrl+Cs for a Claude that reached its prompt instead, and only
  // then type the exit into the shell.
  const input = (data) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(claude)}, data: ${JSON.stringify(data)} })`);
  const screen = () => s.evalJs(`(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host')?.emeraldTerm; if (!t) return ''; const b = t.buffer.active; const lines = []; for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? ''); return lines.join('\\n'); })()`);
  const pickerUp = async () => /Resume session|No sessions match/.test(await screen());
  for (let waited = 0; waited < 20000 && !(await pickerUp()); waited += 500) await sleep(500);
  if (await pickerUp()) {
    await input(String.fromCharCode(27));
    for (let waited = 0; waited < 10000 && (await pickerUp()); waited += 500) await sleep(500);
  }
  await input(String.fromCharCode(3));
  await sleep(300);
  await input(String.fromCharCode(3));
  await sleep(1200);
  await input('exit' + String.fromCharCode(13));
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}]')?.dataset.state === 'exited'`, 'the shell exited', 10000);
  expect((await paneState(s, p1)) === 'exited (0)', `the badge is exited (0), got ${JSON.stringify(await paneState(s, p1))}`);
  expect((await paneContext(s, p1)) === 'Opus 5 · 5%', 'the exited title keeps its reading');
  const rootSplit = layout.root;
  expect(rootSplit.kind === 'split' && rootSplit.first.kind === 'pane' && rootSplit.first.id === p1, 'pane 1 is the first leaf of the root split');
  const splitWidth = await s.evalJs(`document.querySelector('[data-split-id=${JSON.stringify(rootSplit.id)}]').getBoundingClientRect().width`);
  const paneWidth = () => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect().width`);
  const titleProbe = () =>
    s.evalJs(
      `(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-title'); const box = t.getBoundingClientRect(); const r = (el) => { const b = el.getBoundingClientRect(); return { left: Math.round(b.left - box.left), right: Math.round(b.right - box.left), width: Math.round(b.width) }; }; const name = t.querySelector('.pane-name'); const nameFloor = parseFloat(getComputedStyle(name).minWidth); const text = t.querySelector('.pane-context-model'); const state = t.querySelector('.pane-state'); const stateShown = getComputedStyle(state).display !== 'none'; const cwd = t.querySelector('.pane-cwd'); return { box: Math.round(box.width), name: { ...r(name), scroll: name.scrollWidth, client: name.clientWidth }, nameFloor, state: { ...r(state), scroll: state.scrollWidth, client: state.clientWidth, shown: stateShown }, cwd: cwd === null ? { width: 0, absent: true } : r(cwd), context: r(t.querySelector('.pane-context')), dial: r(t.querySelector('.context-dial')), text: { ...r(text), scroll: text.scrollWidth, client: text.clientWidth, shown: text.getClientRects().length > 0 }, resume: r(t.querySelector('.pane-resume')), buttons: [...t.querySelectorAll('.pane-title-actions button')].map(r) }; })()`,
    );
  // Seven buttons since M9 fix 689 (the face button first on a Claude
  // pane; six since M9 fix 181), held while any word or figure is on the
  // line (M9 fix 840): the face button gives at the eighth squeeze
  // level, hide and close at the ninth, the two splits at the tenth (M9
  // fix 860), after the state word and the name; the zoom and the shade
  // never. Whatever level the
  // title lands on, the buttons shown are that level's and every one
  // ends inside the box. With the seven held and Resume beside them an
  // exited title at 330px can be past its sixth level, where the name,
  // the dial and the words are gone, so the step walks pane 1 up in 30px
  // steps until the title reads below the sixth and makes the fix 50
  // reads there.
  const buttonsProbe = () =>
    s.evalJs(
      `(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-title'); const box = t.getBoundingClientRect(); const pct = t.querySelector('.pane-context-percent'); const ctx = t.querySelector('.pane-context'); const percent = pct === null ? null : (() => { const pr = pct.getBoundingClientRect(); const cr = ctx.getBoundingClientRect(); return { shown: getComputedStyle(pct).display !== 'none' && pr.width > 0, whole: pr.left >= cr.left - 0.5 && pr.right <= cr.right + 0.5 && pct.scrollWidth <= pct.clientWidth + 1, text: pct.textContent }; })(); return { level: Number(t.dataset.squeeze ?? 0), box: Math.round(box.width), percent, buttons: [...t.querySelectorAll('.pane-title-actions button')].map((b) => { const r = b.getBoundingClientRect(); return { cls: b.className, shown: getComputedStyle(b).display !== 'none', right: Math.round(r.right - box.left) }; }) }; })()`,
    );
  const expectedShown = (level) => ['pane-face-toggle', 'pane-split-right', 'pane-split-down', 'pane-zoom', 'pane-shade-toggle', 'pane-hide', 'pane-close'].filter((c) => !(level >= 8 && c === 'pane-face-toggle') && !(level >= 9 && (c === 'pane-hide' || c === 'pane-close')) && !(level >= 10 && c.startsWith('pane-split')));
  const buttonsAt = (read, where) => {
    const shown = read.buttons.filter((b) => b.shown).map((b) => b.cls.split(' ')[0]);
    expect(read.buttons.length === 7 && JSON.stringify(shown) === JSON.stringify(expectedShown(read.level)), `fix 208: the buttons shown ${where} are level ${read.level}'s, got ${JSON.stringify(read.buttons)}`);
    expect(shown.includes('pane-zoom') && shown.includes('pane-shade-toggle'), `fix 237: the zoom and the shade never give (level ${read.level} ${where}), got ${JSON.stringify(shown)}`);
    expect(read.buttons.filter((b) => b.shown).every((b) => b.right <= read.box), `the shown buttons end inside the ${read.box}px title ${where}, got ${JSON.stringify(read.buttons)}`);
    // M9 fix 222: the percent is whole inside the reading's box or absent, never sliced mid-glyph; from level 3 it is gone and the dial stands alone.
    expect(read.percent !== null && (read.percent.shown ? read.percent.whole && read.level < 3 : read.level >= 3), `fix 222: the percent is ${read.level >= 3 ? 'gone' : 'whole'} at level ${read.level} ${where}, got ${JSON.stringify(read.percent)}`);
    return shown;
  };
  let narrowButtons = null;
  let narrowWidth = 330;
  for (; narrowWidth <= 480; narrowWidth += 30) {
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: narrowWidth / splitWidth } } });
    await s.waitFor(`Math.abs(document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect().width - ${narrowWidth}) < 3`, `pane 1 at ${narrowWidth}px`);
    await sleep(300);
    narrowButtons = await buttonsProbe();
    console.log(`[840] exited title at ${narrowWidth}px: level ${narrowButtons.level}`);
    if (narrowButtons.level < 6) break;
  }
  expect(narrowButtons !== null && narrowButtons.level < 6, `fix 840: some width of 330 to 480px puts the exited title below its sixth level, got level ${narrowButtons?.level} at ${narrowWidth}px`);
  const narrowTitle = await titleProbe();
  const shownAt330 = buttonsAt(narrowButtons, `at ${narrowWidth}px`);
  const shownButtons = narrowTitle.buttons.filter((b) => b.width > 0);
  expect(narrowTitle.resume.right <= narrowTitle.box && narrowTitle.resume.left < shownButtons[0].left, `Resume is inside the title before the buttons, got ${JSON.stringify(narrowTitle.resume)}`);
  expect(narrowTitle.name.width >= narrowTitle.nameFloor - 0.5 && narrowTitle.nameFloor > 40, `the name keeps its floor, got ${JSON.stringify({ name: narrowTitle.name, floor: narrowTitle.nameFloor })}`);
  expect(narrowTitle.dial.width === 11 && narrowTitle.dial.right <= narrowTitle.box, `the dial stays whole, got ${JSON.stringify(narrowTitle.dial)}`);
  expect(!narrowTitle.text.shown || narrowTitle.text.scroll > narrowTitle.text.client + 1, `the context's words are what gave (cut, or gone whole from level 3, fix 859), got ${JSON.stringify(narrowTitle.text)}`);
  // Cut, or gone whole at fix 237's fifth level.
  const stateGave = narrowTitle.state.scroll > narrowTitle.state.client + 1 || !narrowTitle.state.shown;
  expect(!stateGave || narrowTitle.cwd.width === 0, `fix 56: the state gives only once the cwd is gone, got ${JSON.stringify({ state: narrowTitle.state, cwd: narrowTitle.cwd })}`);
  expect(narrowTitle.name.scroll <= narrowTitle.name.client + 1 || stateGave, `fix 56: the name is cut only after the state has given, got ${JSON.stringify({ name: narrowTitle.name, floor: narrowTitle.nameFloor, state: narrowTitle.state })}`);
  await s.screenshot('m16-context-narrowTitle-title.png');
  step(`fix 50: at ${Math.round(await paneWidth())}px the exited title keeps Resume and its buttons in the box (${JSON.stringify({ name: narrowTitle.name.width, state: narrowTitle.state.width, cwd: narrowTitle.cwd.width, context: narrowTitle.context.width })}); fix 208: level ${narrowButtons.level} shows ${shownAt330.length} of seven`);

  // M9 fix 208, moved by fix 840: narrower still, until the eighth level
  // (about 240px for an exited title with Resume), the chat button has
  // given and the splits, the zoom and the shade are still there (M9 fix
  // 860; fix 237 keeps the shade to the end; hide and close go at the
  // ninth and the splits at the tenth; verify:m9's fix 237 step walks
  // those); a click on the zoom from there
  // zooms the pane, which brings every button back, and a second click
  // unzooms.
  let narrowest = narrowButtons;
  for (const width of [280, 240, 200, 160]) {
    if (narrowest.level >= 8) break;
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: width / splitWidth } } });
    await s.waitFor(`Math.abs(document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect().width - ${width}) < 3`, `pane 1 at ${width}px`);
    await sleep(300);
    narrowest = await buttonsProbe();
    if (narrowest.level >= 8) break;
  }
  expect(narrowest.level >= 8, `fix 840: the title reaches its eighth level once narrow enough, got level ${narrowest.level} at ${narrowest.box}px`);
  const shownNarrowest = buttonsAt(narrowest, `at ${narrowest.box}px`);
  expect(!shownNarrowest.includes('pane-face-toggle') && shownNarrowest.includes('pane-split-right') && shownNarrowest.includes('pane-split-down') && shownNarrowest.includes('pane-zoom') && shownNarrowest.includes('pane-shade-toggle'), `fix 860: the chat button has given at ${narrowest.box}px, the splits, the zoom and the shade stayed, got ${JSON.stringify(shownNarrowest)}`);
  await s.screenshot('m16-context-fix208-narrowest.png');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-zoom').click()`);
  await s.waitFor(`!!document.querySelector('.splitview.zoomed')`, 'the zoom button zoomed pane 1 from the narrowest title');
  await sleep(300);
  const zoomedButtons = await buttonsProbe();
  expect(zoomedButtons.level === 0 && zoomedButtons.buttons.every((b) => b.shown), `fix 208: the zoomed pane's title has its seven buttons back, got level ${zoomedButtons.level} ${JSON.stringify(zoomedButtons.buttons)}`);
  expect((await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-zoom').hasAttribute('data-active')`)) === true, 'the zoom button is lit while zoomed');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-zoom').click()`);
  await s.waitFor(`!document.querySelector('.splitview.zoomed')`, 'the zoom button unzoomed');
  await sleep(300);
  const unzoomedButtons = await buttonsProbe();
  expect(unzoomedButtons.level === narrowest.level && unzoomedButtons.box === narrowest.box, `fix 208: unzoomed, the title is back at its level and width, got level ${unzoomedButtons.level} at ${unzoomedButtons.box}px`);
  step(`fix 840 and 860: at ${narrowest.box}px (level ${narrowest.level}, the eighth or past and short of the tenth) the chat button has given and the splits, the zoom and the shade stay (fix 237); the zoom from there gives the pane the tab with its seven buttons, and back`);

  // A wider pane (the default split is the 330px case itself, since the
  // sidebar and the rail leave the two panes about that) gives the words
  // back whole.
  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: 1 - 160 / splitWidth } } });
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect().width > 450`, 'pane 1 wide');
  await sleep(300);
  const wideTitle = await titleProbe();
  expect(wideTitle.text.scroll <= wideTitle.text.client + 1 && (await paneContext(s, p1)) === 'Opus 5 · 5%', `the words are whole at ${wideTitle.box}px, got ${JSON.stringify(wideTitle.text)}`);
  step(`fix 50: the context reads whole again at ${wideTitle.box}px`);

  // M9 fix 223: the picker's placeholder gives from the tail in steps by
  // the box's width, one of three forms shown whole (the shortest is the
  // floor, cut only when the box is narrower than it), never the long
  // string cut after its last hint; the long form is the input's title.
  // Ctrl+J on the wide pane 1 opens the picker overlay, whose box is
  // read at this width, at 420px and at 200px through the root ratio.
  const p1Box = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(p1Box.x, p1Box.y);
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').classList.contains('focused')`, 'pane 1 focused for the picker');
  await s.key('j', 'KeyJ', 74, CTRL);
  const pickerBox = `[data-pane-id=${JSON.stringify(p1)}] .picker-overlay .palette-box`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(pickerBox)}) && document.activeElement?.classList.contains('palette-input')`, 'Ctrl+J opened the picker with its box focused');
  const placeholderRead = () =>
    s.evalJs(
      `(() => { const box = document.querySelector(${JSON.stringify(pickerBox)}); if (!box) return null; const ph = box.querySelector('.palette-placeholder'); const input = box.querySelector('.palette-input'); const shown = [...ph.querySelectorAll('[data-form]')].filter((x) => getComputedStyle(x).display !== 'none'); const pr = ph.getBoundingClientRect(); return { width: Math.round(box.clientWidth), forms: shown.map((x) => x.dataset.form), text: shown.map((x) => x.textContent).join(''), textWidth: Math.round(shown[0]?.scrollWidth ?? 0), room: Math.round(ph.clientWidth - parseFloat(getComputedStyle(ph).paddingLeft) - parseFloat(getComputedStyle(ph).paddingRight)), fits: ph.scrollWidth <= ph.clientWidth + 1 && shown.every((x) => x.getBoundingClientRect().right <= pr.right + 0.5), title: input.title, native: input.placeholder, left: Math.round(shown[0]?.getBoundingClientRect().left - box.getBoundingClientRect().left) }; })()`,
    );
  const paneTo = async (px) => {
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: px / splitWidth } } });
    await s.waitFor(`Math.abs(document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect().width - ${px}) < 3`, `pane 1 at ${px}px`);
    await sleep(300);
  };
  const phWide = await placeholderRead();
  await paneTo(420);
  const phMid = await placeholderRead();
  await paneTo(200);
  const phNarrow = await placeholderRead();
  const LONG_PH = 'Type to filter: name, folder, branch, last prompt. Enter shows it here, Shift+Enter beside, Ctrl+Enter below. > for actions.';
  const order = ['long', 'mid', 'short'];
  for (const [where, r] of [['wide', phWide], ['at 420px', phMid], ['at 200px', phNarrow]]) {
    expect(r !== null && r.forms.length === 1 && order.includes(r.forms[0]) && r.text.length > 0, `fix 223: the ${where} picker shows one placeholder form, got ${JSON.stringify(r)}`);
    // Whole in its box, or the shortest form in a box narrower than itself.
    expect(r.fits || (r.forms[0] === 'short' && r.room < r.textWidth), `fix 223: the ${where} placeholder is whole in its ${r.width}px box, got ${JSON.stringify(r)}`);
    expect(r.title === LONG_PH && r.native === '' && r.left >= 8 && r.left <= 10, `fix 223: the input's title is the long form, no native placeholder, the text where a placeholder sits, got ${JSON.stringify({ title: r.title, native: r.native, left: r.left })}`);
  }
  expect(order.indexOf(phWide.forms[0]) <= order.indexOf(phMid.forms[0]) && order.indexOf(phMid.forms[0]) <= order.indexOf(phNarrow.forms[0]), `fix 223: the form never grows as the box narrows, got ${JSON.stringify([phWide.forms, phMid.forms, phNarrow.forms])}`);
  expect(phWide.forms[0] !== 'short' && phNarrow.forms[0] === 'short' && phNarrow.text === 'Type to filter · > for actions', `fix 223: the wide box shows a longer form than the shortest and 200px the shortest, got ${JSON.stringify([phWide.width, phWide.forms, phNarrow.forms])}`);
  await s.screenshot('m9-fix223-placeholder.png');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.picker-overlay')`, 'Escape closed the picker');
  await paneTo(Math.round(splitWidth - 160));
  step(`M9 fix 223: the picker's placeholder is ${phWide.forms[0]} at ${phWide.width}px, ${phMid.forms[0]} at ${phMid.width}px and ${phNarrow.forms[0]} at ${phNarrow.width}px, whole or the floor, the long form as the title`);

  // M42: a status line with the token counts puts contextWindow on the
  // session, the red band on the dial from the compaction point (33k
  // tokens under the window's size, 96.7% of 1M) and, since M9 fix 67,
  // the stacked bar in the context card a click on the title's reading
  // opens (the rail's footer is gone); a later status line that carries
  // only the percentage keeps the counts. M9 fix 53: the divider stands
  // between the reading and the buttons in pane 1's title and nowhere in
  // pane 2's.
  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, focusedPaneId: p1 } });
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').classList.contains('focused')`, 'pane 1 focused');
  expect(!(await s.evalJs(`!!document.querySelector('.files-rail .context-bar, .files-rail-footer')`)), 'fix 67: the rail has no footer bar');
  const titleReading = `[data-pane-id=${JSON.stringify(p1)}] .pane-context`;
  // The helper's own status lines carry a size (200k) and no counts, so
  // the card shows the window with nothing used and the buffer at 16.5%.
  const early = await openCard(s, titleReading, claude, "the title's reading");
  expect(early.heading === 'Opus 5 · 200k' && early.fill === '5% full, 0 of 200k tokens' && parseFloat(early.used.width) === 0 && early.buffer.width === '16.5%', `the 200k window the fake status lines carry, nothing used, got ${JSON.stringify(early)}`);
  const counts = { context_window_size: 1000000, total_input_tokens: 116045, used_percentage: 12, current_usage: { input_tokens: 2, output_tokens: 212, cache_creation_input_tokens: 299, cache_read_input_tokens: 115744 } };
  await post(claude, statusLine('Opus 5 (1M context)', 12, { context_window: counts }));
  // The card is live: it follows the session without being reopened.
  await s.waitFor(`document.querySelector('.context-popover[data-session-id=${JSON.stringify(claude)}] .context-popover-heading')?.textContent === 'Opus 5 (1M context) · 1M'`, 'the card took the new window size');
  const sessionsNow = (await zreq(s, 'session.list', {})).sessions;
  const known = sessionsNow.find((x) => x.id === claude);
  expect(JSON.stringify(known.contextWindow) === JSON.stringify({ size: 1000000, used: 116045, cacheRead: 115744, cacheWrite: 299, fresh: 2, output: 212 }), `contextWindow on the session, got ${JSON.stringify(known.contextWindow)}`);
  const bar = await cardProbe(s, claude);
  expect(bar.fill === '12% full, 116k of 1M tokens', `the fill line, got ${JSON.stringify(bar.fill)}`);
  expect(bar.used.width === '11.6%' && bar.used.left === 0, `used is 11.6% at the left, got ${JSON.stringify(bar.used)}`);
  expect(bar.buffer.width === '3.3%' && bar.buffer.right === 0, `the buffer is 3.3% pinned right, got ${JSON.stringify(bar.buffer)}`);
  expect(Math.abs(bar.used.px - bar.track * 0.116) < 1.5 && Math.abs(bar.buffer.px - bar.track * 0.033) < 1.5, `the segments measure their shares of the ${bar.track}px track, got ${JSON.stringify({ used: bar.used.px, buffer: bar.buffer.px })}`);
  expect(JSON.stringify(bar.legend) === JSON.stringify(['used 116k', 'free 851k', 'buffer 33k']), `the legend, got ${JSON.stringify(bar.legend)}`);
  expect(bar.compact === 'auto-compact at 96.7% (33k buffer)', `the compaction line, got ${JSON.stringify(bar.compact)}`);
  expect(bar.request === 'cache read 115.7k · cache write 299 · fresh 2 · out 212', `the last request's counts, got ${JSON.stringify(bar.request)}`);
  expect(bar.inWindow, 'the card sits inside the window');
  await s.screenshot('m16-context-card.png');
  await closeCard(s);
  // A press outside closes it too, and a press inside does not.
  await openCard(s, titleReading, claude, "the title's reading again");
  await s.evalJs(`document.querySelector('.context-popover').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
  await sleep(100);
  expect(await s.evalJs(`!!document.querySelector('.context-popover')`), 'a press inside the card leaves it open');
  await s.evalJs(`document.querySelector('.sidebar-header').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`);
  await s.waitFor(`!document.querySelector('.context-popover')`, 'a press outside closed the card');
  const dialProbe = (paneId) =>
    s.evalJs(
      `(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-title'); const d = t.querySelector('.context-dial'); const div = t.querySelector('.pane-title-divider'); const kids = [...t.children]; return { pct: d?.style.getPropertyValue('--pct') ?? null, compact: d?.style.getPropertyValue('--compact') ?? null, computed: d ? getComputedStyle(d).getPropertyValue('--compact').trim() : null, divider: div === null ? null : { text: div.textContent, after: kids.indexOf(div) === kids.indexOf(t.querySelector('.pane-context')) + 1, before: kids.indexOf(div) < kids.indexOf(t.querySelector('.pane-title-actions')) }, role: t.querySelector('.pane-context')?.getAttribute('role') ?? null, popoverFor: t.querySelector('.pane-context')?.dataset.popoverFor ?? null }; })()`,
    );
  const dial1 = await dialProbe(p1);
  expect(dial1.pct === '12%' && dial1.compact === '96.7%' && dial1.computed === '96.7%', `the dial carries the wedge and the band, got ${JSON.stringify(dial1)}`);
  expect(dial1.divider !== null && dial1.divider.text === '|' && dial1.divider.after && dial1.divider.before, `fix 53: the divider sits after the reading and before the buttons, got ${JSON.stringify(dial1.divider)}`);
  expect(dial1.role === 'button' && dial1.popoverFor === claude, `fix 67: the reading is a button for its session's card, got ${JSON.stringify({ role: dial1.role, popoverFor: dial1.popoverFor })}`);
  const dial2 = await dialProbe(p2);
  expect(dial2.pct === null && dial2.divider === null, `the plain shell's title has neither, got ${JSON.stringify(dial2)}`);
  step(`M42 and fix 67: counts on the session, the band at ${dial1.compact}, the card's bar ${JSON.stringify({ used: bar.used.width, buffer: bar.buffer.width, track: bar.track })} with the legend ${bar.legend.join(' · ')}, the compaction and request lines, closed by Escape and by a press outside; fix 53's divider in pane 1 only`);

  // The percentage alone (what an older wrapper would send) moves the
  // percent and keeps every count; a size alone, as the helper's own
  // payloads carry, moves the size and keeps the rest.
  await post(claude, statusLine('Opus 5 (1M context)', 13, { context_window: { used_percentage: 13 } }));
  await waitRowContext(s, claude, 'Opus 5 · 13%', 'the percent moved');
  const afterPercent = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === claude);
  expect(JSON.stringify(afterPercent.contextWindow) === JSON.stringify(known.contextWindow), `the counts are as they were, got ${JSON.stringify(afterPercent.contextWindow)}`);
  await post(claude, statusLine('Opus 5 (1M context)', 14));
  await waitRowContext(s, claude, 'Opus 5 · 14%', 'the percent moved again');
  const afterSize = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === claude);
  expect(afterSize.contextWindow.size === 200000 && afterSize.contextWindow.used === 116045, `a size alone moves the size and keeps the counts, got ${JSON.stringify(afterSize.contextWindow)}`);
  expect((await dialProbe(p1)).compact === '83.5%', 'the band follows the window size: 83.5% of 200k');
  step('M42: a status line without the counts keeps them');

  // M9 fix 246: Claude Code's own cost figure (fix 154) on the pane title
  // as the row has it (fix 221), a bare `$1.40` in --cost right after the
  // percent and before the tokens; the tokens give at the title's second
  // level and the dollars at the third, with the percent, so a narrowing
  // title shows the dollars alone for a while and then the dial alone.
  await post(claude, { ...statusLine('Opus 5 (1M context)', 14), cost: { total_cost_usd: 1.4029585 } });
  const costProbe = () =>
    s.evalJs(
      `(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-title'); const c = t.querySelector('.pane-context'); const kids = [...c.children].map((k) => k.className); const cost = c.querySelector('.pane-cost'); const tokens = c.querySelector('.pane-tokens'); const shown = (el) => el !== null && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; const root = getComputedStyle(document.documentElement).getPropertyValue('--cost').trim(); return { level: Number(t.dataset.squeeze ?? 0), width: Math.round(t.getBoundingClientRect().width), kids, cost: cost === null ? null : { text: cost.textContent, shown: shown(cost), color: getComputedStyle(cost).color }, costVar: root, tokens: tokens === null ? null : { text: tokens.textContent, shown: shown(tokens) }, row: document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(claude)}] .sidebar-row-cost')?.textContent ?? null }; })()`,
    );
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-cost')?.textContent === '$1.40'`, 'the title shows the cost');
  const costWide = await costProbe();
  // The exited title carries Resume, so even the wide pane (about 510px)
  // lands on level 2 with the tokens gone: the dollars are what it keeps.
  expect(costWide.cost.shown && costWide.level < 3 && costWide.tokens !== null && costWide.tokens.shown === (costWide.level < 2), `fix 246: the wide title shows the dollars, the tokens below level 2, got ${JSON.stringify(costWide)}`);
  expect(costWide.kids.indexOf('pane-cost') === costWide.kids.indexOf('pane-context-percent') + 1 && costWide.kids.indexOf('pane-tokens') === costWide.kids.indexOf('pane-cost') + 1, `fix 246: the dollars sit after the percent and before the tokens, got ${JSON.stringify(costWide.kids)}`);
  expect(costWide.row === '$1.40', `fix 246: the row reads the same figure, got ${JSON.stringify(costWide.row)}`);
  const hexToRgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  expect(costWide.cost.color === hexToRgb(costWide.costVar), `fix 246: the dollars wear --cost, got ${JSON.stringify({ color: costWide.cost.color, var: costWide.costVar })}`);
  expect((await paneContext(s, p1)) === 'Opus 5 · 14%', `fix 246: the reading's words are untouched, got ${await paneContext(s, p1)}`);
  // Narrower in steps: at every width the tokens show below the second
  // level and the dollars below the third, and the walk meets both a
  // title with the dollars alone and one with the dial alone.
  const costWalk = [{ width: costWide.width, level: costWide.level, cost: costWide.cost.shown, tokens: costWide.tokens?.shown ?? false }];
  for (const width of [480, 450, 420, 380, 340, 310, 280, 250, 220, 200, 180, 160]) {
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: width / splitWidth } } });
    await s.waitFor(`Math.abs(document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect().width - ${width}) < 3`, `pane 1 at ${width}px`);
    await sleep(250);
    const r = await costProbe();
    costWalk.push({ width: r.width, level: r.level, cost: r.cost?.shown ?? false, tokens: r.tokens?.shown ?? false });
    expect(r.tokens === null || r.tokens.shown === (r.level < 2), `fix 246: at ${r.width}px level ${r.level} the tokens are ${r.level < 2 ? 'shown' : 'gone'}, got ${JSON.stringify(r)}`);
    expect(r.cost !== null && r.cost.shown === (r.level < 3), `fix 246: at ${r.width}px level ${r.level} the dollars are ${r.level < 3 ? 'shown' : 'gone'}, got ${JSON.stringify(r)}`);
    if (r.level >= 3) break;
  }
  expect(costWalk.some((r) => r.cost && !r.tokens) && costWalk.some((r) => !r.cost), `fix 246: the walk saw the dollars alone and then the dial alone, got ${JSON.stringify(costWalk)}`);
  await s.screenshot('m16-context-fix246-cost.png');
  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: 1 - 160 / splitWidth } } });
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect().width > 450`, 'pane 1 wide again');
  await sleep(250);
  expect((await costProbe()).cost.shown, 'fix 246: the dollars are back on the wide title');
  step(`M9 fix 246: $1.40 on the title after the percent in --cost, the tokens gone from level 2 and the dollars from 3: ${costWalk.map((r) => `${r.width}px L${r.level}${r.cost ? ' $' : ''}${r.tokens ? ' tok' : ''}`).join(', ')}`);

  // M9 fix 795: fix 760's percent cut read on a live Claude title. Pane 1's
  // exited title above carries Resume and is at level 3 by 450px, so its
  // walk never meets level 2 at 340px, where the cut was seen. Pane 2's
  // shell is brought back if the daemon restart left it exited, made a
  // Claude title by a SessionStart and a status line under an id of its
  // own, and walked from wide to narrow; fix 246's walk is untouched.
  const plainRow = `document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(plain)}]')`;
  const p2Sel = (sel) => `document.querySelector('[data-pane-id=${JSON.stringify(p2)}] ${sel}')`;
  if ((await s.evalJs(`${plainRow}?.dataset.state ?? null`)) === 'exited') {
    await s.evalJs(`${p2Sel('.pane-resume')}.click()`);
    await s.waitFor(`${plainRow}?.dataset.state !== 'exited' && !${p2Sel('.pane-resume')}`, 'pane 2 resumed');
    // M9 fix 908: a resume sets shellCwd null and the first prompt sets it;
    // wait for that prompt so it cannot move the cwd back during the walk.
    for (const end = Date.now() + 15000; Date.now() < end && ((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === plain)?.shellCwd ?? null) === null; ) await sleep(200);
    expect(((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === plain)?.shellCwd ?? null) !== null, 'fix 908: the resumed shell reached its prompt before the walk names its folder');
  }
  await post(plain, { hook_event_name: 'SessionStart', source: 'startup', session_id: 'sim-m16-live' });
  await s.waitFor(`${plainRow}?.dataset.state === 'idle'`, 'pane 2 reports in as Claude');
  await post(plain, { ...statusLine('Opus 5 (1M context)', 14, { session_id: 'sim-m16-live' }), cost: { total_cost_usd: 1.4029585 } });
  await s.waitFor(`${p2Sel('.pane-context-percent')}?.textContent === '14%' && ${p2Sel('.pane-cost')}?.textContent === '$1.40'`, 'pane 2 shows 14% and $1.40');
  expect(!(await s.evalJs(`!!${p2Sel('.pane-resume')}`)), 'fix 795: the live title carries no Resume');
  // M9 fix 859: idle is narrower than the state word's 4ch floor and can
  // never cut, so the walk runs on working.
  // M9 fix 908: a Claude that cd'd into a subfolder of the folder it started
  // in, so the title carries a name and a folder that differ.
  const walkCwd = path.join(fixture, 'title-walk-name');
  fs.mkdirSync(walkCwd, { recursive: true });
  await post(plain, { hook_event_name: 'UserPromptSubmit', session_id: 'sim-m16-live', prompt: 'walk the title', cwd: walkCwd });
  await s.waitFor(`${p2Sel('.pane-state')}?.textContent === 'working'`, 'pane 2 is working');
  await s.waitFor(`${p2Sel('.pane-cwd')}?.textContent === ${JSON.stringify(walkCwd)} && ${p2Sel('.pane-name')}?.textContent === 'title-walk-name'`, 'fix 908: pane 2 names the subfolder and shows its path beside the name');
  const paneW = (id) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(id)}]').getBoundingClientRect().width`);
  const gutter = splitWidth - (await paneW(p1)) - (await paneW(p2));
  const cutRead = () =>
    s.evalJs(
      `(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .pane-title'); const ctx = t.querySelector('.pane-context'); const cr = ctx.getBoundingClientRect(); const at = (sel) => { const el = ctx.querySelector(sel); if (el === null || getComputedStyle(el).display === 'none') return 'hidden'; const e = el.getBoundingClientRect(); const mark = e.left >= cr.right - 0.5 ? ' OUT' : e.right > cr.right + 0.5 ? ' CUT' : ''; return Math.round(e.left) + '..' + Math.round(e.right) + mark; }; const tb = t.getBoundingClientRect(); const st = t.querySelector('.pane-state'); const state = st === null || getComputedStyle(st).display === 'none' ? 'hidden' : (() => { const twin = st.cloneNode(true); twin.style.cssText = 'position:absolute;visibility:hidden;flex:none;min-width:0;max-width:none;width:auto'; t.appendChild(twin); const over = twin.getBoundingClientRect().width - st.getBoundingClientRect().width; twin.remove(); return over > 1 ? 'cut ' + over.toFixed(2) : over > 0.02 ? 'whole, over ' + over.toFixed(2) : 'whole'; })(); const m = t.querySelector('.pane-context-model'); const model = m === null ? 'absent' : m.getClientRects().length === 0 ? 'hidden' : (() => { const e = m.getBoundingClientRect(); return e.width >= 18 && e.right <= cr.right + 0.5 ? 'shown' : 'SLIVER'; })(); const nm = t.querySelector('.pane-name'); const name = nm === null || nm.getClientRects().length === 0 ? 'hidden' : (() => { const twin = nm.cloneNode(true); twin.style.cssText = 'position:absolute;visibility:hidden;flex:none;min-width:0;max-width:none;width:auto'; t.appendChild(twin); const over = twin.getBoundingClientRect().width - nm.getBoundingClientRect().width; twin.remove(); return over > 0.02 ? 'cut ' + over.toFixed(2) : 'whole'; })(); const cw = t.querySelector('.pane-cwd'); const cwd = cw === null ? 'absent' : cw.getClientRects().length === 0 ? 'hidden' : 'shown ' + cw.getBoundingClientRect().width.toFixed(1); const buttons = [...t.querySelectorAll('.pane-title-actions button')].map((b) => { const e = b.getBoundingClientRect(); return { cls: b.className.split(' ')[0], shown: getComputedStyle(b).display !== 'none', inside: e.right <= tb.right + 0.5 && e.left >= tb.left - 0.5 }; }); return { width: Math.round(tb.width), level: Number(t.dataset.squeeze ?? 0), cut: 'box ' + Math.round(cr.left) + '..' + Math.round(cr.right) + ', percent ' + at('.pane-context-percent') + ', cost ' + at('.pane-cost'), state, model, name, cwd, over: t.scrollWidth - t.clientWidth, buttons }; })()`,
    );
  const walk795 = [];
  for (const width of [480, 450, 420, 380, 340, 310, 280, 250, 220, 200, 180, 160]) {
    // Pane 1 keeps at least 160px, the narrowest the walk above gave it.
    if (splitWidth - gutter - width < 160) continue;
    layout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: (splitWidth - gutter - width) / splitWidth } } });
    await s.waitFor(`Math.abs(document.querySelector('[data-pane-id=${JSON.stringify(p2)}]').getBoundingClientRect().width - ${width}) < 3`, `pane 2 at ${width}px`);
    await sleep(250);
    // The level follows the width through a state update, so a read right
    // after the width lands can still hold the last level; read until two
    // reads 300 ms apart agree (3 s at most).
    let r = await cutRead();
    for (let tries = 0; tries < 10; tries++) {
      await sleep(300);
      const again = await cutRead();
      const same = JSON.stringify(again) === JSON.stringify(r);
      r = again;
      if (same) break;
    }
    walk795.push(r);
    // M9 fix 859: a frame of the title at every width, the state word and
    // the buttons, for the install's look (859-title-<width>.png).
    const titleBox = await s.evalJs(`(() => { const b = document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .pane-title').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
    const titleShot = Buffer.from((await s.send('Page.captureScreenshot', { format: 'png', clip: { ...titleBox, scale: 2 }, fromSurface: true })).data, 'base64');
    try {
      fs.writeFileSync(path.join(shotsDir, `859-title-${r.width}.png`), titleShot);
    } catch {
      fs.writeFileSync(path.join(shotsDir, `859-title-${r.width}-${Date.now()}.png`), titleShot);
    }
    const shownButtons = r.buttons.filter((b) => b.shown);
    console.log(`[760] live ${r.width}px L${r.level}: ${r.cut}, state ${r.state}, model ${r.model}, buttons ${shownButtons.length}/${r.buttons.length}, name ${r.name}, cwd ${r.cwd}, over ${r.over}`);
    // M9 fix 840: no button gives while a word is on the line; the chat
    // button goes at the eighth level, hide and close at the ninth, the
    // splits at the tenth (M9 fix 860), the zoom and the shade never, and
    // every shown button ends inside the title.
    const wantShown = r.buttons.map((b) => b.cls).filter((c) => !(r.level >= 8 && c === 'pane-face-toggle') && !(r.level >= 9 && (c === 'pane-hide' || c === 'pane-close')) && !(r.level >= 10 && c.startsWith('pane-split')));
    expect(JSON.stringify(shownButtons.map((b) => b.cls)) === JSON.stringify(wantShown) && wantShown.includes('pane-zoom') && wantShown.includes('pane-shade-toggle') && shownButtons.every((b) => b.inside), `fix 840 and 860: at ${r.width}px level ${r.level} the buttons shown are the level's, the zoom and the shade among them, each inside the title, got ${JSON.stringify(r.buttons)}`);
    expect(!/(percent|cost) [^,]*(CUT|OUT)/.test(r.cut), `fix 817: at ${r.width}px level ${r.level} the percent and the cost are whole inside the reading's box or hidden, got ${r.cut}`);
    // M9 fix 859: the state word clips and is measured exactly, so it is
    // whole (a cut under a pixel shaves a side bearing, no letter) or gone;
    // the model's words are three characters or more until level 3, where
    // they go whole with the percent.
    expect(!r.state.startsWith('cut'), `fix 859: at ${r.width}px level ${r.level} the state word is whole or hidden, got ${r.state}`);
    expect(r.model === (r.level >= 3 ? 'hidden' : 'shown'), `fix 859: at ${r.width}px level ${r.level} the model's words are ${r.level >= 3 ? 'hidden' : 'shown, three characters or more'}, got ${r.model}`);
    // M9 fix 908: the name is whole while the rest of the line gives, the folder goes with the state word.
    expect(r.level >= 6 ? r.name === 'hidden' : r.level === 5 ? r.name !== 'hidden' : r.name === 'whole', `fix 908: at ${r.width}px level ${r.level} the name is ${r.level >= 6 ? 'hidden' : r.level === 5 ? 'shown, giving alone' : 'whole while the rest of the line gives'}, got ${r.name}`);
    expect(r.level < 5 || r.cwd === 'hidden', `fix 908: at ${r.width}px level ${r.level} the folder is gone with the state word, got ${r.cwd}`);
    expect(r.over <= 1, `fix 908: at ${r.width}px level ${r.level} the title does not overflow, so a rigid name stepped the level rather than pushing the buttons out, got ${r.over}`);
  }
  expect(walk795.some((r) => r.level <= 4 && r.cwd.startsWith('shown ') && Number(r.cwd.slice(6)) >= 1), `fix 908: the walk met the folder giving beside the whole name below the fifth level, got ${JSON.stringify(walk795.map((r) => [r.width, r.level, r.name, r.cwd]))}`);
  step(`M9 fix 795 and 817: fix 760's read on pane 2's live Claude title, no Resume, the percent and the cost whole or hidden and every button held to its level (fixes 840 and 860) at every width, the state word whole or hidden and the model's words shown or gone whole (fix 859), the name whole below the fifth level beside the folder giving and the folder gone with the state word (fix 908): ${walk795.map((r) => `${r.width}px L${r.level}`).join(', ')}`);
  await post(plain, { hook_event_name: 'Stop', session_id: 'sim-m16-live', stop_hook_active: false });
  await s.waitFor(`${p2Sel('.pane-state')}?.textContent !== 'working'`, 'pane 2 is back at rest');

  // M9 fix 772: the idle countdown. A real claude (it sits at the trust
  // dialog of the fresh fixture folder and makes no request) on pane 1,
  // bound to a conversation of the script's own by SessionStart, then
  // status lines with Claude Code's prompt_cache block. Every expiry is
  // set from the moment of its post, so the minute words hold for 60 s and
  // no read meets a minute boundary or the time of day.
  const live = (await zreq(s, 'session.spawn', { kind: 'claude', cwd: fixture, name: 'cache', cols: 80, rows: 24 })).session;
  const withSession772 = (node, paneId, sessionId) => (node.kind === 'pane' ? (node.id === paneId ? { ...node, sessionId } : node) : { ...node, first: withSession772(node.first, paneId, sessionId), second: withSession772(node.second, paneId, sessionId) });
  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, root: withSession772(layout.root, p1, live.id) } });
  const liveRow = `.sidebar-row[data-session-id=${JSON.stringify(live.id)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(p1)}] .pane-state`)})`, 'the live claude on pane 1');
  const postLive = (payload) => post(live.id, { session_id: 'sim-m16-772', ...payload });
  await postLive({ hook_event_name: 'SessionStart', source: 'startup' });
  await s.waitFor(`document.querySelector(${JSON.stringify(liveRow)})?.dataset.state === 'idle'`, 'SessionStart made the live claude idle');
  const exp = (secs) => Math.floor(Date.now() / 1000) + secs;
  const cacheLine = (tokens, cache) => statusLine('Opus 5 (1M context)', 25, { context_window: { used_percentage: 25, context_window_size: 1000000, total_input_tokens: tokens }, prompt_cache: cache });
  const clockRead = () =>
    s.evalJs(
      `(() => { const p = document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(p1)}] .pane-idle-clock`)}); const r = document.querySelector(${JSON.stringify(`${liveRow} .sidebar-row-clock`)}); const w = (sel) => Math.round(document.querySelector(${JSON.stringify(liveRow)} + ' ' + sel)?.getBoundingClientRect().width ?? -1); return { pane: p ? { text: p.textContent, kind: p.dataset.clock, title: p.title } : null, row: r ? { text: r.textContent, kind: r.dataset.clock, shown: getComputedStyle(r).display !== 'none', title: r.title } : null, state: document.querySelector(${JSON.stringify(liveRow)})?.dataset.state ?? null, age: (() => { const a = document.querySelector(${JSON.stringify(`${liveRow} .sidebar-row-age`)}); return a === null ? null : getComputedStyle(a).display !== 'none'; })(), widths: { line: w('.sidebar-row-main'), name: w('.sidebar-row-name'), badge: w('.sidebar-row-state'), clock: w('.sidebar-row-clock'), age: w('.sidebar-row-age') } }; })()`,
    );
  const waitClock = async (ok, what) => {
    const end = Date.now() + 5000;
    let r = null;
    while (Date.now() < end) {
      r = await clockRead();
      if (ok(r)) return r;
      await sleep(200);
    }
    expect(false, `${what}, got ${JSON.stringify(r)}`);
  };
  // The row says the title's words but for the kept kind's short form.
  const reads = (words, kind, rowWords = words) => (r) => r.pane?.text === words && r.pane.kind === kind && r.row?.text === rowWords && r.row.kind === kind && r.row.shown;
  const none = (r) => r.pane === null && r.row === null;
  // The row line's widths at each kind, for the record of what fits at the default width.
  const logWidths = (kind, r) => console.log(`[verify] fix 772 row widths, ${kind}: ${JSON.stringify(r.widths)}`);
  // (1) 250k tokens on the hour's cache: the compaction is due 6 minutes before the expiry.
  await postLive(cacheLine(250000, { warm: true, ttl: '1h', expires_at: exp(3000), requests: 4 }));
  const compact772 = await waitClock(reads('compacts in 44m', 'compact'), 'fix 772: 250k on the hour reads compacts in 44m on the title and the row');
  logWidths('compact', compact772);
  expect(compact772.pane.title.includes('"idleCompaction": false'), `fix 772: the title's tooltip names Claude Code's setting, got ${JSON.stringify(compact772.pane.title)}`);
  // The row's clock takes the age's place while it is drawn.
  expect(compact772.age === false, `fix 772: the row draws no age beside the clock, got ${JSON.stringify(compact772)}`);
  // (2) The control: under the floor no compaction is due.
  await postLive(cacheLine(100000, { warm: true, ttl: '1h', expires_at: exp(3000), requests: 5 }));
  logWidths('cold', await waitClock(reads('cache cold in 50m', 'cold'), 'fix 772: 100k reads cache cold in 50m'));
  // (3) The five-minute TTL never compacts.
  await postLive(cacheLine(250000, { warm: true, ttl: '5m', expires_at: exp(240), requests: 6 }));
  await waitClock(reads('cache cold in 4m', 'cold'), 'fix 772: the 5m TTL reads cache cold in 4m');
  // (4) The compaction's own start is a working event and clears the count.
  await postLive(cacheLine(250000, { warm: true, ttl: '1h', expires_at: exp(3000), requests: 7 }));
  await waitClock(reads('compacts in 44m', 'compact'), 'fix 772: back to compacts in 44m');
  await postLive({ hook_event_name: 'PreCompact', trigger: 'auto' });
  await waitClock((r) => r.state === 'working' && none(r) && r.age === true, 'fix 772: PreCompact puts the row at working with no count and its age back');
  // M9 fix 812: the compaction's SessionStart keeps it working, and its
  // PostCompact puts the row back at idle with its clock.
  await postLive({ hook_event_name: 'SessionStart', source: 'compact' });
  const restarted812 = await clockRead();
  expect(restarted812.state === 'working', `fix 812: the compaction's SessionStart keeps the row at working, got ${JSON.stringify(restarted812)}`);
  await postLive({ hook_event_name: 'PostCompact', trigger: 'auto' });
  await waitClock((r) => r.state === 'idle' && reads('compacts in 44m', 'compact')(r), 'fix 812: an idle compaction ending puts the row back at idle with its clock');
  // (5) A cold cache counts nothing, at done either.
  await postLive(cacheLine(250000, { warm: false, ttl: '1h', expires_at: null, requests: 8 }));
  await postLive({ hook_event_name: 'Stop', stop_hook_active: false });
  await waitClock((r) => (r.state === 'done' || r.state === 'idle') && none(r), 'fix 772: a cold cache at done reads no count');
  // A second later the focused pane may have acked done to idle; the count
  // stays off either way.
  await sleep(1000);
  const coldAgain = await clockRead();
  expect(none(coldAgain), `fix 772: still no count a second later, got ${JSON.stringify(coldAgain)}`);
  // (6) Past the expiry reads nothing.
  await postLive(cacheLine(250000, { warm: true, ttl: '1h', expires_at: exp(-5), requests: 9 }));
  await sleep(1000);
  const past = await clockRead();
  expect(none(past), `fix 772: a cache past its expiry reads no count, got ${JSON.stringify(past)}`);
  step("M9 fix 772: an idle Claude row and its pane title count down to the idle compaction at 250k tokens on the hour's cache (compacts in 44m), to the cache's expiry under 200k or on the 5m TTL (cache cold in 50m, 4m), and clear at PreCompact, on a cold cache and past the time, and come back when an idle compaction ends (fix 812)");

  // M9 fix 773: Keep whole while idle, on the same live claude, back at
  // idle with a warm hour's cache of 250k tokens. The row menu marks it,
  // the clocks say so, and the sink answers the mod's question as the mod
  // asks it.
  await zreq(s, 'session.ack', { sessionId: live.id });
  await s.waitFor(`document.querySelector(${JSON.stringify(liveRow)})?.dataset.state === 'idle'`, 'the live claude back at idle', 5000);
  await postLive(cacheLine(250000, { warm: true, ttl: '1h', expires_at: exp(3000), requests: 10 }));
  await waitClock(reads('compacts in 44m', 'compact'), 'fix 773: compacts in 44m before the mark');
  const keepLabel = 'Keep whole while idle';
  const keepItem = () =>
    s.evalJs(
      `(() => { const m = document.querySelector('.row-menu'); if (!m || m.dataset.sessionId !== ${JSON.stringify(live.id)}) return null; const b = [...m.querySelectorAll('.menu-item')].find((x) => (x.querySelector('.menu-label')?.textContent ?? '').endsWith(${JSON.stringify(keepLabel)})); return b ? { disabled: b.disabled, checked: b.dataset.checked ?? null } : 'missing'; })()`,
    );
  const openRowMenu = async () => {
    await s.evalJs(`document.querySelector(${JSON.stringify(`${liveRow} .sidebar-row-menu`)}).click()`);
    await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(live.id)}`, 'the live row menu', 5000);
  };
  const clickKeep = () => s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].find((x) => (x.querySelector('.menu-label')?.textContent ?? '').endsWith(${JSON.stringify(keepLabel)})).click()`);
  const keptOnRecord = async () => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === live.id)?.keepWhole === true;
  const waitKept = async (want) => {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if ((await keptOnRecord()) === want) return;
      await sleep(200);
    }
    expect(false, `fix 773: keepWhole ${want} on the record, got ${await keptOnRecord()}`);
  };
  const ask = async (trigger) => {
    const d = daemonInfo();
    const r = await fetch(`http://127.0.0.1:${d.hookPort}/compact`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': d.hookToken, 'X-Emerald-Session': live.id }, body: JSON.stringify({ trigger }) });
    expect(r.status === 200, `fix 773: the sink answered /compact with 200, got ${r.status}`);
    return (await r.json()).skip;
  };
  const SKIP = 'kept whole while idle by emerald';
  await openRowMenu();
  const offered = await keepItem();
  expect(offered !== null && offered !== 'missing' && offered.disabled === false && offered.checked === 'false', `fix 773: the row menu offers Keep whole while idle, unchecked, got ${JSON.stringify(offered)}`);
  await clickKeep();
  await waitKept(true);
  const kept773 = await waitClock(reads('kept whole · cache cold in 50m', 'kept', 'kept whole · 50m'), 'fix 773: a kept session reads kept whole · cache cold in 50m on the title and kept whole · 50m on the row');
  logWidths('kept', kept773);
  expect(kept773.row.title.startsWith('kept whole · cache cold in 50m. '), `fix 773: the row's tooltip carries the full words, got ${JSON.stringify(kept773.row.title)}`);
  expect((await ask('auto')) === SKIP, 'fix 773: an auto compaction at idle is skipped');
  expect((await ask('manual')) === null, 'fix 773: a manual compaction at idle goes on');
  await postLive({ hook_event_name: 'UserPromptSubmit', prompt: 'keep going' });
  await s.waitFor(`document.querySelector(${JSON.stringify(liveRow)})?.dataset.state === 'working'`, 'the live claude working', 5000);
  expect((await ask('auto')) === null, "fix 773: an auto compaction mid-turn (a full window's) goes on");
  await postLive({ hook_event_name: 'Stop', stop_hook_active: false });
  // The focused pane acks done to idle within a second; both are idle states.
  await s.waitFor(`['done', 'idle'].includes(document.querySelector(${JSON.stringify(liveRow)})?.dataset.state)`, 'the live claude done', 5000);
  expect((await ask('auto')) === SKIP, 'fix 773: an auto compaction at done is skipped');
  await openRowMenu();
  const checked = await keepItem();
  expect(checked !== null && checked !== 'missing' && checked.checked === 'true', `fix 773: the item reads checked once marked, got ${JSON.stringify(checked)}`);
  await clickKeep();
  await waitKept(false);
  expect((await ask('auto')) === null, 'fix 773: unmarked, an auto compaction goes on');
  // Unmarked at 250k on the hour the count is the compaction's again (the
  // plan's verify line said cache cold; fix 772's rule decides).
  await postLive(cacheLine(250000, { warm: true, ttl: '1h', expires_at: exp(3000), requests: 11 }));
  await waitClock(reads('compacts in 44m', 'compact'), 'fix 773: unmarked, the clocks count to the compaction again');
  step('M9 fix 773: Keep whole while idle on the row menu marks the session, the title reads kept whole · cache cold in 50m and the row kept whole · 50m with the full words in its tooltip, and the sink tells the mod to skip an auto compaction at idle and done, never a manual one or one mid-turn, and none once unmarked');

  // M9 fix 833: a shell names the emerald mod first in
  // CLAUDE_CODE_PLUGIN_DIRS, so a claude typed into it loads the mod, and
  // its row offers Keep whole while idle once a Claude reports in.
  {
    const { session: hosted } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: fixture, name: 'hosted', cols: 160, rows: 24 });
    const hostedRecord = async () => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === hosted.id);
    for (const end = Date.now() + 15000; Date.now() < end && ((await hostedRecord())?.shellCwd ?? null) === null; ) await sleep(200);
    expect(((await hostedRecord())?.shellCwd ?? null) !== null, 'fix 833: the hosted shell reached its prompt');
    await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(hosted.id)}, data: ${JSON.stringify('Write-Host ("plugin-dirs=" + $env:CLAUDE_CODE_PLUGIN_DIRS)\r')} })`);
    const dirsRow = /^plugin-dirs=[^;]*\\packages\\cli\\mod(;|$)/i;
    let rows833 = [];
    for (const end = Date.now() + 10000; Date.now() < end; await sleep(200)) {
      rows833 = (await zreq(s, 'pty.screen', { sessionId: hosted.id })).rows.map((r) => r.trim());
      if (rows833.some((r) => dirsRow.test(r))) break;
    }
    expect(rows833.some((r) => dirsRow.test(r)), `fix 833: the shell names the emerald mod first in CLAUDE_CODE_PLUGIN_DIRS, got ${JSON.stringify(rows833.filter((r) => r !== ''))}`);
    const hostedRow = `.sidebar-row[data-session-id=${JSON.stringify(hosted.id)}]`;
    const hostedItem = () =>
      s.evalJs(
        `(() => { const m = document.querySelector('.row-menu'); if (!m || m.dataset.sessionId !== ${JSON.stringify(hosted.id)}) return null; const b = [...m.querySelectorAll('.menu-item')].find((x) => (x.querySelector('.menu-label')?.textContent ?? '').endsWith(${JSON.stringify(keepLabel)})); return b ? { disabled: b.disabled, checked: b.dataset.checked ?? null, title: b.title } : 'missing'; })()`,
      );
    const openHostedMenu = async () => {
      await s.waitFor(`!!document.querySelector(${JSON.stringify(`${hostedRow} .sidebar-row-menu`)})`, 'fix 833: the hosted shell row', 5000);
      await s.evalJs(`document.querySelector(${JSON.stringify(`${hostedRow} .sidebar-row-menu`)}).click()`);
      await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(hosted.id)}`, 'fix 833: the hosted row menu', 5000);
    };
    const closeMenu = async () => {
      await s.key('Escape', 'Escape', 27);
      await s.waitFor(`!document.querySelector('.row-menu')`, 'fix 833: the row menu closed', 3000);
    };
    await openHostedMenu();
    const plain833 = await hostedItem();
    expect(plain833 !== null && plain833 !== 'missing' && plain833.disabled === true && plain833.title === 'Only a session with Claude running in it carries the mod that keeps it whole; start claude in this shell first', `fix 833: a plain shell's item is disabled with the reason, got ${JSON.stringify(plain833)}`);
    await closeMenu();
    await post(hosted.id, { session_id: 'sim-m16-833', hook_event_name: 'SessionStart', source: 'startup' });
    for (const end = Date.now() + 5000; Date.now() < end && (await hostedRecord())?.claudeSessionId !== 'sim-m16-833'; ) await sleep(200);
    expect((await hostedRecord())?.claudeSessionId === 'sim-m16-833', 'fix 833: the shell bound to its Claude');
    await openHostedMenu();
    const offered833 = await hostedItem();
    expect(offered833 !== null && offered833 !== 'missing' && offered833.disabled === false && offered833.checked === 'false', `fix 833: a shell with Claude running in it offers Keep whole while idle, unchecked, got ${JSON.stringify(offered833)}`);
    await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].find((x) => (x.querySelector('.menu-label')?.textContent ?? '').endsWith(${JSON.stringify(keepLabel)})).click()`);
    for (const end = Date.now() + 5000; Date.now() < end && (await hostedRecord())?.keepWhole !== true; ) await sleep(200);
    expect((await hostedRecord())?.keepWhole === true, 'fix 833: the hosted shell marked on the record');
    const d833 = daemonInfo();
    const asked833 = await fetch(`http://127.0.0.1:${d833.hookPort}/compact`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Emerald-Token': d833.hookToken, 'X-Emerald-Session': hosted.id }, body: JSON.stringify({ trigger: 'auto' }) });
    expect(asked833.status === 200, `fix 833: the sink answered /compact with 200, got ${asked833.status}`);
    const skip833 = (await asked833.json()).skip;
    expect(skip833 === SKIP, `fix 833: an auto compaction at idle of the hosted Claude is skipped, got ${JSON.stringify(skip833)}`);
    await post(hosted.id, { session_id: 'sim-m16-833', hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
    for (const end = Date.now() + 5000; Date.now() < end && (await hostedRecord())?.keepWhole !== false; ) await sleep(200);
    expect((await hostedRecord())?.keepWhole === false, `fix 833: the mark goes when the shell's Claude leaves, got ${(await hostedRecord())?.keepWhole}`);
    await zreq(s, 'session.kill', { sessionId: hosted.id, remove: true });
    await s.waitFor(`!document.querySelector(${JSON.stringify(hostedRow)})`, 'fix 833: the hosted shell row is gone', 8000);
  }
  step('M9 fix 833: a shell names the emerald mod in CLAUDE_CODE_PLUGIN_DIRS, its row offers Keep whole while idle once a Claude reports in, the mark skips an auto compaction at idle, and it goes when that Claude leaves');

  await zreq(s, 'session.kill', { sessionId: live.id, remove: true });
  await s.waitFor(`!document.querySelector(${JSON.stringify(liveRow)})`, 'the live claude row is gone', 8000);

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m16-context-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  killFirstDaemon();
  // A shell not yet gone may still hold the folder; one left under
  // emerald-verify is harmless.
  setTimeout(() => {
    try { fs.rmSync(fixtureParent, { recursive: true, force: true }); } catch {}
    process.exit(process.exitCode ?? 0);
  }, 500);
}
