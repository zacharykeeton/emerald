// M5 acceptance, part 3: resume with real Claude Code, one short turn. A
// Claude session binds its id on SessionStart, answers one prompt, exits
// with /exit (code 0), its pane dropping to a shell (M9 fix 813); Resume on
// its row spawns claude --resume <id> in the same folder, in a pane beside, whose SessionStart reports
// source=resume with the same session id, the record rebinds it, and the
// earlier turn is back on screen. Needs hooks installed. Starts from an
// empty layout, so run it when no Emerald app is open. Then the M48 case: a
// shell that cd's into a subfolder and runs claude by hand, killed after
// /exit, resumes as a shell in that subfolder with claude --resume typed
// at its prompt, and is a shell again after the next /exit.
// Run: npm run verify:claude-resume -w @emerald/app
import fs from 'node:fs';
import path from 'node:path';
import { expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, step, stopDaemon, emeraldHome, zreq } from './cdp.mjs';

setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 300 s');
  process.exit(3);
}, 300000);

const hooksLog = path.join(emeraldHome, 'logs', 'hooks.jsonl');
const eventsFor = (sessionId) =>
  (fs.existsSync(hooksLog) ? fs.readFileSync(hooksLog, 'utf8') : '')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l) => l.sessionId === sessionId);
// The badge's own text: while Claude works its spinner glyph sits in a span
// before it (M33), and this reads the state word alone.
const titleOf = (s, paneId) =>
  s.evalJs(`(() => { const el = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .pane-state'); return el ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('') : null; })()`);
