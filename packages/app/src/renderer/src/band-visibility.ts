// M9 fix 789: a turn band whose line is out of view stops. Fix 767's A/B
// read the bands as the largest animation left, about 2.6 points of the
// renderer at twenty working sessions, and a band nobody can see still
// runs on the compositor. One IntersectionObserver watches the three band
// lines (the sidebar's agent line and the timeline's two activity spans)
// and sets data-offscreen on a line outside the window, or clipped away by
// its list; the sheet stops that line's band. Coming back into view the
// band starts again and attention.ts puts its start on time zero (fix
// 729), so it stays in phase.
//
// The lever is only the off-screen share of the bands. An observer, like
// rAF, reports nothing in a covered window, so a line that comes into view
// while covered keeps a stale data-offscreen until the window is
// uncovered. No attribute is the default, so a window whose observer never
// reports runs every band as it did.

let observer: IntersectionObserver | null = null;

// Made on the first call, so a unit test can put a fake on globalThis
// first and importing the module in node does nothing.
function shared(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.removeAttribute('data-offscreen');
        else entry.target.setAttribute('data-offscreen', '');
      }
    },
    { root: null, rootMargin: '100px 0px', threshold: 0 },
  );
  return observer;
}

// A React 19 callback ref: the module function itself, so React never sees
// a new ref and never runs it again. The cleanup it returns runs when the
// element goes.
export function observeBand(el: HTMLElement | null): (() => void) | undefined {
  if (el === null) return undefined;
  const watch = shared();
  watch.observe(el);
  return () => {
    watch.unobserve(el);
    el.removeAttribute('data-offscreen');
  };
}
