// The status line's cadence (M9 fix 229), a bench and not a verify: how
// often Claude Code posts a StatusLine while a session works, and what
// each post moves. The token bars on the activity view's stats line bin
// each row's output delta into the bucket the push arrived in, so the
// bucket's width and a full bar's tokens should follow the source's
// pace, which the code does not say: whether a long reply's stream
// reaches the sink as it lands (a delta every second or so) or per
// request (one delta per 2 to 10 s), and whether anything on the way
// coalesces the lines. Read off the daemon's own hooks.jsonl, no daemon
// needed.
//
//   node scripts/bench-status-cadence.mjs [--log <hooks.jsonl>] [--day YYYY-MM-DD] [--session <id prefix>]
//
// Defaults: the log under EMERALD_HOME (or ~/.emerald), the day with the most
// StatusLine lines, and that day's busiest session. Prints the lines per
// minute over the minutes the session posted in, the gaps between one
// line and the next, the output deltas by their size, how the lines split
// between a request streaming (the same input split as the line before)
// and a new request, and the busiest second, which is the number the
// coalescing question turns on.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const home = process.env['EMERALD_HOME'] ?? path.join(os.homedir(), '.emerald');
const logPath = opt('--log') ?? path.join(home, 'logs', 'hooks.jsonl');
const dayArg = opt('--day');
const sessionArg = opt('--session');

const dayKey = (at) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// One pass over the file: every StatusLine with its request counts, by
// day and session. The file is a few hundred megabytes on a busy home,
// so it is streamed and only the fields the tally needs are kept.
const lines = new Map(); // day -> session -> [{ at, fresh, cacheWrite, cacheRead, output }]
let total = 0;
const rl = readline.createInterface({ input: fs.createReadStream(logPath, 'utf8'), crlfDelay: Infinity });
for await (const raw of rl) {
  if (!raw.includes('"StatusLine"')) continue;
  let line;
  try {
    line = JSON.parse(raw);
  } catch {
    continue;
  }
  if (line.event !== 'StatusLine' || typeof line.at !== 'number') continue;
  const usage = line.payload?.context_window?.current_usage;
  if (usage === undefined || usage === null || typeof usage.output_tokens !== 'number') continue;
  total += 1;
  const day = dayKey(line.at);
  if (!lines.has(day)) lines.set(day, new Map());
  const byDay = lines.get(day);
  const sid = line.sessionId;
  if (!byDay.has(sid)) byDay.set(sid, []);
  byDay.get(sid).push({ at: line.at, fresh: usage.input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, output: usage.output_tokens });
}

if (total === 0) {
  console.log(`no StatusLine lines with request counts in ${logPath}`);
  process.exit(0);
}

const countOf = (byDay) => [...byDay.values()].reduce((n, l) => n + l.length, 0);
const days = [...lines.entries()].sort((a, b) => countOf(b[1]) - countOf(a[1]));
const day = dayArg ?? days[0][0];
const byDay = lines.get(day);
if (byDay === undefined) {
  console.log(`no StatusLine lines on ${day}; the days with the most: ${days.slice(0, 5).map(([d, m]) => `${d} (${countOf(m)})`).join(', ')}`);
  process.exit(0);
}
const sessions = [...byDay.entries()].sort((a, b) => b[1].length - a[1].length);
const picked = sessionArg === null ? sessions[0] : sessions.find(([id]) => id.startsWith(sessionArg));
if (picked === undefined) {
  console.log(`no session on ${day} starting ${sessionArg}`);
  process.exit(0);
}
const [sessionId, posts] = picked;
posts.sort((a, b) => a.at - b.at);

console.log(`${logPath}: ${total} StatusLine lines with request counts over ${lines.size} days`);
console.log(`day ${day}: ${countOf(byDay)} lines over ${byDay.size} sessions; the busiest five: ${sessions.slice(0, 5).map(([id, l]) => `${id.slice(0, 8)} (${l.length})`).join(', ')}`);
console.log(`session ${sessionId}: ${posts.length} lines from ${new Date(posts[0].at).toLocaleTimeString()} to ${new Date(posts[posts.length - 1].at).toLocaleTimeString()}`);
console.log('');

