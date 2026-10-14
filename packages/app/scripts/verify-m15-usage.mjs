// M15 acceptance: the Claude usage strip in the sidebar footer. The main
// process is pointed at a seeded credentials file and a stub endpoint on
// a local port, so nothing here reads the real credentials or talks to
// Anthropic. Checks the three segments and their text, a changed reply
// after the refresh button, a 401 giving the signed-out line, a closed
// port giving the unavailable line, and a missing credentials file giving
// the signed-out line. M9 fix 44: the meters are 10px dials driven by
// --pct. M9 fix 62: the column form is per window count, so two windows
// stay on one line where three stack. M9 fix 66: the dial sits between
// the window's name and the percent. M9 fix 68: the breakpoints are
// measured on the windows' own box with the widest text a window can
// have, and a row form one pixel over each never wraps. M9 fix 99: the
// note says why (a 503, no connection, a 429 with its wait) and the
// button's title says what to do, and the main process writes its log
// to main.log under the home. M9 fix 100: the strip keeps to a schedule,
// a floor between requests that a 429 raises to its retry-after, the
// button held and counting down inside it; the floor is set to zero for
// this run (EMERALD_USAGE_FLOOR_MS), since the steps press the button
// seconds apart, and the 429's hold is what the last steps read. M9 fix
// 285: the main process posts usage.capped to the daemon when a window
// reaches 100 percent and usage.freed when it drops under, and the
// daemon writes each to hooks.jsonl; the fix 68 replies at 100 and the
// one under it after are the crossings read there. M9 fix 308: the dial
// and the percent on the strip are a pace bar (docs/design/pace-bars.md),
// the fill the percent, the mark the elapsed share, ticks at the window's
// unit; the card's row draws the same bar full width and its reset line
// carries the runway. M9 fix 324: the strip's text takes the bar's
// tone, and in the error tone the runway joins it after a dot; in the
// stacked forms the runway sits on a line of its own under the reset.
// M9 fix 347: the strip's form is measured, not a breakpoint: it sets
// data-stack to the first of its four forms that fits the windows' box
// (the row, the row with the runways under their resets, the column,
// the column with the runways under) and data-needs to the four needs,
// and the fix 62, 68 and 324 steps read the form one pixel over and
// under each need against the drawn row. M9 fix 348: a layout tab
// opened and closed asks nothing, and main.log's read lines say what
// made each ask. M9 fix 440: in the column forms the bar grows into the
// box's spare width past the model's 44px need (never past 44 in the
// row forms, and never changing which form fits), 8px tall past 88px;
// this is true from the very first reading, since the column form
// already has room at the default sidebar, so the fix 308 and 324 pixel
// reads below use strip440Geometry and expectedTick to read the bar's
// actual drawn width and its ticks rather than the old 44px literal,
// and a dedicated step at the sidebar's widest (with fix 324's long
// windows, still the column there) checks the growth itself. Uses a
// private home and pipe unless the environment already names them.
// Run: npm run verify:usage -w @emerald/app
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm15-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m15';
const { expect, freshPort, killTree, launch, sleep, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
let server = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 180 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 180000);

// The seeded Claude home: a credentials file in the shape Claude Code
// writes, with a token the stub checks for.
const claudeHome = path.join(os.tmpdir(), 'emerald-verify', `m15-claude-${process.pid}`);
fs.rmSync(claudeHome, { recursive: true, force: true });
fs.mkdirSync(claudeHome, { recursive: true });
const credentials = path.join(claudeHome, '.credentials.json');
const TOKEN = 'verify-token-m15';
fs.writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() + 3600_000 } }));
process.env['EMERALD_CLAUDE_HOME'] = claudeHome;
process.env['EMERALD_USAGE_FLOOR_MS'] = '0';

