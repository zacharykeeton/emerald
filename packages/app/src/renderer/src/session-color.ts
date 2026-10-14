import type { CSSProperties } from 'react';
import { SESSION_COLORS, SESSION_COLOR_NAMES } from '@emerald/shared';
import type { SessionInfo } from '@emerald/shared';
import { setSessionColor } from './actions.ts';
import type { MenuSwatches } from './Menu.tsx';
import { endSessionColorPreview, holdSessionColorPreview, previewSessionColor, savedSessionColor } from './store.ts';

// The session's colour (M24) as the custom property the CSS reads for the
// row's bar and the pane title's tint. Nothing from a daemon older than
// M24, so the row and the title look as they did on one.
export function colorStyle(session: SessionInfo): CSSProperties | undefined {
  return session.color === null ? undefined : ({ '--session-color': session.color } as CSSProperties);
}

// The Colour row of the row menu and the pane menu (M29): the palette's
// swatches (twelve, M9 fix 133), the session's own marked, a click setting it through
// session.set. `close` is the menu's own close, run before the request so
// the menu goes at once. M9 fix 157: a swatch under the pointer previews
// its colour on the session through the store, leaving the row (or the
// row going, with its menu) puts the saved colour back, and a click
// holds the preview until the daemon pushes the new colour, or the
// request fails. The mark stays on the saved colour, so the row still
// says what is set while another swatch is being tried; `session` comes
// off the store's snapshot, which wears the preview, so the saved colour
// is asked of the store.
export function colorSwatches(session: SessionInfo, close: () => void): MenuSwatches {
  const names = new Map(Object.entries(SESSION_COLOR_NAMES).map(([name, hex]) => [hex, name]));
  const saved = savedSessionColor(session.id);
  const current = saved === undefined ? session.color : saved;
  return {
    label: 'Colour',
    swatches: SESSION_COLORS.map((color) => ({
      color,
      title: `${names.get(color) ?? color} (emmer set --color ${names.get(color) ?? color})`,
      active: color === current,
      onEnter: () => previewSessionColor(session.id, color),
      onPick: () => {
        holdSessionColorPreview(session.id, color);
        close();
        void setSessionColor(session.id, color).catch((err: unknown) => {
          endSessionColorPreview(session.id, true);
          console.warn('[emerald] set colour failed', err);
        });
      },
    })),
    onLeave: () => endSessionColorPreview(session.id),
  };
}
