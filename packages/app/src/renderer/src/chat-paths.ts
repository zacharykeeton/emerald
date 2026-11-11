import { normalizePath } from './files-model.ts';
import { pathLinkParts, pathLinksIn } from './path-links.ts';

// M9 fix 716: the paths the chat view links, with no DOM so node:test
// can cover it. An inline code span in a reply is a path candidate when
// it reads like one (a separator or a file extension, no spaces, no
// glob or shell characters), with an optional :line or :line:column
// tail; it is linked only when it resolves inside the session's folder
// and a stat says it is a file there. A picture's path is linked wherever
// it resolves, in a code span or bare in the text (M9 fix 864). Since M9
// fix 1099 an absolute drive path that stats as a file links wherever it
// appears too: a code span, bare text, a fenced block and the prompt
// bubble; since M9 fix 1135 the prompt bubble links a relative path or an
// @ mention too, resolved in the session's folder as a reply's code span
// is; elsewhere a relative path keeps the rules above, and a UNC path stays
// plain (resolveIn refuses one).

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

// M9 fix 1099: a path that names its drive, which links wherever it
// appears once a stat says it is a file.
export function isDrivePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p);
}

export interface DrivePathLink {
  start: number;
  end: number;
  text: string;
  abs: string;
  line: number | null;
}

// Every drive path in a run of text, found by the terminal's own rule
// (path-links.ts), with its :N line when it has one.
export function drivePathsIn(text: string): DrivePathLink[] {
  const out: DrivePathLink[] = [];
  for (const link of pathLinksIn(text)) {
    const parts = pathLinkParts(link.text);
    if (!isDrivePath(parts.path)) continue;
    const abs = resolveIn('', parts.path);
    if (abs === null) continue;
    out.push({ start: link.start, end: link.end, text: link.text, abs, line: parts.line ?? null });
  }
  return out;
}

export type PromptPart = { text: string; path: string | null; line: number | null };

// The prompt bubble's text split into plain runs and the paths `known` says
// are files: a drive path wherever it points, a relative one or an @ mention
// (its @ dropped to resolve, kept in the link's text) inside cwd (M9 fix
// 1135); each path not yet statted is asked once.
export function promptParts(text: string, cwd: string, known: (abs: string) => 'file' | 'other' | undefined): { parts: PromptPart[]; ask: string[] } {
  const parts: PromptPart[] = [];
  const ask: string[] = [];
  let at = 0;
  for (const link of pathLinksIn(text)) {
    const bare = link.text.startsWith('@') ? link.text.slice(1) : link.text;
    const lp = pathLinkParts(bare);
    const abs = isDrivePath(lp.path) ? resolveIn('', lp.path) : folderPath(cwd, lp.path);
    if (abs === null) continue;
    const kind = known(abs);
    if (kind === undefined && !ask.includes(abs)) ask.push(abs);
    if (kind !== 'file') continue;
    if (link.start > at) parts.push({ text: text.slice(at, link.start), path: null, line: null });
    parts.push({ text: link.text, path: abs, line: lp.line ?? null });
    at = link.end;
  }
  if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at), path: null, line: null });
  return { parts, ask };
}
