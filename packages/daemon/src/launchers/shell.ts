import fs from 'node:fs';
import path from 'node:path';
import { findOnPath } from './find-on-path.ts';
import type { ShellOption } from '@emerald/shared';
import type { LaunchCommand, SessionLauncher } from './types.ts';

// Runs after the profile, so a custom prompt keeps its look and only gains
// the OSC 9;9 sequence, which is how Windows Terminal learns a shell's
// folder and how the daemon does (osc-cwd.ts). It goes in front of the
// prompt text: at the end, PSReadLine misjudged where the input starts and
// its redraw of the first keystroke read as a doubled letter in emmer read.
// Only filesystem locations are reported: a registry drive is not a folder.
// Written with single quotes and [char] so nothing here needs escaping on
// the command line.
// One line: -Command takes a single string, so every statement ends in a
// semicolon rather than a newline.
//
// M9 fix 196: the prompt also writes the FinalTerm marks Windows
// Terminal's shell integration reads (osc-marks.ts): D with the last
// command's exit code at the top of the prompt, then A before the prompt
// text; and PSReadLine's Enter writes C before it accepts the line, which
// is the moment a command starts. Whether the prompt followed a command
// is read off the history, the way Windows Terminal's own snippet does:
// the same history id as the last prompt means an empty Enter or a
// Ctrl+C at the prompt, which gets a bare D, and the very first prompt
// (id -1 before it) gets none, since it ended no command. The code: 1
// when the last error on $Error came from this history entry (a
// cmdlet's failure; $? read at the top of the prompt is true again by
// then in Windows PowerShell 5.1, so it cannot be the tell), else 0 when
// $? is true, else $LASTEXITCODE when the last command was native (an
// int, nonzero), else 1. Enter on a blank line writes no C, so a shell
// at its prompt never reads as running.
//
// M9 fix 505: the Enter handler writes C and then calls whatever the
// profile had bound to Enter, read once here after the profile into
// $global:__emeraldEnter, rather than replacing it with a plain AcceptLine.
// PSReadLine 2.0.0 (Windows PowerShell 5.1's) has no -Key or -Chord on
// Get-PSReadLineKeyHandler, so the binding is found among -Bound. No
// binding or AcceptLine: bound as before. Another named function (say
// ValidateAndAcceptLine): called by name. A -ScriptBlock binding shows as
// CustomAction, whose block the public object does not carry, so it is
// read by reflection off PSReadLine's private dispatch table; when that
// read fails (a PSReadLine whose internals moved), Enter is left alone:
// the profile's handler stays and that shell writes no C mark, so it reads
// idle through its commands, the cost chosen over breaking the person's
// Enter. Also known: C is written before the profile's handler runs, so a
// line ValidateAndAcceptLine refuses leaves the row running until the
// next prompt.
export const PROMPT_WRAPPER = [
  '$global:__emeraldPrompt = $function:prompt;',
  '$global:__emeraldHistory = -1;',
  'function global:prompt {',
  '$ok = $?; $lec = $LASTEXITCODE;',
  '$e = [char]27; $q = [char]34; $a = [char]7;',
  '$h = Get-History -Count 1; $hid = if ($h) { $h.Id } else { 0 };',
  "$m = '';",
  'if ($global:__emeraldHistory -ne -1) {',
  "if ($hid -eq $global:__emeraldHistory) { $m = $e + ']133;D' + $a }",
  'else {',
  '$c = 0;',
  'if ($Error.Count -gt 0 -and $Error[0].InvocationInfo.HistoryId -eq $hid) { $c = 1 }',
  'elseif (-not $ok) { $c = if ($lec -is [int] -and $lec -ne 0) { $lec } else { 1 } };',
  "$m = $e + ']133;D;' + $c + $a",
  '}',
  '};',
  '$global:__emeraldHistory = $hid;',
  '$p = [string](& $global:__emeraldPrompt);',
  '$l = $executionContext.SessionState.Path.CurrentLocation;',
  "if ($l.Provider.Name -eq 'FileSystem') {",
  "$p = $e + ']9;9;' + $q + $l.ProviderPath + $q + $e + '\\' + $p",
  '};',
  "$m + $e + ']133;A' + $a + $p",
  '};',
  'if (-not (Get-Module PSReadLine)) { Import-Module PSReadLine -ErrorAction SilentlyContinue };',
  'if (Get-Module PSReadLine) {',
  '$global:__emeraldEnter = $null; $zb = $true;',
  "$zk = Get-PSReadLineKeyHandler -Bound | Where-Object { $_.Key -eq 'Enter' } | Select-Object -First 1;",
  "if ($zk -and $zk.Function -eq 'CustomAction') {",
  '$zb = $false;',
  'try {',
  '$zt = [Microsoft.PowerShell.PSConsoleReadLine];',
  "$zs = $zt.GetField('_singleton', [Reflection.BindingFlags]'NonPublic,Static').GetValue($null);",
  "$zd = $zt.GetField('_dispatchTable', [Reflection.BindingFlags]'NonPublic,Instance').GetValue($zs);",
  'foreach ($ze in $zd.GetEnumerator()) {',
  "if ($ze.Key.ToString() -eq 'Enter') {",
  "$zf = $ze.Value.GetType().GetField('ScriptBlock', [Reflection.BindingFlags]'Public,NonPublic,Instance');",
  'if ($zf) { $zx = $zf.GetValue($ze.Value); if ($zx -is [scriptblock]) { $global:__emeraldEnter = $zx; $zb = $true } }',
  '}',
  '}',
  '} catch { }',
  "} elseif ($zk -and $zk.Function -ne 'AcceptLine') { $global:__emeraldEnter = $zk.Function };",
  'if ($zb) {',
  'Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {',
  'param($key, $arg);',
  '$l = $null; $c = $null;',
  '[Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$l, [ref]$c);',
  "if ($l -and $l.Trim() -ne '') { [Console]::Write([char]27 + ']133;C' + [char]7) };",
  '$n = $global:__emeraldEnter;',
  'if ($n -is [scriptblock]) { & $n $key $arg }',
  'elseif ($n) { [Microsoft.PowerShell.PSConsoleReadLine]::$n($key, $arg) }',
  'else { [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine() }',
  '}',
  '}',
  '}',
].join(' ');

