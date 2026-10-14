import { rememberFolder } from './new-session-model.ts';

// The folders sessions were started in, most recent first, kept in
// localStorage. The daemon never sees this list: it is a convenience for
// the dialog's shortcuts and for "a new shell where I last was".

const RECENT_KEY = 'emerald.recentFolders';

export function loadRecent(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    return [];
  }
}

export function lastFolder(): string | null {
  return loadRecent()[0] ?? null;
}

export function rememberFolderUsed(folder: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(rememberFolder(loadRecent(), folder)));
  } catch {
    // Storage unavailable; the list just will not survive the restart.
  }
}
