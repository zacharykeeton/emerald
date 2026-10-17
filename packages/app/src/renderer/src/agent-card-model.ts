// M9 fix 821: the commits line on an agent's card. The member keeps hashes
// only (no subject), so the line names the count and the newest hash's
// first seven characters; null for none, which draws no line.
export function commitsLine(commits: readonly { hash: string }[]): string | null {
  const last = commits[commits.length - 1];
  if (last === undefined) return null;
  const short = last.hash.slice(0, 7);
  return commits.length === 1 ? `1 commit, ${short}` : `${commits.length} commits, newest ${short}`;
}
