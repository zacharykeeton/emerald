// The pure rules behind a session shown in several panes at once (M50):
// which pane's size the PTY takes, how far a pane that is too small for
// the terminal scales it down, and the byte ring that lets a pane opened
// later be shown what the first one was replayed.

export interface Fit {
  cols: number;
  rows: number;
}

export interface SizedHandle {
  paneId: string;
  // What the pane's host could fit, or null while it has no size (hidden
  // by zoom, not laid out yet).
  fit: Fit | null;
}

export interface Chosen {
  paneId: string;
  fit: Fit;
}

// The PTY follows the focused pane whenever that pane shows the session,
// so the pane someone is typing into is the one at 1:1. When the focus is
// elsewhere the size stays with the pane chosen last, so a click into a
// third pane does not resize the PTY and redraw a TUI for nothing, and
// only once that pane is gone does the first pane with a size take over,
// which is how a lone pane, a pane placed without focus and a window
// resize under an unfocused pane keep sizing the PTY as they always did.
export function chooseSize(handles: readonly SizedHandle[], focusedPaneId: string | null, lastPaneId: string | null): Chosen | null {
  const sized = (paneId: string | null): Chosen | null => {
    if (paneId === null) return null;
    const handle = handles.find((h) => h.paneId === paneId && h.fit !== null);
    return handle === undefined || handle.fit === null ? null : { paneId: handle.paneId, fit: handle.fit };
  };
  const first = handles.find((h) => h.fit !== null);
  return sized(focusedPaneId) ?? sized(lastPaneId) ?? (first === undefined || first.fit === null ? null : { paneId: first.paneId, fit: first.fit });
}

export function sameFit(a: Fit | null, b: Fit | null): boolean {
  return a === b || (a !== null && b !== null && a.cols === b.cols && a.rows === b.rows);
}

export interface Box {
  width: number;
  height: number;
}

// A mirror whose host is smaller than the terminal is scaled down to fit
// rather than clipped, since the prompt lives on the last row and a clip
// would hide it. Never scaled up: a host with room shows the terminal at
// 1:1 in its top left corner. A host or terminal with no size is 1.
export function scaleFor(host: Box, term: Box): number {
  if (host.width <= 0 || host.height <= 0 || term.width <= 0 || term.height <= 0) return 1;
  return Math.min(1, host.width / term.width, host.height / term.height);
}

// The renderer's copy of the daemon's ring: what the session's first pane
// was replayed plus every chunk since, capped at the same size, so a pane
// opened later is written the same scrollback without a second attach
// (which would restart the replay into every pane). One array is
// allocated up front and never grows.
export class MirrorRing {
  private readonly buf: Uint8Array;
  private start = 0;
  private length = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError(`MirrorRing capacity must be a positive integer, got ${capacity}`);
    this.capacity = capacity;
    this.buf = new Uint8Array(capacity);
  }

  get size(): number {
    return this.length;
  }

  write(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    if (chunk.length >= this.capacity) {
      // Only the tail can fit, and it is the whole ring.
      this.buf.set(chunk.subarray(chunk.length - this.capacity));
      this.start = 0;
      this.length = this.capacity;
      return;
    }
    const end = (this.start + this.length) % this.capacity;
    const room = this.capacity - end;
    if (chunk.length <= room) {
      this.buf.set(chunk, end);
    } else {
      this.buf.set(chunk.subarray(0, room), end);
      this.buf.set(chunk.subarray(room), 0);
    }
    const overflow = this.length + chunk.length - this.capacity;
    if (overflow > 0) {
      this.start = (this.start + overflow) % this.capacity;
      this.length = this.capacity;
    } else {
      this.length += chunk.length;
    }
  }

  readAll(): Uint8Array {
    const out = new Uint8Array(this.length);
    const firstRun = Math.min(this.length, this.capacity - this.start);
    out.set(this.buf.subarray(this.start, this.start + firstRun));
    if (firstRun < this.length) out.set(this.buf.subarray(0, this.length - firstRun), firstRun);
    return out;
  }

  clear(): void {
    this.start = 0;
    this.length = 0;
  }
}
