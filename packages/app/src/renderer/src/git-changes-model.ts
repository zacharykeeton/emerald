import type { GitChanges, GitCommit, GraphCommit } from '../../preload/api.ts';
import { normalizePath } from './files-model.ts';

// The pure parts of the Changes and Timeline tabs (M45): the parsers the
// main process runs over git's output (git-status.ts), here beside the
// porcelain parser so they are tested with it, and the split of the log
// the Timeline draws.

// One line count pair of `git diff --numstat`: added and removed, null
// for a binary file, which git lists with dashes.
export type LineCounts = [number | null, number | null];

// `added TAB removed TAB path NUL`, with a rename as `added TAB removed
// TAB NUL old NUL new NUL`. Keyed by the normalized, lowercased absolute
// path, the way the rail keys its rows.
export function parseNumstat(output: string, root: string): Map<string, LineCounts> {
  const counts = new Map<string, LineCounts>();
  const fields = output.split('\0');
  for (let i = 0; i < fields.length; i++) {
    const parts = fields[i]!.split('\t');
    if (parts.length < 3) continue;
    const num = (s: string) => (s === '-' ? null : Number(s));
    let rel = parts[2]!;
    if (rel === '') {
      // A rename: the old path and then the new one follow as fields.
      i += 2;
      rel = fields[i] ?? '';
    }
    if (rel === '') continue;
    counts.set(normalizePath(`${root}\\${rel}`).toLowerCase(), [num(parts[0]!), num(parts[1]!)]);
  }
  return counts;
}

// `git log --format=%H%x1f%s%x1f%an%x1f%at`: one commit per line, the
// fields on a unit separator since a subject can hold any other
// printable character. A line that does not parse is skipped.
export function parseLog(output: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const line of output.split('\n')) {
    const [hash, subject, author, at, trailer] = line.split('\x1f');
    if (hash === undefined || hash === '' || at === undefined) continue;
    const seconds = Number(at);
    if (!Number.isFinite(seconds)) continue;
    commits.push({ hash, subject: subject ?? '', author: author ?? '', at: seconds * 1000, claudeSession: remoteSessionOf(trailer) });
  }
  return commits;
}

// The session_<id> token off a Claude-Session trailer's value (M58), the
// first when a commit carries several; null for none. The same token the
// daemon reads off the transcript as the session's remoteSessionId.
export function remoteSessionOf(trailer: string | undefined): string | null {
  if (trailer === undefined || trailer === '') return null;
  const first = trailer.split('\0')[0] ?? '';
  const m = /\/(session_[A-Za-z0-9]+)\/?$/.exec(first.trim());
  return m === null ? null : m[1]!;
}

// The Commits tab's two groups: the commits made since the session started
// (its createdAt) and the rest. By time, not by author: a commit a person
// made in the session's pane counts as much as one Claude made, and git
// carries no session id to tell them apart. Git keeps whole seconds, so
// the start is taken to the second it fell in, or a commit made in the
// session's first second would read as earlier.
export function splitSince(commits: readonly GitCommit[], createdAt: number | null): { since: GitCommit[]; earlier: GitCommit[] } {
  const since: GitCommit[] = [];
  const earlier: GitCommit[] = [];
  const start = createdAt === null ? null : Math.floor(createdAt / 1000) * 1000;
  for (const c of commits) (start !== null && c.at >= start ? since : earlier).push(c);
  return { since, earlier };
}

// The `+3 −1` text of a Changes row; nothing when the diff has no
// numbers for the file.
export function countsText(added: number | null, removed: number | null): string | null {
  if (added === null && removed === null) return null;
  return `+${added ?? 0} −${removed ?? 0}`;
}

// The rollup a folded folder's row carries (M9 fix 197): how many of
// the repository's changed files are under the folder and the sum of
// their line counts. The list is the whole repository's, so the answer
// does not depend on what is expanded. null with no changed file under
// the folder, so the row stays plain; a sum over files that have no
// numbers (untracked ones) is null too, so a folder of fresh files shows
// its count in the tooltip and no `+0 −0`.
export interface FolderCounts {
  files: number;
  added: number | null;
  removed: number | null;
}

