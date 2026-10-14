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
export const BASH_RC = [
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
  "  if [ \"$PWD\" != \"$__emerald_pwd\" ]; then __emerald_pwd=$PWD; __emerald_win=$(cygpath -w \"$PWD\"); fi",
  "  printf '\\033]9;9;\"%s\"\\033\\\\' \"$__emerald_win\"",
  "  return \"$code\"",
  "}",
  "PROMPT_COMMAND=\"__emerald_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}\"",
  "PS0='\\e]133;C\\a${__emerald_ran:0:$((__emerald_ran=1,0))}'\"$PS0\"",
  "",
].join('\n');

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

// A plain shell session (M9 fix 624: the shell picked among the ones the
// daemon found at its start). PowerShell, pwsh or Windows PowerShell: with
// no args of its own the shell gets the prompt wrapper; -Command cannot be
// given twice, so a shell started with args keeps them and stays where it
// was spawned. A null shell, the type's fallback, is the PowerShell the
// launcher picked before the fix. Git Bash with no args reads the rc above
// (fix 505's Enter handler is PowerShell's alone), and with args runs them
// alone, as PowerShell keeps its; CHERE_INVOKING keeps an MSYS2 profile from
// moving to the home folder. cmd gets the PROMPT above with or without
// args, since a variable collides with no argument.
export class ShellLauncher implements SessionLauncher {
  private readonly bashrcPath: string;

  constructor(opts: { bashrcPath: string }) {
    this.bashrcPath = opts.bashrcPath;
  }

  command(extraArgs: string[], shell?: ShellOption | null): LaunchCommand {
    switch (shell?.id) {
      case 'gitbash':
        if (extraArgs.length > 0) return { file: shell.file, args: extraArgs };
        return { file: shell.file, args: ['--rcfile', this.bashrcPath, '-i'], env: { CHERE_INVOKING: '1' } };
      case 'cmd':
        return { file: shell.file, args: extraArgs, env: { PROMPT: cmdPrompt(process.env['PROMPT']) } };
      default: {
        const file = shell?.file ?? findOnPath('pwsh.exe') ?? 'powershell.exe';
        const args = extraArgs.length === 0 ? ['-NoExit', '-Command', PROMPT_WRAPPER] : extraArgs;
        return { file, args: ['-NoLogo', ...args] };
      }
    }
  }
}
