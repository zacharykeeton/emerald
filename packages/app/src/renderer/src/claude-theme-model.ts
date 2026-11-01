// The note under a Claude pane's title when Claude Code's own theme and the
// pane's scheme disagree (M9 fix 1035). Pure, so the tests import it; the
// store and the band are claude-theme-store.ts and ClaudeThemeNote.tsx.
import type { ClaudeThemeKind } from '../../preload/api.ts';
import { isDark } from './monaco-theme-model.ts';

export type ThemePairing = 'dark-on-light' | 'light-on-dark' | 'unknown-on-light';

// The pairings dismissed on this profile, a JSON array of the strings above.
export const CLAUDE_THEME_NOTE_KEY = 'emerald.claudeThemeNote';

const PAIRINGS: readonly ThemePairing[] = ['dark-on-light', 'light-on-dark', 'unknown-on-light'];

const UNTIL_CHANGE = "Hide this note until Claude Code's theme changes";

export function claudeThemeNote(
  kind: ClaudeThemeKind | null,
  schemeBackground: string,
  dismissed: readonly ThemePairing[],
): { pairing: ThemePairing; words: string; dismissTitle: string } | null {
  const light = !isDark(schemeBackground);
  let note: { pairing: ThemePairing; words: string; dismissTitle: string } | null = null;
  if (kind === 'dark' && light) {
    note = { pairing: 'dark-on-light', words: 'Claude Code is drawing in its dark theme on this light scheme. Type /theme in the session and pick Light.', dismissTitle: UNTIL_CHANGE };
  } else if (kind === 'light' && !light) {
    note = { pairing: 'light-on-dark', words: 'Claude Code is drawing in its light theme on this dark scheme. Type /theme in the session and pick Dark.', dismissTitle: UNTIL_CHANGE };
  } else if (kind === 'unknown' && light) {
    note = {
      pairing: 'unknown-on-light',
      words: 'Claude Code draws in its own theme, which emerald could not read. If this pane is hard to read on a light scheme, type /theme in the session and pick Light.',
      dismissTitle: 'Hide this note for good',
    };
  }
  if (note === null || dismissed.includes(note.pairing)) return null;
  return note;
}

// A dismissal holds until Claude Code's theme changes: a read that no longer
// gives a pairing's theme forgets that pairing, so it shows again the next
// time the two disagree. The unreadable note's dismissal is for good, and an
// unreadable read says nothing about the theme, so it drops nothing. The same
// array comes back when nothing is dropped, so the caller can skip a write.
export function keepDismissals(dismissed: readonly ThemePairing[], kind: ClaudeThemeKind): readonly ThemePairing[] {
  let drop: readonly ThemePairing[];
  if (kind === 'light') drop = ['dark-on-light'];
  else if (kind === 'dark') drop = ['light-on-dark'];
  else if (kind === 'none') drop = ['dark-on-light', 'light-on-dark'];
  else return dismissed;
  if (!dismissed.some((p) => drop.includes(p))) return dismissed;
  return dismissed.filter((p) => !drop.includes(p));
}

export function parseDismissals(raw: string | null): ThemePairing[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ThemePairing[] = [];
    for (const p of parsed) {
      if (typeof p === 'string' && (PAIRINGS as readonly string[]).includes(p) && !out.includes(p as ThemePairing)) out.push(p as ThemePairing);
    }
    return out;
  } catch {
    return [];
  }
}
