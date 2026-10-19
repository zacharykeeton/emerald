// M54 acceptance: the day's activity. Three shells; two of them play
// Claude through the hook sink, one working for six seconds and the other
// for the second half of that, so their spans overlap by half; the card
// (the rail's Activity tab since M66) draws the two spans with widths in the spans'
// ratio and the third shell nothing at all (M9 fix 191: a shell's
// lifetime row is not drawn and takes no track), and its text says 1.5x
// parallel with a peak of 2; the fold hides the strip and keeps the text;
// Expand opens the day as a tab with a named row per session and the
// prompt under hover, the day steps back and forward, the strip turns
// vertical; and emmer activity --json on the same pipe agrees with the
// card. Then (M67) the hour and the minute windows, paging, now and the
// rollover under a driven clock. Then (M62) a session sends two agents out and the tab shows them
// as rows under it, counted in the figures, and the CLI prints them
// indented. Uses a private home and pipe unless the environment already
// names them. Run: npm run verify:activity -w @emerald/app
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm54-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m54';
const { daemonPid, expect, freshPort, getLayout, getTabs, killTree, launch, leaves, pickSplitDefault, repoRoot, setInput, shotsDir, sleep, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
// 300 s since the batch of fixes 329 to 351 (180 before): the run is about
// 130 s on a quiet box and passed 180 with every step green on a box
// clocked down to 2.5 GHz, where the fetches behind the Stops converge
// slower and the settle waits add up.
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 300 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 300000);

const home = os.homedir();
// M9 fix 230: the week unit needs days behind today, which live hooks
// cannot give, so the activity log is seeded before the daemon starts
// (it reads hooks.jsonl whole at start): on every past day of this week
// a few working sessions over the morning, overlapping so the day has a
// peak of its own, and between two past days one span across midnight.
// Nothing lands on today, whose rows the other steps count, nor on
// yesterday, which the ◀ step expects empty; the file is written whole,
// so a rerun on the same home starts from this seed.
const HOUR = 3_600_000;
const seedNow = new Date();
const mondayAt = new Date(seedNow.getFullYear(), seedNow.getMonth(), seedNow.getDate() - ((seedNow.getDay() + 6) % 7)).getTime();
// The past days of this week: 0 on a Monday, 6 on a Sunday; the seeded
// ones stop short of yesterday.
const pastDays = (seedNow.getDay() + 6) % 7;
const seededDays = Math.max(0, pastDays - 1);
const seed = [];
const seedLine = (at, id, event, from, to) => seed.push(JSON.stringify({ at, sessionId: id, event, from, to, outcome: 'applied', payload: { session_id: `sim-${id}`, hook_event_name: event, cwd: home } }));
for (let i = 0; i < seededDays; i++) {
  const dayAt = new Date(seedNow.getFullYear(), seedNow.getMonth(), seedNow.getDate() - pastDays + i).getTime();
  const n = 1 + ((i * 3) % 5);
  for (let k = 0; k < n; k++) {
    seedLine(dayAt + (8 + i + k * 0.5) * HOUR, `week-${i}-${k}`, 'UserPromptSubmit', 'idle', 'working');
    seedLine(dayAt + (11 + i + k * 1.5) * HOUR, `week-${i}-${k}`, 'Stop', 'working', 'done');
  }
  if (i + 1 < seededDays) {
    seedLine(dayAt + 23.5 * HOUR, `night-${i}`, 'UserPromptSubmit', 'idle', 'working');
    seedLine(dayAt + 24.5 * HOUR, `night-${i}`, 'Stop', 'working', 'done');
  }
}
// M9 fix 231: attention debt, seeded on two days of last week that no
// other step visits (the ◀ step expects yesterday empty, the week steps
// read this week). debtDay is the board's queue: three sessions asking
// over one overlapping hour, answered within ten minutes of each other,
// one turn unread for forty minutes in the morning, a done answered at
// 59 s (nothing) and one at 61 s (one second), and a subagent for the
// lane weights. quietDay has the same shapes with every done answered
// inside the grace and nothing asked, so it owes nothing. Every session
// here ends on a Stop, so no stretch is open at the daemon's read.
const SEC = 1000;
const MINUTE = 60_000;
const dayAgo = (n) => new Date(seedNow.getFullYear(), seedNow.getMonth(), seedNow.getDate() - n);
const debtDayAt = dayAgo(8).getTime();
const quietDayAt = dayAgo(9).getTime();
const dayKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const debtDay = dayKeyOf(dayAgo(8));
const quietDay = dayKeyOf(dayAgo(9));
const hm = (dayAt, h, m, sec = 0) => dayAt + h * HOUR + m * MINUTE + sec * SEC;
const seedTeam = (at, id, event, extra) => seed.push(JSON.stringify({ at, sessionId: id, event, outcome: 'applied', payload: { session_id: `sim-${id}`, hook_event_name: event, cwd: home, ...extra } }));
{
  const D = debtDayAt;
  // g59: done answered at 59 s, nothing owed; g61: at 61 s, one second.
  seedLine(hm(D, 9, 0), 'g59', 'UserPromptSubmit', 'idle', 'working');
  seedLine(hm(D, 9, 10), 'g59', 'Stop', 'working', 'done');
  seedLine(hm(D, 9, 10, 59), 'g59', 'UserPromptSubmit', 'done', 'working');
  seedLine(hm(D, 9, 20), 'g59', 'Stop', 'working', 'done');
  seedLine(hm(D, 9, 30), 'g61', 'UserPromptSubmit', 'idle', 'working');
  seedLine(hm(D, 9, 40), 'g61', 'Stop', 'working', 'done');
  seedLine(hm(D, 9, 41, 1), 'g61', 'UserPromptSubmit', 'done', 'working');
  seedLine(hm(D, 9, 50), 'g61', 'Stop', 'working', 'done');
  // u1: a turn done at 11:00 and left until 11:41, forty minutes unread.
  seedLine(hm(D, 10, 30), 'u1', 'UserPromptSubmit', 'idle', 'working');
  seedLine(hm(D, 11, 0), 'u1', 'Stop', 'working', 'done');
  seedLine(hm(D, 11, 41), 'u1', 'UserPromptSubmit', 'done', 'working');
  seedLine(hm(D, 11, 50), 'u1', 'Stop', 'working', 'done');
  // q1, q2, q3: asked at 14:00, 14:10 and 14:20, answered at 15:00,
  // 15:00 and 15:10; q1 sends an agent out first, for the 3px lane.
  seedLine(hm(D, 13, 0), 'q1', 'UserPromptSubmit', 'idle', 'working');
  seedTeam(hm(D, 13, 5), 'q1', 'SubagentStart', { agent_id: 'ag1', agent_type: 'fork' });
  seedTeam(hm(D, 13, 25), 'q1', 'SubagentStop', { agent_id: 'ag1', agent_type: 'fork' });
  seedLine(hm(D, 14, 0), 'q1', 'PermissionRequest', 'working', 'needs-input');
  seedLine(hm(D, 15, 0), 'q1', 'PostToolUse', 'needs-input', 'working');
  seedLine(hm(D, 15, 30), 'q1', 'Stop', 'working', 'done');
  seedLine(hm(D, 15, 30, 30), 'q1', 'UserPromptSubmit', 'done', 'working');
  seedLine(hm(D, 15, 40), 'q1', 'Stop', 'working', 'done');
  seedLine(hm(D, 13, 10), 'q2', 'UserPromptSubmit', 'idle', 'working');
  seedLine(hm(D, 14, 10), 'q2', 'PermissionRequest', 'working', 'needs-input');
  seedLine(hm(D, 15, 0), 'q2', 'PostToolUse', 'needs-input', 'working');
  seedLine(hm(D, 15, 20), 'q2', 'Stop', 'working', 'done');
  seedLine(hm(D, 13, 20), 'q3', 'UserPromptSubmit', 'idle', 'working');
  seedLine(hm(D, 14, 20), 'q3', 'PermissionRequest', 'working', 'needs-input');
  seedLine(hm(D, 15, 10), 'q3', 'PostToolUse', 'needs-input', 'working');
  seedLine(hm(D, 15, 20), 'q3', 'Stop', 'working', 'done');
  // The quiet day: two turns each, every done answered inside the minute.
  const Q = quietDayAt;
  for (const [id, h] of [['p1', 9], ['p2', 10], ['p3', 11]]) {
    seedLine(hm(Q, h, 0), id, 'UserPromptSubmit', 'idle', 'working');
    seedLine(hm(Q, h, 20), id, 'Stop', 'working', 'done');
    seedLine(hm(Q, h, 20, 45), id, 'UserPromptSubmit', 'done', 'working');
    seedLine(hm(Q, h, 50), id, 'Stop', 'working', 'done');
  }
}
// M9 fix 245: attention debt while nobody is at the box, on a day of
// its own ten days back. One session done at 02:00 with the box left at
// 01:30 (the daemon's own `away` line, no session) and someone back at
// 09:00, the next prompt at 09:05: the unread runs from the return plus
// the grace, 09:01 to 09:05, and the seven hours less a minute the
// window would have counted are the docked figure.
const awayDayAt = dayAgo(10).getTime();
const awayDay = dayKeyOf(dayAgo(10));
const seedPresence = (at, kind) => seed.push(JSON.stringify({ at, presence: kind }));
{
  const A = awayDayAt;
  seedLine(hm(A, 1, 0), 'night', 'UserPromptSubmit', 'idle', 'working');
  seedPresence(hm(A, 1, 30), 'away');
  seedLine(hm(A, 2, 0), 'night', 'Stop', 'working', 'done');
  seedPresence(hm(A, 9, 0), 'back');
  seedLine(hm(A, 9, 5), 'night', 'UserPromptSubmit', 'done', 'working');
  seedLine(hm(A, 9, 15), 'night', 'Stop', 'working', 'done');
  // M9 fix 285: a capped band on the same day. `spent` is done at 10:10
  // and prompted again at 11:30, with the five-hour window spent from
  // 10:20 (the daemon's own `capped` line, the reset at 12:00) and freed
  // at 11:00: the unread is cut by the band and the grace runs again
  // from the freed edge, 10:11 to 10:20 and 11:01 to 11:30, 38 minutes,
  // with the 40 the band covered as the docked figure.
  seedLine(hm(A, 10, 0), 'spent', 'UserPromptSubmit', 'idle', 'working');
  seedLine(hm(A, 10, 10), 'spent', 'Stop', 'working', 'done');
  seed.push(JSON.stringify({ at: hm(A, 10, 20), capped: { window: 'five_hour', resetsAt: hm(A, 12, 0) } }));
  seed.push(JSON.stringify({ at: hm(A, 11, 0), freed: { window: 'five_hour' } }));
  seedLine(hm(A, 11, 30), 'spent', 'UserPromptSubmit', 'done', 'working');
  seedLine(hm(A, 11, 40), 'spent', 'Stop', 'working', 'done');
}
// M9 fix 837: a folder of its own for the Statistics tab, a repository
// whose first commit is twenty days back and whose second, on the wall
// clock, carries the one tag, and three unhosted conversations seven
// days back, a day no other step reads (this week is the week's, the
// debt and away days are eight to ten back, the generations eleven to
// thirteen): stats-a in the folder, two requests, the second with no
// cost so the sum is an estimate; stats-wt in a worktree beside it and
// stats-other in a sibling folder, each one request the folder's figures
// must leave out.
const statsRepo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-verify-837-')));
const statsFirstCommitAt = hm(dayAgo(20).getTime(), 9, 0);
{
  const git837 = (args, env = {}) => execFileSync('git', args, { cwd: statsRepo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).toString();
  git837(['init', '-q', '-b', 'main']);
  git837(['config', 'user.name', 'verify']);
  git837(['config', 'user.email', 'verify@example.invalid']);
  git837(['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(statsRepo, 'base.txt'), 'base');
  git837(['add', 'base.txt']);
  const first = `${Math.floor(statsFirstCommitAt / 1000)} +0000`;
  git837(['commit', '-q', '-m', 'first'], { GIT_AUTHOR_DATE: first, GIT_COMMITTER_DATE: first });
  fs.writeFileSync(path.join(statsRepo, 'two.txt'), 'two');
  git837(['add', 'two.txt']);
  git837(['commit', '-q', '-m', 'second']);
  git837(['tag', 'v0.1.0']);
  const D7 = dayAgo(7).getTime();
  const conv = (at, id, cwd, event, extra = {}) => seed.push(JSON.stringify({ at, sessionId: id, event, unhosted: true, outcome: 'applied', ...extra.edge, payload: { hook_event_name: event, session_id: id, cwd, ...extra.payload } }));
  const status = (at, id, cwd, split, output, usd, model = 'Opus 5') =>
    conv(at, id, cwd, 'StatusLine', { payload: { model: { display_name: model }, ...(usd === null ? {} : { cost: { total_cost_usd: usd } }), context_window: { used_percentage: 10, current_usage: { input_tokens: split[0], cache_creation_input_tokens: split[1], cache_read_input_tokens: split[2], output_tokens: output } } } });
  conv(hm(D7, 15, 0), 'stats-a', statsRepo, 'UserPromptSubmit', { edge: { from: 'idle', to: 'working' } });
  status(hm(D7, 15, 1), 'stats-a', statsRepo, [4000, 8000, 12000], 500, 0.25);
  status(hm(D7, 15, 2), 'stats-a', statsRepo, [300, 0, 24000], 90, null);
  conv(hm(D7, 15, 30), 'stats-a', statsRepo, 'Stop', { edge: { from: 'working', to: 'done' } });
  for (const [id, cwd, usd] of [['stats-wt', `${statsRepo}-wt\\fix-1`, 0.1], ['stats-other', `${statsRepo}-other`, 0.1]]) {
    conv(hm(D7, 16, 0), id, cwd, 'UserPromptSubmit', { edge: { from: 'idle', to: 'working' } });
    status(hm(D7, 16, 1), id, cwd, [10, 0, 0], 10, usd);
    conv(hm(D7, 16, 5), id, cwd, 'Stop', { edge: { from: 'working', to: 'done' } });
  }
}
seed.sort((x, y) => JSON.parse(x).at - JSON.parse(y).at);
fs.mkdirSync(path.join(process.env['EMERALD_HOME'], 'logs'), { recursive: true });
fs.writeFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'hooks.jsonl'), seed.length === 0 ? '' : seed.join('\n') + '\n');
// M9 fix 414, extended by fix 415: the three rotated generations, seeded
// beside the current file so the daemon's load has all of them to stream
// (the rotation itself is the unit test's; this is the read that the load
// streams every generation and that a session living only in an older one
// reaches the history). Each generation gets a day of its own, eleven to
// thirteen days back: days this seed does not fill and no step navigates
// to, which is stricter than landing on a seeded day and is what the
// reads below need. A session added to a day a step reads moves more than
// its own row: put on the queue day at 03:00 these widened that day's
// time axis, and the fix 231 step derives hour-to-percent from the
// spacing of the first two ticks, so its 14:30 reads landed on the wrong
// place with every figure around them right. A list, so a further
// generation is one entry.
const genLine = (at, id, event, from, to) => JSON.stringify({ at, sessionId: id, event, from, to, outcome: 'applied', payload: { session_id: `sim-${id}`, hook_event_name: event, cwd: home } });
const genSeeds = [['hooks.3.jsonl', 'gen-three', 13], ['hooks.2.jsonl', 'gen-two', 12], ['hooks.1.jsonl', 'gen-one', 11]];
for (const [name, id, back] of genSeeds) {
  const at = hm(dayAgo(back).getTime(), 9, 0);
  fs.writeFileSync(path.join(process.env['EMERALD_HOME'], 'logs', name), [genLine(at, id, 'UserPromptSubmit', 'idle', 'working'), genLine(at + 30 * MINUTE, id, 'Stop', 'working', 'done')].join('\n') + '\n');
}
// M9 fix 607: the oldest of every seeded line is gen-three's 09:00,
// thirteen days back (the week's seed is this week, the debt days eight
// and nine back, the away day ten), and the history's line names it as
// historyFromText does, written out here with its own month names.
const oldestSeeded = Math.min(...genSeeds.map(([, , back]) => hm(dayAgo(back).getTime(), 9, 0)));
const historyWant = () => {
  const d = new Date(oldestSeeded);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `history from ${months[d.getMonth()]} ${d.getDate()}${d.getFullYear() === new Date().getFullYear() ? '' : `, ${d.getFullYear()}`}`;
};
// M9 fix 321: the usage strip's reading, stubbed the way verify:usage
// stubs it (a seeded credentials file in the harness Claude home and a
// canned reply on a local port), so the five-hour unit has a window to
// map itself to for the whole run: a five-hour window that resets in 41
// minutes, so its start is 4 h 19 m back. No step before the unit's
// reads the strip's text; the rail card's pill cycle gains the unit
// (the fix 121 step reads it).
const usageClaudeHome = path.join(process.env['EMERALD_HOME'], 'claude-home');
fs.mkdirSync(usageClaudeHome, { recursive: true });
fs.writeFileSync(path.join(usageClaudeHome, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'verify-token-m54', expiresAt: Date.now() + 3600_000 } }));
process.env['EMERALD_USAGE_FLOOR_MS'] = '0';
const usageResetsAt = new Date(Date.now() + 41 * 60_000).toISOString();
const usageReply = { status: 200, body: { five_hour: { utilization: 17, resets_at: usageResetsAt }, seven_day: { utilization: 5, resets_at: new Date(Date.now() + 6 * 24 * 3_600_000).toISOString() } } };
let usageStatus = 200;
const usageServer = http.createServer((req, res) => {
  res.writeHead(usageStatus, { 'content-type': 'application/json' });
  res.end(JSON.stringify(usageStatus === 200 ? usageReply.body : { error: 'unauthorized' }));
});
await new Promise((r) => usageServer.listen(0, '127.0.0.1', r));
process.env['EMERALD_USAGE_URL'] = `http://127.0.0.1:${usageServer.address().port}/api/oauth/usage`;
// Reassigned by the M69 relaunch at the end.
let s = await launch(freshPort(), { freshState: true });
app = s;

const daemon = () => JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
const post = async (sessionId, payload) => {
  const d = daemon();
  const res = await fetch(`http://127.0.0.1:${d.hookPort}/hook`, {
    method: 'POST',
    headers: { 'X-Emerald-Token': d.hookToken, 'X-Emerald-Session': sessionId },
    body: JSON.stringify({ session_id: `sim-${sessionId.slice(0, 8)}`, cwd: repoRoot, ...payload }),
  });
  expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
};
const cardText = () => s.evalJs(`document.querySelector('.activity-card .activity-text')?.textContent ?? null`);
const spanOf = (sessionId) =>
  s.evalJs(
    `(() => { const el = document.querySelector('.activity-card .activity-span[data-session-id=${JSON.stringify(sessionId)}]'); if (!el) return null; const r = el.getBoundingClientRect(); return { width: parseFloat(el.style.width), left: parseFloat(el.style.left), px: r.width, live: 'live' in el.dataset, title: el.title, color: getComputedStyle(el).color }; })()`,
  );
const rowState = (sessionId) => s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(sessionId)}]')?.dataset.state ?? null`);
const cli = (...args) =>
  new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js'), ...args], { env: process.env, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr}`));
      else resolve(stdout);
    });
  });

