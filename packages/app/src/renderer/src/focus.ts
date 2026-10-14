// xterm's textarea in the focused pane, the one place keystrokes belong
// when the panes are showing. The files rail's filter and the tab strip
// hand the keyboard back through this.
export function focusTerminal(): void {
  const el = document.querySelector<HTMLElement>('.pane.focused .xterm-helper-textarea');
  el?.focus();
}
