import fs from 'node:fs';
import path from 'node:path';
import { SHELL_LABELS, type ShellId, type ShellOption } from '@emerald/shared';
import { findOnPath } from './launchers/find-on-path.ts';

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
// launcher made before the fix. Found once at the daemon's start and
// reported on the hello: a pwsh or a Git Bash installed after the daemon
// started is picked up at its next start.
//
// Git Bash is looked for only where Git for Windows puts it, never as a
// bash.exe off the PATH: on a box with WSL that is System32\bash.exe (and
// the WindowsApps alias), which starts WSL, not Git Bash.
export function findShells(env: NodeJS.ProcessEnv = process.env): ShellOption[] {
  const shells: ShellOption[] = [];
  const pwsh = findOnPath('pwsh.exe', env);
  if (pwsh) shells.push(option('pwsh', pwsh));
  shells.push(option('powershell', findOnPath('powershell.exe', env) ?? 'powershell.exe'));
  const bashes: string[] = [];
  const programFiles = env['ProgramFiles'] ?? env['PROGRAMFILES'];
  if (programFiles) bashes.push(path.join(programFiles, 'Git', 'bin', 'bash.exe'));
  const localAppData = env['LOCALAPPDATA'];
  if (localAppData) bashes.push(path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'));
  const git = findOnPath('git.exe', env);
  if (git) bashes.push(path.resolve(path.dirname(git), '..', 'bin', 'bash.exe'));
  const bash = bashes.find(isFile);
  if (bash) shells.push(option('gitbash', bash));
  const comSpec = env['ComSpec'] ?? env['COMSPEC'];
  const cmd = comSpec && isFile(comSpec) ? comSpec : findOnPath('cmd.exe', env) ?? 'cmd.exe';
  shells.push(option('cmd', cmd));
  return shells;
}
