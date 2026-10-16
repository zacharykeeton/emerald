import { formatDuration } from '@emerald/shared';
import type { SessionInfo, ShellId } from '@emerald/shared';
import { waitingOrder } from './attention-model.ts';
import { BINDINGS, formatChord } from './keys-model.ts';
import type { Action, Binding } from './keys-model.ts';
import { paneOnlyItems } from './pane-menu-model.ts';
import type { PaneMenuItem, PaneMenuRun } from './pane-menu-model.ts';

// The pure part of the jump palette (M21): which sessions a typed query
// keeps, where in each the match is so the letters can be shown in bold,
// and the order they come in. No DOM, so node:test covers it.

// The fields a query is matched against, in the order a tie is broken.
// One entry per field: adding one (a comment, say) is one more line here
// and nothing elsewhere.
export type MatchField = 'name' | 'folder' | 'branch' | 'prompt' | 'comment';

const FIELDS: readonly { key: MatchField; text: (s: SessionInfo) => string | null }[] = [
  { key: 'name', text: (s) => s.name },
  { key: 'folder', text: (s) => s.cwd },
  { key: 'branch', text: (s) => s.branch },
  { key: 'prompt', text: (s) => s.lastPrompt },
  { key: 'comment', text: (s) => s.comment },
];

export interface Match {
  field: MatchField;
  // The text of that field, so the row can show it with the hits in bold.
  text: string;
  // Indices into text of the characters the query matched, ascending.
  indices: readonly number[];
}

export interface Ranked {
  session: SessionInfo;
  // null when the query was empty: nothing matched, nothing to embolden.
  match: Match | null;
}

// Case-insensitive subsequence: every character of the query appears in
// the text in order, not necessarily adjacent, each at the earliest place
// it can. Returns the indices matched, or null. An empty query matches at
// no indices.
export function subsequence(query: string, text: string): number[] | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const out: number[] = [];
  let from = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at === -1) return null;
    out.push(at);
    from = at + 1;
  }
  return out;
}

// The best match of the query in one session: the field whose match starts
// earliest wins, and between equal starts the field listed first.
export function matchSession(session: SessionInfo, query: string): Match | null {
  let best: Match | null = null;
  for (const f of FIELDS) {
    const text = f.text(session);
    if (text === null || text === '') continue;
    const indices = subsequence(query, text);
    if (indices === null) continue;
    if (best === null || indices[0]! < best.indices[0]!) best = { field: f.key, text, indices };
  }
  return best;
}

// When the session last did something, for the tie-break: the last hook
// event, else the last state change.
function activity(s: SessionInfo): number {
  return s.lastEventAt ?? s.stateSince;
}

// The rows for a query. `sessions` come in the sidebar's order and an
// empty query keeps it; a non-empty one keeps only the sessions that
// match, the earliest match start first, then the most recently active.
export function rankSessions(sessions: readonly SessionInfo[], query: string): Ranked[] {
  const trimmed = query.trim();
  if (trimmed === '') return sessions.map((session) => ({ session, match: null }));
  const rows: { session: SessionInfo; match: Match }[] = [];
  for (const session of sessions) {
    const match = matchSession(session, trimmed);
    if (match !== null) rows.push({ session, match });
  }
  rows.sort((a, b) => {
    const byStart = a.match.indices[0]! - b.match.indices[0]!;
    if (byStart !== 0) return byStart;
    return activity(b.session) - activity(a.session);
  });
  return rows;
}

// M9 fix 201: the order the picker opens in. The sessions that want a
// person come first, in waitingOrder's order (the same order the jump key
// walks, so the top row is where the key would go), and the rest keep
// the order they came in, the sidebar's. Only for an empty query; a typed
// one is ranked by its match.
export function orderRows(sessions: readonly SessionInfo[], wanting: ReadonlySet<string>): SessionInfo[] {
  const first = waitingOrder(sessions, wanting);
  if (first.length === 0) return [...sessions];
  const taken = new Set(first.map((s) => s.id));
  return [...first, ...sessions.filter((s) => !taken.has(s.id))];
}

// How long a wanting session has waited, for the picker's row after its
// state word; null for a session nobody is waited on by.
export function waitText(session: SessionInfo, wanting: ReadonlySet<string>, now: number): string | null {
  return wanting.has(session.id) ? formatDuration(session.stateSince, now) : null;
}

// M9 fix 202: the palette's action mode, entered by typing > first or by
// the open-actions key. Every binding by its label with its chords at
// the right (Keys), then the focused pane's menu items no key reaches
// (Pane), each naming the pane's session, then, once something is typed,
// the empty pane's shells and the terminal colours (M9 fix 768); the same
// fuzzy match as the sessions, hits in bold, the earliest start first within each group.
export const ACTION_PREFIX = '>';

export function isActionQuery(query: string): boolean {
  return query.startsWith(ACTION_PREFIX);
}

export type ActionRow =
  | { kind: 'key'; action: Action; label: string; detail: string; match: Match | null }
  | { kind: 'pane'; run: PaneMenuRun; shell?: ShellId | undefined; label: string; detail: string; match: Match | null }
  | { kind: 'shell'; shell: ShellId; checked: boolean; label: string; detail: string; match: Match | null }
  | { kind: 'scheme'; scope: 'session' | 'window'; scheme: string | null; checked: boolean; label: string; detail: string; match: Match | null };

export interface PaneForActions {
  // The focused pane's session name or view name, shown after the label.
  name: string;
  items: readonly PaneMenuItem[];
}

