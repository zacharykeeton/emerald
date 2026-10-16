import { shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { FileRead, FileStat } from '../preload/api.ts';
import { detectEol, fileStamp, requireAbsolute } from './file-write.ts';
import { describeFsError as describe } from './list-folder.ts';
import { BINARY_PROBE } from './search-files.ts';
// The listing moved to list-folder.ts (M9 fix 436) so a test can import
// it, and the rail's searches to search-files.ts (M9 fix 519) likewise.
export { LIST_CAP, listFolder } from './list-folder.ts';
// The watchers moved to folder-watchers.ts (M9 fix 722) so a test can import them.
export { FolderWatchers, WATCH_CAP } from './folder-watchers.ts';
// The chat view's tail read (M9 fix 770), apart for the same reason.
export { readTail } from './read-tail.ts';

// The file service behind the files rail and the file tabs. The sandboxed
// renderer cannot read a directory or a file, so it asks here for one
// folder or one file at a time, names the set of folders it has open so
// they are watched, and hands files to the shell to open or reveal.
// The one write, the editor's save (M9 fix 248), is file-write.ts.

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
