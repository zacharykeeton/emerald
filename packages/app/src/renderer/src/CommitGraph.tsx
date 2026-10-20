import type React from 'react';
import { useId, useRef } from 'react';
import { GRAPH_SCALE_STEPS } from '@emerald/shared';
import type { GraphScale } from '@emerald/shared';
import { historyIdOf, memberTint, personNameOf, remoteBranchOf, spanIdOf } from './commit-graph-model.ts';
import { isWriteHash } from './write-graph-model.ts';
import { cutLabel, pillYields, textBox } from './commit-graph-labels.ts';
import type { TextBox } from './commit-graph-labels.ts';
import type { AgentItem, CommitItem, GraphLine, SessionGraph } from './commit-graph-model.ts';
import type { ConflictReading, ConflictTie } from './conflict-model.ts';
import { usePopoverAnchor } from './Popover.tsx';
import type { CardProps } from './Popover.tsx';
import { SessionMark } from './session-mark.tsx';
import type { MarkSize } from './session-mark.tsx';

// The commit graph's picture (M51, redrawn in M65): a node per commit on
// its session's lane and the lines of each session's own little graph,
// drawn from the pure model (commit-graph-model.ts) with nothing decided
// here but pixels. Upright it is one SVG gutter down the side of the
// Commits rows, 22px a row so the gutter's row r sits beside list row r,
// the lanes 12px apart in a session's block and the column groups 12px
// apart (M68: an agent's 16px marker box then clears the line next door
// by 3px, where 7px put the glyph on top of it; M71: blocks whose rows
// do not overlap share a column group, so the gap is between groups),
// the gutter ending 14px past the last column; on its side it is the whole
// panel, time along the x axis at 24px a commit and the lanes 24px apart
// down it, the branch names drawn as labels since no list sits beside
// it. The model gives (row, lane); an orientation turns that into (time,
// across) and then (x, y), and `reverse` mirrors the row index over the
// row count, so newest at the top or the bottom, the right or the left,
// is one drawing with two flags. A branch runs down its lane to one row
// above the commit it forked from and curves into it, a merge runs up
// its lane to one row below the merge commit and curves into that (M68,
// the parents inside a block); a commit-less worktree's fork bends the
// same way, dashed, into the commit its branch sits on. Colours are the
// session's, set as --lane on each element for the CSS; a commit made
// outside emerald is a filled node in the grey block (M68), the block's
// `data-outside` carrying the grey. An agent row has no node: the session's stepping mark rides
// its lane inside the row (still once the agent has returned), a dotted
// leader ties it to the status word in the row, and the marker opens
// the agent's card. A session's own row (M68) is the same, its mark
// stepping while the session works; a session with no commit yet runs
// one straight dashed stretch down to a mark of its own on the row of
// the commit it started from. That mark is a bar (M9 fix 145): a
// stroke across the lane, three node radii wide, since a dot read as a
// commit and a bare line end as the log's window cutting the line; the
// same bar ends a lane forked from another block's commit that the
// session's own chain runs past, saying "from a commit elsewhere". On
// its side the labels run past the SVG's last column into the room
// beside it, so the SVG lets them overflow there (style.css). Upright
// the drawing carries no labels, with rows beside it or not (M9 fix
// 173; fix 162's lines-only form drew them turned through 90 degrees,
// and a run of branch tips a row apart stacked them into one column of
// rotated text): the lane's card and the pill's card name the lanes,
// and the sideways form, which has the room, keeps its labels. The
// layout is done in one (time, across) frame either way and only the
// last step maps it to (x, y).

export const ROW_PX = 22;
export const LANE_GAP = 12;
export const SESSION_GAP = 12;
// The first lane's centre. At least SLAB_INSET (M9 fix 236): the focused
// block's slab reaches that far past the outermost lane centres, and the
// SVG cuts anything left of 0, so a smaller origin clipped the first
// lane's slab and stood its line off the slab's centre.
export const LANE_X0 = 12;
export const GUTTER_END = 14;
export const NODE_R = 3.4;
export const COL_PX = 24;
// On its side a track carries more than a line: a pill sits in the band
// 6 to 13px above its node (a second one 10px higher), an agent label
// runs on the line in a 7px box, and the marker box is 16px tall. At
// 12px the pills sat on the next track's line (M9 fix 160), so the pitch
// is the upright row's 24 (two stacked pills clear the line above by a
// pixel) and the gap between blocks the upright drawing's 12.
export const TRACK_PX = 24;
export const TRACK_GAP = 12;
// Room above the first track for two stacked pills when on its side.
const LABEL_PX = 24;
// The marker's clip box, one glyph cell.
const MARK_PX = 16;

// The zoom (M9 fix 213): a scale on the graph prefs, in these steps with
// 1 the drawing as it is, that every pitch above is multiplied by, so a
// zoomed-out graph is a smaller picture and not a sparser one. Ctrl+wheel
// over the view steps it; the plain wheel keeps scrolling.
// The steps are the shared record's (GRAPH_SCALE_STEPS in layout.ts),
// since a pane keeps its scale on its view record.
export function stepScale(scale: number, dir: 1 | -1): GraphScale {
  const i = (GRAPH_SCALE_STEPS as readonly number[]).indexOf(scale);
  const at = i === -1 ? GRAPH_SCALE_STEPS.indexOf(1) : i;
  return GRAPH_SCALE_STEPS[Math.max(0, Math.min(GRAPH_SCALE_STEPS.length - 1, at + dir))]!;
}

