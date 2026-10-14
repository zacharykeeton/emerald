import { useLayoutEffect, type RefObject } from 'react';
import { clipped, squeezeLevel } from './squeeze-model.ts';

// A line that gives in whole steps (M9 fixes 76 and 77): the element
// carries data-squeeze, the CSS hides a part per level, and this finds the
// first level at which nothing is clipped, the element itself or any
// descendant matching `tell`. The search runs in a layout effect on deps,
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
      const fits = (level: number) => {
        el.setAttribute('data-squeeze', String(level));
        if (clipped(el)) return false;
        if (tell === null) return true;
        for (const part of el.querySelectorAll<HTMLElement>(tell)) {
          if (clipped(part)) return false;
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
