import fs from 'node:fs';
import path from 'node:path';
import type { FileSearch, SearchHit } from '../preload/api.ts';
import { matchLines } from '../renderer/src/search-model.ts';
import { requireAbsolute } from './file-write.ts';
import { readCapped } from './read-cap.ts';

// The rail's two searches, by name and by contents, moved out of files.ts
// (M9 fix 519) so a test can import them without electron's `shell`, the
// shape list-folder.ts took for fix 436. Each takes an AbortSignal, and
// SearchRuns holds one per window so a newer search or the rail's stop
// ends the walk the rail no longer wants.

// A search stops after this many entries walked or this many hits,
// whichever comes first, and says so.
export const SEARCH_WALK_CAP = 20_000;
export const SEARCH_HIT_CAP = 200;
// Folders that are never worth walking for a name or a line.
const SEARCH_SKIP = new Set(['.git', 'node_modules']);
// A contents search skips a file over this rather than read it: a line in
// something that size is not what the rail is for, and reading it would
// hold the main process for as long as the disk takes.
export const CONTENTS_FILE_CAP = 2 * 1024 * 1024;
// A NUL byte this early means the file is not text. files.ts's readFile
// takes the same probe from here.
export const BINARY_PROBE = 8192;

// Case-insensitive substring over names under root, skipping .git and
// node_modules at any depth. readdir's recursive walk cannot skip a
// folder, so this walks by hand, breadth first, so the shallow hits come
// first and the caps cut the deep ones. An aborted search answers what it
// has, marked truncated, rather than throwing.
export async function searchNames(root: string, needle: string, signal?: AbortSignal): Promise<FileSearch> {
  const lower = needle.toLowerCase();
  const hits: SearchHit[] = [];
  let truncated = false;
  for await (const entry of walkEntries(requireAbsolute(root), signal)) {
    if (entry === WALK_CAP_HIT) {
      truncated = true;
      break;
    }
    if (lower === '' || entry.name.toLowerCase().includes(lower)) {
      hits.push({ name: entry.rel, kind: entry.isDir ? 'dir' : 'file' });
      if (hits.length >= SEARCH_HIT_CAP) {
        truncated = true;
        break;
      }
    }
  }
  return { hits, truncated: truncated || signal?.aborted === true };
}

// Case-insensitive substring over the lines of every file under root,
// the same walk as the names search. A file over CONTENTS_FILE_CAP or
// with a NUL byte early on (the tab's test for binary) is skipped. The
// files are read one at a time, so the main process is free between
// them, and the signal is read before each one: a search the rail no
// longer wants (a newer keystroke, a cleared box, the rail gone) is
// stopped there rather than run to its cap (M9 fix 519).
export async function searchContents(root: string, needle: string, signal?: AbortSignal): Promise<FileSearch> {
  const base = requireAbsolute(root);
  const hits: SearchHit[] = [];
  let truncated = false;
  if (needle === '') return { hits, truncated };
  for await (const entry of walkEntries(base, signal)) {
    if (entry === WALK_CAP_HIT) {
      truncated = true;
      break;
    }
    if (entry.isDir) continue;
    if (signal?.aborted) break;
    const text = await readText(path.join(base, entry.rel));
    if (text === null) continue;
    for (const hit of matchLines(text, needle, SEARCH_HIT_CAP - hits.length)) {
      hits.push({ name: entry.rel, kind: 'file', line: hit.line, text: hit.text, at: hit.at, len: hit.len, col: hit.col });
    }
    if (hits.length >= SEARCH_HIT_CAP) {
      truncated = true;
      break;
    }
  }
  return { hits, truncated: truncated || signal?.aborted === true };
}

// The text of a file worth searching, else null: too big, binary, or
// unreadable (gone between the listing and the read, or refused).
async function readText(file: string): Promise<string | null> {
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile() || st.size > CONTENTS_FILE_CAP) return null;
    // Bounded at the read too (M9 fix 483), for a file grown since the stat.
    const buf = await readCapped(file, st.size, CONTENTS_FILE_CAP);
    if (buf === null || buf.subarray(0, BINARY_PROBE).includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

interface WalkEntry {
  rel: string;
  name: string;
  isDir: boolean;
}

// Yielded once in place of an entry when SEARCH_WALK_CAP entries have
// been seen, so a caller can say the search stopped early.
const WALK_CAP_HIT = Symbol('walk cap');

// Breadth first over the folders under base, skipping SEARCH_SKIP at any
// depth; rel is the path relative to base with forward slashes, which is
// what a hit shows. A folder that cannot be read has nothing to offer. An
// aborted signal ends the walk at the next folder.
async function* walkEntries(base: string, signal?: AbortSignal): AsyncGenerator<WalkEntry | typeof WALK_CAP_HIT> {
  const queue: string[] = [''];
  let walked = 0;
  while (queue.length > 0) {
    if (signal?.aborted) return;
    const rel = queue.shift()!;
    let dirents: fs.Dirent[];
    try {
      dirents = await fs.promises.readdir(path.join(base, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      if (++walked > SEARCH_WALK_CAP) {
        yield WALK_CAP_HIT;
        return;
      }
      const isDir = d.isDirectory();
      const relPath = rel === '' ? d.name : `${rel}/${d.name}`;
      yield { rel: relPath, name: d.name, isDir };
      if (isDir && !SEARCH_SKIP.has(d.name)) queue.push(relPath);
    }
  }
}

// The running search of each window, keyed by its webContents id: a new
// search aborts the one before it, and the rail's stop aborts whatever is
// running. `end` forgets a finished search only when it is still the
// newest, so a late finish never drops the controller of the search after.
export class SearchRuns {
  private readonly running = new Map<number, AbortController>();

  begin(owner: number): AbortSignal {
    this.running.get(owner)?.abort();
    const controller = new AbortController();
    this.running.set(owner, controller);
    return controller.signal;
  }

  stop(owner: number): void {
    this.running.get(owner)?.abort();
    this.running.delete(owner);
  }

  end(owner: number, signal: AbortSignal): void {
    if (this.running.get(owner)?.signal === signal) this.running.delete(owner);
  }
}
