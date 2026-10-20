import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GitChanges, GitGraph, GitGraphOptions, GitInit, GitLog, GitProjectCounts, GitReview, GitShow, ReviewFile } from '../preload/api.ts';
import { forgetInFlight, gitBytes, gitPipe, gitText, type GitOptions } from './git-runner.ts';
import { defaultBranchOf, parseGraph, parseLog, parseMerged, parseNameStatus, parseNumstat, parsePatchIds, parseWorktrees, twinGroups } from '../renderer/src/git-changes-model.ts';
import type { GitStatusResult } from '../renderer/src/git-status-model.ts';
import { parseStatus } from '../renderer/src/git-status-model.ts';
import { normalizePath } from '../renderer/src/files-model.ts';
import { watchFolder } from './watch-folder.ts';

// The git status behind the files rail's colours. The daemon reads the
// branch straight from .git/HEAD; the status needs git itself, so this
// runs one `git status` in the repo the rail's root is in and hands back a
// map per path. Everything that can go wrong (no git, not a repo, a slow
// status) is an empty answer: the colours are decoration, and a tree with
// none is still a tree. Every run goes through the git worker thread
// (git-runner.ts, M9 fix 226), so a slow CreateProcess never holds the
// main thread a keystroke crosses.

// Every git run here is a background read on a poll, so none may take
// the index lock: a status that refreshes the index writes it, and a
// commit typed in a pane at that moment fails on index.lock (M45 found
// it with its own commit against the poll).
const NO_LOCKS = '--no-optional-locks';
const LITERAL = '--literal-pathspecs';

// The nearest folder at or above dir holding a .git, a file for a
// worktree or a directory for a checkout; null outside any repo.
export function findRepoRoot(dir: string): string | null {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, '.git'))) return current;
    const up = path.dirname(current);
    if (up === current) return null;
    current = up;
  }
}

export function gitStatus(dir: string): Promise<GitStatusResult> {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return Promise.resolve({ root: null, head: null, statuses: {}, files: [] });
  const root = findRepoRoot(dir);
  if (root === null) return Promise.resolve({ root: null, head: null, statuses: {}, files: [] });
  // --ignored=matching lists an ignored folder once rather than every
  // file under it, so node_modules is one entry; the untracked default
  // does the same for a new folder.
  return headOf(root).then((head) =>
    gitText([NO_LOCKS, 'status', '--porcelain=v1', '--ignored=matching', '-z'], root).then((stdout) => (stdout === null ? { root, head, statuses: {}, files: [] } : { root, head, ...parseStatus(stdout, root) })),
  );
}

// The Changes tab (M45): the status's files with the line counts of
// `git diff --numstat HEAD`, which covers the index and the work tree
// both, so a staged change has its numbers too. An untracked file is not
// in the diff and keeps null counts; a binary one is listed with dashes
// and keeps them too. A repo with no commit yet has no HEAD to diff
// against, and the list then shows without numbers rather than not at
// all.
export function gitChanges(dir: string): Promise<GitChanges> {
  return gitStatus(dir).then((status) => {
    if (status.root === null) return { root: null, files: [] };
    const root = status.root;
    return gitText([NO_LOCKS, 'diff', '--numstat', 'HEAD', '-z'], root).then((stdout) => {
      const counts = stdout === null ? new Map<string, [number | null, number | null]>() : parseNumstat(stdout, root);
      const files = status.files
        .filter((f) => f.status !== 'ignored')
        .map((f) => {
          const c = counts.get(f.path.toLowerCase());
          return { ...f, rel: path.relative(root, f.path).replaceAll('\\', '/'), added: c?.[0] ?? null, removed: c?.[1] ?? null };
        })
        .sort((a, b) => a.rel.localeCompare(b.rel));
      return { root, files };
    });
  });
}

// The Commits tab (M45): the repo's recent commits, newest first, with
// the fields split on a unit separator since a subject can hold anything
// but a NUL and a control character. The hash is the full one, since the
// panel matches it against what the daemon recorded off rev-parse (M49)
// and shortens it itself. Any failure (no git, no commit yet) is an
// empty list; the panel says why when the root is null. The head is the
// branch checked out at the root, read off HEAD the way the daemon reads
// a session's branch, so a pane showing a repository with no session in
// it (M52) can still name the branch.
const LOG_ENTRIES = 80;
// The Claude-Session trailer's value (M58), the claude.ai URL a session
// run through claude.ai/code ends every commit with, so the Commits tab
// can credit a commit to the session that made it without a HEAD read;
// empty for a commit without one. The last field, since a commit with
// two such trailers would give two values joined by the separator, and
// the parser takes the first.
const TRAILER = '%(trailers:key=Claude-Session,valueonly,separator=%x00)';

