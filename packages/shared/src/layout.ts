export type SplitDirection = 'row' | 'column';

// What a pane shows when it shows no terminal (M52): a view of something
// pinned to a folder, the Commits tab's graph for one repository. A pane
// holds a session or a view, never both; the daemon stores the leaf and
// validates its shape, so a new field on a view bumps the feature level.
// From M66 to M9 fix 130 the view carried the day's strip above the
// commits, kept to the folder's sessions, every session, or the sessions
// in the pane's own layout tab; the pane is the graph alone now, and the
// field is still accepted from layouts on disk and read by nothing.
export type ActivityStripScope = 'folder' | 'all' | 'tab';

// M9 fix 162: `rows: false` on a commits view is the graph's lines alone,
// the commit rows dropped and the pills and agent labels drawn in the
// SVG, so a pane a gutter wide can stand beside the tab strip as a
// picture of the workers; absent or true, the rows draw. It rides the
// pane's record rather than the graph's shared prefs, since the ask is
// one pane's shape and the rail keeps its rows.
//
// M69: a second kind, the activity view of one window (a day, an hour or
// a minute, the key `unitBounds` reads), the same body the activity tab
// shows. It has no folder: a window's sessions are every session of the
// machine, as the tab's are.
//
// M9 fix 178: a pane opened from the rail is a snapshot of the section as
// it stood, and keeps its own state from then on, so the state rides the
// record: a commits view's graph settings (`graph`, every field optional
// and absent at its default, so a bare record reads as before) and an
// activity view's scope, the folder it keeps to (`folder` with `scope`
// absent is every session, with the folder there for the toggle) and its
// layers. M9 fix 179: `chrome: false` folds the pane's title bar and the
// view's controls away, leaving the graph or the strip alone; kept only
// when false, like `rows`.
export type GraphViewMode = 'graph' | 'list';
export type GraphViewOrientation = 'vertical' | 'horizontal';
export type GraphViewDraw = 'all' | 'active';
export type GraphViewLayout = 'graph' | 'line';
// The zoom steps of the commits graph (M9 fix 213), 1 the drawing as it
// is; a record keeps the scale only away from 1.
export const GRAPH_SCALE_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2] as const;
export type GraphScale = (typeof GRAPH_SCALE_STEPS)[number];
export function isGraphScale(v: unknown): v is GraphScale {
  return typeof v === 'number' && (GRAPH_SCALE_STEPS as readonly number[]).includes(v);
}
export interface GraphViewState {
  mode?: GraphViewMode;
  orientation?: GraphViewOrientation;
  reverse?: boolean;
  draw?: GraphViewDraw;
  hidden?: readonly string[];
  solo?: string;
  layout?: Readonly<Record<string, GraphViewLayout>>;
  scale?: GraphScale;
  // The remote branches on the graph (M9 fix 286), kept only when on.
  remotes?: boolean;
}
// The view's scope (M9 fix 178): every session, the folder it was
// opened on, (M9 fix 250) the sessions on a pane of any tab, or (M9
// fix 261) `here`, the sessions on the panes of the tab holding the
// view's own pane.
export type ActivityViewScope = 'folder' | 'all' | 'panes' | 'here';
export type ActivityViewLayers = 'both' | 'band' | 'lanes';
export type CommitsPaneView = { kind: 'commits'; folder: string; strip?: { scope: ActivityStripScope }; rows?: boolean; graph?: GraphViewState; chrome?: boolean };
// usage: kept only when false, the row hidden (M9 fix 766, level 65).
export type ActivityPaneView = { kind: 'activity'; window: string; scope?: ActivityViewScope; folder?: string; layers?: ActivityViewLayers; chrome?: boolean; usage?: boolean };
// M9 fix 180: a third kind, one file, the body a file tab shows (the
// editor, a markdown file rendered or raw, a transcript's turns), so a
// file from the rail can sit in the layout beside the shells. The path
// is normalized as the tabs normalize it; `view` is the switch the tab
// keeps in its model, absent for the file's own default. M9 fix 339: a
// .json file's own view is pretty, the text formatted and read-only.
export type FileTabView = 'rendered' | 'raw' | 'turns' | 'pretty';
export type FilePaneView = { kind: 'file'; path: string; view?: FileTabView };
// M9 fix 659: a fourth kind, a web page in a pane. `url` is the page's
// address as browserUrl writes it, or '' while the pane's address bar
// has not been filled; the toolbar row sits inside the pane, as a file
// pane's header does, so there is no chrome field. M9 fix 673: profile
// names the page's own cookies and storage (BROWSER_PROFILE); absent is
// the shared default. M9 fix 839: toolbar, kept only when false, hides
// that row alone from the pane menu, the title bar staying.
export type BrowserPaneView = { kind: 'browser'; url: string; profile?: string; toolbar?: false };
export type PaneView = CommitsPaneView | ActivityPaneView | FilePaneView | BrowserPaneView;

export type LayoutNode =
  | { kind: 'split'; id: string; direction: SplitDirection; ratio: number; first: LayoutNode; second: LayoutNode }
  | { kind: 'pane'; id: string; sessionId: string | null; view: PaneView | null };

// One split tree with a focused pane: what the pure tree ops in tree.ts
// work on. A tab is one of these with a name; the shape before M36 was one
// of these with the revision on it.
export interface PaneTree {
  root: LayoutNode;
  focusedPaneId: string;
}

// One layout among several (M36), like a tmux window: its own tree and its
// own focus. Pane ids are unique across every tab, so a pane names its tab.
export interface LayoutTab extends PaneTree {
  id: string;
  name: string;
}

export interface Layout {
  tabs: LayoutTab[];
  // The tab the window shows; every client shows the same one.
  currentTabId: string;
  // Daemon increments on every accepted change. A client sends the revision it
  // based its edit on and the daemon rejects stale edits, so two panes racing
  // to split cannot silently overwrite each other. One revision for every
  // tab, so a switch and a split race the same way.
  revision: number;
}

// The wire and disk shape before M36: one tree, no tabs. Still read from
// state.json (migrated to one tab) and still accepted by layout.set as an
// edit to the current tab, so a script written against one tree works.
export interface SingleTree extends PaneTree {
  revision: number;
}
