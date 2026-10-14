// Where Claude Code keeps its files (M9 fix 522), one function for the
// app's history scan and usage reader and the daemon's task list, so the
// two never read different folders. A subpath export
// (@emerald/shared/claude-home) rather than part of the barrel, since the
// renderer imports the barrel and this needs node:os and node:path.
import os from 'node:os';
import path from 'node:path';

// Where Claude Code itself keeps its settings: CLAUDE_CONFIG_DIR, which
// Claude Code honours, else ~/.claude. The hooks install reads this rather
// than claudeHome(), since a harness's seeded EMERALD_CLAUDE_HOME must not
// move the settings file it installs into (M9 fix 544). A variable that is
// empty after a trim counts as unset; read on every call.
export function claudeConfigDir(): string {
  const config = process.env['CLAUDE_CONFIG_DIR']?.trim();
  if (config) return config;
  return path.join(os.homedir(), '.claude');
}

// EMERALD_CLAUDE_HOME first, so a verify script's seeded home (M15, M9 fix
// 163) wins whatever the box sets; then claudeConfigDir(). A variable that
// is empty after a trim counts as unset. Read on every call, never cached,
// since a test sets the variable mid-run.
export function claudeHome(): string {
  const own = process.env['EMERALD_CLAUDE_HOME']?.trim();
  if (own) return own;
  return claudeConfigDir();
}
