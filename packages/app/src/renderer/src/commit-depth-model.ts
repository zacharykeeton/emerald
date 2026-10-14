import type { GraphCommit } from '../../preload/api.ts';

// Which branch each commit of the log is on, as a depth (M9 fix 214)
// and a name (M9 fix 253): the rows are one stack in date order, so a
// commit in the middle of the list says nothing about the branch that
// holds it unless the row leans, and the lean alone does not say which
// branch. The trunk is the default branch's first-parent line, depth 0;
// every other commit is one deeper than the line it forked from: a
// branch off the trunk is 1, a worktree cut from a worktree is 2.
// Colour still means session (commit-lanes-model.ts); this is a second,
// smaller reading laid over the same rows.
//
// The walk: the default branch's tip by first parent marks the trunk,
// then every other branch tip walks first parents until it meets a
// marked commit and takes one more than that commit's depth and the
// tip's name, the oldest tip first so a branch cut from another's tip
// (the moment `git worktree add -b` runs) is the one that reads deeper,
// not its base, and a commit two branches hold takes the nearest tip's
// name as it takes its depth. A commit no tip reaches (an old branch
// whose ref went, kept in the log by a merge; every finished fix's
// commits once the batch's worktree branches are deleted) walks the
// same way from wherever it is, and its name comes off the merge that
// took it, whose subject git writes as `Merge branch 'fix-stall'` and
// whose second parent heads the chain; a chain with no such merge has
// no name. A chain that runs off the window's edge before meeting a
// marked commit counts as off the trunk, since the trunk is what lies
// past the edge. A window without the default branch's tip (the branch
// is behind the log's window, or the repository has no main) gives
// every commit 0 and no name: nothing indents rather than everything.
export interface CommitBranch {
  depth: number;
  // The branch's name: a ref's where a tip reached the commit, the
  // trunk's on the trunk, the merge subject's for a merged chain whose
  // ref is gone, null when nothing says.
  branch: string | null;
  // The branch the merge that named this chain landed on (`merged into
  // main`), when the name came off a merge subject; null otherwise.
  mergedInto: string | null;
}

// `Merge branch 'fix-stall'` and `Merge branch 'fix-stall' into dev`
// both name the branch first.
const MERGE_SUBJECT = /^Merge branch '([^']+)'/;

export function commitBranches(commits: readonly GraphCommit[], defaultBranch: string | null): Map<string, CommitBranch> {
  const out = new Map<string, CommitBranch>();
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  const trunkTip = defaultBranch === null ? undefined : commits.find((c) => c.refs.includes(defaultBranch));
  if (trunkTip === undefined) {
    for (const c of commits) out.set(c.hash, { depth: 0, branch: null, mergedInto: null });
    return out;
  }
  for (let c: GraphCommit | undefined = trunkTip; c !== undefined && !out.has(c.hash); c = c.parents[0] === undefined ? undefined : byHash.get(c.parents[0])) out.set(c.hash, { depth: 0, branch: defaultBranch, mergedInto: null });
  // The merge that took a chain, by the chain's head (the merge's
  // second parent), resolved to its branch once every chain is marked.
  const mergeOf = new Map<string, GraphCommit>();
  for (const c of commits) if (c.parents.length > 1 && MERGE_SUBJECT.test(c.subject)) mergeOf.set(c.parents[1]!, c);
  const named: Array<{ hash: string; merge: GraphCommit }> = [];
  // Walks first parents from `from` to a marked commit and marks the
  // chain one deeper than it under the name; a chain off the edge is
  // one deep.
  const walk = (from: GraphCommit, name: string | null) => {
    const chain: GraphCommit[] = [];
    let base = 0;
    for (let c: GraphCommit | undefined = from; c !== undefined; c = c.parents[0] === undefined ? undefined : byHash.get(c.parents[0])) {
      const held = out.get(c.hash);
      if (held !== undefined) {
        base = held.depth;
        break;
      }
      chain.push(c);
    }
    const merge = name === null ? mergeOf.get(from.hash) : undefined;
    const branch = name ?? (merge === undefined ? null : (MERGE_SUBJECT.exec(merge.subject)?.[1] ?? null));
    for (const c of chain) {
      out.set(c.hash, { depth: base + 1, branch, mergedInto: null });
      if (merge !== undefined && branch !== null) named.push({ hash: c.hash, merge });
    }
  };
  // The list is newest first, so the oldest tips are at its end. A tip
  // that also carries the default branch's name is the trunk's, marked
  // already; its other refs add nothing.
  const tips = commits.filter((c) => c.refs.length > 0 && !out.has(c.hash)).reverse();
  for (const tip of tips) if (!out.has(tip.hash)) walk(tip, tip.refs.find((r) => r !== defaultBranch) ?? tip.refs[0] ?? null);
  for (const c of commits) if (!out.has(c.hash)) walk(c, null);
  for (const { hash, merge } of named) {
    const into = out.get(merge.hash)?.branch ?? null;
    const held = out.get(hash)!;
    out.set(hash, { ...held, mergedInto: into });
  }
  return out;
}

// The depths alone, as M9 fix 214 read them.
export function commitDepths(commits: readonly GraphCommit[], defaultBranch: string | null): Map<string, number> {
  return new Map([...commitBranches(commits, defaultBranch)].map(([hash, b]) => [hash, b.depth]));
}

// The leaning subject's tooltip (M9 fix 253): `on fix-stall, one branch
// off main`; null on the trunk, where the row keeps no tooltip, and on
// a nameless chain.
export function leanTitle(branch: CommitBranch, defaultBranch: string | null): string | null {
  if (branch.depth === 0 || branch.branch === null) return null;
  const words = ['one', 'two', 'three'];
  const count = branch.depth <= words.length ? words[branch.depth - 1]! : String(branch.depth);
  const off = defaultBranch === null ? 'the trunk' : defaultBranch;
  return `on ${branch.branch}, ${count} ${branch.depth === 1 ? 'branch' : 'branches'} off ${off}`;
}