const waitTitle = async (s, paneId, text, what, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await titleOf(s, paneId)) === text) return Date.now();
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${what} (title is ${await titleOf(s, paneId)})`);
};
const stateOf = async (s, id) => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id);
const screenOf = (s, paneId) => s.evalJs(`(() => { const t = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host')?.emeraldTerm; if (!t) return ''; const b = t.buffer.active; const lines = []; for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? ''); return lines.join('\\n'); })()`);
// Claude's paste detection holds a one-chunk line open for a moment, and an
// Enter inside that window becomes a newline, so wait it out.
const typeLine = async (s, text) => {
  await s.type(text);
  await sleep(1500);
  await s.key('Enter', 'Enter', 13);
};

const s = await launch(freshPort(), { freshState: true });
let claudeId = null;
let shellId = null;
// Waits for a session's record to satisfy a predicate.
const waitState = async (s, id, pred, what, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await stateOf(s, id);
    if (info !== undefined && pred(info)) return info;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what} (record is ${JSON.stringify(await stateOf(s, id))})`);
};
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  const pane = leaves(await getLayout(s))[0];
  const { session } = await zreq(s, 'session.spawn', { kind: 'claude', cwd: repoRoot, args: ['--permission-mode', 'default'], cols: 120, rows: 30 });
  claudeId = session.id;
  const layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, sessionId: claudeId } } });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'claude terminal');
  await waitTitle(s, pane.id, 'idle', 'SessionStart -> idle', 30000);
  const first = await stateOf(s, claudeId);
  expect(typeof first.claudeSessionId === 'string', 'claude session id bound');
  step(`claude ${claudeId.slice(0, 8)} bound to claude session ${first.claudeSessionId.slice(0, 8)}`);
  await sleep(2000);
  await s.evalJs(`document.querySelector('.term-host .xterm-helper-textarea')?.focus()`);

  // One turn, so the transcript has something to resume.
  const marker = `emerald${Date.now() % 100000}`;
  await typeLine(s, `Reply with exactly the word ${marker} and nothing else.`);
  await waitTitle(s, pane.id, 'working', 'UserPromptSubmit -> working', 15000);
  // The pane is focused, so done is acked to idle at once; wait on the hook.
  const stopDeadline = Date.now() + 90000;
  while (Date.now() < stopDeadline && !eventsFor(claudeId).some((e) => e.event === 'Stop')) await sleep(200);
  expect(eventsFor(claudeId).some((e) => e.event === 'Stop'), 'Stop logged');
  // M9 fix 726: the hosted Claude loads the mod; each of the three is one
  // line, from the mod, the hook file's copies folded.
  {
    const three = eventsFor(claudeId).filter((e) => ['SessionStart', 'UserPromptSubmit', 'Stop'].includes(e.event));
    const once = ['SessionStart', 'UserPromptSubmit', 'Stop'].every((n) => three.filter((e) => e.event === n).length === 1);
    expect(once && three.every((e) => e.mod === true), `SessionStart, UserPromptSubmit and Stop from the mod, once each (${three.map((e) => `${e.event}${e.mod ? ':mod' : ''}`).join(', ')})`);
  }
  await waitTitle(s, pane.id, 'idle', 'done acked in the focused pane', 5000);
  await sleep(500);
  await typeLine(s, '/exit');
  await waitState(s, claudeId, (i) => i.state === 'exited' && i.exitCode === 0 && i.endReason === 'prompt_input_exit', 'claude exited (0) with /exit', 30000);
  // M9 fix 813: the pane drops to a shell in the folder Claude started in.
  const shellOn = async (paneId, other, what) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const on = leaves(await getLayout(s)).find((p) => p.id === paneId)?.sessionId ?? null;
      if (on !== null && on !== other) {
        const info = await stateOf(s, on);
        if (info?.kind === 'shell') return on;
      }
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${what} (layout ${JSON.stringify(leaves(await getLayout(s)))})`);
  };
  const dropped1 = await shellOn(pane.id, claudeId, 'fix 813: the pane dropped to a shell after /exit');
  const before = eventsFor(claudeId).length;
  step(`turn answered, /exit gave exited (0) and dropped the pane to a shell after ${before} hook events`);

  // Resume from the row during its count: the Claude opens in a pane beside
  // the shell (M9 fix 813). The new process reports in with source=resume
  // and the same session id, the record rebinds it, and the old turn is on
  // screen.
  await s.evalJs(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(claudeId)}] .sidebar-row-resume`)}).click()`);
  let claudePane = null;
  {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && claudePane === null) {
      claudePane = leaves(await getLayout(s)).find((p) => p.sessionId === claudeId && p.id !== pane.id)?.id ?? null;
      if (claudePane === null) await sleep(50);
    }
    expect(claudePane !== null, 'fix 813: Resume opened the Claude in a pane beside the shell');
  }
  await waitTitle(s, claudePane, 'starting', 'resumed session starting', 5000);
  const t0 = Date.now();
  const idleAt = await waitTitle(s, claudePane, 'idle', 'SessionStart after resume', 30000);
  const events = eventsFor(claudeId).slice(before);
  const start = events.find((e) => e.event === 'SessionStart');
  expect(start !== undefined, 'a new SessionStart was logged');
  const source = start.payload.source ?? start.payload.session_start_type;
  expect(source === 'resume', `SessionStart source is resume, got ${source}`);
  expect(start.payload.session_id === first.claudeSessionId, `same claude session id ${first.claudeSessionId.slice(0, 8)}, got ${String(start.payload.session_id).slice(0, 8)}`);
  const after = await stateOf(s, claudeId);
  expect(after.claudeSessionId === first.claudeSessionId && after.pid !== null && after.exitCode === null, 'record rebound and live');
  {
    const two = leaves(await getLayout(s));
    expect(two.length === 2 && two.some((p) => p.id === pane.id && p.sessionId === dropped1) && two.some((p) => p.id === claudePane && p.sessionId === claudeId), `the Claude in a pane beside the shell, same id, got ${JSON.stringify(two)}`);
  }
  // A new pane's terminal starts from the pty's replay, so the redraw is
  // waited for rather than read once (M9 fix 813).
  let screen = '';
  for (const end = Date.now() + 15000; Date.now() < end; await sleep(250)) {
    screen = await screenOf(s, claudePane);
    if (screen.includes(marker)) break;
  }
  if (!screen.includes(marker)) console.error(`[verify] the Claude pane's screen: ${JSON.stringify(screen.split('\n').filter((l) => l.trim() !== '').slice(-25))}`);
  expect(screen.includes(marker), 'the earlier turn is back on screen');
  // M9 fix 842: the row's Resume, clicked right after the drop, lands inside
  // the feed's detach hold, so the new pane would be written the old
  // process's ring, its exit note last; the feed starts over on a new pid.
  expect(!/\[process exited with code/.test(screen), `fix 842: the pane the Claude resumed into holds none of the old process's last screen, got ${JSON.stringify(screen.split('\n').filter((l) => l.trim() !== '').slice(-25))}`);
  step(`resume: claude --resume reported in ${idleAt - t0} ms with source=resume and the same id; the earlier reply "${marker}" is on screen`);
  await s.screenshot('m5-claude-resume.png');

  await s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id=${JSON.stringify(claudePane)}] .xterm-helper-textarea`)})?.focus()`);
  await typeLine(s, '/exit');
  await waitState(s, claudeId, (i) => i.state === 'exited' && i.exitCode === 0, 'resumed claude exited', 30000);
  const dropped2 = await shellOn(claudePane, claudeId, 'fix 813: the second /exit dropped that pane to a shell too');
  step('the Claude session resumed and exited again, its pane a shell');
  // Back to one pane for the M48 case; the two dropped shells go.
  {
    const layout1 = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...layout1, root: { kind: 'pane', id: pane.id, sessionId: dropped1, view: null }, focusedPaneId: pane.id } });
    await zreq(s, 'session.kill', { sessionId: dropped1, remove: true }).catch(() => {});
    await zreq(s, 'session.kill', { sessionId: dropped2, remove: true }).catch(() => {});
  }

  // M48, the cd case: a shell in the repo root, cd into packages/app,
  // claude typed by hand. Its SessionStart binds the conversation to the
  // shell with the subfolder as its folder.
  const endsWithSub = (p) => typeof p === 'string' && p.toLowerCase().endsWith(path.join('packages', 'app').toLowerCase());
  const shell = await zreq(s, 'session.spawn', { kind: 'shell', cwd: repoRoot, cols: 120, rows: 30 });
  shellId = shell.session.id;
  const layout2 = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout2, root: { ...layout2.root, sessionId: shellId } } });
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(pane.id)}] .term-host')?.dataset.sessionId === ${JSON.stringify(shellId)} || document.querySelectorAll('.term-host').length === 1`, 'shell terminal');
  await waitState(s, shellId, (i) => i.shellCwd !== null, 'the shell prompt reporting in', 20000);
  await sleep(500);
  await s.evalJs(`document.querySelector('.term-host .xterm-helper-textarea')?.focus()`);
  await s.type('cd packages/app');
  await s.key('Enter', 'Enter', 13);
  await waitState(s, shellId, (i) => endsWithSub(i.shellCwd) && endsWithSub(i.cwd), 'the shell in packages/app', 20000);
  await sleep(300);
  await s.type('claude --permission-mode default');
  await s.key('Enter', 'Enter', 13);
  const hosted = await waitState(s, shellId, (i) => i.claudeSessionId !== null && i.state === 'idle', 'claude typed into the shell reporting in', 60000);
  expect(hosted.conversation?.id === hosted.claudeSessionId && endsWithSub(hosted.conversation?.cwd) && hosted.conversation.args.length === 0, `the conversation is bound to the shell in packages/app, got ${JSON.stringify(hosted.conversation)}`);
  expect(endsWithSub(hosted.groupCwd), 'the row is grouped where Claude started');
  step(`claude in a shell: conversation ${hosted.claudeSessionId.slice(0, 8)} in ${hosted.conversation.cwd}`);
  await sleep(2000);
  await s.evalJs(`document.querySelector('.term-host .xterm-helper-textarea')?.focus()`);
  const marker2 = `emerald${(Date.now() + 7) % 100000}`;
  await typeLine(s, `Reply with exactly the word ${marker2} and nothing else.`);
  const stopDeadline2 = Date.now() + 90000;
  const stopsBefore = eventsFor(shellId).filter((e) => e.event === 'Stop').length;
  while (Date.now() < stopDeadline2 && eventsFor(shellId).filter((e) => e.event === 'Stop').length === stopsBefore) await sleep(200);
  expect(eventsFor(shellId).filter((e) => e.event === 'Stop').length > stopsBefore, 'Stop logged for the hosted conversation');
  // M9 fix 833: a hand-typed claude loads the emerald mod through the shell's CLAUDE_CODE_PLUGIN_DIRS (fix 726's read, inverted).
  expect(eventsFor(shellId).some((e) => e.mod === true), `fix 833: a claude typed into a shell pane loads the emerald mod, got ${eventsFor(shellId).map((e) => `${e.event}${e.mod ? ':mod' : ''}`).join(', ')}`);
  await sleep(500);
  await typeLine(s, '/exit');
  // Claude leaves: the shell is a shell again, unbound, still in the
  // subfolder (its own prompt is there), the conversation remembered.
  const left = await waitState(s, shellId, (i) => i.claudeSessionId === null && i.state === 'idle', 'SessionEnd unbinding the shell', 30000);
  expect(left.conversation?.id === hosted.claudeSessionId && endsWithSub(left.cwd) && endsWithSub(left.groupCwd), `the shell keeps the conversation and stays in packages/app, got ${left.cwd} under ${left.groupCwd}`);
  await zreq(s, 'session.kill', { sessionId: shellId });
  await waitState(s, shellId, (i) => i.state === 'exited', 'the shell killed', 15000);
  const before2 = eventsFor(shellId).length;
  // Resume from the pane: a shell in packages/app, claude --resume typed at
  // its first prompt, the same conversation reporting in with source=resume.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(pane.id)}] .pane-resume').click()`);
  const t1 = Date.now();
  const resumed = await waitState(s, shellId, (i) => i.state !== 'exited', 'the shell resumed', 5000);
  expect(resumed.kind === 'shell' && endsWithSub(resumed.cwd) && endsWithSub(resumed.groupCwd), `resumed as a shell in packages/app, got ${resumed.cwd}`);
  const bound = await waitState(s, shellId, (i) => i.claudeSessionId === hosted.claudeSessionId && i.state === 'idle', 'claude --resume typed at the prompt reporting in', 60000);
  const start2 = eventsFor(shellId).slice(before2).find((e) => e.event === 'SessionStart');
  expect(start2 !== undefined, 'a new SessionStart was logged for the shell');
  const source2 = start2.payload.source ?? start2.payload.session_start_type;
  expect(source2 === 'resume', `SessionStart source is resume, got ${source2}`);
  expect(start2.payload.session_id === hosted.claudeSessionId, 'the same conversation id');
  expect(endsWithSub(start2.payload.cwd), `Claude started in packages/app, got ${start2.payload.cwd}`);
  expect(bound.conversation?.id === hosted.claudeSessionId, 'the conversation is still on the record');
  await sleep(1500);
  const screen2 = await screenOf(s, pane.id);
  // The typed line itself is gone: Claude Code clears the screen as it
  // starts. The SessionStart with source resume on the shell says it ran.
  expect(screen2.includes(marker2), 'the earlier reply is back on screen');
  step(`resume of a shell that hosted a conversation: back in packages/app with claude --resume typed, reported in ${Date.now() - t1} ms`);
  await s.screenshot('m5-claude-resume-shell.png');
  await s.evalJs(`document.querySelector('.term-host .xterm-helper-textarea')?.focus()`);
  await typeLine(s, '/exit');
  const shellAgain = await waitState(s, shellId, (i) => i.claudeSessionId === null && i.state === 'idle', 'the pane a shell again after /exit', 30000);
  expect(shellAgain.pid !== null && shellAgain.exitCode === null && endsWithSub(shellAgain.cwd), 'a live shell in packages/app');
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m5-claude-resume-fail.png').catch(() => {});
  if (claudeId !== null) console.error('[verify] events:', eventsFor(claudeId).map((e) => `${e.event}/${e.outcome}`).join(', '));
  if (shellId !== null) console.error('[verify] shell events:', eventsFor(shellId).map((e) => `${e.event}/${e.outcome}`).join(', '));
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  if (claudeId !== null) await zreq(s, 'session.kill', { sessionId: claudeId }).catch(() => {});
  if (shellId !== null) await zreq(s, 'session.kill', { sessionId: shellId }).catch(() => {});
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
