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
// the real block takes two queued messages back with Edit. Block
// `mod-feed` (fix 769) posts a spinner word and four rows to the sink as
// the mod does and reads them drawn before the fixture has them, then
// once each from the fixture's own lines. Block `tail` (fix 770) opens a
// stub over a transcript past the 8 MB read cap on its last 2 MB.
// Block `send` (fixes 781 to 784) plays Claude with a shell of its own:
// two quick sends, the pending bubble, the chips' ×, and the CLI input
// carried into the box and back. Block `review-base` (fix 790) plays
// Claude with a shell in a fixture repository whose edit is committed:
// the diff chip counts only the edit under the folder and opens the
// review on the session's start commit. Block
// `mod-ask` (fixes 774 and 775) starts a real Claude in default mode,
// Escapes a real permission dialog and answers a second one, a short
// real turn of its own.
// Run: npm run verify:chat -w @emerald/app [-- --only stub,ask]
import { execFileSync } from 'node:child_process';
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
  { name: 'real', fixes: ['690', '778'], needs: [] },
  { name: 'fresh', fixes: ['722'], needs: [] },
  { name: 'menus', fixes: ['719', '720', '746', '749', '750', '751', '755'], needs: [] },
  { name: 'image', fixes: ['721', '747', '748', '784'], needs: [] },
  { name: 'more', fixes: ['723'], needs: [] },
  { name: 'turns', fixes: ['752', '753'], needs: [] },
  { name: 'queued', fixes: ['754'], needs: ['turns'] },
  { name: 'mod-feed', fixes: ['769'], needs: [] },
  { name: 'tail', fixes: ['770'], needs: [] },
  { name: 'question', fixes: ['777'], needs: ['stub'] },
  { name: 'box', fixes: ['779', '780'], needs: [] },
  { name: 'send', fixes: ['781', '782', '783', '784'], needs: [] },
  { name: 'chips', fixes: ['785', '786'], needs: [] },
  { name: 'review-base', fixes: ['790'], needs: [] },
  { name: 'mod-ask', fixes: ['774', '775'], needs: [] },
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
// The chat opens on Normal from fix 714 on, which folds tool rows and hides thinking; a block that reads those picks Verbose first, Ctrl+O from the box until the view root's data-chat-view (fix 785) says so.
const toVerbose = async (paneId) => {
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
// of tool rows or thinking picks Verbose first. M9 fix 785: the view chip
// shows only once the turns hold a tool call or a thinking step, so the
// mode is read off the view root's data-chat-view, there from the first
// paint; the chip is clicked only to test its menu.
const VIEW_WORDS = { normal: 'Normal', thinking: 'Thinking', verbose: 'Verbose' };
const viewChip = (paneId) => paneSel(paneId) + ' .chat-chip[data-chip="view"]';
const viewRoot = (paneId) => paneSel(paneId) + ' .chat-view';
const viewWord = (paneId) => s.evalJs(`(() => { const v = ${q(viewRoot(paneId))}?.dataset.chatView; return v === undefined ? null : (${JSON.stringify(VIEW_WORDS)}[v] ?? v); })()`);
const waitView = async (paneId, word) => {
  try {
    await s.waitFor(`${q(viewRoot(paneId))}?.dataset.chatView === ${JSON.stringify(word.toLowerCase())}`, `the view reading ${word}`, 3000);
  } catch (err) {
    throw new Error(`${err.message}: got ${JSON.stringify(await viewWord(paneId))}`);
  }
};
const pickView = async (paneId, word) => {
  await s.waitFor(`!!${q(viewChip(paneId))}`, 'the view chip (fix 785: it shows once the turns hold a tool call or a thinking step)', 5000);
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
// M9 fixes 779 and 780: the box block's own stub.
let boxId = null;
let imageId = null;
// M9 fixes 752 to 754: the turns stub, which `queued` reuses.
let turnsId = null;
let turnsPane = null;
let postTurns = null;
// M9 fix 769: the feed stub, and fix 770's tail stub.
let feedId = null;
let tailId = null;
// M9 fixes 781 to 784: the send stub.
let sendId = null;
let sendPane = null;
// M9 fixes 785 and 786: the footer chips stub.
let chipsId = null;
// M9 fix 790: the review-base stub.
let reviewId790 = null;
// M9 fixes 774 and 775: the real Claude the mod-ask block asks with.
let askId = null;
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
    expect((await s.evalJs(`!!${q(paneSel(stubPane) + ' .pane-preview')}`)) === false, 'fix 771: no Preview chip on the chat face');
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
    expect((await s.evalJs(`!!${q(paneSel(stubPane) + ' .pane-preview')}`)) === false, 'fix 771: no Preview chip on the terminal face');
    step('fix 771: the pane title carries no Preview chip on either face');
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
    // no team; the fixture's one edit is +6 −2. M9 fix 790: the chip counts
    // only edits under the session's folder. Alone, the stub's hooks keep
    // its folder at C:/sim, where the fixture's edit is; after the ask
    // block the daemon reads Claude as gone and the shell's own prompt
    // names the folder, so the shell goes to C:\ (the edit is under it)
    // when its folder is not an ancestor of the edit.
    const under790 = (cwd) => {
      const dir = (cwd ?? '').replace(/\//g, '\\').toLowerCase();
      return 'c:\\sim\\session.ts'.startsWith(dir.endsWith('\\') ? dir : `${dir}\\`);
    };
    if (!under790((await record(stubId)).cwd)) {
      await typeRaw(stubId, "Set-Location -LiteralPath 'C:\\'\r");
      await waitRecord(stubId, (r) => under790(r.cwd), 'the shell at C:\\ for the diff read', 5000);
    }
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
    {
      // M9 fix 781: the box's first prompt goes to an idle Claude whose mod
      // is loaded, so it goes in through session.submit, which logs it.
      const daemonLog = path.join(emeraldHome, 'logs', 'emmerd.log');
      const log = fs.existsSync(daemonLog) ? fs.readFileSync(daemonLog, 'utf8') : '';
      expect(log.includes(`mod submit for ${realId.slice(0, 8)}`), `the box's first prompt went in through the mod (fix 781); emmerd.log has mod channel up: ${log.includes(`mod channel up for ${realId.slice(0, 8)}`)}`);
      step('fix 781: a prompt from the box to the idle real Claude went in through the mod');
    }
    const drawn =`(() => { const p = ${q(paneSel(pane.id))}; const tools = [...p.querySelectorAll('.chat-step[data-kind="tool"][data-tool="Bash"]')]; const bash = tools.find((t) => (t.querySelector('.chat-tool-arg')?.textContent ?? '').includes(${JSON.stringify(`echo chat-${marker}`)})); const replies = [...p.querySelectorAll('.chat-reply')]; return { prompt: [...p.querySelectorAll('.chat-prompt')].some((e) => e.textContent === ${JSON.stringify(prompt)}), tone: bash?.querySelector('.chat-dot')?.dataset.tone ?? null, result: bash?.querySelector('.chat-tool-result')?.textContent ?? null, reply: replies.at(-1)?.textContent.trim() ?? null }; })()`;
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
      // M9 fix 786: an account whose display name the list does not name
      // gets a Current model row first; it is dropped before the compare.
      const rows = await s.evalJs(`[...document.querySelectorAll('.menu.chat-model-menu .menu-item')].map((b) => ({ label: b.querySelector('.menu-label')?.textContent.replace(/^✓/, '') ?? '', line: b.querySelector('.menu-line')?.textContent ?? null }))`);
      const labels = rows.filter((r) => r.line !== 'Current model').map((r) => r.label);
      const want = ['Model', 'Default', 'Opus 5.5', 'Opus 5.5 (1M context)', 'Sonnet 5.5', 'Sonnet 5.5 (1M context)', 'Haiku 5.5', 'Fable 5.1', 'Fable 5.1 (1M context)', 'Opus Plan'];
      expect(JSON.stringify(labels) === JSON.stringify(want), `the real model menu's rows, got ${JSON.stringify(labels)}`);
      const segs = await s.evalJs(`[...document.querySelectorAll('.menu.chat-model-menu [data-segments="Effort"] .menu-segment')].map((b) => ({ word: b.textContent, active: b.dataset.active !== undefined }))`);
      expect(JSON.stringify(segs.map((x) => x.word)) === JSON.stringify(['low', 'medium', 'high', 'xhigh', 'max']), `the real effort row, got ${JSON.stringify(segs)}`);
      const checked = await realMenuChecked('.menu.chat-model-menu');
      console.log(`[verify] note: fix 744's real model menu ticks ${JSON.stringify(checked)} with ${JSON.stringify(segs.filter((x) => x.active).map((x) => x.word))} active, a Current model row ${JSON.stringify(rows.find((r) => r.line === 'Current model')?.label ?? null)} (the account's display name may name no row; logged, not judged)`);
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
      // The second send waits for the first's Enter (M9 fix 781's chain in sendPrompt); the wait for each bubble keeps the step's reads in order.
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
      // M9 fix 781: a prompt the mod submits to an idle session writes its
      // own enqueue and dequeue pair (read on 2.1.301), so only the queued
      // messages' enqueues are counted.
      expect(editRead.ops.filter((o) => o.startsWith('enqueue:queued-')).length === 2, `nothing sent back into the queue, got ${JSON.stringify(editRead.ops)}`);
      step('fix 754: Edit on a real queued message takes the queue back from Claude Code into the box, as one Up does in the terminal');

      await s.evalJs(`(() => { const b = ${q(boxSel)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(b, ''); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const replyBy = Date.now() + 90000;
      while (Date.now() < replyBy && eventsFor(realId).filter((e) => e.event === 'Stop').length <= stopsBefore) await sleep(250);
      expect(eventsFor(realId).filter((e) => e.event === 'Stop').length > stopsBefore, 'Stop logged for the queued turn');
      await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(P + ' .chat-reply')})].at(-1)?.textContent.trim() === ${JSON.stringify(marker + 'q')}`, 'the reply to the prompt alone', 10000);
      step(`fix 754: the turn ended on the prompt alone, the reply ${marker}q`);
    }

    // M9 fix 778: Stop on a working turn moves the interrupted prompt into
    // the box, the input empty, so the next message goes alone. Since fix
    // 781 this send goes in through the mod, so the prompt was never in
    // Claude Code's input and nothing comes back to it: the box takes the
    // turn's prompt once the carry's wait (CARRY_MS) finds the input empty.
    // A typed send's prompt comes back to the input and is carried out.
    {
      await sleep(1500);
      const P = paneSel(pane.id);
      const boxSel = P + ' .chat-box';
      // No tools, so no permission card can stand where Stop is clicked.
      const stopPrompt = `Count from 1 to 300, one number per line, slowly, without using any tools. Marker ${marker}s.`;
      await s.evalJs(`${q(boxSel)}.focus()`);
      await s.waitFor(`document.activeElement === ${q(boxSel)}`, 'the box holds the keyboard');
      await s.type(stopPrompt);
      await s.key('Enter', 'Enter', 13);
      await waitRecord(realId, (r) => r.state === 'working', 'the counting turn working', 15000);
      await s.waitFor(`!!${q(P + ' .chat-stop')}`, 'Stop while counting', 5000);
      // Claude Code 2.1.301 gives the prompt back only to a turn stopped
      // before any of its reply came (read here: a Stop four seconds in,
      // 194 numbers drawn, left the input empty), so Stop goes the moment
      // the view has the turn's prompt, which is what the carry expects.
      const promptShownAt = Date.now();
      await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(P + ' .chat-prompt')})].at(-1)?.textContent === ${JSON.stringify(stopPrompt)}`, 'the counting prompt in the view', 10000);
      console.log(`[verify] fix 778: the prompt drawn ${Date.now() - promptShownAt} ms after Stop showed`);
      const stoppedAt = Date.now();
      await s.evalJs(`${q(P + ' .chat-stop')}.click()`);
      // The input as carryRead reads it: the last ❯ row's text, a stock
      // placeholder or nothing reading as empty.
      const inputText = async () => {
        const rows = (await screen(realId)).rows;
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i].trimStart();
          if (!r.startsWith('❯')) continue;
          const t = r.slice(1).trim();
          return /^(Try ".*"|Press up to .*|Press Enter to edit .*|Message @.*)$/.test(t) ? '' : t;
        }
        return null;
      };
      // CARRY_MS (2 s) of waiting for the input first, then the box.
      let read = null;
      while (Date.now() - stoppedAt < 5000) {
        read = { box: await s.evalJs(`${q(boxSel)}.value`), input: await inputText() };
        if (read.box === stopPrompt && read.input === '') break;
        await sleep(200);
      }
      console.log(`[verify] fix 778: ${Date.now() - stoppedAt} ms after Stop, ${JSON.stringify(read)}`);
      if (read.box !== stopPrompt || read.input !== '') {
        const rows = (await screen(realId)).rows.filter((r) => r.trim() !== '').slice(-6);
        console.log(`[verify] fix 778: the screen's last rows ${JSON.stringify(rows)}`);
      }
      expect(read.box === stopPrompt, `the interrupted prompt in the box, got ${JSON.stringify(read)}`);
      expect(read.input === '', `the terminal's input emptied, got ${JSON.stringify(read)}`);
      step('fix 778: Stop on a working turn moves the interrupted prompt into the box and empties the terminal\'s input');
      const leftBy = Date.now() + 15000;
      while (Date.now() < leftBy && (await record(realId)).state === 'working') await sleep(250);
      console.log(`[verify] fix 778: the record after the Stop reads ${(await record(realId)).state}`);
      await s.evalJs(`(() => { const b = ${q(boxSel)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(b, ''); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      const stopsBefore = eventsFor(realId).filter((e) => e.event === 'Stop').length;
      const next = `Reply with exactly the word ${marker}t and nothing else.`;
      await s.evalJs(`${q(boxSel)}.focus()`);
      await s.waitFor(`document.activeElement === ${q(boxSel)}`, 'the box holds the keyboard');
      await s.type(next);
      await s.key('Enter', 'Enter', 13);
      const replyBy = Date.now() + 90000;
      while (Date.now() < replyBy && eventsFor(realId).filter((e) => e.event === 'Stop').length <= stopsBefore) await sleep(250);
      expect(eventsFor(realId).filter((e) => e.event === 'Stop').length > stopsBefore, 'Stop logged for the next turn');
      const last = (await record(realId)).lastPrompt;
      expect(last === next, `the next message went alone, lastPrompt ${JSON.stringify(last)}`);
      step(`fix 778: the next message after the Stop went alone, the record's last prompt is it`);
    }

    await sleep(1500);
    // M9 fix 779: the real screen's ghost, logged and never judged; a
    // suggestion here is a real fixture for the parser's test.
    const realScreen = await screen(realId);
    console.log(`[verify] note: fix 779: the real screen's ghost ${JSON.stringify(realScreen.ghost === undefined ? 'absent' : realScreen.ghost)} on prompt row ${JSON.stringify(realScreen.rows.filter((r) => r.trimStart().startsWith('❯')).at(-1) ?? null)}`);
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

    // (a) A `/` in the empty box: the two sections, the five built-ins
    // first, then the rest of the table's (M9 fix 780), the seeded skill
    // once the reply lands, and the terminal's commands.
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
    // M9 fix 780: fix 749's thirteen, then the rest of Claude Code 2.1.301's
    // terminal forms in name order.
    const TERMINAL = [
      '/model', '/permissions', '/mcp', '/config', '/usage', '/hooks', '/memory', '/resume', '/theme', '/login', '/status', '/doctor', '/btw',
      '/autocompact', '/background', '/branch', '/bug', '/context', '/copy', '/daemon', '/effort', '/exit', '/export', '/feedback', '/focus', '/goal', '/help', '/ide',
      '/install-github-app', '/logout', '/mobile', '/plan', '/plugin', '/powerup', '/release-notes', '/rewind', '/skill-doctor', '/skills', '/tasks', '/terminal-setup', '/tui',
    ];
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
      // M9 fix 783: the × waits a settle time after a turn ends, so a click
      // never lands on a disabled button after a slow Stop.
      await s.waitFor(`${q(clearSel)}.disabled === false`, `the × enabled (${what})`, 5000).catch(() => {});
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

    // M9 fix 784, decision 4: what a wrapped input and a Ctrl+J input look
    // like on the real 2.1.301 screen, from the prompt row to the composer's
    // lower rule, and what the carry makes of each on the flip to chat. The
    // carry (fix 778's carryRead) takes an input past one row as blocked.
    const composerRows = async () => {
      const rows = (await screen(imageId)).rows;
      let from = -1;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (/^\s*❯/.test(rows[i])) {
          from = i;
          break;
        }
      }
      if (from < 0) return [];
      const out = [];
      for (let i = from; i < rows.length; i++) {
        if (i > from && /^─+$/.test(rows[i].trim())) break;
        out.push(rows[i]);
      }
      return out;
    };
    const hintNow = () => s.evalJs(`${q(paneSel(imagePane) + ' .chat-hint')}?.textContent ?? null`);
    for (const [name, typed, mark] of [
      ['a 200-character input', 'x'.repeat(200), 'xxxxxxxxxx'],
      ['line one, Ctrl+J, line two', 'line one\nline two', 'line one'],
    ]) {
      await typeRaw(imageId, typed);
      await waitPrompt((row) => row.includes(mark) || row.includes('[Pasted text'), `Claude's input holds ${name}`);
      console.log(`[verify] fix 784: the rows of ${name}: ${JSON.stringify(await composerRows())}`);
      await toChat();
      await sleep(1500);
      const carried = { box: await s.evalJs(`${q(boxSel)}.value`), hint: await hintNow(), input: await promptRow() };
      console.log(`[verify] fix 784: ${name} on the flip to chat: ${JSON.stringify(carried)}`);
      expect(carried.box === '' && carried.hint === "Claude's input holds text the chat box cannot take; Show the terminal to send or clear it", `${name} stays in the terminal with the hint (decision 4 (b)), got ${JSON.stringify(carried)}`);
      // Back to the terminal (the box is empty, so nothing is typed) and
      // clear the input with one Ctrl+C, two seconds past the last.
      await toggle();
      await s.waitFor(`${q(paneSel(imagePane))}.dataset.face === undefined`, 'the terminal face to clear the input');
      await sleep(2000);
      await typeRaw(imageId, '\x03');
      await waitPrompt((row) => !row.includes(mark) && !row.includes('[Pasted text'), `Ctrl+C cleared ${name}`);
    }
    step('fix 784: an input past one row on a real Claude stays in the terminal on the flip, with the hint');
    await toChat();

    // (h) /exit, which the / menu's row sends, ends the session.
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

  await block('mod-feed', async () => {
    // M9 fix 769: a shell playing Claude whose "mod" posts Spinner and
    // Append to the sink: the live line takes the posted word, the posted
    // rows draw before the fixture has them, and once the fixture's own
    // lines land each row is drawn once, from the file.
    const feedDir = path.join(emeraldHome, 'chat-769');
    fs.mkdirSync(feedDir, { recursive: true });
    const feedFixture = path.join(feedDir, 'fixture.jsonl');
    fs.writeFileSync(feedFixture, [userLine('feed me', 0), asstLine([{ type: 'text', text: 'From the file.' }], 1)].join('\n') + '\n');
    const spawned = await zreq(s, 'session.spawn', { kind: 'shell', cwd: feedDir, cols: 120, rows: 30 });
    feedId = spawned.session.id;
    const lay = await getLayout(s);
    const feedPane = leaves(lay)[0].id;
    const rec = (n) => (n.kind === 'pane' ? (n.id === feedPane ? { ...n, sessionId: feedId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root), focusedPaneId: feedPane } });
    await s.waitFor(`!!${q(paneSel(feedPane) + ' .term-host')}`, 'the feed stub in the first pane', 10000);
    const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
    const postFeed = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': feedId },
        body: JSON.stringify({ session_id: 'sim-chat-769', cwd: feedDir, transcript_path: feedFixture, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postFeed({ hook_event_name: 'SessionStart', source: 'startup' });
    await postFeed({ hook_event_name: 'UserPromptSubmit', prompt: 'feed me' });
    await postFeed({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(feedId, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the feed stub bound with its transcript', 10000);
    await s.waitFor(`!!${q(paneSel(feedPane) + ' .pane-face-toggle')}`, 'the face button on the feed stub', 10000);
    await toChat(feedPane);
    // Ctrl+O, not the view chip: the fixture holds no tool call or thinking
    // step yet, so fix 785 shows no chip.
    await toVerbose(feedPane);
    const FP = paneSel(feedPane);
    await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(FP + ' .chat-reply')})].some((r) => r.textContent.trim() === 'From the file.')`, 'the fixture turn drawn', 10000);

    // (b) The live line's word is the one the mod posted.
    await postFeed({ hook_event_name: 'UserPromptSubmit', prompt: 'read the notes' });
    await postFeed({ hook_event_name: 'Spinner', word: 'Feeding' });
    try {
      await s.waitFor(`${q(FP + ' .chat-live-word')}?.textContent === 'Feeding'`, 'the live word Feeding', 3000);
    } catch (err) {
      throw new Error(`${err.message}: got ${JSON.stringify(await s.evalJs(`${q(FP + ' .chat-live-word')}?.textContent ?? null`))}`);
    }
    step("fix 769: the chat view's live line takes the word the mod posted");

    // (c) Four rows posted, the fixture untouched: drawn within 2 s.
    const rows = [
      { uuid: 'u769-p', row: { type: 'user', role: 'user', content: [{ type: 'text', text: 'read the notes' }] } },
      { uuid: 'u769-t', row: { type: 'assistant', role: 'assistant', content: [useOf('r769', 'Read', { file_path: 'C:/sim/notes.md' })] } },
      { uuid: 'u769-r', row: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r769', content: 'one\ntwo' }] } },
      { uuid: 'u769-a', row: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Read them from the mod.' }] } },
    ];
    for (const r of rows) await postFeed({ hook_event_name: 'Append', door: 'response', ...r });
    const fedRead = (t) => t !== null && t.prompts.length === 2 && t.prompts[1].trim() === 'read the notes' && t.tools.filter((x) => x.tool === 'Read').length === 1 && t.replies.some((x) => x.trim() === 'Read them from the mod.');
    const until = Date.now() + 2000;
    let fed = await timeline(feedPane);
    while (!fedRead(fed) && Date.now() < until) {
      await sleep(100);
      fed = await timeline(feedPane);
    }
    expect(fedRead(fed), `the posted rows drawn within 2 s with the fixture untouched, got ${JSON.stringify(fed)}`);
    const liveResult = fed.tools.find((x) => x.tool === 'Read').result;
    expect(liveResult !== '2 lines', `the posted result carries no line count yet, got ${JSON.stringify(liveResult)}`);
    step('fix 769: the rows the mod posts draw before the transcript has them');

    // (d) The fixture's own lines land: each row drawn once, from the file.
    fs.appendFileSync(
      feedFixture,
      [
        userLine('read the notes', 10, { uuid: 'u769-p' }),
        asstLine([useOf('r769', 'Read', { file_path: 'C:/sim/notes.md' })], 11, { uuid: 'u769-t' }),
        resultOf('r769', 'one\ntwo', 12, { uuid: 'u769-r', toolUseResult: { file: { numLines: 2 } } }),
        asstLine([{ type: 'text', text: 'Read them from the mod.' }], 13, { uuid: 'u769-a' }),
      ].join('\n') + '\n',
    );
    const filedRead = (t) => t !== null && t.prompts.length === 2 && t.tools.filter((x) => x.tool === 'Read').length === 1 && t.tools.find((x) => x.tool === 'Read').result.startsWith('2 lines') && t.replies.filter((x) => x.trim() === 'Read them from the mod.').length === 1;
    const until2 = Date.now() + 5000;
    let filed = await timeline(feedPane);
    while (!filedRead(filed) && Date.now() < until2) {
      await sleep(150);
      filed = await timeline(feedPane);
    }
    expect(filedRead(filed), `the transcript's lines took the rows' places, one of each, got ${JSON.stringify(filed)}`);
    await postFeed({ hook_event_name: 'Stop', stop_hook_active: false });
    step("fix 769: once the transcript's lines land each row is drawn once, from the file");
  });

  await block('tail', async () => {
    // M9 fix 770: a stub over a transcript past the 8 MB read cap opens on
    // its last 2 MB under the note, takes what the file grows by, and the
    // note's button turns the pane to its terminal.
    const tailDir = path.join(emeraldHome, 'chat-770');
    fs.mkdirSync(tailDir, { recursive: true });
    const tailFixture = path.join(tailDir, 'fixture.jsonl');
    const lines = [];
    for (let k = 0; k < 450; k++) {
      lines.push(userLine(`big turn ${k}`, k * 10), asstLine([useOf(`t${k}`, 'Bash', { command: `echo ${k}` })], k * 10 + 1), resultOf(`t${k}`, 'y'.repeat(20000), k * 10 + 2), asstLine([{ type: 'text', text: `Big reply ${k}.` }], k * 10 + 3));
    }
    fs.writeFileSync(tailFixture, lines.join('\n') + '\n');
    const bytes = fs.statSync(tailFixture).size;
    expect(bytes > 8 * 1024 * 1024, `the fixture is past the 8 MB read cap, got ${bytes} bytes`);
    const spawned = await zreq(s, 'session.spawn', { kind: 'shell', cwd: tailDir, cols: 120, rows: 30 });
    tailId = spawned.session.id;
    const lay = await getLayout(s);
    const tailPane = leaves(lay)[0].id;
    const rec = (n) => (n.kind === 'pane' ? (n.id === tailPane ? { ...n, sessionId: tailId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root), focusedPaneId: tailPane } });
    await s.waitFor(`!!${q(paneSel(tailPane) + ' .term-host')}`, 'the tail stub in the first pane', 10000);
    const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
    const postTail = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': tailId },
        body: JSON.stringify({ session_id: 'sim-chat-770', cwd: tailDir, transcript_path: tailFixture, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postTail({ hook_event_name: 'SessionStart', source: 'startup' });
    await postTail({ hook_event_name: 'UserPromptSubmit', prompt: 'big turn 449' });
    await postTail({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(tailId, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the tail stub bound with its transcript', 10000);
    await s.waitFor(`!!${q(paneSel(tailPane) + ' .pane-face-toggle')}`, 'the face button on the tail stub', 10000);
    await toChat(tailPane);
    const TP = paneSel(tailPane);
    const read = () =>
      s.evalJs(`(() => {
        const p = ${q(TP)};
        const prompts = [...p.querySelectorAll('.chat-prompt')].map((e) => e.textContent.trim());
        const note = p.querySelector('.chat-earlier');
        return { note: note?.textContent ?? null, button: !!note?.querySelector('button'), prompts: prompts.length, first: prompts[0] ?? null, last: prompts[prompts.length - 1] ?? null, replies: [...p.querySelectorAll('.chat-reply')].map((e) => e.textContent.trim()).slice(-2) };
      })()`);
    // (b) The last 2 MB under the note, about a hundred turns of 20 KB.
    try {
      await s.waitFor(`!!${q(TP + ' .chat-earlier')} && [...document.querySelectorAll(${JSON.stringify(TP + ' .chat-reply')})].some((r) => r.textContent.trim() === 'Big reply 449.')`, 'the tail drawn under the note', 10000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify(await read())}`);
    }
    const opened = await read();
    console.log(`[verify] fix 770 first read: ${JSON.stringify(opened)}`);
    expect(opened.note !== null && opened.note.startsWith('Earlier turns are in the terminal') && opened.button, `the note with its button, got ${JSON.stringify(opened)}`);
    expect(opened.first !== 'big turn 0' && opened.prompts > 50 && opened.prompts < 150, `the tail's turns alone, between 50 and 150 prompts and not the first, got ${JSON.stringify(opened)}`);
    step(`fix 770: a transcript of ${(bytes / 1024 / 1024).toFixed(1)} MB opens on its last ${opened.prompts} turns under the note Earlier turns are in the terminal`);

    // (c) What the file grows by is drawn; the head stays where it was.
    fs.appendFileSync(tailFixture, [userLine('tail grew', 5000), asstLine([{ type: 'text', text: 'Tail grew.' }], 5001)].join('\n') + '\n');
    await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(TP + ' .chat-reply')})].some((r) => r.textContent.trim() === 'Tail grew.')`, 'the grown turn drawn', 5000);
    const grown = await read();
    expect(grown.note !== null && grown.first === opened.first && grown.last === 'tail grew', `the grown turn drawn under the same note and first turn, got ${JSON.stringify(grown)}`);
    step('fix 770: a turn appended to the long transcript is drawn, the note and the first drawn turn kept');

    // (d) The note's button shows the terminal.
    await s.evalJs(`${q(TP + ' .chat-earlier button')}.click()`);
    await s.waitFor(`${q(TP)}.dataset.face === undefined`, 'the pane on its terminal face', 5000);
    step("fix 770: the note's Show the terminal turns the pane to its terminal");
  });

  await block('question', async () => {
    // M9 fix 777: an AskUserQuestion drawn as the terminal draws it. The
    // blocks before leave the first pane on another session when run
    // whole, so the stub is put back in it first.
    const lay = await getLayout(s);
    const rec = (n) => (n.kind === 'pane' ? (n.id === stubPane ? { ...n, sessionId: stubId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root), focusedPaneId: stubPane } });
    await s.waitFor(`!!${q(paneSel(stubPane) + ' .pane-face-toggle')}`, 'the stub back in the first pane', 10000);
    await toChat(stubPane);
    fs.appendFileSync(fixture, [userLine('ask me about the button', 2000), asstLine([useOf('q777', 'AskUserQuestion', { questions: [] })], 2001)].join('\n') + '\n');
    // The posts a real AskUserQuestion makes, in the order the capture's
    // hook log has them (ToolAsk is the mod's alone and the stub has none).
    await post({ hook_event_name: 'UserPromptSubmit', prompt: 'ask me about the button' });
    await post({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
    await waitRecord(stubId, (r) => r.state === 'working', 'the stub working', 5000);
    // Capture 3's shape, each glyph built from its code so the console's
    // code page never meets it.
    const c = (code) => `[char]0x${code}`;
    const tabRow = `('' + ${c('2190')} + ' ' + ${c('2612')} + ' Colour ' + ${c('2610')} + ' Size ' + ${c('2610')} + ' Shape ' + ${c('2713')} + ' Submit ' + ${c('2192')})`;
    const footer = `('Enter to select ' + ${c('00B7')} + ' Tab/Arrow keys to navigate ' + ${c('00B7')} + ' Esc to cancel')`;
    const rows = ['', 'Which size should the sample button be?', '', '  1. Small', '     Fits a dense toolbar', '> 2. Medium (Recommended)', '     Matches the other buttons', '  3. Large', '     Easy to hit on a touch screen', '  4. Type something.', '', '  5. Chat about this', ''];
    await typeRaw(stubId, `cls; Write-Host ''; Write-Host ${tabRow}; ${rows.map((r) => `Write-Host '${r}'`).join('; ')}; Write-Host -NoNewline ${footer}; Read-Host | Out-Null\r`);
    await waitCursorRow(stubId, (row) => row.trim().endsWith('cancel'), 'the question drawn, the cursor on its footer');
    const drawn = (await screen(stubId)).rows.find((r) => r.includes('Colour')) ?? null;
    console.log(`[verify] the tab row reads ${JSON.stringify(drawn)}`);
    await post({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: [] } });
    await post({ hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use AskUserQuestion' });
    const cardSel = paneSel(stubPane) + ' .chat-step[data-kind="ask"]';
    await s.waitFor(`!!${q(cardSel + ' .chat-ask-option[data-key="5"]')}`, 'the ask card with its five options', 10000);
    const card = await s.evalJs(`(() => { const c = ${q(cardSel)}; const two = c.querySelector('.chat-ask-option[data-key="2"]'); return { heading: c.querySelector('.chat-ask-heading')?.textContent ?? null, question: c.querySelector('.chat-ask-question')?.textContent ?? null, tabs: [...c.querySelectorAll('.chat-ask-tab')].map((t) => ({ name: t.textContent.replace(/^✓/, ''), state: t.dataset.state, current: t.dataset.current ?? null })), screen: !!c.querySelector('.chat-ask-screen'), keys: [...c.querySelectorAll('.chat-ask-option')].map((b) => b.dataset.key), label: two?.querySelector('.chat-ask-label')?.textContent ?? null, desc: two?.querySelector('.chat-ask-desc')?.textContent ?? null, pointer: two?.dataset.pointer ?? null, input: !!c.querySelector('.chat-ask-input') }; })()`);
    expect(card.heading === 'Claude has a question', `the heading, got ${card.heading}`);
    expect(card.question === 'Which size should the sample button be?', `the question, got ${JSON.stringify(card.question)}`);
    expect(card.tabs.map((t) => t.name).join(',') === 'Colour,Size,Shape', `the tabs' names, got ${JSON.stringify(card.tabs)}`);
    expect(card.tabs.map((t) => t.state).join(',') === 'answered,open,open', `the tabs' states, got ${JSON.stringify(card.tabs)}`);
    expect(card.tabs.map((t) => t.current).join(',') === ',true,', `Size alone current, got ${JSON.stringify(card.tabs)}`);
    expect(!card.screen, 'no screen excerpt for a question the card draws');
    expect(card.keys.join(',') === '1,2,3,4,5,esc', `five options and Esc, got ${JSON.stringify(card.keys)}`);
    expect(card.label === 'Medium (Recommended)' && card.desc === 'Matches the other buttons' && card.pointer === 'true', `option 2 with its description and the pointer, got ${JSON.stringify(card)}`);
    expect(!card.input, 'no answer box for a question the card draws');
    await s.screenshot('m9-chat-question.png');
    step('fix 777: the ask card draws an AskUserQuestion, its tabs, its question and each option\'s description');
    await s.waitFor(`document.activeElement === ${q(cardSel)}`, 'the card holds the keyboard');
    await s.key('2', 'Digit2', 50);
    await waitCursorRow(stubId, (row) => row.trim().endsWith('cancel2'), 'the 2 key reached the session');
    await typeRaw(stubId, '\r');
    await waitRecord(stubId, (r) => r.command?.state !== 'running', 'the Read-Host ended at the prompt', 10000);
    await post({ hook_event_name: 'Stop', stop_hook_active: false });
    await s.waitFor(`!${q(cardSel)} && ${q(paneSel(stubPane) + ' .chat-box')}?.disabled === false`, 'the card gone and the box back');
    step('fix 777: the 2 key answers the question card, and the turn ending takes it away');
  });

  await block('box', async () => {
    // M9 fix 779: a shell playing Claude draws Claude Code's suggested
    // prompt row with Write-Host (the first character inverse, the rest
    // dim, as Claude Code's placeholder renderer draws it) and waits at a
    // Read-Host; the box shows the suggestion ghosted and Tab takes it.
    // Its own stub, put in the first leaf of whatever the blocks before
    // left, as menus does.
    const boxDir = path.join(emeraldHome, 'chat-779');
    fs.mkdirSync(boxDir, { recursive: true });
    const boxFixture = path.join(boxDir, 'fixture.jsonl');
    fs.writeFileSync(boxFixture, [userLine('suggest', 0), asstLine([{ type: 'text', text: 'Suggested.' }], 2)].join('\n') + '\n');
    const spawned = await zreq(s, 'session.spawn', { kind: 'shell', cwd: boxDir, cols: 120, rows: 30 });
    boxId = spawned.session.id;
    const lay = await getLayout(s);
    const boxPane = leaves(lay)[0].id;
    const rec = (n) => (n.kind === 'pane' ? (n.id === boxPane ? { ...n, sessionId: boxId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root), focusedPaneId: boxPane } });
    await s.waitFor(`!!${q(paneSel(boxPane) + ' .term-host')}`, 'the box stub in the first pane', 10000);
    const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
    const postBox = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': boxId },
        body: JSON.stringify({ session_id: 'sim-chat-779', cwd: boxDir, transcript_path: boxFixture, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postBox({ hook_event_name: 'SessionStart', source: 'startup' });
    await postBox({ hook_event_name: 'UserPromptSubmit', prompt: 'suggest' });
    await postBox({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(boxId, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the box stub bound with its transcript', 10000);
    const boxSel = paneSel(boxPane) + ' .chat-box';
    const toBox = async () => {
      await s.waitFor(`!!${q(paneSel(boxPane) + ' .pane-face-toggle')}`, 'the face button on the box stub', 10000);
      await toChat(boxPane);
      await s.waitFor(`!!${q(boxSel)}`, 'the box on the chat face');
      await s.evalJs(`${q(boxSel)}.focus()`);
      await s.waitFor(`document.activeElement === ${q(boxSel)}`, 'the box holds the keyboard');
    };
    const setBoxText = (text) =>
      s.evalJs(`(() => { const b = ${q(boxSel)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(b, ${JSON.stringify(text)}); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const boxState = () => s.evalJs(`(() => { const b = ${q(boxSel)}; return { value: b.value, placeholder: b.placeholder, ghost: b.hasAttribute('data-ghost') }; })()`);
    const rowsWith = async (text) => (await screen(boxId)).rows.filter((r) => r.includes(text));
    const waitRows = async (pred, what, ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until && !pred((await screen(boxId)).rows)) await sleep(200);
      const rows = (await screen(boxId)).rows;
      expect(pred(rows), `${what}, got ${JSON.stringify(rows)}`);
    };
    // The command ending at the shell's prompt reads as Claude leaving
    // (the ask block's note); a Stop binds the stub again.
    const rebind = async (what) => {
      await waitRecord(boxId, (r) => r.command?.state !== 'running', what, 10000);
      await postBox({ hook_event_name: 'Stop', stop_hook_active: false });
      await sleep(300);
      await toBox();
    };
    const DRAW = "cls; Write-Host ([char]0x276F + ' ' + [char]27 + '[7mR' + [char]27 + '[27m' + [char]27 + '[2mun the tests' + [char]27 + '[22m'); $a = Read-Host; cls; Write-Host ('got ' + $a)\r";
    await toBox();

    // (a) The suggestion drawn on the prompt row shows in the empty box.
    await typeRaw(boxId, DRAW);
    try {
      await s.waitFor(`${q(boxSel)}.hasAttribute('data-ghost') && ${q(boxSel)}.placeholder === 'Run the tests'`, 'the suggestion ghosted in the box', 5000);
    } catch (err) {
      const r = await record(boxId);
      throw new Error(`${err.message}: box ${JSON.stringify(await boxState())}, state ${r?.state}, command ${JSON.stringify(r?.command)}, face ${await s.evalJs(`${q(paneSel(boxPane))}.dataset.face ?? null`)}, shaded ${await s.evalJs(`${q(paneSel(boxPane))}.dataset.shaded ?? null`)}, renderer's read ${await s.evalJs(`window.emerald.request('pty.screen', { sessionId: ${JSON.stringify(boxId)} }).then((r) => JSON.stringify(r.ghost ?? 'absent'))`)}, screen ${JSON.stringify(await screen(boxId))}`);
    }
    step('fix 779 (a): the suggested prompt on Claude\'s prompt row shows ghosted in the empty chat box');

    // (b) Tab takes it into the box and types nothing into the session.
    await s.key('Tab', 'Tab', 9);
    await s.waitFor(`${q(boxSel)}.value === 'Run the tests' && !${q(boxSel)}.hasAttribute('data-ghost')`, 'Tab took the suggestion', 3000);
    await sleep(300);
    expect((await rowsWith('Run the tests')).length === 1, `nothing typed at the Read-Host, got ${JSON.stringify((await screen(boxId)).rows)}`);
    step('fix 779 (b): Tab puts the suggestion in the box, the ghost goes, and nothing reaches the session');

    // (c) The taken suggestion is edited and sent; the placeholder is back.
    await s.type(' now');
    await s.key('Enter', 'Enter', 13);
    await waitRows((rows) => rows.some((r) => r.includes('got Run the tests now')), 'the stub got the edited suggestion', 10000);
    await s.waitFor(`${q(boxSel)}.placeholder.startsWith('Message ') && !${q(boxSel)}.hasAttribute('data-ghost')`, 'the placeholder back', 3000);
    step('fix 779 (c): the suggestion, edited, is sent as a prompt, and the placeholder comes back');
    await rebind('the Read-Host ended at the prompt');

    // (d) The ghost shows only while the box is empty, and Enter on the
    // empty box sends nothing, as Claude Code's own Enter.
    await typeRaw(boxId, DRAW);
    await s.waitFor(`${q(boxSel)}.hasAttribute('data-ghost')`, 'the suggestion ghosted again', 5000);
    await setBoxText('x');
    await s.waitFor(`!${q(boxSel)}.hasAttribute('data-ghost')`, 'no ghost while the box holds text', 3000);
    await setBoxText('');
    await s.waitFor(`${q(boxSel)}.hasAttribute('data-ghost') && ${q(boxSel)}.placeholder === 'Run the tests'`, 'the ghost back in the emptied box', 3000);
    await s.key('Enter', 'Enter', 13);
    await sleep(1500);
    expect((await rowsWith('got')).length === 0, `Enter on the empty box sent nothing, got ${JSON.stringify((await screen(boxId)).rows)}`);
    step('fix 779 (d): no ghost while the box holds text, back when emptied, and Enter on the empty box sends nothing');
    await typeRaw(boxId, '\r');
    await waitRows((rows) => rows.some((r) => r.startsWith('got')), 'the Read-Host ended', 10000);
    await rebind('the second Read-Host ended at the prompt');

    // M9 fix 780: the / menu lists every built-in that runs at the prompt.
    // (e) /rename is a sent row with its hint, and Enter sends it bare
    // with no bar, since it opens nothing.
    const activeRow = () => s.evalJs(`(() => { const r = document.querySelector('.chat-menu .chat-menu-row[data-active="true"]'); return r === null ? null : { name: r.dataset.name ?? null, hint: r.dataset.hint ?? null, section: r.dataset.section ?? null, shownHint: r.querySelector('.chat-menu-hint')?.textContent ?? null }; })()`);
    const fallbackShown = () => s.evalJs(`!!${q(paneSel(boxPane) + ' .chat-fallback')}`);
    await s.type('/ren');
    try {
      await s.waitFor(`document.querySelector('.chat-menu .chat-menu-row[data-active="true"]')?.dataset.name === '/rename'`, 'the menu on /rename', 5000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify(await activeRow())}`);
    }
    const ren = await activeRow();
    expect(ren.hint === '[name]' && ren.shownHint === '[name]' && ren.section === 'sent', `the /rename row with its hint, got ${JSON.stringify(ren)}`);
    await s.key('Enter', 'Enter', 13);
    await waitRows((rows) => rows.some((r) => r.includes('/rename')), 'the stub got /rename', 10000);
    await sleep(1500);
    expect(!(await fallbackShown()), 'no fallback bar after /rename');
    step('fix 780 (e): /ren lists /rename with its [name] hint, and Enter sends it with no bar');
    await rebind('the stub back at its prompt after /rename');

    // (f) /add-dir needs its path: Enter completes it and sends nothing;
    // the completed box, a path typed, sends and brings the bar.
    await s.type('/add');
    try {
      await s.waitFor(`document.querySelector('.chat-menu .chat-menu-row[data-active="true"]')?.dataset.name === '/add-dir'`, 'the menu on /add-dir', 5000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify(await activeRow())}`);
    }
    expect((await activeRow()).hint === '<path>', `the /add-dir row's hint, got ${JSON.stringify(await activeRow())}`);
    await s.key('Enter', 'Enter', 13);
    await s.waitFor(`${q(boxSel)}.value === '/add-dir ' && !document.querySelector('.chat-menu')`, 'Enter completed /add-dir and closed the menu', 3000);
    await sleep(500);
    expect((await rowsWith('/add-dir')).length === 0, `nothing sent on the completion, got ${JSON.stringify((await screen(boxId)).rows)}`);
    await s.type('src');
    await s.key('Enter', 'Enter', 13);
    await waitRows((rows) => rows.some((r) => r.includes('/add-dir src')), 'the stub got /add-dir src', 10000);
    await s.waitFor(`!!${q(paneSel(boxPane) + ' .chat-fallback')}`, 'the fallback bar after /add-dir src', 5000);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!${q(paneSel(boxPane) + ' .chat-fallback')}`, 'the fallback bar gone on Escape', 2000);
    step('fix 780 (f): /add-dir completes on Enter with its <path> hint, and the completed send brings the bar');
    await rebind('the stub back at its prompt after /add-dir');

    // (g) A model named after /model skips its dialog: no bar.
    await s.type('/model sonnet');
    await s.key('Enter', 'Enter', 13);
    await waitRows((rows) => rows.some((r) => r.includes('/model sonnet')), 'the stub got /model sonnet', 10000);
    await sleep(1500);
    expect(!(await fallbackShown()), 'no fallback bar after /model sonnet');
    step('fix 780 (g): /model with a model named sends with no fallback bar');
    await rebind('the stub back at its prompt after /model sonnet');
  });

  await block('send', async () => {
    // M9 fixes 781 to 784: a shell playing Claude in a folder of its own,
    // in the first pane on the chat face, for the box's sends.
    const sendDir = path.join(emeraldHome, 'chat-781');
    fs.mkdirSync(sendDir, { recursive: true });
    const sendFixture = path.join(sendDir, 'fixture.jsonl');
    fs.writeFileSync(sendFixture, [userLine('send me', 0), asstLine([{ type: 'text', text: 'Ready to send.' }], 1)].join('\n') + '\n');
    const spawned = await zreq(s, 'session.spawn', { kind: 'shell', cwd: sendDir, cols: 120, rows: 30 });
    sendId = spawned.session.id;
    const lay = await getLayout(s);
    sendPane = leaves(lay)[0].id;
    const rec = (n) => (n.kind === 'pane' ? (n.id === sendPane ? { ...n, sessionId: sendId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root), focusedPaneId: sendPane } });
    await s.waitFor(`!!${q(paneSel(sendPane) + ' .term-host')}`, 'the send stub in the first pane', 10000);
    const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
    const postSend = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sendId },
        body: JSON.stringify({ session_id: 'sim-chat-781', cwd: sendDir, transcript_path: sendFixture, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postSend({ hook_event_name: 'SessionStart', source: 'startup' });
    await postSend({ hook_event_name: 'UserPromptSubmit', prompt: 'send me' });
    await postSend({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(sendId, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the send stub bound with its transcript', 10000);
    await s.waitFor(`!!${q(paneSel(sendPane) + ' .pane-face-toggle')}`, 'the face button on the send stub', 10000);
    await toChat(sendPane);
    const SP = paneSel(sendPane);
    const boxSel = SP + ' .chat-box';
    await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(SP + ' .chat-reply')})].some((r) => r.textContent.trim() === 'Ready to send.')`, 'the send stub drawn', 10000);
    const typeInBox = async (text) => {
      await s.evalJs(`${q(boxSel)}.focus()`);
      await s.waitFor(`document.activeElement === ${q(boxSel)}`, 'the box holds the keyboard', 3000);
      await s.type(text);
    };
    const rowsNow = async () => (await screen(sendId)).rows.map((r) => r.trim());

    // Fix 781: two sends 200 ms apart. Typed with no chain, the second's
    // text landed inside the first's Enter pause and PowerShell ran one
    // line, `echo one781echo two781`.
    await typeInBox('echo one781');
    await s.key('Enter', 'Enter', 13);
    await sleep(200);
    await typeInBox('echo two781');
    await s.key('Enter', 'Enter', 13);
    const twoBy = Date.now() + 10000;
    let rows = await rowsNow();
    while (Date.now() < twoBy && !(rows.includes('one781') && rows.includes('two781'))) {
      await sleep(250);
      rows = await rowsNow();
    }
    expect(rows.includes('one781') && rows.includes('two781') && !rows.some((r) => r.includes('one781echo')), `two lines, one781 and two781, got ${JSON.stringify(rows.filter((r) => r !== '').slice(-8))}`);
    step('fix 781: two sends 200 ms apart from the box reach the session as two lines');
    // Their prompt lines, so fix 782's bubbles for them give way.
    fs.appendFileSync(sendFixture, [userLine('echo one781', 10), userLine('echo two781', 11)].join('\n') + '\n');
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(SP + ' .chat-prompt-pending')}).length === 0`, 'no pending bubble after the 781 lines', 5000);

    // Fix 782 (a): a send shows at once as Sending and gives way to its
    // prompt line with no frame holding both.
    const pendingOf = (text) => `[...document.querySelectorAll(${JSON.stringify(SP + ' .chat-prompt-pending')})].find((e) => e.querySelector('.chat-prompt-pending-text')?.textContent === ${JSON.stringify(text)})`;
    const promptsOf = (text) => `[...document.querySelectorAll(${JSON.stringify(SP + ' .chat-prompt')})].filter((e) => e.textContent === ${JSON.stringify(text)}).length`;
    await s.evalJs(`(() => {
      const col = ${q(SP + ' .chat-column')};
      window.__both782 = false;
      const check = () => { if (!!(${pendingOf('echo pend782')}) && ${promptsOf('echo pend782')} > 0) window.__both782 = true; };
      window.__obs782 = new MutationObserver(check);
      window.__obs782.observe(col, { subtree: true, childList: true, characterData: true });
    })()`);
    await typeInBox('echo pend782');
    await s.key('Enter', 'Enter', 13);
    const sentAt = Date.now();
    await s.waitFor(`${pendingOf('echo pend782')}?.dataset.pending === 'sending'`, 'the pend782 bubble marked sending', 1000);
    console.log(`[verify] fix 782: the bubble drew ${Date.now() - sentAt} ms after the Enter`);
    await sleep(2000);
    fs.appendFileSync(sendFixture, userLine('echo pend782', 30) + '\n');
    await s.waitFor(`!(${pendingOf('echo pend782')}) && ${promptsOf('echo pend782')} === 1`, 'the bubble gone and one pend782 prompt', 5000);
    const both = await s.evalJs(`(() => { window.__obs782.disconnect(); return window.__both782; })()`);
    expect(both !== true, 'no frame held the bubble and the prompt line together');
    step('fix 782 (a): a sent message shows at once as Sending and gives way to its prompt line with no double');

    // Fix 782 (b): no prompt line, so Not seen yet 15 s on; the next send
    // clears it.
    const markOf = (text) => s.evalJs(`(() => { const e = ${pendingOf(text)}; return e ? { state: e.dataset.pending, words: e.querySelector('.chat-prompt-pending-mark')?.textContent ?? null } : null; })()`);
    await typeInBox('echo unseen782');
    await s.key('Enter', 'Enter', 13);
    const unseenFrom = Date.now();
    await s.waitFor(`!!(${pendingOf('echo unseen782')})`, 'the unseen782 bubble', 2000);
    await sleep(Math.max(0, unseenFrom + 10000 - Date.now()));
    const atTen = await markOf('echo unseen782');
    expect(atTen?.state === 'sending', `still Sending at 10 s, got ${JSON.stringify(atTen)}`);
    await s.waitFor(`${pendingOf('echo unseen782')}?.dataset.pending === 'unseen'`, 'the unseen782 bubble marked unseen', 12000);
    const unseen = await markOf('echo unseen782');
    expect(unseen?.words === 'Not seen yet', `the mark reads Not seen yet, got ${JSON.stringify(unseen)}`);
    console.log(`[verify] fix 782: Not seen yet ${Date.now() - unseenFrom} ms after the send`);
    await typeInBox('echo next782');
    await s.key('Enter', 'Enter', 13);
    await s.waitFor(`!(${pendingOf('echo unseen782')})`, 'the unseen782 bubble gone on the next send', 1000);
    step('fix 782 (b): a message with no prompt line reads Not seen yet after 15 s, and the next send clears it');
    fs.appendFileSync(sendFixture, userLine('echo next782', 40) + '\n');
    await s.waitFor(`!(${pendingOf('echo next782')})`, 'the next782 bubble gone with its line', 5000);

    // Fix 782 (c): the second of two quick sends waits behind the first's
    // Enter pause (fix 781's chain), finds the stub asking, and is refused:
    // its bubble keeps the refusal and its text goes back in the box.
    await typeInBox('echo first782');
    await s.key('Enter', 'Enter', 13);
    await sleep(200);
    await typeInBox('echo second782');
    await s.key('Enter', 'Enter', 13);
    await postSend({ hook_event_name: 'UserPromptSubmit', prompt: 'echo first782' });
    await postSend({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'x' } });
    try {
      await s.waitFor(`${pendingOf('echo second782')}?.dataset.pending === 'refused' && ${q(boxSel)}.value === 'echo second782'`, 'the second782 bubble refused and its text back in the box', 5000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify({ mark: await markOf('echo second782'), box: await s.evalJs(`${q(boxSel)}.value`), state: (await record(sendId))?.state })}`);
    }
    const refused = await markOf('echo second782');
    expect(refused?.words === 'Answer what it is waiting on first', `the refusal's words on the bubble, got ${JSON.stringify(refused)}`);
    // The Stop waits for the stub's `echo first782` to end: a hook that
    // lands while a shell's command runs makes the prompt's return read as
    // Claude leaving the shell (fix 360's rule), which drops the stub's
    // Claude mark and its chat face (seen once under the merged tree).
    try {
      const firstBy = Date.now() + 8000;
      while (Date.now() < firstBy && !(await rowsNow()).includes('first782')) await sleep(200);
      await waitRecord(sendId, (r) => r.command == null || r.command.state !== 'running', 'the stub back at its prompt after echo first782', 5000);
    } catch (err) {
      throw new Error(`${err.message}: rows ${JSON.stringify((await rowsNow()).filter((r) => r !== '').slice(-4))}`);
    }
    await postSend({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(sendId, (r) => r.state !== 'needs-input', 'the send stub past its ask', 5000);
    step('fix 782 (c): a send refused behind an ask keeps its bubble with the refusal and puts its text back in the box');
    // The box empty again, so no later flip carries the refused text.
    await s.evalJs(`(() => { const b = ${q(boxSel)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(b, ''); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);

    // Fix 783 (a): a chip by the view's own image event (nothing pasted
    // into the shell; attachPng exists only under the image block, so its
    // thumbnail may be broken, which no read here looks at). The × stays
    // disabled for the settle time after the turn ends.
    const chipSel = SP + ' .chat-image-chip';
    const xSel = SP + ' .chat-image-chips-clear';
    // The view drops an image event while it reads the session as asking,
    // and the window's store can trail the daemon's record after 782 (c)'s
    // Stop, so the box enabled again is the view's own word that it is not.
    await s.waitFor(`${q(boxSel)}?.disabled === false`, 'the box enabled after the ask', 5000);
    // What the pane did from here, for a miss: the chips row and the box
    // coming and going, with the time.
    await s.evalJs(`(() => {
      const p = ${q(SP)};
      const t0 = Date.now();
      window.__log783 = [];
      let last = '';
      window.__obs783a = new MutationObserver(() => {
        const box = p.querySelector('.chat-box');
        const now = (p.dataset.face ?? 'terminal') + ' chips ' + p.querySelectorAll('.chat-image-chip').length + ' x ' + !!p.querySelector('.chat-image-chips-clear') + ' box ' + (box === null ? 'none' : box === window.__box783a ? 'same' : 'new');
        window.__box783a = box;
        if (now !== last) window.__log783.push((Date.now() - t0) + ' ms ' + now);
        last = now;
      });
      window.__box783a = p.querySelector('.chat-box');
      window.__obs783a.observe(p, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-face'] });
      return true;
    })()`);
    const log783 = async () => {
      const r = await record(sendId);
      return { pane: await s.evalJs(`window.__log783 ?? null`), bound: r?.claudeSessionId ?? null, lastEventAt: r?.lastEventAt ?? null, command: r?.command ?? null };
    };
    await s.evalJs(`window.dispatchEvent(new CustomEvent('emerald:chat-image', { detail: { paneId: ${JSON.stringify(sendPane)}, path: ${JSON.stringify(attachPng)} } }))`);
    try {
      await s.waitFor(`document.querySelectorAll(${JSON.stringify(chipSel)}).length === 1`, 'one chip on the send stub', 5000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify(await log783())}, state ${(await record(sendId))?.state}`);
    }
    await postSend({ hook_event_name: 'UserPromptSubmit', prompt: 'chip turn' });
    await waitRecord(sendId, (r) => r.state === 'working', 'the send stub working', 5000);
    try {
      await s.waitFor(`${q(xSel)}?.disabled === true`, 'the × disabled while working', 3000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify(await log783())}, state ${(await record(sendId))?.state}`);
    }
    await postSend({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(sendId, (r) => r.state !== 'working', 'the send stub past its turn', 5000);
    const leftAt = Date.now();
    const stillDisabled = await s.evalJs(`${q(xSel)}?.disabled ?? null`);
    const readIn = Date.now() - leftAt;
    if (stillDisabled === null) {
      await sleep(500);
      throw new Error(`no × after the Stop: ${JSON.stringify(await log783())}, state ${(await record(sendId))?.state}`);
    }
    try {
      await s.waitFor(`${q(xSel)}?.disabled === false`, 'the × enabled after the settle time', 3000);
    } catch (err) {
      throw new Error(`${err.message}: ${JSON.stringify(await log783())}, state ${(await record(sendId))?.state}, rows ${JSON.stringify((await rowsNow()).filter((r) => r !== '').slice(-4))}`);
    }
    const settled = Date.now() - leftAt;
    console.log(`[verify] fix 783: the × enabled ${settled} ms after the record left working (disabled read ${readIn} ms after: ${stillDisabled})`);
    expect(stillDisabled === true, `the × disabled within 300 ms of the turn's end, got ${stillDisabled} at ${readIn} ms`);
    expect(settled >= 1300, `the × waited the settle time, enabled after ${settled} ms`);
    step('fix 783 (a): the × stays disabled for the settle time after the turn ends');

    // Fix 783 (b): a click shows the busy look while it reads; the stub's
    // prompt holds no marker, so the chips go with no Ctrl+C.
    await s.evalJs(`(() => {
      const x = ${q(xSel)};
      window.__busy783 = [];
      window.__obs783 = new MutationObserver(() => window.__busy783.push({ busy: x.dataset.busy ?? null, title: x.title }));
      window.__obs783.observe(x, { attributes: true });
    })()`);
    await s.evalJs(`${q(xSel)}.click()`);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(chipSel)}).length === 0`, 'no chip after the ×', 5000);
    const seen783 = await s.evalJs(`(() => { window.__obs783.disconnect(); return { marks: window.__busy783, x: !!${q(xSel)} }; })()`);
    expect(seen783.marks.some((m) => m.busy === 'true' && m.title === 'Waiting for Claude Code'), `the × carried data-busy and Waiting for Claude Code, got ${JSON.stringify(seen783.marks)}`);
    expect(seen783.x === false, 'the × gone with the chips row');
    step('fix 783 (b): the × carries data-busy and Waiting for Claude Code while it reads, until the chips go');

    // Fix 784 (a): text typed on the terminal face moves into the box on
    // the flip to chat. The stub's PowerShell is given a `❯ ` prompt and
    // no grey history prediction, so its input row reads as Claude Code's.
    const face = () => s.evalJs(`${q(SP)}.dataset.face ?? null`);
    const flip = async (want) => {
      await s.evalJs(`${q(SP + ' .pane-face-toggle')}.click()`);
      await s.waitFor(`(${q(SP)}.dataset.face ?? null) === ${JSON.stringify(want)}`, `the send stub on the ${want ?? 'terminal'} face`, 5000);
    };
    const lastRows = async () => (await rowsNow()).filter((r) => r !== '').slice(-6);
    const promptText = async () => {
      const r = (await screen(sendId)).rows;
      for (let i = r.length - 1; i >= 0; i--) if (r[i].trimStart().startsWith('❯')) return r[i].trimStart().slice(1).trim();
      return null;
    };
    if ((await face()) === 'chat') await flip(null);
    await typeRaw(sendId, "try { Set-PSReadLineOption -PredictionSource None } catch {}; function prompt { [string][char]0x276F + ' ' }\r");
    try {
      const promptBy = Date.now() + 10000;
      while (Date.now() < promptBy && (await lastRows()).at(-1) !== '❯') await sleep(200);
      expect((await lastRows()).at(-1) === '❯', 'the stub shows a bare ❯ prompt');
    } catch (err) {
      throw new Error(`${err.message}: the last rows ${JSON.stringify(await lastRows())} (the stub shell's code page is the suspect, not the fix)`);
    }
    await typeRaw(sendId, 'hello from the cli');
    const typedBy = Date.now() + 5000;
    while (Date.now() < typedBy && (await promptText()) !== 'hello from the cli') await sleep(200);
    expect((await promptText()) === 'hello from the cli', `the stub's input holds the text, got ${JSON.stringify(await lastRows())}`);
    await flip('chat');
    try {
      await s.waitFor(`${q(boxSel)}.value === 'hello from the cli'`, 'the box holds the terminal input', 4000);
    } catch (err) {
      throw new Error(`${err.message}: box ${JSON.stringify(await s.evalJs(`${q(boxSel)}.value`))}, hint ${JSON.stringify(await s.evalJs(`${q(SP + ' .chat-hint')}?.textContent ?? null`))}, rows ${JSON.stringify(await lastRows())}`);
    }
    const emptyBy = Date.now() + 3000;
    while (Date.now() < emptyBy && (await promptText()) !== '') await sleep(200);
    expect((await promptText()) === '', `the stub's input emptied, got ${JSON.stringify(await lastRows())}`);
    step('fix 784 (a): text typed in the terminal face moves into the chat box and leaves Claude\'s input');

    // Fix 784 (b): the box's text goes back into the input on the flip to
    // the terminal, with no Enter.
    await s.evalJs(`(() => { const b = ${q(boxSel)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(b, 'back to the cli'); b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await flip(null);
    const backBy = Date.now() + 3000;
    while (Date.now() < backBy && (await promptText()) !== 'back to the cli') await sleep(200);
    expect((await promptText()) === 'back to the cli', `the input holds the box's text, got ${JSON.stringify(await lastRows())}`);
    await sleep(1000);
    const after = await lastRows();
    expect(after.at(-1) === '❯ back to the cli', `no Enter: the input row is still the last, got ${JSON.stringify(after)}`);
    // PSReadLine's Escape clears the line.
    await typeRaw(sendId, '\x1b');
    await flip('chat');
    step('fix 784 (b): the box\'s text goes back into Claude\'s input with no Enter on the flip to the terminal');
  });

  await block('chips', async () => {
    // M9 fixes 785 and 786: a shell playing Claude whose transcript holds a
    // prompt and a reply alone, so the view chip is absent; Ctrl+O cycles
    // the mode with the chip hidden, and a thinking step brings the chip.
    const lay = await getLayout(s);
    const chipsPane = leaves(lay)[0].id;
    const before = leaves(lay)[0].sessionId;
    const chipsDir = path.join(emeraldHome, 'chat-785');
    fs.mkdirSync(chipsDir, { recursive: true });
    const chipsFixture = path.join(chipsDir, 'fixture.jsonl');
    fs.writeFileSync(chipsFixture, [userLine('say hello', 0), asstLine([{ type: 'text', text: 'Hello.' }], 1)].join('\n') + '\n');
    const spawned = await zreq(s, 'session.spawn', { kind: 'shell', cwd: chipsDir, cols: 120, rows: 30 });
    chipsId = spawned.session.id;
    const bind = async (sessionId) => {
      const cur = await getLayout(s);
      const rec = (n) => (n.kind === 'pane' ? (n.id === chipsPane ? { ...n, sessionId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
      await zreq(s, 'layout.set', { layout: { ...cur, root: rec(cur.root), focusedPaneId: chipsPane } });
    };
    await bind(chipsId);
    await s.waitFor(`!!${q(paneSel(chipsPane) + ' .term-host')}`, 'the chips stub in the first pane', 10000);
    const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
    const postChips = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': chipsId },
        body: JSON.stringify({ session_id: 'sim-chat-785', cwd: chipsDir, transcript_path: chipsFixture, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await postChips({ hook_event_name: 'SessionStart', source: 'startup' });
    await postChips({ hook_event_name: 'UserPromptSubmit', prompt: 'say hello' });
    await postChips({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(chipsId, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the chips stub bound with its transcript', 10000);
    await s.waitFor(`!!${q(paneSel(chipsPane) + ' .pane-face-toggle')}`, 'the face button on the chips stub', 10000);
    await toChat(chipsPane);
    await s.waitFor(`[...document.querySelectorAll(${JSON.stringify(paneSel(chipsPane) + ' .chat-reply')})].some((r) => r.textContent.trim() === 'Hello.')`, 'the reply drawn', 5000);
    await sleep(1000);
    expect((await s.evalJs(`!!${q(viewChip(chipsPane))}`)) === false, 'fix 785: no view chip on a transcript of a prompt and a reply');
    expect(['Normal', 'Thinking', 'Verbose'].includes(await viewWord(chipsPane)), `the view root names a mode, got ${JSON.stringify(await viewWord(chipsPane))}`);
    for (let i = 0; i < 3 && (await viewWord(chipsPane)) !== 'Thinking'; i++) {
      await s.evalJs(`${q(paneSel(chipsPane) + ' .chat-box')}.focus()`);
      await s.key('o', 'KeyO', 79, CTRL);
      await sleep(150);
    }
    await waitView(chipsPane, 'Thinking');
    expect((await s.evalJs(`!!${q(viewChip(chipsPane))}`)) === false, 'Ctrl+O cycles the mode with the chip hidden');
    fs.appendFileSync(chipsFixture, asstLine([{ type: 'thinking', thinking: '', signature: 'x' }], 2, { thinkingDurationMs: 2000 }) + '\n');
    await s.waitFor(`${q(viewChip(chipsPane) + ' .chat-chip-word')}?.textContent === 'Thinking'`, 'the view chip, reading the mode picked while it was hidden', 5000);
    await pickView(chipsPane, 'Normal');
    step('fix 785: the view chip is absent on a prompt and a reply, Ctrl+O still cycles the mode, and a thinking step brings the chip reading the mode picked while it was hidden');

    // M9 fix 786: a model the list does not name is the menu's first row,
    // ticked and not pickable; a listed one ticks its own row.
    const modelChip = paneSel(chipsPane) + ' .chat-chip[data-chip="model"]';
    const chipsMenu = '.menu.chat-model-menu';
    const modelRows = () => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(chipsMenu + ' .menu-item')})].map((b) => ({ label: b.querySelector('.menu-label')?.textContent.replace(/^✓/, '') ?? '', checked: b.dataset.checked ?? null, line: b.querySelector('.menu-line')?.textContent ?? null, disabled: b.disabled === true }))`);
    const openModel = async () => {
      await s.evalJs(`${q(modelChip)}.click()`);
      await s.waitFor(`!!${q(chipsMenu)}`, 'the model menu', 3000);
    };
    const closeModel = async () => {
      await s.key('Escape', 'Escape', 27);
      await s.waitFor(`!${q(chipsMenu)}`, 'the model menu gone', 2000);
    };
    const ticks = (rows) => rows.filter((r) => r.checked === 'true').map((r) => r.label);
    const listed = ['Default', 'Opus 5.5', 'Opus 5.5 (1M context)', 'Sonnet 5.5', 'Sonnet 5.5 (1M context)', 'Haiku 5.5', 'Fable 5.1', 'Fable 5.1 (1M context)', 'Opus Plan'];
    await postChips({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-9-9', display_name: 'Opus 9.9' } });
    await s.waitFor(`${q(modelChip + ' .chat-chip-word')}?.textContent === 'Opus 9.9'`, 'the model chip reading Opus 9.9', 5000);
    await openModel();
    {
      const rows = await modelRows();
      expect(JSON.stringify(rows.map((r) => r.label)) === JSON.stringify(['Model', 'Opus 9.9', ...listed]), `the heading, Opus 9.9 and the nine models, got ${JSON.stringify(rows.map((r) => r.label))}`);
      expect(JSON.stringify(ticks(rows)) === '["Opus 9.9"]', `Opus 9.9 ticked alone, got ${JSON.stringify(ticks(rows))}`);
      expect(rows[1].line === 'Current model' && rows[1].disabled === true, `row 1 reads Current model and is disabled, got ${JSON.stringify(rows[1])}`);
      await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(chipsMenu + ' .menu-item')})][1].click()`);
      await sleep(500);
      expect((await s.evalJs(`!!${q(chipsMenu)}`)) === true, 'a click on the disabled Current model row leaves the menu open');
    }
    await closeModel();
    await postChips({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' } });
    await s.waitFor(`${q(modelChip + ' .chat-chip-word')}?.textContent === 'Opus 5.5'`, 'the model chip reading Opus 5.5', 5000);
    await openModel();
    {
      const rows = await modelRows();
      expect(JSON.stringify(rows.map((r) => r.label)) === JSON.stringify(['Model', ...listed]), `the heading and the nine models alone, got ${JSON.stringify(rows.map((r) => r.label))}`);
      expect(JSON.stringify(ticks(rows)) === '["Opus 5.5"]', `Opus 5.5 ticked alone, got ${JSON.stringify(ticks(rows))}`);
    }
    await closeModel();
    step('fix 786: a session on Opus 9.9 reads a ticked Current model row first, not pickable, above the nine models; on Opus 5.5 the list alone, its row ticked');

    // The layout as the block found it: the first pane on its earlier
    // session, which opens on its terminal face.
    if (before !== null) await bind(before);
  });

  await block('review-base', async () => {
    // M9 fix 790: a shell playing Claude in a fixture repository. Its
    // session committed an edit and another to a file outside the folder;
    // the diff chip counts the first alone and opens the review on the
    // commit the session started on, where the committed file shows.
    const dir790 = path.join(emeraldHome, 'chat-790');
    fs.rmSync(dir790, { recursive: true, force: true });
    fs.mkdirSync(dir790, { recursive: true });
    const repo790 = fs.realpathSync.native(dir790);
    const git790 = (...args) => execFileSync('git', args, { cwd: repo790, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    git790('init', '-q', '-b', 'main');
    git790('config', 'user.name', 'emerald verify');
    git790('config', 'user.email', 'verify@example.com');
    git790('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo790, 'notes.txt'), 'one\n');
    git790('add', '.');
    git790('commit', '-q', '-m', 'seed');
    const fixture790 = path.join(fs.realpathSync.native(emeraldHome), 'chat-790.jsonl');
    fs.writeFileSync(fixture790, '');
    const spawned = await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo790, cols: 120, rows: 30 });
    reviewId790 = spawned.session.id;
    const lay = await getLayout(s);
    const pane790 = leaves(lay)[0].id;
    const rec = (n) => (n.kind === 'pane' ? (n.id === pane790 ? { ...n, sessionId: reviewId790 } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root), focusedPaneId: pane790 } });
    await s.waitFor(`!!${q(paneSel(pane790) + ' .term-host')}`, 'the 790 stub in the first pane', 10000);
    const daemon = JSON.parse(fs.readFileSync(path.join(emeraldHome, 'daemon.json'), 'utf8'));
    const post790 = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': reviewId790 },
        body: JSON.stringify({ session_id: 'sim-chat-790', cwd: repo790, transcript_path: fixture790, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await post790({ hook_event_name: 'SessionStart', source: 'startup' });
    const start790 = (await waitRecord(reviewId790, (r) => (r.spans?.at(-1)?.startHead ?? null) !== null, 'the span read its start commit', 10000)).spans.at(-1).startHead;
    expect(start790 === git790('rev-parse', 'HEAD'), `the span's start commit is the seed, got ${start790}`);
    // The session's work, committed.
    fs.writeFileSync(path.join(repo790, 'notes.txt'), 'one\ntwo\nthree\n');
    git790('commit', '-q', '-am', 'session work');
    const outside790 = path.join(os.tmpdir(), 'outside-790.md');
    fs.writeFileSync(
      fixture790,
      [
        userLine('add two lines', 0),
        asstLine([useOf('e790', 'Edit', { file_path: path.join(repo790, 'notes.txt'), old_string: 'one', new_string: 'one\ntwo\nthree' })], 1),
        resultOf('e790', 'ok', 2, { toolUseResult: { filePath: path.join(repo790, 'notes.txt'), structuredPatch: [{ lines: [' one', '+two', '+three'] }] } }),
        asstLine([useOf('e790b', 'Edit', { file_path: outside790, old_string: 'x', new_string: 'y' })], 3),
        resultOf('e790b', 'ok', 4, { toolUseResult: { filePath: outside790, structuredPatch: [{ lines: ['+a', '+b', '+c', '+d', '+e'] }] } }),
        asstLine([{ type: 'text', text: 'Committed.' }], 5),
      ].join('\n') + '\n',
    );
    await post790({ hook_event_name: 'UserPromptSubmit', prompt: 'add two lines' });
    await post790({ hook_event_name: 'Stop', stop_hook_active: false });
    await waitRecord(reviewId790, (r) => r.transcriptPath !== null && ['idle', 'done'].includes(r.state), 'the 790 stub bound with its transcript', 10000);
    await s.waitFor(`!!${q(paneSel(pane790) + ' .pane-face-toggle')}`, 'the face button on the 790 stub', 10000);
    await toChat(pane790);
    const chipSel = paneSel(pane790) + ' .chat-chip[data-chip="diff"]';
    try {
      await s.waitFor(`${q(chipSel + ' .chat-chip-word')}?.textContent === '+2 −0'`, 'the diff chip counts the edit under the folder alone', 5000);
    } catch (err) {
      throw new Error(`${err.message}: got ${JSON.stringify(await s.evalJs(`${q(chipSel + ' .chat-chip-word')}?.textContent ?? null`))}`);
    }
    await s.evalJs(`${q(chipSel)}.click()`);
    await s.waitFor(`document.querySelector('.review-tab')?.dataset.state === 'ready' && document.querySelector('.review-tab').dataset.base === 'session'`, 'the review tab on the session base', 10000);
    const read = await s.evalJs(`(() => { const t = document.querySelector('.review-tab'); return { baseHash: t.dataset.baseHash, files: t.dataset.files, list: [...document.querySelectorAll('.review-file')].map((f) => f.dataset.rel), on: document.querySelector('.review-chip[data-base="session"]').dataset.on }; })()`);
    expect(read.baseHash === start790 && read.files === '1' && JSON.stringify(read.list) === '["notes.txt"]' && read.on === 'true', `the review is on the start commit with the committed file, got ${JSON.stringify(read)}`);
    await s.evalJs(`document.querySelector('.review-chip[data-base="head"]').click()`);
    await s.waitFor(`document.querySelector('.review-tab')?.dataset.base === 'head' && document.querySelector('.review-tab').dataset.files === '0'`, 'HEAD shows no file, the commit took the change off it', 10000);
    await s.key('w', 'KeyW', 87, CTRL);
    await s.waitFor(`!document.querySelector('.review-tab')`, 'the review tab closed');
    // The strip fronts the tab beside the closed one, which in a whole run
    // is the paths block's notes-716.md file tab, not Panes; put Panes back
    // in front, so the next block's pane is on screen and its box can take
    // the keyboard.
    await s.evalJs(`${q('.tab[data-tab="panes"]')}.click()`);
    await s.waitFor(`document.querySelector('.tab-strip')?.dataset.activeTab === 'panes'`, 'back on the panes tab after the review', 5000);
    step('M9 fix 790: the diff chip counts only the edit under the folder, +2 −0, and opens the review on the start commit with the committed file; HEAD shows none');
  });

  await block('mod-ask', async () => {
    // M9 fix 774: a real permission dialog, then an Escape at it. 2.1.301
    // ends the turn with a TurnComplete (reason answer, is_aborted false)
    // and no Stop, so the row stayed needs-input and the box disabled
    // until the TurnComplete idled it. One real Claude in the first pane.
    const spawned = await zreq(s, 'session.spawn', { kind: 'claude', cwd: repoRoot, args: ['--permission-mode', 'default'], cols: 120, rows: 30 });
    askId = spawned.session.id;
    const lay = await getLayout(s);
    const askPane = leaves(lay)[0].id;
    const rec = (n) => (n.kind === 'pane' ? (n.id === askPane ? { ...n, sessionId: askId } : n) : { ...n, first: rec(n.first), second: rec(n.second) });
    await zreq(s, 'layout.set', { layout: { ...lay, root: rec(lay.root) } });
    await waitRecord(askId, (r) => r.state === 'idle' && r.claudeSessionId !== null, 'the real Claude idle', 30000);
    await s.waitFor(`!!${q(paneSel(askPane) + ' .pane-face-toggle')}`, 'the face button on the real Claude', 10000);
    await toChat(askPane);
    await sleep(2000);
    const AP = paneSel(askPane);
    const hooksLog = path.join(emeraldHome, 'logs', 'hooks.jsonl');
    const eventsFor = (id) =>
      (fs.existsSync(hooksLog) ? fs.readFileSync(hooksLog, 'utf8') : '')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((l) => l.sessionId === id);
    const countOf = (name) => eventsFor(askId).filter((e) => e.event === name).length;
    const sendBox = async (text) => {
      await s.evalJs(`${q(AP + ' .chat-box')}.focus()`);
      try {
        await s.waitFor(`document.activeElement === ${q(AP + ' .chat-box')}`, 'the box holds the keyboard');
      } catch (err) {
        throw new Error(`${err.message}: ${JSON.stringify(await s.evalJs(`(() => { const p = ${q(AP)}; const b = p?.querySelector('.chat-box'); const a = document.activeElement; const r = p?.getBoundingClientRect(); return { pane: !!p, face: p?.dataset.face ?? null, box: !!b, disabled: b?.disabled ?? null, active: a ? a.tagName + '.' + a.className : null, rect: r ? { w: r.width, h: r.height } : null, panes: document.querySelectorAll('.pane').length, tabs: [...document.querySelectorAll('.tab-strip .tab, [role=tab]')].map((t) => t.textContent.slice(0, 30)) }; })()`))}, record ${JSON.stringify((({ state, kind, claudeSessionId }) => ({ state, kind, claudeSessionId }))(await record(askId)))}`);
      }
      await s.type(text);
      await s.key('Enter', 'Enter', 13);
    };
    // No ask in 90 s fails with the record and the screen: a ping that
    // stops asking is a change on the box to look at, not a pass.
    const waitAsk = async (words, what) => {
      const until = Date.now() + 90000;
      while (Date.now() < until) {
        const r = await record(askId);
        if (r.state === 'needs-input' && (words === null || r.askedFor?.words === words)) return r;
        await sleep(250);
      }
      const r = await record(askId);
      expect(false, `${what}: no ask in 90 s, record ${JSON.stringify({ state: r.state, reason: r.needsInputReason, askedFor: r.askedFor ?? null })}, last rows ${JSON.stringify((await screen(askId)).rows.filter((x) => x.trim() !== '').slice(-6))}`);
    };
    const stopsBefore = countOf('Stop');
    await sendBox('Use the Bash tool to run exactly this command and nothing else: ping -n 1 127.0.0.1');
    await waitAsk('Bash: ping -n 1 127.0.0.1', 'fix 774: the ping asks under default mode');
    await sleep(1000);
    await typeRaw(askId, '\x1b');
    const readAsk = async () => {
      const r = await record(askId);
      return { state: r.state, askedFor: r.askedFor ?? null, card: await s.evalJs(`!!${q(AP + ' .chat-step[data-kind="ask"]')}`), disabled: await s.evalJs(`${q(AP + ' .chat-box')}?.disabled ?? null`) };
    };
    const freed = (g) => g.state === 'idle' && g.askedFor === null && !g.card && g.disabled === false;
    let got = await readAsk();
    for (const end = Date.now() + 5000; Date.now() < end && !freed(got); await sleep(200)) got = await readAsk();
    expect(freed(got), `fix 774: an Escape at the real dialog leaves the row idle, the ask gone and the box enabled, got ${JSON.stringify(got)}`);
    console.log(`[verify] note: Stop lines for the session ${stopsBefore} before the ask, ${countOf('Stop')} after the Escape`);
    step('fix 774: an Escape at a real permission dialog puts the row at idle, the card gone and the box enabled');

    // M9 fix 775: an answered ask goes back to working once the call runs.
    // The run-in-background pill draws on the first output a Bash run
    // gives past 2000 ms and the mod posts ToolRunning off it. A bare
    // ping's output reaches Claude Code only at its end (the probe of fix
    // 775: the pill at 11 s of ping -n 11), so the loop echoes a line a
    // second, and its ping makes it ask; it is working within four
    // seconds of the answer, before its PostToolUse.
    await sendBox('Use the Bash tool to run this exact command in the foreground, not in the background: for i in 1 2 3 4 5 6 7 8 9 10; do ping -n 2 127.0.0.1 > /dev/null; echo tick$i; done. Then reply with exactly the word ran775 and nothing else.');
    await waitAsk(null, 'fix 775: the long ping asks');
    await sleep(1000);
    const postsBefore = countOf('PostToolUse');
    const stops775 = countOf('Stop');
    await typeRaw(askId, '1');
    const answeredAt = Date.now();
    let state = (await record(askId)).state;
    let posts = postsBefore;
    while (Date.now() - answeredAt < 4000 && state !== 'working') {
      await sleep(200);
      state = (await record(askId)).state;
      posts = countOf('PostToolUse');
    }
    const ms = Date.now() - answeredAt;
    expect(state === 'working' && posts === postsBefore, `fix 775: working ${ms} ms after the answer and before the ping's PostToolUse, got ${JSON.stringify({ state, posts: posts - postsBefore })}`);
    const turnBy = Date.now() + 90000;
    while (Date.now() < turnBy && countOf('Stop') === stops775) await sleep(250);
    expect(countOf('Stop') > stops775, 'fix 775: the ping turn ended with its Stop');
    // The mod's ToolRunning draws off the call's progress row, which on
    // Windows comes near the run's end, so it is read once the turn is
    // over; the move itself came off the daemon's spinner read.
    expect(eventsFor(askId).some((e) => e.event === 'ToolRunning' && e.mod === true), "fix 775: the mod's ToolRunning is in the log");
    const bySpinner = fs.readFileSync(path.join(emeraldHome, 'logs', 'emmerd.log'), 'utf8').includes('permission answered: the spinner drew again');
    step(`fix 775: the answered ask read working ${ms} ms after the answer, before the call's PostToolUse (${bySpinner ? "off the daemon's spinner read" : "off the mod's ToolRunning"})`);
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
  if (boxId !== null) await zreq(s, 'session.kill', { sessionId: boxId }).catch(() => {});
  if (imageId !== null) await zreq(s, 'session.kill', { sessionId: imageId }).catch(() => {});
  if (turnsId !== null) await zreq(s, 'session.kill', { sessionId: turnsId }).catch(() => {});
  if (feedId !== null) await zreq(s, 'session.kill', { sessionId: feedId }).catch(() => {});
  if (tailId !== null) await zreq(s, 'session.kill', { sessionId: tailId }).catch(() => {});
  if (sendId !== null) await zreq(s, 'session.kill', { sessionId: sendId }).catch(() => {});
  if (chipsId !== null) await zreq(s, 'session.kill', { sessionId: chipsId }).catch(() => {});
  if (reviewId790 !== null) await zreq(s, 'session.kill', { sessionId: reviewId790 }).catch(() => {});
  if (askId !== null) await zreq(s, 'session.kill', { sessionId: askId }).catch(() => {});
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
