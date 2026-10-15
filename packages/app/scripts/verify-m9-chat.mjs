// M9 fixes 689 and 690 acceptance: a Claude session's chat face. Block
// `stub` (fix 689) plays Claude with a shell and a fixture transcript: the
// empty pane's `opens on` pair, the title's face button, the timeline
// drawn from the transcript and re-read as it grows, the box typing into
// the session, Stop while it works, the chord, a reload, the shade over
// the chat face, and a pane shown another session falling back to the
// terminal. Block `ask` (fix 690, needs stub) answers a permission from
// the chat view's card and opens and closes the fallback bar. Block `real`
// (fix 690) starts a real Claude Code from the empty pane on the chat
// face and sends it one short turn, so this script costs one short real
// Claude turn and runs one at a time like verify:claude-resume; it needs
// hooks installed and trusts the repo the user trusts (no bypass flag).
// Run: npm run verify:chat -w @emerald/app [-- --only stub,ask]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm9-chat-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m9-chat';
const { CTRL, SHIFT, blockRunner, clickNewShell, emeraldHome, expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, step, stopDaemon, zreq } = await import('./cdp.mjs');

const { block, blocksRun, partial } = blockRunner([
  { name: 'stub', fixes: ['689'], needs: [] },
  { name: 'ask', fixes: ['690'], needs: ['stub'] },
  { name: 'real', fixes: ['690'], needs: [] },
]);

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 300 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 300000);

const home = os.homedir();
const s = await launch(freshPort(), { freshState: true });
app = s;

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const paneSel = (id) => `.pane[data-pane-id=${JSON.stringify(id)}]`;
const screen = (sessionId) => zreq(s, 'pty.screen', { sessionId });
const cursorRow = async (sessionId) => {
  const sc = await screen(sessionId);
  return sc.rows[sc.cursor.y] ?? '';
};
const waitCursorRow = async (sessionId, test, what) => {
  const until = Date.now() + 10000;
  while (Date.now() < until && !test(await cursorRow(sessionId))) await sleep(200);
  expect(test(await cursorRow(sessionId)), `${what}, got ${JSON.stringify(await cursorRow(sessionId))}`);
};
const typeRaw = (sessionId, text) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(sessionId)}, data: ${JSON.stringify(text)} })`);
const record = async (id) => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id);
const waitRecord = async (id, pred, what, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await record(id);
    if (r !== undefined && pred(r)) return r;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what} (record ${JSON.stringify(await record(id))?.slice(0, 300)})`);
};
// A reload that has happened: the old document carries a mark the new
// one does not, so a read after this never lands on the page going away.
const reload = async () => {
  await s.evalJs('window.__beforeReload = true');
  await s.send('Page.reload');
  await s.waitFor(`!window.__beforeReload && !!document.querySelector('.app-body')`, 'the app after the reload', 15000);
};
const timeline = (paneId) =>
  s.evalJs(`(() => {
    const p = ${q(paneSel(paneId))};
    if (!p) return null;
    return {
      prompts: [...p.querySelectorAll('.chat-prompt')].map((e) => e.textContent),
      thinking: [...p.querySelectorAll('.chat-step[data-kind="thinking"] .chat-thinking-head')].map((e) => e.textContent),
      tools: [...p.querySelectorAll('.chat-step[data-kind="tool"]')].map((e) => ({ tool: e.dataset.tool, tone: e.querySelector('.chat-dot')?.dataset.tone ?? null, arg: e.querySelector('.chat-tool-arg')?.textContent ?? '', result: e.querySelector('.chat-tool-result')?.textContent ?? '' })),
      replies: [...p.querySelectorAll('.chat-reply')].map((e) => e.textContent),
    };
  })()`);

