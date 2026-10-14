import { isGraphScale } from '@emerald/shared';
import { readScope } from './activity-scope.ts';
import type { ActivityPaneView, ActivityViewLayers, ActivityViewScope, CommitsPaneView, GraphViewLayout, GraphViewState } from '@emerald/shared';

// M9 fix 178: the state a commits or activity view carries when it is
// opened from the rail, and keeps as its own from then on. A pane keeps
// it on its view record (layout.ts in shared), a document tab as a query
// on its path (tabs-model.ts); this is the one place that reads a state
// off a query and writes one, and that reads the rail's own settings off
// localStorage for the heading's + menu, which opens a view without the
// rail's panel in hand. Every field is optional and absent at its
// default, so a query at the defaults is empty and the path is bare.

// The commits section's whole state: the graph settings plus the rows
// flag, which a pane keeps as its own field (fix 162) and a tab keeps in
// the same query.
export interface CommitsSnapshot {
  graph: GraphViewState;
  rows: boolean;
}

export interface ActivitySnapshot {
  scope: ActivityViewScope;
  folder: string | null;
  layers: ActivityViewLayers;
}

// The pane's record for a snapshot (or a bare one for an older daemon,
// which would drop the fields anyway); rows rides as its own field.
export function commitsView(folder: string, snapshot: CommitsSnapshot | null): CommitsPaneView {
  if (snapshot === null) return { kind: 'commits', folder };
  return { kind: 'commits', folder, ...(snapshot.rows ? {} : { rows: false }), ...(Object.keys(snapshot.graph).length === 0 ? {} : { graph: snapshot.graph }) };
}

// The panes scope (M9 fix 250) and the here scope (M9 fix 261) ride
// with or without a folder; the folder scope only with one, since
// without one it reads as all.
export function activityView(window: string, snapshot: ActivitySnapshot | null): ActivityPaneView {
  if (snapshot === null) return { kind: 'activity', window };
  return {
    kind: 'activity',
    window,
    ...(snapshot.scope === 'panes' || snapshot.scope === 'here' ? { scope: snapshot.scope } : snapshot.scope === 'folder' && snapshot.folder !== null ? { scope: 'folder' as const } : {}),
    ...(snapshot.folder === null ? {} : { folder: snapshot.folder }),
    ...(snapshot.layers === 'both' ? {} : { layers: snapshot.layers }),
  };
}

export const GRAPH_KEY = 'emerald.commitsGraph';
export const VIEW_KEY = 'emerald.commitsView';

// The rail's own settings, as the rail's panel reads them at its mount.
export function readRailCommits(): CommitsSnapshot {
  let graph: GraphViewState = {};
  let rows = true;
  try {
    const raw = JSON.parse(localStorage.getItem(GRAPH_KEY) ?? '{}') as Record<string, unknown>;
    graph = cleanGraph({ ...raw, mode: localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'graph' });
    rows = raw['rows'] !== false;
  } catch {
    // The defaults.
  }
  return { graph, rows };
}

// A state with only the fields away from their defaults, so two states
// that draw alike compare alike and a record at the defaults is bare.
export function cleanGraph(value: Record<string, unknown>): GraphViewState {
  const out: GraphViewState = {};
  if (value['mode'] === 'list') out.mode = 'list';
  if (value['orientation'] === 'horizontal') out.orientation = 'horizontal';
  if (value['reverse'] === true) out.reverse = true;
  if (value['draw'] === 'active') out.draw = 'active';
  const hidden = value['hidden'];
  if (Array.isArray(hidden)) {
    const keys = hidden.filter((h): h is string => typeof h === 'string' && h !== '');
    if (keys.length > 0) out.hidden = keys;
  }
  const solo = value['solo'];
  if (typeof solo === 'string' && solo !== '') out.solo = solo;
  const layout = value['layout'];
  if (layout !== null && typeof layout === 'object') {
    const kept: Record<string, GraphViewLayout> = {};
    for (const [k, v] of Object.entries(layout as Record<string, unknown>)) if (v === 'graph' || v === 'line') kept[k] = v;
    if (Object.keys(kept).length > 0) out.layout = kept;
  }
  // The zoom (M9 fix 213), kept away from 1.
  const scale = value['scale'];
  if (isGraphScale(scale) && scale !== 1) out.scale = scale;
  // The remote branches (M9 fix 286), kept only when on.
  if (value['remotes'] === true) out.remotes = true;
  return out;
}

