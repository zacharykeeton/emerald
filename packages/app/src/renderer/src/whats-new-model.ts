// The pure part of the What's New tab (M9 fix 227), with no DOM so
// node:test can cover it. The app's version string never moves between
// builds (0.1.0 in both package.json files), so the stamp that says
// which build a person has already seen the notes of is the notes file's
// own newest section heading: the docs commit of every batch writes a
// new `## Fixes N to M, date` at the top, the renderer keeps the heading
// it last showed in localStorage, and a start whose file heads with
// another one opens the tab once.

export const WHATS_NEW_SEEN_KEY = 'emerald.whatsNewSeen';

// The first `## ` heading of the file, its text trimmed; null for a
// file with no section (an empty file, or one that is not the notes),
// which opens nothing.
export function whatsNewStamp(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m !== null) return m[1]!;
  }
  return null;
}

// Whether the tab opens on its own at this start: a newest heading the
// profile has not seen. `seen` is what localStorage holds, null on a
// fresh profile, which is exactly the reader the tab is for.
export function shouldOpenWhatsNew(stamp: string | null, seen: string | null): boolean {
  return stamp !== null && stamp !== seen;
}
