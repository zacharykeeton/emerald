import path from 'node:path';
import { emeraldHomeOf } from '@emerald/shared/pipe-name';

// Everything emerald writes lives under ~/.emerald. EMERALD_HOME overrides it so a
// test or a second daemon can run without touching the real one.
export function emeraldHome(): string {
  return emeraldHomeOf(process.env);
}

export function logsDir(): string {
  return path.join(emeraldHome(), 'logs');
}

export function daemonInfoPath(): string {
  return path.join(emeraldHome(), 'daemon.json');
}

// Layout and session metadata that must outlive the daemon process.
export function statePath(): string {
  return path.join(emeraldHome(), 'state.json');
}

// The load sampler's sweep script (M9 fix 300), written at each start of
// its child and run with -File.
export function loadScriptPath(): string {
  return path.join(emeraldHome(), 'load-sweep.ps1');
}

// Git Bash's rc (M9 fix 624), written before each Git Bash launch and read
// with --rcfile.
export function bashrcPath(): string {
  return path.join(emeraldHome(), 'emerald.bashrc');
}

// Session identity and exit info, so a restarted daemon can list the sessions
// its predecessor owned as exited and resume them.
export function sessionsPath(): string {
  return path.join(emeraldHome(), 'sessions.json');
}

// The saved prompts (M56), one list for every window and the CLI.
export function promptsPath(): string {
  return path.join(emeraldHome(), 'prompts.json');
}

// The folder labels (M9 fix 194), one mapping for every window and the CLI.
export function foldersPath(): string {
  return path.join(emeraldHome(), 'folders.json');
}
