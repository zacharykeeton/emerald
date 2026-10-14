// Which blocks of the commit graph draw lanes (M72). The rule the user
// set: the rows are the log and never change; a filter acts on the
// gutter alone, and a block whose lines are hidden takes no column
// while its commits stay in the rows. Three readings, in this order:
// a solo, one block alone, when the graph holds it; else the mode,
// `all` or `active` (a session with a sidebar row, which is a record
// the daemon still lists, so history blocks and the grey block are not
// active); and the hidden set taken away from either. A solo or a
// hidden id the graph does not hold is ignored rather than emptying
// it, since the prefs are one set for every repository and a session
// hidden in one is nowhere in another. Pure, so the panel and the
// tests read the same thing.

export type DrawMode = 'all' | 'active';

export interface DrawPrefs {
  draw: DrawMode;
  // Block keys (commit-graph-model.ts's blockKey: a session id, or
  // `outside` for the grey block).
  hidden: readonly string[];
  solo: string | null;
}

export function drawnBlocks(prefs: DrawPrefs, blocks: readonly string[], live: ReadonlySet<string>): Set<string> {
  if (prefs.solo !== null && blocks.includes(prefs.solo)) return new Set([prefs.solo]);
  const hidden = new Set(prefs.hidden);
  const out = new Set<string>();
  for (const key of blocks) {
    if (hidden.has(key)) continue;
    if (prefs.draw === 'active' && !live.has(key)) continue;
    out.add(key);
  }
  return out;
}

// What the header's chip reads: `some` while a solo or a hidden id the
// graph holds is in force, else the mode.
export function drawState(prefs: DrawPrefs, blocks: readonly string[]): DrawMode | 'some' {
  if (prefs.solo !== null && blocks.includes(prefs.solo)) return 'some';
  if (prefs.hidden.some((h) => blocks.includes(h))) return 'some';
  return prefs.draw;
}

// The prefs after a toggle of one block's lines: hidden when drawn,
// drawn again when hidden. Hiding the block a solo shows drops the
// solo, else the solo would keep drawing it; showing a block again
// under a solo drops the solo too, since the solo was what hid it.
export function toggleLines(prefs: DrawPrefs, key: string, drawn: boolean): DrawPrefs {
  if (drawn) return { ...prefs, hidden: [...prefs.hidden.filter((h) => h !== key), key], solo: prefs.solo === key ? null : prefs.solo };
  return { ...prefs, hidden: prefs.hidden.filter((h) => h !== key), solo: null };
}

// The prefs after Show only this: one block alone.
export function soloLines(prefs: DrawPrefs, key: string): DrawPrefs {
  return { ...prefs, solo: key };
}

// The prefs after a click on the `some` chip: everything back.
export function clearLines(prefs: DrawPrefs): DrawPrefs {
  return { ...prefs, draw: 'all', hidden: [], solo: null };
}
