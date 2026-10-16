import { useRef, useState } from 'react';
import type { LayoutNode, LayoutTab, SplitDirection } from '@emerald/shared';
import { listPanes, setRatio } from '@emerald/shared';
import { pullPane, pullSource } from './actions.ts';
import { Pane } from './Pane.tsx';
import { ViewPane } from './ViewPane.tsx';
import { editTab } from './store.ts';

interface Props {
  tab: LayoutTab;
  // Whether this tab is the one on show; the focused pane only takes the
  // keyboard in the tab on show.
  current: boolean;
  zoomedPaneId: string | null;
}

// Renders the split tree: a flex box per split, a Pane per leaf. Nodes are
// keyed by id so a pane keeps its terminal when a sibling changes.
//
// Zoom keeps the whole tree mounted and hides everything off the path from
// the root to the zoomed pane, so no terminal is torn down and replayed for
// a toggle. Hidden terminals skip their refits (see Pane.tsx), so the PTYs
// behind them keep their size until the pane is visible again.
export function SplitView({ tab, current, zoomedPaneId }: Props) {
  const zoomPath = zoomedPaneId === null ? null : pathTo(tab.root, zoomedPaneId);
  return (
    <div className={zoomPath === null ? 'splitview' : 'splitview zoomed'} data-tab-id={tab.id} data-zoomed-pane={zoomedPaneId ?? undefined}>
      <Node node={tab.root} focusedPaneId={current ? tab.focusedPaneId : null} zoomPath={zoomPath} paneCount={listPanes(tab).length} shown={current} />
    </div>
  );
}

// Ids of the nodes from the root down to the pane, or null if it is not in the tree.
function pathTo(node: LayoutNode, paneId: string): Set<string> | null {
  if (node.id === paneId) return new Set([node.id]);
  if (node.kind === 'pane') return null;
  const below = pathTo(node.first, paneId) ?? pathTo(node.second, paneId);
  if (below === null) return null;
  below.add(node.id);
  return below;
}

function Node({ node, focusedPaneId, zoomPath, paneCount, shown }: { node: LayoutNode; focusedPaneId: string | null; zoomPath: Set<string> | null; paneCount: number; shown: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  if (node.kind === 'pane') {
    if (node.view !== null) return <ViewPane key={node.id} paneId={node.id} view={node.view} focused={node.id === focusedPaneId} onlyPane={paneCount === 1} shown={shown} />;
    return <Pane key={node.id} paneId={node.id} sessionId={node.sessionId} focused={node.id === focusedPaneId} onlyPane={paneCount === 1} />;
  }
  const onPath = zoomPath !== null && zoomPath.has(node.id);
  const firstHidden = onPath && !zoomPath.has(node.first.id);
  const secondHidden = onPath && !zoomPath.has(node.second.id);
  return (
    <div className={`split split-${node.direction}`} data-split-id={node.id} ref={containerRef}>
      <div className="split-first" style={{ flexBasis: onPath ? '100%' : `${node.ratio * 100}%` }} hidden={firstHidden}>
        <Node key={node.first.id} node={node.first} focusedPaneId={focusedPaneId} zoomPath={zoomPath} paneCount={paneCount} shown={shown} />
      </div>
      <Gutter splitId={node.id} direction={node.direction} containerRef={containerRef} hidden={onPath} />
      <div className="split-second" hidden={secondHidden}>
        <Node key={node.second.id} node={node.second} focusedPaneId={focusedPaneId} zoomPath={zoomPath} paneCount={paneCount} shown={shown} />
      </div>
    </div>
  );
}

interface GutterProps {
  splitId: string;
  direction: SplitDirection;
  containerRef: React.RefObject<HTMLDivElement | null>;
  hidden: boolean;
}

// What a drag is sizing: a split and the box it fills, in window
// coordinates. For a plain drag that is this gutter's own split; for a
// Ctrl+drag it is the split the pull just made, which fills the box the
// source pane had.
interface DragTarget {
  splitId: string;
  rect: DOMRect;
}

// Dragging the divider sets the ratio on this one split. The store is not
// authoritative, so the pane does not move until the daemon pushes the new
// layout back; on a local pipe that is well under a frame. With Ctrl held
// the drag first pulls a new pane out against the divider (a shell in the
// focused pane's folder) and then sizes that instead.
function Gutter({ splitId, direction, containerRef, hidden }: GutterProps) {
  const [dragging, setDragging] = useState(false);

  // Follows the mouse until it is released. The target may still be on its
  // way (a pull is a round trip to the daemon); moves before it lands are
  // remembered and the last one is applied when it does, so a quick flick
  // still sizes the new pane and a release is never missed.
  const drag = (target: Promise<DragTarget>) => {
    setDragging(true);
    document.body.classList.add(direction === 'row' ? 'dragging-col' : 'dragging-row');

    // Only one layout.set in flight; the newest ratio waits its turn so a
    // fast drag does not queue up dozens of stale requests.
    let inflight = false;
    let pending: number | null = null;
    let ready: DragTarget | null = null;
    let last: MouseEvent | null = null;
    const send = (ratio: number) => {
      if (ready === null) return;
      const { splitId: id } = ready;
      if (inflight) {
        pending = ratio;
        return;
      }
      inflight = true;
      void editTab((t) => setRatio(t, id, ratio))
        .catch((err: unknown) => console.warn('[emerald] resize failed', err))
        .finally(() => {
          inflight = false;
          if (pending !== null) {
            const next = pending;
            pending = null;
            send(next);
          }
        });
    };
    const ratioAt = (e: MouseEvent, rect: DOMRect) =>
      direction === 'row' ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
    const apply = (e: MouseEvent) => {
      last = e;
      if (ready !== null) send(ratioAt(e, ready.rect));
    };

    const onUp = (e: MouseEvent) => {
      window.removeEventListener('mousemove', apply);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('dragging-col', 'dragging-row');
      setDragging(false);
      apply(e);
    };
    window.addEventListener('mousemove', apply);
    window.addEventListener('mouseup', onUp);
    target
      .then((t) => {
        ready = t;
        if (last !== null) apply(last);
      })
      .catch((err: unknown) => {
        console.warn('[emerald] pull failed', err);
        onUp(last ?? new MouseEvent('mouseup'));
      });
  };

  const onMouseDown = (ev: React.MouseEvent) => {
    const container = containerRef.current;
    if (container === null || ev.button !== 0) return;
    ev.preventDefault();
    if (!ev.ctrlKey) {
      drag(Promise.resolve({ splitId, rect: container.getBoundingClientRect() }));
      return;
    }
    const source = pullSource(splitId);
    const box = source === null ? null : document.querySelector(`[data-pane-id="${source.paneId}"]`)?.getBoundingClientRect();
    if (source === null || box === null || box === undefined) return;
    // Measured before the split lands: the new split fills exactly this box.
    drag(pullPane(source.paneId, direction, source.place).then((id) => ({ splitId: id, rect: box })));
  };

  return (
    <div
      className={`gutter gutter-${direction}${dragging ? ' dragging' : ''}`}
      data-split-id={splitId}
      onMouseDown={onMouseDown}
      hidden={hidden}
    />
  );
}
