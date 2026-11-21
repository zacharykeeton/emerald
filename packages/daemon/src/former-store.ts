import fs from 'node:fs';
import { FORMER_FOLDERS_MAX, overlapsFolder, underFolder } from '@emerald/shared';
import type { FormerFolders } from '@emerald/shared';
import { RequestError } from './errors.ts';
import type { Logger } from './log.ts';
import { setAsideBadFile, writeFileAtomic } from './store-file.ts';
import { realFolder } from './real-folder.ts';

// A folder's former folders (M9 fix 1191), ~/.emerald/former-folders.json
// as a bare array of { folder, former }, beside folders.json and of the
// same make: where a renamed or moved checkout lived before, so its
// Statistics count the old folder's history with it. The daemon's, so the
// CLI and scripts/rename.mjs can write it. The folder is keyed by
// realFolder's spelling; a former folder is kept as given, since it
// usually no longer exists, and both compare case-blind with one
// separator, underFolder's fold. The daemon seeds nothing.
export class FormerStore {
  private readonly filePath: string;
  private readonly log: Logger;
  private entries = new Map<string, string[]>();

  constructor(filePath: string, log: Logger) {
    this.filePath = filePath;
    this.log = log;
  }

  load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn('could not read former folders file', err);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.log.warn(`former folders file ${this.filePath} is not JSON, starting with none`, err);
      setAsideBadFile(this.filePath, this.log);
      return;
    }
    if (!Array.isArray(parsed)) {
      this.log.warn(`former folders file ${this.filePath} is not a list, starting with none`);
      setAsideBadFile(this.filePath, this.log);
      return;
    }
    for (const entry of parsed) {
      const e = entry as Partial<FormerFolders> | null;
      if (e !== null && typeof e === 'object' && typeof e.folder === 'string' && e.folder !== '' && Array.isArray(e.former) && e.former.every((f) => typeof f === 'string' && f !== '')) {
        this.entries.set(this.keyOf(e.folder), e.former.slice(0, FORMER_FOLDERS_MAX));
      } else {
        this.log.warn('former folders file entry dropped', { entry });
      }
    }
  }

  // The key of a folder: its realFolder spelling, found again by the fold
  // so a key read back from the file meets the same folder.
  private keyOf(folder: string): string {
    const real = realFolder(folder);
    for (const k of this.entries.keys()) if (sameFolder(k, real)) return k;
    return real;
  }

  of(folder: string): string[] {
    return [...(this.entries.get(this.keyOf(folder)) ?? [])];
  }

  list(): FormerFolders[] {
    return [...this.entries.entries()].map(([folder, former]) => ({ folder, former: [...former] })).sort((a, b) => a.folder.localeCompare(b.folder));
  }

  // on true adds the former folder, false removes it. Returns whether
  // anything changed, so a caller can say so and skip the write.
  set(folder: string, former: string, on: boolean): boolean {
    if (typeof folder !== 'string' || folder.length === 0) throw new RequestError('bad-request', 'folder must be a path');
    if (typeof former !== 'string' || former.length === 0) throw new RequestError('bad-request', 'former must be a path');
    const key = this.keyOf(folder);
    if (overlapsFolder(former, key) || overlapsFolder(former, folder)) throw new RequestError('bad-request', 'a former folder cannot be the folder, inside it or around it');
    const now = this.entries.get(key) ?? [];
    const at = now.findIndex((f) => sameFolder(f, former));
    if (on) {
      if (at !== -1) return false;
      if (now.length >= FORMER_FOLDERS_MAX) throw new RequestError('bad-request', `${key} has ${FORMER_FOLDERS_MAX} former folders already; remove one first`);
      this.entries.set(key, [...now, former]);
    } else {
      if (at === -1) return false;
      const left = now.filter((_, i) => i !== at);
      if (left.length === 0) this.entries.delete(key);
      else this.entries.set(key, left);
    }
    this.persist();
    return true;
  }

  private persist(): void {
    // A store with no file (a server under test) lives in memory.
    if (this.filePath === '') return;
    try {
      writeFileAtomic(this.filePath, JSON.stringify(this.list(), null, 2) + '\n', this.log);
    } catch (err) {
      this.log.error('could not persist former folders', err);
    }
  }
}

function sameFolder(a: string, b: string): boolean {
  return underFolder(a, b) && underFolder(b, a);
}
