// The exit reaper (M9 fix 258, rebuilt by M9 fix 416).
//
// process.exit(0) in the daemon's finish() does not always end the
// process: node-pty's teardown hangs it now and then, so finish spawns
// this file detached and it kills the daemon's tree a few seconds later,
// which finds nothing when the exit went through and ends the hang when
// it did not.
//
// Two things were wrong with the `node -e` one-liner this replaces. A
// pending `taskkill /pid N /t /f` names a number, and Windows reuses pids
// within a couple of minutes on a busy box (fix 416's probe watched three
// of its own hundred numbers taken by other processes inside three
// minutes), so a reaper that is merely slow can land on whatever took the
// number; and one such node.exe, spawned at a close-out, was found alive
// thirteen hours later with no taskkill child and its target long gone.
//
// So the reaper carries the daemon's start time beside its pid and kills
// nothing whose start time does not match, and caps its own life at
// thirty seconds whatever happens, which is the part that does not depend
// on having guessed the stall right.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isSameProcess, systemProbes } from '@emerald/shared/process-identity';
import type { ReaperProbes } from '@emerald/shared/process-identity';

// The identity check lives in shared since M9 fix 494, where the app's
// restart and the CLI's stop use it too; re-exported for reaper.test.ts.
export { START_TOLERANCE_MS, isSameProcess, readStartedAt, systemProbes } from '@emerald/shared/process-identity';
export type { ReaperProbes } from '@emerald/shared/process-identity';

// Long enough for a clean exit to have happened, short enough that a hung
// daemon does not hold the pipe (M9 fix 258 chose it).
export const REAP_AFTER_MS = 4000;

// The reaper's whole life. Armed before anything else, so a stall in the
// wait or in the start-time read ends here rather than at a reused pid.
export const REAPER_DEADLINE_MS = 30_000;

export function reap(pid: number, startedAt: number, probes: ReaperProbes = systemProbes): void {
  if (!isSameProcess(pid, startedAt, probes)) return;
  spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
}

// Run as a script (`node reaper.js <pid> <startedAt>`) but importable by
// the test, which is the whole reason it is a file rather than a -e
// string. There is nowhere to log: the daemon's log is closed by now.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const pid = Number(process.argv[2]);
  const startedAt = Number(process.argv[3]);
  const deadline = setTimeout(() => process.exit(0), REAPER_DEADLINE_MS);
  setTimeout(() => {
    try {
      reap(pid, startedAt);
    } finally {
      clearTimeout(deadline);
      process.exit(0);
    }
  }, REAP_AFTER_MS);
}
