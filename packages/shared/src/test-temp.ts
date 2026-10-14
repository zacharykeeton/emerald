import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// The unit suites' temp folder helper (M9 fix 585). Kept out of the index
// barrel because the renderer imports that and this file needs fs, os and
// path; compiled into dist because the daemon, CLI and app tests import
// shared from there; left out of the installed build by stage.mjs's test-only
// list (M9 fix 602).

// Node 24's rmSync ignores the maxRetries option on the EPERM a held
// folder gives on Windows (measured at 0 ms with twenty asked for, the
// CLAUDE.md fixes 329 to 351 bullet), so a test's folder teardown
// retries by hand instead: twenty tries half a second apart, the last
// error thrown, in demo/reset.mjs's removeWithPatience shape.
export function removeWithPatience(dir: string): void {
  let last: unknown = null;
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      last = err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  throw last;
}

const made: string[] = [];

// A folder under os.tmpdir() named the prefix plus six random characters,
// remembered for removeTemps.
export function mkTemp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

// Removes every folder mkTemp made in this process (node --test runs each
// file in a process of its own, so the list is the file's). A folder still
// held (a shell or a watcher not yet gone) is retried in rounds, twenty
// half a second apart, so one call is bounded at about ten seconds rather
// than ten per folder; what is still there after that is named on stderr
// and left, never thrown, so a held folder never fails a file whose tests
// passed. The wait between rounds is a timer, not a blocking sleep (M9 fix
// 600): a blocked event loop held session-manager-tail.test to its timeout
// while node-pty tore a killed shell down. test.after takes the promise as
// it is; a call inside a hook's own body is awaited.
export async function removeTemps(): Promise<void> {
  let left = made.splice(0);
  for (let round = 0; left.length > 0 && round < 20; round++) {
    if (round > 0) await delay(500);
    left = left.filter((dir) => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        return false;
      } catch {
        return true;
      }
    });
  }
  for (const dir of left) console.error(`test-temp: could not remove ${dir}`);
}