export function gitLog(dir: string): Promise<GitLog> {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return Promise.resolve({ root: null, head: null, commits: [] });
  const root = findRepoRoot(dir);
  if (root === null) return Promise.resolve({ root: null, head: null, commits: [] });
  return headOf(root).then((head) =>
    gitText([NO_LOCKS, 'log', `--format=%H%x1f%s%x1f%an%x1f%at%x1f${TRAILER}`, `-n${LOG_ENTRIES}`], root).then((stdout) => (stdout === null ? { root, head, commits: [] } : { root, head, commits: parseLog(stdout) })),
  );
}

// The commit graph (M51): every local branch's commits in date order, so a
// child is always above its parents, with the parents and the branch
// refs on each, then which of those branches the default branch already
// holds. Both times ride along (M9 fix 303): the committer's is the
// row's `at`, since --date-order sorts by it and the row says when the
// thing happened on this branch; the author's is `authoredAt`, which
// a cherry-pick keeps from the original, so the card can say both. --branches and HEAD rather than --all: the remote refs would
// double every lane and the stash is not a branch. With remotes asked
// (M9 fix 286, the panel's chip) --remotes joins the log, so a branch
// that lives only on the remote is in it, and the merged list takes the
// remote branches too. Worktrees share one gitdir, so the graph from any
// of them is the whole repository's. Any failure is an empty graph with
// the root kept, as the log does.
const GRAPH_ENTRIES = 200;

// The patch id of every commit the graph has read, per repository (M9
// fix 304): a commit's patch id never changes, so each hash is asked
// once, through one pipe of `diff-tree -p --stdin` into `patch-id
// --stable`, and a read with nothing new spawns nothing. Null is a hash
// asked and not answered, a merge (no diff under -p) or an empty
// commit. A pipe that fails leaves its hashes unasked, so the next read
// tries again.
const patchIdsOf = new Map<string, Map<string, string | null>>();

// The two answers of a graph read that change only when the repository's
// files do (M9 fix 557): the author, keyed on the mtime of the common
// dir's config, and the worktree list, keyed on the linked worktrees'
// folders under <common>/worktrees, which `git worktree add` writes and
// `remove` and `prune` delete. Each half is re-read on its own when its
// key moves or it is older than GIT_FACTS_TTL_MS, and a null answer (git
// failed or timed out) is never kept, so the next poll asks again.
// A global `git config --global user.name` and a `git worktree move`
// change no key here, and a minute is the most either stays stale.
export const GIT_FACTS_TTL_MS = 60_000;
const repoFacts = new Map<string, { authorKey: string; author: string | null; authorAt: number; worktreesKey: string; worktrees: string[]; worktreesAt: number }>();

// The git a graph read spawns, a parameter so a test can count the calls.
export interface GraphGit {
  text: (args: string[], cwd: string) => Promise<string | null>;
  pipe: (argsA: string[], argsB: string[], stdin: string, cwd: string) => Promise<string | null>;
}
const realGit: GraphGit = { text: (args, cwd) => gitText(args, cwd), pipe: gitPipe };

function configKey(common: string | null): string {
  if (common === null) return 'none';
  try {
    return String(fs.statSync(path.join(common, 'config')).mtimeMs);
  } catch {
    return 'none';
  }
}

function worktreesKey(common: string | null): string {
  if (common === null) return '';
  let names: string[];
  try {
    names = fs.readdirSync(path.join(common, 'worktrees'));
  } catch {
    return '';
  }
  return names
    .filter((n) => fs.existsSync(path.join(common, 'worktrees', n, 'gitdir')))
    .sort()
    .join('\0');
}

async function patchIds(root: string, hashes: readonly string[], pipe: GraphGit['pipe'] = gitPipe): Promise<Map<string, string | null>> {
  let cache = patchIdsOf.get(root);
  if (cache === undefined) {
    cache = new Map();
    patchIdsOf.set(root, cache);
  }
  const fresh = hashes.filter((h) => !cache.has(h));
  if (fresh.length > 0) {
    const out = await pipe([NO_LOCKS, 'diff-tree', '-p', '--root', '--stdin'], [NO_LOCKS, 'patch-id', '--stable'], `${fresh.join('\n')}\n`, root);
    if (out !== null) for (const [hash, id] of parsePatchIds(out, fresh)) cache.set(hash, id);
  }
  const answer = new Map<string, string | null>();
  for (const h of hashes) answer.set(h, cache.get(h) ?? null);
  return answer;
}