// Lines per minute over the minutes with any.
const perMinute = new Map();
for (const p of posts) {
  const m = Math.floor(p.at / 60_000);
  perMinute.set(m, (perMinute.get(m) ?? 0) + 1);
}
const minuteCounts = [...perMinute.values()].sort((a, b) => a - b);
const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.floor(arr.length * q))];
console.log(`lines per minute over ${minuteCounts.length} minutes with a line: median ${pct(minuteCounts, 0.5)}, p90 ${pct(minuteCounts, 0.9)}, max ${minuteCounts[minuteCounts.length - 1]}`);

// The busiest second, and how many seconds saw more than one line.
const perSecond = new Map();
for (const p of posts) {
  const s = Math.floor(p.at / 1000);
  perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
}
const secondCounts = [...perSecond.values()];
const busiest = Math.max(...secondCounts);
console.log(`busiest second: ${busiest} lines; seconds with 2 or more: ${secondCounts.filter((n) => n >= 2).length} of ${secondCounts.length}; with 4 or more: ${secondCounts.filter((n) => n >= 4).length}`);

// The gaps and the deltas, by the same-split rule the daemon folds
// points with: a line whose input split equals the last is the same
// request streaming.
const bins = [
  ['under 250 ms', 250],
  ['250 to 500 ms', 500],
  ['0.5 to 1 s', 1000],
  ['1 to 2 s', 2000],
  ['2 to 5 s', 5000],
  ['5 to 10 s', 10_000],
  ['10 to 30 s', 30_000],
  ['over 30 s', Infinity],
];
const binOf = (ms) => bins.find(([, top]) => ms < top)[0];
const gapBins = new Map(bins.map(([n]) => [n, 0]));
const streamGapBins = new Map(bins.map(([n]) => [n, 0]));
let streaming = 0;
let fresh = 0;
const streamDeltas = [];
const requestDeltas = [];
const zeroDeltas = { streaming: 0, fresh: 0 };
for (let i = 1; i < posts.length; i++) {
  const prev = posts[i - 1];
  const cur = posts[i];
  const gap = cur.at - prev.at;
  gapBins.set(binOf(gap), gapBins.get(binOf(gap)) + 1);
  const same = prev.fresh === cur.fresh && prev.cacheWrite === cur.cacheWrite && prev.cacheRead === cur.cacheRead;
  const delta = cur.output - prev.output;
  if (same) {
    streaming += 1;
    streamGapBins.set(binOf(gap), streamGapBins.get(binOf(gap)) + 1);
    if (delta === 0) zeroDeltas.streaming += 1;
    else if (delta > 0) streamDeltas.push({ delta, gap });
  } else {
    fresh += 1;
    if (delta === 0) zeroDeltas.fresh += 1;
    else if (delta > 0) requestDeltas.push({ delta, gap });
  }
}
console.log('');
console.log(`lines after the first: ${streaming} on the same input split as the line before (a request streaming), ${fresh} on a new split (a new request)`);
console.log(`of the streaming lines ${zeroDeltas.streaming} moved the output by nothing; of the new-split lines ${zeroDeltas.fresh} did`);
console.log('');
console.log('gap to the line before, all lines:');
for (const [name, n] of gapBins) console.log(`  ${name.padEnd(14)} ${String(n).padStart(6)}  ${'#'.repeat(Math.round((n / Math.max(1, posts.length - 1)) * 60))}`);
console.log('gap to the line before, streaming lines alone:');
for (const [name, n] of streamGapBins) console.log(`  ${name.padEnd(14)} ${String(n).padStart(6)}  ${'#'.repeat(Math.round((n / Math.max(1, streaming)) * 60))}`);

