import type { SessionInfo } from '@emerald/shared';

// A colour previewed on one session (M9 fix 157): the swatch the pointer
// rests on in a Colour row paints the session before it is chosen, so
// the colour can be judged against the neighbouring rows and lanes. It
// lives in the renderer alone and is laid over the store's map, so every
// reader of a session's colour follows without a change of its own. A
// held preview is one whose swatch was clicked: it stays until the
// daemon pushes the saved colour back, so the old colour never flashes
// for the round trip.
export interface ColorPreview {
  sessionId: string;
  color: string;
  held: boolean;
}

// The map with the preview laid over its one entry; the same map when
// there is no preview, the session is not in it, or it wears that colour
// already, so nothing re-renders for nothing.
export function withPreview(sessions: ReadonlyMap<string, SessionInfo>, preview: ColorPreview | null): ReadonlyMap<string, SessionInfo> {
  if (preview === null) return sessions;
  const session = sessions.get(preview.sessionId);
  if (session === undefined || session.color === preview.color) return sessions;
  const next = new Map(sessions);
  next.set(preview.sessionId, { ...session, color: preview.color });
  return next;
}
