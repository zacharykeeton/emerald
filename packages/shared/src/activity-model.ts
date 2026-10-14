import { activityRowKey } from './activity.ts';
import type { ActivityRequest, ActivitySession, ActivitySpan, CappedSpan, DebtKind, DebtSpan } from './activity.ts';
import { costParts, formatUsd, ratesFor } from './rates.ts';
import { formatTokens } from './session-label.ts';

// The numbers behind the activity card (M54), pure so the card, the tab
// and `emmer activity` agree: how much of the day's agent time ran
// beside other agent time. Lifetime spans (a shell that ran no Claude)
// are not agent time and count for nothing here, and since M9 fix 191
// they are not drawn either.

export interface ActivityStats {
  // The sum of the working spans, in ms.
  agentMs: number;
  // The union of the working spans, in ms: the wall time during which at
  // least one session was working.
  wallMs: number;
  // agentMs over wallMs, 0 when nothing worked: 1 is one session at a
  // time, 2 is two on average, and so on.
  parallel: number;
  // The most spans open at one instant.
  peak: number;
  // M9 fix 207: the sessions working at this instant, read off the
  // store's working set rather than the spans, since the daemon closes
  // an open span at the instant it answered and the renderer asks every
  // thirty seconds, so a count read off the spans at `now` is 0 for most
  // of that gap. Null on a window that is not on the clock (a past day,
  // `emmer activity`), where there is no instant to read.
  running: number | null;
  // M9 fix 217: the window's tokens and cost, summed over the request
  // points of every session drawn: what was sent (fresh, cache writes and
  // cache reads, the last also on its own as `cached`), what came back,
  // and the dollars, Claude Code's own figure per request where it gave
  // one, else priced from the rates by the model, which `estimated`
  // marks. `requests` is how many points were summed; 0 means the line
  // carries no tokens part.
  up: number;
  fresh: number;
  cacheWrite: number;
  cached: number;
  down: number;
  usd: number;
  estimated: boolean;
  requests: number;
  // M9 fix 218: what landed over the window, the commits the sessions'
  // records credit (merges among them), and the rows with the most, for
  // the tooltip.
  commits: number;
  merges: number;
  committers: Array<{ name: string; commits: number }>;
  // M9 fix 231: attention debt, the time the sessions spent waiting on
  // the person, summed over sessions and clipped to the window like the
  // working spans (the sum is what stacks into a week and what "I kept
  // three of them waiting" means); its split into asked and unread, the
  // asked stretches counted as waits, the union (the wall time someone
  // was owed) for the tooltip, and the most waiting at one instant.
  debtMs: number;
  askedMs: number;
  unreadMs: number;
  waits: number;
  debtWallMs: number;
  debtPeak: number;
  // M9 fix 245: how much waiting fell while nobody was at the box and
  // was taken off the figures above, summed over the drawn rows, for
  // the tooltip's `away not counted` line.
  awayMs: number;
  // M9 fix 285: the same for the waiting that fell while the account was
  // capped, for the tooltip's `capped not counted` line.
  cappedMs: number;
}

// One session's debt over the window (M9 fix 231), for the rail card
// and the lane's name gutter; a row from a daemon before the field has
// none.
export interface SessionDebt {
  debtMs: number;
  askedMs: number;
  unreadMs: number;
  waits: number;
}

export function sessionDebt(s: Pick<ActivitySession, 'debt'>, from: number, to: number): SessionDebt {
  const out: SessionDebt = { debtMs: 0, askedMs: 0, unreadMs: 0, waits: 0 };
  for (const d of s.debt ?? []) {
    const ms = Math.min(d.to, to) - Math.max(d.from, from);
    if (ms <= 0) continue;
    out.debtMs += ms;
    if (d.kind === 'asked') {
      out.askedMs += ms;
      out.waits += 1;
    } else out.unreadMs += ms;
  }
  return out;
}

// The waiting stretches that count (M9 fix 231), the drawn rows' alone,
// so a session with no working time in the window is no more drawn for
// its debt than for anything else; shared with the mirror under the
// load band.
export function debtSpans(sessions: readonly ActivitySession[], kind: DebtKind | null = null): DebtSpan[] {
  const out: DebtSpan[] = [];
  for (const s of drawnSessions(sessions)) for (const d of s.debt ?? []) if (kind === null || d.kind === kind) out.push(d);
  return out;
}

