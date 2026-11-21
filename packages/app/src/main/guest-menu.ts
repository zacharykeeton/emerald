import type { ContextMenuParams } from 'electron';
import type { GuestMenu, GuestMenuAct, WindowSpell } from '../preload/api.ts';

// A right-click in a browser pane's page (M9 fix 1178): what main reads
// off Electron's context-menu params and sends the window, for its own
// menu. Kept apart from index.ts so a test can import it.

// The most spelling suggestions the menu lists.
export const GUEST_MENU_SUGGESTIONS = 5;

export function guestMenuOf(
  webContentsId: number,
  p: Pick<ContextMenuParams, 'x' | 'y' | 'isEditable' | 'editFlags' | 'linkURL' | 'srcURL' | 'mediaType' | 'misspelledWord' | 'dictionarySuggestions'>,
  held: { text: string } | null,
): GuestMenu {
  return {
    webContentsId,
    x: p.x,
    y: p.y,
    editable: p.isEditable,
    canCut: p.editFlags.canCut,
    canCopy: p.editFlags.canCopy,
    // Under a held clipboard (any EMERALD_HOME) Paste follows what the
    // window copied, never the person's own clipboard.
    canPaste: held === null ? p.editFlags.canPaste : p.isEditable && held.text !== '',
    canSelectAll: p.editFlags.canSelectAll,
    link: p.linkURL,
    image: p.mediaType === 'image' ? p.srcURL : '',
    misspelled: p.misspelledWord,
    suggestions: p.misspelledWord === '' ? [] : p.dictionarySuggestions.slice(0, GUEST_MENU_SUGGESTIONS),
  };
}

// M9 fix 1193: the window's own right-click in a field, for the chat box's menu; the same cut as a page's.
export function windowSpellOf(p: Pick<ContextMenuParams, 'misspelledWord' | 'dictionarySuggestions'>): WindowSpell {
  return { misspelled: p.misspelledWord, suggestions: p.misspelledWord === '' ? [] : p.dictionarySuggestions.slice(0, GUEST_MENU_SUGGESTIONS) };
}

// M9 fix 1192: what a picked row does, the same on the held clipboard and the person's own, so a unit test proves the branch no harness reaches. Copy and Cut write the right-click's selection as plain text, as Copy link address always did.
export type GuestMenuStep = { kind: 'write'; text: string } | { kind: 'delete' } | { kind: 'paste' } | { kind: 'select-all' } | { kind: 'spell'; word: string };

export function guestMenuSteps(
  act: GuestMenuAct,
  kept: { selection: string; menu: Pick<GuestMenu, 'link' | 'image' | 'suggestions'> },
  word: string | undefined,
): GuestMenuStep[] {
  switch (act) {
    case 'cut':
      return kept.selection === '' ? [] : [{ kind: 'write', text: kept.selection }, { kind: 'delete' }];
    case 'copy':
      return kept.selection === '' ? [] : [{ kind: 'write', text: kept.selection }];
    case 'paste':
      return [{ kind: 'paste' }];
    case 'select-all':
      return [{ kind: 'select-all' }];
    case 'copy-link':
      return kept.menu.link === '' ? [] : [{ kind: 'write', text: kept.menu.link }];
    case 'copy-image':
      return kept.menu.image === '' ? [] : [{ kind: 'write', text: kept.menu.image }];
    case 'spell':
      return word !== undefined && kept.menu.suggestions.includes(word) ? [{ kind: 'spell', word }] : [];
    default:
      return [];
  }
}
