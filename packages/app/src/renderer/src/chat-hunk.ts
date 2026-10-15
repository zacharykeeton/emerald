import type { StepTurn } from '@emerald/shared';

// M9 fix 717: the edit card on the chat view's ask, with no DOM so
// node:test can cover it. When a permission is asked with an Edit the
// last thing the transcript wrote (claim 1 of chat-claims-688.md: the
// tool_use line lands before the prompt shows), the card draws the
// change as a hunk off the Edit's own strings.

export interface PendingEdit {
  path: string;
  oldString: string;
  newString: string;
}

// The last step of the last turn, when it is an Edit with no result and
// its three strings; a MultiEdit, a Write or a NotebookEdit keeps the
// command card.
export function pendingEdit(turns: StepTurn[]): PendingEdit | null {
  const turn = turns[turns.length - 1];
  const step = turn?.steps[turn.steps.length - 1];
  if (step === undefined || step.kind !== 'tool' || step.name !== 'Edit' || step.result !== null) return null;
  const { file_path: path, old_string: oldString, new_string: newString } = step.input;
  if (typeof path !== 'string' || typeof oldString !== 'string' || typeof newString !== 'string') return null;
  return { path, oldString, newString };
}

// The 1-based line the old string starts on in the file's text, CRLF read
// as LF; null when it is empty or not there.
export function lineOf(text: string, oldString: string): number | null {
  if (oldString === '') return null;
  const at = text.replace(/\r\n/g, '\n').indexOf(oldString.replace(/\r\n/g, '\n'));
  if (at < 0) return null;
  let line = 1;
  for (let i = 0; i < at; i++) if (text.replace(/\r\n/g, '\n')[i] === '\n') line += 1;
  return line;
}

export interface HunkRow {
  kind: 'context' | 'removed' | 'added' | 'more';
  text: string;
  line: number | null;
}

export const HUNK_MAX_ROWS = 40;

// The rows of the hunk: the common head as context, the old side's rest
// removed, the new side's rest added, the common tail as context (the
// split editCounts makes). Context and added rows carry the new file's
// numbers and removed rows the old file's, from start; past
// HUNK_MAX_ROWS the rest is one row saying how many.
export function editHunk(oldText: string, newText: string, start: number | null): HunkRow[] {
  const a = oldText === '' ? [] : oldText.split('\n');
  const b = newText === '' ? [] : newText.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  let o = start ?? 0;
  let n = start ?? 0;
  const num = (x: number) => (start === null ? null : x);
  const rows: HunkRow[] = [];
  for (const text of a.slice(0, head)) {
    rows.push({ kind: 'context', text, line: num(n) });
    o += 1;
    n += 1;
  }
  for (const text of a.slice(head, a.length - tail)) rows.push({ kind: 'removed', text, line: num(o++) });
  for (const text of b.slice(head, b.length - tail)) rows.push({ kind: 'added', text, line: num(n++) });
  for (const text of b.slice(b.length - tail)) rows.push({ kind: 'context', text, line: num(n++) });
  if (rows.length <= HUNK_MAX_ROWS) return rows;
  const more = rows.length - HUNK_MAX_ROWS;
  return [...rows.slice(0, HUNK_MAX_ROWS), { kind: 'more', text: `… ${more} more lines`, line: null }];
}
