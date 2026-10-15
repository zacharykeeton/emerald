// M14 acceptance: attention. A session that goes to needs-input, done or
// errored pulses in the sidebar and in its pane title until a click or a
// key in the window, and chimes once and then every four seconds while the
// setting says repeat; the footer button cycles the setting through
// repeat, once and off, and a press on it is not an acknowledge.
// Task 3: an arrival asks the main process for a system notification, which
// the script sees as a JSON line in EMERALD_NOTIFY_LOG (with
// EMERALD_NOTIFY_ALWAYS, since the window under test has the focus and would
// otherwise post nothing): one per session per five seconds; Mark unread
// on the row menu pulses again with no chime and no line; Notifications
// off from the speaker button's right-click menu writes nothing.
// The fake Claude lives in pane 2 with pane 1 focused, so its Stops land
// in a pane that is on screen and not focused. The chime is counted by
// wrapping OscillatorNode.prototype.start in the page: two tones per chime.
// M30: a Stop with a running entry in background_tasks is waiting, with no
// pulse and no chime, a task notification prompt leaves the row's prompt
// alone, and the next Stop with an empty list is done as before.
// M9 fix 30: a Stop into the focused pane pulses and chimes like any other
// unless a key or click landed in the last ten seconds, in which case the
// pane acks it at once, the M31 case of a reply someone is sitting at.
// M9 fix 42: a layout tab pulses for a session in one of its panes, the
// hidden tab and the one on show alike.
// M9 fix 41: a PermissionRequest after a done nobody has clicked away
// chimes again, with and without a click between.
// M9 fix 47: the chime is muted under a private EMERALD_HOME (the tones are
// still started, at zero gain, so the counts hold) and the speaker button
// says so.
// M9 fix 189: the acknowledge is per session. A mousedown on a pane or a
// row acks that session alone and hushes the others' chimes, their pulses
// staying; a key acks the focused pane's; a click on a layout tab or a
// tab-switch key acks nothing and hushes every chime, so the pulse that
// pulled the eye to the tab still says which pane wanted someone.
// M9 fix 190: a hush button on a pulsing row stops its chime and keeps
// its pulse; a second session arriving chimes with the first still
// hushed; the row menu has the same item.
// M9 fix 201: Ctrl+Shift+A shows the session that has waited longest in
// the focused pane, a second press within four seconds the next, coming
// round at the end, acknowledging none of them; the picker opens on the
// waiting sessions in that order with the wait after the state word; and
// with nothing waiting the corner says so for a moment.
// M9 fix 701: a question into the focused pane a key after the last one
// comes with no chime, flash, toast or pulse, the badge still saying
// needs input; the same question after ten quiet seconds chimes, flashes,
// posts and pulses.
// M9 fix 702: zoomed on pane 1, a question in hidden pane 2 pulses the tab
// on show, and a click on the tab undoes the zoom with the focus kept;
// zoomed on pane 2 itself, the tab does not pulse and a click leaves it.
// Uses a private home and pipe unless the environment already names them,
// so it can run beside a live emerald. Starts from an empty layout.
// Run: npm run verify:attention -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm14-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m14';
const notifyLog = path.join(process.env['EMERALD_HOME'], 'notify.log');
fs.mkdirSync(process.env['EMERALD_HOME'], { recursive: true });
fs.rmSync(notifyLog, { force: true });
process.env['EMERALD_NOTIFY_LOG'] = notifyLog;
process.env['EMERALD_NOTIFY_ALWAYS'] = '1';
// M9 fix 232: the stall floor, in seconds, so the last step can read the
// alarm; the daemon checks every half floor. Twenty seconds clears the
// longest working stretch the earlier steps hold (the ten-second window
// of the fix 30 step), so nothing else in the run goes quiet.
const STALE_MS = 20_000;
process.env['EMERALD_STALE_AFTER_MS'] = String(STALE_MS);
const { CTRL, SHIFT, expect, freshPort, focusedPaneIs, getLayout, getTabs, killTree, launch, leaves, repoRoot, sleep, startSession, startShellByKey, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 320 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 320000);

const home = os.homedir();
const centerOf = (s, selector) =>
  s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

