import fs from 'node:fs';

// One spelling per folder (M9 fixes 107 and 108): Windows hands the same
// folder out as `C:\\Users\\RUNNER~1\\...` (what os.tmpdir() says) and as
// `C:\\Users\\runneradmin\\...`, and a string compare on the two puts one
// session under two headings and a subagent's worktree on no branch. The
// native realpath gives the long form with the case the file system
// keeps; a folder that does not exist (or a Git Bash spelling the
// mapping missed) is returned as given. Cached, since every tool hook
// asks; the cache is small and simply starts over when full.
const cache = new Map<string, string>();
const CACHE_MAX = 512;

export function realFolder(folder: string): string {
  const known = cache.get(folder);
  if (known !== undefined) return known;
  let real: string;
  try {
    real = fs.realpathSync.native(folder);
  } catch {
    real = folder;
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(folder, real);
  return real;
}

// Whether two spellings name one folder (M9 fix 116): the real spelling
// of each, then a case-blind compare with one separator, since a folder
// that does not exist (a test's made-up path, a hook's cwd from a
// machine the daemon cannot see) comes back from realFolder as given.
export function sameFolder(a: string, b: string): boolean {
  return fold(realFolder(a)) === fold(realFolder(b));
}

function fold(p: string): string {
  const out = p.replace(/[\\/]+/g, '/').toLowerCase();
  return out.length > 3 && out.endsWith('/') ? out.slice(0, -1) : out;
}
