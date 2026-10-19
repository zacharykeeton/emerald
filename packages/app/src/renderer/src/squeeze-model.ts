// The squeeze level of a line that gives in steps (M9 fixes 76 and 77):
// the first level, from 0, at which nothing is clipped, or the last level
// when every one clips. A level is tried by setting it and measuring, so
// the search runs from 0 every time and the answer never depends on the
// level it came from.
export function squeezeLevel(levels: number, fits: (level: number) => boolean): number {
  for (let level = 0; level < levels - 1; level += 1) {
    if (fits(level)) return level;
  }
  return Math.max(0, levels - 1);
}

// Whether an element shows all of its content. scrollWidth and clientWidth
// are integers rounded apart, so a single pixel is not a clip for a box; a
// part that ends in an ellipsis draws it at any overflow, a fraction of a
// pixel too, so it takes no tolerance (M9 fix 859).
export function clipped(width: { scrollWidth: number; clientWidth: number }, tolerance = 1): boolean {
  return width.scrollWidth - width.clientWidth > tolerance;
}

// The tolerance a measured part takes (M9 fix 859): none for a part that
// ends in an ellipsis, fix 76's pixel for a box.
export function squeezeTolerance(textOverflow: string): number {
  return textOverflow === 'ellipsis' ? 0 : 1;
}

// A part marked exact (the pane title's state word, which clips rather
// than ellipsising) is measured to the fraction, its text's right edge
// against its box's (M9 fix 859). A cut under half a pixel shaves the
// last glyph's side bearing and no letter, and the integers read such a
// cut as a whole pixel about as often as not: the state word shrinks at a
// weight of 20 beside the cwd's 2000, so it loses a hundredth of whatever
// the cwd gives, and an integer measure put the word away whenever the
// cwd beside it was cut at all.
export function exactClipped(textRight: number, boxRight: number): boolean {
  return textRight - boxRight > 0.5;
}
