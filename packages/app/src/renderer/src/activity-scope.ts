import { underFolder } from '@emerald/shared';
import type { ActivitySession } from '@emerald/shared';

// Which of the day's rows the Activity tab's strip shows (M66). The rail
// is on a folder, so its strip keeps to that folder's sessions the way the
// commits below it do; `all` is the toggle, and `panes` (M9 fix 250, the
// `tab` of M66's pane form renamed) is the sessions on a pane of any
// layout tab, sessionsOnPanes in shared, and `here` (M9 fix 261) the
// sessions on the panes of the tab holding the view's own pane, which
// only the pane form has. An agent's row follows its
// parent, since the parent's id is the row's. A session the store no
// longer lists (removed, M57) is read off its own record's folders,
// which the daemon puts on the row since M9 fix 215, so the folder scope
// keeps it as `all` does; a track no record names has neither and is
// dropped on a folder, as before.

export type ActivityScope = 'folder' | 'all' | 'panes' | 'here';

export interface ScopeSource {
  // groupCwd and cwd of the listed sessions, by id; a row the map lacks
  // is read off its own record's folders.
  folders: ReadonlyMap<string, { groupCwd: string | null; cwd: string | null }>;
  // Session ids on a pane of any tab, for the panes scope.
  paneIds: ReadonlySet<string>;
  // Session ids on a pane of the view's own tab, for the here scope;
  // absent where the view has no pane (the tab, the rail), which reads
  // as none.
  hereIds?: ReadonlySet<string> | undefined;
}

export function scopedSessions(list: readonly ActivitySession[], scope: ActivityScope, folder: string | null, source: ScopeSource): ActivitySession[] {
  if (scope === 'all' || (scope === 'folder' && folder === null)) return [...list];
  if (scope === 'panes') return list.filter((s) => source.paneIds.has(s.sessionId));
  if (scope === 'here') return list.filter((s) => source.hereIds?.has(s.sessionId) ?? false);
  const root = folder as string;
  return list.filter((s) => {
    const f = source.folders.get(s.sessionId) ?? { groupCwd: s.groupCwd ?? null, cwd: s.cwd ?? null };
    return (f.groupCwd !== null && underFolder(f.groupCwd, root)) || (f.cwd !== null && underFolder(f.cwd, root));
  });
}

// The prefix rule is shared's since M9 fix 836, so the daemon's folder
// totals keep the rows this scope does.
export { underFolder };

// The head's words for the scope, before the day's numbers; the here
// scope names the tab holding the pane.
export function scopeWords(scope: ActivityScope, folder: string | null, folderName: (f: string) => string, tabName: string | null = null): string | null {
  if (scope === 'panes') return 'on the panes';
  if (scope === 'here') return `on ${tabName ?? 'this tab'}`;
  if (scope === 'folder' && folder !== null) return folderName(folder);
  return null;
}

// The pill's cycle (M9 fix 250): all, the folder, the panes, (M9 fix
// 261) this tab, and round; the folder step is skipped while the view
// has no folder, the panes step while the caller cannot keep it (a pane
// on a daemon below level 48), which leaves M9 fix 178's two-way
// toggle, and the this-tab step unless the caller is a pane on a daemon
// that keeps it (level 49); the tab form never takes it, since it is
// the whole window's reading and the panes step covers it.
export function nextScope(scope: ActivityScope, folder: string | null, panes = true, here = false): ActivityScope {
  if (scope === 'all') return folder === null ? (panes ? 'panes' : 'all') : 'folder';
  if (scope === 'folder') return panes ? 'panes' : 'all';
  if (scope === 'panes') return here ? 'here' : 'all';
  return 'all';
}

// A stored scope read back: an old pane record or query holding M66's
// `tab` reads as panes, anything unknown as all.
export function readScope(value: unknown): ActivityScope {
  return value === 'folder' || value === 'panes' || value === 'here' ? value : value === 'tab' ? 'panes' : 'all';
}
