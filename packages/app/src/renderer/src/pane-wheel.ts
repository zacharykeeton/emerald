import { useEffect } from 'react';
import type { RefObject } from 'react';
import { adjustFontSize } from './ui.ts';

// The views that zoom a picture of their own on Ctrl+wheel: the commits
// graph, the activity strip and a picture tab.
export const OWN_ZOOM_SELECTOR = '.commits-graph-view, .activity-view-time, .file-image-host';

// M9 fix 899: Ctrl+wheel over any face sizes the pane's text: a capture listener on the pane's root, so it runs before xterm, Monaco or the chat's own scrolling see the wheel, and not passive, which React's own wheel props are, so it can stop the page scroll. The three views that zoom a picture of their own keep the wheel (OWN_ZOOM_SELECTOR, the user's pick).
export function usePaneWheel(ref: RefObject<HTMLElement | null>, sizeKey: string, on: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!on || el === null) return;
    const onWheel = (ev: WheelEvent): void => {
      if (!ev.ctrlKey) return;
      if (ev.target instanceof Element && ev.target.closest(OWN_ZOOM_SELECTOR) !== null) return;
      ev.preventDefault();
      ev.stopPropagation();
      adjustFontSize(sizeKey, ev.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [sizeKey, on]);
}