// The geometry at a scale: every pitch the drawing, the room, the centre
// and the slab read, multiplied through.
export interface Pitch {
  row: number;
  col: number;
  laneGap: number;
  sessionGap: number;
  laneX0: number;
  gutterEnd: number;
  track: number;
  trackGap: number;
  label: number;
  mark: number;
  nodeR: number;
  slabInset: number;
  slabMargin: number;
  slabFade: number;
}

export function pitch(scale: number): Pitch {
  return { row: ROW_PX * scale, col: COL_PX * scale, laneGap: LANE_GAP * scale, sessionGap: SESSION_GAP * scale, laneX0: LANE_X0 * scale, gutterEnd: GUTTER_END * scale, track: TRACK_PX * scale, trackGap: TRACK_GAP * scale, label: LABEL_PX * scale, mark: MARK_PX * scale, nodeR: NODE_R * scale, slabInset: SLAB_INSET * scale, slabMargin: SLAB_MARGIN * scale, slabFade: SLAB_FADE * scale };
}
// The focused block's ground slab (M9 fix 212, design 4a in
// docs/design/commits-focus-slab.md): across, the outermost lane centres
// inset by the glyph's half box plus 3px of air; along, the tree's rows
// plus the same margin, then a 22px fade at any end that does not reach
// the list's end, so no mark ever stands mid ramp.
const SLAB_INSET = 11;
const SLAB_MARGIN = 11;
const SLAB_FADE = 22;

export type Orientation = 'vertical' | 'horizontal';

export interface LaneCardAnchor {
  // The anchor id, for the card's outside-press check.
  id: string;
  card: (props: CardProps) => React.ReactNode;
}

interface Props {
  graph: SessionGraph;
  orientation: Orientation;
  reverse: boolean;
  // Branches merged into the default, whose labels draw dim when on its side.
  merged: ReadonlySet<string>;
  // Hashes the last fetch brought in, flashed for a moment.
  fresh: ReadonlySet<string>;
  // The card a session's lanes open (M60), by session id.
  cards: ReadonlyMap<string, LaneCardAnchor>;
  // The card a branch's label opens when on its side, by branch.
  labelCards: ReadonlyMap<string, LaneCardAnchor>;
  // The card an agent's marker opens (M65).
  agentCard: (item: AgentItem) => LaneCardAnchor | null;
  // The mark's kind and the sideways label for a row (M68): a member's
  // is the agent's, a session's own row reads the session's. family (M9
  // fix 292) is the member's model word off the same read the label
  // wears, null before a request or on the session's own row.
  agentMark: (item: AgentItem) => { kind: 'claude' | 'shell'; label: string; family: string | null };
  // The card the outside block opens (M68), when the graph has one.
  outsideCard: LaneCardAnchor | null;
  now: number;
  // Upright with no rows beside the gutter (M9 fix 162, a panel's
  // lines-only form): a mark draws no leader toward rows that are not
  // there. On its side there is never one.
  bare?: boolean | undefined;
  // The session behind the focused pane (M9 fix 186), whose block says
  // "you are here": a ground slab fitted to its tree (M9 fix 212) and
  // the weight of its lines and dots against every other tree's. Null
  // when the focused pane is a view or empty, and nothing is lit.
  focusedSessionId?: string | null | undefined;
  // The zoom (M9 fix 213), one of SCALE_STEPS; 1 when absent.
  scale?: number | undefined;
  // The commit whose row is hovered or whose card is open (M9 fix 254):
  // its node's leader draws at full strength.
  raisedHash?: string | null | undefined;
  // The conflict forecast (M9 fix 320): the ties to draw between two
  // lanes' newest commit nodes; null or empty draws nothing.
  forecast?: ConflictReading | null | undefined;
  // The rows that draw nothing (M9 fix 869): a replay's commits not landed yet and agents not out yet.
  hidden?: ReadonlySet<number> | undefined;
}

// The rows the drawing spans (M9 fix 211) and how many: every item's
// beside the rows, the model's drawn range with them off; a graph with
// nothing drawn keeps every row, so an empty picture has the length it
// had rather than none.
export function drawnRange(graph: SessionGraph, rowsOff: boolean): { from: number; to: number; count: number } {
  const n = graph.items.length;
  const r = rowsOff && graph.drawnRows !== null ? graph.drawnRows : { from: 0, to: n - 1 };
  return { ...r, count: n === 0 ? 0 : r.to - r.from + 1 };
}

// Where a lane sits across the gutter: its slot and its block's gap,
// and the empty pitches before it (M9 fix 305: a block with member
// lanes leaves one between its own line and the first member, so the
// rail the person looks for stands apart from the members; the gaps
// are counted in the drawing, since a slot is a column and the model's
// columns stay as they are).
export function laneAcross(slot: number, block: number, horizontal: boolean, p: Pitch = pitch(1), gaps = 0): number {
  return horizontal ? p.label + p.laneX0 + (slot + gaps) * p.track + block * p.trackGap : p.laneX0 + (slot + gaps) * p.laneGap + block * p.sessionGap;
}

const NO_ROWS: ReadonlySet<number> = new Set();

