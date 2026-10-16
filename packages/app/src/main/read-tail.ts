import fs from 'node:fs';
import type { FileTail, TailMark } from '../preload/api.ts';
import { readWholeLines } from './appended-read.ts';
import { requireAbsolute } from './file-write.ts';
import { describeFsError as describe } from './list-folder.ts';
import { READ_CAP } from './read-cap.ts';

// M9 fix 770: the chat view's read of a transcript, from where its last
// read stopped, so a long session is not reread and reparsed whole on
// every change. No electron import, so a test can load it; files.ts
// re-exports it.

// The first read of a file over the cap takes its last 2 MB.
export const TAIL_FIRST_BYTES = 2 * 1024 * 1024;

// The chunk the first line start after a cut is looked for in.
const SEEK_CHUNK = 64 * 1024;

// The text of the whole lines the file grew by since `from`, and the mark
// to read on from. A read is fresh (the view starts its folds again) with
// no mark, a changed inode (another file renamed over the name), a shrink,
// or growth past a whole read since the last one; a fresh read of a file
// over `cap` starts at the first line start at or after its last
// `tailBytes` and says it was cut. An unterminated last line is left for
// the next read. A transcript is JSON lines, so there is no binary probe.
export async function readTail(p: string, from: TailMark | null, cap = READ_CAP, tailBytes = TAIL_FIRST_BYTES): Promise<FileTail> {
  try {
    const file = requireAbsolute(p);
    const st = await fs.promises.stat(file, { bigint: true });
    if (st.isDirectory()) return { error: 'That is a folder' };
    const size = Number(st.size);
    const ino = st.ino.toString();
    if (from !== null && from.ino === ino && size === from.offset) return { text: '', next: from, fresh: false, cut: false };
    const fresh = from === null || from.ino !== ino || size < from.offset || size - from.offset > cap;
    const handle = await fs.promises.open(file, 'r');
    try {
      let start = fresh ? 0 : from.offset;
      let cut = false;
      if (fresh && size > cap) {
        start = await lineStartAfter(handle, size - tailBytes, size);
        cut = true;
      }
      const parts: string[] = [];
      const offset = await readWholeLines(handle, start, size, (text) => parts.push(text));
      return { text: parts.join(''), next: { offset, ino }, fresh, cut };
    } finally {
      await handle.close();
    }
  } catch (err) {
    return { error: describe(err, 'File') };
  }
}

// The first line start at or after `position` (the byte after a newline,
// or `size` when there is none), found on the raw bytes: the line cut at
// `position` may begin mid-character, so it is never decoded.
export async function lineStartAfter(handle: fs.promises.FileHandle, position: number, size: number): Promise<number> {
  if (position <= 0) return 0;
  const buf = Buffer.alloc(SEEK_CHUNK);
  // From the byte before, so a position that is a line start stays one.
  let at = position - 1;
  while (at < size) {
    const { bytesRead } = await handle.read(buf, 0, Math.min(SEEK_CHUNK, size - at), at);
    if (bytesRead === 0) break;
    const nl = buf.subarray(0, bytesRead).indexOf(0x0a);
    if (nl !== -1) return at + nl + 1;
    at += bytesRead;
  }
  return size;
}
