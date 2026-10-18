import { unitBounds } from './activity-model.ts';
import { isGraphScale } from './layout.ts';
import { browserUrl } from './browser-url.ts';
import { BROWSER_PROFILE } from './browser-drive.ts';
import type { GraphViewLayout, GraphViewState, Layout, LayoutNode, LayoutTab, PaneTree, PaneView, SingleTree, SplitDirection } from './layout.ts';

// Pure operations on the split tree. Every function returns a new tree and
// never mutates its input. They take anything with a root and a focused
// pane and give back the same kind of thing, so a tab (M36) keeps its id
// and name through an edit; the layout's revision lives outside the tree
// and only the daemon increments it (see Layout in layout.ts).

export type PaneNode = Extract<LayoutNode, { kind: 'pane' }>;
export type SplitNode = Extract<LayoutNode, { kind: 'split' }>;
export type Direction = 'left' | 'right' | 'up' | 'down';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// A split thinner than this is unusable and a drag past it would let a pane
// vanish, so ratios are clamped.
export const MIN_RATIO = 0.05;
export const MAX_RATIO = 0.95;

export type IdGenerator = () => string;

// Node 24 and browsers both expose crypto.randomUUID, so one default works
// in the daemon and the renderer. Tests inject a counter for stable ids. The
// cast is because this package compiles against neither DOM nor Node types.
export const randomId: IdGenerator = () => (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();

export class LayoutError extends Error {}

// The name of the one tab a fresh layout has, and of a single tree read
// from before M36.
export const FIRST_TAB_NAME = 'Panes';

export function newTab(name: string, newId: IdGenerator = randomId): LayoutTab {
  const paneId = newId();
  return { id: newId(), name, root: { kind: 'pane', id: paneId, sessionId: null, view: null }, focusedPaneId: paneId };
}

export function defaultLayout(newId: IdGenerator = randomId): Layout {
  const tab = newTab(FIRST_TAB_NAME, newId);
  return { tabs: [tab], currentTabId: tab.id, revision: 0 };
}

// A tree with one pane per session, laid out as a grid read left to
// right and top to bottom (M50, a group as a panes tab): ceil(sqrt(n))
// columns side by side, each a stack of near-equal rows, the earlier
// columns taking the spare pane. A binary tree has no k-way split, so
// each chain of k gives the first 1/k and the rest to the chain after
// it, which comes out equal. No sessions gives one empty pane. Focus is
// the first pane.
export function gridTree(sessionIds: readonly string[], newId: IdGenerator = randomId): PaneTree {
  if (sessionIds.length === 0) {
    const paneId = newId();
    return { root: { kind: 'pane', id: paneId, sessionId: null, view: null }, focusedPaneId: paneId };
  }
  const cols = Math.ceil(Math.sqrt(sessionIds.length));
  const columns: LayoutNode[][] = Array.from({ length: cols }, () => []);
  sessionIds.forEach((sessionId, i) => columns[i % cols]!.push({ kind: 'pane', id: newId(), sessionId, view: null }));
  const chain = (nodes: LayoutNode[], direction: SplitDirection): LayoutNode => {
    if (nodes.length === 1) return nodes[0]!;
    return { kind: 'split', id: newId(), direction, ratio: 1 / nodes.length, first: nodes[0]!, second: chain(nodes.slice(1), direction) };
  };
  const root = chain(
    columns.map((panes) => chain(panes, 'column')),
    'row',
  );
  return { root, focusedPaneId: firstLeaf(root).id };
}

export function findPane(layout: PaneTree, paneId: string): PaneNode | null {
  const node = findNode(layout.root, paneId);
  return node !== null && node.kind === 'pane' ? node : null;
}

export function findSplit(layout: PaneTree, splitId: string): SplitNode | null {
  const node = findNode(layout.root, splitId);
  return node !== null && node.kind === 'split' ? node : null;
}

// Leaves in tree order: first before second, depth first.
export function listPanes(layout: PaneTree): PaneNode[] {
  const out: PaneNode[] = [];
  const walk = (node: LayoutNode): void => {
    if (node.kind === 'pane') {
      out.push(node);
      return;
    }
    walk(node.first);
    walk(node.second);
  };
  walk(layout.root);
  return out;
}

export function paneShowing(layout: PaneTree, sessionId: string): PaneNode | null {
  return listPanes(layout).find((p) => p.sessionId === sessionId) ?? null;
}

// Replaces the pane with a split holding the old pane first and a new empty
// pane second. 'row' puts them side by side, 'column' stacks them. Focus
// moves to the new pane, as in tmux.
// Which side of the new divider the new pane takes: after is right or below.
export type SplitPlace = 'after' | 'before';

export function splitPane<T extends PaneTree>(layout: T, paneId: string, direction: SplitDirection, newId: IdGenerator = randomId, place: SplitPlace = 'after'): T {
  const pane = findPane(layout, paneId);
  if (pane === null) throw new LayoutError(`no pane ${paneId}`);
  const newPane: PaneNode = { kind: 'pane', id: newId(), sessionId: null, view: null };
  const [first, second] = place === 'after' ? [pane, newPane] : [newPane, pane];
  const split: SplitNode = { kind: 'split', id: newId(), direction, ratio: 0.5, first, second };
  return { ...layout, root: replaceNode(layout.root, paneId, split), focusedPaneId: newPane.id };
}

// The split directly holding the pane, or null for the root pane.
export function parentSplit(layout: PaneTree, paneId: string): SplitNode | null {
  return findParent(layout.root, paneId);
}

export function subtreeHas(node: LayoutNode, id: string): boolean {
  return findNode(node, id) !== null;
}

// The top-left-most pane under a node.
export function firstPane(node: LayoutNode): PaneNode {
  return firstLeaf(node);
}

// Removes the pane and collapses its parent split into the sibling. The
// window always shows at least one pane, so closing the last one empties it
// instead (unchanged if it was empty already). Sessions are untouched: a
// pane is only a view onto a session.
export function closePane<T extends PaneTree>(layout: T, paneId: string): T {
  const pane = findPane(layout, paneId);
  if (pane === null) throw new LayoutError(`no pane ${paneId}`);
  if (layout.root.kind === 'pane') return pane.sessionId === null && pane.view === null ? layout : setPaneSession(layout, paneId, null);
  const parent = findParent(layout.root, paneId);
  if (parent === null) return layout;
  const sibling = parent.first.id === paneId ? parent.second : parent.first;
  const root = replaceNode(layout.root, parent.id, sibling);
  const focusedPaneId = layout.focusedPaneId === paneId ? firstLeaf(sibling).id : layout.focusedPaneId;
  return { ...layout, root, focusedPaneId };
}

// Sets the split's ratio and keeps every other divider where it is on
// screen (M9 fix 279). A nested split holds a fraction of its parent's
// box, so on its own a drag on the outer gutter would move every inner
// divider in proportion: with three stacked panes, dragging the lower
// seam moved the upper one. The two children's boxes change size, and
// the same-direction splits under them are rescaled so only the pane
// against the dragged gutter changes.
export function setRatio<T extends PaneTree>(layout: T, splitId: string, ratio: number): T {
  const split = findSplit(layout, splitId);
  if (split === null) throw new LayoutError(`no split ${splitId}`);
  if (!Number.isFinite(ratio)) throw new LayoutError(`ratio must be a finite number`);
  const clamped = clampRatio(ratio);
  const first = keepDividers(split.first, split.direction, split.ratio / clamped, 'start');
  const second = keepDividers(split.second, split.direction, (1 - split.ratio) / (1 - clamped), 'end');
  return { ...layout, root: replaceNode(layout.root, splitId, { ...split, ratio: clamped, first, second }) };
}

function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

// The box a subtree fills has grown or shrunk along `direction` by `scale`
// (its old length over its new one); the end named by `anchor` stayed put
// and the other end moved with the dragged gutter. A same-direction split
// keeps its divider in place by keeping the pixels of the part on the
// anchored side, so that part's fraction is scaled, and the part on the
// moving side takes the whole change, which makes it a box of its own
// that changed size, walked in turn. A cross-direction split spans the
// box whole, so both of its children are walked with the same scale. A
// rescaled ratio is clamped like the dragged one, and the walk past it
// uses the clamped value, so the ratios still describe the boxes drawn.
function keepDividers(node: LayoutNode, direction: SplitDirection, scale: number, anchor: 'start' | 'end'): LayoutNode {
  if (node.kind === 'pane' || scale === 1) return node;
  if (node.direction !== direction) {
    const first = keepDividers(node.first, direction, scale, anchor);
    const second = keepDividers(node.second, direction, scale, anchor);
    return first === node.first && second === node.second ? node : { ...node, first, second };
  }
  if (anchor === 'start') {
    const ratio = clampRatio(node.ratio * scale);
    const second = keepDividers(node.second, direction, ((1 - node.ratio) / (1 - ratio)) * scale, anchor);
    return { ...node, ratio, second };
  }
  const ratio = clampRatio(1 - (1 - node.ratio) * scale);
  const first = keepDividers(node.first, direction, (node.ratio / ratio) * scale, anchor);
  return { ...node, ratio, first };
}

// A pane holds a session or a view (M52), never both: giving it one
// clears the other, and giving it null empties it.
export function setPaneSession<T extends PaneTree>(layout: T, paneId: string, sessionId: string | null): T {
  const pane = findPane(layout, paneId);
  if (pane === null) throw new LayoutError(`no pane ${paneId}`);
  return { ...layout, root: replaceNode(layout.root, paneId, { ...pane, sessionId, view: null }) };
}

export function setPaneView<T extends PaneTree>(layout: T, paneId: string, view: PaneView | null): T {
  const pane = findPane(layout, paneId);
  if (pane === null) throw new LayoutError(`no pane ${paneId}`);
  return { ...layout, root: replaceNode(layout.root, paneId, { ...pane, sessionId: null, view }) };
}

// Where a dropped session goes relative to the target pane: a split on one
// of its sides, or null for the pane itself.
export interface DropSplit {
  direction: SplitDirection;
  place: SplitPlace;
}

// Puts the session in the target pane (split null) or in a new pane split
// off it on the given side. A session can be shown in several panes at
// once (M50), so one already on screen stays where it is and gains a
// pane: a drop is a mirror, and moving a pane is the caller's (it closes
// the pane it came from after this). Dropping a session on the centre of
// the pane that shows it is nothing to do and returns the layout itself,
// so the caller can skip the round trip; on an edge of that pane it
// splits the pane with a mirror beside it. Center on an occupied pane
// replaces its session, which then is simply not shown, as after a hide.
export function dropSession<T extends PaneTree>(layout: T, sessionId: string, targetPaneId: string, split: DropSplit | null, newId: IdGenerator = randomId): T {
  const target = findPane(layout, targetPaneId);
  if (target === null) throw new LayoutError(`no pane ${targetPaneId}`);
  if (split === null) {
    if (target.sessionId === sessionId) return layout;
    return focusPane(setPaneSession(layout, targetPaneId, sessionId), targetPaneId);
  }
  const after = splitPane(layout, targetPaneId, split.direction, newId, split.place);
  return setPaneSession(after, after.focusedPaneId, sessionId);
}

// The same for a view (M52): on an edge a new pane beside the target
// holds it; on the centre it fills an empty pane and is nothing to do on
// a pane holding a session or a view, since a view over a terminal would
// take the terminal off screen for a thing the rail already shows. The
// caller reads the layout coming back unchanged as the refusal.
export function dropView<T extends PaneTree>(layout: T, view: PaneView, targetPaneId: string, split: DropSplit | null, newId: IdGenerator = randomId): T {
  const target = findPane(layout, targetPaneId);
  if (target === null) throw new LayoutError(`no pane ${targetPaneId}`);
  if (split === null) {
    if (target.sessionId !== null || target.view !== null) return layout;
    return focusPane(setPaneView(layout, targetPaneId, view), targetPaneId);
  }
  const after = splitPane(layout, targetPaneId, split.direction, newId, split.place);
  return setPaneView(after, after.focusedPaneId, view);
}

// What a new pane holds: a session or a view, never both.
export type PaneContent = { sessionId: string; view: null } | { sessionId: null; view: PaneView };

// A pane or a row dropped on a layout tab (M9 fix 651) lands at the far
// right, full height, where the backlog entry asked for a default spot:
// the old root untouched on the left, the new pane on the right with an
// even share of the width. A tab holding only an empty pane takes the
// content in that pane instead. A session already on the tree gets a
// second pane all the same, a mirror (M50).
export function dropAtRight<T extends PaneTree>(tree: T, content: PaneContent, newId: IdGenerator = randomId): T {
  const root = tree.root;
  if (root.kind === 'pane' && root.sessionId === null && root.view === null) {
    return { ...tree, root: { ...root, sessionId: content.sessionId, view: content.view }, focusedPaneId: root.id };
  }
  const n = listPanes(tree).length;
  const pane: PaneNode = { kind: 'pane', id: newId(), sessionId: content.sessionId, view: content.view };
  const split: SplitNode = { kind: 'split', id: newId(), direction: 'row', ratio: clampRatio(n / (n + 1)), first: root, second: pane };
  return { ...tree, root: split, focusedPaneId: pane.id };
}

export function focusPane<T extends PaneTree>(layout: T, paneId: string): T {
  if (findPane(layout, paneId) === null) throw new LayoutError(`no pane ${paneId}`);
  return { ...layout, focusedPaneId: paneId };
}

// The pane `step` places after the focused one in tree order (first before
// second, depth first), wrapping around. Negative steps go backwards. With
// one pane there is nowhere to go and the layout is returned unchanged.
export function cycleFocus<T extends PaneTree>(layout: T, step: number): T {
  const panes = listPanes(layout);
  const index = panes.findIndex((p) => p.id === layout.focusedPaneId);
  if (index < 0) throw new LayoutError(`focused pane ${layout.focusedPaneId} is not in the tree`);
  const next = panes[(((index + step) % panes.length) + panes.length) % panes.length]!;
  return next.id === layout.focusedPaneId ? layout : { ...layout, focusedPaneId: next.id };
}

// Pane rectangles in the unit square. The renderer lays panes out with the
// same ratios, so a neighbor computed here matches what is on screen.
export function paneRects(layout: PaneTree): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const walk = (node: LayoutNode, rect: Rect): void => {
    if (node.kind === 'pane') {
      rects.set(node.id, rect);
      return;
    }
    if (node.direction === 'row') {
      const firstWidth = rect.width * node.ratio;
      walk(node.first, { ...rect, width: firstWidth });
      walk(node.second, { ...rect, x: rect.x + firstWidth, width: rect.width - firstWidth });
    } else {
      const firstHeight = rect.height * node.ratio;
      walk(node.first, { ...rect, height: firstHeight });
      walk(node.second, { ...rect, y: rect.y + firstHeight, height: rect.height - firstHeight });
    }
  };
  walk(layout.root, { x: 0, y: 0, width: 1, height: 1 });
  return rects;
}

