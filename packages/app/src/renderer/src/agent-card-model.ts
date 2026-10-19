import { formatDuration } from '@emerald/shared';

// M9 fix 821: the commits line on an agent's card. The member keeps hashes
// only (no subject), so the line names the count and the newest hash's
// first seven characters; null for none, which draws no line.
export function commitsLine(commits: readonly { hash: string }[]): string | null {
  const last = commits[commits.length - 1];
  if (last === undefined) return null;
  const short = last.hash.slice(0, 7);
  return commits.length === 1 ? `1 commit, ${short}` : `${commits.length} commits, newest ${short}`;
}

// M9 fix 903: the card's now line off the member's latest text, with how old it is once that is a minute or more, since a fork can go many calls between two texts; null for no text.
export const NOW_AGE_AFTER_MS = 60_000;

export function nowLine(said: { text: string; at: number } | undefined, now: number): { text: string; age: string | null } | null {
  if (said === undefined) return null;
  return { text: said.text, age: now - said.at >= NOW_AGE_AFTER_MS ? `${formatDuration(said.at, now)} ago` : null };
}
