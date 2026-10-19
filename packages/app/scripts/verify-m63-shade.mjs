// M63 acceptance: the shade. A click on the title's shade button puts one
// calm face over the pane, the session's mark, name, state, spend and
// figures at a size for across the room (a lid since M9 fix 372, with
// the checklist as its rule and the team as a grid), with the terminal
// hidden and still mounted; a click on the face lifts it and the keyboard is back
// in the terminal; the shade is back after a renderer reload. Shade all
// on a layout tab's menu shades every pane of the tab, a click lifts one
// and Lift all lifts the rest. With emerald.shadeAfter set to a fraction of
// a minute, the unfocused pane on a finished session shades by itself
// on the tick while the focused one does not, and a keystroke into it
// lifts it and holds it up. Uses a private home and pipe unless the
// environment already names them.
// Run: npm run verify:shade -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MARK_STEPPING } from './mark-step.mjs';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm63-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m63';
const { CTRL, SHIFT, clickNewShell, expect, freshPort, getLayout, hoverForCard, killTree, launch, leaves, sleep, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 200 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 200000);

const home = os.homedir();
const s = await launch(freshPort(), { freshState: true });
app = s;

const paneSel = (paneId) => `[data-pane-id=${JSON.stringify(paneId)}]`;
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => s.evalJs(`${q(sel)}?.textContent ?? null`);
const has = (sel) => s.evalJs(`!!${q(sel)}`);
const count = (sel) => s.evalJs(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const click = (sel) => s.evalJs(`(() => { const el = ${q(sel)}; if (!el) return false; el.click(); return true; })()`);
const rightClick = (sel) => s.evalJs(`(() => { const el = ${q(sel)}; if (!el) return false; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); return true; })()`);
const menuItem = (label) => s.evalJs(`(() => { const items = [...document.querySelectorAll('.menu-item')]; const it = items.find((i) => i.textContent.trim().startsWith(${JSON.stringify(label)})); if (!it) return false; it.click(); return true; })()`);
const hostVisibility = (paneId) => s.evalJs(`(() => { const h = ${q(paneSel(paneId) + ' .term-host')}; return h ? getComputedStyle(h).visibility : null; })()`);
// A real press and release at the element's centre, for the focus a
// synthetic click() does not carry (the pane focuses on mousedown).
const realClick = async (sel) => {
  const c = await s.evalJs(`(() => { const r = ${q(sel)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(c.x, c.y);
  return true;
};
const activeIn = (sel) => s.evalJs(`(() => { const el = ${q(sel)}; return !!el && el.contains(document.activeElement); })()`);
const shadeOf = (paneId) =>
  s.evalJs(
    `(() => { const sh = ${q(paneSel(paneId) + ' .pane-shade')}; if (!sh) return null; return { name: sh.querySelector('.pane-shade-name')?.textContent ?? null, state: sh.querySelector('.pane-shade-state')?.textContent ?? null, context: sh.querySelector('.pane-shade-context')?.textContent ?? null, auto: sh.dataset.auto === 'true', markSize: sh.querySelector('.session-mark, .shell-mark')?.dataset.size ?? null }; })()`,
  );
const titleOf = (paneId) =>
  s.evalJs(
    `(() => { const t = ${q(paneSel(paneId) + ' .pane-title')}; return { name: t.querySelector('.pane-name')?.textContent ?? null, state: t.querySelector('.pane-state')?.textContent ?? null, context: t.querySelector('.pane-context')?.textContent ?? null }; })()`,
  );

try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await clickNewShell(s, home);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'a shell in the first pane');
  let layout = await getLayout(s);
  const p1 = leaves(layout)[0].id;
  const s1 = leaves(layout)[0].sessionId;
  const daemon = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const post = async (sessionId, payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
      body: JSON.stringify({ session_id: `sim-${sessionId.slice(0, 8)}`, cwd: 'C:/sim', ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  const rowState = (sessionId) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(sessionId)}]')?.dataset.state ?? null`);
  const waitState = async (sessionId, states, what) => {
    const until = Date.now() + 10000;
    while (Date.now() < until && !states.includes(await rowState(sessionId))) await sleep(200);
    expect(states.includes(await rowState(sessionId)), `${what}, got ${await rowState(sessionId)}`);
  };
  // The shell plays a Claude session with a finished turn and a context
  // reading, so the face has a state word and a model to show.
  await post(s1, { hook_event_name: 'SessionStart', source: 'startup' });
  await post(s1, { hook_event_name: 'UserPromptSubmit', prompt: 'shade the pane' });
  await post(s1, { hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 37, context_window_size: 200000 } });
  await post(s1, { hook_event_name: 'Stop', last_assistant_message: 'shaded' });
  await waitState(s1, ['done'], 'the session finished its turn');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-context')}`, 'the title shows the context reading');

  // 1. The button pulls the shade: the face carries the title's parts, the
  // terminal is hidden and still there, the keyboard is on the shade.
  expect(await click(paneSel(p1) + ' .pane-shade-toggle'), 'the title has a shade button');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade')}`, 'the shade is over the pane');
  const face = await shadeOf(p1);
  const title = await titleOf(p1);
  expect(face.name === title.name && face.name !== null, `the face names the session (${face.name} vs ${title.name})`);
  expect(face.state === title.state && face.state !== null, `the face's state word is the title's (${face.state} vs ${title.state})`);
  expect(face.context === title.context && face.context !== null, `the face's context reading is the title's (${face.context} vs ${title.context})`);
  expect(face.markSize === 'face', `the mark is at its face size, got ${face.markSize}`);
  expect((await hostVisibility(p1)) === 'hidden', 'the terminal host is hidden');
  expect(await has(paneSel(p1) + ' .term-host'), 'and still in the DOM');
  expect(await s.evalJs(`!!${q(paneSel(p1) + ' .term-host')}?.emeraldTerm`), 'with its xterm still attached');
  expect(await activeIn(paneSel(p1) + ' .pane-shade'), 'the keyboard is on the shade, not the hidden terminal');
  expect(await s.evalJs(`${q(paneSel(p1))}.dataset.shaded === 'true'`), 'the pane carries data-shaded');
  expect(await s.evalJs(`${q(paneSel(p1) + ' .pane-shade-toggle')}.dataset.shaded === 'true'`), 'the button is lit');
  step(`shaded: the face reads ${face.name} / ${face.state} / ${face.context}`);

  // 2. A click on the face lifts it and the keyboard is back in the terminal.
  expect(await click(paneSel(p1) + ' .pane-shade'), 'click on the face');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')}`, 'the shade lifted');
  expect((await hostVisibility(p1)) === 'visible', 'the terminal is visible again');
  await s.waitFor(`${q(paneSel(p1) + ' .term-host')}.contains(document.activeElement)`, 'the keyboard is back in the terminal');
  step('a click lifted the shade and focused the terminal');

  // 3. A key on the shade lifts it too, spent on the lift: nothing reaches
  // the PTY. Then the shade survives a renderer reload.
  expect(await click(paneSel(p1) + ' .pane-shade-toggle'), 'shade again');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade')} && ${q(paneSel(p1) + ' .pane-shade')}.contains(document.activeElement)`, 'shaded with the keyboard on the shade');
  await s.key('x', 'KeyX', 88);
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')}`, 'a key lifted the shade');
  await sleep(300);
  const screen = await zreq(s, 'pty.screen', { sessionId: s1 });
  expect(!screen.rows.some((r) => /^\s*x\s*$/.test(r) || r.endsWith('> x')), 'the key was not typed into the shell');
  expect(await click(paneSel(p1) + ' .pane-shade-toggle'), 'shade a third time');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade')}`, 'shaded');
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body') && document.querySelectorAll('.term-host').length === 1`, 'the app after the reload');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade')}`, 'the shade is back after the reload');
  const after = { face: (await shadeOf(p1)).name, title: (await titleOf(p1)).name };
  expect(after.face === after.title && after.face !== null, `with the face naming the session as the title does (${after.face} vs ${after.title})`);
  step('a key lifts the shade without typing; the shade survives a reload');
  expect(await click(paneSel(p1) + ' .pane-shade'), 'lift it for the next steps');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')}`, 'lifted');

  // 3b. M9 fix 149: a shaded working pane's stepping mark stayed on show
  // under a file tab, its frame animation flipping visibility back on
  // and the shade's z-index climbing over the file view. Whether an
  // animation advances under the harness depends on where the window
  // sits, so the steps read what is set, not what is painted: the mark
  // steps on the root's frame while the panes are on show (fix 767: no
  // animation of its own), every span is hidden under the day opened as
  // a tab (the guard was written for an animation lifting a frame's
  // visibility; nothing can now, and the read stays to say no rule
  // does), and it steps again once the tab closes; and the file view is
  // what a hit at the mark's centre finds.
  const frameSel = paneSel(p1) + ' .pane-shade .session-mark-frames > span';
  const frames = () =>
    s.evalJs(
      `[...document.querySelectorAll(${JSON.stringify(frameSel)})].map((f) => ({ visibility: getComputedStyle(f).visibility }))`,
    );
  const markSteps = () => s.evalJs(`(${MARK_STEPPING})(${q(paneSel(p1) + ' .pane-shade .session-mark')})`);
  const atMark = () =>
    s.evalJs(
      `(() => { const m = ${q(paneSel(p1) + ' .pane-shade .session-mark')}; const r = m.getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (!el) return null; return el.closest('.file-view') ? 'file-view' : el.closest('.pane-shade') ? 'shade' : el.className; })()`,
    );
  await post(s1, { hook_event_name: 'UserPromptSubmit', prompt: 'work under the shade' });
  await waitState(s1, ['working'], 'the session is working');
  expect(await click(paneSel(p1) + ' .pane-shade-toggle'), 'shade the working pane');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade .session-mark[data-working]')}`, 'the shade shows the stepping mark');
  const onShow = await frames();
  const onShowSteps = await markSteps();
  expect(onShow.length === 4 && onShowSteps === true, `four frames stepping on show, got ${JSON.stringify(onShow)} stepping ${onShowSteps}`);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`!!document.querySelector('.activity-card .activity-expand')`, "the rail's activity card");
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`!!document.querySelector('.file-view') && document.querySelector('.panes-view').dataset.hidden !== undefined`, 'the day as a tab over the panes');
  // Read across a full second, since a frame's visible quarter is what
  // used to leak.
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    for (const f of await frames()) seen.add(f.visibility);
    await sleep(200);
  }
  expect(seen.size === 1 && seen.has('hidden'), `under the tab every frame is hidden across a second, got ${[...seen].join(', ')}`);
  const hit = await atMark();
  expect(hit === 'file-view', `the file view is what sits at the mark's centre, got ${hit}`);
  expect((await s.evalJs(`getComputedStyle(document.querySelector('.panes-view')).isolation`)) === 'isolate', 'the panes view is its own stacking context');
  await s.evalJs(`document.querySelector('.tab.tab-file[data-active] .tab-close').click()`);
  await s.waitFor(`!document.querySelector('.file-view') && document.querySelector('.panes-view').dataset.hidden === undefined`, 'the panes back on show');
  const back = await markSteps();
  expect(back === true, `the frames step again once the tab is closed, got ${JSON.stringify(back)}`);
  const hitBack = await atMark();
  expect(hitBack === 'shade', `the shade is back under the pointer, got ${hitBack}`);
  step('fix 149: under a file tab the shade frames are hidden and still, the file view takes the hit; both back on close');
  await post(s1, { hook_event_name: 'Stop', last_assistant_message: 'shaded' });
  await waitState(s1, ['done'], 'the session finished again');
  expect(await click(paneSel(p1) + ' .pane-shade'), 'lift it for the next steps');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')}`, 'lifted');

  // 2b. M9 fix 154, 205 and 209, as the lid draws them since fix 372: a
  // status line with counts and Claude Code's cost block lands on the
  // session, and the face carries the spend as the hero's largest
  // figure in --cost over its caption ("at API rates, subagents
  // included", wrapping under the figure), then one 13px line in the
  // muted tone with the context reading, the sent and received counts
  // (the arrows as marks, fix 155), the cached share as a percent of
  // what was sent and the age; every part narrower than the face. A
  // shell's face (step 4's, with no status line) has no spend and no
  // counts.
  await post(s1, {
    hook_event_name: 'StatusLine',
    model: { id: 'claude-opus-5', display_name: 'Opus 5' },
    context_window: { used_percentage: 37, context_window_size: 200000, total_input_tokens: 113371, current_usage: { input_tokens: 2, output_tokens: 2665, cache_creation_input_tokens: 18518, cache_read_input_tokens: 94849 } },
    cost: { total_cost_usd: 1.4029585 },
  });
  await s.waitFor(`${q(paneSel(p1) + ' .pane-title .pane-tokens')} !== null`, 'the title carries the tokens');
  // M9 fix 434: a real press (not the synthetic click() the rest of this
  // script uses) so the session's still-armed done pulse from the top of
  // the script is acknowledged; otherwise shadeWait keeps the line's age
  // given up to the new done row (fix 434) through this whole block. A
  // real press is also fix 30's "recent input" for ten seconds
  // (RECENT_INPUT_MS, attention-model.ts), which would ack this
  // ackable, focused pane straight to idle on its very next done
  // arrival, the fix 396 section's Stop a few seconds below; the sleep
  // lets that window run out first so the state read there is done, not
  // idle.
  expect(await realClick(paneSel(p1) + ' .pane-shade-toggle'), 'shade the counted pane');
  await s.pastRecentInput();
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade-spend')}`, 'the spend is on the face');
  const readBlock = () =>
    s.evalJs(
      `(() => { const face = ${q(paneSel(p1) + ' .pane-shade-face')}; const fw = face.getBoundingClientRect().width; const size = (el) => parseFloat(getComputedStyle(el).fontSize); const spend = face.querySelector('.pane-shade-spend'); const fig = spend.querySelector('.pane-shade-figure'); const word = spend.querySelector('.pane-shade-figure-word'); const line = face.querySelector('.pane-shade-line'); const parts = [...line.children]; return { spend: fig.textContent, caption: word.textContent, line: parts.map((el) => el.textContent), fits: [spend, ...parts].every((el) => el.getBoundingClientRect().width <= fw + 0.5), faceWidth: fw, spendSize: size(fig), captionSize: size(word), lineSize: size(line), spendColor: getComputedStyle(fig).color, lineColor: getComputedStyle(line).color, costToken: getComputedStyle(document.documentElement).getPropertyValue('--cost').trim(), mutedToken: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(), captionLines: Math.round(word.getBoundingClientRect().height / parseFloat(getComputedStyle(word).lineHeight)), captionWidth: word.getBoundingClientRect().width, lineTop: Math.round(line.getBoundingClientRect().top), spendBottom: Math.round(spend.getBoundingClientRect().bottom) }; })()`,
    );
  const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  // A frame the user looks at is overwritten on every run, and twice a
  // run failed opening it (UNKNOWN on open) while something else, a
  // viewer or a scanner, held the old file for a moment; retry briefly.
  const frame = async (name) => {
    for (let i = 0; ; i++) {
      try {
        return await s.screenshot(name);
      } catch (err) {
        if (i >= 10) throw err;
        await sleep(500);
      }
    }
  };
  const stack = await readBlock();
  expect(stack.spend === '$1.40' && stack.caption === 'at API rates, subagents included', `the spend and its caption, got ${JSON.stringify(stack)}`);
  expect(JSON.stringify(stack.line) === JSON.stringify(['Opus 5 · 37%', '\u2191113.4k \u21932.7k', '84% cached']) || JSON.stringify(stack.line) === JSON.stringify(['Opus 5 · 37%', '\u2191113.4k \u21932.7k', '84% cached', stack.line[3]]), `the line reads the context, the counts and the cached share, then the age, got ${JSON.stringify(stack.line)}`);
  expect(stack.line.length === 4 && /^\d+[smh]$/.test(stack.line[3]), `the age last on the line, got ${JSON.stringify(stack.line)}`);
  expect(stack.fits && stack.lineTop >= stack.spendBottom, `each part fits the ${Math.round(stack.faceWidth)}px face and the line sits under the spend, got ${JSON.stringify(stack)}`);
  expect(stack.spendSize === 26 && stack.captionSize === 12 && stack.lineSize === 13, `the spend at 26px over a 12px caption, the line at 13px, got ${stack.spendSize}, ${stack.captionSize}, ${stack.lineSize}`);
  expect(hex(stack.spendColor) === stack.costToken && hex(stack.lineColor) === stack.mutedToken, `the spend in --cost (${stack.costToken}) and the line in --muted (${stack.mutedToken}), got ${stack.spendColor} and ${stack.lineColor}`);
  expect(stack.captionLines === 1 && stack.captionWidth <= stack.faceWidth + 0.5, `the caption on one line under a wide pane, got ${stack.captionLines} lines at ${Math.round(stack.captionWidth)}px`);
  await frame('m9-fix205-shade.png');
  await frame('m9-fix209-shade.png');
  step('fix 154, 205 and 209 on the lid (fix 372): the spend largest in its own colour with "at API rates, subagents included" as its caption, the counts, the cached share and the age on one muted line under it');

  // 2b'. M9 fix 235: the figures roll like an odometer. A status line
  // with a higher output on the same split (the reducer replaces the
  // request's last output, so 2665 to 2865 moves received from 2.7k to
  // 2.9k) and a higher cost lands, and at the moment the face changes
  // the changed slots carry data-move="roll" with the old digit in
  // data-from, the still ones carry nothing, and the figures' text is
  // already the new figure whole, with no drum of digits in the DOM
  // (one slot per character). The read is taken inside the page by a
  // MutationObserver, since the roll settles after 300ms and a second
  // round trip could miss it. After the settle no slot carries a move,
  // and the block's size and colour reads are what they were.
  // The observer is installed by one awaited evaluate and its promise
  // collected by a second, so the status line cannot land before it
  // watches (an unawaited install lost the race once on the lid).
  await s.evalJs(
    `window.__roll235 = new Promise((resolve, reject) => { const face = ${q(paneSel(p1) + ' .pane-shade-face')}; const timer = setTimeout(() => { obs.disconnect(); reject(new Error('no figure change within 10s')); }, 10000); const obs = new MutationObserver(() => { const received = face.querySelector('.pane-shade-received'); if (!received || !received.textContent.startsWith('\u21932.9k')) return; clearTimeout(timer); obs.disconnect(); const slots = (l) => [...l.querySelectorAll('.figure-slot')].map((e) => ({ text: e.textContent, move: e.dataset.move ?? null, from: e.dataset.from ?? null })); resolve({ spend: face.querySelector('.pane-shade-spend .pane-shade-figure').textContent, received: slots(received), cost: slots(face.querySelector('.pane-shade-spend .pane-shade-figure')), sent: slots(face.querySelector('.pane-shade-sent')) }); }); obs.observe(face, { subtree: true, childList: true, characterData: true, attributes: true }); }); true`,
  );
  const rolled = s.evalJs(`window.__roll235`);
  await post(s1, {
    hook_event_name: 'StatusLine',
    model: { id: 'claude-opus-5', display_name: 'Opus 5' },
    context_window: { used_percentage: 37, context_window_size: 200000, total_input_tokens: 113371, current_usage: { input_tokens: 2, output_tokens: 2865, cache_creation_input_tokens: 18518, cache_read_input_tokens: 94849 } },
    cost: { total_cost_usd: 1.52 },
  });
  const roll = await rolled;
  expect(roll.spend === '$1.52', `the spend reads the new figure whole the moment it changes, got ${JSON.stringify(roll.spend)}`);
  expect(roll.received.map((x) => x.text).join('') === '2.9k' && roll.received.length === 4, `one slot per character of the received figure, got ${JSON.stringify(roll.received)}`);
  expect(roll.received.map((x) => x.move).join(',') === ',,roll,' && roll.received[2].from === '7', `the received figure's changed digit rolls from 7 and the rest are still, got ${JSON.stringify(roll.received)}`);
  expect(roll.cost.map((x) => x.text).join('') === '$1.52' && roll.cost.map((x) => x.move).join(',') === ',,,roll,roll' && roll.cost[3].from === '4' && roll.cost[4].from === '0', `the cost's two changed digits roll together from 4 and 0, got ${JSON.stringify(roll.cost)}`);
  expect(roll.sent.every((x) => x.move === null && x.from === null), `the unchanged sent figure has no moving slot, got ${JSON.stringify(roll.sent)}`);
  await s.waitFor(`${q(paneSel(p1) + ' .pane-shade-face')}.querySelectorAll('.figure-slot[data-move]').length === 0`, 'the roll settled');
  const settled = await readBlock();
  expect(settled.spend === '$1.52' && settled.line[1] === '\u2191113.4k \u21932.9k' && settled.fits && settled.spendSize === stack.spendSize && settled.lineSize === stack.lineSize && settled.spendColor === stack.spendColor, `after the settle the block reads as before the roll (sizes, colour, fits), got ${JSON.stringify(settled)}`);
  // The frame: the roll slowed to six seconds through the root's
  // --figure-roll-ms, which the component reads for its settle too, a
  // third status line carrying 2.9k to 3.1k and $1.52 to $1.60 (two
  // digits each), every slot animation paused at its midpoint through
  // the Web Animations API (the frame only; nothing under test reads
  // it), and the face clipped at three times its size: each rolling
  // slot shows the lower half of its old digit over the upper half of
  // the new. The animations are then run out and the property removed.
  await s.evalJs(`document.documentElement.style.setProperty('--figure-roll-ms', '6s')`);
  await post(s1, {
    hook_event_name: 'StatusLine',
    model: { id: 'claude-opus-5', display_name: 'Opus 5' },
    context_window: { used_percentage: 37, context_window_size: 200000, total_input_tokens: 113371, current_usage: { input_tokens: 2, output_tokens: 3100, cache_creation_input_tokens: 18518, cache_read_input_tokens: 94849 } },
    cost: { total_cost_usd: 1.6 },
  });
  await s.waitFor(`${q(paneSel(p1) + ' .pane-shade-face')}.querySelectorAll('.figure-slot[data-move="roll"]').length === 4`, 'the slow roll started on four digits');
  const paused = await s.evalJs(`(() => { const anims = ${q(paneSel(p1) + ' .pane-shade-face')}.getAnimations({ subtree: true }).filter((a) => /^figure-/.test(a.animationName)); for (const a of anims) { a.pause(); a.currentTime = 3000; } return anims.length; })()`);
  expect(paused === 8, `eight slot animations paused at the midpoint (four digits out, four in), got ${paused}`);
  await sleep(200);
  const box = await s.evalJs(`(() => { const r = ${q(paneSel(p1) + ' .pane-shade-face')}.getBoundingClientRect(); return { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: r.height + 16 }; })()`);
  const shot = await s.send('Page.captureScreenshot', { format: 'png', clip: { ...box, scale: 3 } });
  const shotFile = path.join(os.tmpdir(), 'emerald-verify', 'odometer-235.png');
  try {
    fs.writeFileSync(shotFile, Buffer.from(shot.data, 'base64'));
  } catch {
    fs.writeFileSync(shotFile.replace(/\.png$/, `-${Date.now()}.png`), Buffer.from(shot.data, 'base64'));
  }
  await s.evalJs(`(() => { for (const a of ${q(paneSel(p1) + ' .pane-shade-face')}.getAnimations({ subtree: true })) a.finish(); document.documentElement.style.removeProperty('--figure-roll-ms'); })()`);
  step("fix 235: a higher count rolls the changed digits of the face's figures like an odometer (data-from on the changed slots, the rest still, the text whole at once) and the block reads as before once settled; the slow frame is odometer-235.png");
  expect(await click(paneSel(p1) + ' .pane-shade'), 'lift the shade again');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')}`, 'the shade lifted');

  // M9 fix 231: the face's live wait. While the session is at
  // needs-input the face carries how long it has waited on the person,
  // the figure in the waiting tone over its word, on a line of its own
  // beside the cost and not one of the fix 154 token lines, so the block
  // keeps its four; it goes when the session is answered.
  await post(s1, { hook_event_name: 'UserPromptSubmit', prompt: 'ask me something' });
  await post(s1, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s1)}]')?.dataset.state === 'needs-input'`, 'the session needs input');
  expect(await click(paneSel(p1) + ' .pane-shade-toggle'), 'shade the asking pane');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade-wait')}`, 'the live wait on the face');
  const blockedRgb = await s.evalJs(`(() => { const el = document.createElement('i'); el.style.color = 'var(--blocked)'; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; })()`);
  const wait231 = await s.evalJs(
    `(() => { const face = ${q(paneSel(p1) + ' .pane-shade-face')}; const w = face.querySelector('.pane-shade-wait'); const fig = w.querySelector('.pane-shade-figure'); return { text: w.textContent, ms: Number(w.dataset.ms), color: getComputedStyle(fig).color, size: parseFloat(getComputedStyle(fig).fontSize), lineParts: face.querySelector('.pane-shade-line').children.length, afterCost: w.previousElementSibling?.classList.contains('pane-shade-spend') ?? false, beforeLine: w.nextElementSibling?.classList.contains('pane-shade-line') ?? false }; })()`,
  );
  expect(/^\d+s$/.test(wait231.text) && wait231.ms < 60_000 && wait231.color === blockedRgb && wait231.size === 20 && wait231.lineParts === 3 && wait231.afterCost && wait231.beforeLine, `the face reads the seconds waited alone (no word, fix 490; the hero says waiting) in --blocked, between the spend and the line, and the line is three parts with its age given up to the row (fix 396) (${JSON.stringify(wait231)})`);
  // M9 fix 396: one clock on the face. The row above and the line's age
  // read the same stateSince, so while the row shows the line has no
  // age at all; it comes back the moment the session is answered.
  expect(await s.evalJs(`${q(paneSel(p1) + ' .pane-shade-face')}.querySelector('.pane-shade-age') === null`), 'no age on the line while the wait row counts the same state');
  await frame('m9-fix231-shade-wait.png');
  await post(s1, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: {} });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s1)}]')?.dataset.state === 'working'`, 'the session answered');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade-wait')}`, 'the wait gone from the face once answered');
  const answered396 = await s.evalJs(
    `(() => { const face = ${q(paneSel(p1) + ' .pane-shade-face')}; const age = face.querySelector('.pane-shade-age'); return { age: age?.textContent ?? null, lineParts: face.querySelector('.pane-shade-line').children.length }; })()`,
  );
  expect(answered396.age !== null && /^\d+s$/.test(answered396.age) && answered396.lineParts === 4, `the line's age is back once the wait row goes, its four parts with it (${JSON.stringify(answered396)})`);
  step("fix 396: the lid runs one clock on a waiting session; the line gives its age up to the wait row and takes it back once the session is answered");
  await post(s1, { hook_event_name: 'Stop', last_assistant_message: 'shaded' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s1)}]')?.dataset.state === 'done'`, 'the session done again');
  expect(await click(paneSel(p1) + ' .pane-shade'), 'lift the shade after the wait');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')}`, 'the shade lifted after the wait');
  step('M9 fix 231: the shade face carries the live wait while the session asks, in the waiting tone, and drops it once answered');

  // 2c. The tiers (fix 372, after fix 205's narrow form): the counted
  // pane at a quarter of the row is under the 360px break, where the
  // mark is a 40px cell, the name 32px and the line wraps to more than
  // one row; at the full row it is the mid tier, a 48px cell and a 42px
  // name (the wide tier, from 760px, is read in the team step below).
  // The second shell of step 4 is spawned here and the layout put back
  // to the one pane after.
  const tierRead = () =>
    s.evalJs(
      `(() => { const face = ${q(paneSel(p1) + ' .pane-shade-face')}; const size = (el) => parseFloat(getComputedStyle(el).fontSize); const mark = face.querySelector('.session-mark[data-size="face"]'); const line = face.querySelector('.pane-shade-line'); const rows = new Set([...line.children].map((el) => Math.round(el.getBoundingClientRect().top))).size; return { mark: Math.round(mark.getBoundingClientRect().width), glyph: size(mark.querySelector('.session-mark-frames > span')), name: size(face.querySelector('.pane-shade-name')), step: face.querySelector('.pane-shade-name').dataset.step, lineRows: rows, faceWidth: Math.round(face.getBoundingClientRect().width), paneWidth: Math.round(${q(paneSel(p1))}.getBoundingClientRect().width) }; })()`,
    );
  expect(await click(paneSel(p1) + ' .pane-shade-toggle'), 'shade the wide pane for the tier read');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade-spend')}`, 'the lid');
  const mid = await tierRead();
  expect(mid.paneWidth >= 360 && mid.paneWidth < 760 && mid.mark === 48 && mid.glyph === 44 && mid.name === 42 && mid.step === '1', `the mid tier at ${mid.paneWidth}px: a 48px mark cell with a 44px glyph and a 42px name for a short name, got ${JSON.stringify(mid)}`);
  expect(await click(paneSel(p1) + ' .pane-shade'), 'lift');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')}`, 'lifted');
  const { session: two } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 80, rows: 24 });
  layout = await getLayout(s);
  const onePane = layout.root;
  await zreq(s, 'layout.set', { layout: { ...layout, root: { kind: 'split', id: 'm63-narrow', direction: 'row', ratio: 0.25, first: layout.root, second: { kind: 'pane', id: 'm63-p2', sessionId: two.id, view: null } } } });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'two panes, the counted one narrow');
  expect(await click(paneSel(p1) + ' .pane-shade-toggle'), 'shade the narrow pane');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade-spend')}`, 'the lid on the narrow face');
  const narrow = await tierRead();
  expect(narrow.paneWidth < 360, `the pane is narrower than the break, got ${narrow.paneWidth}px`);
  expect(narrow.mark === 40 && narrow.glyph === 36 && narrow.name === 32 && narrow.lineRows >= 2 && narrow.faceWidth === narrow.paneWidth - 32, `the narrow tier: a 40px mark cell with a 36px glyph, a 32px name, the line wrapped, the face the pane less 32px, got ${JSON.stringify(narrow)}`);
  await frame('m9-fix205-shade-narrow.png');
  step('fix 372: the tiers, a 48px mark and a 42px name at the mid tier, 40 and 32 under 360px with the line wrapped');

  // M9 fix 397: the fix 247 wait overlay drew in the pane's top right
  // over the lid, where on a narrow pane it met the hero's name. With
  // the shade down the counter is the lid's own wait row instead, in the
  // face's column under the hero, carrying the same hush button with the
  // same handler; nothing draws over the lid. The narrow shaded pane of
  // the tier read above is the pane this is read on.
  await post(s1, { hook_event_name: 'UserPromptSubmit', prompt: 'ask me again' });
  await post(s1, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} });
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade-wait')}`, "the lid's wait row on the narrow shaded pane");
  const lidWait = await s.evalJs(
    `(() => { const pane = ${q(paneSel(p1))}; const sh = pane.querySelector('.pane-shade'); const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }; }; const wait = sh.querySelector('.pane-shade-wait'); const hush = wait.querySelector('[data-action="hush"]'); return { overlays: pane.querySelectorAll('.wait-overlay').length, inFace: sh.querySelector('.pane-shade-face').contains(wait), text: wait.textContent, hushInWait: hush !== null, hushed: hush?.dataset.hushed ?? null, name: rect(sh.querySelector('.pane-shade-name')), waitBox: rect(wait), face: rect(sh.querySelector('.pane-shade-face')) }; })()`,
  );
  expect(lidWait.overlays === 0, `no wait overlay is drawn over the lid, got ${lidWait.overlays}`);
  expect(lidWait.inFace && /^\d+s$/.test(lidWait.text) && lidWait.hushInWait, `the counter and the hush button are part of the face's wait row, got ${JSON.stringify({ inFace: lidWait.inFace, text: lidWait.text, hushInWait: lidWait.hushInWait })}`);
  expect(lidWait.waitBox.y >= lidWait.name.bottom && lidWait.waitBox.right <= lidWait.face.right, `the wait row sits under the hero's name inside the face rather than over it, got ${JSON.stringify({ name: lidWait.name, waitBox: lidWait.waitBox, face: lidWait.face })}`);
  await frame('m9-397-lid-wait-narrow.png');
  // Hushing from the lid is hushing, and does not lift the shade.
  expect(lidWait.hushed === null, `the session is not hushed before the click, got ${JSON.stringify(lidWait.hushed)}`);
  expect(await click(paneSel(p1) + ' .pane-shade-wait [data-action="hush"]'), 'hush from the lid');
  await s.waitFor(`${q(paneSel(p1) + ' .pane-shade-wait [data-action="hush"]')}?.dataset.hushed === 'true'`, 'the session reads hushed from the lid');
  expect(await s.evalJs(`!!${q(paneSel(p1) + ' .pane-shade')}`), 'the hush click did not lift the shade');
  expect(await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s1)}] [data-action="hush"]')?.dataset.hushed === 'true'`), "the row's own hush button agrees, so it is the one state");
  expect(await click(paneSel(p1) + ' .pane-shade-wait [data-action="hush"]'), 'let the chime through again');
  await s.waitFor(`${q(paneSel(p1) + ' .pane-shade-wait [data-action="hush"]')}?.dataset.hushed === undefined`, 'unhushed from the lid');
  await post(s1, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: {} });
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade-wait')}`, 'the wait row gone once answered');
  // An unshaded pane keeps the overlay exactly as it was (verify:attention is its spec).
  expect(await click(paneSel(p1) + ' .pane-shade'), 'lift the narrow shade');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')}`, 'lifted');
  await post(s1, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} });
  await s.waitFor(`!!${q(paneSel(p1) + ' .wait-overlay')}`, 'the overlay is back on the lifted pane');
  await post(s1, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: {} });
  await s.waitFor(`!${q(paneSel(p1) + ' .wait-overlay')}`, 'the overlay goes with the ask');
  // The session goes back to where this step found it: done and resting,
  // which the idle-shade step below needs of the first pane.
  await post(s1, { hook_event_name: 'Stop', last_assistant_message: 'shaded' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s1)}]')?.dataset.state === 'done'`, 'the first session is done again, as the step found it');
  step("fix 397: while the pane is shaded the wait counter and its hush button are part of the lid's face under the hero, no overlay is drawn over the lid, hushing from there is hushing and does not lift the shade, and a lifted pane has its overlay back");

  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, root: onePane } });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'the one pane back');

  // 4. Shade all on the layout tab's menu shades every pane of the tab (a
  // tab of three, two more shells set straight into the layout), a click
  // lifts one, Lift all lifts the rest; the same pair on the button's
  // right-click.
  const { session: three } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 80, rows: 24 });
  layout = await getLayout(s);
  await zreq(s, 'layout.set', {
    layout: {
      ...layout,
      root: {
        kind: 'split',
        id: 'm63-split',
        direction: 'row',
        ratio: 0.34,
        first: layout.root,
        second: { kind: 'split', id: 'm63-split-2', direction: 'row', ratio: 0.5, first: { kind: 'pane', id: 'm63-p2', sessionId: two.id, view: null }, second: { kind: 'pane', id: 'm63-p3', sessionId: three.id, view: null } },
      },
    },
  });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 3`, 'three panes');
  expect(await rightClick('.tab.tab-panes[data-current]'), 'right-click the layout tab');
  await s.waitFor(`!!document.querySelector('.layout-tab-menu')`, 'the tab menu');
  // M9 fix 844: the Shade all and Lift all rows show the one chord.
  const shadeHints = (menuSel) => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(menuSel + ' .menu-item')})].filter((b) => ['Shade all', 'Lift all'].includes(b.querySelector('.menu-label')?.textContent ?? '')).map((b) => b.querySelector('.menu-hint')?.textContent ?? null)`);
  const tabHints = await shadeHints('.layout-tab-menu');
  expect(JSON.stringify(tabHints) === JSON.stringify(['Ctrl+Shift+U', 'Ctrl+Shift+U']), `fix 844: the Shade all and Lift all rows show the chord on the tab menu, got ${JSON.stringify(tabHints)}`);
  expect(await menuItem('Shade all'), 'Shade all on the tab menu');
  await s.waitFor(`document.querySelectorAll('.pane-shade').length === 3`, 'every pane of the tab shaded');
  // Fix 154: a shell's face has no spend and no counts, the counted one keeps them.
  expect((await s.evalJs(`[${q(paneSel('m63-p2') + ' .pane-shade-spend')}, ${q(paneSel('m63-p3') + ' .pane-shade-tokens')}, ${q(paneSel(p1) + ' .pane-shade-spend')}, ${q(paneSel(p1) + ' .pane-shade-tokens')}].map((el) => el !== null).join(',')`)) === 'false,false,true,true', 'no spend or counts on a shell face, the counted face keeps them');
  expect(await click(paneSel('m63-p2') + ' .pane-shade'), 'click one face');
  await s.waitFor(`document.querySelectorAll('.pane-shade').length === 2`, 'one lifted, two stay');
  expect(await rightClick('.tab.tab-panes[data-current]'), 'right-click the layout tab again');
  await s.waitFor(`!!document.querySelector('.layout-tab-menu')`, 'the tab menu');
  expect(await menuItem('Lift all'), 'Lift all on the tab menu');
  await s.waitFor(`document.querySelectorAll('.pane-shade').length === 0`, 'every shade lifted');
  expect(await rightClick(paneSel(p1) + ' .pane-shade-toggle'), "right-click the button");
  await s.waitFor(`!!document.querySelector('.shade-menu')`, "the button's menu");
  const shadeMenuItems = await s.evalJs(`[...document.querySelectorAll('.shade-menu .menu-item')].map((b) => b.querySelector('.menu-label').textContent.replace(/^✓/, '') + (b.dataset.checked === 'true' ? ' *' : ''))`);
  expect(shadeMenuItems.join(',') === 'Shade all,Lift all,Shade after idle,Off *,2 min,5 min,15 min,30 min', `the button's menu, got ${JSON.stringify(shadeMenuItems)}`);
  const buttonHints = await shadeHints('.shade-menu');
  expect(JSON.stringify(buttonHints) === JSON.stringify(['Ctrl+Shift+U', 'Ctrl+Shift+U']), `fix 844: the Shade all and Lift all rows show the chord on the button's menu, got ${JSON.stringify(buttonHints)}`);
  expect(await menuItem('Shade all'), "Shade all on the button's menu");
  await s.waitFor(`document.querySelectorAll('.pane-shade').length === 3`, 'three shaded from the button');
  expect(await rightClick(paneSel(p1) + ' .pane-shade-toggle'), 'right-click the button once more');
  await s.waitFor(`!!document.querySelector('.shade-menu')`, "the button's menu");
  expect(await menuItem('Lift all'), "Lift all on the button's menu");
  await s.waitFor(`document.querySelectorAll('.pane-shade').length === 0`, 'all lifted from the button');
  step('Shade all shades three, a click lifts one, Lift all lifts the rest; the same pair on the button');
  // M9 fix 844: the chords, with the keyboard on the first pane.
  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, focusedPaneId: p1 } });
  await s.waitFor(`!!document.activeElement?.closest(${JSON.stringify(paneSel(p1))})`, 'the keyboard in the first pane');
  await s.key('U', 'KeyU', 85, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane-shade').length === 3`, 'Ctrl+Shift+U shaded the three');
  await s.key('U', 'KeyU', 85, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane-shade').length === 0`, 'Ctrl+Shift+U again lifted them');
  await s.key('K', 'KeyK', 75, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane-shade').length === 1 && !!${q(paneSel(p1) + ' .pane-shade')}`, 'Ctrl+Shift+K shaded the focused pane alone');
  await s.key('K', 'KeyK', 75, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane-shade').length === 0`, 'Ctrl+Shift+K again lifted it');
  // The chords acknowledge nothing since fix 873, but the focus set onto
  // the first pane just after the right-clicks may have let the pane take
  // its done session as seen (fix 30, inside the recent-input window); a
  // turn puts it back where this step found it, done and resting, which
  // the idle-shade step and fix 291's face below need of the first pane.
  // A Stop alone leaves
  // an idle session idle, so a turn first, and the Stop waits out the
  // recent-input window (RECENT_INPUT_MS, 10 s), inside which a reply
  // into the focused pane is taken as seen at once (fix 30).
  await post(s1, { hook_event_name: 'UserPromptSubmit', prompt: 'after the chords' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s1)}]')?.dataset.state === 'working'`, 'the first session working again');
  await sleep(10500);
  await post(s1, { hook_event_name: 'Stop', last_assistant_message: 'shaded' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(s1)}]')?.dataset.state === 'done'`, 'the first session is done again after the chords');
  step("fix 844: Ctrl+Shift+U shades the tab's three and lifts them, Ctrl+Shift+K shades the focused pane alone and lifts it");

  // 5. The idle shade. The setting is minutes, and the store takes any
  // positive number, so a twentieth of a minute (three seconds) lets the
  // real tick do the shading in a run rather than a fake clock. Set through
  // storage and a reload, as a person's choice would be read at start.
  // The focused pane is the first, on the done session; the second's shell
  // has been idle since it spawned and shades by itself, the focused one
  // never does; a keystroke into the shaded pane lifts it and holds it up.
  await s.evalJs(`localStorage.setItem('emerald.shadeAfter', '0.05')`);
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.app-body') && document.querySelectorAll('.term-host').length === 3`, 'the app after the reload');
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel(p1))})?.classList.contains('focused')`, 'the first pane focused');
  await s.waitFor(`!!${q(paneSel('m63-p2') + ' .pane-shade[data-auto]')}`, 'the idle pane shaded itself, marked auto', 20000);
  await s.waitFor(`!!${q(paneSel('m63-p3') + ' .pane-shade[data-auto]')}`, 'and the third', 20000);
  expect(!(await has(paneSel(p1) + ' .pane-shade')), 'the focused pane did not shade');
  // A click on the second face lifts it (a person arrived); it stays up
  // past two more ticks since nothing happened in its session since.
  expect(await realClick(paneSel('m63-p2') + ' .pane-shade'), 'click the auto-shaded face');
  await s.waitFor(`!${q(paneSel('m63-p2') + ' .pane-shade')}`, 'lifted');
  await sleep(12000);
  expect(!(await has(paneSel('m63-p2') + ' .pane-shade')), 'the lifted pane stays up while its session rests');
  // Focus is now on the second pane; the first, unfocused, done and untouched
  // for longer than the setting, shades itself in turn.
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade[data-auto]')}`, 'the first pane, unfocused now, shaded itself', 20000);
  // A key into the second pane, typed for real, keeps it up too.
  await s.key('a', 'KeyA', 65);
  await sleep(6000);
  expect(!(await has(paneSel('m63-p2') + ' .pane-shade')), 'a keystroke into the pane holds the shade up');
  step('the idle shade: the unfocused panes shaded themselves, the focused one did not, a lift holds');

  // M9 fix 291, as the lid draws the team since fix 372: one box per
  // member in a grid under the rule, a model word and a status per
  // member, and the face's own text (name, state, spend, the line) must
  // not move for the grid appearing under it. Run after every geometry
  // read of the figures: .pane-shade centres its content, so the grid
  // grows the face and shifts every element's top. The same two
  // SubagentStart events tour.mjs:127 uses (one Explore returned, one
  // fork out), here on s1 rather than tour's pane 3, and with no
  // preceding PreToolUse or PostToolUse Agent call: those name no
  // agent_id yet, so they are the parent's own tool use and would move
  // its state, where SubagentStart and SubagentStop, carrying the
  // agent_id, say nothing about the parent's (state-machine.ts's
  // TEAM_EVENTS). The idle shade step just above already auto-shaded p1
  // (it lost focus to the second pane's real click and key), so the
  // pane is shaded already; toggling the button here would lift it
  // instead. Before the team the grid's place is "working alone" under
  // the plain hairline (no list yet on this session).
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade')}`, 'shaded for fix 291');
  const teamFace = () =>
    s.evalJs(
      `(() => { const face = ${q(paneSel(p1) + ' .pane-shade-face')}; return { name: face.querySelector('.pane-shade-name')?.textContent ?? null, state: face.querySelector('.pane-shade-state')?.textContent ?? null, spend: face.querySelector('.pane-shade-spend')?.textContent ?? null, line: [...face.querySelector('.pane-shade-line').children].slice(0, 3).map((l) => l.textContent), alone: face.querySelector('.pane-shade-alone')?.textContent ?? null, divider: face.querySelector('.pane-shade-divider') !== null, rule: face.querySelector('.pane-shade-rule') !== null }; })()`,
    );
  const beforeTeam = await teamFace();
  // Fix 490: the line reads worked alone on a finished session (this one is done), working alone otherwise.
  expect(beforeTeam.alone === (beforeTeam.state === 'done' ? 'worked alone' : 'working alone') && beforeTeam.divider && !beforeTeam.rule, `with no team and no list the face says working alone under the plain hairline, got ${JSON.stringify(beforeTeam)}`);
  await post(s1, { hook_event_name: 'SubagentStart', agent_id: 'shade-a1', agent_type: 'Explore' });
  await post(s1, { hook_event_name: 'SubagentStart', agent_id: 'shade-a2', agent_type: 'fork' });
  await post(s1, { hook_event_name: 'SubagentStop', agent_id: 'shade-a1', agent_type: 'Explore' });
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(paneSel(p1) + ' .pane-shade-member')}).length === 2`, 'the shade lists both members');
  const memberRead = () =>
    s.evalJs(
      `[...document.querySelectorAll(${JSON.stringify(paneSel(p1) + ' .pane-shade-member')})].map((el) => ({ id: el.dataset.member, kind: el.dataset.kind, type: el.dataset.type ?? null, working: 'working' in el.dataset, name: el.querySelector('.pane-shade-member-name')?.textContent ?? null, state: el.querySelector('.pane-shade-member-state')?.textContent ?? null, model: el.querySelector('.pane-shade-member-model')?.textContent ?? null, kindWord: el.querySelector('.pane-shade-member-type')?.textContent ?? null, price: el.querySelector('.pane-shade-member-price')?.textContent ?? null, stepping: el.querySelector('.session-mark') ? (${MARK_STEPPING})(el.querySelector('.session-mark')) : null, box: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() }))`,
    );
  const teamMembers = await memberRead();
  expect(
    teamMembers.length === 2 && teamMembers[0].kind === 'agent' && !teamMembers[0].working && teamMembers[0].state === 'returned' && teamMembers[1].kind === 'agent' && teamMembers[1].working && teamMembers[1].state === 'working',
    `two members in spawn order, the first returned and the second working, got ${JSON.stringify(teamMembers)}`,
  );
  expect(teamMembers.every((m) => m.model === null && m.price === null), `no model word and no price with no Claude home for the harness, got ${JSON.stringify(teamMembers)}`);
  // Fix 373: a member with no description is named by its type, and the
  // kind word is left off a box named by it already.
  expect(teamMembers[0].name === 'Explore' && teamMembers[0].type === 'Explore' && teamMembers[0].kindWord === null && teamMembers[1].name === 'fork' && teamMembers[1].type === 'fork' && teamMembers[1].kindWord === null, `each box named by its type with data-type and no second word, got ${JSON.stringify(teamMembers)}`);
  expect(teamMembers[1].stepping === true, `the working member's mark steps, got ${JSON.stringify(teamMembers[1].stepping)}`);
  // The pane is a third of the row here (step 4's layout), under the
  // narrow break, so the grid is one column and both boxes show (two is
  // under the fold's four).
  expect(teamMembers[0].box.x === teamMembers[1].box.x && teamMembers[1].box.y > teamMembers[0].box.y && teamMembers.every((m) => m.box.w > 0), `two boxes one under the other in the narrow grid, got ${JSON.stringify(teamMembers.map((m) => m.box))}`);
  const afterTeam = await teamFace();
  expect(JSON.stringify({ ...beforeTeam, alone: null }) === JSON.stringify(afterTeam), `the face's name, state, spend and line are unchanged by the grid, working alone gone, got ${JSON.stringify(beforeTeam)} then ${JSON.stringify(afterTeam)}`);
  await frame('m9-291-shade-team.png');
  expect(await click(paneSel(p1) + ' .pane-shade'), 'lift the shade after fix 291');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')}`, 'lifted after fix 291');
  step("fix 291 on the lid: the team is a grid of boxes under the rule, a model word when known and the right state word per member (returned, working), the rest of the face unmoved");

  // M9 fix 654: the row's activity line on the face, under the state
  // word, and each agent's latest tool call in its box. A new prompt on
  // s1 (which drops the returned shade-a1), a Bash call of the parent's
  // own and a Read of shade-a2's; the face reads what the row reads, and
  // the fork's box and the sidebar's team line read its phrase. Then the
  // fork returns and the turn ends: the face reads the reply, the box
  // keeps its last phrase. The pane is a third of the row here, so the
  // narrow tier, with two boxes or fewer and no fold.
  const rowSel654 = `.sidebar-row[data-session-id=${JSON.stringify(s1)}]`;
  const rowLine654 = () => text(rowSel654 + ' .sidebar-row-agent');
  await post(s1, { hook_event_name: 'UserPromptSubmit', prompt: 'build the lid' });
  await post(s1, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm run build', description: 'Build the lid' } });
  await post(s1, { hook_event_name: 'PreToolUse', agent_id: 'shade-a2', tool_name: 'Read', tool_input: { file_path: 'C:/sim/lid.ts' } });
  await s.waitFor(`${q(rowSel654 + ' .sidebar-row-agent')}?.textContent === 'Build the lid'`, "the row's line reads the Bash call", 5000);
  if (!(await has(paneSel(p1) + ' .pane-shade'))) expect(await click(paneSel(p1) + ' .pane-shade-toggle'), 'shade p1 for fix 654');
  await s.waitFor(`!!${q(paneSel(p1) + ' .pane-shade')}`, 'shaded for fix 654');
  const face654 = () =>
    s.evalJs(
      `(() => { const face = ${q(paneSel(p1) + ' .pane-shade-face')}; if (!face) return null; const a = face.querySelector('.pane-shade-activity'); const fw = face.getBoundingClientRect().width; const member = (id) => { const m = face.querySelector('.pane-shade-member[data-member=' + JSON.stringify(id) + ']'); return m ? { state: m.querySelector('.pane-shade-member-state')?.textContent ?? null, activity: m.querySelector('.pane-shade-member-activity')?.textContent ?? null } : null; }; return { activity: a?.textContent ?? null, shown: !!a && a.getClientRects().length > 0, width: a ? a.getBoundingClientRect().width : null, faceWidth: fw, a2: member('shade-a2'), members: face.querySelectorAll('.pane-shade-member').length }; })()`,
    );
  await s.waitFor(`${q(paneSel(p1) + ' .pane-shade-member[data-member="shade-a2"] .pane-shade-member-activity')}?.textContent === 'Reading lid.ts'`, "the fork's box reads its Read", 5000);
  const working654 = await face654();
  const rowWorking654 = await rowLine654();
  expect(working654.activity === 'Build the lid' && working654.activity === rowWorking654, `the face's activity line is the row's, got ${JSON.stringify(working654)} against the row's ${JSON.stringify(rowWorking654)}`);
  expect(working654.shown && working654.width <= working654.faceWidth, `the activity line is drawn and no wider than the face, got ${JSON.stringify(working654)}`);
  expect(working654.a2?.activity === 'Reading lid.ts' && working654.members === 1, `the fork's box (the returned Explore dropped by the prompt) reads Reading lid.ts, got ${JSON.stringify(working654)}`);
  await frame('m9-654-shade-activity.png');
  expect(await click(rowSel654 + ' .sidebar-row-team-fold'), "unfold the row's team");
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(rowSel654 + ' .sidebar-row-member')}).length === 1`, 'the team listed under the row');
  const teamActivity654 = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(rowSel654 + ' .sidebar-row-member-activity')})].map((e) => e.textContent)`);
  expect(JSON.stringify(teamActivity654) === JSON.stringify(['Reading lid.ts']), `the fork's team line carries its tool call, got ${JSON.stringify(teamActivity654)}`);
  expect(await click(rowSel654 + ' .sidebar-row-team-fold'), "fold the row's team");
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(rowSel654 + ' .sidebar-row-member')}).length === 0`, 'the team folded away');
  step("M9 fix 654: the shade's face carries the row's activity line under the state word, and the fork's box and its team line carry its latest tool call");

  // M9 fix 764: the team line's activity gives way before its task. A
  // second running member with a long task and a long Bash phrase, the
  // team unfolded, and its line read at three sidebar widths: at none may
  // the task be clipped while the activity is still drawn. At 260 and 160
  // the line is short enough that the old proportional shrink already took
  // the activity to nothing; at 400 the old code left both clipped and both
  // drawn. The harness has no Claude home, so no model word is drawn; the
  // canvas reads what a real line's Sonnet word and six characters take.
  // M9 fix 835: the Agent call carries its prompt and the model it
  // resolved, and the member makes two calls before the Bash one, so its
  // card later reads three lines of the prompt, the model and two earlier
  // phrases; the Bash call stays the latest, so fix 764's reads hold.
  await post(s1, { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'Read the sidebar tree and list every member line', subagent_type: 'general-purpose', prompt: 'Read the sidebar tree and list every member line.\n\nStart at Sidebar.tsx and follow the team rows.\nReport the parts of each line in order.\nDo not edit anything.' }, tool_response: { agentId: 'shade-a3', description: 'Read the sidebar tree and list every member line', resolvedModel: 'claude-sonnet-5' } });
  await post(s1, { hook_event_name: 'PreToolUse', agent_id: 'shade-a3', tool_name: 'Read', tool_input: { file_path: 'C:/sim/Sidebar.tsx' } });
  await post(s1, { hook_event_name: 'PreToolUse', agent_id: 'shade-a3', tool_name: 'Grep', tool_input: { pattern: 'sidebar-row-member' } });
  await post(s1, { hook_event_name: 'PreToolUse', agent_id: 'shade-a3', tool_name: 'Bash', tool_input: { command: 'npm run verify:all', description: 'Running the whole verify list on a private pair' } });
  expect(await click(rowSel654 + ' .sidebar-row-team-fold'), "unfold the row's team for fix 764");
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(rowSel654 + ' .sidebar-row-member')}).length === 2`, 'two members listed under the row for fix 764', 5000);
  await s.waitFor(
    `[...document.querySelectorAll(${JSON.stringify(rowSel654 + ' .sidebar-row-member')})].some((m) => m.querySelector('.sidebar-row-member-type')?.textContent === 'agent general-purpose' && m.querySelector('.sidebar-row-member-activity')?.textContent === 'Running the whole verify list on a private pair')`,
    "the new member's line carries its Bash phrase",
    5000,
  );
  const sidebarWidth764 = () => s.evalJs(`document.querySelector('.sidebar').getBoundingClientRect().width`);
  const widths764 = async (W) => {
    const read = await s.evalJs(`(() => {
      const line = [...document.querySelectorAll(${JSON.stringify(rowSel654 + ' .sidebar-row-member')})].find((m) => m.querySelector('.sidebar-row-member-type')?.textContent === 'agent general-purpose');
      if (!line) return null;
      const w = (el) => (el ? el.getBoundingClientRect().width : 0);
      const parts = [line.querySelector('.roster-unit'), line.querySelector('.sidebar-row-member-type'), line.querySelector('.sidebar-row-member-model'), line.querySelector('.sidebar-row-member-elapsed')].filter((el) => el !== null);
      const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
      const task = line.querySelector('.sidebar-row-member-task');
      const activity = line.querySelector('.sidebar-row-member-activity');
      const typeSpan = line.querySelector('.sidebar-row-member-type');
      const c = document.createElement('canvas').getContext('2d');
      c.font = getComputedStyle(typeSpan).font;
      return {
        line: Math.round(w(line)),
        fixed: Math.round(parts.reduce((sum, el) => sum + w(el), 0) + gap * (line.children.length - 1)),
        task: Math.round(w(task)),
        taskNatural: task ? task.scrollWidth : 0,
        activity: Math.round(w(activity)),
        activityNatural: activity ? activity.scrollWidth : 0,
        modelW: Math.round(c.measureText('Sonnet').width),
        sixCh: Math.round(c.measureText('000000').width),
        team: Math.round(w(line.closest('.sidebar-row-team'))),
        elapsedRight: Math.round(line.querySelector('.sidebar-row-member-elapsed').getBoundingClientRect().right),
        lineRight: Math.round(line.getBoundingClientRect().right),
        kindShown: (() => {
          const k = line.querySelector('.sidebar-row-member-kind');
          return k ? getComputedStyle(k).display !== 'none' : null;
        })(),
      };
    })()`);
    expect(read !== null, `fix 764: the general-purpose member's line is listed at ${W}px`);
    console.log(`[verify] fix 764 at ${W}px: line ${read.line} fixed ${read.fixed} task ${read.task}/${read.taskNatural} activity ${read.activity}/${read.activityNatural} model word ${read.modelW} 6ch ${read.sixCh} team width ${read.team} elapsed edge ${read.elapsedRight}/${read.lineRight} kind ${read.kindShown}`);
    expect(!(read.task < read.taskNatural - 1 && read.activity >= 1), `fix 764: at ${W}px the task is clipped while the activity is still drawn, got ${JSON.stringify(read)}`);
    expect(read.elapsedRight <= read.lineRight + 1, `fix 788: at ${W}px the elapsed runs past the line's edge, got ${JSON.stringify(read)}`);
    expect(read.kindShown === (read.team > 200), `fix 788: at ${W}px with a team ${read.team}px wide the word agent should be ${read.team > 200 ? 'shown' : 'hidden'}, got ${read.kindShown}`);
    return read;
  };
  const dragSidebar764 = async (target) => {
    const current = await sidebarWidth764();
    const r = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.mouse('mousePressed', r.x, r.y);
    await s.mouse('mouseReleased', r.x + (target - current), r.y);
    await s.waitFor(`Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - ${target}) <= 1`, `sidebar at ${target}px for fix 764`);
  };
  const start764 = Math.round(await sidebarWidth764());
  if (Math.abs(start764 - 260) > 1) await dragSidebar764(260);
  await widths764(260);
  await dragSidebar764(160);
  await widths764(160);
  await dragSidebar764(400);
  await widths764(400);
  await dragSidebar764(start764);
  expect(await click(rowSel654 + ' .sidebar-row-team-fold'), "fold the row's team after fix 764");
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(rowSel654 + ' .sidebar-row-member')}).length === 0`, 'the team folded away after fix 764');
  await post(s1, { hook_event_name: 'SubagentStop', agent_id: 'shade-a3', agent_type: 'general-purpose' });
  await s.waitFor(`${q(paneSel(p1) + ' .pane-shade-member[data-member="shade-a3"] .pane-shade-member-state')}?.textContent === 'returned'`, 'the general-purpose member returned on the face', 5000);
  step("M9 fix 764: the team line's activity gives way before its task at 260, 160 and 400 px, the widths logged; fix 788: the elapsed whole at each width and the word agent gone under a 200px team");

  await post(s1, { hook_event_name: 'SubagentStop', agent_id: 'shade-a2', agent_type: 'fork' });
  await post(s1, { hook_event_name: 'Stop', last_assistant_message: 'lid built' });
  await waitState(s1, ['done', 'idle'], 'the turn ended for fix 654');
  await s.waitFor(`${q(paneSel(p1) + ' .pane-shade-activity')}?.textContent === 'lid built'`, "the face's line reads the reply", 5000);
  await s.waitFor(`${q(paneSel(p1) + ' .pane-shade-member[data-member="shade-a2"] .pane-shade-member-state')}?.textContent === 'returned'`, 'the fork returned on the face', 5000);
  const done654 = await face654();
  const rowDone654 = await rowLine654();
  expect(done654.activity === 'lid built' && done654.activity === rowDone654 && done654.shown, `after the turn the face reads the reply as the row does, got ${JSON.stringify(done654)} against ${JSON.stringify(rowDone654)}`);
  expect(done654.a2?.state === 'returned' && done654.a2.activity === 'Reading lid.ts', `the returned fork keeps its last phrase, got ${JSON.stringify(done654.a2)}`);
  // M9 fix 835: shade-a3's card says the first three lines it was asked,
  // the model its Agent call resolved (the harness has no Claude home, so
  // no request names one), and its two calls before the latest.
  await hoverForCard(s, paneSel(p1) + ' .pane-shade-member[data-member="shade-a3"] .pane-shade-member-name', '.agent-popover[data-member="shade-a3"]', "shade-a3's card on its box");
  const card835 = await s.evalJs(`(() => { const c = document.querySelector('.agent-popover[data-member="shade-a3"]'); return { prompt: c.querySelector('.agent-card-prompt')?.textContent ?? null, model: c.querySelector('.agent-card-model')?.textContent ?? null, earlier: [...c.querySelectorAll('.agent-card-earlier')].map((e) => e.textContent), activity: c.querySelector('.agent-card-activity')?.textContent ?? null, price: !!c.querySelector('.agent-card-price') }; })()`);
  expect(
    card835.prompt === 'Read the sidebar tree and list every member line.\nStart at Sidebar.tsx and follow the team rows.\nReport the parts of each line in order.' &&
      card835.model === 'Sonnet 5' &&
      JSON.stringify(card835.earlier) === JSON.stringify(['Reading Sidebar.tsx', 'Searching for sidebar-row-member']) &&
      card835.activity === 'Running the whole verify list on a private pair' &&
      !card835.price,
    `fix 835: the card says the first three lines of the prompt, the model resolved before any request and the two calls before the latest, got ${JSON.stringify(card835)}`,
  );
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
  await s.waitFor(`!document.querySelector('.agent-popover')`, "shade-a3's card closes after the mouse leaves");
  step("M9 fix 835: a member's card says the first three lines it was asked, its model off the Agent call before any request, and its two calls before the latest");
  // M9 fix 821: a hover on a member's box opens its card, and a click on the
  // box (the card still open) lifts the shade and takes the card with it.
  await hoverForCard(s, paneSel(p1) + ' .pane-shade-member[data-member="shade-a2"] .pane-shade-member-name', '.agent-popover[data-member="shade-a2"]', "shade-a2's card on its box");
  const card821 = await s.evalJs(`(() => { const c = document.querySelector('.agent-popover[data-member="shade-a2"]'); return { name: c.querySelector('.agent-card-name')?.textContent, role: c.querySelector('.agent-card-role')?.textContent, activity: c.querySelector('.agent-card-activity')?.textContent }; })()`);
  expect(card821.name === 'fork' && card821.role === 'subagent · fork' && card821.activity === 'Reading lid.ts', `fix 821: a hover on a member's box opens its card, got ${JSON.stringify(card821)}`);
  expect(await click(paneSel(p1) + ' .pane-shade-member[data-member="shade-a2"]'), 'click the member box with its card open');
  await s.waitFor(`!${q(paneSel(p1) + ' .pane-shade')} && !document.querySelector('.agent-popover')`, 'lifted after fix 654, by a click on a member box that also closes its card (fix 821)');
  step("M9 fix 654: after the turn the face's line is the reply, the returned fork's box keeps its last tool call");

  // M9 fix 372: a seeded team of six with prices and a checklist, on a
  // fresh shell of its own with a Claude home under the harness's, so
  // the boxes carry model words and prices off the agents' files. Read
  // at the wide tier (the pane alone in the window is past 760px):
  // the hero's split name and its size step, the rule's segment count
  // against total and its lit count against done, the caption, the
  // grid's boxes with their names, model words, kind words (fix 373:
  // on the fork and on the fresh Explore, and not on a box named by its
  // type) and prices, a shell member's ❯, and the hover on the rule
  // opening the list. Then a list with every task done keeps its full
  // bar; then a session with no list shows the hairline. Then the
  // narrow fold: the pane at a quarter of the row shows four boxes and
  // a visible "and 2 more" inside the pane; and a team of twelve at
  // the wide tier is twelve boxes in the tighter columns with no fold.
  layout = await getLayout(s);
  const { session: six } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, name: 'Batch 372: the shade lid and the install path', cols: 80, rows: 24 });
  await zreq(s, 'layout.set', { layout: { ...layout, focusedPaneId: 'm63-six', root: { kind: 'pane', id: 'm63-six', sessionId: six.id, view: null } } });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1 && !!${q(paneSel('m63-six'))}`, 'the six-member session alone on the tab');
  const sixConv = `sim-${six.id.slice(0, 8)}`;
  const postSix = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, { method: 'POST', headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': six.id }, body: JSON.stringify({ session_id: sixConv, cwd: 'C:/sim', ...payload }) });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  // The transcript and the agents' files under the harness's Claude
  // home (cdp.mjs's harnessClaudeHome: EMERALD_CLAUDE_HOME, or claude-home
  // under the home), each agent two requests on its model.
  const claudeHome = process.env['EMERALD_CLAUDE_HOME'] ?? path.join(process.env['EMERALD_HOME'], 'claude-home');
  const projectDir = path.join(claudeHome, 'projects', 'C--sim');
  fs.mkdirSync(path.join(projectDir, sixConv, 'subagents'), { recursive: true });
  let msgN = 0;
  const jl = (o) => JSON.stringify(o) + '\n';
  const usageLine = (at, out, extra = {}, model = 'claude-opus-5') => jl({ type: 'assistant', isSidechain: false, timestamp: new Date(at).toISOString(), message: { id: `msg_${msgN++}`, role: 'assistant', model, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 1000, output_tokens: out }, content: [{ type: 'text', text: 'ok' }] }, ...extra });
  const t0 = Date.now() - 600000;
  fs.writeFileSync(path.join(projectDir, `${sixConv}.jsonl`), usageLine(t0, 100));
  // id, type, model, output tokens per request, description (rides the Agent tool's PostToolUse; none for a4)
  const sixMembers = [
    ['a1', 'fork', 'claude-opus-5', 2000, 'Fork: fix-shade-grid (372)'],
    ['a2', 'Explore', 'claude-sonnet-5', 800, 'Find the roster reads'],
    ['a3', 'fork', 'claude-opus-5', 4000, 'Fork: fix-runway-wrap'],
    ['a4', 'general-purpose', 'claude-sonnet-5', 300, null],
    ['a5', 'fork', 'claude-opus-5', 1200, 'Fork: fix-title-cost (293) and the rest of a long description that ellipses'],
    ['a6', null, null, 0, null],
  ];
  for (const [id, , model, out] of sixMembers) {
    if (model === null) continue;
    fs.writeFileSync(path.join(projectDir, sixConv, 'subagents', `agent-${id}.jsonl`), usageLine(t0 + 1000, out, { isSidechain: true, agentId: id }, model) + usageLine(t0 + 2000, out, { isSidechain: true, agentId: id }, model));
  }
  await postSix({ hook_event_name: 'SessionStart', source: 'startup' });
  await postSix({ hook_event_name: 'UserPromptSubmit', prompt: 'build the lid' });
  await postSix({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 41, context_window_size: 200000, total_input_tokens: 2413371, current_usage: { input_tokens: 2, output_tokens: 186665, cache_creation_input_tokens: 18518, cache_read_input_tokens: 2194849 } }, cost: { total_cost_usd: 61.2 } });
  for (const [i, subject] of ['Extend the row', 'Wire the hooks', 'Write the tests'].entries()) await postSix({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject, activeForm: subject }, tool_response: { task: { id: String(i + 1), subject } } });
  await postSix({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' }, tool_response: { success: true, taskId: '1' } });
  await postSix({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'in_progress' }, tool_response: { success: true, taskId: '2' } });
  for (const [id, type, , , description] of sixMembers) {
    await postSix({ hook_event_name: 'SubagentStart', agent_id: id, ...(type === null ? {} : { agent_type: type }) });
    if (description !== null) await postSix({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description, subagent_type: type }, tool_response: { agentId: id, description, status: 'async_launched' } });
  }
  await postSix({ hook_event_name: 'SubagentStop', agent_id: 'a2', agent_type: 'Explore' });
  await postSix({ hook_event_name: 'SubagentStop', agent_id: 'a4', agent_type: 'general-purpose' });
  // A shell the session started, for the ❯: a Stop's background_tasks
  // lists it, and the four agents still out beside it (a Stop's list is
  // the daemon's word on who is running; an agent left off it returns).
  await postSix({
    hook_event_name: 'Stop',
    last_assistant_message: 'running',
    background_tasks: [
      ...['a1', 'a3', 'a5', 'a6'].map((id) => ({ id, type: 'subagent', status: 'running' })),
      { id: 'sh1', type: 'shell', status: 'running', command: 'npm run build' },
    ],
  });
  await s.waitFor(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(six.id)}]`)})?.dataset.state === 'waiting'`, 'the six-member session waiting on its shell');
  const sixSel = paneSel('m63-six');
  // The wide tier wants a pane past 760px, and the harness window's
  // 1200px less the sidebar and the rail leaves 678; the viewport is
  // emulated wider for the wide-tier reads and put back after.
  const viewportH = await s.evalJs('window.innerHeight');
  const widen = () => s.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: viewportH, deviceScaleFactor: 0, mobile: false });
  await widen();
  await s.waitFor(`${q(sixSel)}.getBoundingClientRect().width >= 760`, 'the pane past 760px under the wider viewport');
  // The idle shade's setting from step 5 is still live, so a resting
  // pane may have shaded itself before the click, and the toggle would
  // lift it; shade only what is not shaded.
  const ensureShaded = async (sel, what) => {
    if (!(await s.evalJs(`!!${q(sel + ' .pane-shade')}`))) expect(await click(sel + ' .pane-shade-toggle'), what);
    await s.waitFor(`!!${q(sel + ' .pane-shade')}`, what);
  };
  await ensureShaded(sixSel, 'shade the six-member pane');
  await s.waitFor(`!!${q(sixSel + ' .pane-shade-spend')}`, 'the lid');
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(sixSel + ' .pane-shade-member')}).length === 7`, 'the seven boxes (six agents and the shell)');
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(sixSel + ' .pane-shade-member-price')}).length === 5`, 'five boxes priced off the agents\' files', 20000);
  const lidRead = (sel) =>
    s.evalJs(
      `(() => { const sh = ${q(sel + ' .pane-shade')}; const pane = ${q(sel)}.getBoundingClientRect(); const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; }; const size = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null); const name = sh.querySelector('.pane-shade-name'); return { paneWidth: Math.round(pane.width), paneBottom: Math.round(pane.bottom), name: name.textContent, step: name.dataset.step, nameSize: size(name), split: 'split' in name.dataset, subject: sh.querySelector('.pane-shade-subject')?.textContent ?? null, subjectSize: size(sh.querySelector('.pane-shade-subject')), spend: sh.querySelector('.pane-shade-spend .pane-shade-figure')?.textContent ?? null, spendSize: size(sh.querySelector('.pane-shade-spend .pane-shade-figure')), lineSize: size(sh.querySelector('.pane-shade-line')), activity: sh.querySelector('.pane-shade-activity')?.textContent ?? null, activityShown: (sh.querySelector('.pane-shade-activity')?.getClientRects().length ?? 0) > 0, mark: rect(sh.querySelector('.session-mark[data-size="face"]')), caption: sh.querySelector('.pane-shade-rule-caption')?.textContent ?? null, rule: sh.querySelector('.pane-shade-rule') === null ? null : { done: sh.querySelector('.pane-shade-rule').dataset.done, total: sh.querySelector('.pane-shade-rule').dataset.total, segments: [...sh.querySelectorAll('.pane-shade-rule-segment')].map((e) => 'done' in e.dataset), track: rect(sh.querySelector('.pane-shade-rule-track')), face: rect(sh.querySelector('.pane-shade-face')), height: sh.querySelector('.pane-shade-rule-segment') === null ? null : sh.querySelector('.pane-shade-rule-segment').getBoundingClientRect().height }, divider: sh.querySelector('.pane-shade-divider') === null ? null : rect(sh.querySelector('.pane-shade-divider')), members: [...sh.querySelectorAll('.pane-shade-member')].map((m) => ({ id: m.dataset.member, kind: m.dataset.kind, type: m.dataset.type ?? null, name: m.querySelector('.pane-shade-member-name')?.textContent ?? null, state: m.querySelector('.pane-shade-member-state')?.textContent ?? null, model: m.querySelector('.pane-shade-member-model')?.textContent ?? null, kindWord: m.querySelector('.pane-shade-member-type')?.textContent ?? null, price: m.querySelector('.pane-shade-member-price')?.textContent ?? null, activity: m.querySelector('.pane-shade-member-activity')?.textContent ?? null, shown: m.getClientRects().length > 0, box: rect(m), priceOpacity: m.querySelector('.pane-shade-member-price') === null ? null : getComputedStyle(m.querySelector('.pane-shade-member-price')).opacity })), more: [...sh.querySelectorAll('.pane-shade-member-more')].filter((e) => e.getClientRects().length > 0).map((e) => ({ text: e.textContent, box: rect(e) })), columns: getComputedStyle(sh.querySelector('.pane-shade-team')).gridTemplateColumns.split(' ').length, dense: 'dense' in sh.querySelector('.pane-shade-team').dataset }; })()`,
    );
  const wide = await lidRead(sixSel);
  // M9 fix 654: the face carries the row's activity line; no member here
  // has called a tool, so no box carries one (the shell sh1 included).
  const sixRowLine654 = await text(`.sidebar-row[data-session-id=${JSON.stringify(six.id)}] .sidebar-row-agent`);
  expect(wide.activity !== null && wide.activity === sixRowLine654 && wide.activityShown, `the wide lid's activity line is the row's and drawn, got ${JSON.stringify({ activity: wide.activity, shown: wide.activityShown })} against ${JSON.stringify(sixRowLine654)}`);
  expect(wide.members.every((m) => m.activity === null), `no box carries an activity line with no member tool call, got ${JSON.stringify(wide.members.map((m) => [m.id, m.activity]))}`);
  expect(wide.paneWidth >= 760, `the pane alone in the window is the wide tier, got ${wide.paneWidth}px`);
  expect(wide.name === 'Batch 372' && wide.split && wide.subject === 'the shade lid and the install path' && wide.step === '1' && wide.nameSize === 56 && wide.subjectSize === 20, `the hero's name is split at the colon, the identity at the wide tier's 56px for a short name and the subject at 20px, got ${JSON.stringify({ name: wide.name, split: wide.split, subject: wide.subject, step: wide.step, nameSize: wide.nameSize, subjectSize: wide.subjectSize })}`);
  expect(wide.mark.w === 64 && wide.mark.h === 64 && wide.spend === '$61.20' && wide.spendSize === 32 && wide.lineSize === 14, `a 64px mark cell, the spend in cents (fix 395) at 32px and the line at 14px on the wide tier, got ${JSON.stringify({ mark: wide.mark, spend: wide.spend, spendSize: wide.spendSize, lineSize: wide.lineSize })}`);
  expect(wide.caption === '1 of 3 tasks' && wide.rule !== null && wide.rule.done === '1' && wide.rule.total === '3' && wide.rule.segments.length === 3 && wide.rule.segments.filter(Boolean).length === 1 && wide.rule.segments[0] === true && wide.rule.height === 3 && wide.divider === null, `the rule is the checklist: 1 of 3 tasks over three 3px segments with the first lit and no hairline, got ${JSON.stringify({ caption: wide.caption, rule: wide.rule, divider: wide.divider })}`);
  expect(wide.rule.track.w === wide.rule.face.w && wide.rule.face.w === 760, `the rule spans the content column, which caps at 760px on a wide pane, got track ${wide.rule.track.w} in a ${wide.rule.face.w}px face`);
  const byId = Object.fromEntries(wide.members.map((m) => [m.id, m]));
  expect(wide.members.length === 7 && wide.members.every((m) => m.shown) && wide.more.length === 0 && wide.columns === 4 && !wide.dense, `seven boxes all shown in four columns with no fold on the wide tier, got ${wide.members.length} boxes, ${wide.more.length} fold lines, ${wide.columns} columns`);
  expect(byId.a1.name === 'Fork: fix-shade-grid (372)' && byId.a1.state === 'working' && byId.a1.model === 'Opus' && byId.a1.kindWord === 'fork' && byId.a1.type === 'fork' && byId.a1.price === '$0.10', `the fork's box: its description, working, Opus, the fork word and its price, got ${JSON.stringify(byId.a1)}`);
  expect(byId.a2.name === 'Find the roster reads' && byId.a2.state === 'returned' && byId.a2.model === 'Sonnet' && byId.a2.kindWord === 'Explore' && byId.a2.price === '$0.02', `the fresh agent's box: its description, returned, Sonnet, its type and its price, got ${JSON.stringify(byId.a2)}`);
  expect(byId.a4.name === 'general-purpose' && byId.a4.kindWord === null && byId.a4.model === 'Sonnet' && byId.a4.price === '$0.01', `a box named by its type carries no second kind word, got ${JSON.stringify(byId.a4)}`);
  expect(byId.a6.name === 'agent' && byId.a6.type === 'agent' && byId.a6.kindWord === null && byId.a6.model === null && byId.a6.price === null && byId.a6.state === 'working', `a member with no type, no file and no description is the bare agent with no model, kind word or price, got ${JSON.stringify(byId.a6)}`);
  expect(byId.a3.price === '$0.20' && byId.a5.price === '$0.06' && wide.members.filter((m) => m.price !== null).every((m) => m.priceOpacity === '0.85'), `the prices at .85 opacity, got ${JSON.stringify(wide.members.map((m) => [m.id, m.price, m.priceOpacity]))}`);
  expect(byId.sh1 !== undefined && byId.sh1.kind === 'shell' && byId.sh1.name === 'npm run build' && byId.sh1.state === 'running' && byId.sh1.kindWord === null, `the shell the session started is a box of its own naming its command, running, got ${JSON.stringify(byId.sh1)}`);
  const boxHeights = new Set(wide.members.filter((m) => m.box.y === byId.a1.box.y).map((m) => m.box.h));
  expect(boxHeights.size === 1 && byId.a1.box.w === byId.a2.box.w, `the boxes of a row stretch to one height at one width, got ${JSON.stringify(wide.members.map((m) => m.box))}`);
  await frame('m9-372-lid-six.png');
  // The hover on the rule opens the list, as the title's reading does.
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: wide.rule.track.x + wide.rule.track.w / 2, y: wide.rule.track.y + wide.rule.track.h / 2 });
  await s.waitFor(`!!document.querySelector('.tasks-popover')`, 'the checklist card opens on the rule', 3000);
  const ruleCard = await s.evalJs(`(() => { const card = document.querySelector('.tasks-popover'); return { heading: card.querySelector('.context-popover-heading').textContent, lines: [...card.querySelectorAll('.tasks-popover-task')].map((t) => [t.dataset.status, t.querySelector('.tasks-popover-subject').textContent]), session: card.dataset.sessionId }; })()`);
  expect(ruleCard.heading.startsWith('1 of 3 done') && ruleCard.session === six.id && JSON.stringify(ruleCard.lines) === JSON.stringify([['completed', 'Extend the row'], ['in_progress', 'Wire the hooks'], ['pending', 'Write the tests']]), `the card lists the three tasks with the one in progress marked, got ${JSON.stringify(ruleCard)}`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
  await s.waitFor(`!document.querySelector('.tasks-popover')`, 'the card closes after the mouse leaves');
  expect(await s.evalJs(`!!${q(sixSel + ' .pane-shade')}`), 'the shade is still down after the hover');
  // Every task done: the row's count goes (taskProgress is null) and the lid keeps a full bar.
  await postSix({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'completed' }, tool_response: { success: true, taskId: '2' } });
  await postSix({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId: '3', status: 'completed' }, tool_response: { success: true, taskId: '3' } });
  await s.waitFor(`${q(sixSel + ' .pane-shade-rule')}?.dataset.done === '3'`, 'the rule reads three done');
  const full = await lidRead(sixSel);
  expect(full.caption === '3 of 3 tasks' && full.rule.segments.length === 3 && full.rule.segments.every(Boolean) && (await s.evalJs(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(six.id)}] .sidebar-row-tasks`)}) === null`)), `a finished list keeps its full bar on the lid while the row's count goes, got ${JSON.stringify({ caption: full.caption, rule: full.rule.segments })}`);
  step('fix 372: the six-member lid at the wide tier, the split name at 56px, the 64px mark, the rule as 1 of 3 tasks with the first segment lit spanning the 760px column, the boxes with their descriptions, model words, fork and type words (fix 373), prices at .85 and the shell, the hover on the rule opening the list, a finished list keeping its full bar');

  // M9 fix 394: a member's own checklist as a strip under its box. The
  // subagent's TaskCreate and TaskUpdate carry its agent_id and land in
  // the parent's own list (Claude Code writes them into the parent's
  // task folder), so the session's count holds them all while only the
  // named member's box draws a strip; the hover opens that member's list
  // alone. a1 gets three, a3 one; every other box keeps the bare box of
  // fix 372.
  const memberTask = (agentId, id, subject) => postSix({ hook_event_name: 'PostToolUse', agent_id: agentId, tool_name: 'TaskCreate', tool_input: { subject }, tool_response: { task: { id, subject } } });
  await memberTask('a1', '4', 'Read the roster');
  await memberTask('a1', '5', 'Move the grid');
  await memberTask('a1', '6', 'Take the frame');
  await memberTask('a3', '7', 'Wrap the runway');
  await postSix({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'TaskUpdate', tool_input: { taskId: '4', status: 'completed' }, tool_response: { success: true, taskId: '4' } });
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(sixSel + ' .pane-shade-member[data-member="a1"] .pane-shade-member-segment')}).length === 3`, "the fork's strip has a segment per task of its own");
  const strips = await s.evalJs(
    `(() => { const sh = ${q(sixSel + ' .pane-shade')}; const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }; return { rule: { done: sh.querySelector('.pane-shade-rule').dataset.done, total: sh.querySelector('.pane-shade-rule').dataset.total, segments: sh.querySelectorAll('.pane-shade-rule-segment').length }, boxes: [...sh.querySelectorAll('.pane-shade-member')].map((m) => { const r = m.querySelector('.pane-shade-member-rule'); return { id: m.dataset.member, strip: r === null ? null : { done: r.dataset.done, total: r.dataset.total, member: r.dataset.member, lit: [...m.querySelectorAll('.pane-shade-member-segment')].map((e) => 'done' in e.dataset), track: rect(m.querySelector('.pane-shade-member-track')), height: m.querySelector('.pane-shade-member-segment').getBoundingClientRect().height } }; }), box: rect(sh.querySelector('.pane-shade-member[data-member="a1"]')), line: rect(sh.querySelector('.pane-shade-member[data-member="a1"] .pane-shade-member-line')) }; })()`,
  );
  const striped = strips.boxes.filter((b) => b.strip !== null);
  expect(strips.rule.total === '7' && strips.rule.segments === 7 && strips.rule.done === '4', `the session's own rule counts every task whatever its owner, four of seven done, got ${JSON.stringify(strips.rule)}`);
  expect(striped.length === 2 && striped.map((b) => b.id).join(',') === 'a1,a3', `only the two members a task names draw a strip, got ${JSON.stringify(strips.boxes.map((b) => [b.id, b.strip === null ? 'none' : b.strip.total]))}`);
  const forkStrip = striped[0].strip;
  expect(forkStrip.done === '1' && forkStrip.total === '3' && forkStrip.member === 'a1' && JSON.stringify(forkStrip.lit) === JSON.stringify([true, false, false]) && forkStrip.height === 2, `the fork's strip is three 2px segments with the done one lit, got ${JSON.stringify(forkStrip)}`);
  expect(striped[1].strip.total === '1' && JSON.stringify(striped[1].strip.lit) === JSON.stringify([false]), `the second member's strip is its one pending task, got ${JSON.stringify(striped[1].strip)}`);
  expect(forkStrip.track.w > 0 && forkStrip.track.w === strips.line.w && forkStrip.track.y > strips.line.y, `the strip spans the box's content, under the state line, got track ${JSON.stringify(forkStrip.track)} against the line ${JSON.stringify(strips.line)} in box ${JSON.stringify(strips.box)}`);
  await frame('m9-394-lid-member-strips.png');
  // The hover opens that member's list alone, not the session's seven.
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: forkStrip.track.x + forkStrip.track.w / 2, y: forkStrip.track.y + forkStrip.track.h / 2 });
  await s.waitFor(`!!document.querySelector('.tasks-popover')`, "the member's checklist card opens on the strip", 3000);
  const memberCard = await s.evalJs(`(() => { const c = document.querySelector('.tasks-popover'); return { heading: c.querySelector('.context-popover-heading').textContent, lines: [...c.querySelectorAll('.tasks-popover-task')].map((t) => [t.dataset.status, t.querySelector('.tasks-popover-subject').textContent]), session: c.dataset.sessionId }; })()`);
  expect(memberCard.session === six.id && memberCard.heading === "1 of 3 done · this member's checklist" && JSON.stringify(memberCard.lines) === JSON.stringify([['completed', 'Read the roster'], ['pending', 'Move the grid'], ['pending', 'Take the frame']]), `the strip's card lists that member's three tasks and says whose they are, got ${JSON.stringify(memberCard)}`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
  await s.waitFor(`!document.querySelector('.tasks-popover')`, "the member's card closes after the mouse leaves");
  expect(await s.evalJs(`!!${q(sixSel + ' .pane-shade')}`), 'the shade is still down after the strip hover');
  step("fix 394: a member's own TaskCreate and TaskUpdate carry its agent_id onto the task, the session's rule counts all seven, only the two named members draw a 2px strip under their boxes, and the hover opens that member's list alone");

  // M9 fix 435: the whole-list card (the session's own rule, the one
  // above) used to read all seven tasks flat, mixing the parent's with
  // a1's and a3's and saying whose was whose only on a member's own
  // card (fix 394's, tested above). It groups by owner now: the
  // parent's own three first with no heading, then a1's three under a
  // heading naming it, then a3's one under a heading naming it.
  const groupedRule = await lidRead(sixSel);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: groupedRule.rule.track.x + groupedRule.rule.track.w / 2, y: groupedRule.rule.track.y + groupedRule.rule.track.h / 2 });
  await s.waitFor(`!!document.querySelector('.tasks-popover')`, "the session's checklist card opens on the rule again", 3000);
  const groupedCard = await s.evalJs(
    `(() => { const card = document.querySelector('.tasks-popover'); const items = [...card.querySelectorAll('.tasks-popover-list > *')].map((el) => el.classList.contains('tasks-popover-owner') ? { owner: el.textContent } : { status: el.dataset.status, subject: el.querySelector('.tasks-popover-subject').textContent }); return { heading: card.querySelector('.context-popover-heading').textContent, session: card.dataset.sessionId, items }; })()`,
  );
  const expectedItems = [
    { status: 'completed', subject: 'Extend the row' },
    { status: 'completed', subject: 'Wire the hooks' },
    { status: 'completed', subject: 'Write the tests' },
    { owner: 'Fork: fix-shade-grid (372)' },
    { status: 'completed', subject: 'Read the roster' },
    { status: 'pending', subject: 'Move the grid' },
    { status: 'pending', subject: 'Take the frame' },
    { owner: 'Fork: fix-runway-wrap' },
    { status: 'pending', subject: 'Wrap the runway' },
  ];
  expect(groupedCard.session === six.id && groupedCard.heading.startsWith('4 of 7 done') && JSON.stringify(groupedCard.items) === JSON.stringify(expectedItems), `the whole list groups by owner, the parent's three first with no heading, then a1's under its own name and a3's under its, got ${JSON.stringify(groupedCard)}`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
  await s.waitFor(`!document.querySelector('.tasks-popover')`, 'the grouped card closes after the mouse leaves');
  expect(await s.evalJs(`!!${q(sixSel + ' .pane-shade')}`), 'the shade is still down after the grouped hover');
  step("fix 435: the whole-list card groups the parent's own tasks and each member's with a task under a heading naming it, in team order, and a member with none draws no group");

  // M9 fix 821: the fork's box opens the whole card (name, full model,
  // price, tasks) and the shell's the same card with its command.
  const boxPrice821 = await s.evalJs(`${q(sixSel + ' .pane-shade-member[data-member="a1"] .pane-shade-member-price')}?.textContent ?? null`);
  await hoverForCard(s, sixSel + ' .pane-shade-member[data-member="a1"] .pane-shade-member-name', '.agent-popover[data-member="a1"]', "a1's card on its box");
  const forkCard821 = await s.evalJs(`(() => { const c = document.querySelector('.agent-popover[data-member="a1"]'); return { name: c.querySelector('.agent-card-name')?.textContent, model: c.querySelector('.agent-card-model')?.textContent ?? null, price: c.querySelector('.agent-card-price')?.textContent ?? null, tasks: [...c.querySelectorAll('.agent-card-task')].map((t) => [t.dataset.status, t.textContent]) }; })()`);
  expect(forkCard821.name === 'Fork: fix-shade-grid (372)' && forkCard821.model === 'Opus 5' && boxPrice821 !== null && forkCard821.price === boxPrice821 && JSON.stringify(forkCard821.tasks) === JSON.stringify([['completed', 'Read the roster'], ['pending', 'Move the grid'], ['pending', 'Take the frame']]), `fix 821: the fork's card names it whole, the model in full, the box's price and its three tasks, got ${JSON.stringify(forkCard821)} against the box's ${boxPrice821}`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
  await s.waitFor(`!document.querySelector('.agent-popover')`, "a1's card closes after the mouse leaves");
  await hoverForCard(s, sixSel + ' .pane-shade-member[data-member="sh1"] .pane-shade-member-name', '.agent-popover[data-member="sh1"]', "sh1's card on its box");
  const shellCard821 = await s.evalJs(`(() => { const c = document.querySelector('.agent-popover[data-member="sh1"]'); return { kind: c.dataset.kind, name: c.querySelector('.agent-card-name')?.textContent, role: c.querySelector('.agent-card-role')?.textContent, state: c.querySelector('.agent-card-state')?.textContent, branch: !!c.querySelector('.agent-card-branch') }; })()`);
  expect(shellCard821.kind === 'shell' && shellCard821.name === 'npm run build' && shellCard821.role === 'shell' && shellCard821.state === 'running' && !shellCard821.branch, `fix 821: the shell's box opens the same card with its command, got ${JSON.stringify(shellCard821)}`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
  await s.waitFor(`!document.querySelector('.agent-popover')`, "sh1's card closes after the mouse leaves");
  step("fix 821: a hover on a member's box opens the agent card (the fork's with its whole name, the model in full, the box's price and its tasks; the shell's with its command), a click on the box lifts the shade and closes the card");

  // M9 fix 834: the card's heading is two lines, the name alone on the
  // first and the role, model, state and price as chips under it at the
  // name's start. a4 is a long-typed member with no description (its
  // name is general-purpose) and a1 a long-named one; both carry every
  // part, which once squeezed the name to a letter a line and ran the
  // price past the card's edge.
  for (const id of ['a4', 'a1']) {
    const cardSel = `.agent-popover[data-member="${id}"]`;
    await hoverForCard(s, sixSel + ` .pane-shade-member[data-member="${id}"] .pane-shade-member-name`, cardSel, `${id}'s card for the heading's layout`);
    await s.waitFor(`(() => { const c = ${q(cardSel)}; return !!c && !!c.querySelector('.agent-card-model') && !!c.querySelector('.agent-card-price'); })()`, `${id}'s card carries its model and price`, 3000);
    const read = await s.evalJs(`(() => {
      const card = ${q(cardSel)};
      const box = (el) => { if (el === null) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) }; };
      const cs = getComputedStyle(card);
      const rect = card.getBoundingClientRect();
      const inner = Math.round(rect.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth));
      const sel = ['mark', 'name', 'role', 'model', 'state', 'price'].map((p) => '.agent-card-heading .agent-card-' + p).join(', ');
      const parts = [...card.querySelectorAll(sel)].map(box);
      return { card: box(card), inner, name: box(card.querySelector('.agent-card-name')), chips: box(card.querySelector('.agent-card-chips')), parts };
    })()`);
    expect(read.parts.length === 6 && read.name.w >= 100 && read.parts.every((p) => p.right <= read.inner + 1) && read.chips !== null && read.chips.top >= read.name.bottom - 1 && Math.abs(read.chips.left - read.name.left) <= 1, `fix 834: ${id}'s card keeps the name at least 100px wide on its own line with every heading part inside the card, got ${JSON.stringify(read)}`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 400 });
    await s.waitFor(`!document.querySelector('.agent-popover')`, `${id}'s card closes after the mouse leaves`);
  }
  step("fix 834: the agent card gives the name a line of its own at least 100px wide, the role, model, state and price under it at the name's start and inside the card, on a long-typed member and a long-named one");

  // The narrow fold: the six-member pane at a quarter of the row (under
  // 360px) is one column of four boxes, the fifth on hidden, and "and 3
  // more" (the six agents and the shell less four) inside the pane
  // under them; every shown box inside the pane too.
  expect(await click(sixSel + ' .pane-shade'), 'lift the six-member shade');
  await s.waitFor(`!${q(sixSel + ' .pane-shade')}`, 'lifted');
  await s.send('Emulation.clearDeviceMetricsOverride');
  await s.waitFor(`${q(sixSel)}.getBoundingClientRect().width < 760`, 'the viewport back');
  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, root: { kind: 'split', id: 'm63-fold', direction: 'row', ratio: 0.25, first: layout.root, second: { kind: 'pane', id: 'm63-p2', sessionId: two.id, view: null } } } });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'two panes, the six-member one narrow');
  // The hooks banner over the panes (no hooks under a private home) wraps
  // to a second line once the product's name in it grows by two letters
  // (M9 fix 542), which takes 16px off this pane's height and puts the
  // fold line past its bottom; the fold is read with the banner put away.
  await s.evalJs(`(() => { document.querySelector('.hooks-dismiss')?.click(); return true; })()`);
  await s.waitFor(`!document.querySelector('.hooks-install')`, 'the hooks banner put away');
  await ensureShaded(sixSel, 'shade the narrow six-member pane');
  await s.waitFor(`!!${q(sixSel + ' .pane-shade-spend')}`, 'the lid');
  await sleep(300);
  const fold = await lidRead(sixSel);
  // M9 fix 654: a narrow lid that folds its team gives its height to the boxes.
  expect(fold.activity !== null && !fold.activityShown, `the folded narrow lid hides its activity line, got ${JSON.stringify({ activity: fold.activity, shown: fold.activityShown })}`);
  const shownBoxes = fold.members.filter((m) => m.shown);
  expect(fold.paneWidth < 360 && fold.columns === 1 && shownBoxes.length === 4 && shownBoxes.map((m) => m.id).join(',') === 'a1,a2,a3,a4', `the narrow tier folds at four boxes in one column, got ${fold.paneWidth}px, ${fold.columns} columns, shown ${shownBoxes.map((m) => m.id).join(',')}`);
  expect(fold.more.length === 1 && fold.more[0].text === 'and 3 more' && fold.more[0].box.bottom <= fold.paneBottom && fold.more[0].box.h > 0, `"and 3 more" is drawn inside the pane under the four, got ${JSON.stringify(fold.more)} against the pane's bottom at ${fold.paneBottom}`);
  expect(shownBoxes.every((m) => m.box.bottom <= fold.paneBottom && m.box.w === fold.rule.face.w), `every shown box is inside the pane and as wide as the face, got ${JSON.stringify(shownBoxes.map((m) => m.box))} against ${fold.paneBottom}`);
  expect(fold.nameSize === 32 && fold.subjectSize === 15 && fold.mark.w === 40, `the narrow tier's 32px name, 15px subject and 40px mark, got ${JSON.stringify({ nameSize: fold.nameSize, subjectSize: fold.subjectSize, mark: fold.mark })}`);
  await frame('m9-372-lid-fold.png');
  expect(await click(sixSel + ' .pane-shade'), 'lift the folded shade');
  await s.waitFor(`!${q(sixSel + ' .pane-shade')}`, 'lifted');
  step('fix 372: under 360px the six-member lid folds at four boxes with "and 3 more" inside the pane');

  // Twelve members at the wide tier: the columns tighten to 132px past
  // eight (five across in the 760px column), every box shown, no fold
  // line; the session has no list, so the hairline stands for the rule.
  layout = await getLayout(s);
  const { session: twelve } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, name: 'twelve', cols: 80, rows: 24 });
  await zreq(s, 'layout.set', { layout: { ...layout, focusedPaneId: 'm63-twelve', root: { kind: 'pane', id: 'm63-twelve', sessionId: twelve.id, view: null } } });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1 && !!${q(paneSel('m63-twelve'))}`, 'the twelve-member session alone on the tab');
  await widen();
  await s.waitFor(`${q(paneSel('m63-twelve'))}.getBoundingClientRect().width >= 760`, 'the pane past 760px under the wider viewport');
  const postTwelve = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, { method: 'POST', headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': twelve.id }, body: JSON.stringify({ session_id: `sim-${twelve.id.slice(0, 8)}`, cwd: 'C:/sim', ...payload }) });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  await postTwelve({ hook_event_name: 'SessionStart', source: 'startup' });
  await postTwelve({ hook_event_name: 'UserPromptSubmit', prompt: 'a dozen' });
  for (let i = 1; i <= 12; i++) await postTwelve({ hook_event_name: 'SubagentStart', agent_id: `t${i}`, agent_type: i % 3 === 0 ? 'Explore' : 'fork' });
  await s.waitFor(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(twelve.id)}]`)})?.dataset.state === 'working'`, 'the twelve-member session working');
  const twelveSel = paneSel('m63-twelve');
  await ensureShaded(twelveSel, 'shade the twelve-member pane');
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(twelveSel + ' .pane-shade-member')}).length === 12`, 'the twelve boxes');
  await sleep(300);
  // M9 fix 654: the dense tier (nine members or more) draws no member's
  // activity line, though the box holds one.
  await postTwelve({ hook_event_name: 'PreToolUse', agent_id: 't1', tool_name: 'Read', tool_input: { file_path: 'C:/sim/t1.ts' } });
  await s.waitFor(`!!${q(twelveSel + ' .pane-shade-member[data-member="t1"] .pane-shade-member-activity')}`, "t1's activity line in its box", 5000);
  expect((await s.evalJs(`${q(twelveSel + ' .pane-shade-member[data-member="t1"] .pane-shade-member-activity')}.getClientRects().length`)) === 0, "the dense tier draws no member's activity line");
  const dozen = await lidRead(twelveSel);
  expect(dozen.paneWidth >= 760 && dozen.dense && dozen.columns === 5 && dozen.members.every((m) => m.shown && m.box.bottom <= dozen.paneBottom) && dozen.more.length === 0, `twelve boxes five across in the tighter columns, all inside the pane, no fold, got ${dozen.columns} columns, dense ${dozen.dense}, ${dozen.more.length} fold lines`);
  expect(dozen.rule === null && dozen.divider !== null && dozen.divider.h === 1 && dozen.divider.w === 760 && dozen.caption === null, `with no list the hairline stands for the rule, 1px across the column, no caption, got ${JSON.stringify({ rule: dozen.rule, divider: dozen.divider, caption: dozen.caption })}`);
  expect(dozen.members.filter((m) => m.kindWord === 'fork').length === 0 && dozen.members.filter((m) => m.name === 'fork').length === 8 && dozen.members.filter((m) => m.name === 'Explore').length === 4, `eight forks and four Explores named by their type with no second word, got ${JSON.stringify(dozen.members.map((m) => [m.name, m.kindWord]))}`);
  await frame('m9-372-lid-twelve.png');
  expect(await click(twelveSel + ' .pane-shade'), 'lift the twelve-member shade');
  await s.waitFor(`!${q(twelveSel + ' .pane-shade')}`, 'lifted');
  await s.send('Emulation.clearDeviceMetricsOverride');
  step('fix 372: twelve members at the wide tier are five across in 132px columns with no fold, and a session with no list shows the hairline');

  // M9 fix 434: a shaded, unfocused session that finishes drew no wait
  // row (the fix 247 overlay never draws while shaded, fix 397, and the
  // old shadeWaiting tested needs-input alone). A second pane keeps the
  // focus so fix 30's "recent input" ack (Pane.tsx, done -> idle) never
  // fires here, unlike a focused pane's real click; that is what a real
  // click acknowledging the row a few lines down is safe to use.
  layout = await getLayout(s);
  const { session: doneSession } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, name: 'm434', cols: 80, rows: 24 });
  const { session: elsewhere } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, cols: 80, rows: 24 });
  await zreq(s, 'layout.set', {
    layout: { ...layout, focusedPaneId: 'm63-434-elsewhere', root: { kind: 'split', id: 'm63-434-split', direction: 'row', ratio: 0.5, first: { kind: 'pane', id: 'm63-434', sessionId: doneSession.id, view: null }, second: { kind: 'pane', id: 'm63-434-elsewhere', sessionId: elsewhere.id, view: null } } },
  });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2 && !!${q(paneSel('m63-434'))} && !!${q(paneSel('m63-434-elsewhere'))}`, 'the done-row pane beside the focused one');
  const doneSel = paneSel('m63-434');
  const postDone = async (payload) => {
    const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, { method: 'POST', headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': doneSession.id }, body: JSON.stringify({ session_id: `sim-${doneSession.id.slice(0, 8)}`, cwd: 'C:/sim', ...payload }) });
    expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
  };
  await postDone({ hook_event_name: 'SessionStart', source: 'startup' });
  await postDone({ hook_event_name: 'UserPromptSubmit', prompt: 'finish while shaded' });
  await s.waitFor(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(doneSession.id)}]`)})?.dataset.state === 'working'`, 'working, before the shade');
  expect(await click(doneSel + ' .pane-shade-toggle'), 'shade it while it works');
  await s.waitFor(`!!${q(doneSel + ' .pane-shade')}`, 'shaded while working');
  expect(await s.evalJs(`!${q(doneSel)}.classList.contains('focused')`), 'the shaded pane is not the focused one');
  await postDone({ hook_event_name: 'Stop', last_assistant_message: 'finished in the background' });
  await s.waitFor(`!!${q(doneSel + ' .pane-shade-wait')}`, 'the done row on the shaded, unfocused pane');
  const doneRow = await s.evalJs(
    `(() => { const face = ${q(doneSel + ' .pane-shade-face')}; const w = face.querySelector('.pane-shade-wait'); const fig = w.querySelector('.pane-shade-figure'); const hush = w.querySelector('.pane-shade-wait-hush'); return { kind: w.dataset.kind, text: w.textContent, color: getComputedStyle(fig).color, hush: hush !== null, age: face.querySelector('.pane-shade-age') !== null, alone: face.querySelector('.pane-shade-alone')?.textContent ?? null, state: face.querySelector('.pane-shade-state')?.textContent ?? null }; })()`,
  );
  const doneRgb = await s.evalJs(`(() => { const el = document.createElement('i'); el.style.color = 'var(--done)'; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; })()`);
  expect(doneRow.kind === 'done' && /^\d+s$/.test(doneRow.text) && doneRow.color === doneRgb && doneRow.hush && !doneRow.age, `the done row reads the seconds alone in --done with its hush inside it, the line's age given up to it, got ${JSON.stringify(doneRow)}`);
  // M9 fix 490: the hero says done once, the row is the figure alone, and a finished session worked alone. The frame is for the user to judge at the install.
  expect(doneRow.alone === 'worked alone', `a finished session's team line reads worked alone, got ${JSON.stringify(doneRow.alone)}`);
  step('frame ' + (await frame('m9-490-lid-done.png')));
  // A real press (not the synthetic click() elsewhere in this script)
  // acknowledges the pulse and lifts the shade in the one click, as a
  // person's would; a fresh shade after it draws no row, since the
  // pulse does not come back on an acked pane.
  expect(await realClick(doneSel + ' .pane-shade'), 'acknowledge and lift');
  await s.waitFor(`!${q(doneSel + ' .pane-shade')}`, 'lifted');
  expect(await click(doneSel + ' .pane-shade-toggle'), 'shade it again');
  await s.waitFor(`!!${q(doneSel + ' .pane-shade')}`, 'shaded again');
  await sleep(300);
  expect(await s.evalJs(`!${q(doneSel + ' .pane-shade-wait')}`), 'the row does not come back on an acked pane');
  expect(await click(doneSel + ' .pane-shade'), 'lift once more');
  await s.waitFor(`!${q(doneSel + ' .pane-shade')}`, 'lifted');
  step("fix 434: a shaded, unfocused pane that finishes draws the lid's own done row in --done with the same hush, the line's age given up to it, gone at the acknowledge and not back on a fresh shade");

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m63-shade-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
