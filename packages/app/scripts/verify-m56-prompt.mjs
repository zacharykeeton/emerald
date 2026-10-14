// M56 acceptance: a prompt typed into a session from its sidebar row, and
// the saved prompts behind the box and the CLI. Send a prompt on a shell
// row's menu opens the box under the row; dir and Enter run in the shell
// with the pane never focused; a session at needs-input (a shell with
// Claude's hooks posted for it) refuses the text with the reason under
// the box, which stays; emmer prompts add from packages/cli/dist puts a
// saved prompt where the box's Up finds it by name; emmer prompt --saved
// types its text into a session; Ctrl+S in the box asks a name and saves
// what was typed, which emmer prompts ls then lists. Uses a private home
// and pipe unless the environment already names them.
// Run: npm run verify:prompt -w @emerald/app
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm56-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m56';
const { CTRL, clickNewShell, expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 150 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 150000);

const home = os.homedir();
const cli = path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js');
const s = await launch(freshPort(), { freshState: true });
app = s;

const rowSel = (id) => `.sidebar-row[data-session-id=${JSON.stringify(id)}]`;
const centerOf = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
// The row's menu, then its Send a prompt item, then the box under the row.
const openBox = async (id) => {
  const c = await centerOf(`${rowSel(id)} .sidebar-row-name`);
  await s.rightClick(c.x, c.y);
  await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(id)}`, 'the row menu');
  await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent.startsWith('Send a prompt')).click()`);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(id) + " .sidebar-prompt")})`, 'the prompt box under the row');
  const active = await s.evalJs(`document.activeElement?.className ?? null`);
  expect(active === 'sidebar-prompt', `the box has the keyboard, got ${active}`);
};
const boxOpen = (id) => s.evalJs(`!!document.querySelector(${JSON.stringify(rowSel(id) + " .sidebar-prompt")})`);
const boxValue = (id) => s.evalJs(`document.querySelector(${JSON.stringify(rowSel(id) + " .sidebar-prompt")})?.value ?? null`);
const boxError = (id) => s.evalJs(`document.querySelector(${JSON.stringify(rowSel(id) + " .sidebar-prompt-error")})?.textContent ?? null`);
const boxHistory = (id) => s.evalJs(`(() => { const w = document.querySelector(${JSON.stringify(rowSel(id) + " .sidebar-prompt-wrap")}); return w ? { index: w.dataset.historyIndex ?? null, name: w.dataset.historyName ?? null } : null; })()`);
const enter = () => s.key('Enter', 'Enter', 13);
const escape = () => s.key('Escape', 'Escape', 27);
const screenHas = async (sessionId, text) => (await zreq(s, 'pty.screen', { sessionId })).rows.some((r) => r.includes(text));
// What the box sends into the shell: its output is ran-ok, which the typed
// text itself does not contain.
const LINE = "'ran-' + 'ok'";
const waitScreen = async (sessionId, text, what) => {
  const until = Date.now() + 10000;
  while (Date.now() < until && !(await screenHas(sessionId, text))) await sleep(200);
  expect(await screenHas(sessionId, text), what);
};
// The CLI from packages/cli/dist, on this run's home and pipe.
const emerald = (...args) => {
  const r = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
// Claude's hooks for a shell session, so it looks and acts like Claude.
const daemon = () => JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
const post = async (sessionId, payload) => {
  const d = daemon();
  const res = await fetch(`http://127.0.0.1:${d.hookPort}/hook`, {
    method: 'POST',
    headers: { 'X-Emerald-Token': d.hookToken, 'X-Emerald-Session': sessionId },
    body: JSON.stringify({ session_id: `sim-${sessionId.slice(0, 8)}`, cwd: home, transcript_path: 'C:/sim/none.jsonl', ...payload }),
  });
  expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
};
const waitState = (id, state) => s.waitFor(`document.querySelector(${JSON.stringify(rowSel(id))})?.dataset.state === ${JSON.stringify(state)}`, `${id.slice(0, 8)} at ${state}`, 8000);

