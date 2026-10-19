import { DAEMON_FEATURE_LEVEL, currentTab, isSingleTree, wrapSingleTree } from '@emerald/shared';
import type { Layout, LayoutNode, LayoutTab, SessionInfo, SessionState, ShellOption, SingleTree } from '@emerald/shared';
import type { DaemonCrash, DaemonInfo } from '../../preload/api.ts';

// The daemon survives an app upgrade on purpose, so the window may be
// talking to an older build. These are the pure rules behind the banner
// that says so, and the guard that keeps an older daemon's records from
// drawing stray glyphs.

// A daemon that does not report a level predates the field, so it is level 1.
export function daemonLevel(daemon: DaemonInfo): number {
  return daemon.featureLevel ?? 1;
}

export function daemonOutdated(daemon: DaemonInfo | null, ours: number = DAEMON_FEATURE_LEVEL): boolean {
  return daemon !== null && daemonLevel(daemon) < ours;
}

export function outdatedText(daemon: DaemonInfo, ours: number = DAEMON_FEATURE_LEVEL): string {
  return `emmerd (pid ${daemon.pid}) is an older build than this window: it reports level ${daemonLevel(daemon)}, the app expects ${ours}. Restart it to get the new features; running sessions come back as exited and can be resumed.`;
}

// The banner for a daemon serving another home (M9 fix 495); only called
// with otherHome set.
export function otherHomeText(daemon: DaemonInfo): string {
  const { theirs, mine } = daemon.otherHome ?? { theirs: '?', mine: '?' };
  return `emmerd on another home: it serves ${theirs}, and this window's home is ${mine}. Its sessions and layout belong to that home.`;
}

// The banner for a daemon this window started that crashed (M9 fix 815):
// the words plain, the pid and the code in the tooltip.
export const CRASHED_TEXT = 'emmerd stopped unexpectedly and was restarted. The sessions it held have ended.';

export function crashedTitle(crash: DaemonCrash): string {
  return `emmerd pid ${crash.pid} exited with code 0x${crash.code}`;
}

const KNOWN_STATES:ReadonlySet<string> = new Set<SessionState>(['starting', 'idle', 'working', 'waiting', 'needs-input', 'done', 'errored', 'exited']);

// Fields added after the daemon was built arrive missing, not null; the
// renderer's checks are against null, so fill them in once, on receipt. A
// state this build has never heard of (a daemon newer than the window)
// reads as idle, which asks nothing of the person.
export function normalizeSession(raw: SessionInfo): SessionInfo {
  return {
    ...raw,
    state: KNOWN_STATES.has(raw.state) ? raw.state : 'idle',
    branch: raw.branch ?? null,
    // A daemon before level 61 (M9 fix 624) does not say which shell.
    shell: raw.shell ?? null,
    lastPrompt: raw.lastPrompt ?? null,
    lastReply: raw.lastReply ?? null,
    lastPromptAt: raw.lastPromptAt ?? null,
    lastReplyAt: raw.lastReplyAt ?? null,
    model: raw.model ?? null,
    // A daemon before level 67 (M9 fix 799) sends no effort.
    effort: raw.effort ?? null,
    contextPercent: raw.contextPercent ?? null,
    contextWindow: raw.contextWindow ?? null,
    tokens: raw.tokens ?? null,
    // A daemon before level 38 (M9 fix 154) has no cost.
    costUsd: raw.costUsd ?? null,
    comment: raw.comment ?? null,
    phase: raw.phase ?? null,
    color: raw.color ?? null,
    title: raw.title ?? null,
    transcriptPath: raw.transcriptPath ?? null,
    liveReply: raw.liveReply ?? null,
    liveTool: raw.liveTool ?? null,
    // A daemon before level 38 (M9 fix 158) has no spinner word.
    liveVerb: raw.liveVerb ?? null,
    waitingOn: raw.waitingOn ?? [],
    team: raw.team ?? [],
    conversation: raw.conversation ?? null,
    shellCwd: raw.shellCwd ?? null,
    remoteSessionId: raw.remoteSessionId ?? null,
    // A daemon before level 31 (M9 fix 117) has no start commit.
    startHead: raw.startHead ?? null,
    // A daemon before level 25 sends bare hashes (M49); those read as
    // claims at time zero, so any timed claim on the same hash wins.
    commits: (raw.commits ?? []).map((c) => (typeof c === 'string' ? { hash: c, at: 0 } : c)),
    // A daemon before M9 fix 60 groups by the live folder.
    groupCwd: raw.groupCwd ?? raw.cwd,
  };
}

// The level at which the daemon started to carry layout tabs (M36).
export const TABS_LEVEL = 9;