export function gitGraph(dir: string, options: GitGraphOptions = {}, git: GraphGit = realGit): Promise<GitGraph> {
  const remotes = options.remotes === true;
  const empty = (root: string | null): GitGraph => ({ root, head: null, headHash: null, defaultBranch: null, merged: [], commits: [], worktrees: [], author: null, fetchedAt: null });
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return Promise.resolve(empty(null));
  const root = findRepoRoot(dir);
  if (root === null) return Promise.resolve(empty(null));
  const run = (args: string[]) => git.text([NO_LOCKS, ...args], root);
  return run(['log', '--branches', ...(remotes ? ['--remotes'] : []), 'HEAD', '--date-order', '--decorate=full', `--format=%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%at%x1f%ct%x1f${TRAILER}`, `-n${GRAPH_ENTRIES}`]).then(async (out) => {
    if (out === null) return empty(root);
    const parsed = parseGraph(out, remotes);
    const defaultBranch = defaultBranchOf(parsed.commits, parsed.head);
    const mergedOut = defaultBranch === null ? null : await run(['branch', '--merged', defaultBranch, '--format=%(refname:short)']);
    const merged = mergedOut === null || defaultBranch === null ? [] : parseMerged(mergedOut, defaultBranch);
    if (remotes && defaultBranch !== null) {
      const remoteMerged = await run(['branch', '-r', '--merged', defaultBranch, '--format=%(refname:short)']);
      if (remoteMerged !== null) merged.push(...parseMerged(remoteMerged, defaultBranch));
    }
    // The checkouts of the repository (M68), so the graph knows which
    // sessions work in it: the main one and every linked worktree.
    // Cached on the files (M9 fix 557), since the list changes only when a
    // worktree is added, removed or moved.
    const common = commonDirOf(root);
    const now = Date.now();
    let facts = repoFacts.get(root);
    if (facts === undefined) {
      facts = { authorKey: '', author: null, authorAt: -Infinity, worktreesKey: '', worktrees: [], worktreesAt: -Infinity };
      repoFacts.set(root, facts);
    }
    const wtKey = worktreesKey(common);
    let worktrees: string[];
    if (facts.worktreesKey === wtKey && now - facts.worktreesAt < GIT_FACTS_TTL_MS) {
      worktrees = facts.worktrees;
    } else {
      const worktreeOut = await run(['worktree', 'list', '--porcelain']);
      worktrees = worktreeOut === null ? [] : parseWorktrees(worktreeOut);
      if (worktreeOut !== null) Object.assign(facts, { worktreesKey: wtKey, worktrees, worktreesAt: now });
      else facts.worktreesAt = -Infinity;
    }
    // The repository's own author (M9 fix 286), read in the root so a
    // local config wins over the global one; unset is null, and then
    // nobody's commit is a person's. Cached on the config's mtime (M9
    // fix 557).
    const authorKey = configKey(common);
    let author: string | null;
    if (facts.authorKey === authorKey && now - facts.authorAt < GIT_FACTS_TTL_MS) {
      author = facts.author;
    } else {
      const authorOut = await run(['config', 'user.name']);
      author = authorOut === null || authorOut.trim() === '' ? null : authorOut.trim();
      if (authorOut !== null) Object.assign(facts, { authorKey, author, authorAt: now });
      else facts.authorAt = -Infinity;
    }
    // A cherry-picked twin (M9 fix 304): the rows sharing a patch id.
    const twins = twinGroups(await patchIds(root, parsed.commits.map((c) => c.hash), git.pipe));
    for (const c of parsed.commits) {
      const others = twins.get(c.hash);
      if (others !== undefined) c.twins = others;
    }
    return { root, head: parsed.head, headHash: parsed.headHash, defaultBranch, merged, commits: parsed.commits, worktrees, author, fetchedAt: fetchedAt(common) };
  });
}

// When the remote refs were last fetched (M9 fix 286): FETCH_HEAD's
// mtime under the common git dir (a worktree's own gitdir has none;
// `git fetch` from any checkout writes the shared one), null when the
// file is not there, which is a repository never fetched or with no
// remote at all. The common dir is read off the files (M9 fix 557).
function fetchedAt(common: string | null): number | null {
  if (common === null) return null;
  try {
    return Math.round(fs.statSync(path.join(common, 'FETCH_HEAD')).mtimeMs);
  } catch {
    return null;
  }
}

