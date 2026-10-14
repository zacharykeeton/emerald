import fs from 'node:fs';
import path from 'node:path';
import type { UsageAsk, UsageResult } from '../preload/api.ts';
import { claudeHome, claudeHomeExists } from './claude-home.ts';
import { parseRetryAfter, parseUsageReply } from '../renderer/src/usage-model.ts';

// The account's Claude usage, read the way Claude Code's /usage reads it:
// the OAuth token Claude Code keeps in ~/.claude/.credentials.json, sent
// as a Bearer to the usage endpoint. The token is read for one request
// and dropped; it is never logged and never crosses to the renderer, which
// only sees the parsed windows. The strip cannot refresh an expired token
// (Claude Code does that when it runs), so signed-out is a state the
// strip shows rather than fixes.
//
// EMERALD_CLAUDE_HOME and EMERALD_USAGE_URL exist for the verify script, which
// seeds a credentials file and serves a canned reply on a local port.

const DEFAULT_URL = 'https://api.anthropic.com/api/oauth/usage';
const TIMEOUT_MS = 10_000;

export type UsageLog = (msg: string) => void;

function credentialsFile(): string {
  return path.join(claudeHome(), '.credentials.json');
}

// The token, or null when there is no file, no claudeAiOauth.accessToken
// in it, or the file says the token has expired (expiresAt in ms, when
// present; a file without it is trusted and the endpoint decides).
function readToken(log: UsageLog): string | null {
  // A home that is not there is signed-out, said once (M9 fix 243).
  if (!claudeHomeExists(log)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(credentialsFile(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log(`could not read the Claude credentials: ${String(err)}`);
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const oauth = (parsed as Record<string, unknown>)['claudeAiOauth'];
    if (typeof oauth !== 'object' || oauth === null) return null;
    const { accessToken, expiresAt } = oauth as Record<string, unknown>;
    if (typeof accessToken !== 'string' || accessToken.length === 0) return null;
    if (typeof expiresAt === 'number' && expiresAt <= Date.now()) return null;
    return accessToken;
  } catch {
    // Not JSON, or not the shape Claude Code writes: the same as no token.
    return null;
  }
}

// M9 fix 348: `ask` is what made the strip ask (its mount, its timer,
// the window's focus, the button), on the read line, so a run of reads
// in a harness log is told apart from a strip asking twice: a verify
// script's Page.reload is a mount each, and four reloads in three
// seconds read as four asks around a tab open once.
export async function fetchUsage(log: UsageLog, ask: UsageAsk = 'mount'): Promise<UsageResult> {
  const token = readToken(log);
  if (token === null) return { error: 'signed-out' };
  let res: Response;
  try {
    res = await fetch(process.env['EMERALD_USAGE_URL'] ?? DEFAULT_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    log(`usage fetch failed: ${String(err)}`);
    return { error: 'unavailable', reason: { kind: 'offline' } };
  }
  if (res.status === 401 || res.status === 403) return { error: 'unauthorized' };
  if (res.status === 429) {
    // The limit is undocumented (M9 fix 99), so the whole answer goes to
    // the log for the next person who wants to know what it carries; the
    // response headers never hold the token.
    const headers = [...res.headers.entries()].map(([k, v]) => `${k}=${v}`).join(', ');
    const text = await res.text().catch(() => '');
    log(`usage endpoint answered 429; headers: ${headers}; body: ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
    return { error: 'unavailable', reason: { kind: 'rate-limited', retryAfterMs: parseRetryAfter(res.headers.get('retry-after'), Date.now()) } };
  }
  if (!res.ok) {
    log(`usage endpoint answered ${res.status}`);
    return { error: 'unavailable', reason: { kind: 'server', status: res.status } };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    log(`usage reply was not JSON: ${String(err)}`);
    return { error: 'unavailable', reason: { kind: 'bad-reply' } };
  }
  const windows = parseUsageReply(body);
  if (windows === null) {
    log('usage reply was not an object');
    return { error: 'unavailable', reason: { kind: 'bad-reply' } };
  }
  // One line per reading (M9 fix 163), so the log shows the true cadence
  // of the asks beside the 429s; the log has no levels, and a dozen
  // lines an hour is the cost of knowing.
  log(`usage read: ${windows.length} windows, asked on ${ask}`);
  return { windows };
}
