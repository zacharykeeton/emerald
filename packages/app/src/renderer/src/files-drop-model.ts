import type { MoveMode, MoveOutcome } from '../../preload/api.ts';
import { folderName, normalizePath, parentPath } from './files-model.ts';

// A drop from Explorer on the Files rail (M9 fix 953): where it lands,
// how, what the cursor shows and the note after. Pure, so node:test runs
// it.

export interface DropKeys {
  ctrl: boolean;
  shift: boolean;
}

// The rail's side of explorer-drop.ts, in client points.
export interface RailDrop {
  // sources: what a drag from the tree would move (M9 fix 1152), null for a drag from Explorer.
  over(x: number, y: number, keys: DropKeys, sources: readonly string[] | null): 'move' | 'copy' | 'none';
  leave(): void;
  drop(paths: string[], x: number, y: number, keys: DropKeys): void;
  // M9 fix 981: the folder a drop at the point would land in, or null when none is in view; a drag from the tree asks it before lighting anything.
  dirAt(x: number, y: number): string | null;
}

// The effect the hover answers with no key held. Main does the whole move
// or copy itself, so this only has to keep Explorer's hands off the
// source: answered `move`, Windows may leave the delete of the dragged
// files to Explorer the moment the drop returns, before the clash dialog
// has an answer. No reading of what Explorer does was taken by the second
// sitting (2026-10-20, `emerald-wt/probe-953.cjs` not run), so this is the
// safe `copy`: Explorer never deletes after a copy, main still moves on
// the same drive, and the cost is that the cursor shows a plus for a move
// too.
export const HOVER_MOVE_EFFECT: 'move' | 'copy' = 'copy';

// How long a drag held over a closed folder row waits before the folder opens (M9 fix 983), long enough that a drag crossing the tree opens nothing. The set-aside tab-strip entry of 2026-10-14 recommends the same number; if it lands it imports this one.
export const SPRING_OPEN_MS = 600;

// The folder a drag over the row would spring open: a closed folder row's
// path, else null. The rail's own folder has no row, so it never springs.
export function springDirFor(hit: { path: string; kind: 'dir' | 'file' } | null, expanded: ReadonlySet<string>): string | null {
  if (hit === null || hit.kind !== 'dir') return null;
  return expanded.has(normalizePath(hit.path)) ? null : hit.path;
}

// A folder row is that folder, a file row its folder, nothing under the
// point the rail's own folder.
export function dropDirFor(hit: { path: string; kind: 'dir' | 'file' } | null, root: string): string {
  if (hit === null) return root;
  return hit.kind === 'dir' ? hit.path : parentPath(hit.path);
}

// M9 fix 981: what a drag from the tree moves into dir: every path but one
// already in dir and the folder dir itself, compared case-insensitively on
// normalized paths. Empty means the drop does nothing and says nothing.
export function treeDropPaths(paths: readonly string[], dir: string): string[] {
  const key = (p: string) => normalizePath(p).toLowerCase();
  const into = key(dir);
  return paths.filter((p) => key(p) !== into && key(parentPath(p)) !== into);
}

// Explorer's keys: Ctrl copies, Shift moves, neither is the drive's rule.
// Both together copy, since no shortcut is ever made.
export function modeFor(keys: DropKeys): MoveMode {
  if (keys.ctrl) return 'copy';
  if (keys.shift) return 'move';
  return 'auto';
}

// The drive is unknown while the drag hovers (the data store is protected
// until the drop), so with no key the cursor shows HOVER_MOVE_EFFECT and
// a drop across drives copies, its note saying so.
export function hoverEffect(keys: DropKeys): 'move' | 'copy' {
  return keys.ctrl ? 'copy' : HOVER_MOVE_EFFECT;
}

// M9 fix 1152: the volume a path sits on, the renderer's twin of
// sameVolume's root in main/file-write.ts (a change to one is a change to
// both): a drive letter lower-cased with its colon, a share as
// \\server\share lower-cased, / for a Unix path, or null when the path
// names none (a relative path, a share missing its server or its share).
export function volumeRoot(p: string): string | null {
  const drive = /^([A-Za-z]):/.exec(p);
  if (drive !== null) return `${drive[1]!.toLowerCase()}:`;
  if (/^[\\/]{2}/.test(p)) {
    const [server, share] = p.slice(2).split(/[\\/]/);
    if (server === undefined || server === '' || share === undefined || share === '') return null;
    return `\\\\${server}\\${share}`.toLowerCase();
  }
  if (p.startsWith('/')) return '/';
  return null;
}

