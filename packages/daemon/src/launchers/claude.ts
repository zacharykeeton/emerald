import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  // The emerald mod's folder (M9 fix 725), loaded with --plugin-dir ahead
  // of the session's own arguments; null launches without it.
  modDir?: string | null;
}

export class ClaudeLauncher implements SessionLauncher {
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;
  readonly modDir: string | null;

  constructor(opts: ClaudeLauncherOptions = {}) {
    this.env = opts.env ?? process.env;
    this.home = opts.home ?? os.homedir();
    this.modDir = opts.modDir ?? null;
  }

  command(extraArgs: string[]): LaunchCommand {
    const file = this.resolveClaude();
    if (file === null) {
      throw new Error('claude.exe not found in ~/.local/bin or on PATH');
    }
    // Only the command line carries the flag; the record's own args (what
    // session.list and emmer resume show) stay the user's.
    const args = this.modDir === null ? [...extraArgs] : ['--plugin-dir', this.modDir, ...extraArgs];
    const env = this.modChannelEnv();
    if (file.toLowerCase().endsWith('.cmd')) {
      const resolved = resolveNpmShim(file, this.env);
      if (resolved !== null) return { file: resolved.node, args: [resolved.script, ...args], ...env };
      return { file, args, note: SHIM_NOTE, ...env };
    }
    return { file, args, ...env };
  }

  // How the mod starts its prompt channel (M9 fix 741): this daemon's own
  // runner (node.exe, or Emerald.exe under ELECTRON_RUN_AS_NODE once
  // installed) on the CLI's main.js, which sits beside cli/mod in the repo
  // and the stage alike, so the pty's PATH needs no emmer.
  private modChannelEnv(): { env?: Record<string, string> } {
    if (this.modDir === null) return {};
    return { env: { EMERALD_MOD_CHANNEL: JSON.stringify([process.execPath, path.resolve(this.modDir, '..', 'dist', 'main.js'), 'mod-channel']) } };
  }

  private resolveClaude(): string | null {
    // The native installer puts it here and may not be on PATH for a detached daemon.
    const local = path.join(this.home, '.local', 'bin', 'claude.exe');
    if (isFile(local)) return local;
    return findOnPath('claude.exe', this.env) ?? findOnPath('claude', this.env);
  }
}

// Where the emerald mod is (M9 fix 725): packages/cli/mod from the
// daemon's dist or src launchers folder, and the staged cli/mod from the
// staged daemon's, since stage.mjs keeps daemon and cli side by side.
// EMERALD_CLAUDE_MOD=0 turns it off; a folder without its module is
// launched without, with the reason in the line the daemon logs.
export function resolveClaudeModDir(env: NodeJS.ProcessEnv): { dir: string | null; line: string } {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'cli', 'mod');
  if (env['EMERALD_CLAUDE_MOD'] === '0') return { dir: null, line: 'claude mod: off (EMERALD_CLAUDE_MOD=0)' };
  if (!isFile(path.join(dir, 'hooks', 'register.js'))) return { dir: null, line: `claude mod: missing at ${dir}` };
  return { dir, line: `claude mod: ${dir}` };
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
