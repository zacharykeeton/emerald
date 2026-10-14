import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseRunning, summarize } from '@emerald/shared';
import { DEBT_GRACE_MS } from '@emerald/shared';
import { DROPPING_NAME, HOOK_LOG_BUDGET_BYTES, ROTATING_NAME, SLIMMING_NAME, generationNumber, generationPaths, isFullPayloadLine, rotatedPath, slimHookLine } from '@emerald/shared/hook-log';
import type { ActivityCommit, ActivityRequest, ActivitySession, ActivitySpan, CappedSpan, DebtKind, DebtSpan, HookPayload, PresenceKind, SessionCommit, SessionInfo, SessionState } from '@emerald/shared';
import type { Logger } from './log.ts';

// The day's activity (M54): which stretches each session spent working,
// rebuilt from hooks.jsonl. The sink writes one line per accepted hook
// with the state change it made (from, to), so a session's working spans
// are the intervals from a line that took it into `working` to the next
// line that took it out; the log is read once when the daemon starts and
// every line the sink accepts after that is recorded as it lands, so the
// answer never re-reads the file. The prompt on a span is the last
// UserPromptSubmit the session posted before it opened.
//
// The subagents a session sent out are tracked beside it (M62): the
// parent's own SubagentStart and SubagentStop lines carry the agent's id
// and type, the Agent tool's PostToolUse its description, and a Stop
// says which background tasks still run, so an agent whose stop never
// came is closed at the parent's first Stop that does not list it. The
// lines were in the log all along (the sink writes every hook); only the
// reading is new, so the days before this landed gain their agents too.
//
// The requests a session made are kept per track too (M9 fix 217), as
// points folded from its StatusLine lines by the rule the record's
// running sum uses: a line whose input split equals the last is the
// same request streaming and replaces the point's output and cost, a
// new split opens a point at its line's time. Read from the same lines,
// so the days before this landed have their points too.
//
// The stretches a session spent waiting on the person (M9 fix 231) are
// read off the same lines: `asked` from a line into needs-input to the
// line out of it, `unread` from a line into done to the line out, less
// the grace. The two states are the two kinds, so one open stretch per
// track is enough, closed where the state it stands for ends; a line
// that finds the track in another state than the open stretch's (a
// daemon that died mid-wait) closes it there.
// A conversation emerald did not start (M9 fix 233) has a track like any
// other, under the conversation's own id, since the hook script posts
// it that way; its lines carry the unhosted mark and the folder the
// hooks named, so the track says it was outside and where it ran, and
// the daemon's bare record for it (unhosted.ts) is handed in beside the
// sessions so its open span runs to now while it works. One resumed in
// a pane later is the record's conversation, and its outside track
// joins the record's row.

// What a hooks.jsonl line carries that matters here. The sink writes more
// (the outcome, the whole payload); the rest is not kept.
export interface ActivityLine {
  at: number;
  sessionId: string;
  event: string | null;
  from: string | null;
  to: string | null;
  prompt: string | null;
  // The payload's session_id, Claude's own id for the conversation (M57).
  claudeSessionId: string | null;
  // The agent a team line is about (M62): SubagentStart and SubagentStop
  // name it in agent_id, the Agent tool's PostToolUse in its response.
  agentId: string | null;
  agentType: string | null;
  description: string | null;
  // A Stop's background tasks still running, by id; null on any other
  // line. An older Claude Code sends none, which reads as an empty list.
  running: string[] | null;
  // A StatusLine's request counts (M9 fix 217), null on any other line
  // and on a status line without them (the fakes the verify scripts
  // post carry a percentage alone); its cost so far and its model.
  usage: { fresh: number; cacheWrite: number; cacheRead: number; output: number } | null;
  usd: number | null;
  model: string | null;
  // The sink's unhosted mark (M9 fix 233) and the folder the hook named,
  // read for such a line only.
  unhosted: boolean;
  cwd: string | null;
}

// A presence line (M9 fix 245): no session, just the edge and when. The
// daemon writes one when its last app window detaches and when the next
// attaches, and when the app posts presence.away or presence.back off
// the lock screen, sleep and the idle clock.
export interface PresenceLine {
  at: number;
  presence: PresenceKind;
}

// A usage line (M9 fix 285): no session either, the edge the app posted
// when a usage window reached 100 percent (with its reset) or dropped
// under, written as the daemon's own line beside the presence ones.
export type UsageLine = { at: number; capped: { window: string; resetsAt: number } } | { at: number; freed: { window: string } };

// A stretch of time, an away or a capped one, for the docking.
interface Stretch {
  from: number;
  to: number;
}

// A request point with what the folding needs beside it: the cost the
// track had reached when the point opened, so the point's cost is the
// delta to the line's total; and when a line last touched it, so a
// caller asking for the points since its last ask gets a streaming
// update to a point that opened before it.
interface RequestPoint extends ActivityRequest {
  usdBefore: number | null;
  updatedAt: number;
}

// What a process's first status line can carry and still be its first
// (M9 fix 462): a first request costs cents, a rotated-away history dollars.
const FIRST_REQUEST_USD = 0.5;

interface Track {
  spans: ActivitySpan[];
  open: ActivitySpan | null;
  // The waiting stretches (M9 fix 231), closed ones and the open one,
  // the latter by the instant its state began; the grace and the away
  // stretches (M9 fix 245) are applied when it is read, so a closed one
  // here runs from the line into the state to the line out.
  debt: DebtSpan[];
  openDebt: { at: number; kind: DebtKind } | null;
  lastPrompt: string | null;
  lastAt: number;
  claudeSessionId: string | null;
  // The request points (M9 fix 217), oldest first; the last one is still
  // open to the next streaming line.
  requests: RequestPoint[];
  // The last status line's input split, which says whether the next line
  // is the same request; and the last cost total seen on any line.
  split: { fresh: number; cacheWrite: number; cacheRead: number } | null;
  lastUsd: number | null;
  // A SessionStart line was seen on the track (M9 fix 462), so its first
  // status line is its process's first and prices from nothing.
  started: boolean;
  // The conversation was not emerald's (M9 fix 233): any of its lines
  // carried the mark; and the folder its last such line named.
  outside: boolean;
  cwd: string | null;
}

interface AgentTrack {
  parentId: string;
  agentId: string;
  type: string | null;
  description: string | null;
  from: number;
  // Null while the agent is still out.
  to: number | null;
}

// Lines that are not JSON, or not shaped like the sink's, are skipped: the
// log is append-only and a daemon killed mid-write leaves a torn last line.
export function parseLogLine(raw: string): ActivityLine | PresenceLine | UsageLine | null {
  let line: unknown;
  try {
    line = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof line !== 'object' || line === null) return null;
  const l = line as Record<string, unknown>;
  if (typeof l['at'] !== 'number') return null;
  if (l['presence'] === 'away' || l['presence'] === 'back') return { at: l['at'], presence: l['presence'] };
  const usage = parseUsageLine(l['at'], l['capped'], l['freed']);
  if (usage !== null) return usage;
  if (typeof l['sessionId'] !== 'string') return null;
  const payload = typeof l['payload'] === 'object' && l['payload'] !== null ? (l['payload'] as HookPayload) : {};
  return lineOf(l['at'], l['sessionId'], typeof l['event'] === 'string' ? l['event'] : null, l['from'], l['to'], payload, l['unhosted'] === true);
}

