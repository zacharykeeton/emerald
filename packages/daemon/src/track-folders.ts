import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from './log.ts';
import { writeFileAtomic } from './store-file.ts';

// The folders of the tracks in the generations slimmed before M9 fix 1186
// (M9 fix 1187). Those generations keep no folder on a hosted line, and
// the session store keeps only its newest 500 removed records, so a track
// whose record was pruned could be placed under no folder and the
// Statistics tab's figures shrank as a project aged. Written once, at the
// first start of a daemon with this fix, from every record sessions.json
// still holds and the first project Claude Code's prompt history names for
// each conversation; never rewritten, since every generation slimmed after
// fix 1186 keeps each track's first folder per file. Holds folders alone:
// no prompt text, no names, no other record field.
export const TRACK_FOLDERS_NAME = 'track-folders.json';

export interface TrackFolders {
  // An emerald session id to its record's folders.
  sessions: Record<string, { cwd: string; groupCwd: string }>;
  // A Claude session id to the first project the history names for it.
  conversations: Record<string, string>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const missing = (err: unknown): boolean => (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';

// Reads a whole file, answering null for a missing one; any other failure throws.
function readIfThere(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (missing(err)) return null;
    throw err;
  }
}

// Every record with a string id and cwd, removed ones included; groupCwd
// the record's own or else its cwd (the store's rule for files from before
// fix 60). Read directly, not through SessionStore.load, which would set a
// bad file aside. Throws on a file that does not parse.
function recordFolders(text: string): TrackFolders['sessions'] {
  const out: TrackFolders['sessions'] = {};
  const parsed: unknown = JSON.parse(text);
  const list = isRecord(parsed) ? parsed['sessions'] : undefined;
  if (!Array.isArray(list)) throw new Error('sessions.json holds no sessions list');
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const { id, cwd } = entry;
    if (typeof id !== 'string' || id === '' || typeof cwd !== 'string' || cwd === '') continue;
    const group = entry['groupCwd'];
    out[id] = { cwd, groupCwd: typeof group === 'string' && group !== '' ? group : cwd };
  }
  return out;
}

// The first project per sessionId; a torn line or one lacking either is skipped.
function historyFolders(text: string): TrackFolders['conversations'] {
  const out: TrackFolders['conversations'] = {};
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const { sessionId, project } = parsed;
    if (typeof sessionId !== 'string' || sessionId === '' || typeof project !== 'string' || project === '') continue;
    if (!(sessionId in out)) out[sessionId] = project;
  }
  return out;
}

export function writeTrackFoldersOnce(logs: string, sessionsFile: string, historyFile: string, log: Logger): void {
  const file = path.join(logs, TRACK_FOLDERS_NAME);
  if (fs.existsSync(file)) return;
  const started = Date.now();
  let sessions: TrackFolders['sessions'];
  try {
    const text = readIfThere(sessionsFile);
    sessions = text === null ? {} : recordFolders(text);
  } catch (err) {
    log.warn('track folders not written: sessions.json could not be read', err);
    return;
  }
  let conversations: TrackFolders['conversations'];
  try {
    const text = readIfThere(historyFile);
    conversations = text === null ? {} : historyFolders(text);
  } catch (err) {
    log.warn('track folders not written: history.jsonl could not be read', err);
    return;
  }
  try {
    writeFileAtomic(file, JSON.stringify({ version: 1, writtenAt: Date.now(), sessions, conversations }), log);
  } catch (err) {
    log.warn('track folders not written', err);
    return;
  }
  log.info('track folders written', { sessions: Object.keys(sessions).length, conversations: Object.keys(conversations).length, ms: Date.now() - started });
}

// Null with no line logged when the file is absent; null with one warning
// when it is there but unreadable, so the fold places what it can without it.
export function readTrackFolders(logs: string, log: Logger): TrackFolders | null {
  const bad = (err?: unknown): null => {
    log.warn('track-folders.json could not be read; a track with no record and no folder on its lines stays unplaced', err);
    return null;
  };
  let text: string | null;
  try {
    text = readIfThere(path.join(logs, TRACK_FOLDERS_NAME));
  } catch (err) {
    return bad(err);
  }
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return bad(err);
  }
  if (!isRecord(parsed) || parsed['version'] !== 1 || !isRecord(parsed['sessions']) || !isRecord(parsed['conversations'])) return bad();
  const sessions: TrackFolders['sessions'] = {};
  for (const [id, v] of Object.entries(parsed['sessions'])) {
    if (isRecord(v) && typeof v['cwd'] === 'string' && typeof v['groupCwd'] === 'string') sessions[id] = { cwd: v['cwd'], groupCwd: v['groupCwd'] };
  }
  const conversations: TrackFolders['conversations'] = {};
  for (const [id, v] of Object.entries(parsed['conversations'])) {
    if (typeof v === 'string') conversations[id] = v;
  }
  return { sessions, conversations };
}
