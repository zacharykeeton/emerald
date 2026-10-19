import { useLayoutEffect, type RefObject } from 'react';
import { clipped, exactClipped, squeezeLevel, squeezeTolerance } from './squeeze-model.ts';

// A line that gives in whole steps (M9 fixes 76 and 77): the element
// carries data-squeeze, the CSS hides a part per level, and this finds the
// first level at which nothing is clipped, the element itself or any
// descendant matching `tell`. A part that ends in an ellipsis is clipped
// at any overflow, since Chrome draws the ellipsis at a fraction of a
// pixel and the pane title's state word read `do…` at a level the pixel
// let through; a part marked data-squeeze-exact (that word, which now
// clips) is measured to the fraction and gives once half a pixel of it is
// cut; a box keeps fix 76's pixel (M9 fix 859). The search runs in a layout effect on deps,
// so no frame paints the wrong level and it runs where a ResizeObserver
// does not (a covered harness window, the rule the pane's refit follows:
// the width comes through state, so the deps carry it); the observer is
// for the changes no state carries, a window zoom or a font. While `hold`
// is true the level stays where it is (M9 fix 93: a pane title being
// renamed keeps its squeeze, so the rename box takes the name's room
// rather than paying for the parts that unfold when the name's text is
// no longer overflowing the line).
export function useSqueeze(ref: RefObject<HTMLElement | null>, levels: number, tell: string | null, deps: readonly unknown[], hold = false): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      if (hold) return;
      if (levels < 2) {
        if (el.hasAttribute('data-squeeze')) el.removeAttribute('data-squeeze');
        return;
      }
      const over = (node: HTMLElement) => {
        if (node.hasAttribute('data-squeeze-exact')) {
          // A range's box is the text's own, unclipped by the overflow.
          const text = document.createRange();
          text.selectNodeContents(node);
          return exactClipped(text.getBoundingClientRect().right, node.getBoundingClientRect().right);
        }
        return clipped(node, squeezeTolerance(getComputedStyle(node).textOverflow));
      };
      const fits = (level: number) => {
        el.setAttribute('data-squeeze', String(level));
        if (over(el)) return false;
        if (tell === null) return true;
        for (const part of el.querySelectorAll<HTMLElement>(tell)) {
          if (over(part)) return false;
        }
        return true;
      };
      el.setAttribute('data-squeeze', String(squeezeLevel(levels, fits)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // The caller's deps are the line's width and its text.
  }, [ref, levels, tell, hold, ...deps]);
}