// A hook's line alone; a presence line (M9 fix 245) and a usage line
// (M9 fix 285) read as null here.
export function parseActivityLine(raw: string): ActivityLine | null {
  const line = parseLogLine(raw);
  return line !== null && 'sessionId' in line ? line : null;
}

function parseUsageLine(at: number, capped: unknown, freed: unknown): UsageLine | null {
  if (typeof capped === 'object' && capped !== null) {
    const c = capped as Record<string, unknown>;
    if (typeof c['window'] === 'string' && typeof c['resetsAt'] === 'number') return { at, capped: { window: c['window'], resetsAt: c['resetsAt'] } };
  }
  if (typeof freed === 'object' && freed !== null) {
    const f = freed as Record<string, unknown>;
    if (typeof f['window'] === 'string') return { at, freed: { window: f['window'] } };
  }
  return null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

// The rotated generations hold slimmed payloads (M9 fix 629): every
// payload field read here is kept by slimHookLine in
// @emerald/shared/hook-log, and a field newly read here is added there,
// or the history before the last rotation reads without it. The fix 629
// test that loads a fixture whole and slimmed fails until it is.
function lineOf(at: number, sessionId: string, event: string | null, from: unknown, to: unknown, payload: HookPayload, unhosted: boolean = false): ActivityLine {
  const line: ActivityLine = {
    at,
    sessionId,
    event,
    from: typeof from === 'string' ? from : null,
    to: typeof to === 'string' ? to : null,
    prompt: event === 'UserPromptSubmit' ? summarize(payload.prompt) : null,
    claudeSessionId: typeof payload.session_id === 'string' && payload.session_id !== '' ? payload.session_id : null,
    agentId: null,
    agentType: null,
    description: null,
    running: null,
    usage: null,
    usd: null,
    model: null,
    unhosted,
    cwd: unhosted ? nonEmpty(payload.cwd) : null,
  };
  if (event === 'StatusLine') {
    const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
    const usage = payload.context_window?.current_usage;
    const fresh = count(usage?.input_tokens);
    const cacheWrite = count(usage?.cache_creation_input_tokens);
    const cacheRead = count(usage?.cache_read_input_tokens);
    if (fresh !== null && cacheWrite !== null && cacheRead !== null) line.usage = { fresh, cacheWrite, cacheRead, output: count(usage?.output_tokens) ?? 0 };
    const usd = payload.cost?.total_cost_usd;
    line.usd = typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : null;
    const m = payload.model;
    line.model = nonEmpty(m?.display_name) ?? nonEmpty(m?.id);
  } else if (event === 'SubagentStart' || event === 'SubagentStop') {
    line.agentId = nonEmpty(payload.agent_id);
    line.agentType = nonEmpty(payload.agent_type);
  } else if (nonEmpty(payload.agent_id) !== null) {
    // Fired inside a subagent: the state machine ignores it and so does
    // the log; an inner agent's Agent tool call is not the parent's.
  } else if (event === 'PostToolUse' && payload.tool_name === 'Agent') {
    const response = typeof payload.tool_response === 'object' && payload.tool_response !== null ? (payload.tool_response as { agentId?: unknown; description?: unknown }) : null;
    line.agentId = nonEmpty(response?.agentId);
    line.description = summarize(typeof response?.description === 'string' ? response.description : payload.tool_input?.description);
    line.agentType = nonEmpty(payload.tool_input?.subagent_type);
  } else if (event === 'Stop') {
    line.running = parseRunning(payload.background_tasks)
      .map((t) => t.id)
      .filter((id): id is string => id !== null);
  }
  return line;
}

function agentKey(parentId: string, agentId: string): string {
  return `${parentId}\0${agentId}`;
}

// The log is rotated at the daemon's start (M9 fix 377) and on an hourly
// check while it runs (M9 fix 429, since a daemon up for weeks grew the
// current file without bound): a hooks.jsonl past this size becomes
// hooks.1.jsonl and the sink opens a fresh file. The load reads the older generations first, so nothing is
// lost and the big file is neither rewritten nor read whole into a
// string; a test sets the threshold low.
export const ROTATE_AT_BYTES = 64 * 1024 * 1024;

// The hooks that may land while the log loads in the background (M9 fix
// 517) before the oldest is dropped: about a day of a busy box's hooks,
// against a load of a few seconds.
export const HELD_DURING_LOAD = 10_000;

// The generations' names and count live in @emerald/shared/hook-log since
// M9 fix 430, so `emmer explain` reads the same files; re-exported here
// for the daemon's own callers and tests.
export { DROPPING_NAME, HOOK_LOG_BUDGET_BYTES, ROTATING_NAME, SLIMMING_NAME, generationPaths, rotatedPath };

// A file passed line by line into another, synchronously, in 1 MB chunks
// split on the newline byte (M9 fix 629): a generation can be hundreds of
// megabytes, past V8's string limit, so it is never read whole. `each`
// gets a line without its newline and returns what to write in its place,
// or null to drop it; a last line with no newline is written without one.
// Returns the bytes written. A failure throws, the temporary left to the
// caller to remove.
export function passLinesSync(from: string, to: string, each: (raw: string) => string | null): number {
  const fd = fs.openSync(from, 'r');
  let out: number | null = null;
  try {
    out = fs.openSync(to, 'w');
    const chunk = Buffer.alloc(1024 * 1024);
    let carry: Buffer = Buffer.alloc(0);
    let written = 0;
    const write = (text: string): void => {
      const buf = Buffer.from(text, 'utf8');
      fs.writeSync(out!, buf, 0, buf.length);
      written += buf.length;
    };
    for (;;) {
      const got = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (got === 0) break;
      const data = carry.length === 0 ? chunk.subarray(0, got) : Buffer.concat([carry, chunk.subarray(0, got)]);
      let start = 0;
      for (let nl = data.indexOf(0x0a, start); nl >= 0; nl = data.indexOf(0x0a, start)) {
        const kept = each(data.subarray(start, nl).toString('utf8'));
        if (kept !== null) write(kept + '\n');
        start = nl + 1;
      }
      // Copied, since the chunk is reused by the next read.
      carry = Buffer.from(data.subarray(start));
    }
    if (carry.length > 0) {
      const kept = each(carry.toString('utf8'));
      if (kept !== null) write(kept);
    }
    fs.closeSync(out);
    out = null;
    return written;
  } finally {
    if (out !== null) fs.closeSync(out);
    fs.closeSync(fd);
  }
}


// The shift itself, run by the load at the daemon's start and by the
// sink's hourly check while it runs (M9 fix 429): every generation shifts
// one up, the current file becomes generation 1, and the oldest go while
// the generations' total is past the budget (M9 fix 629; a fixed three
// were kept from fix 415). Any file can be held by another program
// without delete sharing (an editor, a `Get-Content -Wait`, a scan), so
// every step is a rename that can be undone until the last: the current
// file goes to ROTATING_NAME first (M9 fix 465: the shift used to run
// first, so a held current file lost a generation at each hourly retry),
// then the shift, highest first, then ROTATING_NAME slimmed into
// generation 1 through SLIMMING_NAME (M9 fix 629; a crash mid-slim is
// recovered by the next open). A failure anywhere puts back what moved,
// in reverse, so a held generation leaves every file as it was (M9 fix
// 555: the oldest was removed before the held rename was met, and with
// generation 2 held the temporary was renamed over generation 1). Only
// once all of that has worked are the oldest dropped past the budget,
// each through DROPPING_NAME so `emmer explain` still reads it mid-drop.
// True when it rotated.
export function rotateHookLog(file: string, log: Logger, budgetBytes: number = HOOK_LOG_BUDGET_BYTES): boolean {
  const started = Date.now();
  const dir = path.dirname(file);
  const rotating = path.join(dir, ROTATING_NAME);
  const dropping = path.join(dir, DROPPING_NAME);
  const slimming = path.join(dir, SLIMMING_NAME);
  const first = rotatedPath(file, 1);
  let size = 0;
  try {
    size = fs.statSync(file).size;
    fs.renameSync(file, rotating);
  } catch (err) {
    log.warn('hooks.jsonl could not be rotated', err);
    return false;
  }
  // Each rename done, so a failure can undo them newest first.
  const done: Array<[string, string]> = [[file, rotating]];
  const move = (from: string, to: string): void => {
    fs.renameSync(from, to);
    done.push([from, to]);
  };
  // hooks.1.jsonl's bytes once written, for the log line.
  let slimmed = size;
  try {
    // Highest first, so no rename lands on a name still taken.
    for (const gen of generationPaths(file).slice(0, -1)) move(gen, rotatedPath(file, generationNumber(file, gen) + 1));
    // Generation 1 keeps only what the activity view reads (M9 fix 629),
    // written beside ROTATING_NAME and renamed into place once whole, so
    // ROTATING_NAME gone means the temporary is complete. A slim that
    // fails rotates the file whole, as before, and the next load's pass
    // slims it.
    let bytes: number | null = null;
    try {
      bytes = passLinesSync(rotating, slimming, rotatedLine);
    } catch (err) {
      log.warn('hooks.jsonl could not be slimmed, rotated whole', err);
      fs.rmSync(slimming, { force: true });
    }
    if (bytes === null) {
      fs.renameSync(rotating, first);
    } else {
      try {
        fs.rmSync(rotating, { force: true });
      } catch (err) {
        // Still whole under ROTATING_NAME: undone like any other step.
        fs.rmSync(slimming, { force: true });
        throw err;
      }
      slimmed = bytes;
      // From here the lines live only under SLIMMING_NAME, so the shift is
      // not undone: the next open renames the temporary into place.
      try {
        fs.renameSync(slimming, first);
      } catch (err) {
        log.warn('hooks.slimming.jsonl could not be renamed to hooks.1.jsonl; the next start recovers it', err);
      }
    }
  } catch (err) {
    log.warn('hooks.jsonl could not be rotated', err);
    for (const [from, to] of done.reverse()) {
      try {
        fs.renameSync(to, from);
      } catch (back) {
        log.warn(`${path.basename(from)} could not be put back from ${path.basename(to)}`, back);
      }
    }
    return false;
  }
  log.info('hooks.jsonl rotated', { bytes: size, to: first, slimmed, ms: Date.now() - started });
  dropPastBudget(file, budgetBytes, log);
  return true;
}

// The oldest generations go while the generations' total is past the
// budget and more than one is left (M9 fix 629), each renamed to
// DROPPING_NAME and then removed. A drop that fails stops the drops
// until the next rotation.
function dropPastBudget(file: string, budgetBytes: number, log: Logger): void {
  const dropping = path.join(path.dirname(file), DROPPING_NAME);
  const gens = generationPaths(file)
    .slice(0, -1)
    .map((gen): [string, number] => {
      try {
        return [gen, fs.statSync(gen).size];
      } catch {
        return [gen, 0];
      }
    });
  let total = gens.reduce((sum, [, bytes]) => sum + bytes, 0);
  while (total > budgetBytes && gens.length > 1) {
    const [gen, bytes] = gens.shift()!;
    try {
      fs.renameSync(gen, dropping);
      fs.rmSync(dropping, { force: true });
    } catch (err) {
      log.warn(`${path.basename(gen)} could not be dropped`, err);
      return;
    }
    total -= bytes;
    log.info(`${path.basename(gen)} dropped`, { bytes, kept: total, budget: budgetBytes });
  }
}

// A rotation killed mid-slim (M9 fix 629), put right by the open before
// its size check. ROTATING_NAME present means the slim had not finished:
// its temporary goes and the current file's lines come back as
// hooks.jsonl, which the size check then rotates again. ROTATING_NAME
// gone with SLIMMING_NAME present means the slim finished: the temporary
// becomes generation 1. Where the name a file would go to is taken, both
// are left and warned of. True when hooks.jsonl was put back.
export function recoverRotation(file: string, log: Logger): boolean {
  const dir = path.dirname(file);
  const rotating = path.join(dir, ROTATING_NAME);
  const slimming = path.join(dir, SLIMMING_NAME);
  const first = rotatedPath(file, 1);
  try {
    if (fs.existsSync(rotating)) {
      fs.rmSync(slimming, { force: true });
      if (fs.existsSync(file)) {
        log.warn('hooks.rotating.jsonl left in place');
        return false;
      }
      fs.renameSync(rotating, file);
      log.info('hooks.rotating.jsonl recovered as hooks.jsonl');
      return true;
    }
    if (fs.existsSync(slimming)) {
      if (fs.existsSync(first)) {
        log.warn('hooks.slimming.jsonl left in place');
        return false;
      }
      fs.renameSync(slimming, first);
      log.info('hooks.slimming.jsonl recovered as hooks.1.jsonl');
    }
  } catch (err) {
    log.warn('an interrupted hooks.jsonl rotation could not be recovered', err);
  }
  return false;
}

// A file's lines from the start, synchronously in 1 MB chunks, until
// `each` returns true or `maxBytes` have been read (M9 fix 629).
function scanLinesSync(file: string, maxBytes: number, each: (raw: string) => boolean): void {
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let carry: Buffer = Buffer.alloc(0);
    let read = 0;
    while (read < maxBytes) {
      const got = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (got === 0) break;
      read += got;
      const data = carry.length === 0 ? chunk.subarray(0, got) : Buffer.concat([carry, chunk.subarray(0, got)]);
      let start = 0;
      for (let nl = data.indexOf(0x0a, start); nl >= 0; nl = data.indexOf(0x0a, start)) {
        if (each(data.subarray(start, nl).toString('utf8'))) return;
        start = nl + 1;
      }
      carry = Buffer.from(data.subarray(start));
    }
    if (read < maxBytes && carry.length > 0) each(carry.toString('utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

function parsedLine(raw: string): Record<string, unknown> | null {
  try {
    const line: unknown = JSON.parse(raw);
    return typeof line === 'object' && line !== null && !Array.isArray(line) ? (line as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The verify fixtures that once ran against the real home (M9 fix 629):
// the sessions `verify:hooks` and `verify:cli` post under, and the fake
// Claude runs of the simulators, by the payload's conversation id. Kept
// narrower than every `sim-` id on purpose: `verify:activity` seeds its
// generations under `sim-gen-*`, and those must load.
function isFixtureLine(line: Record<string, unknown>): boolean {
  const sessionId = line['sessionId'];
  if (sessionId === 'nosuch' || sessionId === 'direct-test') return true;
  const payload = line['payload'];
  const conv = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)['session_id'] : undefined;
  return typeof conv === 'string' && (conv.startsWith('sim-claude-') || conv === 'nested-claude-p');
}

// What a rotation writes for one line of the current file (M9 fix 629):
// the slim, with a fixture line dropped.
function rotatedLine(raw: string): string | null {
  const line = parsedLine(raw);
  if (line !== null && typeof line['sessionId'] === 'string' && isFixtureLine(line)) return null;
  return slimHookLine(raw);
}

// The `at` of a file's first line that has one, any kind of line; null
// when none does.
function firstAt(file: string): number | null {
  let at: number | null = null;
  try {
    scanLinesSync(file, Infinity, (raw) => {
      const line = parsedLine(raw);
      if (line !== null && typeof line['at'] === 'number') at = line['at'];
      return at !== null;
    });
  } catch {
    return null;
  }
  return at;
}

// Whether a generation holds payloads as the sink wrote them (M9 fix
// 629), by its first hook line within 4 MB or 20 lines; null when there
// is none that early, which leaves the generation alone.
function holdsFullPayloads(file: string): boolean | null {
  let full: boolean | null = null;
  let lines = 0;
  scanLinesSync(file, 4 * 1024 * 1024, (raw) => {
    lines += 1;
    const line = parsedLine(raw);
    if (line !== null && typeof line['sessionId'] === 'string' && typeof line['payload'] === 'object' && line['payload'] !== null) full = isFullPayloadLine(raw);
    return full !== null || lines >= 20;
  });
  return full;
}

// The restore is the daemon's (M9 fix 629): a generation whose payloads
// are full, one an older daemon rotated or a backup copied in as the
// oldest, is slimmed in place at the start, through `<generation>.slimming`
// renamed over it, newest first. Generations are time-ordered, so a line
// in an older generation at or after the first line of the next newer one
// is a restore's overlap and not history, and goes; so do the verify
// fixtures that once ran against the real home (isFixtureLine). The
// current file is not a generation for the overlap rule: a line in it can
// be stamped under a clock set back (fix 607). Synchronous, as the trim
// is: about 2 s once for three full 64 MB generations, about 5 s for the
// 534 MB backup, and nothing on a start that finds every generation slim.
export function slimGenerations(file: string, log: Logger): void {
  // The next newer generation's first line, as it reads after its pass.
  let newerFrom: number | null = null;
  for (const gen of generationPaths(file).slice(0, -1).reverse()) {
    const name = path.basename(gen);
    let full: boolean | null;
    try {
      full = holdsFullPayloads(gen);
    } catch (err) {
      log.warn(`${name} could not be read for its slim`, err);
      newerFrom = firstAt(gen) ?? newerFrom;
      continue;
    }
    if (full !== true) {
      newerFrom = firstAt(gen) ?? newerFrom;
      continue;
    }
    const started = Date.now();
    const temp = `${gen}.slimming`;
    const cutoff = newerFrom;
    let overlap = 0;
    let fixtures = 0;
    let keptFrom: number | null = null;
    try {
      const from = fs.statSync(gen).size;
      const to = passLinesSync(gen, temp, (raw) => {
        const line = parsedLine(raw);
        if (line !== null) {
          const at = line['at'];
          if (cutoff !== null && typeof at === 'number' && at >= cutoff) {
            overlap += 1;
            return null;
          }
          if (typeof line['sessionId'] === 'string' && isFixtureLine(line)) {
            fixtures += 1;
            return null;
          }
          if (keptFrom === null && typeof at === 'number') keptFrom = at;
        }
        return slimHookLine(raw);
      });
      fs.renameSync(temp, gen);
      log.info(`${name} slimmed`, { from, to, overlap, fixtures, keptFrom: keptFrom === null ? null : new Date(keptFrom).toISOString(), ms: Date.now() - started });
    } catch (err) {
      log.warn(`${name} could not be slimmed`, err);
      try {
        fs.rmSync(temp, { force: true });
      } catch {
        // Left for the next open's sweep.
      }
      newerFrom = firstAt(gen) ?? newerFrom;
      continue;
    }
    newerFrom = keptFrom ?? newerFrom;
  }
}

// A generation is as big as the current file was when it rotated, so one
// from before the live rotation (fix 429) can be hundreds of megabytes
// and is read whole at every start until three more rotations shift it
// out (M9 fix 466, the ledger's M18: 533 MB and 2.3 s on this box). Any
// generation past four times the threshold is cut to its newest
// threshold's worth, from the first whole line on, through a temporary
// renamed over it; the log line names the first kept line's time, which
// is where the activity view's history now starts. A cut that fails is
// logged and the generation left as it was. Run by the load at the start
// and after the live rotation.
export function trimGenerations(file: string, rotateAt: number, log: Logger): void {
  for (const gen of generationPaths(file).slice(0, -1)) {
    let size: number;
    try {
      size = fs.statSync(gen).size;
    } catch {
      continue;
    }
    if (size <= 4 * rotateAt) continue;
    const temp = `${gen}.trimming`;
    let fd: number | null = null;
    let out: number | null = null;
    try {
      fd = fs.openSync(gen, 'r');
      const chunk = Buffer.alloc(Math.min(1024 * 1024, rotateAt));
      let pos = size - rotateAt;
      // Skip the torn line the cut lands in.
      let start = -1;
      while (start < 0 && pos < size) {
        const got = fs.readSync(fd, chunk, 0, chunk.length, pos);
        if (got === 0) break;
        const nl = chunk.subarray(0, got).indexOf(0x0a);
        if (nl >= 0) start = pos + nl + 1;
        else pos += got;
      }
      if (start < 0) start = size;
      out = fs.openSync(temp, 'w');
      let firstLine = '';
      for (let at = start; at < size; ) {
        const got = fs.readSync(fd, chunk, 0, chunk.length, at);
        if (got === 0) break;
        if (at === start) firstLine = chunk.subarray(0, got).toString('utf8').split('\n', 1)[0] ?? '';
        fs.writeSync(out, chunk, 0, got);
        at += got;
      }
      fs.closeSync(out);
      out = null;
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(temp, gen);
      const keptFrom = parseActivityLine(firstLine)?.at;
      log.info(`${path.basename(gen)} trimmed`, {
        from: size,
        to: size - start,
        keptFrom: keptFrom === undefined ? null : new Date(keptFrom).toISOString(),
      });
    } catch (err) {
      log.warn(`${path.basename(gen)} could not be trimmed`, err);
      if (out !== null) fs.closeSync(out);
      if (fd !== null) fs.closeSync(fd);
      fs.rmSync(temp, { force: true });
    }
  }
}

export interface ActivityLoadOptions {
  rotateAtBytes?: number;
  // The test's knob for HOOK_LOG_BUDGET_BYTES, at the open's rotation.
  budgetBytes?: number;
  // The test's knob for HELD_DURING_LOAD.
  heldCap?: number;
}

export class ActivityLog {
  private readonly tracks = new Map<string, Track>();
  private readonly agents = new Map<string, AgentTrack>();
  // The away stretches (M9 fix 245), closed ones and the open one.
  private readonly away: Array<{ from: number; to: number }> = [];
  private awayOpen: number | null = null;
  // The capped stretches (M9 fix 285), the closed bands and the open one
  // per usage window.
  private readonly capped: CappedSpan[] = [];
  private readonly cappedOpen = new Map<string, { from: number; resetsAt: number }>();
  // The background load (M9 fix 517): resolved once every file is read
  // and the hooks that arrived meanwhile are applied; it never rejects.
  // Anything that reads the spans, or writes an edge that must land
  // after the loaded history, waits on it.
  loaded: Promise<void> = Promise.resolve();
  private loading = false;
  private held: ActivityLine[] = [];
  private heldCap = HELD_DURING_LOAD;
  private heldDropped = false;
  private log: Logger | null = null;
  // The earliest `at` of any line recorded, loaded or live (M9 fix 607):
  // how far back the history the daemon answers from reaches. Never
  // recomputed: a rotation or a trim while the daemon runs changes the
  // files, not what is held here.
  private oldest: number | null = null;

  // Opens the log the sink has written so far and reads it in the
  // background, so the daemon's pipe is not held behind it (M9 fix 517:
  // 2.2 to 3.0 s of every installed start). The synchronous part runs
  // here, before the sink opens its append stream: the file is rotated
  // when it is past the threshold, a full-payload generation slimmed in
  // place (M9 fix 629), the old generations trimmed, and each
  // file's size taken. `loaded` then streams every kept generation and
  // the current file line by line, oldest first (M9 fix 377), each up to
  // the size it had here, so a line the sink appends after this is never
  // read from the file; that hook reaches the log once, through
  // recordHook, which holds it until the files are read. A missing file
  // is an empty history, a torn line is skipped, and the loaded line
  // says how many lines each file held, how many hooks were held and how
  // long the read took, for the install note, and the earliest line's
  // time as `oldest` (M9 fix 607).
  static open(file: string, log: Logger, opts: ActivityLoadOptions = {}): ActivityLog {
    const activity = new ActivityLog();
    const started = Date.now();
    const rotateAt = opts.rotateAtBytes ?? ROTATE_AT_BYTES;
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      // No file yet: the sink makes one.
    }
    // A drop a rotation left half done (M9 fix 555): its file would make
    // the next rotation's drop fail, so it goes before the check.
    try {
      fs.rmSync(path.join(path.dirname(file), DROPPING_NAME), { force: true });
    } catch (err) {
      log.warn('hooks.dropping.jsonl could not be removed', err);
    }
    // A generation's in-place slim (M9 fix 629) or trim (M9 fix 650) cut
    // short: each renames its temporary over the generation as its last
    // step, so the generation is still whole and the temporary just goes.
    try {
      for (const name of fs.readdirSync(path.dirname(file))) {
        if (name.endsWith('.jsonl.slimming') || name.endsWith('.jsonl.trimming')) fs.rmSync(path.join(path.dirname(file), name), { force: true });
      }
    } catch {
      // No folder yet.
    }
    if (recoverRotation(file, log)) {
      try {
        size = fs.statSync(file).size;
      } catch {
        // Still none.
      }
    }
    if (size > rotateAt) rotateHookLog(file, log, opts.budgetBytes);
    slimGenerations(file, log);
    trimGenerations(file, rotateAt, log);
    const sizes: Array<[string, number]> = generationPaths(file).map((each) => {
      try {
        return [each, fs.statSync(each).size];
      } catch {
        return [each, 0];
      }
    });
    activity.log = log;
    activity.loading = true;
    activity.heldCap = opts.heldCap ?? HELD_DURING_LOAD;
    activity.loaded = (async () => {
      const counts: Record<string, number> = {};
      try {
        for (const [each, bytes] of sizes) counts[path.basename(each)] = bytes === 0 ? 0 : await activity.readFile(each, log, bytes);
      } catch (err) {
        log.warn('activity log load failed', err);
      }
      const held = activity.held;
      activity.held = [];
      activity.loading = false;
      for (const line of held) activity.record(line);
      log.info('activity log loaded', { ...counts, held: held.length, ms: Date.now() - started, sessions: activity.tracks.size, agents: activity.agents.size, oldest: activity.oldest === null ? null : new Date(activity.oldest).toISOString() });
    })();
    return activity;
  }

  // open, then its load awaited: the tests' and the tools' form.
  static async load(file: string, log: Logger, opts: ActivityLoadOptions = {}): Promise<ActivityLog> {
    const activity = ActivityLog.open(file, log, opts);
    await activity.loaded;
    return activity;
  }

  // One file's lines up to `bytes`, streamed; the count of lines that
  // parsed.
  private async readFile(file: string, log: Logger, bytes: number): Promise<number> {
    let lines = 0;
    let stream: fs.ReadStream;
    try {
      stream = fs.createReadStream(file, { encoding: 'utf8', end: bytes - 1 });
      // The open error surfaces on the stream, not the call; wait for it
      // here so a missing file is a quiet zero rather than a rejection
      // from inside the reader.
      await new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve());
        stream.once('error', reject);
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`${path.basename(file)} could not be read for the activity log`, err);
      return 0;
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const raw of rl) {
      if (raw.trim() === '') continue;
      const line = parseLogLine(raw);
      if (line === null) continue;
      this.record(line);
      lines += 1;
    }
    return lines;
  }

  // The same line the sink writes, as the handler saw it.
  // While the log loads (M9 fix 517) the line is held, and applied in
  // order after the files; past the cap the oldest held line goes, with
  // one warn.
  recordHook(sessionId: string, payload: HookPayload, at: number, result: { from?: string; to?: string }, unhosted: boolean = false): void {
    const line = lineOf(at, sessionId, payload.hook_event_name ?? null, result.from, result.to, payload, unhosted);
    if (!this.loading) {
      this.record(line);
      return;
    }
    this.held.push(line);
    if (this.held.length > this.heldCap) {
      this.held.shift();
      if (!this.heldDropped) {
        this.heldDropped = true;
        this.log?.warn(`activity log: more than ${this.heldCap} lines arrived during the load; dropping the oldest`);
      }
    }
  }

  // How far back the history reaches (M9 fix 607); null on an empty log.
  get historyFrom(): number | null {
    return this.oldest;
  }

  // Whether nobody is at the box by the log's last presence line.
  get isAway(): boolean {
    return this.awayOpen !== null;
  }

  // A presence edge (M9 fix 245). Returns whether it changed anything,
  // so the caller writes the line only then: a second away while one is
  // open (the screen locked, then the window closed) is the same
  // absence, and a back with none open is nothing.
  recordPresence(kind: PresenceKind, at: number): boolean {
    if (kind === 'away') {
      if (this.awayOpen !== null) return false;
      this.awayOpen = at;
      return true;
    }
    if (this.awayOpen === null) return false;
    if (at > this.awayOpen) this.away.push({ from: this.awayOpen, to: at });
    this.awayOpen = null;
    return true;
  }

  // A usage edge (M9 fix 285), the same contract as recordPresence: the
  // caller writes the line only when it changed something. A capped on a
  // window whose band is open is the same cap, unless that band's reset
  // has passed, which is a new one (the band closed at its reset). A
  // freed closes the band at the earlier of the edge and the reset.
  recordCapped(window: string, resetsAt: number, at: number): boolean {
    const open = this.cappedOpen.get(window);
    if (open !== undefined) {
      if (open.resetsAt > at) return false;
      this.closeCapped(window, open, open.resetsAt);
    }
    this.cappedOpen.set(window, { from: at, resetsAt });
    return true;
  }

  recordFreed(window: string, at: number): boolean {
    const open = this.cappedOpen.get(window);
    if (open === undefined) return false;
    this.closeCapped(window, open, Math.min(at, open.resetsAt));
    return true;
  }

  private closeCapped(window: string, open: { from: number; resetsAt: number }, to: number): void {
    if (to > open.from) this.capped.push({ from: open.from, to, window, resetsAt: open.resetsAt });
    this.cappedOpen.delete(window);
  }

  // The bands that touch the window (M9 fix 285), cut to it, an open one
  // running to now or to its reset, whichever is first; in start order.
  cappedSpans(from: number, to: number, now: number): CappedSpan[] {
    const all = [...this.capped];
    for (const [window, open] of this.cappedOpen) {
      const end = Math.min(now, open.resetsAt);
      if (end > open.from) all.push({ from: open.from, to: end, window, resetsAt: open.resetsAt });
    }
    const out: CappedSpan[] = [];
    for (const c of all) {
      const s = Math.max(c.from, from);
      const e = Math.min(c.to, to);
      if (e <= s) continue;
      out.push({ ...c, from: s, to: e });
    }
    out.sort((a, b) => a.from - b.from);
    return out;
  }

  record(line: ActivityLine | PresenceLine | UsageLine): void {
    if (this.oldest === null || line.at < this.oldest) this.oldest = line.at;
    if ('presence' in line) {
      this.recordPresence(line.presence, line.at);
      return;
    }
    if ('capped' in line) {
      this.recordCapped(line.capped.window, line.capped.resetsAt, line.at);
      return;
    }
    if ('freed' in line) {
      this.recordFreed(line.freed.window, line.at);
      return;
    }
    let track = this.tracks.get(line.sessionId);
    if (track === undefined) {
      track = { spans: [], open: null, debt: [], openDebt: null, lastPrompt: null, lastAt: line.at, claudeSessionId: null, requests: [], split: null, lastUsd: null, started: false, outside: false, cwd: null };
      this.tracks.set(line.sessionId, track);
    }
    track.lastAt = Math.max(track.lastAt, line.at);
    if (line.unhosted) {
      track.outside = true;
      if (line.cwd !== null) track.cwd = line.cwd;
    }
    if (line.event === 'SessionStart') track.started = true;
    if (line.prompt !== null) track.lastPrompt = line.prompt;
    if (line.claudeSessionId !== null) track.claudeSessionId = line.claudeSessionId;
    if (line.usage !== null) this.recordRequest(track, line, line.usage);
    if (line.to === 'working' && line.from !== 'working') {
      // A working session cannot enter working; a stale span left open by
      // a daemon that died mid-turn is closed where the new turn starts,
      // never before its own start (M9 fix 461: a clock set back).
      if (track.open !== null) track.spans.push({ ...track.open, to: Math.max(line.at, track.open.from) });
      track.open = { from: line.at, to: line.at, prompt: track.lastPrompt };
    } else if (line.from === 'working' && line.to !== 'working' && track.open !== null) {
      track.spans.push({ ...track.open, to: Math.max(line.at, track.open.from) });
      track.open = null;
    }
    this.recordDebt(track, line);
    if (line.agentId !== null) this.recordAgent(line, line.agentId);
    if (line.running !== null) {
      // The turn ended: every agent of this session still open and not
      // among the tasks the Stop says are running has returned, whether
      // or not its SubagentStop was seen (a sync agent's never is).
      const running = new Set(line.running);
      for (const agent of this.agents.values()) {
        if (agent.parentId === line.sessionId && agent.to === null && !running.has(agent.agentId)) agent.to = line.at;
      }
    }
  }

  // The waiting stretches (M9 fix 231): a line into needs-input opens an
  // asked stretch, one into done an unread one, and a line that leaves
  // the open stretch's state closes it at its instant. Only a line that
  // moved the state says anything; a hook that left it alone (a tool
  // call mid-turn) has no `to`.
  private recordDebt(track: Track, line: ActivityLine): void {
    if (line.to === null) return;
    const open = track.openDebt;
    if (open !== null && line.to !== DEBT_STATE[open.kind]) {
      pushDebt(track.debt, open, line.at);
      track.openDebt = null;
    }
    const kind = debtKindOf(line.to);
    if (kind !== null && track.openDebt === null) track.openDebt = { at: line.at, kind };
  }

  // A status line's counts (M9 fix 217): the same input split as the
  // last line is the same request streaming, and its output and cost
  // replace the open point's; a new split opens a point at the line's
  // time. The cost is the delta of the line's total over the total the
  // track had when the point opened; a later point after lines that
  // carried no total (an older Claude Code) has no figure and is priced
  // from the rates. The first point of a track counts from nothing only
  // when it is plainly its process's first (M9 fix 462, the ledger's
  // L33): the track saw the SessionStart, or the total is under what a
  // first request costs; otherwise the track's earlier lines were in a
  // generation the rotation dropped, the total is the whole process's, and
  // the point is priced from the rates too. A total below the one the
  // point opened on is a new process (L34: a resume restarts Claude
  // Code's running total), so the point prices from nothing.
  private recordRequest(track: Track, line: ActivityLine, usage: NonNullable<ActivityLine['usage']>): void {
    const last = track.requests[track.requests.length - 1];
    const same = last !== undefined && track.split !== null && track.split.fresh === usage.fresh && track.split.cacheWrite === usage.cacheWrite && track.split.cacheRead === usage.cacheRead;
    let point: RequestPoint;
    if (same) {
      point = last;
      point.output = usage.output;
      point.updatedAt = line.at;
    } else {
      point = { at: line.at, fresh: usage.fresh, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead, output: usage.output, usd: null, model: line.model, usdBefore: track.lastUsd ?? (track.requests.length === 0 && (track.started || (line.usd !== null && line.usd < FIRST_REQUEST_USD)) ? 0 : null), updatedAt: line.at };
      track.requests.push(point);
    }
    if (line.model !== null) point.model = line.model;
    if (line.usd !== null) {
      if (point.usdBefore !== null && line.usd < point.usdBefore) point.usdBefore = 0;
      if (point.usdBefore !== null) point.usd = line.usd - point.usdBefore;
      track.lastUsd = line.usd;
    }
    track.split = { fresh: usage.fresh, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead };
  }

  // A SubagentStart or the Agent tool's PostToolUse opens the agent's
  // track, whichever lands first, and fills in what the other carries; a
  // SubagentStop closes it. A stop for an agent never started is an
  // inner agent's (it starts inside a subagent and reports only its
  // stop), and nothing.
  private recordAgent(line: ActivityLine, agentId: string): void {
    const key = agentKey(line.sessionId, agentId);
    const agent = this.agents.get(key);
    if (line.event === 'SubagentStop') {
      if (agent !== undefined && agent.to === null) {
        agent.to = line.at;
        agent.type ??= line.agentType;
      }
      return;
    }
    if (agent === undefined) {
      this.agents.set(key, { parentId: line.sessionId, agentId, type: line.agentType, description: line.description, from: line.at, to: null });
      return;
    }
    agent.type ??= line.agentType;
    agent.description ??= line.description;
  }

  // The sessions active between from and to, their spans clipped to that
  // window. An open span runs to now while the daemon still lists the
  // session as working; for a session that is not (its Claude left without
  // a hook, or the daemon was restarted) it ends where the session's state
  // last changed, or at the session's last line when the daemon no longer
  // lists it. A shell (or any listed session) with no working span in the
  // window is one dim span for the part of its life inside it. The
  // sessions handed in are the listed ones and the removed ones the
  // daemon kept (M57), so a removed session is named as it was.
  // An agent
  // still open runs to now while its parent's team lists it as running,
  // else to the parent's last line, and its row follows its parent's, in
  // start order among its siblings.
  //
  // The request points (M9 fix 217) ride each session's row, clipped to
  // the window by the time they opened. A day of them is a few hundred
  // kilobytes, and the renderer asks every thirty seconds, so with
  // `requestsSince` a row carries only the points a line has touched at
  // or after it (opened, or updated by a streaming line), and the
  // renderer merges by open time.
  //
  // The unhosted conversations (M9 fix 233) are the daemon's bare records
  // for them, keyed by the conversation id as their tracks are; one gives
  // its track's open span the live end and its folder, and never a name
  // (the renderer names the track from the transcript). A track outside
  // emerald whose conversation a record lists (it was resumed in a pane)
  // folds into that record's row.
  spans(from: number, to: number, now: number, sessions: SessionInfo[], requestsSince: number | null = null, unhosted: SessionInfo[] = []): ActivitySession[] {
    const listed = new Map(sessions.map((s) => [s.id, s]));
    const outsideInfos = new Map(unhosted.map((s) => [s.id, s]));
    const out: ActivitySession[] = [];
    const seen = new Set<string>();
    // The away stretches inside the window (M9 fix 245), an open one
    // running to now, and the capped bands (M9 fix 285); every row's
    // waiting is docked by both.
    const away = clipAway(this.awayOpen === null ? this.away : [...this.away, { from: this.awayOpen, to: Math.max(this.awayOpen, now) }], from, to);
    const capped = this.cappedSpans(from, to, now);
    for (const [sessionId, track] of this.tracks) {
      const info = listed.get(sessionId) ?? outsideInfos.get(sessionId);
      const outside = track.outside && !listed.has(sessionId);
      const all = [...track.spans];
      if (track.open !== null) {
        const end = info === undefined ? track.lastAt : info.state === 'working' ? now : settledAt(info, track);
        all.push({ ...track.open, to: Math.max(track.open.from, end) });
      }
      const spans = clip(all, from, to);
      if (spans.length === 0) continue;
      seen.add(sessionId);
      // An open wait runs to now while the daemon still lists the session
      // in that state, else to where its state last changed, or to the
      // last line when the daemon no longer lists it; the same rule as an
      // open working span, since a wait the daemon lost track of is not
      // still owed.
      const raw = [...track.debt];
      if (track.openDebt !== null) {
        const end = info === undefined ? track.lastAt : info.state === DEBT_STATE[track.openDebt.kind] ? now : settledAt(info, track);
        pushDebt(raw, track.openDebt, end);
      }
      const { debt, awayMs, cappedMs } = dockDebt(raw, away, capped, from, to);
      out.push({
        sessionId,
        name: outside ? null : (info?.name ?? null),
        color: outside ? null : (info?.color ?? null),
        kind: info?.kind ?? 'claude',
        claudeSessionId: info?.claudeSessionId ?? track.claudeSessionId,
        removedAt: outside ? null : (info?.removedAt ?? null),
        cwd: outside ? (info?.cwd ?? track.cwd) : (info?.cwd ?? null),
        groupCwd: outside ? (info?.groupCwd ?? track.cwd) : (info?.groupCwd ?? null),
        requests: clipRequests(track.requests, from, to, requestsSince),
        commits: clipCommits(info?.commits ?? [], from, to),
        lifetime: false,
        spans,
        debt,
        awayMs,
        cappedMs,
        parentId: null,
        agentId: null,
        agentType: null,
        outside,
      });
    }
    const joined = joinResumed(out, sessions);
    for (const info of sessions) {
      if (seen.has(info.id) || info.kind !== 'shell') continue;
      const end = info.state === 'exited' ? info.stateSince : now;
      const spans = clip([{ from: info.createdAt, to: Math.max(info.createdAt, end), prompt: null }], from, to);
      if (spans.length === 0) continue;
      out.push({ sessionId: info.id, name: info.name, color: info.color, kind: info.kind, claudeSessionId: info.claudeSessionId, removedAt: info.removedAt ?? null, cwd: info.cwd, groupCwd: info.groupCwd, requests: [], commits: clipCommits(info.commits ?? [], from, to), lifetime: true, spans, debt: [], awayMs: 0, cappedMs: 0, parentId: null, agentId: null, agentType: null, outside: false });
    }
    out.sort((a, b) => (a.spans[0]?.from ?? 0) - (b.spans[0]?.from ?? 0));
    return this.withAgents(out, from, to, now, listed, joined);
  }

  // An agent of an outside conversation that joined a record's row (M9
  // fix 463) follows it there: its parent is the owner, whose record
  // gives its colour and folder.
  private withAgents(rows: ActivitySession[], from: number, to: number, now: number, listed: Map<string, SessionInfo>, joined: Map<string, string>): ActivitySession[] {
    const byParent = new Map<string, ActivitySession[]>();
    for (const agent of this.agents.values()) {
      const parentId = joined.get(agent.parentId) ?? agent.parentId;
      const info = listed.get(parentId);
      let end = agent.to;
      if (end === null) {
        const running = (info?.team ?? []).some((m) => m.id === agent.agentId && m.outcome === 'running');
        end = running ? now : (this.tracks.get(agent.parentId)?.lastAt ?? agent.from);
      }
      const spans = clip([{ from: agent.from, to: Math.max(agent.from, end), prompt: null }], from, to);
      if (spans.length === 0) continue;
      const row: ActivitySession = {
        sessionId: parentId,
        name: agent.description ?? agent.type,
        color: info?.color ?? null,
        kind: 'agent',
        claudeSessionId: info?.claudeSessionId ?? null,
        removedAt: info?.removedAt ?? null,
        cwd: info?.cwd ?? null,
        groupCwd: info?.groupCwd ?? null,
        requests: [],
        commits: clipCommits(info?.team?.find((m) => m.id === agent.agentId)?.commits ?? [], from, to),
        lifetime: false,
        spans,
        debt: [],
        awayMs: 0,
        cappedMs: 0,
        parentId,
        agentId: agent.agentId,
        agentType: agent.type,
        outside: false,
      };
      const siblings = byParent.get(parentId);
      if (siblings === undefined) byParent.set(parentId, [row]);
      else siblings.push(row);
    }
    if (byParent.size === 0) return rows;
    const byStart = (a: ActivitySession, b: ActivitySession) => (a.spans[0]?.from ?? 0) - (b.spans[0]?.from ?? 0);
    const out: ActivitySession[] = [];
    for (const row of rows) {
      out.push(row);
      const agents = byParent.get(row.sessionId);
      if (agents === undefined) continue;
      out.push(...agents.sort(byStart));
      byParent.delete(row.sessionId);
    }
    // Agents whose parent has no row in the window (an async agent that
    // ran on after its parent's turn ended) take their place by start,
    // never splitting another parent from its agents.
    const orphans = [...byParent.values()].flat().sort(byStart);
    for (const agent of orphans) {
      const at = agent.spans[0]?.from ?? 0;
      let i = out.findIndex((r) => r.parentId === null && (r.spans[0]?.from ?? 0) > at);
      if (i === -1) i = out.length;
      out.splice(i, 0, agent);
    }
    return out;
  }
}

// The state each debt kind stands for, and back.
const DEBT_STATE: Record<DebtKind, SessionState> = { asked: 'needs-input', unread: 'done' };

function debtKindOf(state: string): DebtKind | null {
  return state === 'needs-input' ? 'asked' : state === 'done' ? 'unread' : null;
}

// The open stretch closed at `to`, as the lines had it, the grace not
// yet taken; a stretch of no length (a question answered on the same
// tick) does not exist.
function pushDebt(out: DebtSpan[], open: { at: number; kind: DebtKind }, to: number): void {
  if (to <= open.at) return;
  out.push({ from: open.at, to, kind: open.kind });
}

// The grace on the front of a stretch: the minute on an unread one, so a
// done answered inside it is nothing; none on a question asked.
function graceOf(kind: DebtKind): number {
  return kind === 'unread' ? DEBT_GRACE_MS : 0;
}

// The stretches as the window counts them (M9 fix 231 and 245): each raw
// stretch is cut by the away stretches into the pieces someone was
// there for, the grace comes off the front of every piece (the minute
// after the done, and the minute after the return, since a person back
// at nine who answers by 9:01 owes nothing), and the pieces are cut to
// the window; a piece with nothing left is not sent. `awayMs` is how
// much of the stretch as it would have counted with nobody away fell in
// an away stretch, for the stats line's tooltip. The capped bands (M9
// fix 285) cut the same way, since nobody could act on a spent window
// either, and `cappedMs` is their figure; a stretch under both is cut
// once and counted in both figures.
function dockDebt(raw: DebtSpan[], away: Stretch[], capped: Stretch[], from: number, to: number): { debt: DebtSpan[]; awayMs: number; cappedMs: number } {
  const out: DebtSpan[] = [];
  let awayMs = 0;
  let cappedMs = 0;
  const cuts = unionStretches([...away, ...capped]);
  const bands = unionStretches(capped);
  for (const r of raw) {
    const grace = graceOf(r.kind);
    // What the window counted before the docking, for the figure.
    const countedFrom = Math.max(r.from + grace, from);
    const countedTo = Math.min(r.to, to);
    for (const a of away) {
      const overlap = Math.min(a.to, countedTo) - Math.max(a.from, countedFrom);
      if (overlap > 0) awayMs += overlap;
    }
    for (const c of bands) {
      const overlap = Math.min(c.to, countedTo) - Math.max(c.from, countedFrom);
      if (overlap > 0) cappedMs += overlap;
    }
    let cursor = r.from;
    const pieces: Array<[number, number]> = [];
    for (const a of cuts) {
      if (a.to <= cursor || a.from >= r.to) continue;
      if (a.from > cursor) pieces.push([cursor, a.from]);
      cursor = Math.max(cursor, a.to);
    }
    if (cursor < r.to) pieces.push([cursor, r.to]);
    for (const [s, e] of pieces) {
      const a = Math.max(s + grace, from);
      const b = Math.min(e, to);
      if (b <= a) continue;
      out.push({ from: a, to: b, kind: r.kind });
    }
  }
  out.sort((a, b) => a.from - b.from);
  return { debt: out, awayMs, cappedMs };
}

// The stretches merged where they touch or overlap, in start order, so
// the docking walks one list and two windows capped at once count once.
function unionStretches(stretches: Stretch[]): Stretch[] {
  const sorted = [...stretches].sort((a, b) => a.from - b.from);
  const out: Stretch[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ from: s.from, to: s.to });
  }
  return out;
}

// The away stretches that touch the window, cut to it, in start order.
function clipAway(away: Array<{ from: number; to: number }>, from: number, to: number): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  for (const a of away) {
    const s = Math.max(a.from, from);
    const e = Math.min(a.to, to);
    if (e <= s) continue;
    out.push({ from: s, to: e });
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}

// An outside track (M9 fix 233) whose conversation a record lists, by
// its bound id or any of its conversation spans, was resumed in a pane:
// its spans and requests join the record's row, in time order, and its
// own row goes. A record with no row in the window keeps the outside row
// as it is. Its waiting and its docked figures join too (M9 fix 463, the
// ledger's L37), and the answer maps each joined conversation to its
// owner, so its agents' rows follow it rather than stand as orphans.
function joinResumed(rows: ActivitySession[], sessions: SessionInfo[]): Map<string, string> {
  const joined = new Map<string, string>();
  const byConversation = new Map<string, string>();
  for (const s of sessions) {
    if (s.claudeSessionId !== null) byConversation.set(s.claudeSessionId, s.id);
    for (const span of s.spans ?? []) byConversation.set(span.conversation, s.id);
  }
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    if (!row.outside) continue;
    const ownerId = byConversation.get(row.sessionId);
    const owner = ownerId === undefined ? undefined : rows.find((r) => r.sessionId === ownerId && r.agentId === null && !r.lifetime);
    if (owner === undefined) continue;
    owner.spans = [...owner.spans, ...row.spans].sort((a, b) => a.from - b.from);
    owner.requests = [...owner.requests, ...row.requests].sort((a, b) => a.at - b.at);
    owner.debt = [...owner.debt, ...row.debt].sort((a, b) => a.from - b.from);
    owner.awayMs += row.awayMs;
    owner.cappedMs += row.cappedMs;
    joined.set(row.sessionId, owner.sessionId);
    rows.splice(i, 1);
  }
  return joined;
}

