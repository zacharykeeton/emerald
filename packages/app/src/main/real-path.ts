import fs from 'node:fs';
import path from 'node:path';

// The long, case-kept spelling of a path, for a mention made relative to
// the session's folder, which the daemon keeps long (realFolder); a file
// not made yet keeps its name under its folder's long spelling (M9 fix
// 751).
export function realPath(p: string): string {
  if (!path.isAbsolute(p)) return p;
  try {
    return fs.realpathSync.native(p);
  } catch {
    try {
      return path.join(fs.realpathSync.native(path.dirname(p)), path.basename(p));
    } catch {
      return p;
    }
  }
}
