import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { SkillListing, SkillOverridesChange, SkillOverridesRead } from '../../preload/api.ts';
import { changeNote, effectiveListing, scopeValues } from './listing-model.ts';

// The listing switch's state (M9 fix 1042): each folder's skillOverrides
// as last read, the last change with its note and Undo, and the last
// refusal. One store for the window, so the rail's Context tab and a
// context pane on the same folder show the same values and the same note.
// The note stays while anything shows a folder's skills: when the last
// user of every folder unmounts (the tab and every pane closed), the
// change and the error are forgotten, with no wiring by the caller.

export interface ListingNote {
  // The folder the change was made from, as the caller named it.
  folder: string;
  change: SkillOverridesChange;
  note: string;
}

export interface ListingError {
  folder: string;
  text: string;
}

const reads = new Map<string, SkillOverridesRead>();
const users = new Map<string, number>();
let lastChange: ListingNote | null = null;
let lastError: ListingError | null = null;
// A fresh object on every change, so useSyncExternalStore sees one.
let noteSnapshot: { change: ListingNote | null; error: ListingError | null } = { change: null, error: null };
const listeners = new Set<() => void>();

function emit(): void {
  noteSnapshot = { change: lastChange, error: lastError };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function refreshListing(folder: string): Promise<void> {
  try {
    reads.set(folder, await window.emerald.skillOverrides.read(folder));
  } catch (err) {
    lastError = { folder, text: message(err) };
  }
  emit();
}

// One write of every name to one value in one scope; a menu pick is one
// name, the group button the group's.
export async function setListing(folder: string, scope: 'local' | 'user', names: readonly string[], value: SkillListing | null): Promise<void> {
  try {
    const result = await window.emerald.skillOverrides.write(
      folder,
      scope,
      names.map((name) => ({ name, value })),
    );
    if (result.ok) {
      reads.set(folder, result.change.read);
      lastChange = { folder, change: result.change, note: changeNote(result.change.edits, scope) };
      lastError = null;
    } else {
      lastError = { folder, text: result.error };
      lastChange = null;
    }
  } catch (err) {
    lastError = { folder, text: message(err) };
    lastChange = null;
  }
  emit();
}

export async function undoListingChange(): Promise<void> {
  const last = lastChange;
  if (last === null) return;
  try {
    const result = await window.emerald.skillOverrides.undo(last.change.id);
    if (result.ok) {
      reads.set(last.folder, result.read);
      lastError = null;
    } else {
      lastError = { folder: last.folder, text: `Undo refused: ${result.error}` };
    }
  } catch (err) {
    lastError = { folder: last.folder, text: `Undo refused: ${message(err)}` };
  }
  // Either way the Undo button goes: done, or refused and not offered again.
  lastChange = null;
  emit();
}

function acquire(folder: string): void {
  const n = users.get(folder) ?? 0;
  users.set(folder, n + 1);
  if (n === 0) void refreshListing(folder);
}

function release(folder: string): void {
  const n = (users.get(folder) ?? 1) - 1;
  if (n > 0) users.set(folder, n);
  else users.delete(folder);
  if (users.size === 0 && (lastChange !== null || lastError !== null)) {
    lastChange = null;
    lastError = null;
    emit();
  }
}

// The folder's read (null until the first answer) and each skill's
// effective value. Mounting it reads the folder on its first user.
export function useListing(folder: string): { read: SkillOverridesRead | null; effective(name: string): SkillListing } {
  const read = useSyncExternalStore(
    subscribe,
    useCallback(() => reads.get(folder) ?? null, [folder]),
  );
  useEffect(() => {
    acquire(folder);
    return () => release(folder);
  }, [folder]);
  const effective = useCallback((name: string) => effectiveListing(scopeValues(read, name)).value, [read]);
  return useMemo(() => ({ read, effective }), [read, effective]);
}

export function useListingNote(): { change: ListingNote | null; error: ListingError | null } {
  return useSyncExternalStore(subscribe, () => noteSnapshot);
}