// The pane that shares the given edge and overlaps the most along it. Computed
// from rectangles rather than tree order because in a tree like
// (A | (B / C)) the pane right of A depends on where you are vertically.
export function neighborPane(layout: PaneTree, paneId: string, direction: Direction): PaneNode | null {
  const rects = paneRects(layout);
  const from = rects.get(paneId);
  if (from === undefined) throw new LayoutError(`no pane ${paneId}`);
  // Ratios multiply down the tree, so edges that should coincide can differ
  // by floating point noise.
  const eps = 1e-9;

  let best: { id: string; overlap: number } | null = null;
  for (const [id, rect] of rects) {
    if (id === paneId) continue;
    let touching: boolean;
    let overlap: number;
    if (direction === 'left' || direction === 'right') {
      touching = direction === 'left' ? near(rect.x + rect.width, from.x, eps) : near(rect.x, from.x + from.width, eps);
      overlap = span(rect.y, rect.height, from.y, from.height);
    } else {
      touching = direction === 'up' ? near(rect.y + rect.height, from.y, eps) : near(rect.y, from.y + from.height, eps);
      overlap = span(rect.x, rect.width, from.x, from.width);
    }
    if (!touching || overlap <= eps) continue;
    if (best === null || overlap > best.overlap) best = { id, overlap };
  }
  return best === null ? null : findPane(layout, best.id);
}