// The spans that are agent time, shared with the load band (M74) so the
// two never disagree on what counts.
export function workingSpans(sessions: readonly ActivitySession[]): ActivitySpan[] {
  const out: ActivitySpan[] = [];
  for (const s of drawnSessions(sessions)) out.push(...s.spans);
  return out;
}

// The sessions with a working one's last span extended to `now` (M9 fix
// 228), and (M9 fix 231) an owed one's last waiting stretch the same
// way, when the store lists the session in the state the stretch stands
// for (`owed`, by row key: needs-input for asked, done for unread). The daemon closes an open span at the instant it answered, and
// the renderer asks every thirty seconds, so between two answers the
// span's end lags the clock by up to that; the strip drew its last span
// to now on its own, while the stats line's agent time and the load
// band read the answered end and stopped short of the now line. Every
// drawing takes its sessions through here, so the three read one end. A
// session the store no longer lists as working keeps its answered end
// until the refetch after the change; an idle session and an earlier
// span are untouched.
export function liveSpans(sessions: readonly ActivitySession[], working: ReadonlySet<string>, now: number, owed?: ReadonlyMap<string, DebtKind>): ActivitySession[] {
  return sessions.map((s) => {
    if (s.lifetime) return s;
    let out = s;
    const last = s.spans.length - 1;
    if (last >= 0 && working.has(activityRowKey(s))) {
      const span = s.spans[last]!;
      if (span.to < now) out = { ...out, spans: [...s.spans.slice(0, last), { ...span, to: now }] };
    }
    const debt = s.debt ?? [];
    const kind = owed?.get(activityRowKey(s));
    const d = debt[debt.length - 1];
    if (kind !== undefined && d !== undefined && d.kind === kind && d.to < now) out = { ...out, debt: [...debt.slice(0, -1), { ...d, to: now }] };
    return out;
  });
}

// The sessions the strip draws (M9 fix 191): the ones with working time.
// A shell's lifetime row ran the whole window on a track of its own and
// said nothing the sidebar does not; the daemon still answers it, for
// `emmer activity` and any later reading of open-but-idle, and every
// drawing skips it here.
export function drawnSessions(sessions: readonly ActivitySession[]): ActivitySession[] {
  return sessions.filter((s) => !s.lifetime);
}

// The stats over several windows merged into one (M9 fix 297): with
// days picked, the week's line prices the pick alone, one activityStats
// call per picked day summed together rather than one call over the
// whole week. The picked days never overlap in time, so summing what
// each already summed on its own equals what one sweep over their union
// would find: agentMs, wallMs, the request, token, dollar, commit,
// merge and debt fields (read the interface for the full list); `peak`
// takes the largest part's instead, since two days' peaks summed would
// count their two busiest moments as happening at once, which they
// never did; `parallel` is recomputed off the summed agentMs and
// wallMs, 0 when wallMs is 0 rather than dividing by it; `running`
// takes the last part's, since it reads the store's live working set
// (M9 fix 207), the same read whichever window asked for it.
export function mergeStats(parts: readonly ActivityStats[]): ActivityStats {
  let agentMs = 0;
  let wallMs = 0;
  let peak = 0;
  let up = 0;
  let fresh = 0;
  let cacheWrite = 0;
  let cached = 0;
  let down = 0;
  let usd = 0;
  let estimated = false;
  let requests = 0;
  let commits = 0;
  let merges = 0;
  const byName = new Map<string, number>();
  let debtMs = 0;
  let askedMs = 0;
  let unreadMs = 0;
  let waits = 0;
  let debtWallMs = 0;
  let debtPeak = 0;
  let awayMs = 0;
  let cappedMs = 0;
  for (const p of parts) {
    agentMs += p.agentMs;
    wallMs += p.wallMs;
    if (p.peak > peak) peak = p.peak;
    up += p.up;
    fresh += p.fresh;
    cacheWrite += p.cacheWrite;
    cached += p.cached;
    down += p.down;
    usd += p.usd;
    if (p.estimated) estimated = true;
    requests += p.requests;
    commits += p.commits;
    merges += p.merges;
    for (const c of p.committers) byName.set(c.name, (byName.get(c.name) ?? 0) + c.commits);
    debtMs += p.debtMs;
    askedMs += p.askedMs;
    unreadMs += p.unreadMs;
    waits += p.waits;
    debtWallMs += p.debtWallMs;
    debtPeak += p.debtPeak;
    awayMs += p.awayMs;
    cappedMs += p.cappedMs;
  }
  const committers = [...byName.entries()].map(([name, n]) => ({ name, commits: n })).sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  const running = parts.length === 0 ? null : parts[parts.length - 1]!.running;
  return { agentMs, wallMs, parallel: wallMs === 0 ? 0 : agentMs / wallMs, peak, running, up, fresh, cacheWrite, cached, down, usd, estimated, requests, commits, merges, committers, debtMs, askedMs, unreadMs, waits, debtWallMs, debtPeak, awayMs, cappedMs };
}

