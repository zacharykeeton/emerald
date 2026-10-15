import { markKind } from '@emerald/shared';
import type { DesignNote, DesignPick, SessionInfo } from '@emerald/shared';
import type { FocusEntry } from './focus-history-model.ts';

// Design Mode's choices that need no window (M9 fixes 674 and 675): where
// a pick is sent, and the tray's list operations. Pure, so node:test
// reaches them; design.ts and BrowserView.tsx apply them.

type TargetSession = Pick<SessionInfo, 'id' | 'kind' | 'claudeSessionId' | 'lastEventAt' | 'state'>;

function liveClaude(session: TargetSession | null): session is TargetSession {
  return session !== null && markKind(session) === 'claude' && session.state !== 'exited';
}

// The Claude session a pick goes to: the one the person was in last on
// this layout tab before the browser pane, read back from the focus
// history; failing that, the tab's one live Claude session when there is
// exactly one. Two with no history to tell them apart is no answer, since
// a paste into the wrong session is worse than a copy.
export function designTarget(o: {
  entries: readonly FocusEntry[];
  at: number;
  tabId: string;
  browserPaneId: string;
  panes: ReadonlyArray<{ paneId: string; session: TargetSession | null }>;
}): string | null {
  const byPane = new Map(o.panes.map((p) => [p.paneId, p.session]));
  for (let i = Math.min(o.at, o.entries.length - 1); i >= 0; i--) {
    const entry = o.entries[i];
    if (entry === undefined || entry.kind !== 'pane' || entry.tabId !== o.tabId || entry.paneId === o.browserPaneId) continue;
    const session = byPane.get(entry.paneId);
    if (session === undefined) continue;
    if (liveClaude(session)) return session.id;
  }
  const live = o.panes.filter((p) => p.paneId !== o.browserPaneId && liveClaude(p.session));
  return live.length === 1 ? live[0]!.session!.id : null;
}

// The tray's operations (fix 675), each answering a new list.
export function addNote(notes: readonly DesignNote[], pick: DesignPick, shot: string | null, id: string): DesignNote[] {
  return [...notes, { id, pick, shot, comment: '' }];
}

export function editNote(notes: readonly DesignNote[], id: string, comment: string): DesignNote[] {
  return notes.map((n) => (n.id === id ? { ...n, comment } : n));
}

export function deleteNote(notes: readonly DesignNote[], id: string): DesignNote[] {
  return notes.filter((n) => n.id !== id);
}

// After a send: the sent ones go, and a note added while the paste was on
// its way stays.
export function removeSent(notes: readonly DesignNote[], sentIds: readonly string[]): DesignNote[] {
  const sent = new Set(sentIds);
  return notes.filter((n) => !sent.has(n.id));
}

// The tray's title for a note: its number, its tag and its selector cut
// at 40.
export function noteTitle(n: number, note: DesignNote): string {
  const sel = note.pick.selector;
  return `${n}. ${note.pick.tag} ${sel.length > 40 ? sel.slice(0, 40) + '…' : sel}`;
}