export function CommitGraph({ graph, orientation, reverse, merged, fresh, cards, labelCards, agentCard, agentMark, outsideCard, now, bare = false, focusedSessionId = null, scale = 1, raisedHash = null, forecast = null, hidden = NO_ROWS }: Props) {
  const p = pitch(scale);
  const { items, lanes, blocks, lines, dots } = graph;
  const n = items.length;
  // A slot is a column several blocks can share (M71): its group gives
  // the gap, the block on each element gives the colour, the card and
  // the data; a lane def is found by block and slot for its member.
  const groupOfSlot = new Map<number, number>();
  const laneDef = new Map<string, (typeof lanes)[number]>();
  for (const l of lanes) {
    groupOfSlot.set(l.slot, l.group);
    laneDef.set(`${l.block} ${l.slot}`, l);
  }
  const blockOfSession = new Map<string | null, number>();
  blocks.forEach((b, bi) => blockOfSession.set(b.sessionId, bi));
  const horizontal = orientation === 'horizontal';
  // The labels, and the room across they want, are the sideways form's
  // alone (M9 fix 173).
  const drawLabels = horizontal;
  const spaced = horizontal;
  const rowPitch = horizontal ? p.col : p.row;
  // The rows the drawing spans (M9 fix 211): beside the rows every
  // item's, since the gutter must run the list's length; with the rows
  // off (on its side, or upright and bare) the drawn range alone, so
  // the rows of a hidden block past either end are not scroll space.
  const range = drawnRange(graph, horizontal || bare);
  const count = range.count;
  // Time runs down when upright and to the right on its side, newest
  // first at the top and newest last at the right, unless reversed.
  const flipped = horizontal ? !reverse : reverse;
  const place = (row: number) => (flipped ? range.to - row : row - range.from);
  const t = (row: number) => place(row) * rowPitch + rowPitch / 2;
  // Past the oldest row, whichever end that is.
  const tBottom = flipped ? 0 : count * rowPitch;
  // The member lanes (M9 fix 305): per block, its member lanes in slot
  // order take a tint of the block's colour each, and the block's first
  // slot is its own line, drawn heavier with an empty pitch after it. A
  // column group with such a block puts the gap after its first column,
  // and every column past it moves over by the gaps before it. The
  // first slot is the own line whatever member the walk put on it (a
  // member's commit merged fast-forward sits on the trunk), so it is
  // never tinted.
  const firstSlot = new Map<number, number>();
  for (const l of lanes) {
    const first = firstSlot.get(l.block);
    if (first === undefined || l.slot < first) firstSlot.set(l.block, l.slot);
  }
  const memberLanes = new Map<number, number>();
  const tintOf = new Map<string, { index: number; color: string }>();
  const ownBlocks = new Set<number>();
  const gapGroups = new Map<number, number>();
  for (const l of [...lanes].sort((x, y) => x.slot - y.slot)) {
    if (l.memberId === null || l.slot === firstSlot.get(l.block)) continue;
    ownBlocks.add(l.block);
    const index = (memberLanes.get(l.block) ?? 0) + 1;
    memberLanes.set(l.block, index);
    tintOf.set(`${l.block} ${l.slot}`, { index, color: '' });
  }
  for (const [key, tint] of tintOf) {
    const block = Number(key.split(' ')[0]);
    const color = blocks[block]?.color ?? null;
    tint.color = color === null ? '' : memberTint(color, tint.index, memberLanes.get(block) ?? 1);
  }
  for (const l of lanes) {
    if (!ownBlocks.has(l.block)) continue;
    const first = gapGroups.get(l.group);
    if (first === undefined || l.slot < first) gapGroups.set(l.group, l.slot);
  }
  const gapsBefore = (slot: number): number => {
    let n = 0;
    for (const first of gapGroups.values()) if (first < slot) n++;
    return n;
  };
  const a = (slot: number) => laneAcross(slot, groupOfSlot.get(slot) ?? 0, spaced, p, gapsBefore(slot));
  const xy = (time: number, across: number): [number, number] => (horizontal ? [time, across] : [across, time]);
  const pt = (time: number, across: number) => xy(time, across).join(' ');
  const gutter = (graph.columns === 0 ? laneAcross(0, 0, spaced, p) : laneAcross(graph.columns - 1, graph.groups - 1, spaced, p, gapsBefore(graph.columns - 1))) + p.gutterEnd;
  const [width, height] = xy(count * rowPitch, gutter);
  // The focused session's block (M9 fix 186, redrawn by M9 fix 212 as
  // design 4a): a ground slab fitted to the tree, its lane block wide
  // and its rows long, fading out over 22px at an open end so another
  // session's tree on the same columns further down never stands on lit
  // ground (M71 packs blocks whose rows do not overlap into one column,
  // which is exactly that case); the weight carries the rest, in the
  // CSS off data-focused. A block with no lanes drawn (M72) has nothing
  // to light.
  const focusedBlock = focusedSessionId === null ? undefined : blockOfSession.get(focusedSessionId);
  const focusedSlots = lanes.filter((l) => l.block === focusedBlock).map((l) => l.slot);
  const lit = (block: number) => block === focusedBlock && focusedSlots.length > 0;
  const gradientId = useId();
  let slab: React.ReactNode = null;
  if (focusedSlots.length > 0 && focusedBlock !== undefined) {
    const lo = a(Math.min(...focusedSlots)) - p.slabInset;
    const hi = a(Math.max(...focusedSlots)) + p.slabInset;
    // The rows the tree touches: its items (the pending agent row is the
    // topmost mark), its lines' two ends and its dots; a line running
    // off the list's end keeps the slab solid to that end.
    let rowLo = Infinity;
    let rowHi = -Infinity;
    let toEnd = false;
    const touch = (row: number) => {
      if (row < rowLo) rowLo = row;
      if (row > rowHi) rowHi = row;
    };
    for (const it of items) if (it.lane !== null && blockOfSession.get(it.sessionId) === focusedBlock) touch(it.row);
    for (const l of lines) {
      if (l.block !== focusedBlock) continue;
      touch(l.fromRow);
      if (l.toRow === 'bottom') toEnd = true;
      else touch(l.toRow);
    }
    for (const d of dots) if (d.block === focusedBlock) touch(d.row);
    if (rowLo !== Infinity) {
      const length = count * rowPitch;
      let t0 = Math.min(place(rowLo), place(rowHi)) * rowPitch;
      let t1 = (Math.max(place(rowLo), place(rowHi)) + 1) * rowPitch;
      if (toEnd) {
        if (flipped) t0 = 0;
        else t1 = length;
      }
      const solid0 = Math.max(0, t0 - p.slabMargin);
      const solid1 = Math.min(length, t1 + p.slabMargin);
      // An end whose fade would run past the list's end is a hard edge
      // there instead; the solid region then reaches that end.
      const fade0 = solid0 - p.slabFade > 0;
      const fade1 = solid1 + p.slabFade < length;
      const start = fade0 ? solid0 - p.slabFade : 0;
      const end = fade1 ? solid1 + p.slabFade : length;
      const solidStart = fade0 ? solid0 : 0;
      const solidEnd = fade1 ? solid1 : length;
      const span = Math.max(1, end - start);
      const [gx1, gy1] = xy(start, 0);
      const [gx2, gy2] = xy(end, 0);
      const [sx, sy] = xy(start, lo);
      const [sw, sh] = xy(end - start, hi - lo);
      const stops: React.ReactNode[] = [];
      if (fade0) {
        stops.push(<stop key="a0" className="commits-slab-clear" offset={0} />, <stop key="a1" className="commits-slab-solid" offset={p.slabFade / span} />);
      } else stops.push(<stop key="a" className="commits-slab-solid" offset={0} />);
      if (fade1) {
        stops.push(<stop key="b0" className="commits-slab-solid" offset={1 - p.slabFade / span} />, <stop key="b1" className="commits-slab-clear" offset={1} />);
      } else stops.push(<stop key="b" className="commits-slab-solid" offset={1} />);
      slab = (
        <>
          <defs>
            <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={gx1} y1={gy1} x2={gx2} y2={gy2}>
              {stops}
            </linearGradient>
          </defs>
          <rect className="commits-focus-slab" x={sx} y={sy} width={sw} height={sh} fill={`url(#${gradientId})`} data-session={focusedSessionId ?? undefined} data-solid={`${solidStart} ${solidEnd}`} data-fades={`${fade0 ? 'start' : ''},${fade1 ? 'end' : ''}`} data-rows={`${rowLo} ${rowHi}`} />
        </>
      );
    }
  }
  // The block's colour, or the lane's tint on a member lane when the
  // slot is given (the edges, nodes, dots and leaders; the markers and
  // labels keep the block's).
  const style = (block: number, slot?: number): React.CSSProperties | undefined => {
    const tint = slot === undefined ? undefined : tintOf.get(`${block} ${slot}`);
    const color = tint !== undefined && tint.color !== '' ? tint.color : (blocks[block]?.color ?? null);
    return color === null ? undefined : ({ '--lane': color } as React.CSSProperties);
  };
  const laneData = (slot: number, block: number) => {
    const b = blocks[block]!;
    const lane = laneDef.get(`${block} ${slot}`);
    const tint = tintOf.get(`${block} ${slot}`);
    const own = ownBlocks.has(block) && lane !== undefined && firstSlot.get(block) === slot;
    return { 'data-lane': slot, 'data-block': block, 'data-session': b.sessionId ?? undefined, 'data-member': lane?.memberId ?? undefined, 'data-tint': tint?.index, 'data-own': own ? '' : undefined, 'data-gone': b.gone ? '' : undefined, 'data-outside': b.sessionId === null ? '' : undefined, 'data-history': b.history === null ? undefined : b.history.transcriptId, 'data-person': b.person === null ? undefined : b.person.name, 'data-remote': b.remote === null ? undefined : b.remote.branch };
  };
  const pathOf = (line: GraphLine): string => {
    const t0 = t(line.fromRow);
    const t1 = line.toRow === 'bottom' ? tBottom : t(line.toRow);
    const a0 = a(line.lane);
    if (line.toLane === null) return `M${pt(t0, a0)} L${pt(t1, a0)}`;
    // The far end changes lane: straight to one row short of it, then a
    // quarter curve into the far lane at its row (the merge-back); a
    // fork bends over less when the lanes are close, as the note gives it.
    const a1 = a(line.toLane);
    const step = Math.sign(t1 - t0) || 1;
    const bend = line.kind === 'fork' ? Math.min(rowPitch, Math.max(6, Math.abs(a0 - a1) * 1.6)) : rowPitch;
    const knee = t1 - step * bend;
    const straight = step > 0 ? knee > t0 : knee < t0;
    return `M${pt(t0, a0)}${straight ? ` L${pt(knee, a0)}` : ''} Q${pt(t1, a0)} ${pt(t1, a1)}`;
  };

  // Everything of a session in one group, so its lines and nodes anchor
  // its card (M60) together; the grey block's make a group of their own
  // for the outside card (M68) when the panel gives one, else stay loose.
  const groups = new Map<string, React.ReactNode[]>();
  const loose: React.ReactNode[] = [];
  const outsideNodes: React.ReactNode[] = [];
  const hasCard = (sessionId: string | null) => (sessionId === null ? outsideCard !== null : cards.has(sessionId));
  const into = (sessionId: string | null, node: React.ReactNode) => {
    if (!hasCard(sessionId)) loose.push(node);
    else if (sessionId === null) outsideNodes.push(node);
    else {
      const g = groups.get(sessionId) ?? [];
      g.push(node);
      groups.set(sessionId, g);
    }
  };
  lines.forEach((line, i) => {
    const sessionId = blocks[line.block]!.sessionId;
    const d = pathOf(line);
    const edge = <path key={`l${i}`} className="commits-edge" d={d} data-kind={line.kind} data-dashed={line.dashed ? '' : undefined} data-from={line.fromRow} data-to={line.toRow === 'bottom' ? 'b' : line.toRow} {...laneData(line.lane, line.block)} style={style(line.block, line.lane)} />;
    if (hasCard(sessionId)) {
      // A transparent twin under the line, wide enough to hover.
      into(sessionId, <path key={`l${i}-hit`} className="commits-edge-hit" d={d} />);
    }
    into(sessionId, edge);
  });
  const markers: React.ReactNode[] = [];
  const labels: React.ReactNode[] = [];
  // A dotted leader from every commit node to its row (M9 fix 254), the
  // agent marker's kind, so a node on a far lane can be read against the
  // list; faint enough that forty read as a texture, and raised on the
  // row's hover or while its card is open. Drawn under the lanes' lines
  // and outside the lane groups, so they neither cover a line nor widen
  // a card's hover target. None on its side or bare, as the agent's.
  const leaders: React.ReactNode[] = [];
  const leaderTo = horizontal || bare ? null : gutter - 5;
  // On its side an agent's label runs from its mark the way time flows
  // into the room (M9 fix 142): rightwards, or leftwards when reversed,
  // so it never runs back over the lane's own commits; cut to a length
  // (the whole text is on the card and the row), and its box kept so a
  // pill on the band it crosses can yield. The agent labels are laid
  // first, since the pills read them. The boxes are laid in one frame
  // for both orientations, (u, across), where u is the text's own axis:
  // time itself on its side, and time negated upright, since there the
  // text is turned through 90 degrees at its anchor (rotate(-90) points
  // the text's x up the page, toward the newest row, newest first) and
  // runs the other way along time. In that frame the anchor end and the
  // side of the mark the label starts from flip with reverse alone.
  const agentBoxes: TextBox[] = [];
  const u = (time: number) => (horizontal ? time : -time);
  const fromU = (along: number) => (horizontal ? along : -along);
  const labelSide = reverse ? -1 : 1;
  const labelAnchor = reverse ? 'end' : 'start';
  const turn = (time: number, across: number): string | undefined => (horizontal ? undefined : `rotate(-90 ${across} ${time})`);
  for (const it of items) {
    if (it.kind !== 'agent' || it.lane === null || !drawLabels || hidden.has(it.row)) continue;
    agentBoxes.push(textBox(u(t(it.row)) + labelSide * (p.mark / 2 + 2), a(it.lane) + 3, cutLabel(agentMark(it).label), labelAnchor));
  }
  for (const it of items) {
    // A commit whose block draws no lanes (M72) has no node: the row
    // stays and the gutter shows nothing beside it.
    if (it.lane === null || hidden.has(it.row)) continue;
    const block = blockOfSession.get(it.sessionId) ?? 0;
    const [cx, cy] = xy(t(it.row), a(it.lane));
    if (it.kind === 'commit') {
      into(
        it.sessionId,
        <circle key={it.commit.hash} className="commits-node" cx={cx} cy={cy} r={p.nodeR} data-hash={it.commit.hash} data-fresh={fresh.has(it.commit.hash) ? '' : undefined} {...laneData(it.lane, block)} data-member={it.memberId ?? undefined} style={style(block, it.lane)}>
          <title>{isWriteHash(it.commit.hash) ? it.commit.subject : `${it.commit.hash.slice(0, 7)} ${it.commit.subject}`}</title>
        </circle>,
      );
      if (leaderTo !== null && leaderTo > cx + p.nodeR + 2) {
        leaders.push(<line key={`leader-${it.commit.hash}`} className="commits-leader" x1={cx + p.nodeR} y1={cy} x2={leaderTo} y2={cy} data-hash={it.commit.hash} data-raised={raisedHash === it.commit.hash ? '' : undefined} data-lane={it.lane} data-outside={it.sessionId === null ? '' : undefined} data-remote={remoteBranchOf(it.sessionId) ?? undefined} style={style(block, it.lane)} />);
      }
      // A person's commit wears a mark on its node (M9 fix 286): the
      // person glyph, or the session mark when the commit carries a
      // Claude-Session trailer, since their agent made it. In the
      // block's colour on a clip box of the panel ground, the agent
      // marker's manner, so the lane does not run through the glyph.
      const person = personNameOf(it.sessionId);
      if (person !== null) {
        const trailer = it.commit.claudeSession !== null && it.commit.claudeSession !== undefined;
        into(
          it.sessionId,
          <g key={`person-${it.commit.hash}`} className="commits-person-node" data-hash={it.commit.hash} data-person={person} data-kind={trailer ? 'claude' : 'person'} data-lit={lit(block) ? '' : undefined} style={style(block)}>
            <foreignObject x={cx - p.mark / 2} y={cy - p.mark / 2} width={p.mark} height={p.mark}>
              {trailer ? <SessionMark kind="claude" working={false} size="unit" className="commits-agent-mark commits-person-mark" /> : <PersonGlyph className="commits-agent-mark commits-person-mark" />}
            </foreignObject>
          </g>,
        );
      }
      if (drawLabels) {
        // A pill sits above its node (on the head side, across) unless
        // an agent label crosses that band, when it sits below (M9 fix
        // 142). A remote branch's label (M9 fix 286) follows the local
        // ones on the same commit.
        const time = t(it.row);
        const across = a(it.lane);
        const names = [...it.commit.refs.map((b) => ({ b, remote: false })), ...(it.commit.remoteRefs ?? []).map((b) => ({ b, remote: true }))];
        const below = names.some(({ b }, i) => pillYields(textBox(u(time), across - 6 - i * 10, b, 'middle'), agentBoxes));
        names.forEach(({ b, remote }, i) => {
          const at = below ? across + 6 + 8 + i * 10 : across - 6 - i * 10;
          const [lx, ly] = xy(time, at);
          labels.push(<GraphLabel key={`${it.commit.hash}-${remote ? 'remote:' : ''}${b}`} branch={b} x={lx} y={ly} transform={turn(time, at)} below={below} merged={merged.has(b)} remote={remote} style={style(block)} card={remote ? null : (labelCards.get(b) ?? null)} />);
        });
      }
      continue;
    }
    const mark = agentMark(it);
    const memberId = it.member?.id ?? null;
    markers.push(<AgentMarker key={`agent-${it.sessionId}-${memberId ?? 'own'}`} item={it} kind={mark.kind} family={mark.family} cx={cx} cy={cy} leaderTo={horizontal || bare ? null : gutter - 5} style={style(block)} card={agentCard(it)} now={now} lit={lit(block)} mark={p.mark} />);
    if (drawLabels) {
      const time = fromU(u(t(it.row)) + labelSide * (p.mark / 2 + 2));
      const across = a(it.lane) + 3;
      const [lx, ly] = xy(time, across);
      labels.push(<text key={`agent-label-${it.sessionId}-${memberId ?? 'own'}`} className="commits-label" data-agent="" data-member={memberId ?? undefined} data-session={it.sessionId} x={lx} y={ly} transform={turn(time, across)} textAnchor={labelAnchor} style={style(block)}>{cutLabel(mark.label)}</text>);
    }
  }
  // The marks that are not commits (M68's start, M9 fix 145's bars),
  // each in its block's group so the lane's card opens on it too; a bar
  // is a stroke across the lane, a dot the node's circle.
  for (const d of dots) {
    const [cx, cy] = xy(t(d.row), a(d.lane));
    // data-kind (M9 fix 152) tells a start bar from a fork bar, for the
    // card's lines and the scripts that read them; data-landing (M9 fix
    // 399) tells a fork bar's landing from a lane's own end.
    const data = { 'data-start': d.kind === 'start' ? '' : undefined, 'data-shape': d.shape, 'data-kind': d.kind, 'data-landing': d.landing ? '' : undefined, ...laneData(d.lane, d.block) };
    const key = `${d.kind}-${d.row}-${d.lane}`;
    if (d.shape === 'dot') {
      into(d.sessionId, <circle key={key} className="commits-node" cx={cx} cy={cy} r={p.nodeR} {...data} style={style(d.block, d.lane)} />);
      continue;
    }
    const half = p.nodeR * 1.5;
    const [x1, y1] = xy(t(d.row), a(d.lane) - half);
    const [x2, y2] = xy(t(d.row), a(d.lane) + half);
    into(d.sessionId, <line key={key} className="commits-node commits-bar" x1={x1} y1={y1} x2={x2} y2={y2} {...data} style={style(d.block, d.lane)} />);
  }
  // The conflict forecast's ties (M9 fix 320, docs/design/
  // conflict-forecast.md section 7): per pair a run of chevrons along
  // the segment between the two lanes' newest commit nodes, all
  // pointing toward the older head, in --error, drawn under the lanes
  // (before them in document order, so every lane it crosses paints
  // over it and stays whole); a dotted r6 halo on each of the two
  // nodes, drawn after the nodes so it sits over them, one per node
  // however many ties end there; and a transparent hit path over the
  // slope that opens the lane card of the session whose head the
  // slope leaves (the newer) and raises the slope while the pointer is
  // on it. No count anywhere on the graph; the card has the files.
  // Nor is a stale lane's count drawn (M9 fix 938: its digit beside the
  // fork mark read as a stray number); the card's base line says it.
  // Nothing animates, and no pairs draws nothing at all.
  const ties: React.ReactNode[] = [];
  const halos: React.ReactNode[] = [];
  const haloAt = new Set<string>();
  if (forecast !== null) {
    for (const tie of forecast.ties) {
      const newer = tie.tipA <= tie.tipB ? { row: tie.tipA, lane: tie.laneA, id: tie.a } : { row: tie.tipB, lane: tie.laneB, id: tie.b };
      const older = newer.id === tie.a ? { row: tie.tipB, lane: tie.laneB, id: tie.b } : { row: tie.tipA, lane: tie.laneA, id: tie.a };
      const [x0, y0] = xy(t(newer.row), a(newer.lane));
      const [x1, y1] = xy(t(older.row), a(older.lane));
      const d = chevronRun(x0, y0, x1, y1, scale);
      ties.push(<TieGroup key={`tie-${tie.a}-${tie.b}`} tie={tie} from={newer.id} to={older.id} d={d} hit={`M${x0} ${y0} L${x1} ${y1}`} card={cards.get(newer.id) ?? null} />);
      for (const end of [newer, older]) {
        const key = `${end.row} ${end.lane}`;
        if (haloAt.has(key)) continue;
        haloAt.add(key);
        const [cx, cy] = xy(t(end.row), a(end.lane));
        halos.push(<circle key={`halo-${key}`} className="commits-tie-halo" cx={cx} cy={cy} r={6 * scale} data-session={end.id} data-row={end.row} data-lane={end.lane} />);
      }
    }
  }
  return (
    <svg className="commits-graph" width={width} height={height} viewBox={`0 0 ${width} ${height}`} data-lanes={lanes.length} data-columns={graph.columns} data-rows={n} data-drawn-rows={count} data-drawn-from={range.from} data-pitch={rowPitch} data-scale={scale} data-orientation={orientation} data-reverse={reverse || undefined} data-labels={drawLabels ? '' : undefined} data-focused={focusedSlots.length > 0 ? focusedSessionId ?? undefined : undefined}>
      {slab}
      {ties}
      {leaders}
      {loose}
      {outsideCard !== null && (
        <GraphLane sessionId={null} card={outsideCard}>
          {outsideNodes}
        </GraphLane>
      )}
      {[...groups].map(([sessionId, children]) => (
        <GraphLane key={sessionId} sessionId={sessionId} card={cards.get(sessionId)!} focused={sessionId === focusedSessionId && focusedSlots.length > 0}>
          {children}
        </GraphLane>
      ))}
      {halos}
      {markers}
      {labels}
    </svg>
  );
}

