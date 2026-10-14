import { useSyncExternalStore } from 'react';
import { normalizePath } from './files-model.ts';

// Where each open file's edits stand (M9 fix 248): unsaved, changed on
// disk under the edits, or refused at the last save. monaco.ts writes it
// as the models change and the tab strip, the file view and the close
// paths in ui.ts read it; it holds no Monaco so ui.ts can import it
// without pulling the editor into the store. Keyed by the normalized
// path the tabs use, and a file with nothing to say has no entry.
export interface FileEditState {
  // The model's text differs from what was last read or saved.
  dirty: boolean;
  // A read landed while the model was dirty and found other text on
  // disk than the last read or save; Reload or Keep mine clears it.
  conflict: boolean;
  // Why the last save was refused, until the next one lands.
  error: string | null;
}

export const CLEAN_EDIT: FileEditState = { dirty: false, conflict: false, error: null };

let states: ReadonlyMap<string, FileEditState> = new Map();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function editStateFor(path: string): FileEditState {
  return states.get(normalizePath(path)) ?? CLEAN_EDIT;
}

export function setEditState(path: string, patch: Partial<FileEditState>): void {
  const key = normalizePath(path);
  const prior = states.get(key) ?? CLEAN_EDIT;
  const next = { ...prior, ...patch };
  if (next.dirty === prior.dirty && next.conflict === prior.conflict && next.error === prior.error) return;
  const map = new Map(states);
  if (!next.dirty && !next.conflict && next.error === null) map.delete(key);
  else map.set(key, next);
  states = map;
  emit();
}

export function clearEditState(path: string): void {
  const key = normalizePath(path);
  if (!states.has(key)) return;
  const map = new Map(states);
  map.delete(key);
  states = map;
  emit();
}

export function isDirty(path: string): boolean {
  return editStateFor(path).dirty;
}

// The keys of every file with unsaved edits, for the strip's marks.
export function dirtyFiles(): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [key, s] of states) if (s.dirty) out.add(key);
  return out;
}

export function subscribeEdits(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ReadonlyMap<string, FileEditState> {
  return states;
}

export function useEditState(path: string): FileEditState {
  const map = useSyncExternalStore(subscribeEdits, snapshot);
  return map.get(normalizePath(path)) ?? CLEAN_EDIT;
}

export function useEditStates(): ReadonlyMap<string, FileEditState> {
  return useSyncExternalStore(subscribeEdits, snapshot);
}
