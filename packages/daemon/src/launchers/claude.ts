import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findOnPath } from './find-on-path.ts';
import type { ShellOption } from '@emerald/shared';
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
  // The platform the launch resolves for (M9 fix 1019); process.platform
  // by default, named by a test to run the other arm.
  platform?: NodeJS.Platform;
}

export class ClaudeLauncher implements SessionLauncher {
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;
  readonly modDir: string | null;
  private readonly platform: NodeJS.Platform;

  constructor(opts: ClaudeLauncherOptions = {}) {
    this.env = opts.env ?? process.env;
    this.home = opts.home ?? os.homedir();
    this.modDir = opts.modDir ?? null;
    this.platform = opts.platform ?? process.platform;
  }

  // `env` is the session's own (M9 fix 996), so a claude installed since
  // the daemon started is found on the PATH the registry holds now.
  command(extraArgs: string[], _shell?: ShellOption | null, env: NodeJS.ProcessEnv = this.env): LaunchCommand {
    const file = this.resolveClaude(env);
    if (file === null) {
      throw new Error(this.platform === 'win32' ? 'claude.exe not found in ~/.local/bin or on PATH' : 'claude not found in ~/.local/bin or on PATH');
    }
    // Only the command line carries the flag; the record's own args (what
    // session.list and emmer resume show) stay the user's.
    const args = this.modDir === null ? [...extraArgs] : ['--plugin-dir', this.modDir, ...extraArgs];
    if (this.platform === 'win32' && file.toLowerCase().endsWith('.cmd')) {
      const resolved = resolveNpmShim(file, env);
      if (resolved !== null) return { file: resolved.node, args: [resolved.script, ...args] };
      return { file, args, note: SHIM_NOTE };
    }
    return { file, args };
  }

  private resolveClaude(env: NodeJS.ProcessEnv): string | null {
    return findClaude(env, this.home, this.platform);
  }
}

// The claude a launch runs, also asked by the hello (M9 fix 1084), so the
// hello's `claude` and a spawn answer alike.
export function findClaude(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): string | null {
  // The native installer puts it here and may not be on PATH for a detached daemon.
  if (platform !== 'win32') {
    // M9 fix 1019: on a Mac the native installer's link (statSync follows
    // it into ~/.local/share/claude/versions), else the PATH's. The file
    // runs as it is, a binary or a #! script alike; the kernel reads the
    // shebang when node-pty execs it.
    const local = path.join(home, '.local', 'bin', 'claude');
    if (isFile(local)) return local;
    return findOnPath('claude', env, platform);
  }
  const local = path.join(home, '.local', 'bin', 'claude.exe');
  if (isFile(local)) return local;
  return findOnPath('claude.exe', env, platform) ?? findOnPath('claude', env, platform);
}

// The claude a one-off read runs (M9 fix 1094, claude auth status): the
// one findClaude finds, npm's .cmd resolved to node on its script. A shim
// that cannot be read answers null rather than running under cmd.exe,
// which Node 24 refuses for a .cmd without a shell anyway.
export function claudeRun(env: NodeJS.ProcessEnv, home: string, platform: NodeJS.Platform): { file: string; args: string[] } | null {
  const file = findClaude(env, home, platform);
  if (file === null) return null;
  if (platform === 'win32' && file.toLowerCase().endsWith('.cmd')) {
    const resolved = resolveNpmShim(file, env);
    return resolved === null ? null : { file: resolved.node, args: [resolved.script] };
  }
  return { file, args: [] };
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
  const node = isFile(beside) ? beside : findOnPath('node.exe', env, 'win32');
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
