import type { MoveMode, MoveOutcome } from '../../preload/api.ts';
import { folderName, parentPath } from './files-model.ts';

// A drop from Explorer on the Files rail (M9 fix 953): where it lands,
// how, what the cursor shows and the note after. Pure, so node:test runs
// it.

export interface DropKeys {
  ctrl: boolean;
  shift: boolean;
}

// The rail's side of explorer-drop.ts, in client points.
export interface RailDrop {
  over(x: number, y: number, keys: DropKeys): 'move' | 'copy' | 'none';
  leave(): void;
  drop(paths: string[], x: number, y: number, keys: DropKeys): void;
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

// A folder row is that folder, a file row its folder, nothing under the
// point the rail's own folder.
export function dropDirFor(hit: { path: string; kind: 'dir' | 'file' } | null, root: string): string {
  if (hit === null) return root;
  return hit.kind === 'dir' ? hit.path : parentPath(hit.path);
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

// The corner note after a drop, its parts joined by `; `, or null when
// there is nothing to say.
export function moveNote(outcomes: readonly MoveOutcome[], folder: string): string | null {
  if (outcomes.length === 0) return null;
  if (outcomes.every((o) => o.result === 'here')) return `Already in ${folder}`;
  const name = (o: MoveOutcome) => folderName(o.from);
  const moved = outcomes.filter((o) => o.result === 'moved');
  const copied = outcomes.filter((o) => o.result === 'copied');
  const skipped = outcomes.filter((o) => o.result === 'skipped');
  const refused = outcomes.filter((o) => o.result === 'refused' || o.result === 'inside');
  const kept = outcomes.find((o) => o.sourceKept === true);
  const parts: string[] = [];
  const landed = moved.length + copied.length;
  if (moved.length > 0 && copied.length > 0) parts.push(`Moved ${moved.length} and copied ${copied.length} into ${folder}`);
  else if (moved.length === 1) parts.push(`Moved ${name(moved[0]!)} into ${folder}`);
  else if (moved.length > 1) parts.push(`Moved ${moved.length} items into ${folder}`);
  else if (copied.length === 1) parts.push(`Copied ${name(copied[0]!)} into ${folder}`);
  else if (copied.length > 1) parts.push(`Copied ${copied.length} items into ${folder}`);
  if (skipped.length > 0) {
    const what = skipped.length === 1 ? name(skipped[0]!) : String(skipped.length);
    parts.push(landed > 0 ? `skipped ${what}` : `Skipped ${what}: already in ${folder}`);
  }
  if (refused.length === 1) parts.push(`${name(refused[0]!)} could not go: ${refused[0]!.why ?? ''}`);
  else if (refused.length > 1) parts.push(`${refused.length} could not go, ${name(refused[0]!)}: ${refused[0]!.why ?? ''}`);
  if (kept !== undefined) parts.push(`${name(kept)}: copied, its original could not be removed`);
  return parts.length === 0 ? null : parts.join('; ');
}
