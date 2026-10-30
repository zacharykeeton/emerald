import type { FileEntry } from '../../preload/api.ts';
import { relativePath } from './files-model.ts';

// M9 fix 1006: a drag from the Files tree that reaches no pane (a picked
// set, or a folder) says so when it is released on one, and the set's
// right-click menu copies every picked path.
export type TreeRefusal = 'set' | 'folder';

export const SET_REFUSED_NOTE = 'A pane takes one file at a time; drop the set on a folder';
export const FOLDER_REFUSED_NOTE = 'A folder opens in no pane; drop it on a folder in the tree';

// count is the paths the press drags. A lone file under an old daemon has
// no pane payload either and stays silent, as before.
export function treeRefusal(count: number, kind: FileEntry['kind'] | undefined): TreeRefusal | null {
  if (count > 1) return 'set';
  if (count === 1 && kind === 'dir') return 'folder';
  return null;
}

export function refusalNote(r: TreeRefusal): string {
  return r === 'set' ? SET_REFUSED_NOTE : FOLDER_REFUSED_NOTE;
}

// The menu item that copies a picked set's paths, one per line in the
// set's order, whole or relative to the tree's root.
export function setCopy(paths: readonly string[], root: string, relative: boolean): { label: string; title: string; text: string } {
  const n = paths.length;
  return {
    label: relative ? `Copy ${n} relative paths` : `Copy ${n} paths`,
    title: relative ? `The ${n} picked paths relative to the tree's root, one per line` : `The ${n} picked paths, one per line`,
    text: paths.map((p) => (relative ? relativePath(root, p) : p)).join('\n'),
  };
}