// The review tab (M64): the files changed since a base, with their status
// letters and line counts, and the base pinned to a hash. The base asked
// for is HEAD, the default branch (its merge base with HEAD, which is the
// branch's fork point in a worktree and HEAD itself on the default
// branch), or a hash a tab already holds, so a refresh keeps comparing
// against the commit the review opened on rather than following a commit
// the session makes mid-review. The list is `git diff --name-status` and
// `--numstat` against that hash, which covers the index and the work
// tree, plus the untracked files from `git ls-files --others
// --exclude-standard`, which a diff never lists: every file, so a new
// folder's files are rows of their own with their counts where the status
// named the folder once (M9 fix 943). Any failure is an empty list with the
// root kept. `git` is the worker's gitText unless a test hands in its own.
// M9 fix 790: since:<hash> is the session's start, the merge base of that
// commit and HEAD in this folder, so a session in a worktree compares
// against where its branch left the commit it started on; a hash this
// repository lacks reads as HEAD.
export function gitReview(dir: string, base: string, git: (args: string[], cwd: string, opts?: GitOptions) => Promise<string | null> = gitText): Promise<GitReview> {
  const empty = (root: string | null): GitReview => ({ root, head: null, defaultBranch: null, baseHash: null, files: [] });
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return Promise.resolve(empty(null));
  const root = findRepoRoot(dir);
  if (root === null) return Promise.resolve(empty(null));
  const run = (args: string[]) => git([NO_LOCKS, ...args], root);
  return (async () => {
    const head = await headOf(root, git);
    const isMain = (await run(['rev-parse', '--verify', '--quiet', 'refs/heads/main'])) !== null;
    const isMaster = !isMain && (await run(['rev-parse', '--verify', '--quiet', 'refs/heads/master'])) !== null;
    const defaultBranch = isMain ? 'main' : isMaster ? 'master' : null;
    const baseHash = await resolveReviewBase(base, defaultBranch, head, run);
    if (baseHash === null || !/^[0-9a-f]{40}$/.test(baseHash)) return { root, head, defaultBranch, baseHash: null, files: [] };
    const [names, nums, others] = await Promise.all([run(['diff', '--name-status', '-z', baseHash]), run(['diff', '--numstat', '-z', baseHash]), run(['ls-files', '--others', '--exclude-standard', '-z'])]);
    const letters = names === null ? new Map<string, { rel: string; letter: string }>() : parseNameStatus(names, root);
    const counts = nums === null ? new Map<string, [number | null, number | null]>() : parseNumstat(nums, root);
    const files: ReviewFile[] = [];
    for (const [key, { rel, letter }] of letters) {
      const c = counts.get(key);
      files.push({ rel, path: path.join(root, rel), letter, added: c?.[0] ?? null, removed: c?.[1] ?? null });
    }
    // Relative to the root with forward slashes, keyed the way
    // parseNameStatus keys its rows so the dedupe against the diff holds; a
    // nested repository stays one entry with a trailing slash, which
    // normalizePath drops. A null (git failed) is no untracked rows.
    const untracked = (others ?? '')
      .split('\0')
      .filter((rel) => rel !== '')
      .map((rel) => normalizePath(`${root}\\${rel}`))
      .filter((p) => !letters.has(p.toLowerCase()));
    const added = await countUntracked(root, untracked, git);
    for (const p of untracked) {
      const rel = path.relative(root, p).replaceAll('\\', '/');
      const n = added.get(p.toLowerCase()) ?? null;
      // No count is no number on both sides: `+0 −0` would read as an
      // empty file (M9 fix 917).
      files.push({ rel, path: p, letter: 'A', added: n, removed: n === null ? null : 0 });
    }
    files.sort((a, b) => a.rel.localeCompare(b.rel));
    return { root, head, defaultBranch, baseHash, files };
  })();
}

// The commit a review compares against, for the base the tab asked for
// (M9 fix 790 lifted this out of gitReview so a test can drive it): a
// 40-hex hash as it is; since:<hash> as the merge base of that commit and
// HEAD, falling through to HEAD when this repository does not know the
// commit; default as the merge base with the default branch; anything
// else as HEAD.
export async function resolveReviewBase(base: string, defaultBranch: string | null, head: string | null, run: (args: string[]) => Promise<string | null>): Promise<string | null> {
  if (/^[0-9a-f]{40}$/.test(base)) return base;
  const since = /^since:([0-9a-f]{40})$/.exec(base);
  if (since !== null) {
    const merged = (await run(['merge-base', since[1]!, 'HEAD']))?.trim() ?? null;
    if (merged !== null && /^[0-9a-f]{40}$/.test(merged)) return merged;
  } else if (base === 'default' && defaultBranch !== null && head !== defaultBranch) {
    return (await run(['merge-base', defaultBranch, 'HEAD']))?.trim() ?? null;
  }
  return (await run(['rev-parse', 'HEAD']))?.trim() ?? null;
}

// Past this an untracked file's count is not worth reading (M9 fix 474):
// a 400 MB log in the tree was read whole on every review refresh.
export const COUNT_LINES_CAP = 4 * 1024 * 1024;

let scratchIndexes = 0;

