// The hook log's generations (M9 fix 415), shared by the daemon that
// writes and rotates them and `emmer explain` that reads them (M9 fix
// 430), so the two agree on how far back the history goes. A subpath
// export (@emerald/shared/hook-log) rather than part of the barrel, since
// the renderer imports the barrel and this needs node:path and node:fs.
import fs from 'node:fs';
import path from 'node:path';
import { summarize } from './state-machine.ts';
import type { HookPayload } from './state-machine.ts';

// How many bytes of rotated generations are kept beside the current file
// (M9 fix 629; three generations by count from fix 415). 192 MB was the
// three full generations' worth; the generations are slimmed since fix
// 629, 5x to 14x smaller, so the same ceiling is months of history. A
// rotation drops the oldest generation while the total is past this.
export const HOOK_LOG_BUDGET_BYTES = 192 * 1024 * 1024;

// hooks.jsonl -> hooks.<generation>.jsonl, generation 1 being the one
// rotated most recently.
export function rotatedPath(file: string, generation = 1): string {
  const ext = path.extname(file);
  return path.join(path.dirname(file), `${path.basename(file, ext)}.${generation}${ext}`);
}

// Every generation oldest first, the current file last: the order the
// load streams them in, so a session's spans arrive in time order. Since
// fix 629 the generations are whatever `<base>.<n><ext>` files the folder
// holds, n a positive integer, sorted by n (hooks.10 before hooks.9), so
// a backup copied in as a higher number is read as the oldest; the
// temporaries (hooks.rotating, hooks.slimming, a .trimming) never match.
// A gap in the numbers is read as it stands. The current file is always
// listed, present or not.
export function generationPaths(file: string): string[] {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [file];
  }
  const found: Array<[number, string]> = [];
  for (const name of names) {
    if (!name.startsWith(`${base}.`) || !name.endsWith(ext)) continue;
    const middle = name.slice(base.length + 1, name.length - ext.length);
    if (!/^[1-9][0-9]*$/.test(middle)) continue;
    found.push([Number(middle), path.join(dir, name)]);
  }
  found.sort((a, b) => b[0] - a[0]);
  return [...found.map(([, each]) => each), file];
}

// The number of a generation's path, hooks.4.jsonl -> 4.
export function generationNumber(file: string, generation: string): number {
  const ext = path.extname(file);
  const name = path.basename(generation);
  return Number(name.slice(path.basename(file, ext).length + 1, name.length - ext.length));
}

// The current file's name while a rotation shifts the generations (M9
// fix 465), and the oldest generation's while a rotation drops it (M9
// fix 555): both sit in the log's folder for the length of the shift, so
// `emmer explain` reads them in place of the names they left.
export const ROTATING_NAME = 'hooks.rotating.jsonl';
export const DROPPING_NAME = 'hooks.dropping.jsonl';
// Generation 1 while a rotation slims it (M9 fix 629): written from
// ROTATING_NAME and renamed to hooks.1.jsonl once whole, so a file under
// this name with ROTATING_NAME gone is a finished slim.
export const SLIMMING_NAME = 'hooks.slimming.jsonl';

