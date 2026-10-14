import fs from 'node:fs';
import path from 'node:path';
import { gitText } from './git-runner.ts';
import { realFolder } from './real-folder.ts';

// The branch a folder is on, read straight from .git/HEAD so no git process
// ever runs for a sidebar row. null outside a repository. A detached HEAD
// reads as the short commit id. Errors of any kind read as null too: the
// branch is decoration, never something to fail a session over.
export function readBranch(dir: string): string | null {
  const gitDir = findGitDir(dir);
  if (gitDir === null) return null;
  if (fs.existsSync(path.join(gitDir, 'reftable'))) return reftableBranch(gitDir, dir);
  let head: string;
  try {
    head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  if (ref !== null) return ref[1]!;
  if (/^[0-9a-f]{40}$/i.test(head)) return head.slice(0, 7);
  return null;
}

// A reftable repository (M9 fix 558, git 2.45 on) keeps the placeholder
// `ref: refs/heads/.invalid` in HEAD whatever is checked out, so HEAD says
// nothing and git is asked instead: `symbolic-ref --short -q HEAD` for the
// branch (an unborn one included; exit 1 when detached), else `rev-parse
// HEAD` cut to seven. The sidebar reads the branch inline in six places,
// and a spawnSync on the daemon's loop is what fix 226 took away, so the
// read answers the last branch it has (null on the first) and starts one
// read on the git worker, one in flight per gitdir; the answer is kept
// against the mtime of reftable/tables.list taken before the spawn, which
// git rewrites on every ref update, a checkout included. When an answer
// differs from the one kept, every onReftableBranch listener is told the
// gitdir, so the session manager publishes the new branch.
const reftable = new Map<string, { stamp: number | null; branch: string | null; reading: boolean }>();
const reftableListeners = new Set<(gitDir: string) => void>();

export function onReftableBranch(fn: (gitDir: string) => void): () => void {
  reftableListeners.add(fn);
  return () => {
    reftableListeners.delete(fn);
  };
}

function tablesStamp(gitDir: string): number | null {
  try {
    return fs.statSync(path.join(gitDir, 'reftable', 'tables.list')).mtimeMs;
  } catch {
    return null;
  }
}

function reftableBranch(gitDir: string, dir: string): string | null {
  const stamp = tablesStamp(gitDir);
  if (stamp === null) return null;
  let entry = reftable.get(gitDir);
  if (entry === undefined) {
    entry = { stamp: null, branch: null, reading: false };
    reftable.set(gitDir, entry);
  }
  if (entry.stamp === stamp) return entry.branch;
  if (!entry.reading) {
    entry.reading = true;
    const held = entry;
    // Run in the folder asked about, never the gitdir: a worktree's gitdir
    // as the cwd finds the main checkout's HEAD.
    void askBranch(workRoot(dir)).then((branch) => {
      held.reading = false;
      if (branch === null) return;
      const changed = branch !== held.branch;
      held.branch = branch;
      held.stamp = stamp;
      if (changed) for (const fn of reftableListeners) fn(gitDir);
    });
  }
  return entry.branch;
}

async function askBranch(cwd: string): Promise<string | null> {
  const name = await gitText(['--no-optional-locks', 'symbolic-ref', '--short', '-q', 'HEAD'], cwd, 5000, [1]);
  if (name === null) return null;
  if (name.trim() !== '') return name.trim();
  const hash = await gitText(['--no-optional-locks', 'rev-parse', 'HEAD'], cwd, 5000);
  const h = hash?.trim() ?? '';
  return /^[0-9a-f]{40}$/i.test(h) ? h.slice(0, 7).toLowerCase() : null;
}

// The nearest folder at or above dir holding a .git entry, the root a git
// run takes as its cwd; dir itself when none does.
function workRoot(dir: string): string {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(dir);
    current = parent;
  }
}

// Walks up from dir to the first .git entry. A directory is the repository
// itself; a file is a worktree's pointer ("gitdir: <path>") and the HEAD
// lives where it points, since each worktree has its own. Exported for
// the colour pick (M9 fix 133), which keys the sessions of one
// repository off it.
export function findGitDir(dir: string): string | null {
  let current = path.resolve(dir);
  for (;;) {
    const candidate = path.join(current, '.git');
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(candidate);
    } catch {
      stat = null;
    }
    if (stat !== null) {
      if (stat.isDirectory()) return candidate;
      if (stat.isFile()) return gitDirFromFile(candidate, current);
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// The key under which the sessions of one repository meet (M9 fix 133,
// the colour pick's peers): the repository's own .git directory, which a
// linked worktree's `<repo>/.git/worktrees/<name>` resolves back to, so
// a session in a worktree and the one that cut it share a key; outside
// any repository the folder itself, so the shells of one plain folder
// are peers too. The real spelling (a worktree's .git file names the
// repository in whatever form `git worktree add` was given, the 8.3
// one under os.tmpdir()), lower case, forward slashes, since the same
// repository is reached by more than one spelling on Windows.
export function repoKey(dir: string): string {
  const gitDir = findGitDir(dir);
  const raw = gitDir === null ? path.resolve(dir) : (/^(.*[\\/]\.git)[\\/]worktrees[\\/][^\\/]+$/.exec(gitDir)?.[1] ?? gitDir);
  return realFolder(raw).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function gitDirFromFile(file: string, base: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const m = /^gitdir:\s*(.+)$/m.exec(text);
  if (m === null) return null;
  return path.resolve(base, m[1]!.trim());
}
