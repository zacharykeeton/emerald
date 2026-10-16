import { modRowLine, stepFork, stepFoldEntry, stepList } from '@emerald/shared';
import type { ModRow, StepState, StepTurn } from '@emerald/shared';

// M9 fix 769: the rows a hosted session's emerald mod kept, pushed as
// transcript.row before the transcript file has them, drawn over the
// file's turns until each row's own line lands. Kept out of ChatView.tsx
// and chat-model.ts, which most chat branches share.

// The most rows held at once; a session whose file stopped landing (a
// watch that died) draws its last rows rather than growing without end.
export const LIVE_ROWS_CAP = 200;
// A row the file has not taken by then is dropped at the next file read:
// its line is in the file under another shape, or never will be.
export const LIVE_ROW_MS = 30000;

// One pushed row, with when it reached the view.
export interface LiveRow {
  uuid: string;
  at: number;
  row: ModRow;
  cut: boolean;
  came: number;
}

// The file's turns with the live rows folded onto a copy of its state:
// a row whose uuid the file has folded is drawn from the file, and a cut
// row is never drawn. With nothing left to fold, the file's turns alone.
export function liveTurns(state: StepState, live: readonly LiveRow[]): StepTurn[] {
  const rows = live.filter((r) => !r.cut && !state.uuids.has(r.uuid));
  if (rows.length === 0) return stepList(state);
  const fork = stepFork(state);
  for (const r of rows) stepFoldEntry(fork, modRowLine(r.row, r.uuid, r.at));
  return stepList(fork);
}

// The rows still owed by the file: neither folded from it nor older than
// LIVE_ROW_MS. The same array when nothing goes, so a read that took no
// row draws nothing new.
export function dropTaken(live: readonly LiveRow[], uuids: ReadonlySet<string>, now: number): LiveRow[] {
  const kept = live.filter((r) => !uuids.has(r.uuid) && now - r.came < LIVE_ROW_MS);
  return kept.length === live.length ? (live as LiveRow[]) : kept;
}
