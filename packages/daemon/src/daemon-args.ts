import path from 'node:path';

// The daemon's own arguments (M9 fix 1079): --home <dir> and --pipe <path>
// set EMERALD_HOME and EMERALD_PIPE before anything reads them. A remote
// host's relay starts the daemon through WMI's Win32_Process.Create, which
// carries no environment, so the home and the pipe ride on the command line.
// --ssh-connection <value> sets SSH_CONNECTION (M9 fix 1091): WMI carries none,
// and Claude Code copies to the clipboard of the terminal it is shown in,
// through OSC 52, only when it sees one.
// Answers null when the arguments are good (or absent), else the line to
// print before exiting 64.
export function applyDaemonArgs(argv: string[], env: NodeJS.ProcessEnv): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--home' || arg === '--pipe' || arg === '--ssh-connection') {
      const value = argv[i + 1];
      if (value === undefined || value === '') return `emmerd: ${arg} needs a value`;
      if (arg === '--home') env['EMERALD_HOME'] = path.resolve(value);
      else if (arg === '--pipe') env['EMERALD_PIPE'] = value;
      else env['SSH_CONNECTION'] = value;
      i++;
      continue;
    }
    return `emmerd: unknown argument ${arg}`;
  }
  return null;
}