// The stub endpoint. `reply` is what the next request gets; the headers
// of every request are kept so the script can check the token went out
// as a Bearer and nothing else did.
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms) => new Date(Date.now() + ms).toISOString();
// M9 fix 294: the live reply carries a `limits` list beside the keys,
// its weekly_scoped entry naming the model; with the top-level
// seven_day_fable present that key wins, so the first reading is the
// three windows as before, Fable at 8 not 7.
const liveLimits = (fable, weeklyReset) => [
  { kind: 'session', percent: 17, resets_at: at(41 * MIN), severity: 'ok', is_active: true },
  { kind: 'weekly_all', percent: 5, resets_at: weeklyReset, severity: 'ok', is_active: true },
  { kind: 'weekly_scoped', percent: fable, resets_at: weeklyReset, severity: 'ok', is_active: true, scope: { model: { display_name: 'Fable', id: 'claude-fable-5-1' } } },
];
const firstWeeklyReset = at(6 * DAY + 16 * HOUR + 20 * MIN);
let reply = {
  status: 200,
  body: {
    five_hour: { utilization: 17, resets_at: at(41 * MIN) },
    seven_day: { utilization: 5, resets_at: firstWeeklyReset },
    seven_day_fable: { utilization: 8, resets_at: firstWeeklyReset },
    limits: liveLimits(7, firstWeeklyReset),
  },
};
const requests = [];
server = http.createServer((req, res) => {
  requests.push({ url: req.url, authorization: req.headers['authorization'], beta: req.headers['anthropic-beta'] });
  res.writeHead(reply.status, { 'content-type': 'application/json', ...(reply.headers ?? {}) });
  res.end(JSON.stringify(reply.body));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const usagePort = server.address().port;
process.env['EMERALD_USAGE_URL'] = `http://127.0.0.1:${usagePort}/api/oauth/usage`;

const stripState = (s) => s.evalJs(`document.querySelector('.usage-strip')?.dataset.state ?? null`);
// M9 fix 66: the window's name and the rest are two spans with the dial
// between them; the segment's text is their join.
const segments = (s) => s.evalJs(`[...document.querySelectorAll('.usage-window')].map(w => w.dataset.key + '=' + w.querySelector('.usage-label').textContent + ' ' + w.querySelector('.usage-text').textContent)`);
const note = (s) => s.evalJs(`document.querySelector('.usage-note')?.textContent ?? null`);
const refreshTitle = (s) => s.evalJs(`document.querySelector('.usage-refresh').title`);
// M73 task 2: the tooltip a segment carried is the usage card now. A hover
// on the segment past the delay opens it; the card is read as rows and
// its note, then the mouse moves off and the card closes. No segment
// carries a title any more.
const hoverSegment = async (s, key) => {
  // In the stacked form the segment is display: contents (fix 29), so its
  // label is the box to hover; the events bubble through the anchor.
  const c = await s.evalJs(`(() => { const el = document.querySelector('.usage-window[data-key=' + JSON.stringify(${JSON.stringify(key)}) + '] .usage-label'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  expect(c !== null, `a segment to hover for ${key}`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await s.waitFor(`!!document.querySelector('.usage-popover')`, `the usage card opens off the ${key} segment`, 8000);
  return c;
};
// M9 fix 308: a row's bar is read as its fill (the percent), its mark
// (the elapsed share, what the 72px track said), its tick count and
// tone, and whether the `now` label sits over it; a row with no bar
// (an unknown window length) has a dial instead.
const readUsageCard = (s) =>
  s.evalJs(
    `(() => { const c = document.querySelector('.usage-popover'); if (!c) return null; return { current: c.dataset.key, rows: [...c.querySelectorAll('.usage-card-row')].map((r) => { const b = r.querySelector('.usage-bar'); return { key: r.dataset.key, current: 'current' in r.dataset, name: r.querySelector('.usage-card-name').textContent, percent: r.querySelector('.usage-card-percent').textContent, dial: r.querySelector('.usage-meter')?.style.getPropertyValue('--pct') ?? null, fill: b ? b.querySelector('.usage-bar-fill').style.width : null, mark: b ? b.querySelector('.usage-bar-mark').style.left : null, ticks: b ? Number(b.dataset.ticks) : null, tone: b ? b.dataset.tone : null, ceiling: b && b.querySelector('.usage-bar-ceiling') ? b.querySelector('.usage-bar-ceiling').style.left : null, now: r.querySelector('.usage-bar-now')?.textContent ?? null, when: r.querySelector('.usage-card-when').textContent, pace: r.querySelector('.usage-card-pace')?.textContent ?? null, short: r.querySelector('.usage-card-pace')?.dataset.short !== undefined, advice: r.querySelector('.usage-card-advice')?.textContent ?? null }; }), note: c.querySelector('.usage-card-note').textContent }; })()`,
  );
// The strip's bars, one per window with a known length: the model's
// numbers off the style and data attributes, and the drawn geometry.
const stripBars = (s) =>
  s.evalJs(
    `[...document.querySelectorAll('.usage-strip .usage-window')].map((w) => { const b = w.querySelector('.usage-bar'); if (!b) return { key: w.dataset.key, bar: false, dial: w.querySelector('.usage-meter')?.style.getPropertyValue('--pct') ?? null }; const r = b.getBoundingClientRect(); const f = b.querySelector('.usage-bar-fill').getBoundingClientRect(); const m = b.querySelector('.usage-bar-mark').getBoundingClientRect(); return { key: w.dataset.key, bar: true, width: r.width, height: r.height, fill: parseFloat(b.querySelector('.usage-bar-fill').style.width), fillPx: f.width, mark: parseFloat(b.querySelector('.usage-bar-mark').style.left), markPx: m.left - r.left, markTop: m.top - r.top, markHeight: m.height, ticks: Number(b.dataset.ticks), tick: b.style.getPropertyValue('--tick'), tone: b.dataset.tone, fillColour: getComputedStyle(b.querySelector('.usage-bar-fill')).backgroundColor, textColour: getComputedStyle(w.querySelector('.usage-text')).color, ceiling: b.querySelector('.usage-bar-ceiling') === null ? null : parseFloat(b.querySelector('.usage-bar-ceiling').style.left), ceilingColour: b.querySelector('.usage-bar-ceiling') === null ? null : getComputedStyle(b.querySelector('.usage-bar-ceiling')).backgroundColor }; })`,
  );
// M9 fix 440: the strip's drawn bar geometry, off its own need and the
// box (UsageStrip.tsx does the same arithmetic): the model's 44px
// constant in the row forms, and the box's spare above that once the
// column form is picked (it has room at the very first reading, on this
// window's default sidebar), with the height and the mark's overhang
// that follow from it. Read fresh at each fixture, since a window's own
// text moves the column's need reply to reply.
const strip440Geometry = (s) =>
  s.evalJs(
    `(() => { const strip = document.querySelector('.usage-strip'); const fit = strip.querySelector('.usage-fit').getBoundingClientRect(); const needs = strip.dataset.needs.split(',').map(Number); const forms = ['', 'runway', 'column', 'column-runway']; const i = forms.indexOf(strip.dataset.stack); const column = i >= 2; const px = column ? Math.max(44, fit.width - needs[i] + 44) : 44; const tall = px >= 88; return { px, tall, height: tall ? 8 : 6, markHeight: (tall ? 8 : 6) + 2 }; })()`,
  );
// The tick coarsening paceBar (usage-model.ts) does, so a grown bar's
// tick can be read against the window's own length rather than the
// literal that only held at the model's 44px constant.
const tickUnitFor = (key, lengthMs) => (key === 'five_hour' ? HOUR / lengthMs : key === 'one_day' ? (6 * HOUR) / lengthMs : DAY / lengthMs);
const expectedTick = (key, lengthMs, widthPx) => {
  let step = tickUnitFor(key, lengthMs);
  while (widthPx * step < 8 && step < 1) step *= 2;
  const tick = step >= 1 ? null : step;
  const ticks = tick === null ? 0 : Math.ceil(1 / tick - 1e-9) - 1;
  return { tick: tick === null ? null : `${(tick * 100).toFixed(4)}%`, ticks };
};
// M9 fix 324: the long texts in the column form, one entry per window
// whose text carries the runway: where its reset, join, runway, bar and
// the box's right edge sit.
const readLongColumn = (s) =>
  s.evalJs(
    `[...document.querySelectorAll('.usage-strip .usage-window')].filter((w) => w.querySelector('.usage-runway')).map((w) => { const rest = w.querySelector('.usage-rest').getBoundingClientRect(); const run = w.querySelector('.usage-runway').getBoundingClientRect(); const bar = w.querySelector('.usage-bar').getBoundingClientRect(); const fit = document.querySelector('.usage-fit').getBoundingClientRect(); return { key: w.dataset.key, textDisplay: getComputedStyle(w.querySelector('.usage-text')).display, joinDisplay: getComputedStyle(w.querySelector('.usage-join')).display, restLeft: rest.left, restTop: rest.top, restBottom: rest.bottom, runwayLeft: run.left, runwayTop: run.top, runwayRight: run.right, barTop: bar.top, barBottom: bar.bottom, fitRight: fit.right }; })`,
  );
// The width a window's text takes on one line, off a clone set inline
// (the column form hides the join and spreads the text), and its label's
// width, for the long form's breakpoints.
const textWidth = (s, key) =>
  s.evalJs(
    `(() => { const strip = document.querySelector('.usage-strip'); const c = strip.querySelector('.usage-window[data-key=' + JSON.stringify(${JSON.stringify(key)}) + '] .usage-text').cloneNode(true); c.style.cssText = 'display: inline-block; position: absolute; visibility: hidden; white-space: nowrap; width: max-content;'; for (const k of c.querySelectorAll('span')) k.style.display = 'inline'; strip.append(c); const w = c.getBoundingClientRect().width; c.remove(); return w; })()`,
  );
const labelWidth = (s, key) => s.evalJs(`document.querySelector('.usage-window[data-key=' + JSON.stringify(${JSON.stringify(key)}) + '] .usage-label').getBoundingClientRect().width`);
// A token's computed colour, for the tone reads.
const tokenColour = (s, name) => s.evalJs(`(() => { const p = document.createElement('span'); p.style.color = 'var(${name})'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })()`);
// M9 fix 307: the card sits off the hovered window's rect, above it
// since the strip is at the sidebar's bottom, its left edge at the
// window's; in the stacked form the anchor is display: contents, so its
// rect is the union of its children's (PopoverAnchor's anchorRect).
const cardPlacement = async (s, key, form) => {
  const p = await s.evalJs(`(() => {
    const w = document.querySelector('.usage-window[data-key=' + JSON.stringify(${JSON.stringify(key)}) + ']');
    const kids = [...w.children].map((k) => k.getBoundingClientRect());
    const left = Math.min(...kids.map((k) => k.left)); const top = Math.min(...kids.map((k) => k.top));
    const c = document.querySelector('.usage-popover').getBoundingClientRect();
    return { own: w.getBoundingClientRect().width, left, top, cardLeft: c.left, cardBottom: c.bottom, cardTop: c.top };
  })()`);
  expect(p.cardBottom <= p.top && p.cardBottom >= p.top - 6, `fix 307 (${form}): the card sits just above the hovered ${key} window, got ${JSON.stringify(p)}`);
  expect(Math.abs(p.cardLeft - p.left) <= 1, `fix 307 (${form}): the card's left edge is the window's, got ${JSON.stringify(p)}`);
  return p;
};
// The mouse leaves to a point above the card, in the sidebar's empty
// middle, since the card sits above the strip now (fix 307).
const leaveUsageCard = async (s) => {
  const top = await s.evalJs(`document.querySelector('.usage-popover')?.getBoundingClientRect().top ?? 420`);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: Math.max(40, top - 20) });
  await s.waitFor(`!document.querySelector('.usage-popover')`, 'the usage card closes once the mouse leaves');
};
const clickRefresh = (s) => s.evalJs(`document.querySelector('.usage-refresh').click()`);
const waitState = (s, state, why) => s.waitFor(`document.querySelector('.usage-strip')?.dataset.state === ${JSON.stringify(state)}`, why, 5000);
// M9 fix 347: the strip measures its form. data-stack is the form on
// (STRIP_FORMS, in the order the fit tries them) and data-needs the
// four needs in px, ceilinged; the box is .usage-fit. stripFit reads
// both with the drawn geometry: the width the windows take (the
// leftmost to the rightmost visible piece under .usage-windows, dots
// included), every window's bar and text positions, and the dots'
// display. expectedForm is the fit's rule, the first need at or under
// the box, so a step can say which form a width should give without a
// constant; checkForm reads a form's geometry: a row form shares a
// line with the dots shown, a column form stacks flush with the dots
// gone, a form with the runways under puts each runway on the line
// under its reset, flush, the join hidden, the other two keep it on
// the line after the join, and every text ends inside the box. Fix 62,
// 68 and 324 had breakpoint constants here, measured on the box's
// rendering of one day and broken by the next (287 and 446 for the
// plain windows, 280, 538 and 818 for the long form).
const STRIP_FORMS = ['', 'runway', 'column', 'column-runway'];
// The pieces drawn under .usage-windows, as rects: the dots, the bars
// and the dials by their boxes, the texts by their contents (a Range
// over a span's text, since in the column forms the text spans are
// grid items stretched to the text column's width, and in the stacked
// forms a hidden join has no box at all), the empty ones dropped.
const PIECES_JS = `const textRect = (el) => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect(); }; const pieces = []; for (const w of strip.querySelectorAll('.usage-window')) { pieces.push(textRect(w.querySelector('.usage-label')), w.querySelector('.usage-bar, .usage-meter').getBoundingClientRect()); const rest = w.querySelector('.usage-rest'); pieces.push(textRect(rest ?? w.querySelector('.usage-text'))); for (const sel of ['.usage-join', '.usage-runway']) { const el = w.querySelector(sel); if (el !== null) pieces.push(textRect(el)); } } for (const d of strip.querySelectorAll('.usage-dot')) pieces.push(d.getBoundingClientRect()); const drawnPieces = pieces.filter((r) => r.width > 0); const drawn = drawnPieces.length === 0 ? 0 : Math.max(...drawnPieces.map((r) => r.right)) - Math.min(...drawnPieces.map((r) => r.left));`;
const stripFit = (s) =>
  s.evalJs(
    `(() => { const strip = document.querySelector('.usage-strip'); const fit = strip.querySelector('.usage-fit').getBoundingClientRect(); ${PIECES_JS} const windows = [...strip.querySelectorAll('.usage-window')].map((w) => { const bar = w.querySelector('.usage-bar, .usage-meter').getBoundingClientRect(); const text = w.querySelector('.usage-text'); const rest = w.querySelector('.usage-rest'); const run = w.querySelector('.usage-runway'); const join = w.querySelector('.usage-join'); const t = textRect(rest ?? text); const r = run === null ? null : textRect(run); return { key: w.dataset.key, barLeft: bar.left, barTop: bar.top, restLeft: t.left, restTop: t.top, restBottom: t.bottom, textRight: t.right, runway: r === null ? null : { left: r.left, top: r.top, right: r.right }, joinDisplay: join === null ? null : getComputedStyle(join).display, textDisplay: getComputedStyle(text).display }; }); return { stack: strip.dataset.stack, needs: strip.dataset.needs.split(',').map(Number), fitWidth: fit.width, fitRight: fit.right, drawn, dots: [...strip.querySelectorAll('.usage-dot')].map((d) => getComputedStyle(d).display), sidebarWidth: document.querySelector('.sidebar').getBoundingClientRect().width, windows }; })()`,
  );
const expectedForm = (r) => STRIP_FORMS.find((f, i) => r.needs[i] <= r.fitWidth) ?? 'column-runway';
const formName = (f) => (f === '' ? 'row' : f);
const checkForm = (r, form, why) => {
  const w = r.windows;
  expect(r.stack === form, `${why}: the ${formName(form)} form, got ${JSON.stringify(r.stack)} (needs ${r.needs.join(',')}, box ${r.fitWidth.toFixed(1)})`);
  const row = form === '' || form === 'runway';
  const oneLine = w.every((x) => x.barTop === w[0].barTop);
  const flush = w.every((x) => x.barLeft === w[0].barLeft) && w.every((x, i) => i === 0 || x.barTop > w[i - 1].barTop);
  expect(row ? oneLine : flush, `${why}: the bars ${row ? 'share a line' : 'stack flush'} in the ${formName(form)} form, got ${JSON.stringify(w.map((x) => [x.barLeft, x.barTop]))}`);
  expect(r.dots.every((d) => (row ? d !== 'none' : d === 'none')), `${why}: the dots are ${row ? 'shown' : 'gone'}, got ${r.dots.join(',')}`);
  const under = form === 'runway' || form === 'column-runway';
  for (const x of w.filter((x) => x.runway !== null)) {
    if (under) expect(x.joinDisplay === 'none' && x.textDisplay === 'contents' && x.runway.left === x.restLeft && x.runway.top >= x.restBottom - 1, `${why}: the ${x.key} runway sits under its reset, flush, the join hidden, got ${JSON.stringify(x)}`);
    else expect(x.joinDisplay === 'inline' && x.runway.top < x.restBottom && x.runway.left > x.restLeft, `${why}: the ${x.key} runway follows its reset on the line, got ${JSON.stringify(x)}`);
  }
  const right = Math.max(...w.map((x) => Math.max(x.textRight, x.runway?.right ?? 0)));
  expect(right <= r.fitRight + 0.5, `${why}: every text ends inside the box (${right.toFixed(1)} vs ${r.fitRight.toFixed(1)})`);
  // The drawn width is the form's need: the row's line, or the column's
  // widest line, to a pixel. M9 fix 440: in the column forms the bar
  // grows into the box, so the drawn row is the box itself now, not the
  // old need (still 44px there, since STRIP_BAR_PX stays what fitForm
  // picks a form on); the row forms are unaffected, the bar stays 44.
  const need = r.needs[STRIP_FORMS.indexOf(form)];
  const column = form === 'column' || form === 'column-runway';
  const expectedDrawn = column ? r.fitWidth : need;
  expect(Math.abs(r.drawn - expectedDrawn) <= 1.5, `${why}: the ${formName(form)} form draws ${column ? 'the box' : 'its need'}, ${r.drawn.toFixed(1)}px against ${expectedDrawn.toFixed(1)}`);
};

const s = await launch(freshPort(), { freshState: true });
app = s;
try {
  await s.waitFor(`!!document.querySelector('.sidebar-footer .usage-strip')`, 'the strip in the sidebar footer');
  await waitState(s, 'ok', 'the first fetch');
  const errorColour = await tokenColour(s, '--error');
  const workingColour = await tokenColour(s, '--working');
  const mutedColour = await tokenColour(s, '--muted');
  const first = await segments(s);
  expect(first.join(',') === 'five_hour=5h resets 41m,seven_day=7d resets 6d 16h,seven_day_fable=Fable resets 6d 16h', `three segments, each led by its window (fix 61), the percent gone to the bar (fix 308): ${first.join(',')}`);
  expect(requests.length >= 1, 'the stub was asked');
  expect(requests[0].authorization === `Bearer ${TOKEN}`, `the token went out as a Bearer: ${requests[0].authorization}`);
  expect(requests[0].beta === 'oauth-2025-04-20', `the oauth beta header: ${requests[0].beta}`);
  expect(requests[0].url === '/api/oauth/usage', `the path: ${requests[0].url}`);
  // M9 fix 308: the bars follow the percents (the dial's --pct of fix 44
  // is the fill's width now); no meter on a window with a bar. M9 fix
  // 440: the column form has room at the default sidebar, so the bars
  // draw past the model's 44px need; strip440Geometry reads what they
  // should be off the strip's own arithmetic rather than a literal.
  const firstBars = await stripBars(s);
  expect(firstBars.map((b) => b.fill).join(',') === '17,5,8' && firstBars.every((b) => b.bar), `the bars' fills follow the percents: ${JSON.stringify(firstBars.map((b) => [b.key, b.fill]))}`);
  const firstGeo = await strip440Geometry(s);
  // The tolerance is 1.5px, not 1: data-needs is ceiling'd for the
  // verify script (UsageStrip.tsx), so strip440Geometry's estimate off
  // that ceiling can read under a pixel short of the true drawn width.
  expect(firstBars.every((b) => Math.abs(b.width - firstGeo.px) <= 1.5 && b.height === firstGeo.height), `fix 308/440: ${firstGeo.px.toFixed(1)} by ${firstGeo.height} px bars on the strip, got ${JSON.stringify(firstBars.map((b) => [b.width, b.height]))}`);
  expect((await s.evalJs(`document.querySelectorAll('.usage-strip .usage-meter').length`)) === 0, 'no dial on a window with a bar');
  // M9 fix 66: the bar sits between the window's name and the text.
  const order = await s.evalJs(`[...document.querySelectorAll('.usage-window')].map((w) => { const k = [...w.children]; return k.indexOf(w.querySelector('.usage-bar')) === k.indexOf(w.querySelector('.usage-label')) + 1 && k.indexOf(w.querySelector('.usage-text')) === k.indexOf(w.querySelector('.usage-bar')) + 1; })`);
  expect(order.length === 3 && order.every(Boolean), `fix 66: the bar sits between the name and the text in every window, got ${JSON.stringify(order)}`);
  expect((await s.evalJs(`[...document.querySelectorAll('.usage-window')].every(w => w.getAttribute('title') === null)`)), 'no segment carries a title tooltip; the card is the tooltip (M73)');
  const segAt = await hoverSegment(s, 'five_hour');
  const stackedPlace = await cardPlacement(s, 'five_hour', 'stacked');
  expect(stackedPlace.own === 0, `fix 307: the stacked anchor's own rect is empty, so the union is what placed it (${stackedPlace.own})`);
  const card = await readUsageCard(s);
  expect(card.current === 'five_hour' && card.rows.length === 3 && card.rows[0].current && !card.rows[1].current, `the card marks the hovered window among the three, got ${JSON.stringify(card.rows.map((r) => [r.key, r.current]))}`);
  expect(card.rows[0].name === '5 hour window' && card.rows[0].percent === '17% used' && card.rows[0].dial === null && card.rows[0].fill === '17%' && /^resets \w+ \d+:\d\d [AP]M, in 41m$/.test(card.rows[0].when), `the five hour row names the window with its percent, its bar's fill and the reset, clock time first (fix 308), got ${JSON.stringify(card.rows[0])}`);
  expect(card.rows[0].now === 'now' && card.rows[1].now === null && card.rows[2].now === null, `fix 308: only the hovered row labels its mark now, got ${JSON.stringify(card.rows.map((r) => r.now))}`);
  expect(card.rows[2].name === 'Fable 7 day window' && card.rows[2].percent === '8% used', `the model row: ${JSON.stringify(card.rows[2])}`);
  // The mark: 41 minutes left of five hours is 86.3% of the window gone; 6d 16h 20m left of seven days is 4.6%.
  // The five hour mark moves a tenth every 18 seconds, so a read some
  // seconds after the stub's timestamp is allowed a tenth either way (it
  // read 86.4% once under the batch 145 close-out).
  const barNear = (text, want) => Math.abs(parseFloat(text) - want) <= 0.15;
  expect(barNear(card.rows[0].mark, 86.3) && barNear(card.rows[2].mark, 4.6), `the marks show how far through each window the reset is, got ${JSON.stringify(card.rows.map((r) => r.mark))}`);
  // M9 fix 295: the five-hour row says where its average pace lands (17
  // over 86% of the window is about 20 at the reset), the seven-day row
  // in its first tenth says nothing, and no bar is in the error tone.
  expect(card.rows[0].pace === 'about 20% at the reset' && !card.rows[0].short, `fix 295: the five-hour row's runway at the reset line's right (fix 308), got ${JSON.stringify(card.rows[0].pace)}`);
  expect(card.rows[1].pace === null, `fix 295: no runway on a window in its first tenth, got ${JSON.stringify(card.rows[1].pace)}`);
  expect(firstBars.every((b) => b.tone === 'working'), 'fix 295: no bar is in the error tone at the first reading');
  // M9 fix 324: under HIGH_PERCENT and behind the pace the text is muted
  // in the working tone with no runway, and the strip is not long.
  const firstTones = await s.evalJs(`[...document.querySelectorAll('.usage-window .usage-text')].map((t) => t.dataset.tone ?? null)`);
  expect(firstTones.every((t) => t === 'working') && firstBars.every((b) => b.textColour === mutedColour), `fix 324: every text is in the working tone and muted at the first reading, got ${JSON.stringify([firstTones, firstBars.map((b) => b.textColour)])}`);
  expect((await s.evalJs(`document.querySelectorAll('.usage-runway').length === 0 && document.querySelector('.usage-strip').dataset.stack === 'column'`)), 'fix 324: no runway on the strip at the first reading, and the form is the column (fix 347)');
  expect(/^From the usage endpoint Claude Code's \/usage reads/.test(card.note) && /asked at \d/.test(card.note), `the note says where the numbers come from and when they were asked for, got ${JSON.stringify(card.note)}`);
  await s.click(segAt.x, segAt.y);
  await s.waitFor(`document.querySelector('.usage-window[data-key="five_hour"]').dataset.popoverOpen === 'pinned'`, 'a click pins the card');
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: Math.max(40, stackedPlace.cardTop - 20) });
  await sleep(400);
  expect((await readUsageCard(s)) !== null, 'a pinned card stays when the mouse leaves');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.usage-popover')`, 'Escape closes the card');
  await s.screenshot('m15-usage.png');
  step('the strip shows the three windows with a bar, countdown and the model name; M73 task 2: a segment opens the usage card with a row per window, its bar and note, pinned by a click, closed by Escape, no title on the segments');

  // M9 fix 308: the board's three readings (docs/design/pace-bars.md):
  // 5h 40% used with an hour left (80% elapsed, behind, amber), 7d 63%
  // used with 3d 19h left (46% elapsed, ahead, 100 before the reset,
  // red), Opus 7d 95% used with 20h 10m left (red on the percent). The
  // geometry to a pixel, the tick counts, the tones, the card's bars.
  const boardReset = at(3 * DAY + 19 * HOUR);
  reply = { status: 200, body: { five_hour: { utilization: 40, resets_at: at(HOUR) }, seven_day: { utilization: 63, resets_at: boardReset }, seven_day_opus: { utilization: 95, resets_at: at(20 * HOUR + 10 * MIN) } } };
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-window[data-key="five_hour"] .usage-text')?.textContent === 'resets 1h 0m'`, 'the board reply', 5000);
  const boardBars = await stripBars(s);
  const [five, week, opus] = boardBars;
  // M9 fix 440: the board fixture's own column need leaves the strip its
  // own room too, so the pixel geometry below reads off the drawn bar
  // (boardGeo.px), not the model's 44px constant; the percents (fill,
  // mark) are unaffected, since paceBar reads those off the window, not
  // the width.
  const boardGeo = await strip440Geometry(s);
  // The tolerance is 1.5px, not 1: data-needs is ceiling'd for the
  // verify script, so strip440Geometry's estimate off that ceiling can
  // read under a pixel short of the true drawn width.
  expect(five.key === 'five_hour' && five.fill === 40 && Math.abs(five.fillPx - boardGeo.px * 0.4) <= 1.5 && Math.abs(five.mark - 80) <= 0.2 && Math.abs(five.markPx - boardGeo.px * 0.8) <= 1.5, `fix 308/440 geometry: the five hour bar (${boardGeo.px.toFixed(1)}px) fills 40% with the mark at 80%, got ${JSON.stringify(five)}`);
  expect(five.markTop === -1 && five.markHeight === boardGeo.markHeight, `fix 308/440: the mark overhangs the ${boardGeo.height}px bar by a pixel each end, got ${JSON.stringify([five.markTop, five.markHeight])}`);
  const fiveTick = expectedTick('five_hour', 5 * HOUR, boardGeo.px);
  expect(five.ticks === fiveTick.ticks && five.tick === fiveTick.tick, `fix 308/440 ticks: the five hour bar's own ticks at ${boardGeo.px.toFixed(1)}px, got ${JSON.stringify([five.ticks, five.tick])} against ${JSON.stringify(fiveTick)}`);
  expect(week.key === 'seven_day' && week.fill === 63 && Math.abs(week.mark - 45.8) <= 0.2 && Math.abs(week.markPx - boardGeo.px * (week.mark / 100)) <= 1.5, `fix 308/440 geometry: the week (${boardGeo.px.toFixed(1)}px) fills 63% with the mark at 46%, got ${JSON.stringify(week)}`);
  const weekTick = expectedTick('seven_day', 7 * DAY, boardGeo.px);
  expect(week.ticks === weekTick.ticks && week.tick === weekTick.tick, `fix 308/440 ticks: the strip's week own ticks at ${boardGeo.px.toFixed(1)}px, got ${JSON.stringify([week.ticks, week.tick])} against ${JSON.stringify(weekTick)}`);
  expect(opus.key === 'seven_day_opus' && opus.fill === 95 && Math.abs(opus.mark - 88) <= 0.2 && opus.ticks === weekTick.ticks, `fix 308/440 geometry: the Opus week at 95 with the mark at 88, got ${JSON.stringify(opus)}`);
  expect(five.tone === 'working' && five.fillColour === workingColour && five.textColour === mutedColour, `fix 308 tone: behind the pace is --working on the fill and --muted on the text (fix 324), got ${JSON.stringify([five.tone, five.fillColour, workingColour, five.textColour])}`);
  expect(week.tone === 'error' && week.fillColour === errorColour && week.textColour === errorColour, `fix 308 tone: a pace that runs out before the reset is --error on the fill and, since fix 324, on the text, got ${JSON.stringify([week.tone, week.fillColour, week.textColour])}`);
  expect(opus.tone === 'error' && opus.fillColour === errorColour && opus.textColour === errorColour, `fix 308 tone: ninety and over is --error, on the text too (fix 324), got ${JSON.stringify([opus.tone, opus.fillColour, opus.textColour])}`);
  // M9 fix 347: the ceiling, where the pace hits 100 on the span, on the
  // bars whose runway is short: the week's at its elapsed share over its
  // fill (45.8 / 63, 72.7%), Opus's at 88 / 95 (92.6%), in the error
  // colour; none on the five hour bar, whose pace lands past the reset.
  expect(five.ceiling === null && week.ceiling !== null && Math.abs(week.ceiling - 72.7) <= 0.3 && week.ceilingColour === errorColour && opus.ceiling !== null && Math.abs(opus.ceiling - 92.6) <= 0.3, `fix 347: the ceiling marks sit where each short pace hits 100, none on the five hour bar, got ${JSON.stringify(boardBars.map((b) => [b.key, b.ceiling, b.ceilingColour]))}`);
  // M9 fix 324: in the error tone the text carries the runway after a
  // dot (the week runs out in 1d 21h, the Opus week in 7h 47m, a minute's
  // tolerance for the read), the five hour text stays the reset alone,
  // and the strip says it is long. In the column form (the sidebar is at
  // its 260 default) the runway is a line of its own under the reset,
  // flush with it, its join hidden, ending inside the box; the label and
  // the bar keep to the reset's line.
  const boardTexts = await s.evalJs(`[...document.querySelectorAll('.usage-window')].map((w) => [w.dataset.key, w.querySelector('.usage-text').dataset.tone ?? null, w.querySelector('.usage-text').textContent])`);
  expect(boardTexts[0][1] === 'working' && boardTexts[0][2] === 'resets 1h 0m', `fix 324: the five hour text is the reset alone in the working tone, got ${JSON.stringify(boardTexts[0])}`);
  expect(boardTexts[1][1] === 'error' && /^resets 3d 19h · 100% in 1d 2[01]h$/.test(boardTexts[1][2]), `fix 324: the week's text carries the runway after the dot in the error tone, got ${JSON.stringify(boardTexts[1])}`);
  expect(boardTexts[2][1] === 'error' && /^resets 20h (10|9)m · 100% in 7h 4[0-9]m$/.test(boardTexts[2][2]), `fix 324: the Opus week's text carries the runway after the dot, got ${JSON.stringify(boardTexts[2])}`);
  expect((await s.evalJs(`document.querySelector('.usage-strip').dataset.stack`)) === 'column-runway', 'fix 324: the strip is the column with the runways under (fix 347) while a text carries the runway at the default sidebar');
  const boardColumn = await readLongColumn(s);
  expect(boardColumn.length === 2 && boardColumn.every((c) => c.key !== 'five_hour' && c.joinDisplay === 'none' && c.runwayLeft === c.restLeft && c.runwayTop >= c.restBottom - 1 && c.runwayRight <= c.fitRight + 0.5 && c.barTop >= c.restTop && c.barBottom <= c.restBottom), `fix 324: in the column the runway is a line of its own under the reset, flush, the join hidden, inside the box, the bar on the reset's line, got ${JSON.stringify(boardColumn)}`);
  await hoverSegment(s, 'seven_day');
  const boardCard = await readUsageCard(s);
  const cardGeometry = await s.evalJs(`[...document.querySelectorAll('.usage-popover .usage-bar')].map((b) => { const r = b.getBoundingClientRect(); const m = b.querySelector('.usage-bar-mark').getBoundingClientRect(); const f = b.querySelector('.usage-bar-fill').getBoundingClientRect(); return { width: r.width, height: r.height, fillPx: f.width, markPx: m.left - r.left, markTop: m.top - r.top, markHeight: m.height }; })`);
  expect(cardGeometry.length === 3 && cardGeometry.every((g) => g.width === 258 && g.height === 10 && g.markTop === -2 && g.markHeight === 14), `fix 308: the card's bars are 258 by 10 px with the mark two pixels over each end, got ${JSON.stringify(cardGeometry)}`);
  expect(Math.abs(cardGeometry[1].fillPx - 258 * 0.63) <= 1 && Math.abs(cardGeometry[1].markPx - 258 * 0.458) <= 1.5, `fix 308: the card's week fills 163px with the mark at 118px, got ${JSON.stringify(cardGeometry[1])}`);
  expect(boardCard.rows.map((r) => r.ticks).join(',') === '4,6,6', `fix 308: the card's bars tick every hour and every day, got ${JSON.stringify(boardCard.rows.map((r) => r.ticks))}`);
  expect(boardCard.rows[1].current && boardCard.rows[1].now === 'now' && boardCard.rows[0].now === null && boardCard.rows[2].now === null, `fix 308: the hovered week labels its mark, got ${JSON.stringify(boardCard.rows.map((r) => r.now))}`);
  const nowAt = await s.evalJs(`(() => { const n = document.querySelector('.usage-popover .usage-bar-now').getBoundingClientRect(); const b = document.querySelector('.usage-popover .usage-card-row[data-current] .usage-bar').getBoundingClientRect(); const m = document.querySelector('.usage-popover .usage-card-row[data-current] .usage-bar-mark').getBoundingClientRect(); return { centre: n.left + n.width / 2 - b.left, mark: m.left - b.left, above: n.bottom <= b.top }; })()`);
  expect(Math.abs(nowAt.centre - nowAt.mark) <= 1 && nowAt.above, `fix 308: now is centred on the mark, above the bar, got ${JSON.stringify(nowAt)}`);
  expect(boardCard.rows[0].percent === '40% used' && boardCard.rows[0].pace === 'about 50% at the reset' && !boardCard.rows[0].short, `fix 308: the five hour row's percent beside its name and its runway at the reset line's right, got ${JSON.stringify(boardCard.rows[0])}`);
  expect(/^resets \w+ \d+:\d\d [AP]M, in 3d 19h$/.test(boardCard.rows[1].when) && /^100% in 1d 2[01]h$/.test(boardCard.rows[1].pace ?? '') && boardCard.rows[1].short && boardCard.rows[1].tone === 'error', `fix 308: the week's reset line reads clock time then countdown, and 100% in 1d 21h at its right, got ${JSON.stringify(boardCard.rows[1])}`);
  const paceColour = await s.evalJs(`getComputedStyle(document.querySelector('.usage-popover .usage-card-row[data-key="seven_day"] .usage-card-pace')).color`);
  expect(paceColour === errorColour, `fix 308: the short runway's words are --error, got ${paceColour}`);
  expect((await s.evalJs(`document.querySelectorAll('.usage-popover .usage-card-track, .usage-popover .usage-card-elapsed, .usage-popover .usage-meter').length`)) === 0, 'fix 308: no elapsed track and no dial on the card');
  await s.screenshot('fix-308-card.png');
  await leaveUsageCard(s);
  await s.screenshot('fix-308-strip.png');
  step('M9 fix 308: the board\'s three readings draw to the pixel on the strip and the card, ticks at the window\'s unit, tones by the runway, now over the hovered row\'s mark');

  // M9 fix 308, the states. No pace yet: 7d at 3% with 6d 14h left is
  // under five percent and in its first tenth, so the bar, the fill, the
  // ticks and the mark all draw and only the runway is absent. Pinned at
  // 100: the fill is the whole bar in --error, the mark stays where now
  // is, and the words are spent until the reset. An unknown window
  // length: no bar on that row, the dial and the full text instead, on
  // the strip and the card.
  reply = { status: 200, body: { five_hour: { utilization: 1, resets_at: at(4 * HOUR + 48 * MIN) }, seven_day: { utilization: 3, resets_at: at(6 * DAY + 14 * HOUR) } } };
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-window[data-key="seven_day"] .usage-text')?.textContent === 'resets 6d 14h'`, 'the no-pace reply', 5000);
  const earlyBars = await stripBars(s);
  const earlyTick = expectedTick('seven_day', 7 * DAY, (await strip440Geometry(s)).px);
  expect(earlyBars[1].fill === 3 && Math.abs(earlyBars[1].mark - 6) <= 0.2 && earlyBars[1].ticks === earlyTick.ticks && earlyBars[1].tone === 'working', `fix 308/440 no pace yet: the bar, the mark at 6% and the ticks draw, amber, got ${JSON.stringify(earlyBars[1])} against ${JSON.stringify(earlyTick)}`);
  await hoverSegment(s, 'seven_day');
  const earlyCard = await readUsageCard(s);
  expect(earlyCard.rows[1].mark !== null && earlyCard.rows[1].now === 'now' && earlyCard.rows[1].pace === null && earlyCard.rows[0].pace === null, `fix 308 no pace yet: a mark and no runway text, got ${JSON.stringify(earlyCard.rows)}`);
  await leaveUsageCard(s);
  reply = { status: 200, body: { five_hour: { utilization: 40, resets_at: at(HOUR) }, seven_day: { utilization: 100, resets_at: at(2 * DAY + HOUR) } } };
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-window[data-key="seven_day"] .usage-text')?.textContent === 'resets 2d 1h · spent until the reset'`, 'the pinned reply (fix 324: spent on the strip too)', 5000);
  const pinnedBars = await stripBars(s);
  // M9 fix 440: at 100% the fill is the whole bar, whatever the bar's
  // own drawn width (pinnedGeo.px) is once the column form has room.
  const pinnedGeo = await strip440Geometry(s);
  expect(pinnedBars[1].fill === 100 && Math.abs(pinnedBars[1].fillPx - pinnedGeo.px) <= 1.5 && pinnedBars[1].tone === 'error' && Math.abs(pinnedBars[1].mark - 70.8) <= 0.2, `fix 308/440 pinned: the fill is the whole ${pinnedGeo.px.toFixed(1)}px bar in --error with the mark at 71%, got ${JSON.stringify(pinnedBars[1])}`);
  await hoverSegment(s, 'seven_day');
  const pinnedCard = await readUsageCard(s);
  expect(pinnedCard.rows[1].fill === '100%' && pinnedCard.rows[1].pace === 'spent until the reset' && pinnedCard.rows[1].short, `fix 308 pinned: the card reads spent until the reset, got ${JSON.stringify(pinnedCard.rows[1])}`);
  await leaveUsageCard(s);
  reply = { status: 200, body: { five_hour: { utilization: 40, resets_at: at(HOUR) }, codex: { utilization: 57, resets_at: at(12 * HOUR + 5 * MIN) } } };
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-window[data-key="codex"] .usage-text')?.textContent === '57%, resets 12h 5m'`, 'the unknown-length reply', 5000);
  const unknownBars = await stripBars(s);
  expect(unknownBars[0].bar && !unknownBars[1].bar && unknownBars[1].dial === '57%', `fix 308 unknown length: no bar on the codex row, a dial at 57, got ${JSON.stringify(unknownBars)}`);
  // M9 fix 44: the dial that survives is the 10px conic one.
  const dial = await s.evalJs(
    `(() => { const m = document.querySelector('.usage-strip .usage-meter'); const c = getComputedStyle(m); const r = m.getBoundingClientRect(); return { w: r.width, h: r.height, radius: c.borderRadius, bg: c.backgroundImage, high: m.dataset.high ?? null }; })()`,
  );
  expect(dial.w === 10 && dial.h === 10 && dial.radius === '50%' && dial.bg.startsWith('conic-gradient(') && dial.high === null, `a 10px round dial with a conic wedge on the window with no bar, got ${JSON.stringify(dial)}`);
  await hoverSegment(s, 'codex');
  const unknownCard = await readUsageCard(s);
  expect(unknownCard.rows[1].key === 'codex' && unknownCard.rows[1].fill === null && unknownCard.rows[1].dial === '57%' && unknownCard.rows[1].now === null && unknownCard.rows[1].pace === null && /^resets \w+ \d+:\d\d [AP]M, in 12h 5m$/.test(unknownCard.rows[1].when), `fix 308 unknown length: the card's row keeps the dial and no bar, got ${JSON.stringify(unknownCard.rows[1])}`);
  await leaveUsageCard(s);
  // Back to the first reading for the steps below.
  reply = { status: 200, body: { five_hour: { utilization: 17, resets_at: at(41 * MIN) }, seven_day: { utilization: 5, resets_at: firstWeeklyReset }, seven_day_fable: { utilization: 8, resets_at: firstWeeklyReset }, limits: liveLimits(7, firstWeeklyReset) } };
  await clickRefresh(s);
  await s.waitFor(`document.querySelectorAll('.usage-window').length === 3 && document.querySelector('.usage-window[data-key="five_hour"] .usage-text')?.textContent === 'resets 41m'`, 'the first reading again', 5000);
  step('M9 fix 308 states: no pace yet keeps the bar and the mark without a runway, pinned at 100 fills red and reads spent until the reset, an unknown length keeps the dial and the percent');

  // Fix 29: in the default 260px sidebar the strip is narrower than three
  // windows need, so the container query stacks them, meters flush and no
  // separator; at the widest sidebar they share one line with the dots.
  // The one-line width is printed so the three-window breakpoint in
  // style.css can be checked against what the seeded reply needs.
  const footer = () =>
    s.evalJs(`(() => {
      const strip = document.querySelector('.usage-strip');
      const fit = document.querySelector('.usage-fit').getBoundingClientRect();
      const meters = [...document.querySelectorAll('.usage-strip .usage-bar, .usage-strip .usage-meter')].map((m) => { const r = m.getBoundingClientRect(); return { left: r.left, top: r.top }; });
      const dots = [...document.querySelectorAll('.usage-dot')].map((d) => getComputedStyle(d).display);
      ${PIECES_JS}
      const lastWindow = document.querySelector('.usage-window:last-child')?.getBoundingClientRect() ?? null;
      return { stripWidth: strip.getBoundingClientRect().width, fitWidth: fit.width, fitRight: fit.right, lastRight: lastWindow === null ? null : lastWindow.right, sidebarWidth: document.querySelector('.sidebar').getBoundingClientRect().width,
        footerHeight: document.querySelector('.sidebar-footer').getBoundingClientRect().height, meters, dots, drawn, stack: document.querySelector('.usage-strip').dataset.stack, needs: document.querySelector('.usage-strip').dataset.needs.split(',').map(Number) };
    })()`);
  const narrow = await footer();
  expect(narrow.meters.length === 3, 'three meters');
  expect(narrow.stack === 'column' && narrow.needs[2] <= narrow.fitWidth && narrow.needs[0] > narrow.fitWidth, `fix 347: the column at ${narrow.sidebarWidth}px, its need inside the box and the row's past it, got ${narrow.stack} with needs ${narrow.needs.join(',')} in ${narrow.fitWidth.toFixed(1)}`);
  expect(narrow.meters.every((m) => m.left === narrow.meters[0].left), `the bars stack flush at ${narrow.sidebarWidth}px: ${narrow.meters.map((m) => m.left).join(',')}`);
  expect(narrow.meters.every((m, i) => i === 0 || m.top > narrow.meters[i - 1].top), 'one window per line');
  expect(narrow.dots.every((d) => d === 'none'), `no separator in the column: ${narrow.dots.join(',')}`);
  const resizer = await s.evalJs(`(() => { const r = document.querySelector('.sidebar-resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.mouse('mousePressed', resizer.x, resizer.y);
  await s.mouse('mouseReleased', resizer.x + 600, resizer.y);
  await s.waitFor(`document.querySelector('.sidebar').getBoundingClientRect().width >= 599`, 'sidebar at its widest');
  const wide = await footer();
  const oneLine = wide.drawn;
  expect(wide.meters.every((m) => m.top === wide.meters[0].top), 'one line at 600px');
  expect(wide.stack === '' && Math.abs(wide.needs[0] - oneLine) <= 1, `fix 347: the row at 600px, its need the drawn line's width, got ${wide.stack} with need ${wide.needs[0]} against ${oneLine.toFixed(1)} drawn`);
  expect(wide.dots.every((d) => d !== 'none'), 'the dots are back between the windows');
  expect(wide.meters.every((m, i) => i === 0 || m.left > wide.meters[i - 1].left), 'meters left to right');
  expect(Math.abs(wide.footerHeight - 30) <= 1, `the footer is 30px on one line, got ${wide.footerHeight}`);
  // M9 fix 307: in the row form the anchor has a rect of its own and the
  // card sits above it the same way.
  await hoverSegment(s, 'seven_day');
  const rowPlace = await cardPlacement(s, 'seven_day', 'row');
  expect(rowPlace.own > 0, `fix 307: the row-form anchor has a rect of its own (${rowPlace.own})`);
  await leaveUsageCard(s);
  console.log(`[verify] fix 29: the three windows need ${Math.ceil(oneLine)}px on one line; the strip is ${Math.round(narrow.stripWidth)}px at 260 and ${Math.round(wide.stripWidth)}px at 600`);
  await s.screenshot('m15-usage-wide.png');
  await s.mouse('mousePressed', resizer.x + 600 - 260, resizer.y);
  await s.mouse('mouseReleased', resizer.x, resizer.y);
  await s.waitFor(`Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - ${narrow.sidebarWidth}) <= 1`, 'sidebar back');
  step('fix 29: a column with flush bars and no dots in the 260px sidebar, one line with dots at 600px');

  // M9 fix 62: the fit is the window count's own, so a strip with two
  // windows stays on one line as long as two fit rather than stacking
  // at the width three need. M9 fix 347: the width is read off the
  // strip's own need rather than a constant: the sidebar is set so the
  // box is 20px over the two-window row's need, two windows are a row
  // there and three windows a column (their row's need past the box),
  // and at the narrowest the two are a column too.
  reply = { status: 200, body: { five_hour: { utilization: 17, resets_at: at(41 * MIN) }, seven_day: { utilization: 5, resets_at: at(6 * DAY + 16 * HOUR + 20 * MIN) } } };
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-strip')?.dataset.windows === '2' && document.querySelectorAll('.usage-window').length === 2`, 'two windows on the strip', 5000);
  const twoNarrow = await footer();
  const chrome = twoNarrow.sidebarWidth - twoNarrow.fitWidth;
  const betweenSidebar = Math.round(twoNarrow.needs[0] + 20 + chrome);
  await s.mouse('mousePressed', resizer.x, resizer.y);
  await s.mouse('mouseReleased', resizer.x + (betweenSidebar - twoNarrow.sidebarWidth), resizer.y);
  await s.waitFor(`Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - ${betweenSidebar}) <= 1`, `sidebar at ${betweenSidebar}px`);
  const twoBetween = await stripFit(s);
  expect(twoBetween.windows.length === 2, 'two windows');
  checkForm(twoBetween, '', `fix 62: two windows 20px over their row's need (${twoBetween.needs[0]}px) at ${betweenSidebar}px`);
  expect(twoNarrow.stack === 'column' && twoNarrow.needs[0] > twoNarrow.fitWidth && twoNarrow.meters.every((m) => m.left === twoNarrow.meters[0].left) && twoNarrow.meters[1].top > twoNarrow.meters[0].top, `a column at ${twoNarrow.sidebarWidth}px, the row's ${twoNarrow.needs[0]}px past the ${Math.round(twoNarrow.fitWidth)}px box: ${JSON.stringify(twoNarrow.meters)}`);
  console.log(`[verify] fix 62: the two windows need ${twoNarrow.needs[0]}px on one line; the windows box is ${Math.round(twoNarrow.fitWidth)}px at ${twoNarrow.sidebarWidth} and ${Math.round(twoBetween.fitWidth)}px at ${betweenSidebar}`);
  // Three windows at the same width stack, since the fit is the count's own.
  reply = { status: 200, body: { five_hour: { utilization: 17, resets_at: at(41 * MIN) }, seven_day: { utilization: 5, resets_at: at(6 * DAY + 16 * HOUR + 20 * MIN) }, seven_day_fable: { utilization: 8, resets_at: at(6 * DAY + 16 * HOUR + 20 * MIN) } } };
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-strip')?.dataset.windows === '3'`, 'three windows again', 5000);
  const threeBetween = await stripFit(s);
  expect(threeBetween.needs[0] > threeBetween.fitWidth, `fix 62: three windows need ${threeBetween.needs[0]}px on one line, past the ${Math.round(threeBetween.fitWidth)}px box`);
  checkForm(threeBetween, 'column', `fix 62: three windows at ${betweenSidebar}px`);
  await s.mouse('mousePressed', resizer.x + (betweenSidebar - twoNarrow.sidebarWidth), resizer.y);
  await s.mouse('mouseReleased', resizer.x, resizer.y);
  await s.waitFor(`Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - ${narrow.sidebarWidth}) <= 1`, 'sidebar back again');
  step('fix 62: two windows on one line 20px over their need, a column at the narrowest, three a column at the same width');

  // M9 fix 68: the fit counts the widest text a window can have, 100%
  // and a reset six days and 23 hours off, on the windows' own box (the
  // refresh button is outside it), so a row form never wraps: one pixel
  // over the row's need the windows are on one line and the last ends
  // inside the box; one pixel under it they stack. M9 fix 347: the need
  // is the strip's own (data-needs), checked against the drawn line at
  // 600px, so no constant here depends on the box's rendering; the
  // needs are printed for the record. The tooltip says "resets now"
  // once a reset has passed, not "resets in now".
  const widest = (n) => {
    const body = { five_hour: { utilization: 100, resets_at: at(6 * DAY + 23 * HOUR + 20 * MIN) }, seven_day: { utilization: 100, resets_at: at(6 * DAY + 23 * HOUR + 20 * MIN) } };
    if (n === 3) body.seven_day_fable = { utilization: 100, resets_at: at(6 * DAY + 23 * HOUR + 20 * MIN) };
    return { status: 200, body };
  };
  const sidebarTo = async (target, from) => {
    await s.mouse('mousePressed', resizer.x + (from - narrow.sidebarWidth), resizer.y);
    await s.mouse('mouseReleased', resizer.x + (target - narrow.sidebarWidth), resizer.y);
    await s.waitFor(`Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - ${target}) <= 1`, `sidebar at ${target}px`);
  };
  const needs = {};
  let at68 = narrow.sidebarWidth;
  // M9 fix 285: the usage lines the daemon has written so far, so the
  // read below counts the crossings this step makes (a rerun on the
  // same home keeps the last run's log).
  const usageLines = () => {
    let text = '';
    try {
      text = fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'hooks.jsonl'), 'utf8');
    } catch {
      return [];
    }
    return text.split('\n').filter((l) => l.includes('"capped"') || l.includes('"freed"')).map((l) => JSON.parse(l));
  };
  const usageBefore = usageLines().length;
  for (const n of [2, 3]) {
    reply = widest(n);
    await clickRefresh(s);
    await s.waitFor(`document.querySelector('.usage-strip')?.dataset.windows === '${n}' && document.querySelector('.usage-window .usage-text')?.textContent === 'resets 6d 23h'`, `${n} windows at the widest text`, 5000);
    await sidebarTo(600, at68);
    at68 = 600;
    const line = await stripFit(s);
    checkForm(line, '', `${n} widest windows at 600px`);
    needs[n] = line.needs[0];
    // One pixel over the need: a row, and the last window ends inside
    // the box (checkForm reads the texts' right edges against it).
    await sidebarTo(needs[n] + 1 + chrome, at68);
    at68 = needs[n] + 1 + chrome;
    const over = await stripFit(s);
    expect(Math.round(over.fitWidth) === needs[n] + 1, `the windows box is ${needs[n] + 1}px, got ${over.fitWidth}`);
    expect(over.windows.length === n, `${n} windows`);
    checkForm(over, '', `${n} windows one pixel over the row's need`);
    // One pixel under: the column (the row with the runways under needs
    // the same with no runway to put under, so the fit passes it).
    await sidebarTo(needs[n] - 1 + chrome, at68);
    at68 = needs[n] - 1 + chrome;
    const under = await stripFit(s);
    expect(expectedForm(under) === 'column', `fix 347: one pixel under the row's need the first fitting form is the column, needs ${under.needs.join(',')} in ${under.fitWidth.toFixed(1)}`);
    checkForm(under, 'column', `${n} windows one pixel under the row's need`);
  }
  await sidebarTo(narrow.sidebarWidth, at68);
  reply = { status: 200, body: { five_hour: { utilization: 25, resets_at: at(-MIN) }, seven_day: { utilization: 24, resets_at: at(5 * DAY + 14 * HOUR) } } };
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-window[data-key="five_hour"] .usage-text')?.textContent === 'resets now'`, 'a reset that has passed', 5000);
  await hoverSegment(s, 'five_hour');
  const passedRow = (await readUsageCard(s)).rows.find((r) => r.key === 'five_hour');
  expect(passedRow.percent === '25% used' && /^resets \w+ \d+:\d\d [AP]M, now$/.test(passedRow.when) && /^100(\.00)?%$/.test(passedRow.mark), `the card says resets now with the mark at the bar's end (fix 308), got ${JSON.stringify(passedRow)}`);
  await leaveUsageCard(s);
  console.log(`[verify] fix 68: the widest two windows need ${needs[2]}px and three ${needs[3]}px on one line (fix 347: measured by the strip, no breakpoint)`);
  step('fix 68: one line one pixel over each row need with the last window inside the box, a column one under it; the card says resets now');

  // M9 fix 324: the long form's fit. Ninety percent used with a tenth
  // of the window left is the about form in the error tone, "resets 16h
  // 47m · about 100% at the reset" on a week, the widest text a window
  // can have (a five hour window's is "resets 30m · ..."). M9 fix 347:
  // the four forms are climbed off the strip's own needs, one pixel over
  // and one under each need the sidebar can reach (the box runs from
  // about 190px to about 530px), the form at each width read against
  // the fit's rule and its geometry; the ladder helper does it for any
  // reading, and says which forms it met. Two long windows are the
  // column with the runways under at the default sidebar (their column
  // with the runways inline is past the box) and meet all four forms on
  // the ladder (their plain row fits at 600, 517px in 529, and the row
  // with the runways under is the form one pixel under it, where the
  // column took the whole strip before fix 347); three are the column
  // at 600 and the column with the runways under at the default; one is
  // the row at 600 and the row with the runway under at the default.
  // The texts' widths are computed off each window's text and label,
  // as the row's need, and checked against the strip's.
  const longest = (keys) => {
    const body = {};
    for (const k of keys) body[k] = { utilization: 90, resets_at: at(Math.round((k === 'five_hour' ? 5 * HOUR : 7 * DAY) * 0.0999)) };
    return { status: 200, body };
  };
  reply = longest(['five_hour', 'seven_day']);
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-strip')?.dataset.windows === '2' && /^resets 16h 4[67]m · about 100% at the reset$/.test(document.querySelector('.usage-window[data-key="seven_day"] .usage-text')?.textContent ?? '')`, 'two windows at the widest long text', 5000);
  const weekText = await textWidth(s, 'seven_day');
  // The row's need by the script's own arithmetic (M9 fix 347): each
  // window's label, the gaps, the bar and its own text width off a clone
  // set inline, and between windows the gap, the dot and its margin and
  // the gap again; checked against the strip's need to a pixel or two.
  const labels = { five_hour: await labelWidth(s, 'five_hour'), seven_day: await labelWidth(s, 'seven_day') };
  const texts = { five_hour: await textWidth(s, 'five_hour'), seven_day: weekText };
  const dotWidth = await s.evalJs(`document.querySelector('.usage-probe [data-probe="dot"]').getBoundingClientRect().width`);
  const longNeed = (names) => Math.ceil(names.reduce((sum, w) => sum + labels[w] + 4 + 44 + 4 + texts[w], 0) + (4 + dotWidth + 2 + 4) * (names.length - 1));
  const longTwo = longNeed(['five_hour', 'seven_day']);
  // The ladder (M9 fix 347): from the sidebar's current width, one pixel
  // over and one under each of the strip's four needs the sidebar can
  // reach, the form at each read against the fit's rule (one over a
  // need, the first fitting form is that one or an earlier one; one
  // under, it is never that one) and its geometry. Returns the width
  // it left the sidebar at.
  const ladder = async (why, from) => {
    let atNow = from;
    const seen = new Set();
    const r0 = await stripFit(s);
    for (let i = 0; i < STRIP_FORMS.length; i++) {
      for (const delta of [1, -1]) {
        // Under the last form's need nothing fits and the box clips the
        // last form, by design; that reading is not on the ladder.
        if (delta < 0 && i === STRIP_FORMS.length - 1) continue;
        const target = r0.needs[i] + delta + chrome;
        if (target > 600 || target < narrow.sidebarWidth) continue;
        await sidebarTo(target, atNow);
        atNow = target;
        const r = await stripFit(s);
        const form = expectedForm(r);
        const where = `${why} one ${delta > 0 ? 'over' : 'under'} the ${formName(STRIP_FORMS[i])} need (${r0.needs[i]}px, box ${r.fitWidth.toFixed(1)})`;
        expect(delta > 0 ? STRIP_FORMS.indexOf(form) <= i : form !== STRIP_FORMS[i], `${where}: the first fitting form is ${delta > 0 ? 'that form or an earlier one' : 'not that form'}, got ${formName(form)} (needs ${r.needs.join(',')})`);
        checkForm(r, form, where);
        seen.add(form);
        if (form === 'runway' && delta > 0) await s.screenshot('fix-347-runway-row.png');
      }
    }
    return { at: atNow, seen };
  };
  const longNarrow = await stripFit(s);
  expect(longNarrow.windows.length === 2 && Math.abs(longNarrow.needs[0] - longTwo) <= 2, `fix 324: two long windows need ${longTwo}px on one line by the texts, the strip says ${longNarrow.needs[0]}`);
  checkForm(longNarrow, expectedForm(longNarrow), `fix 324: two long windows at ${longNarrow.sidebarWidth}px`);
  expect(longNarrow.stack === 'column-runway', `fix 324: two long windows are the column with the runways under at ${longNarrow.sidebarWidth}px, got ${formName(longNarrow.stack)} (needs ${longNarrow.needs.join(',')} in ${longNarrow.fitWidth.toFixed(1)})`);
  const longColumn = await readLongColumn(s);
  expect(longColumn.length === 2 && longColumn.every((c) => c.barTop >= c.restTop && c.barBottom <= c.restBottom), `fix 324: each bar sits on its reset's line, got ${JSON.stringify(longColumn)}`);
  const longColours = await s.evalJs(`[...document.querySelectorAll('.usage-window .usage-text')].map((t) => [t.dataset.tone, getComputedStyle(t).color, getComputedStyle(t.querySelector('.usage-runway')).color])`);
  expect(longColours.every((c) => c[0] === 'error' && c[1] === errorColour && c[2] === errorColour), `fix 324: the text and its runway read in --error, got ${JSON.stringify(longColours)}`);
  await s.screenshot('fix-324-column.png');
  await sidebarTo(600, narrow.sidebarWidth);
  const longWide = await stripFit(s);
  checkForm(longWide, expectedForm(longWide), 'fix 324: two long windows at 600px');
  const twoLadder = await ladder('fix 347: two long windows', 600);
  let atLong = twoLadder.at;
  expect(STRIP_FORMS.every((f) => twoLadder.seen.has(f)), `fix 347: two long windows meet all four forms on the ladder, got ${JSON.stringify([...twoLadder.seen].map(formName))}`);
  reply = longest(['five_hour', 'seven_day', 'seven_day_fable']);
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-strip')?.dataset.windows === '3'`, 'three windows at the widest long text', 5000);
  labels.seven_day_fable = await labelWidth(s, 'seven_day_fable');
  texts.seven_day_fable = await textWidth(s, 'seven_day_fable');
  const longThree = longNeed(['five_hour', 'seven_day', 'seven_day_fable']);
  await sidebarTo(600, atLong);
  atLong = 600;
  const longThreeWide = await stripFit(s);
  expect(longThreeWide.windows.length === 3 && Math.abs(longThreeWide.needs[0] - longThree) <= 2, `fix 324: three long windows need ${longThree}px on one line by the texts, the strip says ${longThreeWide.needs[0]}`);
  checkForm(longThreeWide, expectedForm(longThreeWide), 'fix 324: three long windows at 600px');
  expect(longThreeWide.stack === 'column', `fix 347: three long windows at 600px are the column with the runways inline, got ${formName(longThreeWide.stack)} (needs ${longThreeWide.needs.join(',')} in ${longThreeWide.fitWidth.toFixed(1)})`);
  // M9 fix 440: at the sidebar's widest the three long windows are still
  // the column (the read just above), so the bar's track has whatever
  // the sidebar leaves once the label and the text column (now a fixed
  // width, style.css) are laid out. Every bar reads wider than the
  // model's 44px need, ends where its text starts (the grid's 4px gap),
  // ticks no closer than 8px apart, and goes 8px tall past 88px
  // (data-tall); the same column form as at the narrow default says the
  // wider bar never moved the breakpoint.
  const wideColumn = await s.evalJs(
    `[...document.querySelectorAll('.usage-strip .usage-window')].map((w) => { const bar = w.querySelector('.usage-bar').getBoundingClientRect(); const text = w.querySelector('.usage-text').getBoundingClientRect(); const el = w.querySelector('.usage-bar'); return { key: w.dataset.key, width: bar.width, height: bar.height, gap: text.left - bar.right, tall: 'tall' in el.dataset, tick: el.style.getPropertyValue('--tick') }; })`,
  );
  expect(wideColumn.length === 3 && wideColumn.every((b) => b.width > 44), `fix 440: every bar wider than the 44px constant at 600px, got ${JSON.stringify(wideColumn.map((b) => [b.key, b.width]))}`);
  expect(wideColumn.every((b) => Math.abs(b.gap - 4) <= 1), `fix 440: every bar ends where its text starts (the grid's 4px gap), got ${JSON.stringify(wideColumn.map((b) => [b.key, b.gap]))}`);
  const wideTickPx = wideColumn.map((b) => (parseFloat(b.tick) / 100) * b.width);
  expect(wideTickPx.every((px) => px >= 7.9), `fix 440: the ticks stay at least 8px apart on the wider bar, got ${JSON.stringify(wideTickPx)}`);
  expect(wideColumn.every((b) => (b.width >= 88) === b.tall && b.height === (b.tall ? 8 : 6)), `fix 440: data-tall and the 8px height follow the 88px floor, got ${JSON.stringify(wideColumn)}`);
  await s.screenshot('fix-440-wide-bars.png');
  step("M9 fix 440: at the sidebar's widest the three long windows keep the column form and their bars grow past 44px into the spare width, ending where the text starts, ticked no closer than 8px apart and 8px tall past 88");
  expect((await readLongColumn(s)).length === 3, 'fix 324: three runway texts');
  atLong = (await ladder('fix 347: three long windows', atLong)).at;
  // One window: its row's need is within the sidebar's reach, and its
  // row with the runway under fits the default sidebar.
  reply = longest(['five_hour']);
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-strip')?.dataset.windows === '1' && /^resets (30|29)m · about 100% at the reset$/.test(document.querySelector('.usage-window[data-key="five_hour"] .usage-text')?.textContent ?? '')`, 'one window at its widest long text', 5000);
  const longOne = longNeed(['five_hour']);
  await sidebarTo(600, atLong);
  atLong = 600;
  const oneRow = await stripFit(s);
  expect(oneRow.windows.length === 1 && Math.abs(oneRow.needs[0] - longOne) <= 2, `fix 324: one long window needs ${longOne}px on one line by the texts, the strip says ${oneRow.needs[0]}`);
  checkForm(oneRow, '', 'fix 324: one long window at 600px');
  expect(oneRow.windows[0].textDisplay === 'block', `fix 324: in the row the text is a flex item, got ${oneRow.windows[0].textDisplay}`);
  atLong = (await ladder('fix 347: one long window', atLong)).at;
  await sidebarTo(narrow.sidebarWidth, atLong);
  const oneNarrow = await stripFit(s);
  checkForm(oneNarrow, expectedForm(oneNarrow), `fix 324: one long window at ${narrow.sidebarWidth}px`);
  expect(oneNarrow.stack === 'runway', `fix 347: one long window at ${narrow.sidebarWidth}px is the row with the runway under, got ${formName(oneNarrow.stack)} (needs ${oneNarrow.needs.join(',')} in ${oneNarrow.fitWidth.toFixed(1)})`);
  console.log(`[verify] fix 324: the widest long text is ${Math.ceil(weekText)}px; one long window needs ${oneRow.needs[0]}px, two ${longNarrow.needs[0]}px, three ${longThreeWide.needs[0]}px on one line, and ${oneRow.needs[1]}, ${longNarrow.needs[1]} and ${longThreeWide.needs[1]} with the runways under; the box is ${Math.round(longWide.fitWidth)}px at 600 and ${Math.round(oneNarrow.fitWidth)}px at ${narrow.sidebarWidth}`);
  await s.screenshot('fix-324-one.png');
  step('M9 fix 324 and 347: the long form climbs the four measured forms one pixel over and under each need, each drawing its need, the runways under their resets in the stacked forms, nothing clipped; two long windows meet all four and one is the row with the runway under at the default sidebar');

  // M9 fix 285: the readings above crossed 100 percent twice (the two
  // windows at the first widest reply, the Fable window at the second)
  // and the reply under it freed all three, the Fable one by leaving the
  // reply; the daemon wrote six lines, capped with the window's reset
  // and freed with the window alone, in that order.
  for (let tries = 0; tries < 50 && usageLines().length < usageBefore + 6; tries++) await sleep(100);
  const crossings = usageLines().slice(usageBefore);
  const cappedKeys = crossings.filter((l) => l.capped).map((l) => l.capped.window);
  const freedKeys = crossings.filter((l) => l.freed).map((l) => l.freed.window).sort();
  expect(crossings.length === 6 && cappedKeys.join(',') === 'five_hour,seven_day,seven_day_fable' && freedKeys.join(',') === 'five_hour,seven_day,seven_day_fable', `the daemon wrote three capped lines and three freed (${JSON.stringify(crossings)})`);
  expect(crossings.slice(0, 3).every((l) => typeof l.capped.resetsAt === 'number' && l.capped.resetsAt > Date.now() + 6 * DAY) && crossings.slice(0, 3).every((l, i) => i === 0 || l.at >= crossings[i - 1].at), 'each capped line carries the reset the reply gave, in time order');
  expect(crossings.slice(3).every((l) => l.at >= crossings[2].at), 'the freed lines follow the capped ones');
  // The day's answer carries the bands, each closed at its freed edge.
  const spans = await zreq(s, 'activity.spans', { from: Date.now() - 60 * MIN, to: Date.now() });
  const bands = (spans.capped ?? []).filter((c) => c.from >= crossings[0].at - 1000);
  expect(bands.length === 3 && bands.every((c) => c.to > c.from && c.to <= crossings[5].at + 1000) && bands.map((c) => c.window).sort().join(',') === 'five_hour,seven_day,seven_day_fable', `activity.spans answers the three bands closed at the freed edges (${JSON.stringify(bands)})`);
  step('M9 fix 285: a window at 100 percent posts usage.capped with its reset, a reply under it usage.freed, and activity.spans answers the bands');

  // The button asks again and the new numbers show; an unknown window
  // comes through under a label made from its key, one without a reset
  // is left out.
  const seen = requests.length;
  reply = {
    status: 200,
    body: {
      five_hour: { utilization: 42, resets_at: at(2 * HOUR + 5 * MIN) },
      seven_day: { utilization: 9, resets_at: at(3 * DAY + 2 * HOUR) },
      seven_day_new_model: { utilization: 1, resets_at: at(DAY) },
      seven_day_opus: { utilization: 50 },
    },
  };
  await clickRefresh(s);
  await s.waitFor(`document.querySelector('.usage-window[data-key="five_hour"] .usage-text')?.textContent === 'resets 2h 5m'`, 'the refreshed numbers', 5000);
  expect(requests.length === seen + 1, `one more request after the button (${requests.length - seen})`);
  const second = await segments(s);
  expect(second.join(',') === 'five_hour=5h resets 2h 5m,seven_day=7d resets 3d 2h,seven_day_new_model=New model resets 1d 0h', `the changed reply: ${second.join(',')}`);
  expect(!(await s.evalJs(`!!document.querySelector('.usage-refresh[data-busy]')`)), 'the button is not spinning once the fetch is in');
  step('the refresh button fetches again; an unknown window is labelled, one without a reset is skipped');

  // A 401 reads as signed out.
  reply = { status: 401, body: { error: 'unauthorized' } };
  await clickRefresh(s);
  await waitState(s, 'unauthorized', 'a 401');
  expect((await note(s)) === 'Sign in to Claude Code for usage', `the signed-out line: ${await note(s)}`);
  expect((await segments(s)).length === 0, 'no segments while signed out');
  expect((await refreshTitle(s)).includes('Run claude once in any terminal'), `fix 99: the button says to run claude: ${await refreshTitle(s)}`);
  step('a 401 shows the sign-in line, and the button says to run claude');

  // A server error reads as unavailable with its status (fix 99), and a
  // closed port as no connection.
  reply = { status: 503, body: { error: 'boom' } };
  await clickRefresh(s);
  await waitState(s, 'unavailable', 'a 503');
  expect((await note(s)) === 'Usage endpoint answered 503', `the 503 line: ${await note(s)}`);
  expect((await refreshTitle(s)).includes('answered 503; that is on its side'), `the 503 title: ${await refreshTitle(s)}`);
  // Back to good, so the next failure is a change the script can see.
  reply = { status: 200, body: { five_hour: { utilization: 3, resets_at: at(MIN) } } };
  await clickRefresh(s);
  await waitState(s, 'ok', 'good again');
  expect((await segments(s)).join(',') === 'five_hour=5h resets 1m', `one window alone: ${await segments(s)}`);
  await new Promise((r) => server.close(r));
  server = null;
  await clickRefresh(s);
  await waitState(s, 'unavailable', 'the closed port');
  // M9 fix 163: the reading before the closed port is kept, dimmed, so
  // the note is on the card rather than in the windows' place.
  expect((await note(s)) === null && (await segments(s)).join(',') === 'five_hour=5h resets 1m' && (await s.evalJs(`'stale' in document.querySelector('.usage-strip').dataset`)), `a closed port keeps the last reading, dimmed: ${await note(s)}, ${await segments(s)}`);
  expect((await refreshTitle(s)).includes('Check the network'), `the offline title: ${await refreshTitle(s)}`);
  await hoverSegment(s, 'five_hour');
  const offlineLine = await s.evalJs(`document.querySelector('.usage-popover .usage-card-stale')?.textContent ?? null`);
  expect(offlineLine !== null && offlineLine.includes('found no connection'), `the card's stale line says no connection: ${offlineLine}`);
  await leaveUsageCard(s);
  step('fix 99: a 503 shows its status; a closed port keeps the reading with the card saying no connection (fix 163), the button still refetches');

  // No credentials file reads as signed out, before any request.
  fs.rmSync(credentials);
  await clickRefresh(s);
  await waitState(s, 'signed-out', 'no credentials file');
  expect((await note(s)) === 'Sign in to Claude Code for usage', 'the signed-out line without a file');
  // And a file without a token, or with an expired one, the same.
  fs.writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() - 1000 } }));
  reply = { status: 200, body: { five_hour: { utilization: 3, resets_at: at(MIN) } } };
  await clickRefresh(s);
  await new Promise((r) => setTimeout(r, 700));
  expect((await stripState(s)) === 'signed-out', `an expired token is signed out: ${await stripState(s)}`);
  fs.writeFileSync(credentials, '{ not json');
  await clickRefresh(s);
  await new Promise((r) => setTimeout(r, 700));
  expect((await stripState(s)) === 'signed-out', `an unreadable file is signed out: ${await stripState(s)}`);
  await s.screenshot('m15-signed-out.png');
  step('a missing, expired or unreadable credentials file shows the sign-in line');

  // M9 fix 99: a 429 says so with its wait, off the retry-after, and the
  // main process writes the answer's headers and body to main.log under
  // the home, since the limit is undocumented. The stub listens again on
  // its port, the credentials are back, and the step comes last since
  // fix 100 holds the strip for the retry-after once it has seen a 429.
  fs.writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() + 3600_000 } }));
  server = http.createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers['authorization'], beta: req.headers['anthropic-beta'] });
    res.writeHead(reply.status, { 'content-type': 'application/json', ...(reply.headers ?? {}) });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise((r) => server.listen(usagePort, '127.0.0.1', r));
  reply = { status: 200, body: { five_hour: { utilization: 3, resets_at: at(MIN) } } };
  await clickRefresh(s);
  await waitState(s, 'ok', 'good again on the reopened port');

  // M9 fix 100: the timer's poll skips a hidden window and the focus's
  // asks only when the last reading is older than the interval, driven
  // through the strip's hook with an injected now, since neither a five
  // minute timer nor a hidden window can be waited for here.
  const poll = (kind, offset = 0) => s.evalJs(`document.querySelector('.usage-strip').emeraldUsage.poll(${JSON.stringify(kind)}, Date.now() + ${offset})`);
  const settle = () => new Promise((r) => setTimeout(r, 400));
  let before = requests.length;
  await s.evalJs(`Object.defineProperty(document, 'hidden', { get: () => true, configurable: true })`);
  await poll('timer');
  await settle();
  expect(requests.length === before, `the timer's poll skips a hidden window (${requests.length - before} requests)`);
  await s.evalJs(`delete document.hidden`);
  await poll('timer');
  await settle();
  expect(requests.length === before + 1, `and asks once the window is visible (${requests.length - before} requests)`);
  before = requests.length;
  await poll('focus');
  await settle();
  expect(requests.length === before, `a focus right after a reading asks nothing (${requests.length - before} requests)`);
  await poll('focus', 6 * MIN);
  await settle();
  expect(requests.length === before + 1, `a focus with the reading six minutes old asks (${requests.length - before} requests)`);
  step('fix 100: the timer skips a hidden window, the focus asks only on an old reading');

  // M9 fix 348: a layout tab opened and closed asks nothing (the strip
  // is mounted once for the window's life; the reads a harness log
  // showed around a tab open were the script's own Page.reloads), and
  // the main log's read line says what made each ask.
  before = requests.length;
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2`, 'a second layout tab');
  await s.evalJs(`document.querySelector('.tab.tab-panes[data-active] .tab-close').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 1`, 'the tab closed again');
  await settle();
  expect(requests.length === before, `a layout tab opened and closed asks nothing (${requests.length - before} requests)`);
  const askLines = fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8').split(/\r?\n/).filter((l) => l.includes('usage read:'));
  expect(askLines.some((l) => l.endsWith('asked on mount')) && askLines.some((l) => l.endsWith('asked on button')) && askLines.some((l) => l.endsWith('asked on timer')) && askLines.some((l) => l.endsWith('asked on focus')), `main.log's read lines say what made each ask, got ${JSON.stringify(askLines.slice(-6))}`);
  step('M9 fix 348: a layout tab opened and closed asks nothing, and the read lines name their asks');

  // M9 fix 163: a 429 after a good reading keeps the reading on the
  // strip, dimmed, with the card saying it is stale and when the next ask
  // goes; and a `retry-after: 0`, which is what the endpoint sends on
  // nearly every 429 in a run, is no hint, so the hold is the back-off's
  // five minutes rather than the floor.
  const stale = () => s.evalJs(`(() => { const el = document.querySelector('.usage-strip'); return { stale: 'stale' in el.dataset, state: el.dataset.state, windows: el.dataset.windows ?? null, opacity: getComputedStyle(el.querySelector('.usage-windows')).opacity }; })()`);
  reply = { status: 429, headers: { 'retry-after': '0' }, body: { error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' } } };
  await clickRefresh(s);
  await waitState(s, 'unavailable', 'a 429 with retry-after 0');
  const kept = await stale();
  expect(kept.stale && kept.windows === '1' && (await segments(s)).join(',') === 'five_hour=5h resets 1m' && Number(kept.opacity) < 0.7, `the reading stays on the strip, dimmed, through the 429: ${JSON.stringify(kept)}, ${(await segments(s)).join(',')}`);
  // M9 fix 308: the bar is inside the dimmed box, so it dims with its
  // text; the existing rule covers it and the mark keeps moving.
  expect(Math.abs(Number(kept.opacity) - 0.55) < 0.01 && (await s.evalJs(`!!document.querySelector('.usage-strip .usage-windows .usage-bar')`)), `fix 308 stale: the windows are at 0.55 with the bar inside, got ${kept.opacity}`);
  expect((await note(s)) === null, 'no note in place of the windows while a reading is kept');
  const zeroTitle = await refreshTitle(s);
  expect(/Retry in (5m 0s|4m \d+s)\.$/.test(zeroTitle), `retry-after 0 holds the back-off's five minutes, not the floor: ${zeroTitle}`);
  await hoverSegment(s, 'five_hour');
  const staleCard = await s.evalJs(`(() => { const c = document.querySelector('.usage-popover'); return { stale: 'stale' in c.dataset, line: c.querySelector('.usage-card-stale')?.textContent ?? null, note: c.querySelector('.usage-card-note').textContent }; })()`);
  expect(staleCard.stale && /^Stale: the ask at \d.* was rate limited; asks again in (5m 0s|4m \d+s)\.$/.test(staleCard.line) && /asked at \d/.test(staleCard.note), `the card says the reading is stale, what the ask met and when the next goes: ${JSON.stringify(staleCard)}`);
  await leaveUsageCard(s);
  step('fix 163: a 429 keeps the last reading on the strip, dimmed and carded as stale, and retry-after 0 holds five minutes');

  // The poll's injected now steps past the five-minute hold, since the
  // hold is real and the step cannot wait it out.
  reply = { status: 429, headers: { 'retry-after': '120', 'x-should-retry': 'true' }, body: { error: { type: 'rate_limit_error', message: 'Rate limited. Please try again later.' } } };
  await poll('timer', 6 * MIN);
  await s.waitFor(`/Retry in (2m 0s|1m \\d+s)\\.$/.test(document.querySelector('.usage-refresh').title)`, 'a 429 with retry-after 120 past the earlier hold', 5000);
  expect((await stale()).stale && (await note(s)) === null, 'the reading is still kept through the second 429');
  const limitedTitle = await refreshTitle(s);
  expect(limitedTitle.includes('rate limiting this account') && /Retry in (2m 0s|1m \d+s)\.$/.test(limitedTitle), `the rate-limited title with the wait: ${limitedTitle}`);
  const mainLog = fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8');
  const line429 = mainLog.split(/\r?\n/).find((l) => l.includes('usage endpoint answered 429') && l.includes('retry-after=120'));
  expect(line429 !== undefined && line429.includes('x-should-retry=true') && line429.includes('rate_limit_error'), `main.log holds the 429 with its headers and body: ${line429}`);
  expect(mainLog.includes('usage read: 3 windows') && mainLog.includes('usage read: 1 windows'), 'main.log holds a line per reading (fix 163), so the cadence can be read beside the 429s');
  expect(mainLog.includes('background window at'), 'main.log has the placement line too');
  step('fix 99: a 429 shows its wait, and main.log under the home holds the answer');

  // M9 fix 100: inside the hold the button is dim and fetches nothing,
  // its title counts down by the second, and the timer's poll waits too.
  before = requests.length;
  expect(await s.evalJs(`!!document.querySelector('.usage-refresh[data-held]')`), 'the button is held');
  await clickRefresh(s);
  await clickRefresh(s);
  await poll('timer');
  await settle();
  expect(requests.length === before, `two presses and a poll inside the hold reach the stub as no request (${requests.length - before})`);
  const secondsLeft = (title) => { const m = /Retry in (?:(\d+)m )?(\d+)s\.$/.exec(title); return m === null ? null : Number(m[1] ?? 0) * 60 + Number(m[2]); };
  const t1 = secondsLeft(await refreshTitle(s));
  await new Promise((r) => setTimeout(r, 2100));
  const t2 = secondsLeft(await refreshTitle(s));
  expect(t1 !== null && t2 !== null && t1 - t2 >= 1 && t1 - t2 <= 3, `the title counts down by the second: ${t1} then ${t2}`);
  const heldCard = await (async () => { await hoverSegment(s, 'five_hour'); const line = await s.evalJs(`document.querySelector('.usage-popover .usage-card-stale')?.textContent ?? null`); await leaveUsageCard(s); return line; })();
  expect(heldCard !== null && /asks again in (2m 0s|1m \d+s)\.$/.test(heldCard), `the card's stale line keeps the wait: ${heldCard}`);
  step('fix 100: the held button fetches nothing and counts down');

  // M9 fix 163: signed out is not kept through; the token is gone and
  // the sign-in line is the truth. Then the token is back for the last
  // step, which reads the log for it.
  fs.rmSync(credentials, { force: true });
  await poll('timer', 6 * MIN);
  await waitState(s, 'signed-out', 'no credentials after a kept reading');
  expect((await note(s)) === 'Sign in to Claude Code for usage' && !(await stale()).stale, `signed out drops the kept reading for the sign-in line: ${await note(s)}`);
  fs.writeFileSync(credentials, JSON.stringify({ claudeAiOauth: { accessToken: TOKEN, expiresAt: Date.now() + 3600_000 } }));
  step('fix 163: signed out shows the sign-in line, no kept reading');

  // M9 fix 294: the live reply's shape, every per-model key null and the
  // Fable window only on the `limits` list; it shows as a third window
  // with a seven-day bar on its card row.
  const scopedWeeklyReset = at(6 * DAY + 16 * HOUR + 20 * MIN);
  reply = {
    status: 200,
    body: {
      five_hour: { utilization: 17, resets_at: at(41 * MIN) },
      seven_day: { utilization: 5, resets_at: scopedWeeklyReset },
      seven_day_opus: null,
      seven_day_sonnet: null,
      seven_day_fable: null,
      limits: liveLimits(7, scopedWeeklyReset),
    },
  };
  await clickRefresh(s);
  await waitState(s, 'ok', 'the reply with the scoped Fable limit');
  await s.waitFor(`document.querySelectorAll('.usage-window').length === 3`, 'three windows off the limits list', 5000);
  const scoped = await segments(s);
  expect(scoped.join(',') === 'five_hour=5h resets 41m,seven_day=7d resets 6d 16h,weekly_scoped_fable=Fable resets 6d 16h', `fix 294: the scoped Fable limit is the third segment: ${scoped.join(',')}`);
  await hoverSegment(s, 'weekly_scoped_fable');
  const scopedCard = await readUsageCard(s);
  expect(scopedCard.rows.length === 3 && scopedCard.rows[2].key === 'weekly_scoped_fable' && scopedCard.rows[2].name === 'Fable 7 day window' && scopedCard.rows[2].percent === '7% used' && scopedCard.rows[2].mark !== null && barNear(scopedCard.rows[2].mark, 4.6) && scopedCard.rows[2].ticks === 6, `fix 294: the card's third row is the Fable window with a seven-day bar, got ${JSON.stringify(scopedCard.rows[2])}`);
  await leaveUsageCard(s);
  step('M9 fix 294: a weekly_scoped limit off the limits list shows as the Fable window with its bar');

  // M9 fix 295: five-hour at 40 with four hours left is one hour in, so
  // the pace lands at 100 in an hour and a half, before the reset: the
  // bar goes to the error tone (M9 fix 308), as the seven-day at 95 does
  // on its percent alone, and the text takes the tone and carries the
  // runway after the dot (M9 fix 324; the seven-day, in its first tenth,
  // has no runway to carry).
  reply = {
    status: 200,
    body: {
      five_hour: { utilization: 40, resets_at: at(4 * HOUR) },
      seven_day: { utilization: 95, resets_at: scopedWeeklyReset },
    },
  };
  await clickRefresh(s);
  await s.waitFor(`/^resets 4h 0m · 100% in 1h 3[01]m$/.test(document.querySelector('.usage-window[data-key="five_hour"] .usage-text')?.textContent ?? '')`, 'the runway reply (fix 324: the runway on the strip)', 5000);
  const runwayBars = await stripBars(s);
  expect(runwayBars[0].tone === 'error' && runwayBars[0].fillColour === errorColour && runwayBars[0].textColour === errorColour, `fix 295: the five-hour bar is in the error tone, its text too (fix 324), got ${JSON.stringify(runwayBars[0])}`);
  expect(runwayBars[1].tone === 'error' && runwayBars[1].fill === 95 && runwayBars[1].textColour === errorColour, `fix 295: the seven-day bar at 95 is in the error tone on its percent, its text too, got ${JSON.stringify(runwayBars[1])}`);
  expect((await s.evalJs(`document.querySelector('.usage-window[data-key="seven_day"] .usage-text').textContent`)) === 'resets 6d 16h', 'fix 324: the seven-day text in its first tenth is the reset alone, red');
  expect((await s.evalJs(`[...document.querySelectorAll('.usage-window')].every((w) => w.dataset.runway === undefined)`)), 'fix 308: no segment carries data-runway any more');
  await hoverSegment(s, 'five_hour');
  const paceCard = await readUsageCard(s);
  // The read lands seconds after the stub's timestamp and the minutes round up, so 1h 30m or 1h 31m.
  expect(/^100% in 1h 3[01]m$/.test(paceCard.rows[0].pace ?? '') && paceCard.rows[0].short, `fix 295: the runway says 100% in 1h 30m, got ${JSON.stringify(paceCard.rows[0])}`);
  expect(paceCard.rows[1].pace === null, `fix 295: the seven-day row in its first tenth has no runway, got ${JSON.stringify(paceCard.rows[1].pace)}`);
  // M9 fix 347: the ceiling at the runway's time on the strip's bar and
  // the card's: an hour in with 100 in an hour and a half is 2.5 hours
  // of the five, the span's middle, and the mark plus the runway's 30%;
  // the seven-day bar in its first tenth has no runway and no ceiling.
  expect(runwayBars[0].ceiling !== null && Math.abs(runwayBars[0].ceiling - 50) <= 0.3 && Math.abs(runwayBars[0].ceiling - (runwayBars[0].mark + 30)) <= 0.3 && runwayBars[0].ceilingColour === errorColour && runwayBars[1].ceiling === null, `fix 347: the strip's five-hour ceiling sits at 50%, the mark plus the runway, in --error, none on the seven-day bar, got ${JSON.stringify(runwayBars.map((b) => [b.key, b.mark, b.ceiling, b.ceilingColour]))}`);
  expect(paceCard.rows[0].ceiling !== null && Math.abs(parseFloat(paceCard.rows[0].ceiling) - 50) <= 0.3 && paceCard.rows[1].ceiling === null, `fix 347: the card's five-hour row carries the same ceiling and the seven-day row none, got ${JSON.stringify(paceCard.rows.map((r) => [r.key, r.ceiling]))}`);
  // M9 fix 361: an hour in at 40%, the runway short by 2h 30m of the
  // window, so a break that long puts it back on pace; the seven-day
  // row's runway is null in its first tenth, so it has no advice either.
  expect(/^back on pace after a 2h 3[01]m break$/.test(paceCard.rows[0].advice ?? ''), `fix 361: the five-hour row's advice says a 2h 30m break, got ${JSON.stringify(paceCard.rows[0].advice)}`);
  expect(paceCard.rows[1].advice === null, `fix 361: the seven-day row with no runway has no advice either, got ${JSON.stringify(paceCard.rows[1].advice)}`);
  await s.screenshot('m9-295-runway.png');
  await leaveUsageCard(s);
  step('M9 fix 295: a window whose pace runs out before the reset goes to the error tone on the strip and says so on the card; M9 fix 347: its ceiling marks the bar where the pace hits 100');

  // The renderer never saw the token.
  const leaked = await s.evalJs(`document.documentElement.outerHTML.includes(${JSON.stringify(TOKEN)})`);
  expect(!leaked, 'the token is not in the page');
  expect(!s.logs.join('').includes(TOKEN), 'the token is not in the app log');
  expect(!fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'logs', 'main.log'), 'utf8').includes(TOKEN), 'the token is not in main.log');
  step('the token stays in the main process');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m15-usage-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  if (server !== null) server.close();
  try {
    fs.rmSync(claudeHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Left for the next run.
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