// An untracked file has no numstat, so its count is its lines; null for a
// file that cannot be read, is binary, is a folder or is past the cap,
// which the renderer shows as no number. Two gits for every file at once
// (M9 fix 917; fix 474 spawned one `diff --no-index` per file, about 200
// ms a spawn on this box, so five hundred new files took 25 s): the
// measured files are added intent-to-add to a scratch index, and `diff
// --numstat` under that index lists exactly them, the real index never
// touched. The paths go on stdin, since hundreds of them pass Windows'
// 32,767-character command line (fix 476's lesson), with
// --literal-pathspecs so `[ab].txt` is not a glob. An add that fails (a
// git before 2.25, or a file deleted since the status, which fails the add
// whole) leaves every measured file null until the next refresh. Keyed by
// the lowercased normalised path, as parseNumstat keys its rows. `run` is
// the worker's gitText unless a test hands in its own.
export async function countUntracked(root: string, files: readonly string[], run: (args: string[], cwd: string, opts?: GitOptions) => Promise<string | null> = gitText): Promise<Map<string, number | null>> {
  const counts = new Map<string, number | null>();
  const measured: string[] = [];
  await Promise.all(
    files.map(async (file) => {
      const key = normalizePath(file).toLowerCase();
      let size: number;
      try {
        const st = await fs.promises.stat(file);
        if (!st.isFile()) {
          counts.set(key, null);
          return;
        }
        size = st.size;
      } catch {
        counts.set(key, null);
        return;
      }
      if (size > COUNT_LINES_CAP) counts.set(key, null);
      else if (size === 0) counts.set(key, 0);
      else measured.push(file);
    }),
  );
  if (measured.length === 0) return counts;
  for (const file of measured) counts.set(normalizePath(file).toLowerCase(), null);
  // One scratch file per read, so two review tabs on one repository never
  // share one; the realpath because os.tmpdir() may be a short 8.3 path.
  const idx = path.join(fs.realpathSync.native(os.tmpdir()), `emerald-review-${process.pid}-${++scratchIndexes}.idx`);
  const env = { GIT_INDEX_FILE: idx };
  try {
    const rels = measured.map((f) => path.relative(root, f).replaceAll('\\', '/'));
    const addedToIndex = await run([LITERAL, NO_LOCKS, 'add', '-N', '--pathspec-from-file=-', '--pathspec-file-nul'], root, { stdin: rels.join('\0'), env });
    if (addedToIndex === null) return counts;
    const out = await run([NO_LOCKS, 'diff', '--numstat', '-z'], root, { env });
    if (out === null) return counts;
    const nums = parseNumstat(out, root);
    for (const file of measured) {
      const key = normalizePath(file).toLowerCase();
      counts.set(key, nums.get(key)?.[0] ?? null);
    }
    return counts;
  } finally {
    await fs.promises.rm(idx, { force: true });
  }
}

// One file as it was at a base (M64): `git show <hash>:<rel>` for the
// diff's left side. A path the base does not have (a new file) is
// missing, and a blob with a NUL in its first 8000 bytes is binary, the
// same rule the file tab reads by.
export function gitShow(dir: string, hash: string, rel: string): Promise<GitShow> {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !/^[0-9a-f]{40}$/.test(hash)) return Promise.resolve({ kind: 'missing' });
  const root = findRepoRoot(dir);
  if (root === null) return Promise.resolve({ kind: 'missing' });
  return gitBytes([NO_LOCKS, 'show', `${hash}:${rel}`], root).then((stdout) => {
    if (stdout === null) return { kind: 'missing' };
    if (stdout.subarray(0, 8000).includes(0)) return { kind: 'binary' };
    const text = Buffer.from(stdout.buffer, stdout.byteOffset, stdout.byteLength).toString('utf8');
    return { kind: 'text', text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
  });
}

// Revert a file's changes from the rail (M9 fix 310): the index entry
// put back to HEAD's, then the work tree's file, so a staged change
// goes whole; the row's letter goes with the next changes poll, which
// the caller asks for at once. The path is the repository-relative one
// the changes list carries. A file with no committed version is not
// this function's to refuse (the menu disables the item on it): git
// answers nothing for it and the answer is false. `run` is the worker's
// gitText unless a test hands in its own.
export function gitRevert(dir: string, rel: string, run: (args: string[], cwd: string) => Promise<string | null> = gitText): Promise<boolean> {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return Promise.resolve(false);
  const root = findRepoRoot(dir);
  if (root === null) return Promise.resolve(false);
  const target = revertTarget(root, rel);
  if (target === null) return Promise.resolve(false);
  // `--literal-pathspecs` (M9 fix 473): a pathspec is a glob, so without
  // it `[ab].txt` reverts `a.txt` and `b.txt` as well and `*` the tree.
  return run([LITERAL, 'reset', '-q', 'HEAD', '--', target], root).then((reset) => (reset === null ? false : run([LITERAL, 'checkout', 'HEAD', '--', target], root).then((out) => out !== null)));
}

