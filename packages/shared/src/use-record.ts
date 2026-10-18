// The usage record's vocabulary (M9 fix 676): the names a line in
// <EMERALD_HOME>/logs/usage.jsonl may carry, and the one check every line
// passes before main writes it. The renderer sends, main writes, `emmer
// usage report` (fix 677) reads, so all three agree on the words here.
// Nothing from node, since the renderer imports the barrel. "usage" is
// already the Claude account's usage windows (main/usage.ts,
// usage-model.ts), so the modules say use-record and only the file on
// disk and the CLI verb say usage.

// Where an action came from: a chord, a click, a menu or the palette, or
// the CLI (`emmer open` relayed to the window).
export const USE_FROM = ['key', 'click', 'menu', 'cli'] as const;
export type UseFrom = (typeof USE_FROM)[number];

// The kinds of view a line may name: what is in front when an action
// runs, and what opens and closes.
export const USE_VIEWS = [
  'session-pane',
  'empty-pane',
  'commits-pane',
  'activity-pane',
  'file-pane',
  'browser-pane',
  'other-pane',
  'file-tab',
  'transcript-tab',
  'review-tab',
  'activity-tab',
  'commits-tab',
  'stats-tab',
  'whats-new-tab',
  'other-tab',
  'cheat-sheet',
] as const;
export type UseView = (typeof USE_VIEWS)[number];

export type UseFeatureGroup = 'keys' | 'pane-menu' | 'clicks' | 'cli';

export interface UseFeature {
  name: string;
  label: string;
  group: UseFeatureGroup;
}

