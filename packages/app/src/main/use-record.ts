import fs from 'node:fs';
import path from 'node:path';
import { USE_RECORD_GENERATIONS, USE_RECORD_ROTATE_AT_BYTES, useLineOf } from '@emerald/shared';
import { generationNumber, generationPaths, rotatedPath } from '@emerald/shared/hook-log';

// The usage record's writer (M9 fix 676): one JSON line per line the
// renderer sends, appended to <EMERALD_HOME>/logs/usage.jsonl with main's
// clock, rotated into numbered generations as the hook log is. Main never
// reads the switch; a renderer with it off sends nothing. Every line goes
// through useLineOf, so only known words reach the file.
export interface UseRecord {
  write(raw: unknown): void;
}

export function createUseRecord(
  file: string,
  log: (msg: string) => void,
  opts: { now?: () => number; rotateAtBytes?: number } = {},
): UseRecord {
  const now = opts.now ?? Date.now;
  const rotateAt = opts.rotateAtBytes ?? USE_RECORD_ROTATE_AT_BYTES;
  let size: number | null = null;
  let refusedLogged = false;
  let canRotate = true;

  // Shift every generation up one, dropping the one past the cap, then
  // move the current file to generation 1. A rename that throws turns
  // rotation off for the run rather than leaving a half-shifted chain to
  // be shifted again on every line.
  const rotate = (): void => {
    try {
      for (const gen of generationPaths(file)) {
        if (gen === file) continue;
        const n = generationNumber(file, gen);
        if (n + 1 > USE_RECORD_GENERATIONS) fs.rmSync(gen, { force: true });
        else fs.renameSync(gen, rotatedPath(file, n + 1));
      }
      fs.renameSync(file, rotatedPath(file, 1));
      size = 0;
    } catch (err) {
      canRotate = false;
      log(`usage record could not be rotated: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return {
    write(raw: unknown): void {
      const line = useLineOf(raw);
      if (line === null) {
        if (!refusedLogged) {
          refusedLogged = true;
          log('usage record: a line refused');
        }
        return;
      }
      const text = JSON.stringify({ at: now(), ...line }) + '\n';
      try {
        if (size === null) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          try {
            size = fs.statSync(file).size;
          } catch {
            size = 0;
          }
        }
        const bytes = Buffer.byteLength(text);
        if (canRotate && size > 0 && size + bytes > rotateAt) rotate();
        fs.appendFileSync(file, text);
        size += bytes;
      } catch {
        // A read-only home or a full disk; the record is a convenience.
      }
    },
  };
}