// Structural check for a layout that arrived over the wire or from disk.
// Returns an equal layout when valid so callers can pass it straight on.
// Pane and split ids must be unique across every tab, since a pane id on
// its own names a tab (tabHolding).
export function validateLayout(value: unknown): Layout {
  if (!isRecord(value)) throw new LayoutError('layout must be an object');
  const revision = validateRevision(value['revision']);
  if (!Array.isArray(value['tabs']) || value['tabs'].length === 0) throw new LayoutError('layout.tabs must be a non-empty list');
  if (typeof value['currentTabId'] !== 'string') throw new LayoutError('layout.currentTabId must be a string');
  const ids = new Set<string>();
  const tabIds = new Set<string>();
  const tabs: LayoutTab[] = [];
  for (const [i, raw] of value['tabs'].entries()) {
    const where = `layout.tabs[${i}]`;
    if (!isRecord(raw)) throw new LayoutError(`${where} must be an object`);
    const id = raw['id'];
    if (typeof id !== 'string' || id.length === 0) throw new LayoutError(`${where}.id must be a non-empty string`);
    if (tabIds.has(id)) throw new LayoutError(`${where}.id ${id} is used twice`);
    tabIds.add(id);
    const name = raw['name'];
    if (typeof name !== 'string' || name.trim() === '') throw new LayoutError(`${where}.name must be a non-empty string`);
    tabs.push({ id, name, ...validateTree(raw, ids, where) });
  }
  if (!tabIds.has(value['currentTabId'])) throw new LayoutError(`layout.currentTabId ${value['currentTabId']} is not a tab`);
  return { tabs, currentTabId: value['currentTabId'], revision };
}

