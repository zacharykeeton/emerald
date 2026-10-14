import { activityRowKey, drawnSessions, formatTokens } from '@emerald/shared';
import type { ActivitySession } from '@emerald/shared';

// The token bars on the activity view's stats line (M9 fix 216): M39's
// little bar graph back, summed over the agents the view draws. Each bar
// is one BUCKET_MS bucket of output tokens, the newest at the right, and
// the height is M41's log curve over a floor, so a quiet bucket still
// draws a stub and a busy one fills the box. The tokens are each working
// session's `tokens.output` delta since its last status line, read off
// the store's pushes as they land, binned by the moment the tokens were
// made. The ring is the view's own: started when it opens, reset when
// its scope changes, and never persisted, since the status lines that
// fed it are not asked for again.
//
// M9 fix 229: the bars at the source's pace. bench-status-cadence.mjs
// over a busy day's hooks.jsonl found a request streaming posts a line
// every 2.4 s at the median with some 500 tokens each, and six requests
// in ten (the tool calls) post one line at their end, 2 to 10 s after
// the last; no second saw more than two lines from one session, so
// nothing coalesces on the way. So the bucket is a second, not five, the
// ring 24 s across, a full bar the hundred or so tokens a second one
// agent streams times a few, and a delta is spread over the seconds
// since the row's last line rather than dropped whole into the newest
// bucket: a 2 s tool call and a 20 s reply draw as their shapes rather
// than one lump each, and the newest bar grows as each delta lands.

export const BUCKET_MS = 1000;
export const BAR_COUNT = 24;
// A bucket this full is a full-height bar: a few agents streaming flat
// out, at the hundred or so tokens a second each writes.
export const FULL_TOKENS = 400;
export const BAR_FLOOR = 0.18;

export interface TokenRing {
  // The bucket index (at / BUCKET_MS) of the newest bar.
  head: number;
  // BAR_COUNT sums, oldest first, the newest last; fractional, since a
  // spread delta lands in parts.
  buckets: readonly number[];
  // The output count last seen per row key and when the count last
  // moved, so the next delta can be read and spread over the time it
  // took; a key seen for the first time counts nothing yet.
  seen: ReadonlyMap<string, { output: number; at: number }>;
  // The row keys the last reading carried: a key back after an absence
  // (a session working again after a turn at rest) starts its clock
  // over, since the tokens of its first line were not made while it sat
  // idle.
  read: ReadonlySet<string>;
  // The row keys that fed the newest bucket.
  agents: ReadonlySet<string>;
}

export function emptyRing(at: number): TokenRing {
  return { head: Math.floor(at / BUCKET_MS), buckets: new Array<number>(BAR_COUNT).fill(0), seen: new Map(), read: new Set(), agents: new Set() };
}

// One reading of the store: the output count per row key of every drawn
// session working now. An agent's row has no status line of its own (its
// tokens are in its parent's), so the parent's key is the one read.
export interface OutputReading {
  key: string;
  output: number;
}

export function readOutputs(sessions: readonly ActivitySession[], store: ReadonlyMap<string, { state: string; tokens: { output: number } | null }>): OutputReading[] {
  const out: OutputReading[] = [];
  const done = new Set<string>();
  for (const s of drawnSessions(sessions)) {
    if (s.agentId !== null && s.agentId !== undefined) continue;
    const key = activityRowKey(s);
    if (done.has(key)) continue;
    done.add(key);
    const info = store.get(s.sessionId);
    if (info === undefined || info.state !== 'working' || info.tokens === null) continue;
    out.push({ key, output: info.tokens.output });
  }
  return out;
}

// The ring after a reading at `at`: the buckets slide so the newest is
// the one `at` falls in (a long gap zeroes them all), and each row's
// delta since its last reading is spread over the buckets between the
// time its count last moved and now, at one rate, the part older than
// the ring dropped. A count that went down (a /clear, a resume of
// another conversation) starts over rather than counting a negative.
export function feedRing(ring: TokenRing, at: number, readings: readonly OutputReading[]): TokenRing {
  const head = Math.floor(at / BUCKET_MS);
  const moved = Math.max(0, head - ring.head);
  let buckets: number[];
  if (moved === 0) buckets = [...ring.buckets];
  else if (moved >= BAR_COUNT) buckets = new Array<number>(BAR_COUNT).fill(0);
  else buckets = [...ring.buckets.slice(moved), ...new Array<number>(moved).fill(0)];
  const agents = new Set<string>(moved === 0 ? ring.agents : []);
  const seen = new Map(ring.seen);
  const read = new Set<string>();
  for (const r of readings) {
    const last = seen.get(r.key);
    read.add(r.key);
    agents.add(r.key);
    if (last === undefined || r.output < last.output) {
      seen.set(r.key, { output: r.output, at });
      continue;
    }
    // A row back after an absence makes its tokens from its return, not
    // from its last line before the rest: its clock starts over here.
    const since = ring.read.has(r.key) ? last.at : at;
    if (r.output === last.output) {
      if (since !== last.at) seen.set(r.key, { output: last.output, at: since });
      continue;
    }
    spread(buckets, head, since, at, r.output - last.output);
    seen.set(r.key, { output: r.output, at });
  }
  return { head, buckets, seen, read, agents };
}

// `tokens` made between `from` and `to`, at one rate, into the buckets
// of a ring whose newest is `head`: each bucket takes the share of the
// stretch it covers, the newest up to `to` itself. A stretch of no
// length lands whole in the newest bucket.
function spread(buckets: number[], head: number, from: number, to: number, tokens: number): void {
  if (to <= from) {
    buckets[BAR_COUNT - 1] = (buckets[BAR_COUNT - 1] ?? 0) + tokens;
    return;
  }
  const rate = tokens / (to - from);
  for (let i = 0; i < BAR_COUNT; i++) {
    const bucket = head - (BAR_COUNT - 1 - i);
    const start = Math.max(from, bucket * BUCKET_MS);
    const end = Math.min(to, (bucket + 1) * BUCKET_MS);
    if (end > start) buckets[i] = (buckets[i] ?? 0) + rate * (end - start);
  }
}

// The bar's height as a share of the box, M41's curve: the floor, then
// log2 of the tokens over log2 of a full bucket.
export function barHeight(tokens: number): number {
  if (tokens <= 0) return BAR_FLOOR;
  return BAR_FLOOR + (1 - BAR_FLOOR) * Math.min(1, Math.log2(1 + tokens) / Math.log2(1 + FULL_TOKENS));
}

// The newest bucket as a whole number, for the tooltip and the script's
// `data-newest`.
export function newestTokens(ring: TokenRing): number {
  return Math.round(ring.buckets[BAR_COUNT - 1] ?? 0);
}

// `1.2k output tokens in the last 1 s across 7 agents`.
export function barsTitle(ring: TokenRing, running: number): string {
  const seconds = BUCKET_MS / 1000;
  const who = running === 1 ? '1 agent' : `${running} agents`;
  return `${formatTokens(newestTokens(ring))} output tokens in the last ${seconds} s across ${who}`;
}