// A repository's counts for the Statistics tab (M9 fix 836): the commits
// on HEAD, the first commit's time, the tags on the default branch and
// the version bumps of a package.json on it, which stand in for releases
// in a repository with no tags. Never rejects; a folder outside any repo
// answers zeros and runs nothing. `run` is the worker's gitText unless a
// test hands in its own. With since (M9 fix 885), the commits, tags and
// version bumps from that time on as well, for the yield of a span the
// activity log does not cover.
export async function gitProjectCounts(dir: string, since: number | null = null, run: (args: string[], cwd: string) => Promise<string | null> = gitText): Promise<GitProjectCounts> {
  const none: GitProjectCounts = { root: null, branch: null, commits: 0, firstCommitAt: null, tags: 0, bumps: 0, bumpsFile: null };
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return none;
  const root = findRepoRoot(dir);
  if (root === null) return none;
  const heads = await run([NO_LOCKS, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/main', 'refs/heads/master'], root);
  const listed = (heads ?? '').split(/\r?\n/).map((l) => l.trim());
  const branch = listed.includes('main') ? 'main' : listed.includes('master') ? 'master' : 'HEAD';
  const [count, roots, tagged, patch, counted] = await Promise.all([
    run([NO_LOCKS, 'rev-list', '--count', 'HEAD'], root),
    run([NO_LOCKS, 'log', '--max-parents=0', '--format=%at', 'HEAD'], root),
    // One line per tag, its date for the since count: the tagger's on an
    // annotated tag, the commit's on a lightweight one.
    run([NO_LOCKS, 'tag', '--merged', branch, '--format=%(creatordate:unix)'], root),
    // The quotes and the star reach git as written (no shell): the regex
    // is the key with its quotes, and the pathspec any package.json.
    run([NO_LOCKS, 'log', '-G"version"', '-p', '-U0', '--format=%x1e%H %ct', branch, '--', '*package.json'], root),
    since === null ? Promise.resolve(null) : run([NO_LOCKS, 'rev-list', '--count', `--since=@${Math.floor(since / 1000)}`, 'HEAD'], root),
  ]);
  const commits = count === null ? 0 : Number.parseInt(count.trim(), 10);
  const firsts = (roots ?? '').split(/\r?\n/).map((l) => Number.parseInt(l.trim(), 10)).filter((n) => Number.isFinite(n));
  const tagLines = (tagged ?? '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const tags = tagLines.length;
  const bumped = patch === null ? null : versionBumps(patch, since);
  const counts: GitProjectCounts = {
    root,
    branch,
    commits: Number.isFinite(commits) ? commits : 0,
    firstCommitAt: firsts.length === 0 ? null : Math.min(...firsts) * 1000,
    tags,
    bumps: bumped === null ? null : bumped.bumps,
    bumpsFile: bumped === null ? null : bumped.file,
  };
  if (since === null) return counts;
  const sinceCommits = counted === null ? 0 : Number.parseInt(counted.trim(), 10);
  counts.since = {
    from: since,
    commits: Number.isFinite(sinceCommits) ? sinceCommits : 0,
    tags: tagLines.filter((l) => Number.parseInt(l.trim(), 10) >= since / 1000).length,
    bumps: bumped === null ? null : (bumped.bumpsSince ?? 0),
  };
  return counts;
}

// The version bumps in a `log -p -U0` over the package.json files (M9 fix
// 836): per file, the distinct values its version line took, less one,
// since the first is where the file started rather than a release. The
// answer is the file with the most, ties to the shorter path and then the
// alphabetically first. With since (M9 fix 885), the picked file's bumps
// from that time on as well, as bumpsSince: its values walked oldest
// first, the first never a bump, and a value counts when it was not seen
// before and its commit's time (the chunk's first line, `<hash> <seconds>`,
// newest chunk first) is at or after since.
export function versionBumps(patch: string, since: number | null = null): { bumps: number; file: string | null; bumpsSince?: number } {
  const values = new Map<string, Set<string>>();
  const chunks = patch.split('\x1e');
  for (const chunk of chunks) {
    let file: string | null = null;
    for (const line of chunk.split(/\r?\n/)) {
      if (line.startsWith('+++ ')) {
        file = line.startsWith('+++ b/') ? line.slice(6) : null;
        continue;
      }
      if (file === null) continue;
      const m = /^\+\s{0,2}"version"\s*:\s*"([^"]+)"/.exec(line);
      if (m === null) continue;
      let set = values.get(file);
      if (set === undefined) values.set(file, (set = new Set()));
      set.add(m[1]!);
    }
  }
  let best: { bumps: number; file: string | null } = { bumps: 0, file: null };
  for (const [file, set] of values) {
    const bumps = set.size - 1;
    if (bumps <= 0) continue;
    const b = best.file;
    if (bumps > best.bumps || (bumps === best.bumps && b !== null && (file.length < b.length || (file.length === b.length && file < b)))) best = { bumps, file };
  }
  if (since === null) return best;
  let bumpsSince = 0;
  if (best.file !== null) {
    const seen = new Set<string>();
    for (const chunk of [...chunks].reverse()) {
      const lines = chunk.split(/\r?\n/);
      const at = /^\S+\s+(\d+)\s*$/.exec(lines[0] ?? '');
      let file: string | null = null;
      for (const line of lines) {
        if (line.startsWith('+++ ')) {
          file = line.startsWith('+++ b/') ? line.slice(6) : null;
          continue;
        }
        if (file !== best.file) continue;
        const m = /^\+\s{0,2}"version"\s*:\s*"([^"]+)"/.exec(line);
        if (m === null || seen.has(m[1]!)) continue;
        if (seen.size > 0 && at !== null && Number(at[1]) * 1000 >= since) bumpsSince++;
        seen.add(m[1]!);
      }
    }
  }
  return { ...best, bumpsSince };
}