// The chevron run of a tie (M9 fix 320): the segment walked at a 6px
// step, a three-point path at each step (back plus the normal, the
// tip, back minus the normal) with the tip 1.7px along the unit vector
// toward the older head, the back 0.9px against it and the normal
// 1.8px, every step within 8px of either end skipped so the halos stay
// clean. At this size the run reads as a dash with a grain, git's
// `>>>>>>>`, for no more ink than the dash it replaces.
export function chevronRun(x0: number, y0: number, x1: number, y1: number, scale = 1): string {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return '';
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const step = 6 * scale;
  const margin = 8 * scale;
  const tip = 1.7 * scale;
  const back = 0.9 * scale;
  const normal = 1.8 * scale;
  const parts: string[] = [];
  const f = (n: number) => Math.round(n * 100) / 100;
  for (let along = margin; along <= len - margin; along += step) {
    const cx = x0 + ux * along;
    const cy = y0 + uy * along;
    const bx = cx - ux * back;
    const by = cy - uy * back;
    parts.push(`M${f(bx + nx * normal)} ${f(by + ny * normal)} L${f(cx + ux * tip)} ${f(cy + uy * tip)} L${f(bx - nx * normal)} ${f(by - ny * normal)}`);
  }
  return parts.join(' ');
}

// One tie's slope and its hit path in a group, so the hit's hover
// raises the slope through the CSS and opens the card of the session
// whose head the slope leaves, on the lane card's manners.
function TieGroup({ tie, from, to, d, hit, card }: { tie: ConflictTie; from: string; to: string; d: string; hit: string; card: LaneCardAnchor | null }) {
  const ref = useRef<SVGGElement>(null);
  const state = usePopoverAnchor(card !== null);
  const handlers = card === null ? {} : state.handlers;
  return (
    <>
      <g ref={ref} className="commits-tie-group" data-a={tie.a} data-b={tie.b} data-from={from} data-to={to} data-files={tie.files.length} data-popover-for={card?.id} data-popover-open={state.open} {...handlers}>
        <path className="commits-tie" d={d} data-from={from} data-to={to} />
        <path className="commits-tie-hit" d={hit} />
      </g>
      {card !== null && state.card(ref.current, card.card)}
    </>
  );
}

