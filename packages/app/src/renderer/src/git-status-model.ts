import { normalizePath, parentPath } from './files-model.ts';

// The git status of a path, as the files rail tints it. Four words, not
// git's two-letter codes, since the rail only has four colours to give.
export type GitStatus = 'untracked' | 'modified' | 'staged' | 'ignored';

// What the main process hands back: the repo root it ran git in (null
// when the folder is not in a repo, or git is missing or slow) and a
// status per absolute path, folders included, rolled up from the files.
export interface GitStatusResult {
  root: string | null;
  // The branch checked out at root, or the detached head's short hash;
  // null outside a repository (M9 fix 335, the rail header's pill).
  head: string | null;
  statuses: Record<string, GitStatus>;
  // Every changed file git listed (never a folder), with its two-letter
  // porcelain code, for the letter column (M45) and the Changes list.
  files: GitFile[];
}

export interface GitFile {
  path: string;
  // The XY of `git status --porcelain=v1`: X the index, Y the work tree.
  code: string;
  status: GitStatus;
}

// A folder shows the strongest status under it: a change beats a new
// file, which beats a staged one. Ignored never rolls up: an ignored
// child says nothing about its parent, and a source tree whose only
// listed entries are its dist and node_modules is not something to skip.
const RANK: Record<GitStatus, number> = { modified: 4, untracked: 3, staged: 2, ignored: 1 };

function stronger(a: GitStatus | undefined, b: GitStatus): GitStatus {
  return a === undefined || RANK[b] > RANK[a] ? b : a;
}

// One entry of `git status --porcelain=v1 -z`: two status letters, a
// space and the path; a rename carries the old path as one more field.
// The index letter (X) and the work tree letter (Y) say where the change
// is; an unstaged change wins over a staged one because that is the one
// still to be dealt with.
function classify(x: string, y: string): GitStatus {
  if (x === '?' && y === '?') return 'untracked';
  if (x === '!' && y === '!') return 'ignored';
  if (y !== ' ') return 'modified';
  return 'staged';
}

// The map of absolute paths to statuses from the porcelain output, with
// every parent folder of a listed path up to (not including) the repo
// root given the strongest status beneath it. Keys are normalized
// Windows paths, so the rail can look its rows up as it names them.
export function parsePorcelain(output: string, repoRoot: string): Record<string, GitStatus> {
  return parseStatus(output, repoRoot).statuses;
}

// The statuses plus the files themselves in git's order, each with its
// code, so the Changes list and the letter column need no second parse.
export function parseStatus(output: string, repoRoot: string): { statuses: Record<string, GitStatus>; files: GitFile[] } {
  const root = normalizePath(repoRoot);
  const fields = output.split('\0');
  const files: GitFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (field.length < 4) continue;
    const x = field[0]!;
    const y = field[1]!;
    // The renamed-from path follows as its own field; it no longer
    // exists, so it gets no colour and is skipped.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') i++;
    const rel = field.slice(3).replace(/\/$/, '');
    if (rel === '') continue;
    files.push({ path: normalizePath(`${root}\\${rel}`), code: x + y, status: classify(x, y) });
  }
  const all: Record<string, GitStatus> = {};
  for (const { path: p, status } of files) {
    all[p] = stronger(all[p], status);
    if (status === 'ignored') continue;
    let dir = parentPath(p);
    while (dir.length > root.length && dir.startsWith(root)) {
      all[dir] = stronger(all[dir], status);
      dir = parentPath(dir);
    }
  }
  return { statuses: all, files };
}

// The letter a changed file shows in the tree's status column (M45): the
// work tree letter when there is one (the change still to be dealt with,
// as classify says), else the index letter. Untracked and ignored files
// show none; their colour and tooltip already say what they are, and a
// tree of fresh files with a letter on every row would be noise.
export function letterFor(code: string): string | null {
  const x = code[0] ?? ' ';
  const y = code[1] ?? ' ';
  if (x === '?' || x === '!') return null;
  if (y !== ' ') return y;
  return x === ' ' ? null : x;
}

// The codes keyed for lookup the way indexStatuses keys the statuses,
// files only: a folder has no code of its own and shows no letter.
export type CodeIndex = Map<string, string>;

export function indexCodes(files: readonly GitFile[]): CodeIndex {
  const index: CodeIndex = new Map();
  for (const f of files) index.set(normalizePath(f.path).toLowerCase(), f.code);
  return index;
}

export function letterAt(index: CodeIndex, p: string): string | null {
  const code = index.get(normalizePath(p).toLowerCase());
  return code === undefined ? null : letterFor(code);
}

// The statuses keyed for lookup: lowercased, since Windows paths compare
// without case and the rail names a path the way the shell did.
export type StatusIndex = Map<string, GitStatus>;

export function indexStatuses(statuses: Record<string, GitStatus>): StatusIndex {
  const index: StatusIndex = new Map();
  for (const key in statuses) index.set(normalizePath(key).toLowerCase(), statuses[key]!);
  return index;
}

// The status a row shows. A listed path has its own; anything under an
// untracked or ignored folder shares the folder's, but only when git
// itself listed that folder (its own line in `files`, so `codes` has
// it): a folder whose status is a rollup from a listed child (M9 fix
// 334) tints itself alone, since git still lists and reads that child's
// siblings one by one. Anything else is clean.
export function statusAt(index: StatusIndex, p: string, codes: CodeIndex): GitStatus | undefined {
  const norm = normalizePath(p);
  const own = index.get(norm.toLowerCase());
  if (own !== undefined) return own;
  let dir = parentPath(norm);
  for (;;) {
    const s = index.get(dir.toLowerCase());
    if ((s === 'untracked' || s === 'ignored') && codes.has(dir.toLowerCase())) return s;
    const up = parentPath(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}
