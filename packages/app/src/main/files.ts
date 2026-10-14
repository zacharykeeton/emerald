import { shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { FileRead, FileStat } from '../preload/api.ts';
import { detectEol, fileStamp, requireAbsolute } from './file-write.ts';
import { describeFsError as describe } from './list-folder.ts';
import { BINARY_PROBE } from './search-files.ts';
import { watchFolder } from './watch-folder.ts';
// The listing moved to list-folder.ts (M9 fix 436) so a test can import
// it, and the rail's searches to search-files.ts (M9 fix 519) likewise.
export { LIST_CAP, listFolder } from './list-folder.ts';

// The file service behind the files rail and the file tabs. The sandboxed
// renderer cannot read a directory or a file, so it asks here for one
// folder or one file at a time, names the set of folders it has open so
// they are watched, and hands files to the shell to open or reveal.
// The one write, the editor's save (M9 fix 248), is file-write.ts.

// More watchers than this and the last of the rail's order are dropped:
// the oldest open folder first, never the root; the refresh button covers
// what is no longer watched.
export const WATCH_CAP = 64;
const WATCH_DEBOUNCE_MS = 200;
// READ_CAP, the file size over which a read is refused, lives in
// read-cap.ts so history.ts can take it without this module's electron
// import (M9 fix 243 put the scan under node:test).
import { READ_CAP, readCapped } from './read-cap.ts';
export { READ_CAP };

// The whole file as text for a tab, or why it cannot be shown. A UTF-8
// BOM is dropped, since the editor would draw it as a character, and
// noted with the line ends so a save (M9 fix 248) puts both back.
export async function readFile(p: string): Promise<FileRead> {
  const file = requireAbsolute(p);
  try {
    const st = await fs.promises.stat(file);
    if (st.isDirectory()) return { error: 'That is a folder' };
    if (st.size > READ_CAP) return { error: `Too large to show (${(st.size / 1024 / 1024).toFixed(1)} MB)` };
    // Bounded at the read too (M9 fix 483): a log grown since the stat is
    // not read whole.
    const buf = await readCapped(file, st.size);
    if (buf === null) return { error: `Too large to show (over ${(READ_CAP / 1024 / 1024).toFixed(1)} MB)` };
    if (buf.subarray(0, BINARY_PROBE).includes(0)) return { binary: true, size: buf.length };
    const raw = buf.toString('utf8');
    const bom = raw.charCodeAt(0) === 0xfeff;
    const text = bom ? raw.slice(1) : raw;
    // M9 fix 525: the stamp a save compares against. A file grown between
    // the stat and the read carries a stamp older than its text, so the
    // next save answers `changed`, which is the safe side.
    return { text, eol: detectEol(text), bom, stamp: fileStamp(st) };
  } catch (err) {
    return { error: describe(err, 'File') };
  }
}

// Folder or file, for a drop from Explorer: a folder becomes a shell there,
// anything else is ignored. A symbolic link counts as what it points at.
export async function statPath(p: string): Promise<FileStat> {
  try {
    const st = await fs.promises.stat(requireAbsolute(p));
    return { kind: st.isDirectory() ? 'dir' : 'file' };
  } catch (err) {
    return { error: describe(err, 'Path') };
  }
}

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

  constructor(onChanged: (dir: string, renamed: boolean) => void) {
    this.onChanged = onChanged;
  }

  set(dirs: string[]): void {
    const wanted = new Set(dirs.filter((d) => path.isAbsolute(d)).slice(0, WATCH_CAP));
    for (const [dir, w] of this.watchers) {
      if (!wanted.has(dir)) {
        w.close();
        this.watchers.delete(dir);
      }
    }
    for (const dir of wanted) {
      if (this.watchers.has(dir)) continue;
      // Unwatchable (gone, or refused) answers null: the rail still lists
      // it and the refresh button still works, and the next set that
      // names it tries again.
      // A nameless event counts as renamed: libuv on Windows reports an
      // overflowed change buffer as one with no name.
      const w = watchFolder(dir, (name, event) => this.schedule(dir, event === 'rename' || name === null), () => this.gone(dir));
      if (w !== null) this.watchers.set(dir, w);
    }
  }

  // The folder was deleted (M9 fix 481): the watcher is closed already,
  // so drop it and tell the rail now rather than after a quiet period,
  // and the listing that follows says "Folder not found". A set that
  // names it once it exists again watches it afresh.
  private gone(dir: string): void {
    this.watchers.delete(dir);
    const prior = this.pending.get(dir);
    if (prior !== undefined) clearTimeout(prior);
    this.pending.delete(dir);
    this.renamed.delete(dir);
    this.onChanged(dir, true);
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
  }
}

export async function openPath(p: string): Promise<void> {
  const problem = await shell.openPath(requireAbsolute(p));
  if (problem !== '') throw new Error(problem);
}

// Reveal in Explorer (M9 fix 588) holds the way openExternal below does:
// with EMERALD_OPEN_LOG set the path is a line in that file, and a window
// on a private EMERALD_HOME writes it to the main log, so a harness click
// never opens Explorer beside the person.
export function revealPath(p: string, log?: (msg: string) => void): void {
  const abs = requireAbsolute(p);
  const logFile = process.env['EMERALD_OPEN_LOG'];
  if (logFile !== undefined) {
    fs.appendFileSync(logFile, `reveal ${abs}\n`);
    return;
  }
  if (process.env['EMERALD_HOME'] !== undefined) {
    log?.(`reveal held under a private EMERALD_HOME: ${abs}`);
    return;
  }
  shell.showItemInFolder(abs);
}

// M9 fix 653: a folder Ctrl+clicked in a pane opens in Explorer, inside
// the folder; the harness hold is revealPath's, so a verify run's click
// lands in the open log or the main log and never opens a window.
export async function openFolder(p: string, log?: (msg: string) => void): Promise<void> {
  const abs = requireAbsolute(p);
  const logFile = process.env['EMERALD_OPEN_LOG'];
  if (logFile !== undefined) {
    fs.appendFileSync(logFile, `open-folder ${abs}\n`);
    return;
  }
  if (process.env['EMERALD_HOME'] !== undefined) {
    log?.(`open-folder held under a private EMERALD_HOME: ${abs}`);
    return;
  }
  const problem = await shell.openPath(abs);
  if (problem !== '') throw new Error(problem);
}

// A link out of a rendered markdown file, or a URL Ctrl+clicked in a
// terminal (M9 fix 204). Only http and https go to the browser; anything
// else (file, mailto, a custom scheme) could run a program, so it is
// refused rather than handed to the shell. EMERALD_OPEN_LOG names a file
// that gets one line per URL instead, for the verify script, whose bridge
// is sealed against a stub; and with none set a window on a private
// EMERALD_HOME (a harness, never the person's own) writes the URL to the
// main log and opens nothing, so a test run never puts a browser tab up
// beside the person, the way its notifications are held (fix 49).
export async function openExternal(url: string, log?: (msg: string) => void): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`Refused to open ${parsed.protocol} link`);
  const logFile = process.env['EMERALD_OPEN_LOG'];
  if (logFile !== undefined) {
    fs.appendFileSync(logFile, `${parsed.href}\n`);
    return;
  }
  if (process.env['EMERALD_HOME'] !== undefined) {
    log?.(`link held under a private EMERALD_HOME: ${parsed.href}`);
    return;
  }
  await shell.openExternal(parsed.href);
}
