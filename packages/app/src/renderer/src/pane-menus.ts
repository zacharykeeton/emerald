import type { ShellId } from '@emerald/shared';
import type { PaneMenuItem, PaneMenuRun } from './pane-menu-model.ts';

// The live pane menus by pane id (M9 fix 202). A pane registers its list
// and the handler that runs an item while it is mounted, and the action
// palette reads the focused pane's to list its Pane group and run a row,
// so the palette offers exactly what the right-click menu does without
// the pane's handlers moving out of the pane. Outside the store: nothing
// re-renders on a registration.

export interface PaneMenuHandle {
  // The name the palette shows after the label: the session's, or the
  // view's.
  name: () => string;
  items: () => readonly PaneMenuItem[];
  run: (run: PaneMenuRun, shell?: ShellId) => void;
}

const handles = new Map<string, PaneMenuHandle>();

export function registerPaneMenu(paneId: string, handle: PaneMenuHandle): () => void {
  handles.set(paneId, handle);
  return () => {
    if (handles.get(paneId) === handle) handles.delete(paneId);
  };
}

export function paneMenuOf(paneId: string | null): PaneMenuHandle | null {
  return paneId === null ? null : (handles.get(paneId) ?? null);
}
