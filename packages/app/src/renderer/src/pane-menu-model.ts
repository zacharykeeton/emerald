import type { SessionInfo, ShellId, ShellOption } from '@emerald/shared';
import { plainKeyFor } from './keys-model.ts';
import type { Action } from './keys-model.ts';

// The pane menu's items as facts (M9 fix 202): one list the right-click
// menu in Pane.tsx and ViewPane.tsx draws and the action palette lists,
// so the two cannot drift. Pure, with no closures: each item names what
// it does (`run`) and the pane maps that to its own handler; an item
// that doubles a key names its binding (`action`), and the palette lists
// those under Keys with their chords and only the rest under Pane. No
// DOM, so node:test covers it.

export type PaneMenuRun =
  | 'split-right'
  | 'split-down'
  | 'zoom'
  | 'text-reset'
  | 'new-shell'
  | 'new-claude'
  | 'rename'
  | 'pick'
  | 'find'
  | 'review'
  | 'hide'
  | 'close-session'
  | 'open-as-tab'
  | 'toggle-chrome'
  | 'set-folder';

// What a split gives (M9 fix 537): an empty pane unless the person picked a
// shell or a Claude as the default.
export type SplitKind = 'empty' | 'shell' | 'claude';

export interface PaneMenuItem {
  run: PaneMenuRun;
  label: string;
  // The binding this item doubles, or null for an item only the menu and
  // the palette's Pane group offer.
  action: Action | null;
  title?: string | undefined;
  disabled?: boolean | undefined;
  separator?: boolean | undefined;
  // M9 fix 647: the shell a new-shell item starts, when it is not the daemon's default.
  shell?: ShellId | undefined;
}

// The key hint the menu shows at the right, off the binding.
export function menuHint(item: PaneMenuItem): string | undefined {
  return item.action === null ? undefined : plainKeyFor(item.action);
}

// The Split items' title (M9 fixes 343, 537): what a split gives by
// default, and where, in the shape the folderless views already used.
function splitTitle(kind: SplitKind, hasFolder: boolean, where: 'beside' | 'below'): string {
  if (kind === 'empty') return `An empty pane ${where}`;
  const who = kind === 'claude' ? 'A Claude' : 'A shell';
  return hasFolder ? `${who} in this folder, ${where}` : `${who} ${where}`;
}

export interface SessionPaneFacts {
  // undefined while the pane is empty or the session is not in the store.
  session: SessionInfo | undefined;
  sessionId: string | null;
  zoomed: boolean;
  onlyPane: boolean;
  // What a split gives by default (M9 fix 343): the title says the kind.
  splitKind: SplitKind;
  // Whether this pane's text is already at its default size (M9 fix 390):
  // only then is Reset text size disabled, with a title saying so.
  atDefaultFontSize: boolean;
  // The installed shells past the default (M9 fix 647): one New <shell> here
  // item each, for the menu's Other shell here and the palette alike.
  others?: readonly ShellOption[] | undefined;
}

// A session pane's menu, empty pane included. The Colour row (M29) is not
// an item but a row of swatches; Pane.tsx puts it after Rename.
export function sessionPaneMenu({ session, sessionId, zoomed, onlyPane, splitKind, atDefaultFontSize, others = [] }: SessionPaneFacts): PaneMenuItem[] {
  const items: PaneMenuItem[] = [
    { run: 'split-right', label: 'Split right', action: 'split-vertical', title: splitTitle(splitKind, session !== undefined, 'beside') },
    { run: 'split-down', label: 'Split down', action: 'split-horizontal', title: splitTitle(splitKind, session !== undefined, 'below') },
    { run: 'zoom', label: zoomed ? 'Unfocus' : 'Focus', action: 'toggle-focus', disabled: onlyPane && !zoomed, title: onlyPane && !zoomed ? 'Already the only pane' : undefined },
    // M9 fix 390: the wheel's only way back used to be the Ctrl+0 chord,
    // which no menu showed. Always on show, since a pane's size is its
    // own whether or not there is a session in it.
    { run: 'text-reset', label: 'Reset text size', action: 'text-reset', disabled: atDefaultFontSize, title: atDefaultFontSize ? 'Already at 14 px' : undefined },
    // M9 fix 419: the shell no longer takes the pane from the session
    // showing in it; it is started in room made beside it.
    { run: 'new-shell', label: 'New shell here', action: 'new-session', title: "A shell in this session's folder, beside it", separator: true },
    ...others.map((o): PaneMenuItem => ({ run: 'new-shell', shell: o.id, label: `New ${o.label} here`, action: null, title: `${o.label}, ${o.file}` })),
    { run: 'new-claude', label: 'New Claude session here', action: null },
    { run: 'rename', label: 'Rename session', action: null, disabled: session === undefined, title: 'An empty name follows the folder again' },
    { run: 'pick', label: 'Show a session here', action: 'pick-session' },
    { run: 'find', label: 'Find in scrollback', action: 'find', disabled: sessionId === null, title: sessionId === null ? 'Nothing to search' : 'Search what this session has written' },
  ];
  // M64: the session's changes as a diff to comment on; only offered when
  // there is a session, so an empty pane's menu is unchanged.
  if (session !== undefined) items.push({ run: 'review', label: 'Review changes', action: 'review', title: `The changes in ${session.cwd} as a diff, with comments sent back as one prompt` });
  items.push({
    // On an empty pane there is nothing to keep, so the same action is
    // plainly "close". The last pane empties instead of going, so only
    // an empty last pane has nothing to do.
    run: 'hide',
    label: sessionId === null ? 'Close pane' : 'Hide pane',
    action: 'close-pane',
    disabled: onlyPane && sessionId === null,
    title: onlyPane && sessionId === null ? 'Nothing to close' : hideTitle(onlyPane, false),
    separator: true,
  });
  if (sessionId !== null) items.push({ run: 'close-session', label: 'Close session', action: null, title: closeTitle(session, onlyPane) });
  return items;
}

