// M9 fix 302 acceptance: the per-session load mark on the sidebar row
// (docs/design/per-agent-load.md, checks 1 to 6 and 10 of its section
// 11). The daemon replays a stub file instead of sweeping the box
// (EMERALD_LOAD_STUB, one list of samples per session name, read fresh at
// every tick so a step rewrites it) on a half-second tick; six shells
// play Claude through the hook sink, five with a prompt posted so their
// rows carry the agent line the mark sits on, one left idle. The row
// draws a dash and no figure under three samples and a line from three;
// the mark is on a working row and not on the idle one, whose height
// does not move; one session at 300 beside four under 40 clips at the
// shared ceiling with the dashed rule and its peak while the four keep
// non-flat lines, and the scale is shared, the 300 line's travel at
// least four times a 6 line's; the ceiling holds across two ticks with
// no peak moved; 199 reads --load-ink and 200 --load-hot on the line and
// the figure both, with the row's background, border and colour bar the
// same either side; nothing under a spark has a fill; the card carries
// the figure, the memory, the peak and the process names; and the two
// frames at 276 and 340. Uses a private home and pipe unless the
// environment already names them. Run: npm run verify:load -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm9-load-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m9-load';
const { expect, freshPort, killTree, launch, sleep, step, stopDaemon, zreq } = await import('./cdp.mjs');

let s = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 180 s');
  if (s !== null) killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 180000);

const home = os.homedir();
const stubPath = path.join(process.env['EMERALD_HOME'], 'load-stub.json');
fs.mkdirSync(process.env['EMERALD_HOME'], { recursive: true });
// Empty at the start: every row has a ring of nothing until a step
// writes a list.
fs.writeFileSync(stubPath, '{}\n');
const writeStub = (lists) => fs.writeFileSync(stubPath, JSON.stringify(lists) + '\n');
const TICK = 500;
s = await launch(freshPort(), { freshState: true, env: { EMERALD_LOAD_TICK_MS: String(TICK), EMERALD_LOAD_STUB: stubPath } });

const daemon = () => JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
const post = async (sessionId, payload) => {
  const d = daemon();
  const res = await fetch(`http://127.0.0.1:${d.hookPort}/hook`, {
    method: 'POST',
    headers: { 'X-Emerald-Token': d.hookToken, 'X-Emerald-Session': sessionId },
    body: JSON.stringify({ session_id: `sim-${sessionId.slice(0, 8)}`, cwd: 'C:/sim', ...payload }),
  });
  expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
};
const rowSel = (id) => `.sidebar-row[data-session-id=${JSON.stringify(id)}]`;
// Everything the mark says on one row, in one read: the dash or the
// line, the sample count, the ink, the ceiling, the peak, the figure,
// the polyline's points and the clip rule.
const markRead = (id) =>
  s.evalJs(
    `(() => { const row = document.querySelector(${JSON.stringify(rowSel(id))}); if (row === null) return null; const spark = row.querySelector('.sidebar-row-load-spark'); const figure = row.querySelector('.sidebar-row-load-figure'); const wordEl = row.querySelector('.sidebar-row-load-word'); const line = spark?.querySelector('polyline') ?? null; const pts = line === null ? [] : line.getAttribute('points').split(' ').filter(Boolean).map((p) => p.split(',').map(Number)); return { spark: spark !== null, load: spark?.dataset.load ?? null, samples: spark === null ? null : Number(spark.dataset.samples), ink: spark?.dataset.ink ?? null, ceiling: spark === null || spark.dataset.ceiling === undefined ? null : Number(spark.dataset.ceiling), peak: spark?.dataset.peak ?? null, clipped: spark?.dataset.clipped === 'true', text: spark?.textContent ?? null, ariaLabel: spark?.getAttribute('aria-label') ?? null, figure: figure === null ? null : { text: figure.textContent, ink: figure.dataset.ink, color: getComputedStyle(figure).color }, sparkColor: spark === null ? null : getComputedStyle(spark).color, width: spark === null ? null : spark.getBoundingClientRect().width, points: pts, clipRule: spark !== null && spark.querySelector('.sidebar-row-load-clip') !== null ? getComputedStyle(spark.querySelector('.sidebar-row-load-clip')).strokeDasharray : null, agent: row.querySelector('.sidebar-row-agent')?.textContent ?? null, word: wordEl === null ? null : { text: wordEl.textContent, fontSize: getComputedStyle(wordEl).fontSize, color: getComputedStyle(wordEl).color } }; })()`,
  );
