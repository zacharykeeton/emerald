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

export interface ReaperProbes {
  alive(pid: number): boolean;
  startedAt(pid: number): number | null;
}

export type ProcessIdentity = 'same' | 'gone' | 'other';

// Whether `pid` is still the process that started at `startedAt`: false
// when it has gone, which is the ordinary case, and false when its start
// time does not match, which means the number has been reused.
export function isSameProcess(pid: number, startedAt: number, probes: ReaperProbes): boolean {
  return processIdentity(pid, startedAt, probes) === 'same';
}

// The same read with the two ways of not being the same kept apart, so a
// caller can say which: `gone` when nothing holds the pid or its start
// time cannot be read, `other` when something else holds it now.
export function processIdentity(pid: number, startedAt: number, probes: ReaperProbes = systemProbes): ProcessIdentity {
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(startedAt)) return 'gone';
  if (!probes.alive(pid)) return 'gone';
  return judge(probes.startedAt(pid), startedAt);
}

function judge(actual: number | null, startedAt: number): ProcessIdentity {
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

// The epoch milliseconds Windows reports for a pid's creation, or null
// when the process has gone or the read failed.
export function readStartedAt(pid: number): number | null {
  try {
    const out = spawnSync('powershell.exe', scriptArgs(startScript(), pid), { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    return parseStart(out.stdout ?? '');
  } catch {
    return null;
  }
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

export const systemProbes: ReaperProbes = { alive, startedAt: readStartedAt };

// processIdentity through an async spawn, for the app's main process,
// which must not block its event loop on a PowerShell.
export function processIdentityAsync(pid: number, startedAt: number): Promise<ProcessIdentity> {
  if (!Number.isFinite(pid) || pid <= 0 || !Number.isFinite(startedAt) || !alive(pid)) return Promise.resolve('gone');
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (value: ProcessIdentity) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child;
    try {
      child = spawn('powershell.exe', scriptArgs(startScript(), pid), { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve('gone');
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      done('gone');
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (out += chunk));
    child.on('error', () => done('gone'));
    child.on('close', () => done(judge(parseStart(out), startedAt)));
  });
}
