import type { ContextMenuParams } from 'electron';
import type { GuestMenu } from '../preload/api.ts';

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
