// The sideways graph's text, laid out without a mount (M9 fix 142): a
// label's box is estimated from its characters, since measuring needs
// the SVG on screen and a second pass, and the estimate errs wide, which
// costs a pill a needless flip now and then and never an overprint.

// The label type is 9px (`.commits-label`); a 38-character label measured
// 149px on the click-through, 3.9px a character, so 4.5 errs wide.
export const LABEL_CHAR_PX = 4.5;
// Cap height of that type, for the box above the baseline.
export const LABEL_CAP_PX = 7;
// An agent label on its side is cut to this many characters; the whole
// text is on the mark's card and on the pane's row.
export const SIDE_LABEL_CHARS = 24;

export interface TextBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function labelWidth(text: string): number {
  return text.length * LABEL_CHAR_PX;
}

// The box a text occupies from its anchor point and baseline.
export function textBox(x: number, baseline: number, text: string, anchor: 'start' | 'middle' | 'end'): TextBox {
  const w = labelWidth(text);
  const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x0, x1: x0 + w, y0: baseline - LABEL_CAP_PX, y1: baseline };
}

export function overlaps(a: TextBox, b: TextBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

// A pill drawn above its node yields to a label already in that band:
// true when its box crosses any of them, and the caller draws it below.
export function pillYields(pill: TextBox, labels: readonly TextBox[]): boolean {
  return labels.some((l) => overlaps(pill, l));
}

export function cutLabel(text: string, max = SIDE_LABEL_CHARS): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