// The points opened inside the window (M9 fix 217), as the wire shape
// without the folding's fields; with a `since`, only those a line has
// touched at or after it.
function clipRequests(points: RequestPoint[], from: number, to: number, since: number | null): ActivityRequest[] {
  const out: ActivityRequest[] = [];
  for (const p of points) {
    if (p.at < from || p.at > to) continue;
    if (since !== null && p.updatedAt < since) continue;
    out.push({ at: p.at, fresh: p.fresh, cacheWrite: p.cacheWrite, cacheRead: p.cacheRead, output: p.output, usd: p.usd, model: p.model });
  }
  return out;
}

// The record's credited commits claimed inside the window (M9 fix 218),
// the merge flag read as false where a record predates it. A session's
// own row carries its own commits, a subagent's the member's; a member's
// commits folded into the record when it left the team (fix 138) carry
// the agent on them and stay off the session's own count.
function clipCommits(commits: readonly SessionCommit[] | undefined, from: number, to: number): ActivityCommit[] {
  const out: ActivityCommit[] = [];
  // A record from before the field (a test's fixture) has none.
  for (const c of commits ?? []) {
    if (c.at < from || c.at > to || c.agent !== undefined) continue;
    out.push({ hash: c.hash, at: c.at, merge: c.merge === true });
  }
  return out;
}

// Where a listed session's open span or wait ends when it is no longer
// in that state: where its state last changed, except for an exited one
// (M9 fix 461, the ledger's M27), whose stateSince is the next daemon's
// start when the daemon died without writing the exit, so it ends at the
// earlier of that and the track's last line rather than across the outage.
function settledAt(info: SessionInfo, track: Track): number {
  return info.state === 'exited' ? Math.min(info.stateSince, track.lastAt) : info.stateSince;
}

// The spans that touch the window, cut to it, in start order; a span of no
// length inside the window is kept (a turn that opened and closed on one
// tick still happened), one that only touches an edge is not.
function clip(spans: ActivitySpan[], from: number, to: number): ActivitySpan[] {
  const out: ActivitySpan[] = [];
  for (const s of spans) {
    // A span that ends before it starts (a clock set back, M9 fix 461)
    // is dropped here rather than reach the renderer.
    if (s.to < s.from) continue;
    if (s.to < from || s.from > to) continue;
    if (s.to === from && s.from < from) continue;
    if (s.from === to && s.to > to) continue;
    out.push({ from: Math.max(s.from, from), to: Math.min(s.to, to), prompt: s.prompt });
  }
  out.sort((a, b) => a.from - b.from);
  return out;
}