// M9 fix 624: Git Bash's rc, the same reports as the PowerShell wrapper's.
// The manager writes it to emerald.bashrc under the home before every Git
// Bash launch, and bash reads it with --rcfile. --rcfile is read only by an
// interactive non-login bash, so the rc does the login part itself, the way
// VS Code's bash integration does: /etc/profile, then the first of
// ~/.bash_profile, ~/.bash_login, ~/.profile. The hooks are set last, in
// front of a PROMPT_COMMAND or a PS0 the profile set, so those are kept
// rather than replaced.
// The prompt hook writes D with the code when a command ran since the last
// prompt, a bare D after an empty Enter, none at the first prompt; then A;
// then the folder through cygpath -w, run again only when $PWD moved, since
// a fork per prompt costs tens of ms under MSYS. It returns the code, so a
// profile's own PROMPT_COMMAND after it still reads $?.
// PS0 writes C as a command starts, and its arithmetic sets the ran flag in
// the shell itself (prompt expansion runs there; only $(...) forks). PS0 is
// not shown for an empty or blank line. It needs bash 4.4 or later (Git for
// Windows ships 5.x); an older bash writes no C and reads like cmd.
//
// Off Windows (M9 fix 1068) a plain bash row reads the same rc, written to
// the same file, with the folder taken from $PWD as it is, since there is
// no cygpath and no Windows spelling to make. A Mac's own /bin/bash is 3.2,
// with no PS0: it writes D (always bare, since the ran flag never sets), A
// and the folder, and no C, so its row reads like cmd's, folder and prompt
// but never running. zsh is the Mac's default and a Homebrew bash is 5.x.
export function bashRc(folder: 'cygpath' | 'pwd'): string {
  const folderLine = folder === 'cygpath'
    ? "  if [ \"$PWD\" != \"$__emerald_pwd\" ]; then __emerald_pwd=$PWD; __emerald_win=$(cygpath -w \"$PWD\"); fi"
    : "  if [ \"$PWD\" != \"$__emerald_pwd\" ]; then __emerald_pwd=$PWD; __emerald_win=$PWD; fi";
  return [
  "if [ -r /etc/profile ]; then . /etc/profile; fi",
  "for __emerald_f in ~/.bash_profile ~/.bash_login ~/.profile; do",
  "  if [ -r \"$__emerald_f\" ]; then . \"$__emerald_f\"; break; fi",
  "done",
  "unset __emerald_f",
  "__emerald_ran=0",
  "__emerald_first=1",
  "__emerald_pwd=",
  "__emerald_win=",
  "__emerald_prompt() {",
  "  local code=$?",
  "  if [ -n \"$__emerald_first\" ]; then __emerald_first=",
  "  elif [ \"$__emerald_ran\" = 1 ]; then printf '\\033]133;D;%s\\007' \"$code\"",
  "  else printf '\\033]133;D\\007'; fi",
  "  __emerald_ran=0",
  "  printf '\\033]133;A\\007'",
  folderLine,
  "  printf '\\033]9;9;\"%s\"\\033\\\\' \"$__emerald_win\"",
  "  return \"$code\"",
  "}",
  "PROMPT_COMMAND=\"__emerald_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}\"",
  "PS0='\\e]133;C\\a${__emerald_ran:0:$((__emerald_ran=1,0))}'\"$PS0\"",
  "",
  ].join('\n');
}

