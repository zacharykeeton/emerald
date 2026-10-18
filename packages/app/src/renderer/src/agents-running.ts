import { useEffect, useSyncExternalStore } from 'react';
import type { SessionInfo } from '@emerald/shared';
import type { AgentsRunning } from '../../preload/api.ts';
import { REFRESH_MS } from './activity-data.ts';
import { liveConversations, sameAgentsRunning } from './agents-running-model.ts';

// The forks' spend since the main thread's last request (M9 fix 277),
// one answer per conversation id as the main process reads it off the
// agents' files (history.ts readAgentsRunning). Asked for every live
// Claude row with a conversation on the activity beat, when a row's
// own figure moves (the status line that follows the main thread's
// request covers the agents' requests up to it, so the answer drops
// them), and when a card opens on the row. A conversation no
// transcript names is kept as null; the row then shows the bare
// figure and nothing asks on every render. An answer that says what
// the held one says publishes nothing (M9 fix 354): the beat asks every
// 30 s and most answers are the same files read again.

let store: ReadonlyMap<string, AgentsRunning | null> = new Map();
const held = new Map<string, AgentsRunning | null>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();

function publish(): void {
  store = new Map(held);
  for (const l of listeners) l();
}

// One ask per id at a time; an ask while one is out is dropped, since
// the answer on its way is read against the same files.
export function askAgentsRunning(conversation: string): void {
  if (inFlight.has(conversation)) return;
  inFlight.add(conversation);
  window.emerald.history
    .agentsRunning(conversation)
    .then((res) => {
      if (sameAgentsRunning(held.get(conversation), res)) return;
      held.set(conversation, res);
      publish();
    })
    .catch((err: unknown) => console.warn('[emerald] agents running failed', err))
    .finally(() => {
      inFlight.delete(conversation);
    });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAgentsRunning(): ReadonlyMap<string, AgentsRunning | null> {
  return useSyncExternalStore(subscribe, () => store);
}

// The beat: every live row's conversation asked on mount, whenever one
// of their own figures moves, and every REFRESH_MS in between.
export function useAgentsRunningBeat(sessions: Iterable<SessionInfo>): void {
  const key = liveConversations(sessions)
    .map(([id, usd]) => `${id}:${usd}`)
    .join('|');
  useEffect(() => {
    if (key === '') return;
    const ask = () => {
      for (const part of key.split('|')) askAgentsRunning(part.slice(0, part.lastIndexOf(':')));
    };
    ask();
    const timer = setInterval(ask, REFRESH_MS);
    return () => clearInterval(timer);
  }, [key]);
}

// The shaded pane's beat (M9 fix 322): while a pane is shaded on a
// session with an agent out, its conversation alone is asked every
// three seconds, so the row's `$99 ~` and the shade's member models
// follow the forks' files as they grow rather than at the 30 s beat.
// A shade is a reading of the pane in front of you, and the ask is a
// stat per file (the main process parses on a changed stamp only), so
// the faster beat is cheap for one conversation and stays off the
// sidebar's rows. The 30 s beat keeps running beside it; an ask while
// one is out is dropped, so the two never double up. Claude Code's own
// figure was found to move with every status line, together with the
// counts (the fix's reproduction against a real session), so the main
// thread's part of the price never lags and only the forks' part needed
// the faster read.
export const TEAM_BEAT_MS = 3000;

export function useTeamBeat(conversation: string | null, agentOut: boolean): void {
  useEffect(() => {
    if (conversation === null || !agentOut) return;
    askAgentsRunning(conversation);
    const timer = setInterval(() => askAgentsRunning(conversation), TEAM_BEAT_MS);
    return () => clearInterval(timer);
  }, [conversation, agentOut]);
}

// For tests: forget everything held.
export function resetAgentsRunning(): void {
  held.clear();
  inFlight.clear();
  store = new Map();
}
