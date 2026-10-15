// M9 fix 424: main/index.ts's console-message line names the renderer's
// warning or error (M9 fix 355), but its sourceId cannot tell a bundled
// library's line from emerald's own; every emerald line already starts with
// "[emerald] " by the console.warn/console.error convention this file
// carries into the log. A message with no such prefix is marked [lib]
// instead, the source and line kept on both. Imports nothing, so a test
// runs it under node --test with no electron, the read-cap.ts shape.
export function rendererLogLine(level: string, message: string, sourceId: string, lineNumber: number): string {
  const body = message.startsWith('[emerald] ') ? message : `[lib] ${message}`;
  // Electron's <webview> teardown asks main about a guest it has already let go at each browser pane's close (M9 fix 694); nothing of ours to fix, and an error per closed page was noise in every report.
  const shown = level === 'error' && /^Uncaught Error: Invalid guestInstanceId: \d+$/.test(message) && sourceId.startsWith('node:electron/js2c/isolated_bundle') ? 'note' : level;
  return `renderer: ${shown} ${body} (${sourceId}:${lineNumber})`;
}