export const BASH_RC = bashRc('cygpath');

// M9 fix 1068: a zsh row's startup files, written to a folder of their own
// under the home (zshDirFor, beside emerald.bashrc) before every zsh launch
// with no args, and handed to zsh through ZDOTDIR. zsh reads .zshenv,
// .zprofile, .zshrc and .zlogin from $ZDOTDIR, so ours run in their place,
// each sourcing the user's own file of that name first with ZDOTDIR naming
// the user's folder, so a compinit dump or a plugin manager finds its own
// files. The user's folder comes in EMERALD_USER_ZDOTDIR, unset at once, or
// is $HOME when they had none. The user's .zshenv may move ZDOTDIR on (the
// common ~/.config/zsh setup), so .zshenv keeps the folder it left.
// The hooks are the bash rc's, through precmd and preexec: D with the code
// after a command, a bare D after an empty Enter, none at the first prompt;
// A; the folder as OSC 9;9; and C as a command starts. They go in front of
// the user's own (prepended), and the precmd returns the code, so a theme's
// precmd after it still reads $?. .zlogin is last for a login shell and
// gives the user's ZDOTDIR back ($HOME when they had none, which zsh reads
// the same); .zshrc gives it back for a non-login one. The HISTFILE line is
// for a Mac, whose /etc/zshrc sets HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history
// while ZDOTDIR is still ours. With these four present, zsh's new-user
// wizard never runs in a row, since it looks for startup files in $ZDOTDIR.
export const ZSH_FILES: Readonly<Record<'.zshenv' | '.zprofile' | '.zshrc' | '.zlogin', string>> = {
  '.zshenv': [
    '# .zshenv, written by emerald (M9 fix 1068)',
    '__emerald_zdotdir=$ZDOTDIR',
    '__emerald_user_zdotdir=${EMERALD_USER_ZDOTDIR:-$HOME}',
    'unset EMERALD_USER_ZDOTDIR',
    'if [[ $__emerald_user_zdotdir != $__emerald_zdotdir && -r $__emerald_user_zdotdir/.zshenv ]]; then',
    '  ZDOTDIR=$__emerald_user_zdotdir',
    '  . $__emerald_user_zdotdir/.zshenv',
    '  __emerald_user_zdotdir=$ZDOTDIR',
    '  ZDOTDIR=$__emerald_zdotdir',
    'fi',
    '',
  ].join('\n'),
  '.zprofile': [
    '# .zprofile, written by emerald (M9 fix 1068)',
    'if [[ $__emerald_user_zdotdir != $__emerald_zdotdir && -r $__emerald_user_zdotdir/.zprofile ]]; then',
    '  ZDOTDIR=$__emerald_user_zdotdir',
    '  . $__emerald_user_zdotdir/.zprofile',
    '  ZDOTDIR=$__emerald_zdotdir',
    'fi',
    '',
  ].join('\n'),
  '.zshrc': [
    '# .zshrc, written by emerald (M9 fix 1068)',
    'if [[ $__emerald_user_zdotdir != $__emerald_zdotdir && -r $__emerald_user_zdotdir/.zshrc ]]; then',
    '  ZDOTDIR=$__emerald_user_zdotdir',
    '  . $__emerald_user_zdotdir/.zshrc',
    '  ZDOTDIR=$__emerald_zdotdir',
    'fi',
    'if [[ $HISTFILE == $__emerald_zdotdir/.zsh_history ]]; then HISTFILE=$__emerald_user_zdotdir/.zsh_history; fi',
    '__emerald_ran=0',
    '__emerald_first=1',
    '__emerald_precmd() {',
    '  local code=$?',
    '  if [[ -n $__emerald_first ]]; then __emerald_first=',
    "  elif [[ $__emerald_ran = 1 ]]; then printf '\\033]133;D;%s\\007' \"$code\"",
    "  else printf '\\033]133;D\\007'; fi",
    '  __emerald_ran=0',
    "  printf '\\033]133;A\\007'",
    "  printf '\\033]9;9;\"%s\"\\033\\\\' \"$PWD\"",
    '  return $code',
    '}',
    "__emerald_preexec() { __emerald_ran=1; printf '\\033]133;C\\007'; }",
    'precmd_functions=(__emerald_precmd $precmd_functions)',
    'preexec_functions=(__emerald_preexec $preexec_functions)',
    'if [[ ! -o login ]]; then ZDOTDIR=$__emerald_user_zdotdir; fi',
    '',
  ].join('\n'),
  '.zlogin': [
    '# .zlogin, written by emerald (M9 fix 1068)',
    'if [[ $__emerald_user_zdotdir != $__emerald_zdotdir && -r $__emerald_user_zdotdir/.zlogin ]]; then',
    '  ZDOTDIR=$__emerald_user_zdotdir',
    '  . $__emerald_user_zdotdir/.zlogin',
    'fi',
    'ZDOTDIR=$__emerald_user_zdotdir',
    '',
  ].join('\n'),
};

