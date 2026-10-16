import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Logger } from './log.ts';

// node-pty's kill() on a ConPTY session kills every pid its console list
// agent names (windowsPtyAgent.js, `process.kill(pid)` in a forEach that
// swallows errors). On Windows `process.kill(0)` ends the calling process
// at once with exit 1 and no output, so a list holding 0 or the daemon's
// own pid took emmerd down from a pane close with no line anywhere (M9 fix
// 732). The guard refuses those two and throws the ESRCH node-pty already
// ignores; a signal-0 call is a liveness probe and passes through.
//
// With a `trace` (M9 fix 762, EMERALD_KILL_TRACE=1) every kill but a probe
// is logged first with what its target is, read before the kill ends it,
// so a run that loses its daemon can name the kill that did it.
export function guardSelfKill(
  proc: { kill: typeof process.kill; pid: number },
  log: Logger,
  trace: ((pid: number) => string | null) | null = null,
): void {
  const kill = proc.kill;
  const guarded = function (this: unknown, pid: number, signal?: string | number) {
    const n = Number(pid);
    if (trace !== null && signal !== 0) {
      const at = Date.now();
      const target = trace(n);
      log.info('kill traced', { pid, signal, target, readMs: Date.now() - at, stack: new Error().stack });
    }
    if (signal !== 0 && (n === 0 || n < 0 || n === proc.pid)) {
      log.warn('refused a kill of the daemon itself', { pid, stack: new Error().stack });
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH', syscall: 'kill' });
    }
    return kill.call(this, pid, signal);
  };
  proc.kill = guarded as typeof process.kill;
}

// The parent pid, the image name and the command line of a pid, or null
// when it has gone or the read failed. A script file rather than -Command,
// as process-identity.ts does, since a -Command under the app is held two
// to five seconds by this box's antivirus. Synchronous on purpose: the
// target must be read before the kill ends it.
const LINE_SCRIPT = [
  'param([int]$Id)',
  '$p = Get-CimInstance Win32_Process -Filter "ProcessId = $Id"',
  'if ($p) { "$($p.ParentProcessId) $($p.Name) $($p.CommandLine)" }',
  '',
].join('\n');

// Written only when missing or different, so a reader never meets it half
// rewritten by another reader of the same build.
function lineScript(): string {
  const script = path.join(os.tmpdir(), 'emerald-process-line.ps1');
  let current: string | null = null;
  try {
    current = fs.readFileSync(script, 'utf8');
  } catch {
    // Not there yet.
  }
  if (current !== LINE_SCRIPT) fs.writeFileSync(script, LINE_SCRIPT);
  return script;
}

export function readProcessLine(pid: number): string | null {
  try {
    const out = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', lineScript(), String(pid)], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    const line = (out.stdout ?? '').trim();
    return line === '' ? null : line;
  } catch {
    return null;
  }
}
