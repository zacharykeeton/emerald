// M4 acceptance: the sidebar tells the truth and drives the panes. Three
// sessions in two panes (shells A and B in the home directory, then a
// claude --version over pane 2 which exits by itself); simulated hook POSTs
// to the sink move the badges and, since M32, leave the rows where they
// were made (the by-state order is verify:m9's); the time in state ticks;
// clicking rows swaps sessions into the focused pane or jumps to the pane
// already showing one; a done session acks when its row is clicked and its
// row shares the pane title's colour until then; rename and kill work from
// the menu; Ctrl+Shift+B hides the sidebar and the choice persists. The
// kind label follows a posted SessionStart and SessionEnd (M23); the
// Colour row of the row menu and the pane menu sets the colour (M29); the
// filter chips show every row, the ones that need you or the done ones,
// and the choice persists (M44). A folder heading draws the project's
// favicon in the icon slot when the folder has one (M9 fix 65).
// Starts from an empty layout, so run it when no Emerald app is open.
// Run: npm run verify:sidebar -w @emerald/app
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CTRL, SHIFT, expect, freshPort, getLayout, getTabs, killTree, launch, leaves, repoRoot, sleep, startSession, startSessionByKey, step, stopDaemon, emeraldHome, zreq } from './cdp.mjs';

setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 120 s');
  process.exit(3);
}, 120000);

// M9 fix 196: the daemon's limit for a shell command whose end marks the
// row, short enough that a two-second sleep is a long command.
process.env['EMERALD_SHELL_DONE_AFTER_MS'] = '2000';

const row = (id) => `document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]')`;
const rowState = (s, id) => s.evalJs(`${row(id)}?.dataset.state ?? null`);
const rowBadge = (s, id) => s.evalJs(`${row(id)}?.querySelector('.sidebar-row-state')?.textContent ?? null`);
const rowAge = (s, id) => s.evalJs(`${row(id)}?.querySelector('.sidebar-row-age')?.textContent ?? null`);
const rowOrder = (s) => s.evalJs(`[...document.querySelectorAll('.sidebar-row')].map(r => r.dataset.sessionId)`);
const groupOrder = (s) => s.evalJs(`[...document.querySelectorAll('.sidebar-group')].map(g => g.dataset.group)`);
const waitRowState = async (s, id, state, what) => {
  const t0 = Date.now();
  await s.waitFor(`${row(id)}?.dataset.state === ${JSON.stringify(state)}`, what, 4000);
  return Date.now() - t0;
};
// The row is scrolled into the list first (M9 fix 249): a row on no pane
// carries a sub line now, so a long list runs past the fold.
const clickRow = async (s, id) => {
  const c = await s.evalJs(`(() => { const el = ${row(id)}; el.scrollIntoView({ block: 'nearest' }); const r = el.querySelector('.sidebar-row-name').getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; })()`);
  await s.click(c.x, c.y);
};
const menuFor = async (s, id, item) => {
  await s.evalJs(`${row(id)}.querySelector('.sidebar-row-menu').click()`);
  await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(id)}`, `menu for ${id.slice(0, 8)}`);
  await s.evalJs(`[...document.querySelectorAll('.row-menu button')].find(b => b.textContent === ${JSON.stringify(item)}).click()`);
};
const colorOf = (s, selector) => s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).color`);
// M9 fix 249: the live sessions on no pane of any tab, off the daemon's
// own layout and list, which is what the Unshown chip and the headings'
// "N on no pane" count should read.
const unshownIds = async (s) => {
  const all = await getTabs(s);
  const onPanes = new Set();
  const walk = (n) => (n.kind === 'pane' ? n.sessionId !== null && onPanes.add(n.sessionId) : (walk(n.first), walk(n.second)));
  for (const tab of all.tabs) walk(tab.root);
  return (await zreq(s, 'session.list', {})).sessions.filter((x) => x.state !== 'exited' && !onPanes.has(x.id)).map((x) => ({ id: x.id, home: (x.groupCwd ?? '').toLowerCase() === home.toLowerCase() }));
};