// The folder a zsh row's ZDOTDIR names (M9 fix 1068): beside the bash rc,
// so <home>/emerald-zsh for the daemon and a test's temp folder in a test.
export function zshDirFor(bashrcPath: string): string {
  return path.join(path.dirname(bashrcPath), 'emerald-zsh');
}

// M9 fix 624: cmd's prompt, Windows Terminal's documented folder snippet
// plus the two marks: D (always bare, since PROMPT cannot carry the exit
// code) and A, then OSC 9;9 with the folder, each ended by ESC \ ($E\).
// cmd has no hook before a command, so it writes no C, and a cmd row's
// command stays null. An AutoRun in the registry that sets its own prompt
// wins over this one.
export const CMD_MARKS = '$E]133;D$E\\$E]133;A$E\\$E]9;9;$P$E\\';

// The PROMPT a cmd launch gets: the marks, then the prompt the daemon
// inherited, with a leading copy of the marks cut off (so a daemon started
// from inside a cmd row does not write them twice), or cmd's own $P$G when
// there is none.
export function cmdPrompt(inherited: string | undefined): string {
  let rest = inherited ?? '';
  if (rest.startsWith(CMD_MARKS)) rest = rest.slice(CMD_MARKS.length);
  return CMD_MARKS + (rest === '' ? '$P$G' : rest);
}

// Whether a folder is an emerald mod (M9 fix 833), read off its plugin
// manifest's name, as the mod's own .claude-plugin/plugin.json gives it;
// false on any read or parse error.
export function isEmeraldMod(dir: string): boolean {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')) as { name?: unknown };
    return manifest.name === 'emerald';
  } catch {
    return false;
  }
}

// The CLAUDE_CODE_PLUGIN_DIRS a shell gets (M9 fix 833): this daemon's mod
// first, then the inherited folders less any emerald mod among them. An
// inherited emerald mod is dropped for the reason isStrippedEnvKey drops
// EMERALD_*: a daemon started from inside an Emerald shell inherits the
// installed mod's folder, and its sessions would load two copies, both
// posting under the mod's one header, which the sink does not fold, so
// every mod event would land twice.
//
// Claude Code splits the variable on node's path.delimiter, so off Windows
// (M9 fix 1018) the list is joined by ':' (written as the literal, so a test
// on Windows can ask for it), and the compare is case-blind on darwin (APFS
// is case-insensitive by default) and exact on linux.
export function pluginDirs(
  modDir: string | null,
  inherited: string | undefined,
  isMod: (dir: string) => boolean = isEmeraldMod,
  platform: NodeJS.Platform = process.platform,
): string {
  const sep = platform === 'win32' ? ';' : ':';
  const fold = platform === 'linux' ? (p: string) => p : (p: string) => p.toLowerCase();
  const own = modDir === null ? null : fold(path.resolve(modDir));
  const kept = (inherited ?? '')
    .split(sep)
    .filter((dir) => dir !== '')
    .filter((dir) => fold(path.resolve(dir)) !== own && !isMod(dir));
  return (modDir === null ? kept : [modDir, ...kept]).join(sep);
}

