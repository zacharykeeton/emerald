// M51 acceptance: the commit graph. A temporary repository with main, a
// branch merged back into it and a branch still out; a shell in it puts
// the Commits tab in graph mode with a node per commit, an edge per
// parent, three lanes while both branches show and the merged one dim;
// a session working in the open branch's worktree puts the pulse on
// that branch's tip and its colour on the lane; the merged branch's
// pill folds its rows to the merge and back; the graph turns on its side
// and runs either way in time, and the choices survive a renderer
// reload; a subagent of the worker session (M61) works in a third
// worktree, its branch drawn thin in the parent's colour with the mark
// stepping at its tip until it returns, and folding back at the merge;
// every live Claude session in the repository is a row of its own (M68),
// a brand new one a straight dashed lane to its own dot on the tip it
// opened on, its subagents' forks bending into that dot, and its first
// commit turning the row into a commit row with a fresh row above.
// Uses a private home and pipe unless the environment already
// names them.
// Run: npm run verify:graph -w @emerald/app
// One block and what it needs: npm run verify:graph -w @emerald/app -- --only fix-252
// The block names: npm run verify:graph -w @emerald/app -- --list
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COLOR_FLOOR, SESSION_COLORS, formatUsd, hueOf, oklabOf, sliceUsage, tokensRowText } from '@emerald/shared';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm51-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m51';
const { blockRunner, busyProfile, expect, freshPort, getLayout, hoverForCard, imageOf, killTree, launch, leaves, processGone, removeWorktree, settled: settledIn, sleep, startSession, step, stopDaemon, zreq } = await import('./cdp.mjs');

// M9 fix 426: the script's steps after the first repository's are
// blocks, each a closure a run can skip. Everything before the first
// block (the prelude: the first repository, its sessions and the clock
// of commit dates every later read on it counts from) always runs, since
// a skip there moves the rows, lanes and ages of every read after it.
// From fix 292 on, each block builds a repository of its own or reads
// one an earlier block built, and `needs` names those: `--only` runs
// the named blocks and everything they need, in file order. A name is a
// block's own, or any fix id a block carries (fix-160 runs fix-142's); a
// block's own name wins over the ids other blocks carry.
// A binding one block makes and another reads is a `let` above the
// first block, so a new such read adds its block to `needs` here.
const BLOCKS = [
  { name: 'fix-292', fixes: ['fix-292'], needs: [] },
  { name: 'fix-142', fixes: ['fix-142', 'fix-145', 'fix-160', 'fix-176', 'fix-152'], needs: [] },
  { name: 'fix-133', fixes: ['fix-133', 'fix-134', 'fix-157', 'fix-139'], needs: [] },
  { name: 'fix-145', fixes: ['fix-145', 'fix-144', 'fix-151', 'fix-185', 'fix-400', 'fix-378', 'fix-186', 'fix-195', 'fix-210', 'fix-214'], needs: [] },
  { name: 'fix-252', fixes: ['fix-252', 'fix-287', 'fix-275', 'fix-278', 'fix-276', 'fix-253', 'fix-277', 'fix-293', 'fix-318', 'fix-322'], needs: [] },
  { name: 'fix-401', fixes: ['fix-401'], needs: ['fix-145', 'fix-252'] },
  { name: 'fix-254', fixes: ['fix-254'], needs: ['fix-145'] },
  { name: 'fix-255', fixes: ['fix-255', 'fix-286'], needs: [] },
  { name: 'fix-303', fixes: ['fix-303', 'fix-304'], needs: ['fix-252', 'fix-255'] },
  { name: 'fix-305', fixes: ['fix-305', 'fix-306'], needs: [] },
  { name: 'fix-325', fixes: ['fix-325'], needs: [] },
  { name: 'fix-445', fixes: ['fix-445'], needs: ['fix-325'] },
  { name: 'fix-320', fixes: ['fix-320'], needs: [] },
  { name: 'fix-352', fixes: ['fix-352', 'fix-354'], needs: ['fix-325'] },
  { name: 'fix-353', fixes: ['fix-353'], needs: [] },
];
const { block, blocksRun, partial } = blockRunner(BLOCKS);

let app = null;
// When the run started, for the busy-share step's load caveat at the end.
const scriptStartedAt = Date.now();
// 197 s on a quiet box at the batch of fixes 258 to 273; the fix 276
// step and a box building ten worktrees at once took it past 300, and
// ten forks' verify runs at once (the batch of fixes 303 to 318) past
// 420 with the fix 144 steps still to go. 563 s passing at the batch of
// fixes 450 to 493; at the batch of fixes 494 to 541 a whole run alone
// hit 600 s in the fix 320 block, 86 step lines in. 780 s for a whole
// run. A run under --only keeps 600 s, which the close-out's --only runs
// of three and five blocks passed inside at 369 and 345 s.
const watchdogMs = partial ? 600000 : 780000;
setTimeout(() => {
  console.error(`[verify] WATCHDOG: run exceeded ${watchdogMs / 1000} s${partial ? ' (--only)' : ''}`);
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, watchdogMs);
step(`watchdog armed at ${watchdogMs / 1000} s${partial ? ' (--only)' : ''}`);

// The repository: A on main; done branches off A with D1 and is merged
// back as M; B follows on main; open branches off A with O1 and stays
// out. Committer dates are pinned so the date order is A, D1, M, B, O1
// and the picture is the same every run. The temp directory comes back
// in 8.3 form on this machine, so the path is resolved to what the rail
// will say.
const repoShort = path.join(os.tmpdir(), 'emerald-verify', `m51-repo-${process.pid}`);
const wtShort = path.join(os.tmpdir(), 'emerald-verify', `m51-open-${process.pid}`);
fs.rmSync(repoShort, { recursive: true, force: true });
fs.rmSync(wtShort, { recursive: true, force: true });
fs.mkdirSync(repoShort, { recursive: true });
const repo = fs.realpathSync.native(repoShort);
// The clock steps a second a git call, and never runs behind the wall
// clock (M9 fix 470): the daemon credits a Bash call only the commits
// whose committer date is at or after its PreToolUse, and a fixed 2023
// start credited nothing. It used to start at 1700000000.
let clock = Math.floor(Date.now() / 1000);
const stamp = () => {
  clock = Math.max(clock + 1, Math.floor(Date.now() / 1000));
  return `${clock} +0000`;
};
const git = (...args) => {
  const date = stamp();
  return execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).toString();
};
const commit = (name) => {
  fs.writeFileSync(path.join(repo, `${name}.txt`), name);
  git('add', `${name}.txt`);
  git('commit', '-q', '-m', name);
  return git('rev-parse', 'HEAD').trim();
};
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'verify');
git('config', 'user.email', 'verify@example.invalid');
git('config', 'commit.gpgsign', 'false');
const A = commit('A');
git('checkout', '-q', '-b', 'done');
const D1 = commit('D1');
git('checkout', '-q', 'main');
git('merge', '-q', '--no-ff', '-m', 'M', 'done');
const M = git('rev-parse', 'HEAD').trim();
const B = commit('B');
git('checkout', '-q', '-b', 'open', A);
const O1 = commit('O1');
git('checkout', '-q', 'main');
git('worktree', 'add', '-q', wtShort, 'open');
const openWt = fs.realpathSync.native(wtShort);
// A Claude home of the run's own (M70), so the history scan reads the
// seeded transcript and never the machine's; set before the launch, since
// the main process reads it at scan time.
const claudeHome = path.join(os.tmpdir(), 'emerald-verify', `m51-claude-${process.pid}`);
fs.rmSync(claudeHome, { recursive: true, force: true });
fs.mkdirSync(path.join(claudeHome, 'projects'), { recursive: true });
process.env['EMERALD_CLAUDE_HOME'] = claudeHome;
const encode = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
// A worktree for a subagent (M61), cut during the run so the M51 steps
// see the picture they always did; its branch starts at A with no
// commit of its own, the way a batch's worktrees are cut before the
// agents start.
const agentShort = path.join(os.tmpdir(), 'emerald-verify', `m51-agent-${process.pid}`);
fs.rmSync(agentShort, { recursive: true, force: true });
let agentWt = null;
// The three worktrees of the M9 fix 131 step, cut at the end of the run.
const fixDirs = [];
const agentGit = (...args) => {
  const date = stamp();
  return execFileSync('git', args, { cwd: agentWt, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).toString();
};

const s = await launch(freshPort(), { freshState: true });
app = s;

// The gutter's geometry, as CommitGraph.tsx has it: the first lane's
// offset, the gap between lanes and between blocks (12px since M68, so
// a marker clears the line next door), the room past the last lane, and
// the tracks and labels of the sideways drawing (24px a track, 12px
// between blocks and 24px above the first track since M9 fix 160, so
// the pills and the agent labels clear the lines next door).
const LANE_X0 = 12;
const LANE_GAP = 12;
const SESSION_GAP = 12;
const GUTTER_END = 14;
const TRACK_PX = 24;
const TRACK_GAP = 12;
const LABEL_PX = 24;
const gutterWidth = (lanes, blocks) => LANE_X0 + LANE_GAP * (lanes - 1) + SESSION_GAP * (blocks - 1) + GUTTER_END;
// An agent's label on its side is cut to 24 characters (M9 fix 142,
// commit-graph-labels.ts).
const cutLabel = (text) => (text.length > 24 ? `${text.slice(0, 23)}…` : text);

const nodeSel = (hash) => `.commits-node[data-hash=${JSON.stringify(hash)}]`;
// A mark's centre (M9 fix 145): a session's start and a lane's end are
// bars, lines across the lane, where a commit is a circle; both are
// read by one pair, rounded so a bar's midpoint matches a path's end.
const centreJs = `(el) => { const r = (v) => Math.round(v * 1000) / 1000; return el.tagName === 'line' ? { cx: r((+el.getAttribute('x1') + +el.getAttribute('x2')) / 2), cy: r((+el.getAttribute('y1') + +el.getAttribute('y2')) / 2) } : { cx: r(+el.getAttribute('cx')), cy: r(+el.getAttribute('cy')) }; }`;
const nodeOf = (hash) => s.evalJs(`(() => { const n = document.querySelector(${JSON.stringify(nodeSel(hash))}); return n ? { cx: +n.getAttribute('cx'), cy: +n.getAttribute('cy'), lane: n.dataset.lane, session: n.dataset.session ?? null, member: n.dataset.member ?? null, hollow: 'hollow' in n.dataset, outside: 'outside' in n.dataset, gone: 'gone' in n.dataset, fill: getComputedStyle(n).fill } : null; })()`);
// The picture in one read: the nodes and how many are in the grey block
// (and how many hollow, none since M68), the lanes
// and blocks, the lines as kind:from-to (b for the bottom), the rows and
// the agent rows among them, the pills and the sideways labels.
const graphProbe = () =>
  s.evalJs(
    `(() => { const g = document.querySelector('.commits-graph'); const p = document.querySelector('.commits-panel'); return { nodes: document.querySelectorAll('.commits-node').length, hollow: document.querySelectorAll('.commits-node[data-hollow]').length, outside: document.querySelectorAll('.commits-node[data-outside]').length, lanes: p.dataset.lanes, blocks: p.dataset.blocks, view: p.dataset.view, orientation: g?.dataset.orientation ?? null, reverse: g ? 'reverse' in g.dataset : null, width: g ? +g.getAttribute('width') : 0, height: g ? +g.getAttribute('height') : 0, rows: document.querySelectorAll('.commits-graph-rows .commits-row').length, agentRows: document.querySelectorAll('.commits-agent-row').length, lines: [...document.querySelectorAll('.commits-edge')].map(e => e.dataset.kind + ':' + e.dataset.from + '-' + e.dataset.to).sort().join(','), pills: [...document.querySelectorAll('.commits-pill')].map(x => x.dataset.branch + (x.dataset.merged !== undefined ? '*' : '')).join(','), labels: [...document.querySelectorAll('.commits-label:not([data-agent])')].map(x => x.dataset.branch).join(',') }; })()`,
  );
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
const hexOfRgb = (text) => '#' + text.match(/\d+/g).map((n) => (+n).toString(16).padStart(2, '0')).join('');
// A member lane's colour (M9 fix 305): a tint of the block's, the same
// hue at another OKLab lightness, the first member 0.06 above the block's;
// a null step asks only for the hue.
const isTintOf = (fill, hex, step = 0.06) => {
  const tint = hexOfRgb(fill);
  const hue = Math.abs(hueOf(tint) - hueOf(hex));
  return tint !== hex && Math.min(hue, 360 - hue) < 6 && (step === null || Math.abs(oklabOf(tint)[0] - (oklabOf(hex)[0] + step)) < 0.01);
};
const daemonInfo = () => JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
const post = async (sessionId, payload) => {
  const daemon = daemonInfo();
  const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
    method: 'POST',
    headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': sessionId },
    body: JSON.stringify({ session_id: `sim-${sessionId}`, cwd: openWt, ...payload }),
  });
  expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
};
// A commit a session makes through a Bash call (M58): the hooks around
// the command in the folder, the commit itself made here between them.
const gitIn = (cwd) => (...args) => {
  const date = stamp();
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).toString();
};
const openGit = gitIn(openWt);
// `conversation` (M9 fix 185) is the session_id the hooks carry once a
// SessionStart has bound one, since the daemon drops another id's.
// `via: 'script'` (M9 fix 195) posts the command as a script that
// commits, no git in its text, the demo's `node tools/land.mjs` case.
const commitVia = async (sessionId, gitFn, name, dir, conversation = null, via = null) => {
  const command = via === 'script' ? `node tools/land.mjs ${name}` : `git commit -q -m ${name}`;
  const own = conversation === null ? {} : { session_id: conversation };
  await post(sessionId, { ...own, cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
  await sleep(300);
  fs.writeFileSync(path.join(dir, `${name}.txt`), name);
  gitFn('add', `${name}.txt`);
  gitFn('commit', '-q', '-m', name);
  const hash = gitFn('rev-parse', 'HEAD').trim();
  await post(sessionId, { ...own, cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } });
  return hash;
};
const clickText = (sel, text) => s.evalJs(`[...document.querySelectorAll(${JSON.stringify(sel)})].find(b => b.textContent.trim().endsWith(${JSON.stringify(text)})).click()`);
const cardSel = '.lane-popover';
const hoverOver = async (selector) => {
  const c = await s.evalJs(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.getClientRects().length > 0); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  expect(c !== null, `something to hover at ${selector}`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  return c;
};
const away = async () => {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
  // M9 fix 646: a miss names the card still up, which two failed close-outs
  // could not tell.
  try {
    await s.waitFor(`!document.querySelector('.lane-popover, .agent-popover')`, 'no card open');
  } catch (err) {
    const up = await s.evalJs(`(() => { const c = document.querySelector('.lane-popover, .agent-popover'); return c === null ? 'none' : \`\${c.className} session=\${c.dataset.session ?? '-'} member=\${c.dataset.member ?? '-'}\`; })()`).catch(() => 'unread');
    throw new Error(`${err.message} (still up: ${up})`);
  }
};
// Hover a node for its lane card's action, twice if need be (the fix 175
// pattern): the activity strip above the graph grows a track when a
// session changes shape, which moves the rows under a pointer placed a
// moment before, and the card that opens is the row above's or none. A
// product bug fails both tries.
const hoverForAction = async (selector, action, what) => {
  const actionSel = `.lane-popover .lane-card-action[data-action=${JSON.stringify(action)}]`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await settled(selector);
    await hoverOver(selector);
    try {
      await s.waitFor(`!!document.querySelector(${JSON.stringify(actionSel)})`, what, 3000);
      return;
    } catch (err) {
      if (attempt === 1) throw err;
      console.log(`[verify] note: the hover for ${what} opened nothing the first time; trying again`);
      await away();
    }
  }
};
// Wait for the thing at a selector to stop moving: the activity strip
// above the graph grows a track when a session's day changes shape, and
// a hover measured just before that lands 10px off the node once the
// graph has shifted down (a mouseleave clears the card's timer). The
// shared one in cdp.mjs since M9 fix 428.
const settled = (selector) => settledIn(s, selector);

try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await startSession(s, { kind: 'shell', cwd: repo });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell in pane 1');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.view === 'graph' && document.querySelectorAll('.commits-node').length === 5`, 'the Commits tab draws the graph with five nodes', 8000);
  // M65: nobody in emerald made these five, so they sit in the grey block,
  // filled in the handoff's grey (M68; hollow went), and the branch names
  // are pills on the commits they sit on, the merged one dim. M68 task 4:
  // inside the block the lanes follow the parents: main's chain (B, M, A)
  // is the trunk, `done` a side lane curving out of the merge M and back
  // into A, `open` a lane of its own curving into A; three lanes, the
  // trunk line from B down to A.
  let g = await graphProbe();
  expect(g.nodes === 5 && g.outside === 5 && g.hollow === 0, `five filled nodes in the grey block (${g.nodes}, ${g.outside} outside, ${g.hollow} hollow)`);
  const greyNode = await nodeOf(A);
  const greyLine = await s.evalJs(`getComputedStyle(document.querySelector('.commits-edge[data-outside]')).stroke`);
  expect(greyNode.fill === 'rgb(110, 110, 110)' && greyLine === 'rgb(74, 74, 74)', `the outside ink is the handoff's grey (${greyNode.fill}, ${greyLine})`);
  expect(g.lanes === '3' && g.blocks === '1', `three grey lanes in one block (${g.lanes} lanes, ${g.blocks} blocks)`);
  expect(g.rows === 5 && g.agentRows === 0 && g.orientation === 'vertical' && g.reverse === false, `five rows, no agent rows, beside an upright graph (${JSON.stringify(g)})`);
  expect(g.height === 5 * 22 && g.width === gutterWidth(3, 1), `the gutter is rows by 22 and three lanes wide (${g.width}x${g.height})`);
  expect(g.lines === 'branch:0-4,branch:3-4,merge:3-2,outside:1-4', `the trunk B to A, the merge out of M into done, the forks of done and open into A (${g.lines})`);
  const grey = await s.evalJs(`(() => { const n = (h) => document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const lane = (h) => n(h).dataset.lane; const merge = document.querySelector('.commits-edge[data-kind="merge"]'); const d = merge.getAttribute('d'); const at = (h) => n(h).getAttribute('cx') + ' ' + n(h).getAttribute('cy'); return { lanes: [${JSON.stringify(O1)}, ${JSON.stringify(B)}, ${JSON.stringify(M)}, ${JSON.stringify(D1)}, ${JSON.stringify(A)}].map(lane).join(''), mergeStart: d.split(' ').slice(0, 2).join(' ').slice(1), mergeEnd: d.split(' ').slice(-2).join(' '), d1: at(${JSON.stringify(D1)}), m: at(${JSON.stringify(M)}), curve: d.includes('Q') }; })()`);
  expect(grey.lanes === '10020', `open on lane 1, main's chain on lane 0, done on lane 2 (${grey.lanes})`);
  expect(grey.mergeStart === grey.d1 && grey.mergeEnd === grey.m && grey.curve, `the merge edge runs from D1 up its lane and curves into M (${JSON.stringify(grey)})`);
  expect(g.pills === 'open,main,done*', `a pill on each tip row, the merged one marked (${g.pills})`);
  expect((await s.evalJs(`document.querySelector('.commits-branch-name')?.textContent`)) === 'main', 'the branch line still names the checked out branch');
  expect((await s.evalJs(`[...document.querySelectorAll('.commits-lane-group')].map((g) => ('outside' in g.dataset ? 'outside' : g.dataset.session)).join(',')`)) === 'outside', "the grey block is one group anchoring the outside card (M68) and nothing else's");
  await s.screenshot('m65-graph-outside.png');
  step('M65: commits nobody in emerald made are filled grey nodes in the outside block, one lane, the branch names as pills');

  // M68: brand new sessions. A session opened in the repo with nothing
  // committed is a row above main's tip (B): the sidebar's word and
  // line, a straight dashed stretch down its own lane to a dot of its
  // own on B's row, no pill; six of them are six lanes with six dots
  // side by side and nothing below; the marker's card is about the
  // session; two subagents in worktrees cut at B curve into the
  // session's dot, not into B's lane, each with a dashed pill; a
  // session removed with no commit leaves nothing behind. Then, in a
  // worktree on a branch of its own so the picture comes back once the
  // branch is deleted: the first commit turns the start row into a
  // commit row with a fresh row above it, and a removed session with a
  // commit keeps its lane and loses its row.
  const ownRowSel = (id) => `.commits-agent-row[data-session=${JSON.stringify(id)}]:not([data-member])`;
  const ownProbe = (id, tipHash) =>
    s.evalJs(
      `(() => { const r = document.querySelector(${JSON.stringify(ownRowSel(id))}); if (!r) return null; const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const idx = rows.indexOf(r); const below = rows[idx + 1]; const dot = document.querySelector('.commits-node[data-start][data-session=' + JSON.stringify(${JSON.stringify(id)}) + ']'); const tip = document.querySelector('.commits-node[data-hash=' + JSON.stringify(${JSON.stringify(tipHash)}) + ']'); const mark = document.querySelector('.commits-agent-node[data-session=' + JSON.stringify(${JSON.stringify(id)}) + ']:not([data-member])'); const edge = document.querySelector('.commits-edge[data-kind="start"][data-session=' + JSON.stringify(${JSON.stringify(id)}) + ']'); const inner = mark ? mark.querySelector('.session-mark, .shell-mark') : null; return { row: idx, below: below?.dataset.hash ?? below?.dataset.member ?? null, start: 'start' in r.dataset, working: 'working' in r.dataset, tone: r.dataset.tone ?? null, status: r.querySelector('.commits-agent-status').textContent, activity: r.querySelector('.commits-agent-activity').textContent, pill: r.querySelector('.commits-pill') !== null, age: r.querySelector('.commits-age').textContent, hash: r.querySelector('.commits-hash') !== null, dot: dot ? { ...(${centreJs})(dot), lane: dot.dataset.lane, fill: getComputedStyle(dot).fill, stroke: getComputedStyle(dot).stroke, shape: dot.dataset.shape ?? null, tag: dot.tagName, hash: dot.dataset.hash ?? null } : null, tipY: tip ? +tip.getAttribute('cy') : null, mark: inner ? { lane: mark.dataset.lane, kind: inner.classList.contains('shell-mark') ? 'shell' : 'claude', working: 'working' in mark.dataset } : null, edge: edge ? { from: +edge.dataset.from, to: edge.dataset.to, dashed: 'dashed' in edge.dataset, lane: edge.dataset.lane, straight: !edge.getAttribute('d').includes('Q') } : null }; })()`,
    );
  const rowIndexOf = (hash) => s.evalJs(`[...document.querySelectorAll('.commits-graph-rows .commits-row')].findIndex(r => r.dataset.hash === ${JSON.stringify(hash)})`);
  const spawnIn = async (cwd) => {
    const sess = (await zreq(s, 'session.spawn', { kind: 'shell', cwd, cols: 80, rows: 24 })).session;
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(sess.id)})?.branch !== null; })()`, 'the daemon reads the new session branch', 8000);
    await post(sess.id, { cwd, hook_event_name: 'SessionStart', source: 'startup' });
    await s.waitFor(`!!document.querySelector(${JSON.stringify(ownRowSel(sess.id))})`, 'the session is a row of its own from its SessionStart', 8000);
    return sess;
  };
  // M9 fix 427: the list dropping the id is not the shell's process
  // gone, and a worktree removal right after meets a folder the shell
  // still holds; the pid on the record, with its image name, is waited
  // out too (five seconds, a note if it outlives them; removeWorktree's
  // retry is there for whatever else holds the folder).
  const removeSession = async (id) => {
    const pid = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id)?.pid ?? null;
    const image = pid === null ? null : imageOf(pid);
    await zreq(s, 'session.kill', { sessionId: id, remove: true });
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return !r.sessions.some(x => x.id === ${JSON.stringify(id)}); })()`, 'the session left the list', 10000);
    if (image !== null && !(await processGone(pid, image))) console.log(`[verify] note: ${image} ${pid} of the removed session is still up after 5 s`);
  };
  const fresh = await spawnIn(repo);
  const freshNow = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === fresh.id);
  let own = await ownProbe(fresh.id, B);
  const bRow = await rowIndexOf(B);
  expect(own.row === bRow - 1 && own.below === B && own.start, `the row sits right above B, main's tip (${JSON.stringify([own.row, bRow, own.below, own.start])})`);
  expect(own.status === 'idle' && own.tone === 'idle' && !own.working && own.activity === '' && !own.pill && !own.hash && /\d+s$/.test(own.age), `idle with no prompt yet, no pill, no hash, the time in state (${JSON.stringify([own.status, own.tone, own.activity, own.pill, own.age])})`);
  expect(own.edge !== null && own.edge.from === own.row && own.edge.to === String(bRow) && own.edge.dashed && own.edge.straight && own.edge.lane === '0', `one straight dashed stretch from the row down to B's row on lane 0 (${JSON.stringify(own.edge)})`);
  expect(own.dot !== null && own.dot.cy === own.tipY && own.dot.lane === '0' && own.dot.stroke === rgb(freshNow.color) && own.dot.fill === 'none' && own.dot.shape === 'bar' && own.dot.tag === 'line' && own.dot.hash === null, `a bar of the session's own on B's row in its colour, with no hash (M9 fix 145) (${JSON.stringify(own.dot)})`);
  expect(own.mark !== null && own.mark.kind === 'claude' && !own.mark.working && own.mark.lane === '0', `the session's star on the lane, still (${JSON.stringify(own.mark)})`);
  g = await graphProbe();
  expect(g.lanes === '4' && g.blocks === '2' && g.rows === 6 && g.agentRows === 1 && g.nodes === 6, `the session's block before the grey one, six rows for five commits, the dot among the nodes (${JSON.stringify(g)})`);
  expect(g.lines === 'branch:0-5,branch:4-5,merge:4-3,outside:2-5,start:1-2', `the start stretch and the grey lines, no session line (${g.lines})`);
  await s.screenshot('m68-new-session.png');
  step("M68: a brand new session is a row above main's tip with a straight stretch to its own dot, no pill");

  const five = [];
  for (let i = 0; i < 5; i += 1) five.push(await spawnIn(repo));
  await s.waitFor(`document.querySelectorAll('.commits-node[data-start]').length === 6`, 'six start dots', 8000);
  const six = await s.evalJs(`(() => { const dots = [...document.querySelectorAll('.commits-node[data-start]')]; const b = document.querySelector(${JSON.stringify(nodeSel(B))}); const centre = ${centreJs}; return { ys: [...new Set(dots.map(d => centre(d).cy))], bY: +b.getAttribute('cy'), xs: [...new Set(dots.map(d => centre(d).cx))].length, shapes: [...new Set(dots.map(d => d.dataset.shape))].join(','), lanes: document.querySelector('.commits-panel').dataset.lanes, edges: [...document.querySelectorAll('.commits-edge')].map(e => e.dataset.kind).sort().join(','), rows: [...document.querySelectorAll('.commits-graph-rows .commits-row')].slice(1, 7).map(r => r.dataset.session ?? r.dataset.hash) }; })()`);
  expect(six.ys.length === 1 && six.ys[0] === six.bY && six.xs === 6 && six.shapes === 'bar', `six bars side by side on B's row (${JSON.stringify(six)})`);
  expect(six.lanes === '9' && six.edges === 'branch,branch,merge,outside,start,start,start,start,start,start', `nine lanes, six start stretches and nothing else drawn for them (${JSON.stringify([six.lanes, six.edges])})`);
  expect(six.rows.join(',') === [...five].reverse().map((x) => x.id).concat(fresh.id).join(','), `the six rows above B, newest session first (${JSON.stringify(six.rows)})`);
  await s.screenshot('m68-six-sessions.png');
  for (const x of five) await removeSession(x.id);
  await s.waitFor(`document.querySelectorAll('.commits-node[data-start]').length === 1 && document.querySelector('.commits-panel').dataset.lanes === '4'`, 'the five leave nothing behind', 8000);
  step('M68: six new sessions off one tip are six lanes with six dots on one row; removed with no commit they leave nothing');

  // The marker's card is about the session: its star, name, the badge's
  // word, the branch, the time in state and the agent line.
  await away();
  const ownMarkSel = `.commits-agent-node[data-session=${JSON.stringify(fresh.id)}]:not([data-member])`;
  const ownMarkAt = await hoverOver(ownMarkSel);
  await s.waitFor(`!!document.querySelector('.agent-popover')`, "the marker opens the session's card", 3000);
  const ownCard = await s.evalJs(`(() => { const c = document.querySelector('.agent-popover'); return { session: c.dataset.session ?? null, name: c.querySelector('.agent-card-name').textContent, state: c.querySelector('.agent-card-state').textContent, branch: c.querySelector('.agent-card-branch')?.textContent ?? null, line: c.querySelector('.agent-card-session').textContent, mark: c.querySelector('.session-mark') !== null }; })()`);
  expect(ownCard.session === fresh.id && ownCard.name === freshNow.name && ownCard.state === 'idle' && ownCard.branch === '⑂ main' && ownCard.line.startsWith(`session ${freshNow.name} · idle for `) && ownCard.mark, `the card names the session, idle, on main, with the star (${JSON.stringify(ownCard)})`);
  await s.click(ownMarkAt.x, ownMarkAt.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(ownMarkSel)}).dataset.popoverOpen === 'pinned'`, 'a click pins it');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.agent-popover')`, 'Escape closes it');
  // The pointer is still on the marker's spot; a marker re-rendered under
  // it later (the worker's, once the lanes shift under M9 fix 236's
  // origin) opens its card over the rows and the open pill's hover below
  // lands on the card. Leave the graph before the next step.
  await away();
  step("M68: the session's marker opens a card about the session");

  // Two subagents in worktrees cut at B: rows above the session's own,
  // their forks bending into the session's dot, each with a dashed pill.
  const nbDirs = [];
  for (const name of ['nb1', 'nb2']) {
    const short = path.join(os.tmpdir(), 'emerald-verify', `m51-${name}-${process.pid}`);
    fs.rmSync(short, { recursive: true, force: true });
    git('worktree', 'add', '-q', '-b', name, short, B);
    nbDirs.push(fs.realpathSync.native(short));
  }
  await s.waitFor(`!!document.querySelector('.commits-pill[data-branch="nb2"]')`, 'the new branches show on B', 8000);
  await post(fresh.id, { cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'fan out' });
  for (const [i, name] of ['nb1', 'nb2'].entries()) {
    await post(fresh.id, { cwd: repo, hook_event_name: 'SubagentStart', agent_id: name, agent_type: 'fork' });
    await post(fresh.id, { cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: `agent ${name}`, subagent_type: 'fork' }, tool_response: { agentId: name, description: `agent ${name}`, status: 'async_launched' } });
    await post(fresh.id, { cwd: nbDirs[i], agent_id: name, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    await post(fresh.id, { cwd: nbDirs[i], agent_id: name, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
  }
  await s.waitFor(`document.querySelectorAll('.commits-agent-row[data-member][data-pending]').length === 2`, 'both members are commit-less worktree rows', 8000);
  own = await ownProbe(fresh.id, B);
  const bRowNow = await rowIndexOf(B);
  const fan = await s.evalJs(`(() => { const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const dot = document.querySelector('.commits-node[data-start][data-session=' + JSON.stringify(${JSON.stringify(fresh.id)}) + ']'); const c = (${centreJs})(dot); const at = c.cx + ' ' + c.cy; const forks = [...document.querySelectorAll('.commits-edge[data-kind="fork"]')].map(e => ({ to: e.dataset.to, lane: e.dataset.lane, end: e.getAttribute('d').split(' ').slice(-2).map(v => Math.round(+v * 1000) / 1000).join(' '), curve: e.getAttribute('d').includes('Q') })); return { order: rows.slice(1, 5).map(r => r.dataset.member ?? (r.dataset.session ? 'own' : r.dataset.hash)), forks, at, pills: [...document.querySelectorAll('.commits-agent-row .commits-pill')].map(p => p.dataset.branch + ':' + getComputedStyle(p).borderTopStyle).join(','), lanes: document.querySelector('.commits-panel').dataset.lanes }; })()`);
  expect(fan.order.join(',') === 'nb1,nb2,own,' + B, `the members' rows above the session's own, all above B (${JSON.stringify(fan.order)})`);
  expect(fan.forks.length === 2 && fan.forks.every((f) => f.to === String(bRowNow) && f.end === fan.at && f.curve) && fan.lanes === '6', `both forks curve into the session's dot on B's row, six lanes (${JSON.stringify(fan)})`);
  expect(fan.pills === 'nb1:dashed,nb2:dashed', `each row wears its branch as a dashed pill (${fan.pills})`);
  // M68: the lanes sit 12px apart, so no marker's 16px box reaches the
  // 2px line of the lane next door.
  const clear = await s.evalJs(`(() => { const boxes = [...document.querySelectorAll('.commits-agent-node foreignObject')].map(f => ({ x0: +f.getAttribute('x'), x1: +f.getAttribute('x') + +f.getAttribute('width'), own: +f.getAttribute('x') + +f.getAttribute('width') / 2 })); const centre = ${centreJs}; const xs = [...new Set([...document.querySelectorAll('.commits-node')].map(n => centre(n).cx).concat(boxes.map(b => b.own)))].sort((a, b) => a - b); return { xs, overlaps: boxes.filter(b => xs.some(x => x !== b.own && x + 1 > b.x0 && x - 1 < b.x1)).length, boxes: boxes.length }; })()`);
  // M9 fix 305: an empty pitch between the session's own line and its
  // first member lane, the member lanes themselves a pitch apart.
  expect(clear.boxes === 3 && clear.overlaps === 0 && clear.xs.length === 6 && clear.xs[1] - clear.xs[0] === 2 * LANE_GAP && clear.xs[2] - clear.xs[1] === LANE_GAP, `three marker boxes, none over another lane's line, the lanes ${LANE_GAP}px apart with an empty pitch after the own line (${JSON.stringify(clear)})`);
  expect(own.working && own.status === 'working' && own.edge !== null && own.edge.straight, `the session's own row is working now, its stretch still straight (${JSON.stringify([own.working, own.status, own.edge])})`);
  await s.screenshot('m68-new-session-fan.png');
  step("M68: a new session's subagents in worktrees curve into its own dot, not into main's lane");

  // The session removed with no commit: row, lane, dot and members gone.
  await removeSession(fresh.id);
  await s.waitFor(`document.querySelectorAll('.commits-agent-row').length === 0 && document.querySelector('.commits-panel').dataset.lanes === '3'`, 'the removed session leaves nothing behind', 8000);
  for (const [i, name] of ['nb1', 'nb2'].entries()) {
    await removeWorktree(git, nbDirs[i]);
    git('branch', '-D', name);
  }
  await s.waitFor(`!document.querySelector('.commits-pill[data-branch="nb1"]') && !document.querySelector('.commits-pill[data-branch="nb2"]')`, 'the deleted branches leave the log', 8000);
  step('M68: a session removed with no commit leaves no row, lane or dot');

  // The first commit: a session in a worktree on a branch of its own
  // cut at B starts as a row above B, commits there, and the start row
  // becomes a commit row with the session line and a fresh row above
  // it; the dot stays on B, the commit the session started on, with the
  // line running down to it (M9 fix 117: the daemon read HEAD at the
  // spawn, so the lane says where the session began); removed, its row
  // goes and its lane stays; the branch deleted, the picture is as
  // before.
  const fwShort = path.join(os.tmpdir(), 'emerald-verify', `m51-fresh-${process.pid}`);
  fs.rmSync(fwShort, { recursive: true, force: true });
  git('worktree', 'add', '-q', '-b', 'fresh', fwShort, B);
  const freshWt = fs.realpathSync.native(fwShort);
  await s.waitFor(`!!document.querySelector('.commits-pill[data-branch="fresh"]')`, 'the fresh branch shows on B', 8000);
  const second = await spawnIn(freshWt);
  own = await ownProbe(second.id, B);
  expect(own.start && own.edge !== null && own.dot !== null && own.below === B, `on its own branch at B the session starts the same way (${JSON.stringify([own.start, own.below])})`);
  await post(second.id, { cwd: freshWt, hook_event_name: 'UserPromptSubmit', prompt: 'commit' });
  const F1 = await commitVia(second.id, gitIn(freshWt), 'F1', freshWt);
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(F1))})?.dataset.session === ${JSON.stringify(second.id)} && !document.querySelector('.commits-edge[data-kind="start"]')`, 'F1 lands on the session lane and the dashed start stretch goes', 8000);
  const secondNow = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === second.id);
  expect(secondNow.startHead === B, `the daemon read the commit the session started on at its spawn (${JSON.stringify(secondNow.startHead)} against ${B})`);
  own = await ownProbe(second.id, B);
  const landed = await s.evalJs(`(() => { const lines = [...document.querySelectorAll('.commits-edge[data-lane="0"]')].map(e => e.dataset.kind + ':' + e.dataset.from + '-' + e.dataset.to + ('dashed' in e.dataset ? '~' : '')).join(','); return { lines, first: document.querySelector('.commits-graph-rows .commits-row').dataset.session ?? null, f1Row: [...document.querySelectorAll('.commits-graph-rows .commits-row')].findIndex(r => r.dataset.hash === ${JSON.stringify(F1)}) }; })()`);
  expect(own.row === 0 && !own.start && own.edge === null && own.working && own.below === F1, `the row is above F1 now, working, no start stretch (${JSON.stringify([own.row, own.start, own.working, own.below])})`);
  // M9 fix 117: the dot stays on B's row, on the session's lane, and the
  // session line runs from F1 down to it; the pending stretch above F1.
  const bRowAfter = await rowIndexOf(B);
  expect(own.dot !== null && own.dot.lane === '0' && own.dot.cy === own.tipY && own.dot.hash === null && own.dot.shape === 'bar', `the start bar stays on B's row on the session's lane, no hash on it (${JSON.stringify(own.dot)}, tip at ${own.tipY})`);
  expect(landed.lines.split(',').sort().join(',') === `pending:0-1~,session:1-${bRowAfter}` && landed.f1Row === 1, `the pending stretch above F1 and the line from F1 down to the start dot (${JSON.stringify(landed)}, B at ${bRowAfter})`);
  await s.screenshot('m68-first-commit.png');
  step("M68 and M9 fix 117: the first commit turns the start row into a commit row with a fresh row above, the line running down to the dot on the commit the session started on");

  await removeSession(second.id);
  await s.waitFor(`!document.querySelector(${JSON.stringify(ownRowSel(second.id))}) && document.querySelector(${JSON.stringify(nodeSel(F1))})?.dataset.gone !== undefined`, 'the row goes and the lane stays, marked gone', 8000);
  await removeWorktree(git, freshWt);
  git('branch', '-D', 'fresh');
  await s.waitFor(`!document.querySelector(${JSON.stringify(nodeSel(F1))}) && document.querySelector('.commits-panel').dataset.lanes === '3'`, 'the branch deleted, the picture is as before', 8000);
  step('M68: a removed session with a commit loses its row and keeps its lane');

  // M9 fix 148: a shell opened in this repository that runs claude in
  // another one is grouped there by the sidebar, and the graph agrees:
  // no row of it here (the spawn folder alone no longer counts), its
  // start commit re-read as the other repository's HEAD the moment
  // SessionStart moves its group, and on the other repository's graph
  // a row of its own above that commit. The panel's head names the
  // checkout beside the branch, so which repository a graph shows is
  // readable on the panel itself.
  const otherShort = path.join(os.tmpdir(), 'emerald-verify', `m51-other-${process.pid}`);
  fs.rmSync(otherShort, { recursive: true, force: true });
  fs.mkdirSync(otherShort, { recursive: true });
  const other = fs.realpathSync.native(otherShort);
  const otherGit = gitIn(other);
  otherGit('init', '-q', '-b', 'main');
  otherGit('config', 'user.name', 'verify');
  otherGit('config', 'user.email', 'verify@example.invalid');
  otherGit('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(other, 'Z1.txt'), 'Z1');
  otherGit('add', 'Z1.txt');
  otherGit('commit', '-q', '-m', 'Z1');
  const Z1 = otherGit('rev-parse', 'HEAD').trim();
  const headFolder = () => s.evalJs(`document.querySelector('.commits-branch-folder')?.textContent ?? null`);
  expect((await headFolder()) === path.basename(repo), `the panel's head names the checkout after the branch (${JSON.stringify(await headFolder())})`);
  // A shell that prints no prompt, as one running Claude prints none: a
  // prompt here would report the shell back in the repository after the
  // SessionStart placed it in the other one (M9 fix 74's report), and
  // the rail follows the live folder.
  const roamer = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo, args: ['-NoProfile', '-Command', 'Start-Sleep 300'], cols: 80, rows: 24 })).session;
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const x = r.sessions.find(x => x.id === ${JSON.stringify(roamer.id)}); return x?.startHead === ${JSON.stringify(B)}; })()`, 'the daemon read the spawn folder HEAD', 8000);
  await post(roamer.id, { cwd: other, hook_event_name: 'SessionStart', source: 'startup' });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const x = r.sessions.find(x => x.id === ${JSON.stringify(roamer.id)}); return x?.groupCwd === ${JSON.stringify(other)} && x?.startHead === ${JSON.stringify(Z1)}; })()`, 'the group moves and the start commit is read again there', 8000);
  await s.waitFor(`!document.querySelector(${JSON.stringify(ownRowSel(roamer.id))})`, "the moved shell's row leaves this repository's graph", 8000);
  const here = await s.evalJs(`(() => ({ row: !!document.querySelector(${JSON.stringify(ownRowSel(roamer.id))}), dot: !!document.querySelector('.commits-node[data-start][data-session=' + JSON.stringify(${JSON.stringify(roamer.id)}) + ']'), folder: document.querySelector('.commits-panel').dataset.folder }))()`);
  expect(here.folder === repo && !here.row && !here.dot, `no row and no start dot of the moved shell on this repository's graph (${JSON.stringify(here)})`);
  // Its row, shift-clicked, splits a pane beside the focused one and
  // focuses it, so the rail follows to the other repository.
  const paneBefore = await s.evalJs(`document.querySelector('.pane.focused').dataset.paneId`);
  await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(roamer.id)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
  try {
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.folder === ${JSON.stringify(other)}`, 'the rail follows to the other repository', 10000);
  } catch (err) {
    const state = await s.evalJs(`(async () => { const r = await window.emerald.request('session.list', {}); const x = r.sessions.find(x => x.id === ${JSON.stringify(roamer.id)}); return { folder: document.querySelector('.commits-panel')?.dataset.folder ?? null, panes: document.querySelectorAll('.pane').length, focused: document.querySelector('.pane.focused')?.dataset.paneId ?? null, hosts: document.querySelectorAll('.term-host').length, row: !!document.querySelector('.sidebar-row[data-session-id=' + JSON.stringify(${JSON.stringify(roamer.id)}) + ']'), session: x ? { cwd: x.cwd, groupCwd: x.groupCwd, branch: x.branch, state: x.state } : null }; })()`);
    throw new Error(`${err.message} (${JSON.stringify(state)})`);
  }
  await s.waitFor(`!!document.querySelector(${JSON.stringify(ownRowSel(roamer.id))})`, 'the shell is a row of its own on the other repository', 8000);
  own = await ownProbe(roamer.id, Z1);
  const z1Row = await rowIndexOf(Z1);
  expect(own.row === z1Row - 1 && own.below === Z1 && own.start && own.dot !== null && own.dot.cy === own.tipY, `the row sits above Z1, the other repository's HEAD, with its start dot on Z1's row (${JSON.stringify([own.row, z1Row, own.below, own.start, own.dot])})`);
  expect((await headFolder()) === path.basename(other), `the head names the other checkout (${JSON.stringify(await headFolder())})`);
  await s.screenshot('m9-fix148-other-repo.png');
  // Back: hide the new pane, so the focus and the rail return, and
  // remove the shell, so the picture is as before.
  const paneNew = await s.evalJs(`document.querySelector('.pane.focused').dataset.paneId`);
  expect(paneNew !== paneBefore, 'the shift-click opened a pane of its own');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneNew)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.folder === ${JSON.stringify(repo)}`, 'the rail is back on the repository', 10000);
  await removeSession(roamer.id);
  step("M9 fix 148: a shell that ran claude in another repository has no row on this one's graph, its start commit is that repository's HEAD, and the panel's head names the checkout");

  // A session in the open branch's worktree commits there: the commit is
  // its own (M58), so it opens a block of its own in the session's
  // colour, first since it is the newest, and the session line runs from
  // it to the bottom. The pill on it and the block's line open the
  // session's card (M60).
  const worker = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: openWt, cols: 80, rows: 24 })).session;
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(worker.id)})?.branch === 'open'; })()`, 'the daemon reads the worktree branch', 8000);
  await post(worker.id, { hook_event_name: 'SessionStart', source: 'startup' });
  await post(worker.id, { hook_event_name: 'UserPromptSubmit', prompt: 'commit something' });
  const O2 = await commitVia(worker.id, openGit, 'O2', openWt);
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(O2))})?.dataset.session === ${JSON.stringify(worker.id)}`, "O2's node is the worker's", 8000);
  const workerNow = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === worker.id);
  g = await graphProbe();
  expect(g.lanes === '4' && g.blocks === '2' && g.width === gutterWidth(4, 2), `the worker's block before the grey one (${g.lanes} lanes, ${g.blocks} blocks, ${g.width}px)`);
  const o2 = await nodeOf(O2);
  expect(o2.lane === '0' && o2.fill === rgb(workerNow.color) && !o2.hollow, `O2 sits on lane 0 in the worker's colour ${workerNow.color} (${JSON.stringify(o2)})`);
  expect((await nodeOf(A)).lane === '1' && (await nodeOf(A)).outside && !(await nodeOf(A)).hollow, 'A stays on the grey lane, filled');
  // M9 fix 117: the worker started on O1 (the worktree's HEAD at its
  // spawn), so its line runs from O2 down to a dot on O1's row.
  expect(g.lines === 'branch:2-6,branch:5-6,merge:5-4,outside:3-6,pending:0-1,session:1-2', `the worker's own row's pending stretch over its one commit and the line down to the start dot on O1's row, the grey lines down the rest; O2's parent O1 is grey, so no edge crosses (${g.lines})`);
  expect(g.pills === 'open,main,done*', `the open pill moved to O2 (${g.pills})`);
  // M68: the worker itself is a row above O2, its newest commit, reading
  // as its sidebar row does: working, the tool call as the line, the
  // time in state, its star stepping on the lane.
  const workerOwn = await ownProbe(worker.id, O2);
  expect(workerOwn !== null && workerOwn.row === 0 && workerOwn.below === O2 && !workerOwn.start && workerOwn.edge === null, `the worker's own row sits above O2 with no start stretch (${JSON.stringify(workerOwn && [workerOwn.row, workerOwn.below, workerOwn.start])})`);
  expect(workerOwn.dot !== null && workerOwn.dot.lane === '0' && workerOwn.dot.cy === (await nodeOf(O1)).cy && workerOwn.dot.shape === 'bar' && workerNow.startHead === O1, `the start bar on O1's row on the worker's lane, the daemon knowing O1 as the start (${JSON.stringify([workerOwn.dot, workerNow.startHead === O1])})`);
  expect(workerOwn.working && workerOwn.status === 'working' && workerOwn.tone === 'working' && workerOwn.activity !== '' && !workerOwn.pill && workerOwn.mark.kind === 'claude' && workerOwn.mark.working, `working, with the agent line and the stepping star (${JSON.stringify([workerOwn.status, workerOwn.activity, workerOwn.mark])})`);
  await s.screenshot('m65-graph-worker.png');
  step("M65: a session's commit opens a block in its colour");

  // M60: the lane card on the graph. The open pill and the worker's line
  // open the worker's card on hover, naming the branch; the pill's click
  // pins it; the grey block has no card.
  const readCard = () => s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(cardSel)}); if (!c) return null; return { session: c.dataset.sessionId, name: c.querySelector('.lane-card-name')?.textContent ?? null, state: c.querySelector('.lane-card-state')?.textContent ?? null, where: c.querySelector('.lane-card-where')?.textContent ?? null, whereKind: c.querySelector('.lane-card-where')?.dataset.kind ?? null, agent: c.querySelector('.lane-card-agent')?.textContent ?? null, actions: [...c.querySelectorAll('.lane-card-action')].map((b) => b.dataset.action).join(','), showLabel: c.querySelector('.lane-card-action[data-action="show"]')?.textContent ?? null }; })()`);
  // Whether any pane of any tab shows the session, the read the card's
  // Show button makes for its label (M9 fix 306).
  const onAPane = (id) => s.evalJs(`(async () => { const l = (await window.emerald.request('layout.get', {})).layout; const walk = (n) => n.kind === 'pane' ? [n] : [...walk(n.first), ...walk(n.second)]; return l.tabs.some((t) => walk(t.root).some((p) => p.sessionId === ${JSON.stringify(id)})); })()`);
  const openPill = '.commits-pill[data-branch="open"]';
  // The worker's commit just changed a session's shape, so the strip above
  // the graph may still be growing a track under the pointer; settle first.
  await settled(openPill);
  const pillAt = await hoverOver(openPill);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(cardSel)})`, "the open pill opens the worker's card on hover", 3000);
  const pillCard = await readCard();
  expect(pillCard.session === worker.id && pillCard.name === workerNow.name && pillCard.whereKind === 'branch' && pillCard.where === '⑂ open', `the card is the worker's and names the branch (${JSON.stringify(pillCard)})`);
  expect(pillCard.actions === 'show,transcript,layout,solo,lines', `a live worker offers Show, Transcript, the Line toggle (M71) and the lines actions (M72) (${pillCard.actions})`);
  // M9 fix 306: the Show button says what it does, by whether a pane
  // shows the session.
  const workerOnPane = await onAPane(worker.id);
  expect(pillCard.showLabel === (workerOnPane ? 'Focus its pane' : 'Show in a pane'), `the Show button reads ${workerOnPane ? 'Focus its pane' : 'Show in a pane'} for a worker ${workerOnPane ? 'on' : 'off'} a pane (${JSON.stringify(pillCard.showLabel)})`);
  await s.click(pillAt.x, pillAt.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(openPill)}).dataset.popoverOpen === 'pinned'`, 'a click on the pill pins the card');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel)})`, 'Escape closes it');
  // Twice if need be (the shared hoverForCard, M9 fix 428): the pointer
  // leaving the pinned pill can cross the worker's own row and open its
  // agent card over O2's node, which failed this read on two runs of
  // the close-out of fixes 426 to 449 and passed on a third.
  await hoverForCard(s, nodeSel(O2), cardSel, "the worker's node, in its block's group, opens the card");
  expect((await readCard()).session === worker.id, "the block's card is the worker's");
  await away();
  expect((await s.evalJs(`document.querySelector('.commits-pill[data-branch="done"]').dataset.popoverFor ?? null`)) === null, 'the merged branch, with no session on it, has no card');
  step("M60: the open pill and the worker's block open the worker's card on the graph, the pill's click pins it");

  // M68: the shell in the repo commits on main, so its block comes first
  // (the newest commit) and the worker's second. M59 drew the second of
  // two blocks on twin colours dashed; M68 took the dash out for a bigger
  // palette, so the old palette's teal and blue side by side draw solid
  // both and no edge carries a variant.
  const mainShell = (await zreq(s, 'session.list', {})).sessions.find((x) => x.branch === 'main');
  expect(mainShell !== undefined, 'the shell in the repo is on main');
  // Claude starts in the repository itself, where the shell is: the
  // post's default folder is the worktree, and a SessionStart there
  // would move the shell's group and its start commit to the worktree
  // (M9 fix 148), off B, whose row the list step reads its line down to.
  await post(mainShell.id, { cwd: repo, hook_event_name: 'SessionStart', source: 'startup' });
  await post(mainShell.id, { cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'commit on main' });
  const B2 = await commitVia(mainShell.id, git, 'B2', repo);
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(B2))})?.dataset.session === ${JSON.stringify(mainShell.id)}`, "B2's node is the main shell's", 8000);
  g = await graphProbe();
  expect(g.lanes === '5' && g.blocks === '3', `three blocks, the grey one three lanes (${g.lanes}, ${g.blocks})`);
  expect((await nodeOf(B2)).lane === '0' && (await nodeOf(O2)).lane === '1' && (await nodeOf(A)).lane === '2', 'the main shell first, the worker second, the grey block last');
  await zreq(s, 'session.set', { sessionId: mainShell.id, color: '#56b6c2' });
  await zreq(s, 'session.set', { sessionId: worker.id, color: '#61afef' });
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(O2))})?.style.getPropertyValue('--lane') === '#61afef'`, "the worker's lane took the twin colour", 5000);
  const twins = await s.evalJs(`(() => { const es = [...document.querySelectorAll('.commits-edge:not([data-dashed])')]; return { variants: document.querySelectorAll('.commits-edge[data-variant], .commits-lane[data-variant]').length, dashes: es.map(e => getComputedStyle(e).strokeDasharray).join(','), n: es.length }; })()`);
  expect(twins.variants === 0 && twins.n >= 1 && twins.dashes.split(',').every((d) => d === 'none'), `no edge carries a variant and every solid line stays solid on twin colours (read over every solid edge, since a one-commit session draws no line of its own once a line stops at the lowest dot) (${JSON.stringify(twins)})`);
  expect((await nodeOf(O2)).fill === rgb('#61afef'), 'the lane keeps its own colour on the node');
  await zreq(s, 'session.set', { sessionId: worker.id, color: '#e06c75' });
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(O2))})?.style.getPropertyValue('--lane') === '#e06c75'`, "the worker's colour set back", 5000);
  step('M68: two blocks on twin colours both draw solid, no edge carries a variant');

  // On its side and either way in time.
  const rowCount = () => s.evalJs(`document.querySelectorAll('.commits-graph-rows .commits-row').length`);
  // Seven commits and the two sessions' own rows (M68).
  const n = 9;
  expect((await rowCount()) === n, `nine rows before the turn (${await rowCount()})`);
  await s.evalJs(`document.querySelector('.commits-orient').click()`);
  await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'horizontal'`, 'the graph turns on its side');
  g = await graphProbe();
  expect(g.width > g.height && g.width === n * 24 && g.rows === 0, `the SVG is the whole view, wider than tall, no rows beside it (${g.width}x${g.height}, rows ${g.rows})`);
  expect(g.height === LABEL_PX + LANE_X0 + TRACK_PX * 4 + TRACK_GAP * 2 + GUTTER_END, `five tracks in three blocks (${g.height})`);
  expect(g.labels === 'main,open,done', `the branch names are labels in the SVG (${g.labels})`);
  expect((await nodeOf(B2)).cx > (await nodeOf(A)).cx, 'newest at the right: the newest sits right of the oldest');
  // M9 fix 129: room past the newest end, the view's width less 48px,
  // and the first show scrolls so the newest tip (the top row's marker
  // here, the shell's own row) sits 48px from the left edge; or the
  // oldest live mark when one lies within the view's width of the tip
  // (M9 fix 142), so the marks are in view too. `lead` is whichever the
  // rule picks. The tip is computed from the drawn range's row count
  // (M9 fix 211, `data-drawn-rows`), which is every row's while every
  // block draws.
  const sideProbe = () =>
    s.evalJs(
      `(() => { const v = document.querySelector('.commits-graph-view[data-orientation="horizontal"]'); const svg = v.querySelector('.commits-graph'); const room = v.querySelector('.commits-room'); const n = +svg.dataset.drawnRows; const pitch = +svg.dataset.pitch; const svgLeft = svg.getBoundingClientRect().left - v.getBoundingClientRect().left + v.scrollLeft; const tip = svgLeft + (n - 1) * pitch + pitch / 2; const marks = [...svg.querySelectorAll('.commits-agent-node foreignObject')].map((m) => svgLeft + +m.getAttribute('x') + 8).filter((m) => Math.abs(m - tip) < v.clientWidth - 48); const lead = marks.length ? Math.min(...marks) : tip; return { scrollWidth: v.scrollWidth, clientWidth: v.clientWidth, scrollLeft: v.scrollLeft, tip, lead, marks: marks.length, room: room ? room.getBoundingClientRect().width : null, roomAfter: room ? room.previousElementSibling === svg : null }; })()`,
    );
  const side0 = await sideProbe();
  expect(side0.room !== null && Math.abs(side0.room - (side0.clientWidth - 48)) < 2 && side0.roomAfter, `a spacer after the SVG, the view's width less 48px (${JSON.stringify(side0)})`);
  expect(side0.scrollWidth >= side0.tip + side0.clientWidth - 48 - 1, `the view scrolls to the tip plus the room (${JSON.stringify(side0)})`);
  expect(Math.abs(side0.lead - side0.scrollLeft - 48) < 12, `the first show puts the lead, the newest tip or the oldest mark near it, near the left edge (${JSON.stringify(side0)})`);
  await s.screenshot('m65-graph-side.png');
  // M9 fix 170: room past the oldest end as well (a spacer before the
  // SVG, the same width), and the centre button on the tools row puts
  // the drawn extent in the middle of the view from wherever it was.
  const sideCentre170 = () =>
    s.evalJs(
      `(() => { const v = document.querySelector('.commits-graph-view[data-orientation="horizontal"]'); const svg = v.querySelector('.commits-graph'); const old = svg.previousElementSibling; const b = svg.getBBox(); const svgLeft = svg.getBoundingClientRect().left - v.getBoundingClientRect().left + v.scrollLeft; return { oldRoom: old !== null && old.classList.contains('commits-room-old') ? old.getBoundingClientRect().width : null, clientWidth: v.clientWidth, scrollLeft: v.scrollLeft, mid: svgLeft + b.x + b.width / 2 - v.scrollLeft }; })()`,
    );
  let centred170 = await sideCentre170();
  // M9 fix 211: the old room is half of what the view has over the
  // drawing, none when the drawing is longer than the view.
  const svgWidth170 = await s.evalJs(`+document.querySelector('.commits-graph-view[data-orientation="horizontal"] .commits-graph').getAttribute('width')`);
  expect(centred170.oldRoom !== null && Math.abs(centred170.oldRoom - Math.max(0, (side0.clientWidth - svgWidth170) / 2)) < 2, `a spacer before the SVG too, half of what the view has over the drawing (${JSON.stringify([centred170, svgWidth170])})`);
  // Scrolled to the end (M9 fix 211: at the start a short graph is
  // already in the middle, since the old room is exactly what puts it
  // there), the graph is off centre; the button brings it back.
  await s.evalJs(`(() => { const v = document.querySelector('.commits-graph-view[data-orientation="horizontal"]'); v.scrollLeft = v.scrollWidth; })()`);
  centred170 = await sideCentre170();
  expect(Math.abs(centred170.mid - centred170.clientWidth / 2) > 40, `scrolled to the end, the graph is off centre (${JSON.stringify(centred170)})`);
  await s.evalJs(`document.querySelector('.files-rail .commits-centre').click()`);
  centred170 = await sideCentre170();
  expect(Math.abs(centred170.mid - centred170.clientWidth / 2) < 12, `the centre button puts the drawn graph in the middle of the sideways view (${JSON.stringify(centred170)})`);
  // M9 fix 175: the same click puts the drawing in the middle of the
  // view's height too, by a margin above the SVG (`--commits-centre` on
  // the view) when it is shorter than the view; since M9 fix 187 the
  // view is the box that scrolls up and down on its side, the list's
  // height, so it is read against itself.
  const across175 = await s.evalJs(
    `(() => { const v = document.querySelector('.commits-graph-view[data-orientation="horizontal"]'); const svg = v.querySelector('.commits-graph'); const b = svg.getBBox(); const top = svg.getBoundingClientRect().top - v.getBoundingClientRect().top; return { height: v.clientHeight, drawnMid: top + b.y + b.height / 2, offset: v.style.getPropertyValue('--commits-centre'), scrollTop: v.scrollTop }; })()`,
  );
  expect(across175.height > 200 && Math.abs(across175.drawnMid - across175.height / 2) < 12 && across175.scrollTop === 0, `the centre button puts the drawn graph in the middle of the view's height as well (${JSON.stringify(across175)})`);
  // M9 fix 188: the centre is held, `data-centred` on the view, and the
  // across half runs again when the box changes size, so the drawing
  // stays in the middle of a view made shorter; a hand scroll across
  // drops it and the next resize leaves the drawing where the scroll
  // put it. The viewport is emulated shorter for the reads: first by a
  // step that keeps the drawing shorter than the view (the margin
  // case), then down to a view shorter than the drawing (the scroll
  // case), and put back after.
  const centredProbe = () =>
    s.evalJs(
      `(() => { const v = document.querySelector('.commits-graph-view[data-orientation="horizontal"]'); const svg = v.querySelector('.commits-graph'); const b = svg.getBBox(); const top = svg.getBoundingClientRect().top - v.getBoundingClientRect().top; return { centred: v.dataset.centred !== undefined, height: v.clientHeight, drawnMid: top + b.y + b.height / 2, offset: v.style.getPropertyValue('--commits-centre'), scrollTop: v.scrollTop, scrollHeight: v.scrollHeight, svgHeight: b.height, inner: window.innerHeight }; })()`,
    );
  let kept = await centredProbe();
  expect(kept.centred, `the centre is held on the view (${JSON.stringify(kept)})`);
  const innerBefore = kept.inner;
  const innerWidth = await s.evalJs(`window.innerWidth`);
  const shortBy = (h) => s.send('Emulation.setDeviceMetricsOverride', { width: innerWidth, height: h, deviceScaleFactor: 0, mobile: false });
  const shortMargin = kept.inner - Math.round((kept.height - kept.svgHeight) / 2);
  await shortBy(shortMargin);
  await s.waitFor(`window.innerHeight === ${shortMargin}`, 'a shorter viewport');
  await sleep(300);
  kept = await centredProbe();
  expect(kept.centred && kept.height < across175.height && kept.height > kept.svgHeight && kept.offset !== across175.offset && Math.abs(kept.drawnMid - kept.height / 2) < 12 && kept.scrollTop === 0, `the view made shorter, the margin is worked out again and the drawing stays in the middle (${JSON.stringify(kept)})`);
  const shortScroll = kept.inner - Math.round(kept.height - kept.svgHeight) - 60;
  await shortBy(shortScroll);
  await s.waitFor(`window.innerHeight === ${shortScroll}`, 'a viewport shorter than the drawing');
  await sleep(300);
  kept = await centredProbe();
  expect(kept.centred && kept.height < kept.svgHeight && kept.scrollHeight > kept.height && Math.abs(kept.drawnMid - kept.height / 2) < 12 && kept.scrollTop > 0, `shorter than the drawing, the view scrolls across to the middle of it instead (${JSON.stringify(kept)})`);
  await s.evalJs(`(() => { const v = document.querySelector('.commits-graph-view[data-orientation="horizontal"]'); v.scrollTop = 0; v.dispatchEvent(new Event('scroll')); })()`);
  await sleep(100);
  kept = await centredProbe();
  expect(!kept.centred && kept.scrollTop === 0, `a hand scroll across drops the held centre (${JSON.stringify(kept)})`);
  await shortBy(shortScroll + 20);
  await s.waitFor(`window.innerHeight === ${shortScroll + 20}`, 'the viewport changed again');
  await sleep(300);
  kept = await centredProbe();
  expect(!kept.centred && kept.scrollTop === 0 && Math.abs(kept.drawnMid - kept.height / 2) > 12, `the next resize leaves the drawing where the scroll put it (${JSON.stringify(kept)})`);
  await s.send('Emulation.clearDeviceMetricsOverride');
  await s.waitFor(`window.innerHeight === ${innerBefore}`, 'the viewport back');
  await s.evalJs(`document.querySelector('.files-rail .commits-centre').click()`);
  kept = await centredProbe();
  expect(kept.centred && Math.abs(kept.drawnMid - kept.height / 2) < 12, `the button centres and holds it again (${JSON.stringify(kept)})`);
  step('M9 fix 170, 175 and 188: on its side the graph has room past both ends, the centre button puts it in the middle both ways and holds it across a resize');
  // A point in the view that is on screen: the first show scrolls the
  // view to the newest end (M9 fix 129), so the SVG's left edge is not.
  // M9 fix 162: the direction is a button on the tools row as well as
  // the menu's pair; on its side its glyph is the way time runs now and
  // its title names where the newest commit lands after the click.
  const direction = () => s.evalJs(`(() => { const b = document.querySelector('.commits-direction'); return { glyph: b.textContent, title: b.title, reverse: document.querySelector('.commits-panel').dataset.reverse !== undefined }; })()`);
  let dir = await direction();
  expect(dir.glyph === '→' && dir.title === 'The newest commit at the left' && !dir.reverse, `on its side, newest last, the button points right and offers the left (${JSON.stringify(dir)})`);
  await s.evalJs(`document.querySelector('.commits-direction').click()`);
  await s.waitFor(`document.querySelector('.commits-graph')?.dataset.reverse !== undefined`, 'reversed by the button');
  expect((await nodeOf(B2)).cx < (await nodeOf(A)).cx, 'oldest first: the newest sits left of the oldest');
  dir = await direction();
  expect(dir.glyph === '←' && dir.title === 'The newest commit at the right' && dir.reverse, `reversed, the button points left and offers the right (${JSON.stringify(dir)})`);
  await s.evalJs(`document.querySelector('.commits-orient').click()`);
  await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'vertical'`, 'upright again');
  expect((await nodeOf(B2)).cy > (await nodeOf(A)).cy, 'upright and oldest first: the newest sits below the oldest');
  const firstRow = await s.evalJs(`document.querySelector('.commits-graph-rows .commits-row .commits-subject').textContent`);
  expect(firstRow === 'A', `the rows read oldest first too (${firstRow})`);
  // The upright view is its rows' height while the sideways one is the
  // list's (M9 fix 142), so the point is read again.
  dir = await direction();
  expect(dir.glyph === '↑' && dir.title === 'The newest commit at the top', `upright and reversed, the button points up and offers the top (${JSON.stringify(dir)})`);
  const cUp = await s.evalJs(`(() => { const r = document.querySelector('.commits-graph-view').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(cUp.x, cUp.y);
  await s.waitFor(`!!document.querySelector('.commits-menu')`, 'the direction menu again');
  await clickText('.commits-menu .menu-label', 'Newest first');
  await s.waitFor(`document.querySelector('.commits-graph')?.dataset.reverse === undefined`, 'newest first');
  expect((await nodeOf(B2)).cy < (await nodeOf(A)).cy, 'newest first: the newest sits above the oldest');
  dir = await direction();
  expect(dir.glyph === '↓' && dir.title === 'The newest commit at the bottom', `upright, newest first, the button points down and offers the bottom (${JSON.stringify(dir)})`);
  await away();
  step('M51 and M9 fix 162: the graph turns on its side and runs either way in time by the button or the menu, the rows following');

  // M9 fix 171: the rows button is on every panel's tools row, the rail
  // and the document tab sharing one flag in the graph prefs (the pane
  // keeps its record's, verify:view). Off, the rail is the gutter alone
  // at the rail's width with no label in the SVG (M9 fix 173); the flag
  // survives a reload and the tab opened from the rail reads the same
  // one at its mount; on again brings the nine rows back.
  const railRows = () => s.evalJs(`(() => { const p = document.querySelector('.files-rail .commits-panel'); const svg = p.querySelector('.commits-graph'); const b = p.querySelector('.commits-rows'); const box = p.querySelector('.commits-gutter-box'); const view = p.querySelector('.commits-graph-view'); return { state: p.dataset.rows, button: !!b, pressed: b?.dataset.active !== undefined, rows: p.querySelectorAll('.commits-row').length, nodes: p.querySelectorAll('.commits-node').length, svgLabels: svg.dataset.labels !== undefined, mainPill: [...svg.querySelectorAll('.commits-label')].some((l) => l.firstChild?.nodeValue === 'main'), boxWidth: box ? Math.round(box.getBoundingClientRect().width) : null, viewWidth: view ? Math.round(view.getBoundingClientRect().width) : null, pref: JSON.parse(localStorage.getItem('emerald.commitsGraph') ?? '{}').rows }; })()`);
  let rr = await railRows();
  expect(rr.button && !rr.pressed && rr.state === 'on' && rr.rows === 9 && !rr.svgLabels, `the rail's tools row has the rows button, unpressed, beside nine rows (${JSON.stringify(rr)})`);
  await s.evalJs(`document.querySelector('.files-rail .commits-rows').click()`);
  await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.rows === 'off'`, "the rail's rows off");
  rr = await railRows();
  expect(rr.pressed && rr.rows === 0 && rr.nodes === 9 && !rr.svgLabels && !rr.mainPill && rr.pref === false, `the rail is the gutter alone, the nine nodes and no pill in the SVG (M9 fix 173), the flag in the prefs (${JSON.stringify(rr)})`);
  expect(rr.boxWidth !== null && rr.viewWidth !== null && rr.boxWidth >= rr.viewWidth - 8, `the gutter box takes the rail's width with the rows gone (${JSON.stringify(rr)})`);
  await s.screenshot('m9-fix171-rail-lines.png');
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.rows === 'off' && document.querySelectorAll('.files-rail .commits-node').length === 9`, 'the rail still the gutter alone after a reload', 15000);
  await s.evalJs(`document.querySelector('.files-rail .commits-expand').click()`);
  await s.waitFor(`document.querySelectorAll('.commits-view .commits-node').length === 9`, 'the tab draws the graph', 10000);
  const tabRows = await s.evalJs(`(() => { const p = document.querySelector('.commits-view .commits-panel'); return { state: p.dataset.rows, pressed: p.querySelector('.commits-rows')?.dataset.active !== undefined, rows: p.querySelectorAll('.commits-row').length, expand: !!p.querySelector('.commits-expand') }; })()`);
  expect(tabRows.state === 'off' && tabRows.pressed && tabRows.rows === 0 && !tabRows.expand, `the document tab shares the flag: its rows off and its button pressed, no expand of its own (${JSON.stringify(tabRows)})`);
  // The tab's state is its own since M9 fix 178 (its query, not the
  // rail's key), so the tab's click brings the tab's rows back and
  // leaves the rail and its key as they were; the rail's own button
  // brings its rows back.
  await s.evalJs(`document.querySelector('.commits-view .commits-rows').click()`);
  await s.waitFor(`document.querySelector('.commits-view .commits-panel')?.dataset.rows === 'on' && document.querySelectorAll('.commits-view .commits-row').length === 9`, "the tab's rows back on its click");
  rr = await railRows();
  expect(rr.pressed && rr.rows === 0 && rr.pref === false, `the rail keeps its rows off and its key reads false, the tab's state being its own (${JSON.stringify(rr)})`);
  await s.evalJs(`[...document.querySelectorAll('.tab.tab-file')].find((t) => t.textContent.includes('Commits ·')).querySelector('.tab-close').click()`);
  await s.waitFor(`document.querySelector('.commits-view') === null`, 'the document tab closed');
  await s.evalJs(`document.querySelector('.files-rail .commits-rows').click()`);
  await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.rows === 'on' && document.querySelectorAll('.files-rail .commits-row').length === 9`, "the rail's rows back");
  rr = await railRows();
  expect(!rr.pressed && rr.rows === 9 && !rr.svgLabels && rr.pref === true, `the rail has its nine rows again, the button unpressed, the flag true (${JSON.stringify(rr)})`);
  step('M9 fix 171: the rows button is on the rail and the document tab, the two sharing one flag that survives a reload');

  // The list: the same rows on one lane per session, the lines straight
  // to the bottom, no forks and no merges; the switch leaves the scroll
  // alone; the choices survive a reload.
  const scrollTop = () => s.evalJs(`document.querySelector('.commits-panel .files-list').scrollTop`);
  await s.evalJs(`document.querySelector('.commits-switch [data-view="list"]').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.view === 'list'`, 'the list');
  g = await graphProbe();
  // Nine nodes: seven commits and the two sessions' start dots (M9 fix
  // 117), each line running down to its dot.
  expect(g.rows === n && g.nodes === 9 && g.lanes === '3' && g.blocks === '3', `the same nine rows and nine nodes, one lane per block (${JSON.stringify(g)})`);
  // M9 fix 118: the stretch from a session's own row down to its newest
  // commit is dashed in the list too, the solid line starting there.
  expect(g.lines === 'outside:4-8,pending:0-1,pending:2-3,session:1-5,session:3-4', `one straight line per session from its newest commit down to its start dot, the dashed stretch above it (${g.lines})`);
  const listDashes = await s.evalJs(`[...document.querySelectorAll('.commits-edge[data-kind="pending"]')].map(e => ('dashed' in e.dataset) + ':' + (getComputedStyle(e).strokeDasharray !== 'none')).join(',')`);
  expect(listDashes === 'true:true,true:true', `both pending stretches carry the dash in the list (${listDashes})`);
  expect((await scrollTop()) === 0, 'the scroll did not jump');
  const chips = await s.evalJs(`(() => { const sw = document.querySelector('.commits-switch'); const on = sw.querySelector('[data-active]'); const off = sw.querySelector(':not([data-active])'); const r = sw.getBoundingClientRect(); return { active: on.dataset.view, height: r.height, border: getComputedStyle(sw).borderTopWidth, radius: getComputedStyle(on).borderRadius, onBg: getComputedStyle(on).backgroundColor, offBg: getComputedStyle(off).backgroundColor, gap: getComputedStyle(sw).gap }; })()`);
  expect(chips.active === 'list' && Math.abs(chips.height - 19) < 1 && chips.border === '1px' && chips.radius === '0px' && chips.offBg === 'rgba(0, 0, 0, 0)' && chips.onBg !== chips.offBg, `the segmented control: 19px in a 1px border, no radius, the active chip filled (${JSON.stringify(chips)})`);
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.view === 'list' && document.querySelectorAll('.commits-node').length === 9`, 'the list choice comes back after a reload', 15000);
  await s.evalJs(`document.querySelector('.commits-switch [data-view="graph"]').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.view === 'graph'`, 'graph again');
  step('M65 and M9 fix 118: List is the same rows on one lane per session with the dashed stretch above each newest commit, instant, and the choice survives a reload');

  // M65 agents. The worker sends a subagent out: from the SubagentStart
  // it is a row of its own above the worker's own row, on a lane of its
  // own in the worker's block (M9 fix 150; it sat on the worker's line
  // until then) with a dashed fork into the worker's line at O2, the
  // mark on the lane, the leader, the status and the label, the wash
  // behind the text; its first Bash call in the agent worktree (the
  // branch cut at A with no commit of its own) keeps the lane and moves
  // the fork into A's lane, the grey one, with the branch as a dashed
  // pill; a Read call is its activity line.
  git('worktree', 'add', '-q', '-b', 'agent', agentShort, A);
  agentWt = fs.realpathSync.native(agentShort);
  await s.waitFor(`!!document.querySelector('.commits-pill[data-branch="agent"]')`, 'the new worktree branch shows on the fork point once the watch sees the ref', 8000);
  const agentPost = (payload) => post(worker.id, { cwd: agentWt, agent_id: 'ag1', ...payload });
  await post(worker.id, { hook_event_name: 'UserPromptSubmit', prompt: 'run the batch' });
  await post(worker.id, { hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'fork' });
  await post(worker.id, { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'the agent lane', subagent_type: 'fork' }, tool_response: { agentId: 'ag1', description: 'the agent lane', status: 'async_launched' } });
  const rowSel = '.commits-agent-row[data-member="ag1"]';
  const markSel = '.commits-agent-node[data-member="ag1"]';
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel)})`, 'the agent is a row from its start', 8000);
  const agentProbe = () =>
    s.evalJs(
      `(() => { const r = document.querySelector(${JSON.stringify(rowSel)}); const m = document.querySelector(${JSON.stringify(markSel)}); const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const idx = rows.indexOf(r); const below = rows[idx + 1]; const mark = m.querySelector('.session-mark'); const fo = m.querySelector('foreignObject'); const leader = document.querySelector('.commits-leader[data-member="ag1"]'); const wash = r.querySelector('.commits-wash'); const act = r.querySelector('.commits-agent-activity'); return { row: idx, below: below?.dataset.hash ?? below?.dataset.member ?? (below?.dataset.session ? 'own:' + below.dataset.session : null), working: 'working' in r.dataset, pending: 'pending' in r.dataset, status: r.querySelector('.commits-agent-status').textContent, activity: act.textContent, shimmer: getComputedStyle(act, '::after').animationName, pill: r.querySelector('.commits-pill')?.dataset.branch ?? null, pillDashed: r.querySelector('.commits-pill') ? getComputedStyle(r.querySelector('.commits-pill')).borderTopStyle : null, age: r.querySelector('.commits-age').textContent, hash: r.querySelector('.commits-hash') !== null, lane: m.dataset.lane, markWorking: 'working' in mark.dataset, markBg: getComputedStyle(mark).backgroundColor, markBox: [+fo.getAttribute('width'), +fo.getAttribute('height')], markY: +fo.getAttribute('y') + 8, rowY: r.getBoundingClientRect().top - document.querySelector('.commits-graph').getBoundingClientRect().top + r.getBoundingClientRect().height / 2, leader: leader !== null, leaderDash: leader ? getComputedStyle(leader).strokeDasharray : null, washBg: getComputedStyle(wash).backgroundColor, lines: [...document.querySelectorAll('.commits-edge[data-kind="pending"], .commits-edge[data-kind="fork"]')].map(e => e.dataset.kind + '@' + e.dataset.lane + (e.dataset.dashed !== undefined ? '~' : '')).join(',') }; })()`,
    );
  let ag = await agentProbe();
  // The member's row sits above the worker's own row (M68), both above
  // O2, on a lane of its own beside the worker's line (M9 fix 150).
  expect(ag.row === 2 && ag.below === `own:${worker.id}` && ag.lane === '2' && ag.pending, `the row sits right above the worker's own row on a lane of its own, pending (${JSON.stringify([ag.row, ag.below, ag.lane, ag.pending])})`);
  const memberOnLine = await s.evalJs(`[...document.querySelectorAll('.commits-agent-node[data-member]')].filter((m) => m.dataset.lane === '1').length + document.querySelectorAll('.commits-agent-node[data-session=${JSON.stringify(worker.id)}]:not([data-member])[data-lane="1"]').length`);
  expect(memberOnLine === 1, `nothing of a member's on the worker's line, only the worker's own star (${memberOnLine} on lane 1)`);
  const homeFork = await s.evalJs(`(() => { const e = document.querySelector('.commits-edge[data-kind="fork"]'); const o2 = document.querySelector(${JSON.stringify(nodeSel(O2))}); const d = e.getAttribute('d'); return { end: d.split(' ').slice(-2).join(' '), o2: o2.getAttribute('cx') + ' ' + o2.getAttribute('cy'), dashed: 'dashed' in e.dataset, lane: e.dataset.lane }; })()`);
  expect(homeFork.dashed && homeFork.lane === '2' && homeFork.end === homeFork.o2, `the fork runs dashed down the member's lane and bends into the worker's line at O2, the commit the worker sits on (${JSON.stringify(homeFork)})`);
  expect(ag.working && ag.status === 'working' && ag.activity === 'the agent lane' && !ag.hash, `working, the label as the activity line until a tool runs, no hash (${JSON.stringify([ag.status, ag.activity, ag.hash])})`);
  expect(ag.markWorking && ag.markBox[0] === 16 && ag.markBox[1] === 16 && Math.abs(ag.markY - ag.rowY) < 1, `the mark steps in a 16px box on the row's own centre line (${JSON.stringify([ag.markBox, ag.markY, ag.rowY])})`);
  expect(ag.markBg !== 'rgba(0, 0, 0, 0)', `the box has the panel background (${ag.markBg})`);
  expect(ag.leader && ag.leaderDash !== 'none' && ag.washBg !== 'rgba(0, 0, 0, 0)', `a dotted leader and the wash (${ag.leaderDash}, ${ag.washBg})`);
  expect(ag.shimmer === 'turn-band', `the activity line carries the sheen (${ag.shimmer})`);
  expect(ag.pill === null && ag.lines === 'pending@0~,pending@1~,fork@2~', `no pill and the dashed fork, beside the two sessions' own stretches (${ag.pill}, ${ag.lines})`);
  // The marker's card says the member works in the session's folder,
  // since no branch is on it to say where its lane comes from.
  await settled(markSel);
  await hoverOver(markSel);
  await s.waitFor(`document.querySelector('.agent-popover .agent-card-branch')?.dataset.folder !== undefined`, "the marker's card says the member is in the session's folder", 3000);
  const homeLine = await s.evalJs(`document.querySelector('.agent-popover .agent-card-branch').textContent`);
  expect(homeLine === "in the session's folder", `the card's branch line (${homeLine})`);
  await away();
  // The mark steps: another frame shows 300 ms later (the harness window
  // sits off screen, where animation frames run).
  const frameShown = () => s.evalJs(`[...document.querySelector(${JSON.stringify(markSel)}).querySelector('.session-mark-frames').children].findIndex((f) => getComputedStyle(f).opacity === '1')`);
  const shownA = await frameShown();
  await sleep(300);
  const shownB = await frameShown();
  expect(shownA >= 0 && shownB >= 0 && shownA !== shownB, `the mark shows another frame 300 ms later (${shownA} then ${shownB})`);
  await s.screenshot('m65-agent-start.png');
  step("M65 and M9 fix 150: a subagent is a row on a lane of its own from the moment it starts, forking dashed into its parent's line, the mark stepping on the lane, the card saying it is in the session's folder");

  // M9 fix 116: the agent's very first call runs in the parent's own
  // folder (a real fork cuts its worktree from there), which gave the
  // member the parent's folder and branch and so a dashed `main` pill;
  // now a call in the parent's own folder places nothing, and the lane
  // it has anyway (M9 fix 150) stays where it was.
  const memberOf = async () => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === worker.id).team.find((m) => m.id === 'ag1') ?? null;
  await post(worker.id, { cwd: openWt, agent_id: 'ag1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git worktree list' } });
  await post(worker.id, { cwd: openWt, agent_id: 'ag1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git worktree list' } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .commits-agent-activity')})?.textContent === 'git worktree list'`, 'the call is the activity line', 8000);
  const memberHome = await memberOf();
  expect(memberHome.cwd === null && memberHome.branch === null, `a call in the parent's own folder gives the member no folder and no branch (${JSON.stringify([memberHome.cwd, memberHome.branch])})`);
  ag = await agentProbe();
  expect(ag.lane === '2' && ag.row === 2 && ag.pill === null && ag.lines === 'pending@0~,pending@1~,fork@2~', `the row stays on its lane with no pill, the fork still into the worker's line (${JSON.stringify([ag.lane, ag.row, ag.pill, ag.lines])})`);
  step("M9 fix 116: an agent's call in the parent's own folder leaves it where it was");

  // The agent's first call in its worktree goes through the PowerShell
  // tool, which the daemon read as no tool of its until M9 fix 106.
  await agentPost({ hook_event_name: 'PreToolUse', tool_name: 'PowerShell', tool_input: { command: 'git status' } });
  await agentPost({ hook_event_name: 'PostToolUse', tool_name: 'PowerShell', tool_input: { command: 'git status' } });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const m = r.sessions.find(x => x.id === ${JSON.stringify(worker.id)})?.team.find(m => m.id === 'ag1'); return m?.branch === 'agent'; })()`, "the member's folder maps to the agent branch", 8000);
  const memberStart = await memberOf();
  expect(memberStart.cwd === agentWt && memberStart.commits.length === 0 && memberStart.activity === 'git status', `the member knows its folder, has no commit yet and its activity is the call (${JSON.stringify([memberStart.cwd === agentWt, memberStart.commits.length, memberStart.activity])})`);
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .commits-pill')})?.dataset.pending !== undefined`, 'the row becomes a commit-less worktree', 8000);
  ag = await agentProbe();
  const aRow = await s.evalJs(`[...document.querySelectorAll('.commits-graph-rows .commits-row')].findIndex(r => r.dataset.hash === ${JSON.stringify(A)})`);
  expect(ag.lane === '2' && ag.row === aRow - 1, `the row keeps its lane in the worker's block and moves right above A (${JSON.stringify([ag.lane, ag.row, aRow])})`);
  expect(ag.pill === 'agent' && ag.pillDashed === 'dashed', `the branch as a dashed pill at the right (${ag.pill}, ${ag.pillDashed})`);
  // M68: the dashed pill is the agent row's alone; a pill on a commit
  // row is solid whoever is on the branch (the open pill here, and the
  // agent pill once the branch has a commit, below).
  const rowPillStyle = (branch) => s.evalJs(`getComputedStyle(document.querySelector('.commits-row[data-hash] .commits-pill[data-branch=' + ${JSON.stringify(JSON.stringify(branch))} + ']')).borderTopStyle`);
  expect((await rowPillStyle('open')) === 'solid', `the open pill on its commit row is solid (${await rowPillStyle('open')})`);
  expect(ag.activity === 'git status' && ag.lines === 'pending@0~,pending@1~,fork@2~', `the activity line is the call, the fork dashed into A's lane (${ag.activity}, ${ag.lines})`);
  // M9 fix 145: A is the grey block's, so the fork lands on the worker's
  // own lane at A's row, with no node of the worker's there, rather than
  // on A's node; the landing wears a fork bar on the worker's lane (M9
  // fix 374), so the fork is seen to come from the line and not from
  // nowhere. The member's lane is the worker's plus one, the fresh
  // members' lanes sitting right after the parent's line (fix 374).
  const fork = await s.evalJs(`(() => { const centre = ${centreJs}; const e = document.querySelector('.commits-edge[data-kind="fork"]'); const a = document.querySelector(${JSON.stringify(nodeSel(A))}); const o2 = document.querySelector(${JSON.stringify(nodeSel(O2))}); const d = e.getAttribute('d'); const end = d.split(' ').slice(-2).join(' '); const bars = [...document.querySelectorAll('.commits-node[data-shape="bar"][data-kind="fork"][data-session=' + JSON.stringify(${JSON.stringify(worker.id)}) + ']')].map((b) => { const c = centre(b); return { lane: b.dataset.lane, at: c.cx + ' ' + c.cy }; }); return { end, a: a.getAttribute('cx') + ' ' + a.getAttribute('cy'), own: o2.getAttribute('cx') + ' ' + a.getAttribute('cy'), lanes: document.querySelector('.commits-panel').dataset.lanes, ownLane: o2.dataset.lane, memberLane: e.dataset.lane, bars }; })()`);
  expect(fork.end === fork.own && fork.end !== fork.a && fork.lanes === '6', `the fork lands on the worker's own lane at A's row, not on A's grey node (M9 fix 145), six lanes now (${JSON.stringify(fork)})`);
  expect(fork.bars.length === 1 && fork.bars[0].lane === fork.ownLane && fork.bars[0].at === fork.own, `the landing on the worker's bare line wears one fork bar on the worker's lane at A's row (M9 fix 374; ${JSON.stringify(fork.bars)} against ${fork.own} on lane ${fork.ownLane})`);
  expect(+fork.memberLane === +fork.ownLane + 1, `the commit-less member's lane is the worker's plus one (M9 fix 374; ${fork.memberLane} beside ${fork.ownLane})`);
  await agentPost({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(agentWt, 'A.txt') } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .commits-agent-activity')})?.textContent === 'Reading A.txt'`, 'a Read is the activity line', 8000);
  await s.screenshot('m65-agent-fork.png');
  step("M65: a commit-less worktree is a lane with a dashed fork into the commit its branch sits on, the branch a dashed pill, the activity line following the agent's calls");

  // The agent commits twice in its worktree in one command: HEAD read
  // before and after, in that folder, and both commits credited to the
  // member, oldest first (M61). The row moves above G2 with the pending
  // stretch, the worktree line runs G2 to G1 and the merge-back curves
  // into the worker's line at O2.
  // The command names the folder the way Git Bash does, `/c/Users/...`,
  // which mapped to no folder until M9 fix 107.
  const msysWt = `/${agentWt[0].toLowerCase()}${agentWt.slice(2).replace(/\\/g, '/')}`;
  const commitCmd = `cd ${msysWt} && git commit -q -m G1 && git commit -q -m G2`;
  await agentPost({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: commitCmd } });
  await sleep(500);
  fs.writeFileSync(path.join(agentWt, 'G1.txt'), 'G1');
  agentGit('add', 'G1.txt');
  agentGit('commit', '-q', '-m', 'G1');
  const G1 = agentGit('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(agentWt, 'G2.txt'), 'G2');
  agentGit('add', 'G2.txt');
  agentGit('commit', '-q', '-m', 'G2');
  const G2 = agentGit('rev-parse', 'HEAD').trim();
  await agentPost({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: commitCmd } });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const m = r.sessions.find(x => x.id === ${JSON.stringify(worker.id)})?.team.find(m => m.id === 'ag1'); return m?.commits.some(c => c.hash === ${JSON.stringify(G2)}); })()`, 'the commits are credited to the member', 8000);
  const memberCommits = (await memberOf()).commits.map((c) => c.hash);
  expect(memberCommits.join(',') === `${G1},${G2}`, `both commits, oldest first (${memberCommits.map((h) => h.slice(0, 7)).join(',')})`);
  expect((await memberOf()).cwd === agentWt, `the member's folder is the Windows spelling of the Git Bash path (${(await memberOf()).cwd})`);
  const parentOwn = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === worker.id).commits.map((c) => c.hash);
  expect(parentOwn.join(',') === O2, `the parent's own commits take none of it (${parentOwn.map((h) => h.slice(0, 7)).join(',')})`);
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(G2))})?.dataset.member === 'ag1' && document.querySelector(${JSON.stringify(rowSel)})?.dataset.pending === undefined`, "G2's node is on the agent's lane and the row is no longer commit-less", 8000);
  ag = await agentProbe();
  const g2 = await nodeOf(G2);
  // G2 is the newest commit now, so the worker's block comes first: its
  // line on slot 0 and the agent's lane on slot 1.
  const agentLane = ag.lane;
  // The member's nodes wear the first tint of the worker's colour (M9 fix 305).
  expect(agentLane === '1' && g2.lane === agentLane && g2.session === worker.id && isTintOf(g2.fill, '#e06c75') && (await nodeOf(G1)).lane === agentLane && (await nodeOf(O2)).lane === '0', `G2 and G1 sit on the agent's lane in the first tint of the worker's colour, the block first now (${JSON.stringify(g2)})`);
  expect(ag.row === 0 && ag.below === G2 && ag.pill === null, `the row is above G2 with no pill (${JSON.stringify([ag.row, ag.below, ag.pill])})`);
  expect((await rowPillStyle('agent')) === 'solid', `the agent pill on G2's row is solid, the agent on it or not (${await rowPillStyle('agent')})`);
  const lines = await s.evalJs(`[...document.querySelectorAll('.commits-edge[data-lane="1"]')].map(e => e.dataset.kind + (e.dataset.dashed !== undefined ? '~' : '')).join(',')`);
  // M68 drew no fork for G1's parent A, grey, and M65's merge-back
  // stood in; since M9 fix 145 A is in the log, so the lane curves into
  // the worker's own line at A's row instead.
  expect(lines === 'worktree,branch,pending~', `the worktree line, the bend into the worker's line at A's row and the dashed pending stretch (${lines})`);
  const mergeBack = await s.evalJs(`(() => { const e = document.querySelector('.commits-edge[data-kind="branch"][data-lane="1"]'); const o = document.querySelector(${JSON.stringify(nodeSel(O2))}); const a = document.querySelector(${JSON.stringify(nodeSel(A))}); const d = e.getAttribute('d'); return { end: d.split(' ').slice(-2).join(' '), at: o.getAttribute('cx') + ' ' + a.getAttribute('cy'), curve: d.includes('Q') }; })()`);
  expect(mergeBack.end === mergeBack.at && mergeBack.curve, `the lane curves into the worker's line at A's row (${JSON.stringify(mergeBack)})`);
  expect((await s.evalJs(`document.querySelectorAll('.commits-graph-rows .commits-row').length`)) === 12 && (await s.evalJs(`document.querySelectorAll('.commits-node:not([data-start])').length`)) === 9 && (await s.evalJs(`document.querySelectorAll('.commits-node[data-start]').length`)) === 2, 'twelve rows for nine commits: the agent row and the two own rows are no commits; two start dots beside them (M9 fix 117)');
  await s.screenshot('m65-agent-lane.png');
  step("M65: the agent's commits draw its lane in the parent's colour, the row above the tip with the pending stretch, the merge-back into the parent's line");

  // M9 fix 116, the other half: a call back in the repository after the
  // commits (a real fork ran `sleep 25` there) moved the member to the
  // parent's folder and `main`, so its card read `⑂ main` over the
  // worktree's commits; the worktree sticks now, and the card step
  // below reads `⑂ agent` off the same member.
  await post(worker.id, { cwd: openWt, agent_id: 'ag1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'sleep 25' } });
  await post(worker.id, { cwd: openWt, agent_id: 'ag1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'sleep 25' } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .commits-agent-activity')})?.textContent === 'sleep 25'`, 'the call back home is the activity line', 8000);
  const memberBack = await memberOf();
  expect(memberBack.cwd === agentWt && memberBack.branch === 'agent', `the member keeps its worktree and branch through a call in the repository (${JSON.stringify([memberBack.cwd === agentWt, memberBack.branch])})`);
  ag = await agentProbe();
  expect(ag.lane === '1' && ag.row === 0 && ag.below === G2, `the row stays above G2 on the agent's lane (${JSON.stringify([ag.lane, ag.row, ag.below])})`);
  step("M9 fix 116: a member's worktree sticks through a call back in the parent's folder");

  // M9 fix 137: a call in a folder outside any repository (the logs
  // folder beside the worktrees, where a real fork read its verify
  // logs a dozen times) used to give the member no branch for the span
  // of the call, and with it no lane; the folder follows a command only
  // into a repository now. Three hooks, the middle one in a plain
  // folder, and the row keeps its lane, its place and its pill throughout.
  const logsDir = path.join(os.tmpdir(), 'emerald-verify', `m51-logs-${process.pid}`);
  fs.mkdirSync(logsDir, { recursive: true });
  const rowsBeforeLogs = await s.evalJs(`document.querySelectorAll('.commits-graph-rows .commits-row').length`);
  const logCmd = `cd ${JSON.stringify(logsDir)} && grep -c PASS run.log`;
  await post(worker.id, { cwd: openWt, agent_id: 'ag1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: logCmd } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .commits-agent-activity')})?.textContent === ${JSON.stringify(logCmd)}`, 'the log read is the activity line', 8000);
  const memberLogs = await memberOf();
  expect(memberLogs.cwd === agentWt && memberLogs.branch === 'agent', `a call in a folder outside any repository leaves the member's folder and branch alone (${JSON.stringify([memberLogs.cwd === agentWt, memberLogs.branch])})`);
  ag = await agentProbe();
  const rowsDuringLogs = await s.evalJs(`document.querySelectorAll('.commits-graph-rows .commits-row').length`);
  expect(ag.lane === '1' && ag.row === 0 && ag.below === G2 && rowsDuringLogs === rowsBeforeLogs, `the row keeps its lane and its place above G2, the row count unchanged (${JSON.stringify([ag.lane, ag.row, ag.below, rowsDuringLogs, rowsBeforeLogs])})`);
  await post(worker.id, { cwd: openWt, agent_id: 'ag1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: logCmd } });
  await sleep(300);
  const memberAfterLogs = await memberOf();
  expect(memberAfterLogs.cwd === agentWt && memberAfterLogs.branch === 'agent', 'and after the call returns');
  fs.rmSync(logsDir, { recursive: true, force: true });
  step("M9 fix 137: a member's worktree survives a command run in a folder outside any repository");

  // M9 fix 109: the agent asks a permission (its own PermissionRequest,
  // then the parent's permission_prompt) and the parent's row says so,
  // naming the agent; the agent's own PostToolUse releases it back to
  // the parent's turn, which is working here.
  const workerState = async () => {
    const w = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === worker.id);
    return { state: w.state, reason: w.needsInputReason, permission: w.team.find((m) => m.id === 'ag1')?.permission ?? null };
  };
  await agentPost({ hook_event_name: 'PermissionRequest', tool_name: 'Edit', tool_input: { file_path: 'agent.txt' } });
  await post(worker.id, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Edit' });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const w = r.sessions.find(x => x.id === ${JSON.stringify(worker.id)}); return w.state === 'needs-input' && w.needsInputReason === 'agent-permission'; })()`, "the agent's permission puts the parent at needs-input for it", 8000);
  const askedState = await workerState();
  expect(askedState.permission === 'Edit', `the member names the tool it asks for (${JSON.stringify(askedState)})`);
  const askedRow = await s.evalJs(`document.querySelector('.sidebar-row[data-session-id="' + ${JSON.stringify(worker.id)} + '"] .sidebar-row-agent')?.textContent ?? null`);
  expect(askedRow !== null && askedRow.includes('Allow? the agent lane: Edit'), `the row's agent line names the agent and the tool (${JSON.stringify(askedRow)})`);
  // M9 fix 123: the badge, the pane title and the notification say the
  // reason in words, not the key `agent-permission`.
  const askedBadge = await s.evalJs(`document.querySelector('.sidebar-row[data-session-id="' + ${JSON.stringify(worker.id)} + '"] .sidebar-row-state')?.textContent ?? null`);
  expect(askedBadge === "needs input: an agent's permission", `the badge says the reason in words (M9 fix 123), got ${JSON.stringify(askedBadge)}`);
  await agentPost({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'agent.txt' } });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const w = r.sessions.find(x => x.id === ${JSON.stringify(worker.id)}); return w.state === 'working' && w.needsInputReason === null; })()`, "the agent's own PostToolUse releases the parent back to working", 8000);
  const releasedState = await workerState();
  expect(releasedState.permission === null, `the member's ask is cleared (${JSON.stringify(releasedState)})`);
  step("M9 fix 109: an agent's answered permission releases the parent row");

  // The agent's card, off the marker: name, state, the branch off the
  // member's record, the session and elapsed, the activity line; a click
  // pins it. A Read first, so the activity line is not the commit command.
  await agentPost({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: path.join(agentWt, 'A.txt') } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel + ' .commits-agent-activity')})?.textContent === 'Reading A.txt'`, 'the Read is the activity line again', 8000);
  const agentCardSel = '.agent-popover';
  await away();
  const markAt = await hoverOver(markSel);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(agentCardSel)})`, "the marker opens the agent's card", 3000);
  const readAgentCard = () => s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(agentCardSel)}); if (!c) return null; return { member: c.dataset.member, name: c.querySelector('.agent-card-name').textContent, state: c.querySelector('.agent-card-state').textContent, branch: c.querySelector('.agent-card-branch')?.textContent ?? null, session: c.querySelector('.agent-card-session').textContent, activity: c.querySelector('.agent-card-activity')?.textContent ?? null, mark: 'working' in c.querySelector('.session-mark').dataset }; })()`);
  let card = await readAgentCard();
  expect(card.member === 'ag1' && card.name === 'the agent lane' && card.state === 'working' && card.branch === '⑂ agent' && card.mark, `the card names the agent, working, on its branch (${JSON.stringify(card)})`);
  expect(card.session.startsWith(`session ${workerNow.name} · `) && /\d+s$/.test(card.session) && card.activity === 'Reading A.txt', `the session and elapsed, then the activity (${JSON.stringify(card)})`);
  await s.click(markAt.x, markAt.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(markSel)}).dataset.popoverOpen === 'pinned'`, 'a click on the marker pins the card');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector(${JSON.stringify(agentCardSel)})`, 'Escape closes it');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel + ' .commits-agent-status')}).dataset.popoverFor ?? null`)) === null, 'the status word is no anchor');
  step("M65: the marker's card names the agent, its branch, its session and what it is doing");

  // On its side: the agent row is a label after the mark, saying its
  // kind, not its state (M9 fix 398), the same words the upright chip
  // wears.
  await s.evalJs(`document.querySelector('.commits-orient').click()`);
  await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'horizontal'`, 'on its side');
  const side = await s.evalJs(`(() => { const l = document.querySelector('.commits-label[data-agent]'); const m = document.querySelector(${JSON.stringify(markSel)}); return { text: l?.textContent ?? null, member: l?.dataset.member ?? null, mark: m !== null, markWorking: m ? 'working' in m.dataset : null }; })()`);
  expect(side.text === cutLabel('subagent · fork · the agent lane') && side.member === 'ag1' && side.mark && side.markWorking, `the sideways label names the agent's kind after the mark, cut to 24 characters (${JSON.stringify(side)})`);
  await s.evalJs(`document.querySelector('.commits-orient').click()`);
  await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'vertical'`, 'upright again');

  // The agent returns: the same row, node and layout, nothing animating
  // and the ink muted; the activity line keeps its last words.
  await post(worker.id, { hook_event_name: 'SubagentStop', agent_id: 'ag1', agent_type: 'fork' });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.working === undefined`, 'the row goes idle when the agent returns', 8000);
  ag = await agentProbe();
  expect(ag.row === 0 && ag.lane === '1' && ag.status === 'idle' && !ag.markWorking && ag.shimmer === 'none' && ag.activity === 'Reading A.txt', `the same row, idle, still, the activity kept (${JSON.stringify([ag.row, ag.lane, ag.status, ag.markWorking, ag.shimmer, ag.activity])})`);
  expect((await frameShown()) === -1, 'no frame shows on a still mark');
  await s.screenshot('m65-agent-idle.png');
  step("M65: the agent's return leaves the row where it was, still and muted");

  // M9 fix 110: the agent pill's card is the parent's with the agent
  // named, under an anchor of its own.
  const pillSel = '.commits-pill[data-branch="agent"]';
  await away();
  await hoverOver(pillSel);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(cardSel)})`, 'the agent pill opens a card on hover', 3000);
  const agentCard = await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(cardSel)}); return { session: c.dataset.sessionId, agent: c.querySelector('.lane-card-agent')?.textContent ?? null, anchor: document.querySelector(${JSON.stringify(pillSel)}).dataset.popoverFor }; })()`);
  expect(agentCard.session === worker.id && agentCard.agent === 'agent: the agent lane' && agentCard.anchor === `lane:${worker.id}:ag1`, `the card is the parent's and names the agent, its anchor the member's (${JSON.stringify(agentCard)})`);
  await away();
  step("M9 fix 110: the agent pill's card names the agent");

  // Merged on main outside emerald: the merge is a grey node in the outside
  // block; the agent's lane is unchanged, since a session's graph is its
  // own. Then the agent's commit lands as its own... the row stays above
  // G2 until the next prompt clears the team.
  git('merge', '-q', '--no-ff', '-m', 'MA', 'agent');
  const MA = git('rev-parse', 'HEAD').trim();
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(MA))}) !== null`, 'the merge lands', 8000);
  const ma = await nodeOf(MA);
  expect(ma.outside && !ma.hollow && ma.lane === '3', `the merge, made outside emerald, is a filled node on the grey trunk (${JSON.stringify(ma)})`);
  // MA's parents are the shell's B2 and the agent's G2, in other blocks.
  // M68 drew no edge into it; since M9 fix 145 the merged branch is a
  // grey side lane from MA down to G2's row, where it ends under a grey
  // bar, since G2 is not on the trunk's ancestry (B2 is, and the trunk
  // runs through B2's row with nothing drawn); the grey trunk still runs
  // whole from MA to A.
  const maEdges = await s.evalJs(`(() => { const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const row = (h) => rows.findIndex(r => r.dataset.hash === h); const ma = row(${JSON.stringify(MA)}); const a = row(${JSON.stringify(A)}); const g2 = row(${JSON.stringify(G2)}); const es = [...document.querySelectorAll('.commits-edge[data-outside]')].map(e => e.dataset.kind + ':' + e.dataset.from + '-' + e.dataset.to); const g2Node = document.querySelector(${JSON.stringify(nodeSel(G2))}); const bars = [...document.querySelectorAll('.commits-node[data-shape="bar"][data-outside]')].map(b => ({ y: (+b.getAttribute('y1') + +b.getAttribute('y2')) / 2, stroke: getComputedStyle(b).stroke, lane: b.dataset.lane })); return { toMa: es.filter(x => x.endsWith('-' + ma)), trunk: es.includes('outside:' + ma + '-' + a), bars, g2Y: +g2Node.getAttribute('cy'), g2Lane: g2Node.dataset.lane }; })()`);
  expect(maEdges.toMa.length === 1 && maEdges.toMa[0] === 'merge:' + (await rowIndexOf(G2)) + '-' + (await rowIndexOf(MA)) && maEdges.trunk, `the merged branch is one grey merge edge from G2's row into MA, and the grey trunk spans MA to A (${JSON.stringify(maEdges)})`);
  expect(maEdges.bars.length === 1 && maEdges.bars[0].y === maEdges.g2Y && maEdges.bars[0].lane !== maEdges.g2Lane && maEdges.bars[0].stroke === 'rgb(110, 110, 110)', `the grey lane ends under a grey bar at G2's row, on a lane of the grey block's (${JSON.stringify(maEdges)})`);
  expect((await s.evalJs(`document.querySelector('.commits-pill[data-branch="agent"]')?.dataset.merged ?? null`)) === 'true', "the agent branch's pill reads merged");
  await s.screenshot('m65-agent-merged.png');
  step('M65: a merge made outside emerald is a grey node in the outside block; the agent lane stays');

  // M9 fix 138: the next prompt a person types drops the returned member
  // from the team, and its commits used to fall out of the block with it
  // (to the grey block, or onto the parent's own line once merged). The
  // daemon folds them into the record with the agent on them now, so
  // G2 and G1 keep the member's lane and the agent pill, with no agent
  // row above them since the agent is gone.
  await post(worker.id, { hook_event_name: 'UserPromptSubmit', prompt: 'and now the next thing' });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const w = r.sessions.find(x => x.id === ${JSON.stringify(worker.id)}); return w.team.length === 0; })()`, 'the prompt drops the returned member', 8000);
  const folded = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === worker.id).commits;
  const foldedAgent = folded.filter((c) => c.agent !== undefined).map((c) => `${c.hash.slice(0, 7)}:${c.agent.id}:${c.agent.branch}`);
  expect(foldedAgent.join(',') === `${G1.slice(0, 7)}:ag1:agent,${G2.slice(0, 7)}:ag1:agent` && folded.some((c) => c.hash === O2 && c.agent === undefined), `the record holds the member's two commits with the agent and its branch on them, its own without (${JSON.stringify(foldedAgent)})`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(rowSel)})`, "the agent's row is gone with the member", 8000);
  const g2Folded = await nodeOf(G2);
  const g1Folded = await nodeOf(G1);
  expect(g2Folded.member === 'ag1' && g2Folded.lane === agentLane && g2Folded.session === worker.id && g1Folded.lane === agentLane && g1Folded.member === 'ag1', `G2 and G1 stay on the member's lane in the worker's block (${JSON.stringify([g2Folded, g1Folded])})`);
  const foldedPill = await s.evalJs(`(() => { const p = document.querySelector('.commits-row[data-hash=${JSON.stringify(G2)}] .commits-pill[data-branch="agent"]'); return p ? { anchor: p.dataset.popoverFor ?? null, dashed: getComputedStyle(p).borderTopStyle } : null; })()`);
  expect(foldedPill !== null && foldedPill.anchor === `lane:${worker.id}:ag1` && foldedPill.dashed === 'solid', `the agent pill on G2's row still anchors the member's card (${JSON.stringify(foldedPill)})`);
  const foldedLines = await s.evalJs(`[...document.querySelectorAll('.commits-edge[data-lane=' + ${JSON.stringify(JSON.stringify(agentLane))} + ']')].map(e => e.dataset.kind).join(',')`);
  expect(foldedLines.startsWith('worktree') && !foldedLines.includes('pending'), `the worktree line stands, the pending stretch gone with the row (${foldedLines})`);
  step("M9 fix 138: a member's commits stay on its lane in the block once the next prompt drops it from the team");

  // M57: the worker killed and cleared from the list still colours its
  // block, since the daemon keeps a removed session's record and the
  // graph reads the removed ones too; its lines say gone.
  await zreq(s, 'session.kill', { sessionId: worker.id, remove: true });
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return !r.sessions.some(x => x.id === ${JSON.stringify(worker.id)}); })()`, 'the worker left the list', 10000);
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(O2))})?.dataset.gone !== undefined`, 'the worker block is marked gone', 8000);
  const o2Gone = await nodeOf(O2);
  expect(o2Gone.fill === rgb('#e06c75'), `the block keeps the removed session's colour (${o2Gone.fill})`);
  expect((await ownProbe(worker.id, O2)) === null, "the removed session's own row is gone (M68)");
  // M9 fix 138: and the member's lane with it.
  const g2Removed = await nodeOf(G2);
  expect(g2Removed.member === 'ag1' && g2Removed.lane === agentLane && g2Removed.gone, `the removed session's block keeps its agent's lane (${JSON.stringify(g2Removed)})`);
  step('M57: a session cleared from the list keeps its colour on its block');

  // M9 fix 98: a forty-character branch name on a tip row in a 260px
  // rail: the pill gives way before the subject, which keeps ten
  // characters, and the whole name is in the pill's title.
  const longBranch = 'feature/a-branch-name-of-forty-chars-xyz';
  expect(longBranch.length === 40, `the long branch name is forty characters (${longBranch.length})`);
  git('checkout', '-q', '-b', longBranch, B);
  commit('L1-a-subject-long-enough-to-be-squeezed-by-the-pill');
  git('checkout', '-q', 'main');
  await s.evalJs(`localStorage.setItem('emerald.files', JSON.stringify({ collapsed: false, width: 260 }))`);
  await s.send('Page.reload');
  await s.waitFor(`Math.abs((document.querySelector('.files-rail')?.getBoundingClientRect().width ?? 0) - 260) < 3 && !!document.querySelector('.commits-pill[data-branch=${JSON.stringify(longBranch)}]')`, 'the rail at 260px with the long branch on a pill', 15000);
  // The floor is min(10ch, max-content) since M9 fix 119, which the
  // computed style cannot resolve to a length, so ten characters are
  // measured with a probe span in the row.
  const pillProbe = (branch) =>
    s.evalJs(
      `(() => { const pill = document.querySelector('.commits-pill[data-branch=${JSON.stringify(branch)}]'); const row = pill.closest('.commits-row'); const subject = row.querySelector('.commits-subject'); const text = pill.querySelector('.commits-pill-text'); const probe = document.createElement('span'); probe.style.cssText = 'position:absolute;visibility:hidden;width:10ch'; subject.appendChild(probe); const tenCh = probe.getBoundingClientRect().width; probe.remove(); return { pill: pill.getBoundingClientRect().width, title: pill.title, subject: subject.getBoundingClientRect().width, tenCh, subjectFits: subject.scrollWidth <= subject.clientWidth + 1, cut: text.scrollWidth > text.clientWidth + 1, ellipsis: getComputedStyle(text).textOverflow === 'ellipsis' && getComputedStyle(text).overflow === 'hidden', row: row.getBoundingClientRect().width, parts: [...row.children].map((c) => c.className.replace(/commits-/g, '') + ':' + Math.round(c.getBoundingClientRect().width)).join(' '), flex: getComputedStyle(pill).flex + '|' + getComputedStyle(pill).maxWidth + '|' + getComputedStyle(pill).minWidth }; })()`,
    );
  const squeeze = await pillProbe(longBranch);
  expect(squeeze.subject >= squeeze.tenCh - 0.5 && squeeze.tenCh > 40, `the subject keeps its ten-character floor (${JSON.stringify(squeeze)})`);
  expect(squeeze.pill < 96 && squeeze.pill >= 24, `the pill shrank below its cap (${JSON.stringify(squeeze)})`);
  expect(squeeze.title === longBranch, `the whole name is in the pill's title (${squeeze.title})`);
  // M9 fix 119: the cut pill ends in an ellipsis, from the text span
  // inside the flex box (a flex container's own text never gets one).
  expect(squeeze.cut && squeeze.ellipsis, `the long name is cut with an ellipsis (${JSON.stringify([squeeze.cut, squeeze.ellipsis])})`);
  step('M9 fix 98: a forty-character branch name in a 260px rail, the pill shrinks and the subject keeps ten characters');

  // M9 fix 119: a two-character subject beside a ten-character branch in
  // a 330px rail, where the row has room for the whole pill beside a
  // two-character subject and not beside a ten-character floor: the
  // subject asks for its own width only, so the pill stays whole rather
  // than paying for eight characters of empty room. The rail is a pitch
  // wider than the 330 the step was written at, since M9 fix 305 puts an
  // empty pitch after the worker's own line (its member's lane is on the
  // graph here), so the rows have the room they had.
  const tenBranch = 'ten-chars0';
  expect(tenBranch.length === 10, 'the short branch name is ten characters');
  git('checkout', '-q', '-b', tenBranch, B);
  commit('G9');
  git('checkout', '-q', 'main');
  const railWidth119 = 330 + LANE_GAP;
  await s.evalJs(`localStorage.setItem('emerald.files', JSON.stringify({ collapsed: false, width: ${railWidth119} }))`);
  await s.send('Page.reload');
  await s.waitFor(`Math.abs((document.querySelector('.files-rail')?.getBoundingClientRect().width ?? 0) - ${railWidth119}) < 3 && !!document.querySelector('.commits-pill[data-branch=${JSON.stringify(tenBranch)}]')`, `the rail at ${railWidth119}px with the ten-character branch on a pill`, 15000);
  const whole = await pillProbe(tenBranch);
  expect(whole.subject < whole.tenCh && whole.subjectFits && !whole.cut, `the two-character subject takes its own width and the pill is whole (${JSON.stringify(whole)})`);
  expect(whole.pill + whole.subject > whole.tenCh + 24, `the pill and the subject together take the room a ten-character floor and a nub used to hold (${JSON.stringify(whole)})`);
  await s.evalJs(`localStorage.removeItem('emerald.files')`);
  step('M9 fix 119: a two-character subject leaves the pill whole, a forty-character branch ends in an ellipsis');

  // M68: a session merges its member's branch itself, so the merge
  // commit is its own and the member's lane curves up into it at the
  // merge commit's row, the way a traditional graph draws a merge; no
  // merge-back is promised below, and the member's fork point (main's
  // tip, grey) draws nothing.
  const merger = await spawnIn(repo);
  await post(merger.id, { cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'merge the member' });
  const mbShort = path.join(os.tmpdir(), 'emerald-verify', `m51-mb-${process.pid}`);
  fs.rmSync(mbShort, { recursive: true, force: true });
  git('worktree', 'add', '-q', '-b', 'mb', mbShort, MA);
  const mbWt = fs.realpathSync.native(mbShort);
  const mbGit = gitIn(mbWt);
  await post(merger.id, { cwd: repo, hook_event_name: 'SubagentStart', agent_id: 'mg1', agent_type: 'fork' });
  await post(merger.id, { cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'the merged member', subagent_type: 'fork' }, tool_response: { agentId: 'mg1', description: 'the merged member', status: 'async_launched' } });
  const mbCmd = 'git commit -q -m K1';
  await post(merger.id, { cwd: mbWt, agent_id: 'mg1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: mbCmd } });
  await sleep(300);
  fs.writeFileSync(path.join(mbWt, 'K1.txt'), 'K1');
  mbGit('add', 'K1.txt');
  mbGit('commit', '-q', '-m', 'K1');
  const K1 = mbGit('rev-parse', 'HEAD').trim();
  await post(merger.id, { cwd: mbWt, agent_id: 'mg1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: mbCmd } });
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(K1))})?.dataset.member === 'mg1'`, "K1's node is on the member's lane", 8000);
  const mergeCmd = 'git merge --no-ff -m MK mb';
  await post(merger.id, { cwd: repo, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: mergeCmd } });
  await sleep(300);
  git('merge', '-q', '--no-ff', '-m', 'MK', 'mb');
  const MK = git('rev-parse', 'HEAD').trim();
  await post(merger.id, { cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: mergeCmd } });
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(MK))})?.dataset.session === ${JSON.stringify(merger.id)}`, "MK's node is the merger's own", 8000);
  const merged = await s.evalJs(`(() => { const n = (h) => document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const at = (h) => n(h).getAttribute('cx') + ' ' + n(h).getAttribute('cy'); const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const row = (h) => rows.findIndex(r => r.dataset.hash === h); const k = n(${JSON.stringify(K1)}); const lane = k.dataset.lane; const es = [...document.querySelectorAll('.commits-edge[data-lane=' + JSON.stringify(lane) + ']')]; const merge = es.find(e => e.dataset.kind === 'merge'); const d = merge ? merge.getAttribute('d') : ''; return { mkLane: n(${JSON.stringify(MK)}).dataset.lane, k1Lane: lane, member: k.dataset.member, kinds: es.map(e => e.dataset.kind + ':' + e.dataset.from + '-' + e.dataset.to).sort().join(','), from: merge?.dataset.from ?? null, to: merge?.dataset.to ?? null, k1Row: String(row(${JSON.stringify(K1)})), mkRow: String(row(${JSON.stringify(MK)})), end: d.split(' ').slice(-2).join(' '), mk: at(${JSON.stringify(MK)}), start: d.split(' ').slice(0, 2).join(' ').slice(1), k1: at(${JSON.stringify(K1)}), curve: d.includes('Q'), merges: es.filter(e => e.dataset.kind === 'merge').length }; })()`);
  expect(merged.mkLane === '0' && merged.k1Lane === '1' && merged.member === 'mg1', `MK on the merger's line, K1 on the member's lane (${JSON.stringify(merged)})`);
  expect(merged.merges === 1 && merged.from === merged.k1Row && merged.to === merged.mkRow && merged.start === merged.k1 && merged.end === merged.mk && merged.curve, `one merge edge from K1 up its lane, curving into MK at its row, and no merge-back below (${JSON.stringify(merged)})`);
  // K1's parent MA is grey and on the merger's ancestry (MK sits on
  // it), so the member's lane also curves into the merger's line at
  // MA's row (M9 fix 145).
  expect(merged.kinds === `branch:${merged.k1Row}-${await rowIndexOf(MA)},merge:${merged.k1Row}-${merged.mkRow},pending:${+merged.k1Row - 1}-${merged.k1Row}`, `the member's lane carries the merge, the bend into the merger's line at MA's row and its row's pending stretch (${merged.kinds})`);
  await s.screenshot('m68-member-merged.png');
  step("M68: a session's own merge commit takes the member's lane into it, as a traditional graph draws a merge");

  // M70: a commit whose Claude-Session trailer names a conversation on
  // this machine. A transcript is seeded under the harness's Claude home
  // for the repo, naming session_verify70 in a remote_session_change
  // attachment, and a commit with that trailer is made by hand: it lands
  // outside first (no record holds the id), the panel asks for a history
  // scan, and the commit moves to a history lane named after the
  // conversation, gone, in a colour of the transcript's own; the outside
  // card counts it as on a history lane rather than nobody's.
  const T70 = 'd7d7d7d7-0000-4000-8000-000000000070';
  const claudeDir = path.join(claudeHome, 'projects', encode(repo));
  fs.mkdirSync(claudeDir, { recursive: true });
  const tAt = Date.now() - 3_600_000;
  const iso = (ms) => new Date(ms).toISOString();
  const jl = (o) => `${JSON.stringify(o)}\n`;
  fs.writeFileSync(
    path.join(claudeDir, `${T70}.jsonl`),
    jl({ type: 'ai-title', aiTitle: 'Click through the batch', sessionId: T70 }) +
      jl({ type: 'user', message: { role: 'user', content: 'build and click through' }, cwd: repo, gitBranch: 'main', timestamp: iso(tAt) }) +
      jl({ type: 'attachment', attachment: { type: 'remote_session_change', url: 'https://claude.ai/code/session_verify70', commit: 'Claude-Session: https://claude.ai/code/session_verify70' }, timestamp: iso(tAt + 1000) }) +
      jl({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'Done.' }] }, cwd: repo, timestamp: iso(tAt + 2000) }),
  );
  // A second conversation for the M71 block below, written now since
  // the graph asks for one scan only; nothing names it until then.
  const T71 = 'd7d7d7d7-0000-4000-8000-000000000071';
  fs.writeFileSync(
    path.join(claudeDir, `${T71}.jsonl`),
    jl({ type: 'ai-title', aiTitle: 'Merge a branch by hand', sessionId: T71 }) +
      jl({ type: 'user', message: { role: 'user', content: 'merge it' }, cwd: repo, gitBranch: 'main', timestamp: iso(tAt + 10_000) }) +
      jl({ type: 'attachment', attachment: { type: 'remote_session_change', url: 'https://claude.ai/code/session_verify71', commit: 'Claude-Session: https://claude.ai/code/session_verify71' }, timestamp: iso(tAt + 11_000) }) +
      jl({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'Merged.' }] }, cwd: repo, timestamp: iso(tAt + 12_000) }),
  );
  const outsideBefore = (await graphProbe()).outside;
  git('commit', '-q', '--allow-empty', '-m', 'H1', '-m', 'Claude-Session: https://claude.ai/code/session_verify70');
  const H1 = git('rev-parse', 'HEAD').trim();
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(H1))})?.dataset.history === ${JSON.stringify(T70)}`, 'H1 lands on a history lane once the scan is in', 15000);
  const h1 = await s.evalJs(
    `(() => { const n = document.querySelector(${JSON.stringify(nodeSel(H1))}); const g = n.closest('.commits-lane-group'); const row = document.querySelector('.commits-row[data-hash=' + JSON.stringify(${JSON.stringify(H1)}) + ']'); return { session: n.dataset.session, gone: 'gone' in n.dataset, outside: 'outside' in n.dataset, fill: getComputedStyle(n).fill, group: g?.dataset.history ?? null, groupSession: g?.dataset.session ?? null, rowOwner: row?.dataset.owner ?? null, rowHistory: row ? 'history' in row.dataset : null, title: row?.getAttribute('title') ?? null, outsideNodes: document.querySelectorAll('.commits-node[data-outside]').length }; })()`,
  );
  expect(h1.session === `history:${T70}` && h1.gone && !h1.outside, `H1's node is on the conversation's lane, gone, not outside (${JSON.stringify(h1)})`);
  expect(h1.group === T70 && h1.groupSession === `history:${T70}`, `its lane group carries the transcript id (${JSON.stringify(h1)})`);
  expect(h1.rowOwner === `history:${T70}` && h1.rowHistory && h1.title === null, `the row is owned by the conversation and carries no tooltip (M73), got ${JSON.stringify(h1)}`);
  // M73 task 4: the row's card says who made it, where the tooltip did.
  const h1RowSel = `.commits-row[data-hash=${JSON.stringify(H1)}]`;
  // The row has just landed and the strip above may still be growing a
  // track (the settled() note above); measure once it stops moving, and
  // in view, since the rows may sit scrolled from the steps before.
  await s.evalJs(`document.querySelector(${JSON.stringify(h1RowSel)})?.scrollIntoView({ block: 'nearest' })`);
  await settled(h1RowSel);
  const h1At = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(h1RowSel + ' .commits-subject')}).getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; })()`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h1At.x, y: h1At.y });
  const h1CardSel = `.commit-popover[data-hash=${JSON.stringify(H1)}]`;
  await s.screenshot('m73-h1-row-hover.png');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(h1CardSel)})`, "H1's row opens the commit card on hover", 3000);
  const h1Card = await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(h1CardSel)}); const part = (p) => c.querySelector('[data-part=' + JSON.stringify(p) + '] .sweep-card-text')?.textContent ?? null; return { heading: c.querySelector('.sweep-card-heading').textContent, hash: part('hash'), author: part('author'), by: part('by') }; })()`);
  expect(h1Card.hash === H1 && h1Card.by === 'Click through the batch, a conversation emerald did not host' && h1Card.author !== null && h1Card.author.includes(', '), `the card carries the whole hash, the author and time, and who made it, got ${JSON.stringify(h1Card)}`);
  await s.click(h1At.x, h1At.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(h1RowSel)}).dataset.popoverOpen === 'pinned'`, 'a click on the row pins the card');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector(${JSON.stringify(h1CardSel)})`, 'Escape closes it');
  step("M73 task 4: a commit row opens its card with the whole hash, the author and time and who made it, pinned by a click; the row carries no tooltip");
  expect(h1.outsideNodes === outsideBefore, `the outside block is as it was, the trailer commit not in it (${h1.outsideNodes} against ${outsideBefore})`);
  expect(h1.fill !== 'rgb(110, 110, 110)', `the lane has a colour of its own, not the outside grey (${h1.fill})`);
  await away();
  // The outside card, pinned by a click on one of the block's nodes in
  // view (the list may be scrolled, and a press on a node out of view
  // lands on something else).
  const topOutside = await s.evalJs(`(() => { const list = document.querySelector('.commits-panel .files-list').getBoundingClientRect(); const inView = (n) => { const r = n.getBoundingClientRect(); return r.top >= list.top && r.bottom <= list.bottom; }; return [...document.querySelectorAll('.commits-node[data-outside]')].find(inView)?.dataset.hash ?? null; })()`);
  expect(topOutside !== null, 'an outside node in view to press');
  const outsideAt = await hoverOver(nodeSel(topOutside));
  await s.click(outsideAt.x, outsideAt.y);
  await s.waitFor(`!!document.querySelector('.outside-popover')`, 'the outside card opens on a click', 3000);
  const outsideCard = await s.evalJs(`(() => { const c = document.querySelector('.outside-popover'); return { history: c.dataset.history, line: c.querySelector('.outside-card-kind[data-kind="history"]')?.textContent ?? null }; })()`);
  expect(outsideCard.history === '1' && outsideCard.line !== null && outsideCard.line.startsWith('1 more on history lanes'), `the outside card names the commit on a history lane (${JSON.stringify(outsideCard)})`);
  await s.key('Escape', 'Escape', 27);
  await away();
  await s.screenshot('m70-history-lane.png');
  step("M70: a trailer naming a conversation on this machine puts the commit on a history lane named after it, out of the grey block");

  // The lane's card: the conversation's title, the kind line, the folder,
  // the dates, the count, Resume and Transcript; a click pins it.
  const laneNodeSel = `.commits-lane-group[data-history=${JSON.stringify(T70)}] .commits-node`;
  await settled(laneNodeSel);
  const laneAt = await hoverOver(laneNodeSel);
  const underLane = () => s.evalJs(`(() => { const e = document.elementFromPoint(${laneAt.x}, ${laneAt.y}); return e ? e.tagName + '.' + (e.getAttribute('class') ?? '') + '#' + (e.dataset.session ?? e.dataset.hash ?? '') : null; })()`);
  await s.waitFor(`!!document.querySelector('.history-popover')`, `the history lane opens the conversation's card (under the pointer: ${JSON.stringify(await underLane())})`, 3000);
  const hCard = await s.evalJs(
    `(() => { const c = document.querySelector('.history-popover'); return { transcript: c.dataset.transcriptId, name: c.querySelector('.lane-card-name').textContent, kind: c.querySelector('.history-card-kind').textContent, where: c.querySelector('.lane-card-where').textContent, when: c.querySelector('.history-card-when')?.textContent ?? null, commits: c.querySelector('.lane-card-commits').textContent, actions: [...c.querySelectorAll('.lane-card-action')].map((b) => b.dataset.action + (b.disabled ? '!' : '')).join(',') }; })()`,
  );
  expect(hCard.transcript === T70 && hCard.name === 'Click through the batch' && hCard.kind === 'a Claude Code conversation emerald did not host', `the card names the conversation and its kind (${JSON.stringify(hCard)})`);
  expect(hCard.where === path.basename(repo) && hCard.when !== null && /^started \d+(h|m)( \d+m)? ago, last \d+(h|m)( \d+m)? ago$/.test(hCard.when) && hCard.commits === '1 commit here', `the folder, the dates and the count (${JSON.stringify(hCard)})`);
  expect(hCard.actions === 'resume,transcript,layout,solo,lines', `Resume and Transcript, both live, the Graph toggle (M71) and the lines actions (M72) (${hCard.actions})`);
  await s.click(laneAt.x, laneAt.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(`.commits-lane-group[data-history=${JSON.stringify(T70)}]`)}).dataset.popoverOpen === 'pinned'`, 'a click pins the card');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.history-popover')`, 'Escape closes it');
  step("M70: the history lane's card names the conversation, where and when it ran, its commits, with Resume and Transcript");

  // Resume: a Claude session starts in the transcript's folder with
  // --resume and the id, beside the focused pane; once the daemon reads
  // the transcript's remote id off a SessionStart naming the file, the
  // record owns the trailer and the lane is the session's, not history's.
  const before70 = (await zreq(s, 'session.list', {})).sessions.map((x) => x.id);
  await away();
  await settled(laneNodeSel);
  await hoverOver(laneNodeSel);
  await s.waitFor(`!!document.querySelector('.history-popover')`, 'the card again', 3000);
  await s.evalJs(`document.querySelector('.history-popover .lane-card-action[data-action="resume"]').click()`);
  let resumed = null;
  for (let i = 0; i < 50 && resumed === null; i++) {
    const { sessions } = await zreq(s, 'session.list', {});
    resumed = sessions.find((x) => !before70.includes(x.id)) ?? null;
    if (resumed === null) await sleep(100);
  }
  expect(resumed !== null && resumed.kind === 'claude' && resumed.args.join(' ') === `--resume ${T70}` && resumed.spawnCwd === repo, `Resume started a Claude session with --resume and the id in the repo (${JSON.stringify(resumed && [resumed.kind, resumed.args, resumed.spawnCwd])})`);
  await post(resumed.id, { session_id: T70, cwd: repo, hook_event_name: 'SessionStart', source: 'resume', transcript_path: path.join(claudeDir, `${T70}.jsonl`) });
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(H1))})?.dataset.session === ${JSON.stringify(resumed.id)}`, "H1 moves to the resumed session's lane once the daemon reads the transcript's id", 10000);
  const reclaimed = await s.evalJs(`(() => { const n = document.querySelector(${JSON.stringify(nodeSel(H1))}); return { history: n.dataset.history ?? null, gone: 'gone' in n.dataset, groups: document.querySelectorAll('.commits-lane-group[data-history]').length }; })()`);
  expect(reclaimed.history === null && !reclaimed.gone && reclaimed.groups === 0, `no history lane is left; the commit is the session's own (${JSON.stringify(reclaimed)})`);
  await s.screenshot('m70-reclaimed.png');
  // The pointer is still over the graph from the hover: the next step
  // moves every row (the live sessions' rows jump over each new head
  // of main, M9 fix 151), and a lane group replaced under a stationary
  // pointer leaves its card open with no mouseleave to close it.
  await away();
  step('M70: Resume starts the conversation again and its commits become that session\'s');

  // M71: columns. Four sessions one after another on main, each making
  // one commit with two hand-made commits between each pair so no two
  // blocks come within a row of each other, and each removed after its
  // commit so its block is its commit and its start dot alone: the four
  // share one column (their nodes on one slot), the gutter grows by at
  // most one column, and each block's lines keep its own colour.
  const columnsBefore = +(await s.evalJs(`document.querySelector('.commits-panel').dataset.columns`));
  const packed = [];
  for (let k = 1; k <= 4; k += 1) {
    commit(`Z${k}a`);
    commit(`Z${k}b`);
    const sess = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo, cols: 80, rows: 24 })).session;
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(sess.id)})?.startHead !== null; })()`, `session ${k} knows its start commit`, 8000);
    const color = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === sess.id).color;
    const hash = await commitVia(sess.id, git, `C${k}`, repo);
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(hash))})?.dataset.session === ${JSON.stringify(sess.id)}`, `C${k} lands on session ${k}'s lane`, 8000);
    await removeSession(sess.id);
    packed.push({ id: sess.id, hash, color });
  }
  await s.waitFor(`!document.querySelector('.commits-agent-row[data-session=${JSON.stringify(packed[3].id)}]') && document.querySelector(${JSON.stringify(nodeSel(packed[3].hash))})?.dataset.gone !== undefined`, 'the last of the four is gone from the list, its lane kept', 8000);
  const cols = await s.evalJs(`(() => { const n = (h) => document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const hashes = ${JSON.stringify(packed.map((x) => x.hash))}; return { lanes: hashes.map((h) => n(h).dataset.lane), groups: hashes.map((h) => n(h).dataset.block), fills: hashes.map((h) => getComputedStyle(n(h)).fill), columns: +document.querySelector('.commits-panel').dataset.columns, lanesCount: +document.querySelector('.commits-panel').dataset.lanes, xs: hashes.map((h) => +n(h).getAttribute('cx')) }; })()`);
  expect(new Set(cols.lanes).size === 1 && new Set(cols.xs).size === 1, `the four commits sit on one column (${JSON.stringify(cols)})`);
  expect(new Set(cols.groups).size === 4, `four blocks on that column (${JSON.stringify(cols.groups)})`);
  expect(cols.columns <= columnsBefore + 1, `the gutter grew by at most one column, from ${columnsBefore} to ${cols.columns}`);
  expect(cols.lanesCount >= 4 && cols.fills.every((f, i) => f === rgb(packed[i].color)), `every block keeps its own colour on its node (${JSON.stringify([cols.fills, packed.map((x) => x.color)])})`);
  await s.screenshot('m71-columns.png');
  step('M71: four sessions one after another share one column, each in its own colour');

  // A history block draws as one line until its card opens it up: a
  // conversation on disk (seeded with T70 above) merged a branch of its
  // own by hand, with the trailer on both commits; the merge folds onto
  // the block's one lane, Graph on the card gives it its side lane and
  // merge curve, Line folds it again, and the header's switch clears the
  // choice.
  git('checkout', '-q', '-b', 'hb');
  fs.writeFileSync(path.join(repo, 'HB1.txt'), 'HB1');
  git('add', 'HB1.txt');
  git('commit', '-q', '-m', 'HB1', '-m', 'Claude-Session: https://claude.ai/code/session_verify71');
  const HB1 = git('rev-parse', 'HEAD').trim();
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'HM', '-m', 'Claude-Session: https://claude.ai/code/session_verify71', 'hb');
  const HM = git('rev-parse', 'HEAD').trim();
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(HM))})?.dataset.history === ${JSON.stringify(T71)} && document.querySelector(${JSON.stringify(nodeSel(HB1))})?.dataset.history === ${JSON.stringify(T71)}`, 'both commits land on the second conversation history lane', 15000);
  const historyProbe = () => s.evalJs(`(() => { const n = (h) => document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const edges = [...document.querySelectorAll('.commits-edge[data-history=' + JSON.stringify(${JSON.stringify(T71)}) + ']')].map(e => e.dataset.kind).sort().join(','); return { hm: n(${JSON.stringify(HM)}).dataset.lane, hb1: n(${JSON.stringify(HB1)}).dataset.lane, edges, columns: +document.querySelector('.commits-panel').dataset.columns }; })()`);
  let hist = await historyProbe();
  expect(hist.hm === hist.hb1 && hist.edges === 'session', `one lane, the merge folded, the block's own line alone (${JSON.stringify(hist)})`);
  const histLaneSel = `.commits-lane-group[data-history=${JSON.stringify(T71)}] .commits-node`;
  const layoutOn = async (want) => {
    await away();
    await settled(histLaneSel);
    await hoverOver(histLaneSel);
    await s.waitFor(`document.querySelector('.history-popover .lane-card-action[data-action="layout"]')?.textContent === ${JSON.stringify(want)}`, `the card offers ${want}`, 3000);
    await s.evalJs(`document.querySelector('.history-popover .lane-card-action[data-action="layout"]').click()`);
    await s.waitFor(`!document.querySelector('.history-popover')`, 'the card closes on the click');
  };
  await layoutOn('Graph');
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(HB1))})?.dataset.lane !== document.querySelector(${JSON.stringify(nodeSel(HM))})?.dataset.lane`, 'the branch takes a lane of its own', 5000);
  hist = await historyProbe();
  // HB1's parent (the last packed session's commit, C4) is in the log
  // in another block and on HM's ancestry, so since M9 fix 145 the
  // branch curves into the history block's own line at C4's row and
  // the line reaches down to it; with the merge curve out of HM, three
  // edges once opened.
  expect(hist.edges === 'branch,merge,session', `opened up: the merge curve out of HM into the branch's lane, the branch's bend into the line at C4's row and the line down to it (${JSON.stringify(hist)})`);
  await s.screenshot('m71-history-open.png');
  await layoutOn('Line');
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(HB1))})?.dataset.lane === document.querySelector(${JSON.stringify(nodeSel(HM))})?.dataset.lane`, 'folded again', 5000);
  await layoutOn('Graph');
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(HB1))})?.dataset.lane !== document.querySelector(${JSON.stringify(nodeSel(HM))})?.dataset.lane`, 'open once more', 5000);
  await s.evalJs(`document.querySelector('.commits-switch [data-view="list"]').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.view === 'list' && document.querySelector(${JSON.stringify(nodeSel(HB1))})?.dataset.lane === document.querySelector(${JSON.stringify(nodeSel(HM))})?.dataset.lane`, "the header's List clears the block's own choice", 5000);
  expect(JSON.parse(await s.evalJs(`localStorage.getItem('emerald.commitsGraph')`)).layout !== undefined && Object.keys(JSON.parse(await s.evalJs(`localStorage.getItem('emerald.commitsGraph')`)).layout).length === 0, 'the prefs hold no override after the switch');
  await s.evalJs(`document.querySelector('.commits-switch [data-view="graph"]').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.view === 'graph'`, 'graph again');
  step("M71: a history block is one line until its card's Graph opens it up, Line folds it, and the switch clears the choice");

  // The floor: the rail at 260px with the columns so far, and twelve
  // more sessions each committing on top of the last (each one's start
  // dot on the previous commit's row, so neighbours never pack), put
  // the gutter past the rail; the rows keep their hashes on screen and
  // the gutter scrolls sideways under them.
  const stack = [];
  for (let k = 1; k <= 12; k += 1) {
    const sess = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo, cols: 80, rows: 24 })).session;
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(sess.id)})?.startHead !== null; })()`, `stack session ${k} knows its start commit`, 8000);
    stack.push({ id: sess.id, hash: await commitVia(sess.id, git, `S${k}`, repo) });
  }
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(stack[11].hash))})?.dataset.session === ${JSON.stringify(stack[11].id)}`, 'the last stacked commit is on its session lane', 8000);
  await s.evalJs(`localStorage.setItem('emerald.files', JSON.stringify({ collapsed: false, width: 260 }))`);
  await s.send('Page.reload');
  await s.waitFor(`Math.abs((document.querySelector('.files-rail')?.getBoundingClientRect().width ?? 0) - 260) < 3 && !!document.querySelector(${JSON.stringify(nodeSel(stack[11].hash))})`, 'the rail at 260px with the stack drawn', 15000);
  const floor = await s.evalJs(`(() => { const v = document.querySelector('.commits-graph-view[data-orientation="vertical"]'); const g = v.querySelector('.commits-gutter'); const rows = v.querySelector('.commits-graph-rows'); const rail = document.querySelector('.files-rail').getBoundingClientRect(); const hashes = [...rows.querySelectorAll('.commits-hash')].map(h => h.getBoundingClientRect()); return { scrolls: v.dataset.gutter ?? null, gutterWidth: g.clientWidth, gutterScroll: g.scrollWidth, rowsWidth: rows.getBoundingClientRect().width, columns: +document.querySelector('.commits-panel').dataset.columns, hashesOn: hashes.filter(r => r.right <= rail.right + 1 && r.left >= rail.left - 1 && r.width > 0).length, hashes: hashes.length, scrollLeft: g.scrollLeft }; })()`);
  // The stack packs into a few columns (each block spans its own row,
  // its commit and its start dot, and every third is clear of the
  // first), so the columns grow by three or so; with the rail at 260px
  // that is past the rows' floor all the same.
  expect(floor.scrolls === 'scrolls' && floor.gutterScroll > floor.gutterWidth, `the gutter outgrows the rail and says so (${JSON.stringify(floor)})`);
  expect(floor.rowsWidth >= 119 && floor.hashesOn === floor.hashes && floor.hashes > 0, `the rows keep their floor and every hash is on screen (${JSON.stringify(floor)})`);
  await s.evalJs(`document.querySelector('.commits-gutter').scrollLeft = 60`);
  const scrolled = await s.evalJs(`document.querySelector('.commits-gutter').scrollLeft`);
  expect(scrolled > 0 && scrolled <= 60, `the gutter scrolls sideways, as far as it overflows (${scrolled} of ${floor.gutterScroll - floor.gutterWidth})`);
  await s.screenshot('m71-gutter-scrolls.png');
  step('M71: a gutter wider than the rail scrolls sideways under rows that keep a 120px floor');

  // M9 fix 141: the cut edge says there is more. At the start the right
  // fade is painted and the left is not; scrolled halfway in (the
  // overflow can be under 60px), both are; scrolled to the end the view
  // says `end`, the right fade is gone and the left stays; back at the
  // start the left goes too.
  const fades = () =>
    s.evalJs(
      `(() => { const v = document.querySelector('.commits-graph-view[data-orientation="vertical"]'); const box = v.querySelector('.commits-gutter-box'); const g = v.querySelector('.commits-gutter'); const on = (side) => getComputedStyle(box, side).content !== 'none'; return { gutter: v.dataset.gutter ?? null, back: v.dataset.gutterBack !== undefined, right: on('::after'), left: on('::before'), scrollLeft: g.scrollLeft, rest: g.scrollWidth - g.clientWidth }; })()`,
    );
  // A scroll event lands with the rendering steps, which a window off
  // screen or covered may not run, so each scroll here is driven whole:
  // the position set and the event dispatched.
  const scrollGutter = (to) => s.evalJs(`(() => { const g = document.querySelector('.commits-gutter'); g.scrollLeft = ${to}; g.dispatchEvent(new Event('scroll')); return g.scrollLeft; })()`);
  const half = Math.floor((floor.gutterScroll - floor.gutterWidth) / 2);
  expect(half >= 2, `the gutter overflows by enough to scroll halfway (${floor.gutterScroll - floor.gutterWidth}px)`);
  await scrollGutter(half);
  await s.waitFor(`(() => { const v = document.querySelector('.commits-graph-view[data-orientation="vertical"]'); return v?.dataset.gutter === 'scrolls' && v.dataset.gutterBack !== undefined; })()`, 'the view says scrolls with more behind once scrolled halfway in', 3000);
  const midFade = await fades();
  expect(midFade.gutter === 'scrolls' && midFade.back && midFade.right && midFade.left && midFade.scrollLeft > 0, `scrolled halfway in, the view says scrolls with both fades painted (${JSON.stringify(midFade)})`);
  await scrollGutter(10000);
  await s.waitFor(`document.querySelector('.commits-graph-view[data-orientation="vertical"]')?.dataset.gutter === 'end'`, 'the view says end once the gutter is scrolled to its end', 3000);
  const endFade = await fades();
  expect(endFade.gutter === 'end' && endFade.back && !endFade.right && endFade.left && endFade.scrollLeft >= endFade.rest - 1, `at the end the right fade is gone and the left stays (${JSON.stringify(endFade)})`);
  await s.screenshot('m9-fix141-gutter-end.png');
  await scrollGutter(0);
  await s.waitFor(`(() => { const v = document.querySelector('.commits-graph-view[data-orientation="vertical"]'); return v?.dataset.gutter === 'scrolls' && v.dataset.gutterBack === undefined; })()`, 'back at the start the left fade goes', 3000);
  const startFade = await fades();
  expect(startFade.gutter === 'scrolls' && !startFade.back && startFade.right && !startFade.left, `at the start the right fade alone is painted (${JSON.stringify(startFade)})`);
  await s.evalJs(`localStorage.removeItem('emerald.files')`);
  step("M9 fix 141: a fade at the gutter's cut edge while there is more that way, on the box around the scrolling gutter, gone at the end and at the start");

  // M72: draw only some of the graph. The rule: the rows never change,
  // every filter acts on the gutter's lanes. `active` draws lanes for
  // the sessions in the sidebar alone, so the history block and the
  // grey block lose their lines while every row stays; Show only this
  // on a card draws one block and the header reads `some`; a click on
  // the header brings every block back; a click on a row's hash hides
  // its block's lines and marks the rows, the row's menu says Show its
  // lines, and the hash again brings them back; a reload keeps it all.
  const drawProbe = () =>
    s.evalJs(
      `(() => { const p = document.querySelector('.commits-panel'); const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; return { draw: p.dataset.draw, drawn: +p.dataset.drawn, blocks: +p.dataset.blocks, columns: +p.dataset.columns, rows: rows.length, hashes: rows.filter((r) => r.querySelector('.commits-hash')).length, hidden: rows.filter((r) => r.dataset.lines === 'hidden').length, historyNodes: document.querySelectorAll('.commits-node[data-history]').length, outsideNodes: document.querySelectorAll('.commits-node[data-outside]').length, historyEdges: document.querySelectorAll('.commits-edge[data-history]').length, outsideEdges: document.querySelectorAll('.commits-edge[data-outside]').length, chips: [...document.querySelectorAll('.commits-draw .commits-chip')].map((c) => c.dataset.draw + (c.dataset.active !== undefined ? '*' : '')).join(',') }; })()`,
    );
  const allState = await drawProbe();
  expect(allState.draw === 'all' && allState.chips === 'all*,active' && allState.drawn === allState.blocks && allState.historyNodes > 0 && allState.outsideNodes > 0, `every block draws under all (${JSON.stringify(allState)})`);
  await s.evalJs(`document.querySelector('.commits-draw [data-draw="active"]').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.draw === 'active'`, 'active');
  const activeState = await drawProbe();
  expect(activeState.historyNodes === 0 && activeState.historyEdges === 0 && activeState.outsideNodes === 0 && activeState.outsideEdges === 0, `the history and outside blocks draw no lines under active (${JSON.stringify(activeState)})`);
  expect(activeState.rows === allState.rows && activeState.hashes === allState.hashes && activeState.hashes === allState.hashes, `every row and every hash is still there (${activeState.rows} rows against ${allState.rows})`);
  expect(activeState.columns < allState.columns && activeState.drawn < allState.drawn && activeState.chips === 'all,active*', `the gutter narrows by the undrawn blocks (${activeState.columns} against ${allState.columns} columns, ${activeState.drawn} of ${activeState.blocks} blocks drawn)`);
  const hiddenExpected = await s.evalJs(`(() => { const live = new Set([...document.querySelectorAll('.sidebar-row[data-session-id]')].map((r) => r.dataset.sessionId)); return [...document.querySelectorAll('.commits-graph-rows .commits-row[data-hash]')].filter((r) => !live.has(r.dataset.owner)).length; })()`);
  expect(activeState.hidden === hiddenExpected && activeState.hidden > 0, `the rows of the undrawn blocks say so (${activeState.hidden} hidden, ${hiddenExpected} not a sidebar session's)`);
  await s.screenshot('m72-active.png');
  step("M72: active draws lanes for the sidebar's sessions alone, every row staying");

  // Show only this, from the merger's card (a live session).
  await s.evalJs(`document.querySelector('.commits-draw [data-draw="all"]').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.draw === 'all'`, 'all again');
  await away();
  // MK sits far down the list by now; the pointer needs it on screen.
  const inView = (sel) => s.evalJs(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
  await inView(nodeSel(MK));
  await hoverForAction(nodeSel(MK), 'solo', "the merger's card offers Show only this");
  await s.evalJs(`document.querySelector('.lane-popover .lane-card-action[data-action="solo"]').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.draw === 'some' && document.querySelector('.commits-panel')?.dataset.drawn === '1'`, 'one block drawn and the header reads some', 5000);
  const soloState = await drawProbe();
  // The commit rows stay whole; the agent rows of the undrawn blocks go
  // with their lanes, since they are the gutter's, not the log's.
  expect(soloState.chips === 'some*' && soloState.hashes === allState.hashes && soloState.rows < allState.rows && soloState.drawn === 1, `the chip reads some, every commit row there, one block drawn (${JSON.stringify(soloState)})`);
  expect((await s.evalJs(`[...document.querySelectorAll('.commits-node[data-hash]')].every((n) => n.dataset.session === ${JSON.stringify(merger.id)})`)) === true, "every node left is the merger's");
  await s.screenshot('m72-solo.png');
  await s.evalJs(`document.querySelector('.commits-draw [data-draw="some"]').click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.draw === 'all' && document.querySelector('.commits-panel')?.dataset.drawn === ${JSON.stringify(String(allState.blocks))}`, 'the click on some brings every block back', 5000);
  step("M72: Show only this on a card draws one block, the header reads some, and its click brings every block back");

  // The row's way back: the hash of one of the merger's rows hides its
  // block's lines, the rows say so, the menu on one reads Show its
  // lines, and the hash again brings them back; a reload keeps the
  // hidden set.
  const mkRowSel = `.commits-row[data-hash=${JSON.stringify(MK)}]`;
  const mergerName = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === merger.id).name;
  await s.evalJs(`document.querySelector(${JSON.stringify(mkRowSel + ' .commits-hash')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(mkRowSel)})?.dataset.lines === 'hidden' && !document.querySelector(${JSON.stringify(nodeSel(MK))})`, "the hash click hides the merger's lines and marks its rows", 5000);
  const hidState = await drawProbe();
  const mkHash = await s.evalJs(`(() => { const h = document.querySelector(${JSON.stringify(mkRowSel + ' .commits-hash')}); return { opacity: getComputedStyle(h).opacity, cursor: getComputedStyle(h).cursor, title: h.title, rows: [...document.querySelectorAll('.commits-row[data-owner=' + JSON.stringify(${JSON.stringify(merger.id)}) + ']')].map((r) => r.dataset.lines ?? 'drawn').join(',') }; })()`);
  expect(hidState.draw === 'some' && hidState.hashes === allState.hashes && hidState.drawn === allState.blocks - 1, `one block hidden, the commit rows whole, the chip some (${JSON.stringify(hidState)})`);
  expect(mkHash.opacity === '0.6' && mkHash.cursor === 'pointer' && mkHash.title === 'Show its lines' && mkHash.rows === 'hidden,hidden', `the merger's rows say hidden with a dim hash and a title (${JSON.stringify(mkHash)})`);
  await inView(mkRowSel);
  await settled(mkRowSel);
  const mkAt = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(mkRowSel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(mkAt.x, mkAt.y);
  await s.waitFor(`!!document.querySelector('.commits-menu')`, "the row's menu");
  const rowMenu = await s.evalJs(`[...document.querySelectorAll('.commits-menu .menu-label')].map((l) => l.textContent.trim()).join('|')`);
  expect(rowMenu.startsWith(`Show only ${mergerName}'s lines|Show its lines|`) && rowMenu.endsWith('Oldest first|Centre the graph'), `the row's menu names the block above the direction items and the centre item (M9 fix 170) (${rowMenu})`);
  await clickText('.commits-menu .menu-label', 'Show its lines');
  await s.waitFor(`document.querySelector(${JSON.stringify(mkRowSel)})?.dataset.lines === undefined && !!document.querySelector(${JSON.stringify(nodeSel(MK))})`, "the menu's Show its lines brings the block back", 5000);
  await s.evalJs(`document.querySelector(${JSON.stringify(mkRowSel + ' .commits-hash')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(mkRowSel)})?.dataset.lines === 'hidden'`, 'hidden again by the hash', 5000);
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector(${JSON.stringify(mkRowSel)})?.dataset.lines === 'hidden' && document.querySelector('.commits-panel')?.dataset.draw === 'some'`, 'the hidden set survives a reload', 15000);
  await s.evalJs(`document.querySelector(${JSON.stringify(mkRowSel + ' .commits-hash')}).click()`);
  await s.waitFor(`document.querySelector('.commits-panel')?.dataset.draw === 'all'`, 'the hash click again brings the lanes back and the chip reads all', 5000);
  await s.screenshot('m72-row-hidden.png');
  step("M72: a row's hash hides its block's lines and brings them back, the row's menu says which, and a reload keeps the choice");

  // M9 fix 211: with the rows off the picture is the drawn range long,
  // not the whole log. On its side under `all` the SVG is every row's
  // 24px; with one block shown alone it is that block's rows alone, the
  // view scrolling the two rooms plus that and the old room no wider
  // than half the view; and a node parked near the leading edge stays
  // where it is while the picture's start moves under it (fix 210's
  // anchor, with the nearest node of every other block behind the
  // leading one). Then the same upright with the rows off, reading
  // heights against the 22px pitch.
  const extentProbe = (axis) =>
    s.evalJs(
      `(() => { const v = document.querySelector('.files-rail .commits-graph-view'); const box = ${axis === 'x' ? 'v' : 'v.parentElement'}; const svg = v.querySelector('.commits-graph'); const size = (el) => (el ? Math.round(el.getBoundingClientRect()[${JSON.stringify(axis === 'x' ? 'width' : 'height')}] * 10) / 10 : null); return { rows: +svg.dataset.rows, drawn: +svg.dataset.drawnRows, from: +svg.dataset.drawnFrom, svg: +svg.getAttribute(${JSON.stringify(axis === 'x' ? 'width' : 'height')}), room: size(v.querySelector('.commits-room')), old: size(v.querySelector('.commits-room-old')), scroll: box[${JSON.stringify(axis === 'x' ? 'scrollWidth' : 'scrollHeight')}], client: box[${JSON.stringify(axis === 'x' ? 'clientWidth' : 'clientHeight')}] }; })()`,
    );
  const railMK = `.files-rail ${nodeSel(MK)}`;
  const mkScreen = () => s.evalJs(`(() => { const n = document.querySelector(${JSON.stringify(railMK)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * 10) / 10, y: Math.round((r.y + r.height / 2) * 10) / 10 }; })()`);
  const soloMK = async (where) => {
    await hoverForAction(railMK, 'solo', `the merger's card offers Show only this ${where}`);
    await s.evalJs(`document.querySelector('.lane-popover .lane-card-action[data-action="solo"]').click()`);
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.draw === 'some' && document.querySelector('.files-rail .commits-panel')?.dataset.drawn === '1'`, `one block drawn ${where}`, 5000);
    await away();
    await sleep(300);
  };
  const allBack = async (where) => {
    await s.evalJs(`document.querySelector('.files-rail .commits-draw [data-draw="some"]').click()`);
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.draw === 'all'`, `every block back ${where}`, 5000);
    await sleep(300);
  };
  await s.evalJs(`document.querySelector('.files-rail .commits-orient').click()`);
  await s.waitFor(`document.querySelector('.files-rail .commits-graph')?.dataset.orientation === 'horizontal'`, 'on its side for the extent');
  await sleep(300);
  let ext = await extentProbe('x');
  expect(ext.drawn === ext.rows && ext.from === 0 && ext.svg === ext.rows * 24, `under all the sideways SVG is every row long (${JSON.stringify(ext)})`);
  // MK parked 10px in from the left edge, the leading one, so it is the
  // node the scroll is anchored to, and in the middle across, since the
  // tracks outgrow the rail's height and a mark below the view is not
  // hoverable.
  await s.evalJs(`(() => { const v = document.querySelector('.files-rail .commits-graph-view'); const n = v.querySelector(${JSON.stringify(nodeSel(MK))}); const r = n.getBoundingClientRect(); const vr = v.getBoundingClientRect(); v.scrollLeft = r.left + r.width / 2 - vr.left + v.scrollLeft - 10; v.scrollTop = Math.max(0, r.top + r.height / 2 - vr.top + v.scrollTop - v.clientHeight / 2); v.dispatchEvent(new Event('scroll')); })()`);
  await sleep(300);
  const mk0 = await mkScreen();
  await soloMK('on its side');
  ext = await extentProbe('x');
  let mk = await mkScreen();
  expect(ext.drawn < ext.rows && ext.svg === ext.drawn * 24, `one block alone, the SVG is its rows long and no longer (${JSON.stringify(ext)})`);
  expect(Math.abs(ext.scroll - (ext.room + ext.old + ext.svg)) <= 12 && ext.old <= ext.client / 2 + 1, `the view scrolls the two rooms plus the drawing, the old room at most half the view (${JSON.stringify(ext)})`);
  expect(mk !== null && Math.abs(mk.x - mk0.x) < 1.5, `the parked node stays where it was while the picture shrinks under it (${JSON.stringify([mk0, mk])})`);
  await s.screenshot('m9-fix211-side-solo.png');
  await allBack('on its side');
  ext = await extentProbe('x');
  mk = await mkScreen();
  expect(ext.drawn === ext.rows && ext.svg === ext.rows * 24, `every block back, the SVG is every row long again (${JSON.stringify(ext)})`);
  expect(mk !== null && Math.abs(mk.x - mk0.x) < 1.5, `and the parked node still where it was (${JSON.stringify([mk0, mk])})`);
  // Upright with the rows off, the same in heights.
  await s.evalJs(`document.querySelector('.files-rail .commits-orient').click()`);
  await s.waitFor(`document.querySelector('.files-rail .commits-graph')?.dataset.orientation === 'vertical'`, 'upright for the extent');
  await s.evalJs(`document.querySelector('.files-rail .commits-rows').click()`);
  await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.rows === 'off'`, "the rail's rows off for the extent");
  await sleep(300);
  ext = await extentProbe('y');
  expect(ext.drawn === ext.rows && ext.svg === ext.rows * 22, `upright with the rows off under all the SVG is every row tall (${JSON.stringify(ext)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(railMK)}).scrollIntoView({ block: 'center' })`);
  await soloMK('upright with the rows off');
  ext = await extentProbe('y');
  expect(ext.drawn < ext.rows && ext.svg === ext.drawn * 22, `one block alone, the SVG is its rows tall (${JSON.stringify(ext)})`);
  expect(Math.abs(ext.scroll - (ext.room + ext.old + ext.svg)) <= 12 && ext.old <= ext.client / 2 + 1, `the list scrolls the two rooms plus the drawing, the old room at most half the list (${JSON.stringify(ext)})`);
  await s.screenshot('m9-fix211-upright-solo.png');
  await allBack('upright');
  ext = await extentProbe('y');
  expect(ext.drawn === ext.rows && ext.svg === ext.rows * 22, `every block back, the SVG every row tall again (${JSON.stringify(ext)})`);
  await s.evalJs(`document.querySelector('.files-rail .commits-rows').click()`);
  await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.rows === 'on'`, "the rail's rows back on");
  step("M9 fix 211: with the rows off the picture is the drawn range long, on its side and upright, the rooms sized to it, and the parked node holds while a block is shown alone and every block comes back");

  // M9 fix 213: Ctrl+wheel over the rail's commits view zooms the graph
  // in steps, the pitch and the weights and the marks scaling with it so
  // a zoomed-out graph is a smaller picture and not a sparser one, and
  // the node under the pointer kept where it is (upright the time axis is
  // vertical, so the node's screen y is read before and after). The plain
  // wheel keeps scrolling. The choice lands in the rail's prefs.
  const scaleProbe = () =>
    s.evalJs(
      `(() => { const v = document.querySelector('.files-rail .commits-graph-view'); const svg = v.querySelector('.commits-graph'); return { scale: +v.dataset.scale, pitch: +svg.dataset.pitch, height: +svg.getAttribute('height'), pref: JSON.parse(localStorage.getItem('emerald.commitsGraph') ?? '{}').scale ?? 1 }; })()`,
    );
  const railNodeY = (hash) => s.evalJs(`(() => { const n = document.querySelector('.files-rail ' + ${JSON.stringify(nodeSel(hash))}); return n ? Math.round(n.getBoundingClientRect().top * 10) / 10 : null; })()`);
  // A node roughly in the middle of the rail's view, so a zoom does not
  // push it off either end; its centre is where the wheel lands.
  const midNode = await s.evalJs(`(() => { const v = document.querySelector('.files-rail .commits-graph-view'); const vr = v.getBoundingClientRect(); const nodes = [...v.querySelectorAll('.commits-node[data-hash]')].map((n) => ({ hash: n.dataset.hash, r: n.getBoundingClientRect() })).filter((n) => n.r.top > vr.top + 40 && n.r.bottom < vr.bottom - 40); const pick = nodes[Math.floor(nodes.length / 2)]; return pick ? { hash: pick.hash, x: pick.r.left + pick.r.width / 2, y: pick.r.top + pick.r.height / 2 } : null; })()`);
  expect(midNode !== null, 'a node in the middle of the rail view to zoom around');
  const scale0 = await scaleProbe();
  expect(scale0.scale === 1 && scale0.pitch === 22, `the rail graph starts at scale 1, pitch 22 (${JSON.stringify(scale0)})`);
  const y0 = await railNodeY(midNode.hash);
  // A Ctrl+wheel up steps the zoom in; the node under the pointer stays.
  await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(midNode.x), y: Math.round(midNode.y), deltaX: 0, deltaY: -120, modifiers: 2 });
  await s.waitFor(`+document.querySelector('.files-rail .commits-graph-view').dataset.scale > 1`, 'the Ctrl+wheel zooms the rail graph in', 4000);
  const scaleUp = await scaleProbe();
  const yUp = await railNodeY(midNode.hash);
  expect(scaleUp.scale === 1.25 && scaleUp.pitch === 22 * 1.25 && Math.abs(scaleUp.height / scale0.height - 1.25) < 0.02 && scaleUp.pref === 1.25, `one step in: scale 1.25, the pitch and the SVG grow 1.25x, the rail pref set (${JSON.stringify([scale0, scaleUp])})`);
  expect(yUp !== null && y0 !== null && Math.abs(yUp - y0) < 1.5, `the node under the pointer stays where it was through the zoom (${JSON.stringify([y0, yUp])})`);
  // A plain wheel does not zoom (it scrolls); the scale holds.
  await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(midNode.x), y: Math.round(midNode.y), deltaX: 0, deltaY: -120, modifiers: 0 });
  await sleep(200);
  expect((await scaleProbe()).scale === 1.25, 'a plain wheel does not change the zoom');
  // A Ctrl+wheel down steps it back to 1, where the pref is dropped.
  await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(midNode.x), y: Math.round(midNode.y), deltaX: 0, deltaY: 120, modifiers: 2 });
  await s.waitFor(`+document.querySelector('.files-rail .commits-graph-view').dataset.scale === 1`, 'a Ctrl+wheel down steps the zoom back to 1', 4000);
  const scaleBack = await scaleProbe();
  expect(scaleBack.scale === 1 && scaleBack.pitch === 22 && scaleBack.height === scale0.height && (scaleBack.pref === 1 || scaleBack.pref === undefined), `back at scale 1, the pref dropped (${JSON.stringify(scaleBack)})`);
  await s.screenshot('m9-fix213-zoom.png');
  step('M9 fix 213: Ctrl+wheel over the commits view zooms the graph in steps, the pitch and weights scaling with it, the node under the pointer kept, the plain wheel still scrolling');


  // M9 fix 129, the other half: on its side, a commit that lands pushes
  // the newest tip one column further under a scroll that stays put.
  await s.evalJs(`document.querySelector('.commits-orient').click()`);
  await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'horizontal'`, 'on its side');
  const side1 = await sideProbe();
  expect(Math.abs(side1.lead - side1.scrollLeft - 48) < 12, `the turn puts the lead near the left edge (${JSON.stringify(side1)})`);
  const rowsBefore = await s.evalJs(`+document.querySelector('.commits-graph').dataset.rows`);
  commit('R1');
  await s.waitFor(`+document.querySelector('.commits-graph').dataset.rows === ${rowsBefore + 1}`, 'the commit lands as a new row', 8000);
  const side2 = await sideProbe();
  expect(side2.scrollLeft === side1.scrollLeft && side2.tip === side1.tip + 24, `the scroll stays put and the tip moves one column right (${JSON.stringify([side1.scrollLeft, side2.scrollLeft, side1.tip, side2.tip])})`);
  await s.screenshot('m9-fix129-grows.png');
  await s.evalJs(`document.querySelector('.commits-orient').click()`);
  await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'vertical'`, 'upright again');
  step('M9 fix 129: on its side a commit that lands pushes the tip right under a scroll that stays put');

  // M9 fix 131: the session's own line stays the trunk under a member's
  // commit. A session on main makes P0 and P1; three members have
  // worktrees cut at P1, and the first commits W1 there while nothing
  // of the session's own sits above it. The member's commit used to
  // reserve P1 on its side lane and take the session's whole chain with
  // it, the star a lane to the left with a stub to a dot of its own; now
  // the session's row, P1 and P0 sit on one x, W1's node to the right
  // with its line bending into P1, and the two commit-less members'
  // forks bend into P1 on the same lane.
  const trunk = await spawnIn(repo);
  await post(trunk.id, { cwd: repo, hook_event_name: 'UserPromptSubmit', prompt: 'commit twice and fan out' });
  const P0 = await commitVia(trunk.id, git, 'P0', repo);
  const P1 = await commitVia(trunk.id, git, 'P1', repo);
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(P1))})?.dataset.session === ${JSON.stringify(trunk.id)} && document.querySelector(${JSON.stringify(nodeSel(P0))})?.dataset.session === ${JSON.stringify(trunk.id)}`, "P1 and P0 are the session's own", 8000);
  for (const name of ['fx1', 'fx2', 'fx3']) {
    const short = path.join(os.tmpdir(), 'emerald-verify', `m51-${name}-${process.pid}`);
    fs.rmSync(short, { recursive: true, force: true });
    git('worktree', 'add', '-q', '-b', name, short, P1);
    fixDirs.push(fs.realpathSync.native(short));
  }
  await s.waitFor(`!!document.querySelector('.commits-pill[data-branch="fx3"]')`, 'the three branches show on P1', 8000);
  for (const [i, name] of ['fx1', 'fx2', 'fx3'].entries()) {
    await post(trunk.id, { cwd: repo, hook_event_name: 'SubagentStart', agent_id: name, agent_type: 'fork' });
    await post(trunk.id, { cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: `agent ${name}`, subagent_type: 'fork' }, tool_response: { agentId: name, description: `agent ${name}`, status: 'async_launched' } });
    await post(trunk.id, { cwd: fixDirs[i], agent_id: name, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    await post(trunk.id, { cwd: fixDirs[i], agent_id: name, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
  }
  await s.waitFor(`document.querySelectorAll('.commits-agent-row[data-session=${JSON.stringify(trunk.id)}][data-member][data-pending]').length === 3`, 'the three members are commit-less worktree rows', 8000);
  const w1Cmd = 'git commit -q -m W1';
  await post(trunk.id, { cwd: fixDirs[0], agent_id: 'fx1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: w1Cmd } });
  await sleep(300);
  const fx1Git = gitIn(fixDirs[0]);
  fs.writeFileSync(path.join(fixDirs[0], 'W1.txt'), 'W1');
  fx1Git('add', 'W1.txt');
  fx1Git('commit', '-q', '-m', 'W1');
  const W1 = fx1Git('rev-parse', 'HEAD').trim();
  await post(trunk.id, { cwd: fixDirs[0], agent_id: 'fx1', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: w1Cmd } });
  await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(W1))})?.dataset.member === 'fx1'`, "W1's node is on the first member's lane", 8000);
  const shape = await s.evalJs(
    `(() => { const n = (h) => document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const at = (h) => n(h).getAttribute('cx') + ' ' + n(h).getAttribute('cy'); const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const row = (h) => rows.findIndex(r => r.dataset.hash === h); const own = document.querySelector(${JSON.stringify(ownRowSel(trunk.id))}); const mark = document.querySelector('.commits-agent-node[data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + ']:not([data-member])'); const fo = mark.querySelector('foreignObject'); const branch = document.querySelector('.commits-edge[data-kind="branch"][data-from="' + row(${JSON.stringify(W1)}) + '"]'); const d = branch ? branch.getAttribute('d') : ''; const forks = [...document.querySelectorAll('.commits-edge[data-kind="fork"][data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + ']')].map(e => ({ to: e.dataset.to, end: e.getAttribute('d').split(' ').slice(-2).join(' '), curve: e.getAttribute('d').includes('Q') })); const edges = [...document.querySelectorAll('.commits-edge[data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + ']')].map(e => e.dataset.kind + ':' + e.dataset.from + '-' + e.dataset.to + (e.dataset.dashed !== undefined ? '~' : '')).sort().join(','); return { ownLane: mark.dataset.lane, ownX: +fo.getAttribute('x') + +fo.getAttribute('width') / 2, ownRow: rows.indexOf(own), p1Row: row(${JSON.stringify(P1)}), p0Row: row(${JSON.stringify(P0)}), w1Row: row(${JSON.stringify(W1)}), lanes: [n(${JSON.stringify(P1)}).dataset.lane, n(${JSON.stringify(P0)}).dataset.lane, n(${JSON.stringify(W1)}).dataset.lane], xs: [+n(${JSON.stringify(P1)}).getAttribute('cx'), +n(${JSON.stringify(P0)}).getAttribute('cx'), +n(${JSON.stringify(W1)}).getAttribute('cx')], branch: branch ? { to: branch.dataset.to, toLane: null, end: d.split(' ').slice(-2).join(' '), curve: d.includes('Q') } : null, p1At: at(${JSON.stringify(P1)}), forks, edges, dots: document.querySelectorAll('.commits-node[data-start][data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + ']').length }; })()`,
  );
  expect(shape.ownLane === shape.lanes[0] && shape.lanes[0] === shape.lanes[1] && shape.ownX === shape.xs[0] && shape.xs[0] === shape.xs[1], `the session's row, P1 and P0 sit on one lane at one x (${JSON.stringify([shape.ownLane, shape.lanes, shape.ownX, shape.xs])})`);
  expect(shape.ownRow === shape.p1Row - 1 && shape.p0Row === shape.p1Row + 1 && shape.w1Row < shape.ownRow, `the own row straight above P1, P0 under it, W1 above them all (${JSON.stringify([shape.w1Row, shape.ownRow, shape.p1Row, shape.p0Row])})`);
  expect(shape.lanes[2] !== shape.lanes[0] && shape.xs[2] > shape.xs[0], `W1 sits on a lane of its own to the right (${JSON.stringify([shape.lanes, shape.xs])})`);
  expect(shape.branch !== null && shape.branch.to === String(shape.p1Row) && shape.branch.end === shape.p1At && shape.branch.curve, `W1's line runs down its lane and bends into P1 on the session's line (${JSON.stringify([shape.branch, shape.p1At])})`);
  expect(shape.forks.length === 2 && shape.forks.every((f) => f.to === String(shape.p1Row) && f.end === shape.p1At && f.curve), `the two commit-less members' forks bend into P1 on the session's lane (${JSON.stringify([shape.forks, shape.p1At])})`);
  // The session's start dot sits under P0 on the same lane (M9 fix
  // 117), so no stub to a dot of its own is left beside the chain, and
  // the block's lines are the session's own, W1's bend, the three
  // members' stretches and nothing else.
  const wanted = [`branch:${shape.w1Row}-${shape.p1Row}`, `fork:${shape.ownRow - 2}-${shape.p1Row}~`, `fork:${shape.ownRow - 1}-${shape.p1Row}~`, `pending:${shape.ownRow}-${shape.p1Row}~`, `pending:${shape.w1Row - 1}-${shape.w1Row}~`, `session:${shape.p1Row}-${shape.p0Row + 1}`].sort().join(',');
  expect(shape.dots === 1 && shape.edges === wanted, `the block's lines are the chain on the trunk, the bend, the forks and the dashed stretches (${shape.edges} against ${wanted}, ${shape.dots} dot)`);
  await s.screenshot('m9-fix131-trunk.png');
  step("M9 fix 131: a member's commit on top of the session's own leaves the session's line straight and bends into it");

  // M9 fix 132: the session's star tells from its subagents'. On the
  // block just seeded (the session and its three members): the own
  // row's marker is the sidebar row's size and the members' the size
  // of a unit on the team list, each in the same 16px box; the member
  // rows wear a `subagent` chip after the state word and the session's
  // row its name, in the lane colour; on its side the member labels
  // carry the word and the session's carries its name.
  const trunkNow = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === trunk.id);
  const marks = await s.evalJs(
    `(() => { const sid = ${JSON.stringify(trunk.id)}; const nodes = [...document.querySelectorAll('.commits-agent-node[data-session=' + JSON.stringify(sid) + ']')]; const read = (n) => { const fo = n.querySelector('foreignObject'); const mark = n.querySelector('.session-mark'); const r = mark.getBoundingClientRect(); const box = fo.getBoundingClientRect(); return { member: n.dataset.member ?? null, size: n.dataset.size, markSize: mark.dataset.size, star: mark.querySelector('.session-mark-still svg')?.getAttribute('width') ?? null, box: [box.width, box.height].map(Math.round), centred: Math.abs((r.left + r.width / 2) - (box.left + box.width / 2)) < 1 && Math.abs((r.top + r.height / 2) - (box.top + box.height / 2)) < 1, width: Math.round(r.width) }; }; const rows = [...document.querySelectorAll('.commits-agent-row[data-session=' + JSON.stringify(sid) + ']')].map((r) => ({ member: r.dataset.member ?? null, role: r.querySelector('.commits-agent-role')?.textContent ?? null, roleData: r.querySelector('.commits-agent-role')?.dataset.role ?? null, name: r.querySelector('.commits-agent-name')?.textContent ?? null, status: r.querySelector('.commits-agent-status').textContent, model: r.querySelector('.commits-agent-model')?.textContent ?? null, nameColor: r.querySelector('.commits-agent-name') ? getComputedStyle(r.querySelector('.commits-agent-name')).color : null, roleSize: r.querySelector('.commits-agent-role') ? getComputedStyle(r.querySelector('.commits-agent-role')).fontSize : null, order: [...r.children].map((c) => c.className.replace('commits-', '')).join(' ') })); return { own: nodes.filter((n) => n.dataset.member === undefined).map(read), members: nodes.filter((n) => n.dataset.member !== undefined).map(read), rows }; })()`,
  );
  expect(marks.own.length === 1 && marks.own[0].size === 'row' && marks.own[0].markSize === 'row' && marks.own[0].star === '14' && marks.own[0].width === 16, `the session's own marker is the row size, a 14px star in a 16px mark (${JSON.stringify(marks.own)})`);
  expect(marks.members.length === 3 && marks.members.every((m) => m.size === 'unit' && m.markSize === 'unit' && m.star === '10' && m.width === 12 && m.centred), `the three members' markers are the unit size, a 10px star in a 12px mark centred in the box (${JSON.stringify(marks.members)})`);
  expect([...marks.own, ...marks.members].every((m) => m.box[0] === 16 && m.box[1] === 16), `every marker box stays 16px (${JSON.stringify([...marks.own, ...marks.members].map((m) => m.box))})`);
  const ownRow = marks.rows.find((r) => r.member === null);
  const memberRows = marks.rows.filter((r) => r.member !== null);
  expect(ownRow !== undefined && ownRow.role === null && ownRow.name === trunkNow.name && ownRow.nameColor === rgb(trunkNow.color) && ownRow.order === 'wash agent-status agent-name agent-activity age', `the session's row carries its name in the lane colour after the state word and no chip (${JSON.stringify(ownRow)})`);
  // M9 fix 373: the chip carries the type Claude Code named the member by
  // after the word (`subagent · fork`; the fixture's three are forks).
  expect(memberRows.length === 3 && memberRows.every((r) => r.role === 'subagent · fork' && r.roleData === 'subagent' && r.name === null && r.roleSize === '10px' && r.order.startsWith('wash agent-status agent-role agent-activity')), `the member rows wear the subagent · fork chip after the state word, in small type, and no name (${JSON.stringify(memberRows)})`);
  // M9 fix 287: trunk has had no status line yet and none of the three
  // members has made a request, so no row draws a model word.
  expect(ownRow.model === null && memberRows.every((r) => r.model === null), `no row draws a model word before the state has one to show (${JSON.stringify([ownRow.model, memberRows.map((r) => r.model)])})`);
  await s.screenshot('m9-fix132-marks.png');
  await s.evalJs(`document.querySelector('.commits-orient').click()`);
  await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'horizontal'`, 'on its side');
  const sideLabels = await s.evalJs(`[...document.querySelectorAll('.commits-label[data-agent][data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + ']')].map((l) => (l.dataset.member ?? 'own') + '=' + l.textContent).sort().join('|')`);
  expect(sideLabels === ['fx1', 'fx2', 'fx3'].map((m) => `${m}=${cutLabel(`subagent · fork · agent ${m}`)}`).concat(`own=${cutLabel(`${ownRow.status} · ${trunkNow.name}`)}`).join('|'), `on its side the member labels say their kind, subagent · fork, and the session's says its state and name, each cut to 24 characters (${sideLabels})`);
  step("M9 fix 132: the session's star is the row size and its subagents' the unit size, the rows say subagent and the session's name");

  // The graph's side is one flag the rail and the document tab share and
  // a reload keeps (M9 fix 171), so a skipped block would hand the next
  // one the graph on whichever side it left it (M9 fix 426: fix 320 run
  // alone met it on its side and turned it upright where it meant the
  // other way). Every block starts and ends upright; the prelude ends on
  // its side, so it is turned here.
  const orient = async (want) => {
    const now = await s.evalJs(`document.querySelector('.commits-graph')?.dataset.orientation ?? null`);
    if (now === want) return;
    await s.evalJs(`document.querySelector('.commits-orient').click()`);
    await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === ${JSON.stringify(want)}`, `the graph ${want}`);
  };
  await orient('vertical');

  // Bindings one block makes and a later block reads (M9 fix 426); the
  // later block names the first in BLOCKS' needs, so --only runs both.
  let DX1, rowSelOf, priceRepo, pbWt, sessP, priceLayout, priceLeaf, swapIn, postP, railRow, usage, line, transcriptPath, clockOf, priceCardSel, awayCard, agentCAt, cardSelP, noRepo, bare, cgRepo, gitCg, cgSess;
  await block('fix-292', async () => {
    // On its side, as the prelude left it before the blocks (M9 fix 426).
    await orient('horizontal');
    // M9 fix 292: the graph's agent stars tell the model families apart by
    // size, the box staying the 16px cell either way (M9 fix 132's own
    // three members prove the no-request default already, star 10, cell
    // 12, on trunk above). A repository of this step's own (M9 fix 252's
    // shape), so its extra commits and branches never touch the row and
    // column counts fix 142 and fix 160 read on repo/trunk's graph; the
    // pane borrows a session's worktree pane the way fix 252 does and
    // gives it back after. Its two members' files are written before its
    // first commit lands: commit-usage.ts asks a conversation's requests
    // once per log read and only again when a commit changes the key, so
    // writing the files after the graph has already drawn the members (as
    // trunk's above) leaves the ask stale until something else moves it;
    // seeding them first means the very first ask already carries both.
    // sf's file names claude-sonnet-5, ff's claude-fable-5-1; the
    // session's own mark passes no family (AgentMarker nulls it for
    // item.member === null), so it stays the row size (14, cell 16)
    // whatever family it turns out to be.
    const starShort = path.join(os.tmpdir(), 'emerald-verify', `m51-star-${process.pid}`);
    fs.rmSync(starShort, { recursive: true, force: true });
    fs.mkdirSync(starShort, { recursive: true });
    const starRepo = fs.realpathSync.native(starShort);
    fixDirs.push(starRepo);
    const gitS = gitIn(starRepo);
    gitS('init', '-q', '-b', 'main');
    gitS('config', 'user.name', 'verify');
    gitS('config', 'user.email', 'verify@example.invalid');
    gitS('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(starRepo, 'S0.txt'), 'S0');
    gitS('add', 'S0.txt');
    gitS('commit', '-q', '-m', 'S0');
    const starLayout = await getLayout(s);
    const starLeaf = leaves(starLayout).find((leaf) => leaf.sessionId !== null && (leaf.view === undefined || leaf.view === null));
    expect(starLeaf !== undefined, 'a terminal pane to put the star session on');
    const starSwapIn = (node, sessionId) => (node.kind === 'pane' ? (node.id === starLeaf.id ? { ...node, sessionId } : node) : { ...node, first: starSwapIn(node.first, sessionId), second: starSwapIn(node.second, sessionId) });
    const starSess = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: starRepo, cols: 80, rows: 24 })).session;
    await zreq(s, 'layout.set', { layout: { ...starLayout, root: starSwapIn(starLayout.root, starSess.id), focusedPaneId: starLeaf.id } });
    await post(starSess.id, { cwd: starRepo, hook_event_name: 'SessionStart', source: 'startup' });
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.folder === ${JSON.stringify(starRepo)}`, 'the rail follows the star session to its own repository', 10000);
    const starConv = `sim-${starSess.id}`;
    const starClaudeDir = path.join(claudeHome, 'projects', encode(starRepo));
    fs.mkdirSync(starClaudeDir, { recursive: true });
    const starSubagents = path.join(starClaudeDir, starConv, 'subagents');
    fs.mkdirSync(starSubagents, { recursive: true });
    const starAt = Date.now() - 1000;
    fs.writeFileSync(path.join(starClaudeDir, `${starConv}.jsonl`), jl({ type: 'user', timestamp: iso(starAt - 500), message: { role: 'user', content: 'star it' }, cwd: starRepo }));
    const starReq = (agentId, model, at) =>
      jl({ type: 'assistant', isSidechain: true, agentId, timestamp: iso(at), message: { id: `msg_${agentId}`, role: 'assistant', model, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000, output_tokens: 100 }, content: [{ type: 'text', text: 'ok' }] } });
    fs.writeFileSync(path.join(starSubagents, 'agent-sf.jsonl'), starReq('sf', 'claude-sonnet-5', starAt));
    fs.writeFileSync(path.join(starSubagents, 'agent-ff.jsonl'), starReq('ff', 'claude-fable-5-1', starAt + 1));
    const SX = await commitVia(starSess.id, gitS, 'SX', starRepo);
    await s.waitFor(`!!document.querySelector('.commits-node[data-hash=${JSON.stringify(SX)}]')`, "SX is drawn, the session's first commit that asks its conversation fresh", 8000);
    // The two members, worktrees cut at SX as fx1 to fx3 were at P1 (M9
    // fix 131): a commit-less pending row and marker each, their files
    // already in place from above.
    const starWts = [];
    for (const name of ['sf', 'ff']) {
      const short = path.join(os.tmpdir(), 'emerald-verify', `m51-${name}-${process.pid}`);
      fs.rmSync(short, { recursive: true, force: true });
      gitS('worktree', 'add', '-q', '-b', `star-${name}`, short, SX);
      starWts.push(fs.realpathSync.native(short));
      fixDirs.push(fs.realpathSync.native(short));
    }
    for (const [i, name] of ['sf', 'ff'].entries()) {
      await post(starSess.id, { cwd: starRepo, hook_event_name: 'SubagentStart', agent_id: name, agent_type: 'fork' });
      await post(starSess.id, { cwd: starRepo, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: `star agent ${name}`, subagent_type: 'fork' }, tool_response: { agentId: name, description: `star agent ${name}`, status: 'async_launched' } });
      await post(starSess.id, { cwd: starWts[i], agent_id: name, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
      await post(starSess.id, { cwd: starWts[i], agent_id: name, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    }
    const starNodeSel = (member) => `.commits-agent-node[data-session=${JSON.stringify(starSess.id)}][data-member=${JSON.stringify(member)}]`;
    await s.waitFor(`document.querySelectorAll('.commits-agent-node[data-session=${JSON.stringify(starSess.id)}][data-member][data-pending]').length === 2`, 'the two members are commit-less worktree markers', 8000);
    await s.waitFor(
      `document.querySelector(${JSON.stringify(starNodeSel('sf'))})?.dataset.family === 'Sonnet' && document.querySelector(${JSON.stringify(starNodeSel('ff'))})?.dataset.family === 'Fable'`,
      'the two stars read their family off the request already on file',
      10000,
    );
    await s.evalJs(`document.querySelector(${JSON.stringify(starNodeSel('sf'))})?.scrollIntoView({ block: 'center' })`);
    await settled(starNodeSel('sf'));
    const starsOfSel = `const of = (member) => document.querySelector('.commits-agent-node[data-session=' + JSON.stringify(${JSON.stringify(starSess.id)}) + ']' + (member === null ? ':not([data-member])' : '[data-member="' + member + '"]'));`;
    await s.waitFor(
      `(() => { ${starsOfSel} return ['sf', 'ff', null].every((m) => !!of(m)?.querySelector('.session-mark')); })()`,
      'every one of the three marks is up',
      5000,
    );
    const stars = await s.evalJs(
      `(() => { ${starsOfSel} const read = (n) => { const mark = n?.querySelector('.session-mark') ?? null; if (!mark) return null; const r = mark.getBoundingClientRect(); return { member: n.dataset.member ?? null, family: n.dataset.family ?? null, star: mark.querySelector('.session-mark-still svg')?.getAttribute('width') ?? null, cell: Math.round(r.width) }; }; return { own: read(of(null)), sf: read(of('sf')), ff: read(of('ff')) }; })()`,
    );
    expect(stars.own !== null && stars.own.family === null && stars.own.star === '14' && stars.own.cell === 16, `the session's own star stays the row size whatever family it is (${JSON.stringify(stars.own)})`);
    expect(stars.sf !== null && stars.sf.family === 'Sonnet' && stars.sf.star === '8' && stars.sf.cell === 10, `a Sonnet member's star reads smaller than the unit default (${JSON.stringify(stars.sf)})`);
    expect(stars.ff !== null && stars.ff.family === 'Fable' && stars.ff.star === '12' && stars.ff.cell === 14, `a Fable member's star reads larger than the unit default (${JSON.stringify(stars.ff)})`);
    await s.screenshot('m9-292-stars.png');
    await away();
    // Give the pane its session back, so the rail follows the focused
    // pane's folder back to repo/trunk's graph for the steps after this
    // one (M9 fix 252 does the same at the end of its own price scenario).
    await zreq(s, 'layout.set', { layout: { ...(await getLayout(s)), root: starSwapIn((await getLayout(s)).root, starLeaf.sessionId) } });
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.folder === ${JSON.stringify(repo)} && !!document.querySelector(${JSON.stringify(nodeSel(P1))})`, "the rail is back on repo, P1's node redrawn", 10000);
    step("M9 fix 292: a member's star reads the size of its model's family off its last request, the session's own star holding the row size regardless; the box stays 16px either way");
    await orient('vertical');
  });

  await block('fix-142', async () => {
    // M9 fix 142, the labels: the session's label runs rightwards from
    // its mark over the columns newer than it, where W1 sits on the first
    // member's lane with its pill above the node, in the band the label
    // crosses; the pill yields and draws below its node. The pills on P1
    // (fx2, fx3, on the session's own lane) have no label above and stay
    // above. Oldest first, the labels run leftwards from the marks, into
    // the room, so they never run back over the lane's own commits.
    // Every live session on main sits over its head P1 since M9 fix 151,
    // so their rows fill the columns between the mark and W1 and the
    // label ends before it; Show only this on the session's block takes
    // those rows out of the gutter for the reading, and the chip brings
    // every block back after.
    await orient('vertical');
    await away();
    await s.evalJs(`document.querySelector(${JSON.stringify(nodeSel(P1))}).scrollIntoView({ block: 'center' })`);
    await hoverForAction(nodeSel(P1), 'solo', "the session's card offers Show only this");
    await s.evalJs(`document.querySelector('.lane-popover .lane-card-action[data-action="solo"]').click()`);
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.draw === 'some' && document.querySelector('.commits-panel')?.dataset.drawn === '1'`, "the session's block alone", 5000);
    await away();
    await s.evalJs(`document.querySelector('.commits-orient').click()`);
    await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'horizontal'`, 'on its side again');
    const sidePills = await s.evalJs(
      `(() => { const pill = (b) => { const t = document.querySelector('.commits-label[data-branch=' + JSON.stringify(b) + ']'); return t ? { below: 'below' in t.dataset, y: +t.getAttribute('y') } : null; }; const node = (h) => +document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']').getAttribute('cy'); const own = document.querySelector('.commits-label[data-agent][data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + ']:not([data-member])'); const mark = document.querySelector('.commits-agent-node[data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + ']:not([data-member]) foreignObject'); return { fx1: pill('fx1'), fx2: pill('fx2'), fx3: pill('fx3'), w1: node(${JSON.stringify(W1)}), p1: node(${JSON.stringify(P1)}), anchor: own.getAttribute('text-anchor'), labelX: +own.getAttribute('x'), markX: +mark.getAttribute('x') + 8, chars: own.textContent.length }; })()`,
    );
    // At the 12px pitch the fx1 pill's band crossed the session's label
    // on the track above and yielded below its node; at 24px (M9 fix
    // 160) the band clears the label and the pill stays above W1. The
    // yield itself is covered by commit-graph-labels.test.ts.
    expect(sidePills.fx1 !== null && !sidePills.fx1.below && sidePills.fx1.y < sidePills.w1, `the fx1 pill's band clears the session's label at the 24px pitch and stays above W1 (${JSON.stringify(sidePills)})`);
    expect(sidePills.fx2 !== null && !sidePills.fx2.below && sidePills.fx2.y < sidePills.p1 && sidePills.fx3 !== null && !sidePills.fx3.below, `the pills on P1 stay above their node (${JSON.stringify(sidePills)})`);
    expect(sidePills.anchor === 'start' && sidePills.labelX > sidePills.markX && sidePills.chars <= 24, `newest last, the session's label runs rightwards from its mark (${JSON.stringify(sidePills)})`);
    // M9 fix 145: the newest row's label starts at the last column and
    // runs past the SVG's right edge into the room, where the SVG used to
    // clip it; scrolled to the room (the log here is wider than the view,
    // where the click-through's was narrower), it draws whole inside the
    // view and the pointer reaches it there. The scroll is put back after.
    const overhang = await s.evalJs(
      `(() => { const v = document.querySelector('.commits-graph-view[data-orientation="horizontal"]'); const svg = v.querySelector('.commits-graph'); const scrollBefore = v.scrollLeft; v.scrollLeft = v.scrollWidth; const labels = [...svg.querySelectorAll('.commits-label[data-agent]')].sort((p, q) => +q.getAttribute('x') - +p.getAttribute('x')); const label = labels[0]; if (!label) return { label: null }; const lb = label.getBoundingClientRect(); const sb = svg.getBoundingClientRect(); const vb = v.getBoundingClientRect(); const probe = document.elementFromPoint(lb.right - 4, lb.top + lb.height / 2); const out = { label: label.textContent, chars: label.textContent.length, labelRight: lb.right, svgRight: sb.right, viewRight: vb.right, overflow: getComputedStyle(svg).overflow, hit: probe ? probe.tagName + (probe.dataset.agent !== undefined ? '.agent' : '') : null }; v.scrollLeft = scrollBefore; return out; })()`,
    );
    expect(overhang.label !== null && overhang.labelRight > overhang.svgRight + 20 && overhang.labelRight <= overhang.viewRight, `the newest row's label runs well past the SVG's right edge and stays inside the view (${JSON.stringify(overhang)})`);
    expect(overhang.overflow === 'visible' && overhang.hit === 'text.agent', `the sideways SVG lets the label overflow and the pointer reaches it past the edge (${JSON.stringify(overhang)})`);
    await s.screenshot('m9-fix142-labels.png');
    const sideMid = await s.evalJs(`(() => { const r = document.querySelector('.commits-graph-view').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.rightClick(sideMid.x, sideMid.y);
    await s.waitFor(`!!document.querySelector('.commits-menu')`, 'the direction menu on its side');
    await clickText('.commits-menu .menu-label', 'Oldest first');
    await s.waitFor(`document.querySelector('.commits-graph')?.dataset.reverse !== undefined`, 'oldest first on its side');
    const reversedLabel = await s.evalJs(
      `(() => { const own = document.querySelector('.commits-label[data-agent][data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + ']:not([data-member])'); const mark = document.querySelector('.commits-agent-node[data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + ']:not([data-member]) foreignObject'); return { anchor: own.getAttribute('text-anchor'), labelX: +own.getAttribute('x'), markX: +mark.getAttribute('x') + 8 }; })()`,
    );
    expect(reversedLabel.anchor === 'end' && reversedLabel.labelX < reversedLabel.markX, `oldest first, the label runs leftwards from its mark (${JSON.stringify(reversedLabel)})`);
    await s.rightClick(sideMid.x, sideMid.y);
    await s.waitFor(`!!document.querySelector('.commits-menu')`, 'the direction menu on its side again');
    await clickText('.commits-menu .menu-label', 'Newest first');
    await s.waitFor(`document.querySelector('.commits-graph')?.dataset.reverse === undefined`, 'newest last again');
    await s.evalJs(`document.querySelector('.commits-orient').click()`);
    await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'vertical'`, 'upright again');
    await s.evalJs(`document.querySelector('.commits-draw [data-draw="some"]').click()`);
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.draw === 'all'`, 'every block back', 5000);
    step("M9 fix 142: on its side a pill under an agent's label draws below its node, the labels are cut to 24 characters and run the way time flows into the room");

    // M9 fix 160: on its side, every block drawn (the sessions on main
    // and their members, the crowd the ask came from), no pill's box and
    // no agent label's box crosses another track's line. A track is the
    // y of a node, a bar or a mark; a pill must hold none, an agent label
    // none but its own (its baseline sits 3px under its line). The boxes
    // are the SVG's own (getBBox), not the estimate the layout uses.
    await s.evalJs(`document.querySelector('.commits-orient').click()`);
    await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'horizontal'`, 'on its side for the pitch');
    const pitch = await s.evalJs(
      `(() => { const svg = document.querySelector('.commits-graph'); const ys = new Set(); for (const n of svg.querySelectorAll('circle.commits-node')) ys.add(+n.getAttribute('cy')); for (const b of svg.querySelectorAll('line.commits-bar')) ys.add((+b.getAttribute('y1') + +b.getAttribute('y2')) / 2); for (const m of svg.querySelectorAll('.commits-agent-node foreignObject')) ys.add(+m.getAttribute('y') + 8); const tracks = [...ys].sort((a, b) => a - b); const pitches = tracks.slice(1).map((y, i) => y - tracks[i]); const crossings = []; let pills = 0; let agents = 0; for (const l of svg.querySelectorAll('.commits-label')) { const b = l.getBBox(); const agent = 'agent' in l.dataset; if (agent) agents += 1; else pills += 1; const own = agent ? +l.getAttribute('y') - 3 : null; for (const y of tracks) { if (own !== null && Math.abs(y - own) < 1) continue; if (y > b.y + 0.5 && y < b.y + b.height - 0.5) crossings.push((agent ? 'agent ' : 'pill ') + l.textContent + ' over ' + y); } } return { tracks: tracks.length, minPitch: Math.min(...pitches), pills, agents, crossings }; })()`,
    );
    expect(pitch.tracks >= 4 && pitch.pills >= 3 && pitch.agents >= 4, `a crowd to read: tracks, pills and agent labels (${JSON.stringify(pitch)})`);
    expect(pitch.minPitch >= TRACK_PX, `the tracks are at least ${TRACK_PX}px apart (${JSON.stringify(pitch)})`);
    expect(pitch.crossings.length === 0, `no pill and no agent label crosses another track's line (${JSON.stringify(pitch)})`);
    await s.screenshot('m9-fix160-pitch.png');
    await s.evalJs(`document.querySelector('.commits-orient').click()`);
    await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'vertical'`, 'upright after the pitch');
    await away();
    step('M9 fix 160: on its side the tracks are 24px apart and no pill or agent label crosses a neighbouring line');

    // M9 fix 142, the view: two outside commits newer than the session
    // used to put the tip 48px from the left edge with the session's
    // marks past it, their labels cut; now the oldest mark leads when it
    // lies within the view's width of the tip, so the marks and the tip
    // both show. And the view is the list's height, not its SVG's. The
    // session's own mark sits over V2, main's new head (M9 fix 151), in
    // the cluster of every live session's row there; the block alone
    // again, so the cluster does not push the mark a view's width from
    // its members.
    commit('V1');
    const V2 = commit('V2');
    // The logs watch pushes the commits; when a push is wasted the rail's
    // 5 s poll (GIT_POLL_MS, git-poll.ts) is the fallback, and under load
    // that poll's gits ride behind others (M9 fix 531).
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(V2))})?.dataset.outside !== undefined`, 'two outside commits newer than the session', 15000, { quietMs: 0 });
    await away();
    await s.evalJs(`document.querySelector(${JSON.stringify(nodeSel(P1))}).scrollIntoView({ block: 'center' })`);
    await hoverForAction(nodeSel(P1), 'solo', "the session's card offers Show only this again");
    await s.evalJs(`document.querySelector('.lane-popover .lane-card-action[data-action="solo"]').click()`);
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.draw === 'some' && document.querySelector('.commits-panel')?.dataset.drawn === '1'`, "the session's block alone again", 5000);
    await away();
    const headRow = await s.evalJs(`(() => { const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const own = rows.findIndex((r) => r.dataset.session === ${JSON.stringify(trunk.id)} && !r.dataset.member); return { own, v2: rows.findIndex((r) => r.dataset.hash === ${JSON.stringify(V2)}), head: document.querySelector('.commits-bar[data-kind="head"][data-session=${JSON.stringify(trunk.id)}]') !== null }; })()`);
    expect(headRow.own === headRow.v2 - 1 && headRow.head, `the session's row sits right over V2, main's head, with a head bar under it (M9 fix 151) (${JSON.stringify(headRow)})`);
    // M9 fix 176: the stretch from the star down to the head bar is
    // dashed, the air the next commit falls through; from the head bar on
    // down to the session's newest own commit it is solid, since that
    // part has landed, the same weight as the line below.
    const headDash = await s.evalJs(
      `(() => { const own = ${headRow.own}; const v2 = ${headRow.v2}; const edges = [...document.querySelectorAll('.commits-edge[data-kind="pending"][data-session=${JSON.stringify(trunk.id)}]:not([data-member])')].map((e) => ({ from: +e.dataset.from, to: +e.dataset.to, dashed: 'dashed' in e.dataset, dash: getComputedStyle(e).strokeDasharray !== 'none' })); return { above: edges.find((e) => e.from === own && e.to === v2) ?? null, below: edges.find((e) => e.from === v2) ?? null }; })()`,
    );
    expect(headDash.above !== null && headDash.above.dashed && headDash.above.dash, `the stretch from the star to the head bar is dashed (${JSON.stringify(headDash)})`);
    expect(headDash.below !== null && headDash.below.to > headRow.v2 && !headDash.below.dashed && !headDash.below.dash, `the stretch from the head bar down to the session's newest own commit is solid (M9 fix 176) (${JSON.stringify(headDash)})`);
    await s.evalJs(`document.querySelector('.commits-orient').click()`);
    await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'horizontal'`, 'on its side');
    const sideView = await s.evalJs(
      `(() => { const v = document.querySelector('.commits-graph-view[data-orientation="horizontal"]'); const list = v.closest('.files-list'); const svg = v.querySelector('.commits-graph'); const svgLeft = svg.getBoundingClientRect().left - v.getBoundingClientRect().left + v.scrollLeft; const n = +svg.dataset.drawnRows; const pitch = +svg.dataset.pitch; const marks = [...svg.querySelectorAll('.commits-agent-node[data-session=' + JSON.stringify(${JSON.stringify(trunk.id)}) + '] foreignObject')].map((m) => svgLeft + +m.getAttribute('x') + 8 - v.scrollLeft); return { marks, tip: svgLeft + (n - 1) * pitch + pitch / 2 - v.scrollLeft, clientWidth: v.clientWidth, height: v.getBoundingClientRect().height, listHeight: list.clientHeight, svgHeight: svg.getBoundingClientRect().height, box: v.parentElement.classList.contains('commits-view-box') }; })()`,
    );
    expect(sideView.marks.length === 4 && sideView.marks.every((x) => x >= 40 && x <= sideView.clientWidth), `the session's four marks are in view on the first show (${JSON.stringify(sideView)})`);
    // The newest row is the session's own, over V2 (M9 fix 151), so the
    // tip column is the star's; the tip is read off the drawn range's
    // count (M9 fix 211), since the block is drawn alone here.
    expect(Math.abs(Math.min(...sideView.marks) - 48) < 12 && sideView.tip === Math.max(...sideView.marks) && sideView.tip <= sideView.clientWidth - 48 + 1, `the oldest mark leads at 48px and the tip is the star's column past the other marks, at most the view's width less 48px in (${JSON.stringify(sideView)})`);
    expect(sideView.box && Math.abs(sideView.height - sideView.listHeight) < 1 && sideView.height > sideView.svgHeight, `the sideways view is the list's height in a box of its own (M9 fix 187), taller than its SVG here (${JSON.stringify(sideView)})`);
    await s.screenshot('m9-fix142-marks-in-view.png');
    await s.evalJs(`document.querySelector('.commits-orient').click()`);
    await s.waitFor(`document.querySelector('.commits-graph')?.dataset.orientation === 'vertical'`, 'upright again');
    await s.evalJs(`document.querySelector('.commits-draw [data-draw="some"]').click()`);
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.draw === 'all'`, 'every block back again', 5000);
    step("M9 fix 142: on its side the first show keeps the session's marks in view beside two newer outside commits, and the view fills the rail; M9 fix 176: the stretch under the head bar is solid");

    // M9 fix 145, the first screenshot's shape: two more members of the
    // session have worktrees cut at commits another block owns. MK is the
    // merger's merge on main, on the session's own first-parent ancestry
    // (P0 sits on main above it), so that fork lands on the session's own
    // lane at MK's row with no node there and the session's line runs
    // down to it; G2 is the worker's agent's commit on the merged branch,
    // off the ancestry, which the session's chain runs past, so that fork
    // ends on its own lane at G2's row under a bar. Hiding the merger's
    // block moves neither.
    for (const [name, at] of [['fy1', MK], ['fy2', G2]]) {
      const short = path.join(os.tmpdir(), 'emerald-verify', `m51-${name}-${process.pid}`);
      fs.rmSync(short, { recursive: true, force: true });
      git('worktree', 'add', '-q', '-b', name, short, at);
      const dir = fs.realpathSync.native(short);
      fixDirs.push(dir);
      await post(trunk.id, { cwd: repo, hook_event_name: 'SubagentStart', agent_id: name, agent_type: 'fork' });
      await post(trunk.id, { cwd: repo, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: `agent ${name}`, subagent_type: 'fork' }, tool_response: { agentId: name, description: `agent ${name}`, status: 'async_launched' } });
      await post(trunk.id, { cwd: dir, agent_id: name, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
      await post(trunk.id, { cwd: dir, agent_id: name, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    }
    await s.waitFor(`document.querySelectorAll('.commits-agent-row[data-session=${JSON.stringify(trunk.id)}][data-member="fy1"][data-pending], .commits-agent-row[data-session=${JSON.stringify(trunk.id)}][data-member="fy2"][data-pending]').length === 2`, 'the two members are commit-less worktree rows', 8000);
    // The branches show on their commits once the log is read again.
    await s.waitFor(`!!document.querySelector('.commits-row[data-hash=${JSON.stringify(MK)}] .commits-pill[data-branch="fy1"]') && !!document.querySelector('.commits-row[data-hash=${JSON.stringify(G2)}] .commits-pill[data-branch="fy2"]')`, 'the two branches show on MK and G2', 15000);
    const elsewhereProbe = () =>
      s.evalJs(
        `(() => { const sid = ${JSON.stringify(trunk.id)}; const centre = ${centreJs}; const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const row = (h) => rows.findIndex(r => r.dataset.hash === h); const n = (h) => document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const own = n(${JSON.stringify(P0)}); const fork = (m) => { const e = document.querySelector('.commits-edge[data-kind="fork"][data-session=' + JSON.stringify(sid) + '][data-member=' + JSON.stringify(m) + ']'); if (!e) return null; const end = e.getAttribute('d').split(' ').slice(-2).map(v => Math.round(parseFloat(v.replace(/^[A-Za-z]/, '')) * 1000) / 1000); return { to: +e.dataset.to, lane: e.dataset.lane, endX: end[0], endY: end[1], curve: e.getAttribute('d').includes('Q') }; }; const bars = [...document.querySelectorAll('.commits-node[data-shape="bar"][data-kind="fork"][data-session=' + JSON.stringify(sid) + ']')].map(b => ({ ...centre(b), lane: b.dataset.lane, stroke: getComputedStyle(b).stroke })); const headBar = document.querySelector('.commits-node[data-shape="bar"][data-kind="head"][data-session=' + JSON.stringify(sid) + ']'); const v2Node = n(${JSON.stringify(V2)}); const line = [...document.querySelectorAll('.commits-edge[data-kind="session"][data-session=' + JSON.stringify(sid) + ']')].map(e => e.dataset.from + '-' + e.dataset.to).join(','); const mkNode = n(${JSON.stringify(MK)}); const g2Node = n(${JSON.stringify(G2)}); return { headBar: headBar ? { ...centre(headBar), lane: headBar.dataset.lane, v2Y: +v2Node.getAttribute('cy') } : null, ownX: +own.getAttribute('cx'), ownLane: own.dataset.lane, ownFill: getComputedStyle(own).fill, mkRow: row(${JSON.stringify(MK)}), g2Row: row(${JSON.stringify(G2)}), mkY: mkNode ? +mkNode.getAttribute('cy') : null, g2Y: g2Node ? +g2Node.getAttribute('cy') : null, mkX: mkNode ? +mkNode.getAttribute('cx') : null, g2X: g2Node ? +g2Node.getAttribute('cx') : null, fy1: fork('fy1'), fy2: fork('fy2'), bars, line, p0Row: row(${JSON.stringify(P0)}), edges: [...document.querySelectorAll('.commits-edge[data-session=' + JSON.stringify(sid) + ']')].map(e => e.dataset.kind + ':' + (e.dataset.member ?? '-') + ':' + e.dataset.from + '-' + e.dataset.to), ownNodesOnRows: [${JSON.stringify(MK)}, ${JSON.stringify(G2)}].map(h => document.querySelectorAll('.commits-node[data-hash=' + JSON.stringify(h) + '][data-session=' + JSON.stringify(sid) + ']').length) }; })()`,
      );
    const far = await elsewhereProbe();
    expect(far.fy1 !== null && far.fy1.to === far.mkRow && far.fy1.endX === far.ownX && far.fy1.endY === far.mkY && far.fy1.curve && far.fy1.lane !== far.ownLane, `the fork cut at MK lands on the session's own lane at MK's row, off its own lane (${JSON.stringify([far.fy1, far.ownX, far.mkY, far.mkX, far.edges])})`);
    expect(far.fy2 !== null && far.fy2.to === far.g2Row && far.fy2.endY === far.g2Y && far.fy2.endX !== far.ownX && far.fy2.endX !== far.g2X && !far.fy2.curve, `the fork cut at G2 runs straight down its own lane to G2's row and stops (${JSON.stringify([far.fy2, far.ownX, far.g2X, far.g2Y])})`);
    // The bar is on the member's lane, so it wears the lane's tint of the
    // session's colour (M9 fix 305). The bars are read by place, since
    // the landing on the session's own line at MK's row wears a fork bar
    // too (M9 fix 374), as does any other member's landing on the line.
    const barAt = (bars, lane, cy) => bars.find((b) => b.lane === lane && b.cy === cy) ?? null;
    const g2Bar = barAt(far.bars, far.fy2.lane, far.g2Y);
    expect(g2Bar !== null && g2Bar.cx === far.fy2.endX && isTintOf(g2Bar.stroke, hexOfRgb(far.ownFill), null), `a fork bar on fy2's lane at G2's row in a tint of the session's colour (${JSON.stringify([far.bars, far.fy2.lane, far.g2Y, far.ownFill])})`);
    const mkBar = barAt(far.bars, far.ownLane, far.mkY);
    expect(mkBar !== null && mkBar.cx === far.ownX, `the landing on the session's own line at MK's row wears a fork bar (M9 fix 374; ${JSON.stringify([far.bars, far.ownLane, far.mkY])})`);
    expect(far.bars.every((b) => b.lane === far.ownLane || b.lane === far.fy2.lane), `every fork bar of the session's is on its line or on fy2's lane (${JSON.stringify(far.bars)})`);
    // The session's row sits over V2, main's head and nobody's (M9 fix
    // 151): a head bar on the session's own lane at V2's row.
    expect(far.headBar !== null && far.headBar.lane === far.ownLane && far.headBar.cx === far.ownX && far.headBar.cy === far.headBar.v2Y, `the head bar on the session's own lane at V2's row (${JSON.stringify([far.headBar, far.ownLane, far.ownX])})`);
    expect(far.ownNodesOnRows.join(',') === '0,0', "no node of the session's on MK's or G2's row");
    expect(far.line.split(',').some((seg) => +seg.split('-')[0] <= far.p0Row && +seg.split('-')[1] >= far.mkRow), `the session's line runs from P0 down to MK's row (${far.line}, P0 at ${far.p0Row}, MK at ${far.mkRow})`);
    await s.screenshot('m9-fix145-forks-elsewhere.png');
    // Hiding the merger's block (MK's hash) moves nothing of the session's.
    await s.evalJs(`document.querySelector(${JSON.stringify(`.commits-row[data-hash=${JSON.stringify(MK)}] .commits-hash`)}).click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(nodeSel(MK))})`, "the merger's lines are hidden", 5000);
    // The merger's agent rows go with its lanes, so every row below moves
    // up two; the shape is read against the rows again.
    // MK's node is hidden with its block, so the bar on the session's line
    // at MK's row (M9 fix 374) is found at fy1's end rather than MK's cy.
    const farHidden = await elsewhereProbe();
    const spansToMk = (line, p0Row, mkRow) => line.split(',').some((seg) => +seg.split('-')[0] <= p0Row && +seg.split('-')[1] >= mkRow);
    expect(farHidden.fy1 !== null && farHidden.fy1.to === farHidden.mkRow && farHidden.fy1.endX === farHidden.ownX && farHidden.fy1.curve && farHidden.fy2 !== null && farHidden.fy2.to === farHidden.g2Row && farHidden.fy2.endX === far.fy2.endX && !farHidden.fy2.curve && farHidden.bars.length === far.bars.length && barAt(farHidden.bars, farHidden.fy2.lane, farHidden.g2Y) !== null && barAt(farHidden.bars, farHidden.ownLane, farHidden.fy1.endY) !== null && spansToMk(farHidden.line, farHidden.p0Row, farHidden.mkRow), `with the merger's block hidden the forks land where they did, the bars stay and the line still reaches MK's row (${JSON.stringify([farHidden.fy1, farHidden.fy2, farHidden.bars, farHidden.line, farHidden.p0Row, farHidden.mkRow])})`);
    await s.evalJs(`document.querySelector(${JSON.stringify(`.commits-row[data-hash=${JSON.stringify(MK)}] .commits-hash`)}).click()`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(nodeSel(MK))})`, "the merger's lines are back", 5000);
    step("M9 fix 145: a member's fork cut at another block's commit lands on the session's own lane when the commit is on its ancestry, and ends under a bar on its own lane when it is not; hiding the other block moves nothing");

    // M9 fix 152: a bar has no words on the picture, so the block's card,
    // which a hover on the bar opens, says what it means. The fork bar
    // above is the session's, at G2's row: its card's fork line names G2.
    // Then a start bar, whichever block has one (a session's start is a
    // bar since fix 145): its card's start line names the row's commit.
    // The gutter scrolls sideways once the columns outgrow the rail (fix
    // 141), so a bar on a far lane is brought into the box before the
    // hover, and what sits under the pointer is read for the message.
    // The card opens on the lane group's mouseenter after 400 ms, and a
    // group re-rendered under the pointer between the move and the timer
    // (the 5 s poll) loses the enter; the bar is hovered again once when
    // the first try opens nothing, and the step says so. A product bug
    // fails both tries.
    const hoverBar = async (sel, sessionId, what) => {
      let under = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (attempt > 0) await away();
        await s.evalJs(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'nearest', inline: 'nearest' })`);
        await settled(sel);
        const at = await hoverOver(sel);
        under = await s.evalJs(`(() => { const el = document.elementFromPoint(${at.x}, ${at.y}); return el ? el.tagName + '.' + el.getAttribute('class') + '@' + (el.closest('.commits-lane-group')?.dataset.session ?? '-') : null; })()`);
        try {
          await s.waitFor(`document.querySelector('.lane-popover')?.dataset.sessionId === ${JSON.stringify(sessionId)}`, `${what} (under the pointer: ${under}, try ${attempt + 1})`, 3000);
          if (attempt > 0) console.log(`[verify] note: ${what} needed a second hover`);
          return under;
        } catch (err) {
          if (attempt > 0) throw err;
        }
      }
      return under;
    };
    const forkBarSel = `.commits-bar[data-kind="fork"][data-session=${JSON.stringify(trunk.id)}]`;
    // The session's fork bars and the commit on each one's row, in row
    // order, as the card's lines name them (M9 fix 399): G2's ends fy2's
    // lane at the commit it came from, and since M9 fix 374 the landings
    // on the session's own line (fy1's at MK, and the branchless members'
    // where the session sits) carry data-landing.
    const forkBarRows = await s.evalJs(`(() => { const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const g = document.querySelector('.commits-graph').getBoundingClientRect(); return [...document.querySelectorAll(${JSON.stringify(forkBarSel)})].map((el) => { const cy = (+el.getAttribute('y1') + +el.getAttribute('y2')) / 2; const row = rows.find((r) => { const b = r.getBoundingClientRect(); return b.top - g.top <= cy && cy < b.bottom - g.top; }); return { row: rows.indexOf(row), hash: row?.dataset.hash ?? null, landing: el.hasAttribute('data-landing') }; }).sort((a, b) => a.row - b.row); })()`);
    expect(forkBarRows.length >= 2 && forkBarRows.every((b) => b.hash !== null) && forkBarRows.some((b) => b.hash === G2) && forkBarRows.some((b) => b.hash === MK), `the session's fork bars sit on commit rows, G2's and MK's among them (${JSON.stringify(forkBarRows)})`);
    expect(forkBarRows.find((b) => b.hash === G2)?.landing === false && forkBarRows.find((b) => b.hash === MK)?.landing === true, `G2's bar ends the lane, MK's lands on the session's own line (${JSON.stringify(forkBarRows)})`);
    await hoverBar(forkBarSel, trunk.id, "the session's card opens on its fork bar");
    const forkLines = await s.evalJs(`(() => { const c = document.querySelector('.lane-popover'); return { forks: [...c.querySelectorAll('.lane-card-bars[data-kind="fork"]')].map((el) => el.textContent), start: c.querySelector('.lane-card-bars[data-kind="start"]')?.textContent ?? null }; })()`);
    const hashesFor = (rows) => {
      const named = rows.slice(0, 3).map((b) => b.hash.slice(0, 7));
      const rest = rows.length - named.length;
      return rest > 0 ? `${named.join(', ')} and ${rest} more` : named.join(', ');
    };
    const landingRows = forkBarRows.filter((b) => b.landing);
    const endingRows = forkBarRows.filter((b) => !b.landing);
    const wantedForkLines = [];
    if (landingRows.length > 0) wantedForkLines.push(`${landingRows.length} bar${landingRows.length === 1 ? '' : 's'} where a fork lands on this line (${hashesFor(landingRows)})`);
    if (endingRows.length > 0) wantedForkLines.push(`${endingRows.length} bar${endingRows.length === 1 ? '' : 's'} ending a lane at the commit it came from (${hashesFor(endingRows)})`);
    expect(JSON.stringify(forkLines.forks) === JSON.stringify(wantedForkLines), `the card's fork lines name the bars' rows in order, landings first (${JSON.stringify(forkLines)} against ${JSON.stringify(wantedForkLines)})`);
    await away();
    const startBar = await s.evalJs(`(() => { const el = [...document.querySelectorAll('.commits-bar[data-kind="start"]')].find((e) => e.getClientRects().length > 0); if (!el) return null; const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const cy = (+el.getAttribute('y1') + +el.getAttribute('y2')) / 2; const g = document.querySelector('.commits-graph').getBoundingClientRect(); const row = rows.find((r) => { const b = r.getBoundingClientRect(); return b.top - g.top <= cy && cy < b.bottom - g.top; }); return { session: el.dataset.session ?? null, hash: row?.dataset.hash ?? null }; })()`);
    expect(startBar !== null && startBar.session !== null && startBar.hash !== null, `a start bar on the graph with a row under it (${JSON.stringify(startBar)})`);
    const startBarSel = `.commits-bar[data-kind="start"][data-session=${JSON.stringify(startBar.session)}]`;
    await hoverBar(startBarSel, startBar.session, "the block's card opens on its start bar");
    const startLine = await s.evalJs(`document.querySelector('.lane-popover .lane-card-bars[data-kind="start"]')?.textContent ?? null`);
    expect(startLine === `bar at ${startBar.hash.slice(0, 7)}: the commit HEAD was on when this session started`, `the card's start line names the row's commit (${JSON.stringify([startLine, startBar])})`);
    await s.screenshot('m9-fix152-bar-card.png');
    await away();
    step("M9 fix 152: the card opened from a fork bar names the commit the branch came from, and from a start bar the commit the session started on");
  });

  await block('fix-133', async () => {
    // M9 fix 133: the colours on one graph tell apart. A repository of its
    // own, so its graph holds only what this block seeds: three shells
    // started in it one after another (the daemon picks each colour far
    // from the live sessions of the same repository), each committing
    // once, and two conversations on disk whose trailers put two more
    // commits on history lanes (the graph gives each the palette colour
    // farthest from every colour already drawn). Every pair of lane
    // colours on the graph is then farther apart in OKLab than the floor
    // under which a lane reads as another's, and no colour repeats.
    const repo2Short = path.join(os.tmpdir(), 'emerald-verify', `m51-colours-${process.pid}`);
    fs.rmSync(repo2Short, { recursive: true, force: true });
    fs.mkdirSync(repo2Short, { recursive: true });
    const repo2 = fs.realpathSync.native(repo2Short);
    const git2 = gitIn(repo2);
    git2('init', '-q', '-b', 'main');
    git2('config', 'user.name', 'verify');
    git2('config', 'user.email', 'verify@example.invalid');
    git2('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo2, 'K0.txt'), 'K0');
    git2('add', 'K0.txt');
    git2('commit', '-q', '-m', 'K0');
    const claudeDir2 = path.join(claudeHome, 'projects', encode(repo2));
    fs.mkdirSync(claudeDir2, { recursive: true });
    const T133 = ['d7d7d7d7-0000-4000-8000-000000000133', 'd7d7d7d7-0000-4000-8000-000000000134'];
    T133.forEach((id, k) => {
      const at = Date.now() - 7_200_000 + k * 60_000;
      fs.writeFileSync(
        path.join(claudeDir2, `${id}.jsonl`),
        jl({ type: 'ai-title', aiTitle: `Conversation ${k + 1} of the colours`, sessionId: id }) +
          jl({ type: 'user', message: { role: 'user', content: 'colour it' }, cwd: repo2, gitBranch: 'main', timestamp: iso(at) }) +
          jl({ type: 'attachment', attachment: { type: 'remote_session_change', url: `https://claude.ai/code/session_verify13${k + 3}`, commit: `Claude-Session: https://claude.ai/code/session_verify13${k + 3}` }, timestamp: iso(at + 1000) }) +
          jl({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text: 'Coloured.' }] }, cwd: repo2, timestamp: iso(at + 2000) }),
      );
    });
    const peers = [];
    for (let k = 1; k <= 3; k += 1) {
      const sess = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo2, cols: 80, rows: 24 })).session;
      await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(sess.id)})?.startHead !== null; })()`, `colour session ${k} knows its start commit`, 8000);
      const hash = await commitVia(sess.id, git2, `P${k}`, repo2);
      // The daemon reads HEAD after the PostToolUse lands; the next commit
      // waits for that read, else it is credited to this session too.
      await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(sess.id)})?.commits.some(c => c.hash === ${JSON.stringify(hash)}); })()`, `colour session ${k} owns its commit`, 8000);
      peers.push({ id: sess.id, hash, color: (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === sess.id).color });
    }
    const H133 = T133.map((_, k) => {
      git2('commit', '-q', '--allow-empty', '-m', `HC${k + 1}`, '-m', `Claude-Session: https://claude.ai/code/session_verify13${k + 3}`);
      return git2('rev-parse', 'HEAD').trim();
    });
    // The first shell's row, shift-clicked, splits a pane beside the
    // focused one and focuses it, so the rail follows to the new folder.
    await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(peers[0].id)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.folder === ${JSON.stringify(repo2)}`, "the rail follows the focused pane to the colours' repository", 10000);
    // The scan already ran; a reload asks for a fresh one, which reads the
    // two transcripts written since.
    await s.send('Page.reload');
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.folder === ${JSON.stringify(repo2)} && document.querySelector(${JSON.stringify(nodeSel(H133[0]))})?.dataset.history === ${JSON.stringify(T133[0])} && document.querySelector(${JSON.stringify(nodeSel(H133[1]))})?.dataset.history === ${JSON.stringify(T133[1])}`, 'both trailer commits land on history lanes after the reload', 20000);
    const onGraph = await s.evalJs(
      `(() => { const lanes = new Map(); for (const n of document.querySelectorAll('.commits-node[data-session]:not([data-outside])')) { const c = n.style.getPropertyValue('--lane'); if (c) lanes.set(n.dataset.session, c); } return { colours: [...lanes.entries()], blocks: +document.querySelector('.commits-panel').dataset.blocks, outside: document.querySelectorAll('.commits-node[data-outside]').length }; })()`,
    );
    const lab = (hex) => oklabOf(hex);
    const apart = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
    expect(onGraph.colours.length === 5 && onGraph.outside === 1, `three session lanes and two history lanes beside the one grey commit (${JSON.stringify(onGraph)})`);
    const pairs = [];
    for (let i = 0; i < onGraph.colours.length; i += 1) for (let j = i + 1; j < onGraph.colours.length; j += 1) pairs.push({ a: onGraph.colours[i][1], b: onGraph.colours[j][1], d: apart(onGraph.colours[i][1], onGraph.colours[j][1]) });
    expect(pairs.every((p) => p.d > COLOR_FLOOR), `every pair of lane colours is farther apart than the floor ${COLOR_FLOOR} (${JSON.stringify(pairs.map((p) => [p.a, p.b, p.d.toFixed(3)]))})`);
    expect(new Set(onGraph.colours.map((c) => c[1])).size === 5, `no colour repeats (${JSON.stringify(onGraph.colours)})`);
    expect(peers.every((p) => onGraph.colours.find((c) => c[0] === p.id)?.[1] === p.color), "the session lanes wear the daemon's colours");
    const historyColours = onGraph.colours.filter((c) => c[0].startsWith('history:')).map((c) => c[1]);
    expect(historyColours.length === 2 && historyColours.every((h) => SESSION_COLORS.includes(h)), `the history lanes wear palette colours (${JSON.stringify(historyColours)})`);
    await s.screenshot('m9-fix133-colours.png');
    step(`M9 fix 133: three sessions and two conversations in one repository draw five lane colours, the nearest pair ${Math.min(...pairs.map((p) => p.d)).toFixed(3)} apart in OKLab, above the floor`);

    // M9 fix 134: the Colour row on the lane card. The first shell's lane
    // opens its card with the menus' twelve swatches above the actions,
    // its own marked; a pick closes the card and puts the new hex on the
    // sidebar row's bar, on the lane and on the title of the pane showing
    // it, through the daemon. A removed session's card has no row, since
    // session.set on it would answer not-found.
    await away();
    await settled(nodeSel(peers[0].hash));
    await hoverOver(nodeSel(peers[0].hash));
    await s.waitFor(`document.querySelector('.lane-popover')?.dataset.sessionId === ${JSON.stringify(peers[0].id)}`, "the first shell's card", 3000);
    const colourRow = await s.evalJs(
      `(() => { const c = document.querySelector('.lane-popover'); const row = c.querySelector('.lane-card-colour [data-swatches]'); const sw = row ? [...row.querySelectorAll('.menu-swatch')] : []; const kids = [...c.children].map((k) => k.className); return { label: row?.dataset.swatches ?? null, count: sw.length, active: sw.filter((b) => b.dataset.active === 'true').map((b) => b.dataset.color), colours: sw.map((b) => b.dataset.color), above: kids.indexOf('lane-card-colour') < kids.indexOf('lane-card-actions') }; })()`,
    );
    expect(colourRow.label === 'Colour' && colourRow.count === 12 && colourRow.above, `a Colour row of twelve above the actions (${JSON.stringify(colourRow)})`);
    expect(colourRow.active.length === 1 && colourRow.active[0] === peers[0].color, `the session's own colour marked (${JSON.stringify(colourRow.active)} against ${peers[0].color})`);
    const onScreen = new Set(onGraph.colours.map((c) => c[1]));
    const nextColour = colourRow.colours.find((c) => !onScreen.has(c));
    expect(nextColour !== undefined, 'a palette colour no lane on the graph wears');
    const paneP1 = leaves(await getLayout(s)).find((leaf) => leaf.sessionId === peers[0].id)?.id;
    expect(paneP1 !== undefined, 'a pane shows the first shell');
    await s.screenshot('m9-fix134-card.png');
    await s.evalJs(`document.querySelector('.lane-popover .lane-card-colour .menu-swatch[data-color=${JSON.stringify(nextColour)}]').click()`);
    await s.waitFor(`!document.querySelector('.lane-popover')`, 'the card closes on the pick');
    await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(peers[0].id)}]')?.dataset.color === ${JSON.stringify(nextColour)}`, "the row's bar took the new colour", 5000);
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(peers[0].hash))})?.style.getPropertyValue('--lane') === ${JSON.stringify(nextColour)}`, 'the lane took it', 5000);
    const afterPick = await s.evalJs(`(() => ({ title: document.querySelector('[data-pane-id=${JSON.stringify(paneP1)}] .pane-title')?.dataset.color ?? null, node: getComputedStyle(document.querySelector(${JSON.stringify(nodeSel(peers[0].hash))})).fill }))()`);
    expect(afterPick.title === nextColour && afterPick.node === rgb(nextColour), `the pane title and the node wear it too (${JSON.stringify(afterPick)})`);
    expect((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === peers[0].id).color === nextColour, 'the daemon has the new colour');
    await s.screenshot('m9-fix134-card-colour.png');
    // M9 fix 157: a swatch under the pointer on the lane card previews its
    // colour on the lane, the node, the sidebar row and the pane title,
    // with the daemon untouched and the mark still on the saved colour;
    // leaving the row puts the saved colour back on all of them. The
    // preview is a palette colour no lane wears, so no history block is
    // moved by it.
    await away();
    await settled(nodeSel(peers[0].hash));
    await hoverOver(nodeSel(peers[0].hash));
    await s.waitFor(`document.querySelector('.lane-popover')?.dataset.sessionId === ${JSON.stringify(peers[0].id)}`, "the first shell's card again", 3000);
    const probeColour = colourRow.colours.find((c) => !onScreen.has(c) && c !== nextColour);
    expect(probeColour !== undefined, 'a second palette colour no lane wears');
    const probeSel = `.lane-popover .lane-card-colour .menu-swatch[data-color="${probeColour}"]`;
    await hoverOver(probeSel);
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(peers[0].hash))})?.style.getPropertyValue('--lane') === ${JSON.stringify(probeColour)}`, 'the lane previews the swatch under the pointer', 5000);
    const underPreview = await s.evalJs(
      `(() => { const c = document.querySelector('.lane-popover'); return { card: c?.dataset.sessionId ?? null, row: document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(peers[0].id)}]')?.dataset.color ?? null, title: document.querySelector('[data-pane-id=${JSON.stringify(paneP1)}] .pane-title')?.dataset.color ?? null, node: getComputedStyle(document.querySelector(${JSON.stringify(nodeSel(peers[0].hash))})).fill, active: [...c.querySelectorAll('.menu-swatch')].filter((b) => b.dataset.active === 'true').map((b) => b.dataset.color) }; })()`,
    );
    expect(underPreview.card === peers[0].id, 'the card stays open under the pointer');
    expect(underPreview.row === probeColour && underPreview.title === probeColour && underPreview.node === rgb(probeColour), `the row, the title and the node preview it too (${JSON.stringify(underPreview)})`);
    expect(underPreview.active.length === 1 && underPreview.active[0] === nextColour, `the mark stays on the saved colour (${JSON.stringify(underPreview.active)})`);
    expect((await zreq(s, 'session.list', {})).sessions.find((x) => x.id === peers[0].id).color === nextColour, 'the daemon still has the saved colour');
    await hoverOver('.lane-popover .lane-card-name');
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(peers[0].hash))})?.style.getPropertyValue('--lane') === ${JSON.stringify(nextColour)}`, 'leaving the swatches puts the saved colour back on the lane', 5000);
    const afterLeave = await s.evalJs(`(() => ({ row: document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(peers[0].id)}]')?.dataset.color ?? null, title: document.querySelector('[data-pane-id=${JSON.stringify(paneP1)}] .pane-title')?.dataset.color ?? null }))()`);
    expect(afterLeave.row === nextColour && afterLeave.title === nextColour, `and on the row and the title (${JSON.stringify(afterLeave)})`);
    await s.screenshot('m9-fix157-preview.png');
    step(`M9 fix 157: hovering ${probeColour} on the lane card previewed it on the lane, the node, the row and the title with the daemon on ${nextColour}; leaving put it back`);
    // A removed session: its lane still opens a card (M9 fix 111), with
    // no Colour row and the actions it had.
    await removeSession(peers[2].id);
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(peers[2].hash))})?.dataset.gone !== undefined`, 'the third shell is removed, its lane kept', 8000);
    await away();
    await settled(nodeSel(peers[2].hash));
    await hoverOver(nodeSel(peers[2].hash));
    await s.waitFor(`document.querySelector('.lane-popover')?.dataset.sessionId === ${JSON.stringify(peers[2].id)}`, "the removed shell's card", 3000);
    const removedCard = await s.evalJs(`(() => { const c = document.querySelector('.lane-popover'); return { colour: c.querySelector('.lane-card-colour') !== null, state: c.querySelector('.lane-card-state').textContent, actions: [...c.querySelectorAll('.lane-card-action')].map((b) => b.dataset.action).join(',') }; })()`);
    expect(!removedCard.colour && removedCard.state.startsWith('removed'), `no Colour row on a removed session's card (${JSON.stringify(removedCard)})`);
    await s.key('Escape', 'Escape', 27);
    await away();
    step(`M9 fix 134: a swatch on the lane card sets the colour, ${peers[0].color} to ${nextColour} on the row, the lane and the pane title; a removed session's card has no Colour row`);

    // M9 fix 139: a history block keeps its colour. Fix 134's pick put a
    // colour no lane wore on the first shell, which under fix 133 alone
    // re-picked both history blocks; now they keep theirs. Then a fourth
    // shell joins the graph with a commit, and the two keep theirs again;
    // then the second shell is recoloured to the first history block's
    // hex through the daemon, and that block alone is re-picked, off
    // every colour on the graph, the other keeping its colour.
    const historyLanes = () =>
      s.evalJs(`(() => { const out = {}; for (const n of document.querySelectorAll('.commits-node[data-session^="history:"]')) out[n.dataset.session] = n.style.getPropertyValue('--lane'); return out; })()`);
    const before139 = Object.fromEntries(onGraph.colours.filter((c) => c[0].startsWith('history:')));
    const afterPick139 = await historyLanes();
    expect(JSON.stringify(afterPick139) === JSON.stringify(before139), `the history blocks keep their colours across the recolour of a session (${JSON.stringify(before139)} then ${JSON.stringify(afterPick139)})`);
    // The daemon picks the fourth shell's colour far from the live shells'
    // alone, which can be the very colour a history block picked far from
    // the same shells, so the read allows for that: a block whose colour
    // the newcomer took moves, and every other keeps its own.
    const peer4 = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo2, cols: 80, rows: 24 })).session;
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(peer4.id)})?.startHead !== null; })()`, 'the fourth shell knows its start commit', 8000);
    const hash4 = await commitVia(peer4.id, git2, 'P4', repo2);
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(hash4))})?.dataset.session === ${JSON.stringify(peer4.id)}`, "the fourth shell's commit is on its lane", 10000);
    const colour4 = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === peer4.id).color;
    const afterJoin139 = await historyLanes();
    for (const [id, hex] of Object.entries(before139)) {
      if (hex === colour4) expect(afterJoin139[id] !== hex && SESSION_COLORS.includes(afterJoin139[id]), `the history block whose colour the fourth shell took is re-picked (${JSON.stringify(afterJoin139)})`);
      else expect(afterJoin139[id] === hex, `a history block keeps its colour when a session block appears (${id} ${hex} then ${afterJoin139[id]})`);
    }
    const [takenId, takenHex] = Object.entries(afterJoin139)[0];
    const otherId = Object.keys(afterJoin139)[1];
    await zreq(s, 'session.set', { sessionId: peers[1].id, color: takenHex });
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(peers[1].hash))})?.style.getPropertyValue('--lane') === ${JSON.stringify(takenHex)}`, 'the second shell took the first history colour', 5000);
    await s.waitFor(`document.querySelector('.commits-node[data-session=' + JSON.stringify(${JSON.stringify(takenId)}) + ']')?.style.getPropertyValue('--lane') !== ${JSON.stringify(takenHex)}`, 'the history block whose colour was taken is re-picked', 5000);
    const afterTake139 = await historyLanes();
    const lanes139 = await s.evalJs(`(() => { const out = {}; for (const n of document.querySelectorAll('.commits-node[data-session]:not([data-outside])')) out[n.dataset.session] = n.style.getPropertyValue('--lane'); return out; })()`);
    expect(afterTake139[otherId] === afterJoin139[otherId], `the other history block keeps its colour (${JSON.stringify(afterTake139)})`);
    expect(SESSION_COLORS.includes(afterTake139[takenId]) && new Set(Object.values(lanes139)).size === Object.keys(lanes139).length, `the re-picked block wears a palette colour no other lane wears (${JSON.stringify(afterTake139)}, ${JSON.stringify(lanes139)})`);
    await s.screenshot('m9-fix139-history-colours.png');
    step(`M9 fix 139: the history blocks keep ${Object.values(before139).join(' and ')} across a recolour of a session and a new session on ${colour4}; a session taking ${takenHex} moves that block alone, to ${afterTake139[takenId]}`);
  });

  await block('fix-145', async () => {
    // M9 fix 145: session B forks a branch from a commit of session A,
    // commits on it and on main over A's commit, and merges it; B's
    // branch curves into B's own lane 0 at A's commit's row, where B has
    // no node, and nothing of B's sits on A's lane. A third repository,
    // so the picture holds only this.
    const repo3Short = path.join(os.tmpdir(), 'emerald-verify', `m51-bars-${process.pid}`);
    fs.rmSync(repo3Short, { recursive: true, force: true });
    fs.mkdirSync(repo3Short, { recursive: true });
    const repo3 = fs.realpathSync.native(repo3Short);
    const git3 = gitIn(repo3);
    git3('init', '-q', '-b', 'main');
    git3('config', 'user.name', 'verify');
    git3('config', 'user.email', 'verify@example.invalid');
    git3('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(repo3, 'Z0.txt'), 'Z0');
    git3('add', 'Z0.txt');
    git3('commit', '-q', '-m', 'Z0');
    const owns = (id, hash) => s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(id)})?.commits.some(c => c.hash === ${JSON.stringify(hash)}); })()`, `the session owns ${hash.slice(0, 7)}`, 8000);
    const sessA = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo3, cols: 80, rows: 24 })).session;
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(sessA.id)})?.startHead !== null; })()`, 'session A knows its start commit', 8000);
    const A1 = await commitVia(sessA.id, git3, 'A1', repo3);
    await owns(sessA.id, A1);
    const sessB = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo3, cols: 80, rows: 24 })).session;
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(sessB.id)})?.startHead !== null; })()`, 'session B knows its start commit', 8000);
    const xShort = path.join(os.tmpdir(), 'emerald-verify', `m51-bars-x-${process.pid}`);
    fs.rmSync(xShort, { recursive: true, force: true });
    git3('worktree', 'add', '-q', '-b', 'x', xShort, A1);
    const xWt = fs.realpathSync.native(xShort);
    const X1 = await commitVia(sessB.id, gitIn(xWt), 'X1', xWt);
    await owns(sessB.id, X1);
    const B0 = await commitVia(sessB.id, git3, 'B0', repo3);
    await owns(sessB.id, B0);
    const X2 = await commitVia(sessB.id, gitIn(xWt), 'X2', xWt);
    await owns(sessB.id, X2);
    const mergeX = 'git merge --no-ff -m BM x';
    await post(sessB.id, { cwd: repo3, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: mergeX } });
    await sleep(300);
    git3('merge', '-q', '--no-ff', '-m', 'BM', 'x');
    const BM = git3('rev-parse', 'HEAD').trim();
    await post(sessB.id, { cwd: repo3, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: mergeX } });
    await owns(sessB.id, BM);
    await removeWorktree(git3, xWt);
    await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(sessB.id)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.folder === ${JSON.stringify(repo3)} && document.querySelector(${JSON.stringify(nodeSel(BM))})?.dataset.session === ${JSON.stringify(sessB.id)}`, "the rail follows to the third repository and BM is B's", 10000);
    const joined = await s.evalJs(
      `(() => { const a = ${JSON.stringify(sessA.id)}; const b = ${JSON.stringify(sessB.id)}; const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const row = (h) => rows.findIndex(r => r.dataset.hash === h); const n = (h) => document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const at = (h) => ({ x: +n(h).getAttribute('cx'), y: +n(h).getAttribute('cy'), lane: n(h).dataset.lane, session: n(h).dataset.session }); const branch = document.querySelector('.commits-edge[data-kind="branch"][data-session=' + JSON.stringify(b) + ']'); const bd = branch ? branch.getAttribute('d') : ''; const end = bd.split(' ').slice(-2).map((v) => parseFloat(v.replace(/^[A-Za-z]/, ''))); const lines = [...document.querySelectorAll('.commits-edge[data-session=' + JSON.stringify(b) + ']')].map(e => e.dataset.kind + ':' + e.dataset.lane + ':' + e.dataset.from + '-' + e.dataset.to).sort().join(','); return { BM: at(${JSON.stringify(BM)}), B0: at(${JSON.stringify(B0)}), X1: at(${JSON.stringify(X1)}), X2: at(${JSON.stringify(X2)}), A1: at(${JSON.stringify(A1)}), a1Row: row(${JSON.stringify(A1)}), x1Row: row(${JSON.stringify(X1)}), bmRow: row(${JSON.stringify(BM)}), branch: branch ? { from: +branch.dataset.from, to: +branch.dataset.to, endX: end[0], endY: end[1], curve: bd.includes('Q') } : null, lines, bOnA1Row: document.querySelectorAll('.commits-node[data-session=' + JSON.stringify(b) + '][data-hash=' + JSON.stringify(${JSON.stringify(A1)}) + ']').length, bars: document.querySelectorAll('.commits-node[data-shape="bar"][data-kind="fork"]').length, aHead: (() => { const e = document.querySelector('.commits-node[data-shape="bar"][data-kind="head"][data-session=' + JSON.stringify(a) + ']'); return e ? { lane: e.dataset.lane, y: +e.getAttribute('y1') } : null; })(), lanes: document.querySelector('.commits-panel').dataset.lanes }; })()`,
    );
    expect(joined.BM.session === sessB.id && joined.B0.lane === joined.BM.lane && joined.X1.lane === joined.X2.lane && joined.X1.lane !== joined.BM.lane && joined.A1.session === sessA.id && joined.A1.lane !== joined.BM.lane && joined.A1.lane !== joined.X1.lane, `BM and B0 on B's lane, X1 and X2 on B's side lane, A1 on A's own lane (${JSON.stringify([joined.BM, joined.B0, joined.X1, joined.X2, joined.A1])})`);
    expect(joined.branch !== null && joined.branch.from === joined.x1Row && joined.branch.to === joined.a1Row && joined.branch.endX === joined.BM.x && joined.branch.endY === joined.A1.y && joined.branch.curve, `the branch's line runs from X1 and curves into B's lane 0 at A1's row (${JSON.stringify([joined.branch, joined.BM.x, joined.A1.y])})`);
    expect(joined.bOnA1Row === 0 && joined.bars === 0, "no node of B's on A1's row and no fork bar, since A1 is on B's ancestry");
    // A sits at main's head BM, B's commit (M9 fix 151): A's row over BM
    // with a head bar on A's lane at BM's row.
    expect(joined.aHead !== null && joined.aHead.lane === joined.A1.lane && joined.aHead.y === joined.BM.y, `A's head bar on A's lane at BM's row (${JSON.stringify([joined.aHead, joined.A1, joined.BM])})`);
    expect(joined.lines.split(',').some((l) => l.startsWith(`session:${joined.BM.lane}:${joined.bmRow}-`) && +l.split('-')[1] >= joined.a1Row), `B's line runs from BM down to A1's row (${joined.lines})`);
    await s.screenshot('m9-fix145-forked-and-merged.png');
    step("M9 fix 145: a branch forked from another session's commit and merged curves into the session's own line at that commit's row, no node of the session's there and nothing of its on the other's lane");

    // M9 fix 144, the owed step, on the same repository: main's
    // first-parent chain is A1's block for A1 and Z0's (grey) for Z0, and
    // B's for BM and B0; each block's share of the chain sits on one lane
    // with every block drawn, and stays there while A's block and the
    // grey block are hidden in turn.
    const chain3 = git3('rev-list', '--first-parent', 'main').trim().split('\n');
    const chainLanes = () =>
      s.evalJs(`(() => { const out = {}; for (const h of ${JSON.stringify(chain3)}) { const n = document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); if (!n) continue; const key = n.dataset.session ?? 'outside'; (out[key] = out[key] ?? new Set()).add(n.dataset.lane); } return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].join(',')])); })()`);
    const oneLaneEach = (lanes) => Object.values(lanes).every((v) => !v.includes(','));
    const chainAll = await chainLanes();
    expect(Object.keys(chainAll).length === 3 && oneLaneEach(chainAll), `with every block drawn, each block's share of main's chain sits on one lane (${JSON.stringify(chainAll)})`);
    for (const hash of [A1, chain3[chain3.length - 1]]) {
      const hashSel = `.commits-row[data-hash=${JSON.stringify(hash)}] .commits-hash`;
      await s.evalJs(`document.querySelector(${JSON.stringify(hashSel)}).click()`);
      await s.waitFor(`!document.querySelector(${JSON.stringify(nodeSel(hash))})`, `${hash.slice(0, 7)}'s block is hidden`, 5000);
      const chainSome = await chainLanes();
      expect(Object.keys(chainSome).length === 2 && oneLaneEach(chainSome) && chainSome[sessB.id] === chainAll[sessB.id], `with ${hash.slice(0, 7)}'s block hidden the rest keep one lane each, B's the same (${JSON.stringify(chainSome)})`);
      await s.evalJs(`document.querySelector(${JSON.stringify(hashSel)}).click()`);
      await s.waitFor(`!!document.querySelector(${JSON.stringify(nodeSel(hash))})`, `${hash.slice(0, 7)}'s block is back`, 5000);
    }
    step("M9 fix 144: each block's share of main's first-parent chain sits on one lane, with every block drawn and with the other blocks hidden in turn");

    // M9 fix 151: the batch 145 shape. B's member cuts ff at BM and
    // commits F1 there; B commits B1 on main; the member merges main into
    // ff as FM; main is fast-forwarded to FM by hand. B's own chain (B1,
    // BM, B0) is the second-parent side of FM, so it draws on a side
    // lane, and B's star sits over FM, main's head, with its dashed
    // stretch bending into the member's lane onto FM's node rather than
    // ending in the air over the side lane. Then a by-hand commit on main
    // over FM moves the star over that, the stretch ending under a head
    // bar on B's own lane.
    const ffShort = path.join(os.tmpdir(), 'emerald-verify', `m51-bars-ff-${process.pid}`);
    fs.rmSync(ffShort, { recursive: true, force: true });
    git3('worktree', 'add', '-q', '-b', 'ff', ffShort, BM);
    const ffWt = fs.realpathSync.native(ffShort);
    const ffGit = gitIn(ffWt);
    await post(sessB.id, { cwd: repo3, hook_event_name: 'SubagentStart', agent_id: 'fm', agent_type: 'fork' });
    await post(sessB.id, { cwd: repo3, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'agent fm', subagent_type: 'fork' }, tool_response: { agentId: 'fm', description: 'agent fm', status: 'async_launched' } });
    const memberOwns = (hash) => s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(sessB.id)})?.team.find(m => m.id === 'fm')?.commits.some(c => c.hash === ${JSON.stringify(hash)}); })()`, `the member owns ${hash.slice(0, 7)}`, 8000);
    const memberCommit = async (name) => {
      const cmd = `git commit -q -m ${name}`;
      await post(sessB.id, { cwd: ffWt, agent_id: 'fm', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmd } });
      await sleep(300);
      fs.writeFileSync(path.join(ffWt, `${name}.txt`), name);
      ffGit('add', `${name}.txt`);
      ffGit('commit', '-q', '-m', name);
      const hash = ffGit('rev-parse', 'HEAD').trim();
      await post(sessB.id, { cwd: ffWt, agent_id: 'fm', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: cmd } });
      await memberOwns(hash);
      return hash;
    };
    await memberCommit('F1');
    const B1 = await commitVia(sessB.id, git3, 'B1', repo3);
    await owns(sessB.id, B1);
    const mergeMain = 'git merge --no-ff -m FM main';
    await post(sessB.id, { cwd: ffWt, agent_id: 'fm', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: mergeMain } });
    await sleep(300);
    ffGit('merge', '-q', '--no-ff', '-m', 'FM', 'main');
    const FM = ffGit('rev-parse', 'HEAD').trim();
    await post(sessB.id, { cwd: ffWt, agent_id: 'fm', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: mergeMain } });
    await memberOwns(FM);
    git3('merge', '-q', '--ff-only', 'ff');
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(FM))})?.dataset.member === 'fm' && [...document.querySelectorAll('.commits-row[data-hash=' + JSON.stringify(${JSON.stringify(FM)}) + '] .commits-pill')].some((p) => p.dataset.branch === 'main')`, "FM is the member's and main's pill sits on it", 15000);
    const ffProbe = () =>
      s.evalJs(
        `(() => { const b = ${JSON.stringify(sessB.id)}; const centre = ${centreJs}; const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const row = (h) => rows.findIndex(r => r.dataset.hash === h); const n = (h) => document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const own = rows.findIndex((r) => r.dataset.session === b && !r.dataset.member); const mark = document.querySelector('.commits-agent-node[data-session=' + JSON.stringify(b) + ']:not([data-member])'); const stretch = document.querySelector('.commits-edge[data-kind="pending"][data-session=' + JSON.stringify(b) + '][data-from="' + own + '"]'); const d = stretch ? stretch.getAttribute('d') : ''; const end = d.split(' ').slice(-2).map((v) => parseFloat(v.replace(/^[A-Za-z]/, ''))); const head = document.querySelector('.commits-bar[data-kind="head"][data-session=' + JSON.stringify(b) + ']'); const fm = n(${JSON.stringify(FM)}); return { own, fmRow: row(${JSON.stringify(FM)}), fm: fm ? { ...centre(fm), lane: fm.dataset.lane } : null, b1Lane: n(${JSON.stringify(B1)})?.dataset.lane ?? null, markLane: mark.dataset.lane, stretch: stretch ? { to: +stretch.dataset.to, dashed: 'dashed' in stretch.dataset, endX: end[0], endY: end[1], curve: d.includes('Q') } : null, head: head ? { ...centre(head), lane: head.dataset.lane } : null }; })()`,
      );
    let ff = await ffProbe();
    // A's row and the member's own sit over FM too, so B's is above it
    // by a few rows, not one.
    expect(ff.own !== -1 && ff.own < ff.fmRow && ff.fm !== null && ff.fm.lane !== ff.markLane && ff.b1Lane !== ff.markLane, `B's row sits over FM, the member's commit on a lane of its own, B1 on a side lane (${JSON.stringify(ff)})`);
    expect(ff.stretch !== null && ff.stretch.dashed && ff.stretch.to === ff.fmRow && ff.stretch.curve && ff.stretch.endX === ff.fm.cx && ff.stretch.endY === ff.fm.cy, `the star's dashed stretch bends into the member's lane and ends on FM's centre (${JSON.stringify([ff.stretch, ff.fm])})`);
    expect(ff.head === null, 'no head bar while the head is a commit of the block');
    await s.screenshot('m9-fix151-star-over-ff.png');
    fs.writeFileSync(path.join(repo3, 'H1.txt'), 'H1');
    git3('add', 'H1.txt');
    git3('commit', '-q', '-m', 'H1');
    const H1b = git3('rev-parse', 'HEAD').trim();
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(H1b))})?.dataset.outside !== undefined`, 'H1 lands as an outside commit on main', 15000);
    ff = await ffProbe();
    const h1Row = await s.evalJs(`[...document.querySelectorAll('.commits-graph-rows .commits-row')].findIndex((r) => r.dataset.hash === ${JSON.stringify(H1b)})`);
    expect(ff.own !== -1 && ff.own < h1Row && ff.stretch !== null && ff.stretch.to === h1Row && !ff.stretch.curve, `B's row moves over H1 and its stretch runs straight down to H1's row (${JSON.stringify([ff.own, h1Row, ff.stretch])})`);
    expect(ff.head !== null && ff.head.lane === ff.markLane && ff.head.cx === ff.stretch.endX && ff.head.cy === ff.stretch.endY, `the stretch ends under a head bar on B's own lane (${JSON.stringify([ff.head, ff.stretch])})`);
    await s.screenshot('m9-fix151-star-over-head-bar.png');
    await removeWorktree(git3, ffWt);
    step("M9 fix 151: the star sits over the head of its branch, its stretch bending onto a member's commit main was fast-forwarded to, and ending under a head bar when the head is someone else's");

    // M9 fix 185: a /clear in a Claude pane starts a new conversation, so
    // the work after it is a block of its own. What a real /clear posts
    // (Claude Code 2.1.272): SessionEnd reason=clear on the old id, then
    // SessionStart source=clear on a new session_id with a new transcript.
    // A shell in the third repository makes a commit by hand (C0, no
    // hook: nobody's on the graph) and then runs "claude": start, commit
    // C1, clear, commit C2; the graph draws two blocks of the shell's
    // colour, each with a start bar (the earlier span's on C0, HEAD when
    // Claude started, M9 fix 378, so the hand commit sits below the block
    // rather than inside its line; the second's on C1, HEAD at the clear),
    // C1 on the earlier span's lane and C2 on the live one's; the earlier
    // span's card names the conversation with Resume and Transcript.
    const sessC = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: repo3, cols: 80, rows: 24 })).session;
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return r.sessions.find(x => x.id === ${JSON.stringify(sessC.id)})?.startHead !== null; })()`, 'session C knows its start commit', 8000);
    // M9 fix 400: before any claude, the shell claims a commit of its own
    // through the fix 195 path (the Bash hooks with no session_id, since
    // no SessionStart has bound one yet). It is the session's commit and
    // was made before the first conversation existed, so it belongs on the
    // record's own live block, not inside the first conversation's. It
    // goes in under C0 so C0 stays HEAD when claude starts and the fix 378
    // reads below are unmoved.
    const CP = await commitVia(sessC.id, git3, 'CP', repo3);
    await owns(sessC.id, CP);
    fs.writeFileSync(path.join(repo3, 'C0.txt'), 'C0');
    git3('add', 'C0.txt');
    git3('commit', '-q', '-m', 'C0');
    const C0 = git3('rev-parse', 'HEAD').trim();
    const convC1 = `conv-c1-${process.pid}`;
    const convC2 = `conv-c2-${process.pid}`;
    await post(sessC.id, { session_id: convC1, cwd: repo3, hook_event_name: 'SessionStart', source: 'startup', transcript_path: path.join(claudeDir, `${convC1}.jsonl`) });
    const spansOf = (id) => s.evalJs(`(async () => { const r = await window.emerald.request('session.list', {}); const x = r.sessions.find(x => x.id === ${JSON.stringify(id)}); return x ? { spans: x.spans ?? null, claudeSessionId: x.claudeSessionId, startHead: x.startHead, name: x.name, color: x.color, createdAt: x.createdAt } : null; })()`);
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const x = r.sessions.find(x => x.id === ${JSON.stringify(sessC.id)}); return x?.spans?.length === 1 && x.spans[0].startHead === ${JSON.stringify(C0)}; })()`, 'the first span opens on C0, HEAD when Claude started, not on the spawn\'s start commit (M9 fix 378)', 8000);
    const firstSpan = await spansOf(sessC.id);
    expect(firstSpan.startHead !== C0 && firstSpan.spans[0].startedAt > firstSpan.createdAt, `the record keeps the spawn's start commit and the span starts after the spawn (${JSON.stringify([firstSpan.startHead, firstSpan.spans[0].startedAt - firstSpan.createdAt])})`);
    const C1 = await commitVia(sessC.id, git3, 'C1', repo3, convC1);
    await owns(sessC.id, C1);
    await post(sessC.id, { session_id: convC1, cwd: repo3, hook_event_name: 'SessionEnd', reason: 'clear', transcript_path: path.join(claudeDir, `${convC1}.jsonl`) });
    await post(sessC.id, { session_id: convC2, cwd: repo3, hook_event_name: 'SessionStart', source: 'clear', transcript_path: path.join(claudeDir, `${convC2}.jsonl`) });
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const x = r.sessions.find(x => x.id === ${JSON.stringify(sessC.id)}); return x?.spans?.length === 2 && x.spans[1].startHead === ${JSON.stringify(C1)} && x.claudeSessionId === ${JSON.stringify(convC2)}; })()`, 'the clear closes the first span and opens a second on C1 under the new id', 8000);
    const cSpans = await spansOf(sessC.id);
    expect(cSpans.spans[0].conversation === convC1 && cSpans.spans[0].endedAt !== null && cSpans.spans[0].startHead === C0 && cSpans.spans[1].conversation === convC2 && cSpans.spans[1].endedAt === null, `two spans, the first ended on the clear with its start on C0, the second open on C1 (${JSON.stringify(cSpans)})`);
    const C2 = await commitVia(sessC.id, git3, 'C2', repo3, convC2);
    await owns(sessC.id, C2);
    const spanC1 = `${sessC.id}#span1`;
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(C2))})?.dataset.session === ${JSON.stringify(sessC.id)} && document.querySelector(${JSON.stringify(nodeSel(C1))})?.dataset.session === ${JSON.stringify(spanC1)}`, "C2 is the live block's and C1 the earlier span's", 15000);
    const cleared = await s.evalJs(
      `(() => { const id = ${JSON.stringify(sessC.id)}; const span = ${JSON.stringify(spanC1)}; const grp = (k) => document.querySelector('.commits-lane-group[data-session=' + JSON.stringify(k) + ']'); const bars = (k) => [...document.querySelectorAll('.commits-node[data-shape="bar"][data-kind="start"][data-session=' + JSON.stringify(k) + ']')].map((b) => +b.getAttribute('y1')); const n = (h) => document.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const c0 = n(${JSON.stringify(C0)}); const c1 = n(${JSON.stringify(C1)}); const c2 = n(${JSON.stringify(C2)}); const cp = n(${JSON.stringify(CP)}); const rows = [...document.querySelectorAll('.commits-graph-rows .commits-row')]; const ownRows = rows.filter((r) => r.dataset.session === id && !r.dataset.member).length; return { live: grp(id) ? { span: grp(id).dataset.span ?? null, bars: bars(id) } : null, earlier: grp(span) ? { span: grp(span).dataset.span ?? null, bars: bars(span) } : null, c0: c0 ? { session: c0.dataset.session ?? null, cy: +c0.getAttribute('cy') } : null, c1: { lane: c1.dataset.lane, fill: getComputedStyle(c1).fill, cy: +c1.getAttribute('cy') }, c2: { lane: c2.dataset.lane, fill: getComputedStyle(c2).fill }, cp: cp ? { session: cp.dataset.session ?? null, lane: cp.dataset.lane, cy: +cp.getAttribute('cy') } : null, ownRows }; })()`,
    );
    expect(cleared.live !== null && cleared.earlier !== null && cleared.live.span === null && cleared.earlier.span === '1', `a lane group for the live block and one for the earlier span, the span's numbered (${JSON.stringify(cleared)})`);
    expect(cleared.c1.fill === rgb(cSpans.color) && cleared.c2.fill === rgb(cSpans.color) && cleared.c1.lane !== cleared.c2.lane, `both blocks in the session's colour on lanes of their own (${JSON.stringify([cleared.c1, cleared.c2, cSpans.color])})`);
    expect(cleared.live.bars.length === 1 && cleared.live.bars[0] === cleared.c1.cy && cleared.earlier.bars.length === 1 && cleared.earlier.bars[0] > cleared.c1.cy, `a start bar each, the live block's on C1's row and the earlier span's below it (${JSON.stringify([cleared.live.bars, cleared.earlier.bars, cleared.c1.cy])})`);
    // M9 fix 378: the earlier span's bar is on C0's row, HEAD when Claude
    // started, and C0 itself is nobody's, outside the block.
    expect(cleared.c0 !== null && cleared.c0.session === null && cleared.earlier.bars[0] === cleared.c0.cy, `the earlier span's bar sits on C0's row and C0, the hand commit before claude, is outside the block (${JSON.stringify([cleared.c0, cleared.earlier.bars])})`);
    // M9 fix 400: CP, claimed before the first conversation opened, is on
    // the record's own live block and on its lane, below the live block's
    // start bar, which has not moved off C1.
    expect(cleared.cp !== null && cleared.cp.session === sessC.id, `CP, claimed before claude started, is the live block's and not the earlier span's (${JSON.stringify(cleared.cp)})`);
    expect(cleared.cp.lane === cleared.c2.lane && cleared.cp.cy > cleared.live.bars[0] && cleared.live.bars[0] === cleared.c1.cy, `CP sits on the live block's own lane below its start bar, and the bar is still on C1 (${JSON.stringify([cleared.cp, cleared.c2.lane, cleared.live.bars, cleared.c1.cy])})`);
    expect(cleared.ownRows === 1, `one row for the session, the live block's (${cleared.ownRows})`);
    // The earlier span's card: named with no ordinal (the first), ended,
    // with Resume through its conversation and Transcript.
    const spanNodeSel = `.commits-lane-group[data-session=${JSON.stringify(spanC1)}] .commits-node`;
    await settled(spanNodeSel);
    await hoverOver(spanNodeSel);
    const spanOpened = await s.waitFor(`!!document.querySelector('.lane-popover')`, 'the earlier span opens its card', 3000).then(() => true, () => false);
    if (!spanOpened) {
      console.log('[verify] the span card did not open on the first hover; trying once more');
      await away();
      await settled(spanNodeSel);
      await hoverOver(spanNodeSel);
      await s.waitFor(`!!document.querySelector('.lane-popover')`, 'the earlier span opens its card (second try)', 3000);
    }
    const spanCard = await readCard();
    expect(spanCard.session === spanC1 && spanCard.name === cSpans.name && /^ended \d+(h|m|s)( \d+(m|s))? ago$/.test(spanCard.state) && spanCard.actions === 'resume,transcript,layout,solo,lines', `the card is the earlier span's: the session's name, ended, Resume and Transcript and the block actions, no Show and no Colour (${JSON.stringify(spanCard)})`);
    await away();
    await s.screenshot('m9-fix185-cleared-blocks.png');
    step("M9 fix 185: a /clear starts a new conversation span, the graph draws a block per span in the session's colour with a start bar each, the second's on the HEAD at the clear, and the earlier span's card reaches its conversation; M9 fix 400: a commit claimed before the first conversation opened sits on the live block below its start bar, not inside the first conversation");

    // M9 fix 186, redrawn by M9 fix 212 as design 4a (the fitted slab,
    // docs/design/commits-focus-slab.md): the focused pane's session says
    // "you are here" on the graph with a ground slab fitted to its tree
    // and by weight, the focused tree's lanes at 2.5px and dots at r 4,
    // every other tree's at 1.5px and r 2.8 at half opacity, nothing
    // blurred. The focus follows the pane: C's row shift-clicked puts C on
    // a pane beside and focuses it; the slab's far edge is at C's last row
    // and not the list's end; C's earlier span, a block of its own on the
    // same columns further down (M71 packs blocks whose rows do not
    // overlap into one column), stands outside the slab's solid ground;
    // every mark of C's tree, its own row's glyph box included, stands on
    // the solid ground and not in a ramp; the list layout lights the same;
    // and the graph opened in a pane focuses that view pane and nothing is
    // lit on either graph, every lane back at 2px.
    const slabRead = () =>
      s.evalJs(
        `(() => { const svg = document.querySelector('.commits-panel .commits-graph'); const slab = document.querySelector('.commits-panel .commits-focus-slab'); const groups = [...document.querySelectorAll('.commits-panel .commits-lane-group[data-focused]')].map((g) => g.dataset.session); const focusedBlock = document.querySelector('.commits-panel .commits-lane-group[data-focused] .commits-node')?.dataset.block ?? null; const num = (v) => parseFloat(String(v).replace('calc(', '')); const edges = [...svg.querySelectorAll('.commits-edge')].map((e) => ({ block: e.dataset.block, own: 'own' in e.dataset, width: num(getComputedStyle(e).strokeWidth), opacity: +getComputedStyle(e).opacity })); const nodes = [...svg.querySelectorAll('circle.commits-node')].map((n) => ({ block: n.dataset.block, r: num(getComputedStyle(n).r), opacity: +getComputedStyle(n).opacity, cx: +n.getAttribute('cx'), cy: +n.getAttribute('cy'), ra: +n.getAttribute('r') })); const marks = [...svg.querySelectorAll('.commits-agent-node')].map((m) => { const f = m.querySelector('foreignObject'); return { session: m.dataset.session, lit: 'lit' in m.dataset, x: +f.getAttribute('x'), y: +f.getAttribute('y'), w: +f.getAttribute('width'), h: +f.getAttribute('height'), bg: getComputedStyle(m.querySelector('.commits-agent-mark')).backgroundColor }; }); const blurred = [...svg.querySelectorAll('*')].filter((el) => { const cs = getComputedStyle(el); return cs.filter !== 'none' || cs.textShadow !== 'none'; }).length; const halos = svg.querySelectorAll('.commits-halo, .commits-halo-node, .commits-focus-band').length; const box = slab ? slab.getBBox() : null; const solid = slab ? slab.dataset.solid.split(' ').map(Number) : null; const rowsOf = slab ? slab.dataset.rows.split(' ').map(Number) : null; return { svg: svg?.dataset.focused ?? null, svgHeight: +svg.getAttribute('height'), groups, focusedBlock, slab: slab ? { session: slab.dataset.session, x: box.x, y: box.y, w: box.width, h: box.height, solid, rows: rowsOf, fades: slab.dataset.fades, fill: slab.getAttribute('fill') } : null, edges, nodes, marks, blurred, halos }; })()`,
      );
    const uniq = (xs) => [...new Set(xs)].join('|');
    const inSlab = (r, x0, x1) => r.cx - r.ra >= x0 - 0.5 && r.cx + r.ra <= x1 + 0.5;
    const focusId = sessC.id;
    const focusName = 'C';
    await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(focusId)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
    await s.waitFor(`document.querySelector('.commits-panel .commits-graph')?.dataset.focused === ${JSON.stringify(focusId)}`, `${focusName}'s pane is focused and the graph lights its block`, 10000);
    // C's commits just landed, and a fresh dot's r runs 6 to 3 over a
    // second (the commits-fresh keyframes) before the weight rule's 4 reads
    // true; a read inside that second saw 5.9 once. Let the run finish.
    await s.waitFor(`[...document.querySelectorAll('.commits-panel .commits-graph circle.commits-node')].every((n) => n.getAnimations().every((a) => a.playState === 'finished'))`, 'the fresh dots have settled', 4000);
    let lit = await slabRead();
    const groundShade = await s.evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--graph-focus-ground').trim()`);
    expect(groundShade === '#2a2d2e', `the slab token is the design's #2a2d2e (${groundShade})`);
    expect(lit.groups.length === 1 && lit.groups[0] === focusId && lit.slab !== null && lit.slab.session === focusId && lit.focusedBlock !== null, `${focusName}'s lane group alone carries data-focused and the slab names it (${JSON.stringify([lit.groups, lit.slab])})`);
    // 1. The far edge at C's last row plus the margin and the fade, short
    // of the list's end (upright, newest first: row r spans r*22 on).
    const slabEnd = lit.slab.y + lit.slab.h;
    const lastRowBottom = (lit.slab.rows[1] + 1) * 22;
    expect(lit.slab.fades === 'start,end' && Math.abs(slabEnd - (lastRowBottom + 11 + 22)) < 1 && slabEnd < lit.svgHeight && Math.abs(lit.slab.solid[1] - (lastRowBottom + 11)) < 1, `the slab fades at both ends and its far edge is 33px past C's last row, short of the list's end (${JSON.stringify([lit.slab, lit.svgHeight])})`);
    // 1b. Across (M9 fix 236): the slab is whole, not cut at the SVG's
    // left edge, and the focused block's outermost lane centres sit an
    // inset in from its sides, so a one-lane block's line is at its middle.
    // The first lane of any block is at or past the inset, since the SVG
    // cuts what is left of 0 and a 6px origin drew the first slab from -5.
    const focusedX = lit.nodes.filter((n) => n.block === lit.focusedBlock).map((n) => n.cx);
    const slabMid = lit.slab.x + lit.slab.w / 2;
    const laneMid = (Math.min(...focusedX) + Math.max(...focusedX)) / 2;
    const firstLane = Math.min(...lit.nodes.map((n) => n.cx));
    expect(lit.slab.x >= 0 && Math.abs(slabMid - laneMid) < 0.5 && Math.abs(lit.slab.x - (Math.min(...focusedX) - 11)) < 0.5 && firstLane >= 11, `the slab starts at or past the gutter's left edge with C's lanes centred on it, and the first lane is at least the 11px inset in (${JSON.stringify([lit.slab.x, lit.slab.w, focusedX, firstLane])})`);
    // 2. No other block's node stands on C's solid ground, however far its
    // columns reach: a different session's tree reusing C's columns
    // further down (M71 packs blocks whose rows do not overlap into one
    // column) is off the lit slab, which is the bug the fitted slab fixes.
    // Whether a neighbour actually sits below C in this run's fixture is
    // noted; the slab's far edge at C's last row (assertion 1) is the
    // vertical bound either way.
    const others = lit.nodes.filter((n) => n.block !== lit.focusedBlock && inSlab(n, lit.slab.x, lit.slab.x + lit.slab.w));
    const below = others.filter((n) => n.cy > lit.slab.solid[1]);
    console.log(`[verify] fix 212 columns: ${others.length} other-block nodes in C's columns, ${below.length} below the slab`);
    expect(others.every((n) => n.cy - n.ra >= lit.slab.solid[1] - 0.5 || n.cy + n.ra <= lit.slab.solid[0] + 0.5), `no other block's node stands on C's solid ground (${JSON.stringify([others.length, below.length, lit.slab.solid])})`);
    // 3. Weight: C's tree at 2.5px and r 4 at full opacity, every other at
    // 1.5px and r 2.8 at half. B's own line is a step heavier than its
    // member's since M9 fix 305 (data-own), so the one-weight reads leave
    // the own edges out; the fix 305 step reads that ladder.
    const mine = { edges: lit.edges.filter((e) => e.block === lit.focusedBlock && !e.own), nodes: lit.nodes.filter((n) => n.block === lit.focusedBlock) };
    const theirs = { edges: lit.edges.filter((e) => e.block !== lit.focusedBlock && !e.own), nodes: lit.nodes.filter((n) => n.block !== lit.focusedBlock) };
    // The weights read as ratios of the focused tree's to another's, so the
    // reads are free of the calc serialization and any residual zoom: the
    // lanes 2.5 to 1.5, the dots 4 to 2.8, the focused tree full and the
    // rest at half opacity.
    const one = (xs) => xs.length > 0 && xs.every((v) => Math.abs(v - xs[0]) < 0.01) ? xs[0] : NaN;
  const num = (v) => parseFloat(String(v).replace('calc(', ''));  const myW = one(mine.edges.map((e) => e.width)), thW = one(theirs.edges.map((e) => e.width));
    const myR = one(mine.nodes.map((n) => n.r)), thR = one(theirs.nodes.map((n) => n.r));
    expect(mine.edges.length > 0 && Math.abs(myW / thW - 2.5 / 1.5) < 0.02 && mine.edges.every((e) => e.opacity === 1) && Math.abs(myR / thR - 4 / 2.8) < 0.02 && mine.nodes.every((n) => n.opacity === 1), `C's lanes are 2.5 to the others' 1.5 and its dots 4 to 2.8, at full opacity (${JSON.stringify([myW, thW, myR, thR])})`);
    expect(theirs.edges.length > 0 && theirs.edges.every((e) => e.opacity === 0.5) && theirs.nodes.every((n) => n.opacity === 0.5), `every other tree's lanes and dots are at half opacity (${JSON.stringify([theirs.edges.map((e) => e.opacity), theirs.nodes.map((n) => n.opacity)])})`);
    // 4. Nothing in the gutter is blurred or shadowed, and no halo is left.
    expect(lit.blurred === 0 && lit.halos === 0, `no blur filter, no text shadow and no halo element in the gutter (${JSON.stringify([lit.blurred, lit.halos])})`);
    // 6. Every mark of C's tree, its own row's glyph box included, stands
    // on the solid ground, across and along; the glyph's box takes the
    // slab's colour.
    const myMarks = lit.marks.filter((m) => m.session === focusId);
    const onGround = mine.nodes.every((n) => inSlab(n, lit.slab.x, lit.slab.x + lit.slab.w) && n.cy - n.ra >= lit.slab.solid[0] && n.cy + n.ra <= lit.slab.solid[1]) && myMarks.every((m) => m.lit && m.x >= lit.slab.x && m.x + m.w <= lit.slab.x + lit.slab.w && m.y >= lit.slab.solid[0] && m.y + m.h <= lit.slab.solid[1] && m.bg === rgb(groundShade));
    expect((myMarks.length > 0 || focusId !== sessC.id) && onGround, `${focusName}'s dots and its glyph box all stand on the solid ground, not in a ramp, the box in the slab's colour (${JSON.stringify([myMarks, mine.nodes.map((n) => [n.cx, n.cy]), lit.slab])})`);
    await s.screenshot('m9-fix212-slab.png');
    // The list layout lights the same block, its slab fitted the same.
    await s.evalJs(`document.querySelector('.commits-chip[data-view="list"]').click()`);
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.view === 'list' && document.querySelector('.commits-panel .commits-lane-group[data-focused]')?.dataset.session === ${JSON.stringify(focusId)}`, `the list lights ${focusName} too`, 5000);
    lit = await slabRead();
    const listMy = one(lit.edges.filter((e) => e.block === lit.focusedBlock && !e.own).map((e) => e.width));
    const listTh = one(lit.edges.filter((e) => e.block !== lit.focusedBlock && !e.own).map((e) => e.width));
    expect(lit.slab !== null && lit.slab.session === focusId && lit.slab.y + lit.slab.h < lit.svgHeight && Math.abs(listMy / listTh - 2.5 / 1.5) < 0.02, `the slab and the weight in the list layout, the slab short of the list's end (${JSON.stringify([lit.slab, listMy, listTh])})`);
    await s.evalJs(`document.querySelector('.commits-chip[data-view="graph"]').click()`);
    await s.waitFor(`document.querySelector('.commits-panel')?.dataset.view === 'graph'`, 'back to the graph', 5000);
    // A press on B's pane moves the light to B.
    const bPane = await s.evalJs(`(async () => { const l = (await window.emerald.request('layout.get', {})).layout; const tab = l.tabs.find((t) => t.id === l.currentTabId); const walk = (n) => n.kind === 'pane' ? [n] : [...walk(n.first), ...walk(n.second)]; return walk(tab.root).find((p) => p.sessionId === ${JSON.stringify(sessB.id)})?.id ?? null; })()`);
    expect(bPane !== null, "B is on a pane of the tab on show (the fix 145 step put it there)");
    const bPaneAt = await s.evalJs(`(() => { const r = document.querySelector('.pane[data-pane-id=' + JSON.stringify(${JSON.stringify(bPane)}) + '] .pane-title').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.click(bPaneAt.x, bPaneAt.y);
    await s.waitFor(`document.querySelector('.commits-panel .commits-graph')?.dataset.focused === ${JSON.stringify(sessB.id)}`, "the light moves to B's block on a press on B's pane", 10000);
    lit = await slabRead();
    expect(lit.groups.length === 1 && lit.groups[0] === sessB.id && lit.slab !== null && lit.slab.session === sessB.id && lit.nodes.filter((n) => n.block === lit.focusedBlock).every((n) => inSlab(n, lit.slab.x, lit.slab.x + lit.slab.w)), `B's block alone is lit now, its slab around B's dots (${JSON.stringify([lit.groups, lit.slab])})`);
    // 5. The graph in a pane: the view pane takes the focus, nothing is lit
    // on the rail's graph or the pane's, and every lane is back at 2px
    // and r 3.4 at full opacity.
    await s.evalJs(`document.querySelector('.commits-open-pane').click()`);
    await s.waitFor(`!!document.querySelector('.pane.focused[data-view="commits"]') && document.querySelectorAll('.commits-graph').length === 2`, 'the graph opens in a pane that takes the focus', 10000);
    await s.waitFor(`[...document.querySelectorAll('.commits-graph')].every((g) => !('focused' in g.dataset)) && !document.querySelector('.commits-focus-slab') && !document.querySelector('.commits-lane-group[data-focused]')`, 'with a view pane focused nothing is lit on either graph', 5000);
    lit = await slabRead();
    const clearedW = one(lit.edges.filter((e) => !e.own).map((e) => e.width)), clearedR = one(lit.nodes.map((n) => n.r));
    expect(lit.slab === null && !Number.isNaN(clearedW) && !Number.isNaN(clearedR), `focus cleared, every lane one weight and every dot one radius again (${JSON.stringify([lit.edges.map((e) => e.width), lit.nodes.map((n) => n.r)])})`);
    step("M9 fix 186 and 212: the focused pane's session lights its block with a slab fitted to its tree and by weight, another block on the same columns outside it, every mark on solid ground, nothing blurred, in the graph and the list alike; the light follows the focus and a view pane lights nothing");

    // M9 fix 195: a commit made by a script the session ran, no git in the
    // command's text, is the session's all the same: HEAD is compared
    // around every Bash call in a repository, so the node lands on B's
    // lane and not in the grey block.
    const B9 = await commitVia(sessB.id, git3, 'B9', repo3, null, 'script');
    await owns(sessB.id, B9);
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(B9))})?.dataset.session === ${JSON.stringify(sessB.id)}`, "the script's commit is on B's lane", 10000);
    const b9 = await nodeOf(B9);
    expect(b9.session === sessB.id && !b9.outside && b9.fill === (await nodeOf(B1)).fill, `B9 is B's, in B's colour, not in the outside block (${JSON.stringify(b9)})`);
    step("M9 fix 195: a commit made through a script with no git in the command's text is credited to the session that ran it");

    // M9 fix 210: the sideways graph in a pane keeps the scroll where the
    // person put it while the work grows. The commits pane the fix 186
    // step opened goes along the bottom, on its side with the rows off and
    // low enough that the tracks outgrow it; the repository is seeded past
    // the log's window (200 commits, GRAPH_ENTRIES) on an orphan branch
    // older than everything, so every commit that lands from now on pushes
    // one row out of the window and used to slide every column toward the
    // old end under a scroll that stayed. The view is scrolled to a place
    // of its own and tagged, then a named node is read at the same place
    // on screen after a commit lands, a member spawns into a worktree (a
    // track added), that member leaves, and the pane's height changes,
    // with the view element still the tagged one throughout (never
    // remounted). An empty read of the graph is not forced here: gitGraph
    // reads with --no-optional-locks and git log never takes index.lock,
    // so a lock held across a poll does not empty it; the hold across an
    // empty read is proved by holdGraph's unit test alone.
    const deepCount = 210;
    let deepStream = '';
    for (let i = 0; i < deepCount; i += 1) {
      const msg = `d${i}\n`;
      deepStream += `commit refs/heads/deep\ncommitter verify <verify@example.invalid> ${1600000000 + i} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}M 644 inline d.txt\ndata ${Buffer.byteLength(msg)}\n${msg}\n`;
    }
    execFileSync('git', ['fast-import', '--quiet'], { cwd: repo3, input: deepStream, stdio: ['pipe', 'pipe', 'pipe'] });
    // The named node is B9, the newest of B's, where the marks are; the
    // orphan chain lies to its left.
    const namedNode = B9;
    let tabLayout = await getLayout(s);
    const commitsLeaf = leaves(tabLayout).find((leaf) => leaf.view?.kind === 'commits');
    expect(commitsLeaf !== undefined, 'the commits pane of the fix 186 step is on the tab');
    const without = (node, id) => {
      if (node.kind === 'pane') return node;
      if (node.first.id === id) return node.second;
      if (node.second.id === id) return node.first;
      return { ...node, first: without(node.first, id), second: without(node.second, id) };
    };
    const tabHeight = await s.evalJs(`document.querySelector('.layout-tab:not([hidden])').getBoundingClientRect().height`);
    const bottomPane = (view) => ({ kind: 'pane', id: commitsLeaf.id, sessionId: null, view });
    const bottomLayout = (paneHeight, view) => ({ ...tabLayout, root: { kind: 'split', id: 'm210-bottom', direction: 'column', ratio: 1 - paneHeight / tabHeight, first: without(tabLayout.root, commitsLeaf.id), second: bottomPane(view) } });
    const sideRecord = { kind: 'commits', folder: repo3, rows: false, graph: { orientation: 'horizontal' } };
    await zreq(s, 'layout.set', { layout: bottomLayout(180, sideRecord) });
    const paneViewSel = `.pane[data-pane-id=${JSON.stringify(commitsLeaf.id)}] .commits-graph-view[data-orientation="horizontal"]`;
    await s.waitFor(`(() => { const v = document.querySelector(${JSON.stringify(paneViewSel)}); const svg = v?.querySelector('.commits-graph'); return !!svg && +svg.dataset.rows >= 200 && !!v.querySelector(${JSON.stringify(nodeSel(namedNode))}); })()`, 'the pane along the bottom, on its side, the window full and the named node drawn', 15000);
    const anchorProbe = () =>
      s.evalJs(
        `(() => { const v = document.querySelector(${JSON.stringify(paneViewSel)}); const svg = v.querySelector('.commits-graph'); const n = v.querySelector(${JSON.stringify(nodeSel(namedNode))}); const vr = v.getBoundingClientRect(); return { at: n === null ? null : Math.round((n.getBoundingClientRect().left - vr.left) * 10) / 10, tagged: v.dataset.token === 'm210', scrollLeft: v.scrollLeft, clientWidth: v.clientWidth, clientHeight: v.clientHeight, scrollHeight: v.scrollHeight, start: Math.round((svg.getBoundingClientRect().left - vr.left + v.scrollLeft) * 10) / 10, rows: +svg.dataset.rows, height: +svg.getAttribute('height'), paneHeight: Math.round(v.closest('.pane').getBoundingClientRect().height) }; })()`,
      );
    let anchored = await anchorProbe();
    expect(anchored.scrollHeight > anchored.clientHeight && anchored.paneHeight <= 182, `the pane is low enough that the tracks outgrow it (${JSON.stringify(anchored)})`);
    // The place of the person's own: the named node 200px in from the
    // left edge and in the middle across, the scroll set by hand and the
    // view tagged.
    await s.evalJs(`(() => { const v = document.querySelector(${JSON.stringify(paneViewSel)}); const n = v.querySelector(${JSON.stringify(nodeSel(namedNode))}); const r = n.getBoundingClientRect(); const vr = v.getBoundingClientRect(); v.scrollLeft = r.left - vr.left + v.scrollLeft - 200; v.scrollTop = Math.max(0, r.top - vr.top + v.scrollTop - v.clientHeight / 2); v.dataset.token = 'm210'; })()`);
    await sleep(400);
    const anchored0 = await anchorProbe();
    expect(Math.abs(anchored0.at - 200) < 2 && anchored0.tagged && anchored0.scrollLeft > 0, `the named node sits 200px in and the view is tagged (${JSON.stringify(anchored0)})`);
    const stays = (what) => {
      expect(anchored.tagged, `the view is the same element after ${what} (${JSON.stringify(anchored)})`);
      expect(anchored.at !== null && Math.abs(anchored.at - anchored0.at) < 1.5, `the named node is where it was after ${what} (${JSON.stringify([anchored0.at, anchored.at, anchored0.scrollLeft, anchored.scrollLeft, anchored0.start, anchored.start])})`);
    };
    // A commit lands: one row in, one out of the full window.
    const B10 = await commitVia(sessB.id, git3, 'B10', repo3);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(paneViewSel + ' ' + nodeSel(B10))})`, 'the landing commit is drawn in the pane', 10000);
    await sleep(400);
    anchored = await anchorProbe();
    stays('a commit landed');
    expect(anchored.rows === anchored0.rows, `the window stays full, a row in and a row out (${anchored0.rows} to ${anchored.rows})`);
    // A member spawns into a worktree: a track added across, and the
    // tracks outgrow the pane further.
    const dfxShort = path.join(os.tmpdir(), 'emerald-verify', `m51-dfx-${process.pid}`);
    fs.rmSync(dfxShort, { recursive: true, force: true });
    git3('worktree', 'add', '-q', '-b', 'dfx', dfxShort, B10);
    fixDirs.push(fs.realpathSync.native(dfxShort));
    await post(sessB.id, { cwd: repo3, hook_event_name: 'SubagentStart', agent_id: 'dfx', agent_type: 'fork' });
    await post(sessB.id, { cwd: repo3, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'agent dfx', subagent_type: 'fork' }, tool_response: { agentId: 'dfx', description: 'agent dfx', status: 'async_launched' } });
    await post(sessB.id, { cwd: fixDirs[fixDirs.length - 1], agent_id: 'dfx', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    await post(sessB.id, { cwd: fixDirs[fixDirs.length - 1], agent_id: 'dfx', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    await s.waitFor(`!!document.querySelector(${JSON.stringify(paneViewSel)} + ' .commits-agent-node[data-member="dfx"]')`, "the member's mark is drawn in the pane", 10000);
    await sleep(400);
    const withTrack = await anchorProbe();
    anchored = withTrack;
    stays('a member spawned into a worktree');
    expect(withTrack.height > anchored0.height, `a track was added (${anchored0.height} to ${withTrack.height})`);
    // The member leaves: its track goes once the next prompt drops it
    // from the team (fix 138), a commit-less member leaving no lane.
    await post(sessB.id, { cwd: repo3, hook_event_name: 'SubagentStop', agent_id: 'dfx', agent_type: 'fork' });
    await post(sessB.id, { cwd: repo3, hook_event_name: 'UserPromptSubmit', prompt: 'and now the next thing' });
    await s.waitFor(`!document.querySelector(${JSON.stringify(paneViewSel)} + ' .commits-agent-node[data-member="dfx"]')`, "the member's mark is gone from the pane", 10000);
    await sleep(400);
    anchored = await anchorProbe();
    stays('the member left');
    expect(anchored.height < withTrack.height, `the track went with it (${withTrack.height} to ${anchored.height})`);
    // The pane's height changes: the box is resized under the view.
    tabLayout = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...tabLayout, root: { ...tabLayout.root, ratio: 1 - 240 / tabHeight } } });
    await s.waitFor(`Math.abs(document.querySelector(${JSON.stringify(`.pane[data-pane-id=${JSON.stringify(commitsLeaf.id)}]`)}).getBoundingClientRect().height - 240) < 3`, 'the pane made taller', 5000);
    await sleep(400);
    anchored = await anchorProbe();
    stays("the pane's height changed");
    await s.screenshot('m9-fix210-grows.png');
    await s.screenshot('m9-fix129-grows.png');
    step("M9 fix 210: on its side in a pane with the window full, the scroll keeps the named node where the person put it as a commit lands, a member's track comes and goes and the pane is resized, on one view element throughout; the hold across an empty read is the unit test's");

    // M9 fix 214: the rows say which branch each commit is on. A commit
    // on the dfx worktree branch (cut at B10, above) beside one on main:
    // the branch's row leans its subject 6px with a hairline in the row's
    // colour the height of the row, main's sits flush at depth 0, the
    // merged x branch's commits keep their lean, and the orphan deep
    // branch, whose chain runs off the window's edge, reads as one deep.
    // The rail's rows are upright; the pane along the bottom has none.
    const dfxWt = fixDirs[fixDirs.length - 1];
    DX1 = await commitVia(sessB.id, gitIn(dfxWt), 'DX1', dfxWt);
    await owns(sessB.id, DX1);
    const B11 = await commitVia(sessB.id, git3, 'B11', repo3);
    await owns(sessB.id, B11);
    const deepTip = git3('rev-parse', 'deep').trim();
    rowSelOf = (hash) => `.files-rail .commits-graph-rows .commits-row[data-hash=${JSON.stringify(hash)}]`;
    // Two commits a second apart are two log reads in flight, and the
    // older can land last and take the newer row off the rail for a
    // moment, so the rows are waited for, given a beat, waited for again
    // and then read together off one render.
    const bothRows = `!!document.querySelector(${JSON.stringify(rowSelOf(DX1))}) && !!document.querySelector(${JSON.stringify(rowSelOf(B11))})`;
    await s.waitFor(bothRows, 'both rows are in the rail', 10000);
    await sleep(1500);
    await s.waitFor(bothRows, 'both rows are still in the rail', 10000);
    const depthProbe = (hashes) =>
      s.evalJs(
        `(() => { const one = (hash) => { const row = document.querySelector('.files-rail .commits-graph-rows .commits-row[data-hash="' + hash + '"]'); if (row === null) return null; const sub = row.querySelector('.commits-subject'); const cs = getComputedStyle(sub); const line = getComputedStyle(sub, '::before'); return { depth: row.dataset.depth, pad: cs.paddingLeft, subHeight: Math.round(sub.getBoundingClientRect().height), rowHeight: Math.round(row.getBoundingClientRect().height), line: line.content === 'none' ? null : { width: line.width, height: line.height, color: line.backgroundColor }, lane: row.style.getPropertyValue('--lane') }; }; return ${JSON.stringify(hashes)}.map(one); })()`,
      );
    const [dx, b11, x1, bm, deep] = await depthProbe([DX1, B11, X1, BM, deepTip]);
    expect(dx !== null && dx.depth === '1' && dx.pad === '6px', `the worktree branch's commit is one off the trunk, its subject leaning 6px (${JSON.stringify(dx)})`);
    expect(dx.line !== null && dx.line.width === '1px' && dx.subHeight === dx.rowHeight && dx.line.height === `${dx.rowHeight}px`, `a 1px hairline the height of the row at the lean's edge (${JSON.stringify(dx)})`);
    expect(dx.lane !== '' && dx.line.color === rgb(dx.lane), `the hairline is in the row's own colour (${JSON.stringify(dx)})`);
    expect(b11 !== null && b11.depth === '0' && b11.pad === '0px' && b11.line === null, `main's commit is on the trunk, flush, with no hairline (${JSON.stringify(b11)})`);
    expect(x1 !== null && x1.depth === '1' && x1.pad === '6px', `the merged x branch keeps its lean (${JSON.stringify(x1)})`);
    expect(bm !== null && bm.depth === '0', `the merge commit itself is on the trunk (${JSON.stringify(bm)})`);
    expect(deep !== null && deep.depth === '1', `the orphan branch, off the window's edge, reads one deep (${JSON.stringify(deep)})`);
    // The list is the same rows, so it leans the same.
    await s.evalJs(`document.querySelector('.files-rail .commits-switch [data-view="list"]').click()`);
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.view === 'list' && ${bothRows}`, 'the list', 8000);
    const [dxList] = await depthProbe([DX1]);
    expect(dxList !== null && dxList.depth === '1' && dxList.pad === '6px', `the list's row leans the same (${JSON.stringify(dxList)})`);
    await s.evalJs(`document.querySelector('.files-rail .commits-switch [data-view="graph"]').click()`);
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.view === 'graph'`, 'graph again', 8000);
    await s.screenshot('m9-fix214-depth.png');
    step("M9 fix 214: a commit on a worktree branch leans its subject 6px behind a hairline in the row's colour, main's sits flush, a merged branch keeps its lean and the merge is on the trunk, in the graph and the list alike");
  });

  await block('fix-252', async () => {
    // M9 fix 252: the commit's price on its card (docs/design/commit-price.md).
    // A repository of the step's own with one commit made by hand (Q0,
    // outside), a shell in it whose hooks bind a conversation, and four
    // commits it credits: Q1 the session's first, Q2 with a subagent out
    // in the stretch, QB a second subagent's own commit on its worktree
    // branch, and QM the merge of that branch. The transcript and the two
    // agent files are written under the run's Claude home once the claim
    // times are known, each request timed inside the slice it belongs to,
    // so every figure on a card is one the script can sum itself.
    const priceShort = path.join(os.tmpdir(), 'emerald-verify', `m51-price-${process.pid}`);
    fs.rmSync(priceShort, { recursive: true, force: true });
    fs.mkdirSync(priceShort, { recursive: true });
    priceRepo = fs.realpathSync.native(priceShort);
    const gitP = gitIn(priceRepo);
    gitP('init', '-q', '-b', 'main');
    gitP('config', 'user.name', 'verify');
    gitP('config', 'user.email', 'verify@example.invalid');
    gitP('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(priceRepo, 'Q0.txt'), 'Q0');
    gitP('add', 'Q0.txt');
    gitP('commit', '-q', '-m', 'Q0');
    const Q0 = gitP('rev-parse', 'HEAD').trim();
    const pbShort = path.join(os.tmpdir(), 'emerald-verify', `m51-price-pb-${process.pid}`);
    fs.rmSync(pbShort, { recursive: true, force: true });
    gitP('worktree', 'add', '-q', '-b', 'pb-branch', pbShort, Q0);
    pbWt = fs.realpathSync.native(pbShort);
    // The shell goes on a terminal pane of the tab and takes the focus, so
    // the rail's Commits tab follows it to the new repository; the pane
    // gets its session back at the end.
    sessP = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: priceRepo, cols: 80, rows: 24 })).session;
    priceLayout = await getLayout(s);
    priceLeaf = leaves(priceLayout).find((leaf) => leaf.sessionId !== null && (leaf.view === undefined || leaf.view === null));
    expect(priceLeaf !== undefined, 'a terminal pane to put the shell on');
    swapIn = (node, sessionId) => (node.kind === 'pane' ? (node.id === priceLeaf.id ? { ...node, sessionId } : node) : { ...node, first: swapIn(node.first, sessionId), second: swapIn(node.second, sessionId) });
    await zreq(s, 'layout.set', { layout: { ...priceLayout, root: swapIn(priceLayout.root, sessP.id), focusedPaneId: priceLeaf.id } });
    postP = (payload) => post(sessP.id, { cwd: priceRepo, ...payload });
    railRow = (hash) => `.files-rail .commits-graph-rows .commits-row[data-hash=${JSON.stringify(hash)}]`;
    await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]')?.click()`);
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.folder === ${JSON.stringify(priceRepo)} && !!document.querySelector(${JSON.stringify(railRow(Q0))})`, 'the rail shows the price repository', 10000);
    const CONV = `sim-${sessP.id}`;
    await postP({ hook_event_name: 'SessionStart', source: 'startup' });
    // M9 fix 287: a status line naming Opus 5, read later off the record's
    // own row once the price scenario below has run its course.
    await postP({
      hook_event_name: 'StatusLine',
      model: { id: 'claude-opus-5', display_name: 'Opus 5' },
      context_window: { used_percentage: 5, context_window_size: 200000, total_input_tokens: 1000, current_usage: { input_tokens: 1, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 } },
      cost: { total_cost_usd: 0.05 },
    });
    await postP({ hook_event_name: 'UserPromptSubmit', prompt: 'price the work' });
    await sleep(600);
    const Q1 = await commitVia(sessP.id, gitP, 'Q1', priceRepo);
    await sleep(1200);
    await postP({ hook_event_name: 'SubagentStart', agent_id: 'pa', agent_type: 'fork' });
    await postP({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'price agent a', subagent_type: 'fork' }, tool_response: { agentId: 'pa', description: 'price agent a', status: 'async_launched' } });
    await sleep(1200);
    await postP({ hook_event_name: 'SubagentStop', agent_id: 'pa', agent_type: 'fork' });
    await sleep(600);
    const Q2 = await commitVia(sessP.id, gitP, 'Q2', priceRepo);
    await sleep(1200);
    // The second agent commits on its own worktree branch (M61, fix 138).
    await postP({ hook_event_name: 'SubagentStart', agent_id: 'pb', agent_type: 'fork' });
    await postP({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'price agent b', subagent_type: 'fork' }, tool_response: { agentId: 'pb', description: 'price agent b', status: 'async_launched' } });
    await sleep(1200);
    const pbCommand = 'git commit -q -m QB';
    await postP({ cwd: pbWt, agent_id: 'pb', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: pbCommand } });
    await sleep(300);
    fs.writeFileSync(path.join(pbWt, 'QB.txt'), 'QB');
    const gitPB = gitIn(pbWt);
    gitPB('add', 'QB.txt');
    gitPB('commit', '-q', '-m', 'QB');
    const QB = gitPB('rev-parse', 'HEAD').trim();
    await postP({ cwd: pbWt, agent_id: 'pb', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: pbCommand } });
    await sleep(600);
    await postP({ hook_event_name: 'SubagentStop', agent_id: 'pb', agent_type: 'fork' });
    await sleep(1200);
    // The session merges the branch: a merge commit of its own.
    const mergeCommand = 'git merge --no-ff pb-branch';
    await postP({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: mergeCommand } });
    await sleep(300);
    // No -m: git's own subject, `Merge branch 'pb-branch'`, is what names the chain once the ref is gone (M9 fix 253).
    gitP('merge', '-q', '--no-ff', 'pb-branch');
    const QM = gitP('rev-parse', 'HEAD').trim();
    await postP({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: mergeCommand } });
    await sleep(600);
    await postP({ hook_event_name: 'Stop' });
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const x = r.sessions.find((x) => x.id === ${JSON.stringify(sessP.id)}); const all = [...x.commits, ...(x.team ?? []).flatMap((m) => m.commits)].map((c) => c.hash); return [${JSON.stringify(Q1)}, ${JSON.stringify(Q2)}, ${JSON.stringify(QB)}, ${JSON.stringify(QM)}].every((h) => all.includes(h)); })()`, 'the record credits the four commits', 10000);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(railRow(QM))}) && !!document.querySelector(${JSON.stringify(railRow(QB))})`, 'the merge and the branch commit are rows on the rail', 15000);
    const recP = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === sessP.id);
    const claimOf = (hash) => [...recP.commits, ...(recP.team ?? []).flatMap((m) => m.commits)].find((c) => c.hash === hash).at;
    const spanStart = recP.spans.at(-1).startedAt;
    const memberPb = recP.team.find((m) => m.id === 'pb');
    expect(memberPb !== undefined && recP.commits.some((c) => c.hash === QM && c.merge === true), `the merge is flagged and the member is still on the team (${JSON.stringify({ merge: recP.commits.find((c) => c.hash === QM), team: (recP.team ?? []).map((m) => m.id) })})`);
    // The requests: two before Q1, two of the session's own and one of
    // agent a's between Q1 and Q2, agent b's one before QB, one of the
    // session's own between Q2 and QM.
    // cacheWrite1h (M9 fix 278): the share of cacheWrite billed at the
    // 1-hour TTL, off usage.cache_creation, the same shape Claude Code
    // writes; 0 leaves the object off, as a transcript from before the
    // split would.
    usage = (fresh, cacheWrite, cacheRead, output, cacheWrite1h = 0) => ({
      input_tokens: fresh,
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
      output_tokens: output,
      ...(cacheWrite1h === 0 ? {} : { cache_creation: { ephemeral_5m_input_tokens: cacheWrite - cacheWrite1h, ephemeral_1h_input_tokens: cacheWrite1h } }),
    });
    let msgN = 0;
    line = (at, u, extra = {}) => jl({ type: 'assistant', isSidechain: false, timestamp: iso(at), message: { id: `msg_${msgN++}`, role: 'assistant', model: 'claude-opus-5', usage: u, content: [{ type: 'text', text: 'ok' }] }, ...extra });
    const m = (at, u, agentId = null) => ({ at, agentId, model: 'claude-opus-5', fresh: u.input_tokens, cacheWrite: u.cache_creation_input_tokens, cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens, output: u.output_tokens });
    const ownMsgs = [
      [spanStart + 200, usage(2, 100, 0, 50)],
      [claimOf(Q1) - 200, usage(3, 0, 4000, 120)],
      // The 1-hour share (fix 278): entirely 1-hour, so Q2's card is
      // proved to price above what the same tokens would cost at the
      // 5-minute rate, below.
      [claimOf(Q1) + 300, usage(4, 21000, 40000, 300, 21000)],
      [claimOf(Q2) - 200, usage(2, 0, 61000, 900)],
      [claimOf(QM) - 200, usage(1, 0, 61000, 40)],
    ];
    const agentA = [[claimOf(Q1) + 500, usage(5, 0, 8000, 200)]];
    const agentB = [[claimOf(QB) - 300, usage(6, 0, 9000, 400)]];
    const projectDir = path.join(claudeHome, 'projects', encode(priceRepo));
    fs.mkdirSync(path.join(projectDir, CONV, 'subagents'), { recursive: true });
    transcriptPath = path.join(projectDir, `${CONV}.jsonl`);
    fs.writeFileSync(transcriptPath, ownMsgs.map(([at, u]) => line(at, u)).join('') + jl({ type: 'user', timestamp: iso(claimOf(QM)), message: { role: 'user', content: 'thanks' } }));
    fs.writeFileSync(path.join(projectDir, CONV, 'subagents', 'agent-pa.jsonl'), agentA.map(([at, u]) => line(at, u, { isSidechain: true, agentId: 'pa' })).join(''));
    fs.writeFileSync(path.join(projectDir, CONV, 'subagents', 'agent-pb.jsonl'), agentB.map(([at, u]) => line(at, u, { isSidechain: true, agentId: 'pb' })).join(''));
    const all = [...ownMsgs.map(([at, u]) => m(at, u)), ...agentA.map(([at, u]) => m(at, u, 'pa')), ...agentB.map(([at, u]) => m(at, u, 'pb'))];
    const expectedP2 = sliceUsage(all, claimOf(Q1), claimOf(Q2));
    const expectedP1 = sliceUsage(all, spanStart, claimOf(Q1));
    // M9 fix 275: pb has a credited commit of its own (QB), so the merge's
    // slice leaves pb's request out and names it in a note of its own;
    // the whole slice is read too, to prove the figure moved.
    const expectedPMWhole = sliceUsage(all, claimOf(Q2), claimOf(QM));
    const expectedPM = sliceUsage(all, claimOf(Q2), claimOf(QM), (x) => x.agentId !== 'pb');
    const expectedPB = sliceUsage(all, memberPb.startedAt, claimOf(QB)).agents.find((a) => a.id === 'pb');
    const pbInMerge = expectedPMWhole.agents.find((a) => a.id === 'pb');
    clockOf = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    priceCardSel = (hash) => `.commit-popover[data-hash=${JSON.stringify(hash)}]`;
    awayCard = async () => {
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
      await s.waitFor(`!document.querySelector('.lane-popover, .agent-popover, .commit-popover')`, 'no card open');
    };
    const readPriceCard = (hash) =>
      s.evalJs(
        `(() => { const c = document.querySelector(${JSON.stringify(priceCardSel(hash))}); if (!c) return null; const part = (p) => c.querySelector('[data-part=' + JSON.stringify(p) + ']'); const text = (p) => part(p)?.querySelector('.sweep-card-text')?.textContent ?? null; const byEl = part('by')?.querySelector('.sweep-card-text'); const costEl = part('cost')?.querySelector('.sweep-card-text'); return { by: byEl?.textContent ?? null, byColor: byEl ? getComputedStyle(byEl).color : null, byData: byEl?.dataset.by ?? null, price: !!c.querySelector('.commit-price'), hairline: c.querySelector('.commit-price') ? getComputedStyle(c.querySelector('.commit-price')).borderTopWidth : null, slice: part('slice')?.textContent ?? null, cost: text('cost'), costColor: costEl ? getComputedStyle(costEl.querySelector('.sweep-card-absent') ?? costEl).color : null, costAbsent: !!part('cost')?.querySelector('.sweep-card-absent'), tokens: text('tokens'), tokensAbsent: !!part('tokens')?.querySelector('.sweep-card-absent'), cached: text('cached'), agentTime: text('agent-time'), agentTimeAbsent: !!part('agent-time')?.querySelector('.sweep-card-absent'), notes: [...c.querySelectorAll('.sweep-card-note')].map((n) => (n.dataset.part ?? '') + '=' + n.textContent), pending: !!c.querySelector('.commit-price[data-pending]') }; })()`,
      );
    const hoverRow = async (hash) => {
      const sel = railRow(hash);
      // The card opens off a 400 ms hover timer that a move of the row
      // under the stationary pointer clears (the strip above the graph
      // grows a track as a session changes shape), so the hover is tried
      // again from away when the card has not opened.
      for (let attempt = 0; ; attempt++) {
        await s.evalJs(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'nearest' })`);
        await settled(sel);
        const at = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel + ' .commits-subject')}).getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; })()`);
        await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
        try {
          await s.waitFor(`!!document.querySelector(${JSON.stringify(priceCardSel(hash))}) && !document.querySelector(${JSON.stringify(priceCardSel(hash))} + ' .commit-price[data-pending]')`, `the card of ${hash.slice(0, 7)} is open and its figures in`, 5000);
          break;
        } catch (err) {
          const seen = await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(priceCardSel(hash))}); const r = document.querySelector(${JSON.stringify(sel)}); return { card: c !== null, pending: !!c?.querySelector('.commit-price[data-pending]'), hover: r?.dataset.hover !== undefined, open: r?.dataset.popoverOpen ?? null }; })()`);
          console.log(`[verify] the card of ${hash.slice(0, 7)} did not open on try ${attempt + 1} (${JSON.stringify(seen)})`);
          if (attempt >= 2) throw err;
          await awayCard();
        }
      }
      return readPriceCard(hash);
    };
    const costText = (u) => `~${formatUsd(u.usd)}`;
    const costToken = await s.evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--cost').trim()`);
    const mutedToken = await s.evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--muted').trim()`);
    // 1. Q2, a full slice: the hash and both clock times, the three
    // figures, the note naming the agent.
    const c2 = await hoverRow(Q2);
    expect(c2.price && c2.hairline === '1px', `Q2's card has the price block under a 1px hairline (${JSON.stringify(c2)})`);
    expect(c2.slice === `since ${Q1.slice(0, 7)}, ${clockOf(claimOf(Q1))} to ${clockOf(claimOf(Q2))}`, `the slice line names Q1 and the two clock times (${c2.slice})`);
    expect(c2.cost === costText(expectedP2) && c2.costColor === rgb(costToken), `Cost is the slice's estimate in --cost (${c2.cost} against ${costText(expectedP2)}, ${c2.costColor})`);
    // M9 fix 278: the same tokens priced with no 1-hour share cost less,
    // so the card's figure is proved to move on the split, not just to
    // match a slice math that never distinguishes the two rates.
    const expectedP2FiveMin = sliceUsage(all.map((msg) => ({ ...msg, cacheWrite1h: 0 })), claimOf(Q1), claimOf(Q2));
    expect(expectedP2.usd > expectedP2FiveMin.usd, `the 1-hour share prices above the same tokens at the 5-minute rate (${expectedP2.usd} vs ${expectedP2FiveMin.usd})`);
    expect(/^\d+s$|^\d+m$/.test(c2.agentTime ?? '') && !c2.agentTimeAbsent, `Agent time is a figure off the hooks (${c2.agentTime})`);
    const agentShare = expectedP2.agents.find((a) => a.id === 'pa');
    expect(c2.notes.some((n) => n.startsWith(`agents=of which 1 agent ~${formatUsd(agentShare.usd)}, `)), `the note names the agent's share (${JSON.stringify(c2.notes)})`);
    // 2. The tokens string is tokensRowText's, character for character.
    expect(c2.tokens === tokensRowText({ tokens: expectedP2.tokens }), `the tokens read as the row would (${c2.tokens} against ${tokensRowText({ tokens: expectedP2.tokens })})`);
    await awayCard();
    // 3. Q1, the first commit: the wording and no agents note.
    const c1 = await hoverRow(Q1);
    expect(c1.slice === `since the session started, ${clockOf(spanStart)} to ${clockOf(claimOf(Q1))}`, `the first commit's slice starts at the session's start (${c1.slice})`);
    expect(c1.cost === costText(expectedP1) && !c1.notes.some((n) => n.startsWith('agents=')), `Q1 is priced with no agents note (${JSON.stringify(c1)})`);
    await awayCard();
    // 4. Q0, made by hand: no hairline and no price rows, the By line and
    // the note say why.
    const c0 = await hoverRow(Q0).catch(() => null);
    const c0Read = c0 ?? (await readPriceCard(Q0));
    expect(c0Read !== null && !c0Read.price && c0Read.hairline === null, `Q0's card has no price block (${JSON.stringify(c0Read)})`);
    expect(c0Read.byData === 'outside' && c0Read.byColor === rgb(mutedToken) && c0Read.notes.includes('why=no session claimed it, so it has no price'), `the By line is muted and the note says why (${JSON.stringify(c0Read)})`);
    await awayCard();
    // 6. QM, the merge: Cost is the merge's own slice, the note names the
    // branch's run, and the branch's figure is not inside Cost.
    const cm = await hoverRow(QM);
    expect(cm.cost === costText(expectedPM), `the merge prices its own slice (${cm.cost} against ${costText(expectedPM)})`);
    expect(pbInMerge !== undefined && expectedPMWhole.usd > expectedPM.usd && cm.cost !== costText(expectedPMWhole), `pb's request is out of the merge's Cost (M9 fix 275; ${cm.cost} against the whole ${costText(expectedPMWhole)})`);
    expect(cm.notes.includes(`elsewhere=1 agent ran here, priced on its own commit: ~${formatUsd(pbInMerge.usd)}`) && !cm.notes.some((n) => n.startsWith('agents=')), `the note names the agent priced on its own commit with its share, and no of-which note (${JSON.stringify(cm.notes)})`);
    const branchNote = cm.notes.find((n) => n.startsWith('branch='));
    expect(branchNote !== undefined && branchNote.startsWith(`branch=the branch's own run is priced on its 1 commit: ~${formatUsd(expectedPB.usd)}, `), `the note names the branch's run (${JSON.stringify(cm.notes)})`);
    expect(expectedPM.usd + expectedPB.usd > expectedPM.usd && cm.cost !== costText({ usd: expectedPM.usd + expectedPB.usd }), `the branch's dollars are not added into Cost (${cm.cost})`);
    await awayCard();
    // 7. QB, the agent's own commit: By names the session then the agent
    // in the lane's colour, and the note replaces the agents' share.
    const cb = await hoverRow(QB);
    const laneColor = await s.evalJs(`document.querySelector(${JSON.stringify(railRow(QB))}).style.getPropertyValue('--lane')`);
    expect(cb.by === `${sessP.name} · price agent b` && cb.byData === 'agent' && laneColor !== '' && cb.byColor === rgb(laneColor), `By reads session · agent in the session's colour (${JSON.stringify({ by: cb.by, byColor: cb.byColor, laneColor })})`);
    expect(cb.cost === costText(expectedPB) && !cb.notes.some((n) => n.startsWith('agents=')) && cb.notes.includes("agent=all of it the agent's own work, on pb-branch"), `the agent's commit is priced on its own share with the plain note (${JSON.stringify(cb)})`);
    await awayCard();
    // 8. The row cell: not drawn in the rail, drawn in a pane before the
    // age in --cost.
    const railCell = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(railRow(Q2))}); const c = r.querySelector('.commits-cost'); return { rowsWidth: Math.round(r.parentElement.getBoundingClientRect().width), cell: c ? c.getClientRects().length : null, text: c?.textContent ?? null }; })()`);
    expect(railCell.cell === 0 && railCell.text === costText(expectedP2), `the rail draws no dollars cell at ${railCell.rowsWidth}px (${JSON.stringify(railCell)})`);
    const priceTab = await getLayout(s);
    const paneId = 'm252-pane';
    await zreq(s, 'layout.set', { layout: { ...priceTab, root: { kind: 'split', id: 'm252-split', direction: 'row', ratio: 0.3, first: priceTab.root, second: { kind: 'pane', id: paneId, sessionId: null, view: { kind: 'commits', folder: priceRepo, rows: true, graph: { orientation: 'vertical' } } } } } });
    const paneRow = `.pane[data-pane-id=${JSON.stringify(paneId)}] .commits-graph-rows .commits-row[data-hash=${JSON.stringify(Q2)}]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(paneRow)} + ' .commits-cost')`, 'the pane draws the rows with a cell', 15000);
    const paneCell = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(paneRow)}); const c = r.querySelector('.commits-cost'); const age = r.querySelector('.commits-age'); const kids = [...r.children].map((k) => k.className); return { rowsWidth: Math.round(r.parentElement.getBoundingClientRect().width), shown: c.getClientRects().length, text: c.textContent, color: getComputedStyle(c).color, before: kids.indexOf('commits-cost') < kids.indexOf('commits-age') && kids.indexOf('commits-cost') > kids.indexOf('commits-subject'), font: getComputedStyle(c).fontFamily, p0: document.querySelector(${JSON.stringify(paneRow.replace(Q2, Q0))})?.querySelector('.commits-cost') ?? null }; })()`);
    expect(paneCell.shown === 1 && paneCell.text === costText(expectedP2) && paneCell.color === rgb(costToken) && paneCell.before, `the pane's row shows the cell after the subject and before the age in --cost at ${paneCell.rowsWidth}px (${JSON.stringify(paneCell)})`);
    expect(paneCell.p0 === null, "Q0's row has no cell and no placeholder");
    const mergeCellTitle = await s.evalJs(`document.querySelector(${JSON.stringify(paneRow.replace(Q2, QM))})?.querySelector('.commits-cost')?.getAttribute('title') ?? null`);
    expect(mergeCellTitle !== null && mergeCellTitle.endsWith(`; 1 agent ran here, priced on its own commit: ~${formatUsd(pbInMerge.usd)}`), `the merge's cell tooltip carries the elsewhere part (M9 fix 275; ${JSON.stringify(mergeCellTitle)})`);
    await s.screenshot('m9-fix252-rows.png');
    // The frame for What's New: the card on Q2 in the pane at its 300px.
    await settled(paneRow);
    const paneAt = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(paneRow + ' .commits-subject')}).getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; })()`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: paneAt.x, y: paneAt.y });
    await s.waitFor(`!!document.querySelector(${JSON.stringify(priceCardSel(Q2))}) && !document.querySelector(${JSON.stringify(priceCardSel(Q2))} + ' .commit-price[data-pending]')`, "the pane's row opens the card", 5000);
    const cardWidth = await s.evalJs(`document.querySelector(${JSON.stringify(priceCardSel(Q2))}).getBoundingClientRect().width`);
    expect(cardWidth === 300, `the card stays 300px wide with the block in it (${cardWidth})`);
    await s.screenshot('m9-fix252-card.png');
    await awayCard();
    await zreq(s, 'layout.set', { layout: { ...(await getLayout(s)), root: priceTab.root } });
    await s.waitFor(`!document.querySelector(${JSON.stringify(`.pane[data-pane-id=${JSON.stringify(paneId)}]`)})`, 'the pane is gone again', 5000);
    await awayCard();
    // M9 fix 287: the model word leads the state on the agent rows, off
    // the record's own model on the session's row and the last request
    // tagged with the agent's id (here pb's, still on the team since
    // Stop, M46) on a member's; the conversation's list is already in
    // from the cards above.
    const ownModelSel = `.files-rail .commits-graph-rows .commits-agent-row[data-session=${JSON.stringify(sessP.id)}]:not([data-member])`;
    const memberModelSel = `.files-rail .commits-graph-rows .commits-agent-row[data-session=${JSON.stringify(sessP.id)}][data-member="pb"]`;
    const modelWords = await s.evalJs(
      `(() => { const word = (sel) => document.querySelector(sel)?.querySelector('.commits-agent-model')?.textContent ?? null; return { own: word(${JSON.stringify(ownModelSel)}), member: word(${JSON.stringify(memberModelSel)}) }; })()`,
    );
    expect(modelWords.own === 'Opus' && modelWords.member === 'Opus', `the model word leads the state on the session's own row and a member's (${JSON.stringify(modelWords)})`);
    // The rail's own graph, since fix 145's commits view pane is still on
    // screen and comes first in the page (batch of fixes 542 to 568).
    await s.evalJs(`document.querySelector('.files-rail .commits-orient').click()`);
    await s.waitFor(`document.querySelector('.files-rail .commits-graph')?.dataset.orientation === 'horizontal'`, 'on its side for the label read');
    const ownLabelSel = `.files-rail .commits-label[data-agent][data-session=${JSON.stringify(sessP.id)}]:not([data-member])`;
    const memberLabelSel = `.files-rail .commits-label[data-agent][data-session=${JSON.stringify(sessP.id)}][data-member="pb"]`;
    const modelLabels = await s.evalJs(
      `(() => { const text = (sel) => document.querySelector(sel)?.textContent ?? null; return { own: text(${JSON.stringify(ownLabelSel)}), member: text(${JSON.stringify(memberLabelSel)}) }; })()`,
    );
    expect(modelLabels.own !== null && modelLabels.own.startsWith('Opus ') && modelLabels.member !== null && modelLabels.member.startsWith('Opus '), `the side label leads with the same word (${JSON.stringify(modelLabels)})`);
    await s.evalJs(`document.querySelector('.files-rail .commits-orient').click()`);
    await s.waitFor(`document.querySelector('.files-rail .commits-graph')?.dataset.orientation === 'vertical'`, 'upright again');
    await away();
    // 5. The transcript removed: Cost and Tokens read not known in the
    // muted tone, Agent time still a figure, and the note says so.
    fs.rmSync(transcriptPath);
    const c2gone = await hoverRow(Q2);
    expect(c2gone.costAbsent && c2gone.tokensAbsent && c2gone.cost === 'not known' && c2gone.tokens === 'not known' && c2gone.costColor === rgb(mutedToken), `with the transcript gone the cost and tokens read not known in --muted (${JSON.stringify(c2gone)})`);
    expect(c2gone.agentTime === c2.agentTime && c2gone.notes.includes("gone=the session's transcript for this stretch is gone; the time comes from the hooks"), `the time still comes from the hooks and the note says so (${JSON.stringify(c2gone)})`);
    await awayCard();
    step("M9 fix 252: a commit row's card prices the slice since the session's previous commit, its tokens as the row reads them, the agent time off the hooks and the agents' share as the note; the first commit reads since the session started, a commit made by hand has no price block, a merge prices the merge alone and names the branch's run, an agent's own commit is all the agent's, the pane's rows carry a dollars cell the rail never draws, and a gone transcript reads not known");

    // M9 fix 276: two commits made in the session's folder between one
    // PreToolUse and its PostToolUse, so recordHead's first-parent walk
    // credits both at one instant. The group is one slice from QM, priced
    // once: both cards carry the group note and one figure, and in a pane
    // the first row carries the figure and the second a dot whose tooltip
    // names the first. The transcript comes back with one own request in
    // the group's stretch so the slice has a price.
    const groupCommand = 'git commit -q -m QG1';
    await postP({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: groupCommand } });
    await sleep(300);
    fs.writeFileSync(path.join(priceRepo, 'QG1.txt'), 'QG1');
    gitP('add', 'QG1.txt');
    gitP('commit', '-q', '-m', 'QG1');
    const QG1 = gitP('rev-parse', 'HEAD').trim();
    fs.writeFileSync(path.join(priceRepo, 'QG2.txt'), 'QG2');
    gitP('add', 'QG2.txt');
    gitP('commit', '-q', '-m', 'QG2');
    const QG2 = gitP('rev-parse', 'HEAD').trim();
    await postP({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: groupCommand } });
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const x = r.sessions.find((x) => x.id === ${JSON.stringify(sessP.id)}); const g1 = x.commits.find((c) => c.hash === ${JSON.stringify(QG1)}); const g2 = x.commits.find((c) => c.hash === ${JSON.stringify(QG2)}); return g1 !== undefined && g2 !== undefined && g1.at === g2.at; })()`, 'the record credits both commits at one instant', 10000);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(railRow(QG2))}) && !!document.querySelector(${JSON.stringify(railRow(QG1))})`, 'both are rows on the rail', 15000);
    const recG = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === sessP.id);
    const groupAt = recG.commits.find((c) => c.hash === QG1).at;
    expect(recG.commits.findIndex((c) => c.hash === QG1) < recG.commits.findIndex((c) => c.hash === QG2), 'the walk lists QG1 before QG2');
    const groupOwn = [[groupAt - 200, usage(3, 0, 50000, 700)]];
    fs.writeFileSync(transcriptPath, [...ownMsgs, ...groupOwn].map(([at, u]) => line(at, u)).join('') + jl({ type: 'user', timestamp: iso(groupAt), message: { role: 'user', content: 'thanks' } }));
    const expectedG = sliceUsage([...all, ...groupOwn.map(([at, u]) => m(at, u))], claimOf(QM), groupAt);
    const groupNote = `group=credited with 1 other at ${clockOf(groupAt)}, priced together`;
    // The store holds null for the conversation since the transcript was
    // removed above, so the card's first paint is not pending; the figure
    // lands with the ask the open sends, which the read waits for.
    await hoverRow(QG1);
    await s.waitFor(`document.querySelector(${JSON.stringify(priceCardSel(QG1))} + ' [data-part="cost"] .sweep-card-text')?.textContent === ${JSON.stringify(costText(expectedG))}`, "QG1's figure is in", 5000);
    const cg1 = await readPriceCard(QG1);
    expect(cg1.slice === `since ${QM.slice(0, 7)}, ${clockOf(claimOf(QM))} to ${clockOf(groupAt)}` && cg1.cost === costText(expectedG), `QG1's slice runs from the merge and is priced (${JSON.stringify([cg1.slice, cg1.cost, costText(expectedG)])})`);
    expect(cg1.notes.includes(groupNote), `QG1's card carries the group note (${JSON.stringify(cg1.notes)})`);
    await awayCard();
    const cg2 = await hoverRow(QG2);
    expect(cg2.slice === cg1.slice && cg2.cost === cg1.cost && cg2.tokens === cg1.tokens && cg2.notes.includes(groupNote), `QG2's card is the same slice, the same figure and the same note (${JSON.stringify([cg2.slice, cg2.cost, cg2.tokens, cg2.notes])})`);
    await awayCard();
    const groupPane = 'm276-pane';
    const groupTab = await getLayout(s);
    await zreq(s, 'layout.set', { layout: { ...groupTab, root: { kind: 'split', id: 'm276-split', direction: 'row', ratio: 0.3, first: groupTab.root, second: { kind: 'pane', id: groupPane, sessionId: null, view: { kind: 'commits', folder: priceRepo, rows: true, graph: { orientation: 'vertical' } } } } } });
    const groupRow = (hash) => `.pane[data-pane-id=${JSON.stringify(groupPane)}] .commits-graph-rows .commits-row[data-hash=${JSON.stringify(hash)}]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(groupRow(QG1))} + ' .commits-cost') && !!document.querySelector(${JSON.stringify(groupRow(QG2))} + ' .commits-cost')`, 'the pane draws both rows with a cell', 15000);
    const groupCells = await s.evalJs(`(() => { const read = (sel) => { const c = document.querySelector(sel).querySelector('.commits-cost'); return { text: c.textContent.trim(), title: c.getAttribute('title'), group: c.dataset.group !== undefined, color: getComputedStyle(c).color }; }; return { g1: read(${JSON.stringify(groupRow(QG1))}), g2: read(${JSON.stringify(groupRow(QG2))}) }; })()`);
    expect(groupCells.g1.text === costText(expectedG) && !groupCells.g1.group && groupCells.g1.color === rgb(costToken), `the first of the group carries the figure in --cost (${JSON.stringify(groupCells.g1)})`);
    expect(groupCells.g2.text === '·' && groupCells.g2.group && groupCells.g2.color === rgb(mutedToken) && groupCells.g2.title === `credited with 1 other at ${clockOf(groupAt)}, priced on ${QG1.slice(0, 7)}`, `the second carries a muted dot whose tooltip names the first (${JSON.stringify(groupCells.g2)})`);
    await s.screenshot('m9-fix276-group.png');
    await zreq(s, 'layout.set', { layout: { ...(await getLayout(s)), root: groupTab.root } });
    await s.waitFor(`!document.querySelector(${JSON.stringify(`.pane[data-pane-id=${JSON.stringify(groupPane)}]`)})`, 'the pane is gone again', 5000);
    await awayCard();
    step("M9 fix 276: two commits credited at one instant are one slice from the commit before them, priced once, each card carrying the group note and the same figure, and in a pane the first row carries the figure and the second a muted dot naming the first");

    // M9 fix 253: the branch on the card, and the lean's tooltip. Q1 is on
    // the trunk: its card's Branch line reads main and its subject keeps
    // no tooltip. QB is on the worktree branch: the line reads the ref's
    // name while the ref lives; once the worktree and the branch are
    // deleted, as a batch deletes them after the merge, the name comes off
    // the merge's subject with `merged into main` after it, and the
    // leaning subject's tooltip says which branch and how far off main.
    const readBranch = (hash) =>
      s.evalJs(
        `(() => { const c = document.querySelector(${JSON.stringify(priceCardSel(hash))}); const row = document.querySelector(${JSON.stringify(railRow(hash))}); const line = c?.querySelector('[data-part="branch"] .sweep-card-text'); return { line: line?.textContent ?? null, merged: line?.querySelector('.sweep-card-absent')?.textContent ?? null, title: row?.querySelector('.commits-subject')?.getAttribute('title') ?? null, rowTitle: row?.getAttribute('title') ?? null, depth: row?.dataset.depth ?? null }; })()`,
      );
    await hoverRow(Q1);
    const b1 = await readBranch(Q1);
    expect(b1.line === 'main' && b1.title === null && b1.rowTitle === null && b1.depth === '0', `a trunk commit's card says main and its subject carries no tooltip (${JSON.stringify(b1)})`);
    await awayCard();
    await hoverRow(QB);
    const bLive = await readBranch(QB);
    expect(bLive.line === 'pb-branch' && bLive.merged === null && bLive.title === 'on pb-branch, one branch off main' && bLive.depth === '1', `a worktree branch's commit names the ref and leans with its tooltip (${JSON.stringify(bLive)})`);
    await awayCard();
    await removeWorktree(gitP, pbWt);
    gitP('branch', '-d', 'pb-branch');
    await s.waitFor(`!document.querySelector(${JSON.stringify(railRow(QB))} + ' .commits-pill') && !!document.querySelector(${JSON.stringify(railRow(QB))})`, 'the pill is gone from the rail with the ref', 15000);
    await hoverRow(QB);
    const bGone = await readBranch(QB);
    expect(bGone.line === 'pb-branch merged into main' && bGone.merged === ' merged into main' && bGone.title === 'on pb-branch, one branch off main' && bGone.depth === '1', `with the ref gone the name comes off the merge's subject, merged into main (${JSON.stringify(bGone)})`);
    await awayCard();
    step("M9 fix 253: the card's Branch line names the ref on a trunk commit and a branch commit, and off the merge's subject with merged into main once the ref is gone; the leaning subject's tooltip says which branch and how far off main, the trunk's none");
    // M9 fix 277: the row's and the card's dollar figure carry the forks'
    // spend since the main thread's last request. The transcript comes
    // back (fix 252's last read removed it) with its own messages, all in
    // the past; a third agent's file holds one request after the last own
    // message, so no status line has counted it. The status line's figure
    // lands on the row with the agent's estimate added and a ~ after it,
    // the card reads both parts and the agents' counts on a line of their
    // own; then an own message after the agent's and a status line, and
    // the bare figure is back.
    fs.writeFileSync(transcriptPath, ownMsgs.map(([at, u]) => line(at, u)).join('') + jl({ type: 'user', timestamp: iso(claimOf(QM)), message: { role: 'user', content: 'thanks' } }));
    agentCAt = Date.now();
    const agentC = [[agentCAt, usage(7, 0, 12000, 800)]];
    fs.writeFileSync(path.join(projectDir, CONV, 'subagents', 'agent-pc.jsonl'), agentC.map(([at, u]) => line(at, u, { isSidechain: true, agentId: 'pc' })).join(''));
    const runningC = sliceUsage(agentC.map(([at, u]) => m(at, u, 'pc')), -Infinity, Infinity);
    const statusP = (usd) => postP({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 14, context_window_size: 200000, total_input_tokens: 28000, current_usage: { input_tokens: 2, output_tokens: 1400, cache_creation_input_tokens: 3000, cache_read_input_tokens: 24000 } }, cost: { total_cost_usd: usd } });
    await statusP(9.78);
    // When the 30 s beat was last re-armed (the key changes with the
    // figure); the fix 322 read below must land before its next tick.
    const statusAt = Date.now();
    const rowCostSel = `.sidebar-row[data-session-id=${JSON.stringify(sessP.id)}] .sidebar-row-cost`;
    const readRowCost = () => s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(rowCostSel)}); return el === null ? null : { text: el.textContent, running: el.dataset.running ?? null, title: el.getAttribute('title') }; })()`);
    await s.waitFor(`document.querySelector(${JSON.stringify(rowCostSel)})?.dataset.running === 'true'`, "the row's figure carries the running part once the agent file is read", 10000);
    const rowRunning = await readRowCost();
    expect(rowRunning.text === `${formatUsd(9.78 + runningC.usd)} ~` && rowRunning.title !== null && rowRunning.title.startsWith(`$9.78 Claude Code's own figure + ~${formatUsd(runningC.usd)} by 1 agent running`), `the row reads the sum with a ~ and its tooltip names both parts (${JSON.stringify(rowRunning)})`);
    // M9 fix 293: the pane title bar's dollar figure carries the same
    // running part the row does, off the same computed figure, rather
    // than Claude Code's own bare cost.
    const paneCostSel = `.pane[data-pane-id=${JSON.stringify(priceLeaf.id)}] .pane-cost`;
    const readPaneCost = () => s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(paneCostSel)}); return el === null ? null : { text: el.textContent, title: el.getAttribute('title') }; })()`);
    const paneRunning = await readPaneCost();
    expect(paneRunning !== null && paneRunning.text === rowRunning.text && paneRunning.title === rowRunning.title, `the pane's title bar reads the row's running figure and tooltip (${JSON.stringify(paneRunning)} vs ${JSON.stringify(rowRunning)})`);
    // M9 fix 318: the shade shows no running line under its cost figure
    // (since fix 372's lid the spend block wears .pane-shade-figures and
    // data-figure="cost" on one element).
    // while the figure has a running part; the row's ~ and the card say
    // it. The title's shade button is in the DOM whatever the squeeze,
    // so a DOM click shades the pane and a second lifts it.
    const paneSelP = `.pane[data-pane-id=${JSON.stringify(priceLeaf.id)}]`;
    await s.evalJs(`document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade-toggle')}).click()`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade .pane-shade-figures[data-figure="cost"]')})`, 'the shade is up with its cost figure', 5000);
    const shadeRunning = await s.evalJs(`(() => { const p = document.querySelector(${JSON.stringify(paneSelP)}); return { running: p.querySelector('.pane-cost')?.dataset.running ?? null, cost: p.querySelector('.pane-shade-figures[data-figure="cost"] .pane-shade-figure')?.textContent ?? null, lines: p.querySelectorAll('.pane-shade-figures .pane-shade-tokens-line').length, runningLine: p.querySelector('.pane-shade-running') !== null }; })()`);
    expect(shadeRunning.running === 'true' && shadeRunning.cost === '$9.78' && !shadeRunning.runningLine, `the shade has no running line under the cost figure while the figure has a running part (${JSON.stringify(shadeRunning)})`);
    await s.evalJs(`document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade-toggle')}).click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade')})`, 'the shade is lifted again', 5000);
    await s.evalJs(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(sessP.id)}]`)})?.scrollIntoView({ block: 'center' }); document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(sessP.id)}] .sidebar-row-context`)}).click()`);
    cardSelP = `.context-popover[data-session-id=${JSON.stringify(sessP.id)}]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(cardSelP)}) && document.querySelector(${JSON.stringify(cardSelP)} + ' .context-popover-cost')?.dataset.running === 'true'`, 'the card opens with the running part', 5000);
    const cardRunning = await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(cardSelP)}); return { cost: c.querySelector('.context-popover-cost')?.textContent ?? null, tokens: c.querySelector('.context-popover-running-tokens')?.textContent ?? null, sent: c.querySelector('.context-popover-token-totals')?.textContent ?? null }; })()`);
    expect(cardRunning.cost !== null && cardRunning.cost.startsWith(`$9.78 + ~${formatUsd(runningC.usd)} running at API rates`), `the card's cost line reads both parts (${JSON.stringify(cardRunning)})`);
    // 7 fresh and 12000 read: 12k sent; 800 received.
    expect(cardRunning.tokens === '+ 12k sent, 800 received by 1 agent running', `the card's tokens block names the agent's counts (${JSON.stringify(cardRunning)})`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.context-popover')`, 'the card closed on Escape');
    await s.screenshot('m9-fix277-running.png');
    // M9 fix 322: with the shade up on a session with an agent out, the
    // forks' files are read every three seconds for that conversation,
    // so a request the agent's file gains lands on the row's figure
    // within a few seconds rather than at the 30 s beat. The member is
    // posted running for the read and stopped after it; the appended
    // request sits before the own message the next part writes, so the
    // bare figure comes back as it did.
    await s.evalJs(`document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade-toggle')}).click()`);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade .pane-shade-figures[data-figure="cost"]')})`, 'the shade is up again for the beat', 5000);
    await postP({ hook_event_name: 'SubagentStart', agent_id: 'pc', agent_type: 'fork' });
    await postP({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'price agent c', subagent_type: 'fork' }, tool_response: { agentId: 'pc', description: 'price agent c', status: 'async_launched' } });
    await s.waitFor(`document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade-member[data-member="pc"]')})?.dataset.working === 'true'`, 'the shade lists the agent out', 5000);
    const agentC2 = [...agentC, [agentCAt + 500, usage(9, 0, 30000, 1200)]];
    fs.appendFileSync(path.join(projectDir, CONV, 'subagents', 'agent-pc.jsonl'), line(agentCAt + 500, usage(9, 0, 30000, 1200), { isSidechain: true, agentId: 'pc' }));
    const runningC2 = sliceUsage(agentC2.map(([at, u]) => m(at, u, 'pc')), -Infinity, Infinity);
    const grewFrom = Date.now();
    await s.waitFor(`document.querySelector(${JSON.stringify(rowCostSel)})?.textContent === ${JSON.stringify(`${formatUsd(9.78 + runningC2.usd)} ~`)}`, "the row's figure grows with the agent's file under the shade's beat", 12000);
    const grewMs = Date.now() - grewFrom;
    const sinceStatus = Date.now() - statusAt;
    expect(grewMs <= 10000 && sinceStatus < 28000, `the figure grew in ${grewMs} ms, ${sinceStatus} ms after the status line, on the shade's 3 s beat and not the 30 s one`);
    await postP({ hook_event_name: 'SubagentStop', agent_id: 'pc', agent_type: 'fork' });
    await s.waitFor(`document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade-member[data-member="pc"]')})?.dataset.working === undefined`, 'the agent is back', 5000);
    await s.evalJs(`document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade-toggle')}).click()`);
    await s.waitFor(`!document.querySelector(${JSON.stringify(paneSelP + ' .pane-shade')})`, 'the shade is lifted after the beat', 5000);
    // The main thread moves: an own message after the agent's, and the
    // status line that follows covers the same requests.
    fs.appendFileSync(transcriptPath, line(agentCAt + 1500, usage(1, 0, 61000, 40)));
    await statusP(12);
    await s.waitFor(`document.querySelector(${JSON.stringify(rowCostSel)})?.textContent === '$12.00'`, 'the row reads the bare figure once the main thread has moved (fix 395: cents at every figure)', 10000);
    const rowBare = await readRowCost();
    expect(rowBare.running === null && rowBare.title === null, `no ~ and no tooltip on the bare figure (${JSON.stringify(rowBare)})`);
    const paneBare = await readPaneCost();
    expect(paneBare !== null && paneBare.text === rowBare.text && paneBare.title === null, `the pane's bare figure matches the row's once the running part drops (${JSON.stringify(paneBare)} vs ${JSON.stringify(rowBare)})`);
    step("M9 fix 277, 293 and 322: the row's dollars carry the forks' spend since the main thread's last request with a ~ after the sum, the pane's title bar reads the same figure and tooltip, the card reads both parts and the agents' counts, a shaded pane with an agent out reads the forks' files on a 3 s beat, and the bare figure is back on the row and the pane once an own request follows");
  });

  await block('fix-401', async () => {
    // M9 fix 401: the cards' usage ask follows the session while it works.
    // The rows key their one-shot ask on the records' commit counts and
    // span conversations (fix 352), and neither moves while a session
    // works, so a card opened on a working session asked once at its
    // mount and priced every later render on that answer. The card is
    // opened here with the last own request billed at the 5-minute TTL,
    // held quiet for a few seconds to read that it asks nothing by
    // itself, then a request billed at the 1-hour TTL is appended to the
    // transcript and a status line posted, which moves the record's
    // lastEventAt; the card's own-requests line reprices on its own ask,
    // with no commit anywhere and the rows' key unmoved. The cache write
    // is large so the two prices are a dollar apart rather than a cent
    // (docs/GOTCHAS.md, fixes 303 to 318, on a fixture on a knife edge).
    const liveStatsJs = `(() => ({ ...window.emeraldUsageStats }))()`;
    // The split the card is pricing on, in its own words
    // (.context-popover-cache-rate says "cache writes at the 5-minute
    // rate" or "at the 1-hour rate"), beside the cached dollars on the
    // own-requests line (.context-popover-own). The words are the read
    // this step turns on; the dollars are the same thing in money, and
    // they are not a number this step can name in advance, since
    // sumTokens adds every status line up, so what is read is the move.
    const liveRateSel = `${cardSelP} .context-popover-cache-rate`;
    const liveOwnSel = `${cardSelP} .context-popover-own`;
    const liveOwnJs = `(() => { const rate = document.querySelector(${JSON.stringify(liveRateSel)})?.textContent ?? null; const t = document.querySelector(${JSON.stringify(liveOwnSel)})?.textContent ?? null; const m = t === null ? null : /~\\$([\\d.]+) cached/.exec(t); return { rate, text: t, cached: m === null ? null : parseFloat(m[1]) }; })()`;
    // A status line with a big cache write first, so the sum the card
    // prices is large and the flip to the 1-hour rate moves it by a dollar
    // and not by a cent (docs/GOTCHAS.md, fixes 303 to 318, on a fixture on a
    // knife edge). The record's own dollars stay where the step before
    // left them.
    await postP({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, context_window: { used_percentage: 14, context_window_size: 200000, total_input_tokens: 28000, current_usage: { input_tokens: 2, output_tokens: 1400, cache_creation_input_tokens: 200000, cache_read_input_tokens: 24000 } }, cost: { total_cost_usd: 12 } });
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); return (r.sessions.find(x => x.id === ${JSON.stringify(sessP.id)})?.tokens?.cacheWrite ?? 0) >= 200000; })()`, "the record's token sum carries the big cache write", 10000);
    await s.evalJs(`document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(sessP.id)}]`)})?.scrollIntoView({ block: 'center' }); document.querySelector(${JSON.stringify(`.sidebar-row[data-session-id=${JSON.stringify(sessP.id)}] .sidebar-row-context`)}).click()`);
    await s.waitFor(`(() => { const r = document.querySelector(${JSON.stringify(liveRateSel)}); const o = document.querySelector(${JSON.stringify(liveOwnSel)}); return r !== null && o !== null && /5-minute/.test(r.textContent ?? '') && /~\\$[\\d.]+ cached/.test(o.textContent ?? ''); })()`, 'the card opens pricing cache writes at the 5-minute rate, with its own-requests line', 8000);
    const liveSent0 = await s.evalJs(liveOwnJs);
    const liveStats0 = await s.evalJs(liveStatsJs);
    await sleep(4000);
    const liveStats1 = await s.evalJs(liveStatsJs);
    expect(liveStats1.asks === liveStats0.asks, `a card open on a session nothing has happened to asks nothing over four seconds (${JSON.stringify([liveStats0, liveStats1])})`);
    // The 1-hour request, so the last own message in the transcript flips
    // the card's split, and a hook behind it to move lastEventAt. It has
    // to be a plain tool hook: a StatusLine says what the session runs and
    // not that Claude is busy, so it leaves lastEventAt alone by design
    // (state-machine.ts), and an agent hook returns through
    // reduceAgentHook before the stamp is set. `Read` names no git write,
    // so the fix 195 path claims no commit off it.
    fs.appendFileSync(transcriptPath, line(agentCAt + 2500, usage(1, 8000, 61000, 40, 8000)));
    await postP({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: path.join(priceRepo, 'P.txt') } });
    await s.waitFor(`/1-hour/.test(document.querySelector(${JSON.stringify(liveRateSel)})?.textContent ?? '')`, "the card moves to the 1-hour rate without a commit, on the record's own event", 15000);
    const liveSent1 = await s.evalJs(liveOwnJs);
    const liveStats2 = await s.evalJs(liveStatsJs);
    expect(/5-minute/.test(liveSent0.rate ?? '') && /1-hour/.test(liveSent1.rate ?? ''), `the card says it priced on the 5-minute split and now on the 1-hour one (${JSON.stringify([liveSent0.rate, liveSent1.rate])})`);
    expect(liveSent0.cached !== null && liveSent1.cached > liveSent0.cached, `and the cached figure moves up with it (${JSON.stringify([liveSent0, liveSent1])})`);
    expect(liveStats2.asks > liveStats1.asks && liveStats2.asks - liveStats1.asks <= 3, `the card asked again for its one conversation, not the rail for every conversation it names (${liveStats2.asks - liveStats1.asks} asks)`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.context-popover')`, 'the live ask card closed on Escape');
    step(`M9 fix 401: a card open on a quiet session asks nothing, and a request appended to the transcript with a hook behind it moves the card from the 5-minute split to the 1-hour one, $${liveSent0.cached} to $${liveSent1.cached} cached, with no commit and the rows' key unmoved`);
    fs.rmSync(transcriptPath);
    // The pane gets its session back and the focus goes where the step
    // found it, so the rail follows the focused pane's folder back to the
    // first repo; the steps after this one read that graph.
    await zreq(s, 'layout.set', { layout: { ...(await getLayout(s)), root: swapIn((await getLayout(s)).root, priceLeaf.sessionId), focusedPaneId: priceLayout.focusedPaneId } });
    fixDirs.push(pbWt, priceRepo);
    try {
      await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSelOf(DX1))})`, "the rail back on the first repo's graph", 15000);
    } catch (err) {
      console.log(`[verify] the rail after the price step: ${await s.evalJs(`JSON.stringify({ root: document.querySelector('.files-rail .commits-panel')?.dataset.root ?? null, hashes: [...document.querySelectorAll('.files-rail .commits-graph-rows .commits-row')].map((r) => r.dataset.hash.slice(0, 7)), focused: document.querySelector('.pane.focused')?.dataset.paneId ?? null })`)} (wanted ${DX1.slice(0, 7)}, focus was ${priceLayout.focusedPaneId})`);
      throw err;
    }
  });
  await block('fix-254', async () => {
    await settled(rowSelOf(DX1));
    // M9 fix 254: a dotted leader from every commit node to its row, the
    // agent marker's kind, under the lanes' lines and fainter than the
    // agent's; the hovered row's, or the one whose card is open, draws
    // at full strength. Read on the rail's upright graph, rows on.
    const leaderProbe = () =>
      s.evalJs(
        `(() => { const svg = document.querySelector('.files-rail .commits-graph'); const op = (el) => parseFloat(getComputedStyle(el).opacity); const nodes = [...svg.querySelectorAll('.commits-node[data-hash]')]; const leaders = [...svg.querySelectorAll('.commits-leader[data-hash]')]; const agent = svg.querySelector('.commits-leader[data-session]:not([data-hash])'); const firstEdge = svg.querySelector('.commits-edge'); const bad = leaders.filter((l) => { const n = svg.querySelector('.commits-node[data-hash=' + JSON.stringify(l.dataset.hash) + ']'); if (!n) return true; const cx = +n.getAttribute('cx'); const r = +n.getAttribute('r'); return Math.abs(+l.getAttribute('x1') - (cx + r)) > 0.01 || +l.getAttribute('y1') !== +n.getAttribute('cy') || +l.getAttribute('y2') !== +n.getAttribute('cy') || +l.getAttribute('x2') <= +l.getAttribute('x1'); }); return { nodes: nodes.length, leaders: leaders.length, missing: nodes.filter((n) => !svg.querySelector('.commits-leader[data-hash=' + JSON.stringify(n.dataset.hash) + ']')).length, bad: bad.length, ends: [...new Set(leaders.map((l) => l.getAttribute('x2')))], agentEnd: agent?.getAttribute('x2') ?? null, opacity: [...new Set(leaders.filter((l) => l.dataset.raised === undefined).map((l) => op(l)))], agentOpacity: agent ? op(agent) : null, agentDash: agent ? getComputedStyle(agent).strokeDasharray : null, dash: [...new Set(leaders.map((l) => getComputedStyle(l).strokeDasharray))], underEdges: firstEdge ? leaders.every((l) => l.compareDocumentPosition(firstEdge) & Node.DOCUMENT_POSITION_FOLLOWING) : null, raised: leaders.filter((l) => l.dataset.raised !== undefined).map((l) => ({ hash: l.dataset.hash, opacity: op(l) })) }; })()`,
      );
    const lead = await leaderProbe();
    expect(lead.nodes > 3 && lead.leaders === lead.nodes && lead.missing === 0, `one leader per commit node on the rail, by hash (${JSON.stringify(lead)})`);
    expect(lead.bad === 0 && lead.ends.length === 1 && (lead.agentEnd === null || lead.ends[0] === lead.agentEnd), `each runs from its node's right edge to the gutter's end, where the agent leader ends (${JSON.stringify(lead)})`);
    expect(lead.opacity.length === 1 && lead.opacity[0] < 0.35 && lead.agentOpacity !== null && lead.opacity[0] < lead.agentOpacity, `fainter than the agent leader (${JSON.stringify(lead)})`);
    expect(lead.dash.length === 1 && lead.dash[0] !== 'none' && lead.dash[0] === lead.agentDash && lead.underEdges === true, `dotted like the agent's and drawn under the lanes' lines (${JSON.stringify(lead)})`);
    expect(lead.raised.length === 0, `nothing raised with the pointer away (${JSON.stringify(lead.raised)})`);
    const dxRowSel = rowSelOf(DX1);
    await s.evalJs(`document.querySelector(${JSON.stringify(dxRowSel)})?.scrollIntoView({ block: 'nearest' })`);
    await settled(dxRowSel);
    const dxAt = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(dxRowSel + ' .commits-subject')}).getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; })()`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dxAt.x, y: dxAt.y });
    await s.waitFor(`document.querySelector(${JSON.stringify(dxRowSel)})?.dataset.hover !== undefined && document.querySelector('.files-rail .commits-leader[data-hash=' + JSON.stringify(${JSON.stringify(DX1)}) + '][data-raised]') !== null`, "the hovered row's node leader is raised", 3000);
    const raisedLead = await leaderProbe();
    expect(raisedLead.raised.length === 1 && raisedLead.raised[0].hash === DX1 && raisedLead.raised[0].opacity === 1, `the row's own leader alone, at full opacity (${JSON.stringify(raisedLead.raised)})`);
    await s.screenshot('m9-fix254-leaders.png');
    await away();
    await s.waitFor(`document.querySelector('.files-rail .commits-leader[data-raised]') === null`, 'the leader falls back once the pointer leaves', 3000);
    step("M9 fix 254: every commit node on the rail's upright graph has a dotted leader to its row, fainter than the agent's and under the lanes' lines, and the hovered row's draws at full strength");
  });
  await block('fix-255', async () => {
    // M9 fix 255: a folder that is no repository. A session started in a
    // scratch folder with no .git writes a file of its own and one through
    // a member; the rail's Commits tab, following the pane, draws the two
    // writes as nodes on the session's lanes (the member's on a lane of
    // its own), the path where the subject goes and a pen where the hash
    // goes, with the note line and its Initialise a repository button
    // above and the ledger under it: the session's name in its colour,
    // the cost off its status line, the tokens, the state and the count
    // of writes. The row's card reads the path, the time and who wrote
    // it. Then the button runs git init and the panel turns into the
    // commit graph, with no commits yet.
    const noRepoShort = path.join(os.tmpdir(), 'emerald-verify', `m51-norepo-${process.pid}`);
    fs.rmSync(noRepoShort, { recursive: true, force: true });
    fs.mkdirSync(path.join(noRepoShort, 'src'), { recursive: true });
    noRepo = fs.realpathSync.native(noRepoShort);
    fixDirs.push(noRepo);
    bare = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: noRepo, cols: 80, rows: 24 })).session;
    await post(bare.id, { cwd: noRepo, hook_event_name: 'SessionStart', source: 'startup' });
    await post(bare.id, { cwd: noRepo, hook_event_name: 'UserPromptSubmit', prompt: 'write the notes' });
    await post(bare.id, {
      cwd: noRepo,
      hook_event_name: 'StatusLine',
      model: { id: 'claude-opus-5', display_name: 'Opus 5' },
      context_window: { used_percentage: 12, context_window_size: 200000, total_input_tokens: 24000, current_usage: { input_tokens: 2, output_tokens: 1200, cache_creation_input_tokens: 3000, cache_read_input_tokens: 20000 } },
      cost: { total_cost_usd: 0.42 },
    });
    const ownFile = path.join(noRepo, 'notes.md');
    const memberFile = path.join(noRepo, 'src', 'a.ts');
    fs.writeFileSync(ownFile, '# notes\n');
    fs.writeFileSync(memberFile, 'export {};\n');
    await post(bare.id, { cwd: noRepo, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: ownFile, content: '# notes' }, tool_response: {} });
    await post(bare.id, { cwd: noRepo, hook_event_name: 'SubagentStart', agent_id: 'wr1', agent_type: 'fork' });
    await post(bare.id, { cwd: noRepo, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'the writer', subagent_type: 'fork' }, tool_response: { agentId: 'wr1', description: 'the writer', status: 'async_launched' } });
    await sleep(1100);
    await post(bare.id, { cwd: noRepo, agent_id: 'wr1', hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: memberFile, old_string: 'export {};', new_string: 'export const a = 1;' }, tool_response: {} });
    await s.waitFor(`(async () => { const r = await window.emerald.request('session.list', {}); const x = r.sessions.find((y) => y.id === ${JSON.stringify(bare.id)}); return (x?.touched ?? []).length === 2 && typeof x?.costUsd === 'number'; })()`, 'the daemon kept both writes and the cost', 8000);
    const bareNow = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === bare.id);
    await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(bare.id)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
    const norepoPanel = '.files-rail .commits-panel';
    await s.waitFor(`document.querySelector(${JSON.stringify(norepoPanel)})?.dataset.folder === ${JSON.stringify(noRepo)} && document.querySelector(${JSON.stringify(norepoPanel)})?.dataset.graph === 'none' && document.querySelectorAll(${JSON.stringify(norepoPanel)} + ' .commits-node').length === 2`, 'the rail follows to the bare folder and draws two write nodes', 10000);
    const writeProbe = () =>
      s.evalJs(
        `(() => { const p = document.querySelector(${JSON.stringify(norepoPanel)}); const nodes = [...p.querySelectorAll('.commits-node')].map((n) => ({ hash: n.dataset.hash, lane: n.dataset.lane, session: n.dataset.session ?? null, member: n.dataset.member ?? null, title: n.querySelector('title')?.textContent ?? null })); const rows = [...p.querySelectorAll('.commits-graph-rows .commits-row')].map((r) => ({ hash: r.dataset.hash, write: 'write' in r.dataset, path: r.dataset.path ?? null, owner: r.dataset.owner, member: r.dataset.member ?? null, hashText: r.querySelector('.commits-hash')?.textContent ?? null, subject: r.querySelector('.commits-subject')?.textContent ?? null, agent: r.classList.contains('commits-agent-row') })); const ledger = [...p.querySelectorAll('.commits-ledger-row')].map((r) => ({ session: r.dataset.session, tone: r.dataset.tone, name: r.querySelector('.commits-ledger-name')?.textContent ?? null, nameColor: getComputedStyle(r.querySelector('.commits-ledger-name')).color, cost: r.querySelector('.commits-ledger-cost')?.textContent ?? null, costColor: r.querySelector('.commits-ledger-cost') ? getComputedStyle(r.querySelector('.commits-ledger-cost')).color : null, tokens: r.querySelector('.commits-ledger-tokens')?.textContent ?? null, state: r.querySelector('.commits-ledger-state')?.textContent ?? null, writes: r.querySelector('.commits-ledger-writes')?.textContent ?? null })); const note = p.querySelector('.commits-norepo'); const branchLine = p.querySelector('.commits-branch'); return { graph: p.dataset.graph, note: note?.querySelector('.commits-norepo-note')?.textContent ?? null, button: note?.querySelector('.commits-init')?.textContent.trim() ?? null, noteTop: note ? Math.round(note.getBoundingClientRect().top) : null, ledgerTop: p.querySelector('.commits-ledger') ? Math.round(p.querySelector('.commits-ledger').getBoundingClientRect().top) : null, toolsTop: p.querySelector('.commits-tools') ? Math.round(p.querySelector('.commits-tools').getBoundingClientRect().top) : null, branchLine: branchLine !== null, empty: p.querySelector('.files-empty')?.textContent ?? null, nodes, rows, ledger, lanes: p.dataset.lanes, blocks: p.dataset.blocks, costToken: getComputedStyle(document.documentElement).getPropertyValue('--cost').trim() }; })()`,
      );
    let wp = await writeProbe();
    expect(wp.graph === 'none' && wp.note === 'Not a git repository' && wp.button === 'Initialise a repository' && !wp.branchLine && wp.empty === null, `the note line with the button where the branch line sits, no branch line, no empty message (${JSON.stringify([wp.graph, wp.note, wp.button, wp.branchLine, wp.empty])})`);
    expect(wp.noteTop !== null && wp.ledgerTop !== null && wp.toolsTop !== null && wp.noteTop < wp.ledgerTop && wp.ledgerTop < wp.toolsTop, `the note, then the ledger, then the tools row (${JSON.stringify([wp.noteTop, wp.ledgerTop, wp.toolsTop])})`);
    const ownHash = `write:${bare.id}:0`;
    const memberHash = `write:${bare.id}:1`;
    const ownNode = wp.nodes.find((n) => n.hash === ownHash);
    const memberNode = wp.nodes.find((n) => n.hash === memberHash);
    expect(wp.nodes.length === 2 && ownNode !== undefined && memberNode !== undefined && ownNode.session === bare.id && memberNode.session === bare.id && ownNode.member === null && memberNode.member === 'wr1' && ownNode.lane !== memberNode.lane, `two write nodes of the session's, the member's on a lane of its own (${JSON.stringify(wp.nodes)})`);
    expect(ownNode.title === 'notes.md' && memberNode.title === 'src/a.ts', `the node titles are the paths relative to the folder, no hash (${JSON.stringify([ownNode.title, memberNode.title])})`);
    expect(wp.lanes === '2' && wp.blocks === '1', `one block of two lanes (${JSON.stringify([wp.lanes, wp.blocks])})`);
    const writeRows = wp.rows.filter((r) => !r.agent);
    const ownWriteRow = writeRows.find((r) => r.hash === ownHash);
    const memberWriteRow = writeRows.find((r) => r.hash === memberHash);
    expect(writeRows.length === 2 && ownWriteRow !== undefined && memberWriteRow !== undefined && ownWriteRow.write && memberWriteRow.write && ownWriteRow.path === ownFile && memberWriteRow.path === memberFile, `two write rows carrying their paths (${JSON.stringify(writeRows)})`);
    expect(ownWriteRow.subject === 'notes.md' && memberWriteRow.subject === 'src/a.ts' && ownWriteRow.hashText === '✎' && memberWriteRow.hashText === '✎' && memberWriteRow.member === 'wr1' && ownWriteRow.owner === bare.id, `the path where the subject goes and a pen where the hash goes, the member named on its row (${JSON.stringify([ownWriteRow, memberWriteRow])})`);
    expect(wp.rows.findIndex((r) => r.hash === memberHash) < wp.rows.findIndex((r) => r.hash === ownHash), `the member's later write is the newer row (${wp.rows.map((r) => r.hash ?? 'agent').join(',')})`);
    expect(wp.rows.filter((r) => r.agent).length === 2, `the session's own row and the member's row are on the graph (${wp.rows.filter((r) => r.agent).length})`);
    const led = wp.ledger[0];
    expect(wp.ledger.length === 1 && led.session === bare.id && led.name === bareNow.name && led.nameColor === rgb(bareNow.color), `one ledger line, the session's name in its colour (${JSON.stringify(wp.ledger)})`);
    expect(led.cost === '$0.42' && led.costColor === rgb(wp.costToken), `the cost off the status line in --cost (${JSON.stringify([led.cost, led.costColor, wp.costToken])})`);
    expect(led.tokens !== null && led.tokens.startsWith('↑') && led.tokens.includes('cached') && led.tokens.includes('↓1.2k'), `the tokens line with the cached share (${JSON.stringify(led.tokens)})`);
    expect(led.state !== null && led.state.startsWith('working') && /\d+s$/.test(led.state) && led.tone === 'working', `the state word and its age (${JSON.stringify([led.state, led.tone])})`);
    expect(led.writes === '2 writes', `the writes drawn (${JSON.stringify(led.writes)})`);
    // The row's card: the path, the time and who wrote it.
    const memberRowSel = `${norepoPanel} .commits-graph-rows .commits-row[data-hash=${JSON.stringify(memberHash)}]`;
    // Two tries, the fix 175 pattern hoverForAction uses: the rows move
    // under a pointer placed a moment before when the strip above grows,
    // and this one hover failed twice in a row on a loaded box (M9 fix
    // 320's runs) with nothing wrong under it.
    for (let attempt = 0; ; attempt += 1) {
      await settled(memberRowSel);
      await hoverOver(memberRowSel);
      try {
        await s.waitFor(`!!document.querySelector('.write-popover')`, "the write row opens its card", 3000);
        break;
      } catch (err) {
        if (attempt === 1) throw err;
        console.log('[verify] note: the write row hover opened nothing the first time; trying again');
        await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
        await sleep(500);
      }
    }
    const writeCard = await s.evalJs(`(() => { const c = document.querySelector('.write-popover'); const line = (part) => c.querySelector('.sweep-card-line[data-part="' + part + '"] .sweep-card-text')?.textContent ?? null; return { hash: c.dataset.hash, path: c.dataset.path, heading: c.querySelector('.sweep-card-heading')?.textContent ?? null, file: line('path'), at: line('at'), by: line('by') }; })()`);
    expect(writeCard.hash === memberHash && writeCard.path === memberFile && writeCard.heading === 'src/a.ts' && writeCard.file === memberFile, `the card names the file (${JSON.stringify(writeCard)})`);
    expect(writeCard.at !== null && /, \d+s ago$/.test(writeCard.at) && writeCard.by === `${bareNow.name} · subagent · fork · the writer`, `the time and who wrote it, the session, its member's role and type (M9 fix 373) and the member (${JSON.stringify([writeCard.at, writeCard.by])})`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector('.write-popover')`, 'the card closes');
    await s.screenshot('m9-fix255-writes.png');
    // The lane card's action list is unchanged: the session's lane opens
    // the same card as anywhere.
    await hoverForAction(`${norepoPanel} .commits-node[data-hash=${JSON.stringify(ownHash)}]`, 'solo', "the write node opens the session's lane card");
    await away();
    step("M9 fix 255: in a folder with no repository the Commits tab draws the session's writes as nodes, the member's on its own lane, the path as the subject and a pen for the hash, the note and its button above the ledger with the name, the cost, the tokens, the state and the count, and a row's card names the file, the time and the writer");

    // Initialise a repository: git init runs in the folder, the watch
    // takes it and the panel is the commit graph with no commits yet; the
    // session's first commit then shows through the watch.
    await s.evalJs(`document.querySelector(${JSON.stringify(`${norepoPanel} .commits-init`)}).click()`);
    await s.waitFor(`document.querySelector(${JSON.stringify(norepoPanel)})?.dataset.graph === 'ready' && document.querySelector(${JSON.stringify(norepoPanel)} + ' .files-empty')?.textContent === 'No commits yet'`, 'the panel turns into the commit graph with no commits yet', 10000);
    expect(fs.existsSync(path.join(noRepo, '.git')), 'git init made the repository');
    const afterInit = await s.evalJs(`(() => { const p = document.querySelector(${JSON.stringify(norepoPanel)}); return { note: p.querySelector('.commits-norepo') !== null, ledger: p.querySelector('.commits-ledger') !== null, nodes: p.querySelectorAll('.commits-node').length, branch: p.querySelector('.commits-branch-name')?.textContent ?? null }; })()`);
    expect(!afterInit.note && !afterInit.ledger && afterInit.nodes === 0, `the note, the ledger and the write nodes are gone (${JSON.stringify(afterInit)})`);
    const bareGit = gitIn(noRepo);
    bareGit('config', 'user.name', 'verify');
    bareGit('config', 'user.email', 'verify@example.invalid');
    bareGit('config', 'commit.gpgsign', 'false');
    const N1 = await commitVia(bare.id, bareGit, 'N1', noRepo);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(`${norepoPanel} .commits-node[data-hash=${JSON.stringify(N1)}]`)})`, 'the first commit shows on the graph through the watch', 10000);
    const firstCommit = await s.evalJs(`(() => { const p = document.querySelector(${JSON.stringify(norepoPanel)}); const n = p.querySelector('.commits-node[data-hash=${JSON.stringify(N1)}]'); return { session: n?.dataset.session ?? null, branch: p.querySelector('.commits-branch-name')?.textContent ?? null, rows: p.querySelectorAll('.commits-graph-rows .commits-row[data-hash]').length }; })()`);
    expect(firstCommit.session === bare.id && firstCommit.rows === 1 && firstCommit.branch !== null, `the commit is the session's, on the branch line's branch (${JSON.stringify(firstCommit)})`);
    step('M9 fix 255: Initialise a repository runs git init, the panel turns into the commit graph with no commits yet, and the first commit shows through the new watch');

    // M9 fix 286: every branch on the graph, and a person mark for the
    // humans. On the fix 255 repository (user.name verify, N1 the
    // session's): a bare remote with a branch pushed there and deleted
    // locally, so RF lives only on origin/feature; then two of Ada's on
    // main, one plain and one with a Claude-Session trailer. No hook is
    // posted after these, so the daemon credits none of them (the fix 131
    // gotcha: a PostToolUse would hand the walk to the session).
    const remoteDir = path.join(os.tmpdir(), 'emerald-verify', `m51-remote-${process.pid}`);
    fs.rmSync(remoteDir, { recursive: true, force: true });
    bareGit('init', '-q', '--bare', remoteDir);
    bareGit('remote', 'add', 'origin', remoteDir);
    // The app's git init took the box's default branch name, whatever it is.
    const trunk286 = bareGit('rev-parse', '--abbrev-ref', 'HEAD').trim();
    bareGit('checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(noRepo, 'RF.txt'), 'RF');
    bareGit('add', 'RF.txt');
    bareGit('commit', '-q', '-m', 'RF');
    const RF = bareGit('rev-parse', 'HEAD').trim();
    bareGit('push', '-q', 'origin', 'feature');
    bareGit('checkout', '-q', trunk286);
    bareGit('branch', '-q', '-D', 'feature');
    bareGit('fetch', '-q', 'origin');
    const adaGit = (...args) => bareGit('-c', 'user.name=Ada', '-c', 'user.email=ada@example.invalid', ...args);
    fs.writeFileSync(path.join(noRepo, 'PA.txt'), 'PA');
    adaGit('add', 'PA.txt');
    adaGit('commit', '-q', '-m', 'PA');
    const PA = bareGit('rev-parse', 'HEAD').trim();
    fs.writeFileSync(path.join(noRepo, 'PB.txt'), 'PB');
    adaGit('add', 'PB.txt');
    adaGit('commit', '-q', '-m', 'PB\n\nClaude-Session: https://claude.ai/code/session_ada286');
    const PB = bareGit('rev-parse', 'HEAD').trim();
    const peopleSel = (h) => `${norepoPanel} .commits-node[data-hash=${JSON.stringify(h)}]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(peopleSel(PB))})`, "Ada's commits show through the watch", 10000);
    const peopleProbe = () =>
      s.evalJs(
        `(() => { const p = document.querySelector(${JSON.stringify(norepoPanel)}); const node = (h) => p.querySelector('.commits-node[data-hash=' + JSON.stringify(h) + ']'); const mark = (h) => p.querySelector('.commits-person-node[data-hash=' + JSON.stringify(h) + ']'); const row = (h) => p.querySelector('.commits-row[data-hash=' + JSON.stringify(h) + ']'); const one = (h) => { const n = node(h); const m = mark(h); const r = row(h); return n === null ? null : { session: n.dataset.session ?? null, person: n.dataset.person ?? null, remote: n.dataset.remote ?? null, outside: 'outside' in n.dataset, gone: 'gone' in n.dataset, lane: n.style.getPropertyValue('--lane'), mark: m === null ? null : { kind: m.dataset.kind, person: m.dataset.person, glyph: !!m.querySelector('.person-glyph'), star: !!m.querySelector('.session-mark'), color: getComputedStyle(m.querySelector('.commits-agent-mark')).color, bg: getComputedStyle(m.querySelector('.commits-agent-mark')).backgroundColor }, row: r === null ? null : { owner: r.dataset.owner, person: r.dataset.person ?? null, remote: r.dataset.remote ?? null, pills: [...r.querySelectorAll('.commits-pill')].map((x) => x.dataset.branch + ('remote' in x.dataset ? '~' : '')).join(',') } }; }; return { remotes: p.dataset.remotes, chip: p.querySelector('.commits-remotes')?.dataset.remotes ?? null, blocks: +p.dataset.blocks, groups: [...p.querySelectorAll('.commits-lane-group')].map((g) => (g.dataset.person ? 'person:' + g.dataset.person : g.dataset.remote ? 'remote:' + g.dataset.remote : 'outside' in g.dataset ? 'outside' : 'session')).sort().join(','), N1: one(${JSON.stringify(N1)}), PA: one(${JSON.stringify(PA)}), PB: one(${JSON.stringify(PB)}), RF: one(${JSON.stringify(RF)}) }; })()`,
      );
    const before286 = await peopleProbe();
    expect(before286.remotes === 'off' && before286.chip === 'off', `the remotes chip is there and off (${JSON.stringify([before286.remotes, before286.chip])})`);
    expect(before286.RF === null, 'the branch only on the remote is not on the graph while the chip is off');
    expect(before286.PA !== null && before286.PA.person === 'Ada' && before286.PA.session === 'person:Ada' && before286.PA.gone && !before286.PA.outside, `PA is on Ada's block, gone (${JSON.stringify(before286.PA)})`);
    expect(before286.PB !== null && before286.PB.person === 'Ada' && before286.PB.session === before286.PA.session, `the trailer commit stays in Ada's block (${JSON.stringify(before286.PB)})`);
    expect(before286.N1 !== null && before286.N1.person === null && before286.N1.session === bare.id, `the session's own commit stays the session's (${JSON.stringify(before286.N1)})`);
    expect(before286.PA.mark !== null && before286.PA.mark.kind === 'person' && before286.PA.mark.glyph && !before286.PA.mark.star, `PA's node wears the person glyph (${JSON.stringify(before286.PA.mark)})`);
    expect(before286.PB.mark !== null && before286.PB.mark.kind === 'claude' && before286.PB.mark.star && !before286.PB.mark.glyph, `PB's node wears the session mark, since its trailer says an agent made it (${JSON.stringify(before286.PB.mark)})`);
    expect(before286.PA.lane !== '' && before286.PA.mark.color !== '' && before286.PA.mark.bg !== 'rgba(0, 0, 0, 0)', `the glyph is in the block's colour on a clip box of the panel ground (${JSON.stringify([before286.PA.lane, before286.PA.mark.color, before286.PA.mark.bg])})`);
    expect(before286.PA.row !== null && before286.PA.row.owner === 'person:Ada' && before286.PA.row.person === 'Ada', `the row is Ada's (${JSON.stringify(before286.PA.row)})`);
    // The row's commit card says who (M73 task 4 put the tooltip there).
    const rowCard286 = async (hash, what) => {
      const rowSel = `${norepoPanel} .commits-row[data-hash=${JSON.stringify(hash)}]`;
      await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)})?.scrollIntoView({ block: 'nearest' })`);
      await settled(rowSel);
      const at = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel + ' .commits-subject')}).getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; })()`);
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
      const cardSel286 = `.commit-popover[data-hash=${JSON.stringify(hash)}]`;
      await s.waitFor(`!!document.querySelector(${JSON.stringify(cardSel286)})`, what, 3000);
      const by = await s.evalJs(`document.querySelector(${JSON.stringify(cardSel286)}).querySelector('[data-part="by"] .sweep-card-text')?.textContent ?? null`);
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
      await s.waitFor(`!document.querySelector(${JSON.stringify(cardSel286)})`, 'the commit card closes');
      return by;
    };
    const paBy = await rowCard286(PA, "Ada's row opens its commit card");
    expect(paBy === "Ada, by the commit's author", `the card says who made it, by the author (${JSON.stringify(paBy)})`);
    expect(before286.groups.includes('person:Ada') && !before286.groups.includes('remote:'), `Ada's lane group is there and no remote one (${before286.groups})`);
    // Ada's card, off her node.
    await settled(peopleSel(PA));
    await hoverOver(peopleSel(PA));
    await s.waitFor(`!!document.querySelector('.person-popover[data-person="Ada"]')`, "Ada's card opens on her node", 3000);
    const adaCard = await s.evalJs(`(() => { const c = document.querySelector('.person-popover'); return { name: c.querySelector('.lane-card-name')?.textContent ?? null, line: c.querySelector('.lane-card-commits')?.textContent ?? null, trailer: c.dataset.trailer, actions: [...c.querySelectorAll('.lane-card-action')].map((a) => a.dataset.action).join(',') }; })()`);
    expect(adaCard.name === 'Ada' && adaCard.line === '2 commits here by Ada, 1 with a Claude-Session trailer' && adaCard.trailer === '1', `the card names her and counts the trailer (${JSON.stringify(adaCard)})`);
    await away();
    // The chip on: the read carries the remote branches, RF lands on a
    // grey remote block with the branch's pill dashed on it, and the
    // card says how old the fetch is.
    await s.evalJs(`document.querySelector(${JSON.stringify(`${norepoPanel} .commits-remotes`)}).click()`);
    await s.waitFor(`document.querySelector(${JSON.stringify(norepoPanel)})?.dataset.remotes === 'on' && !!document.querySelector(${JSON.stringify(peopleSel(RF))})`, 'the chip turns on and the remote branch lands on the graph', 10000);
    const with286 = await peopleProbe();
    expect(with286.RF !== null && with286.RF.remote === 'origin/feature' && with286.RF.session === 'remote:origin/feature' && with286.RF.person === null && !with286.RF.outside && with286.RF.lane === '', `RF is on the grey remote block (${JSON.stringify(with286.RF)})`);
    expect(with286.RF.row !== null && with286.RF.row.remote === 'origin/feature' && with286.RF.row.pills === 'origin/feature~', `its row carries the dashed remote pill (${JSON.stringify(with286.RF.row)})`);
    const rfBy = await rowCard286(RF, "the remote commit's row opens its card");
    expect(rfBy === 'only on origin/feature, as of the last fetch', `the card says the commit is only on the remote (${JSON.stringify(rfBy)})`);
    expect(with286.PB !== null && with286.PB.person === 'Ada' && with286.PB.row.pills === trunk286, `Ada's tip keeps the local pill alone: the trunk was never pushed, so no remote pill joins it (${JSON.stringify(with286.PB.row)})`);
    expect(with286.groups.includes('remote:origin/feature') && with286.groups.includes('person:Ada'), `the remote lane group is there beside Ada's (${with286.groups})`);
    const f1Fill = await s.evalJs(`getComputedStyle(document.querySelector(${JSON.stringify(peopleSel(RF))})).fill`);
    expect(f1Fill === 'rgb(110, 110, 110)', `the remote node is the outside grey (${f1Fill})`);
    await settled(peopleSel(RF));
    await hoverOver(peopleSel(RF));
    await s.waitFor(`!!document.querySelector('.remote-popover[data-remote="origin/feature"]')`, "the remote block's card opens", 3000);
    const remoteCard = await s.evalJs(`(() => { const c = document.querySelector('.remote-popover'); return { name: c.querySelector('.lane-card-name')?.textContent ?? null, line: c.querySelector('.lane-card-commits')?.textContent ?? null, fetched: c.querySelector('.outside-card-fetched')?.textContent ?? null }; })()`);
    expect(remoteCard.name === 'origin/feature' && remoteCard.line === '1 commit only on origin/feature', `the card names the branch and the count (${JSON.stringify(remoteCard)})`);
    expect(remoteCard.fetched !== null && /^fetched \d+(s|m) ago$/.test(remoteCard.fetched), `the card says how old the fetch is (${JSON.stringify(remoteCard.fetched)})`);
    await away();
    await s.screenshot('m9-fix286-people.png');
    // The chip off again: the log is as before.
    await s.evalJs(`document.querySelector(${JSON.stringify(`${norepoPanel} .commits-remotes`)}).click()`);
    await s.waitFor(`document.querySelector(${JSON.stringify(norepoPanel)})?.dataset.remotes === 'off' && !document.querySelector(${JSON.stringify(peopleSel(RF))})`, 'the chip turns off and the remote branch leaves the graph', 10000);
    const after286 = await peopleProbe();
    expect(after286.PA !== null && after286.PA.person === 'Ada' && after286.RF === null && after286.groups === before286.groups, `the picture is the one before the chip (${JSON.stringify([after286.groups, before286.groups])})`);
    step("M9 fix 286: a person's commits draw on a block of their own with the person glyph on each node (the session mark on one with a trailer) and a card naming them; the remotes chip puts a branch only on the remote onto the graph as a grey block with a dashed pill and a card saying how old the fetch is, and takes it off again");
  });

  await block('fix-303', async () => {
    // M9 fix 303 and 304: the committer's age on the rows and a
    // cherry-picked twin marked. A repository of the step's own: T0 on
    // main, T1 on `first` two hours ago, then T1 cherry-picked onto
    // `second` and onto main with GIT_COMMITTER_DATE an hour ahead of the
    // author date (a pick keeps the author's date whatever the
    // environment says, so the picks are the twins of T1 with the
    // original's author time and a committer time of their own; the two
    // picks a minute apart, since two picks of one commit onto one parent
    // with one committer date are one object). Made by hand, no hooks, so
    // nobody claims them. The rows read the committer's age (1h on the
    // picks, not 2h), the original's pill ×3 and the picks' `picked`,
    // data-twins on each, the pick's card the `authored ..., picked ...`
    // line and the twin lines with their branches, and a hover on a pick
    // lights the other two rows.
    const twinShort = path.join(os.tmpdir(), 'emerald-verify', `m51-twins-${process.pid}`);
    fs.rmSync(twinShort, { recursive: true, force: true });
    fs.mkdirSync(twinShort, { recursive: true });
    const twinRepo = fs.realpathSync.native(twinShort);
    fixDirs.push(twinRepo);
    const nowSec = Math.floor(Date.now() / 1000);
    // The original and the picks sit a minute and two past their hours
    // rather than on them: the renderer's clock ticks a little behind the
    // script's, and a pick at exactly 3600 s read `59m` once at a
    // close-out, the original at exactly 7200 s `1h` once on a quiet box
    // (M9 fix 319's proof run).
    const authorSec = nowSec - 7200 - 60;
    const pickSec = nowSec - 3600 - 60;
    const gitT = (authorAt, committerAt) => (...args) => execFileSync('git', args, { cwd: twinRepo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_DATE: `${authorAt} +0000`, GIT_COMMITTER_DATE: `${committerAt} +0000` } }).toString();
    const gitT0 = gitT(authorSec - 60, authorSec - 60);
    gitT0('init', '-q', '-b', 'main');
    gitT0('config', 'user.name', 'verify');
    gitT0('config', 'user.email', 'verify@example.invalid');
    gitT0('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(twinRepo, 'T0.txt'), 'T0');
    gitT0('add', 'T0.txt');
    gitT0('commit', '-q', '-m', 'T0');
    const T0 = gitT0('rev-parse', 'HEAD').trim();
    gitT0('checkout', '-q', '-b', 'first');
    const gitT1 = gitT(authorSec, authorSec);
    fs.writeFileSync(path.join(twinRepo, 'T1.txt'), 'T1');
    gitT1('add', 'T1.txt');
    gitT1('commit', '-q', '-m', 'T1');
    const T1 = gitT1('rev-parse', 'HEAD').trim();
    gitT0('checkout', '-q', '-b', 'second', T0);
    gitT(authorSec, pickSec - 60)('cherry-pick', T1);
    const T1b = gitT0('rev-parse', 'HEAD').trim();
    gitT0('checkout', '-q', 'main');
    gitT(authorSec, pickSec)('cherry-pick', T1);
    const T1c = gitT0('rev-parse', 'HEAD').trim();
    expect(T1b !== T1c && T1b !== T1, `three distinct copies (${[T1, T1b, T1c].map((h) => h.slice(0, 7)).join(', ')})`);
    const twinSess = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: twinRepo, cols: 80, rows: 24 })).session;
    await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(twinSess.id)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.folder === ${JSON.stringify(twinRepo)} && !!document.querySelector(${JSON.stringify(railRow(T1c))}) && !!document.querySelector(${JSON.stringify(railRow(T1))})`, 'the rail follows to the twins repository and draws the picks', 15000);
    await s.waitFor(`!!document.querySelector(${JSON.stringify(railRow(T1))} + ' .commits-twin')`, "the original's row wears its twin pill once the patch ids are in", 10000);
    const twinProbe = () =>
      s.evalJs(
        `(() => { const one = (h) => { const r = document.querySelector('.files-rail .commits-graph-rows .commits-row[data-hash=' + JSON.stringify(h) + ']'); if (!r) return null; const pill = r.querySelector('.commits-twin'); return { age: r.querySelector('.commits-age')?.textContent ?? null, pill: pill?.textContent ?? null, kind: pill?.dataset.twin ?? null, pillColor: pill ? getComputedStyle(pill).color : null, twins: r.dataset.twins === undefined ? null : r.dataset.twins.split(' ').sort().join(' '), lit: 'lit' in r.dataset, pills: [...r.querySelectorAll('.commits-pill')].map((x) => x.dataset.branch).join(',') }; }; return { T0: one(${JSON.stringify(T0)}), T1: one(${JSON.stringify(T1)}), T1b: one(${JSON.stringify(T1b)}), T1c: one(${JSON.stringify(T1c)}), muted: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() }; })()`,
      );
    const tw = await twinProbe();
    expect(tw.T0 !== null && tw.T1 !== null && tw.T1b !== null && tw.T1c !== null, `four rows (${JSON.stringify(tw)})`);
    expect(tw.T1.age === '2h' && tw.T1b.age === '1h' && tw.T1c.age === '1h' && tw.T0.age === '2h', `the ages are the committer's: the original 2h, the picks 1h and not 2h (${JSON.stringify([tw.T1.age, tw.T1b.age, tw.T1c.age, tw.T0.age])})`);
    expect(tw.T1.pill === '×3' && tw.T1.kind === 'original' && tw.T1b.pill === 'picked' && tw.T1b.kind === 'pick' && tw.T1c.pill === 'picked' && tw.T1c.kind === 'pick' && tw.T0.pill === null, `the original reads ×3 and the two picks read picked; T0 has no pill (${JSON.stringify([tw.T1.pill, tw.T1b.pill, tw.T1c.pill, tw.T0.pill])})`);
    const hexToRgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    expect(tw.T1.pillColor === hexToRgb(tw.muted), `the pill is in the muted tone (${tw.T1.pillColor} vs ${tw.muted})`);
    const twinsOf = (...hashes) => hashes.sort().join(' ');
    expect(tw.T1.twins === twinsOf(T1b, T1c) && tw.T1b.twins === twinsOf(T1, T1c) && tw.T1c.twins === twinsOf(T1, T1b) && tw.T0.twins === null, `data-twins on each copy names the other two (${JSON.stringify([tw.T1.twins, tw.T1b.twins, tw.T1c.twins])})`);
    expect(tw.T1.pills === 'first' && tw.T1b.pills === 'second' && tw.T1c.pills === 'main', `each copy is a branch tip (${JSON.stringify([tw.T1.pills, tw.T1b.pills, tw.T1c.pills])})`);
    expect(!tw.T1.lit && !tw.T1b.lit && !tw.T1c.lit, 'nothing is lit before a hover');
    // The pick's card, off a hover on its row (the price step's hoverRow
    // waits for the price block, which a commit nobody claims has none
    // of, so this hover waits for the card alone).
    const hoverTwin = async (hash) => {
      const sel = railRow(hash);
      for (let attempt = 0; ; attempt++) {
        await s.evalJs(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({ block: 'nearest' })`);
        await settled(sel);
        const at = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel + ' .commits-subject')}).getBoundingClientRect(); return { x: r.x + Math.min(30, r.width / 2), y: r.y + r.height / 2 }; })()`);
        await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y });
        try {
          await s.waitFor(`!!document.querySelector(${JSON.stringify(priceCardSel(hash))})`, `the card of ${hash.slice(0, 7)} is open`, 5000);
          break;
        } catch (err) {
          if (attempt >= 2) throw err;
          await awayCard();
        }
      }
      return s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(priceCardSel(hash))}); const part = (p) => c.querySelector('[data-part=' + JSON.stringify(p) + ']'); return { times: part('times')?.querySelector('.sweep-card-text')?.textContent ?? null, twins: [...c.querySelectorAll('[data-part="twins"] .sweep-card-twin')].map((l) => ({ hash: l.dataset.hash, text: l.textContent, original: 'original' in l.dataset })), why: part('why')?.textContent ?? null }; })()`);
    };
    const pickCard = await hoverTwin(T1c);
    expect(pickCard.times === `authored ${clockOf(authorSec * 1000)}, picked ${clockOf(pickSec * 1000)}`, `the pick's card reads the authored and picked clocks (${JSON.stringify(pickCard.times)} vs ${clockOf(authorSec * 1000)} and ${clockOf(pickSec * 1000)})`);
    expect(pickCard.twins.length === 2 && pickCard.twins[0].hash === T1 && pickCard.twins[0].text === 'original on first' && pickCard.twins[0].original && pickCard.twins[1].hash === T1b && pickCard.twins[1].text === 'picked onto second' && !pickCard.twins[1].original, `the pick's card lists the original on first, then the other pick onto second (${JSON.stringify(pickCard.twins)})`);
    const litNow = await twinProbe();
    expect(litNow.T1.lit && litNow.T1b.lit && !litNow.T1c.lit && !litNow.T0.lit, `hovering a pick lights the other two copies' rows and not its own (${JSON.stringify([litNow.T1.lit, litNow.T1b.lit, litNow.T1c.lit, litNow.T0.lit])})`);
    await s.screenshot('m9-fix304-twins.png');
    await awayCard();
    await s.waitFor(`!document.querySelector(${JSON.stringify(railRow(T1))} + '[data-lit]')`, 'the lit rows fall back once the pointer leaves', 3000);
    // The original's card: no times line, since it was made in place, and
    // the two picks with their branches.
    const origCard = await hoverTwin(T1);
    expect(origCard.times === null, `the original's card has no times line (${JSON.stringify(origCard.times)})`);
    expect(origCard.twins.length === 2 && origCard.twins.every((l) => !l.original) && origCard.twins.map((l) => l.hash + ':' + l.text).sort().join('|') === [`${T1b}:picked onto second`, `${T1c}:picked onto main`].sort().join('|'), `the original's card lists the two picks with their branches (${JSON.stringify(origCard.twins)})`);
    await awayCard();
    // The pane back on the fix 255 session, so the rail is where the step
    // found it.
    await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(bare.id)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.folder === ${JSON.stringify(noRepo)}`, 'the rail is back on the fix 255 repository', 15000);
    step("M9 fix 303 and 304: the graph's rows read the committer's age, a cherry-picked original wears ×3 and its picks `picked` with data-twins naming the copies, a pick's card reads the authored and picked clocks and lists the original and the other pick with their branches, the original's card lists its picks, and hovering a pick lights the other copies' rows");
  });

  await block('fix-305', async () => {
    // M9 fix 305 and 306: the member lanes of one block told apart. A
    // repository of the step's own: one commit made by hand (M0), a shell
    // in it on a pane of its own (a shift-click on its row, the fix 148
    // way, so the rail follows), one commit of the session's (M1), then
    // six members out on six worktree branches cut at M1, each commit-less
    // so it holds a lane of its own (M9 fix 150). The block's own line is
    // heavier (data-own) with an empty pitch after it, and every member
    // edge wears a tint of the block's colour (data-tint the member's
    // index). Then the card's Show button (fix 306) reads `Focus its pane`
    // off this session, on a pane, and `Show in a pane` off a second shell
    // in the same repository that no pane shows. The reads are scoped to
    // the rail, since the fix 212 step left a commits view pane up on
    // another repository and it comes first in the document.
    const memShort = path.join(os.tmpdir(), 'emerald-verify', `m51-members-${process.pid}`);
    fs.rmSync(memShort, { recursive: true, force: true });
    fs.mkdirSync(memShort, { recursive: true });
    const memRepo = fs.realpathSync.native(memShort);
    fixDirs.push(memRepo);
    const gitM = gitIn(memRepo);
    gitM('init', '-q', '-b', 'main');
    gitM('config', 'user.name', 'verify');
    gitM('config', 'user.email', 'verify@example.invalid');
    gitM('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(memRepo, 'M0.txt'), 'M0');
    gitM('add', 'M0.txt');
    gitM('commit', '-q', '-m', 'M0');
    const sessM = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: memRepo, cols: 80, rows: 24 })).session;
    await post(sessM.id, { cwd: memRepo, hook_event_name: 'SessionStart', source: 'startup' });
    const memPaneBefore = await s.evalJs(`document.querySelector('.pane.focused').dataset.paneId`);
    await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(sessM.id)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.folder === ${JSON.stringify(memRepo)}`, 'the rail follows the shell to the members repository', 10000);
    const memPane = await s.evalJs(`document.querySelector('.pane.focused').dataset.paneId`);
    expect(memPane !== memPaneBefore && (await onAPane(sessM.id)), 'the shift-click put the shell on a pane of its own');
    await post(sessM.id, { cwd: memRepo, hook_event_name: 'UserPromptSubmit', prompt: 'fan out six' });
    const M1 = await commitVia(sessM.id, gitM, 'M1', memRepo);
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(M1))})?.dataset.session === ${JSON.stringify(sessM.id)}`, "M1 is the session's on the rail", 10000);
    const memberNames = ['ma', 'mb', 'mc', 'md', 'me', 'mf'];
    const memberDirs = [];
    for (const name of memberNames) {
      const short = path.join(os.tmpdir(), 'emerald-verify', `m51-members-${name}-${process.pid}`);
      fs.rmSync(short, { recursive: true, force: true });
      gitM('worktree', 'add', '-q', '-b', name, short, M1);
      memberDirs.push(fs.realpathSync.native(short));
      fixDirs.push(memberDirs.at(-1));
    }
    await s.waitFor(`!!document.querySelector('.commits-pill[data-branch="mf"]')`, 'the six branches show on M1', 10000);
    for (const [i, name] of memberNames.entries()) {
      await post(sessM.id, { cwd: memRepo, hook_event_name: 'SubagentStart', agent_id: name, agent_type: 'fork' });
      await post(sessM.id, { cwd: memRepo, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: `agent ${name}`, subagent_type: 'fork' }, tool_response: { agentId: name, description: `agent ${name}`, status: 'async_launched' } });
      await post(sessM.id, { cwd: memberDirs[i], agent_id: name, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
      await post(sessM.id, { cwd: memberDirs[i], agent_id: name, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    }
    await s.waitFor(`document.querySelectorAll('.commits-agent-row[data-session=${JSON.stringify(sessM.id)}][data-member][data-pending]').length === 6`, 'six commit-less worktree rows', 10000);
    await settled(nodeSel(M1));
    const lanes305 = await s.evalJs(
      `(() => { const sid = ${JSON.stringify(sessM.id)}; const num = (v) => parseFloat(String(v).replace('calc(', '')); const edges = [...document.querySelectorAll('.files-rail .commits-edge[data-session=' + JSON.stringify(sid) + ']')]; const members = edges.filter((e) => e.dataset.member !== undefined).map((e) => ({ member: e.dataset.member, lane: e.dataset.lane, tint: e.dataset.tint ?? null, own: 'own' in e.dataset, color: e.style.getPropertyValue('--lane'), stroke: getComputedStyle(e).stroke, width: num(getComputedStyle(e).strokeWidth), x: +e.getAttribute('d').slice(1).split(' ')[0] })).sort((a, b) => +a.lane - +b.lane); const own = edges.filter((e) => 'own' in e.dataset).map((e) => ({ lane: e.dataset.lane, tint: e.dataset.tint ?? null, member: e.dataset.member ?? null, color: e.style.getPropertyValue('--lane'), width: num(getComputedStyle(e).strokeWidth), x: +e.getAttribute('d').slice(1).split(' ')[0] })); const nodeM1 = document.querySelector(${JSON.stringify(nodeSel(M1))}); return { lanes: document.querySelector('.files-rail .commits-panel').dataset.lanes, members, own, m1: { color: nodeM1.style.getPropertyValue('--lane'), x: +nodeM1.getAttribute('cx'), tint: nodeM1.dataset.tint ?? null }, ownTotal: edges.filter((e) => e.dataset.member === undefined).length }; })()`,
    );
    const sessMNow = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === sessM.id);
    const picture305 = () => s.evalJs(`(() => { const p = document.querySelector('.files-rail .commits-panel'); const g = p.querySelector('.commits-graph'); return { folder: p.dataset.folder, lanes: p.dataset.lanes, blocks: p.dataset.blocks, columns: g?.dataset.columns, rows: [...p.querySelectorAll('.commits-graph-rows .commits-row')].map((r) => (r.dataset.hash ?? r.dataset.member ?? 'own').slice(0, 7) + ':' + (r.querySelector('.commits-subject')?.textContent ?? '') + ':' + [...r.querySelectorAll('.commits-pill')].map((x) => x.dataset.branch).join('+')), nodes: [...p.querySelectorAll('.commits-node')].map((n) => (n.dataset.hash ?? n.dataset.kind ?? '?').slice(0, 7) + '@' + n.dataset.lane + (n.dataset.session ? '' : ' outside')), edges: [...p.querySelectorAll('.commits-edge')].map((e) => e.dataset.kind + '@' + e.dataset.lane + (e.dataset.member ? ':' + e.dataset.member : '') + ('own' in e.dataset ? ' own' : '')) }; })()`);
    expect(lanes305.lanes === '8', `the session's seven lanes and the grey block's one (${lanes305.lanes}; ${JSON.stringify(await picture305())}; team ${JSON.stringify((sessMNow.team ?? []).map((m) => [m.id, m.branch, m.cwd]))})`);
    expect(lanes305.members.length === 6 && lanes305.members.map((m) => m.member).join(',') === memberNames.join(','), `six member edges, one per member in lane order (${JSON.stringify(lanes305.members.map((m) => [m.member, m.lane]))})`);
    expect(lanes305.members.map((m) => m.tint).join(',') === '1,2,3,4,5,6', `data-tint counts the members 1 to 6 (${lanes305.members.map((m) => m.tint).join(',')})`);
    const tints305 = lanes305.members.map((m) => m.color);
    expect(new Set(tints305).size === 6 && tints305.every((c) => c !== sessMNow.color && /^#[0-9a-f]{6}$/.test(c)), `six distinct --lane values on the member edges, none the block's ${sessMNow.color} (${tints305.join(' ')})`);
    expect(lanes305.members.every((m) => m.stroke === rgb(m.color)), `each member edge is drawn in its tint (${JSON.stringify(lanes305.members.map((m) => [m.color, m.stroke]))})`);
    expect(tints305.every((c) => { const hue = Math.abs(hueOf(c) - hueOf(sessMNow.color)); return Math.min(hue, 360 - hue) < 6; }), `every tint keeps the block's hue (${tints305.map(hueOf).map((h) => h.toFixed(1)).join(' ')} against ${hueOf(sessMNow.color).toFixed(1)})`);
    expect(lanes305.m1.color === sessMNow.color && lanes305.m1.tint === null, `the session's own node keeps the block colour, no tint (${JSON.stringify(lanes305.m1)})`);
    expect(lanes305.own.length > 0 && lanes305.own.length === lanes305.ownTotal && lanes305.own.every((e) => e.lane === lanes305.own[0].lane && e.member === null && e.tint === null && e.color === sessMNow.color), `every edge on the session's own line carries data-own, in the block colour (${JSON.stringify(lanes305.own)})`);
    // One weight step up the ladder: 2.5 to the members' 2, or 3 to 2.5
    // while the block is lit (the shell's pane has the focus here, and
    // whether the rail lights it is the panel's to say).
    const memberW = lanes305.members[0].width;
    expect(lanes305.members.every((m) => Math.abs(m.width - memberW) < 0.02) && (Math.abs(memberW - 2) < 0.02 || Math.abs(memberW - 2.5) < 0.02) && lanes305.own.every((e) => Math.abs(e.width - (memberW + 0.5)) < 0.02), `the own line is one weight step up from the members' (${JSON.stringify([lanes305.own.map((e) => e.width), lanes305.members.map((m) => m.width)])})`);
    // The empty pitch: the own line at the first column, the first member
    // lane two pitches on rather than one, and the members a pitch apart.
    const ownX = lanes305.own[0].x;
    expect(ownX === LANE_X0 && lanes305.m1.x === ownX, `the own line is at the gutter's first column (${JSON.stringify([ownX, lanes305.m1.x])})`);
    expect(lanes305.members[0].x === ownX + 2 * LANE_GAP && lanes305.members.every((m, i) => m.x === ownX + (i + 2) * LANE_GAP), `the first member lane sits an empty pitch past the own line and the rest a pitch apart (${lanes305.members.map((m) => m.x).join(' ')})`);
    await s.screenshot('fix-305-member-lanes.png');
    // M9 fix 306: the card off M1 (the session's own node) says
    // `Focus its pane` while the session is on one.
    await hoverForAction(nodeSel(M1), 'show', "M1 opens the session's lane card");
    const cardM = await readCard();
    expect(cardM.session === sessM.id && cardM.showLabel === 'Focus its pane', `the card is the session's and its Show reads Focus its pane on a pane (${JSON.stringify([cardM.session, cardM.showLabel])})`);
    await away();
    // A second shell in the repository that no pane shows: its start bar
    // opens its card, and the button reads `Show in a pane`.
    const sessN = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: memRepo, cols: 80, rows: 24 })).session;
    await post(sessN.id, { cwd: memRepo, hook_event_name: 'SessionStart', source: 'startup' });
    const nBar = `.commits-node[data-start][data-session=${JSON.stringify(sessN.id)}]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(nBar)})`, 'the second shell has its start bar on M1', 10000);
    expect(!(await onAPane(sessN.id)), 'no pane shows the second shell');
    await hoverForAction(nBar, 'show', "the bar opens the second shell's card");
    const cardN = await readCard();
    expect(cardN.session === sessN.id && cardN.showLabel === 'Show in a pane', `off a pane the button reads Show in a pane (${JSON.stringify([cardN.session, cardN.showLabel])})`);
    await away();
    // The pane hidden, so the focus and the rail go back where they were.
    await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(memPane)}] .pane-hide').click()`);
    await s.waitFor(`document.querySelector('.pane.focused')?.dataset.paneId === ${JSON.stringify(memPaneBefore)}`, 'the pane before is focused again', 10000);
    step('M9 fix 305 and 306: under six members a block draws its own line heavier at the first column with an empty pitch after it, and each member lane in a distinct tint of the block colour with its index on it; the lane card Show button reads Focus its pane on a pane and Show in a pane off one');
  });

  await block('fix-325', async () => {
    // M9 fix 325: a subagent's row opens the same card its marker does,
    // and the card gains the member's model word and a tokens line for
    // its own span. A repository and session of this step's own, fix
    // 252's shape: the member's agent file is written before the
    // session's own first commit lands, so the very first ask
    // commit-usage.ts makes already carries it (docs/GOTCHAS.md, fixes 288 to
    // 302). The member returns (a SubagentStop) so its span has a fixed
    // end of this step's own choosing, since the panel's own clock ticks
    // on a 30s beat and a request timed off "now" alone could sit past a
    // stale read.
    const cgShort = path.join(os.tmpdir(), 'emerald-verify', `m51-card-${process.pid}`);
    fs.rmSync(cgShort, { recursive: true, force: true });
    fs.mkdirSync(cgShort, { recursive: true });
    cgRepo = fs.realpathSync.native(cgShort);
    fixDirs.push(cgRepo);
    gitCg = gitIn(cgRepo);
    gitCg('init', '-q', '-b', 'main');
    gitCg('config', 'user.name', 'verify');
    gitCg('config', 'user.email', 'verify@example.invalid');
    gitCg('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(cgRepo, 'CG0.txt'), 'CG0');
    gitCg('add', 'CG0.txt');
    gitCg('commit', '-q', '-m', 'CG0');
    const cgLayout = await getLayout(s);
    const cgLeaf = leaves(cgLayout).find((leaf) => leaf.sessionId !== null && (leaf.view === undefined || leaf.view === null));
    expect(cgLeaf !== undefined, 'a terminal pane to put the card session on');
    const cgSwapIn = (node, sessionId) => (node.kind === 'pane' ? (node.id === cgLeaf.id ? { ...node, sessionId } : node) : { ...node, first: cgSwapIn(node.first, sessionId), second: cgSwapIn(node.second, sessionId) });
    cgSess = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: cgRepo, cols: 80, rows: 24 })).session;
    await zreq(s, 'layout.set', { layout: { ...cgLayout, root: cgSwapIn(cgLayout.root, cgSess.id), focusedPaneId: cgLeaf.id } });
    await post(cgSess.id, { cwd: cgRepo, hook_event_name: 'SessionStart', source: 'startup' });
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.folder === ${JSON.stringify(cgRepo)}`, 'the rail follows the card session to its own repository', 10000);
    const cgConv = `sim-${cgSess.id}`;
    const cgClaudeDir = path.join(claudeHome, 'projects', encode(cgRepo));
    fs.mkdirSync(cgClaudeDir, { recursive: true });
    const cgSubagents = path.join(cgClaudeDir, cgConv, 'subagents');
    fs.mkdirSync(cgSubagents, { recursive: true });
    fs.writeFileSync(path.join(cgClaudeDir, `${cgConv}.jsonl`), jl({ type: 'user', timestamp: iso(Date.now() - 500), message: { role: 'user', content: 'card it' }, cwd: cgRepo }));
    await post(cgSess.id, { cwd: cgRepo, hook_event_name: 'SubagentStart', agent_id: 'cg', agent_type: 'fork' });
    await post(cgSess.id, { cwd: cgRepo, hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'agent cg', subagent_type: 'fork' }, tool_response: { agentId: 'cg', description: 'agent cg', status: 'async_launched' } });
    const cgWtShort = path.join(os.tmpdir(), 'emerald-verify', `m51-card-cg-${process.pid}`);
    fs.rmSync(cgWtShort, { recursive: true, force: true });
    gitCg('worktree', 'add', '-q', '-b', 'cg', cgWtShort);
    const cgWt = fs.realpathSync.native(cgWtShort);
    fixDirs.push(cgWt);
    await post(cgSess.id, { cwd: cgWt, agent_id: 'cg', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    await post(cgSess.id, { cwd: cgWt, agent_id: 'cg', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } });
    const cgReqAt = Date.now();
    fs.writeFileSync(
      path.join(cgSubagents, 'agent-cg.jsonl'),
      jl({ type: 'assistant', isSidechain: true, agentId: 'cg', timestamp: iso(cgReqAt), message: { id: 'msg_cg', role: 'assistant', model: 'claude-opus-5', usage: { input_tokens: 2300, cache_creation_input_tokens: 0, cache_read_input_tokens: 10000, output_tokens: 4100 }, content: [{ type: 'text', text: 'ok' }] } }),
    );
    await post(cgSess.id, { cwd: cgRepo, agent_id: 'cg', hook_event_name: 'SubagentStop' });
    await commitVia(cgSess.id, gitCg, 'CG1', cgRepo);
    const cgRowSel = `.commits-agent-row[data-session=${JSON.stringify(cgSess.id)}][data-member="cg"]`;
    await s.waitFor(`!!document.querySelector(${JSON.stringify(cgRowSel)})`, "cg's row is on the rail, its worktree cut with nothing of its own committed", 10000);
    await s.evalJs(`document.querySelector(${JSON.stringify(cgRowSel)})?.scrollIntoView({ block: 'center' })`);
    await settled(cgRowSel);
    await hoverOver(cgRowSel);
    await s.waitFor(`!!document.querySelector('.agent-popover[data-member="cg"]')`, 'the row opens the same card as the marker', 5000);
    const cgCard = await s.evalJs(`(() => { const c = document.querySelector('.agent-popover[data-member="cg"]'); return { model: c.querySelector('.agent-card-model')?.textContent ?? null, branch: c.querySelector('.agent-card-branch')?.textContent ?? null, tokens: c.querySelector('.agent-card-tokens')?.textContent ?? null }; })()`);
    expect(cgCard.model === 'Opus', `the card's model word reads off the agents-running store, the way ShadeTeam does (${JSON.stringify(cgCard)})`);
    expect(cgCard.branch === '⑂ cg', `the card still reads the branch off the member's own record (${JSON.stringify(cgCard)})`);
    expect(cgCard.tokens === '↑ 12.3k sent, ↓ 4.1k received, ~$0.12', `the tokens line sums the member's own span from the conversation usage (${JSON.stringify(cgCard)})`);
    // M9 fix 646: Escape, not the pointer's leave, closes the card: the leave
    // alone left it up under another window's load at two close-outs.
    await s.key('Escape', 'Escape', 27);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 300 });
    await s.waitFor(`!document.querySelector('.lane-popover, .agent-popover')`, 'Escape closes the cg card');
    step("M9 fix 325: a subagent's row opens the same card its marker does, gaining the member's model word and its tokens sent, received and estimated spend");
  });
  await block('fix-445', async () => {
    // M9 fix 445: the card used to be a fixed 206px with every line
    // clipped to one row, so a long command was cut at the right edge; it
    // now widens to fit its content up to 320px and wraps instead of
    // clipping. Reuses fix 325's cg row: an eighty-character cd is its
    // activity.
    const cgRowSel = `.commits-agent-row[data-session=${JSON.stringify(cgSess.id)}][data-member="cg"]`;
    await s.evalJs(`document.querySelector(${JSON.stringify(cgRowSel)})?.scrollIntoView({ block: 'center' })`);
    await hoverForCard(s, cgRowSel, '.agent-popover[data-member="cg"]', 'the row opens the card again for the wide-activity read');
    const cgLongCd = `cd ${'a'.repeat(77)}`;
    expect(cgLongCd.length === 80, `the seeded command is eighty characters (${cgLongCd.length})`);
    await post(cgSess.id, { cwd: cgRepo, agent_id: 'cg', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cgLongCd } });
    await s.waitFor(`document.querySelector('.agent-popover[data-member="cg"] .agent-card-activity')?.textContent === ${JSON.stringify(cgLongCd)}`, "the card's activity line takes the eighty-character command", 5000);
    const cgWide = await s.evalJs(`(() => { const c = document.querySelector('.agent-popover[data-member="cg"]'); const a = c.querySelector('.agent-card-activity'); const r = c.getBoundingClientRect(); return { scrollWidth: a.scrollWidth, clientWidth: a.clientWidth, cardWidth: r.width, right: r.right, windowWidth: window.innerWidth }; })()`);
    expect(cgWide.scrollWidth <= cgWide.clientWidth, `the activity line wraps rather than overflowing its box (${JSON.stringify(cgWide)})`);
    expect(cgWide.cardWidth <= 320, `the card widens no further than 320px (${JSON.stringify(cgWide)})`);
    expect(cgWide.right <= cgWide.windowWidth, `the card's right edge stays inside the window (${JSON.stringify(cgWide)})`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.agent-popover[data-member="cg"]')`, 'Escape closes the wide card');
    step("M9 fix 445: the agent card widens to fit an eighty-character activity line up to 320px and wraps it rather than clipping it, closing on Escape");
  });
  await block('fix-320', async () => {
    // M9 fix 320: the conflict forecast (docs/design/conflict-forecast.md
    // section 13). A repository of the step's own with a twenty-line
    // file, five worktrees cut at its first commit and a shell in each,
    // every shell commits through its own hooks (so its block owns the
    // node the tie ends on), and main moves on through a sixth shell in
    // the root. pocket and live both rewrite line 1 (one file); live and
    // debt both rewrite g, h and m (three); week and debt both rewrite
    // line 20 and k (two); sweep adds a file of its own and is in no
    // pair. The daemon polls after every credited commit, so the ties
    // land within a second of the last commit. Every read is scoped to
    // the rail, since the fix 212 step left a commits view pane up.
    const cfShort = path.join(os.tmpdir(), 'emerald-verify', `m51-conflicts-${process.pid}`);
    fs.rmSync(cfShort, { recursive: true, force: true });
    fs.mkdirSync(cfShort, { recursive: true });
    const cfRepo = fs.realpathSync.native(cfShort);
    fixDirs.push(cfRepo);
    const gitC = gitIn(cfRepo);
    gitC('init', '-q', '-b', 'main');
    gitC('config', 'user.name', 'verify');
    gitC('config', 'user.email', 'verify@example.invalid');
    gitC('config', 'commit.gpgsign', 'false');
    const twenty = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const writeLines = (dir, name, lines) => fs.writeFileSync(path.join(dir, name), lines.join('\n') + '\n');
    writeLines(cfRepo, 'f.txt', twenty);
    for (const n of ['g', 'h', 'k', 'm']) writeLines(cfRepo, `${n}.txt`, [n]);
    gitC('add', '.');
    gitC('commit', '-q', '-m', 'C0');
    const cfNames = ['pocket', 'live', 'sweep', 'week', 'debt'];
    const cfDirs = {};
    for (const name of cfNames) {
      const short = path.join(os.tmpdir(), 'emerald-verify', `m51-conflicts-${name}-${process.pid}`);
      fs.rmSync(short, { recursive: true, force: true });
      gitC('worktree', 'add', '-q', '-b', name, short, 'main');
      cfDirs[name] = fs.realpathSync.native(short);
      fixDirs.push(cfDirs[name]);
    }
    const cfSess = {};
    for (const name of cfNames) {
      cfSess[name] = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: cfDirs[name], cols: 80, rows: 24 })).session;
      await post(cfSess[name].id, { cwd: cfDirs[name], hook_event_name: 'SessionStart', source: 'startup' });
      await post(cfSess[name].id, { cwd: cfDirs[name], hook_event_name: 'UserPromptSubmit', prompt: `work on ${name}` });
    }
    // The rail follows the focused pane's session to its own folder, so
    // the pane takes the root shell (a worktree shell would put the rail
    // on the worktree); the worktree sessions are lanes on the root's
    // graph as any checkout's are (M68).
    const cfMain = (await zreq(s, 'session.spawn', { kind: 'shell', cwd: cfRepo, cols: 80, rows: 24 })).session;
    await post(cfMain.id, { cwd: cfRepo, hook_event_name: 'SessionStart', source: 'startup' });
    const cfPaneBefore = await s.evalJs(`document.querySelector('.pane.focused').dataset.paneId`);
    await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(cfMain.id)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))`);
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.folder === ${JSON.stringify(cfRepo)}`, 'the rail follows the root shell to the conflicts repository', 10000);
    const cfPane = await s.evalJs(`document.querySelector('.pane.focused').dataset.paneId`);
    // A commit through a session's hooks with the files the step names.
    const commitFiles = async (name, dir, sessionId, files) => {
      const command = `git commit -q -am ${name}`;
      await post(sessionId, { cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
      await sleep(300);
      for (const [file, lines] of Object.entries(files)) writeLines(dir, file, lines);
      const g = gitIn(dir);
      g('add', '-A');
      g('commit', '-q', '-m', name);
      const hash = g('rev-parse', 'HEAD').trim();
      await post(sessionId, { cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } });
      return hash;
    };
    const cfAt = (n, text) => twenty.map((l, i) => (i === n - 1 ? text : l));
    const cfGutter = () =>
      s.evalJs(
        `(() => { const p = document.querySelector('.files-rail .commits-panel'); const svg = p.querySelector('.commits-graph'); const all = [...svg.querySelectorAll('*')]; const idx = (el) => all.indexOf(el); const num = (v) => parseFloat(String(v).replace('calc(', '')); const ties = [...svg.querySelectorAll('.commits-tie')].map((t) => { const g = t.parentElement; return { from: t.dataset.from, to: t.dataset.to, a: g.dataset.a, b: g.dataset.b, files: g.dataset.files, chevrons: (t.getAttribute('d').match(/M/g) ?? []).length, width: num(getComputedStyle(t).strokeWidth), stroke: getComputedStyle(t).stroke, dash: getComputedStyle(t).strokeDasharray, filter: getComputedStyle(t).filter, index: idx(t), hit: (() => { const h = g.querySelector('.commits-tie-hit'); return { width: num(getComputedStyle(h).strokeWidth), stroke: getComputedStyle(h).stroke, events: getComputedStyle(h).pointerEvents, d: h.getAttribute('d') }; })() }; }); const halos = [...svg.querySelectorAll('.commits-tie-halo')].map((h) => ({ session: h.dataset.session, cx: +h.getAttribute('cx'), cy: +h.getAttribute('cy'), r: +h.getAttribute('r'), width: num(getComputedStyle(h).strokeWidth), stroke: getComputedStyle(h).stroke, dash: getComputedStyle(h).strokeDasharray, filter: getComputedStyle(h).filter, index: idx(h) })); const nodeOf = (sid) => { const n = [...svg.querySelectorAll('.commits-node[data-hash][data-session=' + JSON.stringify(sid) + ']:not([data-member])')][0]; return n ? { cx: +n.getAttribute('cx'), cy: +n.getAttribute('cy'), index: idx(n) } : null; }; return { ties, halos, edgeMin: Math.min(...[...svg.querySelectorAll('.commits-edge')].map(idx)), nodeMax: Math.max(...[...svg.querySelectorAll('.commits-node')].map(idx)), texts: [...svg.querySelectorAll('text')].filter((t) => !t.classList.contains('commits-label')).map((t) => ({ cls: t.className.baseVal, text: t.textContent, session: t.dataset.session ?? null, fill: getComputedStyle(t).fill, x: +t.getAttribute('x'), y: +t.getAttribute('y') })), elements: all.length, nodes: Object.fromEntries(${JSON.stringify(cfNames)}.map((n) => [n, nodeOf(${JSON.stringify(Object.fromEntries(cfNames.map((n) => [n, cfSess[n].id])))}[n])])), error: getComputedStyle(document.documentElement).getPropertyValue('--error').trim(), muted: getComputedStyle(document.documentElement).getPropertyValue('--muted').trim(), edgeWidths: [...new Set([...svg.querySelectorAll('.commits-edge')].map((e) => num(getComputedStyle(e).strokeWidth)))].sort(), radii: [...new Set([...svg.querySelectorAll('circle.commits-node')].map((n) => n.getAttribute('r')))].sort(), rowHeights: [...new Set([...p.querySelectorAll('.commits-graph-rows .commits-row')].map((r) => Math.round(r.getBoundingClientRect().height)))], slab: (() => { const sl = svg.querySelector('.commits-focus-slab'); return sl ? [sl.getAttribute('x'), sl.getAttribute('y'), sl.getAttribute('width'), sl.getAttribute('height')].join(' ') : null; })() }; })()`,
      );
    const cfRows = () =>
      s.evalJs(
        `(() => Object.fromEntries(Object.entries(${JSON.stringify(Object.fromEntries(cfNames.map((n) => [n, cfSess[n].id])))}).map(([name, id]) => { const r = document.querySelector('.sidebar-row[data-session-id=' + JSON.stringify(id) + ']'); const m = r?.querySelector('.sidebar-row-conflict'); return [name, m ? { count: m.querySelector('.sidebar-row-conflict-count')?.textContent ?? null, pairs: m.dataset.pairs, title: m.title, color: getComputedStyle(m).color, visible: m.getClientRects().length > 0, chevrons: m.querySelector('svg path') !== null } : null]; })))()`,
      );
    // The picture before any pair: the fixture's own commits first, so
    // the counts after are read against a graph with the same rows.
    const cfHash = {};
    cfHash.pocket = await commitFiles('pocket', cfDirs.pocket, cfSess.pocket.id, { 'f.txt': cfAt(1, 'POCKET') });
    cfHash.sweep = await commitFiles('sweep', cfDirs.sweep, cfSess.sweep.id, { 's.txt': ['sweep'] });
    cfHash.week = await commitFiles('week', cfDirs.week, cfSess.week.id, { 'f.txt': cfAt(20, 'WEEK'), 'k.txt': ['WEEK'] });
    await s.waitFor(`document.querySelector(${JSON.stringify(nodeSel(cfHash.week))})?.dataset.session === ${JSON.stringify(cfSess.week.id)}`, "week's commit is on the rail as its own", 10000);
    await sleep(1500);
    const cfNone = await cfGutter();
    expect(cfNone.ties.length === 0 && cfNone.halos.length === 0 && cfNone.texts.length === 0, `three branches that merge clean draw no tie, no halo, no figure (${JSON.stringify([cfNone.ties.length, cfNone.halos.length, cfNone.texts.length])})`);
    const cfRowsNone = await cfRows();
    expect(Object.values(cfRowsNone).every((m) => m === null), `no row carries a mark with no pair (${JSON.stringify(cfRowsNone)})`);
    // live conflicts with pocket on f (line 1); debt with live on g, h
    // and m, and with week on f (line 20) and k.
    cfHash.live = await commitFiles('live', cfDirs.live, cfSess.live.id, { 'f.txt': cfAt(1, 'LIVE'), 'g.txt': ['LIVE'], 'h.txt': ['LIVE'], 'm.txt': ['LIVE'] });
    cfHash.debt = await commitFiles('debt', cfDirs.debt, cfSess.debt.id, { 'f.txt': cfAt(20, 'DEBT'), 'g.txt': ['DEBT'], 'h.txt': ['DEBT'], 'k.txt': ['DEBT'], 'm.txt': ['DEBT'] });
    await s.waitFor(`document.querySelectorAll('.files-rail .commits-tie').length === 3`, 'three ties on the rail once debt has committed', 75000, { quietMs: 0 });
    await settled(nodeSel(cfHash.debt));
    const cf = await cfGutter();
    const cfId = (name) => cfSess[name].id;
    const pairKey = (t) => [t.a, t.b].sort().join('+');
    const wantPairs = [['pocket', 'live'], ['live', 'debt'], ['week', 'debt']].map((p) => p.map(cfId).sort().join('+')).sort();
    // 1: the tie exists once per pair, no count anywhere in the gutter.
    expect(cf.ties.map(pairKey).sort().join(',') === wantPairs.join(','), `one tie per conflicting pair and none for the clean ones (${JSON.stringify(cf.ties.map((t) => [t.a, t.b]))})`);
    expect(cf.ties.every((t) => t.chevrons >= 2), `every tie is a run of chevrons (${cf.ties.map((t) => t.chevrons).join(',')})`);
    expect(cf.texts.length === 0, `no element in the gutter carries a number (${JSON.stringify(cf.texts)})`);
    expect(cf.ties.map((t) => t.files).sort().join(',') === '1,2,3', `the ties carry the file counts for the card alone, one, two and three (${cf.ties.map((t) => t.files).join(',')})`);
    // 1b: the clean lane is untouched.
    expect(cf.halos.every((h) => h.session !== cfId('sweep')) && cf.ties.every((t) => t.a !== cfId('sweep') && t.b !== cfId('sweep')), 'sweep has no halo and no tie');
    // 2: each end is within a pixel of one of the two newest commit nodes, each of those carries one halo, and no other node does.
    for (const t of cf.ties) {
      const from = cf.nodes[cfNames.find((n) => cfId(n) === t.from)];
      const to = cf.nodes[cfNames.find((n) => cfId(n) === t.to)];
      const ends = t.hit.d.match(/-?[\d.]+/g).map(Number);
      expect(from !== null && to !== null && Math.abs(ends[0] - from.cx) < 1 && Math.abs(ends[1] - from.cy) < 1 && Math.abs(ends[2] - to.cx) < 1 && Math.abs(ends[3] - to.cy) < 1, `the tie runs from ${t.from.slice(0, 8)}'s newest node to ${t.to.slice(0, 8)}'s (${JSON.stringify([ends, from, to])})`);
    }
    const haloKeys = cf.halos.map((h) => `${h.cx},${h.cy}`);
    expect(cf.halos.length === 4 && new Set(haloKeys).size === 4, `four halos on four nodes, debt's one node in two pairs ringed once (${JSON.stringify(cf.halos.map((h) => [h.session.slice(0, 8), h.cx, h.cy]))})`);
    expect(['pocket', 'live', 'week', 'debt'].every((n) => cf.halos.some((h) => Math.abs(h.cx - cf.nodes[n].cx) < 0.01 && Math.abs(h.cy - cf.nodes[n].cy) < 0.01)), 'each halo sits on a paired lane\'s newest node');
    // 3: the slopes come before every lane path in document order, the halos after every node.
    expect(cf.ties.every((t) => t.index < cf.edgeMin), `the slopes are earlier in the document than every lane path (${JSON.stringify([cf.ties.map((t) => t.index), cf.edgeMin])})`);
    expect(cf.halos.every((h) => h.index > cf.nodeMax), `the halos are later than every node (${JSON.stringify([cf.halos.map((h) => h.index), cf.nodeMax])})`);
    // 4: the slope is 0.9, the halo 1 and dashed, nothing blurred; the hit path 7 and transparent.
    expect(cf.ties.every((t) => Math.abs(t.width - 0.9) < 0.01 && t.filter === 'none'), `the slopes are 0.9 wide with no filter (${JSON.stringify(cf.ties.map((t) => [t.width, t.filter]))})`);
    expect(cf.halos.every((h) => h.width === 1 && h.dash !== 'none' && h.filter === 'none' && h.r === 6), `the halos are 1 wide, dashed, r 6, no filter (${JSON.stringify(cf.halos.map((h) => [h.width, h.dash, h.r]))})`);
    expect(cf.ties.every((t) => t.hit.width === 7 && t.hit.stroke === 'rgba(0, 0, 0, 0)' && t.hit.events === 'stroke'), `the hit path is 7 wide, transparent, taking the pointer on its stroke (${JSON.stringify(cf.ties.map((t) => t.hit))})`);
    // 6: a three-file pair draws the same slope as a one-file pair; the rows count pairs.
    const cfOne = cf.ties.find((t) => t.files === '1');
    const cfThree = cf.ties.find((t) => t.files === '3');
    expect(cfOne.width === cfThree.width && cfOne.stroke === cfThree.stroke && cfOne.dash === cfThree.dash && cfOne.chevrons >= 2 && cfThree.chevrons >= 2, `the one-file and three-file ties draw alike but for their ends (${JSON.stringify([cfOne, cfThree])})`);
    const cfMarks = await cfRows();
    expect(cfMarks.pocket?.count === '1' && cfMarks.live?.count === '2' && cfMarks.debt?.count === '2' && cfMarks.week?.count === '1' && cfMarks.sweep === null, `the rows count pairs: pocket 1, live 2, debt 2, week 1, sweep none (${JSON.stringify(Object.fromEntries(Object.entries(cfMarks).map(([k, v]) => [k, v?.count ?? null])))})`);
    expect(['pocket', 'live', 'debt', 'week'].every((n) => cfMarks[n].visible && cfMarks[n].chevrons), `every mark is on screen with its chevrons (${JSON.stringify(cfMarks)})`);
    expect(cfMarks.debt.title.split('\n').length === 2 && cfMarks.debt.title.includes(`conflicts with ${cfSess.live.name} on g.txt and 2 more`) && cfMarks.debt.title.includes(`conflicts with ${cfSess.week.name} on f.txt and k.txt`), `debt's tooltip is the card's two lines (${JSON.stringify(cfMarks.debt.title)})`);
    // 11: one tone, --error, on the slope, the halo, the row mark and the card's word.
    expect(cf.ties.every((t) => t.stroke === rgb(cf.error)) && cf.halos.every((h) => h.stroke === rgb(cf.error)) && cfMarks.debt.color === rgb(cf.error), `the slope, the halos and the row mark compute to --error ${cf.error} (${JSON.stringify([cf.ties[0].stroke, cf.halos[0].stroke, cfMarks.debt.color])})`);
    // 7: the card off debt's node: two conflict lines, the other lane in its own colour, the files cut to `and 2 more`, and the base line.
    const cfList = (await zreq(s, 'session.list', {})).sessions;
    const colourOf = (name) => cfList.find((x) => x.id === cfId(name)).color;
    // A node's card, the node scrolled into the rail's view first (forty
    // commits on main push the fixture's nodes far down the list), and
    // the card checked to be that session's, not the row above's.
    // A card near the rail's bottom is drawn over its own node, so the
    // pointer's jump away leaves it up; Escape closes a hover card and a
    // pinned one alike, then the pointer goes away as every step's does.
    const cfCloseCard = async () => {
      await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await away();
    };
    // hoverForAction passes on any card with a show action, so a
    // neighbour's card or an older one left up passes it; the named
    // session's own card is waited for, and a miss closes whatever is up
    // and tries once more. A product bug fails both tries.
    const cfHoverCard = async (name, what) => {
      const ownSel = `.lane-popover[data-session-id=${JSON.stringify(cfId(name))}] .lane-card-action[data-action="show"]`;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await s.evalJs(`document.querySelector(${JSON.stringify(nodeSel(cfHash[name]))})?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
        await sleep(400);
        await hoverForAction(nodeSel(cfHash[name]), 'show', what);
        try {
          await s.waitFor(`!!document.querySelector(${JSON.stringify(ownSel)})`, what, 3000);
          return;
        } catch {
          if (attempt === 1) throw new Error(`timed out waiting for ${what}: the card is ${name}'s`);
          const ids = await s.evalJs(`[...document.querySelectorAll('.lane-popover')].map((c) => c.dataset.sessionId).join(',')`);
          console.log(`[verify] note: ${what} opened another card (${ids}) first; trying again`);
          await cfCloseCard();
        }
      }
    };
    await cfHoverCard('debt', "debt's node opens its lane card");
    const cfCard = await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(`.lane-popover[data-session-id=${JSON.stringify(cfId('debt'))}]`)}); return { session: c.dataset.sessionId, lines: [...c.querySelectorAll('.lane-card-conflict')].map((l) => ({ other: l.dataset.other, files: l.dataset.files, name: l.querySelector('.lane-card-conflict-other').textContent, color: getComputedStyle(l.querySelector('.lane-card-conflict-other')).color, wordColor: getComputedStyle(l.querySelector('.lane-card-conflict-word')).color, filesText: l.querySelector('.lane-card-conflict-files').textContent, text: l.textContent, wrap: getComputedStyle(l).whiteSpace })), base: (() => { const b = c.querySelector('.lane-card-base'); return b ? { text: b.textContent, stale: 'stale' in b.dataset, color: getComputedStyle(b).color } : null; })(), maxWidth: getComputedStyle(c).maxWidth }; })()`);
    expect(cfCard.session === cfId('debt') && cfCard.lines.length === 2, `debt's card has two conflict lines (${JSON.stringify(cfCard)})`);
    const liveLine = cfCard.lines.find((l) => l.other === cfId('live'));
    const weekLine = cfCard.lines.find((l) => l.other === cfId('week'));
    expect(liveLine !== undefined && liveLine.name === cfSess.live.name && liveLine.color === rgb(colourOf('live')) && liveLine.filesText === 'g.txt and 2 more' && liveLine.text === `conflicts with ${cfSess.live.name} on g.txt and 2 more`, `the live line names live in its colour with the files cut (${JSON.stringify([liveLine, colourOf('live')])})`);
    expect(weekLine !== undefined && weekLine.name === cfSess.week.name && weekLine.color === rgb(colourOf('week')) && weekLine.filesText === 'f.txt and k.txt', `the week line names week in its colour with both files (${JSON.stringify([weekLine, colourOf('week')])})`);
    expect(cfCard.lines.every((l) => l.wordColor === rgb(cf.error) && l.wrap === 'normal'), `the word conflicts is in --error and the lines wrap (${JSON.stringify(cfCard.lines.map((l) => [l.wordColor, l.wrap]))})`);
    expect(cfCard.base !== null && /^1 ahead, 0 behind main, forked \d+[smhd] ago$/.test(cfCard.base.text) && !cfCard.base.stale && cfCard.base.color === rgb(cf.muted) && cfCard.maxWidth === '290px', `the base line reads 1 ahead, 0 behind main in --muted on a 290px card (${JSON.stringify([cfCard.base, cfCard.maxWidth])})`);
    await cfCloseCard();
    // The row's mark opens the same card, with no commits line since no log sits beside it.
    await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(cfId('week'))}] .sidebar-row-conflict').click()`);
    await s.waitFor(`document.querySelector('.lane-popover')?.dataset.sessionId === ${JSON.stringify(cfId('week'))}`, "the row's mark opens week's card", 5000);
    const cfRowCard = await s.evalJs(`(() => { const c = document.querySelector('.lane-popover'); return { lines: c.querySelectorAll('.lane-card-conflict').length, base: c.querySelector('.lane-card-base')?.textContent ?? null, commits: c.querySelector('.lane-card-commits') !== null, name: c.querySelector('.lane-card-name').textContent }; })()`);
    expect(cfRowCard.lines === 1 && cfRowCard.base !== null && !cfRowCard.commits && cfRowCard.name === cfSess.week.name, `week's card off the row has its one line and its base and no commits line (${JSON.stringify(cfRowCard)})`);
    await cfCloseCard();
    await s.screenshot('fix-320-ties.png');
    // 5: on its side the same three ties run between the two tracks and the two heads' columns.
    await s.evalJs(`document.querySelector('.files-rail .commits-orient').click()`);
    await s.waitFor(`document.querySelector('.files-rail .commits-graph')?.dataset.orientation === 'horizontal'`, 'the rail on its side', 5000);
    await sleep(400);
    const cfSide = await cfGutter();
    expect(cfSide.ties.length === 3 && cfSide.halos.length === 4, `three ties and four halos on its side (${JSON.stringify([cfSide.ties.length, cfSide.halos.length])})`);
    for (const t of cfSide.ties) {
      const from = cfSide.nodes[cfNames.find((n) => cfId(n) === t.from)];
      const to = cfSide.nodes[cfNames.find((n) => cfId(n) === t.to)];
      const ends = t.hit.d.match(/-?[\d.]+/g).map(Number);
      expect(Math.abs(ends[0] - from.cx) < 1 && Math.abs(ends[1] - from.cy) < 1 && Math.abs(ends[2] - to.cx) < 1 && Math.abs(ends[3] - to.cy) < 1 && from.cy !== to.cy, `sideways the tie runs between the two tracks at the two heads' columns (${JSON.stringify([ends, from, to])})`);
    }
    await s.evalJs(`document.querySelector('.files-rail .commits-orient').click()`);
    await s.waitFor(`document.querySelector('.files-rail .commits-graph')?.dataset.orientation === 'vertical'`, 'the rail upright again', 5000);
    // Under load a git here has failed (`add -A` exiting 1 on an LF/CRLF
    // warning alone, M9 fix 451), so each try is repeated up to five times
    // 500 ms apart, with a note when it starts waiting and one when it
    // gets through; the last failure is thrown.
    const gitCPatient = async (...args) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          gitC(...args);
          if (attempt > 1) console.log(`[verify] note: git ${args[0]} got through on try ${attempt}`);
          return;
        } catch (err) {
          if (attempt === 5) throw err;
          if (attempt === 1) console.log(`[verify] note: git ${args[0]} failed (${String(err.message).split('\n')[0]}); trying again`);
          await sleep(500);
        }
      }
    };
    // 8: the base. main moves 39 commits on through the root shell (38 by
    // hand, the 39th credited so the daemon polls), and every lane is 39
    // behind with no figure; the 40th puts the figure beside each stale
    // lane's fork mark in --muted and turns the card's base line --error.
    for (let i = 1; i <= 38; i += 1) {
      writeLines(cfRepo, `main-${i}.txt`, [`main ${i}`]);
      await gitCPatient('add', `main-${i}.txt`);
      await gitCPatient('commit', '-q', '-m', `main ${i}`);
    }
    await commitFiles('main-39', cfRepo, cfMain.id, { 'main-39.txt': ['main 39'] });
    // M9 fix 603: the base is waited for in the daemon's own report, with
    // no card up, and the card is opened once the report holds the number,
    // for the colour and the stale mark. The 75 s wait read the open card's
    // base line before, and a card that had closed read '' for the rest of
    // the wait, the same as a base not yet sent, so a closed card and a late
    // daemon failed alike; a miss now says what the card held (null for no
    // card up) and what the daemon said (null for no base for debt).
    const cfDebtCard = `.lane-popover[data-session-id=${JSON.stringify(cfId('debt'))}]`;
    const cfBaseNow = async () => ({
      card: await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(cfDebtCard)}); return c === null ? null : (c.querySelector('.lane-card-base')?.textContent ?? ''); })()`),
      daemon: (await zreq(s, 'conflicts.get', {})).base[cfId('debt')] ?? null,
    });
    const cfWaitBase = async (expression, what, timeoutMs) => {
      try {
        await s.waitFor(expression, what, timeoutMs, { quietMs: 0 });
      } catch (err) {
        const now = await cfBaseNow();
        throw new Error(`${err.message}; the card held ${JSON.stringify(now.card)}, the daemon said ${JSON.stringify(now.daemon)}`);
      }
    };
    const cfDaemonBehind = (n) => `window.emerald.request('conflicts.get', {}).then((r) => r.base[${JSON.stringify(cfId('debt'))}]?.behind === ${n})`;
    const cfCardBehind = (n) => `/^1 ahead, ${n} behind main/.test(document.querySelector(${JSON.stringify(cfDebtCard + ' .lane-card-base')})?.textContent ?? '')`;
    await cfWaitBase(cfDaemonBehind(39), "the daemon's report has debt 39 behind", 75000);
    await cfHoverCard('debt', "debt's card for the base at 39");
    await cfWaitBase(cfCardBehind(39), "debt's card reads 39 behind", 10000);
    const cf39 = await s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(cfDebtCard + ' .lane-card-base')}); return { text: b.textContent, stale: 'stale' in b.dataset, color: getComputedStyle(b).color, figures: document.querySelectorAll('.files-rail .commits-base-figure').length }; })()`);
    expect(/^1 ahead, 39 behind main/.test(cf39.text) && !cf39.stale && cf39.color === rgb(cf.muted) && cf39.figures === 0, `at 39 behind the line is muted and no figure is drawn (${JSON.stringify(cf39)})`);
    await cfCloseCard();
    await commitFiles('main-40', cfRepo, cfMain.id, { 'main-40.txt': ['main 40'] });
    await cfWaitBase(cfDaemonBehind(40), "the daemon's report has debt 40 behind", 75000);
    await s.waitFor(`document.querySelectorAll('.files-rail .commits-base-figure').length === 5`, 'a figure beside each of the five lanes at 40 behind', 75000);
    const cf40 = await cfGutter();
    expect(cf40.texts.length === 5 && cf40.texts.every((t) => t.text === '40' && t.cls === 'commits-base-figure' && t.fill === rgb(cf.muted)), `five figures reading 40 in --muted (${JSON.stringify(cf40.texts)})`);
    const cfForkOf = (name) => s.evalJs(`(() => { const svg = document.querySelector('.files-rail .commits-graph'); const centre = (el) => el.tagName === 'line' ? { cx: (+el.getAttribute('x1') + +el.getAttribute('x2')) / 2, cy: (+el.getAttribute('y1') + +el.getAttribute('y2')) / 2 } : { cx: +el.getAttribute('cx'), cy: +el.getAttribute('cy') }; const d = [...svg.querySelectorAll('.commits-node[data-session=' + ${JSON.stringify(JSON.stringify(cfId(name)))} + '][data-kind]:not([data-kind="head"])')].map((el) => ({ ...centre(el), kind: el.dataset.kind })).sort((p, q) => q.cy - p.cy)[0]; return d ?? null; })()`);
    const debtFork = await cfForkOf('debt');
    const debtFigure = cf40.texts.find((t) => t.session === cfId('debt'));
    expect(debtFork !== null && debtFigure !== undefined && Math.abs(debtFigure.y - debtFork.cy) < 0.01 && Math.abs(debtFork.cx - 7 - debtFigure.x) < 0.01, `debt's figure sits on its fork mark's row, 7px left of the lane (${JSON.stringify([debtFigure, debtFork])})`);
    await cfHoverCard('debt', "debt's card for the base at 40");
    await cfWaitBase(cfCardBehind(40), "debt's card reads 40 behind", 10000);
    const cf40card = await s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(cfDebtCard + ' .lane-card-base')}); return { text: b.textContent, stale: 'stale' in b.dataset, color: getComputedStyle(b).color }; })()`);
    expect(/^1 ahead, 40 behind main/.test(cf40card.text) && cf40card.stale && cf40card.color === rgb(cf.error), `at 40 behind the card's base line is in --error (${JSON.stringify(cf40card)})`);
    await cfCloseCard();
    await s.screenshot('fix-320-stale.png');
    // 10: the exit. debt killed drops its two ties within one poll and
    // leaves pocket's tie with live, and every commit row, where it was.
    const cfRowsBefore = await s.evalJs(`document.querySelectorAll('.files-rail .commits-graph-rows .commits-row[data-hash]').length`);
    await zreq(s, 'session.kill', { sessionId: cfId('debt') });
    await s.waitFor(`document.querySelectorAll('.files-rail .commits-tie').length === 1`, "debt's ties drop once it has exited", 75000, { quietMs: 0 });
    const cfExit = await cfGutter();
    expect(cfExit.ties.length === 1 && pairKey(cfExit.ties[0]) === [cfId('pocket'), cfId('live')].sort().join('+') && cfExit.halos.length === 2, `the pocket and live tie stays with its two halos (${JSON.stringify(cfExit.ties.map((t) => [t.a, t.b]))})`);
    expect((await s.evalJs(`document.querySelectorAll('.files-rail .commits-graph-rows .commits-row[data-hash]').length`)) === cfRowsBefore, 'every commit row is where it was');
    const cfMarksExit = await cfRows();
    expect(cfMarksExit.debt === null && cfMarksExit.week === null && cfMarksExit.live?.count === '1' && cfMarksExit.pocket?.count === '1', `debt's and week's marks are gone, live's reads 1 (${JSON.stringify(Object.fromEntries(Object.entries(cfMarksExit).map(([k, v]) => [k, v?.count ?? null])))})`);
    // 9: clearing. pocket puts line 1 back, its merge with live applies
    // clean, and the next poll drops the last tie, its halos, the marks
    // and the lines with no transition left behind.
    await commitFiles('pocket-back', cfDirs.pocket, cfSess.pocket.id, { 'f.txt': twenty });
    await s.waitFor(`document.querySelectorAll('.files-rail .commits-tie, .files-rail .commits-tie-hit, .files-rail .commits-tie-halo').length === 0`, 'the last tie clears once the pair merges clean', 75000, { quietMs: 0 });
    const cfClear = await cfGutter();
    const cfMarksClear = await cfRows();
    expect(cfClear.ties.length === 0 && cfClear.halos.length === 0 && Object.values(cfMarksClear).every((m) => m === null), `zero ties, halos and row marks after the clearing poll (${JSON.stringify(cfMarksClear)})`);
    expect((await s.evalJs(`[...document.querySelectorAll('.files-rail .commits-graph [class^="commits-tie"], .files-rail .commits-graph .commits-base-figure')].filter((el) => getComputedStyle(el).opacity === '0' || getComputedStyle(el).transitionDuration !== '0s').length`)) === 0, 'nothing of the forecast is left at zero opacity or mid transition');
    // 12: nothing else moved: the lane widths, the dot radii, the row heights and the slab are what they were with the ties on.
    expect(cfClear.edgeWidths.join(',') === cf40.edgeWidths.join(',') && cfClear.radii.join(',') === cf40.radii.join(',') && cfClear.rowHeights.join(',') === cf40.rowHeights.join(','), `the lane widths, radii and row heights are the same with the forecast on and off (${JSON.stringify([cf40.edgeWidths, cfClear.edgeWidths, cf40.radii, cfClear.radii, cf40.rowHeights, cfClear.rowHeights])})`);
    // The pane hidden, so the focus and the rail go back where they were.
    await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(cfPane)}] .pane-hide').click()`);
    await s.waitFor(`document.querySelector('.pane.focused')?.dataset.paneId === ${JSON.stringify(cfPaneBefore)}`, 'the pane before is focused again', 10000);
    step("M9 fix 320: the conflict forecast's ties run between the paired lanes' newest nodes under the lanes with a dotted halo on each end, one per pair with no count on the graph, the rows count pairs, the card names the other lane in its colour with the files cut to `and N more` and the base line under it, the figure appears beside the fork mark at forty behind, a killed session's ties drop and a clean merge clears the last, with nothing else on the graph moved");
  });

  await block('fix-352', async () => {
    // M9 fixes 352 to 354: the rail's usage store asks and publishes only
    // on a real change. The counters on window.emeraldUsageStats read
    // unchanged over two poll cycles (fix 354's stamp hands the panel the
    // held graph object, fix 352's effect keys on the records), then one
    // commit through the card session's hooks re-asks each conversation
    // the records name once and publishes a few times, never the old two
    // per conversation. The rail is on the card session's repository
    // after the fix 320 step put its pane back. The count expected is
    // the same walk the panel's effect makes, over session.list with the
    // removed ones (the M57 worker's record still names a conversation).
    await s.waitFor(`document.querySelector('.files-rail .commits-panel')?.dataset.folder === ${JSON.stringify(cgRepo)}`, 'the rail is back on the card repository', 10000);
    const statsJs = `(() => ({ ...window.emeraldUsageStats }))()`;
    const conversationsJs = `(async () => { const r = await window.emerald.request('session.list', { removed: true }); const set = new Set(); for (const sess of r.sessions) { const commits = [...(sess.commits ?? []), ...(sess.team ?? []).flatMap((m) => m.commits ?? [])]; for (const c of commits) { let found = null; for (const span of sess.spans ?? []) if (span.startedAt <= c.at) found = span.conversation; const conv = found ?? sess.conversation?.id ?? null; if (conv !== null) set.add(conv); } } return set.size; })()`;
    await sleep(2000);
    const usQuiet0 = await s.evalJs(statsJs);
    await sleep(11000);
    const usQuiet1 = await s.evalJs(statsJs);
    expect(usQuiet1.asks === usQuiet0.asks && usQuiet1.publishes === usQuiet0.publishes, `two poll cycles with no change ask nothing and publish nothing (${JSON.stringify([usQuiet0, usQuiet1])})`);
    const usAsked = await s.evalJs(conversationsJs);
    const usHash = await commitVia(cgSess.id, gitCg, 'CG2', cgRepo);
    await s.waitFor(`!!document.querySelector('.files-rail .commits-graph-rows .commits-row[data-hash=${JSON.stringify(usHash)}]')`, 'CG2 has its row', 10000);
    await sleep(1500);
    const usAfter = await s.evalJs(statsJs);
    const dAsks = usAfter.asks - usQuiet1.asks;
    const dPub = usAfter.publishes - usQuiet1.publishes;
    expect(dAsks === usAsked, `a commit re-asks each of the ${usAsked} conversations the records name once (${dAsks})`);
    expect(dPub >= 1 && dPub <= Math.max(3, Math.ceil(usAsked / 2)), `the re-ask publishes once for the asks and once or twice for the landings, never twice per conversation (${dPub} for ${usAsked})`);
    step(`M9 fixes 352 and 354: with the rail on the timeline two poll cycles ask and publish nothing, and a commit re-asks the ${usAsked} conversations once with ${dPub} publishes`);
  });
  await block('fix-353', async () => {
    // M9 fix 353: the renderer's busy share with the rail on the timeline
    // and this run's rows, sampled twice for 12 s and the lower taken. The
    // storm this fix ends read 65 to 70% of a core with the rail on the
    // timeline. The bar is 45% (M9 fix 663): twice the higher of two quiet
    // --only fix-353 runs on 2026-10-14, 21.4% and 22.0%, each holding
    // every verify slot with no other harness up, rounded up to the next
    // 5%. It is judged only under --only fix-353: a whole run passes 480 s
    // before it gets here (every one since fixes 450 to 493), so a whole
    // run prints the share and never judges it, and an --only run past
    // 480 s prints it and does not judge it either. The twenty-session
    // reading of fix 663 is in docs/DONE.md (M9 fix 663).
    const bar = 0.45;
    const elapsed = (Date.now() - scriptStartedAt) / 1000;
    const busyA = await busyProfile(s, 12000);
    const busyB = await busyProfile(s, 12000);
    const busy = busyA.share <= busyB.share ? busyA : busyB;
    const share = busy.share;
    const pct = Math.round(share * 1000) / 10;
    const live = (await zreq(s, 'session.list', {})).sessions.filter((x) => x.state !== 'exited').length;
    // What was busy, for the log's reader, whatever the verdict.
    console.log(`[verify] busy share ${pct}% over ${busy.totalMs} ms, ${live} live sessions; top frames: ${busy.top.map((x) => `${x.frame} ${x.ms}ms`).join(', ')}`);
    if (!partial) {
      console.log(`[verify] busy share ${pct}% (not judged in a whole run; judged under --only fix-353)`);
    } else if (elapsed > 480) {
      console.log(`[verify] busy share ${pct}% (not judged, loaded box: ${Math.round(elapsed)} s in)`);
    } else {
      expect(share < bar, `the renderer's busy share with the rail on the timeline is under ${Math.round(bar * 100)}% (${pct}% at ${Math.round(elapsed)} s, ${live} live sessions)`);
    }
    step(`M9 fix 353: the commit rows remember their price; the renderer's busy share with the rail on the timeline reads ${pct}%`);
  });

  step(blocksRun());
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m51-graph-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  try {
    fs.rmSync(openWt, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    if (agentWt !== null) fs.rmSync(agentWt, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(path.join(os.tmpdir(), 'emerald-verify', `m51-mb-${process.pid}`), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    for (const dir of fixDirs) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(path.join(os.tmpdir(), 'emerald-verify', `m51-colours-${process.pid}`), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(path.join(os.tmpdir(), 'emerald-verify', `m51-other-${process.pid}`), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(path.join(os.tmpdir(), 'emerald-verify', `m51-bars-${process.pid}`), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(path.join(os.tmpdir(), 'emerald-verify', `m51-bars-x-${process.pid}`), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(path.join(os.tmpdir(), 'emerald-verify', `m51-bars-ff-${process.pid}`), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(claudeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    fs.rmSync(path.join(os.tmpdir(), 'emerald-verify', `m51-remote-${process.pid}`), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Left for the next run.
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
