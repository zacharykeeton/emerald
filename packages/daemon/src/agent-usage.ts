import fs from 'node:fs';
import path from 'node:path';
import type { AgentUsageLine } from './activity.ts';
import type { Logger } from './log.ts';
import { writeFileAtomic } from './store-file.ts';

// The agents' requests and tokens (M9 fix 1189). A session's status line
// carries the last request's figures only, never a running sum, so it
// cannot count the agents the session sent out; their price is in the
// parent's total_cost_usd and their requests are not. Claude Code writes
// each agent to `<the session's transcript folder>/<session id>/subagents/
// agent-<agent id>.jsonl`, whose assistant lines carry the response's id,
// its model and its usage; the lines of one response are contiguous and
// repeat its usage, a later one's output perhaps larger, so the last line
// of a response wins. The reader below counts one request per new id, and
// the scan runs at each Stop and SubagentStop of the parent, so the count
// is the daemon's own log line (agentUsage) and the next start reads it
// back with the hooks. Everything here is async: nothing synchronous goes
// on the hook path (the antivirus hold of fixes 288 to 302).

// Where a reader left an agent's file: the byte offset of the line after
// the last one read, the last response's id and output so a response
// streamed across two reads adds only its growth, and when that read was.
export interface AgentRead {
  upTo: number;
  lastId: string | null;
  lastOutput: number;
  at: number;
}

export interface AgentFileRead {
  requests: number;
  fresh: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  model: string | null;
  upTo: number;
  lastId: string | null;
  lastOutput: number;
  // When the first and the last counted responses were sent (M9 fix
  // 1201), null when neither carried a time; the recount dates its line by
  // the last.
  firstAt: number | null;
  lastAt: number | null;
}

