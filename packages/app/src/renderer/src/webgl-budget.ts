// The window's budget of WebGL contexts for its terminals (M9 fix 1130).
// Chromium keeps sixteen live WebGL contexts a renderer and drops the oldest
// for a seventeenth, so a window of twenty panes over five tabs lost
// contexts on the tab in front. Every layout tab is mounted, so a pane on a
// tab not in front still held one. The budget lets a hidden pane give its
// context up once more than WEBGL_LIVE_MARK are live, the least recently
// shown first, and takes one back for a pane before its tab is shown; a
// shown pane is never released. Nothing here waits on a scroll or an
// animation frame: a settle runs on the scheduler it is given, a microtask
// in the window. Imports only types and two pure helpers from shared, so a
// test runs it under node --test.
import { currentTab, findPane } from '@emerald/shared';
import type { Layout } from '@emerald/shared';

// Live WebGL contexts the window keeps before a hidden pane gives one up; four under Chromium's sixteen, so a tab of four coming to the front never takes the seventeenth.
export const WEBGL_LIVE_MARK = 12;

// One terminal as the budget sees it. live: holds an addon now; released:
// gave it up by this budget and takes one back when shown.
export interface WebglMember {
  live(): boolean;
  released(): boolean;
  release(): void;
  take(): void;
}

export function webglNote(released: number, took: number, live: number, mark = WEBGL_LIVE_MARK): string {
  return `[emerald] terminal webgl: released ${released} hidden, took ${took} shown, ${live} live (mark ${mark})`;
}

// Whether the pane is on show: on the window's current tab with no file tab
// over the panes. A zoom is not an input, so a pane behind a zoomed one
// counts as shown and keeps its context.
export function paneInFront(layout: Layout | null, paneId: string, fileTabOpen: boolean): boolean {
  if (fileTabOpen || layout === null) return false;
  try {
    return findPane(currentTab(layout), paneId) !== null;
  } catch {
    return false;
  }
}

interface Entry {
  shown: boolean;
  lastShown: number;
  seq: number;
}

export interface WebglBudgetOptions {
  mark?: number;
  schedule?: (fn: () => void) => void;
  say?: (line: string) => void;
}

export class WebglBudget {
  private readonly mark: number;
  private readonly schedule: (fn: () => void) => void;
  private readonly say: (line: string) => void;
  private readonly members = new Map<WebglMember, Entry>();
  private seq = 0;
  // The recency of a show: a member's lastShown is the tick it last went
  // from hidden to shown (or joined shown); 0 for one never shown.
  private shownTick = 0;
  private pending = false;
  private releasedCount = 0;
  private tookCount = 0;

  constructor(opts: WebglBudgetOptions = {}) {
    this.mark = opts.mark ?? WEBGL_LIVE_MARK;
    this.schedule = opts.schedule ?? ((fn) => queueMicrotask(fn));
    this.say = opts.say ?? ((line) => console.warn(line));
  }

  liveCount(): number {
    let n = 0;
    for (const m of this.members.keys()) if (m.live()) n++;
    return n;
  }

  // Records the member and answers whether it loads its addon now. A shown
  // member always does, making room among the hidden first; a hidden one
  // only while the window is under the mark.
  join(member: WebglMember, shown: boolean): boolean {
    this.members.set(member, { shown, lastShown: shown ? ++this.shownTick : 0, seq: ++this.seq });
    let load: boolean;
    if (shown) {
      while (this.liveCount() >= this.mark && this.releaseOldestHidden()) {
        // released one; go round
      }
      load = true;
    } else {
      load = this.liveCount() < this.mark;
      // A pane opened hidden past the mark starts released; the caller marks
      // it so, and the note counts it with the others.
      if (!load) this.releasedCount++;
    }
    this.queueSettle();
    return load;
  }

  show(member: WebglMember, shown: boolean): void {
    const e = this.members.get(member);
    if (e === undefined || e.shown === shown) return;
    e.shown = shown;
    if (shown) e.lastShown = ++this.shownTick;
    this.queueSettle();
  }

  roomFor(member: WebglMember): boolean {
    const e = this.members.get(member);
    if (e?.shown === true) return true;
    return this.liveCount() < this.mark;
  }

  leave(member: WebglMember): void {
    this.members.delete(member);
  }

  settle(): void {
    this.pending = false;
    const toTake = [...this.members].filter(([m, e]) => e.shown && m.released()).map(([m]) => m);
    while (this.liveCount() + toTake.length > this.mark && this.releaseOldestHidden()) {
      // released one; go round
    }
    for (const m of toTake) {
      m.take();
      this.tookCount++;
    }
    if (this.releasedCount > 0 || this.tookCount > 0) {
      this.say(webglNote(this.releasedCount, this.tookCount, this.liveCount(), this.mark));
      this.releasedCount = 0;
      this.tookCount = 0;
    }
  }

  private queueSettle(): void {
    if (this.pending) return;
    this.pending = true;
    this.schedule(() => this.settle());
  }

  // The hidden live member shown longest ago (ties by join order) gives its
  // context up; false when no hidden member is live.
  private releaseOldestHidden(): boolean {
    let pick: WebglMember | null = null;
    let pickEntry: Entry | null = null;
    for (const [m, e] of this.members) {
      if (e.shown || !m.live()) continue;
      if (pickEntry === null || e.lastShown < pickEntry.lastShown || (e.lastShown === pickEntry.lastShown && e.seq < pickEntry.seq)) {
        pick = m;
        pickEntry = e;
      }
    }
    if (pick === null) return false;
    pick.release();
    this.releasedCount++;
    return true;
  }
}

// The window's one budget: each window is its own renderer and its own sixteen.
export const webglBudget = new WebglBudget();