export function activityStats(sessions: readonly ActivitySession[], from: number, to: number, working?: ReadonlySet<string>): ActivityStats {
  const spans = workingSpans(sessions)
    .map((s) => ({ from: Math.max(s.from, from), to: Math.min(s.to, to) }))
    .filter((s) => s.to > s.from);
  let agentMs = 0;
  for (const s of spans) agentMs += s.to - s.from;
  // A sweep over the edges: the union is the time the open count is above
  // zero, the peak the most it reaches. An end sorts before a start at the
  // same instant, so two spans that touch never count as two open.
  const edges: Array<{ at: number; delta: number }> = [];
  for (const s of spans) edges.push({ at: s.from, delta: 1 }, { at: s.to, delta: -1 });
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let open = 0;
  let peak = 0;
  let wallMs = 0;
  let openedAt = 0;
  for (const e of edges) {
    if (open === 0 && e.delta > 0) openedAt = e.at;
    open += e.delta;
    if (open > peak) peak = open;
    if (open === 0 && e.delta < 0) wallMs += e.at - openedAt;
  }
  return { agentMs, wallMs, parallel: wallMs === 0 ? 0 : agentMs / wallMs, peak, running: working === undefined ? null : runningNow(sessions, working), ...sumRequests(sessions, from, to), ...countCommits(sessions, from, to), ...sumDebt(sessions, from, to) };
}

// The window's debt (M9 fix 231): the per-session sums added up, and the
// same sweep as the working spans' over every waiting stretch for the
// union and the most waiting at once.
function sumDebt(sessions: readonly ActivitySession[], from: number, to: number): Pick<ActivityStats, 'debtMs' | 'askedMs' | 'unreadMs' | 'waits' | 'debtWallMs' | 'debtPeak' | 'awayMs' | 'cappedMs'> {
  let debtMs = 0;
  let askedMs = 0;
  let unreadMs = 0;
  let waits = 0;
  let awayMs = 0;
  let cappedMs = 0;
  for (const s of drawnSessions(sessions)) {
    const d = sessionDebt(s, from, to);
    debtMs += d.debtMs;
    askedMs += d.askedMs;
    unreadMs += d.unreadMs;
    waits += d.waits;
    // A row from a daemon before the field has none.
    awayMs += s.awayMs ?? 0;
    cappedMs += s.cappedMs ?? 0;
  }
  const edges: Array<{ at: number; delta: number }> = [];
  for (const d of debtSpans(sessions)) {
    const a = Math.max(d.from, from);
    const b = Math.min(d.to, to);
    if (b > a) edges.push({ at: a, delta: 1 }, { at: b, delta: -1 });
  }
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let open = 0;
  let debtPeak = 0;
  let debtWallMs = 0;
  let openedAt = 0;
  for (const e of edges) {
    if (open === 0 && e.delta > 0) openedAt = e.at;
    open += e.delta;
    if (open > debtPeak) debtPeak = open;
    if (open === 0 && e.delta < 0) debtWallMs += e.at - openedAt;
  }
  return { debtMs, askedMs, unreadMs, waits, debtWallMs, debtPeak, awayMs, cappedMs };
}

