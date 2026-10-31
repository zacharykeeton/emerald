import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SHELL_LABELS, type ShellId, type ShellOption } from '@emerald/shared';
import { envValue, findOnPath } from './launchers/find-on-path.ts';

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function option(id: ShellId, file: string): ShellOption {
  return { id, label: SHELL_LABELS[id], file };
}

// The shells a plain shell session can run on this box (M9 fix 624), in
// SHELL_IDS order; the first is the default New shell starts, so pwsh when
// it is on the PATH and Windows PowerShell otherwise, exactly the choice the
// launcher made before the fix. Found at the daemon's start and again on
// the registry's PATH at each spawn and app hello (M9 fix 996), and
// reported on the hello: a pwsh or a Git Bash installed after the daemon
// started is picked up at the next spawn or window connect.
//
// Git Bash is looked for only where Git for Windows puts it, never as a
// bash.exe off the PATH: on a box with WSL that is System32\bash.exe (and
// the WindowsApps alias), which starts WSL, not Git Bash.
//
// Off Windows (M9 fix 1018) the list is the login shell first, when it is
// zsh, bash or sh (a Mac's is zsh), then each of zsh, bash and sh found on
// the PATH and not listed yet, and /bin/sh when nothing was found, the way
// Windows PowerShell's bare name is always listed, so the default is never
// missing. A login shell that is fish or anything else is not listed.
export function findShells(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  userShell: () => string | null = osUserShell,
): ShellOption[] {
  if (platform !== 'win32') return findUnixShells(env, platform, userShell);
  const shells: ShellOption[] = [];
  const pwsh = findOnPath('pwsh.exe', env, platform);
  if (pwsh) shells.push(option('pwsh', pwsh));
  shells.push(option('powershell', findOnPath('powershell.exe', env, platform) ?? 'powershell.exe'));
  const bashes: string[] = [];
  const programFiles = envValue(env, 'ProgramFiles');
  if (programFiles) bashes.push(path.join(programFiles, 'Git', 'bin', 'bash.exe'));
  const localAppData = envValue(env, 'LOCALAPPDATA');
  if (localAppData) bashes.push(path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'));
  const git = findOnPath('git.exe', env, platform);
  if (git) bashes.push(path.resolve(path.dirname(git), '..', 'bin', 'bash.exe'));
  const bash = bashes.find(isFile);
  if (bash) shells.push(option('gitbash', bash));
  const comSpec = envValue(env, 'ComSpec');
  const cmd = comSpec && isFile(comSpec) ? comSpec : findOnPath('cmd.exe', env, platform) ?? 'cmd.exe';
  shells.push(option('cmd', cmd));
  return shells;
}

function osUserShell(): string | null {
  try {
    // Throws for a uid with no passwd entry.
    return os.userInfo().shell ?? null;
  } catch {
    return null;
  }
}

// The user's login shell (M9 fix 1018): SHELL when it is an absolute path,
// else the passwd entry's, else /bin/sh. path.isAbsolute, so a Windows temp
// path in a test counts as a Unix one does.
export function loginShell(
  env: NodeJS.ProcessEnv = process.env,
  userShell: () => string | null = osUserShell,
): string {
  const fromEnv = env['SHELL'];
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  const fromUser = userShell();
  if (fromUser && path.isAbsolute(fromUser)) return fromUser;
  return '/bin/sh';
}

const UNIX_SHELLS = ['zsh', 'bash', 'sh'] as const;

function isUnixShell(id: string): id is (typeof UNIX_SHELLS)[number] {
  return (UNIX_SHELLS as readonly string[]).includes(id);
}

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findUnixShells(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  userShell: () => string | null,
): ShellOption[] {
  const shells: ShellOption[] = [];
  const login = loginShell(env, userShell);
  const loginId = path.basename(login);
  if (isUnixShell(loginId) && isExecutableFile(login)) shells.push(option(loginId, login));
  for (const id of UNIX_SHELLS) {
    if (shells.some((s) => s.id === id)) continue;
    const file = findOnPath(id, env, platform);
    if (file) shells.push(option(id, file));
  }
  if (shells.length === 0) shells.push(option('sh', '/bin/sh'));
  return shells;
}
