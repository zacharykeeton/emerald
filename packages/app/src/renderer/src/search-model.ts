// The pure part of the contents search (M25): which lines of a file hold
// the needle, and what a hit shows of the line. The walk over the folder
// and the reads are in the main process (main/files.ts), which imports
// this as it imports git-status-model.ts, so node:test covers the match
// without a disk.

export interface LineHit {
  // 1-based, as an editor counts.
  line: number;
  // The line trimmed and cut to HIT_TEXT_MAX around the first match, so
  // a minified file cannot hand the rail a line a megabyte wide and a
  // paragraph still shows why it is a hit (fix 33). A cut end carries an
  // ellipsis.
  text: string;
  // Where the first match starts in `text` and how long it is (the
  // needle's length), so the rail can mark it without knowing which
  // needle a result that arrived late was for.
  at: number;
  len: number;
  // The 1-based column of that match in the file's own line, for the
  // editor's cursor.
  col: number;
}

export const HIT_TEXT_MAX = 200;

// Case-insensitive substring per line. An empty needle matches nothing:
// the rail never asks with one, and every line of every file is not an
// answer. `max` stops the scan of one file once the search's own cap is
// reached, so a log file with the word on every line costs no more than
// the cap.
export function matchLines(text: string, needle: string, max = Infinity): LineHit[] {
  const lower = needle.toLowerCase();
  if (lower === '') return [];
  const hits: LineHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && hits.length < max; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const idx = trimmed.toLowerCase().indexOf(lower);
    if (idx < 0) continue;
    const lead = line.length - line.trimStart().length;
    hits.push({ line: i + 1, ...window(trimmed, idx, lower.length), len: lower.length, col: lead + idx + 1 });
  }
  return hits;
}

// A line that fits is shown whole. A longer one is shown as HIT_TEXT_MAX
// characters with the match in the middle, pulled back to the line's end
// when the match is near it, with an ellipsis standing in for each cut
// end and counted in the budget.
function window(line: string, idx: number, len: number): { text: string; at: number } {
  if (line.length <= HIT_TEXT_MAX) return { text: line, at: idx };
  let start = Math.max(0, idx - Math.floor((HIT_TEXT_MAX - len) / 2));
  const end = Math.min(line.length, start + HIT_TEXT_MAX);
  start = Math.max(0, end - HIT_TEXT_MAX);
  const head = start > 0;
  const tail = end < line.length;
  const body = line.slice(start + (head ? 1 : 0), end - (tail ? 1 : 0));
  return { text: `${head ? '…' : ''}${body}${tail ? '…' : ''}`, at: idx - start };
}
