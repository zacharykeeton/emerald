import fs from 'node:fs';
import path from 'node:path';

// The main process's twin of the daemon's rotateLogAtStart
// (packages/daemon/src/log.ts, M9 fix 499), copied rather than shared
// since the app cannot import the daemon and a shared subpath export is
// more moving parts than these lines (M9 fix 559). main.log had no bound.
export const MAIN_LOG_ROTATE_AT_BYTES = 8 * 1024 * 1024;

// Moves a log past the threshold to <name>.1<ext> beside it, replacing an
// older generation. Answers the bytes moved, or null when the file is
// under the threshold, absent or held. main.log is appended by path and
// reopened per line, so a launch that renames it under a live window only
// starts that window's next line in the new file, and a rename that fails
// (the other window's append holding it at that instant) waits for the
// next start.
export function rotateLogAtStart(file: string, atBytes: number = MAIN_LOG_ROTATE_AT_BYTES): number | null {
  try {
    const size = fs.statSync(file).size;
    if (size <= atBytes) return null;
    const ext = path.extname(file);
    fs.renameSync(file, path.join(path.dirname(file), `${path.basename(file, ext)}.1${ext}`));
    return size;
  } catch {
    return null;
  }
}
