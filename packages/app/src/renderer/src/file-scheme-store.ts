import { useSyncExternalStore } from 'react';
import { normalizePath, renamedPath } from './files-model.ts';
import { onOtherWindowWrite } from './other-window.ts';

// A file's own colour scheme (M9 fix 340): the document of a file tab or
// a file pane takes the ground and the foreground of a scheme picked for
// that file, so a file stands out from the terminals around it. The
// pick is by path, kept in localStorage under emerald.fileSchemes as a
// list of [path, scheme name] pairs, oldest first, capped so a year of
// picks does not grow without bound; a tab's view and a pane's both
// follow it, since both read by path. The pure part (the list's moves)
// is apart from the storage so node:test covers it; the scheme's colours
// come from scheme-store.ts, which holds the list the main process read.

export const FILE_SCHEMES_KEY = 'emerald.fileSchemes';
// How many files keep a pick; the oldest goes when one more comes.
export const FILE_SCHEMES_CAP = 50;

export type FileSchemeEntry = readonly [path: string, scheme: string];

// The list with a pick set (moved to the newest end, so a file picked
// again outlives the ones between) or cleared; a pick over the cap
// drops the oldest.
export function withFileScheme(entries: readonly FileSchemeEntry[], path: string, scheme: string | null, cap = FILE_SCHEMES_CAP): readonly FileSchemeEntry[] {
  const key = normalizePath(path).toLowerCase();
  const kept = entries.filter(([p]) => p.toLowerCase() !== key);
  if (scheme === null) return kept.length === entries.length ? entries : kept;
  const next = [...kept, [normalizePath(path), scheme] as const];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// The list after the rail renames a file or a folder (M9 fix 574): a pick
// on the file, or on any file under the folder, follows it. The list
// itself comes back when nothing moved.
export function renamedSchemes(entries: readonly FileSchemeEntry[], from: string, to: string): readonly FileSchemeEntry[] {
  let moved = false;
  const next = entries.map((e): FileSchemeEntry => {
    const p = renamedPath(e[0], from, to);
    if (p === null || p === e[0]) return e;
    moved = true;
    return [p, e[1]];
  });
  return moved ? next : entries;
}

// The list after the rail deletes a file or a folder (M9 fix 617): a pick
// on the file, or on any file under the folder, goes. The list itself
// comes back when nothing was dropped.
export function deletedSchemes(entries: readonly FileSchemeEntry[], path: string): readonly FileSchemeEntry[] {
  const kept = entries.filter((e) => renamedPath(e[0], path, path) === null);
  return kept.length === entries.length ? entries : kept;
}

export function fileSchemeOf(entries: readonly FileSchemeEntry[], path: string): string | null {
  const key = normalizePath(path).toLowerCase();
  const hit = entries.find(([p]) => p.toLowerCase() === key);
  return hit === undefined ? null : hit[1];
}

// The stored form back into the list, anything malformed dropped.
export function parseFileSchemes(raw: string | null): readonly FileSchemeEntry[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: FileSchemeEntry[] = [];
    for (const item of parsed) {
      if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'string' && item[0] !== '' && item[1] !== '') out.push([item[0], item[1]]);
    }
    return out;
  } catch {
    return [];
  }
}

let entries: readonly FileSchemeEntry[] = load();
const listeners = new Set<() => void>();

function load(): readonly FileSchemeEntry[] {
  try {
    return parseFileSchemes(localStorage.getItem(FILE_SCHEMES_KEY));
  } catch {
    return [];
  }
}

// What is stored now (M9 fix 926), the base each pick builds on so another
// window's picks stay; this window's own list when the read throws, so a
// page with no storage keeps its picks for the session.
function fresh(): readonly FileSchemeEntry[] {
  try {
    return parseFileSchemes(localStorage.getItem(FILE_SCHEMES_KEY));
  } catch {
    return entries;
  }
}

function save(): void {
  try {
    if (entries.length === 0) localStorage.removeItem(FILE_SCHEMES_KEY);
    else localStorage.setItem(FILE_SCHEMES_KEY, JSON.stringify(entries));
  } catch {
    // The picks just will not survive the restart.
  }
}

export function getFileScheme(path: string): string | null {
  return fileSchemeOf(entries, path);
}

// A name sets the file's pick; null clears it (the menu's Window's
// scheme).
export function setFileScheme(path: string, scheme: string | null): void {
  const base = fresh();
  const next = withFileScheme(base, path, scheme);
  if (next === base) return;
  entries = next;
  save();
  for (const l of listeners) l();
}

// The rail's rename (M9 fix 574), in setFileScheme's shape.
export function renameFileSchemes(from: string, to: string): void {
  const base = fresh();
  const next = renamedSchemes(base, from, to);
  if (next === base) return;
  entries = next;
  save();
  for (const l of listeners) l();
}

// The rail's delete (M9 fix 617), in renameFileSchemes' shape.
export function dropFileSchemes(path: string): void {
  const base = fresh();
  const next = deletedSchemes(base, path);
  if (next === base) return;
  entries = next;
  save();
  for (const l of listeners) l();
}

export function subscribeFileSchemes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): readonly FileSchemeEntry[] {
  return entries;
}

export function useFileScheme(path: string): string | null {
  const list = useSyncExternalStore(subscribeFileSchemes, snapshot);
  return fileSchemeOf(list, path);
}

// Another window of the profile wrote it (M9 fix 926): this window takes
// it as it lands, so it shows the same and its next write does not put the
// old value back.
onOtherWindowWrite(FILE_SCHEMES_KEY, () => {
  entries = load();
  for (const l of listeners) l();
});
