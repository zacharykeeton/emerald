import { normalizePath } from './files-model.ts';

// M9 fix 716: the paths the chat view links, with no DOM so node:test
// can cover it. An inline code span in a reply is a path candidate when
// it reads like one (a separator or a file extension, no spaces, no
// glob or shell characters), with an optional :line or :line:column
// tail; it is linked only when it resolves inside the session's folder
// and a stat says it is a file there.

// The stat answers are kept for the window's life, so a reply re-read on
// every transcript change never stats the same path twice; the map is
// dropped whole past this many entries rather than kept in order.
export const PATH_CACHE_MAX = 2000;

const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const LINE_RE = /:(\d+)(?::\d+)?$/;
const EXT_RE = /\.[A-Za-z0-9]{1,8}$/;

export function pathCandidate(code: string): { rel: string; line: number | null } | null {
  const text = code.trim();
  if (text === '' || text.length > 260 || /\s/.test(text) || URL_RE.test(text) || text.startsWith('-') || /[*?"<>|]/.test(text)) return null;
  const m = LINE_RE.exec(text);
  const rel = m === null ? text : text.slice(0, m.index);
  const line = m === null ? null : Number(m[1]);
  if (rel === '') return null;
  if (!/[\\/]/.test(rel) && !EXT_RE.test(rel)) return null;
  return { rel, line };
}

// A path as a reply or a tool row names it, made absolute against the
// session's folder: a drive path is only normalized, anything else is
// joined to cwd with its . and .. segments resolved. A UNC form is
// refused as markdown-url.ts refuses one (M9 fix 478); a link's ? or #
// tail goes and its percent-escapes are decoded first.
export function resolveIn(cwd: string, p: string): string | null {
  let path = p;
  const tail = path.search(/[?#]/);
  if (tail >= 0) path = path.slice(0, tail);
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (path === '' || /^[\\/]{2}/.test(path)) return null;
  if (/^[A-Za-z]:[\\/]/.test(path)) return collapse(normalizePath(path));
  if (cwd === '') return null;
  return collapse(normalizePath(`${cwd}\\${path}`));
}

// The . and .. segments of an absolute drive path resolved, never past
// the drive's root.
function collapse(abs: string): string {
  const parts = abs.split('\\');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(part);
  }
  const joined = out.join('\\');
  return /^[A-Za-z]:$/.test(joined) ? `${joined}\\` : joined;
}

// M9 fix 717: the menu a right click on a path opens, the Files rail's
// own labels and tooltips (FilesRail.tsx) in its order, with Mention in
// the message between the openers and Copy path. A separator is a rule
// above its item; the title of Copy path is the path itself.
export type PathAction = 'tab' | 'pane' | 'windows' | 'reveal' | 'mention' | 'copy';
export const PATH_MENU: { action: PathAction; label: string; title?: string; hint?: string; separator?: boolean }[] = [
  { action: 'tab', label: 'Open in a tab', title: 'A tab of its own, kept when the next file is clicked' },
  { action: 'pane', label: 'Open in a pane', title: 'The file beside the focused pane, in the layout with the shells' },
  { action: 'windows', label: 'Open with Windows', title: 'Open with the program Windows has for it' },
  { action: 'reveal', label: 'Reveal in Explorer' },
  { action: 'mention', label: 'Mention in the message', title: 'Add the path to the message, as @ does', hint: '@', separator: true },
  { action: 'copy', label: 'Copy path', separator: true },
];

// The case-blind prefix test relativePath (files-model.ts) makes.
export function insideFolder(cwd: string, abs: string): boolean {
  if (cwd === '') return false;
  const base = normalizePath(cwd);
  const prefix = base.endsWith('\\') ? base : `${base}\\`;
  return normalizePath(abs).toLowerCase().startsWith(prefix.toLowerCase());
}

// A path a reply names, made absolute in the session's folder, or null when it resolves outside it (M9 fix 756): the rule a reply's code span and its relative link share.
export function folderPath(cwd: string, rel: string): string | null {
  const abs = resolveIn(cwd, rel);
  return abs !== null && insideFolder(cwd, abs) ? abs : null;
}
