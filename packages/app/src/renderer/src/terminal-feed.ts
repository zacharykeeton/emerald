import { KILLED_EXIT_CODE, Limits, currentTab } from '@emerald/shared';
import type { RendererPush, EmeraldApi } from '../../preload/api.ts';
import { MirrorRing, chooseSize, sameFit, scaleFor } from './mirror-model.ts';
import type { Chosen, Fit } from './mirror-model.ts';
import { getState, subscribe } from './store.ts';

// One attachment per session for the whole renderer (M50). A session can
// be shown in several panes at once, and the daemon's attachment is one
// sink per session per pipe connection whose second attach restarts the
// replay into every listener, so the panes' terminals do not attach for
// themselves any more: the first handle on a session attaches, the feed
// keeps a mirror of the daemon's ring (what that handle was replayed and
// every chunk since), and a handle opened later is written the mirror
// instead. Every chunk goes to every handle, and the last handle's close
// lets the attachment go, a moment later, so a session moving between
// panes (the old pane's handle parked, the new one opened) keeps its
// attachment and its scrollback throughout.
//
// The size is the feed's too, since two panes on one PTY cannot each
// size it: the rules are in mirror-model.ts (the focused pane's when that
// pane shows the session, else the last choice while its pane lasts,
// else the first pane with a size). Every handle's terminal is resized to
// the chosen size, so a mirror in a smaller pane is scaled down to fit
// rather than reflowed or clipped; only the feed calls term.resize and
// sends pty.resize.

export interface FeedTerminal {
  readonly cols: number;
  readonly rows: number;
  write(data: string | Uint8Array): void;
  reset(): void;
  resize(cols: number, rows: number): void;
  readonly element?: HTMLElement | undefined;
}

export interface OpenOptions {
  // Through a function since a handle can be adopted into another pane
  // (Pane.tsx, fix 36) without being reopened.
  paneId: () => string;
  // The host the terminal sits in, for the scale; absent in tests.
  host?: () => HTMLElement;
  // What the host fits at open, or null while it has no size.
  fit?: Fit | null;
}

export interface FeedHandle {
  // The host's size changed, or the text size: what it fits now, or
  // null while it has no size (hidden by zoom).
  report(fit: Fit | null): void;
  close(): void;
}

export interface FeedDeps {
  emerald: Pick<EmeraldApi, 'on' | 'request' | 'send'>;
  focusedPaneId: () => string | null;
  onLayout: (fn: () => void) => () => void;
  ringBytes?: number;
  detachMs?: number;
}

interface Handle {
  term: FeedTerminal;
  paneId: () => string;
  host: (() => HTMLElement) | null;
  fit: Fit | null;
}

interface Attachment {
  sessionId: string;
  ring: MirrorRing;
  handles: Handle[];
  // pty.attach has been sent (its reply may be pending): a handle opened
  // now must not attach again.
  attached: boolean;
  // A reattach is in flight; a second call while it is meets nothing.
  reattaching: boolean;
  chosen: Chosen | null;
  detachTimer: ReturnType<typeof setTimeout> | null;
}

// The last handle's close detaches after this, so a session shown again
// within a moment keeps its attachment and needs no replay; it is
// Pane.tsx's PARK_MS again, past a same-commit re-mount.
export const DETACH_MS = 250;

const encoder = new TextEncoder();

export class TerminalFeed {
  private readonly deps: FeedDeps;
  private readonly attachments = new Map<string, Attachment>();
  private off: (() => void) | null = null;
  private focused: string | null = null;
  // How many attaches and detaches went out, for the verify scripts:
  // window.emerald is frozen by the context bridge, so a script cannot
  // count them by wrapping request.
  readonly stats = { attaches: 0, detaches: 0 };

  constructor(deps: FeedDeps) {
    this.deps = deps;
  }

  // Listens lazily, on the first open, so a module loaded by a test with
  // no window is inert until used.
  private listen(): void {
    if (this.off !== null) return;
    const offPush = this.deps.emerald.on((msg) => this.onPush(msg));
    this.focused = this.deps.focusedPaneId();
    const offLayout = this.deps.onLayout(() => {
      const next = this.deps.focusedPaneId();
      if (next === this.focused) return;
      this.focused = next;
      for (const a of this.attachments.values()) this.decide(a);
    });
    this.off = () => {
      offPush();
      offLayout();
    };
  }

