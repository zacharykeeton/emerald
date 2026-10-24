// The pure parts of the empty pane (M9 fix 545): which kind starts by
// default, which folders are offered and in what order, the labels, and
// what a key in the empty box means. Covered by node:test; EmptyPane.tsx
// holds the state and the starts.

import { folderName } from '@emerald/shared';
import type { ShellId, ShellOption } from '@emerald/shared';
import type { SplitKind } from './pane-menu-model.ts';
import { normalizeFolder, RECENT_FOLDERS_MAX } from './new-session-model.ts';
import { normalizePath } from './files-model.ts';

export type EmptyKind = 'shell' | 'claude';

// The tiles Tab walks (M9 fix 666): the Browser tile is not a kind, since it
// starts on its click and has no folder, so it stays out of EmptyKind and
// the stored kind. The File tile (M9 fix 990) is the same: a pick with a
// path box, no kind.
export type EmptyTile = EmptyKind | 'browser' | 'file';

// The tile Tab (delta 1) or Shift+Tab (-1) lands on, in the order shell,
// claude, browser, file, wrapping at both ends; browser and file are each
// skipped when the daemon does not keep their view.
export function nextTile(tile: EmptyTile, delta: 1 | -1, has: { browser: boolean; file: boolean }): EmptyTile {
  const order: EmptyTile[] = ['shell', 'claude'];
  if (has.browser) order.push('browser');
  if (has.file) order.push('file');
  const at = order.indexOf(tile);
  return order[(Math.max(0, at) + delta + order.length) % order.length]!;
}

// A pasted path with its spaces and one pair of matching surrounding
// quotes taken off (M9 fix 990): Explorer's Copy as path adds the double
// ones. A lone quote stays, since it is not a pair.
export function cleanPath(raw: string): string {
  let out = raw.trim();
  if (out.length >= 2 && (out[0] === '"' || out[0] === "'") && out[out.length - 1] === out[0]) out = out.slice(1, -1).trim();
  return out;
}

// The file a cleaned path names (M9 fix 990): a drive or UNC path as it
// is, one leading separator on the folder's drive, anything else from the
// folder; then . dropped and .. folded, never past the root. null when
// there is nothing to read it from.
export function resolvePath(clean: string, folder: string | null): string | null {
  if (clean === '') return null;
  let full: string;
  if (/^[A-Za-z]:[\\/]/.test(clean) || /^[\\/]{2}/.test(clean)) full = clean;
  else if (/^[\\/]/.test(clean)) {
    if (folder === null || !/^[A-Za-z]:/.test(folder)) return null;
    full = folder.slice(0, 2) + clean;
  } else if (folder === null) return null;
  else full = `${folder}\\${clean}`;
  const unc = /^[\\/]{2}/.test(full);
  const parts = full.split(/[\\/]+/).filter((p) => p !== '');
  // The root's segments are never folded away: the drive, or the server
  // and share.
  const rootCount = unc ? 2 : 1;
  const out = parts.slice(0, rootCount);
  for (const p of parts.slice(rootCount)) {
    if (p === '.') continue;
    if (p === '..') {
      if (out.length > rootCount) out.pop();
      continue;
    }
    out.push(p);
  }
  if (unc) return normalizePath('\\\\' + out.join('\\'));
  return normalizePath(out.length === 1 ? out[0] + '\\' : out.join('\\'));
}

// The kind a fresh empty pane has selected: the split default when the
// person set one, else the kind last started from an empty pane, else a
// shell, which is what the filled New shell button used to be.
export function defaultKind(splitKind: SplitKind, stored: EmptyKind | null): EmptyKind {
  if (splitKind === 'shell' || splitKind === 'claude') return splitKind;
  return stored ?? 'shell';
}

export interface FolderRow {
  folder: string;
  note: 'split from here' | 'last used' | 'picked' | null;
}