export function folderCounts(changes: GitChanges, dir: string): FolderCounts | null {
  const prefix = normalizePath(dir).toLowerCase() + '\\';
  let files = 0;
  let added: number | null = null;
  let removed: number | null = null;
  for (const f of changes.files) {
    if (!normalizePath(f.path).toLowerCase().startsWith(prefix)) continue;
    files++;
    if (f.added !== null) added = (added ?? 0) + f.added;
    if (f.removed !== null) removed = (removed ?? 0) + f.removed;
  }
  return files === 0 ? null : { files, added, removed };
}

// The folder row's tooltip: `4 files, +55 −22`, or the count alone when
// no file under it has numbers.
export function folderCountsTitle(c: FolderCounts): string {
  const files = c.files === 1 ? '1 file' : `${c.files} files`;
  const text = countsText(c.added, c.removed);
  return text === null ? files : `${files}, ${text}`;
}

// `git log --branches HEAD --date-order --decorate=full
// --format=%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%at` (M51): the list's line
// with the parents (space separated) and the decorations before the
// subject. The decorations are `HEAD -> refs/heads/main, refs/heads/x,
// tag: refs/tags/v1`: only the local branches are kept, as short names,
// and the head marker says which commit and branch are checked out
// (`HEAD` alone is a detached head). With remotes (M9 fix 286, the log
// run with --remotes too) the remote branches are kept apart as
// `origin/x`, less `origin/HEAD` (the remote's default pointer, not a
// branch) and less any whose commit also carries the local branch of
// the same name, which is the tracking pair on one commit and reads as
// the local pill alone. The line carries the author time and then the
// committer time (M9 fix 303): `at` is the committer's, what the log's
// date order sorts by, and `authoredAt` the author's; a line from
// before the second field (a test built on the old shape) takes the
// one time for both.
export interface ParsedGraph {
  head: string | null;
  headHash: string | null;
  commits: GraphCommit[];
}

export function parseGraph(output: string, remotes = false): ParsedGraph {
  const commits: GraphCommit[] = [];
  let head: string | null = null;
  let headHash: string | null = null;
  for (const line of output.split('\n')) {
    const [hash, parentField, decorations, subject, author, at, ct, trailer] = line.split('\x1f');
    if (hash === undefined || hash === '' || at === undefined) continue;
    const authored = Number(at);
    if (!Number.isFinite(authored)) continue;
    const committed = ct === undefined || ct === '' ? authored : Number(ct);
    const seconds = Number.isFinite(committed) ? committed : authored;
    const parents = (parentField ?? '').split(' ').filter((p) => p !== '');
    const refs: string[] = [];
    const remoteRefs: string[] = [];
    for (const raw of (decorations ?? '').split(', ')) {
      let ref = raw.trim();
      if (ref === '') continue;
      if (ref === 'HEAD') {
        headHash = hash;
        continue;
      }
      if (ref.startsWith('HEAD -> ')) {
        ref = ref.slice('HEAD -> '.length);
        headHash = hash;
        if (ref.startsWith('refs/heads/')) head = ref.slice('refs/heads/'.length);
      }
      if (ref.startsWith('refs/heads/')) refs.push(ref.slice('refs/heads/'.length));
      else if (remotes && ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) remoteRefs.push(ref.slice('refs/remotes/'.length));
    }
    const commit: GraphCommit = { hash, parents, refs, subject: subject ?? '', author: author ?? '', at: seconds * 1000, authoredAt: authored * 1000, claudeSession: remoteSessionOf(trailer) };
    if (remotes) commit.remoteRefs = remoteRefs.filter((r) => !refs.includes(r.slice(r.indexOf('/') + 1)));
    commits.push(commit);
  }
  return { head, headHash, commits };
}

