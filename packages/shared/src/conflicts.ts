// The conflict forecast (M9 fix 320, docs/design/conflict-forecast.md):
// for every pair of live sessions on distinct branches of one
// repository the daemon runs `git merge-tree` between the two heads and
// answers the files the merge would conflict on; per session with a
// branch it answers how far the branch is ahead of and behind the
// repository's default branch and when it forked. The window draws the
// pairs as ties on the commit graph, a mark on the sidebar row and two
// lines on the lane card; `emmer conflicts` prints the same reading.

export interface ConflictPair {
  // Session ids, a before b by id, so a pair is sent once, not per side.
  a: string;
  b: string;
  // Every conflicted path in git's order; the renderer counts and cuts.
  files: string[];
}

export interface BranchBase {
  ahead: number;
  behind: number;
  // The merge base's committer time, epoch ms.
  forkedAt: number;
  // The default branch the figures are against (`main`), the short name.
  defaultBranch: string;
  // The repository the session's checkout belongs to, the daemon's
  // repoKey, so a reader can group the bases by repository.
  repo: string;
}

export interface ConflictReport {
  conflicts: ConflictPair[];
  base: Record<string, BranchBase>;
}

// The not-yet-read answer and the nothing-to-say answer are one shape.
export const EMPTY_CONFLICTS: ConflictReport = { conflicts: [], base: {} };

export function isConflictReport(v: unknown): v is ConflictReport {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o['conflicts']) || typeof o['base'] !== 'object' || o['base'] === null) return false;
  return o['conflicts'].every((p) => typeof p === 'object' && p !== null && typeof (p as ConflictPair).a === 'string' && typeof (p as ConflictPair).b === 'string' && Array.isArray((p as ConflictPair).files));
}
