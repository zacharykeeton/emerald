// Whether a pid still names the process a caller met (M9 fix 494, moved
// here from the daemon's reaper, which has had it since M9 fix 416).
//
// A pid is a number Windows reuses within a couple of minutes on a busy
// box (fix 416's probe watched three of its own hundred numbers taken by
// other processes inside three minutes), so a `taskkill /pid N /t /f` for
// a number read even a few seconds ago can land on whatever took it, and
// `/t` then takes that process's tree. Every kill of a remembered daemon
// goes through here with the start time the daemon itself reported, and
// kills nothing whose start time does not match.
//
// A subpath export (@emerald/shared/process-identity) rather than part of
// the barrel, since the renderer imports the barrel and this spawns
// processes.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A process's own Date.now() - process.uptime() * 1000 drifts from the
// creation time Windows reports by a few hundred milliseconds. Two
// seconds is far inside the window in which a pid can be reused.
export const START_TOLERANCE_MS = 2000;

const PS_TIMEOUT_MS = 5000;
const POWERSHELL_TIMEOUT_MS = 10_000;

// A start time, `null` when the read ran and found no process, `'unknown'`
// when it timed out or failed (M9 fix 1109).
export type StartRead = number | null | 'unknown';

export interface ReaperProbes {
  alive(pid: number): boolean;
  startedAt(pid: number): StartRead;
}

export type ProcessIdentity = 'same' | 'gone' | 'other' | 'unknown';

// Whether `pid` is still the process that started at `startedAt`: false
// when it has gone, which is the ordinary case, and false when its start
// time does not match, which means the number has been reused.
export function isSameProcess(pid: number, startedAt: number, probes: ReaperProbes): boolean {
  return processIdentity(pid, startedAt, probes) === 'same';
}

// The same read with the ways of not being the same kept apart, so a
// caller can say which: `gone` when nothing holds the pid or the read found
// no process there, `other` when something else holds it now, `unknown`
// when the read timed out or failed (M9 fix 1109): under load PowerShell can
// take past its 10 s, and that is not a process gone; no caller kills on it.
export function processIdentity(pid: number, startedAt: number, probes: ReaperProbes = systemProbes): ProcessIdentity {
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(startedAt)) return 'gone';
  if (!probes.alive(pid)) return 'gone';
  return judge(probes.startedAt(pid), startedAt);
}

function judge(actual: StartRead, startedAt: number): ProcessIdentity {
  if (actual === 'unknown') return 'unknown';
  if (actual === null) return 'gone';
  return Math.abs(actual - startedAt) <= START_TOLERANCE_MS ? 'same' : 'other';
}

// PowerShell is the way to a creation time without wmic, and it is run
// from a script file rather than with -Command because an -EncodedCommand
// or -Command is held two to five seconds by this box's antivirus when
// the parent chain reaches the app; from a plain node parent the two are
// within 50 ms of each other, so the file costs nothing where the hold
// does not apply.
const START_SCRIPT = [
  'param([int]$Id)',
  '$p = Get-CimInstance Win32_Process -Filter "ProcessId = $Id"',
  "if ($p) { [int64](($p.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) }",
  '',
].join('\n');

const SCRIPT_NAME = 'emerald-process-start.ps1';

// Written only when it is missing or holds something else, so a reader
// never meets it half rewritten by another reader of the same build.
function startScript(): string {
  const script = path.join(os.tmpdir(), SCRIPT_NAME);
  let current: string | null = null;
  try {
    current = fs.readFileSync(script, 'utf8');
  } catch {
    // Not there yet.
  }
  if (current !== START_SCRIPT) fs.writeFileSync(script, START_SCRIPT);
  return script;
}

function scriptArgs(script: string, pid: number): string[] {
  return ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, String(pid)];
}

