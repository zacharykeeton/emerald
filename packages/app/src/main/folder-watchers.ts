import fs from 'node:fs';
import path from 'node:path';
import { watchFolder } from './watch-folder.ts';

// The rail's folder watchers, moved out of files.ts (M9 fix 722) so a
// test can import them without that module's electron import.

// More watchers than this and the last of the rail's order are dropped:
// the oldest open folder first, never the root; the refresh button covers
// what is no longer watched.
export const WATCH_CAP = 64;
const WATCH_DEBOUNCE_MS = 200;
// How often a wanted folder that could not be watched (not there yet, its
// parent not there either, or refused) is tried again, while any is
// waiting (M9 fix 722). A chat view's transcript folder is made by Claude
// Code at its first write, after the path is known.
export const WATCH_RETRY_MS = 2000;

// One watcher per folder the rail has open. The renderer sends the whole
// set each time it changes and this reconciles, so nothing leaks when a
// folder collapses or the root moves. A change is reported once per
// folder after a short quiet period, since a save often fires several.
// Folders are keyed by the string the renderer sent, not a normalized
// form, so the change push names the folder the way the rail knows it.
export class FolderWatchers {
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly pending = new Map<string, NodeJS.Timeout>();
  // Whether any event of the debounce running for a folder named a file
  // that came or went (M9 fix 551), ORed until the timer fires.
  private readonly renamed = new Map<string, boolean>();
  // `renamed` is false when only contents changed, so the rail's listing,
  // which holds names and kinds alone, need not be read again.
  private readonly onChanged: (dir: string, renamed: boolean) => void;
  private readonly retryMs: number;
  // The last set's folders, and those of them with no watcher, which the
  // retry clock tries again until they take or a set drops them.
  private wanted = new Set<string>();
  private readonly unwatched = new Set<string>();
  private retry: NodeJS.Timeout | null = null;

  constructor(onChanged: (dir: string, renamed: boolean) => void, retryMs = WATCH_RETRY_MS) {
    this.onChanged = onChanged;
    this.retryMs = retryMs;
  }

  set(dirs: string[]): void {
    const wanted = new Set(dirs.filter((d) => path.isAbsolute(d)).slice(0, WATCH_CAP));
    this.wanted = wanted;
    for (const [dir, w] of this.watchers) {
      if (!wanted.has(dir)) {
        w.close();
        this.watchers.delete(dir);
      }
    }
    for (const dir of this.unwatched) {
      if (!wanted.has(dir)) this.unwatched.delete(dir);
    }
    for (const dir of wanted) {
      if (this.watchers.has(dir)) continue;
      // Unwatchable (not there yet, gone, or refused) waits in unwatched
      // for the retry clock; the rail still lists it and the refresh
      // button still works.
      if (this.tryWatch(dir)) continue;
      this.unwatched.add(dir);
    }
    this.syncClock();
  }

  // Watches dir if it can be watched now. A folder that was waiting and
  // takes is pushed at once, so a chat view or an open rail folder reads
  // what was written before the watch began; one that takes at its first
  // try gets no push, since its reader has just read it.
  private tryWatch(dir: string): boolean {
    // A nameless event counts as renamed: libuv on Windows reports an
    // overflowed change buffer as one with no name.
    const w = watchFolder(dir, (name, event) => this.schedule(dir, event === 'rename' || name === null), () => this.gone(dir));
    if (w === null) return false;
    this.watchers.set(dir, w);
    if (this.unwatched.delete(dir)) this.onChanged(dir, true);
    return true;
  }

  // Started when a folder is waiting and stopped when none is. No log
  // line for a failed try: one every tick per folder would fill the log.
  private syncClock(): void {
    if (this.unwatched.size > 0 && this.retry === null) {
      this.retry = setInterval(() => {
        for (const dir of [...this.unwatched]) this.tryWatch(dir);
        this.syncClock();
      }, this.retryMs);
      this.retry.unref();
    } else if (this.unwatched.size === 0 && this.retry !== null) {
      clearInterval(this.retry);
      this.retry = null;
    }
  }

  // The folder was deleted (M9 fix 481): the watcher is closed already,
  // so drop it and tell the rail now rather than after a quiet period,
  // and the listing that follows says "Folder not found". While a set
  // still names it, the retry clock watches it again once it exists
  // (M9 fix 722).
  private gone(dir: string): void {
    this.watchers.delete(dir);
    const prior = this.pending.get(dir);
    if (prior !== undefined) clearTimeout(prior);
    this.pending.delete(dir);
    this.renamed.delete(dir);
    this.onChanged(dir, true);
    if (this.wanted.has(dir)) {
      this.unwatched.add(dir);
      this.syncClock();
    }
  }

  private schedule(dir: string, renamed: boolean): void {
    const prior = this.pending.get(dir);
    if (prior !== undefined) clearTimeout(prior);
    this.renamed.set(dir, (this.renamed.get(dir) ?? false) || renamed);
    this.pending.set(
      dir,
      setTimeout(() => {
        this.pending.delete(dir);
        const flag = this.renamed.get(dir) ?? true;
        this.renamed.delete(dir);
        this.onChanged(dir, flag);
      }, WATCH_DEBOUNCE_MS),
    );
  }

  close(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    for (const t of this.pending.values()) clearTimeout(t);
    this.pending.clear();
    this.renamed.clear();
    if (this.retry !== null) clearInterval(this.retry);
    this.retry = null;
    this.wanted = new Set();
    this.unwatched.clear();
  }
}