const count =(v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

// One agent file read on from where the last read left it, up to its last
// newline (a last line still being written is left for the next read). A
// file shorter than the offset was rewritten, so it is read from the start
// counting only responses after the last read's time. With no earlier
// read, a response before `since` is not counted, though its id is kept
// so its later lines are not taken for a new one. A response at or after
// `until` is not counted either (M9 fix 1201: the recount stops where the
// live count began), and with a finite `until` one with no time is not
// counted, since it cannot be placed. Null when the read found no new
// request and no new output.
export async function readAgentFile(file: string, from: AgentRead | null, since: number, until = Infinity): Promise<AgentFileRead | null> {
  const handle = await fs.promises.open(file, 'r');
  let text: string;
  let upTo: number;
  let start = from?.upTo ?? 0;
  let after = -Infinity;
  let lastId = from?.lastId ?? null;
  let lastOutput = from?.lastOutput ?? 0;
  try {
    const size = (await handle.stat()).size;
    if (from !== null && size < from.upTo) {
      start = 0;
      after = from.at;
      lastId = null;
      lastOutput = 0;
    }
    if (size <= start) return null;
    const buf = Buffer.alloc(size - start);
    let got = 0;
    while (got < buf.length) {
      const { bytesRead } = await handle.read(buf, got, buf.length - got, start + got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    const end = buf.subarray(0, got).lastIndexOf(0x0a);
    if (end === -1) return null;
    text = buf.subarray(0, end).toString('utf8');
    upTo = start + end + 1;
  } finally {
    await handle.close();
  }
  if (from === null) after = since;
  let requests = 0;
  let fresh = 0;
  let cacheWrite = 0;
  let cacheRead = 0;
  let output = 0;
  let model: string | null = null;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  // Whether the response the running id names is counted: one before the
  // window keeps its id and adds nothing, its later lines included.
  let counting = from !== null && after === -Infinity;
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    let l: Record<string, unknown>;
    try {
      l = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (l['type'] !== 'assistant' || typeof l['message'] !== 'object' || l['message'] === null) continue;
    const m = l['message'] as Record<string, unknown>;
    if (typeof m['id'] !== 'string' || m['model'] === '<synthetic>' || typeof m['usage'] !== 'object' || m['usage'] === null) continue;
    const u = m['usage'] as Record<string, unknown>;
    const out = count(u['output_tokens']);
    if (m['id'] === lastId) {
      if (counting && out > lastOutput) {
        output += out - lastOutput;
        if (typeof m['model'] === 'string') model = m['model'];
      }
    } else {
      const at = typeof l['timestamp'] === 'string' ? Date.parse(l['timestamp']) : NaN;
      counting = Number.isFinite(at) ? at >= after && at < until : until === Infinity;
      if (counting) {
        if (Number.isFinite(at)) {
          if (firstAt === null || at < firstAt) firstAt = at;
          if (lastAt === null || at > lastAt) lastAt = at;
        }
        requests += 1;
        fresh += count(u['input_tokens']);
        cacheWrite += count(u['cache_creation_input_tokens']);
        cacheRead += count(u['cache_read_input_tokens']);
        output += out;
        if (typeof m['model'] === 'string') model = m['model'];
      }
    }
    lastId = m['id'];
    lastOutput = out;
  }
  if (requests === 0 && output === 0) return null;
  return { requests, fresh, cacheWrite, cacheRead, output, model, upTo, lastId, lastOutput, firstAt, lastAt };
}

// The subagents folder beside a session's transcript.
export function subagentsDir(transcriptPath: string): string {
  return path.join(path.dirname(transcriptPath), path.basename(transcriptPath, '.jsonl'), 'subagents');
}

const AGENT_FILE = /^agent-(.+)\.jsonl$/;

export interface AgentScanDeps {
  // Where the log's lines left an agent's file, null for one never read.
  known(sessionId: string, agentId: string): AgentRead | null;
  // The earliest response time a file met for the first time may count:
  // the later of the count's start and the log's first line.
  since(): number;
  write(line: AgentUsageLine): void;
  log: Logger;
}

// The scan at a parent's Stop or SubagentStop: every agent file in the
// session's subagents folder that grew past its known offset is read on,
// and one line written per file with a new count. Scans run one at a time
// per session, and one asked for while another runs runs once after it,
// with the latest call's path and time.
export class AgentUsageScanner {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly next = new Map<string, { transcriptPath: string; at: number }>();

  private readonly deps: AgentScanDeps;

  constructor(deps: AgentScanDeps) {
    this.deps = deps;
  }

  scan(sessionId: string, transcriptPath: string, at: number): Promise<void> {
    const waiting = this.next.has(sessionId);
    this.next.set(sessionId, { transcriptPath, at });
    if (waiting) return this.tails.get(sessionId) ?? Promise.resolve();
    const prev = this.tails.get(sessionId) ?? Promise.resolve();
    const run = prev.then(async () => {
      const job = this.next.get(sessionId);
      this.next.delete(sessionId);
      if (job !== undefined) await this.scanNow(sessionId, job.transcriptPath, job.at);
    });
    this.tails.set(sessionId, run);
    void run.finally(() => {
      if (this.tails.get(sessionId) === run) this.tails.delete(sessionId);
    });
    return run;
  }

  private async scanNow(sessionId: string, transcriptPath: string, at: number): Promise<void> {
    const dir = subagentsDir(transcriptPath);
    let names: string[];
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const m = AGENT_FILE.exec(name);
      if (m === null) continue;
      const agentId = m[1]!;
      const file = path.join(dir, name);
      try {
        const known = this.deps.known(sessionId, agentId);
        const size = (await fs.promises.stat(file)).size;
        if (known !== null && size <= known.upTo) continue;
        const read = await readAgentFile(file, known, this.deps.since());
        if (read === null) continue;
        this.deps.write({ at, agentUsage: { sessionId, agentId, model: read.model, requests: read.requests, fresh: read.fresh, cacheWrite: read.cacheWrite, cacheRead: read.cacheRead, output: read.output, upTo: read.upTo, lastId: read.lastId, lastOutput: read.lastOutput } });
      } catch (err) {
        this.deps.log.warn(`agent usage: could not read ${file}`, err);
      }
    }
  }
}

// The day the agents began to be counted (M9 fix 1189): the first start
// of a daemon at level 85, kept in a file of its own beside the stores and
// never rotated, so the mark outlives the log's generations. A missing or
// misshapen file is written with now.
export const AGENTS_COUNTED_NAME = 'agents-counted.json';

// The marker as it stands: the count's start, and when the one-time
// recount of the transcripts on disk ended (M9 fix 1201); null for a
// missing or misshapen file.
export function readAgentsCounted(file: string): { from: number; recountDone: number | null } | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    const from = p['from'];
    if (typeof from !== 'number' || !Number.isFinite(from)) return null;
    const done = p['recountDone'];
    return { from, recountDone: typeof done === 'number' && Number.isFinite(done) ? done : null };
  } catch {
    return null;
  }
}

export function agentsCountedFrom(file: string, now: number, log: Logger): number {
  const had = readAgentsCounted(file);
  if (had !== null) return had.from;
  try {
    writeFileAtomic(file, JSON.stringify({ from: now }) + '\n', log);
    log.info('agents counted from now', { from: new Date(now).toISOString() });
  } catch (err) {
    log.warn(`${path.basename(file)} could not be written; the agents' count starts at this start`, err);
  }
  return now;
}

// The recount's end, written into the marker beside the count's start, so
// no later start runs it again; a daemon killed mid-pass writes nothing,
// and the next start's pass skips every agent a recount line covers.
export function markRecountDone(file: string, from: number, at: number, log: Logger): void {
  try {
    writeFileAtomic(file, JSON.stringify({ from, recountDone: at }) + '\n', log);
  } catch (err) {
    log.warn(`${path.basename(file)} could not be written; the agents' recount runs again at the next start`, err);
  }
}