// A session's lines and nodes in one group that opens the session's
// card (M60) on hover and pins it on a click, as a span anchor does; the
// outside block's group (M68, a null session) opens the outside card.
function GraphLane({ sessionId, card, children, focused = false }: { sessionId: string | null; card: LaneCardAnchor; children: React.ReactNode; focused?: boolean }) {
  const ref = useRef<SVGGElement>(null);
  const state = usePopoverAnchor();
  return (
    <>
      <g ref={ref} className="commits-lane-group" data-session={sessionId ?? undefined} data-outside={sessionId === null ? '' : undefined} data-history={historyIdOf(sessionId) ?? undefined} data-person={personNameOf(sessionId) ?? undefined} data-remote={remoteBranchOf(sessionId) ?? undefined} data-span={spanIdOf(sessionId)?.ordinal} data-focused={focused ? '' : undefined} data-popover-for={card.id} data-popover-open={state.open} {...state.handlers}>
        {children}
      </g>
      {state.card(ref.current, card.card)}
    </>
  );
}

// The agent's marker on its row (M65): the session mark in a one-glyph
// clip box on the panel background, so the lane does not run through
// the glyph, stepping while the member runs and still once it has
// returned; a dotted leader from the marker to the row's status word
// when upright. The box is the hover target that opens the agent's
// card; nothing else in the row is. A session's own row (M68) carries
// the session's mark, stepping while it works, under data-session with
// no data-member. The session's mark is the sidebar row's size and a
// member's the size of a unit on the team list (M9 fix 132), the same
// pairing as the sidebar's, so the session's star tells from the agents
// it sent out; the box stays one 16px cell either way, since it is the
// hover target and what clears the next lane's line at the 12px pitch.
// lit (M9 fix 212): the marker stands on the focused block's slab, so
// its clip box takes the slab's colour rather than the panel's, or the
// glyph reads as a dark notch in the lit ground.
// family (M9 fix 292): a member's star tells its model family from the
// others' on the same lane, by size; the session's own mark passes none,
// so its star stays the row size whatever family it is. The word also
// goes on data-family, for the script.
function AgentMarker({ item, kind, family, cx, cy, leaderTo, style, card, now, lit, mark }: { item: AgentItem; kind: 'claude' | 'shell'; family: string | null; cx: number; cy: number; leaderTo: number | null; style: React.CSSProperties | undefined; card: LaneCardAnchor | null; now: number; lit: boolean; mark: number }) {
  const ref = useRef<SVGGElement>(null);
  const state = usePopoverAnchor(card !== null);
  const working = item.working;
  const memberId = item.member?.id;
  const size: MarkSize = item.member === null ? 'row' : 'unit';
  const memberFamily = item.member === null ? null : family;
  const handlers = card === null ? {} : state.handlers;
  void now;
  return (
    <>
      {leaderTo !== null && leaderTo > cx + mark / 2 + 2 && <line className="commits-leader" x1={cx + mark / 2 + 2} y1={cy} x2={leaderTo} y2={cy} data-member={memberId} data-session={item.sessionId} style={style} />}
      <g ref={ref} className="commits-agent-node" data-member={memberId} data-session={item.sessionId} data-lane={item.lane} data-size={size} data-family={memberFamily ?? undefined} data-working={working ? '' : undefined} data-pending={item.pending ? '' : undefined} data-start={item.startRow !== null ? '' : undefined} data-lit={lit ? '' : undefined} data-popover-for={card?.id} data-popover-open={state.open} style={style} {...handlers}>
        <foreignObject x={cx - mark / 2} y={cy - mark / 2} width={mark} height={mark}>
          <SessionMark kind={kind} working={working} size={size} family={memberFamily} className="commits-agent-mark" />
        </foreignObject>
      </g>
      {card !== null && state.card(ref.current, card.card)}
    </>
  );
}