const home = os.homedir();
// A project folder for the favicon step: a fresh seed per run with the
// icon under public, resolved to the long form the shell reports.
const seedShort = path.join(os.tmpdir(), 'emerald-verify', `m4-icon-${process.pid}`);
fs.rmSync(seedShort, { recursive: true, force: true });
fs.mkdirSync(path.join(seedShort, 'public'), { recursive: true });
fs.writeFileSync(path.join(seedShort, 'public', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e8a33d"/></svg>');
const seed = fs.realpathSync.native(seedShort);
// The seed is a repository with one clean commit (M9 fix 200), so its
// heading can show the changes mark when a file is written and lose it
// when the file is committed.
const git = (...args) => execFileSync('git', args, { cwd: seed, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
git('init', '-q');
git('config', 'user.name', 'verify');
git('config', 'user.email', 'verify@example.invalid');
git('config', 'commit.gpgsign', 'false');
git('add', '.');
git('commit', '-q', '-m', 'seed');
const s = await launch(freshPort(), { freshState: true });
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  expect((await s.evalJs(`document.querySelector('.sidebar-empty')?.textContent`)) === 'No sessions yet', 'sidebar starts empty');
  // M9 fix 172: the empty list offers the empty pane's two starts under
  // its text, stacked, the key beside the shell's button.
  const emptyStarts = await s.evalJs(`(() => { const a = document.querySelector('.sidebar-empty-actions'); if (!a) return null; const n = a.querySelector('.empty-new'); const c = a.querySelector('.empty-claude'); const t = document.querySelector('.sidebar-empty').getBoundingClientRect(); return { newText: n?.textContent, key: n?.nextElementSibling?.textContent, claudeText: c?.textContent, underText: n.getBoundingClientRect().top >= t.bottom, stacked: c.getBoundingClientRect().top >= n.getBoundingClientRect().bottom, inside: a.getBoundingClientRect().right <= document.querySelector('.sidebar').getBoundingClientRect().right }; })()`);
  expect(emptyStarts !== null && emptyStarts.newText === 'New shell' && emptyStarts.key === 'Ctrl+Shift+N' && emptyStarts.claudeText === 'Claude session' && emptyStarts.underText && emptyStarts.stacked && emptyStarts.inside, `the empty sidebar offers New shell (Ctrl+Shift+N) over Claude session under its text, got ${JSON.stringify(emptyStarts)}`);
  step('the empty sidebar offers New shell and Claude session under No sessions yet (M9 fix 172)');
  await startSession(s, { kind: 'shell', cwd: home });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell A');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes');
  await startSession(s, { kind: 'shell', cwd: home });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'shell B');
  await sleep(300);
  let layout = await getLayout(s);
  const [p1, p2] = leaves(layout);
  const A = p1.sessionId;
  const B = p2.sessionId;
  expect(layout.focusedPaneId === p2.id, 'pane 2 focused');
  // Claude over pane 2: B stays live but leaves the screen. --version makes
  // it exit on its own, which also proves the args reached the launcher.
  await startSessionByKey(s, { kind: 'claude', cwd: repoRoot, args: '--version' });
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 3`, 'three rows');
  layout = await getLayout(s);
  const C = leaves(layout)[1].sessionId;
  expect(C !== B && leaves(layout)[0].sessionId === A, 'claude replaced B in pane 2');
  await waitRowState(s, C, 'exited', 'claude --version exited');
  const out = Buffer.from((await zreq(s, 'session.read', { sessionId: C })).data, 'base64').toString();
  expect(/\d+\.\d+\.\d+/.test(out), 'claude printed its version');
  step(`A=${A.slice(0, 8)} in pane 1, C=${C.slice(0, 8)} (claude, exited) in pane 2, B=${B.slice(0, 8)} unshown`);
  expect(JSON.stringify(await groupOrder(s)) === JSON.stringify([home, 'exited']), 'home group then exited, got ' + JSON.stringify(await groupOrder(s)));

  const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
  const post = async (sessionId, payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ session_id: 'sim-' + sessionId.slice(0, 8), cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204, got ${res.status}`);
  };

  // M23, M46: the mark says what is running. A shell's row starts with
  // the shell mark; once a SessionStart binds a Claude session id it is
  // the asterisk, and after the SessionEnd the shell mark again with the
  // id dropped, so the next claude typed into the same shell binds afresh.
  const rowKind = (id) => s.evalJs(`(() => { const r = ${row(id)}?.querySelector('.sidebar-row-main'); if (!r) return null; return r.querySelector('.session-mark') ? 'claude' : r.querySelector('.shell-mark') ? 'shell' : null; })()`);
  const bound = async (id) => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id).claudeSessionId;
  expect((await rowKind(A)) === 'shell' && (await rowKind(C)) === 'claude', 'a shell row starts with the shell mark, a Claude row with the asterisk');
  await post(A, { hook_event_name: 'SessionStart', source: 'startup' });
  await s.waitFor(`!!${row(A)}?.querySelector('.sidebar-row-main .session-mark')`, 'A shows the asterisk after SessionStart');
  expect((await bound(A)) === 'sim-' + A.slice(0, 8), 'SessionStart bound the Claude session id');
  await post(A, { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
  await s.waitFor(`!!${row(A)}?.querySelector('.sidebar-row-main .shell-mark')`, 'A shows the shell mark again after SessionEnd');
  expect((await bound(A)) === null, 'SessionEnd dropped the Claude session id from the shell');
  step('the mark: the shell prompt, the asterisk after SessionStart, the prompt after SessionEnd');

  // Badges follow the hooks and the rows stay put (M32): A was made
  // before B, so A stays above B whatever B needs.
  expect((await s.evalJs(`document.querySelector('.sidebar-header')?.dataset.order`)) === 'created', 'the default order is as created');
  await post(A, { hook_event_name: 'UserPromptSubmit' });
  step(`A working in the sidebar ${await waitRowState(s, A, 'working', 'A working')} ms after the POST`);
  expect(JSON.stringify(await rowOrder(s)) === JSON.stringify([A, B, C]), 'working A above idle B');
  await post(B, { hook_event_name: 'UserPromptSubmit' });
  await post(B, { hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  await waitRowState(s, B, 'needs-input', 'B needs input');
  expect((await rowBadge(s, B)) === 'needs input: permission', 'badge text from describeState');
  expect(JSON.stringify(await rowOrder(s)) === JSON.stringify([A, B, C]), 'needs-input B stays under working A');
  step('rows stayed where they were made: working, needs-input, exited');

  // Time in state ticks on its own. The shown value is floor of the last
  // one-second tick, so over 2.1 s it advances by one or two.
  const age0 = await rowAge(s, B);
  await sleep(2100);
  const age1 = await rowAge(s, B);
  expect(/^\d+s$/.test(age0) && /^\d+s$/.test(age1) && parseInt(age1) >= parseInt(age0) + 1, `age ticked from ${age0} to ${age1}`);
  step(`time in state ticked ${age0} -> ${age1}`);

  // A finishes while pane 2 is focused: done sticks, and the row and the
  // pane title are the same colour.
  await post(A, { hook_event_name: 'Stop' });
  await waitRowState(s, A, 'done', 'A done');
  await sleep(600);
  expect((await rowState(s, A)) === 'done', 'done sticks while pane 1 is not focused');
  const rowColor = await colorOf(s, `.sidebar-row[data-session-id="${A}"] .sidebar-row-state`);
  const titleColor = await colorOf(s, `[data-pane-id="${p1.id}"] .pane-state`);
  expect(rowColor === titleColor, `row and title colour match: ${rowColor} vs ${titleColor}`);
  step(`done row and pane title both ${rowColor}`);
  await s.screenshot('m4-sidebar-done.png');

  // Clicking the row of a shown session focuses its pane, and acks it.
  await clickRow(s, A);
  await s.waitFor(`document.querySelector('.pane.focused')?.dataset.paneId === ${JSON.stringify(p1.id)}`, 'pane 1 focused by row click');
  step(`row click acked A: idle ${await waitRowState(s, A, 'idle', 'A idle after ack')} ms after the click`);
  layout = await getLayout(s);
  expect(leaves(layout)[0].sessionId === A && leaves(layout)[1].sessionId === C, 'no swap for a shown session');

  // B answers its prompt and finishes unshown; clicking its row asks
  // first, since A is alive in the focused pane (M9 fix 91), and Show
  // here puts it in that pane and acks it there.
  await post(B, { hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  await post(B, { hook_event_name: 'Stop' });
  await waitRowState(s, B, 'done', 'B done');
  await clickRow(s, B);
  await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(B)}`, 'the chooser under the row of B');
  await s.evalJs(`[...document.querySelectorAll('.show-chooser .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Show here').click()`);
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p1.id)}] .pane-name')?.textContent === ${JSON.stringify(path.basename(home))} && (${row(B)}?.dataset.state === 'idle')`, 'B shown in pane 1 and acked');
  layout = await getLayout(s);
  expect(leaves(layout)[0].sessionId === B && layout.focusedPaneId === p1.id, 'B replaced A in the focused pane');
  expect((await s.evalJs(`document.activeElement?.className ?? ''`)).includes('xterm'), 'keyboard focus is in the terminal');
  step('unshown B swapped into the focused pane and acked');
  expect((await rowState(s, A)) === 'idle', 'A still listed while unshown');

  // Rename and kill from the menu.
  await menuFor(s, A, 'Rename');
  await s.waitFor(`document.activeElement?.className === 'sidebar-rename'`, 'rename box');
  expect((await s.evalJs('document.activeElement.maxLength')) === 200, 'the rename box stops at Limits.nameMaxChars');
  await s.type('project-a');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`${row(A)}?.querySelector('.sidebar-row-name')?.textContent === 'project-a'`, 'row renamed');
  expect((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === A).name === 'project-a', 'daemon has the new name');

  // M18: the checkpoint. Written over the pipe as emmer set does, it shows
  // on the row's third line with the phase beside the kind; written from
  // the menu it lands in the daemon; cleared from the menu it goes again.
  const rowComment = (id) => s.evalJs(`${row(id)}?.querySelector('.sidebar-row-comment-text')?.textContent ?? null`);
  const rowPhase = (id) => s.evalJs(`${row(id)}?.querySelector('.sidebar-row-phase')?.textContent ?? null`);
  await zreq(s, 'session.set', { sessionId: B, comment: 'reproduced the bug; testing a fix', phase: 'in-review' });
  await s.waitFor(`${row(B)}?.querySelector('.sidebar-row-comment-text')?.textContent === 'reproduced the bug; testing a fix'`, 'B shows the comment');
  expect((await rowPhase(B)) === 'in-review', 'B shows the phase beside the kind');
  expect((await s.evalJs(`${row(B)}?.querySelector('.sidebar-row-turn') === null`)) === true, 'the comment stands in for the last turn line');
  await menuFor(s, A, 'Set comment');
  await s.waitFor(`document.activeElement?.className === 'sidebar-rename'`, 'comment box');
  expect((await s.evalJs('document.activeElement.maxLength')) === 2000, 'the comment box stops at Limits.commentMaxChars');
  await s.type('fix is in, running the suite');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`${row(A)}?.querySelector('.sidebar-row-comment-text')?.textContent === 'fix is in, running the suite'`, 'A shows the typed comment');
  expect((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === A).comment === 'fix is in, running the suite', 'daemon has the comment');
  expect((await rowPhase(A)) === null, 'a comment alone sets no phase');
  await menuFor(s, B, 'Set comment');
  await s.waitFor(`document.activeElement?.className === 'sidebar-rename' && document.activeElement.value === 'reproduced the bug; testing a fix'`, 'comment box holds the current comment');
  await s.key('Backspace', 'Backspace', 8);
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`${row(B)}?.querySelector('.sidebar-row-comment') === null`, 'B comment cleared from the menu');
  expect((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === B).comment === null, 'daemon cleared the comment');
  expect((await rowPhase(B)) === 'in-review', 'clearing the comment leaves the phase');
  expect((await rowComment(A)) === 'fix is in, running the suite', 'A keeps its own comment');
  step('checkpoint: set over the pipe and from the menu, cleared from the menu');

  // M29: the colour, from the row menu's Colour row and the pane menu's.
  // Twelve swatches (M59; M68's twenty-four went back to twelve in M9
  // fix 133) in one row, the session's own marked; a click on another puts the
  // new hex on the row, on the title of the pane showing it and in the
  // daemon, and the pane menu puts the first one back.
  const rowHex = (id) => s.evalJs(`${row(id)}?.dataset.color ?? null`);
  const titleHex = (paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-title')?.dataset.color ?? null`);
  const swatches = (menu) => s.evalJs(`[...document.querySelectorAll('.${menu} .menu-swatch')].map(b => ({ color: b.dataset.color, active: b.dataset.active === 'true', top: b.offsetTop }))`);
  const pickSwatch = (menu, color) => s.evalJs(`document.querySelector('.${menu} .menu-swatch[data-color=${JSON.stringify(color)}]').click()`);
  const before = await rowHex(B);
  expect(/^#[0-9a-f]{6}$/.test(before ?? ''), 'B has a colour');
  layout = await getLayout(s);
  const paneB = leaves(layout).find((leaf) => leaf.sessionId === B)?.id;
  expect(paneB !== undefined, 'a pane shows B');
  expect((await titleHex(paneB)) === before, 'the pane showing B carries the same colour');
  await s.evalJs(`${row(B)}.querySelector('.sidebar-row-menu').click()`);
  await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(B)}`, 'row menu for B');
  let list = await swatches('row-menu');
  expect(list.length === 12, `the Colour row has twelve swatches, got ${list.length}`);
  expect(new Set(list.map((x) => x.top)).size === 1, `the swatches sit in one row, got tops ${JSON.stringify(list.map((x) => x.top))}`);
  expect(list.filter((x) => x.active).length === 1 && list.find((x) => x.active).color === before, `the current colour is marked, got ${JSON.stringify(list)}`);
  // A's colour is random, so the pick avoids it too, else the check that
  // A is untouched cannot tell a leak from a coincidence.
  const aHex = await rowHex(A);
  const next = list.find((x) => x.color !== before && x.color !== aHex).color;
  await pickSwatch('row-menu', next);
  await s.waitFor(`!document.querySelector('.row-menu')`, 'row menu closed on the pick');
  await s.waitFor(`${row(B)}?.dataset.color === ${JSON.stringify(next)}`, 'the row took the new colour');
  expect((await titleHex(paneB)) === next, 'the pane title took it too');
  expect((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === B).color === next, 'the daemon has the new colour');
  expect((await rowHex(A)) !== next, 'A is untouched');
  const titleBox = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneB)}] .pane-title').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(titleBox.x, titleBox.y);
  await s.waitFor(`document.querySelector('.pane-menu')?.dataset.paneId === ${JSON.stringify(paneB)}`, 'pane menu for the pane showing B');
  list = await swatches('pane-menu');
  expect(list.length === 12 && list.find((x) => x.active)?.color === next, 'the pane menu marks the colour just set');
  await pickSwatch('pane-menu', before);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'pane menu closed on the pick');
  await s.waitFor(`${row(B)}?.dataset.color === ${JSON.stringify(before)}`, 'the row went back to the first colour');
  expect((await titleHex(paneB)) === before, 'and so did the pane title');
  step(`colour: ${before} to ${next} from the row menu, back from the pane menu`);

  // M9 fix 157: a swatch under the pointer previews its colour on the
  // row and on the pane title, with the daemon and the mark untouched;
  // leaving the row puts the saved colour back, and so does Escape with
  // the pointer still on a swatch; a click holds the preview through the
  // menu's close until the daemon's push lands.
  const centreOf = (sel) => s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  // Two moves, the first to a corner: the pointer sits where the last
  // click left it, and a move that lands on the swatch straight from
  // there was not always seen as entering it.
  const moveTo = async (sel) => {
    const c = await centreOf(sel);
    expect(c !== null, `something to hover at ${sel}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  };
  const hovered = () => s.evalJs(`[...document.querySelectorAll(':hover')].map((e) => e.className).slice(-3).join(' > ')`);
  const daemonHex = async (id) => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id).color;
  await s.evalJs(`${row(B)}.querySelector('.sidebar-row-menu').click()`);
  await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(B)}`, 'row menu for B again');
  list = await swatches('row-menu');
  const probe = list.find((x) => x.color !== before && x.color !== aHex && x.color !== next).color;
  const probeSel = `.row-menu .menu-swatch[data-color="${probe}"]`;
  await moveTo(probeSel);
  await s.waitFor(`${row(B)}?.dataset.color === ${JSON.stringify(probe)}`, `the row previews the swatch under the pointer (hovering ${await hovered()})`, 5000);
  expect((await titleHex(paneB)) === probe, 'the pane title previews it too');
  expect((await daemonHex(B)) === before, 'the daemon still has the saved colour');
  list = await swatches('row-menu');
  expect(list.filter((x) => x.active).length === 1 && list.find((x) => x.active).color === before, `the mark stays on the saved colour under the preview, got ${JSON.stringify(list.filter((x) => x.active))}`);
  expect((await rowHex(A)) === aHex, 'A is untouched by the preview');
  // The label is inside the row; the menu's first item is outside it.
  await moveTo('.row-menu .menu-item');
  await s.waitFor(`${row(B)}?.dataset.color === ${JSON.stringify(before)}`, 'leaving the swatches puts the saved colour back', 5000);
  expect((await titleHex(paneB)) === before, 'on the pane title too');
  await moveTo(probeSel);
  await s.waitFor(`${row(B)}?.dataset.color === ${JSON.stringify(probe)}`, 'previewed again', 5000);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.row-menu')`, 'Escape closed the row menu');
  await s.waitFor(`${row(B)}?.dataset.color === ${JSON.stringify(before)}`, 'Escape with the pointer on a swatch leaves the saved colour', 5000);
  expect((await daemonHex(B)) === before, 'and the daemon never heard of the preview');
  // The pick: the preview holds through the close, so the row never
  // shows the old colour between the click and the push.
  await s.evalJs(`${row(B)}.querySelector('.sidebar-row-menu').click()`);
  await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(B)}`, 'row menu for B a third time');
  await moveTo(probeSel);
  await s.waitFor(`${row(B)}?.dataset.color === ${JSON.stringify(probe)}`, 'previewed before the pick', 5000);
  // The colour is read in the evaluation the click ran in, before the
  // push can land; React closes the menu after the handler, so that is
  // waited for.
  const heldThrough = await s.evalJs(`(() => { document.querySelector(${JSON.stringify(probeSel)}).click(); return ${row(B)}?.dataset.color ?? null; })()`);
  expect(heldThrough === probe, `the row keeps the previewed colour the moment the swatch is clicked, got ${JSON.stringify(heldThrough)}`);
  await s.waitFor(`!document.querySelector('.row-menu') && ${row(B)}?.dataset.color === ${JSON.stringify(probe)}`, 'the menu closes with the colour held');
  await s.waitFor(`(async () => (await window.emerald.request('session.list', {})).sessions.find((x) => x.id === ${JSON.stringify(B)}).color === ${JSON.stringify(probe)})()`, 'the daemon took the pick', 5000);
  expect((await rowHex(B)) === probe && (await titleHex(paneB)) === probe, 'the row and the title wear it after the push');
  await zreq(s, 'session.set', { sessionId: B, color: before });
  await s.waitFor(`${row(B)}?.dataset.color === ${JSON.stringify(before)}`, 'B back on its first colour over the pipe');
  step(`M9 fix 157: hovering ${probe} previewed it on the row and the title with the daemon on ${before}, leaving and Escape put it back, and a pick held through the close`);

  await menuFor(s, A, 'Kill');
  await s.waitFor(`${row(A)}?.dataset.state === 'exited'`, 'A exited after kill', 8000);
  expect(JSON.stringify(await groupOrder(s)) === JSON.stringify([home, 'exited']), 'exited group stays last');
  expect(JSON.stringify(await rowOrder(s)).endsWith(JSON.stringify([A, C]).slice(1)), 'A joined C in the exited group, got ' + JSON.stringify(await rowOrder(s)));
  step('rename landed in the daemon, kill moved A to the exited group');

  // Ctrl+Shift+B hides the sidebar and the choice survives a reload.
  await s.key('B', 'KeyB', 66, CTRL | SHIFT);
  await s.waitFor(`!document.querySelector('.sidebar')`, 'sidebar hidden');
  expect(JSON.parse(await s.evalJs(`localStorage.getItem('emerald.sidebar')`)).sidebarCollapsed === true, 'collapsed flag stored');
  await s.send('Page.reload');
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2 && !document.querySelector('.sidebar')`, 'sidebar still hidden after reload');
  await s.key('B', 'KeyB', 66, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 3`, 'sidebar back with three rows');
  step('Ctrl+Shift+B toggled the sidebar and the choice persisted');

  // M44: the filter chips. A fourth shell D in a pane that is not focused,
  // so its done sticks (the focused pane acks a done that arrives after a
  // recent click); B blocked on a permission. All 4, Needs you 1, Done 1; each chip leaves
  // its rows and their heading and drops the exited group; the choice
  // survives a reload; a click on a chip does not ack the done rows it
  // shows; the collapsed sidebar has no chips.
  const chips = () => s.evalJs(`[...document.querySelectorAll('.sidebar-filter')].map(b => ({ filter: b.dataset.filter, text: b.textContent, active: b.dataset.active === 'true' }))`);
  const clickChip = async (filter) => {
    const c = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-filter[data-filter=${JSON.stringify(filter)}]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.click(c.x, c.y);
    await s.waitFor(`document.querySelector('.sidebar-filters')?.dataset.filter === ${JSON.stringify(filter)}`, `${filter} chip active`);
  };
  // The heading's + (M32): a shell in the home folder beside the focused
  // pane, so D gets a pane of its own that B is then clicked into.
  // The group key is a path, whose backslashes a CSS attribute selector
  // would read as escapes, so the heading is found by comparing.
  await s.evalJs(`[...document.querySelectorAll('.sidebar-group')].find(g => g.dataset.group === ${JSON.stringify(home)}).querySelector('.sidebar-group-add').click()`);
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 4 && document.querySelectorAll('.term-host').length === 3`, 'four rows, D in a third pane');
  layout = await getLayout(s);
  const D = leaves(layout).find((leaf) => leaf.id === layout.focusedPaneId).sessionId;
  await clickRow(s, B);
  for (let i = 0; i < 40; i++) {
    layout = await getLayout(s);
    if (leaves(layout).find((leaf) => leaf.id === layout.focusedPaneId)?.sessionId === B) break;
    await sleep(100);
  }
  expect(leaves(layout).find((leaf) => leaf.id === layout.focusedPaneId)?.sessionId === B, 'the focus went back to the pane showing B, away from D');
  await post(B, { hook_event_name: 'UserPromptSubmit' });
  await post(B, { hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  await waitRowState(s, B, 'needs-input', 'B needs input again');
  await post(D, { hook_event_name: 'UserPromptSubmit' });
  await post(D, { hook_event_name: 'Stop', last_assistant_message: 'done for the chips' });
  await waitRowState(s, D, 'done', 'D done');
  await sleep(300);
  const chipList = await chips();
  const unshownNow = (await unshownIds(s)).length;
  expect(JSON.stringify(chipList) === JSON.stringify([{ filter: 'all', text: 'All 4', active: true }, { filter: 'needs', text: 'Needs you 1', active: false }, { filter: 'done', text: 'Done 1', active: false }, { filter: 'unshown', text: `Unshown ${unshownNow}`, active: false }]), `chips read All 4, Needs you 1, Done 1, Unshown ${unshownNow}, got ` + JSON.stringify(chipList));
  await clickChip('needs');
  expect(JSON.stringify(await rowOrder(s)) === JSON.stringify([B]) && JSON.stringify(await groupOrder(s)) === JSON.stringify([home]), 'Needs you leaves B under its heading, got ' + JSON.stringify(await rowOrder(s)));
  await clickChip('done');
  expect(JSON.stringify(await rowOrder(s)) === JSON.stringify([D]) && JSON.stringify(await groupOrder(s)) === JSON.stringify([home]), 'Done leaves D under its heading, got ' + JSON.stringify(await rowOrder(s)));
  expect((await rowState(s, D)) === 'done', 'the click on the chip did not ack D');
  expect((await s.evalJs(`localStorage.getItem('emerald.sidebarFilter')`)) === 'done', 'the filter is stored');
  await s.send('Page.reload');
  await s.waitFor(`document.querySelectorAll('.term-host').length === 3 && document.querySelector('.sidebar-filters')?.dataset.filter === 'done'`, 'Done still active after reload');
  expect(JSON.stringify(await rowOrder(s)) === JSON.stringify([D]), 'the reload kept the filtered list');
  await clickChip('all');
  expect(JSON.stringify(await groupOrder(s)) === JSON.stringify([home, 'exited']) && (await rowOrder(s)).length === 4, 'All brings every row and the exited group back');
  expect((await rowState(s, D)) === 'done', 'D is still done under All');
  await s.key('B', 'KeyB', 66, CTRL | SHIFT);
  await s.waitFor(`!document.querySelector('.sidebar')`, 'sidebar hidden for the chips check');
  expect((await s.evalJs(`document.querySelector('.sidebar-filters')`)) === null, 'no chips on the collapsed rail');
  await s.key('B', 'KeyB', 66, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.sidebar-filter').length === 4`, 'chips back with the sidebar');
  step(`filter chips: All 4, Needs you 1, Done 1, Unshown ${unshownNow}; each filters the rows, the choice survives a reload`);
  // M9 fix 172: a chip's empty has sessions behind it and offers no
  // starts. D back to working empties Done; a Stop puts it back.
  await post(D, { hook_event_name: 'UserPromptSubmit' });
  await waitRowState(s, D, 'working', 'D working again');
  await clickChip('done');
  await s.waitFor(`document.querySelector('.sidebar-empty')?.textContent === 'Nothing done'`, 'Done reads Nothing done');
  expect((await s.evalJs(`document.querySelector('.sidebar-empty-actions')`)) === null, "no starts under a chip's empty");
  await post(D, { hook_event_name: 'Stop', last_assistant_message: 'done again' });
  await waitRowState(s, D, 'done', 'D done again');
  await clickChip('all');
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 4`, 'All back');
  step("a chip's empty (Nothing done) offers no starts (M9 fix 172)");
  // The favicon on the heading (M9 fix 65): a shell in the seeded folder
  // opens a heading with an img whose src is the file: URL of the icon
  // under public; the home folder has none and draws the folder outline
  // in the same 14px slot (M9 fix 81, back after M46 had left the slot
  // empty). The headings are found by comparing, as the + step above
  // does.
  await zreq(s, 'session.spawn', { kind: 'shell', cwd: seed, cols: 80, rows: 24 });
  const headingIcon = (folder) =>
    s.evalJs(
      `(() => { const g = [...document.querySelectorAll('.sidebar-group')].find(g => g.dataset.group === ${JSON.stringify(folder)}); const i = g?.querySelector('.sidebar-group-icon'); if (!i) return null; const r = i.getBoundingClientRect(); return { tag: i.tagName.toLowerCase(), src: i.getAttribute('src'), w: r.width, h: r.height }; })()`,
    );
  await s.waitFor(`[...document.querySelectorAll('.sidebar-group')].some(g => g.dataset.group === ${JSON.stringify(seed)} && g.querySelector('img.sidebar-group-icon'))`, 'the seeded folder heading has an img icon', 5000);
  const seedIcon = await headingIcon(seed);
  const expectedSrc = 'file:///' + path.join(seed, 'public', 'favicon.svg').replace(/\\/g, '/');
  expect(seedIcon.tag === 'img' && seedIcon.src === expectedSrc, `the heading's img src is the icon's file URL, got ${JSON.stringify(seedIcon)} wanted ${expectedSrc}`);
  expect(seedIcon.w === 14 && seedIcon.h === 14, `the icon is drawn at the outline's 14px, got ${seedIcon.w}x${seedIcon.h}`);
  const homeIcon = await headingIcon(home);
  expect(homeIcon?.tag === 'svg' && homeIcon.w === 14 && homeIcon.h === 14, `the home folder draws the folder outline in the 14px slot, got ${JSON.stringify(homeIcon)}`);
  step('a folder heading draws the project favicon: the seeded folder an img at 14px with the file: URL of public/favicon.svg, the home folder the folder outline');
  // M9 fix 194: a label of the person's own on the seeded folder's
  // heading. A double-click on the name opens the rename box seeded with
  // the folder's name; Work typed and entered titles the heading, puts
  // the label on data-label and the folder's own name before the path
  // in the tooltip, lands in folders.list and in folders.json, and a
  // shell started in the folder afterwards sits under it. The daemon is
  // then restarted on the same home (the window's own Restart, the way
  // the banner's button does it); the shells come back exited, and a
  // fresh shell in the folder opens a heading that still reads Work. The
  // menu's Rename opens the same box; the box cleared puts the folder's
  // name back and empties folders.json.
  const seedGroup = `.sidebar-group[data-group=${JSON.stringify(seed)}]`;
  const seedHeading = () => s.evalJs(`(() => { const h = document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-group-title`)}); return h ? { name: h.querySelector('.sidebar-group-name')?.textContent ?? null, label: h.dataset.label ?? null, title: h.getAttribute('title') } : null; })()`);
  const seedName = path.basename(seed);
  expect(JSON.stringify(await seedHeading()) === JSON.stringify({ name: seedName, label: null, title: seed }), `the heading reads the folder's name with the path as its tooltip, got ${JSON.stringify(await seedHeading())}`);
  const seedNameAt = () => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-group-name`)}).getBoundingClientRect(); return { x: r.x + Math.min(20, r.width / 2), y: r.y + r.height / 2 }; })()`);
  const openLabelBox = async () => {
    const r = await seedNameAt();
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 2 });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 2 });
    await s.waitFor(`document.activeElement?.classList.contains('sidebar-group-rename') && document.activeElement.closest(${JSON.stringify(seedGroup)}) !== null`, 'the label box opens on the heading');
  };
  await openLabelBox();
  expect((await s.evalJs(`document.activeElement.value`)) === seedName, "the box is seeded with the folder's name");
  await s.key('Backspace', 'Backspace', 8);
  await s.type('Work');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-group-title`)})?.dataset.label === 'Work'`, 'the heading takes the label');
  expect(JSON.stringify(await seedHeading()) === JSON.stringify({ name: 'Work', label: 'Work', title: `${seedName}, ${seed}` }), `the heading reads Work with the folder's name before the path in its tooltip, got ${JSON.stringify(await seedHeading())}`);
  const listed = (await zreq(s, 'folders.list', {})).folders;
  expect(JSON.stringify(listed) === JSON.stringify([{ folder: seed, label: 'Work' }]), `folders.list holds the label under the folder, got ${JSON.stringify(listed)}`);
  const foldersFile = path.join(emeraldHome, 'folders.json');
  expect(fs.existsSync(foldersFile) && JSON.stringify(JSON.parse(fs.readFileSync(foldersFile, 'utf8'))) === JSON.stringify(listed), 'folders.json holds the same');
  const { session: laterShell } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: seed, cols: 80, rows: 24 });
  await s.waitFor(`!!document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-row[data-session-id=${JSON.stringify(laterShell.id)}]`)})`, 'a shell started later sits under the labelled heading');
  expect((await seedHeading()).name === 'Work', 'and the heading still reads Work');
  // The restart, on the same home.
  const pidBefore = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8')).pid;
  await s.evalJs(`window.emerald.restartDaemon()`);
  await s.waitFor(`!!document.querySelector('.banner')`, 'disconnected while the daemon restarts', 15000);
  await s.waitFor(`!document.querySelector('.banner')`, 'connected again', 20000);
  const pidAfter = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8')).pid;
  expect(pidAfter !== pidBefore, `a new daemon, pid ${pidBefore} to ${pidAfter}`);
  const { session: afterShell } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: seed, cols: 80, rows: 24 });
  await s.waitFor(`document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-row[data-session-id=${JSON.stringify(afterShell.id)}]`)}) !== null && document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-group-title`)})?.dataset.label === 'Work'`, 'a shell started on the fresh daemon comes up under Work', 10000);
  // The menu's Rename opens the same box; Escape leaves the label.
  const nameAt = await seedNameAt();
  await s.rightClick(nameAt.x, nameAt.y);
  await s.waitFor(`document.querySelector('.group-heading-menu')?.dataset.group === ${JSON.stringify(seed)}`, 'the heading menu');
  const headingItems = await s.evalJs(`[...document.querySelectorAll('.group-heading-menu .menu-item .menu-label')].map(l => l.textContent)`);
  expect(headingItems[0] === 'Rename' && headingItems.length === 6, `Rename, Copy path and Reveal in Explorer lead the heading menu above the three sweeps, got ${JSON.stringify(headingItems)}`);
  // M9 fix 345: Copy path puts the folder itself on the clipboard, read
  // back through the app's own main-process read as the file tabs' menu
  // is read in verify:files (the box's clipboard, so what was there is
  // put back after); navigator.clipboard.readText() has no permission
  // under the harness's page-target CDP session.
  expect(headingItems[1] === 'Copy path' && headingItems[2] === 'Reveal in Explorer', `Copy path then Reveal in Explorer follow Rename, got ${JSON.stringify(headingItems)}`);
  const clipboardBefore = await s.evalJs(`window.emerald.clipboard.read().then(r => r.text)`);
  await s.evalJs(`[...document.querySelectorAll('.group-heading-menu .menu-item')][1].click()`);
  await s.waitFor(`!document.querySelector('.group-heading-menu')`, 'Copy path closes the menu');
  await s.waitFor(`window.emerald.clipboard.read().then(r => r.text === ${JSON.stringify(seed)})`, 'the folder itself is on the clipboard', 3000);
  await s.evalJs(`window.emerald.clipboard.write(${JSON.stringify(clipboardBefore ?? '')})`);
  await s.rightClick(nameAt.x, nameAt.y);
  await s.waitFor(`document.querySelector('.group-heading-menu')?.dataset.group === ${JSON.stringify(seed)}`, 'the heading menu reopens');
  await s.evalJs(`document.querySelector('.group-heading-menu .menu-item').click()`);
  await s.waitFor(`document.activeElement?.classList.contains('sidebar-group-rename')`, 'Rename opens the label box');
  expect((await s.evalJs(`document.activeElement.value`)) === 'Work', 'seeded with the label');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.sidebar-group-rename')`, 'Escape closes it');
  expect((await seedHeading()).name === 'Work', 'and the label stays');
  // Cleared: back to the folder's name, the entry gone.
  await openLabelBox();
  await s.key('Backspace', 'Backspace', 8);
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-group-title`)})?.dataset.label === undefined`, "an empty name goes back to the folder's");
  expect(JSON.stringify(await seedHeading()) === JSON.stringify({ name: seedName, label: null, title: seed }), `the heading reads the folder's name again, got ${JSON.stringify(await seedHeading())}`);
  expect(JSON.stringify((await zreq(s, 'folders.list', {})).folders) === '[]', 'folders.list is empty');
  expect(JSON.stringify(JSON.parse(fs.readFileSync(foldersFile, 'utf8'))) === '[]', 'and folders.json holds no entry');
  step(`M9 fix 194: Work typed on the heading titled it with the folder's name in the tooltip, reached folders.list and folders.json, a later shell and one on the restarted daemon (pid ${pidBefore} to ${pidAfter}) came up under it, Rename on the menu opened the box, and a cleared box put the folder's name back`);
  // M9 fix 200: the changes mark on the heading. The seed is a clean
  // repository; a file written in it puts a muted dot right after the
  // name with the count in the tooltip, a second file bumps the count,
  // and a commit takes the dot away within a poll (5 s).
  const seedMark = () =>
    s.evalJs(
      `(() => { const h = document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-group-title`)}); const m = h?.querySelector('.sidebar-group-changes'); if (!m) return null; const r = m.getBoundingClientRect(); const n = h.querySelector('.sidebar-group-name').getBoundingClientRect(); return { count: m.dataset.count, title: m.getAttribute('title'), color: getComputedStyle(m).backgroundColor, afterName: r.left >= n.right && r.left - n.right < 12, w: r.width, h: r.height }; })()`,
    );
  expect((await seedMark()) === null, 'a clean tree has no changes mark on its heading');
  fs.writeFileSync(path.join(seed, 'dirty.txt'), 'one');
  await s.waitFor(`document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-group-changes`)})?.dataset.count === '1'`, 'the heading marks one changed file', 8000);
  const mark1 = await seedMark();
  const mutedColor = await s.evalJs(`getComputedStyle(document.querySelector('.sidebar-group-title')).color`);
  expect(mark1.title === '1 changed file' && mark1.afterName && mark1.w === 6 && mark1.h === 6, `the mark is a 6px dot right after the name titled 1 changed file, got ${JSON.stringify(mark1)}`);
  expect(mark1.color === mutedColor, `the dot is the heading's muted colour, got ${mark1.color} wanted ${mutedColor}`);
  fs.writeFileSync(path.join(seed, 'dirty2.txt'), 'two');
  await s.waitFor(`document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-group-changes`)})?.dataset.count === '2'`, 'the heading counts two changed files', 8000);
  expect((await seedMark()).title === '2 changed files', 'the tooltip reads 2 changed files');
  const homeMark = await s.evalJs(`!!document.querySelector(${JSON.stringify(`.sidebar-group[data-group=${JSON.stringify(home)}] .sidebar-group-changes`)})`);
  git('add', '.');
  git('commit', '-q', '-m', 'dirty');
  const tCommit = Date.now();
  await s.waitFor(`!document.querySelector(${JSON.stringify(`${seedGroup} .sidebar-group-changes`)})`, 'the mark goes when the tree is clean', 8000);
  step(`M9 fix 200: a written file put the changes mark on the seed heading (1 changed file, then 2), the commit took it off ${Date.now() - tCommit} ms later; the home heading's mark read ${homeMark}`);
  // M9 fix 133: the palette is twelve again (M68 had twenty-four, which
  // did not tell apart), so twelve live sessions wear twelve different
  // colours, each one of the palette, and the thirteenth repeats one.
  const liveColors = () => s.evalJs(`[...document.querySelectorAll('.sidebar-row')].filter(r => r.dataset.state !== 'exited').map(r => r.dataset.color ?? null)`);
  const liveNow = (await liveColors()).length;
  for (let i = liveNow; i < 12; i++) await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 80, rows: 24 });
  await s.waitFor(`[...document.querySelectorAll('.sidebar-row')].filter(r => r.dataset.state !== 'exited').length >= 12`, 'twelve live rows', 20000);
  const palette = await liveColors();
  expect(palette.length >= 12 && new Set(palette).size === palette.length, `twelve live sessions wear twelve different colours, got ${JSON.stringify(palette)}`);
  expect(palette.every((c) => /^#[0-9a-f]{6}$/.test(c ?? '')), 'every one a hex colour');
  await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 80, rows: 24 });
  await s.waitFor(`[...document.querySelectorAll('.sidebar-row')].filter(r => r.dataset.state !== 'exited').length >= 13`, 'a thirteenth live row', 20000);
  const thirteen = await liveColors();
  expect(thirteen.length >= 13 && new Set(thirteen).size === 12 && thirteen.every((c) => /^#[0-9a-f]{6}$/.test(c ?? '')), `the thirteenth repeats one of the twelve, got ${JSON.stringify(thirteen)}`);
  step('M9 fix 133: twelve live sessions, twelve colours, none repeated; the thirteenth repeats one');

  // M9 fix 196: the shell's prompt writes the FinalTerm marks, so the
  // row knows a command runs (through its silence, where the output
  // rate said nothing), ended, and failed with which code; a command
  // that ran past the daemon's limit (2 s here, EMERALD_SHELL_DONE_AFTER_MS
  // at the top, a minute in the product) ends as a done or an errored
  // row that pulses like a Claude's and is acked by a click. A fresh
  // A listed shell no pane shows, so its done pulses without the focused
  // pane looking at it and acking it on the spot (the pane's own ack when
  // it is focused and someone is at the keyboard, M31): the person is
  // taken to be elsewhere, so the row pulses until the row is clicked.
  const marksShell = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 80, rows: 24 });
  const M = marksShell.session.id;
  await s.waitFor(`!!${row(M)}`, 'the marks shell listed');
  const typeInto = (text) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(M)}, data: ${JSON.stringify(text)} + String.fromCharCode(13) })`);
  const mark = () => s.evalJs(`(() => { const m = ${row(M)}?.querySelector('.shell-mark'); return m ? { running: 'running' in m.dataset, failed: 'failed' in m.dataset, title: m.title, color: getComputedStyle(m).color } : null; })()`);
  const record = async () => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === M);
  // The prompt must be up before the first line, so the wrapper is in place.
  await s.waitFor(`window.emerald.request('session.list', {}).then(r => r.sessions.find(x => x.id === ${JSON.stringify(M)})?.shellCwd !== null)`, 'the marks shell at its prompt', 10000);
  expect((await record()).command === null && (await mark()).failed === false, 'no command before the first Enter');
  const errorColor = await s.evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--error').trim()`);
  await typeInto('cmd /c exit 3');
  await s.waitFor(`${row(M)}?.querySelector('.shell-mark')?.dataset.failed === 'true'`, 'the mark failed after exit 3', 8000);
  const failedMark = await mark();
  const failedRec = await record();
  expect(failedRec.command.state === 'failed' && failedRec.command.exitCode === 3 && failedRec.state === 'idle', `the record says failed (3) at idle, got ${JSON.stringify(failedRec.command)} ${failedRec.state}`);
  expect(/^failed \(3\) \d+s ago$/.test(failedMark.title), `the mark's tooltip says failed (3) and when, got ${JSON.stringify(failedMark.title)}`);
  const hexToRgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  expect(failedMark.color === hexToRgb(errorColor), `the mark is --error (${errorColor}), got ${failedMark.color}`);
  expect((await rowBadge(s, M)) === null, 'a short failure draws no badge');
  await typeInto('Write-Host ok');
  await s.waitFor(`(() => { const m = ${row(M)}?.querySelector('.shell-mark'); return m && !('failed' in m.dataset) && /^done \\d+s ago$/.test(m.title); })()`, 'a passing command cleared the mark', 8000);
  expect((await mark()).color !== hexToRgb(errorColor), 'and its colour');
  // A quiet command reads as running through its silence: at 600 ms into
  // a 1200 ms sleep the rate has been zero for two windows.
  await typeInto('Start-Sleep -m 1200');
  await s.waitFor(`${row(M)}?.querySelector('.shell-mark')?.dataset.running === 'true'`, 'running at the Enter', 4000);
  await sleep(600);
  const quiet = await mark();
  expect(quiet.running && /^running \d+s$/.test(quiet.title), `running through the silence with the tooltip saying so, got ${JSON.stringify(quiet)}`);
  await s.waitFor(`${row(M)}?.querySelector('.shell-mark')?.dataset.running !== 'true'`, 'the sleep ended', 4000);
  expect((await record()).state === 'idle' && (await rowBadge(s, M)) === null, 'a command under the limit wants nobody');
  // Past the limit the end is a done row: badge, pulse, and a click acks it.
  await typeInto('Start-Sleep 3');
  await s.waitFor(`${row(M)}?.dataset.state === 'done'`, 'the long command ended as done', 12000);
  await s.waitFor(`${row(M)}?.dataset.attention === 'done'`, 'the row pulses for it', 2000);
  const doneBadge = await rowBadge(s, M);
  expect(/^done [34]s$/.test(doneBadge), `the badge says how long it ran, got ${JSON.stringify(doneBadge)}`);
  await clickRow(s, M);
  step(`M9 fix 196: exit 3 turned the mark --error with failed (3) in its tooltip, a passing command cleared it, a quiet sleep read as running, a 3 s sleep ended as ${doneBadge} and pulsed, and the click acked it idle ${await waitRowState(s, M, 'idle', 'acked after the click')} ms later`);
  expect((await s.evalJs(`${row(M)}?.dataset.attention ?? null`)) === null, 'the pulse is gone');
  // M9 fix 624: the other shells report as PowerShell does, as far as
  // each can. Spawned over the pipe (no pane) and removed at the end, so
  // fix 249's orphan counts below start where they did. cmd reports its
  // folder and a bare D, never a C, so its command stays null; Git Bash,
  // when installed, writes C and D with the code through its rc.
  {
    const { shells } = await s.evalJs('window.emerald.daemonInfo()');
    const ids = shells.map((o) => o.id);
    const typeIn = (id, text) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(id)}, data: ${JSON.stringify(text)} + String.fromCharCode(13) })`);
    const recordOf = async (id) => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id);
    const untilRecord = async (id, what, ms, pred) => {
      const end = Date.now() + ms;
      for (;;) {
        const r = await recordOf(id);
        if (r && pred(r)) return r;
        if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}, last ${JSON.stringify(r && { shellCwd: r.shellCwd, command: r.command, state: r.state })}`);
        await sleep(100);
      }
    };
    const same = (a, b) => (a ?? '').toLowerCase() === b.toLowerCase();
    const spawned = [];
    const cmdShell = (await zreq(s, 'session.spawn', { kind: 'shell', shell: 'cmd', cwd: home, cols: 80, rows: 24 })).session;
    spawned.push(cmdShell.id);
    expect(cmdShell.shell === 'cmd', `the spawn says cmd, got ${cmdShell.shell}`);
    await untilRecord(cmdShell.id, 'the cmd prompt to report its folder', 10000, (r) => same(r.shellCwd, home));
    await typeIn(cmdShell.id, 'cd ..');
    await untilRecord(cmdShell.id, 'the cmd folder to move up', 10000, (r) => same(r.shellCwd, path.dirname(home)));
    await typeIn(cmdShell.id, 'ping -n 3 127.0.0.1 >nul');
    await sleep(1000);
    const cmdMark = await s.evalJs(`${row(cmdShell.id)}?.querySelector('.shell-mark')?.dataset.running ?? null`);
    expect(cmdMark === null, `no running mark on a cmd row, got ${JSON.stringify(cmdMark)}`);
    await sleep(2500);
    const cmdAfter = await recordOf(cmdShell.id);
    expect(cmdAfter.command === null && cmdAfter.state === 'idle', `a cmd row never has a command, got ${JSON.stringify(cmdAfter.command)} ${cmdAfter.state}`);
    // M9 fix 649: cmd writes no C, so a Claude bound in a cmd row is left
    // by its prompt coming back: an empty Enter draws the prompt, whose D
    // unbinds the row once a hook of the conversation has landed. The
    // daemon restarted at fix 194 above, so the hook port is read again
    // rather than taken from post's copy of daemon.json.
    const postNow = async (sessionId, payload) => {
      const now = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
      const res = await fetch(`http://127.0.0.1:${now.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': now.hookToken, 'X-Emerald-Session': sessionId },
        body: JSON.stringify({ session_id: 'sim-' + sessionId.slice(0, 8), cwd: 'C:/sim', ...payload }),
      });
      expect(res.status === 204, `sink answered 204, got ${res.status}`);
    };
    await postNow(cmdShell.id, { hook_event_name: 'SessionStart', source: 'startup' });
    await untilRecord(cmdShell.id, 'the cmd row bound by the SessionStart', 4000, (r) => r.claudeSessionId === 'sim-' + cmdShell.id.slice(0, 8));
    await postNow(cmdShell.id, { hook_event_name: 'UserPromptSubmit' });
    await typeIn(cmdShell.id, '');
    const leftCmd = await untilRecord(cmdShell.id, "cmd's prompt to leave the Claude", 8000, (r) => r.claudeSessionId === null);
    expect(same(leftCmd.cwd, path.dirname(home)) && leftCmd.state === 'idle' && leftCmd.command === null, `the cmd row is a shell again in its folder, got ${leftCmd.cwd} ${leftCmd.state} ${JSON.stringify(leftCmd.command)}`);
    await s.waitFor(`!${row(cmdShell.id)}?.querySelector('.sidebar-row-main .session-mark')`, 'the cmd row shows the prompt mark again', 4000);
    let bashLine;
    if (ids.includes('gitbash')) {
      const bash = (await zreq(s, 'session.spawn', { kind: 'shell', shell: 'gitbash', cwd: home, cols: 80, rows: 24 })).session;
      spawned.push(bash.id);
      expect(bash.shell === 'gitbash', `the spawn says gitbash, got ${bash.shell}`);
      await s.waitFor(`!!${row(bash.id)}`, 'the Git Bash shell listed');
      await untilRecord(bash.id, 'the Git Bash prompt to report its folder', 20000, (r) => same(r.shellCwd, home));
      await typeIn(bash.id, 'false');
      await s.waitFor(`${row(bash.id)}?.querySelector('.shell-mark')?.dataset.failed === 'true'`, 'the Git Bash mark failed after false', 8000);
      const failed = await recordOf(bash.id);
      expect(failed.command?.state === 'failed' && failed.command?.exitCode === 1, `false failed with 1, got ${JSON.stringify(failed.command)}`);
      await typeIn(bash.id, 'sleep 1.2');
      await s.waitFor(`${row(bash.id)}?.querySelector('.shell-mark')?.dataset.running === 'true'`, 'Git Bash running at the Enter', 4000);
      await sleep(600);
      expect(await s.evalJs(`${row(bash.id)}?.querySelector('.shell-mark')?.dataset.running === 'true'`), 'still running at 600 ms');
      await s.waitFor(`${row(bash.id)}?.querySelector('.shell-mark')?.dataset.running !== 'true'`, 'the Git Bash sleep ended', 4000);
      const ok = await untilRecord(bash.id, 'the sleep to read ok', 4000, (r) => r.command?.state === 'ok');
      expect(ok.command.exitCode === 0 && ok.state === 'idle' && (await rowBadge(s, bash.id)) === null, `sleep 1.2 ended ok (0) at idle with no badge, got ${JSON.stringify(ok.command)} ${ok.state}`);
      await typeIn(bash.id, 'cd ..');
      await untilRecord(bash.id, 'the Git Bash folder to move up', 10000, (r) => same(r.shellCwd, path.dirname(home)));
      await s.screenshot('m4-gitbash-marks.png');
      bashLine = 'a Git Bash shell failed false with (1), read sleep 1.2 as running then ok, and moved with cd ..';
    } else {
      bashLine = `no Git Bash on this box (shells: ${ids.join(', ')}), so its marks were not read`;
    }
    for (const id of spawned) await zreq(s, 'session.kill', { sessionId: id, remove: true });
    await s.waitFor(`${JSON.stringify(spawned)}.every((id) => !document.querySelector('.sidebar-row[data-session-id="' + id + '"]'))`, 'the other shells removed', 10000);
    step(`M9 fix 624: a cmd shell reported its folder and moved with cd .. with no command ever running, and (M9 fix 649) a Claude bound in it was left when an empty Enter drew its prompt; ${bashLine}`);
  }
  // M9 fix 249: the rows no pane shows. M sits in the focused pane after
  // the click above; its word reads focused. The pane's hide (−) puts it
  // on no pane: the word turns "on no pane" in italics, the name dims to
  // --muted, data-place says none while data-shown stays off (the ground
  // and the edge mean shown and focused), the home heading's count and
  // the Unshown chip each go up by one, and the chip's list holds M with
  // the other orphans (the shells spawned over the pipe above are all on
  // no pane, so the count starts high). Showing M again puts everything
  // back, and Close all on the heading under the chip counts the
  // filtered rows alone.
  const placeOf = (id) => s.evalJs(`(() => { const r = ${row(id)}; if (!r) return null; const w = r.querySelector('.sidebar-row-shown'); return { shown: r.dataset.shown ?? null, place: r.dataset.place ?? null, word: w?.textContent ?? null, wordPlace: w?.dataset.place ?? null, italic: w ? getComputedStyle(w).fontStyle : null, nameColor: getComputedStyle(r.querySelector('.sidebar-row-name')).color }; })()`);
  const headingUnshown = () => s.evalJs(`(() => { const h = [...document.querySelectorAll('.sidebar-group')].find(g => g.dataset.group === ${JSON.stringify(home)}); const u = h?.querySelector('.sidebar-group-unshown'); return u ? { count: Number(u.dataset.count), text: u.textContent, title: u.title } : null; })()`);
  const chipUnshown = () => s.evalJs(`document.querySelector('.sidebar-filter[data-filter="unshown"]')?.textContent ?? null`);
  const mutedHex = await s.evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()`);
  // The click's show lands over the pipe a moment after its ack; the read
  // came first once on a merged tree and read on no pane.
  await s.waitFor(`${row(M)}?.dataset.place === 'focused'`, 'M in the focused pane after the click', 5000);
  const focusedPlace = await placeOf(M);
  expect(focusedPlace.shown === 'focused' && focusedPlace.place === 'focused' && focusedPlace.word === 'focused' && focusedPlace.italic === 'normal', `M reads focused on both attributes, got ${JSON.stringify(focusedPlace)}`);
  const orphansBefore = await unshownIds(s);
  // The heading counts its own folder's; the chip counts every folder's.
  const homeOrphans = orphansBefore.filter((o) => o.home).length;
  const headingBefore = await headingUnshown();
  expect(headingBefore !== null && headingBefore.count === homeOrphans && headingBefore.text === `${homeOrphans} on no pane`, `the home heading counts the ${homeOrphans} orphans under it, got ${JSON.stringify(headingBefore)}`);
  expect((await chipUnshown()) === `Unshown ${orphansBefore.length}`, `the chip counts the same, got ${await chipUnshown()}`);
  const paneCount = await s.evalJs(`document.querySelectorAll('.pane').length`);
  layout = await getLayout(s);
  const mPane = leaves(layout).find((leaf) => leaf.sessionId === M).id;
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(mPane)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === ${paneCount - 1} && ${row(M)}?.dataset.place === 'none'`, 'M hidden, its row on no pane');
  const nonePlace = await placeOf(M);
  expect(nonePlace.shown === null && nonePlace.place === 'none' && nonePlace.word === 'on no pane' && nonePlace.wordPlace === 'none', `M reads on no pane with data-shown off, got ${JSON.stringify(nonePlace)}`);
  expect(nonePlace.italic === 'italic' && nonePlace.nameColor === hexToRgb(mutedHex), `the word is italic and the name is --muted (${mutedHex}), got ${JSON.stringify(nonePlace)}`);
  const headingAfter = await headingUnshown();
  expect(headingAfter?.count === homeOrphans + 1 && /on no pane of any tab$/.test(headingAfter.title), `the heading's count went up by one, got ${JSON.stringify(headingAfter)}`);
  expect((await chipUnshown()) === `Unshown ${orphansBefore.length + 1}`, `the chip went up by one, got ${await chipUnshown()}`);
  await clickChip('unshown');
  const unshownRows = await rowOrder(s);
  expect(unshownRows.includes(M) && unshownRows.length === orphansBefore.length + 1 && !unshownRows.includes(A), `the Unshown chip lists M and the orphans and not the exited A, got ${unshownRows.length}`);
  expect((await s.evalJs(`document.querySelector('.sidebar-empty')`)) === null, 'the chip has rows, so no empty text');
  // The sweep under the chip: the heading's menu counts the filtered rows.
  const homeNameAt = await s.evalJs(`(() => { const n = [...document.querySelectorAll('.sidebar-group')].find(g => g.dataset.group === ${JSON.stringify(home)}).querySelector('.sidebar-group-name'); n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.x + Math.min(20, r.width / 2), y: r.y + r.height / 2 }; })()`);
  await s.rightClick(homeNameAt.x, homeNameAt.y);
  await s.waitFor(`!!document.querySelector('.group-heading-menu')`, 'the heading menu open under the chip');
  const sweepLabelUnder = await s.evalJs(`[...document.querySelectorAll('.group-heading-menu .menu-item .menu-label')].map(l => l.textContent).find(t => t.startsWith('Close all')) ?? null`);
  expect(sweepLabelUnder === `Close all ${homeOrphans + 1}`, `Close all under the chip counts the filtered rows under the heading, got ${JSON.stringify(sweepLabelUnder)}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.group-heading-menu')`, 'the heading menu closed');
  await clickChip('all');
  // Back on a pane: the empty pane left by the hide takes M through its row.
  await clickRow(s, M);
  await s.waitFor(`${row(M)}?.dataset.place === 'focused'`, 'M shown again, focused');
  const backPlace = await placeOf(M);
  expect(backPlace.shown === 'focused' && backPlace.word === 'focused' && backPlace.italic === 'normal' && backPlace.nameColor !== hexToRgb(mutedHex), `M back to focused with the name lit, got ${JSON.stringify(backPlace)}`);
  expect((await headingUnshown())?.count === homeOrphans && (await chipUnshown()) === `Unshown ${orphansBefore.length}`, 'the heading and the chip are back down');
  await s.screenshot('m4-sidebar-unshown.png');
  step(`M9 fix 249: hiding M's pane turned its word to "on no pane" (italic, the name --muted, data-place none, data-shown off), the home heading's count went ${homeOrphans} to ${homeOrphans + 1} and the Unshown chip ${orphansBefore.length} to ${orphansBefore.length + 1}, the chip listed M with the orphans and Close all under it read the filtered count; showing M again put them back`);
  await s.screenshot('m4-sidebar-final.png');
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m4-sidebar-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
