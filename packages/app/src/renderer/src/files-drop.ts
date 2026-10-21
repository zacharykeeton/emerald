import { useSyncExternalStore } from 'react';
import type { FileClash, MoveOutcome } from '../../preload/api.ts';
import { folderName, refusalWords, renamedPath, sessionInFolder } from './files-model.ts';
import { modeFor, moveNote } from './files-drop-model.ts';
import type { DropKeys } from './files-drop-model.ts';
import { dirtyFiles, isDirty } from './file-edits.ts';
import { dropFileSchemes, renameFileSchemes } from './file-scheme-store.ts';
import { endHandover, renameModels } from './monaco.ts';
import { editLayout, getState } from './store.ts';
import { deletedFilePanes, renameFilePanes } from './tabs-model.ts';
import { closeFileTabsUnder, flashCornerNote, renameFileTabs } from './ui.ts';
import { recordUse } from './use-record.ts';

// A drop from Explorer on the Files rail (M9 fix 953): main moves or
// copies, a taken name asks, and what was open follows, in finishRename's
// order.

export type ClashChoice = 'replace' | 'skip' | 'cancel';

// A clash the drop will not replace whatever the answer, with the words
// why, as the rail's Delete refuses (FilesRail.tsx's trashOf).
export interface HeldClash extends FileClash {
  held: string | null;
}

export interface ClashAsk {
  dir: string;
  clashes: readonly HeldClash[];
  answer(choice: ClashChoice): void;
}

// One ask at a time, for MoveClashDialog. Nothing touches window at
// import.
let ask: ClashAsk | null = null;
const listeners = new Set<() => void>();

function setAsk(next: ClashAsk | null): void {
  ask = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useClashAsk(): ClashAsk | null {
  return useSyncExternalStore(subscribe, () => ask);
}

function heldOf(c: FileClash): string | null {
  if (c.there === 'dir' && sessionInFolder(c.to, getState().sessions.values())) return refusalWords('in-use', true);
  if (c.there === 'file' && isDirty(c.to)) return 'Unsaved edits in a tab: save or discard them first';
  if (c.there === 'dir' && [...dirtyFiles()].some((key) => renamedPath(key, c.to, c.to) !== null)) return 'A file under it has unsaved edits in a tab: save or discard them first';
  return null;
}

function askClashes(dir: string, clashes: readonly HeldClash[]): Promise<ClashChoice> {
  // A second drop while the dialog is up cancels the first.
  ask?.answer('cancel');
  return new Promise((resolve) => {
    const mine: ClashAsk = {
      dir,
      clashes,
      answer: (choice) => {
        if (ask === mine) setAsk(null);
        resolve(choice);
      },
    };
    setAsk(mine);
  });
}

export async function dropIntoFolder(paths: readonly string[], dir: string, keys: DropKeys): Promise<MoveOutcome[]> {
  if (paths.length === 0) return [];
  const mode = modeFor(keys);
  let answer = await window.emerald.files.move([...paths], dir, mode, null);
  if ('refused' in answer) {
    flashCornerNote(`Could not drop into ${folderName(dir)}: ${answer.refused}`);
    return [];
  }
  if ('clashes' in answer) {
    const clashes = answer.clashes.map((c) => ({ ...c, held: heldOf(c) }));
    const choice = clashes.every((c) => c.held !== null) ? 'skip' : await askClashes(dir, clashes);
    if (choice === 'cancel') return [];
    const replace = choice === 'replace' ? clashes.filter((c) => c.held === null).map((c) => c.from) : [];
    answer = await window.emerald.files.move([...paths], dir, mode, replace);
    if ('refused' in answer) {
      flashCornerNote(`Could not drop into ${folderName(dir)}: ${answer.refused}`);
      return [];
    }
    // The second pass never asks; a clash it answers is a bug in main.
    if ('clashes' in answer) return [];
  }
  const outcomes = answer.done;
  for (const o of outcomes) {
    if (o.replaced === true) {
      dropFileSchemes(o.to);
      closeFileTabsUnder(o.to);
      void editLayout((l) => deletedFilePanes(l, o.to)).catch((err: unknown) => console.warn('[emerald] closing the file panes after a delete failed', err));
    }
    if (o.result === 'moved') {
      // finishRename's pinned order: the models before the tabs, the file
      // panes last (M9 fix 591).
      const handed = renameModels(o.from, o.to);
      renameFileSchemes(o.from, o.to);
      renameFileTabs(o.from, o.to);
      void editLayout((l) => renameFilePanes(l, o.from, o.to)).catch((err: unknown) => {
        console.warn('[emerald] moving the file panes after a drop failed', err);
        endHandover(handed);
      });
    }
  }
  const note = moveNote(outcomes, folderName(dir));
  if (note !== null) flashCornerNote(note);
  recordUse('drop-move-files');
  return outcomes;
}
