import { EventEmitter } from 'node:events';
import type { ConflictPair, ConflictReport, BranchBase, SessionInfo } from '@emerald/shared';
import { repoKey } from './git-branch.ts';
import { readHead, readHeadFile } from './git-head.ts';
import { gitText, type GitOptions } from './git-runner.ts';

// The conflict forecast (M9 fix 320, docs/design/conflict-forecast.md
// section 5): for every unordered pair of live sessions whose records
// carry distinct branches in one repository, `git merge-tree
// --write-tree --name-only <headA> <headB>` says which files a merge of
// the two would conflict on; exit 0 is clean and names nothing. Per
// live session with a branch, `rev-list --left-right --count
// <default>...<branch>` gives behind and ahead, and the merge base's
// committer time is when the branch forked. Every git runs through the
// worker thread (git-runner.ts) with --no-optional-locks, so nothing
// here touches an index or a lock. The merge does write: `merge-tree
// --write-tree` stores the merged tree and a blob per conflicted file as
// loose objects in the repository, unreachable, which git's own `gc`
// prunes (M75's L28, kept as it is). The reading is of committed heads
// only: no stash, no working tree, and a touched-file overlap that
// merges clean is not a conflict.
//
// Cadence: a minute, and right after every credited commit (the
// manager's changed event with a record's commit count moved, its
// branch changed or its state crossing exited), debounced so a burst of
// pushes is one poll. Never on the status line's beat. A pair whose two
// heads have not moved since its last answer is not run again, and a
// session whose head and default head are where they were keeps its
// base, so twelve idle lanes cost twelve file reads a minute and no
// git. The report goes out only when it differs from the last.

// The report a caller can read at any time; `changed` fires with the
// same when a poll moved it.
export interface ConflictWatchOptions {
  // The live records, the manager's list.
  list: () => SessionInfo[];
  pollMs?: number;
  // How long a burst of changes is gathered before the poll they ask for.
  debounceMs?: number;
  log?: { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void };
  // Test knobs: the git runner and the head reader.
  git?: (args: string[], cwd: string, opts?: GitOptions) => Promise<string | null>;
  head?: (cwd: string) => Promise<string | null>;
}

export const CONFLICT_POLL_MS = 60_000;
const DEBOUNCE_MS = 400;
const TIMEOUT_MS = 8000;

interface Lane {
  id: string;
  cwd: string;
  branch: string;
  repo: string;
  head: string;
}

export class ConflictWatch extends EventEmitter {
  private readonly opts: ConflictWatchOptions;
  private report: ConflictReport = { conflicts: [], base: {} };
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  // What each session looked like at the last change we acted on, so
  // the manager's every push (a status line, an activity tick) is not a
  // poll; only a commit, a branch move or a state edge is.
  private readonly seen = new Map<string, string>();
  // The pairs' last answers by the two heads they were run between,
  // and the bases by the branch head and the default's head.
  private readonly pairs = new Map<string, { heads: string; files: string[] }>();
  private readonly bases = new Map<string, { key: string; base: BranchBase }>();
  // Whether this git has `merge-tree --write-tree` (2.38 on), read once
  // at start; until then, and when start was never called, it is taken
  // to have it.
  private mergeTreeOk: Promise<boolean> = Promise.resolve(true);

  constructor(opts: ConflictWatchOptions) {
    super();
    this.opts = opts;
  }

  current(): ConflictReport {
    return this.report;
  }