// The path git is handed for a revert (M9 fix 310), or null when it is
// not a file inside the repository: an absolute one, an empty one, or
// one that climbs out of the root with `..`, and one that starts with
// `:`, git's pathspec magic (`:/` is the whole tree; M9 fix 473), which
// no file in the changes list is named. Forward slashes, since that is
// how the changes list names its files.
export function revertTarget(root: string, rel: string): string | null {
  if (typeof rel !== 'string' || rel === '' || rel.startsWith(':') || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const inside = path.relative(root, path.resolve(root, rel));
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) return null;
  return inside.replaceAll('\\', '/');
}

// Initialise a repository (M9 fix 255): `git init` in a folder the
// Commits tab found to be no repository, through the same worker as
// every other run. A folder already inside a repository answers that
// root and runs nothing, since the tab's read was stale rather than the
// folder bare; a failure (no git, a folder that cannot be written)
// answers an error line and no root. The caller re-arms the log watch
// and pushes the folder as a change, so the rail's poll reads the new
// repository at once. `run` is the worker's gitText unless a test hands
// in its own, since the worker's file is not there under node --test.
export function gitInit(dir: string, run: (args: string[], cwd: string) => Promise<string | null> = gitText): Promise<GitInit> {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) return Promise.resolve({ root: null, error: 'not an absolute path' });
  const existing = findRepoRoot(dir);
  if (existing !== null) return Promise.resolve({ root: existing, error: null });
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return Promise.resolve({ root: null, error: 'the folder is not there' });
  }
  if (!stat.isDirectory()) return Promise.resolve({ root: null, error: 'not a folder' });
  return run(['init', '-q'], dir).then((out) => {
    if (out === null) return { root: null, error: 'git init failed' };
    const root = findRepoRoot(dir);
    return root === null ? { root: null, error: 'git init made no repository' } : { root, error: null };
  });
}

// The branch checked out at a root, the reftable kind included (M9 fix
// 558): a reftable repository keeps the placeholder `ref:
// refs/heads/.invalid` in HEAD whatever is checked out, so git is asked
// (`symbolic-ref --short -q HEAD`, an unborn branch included and exit 1
// when detached, then `rev-parse HEAD` cut to seven), and the answer is
// kept per gitdir against the mtime of reftable/tables.list taken before
// the spawn, which git rewrites on every ref update. A files repository
// reads HEAD exactly as readHead does and spawns nothing.
const reftableHeads = new Map<string, { stamp: number; head: string | null }>();

export async function headOf(root: string, run: (args: string[], cwd: string) => Promise<string | null> = (args, cwd) => gitText(args, cwd)): Promise<string | null> {
  const gitDir = gitDirOf(root);
  if (gitDir === null || !fs.existsSync(path.join(gitDir, 'reftable'))) return readHead(root);
  let stamp: number;
  try {
    stamp = fs.statSync(path.join(gitDir, 'reftable', 'tables.list')).mtimeMs;
  } catch {
    return null;
  }
  const kept = reftableHeads.get(gitDir);
  if (kept !== undefined && kept.stamp === stamp) return kept.head;
  const name = await run([NO_LOCKS, 'symbolic-ref', '--short', '-q', 'HEAD'], root);
  let head: string | null = name === null || name.trim() === '' ? null : name.trim();
  if (head === null) {
    const hash = (await run([NO_LOCKS, 'rev-parse', 'HEAD'], root))?.trim() ?? '';
    head = /^[0-9a-f]{40}$/i.test(hash) ? hash.slice(0, 7).toLowerCase() : null;
  }
  if (head !== null) reftableHeads.set(gitDir, { stamp, head });
  return head;
}

// The branch checked out at a root: the name behind `ref: refs/heads/`
// in HEAD, the first seven characters of a bare sha (detached), null
// when HEAD cannot be read, and null for a reftable repository, whose
// HEAD says nothing (headOf asks git for that one, M9 fix 558).
export function readHead(root: string): string | null {
  const gitDir = gitDirOf(root);
  if (gitDir === null) return null;
  if (fs.existsSync(path.join(gitDir, 'reftable'))) return null;
  let text: string;
  try {
    text = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
  } catch {
    return null;
  }
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text);
  if (ref !== null) return ref[1]!;
  return /^[0-9a-f]{40}$/.test(text) ? text.slice(0, 7) : null;
}

// The common git dir behind a repo root (M9 fix 557): the gitdir itself,
// or, for a linked worktree, where its commondir file points, resolved
// against the gitdir, the rule git itself follows (readHeadFile in the
// daemon's git-head.ts reads it the same way). null when the gitdir does
// not read.
export function commonDirOf(root: string): string | null {
  const gitDir = gitDirOf(root);
  if (gitDir === null) return null;
  try {
    const rel = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim();
    return rel === '' ? gitDir : path.resolve(gitDir, rel);
  } catch {
    return gitDir;
  }
}

