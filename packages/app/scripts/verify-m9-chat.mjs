// M9 fixes 689 and 690 acceptance: a Claude session's chat face. Block
// `stub` (fix 689) plays Claude with a shell and a fixture transcript: the
// empty pane's `opens on` pair, the title's face button, the timeline
// drawn from the transcript and re-read as it grows, the box typing into
// the session, Stop while it works, the chord, a reload, the shade over
// the chat face, and a pane shown another session falling back to the
// terminal. Block `ask` (fix 690, needs stub) answers a permission from
// the chat view's card and opens and closes the fallback bar. Block
// `footer` (fix 713, needs stub) reads the footer's chips: the mode off
// the screen, the model and its effort, the agents, the diff. Block
// `views` (fix 714, needs stub) cycles Normal, Thinking and Verbose by
// Ctrl+O and the view chip's menu and opens a fold. Block `real`
// (fix 690) starts a real Claude Code from the empty pane on the chat
// face and sends it one short turn, so this script costs one short real
// Claude turn and runs one at a time like verify:claude-resume; it needs
// hooks installed and trusts the repo the user trusts (no bypass flag).
// Block `fresh` (fix 722) starts a second real Claude on the chat face in
// a folder Claude Code has never used, made under the checkout for this
// run, and reads that its first turn is drawn although the transcript's
// folder did not exist when the view first read it; it removes that
// folder and the project folder Claude Code made for it afterwards.
// Block `more` (fix 723) starts a real Claude from the empty pane's More...
// dialog with Chat picked and checks the face and the args.
// Block `turns` (fixes 752 and 753) plays Claude with a shell over a
// long fixture: opening or closing a turn's fold keeps the reply under
// the calls in place with a short tint, and the fold dots wear their
// calls' tones. Block `queued` (fix 754, needs turns) reads a message
// queued while the stub works, shown and then absorbed into its turn;
// the real block takes two queued messages back with Edit.
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
  { name: 'footer', fixes: ['713', '715', '743', '744', '745'], needs: ['stub'] },
  { name: 'views', fixes: ['714'], needs: ['stub'] },
  { name: 'reply', fixes: ['716'], needs: ['stub'] },
  { name: 'paths', fixes: ['717'], needs: ['reply'] },
  { name: 'thumbs', fixes: ['717', '718'], needs: ['stub'] },
  { name: 'edit-ask', fixes: ['717'], needs: ['stub'] },
  { name: 'real', fixes: ['690'], needs: [] },
  { name: 'fresh', fixes: ['722'], needs: [] },
  { name: 'menus', fixes: ['719', '720', '746', '749', '750', '751', '755'], needs: [] },
  { name: 'image', fixes: ['721', '747', '748'], needs: [] },
  { name: 'more', fixes: ['723'], needs: [] },
  { name: 'turns', fixes: ['752', '753'], needs: [] },
  { name: 'queued', fixes: ['754'], needs: ['turns'] },
]);

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 600 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 600000);