// A hook line as the older generations keep it (M9 fix 629): every
// top-level field in its place, the payload cut to what the activity
// view reads. The current hooks.jsonl keeps what the sink writes; a
// generation is only ever read back by the daemon's load (`lineOf` in
// packages/daemon/src/activity.ts) and `emmer explain` (which reads
// `payload.session_id` alone), so every payload field `lineOf` reads is
// kept here, and a field read there is added here: the fix 629 test in
// activity.test.ts loads a fixture whole and slimmed and fails on any
// span that differs. A line that is not a hook line (torn, a presence
// or a usage line) comes back unchanged, and a slimmed line slims to
// itself, so a pass over a generation already slim changes nothing.
export function slimHookLine(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return raw;
  const line = parsed as Record<string, unknown>;
  if (typeof line['sessionId'] !== 'string') return raw;
  const p = line['payload'];
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return raw;
  const payload = p as HookPayload;
  const event = line['event'];
  const slim: Record<string, unknown> = {};
  const str = (v: unknown): v is string => typeof v === 'string';
  const num = (v: unknown): v is number => typeof v === 'number';
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (str(payload.session_id)) slim['session_id'] = payload.session_id;
  if (str(payload.agent_id)) slim['agent_id'] = payload.agent_id;
  if (str(payload.tool_name)) slim['tool_name'] = payload.tool_name;
  if (line['unhosted'] === true && str(payload.cwd)) slim['cwd'] = payload.cwd;
  if (event === 'UserPromptSubmit') {
    const prompt = summarize(payload.prompt);
    if (prompt !== null) slim['prompt'] = prompt;
  } else if (event === 'StatusLine') {
    const window: unknown = payload.context_window;
    const current: unknown = obj(window) ? window['current_usage'] : null;
    const usage = obj(current) ? current : null;
    if (usage !== null) {
      const kept: Record<string, number> = {};
      for (const k of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']) {
        if (num(usage[k])) kept[k] = usage[k];
      }
      slim['context_window'] = { current_usage: kept };
    }
    if (obj(payload.cost) && num(payload.cost['total_cost_usd'])) slim['cost'] = { total_cost_usd: payload.cost['total_cost_usd'] };
    const cache = promptCacheKept(payload.prompt_cache);
    if (cache !== null) slim['prompt_cache'] = cache;
    if (obj(payload.model)) {
      const model: Record<string, string> = {};
      if (str(payload.model['display_name'])) model['display_name'] = payload.model['display_name'];
      if (str(payload.model['id'])) model['id'] = payload.model['id'];
      slim['model'] = model;
    }
    // The effort level the activity line reads (M9 fix 800).
    if (obj(payload.effort) && str(payload.effort['level'])) slim['effort'] = { level: payload.effort['level'] };
  } else if (event === 'SubagentStart' || event === 'SubagentStop') {
    if (str(payload.agent_type)) slim['agent_type'] = payload.agent_type;
  } else if (event === 'PostToolUse' && payload.tool_name === 'Agent') {
    // A response description that is a string wins over the input's even
    // when it summarizes to nothing, so it is kept as '' then.
    if (obj(payload.tool_response)) {
      const r = payload.tool_response;
      const response: Record<string, unknown> = {};
      if (str(r['agentId'])) response['agentId'] = r['agentId'];
      if (str(r['description'])) response['description'] = summarize(r['description']) ?? '';
      slim['tool_response'] = response;
    }
    if (obj(payload.tool_input)) {
      const i = payload.tool_input;
      const input: Record<string, unknown> = {};
      if (str(i['description'])) input['description'] = summarize(i['description']) ?? '';
      if (str(i['subagent_type'])) input['subagent_type'] = i['subagent_type'];
      slim['tool_input'] = input;
    }
  } else if (event === 'Stop' && Array.isArray(payload.background_tasks)) {
    // parseRunning (state-machine.ts) gives lineOf the running ids alone.
    slim['background_tasks'] = payload.background_tasks
      .filter((t): t is Record<string, unknown> => obj(t) && t['status'] === 'running')
      .map((t) => ({ id: t['id'], status: t['status'] }));
  }
  return JSON.stringify({ ...line, payload: slim });
}

// Whether a line is a hook line with its payload as the sink wrote it
// (M9 fix 629): every sink-written payload carries hook_event_name, the
// sink reading the event from it, and the slim form never keeps it.
export function isFullPayloadLine(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const line = parsed as Record<string, unknown>;
  if (typeof line['sessionId'] !== 'string') return false;
  const payload = line['payload'];
  return typeof payload === 'object' && payload !== null && 'hook_event_name' in payload;
}

// The three fields of a status line's prompt_cache block that the log keeps
// (M9 fix 772): its warmth, its TTL and its expiry, which the idle countdown
// reads and `emmer explain` can show afterwards; the rest of the block (the
// request counts, the hit ratio) is the moment's. Null when the payload
// carries no block.
export function promptCacheKept(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const pc = value as Record<string, unknown>;
  const kept: Record<string, unknown> = {};
  for (const k of ['warm', 'ttl', 'expires_at']) if (pc[k] !== undefined) kept[k] = pc[k];
  return kept;
}
