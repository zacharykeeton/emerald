import fs from 'node:fs';
import path from 'node:path';
import type { FileEntry, FileListing } from '../preload/api.ts';
import { requireAbsolute } from './file-write.ts';

// The folder listing behind the files rail, kept apart from files.ts so a
// main-process test can import it without files.ts's electron import (the
// same reason read-cap.ts and file-write.ts stand alone).

// A folder with more entries than this shows the first ones and a count
// of the rest, so a listing of a huge folder cannot stall the window.
// EMERALD_LIST_CAP overrides it for the window's life (index.ts reads it
// once), so a verify step can cut a folder of six.
export const LIST_CAP = 2000;

// An entry with its kind's rank (folders first) worked out once, so the
// sort compares a number before it reaches the collator.
interface Ranked extends FileEntry {
  rank: number;
}

// Folders first, then names without case. One collator per listing (M9
// fix 520): localeCompare with options builds a collator on every call,
// which was about a second of a 50,000-entry sort; Intl.Collator's compare
// with the same options is the same order. Not module-level, so a locale
// change still reaches the next listing.
function compareWith(collator: Intl.Collator): (a: Ranked, b: Ranked) => number {
  return (a, b) => a.rank - b.rank || collator.compare(a.name, b.name);
}

// A symbolic link is listed as what it points at, so a linked folder can
// be expanded; a dangling one is a file, which is all the tree can say.
async function kindOf(dir: string, d: fs.Dirent): Promise<FileEntry['kind']> {
  if (d.isDirectory()) return 'dir';
  if (!d.isSymbolicLink()) return 'file';
  try {
    return (await fs.promises.stat(path.join(dir, d.name))).isDirectory() ? 'dir' : 'file';
  } catch {
    return 'file';
  }
}

// `keep` is the path of one entry the listing must hold whatever the cap
// cuts (M9 fix 436): the rail's lift shows the parent with the folder it
// came from open as a row, and a parent of more than `cap` folders would
// otherwise cut the very row the lift is about. The kept entry sits where
// the sort puts it and is counted out of `truncated`. A `keep` that is not
// a child of `dir` is ignored.
export async function listFolder(dir: string, keep?: string, cap = LIST_CAP): Promise<FileListing> {
  let dirents: fs.Dirent[];
  try {
    dirents = await fs.promises.readdir(requireAbsolute(dir), { withFileTypes: true });
  } catch (err) {
    return { error: describeFsError(err) };
  }
  const entries: Ranked[] = await Promise.all(
    dirents.map(async (d) => {
      const kind = await kindOf(dir, d);
      return { name: d.name, kind, rank: kind === 'dir' ? 0 : 1 };
    }),
  );
  const compare = compareWith(new Intl.Collator(undefined, { sensitivity: 'base' }));
  entries.sort(compare);
  const shown = entries.slice(0, cap);
  const at = keep === undefined || entries.length <= cap ? -1 : keptIndex(entries, dir, keep);
  if (at >= cap) {
    shown.push(entries[at]!);
    shown.sort(compare);
  }
  return { entries: shown.map(({ name, kind }) => ({ name, kind })), truncated: entries.length - shown.length };
}

// Where `keep` sits in the sorted entries of `dir`, or -1. Windows paths
// compare without case, so a folder the rail knows as `C:\temp\Foo` finds
// the entry `foo`; an exact name wins when both are there.
function keptIndex(entries: FileEntry[], dir: string, keep: string): number {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!same(path.resolve(path.dirname(keep)), path.resolve(dir))) return -1;
  const name = path.basename(keep);
  const exact = entries.findIndex((e) => e.name === name);
  return exact >= 0 ? exact : entries.findIndex((e) => same(e.name, name));
}

export function describeFsError(err: unknown, what = 'Folder'): string {
  const e = err as NodeJS.ErrnoException;
  switch (e.code) {
    case 'ENOENT':
      return `${what} not found`;
    case 'EACCES':
    case 'EPERM':
      return 'Access denied';
    default:
      return e.message ?? String(err);
  }
}