// The query for a commits document: `mode=list&orientation=horizontal&
// reverse&draw=active&hidden=a,b&solo=a&layout=a:line,b:graph&rows=off&
// remotes`, each field only when away from its default. Block keys are
// session ids, the outside key and the prefixed history, person and
// remote keys (M70, M9 fix 286), so a layout pair is split at its last
// colon; none holds a comma.
export function commitsQuery(snapshot: CommitsSnapshot): string {
  const q = new URLSearchParams();
  const g = snapshot.graph;
  if (g.mode === 'list') q.set('mode', 'list');
  if (g.orientation === 'horizontal') q.set('orientation', 'horizontal');
  if (g.reverse === true) q.set('reverse', '');
  if (g.draw === 'active') q.set('draw', 'active');
  if (g.hidden !== undefined && g.hidden.length > 0) q.set('hidden', g.hidden.join(','));
  if (g.solo !== undefined) q.set('solo', g.solo);
  if (g.layout !== undefined && Object.keys(g.layout).length > 0) q.set('layout', Object.entries(g.layout).map(([k, v]) => `${k}:${v}`).join(','));
  if (g.scale !== undefined) q.set('scale', String(g.scale));
  if (g.remotes === true) q.set('remotes', '');
  if (!snapshot.rows) q.set('rows', 'off');
  return q.toString();
}

export function commitsFromQuery(query: string | null): CommitsSnapshot {
  const q = new URLSearchParams(query ?? '');
  const layout: Record<string, GraphViewLayout> = {};
  for (const pair of (q.get('layout') ?? '').split(',')) {
    const at = pair.lastIndexOf(':');
    if (at <= 0) continue;
    const v = pair.slice(at + 1);
    if (v === 'graph' || v === 'line') layout[pair.slice(0, at)] = v;
  }
  const graph = cleanGraph({
    mode: q.get('mode'),
    orientation: q.get('orientation'),
    reverse: q.has('reverse'),
    draw: q.get('draw'),
    hidden: (q.get('hidden') ?? '').split(',').filter((h) => h !== ''),
    solo: q.get('solo'),
    layout,
    scale: q.has('scale') ? Number(q.get('scale')) : undefined,
    remotes: q.has('remotes'),
  });
  return { graph, rows: q.get('rows') !== 'off' };
}

// The query for an activity document: `scope=folder&folder=<path>&
// layers=band` (or `scope=panes`, M9 fix 250); the folder rides along
// under `all` and `panes` too, so the view can offer the toggle back to
// it.
export function activityQuery(snapshot: ActivitySnapshot): string {
  const q = new URLSearchParams();
  if (snapshot.scope === 'panes' || snapshot.scope === 'here') q.set('scope', snapshot.scope);
  else if (snapshot.scope === 'folder' && snapshot.folder !== null) q.set('scope', 'folder');
  if (snapshot.folder !== null) q.set('folder', snapshot.folder);
  if (snapshot.layers !== 'both') q.set('layers', snapshot.layers);
  return q.toString();
}

export function activityFromQuery(query: string | null): ActivitySnapshot {
  const q = new URLSearchParams(query ?? '');
  const folder = q.get('folder');
  const layers = q.get('layers');
  const scope = readScope(q.get('scope'));
  return {
    folder: folder === null || folder === '' ? null : folder,
    scope: scope === 'folder' && (folder === null || folder === '') ? 'all' : scope,
    layers: layers === 'band' || layers === 'lanes' ? layers : 'both',
  };
}