// Row 1 is where a start here would go: the folder the pane was split
// from, else the last folder used, else home. A folder picked through
// Another folder goes above it. The rest of the recent list follows,
// each folder once whatever its case or slashes, cut at the recent
// list's own length so the digit keys never run past it.
export function folderRows({ split, recent, home, picked }: { split: string | null; recent: readonly string[]; home: string | null; picked: string | null }): FolderRow[] {
  const out: FolderRow[] = [];
  const seen = new Set<string>();
  const add = (folder: string, note: FolderRow['note']) => {
    const key = normalizeFolder(folder);
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    out.push({ folder, note });
  };
  if (picked !== null) add(picked, 'picked');
  if (split !== null) add(split, 'split from here');
  else if (recent[0] !== undefined) add(recent[0], 'last used');
  else if (home !== null) add(home, null);
  for (const f of recent) add(f, null);
  return out.slice(0, RECENT_FOLDERS_MAX);
}

// The folder's parent for the row's second column, home written as ~ and
// compared the way Windows compares paths; '' for a drive root, which has
// no parent to show.
export function parentLabel(folder: string, home: string | null): string {
  const trimmed = folder.trim().replace(/[\\/]+$/, '');
  if (folderName(trimmed) === '') return '';
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (cut < 0) return '';
  let parent = trimmed.slice(0, cut);
  if (/^[A-Za-z]:$/.test(parent)) parent += '\\';
  if (home !== null) {
    const h = normalizeFolder(home);
    const p = normalizeFolder(parent);
    if (h !== '' && p === h) return '~';
    if (h !== '' && p.startsWith(h + '\\')) return '~' + parent.slice(home.trim().replace(/[\\/]+$/, '').length);
  }
  return parent;
}

// The Start button's words: the kind, then the folder's name (the whole
// folder for a drive root). The tail is its own span so a narrow pane can
// drop it.
export function startLabel(kind: EmptyKind, folder: string, shell: ShellOption | null = null): { head: string; tail: string } {
  const name = folderName(folder);
  return { head: startHead(kind, shell), tail: ` in ${name === '' ? folder : name}` };
}

// A kind tile's title: what a double-click on it does and where (M9 fix
// 705), nothing with no folder row to start in.
export function tileTitle(folder: string | null): string | undefined {
  if (folder === null) return undefined;
  const name = folderName(folder);
  return `Double-click to start in ${name === '' ? folder : name}`;
}

// The head alone, for the form with no folder (M9 fix 647: a picked shell
// is named).
export function startHead(kind: EmptyKind, shell: ShellOption | null): string {
  if (kind === 'claude') return 'Start Claude';
  return shell === null ? 'Start shell' : `Start ${shell.label}`;
}

// The shell the Shell tile starts when it is not the daemon's default
// (M9 fix 647): the stored one when it is installed and is not the first
// reported. null means the default, so an uninstalled or default pick reads
// as no pick.
export function shellChoice(stored: ShellId | null, shells: readonly ShellOption[]): ShellOption | null {
  if (stored === null) return null;
  const found = shells.find((o) => o.id === stored);
  return found === undefined || found === shells[0] ? null : found;
}

// The Shell tile's sub-line.
export function shellSub(pick: ShellOption | null, shells: readonly ShellOption[]): string {
  if (pick === null || shells[0] === undefined) return 'your default shell, nothing else asked';
  return `${pick.label} in place of ${shells[0].label}`;
}

export type EmptyKeyAct = { act: 'start' } | { act: 'flip'; delta: 1 | -1 } | { act: 'row'; index: number } | { act: 'move'; delta: 1 | -1 } | { act: 'swallow' };

// What a key does in the empty pane's box while the box is empty. null is
// everything the box keeps as it always did (a letter, > for actions,
// Escape). A digit past the last row and the Enter variants that only
// mean something on a session row are swallowed, so nothing lands in the
// box and nothing starts.
export function emptyKey(ev: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }, rowCount: number): EmptyKeyAct | null {
  const plain = !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey;
  if (ev.key === 'Enter') {
    if (plain) return { act: 'start' };
    if (ev.shiftKey || ev.ctrlKey) return { act: 'swallow' };
    return null;
  }
  if (ev.key === 'Tab' && !ev.ctrlKey && !ev.altKey && !ev.metaKey) return { act: 'flip', delta: ev.shiftKey ? -1 : 1 };
  if (plain && /^[1-9]$/.test(ev.key)) {
    const index = Number(ev.key) - 1;
    return index < rowCount ? { act: 'row', index } : { act: 'swallow' };
  }
  if (plain && ev.key === 'ArrowDown') return { act: 'move', delta: 1 };
  if (plain && ev.key === 'ArrowUp') return { act: 'move', delta: -1 };
  return null;
}