export interface ViewPaneFacts {
  kind: 'commits' | 'activity' | 'file' | 'browser';
  // The commits view's folder; null for the others.
  folder: string | null;
  zoomed: boolean;
  onlyPane: boolean;
  // Whether the header and controls are showing, and whether the daemon
  // keeps that flag (only then is the item offered).
  chrome: boolean;
  stateKept: boolean;
  // What a split gives by default (M9 fix 343): the title says the kind.
  splitKind: SplitKind;
}

export function viewPaneMenu({ kind, folder, zoomed, onlyPane, chrome, stateKept, splitKind }: ViewPaneFacts): PaneMenuItem[] {
  const items: PaneMenuItem[] = [];
  // A file pane has no controls rows to fold; its header is the tab's,
  // and the same file as a tab is what it offers instead. Only a daemon
  // that keeps the flag gets the chrome item; on an older one the chrome
  // stays.
  // A browser pane (M9 fix 659) has neither: its toolbar is the pane.
  if (kind === 'file') items.push({ run: 'open-as-tab', label: 'Open as a tab', action: null, title: 'The same file on the tab strip; the pane stays' });
  else if (kind !== 'browser' && stateKept) {
    items.push({
      run: 'toggle-chrome',
      label: chrome ? 'Hide the chrome' : 'Show the chrome',
      action: null,
      title: chrome ? (kind === 'activity' ? 'Fold the title bar and the controls away; the stats line and the strip stay' : 'Fold the title bar, the branch line and the controls away; the graph stays') : 'The title bar and the controls back',
    });
  }
  items.push(
    { run: 'split-right', label: 'Split right', action: 'split-vertical', title: splitTitle(splitKind, folder !== null, 'beside') },
    { run: 'split-down', label: 'Split down', action: 'split-horizontal', title: splitTitle(splitKind, folder !== null, 'below') },
    { run: 'zoom', label: zoomed ? 'Unfocus' : 'Focus', action: 'toggle-focus', disabled: onlyPane && !zoomed, title: onlyPane && !zoomed ? 'Already the only pane' : undefined },
  );
  // An activity view has no folder to set; the window moves with the
  // view's own header.
  if (folder !== null) items.push({ run: 'set-folder', label: 'Set folder…', action: null, title: 'Show another repository here', separator: true });
  items.push(
    { run: 'pick', label: 'Show a session here', action: 'pick-session', title: 'A terminal in place of this view', separator: folder === null },
    {
      run: 'hide',
      label: 'Close pane',
      action: 'close-pane',
      title: onlyPane ? 'Empty this pane' : kind === 'file' ? 'Close this pane; the file stays in the rail' : kind === 'browser' ? 'Close this pane and its page' : kind === 'activity' ? 'Close this pane; the Activity tab of the files rail still has the day' : 'Close this pane; the Activity tab of the files rail still has the graph',
      separator: true,
    },
  );
  return items;
}

// The items the palette's Pane group lists: the ones no key reaches,
// and only those that would do something.
export function paneOnlyItems(items: readonly PaneMenuItem[]): PaneMenuItem[] {
  return items.filter((i) => i.action === null && i.disabled !== true);
}

// What the × does to this session, for its tooltip. The last pane stays
// on screen, empty, so the words say so.
export function closeTitle(session: SessionInfo | undefined, onlyPane: boolean): string {
  const pane = onlyPane ? 'leave the pane empty' : 'close the pane';
  if (session === undefined) return onlyPane ? 'Nothing to close' : 'Close this pane';
  if (session.state === 'exited') return `Close: forget ${session.name} and ${pane}`;
  if (session.kind === 'shell') return `Close: kill ${session.name} and ${pane}`;
  return `Close: kill ${session.name} and ${pane}; it waits under exited for 10 seconds, where Resume brings it back, then leaves the list`;
}

// M9 fix 126: a view pane has no session to keep running, so its hide
// says where the view comes back from instead.
export function hideTitle(onlyPane: boolean, view: boolean): string {
  const pane = onlyPane ? 'Empty this pane' : 'Close this pane';
  const rest = view ? "the view can be opened again from the rail's Activity tab" : 'the session keeps running and stays in the sidebar';
  return `${pane} (${plainKeyFor('close-pane')}); ${rest}`;
}
