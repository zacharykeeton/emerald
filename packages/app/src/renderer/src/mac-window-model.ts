// The renderer's half of the Mac window (M9 fix 1023): the title row's
// left inset past the three window buttons, and the mark main.tsx puts on
// <html> before the first paint. Pure, so node --test runs it.

// The three buttons from x 12, about 66 px, and the row's own 12 px gap
// before the mark; style.css's :root[data-platform="darwin"] .title-bar.
export const TITLE_INSET_DARWIN = 78;

export function platformMark(platform: string): 'darwin' | null {
  return platform === 'darwin' ? 'darwin' : null;
}
