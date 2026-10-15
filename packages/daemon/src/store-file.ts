import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './log.ts';

// The four stores' shared write and bad-read handling (M9 fix 457, the
// hardening ledger's H2 and M6). sessions.json, state.json, folders.json
// and prompts.json are each rewritten whole through a temp file, and each
// read a bad file as empty; without these two the next save overwrote the
// bad file, so a power cut between a write and its flush lost the list.

// How often and how long a refused rename is tried again: a scanner or a
// reader holding the target open without FILE_SHARE_DELETE lets go within
// a few tens of milliseconds, and a daemon stop's last save must land.
const RENAME_TRIES = 5;
const RENAME_WAIT_MS = 50;
const RETRIED_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

// Writes the text to a sibling, flushes it to the disk, then renames it
// over the file, so a crash or a power cut leaves either the old file or
// the new one whole. The rename is retried on a Windows share refusal.
// Throws when the write fails for good; the caller logs and keeps its
// live copy. The temp carries this process's pid (M9 fix 556), so two
// daemons on one home (another pipe, or a stop overlapping the next
// start) never write into one temp: at worst the last rename wins, a lost
// update rather than a torn file. Cheap, and not a lock.
export function writeFileAtomic(file: string, text: string, log: Logger): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      if (attempt > 1) log.warn(`rename of ${path.basename(file)} landed on try ${attempt}`);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!RETRIED_CODES.has(code) || attempt >= RENAME_TRIES) throw err;
      if (attempt === 1) log.warn(`rename of ${path.basename(file)} refused (${code}), trying again`);
      sleepSync(RENAME_WAIT_MS);
    }
  }
}

// Reads a store's file as text, trying again on a Windows share refusal the
// way the rename does (M9 fix 708): a scanner holding the file without
// sharing read lets go within a few tens of milliseconds, and a refused read
// otherwise reads as an empty list. Any other error, and the last refusal,
// is thrown.
export function readFileRetried(file: string, log: Logger): string {
  for (let attempt = 1; ; attempt++) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (attempt > 1) log.warn(`read of ${path.basename(file)} landed on try ${attempt}`);
      return text;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!RETRIED_CODES.has(code) || attempt >= RENAME_TRIES) throw err;
      if (attempt === 1) log.warn(`read of ${path.basename(file)} refused (${code}), trying again`);
      sleepSync(RENAME_WAIT_MS);
    }
  }
}

// Moves a file the store could not read out of the way before the store
// answers empty, so its next save does not overwrite what may still be
// recovered by hand. The new name carries the time, colons replaced since
// Windows refuses them in a file name. Answers the new path, or null when
// the rename failed too (logged; the store carries on empty either way).
export function setAsideBadFile(file: string, log: Logger): string | null {
  const stamp = new Date().toISOString().replace(/:/g, '-');
  // A rename lands on an existing name without a word, so a second bad
  // read in the same millisecond takes a numbered name instead.
  let aside = `${file}.bad-${stamp}`;
  for (let n = 1; fs.existsSync(aside); n++) aside = `${file}.bad-${stamp}-${n}`;
  try {
    fs.renameSync(file, aside);
    log.error(`${path.basename(file)} could not be read and was set aside as ${aside}`);
    return aside;
  } catch (err) {
    log.error(`${path.basename(file)} could not be read and could not be set aside`, err);
    return null;
  }
}

// How old a store's temp must be before the start's sweep removes it (M9
// fix 556): a write takes milliseconds, so a minute-old temp is one a
// daemon left when it died between the write and the rename.
export const STALE_TEMP_MS = 60_000;

// The stores' temps and daemon.json's, in the pid form and the old fixed
// one.
const STORE_TEMP = /^(sessions|state|folders|prompts|daemon)\.json(\.\d+)?\.tmp$/;

// Removes the stale temps in the home at the start (M9 fix 556), judged by
// their age and never by whether the pid in the name is alive, since a
// pid is a number Windows hands out again within minutes. A file that
// cannot be read or removed is left for the next start. Answers the names
// removed.
export function sweepStaleTemps(dir: string, log: Logger, now = Date.now()): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!STORE_TEMP.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const ageMs = now - fs.statSync(file).mtimeMs;
      if (ageMs <= STALE_TEMP_MS) continue;
      fs.rmSync(file);
      log.info('stale temp removed', { file: name, ageMs: Math.round(ageMs) });
      removed.push(name);
    } catch {
      // Gone already, or held: the next start tries again.
    }
  }
  return removed;
}

// A synchronous wait without spinning the CPU, for the rename's retry,
// which runs on the save paths that must finish before a stop exits.
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
