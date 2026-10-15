import { bracketedPaste, currentTab, formatDesignBlock, listPanes, tabHolding } from '@emerald/shared';
import type { DesignNote, PaneNode } from '@emerald/shared';
import { typeInto } from './actions.ts';
import { designTarget } from './design-model.ts';
import { getState } from './store.ts';
import { flashCornerNote, getUiState, setDesignPane } from './ui.ts';

// Design Mode's actions (M9 fixes 674 and 675): turning it on for a
// browser pane and sending what was picked to the Claude session the
// person was in last on that layout tab.

function hasPage(pane: PaneNode): boolean {
  return pane.view?.kind === 'browser' && pane.view.url !== '';
}

// The Claude session a pick from this browser pane goes to, or null.
export function designTargetOf(browserPaneId: string): string | null {
  const { layout, sessions } = getState();
  if (layout === null) return null;
  const tab = tabHolding(layout, browserPaneId);
  if (tab === null) return null;
  const { focusHistory } = getUiState();
  return designTarget({
    entries: focusHistory.entries,
    at: focusHistory.at,
    tabId: tab.id,
    browserPaneId,
    panes: listPanes(tab).map((p) => ({ paneId: p.id, session: p.sessionId === null ? null : (sessions.get(p.sessionId) ?? null) })),
  });
}

// The chord and the palette: the focused pane when it is a browser pane
// with a page, else the one such pane on the current layout tab. A
// second press on the pane already in the mode turns it off.
export function toggleDesignMode(paneId?: string): void {
  const current = getUiState().designPaneId;
  let id = paneId ?? null;
  if (id === null) {
    const { layout } = getState();
    if (layout !== null) {
      const tab = currentTab(layout);
      const panes = listPanes(tab);
      const focused = panes.find((p) => p.id === tab.focusedPaneId);
      if (focused !== undefined && hasPage(focused)) id = focused.id;
      else {
        const withPage = panes.filter(hasPage);
        if (withPage.length === 1) id = withPage[0]!.id;
        else if (current !== null && panes.some((p) => p.id === current)) id = current;
      }
    }
  }
  if (id === null) {
    flashCornerNote('No browser pane here for Design Mode');
    return;
  }
  setDesignPane(current === id ? null : id);
}

// Pastes the notes into the target as one bracketed paste with no Enter,
// so the person reads it and adds to it before sending. With no target
// the block goes to the clipboard instead, and the answer is false so
// the tray keeps its notes.
export function sendDesign(paneId: string, notes: DesignNote[], numbered: boolean): boolean {
  const block = formatDesignBlock(notes, numbered);
  const target = designTargetOf(paneId);
  if (target === null) {
    void window.emerald.clipboard.write(block);
    flashCornerNote(`No Claude session to send to in this tab; copied the ${notes.length === 1 ? 'note' : 'notes'} instead`);
    return false;
  }
  typeInto(target, bracketedPaste(block));
  return true;
}
