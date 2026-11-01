// Claude Code's theme as the window last read it, and the notes dismissed on
// this profile (M9 fix 1035). Read at the first Claude pane's mount, on every
// window focus (a /theme pick in a session, then a click back into emerald)
// and when a Claude session starts; a Dismiss in one window reaches the
// others through the storage event.
import { useSyncExternalStore } from 'react';
import type { ClaudeThemeKind } from '../../preload/api.ts';
import { CLAUDE_THEME_NOTE_KEY, keepDismissals, parseDismissals } from './claude-theme-model.ts';
import type { ThemePairing } from './claude-theme-model.ts';

export interface ClaudeThemeState {
  // null until the first answer, and after a read that threw: no note.
  kind: ClaudeThemeKind | null;
  dismissed: readonly ThemePairing[];
}

let state: ClaudeThemeState | null = null;
let inFlight: Promise<void> | null = null;
let wired = false;
const listeners = new Set<() => void>();

function readStored(): ThemePairing[] {
  try {
    return parseDismissals(localStorage.getItem(CLAUDE_THEME_NOTE_KEY));
  } catch {
    return [];
  }
}

function current(): ClaudeThemeState {
  state ??= { kind: null, dismissed: readStored() };
  return state;
}

function setState(next: ClaudeThemeState): void {
  state = next;
  for (const l of listeners) l();
}

function writeStored(dismissed: readonly ThemePairing[]): void {
  try {
    localStorage.setItem(CLAUDE_THEME_NOTE_KEY, JSON.stringify(dismissed));
  } catch {
    // A denied store keeps the dismissal for this page alone.
  }
}

// A refresh asked while a read is out shares it, then reads once more after
// it, since the file may have changed after that read began (a /theme pick
// landing as the window takes focus).
let again = false;

export function refreshClaudeTheme(): void {
  if (inFlight !== null) {
    again = true;
    return;
  }
  inFlight = window.emerald
    .claudeTheme()
    .then(
      (r) => {
        const was = current();
        const dismissed = keepDismissals(was.dismissed, r.kind);
        if (dismissed !== was.dismissed) writeStored(dismissed);
        if (r.kind !== was.kind || dismissed !== was.dismissed) setState({ kind: r.kind, dismissed });
      },
      () => {
        // A read that threw is kept as no answer, so no note.
        if (current().kind !== null) setState({ ...current(), kind: null });
      },
    )
    .finally(() => {
      inFlight = null;
      if (again) {
        again = false;
        refreshClaudeTheme();
      }
    });
}

export function dismissClaudeThemeNote(p: ThemePairing): void {
  const was = current();
  if (was.dismissed.includes(p)) return;
  const dismissed = [...was.dismissed, p];
  writeStored(dismissed);
  setState({ ...was, dismissed });
}

function onStorage(e: StorageEvent): void {
  if (e.key !== CLAUDE_THEME_NOTE_KEY && e.key !== null) return;
  setState({ ...current(), dismissed: readStored() });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  if (!wired) {
    wired = true;
    window.addEventListener('focus', refreshClaudeTheme);
    window.addEventListener('storage', onStorage);
    refreshClaudeTheme();
  }
  return () => {
    listeners.delete(l);
  };
}

export function useClaudeThemeNote(): ClaudeThemeState {
  return useSyncExternalStore(subscribe, current);
}

// For the tests: forget the read, the dismissals and the listeners.
export function resetClaudeTheme(): void {
  if (wired && typeof window !== 'undefined') {
    window.removeEventListener('focus', refreshClaudeTheme);
    window.removeEventListener('storage', onStorage);
  }
  wired = false;
  state = null;
  inFlight = null;
  again = false;
  listeners.clear();
}
