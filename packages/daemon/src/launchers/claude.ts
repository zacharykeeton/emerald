import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findOnPath } from './find-on-path.ts';
import type { LaunchCommand, SessionLauncher } from './types.ts';

// Runs Claude directly in the PTY so that PTY exit means Claude exited: a
// native claude.exe as it is, and npm's claude.cmd resolved to node on the
// script it names (M9 fix 501), since node-pty runs a .cmd under an implicit
// cmd.exe /c, where Ctrl+C meets "Terminate batch job (Y/N)?" and cmd
// re-parses an argument holding &, |, ^ or %. A shim that cannot be read
// runs under cmd.exe as before, with a note in the log.
export const SHIM_NOTE = 'claude.cmd could not be resolved; running the shim';

// npm's shim ends in `"%dp0%\node_modules\...\cli.js" %*` (npm 6 wrote
// `"%~dp0\..."`); the `%*` after it keeps the `IF EXIST "%dp0%\node.exe"`
// line out.
const NPM_SHIM = /"%(?:dp0%|~dp0)\\([^"\r\n]+)"\s+%\*/g;

export interface ClaudeLauncherOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export class ClaudeLauncher implements SessionLauncher {
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;

  constructor(opts: ClaudeLauncherOptions = {}) {
    this.env = opts.env ?? process.env;
    this.home = opts.home ?? os.homedir();
  }

  command(extraArgs: string[]): LaunchCommand {
    const file = this.resolveClaude();
    if (file === null) {
      throw new Error('claude.exe not found in ~/.local/bin or on PATH');
    }
    if (file.toLowerCase().endsWith('.cmd')) {
      const resolved = resolveNpmShim(file, this.env);
      if (resolved !== null) return { file: resolved.node, args: [resolved.script, ...extraArgs] };
      return { file, args: [...extraArgs], note: SHIM_NOTE };
    }
    return { file, args: [...extraArgs] };
  }

  private resolveClaude(): string | null {
    // The native installer puts it here and may not be on PATH for a detached daemon.
    const local = path.join(this.home, '.local', 'bin', 'claude.exe');
    if (isFile(local)) return local;
    return findOnPath('claude.exe', this.env) ?? findOnPath('claude', this.env);
  }
}

function resolveNpmShim(shim: string, env: NodeJS.ProcessEnv): { node: string; script: string } | null {
  let text: string;
  try {
    text = fs.readFileSync(shim, 'utf8');
  } catch {
    return null;
  }
  let last: string | null = null;
  for (const m of text.matchAll(NPM_SHIM)) last = m[1] ?? null;
  if (last === null) return null;
  const dir = path.dirname(shim);
  const script = path.join(dir, last);
  if (!isFile(script)) return null;
  const beside = path.join(dir, 'node.exe');
  const node = isFile(beside) ? beside : findOnPath('node.exe', env);
  if (node === null) return null;
  return { node, script };
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