const describe = (name, list) => {
  if (list.length === 0) {
    console.log(`${name}: none`);
    return;
  }
  const deltas = list.map((d) => d.delta).sort((a, b) => a - b);
  const rates = list.filter((d) => d.gap > 0).map((d) => (d.delta / d.gap) * 1000).sort((a, b) => a - b);
  console.log(`${name}: ${list.length} lines, output delta median ${pct(deltas, 0.5)}, p90 ${pct(deltas, 0.9)}, max ${deltas[deltas.length - 1]} tokens; tokens per second over the gap median ${pct(rates, 0.5).toFixed(0)}, p90 ${pct(rates, 0.9).toFixed(0)}`);
};
console.log('');
describe('streaming lines with a positive delta', streamDeltas);
describe('new-split lines with a positive delta', requestDeltas);

// A new request's first line carries that request's output so far, a
// smaller number than the last request's total, so the record's running
// sum (state-machine's sumTokens) and the bars' delta read a drop as a
// new baseline; here the request's size is its last line's output.
const requestSizes = [];
let open = null;
for (let i = 0; i < posts.length; i++) {
  const cur = posts[i];
  const prev = posts[i - 1];
  const same = prev !== undefined && prev.fresh === cur.fresh && prev.cacheWrite === cur.cacheWrite && prev.cacheRead === cur.cacheRead;
  if (same) open.lines += 1;
  else {
    if (open !== null) requestSizes.push(open);
    open = { lines: 1, output: 0 };
  }
  open.output = cur.output;
}
if (open !== null) requestSizes.push(open);
const oneLine = requestSizes.filter((r) => r.lines === 1);
const multi = requestSizes.filter((r) => r.lines > 1);
const outputs = (list) => list.map((r) => r.output).sort((a, b) => a - b);
console.log('');
console.log(`requests: ${requestSizes.length}; ${oneLine.length} posted one line (output median ${oneLine.length ? pct(outputs(oneLine), 0.5) : 0}, p90 ${oneLine.length ? pct(outputs(oneLine), 0.9) : 0} tokens), ${multi.length} posted more (lines median ${multi.length ? pct(multi.map((r) => r.lines).sort((a, b) => a - b), 0.5) : 0}, output median ${multi.length ? pct(outputs(multi), 0.5) : 0}, p90 ${multi.length ? pct(outputs(multi), 0.9) : 0} tokens)`);

// The day's busiest second over every session, since the renderer feeds
// its ring from every row's push.
const daySeconds = new Map();
for (const list of byDay.values()) for (const p of list) daySeconds.set(Math.floor(p.at / 1000), (daySeconds.get(Math.floor(p.at / 1000)) ?? 0) + 1);
const dayBusiest = Math.max(...daySeconds.values());
console.log(`the day's busiest second over all ${byDay.size} sessions: ${dayBusiest} lines`);

// The finding, read off the numbers above: the median gap between two
// lines of one stream is the source's pace, the one-line requests are
// the lumps a spread would draw as their shape, and the busiest second
// is the coalescing question.
const streamGaps = [];
for (let i = 1; i < posts.length; i++) {
  const prev = posts[i - 1];
  const cur = posts[i];
  if (prev.fresh === cur.fresh && prev.cacheWrite === cur.cacheWrite && prev.cacheRead === cur.cacheRead) streamGaps.push(cur.at - prev.at);
}
streamGaps.sort((a, b) => a - b);
const medianGap = streamGaps.length ? pct(streamGaps, 0.5) : 0;
console.log('');
console.log(`finding: a request streaming posts a line every ${(medianGap / 1000).toFixed(1)} s (median, p90 ${((streamGaps.length ? pct(streamGaps, 0.9) : 0) / 1000).toFixed(1)} s), so the source moves ${medianGap < 2000 ? 'during a stream' : 'per request'} and a 1 s bucket keeps its pace; ${Math.round((oneLine.length / Math.max(1, requestSizes.length)) * 100)}% of requests post one line, a lump the bars can only spread over the gap before it; the busiest second saw ${busiest} ${busiest === 1 ? 'line' : 'lines'} from this session${busiest > 4 ? ', more than four, so the daemon should coalesce' : ', under the four a second per session that would call for coalescing'}, and ${dayBusiest} over every session of the day.`);
