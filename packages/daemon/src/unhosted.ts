import { Limits, initialState, reduce } from '@emerald/shared';
import type { HookPayload, SessionInfo } from '@emerald/shared';
import type { HookResult } from './hook-sink.ts';
import type { Logger } from './log.ts';

// The conversations emerald did not start (M9 fix 233). A Claude in a plain
// terminal posts its hooks when the hook script finds daemon.json, under
// the conversation's own id and with the unhosted mark, and nothing here
// is a session: no PTY, no record, no row in the sidebar, nothing saved.
// What the hooks are for is the activity view, whose spans are read off
// the `from` and `to` the sink writes beside each line, and those come
// from running the state machine; so each conversation gets a bare
// SessionInfo of its own, reduced by the same table a pane's record is,
// and the transition is handed back the way applyHook hands it. The
// table keeps the folder the hooks name too (placeIn), which is where
// the activity view lists the track. A conversation is forgotten at its
// SessionEnd, and one that posts again after that starts afresh; a
// daemon restart forgets them all, and the log's lines still hold the
// spans.
//
// A conversation that never posts its SessionEnd (a plain terminal closed
// mid-turn posts nothing at all) is aged out once its last hook is older
// than the bound (M9 fix 460, the ledger's H3): with it gone from the list
// the activity view closes its track at the track's last line, as it does
// for any record the daemon no longer holds, rather than running a working
// span or a wait to now for the rest of the daemon's life. An hour is six
// stale thresholds, far past any turn's silence a live Claude keeps.
export type UnhostedOptions = { sweepEveryMs?: number; ageOutAfterMs?: number };

export class UnhostedSessions {
  private readonly infos = new Map<string, SessionInfo>();
  // When each conversation last posted, the age-out's clock.
  private readonly lastHookAt = new Map<string, number>();
  private readonly log: Logger;
  private readonly ageOutAfterMs: number;
  private readonly timer: NodeJS.Timeout;

  constructor(log: Logger, opts: UnhostedOptions = {}) {
    this.log = log;
    this.ageOutAfterMs = opts.ageOutAfterMs ?? Limits.staleAfterMs * 6;
    this.timer = setInterval(() => this.sweep(Date.now()), opts.sweepEveryMs ?? 60_000);
    this.timer.unref();
  }

  // Forgets every conversation whose last hook is older than the bound.
  sweep(now: number): void {
    for (const [id, at] of this.lastHookAt) {
      if (now - at <= this.ageOutAfterMs) continue;
      this.infos.delete(id);
      this.lastHookAt.delete(id);
      this.log.info('unhosted conversation aged out', { id, silentMs: now - at });
    }
  }

  stop(): void {
    clearInterval(this.timer);
  }

  apply(conversationId: string, payload: HookPayload, at: number): HookResult {
    const before = this.infos.get(conversationId) ?? bareInfo(conversationId, payload, at);
    const after = reduce(before, { type: 'hook', payload, at });
    if (payload.hook_event_name === 'SessionEnd') {
      this.infos.delete(conversationId);
      this.lastHookAt.delete(conversationId);
      this.log.info('unhosted conversation ended', { id: conversationId });
    } else {
      if (!this.infos.has(conversationId)) this.log.info('unhosted conversation seen', { id: conversationId, cwd: after.cwd });
      this.infos.set(conversationId, after);
      this.lastHookAt.set(conversationId, at);
    }
    return before.state === after.state ? { outcome: 'applied' } : { outcome: 'applied', from: before.state, to: after.state };
  }

  // What the activity answer reads for its tracks: each conversation as
  // the daemon holds it now, keyed by the conversation's id, which is
  // the track's id too.
  list(): SessionInfo[] {
    return [...this.infos.values()];
  }
}

// A record-shaped blank for the reducer: a claude kind so the hooks move
// it, the conversation's id already bound so a nested claude -p's hooks
// read as foreign, and the folder the first hook names. The name is the
// folder's: the activity view names an unhosted track from the
// transcript's own title and never reads this one.
function bareInfo(conversationId: string, payload: HookPayload, at: number): SessionInfo {
  const cwd = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : '';
  return {
    id: conversationId,
    kind: 'claude',
    name: cwd,
    autoName: true,
    spawnCwd: cwd,
    args: [],
    cwd,
    groupCwd: cwd,
    branch: null,
    lastPrompt: null,
    lastReply: null,
    lastPromptAt: null,
    lastReplyAt: null,
    state: initialState('claude'),
    stateSince: at,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    waitingOn: [],
    team: [],
    model: null,
    contextPercent: null,
    contextWindow: null,
    tokens: null,
    costUsd: null,
    tasks: [],
    comment: null,
    phase: null,
    color: '',
    title: null,
    transcriptPath: null,
    liveReply: null,
    liveTool: null,
    liveVerb: null,
    claudeSessionId: conversationId,
    remoteSessionId: null,
    startHead: null,
    conversation: null,
    commits: [],
    shellCwd: null,
    command: null,
    pid: null,
    exitCode: null,
    createdAt: at,
  };
}
