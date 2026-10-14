// Turns raw ConPTY output into something a person or a script can grep.
// This is not a terminal emulator: cursor moves and erases are dropped, not
// applied, so a redrawn TUI screen reads as the sequence of things drawn.
// For a shell session it is close to what the pane showed.

// CSI (colours, cursor moves, erases, modes), OSC (titles, hyperlinks) and
// the two-byte escapes (charset selects, keypad modes), in that order.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[ -/]*[0-9A-Za-z@\\^_`{|}~]/g;

// ConPTY writes "cursor forward n" where a real terminal would show n
// spaces, for instance between a prompt and what was typed after it.
const CURSOR_FORWARD = /\x1b\[(\d*)C/g;

export function stripAnsi(text: string): string {
  return text.replace(CURSOR_FORWARD, (_, n: string) => ' '.repeat(n === '' ? 1 : Number(n))).replace(ESCAPES, '');
}

// Lines as they would read on screen. ConPTY ends lines with CRLF, so the
// carriage return before a newline is part of the line break; a bare one in
// the middle starts the line over, the way a progress bar overwrites itself.
// Trailing blanks are the terminal padding the row to its width.
export function toLines(text: string): string[] {
  return stripAnsi(text)
    .split('\n')
    .map((line) => {
      const body = line.replace(/\r+$/, '');
      const cr = body.lastIndexOf('\r');
      const shown = cr === -1 ? body : body.slice(cr + 1);
      return applyBackspaces(shown).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd();
    });
}

// A backspace steps the cursor back one cell and what is written next
// replaces that cell. PSReadLine redraws the first keystroke of a line that
// way (ConPTY sends "e", backspace, "echo ..."), so without this a read
// shows a doubled letter.
function applyBackspaces(line: string): string {
  if (!line.includes('\b')) return line;
  const out: string[] = [];
  for (const ch of line) {
    if (ch === '\b') out.pop();
    else out.push(ch);
  }
  return out.join('');
}

// The last `count` lines that carry text, or every line when count is
// undefined. Blank lines in the middle stay because they are part of the
// output; the run of blanks at the end is the empty rest of the screen.
export function lastLines(text: string, count: number | undefined): string[] {
  const lines = toLines(text);
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') end--;
  const kept = lines.slice(0, end);
  return count === undefined ? kept : kept.slice(Math.max(0, kept.length - count));
}
