import fs from 'node:fs';
import path from 'node:path';

// M9 fix 721: an image pasted into the chat box goes to Claude Code as a
// file: the clipboard's PNG written here and its path typed. Each paste
// is its own file; the ones older than a day go on the next paste. No
// electron import, so node:test covers it.

const KEEP_MS = 24 * 60 * 60 * 1000;

export function savePastedPng(dir: string, png: Buffer, now: number): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `paste-${now}.png`);
  fs.writeFileSync(file, png);
  for (const name of fs.readdirSync(dir)) {
    if (!/^paste-.*\.png$/.test(name)) continue;
    const p = path.join(dir, name);
    try {
      if (fs.statSync(p).mtimeMs < now - KEEP_MS) fs.rmSync(p, { force: true });
    } catch {
      // Gone already, or held by a reader: the next paste tries again.
    }
  }
  return file;
}
