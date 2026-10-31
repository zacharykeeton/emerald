import { execFile } from 'node:child_process';
import path from 'node:path';

// The link that puts emmer on a Mac's PATH (M9 fix 1026). No installer runs
// on a Mac, so nothing does what the NSIS installer's emmer-path.ps1 does on
// Windows; the window asks the login shell once per launch whether emmer is
// on its PATH and, when it is not, offers the one line that links the
// bundle's shim there, in a banner with a Copy button. No electron import,
// so node --test runs this file.

export const LINK_TARGET = '/usr/local/bin/emmer';

// The mkdir because a fresh Apple silicon Mac has no /usr/local/bin
// (Homebrew lives in /opt/homebrew) and a bare ln fails there;
// /usr/local/bin is on the default PATH through /etc/paths.
export function linkCommand(shim: string): string {
  return `sudo mkdir -p /usr/local/bin && sudo ln -sf "${shim}" ${LINK_TARGET}`;
}

// The shell a terminal opens: SHELL, else the passwd entry's, else zsh,
// the Mac's default since Catalina.
export function loginShellOf(env: NodeJS.ProcessEnv, userShell: string | null): string {
  const fromEnv = env['SHELL'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  if (userShell !== null && userShell !== '') return userShell;
  return '/bin/zsh';
}

// Interactive and login for zsh and bash, so their rc files' PATH lines
// run too (the rule the daemon's login shell read uses, fix 1019); login
// alone for any other shell.
export function loginShellArgs(shell: string, command: string): string[] {
  const base = path.basename(shell);
  return base === 'zsh' || base === 'bash' ? ['-ilc', command] : ['-lc', command];
}

export interface ShellRun {
  code: number | null;
  timedOut: boolean;
  error: string | null;
}

// Never rejects: a numeric err.code is the exit code, a killed child a
// timeout, a string code (ENOENT) a spawn error.
export function runLoginShell(shell: string, args: string[], timeoutMs: number): Promise<ShellRun> {
  return new Promise((resolve) => {
    execFile(shell, args, { timeout: timeoutMs, encoding: 'utf8' }, (err) => {
      if (err === null) {
        resolve({ code: 0, timedOut: false, error: null });
        return;
      }
      const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string | null };
      if (e.killed === true) resolve({ code: null, timedOut: true, error: null });
      else if (typeof e.code === 'number') resolve({ code: e.code, timedOut: false, error: null });
      else resolve({ code: null, timedOut: false, error: typeof e.code === 'string' ? e.code : e.message });
    });
  });
}

export const LOOK_TIMEOUT_MS = 3000;

// command -v exits 1 in bash and zsh and 127 in dash when the name is not
// found; any non-zero exit reads as missing, since a login shell that fails
// in its rc files offering the link is harmless.
export function readLook(r: ShellRun): 'found' | 'missing' | { unknown: string } {
  if (r.timedOut) return { unknown: `timed out after ${LOOK_TIMEOUT_MS / 1000} s` };
  if (r.error !== null) return { unknown: r.error };
  return r.code === 0 ? 'found' : 'missing';
}

// The command the banner offers, or null: off a Mac, in a dev tree (whose
// resources are Electron's own), when emmer is already on the PATH, or when
// the login shell could not be asked.
export async function askPathLink(opts: {
  platform: NodeJS.Platform;
  packaged: boolean;
  resourcesPath: string;
  env: NodeJS.ProcessEnv;
  userShell: string | null;
  log: (m: string) => void;
  run?: typeof runLoginShell;
}): Promise<string | null> {
  if (opts.platform !== 'darwin' || !opts.packaged) return null;
  const shell = loginShellOf(opts.env, opts.userShell);
  const run = opts.run ?? runLoginShell;
  const look = readLook(await run(shell, loginShellArgs(shell, 'command -v emmer'), LOOK_TIMEOUT_MS));
  if (look === 'found') {
    opts.log("path link: emmer is on the login shell's PATH");
    return null;
  }
  if (look === 'missing') {
    opts.log("path link: emmer is not on the login shell's PATH; the window offers the link");
    return linkCommand(path.join(opts.resourcesPath, 'bin', 'emmer'));
  }
  opts.log(`path link: could not ask the login shell ${shell} (${look.unknown}); no note`);
  return null;
}
