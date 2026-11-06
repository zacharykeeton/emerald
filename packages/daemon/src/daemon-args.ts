import path from 'node:path';

// The daemon's own arguments (M9 fix 1079): --home <dir> and --pipe <path>
// set EMERALD_HOME and EMERALD_PIPE before anything reads them. A remote
// host's relay starts the daemon through WMI's Win32_Process.Create, which
// carries no environment, so the home and the pipe ride on the command line.
// Answers null when the arguments are good (or absent), else the line to
// print before exiting 64.
export function applyDaemonArgs(argv: string[], env: NodeJS.ProcessEnv): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--home' || arg === '--pipe') {
      const value = argv[i + 1];
      if (value === undefined || value === '') return `emmerd: ${arg} needs a value`;
      if (arg === '--home') env['EMERALD_HOME'] = path.resolve(value);
      else env['EMERALD_PIPE'] = value;
      i++;
      continue;
    }
    return `emmerd: unknown argument ${arg}`;
  }
  return null;
}