const s = await launch(freshPort(), { freshState: true });
app = s;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  let layout = await getLayout(s);
  const p1 = leaves(layout)[0].id;
  await startSession(s, { kind: 'shell', cwd: repoRoot });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell in pane 1');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'a second pane');
  layout = await getLayout(s);
  const p2 = leaves(layout)[1].id;
  await startSession(s, { kind: 'shell', cwd: home });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'shell in pane 2');
  const target = leaves(await getLayout(s)).find((p) => p.id === p2).sessionId;
  const front = leaves(await getLayout(s)).find((p) => p.id === p1).sessionId;
  // Back to pane 1 so the fake Claude in pane 2 is on screen but not focused.
  const c1 = await centerOf(s, `[data-pane-id=${JSON.stringify(p1)}] .term-host`);
  await s.click(c1.x, c1.y);
  await s.waitFor(focusedPaneIs(p1), 'pane 1 focused');
  step('two shells, pane 1 focused, pane 2 will be the fake Claude');

  // M9 fix 63: the focused ring is 3px, inset, and the other pane's is
  // the same width in transparent so nothing moves when focus does. The
  // ring reads on the pane's ::after (fix 19) and gets the pane's session
  // colour (fix 43). The flash that came with it is read at the end.
  const ringOf = (paneId) =>
    s.evalJs(`(() => { const st = getComputedStyle(document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]'), '::after'); return { width: st.borderTopWidth, color: st.borderTopColor, animation: st.animationName }; })()`);
  const focusedRing = await ringOf(p1);
  const otherRing = await ringOf(p2);
  expect(focusedRing.width === '3px' && focusedRing.color !== 'rgba(0, 0, 0, 0)', `the focused pane's ring is 3px in a colour, got ${JSON.stringify(focusedRing)}`);
  expect(otherRing.width === '3px' && otherRing.color === 'rgba(0, 0, 0, 0)', `the other pane's ring is 3px and transparent, got ${JSON.stringify(otherRing)}`);
  step('fix 63: a 3px ring on the focused pane, the same width in transparent on the other');

  await s.evalJs(
    `(() => { window.__starts = 0; const orig = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { window.__starts += 1; return orig.apply(this, a); }; })()`,
  );
  const chimes = () => s.evalJs(`window.__starts / 2`);
  const rowAttention = () => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.attention ?? null`);
  const titleAttention = () => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .pane-title')?.dataset.attention ?? null`);
  const waitAttention = (value, what) =>
    s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.attention === ${JSON.stringify(value)}`, what, 5000);
  const waitClear = (what) => s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.attention === undefined`, what, 5000);
  // A press on pane 2 acks the fake Claude there (fix 189: the press
  // names the session), then one on pane 1 acks the front session and
  // puts the focus back where the steps expect it.
  const c2 = await centerOf(s, `[data-pane-id=${JSON.stringify(p2)}] .term-host`);
  const acknowledge = async () => {
    await s.click(c2.x, c2.y);
    await s.waitFor(focusedPaneIs(p2), 'pane 2 focused for the ack');
    await s.click(c1.x, c1.y);
    await s.waitFor(focusedPaneIs(p1), 'pane 1 focused again');
  };
  const rowHushed = () => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.hushed ?? null`);
  const stateOf = async () => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target)?.state;
  const sound = () => s.evalJs(`document.querySelector('.attention-sound')?.dataset.sound ?? null`);
  const storedSound = () => s.evalJs(`JSON.parse(localStorage.getItem('emerald.attention') ?? 'null')?.sound ?? null`);
  const clickSound = async () => {
    const c = await centerOf(s, '.attention-sound');
    await s.click(c.x, c.y);
  };
  const notified = () => (fs.existsSync(notifyLog) ? fs.readFileSync(notifyLog, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) : []);
  const waitNotified = async (count, what) => {
    const until = Date.now() + 5000;
    while (notified().length < count && Date.now() < until) await sleep(100);
    expect(notified().length === count, `${what}: ${notified().length} notification lines, wanted ${count}`);
  };
  // The menus: a right click on the row or the speaker button, then the
  // item by its label (the text alone, since a hint may follow it).
  const pickMenu = async (menuClass, label) => {
    await s.waitFor(`!!document.querySelector('.${menuClass}')`, `${menuClass} open`);
    await s.evalJs(`[...document.querySelectorAll('.${menuClass} .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
    await s.waitFor(`!document.querySelector('.${menuClass}')`, `${menuClass} closed`);
  };

  const daemon = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const post = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': target },
      body: JSON.stringify({ session_id: 'sim-m14', cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };

  // A turn: working, then done. The row and the pane title pulse, the
  // chime plays at once and again four seconds later.
  expect((await sound()) === 'repeat', 'the chime setting starts at repeat');
  // M9 fix 47: this window runs on a private EMERALD_HOME with no
  // EMERALD_CHIME, so its chime is muted: the two tones are still started,
  // which is what the counts below see, into a gain of zero. The button
  // says so.
  const chimeNote = await s.evalJs(`(() => { const b = document.querySelector('.attention-sound'); return { chime: b?.dataset.chime ?? null, title: b?.title ?? '' }; })()`);
  expect(chimeNote.chime === 'muted' && chimeNote.title.includes('Muted and no notifications under a private EMERALD_HOME'), `the chime is muted under the private home and the tooltip says so, got ${JSON.stringify(chimeNote)}`);
  step('fix 47: the speaker button says the chime is muted under the private home');
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'do the thing' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'working');
  expect((await rowAttention()) === null, 'working wants no attention');
  expect((await chimes()) === 0, 'no chime yet');
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Done the thing.' });
  await waitAttention('done', 'the row pulses for done');
  expect((await titleAttention()) === 'done', 'the pane title pulses too');
  expect((await s.evalJs(`getComputedStyle(document.querySelector('.sidebar-row[data-attention]')).animationName`)) === 'attention-pulse', 'the pulse animation is on the row');
  // M31: the row, the title and the pane's ring pulse on one clock. The
  // animations are read, not watched, since a covered window draws no
  // frames; attention.ts starts each from the document's time zero.
  const pulse = await s.evalJs(`(() => {
    const row = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]');
    const title = document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .pane-title');
    const pane = document.querySelector('[data-pane-id=${JSON.stringify(p2)}]');
    const one = (el, pseudo) => ({ name: getComputedStyle(el, pseudo).animationName, starts: el.getAnimations({ subtree: !!pseudo }).filter((a) => (a.effect.pseudoElement ?? null) === (pseudo ?? null)).map((a) => a.startTime), to: getComputedStyle(el).getPropertyValue('--attention').trim() });
    // The pane's ring is on its ::after since M9 fix 19, so the header cannot cover it.
    return { row: one(row), title: one(title), pane: one(pane, '::before') };
  })()`);
  expect(pulse.row.name === 'attention-pulse' && pulse.title.name === 'attention-pulse', `the row and the title run the same animation, got ${JSON.stringify(pulse)}`);
  // M9 fix 206: the ring is one property of the wash's keyframes now, so
  // the pane's ::before runs attention-wash and the ring rides in it.
  expect(pulse.pane.name === 'attention-wash', `the pane runs the wash, the ring in it, got ${pulse.pane.name}`);
  expect(pulse.row.to === pulse.title.to && pulse.title.to === pulse.pane.to && pulse.row.to !== '', `one colour for all three, got ${JSON.stringify(pulse)}`);
  expect([...pulse.row.starts, ...pulse.title.starts, ...pulse.pane.starts].every((t) => t === 0), `every pulse starts from the document's time zero, got ${JSON.stringify(pulse)}`);
  expect((await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-state').textContent`)) === 'done', 'the badge still says done');
  expect((await chimes()) === 1, `one chime on arrival, got ${await chimes()}`);
  await waitNotified(1, 'the first done');
  expect(notified()[0].sessionId === target, 'the notification names the session');
  expect(notified()[0].body.startsWith('done'), `the body starts with the badge, got ${JSON.stringify(notified()[0].body)}`);
  expect(notified()[0].body.includes('Done the thing.'), 'the body carries the first line of the reply');
  await s.screenshot('m14-attention-done.png');
  await sleep(4300);
  expect((await chimes()) === 2, `a second chime four seconds later, got ${await chimes()}`);
  step('done: row and title pulse, chime on arrival and again after 4 s');

  // M9 fix 190: the row's hush button. A press on it is neither an ack
  // nor a hush of the rest: the row keeps pulsing, its chime stops, and
  // the button shows the hushed state. A second session arriving chimes
  // and repeats with the first still hushed; the front shell in pane 1
  // is that session for a moment.
  const hushSel = `.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-hush`;
  const hushButton = () => s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(hushSel)}); return b === null ? null : { hushed: b.dataset.hushed ?? null, title: b.title, action: b.dataset.action }; })()`);
  const hushBefore = await hushButton();
  expect(hushBefore !== null && hushBefore.hushed === null && hushBefore.action === 'hush' && hushBefore.title.startsWith('Hush the chime for this one'), `the pulsing row carries the hush button, got ${JSON.stringify(hushBefore)}`);
  expect((await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(front)}] .sidebar-row-hush')`)) === null, 'a quiet row has none');
  const hushCentre = await centerOf(s, hushSel);
  await s.click(hushCentre.x, hushCentre.y);
  await sleep(300);
  expect((await rowAttention()) === 'done', `the hush kept the pulse, got ${await rowAttention()}`);
  expect((await rowHushed()) === 'true', 'the row says hushed');
  expect((await hushButton())?.hushed === 'true', 'the button shows the hushed state');
  expect((await stateOf()) === 'done', 'the daemon still says done: the button is not an ack');
  const hushChimes = await chimes();
  await sleep(4500);
  expect((await chimes()) === hushChimes, `no chime while hushed, got ${(await chimes()) - hushChimes} more`);
  await s.screenshot('m14-attention-hushed.png');
  const postFrontEarly = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': front },
      body: JSON.stringify({ session_id: 'sim-m14-front', cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name} on the front session`);
  };
  await postFrontEarly({ hook_event_name: 'SessionStart', source: 'startup' });
  // M9 fix 701: the front session is pane 1's, the focused pane, so a
  // question within ten seconds of the last press into pane 1 would be
  // settled with no chime; this one is meant to arrive.
  await s.pastRecentInput();
  await postFrontEarly({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(front)}]')?.dataset.attention === 'needs-input'`, 'the front row pulses', 5000);
  expect((await chimes()) === hushChimes + 1, `the second session chimes on arrival, got ${(await chimes()) - hushChimes}`);
  expect((await rowHushed()) === 'true', 'the first is still hushed');
  await sleep(4300);
  expect((await chimes()) === hushChimes + 2, `and the repeat runs for it, got ${(await chimes()) - hushChimes}`);
  // A second press lets the chime through again: the repeat is already
  // running for the front session, so the count reads the same; the
  // state is what flips. Then hushed again by the row menu.
  // Read again: the rows may have reordered around the front's pulse.
  const hushCentre2 = await centerOf(s, hushSel);
  await s.click(hushCentre2.x, hushCentre2.y);
  await sleep(200);
  expect((await rowHushed()) === null && (await hushButton())?.hushed === null, `a second press unhushes, got ${await rowHushed()}`);
  await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-menu').click()`);
  await s.waitFor(`!!document.querySelector('.row-menu')`, 'row menu open');
  expect((await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Hush')?.disabled`)) === false, 'the row menu offers Hush on a pulsing row');
  await pickMenu('row-menu', 'Hush');
  await sleep(200);
  expect((await rowHushed()) === 'true', 'the menu item hushes');
  // The front session answered: its pulse goes with the state, and the
  // front pane is where the steps below click.
  await postFrontEarly({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'dir' } });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(front)}]')?.dataset.attention === undefined`, 'the front row stops pulsing once answered', 5000);
  step('fix 190: the hush button keeps the pulse and stops the chime, a second arrival chimes and repeats, a second press unhushes, the row menu hushes');

  // M9 fix 189: a mousedown on the (focused) pane 1 acks pane 1's own
  // session and no other. The fake Claude in pane 2 keeps pulsing, the
  // daemon still says done, and only its chime stops: the person is at
  // the keyboard, so the repeat is hushed for it. Before the fix the same
  // click emptied the whole set (the M14 rule).
  await s.click(c1.x, c1.y);
  await sleep(300);
  expect((await rowAttention()) === 'done', `a click in another pane leaves the pulse, got ${await rowAttention()}`);
  expect((await titleAttention()) === 'done', 'and the title still pulses');
  expect((await rowHushed()) === 'true', 'the row says its chime is hushed');
  expect((await stateOf()) === 'done', 'the daemon still says done: nothing acked it');
  const hushedAt = await chimes();
  await sleep(4500);
  expect((await chimes()) === hushedAt, `no chime while hushed, got ${await chimes()} not ${hushedAt}`);
  // A mousedown on pane 2 is the ack: the pulse stops, and since M31 the
  // daemon hears it too, so the row goes from done to idle with the reply
  // still on it.
  await s.click(c2.x, c2.y);
  await waitClear('the pulse cleared by a click on its pane');
  expect((await titleAttention()) === null, 'the title stopped too');
  expect((await rowHushed()) === null, 'the hush went with the pulse');
  // The click focused pane 2, whose ::after runs fix 63's flash for a
  // moment, so the read is that the attention ring is gone, not that
  // nothing runs.
  expect((await s.evalJs(`getComputedStyle(document.querySelector('[data-pane-id=${JSON.stringify(p2)}]'), '::before').animationName`)) !== 'attention-wash', 'the pane wash and ring stopped too');
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'idle'`, 'the click acked done to idle', 5000);
  expect((await stateOf()) === 'idle', 'the daemon says idle: the click is an ack');
  expect((await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-turn')?.textContent ?? ''`)).includes('Done the thing.'), 'the reply stays on the row');
  await s.click(c1.x, c1.y);
  await s.waitFor(focusedPaneIs(p1), 'pane 1 focused again');
  const after = await chimes();
  await sleep(4500);
  expect((await chimes()) === after, `no chime after the acknowledge, got ${await chimes()} not ${after}`);
  step('fix 189: a click in another pane leaves the pulse and hushes the chime; a click on its own pane acks it, done to idle');

  // A permission prompt raises it again; the speaker button does not
  // acknowledge and moves the setting to once.
  await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await waitAttention('needs-input', 'the row pulses for needs-input');
  expect((await chimes()) === after + 1, 'a chime for the permission prompt');
  await clickSound();
  await s.waitFor(`document.querySelector('.attention-sound')?.dataset.sound === 'once'`, 'setting once');
  expect((await storedSound()) === 'once', 'emerald.attention holds once');
  expect((await rowAttention()) === 'needs-input', 'the speaker button did not acknowledge');
  await sleep(4300);
  expect((await chimes()) === after + 1, `switching to once stopped the repeat, got ${await chimes()}`);
  step('needs-input raises it again; the speaker button cycles to once without acknowledging');

  // M9 fix 41: a question after a reply nobody has looked at chimes again.
  // The row is still pulsing for done when the PermissionRequest lands,
  // so the model already has the session; the change of state is what
  // counts. Still on once, so every arrival is one chime and no repeat.
  await acknowledge();
  await waitClear('acknowledged');
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'plan it' });
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Plan ready.' });
  await waitAttention('done', 'done with the plan');
  expect((await chimes()) === after + 2, `one chime for the plan's turn, got ${await chimes()}`);
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'ExitPlanMode', tool_input: {} });
  await waitAttention('needs-input', 'the row pulses for needs-input with no click between');
  expect((await chimes()) === after + 3, `a chime for the question after done, got ${await chimes()}`);
  expect((await titleAttention()) === 'needs-input', 'the title pulses in the new state');
  step('fix 41: done then a PermissionRequest with no click between chimes again, the row pulsing for needs-input');

  // M9 fix 104: the taskbar. Under this private home the main process
  // holds the flash and the badge to its log, one line per change, and
  // the lines say what the real taskbar would have done: the chime just
  // now came with a flash at one wanting, and the click below clears it.
  const taskbarLines = () => s.logs.join('').split('\n').filter((l) => l.includes('taskbar held under a private EMERALD_HOME'));
  // The line reaches the script over the app's stdout a moment after the
  // hook, so each read waits for it, briefly.
  const waitTaskbar = async (ending) => {
    for (let i = 0; i < 30 && taskbarLines().at(-1)?.endsWith(ending) !== true; i += 1) await sleep(100);
  };
  await waitTaskbar('1 wanting, flash');
  const taskbarBefore = taskbarLines().length;
  expect(taskbarLines().at(-1)?.endsWith('1 wanting, flash') === true, 'the taskbar held line reads one wanting with a flash, got ' + JSON.stringify(taskbarLines().at(-1)));

  // The same with a click between: the done is acked and the question
  // arrives on its own, as before the fix.
  await acknowledge();
  await waitClear('acknowledged');
  await waitTaskbar('cleared');
  expect(taskbarLines().length > taskbarBefore && taskbarLines().at(-1)?.endsWith('cleared') === true, 'the click wrote the taskbar cleared line, got ' + JSON.stringify(taskbarLines().slice(taskbarBefore)));
  step('fix 104: the taskbar flash and badge held to the log at one wanting, cleared by the click');
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'plan it again' });
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Plan ready again.' });
  await waitAttention('done', 'done again with the plan');
  expect((await chimes()) === after + 4, `one chime for that turn, got ${await chimes()}`);
  await acknowledge();
  await waitClear('the click cleared the done pulse');
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'idle'`, 'the click acked done to idle', 5000);
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'ExitPlanMode', tool_input: {} });
  await waitAttention('needs-input', 'the row pulses for needs-input after the click');
  expect((await chimes()) === after + 5, `a chime for the question after the click, got ${await chimes()}`);
  step('fix 41: the same with a click between chimes once for the reply and once for the question');
  // M9 fix 125: one taskbar line per arrival. The renderer used to tell
  // the main process twice within a millisecond, `1 wanting, no flash`
  // from the set growing and `1 wanting, flash` from the chime; the sends
  // are one per tick now. Two prompts in one turn, the first answered,
  // read three lines: the arrival, the clear, the second arrival, and no
  // `no flash` line among them.
  await post({ hook_event_name: 'PostToolUse', tool_name: 'ExitPlanMode', tool_input: {} });
  await waitClear('the answered question clears the pulse');
  await waitTaskbar('cleared');
  const base125 = taskbarLines().length;
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  await waitAttention('needs-input', 'the first prompt of the turn');
  await waitTaskbar('1 wanting, flash');
  await post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  await waitClear('the answered prompt clears the pulse');
  await waitTaskbar('cleared');
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'Edit', tool_input: { file_path: 'a.txt' } });
  await waitAttention('needs-input', 'the second prompt of the turn');
  await waitTaskbar('1 wanting, flash');
  await sleep(300);
  const lines125 = taskbarLines().slice(base125).map((l) => l.slice(l.indexOf('EMERALD_HOME: ') + 'EMERALD_HOME: '.length));
  expect(JSON.stringify(lines125) === JSON.stringify(['1 wanting, flash', 'cleared', '1 wanting, flash']), `one taskbar line per arrival and per clear, got ${JSON.stringify(lines125)}`);
  step('M9 fix 125: two permission prompts in one turn wrote one taskbar line each, with no no-flash line before either');
  const after41 = await chimes();

  // With once: a new turn ending chimes one time only.
  await acknowledge();
  await waitClear('acknowledged');
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'y' });
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Done again.' });
  await waitAttention('done', 'done again');
  expect((await chimes()) === after41 + 1, 'one chime for the new turn');
  await sleep(4300);
  expect((await chimes()) === after41 + 1, `no repeat with once, got ${await chimes()}`);
  step('once: a chime on arrival and no repeat');

  // With off: the pulse and no chime. Then the cycle comes back to repeat.
  await clickSound();
  await s.waitFor(`document.querySelector('.attention-sound')?.dataset.sound === 'off'`, 'setting off');
  expect((await storedSound()) === 'off', 'emerald.attention holds off');
  await acknowledge();
  await waitClear('acknowledged');
  await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Edit' });
  await waitAttention('needs-input', 'the row pulses with the chime off');
  expect((await chimes()) === after41 + 1, 'no chime with the setting off');
  // No chime, no flash: the badge alone (fix 104).
  await waitTaskbar('1 wanting, no flash');
  expect(taskbarLines().at(-1)?.endsWith('1 wanting, no flash') === true, 'the taskbar held line reads no flash with the sound off, got ' + JSON.stringify(taskbarLines().at(-1)));
  await clickSound();
  await s.waitFor(`document.querySelector('.attention-sound')?.dataset.sound === 'repeat'`, 'setting back to repeat');
  expect((await storedSound()) === 'repeat', 'emerald.attention holds repeat');
  expect((await rowAttention()) === 'needs-input', 'still pulsing');
  await s.screenshot('m14-attention-needs-input.png');
  // A key acks the focused pane's session, which is pane 1's: the fake
  // Claude in pane 2 keeps pulsing with its chime hushed (fix 189).
  await s.key('a', 'KeyA', 65);
  await sleep(300);
  expect((await rowAttention()) === 'needs-input', 'a key into pane 1 leaves the pulse on pane 2');
  expect((await rowHushed()) === 'true', 'and hushes its chime');
  await acknowledge();
  await waitClear('a click on its pane acknowledges');
  step('off: pulse without a chime; the button cycles back to repeat; a key acks the focused pane alone and hushes the rest');

  // Task 3. One notification per session per five seconds: a turn ending
  // writes a line, another ending within five seconds writes none.
  await sleep(5200);
  const lines0 = notified().length;
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'again' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'working');
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Third.' });
  await waitAttention('done', 'done for the third time');
  await waitNotified(lines0 + 1, 'a line for the turn');
  expect(notified()[lines0].body.includes('Third.'), 'the line carries this reply');
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'once more' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'working again');
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Fourth.' });
  await waitAttention('done', 'done for the fourth time');
  await sleep(500);
  expect(notified().length === lines0 + 1, `no line within five seconds of the last, got ${notified().length - lines0}`);
  step('a notification line per turn end, and none for another within five seconds');

  // Mark unread on the row menu: the pulse comes back with no chime and
  // no notification, and it stays through the next sessions push.
  await acknowledge();
  await waitClear('acknowledged');
  const chimes0 = await chimes();
  const row = await centerOf(s, `.sidebar-row[data-session-id=${JSON.stringify(target)}]`);
  await s.rightClick(row.x, row.y);
  await pickMenu('row-menu', 'Mark unread');
  await waitAttention('idle', 'marked unread pulses (idle since the click acked it)');
  expect((await titleAttention()) === 'idle', 'the pane title pulses too');
  expect((await rowHushed()) === null, 'a row marked unread is not hushed (fix 190)');
  await sleep(700);
  expect((await chimes()) === chimes0, `no chime for a mark, got ${(await chimes()) - chimes0}`);
  expect(notified().length === lines0 + 1, 'no notification line for a mark');
  // A right click is a mousedown and acknowledges, so the menu is opened
  // from the row's button with a scripted click to see the item while the
  // row still pulses.
  await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-menu').click()`);
  await s.waitFor(`!!document.querySelector('.row-menu')`, 'row menu open again');
  expect((await rowAttention()) === 'idle', 'still pulsing with the menu open');
  expect((await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Mark unread').disabled`)) === true, 'Mark unread is off while it pulses');
  await s.screenshot('m14-attention-unread.png');
  // Escape closes the menu; as a key it acks the focused pane's session,
  // pane 1's, and hushes this one (fix 189), whose pulse stays.
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.row-menu')`, 'row menu closed');
  await sleep(300);
  expect((await rowAttention()) === 'idle' && (await rowHushed()) === 'true', `Escape hushed the mark and left its pulse, got ${await rowAttention()} ${await rowHushed()}`);
  await acknowledge();
  await waitClear('acknowledged from its pane');
  step('Mark unread: the pulse is back, no chime, no line, and the item is off while pulsing');

  // Notifications off from the speaker button's right-click menu, which
  // does not acknowledge: the next arrival pulses and chimes and writes no
  // line.
  const notify = () => s.evalJs(`document.querySelector('.attention-sound')?.dataset.notify ?? null`);
  const storedNotify = () => s.evalJs(`JSON.parse(localStorage.getItem('emerald.attention') ?? 'null')?.notify ?? null`);
  expect((await notify()) === 'on', 'notifications start on');
  await s.rightClick(row.x, row.y);
  await pickMenu('row-menu', 'Mark unread');
  await waitAttention('idle', 'marked unread again');
  const speaker = await centerOf(s, '.attention-sound');
  await s.rightClick(speaker.x, speaker.y);
  await pickMenu('attention-menu', 'Notifications: on');
  await s.waitFor(`document.querySelector('.attention-sound')?.dataset.notify === 'off'`, 'notifications off');
  expect((await storedNotify()) === false, 'emerald.attention holds notify false');
  expect((await rowAttention()) === 'idle', 'the speaker menu did not acknowledge');
  expect((await sound()) === 'repeat', 'the sound setting is untouched');
  await acknowledge();
  await waitClear('acknowledged');
  await sleep(5200);
  await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await waitAttention('needs-input', 'needs-input pulses with notifications off');
  await sleep(500);
  expect(notified().length === lines0 + 1, `no line with notifications off, got ${notified().length - lines0 - 1} more`);
  await s.rightClick(speaker.x, speaker.y);
  await pickMenu('attention-menu', 'Chime once');
  await s.waitFor(`document.querySelector('.attention-sound')?.dataset.sound === 'once'`, 'the menu sets the sound too');
  expect((await storedNotify()) === false, 'the sound change kept notify false');
  step('Notifications off from the speaker menu: no line for the next arrival; the menu sets the sound too');

  // M30. A Stop with a running background task is waiting, not done: the
  // badge and the pane title say so in the working colour, and nothing
  // pulses or chimes. The task notification Claude Code then submits is
  // not the row's prompt. The next Stop with nothing running is done and
  // raises both.
  await acknowledge();
  await waitClear('acknowledged');
  const badge = () => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-state').textContent`);
  const promptText = () => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-prompt')?.textContent ?? null`);
  const replyText = () => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-agent')?.textContent ?? null`);
  const paneState = () => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .pane-state')?.textContent ?? null`);
  const chimes1 = await chimes();
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'build the eight' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'working');
  await post({
    hook_event_name: 'Stop',
    last_assistant_message: 'Agent 5 is done, waiting on agents 1 to 4.',
    background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: 'Verify the history panel' }],
  });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'waiting'`, 'waiting');
  expect((await stateOf()) === 'waiting', 'the daemon says waiting');
  // M9 fix 52: the badge carries the count and the tooltips the tasks.
  expect((await badge()) === 'waiting (1)', `the badge says waiting (1), got ${JSON.stringify(await badge())}`);
  expect((await paneState()) === 'waiting (1)', `the pane title says waiting (1), got ${JSON.stringify(await paneState())}`);
  const badgeTitle = () => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-state').title`);
  const waitingTip = ['1 subagent still running. Claude carries on when one finishes.', 'Verify the history panel'].join('\n');
  expect((await badgeTitle()) === waitingTip, `the row's tooltip lists the task, got ${JSON.stringify(await badgeTitle())}`);
  // The pane title's state word says the same on its card (M73 task 4),
  // opened by a hover, and carries no tooltip of its own: paneTitle
  // hovers the word, reads the card's state line and closes it.
  const paneStateSel = `[data-pane-id=${JSON.stringify(p2)}] .pane-state`;
  const stateTextSel = `.turn-popover[data-session-id=${JSON.stringify(target)}] [data-part="state"] .turn-card-text`;
  const paneTitle = async () => {
    const stateAt = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(paneStateSel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: stateAt.x, y: stateAt.y });
    await s.waitFor(`!!document.querySelector(${JSON.stringify(stateTextSel)})`, 'the state word opens its card on hover', 3000);
    const text = await s.evalJs(`document.querySelector(${JSON.stringify(stateTextSel)}).textContent`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.turn-popover')`, 'Escape closes the card');
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    return text;
  };
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(paneStateSel)}).getAttribute('title')`)) === null, 'the pane state word carries no tooltip');
  const paneTip = await paneTitle();
  expect(paneTip === waitingTip, `and so does the pane title's card, got ${JSON.stringify(paneTip)}`);
  expect((await s.evalJs(`getComputedStyle(document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-state')).fontStyle`)) === 'normal', 'waiting is not italic like stale');
  expect((await replyText()) === 'Agent 5 is done, waiting on agents 1 to 4.', `the reply is taken, got ${JSON.stringify(await replyText())}`);
  await sleep(700);
  expect((await rowAttention()) === null, 'waiting raises no attention on the row');
  expect((await titleAttention()) === null, 'nor on the pane title');
  expect((await chimes()) === chimes1, `no chime for waiting, got ${(await chimes()) - chimes1}`);
  await s.screenshot('m14-attention-waiting.png');
  step('a Stop with a running background task: waiting on the row and the title, no pulse, no chime');

  await post({
    hook_event_name: 'UserPromptSubmit',
    prompt: '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<summary>Agent 1 finished</summary>\n</task-notification>',
  });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'working after the task notification');
  // While the turn runs the third line shows the terminal title (M33), so
  // the fields are read from the daemon here and from the row after Stop.
  const afterNotice = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(afterNotice.lastPrompt === 'build the eight', `the session keeps the prompt the person typed, got ${JSON.stringify(afterNotice.lastPrompt)}`);
  expect(afterNotice.lastReply === null, 'the reply is cleared for the turn under way');
  step('a task notification is not the prompt: the session keeps what was asked');

  await post({ hook_event_name: 'Stop', last_assistant_message: 'All four are in.', background_tasks: [] });
  await waitAttention('done', 'a Stop with nothing running is done and pulses');
  expect((await titleAttention()) === 'done', 'the pane title pulses too');
  expect((await chimes()) === chimes1 + 1, `one chime for the real finish, got ${(await chimes()) - chimes1}`);
  expect((await replyText()) === 'All four are in.', 'the reply is the finish');
  expect((await promptText()) === 'build the eight', 'and the prompt is still the ask');
  expect((await badge()) === 'done' && (await badgeTitle()) === 'Claude finished a turn and nobody has looked yet.', `the badge and its tooltip are done's, got ${JSON.stringify(await badgeTitle())}`);
  expect((await paneTitle()) === 'Claude finished a turn and nobody has looked yet.', 'the pane title tooltip too');
  step('the next Stop with an empty list is done: pulse and chime as before, the tasks gone from the tooltips');

  // M9 fix 30. The shell in the focused pane 1 becomes a second fake
  // Claude. A Stop into the focused pane used to be acked at once by the
  // pane (M1), so it never pulsed or chimed. Now, ten seconds after the
  // last key or click, it pulses and chimes like the ones into pane 2 and
  // the badge holds at done until a mousedown; a Stop within ten seconds
  // of a key is acked by the pane at once, the M31 case of a reply someone
  // is sitting in front of. The key is typed into the shell, which is the
  // real path: a keydown into xterm reaches the window listener first.
  const postFront = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': front },
      body: JSON.stringify({ session_id: 'sim-m14-front', cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name} on the front session`);
  };
  const frontRow = `.sidebar-row[data-session-id=${JSON.stringify(front)}]`;
  const frontAttention = () => s.evalJs(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.attention ?? null`);
  const frontState = async () => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === front)?.state;
  await acknowledge();
  await waitClear('acknowledged');
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.state !== 'done'`, 'nothing pending on the front row');
  expect((await getLayout(s)).focusedPaneId === p1, 'pane 1 is the focused pane');
  expect((await s.evalJs('document.hasFocus()')) === true, 'the window has focus');
  await postFront({ hook_event_name: 'SessionStart', source: 'startup' });
  await postFront({ hook_event_name: 'UserPromptSubmit', prompt: 'reply into the front pane' });
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.state === 'working'`, 'the front session is working');
  const chimes2 = await chimes();
  // Past the ten-second window with no key or click.
  await sleep(10500);
  await postFront({ hook_event_name: 'Stop', last_assistant_message: 'Into the front.' });
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.attention === 'done'`, 'the front row pulses for done', 5000);
  await sleep(1500);
  expect((await frontAttention()) === 'done', 'the pulse holds with no gesture');
  expect((await frontState()) === 'done', 'the daemon still says done: the pane did not ack it');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(p1)}] .pane-title`)})?.dataset.attention ?? null`)) === 'done', 'the focused pane title pulses too');
  expect((await chimes()) === chimes2 + 1, `one chime for the reply into the focused pane, got ${(await chimes()) - chimes2}`);
  await s.screenshot('m14-attention-front.png');
  await acknowledge();
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.attention === undefined`, 'the click clears the pulse', 5000);
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.state === 'idle'`, 'and acks done to idle', 5000);
  step('a Stop into the focused pane ten seconds after the last input pulses, chimes and holds at done until a click');

  // The M31 case: a key, then the reply within ten seconds. The pane acks
  // it as soon as it lands, so the daemon goes done to idle with no gesture
  // after the key, and the row does not stay pulsing.
  await postFront({ hook_event_name: 'UserPromptSubmit', prompt: 'a quick one' });
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.state === 'working'`, 'working again');
  await s.key('a', 'KeyA', 65);
  await sleep(300);
  await postFront({ hook_event_name: 'Stop', last_assistant_message: 'Quick.' });
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.state === 'idle'`, 'the pane acked it: idle with no click', 5000);
  expect((await frontState()) === 'idle', 'the daemon says idle');
  await sleep(300);
  expect((await frontAttention()) === null, 'no pulse left on the row');
  step('a Stop into the focused pane within ten seconds of a key is acked at once, the M31 case');

  // M9 fix 42: a layout tab pulses with the rows of its sessions. A shell
  // in a second tab goes needs-input while the first tab is on show: the
  // hidden tab carries the state with the pulse as its animation; a click
  // clears it; then the front session does the same to the tab on show.
  const tabAttention = (tabId) => s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(tabId)}]')?.dataset.attention ?? null`);
  const tabAnimation = (tabId) => s.evalJs(`getComputedStyle(document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(tabId)}]')).animationName`);
  const firstTabId = (await getTabs(s)).currentTabId;
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2`, 'a second layout tab');
  const secondTabId = (await getTabs(s)).tabs.find((t) => t.id !== firstTabId).id;
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'the new tab on show');
  await startShellByKey(s);
  const known = new Set([target, front]);
  const other = (await zreq(s, 'session.list', {})).sessions.find((x) => !known.has(x.id)).id;
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(firstTabId)}`, 'back on the first tab');
  await acknowledge();
  await sleep(200);
  expect((await tabAttention(firstTabId)) === null && (await tabAttention(secondTabId)) === null, 'no tab pulses to start');
  const postOther = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': other },
      body: JSON.stringify({ session_id: 'sim-m14-other', cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name} on the other tab's session`);
  };
  await postOther({ hook_event_name: 'SessionStart', source: 'startup' });
  await postOther({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]')?.dataset.attention === 'needs-input'`, 'the hidden tab carries needs-input', 5000);
  expect((await tabAnimation(secondTabId)) === 'attention-pulse', `the hidden tab pulses, got ${await tabAnimation(secondTabId)}`);
  expect((await tabAttention(firstTabId)) === null, 'the tab on show does not, its sessions are quiet');
  expect((await tabAnimation(firstTabId)) === 'none', 'and has no animation');
  // M9 fix 189: a real click on the pulsing tab (a mousedown, unlike the
  // scripted clicks around it) switches to it and acks nothing: the tab's
  // own pulse drops because the tab on show never pulses (fix 69), the
  // row keeps pulsing so the eye can find the pane, and the chime is
  // hushed. A click on that pane is what acks it.
  const otherRow = `.sidebar-row[data-session-id=${JSON.stringify(other)}]`;
  const otherAttention = () => s.evalJs(`document.querySelector(${JSON.stringify(otherRow)})?.dataset.attention ?? null`);
  const otherHushed = () => s.evalJs(`document.querySelector(${JSON.stringify(otherRow)})?.dataset.hushed ?? null`);
  const chimesTab = await chimes();
  const secondTab = await centerOf(s, `.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]`);
  await s.click(secondTab.x, secondTab.y);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'the click switched to the second tab');
  await sleep(300);
  expect((await tabAttention(secondTabId)) === null, 'the tab on show does not pulse for its own session');
  expect((await otherAttention()) === 'needs-input', `the row still pulses after the tab click, got ${await otherAttention()}`);
  expect((await otherHushed()) === 'true', 'with its chime hushed');
  await sleep(4500);
  expect((await chimes()) === chimesTab, `no chime after the tab click, got ${(await chimes()) - chimesTab} more`);
  const otherPane = leaves(await getLayout(s)).find((p) => p.sessionId === other).id;
  const otherCentre = await centerOf(s, `[data-pane-id=${JSON.stringify(otherPane)}] .term-host`);
  await s.click(otherCentre.x, otherCentre.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(otherRow)})?.dataset.attention === undefined`, 'a click on the pane acks it', 5000);
  expect((await otherHushed()) === null, 'the hush went with the pulse');
  // The same by the sidebar row: raised again, a click on its row acks
  // it (and shows it, which is where the eye went).
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(firstTabId)}`, 'back on the first tab');
  await postOther({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  await s.waitFor(`document.querySelector(${JSON.stringify(otherRow)})?.dataset.state === 'working'`, 'the other session works again', 5000);
  await postOther({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  await s.waitFor(`document.querySelector(${JSON.stringify(otherRow)})?.dataset.attention === 'needs-input'`, 'the other row pulses again', 5000);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]')?.dataset.attention === 'needs-input'`, 'and its hidden tab', 5000);
  // On the name: the row's centre can be the needs-input badge, whose
  // click opens the answer card instead (M55).
  const otherRowCentre = await centerOf(s, `${otherRow} .sidebar-row-name`);
  await s.click(otherRowCentre.x, otherRowCentre.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(otherRow)})?.dataset.attention === undefined`, 'a click on the row acks it', 5000);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(secondTabId)}`, 'and shows it, on the second tab');
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]')?.dataset.attention === undefined`, 'the tab is quiet', 5000);
  expect((await tabAnimation(secondTabId)) === 'none', 'the pulse is gone from the tab');
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-current]')?.dataset.tabId === ${JSON.stringify(firstTabId)}`, 'back on the first tab again');
  await s.click(c1.x, c1.y);
  await s.waitFor(focusedPaneIs(p1), 'pane 1 focused');
  // M9 fix 69: one pulse per place. The front session goes needs-input
  // with its pane on the tab on show: the pane title pulses and the tab
  // does not (its mark keeps the idle tone); switch away and the tab
  // pulses for it; switch back and it stops. Past the ten seconds of the
  // click on pane 1 first, or fix 701 settles the question as answered.
  await s.pastRecentInput();
  await postFront({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.attention === 'needs-input'`, 'the front row pulses', 5000);
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-title')?.dataset.attention === 'needs-input'`, 'the pane title on show pulses', 5000);
  await sleep(200);
  expect((await tabAttention(firstTabId)) === null, 'the tab on show does not pulse for its own session, its pane title does (fix 69)');
  expect((await tabAnimation(firstTabId)) === 'none', 'and has no animation');
  const tabTone = (tabId) => s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(tabId)}] .tab-mark')?.dataset.tone ?? null`);
  expect((await tabTone(firstTabId)) === 'idle', `the tab on show keeps its idle tone, got ${await tabTone(firstTabId)}`);
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}]')?.dataset.attention === 'needs-input'`, 'the first tab pulses once its pane is off show', 5000);
  expect((await tabAnimation(firstTabId)) === 'attention-pulse', 'with the pulse as its animation');
  expect((await tabTone(firstTabId)) === 'needs-input', 'and its mark in the attention tone');
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}]').click()`);
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}]')?.dataset.attention === undefined`, 'back on show, the tab stops', 5000);
  expect((await frontAttention()) === 'needs-input', 'the row still pulses');
  step('fix 42, 69 and 189: a hidden layout tab pulses for a session in it, a click on the tab keeps the row pulsing and hushes it, a click on the pane or the row acks it, the tab on show never pulses for its own');

  // M9 fix 69 on the sidebar side: with the front row's group open the
  // heading has no pulse while the row has; fold the group and the
  // heading pulses in the row's place; unfold and it stops, the row still
  // pulsing. The fold chevron is fix 64's; its state is per group key.
  // The group is found by its key, since a folded group renders no rows.
  const frontGroupKey = await s.evalJs(`document.querySelector(${JSON.stringify(frontRow)}).closest('.sidebar-group').dataset.group`);
  const frontGroup = `.sidebar-group[data-group=${JSON.stringify(frontGroupKey)}]`;
  const headingAttention = () => s.evalJs(`document.querySelector(${JSON.stringify(frontGroup + ' .sidebar-group-title')})?.dataset.attention ?? null`);
  const headingAnimation = () => s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(frontGroup + ' .sidebar-group-title')})).animationName`);
  expect((await headingAttention()) === null, "the open group's heading does not pulse while its row does");
  expect((await headingAnimation()) === 'none', 'and has no animation');
  await s.evalJs(`document.querySelector(${JSON.stringify(frontGroup + ' .sidebar-group-fold')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(frontGroup)})?.dataset.folded === 'true'`, 'the group folds', 5000);
  await s.waitFor(`document.querySelector(${JSON.stringify(frontGroup + ' .sidebar-group-title')})?.dataset.attention === 'needs-input'`, "the folded heading pulses in the row's place", 5000);
  expect((await headingAnimation()) === 'attention-pulse', `with the pulse as its animation, got ${await headingAnimation()}`);
  await s.evalJs(`document.querySelector(${JSON.stringify(frontGroup + ' .sidebar-group-fold')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(frontGroup)})?.dataset.folded === undefined`, 'the group unfolds', 5000);
  await s.waitFor(`document.querySelector(${JSON.stringify(frontGroup + ' .sidebar-group-title')})?.dataset.attention === undefined`, 'the heading stops', 5000);
  expect((await frontAttention()) === 'needs-input', 'and the row still pulses');
  await acknowledge();
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.attention === undefined`, 'cleared by the click', 5000);
  step('fix 69: the heading pulses only while its group is folded, the row while it is on view');

  // M39: one heartbeat. With the other tab's session pulsing again and the
  // target working, every animation under the rows, the pane titles and
  // the tabs, subtrees included (the mark's step on its frames (M46), the
  // sheen on the line, the needs-pulse on a mark, the attention pulse on
  // the surfaces), starts from the document's time zero.
  await postOther({ hook_event_name: 'UserPromptSubmit', prompt: 'again' });
  await postOther({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  await s.waitFor(`document.querySelector('.tab.tab-panes[data-tab-id=${JSON.stringify(secondTabId)}]')?.dataset.attention === 'needs-input'`, 'the hidden tab pulses again', 5000);
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'keep going' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.working === 'pulse'`, 'the target works', 5000);
  await sleep(300);
  const beat = await s.evalJs(`(() => {
    const out = [];
    for (const el of document.querySelectorAll('.sidebar-row, .pane-title, .tab-panes')) {
      for (const a of el.getAnimations({ subtree: true })) if (a instanceof CSSAnimation) out.push({ name: a.animationName, start: a.startTime, on: (a.effect.target.className || '').toString().split(' ')[0] });
    }
    return out;
  })()`);
  const names = new Set(beat.map((a) => a.name));
  expect(['attention-pulse', 'session-mark-frame', 'turn-band', 'needs-pulse', 'live-dot'].every((n) => names.has(n)), `the pulse, the mark's step (M46), the sheen, the breathing and the marker's dot (M40) all run, got ${JSON.stringify([...names])}`);
  expect(beat.length >= 8 && beat.every((a) => a.start === 0), `every one of the ${beat.length} animations starts from the document's time zero, got ${JSON.stringify(beat.filter((a) => a.start !== 0))}`);
  await acknowledge();
  step(`M39: ${beat.length} animations under the rows, the titles and the tabs, subtrees included, all on one clock`);

  // The target works again for the meter below.
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'print a lot' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.working === 'pulse'`, 'the target works', 5000);
  const targetRowSel = `.sidebar-row[data-session-id=${JSON.stringify(target)}]`;
  // M41, M46: the rate reaches the mark's tooltip. The target shell
  // (working by posted hooks, so its mark is the asterisk) prints a
  // steady stream and the daemon pushes the bytes of each 250 ms window;
  // the row's and the title's marks step, carry no transition, and say
  // the rate in their title, which changes between two reads while the
  // stream runs. Once the stream ends (150 lines, a few seconds:
  // ForEach-Object adds its own time to each 20 ms sleep) the last push
  // is all zeros and the tooltip says 0 B/s within a couple of seconds.
  const markRate = (sel) =>
    s.evalJs(`(() => { const m = document.querySelector(${JSON.stringify(sel)}); if (!m) return null; const f = m.querySelector('.session-mark-frames').children[0]; return { working: m.dataset.working ?? null, animation: getComputedStyle(f).animationName, transitions: m.getAnimations({ subtree: true }).filter((a) => a instanceof CSSTransition).length, title: m.title }; })()`);
  const titleMarkSel = `[data-pane-id=${JSON.stringify(p2)}] .pane-mark`;
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(target)}, data: '1..150 | % { "line $_"; Start-Sleep -m 20 }' + String.fromCharCode(13) })`);
  await s.waitFor(`/output [1-9]/.test(document.querySelector(${JSON.stringify(targetRowSel + ' .session-mark')})?.title ?? '')`, "the row mark's tooltip gets a rate above zero", 10000);
  const first = await markRate(targetRowSel + ' .session-mark');
  let second = first;
  for (let i = 0; i < 10 && second.title === first.title; i++) {
    await sleep(300);
    second = await markRate(targetRowSel + ' .session-mark');
  }
  const liveTitle = await markRate(titleMarkSel);
  for (const [where, m] of [['row', first], ['row again', second], ['pane title', liveTitle]]) {
    expect(m !== null && m.working === 'true' && m.animation === 'session-mark-frame' && m.transitions === 0 && /, output \d+(\.\d+)? [KB]B?\/s$/.test(m.title), `the ${where}'s mark steps with no transition and says the rate, got ${JSON.stringify(m)}`);
  }
  expect(first.title !== second.title, `the rate in the tooltip moved between two reads, got ${first.title} then ${second.title}`);
  await s.waitFor(`/output 0 B\\/s$/.test(document.querySelector(${JSON.stringify(targetRowSel + ' .session-mark')})?.title ?? '')`, 'the tooltip settles at 0 B/s once the stream ends', 30000);
  step(`M41: the rate reaches the mark's tooltip (${first.title.replace(/^.*, /, '')} then ${second.title.replace(/^.*, /, '')}, title ${liveTitle.title.replace(/^.*, /, '')}) and settles at 0 B/s after the stream`);

  // M46: the shell mark on a plain shell holds one 20px slot in both
  // states. A shell spawned here sits at its prompt (no data-running, the
  // glyph dimmed); a command that prints for a while runs the mark
  // (data-running from the rate, the caret blinking) and the heading's
  // shells-running unit counts it, at the same width; once the output
  // ends the mark is still again.
  const { session: plain } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 });
  const plainMarkSel = `.sidebar-row[data-session-id=${JSON.stringify(plain.id)}] .sidebar-row-main .shell-mark`;
  const shellMark = () =>
    s.evalJs(`(() => { const m = document.querySelector(${JSON.stringify(plainMarkSel)}); if (!m) return null; const h = m.closest('.sidebar-group').querySelector('.sidebar-group-title'); return { width: m.getBoundingClientRect().width, running: m.dataset.running ?? null, first: m.parentElement.firstElementChild === m, glyphOpacity: getComputedStyle(m.querySelector('.shell-mark-glyph')).opacity, caret: getComputedStyle(m.querySelector('.shell-mark-caret')).animationName, caretHeight: m.querySelector('.shell-mark-caret').getBoundingClientRect().height, headingRunning: h.querySelector('.roster-unit[data-unit="shells-running"] .roster-count')?.textContent ?? null }; })()`);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(plainMarkSel)})`, 'the plain shell has its mark', 5000);
  // PowerShell prints its banner and prompt a second or two after it
  // starts, which runs the mark; wait for that burst to come and go, and
  // then for a quiet second and a half, before reading the prompt state.
  await s.waitFor(`!!document.querySelector(${JSON.stringify(plainMarkSel)})?.dataset.running`, 'the start-up burst runs the mark', 10000).catch(() => {});
  const quietFrom = Date.now();
  let quiet = 0;
  while (quiet < 1500 && Date.now() - quietFrom < 20000) {
    await sleep(250);
    quiet = (await shellMark()).running === null ? quiet + 250 : 0;
  }
  const atPrompt = await shellMark();
  expect(atPrompt !== null && atPrompt.first && atPrompt.width === 20 && atPrompt.running === null && atPrompt.glyphOpacity === '0.5' && atPrompt.caret === 'none' && atPrompt.caretHeight === 1.5, `at the prompt the shell mark is a still, dimmed 20px slot, got ${JSON.stringify(atPrompt)}`);
  await s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(plain.id)}, data: '1..120 | % { "line $_"; Start-Sleep -m 20 }' + String.fromCharCode(13) })`);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(plainMarkSel)})?.dataset.running`, 'the mark runs while the shell prints', 10000);
  const running = await shellMark();
  expect(running.width === 20 && running.running === 'true' && running.glyphOpacity === '1' && running.caret === 'shell-caret' && running.headingRunning !== null && Number(running.headingRunning) >= 1, `while running the slot is still 20px, the glyph full, the caret blinking and the heading counts a running shell, got ${JSON.stringify(running)}`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(plainMarkSel)})?.dataset.running`, 'still again once the output ends', 30000);
  expect((await shellMark()).width === 20, 'and the slot is 20px still');
  await zreq(s, 'session.kill', { sessionId: plain.id, remove: true });
  step('M46: the shell mark held its 20px slot at the prompt and while a command printed, the caret blinking only then');

  // M9 fix 63: focus landing on a pane flashes its ground once. The target
  // finishes its turn and wants attention; a click on its row acks that
  // (the mousedown, at once) and focuses its pane, which was not focused,
  // so the pane carries data-flash and its ::after runs focus-flash, on its
  // own clock and not the pulses' time zero (attention.ts leaves it be),
  // and a second later both are gone. The animation is read, not watched,
  // since a covered window draws no frames.
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Printed a lot.' });
  await waitAttention('done', 'the target wants attention again');
  expect((await getLayout(s)).focusedPaneId === p1, 'pane 1 is focused before the click');
  const rowCenter = await centerOf(s, targetRowSel);
  await s.click(rowCenter.x, rowCenter.y);
  const paneSel = `[data-pane-id=${JSON.stringify(p2)}]`;
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel)})?.hasAttribute('data-flash')`, 'the pane flashes on the click', 3000);
  const flash = await s.evalJs(`(() => {
    const pane = document.querySelector(${JSON.stringify(paneSel)});
    const anims = pane.getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation && a.animationName === 'focus-flash');
    return { name: getComputedStyle(pane, '::after').animationName, count: anims.length, starts: anims.map((a) => a.startTime), pseudo: anims.map((a) => a.effect.pseudoElement), attention: pane.querySelector('.pane-title')?.dataset.attention ?? null };
  })()`);
  expect(flash.name === 'focus-flash' && flash.count === 1 && flash.pseudo[0] === '::after', `the pane's ::after runs the flash, got ${JSON.stringify(flash)}`);
  expect(flash.starts[0] !== 0, `the flash runs from when focus landed, not the pulses' time zero, got ${JSON.stringify(flash)}`);
  expect(flash.attention === null, `the click acked the title's pulse, got ${JSON.stringify(flash)}`);
  await s.waitFor(focusedPaneIs(p2), 'the row click focused pane 2');
  await s.waitFor(`(() => { const pane = document.querySelector(${JSON.stringify(paneSel)}); return !pane.hasAttribute('data-flash') && getComputedStyle(pane, '::after').animationName === 'none'; })()`, 'the flash is over within a second', 2000);
  const ringAfter = await ringOf(p2);
  expect(ringAfter.width === '3px' && ringAfter.color !== 'rgba(0, 0, 0, 0)', `the ring stays on the pane after the flash, got ${JSON.stringify(ringAfter)}`);
  // Back to pane 1, which flashes in turn and settles, so the next read
  // on a fresh landing sees one animation and not a leftover.
  await s.click(c1.x, c1.y);
  await s.waitFor(focusedPaneIs(p1), 'pane 1 focused again');
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').hasAttribute('data-flash')`, 'pane 1 settled', 2000);
  step('fix 63: a click on a wanting row acks it, focuses its pane and flashes the pane once, over within a second, the 3px ring staying');

  // M9 fix 201: three sessions off screen ask a question at spaced times.
  // The jump key takes the focused pane to the oldest, then the next,
  // then the last, then round to the oldest, none of them acked by the
  // presses (a look-first key, like a tab switch); the picker lists them
  // first in that order with their wait; a press after the four-second
  // window starts again from the oldest; and once all three are working
  // again the corner note says nothing is waiting.
  const pulsingRows = () => s.evalJs(`[...document.querySelectorAll('.sidebar-row[data-attention]')].map((r) => r.dataset.sessionId)`);
  // A session an earlier step left pulsing (the fix 69 one on the second
  // tab) would come first in the order; the two in the panes are acked
  // by a click, anything else is removed.
  for (const id of await pulsingRows()) {
    if (id === target || id === front) {
      const c = id === target ? c2 : c1;
      await s.click(c.x, c.y);
    } else {
      await zreq(s, 'session.kill', { sessionId: id, remove: true });
    }
  }
  await s.click(c1.x, c1.y);
  await s.waitFor(focusedPaneIs(p1), 'pane 1 focused before the jump step');
  await s.waitFor(`document.querySelectorAll('.sidebar-row[data-attention]').length === 0`, 'nothing pulses before the jump step', 5000);
  const waiting = [];
  for (let i = 0; i < 3; i++) {
    const { session: w } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 });
    waiting.push(w.id);
  }
  const postOn = async (sessionId, payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ session_id: `sim-m14-${sessionId.slice(0, 8)}`, cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name} on ${sessionId.slice(0, 8)}`);
  };
  const rowOf = (id) => `.sidebar-row[data-session-id=${JSON.stringify(id)}]`;
  for (const id of waiting) {
    await postOn(id, { hook_event_name: 'SessionStart', source: 'startup' });
    await postOn(id, { hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    await s.waitFor(`document.querySelector(${JSON.stringify(rowOf(id))})?.dataset.attention === 'needs-input'`, `${id.slice(0, 8)} pulses for needs-input`, 5000);
    // Spaced so stateSince tells the three apart.
    await sleep(600);
  }
  const shownIn = async (paneId) => leaves(await getLayout(s)).find((p) => p.id === paneId)?.sessionId ?? null;
  const paneShows = async (id, what) => {
    const until = Date.now() + 5000;
    while ((await shownIn(p1)) !== id && Date.now() < until) await sleep(100);
    expect((await shownIn(p1)) === id, `${what}, got ${String(await shownIn(p1)).slice(0, 8)} wanted ${id.slice(0, 8)}`);
  };
  expect((await getLayout(s)).focusedPaneId === p1, 'pane 1 is focused before the jumps');
  // The picker first, since its keys (Ctrl+J, Escape) acknowledge the
  // focused pane's session, which is nobody's concern while pane 1 still
  // shows the front shell and would take a jumped-to session off the
  // list. The three come first, oldest first, each with its wait after
  // the state word.
  await s.key('j', 'KeyJ', 74, CTRL);
  await s.waitFor(`document.querySelectorAll('.picker-overlay .session-row').length >= 3`, 'the picker is open with rows');
  const pickerRows = await s.evalJs(`[...document.querySelectorAll('.picker-overlay .session-row')].map((r) => ({ id: r.dataset.sessionId, state: r.querySelector('.pane-state')?.textContent ?? null, wait: r.querySelector('.palette-wait')?.textContent.trim() ?? null }))`);
  expect(JSON.stringify(pickerRows.slice(0, 3).map((r) => r.id)) === JSON.stringify(waiting), `the picker lists the waiting three first in wait order, got ${JSON.stringify(pickerRows.map((r) => r.id.slice(0, 8)))}`);
  expect(pickerRows.slice(0, 3).every((r) => /^\d+s$/.test(r.wait ?? '') && r.state.startsWith('needs input') && r.state.endsWith(r.wait)), `each waiting row carries its wait after the state word, got ${JSON.stringify(pickerRows.slice(0, 3))}`);
  // The rows after the three are not read for their wait: the Mark unread
  // step left an idle session wanting, which carries one and is not in the
  // jump's order (idle is not one of the three states).
  const idleRow = pickerRows.slice(3).find((r) => r.wait === null);
  expect(idleRow !== undefined, 'a row that waits for nobody carries no wait');
  await s.key('Escape', 'Escape', 27, 0);
  await s.waitFor(`!document.querySelector('.picker-overlay')`, 'the picker closed');
  expect(JSON.stringify((await pulsingRows()).slice().sort()) === JSON.stringify(waiting.slice().sort()), 'the three still pulse after the picker');
  const jump = () => s.key('A', 'KeyA', 65, CTRL | SHIFT);
  await jump();
  await paneShows(waiting[0], 'the first press shows the oldest question in the focused pane');
  await jump();
  await paneShows(waiting[1], 'the second press shows the next');
  await jump();
  await paneShows(waiting[2], 'the third press shows the last');
  await jump();
  await paneShows(waiting[0], 'the fourth press comes round to the oldest');
  const stillPulsing = await pulsingRows();
  expect(waiting.every((id) => stillPulsing.includes(id)), `the presses acknowledged none of the three, got ${JSON.stringify(stillPulsing)}`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowOf(waiting[0]))})?.dataset.hushed ?? null`)) === 'true', 'and hushed their chimes, as a look-first key does');
  // After the window a press starts over from the longest wait: the pane
  // keeps the oldest rather than moving on to the next.
  await sleep(4200);
  await jump();
  await sleep(700);
  expect((await shownIn(p1)) === waiting[0], `a press after the four-second window starts from the oldest again, got ${String(await shownIn(p1)).slice(0, 8)}`);
  // Nothing waiting: the corner says so for a moment.
  for (const id of waiting) await postOn(id, { hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  await s.waitFor(`document.querySelectorAll('.sidebar-row[data-attention]').length === 0`, 'the three work again and nothing pulses', 5000);
  await jump();
  await s.waitFor(`document.querySelector('.corner-note')?.textContent === 'Nothing is waiting'`, 'the corner note says nothing is waiting', 2000);
  expect((await shownIn(p1)) === waiting[0], 'and the pane is left as it was');
  await s.waitFor(`!document.querySelector('.corner-note')`, 'the note is gone after a moment', 3500);
  for (const id of waiting) await zreq(s, 'session.kill', { sessionId: id, remove: true });
  // Pane 1 goes back to the front shell, the way the step found it: the
  // fix 206 step after this one splits pane 1 and starts a shell in the
  // fresh pane through the first empty pane on the page, which the pane
  // the removal emptied would be instead. The row is scrolled into view
  // first, since a centre measured past the sidebar's edge lands on
  // nothing (the fix 153 gotcha).
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .empty-pane') !== null`, 'pane 1 emptied by the removal', 5000);
  await s.evalJs(`document.querySelector(${JSON.stringify(`${rowOf(front)} .sidebar-row-name`)}).scrollIntoView({ block: 'nearest' })`);
  const frontRowName = await centerOf(s, `${rowOf(front)} .sidebar-row-name`);
  await s.click(frontRowName.x, frontRowName.y);
  await paneShows(front, 'the front shell is back in pane 1');
  step('fix 201: Ctrl+Shift+A walked the three waiting sessions oldest first and round, acking none; the picker listed them first with their waits; nothing waiting left a note in the corner');

  // M9 fix 206: a wanting pane's ::after runs attention-wash, the ground
  // and the ring in one set of keyframes, while its title carries
  // data-attention, and stops with the ack. The frame the user judges is
  // six panes with one wanting, frozen at the wash's peak: a covered
  // window draws no frames and an off-screen one runs them, so the
  // animations are paused at their `to` end by hand rather than caught
  // mid-swing. Under prefers-reduced-motion the wash is off and the
  // ring alone runs, as before this fix.
  const shownIds = async () => leaves(await getLayout(s)).map((p) => p.id);
  const paneCentre = async (paneId) => centerOf(s, `[data-pane-id=${JSON.stringify(paneId)}] .term-host`);
  // Split each of the two columns down and then each top pane right, so
  // the six are a grid and not a ladder; a split takes the focused pane,
  // the new pane takes focus and the shell lands in it. The centres are
  // read fresh each time, since every split moves the panes.
  const splits = [[p1, 'O'], [p2, 'O'], [p1, 'E'], [p2, 'E']];
  for (const [from, dir] of splits) {
    const before = await shownIds();
    const at = await paneCentre(from);
    await s.click(at.x, at.y);
    await s.waitFor(focusedPaneIs(from), `pane ${from} focused for the split`);
    await s.key(dir, `Key${dir}`, dir === 'O' ? 79 : 69, CTRL | SHIFT);
    const splitDeadline = Date.now() + 5000;
    while ((await shownIds()).length < before.length + 1 && Date.now() < splitDeadline) await sleep(100);
    const fresh = (await shownIds()).find((id) => !before.includes(id));
    expect(fresh !== undefined, `pane ${before.length + 1} split`);
    await startSession(s, { kind: 'shell', cwd: home });
    await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(fresh)}] .term-host')`, `shell in pane ${before.length + 1}`);
  }
  expect((await shownIds()).length === 6, `six panes on show, got ${(await shownIds()).length}`);
  const c1Now = await paneCentre(p1);
  const c2Now = await paneCentre(p2);
  await s.click(c1Now.x, c1Now.y);
  await s.waitFor(focusedPaneIs(p1), 'pane 1 focused among six');
  // Only the target may want attention in the frame; the front session's
  // pulse, if one is on, is acked by a click on its row's name.
  if ((await frontAttention()) !== null) {
    const frontName = await centerOf(s, `${frontRow} .sidebar-row-name`);
    await s.click(frontName.x, frontName.y);
    await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.attention === undefined`, 'the front row acked before the frame', 5000);
    await s.click(c1Now.x, c1Now.y);
    await s.waitFor(focusedPaneIs(p1), 'pane 1 focused again among six');
  }
  const ackSix = async () => {
    await s.click(c2Now.x, c2Now.y);
    await s.waitFor(focusedPaneIs(p2), 'pane 2 focused for the ack among six');
    await s.click(c1Now.x, c1Now.y);
    await s.waitFor(focusedPaneIs(p1), 'pane 1 focused again among six');
  };
  const washName = () => s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(paneSel)}), '::before').animationName`);
  // The click on pane 1 flashes it (fix 63); the frame waits for that to
  // fade so the one lit pane in it is the wanting one.
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').hasAttribute('data-flash')`, 'pane 1 settled before the frame', 2000);
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'one more' });
  await post({ hook_event_name: 'Stop', last_assistant_message: 'The wash.' });
  await waitAttention('done', 'the target wants attention among six panes');
  expect((await titleAttention()) === 'done', 'the title carries data-attention');
  expect((await washName()) === 'attention-wash', `the pane's ::before runs the wash, got ${await washName()}`);
  const washPeak = await s.evalJs(`(() => {
    const pane = document.querySelector(${JSON.stringify(paneSel)});
    const anims = pane.getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation && /^attention-/.test(a.animationName));
    for (const a of anims) { a.pause(); a.currentTime = 900; }
    for (const row of document.querySelectorAll('.sidebar-row[data-attention]')) for (const a of row.getAnimations({ subtree: true })) if (a instanceof CSSAnimation && a.animationName === 'attention-pulse') { a.pause(); a.currentTime = 900; }
    const st = getComputedStyle(pane, '::before');
    return { names: anims.map((a) => a.animationName), background: st.backgroundColor, shadow: st.boxShadow, opacity: st.opacity };
  })()`);
  expect(washPeak.names.includes('attention-wash') && washPeak.opacity === '1' && washPeak.background !== 'rgba(0, 0, 0, 0)' && !washPeak.shadow.includes('rgba(0, 0, 0, 0)'), `at the peak the ground has a colour and the ring is drawn, got ${JSON.stringify(washPeak)}`);
  await sleep(150);
  await s.screenshot('m9-fix206-wash.png');
  // Two more at the peaks the plan ruled out, for the look beside the one
  // shipped; --wash-peak is the keyframes' knob and the root's value wins.
  const grounds = [`20% ${washPeak.background}`];
  for (const peak of ['15%', '25%']) {
    await s.evalJs(`document.documentElement.style.setProperty('--wash-peak', ${JSON.stringify(peak)})`);
    await sleep(150);
    grounds.push(`${peak} ${await s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(paneSel)}), '::before').backgroundColor`)}`);
    await s.screenshot(`m9-fix206-wash-${peak.replace('%', '')}.png`);
  }
  await s.evalJs(`document.documentElement.style.removeProperty('--wash-peak')`);
  step(`M9 fix 206: the wash's ground at the peak, ${grounds.join(', ')}; frames m9-fix206-wash.png (20%, shipped), -15.png and -25.png`);
  await s.evalJs(`(() => { for (const el of document.querySelectorAll('.pane, .sidebar-row')) for (const a of el.getAnimations({ subtree: true })) if (a.playState === 'paused') a.play(); })()`);
  await ackSix();
  await waitClear('the ack clears the wash');
  await s.waitFor(`getComputedStyle(document.querySelector(${JSON.stringify(paneSel)}), '::before').animationName !== 'attention-wash'`, 'the wash is gone with the ack', 3000);
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'and again' });
  await post({ hook_event_name: 'Stop', last_assistant_message: 'No wash.' });
  await waitAttention('done', 'the target wants attention under reduced motion');
  expect((await washName()) === 'attention-ring', `under prefers-reduced-motion the ring alone runs, got ${await washName()}`);
  await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await s.waitFor(`getComputedStyle(document.querySelector(${JSON.stringify(paneSel)}), '::before').animationName === 'attention-wash'`, 'the wash is back with the preference', 3000);
  await s.send('Emulation.setEmulatedMedia', { features: [] });
  await ackSix();
  await waitClear('the ack clears it again');
  step('M9 fix 206: the wanting pane breathes over its ground with the ring in the same keyframes, stops with the ack, and is the ring alone under prefers-reduced-motion; the six-pane frame is m9-fix206-wash.png');

  // M9 fix 232: a working session that posts nothing for the stall floor
  // (EMERALD_STALE_AFTER_MS, twenty seconds here) is flagged quiet by the
  // daemon and joins the attention path as its own state: the row and
  // the title pulse in the muted tone (never the needs-input teal), the
  // badge reads `quiet 20s` in that tone with the threshold in its
  // tooltip, the old `!` is gone, the chime plays and a notification
  // line lands with the word, the hush button hushes it, and the next
  // hook clears the flag and the pulse together.
  const speakerNow = await centerOf(s, '.attention-sound');
  if ((await sound()) !== 'repeat') {
    await s.rightClick(speakerNow.x, speakerNow.y);
    await pickMenu('attention-menu', 'Chime until acknowledged');
    await s.waitFor(`document.querySelector('.attention-sound')?.dataset.sound === 'repeat'`, 'the chime set to repeat for the stall');
  }
  if ((await s.evalJs(`document.querySelector('.attention-sound')?.dataset.notify ?? null`)) !== 'on') {
    await s.rightClick(speakerNow.x, speakerNow.y);
    await pickMenu('attention-menu', 'Notifications: off');
    await s.waitFor(`document.querySelector('.attention-sound')?.dataset.notify === 'on'`, 'notifications on for the stall');
  }
  const badgeSel = `.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-state`;
  const tokenColor = (name) => s.evalJs(`(() => { const p = document.createElement('span'); p.style.color = 'var(' + ${JSON.stringify(name)} + ')'; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; })()`);
  const mutedColor = await tokenColor('--muted');
  const blockedColor = await tokenColor('--blocked');
  const chimesBefore = await chimes();
  const linesBefore = notified().length;
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'a long silent build' });
  await post({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'node -e "setTimeout(() => {}, 660000)"' } });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'working before the silence');
  expect((await rowAttention()) === null, 'a working session wants no attention yet');
  const quietAt = Date.now();
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.attention === 'quiet'`, 'the row pulses quiet after the floor', STALE_MS * 2);
  const quietAfter = Date.now() - quietAt;
  expect(quietAfter >= STALE_MS - 1000, `the flag came no sooner than the floor, ${quietAfter} ms`);
  expect((await titleAttention()) === 'quiet', `the pane title pulses quiet too, got ${await titleAttention()}`);
  const quietRow = await s.evalJs(`(() => {
    const row = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]');
    const badge = row.querySelector('.sidebar-row-state');
    return { text: badge.textContent, title: badge.title, color: getComputedStyle(badge).color, style: getComputedStyle(badge).fontStyle, attention: getComputedStyle(row).getPropertyValue('--attention').trim(), bang: row.querySelector('.sidebar-row-stale') !== null, working: row.hasAttribute('data-working'), state: row.dataset.state, hush: row.querySelector('.sidebar-row-hush') !== null };
  })()`);
  expect(/^quiet \d+s$/.test(quietRow.text), `the badge reads the word and the silence, got ${JSON.stringify(quietRow.text)}`);
  expect(quietRow.state === 'working', `the daemon's state is still working, got ${quietRow.state}`);
  expect(quietRow.color === mutedColor && quietRow.style === 'italic', `the word is in the muted tone, italic, got ${quietRow.color} ${quietRow.style} (muted ${mutedColor})`);
  expect(!quietRow.bang, 'the ! beside the name is gone: the word says it');
  expect(!quietRow.working, 'the working mark is still, as stale always was');
  expect(quietRow.hush, 'the pulsing row carries the hush button');
  expect(quietRow.title.includes('past the 20s floor') && quietRow.title.includes('nudge it or kill it'), `the tooltip names the threshold it tripped and what to do, got ${JSON.stringify(quietRow.title)}`);
  const rowPulseColor = await s.evalJs(`(() => { const p = document.createElement('span'); p.style.color = ${JSON.stringify(quietRow.attention)}; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; })()`);
  expect(rowPulseColor === mutedColor && rowPulseColor !== blockedColor, `the pulse is in the muted tone and not the teal, got ${quietRow.attention} (${rowPulseColor}), muted ${mutedColor}, blocked ${blockedColor}`);
  expect((await s.evalJs(`getComputedStyle(document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')).animationName`)) === 'attention-pulse', 'the pulse animation runs on the row');
  expect((await chimes()) === chimesBefore + 1, `the stall chimes on arrival, got ${(await chimes()) - chimesBefore}`);
  const untilLine = Date.now() + 5000;
  while (notified().length < linesBefore + 1 && Date.now() < untilLine) await sleep(100);
  const quietLine = notified()[linesBefore];
  expect(quietLine !== undefined && quietLine.sessionId === target && /^quiet \d+s$/.test(quietLine.body), `a notification line with the word, got ${JSON.stringify(quietLine)}`);
  const daemonSays = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === target);
  expect(daemonSays.stale === true && daemonSays.staleThresholdMs === STALE_MS, `the record carries the flag and the threshold, got ${daemonSays.stale} ${daemonSays.staleThresholdMs}`);
  await s.screenshot('m9-fix232-quiet.png');
  // The hush: the chime stops, the pulse stays.
  const hushQuiet = await centerOf(s, `.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-hush`);
  await s.click(hushQuiet.x, hushQuiet.y);
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.hushed === 'true'`, 'the stall is hushed', 3000);
  expect((await rowAttention()) === 'quiet', `the hush kept the pulse, got ${await rowAttention()}`);
  const hushedChimes = await chimes();
  await sleep(4500);
  expect((await chimes()) === hushedChimes, `no chime while hushed, got ${(await chimes()) - hushedChimes} more`);
  // The tool call ends: the hook clears the flag, and the pulse with it.
  await post({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'node -e "setTimeout(() => {}, 660000)"' }, tool_response: { stdout: '' } });
  await waitClear('the next hook clears the quiet pulse');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(badgeSel)}).textContent`)) === 'working', 'the badge is back to working');
  expect((await rowHushed()) === null, 'the hush went with the pulse');
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Built.' });
  await waitAttention('done', 'the turn ends as done');
  await ackSix();
  await waitClear('acked, the panes as the step found them');
  step(`M9 fix 232: quiet after ${quietAfter} ms on a ${STALE_MS} ms floor: the row and the title pulsed in the muted tone with the word, the tooltip named the floor, the chime and the notification line came, the hush held the pulse, and the next hook cleared it; frame m9-fix232-quiet.png`);

  // M9 fix 247, redrawn by fix 267: while the pane pulses for a
  // question, the wait is a big figure in the pane's top right corner,
  // `12s` at 48px with `waiting` under it, a second at a time off
  // stateSince in the pulse's tone, on no ground (each glyph carries a
  // halo in the terminal's scheme ground instead), with no pointer
  // events but the hush button's beside it; the row lays the same
  // figure over its right half at 36px with the hush at that scale and
  // its small age hidden under it. A finished reply reads `done`; the
  // acknowledge takes both away with the pulse. A working session shows
  // none. The digits are odometer slots (fix 235).
  const overlaySel = `[data-pane-id=${JSON.stringify(p2)}] .wait-overlay`;
  const ageSel = `.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-age`;
  const rowWaitSel = `.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-wait`;
  const overlayProbe = () =>
    s.evalJs(`(() => {
      const o = document.querySelector(${JSON.stringify(overlaySel)});
      const age = document.querySelector(${JSON.stringify(ageSel)});
      const rw = document.querySelector(${JSON.stringify(rowWaitSel)});
      const pane = document.querySelector('[data-pane-id=${JSON.stringify(p2)}]');
      const wrap = pane.querySelector('.term-wrap').getBoundingClientRect();
      const ageStyle = age === null ? null : getComputedStyle(age);
      const tone = pane === null ? '' : getComputedStyle(pane).getPropertyValue('--attention').trim();
      const paneBg = getComputedStyle(document.documentElement).getPropertyValue('--pane-bg').trim();
      const overlay = o === null ? null : (() => {
        const r = o.getBoundingClientRect();
        const cs = getComputedStyle(o);
        const fig = o.querySelector('.wait-overlay-figure');
        const fs = getComputedStyle(fig);
        const hush = o.querySelector('.sidebar-row-hush');
        return { text: o.textContent, word: o.dataset.word, figure: o.dataset.figure, color: cs.color, pointer: cs.pointerEvents, background: cs.backgroundColor, figureSize: fs.fontSize, wordSize: getComputedStyle(o.querySelector('.wait-overlay-word')).fontSize, paint: fs.paintOrder, stroke: fs.webkitTextStrokeWidth, strokeColor: fs.webkitTextStrokeColor, slots: fig.querySelectorAll('.figure-slot').length, hush: hush === null ? null : { pointer: getComputedStyle(hush).pointerEvents, height: hush.getBoundingClientRect().height, hushed: hush.dataset.hushed ?? null }, top: r.top - wrap.top, right: wrap.right - r.right, inside: r.left >= wrap.left && r.right <= wrap.right + 0.5 && r.top >= wrap.top };
      })();
      const rowWait = rw === null ? null : (() => {
        const row = rw.closest('.sidebar-row').getBoundingClientRect();
        const r = rw.getBoundingClientRect();
        const fig = rw.querySelector('.sidebar-row-wait-figure');
        const fs = getComputedStyle(fig);
        const hush = rw.querySelector('.sidebar-row-hush');
        return { text: fig.textContent, figure: rw.dataset.figure, word: rw.dataset.word, color: getComputedStyle(rw).color, figureSize: fs.fontSize, pointer: getComputedStyle(rw).pointerEvents, shadow: getComputedStyle(rw).textShadow, slots: fig.querySelectorAll('.figure-slot').length, rightHalf: r.left >= row.left + row.width * 0.4 && r.right <= row.right, hush: hush === null ? null : { height: hush.getBoundingClientRect().height, pointer: getComputedStyle(hush).pointerEvents } };
      })();
      return { overlay, rowWait, age: age === null ? null : { text: age.textContent, color: ageStyle.color, size: ageStyle.fontSize, visibility: ageStyle.visibility }, tone, paneBg, mainHush: document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}] .sidebar-row-main .sidebar-row-hush') !== null };
    })()`);
  const toneColor = (tone) => s.evalJs(`(() => { const p = document.createElement('span'); p.style.color = ${JSON.stringify(tone)}; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; })()`);
  await post({ hook_event_name: 'UserPromptSubmit', prompt: 'ask me something' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.state === 'working'`, 'working before the question');
  const workingOverlay = await overlayProbe();
  expect(workingOverlay.overlay === null && workingOverlay.rowWait === null && workingOverlay.age.color === mutedColor && workingOverlay.age.size === '13px' && workingOverlay.age.visibility === 'visible', `fix 247: a working pane has no counter, its row no figure, and the row's age is muted at 13px, got ${JSON.stringify(workingOverlay)}`);
  await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  await waitAttention('needs-input', 'the row pulses for the question');
  await s.waitFor(`document.querySelector(${JSON.stringify(overlaySel)})?.dataset.word === 'waiting'`, 'the counter is on the pane', 3000);
  const firstWait = await overlayProbe();
  expect(/^waiting \d+s$/.test(firstWait.overlay.text) && firstWait.overlay.word === 'waiting', `fix 247: the counter reads the word and the seconds, got ${JSON.stringify(firstWait.overlay)}`);
  expect(firstWait.overlay.color === blockedColor && (await toneColor(firstWait.tone)) === blockedColor, `fix 247: the counter is in the pulse's tone (needs-input teal), got ${JSON.stringify({ color: firstWait.overlay.color, tone: firstWait.tone, blocked: blockedColor })}`);
  expect(firstWait.overlay.pointer === 'none', `fix 247: no pointer events on the counter, got ${firstWait.overlay.pointer}`);
  expect(firstWait.overlay.figureSize === '48px' && firstWait.overlay.wordSize === '14px', `fix 267: the figure at 48px with its word at 14px, got ${JSON.stringify({ figure: firstWait.overlay.figureSize, word: firstWait.overlay.wordSize })}`);
  expect(firstWait.overlay.background === 'rgba(0, 0, 0, 0)', `fix 267: no ground under the counter, got ${firstWait.overlay.background}`);
  expect(firstWait.overlay.paint === 'stroke' && firstWait.overlay.stroke === '5px' && (await toneColor(firstWait.paneBg)) === firstWait.overlay.strokeColor, `fix 267: the figure's halo is a stroke under the fill in the terminal's ground, got ${JSON.stringify({ paint: firstWait.overlay.paint, stroke: firstWait.overlay.stroke, color: firstWait.overlay.strokeColor, paneBg: firstWait.paneBg })}`);
  expect(firstWait.overlay.slots >= 2, `fix 267: the figure's digits are odometer slots, got ${firstWait.overlay.slots}`);
  expect(firstWait.overlay.hush !== null && firstWait.overlay.hush.pointer === 'auto' && firstWait.overlay.hush.height >= 28 && firstWait.overlay.hush.hushed === null, `fix 267: the hush button sits beside the figure at its scale and takes the pointer, got ${JSON.stringify(firstWait.overlay.hush)}`);
  expect(firstWait.overlay.inside && firstWait.overlay.top < 20 && firstWait.overlay.right < 40, `fix 247: the counter sits in the pane's top right corner, got ${JSON.stringify(firstWait.overlay)}`);
  expect(firstWait.rowWait !== null && firstWait.rowWait.figure === firstWait.overlay.figure && firstWait.rowWait.text === firstWait.overlay.figure && firstWait.rowWait.word === 'waiting', `fix 267: the row's figure is the pane's, got ${JSON.stringify({ row: firstWait.rowWait, figure: firstWait.overlay.figure })}`);
  expect(firstWait.rowWait.color === blockedColor && firstWait.rowWait.figureSize === '36px' && firstWait.rowWait.pointer === 'none' && firstWait.rowWait.rightHalf && firstWait.rowWait.shadow !== 'none' && firstWait.rowWait.slots >= 2, `fix 267: the row's figure at 36px in the tone over the row's right half with its halo and odometer slots, got ${JSON.stringify(firstWait.rowWait)}`);
  expect(firstWait.rowWait.hush !== null && firstWait.rowWait.hush.height >= 26 && firstWait.rowWait.hush.pointer === 'auto' && !firstWait.mainHush, `fix 267: the row's hush is at the figure's scale beside it and gone from the main line, got ${JSON.stringify({ hush: firstWait.rowWait.hush, mainHush: firstWait.mainHush })}`);
  expect(firstWait.age.text === firstWait.overlay.figure && firstWait.age.visibility === 'hidden', `fix 267: the row's small age is hidden under the figure, got ${JSON.stringify({ age: firstWait.age, figure: firstWait.overlay.figure })}`);
  // A tick a second on: the figure has climbed and the three still agree.
  await sleep(2100);
  const laterWait = await overlayProbe();
  const secs = (t) => Number(/(\d+)s/.exec(t)?.[1] ?? -1);
  expect(secs(laterWait.overlay.figure) >= secs(firstWait.overlay.figure) + 1, `fix 247: the counter climbed, ${firstWait.overlay.figure} then ${laterWait.overlay.figure}`);
  expect(laterWait.age.text === laterWait.overlay.figure && laterWait.rowWait.figure === laterWait.overlay.figure, `fix 247: the row keeps step, got ${JSON.stringify({ age: laterWait.age.text, row: laterWait.rowWait.figure, figure: laterWait.overlay.figure })}`);
  await s.screenshot('m9-fix267-waiting.png');
  // The odometer (fix 235 on the figures, fix 267): a tick rolls a digit
  // slot, and the roll runs from its own start rather than the pulses'
  // time zero (attention.ts leaves a figure's roll alone since fix 268),
  // so within a second a slot is seen mid-roll.
  const rolled = await s.evalJs(`new Promise((resolve) => {
    const until = performance.now() + 2400;
    const look = () => {
      const slot = document.querySelector(${JSON.stringify(overlaySel)} + ' .figure-slot[data-move="roll"]');
      const a = slot === null ? null : slot.getAnimations({ subtree: true }).find((x) => x.animationName === 'figure-roll-in');
      if (a !== undefined && a !== null && a.playState === 'running' && a.currentTime < 300) resolve({ move: slot.dataset.move, from: slot.dataset.from, state: a.playState, current: a.currentTime, start: a.startTime });
      else if (performance.now() > until) resolve(null);
      else setTimeout(look, 30);
    };
    look();
  })`);
  expect(rolled !== null && rolled.start !== 0, `fix 267: a tick rolls the figure's digit on its own clock (a start of null is one still pending, never zero), got ${JSON.stringify(rolled)}`);
  // M9 fix 268: the row's pulse and the pane's wash beat as one after
  // whatever restarted them: pane 2's split half hidden and shown by a
  // zoom of pane 1, and the sidebar folded and unfolded, both of which
  // restart the animations under them; every pulse is back on the
  // document's time zero, so their clocks agree, and the marker's
  // needs-pulse runs on the pulses' 1.8s period.
  const pulseClocks = () =>
    s.evalJs(`(() => {
      const row = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]');
      const pane = document.querySelector('[data-pane-id=${JSON.stringify(p2)}]');
      const list = (el) => el.getAnimations({ subtree: true }).filter((a) => a instanceof CSSAnimation && !a.animationName.startsWith('figure-')).map((a) => { const t = a.effect.getTiming(); const period = t.direction.startsWith('alternate') ? 2 * t.duration : t.duration; return { name: a.animationName, pseudo: a.effect.pseudoElement ?? null, start: a.startTime, current: Math.round(a.currentTime), period, phase: Math.round(a.currentTime % period), state: a.playState }; });
      return { row: list(row), pane: list(pane) };
    })()`);
  await s.key('Z', 'KeyZ', 90, CTRL | SHIFT);
  await s.waitFor(`!!document.querySelector('.splitview.zoomed')`, 'pane 1 zoomed, pane 2 hidden', 3000);
  await sleep(700);
  await s.key('Z', 'KeyZ', 90, CTRL | SHIFT);
  await s.waitFor(`!document.querySelector('.splitview.zoomed')`, 'unzoomed, pane 2 back', 3000);
  await s.key('B', 'KeyB', 66, CTRL | SHIFT);
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]') === null || document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]').getClientRects().length === 0`, 'the sidebar folded', 3000);
  await sleep(700);
  await s.key('B', 'KeyB', 66, CTRL | SHIFT);
  await s.waitFor(`(document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.getClientRects().length ?? 0) > 0`, 'the sidebar back', 3000);
  await sleep(400);
  const clocks = await pulseClocks();
  const rowPulse = clocks.row.find((a) => a.name === 'attention-pulse' && a.pseudo === null);
  const paneWash = clocks.pane.find((a) => (a.name === 'attention-wash' || a.name === 'attention-ring') && a.pseudo === '::before');
  const marker = clocks.row.find((a) => a.name === 'needs-pulse');
  expect(rowPulse !== undefined && paneWash !== undefined, `fix 268: the row's pulse and the pane's wash both run after the zoom and the fold, got ${JSON.stringify(clocks)}`);
  expect(rowPulse.start === 0 && paneWash.start === 0 && rowPulse.period === paneWash.period && rowPulse.phase === paneWash.phase, `fix 268: both on time zero with one phase, got ${JSON.stringify({ row: rowPulse, pane: paneWash })}`);
  expect([...clocks.row, ...clocks.pane].every((a) => a.start === 0 && a.state === 'running'), `fix 268: every pulse under the row and the pane is on time zero, got ${JSON.stringify(clocks)}`);
  expect(marker !== undefined && marker.period === 1800 && marker.start === 0, `fix 268: the marker's needs-pulse runs on the 1.8s period from time zero, got ${JSON.stringify(marker)}`);
  step(`M9 fix 268: after a zoom and a sidebar fold the row's pulse and the pane's wash read start 0 and phase ${rowPulse.phase} of ${rowPulse.period} alike, the marker's breathing on the same period`);
  // The overlay's hush: a press on it toggles the session's hush as the
  // row's does, the pulse and the figure staying. The chords above (a
  // look-first key names no session) hushed every chime on their way,
  // so the first press lets this one through and the second hushes it.
  const overlayHush = await centerOf(s, `${overlaySel} .sidebar-row-hush`);
  const hushedBefore = (await rowHushed()) === 'true';
  await s.click(overlayHush.x, overlayHush.y);
  await s.waitFor(`(document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.hushed === 'true') === ${!hushedBefore}`, `the overlay hush ${hushedBefore ? 'let the chime through' : 'hushed the session'}`, 3000);
  const toggled = await overlayProbe();
  expect(toggled.overlay !== null && (toggled.overlay.hush.hushed === 'true') === !hushedBefore && toggled.rowWait !== null && (await rowAttention()) === 'needs-input', `fix 267: the press toggled the hush and kept the pulse and the figures, got ${JSON.stringify({ hush: toggled.overlay?.hush, row: toggled.rowWait !== null, attention: await rowAttention(), before: hushedBefore })}`);
  // The press leaves the focus where it was: a pane taking focus on the
  // hush would ack a done session at once (fix 30) and end the pulse.
  expect(await s.evalJs(focusedPaneIs(p1)), 'fix 267: the overlay hush did not move the focus to its pane');
  await s.click(overlayHush.x, overlayHush.y);
  await s.waitFor(`(document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.hushed === 'true') === ${hushedBefore}`, 'a second press toggled it back', 3000);
  if ((await rowHushed()) === 'true') {
    await s.click(overlayHush.x, overlayHush.y);
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(target)}]')?.dataset.hushed === undefined`, 'unhushed for the rest', 3000);
  }
  // The reply: done reads its own word in the done tone.
  await post({ hook_event_name: 'Stop', last_assistant_message: 'Asked and answered.' });
  await waitAttention('done', 'the turn ends as done');
  await s.waitFor(`document.querySelector(${JSON.stringify(overlaySel)})?.dataset.word === 'done'`, 'the counter turned to done', 3000);
  const doneOverlay = await overlayProbe();
  const doneColor = await tokenColor('--done');
  expect(/^done \d+s$/.test(doneOverlay.overlay.text) && doneOverlay.overlay.color === doneColor && doneOverlay.rowWait.color === doneColor && doneOverlay.rowWait.word === 'done', `fix 247: done reads its word in the done tone on the pane and the row, got ${JSON.stringify({ overlay: doneOverlay.overlay, row: doneOverlay.rowWait, done: doneColor })}`);
  // The acknowledge takes the counter and the row's figure with the pulse.
  await ackSix();
  await waitClear('acked, the counter goes with the pulse');
  const acked = await overlayProbe();
  expect(acked.overlay === null && acked.rowWait === null && acked.age.color === mutedColor && acked.age.size === '13px' && acked.age.visibility === 'visible', `fix 247: no counter and no row figure after the ack and the row's age back to muted at 13px, got ${JSON.stringify(acked)}`);
  step(`M9 fixes 247 and 267: the counter read ${firstWait.overlay.text} then ${laterWait.overlay.text} at 48px in the teal over pane 2 on no ground with its hush beside it, the row's figure at 36px in step with its age hidden, the overlay's hush toggled the session's hush both ways, ${doneOverlay.overlay.text} in green at the reply, and all gone at the ack; frame m9-fix267-waiting.png`);

  // M9 fix 701: a question into the pane the person is typing in. The
  // front session is pane 1's, pane 1 focused: a click and a key there,
  // then a PermissionRequest, which is settled as it arrives (no chime,
  // no pulse, no flash, no toast, the badge at needs-input all the same);
  // then the same question after ten quiet seconds, which arrives as ever.
  const frontTitleAttention = () => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .pane-title')?.dataset.attention ?? null`);
  const newSince = (before, pred) => taskbarLines().slice(before).some(pred);
  await postFront({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.state === 'working'`, 'fix 701: the front session working', 5000);
  await s.click(c1Now.x, c1Now.y);
  await s.waitFor(focusedPaneIs(p1), 'fix 701: pane 1 focused');
  await s.key('a', 'KeyA', 65);
  const quietChimes = await chimes();
  const quietTaskbar = taskbarLines().length;
  const quietNotified = notified().length;
  const quietConsole = s.consoleLog.length;
  await postFront({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.state === 'needs-input'`, 'fix 701: the badge says needs input', 5000);
  await sleep(1000);
  const settledLine = s.consoleLog.slice(quietConsole).find((l) => l.includes(`attention ${front.slice(0, 8)} needs-input: answering in the focused pane, no chime, flash or toast`));
  const quietRead = {
    chimes: (await chimes()) - quietChimes,
    row: await frontAttention(),
    title: await frontTitleAttention(),
    overlay: await s.evalJs(`!!document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .wait-overlay')`),
    flash: newSince(quietTaskbar, (l) => l.endsWith(', flash')),
    notified: notified().length - quietNotified,
    logged: settledLine !== undefined,
  };
  expect(
    quietRead.chimes === 0 && quietRead.row === null && quietRead.title === null && !quietRead.overlay && !quietRead.flash && quietRead.notified === 0 && quietRead.logged,
    `fix 701: a question into the pane being typed in is settled, got ${JSON.stringify(quietRead)}`,
  );
  await s.pastRecentInput();
  await postFront({ hook_event_name: 'PostToolUse', tool_name: 'Bash' });
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.state === 'working'`, 'fix 701: working again', 5000);
  const loudChimes = await chimes();
  const loudTaskbar = taskbarLines().length;
  const loudNotified = notified().length;
  await postFront({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.attention === 'needs-input'`, 'fix 701: after ten quiet seconds the question pulses', 5000);
  await waitTaskbar(', flash');
  await waitNotified(loudNotified + 1, 'fix 701: the question after ten quiet seconds posts');
  const loudRead = {
    chimes: (await chimes()) - loudChimes,
    title: await frontTitleAttention(),
    flash: newSince(loudTaskbar, (l) => l.endsWith(', flash')),
    session: notified().at(-1)?.sessionId === front,
  };
  expect(loudRead.chimes === 1 && loudRead.title === 'needs-input' && loudRead.flash && loudRead.session, `fix 701: the same question after ten quiet seconds chimes, pulses, flashes and posts, got ${JSON.stringify(loudRead)}`);
  await s.click(c1Now.x, c1Now.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(frontRow)})?.dataset.attention === undefined`, 'fix 701: a click on pane 1 clears the pulse', 5000);
  step('M9 fix 701: a question into the focused pane a key after the last one came with no chime, flash, toast or pulse, the badge still saying needs input; the same question after ten quiet seconds chimed, flashed, posted and pulsed');

  // M9 fix 702: zoomed on pane 1, a question in pane 2 (hidden by the
  // zoom) pulses the tab on show, and a real click on that tab undoes the
  // zoom with the focus kept on pane 1; zoomed on pane 2 itself, the tab
  // does not pulse and a click leaves the zoom.
  const zoomedOn = (paneId) => `document.querySelector('.splitview.zoomed')?.dataset.zoomedPane === ${JSON.stringify(paneId)}`;
  const paneShown = (paneId) => s.evalJs(`(document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]')?.getClientRects().length ?? 0) > 0`);
  const firstTabSel = `.tab.tab-panes[data-tab-id=${JSON.stringify(firstTabId)}]`;
  await s.key('Z', 'KeyZ', 90, CTRL | SHIFT);
  await s.waitFor(zoomedOn(p1), 'fix 702: pane 1 zoomed', 3000);
  expect((await tabAttention(firstTabId)) === null, 'fix 702: zoomed with nothing wanting, the tab on show does not pulse');
  await post({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
  await waitAttention('needs-input', 'fix 702: the target in hidden pane 2 asks');
  await s.waitFor(`document.querySelector(${JSON.stringify(firstTabSel)})?.dataset.attention === 'needs-input'`, 'fix 702: the tab on show pulses for the hidden pane', 5000);
  const zoomedRead = { animation: await tabAnimation(firstTabId), tone: await tabTone(firstTabId), zoomed: await s.evalJs(zoomedOn(p1)), pane2: await paneShown(p2) };
  expect(zoomedRead.animation === 'attention-pulse' && zoomedRead.tone === 'needs-input' && zoomedRead.zoomed && !zoomedRead.pane2, `fix 702: the tab pulses in the attention tone while the zoom hides pane 2, got ${JSON.stringify(zoomedRead)}`);
  const firstTabCentre = await centerOf(s, firstTabSel);
  await s.click(firstTabCentre.x, firstTabCentre.y);
  await s.waitFor(`!document.querySelector('.splitview.zoomed')`, 'fix 702: a click on the pulsing tab undid the zoom', 3000);
  await s.waitFor(`document.querySelector(${JSON.stringify(firstTabSel)})?.dataset.attention === undefined`, 'fix 702: the tab stops once pane 2 is on screen', 3000);
  const unzoomedRead = { focused: await s.evalJs(focusedPaneIs(p1)), pane1: await paneShown(p1), pane2: await paneShown(p2), row: await rowAttention(), title: await titleAttention(), hushed: await rowHushed() };
  expect(
    unzoomedRead.focused && unzoomedRead.pane1 && unzoomedRead.pane2 && unzoomedRead.row === 'needs-input' && unzoomedRead.title === 'needs-input' && unzoomedRead.hushed === 'true',
    `fix 702: the focus stayed on pane 1 and pane 2's ring still pulses, hushed, got ${JSON.stringify(unzoomedRead)}`,
  );
  // The control: zoomed on the wanting pane itself nothing is hidden.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .pane-zoom').click()`);
  await s.waitFor(zoomedOn(p2), 'fix 702: pane 2 zoomed', 3000);
  await s.waitFor(focusedPaneIs(p2), 'fix 702: pane 2 focused by its zoom');
  await sleep(300);
  expect((await tabAttention(firstTabId)) === null && (await rowAttention()) === 'needs-input', `fix 702: zoomed on the wanting pane the tab does not pulse, got ${JSON.stringify({ tab: await tabAttention(firstTabId), row: await rowAttention() })}`);
  await s.click(firstTabCentre.x, firstTabCentre.y);
  await sleep(300);
  expect(await s.evalJs(zoomedOn(p2)), 'fix 702: a click on the tab with nothing hidden wanting leaves the zoom');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p2)}] .pane-zoom').click()`);
  await s.waitFor(`!document.querySelector('.splitview.zoomed')`, 'fix 702: unzoomed', 3000);
  await ackSix();
  await waitClear('fix 702: acked, nothing pulsing');
  step('M9 fix 702: zoomed on pane 1, a question in hidden pane 2 pulsed the tab on show; a click on the tab undid the zoom with the focus kept on pane 1 and pane 2\'s ring still pulsing; zoomed on pane 2 itself, the tab did not pulse and a click left the zoom');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m14-attention-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
