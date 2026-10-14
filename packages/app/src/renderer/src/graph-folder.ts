import { runningKind } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { samePath } from './history-model.ts';

// The folder the rail's Commits graph shows for the focused session (M9
// fixes 114 and 590). With a branch, the live cwd. With none, the live cwd
// when the session is at home there (where Claude started for a session
// running Claude, `groupCwd`; where it was spawned for a bare shell), so a
// Claude or a shell started in a folder with no repository shows that
// folder's own graph (fix 255); else the last folder it had a branch in,
// then its spawn folder, so a tool call's `cd` into a log or temp folder
// keeps the repository (fix 114). `spawnCwd` keeps the spelling it was
// asked with, so the compare folds slashes, case and a trailing separator,
// and an 8.3 spelling of the spawn folder reads as away.
export function graphFolder(
  session: Pick<SessionInfo, 'kind' | 'claudeSessionId' | 'cwd' | 'groupCwd' | 'spawnCwd' | 'branch'>,
  lastRepo: string | undefined,
): string {
  if (session.branch !== null) return session.cwd;
  const home = runningKind(session) === 'claude' ? session.groupCwd : session.spawnCwd;
  if (samePath(session.cwd, home)) return session.cwd;
  return lastRepo ?? session.spawnCwd;
}