// The gitdir behind a repo root: .git itself for a checkout, or where a
// worktree's .git file points (gitdir: <path>), since a worktree keeps its
// own HEAD and its own logs there. null when neither reads.
export function gitDirOf(root: string): string | null {
  const dotGit = path.join(root, '.git');
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, 'utf8'));
    return m === null ? null : path.resolve(root, m[1]!.trim());
  } catch {
    return null;
  }
}

// How long after the last change under logs the push goes: a commit
// writes HEAD's log and the branch's, and a rebase writes a run of them.
const LOG_DEBOUNCE_MS = 300;

// One watch on a repository's logs folder (M49), so the Commits tab
// learns of a commit within a moment rather than on its five second
// poll: every ref update appends to <gitdir>/logs/HEAD, a direct child,
// so a non-recursive watch on the folder sees it. A repo with no commits
// has no logs folder yet (git init does not make it), so the watch then
// sits on the gitdir itself, which sees logs appear and HEAD rewritten on
// a checkout, and moves onto logs at the next change. The push names the
// root, which a git poll on it takes as a reason to refetch.
class RootWatch {
  private watcher: fs.FSWatcher | null = null;
  private watching: string | null = null;
  private pending: NodeJS.Timeout | null = null;
  readonly root: string;
  private readonly onChanged: (root: string) => void;

  constructor(root: string, onChanged: (root: string) => void) {
    this.root = root;
    this.onChanged = onChanged;
    this.open();
  }

  private open(): void {
    const gitDir = gitDirOf(this.root);
    if (gitDir === null) return;
    const logs = path.join(gitDir, 'logs');
    // logs is missing until the first commit; the gitdir is the
    // fallback, and a gitdir that cannot be watched leaves the poll.
    for (const target of [logs, gitDir]) {
      const w = watchFolder(target, () => this.schedule(), () => this.gone());
      if (w === null) continue;
      this.watcher = w;
      this.watching = target;
      return;
    }
  }

  // The watched folder was deleted (M9 fix 481; watchFolder has closed
  // it): take whatever of logs or the gitdir is still there, which is
  // nothing when the repository went, and tell the window now. The five
  // second poll carries on either way.
  private gone(): void {
    this.watcher = null;
    this.watching = null;
    this.open();
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = null;
    this.onChanged(this.root);
  }

  private schedule(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      // Sitting on the gitdir: logs may exist now, so move onto it.
      if (this.watching !== null && path.basename(this.watching) !== 'logs') {
        this.stopWatcher();
        this.open();
      }
      this.onChanged(this.root);
    }, LOG_DEBOUNCE_MS);
  }

  private stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
    this.watching = null;
  }

  close(): void {
    this.stopWatcher();
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = null;
  }
}

// The watches the window asks for: the repo above the rail's folder and,
// since M52, the repo of every commits view in a pane. Folders are
// resolved to their roots, so two folders of one repo share a watch, and
// a set reconciles: roots no longer named close, new ones open, the rest
// keep their watch.
export class GitLogWatcher {
  private readonly watches = new Map<string, RootWatch>();
  private readonly onChanged: (root: string) => void;
  // The folders last asked for, so a repository initialised under one
  // of them (M9 fix 255) can be taken on without the window asking
  // again: the folder resolved to no root then and does now.
  private dirs: readonly string[] = [];

  constructor(onChanged: (root: string) => void) {
    // A push shares only reads that started after it (M9 fix 916): the
    // runner shares an identical read in flight, and a `git log` begun a
    // moment before the commit would otherwise be handed to the reads this
    // push makes the renderer ask for, leaving the new row to the next
    // poll. Every read here runs with the root as its cwd, the same string
    // the push names.
    this.onChanged = (root) => {
      forgetInFlight(root);
      onChanged(root);
    };
  }

  set(dirs: readonly string[]): void {
    this.dirs = [...dirs];
    const roots = new Set<string>();
    for (const dir of dirs) {
      if (typeof dir !== 'string' || !path.isAbsolute(dir)) continue;
      const root = findRepoRoot(dir);
      if (root !== null) roots.add(root);
    }
    for (const [root, watch] of this.watches) {
      if (roots.has(root)) continue;
      watch.close();
      this.watches.delete(root);
    }
    for (const root of roots) {
      if (!this.watches.has(root)) this.watches.set(root, new RootWatch(root, this.onChanged));
    }
  }

  // The same folders again (M9 fix 255), after a git init under one of
  // them: a folder that resolved to no root then gets its watch now,
  // sitting on the gitdir until the first commit makes logs.
  refresh(): void {
    this.set(this.dirs);
  }

  // The roots watched now, for a test to read.
  roots(): string[] {
    return [...this.watches.keys()];
  }

  close(): void {
    for (const watch of this.watches.values()) watch.close();
    this.watches.clear();
  }
}