// The debt part of the line (M9 fix 231), `1h 12m waiting on you`, after
// the peak; null at zero, the way the tally is absent when nothing
// landed, so the line never prints a zero.
export function debtStats(stats: ActivityStats): string | null {
  // `!stats.debtMs` rather than `=== 0`: a stats object from before the
  // field (a test's literal) has none and carries no part either.
  if (!stats.debtMs) return null;
  return `${formatSpanLength(stats.debtMs)} waiting on you`;
}

// What the part means, for its tooltip: the split into asked and unread
// with the count of waits, the union (how much of the window had someone
// waiting), and the debt against the agent time.
export function debtStatsTitle(stats: ActivityStats): string | null {
  if (debtStats(stats) === null) return null;
  const waits = `${stats.waits} ${stats.waits === 1 ? 'wait' : 'waits'}`;
  const split = `${formatSpanLength(stats.askedMs)} asked over ${waits}, ${formatSpanLength(stats.unreadMs)} unread past the minute's grace`;
  const union = `${formatSpanLength(stats.debtWallMs)} of the window had someone waiting on you`;
  const share = stats.agentMs === 0 ? '' : `\n${Math.round((stats.debtMs / stats.agentMs) * 100)}% of ${formatSpanLength(stats.agentMs)} agent time`;
  // M9 fix 245: the waiting that fell while nobody was at the box, and
  // so is in none of the figures above.
  const away = !stats.awayMs ? '' : `\n${formatSpanLength(stats.awayMs)} away not counted`;
  // M9 fix 285: the same for the waiting under a capped band.
  const capped = !stats.cappedMs ? '' : `\n${formatSpanLength(stats.cappedMs)} capped not counted`;
  return `${split}\n${union}${share}${away}${capped}`;
}

// The capped part of the line (M9 fix 285), `2h capped`, after the
// waiting part: how much of the window the account was cut off from
// Claude, the bands' union cut to the window (two windows spent at
// once are one stretch of not continuing); null at zero, so the line
// never prints a zero.
export function cappedStats(capped: readonly CappedSpan[], from: number, to: number): string | null {
  const ms = cappedWallMs(capped, from, to);
  return ms === 0 ? null : `${formatSpanLength(ms)} capped`;
}

export function cappedWallMs(capped: readonly CappedSpan[], from: number, to: number): number {
  const cut = capped.map((c) => ({ from: Math.max(c.from, from), to: Math.min(c.to, to) })).filter((c) => c.to > c.from).sort((a, b) => a.from - b.from);
  let ms = 0;
  let openTo = -Infinity;
  for (const c of cut) {
    const start = Math.max(c.from, openTo);
    if (c.to > start) ms += c.to - start;
    openTo = Math.max(openTo, c.to);
  }
  return ms;
}

// What the part means, for its tooltip: each band with its window's name
// (the caller's words, since the names live with the usage strip), when
// it ran and when the window reset; null when there is none.
export function cappedStatsTitle(capped: readonly CappedSpan[], from: number, to: number, name: (window: string) => string): string | null {
  const cut = capped.filter((c) => Math.min(c.to, to) > Math.max(c.from, from));
  if (cut.length === 0) return null;
  return cut.map((c) => `${name(c.window)} spent ${clockTime(Math.max(c.from, from))} to ${clockTime(Math.min(c.to, to))}, reset ${clockTime(c.resetsAt)}`).join('\n');
}

// The commits landed inside the window (M9 fix 218), over every row the
// daemon answered (a shell's lifetime row too: a shell that committed by
// hand is a session, and its commits are its), with the merges counted
// apart and the rows with the most named for the tooltip, most first.
function countCommits(sessions: readonly ActivitySession[], from: number, to: number): Pick<ActivityStats, 'commits' | 'merges' | 'committers'> {
  let commits = 0;
  let merges = 0;
  const byRow = new Map<string, { name: string; commits: number }>();
  for (const s of sessions) {
    let n = 0;
    for (const c of s.commits ?? []) {
      if (c.at < from || c.at >= to) continue;
      n += 1;
      if (c.merge) merges += 1;
    }
    if (n === 0) continue;
    commits += n;
    const key = activityRowKey(s);
    const row = byRow.get(key);
    if (row === undefined) byRow.set(key, { name: s.name ?? (s.agentId !== null && s.agentId !== undefined ? 'agent' : 'no longer listed'), commits: n });
    else row.commits += n;
  }
  const committers = [...byRow.values()].sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  return { commits, merges, committers };
}

