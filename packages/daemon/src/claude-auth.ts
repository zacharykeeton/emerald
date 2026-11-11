// Whether the daemon's claude is signed in (M9 fix 1094), read off
// `claude auth status --json` when the empty pane asks, never on the
// hello's path. Claude Code 2.1.319 prints { loggedIn, authMethod, ...,
// loginExpiresAt } on stdout, loginExpiresAt an ISO string or null, and
// exits 1 when not logged in, so stdout is read whatever the exit code.
import { execFile } from 'node:child_process';
import type { ClaudeAuth } from '@emerald/shared';

export const CLAUDE_AUTH_TIMEOUT_MS = 10_000;

// The answer of one read: null unless the text is a JSON object whose
// loggedIn is a boolean; expiresAt is the parsed loginExpiresAt when that
// is a string naming a time, else null.
export function parseClaudeAuth(stdout: string): ClaudeAuth | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o['loggedIn'] !== 'boolean') return null;
  const raw = o['loginExpiresAt'];
  const at = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return { signedIn: o['loggedIn'], expiresAt: Number.isFinite(at) ? at : null };
}

// Runs the read, never rejecting: no claude, a spawn error, a timeout's
// kill and an answer that is not JSON all come back null.
export function readClaudeAuth(run: { file: string; args: string[] } | null, env: NodeJS.ProcessEnv, timeoutMs = CLAUDE_AUTH_TIMEOUT_MS): Promise<ClaudeAuth | null> {
  if (run === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      execFile(run.file, [...run.args, 'auth', 'status', '--json'], { env, timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 65536 }, (_err, stdout) => resolve(parseClaudeAuth(stdout ?? '')));
    } catch {
      resolve(null);
    }
  });
}
