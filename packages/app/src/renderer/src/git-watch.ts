import { useEffect } from 'react';
import { allPanes } from '@emerald/shared';
import { useStore } from './store.ts';
import { useFocusedSession } from './shown-sessions.ts';

// The folders whose repositories the main process watches for commits
// (M49, M52): the rail's, which is the focused session's, and every
// commits view in a pane of any tab, since a view keeps showing while
// its tab is behind. One place reconciles the union, so the rail and the
// panes never overwrite each other's ask; the main process resolves
// each to its repo root and keeps one watch per root.
export function useGitWatchRoots(): void {
  const { layout } = useStore('layout');
  const focused = useFocusedSession();
  const folders = new Set<string>();
  if (focused !== null) folders.add(focused.cwd);
  if (layout !== null) {
    for (const pane of allPanes(layout)) if (pane.view !== null && pane.view.kind === 'commits') folders.add(pane.view.folder);
  }
  const key = [...folders].sort().join('\n');
  useEffect(() => {
    void window.emerald.files.gitWatch(key === '' ? [] : key.split('\n')).catch((err: unknown) => console.warn('[emerald] git watch failed', err));
  }, [key]);
}
