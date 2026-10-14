// The crosshair's floating readout (M9 fix 251): the axis readout at the
// strip's foot is out of sight on a strip taller than the pane, so the
// same words follow the pointer as a small card beside the line at the
// pointer's y. Pure: where the card goes and what its lane line says.

import type { ActivitySession } from '@emerald/shared';
import { clockTime } from '@emerald/shared';
import { spanTitle } from './activity-titles.ts';

// The gap between the line and the card, and the card's type: one line
// of the readout's 9px mono at 12px, 2px of padding above and below
// (3px at the sides), a 1px edge, and about 5.6px per character, a
// touch over Cascadia's advance so the estimate errs wide and the flip
// comes early rather than late. The height is exact (M9 fix 262), since
// the up flip puts the card's bottom at the gap over the pointer.
export const CROSS_CARD_GAP = 6;
export const CROSS_CARD_LINE = 12;
export const CROSS_CARD_PAD = 3;
export const CROSS_CARD_PAD_Y = 2;
export const CROSS_CARD_CHAR = 5.6;

export interface CrossCardPlace {
  side: 'right' | 'left';
  // One of the two is set: a right-side card is placed by its left edge
  // and a left-side one by its right edge, so the edge nearest the line
  // sits at the gap whatever the card's true width; the estimate only
  // decides the side and the clamp.
  left: number | null;
  right: number | null;
  top: number;
  // Under the pointer by default; above it (M9 fix 262) in the last
  // rows, where a card under it would land on the tick row.
  flip: 'down' | 'up';
}

// The card's box from its lines: the longest line sets the width.
export function crossCardSize(lines: readonly string[]): { width: number; height: number } {
  const chars = lines.reduce((m, l) => Math.max(m, l.length), 0);
  return { width: Math.ceil(chars * CROSS_CARD_CHAR) + 2 * CROSS_CARD_PAD + 2, height: lines.length * CROSS_CARD_LINE + 2 * CROSS_CARD_PAD_Y + 2 };
}

// Right of the line by default, left of it within the last fifth of the
// width or where the right side would run past the edge; the top just
// under the pointer, and (M9 fix 262) the card's bottom kept above
// `floor`, the tick row's top (the tracks' height; the box's height
// when absent), so the axis readout under it stays readable: in the
// last rows the card flips above the pointer, its bottom at the gap
// over it, and where neither fits it is clamped to the floor. A card
// that fits on neither side sits at the left edge. A box whose floor
// is shorter than the card (the one-lane strip) gets no card at all,
// null; the caller puts the lane's words on the axis readout instead.
// `x` and `y` are pixels inside the box.
export function crossCard(x: number, y: number, box: { width: number; height: number; floor?: number }, card: { width: number; height: number }): CrossCardPlace | null {
  const floor = box.floor ?? box.height;
  if (floor < card.height) return null;
  const rightFits = x + CROSS_CARD_GAP + card.width <= box.width;
  const leftFits = x - CROSS_CARD_GAP - card.width >= 0;
  const side: CrossCardPlace['side'] = x >= box.width * 0.8 || !rightFits ? 'left' : 'right';
  const down = Math.max(0, y + CROSS_CARD_GAP);
  const up = Math.min(y - CROSS_CARD_GAP, floor) - card.height;
  const [top, flip]: [number, CrossCardPlace['flip']] = down + card.height <= floor ? [down, 'down'] : up >= 0 ? [up, 'up'] : [Math.max(0, floor - card.height), 'down'];
  if (side === 'right') return { side, left: x + CROSS_CARD_GAP, right: null, top, flip };
  if (leftFits) return { side, left: null, right: box.width - (x - CROSS_CARD_GAP), top, flip };
  return { side, left: 0, right: null, top, flip };
}

// Whether the axis readout, centred on the line at `x`, has room for the
// lane's words as a third piece (M9 fix 262, the strip too short for a
// card): the joined text at the card's character estimate, its padding
// on each side, kept inside the box on both sides of the line.
export function readoutHasRoom(x: number, width: number, text: string, lane: string): boolean {
  const half = (Math.ceil(`${text} · ${lane}`.length * CROSS_CARD_CHAR) + 2 * CROSS_CARD_PAD) / 2;
  return x - half >= 0 && x + half <= width;
}

// The track under a y, or null off the tracks (the band above them, the
// tick row under them).
export function trackAt(y: number, tracks: number, rowHeight: number): number | null {
  if (y < 0 || tracks === 0) return null;
  const i = Math.floor(y / rowHeight);
  return i < tracks ? i : null;
}

// The words for the lane under the pointer at the crossed instant: the
// session on the track that was doing something then, its span through
// spanTitle's wording on one line with the prompt cut to its first
// words, a waiting stretch by its kind; a track with nobody at that
// instant, or no track at all, reads `nothing here`.
export const NOTHING_HERE = 'nothing here';
const PROMPT_WORDS = 6;

export function crossLane(track: readonly ActivitySession[] | null, at: number, parentNames: ReadonlyMap<string, string | null>): { text: string; sessionId: string | null } {
  if (track === null) return { text: NOTHING_HERE, sessionId: null };
  for (const s of track) {
    const span = s.spans.find((p) => p.from <= at && at < p.to);
    if (span !== undefined) {
      const title = spanTitle(s, { from: span.from, prompt: span.prompt === null ? null : firstWords(span.prompt) }, span.to, parentNames.get(s.sessionId));
      return { text: title.split('\n').join(' · '), sessionId: s.sessionId };
    }
  }
  for (const s of track) {
    const d = (s.debt ?? []).find((p) => p.from <= at && at < p.to);
    if (d !== undefined) {
      const name = s.name ?? 'a session no longer listed';
      const what = d.kind === 'asked' ? 'asked, waiting on you' : 'done, unread';
      return { text: `${name} · ${what} · ${clockTime(d.from)} to ${clockTime(d.to)}`, sessionId: s.sessionId };
    }
  }
  return { text: NOTHING_HERE, sessionId: null };
}

function firstWords(prompt: string): string {
  const words = prompt.trim().split(/\s+/);
  return words.length > PROMPT_WORDS ? `${words.slice(0, PROMPT_WORDS).join(' ')}…` : words.join(' ');
}
