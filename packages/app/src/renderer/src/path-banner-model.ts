// The PATH banner's words (M9 fix 1026): on a Mac whose login shell has no
// emmer, the window offers the line that links the bundle's shim onto the
// PATH. The runner's smoke (fix 1028) reads the text span's whole
// textContent, which is pathNoteText(command).

export const PATH_NOTE_LEAD = 'emmer is not on your PATH. Paste in a terminal:';
export const PATH_COPIED_NOTE = 'Copied; paste it in a terminal';

export function pathNoteText(command: string): string {
  return `${PATH_NOTE_LEAD} ${command}`;
}