// True for the shape before M36: a tree with no tabs list. Read before
// validateLayout so the older form is told apart by its shape alone.
export function isSingleTree(value: unknown): boolean {
  return isRecord(value) && !('tabs' in value) && 'root' in value;
}

export function validateSingleTree(value: unknown): SingleTree {
  if (!isRecord(value)) throw new LayoutError('layout must be an object');
  const revision = validateRevision(value['revision']);
  return { ...validateTree(value, new Set(), 'layout'), revision };
}

// One tree becomes a layout of one tab, named as the first tab always is.
// The id is a parameter so the app can wrap what an older daemon sends
// under one steady id and not remount the panes on every push.
export function wrapSingleTree(tree: SingleTree, tabId: string = randomId()): Layout {
  return { tabs: [{ id: tabId, name: FIRST_TAB_NAME, root: tree.root, focusedPaneId: tree.focusedPaneId }], currentTabId: tabId, revision: tree.revision };
}

function validateRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new LayoutError('layout.revision must be a non-negative integer');
  return value;
}

// A root and a focused pane, with every node id added to ids so a second
// tab cannot reuse one.
function validateTree(value: Record<string, unknown>, ids: Set<string>, where: string): PaneTree {
  if (typeof value['focusedPaneId'] !== 'string') throw new LayoutError(`${where}.focusedPaneId must be a string`);
  const root = validateNode(value['root'], ids, `${where}.root`);
  const tree: PaneTree = { root, focusedPaneId: value['focusedPaneId'] };
  if (findPane(tree, tree.focusedPaneId) === null) {
    throw new LayoutError(`${where}.focusedPaneId ${tree.focusedPaneId} is not a pane`);
  }
  return tree;
}

