// M9 fix 357: a file path a session prints is a link (Pane.tsx), the
// way a URL is since fix 204. What counts as a path is what a compiler,
// a test runner, git or a listing prints: a Windows absolute path (a
// drive letter, a colon and a separator), a relative one holding at
// least one separator, or a bare name ending in an extension a repo has,
// any of them followed by `:<line>` and `:<line>:<column>` the way tsc
// and node print them. A token starts after whitespace, a quote, a
// bracket, a comma or an `=` (`--file=src/a.ts`) and ends before any of
// those, and a period on its end is the sentence's, not the path's. A
// URL never matches: its `//` follows a colon, and a colon ends a token.
// Pure, so the tests read every form without a terminal.
const STOP = String.raw`\s"'\`()\[\]{}<>,=`;
// The longer of a pair first (tsx before ts), since the alternation
// takes the first that fits and the boundary after it would then fail.
const EXTENSIONS = 'tsx|ts|jsx|js|mjs|cjs|json|mdx|md|txt|css|html|htm|yml|yaml|ps1|py|cs|sql|xml|toml|ini|log|sh|rs|go|java';
const LINE = String.raw`(?::\d+(?::\d+)?)?`;

export const pathLinkPattern = new RegExp(
  String.raw`(?<=^|[${STOP}])(?:[A-Za-z]:[\\/][^${STOP}:]*|(?:[^${STOP}:\\/]+[\\/])+[^${STOP}:\\/]*|[^${STOP}:\\/]+\.(?:${EXTENSIONS})(?=$|[${STOP}:]))${LINE}`,
);

export interface PathLink {
  text: string;
  // The string indices, start inclusive and end exclusive.
  start: number;
  end: number;
}

// Every path token in a line of text, in order; a trailing period is
// left out of the token, so `see src/a.ts.` links `src/a.ts`.
export function pathLinksIn(text: string): PathLink[] {
  const re = new RegExp(pathLinkPattern.source, 'g');
  const out: PathLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let token = m[0];
    while (token.endsWith('.')) token = token.slice(0, -1);
    if (token.length === 0 || /^[\\/]+$/.test(token)) continue;
    out.push({ text: token, start: m.index, end: m.index + token.length });
  }
  return out;
}

export interface PathLinkParts {
  path: string;
  line: number | undefined;
  column: number | undefined;
}

// The path and the place in it: `src/a.ts:12:5` is line 12, column 5;
// `src/a.ts:12` is line 12; a plain path has neither.
export function pathLinkParts(text: string): PathLinkParts {
  const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(text);
  if (m === null || m[1] === undefined || m[1] === '') return { path: text, line: undefined, column: undefined };
  // A drive root alone (`C:`) is the whole token, not a path and a line.
  if (/^[A-Za-z]$/.test(m[1])) return { path: text, line: undefined, column: undefined };
  return {
    path: m[1],
    line: m[2] === undefined ? undefined : Number(m[2]),
    column: m[3] === undefined ? undefined : Number(m[3]),
  };
}

// Whether the path names a place of its own or one under a folder.
export function isAbsolutePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

// M9 fix 423: a path can wrap at the pane's edge, xterm's own wrap (no
// space at the break), the way @xterm/addon-web-links's own line walk
// follows it: up while the row itself continues the one above, down
// while the next row continues this one, each capped at four rows so one
// hover never walks the whole scrollback. A minimal buffer shape, so the
// walk is tested without a terminal.
export const WRAP_ROW_CAP = 4;

export interface WrapLine {
  readonly isWrapped: boolean;
  readonly length: number;
  getCell(x: number): { getWidth(): number; getChars(): string } | undefined;
}

export interface WrapBuffer {
  getLine(y: number): WrapLine | undefined;
}

export interface JoinedChar {
  // The row and cell (both 0-based) a joined character sits in.
  y: number;
  x: number;
}

export interface JoinedLine {
  text: string;
  cellOf: JoinedChar[];
}

// The text of the row at 0-based `y0` joined with the rows its wrap
// continues from and into, and, for each of its characters, the row and
// cell it sits in.
export function joinWrappedRows(buffer: WrapBuffer, y0: number): JoinedLine {
  let top = y0;
  for (let steps = 0; steps < WRAP_ROW_CAP; steps++) {
    const line = buffer.getLine(top);
    if (line === undefined || !line.isWrapped) break;
    top -= 1;
  }
  let bottom = y0;
  for (let steps = 0; steps < WRAP_ROW_CAP; steps++) {
    const next = buffer.getLine(bottom + 1);
    if (next === undefined || !next.isWrapped) break;
    bottom += 1;
  }
  let text = '';
  const cellOf: JoinedChar[] = [];
  for (let y = top; y <= bottom; y++) {
    const line = buffer.getLine(y);
    if (line === undefined) continue;
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (cell === undefined) break;
      const w = cell.getWidth();
      if (w === 0) continue;
      const chars = cell.getChars() || ' ';
      for (let i = 0; i < chars.length; i++) cellOf.push({ y, x });
      text += chars;
    }
  }
  return { text, cellOf };
}

// The path as the file system would find it from the session's folder:
// an absolute one with its separators made Windows', a relative one
// joined under the folder with `.` and `..` walked. The folder is the
// shell's reported cwd or the session's spawn folder (Pane.tsx).
export function resolvePathLink(cwd: string, p: string): string {
  const base = isAbsolutePath(p) ? p : `${cwd}\\${p}`;
  const unc = base.startsWith('\\\\') || base.startsWith('//');
  const parts = base.split(/[\\/]+/).filter((s) => s !== '');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      // Never above the drive.
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(part);
  }
  const joined = out.join('\\');
  if (unc) return `\\\\${joined}`;
  // A drive root keeps its separator (`C:\`).
  return out.length === 1 && /^[A-Za-z]:$/.test(joined) ? `${joined}\\` : joined;
}

// M9 fix 653: a folder is a link too. The hover's title says where a
// Ctrl+click goes, and the click's route is read off the stat's kind and
// the keys: a folder opens in Explorer with or without Shift, a file
// opens in a file pane beside the pane since M9 fix 864 (a tab on a
// daemon too old for a file pane, `beside` false), or with Shift is
// shown selected in its folder; no Ctrl, no link.
export function pathLinkTitle(full: string, kind: 'file' | 'dir', beside: boolean): string {
  if (kind === 'dir') return `Ctrl+click opens ${full} in Explorer`;
  return beside ? `Ctrl+click opens ${full} in a pane beside` : `Ctrl+click opens ${full}`;
}

// M9 fix 863: a URL's hover says where a Ctrl+click goes, a browser pane
// beside when the daemon can hold one and fix 204's text when not.
export function urlLinkTitle(uri: string, beside: boolean): string {
  return beside ? `Ctrl+click opens ${uri} in a pane beside` : `Ctrl+click opens ${uri}`;
}

export type PathLinkAction = 'beside' | 'tab' | 'reveal' | 'open-folder';

export function pathLinkAction(kind: 'file' | 'dir', keys: { ctrlKey: boolean; shiftKey: boolean }, beside: boolean): PathLinkAction | null {
  if (!keys.ctrlKey) return null;
  if (kind === 'dir') return 'open-folder';
  if (keys.shiftKey) return 'reveal';
  return beside ? 'beside' : 'tab';
}