// The tally part of the line (M9 fix 218): `14 commits, 3 merges`, `1
// commit`, `2 commits`; null when nothing landed.
export function commitsStats(stats: ActivityStats): string | null {
  if (!stats.commits) return null;
  const commits = `${stats.commits} ${stats.commits === 1 ? 'commit' : 'commits'}`;
  if (!stats.merges) return commits;
  return `${commits}, ${stats.merges} ${stats.merges === 1 ? 'merge' : 'merges'}`;
}

// What the tally means, for its tooltip and the line's card: the rows
// that landed the most, up to three.
export function commitsStatsTitle(stats: ActivityStats): string | null {
  const tally = commitsStats(stats);
  if (tally === null) return null;
  const top = stats.committers.slice(0, 3).map((c) => `${c.name} ${c.commits}`).join(', ');
  const more = stats.committers.length > 3 ? ` and ${stats.committers.length - 3} more` : '';
  return `${tally} landed by the sessions on the graph: ${top}${more}`;
}

// The window's tokens and cost (M9 fix 217) over the points that opened
// inside it, drawn rows only (a lifetime row has none anyway). A point
// without Claude Code's figure is priced at the rates for its model; a
// model the table does not know prices at nothing and still marks the
// sum an estimate, so the line never claims what it cannot know.
function sumRequests(sessions: readonly ActivitySession[], from: number, to: number): Pick<ActivityStats, 'up' | 'fresh' | 'cacheWrite' | 'cached' | 'down' | 'usd' | 'estimated' | 'requests'> {
  let up = 0;
  let fresh = 0;
  let cacheWrite = 0;
  let cached = 0;
  let down = 0;
  let usd = 0;
  let estimated = false;
  let requests = 0;
  for (const s of drawnSessions(sessions)) {
    for (const r of s.requests ?? []) {
      if (r.at < from || r.at >= to) continue;
      requests += 1;
      up += r.fresh + r.cacheWrite + r.cacheRead;
      fresh += r.fresh;
      cacheWrite += r.cacheWrite;
      cached += r.cacheRead;
      down += r.output;
      if (r.usd !== null) usd += r.usd;
      else {
        estimated = true;
        usd += pricedRequest(r);
      }
    }
  }
  return { up, fresh, cacheWrite, cached, down, usd, estimated, requests };
}

function pricedRequest(r: ActivityRequest): number {
  const rates = ratesFor(r.model);
  return rates === null ? 0 : costParts({ fresh: r.fresh, cacheWrite: r.cacheWrite, cacheRead: r.cacheRead, output: r.output }, rates).total;
}

// The tokens part of the line (M9 fix 217): `↑3.2M ↓84k` and `$12.40`,
// the dollars with the context card's `~` when any request was priced
// from the rates; null when the window has no request points.
export function tokensStats(stats: ActivityStats): { up: string; down: string; usd: string } | null {
  // `!stats.requests` rather than `=== 0`: a stats object from before the
  // field (a test's literal) has none and carries no tokens part either.
  if (!stats.requests) return null;
  return { up: formatTokens(stats.up), down: formatTokens(stats.down), usd: `${stats.estimated ? '~' : ''}${formatUsd(stats.usd)}` };
}

// What the tokens part means, for its tooltip and the line's card: the
// sent count split three ways with the cached share, the received count,
// and where the dollars came from.
export function tokensStatsTitle(stats: ActivityStats): string | null {
  const t = tokensStats(stats);
  if (t === null) return null;
  const share = stats.up === 0 ? 0 : Math.round((stats.cached / stats.up) * 100);
  const sent = `↑${t.up} sent: ${formatTokens(stats.fresh)} fresh · ${formatTokens(stats.cacheWrite)} cache write · ${formatTokens(stats.cached)} cache read (${share}% cached)`;
  const received = `↓${t.down} received`;
  const n = `${stats.requests} ${stats.requests === 1 ? 'request' : 'requests'}`;
  const cost = stats.estimated ? `${t.usd} over ${n}, priced from the rates where Claude Code gave no figure` : `${t.usd}, Claude Code's own figure summed over ${n}`;
  return `${sent}\n${received}\n${cost}`;
}


