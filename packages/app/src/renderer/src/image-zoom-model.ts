// M9 fix 820: the picture view's zoom. 'fit' shrinks a large picture to the
// pane and never grows a small one; a number is a scale from IMAGE_ZOOM_STEPS
// (M9 fix 850: the graph's middle steps, a tenth and two below for a large
// picture, up to eight times above for a small one or an SVG's detail).
export type ImageZoom = 'fit' | number;

export const IMAGE_ZOOM_STEPS: readonly number[] = [0.1, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

const EPS = 0.001;

// The scale a fitted picture draws at: only ever 1 or less. 1 as well when
// nothing is measured yet, so a picture never draws at nothing.
export function fitScale(nat: { w: number; h: number }, room: { w: number; h: number }): number {
  if (nat.w <= 0 || nat.h <= 0 || room.w <= 0 || room.h <= 0) return 1;
  return Math.min(1, room.w / nat.w, room.h / nat.h);
}

// The next step in a direction, from any scale (a fit of 0.23 is not a
// step): the first entry more than a hair past it, or the scale itself when
// the steps run out.
export function zoomStep(scale: number, dir: 1 | -1): number {
  const steps = IMAGE_ZOOM_STEPS;
  if (dir === 1) return steps.find((s) => s > scale + EPS) ?? scale;
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]! < scale - EPS) return steps[i]!;
  return scale;
}

// What a click on the picture does: fit goes to 100 percent, anything else
// goes back to fit.
export function clickTarget(zoom: ImageZoom): ImageZoom {
  return zoom === 'fit' ? 1 : 'fit';
}

// The cursor promises a size change only where the click makes one.
export function clickCursor(zoom: ImageZoom, fit: number): 'zoom-in' | 'zoom-out' | null {
  const now = zoom === 'fit' ? fit : zoom;
  const t = clickTarget(zoom);
  const target = t === 'fit' ? fit : t;
  if (target > now + EPS) return 'zoom-in';
  if (target < now - EPS) return 'zoom-out';
  return null;
}

// M9 fix 850: the chip's words. A fitted picture that already draws at its
// actual size says so as 100%, not Fit.
export function zoomChip(zoom: ImageZoom, fit: number): string {
  if (zoom === 'fit') return Math.abs(fit - 1) < EPS ? '100%' : 'Fit';
  return `${Math.round(zoom * 100)}%`;
}

// One axis of the scroll that puts the point under the pointer back under
// it after a scale change. into and offset are the pointer's distance into
// the picture and into the host, noted at the wheel at scale from; imageStart
// and hostStart are the client edges read after the render at scale to.
export function anchoredScroll(a: { scroll: number; imageStart: number; hostStart: number; into: number; offset: number; from: number; to: number }): number {
  return Math.max(0, a.scroll + a.imageStart - a.hostStart + (a.into * a.to) / a.from - a.offset);
}
