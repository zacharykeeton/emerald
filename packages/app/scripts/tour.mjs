// M9 fix 58, the tour: builds the standard scene and writes a folder of
// clips, so a look at the app after a batch costs one run and looks the
// same from batch to batch. It asserts nothing beyond the scene building;
// the clips are for a person (or a session) to read. The scene: a 2x2
// grid of a shell that has printed, a working session with a titled turn,
// a session that needs input, and an exited Claude session that keeps its
// context reading; a fifth session, done, only in the sidebar; a file tab
// opened from the rail; the sidebar at its 260px default; the top-left
// pane narrowed to 330px, the width every title fix was read at. The
// working turn is a real Claude turn when the 16 hooks are installed in
// ~/.claude/settings.json, else posted hooks, and the log says which.
// Uses a private home and pipe unless the environment names them, so it
// runs beside a live emerald; the window stays off the screen and silent
// like every harness. Clips land in %TEMP%\emerald-verify\tour.
// Run: npm run verify:tour -w @emerald/app
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'tour-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-tour';
const { expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, splitWithShell, startSession, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 240 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 240000);

const tourDir = path.join(os.tmpdir(), 'emerald-verify', 'tour');
fs.rmSync(tourDir, { recursive: true, force: true });
fs.mkdirSync(tourDir, { recursive: true });

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const hooksInstalled = () => {
  try {
    return (fs.readFileSync(settingsPath, 'utf8').match(/\.emerald\/hooks\/claude-hook\.cmd/g) ?? []).length === 16;
  } catch {
    return false;
  }
};
const realTurn = hooksInstalled() && process.env['EMERALD_TOUR_POSTED'] === undefined;