function validateNode(value: unknown, ids: Set<string>, where: string): LayoutNode {
  if (!isRecord(value)) throw new LayoutError(`${where} must be an object`);
  const id = value['id'];
  if (typeof id !== 'string' || id.length === 0) throw new LayoutError(`${where}.id must be a non-empty string`);
  if (ids.has(id)) throw new LayoutError(`${where}.id ${id} is used twice`);
  ids.add(id);
  if (value['kind'] === 'pane') {
    const sessionId = value['sessionId'];
    if (sessionId !== null && typeof sessionId !== 'string') throw new LayoutError(`${where}.sessionId must be a string or null`);
    // A view arrived with M52; a layout from before it, or from an older
    // daemon, has none, which is null.
    const view = validateView(value['view'], `${where}.view`);
    if (view !== null && sessionId !== null) throw new LayoutError(`${where} holds both a session and a view`);
    return { kind: 'pane', id, sessionId, view };
  }
  if (value['kind'] === 'split') {
    const direction = value['direction'];
    if (direction !== 'row' && direction !== 'column') throw new LayoutError(`${where}.direction must be row or column`);
    const ratio = value['ratio'];
    if (typeof ratio !== 'number' || !(ratio >= MIN_RATIO && ratio <= MAX_RATIO)) {
      throw new LayoutError(`${where}.ratio must be between ${MIN_RATIO} and ${MAX_RATIO}`);
    }
    return {
      kind: 'split',
      id,
      direction,
      ratio,
      first: validateNode(value['first'], ids, `${where}.first`),
      second: validateNode(value['second'], ids, `${where}.second`),
    };
  }
  throw new LayoutError(`${where}.kind must be pane or split`);
}

