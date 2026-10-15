// xterm's textarea in the focused pane, the one place keystrokes belong
// when the panes are showing. The files rail's filter and the tab strip
// hand the keyboard back through this. A pane on the chat face (M9 fix
// 689) takes them in its box instead.
export function focusTerminal(): void {
  const el = document.querySelector<HTMLElement>('.pane.focused[data-face="chat"] .chat-box') ?? document.querySelector<HTMLElement>('.pane.focused .xterm-helper-textarea');
  el?.focus();
}