  start(): void {
    if (this.timer !== null) return;
    this.mergeTreeOk = this.readGitVersion();
    this.timer = setInterval(() => void this.poll(), this.opts.pollMs ?? CONFLICT_POLL_MS);
    this.timer.unref();
    void this.poll();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.debounce !== null) clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
  }

  // The manager's changed event: a poll soon when the record's commit
  // count, branch or liveness moved, else nothing.
  onSessionChanged(info: SessionInfo): void {
    const sig = `${info.branch ?? ''}|${info.commits.length}|${info.state === 'exited' ? 'x' : 'l'}|${info.cwd}`;
    if (this.seen.get(info.id) === sig) return;
    this.seen.set(info.id, sig);
    this.poke();
  }

  onSessionRemoved(id: string): void {
    this.seen.delete(id);
    this.poke();
  }

  poke(): void {
    if (this.debounce !== null) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.poll();
    }, this.opts.debounceMs ?? DEBOUNCE_MS);
    this.debounce.unref();
  }

  // One reading; a poke during a poll runs one more after it, so a
  // commit that lands mid-poll is not missed until the minute.
  poll(): Promise<void> {
    if (this.running !== null) {
      this.again = true;
      return this.running;
    }
    this.running = this.read()
      .catch((err: unknown) => this.opts.log?.warn('conflict forecast failed', err))
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          void this.poll();
        }
      });
    return this.running;
  }

  private git(args: string[], cwd: string): Promise<string | null> {
    return (this.opts.git ?? gitText)(['--no-optional-locks', ...args], cwd, { timeoutMs: TIMEOUT_MS });
  }

  // On a git older than 2.38 every `merge-tree --write-tree` fails, so
  // every pair answered null, was never cached and ran again each
  // minute with the forecast empty and nothing said (the backlog entry
  // of 2026-09-28). One line then, and the pairs are skipped; the bases
  // need no new git and are read as before. A version that does not
  // parse is taken as new enough.
  private async readGitVersion(): Promise<boolean> {
    const out = (await this.git(['--version'], process.cwd())) ?? '';
    const m = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(out);
    if (m === null) return true;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    if (major > 2 || (major === 2 && minor >= 38)) return true;
    this.opts.log?.warn(`conflict forecast off: git ${m[1]}.${m[2]}.${m[3] ?? '0'} is older than 2.38, which merge-tree --write-tree needs`);
    return false;
  }

  private async headOf(cwd: string): Promise<string | null> {
    if (this.opts.head !== undefined) return this.opts.head(cwd);
    return readHeadFile(cwd) ?? (await readHead(cwd));
  }

  private async read(): Promise<void> {
    const lanes: Lane[] = [];
    for (const s of this.opts.list()) {
      if (s.state === 'exited' || s.branch === null || typeof s.removedAt === 'number') continue;
      const head = await this.headOf(s.cwd);
      if (head === null) continue;
      lanes.push({ id: s.id, cwd: s.cwd, branch: s.branch, repo: repoKey(s.cwd), head });
    }
    const conflicts: ConflictPair[] = [];
    const base: Record<string, BranchBase> = {};
    const byRepo = new Map<string, Lane[]>();
    for (const l of lanes) byRepo.set(l.repo, [...(byRepo.get(l.repo) ?? []), l]);
    const live = new Set<string>();
    const pairsOn = await this.mergeTreeOk;
    for (const [repo, group] of byRepo) {
      const def = await this.defaultOf(group[0]!.cwd);
      for (const l of group) {
        if (def !== null) {
          const key = `${l.head}:${def.head}:${def.name}`;
          const kept = this.bases.get(l.id);
          const b = kept !== undefined && kept.key === key ? kept.base : await this.readBase(l, def, repo);
          if (b !== null) {
            this.bases.set(l.id, { key, base: b });
            base[l.id] = b;
          }
        }
        if (!pairsOn) continue;
        for (const m of group) {
          if (m.id <= l.id || m.branch === l.branch || m.head === l.head) continue;
          const [a, b] = l.id < m.id ? [l, m] : [m, l];
          const pairKey = `${a.id} ${b.id}`;
          live.add(pairKey);
          const heads = `${a.head} ${b.head}`;
          const kept = this.pairs.get(pairKey);
          const files = kept !== undefined && kept.heads === heads ? kept.files : await this.mergeTree(a, b);
          if (files === null) continue;
          this.pairs.set(pairKey, { heads, files });
          if (files.length > 0) conflicts.push({ a: a.id, b: b.id, files });
        }
      }
    }
    for (const key of this.pairs.keys()) if (!live.has(key)) this.pairs.delete(key);
    for (const id of this.bases.keys()) if (!(id in base)) this.bases.delete(id);
    conflicts.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
    const next: ConflictReport = { conflicts, base };
    if (JSON.stringify(next) === JSON.stringify(this.report)) return;
    this.report = next;
    this.opts.log?.info('conflict forecast', { pairs: conflicts.length, sessions: Object.keys(base).length });
    this.emit('changed', next);
  }

  // The repository's default branch, read once per poll per repository:
  // origin/HEAD's target when the repository has one, else main, else
  // master; null when none of those exists, and the sessions pair
  // without a base.
  private async defaultOf(cwd: string): Promise<{ name: string; head: string } | null> {
    const remote = (await this.git(['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], cwd))?.trim() ?? '';
    const candidates = remote !== '' ? [remote, 'main', 'master'] : ['main', 'master'];
    for (const name of candidates) {
      const head = (await this.git(['rev-parse', '--verify', '-q', `${name}^{commit}`], cwd))?.trim() ?? '';
      if (/^[0-9a-f]{40}$/.test(head)) return { name: name.replace(/^origin\//, ''), head };
    }
    return null;
  }

  private async readBase(l: Lane, def: { name: string; head: string }, repo: string): Promise<BranchBase | null> {
    const counts = await this.git(['rev-list', '--left-right', '--count', `${def.head}...${l.head}`], l.cwd);
    // A null here is a timeout or a failed git and is otherwise silent (M9
    // fix 451): the lane's card goes without its base line until the next
    // poll, so the log says which git answered null.
    const nullFrom = (which: string): null => {
      this.opts.log?.warn('conflict base unread', { lane: l.id, git: which });
      return null;
    };
    if (counts === null) return nullFrom('rev-list');
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(counts);
    if (m === null) return null;
    const mergeBaseOut = await this.git(['merge-base', def.head, l.head], l.cwd);
    if (mergeBaseOut === null) return nullFrom('merge-base');
    const mergeBase = mergeBaseOut.trim();
    if (!/^[0-9a-f]{40}$/.test(mergeBase)) return null;
    const whenOut = await this.git(['log', '-1', '--format=%ct', mergeBase], l.cwd);
    if (whenOut === null) return nullFrom('log');
    const when = whenOut.trim();
    if (!/^\d+$/.test(when)) return null;
    return { behind: Number(m[1]), ahead: Number(m[2]), forkedAt: Number(when) * 1000, defaultBranch: def.name, repo };
  }

  // The conflicted paths of a merge of the two heads, empty when it
  // would apply clean, null when git could not say. `merge-tree
  // --write-tree` exits 1 on a conflict with the paths on stdout, so
  // that exit is an answer here (the runner's okExits). `-z` (M9 fix
  // 475) keeps a path as written: without it git quotes any name
  // core.quotePath would, and `ü f.txt` came back as `"\303\274 f.txt"`.
  private async mergeTree(a: Lane, b: Lane): Promise<string[] | null> {
    const out = await (this.opts.git ?? gitText)(['--no-optional-locks', 'merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', a.head, b.head], a.cwd, { timeoutMs: TIMEOUT_MS, okExits: [1] });
    return out === null ? null : parseMergeTree(out);
  }
}

// The paths after the tree hash, each ended by a NUL under `-z`; a clean
// merge prints the hash alone. --no-messages leaves the messages section
// out, so an empty field is the end.
export function parseMergeTree(out: string): string[] {
  const fields = out.split('\0');
  const paths: string[] = [];
  for (const field of fields.slice(1)) {
    if (field === '') break;
    paths.push(field);
  }
  return paths;
}
