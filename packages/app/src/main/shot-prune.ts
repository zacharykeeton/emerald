import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

// M9 fix 696: Design Mode's crops (`design/`) and `emmer browser
// screenshot`'s files (`screenshots/`) were kept for ever. Once a launch,
// the PNGs in those two folders older than 14 days are removed. The age is
// the file's mtime, not its name, since the two folders name their files
// differently. `downloads/` holds the person's own files and is never read,
// and nothing but a `.png` is touched.
export const SHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const SHOT_DIRS = ['design', 'screenshots'] as const;

// The names to remove, in the order given: a `.png` (any case) strictly
// older than the age, so a file exactly 14 days old stays.
export function shotsToPrune(entries: ReadonlyArray<{ name: string; mtimeMs: number }>, nowMs: number, maxAgeMs: number = SHOT_MAX_AGE_MS): string[] {
  return entries.filter((e) => e.name.toLowerCase().endsWith('.png') && nowMs - e.mtimeMs > maxAgeMs).map((e) => e.name);
}

// The sweep: each folder's plain files one level deep (a missing folder is
// no files, a stat that fails skips that file), unlinked one at a time; a
// failure is logged and left for the next launch. Answers the count removed.
export async function pruneShots(home: string, nowMs: number, log: (msg: string) => void): Promise<number> {
  let removed = 0;
  for (const dir of SHOT_DIRS) {
    const folder = path.join(home, dir);
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    const entries: { name: string; mtimeMs: number }[] = [];
    for (const d of dirents) {
      if (!d.isFile()) continue;
      try {
        const st = await fs.stat(path.join(folder, d.name));
        entries.push({ name: d.name, mtimeMs: st.mtimeMs });
      } catch {
        // Gone or unreadable between the list and the stat: skip it.
      }
    }
    for (const name of shotsToPrune(entries, nowMs)) {
      const full = path.join(folder, name);
      try {
        await fs.unlink(full);
        removed++;
      } catch (err) {
        log(`shots: could not remove ${full}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (removed > 0) log(`shots: removed ${removed} ${removed === 1 ? 'PNG' : 'PNGs'} older than 14 days from design and screenshots`);
  return removed;
}
