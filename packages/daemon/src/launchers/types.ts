import type { ShellOption } from '@emerald/shared';

// A launcher decides which executable runs for a session kind; a shell
// session's launcher also takes the shell picked (M9 fix 624).
export interface LaunchCommand {
  file: string;
  args: string[];
  // Something the manager logs as a warning at launch (M9 fix 501: a
  // claude.cmd that could not be resolved runs under cmd.exe).
  note?: string;
  // Added over the stamped env for this launch alone (M9 fix 624: cmd's
  // PROMPT).
  env?: Record<string, string>;
}

export interface SessionLauncher {
  // `extraArgs` come from the user (for example claude flags) and are appended.
  command(extraArgs: string[], shell?: ShellOption | null): LaunchCommand;
}