// Every feature the record knows by name, one row each, which is also the
// report's "never used" list. The keys rows mirror the renderer's BINDINGS
// (a renderer test fails when a binding has no row here, so a new chord
// adds its row in the same commit); the pane-menu rows are `pane-` plus
// each PaneMenuRun with the menu's own wording; the clicks rows are the
// recorded functions of actions.ts and a few buttons.
export const USE_FEATURES: readonly UseFeature[] = [
  { name: 'split-vertical', label: 'Split right', group: 'keys' },
  { name: 'split-horizontal', label: 'Split down', group: 'keys' },
  { name: 'close-pane', label: 'Hide pane', group: 'keys' },
  { name: 'toggle-focus', label: 'Focus pane', group: 'keys' },
  { name: 'focus-left', label: 'Focus left', group: 'keys' },
  { name: 'focus-right', label: 'Focus right', group: 'keys' },
  { name: 'focus-up', label: 'Focus up', group: 'keys' },
  { name: 'focus-down', label: 'Focus down', group: 'keys' },
  { name: 'focus-next', label: 'Focus next pane', group: 'keys' },
  { name: 'focus-prev', label: 'Focus previous pane', group: 'keys' },
  { name: 'pick-session', label: 'Show a session here', group: 'keys' },
  { name: 'jump', label: 'Jump to a session', group: 'keys' },
  { name: 'jump-waiting', label: 'Jump to the session waiting longest', group: 'keys' },
  { name: 'open-actions', label: 'Run an action', group: 'keys' },
  { name: 'new-session', label: 'New shell here', group: 'keys' },
  { name: 'toggle-sidebar', label: 'Toggle sidebar', group: 'keys' },
  { name: 'toggle-files', label: 'Toggle files', group: 'keys' },
  { name: 'next-tab', label: 'Next tab', group: 'keys' },
  { name: 'prev-tab', label: 'Previous tab', group: 'keys' },
  { name: 'new-layout-tab', label: 'New layout tab', group: 'keys' },
  { name: 'next-layout-tab', label: 'Next layout tab', group: 'keys' },
  { name: 'prev-layout-tab', label: 'Previous layout tab', group: 'keys' },
  { name: 'cheat-sheet', label: 'Key cheat sheet', group: 'keys' },
  { name: 'text-bigger', label: 'Bigger text', group: 'keys' },
  { name: 'text-smaller', label: 'Smaller text', group: 'keys' },
  { name: 'text-reset', label: 'Reset text size', group: 'keys' },
  { name: 'find', label: 'Find in scrollback', group: 'keys' },
  { name: 'review', label: 'Review changes', group: 'keys' },
  { name: 'history-back', label: 'Back in the focus history', group: 'keys' },
  { name: 'history-forward', label: 'Forward in the focus history', group: 'keys' },
  { name: 'whats-new', label: "What's new", group: 'keys' },
  { name: 'open-file', label: 'Open a file…', group: 'keys' },
  { name: 'design-mode', label: 'Design Mode', group: 'keys' },
  { name: 'toggle-chat', label: 'Chat or terminal', group: 'keys' },
  { name: 'shade-all', label: 'Shade or lift all', group: 'keys' },
  { name: 'shade-pane', label: 'Shade or lift pane', group: 'keys' },
  { name: 'pane-split-right', label: 'Split right', group: 'pane-menu' },
  { name: 'pane-split-down', label: 'Split down', group: 'pane-menu' },
  { name: 'pane-zoom', label: 'Focus', group: 'pane-menu' },
  { name: 'pane-text-reset', label: 'Reset text size', group: 'pane-menu' },
  { name: 'pane-new-shell', label: 'New shell here', group: 'pane-menu' },
  { name: 'pane-new-claude', label: 'New Claude session here', group: 'pane-menu' },
  { name: 'pane-rename', label: 'Rename session', group: 'pane-menu' },
  { name: 'pane-pick', label: 'Show a session here', group: 'pane-menu' },
  { name: 'pane-find', label: 'Find in scrollback', group: 'pane-menu' },
  { name: 'pane-review', label: 'Review changes', group: 'pane-menu' },
  { name: 'pane-hide', label: 'Hide pane', group: 'pane-menu' },
  { name: 'pane-close-session', label: 'Close session', group: 'pane-menu' },
  { name: 'pane-open-as-tab', label: 'Open as a tab', group: 'pane-menu' },
  { name: 'pane-toggle-chrome', label: 'Hide the chrome', group: 'pane-menu' },
  { name: 'pane-toggle-toolbar', label: 'Hide browser chrome', group: 'pane-menu' },
  { name: 'pane-set-folder', label: 'Set folder…', group: 'pane-menu' },
  { name: 'show-beside', label: 'Show a session beside', group: 'clicks' },
  { name: 'show-in-new-tab', label: 'Show a session in a new layout tab', group: 'clicks' },
  { name: 'drop-session', label: 'Drop a session on a pane', group: 'clicks' },
  { name: 'drop-view', label: 'Drop a view on a pane', group: 'clicks' },
  { name: 'drop-on-layout-tab', label: 'Drop on a layout tab', group: 'clicks' },
  { name: 'drop-on-new-tab', label: 'Drop on the new layout tab button', group: 'clicks' },
  { name: 'open-view-beside', label: 'Open a view beside', group: 'clicks' },
  { name: 'drop-folder', label: 'Drop a folder on a pane', group: 'clicks' },
  { name: 'drop-file', label: 'Drop a file on a pane', group: 'clicks' },
  { name: 'drop-file-tab', label: 'Drop a file on the tab strip or the Files rail', group: 'clicks' },
  { name: 'drop-path', label: "Drop a file on a session's pane", group: 'clicks' },
  { name: 'rename-session', label: 'Rename a session', group: 'clicks' },
  { name: 'set-colour', label: "Set a session's colour", group: 'clicks' },
  { name: 'set-scheme', label: "Set a session's colour scheme", group: 'clicks' },
  { name: 'set-keep-whole', label: 'Mark a session to keep whole while idle', group: 'clicks' },
  { name: 'set-folder-label', label: "Set a folder's label", group: 'clicks' },
  { name: 'kill-session', label: 'Kill a session', group: 'clicks' },
  { name: 'resume-beside', label: 'Resume a session beside', group: 'clicks' },
  { name: 'clear-exited', label: 'Clear the exited sessions', group: 'clicks' },
  { name: 'resume-all', label: 'Resume every exited session', group: 'clicks' },
  { name: 'sweep-sessions', label: 'Sweep sessions', group: 'clicks' },
  { name: 'hide-pane', label: 'Hide a pane', group: 'clicks' },
  { name: 'close-session', label: "Close a pane's session", group: 'clicks' },
  { name: 'resume-transcript', label: 'Resume a transcript', group: 'clicks' },
  { name: 'shell-beside', label: 'Start a shell beside', group: 'clicks' },
  { name: 'split-here', label: 'Split a pane', group: 'clicks' },
  { name: 'pull-pane', label: 'Pull a pane into a split', group: 'clicks' },
  { name: 'rename-layout-tab', label: 'Rename a layout tab', group: 'clicks' },
  { name: 'close-layout-tab', label: 'Close a layout tab', group: 'clicks' },
  { name: 'empty-start-shell', label: "Start a shell from an empty pane", group: 'clicks' },
  { name: 'empty-start-claude', label: 'Start a Claude session from an empty pane', group: 'clicks' },
  { name: 'toggle-skin', label: 'Switch the skin', group: 'clicks' },
  { name: 'check-updates', label: 'Check for updates', group: 'clicks' },
  { name: 'file-launch', label: 'Open a file from Explorer', group: 'clicks' },
  { name: 'folder-launch', label: 'Open a folder from Explorer', group: 'clicks' },
  { name: 'cli-open', label: 'emmer open', group: 'cli' },
];

