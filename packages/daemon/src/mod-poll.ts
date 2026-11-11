// The emerald mod's prompt channel as a long poll on the hook sink (M9 fix
// 1125). Before it, every hosted Claude's mod spawned `emmer mod-channel`,
// a Node process of about 24 MB a session that held a pipe connection open
// for the daemon's pushes. Now the mod asks POST /channel and the sink holds
// that request until the daemon has a line for the session or the hold
// runs out, and the mod asks again at once. This record is the one both
// sides share: the sink's route hands each poll here, and the pipe server
// pushes lines here and hears when a session's channel goes up or down.
import { Limits } from '@emerald/shared';

export type ModLine = { text: string; submitId?: string } | { context: 'summary' | 'full' };
export type ModPollAnswer = { lines: ModLine[] } | { replaced: true };

interface Held {
  resolve: (answer: ModPollAnswer) => void;
  timer: NodeJS.Timeout;
}

interface Entry {
  held: Held | null;
  queue: ModLine[];
  up: boolean;
  grace: NodeJS.Timeout | null;
}

export class ModPoll {
  private readonly holdMs: number;
  private readonly graceMs: number;
  private readonly entries = new Map<string, Entry>();
  private onUp: (sessionId: string) => void = () => undefined;
  private onDown: (sessionId: string, dropped: ModLine[]) => void = () => undefined;

  constructor(opts: { holdMs?: number; graceMs?: number } = {}) {
    this.holdMs = opts.holdMs ?? Limits.modPollHoldMs;
    this.graceMs = opts.graceMs ?? Limits.modPollGraceMs;
  }

  watch(up: (sessionId: string) => void, down: (sessionId: string, dropped: ModLine[]) => void): void {
    this.onUp = up;
    this.onDown = down;
  }

  isUp(sessionId: string): boolean {
    return this.entries.get(sessionId)?.up === true;
  }

  // One poll from the session's mod. gone() is its request closing before
  // the answer: a mod's fetch never closes its own held poll, so a close
  // is the Claude gone and the channel reads down at once.
  poll(sessionId: string): { answer: Promise<ModPollAnswer>; gone: () => void } {
    let entry = this.entries.get(sessionId);
    if (entry === undefined) {
      entry = { held: null, queue: [], up: false, grace: null };
      this.entries.set(sessionId, entry);
    }
    const e = entry;
    // A second loop in one process cannot happen (register.js keeps one),
    // so a newer poll is a new process for the session; the older loop ends.
    if (e.held !== null) this.answer(sessionId, e, { replaced: true });
    if (e.grace !== null) {
      clearTimeout(e.grace);
      e.grace = null;
    }
    if (!e.up) {
      e.up = true;
      this.onUp(sessionId);
    }
    let mine: Held | null = null;
    const answer = new Promise<ModPollAnswer>((resolve) => {
      if (e.queue.length > 0) {
        const lines = e.queue;
        e.queue = [];
        resolve({ lines });
        this.startGrace(sessionId, e);
        return;
      }
      const timer = setTimeout(() => this.answer(sessionId, e, { lines: [] }), this.holdMs);
      timer.unref();
      mine = { resolve, timer };
      e.held = mine;
    });
    const gone = (): void => {
      if (mine === null || e.held !== mine) return;
      clearTimeout(mine.timer);
      e.held = null;
      this.down(sessionId, e);
    };
    return { answer, gone };
  }

  // A line for the session's mod: false when its channel is not up, else
  // the held poll takes it at once or it waits for the next poll.
  push(sessionId: string, line: ModLine): boolean {
    const e = this.entries.get(sessionId);
    if (e === undefined || !e.up) return false;
    if (e.held !== null) this.answer(sessionId, e, { lines: [line] });
    else e.queue.push(line);
    return true;
  }

  // The session exited.
  end(sessionId: string): void {
    const e = this.entries.get(sessionId);
    if (e === undefined) return;
    if (e.held !== null) {
      clearTimeout(e.held.timer);
      e.held.resolve({ lines: [] });
      e.held = null;
    }
    if (e.grace !== null) clearTimeout(e.grace);
    e.grace = null;
    const wasUp = e.up;
    const dropped = e.queue;
    this.entries.delete(sessionId);
    if (wasUp) this.onDown(sessionId, dropped);
  }

  private answer(sessionId: string, e: Entry, answer: ModPollAnswer): void {
    const held = e.held;
    if (held === null) return;
    clearTimeout(held.timer);
    e.held = null;
    held.resolve(answer);
    this.startGrace(sessionId, e);
  }

  private startGrace(sessionId: string, e: Entry): void {
    if (e.grace !== null) clearTimeout(e.grace);
    e.grace = setTimeout(() => {
      e.grace = null;
      this.down(sessionId, e);
    }, this.graceMs);
    e.grace.unref();
  }

  private down(sessionId: string, e: Entry): void {
    if (e.grace !== null) clearTimeout(e.grace);
    e.grace = null;
    const dropped = e.queue;
    this.entries.delete(sessionId);
    if (e.up) this.onDown(sessionId, dropped);
  }
}