  open(sessionId: string, term: FeedTerminal, opts: OpenOptions): FeedHandle {
    this.listen();
    let a = this.attachments.get(sessionId);
    if (a === undefined) {
      a = { sessionId, ring: new MirrorRing(this.deps.ringBytes ?? Limits.ringBufferBytes), handles: [], attached: false, reattaching: false, chosen: null, detachTimer: null };
      this.attachments.set(sessionId, a);
    }
    if (a.detachTimer !== null) {
      clearTimeout(a.detachTimer);
      a.detachTimer = null;
    }
    const handle: Handle = { term, paneId: opts.paneId, host: opts.host ?? null, fit: opts.fit ?? null };
    const late = a.attached;
    a.handles.push(handle);
    this.decide(a);
    if (late) {
      // Resized to the chosen size first: a TUI replayed at another width
      // does not redraw when the size changes afterwards.
      if (a.chosen !== null) term.resize(a.chosen.fit.cols, a.chosen.fit.rows);
      if (a.ring.size > 0) term.write(a.ring.readAll());
      this.scale(a, handle);
    }
    return {
      report: (fit) => {
        handle.fit = fit;
        const held = this.attachments.get(sessionId);
        if (held === undefined || !held.handles.includes(handle)) return;
        this.decide(held);
        this.scale(held, handle);
      },
      close: () => this.close(sessionId, handle),
    };
  }

  // A new PTY behind the same id (a resume) or a new pipe connection: the
  // daemon replays from the start, so every terminal on the session is
  // cleared and the ring with it, and one attach goes out for them all.
  reattach(sessionId: string): void {
    const a = this.attachments.get(sessionId);
    if (a === undefined || a.reattaching) return;
    a.reattaching = true;
    a.ring.clear();
    for (const h of a.handles) h.term.reset();
    this.attach(a).finally(() => {
      a.reattaching = false;
    });
  }

  private close(sessionId: string, handle: Handle): void {
    const a = this.attachments.get(sessionId);
    if (a === undefined) return;
    const i = a.handles.indexOf(handle);
    if (i < 0) return;
    a.handles.splice(i, 1);
    if (a.handles.length > 0) {
      this.decide(a);
      return;
    }
    if (a.detachTimer !== null) clearTimeout(a.detachTimer);
    a.detachTimer = setTimeout(() => {
      a.detachTimer = null;
      if (a.handles.length > 0) return;
      this.attachments.delete(sessionId);
      if (!a.attached) return;
      this.stats.detaches += 1;
      void this.deps.emerald.request('pty.detach', { sessionId }).catch(() => {});
    }, this.deps.detachMs ?? DETACH_MS);
  }

  // Picks the size, applies it to every terminal and tells the PTY when
  // it changed; the first size also brings the attachment up.
  private decide(a: Attachment): void {
    const { sessionId } = a;
    const chosen = chooseSize(
      a.handles.map((h) => ({ paneId: h.paneId(), fit: h.fit })),
      this.focused,
      a.chosen?.paneId ?? null,
    );
    if (chosen === null) return;
    const changed = !sameFit(a.chosen?.fit ?? null, chosen.fit);
    a.chosen = chosen;
    if (!changed && a.attached) return;
    for (const h of a.handles) {
      if (h.term.cols !== chosen.fit.cols || h.term.rows !== chosen.fit.rows) h.term.resize(chosen.fit.cols, chosen.fit.rows);
    }
    if (a.attached) {
      this.deps.emerald.send({ type: 'pty.resize', sessionId, cols: chosen.fit.cols, rows: chosen.fit.rows });
    } else {
      void this.attach(a);
    }
    for (const h of a.handles) this.scale(a, h);
  }

