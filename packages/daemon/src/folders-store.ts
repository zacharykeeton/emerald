import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { isFolderLabel, isFolderLabelEntry } from '@emerald/shared';
import type { FolderLabel } from '@emerald/shared';
import { RequestError } from './errors.ts';
import type { Logger } from './log.ts';
import { setAsideBadFile, writeFileAtomic } from './store-file.ts';
import { realFolder } from './real-folder.ts';

// The folder labels (M9 fix 194), ~/.emerald/folders.json as a bare array
// of { folder, label }, the daemon's so every window and emmer ls title
// a group the same and the label outlives the daemon. Keyed by the
// folder's one spelling (realFolder, what groupCwd has), so a label set
// on a short-form path lands on the heading. Read once at start; an
// entry that is not a label is dropped with a note rather than taking
// the file down. Emits 'changed' with the whole list after a set that
// changed anything, for the folders.changed push.
export class FoldersStore extends EventEmitter {
  private readonly filePath: string;
  private readonly log: Logger;
  private labels = new Map<string, string>();

  constructor(filePath: string, log: Logger) {
    super();
    this.filePath = filePath;
    this.log = log;
  }

  load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn('could not read folders file', err);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.log.warn(`folders file ${this.filePath} is not JSON, starting with none`, err);
      setAsideBadFile(this.filePath, this.log);
      return;
    }
    if (!Array.isArray(parsed)) {
      this.log.warn(`folders file ${this.filePath} is not a list, starting with none`);
      setAsideBadFile(this.filePath, this.log);
      return;
    }
    for (const entry of parsed) {
      if (isFolderLabelEntry(entry)) this.labels.set(realFolder(entry.folder), entry.label);
      else this.log.warn('folders file entry dropped', { entry });
    }
  }

  list(): FolderLabel[] {
    return [...this.labels.entries()].map(([folder, label]) => ({ folder, label })).sort((a, b) => a.folder.localeCompare(b.folder));
  }

  get(folder: string): string | null {
    return this.labels.get(realFolder(folder)) ?? null;
  }

  // label null removes; a folder already labelled is relabelled. Returns
  // whether anything changed, so a caller can skip the write.
  set(folder: string, label: string | null): boolean {
    if (typeof folder !== 'string' || folder.length === 0) throw new RequestError('bad-request', 'folder must be a path');
    const key = realFolder(folder);
    if (label === null) {
      if (!this.labels.delete(key)) return false;
    } else {
      if (!isFolderLabel(label)) throw new RequestError('bad-request', 'label must be one short line, trimmed');
      if (this.labels.get(key) === label) return false;
      this.labels.set(key, label);
    }
    this.persist();
    this.emit('changed', this.list());
    return true;
  }

  private persist(): void {
    // Write to a sibling, flush and rename so a crash mid-write cannot
    // leave a half-written file behind, as the other stores do.
    try {
      writeFileAtomic(this.filePath, JSON.stringify(this.list(), null, 2) + '\n', this.log);
    } catch (err) {
      this.log.error('could not persist folders', err);
    }
  }
}
