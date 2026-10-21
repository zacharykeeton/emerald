// M19 acceptance: the Sessions panel (History before M9 fix 83) in the files rail. The main process
// is pointed at a seeded Claude home (EMERALD_CLAUDE_HOME) holding four
// transcripts in three project folders and a matching history.jsonl, so
// nothing here reads the real ~/.claude. Checks the tab row (its words
// since M9 fix 45, Sessions with the star since fix 83, fitting the
// narrowest rail), the groups
// and their counts with every project listed, the row titles, previews, counts,
// times and models, the search, a history line appended bumping a count,
// a collapsed group, the folds following the focused pane (M9 fix 84)
// and surviving a rail collapse (fix 417),
// Open transcript as a read-only tab (fix 85), Resume starting a Claude
// session with --resume in
// the seeded folder and the row turning live once the id is bound, a
// missing folder greying Resume, and the rail tab across a reload. Uses
// a private home and pipe unless the environment already names them.
// Run: npm run verify:history -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatUsd } from '@emerald/shared';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm19-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m19';
const { CTRL, expect, freshPort, getLayout, hoverForCard, killTree, launch, sleep, startSession, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 120 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 120000);

// The seeded folders: a repository with a subfolder, and a second folder
// outside it. Resolved to the long form the shell will report.
const wsShort = path.join(os.tmpdir(), 'emerald-verify', `m19-ws-${process.pid}`);
fs.rmSync(wsShort, { recursive: true, force: true });
fs.mkdirSync(path.join(wsShort, 'repo', '.git'), { recursive: true });
fs.mkdirSync(path.join(wsShort, 'repo', 'sub'), { recursive: true });
fs.mkdirSync(path.join(wsShort, 'other'), { recursive: true });
const ws = fs.realpathSync.native(wsShort);
const repo = path.join(ws, 'repo');
const sub = path.join(repo, 'sub');
const other = path.join(ws, 'other');
const gone = path.join(ws, 'gone');

// The seeded Claude home, in the shapes Claude Code writes (see
// history-model.ts). Four sessions: A1 in the repo with an ai-title and a
// reply last, A2 in its subfolder with no title and no history lines, B1
// in the other folder (an ai-title, then two /renames, M9 fix 954), and G1
// whose folder does not exist (no title, opening on a /model, fix 954).
const claudeHome = path.join(os.tmpdir(), 'emerald-verify', `m19-claude-${process.pid}`);
fs.rmSync(claudeHome, { recursive: true, force: true });
const encode = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
const NOW = Date.now();
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const line = (o) => `${JSON.stringify(o)}\n`;
const user = (text, at, cwd, extra = {}) => line({ type: 'user', message: { role: 'user', content: text }, cwd, gitBranch: 'main', timestamp: iso(at), ...extra });
// usage (M9 fix 256): the request's counts, on a reply whose transcript
// is to be priced; a reply without one is a request the reader skips.
let msgN = 0;
const reply = (text, at, cwd, model, usage = null) => line({ type: 'assistant', message: { role: 'assistant', model, content: [{ type: 'text', text }], ...(usage === null ? {} : { id: `msg_${msgN++}`, usage }) }, cwd, timestamp: iso(at) });
// A1's two requests on Opus 5: 10 fresh at $5/M, 4000 cache reads at
// $0.5/M and 100 out at $25/M, then 5 fresh, 2000 cache writes at
// $10/M (a 1-hour write, M9 fix 278) and 20000 out, which the row
// prices as our estimate.
const A1_OWN_USD = (10 / 1e6) * 5 + (4000 / 1e6) * 0.5 + (100 / 1e6) * 25 + (5 / 1e6) * 5 + (2000 / 1e6) * 10 + (20000 / 1e6) * 25;
// A1's subagent (M9 fix 273), one request off its own file under the
// conversation's subagents folder: 20 fresh, 10000 cache reads and 1000
// out, which the row's estimate adds in and the unfolded row names.
const A1_AGENT_USD = (20 / 1e6) * 5 + (10000 / 1e6) * 0.5 + (1000 / 1e6) * 25;
const A1_USD = A1_OWN_USD + A1_AGENT_USD;
// A tool-call line (M53): an Edit and a committing Bash, no text.
const tools = (at, cwd, model) =>
  line({
    type: 'assistant',
    message: { role: 'assistant', model, content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: path.join(repo, 'src', 'tabs.ts'), old_string: 'a', new_string: 'b' } }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'git commit -am "tabs"' } }] },
    cwd,
    timestamp: iso(at),
  });
const A1 = 'a1a1a1a1-0000-4000-8000-000000000001';
const A2 = 'a2a2a2a2-0000-4000-8000-000000000002';
const B1 = 'b1b1b1b1-0000-4000-8000-000000000003';
const G1 = 'c1c1c1c1-0000-4000-8000-000000000004';
const transcripts = {
  [A1]: {
    cwd: repo,
    text:
      line({ type: 'ai-title', aiTitle: 'Fix the tabs', sessionId: A1 }) +
      user('the tabs are broken', NOW - 25 * HOUR, repo) +
      reply('Looking.', NOW - 25 * HOUR + 1000, repo, 'claude-opus-5', { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 4000, output_tokens: 100 }) +
      tools(NOW - 25 * HOUR + 6 * 60_000, repo, 'claude-opus-5') +
      // A little more than a day ago, so the row says 1d however soon
      // after NOW the launcher reaches it (a reply a second short of the
      // day read 23h on a fast launch).
      user('now fix them', NOW - 24 * HOUR - 2000, repo) +
      reply('Two files changed.\nThe tests pass.', NOW - 24 * HOUR - 1000, repo, 'claude-opus-5', { input_tokens: 5, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0, output_tokens: 20000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2000 } }),
  },
  [A2]: {
    cwd: sub,
    text:
      user('add a files rail on the right', NOW - 3 * HOUR, sub) +
      reply('Done.', NOW - 3 * HOUR + 1000, sub, 'claude-fable-5-1') +
      user('and a filter', NOW - 2.5 * HOUR, sub) +
      reply('Added.', NOW - 2.5 * HOUR + 1000, sub, 'claude-fable-5-1') +
      user('now the filter should skip node_modules', NOW - 2 * HOUR - 3000, sub) +
      // Past the scan's 4 MB count cap (M9 fix 97): filler lines the
      // count and the turns both skip, then two more prompts the folded
      // row does not know about and the unfolded row and the tab do.
      line({ type: 'progress', pad: 'x'.repeat(2048) }).repeat(2200) +
      user('and hide dist', NOW - 2 * HOUR - 2000, sub) +
      // A reply past the filler too, so the tail still names the model.
      reply('Hidden.', NOW - 2 * HOUR - 1500, sub, 'claude-fable-5-1') +
      user('and .git', NOW - 2 * HOUR - 1000, sub),
  },
  [B1]: {
    cwd: other,
    text: line({ type: 'ai-title', aiTitle: 'Other project notes', sessionId: B1 }) + user('summarise the notes', NOW - 50 * HOUR, other) + reply('Here they are.', NOW - 50 * HOUR + 1000, other, 'claude-opus-5') +
      // A bash-mode run after the reply (M9 fix 955): its input, its output, Claude's answer.
      user('<bash-input>type notes.md</bash-input>', NOW - 50 * HOUR + 60_000, other) +
      user('<bash-stdout>the notes</bash-stdout><bash-stderr></bash-stderr>', NOW - 50 * HOUR + 62_000, other) +
      reply('It printed the notes.', NOW - 50 * HOUR + 64_000, other, 'claude-opus-5') +
      line({ type: 'custom-title', customTitle: 'Notes, first try', sessionId: B1 }) + line({ type: 'custom-title', customTitle: 'Notes from the other project', sessionId: B1 }),
  },
  [G1]: {
    cwd: gone,
    text:
      user('<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>opus</command-args>', NOW - 80 * HOUR - 5000, gone) +
      user('<local-command-stdout>Set model to Opus 5</local-command-stdout>', NOW - 80 * HOUR - 4900, gone) +
      user('<local-command-caveat>Caveat: the messages below were generated by the user while running local commands.</local-command-caveat>', NOW - 80 * HOUR - 4900, gone, { isMeta: true }) +
      user('hello', NOW - 80 * HOUR, gone) + reply('Hi.', NOW - 80 * HOUR + 1000, gone, 'claude-opus-5'),
  },
};
for (const [id, t] of Object.entries(transcripts)) {
  const dir = path.join(claudeHome, 'projects', encode(t.cwd));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), t.text);
}
// A subagent transcript, which must not list as a session.
fs.mkdirSync(path.join(claudeHome, 'projects', encode(repo), A1), { recursive: true });
fs.writeFileSync(path.join(claudeHome, 'projects', encode(repo), A1, 'agent-1.jsonl'), user('subagent work', NOW, repo));
// A1's agent file where Claude Code keeps them (M9 fix 273), whose one
// request joins the row's estimate.
fs.mkdirSync(path.join(claudeHome, 'projects', encode(repo), A1, 'subagents'), { recursive: true });
fs.writeFileSync(
  path.join(claudeHome, 'projects', encode(repo), A1, 'subagents', 'agent-a1.jsonl'),
  line({ type: 'assistant', isSidechain: true, agentId: 'a1', message: { role: 'assistant', model: 'claude-opus-5', id: 'msg_agent_a1', content: [{ type: 'text', text: 'Read the tabs.' }], usage: { input_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 10000, output_tokens: 1000 } }, cwd: repo, timestamp: iso(NOW - 25 * HOUR + 2000) }),
);
const historyFile = path.join(claudeHome, 'history.jsonl');
const history = (display, timestamp, project, sessionId) => line({ display, pastedContents: {}, timestamp, project, sessionId });
fs.writeFileSync(
  historyFile,
  history('the tabs are broken', NOW - 25 * HOUR, repo, A1) +
    history('now fix them', NOW - 24 * HOUR, repo, A1) +
    history('summarise the notes', NOW - 50 * HOUR, other, B1) +
    history('/model opus', NOW - 80 * HOUR - 5000, gone, G1) +
    history('hello', NOW - 80 * HOUR, gone, G1),
);
process.env['EMERALD_CLAUDE_HOME'] = claudeHome;