// A transcript in the shapes Claude Code 2.1.300 writes (fix 688's parse).
const T = Date.parse('2026-10-15T14:02:00.000Z');
const at = (sec) => new Date(T + sec * 1000).toISOString();
const line = (o) => JSON.stringify({ isSidechain: false, ...o });
const userLine = (content, sec, extra = {}) => line({ type: 'user', message: { role: 'user', content }, timestamp: at(sec), ...extra });
const asstLine = (content, sec, extra = {}) => line({ type: 'assistant', message: { role: 'assistant', content }, timestamp: at(sec), ...extra });
const useOf = (id, name, input) => ({ type: 'tool_use', id, name, input });
const resultOf = (id, content, sec, extra = {}, isError = false) => userLine([{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }], sec, extra);
const fixtureLines = [
  userLine('run the browser check and fix what fails', 0),
  asstLine([{ type: 'thinking', thinking: '', signature: 'x' }], 6, { thinkingDurationMs: 6000 }),
  asstLine([useOf('b1', 'Bash', { command: 'npm run verify:browser' })], 7),
  resultOf('b1', 'PASS', 45, { toolUseResult: { stdout: 'PASS', stderr: '', interrupted: false } }),
  asstLine([useOf('b2', 'Bash', { command: 'npm run verify:design' })], 46),
  resultOf('b2', 'Exit code 3\nFAIL', 47, { toolUseResult: 'Error: Exit code 3\nFAIL' }, true),
  asstLine([useOf('e1', 'Edit', { file_path: 'C:/sim/session.ts', old_string: 'a', new_string: 'b' })], 48),
  resultOf('e1', 'ok', 49, { toolUseResult: { filePath: 'C:/sim/session.ts', structuredPatch: [{ lines: [' x', '-a', '+b', '+c', '+d'] }, { lines: ['-e', '+f', '+g', '+h'] }] } }),
  asstLine([{ type: 'text', text: 'Done.' }], 50),
];
const fixtureDir = path.join(emeraldHome, 'chat-689');
const fixture = path.join(fixtureDir, 'fixture.jsonl');