// A plain shell session (M9 fix 624: the shell picked among the ones the
// daemon found at its start). PowerShell, pwsh or Windows PowerShell: with
// no args of its own the shell gets the prompt wrapper; -Command cannot be
// given twice, so a shell started with args keeps them and stays where it
// was spawned. A null shell, the type's fallback, is the PowerShell the
// launcher picked before the fix. Git Bash with no args reads the rc above
// (fix 505's Enter handler is PowerShell's alone), and with args runs them
// alone, as PowerShell keeps its; CHERE_INVOKING keeps an MSYS2 profile from
// moving to the home folder. cmd gets the PROMPT above with or without
// args, since a variable collides with no argument. Every shell names the
// emerald mod first in CLAUDE_CODE_PLUGIN_DIRS (M9 fix 833), so a claude
// typed into it loads the mod however it was typed.
//
// zsh and bash with no args of their own come up with the dev's PATH and
// prompt (M9 fix 1018) and report their commands and folder (M9 fix 1068):
// bash reads the rc above with --rcfile, which does the login reads itself,
// so no -l (and no CHERE_INVOKING, which is MSYS's); zsh runs as a login
// shell with ZDOTDIR naming the folder of ZSH_FILES, the user's own folder
// handed on in EMERALD_USER_ZDOTDIR. Both are interactive because stdin is
// the pty. sh runs bare and reports nothing, since dash has no hook before
// a command. With args each runs them alone, with no rc and no ZDOTDIR.
export class ShellLauncher implements SessionLauncher {
  private readonly bashrcPath: string;
  private readonly zshDir: string;
  private readonly modDir: string | null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;

  constructor(opts: { bashrcPath: string; modDir?: string | null; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform }) {
    this.bashrcPath = opts.bashrcPath;
    this.zshDir = zshDirFor(opts.bashrcPath);
    this.modDir = opts.modDir ?? null;
    this.env = opts.env ?? process.env;
    this.platform = opts.platform ?? process.platform;
  }

  // The mod's variable for a launch, or nothing with no mod.
  private modEnv(env: NodeJS.ProcessEnv): Record<string, string> {
    return this.modDir === null
      ? {}
      : { CLAUDE_CODE_PLUGIN_DIRS: pluginDirs(this.modDir, env['CLAUDE_CODE_PLUGIN_DIRS'], isEmeraldMod, this.platform) };
  }

  // `env` is the session's own (M9 fix 996): the mod's variable, cmd's
  // PROMPT and the fallback pwsh are read off it.
  command(extraArgs: string[], shell?: ShellOption | null, env: NodeJS.ProcessEnv = this.env): LaunchCommand {
    switch (shell?.id) {
      case 'gitbash':
        if (extraArgs.length > 0) return this.withMod({ file: shell.file, args: extraArgs }, env);
        return this.withMod({ file: shell.file, args: ['--rcfile', this.bashrcPath, '-i'], env: { CHERE_INVOKING: '1' } }, env);
      case 'cmd':
        return this.withMod({ file: shell.file, args: extraArgs, env: { PROMPT: cmdPrompt(env['PROMPT']) } }, env);
      case 'zsh': {
        if (extraArgs.length > 0) return this.withMod({ file: shell.file, args: extraArgs }, env);
        // The user's own ZDOTDIR, unless it is ours: a daemon started inside
        // an Emerald zsh row before its .zlogin gave the user's back.
        const user = env['ZDOTDIR'];
        const zshEnv: Record<string, string> = { ZDOTDIR: this.zshDir };
        if (user !== undefined && user !== '' && user !== this.zshDir) zshEnv['EMERALD_USER_ZDOTDIR'] = user;
        return this.withMod({ file: shell.file, args: ['-l'], env: zshEnv }, env);
      }
      case 'bash':
        if (extraArgs.length > 0) return this.withMod({ file: shell.file, args: extraArgs }, env);
        return this.withMod({ file: shell.file, args: ['--rcfile', this.bashrcPath, '-i'] }, env);
      case 'sh':
        return this.withMod({ file: shell.file, args: extraArgs }, env);
      default: {
        if (!shell && this.platform !== 'win32') return this.withMod({ file: '/bin/sh', args: extraArgs }, env);
        const file = shell?.file ?? findOnPath('pwsh.exe', env, this.platform) ?? 'powershell.exe';
        const args = extraArgs.length === 0 ? ['-NoExit', '-Command', PROMPT_WRAPPER] : extraArgs;
        return this.withMod({ file, args: ['-NoLogo', ...args] }, env);
      }
    }
  }

  // With no mod the command is as it was, so a launch's whole-object
  // compare holds.
  private withMod(cmd: LaunchCommand, env: NodeJS.ProcessEnv): LaunchCommand {
    const mod = this.modEnv(env);
    if (Object.keys(mod).length === 0) return cmd;
    return { ...cmd, env: { ...cmd.env, ...mod } };
  }
}