// `git patch-id --stable` over `git diff-tree -p --stdin` (M9 fix 304):
// one `<patchId> <hash>` a line for every commit that printed a diff. A
// merge prints none under -p and so has no line; every hash asked for
// and not answered is null, so the caller's cache holds it as asked.
export function parsePatchIds(output: string, asked: readonly string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const hash of asked) out.set(hash, null);
  for (const line of output.split('\n')) {
    const [patchId, hash] = line.trim().split(/\s+/);
    if (patchId === undefined || hash === undefined || !out.has(hash)) continue;
    out.set(hash, patchId);
  }
  return out;
}

// The twins of every commit that has any (M9 fix 304): the other hashes
// in the map sharing its patch id, in the map's order, which is the
// log's. A commit with no patch id (a merge) or with an id of its own
// is not in the answer.
export function twinGroups(patchIds: ReadonlyMap<string, string | null>): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const [hash, id] of patchIds) {
    if (id === null) continue;
    const group = byId.get(id);
    if (group === undefined) byId.set(id, [hash]);
    else group.push(hash);
  }
  const out = new Map<string, string[]>();
  for (const group of byId.values()) {
    if (group.length < 2) continue;
    for (const hash of group) out.set(hash, group.filter((h) => h !== hash));
  }
  return out;
}

// The original of a twin group (M9 fix 304): the copy with the earliest
// committer time, and on a tie the one furthest down the log, which the
// date order puts last; every other copy is a pick.
export function twinOriginal(hashes: readonly string[], commits: readonly GraphCommit[]): string | null {
  let best: { hash: string; at: number; index: number } | null = null;
  for (const hash of hashes) {
    const index = commits.findIndex((c) => c.hash === hash);
    if (index < 0) continue;
    const at = commits[index]!.at;
    if (best === null || at < best.at || (at === best.at && index > best.index)) best = { hash, at, index };
  }
  return best === null ? null : best.hash;
}

// The branch the graph folds the others into: main when the repository
// has it, else master, else whatever is checked out.
export function defaultBranchOf(commits: readonly GraphCommit[], head: string | null): string | null {
  const names = new Set<string>();
  for (const c of commits) for (const r of c.refs) names.add(r);
  if (names.has('main')) return 'main';
  if (names.has('master')) return 'master';
  return head;
}

// `git branch --merged <default> --format=%(refname:short)`: one name a
// line, the default itself left out since it is trivially merged. The
// remote list (`branch -r --merged`, M9 fix 286) comes through the same
// parse, less `origin/HEAD`, which is a pointer and never a pill.
export function parseMerged(output: string, defaultBranch: string): string[] {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && l !== defaultBranch && !l.endsWith('/HEAD'));
}

// `git worktree list --porcelain` (M68): a `worktree <path>` line opens
// each entry, the main checkout first. Git prints forward slashes on
// Windows; the paths are kept as printed, since the folder match that
// reads them takes either slash.
export function parseWorktrees(output: string): string[] {
  return output
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim())
    .filter((l) => l !== '');
}

// `git diff --name-status -z <base>` (M64): a status letter, then the
// path, with a rename or copy as `R100 NUL old NUL new`; the letter is
// kept without its score and the new path is the file's. Keyed like
// parseNumstat so the two join on the path.
export function parseNameStatus(output: string, root: string): Map<string, { rel: string; letter: string }> {
  const files = new Map<string, { rel: string; letter: string }>();
  const fields = output.split('\0');
  for (let i = 0; i + 1 < fields.length; i++) {
    const code = fields[i]!;
    if (code === '') continue;
    const letter = code[0]!;
    let rel = fields[++i] ?? '';
    // A rename or copy names the old path first and the new one after it.
    if ((letter === 'R' || letter === 'C') && i + 1 < fields.length) rel = fields[++i] ?? rel;
    if (rel === '') continue;
    files.set(normalizePath(`${root}\\${rel}`).toLowerCase(), { rel, letter });
  }
  return files;
}