const home = os.homedir();
// Fix 721's attach button: the file chooser answers this path.
const attachPng = path.join(emeraldHome, 'chat-721', 'attach.png');
const s = await launch(freshPort(), { freshState: true, env: { EMERALD_PICK_FILE: attachPng } });
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
// A file dropped at the centre of the element a selector names, as the OS
// drops one: a hidden file input holds it, then dragenter, dragover and
// drop at elementFromPoint (fix 721's recipe, a helper since fix 746).
const dropOn = async (file, selector) => {
  await s.evalJs(
    `(() => { let i = document.getElementById('verify-drop'); if (i === null) { i = document.createElement('input'); i.type = 'file'; i.id = 'verify-drop'; i.style.display = 'none'; document.body.appendChild(i); } })()`,
  );
  const input = await s.send('Runtime.evaluate', { expression: `document.getElementById('verify-drop')` });
  await s.send('DOM.setFileInputFiles', { files: [file], objectId: input.result.objectId });
  const at = await s.evalJs(`(() => { const r = ${q(selector)}.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    await s.evalJs(
      `(() => { const dt = new DataTransfer(); dt.items.add(document.getElementById('verify-drop').files[0]); const el = document.elementFromPoint(${at.x}, ${at.y}) ?? document.body; el.dispatchEvent(new DragEvent(${JSON.stringify(type)}, { dataTransfer: dt, clientX: ${at.x}, clientY: ${at.y}, bubbles: true, cancelable: true, relatedTarget: null })); })()`,
    );
  }
};
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
// The chat opens on Normal from fix 714 on, which folds tool rows and
// hides thinking; a block of fixes 716 to 718 that reads those picks
// Verbose first, Ctrl+O from the box until the footer's view chip (below)
// says so, and does nothing on a tree with no view chip.
const toVerbose = async (paneId) => {
  if ((await viewWord(paneId)) === null) return;
  for (let i = 0; i < 3 && (await viewWord(paneId)) !== 'Verbose'; i++) {
    await s.evalJs(`${q(paneSel(paneId) + ' .chat-box')}.focus()`);
    await s.key('o', 'KeyO', 79, CTRL);
    await sleep(150);
  }
  await waitView(paneId, 'Verbose');
};
// The stub on its chat face, whatever the block before left it on.
const toChat = async (paneId) => {
  if ((await s.evalJs(`${q(paneSel(paneId))}.dataset.face ?? null`)) !== 'chat') await s.evalJs(`${q(paneSel(paneId) + ' .pane-face-toggle')}.click()`);
  await s.waitFor(`${q(paneSel(paneId))}.dataset.face === 'chat'`, 'the stub on the chat face');
};

// M9 fix 714: a chat opens on Normal, its tool calls folded, so a read
// of tool rows or thinking picks Verbose first through the view chip.
const viewChip = (paneId) => paneSel(paneId) + ' .chat-chip[data-chip="view"]';
const viewWord = (paneId) => s.evalJs(`${q(viewChip(paneId) + ' .chat-chip-word')}?.textContent ?? null`);
const waitView = async (paneId, word) => {
  try {
    await s.waitFor(`${q(viewChip(paneId) + ' .chat-chip-word')}?.textContent === ${JSON.stringify(word)}`, `the view chip reading ${word}`, 3000);
  } catch (err) {
    throw new Error(`${err.message}: got ${JSON.stringify(await viewWord(paneId))}`);
  }
};
const pickView = async (paneId, word) => {
  await s.evalJs(`${q(viewChip(paneId))}.click()`);
  await s.waitFor(`!!document.querySelector('.menu.chat-view-menu')`, 'the view menu', 3000);
  await s.evalJs(`[...document.querySelectorAll('.menu.chat-view-menu .menu-item')].find((b) => b.querySelector('.menu-label')?.textContent.replace(/^✓/, '') === ${JSON.stringify(word)}).click()`);
  await s.waitFor(`!document.querySelector('.menu.chat-view-menu')`, 'the view menu closed', 3000);
  await waitView(paneId, word);
};

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
// The home may be named by its 8.3 short form (%TEMP% under a long user
// name) while a session's cwd is the long one, so the paths the view
// draws are read against the long form (once stub has made the folder).
const longFixtureDir = () => fs.realpathSync.native(fixtureDir);

let stubId = null;
let stubPane = null;
let post = null;
let realId = null;
let freshId = null;
let freshDir = null;
let freshProject = null;
let menusId = null;
let imageId = null;
// M9 fixes 752 to 754: the turns stub, which `queued` reuses.
let turnsId = null;
let turnsPane = null;
let postTurns = null;
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
    const chip = await s.evalJs(`(() => { const c = ${q(paneSel(stubPane) + ' .pane-preview')}; return c === null ? null : { text: c.textContent, title: c.title }; })()`);
    expect(chip !== null && chip.text === 'Preview' && chip.title === 'The chat view is in progress; the terminal has everything', `fix 737: the Preview chip on the chat face, got ${JSON.stringify(chip)}`);
    const stored = await s.evalJs(`localStorage.getItem('emerald.chatPanes')`);
    expect(stored === JSON.stringify([[stubPane, stubId]]), `the face is stored against the session, got ${stored}`);
    step('fix 689 (c): the title button turns the pane to its chat face, the terminal kept hidden under it');

    // (d) The timeline drawn from the transcript, every step of it in
    // Verbose (fix 714; a chat opens on Normal).
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(paneSel(stubPane) + ' .chat-reply')}).length === 1`, 'the timeline drawn', 5000);
    await pickView(stubPane, 'Verbose');
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
    expect((await s.evalJs(`!!${q(paneSel(stubPane) + ' .pane-preview')}`)) === false, 'fix 737: the Preview chip is gone on the terminal face');
    step('fix 737: the chat face carries the Preview chip with its tooltip, the terminal face none');
    await s.waitFor(`document.activeElement?.classList.contains('xterm-helper-textarea') && ${q(paneSel(stubPane))}.contains(document.activeElement)`, 'the keyboard in the terminal');
    await s.key('M', 'KeyM', 77, CTRL | SHIFT);
    await s.waitFor(`${q(paneSel(stubPane))}.dataset.face === 'chat'`, 'the chord to the chat');
    await s.waitFor(`document.activeElement === ${q(paneSel(stubPane) + ' .chat-box')}`, 'the keyboard in the box');
    step('fix 689 (h): Ctrl+Shift+M flips the face and the keyboard with it');

    // (i) A reload keeps the face, and the view mode with it (fix 714).
    // The chord's flip left the face, which leaves the mode: it opens on
    // Normal again, so Verbose is picked once more before the reload.
    await waitView(stubPane, 'Normal');
    await pickView(stubPane, 'Verbose');
    await reload();
    await s.waitFor(`!!document.querySelector('.app-body') && ${q(paneSel(stubPane))}?.dataset.face === 'chat'`, 'the chat face after the reload', 15000);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(paneSel(stubPane) + ' .chat-prompt')}).length === 2`, 'the timeline after the reload', 5000);
    await waitView(stubPane, 'Verbose');
    const storedMode = await s.evalJs(`localStorage.getItem('emerald.chatPanes')`);
    expect(storedMode === JSON.stringify([[stubPane, stubId, 'verbose']]), `the mode is stored with the face, got ${storedMode}`);
    step('fix 689 (i): the face survives a reload, and fix 714: the view mode with it (a flip to the terminal and back opened on Normal)');

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

  await block('footer', async () => {
    // M9 fix 713: the footer's chips. The ask block left the stub on its
    // terminal face, idle or done, its screen holding the Read-Host's rows.
    const foot = (chip) => paneSel(stubPane) + ` .chat-chip[data-chip="${chip}"]`;
    const chipWord = (chip) => s.evalJs(`${q(foot(chip) + ' .chat-chip-word')}?.textContent ?? null`);
    const waitChip = async (chip, want, ms = 3000) => {
      try {
        await s.waitFor(`${q(foot(chip) + ' .chat-chip-word')}?.textContent === ${JSON.stringify(want)}`, `the ${chip} chip reading ${want}`, ms);
      } catch (err) {
        throw new Error(`${err.message}: got ${JSON.stringify(await chipWord(chip))}`);
      }
    };
    const boxHasKeys = () => s.waitFor(`document.activeElement === ${q(paneSel(stubPane) + ' .chat-box')}`, 'the box holds the keyboard');
    // Bound again as Claude if the stub's own artifact (the ask block's
    // note) took the face while a command ran.
    const backOnChat = async () => {
      await waitRecord(stubId, (r) => r.command?.state !== 'running', 'the command ended at the prompt', 10000);
      await sleep(300);
      if ((await s.evalJs(`${q(paneSel(stubPane))}.dataset.face ?? null`)) !== 'chat') {
        await post({ hook_event_name: 'Stop', stop_hook_active: false });
        await s.waitFor(`!!${q(paneSel(stubPane) + ' .pane-face-toggle')}`, 'the face button again');
        if ((await s.evalJs(`${q(paneSel(stubPane))}.dataset.face ?? null`)) !== 'chat') await s.evalJs(`${q(paneSel(stubPane) + ' .pane-face-toggle')}.click()`);
        await s.waitFor(`${q(paneSel(stubPane))}.dataset.face === 'chat'`, 'the stub back on the chat face');
      }
    };

    // (a) Only the diff reads: no mode row on the screen, no status line,
    // no team; the fixture's one edit is +6 −2.
    await s.evalJs(`${q(paneSel(stubPane) + ' .pane-face-toggle')}.click()`);
    await s.waitFor(`${q(paneSel(stubPane))}.dataset.face === 'chat'`, 'the stub on the chat face');
    await boxHasKeys();
    await sleep(1500);
    const present = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(paneSel(stubPane) + ' .chat-chip')})].map((c) => c.dataset.chip)`);
    expect(JSON.stringify(present) === '["view","diff"]', `the view chip (fix 714) and the diff chip alone, got ${JSON.stringify(present)}`);
    const diffText = await s.evalJs(`${q(foot('diff'))}.textContent`);
    expect(diffText === '+6 −2', `the diff chip reads the fixture's edit, got ${JSON.stringify(diffText)}`);
    step('fix 713 (a): with nothing to read the mode, model and agent chips are absent; the diff chip reads +6 −2');

    // (b) M9 fix 743: the mode row off the screen, and the chip's menu of
    // the four modes. The stub prints the manual row and steps through
    // accept edits and plan on each Tab, as Claude Code's footer cycles.
    // The glyphs are built from their code points so the typed line is
    // ASCII. ConPTY hands \x1b[Z over as a Shift press (key 16) and then
    // Tab, so the loops count Tabs alone.
    const waitRow = async (test, what, ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until && !(await screen(stubId)).rows.some(test)) await sleep(200);
      expect((await screen(stubId)).rows.some(test), `${what}, got ${JSON.stringify((await screen(stubId)).rows.filter((r) => r.trim() !== '').slice(-6))}`);
    };
    const modeMenu = '.menu.chat-mode-menu';
    const menuRows = (sel) => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(sel + ' .menu-item')})].map((b) => ({ label: b.querySelector('.menu-label')?.textContent.replace(/^✓/, '') ?? '', checked: b.dataset.checked ?? null, line: b.querySelector('.menu-line')?.textContent ?? null }))`);
    const openMenu = async (chip, sel) => {
      await s.evalJs(`${q(foot(chip))}.click()`);
      try {
        await s.waitFor(`!!document.querySelector(${JSON.stringify(sel)})`, `the ${chip} menu`, 3000);
      } catch (err) {
        const seen = await s.evalJs(`(() => { const c = ${q(foot(chip))}; return { chip: !!c, open: c?.dataset.open ?? null, busy: c?.dataset.busy ?? null, face: ${q(paneSel(stubPane))}?.dataset.face ?? null, menus: [...document.querySelectorAll('.menu')].map((m) => m.className) }; })()`);
        throw new Error(`${err.message}: ${JSON.stringify(seen)}`);
      }
    };
    const pickRow = async (sel, label) => {
      await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(sel + ' .menu-item')})].find((b) => b.querySelector('.menu-label')?.textContent.replace(/^✓/, '') === ${JSON.stringify(label)}).click()`);
      await s.waitFor(`!document.querySelector(${JSON.stringify(sel)})`, `the menu gone after ${label}`, 3000);
    };
    const escapeMenu = async (sel) => {
      await s.key('Escape', 'Escape', 27);
      await s.waitFor(`!document.querySelector(${JSON.stringify(sel)})`, 'Escape closed the menu', 2000);
    };
    const hintNow = () => s.evalJs(`${q(paneSel(stubPane) + ' .chat-hint')}?.textContent ?? null`);
    await typeRaw(stubId, `$m = @(('  ' + [char]0x23F8 + ' manual mode on'), ('  ' + [char]0x23F5 + [char]0x23F5 + ' accept edits on (shift+tab to cycle)'), ('  ' + [char]0x23F8 + ' plan mode on (shift+tab to cycle)')); $i = 0; Write-Host $m[0]; while ($i -lt 2) { $k = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown'); if ($k.VirtualKeyCode -eq 9) { $i += 1; Write-Host $m[$i] } }; Write-Host ('tabs ' + $i)\r`);
    await waitRow((r) => r.trim() === '⏸ manual mode on', 'the manual row on the screen', 10000);
    await waitChip('mode', 'Manual');
    await openMenu('mode', modeMenu);
    {
      const rows = await menuRows(modeMenu);
      const labels = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(modeMenu + ' .menu-label')})].map((e) => e.textContent.replace(/^✓/, ''))`);
      expect(JSON.stringify(labels) === JSON.stringify(['Permission mode', 'Manual', 'Accept edits', 'Plan', 'Auto']), `the heading and the four modes, got ${JSON.stringify(labels)}`);
      const checked = rows.filter((r) => r.checked === 'true').map((r) => r.label);
      expect(JSON.stringify(checked) === '["Manual"]', `Manual ticked alone, got ${JSON.stringify(checked)}`);
      const lines = rows.filter((r) => r.line !== null).map((r) => r.line);
      const want = ['ask each time', 'auto-approve file edits and common file commands', 'research and propose changes without making them', 'no routine prompts; a reviewer model screens actions'];
      expect(JSON.stringify(lines) === JSON.stringify(want), `Claude Code's four lines in order, got ${JSON.stringify(lines)}`);
      const box = await s.evalJs(`(() => { const m = document.querySelector(${JSON.stringify(modeMenu)}).getBoundingClientRect(); const c = ${q(foot('mode'))}.getBoundingClientRect(); return { menuBottom: m.bottom, chipTop: c.top, open: ${q(foot('mode'))}.dataset.open ?? null }; })()`);
      expect(box.menuBottom <= box.chipTop + 0.5, `the menu opens above the chip, got ${JSON.stringify(box)}`);
      expect(box.open !== null, 'the chip reads data-open while its menu shows');
    }
    await pickRow(modeMenu, 'Plan');
    await waitRow((r) => r.startsWith('tabs 2'), 'two presses reached plan and the loop ended', 8000);
    await waitChip('mode', 'Plan', 3000);
    // The pick's own read follows its press by a second, so the poll can
    // show Plan first; the chip ignores a click until the pick settles.
    await s.waitFor(`${q(foot('mode'))}?.dataset.busy === undefined`, 'the mode pick settled', 3000);
    expect((await hintNow()) !== 'Could not reach Plan', 'no miss when Plan was reached');
    await openMenu('mode', modeMenu);
    {
      const checked = (await menuRows(modeMenu)).filter((r) => r.checked === 'true').map((r) => r.label);
      expect(JSON.stringify(checked) === '["Plan"]', `Plan ticked alone after the pick, got ${JSON.stringify(checked)}`);
    }
    await escapeMenu(modeMenu);
    await backOnChat();
    // The cap: a mode the cycle never reaches reads a miss after five
    // presses. This loop prints no mode row, so the plan row stays lowest.
    await typeRaw(stubId, `$n = 0; while ($n -lt 5) { $k = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown'); if ($k.VirtualKeyCode -eq 9) { $n += 1 } }; Write-Host ('tabs ' + $n)\r`);
    await sleep(500);
    await openMenu('mode', modeMenu);
    await pickRow(modeMenu, 'Auto');
    try {
      await s.waitFor(`${q(paneSel(stubPane) + ' .chat-hint')}?.textContent === 'Could not reach Auto'`, 'the miss in the hint', 12000);
    } catch (err) {
      throw new Error(`${err.message}: got ${JSON.stringify(await hintNow())}`);
    }
    await waitRow((r) => r.startsWith('tabs 5'), 'five presses and no more', 3000);
    expect((await chipWord('mode')) === 'Plan', `the chip still reads Plan, got ${JSON.stringify(await chipWord('mode'))}`);
    await backOnChat();
    // A pick of the current mode sends nothing and clears the miss.
    await openMenu('mode', modeMenu);
    await pickRow(modeMenu, 'Plan');
    try {
      await s.waitFor(`${q(paneSel(stubPane) + ' .chat-hint')}?.textContent !== 'Could not reach Auto'`, 'the miss cleared', 1500);
    } catch (err) {
      throw new Error(`${err.message}: got ${JSON.stringify(await hintNow())}`);
    }
    step('fix 743: the mode chip opens the four modes with Claude Code\'s lines, a pick of Plan from Manual sends two Shift+Tabs and the tick moves, and Auto never reached reads Could not reach Auto after five');

    // (c) M9 fix 744: the model off the status line, its effort off the
    // transcript, and the chip's menu of the models and the effort row. A
    // pick types /model <alias> or /effort <level> into the stub, which
    // echoes what it reads, with no fallback bar.
    const modelMenu = '.menu.chat-model-menu';
    await post({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' } });
    await waitChip('model', 'Opus 5.5');
    fs.appendFileSync(fixture, asstLine([{ type: 'text', text: 'Effort noted.' }], 90, { effort: 'high' }) + '\n');
    await waitChip('model', 'Opus 5.5 · high', 5000);
    {
      const title = await s.evalJs(`${q(foot('model'))}.title`);
      expect(title === 'Model and effort. A model pick is saved as your default for new sessions, as /model does.', `the model chip's title, got ${JSON.stringify(title)}`);
    }
    await typeRaw(stubId, `foreach ($i in 1..2) { $l = Read-Host; Write-Host ('got ' + $l) }\r`);
    await sleep(500);
    const segments = () => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(modelMenu + ' [data-segments="Effort"] .menu-segment')})].map((b) => ({ word: b.textContent, active: b.dataset.active !== undefined }))`);
    const ticked = async () => (await menuRows(modelMenu)).filter((r) => r.checked === 'true').map((r) => r.label);
    await openMenu('model', modelMenu);
    {
      const labels = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(modelMenu + ' .menu-item .menu-label')})].map((e) => e.textContent.replace(/^✓/, ''))`);
      const want = ['Model', 'Default', 'Opus 5.5', 'Opus 5.5 (1M context)', 'Sonnet 5.5', 'Sonnet 5.5 (1M context)', 'Haiku 5.5', 'Fable 5.1', 'Fable 5.1 (1M context)', 'Opus Plan'];
      expect(JSON.stringify(labels) === JSON.stringify(want), `the heading and the nine models, got ${JSON.stringify(labels)}`);
      expect(JSON.stringify(await ticked()) === '["Opus 5.5"]', `Opus 5.5 ticked alone, got ${JSON.stringify(await ticked())}`);
      const segs = await segments();
      expect(JSON.stringify(segs.map((x) => x.word)) === JSON.stringify(['low', 'medium', 'high', 'xhigh', 'max']), `the five effort levels, got ${JSON.stringify(segs)}`);
      expect(JSON.stringify(segs.filter((x) => x.active).map((x) => x.word)) === '["high"]', `high active alone, got ${JSON.stringify(segs)}`);
      const box = await s.evalJs(`(() => { const m = document.querySelector(${JSON.stringify(modelMenu)}).getBoundingClientRect(); const c = ${q(foot('model'))}.getBoundingClientRect(); return { menuBottom: m.bottom, chipTop: c.top }; })()`);
      expect(box.menuBottom <= box.chipTop + 0.5, `the menu opens above the chip, got ${JSON.stringify(box)}`);
    }
    await pickRow(modelMenu, 'Sonnet 5.5');
    await waitRow((r) => r.startsWith('got /model sonnet'), 'the pick typed /model sonnet', 5000);
    await sleep(1500);
    expect((await s.evalJs(`!!${q(paneSel(stubPane) + ' .chat-fallback')}`)) === false, 'no fallback bar after a model pick');
    await openMenu('model', modelMenu);
    await s.evalJs(`${q(modelMenu + ' [data-segments="Effort"] .menu-segment[data-value="low"]')}.click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(modelMenu)})`, 'the menu gone after the low segment', 3000);
    await waitRow((r) => r.startsWith('got /effort low'), 'the pick typed /effort low', 5000);
    await waitChip('model', 'Opus 5.5 · low', 2000);
    await post({ hook_event_name: 'StatusLine', model: { id: 'claude-sonnet-5-5', display_name: 'Sonnet 5.5' } });
    await waitChip('model', 'Sonnet 5.5 · low');
    fs.appendFileSync(fixture, asstLine([{ type: 'text', text: 'Effort changed.' }], 92, { effort: 'medium' }) + '\n');
    await waitChip('model', 'Sonnet 5.5 · medium', 5000);
    await openMenu('model', modelMenu);
    {
      expect(JSON.stringify(await ticked()) === '["Sonnet 5.5"]', `Sonnet 5.5 ticked alone, got ${JSON.stringify(await ticked())}`);
      const segs = await segments();
      expect(JSON.stringify(segs.filter((x) => x.active).map((x) => x.word)) === '["medium"]', `medium active alone, got ${JSON.stringify(segs)}`);
    }
    await escapeMenu(modelMenu);
    await backOnChat();
    step('fix 744: the model chip opens the models and the effort row; a pick of Sonnet types /model sonnet with no fallback bar, an effort pick types /effort low and the chip shows it until the transcript says otherwise');

    // M9 fix 745: the three chips' carets are drawn chevrons, centred on
    // their words. The read is on the SVG: the two spans are centred by
    // the flex row whatever the caret draws inside its own.
    {
      const offsets = [];
      for (const chip of ['mode', 'model', 'view']) {
        const r = await s.evalJs(`(() => { const c = ${q(foot(chip))}; const svg = c?.querySelector('.chat-chip-caret svg.chat-footer-chevron'); const word = c?.querySelector('.chat-chip-word'); if (!svg || !word) return null; const a = svg.getBoundingClientRect(); const b = word.getBoundingClientRect(); return { w: a.width, h: a.height, mid: a.top + a.height / 2, wordMid: b.top + b.height / 2, text: c.querySelector('.chat-chip-caret').textContent }; })()`);
        expect(r !== null, `the ${chip} chip's caret holds a chevron SVG`);
        expect(r.w === 8 && r.h === 5, `the ${chip} chevron is 8 by 5, got ${r.w} by ${r.h}`);
        expect(r.text === '', `the ${chip} caret carries no text glyph, got ${JSON.stringify(r.text)}`);
        const off = r.mid - r.wordMid;
        offsets.push(`${chip} ${off.toFixed(2)}`);
        expect(Math.abs(off) <= 1, `the ${chip} chevron centred on its word within 1 px, off by ${off}`);
      }
      console.log(`[verify] note: fix 745 chevron offsets from the words' centres: ${offsets.join(', ')}`);
    }
    step('fix 745: the three chips\' carets are 8 by 5 chevrons centred on their words within 1 px');

    // (d) The agents out, the roster card, and the agent returned.
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'send a helper' });
    await post({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: 'Explore' });
    await post({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'look around', subagent_type: 'Explore' }, tool_response: { agentId: 'a1', description: 'look around', status: 'async_launched' } });
    await waitChip('agents', '1 agent');
    expect((await s.evalJs(`${q(foot('agents') + ' .chat-chip-dot')}.dataset.state`)) === 'out', 'the dot reads out');
    await s.evalJs(`${q(foot('agents'))}.click()`);
    await s.waitFor(`!!document.querySelector('.roster-popover')`, 'the roster card', 3000);
    // The press outside lands in the timeline's top left corner, clear of
    // the card (placed above the chip, over the box) and of the fold row.
    const outside = await s.evalJs(`(() => { const r = ${q(paneSel(stubPane) + ' .chat-timeline')}.getBoundingClientRect(); return { x: r.x + 4, y: r.y + 4 }; })()`);
    await s.click(outside.x, outside.y);
    await s.waitFor(`!document.querySelector('.roster-popover')`, 'a press outside closed the card', 3000);
    await post({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'Explore' });
    await post({ hook_event_name: 'Stop', stop_hook_active: false });
    await s.waitFor(`${q(foot('agents') + ' .chat-chip-dot')}?.dataset.state === 'returned'`, 'the agent returned', 5000);
    await waitChip('agents', '1 agent');
    step('fix 713 (d): the agent chip reads 1 agent out, opens the roster card, and still reads 1 agent returned after the Stop');

    // (e) The diff chip opens Review changes; Ctrl+W closes it.
    await s.evalJs(`${q(foot('diff'))}.click()`);
    await s.waitFor(`!!document.querySelector('.review-tab')`, 'the review tab', 5000);
    await s.key('w', 'KeyW', 87, CTRL);
    await s.waitFor(`!document.querySelector('.review-tab')`, 'the review tab closed', 5000);
    await boxHasKeys();
    await s.screenshot('m9-chat-footer.png');
    step('fix 713 (e): the diff chip opens Review changes');

    // M9 fix 715 (a): the live line's glyph wears the title mark's colour,
    // in Classic and in Emerald.
    const skinNow = () => s.evalJs(`document.documentElement.dataset.skin ?? 'classic'`);
    const skinTo = async (skin) => {
      if ((await skinNow()) === skin) return;
      const c = await s.evalJs(`(() => { const r = document.querySelector('.title-bar-mark').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await s.click(c.x, c.y);
      await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu');
      await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent.startsWith('Skin: ')).click()`);
      await s.waitFor(`(document.documentElement.dataset.skin ?? 'classic') === ${JSON.stringify(skin)}`, `the window on ${skin}`, 5000);
    };
    const marks = () => s.evalJs(`(() => { const p = ${q(paneSel(stubPane))}; const live = p.querySelector('.chat-live .session-mark'); const title = p.querySelector('.pane-mark'); return { live: live ? getComputedStyle(live).color : null, title: title ? getComputedStyle(title).color : null }; })()`);
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'work on it' });
    await s.waitFor(`!!${q(paneSel(stubPane) + ' .chat-live .session-mark')}`, 'the live line', 5000);
    const classicMarks = await marks();
    expect(classicMarks.live !== null && classicMarks.live === classicMarks.title, `the live glyph wears the title mark's colour in Classic, got ${JSON.stringify(classicMarks)}`);
    await skinTo('emerald');
    const emeraldMarks = await marks();
    expect(emeraldMarks.live !== null && emeraldMarks.live === emeraldMarks.title, `and in Emerald, got ${JSON.stringify(emeraldMarks)}`);
    await skinTo('classic');
    step(`fix 715 (a): the live glyph wears the title mark's colour, ${classicMarks.live} in Classic and ${emeraldMarks.live} in Emerald`);

    // (b) The wait overlay on the chat face sits at the timeline's top
    // right, as on the terminal, clear of the ask card, the dock and the
    // last reply. Nothing is pressed before the reads: a key or a press in
    // the focused pane is a look, which takes the overlay.
    const rects = (sel) => s.evalJs(`(() => { const p = ${q(paneSel(stubPane))}; const pick = (x) => { const e = x === 'last-reply' ? [...p.querySelectorAll('.chat-reply')].at(-1) : p.querySelector(x); if (!e) return null; const { top, right, bottom, left } = e.getBoundingClientRect(); return { top, right, bottom, left }; }; return { overlay: pick('.wait-overlay'), view: pick('.chat-view'), other: pick(${JSON.stringify(sel)}), dock: pick('.chat-dock') }; })()`);
    const meets = (a, b) => a !== null && b !== null && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const placed = (r, what) => {
      expect(r.overlay !== null && r.view !== null, `the overlay and the view, got ${JSON.stringify(r)}`);
      const top = r.overlay.top - r.view.top;
      const right = r.view.right - r.overlay.right;
      console.log(`[verify] note: fix 715 ${what}: overlay ${JSON.stringify(r.overlay)}, view ${JSON.stringify(r.view)}, ${what === 'waiting' ? 'card' : 'last reply'} ${JSON.stringify(r.other)}, dock ${JSON.stringify(r.dock)}`);
      expect(top >= 0 && top < 20 && right >= 0 && right < 40, `the ${what} overlay at the chat view's top right, ${top} px down and ${right} px in`);
      expect(!meets(r.overlay, r.other) && !meets(r.overlay, r.dock), `the ${what} overlay clear of the ${what === 'waiting' ? 'ask card' : 'last reply'} and the dock`);
    };
    // A question into the pane typed in within RECENT_INPUT_MS (10 s) is
    // being answered and raises no overlay (fix 701); the steps above
    // pressed and keyed in the pane, so the read waits that out.
    await sleep(10500);
    await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    await s.waitFor(`${q(paneSel(stubPane) + ' .wait-overlay')}?.dataset.word === 'waiting'`, 'the waiting overlay', 3000);
    await s.waitFor(`!!${q(paneSel(stubPane) + ' .chat-step[data-kind="ask"]')}`, 'the ask card', 3000);
    placed(await rects('.chat-step[data-kind="ask"]'), 'waiting');
    await s.screenshot('m9-chat-overlay-waiting.png');
    await post({ hook_event_name: 'Stop', stop_hook_active: false });
    await s.waitFor(`${q(paneSel(stubPane) + ' .wait-overlay')}?.dataset.word === 'done'`, 'the done overlay', 3000);
    placed(await rects('last-reply'), 'done');
    await s.screenshot('m9-chat-overlay-done.png');
    const corner = await s.evalJs(`(() => { const r = ${q(paneSel(stubPane) + ' .chat-timeline')}.getBoundingClientRect(); return { x: r.x + 4, y: r.y + r.height - 4 }; })()`);
    await s.click(corner.x, corner.y);
    await s.waitFor(`!${q(paneSel(stubPane) + ' .wait-overlay')}`, 'a press in the pane took the overlay', 3000);
    await s.evalJs(`${q(paneSel(stubPane) + ' .chat-box')}.focus()`);
    await s.waitFor(`document.activeElement === ${q(paneSel(stubPane) + ' .chat-box')}`, 'the box holds the keyboard');
    step('fix 715 (b): the wait overlay sits at the chat view\'s top right, clear of the ask card, the dock and the last reply, and a press takes it');
  });

  await block('views', async () => {
    // M9 fix 714: the view modes, from the footer block's state: the stub
    // on the chat face in Normal, the box holding the keyboard.
    const P = paneSel(stubPane);
    const ctrlO = async (word) => {
      await s.waitFor(`document.activeElement === ${q(P + ' .chat-box')}`, 'the box holds the keyboard');
      await s.key('o', 'KeyO', 79, CTRL);
      await waitView(stubPane, word);
    };
    const read = () =>
      s.evalJs(`(() => {
        const p = ${q(P)};
        const fold = p.querySelector('.chat-fold');
        const thinking = p.querySelector('.chat-step[data-kind="thinking"]');
        return {
          folds: p.querySelectorAll('.chat-fold').length,
          foldText: fold?.textContent ?? null,
          caret: fold?.querySelector('.chat-fold-caret')?.textContent ?? null,
          thinking: [...p.querySelectorAll('.chat-step[data-kind="thinking"] .chat-thinking-head')].map((e) => e.textContent),
          thinkingFirst: !!(thinking && fold && (thinking.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING)),
          tools: p.querySelectorAll('.chat-step[data-kind="tool"]').length,
          replies: [...p.querySelectorAll('.chat-reply')].map((e) => e.textContent),
          stored: localStorage.getItem('emerald.chatPanes'),
        };
      })()`);
    await waitView(stubPane, 'Normal');
    let r = await read();
    expect(r.folds === 1 && r.foldText === '3 steps · Bash, Bash, Edit +6 −2 ›', `one fold row reading 3 steps · Bash, Bash, Edit +6 −2 ›, got ${JSON.stringify(r)}`);
    expect(r.thinking.length === 0 && r.tools === 0, `no thinking and no tool rows in Normal, got ${JSON.stringify(r)}`);
    expect(['Done.', 'Also done.', 'Effort noted.'].every((x) => r.replies.includes(x)), `the replies still drawn, got ${JSON.stringify(r.replies)}`);
    step('fix 714: Normal folds the turn\'s three calls into one row and keeps the replies');

    await ctrlO('Thinking');
    r = await read();
    expect(JSON.stringify(r.thinking) === '["Thought for 6s"]' && r.thinkingFirst && r.tools === 0, `Thinking shows the thinking above the fold, got ${JSON.stringify(r)}`);
    expect(r.stored === JSON.stringify([[stubPane, stubId, 'thinking']]), `the mode stored, got ${r.stored}`);
    await ctrlO('Verbose');
    r = await read();
    expect(r.folds === 0 && r.tools === 3, `Verbose draws every step, got ${JSON.stringify(r)}`);
    await ctrlO('Normal');
    r = await read();
    expect(r.stored === JSON.stringify([[stubPane, stubId]]), `Normal stores the pair, got ${r.stored}`);
    step('fix 714: Ctrl+O cycles Thinking, Verbose and Normal, each stored with the face');

    await s.evalJs(`${q(viewChip(stubPane))}.click()`);
    await s.waitFor(`!!document.querySelector('.menu.chat-view-menu')`, 'the view menu', 3000);
    const menu = await s.evalJs(`(() => {
      const m = document.querySelector('.menu.chat-view-menu');
      const chip = ${q(viewChip(stubPane))}.getBoundingClientRect();
      const rect = m.getBoundingClientRect();
      return {
        labels: [...m.querySelectorAll('.menu-item')].map((b) => b.querySelector('.menu-label')?.textContent.replace(/^✓/, '') ?? ''),
        checked: [...m.querySelectorAll('.menu-item[data-checked="true"]')].map((b) => b.querySelector('.menu-label')?.textContent.replace(/^✓/, '') ?? ''),
        bottom: rect.bottom, chipTop: chip.top, open: ${q(viewChip(stubPane))}.dataset.open ?? null,
      };
    })()`);
    expect(JSON.stringify(menu.labels) === JSON.stringify(['What the timeline shows', 'Normal', 'Thinking', 'Verbose', 'Ctrl+O cycles them']), `the menu's rows, got ${JSON.stringify(menu.labels)}`);
    expect(JSON.stringify(menu.checked) === '["Normal"]', `Normal checked alone, got ${JSON.stringify(menu.checked)}`);
    expect(menu.bottom <= menu.chipTop + 0.5, `the menu opened upward, bottom ${menu.bottom} against the chip's top ${menu.chipTop}`);
    expect(menu.open !== null, 'the chip is marked open while its menu is');
    await s.screenshot('m9-chat-views-menu.png');
    await s.evalJs(`[...document.querySelectorAll('.menu.chat-view-menu .menu-item')].find((b) => b.querySelector('.menu-label')?.textContent.replace(/^✓/, '') === 'Thinking').click()`);
    await s.waitFor(`!document.querySelector('.menu.chat-view-menu')`, 'the menu closed', 3000);
    await waitView(stubPane, 'Thinking');
    await ctrlO('Verbose');
    await ctrlO('Normal');
    step('fix 714: the view menu opens upward with Normal checked, and a pick sets the mode');

    // Fix 753: the stub's last folded call is the passing Edit.
    const stubTone = await s.evalJs(`${q(P + ' .chat-fold .chat-dot')}?.dataset.tone ?? null`);
    expect(stubTone === 'done', `the stub's fold dot reads done, got ${stubTone}`);
    await s.evalJs(`${q(P + ' .chat-fold')}.click()`);
    await s.waitFor(`${q(P)}.querySelectorAll('.chat-step[data-kind="tool"]').length === 3 && ${q(P + ' .chat-fold-caret')}?.textContent === '⌄'`, 'the fold opened', 3000);
    await s.screenshot('m9-chat-views-open.png');
    await s.evalJs(`${q(P + ' .chat-fold')}.click()`);
    await s.waitFor(`${q(P)}.querySelectorAll('.chat-step[data-kind="tool"]').length === 0 && ${q(P + ' .chat-fold-caret')}?.textContent === '›'`, 'the fold closed', 3000);
    await s.waitFor(`document.activeElement === ${q(P + ' .chat-box')}`, 'the box holds the keyboard');
    step('fix 714: a click on the fold row opens the turn\'s calls and another folds them');
  });

  await block('reply', async () => {
    // M9 fix 716: a reply rendered as Markdown, its inline path and its
    // relative link live. The session's folder is the fixture's, so the
    // note written there is a file inside it.
    await toChat(stubPane);
    await toVerbose(stubPane);
    const folder = longFixtureDir();
    const notes = path.join(folder, 'notes-716.md');
    fs.writeFileSync(notes, '# notes\n');
    // After the ask block the daemon has read Claude as leaving the shell
    // (its Read-Host), and a shell is where its prompt says, so the stub's
    // shell moves to the fixture folder before the hooks bind it again.
    const norm = (p) => (p ?? '').replace(/\//g, '\\').toLowerCase();
    await typeRaw(stubId, `Set-Location -LiteralPath '${folder}'\r`);
    await waitRecord(stubId, (r) => norm(r.cwd) === norm(folder), 'the shell in the fixture folder', 5000);
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'explain the fix', cwd: folder });
    await post({ hook_event_name: 'Stop', stop_hook_active: false, cwd: folder });
    await waitRecord(stubId, (r) => norm(r.cwd) === norm(folder), 'the stub in the fixture folder', 5000);
    fs.appendFileSync(fixture, [userLine('explain the fix', 200), asstLine([{ type: 'text', text: 'Fixed it:\n\n- **Why:** the key went to the page\n- the notes are in `notes-716.md` and [the plan](notes-716.md)\n\n```\nnpm run verify:browser\n```' }], 201)].join('\n') + '\n');
    const last = `[...${q(paneSel(stubPane))}.querySelectorAll('.chat-reply')].at(-1)`;
    await s.waitFor(`!!${last}?.querySelector('code.chat-path[data-path]')`, 'the reply drawn with its path live', 5000);
    const r = await s.evalJs(`(() => { const e = ${last}; const a = e.querySelector('a[data-path]'); return { strong: e.querySelector('strong')?.textContent ?? null, li: e.querySelectorAll('li').length, pre: e.querySelector('pre code')?.textContent.trim() ?? null, text: e.textContent, code: e.querySelector('code.chat-path')?.dataset.path ?? null, link: a?.dataset.path ?? null, href: a?.hasAttribute('href') ?? null, first: e.firstElementChild?.className ?? null }; })()`);
    expect(r.strong === 'Why:', `the bold, got ${JSON.stringify(r)}`);
    expect(r.li === 2, `two list items, got ${r.li}`);
    expect(r.pre === 'npm run verify:browser', `the fenced block, got ${r.pre}`);
    expect(!r.text.includes('**') && !r.text.includes('`'), `no Markdown marks in the text, got ${JSON.stringify(r.text)}`);
    expect(r.code === notes && r.link === notes && r.href === false, `the code span and the link carry the note's path, got ${JSON.stringify(r)}`);
    expect(r.first === 'chat-tick-cell', `the tick cell first, got ${r.first}`);
    step('fix 716: the reply is rendered Markdown, bold, a list, a fenced block, and its inline path and relative link are live');
  });

  await block('paths', async () => {
    // M9 fix 717: the reply block's inline path, clicked and right-clicked.
    await toChat(stubPane);
    await toVerbose(stubPane);
    const notes = path.join(longFixtureDir(), 'notes-716.md');
    const code = `[...${q(paneSel(stubPane))}.querySelectorAll('.chat-reply')].at(-1)?.querySelector('code.chat-path')`;
    await s.waitFor(`!!${code}`, 'the reply with its path link', 5000);
    await s.evalJs(`${code}.click()`);
    await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === ${JSON.stringify(notes)}`, 'the path opened in a tab', 5000);
    await s.evalJs(`${q('.tab[data-tab="panes"]')}.click()`);
    await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'back on the panes tab', 5000);
    const centre = async () => {
      const { x, y, width, height } = await s.evalJs(`(() => { const { x, y, width, height } = ${code}.getBoundingClientRect(); return { x, y, width, height }; })()`);
      return { x: x + width / 2, y: y + height / 2 };
    };
    let c = await centre();
    await s.rightClick(c.x, c.y);
    await s.waitFor(`!!${q('.chat-path-menu')}`, 'the path menu', 3000);
    const menu = await s.evalJs(`(() => { const m = ${q('.chat-path-menu')}; return { labels: [...m.querySelectorAll('.menu-item .menu-label')].map((e) => e.textContent).join(','), path: m.dataset.path ?? null, paneMenu: !!${q('.pane-menu')} }; })()`);
    expect(menu.labels === 'Open in a tab,Open in a pane,Open with Windows,Reveal in Explorer,Mention in the message,Copy path', `the menu's items, got ${menu.labels}`);
    expect(menu.path === notes && !menu.paneMenu, `the menu on the path and no pane menu, got ${JSON.stringify(menu)}`);
    await s.evalJs(`window.__mention = null; window.addEventListener('emerald:chat-mention', (e) => { window.__mention = e.detail; }, { once: true })`);
    const pick = (label) => s.evalJs(`[...document.querySelectorAll('.chat-path-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
    await pick('Mention in the message');
    await s.waitFor(`window.__mention !== null`, 'the mention dispatched', 3000);
    const mention = await s.evalJs('window.__mention');
    expect(JSON.stringify(mention) === JSON.stringify({ paneId: stubPane, path: notes }), `the mention's detail, got ${JSON.stringify(mention)}`);
    // On the merged tree the box takes the mention; later blocks start on
    // an empty box.
    await s.evalJs(`(() => { const b = ${q(paneSel(stubPane) + ' .chat-box')}; b.focus(); b.select(); })()`);
    await s.key('Delete', 'Delete', 46);
    c = await centre();
    await s.rightClick(c.x, c.y);
    await s.waitFor(`!!${q('.chat-path-menu')}`, 'the path menu again', 3000);
    await pick('Copy path');
    await s.waitFor(`window.emerald.clipboard.read().then((r) => r.text === ${JSON.stringify(notes)})`, 'Copy path puts the path on the clipboard', 3000);
    step('fix 717: a path in a reply opens in a tab, and its menu offers the rail\'s items, mentions it and copies it');
  });

  await block('thumbs', async () => {
    // M9 fixes 717 and 718: an image result and two pastes, one typed and
    // one riding on a slash command's meta line. The PNGs are made in the
    // window, a canvas filled in a colour per image with a white box inside
    // (fix 758), so a frame tells the three apart, and read back.
    await toChat(stubPane);
    const pngOf = (w, h, fill) => s.evalJs(`(() => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; const g = c.getContext('2d'); g.fillStyle = ${JSON.stringify(fill)}; g.fillRect(0, 0, ${w}, ${h}); g.fillStyle = 'rgb(255, 255, 255)'; g.fillRect(${Math.round(w / 4)}, ${Math.round(h / 4)}, ${Math.round(w / 2)}, ${Math.round(h / 2)}); return c.toDataURL('image/png').slice(22); })()`);
    const png = (data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
    fs.appendFileSync(
      fixture,
      [
        userLine([{ type: 'text', text: '[Image #1] the page after the key' }, png(await pngOf(64, 40, 'rgb(220, 0, 0)'))], 300, { promptId: 'p718a', imagePasteIds: [1] }),
        asstLine([useOf('r718', 'Read', { file_path: path.join(longFixtureDir(), 'after-key.png') })], 301),
        resultOf('r718', [png(await pngOf(48, 30, 'rgb(0, 120, 220)'))], 302, { toolUseResult: { type: 'image', file: { type: 'image/png', originalSize: 1234, dimensions: {} } } }),
        asstLine([{ type: 'text', text: 'Here it is.' }], 303),
        userLine('<command-message>backlog</command-message>\n<command-name>/backlog</command-name>\n<command-args>[Image #2] file this</command-args>', 310, { promptId: 'p718b' }),
        userLine([png(await pngOf(40, 64, 'rgb(230, 170, 0)')), { type: 'text', text: 'Base directory for this skill: C:/sim' }], 310, { isMeta: true, promptId: 'p718b' }),
        asstLine([{ type: 'text', text: 'Filed.' }], 311),
      ].join('\n') + '\n',
    );
    await s.waitFor(`[...${q(paneSel(stubPane))}.querySelectorAll('.chat-prompt')].at(-1)?.textContent === '/backlog [Image #2] file this'`, 'the slash command drawn', 5000);
    const read = async (when) => {
      const imgs = `[...${q(paneSel(stubPane))}.querySelectorAll('.chat-prompt img.chat-prompt-thumb, .chat-thumb')]`;
      await s.waitFor(`${imgs}.length >= 3 && ${imgs}.every((i) => i.complete && i.naturalWidth > 0)`, `the thumbnails loaded (${when})`, 3000);
      return s.evalJs(`(() => {
        const p = ${q(paneSel(stubPane))};
        const box = (i) => { const r = i.getBoundingClientRect(); return [i.naturalWidth, i.naturalHeight, Math.round(r.width), Math.round(r.height)].join(' '); };
        const typed = [...p.querySelectorAll('.chat-prompt')].find((e) => e.textContent === '[Image #1] the page after the key');
        const slash = [...p.querySelectorAll('.chat-prompt')].at(-1);
        return {
          typed: [...(typed?.querySelectorAll('img.chat-prompt-thumb') ?? [])].map(box),
          slash: [...slash.querySelectorAll('img.chat-prompt-thumb')].map(box),
          result: [...p.querySelectorAll('.chat-thumb')].map(box),
        };
      })()`);
    };
    // Read in Normal first, where the result's thumbnail comes from the
    // closed fold's images item (the footer's contract), then in Verbose.
    for (const when of ['in Normal', 'in Verbose']) {
      if (when === 'in Normal' && (await viewWord(stubPane)) !== null) await pickView(stubPane, 'Normal');
      if (when === 'in Verbose') await toVerbose(stubPane);
      const t = await read(when);
      expect(JSON.stringify(t.typed) === '["64 40 88 55"]', `the typed paste ${when}, got ${JSON.stringify(t)}`);
      expect(JSON.stringify(t.slash.map((x) => x.split(' ').slice(0, 2).join(' '))) === '["40 64"]', `the slash command's paste ${when}, got ${JSON.stringify(t)}`);
      expect(JSON.stringify(t.result) === '["48 30 176 110"]', `the result's thumbnail ${when}, got ${JSON.stringify(t)}`);
    }
    await s.screenshot('m9-chat-thumbs.png');
    step('fix 718: a pasted image is an 88 by 55 thumbnail on its bubble, natural 64 by 40, and a slash command\'s paste rides on its meta line');
    const thumb = `[...${q(paneSel(stubPane))}.querySelectorAll('.chat-thumb')].at(-1)`;
    await s.evalJs(`${thumb}.click()`);
    await s.waitFor(`document.querySelector('.chat-image-full img')?.src === ${thumb}.src && document.activeElement === document.querySelector('.chat-image-full')`, 'the full size over the window', 3000);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.chat-image-full')`, 'Escape closed the full size', 2000);
    expect((await s.evalJs(`${q(paneSel(stubPane))}.dataset.face ?? null`)) === 'chat', 'the pane still on the chat face');
    step('fix 717: an image result is a 176 by 110 thumbnail, natural 48 by 30, and a click opens it full size');
  });

  await block('edit-ask', async () => {
    // M9 fix 717: a permission for an Edit the transcript wrote last is
    // the edit card, its hunk numbered off the file. The sequence is the
    // ask block's, the session's cwd the fixture folder.
    await toChat(stubPane);
    await toVerbose(stubPane);
    const folder = longFixtureDir();
    const file = path.join(folder, 'claims-717.txt');
    fs.writeFileSync(file, 'zero\none\nalpha\nthree\n');
    fs.appendFileSync(fixture, [userLine('make it say beta', 400), asstLine([useOf('e717', 'Edit', { file_path: file, old_string: 'one\nalpha\nthree', new_string: 'one\nbeta\ngamma\nthree' })], 401)].join('\n') + '\n');
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'make it say beta', cwd: folder });
    await post({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file }, cwd: folder });
    await waitRecord(stubId, (r) => r.state === 'working', 'the stub working', 5000);
    await typeRaw(stubId, `cls; Write-Host ''; Write-Host 'Do you want to make this edit to claims-717.txt?'; Write-Host '> 1. Yes'; Write-Host '  2. Yes, allow all edits during this session'; Write-Host -NoNewline '  3. No, and tell Claude what to do differently'; Read-Host | Out-Null\r`);
    await waitCursorRow(stubId, (row) => row.trim().endsWith('differently'), 'the cursor sits at the end of the last option');
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'Edit', tool_input: { file_path: file }, cwd: folder });
    const card = q(paneSel(stubPane) + ' .chat-step[data-kind="ask"]');
    await s.waitFor(`!!${card}?.querySelector('.chat-ask-hunk')`, 'the edit card with its hunk', 5000);
    const lined = `[...${card}.querySelectorAll('.chat-hunk-num')].map((e) => e.textContent).join(',') === '2,3,3,4,5'`;
    try {
      await s.waitFor(lined, 'the hunk numbered off the file', 3000);
    } catch {}
    const r = await s.evalJs(`(() => { const c = ${card}; return { heading: c.querySelector('.chat-ask-heading')?.textContent ?? null, file: c.querySelector('.chat-ask-file')?.dataset.path ?? null, counts: c.querySelector('.chat-ask-counts')?.textContent ?? null, diff: c.querySelector('.chat-ask-diff')?.textContent ?? null, screen: !!c.querySelector('.chat-ask-screen'), kinds: [...c.querySelectorAll('.chat-hunk-row')].map((e) => e.dataset.kind).join(','), nums: [...c.querySelectorAll('.chat-hunk-num')].map((e) => e.textContent).join(','), keys: [...c.querySelectorAll('.chat-ask-option')].map((b) => b.dataset.key).join(',') }; })()`);
    expect(r.heading === 'Claude wants to edit', `the heading, got ${JSON.stringify(r)}`);
    expect(r.file === file, `the file, got ${r.file}`);
    expect(r.counts === '+2 \u22121', `the counts, got ${r.counts}`);
    expect(r.diff === 'Open as a diff' && !r.screen, `the diff button and no screen excerpt, got ${JSON.stringify(r)}`);
    expect(r.kinds === 'context,removed,added,added,context', `the rows, got ${r.kinds}`);
    expect(r.nums === '2,3,3,4,5', `the numbers, got ${r.nums}`);
    expect(r.keys === '1,2,3,esc', `the options, got ${r.keys}`);
    await s.screenshot('m9-chat-edit.png');
    step('fix 717: an edit\'s ask draws the hunk from the pending Edit, +2 \u22121 at lines 2 to 5');
    await typeRaw(stubId, '\r');
    // As in the ask block: the Read-Host ends at the prompt with hooks
    // landed during it, read as Claude leaving the shell, so the Stop is
    // posted after that, binding it again.
    await waitRecord(stubId, (rec) => rec.command?.state !== 'running', 'the Read-Host ended at the prompt', 10000);
    await post({ hook_event_name: 'Stop', stop_hook_active: false, cwd: folder });
    await s.waitFor(`!${card} && ${q(paneSel(stubPane) + ' .chat-box')}?.disabled === false`, 'the card gone and the box back');
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
    // M9 fix 714: Ctrl+O twice, Normal to Verbose, so the Bash row is drawn.
    await s.waitFor(`document.activeElement === ${q(paneSel(pane.id) + ' .chat-box')}`, 'the box holds the keyboard');
    await s.key('o', 'KeyO', 79, CTRL);
    await waitView(pane.id, 'Thinking');
    await s.key('o', 'KeyO', 79, CTRL);
    await waitView(pane.id, 'Verbose');
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

    // M9 fix 713: the real session's footer. One Bash and a reply, no
    // edit, so no diff chip; the model and the mode are logged, since the
    // harness profile's default mode is not this script's to pin.
    const realFoot = (chip) => `${q(paneSel(pane.id) + ` .chat-chip[data-chip="${chip}"] .chat-chip-word`)}?.textContent ?? null`;
    await s.waitFor(`(${realFoot('model')}) !== null && (${realFoot('mode')}) !== null`, 'the model and mode chips on the real session', 10000);
    expect((await s.evalJs(`!!${q(paneSel(pane.id) + ' .chat-chip[data-chip="diff"]')}`)) === false, 'no diff chip after a turn with no edit');
    const realModel = await s.evalJs(realFoot('model'));
    const realMode = await s.evalJs(realFoot('mode'));
    expect(realModel.trim() !== '', 'the model chip has a word');
    expect(['Manual', 'Accept edits', 'Plan', 'Auto'].includes(realMode), `the mode chip reads one of the four words, got ${JSON.stringify(realMode)}`);
    step(`fix 713: the real session's footer reads ${realModel} and ${realMode}, with no diff chip`);

    // M9 fix 743: the real session's mode menu, opened and read, never
    // picked: its permission mode is the harness profile's.
    const realMenuLabels = (sel) => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(sel + ' .menu-label')})].map((e) => e.textContent.replace(/^✓/, ''))`);
    const realMenuChecked = (sel) => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(sel + ' .menu-item[data-checked="true"] .menu-label')})].map((e) => e.textContent.replace(/^✓/, ''))`);
    await s.evalJs(`${q(paneSel(pane.id) + ' .chat-chip[data-chip="mode"]')}.click()`);
    await s.waitFor(`!!document.querySelector('.menu.chat-mode-menu')`, 'the real mode menu', 3000);
    {
      const labels = await realMenuLabels('.menu.chat-mode-menu');
      expect(JSON.stringify(labels) === JSON.stringify(['Permission mode', 'Manual', 'Accept edits', 'Plan', 'Auto']), `the real mode menu's rows, got ${JSON.stringify(labels)}`);
      const checked = await realMenuChecked('.menu.chat-mode-menu');
      expect(JSON.stringify(checked) === JSON.stringify([realMode]), `the real mode menu ticks ${realMode} alone, got ${JSON.stringify(checked)}`);
    }
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.menu.chat-mode-menu')`, 'Escape closed the real mode menu', 2000);
    step(`fix 743: the real session's mode menu lists the four modes with ${realMode} ticked, read and closed without a pick`);

    // M9 fix 744: the real session's model menu, opened and read, never
    // picked: a real /model pick saves the user's own default model.
    await s.evalJs(`${q(paneSel(pane.id) + ' .chat-chip[data-chip="model"]')}.click()`);
    await s.waitFor(`!!document.querySelector('.menu.chat-model-menu')`, 'the real model menu', 3000);
    {
      const labels = await s.evalJs(`[...document.querySelectorAll('.menu.chat-model-menu .menu-item .menu-label')].map((e) => e.textContent.replace(/^✓/, ''))`);
      const want = ['Model', 'Default', 'Opus 5.5', 'Opus 5.5 (1M context)', 'Sonnet 5.5', 'Sonnet 5.5 (1M context)', 'Haiku 5.5', 'Fable 5.1', 'Fable 5.1 (1M context)', 'Opus Plan'];
      expect(JSON.stringify(labels) === JSON.stringify(want), `the real model menu's rows, got ${JSON.stringify(labels)}`);
      const segs = await s.evalJs(`[...document.querySelectorAll('.menu.chat-model-menu [data-segments="Effort"] .menu-segment')].map((b) => ({ word: b.textContent, active: b.dataset.active !== undefined }))`);
      expect(JSON.stringify(segs.map((x) => x.word)) === JSON.stringify(['low', 'medium', 'high', 'xhigh', 'max']), `the real effort row, got ${JSON.stringify(segs)}`);
      const checked = await realMenuChecked('.menu.chat-model-menu');
      console.log(`[verify] note: fix 744's real model menu ticks ${JSON.stringify(checked)} with ${JSON.stringify(segs.filter((x) => x.active).map((x) => x.word))} active (the account's display name may name no row; logged, not judged)`);
    }
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.menu.chat-model-menu')`, 'Escape closed the real model menu', 2000);
    step('fix 744: the real session\'s model menu lists the nine models and the five effort levels, read and closed without a pick');

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

    // M9 fix 754: two messages queued behind a real turn's sleep; Edit on
    // the older takes it back into the box (two Ups and Enter in the TUI),
    // Remove on the other takes it back and drops it, and the turn ends on
    // the prompt alone.
    {
      await sleep(1500);
      const P = paneSel(pane.id);
      const boxSel = P + ' .chat-box';
      const stopsBefore = eventsFor(realId).filter((e) => e.event === 'Stop').length;
      console.log(`[verify] fix 754: the view before the step reads ${await viewWord(pane.id)}`);
      if ((await viewWord(pane.id)) !== 'Verbose') await pickView(pane.id, 'Verbose');
      const qPrompt = `Use the Bash tool to run this exact command in the foreground, not in the background: ping -n 21 127.0.0.1. Then reply with exactly the word ${marker}q and nothing else.`;
      await s.evalJs(`${q(boxSel)}.focus()`);
      await s.waitFor(`document.activeElement === ${q(boxSel)}`, 'the box holds the keyboard');
      await s.type(qPrompt);
      await s.key('Enter', 'Enter', 13);
      // Any Bash row pending: the row's words may be the call's
      // description rather than its command.
      const sleeping = `[...document.querySelectorAll(${JSON.stringify(P + ' .chat-step[data-kind="tool"][data-tool="Bash"]')})].some((t) => t.querySelector('.chat-dot')?.dataset.tone === 'pending')`;
      const toolRows = () => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(P + ' .chat-step[data-kind="tool"]')})].map((t) => [t.dataset.tool, t.querySelector('.chat-tool-arg')?.textContent ?? '', t.querySelector('.chat-dot')?.dataset.tone ?? null])`);
      const sleepBy = Date.now() + 60000;
      let asked = false;
      while (Date.now() < sleepBy && !(await s.evalJs(sleeping))) {
        if (!asked && (await record(realId)).state === 'needs-input') {
          await s.waitFor(`!!${q(P + ' .chat-ask-option[data-key="1"]')}`, 'the card offers 1', 10000);
          await s.evalJs(`${q(P + ' .chat-ask-option[data-key="1"]')}.click()`);
          asked = true;
          console.log('[verify] note: the sleep was asked for; answered 1 on the card');
        }
        await sleep(200);
      }
      if (!(await s.evalJs(sleeping))) {
        const r = await record(realId);
        throw new Error(`the sleep never drawn pending: state ${r.state}, rows ${JSON.stringify(await toolRows())}, input ${JSON.stringify((await screen(realId)).rows.filter((x) => x.trim() !== '').slice(-6))}`);
      }
      // The second waits for the first's bubble: a send types the text and
      // its Enter a moment apart, so two sends inside that moment run into
      // one message in the TUI.
      const bubbleTexts = () => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(P + ' .chat-queued .chat-queued-text')})].map((e) => e.textContent)`);
      for (const [k, name] of ['a', 'b'].entries()) {
        await s.evalJs(`${q(boxSel)}.focus()`);
        await s.type(`queued-${name}-${marker}`);
        await s.key('Enter', 'Enter', 13);
        await s.waitFor(`document.querySelectorAll(${JSON.stringify(P + ' .chat-queued')}).length === ${k + 1}`, `bubble ${k + 1} queued`, 5000).catch(() => {});
      }
      try {
        await s.waitFor(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(P + ' .chat-queued .chat-queued-text')})].map((e) => e.textContent)) === ${JSON.stringify(JSON.stringify([`queued-a-${marker}`, `queued-b-${marker}`]))}`, 'two queued bubbles in order', 5000);
      } catch (err) {
        throw new Error(`${err.message}: ${JSON.stringify(await bubbleTexts())}`);
      }
      const transcriptPath = (await record(realId)).transcriptPath;
      const queueOps = () => (fs.existsSync(transcriptPath) ? fs.readFileSync(transcriptPath, 'utf8') : '').split('\n').filter((l) => l.includes('"queue-operation"')).map((l) => JSON.parse(l));
      const promptText = async () => {
        const rows = (await screen(realId)).rows;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].trimStart().startsWith('❯')) return rows[i].trimStart().slice(1).trim();
        return null;
      };
      // Claude Code 2.1.301 pulls the whole queue back on one Up (popAll per
      // message, read here on 2026-10-15), so Edit brings every queued
      // message into the box in queue order and no bubble offers Remove.
      expect((await s.evalJs(`document.querySelectorAll(${JSON.stringify(P + ' .chat-queued-remove')}).length`)) === 0, 'no Remove on the pull-all path');
      const all = `queued-a-${marker}\nqueued-b-${marker}`;
      await s.evalJs(`${q(P + ' .chat-queued[data-queued-index="0"] .chat-queued-edit')}.click()`);
      const editBy = Date.now() + 8000;
      let editRead = null;
      while (Date.now() < editBy) {
        editRead = { box: await s.evalJs(`${q(boxSel)}.value`), bubbles: await bubbleTexts(), input: await promptText(), ops: queueOps().map((o) => `${o.operation}:${o.content ?? ''}`) };
        if (editRead.box === all && editRead.bubbles.length === 0) break;
        await sleep(250);
      }
      console.log(`[verify] fix 754 edit: ${JSON.stringify(editRead)}`);
      const path754 = editRead.ops.some((o) => o.startsWith('popAll:')) ? 'all' : editRead.ops.some((o) => o.startsWith('popOne:')) ? 'one' : 'none';
      console.log(`[verify] fix 754: Claude Code took the queued messages back by ${path754 === 'one' ? 'popOne (Up selects, Enter pulls that one)' : path754 === 'all' ? 'popAll (the whole queue at once)' : 'no queue line yet'}`);
      expect(path754 === 'all', `Claude Code pulled the whole queue (popAll), as QUEUE_PICK in chat-model.ts says; got ${path754}`);
      expect(editRead.box === all, `the box holds both messages in queue order, got ${JSON.stringify(editRead)}`);
      expect(editRead.bubbles.length === 0, `no bubble left, got ${JSON.stringify(editRead.bubbles)}`);
      expect(!(editRead.input ?? '').startsWith('queued-'), `the TUI's input cleared, got ${JSON.stringify(editRead.input)}`);
      expect(editRead.ops.includes(`popAll:queued-a-${marker}`) && editRead.ops.includes(`popAll:queued-b-${marker}`), `the transcript's popAll for both, got ${JSON.stringify(editRead.ops)}`);
      expect(editRead.ops.filter((o) => o.startsWith('enqueue:')).length === 2, `nothing sent back into the queue, got ${JSON.stringify(editRead.ops)}`);
      step('fix 754: Edit on a real queued message takes the queue back from Claude Code into the box, as one Up does in the terminal');

      await s.evalJs(`(() => { const b = ${q(boxSel)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(b, ''); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const replyBy = Date.now() + 90000;
      while (Date.now() < replyBy && eventsFor(realId).filter((e) => e.event === 'Stop').length <= stopsBefore) await sleep(250);
      expect(eventsFor(realId).filter((e) => e.event === 'Stop').length > stopsBefore, 'Stop logged for the queued turn');
      await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(P + ' .chat-reply')})].at(-1)?.textContent.trim() === ${JSON.stringify(marker + 'q')}`, 'the reply to the prompt alone', 10000);
      step(`fix 754: the turn ended on the prompt alone, the reply ${marker}q`);
    }

    await sleep(1500);
    await s.waitFor(`document.activeElement === ${q(paneSel(pane.id) + ' .chat-box')}`, 'the box holds the keyboard');
    await s.type('/exit');
    await s.key('Enter', 'Enter', 13);
    await waitRecord(realId, (r) => r.state === 'exited' && r.exitCode === 0, 'the real Claude exited (0)', 30000);
    step('fix 690: /exit from the box ends the session with exit code 0');
  });

  await block('fresh', async () => {
    // M9 fix 722: a real Claude on the chat face in a folder Claude Code
    // has never used. Claude Code makes projects\<folder> and the
    // transcript at its first write, after the SessionStart that gave the
    // path, so the view's first read fails and its folder's first watch
    // fails too; the retry in folder-watchers.ts must bring the turn in.
    // The folder sits under the checkout so it takes the trust the
    // checkout already has (one under %TEMP% stops at the trust dialog).
    const stamp = Date.now().toString(36);
    freshDir = path.join(repoRoot, '.chat-fresh-' + stamp);
    fs.mkdirSync(freshDir);
    // The real Claude writes under the person's Claude home (the harness
    // sets only EMERALD_CLAUDE_HOME, which Claude Code does not read).
    const claudeProjects = path.join(process.env['CLAUDE_CONFIG_DIR']?.trim() || path.join(os.homedir(), '.claude'), 'projects');
    const stamped = () => (fs.existsSync(claudeProjects) ? fs.readdirSync(claudeProjects).filter((n) => n.toLowerCase().includes(stamp)) : []);
    expect(stamped().length === 0, `no project folder for the fresh folder yet, got ${JSON.stringify(stamped())}`);
    let lay = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...lay, root: { ...lay.root, sessionId: null } } });
    await s.evalJs(`localStorage.setItem('emerald.recentFolders', ${JSON.stringify(JSON.stringify([freshDir]))})`);
    await reload();
    await s.waitFor(`!!document.querySelector('.app-body') && !!document.querySelector('.empty-folder')`, 'the empty pane with its folders', 15000);
    const norm = (p) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    const picked = await s.evalJs(`(() => { const b = [...document.querySelectorAll('.empty-folder')].find((e) => e.dataset.folder.replace(/\\//g, '\\\\').replace(/\\\\+$/, '').toLowerCase() === ${JSON.stringify(norm(freshDir))}); if (!b) return null; b.click(); return b.dataset.folder; })()`);
    expect(picked !== null, `the fresh folder's row among the folders, got ${JSON.stringify(await s.evalJs(`[...document.querySelectorAll('.empty-folder')].map((e) => e.dataset.folder)`))}`);
    await s.evalJs(`${q('.empty-pane .empty-kind[data-kind="claude"]')}.click()`);
    await s.waitFor(`!!${q('.empty-opens-chat')}`, 'the pair');
    await s.evalJs(`${q('.empty-opens-chat')}.click()`);
    await s.waitFor(`${q('.empty-pane .empty-start')}?.disabled === false`, 'Start ready');
    await s.evalJs(`${q('.empty-pane .empty-start')}.click()`);
    await s.waitFor(`!!document.querySelector('.pane[data-face="chat"]')`, 'the new session on the chat face', 15000);
    lay = await getLayout(s);
    const pane = leaves(lay)[0];
    freshId = pane.sessionId;
    expect(freshId !== null, 'the pane holds the new session');
    // The record, answering the trust dialog once if it shows after all.
    const idleBy = Date.now() + 30000;
    let trusted = false;
    let rec = null;
    while (Date.now() < idleBy) {
      rec = await record(freshId);
      if (rec !== undefined && rec.state === 'idle' && rec.claudeSessionId !== null && rec.transcriptPath) break;
      if (!trusted && (await screen(freshId)).rows.some((r) => r.includes('trust this folder'))) {
        trusted = true;
        await typeRaw(freshId, '1');
        await typeRaw(freshId, '\r');
        console.log('[verify] note: the trust dialog showed in the fresh folder; answered 1');
      }
      await sleep(200);
    }
    expect(rec !== undefined && rec.state === 'idle' && rec.claudeSessionId !== null && !!rec.transcriptPath, `the fresh Claude idle with its transcript path, got ${JSON.stringify(rec)?.slice(0, 300)}`);
    freshProject = path.dirname(rec.transcriptPath);
    expect(!fs.existsSync(freshProject), `the transcript folder is not there before the first prompt (else this step proves nothing): ${freshProject}`);
    await sleep(2000);

    const hooksLog = path.join(emeraldHome, 'logs', 'hooks.jsonl');
    const eventsFor = (id) =>
      (fs.existsSync(hooksLog) ? fs.readFileSync(hooksLog, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((l) => l.sessionId === id);
    const marker = 'emerald' + (Date.now() % 100000);
    const prompt = `Reply with exactly the word ${marker} and nothing else.`;
    await s.waitFor(`document.activeElement === ${q(paneSel(pane.id) + ' .chat-box')}`, 'the box holds the keyboard');
    await s.type(prompt);
    await s.key('Enter', 'Enter', 13);
    const workBy = Date.now() + 15000;
    let nudged = false;
    while (Date.now() < workBy) {
      const r = await record(freshId);
      if (r.state !== 'idle') break;
      if (!nudged && Date.now() > workBy - 10000 && !eventsFor(freshId).some((e) => e.event === 'UserPromptSubmit')) {
        console.log('[verify] note: no UserPromptSubmit 5 s after the send; Enter once more in the box');
        nudged = true;
        await s.evalJs(`${q(paneSel(pane.id) + ' .chat-box')}.focus()`);
        await s.key('Enter', 'Enter', 13);
        await typeRaw(freshId, '\r');
      }
      await sleep(200);
    }
    const stopBy = Date.now() + 90000;
    while (Date.now() < stopBy && !eventsFor(freshId).some((e) => e.event === 'Stop')) {
      expect((await record(freshId)).state !== 'needs-input', 'the fresh turn asked for input');
      await sleep(250);
    }
    expect(eventsFor(freshId).some((e) => e.event === 'Stop'), 'Stop logged for the fresh turn');
    const drawn = `(() => { const p = ${q(paneSel(pane.id))}; const replies = [...p.querySelectorAll('.chat-reply')]; return { prompt: [...p.querySelectorAll('.chat-prompt')].some((e) => e.textContent === ${JSON.stringify(prompt)}), reply: replies.at(-1)?.textContent.trim() ?? null }; })()`;
    const okDrawn = `(() => { const d = ${drawn}; return d.prompt && d.reply === ${JSON.stringify(marker)}; })()`;
    try {
      await s.waitFor(okDrawn, 'the fresh turn drawn', 5000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify(await s.evalJs(drawn))}`);
    }
    await s.screenshot('m9-chat-fresh.png');
    step(`fix 722: a real Claude started on the chat face in a folder Claude Code had never used draws its first turn: the prompt and the reply ${marker}`);
    await zreq(s, 'session.kill', { sessionId: freshId }).catch(() => {});
  });

  await block('menus', async () => {
    // M9 fixes 719 and 720: the box's `/` and `@` menus on a shell playing
    // Claude in a seeded folder, put in the first leaf of whatever the
    // blocks before left.
    const menusDir = path.join(emeraldHome, 'chat-719');
    fs.mkdirSync(path.join(menusDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(menusDir, 'src', 'alpha.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(menusDir, 'src', 'beta.ts'), 'export const b = 2;\n');
    fs.writeFileSync(path.join(menusDir, 'notes.md'), '# notes\n');
    fs.mkdirSync(path.join(menusDir, '.claude', 'skills', 'verify-skill-719'), { recursive: true });
    fs.writeFileSync(path.join(menusDir, '.claude', 'skills', 'verify-skill-719', 'SKILL.md'), '---\nname: verify-skill-719\ndescription: Seeded by verify:chat for fix 719.\n---\nA skill the menu lists.\n');
    const menusFixture = path.join(menusDir, 'fixture.jsonl');
    fs.writeFileSync(menusFixture, [userLine('list the menus', 0), asstLine([{ type: 'text', text: 'Listed.' }], 2)].join('\n') + '\n');
    const spawned = await zreq(s, 'session.spawn', { kind: 'shell', cwd: menusDir, cols: 120, rows: 30 });
    menusId = spawned.session.id;
    let lay = await getLayout(s);
    const menusPane = leaves(lay)[0].id;
    const rec = (n) => (n.kind === 'pane' ? (n.id === menusPane ? { ...n, sessionId: menusId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root) } });
    await s.waitFor(`!!${q(paneSel(menusPane) + ' .term-host')}`, 'the menus stub in the first pane', 10000);
    const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
    const postMenus = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': menusId },
        body: JSON.stringify({ session_id: 'sim-chat-719', cwd: menusDir, transcript_path: menusFixture, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postMenus({ hook_event_name: 'SessionStart', source: 'startup' });
    await postMenus({ hook_event_name: 'UserPromptSubmit', prompt: 'list the menus' });
    await postMenus({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(menusId, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the menus stub bound with its transcript', 10000);
    const boxSel = paneSel(menusPane) + ' .chat-box';
    // On the chat face with the box holding the keyboard; the box set the
    // way React hears it (cdp.mjs's setInput is an input's setter).
    const toChat = async () => {
      await s.waitFor(`!!${q(paneSel(menusPane) + ' .pane-face-toggle')}`, 'the face button on the menus stub', 10000);
      if ((await s.evalJs(`${q(paneSel(menusPane))}.dataset.face ?? null`)) !== 'chat') await s.evalJs(`${q(paneSel(menusPane) + ' .pane-face-toggle')}.click()`);
      await s.waitFor(`${q(paneSel(menusPane))}.dataset.face === 'chat' && !!${q(boxSel)}`, 'the menus stub on the chat face');
      await s.evalJs(`${q(boxSel)}.focus()`);
      await s.waitFor(`document.activeElement === ${q(boxSel)}`, 'the box holds the keyboard');
    };
    const setBoxText = (text) =>
      s.evalJs(`(() => { const b = ${q(boxSel)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(b, ${JSON.stringify(text)}); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const boxValue = () => s.evalJs(`${q(boxSel)}.value`);
    const menuRows = () => s.evalJs(`[...document.querySelectorAll('.chat-menu .chat-menu-row')].map((r) => ({ section: r.dataset.section ?? null, name: r.dataset.name ?? null, skill: r.hasAttribute('data-skill'), kind: r.dataset.kind ?? null, path: r.dataset.path ?? null, desc: r.querySelector('.chat-menu-desc')?.textContent ?? null, icon: !!r.querySelector('.chat-menu-terminal') }))`);
    await toChat();

    // (a) A `/` in the empty box: the two sections, the five built-ins, the
    // seeded skill once the reply lands, and the terminal's commands.
    await s.type('/');
    await s.waitFor(`!!document.querySelector('.chat-menu')`, 'the / menu');
    const headings = await s.evalJs(`[...document.querySelectorAll('.chat-menu .menu-heading')].map((e) => e.textContent)`);
    expect(JSON.stringify(headings) === '["Sent to the session","Open in the terminal"]', `the headings, got ${JSON.stringify(headings)}`);
    await s.waitFor(`!!document.querySelector('.chat-menu .chat-menu-row[data-name="/verify-skill-719"][data-skill]')`, 'the seeded skill in the menu', 5000);
    const rowsA = await menuRows();
    const sentA = rowsA.filter((r) => r.section === 'sent');
    expect(JSON.stringify(sentA.slice(0, 5).map((r) => r.name)) === JSON.stringify(['/compact', '/clear', '/init', '/recap', '/reload-skills']), `the five built-ins first, got ${JSON.stringify(sentA.slice(0, 6).map((r) => r.name))}`);
    const seeded = sentA.find((r) => r.name === '/verify-skill-719');
    expect(seeded?.desc === 'Seeded by verify:chat for fix 719.', `the seeded skill's description, got ${JSON.stringify(seeded)}`);
    const terminalA = rowsA.filter((r) => r.section === 'terminal');
    const TERMINAL = ['/model', '/permissions', '/mcp', '/config', '/usage', '/hooks', '/memory', '/resume', '/theme', '/login', '/status', '/doctor', '/btw'];
    expect(JSON.stringify(terminalA.map((r) => r.name)) === JSON.stringify(TERMINAL) && terminalA.every((r) => r.icon), `the terminal rows with their icons, got ${JSON.stringify(terminalA)}`);
    expect((await s.evalJs(`document.querySelector('.chat-menu .chat-menu-row[data-active="true"]')?.dataset.name ?? null`)) === '/compact', 'the first row highlighted');
    await s.screenshot('m9-chat-slash.png');
    step(`fix 719 (a): / opens the menu, ${sentA.length} rows sent to the session (the seeded skill among them) and ${terminalA.length} for the terminal`);

    // (b) Typing filters it.
    await s.type('verify-skill');
    await s.waitFor(`document.querySelectorAll('.chat-menu .chat-menu-row').length === 1`, 'one row for verify-skill', 3000);
    const rowsB = await menuRows();
    expect(rowsB[0].name === '/verify-skill-719', `the one row, got ${JSON.stringify(rowsB)}`);
    step('fix 719 (b): typing filters the menu to the seeded skill');

    // (c) Enter sends the row: the shell says it does not know the name.
    await s.key('Enter', 'Enter', 13);
    expect((await boxValue()) === '', 'the box emptied on Enter');
    const untilC = Date.now() + 10000;
    while (Date.now() < untilC && !(await screen(menusId)).rows.some((r) => r.includes('/verify-skill-719'))) await sleep(200);
    expect((await screen(menusId)).rows.some((r) => r.includes('/verify-skill-719')), 'the stub got /verify-skill-719');
    step('fix 719 (c): Enter sent /verify-skill-719 into the session');
    // The command ending at the shell's prompt reads as Claude leaving
    // (the ask block's note); a Stop binds the stub again.
    await waitRecord(menusId, (r) => r.command?.state !== 'running', 'the stub back at its prompt', 10000);
    await postMenus({ hook_event_name: 'Stop', stop_hook_active: false });
    await sleep(300);
    await toChat();

    // (d) Tab completes with a space and closes the menu.
    await s.type('/compa');
    await s.waitFor(`document.querySelector('.chat-menu .chat-menu-row[data-active="true"]')?.dataset.name === '/compact'`, 'the menu on /compact', 3000);
    await s.key('Tab', 'Tab', 9);
    await s.waitFor(`${q(boxSel)}.value === '/compact ' && !document.querySelector('.chat-menu')`, 'Tab completed /compact and closed the menu', 3000);
    step('fix 719 (d): Tab completes /compact with a space and the menu closes');

    // (e) Escape closes it and keeps the text.
    await setBoxText('');
    await s.type('/');
    await s.waitFor(`!!document.querySelector('.chat-menu')`, 'the / menu again');
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.chat-menu')`, 'Escape closed the menu', 2000);
    expect((await boxValue()) === '/', `the box kept its /, got ${JSON.stringify(await boxValue())}`);
    step('fix 719 (e): Escape closes the menu and keeps the box\'s text');

    // (f) M9 fix 720: `@sr` lists the folder src, with the keys' line.
    await setBoxText('');
    await s.type('@sr');
    await s.waitFor(`document.querySelectorAll('.chat-menu .chat-menu-row').length === 1`, 'the @ menu with one row', 5000);
    const rowsF = await menuRows();
    expect(rowsF[0].kind === 'dir' && rowsF[0].path === 'src/', `the one row is src/, got ${JSON.stringify(rowsF)}`);
    const foot = await s.evalJs(`document.querySelector('.chat-menu .chat-menu-foot')?.textContent ?? null`);
    expect(foot === 'Tab or Enter adds the path · Esc closes', `the foot, got ${JSON.stringify(foot)}`);
    await s.screenshot('m9-chat-mention.png');
    step('fix 720 (f): @sr lists the folder src/ and the keys under it');

    // (g) Tab on a folder descends into it.
    await s.key('Tab', 'Tab', 9);
    await s.waitFor(`${q(boxSel)}.value === '@src/' && document.querySelectorAll('.chat-menu .chat-menu-row').length === 2`, 'the box @src/ and src listed', 5000);
    const rowsG = await menuRows();
    expect(JSON.stringify(rowsG.map((r) => r.path)) === '["src/alpha.ts","src/beta.ts"]', `src's files, got ${JSON.stringify(rowsG.map((r) => r.path))}`);
    step('fix 720 (g): Tab on src/ puts @src/ in the box and lists its files');

    // (h) Tab on a file finishes the mention with a space.
    await s.type('al');
    await s.waitFor(`document.querySelectorAll('.chat-menu .chat-menu-row').length === 1`, 'one row for al', 3000);
    await s.key('Tab', 'Tab', 9);
    await s.waitFor(`${q(boxSel)}.value === '@src/alpha.ts ' && !document.querySelector('.chat-menu')`, 'the mention finished and the menu closed', 3000);
    step('fix 720 (h): Tab on alpha.ts gives @src/alpha.ts and closes the menu');

    // (i) The reply branch's `Mention in the message` lands at the caret;
    // (j) one naming another pane is ignored.
    await setBoxText('');
    await s.type('abc ');
    const mentionEvent = (paneId, p) => s.evalJs(`window.dispatchEvent(new CustomEvent('emerald:chat-mention', { detail: { paneId: ${JSON.stringify(paneId)}, path: ${JSON.stringify(p)} } }))`);
    const menusCwd = (await record(menusId)).cwd;
    console.log(`[verify] note: fix 751: the stub's folder is ${menusDir.toLowerCase() === menusCwd.toLowerCase() ? 'spelled long, so the short spelling is not exercised' : 'spelled short against the record\'s long cwd'}`);
    await mentionEvent(menusPane, path.join(menusDir, 'notes.md'));
    try {
      await s.waitFor(`${q(boxSel)}.value === 'abc @notes.md '`, 'the mention at the caret', 3000);
    } catch (err) {
      throw new Error(`${err.message}: box ${JSON.stringify(await boxValue())}, cwd ${menusCwd}`);
    }
    await mentionEvent('not-a-pane', path.join(menusDir, 'src', 'beta.ts'));
    await sleep(300);
    expect((await boxValue()) === 'abc @notes.md ', `another pane's mention left the box alone, got ${JSON.stringify(await boxValue())}`);
    step('fix 720 (i, j): a mention event for this pane lands at the caret; one for another pane does nothing');

    // (k) M9 fix 749: /cost, /usage's alias, is no row of the menu, so
    // Enter sends the box, and the send brings the fallback bar.
    await setBoxText('');
    await s.type('/cost');
    await s.key('Enter', 'Enter', 13);
    await s.waitFor(`!!${q(paneSel(menusPane) + ' .chat-fallback')}`, 'the fallback bar after /cost', 5000);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!${q(paneSel(menusPane) + ' .chat-fallback')}`, 'the fallback bar gone on Escape', 2000);
    step('fix 749 (k): a typed /cost, /usage\'s alias, brings the fallback bar');
    // The shell ran /cost as a command; a Stop binds the stub again.
    await waitRecord(menusId, (r) => r.command?.state !== 'running', 'the stub back at its prompt after /cost', 10000);
    await postMenus({ hook_event_name: 'Stop', stop_hook_active: false });
    await sleep(300);
    await toChat();

    // (l) M9 fix 750: the pointer moves the / menu's highlight, one row is
    // lit whatever the pointer is over, and Tab takes the lit one. Two
    // moves, so the second carries movement.
    await setBoxText('');
    await s.type('/');
    await s.waitFor(`!!document.querySelector('.chat-menu')`, 'the / menu for the pointer');
    const centreOf = (expr) => s.evalJs(`(() => { const r = ${expr}.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    const boxAt = await centreOf(q(boxSel));
    const initAt = await centreOf(`document.querySelectorAll('.chat-menu .chat-menu-row')[2]`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: boxAt.x, y: boxAt.y });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: initAt.x, y: initAt.y });
    const activeName = () => s.evalJs(`document.querySelector('.chat-menu .chat-menu-row[data-active="true"]')?.dataset.name ?? null`);
    try {
      await s.waitFor(`document.querySelector('.chat-menu .chat-menu-row[data-name="/init"]')?.dataset.active === 'true'`, 'the pointer lit /init', 3000);
    } catch (err) {
      throw new Error(`${err.message}: the lit row ${JSON.stringify(await activeName())}`);
    }
    await s.key('ArrowDown', 'ArrowDown', 40);
    await s.waitFor(`document.querySelector('.chat-menu .chat-menu-row[data-name="/recap"]')?.dataset.active === 'true'`, 'ArrowDown lit /recap', 3000);
    const lit = await s.evalJs(`[...document.querySelectorAll('.chat-menu .chat-menu-row')].filter((r) => getComputedStyle(r).backgroundColor !== 'rgba(0, 0, 0, 0)').map((r) => r.dataset.name)`);
    expect(JSON.stringify(lit) === '["/recap"]', `one row lit, /recap, with the pointer over /init, got ${JSON.stringify(lit)}`);
    await s.key('Tab', 'Tab', 9);
    await s.waitFor(`${q(boxSel)}.value === '/recap ' && !document.querySelector('.chat-menu')`, 'Tab took /recap and closed the menu', 3000);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    step('fix 750 (l): the pointer moves the / menu\'s highlight and one row is lit; Tab takes it');

    // (m) M9 fix 746: the paperclip attaches any file. Its pick cannot be
    // driven here (EMERALD_PICK_FILE is the image block's PNG for the whole
    // run), so the drop, which runs the same takeFile, is the read: a .ts
    // under the folder goes in as a relative mention, one outside it as
    // its absolute path, and nothing is typed into the session.
    expect((await s.evalJs(`${q(paneSel(menusPane) + ' .chat-attach')}.title`)) === 'Attach a file', 'the paperclip reads Attach a file');
    await setBoxText('');
    await dropOn(path.join(menusDir, 'src', 'alpha.ts'), boxSel);
    try {
      await s.waitFor(`${q(boxSel)}.value === '@src/alpha.ts '`, 'the dropped .ts as a mention', 5000);
    } catch (err) {
      throw new Error(`${err.message}: box ${JSON.stringify(await boxValue())}`);
    }
    expect((await s.evalJs(`!!document.querySelector(${JSON.stringify(paneSel(menusPane) + ' .chat-image-chip')})`)) === false, 'no image chip for a .ts');
    expect(!(await screen(menusId)).rows.some((r) => r.includes('alpha.ts')), 'nothing typed into the session for the drop');
    const outside = path.join(emeraldHome, 'outside-746.txt');
    fs.writeFileSync(outside, 'outside the folder\n');
    const outsideReal = fs.realpathSync.native(outside).replace(/\\/g, '/');
    const outsideMention = outsideReal.includes(' ') ? `@"${outsideReal}"` : `@${outsideReal}`;
    await dropOn(outside, boxSel);
    try {
      await s.waitFor(`${q(boxSel)}.value === ${JSON.stringify(`@src/alpha.ts ${outsideMention} `)}`, 'the outside file as its absolute path', 5000);
    } catch (err) {
      throw new Error(`${err.message}: box ${JSON.stringify(await boxValue())}`);
    }
    step('fix 746 (m): the paperclip reads Attach a file; a .ts dropped on the box goes in as @src/alpha.ts, one outside the folder as its absolute path, nothing typed into the session');

    // (n) M9 fix 755: a session in a subfolder of the seeded folder lists the folder's skill, read by the walk up.
    const srcDir = path.join(menusDir, 'src');
    const oldId = menusId;
    const spawnedK = await zreq(s, 'session.spawn', { kind: 'shell', cwd: srcDir, cols: 120, rows: 30 });
    menusId = spawnedK.session.id;
    lay = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root) } });
    await zreq(s, 'session.kill', { sessionId: oldId }).catch(() => {});
    await postMenus({ hook_event_name: 'SessionStart', source: 'startup', cwd: srcDir });
    await postMenus({ hook_event_name: 'UserPromptSubmit', prompt: 'list the menus', cwd: srcDir });
    await postMenus({ hook_event_name: 'Stop', stop_hook_active: false, cwd: srcDir });
    await waitRecord(menusId, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the subfolder stub bound with its transcript', 10000);
    await toChat();
    await s.waitFor(`document.querySelector(${JSON.stringify(paneSel(menusPane) + ' .chat-view')})?.dataset.sessionId === ${JSON.stringify(menusId)}`, 'the chat view on the subfolder session', 10000);
    await setBoxText('');
    await s.type('/');
    await s.waitFor(`!!document.querySelector('.chat-menu .chat-menu-row[data-name="/verify-skill-719"][data-skill]')`, 'the folder skill listed from the subfolder', 5000);
    await setBoxText('');
    step('fix 755 (n): a session in <menusDir>/src lists /verify-skill-719 from <menusDir>/.claude/skills');

    await zreq(s, 'session.kill', { sessionId: menusId }).catch(() => {});
    menusId = null;
  });

  await block('image', async () => {
    // M9 fix 721: images into a real Claude's prompt from the chat box, by
    // the paste, the attach button and a drop. One real turn. The probe
    // (chat-claims-713.md) found a path pasted the way a terminal pastes
    // becomes `[Image #N]`, and neither Ctrl+L nor Escape clears it while
    // one Ctrl+C does; since fix 748 the chips row's × sends that Ctrl+C,
    // so this block clears Claude's prompt and the chips with the ×.
    const spawned = await zreq(s, 'session.spawn', { kind: 'claude', cwd: repoRoot, args: ['--permission-mode', 'default'], cols: 120, rows: 30 });
    imageId = spawned.session.id;
    let lay = await getLayout(s);
    const imagePane = leaves(lay)[0].id;
    const rec = (n) => (n.kind === 'pane' ? (n.id === imagePane ? { ...n, sessionId: imageId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root) } });
    await waitRecord(imageId, (r) => r.state === 'idle' && r.claudeSessionId !== null, 'the real Claude idle', 30000);
    await sleep(2000);
    const boxSel = paneSel(imagePane) + ' .chat-box';
    const toggle = () => s.evalJs(`${q(paneSel(imagePane) + ' .pane-face-toggle')}.click()`);
    const toChat = async () => {
      await s.waitFor(`!!${q(paneSel(imagePane) + ' .pane-face-toggle')}`, 'the face button on the real Claude', 10000);
      if ((await s.evalJs(`${q(paneSel(imagePane))}.dataset.face ?? null`)) !== 'chat') await toggle();
      await s.waitFor(`${q(paneSel(imagePane))}.dataset.face === 'chat' && !!${q(boxSel)}`, 'the real Claude on the chat face');
      await s.evalJs(`${q(boxSel)}.focus()`);
      await s.waitFor(`document.activeElement === ${q(boxSel)}`, 'the box holds the keyboard');
    };
    const setBoxText = (text) =>
      s.evalJs(`(() => { const b = ${q(boxSel)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(b, ${JSON.stringify(text)}); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    // Claude Code's prompt row: the last row starting with its glyph.
    const promptRow = async () => {
      const rows = (await screen(imageId)).rows;
      for (let i = rows.length - 1; i >= 0; i--) if (/^\s*❯/.test(rows[i])) return rows[i];
      return '';
    };
    const waitPrompt = async (test, what, ms = 5000) => {
      const until = Date.now() + ms;
      while (Date.now() < until && !test(await promptRow())) await sleep(200);
      if (!test(await promptRow())) {
        const sc = await screen(imageId);
        expect(false, `${what}, got ${JSON.stringify(await promptRow())}; screen ${sc.cols ?? '?'}x${sc.rows.length}, rows ${JSON.stringify(sc.rows.filter((r) => r.trim() !== ''))}`);
      }
    };
    const chipRead = () => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(paneSel(imagePane) + ' .chat-image-chip')})].map((c) => ({ label: c.querySelector('.chat-image-chip-label')?.textContent ?? null, width: c.querySelector('img.chat-image-chip-thumb')?.naturalWidth ?? 0 }))`);
    const waitChips = async (n, what) => {
      await s.waitFor(`(() => { const cs = [...document.querySelectorAll(${JSON.stringify(paneSel(imagePane) + ' .chat-image-chip')})]; return cs.length === ${n} && cs.every((c) => /^Image #\\d+$/.test(c.querySelector('.chat-image-chip-label')?.textContent ?? '') && (c.querySelector('img.chat-image-chip-thumb')?.naturalWidth ?? 0) > 0); })()`, what, 5000);
    };
    // The chips row's × (fix 748): the chips gone and Claude's prompt
    // without a marker.
    const clearSel = paneSel(imagePane) + ' .chat-image-chips-clear';
    const clearByX = async (what) => {
      const state = (await record(imageId)).state;
      const disabled = await s.evalJs(`${q(clearSel)}.disabled`);
      await s.evalJs(`${q(clearSel)}.click()`);
      try {
        await s.waitFor(`!document.querySelector(${JSON.stringify(paneSel(imagePane) + ' .chat-image-chip')})`, `no chips after the × (${what})`, 6000);
      } catch (err) {
        throw new Error(`${err.message}: state ${state}, × disabled ${disabled}, prompt row ${JSON.stringify(await promptRow())}, last rows ${JSON.stringify((await screen(imageId)).rows.slice(-8))}`);
      }
      await waitPrompt((row) => !row.includes('[Image #'), `the × cleared Claude's prompt (${what})`);
    };
    await toChat();

    // (a) Text on the clipboard pastes into the box.
    await s.evalJs(`window.emerald.clipboard.write('pasted-721')`);
    await s.key('v', 'KeyV', 86, CTRL);
    await s.waitFor(`${q(boxSel)}.value === 'pasted-721'`, 'Ctrl+V pasted the held text into the box', 3000);
    await setBoxText('');
    step('fix 721 (a): Ctrl+V with text on the clipboard pastes it into the box');

    // (b) An image on the clipboard goes into Claude's prompt, with a chip.
    const dataUrl = await s.evalJs(`(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d'); g.fillStyle = 'rgb(220, 0, 0)'; g.fillRect(0, 0, 64, 64); return c.toDataURL('image/png'); })()`);
    fs.mkdirSync(path.dirname(attachPng), { recursive: true });
    fs.writeFileSync(attachPng, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await s.evalJs(`window.emerald.clipboard.writeImage(${JSON.stringify(dataUrl)})`);
    await s.key('v', 'KeyV', 86, CTRL);
    await waitChips(1, 'a chip labelled Image #N with its thumbnail');
    await waitPrompt((row) => row.includes('[Image #'), 'the image in Claude\'s prompt');
    expect((await s.evalJs(`${q(boxSel)}.value`)) === '', 'the box holds no text after the image paste');
    await s.screenshot('m9-chat-chip.png');
    step(`fix 721 (b): Ctrl+V with an image puts ${(await chipRead())[0].label} in Claude's prompt and a chip over the box`);

    // (b2) M9 fix 748: the chips' × takes the image out of Claude's prompt
    // with one Ctrl+C, and the session neither ends nor starts a turn.
    const clearTitle = await s.evalJs(`${q(clearSel)}?.title ?? null`);
    expect(clearTitle === 'Remove the images (clears Claude Code\'s prompt; your text stays)', `the ×'s title, got ${JSON.stringify(clearTitle)}`);
    expect((await s.evalJs(`${q(clearSel)}.disabled`)) === false, 'the × enabled while idle');
    await clearByX('b2');
    const afterX = (await record(imageId)).state;
    expect(afterX !== 'exited' && afterX !== 'working', `the session still idle after the ×, got ${afterX}`);
    step('fix 748 (b2): the chips\' × clears the image from Claude\'s prompt with one Ctrl+C, the session still idle');

    // (b3) A second paste goes in after the ×; the held clipboard still has
    // the image from (b).
    await s.key('v', 'KeyV', 86, CTRL);
    await waitChips(1, 'a chip from the second paste');
    await waitPrompt((row) => row.includes('[Image #'), 'the second paste in Claude\'s prompt');
    step('fix 748 (b3): a second paste goes in after the ×');

    // (c) The words sent after it: one prompt with the image and the words.
    const hooksLog = path.join(emeraldHome, 'logs', 'hooks.jsonl');
    const eventsFor = (id) =>
      (fs.existsSync(hooksLog) ? fs.readFileSync(hooksLog, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((l) => l.sessionId === id);
    const stopsBefore = eventsFor(imageId).filter((e) => e.event === 'Stop').length;
    await s.type('describe this image in one word');
    await s.key('Enter', 'Enter', 13);
    await s.waitFor(`!document.querySelector(${JSON.stringify(paneSel(imagePane) + ' .chat-image-chip')})`, 'the chips gone on Send', 3000);
    const stopBy = Date.now() + 90000;
    let answered = false;
    while (Date.now() < stopBy && eventsFor(imageId).filter((e) => e.event === 'Stop').length === stopsBefore) {
      if (!answered && (await record(imageId)).state === 'needs-input') {
        await s.waitFor(`!!${q(paneSel(imagePane) + ' .chat-ask-option[data-key="1"]')}`, 'the card offers 1', 10000);
        await s.evalJs(`${q(paneSel(imagePane) + ' .chat-ask-option[data-key="1"]')}.click()`);
        answered = true;
        console.log('[verify] note: a permission was asked during the image turn; answered 1 on the card');
      }
      await sleep(250);
    }
    expect(eventsFor(imageId).filter((e) => e.event === 'Stop').length > stopsBefore, 'Stop logged for the image turn');
    const tpath = (await record(imageId)).transcriptPath;
    const users = fs.readFileSync(tpath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((o) => o.type === 'user' && Array.isArray(o.message?.content));
    const sent = users.find((o) => o.message.content.some((p) => p.type === 'text' && (p.text ?? '').includes('describe this image in one word')));
    expect(sent !== undefined && sent.message.content.some((p) => p.type === 'image'), `the transcript's user line holds an image part and the words, got ${JSON.stringify(sent?.message.content.map((p) => p.type) ?? null)}`);
    step(`fix 721 (c): the words went after the image as one prompt (${sent.message.content.map((p) => p.type).join(', ')})`);

    // (d) The attach button: a chip and the image in Claude's prompt, and
    // the words wait in the box. The chip's number is the prompt row's,
    // with (c)'s sent marker in the scrollback above (fix 748); the ×
    // then clears the image and keeps the words. Fix 748's runs found a
    // Ctrl+C within a second of the Stop left the marker in place (Claude
    // Code still busy after its hooks), so the step starts three seconds
    // after (c)'s turn, as a person would.
    await sleep(3000);
    await toChat();
    await s.evalJs(`${q(paneSel(imagePane) + ' .chat-attach')}.click()`);
    await waitChips(1, 'a chip from the attach button');
    await waitPrompt((row) => row.includes('[Image #'), 'the attached image in Claude\'s prompt');
    await s.type('keep me');
    expect((await s.evalJs(`${q(boxSel)}.value`)) === 'keep me', 'the words wait in the box');
    const rowN = /\[Image #(\d+)\]/.exec(await promptRow())?.[1] ?? null;
    const chipLabel = (await chipRead())[0]?.label ?? null;
    expect(rowN !== null && chipLabel === `Image #${rowN}`, `the chip's number is the prompt row's, chip ${JSON.stringify(chipLabel)}, row ${JSON.stringify(await promptRow())}`);
    step('fix 721 (d): the attach button puts the chosen image in Claude\'s prompt with a chip');
    await clearByX('d');
    expect((await s.evalJs(`${q(boxSel)}.value`)) === 'keep me', `the box kept its words after the ×, got ${JSON.stringify(await s.evalJs(`${q(boxSel)}.value`))}`);
    step(`fix 748 (d): the chip read ${chipLabel}, the prompt row's number; the × cleared it and the box kept its words`);
    await setBoxText('');

    // (e) A drop of the image on the box does the same.
    await dropOn(attachPng, boxSel);
    await waitChips(1, 'a chip from the drop');
    await waitPrompt((row) => row.includes('[Image #'), 'the dropped image in Claude\'s prompt');
    expect(!(await promptRow()).includes('attach.png'), 'the path went in as an image, not as text');
    step('fix 721 (e): an image dropped on the box goes into Claude\'s prompt with a chip');
    await clearByX('e');

    // (f) M9 fix 747: an image dropped on the chat face's timeline, not
    // the box, goes into Claude's prompt as an image, with a chip.
    await dropOn(attachPng, paneSel(imagePane) + ' .chat-timeline');
    try {
      await waitChips(1, 'a chip from the drop on the timeline');
    } catch (err) {
      throw new Error(`${err.message}: chips ${JSON.stringify(await chipRead())}, prompt row ${JSON.stringify(await promptRow())}, face ${await s.evalJs(`${q(paneSel(imagePane))}.dataset.face ?? null`)}, state ${(await record(imageId)).state}, rows ${JSON.stringify((await screen(imageId)).rows.filter((r) => r.trim() !== ''))}`);
    }
    await waitPrompt((row) => row.includes('[Image #'), 'the image dropped on the timeline in Claude\'s prompt');
    expect(!(await promptRow()).includes('attach.png'), `the timeline drop went in as an image, not as text, got ${JSON.stringify(await promptRow())}`);
    step('fix 747 (f): an image dropped on the chat face\'s timeline goes into Claude\'s prompt as an image, with a chip');
    await clearByX('f');

    // (g) The same on the terminal face, cleared there with one Ctrl+C on
    // the pty (the terminal face has no ×).
    await toggle();
    await s.waitFor(`${q(paneSel(imagePane))}.dataset.face === undefined`, 'the terminal face for the drop');
    await dropOn(attachPng, paneSel(imagePane) + ' .term-host');
    await waitPrompt((row) => row.includes('[Image #'), 'the image dropped on the terminal face in Claude\'s prompt');
    expect(!(await promptRow()).includes('attach.png'), `the terminal drop went in as an image, not as text, got ${JSON.stringify(await promptRow())}`);
    step('fix 747 (g): an image dropped on the terminal face goes into Claude\'s prompt as an image');
    // Two Ctrl+Cs inside Claude Code's press-again window end the session
    // (fix 748), so this one waits out the gap since (f)'s ×.
    await sleep(2000);
    await typeRaw(imageId, '\x03');
    await waitPrompt((row) => !row.includes('[Image #'), 'Ctrl+C cleared the terminal drop');
    await toChat();

    // (h) /exit, which no row of the / menu holds, ends the session.
    await s.type('/exit');
    await s.key('Enter', 'Enter', 13);
    await waitRecord(imageId, (r) => r.state === 'exited' && r.exitCode === 0, 'the image Claude exited (0)', 30000);
    imageId = null;
    step('fix 721 (h): /exit from the box ends the session with exit code 0');
  });

  await block('more', async () => {
    // M9 fix 723: More... from the empty pane with Chat picked starts the
    // session on the chat face, with the dialog's args.
    let moreId = null;
    try {
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
      await s.evalJs(`${q('.empty-pane .empty-more')}.click()`);
      await s.waitFor(`!!${q('.dialog.new-session input[name=args]')}`, 'the dialog with its args box');
      const pairUp = await s.evalJs(`!!document.querySelector('.empty-pane .empty-opens-chat[aria-pressed="true"]') && !!document.querySelector('.dialog.new-session')`);
      expect(pairUp === true, 'the pair is up beside the open dialog');
      await s.evalJs(`${q('.dialog.new-session input[name=args]')}.focus()`);
      await s.type('--permission-mode default');
      await s.evalJs(`[...document.querySelectorAll('.dialog .dialog-actions button')].find((b) => b.textContent.trim() === 'Start').click()`);
      await s.waitFor(`!document.querySelector('.dialog.new-session') && !!document.querySelector('.pane[data-face="chat"]')`, 'the dialog closed and the session on the chat face', 15000);
      lay = await getLayout(s);
      moreId = leaves(lay)[0].sessionId;
      expect(moreId !== null, 'the pane holds the new session');
      const r = await record(moreId);
      expect(JSON.stringify(r.args) === '["--permission-mode","default"]', `the record's args, got ${JSON.stringify(r.args)}`);
      step('fix 723: More… with Chat picked starts the session on the chat face with --permission-mode default in its args');
    } finally {
      if (moreId !== null) await zreq(s, 'session.kill', { sessionId: moreId }).catch(() => {});
    }
  });

  await block('turns', async () => {
    // M9 fixes 752 and 753: a shell playing Claude with thirty short turns,
    // so the timeline scrolls, then turn A: three calls, a reply, three
    // more calls. Opening or closing A's fold keeps the reply where it
    // was and tints it once; then turns B and C read the fold dots' tones.
    const turnsDir = path.join(emeraldHome, 'chat-752');
    fs.mkdirSync(turnsDir, { recursive: true });
    const turnsFixture = path.join(turnsDir, 'fixture.jsonl');
    const bash = (id, sec) => [asstLine([useOf(id, 'Bash', { command: `echo ${id}` })], sec), resultOf(id, id, sec + 1, { toolUseResult: { stdout: id, stderr: '', interrupted: false } })];
    const lines = [];
    for (let k = 0; k < 30; k++) lines.push(userLine(`turn ${k}`, k * 10), asstLine([{ type: 'text', text: `Reply ${k}.` }], k * 10 + 1));
    lines.push(userLine('open the fold', 400), ...bash('a1', 401), ...bash('a2', 403), ...bash('a3', 405), asstLine([{ type: 'text', text: 'Halfway there.' }], 407), ...bash('a4', 408), ...bash('a5', 410), ...bash('a6', 412));
    fs.writeFileSync(turnsFixture, lines.join('\n') + '\n');
    const spawned = await zreq(s, 'session.spawn', { kind: 'shell', cwd: turnsDir, cols: 120, rows: 30 });
    turnsId = spawned.session.id;
    const lay = await getLayout(s);
    turnsPane = leaves(lay)[0].id;
    const rec = (n) => (n.kind === 'pane' ? (n.id === turnsPane ? { ...n, sessionId: turnsId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root), focusedPaneId: turnsPane } });
    await s.waitFor(`!!${q(paneSel(turnsPane) + ' .term-host')}`, 'the turns stub in the first pane', 10000);
    const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
    postTurns = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': turnsId },
        body: JSON.stringify({ session_id: 'sim-chat-752', cwd: turnsDir, transcript_path: turnsFixture, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postTurns({ hook_event_name: 'SessionStart', source: 'startup' });
    await postTurns({ hook_event_name: 'UserPromptSubmit', prompt: 'open the fold' });
    await postTurns({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(turnsId, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the turns stub bound with its transcript', 10000);
    await s.waitFor(`!!${q(paneSel(turnsPane) + ' .pane-face-toggle')}`, 'the face button on the turns stub', 10000);
    await toChat(turnsPane);
    if ((await viewWord(turnsPane)) !== 'Normal') await pickView(turnsPane, 'Normal');
    const TP = paneSel(turnsPane);
    const tlSel = TP + ' .chat-timeline';
    await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(TP + ' .chat-reply')})].some((r) => r.textContent.trim() === 'Halfway there.')`, 'turn A drawn', 10000);
    const replyOf = (text) => `[...document.querySelectorAll(${JSON.stringify(TP + ' .chat-reply')})].find((r) => r.textContent.trim() === ${JSON.stringify(text)})`;
    const room = await s.evalJs(`(() => { const t = ${q(tlSel)}; return t.scrollHeight - t.clientHeight; })()`);
    expect(room > 400, `the timeline scrolls by more than 400 px, got ${room}`);
    await s.evalJs(`(() => { const t = ${q(tlSel)}; t.scrollTop = t.scrollHeight; })()`);
    await sleep(200);
    // One toggle of A's fold (the last fold in the pane): the reply's top
    // before and 50 ms after, the timeline's box, the flash class, and the
    // tint's opacity at 50 and 350 ms, logged and not judged (the box's
    // animation setting decides it).
    const toggle = () =>
      s.evalJs(`(async () => {
        const reply = ${replyOf('Halfway there.')};
        const before = reply.getBoundingClientRect().top;
        const folds = document.querySelectorAll(${JSON.stringify(TP + ' .chat-fold')});
        folds[folds.length - 1].click();
        await new Promise((r) => setTimeout(r, 50));
        const after = ${replyOf('Halfway there.')};
        const { top, bottom } = after.getBoundingClientRect();
        const t = ${q(tlSel)}.getBoundingClientRect();
        const early = getComputedStyle(after, '::before').opacity;
        const flashed = after.classList.contains('chat-fold-flash');
        await new Promise((r) => setTimeout(r, 300));
        return { before, top, bottom, tTop: t.top, tBottom: t.bottom, flashed, early, late: getComputedStyle(after, '::before').opacity, open: folds[folds.length - 1].dataset.open ?? null };
      })()`);
    const opened = await toggle();
    console.log(`[verify] fix 752 open: ${JSON.stringify(opened)}`);
    expect(opened.open !== null || (await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(TP + ' .chat-fold')})].pop().dataset.open ?? null`)) !== null, 'the fold opened');
    expect(Math.abs(opened.top - opened.before) <= 2, `the reply stayed where it was on opening, ${opened.before} then ${opened.top}`);
    expect(opened.top >= opened.tTop - 1 && opened.bottom <= opened.tBottom + 1, `the reply is inside the timeline's box, ${JSON.stringify(opened)}`);
    expect(opened.flashed, 'the reply carries the flash on opening');
    await s.waitFor(`!${replyOf('Halfway there.')}.classList.contains('chat-fold-flash')`, 'the flash class gone by its timer', 3000);
    const closed = await toggle();
    console.log(`[verify] fix 752 close: ${JSON.stringify(closed)}`);
    expect(Math.abs(closed.top - closed.before) <= 2, `the reply stayed where it was on closing, ${closed.before} then ${closed.top}`);
    expect(closed.top >= closed.tTop - 1 && closed.bottom <= closed.tBottom + 1, `the reply is inside the timeline's box, ${JSON.stringify(closed)}`);
    expect(closed.flashed, 'the reply carries the flash on closing');
    // The paint read (fix 86's shape): two frames of the reply's box, 100
    // and 400 ms after a toggle, logged as the same or different.
    const clipOf = async () => {
      const r = await s.evalJs(`(() => { const { left, top, width, height } = ${replyOf('Halfway there.')}.getBoundingClientRect(); return { x: left - 8, y: top - 4, width: width + 16, height: height + 8 }; })()`);
      return { ...r, scale: 1 };
    };
    await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(TP + ' .chat-fold')})].pop().click()`);
    await sleep(100);
    const f1 = (await s.send('Page.captureScreenshot', { format: 'png', clip: await clipOf() })).data;
    await sleep(300);
    const f2 = (await s.send('Page.captureScreenshot', { format: 'png', clip: await clipOf() })).data;
    console.log(`[verify] fix 752 paint read: the frames at 100 and 400 ms are ${f1 === f2 ? 'the same (no fade painted)' : 'different (the fade painted)'}`);
    fs.writeFileSync(path.join(os.tmpdir(), 'emerald-verify', 'm9-chat-turns-flash-100.png'), Buffer.from(f1, 'base64'));
    fs.writeFileSync(path.join(os.tmpdir(), 'emerald-verify', 'm9-chat-turns-flash-400.png'), Buffer.from(f2, 'base64'));
    await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(TP + ' .chat-fold')})].pop().click()`);
    await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(TP + ' .chat-fold')})].pop().dataset.open === undefined`, 'the fold closed again', 3000);
    // The view still sticks after the anchor.
    await s.evalJs(`(() => { const t = ${q(tlSel)}; t.scrollTop = t.scrollHeight; })()`);
    await sleep(200);
    fs.appendFileSync(turnsFixture, [userLine('one more', 600), asstLine([{ type: 'text', text: 'One more reply.' }], 601)].join('\n') + '\n');
    await s.waitFor(`!!${replyOf('One more reply.')}`, 'the next turn drawn', 10000);
    await s.waitFor(`(() => { const t = ${q(tlSel)}; return t.scrollTop + t.clientHeight >= t.scrollHeight - 2; })()`, 'the view stuck to the end after the anchor', 3000);
    step('fix 752: opening and closing a fold keeps the reply under the calls where it was, tinted once, and the view sticks to the end after');

    // Fix 753: turn B's last call fails, turn C's call is still out.
    fs.appendFileSync(
      turnsFixture,
      [
        userLine('break it', 700),
        ...bash('b1', 701),
        asstLine([useOf('b2', 'Bash', { command: 'exit 1' })], 703),
        resultOf('b2', 'Exit code 1', 704, { toolUseResult: 'Error: Exit code 1' }, true),
        asstLine([{ type: 'text', text: 'It broke.' }], 705),
        userLine('still going', 800),
        asstLine([useOf('c1', 'Bash', { command: 'sleep 60' })], 801),
      ].join('\n') + '\n',
    );
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(TP + ' .chat-fold')}).length >= 3 && !!${replyOf('It broke.')}`, 'turns B and C drawn', 10000);
    const tones = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(TP + ' .chat-fold .chat-dot')})].map((d) => d.dataset.tone).slice(-3)`);
    expect(JSON.stringify(tones) === '["done","error","pending"]', `the fold dots of turns A, B and C, got ${JSON.stringify(tones)}`);
    step('fix 753: a fold dot reads done, error after a failed last call, and pending while a call runs');
  });

  await block('queued', async () => {
    // M9 fix 754: on turns' stub, a message queued while the turn runs
    // shows under the live line with Edit (Claude Code 2.1.301 pulls the
    // whole queue back, so no Remove), and one Claude read mid-turn shows
    // in its turn as a small bubble. The stub is a shell, so Edit is not
    // clicked here: PowerShell would take Up as a history recall (the
    // real block clicks it).
    const TP = paneSel(turnsPane);
    const turnsFixture = path.join(emeraldHome, 'chat-752', 'fixture.jsonl');
    const qline = (operation, content, extra = {}) => JSON.stringify({ type: 'queue-operation', operation, timestamp: at(900), sessionId: 'sim-chat-752', ...(content === undefined ? {} : { content }), ...extra });
    await toChat(turnsPane);
    await postTurns({ hook_event_name: 'UserPromptSubmit', prompt: 'still going' });
    await waitRecord(turnsId, (r) => r.state === 'working', 'the turns stub working', 10000);
    fs.appendFileSync(turnsFixture, [qline('enqueue', 'also check the footer'), qline('enqueue', '<task-notification>\n<task-id>x</task-id>\n</task-notification>')].join('\n') + '\n');
    const bubbles = () => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(TP + ' .chat-queued')})].map((b) => ({ text: b.querySelector('.chat-queued-text')?.textContent ?? null, edit: !!b.querySelector('button.chat-queued-edit'), remove: !!b.querySelector('button.chat-queued-remove') }))`);
    try {
      await s.waitFor(`document.querySelectorAll(${JSON.stringify(TP + ' .chat-queued')}).length === 1`, 'one queued bubble', 10000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify(await bubbles())}`);
    }
    const shown = await bubbles();
    expect(JSON.stringify(shown) === JSON.stringify([{ text: 'also check the footer', edit: true, remove: false }]), `the person's message queued with Edit (no Remove on the pull-all path), the notification left out, got ${JSON.stringify(shown)}`);
    const hint = await s.evalJs(`${q(TP + ' .chat-hint')}?.textContent ?? null`);
    expect(hint === '1 queued · Up to edit', `the hint with one queued, got ${JSON.stringify(hint)}`);
    step('fix 754: a message queued while the turn runs shows under the live line with Edit, the hint reading 1 queued · Up to edit');

    fs.appendFileSync(
      turnsFixture,
      [
        qline('remove', 'also check the footer', { reason: 'absorbed_mid_turn' }),
        JSON.stringify({ type: 'attachment', isSidechain: false, timestamp: at(905), attachment: { type: 'queued_command', prompt: 'also check the footer', commandMode: 'prompt', origin: { kind: 'human' }, humanTurn: true, timestamp: at(900) } }),
      ].join('\n') + '\n',
    );
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(TP + ' .chat-queued')}).length === 0 && ${q(TP + ' .chat-queued-step .chat-queued-bubble')}?.textContent === 'also check the footer'`, 'the bubble gone and the message in its turn', 10000);
    const when = await s.evalJs(`${q(TP + ' .chat-queued-step .chat-queued-time')}?.textContent ?? null`);
    expect(typeof when === 'string' && when.startsWith('sent mid-turn'), `the absorbed message's time, got ${JSON.stringify(when)}`);
    await postTurns({ hook_event_name: 'Stop', stop_hook_active: false });
    step('fix 754: a message Claude read mid-turn leaves the queue and shows in its turn, marked sent mid-turn');
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
  if (freshId !== null) await zreq(s, 'session.kill', { sessionId: freshId }).catch(() => {});
  if (menusId !== null) await zreq(s, 'session.kill', { sessionId: menusId }).catch(() => {});
  if (imageId !== null) await zreq(s, 'session.kill', { sessionId: imageId }).catch(() => {});
  if (turnsId !== null) await zreq(s, 'session.kill', { sessionId: turnsId }).catch(() => {});
  s.close();
  killTree(s.child);
  stopDaemon();
  // M9 fix 722's folders: the fresh folder under the checkout, and the
  // project folder Claude Code made for it, only when it is the run's own.
  if (freshDir !== null) {
    await sleep(1000);
    try {
      fs.rmSync(freshDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch (err) {
      console.log(`[verify] note: left ${freshDir} (${err.message})`);
    }
    if (freshProject !== null && fs.existsSync(freshProject)) {
      if (path.basename(freshProject).toLowerCase().includes(path.basename(freshDir).slice('.chat-fresh-'.length))) {
        try {
          fs.rmSync(freshProject, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        } catch (err) {
          console.log(`[verify] note: left ${freshProject} (${err.message})`);
        }
      } else console.log(`[verify] note: left ${freshProject}`);
    }
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
