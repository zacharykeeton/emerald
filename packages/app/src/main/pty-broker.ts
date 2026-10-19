// Which windows' renderers hold an attachment on each session (M9 fix
// 866). Every window of one process shares the main process's one pipe
// connection, and the daemon keeps one sink per session per connection:
// a second pty.attach replays the ring again into the same connection
// and one pty.detach drops the only sink (pipe-server.test.ts pins both).
// So an attach is always forwarded (the renderer that did not ask resets
// on the replay, terminal-feed.ts), and a detach only once the last
// window holding the session lets it go.
export class PtyBroker {
  private readonly holders = new Map<string, Set<number>>();

  attach(sessionId: string, contentsId: number): void {
    let set = this.holders.get(sessionId);
    if (set === undefined) {
      set = new Set();
      this.holders.set(sessionId, set);
    }
    set.add(contentsId);
  }

  // True when no window holds the session afterwards, including one no
  // window held, so a detach is forwarded as it always was.
  detach(sessionId: string, contentsId: number): boolean {
    const set = this.holders.get(sessionId);
    if (set === undefined) return true;
    set.delete(contentsId);
    if (set.size > 0) return false;
    this.holders.delete(sessionId);
    return true;
  }

  // A window gone: the sessions it held that no other window holds.
  drop(contentsId: number): string[] {
    const freed: string[] = [];
    for (const [sessionId, set] of this.holders) {
      if (!set.delete(contentsId)) continue;
      if (set.size === 0) {
        this.holders.delete(sessionId);
        freed.push(sessionId);
      }
    }
    return freed;
  }

  clear(): void {
    this.holders.clear();
  }
}
