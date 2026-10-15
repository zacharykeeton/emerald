// The pure parts of the empty pane (M9 fix 545): which kind starts by
// default, which folders are offered and in what order, the labels, and
// what a key in the empty box means. Covered by node:test; EmptyPane.tsx
// holds the state and the starts.

import { folderName } from '@emerald/shared';
import type { ShellId, ShellOption } from '@emerald/shared';
import type { SplitKind } from './pane-menu-model.ts';
import { normalizeFolder, RECENT_FOLDERS_MAX } from './new-session-model.ts';

export type EmptyKind = 'shell' | 'claude';

// The tiles Tab walks (M9 fix 666): the Browser tile is not a kind, since it
// starts on its click and has no folder, so it stays out of EmptyKind and
// the stored kind.
export type EmptyTile = EmptyKind | 'browser';

// The tile Tab (delta 1) or Shift+Tab (-1) lands on, in the order shell,
// claude, browser, wrapping at both ends; browser is skipped when the
// daemon does not keep the kind.
export function nextTile(tile: EmptyTile, delta: 1 | -1, browser: boolean): EmptyTile {
  const order: EmptyTile[] = browser ? ['shell', 'claude', 'browser'] : ['shell', 'claude'];
  const at = order.indexOf(tile);
  return order[(Math.max(0, at) + delta + order.length) % order.length]!;
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