// The one steady id for the tab an older daemon's single tree is wrapped
// as, so the panes are not remounted on every push.
export const LEGACY_TAB_ID = 'panes';

// An older daemon sends one tree where this window expects tabs; it is
// read as one tab named Panes so the window works against it until the
// restart the banner offers.
export function normalizeLayout(raw: Layout | SingleTree): Layout {
  const layout = isSingleTree(raw) ? wrapSingleTree(raw as SingleTree, LEGACY_TAB_ID) : (raw as Layout);
  return fillViews(layout);
}

// A pane from a daemon before M52 has no view field; the renderer reads
// null. Nodes that already carry one keep their identity, so a push from
// a current daemon remounts nothing.
function fillViews(layout: Layout): Layout {
  let changed = false;
  const fill = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') {
      if (node.view !== undefined) return node;
      changed = true;
      return { ...node, view: null };
    }
    const first = fill(node.first);
    const second = fill(node.second);
    return first === node.first && second === node.second ? node : { ...node, first, second };
  };
  const tabs: LayoutTab[] = layout.tabs.map((tab) => {
    const root = fill(tab.root);
    return root === tab.root ? tab : { ...tab, root };
  });
  return changed ? { ...layout, tabs } : layout;
}

// The level at which a pane may hold a view in place of a session (M52).
// An older daemon's validation drops the field, so the rail's Commits
// tab does not drag and the heading offers no view until the restart.
export const VIEWS_LEVEL = 23;

export function viewsSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= VIEWS_LEVEL;
}

// The level at which the daemon reports its shells and takes shell on
// session.spawn (M9 fix 624); an older one ignores the field and starts
// PowerShell, so the window offers no other shell until the restart.
export const SHELL_CHOICE_LEVEL = 61;

// The installed shells past the default, for Other shell here; none on a
// daemon under the level, even one that reports shells.
export function otherShells(daemon: DaemonInfo | null): ShellOption[] {
  if (daemon === null || daemonLevel(daemon) < SHELL_CHOICE_LEVEL) return [];
  return (daemon.shells ?? []).slice(1);
}

// Every installed shell the daemon reports, the default first, for the
// empty pane's Shell tile (M9 fix 647); none under the level.
export function installedShells(daemon: DaemonInfo | null): ShellOption[] {
  if (daemon === null || daemonLevel(daemon) < SHELL_CHOICE_LEVEL) return [];
  return daemon.shells ?? [];
}

// The level at which a commits view keeps the strip's scope (M66). An
// older daemon drops the field, so the pane's strip shows the folder
// with no toggle until the restart.
export const STRIP_SCOPE_LEVEL = 30;

export function stripScopeSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= STRIP_SCOPE_LEVEL;
}

// The level at which a pane may hold an activity view (M69). An older
// daemon refuses the kind outright, so the rail's day card offers no
// pane button until the restart; the commits one needs VIEWS_LEVEL only.
export const ACTIVITY_VIEW_LEVEL = 32;

export function activityViewSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= ACTIVITY_VIEW_LEVEL;
}

// The level at which a commits view keeps its rows flag (M9 fix 162);
// an older daemon drops the field from the record, so the button would
// do nothing and is not shown.
export const ROWS_FLAG_LEVEL = 38;

export function rowsFlagSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= ROWS_FLAG_LEVEL;
}

// The level at which a view record keeps the state a pane opened from
// the rail carries (M9 fix 178: a commits view's graph settings, an
// activity view's scope, folder and layers) and its chrome flag (M9 fix
// 179). An older daemon drops the fields, so a pane on one keeps the
// shared prefs as before and offers no chrome item.
export const VIEW_STATE_LEVEL = 39;

export function viewStateSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= VIEW_STATE_LEVEL;
}

// The level at which the daemon keeps a commits view's zoom on its graph
// record (M9 fix 213). An older daemon drops the field, and a pane whose
// record it is would snap back to 1 on every write, so Ctrl+wheel does
// nothing in a pane on one; the rail and the tabs zoom as before.
export const GRAPH_SCALE_LEVEL = 43;

export function graphScaleSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= GRAPH_SCALE_LEVEL;
}

// The level at which the daemon keeps `remotes` on a commits view's
// graph record (M9 fix 286). An older daemon drops the field, so a pane
// on one shows no remotes chip; the rail and the tabs keep the flag in
// their own prefs and offer it anywhere.
export const GRAPH_REMOTES_LEVEL = 50;

export function graphRemotesSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= GRAPH_REMOTES_LEVEL;
}

// The level at which the daemon keeps `panes` as an activity view's
// scope on its pane record (M9 fix 250). An older daemon's validator
// refuses the value, so a pane on one cycles all and the folder alone;
// a tab keeps the scope in its own query and cycles the three anywhere.
export const PANES_SCOPE_LEVEL = 48;