  // The resize goes first on the same ordered pipe so the replay and the
  // live output match the terminals. Counts as attached from the moment
  // the request is sent, so a handle opened before the reply lands is
  // written the ring rather than attaching again.
  private attach(a: Attachment): Promise<void> {
    const { sessionId } = a;
    a.attached = true;
    this.stats.attaches += 1;
    if (a.chosen !== null) this.deps.emerald.send({ type: 'pty.resize', sessionId, cols: a.chosen.fit.cols, rows: a.chosen.fit.rows });
    return this.deps.emerald.request('pty.attach', { sessionId }).then(
      () => undefined,
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.broadcast(a, encoder.encode(`\r\n\x1b[31m[cannot attach: ${message}]\x1b[0m\r\n`));
      },
    );
  }

  private broadcast(a: Attachment, data: Uint8Array): void {
    a.ring.write(data);
    for (const h of a.handles) h.term.write(data);
  }

  private onPush(msg: RendererPush): void {
    if (msg.type === 'pty.output') {
      const a = this.attachments.get(msg.sessionId);
      if (a !== undefined) this.broadcast(a, msg.data);
    } else if (msg.type === 'pty.exit') {
      const a = this.attachments.get(msg.sessionId);
      if (a === undefined) return;
      const note = msg.exitCode === KILLED_EXIT_CODE ? 'killed from emerald' : `process exited with code ${msg.exitCode}`;
      this.broadcast(a, encoder.encode(`\r\n\x1b[90m[${note}]\x1b[0m\r\n`));
    } else if (msg.type === 'daemon.connected') {
      // The new pipe connection has no attachments.
      for (const sessionId of this.attachments.keys()) this.reattach(sessionId);
    }
  }

  // A mirror whose host is smaller than the terminal is scaled down about
  // its top left corner, and takes no pointer while scaled: xterm maps
  // the mouse by the unscaled cell, so a selection there would land on
  // the wrong cell, and a mirror is for watching. The room is the xterm
  // element's content box (its padding is the 4px inset of fix 20, read
  // off the screen's offset), the terminal's size the cell size times the
  // grid, from the render service the fit addon reads the same way, and
  // failing that the screen element's layout size, which a transform
  // leaves alone. The host carries the scale for the verify scripts.
  private scale(a: Attachment, h: Handle): void {
    const el = h.term.element;
    const host = h.host?.();
    if (el === undefined || host === undefined) return;
    const screen = el.querySelector<HTMLElement>('.xterm-screen');
    const inset = screen === null ? 0 : screen.offsetLeft;
    const room = { width: el.clientWidth - 2 * inset, height: el.clientHeight - 2 * inset };
    const s = a.chosen !== null && h.fit !== null && sameFit(a.chosen.fit, h.fit) ? 1 : scaleFor(room, termPixels(h.term, screen));
    const next = s < 1 ? `scale(${s.toFixed(4)})` : '';
    if (el.style.transform !== next) {
      el.style.transform = next;
      el.style.transformOrigin = next === '' ? '' : 'top left';
      el.style.pointerEvents = next === '' ? '' : 'none';
    }
    if (next === '') delete host.dataset['mirrorScale'];
    else host.dataset['mirrorScale'] = s.toFixed(3);
  }
}

function termPixels(term: FeedTerminal, screen: HTMLElement | null): { width: number; height: number } {
  const cell = (term as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } } })._core?._renderService?.dimensions?.css?.cell;
  if (cell !== undefined && cell.width > 0 && cell.height > 0) return { width: cell.width * term.cols, height: cell.height * term.rows };
  return screen === null ? { width: 0, height: 0 } : { width: screen.offsetWidth, height: screen.offsetHeight };
}

// The renderer's feed, on the real pipe and the store's layout. Tests
// build their own on fakes.
let shared: TerminalFeed | null = null;

export function feed(): TerminalFeed {
  if (shared === null) {
    shared = new TerminalFeed({
      emerald: window.emerald,
      focusedPaneId: () => {
        const layout = getState().layout;
        return layout === null ? null : currentTab(layout).focusedPaneId;
      },
      onLayout: subscribe,
    });
    // Reachable from a verify script, like the emeraldTerm tag on a host.
    (window as Window & { emeraldFeed?: TerminalFeed }).emeraldFeed = shared;
  }
  return shared;
}