// The drawn rows the store lists as working, by the key a row is drawn
// under (an agent's under its parent), the same set the strip draws a
// live span from, so the figure and the lane that grows agree.
function runningNow(sessions: readonly ActivitySession[], working: ReadonlySet<string>): number {
  let n = 0;
  for (const s of drawnSessions(sessions)) if (s.spans.length > 0 && working.has(activityRowKey(s))) n++;
  return n;
}

// Sessions on the fewest tracks that keep them from overlapping, in the
// order they started: each session takes the first track whose last span
// ended before its first begins. The card is a few rows tall, so a
// session that never overlaps another shares its row. A lifetime row
// takes no track.
export function packTracks(sessions: readonly ActivitySession[]): ActivitySession[][] {
  const ordered = drawnSessions(sessions).filter((s) => s.spans.length > 0).sort((a, b) => start(a) - start(b));
  const tracks: ActivitySession[][] = [];
  const ends: number[] = [];
  for (const s of ordered) {
    let placed = false;
    for (let i = 0; i < tracks.length; i++) {
      if (ends[i]! < start(s)) {
        tracks[i]!.push(s);
        ends[i] = end(s);
        placed = true;
        break;
      }
    }
    if (!placed) {
      tracks.push([s]);
      ends.push(end(s));
    }
  }
  return tracks;
}

function start(s: ActivitySession): number {
  return s.spans[0]?.from ?? 0;
}

function end(s: ActivitySession): number {
  let e = 0;
  for (const span of s.spans) if (span.to > e) e = span.to;
  return e;
}

// A length in hours and minutes: `6h 12m`, `40m`, and seconds under a
// minute, `12s`, so the first turn of the day does not read as nothing.
export function formatSpanLength(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes === 0) return `${Math.round(ms / 1000)}s`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

// `6h 12m agent time in 3h 40m · 1.7× parallel · peak 4`, with
// ` · 3 running now` on a window on the clock (M9 fix 207; `0 running
// now` once they stop, so the line keeps its shape); `nothing yet`
// before any session has worked.
export function statsText(stats: ActivityStats): string {
  if (stats.agentMs === 0) return 'nothing yet';
  const tokens = tokensStats(stats);
  const parts = [statsFigures(stats), debtStats(stats), commitsStats(stats), tokens === null ? null : `↑${tokens.up} ↓${tokens.down} · ${tokens.usd}`, runningText(stats)];
  return parts.filter((p): p is string => p !== null).join(' · ');
}

// The window's own figures, the head of the line: the agent time, the
// wall time, the parallelism and the peak.
export function statsFigures(stats: ActivityStats): string {
  return `${formatSpanLength(stats.agentMs)} agent time in ${formatSpanLength(stats.wallMs)} · ${stats.parallel.toFixed(1)}× parallel · peak ${stats.peak}`;
}

// The live pair's words, `7 running now`, on their own so the activity
// view can set the token bars (M9 fix 216) between the window's figures
// and the count; null on a window that is not on the clock.
export function runningText(stats: ActivityStats): string | null {
  return stats.running === null ? null : `${stats.running} running now`;
}

