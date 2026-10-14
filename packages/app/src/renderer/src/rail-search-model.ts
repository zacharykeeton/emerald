import type { SearchMode } from '../../preload/api.ts';
import { normalizePath } from './files-model.ts';

// The pure part of the rail's search settings (M27), with no DOM so
// node:test can cover it. The mode (names or contents) and the scope (the
// folder a Find in folder narrowed the search to) used to live in the
// rail's component state and went with a reload; now they are kept in
// ui.ts and persisted, so they need a shape to read back and a rule for
// when a kept scope still makes sense.

export type { SearchMode };

export interface SearchSettings {
  mode: SearchMode;
  // Absolute path of the scoped folder, or null for the whole tree.
  scope: string | null;
}

export function defaultSearchSettings(): SearchSettings {
  return { mode: 'names', scope: null };
}

// What was stored, or the default for anything unusable: a reload is not
// worth breaking the rail over.
export function searchSettingsFromJson(raw: unknown): SearchSettings {
  if (typeof raw !== 'object' || raw === null) return defaultSearchSettings();
  const r = raw as Record<string, unknown>;
  const mode: SearchMode = r['mode'] === 'contents' ? 'contents' : 'names';
  const scope = typeof r['scope'] === 'string' && r['scope'] !== '' ? normalizePath(r['scope']) : null;
  return { mode, scope };
}

// A scope is only meaningful while the tree's root is above it: a cd out
// of the folder, or a reload that comes back on another session, drops
// it. With no root yet (the layout has not arrived) nothing is known, so
// the scope is kept for the root that follows.
export function scopeUnder(scope: string | null, root: string | null): string | null {
  if (scope === null || root === null) return scope;
  const base = normalizePath(root).toLowerCase();
  const prefix = base.endsWith('\\') ? base : `${base}\\`;
  return normalizePath(scope).toLowerCase().startsWith(prefix) ? scope : null;
}