function validateView(value: unknown, where: string): PaneView | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new LayoutError(`${where} must be an object or null`);
  if (value['kind'] === 'activity') {
    // M69: the window is a key unitBounds can read, so a hand-edited
    // state file cannot put a window the view could not draw in a pane.
    const window = value['window'];
    if (typeof window !== 'string' || unitBounds(window) === null) throw new LayoutError(`${where}.window must be a week, day, five-hour, hour or minute key`);
    // M9 fix 178: the scope and the folder it keeps to, and the layers;
    // `all` is the default and is not kept, `folder` needs a folder,
    // `panes` (M9 fix 250, level 48) and `here` (M9 fix 261, level 49)
    // need nothing.
    const scope = value['scope'];
    if (scope !== undefined && scope !== null && scope !== 'folder' && scope !== 'all' && scope !== 'panes' && scope !== 'here') throw new LayoutError(`${where}.scope must be folder, all, panes or here`);
    const folder = value['folder'];
    if (folder !== undefined && folder !== null && (typeof folder !== 'string' || folder.length === 0)) throw new LayoutError(`${where}.folder must be a non-empty string`);
    if (scope === 'folder' && typeof folder !== 'string') throw new LayoutError(`${where}.scope folder needs a folder`);
    const layers = value['layers'];
    if (layers !== undefined && layers !== null && layers !== 'both' && layers !== 'band' && layers !== 'lanes') throw new LayoutError(`${where}.layers must be both, band or lanes`);
    // M9 fix 766 (level 65): the usage windows row's flag, kept only when
    // false, as chrome is.
    const usage = value['usage'];
    if (usage !== undefined && usage !== null && typeof usage !== 'boolean') throw new LayoutError(`${where}.usage must be a boolean`);
    return {
      kind: 'activity',
      window,
      ...(scope === 'folder' || scope === 'panes' || scope === 'here' ? { scope } : {}),
      ...(typeof folder === 'string' ? { folder } : {}),
      ...(layers === 'band' || layers === 'lanes' ? { layers } : {}),
      ...chromeField(value, where),
      ...(usage === false ? { usage: false } : {}),
    };
  }
  if (value['kind'] === 'file') {
    // M9 fix 180: a path and, when it is not the file's own, the view.
    const path = value['path'];
    if (typeof path !== 'string' || path.length === 0) throw new LayoutError(`${where}.path must be a non-empty string`);
    const view = value['view'];
    if (view === undefined || view === null) return { kind: 'file', path };
    if (view !== 'rendered' && view !== 'raw' && view !== 'turns' && view !== 'pretty') throw new LayoutError(`${where}.view must be rendered, raw, turns or pretty`);
    return { kind: 'file', path, view };
  }
  if (value['kind'] === 'browser') {
    // M9 fix 659: a page's address held as browserUrl writes it, or ''
    // for a pane whose address bar is still empty; profile (fix 673) and toolbar (fix 839) are kept, nothing else.
    const url = value['url'];
    if (typeof url !== 'string' || (url !== '' && browserUrl(url) !== url)) throw new LayoutError(`${where}.url must be an http or https URL, or empty`);
    // M9 fix 673: a profile's name, kept when BROWSER_PROFILE takes it.
    const profile = value['profile'];
    if (profile !== undefined && (typeof profile !== 'string' || !BROWSER_PROFILE.test(profile))) throw new LayoutError(`${where}.profile must be lowercase letters, digits and hyphens, up to 32`);
    // M9 fix 839: the toolbar flag, kept only when false, as chrome is.
    const toolbar = value['toolbar'];
    if (toolbar !== undefined && toolbar !== null && typeof toolbar !== 'boolean') throw new LayoutError(`${where}.toolbar must be a boolean`);
    return { kind: 'browser', url, ...(profile === undefined ? {} : { profile }), ...(toolbar === false ? { toolbar: false as const } : {}) };
  }
  if (value['kind'] !== 'commits') throw new LayoutError(`${where}.kind must be commits, activity, file or browser`);
  const folder = value['folder'];
  if (typeof folder !== 'string' || folder.length === 0) throw new LayoutError(`${where}.folder must be a non-empty string`);
  // M9 fix 162: rows is kept only when false, so a view that draws its
  // rows reads as it did before the field.
  const rows = value['rows'];
  if (rows !== undefined && rows !== null && typeof rows !== 'boolean') throw new LayoutError(`${where}.rows must be a boolean`);
  const rowsField = rows === false ? { rows: false } : {};
  const graph = validateGraphState(value['graph'], `${where}.graph`);
  const graphField = graph === null ? {} : { graph };
  const chrome = chromeField(value, where);
  const strip = value['strip'];
  if (strip === undefined || strip === null) return { kind: 'commits', folder, ...rowsField, ...graphField, ...chrome };
  if (!isRecord(strip)) throw new LayoutError(`${where}.strip must be an object`);
  const scope = strip['scope'];
  if (scope !== 'folder' && scope !== 'all' && scope !== 'tab') throw new LayoutError(`${where}.strip.scope must be folder, all or tab`);
  return { kind: 'commits', folder, strip: { scope }, ...rowsField, ...graphField, ...chrome };
}