const rowSel = (id) => `.history-row[data-id=${JSON.stringify(id)}]`;
const rows = (s) => s.evalJs(`[...document.querySelectorAll('.history-row')].map(r => r.dataset.id)`);
const groups = (s) => s.evalJs(`[...document.querySelectorAll('.history-group')].map(g => g.querySelector('.history-group-name').textContent + ':' + g.querySelector('.history-group-count').textContent)`);
const count = (s) => s.evalJs(`document.querySelector('.history-count')?.textContent ?? null`);
const folds = (s) => s.evalJs(`[...document.querySelectorAll('.history-group')].map(g => g.querySelector('.history-group-name').textContent + ':' + (g.dataset.collapsed ? 'folded' : 'open'))`);
const openAll = (s) => s.evalJs(`[...document.querySelectorAll('.history-group[data-collapsed] .history-group-header')].forEach(h => h.click())`);
// A group by the name its header shows, and the whole fold reading as
// one string, for the M9 fix 417 steps that wait on a fold rather than
// reading it once.
const groupHeader = (name) => `[...document.querySelectorAll('.history-group')].find((g) => g.querySelector('.history-group-name').textContent === ${JSON.stringify(name)}).querySelector('.history-group-header')`;
const foldsAre = (want) => `[...document.querySelectorAll('.history-group')].map(g => g.querySelector('.history-group-name').textContent + ':' + (g.dataset.collapsed ? 'folded' : 'open')).join(',') === ${JSON.stringify(want)}`;
const rowPart = (s, id, cls) => s.evalJs(`document.querySelector(${JSON.stringify(`${rowSel(id)} .${cls}`)})?.textContent ?? null`);
const rowFacts = (s, id) => rowPart(s, id, 'history-row-facts');
const setSearch = (s, text) =>
  s.evalJs(
    `(() => { const el = document.querySelector('.history-search input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
  );

const s = await launch(freshPort(), { freshState: true });
app = s;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  expect(await s.evalJs(`document.querySelector('.files-rail')?.dataset.tab`) === 'files', 'the rail starts on the tree');
  expect(await s.evalJs(`!!document.querySelector('.rail-tab[data-tab="history"]')`), 'the Sessions tab is in the tab row');
  // M9 fix 83: the tab reads Sessions and its icon is the star the rows
  // draw, in the strip's colour rather than the rows' orange.
  const sessionsTab = await s.evalJs(
    `(() => { const t = document.querySelector('.rail-tab[data-tab="history"]'); const icon = t.querySelector('svg.files-icon'); return { paths: icon ? icon.querySelectorAll('path').length : 0, d: icon?.querySelector('path')?.getAttribute('d') ?? null, color: icon ? getComputedStyle(icon).color : null, tabColor: getComputedStyle(t).color }; })()`,
  );
  expect(sessionsTab.paths === 1 && sessionsTab.d?.startsWith('M8 1.5v13M1.5 8h13'), `the tab's icon is the eight-spoke star, got ${JSON.stringify(sessionsTab)}`);
  expect(sessionsTab.color === sessionsTab.tabColor, `the star takes the tab's colour, got ${sessionsTab.color} against ${sessionsTab.tabColor}`);
  // M9 fix 45: the tabs carry their words, and the row fits beside the
  // chevron so it never overflows. Since M45 there are Timeline and
  // Sessions beside Files (the Changes tab folded into Files by fix 70),
  // and at the default 260px rail all three show their words
  // (verify:files reads the strip at every width); the tooltips keep
  // every word.
  const railTabs = await s.evalJs(
    `(() => { const tabs = [...document.querySelectorAll('.rail-tab')]; const row = document.querySelector('.rail-tabs'); const shown = (t) => { const l = t.querySelector('.rail-tab-label'); return getComputedStyle(l).display !== 'none' ? l.textContent : ''; }; return { words: tabs.map(shown), titles: tabs.map((t) => t.title), fits: row.scrollWidth <= row.clientWidth, width: row.clientWidth }; })()`,
  );
  // M9 fix 885: the default rail is RAIL_DEFAULT_WIDTH and shows four
  // words, Stats added; its title names the folder when the rail is on one.
  const railRoot885 = await s.evalJs(`document.querySelector('.files-rail').dataset.root ?? ''`);
  const statsTitle885 = railRoot885 === '' ? 'Statistics' : railTabs.titles[3];
  expect(railTabs.words.join(',') === 'Files,Activity,Sessions,Stats', `at the default rail the four tabs show their words (fix 885), got ${railTabs.words.join(',')}`);
  expect(
    railTabs.titles.join(',') === `Files,What the sessions did: the day's time above, the repository's commits below,Sessions of Claude Code on this machine,${statsTitle885}` && (railRoot885 !== '' ? railTabs.titles[3].startsWith('Statistics of ') : true),
    `the tooltips keep their words, got ${railTabs.titles.join(',')} (root ${JSON.stringify(railRoot885)})`,
  );
  expect(railTabs.fits, `the tab row fits the ${railTabs.width}px rail`);
  await startSession(s, { kind: 'shell', cwd: repo });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell in the repo');
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)}`, 'the tree follows the shell');

  await s.evalJs(`document.querySelector('.rail-tab[data-tab="history"]').click()`);
  await s.waitFor(`!!document.querySelector('.history-panel') && document.querySelectorAll('.history-row').length > 0`, 'the panel with rows');
  expect(await s.evalJs(`document.querySelector('.files-rail')?.dataset.tab`) === 'history', 'the rail says it is on Sessions');
  expect(await s.evalJs(`document.querySelector('.rail-tab[data-tab="history"]').dataset.active`) === 'true', 'the Sessions tab is marked active');
  expect((await s.evalJs(`document.querySelector('.history-title')?.textContent`)) === 'Sessions', 'the panel heading reads Sessions');
  expect((await s.evalJs(`document.querySelector('.history-search input')?.placeholder`)) === 'Search sessions', 'the search box keeps its placeholder');
  expect(await s.evalJs(`!document.querySelector('.files-list')`), 'the tree is not showing');
  // M9 fix 72: no scope buttons; every project is listed under its own
  // heading, newest first, and the search is the one way to narrow.
  expect(!(await s.evalJs(`document.querySelector('.history-scope')`)), 'the panel has no scope row');
  expect(!(await s.evalJs(`'scope' in document.querySelector('.history-panel').dataset`)), 'the panel carries no scope');
  // M9 fix 84: the panel opens folded to the focused pane's project, the
  // shell in the repo, so only the repo group's rows show; the others are
  // opened by hand for the reads below.
  await s.waitFor(`document.querySelectorAll('.history-group').length === 3 && document.querySelectorAll('.history-row').length === 2`, 'the repo group open and the other two folded');
  expect((await folds(s)).join(',') === 'repo:open,other:folded,gone:folded', `every group but the focused pane's folds, got ${await folds(s)}`);
  await openAll(s);
  await s.waitFor(`document.querySelectorAll('.history-row').length === 4`, 'four rows, every project');
  expect((await rows(s)).join(',') === `${A2},${A1},${B1},${G1}`, `every session, newest first: ${await rows(s)}`);
  expect((await groups(s)).join(',') === 'repo:2,other:1,gone:1', `three groups in order of their newest row: ${await groups(s)}`);
  expect((await count(s)) === '4 shown · 4 recent', `the header counts: ${await count(s)}`);
  expect((await rowPart(s, A1, 'history-row-title')) === 'Fix the tabs', 'A1 is titled by its ai-title');
  expect((await rowPart(s, A1, 'history-row-preview')) === 'Agent: Two files changed.', `A1 previews the reply's first line: ${await rowPart(s, A1, 'history-row-preview')}`);
  // The price lands after the row (M9 fix 256), so the facts are waited
  // for whole.
  await s.waitFor(`(document.querySelector(${JSON.stringify(`${rowSel(A1)} .history-row-facts`)})?.textContent ?? '').endsWith(${JSON.stringify(`~${formatUsd(A1_USD)}`)})`, "A1's estimate on its facts line", 5000);
  expect((await rowFacts(s, A1)) === `2 prompts · 1d ago · claude-opus-5 · ~${formatUsd(A1_USD)}`, `A1's facts from history.jsonl and the tail, its price last: ${await rowFacts(s, A1)}`);
  const a1Cost = await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(`${rowSel(A1)} .history-row-cost`)}); return c ? { estimate: 'estimate' in c.dataset, title: c.title, color: getComputedStyle(c).color } : null; })()`);
  const costToken = await s.evalJs(`getComputedStyle(document.documentElement).getPropertyValue('--cost').trim()`);
  expect(a1Cost !== null && a1Cost.estimate && a1Cost.title === 'an estimate from our rate table, subagents included' && a1Cost.color === `rgb(${parseInt(costToken.slice(1, 3), 16)}, ${parseInt(costToken.slice(3, 5), 16)}, ${parseInt(costToken.slice(5, 7), 16)})`, `the figure is marked as an estimate in --cost (${JSON.stringify(a1Cost)})`);
  expect((await rowPart(s, A1, 'history-row-action')) === 'Resume', 'a session nobody is running says Resume');
  expect((await rowPart(s, A2, 'history-row-title')) === 'add a files rail on the right', 'A2 with no ai-title is titled by its first prompt');
  expect((await rowPart(s, B1, 'history-row-title')) === 'Notes from the other project', 'B1 is titled by its last /rename, over its ai-title (fix 954)');
  expect((await rowPart(s, G1, 'history-row-title')) === 'hello', 'G1 is titled by its first ask, past its /model (fix 954)');
  // M73 task 4: the row's title opens its card (the folder, branch, model,
  // prompts, times and file the row's tooltip carried), and neither the
  // row nor its title carries a title attribute.
  expect((await s.evalJs(`[document.querySelector(${JSON.stringify(rowSel(A1))}), document.querySelector(${JSON.stringify(`${rowSel(A1)} .history-row-title`)})].every((el) => el.getAttribute('title') === null)`)), 'the row and its title carry no tooltip; the card is the tooltip (M73)');
  // M9 fix 428: the row settled first and the hover tried twice, since
  // a row that moves under the pointer before the card's 400 ms timer
  // fires clears it (the load flake of this step, fix 391's shape).
  const a1CardSel = `.history-row-popover[data-id=${JSON.stringify(A1)}]`;
  const a1TitleAt = await hoverForCard(s, `${rowSel(A1)} .history-row-title`, a1CardSel, "A1's title opens its card on hover");
  const a1Card = await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(a1CardSel)}); const part = (p) => c.querySelector('[data-part=' + JSON.stringify(p) + '] .sweep-card-text')?.textContent ?? null; return { heading: c.querySelector('.sweep-card-heading').textContent, folder: part('folder'), branch: part('branch'), model: part('model'), prompts: part('prompts'), started: part('started'), path: part('path') }; })()`);
  expect(a1Card.heading === 'Fix the tabs' && a1Card.model === 'claude-opus-5' && a1Card.prompts === '2' && a1Card.started !== null && /\.jsonl$/.test(a1Card.path ?? ''), `the card carries the title, model, prompt count, start time and file, got ${JSON.stringify(a1Card)}`);
  expect(a1Card.folder !== null && a1Card.folder.toLowerCase() === repo.toLowerCase(), `the card names the folder in full, got ${JSON.stringify(a1Card.folder)} for ${repo}`);
  await s.click(a1TitleAt.x, a1TitleAt.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(`${rowSel(A1)} .history-row-title`)}).dataset.popoverOpen === 'pinned'`, 'a click on the title pins the card');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(A1))}).dataset.unfolded ?? null`)) === null, 'and does not unfold the row');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector(${JSON.stringify(a1CardSel)})`, 'Escape closes the card');
  step("M73 task 4: a history row's title opens its card with the folder, model, prompts, start and file; a click pins it without unfolding the row; no title attribute on the row");
  expect((await rowPart(s, A2, 'history-row-preview')) === 'You: and .git', `A2 previews the prompt that ended it: ${await rowPart(s, A2, 'history-row-preview')}`);
  expect((await rowFacts(s, A2)) === '3 prompts · 2h ago · claude-fable-5-1', `A2 with no history lines is counted from the first 4 MB of its transcript: ${await rowFacts(s, A2)}`);
  expect((await rowFacts(s, B1)) === '1 prompt · 2d ago · claude-opus-5', `B1's facts, no price on a transcript with no requests: ${await rowFacts(s, B1)}`);
  expect(await s.evalJs(`document.querySelector(${JSON.stringify(`${rowSel(G1)} .history-row-action`)}).disabled`), 'Resume is greyed for a folder that is gone');
  expect(!(await s.evalJs(`document.querySelector(${JSON.stringify(`${rowSel(B1)} .history-row-action`)}).disabled`)), 'Resume is live for a folder that exists');
  step('Sessions panel: three groups with counts and every project listed, the titles, previews and facts, the subagent transcript not listed, Resume greyed for the gone folder');

  await setSearch(s, 'RAIL');
  await s.waitFor(`document.querySelectorAll('.history-row').length === 1`, 'the search narrowing to one row');
  expect((await rows(s)).join(',') === A2, `the search found A2 by its title: ${await rows(s)}`);
  await setSearch(s, 'opus other');
  await s.waitFor(`document.querySelectorAll('.history-row').length === 1 && document.querySelector('.history-row').dataset.id === ${JSON.stringify(B1)}`, 'every word must match');
  await setSearch(s, 'nothing-like-this');
  await s.waitFor(`document.querySelector('.history-list .files-empty')?.textContent === 'No matching sessions'`, 'the empty text for a search with no hits');
  await setSearch(s, '');
  await s.waitFor(`document.querySelectorAll('.history-row').length === 4`, 'the search cleared');
  step('the search box: by title, every word, no hits, cleared');

  // M9 fix 336: the × sits inside its own box, not over the rail's
  // collapse button, since the input and the × are now wrapped in
  // .files-filter-box as the files tab's FilterBox wraps them.
  // M9 fix 417: the folds are ui.ts's now, so this block puts them back
  // in the fix 84 shape by hand (the focused pane's repo group open, the
  // other two folded) and reads that shape back after the collapse.
  await s.evalJs(`${groupHeader('other')}.click()`);
  await s.evalJs(`${groupHeader('gone')}.click()`);
  await s.waitFor(foldsAre('repo:open,other:folded,gone:folded'), 'the other two groups folded by hand, the fix 84 shape again');
  await setSearch(s, 'RAIL');
  await s.waitFor(`document.querySelectorAll('.history-row').length === 1`, 'the search narrowed again');
  // A DOMRect's fields are accessors on its prototype, not own properties,
  // so returning one through evalJs serializes to {}; each is spread into
  // a plain object first, as every other rect read in this repo does.
  const rects = await s.evalJs(
    `(() => { const plain = (r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }); const box = plain(document.querySelector('.history-search .files-filter-box').getBoundingClientRect()); const clear = plain(document.querySelector('.history-search .files-filter-clear').getBoundingClientRect()); const collapse = plain(document.querySelector('.files-collapse').getBoundingClientRect()); return { box, clear, collapse }; })()`,
  );
  const inside = rects.clear.left >= rects.box.left && rects.clear.right <= rects.box.right && rects.clear.top >= rects.box.top && rects.clear.bottom <= rects.box.bottom;
  expect(inside, `the × sits inside the search box, got ${JSON.stringify(rects.clear)} against ${JSON.stringify(rects.box)}`);
  const clearOfCollapse = rects.clear.right <= rects.collapse.left || rects.clear.left >= rects.collapse.right || rects.clear.bottom <= rects.collapse.top || rects.clear.top >= rects.collapse.bottom;
  expect(clearOfCollapse, `the × does not overlap the collapse button, got ${JSON.stringify(rects.clear)} against ${JSON.stringify(rects.collapse)}`);
  await s.evalJs(`document.querySelector('.files-collapse').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail-collapsed')`, 'the collapse button still hides the rail');
  await s.evalJs(`document.querySelector('.files-rail-label').click()`);
  // M9 fix 367: collapsing still unmounts FilesRail whole (the early `if
  // (filesCollapsed) return ...` in FilesRail.tsx), but the search text
  // now lives in ui.ts beside the rail's own search settings, so it and
  // the rows it narrowed ride across the remount; since M9 fix 417 the
  // folds live there too and ride across it as well.
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'history' && document.querySelectorAll('.history-row').length > 0`, 'the label brings the rail back on the Sessions tab');
  expect((await s.evalJs(`document.querySelector('.history-search input')?.value`)) === 'RAIL', 'the search box keeps its text across the collapse, not fresh as before fix 367');
  expect((await rows(s)).join(',') === A2, `the rows stay narrowed to the same search across the collapse: ${await rows(s)}`);
  await setSearch(s, '');
  // M9 fix 417: the folds the collapse was left with come back whole,
  // read once the search clears and all three groups are drawn again.
  // The fix 393 finding was the old shape of this read: the fold effect
  // fired again on the remount (hasScan false to true) and read a group
  // list the search had narrowed to one, decided there was nothing to
  // fold, and left the other two open. The effect now folds for the
  // window's first scan and for a focus change only, so a remount
  // leaves the folds where they were.
  await s.waitFor(foldsAre('repo:open,other:folded,gone:folded'), 'the folds ride across the rail collapse, the shape they were left in');
  step("the History search's × sits in its own box, clear of the rail's collapse button, which still works beside it; M9 fix 367: the search text and its narrowed rows survive a rail collapse; M9 fix 417: so do the folds");

  // M9 fix 417 again: a group opened by hand is still open after a
  // second collapse, which is what the folds living in ui.ts is for.
  await s.evalJs(`${groupHeader('other')}.click()`);
  await s.waitFor(foldsAre('repo:open,other:open,gone:folded'), 'the other group opened by hand');
  await s.evalJs(`document.querySelector('.files-collapse').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail-collapsed')`, 'the rail hidden a second time');
  await s.evalJs(`document.querySelector('.files-rail-label').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'history' && document.querySelectorAll('.history-row').length > 0`, 'the rail back a second time');
  await s.waitFor(foldsAre('repo:open,other:open,gone:folded'), 'the hand-opened group is still open after the second collapse');
  step('M9 fix 417: a fold opened by hand survives a rail collapse');
  await openAll(s);
  await s.waitFor(`document.querySelectorAll('.history-row').length === 4`, 'every row shown, unfiltered');

  fs.appendFileSync(historyFile, history('one more', NOW, repo, A1));
  await s.waitFor(`(document.querySelector(${JSON.stringify(`${rowSel(A1)} .history-row-facts`)})?.textContent ?? '').startsWith('3 prompts')`, 'the appended prompt counted', 4000);
  expect((await rows(s))[0] === A1, 'the newest prompt moved A1 to the top');
  step('a line appended to history.jsonl bumped the count without a click');

  // A backslash in an attribute selector is an escape, so the group is
  // found by its dataset instead.
  const repoGroup = `[...document.querySelectorAll('.history-group')].find(g => g.dataset.project === ${JSON.stringify(repo)})`;
  await s.evalJs(`${repoGroup}.querySelector('.history-group-header').click()`);
  await s.waitFor(`document.querySelectorAll('.history-row').length === 2`, 'the repo group collapsed');
  expect(await s.evalJs(`${repoGroup}.dataset.collapsed`) === 'true', 'the group says it is collapsed');
  await s.evalJs(`${repoGroup}.querySelector('.history-group-header').click()`);
  await s.waitFor(`document.querySelectorAll('.history-row').length === 4`, 'the repo group opened again');
  step('a group collapses and opens on its header');

  // M9 fix 84: the fold follows the focused pane. A shell in the other
  // folder shown in the focused pane folds the repo group and opens the
  // other one; a header opened by hand stays open until the focus moves
  // again; the shell in the repo shown again swaps the folds back. The
  // rows are the ones that were there, so no scan is waited on.
  const { session: otherShell } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: other, cols: 120, rows: 30 });
  const repoShell = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id !== otherShell.id && x.kind === 'shell');
  expect(repoShell !== undefined, 'the shell in the repo is listed');
  const rowOf = (id) => `.sidebar-row[data-session-id=${JSON.stringify(id)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowOf(otherShell.id))})`, 'the second shell in the sidebar');
  await s.evalJs(`document.querySelector(${JSON.stringify(rowOf(otherShell.id))}).click()`);
  // The other shell is on no pane and the repo shell holds the focused
  // one, so the click asks (M9 fix 91); Show here is the old answer.
  await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(otherShell.id)}`, 'the chooser under the other shell\'s row');
  await s.evalJs(`[...document.querySelectorAll('.show-chooser .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Show here').click()`);
  await s.waitFor(`[...document.querySelectorAll('.history-group')].map(g => g.querySelector('.history-group-name').textContent + ':' + (g.dataset.collapsed ? 'folded' : 'open')).join(',') === 'repo:folded,other:open,gone:folded'`, 'the folds following the focused pane to the other folder');
  await s.evalJs(`${repoGroup}.querySelector('.history-group-header').click()`);
  await s.waitFor(`document.querySelectorAll('.history-row').length === 3`, 'the repo group opened by hand beside the focused one');
  await sleep(300);
  expect((await folds(s)).join(',') === 'repo:open,other:open,gone:folded', `a hand-opened group stays open while the focus stands, got ${await folds(s)}`);
  // M9 fix 417: the fold is decided from every project the scan found,
  // not the ones the search leaves, so the move back with a search
  // narrowing the list to the repo group still folds the other two. Read
  // once the search clears; before fix 417 the effect saw the one group
  // the search left, found nothing to fold, and both rode open.
  await setSearch(s, 'RAIL');
  await s.waitFor(`document.querySelectorAll('.history-group').length === 1`, 'the search narrowing the list to the repo group');
  await s.evalJs(`document.querySelector(${JSON.stringify(rowOf(repoShell.id))}).click()`);
  // The repo shell is the one off screen now, so the click asks again.
  await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(repoShell.id)}`, 'the chooser under the repo shell\'s row');
  await s.evalJs(`[...document.querySelectorAll('.show-chooser .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Show here').click()`);
  await s.waitFor(foldsAre('repo:open'), 'the repo group, the one the search leaves, open with its shell focused again');
  await setSearch(s, '');
  await s.waitFor(foldsAre('repo:open,other:folded,gone:folded'), 'the folds back with the repo shell focused, decided from every project and not the one the search left');
  await openAll(s);
  await s.waitFor(`document.querySelectorAll('.history-row').length === 4`, 'every group open again');
  step('the folds follow the focused pane: the other folder focused folds repo and opens other, a hand-opened group stays, the repo shell back swaps them; M9 fix 417: the fold reads every project, not the ones a search leaves');

  // M9 fix 85: Open transcript on the row menu opens the .jsonl as a
  // read-only file tab (M11), Monaco showing the seeded lines; the tab
  // closes on its x and the panes come back.
  await s.evalJs(`document.querySelector(${JSON.stringify(`${rowSel(B1)} .history-row-menu`)}).click()`);
  await s.waitFor(`document.querySelector('.history-menu')?.dataset.id === ${JSON.stringify(B1)}`, 'the row menu for B1');
  const menuLabels = await s.evalJs(`[...document.querySelectorAll('.history-menu .menu-label')].map(b => b.textContent)`);
  expect(menuLabels.includes('Open transcript') && menuLabels.indexOf('Open transcript') < menuLabels.indexOf('Reveal transcript'), `the menu offers Open transcript before Reveal, got ${menuLabels.join(', ')}`);
  await s.evalJs(`[...document.querySelectorAll('.history-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Open transcript').click()`);
  const transcriptTab = path.join(claudeHome, 'projects', encode(other), `${B1}.jsonl`);
  await s.waitFor(`document.querySelector('.tab-file[data-active]')?.dataset.tab === ${JSON.stringify(transcriptTab)}`, 'the transcript tab active');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'text'`, 'the transcript read');
  // M53: the menu's Open transcript is the tab's Raw view; the tab
  // carries the star, since it is a conversation and not a file.
  expect((await s.evalJs(`document.querySelector('.file-view')?.dataset.view`)) === 'raw', 'Open transcript opens the raw view');
  expect(await s.evalJs(`!!document.querySelector('.file-view .monaco-editor')`), 'it is a Monaco editor');
  expect((await s.evalJs(`Number(document.querySelector('.file-view')?.dataset.lines ?? 0)`)) >= 3, 'the three seeded lines are there');
  expect((await s.evalJs(`document.querySelector('.tab-file[data-active] svg path')?.getAttribute('d')?.startsWith('M8 1.5v13')`)) === true, 'the tab draws the star');
  expect(await s.evalJs(`!!document.querySelector('.history-panel')`), 'the rail keeps the Sessions panel beside the tab');
  // M9 fix 96: the raw view reads no title, so the tab keeps the session id.
  expect((await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-name')?.textContent`)) === B1, 'a raw transcript tab is named by its session id');
  await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-close').click()`);
  await s.waitFor(`!document.querySelector('.tab-file') && !document.querySelector('.panes-view[data-hidden]')`, 'the tab closed and the panes back');
  step('Open transcript on a row opens the .jsonl read-only in a Monaco tab with the star, closed on its x');

  // M53: a click on a row unfolds it into its turns, the prompt's first
  // line and the reply's, the last reply whole, with the facts line
  // giving the span and the branch; Expand opens the same conversation
  // as a tab on its Turns view, every turn in the column with the muted
  // line of what it did, Raw is the editor, and the row's Open transcript
  // opens the raw view; a second click folds the row.
  const a1Row = rowSel(A1);
  const turnSel = `${a1Row} .history-turn`;
  await s.evalJs(`document.querySelector(${JSON.stringify(a1Row)}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(a1Row)})?.dataset.unfolded === 'true' && document.querySelectorAll(${JSON.stringify(turnSel)}).length === 2`, 'A1 unfolded with two turns');
  const railTurns = await s.evalJs(
    `[...document.querySelectorAll(${JSON.stringify(turnSel)})].map((t) => ({ prompt: t.querySelector('.history-turn-prompt .history-turn-text').textContent, reply: t.querySelector('.history-turn-reply .history-turn-text')?.textContent ?? null, length: t.querySelector('.history-turn-length')?.textContent ?? null, whole: t.dataset.whole === 'true', marks: [...t.querySelectorAll('.history-turn-mark')].map((m) => m.textContent).join('') }))`,
  );
  expect(railTurns[0].prompt === 'the tabs are broken' && railTurns[0].reply === 'Looking.' && !railTurns[0].whole, `the first turn is the prompt and the reply's first line, got ${JSON.stringify(railTurns[0])}`);
  expect(railTurns[0].length === '6m', `the first turn's length runs to its tool call, got ${railTurns[0].length}`);
  expect(railTurns[0].marks === '›✓', `the markers are the sidebar's, got ${railTurns[0].marks}`);
  expect(railTurns[1].whole && railTurns[1].reply === 'Two files changed.' + String.fromCharCode(10) + 'The tests pass.', `the last reply is whole, got ${JSON.stringify(railTurns[1])}`);
  expect(!(await s.evalJs(`!!document.querySelector(${JSON.stringify(`${a1Row} .history-row-preview`)})`)), 'the preview line gives way to the turns');
  const unfoldedFacts = await rowFacts(s, A1);
  // The unfolded count comes off the turns (M9 fix 97): two prompts in
  // the transcript, where history.jsonl has three lines for A1.
  expect(unfoldedFacts.startsWith('2 prompts · ') && unfoldedFacts.includes(' to ') && unfoldedFacts.includes(' · main · claude-opus-5'), `the facts give the turns' count, the span and the branch, got ${unfoldedFacts}`);
  // M9 fix 273: the unfolded row names the agents' share of the estimate.
  expect(unfoldedFacts.endsWith(` · ~${formatUsd(A1_USD)} (agents ~${formatUsd(A1_AGENT_USD)})`), `the unfolded price carries the agents' share, got ${unfoldedFacts}`);
  // M9 fix 283: unfolded, the facts line wraps rather than ellipsis, so
  // the price at its end is actually on screen, inside the rail.
  const unfoldedCost283 = await s.evalJs(
    `(() => { const c = document.querySelector(${JSON.stringify(`${a1Row} .history-row-cost`)}); const rail = document.querySelector('.history-panel'); if (!c || !rail) return null; const cr = c.getBoundingClientRect(); const rr = rail.getBoundingClientRect(); return { width: cr.width, right: cr.right, railRight: rr.right }; })()`,
  );
  expect(unfoldedCost283 !== null && unfoldedCost283.width > 0 && unfoldedCost283.right <= unfoldedCost283.railRight, `the price has width and sits inside the rail, got ${JSON.stringify(unfoldedCost283)}`);
  expect((await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(`${a1Row} .history-row-buttons button`)})].map((b) => b.textContent.trim())`)).join(',') === 'Expand,Open transcript', 'Expand and Open transcript under the turns');
  step('a row unfolds into its turns: the prompts and replies, the last reply whole, the span and the branch in the facts, wrapped so the price is on screen (fix 283)');

  await s.evalJs(`document.querySelector(${JSON.stringify(`${a1Row} .history-expand`)}).click()`);
  const a1Tab = path.join(claudeHome, 'projects', encode(repo), `${A1}.jsonl`);
  await s.waitFor(`document.querySelector('.tab-file[data-active]')?.dataset.tab === ${JSON.stringify(a1Tab)}`, 'the A1 tab active');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'turns' && document.querySelector('.transcript-view')?.dataset.turns === '2'`, 'the Turns view with two turns');
  await s.waitFor(`document.activeElement?.classList.contains('transcript-view') === true`, 'the Turns view takes the keyboard on open', 3000);
  await s.key('f', 'KeyF', 70, CTRL);
  await s.waitFor(`!!document.activeElement?.closest('.view-find-bar') && document.activeElement?.classList.contains('find-input') === true`, "Ctrl+F opens the view find bar over the turns with the keyboard in its box", 3000);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.view-find-bar') && document.activeElement?.classList.contains('transcript-view') === true`, 'Escape closes the bar and hands the keyboard back to the turns', 3000);
  // M9 fix 96: the tab is named by the conversation once the view has
  // read it, with the file (and so the session id) in its tooltip.
  await s.waitFor(`document.querySelector('.tab-file[data-active] .tab-name')?.textContent === 'Fix the tabs'`, 'the tab is named by the conversation');
  expect((await s.evalJs(`document.querySelector('.tab-file[data-active]')?.title`)) === a1Tab, 'the transcript path stays in the tooltip');
  const tabTurns = await s.evalJs(
    `[...document.querySelectorAll('.transcript-turn')].map((t) => ({ prompt: t.querySelector('.transcript-prompt-text').textContent, when: t.querySelector('.transcript-when')?.textContent ?? null, reply: t.querySelector('.transcript-reply-text')?.textContent ?? null, whole: t.querySelector('.transcript-reply')?.dataset.whole === 'true', did: [...t.querySelectorAll('.transcript-did')].map((d) => d.textContent) }))`,
  );
  expect(tabTurns[0].prompt === 'the tabs are broken' && tabTurns[0].reply === 'Looking.' && !tabTurns[0].whole, `the tab's first turn, got ${JSON.stringify(tabTurns[0])}`);
  expect(tabTurns[0].when !== null && tabTurns[0].when.endsWith(' · 6m'), `the turn's time and length at the right, got ${tabTurns[0].when}`);
  expect(tabTurns[0].did.join('|') === '2 tool calls · 1 file edited · 1 commit', `the muted line says what the turn did, got ${tabTurns[0].did.join('|')}`);
  expect(tabTurns[1].whole && tabTurns[1].did.length === 0, `the last reply is whole and a turn that did nothing has no line, got ${JSON.stringify(tabTurns[1])}`);
  const tabFacts = await s.evalJs(`document.querySelector('.transcript-facts')?.textContent ?? null`);
  expect(tabFacts !== null && tabFacts.startsWith('repo · main · claude-opus-5 · ') && tabFacts.endsWith(' · 2 prompts'), `the facts line at the top, got ${tabFacts}`);
  expect((await s.evalJs(`document.querySelector('.transcript-resume')?.textContent`)) === 'Resume', 'Resume beside the facts');
  expect((await s.evalJs(`[...document.querySelectorAll('.file-view-switch button')].map((b) => b.textContent.trim())`)).join(',') === 'Turns,Raw', 'the switch reads Turns | Raw');
  expect((await s.evalJs(`document.querySelector('.tab-file[data-active] svg path')?.getAttribute('d')?.startsWith('M8 1.5v13')`)) === true, 'the tab draws the star');
  await s.evalJs(`document.querySelector('.file-view-switch button[data-view="raw"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'raw' && !!document.querySelector('.file-view .monaco-editor') && !document.querySelector('.transcript-view')`, 'Raw is the editor');
  await s.evalJs(`document.querySelector('.file-view-switch button[data-view="turns"]').click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'turns' && !!document.querySelector('.transcript-view')`, 'Turns again');
  expect((await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-name')?.textContent`)) === 'Fix the tabs', 'the name held through Raw and back');
  await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-close').click()`);
  await s.waitFor(`!document.querySelector('.tab-file')`, 'the tab closed');
  step('Expand opens the conversation as a tab on its Turns view: the facts, Resume, the turns with their times and what they did, Raw and back, the tab named by the conversation, the view taking the keyboard on open with Ctrl+F\'s bar over it (fix 636)');

  await s.evalJs(`document.querySelector(${JSON.stringify(`${a1Row} .history-row-open`)}).click()`);
  await s.waitFor(`document.querySelector('.tab-file[data-active]')?.dataset.tab === ${JSON.stringify(a1Tab)} && document.querySelector('.file-view')?.dataset.view === 'raw'`, "the row's Open transcript opens the raw view");
  await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-close').click()`);
  await s.waitFor(`!document.querySelector('.tab-file')`, 'the tab closed');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(a1Row)})?.dataset.unfolded`)) === 'true', 'the row stayed unfolded behind the tab');
  await s.evalJs(`document.querySelector(${JSON.stringify(`${a1Row} .history-row-fold`)}).click()`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(a1Row)})?.dataset.unfolded && document.querySelectorAll(${JSON.stringify(turnSel)}).length === 0`, 'the row folded on its chevron');
  expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(`${a1Row} .history-row-preview`)})`), 'the preview line is back');
  // M9 fix 283: folded, the facts line stays the one line it always was.
  const foldedLines283 = await s.evalJs(
    `(() => { const el = document.querySelector(${JSON.stringify(`${a1Row} .history-row-facts`)}); if (!el) return null; const rg = document.createRange(); rg.selectNodeContents(el); const tops = [...rg.getClientRects()].map((r) => r.top).sort((a, b) => a - b); let n = tops.length === 0 ? 0 : 1; for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] > 4) n++; return n; })()`,
  );
  expect(foldedLines283 === 1, `the folded row's facts stay one line, got ${foldedLines283}`);
  step("the row's Open transcript opens the raw view; the chevron folds the row and its preview comes back");

  // M9 fix 97: A2's transcript runs past the scan's count cap, so the
  // folded row says 3 prompts; unfolded, the turns give the whole file's
  // five, the tab's header agrees with the row, and a row that has read
  // its turns keeps their count when folded again.
  const a2Row = rowSel(A2);
  expect((await rowFacts(s, A2)).startsWith('3 prompts · '), `A2 folded keeps the scan's count, got ${await rowFacts(s, A2)}`);
  await s.evalJs(`document.querySelector(${JSON.stringify(a2Row)}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(a2Row)})?.dataset.unfolded === 'true' && document.querySelectorAll(${JSON.stringify(`${a2Row} .history-turn`)}).length === 5`, 'A2 unfolded with five turns', 10000);
  await s.waitFor(`(document.querySelector(${JSON.stringify(`${a2Row} .history-row-facts`)})?.textContent ?? '').startsWith('5 prompts · ')`, "A2's unfolded facts count the whole file");
  await s.evalJs(`document.querySelector(${JSON.stringify(`${a2Row} .history-expand`)}).click()`);
  await s.waitFor(`document.querySelector('.transcript-view')?.dataset.turns === '5'`, "A2's tab with five turns", 10000);
  const a2TabFacts = await s.evalJs(`document.querySelector('.transcript-facts')?.textContent ?? null`);
  expect(a2TabFacts !== null && a2TabFacts.endsWith(' · 5 prompts'), `the tab's header agrees with the row, got ${a2TabFacts}`);
  await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-close').click()`);
  await s.waitFor(`!document.querySelector('.tab-file')`, 'the tab closed');
  await s.evalJs(`document.querySelector(${JSON.stringify(`${a2Row} .history-row-fold`)}).click()`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(a2Row)})?.dataset.unfolded`, 'A2 folded again');
  expect((await rowFacts(s, A2)).startsWith('5 prompts · '), `folded again, A2 keeps the count it learned, got ${await rowFacts(s, A2)}`);
  step("a transcript past the count cap: 3 prompts folded, 5 once the turns are read, the tab's header agreeing, the count kept on a fold");

  // M9 fix 955: B1 ran a bash command after its reply, so the rail's unfolded row and the Turns tab
  // both give the run a row of its own marked !, the turn before keeps its reply, and the count stays
  // 1 prompt. Fix 954: the tab is named by B1's last /rename.
  const b1Row = rowSel(B1);
  await openAll(s);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(b1Row)})`, 'the B1 row', 5000);
  await s.evalJs(`document.querySelector(${JSON.stringify(b1Row)}).click()`);
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(`${b1Row} .history-turn`)}).length === 2`, 'B1 unfolded with two turns', 8000);
  const b1Turns = await s.evalJs(
    `[...document.querySelectorAll(${JSON.stringify(`${b1Row} .history-turn`)})].map((t) => ({ bash: t.dataset.bash === 'true', mark: t.querySelector('.history-turn-prompt .history-turn-mark')?.textContent ?? null, prompt: t.querySelector('.history-turn-prompt .history-turn-text')?.textContent ?? null, reply: t.querySelector('.history-turn-reply .history-turn-text')?.textContent ?? null }))`,
  );
  expect(!b1Turns[0].bash && b1Turns[0].mark === '›' && b1Turns[0].reply === 'Here they are.', `the turn before the run keeps its own reply, got ${JSON.stringify(b1Turns[0])}`);
  expect(b1Turns[1].bash && b1Turns[1].mark === '!' && b1Turns[1].prompt === 'type notes.md' && b1Turns[1].reply === 'It printed the notes.', `the run is a row of its own marked !, got ${JSON.stringify(b1Turns[1])}`);
  expect((await rowFacts(s, B1)).startsWith('1 prompt · '), `the unfolded count leaves the run out, got ${await rowFacts(s, B1)}`);
  await s.evalJs(`document.querySelector(${JSON.stringify(`${b1Row} .history-expand`)}).click()`);
  await s.waitFor(`document.querySelector('.transcript-view')?.dataset.turns === '2'`, "B1's tab with two turns", 8000);
  const b1Tab = await s.evalJs(
    `(() => { const t = [...document.querySelectorAll('.transcript-turn')][1]; return { bash: t?.dataset.bash === 'true', mark: t?.querySelector('.transcript-mark')?.textContent ?? null, facts: document.querySelector('.transcript-facts')?.textContent ?? null, name: document.querySelector('.tab-file[data-active] .tab-name')?.textContent ?? null }; })()`,
  );
  expect(b1Tab.bash && b1Tab.mark === '!', `the Turns tab marks the run, got ${JSON.stringify(b1Tab)}`);
  expect(b1Tab.facts !== null && b1Tab.facts.endsWith(' · 1 prompt'), `the tab's header counts 1 prompt, got ${b1Tab.facts}`);
  expect(b1Tab.name === 'Notes from the other project', `the tab is named by the /rename, got ${b1Tab.name}`);
  await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-close').click()`);
  await s.waitFor(`!document.querySelector('.tab-file')`, 'the tab closed');
  await s.evalJs(`document.querySelector(${JSON.stringify(`${b1Row} .history-row-fold`)}).click()`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(b1Row)})?.dataset.unfolded`, 'B1 folded again');
  step('fix 955: a bash run is a turn of its own marked ! in the rail and the Turns tab, the turn before keeps its reply, the count stays 1 prompt; fix 954: the tab is named by the /rename');

  // M9 fix 256: a live session's row shows Claude Code's own figure, bare,
  // in place of the estimate: a Claude session (a real claude, which
  // sits at the trust dialog of the fresh folder and makes no request)
  // whose hooks bind G1's conversation and post a status line with the
  // cost; killed and removed after, so the rows read as before. Then a
  // transcript over the read cap gets no figure at all.
  const liveShell = (await zreq(s, 'session.spawn', { kind: 'claude', cwd: repo, cols: 80, rows: 24 })).session;
  const daemonNow = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const postLive = async (payload) => {
    const r = await fetch(`http://127.0.0.1:${daemonNow.hookPort}/hook`, { method: 'POST', headers: { 'X-Emerald-Token': daemonNow.hookToken, 'X-Emerald-Session': liveShell.id }, body: JSON.stringify({ session_id: G1, cwd: repo, ...payload }) });
    expect(r.status === 204, `the sink took ${payload.hook_event_name}`);
  };
  await postLive({ hook_event_name: 'SessionStart', source: 'startup' });
  await postLive({ hook_event_name: 'StatusLine', model: { id: 'claude-opus-5', display_name: 'Opus 5' }, workspace: { current_dir: repo }, cost: { total_cost_usd: 1.4 }, context_window: { used_percentage: 3, context_window_size: 1000000, total_input_tokens: 500, total_output_tokens: 20, current_usage: { input_tokens: 2, output_tokens: 20, cache_creation_input_tokens: 400, cache_read_input_tokens: 98 } } });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(G1))})?.dataset.live !== undefined && (document.querySelector(${JSON.stringify(`${rowSel(G1)} .history-row-facts`)})?.textContent ?? '').endsWith(' · $1.40')`, "G1's row is live with Claude Code's own figure", 8000);
  const g1Cost = await s.evalJs(`(() => { const c = document.querySelector(${JSON.stringify(`${rowSel(G1)} .history-row-cost`)}); return c ? { text: c.textContent, estimate: 'estimate' in c.dataset, title: c.title } : null; })()`);
  expect(g1Cost !== null && g1Cost.text === '$1.40' && !g1Cost.estimate && g1Cost.title === "at API rates, subagents included, Claude Code's own figure", `the live figure is bare and says whose it is (${JSON.stringify(g1Cost)})`);
  await zreq(s, 'session.kill', { sessionId: liveShell.id, remove: true });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(G1))})?.dataset.live === undefined`, 'the row is a past conversation again', 8000);
  const H1 = 'd1d1d1d1-0000-4000-8000-000000000005';
  fs.writeFileSync(path.join(claudeHome, 'projects', encode(repo), `${H1}.jsonl`), line({ type: 'ai-title', aiTitle: 'Too big to price', sessionId: H1 }) + user('a long day', NOW - 1000, repo) + reply('Long.', NOW - 900, repo, 'claude-opus-5', { input_tokens: 10, output_tokens: 10 }) + line({ type: 'progress', pad: 'x'.repeat(2048) }).repeat(4200));
  fs.appendFileSync(historyFile, history('a long day', NOW - 1000, repo, H1));
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(H1))})`, "the big transcript's row", 8000);
  await sleep(1500);
  const h1Facts = await rowFacts(s, H1);
  expect(h1Facts !== null && h1Facts.startsWith('1 prompt · ') && !h1Facts.includes('$'), `a transcript over the cap carries no figure (${h1Facts})`);
  step("M9 fix 256: a Sessions row's facts end with the conversation's price, our estimate marked as one, a live session's as Claude Code's own bare figure, and nothing on a transcript with no requests or over the cap");

  const before = (await zreq(s, 'session.list', {})).sessions.map((x) => x.id);
  await s.evalJs(`document.querySelector(${JSON.stringify(`${rowSel(B1)} .history-row-action`)}).click()`);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1 && !!document.querySelector('.pane-title')`, 'the pane still on screen');
  let started = null;
  for (let i = 0; i < 50 && started === null; i++) {
    const { sessions } = await zreq(s, 'session.list', {});
    started = sessions.find((x) => !before.includes(x.id)) ?? null;
    if (started === null) await sleep(100);
  }
  expect(started !== null, 'Resume started a session');
  expect(started.kind === 'claude', `it is a Claude session, got ${started.kind}`);
  expect(started.spawnCwd === other, `it started in the transcript's folder, got ${started.spawnCwd}`);
  expect(started.args.join(' ') === `--resume ${B1}`, `its args are --resume and the id, got ${started.args.join(' ')}`);
  const layout = await getLayout(s);
  expect(layout.root.kind === 'pane' && layout.root.sessionId === started.id, 'the focused pane shows it');
  // Claude Code has no conversation under the seeded id and exits; the
  // sink is told SessionStart as the hooks would, which binds the id.
  const daemon = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
  const res = await fetch(`http://127.0.0.1:${daemon.hookPort}/hook`, {
    method: 'POST',
    headers: { 'X-Emerald-Token': daemon.hookToken, 'X-Emerald-Session': started.id },
    body: JSON.stringify({ session_id: B1, cwd: other, hook_event_name: 'SessionStart', source: 'resume' }),
  });
  expect(res.status === 204, 'the sink took SessionStart');
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(B1))})?.dataset.own === ${JSON.stringify(started.id)}`, 'the row bound to the session');
  expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(`${rowSel(B1)} .history-row-dot`)})`), 'the row shows a state dot');
  step(`Resume started ${started.id.slice(0, 8)} in ${other} with --resume; the row is bound to it`);

  // M9 fix 439: the History panel's folds across a reload. B1's resumed
  // session is focused in other, so repo is folded by fix 84's default;
  // opening it by hand and reloading (a page reload, not a restart, so
  // the daemon's layout and its focusedPaneId do not change) proves the
  // hand-open survives, ui.ts's foldHistoryProjects restoring it on the
  // panel's very first fold. Focusing a different session in the same
  // folder afterward proves a real focus change clears it regardless, the
  // fix 84 shape coming back even though the project did not.
  await s.waitFor(foldsAre('repo:folded,other:open,gone:folded'), 'the fix 84 shape with the resumed session focused in other, before the hand-open');
  await s.evalJs(`${groupHeader('repo')}.click()`);
  await s.waitFor(foldsAre('repo:open,other:open,gone:folded'), 'repo opened by hand beside other, still focused there');
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.history-panel')`, 'the Sessions panel after a reload for the fold check');
  await s.waitFor(foldsAre('repo:open,other:open,gone:folded'), 'the hand-opened repo group is back after the reload', 10000);
  await s.evalJs(`document.querySelector(${JSON.stringify(rowOf(otherShell.id))}).click()`);
  await s.waitFor(`document.querySelector('.show-chooser')?.dataset.sessionId === ${JSON.stringify(otherShell.id)}`, "the chooser under the other shell's row");
  await s.evalJs(`[...document.querySelectorAll('.show-chooser .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Show here').click()`);
  await s.waitFor(foldsAre('repo:folded,other:open,gone:folded'), 'a focus change clears the hand-open even within the same project, the fix 84 shape again');
  step('M9 fix 439: a group opened by hand survives a reload while the same session stays focused, and a focus change (even within the same project) clears it back to the fix 84 shape');

  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.history-panel')`, 'the Sessions panel after a reload');
  expect(await s.evalJs(`document.querySelector('.files-rail')?.dataset.tab`) === 'history', 'the rail tab survived the reload');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`!!document.querySelector('.files-list')`, 'the tree back');
  expect(await s.evalJs(`!document.querySelector('.history-panel')`), 'the panel is unmounted while the tree shows');
  step('the rail tab survives a reload and the Files icon brings the tree back');

  console.log('[verify] M19 history: PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  console.error('[verify] page console', s.consoleLog.slice(-20).join('\n'));
  try {
    console.error('[verify] shot', await s.screenshot('m19-fail.png'));
  } catch {
    // The window may be gone.
  }
  process.exitCode = 1;
} finally {
  killTree(app.child);
  stopDaemon();
  fs.rmSync(claudeHome, { recursive: true, force: true });
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