// A branch's name when on its side, above its commit, or below it when
// an agent's label has the band above (M9 fix 142, data-below); an
// anchor for the card when the branch has one (M60). A merged branch's
// draws dim; a remote branch's (M9 fix 286) says so in its tooltip.
function GraphLabel({ branch, x, y, transform, below, merged, remote = false, style, card }: { branch: string; x: number; y: number; transform?: string | undefined; below: boolean; merged: boolean; remote?: boolean; style: React.CSSProperties | undefined; card: LaneCardAnchor | null }) {
  const ref = useRef<SVGTextElement>(null);
  const state = usePopoverAnchor(card !== null);
  const hover = card === null ? {} : state.handlers;
  return (
    <>
      <text ref={ref} className="commits-label" x={x} y={y} transform={transform} textAnchor="middle" data-branch={branch} data-below={below || undefined} data-merged={merged || undefined} data-remote={remote || undefined} data-popover-for={card?.id} data-popover-open={state.open} style={style} {...hover}>
        {branch}
        <title>{remote ? `${branch}, on the remote as of the last fetch${merged ? ', merged' : ''}` : merged ? `${branch}, merged` : branch}</title>
      </text>
      {card !== null && state.card(ref.current, card.card)}
    </>
  );
}

// The person glyph (M9 fix 286): a head over shoulders, drawn in
// currentColor so the box's colour rule (the block's --lane) colours it
// as it colours the star. Sized by the box it sits in, as the star is.
export function PersonGlyph({ className }: { className?: string | undefined }) {
  return (
    <span className={className === undefined ? 'person-glyph' : `person-glyph ${className}`}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <circle cx="8" cy="5" r="3" fill="currentColor" />
        <path d="M2.5 14.5c0-3.2 2.5-5 5.5-5s5.5 1.8 5.5 5z" fill="currentColor" />
      </svg>
    </span>
  );
}

export type { CommitItem };
