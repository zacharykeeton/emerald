import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { MOD_APPEND, MOD_HOOK_NAME, MOD_SUBMIT } from '@emerald/shared';
import { promptCacheKept } from '@emerald/shared/hook-log';
import type { HookOutcome, HookPayload, SessionState } from '@emerald/shared';
import { rotateHookLog, trimGenerations } from './activity.ts';
import type { Logger } from './log.ts';

// Where Claude Code hooks report in. claude-hook.cmd (installed by emmer hooks install)
// POSTs its stdin JSON here with the session id and token it inherited from
// the PTY environment. The reply goes out before any state is touched so a
// hook never waits on us, and every accepted event is appended to
// hooks.jsonl so state is debuggable after the fact.
//
// A Claude emerald did not start (M9 fix 233) posts too: the hook script
// reads the port and token off daemon.json when its environment carries
// no session and adds X-Emerald-Unhosted, and the handler is told so, since
// the conversation's own id names no record; the line in hooks.jsonl
// carries the mark so the activity log can say the track was not emerald's.
// Since M9 fix 580 the unhosted post names its conversation in the body's
// session_id alone, so the hook's .cmd posts it with curl and no node; a
// session header, when sent, still wins.
//
// A Test event (M9 fix 606) is answered and remembered for hooks.test, and
// goes to no session and no line of hooks.jsonl.

export const DEFAULT_HOOK_PORT = 47123;

// Tool payloads can carry a whole file in tool_input; a megabyte is generous.
// A body past it is read to its end and only its head is kept (M9 fix
// 512): a Write of half a megabyte carries its content twice, and
// refusing it whole lost the file from the touched list.
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

// The fields a body past the limit is still read for (M9 fix 512), each
// the first string of its name in the kept head: the event and whose it
// is (agent_id tells a member's Write from the parent's own, cwd places
// the row), and the call's name, id and target, which the touched list
// and the HEAD hold read. The head is cut mid-body, so it is no JSON;
// the scan is a pattern per key, and a key written inside another
// string cannot match, since its quotes are escaped there.
const HEAD_KEYS = ['hook_event_name', 'session_id', 'agent_id', 'cwd', 'tool_name', 'tool_use_id'] as const;
const HEAD_INPUT_KEYS = ['file_path', 'notebook_path', 'command'] as const;

// The last bytes of a body past the limit, also kept (M9 fix 740): Claude
// Code writes a PostToolUse's tool_use_id after tool_input and
// tool_response, so past a megabyte of content the id is beyond the head,
// and the fold that keys on it needs it.
export const HEAD_TAIL_BYTES = 4096;

export function readHeadFields(head: string, tail = ''): HookPayload | null {
  const out: Record<string, unknown> = {};
  for (const key of HEAD_KEYS) {
    const v = firstString(head, key, 0);
    if (v !== undefined) out[key] = v;
  }
  // The id from the tail when the head has none (M9 fix 740): the last
  // match, since a top-level key is written after any value that could
  // hold its name, and one inside a string has its quotes escaped.
  if (out['tool_use_id'] === undefined && tail !== '') {
    const v = lastString(tail, 'tool_use_id');
    if (v !== undefined) out['tool_use_id'] = v;
  }
  if (typeof out['hook_event_name'] !== 'string') return null;
  const input = head.indexOf('"tool_input"');
  if (input >= 0) {
    const fields: Record<string, string> = {};
    for (const key of HEAD_INPUT_KEYS) {
      const v = firstString(head, key, input);
      if (v !== undefined) fields[key] = v;
    }
    if (Object.keys(fields).length > 0) out['tool_input'] = fields;
  }
  out['truncated'] = true;
  return out as HookPayload;
}

