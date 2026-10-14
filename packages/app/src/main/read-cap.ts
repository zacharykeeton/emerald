import fs from 'node:fs';

// A file over this is refused rather than read into the window; Monaco
// would show it, slowly, and a file that size is not what a tab is for.
// The transcript readers (history.ts) take the same cap, and it lives
// apart from files.ts so a test of them needs no electron.
export const READ_CAP = 8 * 1024 * 1024;

// The file's bytes up to the cap, or null when it holds more (M9 fix
// 483). A size checked at the stat alone lets a file that grows before
// the read (a log being written) be read whole, however big it has got,
// so the read itself is bounded: one byte past the cap is asked for, and
// getting it means the file is over. The buffer starts at the size the
// stat gave (sizeHint) and grows only for a file that has grown since.
export async function readCapped(file: string, sizeHint: number, cap = READ_CAP): Promise<Buffer | null> {
  const fd = await fs.promises.open(file, 'r');
  try {
    let buf = Buffer.alloc(Math.min(Math.max(sizeHint, 0), cap) + 1);
    let got = 0;
    for (;;) {
      const { bytesRead } = await fd.read(buf, got, buf.length - got, got);
      if (bytesRead === 0) break;
      got += bytesRead;
      if (got > cap) return null;
      if (got === buf.length) {
        const bigger = Buffer.alloc(Math.min(buf.length * 2, cap + 1));
        buf.copy(bigger, 0, 0, got);
        buf = bigger;
      }
    }
    return buf.subarray(0, got);
  } finally {
    await fd.close();
  }
}