// The local day a time falls in, as `YYYY-MM-DD`, and the bounds of a day
// named that way: local midnight to the next.
export function dayKey(at: number): string {
  const d = new Date(at);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function dayBounds(key: string): { from: number; to: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const from = new Date(y, mo - 1, d).getTime();
  const to = new Date(y, mo - 1, d + 1).getTime();
  if (Number.isNaN(from) || dayKey(from) !== key) return null;
  return { from, to };
}

// The clock time of an instant, `09:12`, local.
export function clockTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// The activity view's zoom (M67): a window is one whole unit of local
// time, named by its start the way a day is named, `2026-09-13` for a
// day, `2026-09-13T14` for an hour, `2026-09-13T14:07` for a minute, so
// the unit is read off the key's own form and a tab path carries both.
// M9 fix 230: a week too, Monday 00:00 to the next Monday, keyed as the
// Monday's day key with a `w` after it (`2026-09-14w`), so the day
// arithmetic below carries over; widest first, as the list is ordered.
// M9 fix 321: the account's current five-hour usage window, keyed by
// its start minute with an `f` after it (`2026-09-19T13:40f`), so the
// view shows what ran in the window being paid for. Its start is the
// usage reading's, not the clock's, so unitKey cannot name it from an
// instant; a caller takes the key from fiveHourKey on the window's
// start, and the current window only, since past windows are not kept.
export type ActivityUnit = 'week' | 'day' | 'five-hour' | 'hour' | 'minute';

export const ACTIVITY_UNITS: readonly ActivityUnit[] = ['week', 'day', 'five-hour', 'hour', 'minute'];

const FIVE_HOURS_MS = 5 * 3_600_000;

// The unit's word on a button (`5h`) and in a sentence (`five-hour
// window`); every other unit is its own name both ways.
export function unitLabel(unit: ActivityUnit): string {
  return unit === 'five-hour' ? '5h' : unit;
}

export function unitWord(unit: ActivityUnit): string {
  return unit === 'five-hour' ? 'five-hour window' : unit;
}

// The key of the five-hour window starting at `from`: the start's
// minute, so the reading's seconds are dropped and the key is a minute
// key with an `f` after it.
export function fiveHourKey(from: number): string {
  return `${unitKey('minute', from)}f`;
}

// The days of the week as a day's key names them.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// `Thu 10`, the short name a week's row and its stats carry.
export function shortDayName(at: number): string {
  const d = new Date(at);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
}

// The Monday of the week an instant falls in, as a day key.
function mondayKey(at: number): string {
  const d = new Date(at);
  const back = (d.getDay() + 6) % 7;
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12).getTime());
}

export interface ActivityWindow {
  unit: ActivityUnit;
  key: string;
  from: number;
  to: number;
}

const two = (n: number) => String(n).padStart(2, '0');

// The key of the unit an instant falls in. The five-hour window has no
// key an instant gives (its start is the reading's), so a caller on it
// is a bug and throws, which the tests find.
export function unitKey(unit: ActivityUnit, at: number): string {
  if (unit === 'five-hour') throw new Error('a five-hour window is keyed by its start (fiveHourKey), not by an instant');
  if (unit === 'week') return `${mondayKey(at)}w`;
  const day = dayKey(at);
  if (unit === 'day') return day;
  const d = new Date(at);
  const key = unit === 'hour' ? `${day}T${two(d.getHours())}` : `${day}T${two(d.getHours())}:${two(d.getMinutes())}`;
  // The local fields alone name the first occurrence of a time the
  // autumn clock change repeats (M9 fix 518); `new Date` resolves them
  // there too, so an instant a whole unit past that is the second one,
  // keyed with a `b`.
  const first = unit === 'hour'
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime()
    : new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()).getTime();
  return at - first >= (unit === 'hour' ? 3_600_000 : 60_000) ? `${key}b` : key;
}

// The window a key names, or null for a key of no known form or one
// that names no real time (a 25th hour, a day that does not exist). An
// hour's end is sixty minutes on and a minute's sixty seconds, real
// lengths, so the hour a clock change skips is still one hour wide. The
// hour or minute an autumn change repeats has two keys since M9 fix
// 518: the first occurrence is keyed as any other, the second with a
// `b` after the hour or the minute (`T01b`, `T01:30b`, `T01:40bf`), so
// a step can land on it and past it.
export function unitBounds(key: string): ActivityWindow | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2})(?::(\d{2}))?(b)?(f)?|(w))?$/.exec(key);
  if (m === null) return null;
  if (m[5] !== undefined) {
    // A five-hour window (M9 fix 321) is its start minute and five hours
    // on, a real length like the hour's.
    const start = unitBounds(key.slice(0, -1));
    if (start === null || start.unit !== 'minute') return null;
    return { unit: 'five-hour', key, from: start.from, to: start.from + FIVE_HOURS_MS };
  }
  const day = dayBounds(m[1]!);
  if (day === null) return null;
  if (m[6] !== undefined) {
    // A week is named by its Monday alone; a key on any other day names
    // no window, so a tab path carries one key per week.
    if (new Date(day.from).getDay() !== 1) return null;
    const bounds = weekBounds(day.from);
    return { unit: 'week', key, from: bounds.from, to: bounds.to };
  }
  if (m[2] === undefined) return { unit: 'day', key, from: day.from, to: day.to };
  const hour = Number(m[2]);
  if (hour > 23) return null;
  const [y, mo, d] = m[1]!.split('-').map(Number) as [number, number, number];
  // The second occurrence starts the change's shift after the first: the
  // offset two hours on, past any change, against the offset at the
  // first. No shift (or a spring one) means nothing repeats that night.
  const repeated = (first: number): number | null => {
    if (m[4] === undefined) return first;
    const shift = new Date(first + 7_200_000).getTimezoneOffset() - new Date(first).getTimezoneOffset();
    return shift > 0 ? first + shift * 60_000 : null;
  };
  if (m[3] === undefined) {
    const from = repeated(new Date(y, mo - 1, d, hour).getTime());
    if (from === null || unitKey('hour', from) !== key) return null;
    return { unit: 'hour', key, from, to: from + 3_600_000 };
  }
  const minute = Number(m[3]);
  if (minute > 59) return null;
  const from = repeated(new Date(y, mo - 1, d, hour, minute).getTime());
  if (from === null || unitKey('minute', from) !== key) return null;
  return { unit: 'minute', key, from, to: from + 60_000 };
}

