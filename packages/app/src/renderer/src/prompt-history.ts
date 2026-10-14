import type { SavedPrompt } from '@emerald/shared';

// M56: what the prompt box's arrows cycle. The saved prompts come from
// the daemon (one list for every window and the CLI); the recent ones
// are this window's, the last few sent from the box, in localStorage.

export const RECENT_PROMPTS_MAX = 20;
const RECENT_KEY = 'emerald.recentPrompts';

export interface HistoryEntry {
  // The saved prompt's name, shown as the hint; null for a recent one.
  name: string | null;
  text: string;
}

// The saved prompts first, in the daemon's order, then the recent ones,
// newest first; a recent one whose text a saved one already has is left
// out, so the same line is not met twice.
export function historyEntries(saved: readonly SavedPrompt[], recent: readonly string[]): HistoryEntry[] {
  const texts = new Set(saved.map((p) => p.text));
  const entries: HistoryEntry[] = saved.map((p) => ({ name: p.name, text: p.text }));
  for (const text of recent) {
    if (texts.has(text)) continue;
    texts.add(text);
    entries.push({ name: null, text });
  }
  return entries;
}

// The list with text at the front and any earlier copy of it gone, cut
// to the cap.
export function rememberRecent(recent: readonly string[], text: string): string[] {
  return [text, ...recent.filter((t) => t !== text)].slice(0, RECENT_PROMPTS_MAX);
}

// Where the arrows land: -1 is the line being typed, 0 the first entry.
// Up goes deeper into the list and stops at its end; down comes back
// and stops at the typed line.
export function stepHistory(index: number, delta: -1 | 1, length: number): number {
  if (length === 0) return -1;
  return Math.max(-1, Math.min(length - 1, index + delta));
}

export function loadRecentPrompts(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberPromptSent(text: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(rememberRecent(loadRecentPrompts(), text)));
  } catch {
    // Storage unavailable; the list just will not survive the restart.
  }
}