let stubId = null;
let stubPane = null;
let post = null;
let realId = null;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');

  await block('stub', async () => {
    // (a) M9 fix 689: the pair shows for Claude session alone, Terminal
    // pressed by default, and a click is remembered at once.
    await s.evalJs(`${q('.empty-pane .empty-kind[data-kind="claude"]')}.click()`);
    await s.waitFor(`!!${q('.empty-opens')}`, 'the opens-on pair under Claude session');
    const pressed = () => s.evalJs(`[...document.querySelectorAll('.empty-opens button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)`);
    expect(JSON.stringify(await pressed()) === '["Terminal"]', `Terminal pressed by default, got ${JSON.stringify(await pressed())}`);
    expect((await s.evalJs(`${q('.empty-opens')}.closest('.empty-pair')`)) === null, 'the pair is not an .empty-pair');
    await s.evalJs(`${q('.empty-opens-chat')}.click()`);
    await s.waitFor(`localStorage.getItem('emerald.claudeOpensOn') === 'chat' && ${q('.empty-opens-chat')}.getAttribute('aria-pressed') === 'true'`, 'Chat picked and remembered');
    await s.evalJs(`${q('.empty-opens-terminal')}.click()`);
    await s.waitFor(`localStorage.getItem('emerald.claudeOpensOn') === 'terminal'`, 'Terminal picked and remembered');
    await s.evalJs(`${q('.empty-pane .empty-kind[data-kind="shell"]')}.click()`);
    await s.waitFor(`!${q('.empty-opens')}`, 'no pair under Shell');
    step('fix 689 (a): the opens-on pair shows under Claude session alone, Terminal by default, each click remembered');

    // (b) A shell playing Claude, its transcript the fixture.
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixture, fixtureLines.join('\n') + '\n');
    await clickNewShell(s, home);
    await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'a shell in the first pane');
    const layout = await getLayout(s);
    stubPane = leaves(layout)[0].id;
    stubId = leaves(layout)[0].sessionId;
    const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
    post = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': stubId },
        body: JSON.stringify({ session_id: 'sim-chat-689', cwd: 'C:/sim', transcript_path: fixture, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await post({ hook_event_name: 'SessionStart', source: 'startup' });
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'run the browser check and fix what fails' });
    await post({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(stubId, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the stub bound with its transcript', 10000);

    // (c) The title's face button flips the pane to the chat; the terminal
    // stays mounted under it, hidden.
    await s.waitFor(`!!${q(paneSel(stubPane) + ' .pane-face-toggle')}`, 'the face button on a Claude pane');
    const title = await s.evalJs(`${q(paneSel(stubPane) + ' .pane-face-toggle')}.title`);
    expect(title.startsWith('Show the chat'), `the button offers the chat, got ${title}`);
    await s.evalJs(`${q(paneSel(stubPane) + ' .pane-face-toggle')}.click()`);
    await s.waitFor(`${q(paneSel(stubPane))}.dataset.face === 'chat'`, 'the pane on the chat face');
    expect(await s.evalJs(`!!${q(paneSel(stubPane) + ' .term-host')}?.emeraldTerm`), 'the terminal is still mounted with its xterm');
    expect((await s.evalJs(`getComputedStyle(${q(paneSel(stubPane) + ' .term-host')}).visibility`)) === 'hidden', 'and hidden');
    const stored = await s.evalJs(`localStorage.getItem('emerald.chatPanes')`);
    expect(stored === JSON.stringify([[stubPane, stubId]]), `the face is stored against the session, got ${stored}`);
    step('fix 689 (c): the title button turns the pane to its chat face, the terminal kept hidden under it');

    // (d) The timeline drawn from the transcript.
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(paneSel(stubPane) + ' .chat-reply')}).length === 1`, 'the timeline drawn', 5000);
    const tl = await timeline(stubPane);
    expect(tl.prompts.length === 1 && tl.prompts[0] === 'run the browser check and fix what fails', `one prompt, got ${JSON.stringify(tl.prompts)}`);
    expect(JSON.stringify(tl.thinking) === '["Thought for 6s"]', `the thinking step, got ${JSON.stringify(tl.thinking)}`);
    expect(JSON.stringify(tl.tools.map((t) => t.tone)) === '["done","error","done"]', `the dots, got ${JSON.stringify(tl.tools)}`);
    expect(JSON.stringify(tl.tools.map((t) => t.result)) === JSON.stringify(['exit 0 · 38s', 'exit 3 · 1s', '+6 \u22122']), `the results, got ${JSON.stringify(tl.tools.map((t) => t.result))}`);
    expect(tl.tools[0].arg === 'npm run verify:browser', `the Bash row's argument, got ${tl.tools[0].arg}`);
    expect(tl.replies.at(-1) === 'Done.', `the reply, got ${JSON.stringify(tl.replies)}`);
    await s.screenshot('m9-chat-stub.png');
    step(`fix 689 (d): the timeline reads ${tl.tools.map((t) => `${t.tool} ${t.result}`).join(', ')} and the reply`);

    // (e) The transcript grows and the view follows it.
    fs.appendFileSync(fixture, [userLine('now the design check', 60), asstLine([{ type: 'text', text: 'Also done.' }], 70)].join('\n') + '\n');
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(paneSel(stubPane) + ' .chat-prompt')}).length === 2`, 'the second turn drawn within 5 s', 5000);
    step('fix 689 (e): a second turn appended to the transcript is drawn');

    // (f) The box sends into the session, with Claude's pause before Enter.
    await s.waitFor(`document.activeElement === ${q(paneSel(stubPane) + ' .chat-box')}`, 'the box holds the keyboard');
    await s.type('echo chat689');
    await s.key('Enter', 'Enter', 13);
    expect((await s.evalJs(`${q(paneSel(stubPane) + ' .chat-box')}.value`)) === '', 'the box cleared at once');
    const until = Date.now() + 10000;
    while (Date.now() < until && !(await screen(stubId)).rows.some((r) => r.trim() === 'chat689')) await sleep(200);
    expect((await screen(stubId)).rows.some((r) => r.trim() === 'chat689'), 'the shell ran what the box sent');
    step('fix 689 (f): Enter in the box typed the line into the session');

    // (g) Stop while it works, and the hint.
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'keep going' });
    await s.waitFor(`!!${q(paneSel(stubPane) + ' .chat-stop')}`, 'Stop while working');
    const hint = await s.evalJs(`${q(paneSel(stubPane) + ' .chat-hint')}.textContent`);
    expect(hint === 'Sent when the turn ends', `the hint while working, got ${hint}`);
    await post({ hook_event_name: 'Stop', stop_hook_active: false });
    await s.waitFor(`!${q(paneSel(stubPane) + ' .chat-stop')}`, 'Stop gone after the turn');
    step('fix 689 (g): Stop and the hint while the session works, gone when it stops');

    // (h) The chord flips the face both ways, the keyboard following.
    await s.key('M', 'KeyM', 77, CTRL | SHIFT);
    await s.waitFor(`${q(paneSel(stubPane))}.dataset.face === undefined`, 'the chord back to the terminal');
    await s.waitFor(`document.activeElement?.classList.contains('xterm-helper-textarea') && ${q(paneSel(stubPane))}.contains(document.activeElement)`, 'the keyboard in the terminal');
    await s.key('M', 'KeyM', 77, CTRL | SHIFT);
    await s.waitFor(`${q(paneSel(stubPane))}.dataset.face === 'chat'`, 'the chord to the chat');
    await s.waitFor(`document.activeElement === ${q(paneSel(stubPane) + ' .chat-box')}`, 'the keyboard in the box');
    step('fix 689 (h): Ctrl+Shift+M flips the face and the keyboard with it');

    // (i) A reload keeps the face.
    await reload();
    await s.waitFor(`!!document.querySelector('.app-body') && ${q(paneSel(stubPane))}?.dataset.face === 'chat'`, 'the chat face after the reload', 15000);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(paneSel(stubPane) + ' .chat-prompt')}).length === 2`, 'the timeline after the reload', 5000);
    step('fix 689 (i): the face survives a reload');

    // (k) The shade covers the chat face.
    await s.evalJs(`${q(paneSel(stubPane) + ' .pane-shade-toggle')}.click()`);
    await s.waitFor(`!!${q(paneSel(stubPane) + ' .pane-shade')}`, 'the shade down');
    const over = await s.evalJs(`(() => { const r = ${q(paneSel(stubPane) + ' .term-wrap')}.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { shade: !!el?.closest('.pane-shade'), chat: !!el?.closest('.chat-view') }; })()`);
    expect(over.shade && !over.chat, `the shade is over the chat view at the pane's centre, got ${JSON.stringify(over)}`);
    await s.evalJs(`${q(paneSel(stubPane) + ' .pane-shade')}.click()`);
    await s.waitFor(`!${q(paneSel(stubPane) + ' .pane-shade')}`, 'the shade lifted');
    await s.waitFor(`document.activeElement === ${q(paneSel(stubPane) + ' .chat-box')}`, 'the keyboard back in the box');
    step('fix 689 (k): the shade covers the chat face and lifts back to the box');

    // (j) A pane shown another session is on the terminal and leaves the
    // set; the stub put back opens on the terminal too.
    const other = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 120, rows: 30 });
    let lay = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...lay, root: { ...lay.root, sessionId: other.session.id } } });
    await s.waitFor(`${q(paneSel(stubPane))}?.dataset.face === undefined && !(localStorage.getItem('emerald.chatPanes') ?? '').includes(${JSON.stringify(stubPane)})`, 'another session on the terminal, the entry gone');
    lay = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...lay, root: { ...lay.root, sessionId: stubId } } });
    await s.waitFor(`!!${q(paneSel(stubPane) + ' .pane-face-toggle')}`, 'the stub back in the pane');
    await sleep(300);
    expect((await s.evalJs(`${q(paneSel(stubPane))}.dataset.face ?? null`)) === null, 'the stub put back opens on the terminal');
    await zreq(s, 'session.kill', { sessionId: other.session.id }).catch(() => {});
    step('fix 689 (j): another session in the pane drops the chat face; the stub comes back on the terminal');
  });

  await block('ask', async () => {
    // M9 fix 690: the stub, on its terminal face and focused, turned to
    // the chat; a permission asked for an edit, the dialog on its screen
    // with the cursor on the last option (verify:answer's shape).
    await s.evalJs(`${q(paneSel(stubPane) + ' .pane-face-toggle')}.click()`);
    await s.waitFor(`${q(paneSel(stubPane))}.dataset.face === 'chat'`, 'the stub on the chat face');
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'edit the session file' });
    await post({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:/sim/session.ts' } });
    await waitRecord(stubId, (r) => r.state === 'working', 'the stub working', 5000);
    await typeRaw(stubId, `cls; Write-Host ''; Write-Host 'Do you want to make this edit to session.ts?'; Write-Host '> 1. Yes'; Write-Host '  2. Yes, allow all edits during this session'; Write-Host -NoNewline '  3. No, and tell Claude what to do differently'; Read-Host | Out-Null\r`);
    await waitCursorRow(stubId, (row) => row.trim().endsWith('differently'), 'the cursor sits at the end of the last option');
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'Edit', tool_input: { file_path: 'C:/sim/session.ts' } });
    await s.waitFor(`!!${q(paneSel(stubPane) + ' .chat-ask-option[data-key="3"]')}`, 'the ask card with its options');
    const card = await s.evalJs(`(() => { const c = ${q(paneSel(stubPane) + ' .chat-step[data-kind="ask"]')}; const box = ${q(paneSel(stubPane) + ' .chat-box')}; return { heading: c.querySelector('.chat-ask-heading')?.textContent ?? null, tone: c.querySelector('.chat-dot')?.dataset.tone ?? null, lines: (c.querySelector('.chat-ask-screen')?.textContent ?? '').split('\\n'), keys: [...c.querySelectorAll('.chat-ask-option')].map((b) => b.dataset.key), disabled: box.disabled, placeholder: box.placeholder, hint: ${q(paneSel(stubPane) + ' .chat-hint')}.textContent }; })()`);
    expect(card.heading === 'Claude is asking permission', `the heading, got ${card.heading}`);
    expect(card.tone === 'blocked', `the card's dot is blocked, got ${card.tone}`);
    expect(card.lines[0] === 'Do you want to make this edit to session.ts?', `the excerpt's first line, got ${JSON.stringify(card.lines)}`);
    expect(JSON.stringify(card.keys) === JSON.stringify(['1', '2', '3', 'esc']), `three options and Esc, got ${JSON.stringify(card.keys)}`);
    expect(card.disabled && card.placeholder === 'Answer the ask above, or press Esc to cancel', `the box is disabled under the card, got ${JSON.stringify(card)}`);
    expect(card.hint === 'The ask takes the keys', `the hint, got ${card.hint}`);
    await s.screenshot('m9-chat-ask.png');
    await s.waitFor(`document.activeElement === ${q(paneSel(stubPane) + ' .chat-step[data-kind="ask"]')}`, 'the card holds the keyboard');
    await s.key('2', 'Digit2', 50);
    await waitCursorRow(stubId, (row) => row.trim().endsWith('differently2'), 'the 2 key reached the session');
    step('fix 690: the ask is a card on the rail, the box disabled under it, and the 2 key answers it');
    await typeRaw(stubId, '\r');
    // The stub's own artifact: the Read-Host's command ends at the shell's
    // prompt with hooks landed during it, which the daemon reads as Claude
    // leaving the shell (state-machine.ts's leave), so the pane is a plain
    // shell for a moment. The Stop is posted after that, binding it again,
    // or it races the prompt and the face flips under the next step.
    await waitRecord(stubId, (r) => r.command?.state !== 'running', 'the Read-Host ended at the prompt', 10000);
    await post({ hook_event_name: 'Stop', stop_hook_active: false });
    try {
      await s.waitFor(`!${q(paneSel(stubPane) + ' .chat-step[data-kind="ask"]')} && ${q(paneSel(stubPane) + ' .chat-box')}?.disabled === false`, 'the card gone and the box back');
    } catch (err) {
      throw new Error(`${err.message}: face ${await s.evalJs(`${q(paneSel(stubPane))}?.dataset.face ?? null`)}, record ${JSON.stringify(await record(stubId))}`);
    }
    await s.waitFor(`document.activeElement === ${q(paneSel(stubPane) + ' .chat-box')} && ${q(paneSel(stubPane))}.dataset.face === 'chat'`, 'the keyboard back in the box');
    step('fix 690: the turn ends, the card goes and the box takes the keyboard again');

    // The fallback bar: Escape closes it; so does the transcript growing;
    // so does Show the terminal, which flips the face.
    const sendModel = async () => {
      await s.waitFor(`document.activeElement === ${q(paneSel(stubPane) + ' .chat-box')}`, 'the box holds the keyboard');
      await s.type('/model');
      await s.key('Enter', 'Enter', 13);
      try {
        await s.waitFor(`!!${q(paneSel(stubPane) + ' .chat-fallback')}`, 'the fallback bar', 5000);
      } catch (err) {
        throw new Error(`${err.message}: box ${JSON.stringify(await s.evalJs(`${q(paneSel(stubPane) + ' .chat-box')}?.value ?? null`))}, hint ${JSON.stringify(await s.evalJs(`${q(paneSel(stubPane) + ' .chat-hint')}?.textContent ?? null`))}, face ${await s.evalJs(`${q(paneSel(stubPane))}?.dataset.face ?? null`)}, record ${JSON.stringify(await record(stubId))?.slice(0, 200)}, stub ${stubPane}`);
      }
    };
    await sendModel();
    const words = await s.evalJs(`${q(paneSel(stubPane) + ' .chat-fallback-text')}.textContent`);
    expect(words === 'The terminal is showing a menu this view cannot draw', `the bar's words, got ${words}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!${q(paneSel(stubPane) + ' .chat-fallback')}`, 'Escape closed the bar', 2000);
    await sendModel();
    fs.appendFileSync(fixture, line({ type: 'system', subtype: 'local_command', content: '<local-command-stdout>Kept model</local-command-stdout>', timestamp: at(80) }) + '\n');
    await s.waitFor(`!${q(paneSel(stubPane) + ' .chat-fallback')}`, 'the transcript growing closed the bar', 5000);
    await sendModel();
    await s.evalJs(`${q(paneSel(stubPane) + ' .chat-fallback-show')}.click()`);
    await s.waitFor(`${q(paneSel(stubPane))}.dataset.face === undefined && !${q(paneSel(stubPane) + ' .chat-fallback')}`, 'Show the terminal flipped the face');
    step('fix 690: /model shows the fallback bar; Escape, the transcript growing and Show the terminal each close it');
  });

  await block('real', async () => {
    // M9 fix 690: a real Claude Code started from the empty pane on the
    // chat face, in the repo the user trusts, one short turn.
    let lay = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...lay, root: { ...lay.root, sessionId: null } } });
    await s.evalJs(`localStorage.setItem('emerald.recentFolders', ${JSON.stringify(JSON.stringify([repoRoot]))})`);
    await reload();
    await s.waitFor(`!!document.querySelector('.app-body') && !!document.querySelector('.empty-folder')`, 'the empty pane with its folders', 15000);
    const norm = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const picked = await s.evalJs(`(() => { const b = [...document.querySelectorAll('.empty-folder')].find((e) => e.dataset.folder.replace(/\\//g, '\\\\').replace(/\\\\+$/, '').toLowerCase() === ${JSON.stringify(norm(repoRoot))}); if (!b) return null; b.click(); return b.dataset.folder; })()`);
    expect(picked !== null, `the repo's row among the folders, got ${JSON.stringify(await s.evalJs(`[...document.querySelectorAll('.empty-folder')].map((e) => e.dataset.folder)`))}`);
    await s.evalJs(`${q('.empty-pane .empty-kind[data-kind="claude"]')}.click()`);
    await s.waitFor(`!!${q('.empty-opens-chat')}`, 'the pair');
    await s.evalJs(`${q('.empty-opens-chat')}.click()`);
    await s.waitFor(`${q('.empty-pane .empty-start')}?.disabled === false`, 'Start ready');
    await s.evalJs(`${q('.empty-pane .empty-start')}.click()`);
    await s.waitFor(`!!document.querySelector('.pane[data-face="chat"]')`, 'the new session on the chat face', 15000);
    lay = await getLayout(s);
    const pane = leaves(lay)[0];
    realId = pane.sessionId;
    expect(realId !== null, 'the pane holds the new session');
    await waitRecord(realId, (r) => r.state === 'idle' && r.claudeSessionId !== null, 'the real Claude idle', 30000);
    await sleep(2000);
    step(`fix 690: a real Claude started from the empty pane opens on the chat face (${realId.slice(0, 8)})`);

    const hooksLog = path.join(emeraldHome, 'logs', 'hooks.jsonl');
    const eventsFor = (id) =>
      (fs.existsSync(hooksLog) ? fs.readFileSync(hooksLog, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((l) => l.sessionId === id);
    const marker = 'emerald' + (Date.now() % 100000);
    const prompt = `Use the Bash tool to run this exact command: echo chat-${marker}. Then reply with exactly the word ${marker} and nothing else.`;
    await s.waitFor(`document.activeElement === ${q(paneSel(pane.id) + ' .chat-box')}`, 'the box holds the keyboard');
    await s.type(prompt);
    await s.key('Enter', 'Enter', 13);
    const workBy = Date.now() + 15000;
    let nudged = false;
    while (Date.now() < workBy) {
      const r = await record(realId);
      if (r.state !== 'idle') break;
      if (!nudged && Date.now() > workBy - 10000 && !eventsFor(realId).some((e) => e.event === 'UserPromptSubmit')) {
        console.log('[verify] note: no UserPromptSubmit 5 s after the send; Enter once more in the box');
        nudged = true;
        await s.evalJs(`${q(paneSel(pane.id) + ' .chat-box')}.focus()`);
        await s.key('Enter', 'Enter', 13);
        await typeRaw(realId, '\r');
      }
      await sleep(200);
    }
    const stopBy = Date.now() + 90000;
    let answered = false;
    while (Date.now() < stopBy && !eventsFor(realId).some((e) => e.event === 'Stop')) {
      if (!answered && (await record(realId)).state === 'needs-input') {
        await s.waitFor(`!!${q(paneSel(pane.id) + ' .chat-ask-option[data-key="1"]')}`, 'the card offers 1', 10000);
        await s.evalJs(`${q(paneSel(pane.id) + ' .chat-ask-option[data-key="1"]')}.click()`);
        answered = true;
        console.log('[verify] note: the echo was asked for; answered 1 on the card');
      }
      await sleep(250);
    }
    expect(eventsFor(realId).some((e) => e.event === 'Stop'), 'Stop logged for the real turn');
    const drawn = `(() => { const p = ${q(paneSel(pane.id))}; const tools = [...p.querySelectorAll('.chat-step[data-kind="tool"][data-tool="Bash"]')]; const bash = tools.find((t) => (t.querySelector('.chat-tool-arg')?.textContent ?? '').includes(${JSON.stringify(`echo chat-${marker}`)})); const replies = [...p.querySelectorAll('.chat-reply')]; return { prompt: [...p.querySelectorAll('.chat-prompt')].some((e) => e.textContent === ${JSON.stringify(prompt)}), tone: bash?.querySelector('.chat-dot')?.dataset.tone ?? null, result: bash?.querySelector('.chat-tool-result')?.textContent ?? null, reply: replies.at(-1)?.textContent.trim() ?? null }; })()`;
    const okDrawn = `(() => { const d = ${drawn}; return d.prompt && d.tone === 'done' && (d.result ?? '').startsWith('exit 0') && d.reply === ${JSON.stringify(marker)}; })()`;
    try {
      await s.waitFor(okDrawn, 'the real turn drawn', 5000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify(await s.evalJs(drawn))}`);
    }
    await s.screenshot('m9-chat-real.png');
    step(`fix 690: the real turn is drawn: the prompt, Bash echo chat-${marker} with ${(await s.evalJs(drawn)).result}, the reply ${marker}`);

    // The same reply in the terminal underneath, and back.
    await s.evalJs(`${q(paneSel(pane.id) + ' .pane-face-toggle')}.click()`);
    await s.waitFor(`${q(paneSel(pane.id))}.dataset.face === undefined`, 'the terminal face');
    const term = await s.evalJs(`(() => { const t = ${q(paneSel(pane.id) + ' .term-host')}?.emeraldTerm; if (!t) return ''; const b = t.buffer.active; const lines = []; for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? ''); return lines.join('\\n'); })()`);
    expect(term.includes(marker), 'the reply is in the terminal under the chat face');
    await s.evalJs(`${q(paneSel(pane.id) + ' .pane-face-toggle')}.click()`);
    await s.waitFor(`${q(paneSel(pane.id))}.dataset.face === 'chat'`, 'the chat face again');
    step('fix 690: the terminal under the chat face holds the same reply');

    // /model opens the TUI's picker and the bar; Escape closes both.
    await s.waitFor(`document.activeElement === ${q(paneSel(pane.id) + ' .chat-box')}`, 'the box holds the keyboard');
    await s.type('/model');
    await s.key('Enter', 'Enter', 13);
    await s.waitFor(`!!${q(paneSel(pane.id) + ' .chat-fallback')}`, 'the fallback bar after /model', 5000);
    await sleep(1000);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!${q(paneSel(pane.id) + ' .chat-fallback')}`, 'Escape closed the bar', 2000);
    step('fix 690: /model on the real session shows the fallback bar, and Escape closes it');

    await sleep(1500);
    await s.waitFor(`document.activeElement === ${q(paneSel(pane.id) + ' .chat-box')}`, 'the box holds the keyboard');
    await s.type('/exit');
    await s.key('Enter', 'Enter', 13);
    await waitRecord(realId, (r) => r.state === 'exited' && r.exitCode === 0, 'the real Claude exited (0)', 30000);
    step('fix 690: /exit from the box ends the session with exit code 0');
  });

  step(`PASS (${blocksRun()})`);
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m9-chat-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  if (realId !== null) await zreq(s, 'session.kill', { sessionId: realId }).catch(() => {});
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
