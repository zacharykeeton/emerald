import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { NativeImage, WebContents } from 'electron';

// The OS file drag a row of the Files tab becomes once the pointer has
// left every Emerald window (M9 fix 1122). The renderer's drag is
// hand-rolled on mouse events, so nothing started a drag of the
// browser's own; main starts the OS one here from the move that crossed
// the edge, and from then on the OS loop owns the pointer and the drop.
//
// It holds the way revealPath does (files.ts): with EMERALD_OPEN_LOG set
// each path is a `drag-out` line in that file, and under a private
// EMERALD_HOME a main log line, so a harness never starts one. The OS loop
// reads the real mouse button, so a harness release past the edge would
// otherwise be a real drop wherever the person's own pointer is.
//
// Answers the paths it took (absolute and still on disk), held or real;
// none when every one is gone, which leaves the drag to fix 928.
export function fileDragOut(contents: WebContents, files: readonly string[], log: (msg: string) => void): string[] {
  const kept = files.filter((f) => {
    if (!path.isAbsolute(f)) return false;
    try {
      fs.statSync(f);
      return true;
    } catch {
      return false;
    }
  });
  if (kept.length === 0) return [];
  const logFile = process.env['EMERALD_OPEN_LOG'];
  if (logFile !== undefined) {
    for (const f of kept) fs.appendFileSync(logFile, `drag-out ${f}\n`);
    return kept;
  }
  if (process.env['EMERALD_HOME'] !== undefined) {
    for (const f of kept) log(`drag-out held under a private EMERALD_HOME: ${f}`);
    return kept;
  }
  void start(contents, kept, log);
  return kept;
}

async function start(contents: WebContents, kept: string[], log: (msg: string) => void): Promise<void> {
  // An empty icon throws on a Mac, so the gem stands in for one.
  let icon: NativeImage | null = null;
  try {
    icon = await app.getFileIcon(kept[0]!, { size: 'normal' });
  } catch {
    icon = null;
  }
  try {
    if (icon === null || icon.isEmpty()) icon = await app.getFileIcon(process.execPath);
    if (contents.isDestroyed()) return;
    contents.startDrag({ file: kept[0]!, files: kept, icon });
  } catch (err) {
    log(`window drag: the OS drag failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
