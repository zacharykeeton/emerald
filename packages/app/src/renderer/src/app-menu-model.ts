import { plainKeyFor } from './keys-model.ts';
import type { Action } from './keys-model.ts';
import type { UpdateState } from './update-model.ts';
import type { Skin } from './skin.ts';

// The app menu under the title row's Z mark (M9 fix 234): the three things
// a person could only reach by a chord or the palette, each with a hint
// that says how else to get there. What's new carries the build's version,
// so the menu says which build this is; the other two carry their keys.
// The fourth item (M9 fix 239) asks the updater for a check, its hint the
// updater's own state, so a person can see where an update stands without
// waiting for the four-hourly check or the badge.
export interface AppMenuItem {
  action: Action | 'check-updates' | 'toggle-skin';
  label: string;
  hint: string;
  // The updater is off in this build (a dev build or EMERALD_NO_UPDATE), so
  // the item says so and a click does nothing.
  disabled?: boolean;
}

// What the check item says beside its label for each phase of the updater.
export function updateHint(update: UpdateState | null): string {
  if (update === null) return '';
  switch (update.phase) {
    case 'off':
      return 'off in this build';
    case 'idle':
      // The last check's outcome (M9 fix 242): where the update stands,
      // rather than a blank that reads as never checked.
      return update.message ?? (update.latest === null ? '' : 'up to date');
    case 'checking':
      return 'checking…';
    case 'available':
      return `retry ${update.latest ?? ''}`;
    case 'downloading':
      return update.percent === null ? 'downloading…' : `downloading ${update.percent}%`;
    case 'ready':
      return 'restart to update';
    case 'installing':
      return 'installing…';
    case 'error':
      return 'failed, try again';
  }
}

export function appMenuItems(version: string | null, update: UpdateState | null = null, skin: Skin = 'classic'): AppMenuItem[] {
  return [
    // The file chooser (M9 fix 341), above the notes: the one item that
    // opens something of the person's own. Its chord is prefix-only, so
    // the hint is empty as a layout tab action's would be.
    { action: 'open-file', label: 'Open a file…', hint: plainKeyFor('open-file') },
    { action: 'whats-new', label: "What's new", hint: version ?? '' },
    { action: 'cheat-sheet', label: 'Key cheat sheet', hint: plainKeyFor('cheat-sheet') },
    { action: 'open-actions', label: 'Run an action…', hint: plainKeyFor('open-actions') },
    // The skin (M9 fix 569): the label names the skin on show, and a click
    // flips to the other, stored, with no restart.
    { action: 'toggle-skin', label: skin === 'emerald' ? 'Skin: Emerald' : 'Skin: Classic', hint: '' },
    { action: 'check-updates', label: 'Check for updates', hint: updateHint(update), disabled: update === null || update.phase === 'off' },
  ];
}
