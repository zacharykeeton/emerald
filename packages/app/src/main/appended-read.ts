import fs from 'node:fs';

// Reading only what a file appended (M9 fixes 528 and 529). Claude Code
// writes a transcript by appending whole lines and never rewrites one, so
// a reader that remembers where it stopped can read the new lines alone
// and fold them into what it held, where a whole read of an 8 MB
// transcript costs the main process 30 to 60 ms on every status burst.
// Each reader keeps its own state beside the mark: the usage parse for
// the commit card and the agents beat, the swept remote ids for the
// history scan.

// The chunk a read goes in, the 1 MB the history scan's sweep used.
export const LINE_CHUNK_BYTES = 1024 * 1024;

// What a mark is read against: the file id, the size and the mtime. The
// id is a bigint off a { bigint: true } stat (M9 fix 633): an NTFS file id
// carries its sequence number in the top 16 bits, past 2^53, so a plain
// stat's number rounds two neighbouring ids to one double and a rewrite
// renamed over the name read as an append (the run of fixes 588 to 607
// failed the mark test's notEqual on it). The mtime comes off mtimeNs,
// since the bigint stat's mtimeMs is whole milliseconds and a same-size
// rewrite inside one would read same.
export interface FileStamp {
  ino: bigint;
  size: number;
  mtimeMs: number;
}

export function stampOf(s: fs.BigIntStats): FileStamp {
  return { ino: s.ino, size: Number(s.size), mtimeMs: Number(s.mtimeNs) / 1e6 };
}

export async function statStamp(file: string): Promise<FileStamp> {
  return stampOf(await fs.promises.stat(file, { bigint: true }));
}

// Where a reader stopped: the stamp it read against and the byte just past
// the last whole line it handed on. Never serialized: it lives in the
// readers' in-memory caches, so the bigint needs no string form.
export interface ReadMark {
  ino: bigint;
  size: number;
  mtimeMs: number;
  offset: number;
}

// `same` answers from what was held; `grown` reads on from the mark's
// offset; `fresh` starts again from 0. A shrink, a changed inode (a
// rewrite renamed over the name) or a changed mtime at the same size is
// not an append, so it is fresh.
export function markKind(mark: ReadMark | undefined, stat: FileStamp): 'same' | 'grown' | 'fresh' {
  if (mark === undefined) return 'fresh';
  if (stat.size === mark.size && stat.mtimeMs === mark.mtimeMs) return 'same';
  if (stat.ino === mark.ino && stat.size > mark.size) return 'grown';
  return 'fresh';
}

export function markOf(stat: FileStamp, offset: number): ReadMark {
  return { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, offset };
}

let bytesRead = 0;

// The bytes every readWholeLines has read, for the tests.
export function appendedBytesRead(): number {
  return bytesRead;
}

// The whole lines of [from, to), handed to onText a chunk at a time. Each
// chunk is cut at its last newline byte, which no UTF-8 sequence holds,
// so no decoder is needed and a character straddling a chunk's edge is
// carried whole into the next. An unterminated last line is not handed
// on: it is a line still being written, and the returned offset, just
// past the last newline, is where the next read starts, by which time the
// line's newline has landed and moved the stamp. onText also gets the
// byte offset of the text's first byte in the file (M9 fix 552), for a
// reader that stops at a byte cap.
export async function readWholeLines(handle: fs.promises.FileHandle, from: number, to: number, onText: (text: string, start: number) => void, chunk = LINE_CHUNK_BYTES): Promise<number> {
  const buf = Buffer.alloc(chunk);
  let carry: Buffer = Buffer.alloc(0);
  let offset = from;
  let position = from;
  while (position < to) {
    const { bytesRead: got } = await handle.read(buf, 0, Math.min(chunk, to - position), position);
    if (got === 0) break;
    bytesRead += got;
    position += got;
    const joined = carry.length === 0 ? buf.subarray(0, got) : Buffer.concat([carry, buf.subarray(0, got)]);
    const cut = joined.lastIndexOf(0x0a);
    if (cut === -1) {
      carry = Buffer.from(joined);
      continue;
    }
    onText(joined.subarray(0, cut + 1).toString('utf8'), offset);
    offset = position - (joined.length - cut - 1);
    carry = Buffer.from(joined.subarray(cut + 1));
  }
  return offset;
}