try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  // M9 fix 414: the daemon streams every rotated generation of the hook
  // log at its start and says how many lines each held, and until now
  // only a unit test read it. Two reads off the run that has just
  // started: the daemon's own `activity log loaded` line counts the
  // generations the seed wrote beside the current file, and the session
  // that exists in no file but an older generation is in the history the
  // daemon answers from.
  step('the daemon loads every generation of the hook log');
  // The log loads behind the pipe since M9 fix 517, so the line can come
  // after the empty pane; it is polled for up to ten seconds.
  const readLoadedLines = () => fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'emmerd.log'), 'utf8').split('\n').filter((l) => l.includes('activity log loaded'));
  let loadedLines = readLoadedLines();
  for (const until = Date.now() + 10_000; loadedLines.length === 0 && Date.now() < until; loadedLines = readLoadedLines()) await sleep(200);
  expect(loadedLines.length >= 1, `the daemon log carries an activity log loaded line (${loadedLines.length} found)`);
  const loadedLine = loadedLines[loadedLines.length - 1];
  const genCounts = JSON.parse(loadedLine.slice(loadedLine.indexOf('{')));
  expect(genCounts['oldest'] === new Date(oldestSeeded).toISOString(), `M9 fix 607: the loaded line's oldest is the oldest seeded line, ${new Date(oldestSeeded).toISOString()} (read ${genCounts['oldest']})`);
  const genWanted = Object.fromEntries(genSeeds.map(([name]) => [name, 2]));
  const genGot = Object.fromEntries(genSeeds.map(([name]) => [name, genCounts[name]]));
  expect(JSON.stringify(genGot) === JSON.stringify(genWanted), `each seeded generation's lines are counted on their own (wanted ${JSON.stringify(genWanted)}, read ${JSON.stringify(genGot)})`);
  expect(genCounts['hooks.jsonl'] === seed.length, `the current file's count is the seed's own ${seed.length} (read ${genCounts['hooks.jsonl']})`);
  const genRows = [];
  for (const [, id, back] of genSeeds) {
    const day = JSON.parse(await cli('activity', '--day', dayKeyOf(dayAgo(back)), '--json'));
    genRows.push(day.sessions.find((x) => x.sessionId === id && !x.agentId) ?? null);
  }
  expect(genRows.every((row) => row && row.spans.length === 1 && row.spans[0].to - row.spans[0].from === 30 * MINUTE), `each older generation's session is in the loaded history with its half-hour span (${JSON.stringify(genRows.map((r) => r && r.spans))})`);
  const historyJson = JSON.parse(await cli('activity', '--json')).historyFrom;
  expect(historyJson === oldestSeeded, `M9 fix 607: emmer activity --json's historyFrom is the oldest seeded line, ${oldestSeeded} (read ${historyJson})`);
  const spawn = async (name) => {
    const { session } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, name, cols: 100, rows: 30 });
    return session.id;
  };
  const a = await spawn('alpha');
  const b = await spawn('beta');
  const c = await spawn('plain-shell');
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 3`, 'three rows');
  // M66: the strip is the first section of the rail's Activity tab, no
  // longer a card in the sidebar; the pane is empty so the rail is on no
  // folder and the section shows every session with no scope toggle.
  expect(!(await s.evalJs(`!!document.querySelector('.sidebar .activity-card, .sidebar-list .activity-card')`)), 'no activity card in the sidebar (M66)');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'timeline'`, 'the rail on the Activity tab');
  expect((await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"] .rail-tab-label').textContent`)) === 'Activity', 'the tab reads Activity');
  await s.waitFor(`!!document.querySelector('.files-rail .activity-card[data-place="rail"] .activity-strip')`, 'the activity section in the rail with its strip');
  expect(!(await s.evalJs(`!!document.querySelector('.activity-card .activity-scope')`)), 'no scope toggle while the rail is on no folder');
  expect(await s.evalJs(`document.querySelector('.activity-card').nextElementSibling?.classList.contains('commits-panel')`), 'the commits panel is the section under it');
  // M9 fix 191: a shell that has posted nothing draws no span and takes
  // no track; the strip is bare until a hook lands.
  await s.waitFor(`document.querySelectorAll('.activity-card .activity-span').length === 0 && document.querySelectorAll('.activity-card .activity-track').length === 0`, 'no span and no track before any hook (M9 fix 191)');
  expect(!(await s.evalJs(`!!document.querySelector('.activity-span[data-lifetime]')`)), 'no lifetime span anywhere (M9 fix 191)');
  expect((await cardText()) === 'today · nothing yet', `the text says nothing yet before any session works, got ${await cardText()}`);
  const dayNow = await s.evalJs(`document.querySelector('.activity-card').dataset.sessions`);
  expect(dayNow === '3', `the card counts three sessions, got ${dayNow}`);
  // M74: no band while the peak is 0; a shell's lifetime is not agent time.
  expect(!(await s.evalJs(`!!document.querySelector('.activity-card .activity-load')`)), 'no load band before any session works (M74)');
  step('three shells: no span and no track on the card and nothing yet in the text, no load band (M9 fix 191)');

  // alpha works six seconds, beta the second half of them. Six rather
  // than two since M9 fix 191: alpha's live span is only on the card once
  // useActivity's 2 s debounce has fetched it (it used to ride the lifetime
  // span that was drawn before any hook), and beta's change restarts that
  // debounce, so the live read comes before beta starts and beta starts
  // late enough for the fetch to have landed.
  await post(a, { hook_event_name: 'SessionStart', source: 'startup' });
  await post(b, { hook_event_name: 'SessionStart', source: 'startup' });
  const t0 = Date.now();
  await post(a, { hook_event_name: 'UserPromptSubmit', prompt: 'find every caller of dropSession' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.state === 'working'`, 'alpha working');
  await s.waitFor(`document.querySelector('.activity-card .activity-span[data-session-id=${JSON.stringify(a)}][data-live]') !== null`, 'alpha has a live span while it works', 8000);
  expect((await s.evalJs(`document.querySelectorAll('.activity-card .activity-track').length`)) === 1, 'one track appears once a hook lands (M9 fix 191)');
  await sleep(Math.max(0, 3000 - (Date.now() - t0)));
  await post(b, { hook_event_name: 'UserPromptSubmit', prompt: 'plan the batch' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(b)}]')?.dataset.state === 'working'`, 'beta working');
  // M9 fix 207: the count running now, on the line after the peak and at
  // the head of the band's now line, off the store's working set over
  // the fetched rows: 2 once beta's span has been fetched, 1 the moment
  // alpha stops (the store, not a fetch, so beta's span barely grows),
  // 0 after beta's.
  await s.waitFor(`(document.querySelector('.activity-card .activity-text')?.textContent ?? '').includes('2 running now')`, 'two running now once beta is fetched', 8000);
  const nowCount = await s.evalJs(`(() => { const c = document.querySelector('.activity-card .activity-load .activity-now-count'); return c === null ? null : { text: c.textContent, flip: 'flip' in c.dataset, title: c.title }; })()`);
  expect(nowCount !== null && nowCount.text === '2×' && nowCount.title === '2 running now', `the band's now line carries 2× at its head, got ${JSON.stringify(nowCount)}`);
  await sleep(Math.max(0, 6000 - (Date.now() - t0)));
  await post(a, { hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`(document.querySelector('.activity-card .activity-text')?.textContent ?? '').includes('1 running now')`, 'one running now after alpha stops', 3000);
  await post(b, { hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(b)}]')?.dataset.state === 'done'`, 'beta done');
  expect((await rowState(a)) === 'done', 'alpha done');
  // The card has had a text since alpha's open span was fetched (M9 fix
  // 191, no lifetime row to wait behind), so the wait is for the fetch
  // that follows the Stops, not the first text with a figure in it.
  // The spans were timed by sleeps (alpha 6 s, beta 3 s inside it), so
  // the ratio reads 1.5 on a quiet box and 1.3 on a loaded one; the read
  // is that the line carries the closed spans' own ratio, the daemon's
  // figure for the same spans, with the overlap showing as more than 1.
  // `0 running now` lands off the store the moment beta stops, before
  // the fetch behind the 2 s debounce brings the closed spans, so the
  // wait is for the line to hold still across that debounce.
  await s.waitFor(`(() => { const t = document.querySelector('.activity-card .activity-text')?.textContent ?? ''; return /\\d\\.\\d× parallel/.test(t) && t.endsWith('0 running now'); })()`, 'the card has the closed spans after the Stops', 10000).catch(async (err) => {
    throw new Error(`${err.message}; the card reads ${JSON.stringify(await cardText())}; the CLI says ${JSON.stringify(JSON.parse(await cli('activity', '--json')).stats)}`);
  });
  // The line converges on the daemon's figure over the fetches behind the
  // Stops (one per change, a second or two apart on a loaded box), so the
  // read waits until the two agree to a tenth, up to fifteen seconds.
  let text = await cardText();
  let statsAfterStops = JSON.parse(await cli('activity', '--json')).stats;
  let parallelOnLine = Number(/(\d\.\d)× parallel/.exec(text)?.[1] ?? 'NaN');
  for (let i = 0; i < 10 && !(Math.abs(parallelOnLine - statsAfterStops.parallel) < 0.1 && text.includes(`${Math.round(statsAfterStops.agentMs / 1000)}s agent time`)); i++) {
    await sleep(1500);
    text = await cardText();
    statsAfterStops = JSON.parse(await cli('activity', '--json')).stats;
    parallelOnLine = Number(/(\d\.\d)× parallel/.exec(text)?.[1] ?? 'NaN');
  }
  expect(parallelOnLine > 1 && Math.abs(parallelOnLine - statsAfterStops.parallel) < 0.1 && text.includes('peak 2'), `the text says the closed spans' parallelism (${statsAfterStops.parallel.toFixed(2)}, 1.5 on a quiet box) with a peak of 2, got ${text}`);
  expect(text.endsWith('peak 2 · 0 running now'), `the count stays on the line at 0 once both have stopped (M9 fix 207), got ${text}`);
  expect((await s.evalJs(`document.querySelector('.activity-card .activity-load .activity-now-count')?.textContent ?? null`)) === '0×', 'the band reads 0× at the now line');
  // M73 task 4: the line opens its card, each number with its meaning,
  // in place of the two-line tooltip; the line carries no title.
  expect((await s.evalJs(`document.querySelector('.activity-card .activity-text').getAttribute('title')`)) === null, 'the activity line carries no tooltip; the card is the tooltip (M73)');
  const lineAt = await s.evalJs(`(() => { const r = document.querySelector('.activity-card .activity-text').getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 }; })()`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: lineAt.x, y: lineAt.y });
  await s.waitFor(`!!document.querySelector('.activity-text-popover')`, 'the activity line opens its card on hover', 3000);
  const lineCard = await s.evalJs(`(() => { const c = document.querySelector('.activity-text-popover'); return { line: document.querySelector('.activity-card .activity-text').textContent, heading: c.querySelector('.sweep-card-heading').textContent, stats: [...c.querySelectorAll('[data-part="stat"]')].map((l) => [l.querySelector('.sweep-card-label').textContent, l.querySelector('.sweep-card-text').textContent]), note: c.querySelector('.sweep-card-note').textContent }; })()`);
  // Read in the same instant as the line, since a fetch behind the Stops can still move it by a second.
  expect(lineCard.heading === lineCard.line, `the card's heading is the line, got ${JSON.stringify([lineCard.heading, lineCard.line])}`);
  expect(lineCard.stats.length === 5 && lineCard.stats[2][0] === `${parallelOnLine.toFixed(1)}× parallel` && lineCard.stats[3][0] === 'peak 2' && lineCard.stats[0][1].startsWith('the sum of the stretches') && lineCard.stats[1][1].startsWith('the wall time'), `each number carries its meaning, got ${JSON.stringify(lineCard.stats)}`);
  expect(lineCard.stats[4][0] === '0 running now' && lineCard.stats[4][1] === 'the sessions working at this instant', `the count running now carries its meaning (M9 fix 207), got ${JSON.stringify(lineCard.stats[4])}`);
  expect(/^\d+ sessions in the window/.test(lineCard.note), `the note counts the sessions, got ${JSON.stringify(lineCard.note)}`);
  await s.click(lineAt.x, lineAt.y);
  await s.waitFor(`document.querySelector('.activity-card .activity-text').dataset.popoverOpen === 'pinned'`, 'a click pins the card');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.activity-text-popover')`, 'Escape closes it');
  step('M73 task 4: the activity line opens its card, the five numbers each with their meaning and the session count, pinned by a click; no title on the line');
  const sa = await spanOf(a);
  const sb = await spanOf(b);
  const sc = await spanOf(c);
  expect(sa !== null && sb !== null, 'a span for each session that worked');
  expect(sc === null, 'the plain shell draws no span (M9 fix 191)');
  expect(!sa.live && !sb.live, 'no span is live once both have stopped');
  // Seconds on an axis of hours: the widths are read as the percentages
  // the strip sets, since on screen both sit at the 2px floor. The two
  // were timed at 6 s and 3 s, twice on a quiet box, but beta's Stop
  // waits behind a render and lands late on a loaded one, so the widths
  // are read against the daemon's own spans rather than the two-to-one.
  const ratio = sa.width / sb.width;
  const spansCli = JSON.parse(await cli('activity', '--json')).sessions;
  const spanMs = (id) => { const sp = spansCli.find((x) => x.sessionId === id)?.spans?.[0]; return sp ? sp.to - sp.from : NaN; };
  const ratioCli = spanMs(a) / spanMs(b);
  expect(ratio > 1.2 && Math.abs(ratio - ratioCli) < 0.15 * ratioCli, `alpha's span is about twice beta's and the widths follow the daemon's spans (${ratioCli.toFixed(2)}), got ${sa.width.toFixed(3)}% over ${sb.width.toFixed(3)}%`);
  expect(sb.left > sa.left && sb.left < sa.left + sa.width, 'beta starts inside alpha');
  expect(sa.px >= 2 && sb.px >= 2, 'a span never draws thinner than its floor');
  expect(sa.title.includes('alpha') && sa.title.includes('find every caller of dropSession'), `the hover carries the name and the prompt, got ${JSON.stringify(sa.title)}`);
  const colorA = await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.color ?? null`);
  expect(colorA !== null, 'alpha has a colour');
  await s.screenshot('m54-activity-card.png');
  step(`two spans overlapping by half: ${text}, widths ${sa.width.toFixed(3)}% and ${sb.width.toFixed(3)}%, the shell dim`);

  // M74: the load band above the card's tracks, a 16px strip on the
  // rail whose viewBox is the peak (2), the median on the card as the two
  // spans' widths give it (1 when the time alpha or beta worked alone is
  // at least the overlap, else 2; the waits above stretch alpha), no
  // legend and no crosshair on the card, and no live dot on a span.
  const overlap = Math.max(0, Math.min(sa.left + sa.width, sb.left + sb.width) - Math.max(sa.left, sb.left));
  // The fixture puts the solo time and the overlap at the same length
  // by design (alpha twice beta, beta starting halfway), so the drawn
  // percentages and the daemon's milliseconds can land on either side
  // of the tie; within a tenth of the overlap either median is right
  // (M9 fix 165's runs under five worktrees failed both ways here).
  const solo = sa.width + sb.width - 2 * overlap;
  const expectedMedian = Math.abs(solo - overlap) < overlap / 10 ? null : solo >= overlap ? '1' : '2';
  const cardBand = await s.evalJs(`(() => { const card = document.querySelector('.activity-card'); const b = card.querySelector('.activity-load'); const strip = card.querySelector('.activity-strip'); if (!b) return null; const br = b.getBoundingClientRect(); const sr = strip.getBoundingClientRect(); return { peak: b.dataset.peak, median: card.dataset.median, h: br.height, left: br.left, width: br.width, stripLeft: sr.left, stripWidth: sr.width, viewBox: b.querySelector('svg').getAttribute('viewBox'), fill: b.querySelector('.activity-load-fill').getAttribute('fill-opacity'), line: b.querySelector('.activity-load-line').getAttribute('d'), legend: !!card.querySelector('.activity-view-load-legend'), cross: !!card.querySelector('.activity-cross'), dot: getComputedStyle(strip.querySelector('.activity-span'), '::after').content, tracks: strip.querySelectorAll('.activity-track').length, rules: b.querySelectorAll('.activity-load-rule').length, peakLine: !!b.querySelector('.activity-load-peak'), border: getComputedStyle(b).borderBottomWidth, dataRules: b.dataset.rules }; })()`);
  expect(cardBand !== null, 'the card draws a load band once a session has worked');
  expect(cardBand.peak === '2' && (expectedMedian === null ? cardBand.median === '1' || cardBand.median === '2' : cardBand.median === expectedMedian) && cardBand.viewBox === '0 0 100 2', `the band's peak is the stats line's and the median is ${expectedMedian ?? '1 or 2 (a tie)'}, got ${JSON.stringify(cardBand)}`);
  // M9 fix 167: the card's band follows its tracks, `tracks * 5` between
  // a floor of 10 and the mock's 16 (two tracks here, so 10), bare: no
  // grey rule and no border, the mock's card (and no dashed peak line
  // anywhere since M9 fix 177).
  const expectedBand = Math.min(16, Math.max(10, cardBand.tracks * 5));
  expect(Math.abs(cardBand.h - expectedBand) <= 1 && Math.abs(cardBand.left - cardBand.stripLeft) < 0.5 && Math.abs(cardBand.width - cardBand.stripWidth) < 0.5, `${expectedBand}px for ${cardBand.tracks} tracks, on the tracks' left edge and width, got ${JSON.stringify(cardBand)}`);
  expect(cardBand.rules === 0 && !cardBand.peakLine && cardBand.border === '0px' && cardBand.dataRules === 'off', `the card's band is bare: no rules, no peak line, no border, got ${JSON.stringify(cardBand)}`);
  expect(cardBand.fill === '0.2' && !cardBand.legend && !cardBand.cross, `the rail's fill at .2 with no legend and no crosshair, got ${JSON.stringify(cardBand)}`);
  expect(/^M0,2 L0,2/.test(cardBand.line) && cardBand.line.includes(',0 L') && cardBand.line.endsWith(',2'), `the outline opens and closes on the baseline and reaches the peak, got ${JSON.stringify(cardBand.line)}`);
  expect(cardBand.dot === 'none', `no live dot on a span any more (M74), got ${JSON.stringify(cardBand.dot)}`);
  step(`M74 and fix 167: the card draws a bare ${expectedBand}px load band for ${cardBand.tracks} tracks on the tracks' edge, peak 2, median ${expectedMedian ?? cardBand.median}, no legend or crosshair, and the live dot is gone`);
  await s.screenshot('m9-fix167-card.png');

  // The fold keeps the text and drops the strip; it is kept across a reload.
  // The line is read again first, since a fetch behind the Stops can
  // still have moved it by a second since the settle above.
  text = await cardText();
  await s.evalJs(`document.querySelector('.activity-card .activity-fold').click()`);
  await s.waitFor(`'folded' in document.querySelector('.activity-card').dataset && !document.querySelector('.activity-card .activity-strip')`, 'folded to the text line');
  expect((await cardText()) === text, 'the text stays when folded');
  expect(await s.evalJs(`localStorage.getItem('emerald.activityFolded') === '1'`), 'the fold is kept');
  await s.evalJs(`document.querySelector('.activity-card .activity-fold').click()`);
  await s.waitFor(`!!document.querySelector('.activity-card .activity-strip')`, 'unfolded');
  step('the chevron folds the card to its text line and back');

  // M9 fix 168: the pills and the open buttons sit on a controls line of
  // their own under the head, which the head's ⋯ folds away and brings
  // back, the flag kept across a reload; the head line keeps the fold,
  // the text and the ⋯.
  const cardTools = () => s.evalJs(`(() => { const c = document.querySelector('.activity-card[data-place="rail"]'); const line = c.querySelector('.activity-card-tools'); const head = c.querySelector('.activity-card-head'); return { tools: c.dataset.tools, line: !!line, pills: line ? line.querySelectorAll('.activity-unit-pick, .activity-scope').length : 0, opens: line ? line.querySelectorAll('.activity-expand').length : 0, icons: line ? line.querySelectorAll('.activity-expand svg.open-icon').length : 0, glyphText: line ? [...line.querySelectorAll('.activity-expand')].map((b) => b.textContent.trim()).join('') : null, headPills: head.querySelectorAll('.activity-unit-pick, .activity-scope, .activity-expand').length, headText: !!head.querySelector('.activity-text'), toggle: head.querySelector('.activity-card-tools-toggle')?.title ?? null, active: 'active' in (head.querySelector('.activity-card-tools-toggle')?.dataset ?? {}), kept: localStorage.getItem('emerald.activityCardTools') }; })()`);
  let toolsRead = await cardTools();
  expect(toolsRead.tools === 'shown' && toolsRead.line && toolsRead.pills >= 1 && toolsRead.opens === 2 && toolsRead.headPills === 0 && toolsRead.headText && toolsRead.toggle === 'Hide the controls' && toolsRead.active, `the controls line under the head holds the pills and the two open buttons, the head none of them (${JSON.stringify(toolsRead)})`);
  // M9 fix 219: both open buttons wear an icon (tab, pane), no text glyph.
  expect(toolsRead.icons === 2 && toolsRead.glyphText === '', `the card's two open buttons carry a tab icon and a pane icon (${JSON.stringify({ icons: toolsRead.icons, glyphText: toolsRead.glyphText })})`);
  await s.screenshot('m9-fix219-open-icons.png');
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-card-tools-toggle').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.tools === 'folded'`, 'the controls line folded');
  toolsRead = await cardTools();
  expect(!toolsRead.line && toolsRead.headPills === 0 && toolsRead.headText && toolsRead.toggle === 'Show the controls' && !toolsRead.active && toolsRead.kept === 'folded' && (await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-strip') !== null`)), `folded, the head line whole and the strip still drawn (${JSON.stringify(toolsRead)})`);
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.tools === 'folded'`, 'still folded after a reload', 15000);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-card-tools-toggle').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.tools === 'shown' && !!document.querySelector('.activity-card[data-place="rail"] .activity-card-tools')`, 'the controls line back');
  await s.screenshot('m9-fix168-card-tools.png');
  step("M9 fix 168: the card's controls line folds away behind the head's ⋯, stays folded over a reload and comes back");

  // The card's layers button (fix 168, the fix 166 control with a key of
  // the card's own): the band alone, the lanes alone, both, the choice
  // kept over a reload and the stats line the caption throughout.
  const cardLayers = () => s.evalJs(`(() => { const c = document.querySelector('.activity-card[data-place="rail"]'); return { layers: c.dataset.layers, band: c.querySelector('.activity-load') !== null, strip: c.querySelector('.activity-strip') !== null, text: c.querySelector('.activity-text') !== null, button: c.querySelector('.activity-card-tools .activity-card-layers')?.dataset.layers ?? null, kept: localStorage.getItem('emerald.activityCardLayers') }; })()`);
  let layersRead = await cardLayers();
  expect(layersRead.layers === 'both' && layersRead.band && layersRead.strip && layersRead.button === 'both', `both layers to begin with (${JSON.stringify(layersRead)})`);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-card-layers').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.layers === 'band'`, 'the band alone');
  layersRead = await cardLayers();
  expect(layersRead.band && !layersRead.strip && layersRead.text && layersRead.kept === 'band', `the band alone keeps the text and drops the strip (${JSON.stringify(layersRead)})`);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-card-layers').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.layers === 'lanes'`, 'the lanes alone');
  layersRead = await cardLayers();
  expect(!layersRead.band && layersRead.strip && layersRead.text && layersRead.kept === 'lanes', `the lanes alone keep the text and drop the band (${JSON.stringify(layersRead)})`);
  await s.screenshot('m9-fix168-card-lanes.png');
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.layers === 'lanes'`, 'still the lanes alone after a reload', 15000);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-card-layers').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.layers === 'both' && !!document.querySelector('.activity-card[data-place="rail"] .activity-load') && !!document.querySelector('.activity-card[data-place="rail"] .activity-strip')`, 'both layers again');
  step("M9 fix 168: the card's layers button cycles the band alone, the lanes alone and both, kept over a reload");

  // Expand: the day as a tab, a named row per session, the prompt under hover.
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.state === 'ready'`, 'the activity tab');
  const day = await s.evalJs(`document.querySelector('.activity-view').dataset.day`);
  expect(/^\d{4}-\d{2}-\d{2}$/.test(day), `the tab names its day, got ${day}`);
  const tabPath = `emerald://activity/${day}`;
  expect(await s.evalJs(`!!document.querySelector('.tab-file[data-tab=${JSON.stringify(tabPath)}][data-active] .tab-icon')`), 'the tab is active in the strip with an icon');
  expect((await s.evalJs(`document.querySelector('.tab-file[data-tab=${JSON.stringify(tabPath)}] .tab-name')?.textContent`)) === `Activity ${day}`, 'the tab is named after the day');
  const names = await s.evalJs(`[...document.querySelectorAll('.activity-view .activity-view-name')].map(n => n.textContent)`);
  expect(names.length === 2 && names.includes('alpha') && names.includes('beta'), `a named row per session that worked, none for the plain shell (M9 fix 191), got ${JSON.stringify(names)}`);
  const viewTitle = await s.evalJs(`document.querySelector('.activity-view .activity-span[data-session-id=${JSON.stringify(b)}]')?.title ?? null`);
  expect(viewTitle !== null && viewTitle.includes('plan the batch'), `the tab's hover carries the prompt, got ${JSON.stringify(viewTitle)}`);
  const stats = await s.evalJs(`document.querySelector('.activity-view-stats')?.textContent ?? ''`);
  expect(stats.includes(`${parallelOnLine.toFixed(1)}× parallel`), `the tab's stats line agrees with the card, got ${stats}`);
  // M9 fix 207: the tab is on the clock, so its line and its band carry the count too.
  expect(stats.endsWith('· 0 running now'), `the tab's line carries the count running now, got ${stats}`);
  expect((await s.evalJs(`document.querySelector('.activity-view .activity-load .activity-now-count')?.textContent ?? null`)) === '0×', "the tab's band reads 0× at its now line");
  // M9 fix 607: the tab says how far back the history goes.
  const historyLine = await s.evalJs(`(() => { const el = document.querySelector('.activity-view[data-place="tab"] .activity-view-history'); return el ? { text: el.textContent, from: Number(el.dataset.from) } : null; })()`);
  expect(historyLine !== null && historyLine.text === historyWant() && historyLine.from === oldestSeeded, `M9 fix 607: the tab's history line reads ${historyWant()} at ${oldestSeeded}, got ${JSON.stringify(historyLine)}`);
  step(`M9 fix 607: the history reaches back to the oldest seeded line, ${historyWant()}, in the daemon log, the CLI and the tab, and folds away with the pane header`);
  await s.screenshot('m54-activity-tab.png');
  step(`Expand: the tab ${tabPath} with rows ${names.join(', ')}`);

  // M74: the band on the tab beside its legend, on the strip's edge; the
  // lanes' bars at 4px; the crosshair from a synthetic move to the middle
  // of the overlap reads two running, its count the spans under it, and a
  // pointerout clears it (React derives onPointerLeave from pointerout,
  // so a synthetic pointerleave does nothing).
  const tabBand = await s.evalJs(`(() => { const v = document.querySelector('.activity-view'); const b = v.querySelector('.activity-load'); const strip = v.querySelector('.activity-strip'); const legend = v.querySelector('.activity-view-load-legend'); if (!b || !legend) return null; const br = b.getBoundingClientRect(); const sr = strip.getBoundingClientRect(); const span = v.querySelector('.activity-span[data-session-id=${JSON.stringify(a)}]'); return { peak: b.dataset.peak, h: br.height, left: br.left, width: br.width, stripLeft: sr.left, stripWidth: sr.width, legend: [...legend.querySelectorAll('span')].map((e) => e.textContent), legendWidth: legend.getBoundingClientRect().width, fill: b.querySelector('.activity-load-fill').getAttribute('fill-opacity'), barH: span.getBoundingClientRect().height, barW: span.getBoundingClientRect().width, radius: getComputedStyle(span).borderRadius }; })()`);
  expect(tabBand !== null, 'the tab draws the band with its legend');
  expect(tabBand.peak === '2' && Math.abs(tabBand.h - 65) <= 1 && Math.abs(tabBand.left - tabBand.stripLeft) < 0.5 && Math.abs(tabBand.width - tabBand.stripWidth) < 0.5 && tabBand.fill === '0.15', `64px plus its rule on the strip's edge at .15, got ${JSON.stringify(tabBand)}`);
  expect(JSON.stringify(tabBand.legend) === JSON.stringify(['agents at once', 'peak 2', `median ${expectedMedian ?? cardBand.median} while busy`]) && tabBand.legendWidth === 160, `the legend reads the label, the peak and the median in the names gutter's width, got ${JSON.stringify(tabBand)}`);
  expect(tabBand.barH === 4 && tabBand.barW >= 4 && tabBand.radius === '2px', `a lane bar is 4px with a round cap and a 4px floor, got ${JSON.stringify(tabBand)}`);
  const crossed = await s.evalJs(`(() => { const v = document.querySelector('.activity-view'); const strip = v.querySelector('.activity-strip'); const r = strip.getBoundingClientRect(); const spans = [...v.querySelectorAll('.activity-span')].map((e) => ({ left: parseFloat(e.style.left), width: parseFloat(e.style.width) })); const later = spans.reduce((m, x) => Math.max(m, x.left), 0); const end = spans.reduce((m, x) => Math.min(m, x.left + x.width), 100); const p = (later + end) / 2; const under = spans.filter((x) => x.left <= p && p < x.left + x.width).length; strip.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + (r.width * p) / 100, clientY: r.top + 4, bubbles: true })); return { p, under }; })()`);
  await s.waitFor(`document.querySelector('.activity-view').dataset.cross !== undefined`, 'the crosshair after a synthetic move');
  const readout = await s.evalJs(`(() => { const v = document.querySelector('.activity-view'); const lines = [...v.querySelectorAll('.activity-cross')].map((e) => e.style.left); const ro = v.querySelector('.activity-ticks .activity-cross-readout'); return { cross: v.dataset.cross, lines, text: ro?.textContent ?? null, left: ro?.style.left ?? null, bg: ro ? getComputedStyle(ro).backgroundColor : null, cursor: getComputedStyle(v.querySelector('.activity-view-time')).cursor, events: getComputedStyle(v.querySelector('.activity-load-svg')).pointerEvents }; })()`);
  expect(Math.abs(parseFloat(readout.cross) - crossed.p) < 0.05, `data-cross holds the percent of the move, got ${readout.cross} for ${crossed.p}`);
  expect(readout.lines.length === 2 && readout.lines.every((l) => Math.abs(parseFloat(l) - crossed.p) < 0.05), `a hairline in the band and one over the lanes at the same percent, got ${JSON.stringify(readout.lines)}`);
  expect(crossed.under === 2 && /^\d\d:\d\d · 2 running$/.test(readout.text), `the readout says the time and 2 running in the overlap (${crossed.under} spans under it), got ${JSON.stringify(readout.text)}`);
  expect(readout.left !== null && Math.abs(parseFloat(readout.left) - crossed.p) < 0.05, `the readout sits at the percent on the tick row, got ${readout.left}`);
  expect(readout.bg !== 'rgba(0, 0, 0, 0)' && readout.cursor === 'crosshair' && readout.events === 'none', `the readout has a ground, the region a crosshair cursor and the band's drawing takes no pointer, got ${JSON.stringify(readout)}`);
  await s.evalJs(`document.querySelector('.activity-view .activity-strip').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))`);
  await s.waitFor(`document.querySelector('.activity-view').dataset.cross === undefined && !document.querySelector('.activity-view .activity-cross')`, 'the crosshair leaves with the pointer');
  step(`M74: the tab's band beside its legend (${tabBand.legend.join(' / ')}), 4px bars, and the crosshair at ${crossed.p.toFixed(2)}% reads ${readout.text}, gone on pointerout`);

  // The strip turned vertical: the spans are placed by top and height.
  await s.evalJs(`document.querySelector('.activity-view .activity-orientation').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.orientation === 'vertical'`, 'vertical');
  const vertical = await s.evalJs(
    `(() => { const el = document.querySelector('.activity-view .activity-span[data-session-id=${JSON.stringify(a)}]'); const strip = document.querySelector('.activity-view .activity-strip').getBoundingClientRect(); return { top: el.style.top, height: el.style.height, left: el.style.left, stripW: strip.width, stripH: strip.height, ticks: document.querySelectorAll('.activity-view .activity-tick').length }; })()`,
  );
  // A span of seconds sits at its 2px floor either way; what turns is the
  // placement (top and height in percent, no left) and the strip's box:
  // forty pixels per tick step, which just after midnight is one step,
  // shorter than the three named columns are wide, so the length is read
  // against the ticks rather than the width.
  const steps = Math.max(1, vertical.ticks - 1);
  expect(vertical.top.endsWith('%') && vertical.height.endsWith('%') && vertical.left === '' && Math.abs(vertical.stripH - steps * 40) < 2, `the span runs downwards, got ${JSON.stringify(vertical)}`);
  expect(await s.evalJs(`localStorage.getItem('emerald.activityView') === 'vertical'`), 'the orientation is kept');
  // M74: the vertical form has no band and no crosshair, and its spans
  // keep the 2px line.
  const verticalBand = await s.evalJs(`(() => { const v = document.querySelector('.activity-view'); return { band: !!v.querySelector('.activity-load'), legend: !!v.querySelector('.activity-view-load-legend'), region: !!v.querySelector('.activity-view-time'), barW: v.querySelector('.activity-span[data-session-id=${JSON.stringify(a)}]').getBoundingClientRect().width }; })()`);
  expect(!verticalBand.band && !verticalBand.legend && !verticalBand.region && verticalBand.barW === 2, `no band, legend or crosshair region when vertical and the span stays 2px, got ${JSON.stringify(verticalBand)}`);
  await s.screenshot('m54-activity-vertical.png');
  await s.evalJs(`document.querySelector('.activity-view .activity-orientation').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.orientation === 'horizontal'`, 'horizontal again');
  step('the ⇅ turns time downwards and back');

  // M9 fix 213: Ctrl+wheel over the tab's time region zooms the strip, a
  // width factor on its box under the body's sideways scroll, so the axis
  // and the ticks stretch and the day reads at a finer grain; the plain
  // wheel does not. Read as the time box's width against the body's.
  const zoomProbe = () =>
    s.evalJs(
      `(() => { const v = document.querySelector('.activity-view'); const body = v.querySelector('.activity-view-body'); const time = v.querySelector('.activity-view-time'); return { scale: +v.dataset.stripScale, timeW: Math.round(time.getBoundingClientRect().width), bodyW: Math.round(body.clientWidth), scrollW: body.scrollWidth, pref: Number(localStorage.getItem('emerald.activityScale')) || 1 }; })()`,
    );
  const timeAt = await s.evalJs(`(() => { const r = document.querySelector('.activity-view .activity-view-time').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 8) }; })()`);
  const z0 = await zoomProbe();
  expect(z0.scale === 1 && z0.timeW <= z0.bodyW + 1, `the strip starts at scale 1, its box within the body (${JSON.stringify(z0)})`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: timeAt.x, y: timeAt.y, deltaX: 0, deltaY: -120, modifiers: 2 });
  await s.waitFor(`+document.querySelector('.activity-view').dataset.stripScale > 1`, 'the Ctrl+wheel zooms the strip in', 4000).catch(async () => {
    // The same dropped-wheel case as the step back below.
    await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: timeAt.x, y: timeAt.y, deltaX: 0, deltaY: -120, modifiers: 2 });
    await s.waitFor(`+document.querySelector('.activity-view').dataset.stripScale > 1`, 'the Ctrl+wheel zooms the strip in (second wheel)', 4000);
  });
  const zUp = await zoomProbe();
  expect(zUp.scale === 1.25 && Math.abs(zUp.timeW / z0.timeW - 1.25) < 0.03 && zUp.scrollW > zUp.bodyW && zUp.pref === 1.25, `one step in, the strip box is 1.25x wider and the body scrolls sideways, the pref set (${JSON.stringify([z0, zUp])})`);
  await s.screenshot('m9-fix213-strip-zoom.png');
  await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: timeAt.x, y: timeAt.y, deltaX: 0, deltaY: -120, modifiers: 0 });
  await sleep(200);
  expect((await zoomProbe()).scale === 1.25, 'a plain wheel does not change the strip zoom');
  await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: timeAt.x, y: timeAt.y, deltaX: 0, deltaY: 120, modifiers: 2 });
  // A wheel event under a clocked-down box is dropped now and then (three
  // reruns at the close-out of fixes 329 to 351, the zoom in landing and
  // the zoom back not), so the step back gets a second wheel at the time
  // row's current centre before it is a failure.
  await s.waitFor(`+document.querySelector('.activity-view').dataset.stripScale === 1`, 'a Ctrl+wheel down steps the strip zoom back to 1', 4000).catch(async () => {
    const again = await s.evalJs(`(() => { const r = document.querySelector('.activity-view .activity-view-time').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 8) }; })()`);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: again.x, y: again.y, deltaX: 0, deltaY: 120, modifiers: 2 });
    await s.waitFor(`+document.querySelector('.activity-view').dataset.stripScale === 1`, 'a Ctrl+wheel down steps the strip zoom back to 1 (second wheel)', 4000);
  });
  const zBack = await zoomProbe();
  expect(zBack.scale === 1 && Math.abs(zBack.timeW - z0.timeW) < 2, `back at scale 1, the box its starting width again (${JSON.stringify([z0, zBack])})`);
  step('M9 fix 213: Ctrl+wheel over the activity strip zooms its box wider under a sideways scroll, the plain wheel still scrolling');


  // M9 fix 120: the density button packs the rows onto the card's tracks
  // (the same packing, the same 5px height, no names column) and back,
  // the choice kept across a reload.
  const density = () => s.evalJs(`(() => { const v = document.querySelector('.activity-view'); return { density: v?.dataset.density ?? null, tracks: v?.querySelectorAll('.activity-strip .activity-track').length ?? 0, names: !!v?.querySelector('.activity-view-names'), height: v?.querySelector('.activity-strip .activity-track')?.getBoundingClientRect().height ?? null, active: !!v?.querySelector('.activity-density[data-active]'), card: document.querySelectorAll('.activity-card .activity-strip .activity-track').length }; })()`);
  let dens = await density();
  expect(dens.density === 'rows' && dens.names && dens.tracks === 2 && !dens.active, `a row per session that worked before the toggle (${JSON.stringify(dens)})`);
  await s.evalJs(`document.querySelector('.activity-view .activity-density').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.density === 'condensed'`, 'condensed');
  dens = await density();
  expect(!dens.names && dens.tracks === dens.card && dens.height === 5 && dens.active, `packed onto the card's ${dens.card} tracks at 5px with no names column (${JSON.stringify(dens)})`);
  // M74: packed, the band keeps the tracks' edge with no legend, and the
  // bars keep the card's 2px line.
  const packedBand = await s.evalJs(`(() => { const v = document.querySelector('.activity-view'); const b = v.querySelector('.activity-load'); const sr = v.querySelector('.activity-strip').getBoundingClientRect(); const br = b.getBoundingClientRect(); return { legend: !!v.querySelector('.activity-view-load-legend'), left: br.left, stripLeft: sr.left, width: br.width, stripWidth: sr.width, barH: v.querySelector('.activity-span[data-session-id=${JSON.stringify(a)}]').getBoundingClientRect().height, h: br.height, tracks: v.querySelectorAll('.activity-strip .activity-track').length, fill: b.querySelector('.activity-load-fill').getAttribute('fill-opacity'), rules: b.querySelectorAll('.activity-load-rule').length, peak: !!b.querySelector('.activity-load-peak'), border: getComputedStyle(b).borderBottomWidth, data: b.dataset.rules }; })()`);
  expect(!packedBand.legend && Math.abs(packedBand.left - packedBand.stripLeft) < 0.5 && Math.abs(packedBand.width - packedBand.stripWidth) < 0.5 && packedBand.barH === 2, `packed, the band spans the tracks with no legend and the bars are 2px, got ${JSON.stringify(packedBand)}`);
  // M9 fix 165: packed, the band follows the strip, a track's 5px per
  // track between 16 and 22, drawn as the mock's condensed strip, the
  // fill at .18 and its line, no grey rules and no border (and no peak
  // line since M9 fix 177, in any form).
  const packedWant = Math.min(22, Math.max(16, packedBand.tracks * 5));
  expect(Math.abs(packedBand.h - packedWant) < 0.5, `packed, the band is ${packedWant}px for ${packedBand.tracks} tracks, got ${JSON.stringify(packedBand)}`);
  expect(packedBand.fill === '0.18' && packedBand.rules === 0 && !packedBand.peak && packedBand.border === '0px' && packedBand.data === 'off', `packed, the fill at .18, no peak line, no rules and no border, got ${JSON.stringify(packedBand)}`);
  await s.screenshot('m9-fix165-packed.png');
  const packedTitle = await s.evalJs(`document.querySelector('.activity-view .activity-span[data-session-id=${JSON.stringify(a)}]')?.title ?? null`);
  expect(packedTitle !== null && packedTitle.includes('alpha'), `the hover still names the session when packed, got ${JSON.stringify(packedTitle)}`);
  expect(await s.evalJs(`localStorage.getItem('emerald.activityDensity') === 'condensed'`), 'the density is kept');
  await s.screenshot('m9-fix120-condensed.png');
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.state === 'ready'`, 'the tab back after a reload');
  dens = await density();
  expect(dens.density === 'condensed' && !dens.names, `still condensed after a reload (${JSON.stringify(dens)})`);
  await s.evalJs(`document.querySelector('.activity-view .activity-density').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.density === 'rows'`, 'rows again');
  dens = await density();
  expect(dens.names && dens.tracks === 2 && dens.height === 18, `a named row per session again (${JSON.stringify(dens)})`);
  const rowsBand = await s.evalJs(`(() => { const b = document.querySelector('.activity-view .activity-load'); return { h: b.getBoundingClientRect().height, rules: b.querySelectorAll('.activity-load-rule').length, fill: b.querySelector('.activity-load-fill').getAttribute('fill-opacity'), border: getComputedStyle(b).borderBottomWidth }; })()`);
  expect(Math.abs(rowsBand.h - 65) < 0.5 && rowsBand.rules === 2 && rowsBand.fill === '0.15' && rowsBand.border === '1px', `the rows density keeps its 64px band (65 with its border) with its rules, got ${JSON.stringify(rowsBand)}`);
  step('M9 fix 120: the density button packs the tab onto the card\'s tracks and back, kept across a reload');
  step(`M9 fix 165: packed, the band is ${packedWant}px over ${packedBand.tracks} tracks, bare, and 64px with its rules in rows`);

  // M9 fix 192: the scroll is kept across a density toggle as a fraction
  // of the scrollable height, and an orientation flip lands at the end the
  // form reads from (the now end downwards while the view follows the
  // clock, the start across). Two rows never overflow a tab, so the body
  // is pinned short for the step and released after; the values are set
  // and read directly, since no scroll event need arrive under a harness.
  const place = () => s.evalJs(`(() => { const el = document.querySelector('.activity-view-body'); const room = el.scrollHeight - el.clientHeight; return { top: el.scrollTop, room, frac: room > 0 ? el.scrollTop / room : null }; })()`);
  await s.evalJs(`document.querySelector('.activity-view-body').style.maxHeight = '60px'`);
  await s.evalJs(`(() => { const el = document.querySelector('.activity-view-body'); el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); })()`);
  const rowsAt = await place();
  expect(rowsAt.room > 30 && rowsAt.frac !== null && Math.abs(rowsAt.frac - 0.5) < 0.1, `the pinned body scrolls and sits halfway (${JSON.stringify(rowsAt)})`);
  await s.evalJs(`document.querySelector('.activity-view .activity-density').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.density === 'condensed'`, 'condensed');
  const packedAt = await place();
  expect(packedAt.frac === null || Math.abs(packedAt.frac - rowsAt.frac) <= Math.max(0.15, 18 / packedAt.room), `packed, the same place within a row (${JSON.stringify(packedAt)})`);
  await s.evalJs(`document.querySelector('.activity-view .activity-density').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.density === 'rows'`, 'rows again');
  const backAt = await place();
  expect(backAt.frac !== null && Math.abs(backAt.frac - rowsAt.frac) <= 18 / backAt.room, `rows again, the row under the middle where it was (${JSON.stringify(backAt)})`);
  await s.evalJs(`document.querySelector('.activity-view .activity-orientation').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.orientation === 'vertical'`, 'vertical');
  const downAt = await place();
  expect(downAt.room > 30 && Math.abs(downAt.top - downAt.room) <= 1, `turned downwards while following the clock, the box shows the now end (${JSON.stringify(downAt)})`);
  await s.evalJs(`document.querySelector('.activity-view .activity-orientation').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.orientation === 'horizontal'`, 'horizontal again');
  const acrossAt = await place();
  expect(acrossAt.top === 0, `turned back across, the box shows the start (${JSON.stringify(acrossAt)})`);
  await s.evalJs(`document.querySelector('.activity-view-body').style.maxHeight = ''`);
  step('M9 fix 192: the scroll keeps its place across a density toggle and lands at the end a flip reads from');

  // M9 fix 166: the layers button cycles both, the band alone (the tick
  // row stays, its tracks and names gone, the stats line and the
  // crosshair kept) and the lanes alone, kept across a reload, and
  // waits disabled in the vertical form.
  const layers = () => s.evalJs(`(() => { const v = document.querySelector('.activity-view'); const b = v.querySelector('.activity-layers'); return { layers: v.dataset.layers ?? null, button: b?.dataset.layers ?? null, disabled: b?.disabled ?? null, title: b?.title ?? null, band: !!v.querySelector('.activity-load'), tracks: v.querySelectorAll('.activity-strip .activity-track').length, ticks: v.querySelectorAll('.activity-strip .activity-tick').length, names: v.querySelectorAll('.activity-view-name').length, gutter: !!v.querySelector('.activity-view-names'), stats: v.querySelector('.activity-view-stats')?.textContent ?? null, icon: b?.querySelectorAll('svg path, svg rect').length ?? 0 }; })()`);
  let lay = await layers();
  expect(lay.layers === 'both' && lay.button === 'both' && !lay.disabled && lay.title === 'Show the band alone' && lay.band && lay.tracks === 2 && lay.names === 2 && lay.icon === 3, `both layers to start, the button offering the band alone (${JSON.stringify(lay)})`);
  await s.evalJs(`document.querySelector('.activity-view .activity-layers').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.layers === 'band'`, 'the band alone');
  lay = await layers();
  expect(lay.band && lay.tracks === 0 && lay.names === 0 && lay.gutter && lay.ticks > 0 && lay.stats !== null && lay.stats.includes('peak 2') && lay.title === 'Show the lanes alone' && lay.icon === 1, `the band alone keeps the tick row, the empty names gutter and the stats line (${JSON.stringify(lay)})`);
  await s.screenshot('m9-fix166-band.png');
  // The controls row at four times, to read the button's face.
  const controlsClip = async (name) => {
    const clip = await s.evalJs(`(() => { const r = document.querySelector('.activity-view .file-header').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height, scale: 4 }; })()`);
    const shot = await s.send('Page.captureScreenshot', { format: 'png', clip });
    fs.writeFileSync(path.join(shotsDir, name), Buffer.from(shot.data, 'base64'));
  };
  await controlsClip('m9-fix166-controls-band.png');
  // The crosshair still reads off the band's box with no tracks under it.
  await s.evalJs(`(() => { const strip = document.querySelector('.activity-view .activity-strip'); const r = strip.getBoundingClientRect(); strip.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width / 2, clientY: r.top + 4, bubbles: true })); })()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.cross !== undefined`, 'the crosshair over the band alone');
  const bandCross = await s.evalJs(`(() => { const v = document.querySelector('.activity-view'); return { line: !!v.querySelector('.activity-load .activity-cross'), readout: v.querySelector('.activity-cross-readout')?.textContent ?? null }; })()`);
  expect(bandCross.line && bandCross.readout !== null && / running$/.test(bandCross.readout), `the crosshair and its readout with the band alone, got ${JSON.stringify(bandCross)}`);
  await s.evalJs(`document.querySelector('.activity-view .activity-strip').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.cross === undefined`, 'the crosshair cleared');
  await s.evalJs(`document.querySelector('.activity-view .activity-layers').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.layers === 'lanes'`, 'the lanes alone');
  lay = await layers();
  expect(!lay.band && lay.tracks === 2 && lay.names === 2 && lay.title === 'Show the band and the lanes' && lay.icon === 2, `the lanes alone drop the band and keep the rows (${JSON.stringify(lay)})`);
  // M9 fix 178: the tab's layers are its own, in its query, not a key.
  expect(await s.evalJs(`JSON.parse(localStorage.getItem('emerald.tabs')).query[${JSON.stringify(tabPath)}] === 'layers=lanes' && localStorage.getItem('emerald.activityLayers') === null`), 'the layers choice is kept in the tab\'s query');
  await s.screenshot('m9-fix166-lanes.png');
  await controlsClip('m9-fix166-controls-lanes.png');
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.state === 'ready'`, 'the tab back after a reload');
  lay = await layers();
  expect(lay.layers === 'lanes' && !lay.band, `still the lanes alone after a reload (${JSON.stringify(lay)})`);
  await s.evalJs(`document.querySelector('.activity-view .activity-orientation').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.orientation === 'vertical'`, 'vertical');
  lay = await layers();
  expect(lay.disabled === true && lay.title === 'Time across has the band' && lay.layers === 'lanes', `the button waits disabled in the vertical form (${JSON.stringify(lay)})`);
  await s.evalJs(`document.querySelector('.activity-view .activity-orientation').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.orientation === 'horizontal'`, 'horizontal again');
  await s.evalJs(`document.querySelector('.activity-view .activity-layers').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.layers === 'both'`, 'both again');
  lay = await layers();
  expect(lay.band && lay.tracks === 2 && !lay.disabled, `both layers again (${JSON.stringify(lay)})`);
  await controlsClip('m9-fix166-controls-both.png');
  step('M9 fix 166: the layers button cycles both, the band alone and the lanes alone, kept across a reload, disabled in the vertical form');

  // The day before has nothing; the day after is today again.
  await s.evalJs(`document.querySelector('.activity-view .activity-day-prev').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.day !== ${JSON.stringify(day)} && document.querySelector('.activity-view')?.dataset.state === 'ready'`, 'the day before');
  const before = await s.evalJs(`document.querySelector('.activity-view').dataset.day`);
  const [y, m, d] = day.split('-').map(Number);
  const yesterday = new Date(y, m - 1, d - 1);
  const expectedBefore = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  expect(before === expectedBefore, `the day before is yesterday, got ${before}, expected ${expectedBefore}`);
  expect(await s.evalJs(`document.querySelectorAll('.tab-file').length === 1`), 'one activity tab: the old day closed');
  expect(await s.evalJs(`!!document.querySelector('.activity-view .files-empty')`), 'the day before says no session worked');
  // M9 fix 207: a past day has no instant to count at: no `running now`
  // on the line and no count on a band (there is no band, and no now line).
  const beforeLine = await s.evalJs(`(() => ({ stats: document.querySelector('.activity-view-stats')?.textContent ?? null, count: document.querySelectorAll('.activity-view .activity-now-count').length }))()`);
  expect(beforeLine.stats !== null && !beforeLine.stats.includes('running now') && beforeLine.count === 0, `yesterday's line has no running count and no figure at a now line, got ${JSON.stringify(beforeLine)}`);
  await s.evalJs(`document.querySelector('.activity-view .activity-day-next').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.day === ${JSON.stringify(day)}`, 'today again');
  expect(await s.evalJs(`document.querySelector('.activity-view .activity-day-next').disabled`), 'the day after today is not offered');
  step('◀ and ▶ step the day');

  // M9 fix 231: attention debt, the brief's eight checks
  // (docs/design/attention-debt.md §11) as one step. The tab pages back
  // to the two seeded days of last week: the quiet one draws nothing of
  // it and keeps the band's height and the lanes' offset, the queue day
  // draws the part, the mirror, the stretches and the crosshair's
  // clause and names; then today, where alpha asks live: its stretch
  // ends at the now line, the header carries the live figure, and at
  // 340px the part leads the second line with the pulse on it. Every
  // text read is against the tab, `.activity-view[data-place="tab"]`.
  const V = `.activity-view[data-place="tab"]`;
  const tabOnDay = async (key) => {
    for (let i = 0; i < 12 && (await s.evalJs(`document.querySelector(${JSON.stringify(V)})?.dataset.day`)) !== key; i++) {
      const was = await s.evalJs(`document.querySelector(${JSON.stringify(V)})?.dataset.day`);
      await s.evalJs(`document.querySelector(${JSON.stringify(V + ' .activity-day-prev')}).click()`);
      await s.waitFor(`document.querySelector(${JSON.stringify(V)})?.dataset.day !== ${JSON.stringify(was)} && document.querySelector(${JSON.stringify(V)})?.dataset.state === 'ready'`, `the day before ${was}`, 10000);
    }
    expect((await s.evalJs(`document.querySelector(${JSON.stringify(V)})?.dataset.day`)) === key, `the tab on ${key}`);
  };
  const blockedRgb = await s.evalJs(`(() => { const el = document.createElement('i'); el.style.color = 'var(--blocked)'; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; })()`);
  const geometry = () =>
    s.evalJs(
      `(() => { const v = document.querySelector(${JSON.stringify(V)}); const load = v.querySelector('.activity-view-load'); const strip = v.querySelector('.activity-view-strip'); const band = v.querySelector('.activity-load'); return { band: band ? band.clientHeight : null, offset: load && strip ? Math.round(strip.getBoundingClientRect().top - load.getBoundingClientRect().top) : null, mirror: v.querySelector('.activity-debt')?.clientHeight ?? null, part: v.querySelector('.activity-view-debt-part')?.textContent ?? null, debtEls: v.querySelectorAll('.activity-debt, .activity-debt-span, .activity-view-name-debt, .activity-view-load-waiting, .activity-view-live-debt, .activity-debt-pulse').length, stats: v.querySelector('.activity-view-stats').textContent }; })()`,
    );
  await tabOnDay(quietDay);
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(V + ' .activity-view-name')}).length === 3`, 'the quiet day has its three rows');
  const quiet = await geometry();
  expect(quiet.part === null && quiet.mirror === null && quiet.debtEls === 0 && !quiet.stats.includes('waiting'), `a window where every done was answered inside the grace draws no part, no mirror and no debt element (${JSON.stringify(quiet)})`);
  expect(quiet.band === 64 && quiet.offset === 71, `the band is 64px tall and the lanes sit 71px under its top, the pre-change values (${JSON.stringify(quiet)})`);
  // Check 2 off the daemon's answer, which the DOM draws: g59 owes
  // nothing, g61 one second past the grace.
  const debtJson = JSON.parse(await cli('activity', '--day', debtDay, '--json'));
  const rowOf = (id) => debtJson.sessions.find((x) => x.sessionId === id && !x.agentId);
  expect(rowOf('g59').debt.length === 0 && rowOf('g61').debt.length === 1 && rowOf('g61').debt[0].kind === 'unread' && rowOf('g61').debt[0].to - rowOf('g61').debt[0].from === 1000, `a done answered at 59 s contributes nothing and one at 61 s one second (${JSON.stringify([rowOf('g59').debt, rowOf('g61').debt])})`);
  expect(debtJson.stats.debtMs === 200 * 60_000 + 1000 && debtJson.stats.askedMs === 160 * 60_000 && debtJson.stats.waits === 3 && debtJson.stats.debtWallMs === 110 * 60_000 + 1000 && debtJson.stats.debtPeak === 3, `the day's figures: the sum of the three asks and the unread stretches, the union, three deep (${JSON.stringify(debtJson.stats)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(V + ' .activity-day-next')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(V)})?.dataset.day === ${JSON.stringify(debtDay)} && document.querySelector(${JSON.stringify(V)})?.dataset.state === 'ready' && !!document.querySelector(${JSON.stringify(V + ' .activity-debt')})`, 'the queue day with its mirror', 10000);
  const queue = await s.evalJs(
    `(() => { const v = document.querySelector(${JSON.stringify(V)}); const part = v.querySelector('.activity-view-debt-part'); const mirror = v.querySelector('.activity-debt'); const line = mirror.querySelector('.activity-debt-line'); const pathAt = (sel, pct) => { const d = mirror.querySelector(sel).getAttribute('d'); const pts = d.match(/[ML][0-9.]+,[0-9.]+/g).map((p) => p.slice(1).split(',').map(Number)); let y = 0; for (const [x, py] of pts) if (x <= pct) y = py; return y; }; const axisPct = (h, m) => { const ticks = [...v.querySelectorAll('.activity-strip .activity-tick')]; const first = ticks[0]; const second = ticks[1]; const p0 = parseFloat(first.style.left); const p1 = parseFloat(second.style.left); const h0 = Number(first.querySelector('.activity-tick-label')?.textContent ?? NaN); return p0 + (p1 - p0) * (h + m / 60 - h0); }; const names = [...v.querySelectorAll('.activity-view-name')]; const rowDebt = names.map((n) => [n.dataset.sessionId, n.dataset.agentId ?? null, n.querySelector('.activity-view-name-debt')?.textContent ?? null]); const sizes = (sel) => [...v.querySelectorAll(sel)].map((el) => parseFloat(getComputedStyle(el).height)); const colours = [...v.querySelectorAll('.activity-debt-span')].map((el) => getComputedStyle(el).backgroundColor).concat([getComputedStyle(line).stroke, getComputedStyle(part).color, getComputedStyle(v.querySelector('.activity-view-load-waiting')).color, ...[...v.querySelectorAll('.activity-view-name-debt')].map((el) => getComputedStyle(el).color)]); return { part: part.textContent, title: part.title, peak: Number(mirror.dataset.peak), mirror: mirror.clientHeight, outline: line.getBBox().height, allAt1120: pathAt('.activity-debt-fill[data-profile="all"]', axisPct(11, 20)), askedAt1120: pathAt('.activity-debt-fill[data-profile="asked"]', axisPct(11, 20)), allAt1430: pathAt('.activity-debt-fill[data-profile="all"]', axisPct(14, 30)), legend: v.querySelector('.activity-view-load-waiting').textContent, rowDebt, working: sizes('.activity-strip .activity-span:not([data-agent])'), agent: sizes('.activity-strip .activity-span[data-agent]'), asked: sizes('.activity-debt-span[data-kind="asked"]'), unread: sizes('.activity-debt-span[data-kind="unread"]'), fill: getComputedStyle(mirror.querySelector('.activity-debt-fill')).fill, colours, animated: [...v.querySelectorAll('.activity-debt-span, .activity-debt')].some((el) => getComputedStyle(el).animationName !== 'none' || getComputedStyle(el).transitionProperty !== 'all' && getComputedStyle(el).transitionDuration !== '0s'), offset: Math.round(v.querySelector('.activity-view-strip').getBoundingClientRect().top - v.querySelector('.activity-view-load').getBoundingClientRect().top), band: v.querySelector('.activity-load').clientHeight, x1430: axisPct(14, 30), x1200: axisPct(12, 0) }; })()`,
  );
  expect(queue.part === ' · 3h 20m waiting on you' && queue.title.startsWith("2h 40m asked over 3 waits, 40m unread past the minute's grace\n1h 50m of the window had someone waiting on you"), `three asking over one overlapping hour give the sum of the three after the peak, the tooltip naming the smaller union (${JSON.stringify([queue.part, queue.title])})`);
  expect(queue.peak === 3 && queue.mirror === 22 && queue.outline === 3 && queue.allAt1430 === 3 && queue.legend === '3 waiting at once', `the mirror is 22px on its own peak of 3, its outline at full height where three waited, the legend's third line (${JSON.stringify({ peak: queue.peak, mirror: queue.mirror, outline: queue.outline, at1430: queue.allAt1430, legend: queue.legend })})`);
  expect(queue.allAt1120 === 1 && queue.askedAt1120 === 0, `over the unread-only stretch the asked-alone profile is shallower than the all-debt one (${JSON.stringify([queue.allAt1120, queue.askedAt1120])})`);
  expect(queue.band === quiet.band && queue.offset === quiet.offset + 22, `the mirror is the one layout move, 22px under the band (${JSON.stringify([queue.band, queue.offset])})`);
  expect(queue.working.every((h) => h === 4) && queue.agent.length === 1 && queue.agent[0] === 3 && queue.asked.length === 3 && queue.asked.every((h) => h === 2) && queue.unread.length === 2 && queue.unread.every((h) => h === 1), `the lane weights are 4, 3, 2 and 1 px for working, subagent, asked and unread (${JSON.stringify({ working: queue.working, agent: queue.agent, asked: queue.asked, unread: queue.unread })})`);
  expect(queue.colours.every((c) => c === blockedRgb) && queue.fill === 'rgba(78, 201, 176, 0.16)' && !queue.animated, `every debt element's colour resolves to --blocked (${blockedRgb}), the fill to the new token, and nothing animates (${JSON.stringify({ colours: queue.colours, fill: queue.fill, animated: queue.animated })})`);
  const gutter = Object.fromEntries(queue.rowDebt.filter((r) => r[1] === null).map((r) => [r[0], r[2]]));
  expect(gutter.q1 === '1h' && gutter.q2 === '50m' && gutter.q3 === '50m' && gutter.u1 === '40m' && gutter.g59 === null && gutter.g61 === '1s' && queue.rowDebt.find((r) => r[1] !== null)[2] === null, `the name gutter carries each session's window debt on the rows that have any, none on an agent's (${JSON.stringify(queue.rowDebt)})`);
  // The crosshair at 14:30, three waiting longest first, and at 12:00,
  // nobody: the pointer is put over the strip at the axis percent.
  const hoverAt = async (pct) => {
    const box = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(V + ' .activity-view-strip')}).getBoundingClientRect(); return { left: r.left, width: r.width, y: r.top + 4 }; })()`);
    const x = box.left + (box.width * pct) / 100;
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: box.y });
    await s.waitFor(`document.querySelector(${JSON.stringify(V)})?.dataset.cross !== undefined`, 'the crosshair on');
    await sleep(150);
    return s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(V + ' .activity-cross-readout')}); if (!r) return null; const sub = r.querySelector('.activity-cross-readout-sub'); return { text: r.childNodes[0].textContent, sub: sub ? sub.textContent : null, subColor: sub ? getComputedStyle(sub).color : null }; })()`);
  };
  const at1430 = await hoverAt(queue.x1430);
  expect(at1430 !== null && /^14:(29|30|31) · 0 running · 3 waiting on you$/.test(at1430.text) && at1430.sub !== null && at1430.subColor === blockedRgb, `the readout at 14:30 reads three waiting on you with a teal second line (${JSON.stringify(at1430)})`);
  const waits = (at1430?.sub ?? '').split(' · ').map((w) => w.trim());
  const minutes = waits.map((w) => Number(/(\d+)m$/.exec(w)?.[1] ?? NaN));
  expect(waits.length === 3 && minutes.every((n) => Number.isFinite(n)) && minutes[0] > minutes[1] && minutes[1] > minutes[2] && !at1430.sub.includes('more'), `the second line names the three sessions waiting, the longest wait first, and no +more (${JSON.stringify(waits)})`);
  await s.screenshot('attention-debt-231.png');
  const at1200 = await hoverAt(queue.x1200);
  expect(at1200 !== null && /^1[12]:\d{2} · \d running$/.test(at1200.text) && at1200.sub === null, `at an instant with nobody waiting the readout has no clause and no second line (${JSON.stringify(at1200)})`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await s.waitFor(`document.querySelector(${JSON.stringify(V)})?.dataset.cross === undefined`, 'the crosshair off');
  // Back on today for the steps that follow.
  await s.evalJs(`document.querySelector(${JSON.stringify(V + ' .activity-now-button')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(V)})?.dataset.day === ${JSON.stringify(day)} && document.querySelector(${JSON.stringify(V)})?.dataset.state === 'ready'`, 'today again', 10000);
  step("M9 fix 231: attention debt on the seeded days: nothing drawn on a day that owes nothing, the grace edge at 59 and 61 s, three asks summed with the union in the tooltip, the mirror's outline at full height and the asked profile shallower over an unread stretch, the lane weights and the tone, the crosshair's three names longest first and none at a quiet instant");

  // M67: the hour and the minute windows. The picker opens the current
  // unit in one tab named by its clock, ◀ pages by the unit and pins the
  // view, now (or Home) returns it to the clock, and a minute view left
  // on the clock rolls over with it, driven here by a shifted Date.now.
  const view = () =>
    s.evalJs(
      `(() => { const v = document.querySelector('.activity-view'); if (!v) return null; return { window: v.dataset.window, unit: v.dataset.unit, following: 'following' in v.dataset, next: v.querySelector('.activity-day-next').disabled, now: v.querySelector('.activity-now-button').disabled, title: v.querySelector('.activity-view-title').textContent, labels: [...v.querySelectorAll('.activity-tick-label')].map((t) => t.textContent), tab: document.querySelector('.tab-file[data-active] .tab-name')?.textContent ?? null, tabs: document.querySelectorAll('.tab-file').length }; })()`,
    );
  const pick = async (unit) => {
    await s.evalJs(`document.querySelector('.activity-view .activity-unit[data-unit=${JSON.stringify(unit)}]').click()`);
    await s.waitFor(`document.querySelector('.activity-view')?.dataset.unit === ${JSON.stringify(unit)} && document.querySelector('.activity-view')?.dataset.state === 'ready'`, `the ${unit} window`);
    return view();
  };
  const two = (n) => String(n).padStart(2, '0');
  // The key of the unit before, from a key's own parts. It and the string
  // compares of keys below know nothing of the `b` a repeated hour or
  // minute carries since M9 fix 518, so they misread only a run inside the
  // second 01:00 hour of an autumn clock change; left so on purpose.
  const keyBefore = (key) => {
    const [ymd, hm] = key.split('T');
    const [y, m, d] = ymd.split('-').map(Number);
    const [h, mi] = hm.split(':').map(Number);
    const at = new Date(y, m - 1, d, h, mi ?? 0).getTime() - (mi === undefined ? 3_600_000 : 60_000);
    const b = new Date(at);
    const day = `${b.getFullYear()}-${two(b.getMonth() + 1)}-${two(b.getDate())}`;
    return mi === undefined ? `${day}T${two(b.getHours())}` : `${day}T${two(b.getHours())}:${two(b.getMinutes())}`;
  };
  const hour = await pick('hour');
  expect(/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(hour.window), `the hour window is keyed by its start, got ${hour.window}`);
  expect(hour.tabs === 1 && hour.tab === `Activity ${hour.window.replace('T', ' ')}:00`, `one tab, named by the hour, got ${hour.tabs} and ${JSON.stringify(hour.tab)}`);
  expect(hour.labels.length === 7 && hour.labels.every((l) => /^\d{2}:\d{2}$/.test(l)) && hour.labels[0].endsWith(':00'), `an hour is labelled every ten minutes from its top, got ${JSON.stringify(hour.labels)}`);
  expect(hour.title.includes(' to ') && hour.next && hour.now && hour.following, `on the current hour the title spans it, ▶ and now are off and the view follows the clock, got ${JSON.stringify(hour)}`);
  await s.screenshot('m67-activity-hour.png');
  await s.evalJs(`document.querySelector('.activity-view .activity-day-prev').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.window !== ${JSON.stringify(hour.window)} && document.querySelector('.activity-view')?.dataset.state === 'ready'`, 'the hour before');
  const back = await view();
  expect(back.window === keyBefore(hour.window) && back.unit === 'hour', `◀ pages one hour back, got ${back.window} from ${hour.window}`);
  expect(!back.next && !back.now && !back.following && back.tabs === 1, `paged back: ▶ and now are on, the view is pinned, still one tab, got ${JSON.stringify(back)}`);
  await s.evalJs(`document.querySelector('.activity-view .activity-now-button').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.querySelector('.activity-now-button').disabled`, 'now returns to the clock');
  const returned = await view();
  expect(returned.window >= hour.window && returned.following, `now is back on the current hour and following, got ${JSON.stringify(returned)}`);
  step(`M67: the hour window ${hour.window}, ◀ to ${back.window}, now back`);

  // M9 fix 321: the five-hour unit is the account's current usage window
  // off the strip's reading: the key is the stub's reset less five hours
  // in the minute form with an f, the strip's pace bar sits under the
  // axis at its width with the stub's fill, the arrows are off with
  // their title, and now is off on the current window; with the stub
  // answering signed-out the button is off with its title and the view
  // falls back to the day through a click on it.
  await s.waitFor(`document.querySelector('.usage-strip')?.dataset.state === 'ok'`, 'the strip has the stubbed reading', 10000);
  const fiveHourStart = new Date(Date.parse(usageResetsAt) - 5 * 3_600_000);
  const fiveHourKey = `${fiveHourStart.getFullYear()}-${two(fiveHourStart.getMonth() + 1)}-${two(fiveHourStart.getDate())}T${two(fiveHourStart.getHours())}:${two(fiveHourStart.getMinutes())}f`;
  const unitButton = (unit) => s.evalJs(`(() => { const b = document.querySelector('.activity-view .activity-unit[data-unit=${JSON.stringify(unit)}]'); return b ? { text: b.textContent, disabled: b.disabled, title: b.title } : null; })()`);
  const fiveButton = await unitButton('five-hour');
  expect(fiveButton !== null && fiveButton.text === '5h' && !fiveButton.disabled && fiveButton.title === 'The current five-hour usage window', `the 5h button is on with a reading (${JSON.stringify(fiveButton)})`);
  const five = await pick('five-hour');
  expect(five.window === fiveHourKey, `the five-hour window is keyed by the reading's start minute, got ${five.window} for ${fiveHourKey}`);
  expect(five.tab === `Activity 5h from ${fiveHourKey.slice(0, -1).replace('T', ' ')}` && five.tabs === 1, `the tab is named by the window's start, got ${JSON.stringify(five.tab)}`);
  expect(five.labels.length === 6 && five.labels.every((l) => /^\d{2}:\d{2}$/.test(l)) && five.labels[0] === `${two(fiveHourStart.getHours())}:${two(fiveHourStart.getMinutes())}`, `the axis ticks on the window's hours from its start, got ${JSON.stringify(five.labels)}`);
  expect(five.title === `Activity · ${two(fiveHourStart.getHours())}:${two(fiveHourStart.getMinutes())} to ${two((fiveHourStart.getHours() + 5) % 24)}:${two(fiveHourStart.getMinutes())}`, `the title spans the window, got ${JSON.stringify(five.title)}`);
  expect(five.next && five.now && five.following, `on the current window ▶ and now are off and the view follows, got ${JSON.stringify(five)}`);
  const arrows = await s.evalJs(`(() => { const v = document.querySelector('.activity-view'); const p = v.querySelector('.activity-day-prev'); const n = v.querySelector('.activity-day-next'); return { prev: p.disabled, prevTitle: p.title, next: n.disabled, nextTitle: n.title, unit: v.dataset.unit, stats: v.querySelector('.activity-view-stats').textContent }; })()`);
  expect(arrows.prev && arrows.next && arrows.prevTitle === 'only the current window; past windows are not kept yet' && arrows.nextTitle === arrows.prevTitle && arrows.unit === 'five-hour', `both arrows are off on the unit with the one title (${JSON.stringify(arrows)})`);
  expect(arrows.stats.startsWith('now · '), `the stats line reads as on the clock (${JSON.stringify(arrows.stats)})`);
  const axisBar = await s.evalJs(`(() => { const v = document.querySelector('.activity-view'); const b = v.querySelector('.activity-view-strip .usage-bar[data-form="axis"]'); if (!b) return null; const strip = v.querySelector('.activity-view-strip .activity-strip').getBoundingClientRect(); const r = b.getBoundingClientRect(); const ticks = v.querySelector('.activity-ticks').getBoundingClientRect(); return { fill: b.querySelector('.usage-bar-fill').style.width, mark: parseFloat(b.querySelector('.usage-bar-mark').style.left), ticks: Number(b.dataset.ticks), tone: b.dataset.tone, width: r.width, stripWidth: strip.width, height: r.height, underTicks: r.top >= ticks.bottom }; })()`);
  expect(axisBar !== null && axisBar.fill === '17%' && axisBar.ticks === 4 && axisBar.tone === 'working', `the pace bar under the axis carries the stub's fill and the hour ticks (${JSON.stringify(axisBar)})`);
  // The elapsed share: 4 h 19 m of five hours, read with a minute's slack.
  expect(axisBar !== null && axisBar.mark > 85 && axisBar.mark < 88, `the mark sits at the elapsed share (${JSON.stringify(axisBar)})`);
  expect(axisBar !== null && Math.abs(axisBar.width - axisBar.stripWidth) < 2 && axisBar.height === 6 && axisBar.underTicks, `the bar is the axis's width, 6px, under the tick row (${JSON.stringify(axisBar)})`);
  await s.screenshot('m9-321-five-hour.png');
  // Signed out: the strip's next answer is a 401, and the unit's button goes.
  usageStatus = 401;
  await s.evalJs(`document.querySelector('.usage-refresh').click()`);
  await s.waitFor(`document.querySelector('.usage-strip')?.dataset.state === 'unauthorized'`, 'the strip signed out on the 401', 10000);
  await s.waitFor(`document.querySelector('.activity-view .activity-unit[data-unit="five-hour"]')?.disabled === true`, 'the 5h button off without a reading');
  const offButton = await unitButton('five-hour');
  expect(offButton.title === 'no five-hour window; the usage strip has no reading', `the off button says why (${JSON.stringify(offButton)})`);
  const stillFive = await view();
  expect(stillFive.unit === 'five-hour' && stillFive.window === fiveHourKey && stillFive.now, `the open window stays as it was, now off with nothing to move to (${JSON.stringify(stillFive)})`);
  usageStatus = 200;
  await s.evalJs(`document.querySelector('.usage-refresh').click()`);
  await s.waitFor(`document.querySelector('.activity-view .activity-unit[data-unit="five-hour"]')?.disabled === false`, 'the 5h button back with the reading');
  step(`M9 fix 321: the five-hour window ${fiveHourKey}, the pace bar under its axis, the arrows off, the button off while signed out`);

  // Not in the last seconds of a minute: the window picked then rolls over
  // to the next before the read, and while the view loads the new one it
  // draws no ticks (one close-out read `[]` at hh:mm:00).
  // From :45, not :50 (M9 fix 215's run picked at :59 and read after the
  // rollover): the pick's own waits take a few seconds.
  const secs = new Date().getSeconds();
  if (secs >= 45) await sleep((61 - secs) * 1000);
  const minute = await pick('minute');
  expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(minute.window), `the minute window is keyed by its start, got ${minute.window}`);
  expect(minute.tab === `Activity ${minute.window.replace('T', ' ')}` && minute.tabs === 1, `the tab is named by the minute, got ${JSON.stringify(minute.tab)}`);
  // The tick row is the strip's, drawn only when a session worked in the
  // window: alpha and beta worked some thirty seconds before this pick,
  // in this minute or the one before by where the run started (a run
  // from :30 on crosses the boundary first, and the wait above makes a
  // fresh minute of it), so the labels are read off whichever of the two
  // has the strip, and the other reads as empty. Both are read below.
  const minuteLabels = [':00', ':10', ':20', ':30', ':40', ':50', ':00'];
  const tracksOf = () => s.evalJs(`({ tracks: Number(document.querySelector('.activity-view').dataset.tracks), empty: document.querySelector('.activity-view .files-empty')?.textContent ?? null })`);
  const minuteTracks = await tracksOf();
  if (minuteTracks.tracks > 0) expect(JSON.stringify(minute.labels) === JSON.stringify(minuteLabels), `a minute is labelled every ten seconds, got ${JSON.stringify(minute.labels)}`);
  else expect(minute.labels.length === 0 && minuteTracks.empty === 'No session worked in this minute.', `a minute no session worked in says so and draws no strip, got ${JSON.stringify({ labels: minute.labels, ...minuteTracks })}`);
  expect(minute.next && minute.now && minute.following, `on the current minute ▶ and now are off, got ${JSON.stringify(minute)}`);
  // Home while the view has focus is the now button.
  await s.evalJs(`document.querySelector('.activity-view .activity-day-prev').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.window !== ${JSON.stringify(minute.window)} && document.querySelector('.activity-view')?.dataset.state === 'ready'`, 'the minute before');
  const backMinute = await view();
  expect(backMinute.window === keyBefore(minute.window) && !backMinute.following, `◀ pages one minute back and pins, got ${backMinute.window}`);
  const backTracks = await tracksOf();
  expect(minuteTracks.tracks > 0 || backTracks.tracks > 0, `alpha's work is in this minute or the one before (${JSON.stringify({ minuteTracks, backTracks })})`);
  if (backTracks.tracks > 0) expect(JSON.stringify(backMinute.labels) === JSON.stringify(minuteLabels), `the minute before is labelled every ten seconds too, got ${JSON.stringify(backMinute.labels)}`);
  await s.evalJs(`(() => { const v = document.querySelector('.activity-view'); v.focus(); v.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })); })()`);
  await s.waitFor(`document.querySelector('.activity-view')?.querySelector('.activity-now-button').disabled`, 'Home returns to the clock');
  const homed = await view();
  expect(homed.window >= minute.window && homed.following && homed.unit === 'minute', `Home is now, got ${JSON.stringify(homed)}`);
  // The rollover: the page's clock moves a minute on and the view, on
  // the clock, follows it to the next minute without a click.
  await s.evalJs(`(() => { window.emeraldRealNow = Date.now; const real = Date.now; Date.now = () => real() + 60_000; })()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.window > ${JSON.stringify(homed.window)}`, 'the view rolled to the next minute', 5000);
  const rolled = await view();
  expect(rolled.window > homed.window && rolled.unit === 'minute' && rolled.following && rolled.tabs === 1, `the minute rolled over on the clock, got ${JSON.stringify(rolled)} from ${homed.window}`);
  await s.evalJs(`Date.now = window.emeraldRealNow`);
  await s.screenshot('m67-activity-minute.png');
  step(`M67: the minute window ${minute.window}, Home back, rolled to ${rolled.window} under a driven clock`);

  // M9 fix 230: the week unit. Seven rows as ridges on one shared scale,
  // the seeded past days each with a peak of their own, today's row with
  // the fakes' band and the now line; the stats line's peak names a day
  // and a clock time; the crosshair reads an hour across the days with a
  // figure per day reached and their median; the layers, orientation and
  // density buttons are disabled and say why; the key survives a reload;
  // and emmer activity --week --json agrees with the tab on the peak.
  const weekView = await pick('week');
  expect(/^\d{4}-\d{2}-\d{2}w$/.test(weekView.window), `the week is keyed by its Monday with a w, got ${weekView.window}`);
  expect(weekView.tabs === 1 && weekView.tab === `Activity week of ${weekView.window.slice(0, -1)}`, `one tab, named by the week, got ${JSON.stringify(weekView.tab)}`);
  const mondayDate = new Date(mondayAt);
  const mondayKey = `${mondayDate.getFullYear()}-${two(mondayDate.getMonth() + 1)}-${two(mondayDate.getDate())}`;
  expect(weekView.window === `${mondayKey}w`, `the week is this week's, got ${weekView.window} for ${mondayKey}`);
  expect(weekView.title === `Activity · week of Mon ${mondayDate.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mondayDate.getMonth()]}` && weekView.next && weekView.now && weekView.following, `the title names the week of the Monday and the view follows the clock, got ${JSON.stringify(weekView)}`);
  const weekRead = () =>
    s.evalJs(
      `(() => { const v = document.querySelector('.activity-view'); const w = v.querySelector('.activity-week'); return { stats: v.querySelector('.activity-view-stats').textContent, peak: Number(w?.dataset.peak), rows: [...v.querySelectorAll('.activity-week-row')].map((r) => ({ day: r.dataset.day, when: r.dataset.when, peak: Number(r.dataset.peak), now: r.dataset.now ?? null, label: r.querySelector('.activity-week-label').textContent, nowLine: !!r.querySelector('.activity-week-now'), count: r.querySelector('.activity-now-count')?.textContent ?? null })), lanes: v.querySelectorAll('.activity-strip, .activity-view-load').length, labels: [...v.querySelectorAll('.activity-week-ticks .activity-tick-label')].map((t) => t.textContent), layers: v.querySelector('.activity-layers').disabled, layersTitle: v.querySelector('.activity-layers').title, orientation: v.querySelector('.activity-orientation').disabled, orientationTitle: v.querySelector('.activity-orientation').title, density: v.querySelector('.activity-density').disabled }; })()`,
    );
  const wk = await weekRead();
  expect(wk.rows.length === 7 && wk.rows[0].day === mondayKey && wk.rows[pastDays].day === day, `seven rows from the Monday with today at ${pastDays}, got ${JSON.stringify(wk.rows.map((r) => r.day))}`);
  expect(wk.rows.filter((r) => r.when === 'past').length === pastDays && wk.rows.filter((r) => r.when === 'today').length === 1, `${pastDays} past rows and one today, got ${JSON.stringify(wk.rows.map((r) => r.when))}`);
  expect(wk.rows.slice(0, seededDays).every((r) => r.when === 'past' && r.peak >= 1 && /^\w{3} \d+ · peak \d+ · \d+\.\dh$/.test(r.label)), `every seeded day has a peak and a label with its hours, got ${JSON.stringify(wk.rows.map((r) => r.label))}`);
  expect(wk.rows.filter((r) => r.when === 'past').every((r) => /^\w{3} \d+ · peak \d+ · \d+\.\dh$/.test(r.label)), `every past day is labelled with its peak and hours, got ${JSON.stringify(wk.rows.map((r) => r.label))}`);
  const todayRow = wk.rows.find((r) => r.when === 'today');
  expect(todayRow.peak >= 2 && todayRow.nowLine && todayRow.now !== null && Number(todayRow.now) > 0 && todayRow.count === '0×', `today's row carries the fakes' peak of 2, the now line and its count, got ${JSON.stringify(todayRow)}`);
  expect(wk.rows.filter((r) => r.when === 'future').every((r) => r.peak === 0 && !r.nowLine), 'a future day is an empty baseline');
  expect(wk.peak === Math.max(...wk.rows.map((r) => r.peak)) && wk.peak >= 2, `one shared peak, the week's, got ${wk.peak}`);
  expect(wk.lanes === 0 && wk.labels.length === 9 && wk.labels[0] === '00' && wk.labels[4] === '12', `no lanes and no band, the hour axis under the front row, got ${wk.lanes} and ${JSON.stringify(wk.labels)}`);
  // M9 fix 274: the agent-hours and the wall hours lead, then the peak.
  const weekStats = /^this week · (\d+\.\d) agent-hours in (\d+\.\d) · (\d+\.\d)× parallel · peak (\d+) (\w{3} \d+) (\d{2}:\d{2}) · busiest hour \d{2}:00 across the week · .*\d+ running now$/.exec(wk.stats);
  expect(weekStats !== null && Number(weekStats[4]) === wk.peak, `the stats line names the peak with its day and clock time, the busiest hour and the agent-hours, got ${JSON.stringify(wk.stats)}`);
  const [wkHours, wkWallHours, wkParallel] = weekStats === null ? [0, 0, 0] : [Number(weekStats[1]), Number(weekStats[2]), Number(weekStats[3])];
  // In the week's first hour (a Monday just after midnight) both figures
  // round to 0.0 while the parallelism is read off the exact ones, so the
  // compare waits for a wall hour.
  expect(weekStats === null || wkWallHours < 1 || Math.abs(wkParallel - wkHours / wkWallHours) < 0.1, `the parallelism is the agent-hours over the wall hours to a tenth, got ${wkParallel} for ${wkHours} over ${wkWallHours}`);
  // M9 fix 281: the density button works on the week now, the layers and the orientation still not.
  expect(wk.layers && wk.layersTitle === 'The week draws one ridge per day, no lanes' && wk.orientation && wk.orientationTitle === 'The week is always time across' && !wk.density, `the layers and orientation buttons are disabled with their tooltips, the density is not, got ${JSON.stringify([wk.layers, wk.layersTitle, wk.orientation, wk.orientationTitle, wk.density])}`);
  // The crosshair on today's row a few minutes before now, an hour every
  // day so far has reached, so the readout lists one figure per past day
  // and today with their median.
  const sinceMidnight = Date.now() - new Date(seedNow.getFullYear(), seedNow.getMonth(), seedNow.getDate()).getTime();
  const crossPercent = Math.max(0.2, Math.min(99, ((sinceMidnight - 5 * 60_000) / (24 * HOUR)) * 100));
  // A pointermove is a continuous event, so React paints the hover on the
  // next frame; the read waits for the crosshair.
  await s.evalJs(
    `(() => { const w = document.querySelector('.activity-week'); const a = w.querySelector('.activity-week-area').getBoundingClientRect(); const row = w.querySelector('.activity-week-row[data-when="today"]').getBoundingClientRect(); w.dispatchEvent(new PointerEvent('pointermove', { clientX: a.left + (a.width * ${crossPercent}) / 100, clientY: row.bottom - 4, bubbles: true })); })()`,
  );
  await s.waitFor(`!!document.querySelector('.activity-week-cross')`, 'the week crosshair');
  const hovered = await s.evalJs(
    `(() => { const w = document.querySelector('.activity-week'); const r = w.querySelector('.activity-week-readout'); return { hover: w.dataset.hover, text: r.textContent, figures: Number(r.dataset.figures), median: r.dataset.median ?? null, dots: w.querySelectorAll('.activity-week-dot').length, cross: !!w.querySelector('.activity-week-cross'), cells: [...r.querySelectorAll('.activity-week-readout-row > span')].map((c) => c.textContent) }; })()`,
  );
  expect(Number(hovered.hover) === pastDays && hovered.figures === pastDays + 1 && hovered.dots === pastDays + 1 && hovered.cross, `the crosshair picks today's row and reads a figure per day reached with a dot each, got ${JSON.stringify(hovered)}`);
  expect(hovered.cells.length === 7 && hovered.cells.slice(pastDays + 1).every((c) => c === '·') && hovered.median !== null && new RegExp(`^${todayRow.label.split(' · ')[0]} · \\d{2}:\\d{2} · \\d+ running · at \\d{2}:\\d{2} this week .* · median ${hovered.median.replace('.', '\\.')}$`).test(hovered.text), `the readout leads with today's figure, lists seven cells with a dot for a day not reached, and the median, got ${JSON.stringify(hovered.text)}`);
  // A synthetic pointerleave does not clear React's onPointerLeave; pointerout to the body does.
  await s.evalJs(`document.querySelector('.activity-week').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))`);
  await s.waitFor(`!document.querySelector('.activity-week-cross')`, 'the crosshair gone');
  await s.screenshot('week-ridges-230.png');
  // The key is kept across a reload, the tab reopening on the same week.
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.window === ${JSON.stringify(weekView.window)} && document.querySelector('.activity-view')?.dataset.state === 'ready' && document.querySelectorAll('.activity-week-row').length === 7`, 'the week again after a reload', 20000);
  // The CLI agrees with the tab on the peak, bare --week meaning this week.
  const cliWeek = JSON.parse(await cli('activity', '--week', '--json'));
  expect(cliWeek.week === weekView.window && cliWeek.peak === wk.peak && cliWeek.days.length === 7 && cliWeek.days.map((d) => d.profile.peak).join() === wk.rows.map((r) => r.peak).join(), `emmer activity --week --json agrees with the tab on the week and the peaks, got ${JSON.stringify({ week: cliWeek.week, peak: cliWeek.peak, days: cliWeek.days.map((d) => d.profile.peak) })}`);
  const cliWeekLines = (await cli('activity', '--week')).trimEnd().split('\n');
  expect(cliWeekLines.length === 9 && cliWeekLines[0].includes('(this week)') && cliWeekLines[0].includes(`peak ${wk.peak} `) && cliWeekLines.slice(1, 8).every((l) => /^  \d{4}-\d{2}-\d{2}  \w{3} \d+ +peak +\d+/.test(l)) && cliWeekLines[8] === historyWant(), `the text form is the week's line, seven day lines and the history's reach, got ${JSON.stringify(cliWeekLines)}`);
  step(`M9 fix 230: the week ${weekView.window} as seven ridges, ${seededDays} seeded days, ${pastDays} past and today, peak ${wk.peak}; the crosshair reads ${hovered.figures} figures with median ${hovered.median}; the CLI agrees`);

  // M9 fix 280: picking days to compare. A click on a label toggles the
  // day (the first click solos it, since nothing was picked yet); the
  // picked rows stay adjacent, the rest a dimmed list, the peak is over
  // the picked rows alone, and the stats line's head names the pick.
  // clickLabel finds the day's label while it is on (a nested span) or
  // its own row while it is off (the dimmed list has no nested label).
  const clickLabel = (dayKey) =>
    s.evalJs(`(() => { const row = document.querySelector('.activity-week-row[data-day=${JSON.stringify(dayKey)}]'); const label = row.querySelector('.activity-week-label'); (label ?? row).click(); })()`);
  const day0 = wk.rows[0].day;
  const day1 = wk.rows[1].day;
  // M9 fix 297: with days picked, the tally, the tokens and the price
  // after them are the pick's alone, not the whole week's. day0 and day1
  // are seeded with spans alone (the loop above :52), no commits, and
  // alpha's real commits (fix 218) have not landed yet at this point in
  // the run, so the commits read below is 0 either way and only shows
  // the merge runs without crashing; the agent time is what proves the
  // scoping. Each row's own label already carries its agent-hours (`peak
  // N · X.Xh`, from weekProfiles, a path of its own, nothing to do with
  // the stats line's mergeStats), and the week's head line (`wk.stats`,
  // read above :788) already carries the whole week's, so both sides of
  // the compare are read off what the app had already computed before
  // any of this fix's code ran. day1 can be today on a Monday or Tuesday
  // run, so this waits out the last ten seconds of a minute first, as
  // the earlier week steps do.
  const secs297 = new Date().getSeconds();
  if (secs297 >= 45) await sleep((61 - secs297) * 1000);
  const tallyOf297 = () => s.evalJs(`(() => { const t = document.querySelector('.activity-view .activity-view-tally'); return t === null ? 0 : Number(t.dataset.commits); })()`);
  const agentMsOf297 = () => s.evalJs(`Number(document.querySelector('.activity-view-stats').dataset.agentMs)`);
  const tallyBefore297 = await tallyOf297();
  const agentMsBefore297 = await agentMsOf297();
  const rowHours297 = (dayKey) => Number(/· (\d+\.\d)h$/.exec(wk.rows.find((r) => r.day === dayKey).label)?.[1] ?? 'NaN');
  const pickedHours297 = rowHours297(day0) + rowHours297(day1);
  await clickLabel(day0);
  await s.waitFor(`document.querySelectorAll('.activity-week-row:not([data-off])').length === 1`, 'one day picked');
  await clickLabel(day1);
  await s.waitFor(`document.querySelectorAll('.activity-week-row:not([data-off])').length === 2`, 'two days picked');
  const picked280 = await s.evalJs(
    `(() => { const w = document.querySelector('.activity-week'); const on = [...w.querySelectorAll('.activity-week-row:not([data-off])')]; const off = w.querySelectorAll('.activity-week-row[data-off]').length; const t = document.querySelector('.activity-view-tally'); return { onDays: on.map((r) => r.dataset.day), onTops: on.map((r) => r.getBoundingClientRect().top), off, peak: Number(w.dataset.peak), head: document.querySelector('.activity-view-stats').textContent, tally: t === null ? 0 : Number(t.dataset.commits), agentMs: Number(document.querySelector('.activity-view-stats').dataset.agentMs) }; })()`,
  );
  expect(JSON.stringify(picked280.onDays) === JSON.stringify([day0, day1]), `the two picked days stay, the rest off, got ${JSON.stringify(picked280.onDays)}`);
  // The two picked rows sit one row gap apart (ROW_GAP scaled, up to
  // 1.25×), never the wider spread seven unpicked days would leave.
  const gap280 = picked280.onTops[1] - picked280.onTops[0];
  expect(gap280 > 0 && gap280 < 80, `the picked rows sit adjacent, got ${gap280}`);
  expect(picked280.off === 5, `the other five sit in the dimmed list, got ${picked280.off}`);
  const largerPeak = Math.max(wk.rows.find((r) => r.day === day0).peak, wk.rows.find((r) => r.day === day1).peak);
  expect(picked280.peak === largerPeak, `the peak is over the picked rows alone, got ${picked280.peak} for the larger of the two, ${largerPeak}`);
  expect(picked280.head.includes('2 of 7 days'), `the stats head names the pick, got ${JSON.stringify(picked280.head)}`);
  expect(picked280.tally === 0, `M9 fix 297: day0 and day1 seed no commits, so the tally prices the pick alone and reads none, got ${picked280.tally}`);
  // The strict compare that proves the scoping: the picked reading is
  // the two rows' own agent-hours (a tolerance of a tenth either side of
  // the sum, since each row's label is rounded to one decimal on its
  // own), and it is strictly under the week's, read before any pick.
  // On a Monday or a Tuesday day0 or day1 is today or later, its label
  // without hours (NaN here) and the week's own time not yet above the
  // pick's, so the two agent-time compares need both days in the past.
  if (pastDays >= 2) {
    expect(Math.abs(picked280.agentMs - pickedHours297 * HOUR) < HOUR / 10, `the picked agent time is day0 and day1's own (${pickedHours297}h), got ${(picked280.agentMs / HOUR).toFixed(2)}h`);
    expect(picked280.agentMs < agentMsBefore297, `the picked agent time is under the week's, got ${(picked280.agentMs / HOUR).toFixed(2)}h of ${(agentMsBefore297 / HOUR).toFixed(2)}h`);
  } else {
    console.log(`[verify] fix 297's agent-time compares skipped: ${pastDays} past days in the week, day0 and day1 not both past`);
  }
  await s.evalJs(`document.querySelector('.activity-view-week-pick').click()`);
  await s.waitFor(`document.querySelectorAll('.activity-week-row:not([data-off])').length === 7`, 'every day back');
  const tallyAfter297 = await tallyOf297();
  const agentMsAfter297 = await agentMsOf297();
  expect(tallyAfter297 === tallyBefore297, `M9 fix 297: back to seven days, the tally reads the week's own count again, got ${tallyAfter297} for ${tallyBefore297}`);
  expect(agentMsAfter297 === agentMsBefore297, `M9 fix 297: back to seven days, the agent time reads the week's own figure again, got ${(agentMsAfter297 / HOUR).toFixed(2)}h for ${(agentMsBefore297 / HOUR).toFixed(2)}h`);
  step(`M9 fix 280: picking ${day0} and ${day1} restacks the ridges adjacent on their own peak of ${picked280.peak}, the head reads "2 of 7 days", a click on it brings the seven back`);
  step(`M9 fix 297: with day0 and day1 picked the tally reads ${picked280.tally} commits and ${(picked280.agentMs / HOUR).toFixed(1)}h of agent time, theirs alone and under the week's ${(agentMsBefore297 / HOUR).toFixed(1)}h; back to seven it reads ${tallyAfter297} commits and ${(agentMsAfter297 / HOUR).toFixed(1)}h again, the week's own`);

  // M9 fix 281: the condensed form, on the density button now enabled on
  // the week: a shorter gutter with the day's name alone, half the full
  // form's scale, no floor lines and no textual readout (the crosshair's
  // per-dot figures stand in), the choice kept under its own key across
  // a reload.
  await s.evalJs(`document.querySelector('.activity-view .activity-density').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.density === 'condensed'`, 'the week condensed');
  const condensedWeek = await s.evalJs(
    `(() => { const w = document.querySelector('.activity-week'); return { scale: Number(w.dataset.scale), labels: [...w.querySelectorAll('.activity-week-label')].map((l) => l.textContent), readout: !!w.querySelector('.activity-week-readout'), floor: !!w.querySelector('.activity-week-floor'), rows: [...w.querySelectorAll('.activity-week-row:not([data-off])')].map((r) => r.getBoundingClientRect().top), classed: w.classList.contains('activity-week-condensed'), title: document.querySelector('.activity-view .activity-density').title }; })()`,
  );
  expect(condensedWeek.classed && condensedWeek.scale === 0.5, `the condensed form is half scale, got ${JSON.stringify(condensedWeek)}`);
  expect(condensedWeek.labels.every((l) => /^\w{3} \d+$/.test(l)), `the labels are the day names alone, got ${JSON.stringify(condensedWeek.labels)}`);
  expect(!condensedWeek.readout && !condensedWeek.floor, 'the condensed form draws no readout line and no floor');
  const condensedGap = condensedWeek.rows[1] - condensedWeek.rows[0];
  expect(condensedGap > 0 && condensedGap < 52, `the condensed row gap is under the full form's, got ${condensedGap}`);
  expect(condensedWeek.title === 'The ridges alone', `the button's title says what the next click brings, got ${condensedWeek.title}`);
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.window === ${JSON.stringify(weekView.window)} && document.querySelector('.activity-view')?.dataset.state === 'ready' && document.querySelectorAll('.activity-week-row').length === 7`, 'the week again after the reload', 20000);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.density === 'condensed'`, 'the condensed choice kept across the reload');
  await s.evalJs(`document.querySelector('.activity-view .activity-density').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.density === 'rows'`, 'back to the full form');
  step('M9 fix 281: the density button condenses the week to half scale with the day names alone, no readout and no floor, kept across a reload');

  await pick('day');
  await s.evalJs(`[...document.querySelectorAll('.activity-view .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view') && document.querySelectorAll('.tab-file').length === 0`, 'the tab closed');
  step('back to the day, the tab closes like a file');

  // The CLI on the same pipe agrees with the card.
  const out = JSON.parse(await cli('activity', '--json'));
  expect(out.day === day, `emmer activity names today, got ${out.day}`);
  expect(out.stats.peak === 2 && out.stats.parallel.toFixed(1) === parallelOnLine.toFixed(1), `the CLI's stats agree, got ${JSON.stringify(out.stats)}`);
  const cliA = out.sessions.find((x) => x.sessionId === a);
  const cliC = out.sessions.find((x) => x.sessionId === c);
  expect(cliA !== undefined && cliA.spans.length === 1 && cliA.spans[0].prompt === 'find every caller of dropSession' && !cliA.lifetime, 'alpha has its one span with the prompt');
  expect(cliC !== undefined && cliC.lifetime && cliC.spans.length === 1, 'the plain shell has its lifetime span');
  const lines = (await cli('activity')).trimEnd().split('\n');
  expect(lines.length === 5 && lines[0].includes(`${parallelOnLine.toFixed(1)}× parallel`) && lines.some((l) => l.includes('alpha')) && lines[4] === historyWant(), `five lines, the stats, three sessions and the history's reach, got ${JSON.stringify(lines)}`);
  const usage = await cli('activity', '--day', '2020-13-40').catch((err) => err.message);
  expect(usage.includes('YYYY-MM-DD'), 'a bad day is a usage error');
  step(`emmer activity: ${lines[0]}`);

  // M62: a fourth session sends two agents out during one turn; the
  // Agent tool names the first, the second has only its type; the first
  // stops on its own, the second is closed by the parent's Stop. The tab
  // shows the parent and two rows under it, the figures count all three,
  // and the CLI prints the agents indented.
  const g = await spawn('gamma');
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 4`, 'four rows');
  await post(g, { hook_event_name: 'SessionStart', source: 'startup' });
  const g0 = Date.now();
  await post(g, { hook_event_name: 'UserPromptSubmit', prompt: 'run the batch' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(g)}]')?.dataset.state === 'working'`, 'gamma working');
  await sleep(Math.max(0, 300 - (Date.now() - g0)));
  await post(g, { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { description: 'Read the log', subagent_type: 'Explore' }, tool_response: { agentId: 'm62-a1', description: 'Read the log', status: 'async_launched' } });
  await post(g, { hook_event_name: 'SubagentStart', agent_id: 'm62-a1', agent_type: 'Explore' });
  await sleep(Math.max(0, 600 - (Date.now() - g0)));
  await post(g, { hook_event_name: 'SubagentStart', agent_id: 'm62-a2', agent_type: 'fork' });
  await sleep(Math.max(0, 1300 - (Date.now() - g0)));
  await post(g, { hook_event_name: 'SubagentStop', agent_id: 'm62-a1', agent_type: 'Explore' });
  await sleep(Math.max(0, 2000 - (Date.now() - g0)));
  await post(g, { hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(g)}]')?.dataset.state === 'done'`, 'gamma done');
  await s.waitFor(`(document.querySelector('.activity-card .activity-text')?.textContent ?? '').includes('peak 3')`, 'the card counts the agents in its peak', 10000);
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.state === 'ready' && document.querySelectorAll('.activity-view .activity-view-name[data-agent]').length === 2`, 'the tab with two agent rows', 10000);
  const rowsNow = await s.evalJs(`[...document.querySelectorAll('.activity-view .activity-view-name')].map(n => ({ text: n.textContent, session: n.dataset.sessionId, agent: n.dataset.agentId ?? null }))`);
  const gi = rowsNow.findIndex((r) => r.session === g && r.agent === null);
  expect(gi >= 0 && rowsNow[gi].text === 'gamma', `gamma has its own row, got ${JSON.stringify(rowsNow)}`);
  expect(rowsNow[gi + 1]?.agent === 'm62-a1' && rowsNow[gi + 1].text === 'Read the log', `the first agent's row follows gamma, named by its description, got ${JSON.stringify(rowsNow[gi + 1])}`);
  expect(rowsNow[gi + 2]?.agent === 'm62-a2' && rowsNow[gi + 2].text === 'fork', `the second agent's row follows, named by its type, got ${JSON.stringify(rowsNow[gi + 2])}`);
  const agentSpan = (agentId) =>
    s.evalJs(
      `(() => { const el = document.querySelector('.activity-view .activity-span[data-agent-id=${JSON.stringify(agentId)}]'); if (!el) return null; return { left: parseFloat(el.style.left), width: parseFloat(el.style.width), title: el.title, opacity: getComputedStyle(el).opacity, color: getComputedStyle(el).color }; })()`,
    );
  const parentSpan = await s.evalJs(
    `(() => { const el = document.querySelector('.activity-view .activity-span[data-session-id=${JSON.stringify(g)}]:not([data-agent])'); if (!el) return null; return { left: parseFloat(el.style.left), width: parseFloat(el.style.width), color: getComputedStyle(el).color }; })()`,
  );
  const sa1 = await agentSpan('m62-a1');
  const sa2 = await agentSpan('m62-a2');
  expect(parentSpan !== null && sa1 !== null && sa2 !== null, 'a span for the parent and each agent');
  expect(sa1.color === parentSpan.color && sa2.color === parentSpan.color, `the agents draw in the parent's colour, got ${sa1.color} and ${sa2.color} against ${parentSpan.color}`);
  expect(parseFloat(sa1.opacity) < 1, `an agent's span is lighter, got opacity ${sa1.opacity}`);
  expect(sa1.title.includes('Read the log') && sa1.title.includes('Explore') && sa1.title.includes('gamma'), `the hover names the agent, its type and its parent, got ${JSON.stringify(sa1.title)}`);
  // The second agent never stopped: its span ends where the parent's does.
  const endOf = (sp) => sp.left + sp.width;
  const endGap = Math.abs(endOf(sa2) - endOf(parentSpan));
  expect(endGap < parentSpan.width * 0.1, `the unstopped agent's span ends at the parent's Stop, got ends ${endOf(sa2).toFixed(4)}% and ${endOf(parentSpan).toFixed(4)}%`);
  expect(endOf(sa1) < endOf(parentSpan) - parentSpan.width * 0.2, `the stopped agent's span ends before the parent's, got ${endOf(sa1).toFixed(4)}% against ${endOf(parentSpan).toFixed(4)}%`);
  const statsNow = await s.evalJs(`document.querySelector('.activity-view-stats')?.textContent ?? ''`);
  expect(statsNow.includes('peak 3'), `the tab's figures count the parent and its two agents, got ${statsNow}`);
  await s.screenshot('m62-activity-agents.png');
  await s.evalJs(`[...document.querySelectorAll('.activity-view .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view')`, 'the tab closed');
  const outG = JSON.parse(await cli('activity', '--json'));
  const gRows = outG.sessions.filter((x) => x.sessionId === g);
  expect(gRows.length === 3 && gRows[0].agentId === null && gRows[1].agentId === 'm62-a1' && gRows[2].agentId === 'm62-a2', `the CLI's answer has gamma and its two agents in order, got ${JSON.stringify(gRows.map((x) => x.agentId))}`);
  const sumG = gRows.reduce((sum, x) => sum + x.spans.reduce((t, sp) => t + (sp.to - sp.from), 0), 0);
  const others = outG.sessions.filter((x) => x.sessionId !== g && !x.lifetime).reduce((sum, x) => sum + x.spans.reduce((t, sp) => t + (sp.to - sp.from), 0), 0);
  expect(Math.abs(outG.stats.agentMs - (sumG + others)) < 5 && outG.stats.peak === 3, `the agent time is the sum of every span, agents included, got ${outG.stats.agentMs} against ${sumG + others}, peak ${outG.stats.peak}`);
  expect(gRows[1].kind === 'agent' && gRows[1].parentId === g && gRows[1].agentType === 'Explore' && gRows[1].name === 'Read the log', `an agent row carries its kind, parent, type and name, got ${JSON.stringify(gRows[1])}`);
  const linesG = (await cli('activity')).trimEnd().split('\n');
  const gLine = linesG.findIndex((l) => l.startsWith('  ') && !l.startsWith('    ') && l.includes('gamma'));
  expect(gLine >= 0 && linesG[gLine + 1]?.startsWith('    m62-a1  agent') && linesG[gLine + 1].includes('Read the log (Explore)') && linesG[gLine + 2]?.startsWith('    m62-a2  agent') && linesG[gLine + 2].includes('  fork  '), `emmer activity prints the two agents indented under gamma, got ${JSON.stringify(linesG.slice(gLine, gLine + 3))}`);
  step(`M62: gamma and its two agents, ${statsNow}`);
  // M57: beta killed and cleared from the list keeps its row, named and
  // coloured, on the card, in the tab and in emmer activity, since the
  // daemon keeps a removed session's record and names the track from it.
  const betaColor = await s.evalJs(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(b)}]')?.dataset.color ?? null`);
  await zreq(s, 'session.kill', { sessionId: b, remove: true });
  await s.waitFor(`!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(b)}]')`, 'beta left the sidebar', 10000);
  const kept = (await zreq(s, 'session.list', { removed: true })).sessions.find((x) => x.id === b);
  expect(kept !== undefined && kept.name === 'beta' && typeof kept.removedAt === 'number', `the daemon still lists beta behind the flag, removed at a time (${JSON.stringify(kept && [kept.name, kept.removedAt])})`);
  expect(!(await zreq(s, 'session.list', {})).sessions.some((x) => x.id === b), 'and not without it');
  await s.waitFor(`document.querySelector('.activity-card .activity-span[data-session-id=${JSON.stringify(b)}]')?.title.startsWith('beta')`, 'the card still names beta after the refetch', 10000);
  const keptSpan = await spanOf(b);
  expect(keptSpan !== null && keptSpan.title.includes('beta') && keptSpan.title.includes('plan the batch'), `beta's span keeps its name and prompt, got ${JSON.stringify(keptSpan?.title)}`);
  const keptColor = await s.evalJs(`document.querySelector('.activity-card .activity-span[data-session-id=${JSON.stringify(b)}]')?.style.color ?? null`);
  expect(betaColor !== null && keptColor !== null && keptColor !== '', `and its colour (${betaColor} on the row, ${keptColor} on the span)`);
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.state === 'ready'`, 'the activity tab again');
  const namesAfter = await s.evalJs(`[...document.querySelectorAll('.activity-view .activity-view-name')].map(n => n.textContent)`);
  // The count is whatever M62's gamma and its agents left; the point is beta's name.
  expect(namesAfter.includes('beta') && namesAfter.includes('alpha'), `the tab still has beta's row by name, got ${JSON.stringify(namesAfter)}`);
  await s.screenshot('m57-activity-removed.png');
  await s.evalJs(`[...document.querySelectorAll('.activity-view .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view')`, 'the tab closed again');
  const linesAfter = (await cli('activity')).trimEnd().split('\n');
  expect(linesAfter.length >= 4 && linesAfter.some((l) => l.includes('beta')) && !linesAfter.some((l) => l.includes('no longer listed')), `emmer activity still names beta, got ${JSON.stringify(linesAfter)}`);
  step('M57: a session cleared from the sidebar keeps its named row on the card, the tab and emmer activity');

  // M9 fix 216: the token bars on the tab's stats line, before the count
  // running now. alpha and gamma work again; a status line on each gives
  // the ring its baseline, the next pair's output deltas are spread over
  // the seconds since (M9 fix 229) and summed over both, and once alpha
  // stops the next delta counts gamma alone. The bucket, the count and
  // the curve are read off the module, not written here.
  const { BAR_COUNT, BAR_FLOOR, BUCKET_MS, FULL_TOKENS, barHeight } = await import('../src/renderer/src/activity-bars.ts');
  expect(BUCKET_MS === 1000 && BAR_COUNT === 24 && FULL_TOKENS === 400, `a 1 s bucket, 24 across, 400 tokens a full bar (M9 fix 229), got ${JSON.stringify({ BUCKET_MS, BAR_COUNT, FULL_TOKENS })}`);
  // The status line as the wrapper posts it: one input split (the same
  // split is one request streaming, M9 fix 217), the output so far and
  // Claude Code's cost so far; null leaves the cost block out. extra is
  // spread last (M9 fix 852's effort).
  const statusLine = (id, output, usd, split = [4000, 8000, 12000], extra = {}) => post(id, { hook_event_name: 'StatusLine', model: { display_name: 'Opus 5' }, context_window: { used_percentage: 12, context_window_size: 200000, total_input_tokens: split[0] + split[1] + split[2], current_usage: { input_tokens: split[0], cache_creation_input_tokens: split[1], cache_read_input_tokens: split[2], output_tokens: output } }, ...(usd === null ? {} : { cost: { total_cost_usd: usd } }), ...extra });
  // A post lands a set way into a bucket, so a delta's share of the
  // newest bar is known: 500 ms in, half of one second's worth.
  const alignBucket = async (into = 500) => {
    const now = Date.now();
    const next = now - (now % BUCKET_MS) + BUCKET_MS + into;
    await sleep(next - now);
  };
  const bars = () =>
    s.evalJs(
      `(() => { const b = document.querySelector('.activity-view .activity-bars'); if (!b) return null; const r = b.getBoundingClientRect(); return { count: b.children.length, newest: Number(b.dataset.newest), total: Number(b.dataset.total), agents: Number(b.dataset.agents), title: b.title, heights: [...b.children].map((i) => parseFloat(i.style.transform.replace(/[^0-9.]/g, ''))), rising: [...b.children].map((i) => 'rise' in i.dataset), width: r.width, height: r.height, barWidth: b.firstElementChild.getBoundingClientRect().width, color: getComputedStyle(b.firstElementChild).backgroundColor, working: getComputedStyle(document.documentElement).getPropertyValue('--working').trim(), transition: getComputedStyle(b.lastElementChild).transitionDuration, after: b.nextSibling?.textContent ?? null, line: b.parentElement.textContent }; })()`,
    );
  const atFloor = (h) => Math.abs(h - BAR_FLOOR) < 0.001;
  await post(a, { hook_event_name: 'UserPromptSubmit', prompt: 'count the tokens' });
  await post(g, { hook_event_name: 'UserPromptSubmit', prompt: 'count more of them' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.state === 'working' && document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(g)}]')?.dataset.state === 'working'`, 'alpha and gamma working again');
  await statusLine(a, 100, 0.1);
  await statusLine(g, 50, 0.05);
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.state === 'ready' && (document.querySelector('.activity-view-stats')?.textContent ?? '').includes('2 running now')`, 'the tab with two running now', 10000);
  // M9 fix 228: the band, the stats line and the lanes read one live end.
  // The daemon closes a working session's open span at the instant it
  // answered, and on the minute unit the now line moves on from there at
  // a second a tick, so before the fix the band's last step and the
  // agent time sat at the answered end, up to a refetch behind the line
  // while the lanes drew to it. From :45 the pick would straddle the
  // rollover, as the M67 minute step says.
  const secs228 = new Date().getSeconds();
  if (secs228 >= 45) await sleep((61 - secs228) * 1000);
  await pick('minute');
  // Past the refetch the status lines above debounced, and on, so the
  // answered end is well behind the clock when the reads land.
  await sleep(5000);
  const live228 = await s.evalJs(
    `(() => { const v = document.querySelector('.activity-view'); const band = v.querySelector('.activity-load'); if (!band) return null; const nowAt = parseFloat(band.querySelector('.activity-now').style.left); const peak = Number(band.dataset.peak); const pts = band.querySelector('.activity-load-line').getAttribute('d').match(/[ML][0-9.]+,[0-9.]+/g).map((p) => p.slice(1).split(',').map(Number)); const open = pts.filter((p) => p[1] < peak).map((p) => p[0]); const span = v.querySelector('.activity-strip .activity-span[data-session-id=${JSON.stringify(a)}][data-live]'); return { nowAt, stripNow: parseFloat(v.querySelector('.activity-strip .activity-now').style.left), lastOpen: Math.max(...open), spanEnd: span === null ? null : parseFloat(span.style.left) + parseFloat(span.style.width), count: band.querySelector('.activity-now-count')?.textContent ?? null, stats: v.querySelector('.activity-view-stats').textContent }; })()`,
  );
  expect(live228 !== null && live228.nowAt > 8 && live228.count === '2×', `the minute's band with two at the now line past five seconds (${JSON.stringify(live228)})`);
  expect(live228.lastOpen >= live228.nowAt - 0.2, `the band's last open step reaches the now line, ${live228.lastOpen}% against ${live228.nowAt}% (M9 fix 228)`);
  expect(live228.spanEnd !== null && Math.abs(live228.spanEnd - live228.nowAt) < 0.2 && Math.abs(live228.stripNow - live228.nowAt) < 0.01, `alpha's live span ends where the band does, ${live228.spanEnd}% against ${live228.nowAt}% (M9 fix 228)`);
  await s.screenshot('m9-fix228-live-band.png');
  step(`M9 fix 228: on the minute unit the band's last step (${live228.lastOpen}%), alpha's live span (${live228.spanEnd}%) and the now line (${live228.nowAt}%) agree`);
  await pick('day');
  let bars216 = await bars();
  expect(bars216 !== null && bars216.count === BAR_COUNT && bars216.heights.every(atFloor), `${BAR_COUNT} bars at the floor before any output lands (${JSON.stringify(bars216 && { count: bars216.count, heights: bars216.heights.slice(-3) })})`);
  // The two status lines are the window's first request points (fix
  // 217), so the totals sit between the peak and the bars.
  expect(bars216.after === '2 running now' && /peak 3( · [\dhms ]+ waiting on you)? · ↑48k ↓150 · \$0\.15 · 2 running now$/.test(bars216.line), `the bars sit between the window's figures and the count (${JSON.stringify({ after: bars216.after, line: bars216.line })})`);
  expect(Math.abs(bars216.width - 71) < 1 && Math.abs(bars216.height - 11) < 1 && Math.abs(bars216.barWidth - 2) < 0.5, `a 71 by 11px box of 2px bars (${JSON.stringify({ width: bars216.width, height: bars216.height, barWidth: bars216.barWidth })})`);
  // The ring's baseline is the tab's open (its reset at the day pick);
  // three seconds on, the pair's 900 tokens are spread from there to the
  // posts, so the sum is the ring's total and the shape a run of bars
  // above the floor rather than one lump.
  await sleep(3000);
  await alignBucket();
  await statusLine(a, 700, 0.25);
  await statusLine(g, 350, 0.12);
  await s.waitFor(`Number(document.querySelector('.activity-view .activity-bars')?.dataset.total) >= 898`, 'the ring sums both deltas', 4000);
  bars216 = await bars();
  expect(Math.abs(bars216.total - 900) <= 2, `the ring holds the pair's 900 tokens (${bars216.total})`);
  expect(bars216.title === `${bars216.newest} output tokens in the last 1 s across 2 agents`, `the tooltip gives the newest second in words (${JSON.stringify(bars216.title)})`);
  const raised216 = bars216.heights.filter((h) => !atFloor(h)).length;
  expect(raised216 >= 4 && raised216 <= 12 && bars216.heights.slice(0, 10).every(atFloor), `the deltas are spread over the seconds since the baseline, ${raised216} bars up and the oldest at the floor (${JSON.stringify(bars216.heights.slice(-8))})`);
  // The newest bar on M41's curve over the module's full bar, and the
  // bars that rose carry the attack mark.
  const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  expect(bars216.color === rgb(bars216.working), `the bars are the band's amber (${bars216.color} against ${bars216.working})`);
  await s.screenshot('m9-fix216-bars.png');
  await post(a, { hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`(document.querySelector('.activity-view-stats')?.textContent ?? '').includes('1 running now')`, 'one running now after alpha stops', 4000);
  // gamma alone: its next delta, 100 over the seconds since its last
  // line, lands with half a second's share in the newest bucket.
  await alignBucket();
  await statusLine(g, 450, 0.15);
  await s.waitFor(`Number(document.querySelector('.activity-view .activity-bars')?.dataset.total) >= 998`, 'the ring counts gamma alone on top', 4000);
  bars216 = await bars();
  expect(Math.abs(bars216.total - 1000) <= 2 && bars216.agents === 1 && bars216.title.endsWith('across 1 agent') && bars216.newest > 0, `gamma's delta alone on top of the pair's (${JSON.stringify({ total: bars216.total, agents: bars216.agents, title: bars216.title, newest: bars216.newest })})`);
  expect(!(await s.evalJs(`!!document.querySelector('.activity-card .activity-bars')`)), 'the rail card draws no bars; it keeps its words');
  step(`M9 fix 216: ${BAR_COUNT} token bars on the tab's line before the count running now, the pair's deltas spread over ${raised216} bars, then gamma's alone`);

  // M9 fix 229: the bars at the agents' pace. On the minute unit gamma
  // streams a status line a second, each landing half a second into its
  // bucket: the newest bar carries half the delta within a second of the
  // post, a new bar starts empty at the next second with the last post's
  // share slid left, and the rise is the attack (no transition) while
  // the fall eases; the band's last step and the stats line's agent
  // time both reach the now line (M9 fix 228).
  const secs229 = new Date().getSeconds();
  if (secs229 >= 40) await sleep((61 - secs229) * 1000);
  await pick('minute');
  await s.waitFor(`(document.querySelector('.activity-view-stats')?.textContent ?? '').includes('1 running now')`, 'the minute with gamma running');
  // The pick reset the ring, so the first post's delta is spread from
  // the pick; it warms the clock and is not read. The four after it are
  // each a second on from the last, half of each in the newest bucket
  // and a little more for the daemon's own delay.
  const seenNewest = [];
  let output229 = 450;
  let warm229 = null;
  for (let i = 0; i < 5; i++) {
    await alignBucket();
    output229 += 100;
    const posted = Date.now();
    await statusLine(g, output229, 0.15);
    if (i === 0) {
      await sleep(300);
      warm229 = await bars();
      continue;
    }
    await s.waitFor(`Number(document.querySelector('.activity-view .activity-bars')?.dataset.newest) >= 25`, `the newest bar rose after post ${i + 1}`, 1000);
    const seen229 = await bars();
    seenNewest.push({ newest: seen229.newest, total: seen229.total, after: Date.now() - posted });
  }
  const last229 = await bars();
  expect(seenNewest.length === 4 && seenNewest.every((r) => r.newest >= 25 && r.newest <= 95 && r.after < 1000), `each post's half-second share is on the newest bar within a second (${JSON.stringify(seenNewest)})`);
  expect(Math.abs(last229.total - warm229.total - 400) <= 2 && last229.rising[BAR_COUNT - 1] && last229.transition === '0s', `the four posts' 400 tokens are in the ring over the warm-up's and the newest bar rose with no transition (${JSON.stringify({ total: last229.total, warm: warm229.total, rising: last229.rising.slice(-4), transition: last229.transition, seen: seenNewest, heights: last229.heights })})`);
  const runOf229 = last229.heights.slice(-5, -1);
  expect(runOf229.every((h) => !atFloor(h)), `the stream drew as a run of bars, not one lump (${JSON.stringify(last229.heights.slice(-6))})`);
  // The next second with no post: a fresh empty bar, the last share slid.
  await alignBucket(200);
  const slid229 = await bars();
  expect(slid229.newest === 0 && slid229.heights[BAR_COUNT - 1] === BAR_FLOOR && slid229.heights[BAR_COUNT - 2] > BAR_FLOOR && !slid229.rising[BAR_COUNT - 1], `a new bar starts empty at the bucket and the last post's share slid left (${JSON.stringify({ newest: slid229.newest, heights: slid229.heights.slice(-3), rising: slid229.rising.slice(-3) })})`);
  expect(Math.abs(barHeight(100) - (BAR_FLOOR + (1 - BAR_FLOOR) * (Math.log2(101) / Math.log2(1 + FULL_TOKENS)))) < 1e-9, 'the curve is M41\'s over the module\'s full bar');
  const live229 = await s.evalJs(
    `(() => { const v = document.querySelector('.activity-view'); const band = v.querySelector('.activity-load'); if (!band) return null; const nowAt = parseFloat(band.querySelector('.activity-now').style.left); const peak = Number(band.dataset.peak); const pts = band.querySelector('.activity-load-line').getAttribute('d').match(/[ML][0-9.]+,[0-9.]+/g).map((p) => p.slice(1).split(',').map(Number)); let area = 0; for (let i = 1; i < pts.length; i++) area += (pts[i][0] - pts[i - 1][0]) * (peak - pts[i - 1][1]); const open = pts.filter((p) => p[1] < peak).map((p) => p[0]); const stats = v.querySelector('.activity-view-stats'); return { nowAt, lastOpen: Math.max(...open), areaSeconds: (area / 100) * 60, agentSeconds: Number(stats.dataset.agentMs) / 1000, stats: stats.textContent, window: v.dataset.window }; })()`,
  );
  // The band's area over the minute is the agent time, both read in one
  // render off one set of live spans, so they agree to the path's
  // rounding; the words round to the minute, so the figure is read off
  // data-agent-ms.
  expect(live229 !== null && live229.lastOpen >= live229.nowAt - 0.2 && Math.abs(live229.agentSeconds - live229.areaSeconds) <= 0.5 && live229.agentSeconds > 0, `the band's last step reaches the now line and the agent time is the band's area, ${live229?.agentSeconds.toFixed(1)}s against ${live229?.areaSeconds.toFixed(1)}s (${JSON.stringify(live229)})`);
  await s.screenshot('m9-fix229-bars-pace.png');
  step(`M9 fix 229: four status lines a second on the minute unit (the warm-up's ${warm229.total} in the ring first), the newest bar carrying each within ${Math.max(...seenNewest.map((r) => r.after))} ms, a fresh bar at the next second, the band and the agent time (${live229.agentSeconds.toFixed(1)}s) at the now line (${live229.nowAt.toFixed(1)}% of ${live229.window})`);
  await pick('day');
  await post(g, { hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(g)}]')?.dataset.state === 'done'`, 'gamma done again');
  await s.evalJs(`[...document.querySelectorAll('.activity-view .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view')`, 'the tab closed after the bars');

  // M9 fix 217: the window's tokens and cost after the peak, summed over
  // the request points the daemon folds from the status lines. The two
  // streams above are one point each (alpha ↑24k ↓700 $0.25, gamma ↑24k
  // ↓950 $0.15 after fix 229's lines); a new split on each is a second
  // point whose cost is the delta of the total, then a third on gamma
  // with no cost block is
  // priced from the rates and marks the sum with ~. The rail card's
  // line (fed by the since-merge, its hook having lived the whole run)
  // and the tab's (a fresh fetch) agree, the tooltip gives the parts,
  // and emmer activity prints the totals.
  await statusLine(a, 250, 0.45, [1000, 2000, 30000]);
  await statusLine(g, 300, 0.35, [1000, 3000, 40000]);
  await s.waitFor(`(document.querySelector('.activity-card .activity-text')?.textContent ?? '').includes('$0.80')`, 'the card sums the four points', 10000).catch(async (err) => {
    throw new Error(`${err.message}; the card reads ${JSON.stringify(await cardText())}; the CLI says ${JSON.stringify(JSON.parse(await cli('activity', '--json')).stats)}`);
  });
  const text217 = await cardText();
  expect(/peak 3( · [\dhms ]+ waiting on you)? · ↑125k ↓2\.2k · \$0\.80 · 0 running now$/.test(text217), `the card's line reads the tokens and the cost after the peak and before the count (${JSON.stringify(text217)})`);
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  const totals = () =>
    s.evalJs(
      `(() => { const t = document.querySelector('.activity-view .activity-view-totals'); if (!t) return null; const k = t.querySelector('.activity-view-tokens'); const st = getComputedStyle(k); return { text: t.textContent, title: t.title, requests: t.dataset.requests, estimated: 'estimated' in t.dataset, tokens: k.textContent, usd: t.querySelector('.activity-view-usd').textContent, font: st.fontFamily, size: st.fontSize, arrows: k.querySelectorAll('.tokens-arrow-icon').length, line: t.parentElement.textContent }; })()`,
    );
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.state === 'ready' && document.querySelector('.activity-view .activity-view-totals')?.dataset.requests === '4'`, 'the tab with the four points', 10000);
  let totals217 = await totals();
  expect(totals217.tokens === '↑125k ↓2.2k' && totals217.usd === '$0.80' && !totals217.estimated && totals217.arrows === 2, `the tab's line carries the tokens with fix 155's arrows and the dollars (${JSON.stringify(totals217)})`);
  expect(/Cascadia/.test(totals217.font) && totals217.size === '11px', `the tokens are in the row's Cascadia 11px (${totals217.font} ${totals217.size})`);
  expect(/peak 3( · [\dhms ]+ waiting on you)? · ↑125k ↓2\.2k · \$0\.80 · 0 running now$/.test(totals217.line), `the tab's line agrees with the card's (${JSON.stringify(totals217.line)})`);
  expect(totals217.title === '↑125k sent: 10k fresh · 21k cache write · 94k cache read (75% cached)\n↓2.2k received\n$0.80, Claude Code\'s own figure summed over 4 requests', `the tooltip gives the four parts, the cached share and where the dollars came from (${JSON.stringify(totals217.title)})`);
  // No cost block: priced from the rates (Opus 5: 100 fresh, 200 cache
  // write, 50k cache read, 1k out is $0.05175) and marked.
  await statusLine(g, 1000, null, [100, 200, 50000]);
  await s.waitFor(`document.querySelector('.activity-view .activity-view-totals')?.dataset.requests === '5'`, 'the fifth point', 10000);
  totals217 = await totals();
  expect(totals217.tokens === '↑175.3k ↓3.2k' && totals217.usd === '~$0.85' && totals217.estimated, `a request without Claude Code's figure is priced from the rates and the sum marked (${JSON.stringify({ tokens: totals217.tokens, usd: totals217.usd, estimated: totals217.estimated })})`);
  expect(totals217.title.endsWith('~$0.85 over 5 requests, priced from the rates where Claude Code gave no figure'), `the tooltip says so (${JSON.stringify(totals217.title)})`);
  await s.screenshot('m9-fix217-totals.png');
  await s.evalJs(`[...document.querySelectorAll('.activity-view .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view')`, 'the tab closed after the totals');
  await s.waitFor(`(document.querySelector('.activity-card .activity-text')?.textContent ?? '').includes('~$0.85')`, 'the card merged the fifth point through since', 10000);
  // The line's card names the two new rows with their meanings.
  const lineAt217 = await s.evalJs(`(() => { const r = document.querySelector('.activity-card .activity-text').getBoundingClientRect(); return { x: r.x + Math.min(40, r.width / 2), y: r.y + r.height / 2 }; })()`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: lineAt217.x, y: lineAt217.y });
  await s.waitFor(`!!document.querySelector('.activity-text-popover')`, 'the activity line opens its card again', 3000);
  const card217 = await s.evalJs(`[...document.querySelectorAll('.activity-text-popover [data-part="stat"]')].map((l) => [l.querySelector('.sweep-card-label').textContent, l.querySelector('.sweep-card-text').textContent])`);
  const tokRow = card217.find((r) => r[0] === '↑175.3k ↓3.2k');
  const usdRow = card217.find((r) => r[0] === '~$0.85');
  expect(tokRow !== undefined && tokRow[1] === 'tokens sent and received over 5 requests: 10.1k fresh, 21.2k cache write, 144k cache read (82% cached)', `the card's tokens row carries the split (${JSON.stringify(card217)})`);
  expect(usdRow !== undefined && usdRow[1].startsWith('at API rates, priced from the rates table') && card217[card217.length - 1][0] === '0 running now', `the card's cost row says where the figure came from, the count still last (${JSON.stringify(card217)})`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await s.waitFor(`!document.querySelector('.activity-text-popover')`, 'the card closed');
  const cliLine217 = (await cli('activity')).trimEnd().split('\n')[0];
  expect(cliLine217.includes('↑175.3k ↓3.2k · ~$0.85') && !cliLine217.includes('running now'), `emmer activity prints the totals (${JSON.stringify(cliLine217)})`);
  const cliJson217 = JSON.parse(await cli('activity', '--json'));
  const gReq = cliJson217.sessions.find((x) => x.sessionId === g && x.agentId === null)?.requests ?? [];
  expect(gReq.length === 3 && gReq[0].output === 950 && gReq[0].usd === 0.15 && Math.abs(gReq[1].usd - 0.2) < 1e-9 && gReq[2].usd === null && gReq[2].model === 'Opus 5', `the JSON carries gamma's three points folded (${JSON.stringify(gReq)})`);
  expect(Math.abs(cliJson217.stats.usd - 0.85175) < 1e-6 && cliJson217.stats.estimated === true && cliJson217.stats.requests === 5, `the CLI's stats carry the sum (${JSON.stringify(cliJson217.stats)})`);
  // M9 fix 852: alpha works again and a status line with an effort opens
  // a point in the new span (a new split of nothing, its total alpha's
  // last, so the sums above and fix 218's reads below stay as they are);
  // the span's hover names the model and the effort. Stopped again, so
  // fix 218 starts from alpha done.
  await post(a, { hook_event_name: 'UserPromptSubmit', prompt: 'say the effort' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.state === 'working'`, 'fix 852: alpha working again');
  await statusLine(a, 0, 0.45, [0, 0, 0], { effort: { level: 'high' } });
  const lastSpan852 = `[...document.querySelectorAll(${JSON.stringify(`.activity-card .activity-span[data-session-id=${JSON.stringify(a)}]`)})].pop()`;
  await s.waitFor(`(${lastSpan852}?.title ?? '').split('\\n')[0].endsWith(' · Opus 5 · high')`, "fix 852: alpha's new span names the model and the effort", 10000).catch(async (err) => {
    throw new Error(`${err.message}; the last span reads ${JSON.stringify(await s.evalJs(`${lastSpan852}?.title ?? null`))}`);
  });
  console.log('fix 852 span title', JSON.stringify(await s.evalJs(`${lastSpan852}.title`)));
  await post(a, { hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.state === 'done'`, 'fix 852: alpha done again');
  step("M9 fix 217: the window's tokens and cost after the peak on the card, the tab and emmer activity, the cost the sum of the deltas, a costless request priced from the rates and marked, and a span's hover names the model and effort it ran at (M9 fix 852)");

  // M9 fix 218: the commits and merges landed over the window, off the
  // records' credited commits. alpha commits in a scratch repo through
  // its Bash hooks (HEAD held before, credited after), then merges a
  // side branch the same way, so the record holds a plain commit and a
  // merge; the tally follows the peak, the tooltip names alpha, and the
  // CLI prints and carries it. The second claim waits for the first to
  // land on the record (the CLAUDE.md gotcha on recordHead).
  const repo218 = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-verify-218-')));
  // Dated by the wall clock (M9 fix 470): the daemon credits a call only
  // the commits made since its PreToolUse, and the fixed 2023 date this
  // used to carry credited nothing.
  const git218 = (...args) => execFileSync('git', args, { cwd: repo218, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  git218('init', '-q', '-b', 'main');
  git218('config', 'user.name', 'verify');
  git218('config', 'user.email', 'verify@example.invalid');
  git218('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(repo218, 'base.txt'), 'base');
  git218('add', 'base.txt');
  git218('commit', '-q', '-m', 'base');
  const claim218 = async (command, work) => {
    await post(a, { cwd: repo218, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });
    await sleep(300);
    work();
    const hash = git218('rev-parse', 'HEAD').trim();
    await post(a, { cwd: repo218, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command } });
    await s.waitFor(`window.emerald.request('session.list', {}).then((r) => r.sessions.find((x) => x.id === ${JSON.stringify(a)}).commits.some((c) => c.hash === ${JSON.stringify(hash)}))`, `alpha's record holds ${hash.slice(0, 8)}`, 10000);
    return hash;
  };
  const plain218 = await claim218('git commit -q -m one', () => {
    fs.writeFileSync(path.join(repo218, 'one.txt'), 'one');
    git218('add', 'one.txt');
    git218('commit', '-q', '-m', 'one');
  });
  git218('checkout', '-q', '-b', 'side');
  fs.writeFileSync(path.join(repo218, 'side.txt'), 'side');
  git218('add', 'side.txt');
  git218('commit', '-q', '-m', 'side');
  git218('checkout', '-q', 'main');
  const merge218 = await claim218('git merge --no-ff -m M side', () => git218('merge', '-q', '--no-ff', '-m', 'M', 'side'));
  // The tool hooks put alpha to work; its Stop ends the turn so the line
  // reads 0 running again.
  await post(a, { hook_event_name: 'Stop', stop_hook_active: false });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.state === 'done'`, 'alpha done after its claims');
  const recorded218 = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === a).commits;
  expect(recorded218.some((c) => c.hash === plain218 && c.merge !== true) && recorded218.some((c) => c.hash === merge218 && c.merge === true), `the record flags the merge and not the plain commit (${JSON.stringify(recorded218.map((c) => [c.hash.slice(0, 8), c.merge ?? null]))})`);
  await s.waitFor(`(document.querySelector('.activity-card .activity-text')?.textContent ?? '').includes('2 commits, 1 merge')`, 'the card tallies the two claims', 10000);
  const text218 = await cardText();
  expect(/peak 3( · [\dhms ]+ waiting on you)? · 2 commits, 1 merge · ↑175\.3k ↓3\.2k · ~\$0\.85 · 0 running now$/.test(text218), `the tally sits after the peak and before the tokens (${JSON.stringify(text218)})`);
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view')?.dataset.state === 'ready' && !!document.querySelector('.activity-view .activity-view-tally')`, 'the tab with the tally', 10000);
  const tally218 = await s.evalJs(`(() => { const t = document.querySelector('.activity-view .activity-view-tally'); return { text: t.textContent, title: t.title, commits: t.dataset.commits, merges: t.dataset.merges, line: t.parentElement.textContent }; })()`);
  expect(tally218.text === ' · 2 commits, 1 merge' && tally218.commits === '2' && tally218.merges === '1', `the tab's line carries the tally (${JSON.stringify(tally218)})`);
  expect(tally218.title === '2 commits, 1 merge landed by the sessions on the graph: alpha 2', `the tooltip names who landed them (${JSON.stringify(tally218.title)})`);
  expect(/peak 3( · [\dhms ]+ waiting on you)? · 2 commits, 1 merge · ↑175\.3k ↓3\.2k · ~\$0\.85 · 0 running now$/.test(tally218.line), `the tab's line agrees with the card's (${JSON.stringify(tally218.line)})`);
  await s.screenshot('m9-fix218-tally.png');
  await s.evalJs(`[...document.querySelectorAll('.activity-view .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view')`, 'the tab closed after the tally');
  const cliLine218 = (await cli('activity')).trimEnd().split('\n')[0];
  expect(cliLine218.includes('peak 3 · 2 commits, 1 merge · ↑175.3k'), `emmer activity prints the tally (${JSON.stringify(cliLine218)})`);
  const cliJson218 = JSON.parse(await cli('activity', '--json'));
  const aCommits = cliJson218.sessions.find((x) => x.sessionId === a && x.agentId === null)?.commits ?? [];
  expect(aCommits.length === 2 && aCommits[0].hash === plain218 && aCommits[0].merge === false && aCommits[1].hash === merge218 && aCommits[1].merge === true && cliJson218.stats.commits === 2 && cliJson218.stats.merges === 1, `the JSON carries alpha's two commits with the merge flagged and the stats count them (${JSON.stringify({ commits: aCommits, stats: [cliJson218.stats.commits, cliJson218.stats.merges] })})`);
  fs.rmSync(repo218, { recursive: true, force: true });
  step("M9 fix 218: two claims on alpha, a commit and a merge, tallied after the peak on the card, the tab and emmer activity, the tooltip naming alpha");

  // M9 fix 231, the live half: alpha asks on today's tab, its stretch
  // grows to the now line, the header carries the live figure, and at
  // 340px the part leads the second line with the pulse on it. Here
  // rather than with the seeded days, since the extra turn on alpha
  // would move the figures the steps between read.
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(V)})?.dataset.day === ${JSON.stringify(day)} && document.querySelector(${JSON.stringify(V)})?.dataset.state === 'ready'`, 'today as a tab again', 10000);
  expect(!(await s.evalJs(`!!document.querySelector(${JSON.stringify(V + ' .activity-view-live-debt')})`)), 'no live figure while nobody asks');
  await post(a, { hook_event_name: 'UserPromptSubmit', prompt: 'ask me something' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.state === 'working'`, 'alpha working again');
  await post(a, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.state === 'needs-input'`, 'alpha needs input');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(V + ' .activity-debt-span[data-kind="asked"][data-live]')})`, "alpha's live asked stretch on the tab", 8000);
  // The part follows the view's own clock (a 5 s tick on the day), which
  // clips the window at its last tick: a stretch begun since then sums
  // to nothing until the next.
  await s.waitFor(`!!document.querySelector(${JSON.stringify(V + ' .activity-view-debt-part')})`, 'the part on the line once the clock has ticked', 8000);
  const live = await s.evalJs(
    `(() => { const v = document.querySelector(${JSON.stringify(V)}); const strip = v.querySelector('.activity-strip'); const w = strip.getBoundingClientRect().width; const el = strip.querySelector('.activity-debt-span[data-kind="asked"][data-live]'); const nowAt = parseFloat(strip.querySelector('.activity-now').style.left); const end = parseFloat(el.style.left) + parseFloat(el.style.width); const fig = v.querySelector('.activity-view-live-debt'); const pulse = fig?.querySelector('.activity-debt-pulse'); const part = v.querySelector('.activity-view-debt-part'); return { gapPx: Math.abs(end - nowAt) * w / 100, animated: getComputedStyle(el).animationName !== 'none', figure: fig?.textContent ?? null, figureShown: fig ? getComputedStyle(fig).display !== 'none' : null, pulse: pulse ? getComputedStyle(pulse).animationName : null, part: part?.textContent ?? null, linePulseShown: part ? getComputedStyle(part.querySelector('.activity-debt-pulse[data-place="line"]')).display !== 'none' : null, partBlock: part ? getComputedStyle(part).display : null }; })()`,
  );
  expect(live.gapPx <= 1 && !live.animated, `alpha's open asked stretch ends at the now line's percent within a pixel and carries no animation (${JSON.stringify({ gapPx: live.gapPx, animated: live.animated })})`);
  expect(live.figureShown === true && /^waiting on you \d+s$/.test(live.figure) && live.pulse === 'needs-pulse' && live.linePulseShown === false, `the header carries the live figure with the needs-input pulse and the part on the line has none (${JSON.stringify(live)})`);
  await s.screenshot('attention-debt-231-live.png');
  // At 340px: the view is a container, so its own width is what the
  // rules read; the box is pinned there for the read and let go after.
  await s.evalJs(`(() => { const v = document.querySelector(${JSON.stringify(V)}); v.style.flex = 'none'; v.style.width = '340px'; })()`);
  await sleep(200);
  const narrow = await s.evalJs(
    `(() => { const v = document.querySelector(${JSON.stringify(V)}); const stats = v.querySelector('.activity-view-stats'); const part = v.querySelector('.activity-view-debt-part'); const fig = v.querySelector('.activity-view-live-debt'); const partTop = Math.round(part.getBoundingClientRect().top); const sep = part.querySelector('.activity-view-sep'); const tally = v.querySelector('.activity-view-tally'); return { width: v.getBoundingClientRect().width, breakBefore: getComputedStyle(part, '::before').display, tallyTop: tally ? Math.round(tally.getBoundingClientRect().top) : null, partLeft: Math.round(part.getBoundingClientRect().left - stats.getBoundingClientRect().left), partTop, statsTop: Math.round(stats.getBoundingClientRect().top), sepShown: getComputedStyle(sep).display !== 'none', figureShown: fig ? getComputedStyle(fig).display !== 'none' : null, linePulse: getComputedStyle(part.querySelector('.activity-debt-pulse[data-place="line"]')).display, linePulseAnim: getComputedStyle(part.querySelector('.activity-debt-pulse[data-place="line"]')).animationName }; })()`,
  );
  expect(narrow.width === 340 && narrow.breakBefore === 'block' && narrow.partLeft === 0 && narrow.partTop > narrow.statsTop && narrow.tallyTop === narrow.partTop && !narrow.sepShown && narrow.figureShown === false && narrow.linePulse === 'inline-block' && narrow.linePulseAnim === 'needs-pulse', `at 340px the part leads the second line with no separator and the tally carries on after it, the header has no live figure and the pulse sits on the part (${JSON.stringify(narrow)})`);
  await s.evalJs(`(() => { const v = document.querySelector(${JSON.stringify(V)}); v.style.flex = ''; v.style.width = ''; })()`);
  // Alpha answered: the stretch closes, the figure goes, and the row is
  // back at done for the steps that follow.
  await post(a, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: {} });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.state === 'working'`, 'alpha answered');
  await post(a, { hook_event_name: 'Stop' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(a)}]')?.dataset.state === 'done'`, 'alpha done again');
  await s.waitFor(`!document.querySelector(${JSON.stringify(V + ' .activity-view-live-debt')})`, 'the live figure gone once nobody asks', 8000);
  await s.evalJs(`[...document.querySelectorAll('.activity-view .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view')`, 'the tab closed after the live ask');
  step("M9 fix 231: attention debt live: alpha's open ask ends at the now line with no animation, the header carries the longest current wait with the needs-input pulse, at 340px the part leads the second line with the pulse on it and the header figure goes, and the figure goes when alpha is answered");


  // M9 fix 121: the rail card's unit pill cycles day, hour, minute; the
  // window follows the clock, the head says which, the axis is the
  // unit's, and the choice is kept across a reload.
  const card = () => s.evalJs(`(() => { const c = document.querySelector('.activity-card[data-place="rail"]'); return { unit: c?.dataset.unit ?? null, window: c?.dataset.window ?? null, pill: c?.querySelector('.activity-unit-pick')?.textContent ?? null, text: c?.querySelector('.activity-text')?.textContent ?? null, ticks: [...(c?.querySelectorAll('.activity-tick-label') ?? [])].map((t) => t.textContent) }; })()`);
  let rail = await card();
  expect(rail.unit === 'day' && rail.pill === 'day' && rail.window === day && rail.text.startsWith('today ·'), `the card is on the day (${JSON.stringify(rail)})`);
  const dayTicks = rail.ticks.join(' ');
  // M9 fix 321: with the strip's reading the five-hour window comes
  // between the day and the hour, its pill `5h`, its key the reading's.
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.unit === 'five-hour'`, 'the card on the five-hour window');
  rail = await card();
  expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}f$/.test(rail.window) && rail.pill === '5h' && rail.text.startsWith('this five-hour window ·'), `the five-hour window on the card (${JSON.stringify(rail)})`);
  expect((await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick').title`)) === 'The current five-hour window; click for the hour', 'the pill names the window and the next unit');
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.unit === 'hour' && !!document.querySelector('.activity-card[data-place="rail"] .activity-strip')`, 'the card on the hour');
  rail = await card();
  expect(/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(rail.window) && rail.pill === 'hour' && rail.text.startsWith('this hour ·') && rail.ticks.join(' ') !== dayTicks, `the hour window with its own ticks (${JSON.stringify(rail)})`);
  expect(await s.evalJs(`localStorage.getItem('emerald.activityUnit') === 'hour'`), 'the unit is kept');
  expect((await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-expand')?.title ?? null`)) === 'Open the hour as a tab', 'the expand names the unit');
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.unit === 'hour'`, 'still the hour after a reload', 15000);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.unit === 'minute'`, 'the minute');
  rail = await card();
  expect(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(rail.window) && rail.text.startsWith('this minute ·'), `the minute window (${JSON.stringify(rail)})`);
  // M9 fix 230: the week comes after the minute, the card drawing its
  // ridges at a third of the tab's scale with the day names alone.
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.unit === 'week' && document.querySelectorAll('.activity-card[data-place="rail"] .activity-week-compact .activity-week-row').length === 7`, 'the week on the card with seven rows');
  rail = await card();
  expect(/^\d{4}-\d{2}-\d{2}w$/.test(rail.window) && rail.pill === 'week' && rail.text.startsWith('this week · ') && rail.text.includes('running now'), `the week window on the card with its own line (${JSON.stringify(rail)})`);
  expect((await s.evalJs(`[...document.querySelectorAll('.activity-card[data-place="rail"] .activity-week-label')].map((l) => l.textContent).every((t) => /^\\w{3} \\d+$/.test(t))`)), 'the card labels its rows by the day name alone');
  expect(!(await s.evalJs(`!!document.querySelector('.activity-card[data-place="rail"] .activity-strip, .activity-card[data-place="rail"] .activity-load')`)), 'no strip and no band on the card in the week');
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.unit === 'day'`, 'the day again');
  step('M9 fix 121: the rail card cycles day, the five-hour window (M9 fix 321), hour, minute and the week (M9 fix 230), kept across a reload');

  // M69: the day in a pane. The card's ⧉ puts the activity view in the
  // focused pane (empty, so it is filled rather than split), the same
  // body the tab has, its header without a close; ◀ rewrites the pane's
  // own view rather than opening a tab, so the strip stays empty and the
  // daemon's layout carries the window.
  const paneView = () => s.evalJs(`(() => { const p = document.querySelector('.pane[data-view="activity"]'); if (!p) return null; const v = p.querySelector('.activity-view'); return { window: p.dataset.window, name: p.querySelector('.pane-name')?.textContent ?? null, state: v?.dataset.state ?? null, place: v?.dataset.place ?? null, rows: !!v?.querySelector('.activity-view-rows'), names: v ? v.querySelectorAll('.activity-view-name').length : 0, close: !!v?.querySelector('.file-header button[title^="Close"]'), tabs: document.querySelectorAll('.tab-file').length }; })()`);
  await s.evalJs(`document.querySelector('.activity-card .activity-open-pane').click()`);
  await s.waitFor(`document.querySelector('.pane[data-view="activity"] .activity-view')?.dataset.state === 'ready'`, 'the activity view in a pane');
  let pane = await paneView();
  expect(pane.window === day && pane.name === `Activity · ${day}` && pane.place === 'pane' && pane.rows && pane.names >= 4 && !pane.close && pane.tabs === 0, `the pane shows today with its rows, titled for the day, no close in its header, no tab opened (${JSON.stringify(pane)})`);
  let leaf = leaves(await getLayout(s)).find((p) => p.view !== null);
  expect(leaf !== undefined && leaf.view.kind === 'activity' && leaf.view.window === day, `the daemon's layout holds the activity view for ${day}, got ${JSON.stringify(leaf?.view)}`);

  // M9 fix 126: the pane's header has no title span (the pane's title bar
  // names the window), the tab's still has; and the pane's split and
  // hide buttons say what they do for a view with no folder.
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.state === 'ready'`, 'the day as a tab beside the pane');
  const titles = await s.evalJs(`(() => { const p = document.querySelector('.pane[data-view="activity"]'); return { paneTitle: !!p.querySelector('.activity-view-title'), tabTitle: document.querySelector('.activity-view[data-place="tab"] .activity-view-title')?.textContent ?? null, right: p.querySelector('.pane-split-right').title, down: p.querySelector('.pane-split-down').title, hide: p.querySelector('.pane-hide').title }; })()`);
  expect(!titles.paneTitle && titles.tabTitle === `Activity · ${day}`, `no title span in the pane, the tab keeps its own (${JSON.stringify(titles)})`);
  expect(titles.right === 'Split right, an empty pane (Ctrl+Shift+E)' && titles.down === 'Split down, an empty pane (Ctrl+Shift+O)', `the split titles say an empty pane (${JSON.stringify(titles)})`);
  expect(/^(Close|Empty) this pane \(/.test(titles.hide) && titles.hide.endsWith("the view can be opened again from the rail's Activity tab"), `the hide title says where the view comes back from (${JSON.stringify(titles.hide)})`);
  await s.evalJs(`[...document.querySelectorAll('.activity-view[data-place="tab"] .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view[data-place="tab"]') && document.querySelectorAll('.tab-file').length === 0`, 'the tab closed again');
  step('M9 fix 126: the pane header drops the title span, the tab keeps it, and the split and hide titles fit a view');

  // M9 fix 128: the pane's controls row folds away behind its own button,
  // the stats line staying; the tab's header never folds; the pane's menu
  // is the way back. M9 fix 179: the fold is the pane's chrome, the title
  // bar going with the controls, the flag on the view record, the menu on
  // the bare box. The choice is read again after the relaunch.
  const controls = () => s.evalJs(`(() => { const p = document.querySelector('.pane[data-view="activity"]'); const v = p.querySelector('.activity-view'); return { state: v.dataset.controls, chrome: p.dataset.chrome, title: !!p.querySelector('.pane-title'), header: !!v.querySelector('.file-header'), stats: !!v.querySelector('.activity-view-stats'), fold: !!v.querySelector('.activity-controls-fold'), history: !!v.querySelector('.activity-view-history'), tabHeader: !!document.querySelector('.activity-view[data-place="tab"] .file-header .activity-unit') }; })()`);
  let folded = await controls();
  expect(folded.state === 'shown' && folded.chrome === 'shown' && folded.title && folded.header && folded.fold && folded.history, `the pane starts with its chrome, its controls and the fold button (${JSON.stringify(folded)})`);
  // The bare box's top-left corner, where the title bar was, for the
  // right-click once the chrome is gone; read at each click, since the
  // hooks banner can land above the panes meanwhile and move the box
  // down (one run right-clicked the tab strip on a box read earlier).
  const titleBarNow = () => s.evalJs(`(() => { const r = document.querySelector('.pane[data-view="activity"]').getBoundingClientRect(); return { x: r.x + 40, y: r.y + 10 }; })()`);
  await s.evalJs(`document.querySelector('.pane[data-view="activity"] .activity-controls-fold').click()`);
  await s.waitFor(`document.querySelector('.pane[data-view="activity"] .activity-view')?.dataset.controls === 'folded'`, 'the controls folded');
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.state === 'ready'`, 'the day as a tab beside the folded pane');
  folded = await controls();
  expect(!folded.header && !folded.title && !folded.history && folded.chrome === 'hidden' && folded.stats && folded.tabHeader, `the pane has no header and no title bar and keeps its stats line, the tab keeps its controls (${JSON.stringify(folded)})`);
  expect(leaves(await getLayout(s)).find((p) => p.view !== null && p.view.kind === 'activity')?.view.chrome === false, 'the chrome flag rides the view record');
  await s.screenshot('m9-fix179-activity-chromeless.png');
  await s.evalJs(`[...document.querySelectorAll('.activity-view[data-place="tab"] .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view[data-place="tab"]')`, 'the tab closed again');
  let titleBar = await titleBarNow();
  await s.rightClick(titleBar.x, titleBar.y);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, "the activity pane's menu on the bare box");
  const items = await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent)`);
  expect(items[0] === 'Show the chrome', `the menu leads with Show the chrome, got ${JSON.stringify(items)}`);
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Show the chrome').click()`);
  await s.waitFor(`document.querySelector('.pane[data-view="activity"] .activity-view')?.dataset.controls === 'shown' && !document.querySelector('.pane-menu')`, 'the controls back and the menu gone');
  folded = await controls();
  expect(folded.header && folded.fold && folded.title && folded.history && folded.chrome === 'shown', `the header and the title bar are back with the fold button (${JSON.stringify(folded)})`);
  expect(leaves(await getLayout(s)).find((p) => p.view !== null && p.view.kind === 'activity')?.view.chrome === undefined, 'the chrome shown reads as no field on the record');
  titleBar = await titleBarNow();
  await s.rightClick(titleBar.x, titleBar.y);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, 'the menu again');
  expect((await s.evalJs(`document.querySelector('.pane-menu .menu-item .menu-label')?.textContent`)) === 'Hide the chrome', 'the menu now offers Hide the chrome');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'the menu closed on Escape');
  step('M9 fix 128 and 179: the fold hides the title bar and the controls row and keeps the stats, the tab keeps its header, the menu on the bare box brings the chrome back');

  await s.evalJs(`document.querySelector('.pane[data-view="activity"] .activity-day-prev').click()`);
  await s.waitFor(`document.querySelector('.pane[data-view="activity"]')?.dataset.window === ${JSON.stringify(expectedBefore)}`, 'the pane on the day before');
  pane = await paneView();
  expect(pane.name === `Activity · ${expectedBefore}` && pane.tabs === 0, `the title follows the window and no tab opened (${JSON.stringify(pane)})`);
  leaf = leaves(await getLayout(s)).find((p) => p.view !== null);
  expect(leaf !== undefined && leaf.view.window === expectedBefore, `the layout's view moved to ${expectedBefore}, got ${JSON.stringify(leaf?.view)}`);
  await s.screenshot('m69-activity-pane.png');
  step(`M69: the day in a pane, ◀ moving the pane's own window to ${expectedBefore}`);

  // M9 fix 147: a split off the activity pane starts the shell its
  // button promises (fix 126's title), in the folder the button names:
  // the last folder a session was started from this window, else home.
  // Nothing in this run went through the renderer's start flows yet, so
  // the profile's recent list is empty and the folder is home, and the
  // title says so. A split off a plain empty pane stays a plain split,
  // which verify:menus reads on the empty pane's own buttons.
  const railState = () => s.evalJs(`(() => { const r = document.querySelector('.files-rail'); return { root: r?.dataset.root ?? null, scope: !!r?.querySelector('.activity-card .activity-scope'), paneButton: !!r?.querySelector('.activity-card .activity-open-pane'), empty: [...(r?.querySelectorAll('.files-empty') ?? [])].map((e) => e.textContent) }; })()`);
  const activityPaneId = await s.evalJs(`document.querySelector('.pane[data-view="activity"]').dataset.paneId`);
  const recent = JSON.parse((await s.evalJs(`localStorage.getItem('emerald.recentFolders')`)) ?? '[]');
  const promised = recent[0] ?? home;
  await pickSplitDefault(s, '.pane[data-view="activity"] .pane-split-right', 'Shell');
  const splitTitle = await s.evalJs(`document.querySelector('.pane[data-view="activity"] .pane-split-right').title`);
  expect(splitTitle.startsWith(recent.length === 0 ? 'Split right, new shell in the home folder' : `Split right, new shell in ${path.basename(promised)}`), `the split title names the folder the shell will start in (${JSON.stringify(splitTitle)}, recent ${JSON.stringify(recent)})`);
  await s.evalJs(`document.querySelector('.pane[data-view="activity"] .pane-split-right').click()`);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'a shell pane beside the activity pane, started by the split');
  const splitLeaves = leaves(await getLayout(s));
  const splitShell = splitLeaves.find((p) => p.sessionId !== null);
  const splitSession = splitShell === undefined ? null : (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === splitShell.sessionId);
  expect(splitSession !== null && splitSession !== undefined && splitSession.kind === 'shell' && splitSession.spawnCwd.toLowerCase() === promised.toLowerCase(), `the split's shell started in ${promised} (${JSON.stringify(splitSession && { kind: splitSession.kind, spawnCwd: splitSession.spawnCwd })})`);
  expect(!(await s.evalJs(`!!document.querySelector('.empty-pane .empty-kind')`)), 'no empty pane left by the split');
  await pickSplitDefault(s, '.pane[data-view="activity"] .pane-split-right', 'Empty pane');
  step('M9 fix 147: a split off the activity pane starts the shell its title promises, in the home folder');
  // M9 fix 140: the rail keeps its folder while the activity pane has
  // focus. The shell beside the activity pane puts the rail on home with
  // the strip's scope toggle and the card's pane button; a click back
  // into the activity pane used to empty the rail to "No session in this
  // pane" until a session pane was clicked again.
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(home)}`, 'the rail on the home shell');
  let railNow = await railState();
  expect(railNow.scope && railNow.paneButton, `the rail on home has the scope toggle and the pane button (${JSON.stringify(railNow)})`);
  const activityBox = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(activityPaneId)}] .activity-view').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(activityBox.x, activityBox.y);
  await s.waitFor(`document.querySelector('.pane[data-view="activity"]')?.classList.contains('focused')`, 'the activity pane focused again');
  await sleep(300);
  railNow = await railState();
  expect(railNow.root === home && railNow.scope && railNow.paneButton && !railNow.empty.includes('No session in this pane'), `the rail keeps home with its strip and pane button under the focused activity pane (${JSON.stringify(railNow)})`);
  step('M9 fix 140: the rail keeps its folder, the strip and the pane button while an activity pane has focus');

  // M9 fix 224: the rail's commits section keeps its graph while an
  // Activity document tab is active, and never reads "Not a git
  // repository" before its first read has landed (the click-through's
  // frame caught the section a moment after the rail's Activity tab
  // mounted it on a 200-commit log). A shell in the checkout takes the
  // split shell's pane so the rail is on a repository; the rail's tab is
  // switched away and back to mount the section afresh and its state is
  // read on the way to ready; then the day opens as a tab and the section
  // is read under it. The pane and the tab are put back as found.
  const { session: repoShell } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: repoRoot, name: 'in-repo', cols: 100, rows: 30 });
  let layout224 = await getLayout(s);
  const shellPane224 = leaves(layout224).find((p) => p.sessionId === splitShell.sessionId);
  const withSession224 = (node, paneId, sessionId) => (node.kind === 'pane' ? (node.id === paneId ? { ...node, sessionId } : node) : { ...node, first: withSession224(node.first, paneId, sessionId), second: withSession224(node.second, paneId, sessionId) });
  await zreq(s, 'layout.set', { layout: { ...layout224, root: withSession224(layout224.root, shellPane224.id, repoShell.id), focusedPaneId: shellPane224.id } });
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root?.toLowerCase() === ${JSON.stringify(repoRoot.toLowerCase())}`, 'the rail on the checkout', 10000);
  const commitsState = () => s.evalJs(`(() => { const c = document.querySelector('.files-rail .commits-panel'); if (!c) return null; return { graph: c.dataset.graph ?? null, empty: c.querySelector('.files-empty')?.textContent ?? null, drawn: !!c.querySelector('.commits-graph') }; })()`);
  // Away and back: the panel mounts afresh and its first read is pending.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'files'`, 'the rail on Files');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  const seen224 = [];
  const until224 = Date.now() + 15000;
  while (Date.now() < until224) {
    const st = await commitsState();
    if (st !== null && (seen224.length === 0 || JSON.stringify(seen224[seen224.length - 1]) !== JSON.stringify(st))) seen224.push(st);
    if (st?.graph === 'ready' && st.drawn) break;
    await sleep(20);
  }
  expect(seen224.length > 0 && seen224[seen224.length - 1].graph === 'ready' && seen224[seen224.length - 1].drawn, `the section drew the checkout's graph (${JSON.stringify(seen224)})`);
  expect(seen224.every((st) => st.empty === null && st.graph !== 'none'), `fix 224: no "Not a git repository" on the way to the graph, pending or ready only (${JSON.stringify(seen224)})`);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.state === 'ready'`, 'the day as a tab for fix 224');
  await sleep(500);
  const underTab224 = await commitsState();
  expect(underTab224 !== null && underTab224.graph === 'ready' && underTab224.drawn && underTab224.empty === null, `fix 224: the rail's commits section keeps the graph while the Activity tab is active (${JSON.stringify(underTab224)})`);
  expect((await s.evalJs(`document.querySelector('.files-rail')?.dataset.root?.toLowerCase()`)) === repoRoot.toLowerCase(), 'the rail keeps the checkout under the document tab');
  step(`M9 fix 224: the section went ${seen224.map((st) => st.graph).join(' then ')} with no message on the way, and holds the graph under the Activity tab`);
  // Back as found: the tab closed, the home shell in its pane, the activity pane focused.
  await s.evalJs(`[...document.querySelectorAll('.activity-view[data-place="tab"] .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view[data-place="tab"]')`, 'the fix 224 tab closed');
  layout224 = await getLayout(s);
  // The shell pane focused first, so the rail reads home off it (fix 140 keeps the last folder under the activity pane), then the activity pane clicked as the fix 140 step left it.
  await zreq(s, 'layout.set', { layout: { ...layout224, root: withSession224(layout224.root, shellPane224.id, splitShell.sessionId), focusedPaneId: shellPane224.id } });
  await zreq(s, 'session.kill', { sessionId: repoShell.id, remove: true });
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(home)}`, 'the rail back on home', 10000);
  await s.click(activityBox.x, activityBox.y);
  await s.waitFor(`document.querySelector('.pane[data-view="activity"]')?.classList.contains('focused') && document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(home)}`, 'the activity pane focused again with the rail on home', 10000);

  // M9 fix 178: the tab and the pane open as a snapshot of the rail's
  // section (its scope, folder and layers) and keep their own state from
  // then on: the tab's in its query, persisted with the tab list, the
  // pane's on its view record; a later change in the rail reaches
  // neither, and each has a scope pill of its own since it has a folder.
  const card178 = () => s.evalJs(`(() => { const c = document.querySelector('.activity-card[data-place="rail"]'); return { scope: c.dataset.scope, layers: c.dataset.layers }; })()`);
  const view178 = (sel) => s.evalJs(`(() => { const v = document.querySelector(${JSON.stringify(sel)}); if (!v) return null; return { scope: v.dataset.scope ?? null, folder: v.dataset.folder ?? null, layers: v.dataset.layers ?? null, pill: v.querySelector('.file-header .activity-scope')?.textContent ?? null, names: v.querySelectorAll('.activity-view-name').length }; })()`);
  const tabQuery178 = () => s.evalJs(`JSON.parse(localStorage.getItem('emerald.tabs') ?? '{}').query?.[${JSON.stringify(tabPath)}] ?? null`);
  const cycleCard = async (want) => {
    for (let i = 0; i < 3 && (await card178()).layers !== want; i++) await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-card-layers').click()`);
    await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.layers === ${JSON.stringify(want)}`, `the card at ${want}`);
  };
  await cycleCard('band');
  let card178v = await card178();
  expect(card178v.scope === 'folder', `the rail's section keeps to its folder (${JSON.stringify(card178v)})`);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.state === 'ready'`, 'the day as a tab from the set-up section');
  let tabView = await view178('.activity-view[data-place="tab"]');
  expect(tabView.scope === 'folder' && tabView.folder === home && tabView.layers === 'band' && tabView.pill === 'folder' && tabView.names === 0, `the tab opens with the section's scope, folder and layers and a scope pill, the band alone (${JSON.stringify(tabView)})`);
  expect(await s.evalJs(`!!document.querySelector('.tab-file[data-tab=${JSON.stringify(tabPath)}][data-active]')`), 'the tab is listed under its bare key');
  let q = await tabQuery178();
  expect(q !== null && q.includes('scope=folder') && q.includes('layers=band') && q.includes('folder='), `the state rides the tab's query (${JSON.stringify(q)})`);
  await cycleCard('lanes');
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-scope').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.scope === 'all'`, 'the rail on all');
  tabView = await view178('.activity-view[data-place="tab"]');
  expect(tabView.scope === 'folder' && tabView.layers === 'band', `the rail's later change reaches the tab not at all (${JSON.stringify(tabView)})`);
  // The pill cycles folder, panes, all since M9 fix 250.
  await s.evalJs(`document.querySelector('.activity-view[data-place="tab"] .activity-scope').click()`);
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.scope === 'panes'`, "the tab's own pill to panes");
  await s.evalJs(`document.querySelector('.activity-view[data-place="tab"] .activity-scope').click()`);
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.scope === 'all'`, "the tab's own pill to all");
  await s.evalJs(`document.querySelector('.activity-view[data-place="tab"] .activity-layers').click()`);
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.layers === 'lanes'`, "the tab's own layers to lanes");
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-scope').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.scope === 'folder'`, 'the rail back on its folder');
  await cycleCard('both');
  tabView = await view178('.activity-view[data-place="tab"]');
  card178v = await card178();
  expect(tabView.scope === 'all' && tabView.layers === 'lanes' && tabView.folder === home && tabView.names >= 3 && card178v.scope === 'folder' && card178v.layers === 'both', `the tab's changes are its own and the rail's its own (${JSON.stringify({ tabView, card: card178v })})`);
  q = await tabQuery178();
  expect(q !== null && !q.includes('scope=') && q.includes('layers=lanes') && q.includes('folder='), `the query follows the tab's state, the folder kept for the toggle (${JSON.stringify(q)})`);
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.state === 'ready'`, 'the tab back after a reload');
  tabView = await view178('.activity-view[data-place="tab"]');
  expect(tabView.scope === 'all' && tabView.layers === 'lanes' && tabView.folder === home && tabView.pill === 'all', `the tab's state survives the reload with the tab list (${JSON.stringify(tabView)})`);
  await s.evalJs(`[...document.querySelectorAll('.activity-view[data-place="tab"] .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view[data-place="tab"]')`, 'the tab closed');
  // The reload lost the folder the rail kept under the focused activity
  // pane (fix 140 keeps it across focus moves, not restarts), so the
  // shell pane is focused to put the rail on home before the pane opens.
  const shellBox178 = await s.evalJs(`(() => { const r = document.querySelector('.term-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(Math.round(shellBox178.x), Math.round(shellBox178.y));
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(home)} && !!document.querySelector('.activity-card[data-place="rail"] .activity-open-pane') && !!document.querySelector('.activity-card[data-place="rail"] .activity-scope')`, 'the rail on home with its pane button and scope toggle');
  await cycleCard('lanes');
  const panesBefore178 = leaves(await getLayout(s)).map((p) => p.id);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-open-pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="activity"]').length === 2`, 'a second activity pane from the set-up section');
  const pane178 = leaves(await getLayout(s)).find((p) => !panesBefore178.includes(p.id));
  expect(pane178 !== undefined && pane178.view.kind === 'activity' && pane178.view.scope === 'folder' && pane178.view.folder === home && pane178.view.layers === 'lanes', `the pane's record carries the section's state (${JSON.stringify(pane178?.view)})`);
  const paneSel178 = `[data-pane-id=${JSON.stringify(pane178.id)}] .activity-view`;
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel178)})?.dataset.state === 'ready'`, 'the new pane ready');
  let paneView178 = await view178(paneSel178);
  expect(paneView178.scope === 'folder' && paneView178.folder === home && paneView178.layers === 'lanes' && paneView178.pill === 'folder', `the pane draws the section's state with a scope pill (${JSON.stringify(paneView178)})`);
  await cycleCard('band');
  paneView178 = await view178(paneSel178);
  expect(paneView178.layers === 'lanes', `the rail's change leaves the pane alone (${JSON.stringify(paneView178)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(paneSel178)} + ' .activity-layers').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel178)})?.dataset.layers === 'both'`, "the pane's own layers to both");
  const paneRecord178 = leaves(await getLayout(s)).find((p) => p.id === pane178.id);
  expect(paneRecord178.view.layers === undefined && paneRecord178.view.scope === 'folder' && (await card178()).layers === 'band', `the record drops the default and the rail keeps its own (${JSON.stringify(paneRecord178.view)})`);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(pane178.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="activity"]').length === 1`, 'the second pane closed again');
  await cycleCard('both');
  step("M9 fix 178: the tab and the pane open as a snapshot of the rail's section and keep their own scope, folder and layers, the tab's in its query across a reload");

  // M9 fix 766: the usage windows row under the activity view's controls,
  // on by default, read off the strip's reading (the endpoint stubbed for
  // the run, two windows). The tab's row matches the strip's windows,
  // opens the card on hover, hides on its toggle and keeps that in the
  // tab's query across a reload, and stays on the five-hour unit beside
  // the axis bar; the pane's keeps it on its record. Neither asks the
  // endpoint: main.log's non-timer read lines are counted before and
  // after.
  await s.waitFor(`document.querySelector('.usage-strip')?.dataset.state === 'ok'`, 'fix 766: the strip has its reading', 10000);
  const mainLog766 = path.join(process.env['EMERALD_HOME'], 'logs', 'main.log');
  // The block's two reloads remount the strip, whose own mount ask is the
  // strip's and not the row's, so mount lines are left out with the timer's.
  const asks766 = () => fs.readFileSync(mainLog766, 'utf8').split(/\r?\n/).filter((l) => l.includes('usage read:') && !l.endsWith('asked on timer') && !l.endsWith('asked on mount')).length;
  const asksBefore766 = await asks766();
  const tabSel766 = '.activity-view[data-place="tab"]';
  const row766 = (viewSel) =>
    s.evalJs(`(() => {
      const v = document.querySelector(${JSON.stringify(viewSel)});
      if (!v) return null;
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
      const row = v.querySelector('.activity-view-usage');
      const wins = row ? [...row.querySelectorAll('.activity-usage-window')] : [];
      return {
        usage: v.dataset.usage ?? null,
        lit: !!v.querySelector('.activity-usage-toggle[data-active]'),
        row: !!row,
        windows: wins.length,
        labels: wins.map((w) => w.querySelector('.usage-label')?.textContent ?? null),
        keys: wins.map((w) => w.dataset.key ?? null),
        stripBars: wins.filter((w) => !!w.querySelector('.usage-bar[data-form="strip"]')).length,
        header: box(v.querySelector('.file-header')),
        rowBox: box(row),
        history: box(v.querySelector('.activity-view-history')),
      };
    })()`);
  const strip766 = () => s.evalJs(`[...document.querySelectorAll('.usage-strip .usage-window')].map((w) => w.querySelector('.usage-label')?.textContent ?? null)`);
  // (a) The tab.
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-expand').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(tabSel766)})?.dataset.state === 'ready'`, 'fix 766: the day as a tab');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(tabSel766 + ' .activity-view-usage')})`, "fix 766: the tab's usage row drawn", 5000);
  const stripLabels766 = await strip766();
  let tabRow766 = await row766(tabSel766);
  expect(tabRow766.usage === 'shown' && tabRow766.lit, `fix 766: the tab opens with the row shown and its toggle lit (${JSON.stringify(tabRow766)})`);
  expect(tabRow766.windows === stripLabels766.length && tabRow766.windows > 0 && JSON.stringify(tabRow766.labels) === JSON.stringify(stripLabels766), `fix 766: the row carries the strip's windows in order (${JSON.stringify({ row: tabRow766.labels, strip: stripLabels766 })})`);
  expect(tabRow766.stripBars === tabRow766.windows, `fix 766: each window of the row has a strip bar (${JSON.stringify(tabRow766)})`);
  expect(tabRow766.rowBox.top >= tabRow766.header.bottom - 0.5 && (tabRow766.history === null || tabRow766.history.top >= tabRow766.rowBox.bottom - 0.5), `fix 766: the row sits under the controls and above the history line (${JSON.stringify(tabRow766)})`);
  const hover766 = await s.evalJs(`(() => { const w = document.querySelector(${JSON.stringify(tabSel766 + ' .activity-usage-window .usage-label')}); const r = w.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, key: w.closest('.activity-usage-window').dataset.key }; })()`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hover766.x, y: hover766.y });
  await s.waitFor(`document.querySelector('.usage-popover')?.dataset.key === ${JSON.stringify(hover766.key)}`, `fix 766: the row's ${hover766.key} window opens its card on hover`, 8000);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 40 });
  await s.waitFor(`!document.querySelector('.usage-popover')`, "fix 766: the row's card closes once the mouse leaves", 8000);
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel766 + ' .activity-usage-toggle')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(tabSel766)})?.dataset.usage === 'hidden'`, "fix 766: the tab's row hidden");
  tabRow766 = await row766(tabSel766);
  expect(!tabRow766.row && !tabRow766.lit, `fix 766: no row and the toggle unlit (${JSON.stringify(tabRow766)})`);
  const tabPath766 = await s.evalJs(`document.querySelector(${JSON.stringify(tabSel766)}).dataset.path`);
  const tabQuery766 = () => s.evalJs(`JSON.parse(localStorage.getItem('emerald.tabs') ?? '{}').query?.[${JSON.stringify(tabPath766)}] ?? null`);
  let q766 = await tabQuery766();
  expect(q766 !== null && q766.includes('usage=off'), `fix 766: the hide rides the tab's query (${JSON.stringify(q766)})`);
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector(${JSON.stringify(tabSel766)})?.dataset.state === 'ready'`, 'fix 766: the tab back after a reload');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(tabSel766)}).dataset.usage`)) === 'hidden', 'fix 766: the row is still hidden after the reload');
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel766 + ' .activity-usage-toggle')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(tabSel766)})?.dataset.usage === 'shown'`, "fix 766: the tab's row shown again");
  q766 = await tabQuery766();
  expect(q766 === null || !q766.includes('usage='), `fix 766: the query carries no usage once shown (${JSON.stringify(q766)})`);
  await s.waitFor(`document.querySelector('.usage-strip')?.dataset.state === 'ok'`, 'fix 766: the strip has its reading after the reload', 10000);
  // M9 fix 793: the strip's card and the row's carry different ids, so a
  // press on the row's reading closes the strip's pinned card of the same
  // window instead of counting as its own anchor, and one card shows.
  const key793 = (await row766(tabSel766)).keys[0];
  const stripAnchor793 = `.usage-strip .usage-window[data-key=${JSON.stringify(key793)}]`;
  const rowAnchor793 = `${tabSel766} .activity-usage-window[data-key=${JSON.stringify(key793)}]`;
  // The strip's anchor is display: contents in its stacked form (fix 29), so its label is the box to press.
  const centre793 = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel + ' .usage-label')}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const stripAt793 = await centre793(stripAnchor793);
  await s.click(stripAt793.x, stripAt793.y);
  try {
    await s.waitFor(`document.querySelector(${JSON.stringify(stripAnchor793)}).dataset.popoverOpen === 'pinned'`, "fix 793: a click pins the strip's card", 5000);
  } catch (err) {
    const seen = await s.evalJs(`(() => { const a = document.querySelector(${JSON.stringify(stripAnchor793)}); const r = a.getBoundingClientRect(); const hit = document.elementFromPoint(${stripAt793.x}, ${stripAt793.y}); return { open: a.dataset.popoverOpen ?? null, rect: [r.x, r.y, r.width, r.height], hit: hit?.className ?? null, hitAnchor: hit?.closest('[data-popover-for]')?.dataset.popoverFor ?? null, cards: document.querySelectorAll('.usage-popover').length, strips: document.querySelectorAll('.usage-strip').length, hiddenBy: (() => { let e = a; while (e && getComputedStyle(e).display !== 'none') e = e.parentElement; return e ? e.className : null; })(), sidebar: document.querySelector('.sidebar')?.getBoundingClientRect().width ?? null, at: [${stripAt793.x}, ${stripAt793.y}] }; })()`);
    throw new Error(`${err.message}: ${JSON.stringify(seen)}`);
  }
  let rowAt793 = await centre793(rowAnchor793);
  const covered793 = () => s.evalJs(`document.elementFromPoint(${rowAt793.x}, ${rowAt793.y})?.closest('.activity-usage-window') === null`);
  if (await covered793()) {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 40 });
    await sleep(300);
    rowAt793 = await centre793(rowAnchor793);
  }
  expect(!(await covered793()), "fix 793: the strip's card does not cover the row's reading");
  await s.click(rowAt793.x, rowAt793.y);
  await s.waitFor(`document.querySelector(${JSON.stringify(stripAnchor793)}).dataset.popoverOpen !== 'pinned'`, "fix 793: a press on the row's reading unpins the strip's card", 3000);
  expect((await s.evalJs(`document.querySelectorAll('.usage-popover').length`)) <= 1, 'fix 793: one usage card at a time');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.usage-popover')`, 'fix 793: the usage card closed');
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 40 });
  step("M9 fix 793: a press on the activity view's reading closes the strip's pinned card of the same window, one card at a time");
  await s.evalJs(`document.querySelector(${JSON.stringify(tabSel766 + ' .activity-unit[data-unit="five-hour"]')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(tabSel766)})?.dataset.unit === 'five-hour' && document.querySelector(${JSON.stringify(tabSel766)})?.dataset.state === 'ready'`, 'fix 766: the tab on the five-hour unit');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(tabSel766 + ' .activity-view-usage')})`, 'fix 766: the row drawn on the five-hour unit', 5000);
  const fiveRow766 = await row766(tabSel766);
  const stripCount766 = (await strip766()).length;
  expect(fiveRow766.usage === 'shown' && fiveRow766.windows === stripCount766, `fix 766: the five-hour unit shows the row with every window (${JSON.stringify({ row: fiveRow766, strip: stripCount766 })})`);
  expect(await s.evalJs(`!!document.querySelector(${JSON.stringify(tabSel766 + ' .activity-view-strip .usage-bar[data-form="axis"]')})`), 'fix 766: the axis bar is drawn beside the row on the five-hour unit');
  await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(tabSel766 + ' .file-header .files-button')})].pop().click()`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(tabSel766)})`, 'fix 766: the tab closed');
  step("M9 fix 766: the tab's usage row under the controls with the strip's windows, its card on hover, hidden and kept in the query across a reload, shown on the five-hour unit");

  // (b) The pane. The reload left the rail where fix 178's own reload
  // did, so the shell is focused to put it back on home first.
  const shellBox766 = await s.evalJs(`(() => { const r = document.querySelector('.term-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(Math.round(shellBox766.x), Math.round(shellBox766.y));
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`!!document.querySelector('.activity-card[data-place="rail"] .activity-open-pane')`, 'fix 766: the rail with its pane button');
  const panesBefore766 = leaves(await getLayout(s)).map((p) => p.id);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-open-pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="activity"]').length === 2`, 'fix 766: a second activity pane');
  const pane766 = leaves(await getLayout(s)).find((p) => !panesBefore766.includes(p.id));
  expect(pane766 !== undefined && pane766.view.kind === 'activity' && !('usage' in pane766.view), `fix 766: the new pane's record carries no usage field (${JSON.stringify(pane766?.view)})`);
  const paneSel766 = `[data-pane-id=${JSON.stringify(pane766.id)}] .activity-view`;
  const record766 = async () => leaves(await getLayout(s)).find((p) => p.id === pane766.id)?.view ?? null;
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel766)})?.dataset.state === 'ready'`, 'fix 766: the new pane ready');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(paneSel766 + ' .activity-view-usage')})`, "fix 766: the pane's usage row drawn", 5000);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(paneSel766)}).dataset.usage`)) === 'shown', "fix 766: the pane's row shown");
  await s.evalJs(`document.querySelector(${JSON.stringify(paneSel766 + ' .activity-usage-toggle')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel766)})?.dataset.usage === 'hidden'`, "fix 766: the pane's row hidden");
  let rec766 = await record766();
  expect(rec766?.usage === false, `fix 766: the pane's record keeps usage false (${JSON.stringify(rec766)})`);
  await s.send('Page.reload');
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel766)})?.dataset.state === 'ready'`, 'fix 766: the pane back after a reload');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(paneSel766)}).dataset.usage`)) === 'hidden', "fix 766: the pane's row still hidden after the reload");
  rec766 = await record766();
  expect(rec766?.usage === false, `fix 766: the record still false after the reload (${JSON.stringify(rec766)})`);
  await s.evalJs(`document.querySelector(${JSON.stringify(paneSel766 + ' .activity-usage-toggle')}).click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(paneSel766)})?.dataset.usage === 'shown'`, "fix 766: the pane's row shown again");
  rec766 = await record766();
  expect(rec766 !== null && !('usage' in rec766), `fix 766: the record drops the field once shown (${JSON.stringify(rec766)})`);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(pane766.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="activity"]').length === 1`, 'fix 766: the second pane closed again');
  // (c) No ask from either.
  const asksAfter766 = await asks766();
  expect(asksAfter766 === asksBefore766, `the activity view's usage row asked the endpoint (${asksBefore766} non-timer read lines before, ${asksAfter766} after)`);
  step("M9 fix 766: the pane's usage row hidden and kept on its record across a reload, and no ask from either");

  // M9 fix 215: the folder scope keeps a removed session's row. beta was
  // started in home, grouped under the repo by its SessionStart's cwd,
  // and removed at the M57 step; the rail's section is on home under
  // `folder`, where it used to drop beta for want of a folder to read
  // off the store, and the daemon puts the record's own folders on the
  // row now. A shell in the temp folder then puts the rail on a folder
  // none of the fakes were in, and the row goes with the rest.
  const railCard215 = () => s.evalJs(`(() => { const c = document.querySelector('.activity-card[data-place="rail"]'); return { root: document.querySelector('.files-rail')?.dataset.root ?? null, scope: c?.dataset.scope ?? null, beta: !!c?.querySelector('.activity-span[data-session-id=${JSON.stringify(b)}]'), alpha: !!c?.querySelector('.activity-span[data-session-id=${JSON.stringify(a)}]'), sessions: c?.dataset.sessions ?? null, text: c?.querySelector('.activity-text')?.textContent ?? null, ticks: [...(c?.querySelectorAll('.activity-tick-label') ?? [])].map((t) => t.textContent).join(' ') }; })()`);
  let rail215 = await railCard215();
  expect(rail215.root === home && rail215.scope === 'folder' && rail215.beta && rail215.alpha, `the rail's section on home under folder keeps beta's row beside alpha's (${JSON.stringify(rail215)})`);
  expect(!(await s.evalJs(`!!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(b)}]')`)), 'while beta is still gone from the sidebar');
  const folderTicks = rail215.ticks;
  const beta215 = JSON.parse(await cli('activity', '--json')).sessions.find((x) => x.sessionId === b);
  expect(beta215 !== undefined && typeof beta215.removedAt === 'number' && typeof beta215.cwd === 'string' && typeof beta215.groupCwd === 'string' && beta215.groupCwd.toLowerCase() === repoRoot.toLowerCase(), `emmer activity --json carries the removed session's folders (${JSON.stringify(beta215 && { cwd: beta215.cwd, groupCwd: beta215.groupCwd, removedAt: beta215.removedAt })})`);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-scope').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.scope === 'all'`, 'the rail on all for the axis');
  rail215 = await railCard215();
  expect(rail215.ticks === folderTicks, `the day's axis is the same under folder and all, since the removed session's spans count (${JSON.stringify([folderTicks, rail215.ticks])})`);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-scope').click()`);
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.scope === 'folder'`, 'the rail back on folder');
  // A shell in the temp folder shown in the split's pane and focused:
  // the rail follows to a folder none of the fakes were in.
  // ProgramData: outside home, where every fake's folders are (their
  // hooks' cwd moves a session's cwd, and fix 218's scratch repo sits
  // under the temp folder under home), and a long path, where
  // os.tmpdir() is an 8.3 one the daemon resolves. The rail is read
  // against the folder as the daemon lists it.
  const { session: repoShell215 } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: process.env['ProgramData'] ?? 'C:\\ProgramData', name: 'away-shell', cols: 100, rows: 30 });
  const away215 = repoShell215.groupCwd;
  const layout215 = await getLayout(s);
  const place215 = (n, id) => (n.kind === 'pane' ? (n.id === splitShell.id ? { ...n, sessionId: id } : n) : { ...n, first: place215(n.first, id), second: place215(n.second, id) });
  await zreq(s, 'layout.set', { layout: { ...layout215, root: place215(layout215.root, repoShell215.id), focusedPaneId: splitShell.id } });
  await s.waitFor(`(document.querySelector('.files-rail')?.dataset.root ?? '').toLowerCase() === ${JSON.stringify(away215.toLowerCase())}`, `the rail on ${away215}`, 10000);
  // The shell's own lifetime row is the one session under that folder.
  await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.sessions === '1'`, 'the away shell alone under its folder', 10000);
  rail215 = await railCard215();
  expect(rail215.scope === 'folder' && !rail215.beta && !rail215.alpha && rail215.text.endsWith('nothing yet'), `under a folder beta was never in, its row is gone with the rest (${JSON.stringify(rail215)})`);
  await zreq(s, 'layout.set', { layout: { ...(await getLayout(s)), root: place215(layout215.root, splitShell.sessionId), focusedPaneId: splitShell.id } });
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(home)}`, 'the rail back on home', 10000);
  await zreq(s, 'session.kill', { sessionId: repoShell215.id, remove: true });
  await s.waitFor(`!document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(repoShell215.id)}]')`, 'the away shell gone again', 10000);
  step("M9 fix 215: the rail's folder scope keeps the removed session's row on its record's folders, and drops it under a folder it was never in");

  // M9 fix 233: a Claude emerald did not start posts its hooks under its
  // own conversation id with the unhosted header (what claude-hook.cmd
  // sends off daemon.json), and no record names it. The daemon runs the
  // state machine on a bare record of its own, so the track has spans;
  // the row is under the folder the hooks named (home, where the rail
  // is), marked outside on the span, the name and the tooltip, named
  // for what it is since no transcript under the harness's Claude home
  // carries its title; emmer activity carries the flag and the folder.
  const conv233 = 'conv-233-plain-terminal';
  const postUnhosted = async (payload) => {
    const d = daemon();
    const res = await fetch(`http://127.0.0.1:${d.hookPort}/hook`, {
      method: 'POST',
      headers: { 'X-Emerald-Token': d.hookToken, 'X-Emerald-Session': conv233, 'X-Emerald-Unhosted': '1' },
      body: JSON.stringify({ session_id: conv233, cwd: home, ...payload }),
    });
    expect(res.status === 204, `sink answered 204 for the unhosted ${payload.hook_event_name}`);
  };
  await postUnhosted({ hook_event_name: 'SessionStart', source: 'startup' });
  await postUnhosted({ hook_event_name: 'UserPromptSubmit', prompt: 'from a plain terminal' });
  await sleep(1500);
  // A live one first: the bare record says working, so the span runs to
  // the daemon's now; then the Stop closes it. The card fetches on its
  // own 30 s clock (no store change moves it), so the reads go through
  // the CLI and a reload.
  const live233 = JSON.parse(await cli('activity', '--json')).sessions.find((x) => x.sessionId === conv233);
  expect(live233 !== undefined && live233.outside === true && live233.name === null && live233.claudeSessionId === conv233, `emmer activity --json lists the unhosted conversation as outside and unnamed (${JSON.stringify(live233 && { outside: live233.outside, name: live233.name, claudeSessionId: live233.claudeSessionId })})`);
  expect(live233.spans.length === 1 && live233.spans[0].to - live233.spans[0].from >= 1000 && live233.spans[0].prompt === 'from a plain terminal', `its open span runs to now while the bare record works, with its prompt (${JSON.stringify(live233.spans)})`);
  expect(typeof live233.cwd === 'string' && live233.cwd.toLowerCase() === home.toLowerCase() && typeof live233.groupCwd === 'string' && live233.groupCwd.toLowerCase() === home.toLowerCase(), `the row carries the folder the hooks named (${JSON.stringify([live233.cwd, live233.groupCwd])})`);
  await postUnhosted({ hook_event_name: 'Stop', stop_hook_active: false });
  await sleep(300);
  const done233 = JSON.parse(await cli('activity', '--json')).sessions.find((x) => x.sessionId === conv233);
  const doneLen = done233.spans[0].to - done233.spans[0].from;
  expect(done233.spans.length === 1 && doneLen >= 1500 && doneLen < 10000, `the Stop closed the span at its time (${doneLen} ms)`);
  const text233 = (await cli('activity')).trimEnd().split('\n').find((l) => l.includes(conv233.slice(0, 8)));
  expect(text233 !== undefined && text233.includes('outside emerald'), `emmer activity names the track outside emerald, got ${JSON.stringify(text233)}`);
  // The reload's first fetch has the closed span; the rail is on home
  // under folder, which keeps the row by its folder.
  await s.send('Page.reload');
  await s.waitFor(`!!document.querySelector('.activity-card[data-place="rail"] .activity-strip')`, 'the rail section after the reload', 15000);
  await s.waitFor(`!!document.querySelector('.activity-card[data-place="rail"] .activity-span[data-session-id=${JSON.stringify(conv233)}]')`, 'the unhosted conversation has a span on the rail section', 15000);
  const span233 = await s.evalJs(`(() => { const el = document.querySelector('.activity-card[data-place="rail"] .activity-span[data-session-id=${JSON.stringify(conv233)}]'); return { outside: 'outside' in el.dataset, title: el.title, scope: document.querySelector('.activity-card[data-place="rail"]')?.dataset.scope ?? null }; })()`);
  expect(span233.outside && span233.title.includes('outside emerald') && span233.title.includes('from a plain terminal') && span233.scope === 'folder', `the span is marked outside, its tooltip says so under the prompt, under the folder scope (${JSON.stringify(span233)})`);
  // The M69 pane's view is on the page too (yesterday's day), so the
  // reads name the tab's.
  await s.evalJs(`document.querySelector('.activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.state === 'ready'`, 'the activity tab');
  await s.waitFor(`!!document.querySelector('.activity-view[data-place="tab"] .activity-view-name[data-session-id=${JSON.stringify(conv233)}]')`, 'the tab has the row', 10000);
  const name233 = await s.evalJs(`(() => { const el = document.querySelector('.activity-view[data-place="tab"] .activity-view-name[data-session-id=${JSON.stringify(conv233)}]'); return { text: el.textContent, outside: 'outside' in el.dataset, title: el.title }; })()`);
  expect(name233.text === 'outside emerald' && name233.outside && name233.title.endsWith('outside emerald'), `the tab's row is named for what it is and marked, its tooltip ending on the word (${JSON.stringify(name233)})`);
  await s.screenshot('m9-fix233-outside.png');
  await s.evalJs(`[...document.querySelectorAll('.activity-view[data-place="tab"] .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('.activity-view[data-place="tab"]')`, 'the tab closed');
  step('M9 fix 233: a Claude emerald did not start is a track of its own, outside, under the folder its hooks named, on the rail, the tab and emmer activity');

  // M9 fix 245: attention debt while nobody is at the box. The seeded
  // day reads through the CLI and on the tab (paged back ten days), the
  // live ask is docked by a presence posted over the pipe the way the
  // app's lock screen does. Before the relaunch below, whose level 31
  // hello turns the renderer's debt reading off (DEBT_LEVEL is 44); the
  // closed-app edge the relaunch makes is read at the end.
  const awayJson = JSON.parse(await cli('activity', '--day', awayDay, '--json'));
  const night = awayJson.sessions.find((x) => x.sessionId === 'night' && !x.agentId);
  expect(night !== undefined && night.debt.length === 1 && night.debt[0].kind === 'unread' && night.debt[0].from === hm(awayDayAt, 9, 1) && night.debt[0].to === hm(awayDayAt, 9, 5), `the overnight done reads as the four minutes from the return plus the grace to the prompt (${JSON.stringify(night?.debt)})`);
  // The day's figures hold fix 285's `spent` row too: 4 + 38 minutes
  // unread, the away figure the night's alone, the capped figure spent's.
  expect(night.awayMs === (7 * 60 - 1) * MINUTE && awayJson.stats.awayMs === night.awayMs && awayJson.stats.unreadMs === 42 * MINUTE && awayJson.stats.debtMs === 42 * MINUTE && awayJson.stats.debtWallMs === 42 * MINUTE, `the row and the day carry the docked figure, 6h 59m, beside the forty-two minutes (${JSON.stringify({ awayMs: night.awayMs, stats: awayJson.stats })})`);
  // M9 fix 285: the capped band cuts the unread and the day's answer
  // carries the band, closed at the freed edge.
  const spent = awayJson.sessions.find((x) => x.sessionId === 'spent' && !x.agentId);
  expect(spent !== undefined && JSON.stringify(spent.debt) === JSON.stringify([{ from: hm(awayDayAt, 10, 11), to: hm(awayDayAt, 10, 20), kind: 'unread' }, { from: hm(awayDayAt, 11, 1), to: hm(awayDayAt, 11, 30), kind: 'unread' }]) && spent.cappedMs === 40 * MINUTE && spent.awayMs === 0 && awayJson.stats.cappedMs === 40 * MINUTE, `the unread under the band is cut in two with the grace again from the freed edge, and the forty minutes are the docked figure (${JSON.stringify({ debt: spent?.debt, cappedMs: spent?.cappedMs, stats: awayJson.stats.cappedMs })})`);
  expect(JSON.stringify(awayJson.capped) === JSON.stringify([{ from: hm(awayDayAt, 10, 20), to: hm(awayDayAt, 11, 0), window: 'five_hour', resetsAt: hm(awayDayAt, 12, 0) }]), `emmer activity --json carries the band closed at the freed edge (${JSON.stringify(awayJson.capped)})`);
  await s.evalJs(`document.querySelector('.files-rail .activity-card .activity-expand').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(V)})?.dataset.state === 'ready'`, 'the activity tab for the away day', 10000);
  // The rail is on home since the fix 233 step, so the tab opens under
  // the folder scope, which drops a seeded track no record names.
  // The pill cycles all, folder, panes since fix 250, so click round
  // until the tab is on every session.
  for (let turn = 0; turn < 3 && (await s.evalJs(`document.querySelector(${JSON.stringify(V)})?.dataset.scope`)) !== 'all'; turn++) {
    await s.evalJs(`document.querySelector(${JSON.stringify(V + ' .activity-scope')}).click()`);
    await s.waitFor(`document.querySelector(${JSON.stringify(V)})?.dataset.scope !== undefined`, 'the pill stepped');
    await sleep(300);
  }
  await s.waitFor(`document.querySelector(${JSON.stringify(V)})?.dataset.scope === 'all'`, 'the away day tab on every session');
  await tabOnDay(awayDay);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(V + ' .activity-view-debt-part')})`, "the away day's debt part", 10000);
  const awayPart = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(V + ' .activity-view-debt-part')}); return { text: el.textContent, title: el.title, awayMs: Number(el.dataset.awayMs) }; })()`);
  expect(awayPart.text.includes('42m waiting on you') && awayPart.title.includes('6h 59m away not counted') && awayPart.title.endsWith('40m capped not counted') && awayPart.awayMs === (7 * 60 - 1) * MINUTE, `the part reads the forty-two minutes and its tooltip carries the away figure and ends on the capped one (${JSON.stringify(awayPart)})`);
  await s.screenshot('m9-fix245-away.png');
  // M9 fix 285: the capped part after the waiting part, the band behind
  // the lanes on the strip at 10:20 for forty minutes of the day, and
  // the same band under the load band's mirror.
  const cappedRead = await s.evalJs(`(() => {
    const part = document.querySelector(${JSON.stringify(V + ' .activity-view-capped-part')});
    const strip = document.querySelector(${JSON.stringify(V + ' .activity-strip')});
    const band = strip?.querySelector('.activity-capped-span');
    const mirror = document.querySelector(${JSON.stringify(V + ' .activity-debt .activity-capped-span')});
    const along = (el) => { const r = el.getBoundingClientRect(); const b = strip.getBoundingClientRect(); return strip.dataset.orientation === 'vertical' ? { start: (r.top - b.top) / b.height, size: r.height / b.height, across: r.width, box: b.width } : { start: (r.left - b.left) / b.width, size: r.width / b.width, across: r.height, box: b.height }; };
    const span = strip?.querySelector('.activity-span[data-session-id="spent"]');
    return { part: part === null ? null : { text: part.textContent, title: part.title, ms: Number(part.dataset.cappedMs), bands: Number(part.dataset.bands) }, bands: strip === null ? -1 : strip.querySelectorAll('.activity-capped-span').length, band: band ? { window: band.dataset.window, title: band.title, ...along(band), fill: getComputedStyle(band).backgroundColor } : null, span: span ? along(span) : null, mirror: mirror ? { window: mirror.dataset.window, title: mirror.title } : null };
  })()`);
  expect(cappedRead.part !== null && cappedRead.part.text.includes('40m capped') && cappedRead.part.ms === 40 * MINUTE && cappedRead.part.bands === 1 && /^5 hour window spent 10:20 to 11:00, reset 12:00$/.test(cappedRead.part.title), `the capped part reads forty minutes with the window and its reset in the tooltip (${JSON.stringify(cappedRead.part)})`);
  // The band along the axis, read against spent's first span (10:00 to
  // 10:10, the axis being the day's active hours rather than the whole
  // day): it starts two span lengths after the span and runs four of
  // them, across every track (the strip's height less the tick row),
  // and its wash is not transparent.
  const near = (a, b) => Math.abs(a - b) < 0.004;
  expect(cappedRead.bands === 1 && cappedRead.band !== null && cappedRead.span !== null && cappedRead.band.window === 'five_hour' && near(cappedRead.band.start, cappedRead.span.start + 2 * cappedRead.span.size) && near(cappedRead.band.size, 4 * cappedRead.span.size) && cappedRead.band.across >= cappedRead.band.box - 14 && cappedRead.band.title === '5 hour window spent, 10:20 to 11:00, reset 12:00' && !/\/ 0\)$/.test(cappedRead.band.fill) && !/rgba\(\d+, \d+, \d+, 0\)$/.test(cappedRead.band.fill), `one band on the strip at 10:20 for forty minutes across the tracks with the window's words (${JSON.stringify({ band: cappedRead.band, span: cappedRead.span })})`);
  expect(cappedRead.mirror !== null && cappedRead.mirror.window === 'five_hour' && cappedRead.mirror.title === cappedRead.band.title, `the mirror under the load band carries the same band (${JSON.stringify(cappedRead.mirror)})`);
  await s.screenshot('m9-fix285-capped.png');
  step('M9 fix 285: a capped band cuts the waiting like an away stretch, the stats line says how long the account was capped with the window in its tooltip, and the band is drawn behind the lanes and under the mirror');
  await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(V + ' .file-header .files-button')})].pop().click()`);
  await s.waitFor(`!document.querySelector(${JSON.stringify(V)})`, 'the away day tab closed');
  const presenceLines = () => fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'hooks.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"presence"')).map((l) => JSON.parse(l));
  // The live case: a question asked, the box left two seconds in and
  // someone back two seconds later, answered a second after that.
  const owl = await spawn('night-owl');
  await post(owl, { hook_event_name: 'UserPromptSubmit', prompt: 'ask me' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(owl)}]')?.dataset.state === 'working'`, 'the owl working');
  await post(owl, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: {} });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(owl)}]')?.dataset.state === 'needs-input'`, 'the owl asks');
  await sleep(2000);
  await zreq(s, 'presence.away', {});
  await zreq(s, 'presence.away', {});
  await sleep(2000);
  await zreq(s, 'presence.back', {});
  await sleep(1000);
  await post(owl, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: {} });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(owl)}]')?.dataset.state === 'working'`, 'the owl answered');
  const owlRow = JSON.parse(await cli('activity', '--json')).sessions.find((x) => x.sessionId === owl && !x.agentId);
  const owlAsked = owlRow.debt.filter((d) => d.kind === 'asked').map((d) => d.to - d.from);
  expect(owlRow.debt.length === 2 && owlAsked.length === 2 && owlAsked[0] > 1200 && owlAsked[0] < 3500 && owlAsked[1] > 300 && owlAsked[1] < 2500 && owlRow.awayMs > 1200 && owlRow.awayMs < 3500, `the ask is two stretches around the two seconds away, docked by them (${JSON.stringify({ asked: owlAsked, awayMs: owlRow.awayMs })})`);
  const liveEdges = presenceLines().slice(2);
  expect(liveEdges.map((e) => e.presence).join(',') === 'away,back', `the posted edges are two lines, the repeated away not written (${JSON.stringify(liveEdges)})`);
  await post(owl, { hook_event_name: 'Stop' });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(owl)}]')?.dataset.state === 'done'`, 'the owl done');
  step("M9 fix 245: attention debt while nobody is at the box: an overnight done reads as the minutes from the return plus the grace, the day's tooltip names the away time not counted, and a presence posted over the pipe docks a live ask");

  // M9 fix 250: the panes scope. Three shells with a turn each today,
  // two of them put on panes in place of the shell pane and one listed
  // only; the tab's pill cycles all, folder, panes (the tab opened from
  // the rail on home starts at folder), the strip under panes holds the
  // two on panes and not the listed one nor the earlier sessions; hiding
  // one pane takes its row off the strip at once; the tab's query says
  // scope=panes; a second activity pane opened from the rail cycles to
  // panes the same and its record carries it; the pill's tooltips name
  // the next step. Then the panes are put back as they were.
  const layout250 = await getLayout(s);
  const shellPane250 = leaves(layout250).find((p) => p.sessionId !== null);
  expect(shellPane250 !== undefined, 'a shell pane to stand in for');
  const spawn250 = async (name) => {
    const { session } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, name, cols: 100, rows: 30 });
    await post(session.id, { hook_event_name: 'SessionStart', source: 'startup' });
    await post(session.id, { hook_event_name: 'UserPromptSubmit', prompt: `a turn for ${name}` });
    await post(session.id, { hook_event_name: 'Stop', stop_hook_active: false });
    return session.id;
  };
  const p1 = await spawn250('on-pane-1');
  const p2 = await spawn250('on-pane-2');
  const listed250 = await spawn250('listed-only');
  const withPanes250 = (node) => (node.kind === 'pane' ? (node.id === shellPane250.id ? { kind: 'split', id: 'split-250', direction: 'row', ratio: 0.5, first: { kind: 'pane', id: 'pane-250-1', sessionId: p1, view: null }, second: { kind: 'pane', id: 'pane-250-2', sessionId: p2, view: null } } : node) : { ...node, first: withPanes250(node.first), second: withPanes250(node.second) });
  await zreq(s, 'layout.set', { layout: { ...layout250, root: withPanes250(layout250.root), focusedPaneId: 'pane-250-1' } });
  await s.waitFor(`document.querySelectorAll('.pane .term-host').length === 2 && document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(p1)}]')?.dataset.shown === 'focused'`, 'the two shells on panes', 10000);
  const view250 = (sel) => s.evalJs(`(() => { const v = document.querySelector(${JSON.stringify(sel)}); if (!v) return null; const ids = [...new Set([...v.querySelectorAll('.activity-strip .activity-span[data-session-id]')].map((e) => e.dataset.sessionId))].sort(); return { scope: v.dataset.scope ?? null, folder: v.dataset.folder ?? null, sessions: Number(v.dataset.sessions), ids, pill: v.querySelector('.file-header .activity-scope')?.textContent ?? null, title: v.querySelector('.file-header .activity-scope')?.title ?? null, stats: v.querySelector('.activity-view-stats')?.textContent ?? null }; })()`);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-expand').click()`);
  await s.waitFor(`document.querySelector('.activity-view[data-place="tab"]')?.dataset.state === 'ready'`, 'the day as a tab for fix 250');
  const T250 = '.activity-view[data-place="tab"]';
  await s.waitFor(`!!document.querySelector('${T250} .activity-span[data-session-id=${JSON.stringify(listed250)}]')`, "the tab has the listed shell's span", 10000);
  let tab250 = await view250(T250);
  expect(tab250.scope === 'folder' && tab250.pill === 'folder' && tab250.folder !== null && tab250.title === `${path.basename(tab250.folder)} only; click for the sessions on the panes`, `the tab opens at folder with the tooltip naming the panes next (${JSON.stringify(tab250)})`);
  await s.evalJs(`document.querySelector('${T250} .activity-scope').click()`);
  await s.waitFor(`document.querySelector('${T250}')?.dataset.scope === 'panes'`, "the tab's pill to panes");
  tab250 = await view250(T250);
  expect(tab250.pill === 'panes' && JSON.stringify(tab250.ids) === JSON.stringify([p1, p2].sort()) && tab250.sessions === 2, `under panes the strip holds the two shells on panes alone (${JSON.stringify(tab250)})`);
  expect(tab250.title === 'The sessions on the panes only; click for every session of the day', `the pill's tooltip names all as the next step (${JSON.stringify(tab250.title)})`);
  const q250 = await s.evalJs(`Object.values(JSON.parse(localStorage.getItem('emerald.tabs') ?? '{}').query ?? {}).find((q) => q.includes('scope=panes')) ?? null`);
  expect(q250 !== null, `the tab's query carries scope=panes (${JSON.stringify(q250)})`);
  await s.evalJs(`document.querySelector('[data-pane-id="pane-250-2"] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane .term-host').length === 1`, 'the second shell pane hidden');
  await s.waitFor(`document.querySelector('${T250}')?.dataset.sessions === '1'`, 'the strip follows the hide', 5000);
  tab250 = await view250(T250);
  expect(JSON.stringify(tab250.ids) === JSON.stringify([p1]), `the hidden shell's row left the strip (${JSON.stringify(tab250.ids)})`);
  await s.evalJs(`document.querySelector('${T250} .activity-scope').click()`);
  await s.waitFor(`document.querySelector('${T250}')?.dataset.scope === 'all'`, "the tab's pill round to all");
  tab250 = await view250(T250);
  expect(tab250.ids.includes(listed250) && tab250.ids.includes(p2) && tab250.sessions > 2, `all brings the listed shell and the hidden one back (${JSON.stringify(tab250)})`);
  await s.evalJs(`[...document.querySelectorAll('${T250} .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector('${T250}')`, 'the fix 250 tab closed');
  // The pane form: a second activity pane from the rail, its pill to
  // panes, its record carrying the scope.
  const panesBefore250 = leaves(await getLayout(s)).map((p) => p.id);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-open-pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="activity"]').length === 2`, 'a second activity pane for fix 250');
  const pane250 = leaves(await getLayout(s)).find((p) => !panesBefore250.includes(p.id));
  const P250 = `[data-pane-id=${JSON.stringify(pane250.id)}] .activity-view`;
  await s.waitFor(`document.querySelector(${JSON.stringify(P250)})?.dataset.state === 'ready'`, 'the fix 250 pane ready');
  await s.evalJs(`document.querySelector(${JSON.stringify(P250)} + ' .activity-scope').click()`);
  await s.waitFor(`document.querySelector(${JSON.stringify(P250)})?.dataset.scope === 'panes'`, "the pane's pill to panes");
  const paneView250 = await view250(P250);
  const paneRecord250 = leaves(await getLayout(s)).find((p) => p.id === pane250.id);
  expect(paneView250.pill === 'panes' && JSON.stringify(paneView250.ids) === JSON.stringify([p1]) && paneRecord250.view.scope === 'panes', `the pane form reads the same and its record carries panes (${JSON.stringify({ view: paneView250, record: paneRecord250.view })})`);
  await s.screenshot('m9-fix250-panes-scope.png');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(pane250.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="activity"]').length === 1`, 'the fix 250 pane closed');
  // The panes back: the shell pane with its session where it was.
  const now250 = await getLayout(s);
  const restore250 = (node) => (node.kind === 'pane' ? (node.id === 'pane-250-1' ? { ...node, id: shellPane250.id, sessionId: shellPane250.sessionId } : node) : { ...node, first: restore250(node.first), second: restore250(node.second) });
  await zreq(s, 'layout.set', { layout: { ...now250, root: restore250(now250.root), focusedPaneId: shellPane250.id } });
  await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(shellPane250.id)}] .term-host') !== null`, 'the shell pane back as it was', 10000);
  for (const id of [p1, p2, listed250]) await zreq(s, 'session.kill', { sessionId: id, remove: true });
  await s.click(activityBox.x, activityBox.y);
  await s.waitFor(`document.querySelector('.pane[data-view="activity"]')?.classList.contains('focused')`, 'the activity pane focused again', 10000);
  step('M9 fix 250: the tab and the pane cycle all, folder, panes; under panes the strip holds the sessions on the panes alone, follows a hide at once, the query and the record carry the scope, and the tooltips name the next step');

  // M9 fix 261 (fix-activity-strip): the here scope. A second activity
  // pane opened from the rail (on today, as fix 250's was; the script's
  // own pane is on another window by now), two layout tabs holding one
  // shell each, here-1 in place of the shell pane on this tab and here-2
  // alone on a second tab named Elsewhere; the new pane's pill clicked
  // round until it reads here, the strip holding here-1 alone, the
  // pill's word, its tooltip and data-tab-name naming this tab, the
  // record carrying here; then here-2 put on a pane of this tab, the
  // strip following at once. The pane is closed and the panes and the
  // tab go back as they were at the end.
  const h1 = await spawn250('here-1');
  const h2 = await spawn250('here-2');
  const panesBefore261 = leaves(await getLayout(s)).map((p) => p.id);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-open-pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="activity"]').length === 2`, 'a second activity pane for fix 261');
  const tabs261 = await getTabs(s);
  const current261 = tabs261.tabs.find((t) => t.id === tabs261.currentTabId);
  const pane261 = leaves(current261).find((p) => !panesBefore261.includes(p.id));
  const shellPane261 = leaves(current261).find((p) => p.sessionId !== null);
  expect(pane261 !== undefined && shellPane261 !== undefined, 'the new activity pane and a shell pane on the current tab');
  const P261 = `[data-pane-id=${JSON.stringify(pane261.id)}] .activity-view`;
  await s.waitFor(`document.querySelector(${JSON.stringify(P261)})?.dataset.state === 'ready'`, 'the fix 261 pane ready');
  await s.waitFor(`!!document.querySelector(${JSON.stringify(P261 + ' .activity-span[data-session-id=' + JSON.stringify(h2) + ']')})`, "the pane has here-2's span", 10000);
  const withH1 = (node) => (node.kind === 'pane' ? (node.id === shellPane261.id ? { kind: 'pane', id: 'pane-261-1', sessionId: h1, view: null } : node) : { ...node, first: withH1(node.first), second: withH1(node.second) });
  const tab261 = { id: 'tab-261', name: 'Elsewhere', root: { kind: 'pane', id: 'pane-261-2', sessionId: h2, view: null }, focusedPaneId: 'pane-261-2' };
  await zreq(s, 'layout.set', { layout: { ...tabs261, tabs: [...tabs261.tabs.map((t) => (t.id === current261.id ? { ...t, root: withH1(t.root), focusedPaneId: 'pane-261-1' } : t)), tab261] } });
  await s.waitFor(`document.querySelectorAll('.tab-panes').length === 2 && document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(h1)}]')?.dataset.shown === 'focused'`, 'two layout tabs, here-1 on this one', 10000);
  for (let turn = 0; turn < 5 && (await s.evalJs(`document.querySelector(${JSON.stringify(P261)})?.dataset.scope`)) !== 'here'; turn++) {
    await s.evalJs(`document.querySelector(${JSON.stringify(P261 + ' .activity-scope')}).click()`);
    await sleep(300);
  }
  await s.waitFor(`document.querySelector(${JSON.stringify(P261)})?.dataset.scope === 'here'`, "the pane's pill round to here");
  await s.waitFor(`document.querySelector(${JSON.stringify(P261)})?.dataset.sessions === '1'`, 'the strip on this tab alone', 5000);
  let view261 = await view250(P261);
  const tabName261 = await s.evalJs(`document.querySelector(${JSON.stringify(P261)})?.dataset.tabName ?? null`);
  expect(JSON.stringify(view261.ids) === JSON.stringify([h1]) && view261.pill === 'this tab' && tabName261 === current261.name && view261.title === `The sessions on ${current261.name} only; click for every session of the day`, `under here the strip holds here-1 alone, the pill reads this tab and the tooltip names ${current261.name} (${JSON.stringify({ ...view261, tabName: tabName261 })})`);
  expect(leaves(await getLayout(s)).find((p) => p.id === pane261.id)?.view.scope === 'here', 'the record carries here');
  await s.screenshot('m9-fix261-here-scope.png');
  // here-2 onto this tab: the pane holding here-1 split, the second half
  // taking here-2 (still on the other tab too); the strip follows.
  const withH2 = (node) => (node.kind === 'pane' ? (node.id === 'pane-261-1' ? { kind: 'split', id: 'split-261', direction: 'row', ratio: 0.5, first: node, second: { kind: 'pane', id: 'pane-261-3', sessionId: h2, view: null } } : node) : { ...node, first: withH2(node.first), second: withH2(node.second) });
  const now261 = await getTabs(s);
  await zreq(s, 'layout.set', { layout: { ...now261, tabs: now261.tabs.map((t) => (t.id === current261.id ? { ...t, root: withH2(t.root) } : t)) } });
  await s.waitFor(`document.querySelector(${JSON.stringify(P261)})?.dataset.sessions === '2'`, 'the strip follows here-2 onto this tab', 5000);
  view261 = await view250(P261);
  expect(JSON.stringify(view261.ids) === JSON.stringify([h1, h2].sort()), `both shells on the strip once both are on this tab (${JSON.stringify(view261.ids)})`);
  // The pane closed, then the shell pane with its session where it was
  // and the second tab gone.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(pane261.id)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="activity"]').length === 1`, 'the fix 261 pane closed');
  const after261 = await getTabs(s);
  const restore261 = (node) => (node.kind === 'pane' ? node : node.id === 'split-261' ? { kind: 'pane', id: shellPane261.id, sessionId: shellPane261.sessionId, view: null } : { ...node, first: restore261(node.first), second: restore261(node.second) });
  await zreq(s, 'layout.set', { layout: { ...after261, tabs: after261.tabs.filter((t) => t.id !== 'tab-261').map((t) => (t.id === current261.id ? { ...t, root: restore261(t.root), focusedPaneId: shellPane261.id } : t)), currentTabId: current261.id } });
  await s.waitFor(`document.querySelectorAll('.tab-panes').length === 1 && document.querySelector('[data-pane-id=${JSON.stringify(shellPane261.id)}] .term-host') !== null`, 'the shell pane back as it was, one layout tab', 10000);
  for (const id of [h1, h2]) await zreq(s, 'session.kill', { sessionId: id, remove: true });
  await s.click(activityBox.x, activityBox.y);
  await s.waitFor(`document.querySelector('.pane[data-view="activity"]')?.classList.contains('focused')`, 'the activity pane focused again', 10000);
  step("M9 fix 261: the pane's pill cycles on to this tab, the strip holds the sessions on the panes of the pane's own tab alone and follows a session put on it, the word, the tooltip and the record carry it");

  // M9 fix 837: the Statistics tab, before the relaunch below puts the
  // daemon at level 31, where the item is hidden. A shell in the seeded
  // folder gives it a heading (a shell with no hooks is a lifetime row,
  // drawn nowhere); its + menu opens the tab, whose figures are read
  // against the daemon's own totals and the repository's two commits and
  // one tag. The worktree's and the other folder's requests must be left
  // out: three or four requests would mean one was counted.
  {
    const { spanText, tokensText, usdText } = await import('../src/renderer/src/stats-model.ts');
    const { session: statsShell } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: statsRepo, name: 'stats-shell', cols: 100, rows: 30 });
    // M9 fix 885: the rail's Stats tab, before the document tab below so
    // its ask is the first on the folder. The stats shell goes onto the
    // shell pane (the fix 224 shape) for the rail to follow, the tab is
    // read against the daemon's totals, a session working for twenty
    // seconds and a width drag must not ask or compute again, three
    // switches away and back must not either, and a cd to another folder
    // draws that folder's own figures.
    {
      const withSession885 = (node, paneId, sessionId) => (node.kind === 'pane' ? (node.id === paneId ? { ...node, sessionId } : node) : { ...node, first: withSession885(node.first, paneId, sessionId), second: withSession885(node.second, paneId, sessionId) });
      const layout885 = await getLayout(s);
      const shellPane885 = leaves(layout885).find((p) => p.sessionId !== null);
      expect(shellPane885 !== undefined, 'a shell pane to stand in for (fix 885)');
      const originalSession885 = shellPane885.sessionId;
      const put885 = async (sessionId) => {
        const l = await getLayout(s);
        await zreq(s, 'layout.set', { layout: { ...l, root: withSession885(l.root, shellPane885.id, sessionId), focusedPaneId: shellPane885.id } });
      };
      const railView885 = `document.querySelector('.files-rail .stats-view[data-place="rail"]')`;
      const figures885 = (scope) => s.evalJs(`[...document.querySelectorAll('${scope} .stats-figure')].map((f) => [f.querySelector('.stats-figure-label')?.textContent ?? '', f.querySelector('.stats-figure-value')?.textContent ?? '', f.querySelector('.stats-figure-note')?.textContent ?? ''].join('|'))`);
      await put885(statsShell.id);
      await s.waitFor(`(document.querySelector('.files-rail')?.dataset.root ?? '').toLowerCase() === ${JSON.stringify(statsRepo.toLowerCase())}`, 'the rail on the stats folder', 10000);
      await s.evalJs(`document.querySelector('.rail-tab[data-tab="stats"]').click()`);
      await s.waitFor(`${railView885}?.dataset.state === 'ready'`, "the rail's Stats ready", 15000);
      const railTotals885 = await zreq(s, 'activity.totals', { folder: statsRepo });
      const { tokensText: tokensText885, usdText: usdText885 } = await import('../src/renderer/src/stats-model.ts');
      const want885 = ['Commits|2|', 'Releases|1|tags on main', 'Requests|2|', `Tokens in|${tokensText885(railTotals885.total.up)}|`, `Tokens out|${tokensText885(railTotals885.total.down)}|`, `At API prices|${usdText885(railTotals885.total.usd, true)}|`, 'Agent time|30m|'];
      const railFigures885 = await figures885('.files-rail .stats-view');
      expect(JSON.stringify(railFigures885) === JSON.stringify(want885), `the rail's figures (wanted ${JSON.stringify(want885)}, read ${JSON.stringify(railFigures885)})`);
      expect(!(await s.evalJs(`!!document.querySelector('.files-rail .stats-view .file-header')`)), "the rail's Stats has no document header");
      const { session: busy885 } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, name: 'stats-busy', cols: 100, rows: 30 });
      await post(busy885.id, { hook_event_name: 'SessionStart', source: 'startup' });
      for (let turn = 0; turn < 10; turn++) {
        await post(busy885.id, { hook_event_name: 'UserPromptSubmit', prompt: 'busy 885' });
        await sleep(1000);
        await post(busy885.id, { hook_event_name: 'Stop', stop_hook_active: false });
        await sleep(1000);
        if (turn === 4) {
          const edge885 = await s.evalJs(`(() => { const r = document.querySelector('.files-resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 100 }; })()`);
          await s.mouse('mousePressed', edge885.x, edge885.y);
          for (let dx = 5; dx <= 40; dx += 5) await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: edge885.x - dx, y: edge885.y, button: 'left', buttons: 1 });
          for (let dx = 35; dx >= 0; dx -= 5) await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: edge885.x - dx, y: edge885.y, button: 'left', buttons: 1 });
          await s.mouse('mouseReleased', edge885.x, edge885.y);
        }
      }
      const counters885 = () => s.evalJs(`(() => { const v = ${railView885}; return v === null ? null : v.dataset.asks + '|' + v.dataset.sheets; })()`);
      const afterBusy885 = await counters885();
      expect(afterBusy885 === '1|1', `twenty seconds of a session's turns and a width drag asked once and computed once (asks|sheets ${afterBusy885})`);
      for (let i = 0; i < 3; i++) {
        await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
        await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'files'`, 'the rail on Files');
        await s.evalJs(`document.querySelector('.rail-tab[data-tab="stats"]').click()`);
        await s.waitFor(`${railView885}?.dataset.state === 'ready'`, "the rail's Stats ready again", 15000);
      }
      const afterSwitches885 = await counters885();
      expect(afterSwitches885 === '1|1', `three switches away and back asked nothing and computed nothing (asks|sheets ${afterSwitches885})`);
      fs.mkdirSync(`${statsRepo}-other`);
      const { session: otherShell885 } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: `${statsRepo}-other`, name: 'stats-other-shell', cols: 100, rows: 30 });
      await put885(otherShell885.id);
      await s.waitFor(`${railView885}?.dataset.folder?.toLowerCase() === ${JSON.stringify(`${statsRepo}-other`.toLowerCase())} && ${railView885}?.dataset.state === 'ready'`, "the rail's Stats on the other folder", 15000);
      const otherFigures885 = await figures885('.files-rail .stats-view');
      expect(otherFigures885.includes('Commits|none|not a git repository') && otherFigures885.includes('Requests|1|') && otherFigures885.includes('At API prices|$0.10|'), `the rail followed to the other folder's own figures (${JSON.stringify(otherFigures885)})`);
      await put885(originalSession885);
      await s.click(activityBox.x, activityBox.y);
      await s.waitFor(`document.querySelector('.pane[data-view="activity"]')?.classList.contains('focused')`, 'the activity pane focused again (fix 885)', 10000);
      await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
      await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'timeline' && !${railView885}`, 'the rail back on Activity, its Stats view gone');
      for (const id of [busy885.id, otherShell885.id]) await zreq(s, 'session.kill', { sessionId: id, remove: true });
      try {
        fs.rmSync(`${statsRepo}-other`, { recursive: true, force: true });
      } catch {
        console.log(`[verify] note: ${statsRepo}-other left in place`);
      }
      step("M9 fix 885: the rail's Stats tab reads the folder's figures, asks once and computes once across twenty seconds of a session's turns and a width drag and three switches away and back, and follows the rail to another folder");
    }
    const groupSel =`[...document.querySelectorAll('.sidebar-group')].find((g) => (g.dataset.group ?? '').toLowerCase() === ${JSON.stringify(statsRepo.toLowerCase())})`;
    await s.waitFor(`!!(${groupSel})?.querySelector('.sidebar-group-add')`, "the stats folder's heading", 10000);
    const plus837 = await s.evalJs(`(() => { const r = (${groupSel}).querySelector('.sidebar-group-add').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.rightClick(plus837.x, plus837.y);
    await s.waitFor(`(document.querySelector('.group-menu')?.dataset.folder ?? '').toLowerCase() === ${JSON.stringify(statsRepo.toLowerCase())}`, "the stats folder's + menu");
    await s.evalJs(`[...document.querySelectorAll('.group-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Statistics in a tab').click()`);
    await s.waitFor(`document.querySelector('.stats-view')?.dataset.state === 'ready'`, 'the Statistics tab ready', 15000);
    const t = await zreq(s, 'activity.totals', { folder: statsRepo });
    expect(t.total.requests === 2 && t.total.estimated === true && t.total.agentMs === 30 * MINUTE && t.firstAt === hm(dayAgo(7).getTime(), 15, 0), `activity.totals counts stats-a's two requests alone, estimated, its half hour and its first line (${JSON.stringify({ requests: t.total.requests, estimated: t.total.estimated, agentMs: t.total.agentMs, firstAt: t.firstAt })})`);
    const view837 = await s.evalJs(`(() => { const v = document.querySelector('.stats-view'); return { now: Number(v.dataset.now), figures: [...v.querySelectorAll('.stats-figure')].map((f) => [f.querySelector('.stats-figure-label')?.textContent ?? '', f.querySelector('.stats-figure-value')?.textContent ?? '', f.querySelector('.stats-figure-note')?.textContent ?? ''].join('|')), span: v.querySelector('.stats-span')?.textContent ?? null, history: v.querySelector('.stats-history')?.textContent ?? null, yieldLine: v.querySelector('.stats-yield')?.textContent ?? null, asOf: v.querySelector('.stats-asof')?.textContent ?? null, tab: [...document.querySelectorAll('.tab.tab-file')].find((e) => e.dataset.key.startsWith('emerald://stats/'))?.querySelector('.tab-name')?.textContent ?? null, key: [...document.querySelectorAll('.tab.tab-file')].find((e) => e.dataset.key.startsWith('emerald://stats/'))?.dataset.key ?? null }; })()`);
    const want837 = ['Commits|2|', 'Releases|1|tags on main', 'Requests|2|', `Tokens in|${tokensText(t.total.up)}|`, `Tokens out|${tokensText(t.total.down)}|`, `At API prices|${usdText(t.total.usd, true)}|`, 'Agent time|30m|'];
    expect(JSON.stringify(view837.figures) === JSON.stringify(want837), `the tab's figures (wanted ${JSON.stringify(want837)}, read ${JSON.stringify(view837.figures)})`);
    const spanWant = spanText(statsFirstCommitAt, t.firstAt, view837.now);
    expect(view837.span === spanWant && spanWant.startsWith('21 days, '), `the span runs from the first commit, 21 days (wanted ${spanWant}, read ${view837.span})`);
    expect(view837.history !== null && view837.history.startsWith(historyWant()) && view837.history.endsWith('; the requests, tokens, price and agent time before it are not in the log'), `the history line names the log's start and says what it leaves out (${view837.history})`);
    // M9 fix 885: the first commit is 20 days back and the log's first line
    // 13, so one commit and one release (the tag made now) fall from the
    // log's first day on, and the yield counts those against the spend.
    const { historyDay: historyDay885, yieldText: yieldText885 } = await import('../src/renderer/src/stats-model.ts');
    const yieldWant885 = yieldText885(t.total.usd, true, 1, 1, historyDay885(t.historyFrom), view837.now);
    expect(view837.yieldLine === yieldWant885 && yieldWant885.includes("the log's first day"), `the yield is counted from the log's first day (wanted ${yieldWant885}, read ${view837.yieldLine})`);
    expect(/^as of \d\d:\d\d$/.test(view837.asOf ?? ''), `the as-of time sits beside the span (${view837.asOf})`);
    expect(view837.tab === `Statistics · ${path.basename(statsRepo)}`, `the strip's tab is named for the folder (${view837.tab})`);
    await s.screenshot('m9-fix837-stats-tab.png');
    step('M9 fix 837: Statistics in a tab from the + menu reads the folder\'s commits, its tag as the release, its two requests with the estimate, the tokens, the price and the agent time, the worktree and the other folder left out, the span from the first commit, and the yield counted from the log\'s first day (fix 885)');

    // M9 fix 838: a Max 20x plan entered in the tab, read against the
    // pure sums, kept across a reload (emerald.plan) and removed again.
    const { paidOver, paidText } = await import('../src/renderer/src/plan-model.ts');
    const noPlan = 'No plan entered. Add the plan below to set what was paid against the API price.';
    expect((await s.evalJs(`document.querySelector('.stats-paid')?.textContent ?? null`)) === noPlan, 'the subscription line says no plan');
    await s.evalJs(`(() => { const sel = document.querySelector('select.stats-plan-kind'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'Max 20x'); sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await s.waitFor(`document.querySelector('input.stats-plan-price')?.value === '200'`, 'the Max 20x price filled');
    const planDay = dayKeyOf(dayAgo(20));
    await setInput(s, 'input.stats-plan-from', planDay);
    await s.waitFor(`document.querySelector('input.stats-plan-from')?.value === ${JSON.stringify(planDay)} && !document.querySelector('button.stats-plan-add').disabled`, 'the day set and Add enabled');
    await s.evalJs(`document.querySelector('button.stats-plan-add').click()`);
    const entryWant = `Max 20x · $200.00 a month from ${planDay}`;
    await s.waitFor(`document.querySelectorAll('.stats-plan-entry').length === 1 && document.querySelector('.stats-plan-entry-text')?.textContent === ${JSON.stringify(entryWant)} && !!document.querySelector('.stats-paid')?.dataset.paid`, 'the plan entry listed and the line priced');
    const paid838 = await s.evalJs(`(() => { const v = document.querySelector('.stats-view'); const p = v.querySelector('.stats-paid'); return { paid: Number(p.dataset.paid), text: p.textContent, from: Number(v.querySelector('.stats-span').dataset.from), now: Number(v.dataset.now) }; })()`);
    const plan838 = [{ plan: 'Max 20x', monthlyUsd: 200, from: planDay }];
    const paidWant = paidOver(plan838, paid838.from, paid838.now);
    const textWant = paidText(t.total.usd, t.total.estimated, paid838.paid, Number(spanWant.split(' ')[0]));
    expect(Math.abs(paid838.paid - paidWant) < 0.005 && paid838.text === textWant, `the line pays the plan over the span (wanted ${paidWant} and ${JSON.stringify(textWant)}, read ${JSON.stringify(paid838)})`);
    await s.send('Page.reload');
    await s.waitFor(`document.querySelector('.stats-view')?.dataset.state === 'ready' && document.querySelectorAll('.stats-plan-entry').length === 1`, 'the tab back after a reload with the plan kept', 20000);
    await s.evalJs(`document.querySelector('.stats-plan-remove').click()`);
    await s.waitFor(`document.querySelectorAll('.stats-plan-entry').length === 0 && document.querySelector('.stats-paid')?.textContent === ${JSON.stringify(noPlan)}`, 'the entry removed and the line back to no plan');
    step('M9 fix 838: a Max 20x plan entered in the tab sets what it paid over the span against the API price, kept across a reload and removed again');

    await s.evalJs(`document.querySelector('.tab.tab-file[data-key=' +${JSON.stringify(JSON.stringify(view837.key))} + '] .tab-close').click()`);
    await s.waitFor(`!document.querySelector('.stats-view')`, 'the Statistics tab closed');
    await zreq(s, 'session.kill', { sessionId: statsShell.id, remove: true });
    // The killed shell can hold the folder as its cwd for a moment (EPERM
    // on the first run); a temp folder left behind costs nothing.
    try {
      fs.rmSync(statsRepo, { recursive: true, force: true });
    } catch {
      console.log(`[verify] note: ${statsRepo} left in place`);
    }
  }

  // M9 fix 128: folded once more, for the relaunch below to read the
  // choice kept.
  await s.evalJs(`document.querySelector('.pane[data-view="activity"] .activity-controls-fold').click()`);
  await s.waitFor(`document.querySelector('.pane[data-view="activity"] .activity-view')?.dataset.controls === 'folded'`, 'folded before the relaunch');

  // M9 fix 257: a span on yesterday for the tick step at the end, on a
  // track of its own appended to the log (the reader keeps order per
  // track, so its place in the file is free); the relaunched daemon reads
  // the file whole. Yesterday stays empty until then, as the ◀ step wants.
  fs.appendFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'hooks.jsonl'), [JSON.stringify({ at: hm(yesterday.getTime(), 10, 0), sessionId: 'yday', event: 'UserPromptSubmit', from: 'idle', to: 'working', outcome: 'applied', payload: { session_id: 'sim-yday', hook_event_name: 'UserPromptSubmit', cwd: home } }), JSON.stringify({ at: hm(yesterday.getTime(), 11, 0), sessionId: 'yday', event: 'Stop', from: 'working', to: 'done', outcome: 'applied', payload: { session_id: 'sim-yday', hook_event_name: 'Stop', cwd: home } })].join('\n') + '\n');

  // The window closed and the daemon killed; the app relaunched on the
  // same home with the daemon reporting level 31 (before activity views):
  // the pane comes back from the layout, since the daemon's build is this
  // one, but the card offers no pane button until a restart.
  const oldPid = daemonPid();
  const child = s.child;
  s.send('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {});
  s.close();
  await Promise.race([new Promise((r) => child.on('exit', r)), sleep(10000)]);
  // M9 fix 645: a window still up here shares the profile with the relaunch, which then never ran its renderer; end it through Node's handle, never a tree kill, which would take the daemon the relaunch reuses.
  if (child.exitCode === null && child.signalCode === null) {
    console.log('[verify] note: the old window had not exited after 10 s');
    child.kill();
    await Promise.race([new Promise((r) => child.once('exit', r)), sleep(5000)]);
  }
  execFileSync('taskkill', ['/pid', String(oldPid), '/f'], { stdio: 'ignore' });
  await sleep(1000);
  process.env['EMERALD_DAEMON_FEATURE_LEVEL'] = '31';
  s = await launch(s.port + 1);
  app = s;
  await s.waitFor(`!!document.querySelector('.app-body')`, 'app after relaunch');
  await s.waitFor(`document.querySelector('.pane[data-view="activity"] .activity-view')?.dataset.state === 'ready'`, 'the activity pane back after the relaunch', 20000);
  pane = await paneView();
  // The chrome is folded (fix 179), so the title bar and its name are gone; the window is read off the pane.
  expect(pane.window === expectedBefore && pane.name === null, `the pane is back on ${expectedBefore} without its title bar (${JSON.stringify(pane)})`);
  // M9 fix 128: the fold survives the relaunch, on the record (fix 179);
  // the older daemon offers no way to change it, so no fold button.
  expect((await s.evalJs(`document.querySelector('.pane[data-view="activity"] .activity-view')?.dataset.controls`)) === 'folded' && (await s.evalJs(`document.querySelector('.pane[data-view="activity"]')?.dataset.chrome`)) === 'hidden', 'the folded chrome is kept across the relaunch');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`!!document.querySelector('.files-rail .activity-card .activity-expand')`, 'the rail card with its expand');
  expect(!(await s.evalJs(`!!document.querySelector('.files-rail .activity-card .activity-open-pane')`)), 'no pane button on the card under level 31');
  step('M69: the pane survives a relaunch and an older daemon gets no pane button');

  // M9 fix 885: the rail keeps its Stats tab under a daemon at level 31,
  // with the level message (the activity pane is focused after a reload,
  // so the rail may be on no folder, and the message comes first).
  expect((await s.evalJs(`document.querySelectorAll('.rail-tab').length`)) === 4, 'four rail tabs under the older daemon (fix 885)');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="stats"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail .stats-view[data-state="old"] .stats-message')?.textContent === 'Statistics need emmerd at level 70 or later; restart it from the banner.'`, 'the level message on the rail\'s Stats', 10000);
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.tab === 'timeline'`, 'the rail back on Activity');
  step('M9 fix 885: the rail keeps its Stats tab under a daemon at level 31, with the level message');

  // M9 fix 245, the closed-app edge: the window's close above wrote
  // `away`, the relaunch's hello `back`, after the two seeded lines and
  // the two the live case posted.
  const edges = presenceLines();
  expect(edges.length === 6 && edges.map((e) => e.presence).join(',') === 'away,back,away,back,away,back' && edges[4].at > edges[3].at && edges[5].at > edges[4].at, `the daemon wrote away at the window's close and back at the relaunch (${JSON.stringify(edges.map((e) => [e.presence, e.at]))})`);
  step("M9 fix 245: the window's close and the relaunch wrote the daemon's own away and back lines");
  // M9 fix 251: the crosshair's readout floats beside the line at the
  // pointer's height, so a strip taller than the pane reads without a
  // scroll to its foot. The tab on the day in rows, time across; the
  // body pinned short so the strip overflows it; a synthetic move over
  // the first drawn span's middle on its own row reads a card right of
  // the line just under the pointer with the axis readout's words and a
  // lane line naming the session and its span; at the right edge the
  // card flips left of the line and stays inside the box; over the band
  // above the tracks the lane line reads `nothing here` and the top is
  // clamped to the box; a pointerout takes it away. The moves are
  // dispatched, since the pinned body hides the rows from a real pointer.
  const T = '.activity-view[data-place="tab"]';
  const TQ = JSON.stringify(T);
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-expand').click()`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.state === 'ready' && document.querySelector(${TQ})?.dataset.unit === 'day'`, 'the activity tab on the day', 10000);
  if ((await s.evalJs(`document.querySelector(${TQ}).dataset.orientation`)) === 'vertical') await s.evalJs(`document.querySelector(${TQ} + ' .activity-orientation').click()`);
  if ((await s.evalJs(`document.querySelector(${TQ}).dataset.density`)) === 'condensed') await s.evalJs(`document.querySelector(${TQ} + ' .activity-density').click()`);
  await s.waitFor(`(() => { const v = document.querySelector(${TQ}); return v?.dataset.orientation === 'horizontal' && v?.dataset.density === 'rows' && Number(v?.dataset.tracks) >= 2 && !!v.querySelector('.activity-strip .activity-span:not([data-agent])'); })()`, 'rows across with spans', 10000);
  await s.evalJs(`document.querySelector(${TQ} + ' .activity-view-body').style.maxHeight = '40px'`);
  const overflow = await s.evalJs(`(() => { const el = document.querySelector(${TQ} + ' .activity-view-body'); return el.scrollHeight - el.clientHeight; })()`);
  expect(overflow > 30, `the pinned body overflows, so the axis readout is out of sight (${overflow})`);
  // The pin only proves the case; the reads are against the strip's box
  // either way, and the frame wants the card in sight.
  await s.evalJs(`document.querySelector(${TQ} + ' .activity-view-body').style.maxHeight = ''`);
  const crossMove = (pct, dy) =>
    s.evalJs(`(() => { const strip = document.querySelector(${TQ} + ' .activity-strip'); const r = strip.getBoundingClientRect(); strip.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + (r.width * ${pct}) / 100, clientY: r.top + ${dy}, bubbles: true })); return { x: (r.width * ${pct}) / 100, w: r.width }; })()`);
  const cardRead = () =>
    s.evalJs(
      `(() => { const v = document.querySelector(${TQ}); const strip = v.querySelector('.activity-strip'); const c = v.querySelector('.activity-cross-card'); if (!c) return null; const sr = strip.getBoundingClientRect(); const cr = c.getBoundingClientRect(); const line = strip.querySelector(':scope > .activity-cross'); const lr = line.getBoundingClientRect(); const ro = v.querySelector('.activity-ticks .activity-cross-readout'); return { side: c.dataset.side, flip: c.dataset.flip ?? null, lane: c.dataset.lane ?? null, lines: [...c.querySelectorAll('.activity-cross-card-line')].map((l) => l.textContent), axisText: ro ? ro.childNodes[0].textContent : null, axisSub: ro?.querySelector('.activity-cross-readout-sub')?.textContent ?? null, y: Number(v.dataset.crossY), top: cr.top - sr.top, left: cr.left - sr.left, right: cr.right - sr.left, bottom: cr.bottom - sr.top, lineX: lr.left - sr.left, stripW: sr.width, stripH: sr.height, events: getComputedStyle(c).pointerEvents, bg: getComputedStyle(c).backgroundColor, laneColor: getComputedStyle(c.lastElementChild).color }; })()`,
    );
  // The first drawn span that is a session's own, its row and its middle.
  const target = await s.evalJs(
    `(() => { const v = document.querySelector(${TQ}); const span = v.querySelector('.activity-strip .activity-span:not([data-agent])'); const track = span.closest('.activity-track'); const i = [...v.querySelectorAll('.activity-strip .activity-track')].indexOf(track); const id = span.dataset.sessionId; const name = v.querySelector('.activity-view-name[data-session-id=' + JSON.stringify(id) + '] .activity-view-name-text')?.textContent ?? null; return { id, name, i, pct: parseFloat(span.style.left) + parseFloat(span.style.width) / 2, rowH: track.getBoundingClientRect().height, title: span.title }; })()`,
  );
  expect(target.name !== null && target.rowH === 18, `a span on a named row of 18px (${JSON.stringify(target)})`);
  const y251 = target.i * target.rowH + 6;
  const moved = await crossMove(target.pct, y251);
  await s.waitFor(`!!document.querySelector(${TQ} + ' .activity-cross-card')`, 'the floating card');
  const card251 = await cardRead();
  // The span's own place on the axis is the run's start, anywhere in the
  // hour, so the side here is whichever the rule gives (right unless the
  // line is in the last fifth or the card would run past the edge); the
  // two sides are then read at 10% and 97%.
  // The model sizes the card off its longest line at 5.6px a character
  // plus its padding, erring wide of the rendered box, so the rule is
  // read with that estimate, not the rendered width.
  const estWidth = Math.ceil(Math.max(...card251.lines.map((l) => l.length)) * 5.6) + 2 * 3 + 2;
  const wantSide = card251.lineX >= card251.stripW * 0.8 || card251.lineX + 6 + estWidth > card251.stripW ? 'left' : 'right';
  const beside = (c) => (c.side === 'right' ? Math.abs(c.left - (c.lineX + 6)) <= 1.5 : Math.abs(c.right - (c.lineX - 6)) <= 1.5 || c.left <= 0.5);
  expect(card251.side === wantSide && beside(card251) && Math.abs(card251.top - (y251 + 6)) <= 1.5 && card251.y === y251, `the card sits beside the line on the ${wantSide}, just under the pointer (${JSON.stringify({ side: card251.side, left: card251.left, right: card251.right, lineX: card251.lineX, stripW: card251.stripW, estWidth, top: card251.top, y: card251.y })})`);
  expect(card251.right <= card251.stripW + 0.5 && card251.bottom <= card251.stripH + 0.5 && card251.top >= -0.5, `the card is inside the strip's box (${JSON.stringify({ right: card251.right, bottom: card251.bottom, stripW: card251.stripW, stripH: card251.stripH })})`);
  expect(card251.lines.length >= 2 && card251.lines[0] === card251.axisText && /^\d\d:\d\d · \d+ running/.test(card251.lines[0]), `the first line is the axis readout's (${JSON.stringify([card251.lines, card251.axisText])})`);
  expect((card251.lines.length === 3) === (card251.axisSub !== null) && (card251.axisSub === null || card251.lines[1] === card251.axisSub), `the waiting line rides along only when the axis readout has one (${JSON.stringify([card251.lines, card251.axisSub])})`);
  const laneLine = card251.lines[card251.lines.length - 1];
  const spanWords = target.title.split('\n');
  const promptCut = spanWords.length > 1 ? spanWords[1].trim().split(/\s+/) : [];
  const wantLane = [spanWords[0], ...(promptCut.length === 0 ? [] : [promptCut.length > 6 ? `${promptCut.slice(0, 6).join(' ')}…` : promptCut.join(' ')]), ...spanWords.slice(2)].join(' · ');
  expect(card251.lane === target.id && laneLine.startsWith(`${target.name} · `) && / \d\d:\d\d to \d\d:\d\d/.test(laneLine) && laneLine === wantLane, `the lane line names the session under the pointer with its span through the span's own words, the prompt cut to six (${JSON.stringify([laneLine, wantLane, card251.lane])})`);
  expect(card251.events === 'none' && card251.bg !== 'rgba(0, 0, 0, 0)' && card251.laneColor !== card251.bg, `the card takes no pointer and has a ground (${JSON.stringify([card251.events, card251.bg])})`);
  await s.screenshot('m9-fix251-cross-card.png');
  // Early on the axis: right of the line. At the right edge: flipped
  // left of it, still inside the box.
  await crossMove(10, y251);
  await s.waitFor(`document.querySelector(${TQ} + ' .activity-cross-card')?.dataset.side === 'right'`, 'the card on the right');
  const early251 = await cardRead();
  expect(early251.side === 'right' && beside(early251) && Math.abs(early251.top - card251.top) <= 1.5, `at a tenth of the width the card sits right of the line (${JSON.stringify({ side: early251.side, left: early251.left, lineX: early251.lineX, top: early251.top })})`);
  await crossMove(97, y251);
  await s.waitFor(`document.querySelector(${TQ} + ' .activity-cross-card')?.dataset.side === 'left'`, 'the card flipped');
  const edge251 = await cardRead();
  expect(edge251.side === 'left' && edge251.right <= edge251.lineX - 4 && edge251.left >= -0.5 && edge251.right <= edge251.stripW + 0.5 && Math.abs(edge251.top - card251.top) <= 1.5, `within the last fifth the card sits left of the line, inside the box, at the same height (${JSON.stringify({ side: edge251.side, left: edge251.left, right: edge251.right, lineX: edge251.lineX, stripW: edge251.stripW, top: edge251.top })})`);
  // Over the band above the tracks: no lane, and the top clamped to 0.
  await crossMove(target.pct, -20);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.crossY === '-20'`, 'the pointer over the band');
  const band251 = await cardRead();
  expect(band251 !== null && band251.lines[band251.lines.length - 1] === 'nothing here' && band251.lane === null && Math.abs(band251.top) <= 0.5, `over the band the lane line reads nothing here and the card is clamped to the box's top (${JSON.stringify({ lines: band251.lines, lane: band251.lane, top: band251.top })})`);
  // M9 fix 262: on the last row the card flips above the pointer, its
  // bottom at the gap over the pointer and so at or above the tick
  // row's top, the tracks' height.
  const tracks251 = Number(await s.evalJs(`document.querySelector(${TQ}).dataset.tracks`));
  const ticksTop251 = tracks251 * target.rowH;
  const yLast = (tracks251 - 1) * target.rowH + 6;
  await crossMove(target.pct, yLast);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.crossY === '${yLast}'`, 'the pointer on the last row');
  const last262 = await cardRead();
  expect(last262.flip === 'up' && last262.bottom <= ticksTop251 + 0.5 && Math.abs(last262.bottom - (yLast - 6)) <= 1.5 && last262.top >= -0.5, `on the last row the card sits above the pointer, its bottom at the gap over it and off the tick row (${JSON.stringify({ flip: last262.flip, top: last262.top, bottom: last262.bottom, yLast, ticksTop: ticksTop251 })})`);
  await s.screenshot('m9-fix262-cross-card-up.png');
  // Past the tracks, on the tick row: no lane either, the card above
  // the pointer and still off the ticks (M9 fix 262).
  await crossMove(target.pct, card251.stripH - 4);
  await s.waitFor(`document.querySelector(${TQ} + ' .activity-cross-card .activity-cross-card-line:last-child')?.textContent === 'nothing here' && Number(document.querySelector(${TQ})?.dataset.crossY) > ${y251}`, 'the pointer on the tick row');
  const foot251 = await cardRead();
  expect(foot251.flip === 'up' && foot251.bottom <= ticksTop251 + 0.5, `on the tick row the card sits above the pointer, off the ticks (${JSON.stringify({ flip: foot251.flip, bottom: foot251.bottom, ticksTop: ticksTop251, stripH: foot251.stripH })})`);
  await s.evalJs(`document.querySelector(${TQ} + ' .activity-strip').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.cross === undefined && !document.querySelector(${TQ} + ' .activity-cross-card')`, 'the card leaves with the pointer');
  // M9 fix 262: a strip too short for the card. One shell with a turn
  // put on the shell pane in place of its session and the tab's pill
  // clicked to panes, so the strip has that one lane of 18px under the
  // tick row; a move over its span draws no card, and the axis readout
  // carries the lane's words as a third piece where the model finds
  // room for them (the joined text at 5.6px a character plus the
  // padding, centred on the line, inside the box on both sides), the
  // readout alone where it does not; the step reads the rule either
  // way, since the span's place on the axis is the run's minute.
  const lone = await spawn250('lone');
  const tabsLone = await getTabs(s);
  const curLone = tabsLone.tabs.find((t) => t.id === tabsLone.currentTabId);
  const shellLone = leaves(curLone).find((p) => p.sessionId !== null);
  expect(shellLone !== undefined, 'a shell pane to lend the lone shell');
  const withLone = (node, id) => (node.kind === 'pane' ? (node.id === shellLone.id ? { ...node, sessionId: id } : node) : { ...node, first: withLone(node.first, id), second: withLone(node.second, id) });
  await zreq(s, 'layout.set', { layout: { ...tabsLone, tabs: tabsLone.tabs.map((t) => (t.id === curLone.id ? { ...t, root: withLone(t.root, lone), focusedPaneId: shellLone.id } : t)) } });
  // The activity tab is in front, so the row's place reads elsewhere (on
  // Panes) and never focused since M9 fix 269, and data-shown stays off;
  // the place read none while the shell was on no pane.
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(lone)}]')?.dataset.place === 'elsewhere'`, 'the lone shell on the pane', 10000);
  const scopeLone = await s.evalJs(`document.querySelector(${TQ}).dataset.scope`);
  for (let turn = 0; turn < 3 && (await s.evalJs(`document.querySelector(${TQ})?.dataset.scope`)) !== 'panes'; turn++) {
    await s.evalJs(`document.querySelector(${TQ} + ' .activity-scope').click()`);
    await sleep(300);
  }
  await s.waitFor(`document.querySelector(${TQ})?.dataset.scope === 'panes' && document.querySelector(${TQ})?.dataset.tracks === '1' && !!document.querySelector(${TQ} + ' .activity-strip .activity-span[data-session-id=${JSON.stringify(lone)}]')`, 'the tab on the panes with the lone lane', 10000);
  const loneSpan = await s.evalJs(`(() => { const v = document.querySelector(${TQ}); const span = v.querySelector('.activity-strip .activity-span[data-session-id=${JSON.stringify(lone)}]'); return { pct: parseFloat(span.style.left) + parseFloat(span.style.width) / 2, title: span.title, rowH: span.closest('.activity-track').getBoundingClientRect().height }; })()`);
  expect(loneSpan.rowH === 18, `the lone lane is one row of 18px (${JSON.stringify(loneSpan)})`);
  await crossMove(loneSpan.pct, 6);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.crossY === '6' && !!document.querySelector(${TQ} + ' .activity-ticks .activity-cross-readout')`, 'the pointer on the lone lane');
  const loneRead = await s.evalJs(`(() => { const v = document.querySelector(${TQ}); const strip = v.querySelector('.activity-strip'); const ro = v.querySelector('.activity-ticks .activity-cross-readout'); const sr = strip.getBoundingClientRect(); return { card: !!v.querySelector('.activity-cross-card'), tracks: Number(v.dataset.tracks), text: ro.childNodes[0].textContent, lane: ro.querySelector('.activity-cross-readout-lane')?.textContent ?? null, x: (parseFloat(ro.style.left) / 100) * sr.width, w: sr.width, stripH: sr.height }; })()`);
  const loneWords = loneSpan.title.split('\n');
  const loneCut = loneWords.length > 1 ? loneWords[1].trim().split(/\s+/) : [];
  const wantLone = [loneWords[0], ...(loneCut.length === 0 ? [] : [loneCut.length > 6 ? `${loneCut.slice(0, 6).join(' ')}…` : loneCut.join(' ')]), ...loneWords.slice(2)].join(' · ');
  const loneHalf = (Math.ceil(`${loneRead.text} · ${wantLone}`.length * 5.6) + 6) / 2;
  const loneRoom = loneRead.x - loneHalf >= 0 && loneRead.x + loneHalf <= loneRead.w;
  expect(!loneRead.card && loneRead.tracks === 1 && Math.abs(loneRead.stripH - 30) <= 0.5, `one lane of 18 under the 12px tick row draws no card (${JSON.stringify(loneRead)})`);
  expect(loneRoom ? loneRead.lane === ` · ${wantLone}` : loneRead.lane === null, `the axis readout carries the lane's words ${loneRoom ? 'since there is room' : 'only with room, and there is none'} at ${loneRead.x.toFixed(0)}px of ${loneRead.w.toFixed(0)} (${JSON.stringify({ lane: loneRead.lane, want: wantLone, half: loneHalf })})`);
  await s.screenshot('m9-fix262-one-lane.png');
  await s.evalJs(`document.querySelector(${TQ} + ' .activity-strip').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.cross === undefined`, 'the readout leaves with the pointer');
  // The pill and the pane back as they were.
  for (let turn = 0; turn < 3 && (await s.evalJs(`document.querySelector(${TQ})?.dataset.scope`)) !== scopeLone; turn++) {
    await s.evalJs(`document.querySelector(${TQ} + ' .activity-scope').click()`);
    await sleep(300);
  }
  await s.waitFor(`document.querySelector(${TQ})?.dataset.scope === ${JSON.stringify(scopeLone)}`, `the tab's pill back to ${scopeLone}`);
  const tabsLoneAfter = await getTabs(s);
  await zreq(s, 'layout.set', { layout: { ...tabsLoneAfter, tabs: tabsLoneAfter.tabs.map((t) => (t.id === curLone.id ? { ...t, root: withLone(t.root, shellLone.sessionId) } : t)) } });
  await s.waitFor(`document.querySelector('.sidebar-row[data-session-id=${JSON.stringify(lone)}]')?.dataset.shown === undefined`, 'the lone shell off the pane', 10000);
  await zreq(s, 'session.kill', { sessionId: lone, remove: true });
  step(`M9 fix 262: the card keeps off the tick row, above the pointer on the last row (bottom ${last262.bottom.toFixed(0)} of ${ticksTop251}) and on the ticks, and a one-lane strip draws no card, the lane's words on the axis readout ${loneRoom ? 'with' : 'without'} room`);
  step(`M9 fix 251: the crosshair's readout floats beside the line at the pointer's height, on the ${card251.side} of it at ${moved.x.toFixed(0)}px of ${moved.w.toFixed(0)}, right of it early and left of it at the edge, the lane line reading ${JSON.stringify(laneLine)}, nothing here over the band and the tick row, clamped inside the box, gone on pointerout`);

  // M9 fix 257: on the week unit each past or today row carries a faint
  // dashed mark at the previous day's peak, with a title naming the day
  // and its peak and `data-prior-peak` on the row; the back row has none
  // (no day before inside the window), nor a row whose day before peaked
  // at 0, nor a future one; the rail card's compact rows have none.
  // Yesterday was seeded a span before the relaunch, so today's row
  // reads yesterday's peak of 1 unless today is the Monday. Since M9 fix
  // 263 the mark is a short dash at each end of the row instead of a
  // line across the day (10px into the ridge from either edge, read off
  // the rects), a wide transparent line under each carries the title,
  // the label's tooltip ends with `prev N`, and a legend under the scale
  // label says what the dash is, absent on the compact card.
  await s.evalJs(`document.querySelector(${TQ} + ' .activity-unit[data-unit="week"]').click()`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.unit === 'week' && document.querySelector(${TQ})?.dataset.state === 'ready' && document.querySelectorAll(${TQ} + ' .activity-week-row').length === 7`, 'the week on the tab', 10000);
  // The tab opened on the rail's folder scope (fix 178), under which the
  // seeded tracks, which no record names, are dropped: every session.
  for (let k = 0; k < 3 && (await s.evalJs(`document.querySelector(${TQ})?.dataset.scope`)) !== 'all'; k++) {
    await s.evalJs(`document.querySelector(${TQ} + ' .file-header .activity-scope').click()`);
    await sleep(300);
  }
  await s.waitFor(`document.querySelector(${TQ})?.dataset.scope === 'all' && document.querySelector(${TQ})?.dataset.state === 'ready' && (${pastDays} === 0 || [...document.querySelectorAll(${TQ} + ' .activity-week-row[data-when="past"]')].some((r) => Number(r.dataset.peak) > 0))`, 'every session on the week, the seeded days with their peaks', 10000);
  // M9 fix 284: the marks moved off the baseline's colour to --fg, read
  // the token the way the fix 264 step resolves --now.
  const rgbOf284 = `((hex) => { const n = parseInt(hex.trim().slice(1), 16); return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')'; })`;
  const fg284 = await s.evalJs(`${rgbOf284}(getComputedStyle(document.documentElement).getPropertyValue('--fg'))`);
  const ticks257 = await s.evalJs(
    `(() => { const w = document.querySelector(${TQ} + ' .activity-week'); const peak = Number(w.dataset.peak); const legend = w.querySelector('.activity-week-legend'); return { peak, legend: legend === null ? null : { text: legend.textContent, mark: !!legend.querySelector('.activity-week-legend-mark'), left: legend.getBoundingClientRect().left - w.getBoundingClientRect().left, top: legend.getBoundingClientRect().top - w.getBoundingClientRect().top }, rows: [...w.querySelectorAll('.activity-week-row')].map((r) => { const svg = r.querySelector('svg'); const ridge = r.querySelector('.activity-week-ridge').getBoundingClientRect(); const marks = [...svg.querySelectorAll('.activity-week-prior')]; const hits = [...svg.querySelectorAll('.activity-week-prior-hit')]; const vb = svg.getAttribute('viewBox').split(' ').map(Number); const base = svg.querySelector('.activity-week-baseline'); const geo = (l) => ({ y1: Number(l.getAttribute('y1')), y2: Number(l.getAttribute('y2')), x: [Number(l.getAttribute('x1')), Number(l.getAttribute('x2'))], left: l.getBoundingClientRect().left - ridge.left, right: l.getBoundingClientRect().right - ridge.left, vector: l.getAttribute('vector-effect'), title: l.querySelector('title')?.textContent ?? null, dash: getComputedStyle(l).strokeDasharray, opacity: Number(getComputedStyle(l).opacity), stroke: getComputedStyle(l).stroke, width: getComputedStyle(l).strokeWidth, events: getComputedStyle(l).pointerEvents }); return { day: r.dataset.day, when: r.dataset.when, peak: Number(r.dataset.peak), prior: r.dataset.priorPeak ?? null, label: r.querySelector('.activity-week-label').textContent, title: r.querySelector('.activity-week-label').title, boxH: vb[3], ridgeW: ridge.width, baseStroke: getComputedStyle(base).stroke, marks: marks.map(geo), hits: hits.map(geo) }; }) }; })()`,
  );
  expect(ticks257.rows.length === 7 && ticks257.peak > 0, `seven rows on a shared peak (${JSON.stringify(ticks257.rows.map((r) => [r.day, r.when, r.peak]))})`);
  const wanted257 = ticks257.rows.map((r, i) => i > 0 && r.when !== 'future' && ticks257.rows[i - 1].peak > 0);
  expect(ticks257.rows.every((r, i) => (r.marks.length === 2) === wanted257[i] && (r.hits.length === 2) === wanted257[i] && (r.prior !== null) === wanted257[i]), `two marks exactly on the past and today rows whose day before peaked above 0, the back row with none (${JSON.stringify(ticks257.rows.map((r, i) => [r.when, r.peak, r.prior, r.marks.length, wanted257[i]]))})`);
  for (let i = 0; i < 7; i++) {
    const r = ticks257.rows[i];
    if (r.marks.length === 0) continue;
    const prev = ticks257.rows[i - 1];
    const amp = r.boxH - 4;
    const want = Math.round((amp + 2 - (prev.peak / ticks257.peak) * amp) * 1000) / 1000;
    const [ml, mr] = r.marks;
    expect(Number(r.prior) === prev.peak && [ml, mr, ...r.hits].every((m) => Math.abs(m.y1 - want) < 0.002 && m.y1 === m.y2), `row ${i}'s marks at the day before's peak ${prev.peak} of ${ticks257.peak}, ${want} in a box of ${r.boxH} (${JSON.stringify(r.marks)}, prior ${r.prior})`);
    // M9 fix 263: 10px into the ridge from either edge, inside this row's own ridge box.
    expect(ml.x[0] === 0 && mr.x[1] === 100 && Math.abs(ml.left) < 1.5 && Math.abs(ml.right - 10) < 1.5 && Math.abs(mr.right - r.ridgeW) < 1.5 && Math.abs(mr.left - (r.ridgeW - 10)) < 1.5, `row ${i}'s marks run 10px in from the ridge's left and right edges (${JSON.stringify([ml.left, ml.right, mr.left, mr.right, r.ridgeW])})`);
    expect(r.hits.every((h, k) => h.title === `${prev.label.split(' · ')[0]}'s peak, ${prev.peak}` && h.events === 'stroke' && parseFloat(h.width) >= 6 && Math.abs(h.left - r.marks[k].left) < 0.5), `the hit lines under the marks carry the title naming the day before and its peak and take the pointer on their stroke (${JSON.stringify(r.hits.map((h) => [h.title, h.events, h.width]))})`);
    // M9 fix 284: --fg, not the baseline's colour, at 2px or more, still
    // under full opacity so it reads as the fainter of the two lines.
    expect([ml, mr].every((m) => m.vector === 'non-scaling-stroke' && m.dash !== 'none' && m.opacity < 1 && m.stroke === fg284 && parseFloat(m.width) >= 2 && m.title === null), `the marks are dashed and readable in --fg (${fg284}), at least 2px, their stroke unscaled, no title of their own (${JSON.stringify(r.marks)})`);
    // M9 fix 274: the tooltip's middle is the day's own agent-hours over
    // its wall hours as a ratio in place of the label's peak, so this
    // reads the day before's peak off the end alone.
    expect(r.title.endsWith(` · prev ${prev.peak}`), `the label's tooltip ends with the day before's peak (${JSON.stringify([r.title, r.label])})`);
  }
  const today257 = ticks257.rows.findIndex((r) => r.when === 'today');
  if (today257 > 0) expect(ticks257.rows[today257 - 1].peak === 1 && ticks257.rows[today257].prior === '1', `today's row reads yesterday's seeded peak of 1 (${JSON.stringify(ticks257.rows[today257])})`);
  else expect(ticks257.rows[0].marks.length === 0 && ticks257.rows[0].prior === null, 'on a Monday today is the back row and carries no mark');
  // The legend is drawn only while some row carries a mark; on a Monday
  // no row does, so there is none to read.
  if (ticks257.rows.some((r) => r.marks.length > 0)) {
    expect(ticks257.legend !== null && ticks257.legend.text.trim() === "the day before's peak" && ticks257.legend.mark && ticks257.legend.left === 0 && ticks257.legend.top > 8, `the legend under the scale label names the dash (${JSON.stringify(ticks257.legend)})`);
  } else {
    expect(ticks257.legend === null, `no marks, so no legend (${JSON.stringify(ticks257.legend)})`);
  }
  await s.screenshot('m9-fix257-prior-peak.png');
  // M9 fix 284: a frame of the week's ridges with the end marks, for the
  // person to judge whether they read against the fill now.
  await s.screenshot('week-marks-284.png');
  // The rail card's compact form draws none: the rail on its Activity
  // tab with the card's tools line shown, the pill cycled to the week.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]')?.click()`);
  await s.waitFor(`!!document.querySelector('.activity-card[data-place="rail"] .activity-card-head')`, 'the rail card');
  if (!(await s.evalJs(`!!document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick')`))) await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-card-tools-toggle').click()`);
  await s.waitFor(`!!document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick')`, "the card's unit pill");
  const cardUnit = () => s.evalJs(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.unit ?? null`);
  const cardTo = async (unit) => {
    for (let k = 0; k < 4 && (await cardUnit()) !== unit; k++) {
      const was = await cardUnit();
      // The tools line can fold under a re-render of the card (its
      // state is the card's own); show it again before the click.
      const seen = await s.evalJs(`(() => { const c = document.querySelector('.activity-card[data-place="rail"]'); return { pick: !!c?.querySelector('.activity-unit-pick'), tools: c?.dataset.tools ?? null, folded: c?.dataset.folded ?? null }; })()`);
      if (!seen.pick) {
        console.log(`[verify] the card's unit pill is missing before the click (${JSON.stringify(seen)}); showing the tools line`);
        if (seen.folded !== null) await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-card-head .activity-fold')?.click()`);
        if (seen.tools !== 'shown') await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-card-tools-toggle')?.click()`);
        await s.waitFor(`!!document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick')`, "the card's unit pill back", 5000);
      }
      await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-unit-pick').click()`);
      await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.unit !== ${JSON.stringify(was)}`, 'the card on the next unit');
      console.log(`[verify] the card's unit pill: ${was} -> ${await cardUnit()} (wanted ${unit})`);
    }
  };
  await cardTo('week');
  try {
    await s.waitFor(`document.querySelector('.activity-card[data-place="rail"]')?.dataset.unit === 'week' && document.querySelectorAll('.activity-card[data-place="rail"] .activity-week-compact .activity-week-row').length === 7`, 'the week on the card', 10000);
  } catch (err) {
    console.log(`[verify] the card at the timeout: ${await s.evalJs(`(() => { const c = document.querySelector('.activity-card[data-place="rail"]'); return JSON.stringify({ unit: c?.dataset.unit, tools: c?.dataset.tools, folded: c?.dataset.folded, rows: c?.querySelectorAll('.activity-week-row').length, compact: !!c?.querySelector('.activity-week-compact'), head: c?.querySelector('.activity-text')?.textContent, stored: localStorage.getItem('emerald.activityUnit') }); })()`)}`);
    throw err;
  }
  const compact257 = await s.evalJs(`(() => { const c = document.querySelector('.activity-card[data-place="rail"] .activity-week-compact'); return { ticks: c.querySelectorAll('.activity-week-prior, .activity-week-prior-hit').length, priors: c.querySelectorAll('.activity-week-row[data-prior-peak]').length, rows: c.querySelectorAll('.activity-week-row').length, legend: c.querySelectorAll('.activity-week-legend').length }; })()`);
  expect(compact257.ticks === 0 && compact257.priors === 0 && compact257.rows === 7 && compact257.legend === 0, `the compact rows carry no mark and no legend (${JSON.stringify(compact257)})`);
  await cardTo('day');
  await s.evalJs(`document.querySelector(${TQ} + ' .activity-unit[data-unit="day"]').click()`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.unit === 'day'`, 'the tab on the day again');
  await s.evalJs(`[...document.querySelectorAll(${TQ} + ' .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector(${TQ})`, 'the tab closed');
  step(`M9 fix 257, 263 and 284: ${ticks257.rows.filter((r) => r.marks.length > 0).length} rows marked at the day before's peak at both ends (${ticks257.rows.map((r) => (r.marks.length === 0 ? '-' : r.prior)).join(' ')}), dashed and now readable in --fg (${fg284}), titled on a wide hit line, prev on the label's tooltip, the legend under the scale; none on the back row or the card's compact rows`);

  // M9 fixes 264, 265 and 266 (the fix-activity-week branch), on the tab
  // opened again off the rail card on the day, every session in scope.
  // Fix 264: the now line is the --now token (the path blue, solid, at
  // full opacity) on the day's band and strip and on the week's today
  // row, and the count at its head shares it; none of them is --working.
  await s.evalJs(`document.querySelector('.activity-card[data-place="rail"] .activity-expand').click()`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.state === 'ready' && document.querySelector(${TQ})?.dataset.unit === 'day'`, 'the activity tab on the day for fix 264', 10000);
  for (let k = 0; k < 3 && (await s.evalJs(`document.querySelector(${TQ})?.dataset.scope`)) !== 'all'; k++) {
    await s.evalJs(`document.querySelector(${TQ} + ' .file-header .activity-scope').click()`);
    await sleep(300);
  }
  await s.waitFor(`document.querySelector(${TQ})?.dataset.scope === 'all' && document.querySelector(${TQ})?.dataset.state === 'ready' && !!document.querySelector(${TQ} + ' .activity-strip .activity-now')`, 'every session on the day with the now line', 10000);
  const rgbOf = `((hex) => { const n = parseInt(hex.trim().slice(1), 16); return 'rgb(' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ') + ')'; })`;
  const tokens264 = await s.evalJs(`(() => { const cs = getComputedStyle(document.documentElement); return { now: ${rgbOf}(cs.getPropertyValue('--now')), working: ${rgbOf}(cs.getPropertyValue('--working')), path: ${rgbOf}(cs.getPropertyValue('--path')) }; })()`);
  expect(/^rgb\(\d+, \d+, \d+\)$/.test(tokens264.now) && tokens264.now !== tokens264.working && tokens264.now === tokens264.path, `--now is set on :root, the path blue, apart from --working (${JSON.stringify(tokens264)})`);
  const nowRead = (sel) => s.evalJs(`(() => { const el = document.querySelector(${TQ} + ' ' + ${JSON.stringify(sel)}); if (el === null) return null; const cs = getComputedStyle(el); return { bg: cs.backgroundColor, color: cs.color, opacity: Number(cs.opacity) }; })()`);
  const day264 = { band: await nowRead('.activity-load .activity-now'), strip: await nowRead('.activity-strip > .activity-now'), count: await nowRead('.activity-load .activity-now-count') };
  expect(day264.strip !== null && day264.strip.bg === tokens264.now && day264.strip.opacity === 1, `the strip's now line is --now, solid (${JSON.stringify(day264.strip)})`);
  expect(day264.band === null || (day264.band.bg === tokens264.now && day264.band.opacity === 1), `the band's now line is --now, solid (${JSON.stringify(day264.band)})`);
  expect(day264.count === null || day264.count.color === tokens264.now, `the count at the band's now line shares the token (${JSON.stringify(day264.count)})`);
  await s.evalJs(`document.querySelector(${TQ} + ' .activity-unit[data-unit="week"]').click()`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.unit === 'week' && document.querySelector(${TQ})?.dataset.state === 'ready' && !!document.querySelector(${TQ} + ' .activity-week-row[data-when="today"] .activity-week-now')`, "the week on the tab with today's now line", 10000);
  const week264 = { line: await nowRead('.activity-week-row[data-when="today"] .activity-week-now'), count: await nowRead('.activity-week .activity-now-count') };
  expect(week264.line !== null && week264.line.bg === tokens264.now && week264.line.opacity === 1 && week264.count !== null && week264.count.color === tokens264.now, `the week's now line and its count are --now, solid (${JSON.stringify(week264)})`);
  await s.screenshot('fix-264-now.png');
  step(`M9 fix 264: the now line and its count are the --now token (${tokens264.now}) on the day's strip and band and on the week's today row, solid, no longer the amber of the graph`);

  // Fix 265: the week's stats line carries the commits tally and the
  // tokens and price after the agent-hours, as the day's does; every
  // status line and claim of the run landed today, so the week's figures
  // are the day's (the fix 217 and 218 steps proved those), and the line
  // holds to two rows at the tab's width.
  const totalsRead = () => s.evalJs(`(() => { const v = document.querySelector(${TQ}); const st = v.querySelector('.activity-view-stats'); const t = st.querySelector('.activity-view-totals'); const y = st.querySelector('.activity-view-tally'); return { text: st.textContent, width: v.getBoundingClientRect().width, lines: (() => { const rg = document.createRange(); rg.selectNodeContents(st); const tops = [...rg.getClientRects()].map((r) => r.top).sort((a, b) => a - b); let n = tops.length === 0 ? 0 : 1; for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] > 8) n++; return n; })(), totals: t === null ? null : { text: t.textContent, requests: t.dataset.requests, estimated: 'estimated' in t.dataset, title: t.title, usd: t.querySelector('.activity-view-usd')?.textContent ?? null }, tally: y === null ? null : { text: y.textContent, commits: y.dataset.commits, merges: y.dataset.merges, title: y.title } }; })()`);
  const week265 = await totalsRead();
  expect(week265.totals !== null && /^ · ↑[\d.]+[kM]? ↓[\d.]+[kM]? · ~?\$[\d.]+$/.test(week265.totals.text) && Number(week265.totals.requests) > 0, `the week's line carries the tokens and the price (${JSON.stringify(week265.totals)})`);
  expect(week265.tally !== null && /^ · \d+ commits?(, \d+ merges?)?$/.test(week265.tally.text) && Number(week265.tally.commits) > 0, `the week's line carries the commits tally (${JSON.stringify(week265.tally)})`);
  // M9 fix 274 moved the peak after the agent-hours and the wall hours;
  // the tally, the totals and the running count still follow the peak.
  expect(/agent-hours in [\d.]+ · [\d.]+× parallel · peak \d+ \w{3} \d+ \d{2}:\d{2} · busiest hour \d{2}:00 across the week · \d+ commit.* · ↑.* · ~?\$[\d.]+ · .*\d+ running now$/.test(week265.text), `the tally, the totals and the count running now follow the peak in that order (${JSON.stringify(week265.text)})`);
  console.log(`[verify] fix 265: the week's line is ${week265.lines} rows at ${week265.width.toFixed(0)}px`);
  if (week265.width >= 700) expect(week265.lines <= 2, `the week's line holds to two rows at ${week265.width.toFixed(0)}px (${week265.lines})`);

  await s.evalJs(`document.querySelector(${TQ} + ' .activity-unit[data-unit="day"]').click()`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.unit === 'day' && document.querySelector(${TQ})?.dataset.state === 'ready' && !!document.querySelector(${TQ} + ' .activity-view-totals')`, "the day's line with its totals", 10000);
  const day265 = await totalsRead();
  expect(day265.totals.text === week265.totals.text && day265.totals.requests === week265.totals.requests && day265.totals.estimated === week265.totals.estimated && day265.totals.title === week265.totals.title, `the week's totals are the day's, the tooltip too (${JSON.stringify([day265.totals, week265.totals])})`);
  expect(day265.tally.text === week265.tally.text && day265.tally.title === week265.tally.title, `the week's tally is the day's (${JSON.stringify([day265.tally, week265.tally])})`);
  step(`M9 fix 265: the week's line ends ${week265.tally.text}${week265.totals.text} · … running now, the day's own figures with their tooltips, ${week265.lines} rows at ${week265.width.toFixed(0)}px`);

  // Fix 266: on the week's hover each dot carries its figure, the
  // readout's cell for that row, 4px right of the dot on its centre
  // line in the readout's mono with a ground halo; a row without a dot
  // has no label; past 90 percent of the width the labels flip to the
  // dot's left; a dot within a line of its row's top takes the label
  // under it. The hover is the fix 230 step's, today's row a few minutes
  // before now.
  await s.evalJs(`document.querySelector(${TQ} + ' .activity-unit[data-unit="week"]').click()`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.unit === 'week' && document.querySelector(${TQ})?.dataset.state === 'ready' && document.querySelectorAll(${TQ} + ' .activity-week-row').length === 7`, 'the week again for fix 266', 10000);
  const weekHover = (pct) =>
    s.evalJs(`(() => { const w = document.querySelector(${TQ} + ' .activity-week'); const a = w.querySelector('.activity-week-area').getBoundingClientRect(); const row = w.querySelector('.activity-week-row[data-when="today"]').getBoundingClientRect(); w.dispatchEvent(new PointerEvent('pointermove', { clientX: a.left + (a.width * ${pct}) / 100, clientY: row.bottom - 4, bubbles: true })); })()`);
  const labelRead = () =>
    s.evalJs(
      `(() => { const w = document.querySelector(${TQ} + ' .activity-week'); const r = w.querySelector('.activity-week-readout'); const cells = [...r.querySelectorAll('.activity-week-readout-row > span')].map((c) => c.textContent); return { hover: w.dataset.hover, cells, rows: [...w.querySelectorAll('.activity-week-row')].map((row) => { const dot = row.querySelector('.activity-week-dot'); const label = row.querySelector('.activity-week-dot-label'); if (dot === null) return { dot: false, label: label !== null }; const dr = dot.getBoundingClientRect(); const lr = label.getBoundingClientRect(); const rr = row.getBoundingClientRect(); const cs = getComputedStyle(label); return { dot: true, label: label !== null, text: label.textContent, flip: 'flip' in label.dataset, under: 'under' in label.dataset, gap: lr.left - dr.right, gapLeft: dr.left - lr.right, dy: lr.top + lr.height / 2 - (dr.top + dr.height / 2), dx: lr.left + lr.width / 2 - (dr.left + dr.width / 2), belowDot: lr.top - (dr.top + dr.height / 2), aboveRow: rr.top - lr.top, font: cs.fontSize, color: cs.color, stroke: cs.webkitTextStrokeWidth, order: cs.paintOrder }; }) }; })()`,
    );
  // Not at the time of day: past 90 percent (about 21:36) the labels flip
  // to the dot's left by design, and the two reads below want them on the
  // right; the flip has its own read at 95 after them.
  await weekHover(Math.min(crossPercent, 85));
  await s.waitFor(`!!document.querySelector(${TQ} + ' .activity-week-cross')`, 'the week crosshair for fix 266');
  const labels266 = await labelRead();
  const dotted266 = labels266.rows.filter((r) => r.dot);
  expect(dotted266.length > 0 && labels266.rows.every((r, i) => (r.dot ? r.label && r.text === labels266.cells[i] : !r.label)), `a label on every dot with the readout's figure for its row and none elsewhere (${JSON.stringify(labels266)})`);
  expect(dotted266.every((r) => !r.flip && r.font === '10.5px' && parseFloat(r.stroke) >= 2 && r.order.startsWith('stroke')), `the labels sit right of the dots in the readout's mono with a ground halo (${JSON.stringify(dotted266.map((r) => [r.flip, r.font, r.stroke, r.order]))})`);
  expect(dotted266.every((r) => (r.under ? r.belowDot >= 4 && Math.abs(r.dx) < 1 : Math.abs(r.gap - 4) < 1 && Math.abs(r.dy) < 1) && r.aboveRow <= 0.5), `each label is 4px right of its dot on its centre line, or centred under a dot at the row's top, never above the row (${JSON.stringify(dotted266.map((r) => [r.under, r.gap, r.dy, r.dx, r.belowDot, r.aboveRow]))})`);
  // At 95 percent of the day a row's dot is at 22:48; on a Monday no row
  // is past and today's is still ahead of it, so there is no dot to flip.
  if (pastDays > 0) {
    await weekHover(95);
    await s.waitFor(`(() => { const l = document.querySelector(${TQ} + ' .activity-week-dot-label'); return l !== null && 'flip' in l.dataset; })()`, 'the labels flipped at the right edge');
    const flipped266 = (await labelRead()).rows.filter((r) => r.dot);
    expect(flipped266.length > 0 && flipped266.every((r) => r.flip && (r.under ? Math.abs(r.dx) < 1 : Math.abs(r.gapLeft - 4) < 1 && Math.abs(r.dy) < 1)), `past 90 percent every label sits 4px left of its dot (${JSON.stringify(flipped266.map((r) => [r.flip, r.under, r.gapLeft, r.dy]))})`);
    await s.screenshot('fix-266-dot-labels.png');
  } else {
    console.log('[verify] fix 266 flip read skipped: no past day in the week, no dot at 95 percent');
  }
  await s.evalJs(`document.querySelector(${TQ} + ' .activity-week').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }))`);
  await s.waitFor(`!document.querySelector(${TQ} + ' .activity-week-cross') && !document.querySelector(${TQ} + ' .activity-week-dot-label')`, 'the crosshair and the labels gone');
  step(`M9 fix 266: ${dotted266.length} dots each with its figure beside it (${dotted266.map((r) => r.text).join(' ')}${dotted266.some((r) => r.under) ? ', one under its dot at the row\'s top' : ''}), flipped left at 95 percent, gone with the crosshair`);

  await s.evalJs(`document.querySelector(${TQ} + ' .activity-unit[data-unit="day"]').click()`);
  await s.waitFor(`document.querySelector(${TQ})?.dataset.unit === 'day'`, 'the tab on the day before it closes');
  await s.evalJs(`[...document.querySelectorAll(${TQ} + ' .file-header .files-button')].pop().click()`);
  await s.waitFor(`!document.querySelector(${TQ})`, 'the fix 264 to 266 tab closed');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m54-activity-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  usageServer.close();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