// M9 fix 179: the chrome flag, kept only when false, as rows is.
function chromeField(value: Record<string, unknown>, where: string): { chrome?: false } {
  const chrome = value['chrome'];
  if (chrome !== undefined && chrome !== null && typeof chrome !== 'boolean') throw new LayoutError(`${where}.chrome must be a boolean`);
  return chrome === false ? { chrome: false } : {};
}

// M9 fix 178: a commits view's graph settings, each field checked and
// kept only away from its default, so a record at the defaults has no
// graph field at all; null for nothing kept.
function validateGraphState(value: unknown, where: string): GraphViewState | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new LayoutError(`${where} must be an object`);
  const out: GraphViewState = {};
  const mode = value['mode'];
  if (mode !== undefined && mode !== null && mode !== 'graph' && mode !== 'list') throw new LayoutError(`${where}.mode must be graph or list`);
  if (mode === 'list') out.mode = mode;
  const orientation = value['orientation'];
  if (orientation !== undefined && orientation !== null && orientation !== 'vertical' && orientation !== 'horizontal') throw new LayoutError(`${where}.orientation must be vertical or horizontal`);
  if (orientation === 'horizontal') out.orientation = orientation;
  const reverse = value['reverse'];
  if (reverse !== undefined && reverse !== null && typeof reverse !== 'boolean') throw new LayoutError(`${where}.reverse must be a boolean`);
  if (reverse === true) out.reverse = true;
  const draw = value['draw'];
  if (draw !== undefined && draw !== null && draw !== 'all' && draw !== 'active') throw new LayoutError(`${where}.draw must be all or active`);
  if (draw === 'active') out.draw = draw;
  const hidden = value['hidden'];
  if (hidden !== undefined && hidden !== null) {
    if (!Array.isArray(hidden) || hidden.some((h) => typeof h !== 'string')) throw new LayoutError(`${where}.hidden must be a list of block keys`);
    if (hidden.length > 0) out.hidden = hidden as string[];
  }
  const solo = value['solo'];
  if (solo !== undefined && solo !== null && typeof solo !== 'string') throw new LayoutError(`${where}.solo must be a block key`);
  if (typeof solo === 'string' && solo.length > 0) out.solo = solo;
  const layout = value['layout'];
  if (layout !== undefined && layout !== null) {
    if (!isRecord(layout)) throw new LayoutError(`${where}.layout must be an object`);
    const kept: Record<string, GraphViewLayout> = {};
    for (const [k, v] of Object.entries(layout)) {
      if (v !== 'graph' && v !== 'line') throw new LayoutError(`${where}.layout.${k} must be graph or line`);
      kept[k] = v;
    }
    if (Object.keys(kept).length > 0) out.layout = kept;
  }
  // The zoom (M9 fix 213), one of the steps and kept away from 1.
  const scale = value['scale'];
  if (scale !== undefined && scale !== null && !isGraphScale(scale)) throw new LayoutError(`${where}.scale must be one of the graph's zoom steps`);
  if (isGraphScale(scale) && scale !== 1) out.scale = scale;
  // The remote branches (M9 fix 286), kept only when on.
  const remotes = value['remotes'];
  if (remotes !== undefined && remotes !== null && typeof remotes !== 'boolean') throw new LayoutError(`${where}.remotes must be a boolean`);
  if (remotes === true) out.remotes = true;
  return Object.keys(out).length === 0 ? null : out;
}

function findNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  if (node.kind === 'pane') return null;
  return findNode(node.first, id) ?? findNode(node.second, id);
}

function findParent(node: LayoutNode, childId: string): SplitNode | null {
  if (node.kind === 'pane') return null;
  if (node.first.id === childId || node.second.id === childId) return node;
  return findParent(node.first, childId) ?? findParent(node.second, childId);
}

// Copies only the path from the root to the replaced node; untouched subtrees
// keep their identity, which keeps React re-renders cheap.
function replaceNode(node: LayoutNode, id: string, replacement: LayoutNode): LayoutNode {
  if (node.id === id) return replacement;
  if (node.kind === 'pane') return node;
  const first = replaceNode(node.first, id, replacement);
  const second = replaceNode(node.second, id, replacement);
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

function firstLeaf(node: LayoutNode): PaneNode {
  return node.kind === 'pane' ? node : firstLeaf(node.first);
}

function near(a: number, b: number, eps: number): boolean {
  return Math.abs(a - b) <= eps;
}

// Length of the overlap between two 1-D intervals, zero when they do not meet.
function span(aStart: number, aLength: number, bStart: number, bLength: number): number {
  return Math.max(0, Math.min(aStart + aLength, bStart + bLength) - Math.max(aStart, bStart));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