// M9 fix 1152: what a no-key drop of a tree drag's sources into dir does,
// mirroring main's auto mode (sameVolume in main/file-write.ts): move when
// every source shares dir's volume, copy when none does, null when they
// are mixed or a volume cannot be read, so the word falls to the rule.
export function treeEffect(sources: readonly string[], dir: string): 'move' | 'copy' | null {
  if (sources.length === 0) return null;
  const into = volumeRoot(dir);
  if (into === null) return null;
  let same = 0;
  for (const s of sources) {
    const root = volumeRoot(s);
    if (root === null) return null;
    if (root === into) same++;
  }
  if (same === sources.length) return 'move';
  if (same === 0) return 'copy';
  return null;
}

// M9 fix 1152: the word on the lit folder. A key held decides (modeFor's
// order, Ctrl first); with no key, the settled effect and the key that
// changes it, or the rule when the effect cannot be known (a drag from
// Explorer, whose paths are unreadable until the drop).
export function dropWord(keys: DropKeys, settled: 'move' | 'copy' | null): string {
  if (keys.ctrl) return 'Copy here';
  if (keys.shift) return 'Move here';
  if (settled === 'move') return 'Move here · Ctrl copies';
  if (settled === 'copy') return 'Copy here · Shift moves';
  return 'Ctrl copies, Shift moves';
}

// M9 fix 1152: the effect a drag from the tree shows on the rail, exact
// since pane-drag ignores it and main is not asked to settle it.
export function railEffect(keys: DropKeys, settled: 'move' | 'copy' | null): 'move' | 'copy' {
  if (keys.ctrl) return 'copy';
  if (keys.shift) return 'move';
  return settled ?? HOVER_MOVE_EFFECT;
}

// The corner note after a drop, its parts joined by `; `, or null when
// there is nothing to say.
export function moveNote(outcomes: readonly MoveOutcome[], folder: string): string | null {
  if (outcomes.length === 0) return null;
  if (outcomes.every((o) => o.result === 'here')) return `Already in ${folder}`;
  const name = (o: MoveOutcome) => folderName(o.from);
  const moved = outcomes.filter((o) => o.result === 'moved');
  const copied = outcomes.filter((o) => o.result === 'copied');
  // What a Cancel left out (M9 fix 1124) is one part of its own, kept out
  // of the skipped and refused lists.
  const cancelled = outcomes.filter((o) => o.cancelled === true);
  const skipped = outcomes.filter((o) => o.result === 'skipped' && o.cancelled !== true);
  const refused = outcomes.filter((o) => (o.result === 'refused' || o.result === 'inside') && o.cancelled !== true);
  const kept = outcomes.find((o) => o.sourceKept === true);
  const parts: string[] = [];
  const landed = moved.length + copied.length;
  if (moved.length > 0 && copied.length > 0) parts.push(`Moved ${moved.length} and copied ${copied.length} into ${folder}`);
  else if (moved.length === 1) parts.push(`Moved ${name(moved[0]!)} into ${folder}`);
  else if (moved.length > 1) parts.push(`Moved ${moved.length} items into ${folder}`);
  else if (copied.length === 1) parts.push(`Copied ${name(copied[0]!)} into ${folder}`);
  else if (copied.length > 1) parts.push(`Copied ${copied.length} items into ${folder}`);
  if (cancelled.length > 0) {
    const what = cancelled.length === 1 ? name(cancelled[0]!) : String(cancelled.length);
    parts.push(landed > 0 ? `cancelled, ${what} not copied` : `Cancelled: nothing copied into ${folder}`);
  }
  if (skipped.length > 0) {
    const what = skipped.length === 1 ? name(skipped[0]!) : String(skipped.length);
    parts.push(landed > 0 ? `skipped ${what}` : `Skipped ${what}: already in ${folder}`);
  }
  if (refused.length === 1) parts.push(`${name(refused[0]!)} could not go: ${refused[0]!.why ?? ''}`);
  else if (refused.length > 1) parts.push(`${refused.length} could not go, ${name(refused[0]!)}: ${refused[0]!.why ?? ''}`);
  if (kept !== undefined) parts.push(`${name(kept)}: copied, its original could not be removed`);
  return parts.length === 0 ? null : parts.join('; ');
}

// The copy note counts bytes when the files average over this (M9 fix 1123): a few big files move by bytes, many small ones by files.
export const BYTE_NOTE_MIN_AVERAGE = 50 * 1024 * 1024;

// A size in the note's words: bytes under a KB, else one decimal of the
// largest unit it reaches, no locale (72.0 MB, 1.2 GB).
export function byteSize(n: number): string {
  if (n < 1024) return `${n} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]!}`;
}

// The corner note while a drop's copy runs (M9 fix 1008); the final note
// is moveNote's.
export function copyingNote(done: number, total: number, folder: string, bytesDone = 0, bytesTotal = 0): string {
  if (total > 0 && bytesTotal / total > BYTE_NOTE_MIN_AVERAGE) return `Copying ${byteSize(bytesDone)} of ${byteSize(bytesTotal)} into ${folder}`;
  return `Copying ${done.toLocaleString()} of ${total.toLocaleString()} files into ${folder}`;
}