// The chords as the cheat sheet prints them: the plain one, then the
// prefix and its key.
export function chordsText(b: Binding, prefix: string): string {
  const parts: string[] = [];
  if (b.plain !== null) parts.push(formatChord(b.plain));
  if (b.prefixed !== null) parts.push(`${prefix} ${formatChord(b.prefixed)}`);
  return parts.join(' · ');
}

function matchRows<T>(q: string, items: readonly T[], label: (t: T) => string, row: (t: T, match: Match | null) => ActionRow): ActionRow[] {
  if (q === '') return items.map((t) => row(t, null));
  const out: { row: ActionRow; start: number }[] = [];
  for (const t of items) {
    const text = label(t);
    const indices = subsequence(q, text);
    if (indices !== null) out.push({ row: row(t, { field: 'name', text, indices }), start: indices[0]! });
  }
  out.sort((a, b) => a.start - b.start);
  return out.map((o) => o.row);
}

export function actionRows(query: string, prefix: string, pane: PaneForActions | null, bindings: readonly Binding[] = BINDINGS): ActionRow[] {
  const q = (isActionQuery(query) ? query.slice(ACTION_PREFIX.length) : query).trim();
  const matched = <T>(items: readonly T[], label: (t: T) => string, row: (t: T, match: Match | null) => ActionRow): ActionRow[] => matchRows(q, items, label, row);
  const keys = matched(bindings, (b) => b.label, (b, match) => ({ kind: 'key', action: b.action, label: b.label, detail: chordsText(b, prefix), match }));
  const paneRows = pane === null ? [] : matched(paneOnlyItems(pane.items), (i) => i.label, (i, match) => ({ kind: 'pane', run: i.run, ...(i.shell === undefined ? {} : { shell: i.shell }), label: i.label, detail: pane.name, match }));
  return [...keys, ...paneRows];
}

// M9 fix 768: the keyboard's way to the Shell tile's caret and the pane
// menu's Terminal colours, which no key reaches since a Menu closes on
// any key (fix 299). Listed only once something is typed after the >,
// so the bare > list stays the keys and the pane's items.
export interface PalettePicks {
  // The empty pane's installed shells, empty on the overlay or with one shell.
  shells: readonly { id: ShellId; label: string }[];
  // The shell the tile starts now, the pick or the first.
  shell: ShellId | null;
  schemes: readonly string[];
  windowScheme: string;
  // The pane's session's own scheme, or null with no session in the pane.
  session: { own: string | null } | null;
}

export function pickRows(query: string, picks: PalettePicks): ActionRow[] {
  const q = (isActionQuery(query) ? query.slice(ACTION_PREFIX.length) : query).trim();
  if (q === '') return [];
  const shellRows = matchRows(q, picks.shells, (o) => `Shell: ${o.label}`, (o, match): ActionRow => {
    const checked = o.id === picks.shell;
    const words = [o.id === picks.shells[0]?.id ? 'default' : '', checked ? 'in use' : ''].filter((w) => w !== '');
    return { kind: 'shell', shell: o.id, checked, label: `Shell: ${o.label}`, detail: words.join(' · '), match };
  });
  const sessionRows: ActionRow[] = [];
  if (picks.session !== null) {
    const own = picks.session.own;
    const items: { scheme: string | null; label: string }[] = [
      { scheme: null, label: "This session: The window's" },
      ...picks.schemes.map((name) => ({ scheme: name, label: `This session: ${name}` })),
    ];
    sessionRows.push(...matchRows(q, items, (c) => c.label, (c, match): ActionRow => {
      const checked = c.scheme === own;
      const detail = c.scheme === null ? [picks.windowScheme, checked ? 'in use' : ''].filter((w) => w !== '').join(' · ') : checked ? 'in use' : '';
      return { kind: 'scheme', scope: 'session', scheme: c.scheme, checked, label: c.label, detail, match };
    }));
  }
  const windowRows = matchRows(q, picks.schemes, (n) => `Terminal colours: ${n}`, (n, match): ActionRow => {
    const checked = n === picks.windowScheme;
    return { kind: 'scheme', scope: 'window', scheme: n, checked, label: `Terminal colours: ${n}`, detail: checked ? 'in use' : '', match };
  });
  return [...shellRows, ...sessionRows, ...windowRows];
}

export function actionGroup(row: ActionRow): string {
  switch (row.kind) {
    case 'key': return 'Keys';
    case 'pane': return 'Pane';
    case 'shell': return 'Shell';
    case 'scheme': return 'Terminal colours';
  }
}

export function actionKey(row: ActionRow): string {
  switch (row.kind) {
    case 'key': return `key:${row.action}`;
    case 'pane': return `pane:${row.run}:${row.shell ?? ''}`;
    case 'shell': return `shell:${row.shell}`;
    case 'scheme': return `scheme:${row.scope}:${row.scheme ?? ''}`;
  }
}

export interface Segment {
  text: string;
  hit: boolean;
}

// Splits text into runs so the matched characters can be rendered bold:
// adjacent hits share one segment.
export function segments(text: string, indices: readonly number[]): Segment[] {
  const out: Segment[] = [];
  const hits = new Set(indices);
  for (let i = 0; i < text.length; i++) {
    const hit = hits.has(i);
    const last = out[out.length - 1];
    if (last !== undefined && last.hit === hit) last.text += text[i]!;
    else out.push({ text: text[i]!, hit });
  }
  return out;
}

// The highlighted row after a move, wrapping at both ends. Nothing to
// highlight in an empty list.
export function moveHighlight(index: number, delta: number, count: number): number {
  if (count === 0) return 0;
  return (((index + delta) % count) + count) % count;
}
