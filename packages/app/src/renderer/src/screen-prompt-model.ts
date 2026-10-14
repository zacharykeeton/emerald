// What a needs-input session is asking, read off its screen (M55): the
// answer card shows the rows around the cursor and turns the options
// Claude Code prints into buttons. The screen comes from pty.screen, a
// headless terminal fed the same bytes, so the rows are plain text with
// the escapes gone; Claude Code draws its dialogs in a box, so the box
// characters are stripped before a row is judged blank or read for an
// option.

export interface AnswerOption {
  // The key the button sends: the option's digit, or y and n.
  key: string;
  label: string;
}

// Box drawing, block and rule characters, which the dialog's frame and
// the composer's rules are made of.
const FRAME = /[─-╿▀-▟]/g;

// At most this many rows above the cursor, so a full-screen dialog does
// not fill the card.
const MAX_ROWS = 14;

function bare(row: string): string {
  return row.replace(FRAME, ' ').trim();
}

// The rows from the last blank row above the cursor to the cursor row,
// with the frame stripped and the blanks at either end dropped: the
// dialog Claude Code drew last, which is what is being asked. A blank
// row is one with nothing on it at all; a framed row with nothing
// inside is the dialog's own spacing and stays.
export function promptExcerpt(rows: readonly string[], cursor: { x: number; y: number }): string[] {
  const end = Math.min(cursor.y, rows.length - 1);
  if (end < 0) return [];
  let start = end;
  while (start > 0 && end - start < MAX_ROWS - 1 && (rows[start - 1] ?? '').trim() !== '') start -= 1;
  const out = rows.slice(start, end + 1).map(bare);
  while (out.length > 0 && out[0] === '') out.shift();
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

// The pointer is Claude Code's ❯; a plain > is taken too, since a terminal
// on a code page without the arrow shows one.
const NUMBERED = /^(?:[❯>]\s*)?(\d)\.\s+(.+?)\s*$/;
const YES_NO = /\((?:y\/n|Y\/n|y\/N)\)|\[(?:y\/n|Y\/n|y\/N)\]/;

// The answers the rows offer: Claude Code's numbered options ("❯ 1. Yes",
// "2. Yes, and don't ask again for ...", "3. No"), the number being the
// key its dialog takes; else a y/n pair when a row asks that way; else
// none, and the card offers Esc and, for a question, a box.
export function answerOptions(rows: readonly string[]): AnswerOption[] {
  const numbered: AnswerOption[] = [];
  for (const row of rows) {
    const m = NUMBERED.exec(bare(row));
    if (m === null) continue;
    const key = m[1] ?? '';
    const label = m[2] ?? '';
    // A dialog lists its options once; a second "1." is another dialog's
    // leftover higher up the screen, so the later list wins.
    if (numbered.some((o) => o.key === key)) numbered.length = 0;
    numbered.push({ key, label });
  }
  if (numbered.length > 0) return numbered;
  if (rows.some((row) => YES_NO.test(row))) {
    return [
      { key: 'y', label: 'Yes' },
      { key: 'n', label: 'No' },
    ];
  }
  return [];
}