const s = await launch(freshPort(), { freshState: true });
app = s;
try {
  const daemonInfo = () => JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const post = async (sessionId, payload) => {
    const daemon = daemonInfo();
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ session_id: `tour-${sessionId.slice(0, 8)}`, cwd: repoRoot, ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  const send = (sessionId, text) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(sessionId)}, data: ${JSON.stringify(text)} + String.fromCharCode(13) })`);
  const waitState = (id, states, what, timeoutMs = 15000) =>
    s.waitFor(`${JSON.stringify(states)}.includes(document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(id)}]')?.dataset.state)`, what, timeoutMs);
  const sessionIn = async (paneId) => leaves(await getLayout(s)).find((p) => p.id === paneId)?.sessionId ?? null;

  // The hooks banner reads the private home, which has no hook files, so
  // it is up on every harness; the clips are of the app, not of it.
  await sleep(1500);
  await s.evalJs(`document.querySelector('.hooks-dismiss')?.click()`);

  // The grid. A plain click on a split button gives an empty pane since
  // fix 537, so the split menu's Split with shell (fix 343's kind, in the
  // folder of the pane it came from) gives four shells in the repo.
  await startSession(s, { kind: 'shell', cwd: repoRoot });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'the first shell');
  const p1 = leaves(await getLayout(s))[0].id;
  await splitWithShell(s, `[data-pane-id=${JSON.stringify(p1)}] .pane-split-right`);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'the second shell');
  const p2 = leaves(await getLayout(s)).find((p) => p.id !== p1).id;
  await splitWithShell(s, `[data-pane-id=${JSON.stringify(p1)}] .pane-split-down`);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 3`, 'the third shell');
  await splitWithShell(s, `[data-pane-id=${JSON.stringify(p2)}] .pane-split-down`);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 4`, 'the fourth shell');
  const panes = leaves(await getLayout(s)).map((p) => p.id);
  const [p3, p4] = panes.filter((id) => id !== p1 && id !== p2);
  const [s1, s2, s3, s4] = await Promise.all([p1, p2, p3, p4].map(sessionIn));
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 4`, 'four rows');
  step(`a 2x2 grid of shells in ${repoRoot}`);

  // Pane 1: a shell that has printed something.
  await send(s1, 'Get-ChildItem | Select-Object -First 8');
  await sleep(1500);

  // Pane 2: the working session. A real Claude turn when the hooks are
  // installed, else the shell made a working Claude session by posted
  // hooks with a titled turn, as verify:m9's M33 step does.
  if (realTurn) {
    step('hooks installed: the working pane runs a real Claude turn');
    await send(s2, 'claude --permission-mode default');
    await waitState(s2, ['idle'], 'Claude started in pane 2', 40000);
    await sleep(4000);
    // The prompt goes down the PTY rather than through the page's focus,
    // the text first and the Enter after Claude's paste detection window
    // (verify:hooks types the same way through the keyboard).
    const raw = (text) => s.evalJs(`window.emerald.send({ type: 'pty.input', sessionId: ${JSON.stringify(s2)}, data: ${JSON.stringify(text)} })`);
    await raw('Reply with exactly the word pong and nothing else.');
    await sleep(1500);
    await raw(String.fromCharCode(13));
    await waitState(s2, ['working'], 'the turn started', 20000);
  } else {
    step(hooksInstalled() ? 'EMERALD_TOUR_POSTED set: the working pane is posted hooks' : 'hooks not installed: the working pane is posted hooks');
    await post(s2, { hook_event_name: 'SessionStart', source: 'startup' });
    await post(s2, { hook_event_name: 'UserPromptSubmit', prompt: 'rewrite the hook wrapper to run under Git Bash' });
    await post(s2, { hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 12, context_window_size: 1000000, total_input_tokens: 116045, total_output_tokens: 212, current_usage: { input_tokens: 2, output_tokens: 212, cache_creation_input_tokens: 299, cache_read_input_tokens: 115744 } } });
    await waitState(s2, ['working'], 'pane 2 is working');
    await send(s2, 'Write-Host "$([char]27)]2;◐ Hook wrapper$([char]7)"');
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s2)}] .sidebar-row-name')?.textContent === 'Hook wrapper'`, 'the working row took the title', 10000);
  }

  // Pane 3: needs input, by posted hooks.
  await post(s3, { hook_event_name: 'SessionStart', source: 'startup' });
  await post(s3, { hook_event_name: 'UserPromptSubmit', prompt: 'rewrite the agent guide for the new hooks' });
  // A team on it (M46), for the roster and its card (fix 89): one agent
  // out, one returned.
  await post(s3, { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { description: 'Find every hook the guide names', subagent_type: 'Explore' } });
  await post(s3, { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'Find every hook the guide names', subagent_type: 'Explore' }, tool_response: { agentId: 'tour-a1', description: 'Find every hook the guide names', status: 'async_launched' } });
  await post(s3, { hook_event_name: 'SubagentStart', agent_id: 'tour-a1', agent_type: 'Explore' });
  await post(s3, { hook_event_name: 'SubagentStart', agent_id: 'tour-a2', agent_type: 'fork' });
  await post(s3, { hook_event_name: 'SubagentStop', agent_id: 'tour-a1', agent_type: 'Explore' });
  await post(s3, { hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: 'docs/agent-guide.md' } });
  await waitState(s3, ['needs-input'], 'pane 3 needs input');

  // Pane 4: an exited Claude session that keeps its context reading (fix
  // 39): a shell made a Claude session by posted hooks, then exited.
  await post(s4, { hook_event_name: 'SessionStart', source: 'startup' });
  await post(s4, { hook_event_name: 'UserPromptSubmit', prompt: 'add client-side search to the docs site' });
  await post(s4, { hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 42, context_window_size: 200000, total_input_tokens: 84000, total_output_tokens: 90, current_usage: { input_tokens: 40, output_tokens: 90, cache_creation_input_tokens: 1200, cache_read_input_tokens: 82760 } } });
  // A checklist three of four done (M9 fix 153), so the row and the
  // title carry the count and the card has a list to show.
  for (const [i, [subject, activeForm, status]] of [['Build the search index', 'Building the search index', 'completed'], ['Wire the search box', 'Wiring the search box', 'completed'], ['Write the tests', 'Writing the tests', 'completed'], ['Note it in the docs', 'Noting it in the docs', 'pending']].entries()) {
    await post(s4, { hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject, activeForm, description: subject }, tool_response: { task: { id: String(i + 1), subject } } });
    if (status === 'completed') await post(s4, { hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: String(i + 1), status }, tool_response: { success: true, taskId: String(i + 1) } });
  }
  await post(s4, { hook_event_name: 'Stop', last_assistant_message: 'search index builds; 14 tests pass' });
  await waitState(s4, ['done', 'idle'], 'pane 4 finished its turn');
  await send(s4, 'exit');
  await waitState(s4, ['exited'], 'pane 4 exited', 15000);

  // A fifth session, done, only in the sidebar.
  const { session: fifth } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: os.homedir(), cols: 80, rows: 24 });
  await post(fifth.id, { hook_event_name: 'SessionStart', source: 'startup' });
  await post(fifth.id, { hook_event_name: 'UserPromptSubmit', prompt: 'try the worktree layout on one branch' });
  await post(fifth.id, { hook_event_name: 'Stop', last_assistant_message: 'parked, notes in docs/spike.md' });
  await waitState(fifth.id, ['done'], 'the fifth session is done');
  step('the scene: a printed shell, a working turn, a needs-input, an exited Claude with its context, a done row in the sidebar');

  // The left column at 330px: the root is the row split the first
  // split-right made, so its ratio is the column's width.
  const layout = await getLayout(s);
  const rootSplit = layout.root;
  if (rootSplit.kind === 'split' && rootSplit.direction === 'row') {
    const splitWidth = await s.evalJs(`document.querySelector('[data-split-id=${JSON.stringify(rootSplit.id)}]').getBoundingClientRect().width`);
    await zreq(s, 'layout.set', { layout: { ...layout, root: { ...rootSplit, ratio: 330 / splitWidth } } });
    await s.waitFor(`Math.abs(document.querySelector('[data-pane-id=${JSON.stringify(p1)}]').getBoundingClientRect().width - 330) < 4`, 'pane 1 at 330px', 5000);
  } else {
    step(`the root is not a row split (${rootSplit.kind}), the narrow pane is skipped`);
  }
  await sleep(500);

  // The clips. Everything the batches read: the sidebar, each pane title,
  // the tab strip, the rail, the footer, the title bar when there is one,
  // and the whole window.
  const clip = async (name, selector, index = 0) => {
    const rect = await s.evalJs(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    if (rect === null || rect.width === 0 || rect.height === 0) {
      step(`clip ${name}: no ${selector}${index > 0 ? `[${index}]` : ''} on screen, skipped`);
      return;
    }
    const { data } = await s.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 2 } });
    const file = path.join(tourDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    step(`clip ${name}: ${Math.round(rect.width)}x${Math.round(rect.height)} at ${Math.round(rect.x)},${Math.round(rect.y)} -> ${file}`);
  };
  await clip('window', '.app');
  await clip('title-bar', '.title-bar');
  await clip('sidebar', '.sidebar');
  await clip('sidebar-footer', '.sidebar-footer');
  await clip('tab-strip', '.tab-strip');
  for (let i = 0; i < 4; i++) await clip(`pane-title-${i + 1}`, '.pane-title', i);
  await clip('pane-narrow', `[data-pane-id=${JSON.stringify(p1)}]`);
  // M63: the shade over pane 3 (needs input, with a roster), pulled by
  // its title button and lifted again by a click on the face.
  const shadeButton = `[data-pane-id=${JSON.stringify(p3)}] .pane-shade-toggle`;
  if (await s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(shadeButton)}); if (!b) return false; b.click(); return true; })()`)) {
    await s.waitFor(`!!document.querySelector('[data-pane-id=${JSON.stringify(p3)}] .pane-shade')`, 'the shade over pane 3', 3000).catch(() => {});
    await sleep(300);
    await clip('pane-shaded', `[data-pane-id=${JSON.stringify(p3)}]`);
    await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p3)}] .pane-shade')?.click()`);
    await sleep(300);
  } else {
    step('clip pane-shaded: no shade button on pane 3, skipped');
  }
  await clip('rail', '.files-rail');
  // M9 fix 67: the context card, opened by a click on the first title's
  // reading (the rail's footer bar is gone), then closed with Escape.
  const reading = await s.evalJs("(() => { const r = document.querySelector('.pane-title .pane-context'); if (r === null) return false; r.click(); return true; })()");
  if (reading) {
    await s.waitFor("!!document.querySelector('.context-popover')", 'the context card', 3000).catch(() => {});
    await clip('context-card', '.context-popover');
    await s.key('Escape', 'Escape', 27);
  } else {
    step('clip context-card: no reading in a title, skipped');
  }
  // M9 fix 153: the checklist card, opened by a click on pane 4's row
  // count (three of four done), then closed with Escape.
  const tasks = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s4)}] .sidebar-row-tasks'); if (r === null) return false; r.scrollIntoView({ block: 'center' }); r.click(); return true; })()`);
  if (tasks) {
    await s.waitFor("!!document.querySelector('.tasks-popover')", 'the checklist card', 3000).catch(() => {});
    await clip('tasks-card', '.tasks-popover');
    await s.key('Escape', 'Escape', 27);
  } else {
    step('clip tasks-card: no count on the row, skipped');
  }
  // M9 fix 89: the roster's card, opened by a click on pane 3's row
  // roster (one agent out, one returned), then closed with Escape.
  const roster = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s3)}] .roster'); if (r === null) return false; r.click(); return true; })()`);
  if (roster) {
    await s.waitFor("!!document.querySelector('.roster-popover')", 'the roster card', 3000).catch(() => {});
    await clip('roster-card', '.roster-popover');
    await s.key('Escape', 'Escape', 27);
  } else {
    step('clip roster-card: no roster on the row, skipped');
  }

  // A file tab from the rail, then its clip, then back to the panes.
  const readme = await s.evalJs(`[...document.querySelectorAll('.files-row')].find((r) => r.textContent.trim().startsWith('README.md'))?.dataset.path ?? null`);
  if (readme !== null) {
    // Found by its dataset rather than an attribute selector, since the
    // path's backslashes would need escaping twice over in a selector.
    await s.evalJs(`[...document.querySelectorAll('.files-row')].find((r) => r.dataset.path === ${JSON.stringify(readme)}).click()`);
    await s.waitFor(`document.querySelectorAll('.tab-file').length === 1`, 'the README tab', 10000);
    await sleep(800);
    await clip('file-tab', '.app-center');
    await s.evalJs(`document.querySelector('.tab-panes').click()`);
    await sleep(300);
  } else {
    step('no README.md row in the rail, no file tab clip');
  }
  // The Changed list (fix 70) is the tree's toggle rather than a tab.
  const changedToggle = await s.evalJs(`!!document.querySelector('.files-changed-toggle')`);
  if (changedToggle) {
    await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
    await sleep(1200);
    await clip('rail-changed', '.files-rail');
    await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  }
  // M61: two agents of pane 3 out on this checkout's worktree branches,
  // so the timeline clip shows agents' lanes when a batch is in flight
  // (a plain checkout with no worktrees shows none). Since M68 the
  // scene's live Claude sessions, none of which has committed, are rows
  // of their own at the top of the graph, each a straight dashed lane
  // to its own dot on this branch's tip. The agents' own
  // Bash hooks name the worktree as their folder, which is all the
  // daemon needs to put them on its branch.
  // The list's first entry is the main working tree, whose branch is the
  // default's; an agent put there would label the main line, so it and
  // this checkout are left out.
  const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot })
    .toString()
    .split(/\r?\n/)
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice(9))
    .slice(1)
    .filter((w) => path.resolve(w).toLowerCase() !== path.resolve(repoRoot).toLowerCase())
    .slice(0, 2);
  if (worktrees.length > 0) {
    await post(s3, { hook_event_name: 'SubagentStart', agent_id: 'tour-a3', agent_type: 'fork' });
    await post(s3, { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'the lane card', subagent_type: 'fork' }, tool_response: { agentId: 'tour-a3', description: 'the lane card', status: 'async_launched' } });
    const agents = ['tour-a2', 'tour-a3'];
    for (const [i, wt] of worktrees.entries()) {
      await post(s3, { hook_event_name: 'PostToolUse', agent_id: agents[i], tool_name: 'Bash', cwd: wt, tool_input: { command: 'git status' } });
    }
    await sleep(800);
    step(`two agents out on ${worktrees.map((w) => path.basename(w)).join(' and ')}`);
  } else {
    step('no worktrees beside this checkout, the timeline clip shows no agent lanes');
  }
  for (const tab of ['timeline', 'history']) {
    const has = await s.evalJs(`!!document.querySelector('.rail-tab[data-tab=${JSON.stringify(tab)}]')`);
    if (!has) continue;
    await s.evalJs(`document.querySelector('.rail-tab[data-tab=${JSON.stringify(tab)}]').click()`);
    await sleep(1200);
    await clip(`rail-${tab}`, '.files-rail');
    // M60: the lane card, pinned by a click on the first pill or session
    // block that has one (a session on that branch, or a block the daemon
    // recorded), then closed with Escape; M65: the agent card the same
    // way off the first agent marker.
    if (tab === 'timeline') {
      const press = (sel) => s.evalJs(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); if (a === null) return false; a.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
      if (await press('.commits-pill[data-popover-for]:not([data-merged]), .commits-lane-group[data-popover-for]')) {
        await s.waitFor("!!document.querySelector('.lane-popover')", 'the lane card', 3000).catch(() => {});
        await clip('lane-card', '.lane-popover');
        await s.key('Escape', 'Escape', 27);
      } else {
        step('clip lane-card: no block with a session on the Commits tab, skipped');
      }
      if (await press('.commits-agent-node[data-popover-for]')) {
        await s.waitFor("!!document.querySelector('.agent-popover')", 'the agent card', 3000).catch(() => {});
        await clip('agent-card', '.agent-popover');
        await s.key('Escape', 'Escape', 27);
      } else {
        step('clip agent-card: no agent row on the Commits tab, skipped');
      }
    }
  }
  // M53: the first Sessions row unfolded into its turns, then the same
  // conversation as a tab; the rows are this machine's own transcripts,
  // so the clips are whatever the newest conversation holds.
  if (await s.evalJs(`!!document.querySelector('.history-row')`)) {
    await s.evalJs(`document.querySelector('.history-row').click()`);
    await s.waitFor(`!!document.querySelector('.history-row[data-unfolded] .history-turns, .history-row[data-unfolded] .history-turns-note')`, 'the first row unfolded', 10000);
    await sleep(600);
    await clip('rail-transcript', '.files-rail');
    await s.evalJs(`document.querySelector('.history-row[data-unfolded] .history-expand')?.click()`);
    await s.waitFor(`!!document.querySelector('.transcript-view')`, 'the transcript tab', 10000);
    await sleep(800);
    await clip('transcript-tab', '.app-center');
    await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-close')?.click()`);
    await s.evalJs(`document.querySelector('.history-row[data-unfolded]')?.click()`);
    await sleep(300);
  } else {
    step('no Sessions row, no transcript clips');
  }
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]')?.click()`);
  // M64: the first session's changes as a review tab, with one comment
  // open on the first file's first line when the tree has a change; a
  // clean tree gives no clip, since the item is off.
  {
    const s1 = leaves(await getLayout(s))[0].sessionId;
    const rowName = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s1)}] .sidebar-row-name')?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
    if (rowName !== null) {
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rowName.x, y: rowName.y, button: 'right', clickCount: 1 });
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rowName.x, y: rowName.y, button: 'right', clickCount: 1 });
      await s.waitFor(`!!document.querySelector('.row-menu')`, 'the row menu', 5000);
      await s.waitFor(`(() => { const b = [...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Review changes'); return !!b && (b.disabled || !!b.querySelector('.menu-hint')); })()`, 'the item settled', 5000).catch(() => {});
      const offered = await s.evalJs(`(() => { const b = [...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Review changes'); return b ? !b.disabled : false; })()`);
      if (offered) {
        await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Review changes').click()`);
        await s.waitFor(`document.querySelector('.review-tab')?.dataset.state === 'ready'`, 'the review tab', 10000);
        if (await s.evalJs(`!!document.querySelector('.review-file')`)) {
          await s.waitFor(`!!document.querySelector('.review-editor')?.emeraldDiff?.getModel()`, 'the diff', 10000);
          await sleep(600);
          const p = await s.evalJs(
            `(() => { const m = document.querySelector('.review-editor').emeraldDiff.getModifiedEditor(); const r = m.getDomNode().getBoundingClientRect(); const pos = m.getScrolledVisiblePosition({ lineNumber: 1, column: 1 }); const li = m.getLayoutInfo(); return { x: r.left + li.glyphMarginLeft + li.glyphMarginWidth / 2, y: r.top + pos.top + pos.height / 2 }; })()`,
          );
          await s.click(p.x, p.y);
          await s.waitFor(`document.activeElement?.className === 'review-comment-input'`, 'the comment box', 5000).catch(() => {});
          await s.type('this is where the reviewer says why');
        }
        await sleep(800);
        await clip('review-tab', '.app-center');
        await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-close')?.click()`);
        await sleep(300);
      } else {
        await s.key('Escape', 'Escape', 27);
        step("no changes in the first session's folder, no review clip");
      }
    }
  }

  if (realTurn) {
    await waitState(s2, ['done', 'idle'], 'the real turn ended', 90000);
    // Claude ran inside the shell, so /exit leaves the shell (the row's
    // mark is the shell prompt again, fix 39 and M46) and the shell's own
    // exit ends the session.
    await send(s2, '/exit');
    await s.waitFor(`!!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s2)}] .sidebar-row-main .shell-mark')`, 'Claude exited', 30000);
    // The kind flips on Claude's SessionEnd, a moment before the shell has
    // its prompt back; an exit typed in that gap loses its Enter.
    await sleep(2000);
    await send(s2, 'exit');
    await waitState(s2, ['exited'], 'the shell exited', 15000);
  }
  step(`PASS: ${fs.readdirSync(tourDir).length} clips in ${tourDir}`);
} catch (err) {
  console.error('[verify] FAIL', err);
  try {
    await s.screenshot('tour-fail.png');
  } catch {
    // The window may be gone.
  }
  console.error(s.logs.join(''));
  process.exitCode = 1;
} finally {
  await s.close();
  killTree(s.child);
  stopDaemon();
  process.exit();
}
