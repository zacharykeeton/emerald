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
  console.error('[verify] WATCHDOG: run exceeded 180 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 180000);

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

  // M9 fix 848: the last button reads Cancel with no key cap, and Escape
  // on the card closes it and reaches no session: the shell's Read-Host
  // keeps the abc typed into it.
  const esc848 = await s.evalJs(`(() => { const b = document.querySelector('.answer-popover .answer-popover-option[data-key="esc"]'); return { text: b.textContent, title: b.title }; })()`);
  expect(esc848.text === 'Cancel' && esc848.title === 'Sends Escape to the session', `fix 848: the last button reads Cancel, got ${JSON.stringify(esc848)}`);
  console.log(`[verify] fix 848: focus is on ${JSON.stringify(await s.evalJs(`(() => { const a = document.activeElement; return { tag: a?.tagName ?? null, cls: a?.className ?? null, inPane: !!a?.closest('[data-pane-id]') }; })()`))}`);
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(sessionId)}, data: 'abc' })`);
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('differentlyabc'), 'fix 848: abc typed into the Read-Host');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.answer-popover')`, 'fix 848: Escape closes the card', 3000);
  await sleep(800);
  expect((await rowState()) === 'needs-input', `fix 848: the row still needs input, got ${await rowState()}`);
  const row848 = await cursorRow(sessionId);
  expect(row848.trim().endsWith('differentlyabc'), `fix 848: the Escape reached no session, the cursor row reads ${JSON.stringify(row848)}`);
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(sessionId)}, data: '\\x7f\\x7f\\x7f' })`);
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('differently'), 'fix 848: the abc cleared');
  step('fix 848: the sidebar card\'s last button reads Cancel, and Escape on the card closes it and reaches no session');
  await s.click(badge.x, badge.y);
  await s.waitFor(`!!document.querySelector('.answer-popover .answer-popover-option[data-key="3"]')`, 'fix 848: the card open again');

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

  // M9 fix 880: a permission answered in the terminal, never the card:
  // the card dims on what was asked and opens no box.
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'run the probe' });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo ask-880' } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'working'`, 'fix 880: the shell plays Claude and works');
  await type(sessionId, "cls; Write-Host ''; Write-Host ' Bash command'; Write-Host '  echo ask-880'; Write-Host ' Do you want to proceed?'; Write-Host ' > 1. Yes'; Write-Host '   2. No'; Write-Host -NoNewline ' Esc to cancel'; $null = [Console]::ReadKey($true); cls; Write-Host -NoNewline 'ran ask-880'; Read-Host | Out-Null");
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('cancel'), 'fix 880: the permission drawn, the cursor on its footer');
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'echo ask-880' } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'needs-input'`, 'fix 880: the row needs input');
  const badge880 = await centerOf(`${rowSel} .sidebar-row-state`);
  await s.click(badge880.x, badge880.y);
  await s.waitFor(`!!document.querySelector('.answer-popover .answer-popover-option[data-key="2"]')`, 'fix 880: the card with its two options');
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(sessionId)}, data: '1' })`);
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('ran ask-880'), 'fix 880: the terminal took the key and cleared its dialog');
  await sleep(2500);
  const c880 = await card();
  const sent880 = await s.evalJs(`[...document.querySelectorAll('.answer-popover .answer-popover-option')].map((b) => b.dataset.sent ?? null)`);
  console.log(`[verify] fix 880: the card after the terminal's answer reads ${JSON.stringify({ ...c880, sent: sent880 })}`);
  expect(c880 !== null && JSON.stringify(c880.keys) === JSON.stringify(['1', '2', 'esc']), `fix 880: the card keeps what was asked, got ${JSON.stringify(c880)}`);
  expect(sent880.length > 0 && sent880.every((v) => v === 'true'), `fix 880: every option is marked sent, got ${JSON.stringify(sent880)}`);
  expect(c880.box === false, `fix 880: no answer box, got ${JSON.stringify(c880)}`);
  step('fix 880: a permission answered in the terminal leaves the sidebar card dimmed on what was asked, with no box');
  await type(sessionId, '');
  await post({ hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`['done', 'idle'].includes(document.querySelector(${JSON.stringify(rowSel)})?.dataset.state)`, 'fix 880: the turn ended');
  await s.waitFor(`!document.querySelector('.answer-popover')`, 'fix 880: the card closed with the state');

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

  // M9 fix 777: an AskUserQuestion, which comes as a permission_prompt,
  // drawn as the terminal draws it: the heading, the question, the tabs
  // and each option's description (verify:chat's question block's draw).
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'ask me about the button' });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'working'`, 'working on the question');
  const ch = (code) => `[char]0x${code}`;
  const tabRow = `('' + ${ch('2190')} + ' ' + ${ch('2612')} + ' Colour ' + ${ch('2610')} + ' Size ' + ${ch('2610')} + ' Shape ' + ${ch('2713')} + ' Submit ' + ${ch('2192')})`;
  const footer = `('Enter to select ' + ${ch('00B7')} + ' Tab/Arrow keys to navigate ' + ${ch('00B7')} + ' Esc to cancel')`;
  const rows = ['', 'Which size should the sample button be?', '', '  1. Small', '     Fits a dense toolbar', '> 2. Medium (Recommended)', '     Matches the other buttons', '  3. Large', '     Easy to hit on a touch screen', '  4. Type something.', '', '  5. Chat about this', ''];
  await type(sessionId, `cls; Write-Host ''; Write-Host ${tabRow}; ${rows.map((r) => `Write-Host '${r}'`).join('; ')}; Write-Host -NoNewline ${footer}; Read-Host | Out-Null`);
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('cancel'), 'the question drawn, the cursor on its footer');
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
  await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use AskUserQuestion' });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'needs-input'`, 'the row needs input for the AskUserQuestion');
  // M9 fix 802: the row reads the AskUserQuestion as a question, as the card does.
  const words802 = await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)} + ' .sidebar-row-state')?.textContent ?? null`);
  expect(words802 === 'needs input: a question', `fix 802: the row's state words read a question, got ${JSON.stringify(words802)}`);
  expect((await agentLine()) === 'Question for you', `fix 802: the agent line says a question, got ${JSON.stringify(await agentLine())}`);
  const badge3 = await centerOf(`${rowSel} .sidebar-row-state`);
  await s.click(badge3.x, badge3.y);
  await s.waitFor(`!!document.querySelector('.answer-popover .answer-popover-option[data-key="5"]')`, 'the card with its five options');
  const qc = await s.evalJs(`(() => { const c = document.querySelector('.answer-popover'); const two = c.querySelector('.answer-popover-option[data-key="2"]'); return { heading: c.querySelector('.answer-popover-heading')?.textContent ?? null, question: c.querySelector('.answer-popover-question')?.textContent ?? null, tabs: [...c.querySelectorAll('.answer-popover-tab')].map((t) => t.textContent.replace(/^✓/, '') + ':' + t.dataset.state + ':' + (t.dataset.current ?? '')), desc: two?.querySelector('.answer-popover-desc')?.textContent ?? null, screen: !!c.querySelector('.answer-popover-screen'), box: !!c.querySelector('.answer-popover-input') }; })()`);
  expect(qc.heading === 'Claude has a question', `the question's heading, got ${qc.heading}`);
  expect(qc.question === 'Which size should the sample button be?', `the question, got ${JSON.stringify(qc.question)}`);
  expect(qc.tabs.join(',') === 'Colour:answered:,Size:open:true,Shape:open:', `the tabs, got ${JSON.stringify(qc.tabs)}`);
  expect(qc.desc === 'Matches the other buttons', `option 2's description, got ${JSON.stringify(qc.desc)}`);
  expect(!qc.screen && !qc.box, `no excerpt and no box, got ${JSON.stringify(qc)}`);
  await s.screenshot('m55-answer-question.png');
  await type(sessionId, '');
  await post({ hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`!document.querySelector('.answer-popover')`, 'the question card closed');
  step('fix 777: the badge card draws an AskUserQuestion, its tabs, its question and the descriptions, the row reading needs input: a question');

  // M9 fix 879: the Review your answers tab as the capture of 2.1.302
  // draws it, with no footer: the question with its answer, Submit answers
  // and Cancel as digits, no second Cancel, and Back.
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'review the answers' });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'working'`, 'fix 879: working on the review');
  const tabRowR = `('' + ${ch('2190')} + '  ' + ${ch('2612')} + ' Checks  ' + ${ch('2714')} + ' Submit  ' + ${ch('2192')})`;
  const rowsR = ['', 'Review your answers', '', ' (dot) Which checks should the sample run?', '   (to) Types', '', 'Ready to submit your answers?', '', '> 1. Submit answers', '  2. Cancel'];
  const glyphR = (row) => row.replace('(dot)', `' + ${ch('25CF')} + '`).replace('(to)', `' + ${ch('2192')} + '`);
  await type(sessionId, `cls; Write-Host ''; Write-Host ${tabRowR}; ${rowsR.map((r) => `Write-Host ('${glyphR(r)}')`).join('; ')}; $e = [Console]::ReadKey($true); cls; Write-Host -NoNewline ('got ' + $e.KeyChar); Read-Host | Out-Null`);
  await waitScreen(sessionId, (rs) => rs.some((r) => r.trimEnd().endsWith('2. Cancel')), 'fix 879: the review drawn');
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
  await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use AskUserQuestion' });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'needs-input'`, 'fix 879: the row needs input for the review');
  const badge4 = await centerOf(`${rowSel} .sidebar-row-state`);
  await s.click(badge4.x, badge4.y);
  await s.waitFor(`!!document.querySelector('.answer-popover .answer-popover-review')`, 'fix 879: the card with the review');
  const rc = await s.evalJs(`(() => { const c = document.querySelector('.answer-popover'); return { question: c.querySelector('.answer-popover-question')?.textContent ?? null, items: [...c.querySelectorAll('.answer-popover-review-item')].map((i) => [i.querySelector('.answer-popover-review-q')?.textContent ?? null, i.querySelector('.answer-popover-review-a')?.textContent ?? null]), keys: [...c.querySelectorAll('.answer-popover-option')].map((b) => b.dataset.key), labels: [...c.querySelectorAll('.answer-popover-option .answer-popover-label')].map((l) => l.textContent), screen: !!c.querySelector('.answer-popover-screen'), input: !!c.querySelector('.answer-popover-input') }; })()`);
  console.log(`[verify] fix 879: the sidebar's review card reads ${JSON.stringify(rc)}`);
  expect(rc.question === 'Review your answers', `fix 879: the review's title, got ${JSON.stringify(rc)}`);
  expect(JSON.stringify(rc.items) === JSON.stringify([['Which checks should the sample run?', 'Types']]), `fix 879: the question with its answer, got ${JSON.stringify(rc)}`);
  expect(rc.labels.slice(0, 2).join(',') === 'Submit answers,Cancel', `fix 879: Submit answers and Cancel, got ${JSON.stringify(rc)}`);
  expect(rc.keys.join(',') === '1,2,back', `fix 879: the two options and Back, no second Cancel, got ${JSON.stringify(rc)}`);
  expect(!rc.screen && !rc.input, `fix 879: no excerpt and no box, got ${JSON.stringify(rc)}`);
  await s.screenshot('m55-answer-review.png');
  await s.evalJs(`document.querySelector('.answer-popover .answer-popover-option[data-key="1"]').click()`);
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('got 1'), 'fix 879: Submit answers sent its digit');
  await type(sessionId, '');
  await post({ hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`!document.querySelector('.answer-popover')`, 'fix 879: the review card closed');
  step('fix 879: the sidebar card draws the Review your answers tab, the question with its answer, and one Cancel');

  // M9 fix 910: with the sidebar's review card open, a Left press goes to
  // the focused terminal and reaches the session, as the digits its caps
  // name do (the card takes no key but Escape), so Back carries the cap.
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'review again' });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'working'`, 'fix 910: working on the review');
  await type(sessionId, `cls; Write-Host ''; Write-Host ${tabRowR}; ${rowsR.map((r) => `Write-Host ('${glyphR(r)}')`).join('; ')}; $e = [Console]::ReadKey($true); cls; Write-Host -NoNewline ('got key ' + $e.Key); Read-Host | Out-Null`);
  await waitScreen(sessionId, (rs) => rs.some((r) => r.trimEnd().endsWith('2. Cancel')), 'fix 910: the review drawn');
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
  await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use AskUserQuestion' });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'needs-input'`, 'fix 910: the row needs input for the review');
  const badge910 = await centerOf(`${rowSel} .sidebar-row-state`);
  await s.click(badge910.x, badge910.y);
  await s.waitFor(`!!document.querySelector('.answer-popover .answer-popover-review')`, 'fix 910: the card with the review');
  const cap910 = await s.evalJs(`document.querySelector('.answer-popover-back .answer-popover-key')?.textContent ?? null`);
  expect(cap910 === '←', `fix 910: Back carries its ← cap, got ${JSON.stringify(cap910)}`);
  const focus910 = () => s.evalJs(`(() => { const a = document.activeElement; return { tag: a?.tagName ?? null, cls: a?.className ?? null, inPane: !!a?.closest('[data-pane-id]') }; })()`);
  let at910 = await focus910();
  if (!at910.inPane) {
    const paneId910 = leaves(layout)[0].id;
    await s.evalJs(`document.querySelector('[data-pane-id=' + ${JSON.stringify(JSON.stringify(paneId910))} + '] .xterm-helper-textarea').focus()`);
    at910 = await focus910();
  }
  console.log(`[verify] fix 910: focus is on ${JSON.stringify(at910)}`);
  await s.key('ArrowLeft', 'ArrowLeft', 37);
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('got key LeftArrow'), 'fix 910: a Left press with the sidebar card open reaches the session');
  await type(sessionId, '');
  await post({ hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`!document.querySelector('.answer-popover')`, 'fix 910: the review card closed');
  step("fix 910: the sidebar's review card draws Back with its ← cap, and a Left press with the card open reaches the session");
  // M9 fix 922: the sidebar card's tabs but the current one are buttons too.
  // A three-question ask on the third tab, Colour and Size answered; the
  // stub takes the two Lefts, redraws the dialog on Colour and waits for a
  // key.
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'ask me about the tabs' });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'working'`, 'fix 922: working on the tabs');
  const tabRowA = `('' + ${ch('2190')} + ' ' + ${ch('2612')} + ' Colour ' + ${ch('2612')} + ' Size ' + ${ch('2610')} + ' Shape ' + ${ch('2713')} + ' Submit ' + ${ch('2192')})`;
  const rowsShape = ['', 'Which shape should the sample button be?', '', '> 1. Round', '     Soft corners all round', '  2. Square', '     Sharp corners', '  3. Pill', '     Fully rounded ends', '  4. Type something.', '', '  5. Chat about this', ''];
  const rowsColour = ['', 'Which colour should the sample button be?', '', '> 1. Green', '     Matches the brand', '  2. Grey', '     Stays quiet', '  3. Red', '     Draws the eye', '  4. Type something.', '', '  5. Chat about this', ''];
  const drawA = (list) => list.map((r) => `Write-Host '${r}'`).join('; ');
  await type(sessionId, `cls; Write-Host ''; Write-Host ${tabRowA}; ${drawA(rowsShape)}; Write-Host -NoNewline ${footer}; $a = [Console]::ReadKey($true); $b = [Console]::ReadKey($true); cls; Write-Host ''; Write-Host ${tabRowA}; ${drawA(rowsColour)}; Write-Host -NoNewline ${footer}; $c = [Console]::ReadKey($true); cls; Write-Host -NoNewline ('got ' + $a.Key + ' ' + $b.Key); Read-Host | Out-Null`);
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('cancel'), 'fix 922: the question drawn, the cursor on its footer');
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
  await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use AskUserQuestion' });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.state === 'needs-input'`, 'fix 922: the row needs input for the tabs');
  const badge922 = await centerOf(`${rowSel} .sidebar-row-state`);
  await s.click(badge922.x, badge922.y);
  await s.waitFor(`!!document.querySelector('.answer-popover .answer-popover-tab')`, 'fix 922: the card with its tabs');
  await s.evalJs(`document.querySelector('.answer-popover button.answer-popover-tab[data-state="answered"]').click()`);
  await s.waitFor(`document.querySelector('.answer-popover-question')?.textContent === 'Which colour should the sample button be?' && !document.querySelector('.answer-popover [data-sent]')`, 'fix 922: the dialog on Colour, the card taking a press again', 10000);
  const tabs922 = await s.evalJs(`[...document.querySelectorAll('.answer-popover-tab')].map((t) => t.tagName + ':' + t.textContent.replace(/^✓/, '') + ':' + (t.dataset.current ?? ''))`);
  expect(JSON.stringify(tabs922) === JSON.stringify(['SPAN:Colour:true', 'BUTTON:Size:', 'BUTTON:Shape:']), `fix 922: Colour current after the click, got ${JSON.stringify(tabs922)}`);
  await type(sessionId, '');
  await waitCursorRow(sessionId, (row) => row.trim().endsWith('got LeftArrow LeftArrow'), 'fix 922: the session got two Lefts');
  await type(sessionId, '');
  await post({ hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`!document.querySelector('.answer-popover')`, 'fix 922: the tabs card closed');
  step("fix 922: the sidebar card's earlier tab is a button that sends a Left per tab back, and the card reads it as current while the dialog draws its question");
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
