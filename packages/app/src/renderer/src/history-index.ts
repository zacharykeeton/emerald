import { useSyncExternalStore } from 'react';
import type { ActivitySession } from '@emerald/shared';
import type { HistoryScan, HistoryTranscript } from '../../preload/api.ts';

// What the transcripts on disk say, published once a scan has run, for
// the views that meet a conversation the daemon has no record of. Two
// readings of the one scan: the titles by Claude session id (M57), the
// last name the activity timeline can give a track no daemon record
// names (one from before the daemon kept removed sessions, or from a
// home whose sessions.json was lost); and the transcripts by claude.ai
// session id (M70), which is how the Commits graph puts an outside
// commit's trailer on the conversation that made it. The Sessions tab
// publishes every scan it makes; a view that needs one asks for a scan
// of its own if none has landed yet, and draws without it until it does.

let titles: ReadonlyMap<string, string> = new Map();
let transcripts: ReadonlyMap<string, HistoryTranscript> = new Map();
let asked = false;
const listeners = new Set<() => void>();

export function publishHistoryTitles(scan: HistoryScan): void {
  const next = new Map<string, string>();
  for (const s of scan.sessions) next.set(s.id, s.title);
  titles = next;
  transcripts = transcriptsByRemoteId(scan.transcripts ?? []);
  asked = true;
  for (const l of listeners) l();
}

// One transcript under each of its ids, so a conversation that was
// handed a new id at a resume is reached by either. The first transcript
// to name an id keeps it, which cannot happen on one machine anyway.
export function transcriptsByRemoteId(list: readonly HistoryTranscript[]): Map<string, HistoryTranscript> {
  const byRemote = new Map<string, HistoryTranscript>();
  for (const t of list) {
    for (const r of t.remoteIds) if (!byRemote.has(r)) byRemote.set(r, t);
  }
  return byRemote;
}

// One scan, once, unless the Sessions tab has published already.
export function ensureHistoryTitles(): void {
  if (asked) return;
  asked = true;
  window.emerald.history
    .scan()
    .then(publishHistoryTitles)
    .catch((err: unknown) => console.warn('[emerald] history scan for titles failed', err));
}

// The same scan, asked for by the Commits graph (M70).
export const ensureHistoryTranscripts = ensureHistoryTitles;

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useHistoryTitles(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, () => titles);
}

export function useHistoryTranscripts(): ReadonlyMap<string, HistoryTranscript> {
  return useSyncExternalStore(subscribe, () => transcripts);
}

// The rows with a name filled in from the titles where the daemon gave
// none; a row still unnamed is left null for the views to word.
export function nameActivity(sessions: ActivitySession[], titles: ReadonlyMap<string, string>): ActivitySession[] {
  return sessions.map((s) => {
    if (s.name !== null || s.claudeSessionId === null) return s;
    const title = titles.get(s.claudeSessionId);
    return title === undefined ? s : { ...s, name: title };
  });
}

export function needsHistoryTitles(sessions: ActivitySession[]): boolean {
  return sessions.some((s) => s.name === null && s.claudeSessionId !== null);
}

// For tests: forget everything published.
export function resetHistoryTitles(): void {
  titles = new Map();
  transcripts = new Map();
  asked = false;
}
