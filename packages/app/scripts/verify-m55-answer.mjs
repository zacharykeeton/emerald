// M55 acceptance: answering a needs-input session from the sidebar. A
// shell stands in for Claude: it prints a three-option permission dialog
// with no trailing newline, so the cursor sits on the last option as it
// does under Claude Code's dialog, and the hooks that make a permission
// request are posted for it. The row's third line then says what is
// waited on, the tool call as a question; emmer ls and emmer explain say
// the same; a click on the badge opens the card with the dialog read off
// the screen and one button per option; the button for 2 sends that
// digit, which the shell echoes at the cursor; a Stop closes the card;
// and a question (a Notification of agent_needs_input) opens the card
// with a box whose text goes to the shell with Enter. Uses a private
// home and pipe unless the environment already names them.
// Run: npm run verify:answer -w @emerald/app
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm55-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m55';
const { clickNewShell, expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 120 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 120000);

const home = os.homedir();
const s = await launch(freshPort(), { freshState: true });
app = s;

const centerOf = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const type = (sessionId, text) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(sessionId)}, data: ${JSON.stringify(text + '\r')} })`);
// The rendered screen as the card reads it: the rows and the cursor.
const screen = (sessionId) => zreq(s, 'pty.screen', { sessionId });
const cursorRow = async (sessionId) => {
  const sc = await screen(sessionId);
  return sc.rows[sc.cursor.y] ?? '';
};
const waitScreen = async (sessionId, test, what) => {
  const until = Date.now() + 10000;
  while (Date.now() < until && !test((await screen(sessionId)).rows)) await sleep(200);
  const rows = (await screen(sessionId)).rows;
  expect(test(rows), `${what}, got ${JSON.stringify(rows.filter((r) => r.trim() !== ''))}`);
};
const waitCursorRow = async (sessionId, test, what) => {
  const until = Date.now() + 10000;
  while (Date.now() < until && !test(await cursorRow(sessionId))) await sleep(200);
  expect(test(await cursorRow(sessionId)), `${what}, got ${JSON.stringify(await cursorRow(sessionId))}`);
};
const card = () => s.evalJs(`(() => { const c = document.querySelector('.answer-popover'); if (!c) return null; return { session: c.dataset.sessionId, heading: c.querySelector('.answer-popover-heading')?.textContent ?? null, lines: (c.querySelector('.answer-popover-screen')?.textContent ?? '').split('\\n'), keys: [...c.querySelectorAll('.answer-popover-option')].map((b) => b.dataset.key), labels: [...c.querySelectorAll('.answer-popover-label')].map((b) => b.textContent), box: !!c.querySelector('.answer-popover-input') }; })()`);
// The CLI against the same daemon: it reads daemon.json under EMERALD_HOME.
const cli = (...args) => execFileSync(process.execPath, [path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js'), ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, windowsHide: true });

try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await clickNewShell(s, home);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'a shell in the first pane');
  const layout = await getLayout(s);
  const sessionId = leaves(layout)[0].sessionId;
  const rowSel = `.sidebar-row[data-session-id=${JSON.stringify(sessionId)}]`;
  const agentLine = () => s.evalJs(`document.querySelector(${JSON.stringify(rowSel)} + ' .sidebar-row-agent')?.textContent ?? null`);
  const rowState = () => s.evalJs(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state ?? null`);
  const daemon = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const post = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ session_id: 'sim-m55', cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'edit the session file' });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:/sim/session.ts' } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'working'`, 'the shell plays Claude and works');
  // The dialog on the screen, a blank row above it and the cursor left on
  // the last option, as Claude Code's own dialog leaves it; the Read-Host
  // holds the cursor there (the prompt would follow the command otherwise)
  // and echoes what the card sends.
  await type(sessionId, `cls; Write-Host ''; Write-Host 'Do you want to make this edit to session.ts?'; Write-Host '> 1. Yes'; Write-Host '  2. Yes, allow all edits during this session'; Write-Host -NoNewline '  3. No, and tell Claude what to do differently'; Read-Host | Out-Null`);
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('differently'), 'the cursor sits at the end of the last option');
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'Edit', tool_input: { file_path: 'C:/sim/session.ts' } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'needs-input'`, 'the row needs input');
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)} + ' .sidebar-row-agent')?.textContent === 'Allow? Editing session.ts'`, 'the agent line asks about the edit');
  step(`the needs-input row's third line reads ${JSON.stringify(await agentLine())}`);

  const ls = cli('ls');
  const lsRow = ls.split('\n').find((l) => l.includes(sessionId.slice(0, 8)) && l.includes('needs input')) ?? '';
  expect(lsRow.endsWith('Allow? Editing session.ts'), `emmer ls prints the phrase at the end of the row, got ${JSON.stringify(lsRow)}`);
  const explain = cli('explain', sessionId.slice(0, 8));
  expect(explain.split('\n').includes('waiting on: Allow? Editing session.ts'), `emmer explain has the waiting on line, got ${JSON.stringify(explain)}`);
  step('emmer ls and emmer explain say the same');

  // The badge opens the card: the dialog's rows, one button per option.
  const badge = await centerOf(`${rowSel} .sidebar-row-state`);
  await s.click(badge.x, badge.y);
  await s.waitFor(`!!document.querySelector('.answer-popover .answer-popover-option[data-key="3"]')`, 'the card with its options');
  let c = await card();
  expect(c.session === sessionId, 'the card is for the row');
  expect(c.heading === 'Claude is asking permission', `the heading, got ${c.heading}`);
  expect(c.lines.length === 4 && c.lines[0] === 'Do you want to make this edit to session.ts?' && c.lines[1] === '> 1. Yes', `the excerpt is the dialog's four rows, got ${JSON.stringify(c.lines)}`);
  expect(JSON.stringify(c.keys) === JSON.stringify(['1', '2', '3', 'esc']), `three option buttons and Esc, got ${JSON.stringify(c.keys)}`);
  expect(c.labels[1] === 'Yes, allow all edits during this session', `the second label, got ${c.labels[1]}`);
  expect(c.box === false, 'a permission offers no text box');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)} + ' .sidebar-row-state')?.dataset.popoverOpen ?? null`)) === 'pinned', 'the click pinned the card');
  expect((await rowState()) === 'needs-input', 'the click on the badge did not show the session anywhere');
  await s.screenshot('m55-answer-card.png');
  step(`the badge opens the card: ${c.lines.length} rows, buttons ${c.keys.join(' ')}`);

  // Button 2 sends the digit; the shell echoes it at the cursor.
  await s.evalJs(`document.querySelector('.answer-popover .answer-popover-option[data-key="2"]').click()`);
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('differently2'), 'the shell received the 2');
  expect(await s.evalJs(`!!document.querySelector('.answer-popover')`), 'the card stays while the session still needs input');
  step('the 2 button typed a 2 into the session');

  // The turn ends: the card goes with the state. The Read-Host is given
  // its Enter first, so the shell is at its prompt for the next dialog.
  await type(sessionId, '');
  await post({ hook_event_name: 'Stop', stop_hook_active: false });
  // Done, or idle at once: the session's pane is focused in a focused
  // window, which acks a done session (M30).
  await s.waitFor(`['done', 'idle'].includes(document.querySelector(${JSON.stringify(rowSel)})?.dataset.state)`, 'the turn ended');
  await s.waitFor(`!document.querySelector('.answer-popover')`, 'the card closed with the state');
  step('Stop closes the card');

  // A question: the card offers a box, and its text reaches the session.
  await type(sessionId, `cls; Write-Host ''; Write-Host -NoNewline 'What should the function be called? '; Read-Host | Out-Null`);
  await waitCursorRow(sessionId, (row) => row.includes('called?'), 'the question is on the screen');
  await post({ hook_event_name: 'Notification', notification_type: 'agent_needs_input', message: 'Claude needs your input' });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'needs-input'`, 'the row needs input for the question');
  expect((await agentLine()) === 'Question for you', `the line says a question, got ${await agentLine()}`);
  const badge2 = await centerOf(`${rowSel} .sidebar-row-state`);
  await s.click(badge2.x, badge2.y);
  await s.waitFor(`!!document.querySelector('.answer-popover .answer-popover-input') && Number(document.querySelector('.answer-popover-screen')?.dataset.rows) > 0`, 'the card with a box and the screen read');
  c = await card();
  expect(c.heading === 'Claude has a question' && c.lines[0].startsWith('What should the function be called?'), `a question card, got ${c.heading} / ${JSON.stringify(c.lines)}`);
  expect(JSON.stringify(c.keys) === JSON.stringify(['esc']), `only Esc when the screen offers no options, got ${JSON.stringify(c.keys)}`);
  await s.waitFor(`document.activeElement?.classList.contains('answer-popover-input')`, 'the box took focus');
  await s.type('renameSession');
  await s.waitFor(`document.querySelector('.answer-popover-input')?.value === 'renameSession'`, 'the box holds the text');
  await s.key('Enter', 'Enter', 13);
  // Enter went with the text, so the Read-Host returned and the prompt is
  // back: the answer sits on the row above it.
  await waitScreen(sessionId, (rows) => rows.some((r) => r.includes('called? renameSession')), 'the answer reached the shell');
  step('a question opens the card with a box, and its text goes to the session');

  await post({ hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`!document.querySelector('.answer-popover')`, 'the card closed again');
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m55-answer-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
