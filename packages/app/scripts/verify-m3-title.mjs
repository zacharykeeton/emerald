// M3 acceptance, part 1: the pane title bar tells the truth. Two shells in
// two panes; hook events for the first are POSTed straight to the sink as if
// Claude had fired them, and the title must follow: idle, working, needs
// input with its reason, done (which sticks while the pane is unfocused),
// then idle once the pane is clicked (session.ack), errored with the type,
// and the live cwd. The second shell must not move at all.
// Starts from an empty layout, so run it when no Emerald app is open.
// Run: npm run verify:title -w @emerald/app
import fs from 'node:fs';
import path from 'node:path';
import { CTRL, SHIFT, clickNewShell, expect, freshPort, getLayout, killTree, launch, leaves, sleep, step, stopDaemon, emeraldHome, zreq } from './cdp.mjs';

setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 60 s');
  process.exit(3);
}, 60000);

const titleOf = (s, paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-state')?.textContent ?? null`);
// The row's state badge, dot and age: a plain shell has none (M22).
const rowOf = (s, id) => s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]'); return r ? { badge: r.querySelector('.sidebar-row-state')?.textContent ?? null, dot: !!r.querySelector('.session-mark'), age: r.querySelector('.sidebar-row-age')?.textContent ?? null, state: r.dataset.state } : null; })()`);
const noState = (row) => row !== null && row.badge === null && !row.dot && row.age === null;
const toneOf = (s, paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-state')?.className ?? null`);
const cwdOf = (s, paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-cwd')?.textContent ?? null`);
const waitTitle = async (s, paneId, text, what, timeoutMs = 3000) => {
  const t0 = Date.now();
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-state')?.textContent === ${JSON.stringify(text)}`, what, timeoutMs);
  return Date.now() - t0;
};
const clickPane = async (s, paneId) => {
  const r = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(r.x, r.y);
};

const s = await launch(freshPort(), { freshState: true });
try {
  await s.waitFor(`!!document.querySelector('.empty-pane')`, 'empty pane');
  await clickNewShell(s);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'first terminal');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes');
  await clickNewShell(s);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'second terminal');
  await sleep(500);
  const layout = await getLayout(s);
  const [p1, p2] = leaves(layout);
  expect(layout.focusedPaneId === p2.id, 'second pane focused after its shell started');
  const claudeLike = p1.sessionId;
  const plain = p2.sessionId;
  // The state machine says idle, but a shell that has heard no hook shows
  // no state: no title badge, and no dot, badge or age on the row.
  expect((await titleOf(s, p1.id)) === null && (await titleOf(s, p2.id)) === null, 'both shells show no state');
  const rows = [await rowOf(s, claudeLike), await rowOf(s, plain)];
  expect(rows.every(noState), 'neither row has a dot, a badge or an age');
  expect(rows.every((r) => r.state === 'idle'), 'the rows still carry data-state idle');
  step(`two shells: ${claudeLike.slice(0, 8)} (will get hooks) and ${plain.slice(0, 8)} (control), both without a state badge`);

  const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
  expect(typeof daemon.hookPort === 'number' && typeof daemon.hookToken === 'string', 'daemon.json has hookPort and hookToken');
  const post = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': claudeLike },
      body: JSON.stringify({ session_id: 'sim-claude-1', cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}, got ${res.status}`);
  };

  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  await sleep(200);
  expect((await titleOf(s, p1.id)) === 'idle', 'idle after SessionStart');
  const hookedRow = await rowOf(s, claudeLike);
  expect(hookedRow.badge === 'idle' && hookedRow.dot && hookedRow.age !== null, 'the row shows idle with the asterisk and an age once Claude has reported');
  expect(noState(await rowOf(s, plain)), 'the control row still shows no state');
  const bound = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === claudeLike);
  expect(bound.claudeSessionId === 'sim-claude-1', 'claudeSessionId bound on SessionStart');

  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
  step(`working shown ${await waitTitle(s, p1.id, 'working', 'working title')} ms after the POST`);
  expect((await toneOf(s, p1.id)).includes('state-working'), 'working colour class');

  await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  step(`needs input shown ${await waitTitle(s, p1.id, 'needs input: permission', 'needs-input title')} ms after the POST`);
  // M9 fix 49: the window is never focused by the OS under the scripts, so
  // this prompt would have posted a real toast; under a private home with no
  // notify variable set the main process holds it in its log instead. The
  // done later in the run is inside the notifier's five-second repeat gate
  // for the session, so this is the one to read.
  if (process.env['EMERALD_HOME'] !== undefined) {
    const name = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === claudeLike)?.name;
    const held = `notification held under a private EMERALD_HOME: ${name}: needs input: permission`;
    const deadline = Date.now() + 3000;
    while (!s.logs.join('').includes(held) && Date.now() < deadline) await sleep(100);
    expect(s.logs.join('').includes(held), `the toast was held in the main log: ${held}`);
    step('no toast from the private home: the notification is a log line naming the session');
  } else {
    step('real EMERALD_HOME: the prompt posted a toast, nothing to read');
  }
  expect((await toneOf(s, p1.id)).includes('state-needs-input'), 'needs-input colour class');
  // The reason is on the state word's card (M73 task 4), where the
  // tooltip used to carry it; the word itself has no title attribute.
  const stateSel = `[data-pane-id=${JSON.stringify(p1.id)}] .pane-state`;
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(stateSel)}).getAttribute('title')`)) === null, 'the state word carries no tooltip');
  // Since M9 fix 689 a Claude pane's title carries the chat button, and at
  // the harness's 339 px pane the squeeze reaches level 5, where the state
  // word is display: none; the hover reads at a 1500 px viewport and the
  // override is cleared after.
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 0, mobile: false });
  await s.waitFor(`(document.querySelector(${JSON.stringify(stateSel)})?.getBoundingClientRect().width ?? 0) > 0`, 'the state word shows at 1500 px', 5000);
  const stateAt = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(stateSel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: stateAt.x, y: stateAt.y });
  const stateCardSel = `.turn-popover [data-part="state"] .turn-card-text`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(stateCardSel)})`, 'the state word opens its card on hover', 3000);
  const reason = await s.evalJs(`document.querySelector(${JSON.stringify(stateCardSel)}).textContent`);
  expect(reason.includes('permission'), `the card explains the reason, got ${JSON.stringify(reason)}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.turn-popover')`, 'Escape closes the card');
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
  await s.send('Emulation.clearDeviceMetricsOverride', {});

  await post({ hook_event_name: 'Notification', notification_type: 'agent_needs_input' });
  await waitTitle(s, p1.id, 'needs input: a question', 'question title (the reason in words, M9 fix 123)');
  await post({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  await waitTitle(s, p1.id, 'working', 'working again after the prompt was answered');

  // A nested claude -p inside the session must not change anything.
  await post({ hook_event_name: 'Stop', session_id: 'nested-claude-p' });
  await sleep(300);
  expect((await titleOf(s, p1.id)) === 'working', 'foreign session_id ignored');
  await post({ hook_event_name: 'Stop', agent_id: 'agent-123' });
  await sleep(300);
  expect((await titleOf(s, p1.id)) === 'working', 'subagent Stop ignored');
  step('foreign and subagent events left the title alone');

  await post({ hook_event_name: 'Stop' });
  await waitTitle(s, p1.id, 'done', 'done title');
  // Pane 2 is focused, so done must stick.
  await sleep(1000);
  expect((await titleOf(s, p1.id)) === 'done', 'done sticks while the pane is not focused');
  await s.screenshot('m3-title-done.png');
  // Focus is emulated by the launcher (M9 fix 48), so no bringToFront.
  await clickPane(s, p1.id);
  const hasFocus = await s.evalJs('document.hasFocus()');
  step(`clicked pane 1 (document.hasFocus() = ${hasFocus})`);
  step(`ack: idle shown ${await waitTitle(s, p1.id, 'idle', 'idle after ack', 3000)} ms after the click`);
  expect((await getLayout(s)).focusedPaneId === p1.id, 'pane 1 focused');

  // A turn that finishes while the pane is focused is acked straight away.
  await post({ hook_event_name: 'UserPromptSubmit' });
  await waitTitle(s, p1.id, 'working', 'working before immediate ack');
  await post({ hook_event_name: 'Stop' });
  await waitTitle(s, p1.id, 'idle', 'focused pane acks done immediately');
  step('done on the focused pane went straight to idle');

  await post({ hook_event_name: 'UserPromptSubmit' });
  await post({ hook_event_name: 'StopFailure', error_type: 'rate_limit' });
  await waitTitle(s, p1.id, 'errored: rate_limit', 'errored title');
  await post({ hook_event_name: 'CwdChanged', cwd: 'C:/sim/sub', previous_cwd: 'C:/sim' });
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p1.id)}] .pane-cwd')?.textContent === 'C:/sim/sub'`, 'cwd in the title');
  expect((await titleOf(s, p1.id)) === 'errored: rate_limit', 'CwdChanged left the state alone');
  step(`errored with type and live cwd ${await cwdOf(s, p1.id)} shown`);

  const control = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === plain);
  expect(control.state === 'idle' && control.lastEventAt === null && control.claudeSessionId === null, 'the plain shell never heard a hook');
  expect((await titleOf(s, p2.id)) === null && noState(await rowOf(s, plain)), 'control pane and row still show no state');
  const lines = fs.readFileSync(path.join(emeraldHome, 'logs', 'hooks.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const mine = lines.filter((l) => l.sessionId === claudeLike);
  expect(mine.length === 13, `13 events for the session in hooks.jsonl, got ${mine.length}`);
  expect(mine.filter((l) => l.outcome === 'ignored-foreign').length === 1 && mine.filter((l) => l.outcome === 'ignored-agent').length === 1, 'outcomes recorded');
  expect(lines.every((l) => l.sessionId !== plain), 'nothing in hooks.jsonl for the control shell');
  await s.screenshot('m3-title-final.png');
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m3-title-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
