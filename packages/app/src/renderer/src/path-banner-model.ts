// The PATH banner's words (M9 fix 1026): on a Mac whose login shell has no
// emmer, the window offers the line that links the bundle's shim onto the
// PATH. The runner's smoke (fix 1028) reads the text span's whole
// textContent, which is pathNoteText(command).

export const PATH_NOTE_LEAD = 'emmer is not on your PATH. Paste in a terminal:';
export const PATH_COPIED_NOTE = 'Copied; paste it in a terminal';

export function pathNoteText(command: string): string {
  return `${PATH_NOTE_LEAD} ${command}`;
}

// Where the hooks strip stands (M9 fix 1072): still checking at mount, up,
// or down (never needed, dismissed, installed, or the check failed).
export type HooksBannerState = 'checking' | 'up' | 'down';

// One strip at a time on a Mac's first launch, hooks then PATH (M9 fix
// 1072): the PATH strip waits while the hooks strip is up or still being
// checked, since the two asks race at mount, and rises once it is down.
export function pathBannerShows(command: string | null, hooks: HooksBannerState): boolean {
  return command !== null && hooks === 'down';
}
