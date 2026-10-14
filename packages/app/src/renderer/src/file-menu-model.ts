import type { FileTabView } from './tabs-model.ts';

// The file body's right-click menu as facts (M9 fix 270), the way
// pane-menu-model.ts lists the pane menu: one list for the editor, the
// rendered markdown and the transcript views, so the three cannot drift.
// Pure, with no closures: each item names what it does (`run`) and
// FileView.tsx maps that to the editor's or the DOM selection's handler.
// Monaco's clipboard actions are not in the build, and its own context
// menu came in with the JSON language's contributions (M9 fix 359) but
// is told not to show (FileView.tsx, contextmenu: false), so this menu
// is the one a right-click on a file shows.

// M9 fix 340: 'scheme' items carry the scheme's name, or null for
// Window's scheme, which clears the file's pick; 'heading' is the section's
// heading, drawn as a menu heading, not an item.
// M9 fix 619: 'find' opens the view's find bar in Rendered and Turns and
// Monaco's find in Raw and Pretty.
export type FileMenuRun = 'copy' | 'select-all' | 'find' | 'wrap' | 'paste' | 'format' | 'format-selection' | 'copy-path' | 'reveal' | 'reveal-files' | 'open' | 'scheme' | 'heading';

export interface FileMenuItem {
  run: FileMenuRun;
  label: string;
  // On a 'scheme' item: the name to pick, or null to clear the pick.
  scheme?: string | null | undefined;
  // The key that does the same thing, shown at the right.
  hint?: string | undefined;
  title?: string | undefined;
  disabled?: boolean | undefined;
  separator?: boolean | undefined;
  // A setting's item wears a check when it is on (M9 fix 338).
  checked?: boolean | undefined;
}

export interface FileMenuFacts {
  view: FileTabView;
  // Whether the editor takes edits (the Raw view of a file that is not
  // a transcript); only then is Paste offered.
  editable: boolean;
  // Whether anything is selected, in the editor or the DOM.
  selected: boolean;
  // Whether the editor wraps long lines (M9 fix 338), the window's
  // setting; the item flips it.
  wrap: boolean;
  // A .json file (M9 fix 339): its Raw view offers Format JSON.
  json: boolean;
  // The colour schemes on offer (M9 fix 340), the shipped ones first as
  // the pane menu lists them, and the file's own pick, null for none.
  schemes: readonly FileMenuScheme[];
  scheme: string | null;
}

export interface FileMenuScheme {
  name: string;
  background: string;
  source: 'shipped' | 'windows-terminal';
}

export function fileMenu({ view, editable, selected, wrap, json, schemes, scheme }: FileMenuFacts): FileMenuItem[] {
  const items: FileMenuItem[] = [
    { run: 'copy', label: 'Copy', hint: 'Ctrl+C', disabled: !selected, title: selected ? 'Copy the selection' : 'Nothing selected' },
    { run: 'select-all', label: 'Select all', hint: 'Ctrl+A' },
    { run: 'find', label: 'Find', hint: 'Ctrl+F', title: 'Find in this file' },
  ];
  // The wrap is the editor's setting; the rendered views have no long
  // lines to wrap, so the item shows where it does something (the Raw
  // editor, and the Pretty view, which is the same editor).
  if (view === 'raw' || view === 'pretty') items.push({ run: 'wrap', label: 'Wrap long lines', hint: 'Alt+Z', checked: wrap, title: 'Wrap long lines at the width, in every file editor of this window' });
  // A transcript's Raw view is read-only (Claude Code owns the file) and
  // the rendered views take no typing, so Paste only shows where it lands.
  if (view === 'raw' && editable) items.push({ run: 'paste', label: 'Paste', hint: 'Ctrl+V', title: 'Paste the clipboard at the cursor' });
  if (view === 'raw' && editable && json) {
    items.push({ run: 'format', label: 'Format JSON', title: 'Format the JSON in place, in its own indent (one undo step)' });
    // M9 fix 420: the range formatter the JSON language already had was
    // never turned on (monaco.ts, documentRangeFormattingEdits); this
    // item runs it over the selection alone, disabled the way Copy is
    // with nothing selected.
    items.push({
      run: 'format-selection',
      label: 'Format JSON selection',
      disabled: !selected,
      title: selected ? 'Format the selected JSON in place (one undo step)' : 'Nothing selected',
    });
  }
  items.push(
    { run: 'copy-path', label: 'Copy path', separator: true },
    { run: 'reveal', label: 'Reveal in Explorer' },
    // M9 fix 652: the same file in the Files rail, its folders opened.
    { run: 'reveal-files', label: 'Reveal in Files', title: 'Show this file in the Files rail, its folders opened' },
    { run: 'open', label: 'Open with Windows', title: 'Open with the program Windows has for it' },
  );
  // The file's own colour scheme (M9 fix 340), in the pane menu's shape:
  // a heading, Window's scheme while the file has a pick, then one
  // checked row per scheme, the shipped ones first.
  items.push({
    run: 'heading',
    label: 'Colour scheme',
    title: scheme === null ? "This file's ground and text follow the window's scheme; a pick below is this file's own, in a tab or a pane" : `This file wears ${scheme}, its own; the shipped schemes first, then the ones in your Windows Terminal settings`,
  });
  if (scheme !== null) items.push({ run: 'scheme', scheme: null, label: "Window's scheme", title: `Drop this file's own scheme (${scheme}) and follow the window's` });
  for (const s of schemes) {
    items.push({
      run: 'scheme',
      scheme: s.name,
      label: s.name,
      checked: s.name === scheme,
      title: s.source === 'shipped' ? `Shipped with emerald, ground ${s.background}` : `From your Windows Terminal settings, ground ${s.background}`,
    });
  }
  return items;
}
