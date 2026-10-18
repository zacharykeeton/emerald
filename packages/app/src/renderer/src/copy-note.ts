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

// M9 fix 849: a note with the pane a copy came from, or null for a note of
// the window's ("Nothing is waiting", Design Mode's copies).
export interface CornerNote {
  text: string;
  paneId: string | null;
}

// The note's text where it is drawn: in its own pane, or in the window's
// corner for a note with no pane.
export function noteIn(note: CornerNote | null, paneId: string | null): string | null {
  return note !== null && note.paneId === paneId ? note.text : null;
}
