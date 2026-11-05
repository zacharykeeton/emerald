// The band under a Claude pane's title when Claude Code's own theme and the
// pane's scheme disagree (M9 fix 1035), with how to switch and a Dismiss.
// The hooks banner's look under its own class: the verify scripts wait for
// `.banner` to clear after a daemon restart, so this band never carries it.
import { useEffect, useMemo } from 'react';
import type { SessionInfo } from '@emerald/shared';
import { claudeThemeNote } from './claude-theme-model.ts';
import { dismissClaudeThemeNote, refreshClaudeTheme, useClaudeThemeNote } from './claude-theme-store.ts';
import { resolveScheme } from './scheme-model.ts';
import { useScheme } from './scheme-store.ts';

export function ClaudeThemeNote({ session }: { session: SessionInfo }) {
  const schemeState = useScheme();
  const sessionScheme = session.scheme;
  // The scheme the pane's terminal wears, resolved as Pane.tsx's terminal does.
  const scheme = useMemo(() => resolveScheme(schemeState.schemes, sessionScheme, schemeState.picked, schemeState.skin).scheme ?? schemeState.current, [schemeState, sessionScheme]);
  const { kind, dismissed } = useClaudeThemeNote();
  // A start or a resume binds a new claudeSessionId: read again then, since a
  // session starts in whatever theme the file says at that moment.
  useEffect(() => refreshClaudeTheme(), [session.id, session.claudeSessionId]);
  const note = claudeThemeNote(kind, scheme.background, dismissed);
  if (note === null) return null;
  return (
    <div className="claude-theme-note" data-pairing={note.pairing}>
      <span className="claude-theme-note-text" title={note.words}>
        {note.words}
      </span>
      <button className="claude-theme-note-dismiss" title={note.dismissTitle} onClick={() => dismissClaudeThemeNote(note.pairing)}>
        Dismiss
      </button>
    </div>
  );
}