// The one-time recount (M9 fix 1201): the agents' requests and tokens from
// before the live count began, off the subagent transcripts still on disk,
// so the fuller count reaches back about a month rather than starting at
// the install. Each root is laid out <root>/<project slug>/<session id>/
// subagents/agent-<agent id>.jsonl, Claude Code's own projects folder
// first and the drop folder the install fills from a backup second; an
// agent the first root holds is not read from the second, since Claude
// Code only appends. A transcript folder whose session no track of the log
// names is skipped whole, since its figures would belong to no folder. An
// agent a recount line already covers (a pass cut short) is skipped, and
// one with nothing in the window writes nothing. Only responses at or
// after `since` (the log's first line, so historyFrom does not move) and
// before `until` (the live count's start, so the two never meet) count.
// One file at a time, yielding between files; no deadline, since the pipe
// answers throughout.
export interface RecountDeps {
  trackOfClaude(id: string): string | null;
  recounted(sessionId: string, agentId: string): boolean;
  since: number;
  until: number;
  write(line: AgentUsageLine): void;
  log: Logger;
}

export interface RecountSummary {
  files: number;
  bytes: number;
  ms: number;
  roots: string[];
  agents: number;
  sessions: number;
  requests: number;
  firstAt: number | null;
  unknownAgents: number;
  unknownSessions: number;
  covered: number;
  empty: number;
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function listDirs(p: string): Promise<string[]> {
  try {
    return (await fs.promises.readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

const day = (at: number): string => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function recountAgents(roots: readonly string[], deps: RecountDeps): Promise<RecountSummary> {
  const started = Date.now();
  const found = new Map<string, { sessionId: string; agentId: string; file: string }>();
  const present: string[] = [];
  for (const root of roots) {
    if (!(await isDir(root))) continue;
    present.push(root);
    for (const slug of await listDirs(root)) {
      for (const sessionId of await listDirs(path.join(root, slug))) {
        const sub = path.join(root, slug, sessionId, 'subagents');
        let names: string[];
        try {
          names = await fs.promises.readdir(sub);
        } catch {
          continue;
        }
        for (const name of names) {
          const m = AGENT_FILE.exec(name);
          if (m === null) continue;
          const key = `${sessionId}\0${m[1]!}`;
          if (!found.has(key)) found.set(key, { sessionId, agentId: m[1]!, file: path.join(sub, name) });
        }
      }
    }
  }
  const out: RecountSummary = { files: 0, bytes: 0, ms: 0, roots: present, agents: 0, sessions: 0, requests: 0, firstAt: null, unknownAgents: 0, unknownSessions: 0, covered: 0, empty: 0 };
  const unknown = new Set<string>();
  const counted = new Set<string>();
  for (const { sessionId, agentId, file } of found.values()) {
    const track = deps.trackOfClaude(sessionId);
    if (track === null) {
      out.unknownAgents += 1;
      unknown.add(sessionId);
      continue;
    }
    if (deps.recounted(track, agentId)) {
      out.covered += 1;
      continue;
    }
    try {
      const size = (await fs.promises.stat(file)).size;
      const read = await readAgentFile(file, null, deps.since, deps.until);
      out.files += 1;
      out.bytes += size;
      if (read === null || read.requests === 0) {
        out.empty += 1;
      } else {
        deps.write({ at: read.lastAt ?? deps.until - 1, agentUsage: { sessionId: track, agentId, model: read.model, requests: read.requests, fresh: read.fresh, cacheWrite: read.cacheWrite, cacheRead: read.cacheRead, output: read.output, upTo: 0, lastId: null, lastOutput: 0, recount: true } });
        out.agents += 1;
        counted.add(track);
        out.requests += read.requests;
        if (read.firstAt !== null && (out.firstAt === null || read.firstAt < out.firstAt)) out.firstAt = read.firstAt;
      }
    } catch (err) {
      deps.log.warn(`agent usage: could not read ${file}`, err);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  out.sessions = counted.size;
  out.unknownSessions = unknown.size;
  out.ms = Date.now() - started;
  const mb = (out.bytes / 1_048_576).toFixed(1);
  const seconds = (out.ms / 1000).toFixed(1);
  deps.log.info(`agent recount: ${out.files} agent files read (${mb} MB) in ${seconds} s from ${present.length === 0 ? 'no folder' : present.join(' and ')}; ${out.agents} agents counted on ${out.sessions} sessions, ${out.requests} requests from ${out.firstAt === null ? 'nothing' : day(out.firstAt)}; skipped ${out.unknownAgents} agents of ${out.unknownSessions} sessions the log does not know, ${out.covered} already counted, ${out.empty} with nothing before the count began`);
  return out;
}
