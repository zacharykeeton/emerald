import { useEffect, useSyncExternalStore } from 'react';
import type { ContextHistory, ServerHistory, SessionUse, SkillHistory } from '../../preload/api.ts';

// The Context tab's history (M9 fix 1040), as the main process reads it
// off every transcript on the machine (context-history.ts): one held
// answer for the machine and a session part per transcript. The rail and
// the pane view ask on mount and again on each new breakdown (its `at`
// moves at every Measure) or another transcript, no more often than once
// per CONTEXT_HISTORY_MIN_MS for one transcript; the first read of a big
// home takes seconds (13 s for 1.79 GB on the probe), so `reading` stays
// true until the first answer lands and the cells say so.

export const CONTEXT_HISTORY_MIN_MS = 10_000;

interface Held {
  machine: { skills: Record<string, SkillHistory>; servers: Record<string, ServerHistory> } | null;
  sessions: ReadonlyMap<string, SessionUse>;
  reading: boolean;
}

let held: Held = { machine: null, sessions: new Map(), reading: true };
// When each transcript was last asked for, and a trailing ask waiting out
// the gap, so a breakdown that lands inside it is still read.
const lastAsk = new Map<string, number>();
const trailing = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function publish(next: Held): void {
  held = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function ask(transcript: string | null): void {
  const key = transcript ?? '';
  const last = lastAsk.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < CONTEXT_HISTORY_MIN_MS) {
    if (!trailing.has(key)) {
      trailing.set(
        key,
        setTimeout(() => {
          trailing.delete(key);
          ask(transcript);
        }, CONTEXT_HISTORY_MIN_MS - (now - last)),
      );
    }
    return;
  }
  lastAsk.set(key, now);
  window.emerald.history
    .context(transcript)
    .then((got: ContextHistory) => {
      const sessions = new Map(held.sessions);
      if (transcript !== null && got.session !== null) sessions.set(transcript, got.session);
      publish({ machine: { skills: got.skills, servers: got.servers }, sessions, reading: false });
    })
    .catch((err: unknown) => {
      console.warn('[emerald] context history failed', err);
      // Asked again on the next change rather than waiting out the gap.
      lastAsk.delete(key);
    });
}

export interface ContextHistoryView {
  skills: Record<string, SkillHistory>;
  servers: Record<string, ServerHistory>;
  session: SessionUse | null;
  reading: boolean;
}

const EMPTY: Record<string, never> = {};

// The history for a transcript: `ask` null reads what is held and asks
// nothing (the Skills section, under a RailContext that already asked).
export function useContextHistory(ask_: { transcript: string | null; at: number | null } | null): ContextHistoryView {
  const h = useSyncExternalStore(subscribe, () => held);
  const transcript = ask_?.transcript ?? null;
  const at = ask_?.at ?? null;
  const asking = ask_ !== null;
  // On mount, on another transcript and on each new breakdown.
  useEffect(() => {
    if (asking) ask(transcript);
  }, [asking, transcript, at]);
  return {
    skills: h.machine?.skills ?? EMPTY,
    servers: h.machine?.servers ?? EMPTY,
    session: transcript === null ? null : (h.sessions.get(transcript) ?? null),
    reading: h.reading,
  };
}

// For tests: forget everything held.
export function resetContextHistory(): void {
  held = { machine: null, sessions: new Map(), reading: true };
  lastAsk.clear();
  for (const t of trailing.values()) clearTimeout(t);
  trailing.clear();
}