export const USE_NAMES: ReadonlySet<string> = new Set(USE_FEATURES.map((f) => f.name));

// About forty thousand lines a generation, four generations kept beside
// the current file, the hook log's rotation in small.
export const USE_RECORD_ROTATE_AT_BYTES = 4 * 1024 * 1024;
export const USE_RECORD_GENERATIONS = 4;
// A view shut, a drop undone or a split closed within this long reads as
// friction in the report (fix 677).
export const USE_FRICTION_MS = 3000;

export type UseLineIn =
  | { ev: 'action'; name: string; from: UseFrom; view?: UseView }
  | { ev: 'view-open'; view: UseView }
  | { ev: 'view-close'; view: UseView; ms: number }
  // M9 fix 699: the switch's own line, so the report knows when the record was on.
  | { ev: 'switch'; on: boolean };

const FROM_SET: ReadonlySet<string> = new Set(USE_FROM);
const VIEW_SET: ReadonlySet<string> = new Set(USE_VIEWS);

function isView(v: unknown): v is UseView {
  return typeof v === 'string' && VIEW_SET.has(v);
}

// A line the renderer sent, reduced to the fields a line may carry, or
// null when any of them is not a known word. Copying field by field means
// no text, path or prompt reaches the file even from a renderer that
// tried to send one.
export function useLineOf(raw: unknown): UseLineIn | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.ev === 'action') {
    if (typeof r.name !== 'string' || !USE_NAMES.has(r.name)) return null;
    if (typeof r.from !== 'string' || !FROM_SET.has(r.from)) return null;
    if (r.view === undefined) return { ev: 'action', name: r.name, from: r.from as UseFrom };
    if (!isView(r.view)) return null;
    return { ev: 'action', name: r.name, from: r.from as UseFrom, view: r.view };
  }
  if (r.ev === 'view-open') {
    if (!isView(r.view)) return null;
    return { ev: 'view-open', view: r.view };
  }
  if (r.ev === 'view-close') {
    if (!isView(r.view)) return null;
    const ms = r.ms;
    if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0 || ms > 2 ** 31) return null;
    return { ev: 'view-close', view: r.view, ms };
  }
  if (r.ev === 'switch') {
    if (typeof r.on !== 'boolean') return null;
    return { ev: 'switch', on: r.on };
  }
  return null;
}
