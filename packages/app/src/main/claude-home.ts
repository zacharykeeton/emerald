import fs from 'node:fs';
import { claudeHome } from '@emerald/shared/claude-home';

// Where Claude Code keeps its files, for the history scan and the usage
// reader: EMERALD_CLAUDE_HOME for a verify script (M15, M9 fix 163), else
// CLAUDE_CONFIG_DIR as Claude Code reads it, else ~/.claude. The function
// is shared's since M9 fix 522, so the daemon's task list reads the same
// folder; this file keeps the existence check and its log. A folder that is not there (a fresh box, or the variable set
// by hand to a path that does not exist, M9 fix 243) is an empty home:
// nothing to scan, nothing to watch, no token, and one line in the main
// log saying so rather than a line per reader per ask.

export type HomeLog = (msg: string) => void;

export { claudeHome };

let saidMissing: string | null = null;

// True when the home folder is there; false, said once per path, when
// it is not.
export function claudeHomeExists(log: HomeLog): boolean {
  const home = claudeHome();
  let ok: boolean;
  try {
    ok = fs.statSync(home).isDirectory();
  } catch {
    ok = false;
  }
  if (ok) {
    saidMissing = null;
    return true;
  }
  if (saidMissing !== home) {
    saidMissing = home;
    log(`claude home ${home} is not there; nothing to scan`);
  }
  return false;
}
