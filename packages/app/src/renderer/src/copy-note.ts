// M9 fix 806: what the corner note says after a copy out of a pane. A text
// that holds a line break is counted in lines, a trailing break not making
// a line of its own; a text within one line is counted in characters, by
// code point, so an emoji counts once.
export function copiedNote(text: string): string {
  if (/\r\n|\r|\n/.test(text)) {
    const lines = text.replace(/(\r\n|\r|\n)$/, '').split(/\r\n|\r|\n/).length;
    return `Copied ${lines} line${lines === 1 ? '' : 's'}`;
  }
  const chars = [...text].length;
  return `Copied ${chars} character${chars === 1 ? '' : 's'}`;
}