// The key one unit before or after: a day steps from its midnight to
// the noon of the neighbouring day, so a clock change never lands two
// days away or on the same day; an hour or a minute steps by its own
// length.
export function stepWindow(window: ActivityWindow, delta: number): string {
  // The five-hour window has no neighbours (M9 fix 321): the current
  // window is the only one the reading names, so a step stays put.
  if (window.unit === 'five-hour') return window.key;
  if (window.unit === 'day') return dayKey(window.from + (delta * 24 + 12) * 3_600_000);
  if (window.unit === 'week') return unitKey('week', window.from + (delta * 7 * 24 + 12) * 3_600_000);
  return unitKey(window.unit, window.from + delta * (window.to - window.from));
}

// The window's name for a title: the day, `14:00 to 15:00`, `14:07`, or
// `week of Mon 14 Sep`.
export function windowName(window: ActivityWindow): string {
  if (window.unit === 'day') return window.key;
  if (window.unit === 'week') {
    const d = new Date(window.from);
    return `week of ${shortDayName(window.from)} ${MONTHS[d.getMonth()]}`;
  }
  const start = clockTime(window.from);
  const name = window.unit === 'hour' || window.unit === 'five-hour' ? `${start} to ${clockTime(window.to)}` : start;
  // The second occurrence of an hour the autumn change repeats (M9 fix
  // 518) says so; the first reads as the arithmetic gives it.
  return window.key.includes('b') ? `${name} (repeated)` : name;
}

// `history from Sep 21`, how far back the activity log reaches (M9 fix
// 607); the year follows the day when it is not now's year, `history
// from Dec 30, 2025`.
export function historyFromText(at: number, now: number): string {
  const d = new Date(at);
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `, ${d.getFullYear()}`;
  return `history from ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

// The order of two window keys by their start, since a string compare
// puts `T01:45` after `T01:05b` (M9 fix 518); a key that names no window
// falls back to the string order.
export function compareKeys(a: string, b: string): number {
  const x = unitBounds(a);
  const y = unitBounds(b);
  if (x === null || y === null) return a < b ? -1 : a > b ? 1 : 0;
  return x.from - y.from;
}

// The seven days of the week from a Monday's midnight (M9 fix 230), each
// a local day (a clock-change day is 23 or 25 hours long, as dayBounds
// gives it), and the week's own bounds, the first day's start to the
// last day's end.
export function weekDays(mondayFrom: number): Array<{ key: string; from: number; to: number }> {
  const start = new Date(mondayFrom);
  const days: Array<{ key: string; from: number; to: number }> = [];
  for (let i = 0; i < 7; i++) {
    const key = dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12).getTime());
    const bounds = dayBounds(key);
    if (bounds !== null) days.push({ key, ...bounds });
  }
  return days;
}

function weekBounds(mondayFrom: number): { from: number; to: number } {
  const days = weekDays(mondayFrom);
  return { from: days[0]!.from, to: days[days.length - 1]!.to };
}