function parseStart(out: string): number | null {
  const ms = Number(out.trim());
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// `ps` with its C locale, so a column never reads in another language;
// only its stdout is ever parsed, since procps under wsl.exe with no
// terminal writes "your 131072x1 screen size is bogus" to stderr.
const PS_ENV = (): NodeJS.ProcessEnv => ({ ...process.env, LC_ALL: 'C' });

// Off Windows a start time comes from `ps -o etime=` (M9 fix 1016): the
// elapsed time is a count and reads the same on macOS and procps, where
// `lstart` prints local time in a locale-shaped text whose parse by Date is
// not specified. The half second centres etime's whole-second truncation
// inside START_TOLERANCE_MS.
function startFromElapsed(out: string): number | null {
  const seconds = parseElapsed(out);
  return seconds === null ? null : Date.now() - (seconds + 0.5) * 1000;
}

function elapsedArgs(pid: number): string[] {
  return ['-o', 'etime=', '-p', String(pid)];
}

// What a read's output means (M9 fix 1109): `unknown` when the read failed
// or printed something that is not a time, `null` when it printed nothing
// (no such process), else the time. The exit status is not read: `ps -p`
// exits 1 for a missing pid, and an empty PowerShell output with exit 0 is
// a pid nobody holds.
export function startFrom(out: string, failed: boolean, platform: NodeJS.Platform = process.platform): StartRead {
  if (failed) return 'unknown';
  if (out.trim() === '') return null;
  const read = platform === 'win32' ? parseStart(out) : startFromElapsed(out);
  return read === null ? 'unknown' : read;
}

// The epoch milliseconds the system reports for a pid's creation, `null`
// when the read found no process, `'unknown'` when it timed out or failed.
export function readStartTime(pid: number, platform: NodeJS.Platform = process.platform): StartRead {
  try {
    if (platform !== 'win32') {
      const ps = spawnSync('ps', elapsedArgs(pid), { encoding: 'utf8', timeout: PS_TIMEOUT_MS, env: PS_ENV() });
      return startFrom(ps.stdout ?? '', ps.error !== undefined, platform);
    }
    const out = spawnSync('powershell.exe', scriptArgs(startScript(), pid), { encoding: 'utf8', windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS });
    return startFrom(out.stdout ?? '', out.error !== undefined, platform);
  } catch {
    return 'unknown';
  }
}

// readStartTime with the unknown folded into null, for callers that only
// want a time.
export function readStartedAt(pid: number, platform: NodeJS.Platform = process.platform): number | null {
  const r = readStartTime(pid, platform);
  return typeof r === 'number' ? r : null;
}

// One row per line of `ps -A -o pid=,ppid=` (M9 fix 1016); a line that is
// not two integers is skipped.
export function parsePsTable(out: string): Array<{ pid: number; ppid: number }> {
  const rows: Array<{ pid: number; ppid: number }> = [];
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m !== null) rows.push({ pid: Number(m[1]), ppid: Number(m[2]) });
  }
  return rows;
}

// The pid's descendants in post order, children in table order, the pid
// itself last, so a kill in this order takes the leaves before their
// parents. The visited set keeps a reused number from looping.
export function treeOf(pid: number, rows: ReadonlyArray<{ pid: number; ppid: number }>): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (p: number): void => {
    if (seen.has(p)) return;
    seen.add(p);
    for (const r of rows) if (r.ppid === p && r.pid !== p) walk(r.pid);
    out.push(p);
  };
  walk(pid);
  return out;
}

// `ps`'s etime, `[[dd-]hh:]mm:ss`, as seconds; anything else is null.
export function parseElapsed(text: string): number | null {
  const m = /^\s*(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)\s*$/.exec(text);
  if (m === null) return null;
  const [, d, h, min, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s);
}

// Kills pid's whole tree (M9 fix 1016): null on success, else the
// failure's message. On win32 it is the `taskkill /t /f` the reaper, the
// CLI and the app each ran, moved here whole. Off it there is no tree kill
// in the system, so one `ps` reads the table and every descendant, then
// the pid, gets a SIGKILL; a process gone meanwhile (ESRCH) is fine. When
// `ps` fails the pid alone is killed and the answer says so.
export function killTree(pid: number, platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
    return result.error?.message ?? null;
  }
  const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000, env: PS_ENV() });
  const psFailed = ps.error !== undefined || ps.status !== 0;
  const pids = psFailed ? [pid] : treeOf(pid, parsePsTable(ps.stdout ?? ''));
  let first: string | null = null;
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH' && first === null) first = (err as Error).message;
    }
  }
  if (psFailed) return `ps failed: ${ps.error?.message ?? `exit ${String(ps.status)}`}`;
  return first;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM is a process this one may not signal, which is still a
    // process; anything else (ESRCH) is a pid nobody holds.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export const systemProbes: ReaperProbes = { alive, startedAt: readStartTime };

// One async start-time read (M9 fix 1109): the child's output through
// startFrom, `unknown` on a spawn that throws, an error event or the timer.
// The first settle wins.
export function readStartAsync(command: string, args: string[], platform: NodeJS.Platform, timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<StartRead> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (value: StartRead) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], ...(env === undefined ? {} : { env }) });
    } catch {
      done('unknown');
      return;
    }
    timer = setTimeout(() => {
      child.kill();
      done('unknown');
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (out += chunk));
    child.on('error', () => done('unknown'));
    child.on('close', () => done(startFrom(out, false, platform)));
  });
}

// processIdentity through an async spawn, for the app's main process,
// which must not block its event loop on a PowerShell (or, off Windows,
// a `ps`, M9 fix 1016).
export async function processIdentityAsync(pid: number, startedAt: number, platform: NodeJS.Platform = process.platform): Promise<ProcessIdentity> {
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(startedAt) || !alive(pid)) return 'gone';
  try {
    const read =
      platform !== 'win32'
        ? await readStartAsync('ps', elapsedArgs(pid), platform, PS_TIMEOUT_MS, PS_ENV())
        : await readStartAsync('powershell.exe', scriptArgs(startScript(), pid), platform, POWERSHELL_TIMEOUT_MS);
    return judge(read, startedAt);
  } catch {
    return 'unknown';
  }
}
