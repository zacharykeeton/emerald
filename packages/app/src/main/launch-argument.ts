import path from 'node:path';

// A launch with a path on its command line (M9 fixes 342 and 853): a file
// from Explorer's Open with (a double-click on a .md or .json once the
// installer has registered emerald as an opener, or `Emerald.exe notes.md`
// by hand), or a folder from its Open in Emerald (Claude) and Open in
// Emerald (shell) items, which carry --open-claude or --open-shell before
// the folder. The path is the first plain argument after the app's own:
// Electron's and the installer's switches start with a dash
// (--remote-debugging-port, --user-data-dir, --updated), and the dev build
// is `electron <main.js> [path]`, so its own path is the first plain
// argument there. A quoted path ending in a backslash, which a drive root
// from %V always is, reaches argv with the backslash eating the closing
// quote ("C:\" arrives as C:"), so a trailing quote is read back as the
// backslash it was.
//
// Every launch asks for the single-instance lock (keyed on the profile, so
// a harness window never meets another script's); a launch with a path
// that does not get it hands the path to the holder as second-instance
// data and quits at once, while a launch with no path goes on to a window
// of its own either way, since a second window is what a second plain
// launch has always given. A bare folder with no flag is such a plain
// launch: the menu's command always carries a flag, and a shortcut or a
// script passing a bare folder is left as it was.

export const OPEN_CLAUDE_FLAG = '--open-claude';
export const OPEN_SHELL_FLAG = '--open-shell';

export type LaunchKind = 'file' | 'claude' | 'shell';
export interface LaunchArgument {
  path: string;
  kind: LaunchKind;
}

export function launchArgument(
  argv: readonly string[],
  packaged: boolean,
  stat: (p: string) => { isFile(): boolean; isDirectory(): boolean } | null,
): LaunchArgument | null {
  const plain = argv.slice(1).filter((a) => !a.startsWith('-'));
  let candidate = plain[packaged ? 0 : 1];
  if (candidate === undefined) return null;
  if (candidate.endsWith('"')) candidate = `${candidate.slice(0, -1)}\\`;
  const p = path.resolve(candidate);
  const s = stat(p);
  if (s === null) return null;
  const kind = argv.includes(OPEN_CLAUDE_FLAG) ? 'claude' : argv.includes(OPEN_SHELL_FLAG) ? 'shell' : null;
  if (kind !== null) return s.isDirectory() ? { path: p, kind } : null;
  return s.isFile() ? { path: p, kind: 'file' } : null;
}

// The path as the main log names it: the file alone, or the folder with
// the kind of session it opens.
export function launchLabel(arg: LaunchArgument): string {
  return arg.kind === 'file' ? arg.path : `${arg.path} (${arg.kind})`;
}
