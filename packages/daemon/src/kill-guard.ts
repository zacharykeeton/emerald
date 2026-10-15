import type { Logger } from './log.ts';

// node-pty's kill() on a ConPTY session kills every pid its console list
// agent names (windowsPtyAgent.js, `process.kill(pid)` in a forEach that
// swallows errors). On Windows `process.kill(0)` ends the calling process
// at once with exit 1 and no output, so a list holding 0 or the daemon's
// own pid took emmerd down from a pane close with no line anywhere (M9 fix
// 732). The guard refuses those two and throws the ESRCH node-pty already
// ignores; a signal-0 call is a liveness probe and passes through.
export function guardSelfKill(proc: { kill: typeof process.kill; pid: number }, log: Logger): void {
  const kill = proc.kill;
  const guarded = function (this: unknown, pid: number, signal?: string | number) {
    const n = Number(pid);
    if (signal !== 0 && (n === 0 || n < 0 || n === proc.pid)) {
      log.warn('refused a kill of the daemon itself', { pid, stack: new Error().stack });
      throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH', syscall: 'kill' });
    }
    return kill.call(this, pid, signal);
  };
  proc.kill = guarded as typeof process.kill;
}
