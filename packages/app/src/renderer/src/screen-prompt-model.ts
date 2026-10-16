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

// M9 fix 777: rows looked up or down from a dialog's option 1.
const DIALOG_REACH = 30;

// A rule row: blank once the frame is stripped and holding a horizontal
// line (a `────` row, a frame's `╭──╮`), so a framed row with nothing
// inside (`│   │`) is the dialog's spacing and not its top.
function isRule(row: string): boolean {
  return bare(row) === '' && /[─━═╌╍┄┅┈┉]/.test(row);
}

// A dashed rule (`╌╌╌`) is a divider inside a dialog, around the command
// or the diff it asks about, never its top.
function isDivider(row: string): boolean {
  return /^[╌╍┄┅┈┉]+$/.test(row.trim());
}

// The index of the last row whose bare text is a numbered option 1.
function optionOne(rows: readonly string[]): number {
  for (let i = rows.length - 1; i >= 0; i--) if (NUMBERED.exec(bare(rows[i]!))?.[1] === '1') return i;
  return -1;
}

// What a dialog shows above its buttons. With an option 1 on the screen
// (the last one, as answerOptions keeps the later list) the excerpt
// anchors on the dialog and never on the cursor, which Claude Code parks
// on the footer or on a stale row above (M9 fix 777): the top is the
// nearest rule above option 1 that is not a dashed divider, else the
// first row of the run holding option 1; the bottom is the last option of
// the run of keys counting up from 1, so the footer and the frame's
// bottom are left out, the buttons standing for them. Past MAX_ROWS the
// first three rows, a `…` and the last ten are kept, so the title and the
// question survive a tall diff. With no option 1 (a question asked in
// the input box) it is the rows from the last blank row above the cursor
// to the cursor row, as before. Either way the frame is stripped, rows
// blank as they stand are dropped and so are blanks at either end; a
// framed row with nothing inside is the dialog's own spacing and stays.
export function promptExcerpt(rows: readonly string[], cursor: { x: number; y: number }): string[] {
  const one = optionOne(rows);
  if (one >= 0) {
    let start = -1;
    for (let i = one - 1; i >= 0 && one - i <= DIALOG_REACH; i--) {
      if (isRule(rows[i]!) && !isDivider(rows[i]!)) {
        start = i;
        break;
      }
    }
    if (start < 0) {
      start = one;
      while (start > 0 && (rows[start - 1] ?? '').trim() !== '') start -= 1;
    }
    let end = one;
    let next = 2;
    for (let i = one + 1; i < rows.length && i - one <= DIALOG_REACH; i++) {
      if (NUMBERED.exec(bare(rows[i]!))?.[1] === String(next)) {
        end = i;
        next += 1;
      }
    }
    const out = rows.slice(start, end + 1).filter((row) => row.trim() !== '').map(bare);
    while (out.length > 0 && out[0] === '') out.shift();
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.length > MAX_ROWS ? [...out.slice(0, 3), '…', ...out.slice(-10)] : out;
  }
  const end = Math.min(cursor.y, rows.length - 1);
  if (end < 0) return [];
  let start = end;
  while (start > 0 && end - start < MAX_ROWS - 1 && (rows[start - 1] ?? '').trim() !== '') start -= 1;
  const out = rows.slice(start, end + 1).map(bare);
  while (out.length > 0 && out[0] === '') out.shift();
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

// Claude Code's stock placeholders, read off 2.1.301's `dge`: the example
// before a fresh session's first prompt, the queue hints and the teammate
// line. They are drawn dim through the same renderer as a suggested
// prompt, so the daemon's ghost cannot tell them apart and the text does
// (M9 fix 779). A suggestion that happens to read `Try "..."` is lost.
const STOCK_PLACEHOLDERS = [/^Try ".*"$/, /^Press up to /, /^Press Enter to edit /, /^Message @/];

// The suggested prompt Claude Code shows ghosted in its empty input (M9
// fix 779), off the pty.screen reply's ghost field: null when the field
// is absent (an older daemon) or null, when it is not on the last ❯ row,
// when anything is typed before it (an inline completion) and when it is
// a stock placeholder.
export function ghostSuggestion(screen: { rows: readonly string[]; ghost?: { y: number; x: number; text: string } | null }): string | null {
  const ghost = screen.ghost;
  if (ghost === undefined || ghost === null) return null;
  // The last row starting with ❯, as chat-model's promptRow finds it.
  let last = -1;
  for (let y = screen.rows.length - 1; y >= 0 && last === -1; y--) {
    if ((screen.rows[y] ?? '').trimStart().startsWith('❯')) last = y;
  }
  if (ghost.y !== last) return null;
  if ((screen.rows[last] ?? '').slice(0, ghost.x).trim() !== '❯') return null;
  if (STOCK_PLACEHOLDERS.some((re) => re.test(ghost.text))) return null;
  return ghost.text;
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

// M9 fix 777: an AskUserQuestion as Claude Code 2.1.301 draws it, read
// off the plain rows: a tab row (`←  ☒ Colour  ☐ Size  ✔ Submit  →`, a
// lone ` ☐ Colour` for one question), the question, the options each
// with its description row under it, `Type something.`, a divider,
// `Chat about this`, and the footer.
export interface AskTab {
  name: string;
  state: 'answered' | 'open' | 'submit';
  current: boolean;
}
export interface AskOption extends AnswerOption {
  description: string;
  // The option the TUI's ❯ is on.
  pointer: boolean;
}
export interface AskQuestion {
  tabs: AskTab[];
  question: string;
  options: AskOption[];
}

// Fifteen other dialogs use an `Enter to select` chord, so the footer
// alone does not make a question; a tab row or a `Type something.` row
// must be there too.
const ASK_FOOTER = /(?:^|· )Enter to select · (?:\S+ to navigate|Tab\/Arrow keys to navigate)/;
const TAB_MARK = /☒|☐|\[×\]|\[ \]/;
const TAB_SPLIT = /(☒|☐|\[×\]|\[ \]|✓|✔)/;

function askTabs(row: string): AskTab[] {
  const text = row.replace(/[←→]/g, ' ').trim();
  const parts = text.split(TAB_SPLIT);
  const tabs: AskTab[] = [];
  let submit = false;
  for (let i = 1; i < parts.length; i += 2) {
    const mark = parts[i]!;
    const name = (parts[i + 1] ?? '').trim();
    if (mark === '✓' || mark === '✔') {
      if (name.startsWith('Submit')) submit = true;
      continue;
    }
    const answered = mark === '☒' || mark === '[×]';
    tabs.push({ name: name.replace(/^answered /, ''), state: answered ? 'answered' : 'open', current: false });
  }
  if (tabs.length < 2) return [];
  if (submit || text.endsWith('Submit')) tabs.push({ name: 'Submit', state: 'submit', current: false });
  // The terminal marks the current tab by colour alone, which the plain
  // rows lose, so it is inferred: the first open tab, else Submit. An
  // answer moves the dialog on to the next tab (read on 2.1.301), which
  // is what makes the first open one the current one.
  const current = tabs.find((t) => t.state === 'open') ?? tabs.find((t) => t.state === 'submit');
  if (current !== undefined) current.current = true;
  return tabs;
}

export function askQuestion(rows: readonly string[]): AskQuestion | null {
  const b = rows.map(bare);
  let footer = -1;
  for (let i = b.length - 1; i >= 0; i--) {
    if (ASK_FOOTER.test(b[i]!)) {
      footer = i;
      break;
    }
  }
  if (footer < 0) return null;
  let one = -1;
  for (let i = footer - 1; i >= 0; i--) {
    if (NUMBERED.exec(b[i]!)?.[1] === '1') {
      one = i;
      break;
    }
  }
  if (one < 0) return null;
  // The options, each with the rows under it up to a blank (or a rule,
  // blank once bare) as its description; a row after a blank that is not
  // numbered (the preview layout's unnumbered `Chat about this`) belongs
  // to no option.
  const options: AskOption[] = [];
  let open: AskOption | null = null;
  for (let i = one; i < footer; i++) {
    const m = NUMBERED.exec(b[i]!);
    if (m !== null) {
      open = { key: m[1] ?? '', label: m[2] ?? '', description: '', pointer: /^[❯>]/.test(b[i]!) };
      options.push(open);
    } else if (b[i] === '') {
      open = null;
    } else if (open !== null) {
      open.description = open.description === '' ? b[i]! : `${open.description} ${b[i]}`;
    }
  }
  let tabRow = -1;
  for (let i = one - 1; i >= 0 && one - i <= DIALOG_REACH; i--) {
    if (isRule(rows[i]!)) break;
    if (TAB_MARK.test(b[i]!)) {
      tabRow = i;
      break;
    }
  }
  // The question: the nearest run of rows above option 1, the blanks
  // right above it skipped; a question of two paragraphs keeps its last.
  let i = one - 1;
  while (i >= 0 && i !== tabRow && b[i] === '' && !isRule(rows[i]!)) i -= 1;
  const run: string[] = [];
  while (i >= 0 && i !== tabRow && b[i] !== '') {
    run.unshift(b[i]!);
    i -= 1;
  }
  if (tabRow < 0 && !options.some((o) => o.label.startsWith('Type something'))) return null;
  return { tabs: tabRow < 0 ? [] : askTabs(b[tabRow]!), question: run.join(' '), options };
}

export function isQuestionDialog(rows: readonly string[]): boolean {
  return askQuestion(rows) !== null;
}