try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await clickNewShell(s, home);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'a shell in the first pane');
  const layout = await getLayout(s);
  const shell = leaves(layout)[0].sessionId;
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(shell))})?.dataset.shown === 'focused'`, 'the shell row says focused');
  // Two more sessions with no pane: one that will play Claude waiting on
  // a person, one that plays Claude idle for the CLI's saved prompt.
  const asking = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 100, rows: 30 })).session.id;
  const idle = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 100, rows: 30 })).session.id;
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 3`, 'three rows');
  step('a shell on screen and two off screen');

  // The box on the shell's row: a line and Enter run in the shell, the
  // box closes, and the terminal never took focus (the box had it, then
  // the row's mousedown rule keeps it off the row). The line's output is
  // one short word its own text does not contain, so the echo of the
  // typed line is not mistaken for it and a long listing (dir in a home
  // folder wraps past a screen) cannot scroll it off.
  await openBox(shell);
  const menuItem = await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].length`);
  expect(menuItem === 0, 'the menu closed when the box opened');
  await s.type(LINE);
  expect((await boxValue(shell)) === LINE, 'the box holds what was typed');
  await enter();
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(shell) + " .sidebar-prompt")})`, 'the box closed on Enter');
  await waitScreen(shell, 'ran-ok', 'the shell ran the line');
  expect(!(await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(shell))})?.dataset.flash`)), 'a plain shell is never marked stalled');
  step('Send a prompt on a shell row typed dir and Enter into it');

  // A session at needs-input refuses the text: the reason under the box,
  // the box still there, nothing typed into the session.
  await post(asking, { hook_event_name: 'SessionStart', source: 'startup' });
  await post(asking, { hook_event_name: 'UserPromptSubmit', prompt: 'edit the thing' });
  await post(asking, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:/sim/session.ts' } });
  await post(asking, { hook_event_name: 'PermissionRequest', tool_name: 'Edit' });
  await waitState(asking, 'needs-input');
  const before = (await zreq(s, 'pty.screen', { sessionId: asking })).rows.join('\n');
  await openBox(asking);
  await s.type('hello there');
  await enter();
  await s.waitFor(`(document.querySelector(${JSON.stringify(rowSel(asking) + " .sidebar-prompt-error")})?.textContent ?? '') !== ''`, 'the refusal under the box');
  expect((await boxError(asking)) === 'Answer what it is waiting on first', `the reason reads Answer what it is waiting on first, got ${await boxError(asking)}`);
  expect(await boxOpen(asking), 'the box stays open');
  expect((await boxValue(asking)) === 'hello there', 'the text is still in the box');
  await sleep(300);
  const after = (await zreq(s, 'pty.screen', { sessionId: asking })).rows.join('\n');
  expect(after === before, 'nothing reached the session');
  await escape();
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(asking) + " .sidebar-prompt")})`, 'Escape closed the box');
  step('a session at needs-input refuses the prompt with the reason, the box staying');

  // The CLI saves a prompt; the box's Up finds it by name.
  const added = emerald('prompts', 'add', 'tests', 'echo', 'saved-prompt-ran');
  expect(added.code === 0 && added.out.includes('saved tests'), `emmer prompts add saved it, got ${added.code}: ${added.out.trim()}`);
  const listed = emerald('prompts', 'ls');
  expect(listed.code === 0 && listed.out.includes('tests  echo saved-prompt-ran'), `emmer prompts ls lists it, got ${listed.out.trim()}`);
  await openBox(shell);
  await sleep(300);
  await s.key('ArrowUp', 'ArrowUp', 38);
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(shell) + " .sidebar-prompt-wrap")})?.dataset.historyName === 'tests'`, 'Up lands on the saved prompt');
  expect((await boxValue(shell)) === 'echo saved-prompt-ran', 'the saved text is in the box');
  await s.key('ArrowUp', 'ArrowUp', 38);
  const recent = await boxHistory(shell);
  expect(recent.index === '1' && recent.name === null && (await boxValue(shell)) === LINE, `Up again reaches the recent line, got ${JSON.stringify(recent)} ${await boxValue(shell)}`);
  await s.key('ArrowDown', 'ArrowDown', 40);
  await s.key('ArrowDown', 'ArrowDown', 40);
  expect((await boxHistory(shell)).index === null && (await boxValue(shell)) === '', 'Down twice is back at the empty typed line');
  await escape();
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel(shell) + " .sidebar-prompt")})`, 'Escape closed the box');
  step('emmer prompts add, then Up in the box finds the saved prompt, then the recent one');

  // emmer prompt --saved types the saved text into a session that plays
  // Claude: the CLI waits for it to work and settle, which the hooks say.
  await post(idle, { hook_event_name: 'SessionStart', source: 'startup' });
  await waitState(idle, 'idle');
  const typedAt = Date.now();
  const run = spawn(process.execPath, [cli, 'prompt', idle, 'tests', '--saved', '--timeout', '20000'], { windowsHide: true, env: { ...process.env, NO_COLOR: '1' } });
  let cliOut = '';
  run.stdout.on('data', (d) => (cliOut += d));
  run.stderr.on('data', (d) => (cliOut += d));
  const exited = new Promise((resolve) => run.on('exit', resolve));
  await waitScreen(idle, 'saved-prompt-ran', 'the saved text was typed into the session');
  // The typed echo is the shell's own command, so the simulated Claude's
  // prompt waits for its D mark: a hook that lands while a command runs
  // and a D after it is Claude leaving by fix 360's rule, and the row
  // went straight back to idle on the merged tree of fixes 450 to 493.
  await s.waitFor(`(async () => { const c = (await window.emerald.request('session.list', {})).sessions.find((x) => x.id === ${JSON.stringify(idle)})?.command; return c != null && c.state !== 'running' && c.startedAt >= ${typedAt}; })()`, 'the typed echo finished', 8000);
  await post(idle, { hook_event_name: 'UserPromptSubmit', prompt: 'echo saved-prompt-ran' });
  await waitState(idle, 'working');
  await post(idle, { hook_event_name: 'Stop', stop_hook_active: false });
  const code = await exited;
  expect(code === 0, `emmer prompt --saved returned 0 once the turn settled, got ${code}: ${cliOut.trim()}`);
  step('emmer prompt --saved typed the saved text and waited for the turn');

  // Ctrl+S in the box asks a name and saves what was typed.
  await openBox(shell);
  await s.type('echo from-box');
  await s.key('s', 'KeyS', 83, CTRL);
  await s.waitFor(`document.activeElement?.classList.contains('sidebar-prompt-name')`, 'the name box after Ctrl+S');
  await s.type('frombox');
  await enter();
  await s.waitFor(`!document.querySelector('.sidebar-prompt-name') && document.activeElement?.classList.contains('sidebar-prompt')`, 'the name box closed and the prompt box has focus again');
  expect((await boxValue(shell)) === 'echo from-box', 'the text is still in the box after the save');
  const until = Date.now() + 5000;
  let ls = emerald('prompts', 'ls');
  while (Date.now() < until && !ls.out.includes('frombox')) {
    await sleep(300);
    ls = emerald('prompts', 'ls');
  }
  expect(ls.out.includes('frombox  echo from-box'), `emmer prompts ls lists the prompt saved from the box, got ${ls.out.trim()}`);
  const asJson = JSON.parse(emerald('prompts', 'ls', '--json').out);
  expect(asJson.prompts.length === 2 && asJson.prompts[0].name === 'frombox' && asJson.prompts[1].name === 'tests', 'the list is sorted by name');
  await escape();
  const removed = emerald('prompts', 'rm', 'frombox');
  expect(removed.code === 0 && !emerald('prompts', 'ls').out.includes('frombox'), 'emmer prompts rm removed it');
  expect(emerald('prompts', 'rm', 'frombox').code !== 0, 'removing it again fails');
  step('Ctrl+S saved the text in the box under a name; emmer prompts ls and rm see it');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m56-prompt-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
