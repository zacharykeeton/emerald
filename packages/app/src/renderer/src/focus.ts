import { normalizePath } from './files-model.ts';

// xterm's textarea in the focused pane, the one place keystrokes belong
// when the panes are showing. The files rail's filter and the tab strip
// hand the keyboard back through this. A pane on the chat face (M9 fix
// 689) takes them in its box instead.
export function focusTerminal(): void {
  const el = document.querySelector<HTMLElement>('.pane.focused[data-face="chat"] .chat-box') ?? document.querySelector<HTMLElement>('.pane.focused .xterm-helper-textarea');
  el?.focus();
}

// M9 fix 929: a click on a file in the Files tree opens its preview tab and
// leaves the keyboard on the tree, as VS Code's explorer does. The rail
// notes the file here; the tab's view, whose first focus on the file (the
// editor's model landing, a rendered markdown's or a transcript's own focus
// on open) would take the keyboard, asks treeKeepsKeys first and keeps its
// hands off once while the tree still holds it. A pane's view never asks,
// so a file opened beside from the row's menu or by a drag still takes the
// keyboard. The rail clears the note on Enter and on a double click, which
// hand the keyboard to the file, and when the tree loses the keyboard; the
// file view clears it on a pick of its view.
let treeHold: string | null = null;

export function holdKeysInTree(path: string | null): void {
  treeHold = path === null ? null : normalizePath(path);
}

export function treeKeepsKeys(path: string, el: Element | null): boolean {
  if (treeHold === null || treeHold !== normalizePath(path)) return false;
  if ((el?.closest('.file-view[data-place="pane"]') ?? null) !== null) return false;
  treeHold = null;
  return document.activeElement?.classList.contains('files-list') === true;
}

// M9 fix 929: Enter on a file row, or a double click, hands the keyboard to
// the file's tab: its rendered or Turns view when one shows, else its editor
// once the model is in. A tab still loading has nothing to take it yet and
// takes it itself as the file lands, since the hold is gone.
export function focusFileTab(path: string): void {
  const view = document.querySelector<HTMLElement>(`.file-view:not([data-place="pane"])[data-path="${CSS.escape(normalizePath(path))}"]`);
  if (view === null) return;
  const own = view.querySelector<HTMLElement>('.markdown-view, .transcript-view');
  if (own !== null) {
    own.focus();
    return;
  }
  const editor = (view.querySelector('.file-editor') as (HTMLElement & { emeraldEditor?: { getModel(): unknown; focus(): void } }) | null)?.emeraldEditor;
  if (editor !== undefined && editor.getModel() !== null) editor.focus();
}
