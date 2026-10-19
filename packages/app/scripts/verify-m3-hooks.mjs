// M3 acceptance, part 2: real Claude Code, real hooks. With the hooks
// installed (npm run hooks -w @emerald/daemon -- install) this starts a control
// shell and a Claude session from the app, runs a prompt, watches
// hooks.jsonl fill with SessionStart, UserPromptSubmit, Stop and the pane
// title move idle -> working -> done -> idle (ack). Then it asks Claude to
// run a Bash command in default permission mode, measures how long the
// PermissionRequest hook takes to reach the title, allows it and sees the
// tool events and done. Then Shift+Enter in the Claude pane puts a second
// line in the prompt box (M28) while the control shell runs its line.
// Finally /exit, and checks the control shell and Orca's hook entries
// were untouched. Costs two short Claude turns.
// Starts from an empty layout, so run it when no Emerald app is open.
// Run: npm run verify:hooks -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generationPaths } from '@emerald/shared/hook-log';
import { CTRL, SHIFT, clickNewShell, expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, step, stopDaemon, emeraldHome, zreq } from './cdp.mjs';

setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 180 s');
  process.exit(3);
}, 180000);

// M9 fix 469: the live rotation's knobs, so a real daemon rotates the
// hook log mid-script with the app attached. The threshold is past what
// the script's own hooks write, so nothing rotates until the pad step
// after turn 1 pushes the file over it; the check runs every two seconds
// so the rotation lands before turn 2.
const ROTATE_BYTES = 64 * 1024;
process.env['EMERALD_HOOK_ROTATE_BYTES'] = String(ROTATE_BYTES);
process.env['EMERALD_HOOK_ROTATE_MS'] = '2000';

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const hooksLog = path.join(emeraldHome, 'logs', 'hooks.jsonl');
const emmerdLog = path.join(emeraldHome, 'logs', 'emmerd.log');
const countOrca = () => (fs.readFileSync(settingsPath, 'utf8').match(/\.orca\/agent-hooks\/claude-hook\.cmd/g) ?? []).length;
const countEmerald = () => (fs.readFileSync(settingsPath, 'utf8').match(/\.emerald\/hooks\/claude-hook\.cmd/g) ?? []).length;
// Every generation oldest first, then the current file (M9 fix 469), so a
// rotation mid-script loses no event; each line carries the file it came
// from for the closing step.
const linesOf = () =>
  generationPaths(hooksLog).flatMap((file) =>
    (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
      .split('\n')
      .filter(Boolean)
      .map((raw) => ({ raw, file: path.basename(file) })),
  );
const eventsFor = (sessionId) =>
  linesOf()
    .map((l) => JSON.parse(l.raw))
    .filter((l) => l.sessionId === sessionId);
// The badge's own text: while Claude works its spinner glyph sits in a span
// before it (M33), and this reads the state word alone.
const titleOf = (s, paneId) =>
  s.evalJs(`(() => { const el = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-state'); return el ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('') : null; })()`);
// Polls fast so the latency numbers mean something.
const waitTitle = async (s, paneId, text, what, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await titleOf(s, paneId)) === text) return Date.now();
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what} (title is ${await titleOf(s, paneId)})`);
};
// Clicks a pane and waits until the daemon's layout agrees it is focused, so
// later assertions about "the focused pane" are about the real state.
const clickPane = async (s, paneId) => {
  const r = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const t0 = Date.now();
  await s.click(r.x, r.y);
  const clicked = Date.now();
  const deadline = Date.now() + 10000;
  while ((await getLayout(s)).focusedPaneId !== paneId) {
    if (Date.now() > deadline) throw new Error(`pane ${paneId.slice(0, 8)} did not become focused after a click`);
    await sleep(25);
  }
  step(`click on pane ${paneId.slice(0, 8)}: dispatch ${clicked - t0} ms, focused ${Date.now() - clicked} ms later`);
};
// The whole line lands in Claude's stdin as one chunk, which its paste
// detection holds open for a moment; an Enter that arrives inside that
// window becomes a newline in the input instead of a submit (seen
// intermittently at 300 ms while M5 was verified), so give it a good while.
const typeLine = async (s, text) => {
  await s.type(text);
  await sleep(1500);
  await s.key('Enter', 'Enter', 13);
};
const stateOf = async (s, id) => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id);
// The prompt box: the rows between the last two rule rows Claude draws
// around it (M9 fix 640). A sent prompt stays in the history above with
// the same mark, so the whole screen cannot say the box still holds it.
const boxText = async (s, id) => {
  const rows = (await zreq(s, 'pty.screen', { sessionId: id })).rows;
  const rules = rows.flatMap((r, k) => (/^\u2500{10,}$/.test(r.trim()) ? [k] : []));
  const box = rules.length >= 2 ? rows.slice(rules.at(-2) + 1, rules.at(-1)) : rows.slice(-8);
  return box.join(' ').replace(/\s+/g, ' ');
};

expect(countEmerald() === 16, `emmer hooks installed (found ${countEmerald()} of 16); run npm run hooks -w @emerald/daemon -- install`);
const orcaBefore = countOrca();
step(`hooks installed; Orca has ${orcaBefore} entries in settings.json`);

const s = await launch(freshPort(), { freshState: true });
let claudeId = null;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane')`, 'empty pane');
  await clickNewShell(s);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'control shell');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes');
  let layout = await getLayout(s);
  const [p1, p2] = leaves(layout);
  const controlId = p1.sessionId;

  // Spawn Claude with an explicit permission mode so the Bash prompt is
  // guaranteed whatever the user's default is, then show it in pane 2.
  const t0 = Date.now();
  const { session } = await zreq(s, 'session.spawn', { kind: 'claude', cwd: repoRoot, args: ['--permission-mode', 'default'], cols: 120, rows: 30 });
  claudeId = session.id;
  expect(session.state === 'starting', 'claude session starts in starting');
  layout = await getLayout(s);
  const place = (n) => (n.kind === 'pane' ? (n.id === p2.id ? { ...n, sessionId: claudeId } : n) : { ...n, first: place(n.first), second: place(n.second) });
  await zreq(s, 'layout.set', { layout: { ...layout, root: place(layout.root), focusedPaneId: p2.id } });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'claude terminal');
  step(`claude ${claudeId.slice(0, 8)} spawned in ${repoRoot} (pid ${session.pid}); control shell ${controlId.slice(0, 8)}`);

  const idleAt = await waitTitle(s, p2.id, 'idle', 'SessionStart -> idle', 30000);
  const start = eventsFor(claudeId).find((e) => e.event === 'SessionStart');
  expect(start !== undefined && start.outcome === 'applied', 'SessionStart in hooks.jsonl');
  const bound = await stateOf(s, claudeId);
  expect(typeof bound.claudeSessionId === 'string' && bound.claudeSessionId === start.payload.session_id, 'claudeSessionId bound to the hook session_id');
  step(`SessionStart ${idleAt - t0} ms after spawn; source=${start.payload.source ?? start.payload.session_start_type}; claude session ${bound.claudeSessionId.slice(0, 8)}`);
  // Let the TUI finish drawing before typing.
  await sleep(2000);
  await s.screenshot('m3-hooks-idle.png');
  const scrollback = Buffer.from((await zreq(s, 'session.read', { sessionId: claudeId })).data, 'base64').toString();
  expect(!scrollback.includes('Transcript saving is off'), 'claude does not think it is a child session');

  // Turn 1: plain prompt. Move focus to the control pane right after Enter so
  // done sticks and the ack can be observed on click. An Enter the real Claude
  // did not take, the prompt still in its box after 5 s, is sent once more
  // with a note (M9 fix 640).
  await clickPane(s, p2.id);
  await typeLine(s, 'Reply with exactly the word pong and nothing else.');
  let workingAt = await waitTitle(s, p2.id, 'working', 'UserPromptSubmit -> working', 5000).catch(() => null);
  if (workingAt === null) {
    const submitted = eventsFor(claudeId).some((e) => e.event === 'UserPromptSubmit');
    if (!submitted && (await titleOf(s, p2.id)) === 'idle' && (await boxText(s, claudeId)).includes('Reply with exactly')) {
      console.log('[verify] note: the first Enter was not taken');
      await s.key('Enter', 'Enter', 13);
    }
    workingAt = await waitTitle(s, p2.id, 'working', 'UserPromptSubmit -> working', 10000);
  }
  await clickPane(s, p1.id);
  const doneAt = await waitTitle(s, p2.id, 'done', 'Stop -> done', 90000);
  step(`turn 1: working after ${workingAt - t0} ms, done ${doneAt - workingAt} ms later; done sticks while the control pane is focused`);
  await s.screenshot('m3-hooks-done.png');
  await clickPane(s, p2.id);
  await waitTitle(s, p2.id, 'idle', 'ack -> idle', 5000);
  let names = eventsFor(claudeId).map((e) => e.event);
  expect(names.includes('UserPromptSubmit') && names.includes('Stop'), 'UserPromptSubmit and Stop logged');
  // M9 fix 726: Emerald's own Claude loads the mod, whose post of each
  // event comes first; the hook file's copies are folded, so each of the
  // three is one line, marked mod.
  {
    const three = eventsFor(claudeId).filter((e) => ['SessionStart', 'UserPromptSubmit', 'Stop'].includes(e.event));
    const once = ['SessionStart', 'UserPromptSubmit', 'Stop'].every((n) => three.filter((e) => e.event === n).length === 1);
    expect(once && three.every((e) => e.mod === true), `turn 1's SessionStart, UserPromptSubmit and Stop came from the mod, once each, the hook file's copies folded (${three.map((e) => `${e.event}${e.mod ? ':mod' : ''}`).join(', ')})`);
    // M9 fix 738: the mod posts a turn's start and end as events of its own.
    // turn.complete fires about a second after the Stop (the capture of fix
    // 738), so its line can land after the ack; it is waited for.
    const turnStart = eventsFor(claudeId).filter((e) => e.event === 'TurnStart' && e.mod === true);
    let turnDone = eventsFor(claudeId).filter((e) => e.event === 'TurnComplete' && e.mod === true);
    for (const end = Date.now() + 5000; turnDone.length === 0 && Date.now() < end; await sleep(200)) turnDone = eventsFor(claudeId).filter((e) => e.event === 'TurnComplete' && e.mod === true);
    expect(turnStart.length >= 1 && turnDone.length >= 1 && turnDone[0].payload?.is_aborted === false, `turn 1's TurnStart and TurnComplete came from the mod, the turn not aborted (${turnStart.length} TurnStart, ${turnDone.length} TurnComplete, ${JSON.stringify(turnDone[0]?.payload ?? null)})`);
    // M9 fix 769: the mod posts each kept row as an Append, and its uuid is
    // the transcript line's; the file can trail the post, so it is polled.
    const appended = eventsFor(claudeId).filter((e) => e.event === 'Append' && e.mod === true);
    const transcriptPath = start.payload.transcript_path;
    const missing = () => {
      const text = typeof transcriptPath === 'string' && fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, 'utf8') : '';
      return appended.filter((e) => !text.includes(`"uuid":"${e.payload?.uuid}"`)).map((e) => e.payload?.uuid);
    };
    let lost = missing();
    for (const end = Date.now() + 5000; lost.length > 0 && Date.now() < end; await sleep(200)) lost = missing();
    expect(appended.length >= 2 && lost.length === 0, `fix 769: turn 1's rows came from the mod as Append lines, each uuid a transcript line's (${appended.length} Append, ${lost.length} not in the transcript: ${lost.join(', ')})`);
    // M9 fix 774: a top-level TurnComplete idles a row still busy, which
    // leans on a finished turn's Stop landing first.
    const names = eventsFor(claudeId).filter((e) => e.mod === true).map((e) => e.event);
    expect(names.indexOf('Stop') !== -1 && names.indexOf('Stop') < names.indexOf('TurnComplete'), `turn 1's Stop landed before its TurnComplete, the order fix 774 leans on (${names.join(', ')})`);
  }
  step(`ack on focus: idle. hooks.jsonl so far: ${names.join(', ')}`);

  // M9 fix 469: push the current file past the threshold with two padding
  // posts under a session no record holds (logged as unknown, read by no
  // step), then wait for the live check to rotate it, so turn 1's events
  // sit in hooks.1.jsonl and turn 2's in the fresh file.
  const hookDaemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
  const emmerdFrom = fs.statSync(emmerdLog).size;
  const padAt = Date.now();
  for (const n of [1, 2]) {
    const padded = await fetch(`http://127.0.0.1:${hookDaemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': hookDaemon.hookToken, 'X-Emerald-Session': 'pad-469' },
      body: JSON.stringify({ hook_event_name: 'Notification', session_id: `pad-469-${n}`, pad: 'p'.repeat(40 * 1024) }),
    });
    expect(padded.status === 204, `the sink took pad post ${n}, got ${padded.status}`);
  }
  const rotatedLine = () => fs.readFileSync(emmerdLog, 'utf8').slice(emmerdFrom).split('\n').find((l) => l.includes('hooks.jsonl rotated')) ?? null;
  const deadline469 = Date.now() + 15000;
  while (Date.now() < deadline469 && rotatedLine() === null) await sleep(200);
  expect(rotatedLine() !== null, 'the live check rotated hooks.jsonl after the pad');
  step(`fix 469: hooks.jsonl rotated ${Date.now() - padAt} ms after the pad`);

  // Turn 2: writing a file outside the project needs permission in default
  // mode (a harmless Bash echo does not: Claude Code auto-allows it).
  const permFile = path.join(os.tmpdir(), 'emerald-verify', `perm-check-${Date.now()}.txt`);
  fs.rmSync(permFile, { force: true });
  await typeLine(s, `Use the Write tool to create the file ${permFile} containing the single word hello, then reply with the word done.`);
  await waitTitle(s, p2.id, 'working', 'working for turn 2', 15000);
  const needAt = await waitTitle(s, p2.id, 'needs input: permission', 'PermissionRequest -> needs input', 90000);
  await sleep(300);
  const perm = eventsFor(claudeId).find((e) => e.event === 'PermissionRequest');
  expect(perm !== undefined, 'PermissionRequest in hooks.jsonl');
  const latency = needAt - perm.at;
  step(`needs input: permission shown ${latency} ms after the PermissionRequest hook fired (tool ${perm.payload.tool_name})`);
  expect(latency < 1000, `needs-input within a second, got ${latency} ms`);
  const blocked = await stateOf(s, claudeId);
  expect(blocked.state === 'needs-input' && blocked.needsInputReason === 'permission', 'daemon state is needs-input/permission');
  await s.screenshot('m3-hooks-needs-input.png');

  // Allow it: the dialog's first choice is yes.
  await sleep(500);
  await s.key('Enter', 'Enter', 13);
  const afterAllow = await waitTitle(s, p2.id, 'working', 'PreToolUse -> working', 15000);
  step(`allowed: working again ${afterAllow - needAt} ms after the prompt appeared`);
  // The pane is focused, so done is acked the moment it lands.
  await waitTitle(s, p2.id, 'idle', 'Stop -> done -> ack -> idle', 90000);
  names = eventsFor(claudeId).map((e) => e.event);
  const i = names.indexOf('PermissionRequest');
  // PreToolUse fires before the permission check, PostToolUse after it.
  expect(names.slice(0, i).includes('PreToolUse'), 'PreToolUse before the permission request');
  expect(names.slice(i).includes('PostToolUse') && names.slice(i).includes('Stop'), 'PostToolUse and Stop after the permission');
  const post = eventsFor(claudeId).filter((e) => e.event === 'PostToolUse').at(-1);
  expect(post.payload.tool_name === 'Write', `PostToolUse names the Write tool, got ${post.payload.tool_name}`);
  expect(fs.existsSync(permFile), 'the allowed write happened');
  fs.rmSync(permFile, { force: true });
  step(`turn 2 complete: ${names.slice(i).join(', ')}`);
  await s.screenshot('m3-hooks-turn2.png');

  // Shift+Enter (M28): in the Claude pane it is the kitty sequence, a
  // newline in the prompt box rather than a submit; in the control shell
  // it is still xterm's CR. The screen, not the stream, since the prompt
  // box is redrawn in place. The chunks get the same paste-detection
  // pause as typeLine.
  const submitsBefore = eventsFor(claudeId).filter((e) => e.event === 'UserPromptSubmit').length;
  await s.type('line one');
  await sleep(1500);
  await s.key('Enter', 'Enter', 13, SHIFT);
  await sleep(300);
  await s.type('line two');
  await sleep(1500);
  const screen = (await zreq(s, 'pty.screen', { sessionId: claudeId })).rows;
  const first = screen.findIndex((r) => r.includes('line one'));
  expect(first >= 0, 'the prompt box shows line one');
  expect(first >= 0 && (screen[first + 1] ?? '').includes('line two') && !screen[first].includes('line two'), `line two is on the row under line one, got ${JSON.stringify(screen.slice(Math.max(0, first), first + 2))}`);
  expect((await stateOf(s, claudeId)).state === 'idle', 'still idle: Shift+Enter did not submit');
  expect(eventsFor(claudeId).filter((e) => e.event === 'UserPromptSubmit').length === submitsBefore, 'no new UserPromptSubmit');
  step(`Shift+Enter in the Claude pane: two lines in the prompt box, ${JSON.stringify(screen[first].trim())} over ${JSON.stringify(screen[first + 1].trim())}, still idle`);
  await s.screenshot('m3-hooks-shift-enter.png');
  // Ctrl+C once clears the box (twice would exit). One the real Claude did not take, the text still in the box after 5 s, is sent once more with a note (M9 fix 640); the 5 s poll is the spacing past Claude's double-press-to-exit window.
  const boxCleared = async () => {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if (!(await boxText(s, claudeId)).includes('line one')) return true;
      await sleep(100);
    }
    return false;
  };
  await s.key('c', 'KeyC', 67, CTRL);
  if (!(await boxCleared())) {
    console.log('[verify] note: the first Ctrl+C was not taken');
    await s.key('c', 'KeyC', 67, CTRL);
    await boxCleared();
    expect((await stateOf(s, claudeId)).state !== 'exited', 'the second Ctrl+C did not exit Claude');
  }
  expect(!(await zreq(s, 'pty.screen', { sessionId: claudeId })).rows.some((r) => r.includes('line one')), 'Ctrl+C cleared the prompt box');
  // The control shell: Shift+Enter runs the line, and no escape reaches it.
  await clickPane(s, p1.id);
  const controlCursor = (await zreq(s, 'session.read', { sessionId: controlId })).next;
  await s.type('echo shiftenter');
  await sleep(300);
  await s.key('Enter', 'Enter', 13, SHIFT);
  await sleep(1500);
  const controlOut = Buffer.from((await zreq(s, 'session.read', { sessionId: controlId, since: controlCursor })).data, 'base64').toString();
  // The echo of the typed line, then the output on a line of its own.
  const plain = controlOut.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  expect(/echo shiftenter[\s\S]*\n\s*shiftenter/.test(plain), `the shell ran the line on Shift+Enter, got ${JSON.stringify(plain.slice(0, 200))}`);
  expect(!controlOut.includes('[13;2u'), 'no kitty sequence reached the shell');
  step('Shift+Enter in the control shell: the line ran, no escape in its scrollback');
  await clickPane(s, p2.id);
  // M9 fix 872: an observer on pane 2 records each change of data-dropping
  // with the terminal's visibility, from before the /exit, since fix 842's
  // drop is one spawn round trip, shorter than the loop's 200 ms below. It
  // is on the pane and re-queries the wrap, so a wrap remounted for the
  // shell is still read; a record is kept only when dropping changes.
  await s.evalJs(`(() => { const pane = document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(p2.id)}]`)}); window.__drop872 = []; const read = () => { const w = pane.querySelector('.term-wrap'); const h = w?.querySelector('.term-host'); const dropping = w?.dataset.dropping !== undefined; if (window.__drop872.at(-1)?.dropping === dropping) return; window.__drop872.push({ dropping, visibility: h ? getComputedStyle(h).visibility : null }); }; read(); window.__obs872 = new MutationObserver(read); window.__obs872.observe(pane, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-dropping'] }); return true; })()`);

  // Exit Claude: SessionEnd then the PTY closes.
  await typeLine(s, '/exit');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline && (await stateOf(s, claudeId)).state !== 'exited') await sleep(200);
  const exited = await stateOf(s, claudeId);
  expect(exited.state === 'exited', `claude session exited, got ${exited.state}`);
  // M9 fix 813: the pane drops to a shell, and the Claude row counts down.
  const dropDeadline = Date.now() + 10000;
  let dropped813 = null;
  // M9 fix 842, read by fix 872: an observer on pane 2 records each change of
  // data-dropping with the terminal's visibility, since the drop is one
  // spawn round trip, shorter than this loop's 200 ms.
  const wrapSel = JSON.stringify(`[data-pane-id=${JSON.stringify(p2.id)}] .term-wrap`);
  const wrapRead = () => s.evalJs(`(() => { const w = document.querySelector(${wrapSel}); const h = w?.querySelector('.term-host'); return { dropping: w?.dataset.dropping !== undefined, visibility: h ? getComputedStyle(h).visibility : null }; })()`);
  while (Date.now() < dropDeadline) {
    const onPane = leaves(await getLayout(s)).find((p) => p.id === p2.id)?.sessionId ?? null;
    const listed = onPane === null || onPane === claudeId ? null : (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === onPane);
    const counting = await s.evalJs(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(claudeId)}]`)})?.dataset.removing !== undefined`);
    dropped813 = { onPane, kind: listed?.kind ?? null, counting };
    if (listed?.kind === 'shell' && counting === true) break;
    await sleep(200);
  }
  expect(dropped813?.kind === 'shell' && dropped813.counting === true, `fix 813: /exit dropped pane 2 to a shell and the Claude row counts down, got ${JSON.stringify(dropped813)}`);
  const drop872 = await s.evalJs('(() => { window.__obs872?.disconnect(); return window.__drop872 ?? null; })()');
  const firstOn = drop872 === null ? -1 : drop872.findIndex((r) => r.dropping);
  const on872 = firstOn < 0 ? [] : drop872.filter((r) => r.dropping);
  expect(on872.length > 0 && on872.every((r) => r.visibility === 'hidden'), `fix 842: while pane 2 drops to a shell its terminal is hidden, got ${JSON.stringify(drop872)}`);
  expect(drop872.slice(firstOn).some((r) => !r.dropping), `fix 842: the drop ends with data-dropping off, got ${JSON.stringify(drop872)}`);
  expect(!(await wrapRead()).dropping, 'fix 842: once the shell is on pane 2 its terminal carries no data-dropping');
  names = eventsFor(claudeId).map((e) => e.event);
  step(`exit code ${exited.exitCode}; SessionEnd logged: ${names.includes('SessionEnd')}, ${on872.length} observed records in the drop (fix 842, read by fix 872)`);

  // The control shell and Orca were never involved.
  const control = await stateOf(s, controlId);
  expect(control.state === 'idle' && control.lastEventAt === null, 'control shell idle with no hook events');
  expect(eventsFor(controlId).length === 0, 'nothing in hooks.jsonl for the control shell');
  // A shell that never heard a hook shows no state at all (M22).
  expect((await titleOf(s, p1.id)) === null, 'control pane title shows no state');
  expect((await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(controlId)}] .sidebar-row-state')`)) === null, 'control row shows no badge');
  expect(countOrca() === orcaBefore && countEmerald() === 16, 'settings.json hook entries unchanged by the run');
  const outcomes = [...new Set(eventsFor(claudeId).map((e) => e.outcome))];
  step(`all ${eventsFor(claudeId).length} events for the claude session: outcomes ${outcomes.join(', ')}`);
  step(`sequence: ${names.join(' > ')}`);

  // M9 fix 377: the line the sink writes is trimmed. The real Write's
  // response was small and its line carries no mark; a PostToolUse
  // posted by hand with a response past the kilobyte lands cut and marked,
  // its tool name and the fields beside the cut string kept.
  expect(post.payload.truncated === undefined, 'the small PostToolUse line carries no truncated mark');
  const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
  const big = 'z'.repeat(10 * 1024);
  const posted = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
    method: 'POST',
    headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': claudeId },
    body: JSON.stringify({ session_id: start.payload.session_id, cwd: repoRoot, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'trim-377', tool_input: { file_path: 'C:/sim/big.txt' }, tool_response: { type: 'text', file: { filePath: 'C:/sim/big.txt', content: big, numLines: 200 } } }),
  });
  expect(posted.status === 204, `sink answered 204 for the big PostToolUse, got ${posted.status}`);
  const deadline377 = Date.now() + 5000;
  let cut = null;
  while (Date.now() < deadline377 && cut === null) {
    cut = eventsFor(claudeId).find((e) => e.event === 'PostToolUse' && e.payload.tool_use_id === 'trim-377') ?? null;
    if (cut === null) await sleep(100);
  }
  expect(cut !== null, 'the big PostToolUse landed in hooks.jsonl');
  expect(cut.payload.truncated === true, 'its line carries truncated: true');
  expect(cut.payload.tool_name === 'Read' && cut.payload.tool_response?.file?.content?.length === 1024 && cut.payload.tool_response.file.numLines === 200 && cut.payload.tool_input?.file_path === 'C:/sim/big.txt', `the cut string is a kilobyte and the fields beside it stay, got ${JSON.stringify(cut.payload).slice(0, 200)}`);
  step(`fix 377: a ${big.length}-byte response wrote a ${JSON.stringify(cut).length}-byte line`);

  // M9 fix 512: a body past the sink's megabyte is read to its end and
  // its head fields land, marked truncated, where it was refused whole.
  const huge = 'x'.repeat(1024 * 1024);
  const bigWrite = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
    method: 'POST',
    headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': claudeId },
    body: JSON.stringify({ session_id: start.payload.session_id, cwd: repoRoot, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_use_id: 'big-512', tool_input: { file_path: 'C:/sim/big-512.txt', content: huge }, tool_response: { filePath: 'C:/sim/big-512.txt', content: huge } }),
  });
  expect(bigWrite.status === 204, `sink answered 204 for the 2 MB Write, got ${bigWrite.status}`);
  const deadline512 = Date.now() + 5000;
  let head512 = null;
  while (Date.now() < deadline512 && head512 === null) {
    head512 = eventsFor(claudeId).find((e) => e.event === 'PostToolUse' && e.payload.tool_use_id === 'big-512') ?? null;
    if (head512 === null) await sleep(100);
  }
  expect(head512 !== null, 'the 2 MB Write landed in hooks.jsonl');
  expect(head512?.payload.truncated === true && head512.payload.tool_input?.file_path === 'C:/sim/big-512.txt', `its line carries truncated: true and the file path, got ${JSON.stringify(head512?.payload ?? null).slice(0, 200)}`);

  // M9 fix 469: the rotation mid-script lost nothing and doubled nothing.
  // The Claude session's lines across every generation are each there
  // once and in time order, turn 1's in the rotated file and the ones
  // after the pad in the fresh one.
  const gen1 = generationPaths(hooksLog).at(-2);
  expect(fs.existsSync(gen1) && fs.statSync(gen1).mtimeMs >= padAt - 1000, `${path.basename(gen1)} was written by this run's rotation`);
  const own = linesOf().filter((l) => JSON.parse(l.raw).sessionId === claudeId);
  const raws = own.map((l) => l.raw);
  expect(new Set(raws).size === raws.length, 'no line of the Claude session is doubled across the files');
  const ats = own.map((l) => JSON.parse(l.raw).at);
  expect(ats.every((at, k) => k === 0 || at >= ats[k - 1]), 'the session\'s lines are in time order across the files');
  const fileOf = (event) => own.find((l) => JSON.parse(l.raw).event === event)?.file;
  expect(fileOf('SessionStart') === path.basename(gen1), `SessionStart sits in ${path.basename(gen1)}, got ${fileOf('SessionStart')}`);
  expect(fileOf('PermissionRequest') === path.basename(hooksLog), `turn 2's PermissionRequest sits in the fresh file, got ${fileOf('PermissionRequest')}`);
  step(`fix 469: ${own.length} lines of the session over ${[...new Set(own.map((l) => l.file))].join(', ')}, once each and in order`);
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m3-hooks-fail.png').catch(() => {});
  if (claudeId !== null) console.error('[verify] events so far:', eventsFor(claudeId).map((e) => `${e.event}/${e.outcome}`).join(', '));
  // What the Claude pane shows, read through the terminal's buffer because
  // the WebGL renderer leaves no text in the DOM.
  const screen = await s
    .evalJs(`[...document.querySelectorAll('.pane')].map(p => { const t = p.querySelector('.term-host')?.emeraldTerm; if (!t) return ''; const b = t.buffer.active; const out = ['pane ' + p.dataset.paneId.slice(0, 8) + ' (' + t.cols + 'x' + t.rows + ')']; for (let i = 0; i < b.length; i++) { const line = b.getLine(i)?.translateToString(true) ?? ''; if (line.trim() !== '') out.push('  ' + i + ': ' + line); } return out.join('\\n'); }).join('\\n')`)
    .catch(() => '');
  if (screen !== '') console.error('[verify] pane screens:\n' + screen);
  console.error(s.logs.join(''));
  console.error('[verify] page console:');
  for (const line of s.consoleLog.filter((l) => l.includes('[emerald]'))) console.error('  ' + line);
  process.exitCode = 1;
} finally {
  if (claudeId !== null) await zreq(s, 'session.kill', { sessionId: claudeId }).catch(() => {});
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
