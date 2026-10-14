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
// are integers rounded apart, so a single pixel is not a clip.
export function clipped(width: { scrollWidth: number; clientWidth: number }): boolean {
  return width.scrollWidth - width.clientWidth > 1;
}
