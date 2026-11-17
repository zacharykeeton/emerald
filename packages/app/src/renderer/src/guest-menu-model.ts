import type { GuestMenu, GuestMenuAct } from '../../preload/api.ts';

// The rows of a browser pane's page menu (M9 fix 1178), off what main
// read from the right-click: the spelling suggestions first, then the
// edit rows, then the link's and the image's address. Copy and edit
// items only, by the user's word: no Back, Forward, Reload or Inspect.

export interface GuestMenuRow {
  label: string;
  act: GuestMenuAct;
  word?: string;
  disabled?: true;
  separator?: true;
}

export function guestMenuRows(m: GuestMenu): GuestMenuRow[] {
  const rows: GuestMenuRow[] = [];
  if (m.misspelled !== '') {
    if (m.suggestions.length === 0) rows.push({ label: 'No suggestions', act: 'spell', disabled: true });
    else for (const word of m.suggestions) rows.push({ label: word, act: 'spell', word });
  }
  // Each later group's first row draws a rule when a row comes before it.
  const group = (list: GuestMenuRow[]) => {
    if (list.length === 0) return;
    const [first, ...rest] = list;
    rows.push(rows.length > 0 ? { ...first!, separator: true } : first!, ...rest);
  };
  const edit: GuestMenuRow[] = [];
  const row = (label: string, act: GuestMenuAct, on: boolean): GuestMenuRow => (on ? { label, act } : { label, act, disabled: true });
  if (m.editable) {
    edit.push(row('Cut', 'cut', m.canCut), row('Copy', 'copy', m.canCopy), row('Paste', 'paste', m.canPaste), row('Select all', 'select-all', m.canSelectAll));
  } else {
    if (m.canCopy) edit.push({ label: 'Copy', act: 'copy' });
    if (m.canSelectAll) edit.push({ label: 'Select all', act: 'select-all' });
  }
  group(edit);
  // The link's row and the image's row are a group each, so an image
  // inside a link draws a rule between the two.
  if (m.link !== '') group([{ label: 'Copy link address', act: 'copy-link' }]);
  if (m.image !== '') group([{ label: 'Copy image address', act: 'copy-image' }]);
  return rows;
}
