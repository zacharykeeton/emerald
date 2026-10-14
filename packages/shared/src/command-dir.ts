// The folder a Bash or PowerShell command ran in (M58, M61): a commit
// made by `cd ../emerald-wt/x && git commit`, `Set-Location ../wt/x; git
// commit` or `git -C ../wt/x commit` lands in that folder, not the
// session's cwd, so HEAD has to be read there. Only the leading folder
// change (before `&&` or `;`) and a `-C` on the first git call are read;
// anything else is the cwd the hook reported. No node:path, since the
// renderer's tests import shared too.

// The tools whose command can move a repository's HEAD (M9 fix 106): on
// this machine Claude Code reaches for its PowerShell tool for git as
// often as for Bash, and both hand the command over as tool_input.command.
export const HEAD_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell']);

const ABSOLUTE = /^([a-zA-Z]:)?[\\/]/;
// The leading folder change: Bash's cd, and PowerShell's Set-Location,
// Push-Location and their aliases, with or without -Path (fix 106).
const CHANGE_DIR = /^(?:cd|chdir|sl|pushd|Set-Location|Push-Location)\s+(?:-(?:Literal)?Path\s+)?("[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)/i;

function unquote(s: string): string {
  const m = /^(['"])(.*)\1$/.exec(s);
  return m === null ? s : m[2]!;
}

// Git Bash spells a Windows folder `/c/Users/x` and WSL `/mnt/c/Users/x`
// (M9 fix 107): on a Windows cwd such a target is that drive, since no
// folder of that name exists on the drive itself. A bare `/tmp` is left
// alone. `~` is the home when the caller knows it, else the cwd, which
// at least exists.
const MSYS = /^\/(?:mnt\/)?([a-zA-Z])(?=[\\/]|$)/;
const WINDOWS_CWD = /^[a-zA-Z]:/;

function fromMsys(cwd: string, dir: string): string {
  const m = MSYS.exec(dir);
  if (m === null || !WINDOWS_CWD.test(cwd)) return dir;
  const rest = dir.slice(m[0].length).replace(/\//g, '\\');
  return `${m[1]!.toUpperCase()}:${rest === '' ? '\\' : rest}`;
}

// A path joined onto cwd with `.` and `..` segments folded, keeping the
// separator style of cwd. An absolute dir is returned as given, a Git
// Bash one in Windows form.
export function resolveDir(cwd: string, dir: string, home?: string): string {
  if (dir === '~' || /^~[\\/]/.test(dir)) return home === undefined ? cwd : resolveDir(home, dir.slice(2), home);
  if (ABSOLUTE.test(dir)) return fromMsys(cwd, dir);
  const sep = cwd.includes('\\') ? '\\' : '/';
  const parts = cwd.split(/[\\/]/);
  const head = parts[0] ?? '';
  const body = parts.slice(1).filter((p) => p !== '');
  for (const seg of dir.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      body.pop();
      continue;
    }
    body.push(seg);
  }
  return [head, ...body].join(sep);
}

export function commandDir(command: string, cwd: string, home?: string): string {
  const text = command.trimStart();
  const cd = CHANGE_DIR.exec(text);
  if (cd !== null) return resolveDir(cwd, unquote(cd[1]!), home);
  const c = /\bgit\s+(?:--no-optional-locks\s+)?-C\s+("[^"]*"|'[^']*'|[^\s;&|]+)/.exec(text);
  if (c !== null) return resolveDir(cwd, unquote(c[1]!), home);
  return cwd;
}
