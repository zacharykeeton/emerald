// M9 fix 1160: the daemon (git-branch.ts) and main (git-status.ts) read a
// detached HEAD as the first seven characters of its commit, a name no
// ref carries. The renderer tells one from a branch by that shape alone:
// a branch named with seven lowercase hex characters is rare, and the
// graph takes a ref that carries the name first. So the wire stays as it
// is and the conflict forecast keeps detached sessions.
export function isDetachedName(branch: string): boolean {
  return /^[0-9a-f]{7}$/.test(branch);
}

// The words a branch pill shows: the name, or `detached at <hash>` for a
// detached HEAD (the commits panel's head since M49, moved here so the
// sidebar, the agent card, the graph's pill and the Files rail read alike).
export function branchText(branch: string): string {
  return isDetachedName(branch) ? `detached at ${branch}` : branch;
}