function lastString(text: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`, 'g');
  let last: string | undefined;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) last = m[1];
  if (last === undefined) return undefined;
  try {
    const v: unknown = JSON.parse(last);
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

function firstString(text: string, key: string, from: number): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")`, 'g');
  re.lastIndex = from;
  const m = re.exec(text);
  if (m === null) return undefined;
  try {
    const v: unknown = JSON.parse(m[1]!);
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

// What of a payload reaches the file (M9 fix 377). The handler sees the
// whole body; the line is for the activity log at the next start and for
// `emmer explain`, which read a dozen fields between them, and a hook log
// that kept every byte reached 489 MB (325 of them PostToolUse bodies, 61
// PreToolUse, 42 StatusLine) and held the daemon's start for five
// seconds. So tool_input and tool_response are cut to their first
// kilobyte, string by string (the Agent tool's response keeps its
// agentId and description that way, a Read's content is a kilobyte of
// it), an array past the cut loses its tail, and the payload carries
// `truncated: true` when anything was cut; and a StatusLine keeps the
// fields the activity line reads (the model, the effort, the cost, the
// context window) and the session's own, since the rest (the rate limits, the
// workspace) is the moment's and read live; of the prompt cache it keeps
// the warmth, the TTL and the expiry (M9 fix 772), for `emmer explain` and
// the idle countdown's afterwards. Set EMERALD_HOOKS_FULL=1 to keep whole
// payloads.
export const TRIM_BYTES = 1024;
const STATUS_LINE_KEPT = ['session_id', 'hook_event_name', 'cwd', 'agent_id', 'agent_type', 'transcript_path', 'model', 'effort', 'cost', 'context_window', 'prompt_cache'] as const;

export function trimPayload(payload: HookPayload): HookPayload {
  const fields = payload as Record<string, unknown>;
  if (payload.hook_event_name === 'StatusLine') {
    const kept: Record<string, unknown> = {};
    for (const key of STATUS_LINE_KEPT) if (fields[key] !== undefined) kept[key] = fields[key];
    if (kept['prompt_cache'] !== undefined) {
      const cache = promptCacheKept(kept['prompt_cache']);
      if (cache === null) delete kept['prompt_cache'];
      else kept['prompt_cache'] = cache;
    }
    return kept as HookPayload;
  }
  // A kept row (M9 fix 769) is the conversation's own text, which the
  // transcript already holds: the log keeps its kind and block count.
  if (payload.hook_event_name === MOD_APPEND) {
    const row = fields['row'] as { type?: unknown; content?: unknown } | null | undefined;
    const blocks = Array.isArray(row?.content) ? row.content.length : 0;
    return { ...fields, row: { type: row?.type, blocks } } as HookPayload;
  }
  if (payload.tool_input === undefined && payload.tool_response === undefined) return payload;
  const state = { cut: false };
  const out: Record<string, unknown> = { ...fields };
  if (payload.tool_input !== undefined) out['tool_input'] = trimValue(payload.tool_input, state);
  if (payload.tool_response !== undefined) out['tool_response'] = trimValue(payload.tool_response, state);
  if (state.cut) out['truncated'] = true;
  return out as HookPayload;
}

function trimValue(value: unknown, state: { cut: boolean }): unknown {
  if (typeof value === 'string') {
    if (value.length <= TRIM_BYTES) return value;
    state.cut = true;
    return value.slice(0, TRIM_BYTES);
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    let size = 0;
    for (const el of value) {
      const t = trimValue(el, state);
      size += JSON.stringify(t)?.length ?? 0;
      if (size > TRIM_BYTES && out.length > 0) {
        state.cut = true;
        break;
      }
      out.push(t);
    }
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = trimValue(v, state);
    return out;
  }
  return value;
}

// A post that repeats one accepted within this long for the same session
// and body whole, from another hook file, is a second hook set posting
// the same event (M9 fix 260: the hooks `emmer hooks install` put in the
// user's settings and a project or --settings file beside them each run
// their own claude-hook.cmd, and the activity log read every event
// twice). The hook names its file in X-Emerald-Hook; the same file posting
// the same body twice is that hook's own doing (Claude Code runs one
// command once per event, and the verify scripts post the same body
// within a second on purpose), so only a different file folds. Two
// genuine events of one kind inside the window (two PreToolUse for two
// tool calls) differ in their payloads and both pass. M9 fix 740: a tool
// event with a tool_use_id folds on its event name and the id, so the
// mod's whole copy and the hook file's copy cut at the limit meet; the
// window is two seconds (the live gaps ran 3 to 447 ms, p90 227) and the
// ring is pruned by age, so a burst of other events between the copies
// cannot push the first out. The cap bounds memory under a flood; it is
// not the bound the fold relies on.
const DUPLICATE_WINDOW_MS = 2000;
const DUPLICATE_RING_CAP = 1024;

// The sessions the mod has posted for, and those already warned of a mod
// that posted nothing (M9 fix 725); insertion-ordered, the oldest dropped.
const MOD_SEEN_CAP = 512;

// The Test events the sink remembers for hooks.test (M9 fix 606): a handful
// for a minute, since the asker reads its answer within seconds of the post.
const TEST_RING = 8;
const TEST_KEEP_MS = 60 * 1000;

// What the handler says about an event. The transition is filled in when
// the event changed the session's state, so a hooks.jsonl line says not
// just that a Stop was applied but that it took the session from working
// to done; `emmer explain` prints the log and reads it from here.
export interface HookResult {
  outcome: HookOutcome | 'unknown-session';
  from?: SessionState;
  to?: SessionState;
}

export type HookHandler = (sessionId: string, payload: HookPayload, at: number, unhosted: boolean) => HookResult;

export interface HookSinkOptions {
  // Tried first; 0 means "ephemeral straight away" (tests).
  preferredPort?: number;
  token?: string;
  // The hooks.jsonl path. Parent directories are created.
  eventLogPath: string;
  log: Logger;
  maxBodyBytes?: number;
  // Whether the line keeps the whole payload (M9 fix 377); the default
  // reads EMERALD_HOOKS_FULL, and the written line is trimmed otherwise.
  fullPayloads?: boolean;
  // Whether a session's Claude was launched with the emerald mod (M9 fix
  // 725), so a Stop that came from the hook file alone says the mod did
  // not load; the default expects it nowhere.
  expectsMod?: (sessionId: string) => boolean;
  // The emerald mod's question before a compaction (M9 fix 773, POST
  // /compact): the skip reason, or null to let it through; a sink without
  // one lets every compaction through.
  compactAsk?: (sessionId: string, trigger: string) => string | null;
  // The emerald mod's word on a submit the daemon pushed (M9 fix 781, its
  // ModSubmit post): handed on, and no hooks.jsonl line is written.
  onModSubmit?: (sessionId: string, submitId: string, entered: boolean, drop: string | null) => void;
}

// The body of a /compact ask is `{ trigger }` and no more (M9 fix 773).
const COMPACT_MAX_BODY_BYTES = 4096;

export class HookSink {
  readonly port: number;
  readonly token: string;
  private readonly server: http.Server;
  // Swapped for a fresh stream by a live rotation (M9 fix 429).
  private events: fs.WriteStream;
  private readonly eventLogPath: string;
  private readonly log: Logger;
  private readonly recent: Array<{ key: string; at: number; hook: string }> = [];
  private readonly tests: Array<{ id: string; at: number }> = [];
  private readonly fullPayloads: boolean;
  private expectsMod: (sessionId: string) => boolean = () => false;
  private compactAsk: (sessionId: string, trigger: string) => string | null = () => null;
  private onModSubmit: (sessionId: string, submitId: string, entered: boolean, drop: string | null) => void = () => undefined;
  private readonly modSeen = new Set<string>();
  private readonly modWarned = new Set<string>();
  // The lines that arrive while a rotation has the file closed, written
  // in order to the fresh stream once it is open; null when no swap runs.
  private held: string[] | null = null;
  private swapping: Promise<boolean> | null = null;
  private closed = false;

  private constructor(server: http.Server, port: number, token: string, events: fs.WriteStream, eventLogPath: string, log: Logger, fullPayloads: boolean) {
    this.server = server;
    this.port = port;
    this.token = token;
    this.events = events;
    this.eventLogPath = eventLogPath;
    this.log = log;
    this.fullPayloads = fullPayloads;
  }

  static async listen(handler: HookHandler, opts: HookSinkOptions): Promise<HookSink> {
    const token = opts.token ?? randomBytes(24).toString('hex');
    const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    fs.mkdirSync(path.dirname(opts.eventLogPath), { recursive: true });
    const events = openEvents(opts.eventLogPath, opts.log);

    let sink: HookSink | null = null;
    const server = http.createServer((req, res) => {
      if (sink !== null) sink.onRequest(req, res, handler, maxBody);
    });
    server.on('error', (err) => opts.log.error('hook sink error', err));

    const preferred = opts.preferredPort ?? DEFAULT_HOOK_PORT;
    let port: number;
    try {
      port = await bind(server, preferred);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || preferred === 0) throw err;
      // Someone else has the well-known port. The hook script reads the port
      // from the environment, so any free port works just as well.
      opts.log.warn(`hook port ${preferred} is in use, taking an ephemeral one`);
      port = await bind(server, 0);
    }
    sink = new HookSink(server, port, token, events, opts.eventLogPath, opts.log, opts.fullPayloads ?? process.env['EMERALD_HOOKS_FULL'] === '1');
    if (opts.expectsMod) sink.expectsMod = opts.expectsMod;
    if (opts.compactAsk) sink.compactAsk = opts.compactAsk;
    if (opts.onModSubmit) sink.onModSubmit = opts.onModSubmit;
    return sink;
  }

  // A line of the daemon's own on the log (M9 fix 245): the presence
  // edges, which name no session and no hook. The activity log reads
  // them back at the next start beside the hooks.
  append(line: Record<string, unknown>): void {
    this.write(JSON.stringify(line) + '\n');
  }

  // The live rotation (M9 fix 429): the load rotates only at the
  // daemon's start, so a daemon left up for weeks grew the current file
  // without bound and brought the slow start back. Past the threshold
  // new lines are held, the stream is ended so every line already
  // written is on disk before the rename, the shift runs, and a fresh
  // append stream takes the held lines, so they stay in order across the
  // rename. The rename itself would work with our handle still open,
  // since Node opens with FILE_SHARE_DELETE; what refuses it is another
  // program's handle without delete sharing, which rotateHookLog leaves
  // every file as it was for (M9 fix 465). The shift waits for the
  // stream's close rather than its `end` callback, inside which the fd
  // is still open (M9 fix 629): the rotation now removes the renamed file
  // once slimmed, and a delete under an open handle leaves the name in
  // the folder, pending, until the handle goes. The in-memory activity
  // log is fed from the handler, not from the file, so it needs no
  // reload. True when it rotated.
  rotateIfPast(bytes: number): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    if (this.swapping !== null) return this.swapping;
    let size = 0;
    try {
      size = fs.statSync(this.eventLogPath).size;
    } catch {
      return Promise.resolve(false);
    }
    if (size <= bytes) return Promise.resolve(false);
    this.held = [];
    const old = this.events;
    this.swapping = new Promise<boolean>((resolve) => {
      const swap = (): void => {
        const rotated = rotateHookLog(this.eventLogPath, this.log);
        if (rotated) trimGenerations(this.eventLogPath, bytes, this.log);
        this.events = openEvents(this.eventLogPath, this.log);
        const held = this.held ?? [];
        this.held = null;
        for (const text of held) this.events.write(text);
        this.swapping = null;
        resolve(rotated);
      };
      if (old.closed) {
        swap();
      } else {
        old.once('close', swap);
        old.end();
      }
    });
    return this.swapping;
  }

  // Every connection is cut as the server closes (M9 fix 164), since
  // close alone waits for a keep-alive client to let go, and a hook post
  // is over the moment it is answered.
  // Whether a Test event carrying this test_id arrived within the last
  // minute (M9 fix 606), for the pipe's hooks.test.
  testArrived(testId: string): boolean {
    const now = Date.now();
    return this.tests.some((t) => t.id === testId && now - t.at <= TEST_KEEP_MS);
  }

  // Whether this session's emerald mod has posted (M9 fix 776), so the
  // pipe holds an early send for its channel: never true for a session
  // launched with the mod that never loaded it (--safe-mode).
  modSeenFor(sessionId: string): boolean {
    return this.modSeen.has(sessionId);
  }

  close(): Promise<void> {
    this.closed = true;
    return new Promise((resolve) => {
      this.server.close(() => {
        // A rotation mid-swap opens the stream the close must end.
        void (this.swapping ?? Promise.resolve(false)).then(() => this.events.end(() => resolve()));
      });
      this.server.closeAllConnections();
    });
  }

  private write(text: string): void {
    if (this.held !== null) this.held.push(text);
    else this.events.write(text);
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse, handler: HookHandler, maxBody: number): void {
    if (req.method === 'POST' && req.url === '/compact') {
      this.onCompact(req, res);
      return;
    }
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.writeHead(404).end();
      req.resume();
      return;
    }
    if (!this.tokenMatches(header(req, 'x-emerald-token'))) {
      // Logged at warn because a wrong token means a stale daemon.json or a
      // stranger on localhost, and either is worth a look.
      this.log.warn('hook rejected: bad token', { from: req.socket.remoteAddress });
      res.writeHead(401).end();
      req.resume();
      return;
    }
    const unhosted = header(req, 'x-emerald-unhosted') === '1';
    const headerSession = header(req, 'x-emerald-session');
    if (headerSession === '' && !unhosted) {
      res.writeHead(400).end('missing X-Emerald-Session');
      req.resume();
      return;
    }
    const hook = header(req, 'x-emerald-hook');

    // Past the limit the first maxBody bytes are kept and the rest read
    // and dropped (M9 fix 512), so the hook is answered after its whole
    // body as ever, and the head's fields still land.
    const chunks: Buffer[] = [];
    let size = 0;
    let kept = 0;
    // The bytes past the head, at most HEAD_TAIL_BYTES of the newest (M9
    // fix 740), for the id Claude writes after the content.
    let tail = Buffer.alloc(0);
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      const room = Math.max(0, maxBody - kept);
      if (room > 0) {
        const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
        chunks.push(part);
        kept += part.length;
      }
      const dropped = chunk.length > room ? chunk.subarray(room) : null;
      if (dropped !== null) {
        const joined = Buffer.concat([tail, dropped]);
        tail = joined.length > HEAD_TAIL_BYTES ? Buffer.from(joined.subarray(joined.length - HEAD_TAIL_BYTES)) : joined;
      }
    });
    req.on('end', () => {
      let payload: unknown;
      // A payload piped by hand from PowerShell carries a byte order mark;
      // Claude Code sends none. Stripped for every post, so the duplicate
      // check and the parse both see the same body.
      const body = Buffer.concat(chunks, kept).toString('utf8').replace(/^\uFEFF/, '');
      const overLimit = size > maxBody;
      if (overLimit) {
        payload = readHeadFields(body, tail.toString('utf8'));
        if (payload === null) {
          this.log.warn('hook body past the limit with no event name', { sessionId: headerSession, bytes: size });
          res.writeHead(413).end();
          return;
        }
      } else {
        try {
          payload = JSON.parse(body);
        } catch {
          res.writeHead(400).end('body is not JSON');
          return;
        }
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        res.writeHead(400).end('body is not a JSON object');
        return;
      }
      // The header wins when both are sent (the status line's post sends
      // both); the unhosted .cmd sends only the body.
      const bodySession = (payload as HookPayload).session_id;
      const sessionId = headerSession !== '' ? headerSession : typeof bodySession === 'string' ? bodySession : '';
      if (sessionId === '') {
        res.writeHead(400).end('missing session_id');
        return;
      }
      if ((payload as HookPayload).hook_event_name === 'Test') {
        // Recorded before the 204 goes out, so a caller that waits for the
        // hook process to exit and then asks the pipe always reads it.
        const testId = (payload as { test_id?: unknown }).test_id;
        if (typeof testId === 'string' && testId !== '') {
          this.tests.push({ id: testId, at: Date.now() });
          if (this.tests.length > TEST_RING) this.tests.shift();
          this.log.info(`hook test ${testId} arrived`, { sessionId, unhosted, hook });
        }
        res.writeHead(204).end();
        return;
      }
      if (overLimit) {
        this.log.info('hook body past the limit: head fields only', { sessionId, bytes: size, event: (payload as HookPayload).hook_event_name });
      }
      const at = Date.now();
      // The hook is released here. Whatever happens next is our problem, not Claude's.
      res.writeHead(204).end();
      if (hook === MOD_HOOK_NAME) remember(this.modSeen, sessionId);
      // M9 fix 781: the mod's word on a submit goes to the waiting send and
      // nowhere else; it is no hook of the session's and moves no state.
      if ((payload as HookPayload).hook_event_name === MOD_SUBMIT) {
        const word = payload as { submit_id?: unknown; entered?: unknown; drop?: unknown };
        if (hook === MOD_HOOK_NAME && typeof word.submit_id === 'string') this.onModSubmit(sessionId, word.submit_id, word.entered === true, typeof word.drop === 'string' ? word.drop : null);
        return;
      }
      if (this.isDuplicate(sessionId, foldKey(payload as HookPayload, overLimit, body), at, hook)) {
        this.log.info(`hook duplicate ${(payload as HookPayload).hook_event_name ?? '?'} ${sessionId}`, { hook, at });
        return;
      }
      setImmediate(() => this.accept(sessionId, payload as HookPayload, at, unhosted, handler, hook));
    });
    req.on('error', (err) => this.log.warn('hook request error', err));
  }

  // The emerald mod's question before a compaction (M9 fix 773): the
  // token and session checks of /hook, a small JSON body naming the
  // trigger, and an answer the mod waits for, unlike a hook's 204 sent
  // before the handler runs. Nothing goes to hooks.jsonl, since an ask is
  // not a hook and the activity load reads that file. Any failure on our
  // side answers null, so a compaction is never held by a fault here.
  private onCompact(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (!this.tokenMatches(header(req, 'x-emerald-token'))) {
      this.log.warn('compact ask rejected: bad token', { from: req.socket.remoteAddress });
      res.writeHead(401).end();
      req.resume();
      return;
    }
    const sessionId = header(req, 'x-emerald-session');
    if (sessionId === '') {
      res.writeHead(400).end('missing X-Emerald-Session');
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= COMPACT_MAX_BODY_BYTES) chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > COMPACT_MAX_BODY_BYTES) {
        res.writeHead(413).end();
        return;
      }
      let trigger = '';
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^﻿/, ''));
        const t = typeof body === 'object' && body !== null ? (body as { trigger?: unknown }).trigger : undefined;
        if (typeof t === 'string') trigger = t;
      } catch {
        res.writeHead(400).end('body is not JSON');
        return;
      }
      let skip: string | null = null;
      try {
        skip = this.compactAsk(sessionId, trigger);
      } catch (err) {
        this.log.error('compact ask failed', err);
        skip = null;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ skip }));
    });
    req.on('error', (err) => this.log.warn('compact ask request error', err));
  }

  private accept(sessionId: string, payload: HookPayload, at: number, unhosted: boolean, handler: HookHandler, hook: string): void {
    let result: HookResult | { outcome: 'handler-error' };
    try {
      result = handler(sessionId, payload, at, unhosted);
    } catch (err) {
      this.log.error('hook handler failed', err);
      result = { outcome: 'handler-error' };
    }
    if (result.outcome === 'unknown-session') {
      this.log.warn('hook for unknown session', { sessionId, event: payload.hook_event_name });
    }
    // from and to come before the payload so a line is readable by eye
    // up to the point where the payload starts.
    const line = { at, sessionId, event: payload.hook_event_name ?? null, ...(unhosted ? { unhosted: true } : {}), ...(hook === MOD_HOOK_NAME ? { mod: true } : {}), ...result, payload: this.fullPayloads ? payload : trimPayload(payload) };
    this.write(JSON.stringify(line) + '\n');
    if (!unhosted && payload.hook_event_name === 'Stop' && hook !== MOD_HOOK_NAME) this.warnIfModSilent(sessionId, hook);
  }

  // Said once per session (M9 fix 725): by a Stop, SessionStart and
  // UserPromptSubmit have come, so a session launched with the mod whose
  // posts all came from the hook file has a mod that did not load.
  private warnIfModSilent(sessionId: string, hook: string): void {
    if (this.modSeen.has(sessionId) || this.modWarned.has(sessionId)) return;
    if (!this.expectsMod(sessionId)) return;
    this.log.warn(`the emerald mod posted nothing for ${sessionId}: every hook came from the hook file`, { hook });
    remember(this.modWarned, sessionId);
  }

  // Whether another hook file posted this very body for the same session
  // within the window; the body is hashed so the ring holds no payloads.
  // The body is the payload's canonical form when it parsed whole (M9 fix
  // 725: the mod's JSON.stringify and Claude's stdin text are never the
  // same bytes for one event) and the raw head past the limit.
  // A tool event with an id keys on its name and the id instead (M9 fix
  // 740, foldKey). A hit is not re-stamped, so a third copy inside the
  // window of the first is dropped too. Entries past the window go first,
  // so the ring holds the window's posts whatever came between.
  private isDuplicate(sessionId: string, body: string, at: number, hook: string): boolean {
    while (this.recent.length > 0 && at - this.recent[0]!.at > DUPLICATE_WINDOW_MS) this.recent.shift();
    const key = sessionId + ':' + createHash('sha1').update(body).digest('hex');
    const hit = this.recent.some((r) => r.key === key && r.hook !== hook && at - r.at <= DUPLICATE_WINDOW_MS);
    if (!hit) {
      this.recent.push({ key, at, hook });
      if (this.recent.length > DUPLICATE_RING_CAP) this.recent.shift();
    }
    return hit;
  }

  private tokenMatches(given: string): boolean {
    const a = Buffer.from(given, 'utf8');
    const b = Buffer.from(this.token, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

// What the fold keys a post on (M9 fix 740): a tool event's name and its
// tool_use_id when the copy carries both, so two copies of one call that
// differ elsewhere (one cut at the limit, one whole) meet; else the
// payload's canonical form, or the raw head past the limit, as before.
export function foldKey(payload: HookPayload, overLimit: boolean, body: string): string {
  const name = payload.hook_event_name;
  const id = payload.tool_use_id;
  if (typeof name === 'string' && name !== '' && typeof id === 'string' && id !== '') return 'id:' + name + ':' + id;
  return overLimit ? body : canonicalJson(payload);
}

// The payload as one text whatever its keys' order (M9 fix 725): every
// object's keys sorted, at every depth. The fold keys on it, so the mod's
// copy and the hook file's copy of one event match.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

function remember(set: Set<string>, id: string): void {
  set.delete(id);
  set.add(id);
  if (set.size > MOD_SEEN_CAP) set.delete(set.values().next().value as string);
}

// One append stream keeps lines in arrival order; separate appendFile
// calls could land out of order on the thread pool.
function openEvents(file: string, log: Logger): fs.WriteStream {
  const events = fs.createWriteStream(file, { flags: 'a' });
  events.on('error', (err) => log.error('hooks.jsonl write failed', err));
  return events;
}

function header(req: http.IncomingMessage, name: string): string {
  const v = req.headers[name];
  return typeof v === 'string' ? v : '';
}

function bind(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : port);
    });
  });
}
