import type { SessionInfo } from '@emerald/shared';
import type { GitCommit } from '../../preload/api.ts';

// Who made each commit (M58), the one rule the Commits graph
// (commit-graph-model.ts) reads. The list's own lanes lived here from M49
// until M65 made the list a layout of the same session graph, and M59's
// twin rule (a lane on a colour near an earlier lane's drew dashed) lived
// here until M68 took the dashes out for a bigger palette.

export type LaneSession = Pick<SessionInfo, 'id' | 'name' | 'color' | 'commits' | 'removedAt' | 'remoteSessionId'>;

// Who made each commit (M58): the session whose claude.ai id the commit's
// Claude-Session trailer names, first, since the trailer is written by the
// session that made the commit and is right across worktrees, forks and
// daemon restarts; then the sessions' own claims (SessionInfo.commits,
// HEAD read before and after a git-writing call), the earliest claim
// winning a hash two sessions claim (a resume that re-read the same
// HEAD, or two sessions in one checkout), the first in the list on a
// tie. A commit with neither has no owner. Keyed by hash, so the lanes
// and the graph credit the same session. `alsoRemote` (M70) is more
// claude.ai ids by session, read off the transcripts on disk: a session
// resumed in an external terminal is handed a new id the daemon's record
// never learns, and the transcript names both; a record's own id comes
// first.
export function commitOwners(commits: readonly GitCommit[], sessions: readonly LaneSession[], alsoRemote: ReadonlyMap<string, string> = new Map()): Map<string, string> {
  const byRemote = new Map<string, string>();
  for (const s of sessions) {
    if (s.remoteSessionId !== null && s.remoteSessionId !== undefined && !byRemote.has(s.remoteSessionId)) byRemote.set(s.remoteSessionId, s.id);
  }
  for (const [remote, sessionId] of alsoRemote) if (!byRemote.has(remote)) byRemote.set(remote, sessionId);
  const owners = new Map<string, string>();
  const shown = new Set(commits.map((c) => c.hash));
  for (const c of commits) {
    const remote = c.claudeSession ?? null;
    const owner = remote === null ? undefined : byRemote.get(remote);
    if (owner !== undefined) owners.set(c.hash, owner);
  }
  const claims = new Map<string, { sessionId: string; at: number }>();
  for (const s of sessions) {
    for (const { hash, at } of s.commits) {
      if (!shown.has(hash) || owners.has(hash)) continue;
      const held = claims.get(hash);
      if (held === undefined || at < held.at) claims.set(hash, { sessionId: s.id, at });
    }
  }
  for (const [hash, claim] of claims) owners.set(hash, claim.sessionId);
  return owners;
}
