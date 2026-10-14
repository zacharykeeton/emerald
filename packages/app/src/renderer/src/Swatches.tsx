import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

// A labelled row of colour swatches (M29, the session's colour): one
// button per colour, the current one marked. A pick closes whatever
// holds the row through its own handler, as a menu item does. M9 fix
// 157: a swatch under the pointer previews (onEnter), and leaving the
// row or the row going puts things back (onLeave).
export interface MenuSwatches {
  label: string;
  swatches: readonly { color: string; title: string; active: boolean; onPick: () => void; onEnter?: (() => void) | undefined }[];
  onLeave?: (() => void) | undefined;
  separator?: boolean | undefined;
}

// The row itself (M9 fix 134): lifted out of Menu.tsx so the lane card
// on the Commits graph carries the same Colour row as the sidebar row's
// menu and the pane menu, markup and CSS unchanged (`data-swatches`,
// `.menu-swatch`, `data-color`), so the scripts' selectors stand.
export function Swatches({ item }: { item: MenuSwatches }): ReactNode {
  // The row goes with its menu on Escape, an outside click or a pick, with
  // the pointer still on a swatch and no mouseleave to come, so the
  // unmount is a leave too; through a ref, since the item is rebuilt
  // every render.
  const onLeave = useRef(item.onLeave);
  onLeave.current = item.onLeave;
  useEffect(() => () => onLeave.current?.(), []);
  return (
    <div className={item.separator ? 'menu-swatches menu-sep' : 'menu-swatches'} data-swatches={item.label} onMouseLeave={item.onLeave}>
      <span className="menu-label">{item.label}</span>
      <span className="menu-swatch-row">
        {item.swatches.map((sw) => (
          <button
            key={sw.color}
            className="menu-swatch"
            style={{ background: sw.color }}
            data-color={sw.color}
            data-active={sw.active || undefined}
            title={sw.title}
            onClick={sw.onPick}
            onMouseEnter={sw.onEnter}
            onMouseDown={(ev) => ev.preventDefault()}
          />
        ))}
      </span>
    </div>
  );
}