export function panesScopeSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= PANES_SCOPE_LEVEL;
}

// The level at which the daemon keeps `here` as an activity pane's
// scope (M9 fix 261), the sessions on the panes of the tab holding it;
// a pane on an older daemon skips the step as it skips the panes one.
export const HERE_SCOPE_LEVEL = 49;

export function hereScopeSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= HERE_SCOPE_LEVEL;
}

// The level at which a pane may hold a file view (M9 fix 180). An older
// daemon refuses the kind outright (its validator names the two it
// knows), so the rail's rows and the file tabs do not drag and the row
// menu offers no pane until the restart.
export const FILE_VIEW_LEVEL = 39;

export function fileViewSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= FILE_VIEW_LEVEL;
}

// The level at which a pane may hold a browser view (M9 fix 659). An
// older daemon's validator refuses the kind, so nothing offers a browser
// pane until the restart.
export const BROWSER_VIEW_LEVEL = 62;

export function browserViewSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= BROWSER_VIEW_LEVEL;
}

// The level at which the daemon keeps an activity pane's usage flag (M9
// fix 766); an older daemon's validator drops the field, so a pane on one
// keeps the flag in its own state for its life.
export const USAGE_FLAG_LEVEL = 65;

export function usageFlagSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= USAGE_FLAG_LEVEL;
}

// The level at which the daemon answers activity.totals (M9 fix 836); an
// older daemon answers bad-request, so no menu offers the Statistics tab
// and a tab kept from before says to restart.
export const STATS_LEVEL = 70;

export function statsSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= STATS_LEVEL;
}

// The level at which the daemon keeps a browser view's toolbar flag (M9 fix 839); an older daemon's validator drops the field, so a pane on one offers no item.
export const BROWSER_TOOLBAR_LEVEL = 71;

export function browserToolbarSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= BROWSER_TOOLBAR_LEVEL;
}

// The level at which the daemon holds windows on the layout and answers window.open, window.close and window.front (M9 fix 865); an older one offers no New window and no Move to new window.
export const WINDOWS_LEVEL = 73;

export function windowsSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= WINDOWS_LEVEL;
}

// The level at which the daemon keeps folder labels (M9 fix 194); an
// older daemon answers folders.list with bad-request, so the heading
// offers no rename and the store keeps an empty map.
export const FOLDER_LABELS_LEVEL = 39;

export function folderLabelsSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= FOLDER_LABELS_LEVEL;
}

// The level at which the daemon reads the conflict forecast (M9 fix
// 320); an older daemon answers conflicts.get with bad-request, so the
// store keeps the empty report and nothing draws.
export const CONFLICTS_LEVEL = 52;

export function conflictsSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= CONFLICTS_LEVEL;
}

// Whether the daemon can hold more than one tab. The strip offers no +
// and the tab keys do nothing on an older one, since a second tab would
// be sent as its tree alone and take the first one's place.
export function tabsSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= TABS_LEVEL;
}

// The saved prompts (M56): prompts.list and prompts.set arrived at 22; an
// older daemon answers them with unknown request type, so the box keeps
// its arrows to the recent ones and offers no save.
const PROMPTS_LEVEL = 22;

export function promptsSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= PROMPTS_LEVEL;
}

// What goes back to the daemon for an edit: the whole layout, or for an
// older daemon its current tab as the single tree it knows.
export function layoutForWire(layout: Layout, daemon: DaemonInfo | null): Layout | SingleTree {
  if (daemon === null || daemonLevel(daemon) >= TABS_LEVEL) return layout;
  const tab = currentTab(layout);
  return { root: tab.root, focusedPaneId: tab.focusedPaneId, revision: layout.revision };
}

// The level at which the daemon answers activity.spans (M54). The card
// and the tab show nothing on an older one, which has no working spans
// to give; the banner offers the restart.
export const ACTIVITY_LEVEL = 24;

export function activitySupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= ACTIVITY_LEVEL;
}

// The level at which a row of activity.spans carries its waiting
// stretches (M9 fix 231). An older daemon's rows read as owing nothing,
// so the card, the gutter and the mirror draw nothing rather than a zero
// that means "unknown".
export const DEBT_LEVEL = 44;

export function debtSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= DEBT_LEVEL;
}

// The level at which the daemon keeps a removed session's record (M57)
// and answers session.list { removed: true } with them: the Commits tab
// keeps their lanes. An older daemon forgets a removed session for good.
export const KEPT_LEVEL = 25;

export function keptSupported(daemon: DaemonInfo | null): boolean {
  return daemon !== null && daemonLevel(daemon) >= KEPT_LEVEL;
}
