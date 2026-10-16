import type { ReactNode } from 'react';

// A labelled row of segment buttons in a menu (M9 fix 744, the chat
// footer's effort row), built as Swatches.tsx's colour row is: one button
// per option, the current one marked, a pick closing whatever holds the
// row through its own handler.
export interface MenuSegments {
  segments: string;
  options: readonly { word: string; title: string; active: boolean; onPick: () => void }[];
  separator?: boolean | undefined;
}

export function Segments({ item }: { item: MenuSegments }): ReactNode {
  return (
    <div className={item.separator ? 'menu-segments menu-sep' : 'menu-segments'} data-segments={item.segments}>
      <span className="menu-label">{item.segments}</span>
      <span className="menu-segment-row">
        {item.options.map((o) => (
          <button
            key={o.word}
            type="button"
            className="menu-segment"
            data-value={o.word}
            data-active={o.active || undefined}
            title={o.title}
            onClick={o.onPick}
            onMouseDown={(ev) => ev.preventDefault()}
          >
            {o.word}
          </button>
        ))}
      </span>
    </div>
  );
}
