import { GRAPH_SCALE_STEPS } from '@emerald/shared';

// M9 fix 820: the picture view's zoom. 'fit' shrinks a large picture to the
// pane and never grows a small one; a number is a scale from the commit
// graph's steps.
export type ImageZoom = 'fit' | number;

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
  const steps = GRAPH_SCALE_STEPS as readonly number[];
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

// One axis of the scroll that puts the point under the pointer back under
// it after a scale change. into and offset are the pointer's distance into
// the picture and into the host, noted at the wheel at scale from; imageStart
// and hostStart are the client edges read after the render at scale to.
export function anchoredScroll(a: { scroll: number; imageStart: number; hostStart: number; into: number; offset: number; from: number; to: number }): number {
  return Math.max(0, a.scroll + a.imageStart - a.hostStart + (a.into * a.to) / a.from - a.offset);
}