// The row's own paint, which the threshold must not touch: its
// background, its left border, and the colour bar (the row's ::before
// in the session's colour).
const rowPaint = (id) =>
  s.evalJs(
    `(() => { const row = document.querySelector(${JSON.stringify(rowSel(id))}); const cs = getComputedStyle(row); const bar = getComputedStyle(row, '::before'); return { background: cs.backgroundColor, border: cs.borderLeftColor, bar: bar.backgroundColor + ' ' + bar.width, height: row.getBoundingClientRect().height }; })()`,
  );
const rowHeight = (id) => s.evalJs(`document.querySelector(${JSON.stringify(rowSel(id))})?.getBoundingClientRect().height ?? null`);
const setSidebarWidth = async (target) => {
  const cur = await s.evalJs(`document.querySelector('.sidebar').getBoundingClientRect().width`);
  const resizer = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.mouse('mousePressed', resizer.x, resizer.y);
  await s.mouse('mouseReleased', resizer.x + (target - cur), resizer.y);
  await s.waitFor(`Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - ${target}) <= 1`, `sidebar at ${target}px`);
};
const travel = (points) => Math.max(...points.map(([, y]) => 10.5 - y));
const flat = (points) => points.every(([, y]) => y === points[0][1]);

try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await setSidebarWidth(276);
  const spawn = async (name) => {
    const { session } = await zreq(s, 'session.spawn', { kind: 'shell', cwd: home, name, cols: 100, rows: 30 });
    return session.id;
  };
  const ids = {};
  for (const name of ['s1', 's2', 's3', 's4', 's5', 'quiet']) ids[name] = await spawn(name);
  await s.waitFor(`document.querySelectorAll('.sidebar-row').length === 6`, 'six rows');
  // The idle row's height before the feature's first tick, for check 2.
  const quietBefore = await rowHeight(ids.quiet);
  for (const name of ['s1', 's2', 's3', 's4', 's5']) {
    await post(ids[name], { hook_event_name: 'SessionStart', source: 'startup' });
    await post(ids[name], { hook_event_name: 'UserPromptSubmit', prompt: `${name}: build the orchard` });
  }
  await s.waitFor(`[...document.querySelectorAll('.sidebar-row[data-state="working"]')].length === 5`, 'five rows working');
  await s.waitFor(`document.querySelectorAll('.sidebar-row .sidebar-row-agent').length === 5`, 'five agent lines');
  const empty = await markRead(ids.s1);
  expect(empty.spark && empty.load === 'none' && empty.samples === 0 && empty.figure === null && empty.points.length === 0 && empty.text === '—', `no samples: the dash, no figure element and no line (${JSON.stringify(empty)})`);
  // Fix 315: the muted cpu word sits before the mark on every row, the
  // dash's row included, and the spark's aria-label carries it too.
  expect(empty.word?.text === 'cpu' && empty.ariaLabel === 'cpu, no load samples yet', `the word reads cpu before the dash, the aria-label carries it (${JSON.stringify([empty.word, empty.ariaLabel])})`);
  expect(!(await markRead(ids.quiet)).spark && (await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(ids.quiet))} + ' .sidebar-row-agent')`)) === null, 'the idle row has no agent line and no mark');
  step('six shells, five with a prompt: the dash and no figure on every agent line before a sample lands');

  // Check 1: s1 gets three samples one tick apart; a loop in the page
  // records the mark at every change of the count, so the reads at one
  // and two samples are not missed between polls. Every session gets
  // its list now, since a rewrite of the stub starts every list over.
  // Fix 703: a counter of the pushes from here on, fix 664's shape; it
  // stays installed and nothing after check 1's own read looks at it. A
  // record push counts as a load tick's when the ring and the names are
  // all it moved against the record before it (seeded from a list): the
  // shells are still settling here, and each sends its title as a record
  // carrying the ring whole, which is not a load tick.
  await s.evalJs(
    `(async () => { const c = { load: [], changed: [], other: 0, prev: {}, start: Date.now() }; window.__load703 = c; window.emerald.on((m) => { if (m.type === 'sessions.load') c.load.push(m.samples.map((x) => x.sessionId)); else if (m.type === 'session.changed') { const prev = c.prev[m.session.id]; c.prev[m.session.id] = m.session; if (prev === undefined) return; const moved = Object.keys({ ...prev, ...m.session }).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(m.session[k])); if (moved.length > 0 && moved.every((k) => k === 'load' || k === 'loadNames')) c.changed.push([m.session.name, m.session.state]); else c.other += 1; } }); const { sessions } = await window.emerald.request('session.list', {}); for (const x of sessions) if (c.prev[x.id] === undefined) c.prev[x.id] = x; return true; })()`,
  );
  writeStub({
    s1: [{ cpu: 6, rss: 120 }, { cpu: 30, rss: 130 }, { cpu: 12, rss: 125 }],
    s2: [{ cpu: 10, rss: 200 }, { cpu: 35, rss: 210 }, { cpu: 20, rss: 205 }],
    s3: [{ cpu: 8, rss: 300 }, { cpu: 25, rss: 310 }, { cpu: 15, rss: 305 }, { cpu: 10, rss: 300 }, { cpu: 12, rss: 300 }, { cpu: 14, rss: 300 }, { cpu: 9, rss: 300 }, { cpu: 11, rss: 300 }, { cpu: 13, rss: 300 }, { cpu: 10, rss: 300 }],
    s4: [{ cpu: 300, rss: 1229, names: ['powershell', 'node', 'tsc'] }, { cpu: 300, rss: 1240, names: ['powershell', 'node', 'tsc'] }, { cpu: 300, rss: 1250, names: ['powershell', 'node', 'tsc'] }],
    s5: [{ cpu: 5, rss: 90 }, { cpu: 38, rss: 95 }, { cpu: 9, rss: 92 }],
    quiet: [{ cpu: 50, rss: 400 }, { cpu: 50, rss: 400 }, { cpu: 50, rss: 400 }],
  });
  const seen = await s.evalJs(
    `(async () => { const row = document.querySelector(${JSON.stringify(rowSel(ids.s1))}); const read = () => { const spark = row.querySelector('.sidebar-row-load-spark'); return { samples: spark === null ? -1 : Number(spark.dataset.samples), load: spark?.dataset.load ?? null, figure: row.querySelector('.sidebar-row-load-figure') !== null, line: spark?.querySelector('polyline') !== null, text: spark?.textContent ?? null }; }; const seen = []; const deadline = Date.now() + 15000; while (Date.now() < deadline) { const r = read(); if (seen.length === 0 || seen[seen.length - 1].samples !== r.samples) seen.push(r); if (r.samples >= 3) break; await new Promise((res) => setTimeout(res, 20)); } return seen; })()`,
  );
  const counts = seen.map((r) => r.samples);
  expect(counts.join(',') === '0,1,2,3', `the count went 0, 1, 2, 3 one tick apart (${counts.join(',')})`);
  for (const r of seen) {
    if (r.samples < 3) expect(r.load === 'none' && !r.figure && !r.line && r.text === '—', `at ${r.samples} sample(s) the dash, no figure and no line (${JSON.stringify(r)})`);
    else expect(r.load === 'line' && r.figure && r.line, `at three samples a line and a figure (${JSON.stringify(r)})`);
  }
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(ids.s1))} + ' .sidebar-row-load-figure')?.textContent === '12%'`, 'the figure reads the latest sample');
  step('check 1: the dash and no figure at zero, one and two samples, a line and the figure at three');

  // Fix 703: the three ticks came as one sessions.load each, naming all
  // six sampled sessions, and no record push moved the ring alone (today
  // six a tick, eighteen in all). A record that moved anything else (a
  // title, a state) is counted apart and allowed.
  const counted = await s.evalJs(`JSON.stringify({ load: window.__load703.load, changed: window.__load703.changed, other: window.__load703.other })`).then((j) => JSON.parse(j));
  const sixIds = ['s1', 's2', 's3', 's4', 's5', 'quiet'].map((n) => ids[n]).sort().join(',');
  const firstThree = counted.load.slice(0, 3).map((list) => [...new Set(list)].sort().join(','));
  expect(counted.load.length >= 3 && firstThree.every((l) => l === sixIds), `at least three sessions.load pushes, each of the first three naming the six sessions (${counted.load.length} pushes: ${JSON.stringify(counted.load.slice(0, 3).map((l) => l.length))})`);
  expect(counted.changed.length === 0, `no session.changed that moved only the ring (${counted.changed.length}: ${JSON.stringify(counted.changed)}; ${counted.other} other record pushes)`);
  step(`fix 703: one sessions.load push a tick naming the six sampled sessions, and no session.changed carrying a sample (${counted.other} record pushes for other fields)`);

  // Check 2: the mark on a working row, none on the idle one, whose
  // height has not moved though it has samples of its own.
  for (const name of ['s2', 's3', 's4', 's5']) await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(ids[name]))} + ' .sidebar-row-load-spark')?.dataset.load === 'line'`, `${name} has its line`);
  const quietMark = await markRead(ids.quiet);
  expect(!quietMark.spark, 'the idle row has no mark though its ring holds samples');
  const quietAfter = await rowHeight(ids.quiet);
  expect(quietAfter === quietBefore, `the idle row's height is what it was before the first tick (${quietBefore} then ${quietAfter})`);
  step('check 2: the mark on the five working rows and not on the idle one, whose height did not move');

  // Checks 5 and 4: s4 at 300 beside four under 40 and the idle one at
  // 50: the ceiling is next100(4 x 50) = 200, so s4 clips at the top
  // with the dashed rule and its peak, the four keep non-flat lines, and
  // s4's travel from the baseline is at least four times s1's.
  const s4 = await markRead(ids.s4);
  expect(s4.ceiling === 200, `the shared ceiling reads 200 (${JSON.stringify(s4)})`);
  expect(s4.clipped && s4.points.length === 3 && s4.points.every(([, y]) => y === 0.5), `s4 clips at the padding, every point at y 0.5 (${JSON.stringify(s4.points)})`);
  expect(s4.clipRule !== null && s4.clipRule !== 'none' && s4.clipRule !== '', `the dashed clip rule is drawn (stroke-dasharray ${s4.clipRule})`);
  expect(s4.peak === '300%', `the spark carries its peak (${s4.peak})`);
  expect(s4.figure.text === '300%' && s4.ink === 'load-hot' && s4.figure.ink === 'load-hot', `s4 at 300 reads amber on the line and the figure (${JSON.stringify(s4.figure)}, ${s4.ink})`);
  // Fix 328: the line form's aria-label carries the figure and the peak too, not the dash form's alone.
  expect(s4.ariaLabel === 'cpu 300% of one core, peak 300% over 5 min', `the line form's aria-label carries the figure and the peak (${s4.ariaLabel})`);
  // Fix 315: the word on a sampled row, 9px and muted, unmoved by the
  // ink the line itself carries at 300%.
  expect(s4.word?.text === 'cpu' && s4.word.fontSize === '9px' && s4.word.color === 'rgb(138, 138, 138)', `the word is 9px and muted on a working row (${JSON.stringify(s4.word)})`);
  const quietUnder = [];
  for (const name of ['s1', 's2', 's3', 's5']) {
    const m = await markRead(ids[name]);
    quietUnder.push([name, m.points]);
    expect(m.ceiling === 200 && !m.clipped && m.points.length >= 3 && !flat(m.points), `${name} shares the ceiling, is not clipped and has a non-flat line (${JSON.stringify(m.points)})`);
    expect(m.clipRule === null, `${name} draws no clip rule`);
  }
  const s1 = await markRead(ids.s1);
  const ratio = travel(s4.points) / travel(s1.points);
  expect(ratio >= 4, `s4's travel is at least four times s1's (${travel(s4.points)} against ${travel(s1.points)}, ${ratio.toFixed(1)}x)`);
  step(`checks 5 and 4: one at 300 beside four under 40 clips at the ceiling of 200 with the dashed rule and its peak, the four keep their shapes, and the travel is ${ratio.toFixed(1)}x`);

  // Check 6: s3's list is still landing under its peak; across two
  // ticks the ceiling on every spark stays where it is.
  const tickOf = () => s.evalJs(`Number(document.querySelector(${JSON.stringify(rowSel(ids.s3))} + ' .sidebar-row-load-spark').dataset.samples)`);
  const n0 = await tickOf();
  expect(n0 < 10, `s3 still has samples to come (${n0} of 10 in)`);
  await s.waitFor(`Number(document.querySelector(${JSON.stringify(rowSel(ids.s3))} + ' .sidebar-row-load-spark').dataset.samples) > ${n0}`, 'a tick landed on s3');
  const c1 = await s.evalJs(`[...document.querySelectorAll('.sidebar-row-load-spark[data-load="line"]')].map((e) => e.dataset.ceiling)`);
  const n1 = await tickOf();
  await s.waitFor(`Number(document.querySelector(${JSON.stringify(rowSel(ids.s3))} + ' .sidebar-row-load-spark').dataset.samples) > ${n1}`, 'the next tick landed on s3');
  const c2 = await s.evalJs(`[...document.querySelectorAll('.sidebar-row-load-spark[data-load="line"]')].map((e) => e.dataset.ceiling)`);
  expect(c1.length === 5 && c1.join(',') === c2.join(',') && c1.every((c) => c === '200'), `the ceiling held across two ticks with no peak moved (${c1.join(',')} then ${c2.join(',')})`);
  step('check 6: two ticks with no peak moved leave the ceiling at 200 on every spark');

  // Check 3: s2 at 199 then at 200, the ink on the line and the figure
  // turning and nothing else on the row. The stub names s2 alone, so
  // every other ring stays as it is.
  writeStub({ s2: [{ cpu: 199, rss: 200 }] });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(ids.s2))} + ' .sidebar-row-load-figure')?.textContent === '199%'`, 's2 at 199');
  const under = await markRead(ids.s2);
  const paintUnder = await rowPaint(ids.s2);
  expect(under.ink === 'load-ink' && under.figure.ink === 'load-ink' && under.figure.color === under.sparkColor, `199 reads load-ink on the line and the figure, one colour (${JSON.stringify([under.ink, under.figure])})`);
  writeStub({ s2: [{ cpu: 200, rss: 200 }] });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(ids.s2))} + ' .sidebar-row-load-figure')?.textContent === '200%'`, 's2 at 200');
  const over = await markRead(ids.s2);
  const paintOver = await rowPaint(ids.s2);
  expect(over.ink === 'load-hot' && over.figure.ink === 'load-hot' && over.figure.color === over.sparkColor, `200 reads load-hot on the line and the figure, one colour (${JSON.stringify([over.ink, over.figure])})`);
  expect(over.sparkColor !== under.sparkColor, `the ink changed across the threshold (${under.sparkColor} to ${over.sparkColor})`);
  expect(over.sparkColor === s4.sparkColor, 'the hot ink is the same amber s4 wears');
  expect(paintUnder.background === paintOver.background && paintUnder.border === paintOver.border && paintUnder.bar === paintOver.bar && paintUnder.height === paintOver.height, `the row's background, border, colour bar and height are the same either side (${JSON.stringify(paintUnder)} against ${JSON.stringify(paintOver)})`);
  step('check 3: 199 is load-ink and 200 is load-hot on the line and the figure, and the row itself does not change');

  // Check 10: nothing under a spark has a fill.
  const fills = await s.evalJs(`[...document.querySelectorAll('.sidebar-row-load-spark polyline, .sidebar-row-load-spark path, .sidebar-row-load-spark line')].map((e) => getComputedStyle(e).fill)`);
  expect(fills.length >= 5 && fills.every((f) => f === 'none'), `every line under a spark has fill none (${[...new Set(fills)].join(', ')})`);
  const strokes = await s.evalJs(`[...document.querySelectorAll('.sidebar-row-load-line')].map((e) => { const cs = getComputedStyle(e); return [cs.strokeWidth, cs.vectorEffect, cs.strokeLinecap]; })`);
  expect(strokes.every(([w, v, cap]) => parseFloat(w) === 1 && v === 'non-scaling-stroke' && cap === 'butt'), `a one-pixel non-scaling butt-capped stroke (${JSON.stringify(strokes[0])})`);
  step('check 10: no fill under any spark, one-pixel non-scaling strokes');

  // The card off the spark: a click pins it, as the context reading's
  // does; it carries the figure, the memory, the peak and the names.
  await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(ids.s4))} + ' .sidebar-row-load-spark').click()`);
  await s.waitFor(`!!document.querySelector('.load-popover[data-session-id=${JSON.stringify(ids.s4)}]')`, 'the load card for s4');
  const card = await s.evalJs(
    `(() => { const c = document.querySelector('.load-popover[data-session-id=${JSON.stringify(ids.s4)}]'); const box = c.getBoundingClientRect(); return { cpu: c.querySelector('.load-popover-cpu').textContent, figureColor: getComputedStyle(c.querySelector('.load-popover-figure')).color, mem: c.querySelector('.load-popover-mem').textContent, peak: c.querySelector('.load-popover-peak').textContent, names: [...c.querySelectorAll('.load-popover-name')].map((n) => n.textContent), rule: c.querySelector('.load-popover-rule') !== null, inWindow: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight, turnCards: document.querySelectorAll('.turn-popover').length }; })()`,
  );
  expect(card.cpu === 'cpu 300% of one core' && card.mem === 'memory 1.2 GB' && card.peak === 'peak 300% cpu · 5 min', `the card reads the words and the figure, the memory and the peak (${JSON.stringify(card)})`);
  expect(card.names.join(',') === 'powershell,node,tsc' && card.rule, `the names under a rule (${card.names.join(',')})`);
  expect(card.figureColor === s4.sparkColor, 'the card figure wears the hot ink');
  expect(card.inWindow && card.turnCards === 0, `the card is inside the window and the turn card did not open with it (${card.turnCards} turn cards)`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.load-popover')`, 'the card closed on Escape');
  step('the card: cpu 300% of one core, memory 1.2 GB, peak 300% cpu · 5 min, powershell node tsc');

  // The two widths: 44 at 276, 56 at 340 (the container step), the
  // figure 34 at both, and a frame of each.
  const at276 = await markRead(ids.s4);
  const figure276 = await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(ids.s4))} + ' .sidebar-row-load-figure').getBoundingClientRect().width`);
  expect(Math.abs(at276.width - 44) < 0.5 && Math.abs(figure276 - 34) < 0.5, `at 276 the spark is 44 and the figure 34 (${at276.width}, ${figure276})`);
  const agent276 = await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(ids.s4))} + ' .sidebar-row-agent').getBoundingClientRect().width`);
  expect(agent276 >= 90, `the agent text keeps at least 90px at 276 (${agent276})`);
  await s.screenshot('m9-302-row-276.png');
  await setSidebarWidth(340);
  await s.waitFor(`Math.abs(document.querySelector(${JSON.stringify(rowSel(ids.s4))} + ' .sidebar-row-load-spark').getBoundingClientRect().width - 56) < 0.5`, 'the spark at 56 in a wide sidebar');
  // s2 at 200 since check 3 lifted the cap to 800, so the ceiling is
  // s4's own 300 now and its line sits at the top unclipped.
  const at340 = await markRead(ids.s4);
  expect(at340.ceiling === 300 && !at340.clipped && at340.points.every(([, y]) => y === 0.5), `the ceiling rose to 300 with s2 at 200 and s4's line sits at the top unclipped (${JSON.stringify([at340.ceiling, at340.clipped, at340.points])})`);
  // The samples sit in the last seconds of a five-minute span, so the
  // line itself is a sliver at the right edge; the box is what widens.
  const svg340 = await s.evalJs(`(() => { const l = document.querySelector(${JSON.stringify(rowSel(ids.s4))} + ' .sidebar-row-load-spark svg'); const b = l.getBoundingClientRect(); const line = l.querySelector('.sidebar-row-load-line').getBoundingClientRect(); return { width: b.width, lineRight: line.right, boxRight: b.right }; })()`);
  expect(Math.abs(svg340.width - 56) < 0.5 && Math.abs(svg340.lineRight - svg340.boxRight) < 1.5, `the svg spans the wider box with the line's newest point at its right edge (${JSON.stringify(svg340)})`);
  await s.screenshot('m9-302-row-340.png');
  await setSidebarWidth(276);
  step('the spark is 44 wide at 276 and 56 at 340, the figure 34; frames m9-302-row-276.png and m9-302-row-340.png');

  // Fix 314: a killed row shows no load figure at all, not the dash
  // either, since a dead tree has no load to be unmeasured. s5 carries a
  // ring of samples; kill it (exited, not removed, so the row stays) and
  // read that its mark is gone while its agent line still shows.
  await zreq(s, 'session.kill', { sessionId: ids.s5 });
  await s.waitFor(`document.querySelector(${JSON.stringify(rowSel(ids.s5))})?.dataset.state === 'exited'`, 's5 exited');
  const killed = await markRead(ids.s5);
  expect(!killed.spark && killed.figure === null && killed.agent !== null, `an exited row has no spark and no figure, the agent line still showing (${JSON.stringify(killed)})`);
  step('fix 314: a killed row shows no load spark and no figure, the agent line still showing');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m9-load-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-20).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
