import fs from 'node:fs';
import path from 'node:path';

export interface Logger {
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

// Append-only text log. Synchronous writes on purpose: the daemon logs rarely
// and a crash must not lose the last line that explains it.
export function createFileLogger(filePath: string, alsoStderr: boolean): Logger {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const write = (level: string, msg: string, extra?: unknown) => {
    const detail = extra === undefined ? '' : ' ' + formatExtra(extra);
    const line = `${new Date().toISOString()} ${level} ${msg}${detail}\n`;
    try {
      fs.appendFileSync(filePath, line);
    } catch {
      // Logging must never take the daemon down.
    }
    if (alsoStderr) process.stderr.write(line);
  };
  return {
    info: (msg, extra) => write('INFO', msg, extra),
    warn: (msg, extra) => write('WARN', msg, extra),
    error: (msg, extra) => write('ERROR', msg, extra),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

// The size past which the daemon's log is moved aside at a start (M9 fix
// 499): it had no bound, 7.2 MB in sixteen days on this box and growing
// with every batch week, where hooks.jsonl has rotated since fix 377.
export const LOG_ROTATE_AT_BYTES = 8 * 1024 * 1024;

// Moves a log past the threshold to <name>.1<ext> beside it, replacing an
// older generation, in ActivityLog.load's shape; one generation is plenty
// for a log nobody reads past the last few days. Answers the bytes moved,
// or null when the file is under the threshold, absent or held. The
// logger appends by path, so its next line starts the new file.
export function rotateLogAtStart(file: string, atBytes: number = LOG_ROTATE_AT_BYTES): number | null {
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

function formatExtra(extra: unknown): string {
  if (extra instanceof Error) return extra.stack ?? extra.message;
  try {
    return JSON.stringify(extra);
  } catch {
    return String(extra);
  }
}
