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
// The suggestion is read off the row from the ghost's start, since Claude Code's row can break the dim run at a space (M9 fix 809), and the Try entry matches its opening quote alone, so a placeholder wrapped onto the next row is caught too.
const STOCK_PLACEHOLDERS = [/^Try "/, /^Press up to /, /^Press Enter to edit /, /^Message @/];

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
  const rest = (screen.rows[last] ?? '').slice(ghost.x).trimEnd();
  if (rest === '') return null;
  if (STOCK_PLACEHOLDERS.some((re) => re.test(rest))) return null;
  return rest;
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
// `Chat about this`, and the footer. Since fix 845 a multi-select (each
// label behind a [ ] or [✔] box) reads its unnumbered Submit row, Next on
// all but the last tab, as the dialog's button, never as a description.
// Since fix 879 the Review your answers tab a multi-question or
// multi-select ask ends on, which draws no footer, is read by askReview:
// the tabs, each question with its answer, and Submit answers and Cancel.
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
  // M9 fix 845: a multi-select, its labels behind tick boxes.
  multi: boolean;
  // Its button row under the last list option, Submit or Next, and whether
  // the TUI's pointer is on it; null on a single-select.
  submit: { label: string; pointer: boolean } | null;
}

// Fifteen other dialogs use an `Enter to select` chord, so the footer
// alone does not make a question; a tab row or a `Type something.` row
// must be there too.
const ASK_FOOTER = /(?:^|· )Enter to select · (?:\S+ to navigate|Tab\/Arrow keys to navigate)/;
const TAB_MARK = /☒|☐|\[×\]|\[ \]/;
const TAB_SPLIT = /(☒|☐|\[×\]|\[ \]|✓|✔)/;
// M9 fix 845: a multi-select option's box, and its button row. The capture
// of 2.1.302 (2026-10-18) drew a tick as [✔]; [✓] and [×] are kept for the
// other glyphs the TUI has used.
const TICK_BOX = /^(?:\[[ ✓✔×]\]|[☐☒])\s*/;
const SUBMIT_ROW = /^(?:[❯>]\s*)?(Submit|Next)$/;

function unboxed(label: string): string {
  return label.replace(TICK_BOX, '');
}

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
  // is what makes the first open one the current one. A card that moved
  // the dialog itself knows better (fix 922, visitedTabs).
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
  let submit: { label: string; pointer: boolean } | null = null;
  for (let i = one; i < footer; i++) {
    const m = NUMBERED.exec(b[i]!);
    const button = open !== null && TICK_BOX.test(open.label) ? SUBMIT_ROW.exec(b[i]!) : null;
    if (m !== null) {
      open = { key: m[1] ?? '', label: m[2] ?? '', description: '', pointer: /^[❯>]/.test(b[i]!) };
      options.push(open);
    } else if (button !== null) {
      // A multi-select draws its button right under the last list option,
      // with no blank between (fix 845).
      submit = { label: button[1]!, pointer: /^[❯>]/.test(b[i]!) };
      open = null;
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
  if (tabRow < 0 && !options.some((o) => unboxed(o.label).startsWith('Type something'))) return null;
  const multi = options.some((o) => TICK_BOX.test(o.label));
  return { tabs: tabRow < 0 ? [] : askTabs(b[tabRow]!), question: run.join(' '), options, multi, submit: multi ? submit : null };
}

// M9 fix 879: the Review your answers tab, read off the bare rows: the tab
// row, `Review your answers`, a warning when a question is unanswered,
// each answered question (`● ...`) with its answer (`→ ...`) under it,
// `Ready to submit your answers?` and the options Submit answers and
// Cancel. It draws no footer, so askQuestion reads none of it.
export interface AskReview {
  tabs: AskTab[];
  warning: string | null;
  items: { question: string; answer: string }[];
  options: AskOption[];
}

export function askReview(rows: readonly string[]): AskReview | null {
  const b = rows.map(bare);
  const one = optionOne(rows);
  if (one < 0 || NUMBERED.exec(b[one]!)?.[2] !== 'Submit answers') return null;
  let title = -1;
  for (let i = one - 1; i >= 0 && one - i <= DIALOG_REACH; i--) {
    if (isRule(rows[i]!)) break;
    if (b[i] === 'Review your answers') {
      title = i;
      break;
    }
  }
  if (title < 0) return null;
  let tabRow = -1;
  for (let i = title - 1; i >= 0 && one - i <= DIALOG_REACH; i--) {
    if (isRule(rows[i]!)) break;
    if (TAB_MARK.test(b[i]!)) {
      tabRow = i;
      break;
    }
  }
  if (tabRow < 0) return null;
  const options: AskOption[] = [];
  for (let i = one, next = 1; i < b.length; i++, next++) {
    const m = NUMBERED.exec(b[i]!);
    if (m === null || m[1] !== String(next)) break;
    options.push({ key: m[1], label: m[2] ?? '', description: '', pointer: /^[❯>]/.test(b[i]!) });
  }
  let warning: string | null = null;
  const items: { question: string; answer: string }[] = [];
  let open: { question: string; answer: string } | null = null;
  let answered = false;
  for (let i = title + 1; i < one; i++) {
    const row = b[i]!;
    if (row.startsWith('●')) {
      open = { question: row.replace(/^●\s*/, ''), answer: '' };
      answered = false;
      items.push(open);
    } else if (open !== null && !answered && row.startsWith('→')) {
      open.answer = row.replace(/^→\s*/, '');
      answered = true;
    } else if (row === '') {
      open = null;
    } else if (open !== null) {
      // A wrapped row, joined back onto what it continues.
      if (answered) open.answer = `${open.answer} ${row}`;
      else open.question = `${open.question} ${row}`;
    } else if (items.length === 0 && warning === null) {
      const text = row.replace(/^[^A-Za-z]+/, '');
      if (text.startsWith('You have not answered')) warning = text;
    }
  }
  // The review is the Submit tab, whatever askTabs infers from an open one.
  const tabs = askTabs(b[tabRow]!).map((t) => ({ ...t, current: t.state === 'submit' }));
  return { tabs, warning, items, options };
}

export function isQuestionDialog(rows: readonly string[]): boolean {
  return askQuestion(rows) !== null || askReview(rows) !== null;
}

// M9 fix 803: the Type something row, a text field in Claude Code 2.1.302
// once its digit puts the pointer there (the digit itself is not typed;
// a second one is). Typed into, the row's label is the field's text, so
// it is found as the option before Chat about this when the placeholder
// is gone.
export function freeOption(ask: AskQuestion): AskOption | null {
  const typeSomething = ask.options.find((o) => unboxed(o.label).startsWith('Type something'));
  if (typeSomething !== undefined) return typeSomething;
  const chat = ask.options.find((o) => o.label === 'Chat about this');
  if (chat === undefined) return null;
  return ask.options.find((o) => o.key === String(Number(chat.key) - 1)) ?? null;
}

// The field's text as the screen draws it: nothing under the placeholder,
// else the label, with the rows a long text wraps onto (read as the
// option's description) joined back on.
export function freeText(o: AskOption): string {
  const label = unboxed(o.label);
  if (label.startsWith('Type something')) return '';
  return o.description === '' ? label : `${label} ${o.description}`;
}

// The keys a free answer takes: the row's digit when the pointer is not on
// it (with the pointer there a digit would be typed into the field), then
// one DEL per character the field holds and the text. In a multi-select a
// digit toggles its option and moves no pointer, so the move is arrows: Up
// from the Submit row, Downs from a list option above (fix 845).
export function freeAnswerKeys(ask: AskQuestion, text: string): { move: string | null; text: string } {
  const o = freeOption(ask);
  if (o === null) return { move: null, text };
  const typed = '\x7f'.repeat([...freeText(o)].length) + text;
  if (o.pointer) return { move: null, text: typed };
  if (ask.multi) {
    if (ask.submit?.pointer === true) return { move: '\x1b[A', text: typed };
    const free = ask.options.indexOf(o);
    const at = ask.options.findIndex((x) => x.pointer);
    if (at >= 0 && at < free) return { move: '\x1b[B'.repeat(free - at), text: typed };
  }
  return { move: o.key, text: typed };
}

// M9 fix 845: how many Downs take a multi-select's pointer to its Submit
// (or Next) row. The list options are those above Chat about this, the
// last of them the free row, and Down on that row reaches the button.
// Null on a single-select, with no button, or with no pointer to count from.
export function submitMoves(ask: AskQuestion): number | null {
  if (!ask.multi || ask.submit === null) return null;
  if (ask.submit.pointer) return 0;
  const chat = ask.options.findIndex((o) => o.label === 'Chat about this');
  const list = chat < 0 ? ask.options : ask.options.slice(0, chat);
  const p = list.findIndex((o) => o.pointer);
  return p < 0 ? null : list.length - p;
}

// M9 fix 845: the keys an option's press sends. In a multi-select with the
// pointer on the free row a digit is typed into the field (the capture's
// free-m1), so the pointer leaves it first.
export function optionKeys(ask: AskQuestion | null, key: string): string {
  if (ask?.multi === true && freeOption(ask)?.pointer === true) return '\x1b[A' + key;
  return key;
}

// How long the pointer has to reach the Type something row after its digit.
export const FREE_MOVE_WAIT_MS = 2000;

// M9 fix 801: which dialog the rows draw, so a card can tell a press that
// was taken (another dialog, or none) from one still waiting. The pointer
// is left out, so an arrow key leaves the dialog the same one. Null when
// no dialog is drawn.
export function dialogKey(rows: readonly string[], cursor: { x: number; y: number }): string | null {
  const ask = askQuestion(rows);
  if (ask !== null) {
    return JSON.stringify([
      'ask',
      ask.question,
      ask.tabs.map((t) => `${t.name}:${t.state}`),
      ask.options.map((o) => o.label),
    ]);
  }
  const options = answerOptions(rows);
  if (options.length > 0) {
    return JSON.stringify([
      'options',
      promptExcerpt(rows, cursor),
      options.map((o) => o.label),
    ]);
  }
  return null;
}

// A press the terminal did not take: the same dialog still drawn this long after it, the card takes a press again.
export const ASK_PRESS_RETRY_MS = 3000;

export interface AskPress {
  at: number;
  key: string | null;
}

// Whether a read ends a card's press: only a read sent after the press
// counts; another dialog ends it (the next tab of a multi-question ask),
// and so does the same dialog still drawn ASK_PRESS_RETRY_MS on (the
// press was not taken); no dialog drawn does not, since the answer was
// taken and the row has not moved yet.
export function pressOver(press: AskPress, read: { rows: readonly string[]; cursor: { x: number; y: number }; sentAt: number }): boolean {
  if (read.sentAt <= press.at) return false;
  const k = dialogKey(read.rows, read.cursor);
  if (k === null) return false;
  if (k !== press.key) return true;
  return read.sentAt - press.at >= ASK_PRESS_RETRY_MS;
}

// M9 fix 922: a tab of an AskUserQuestion is a button to its question.
// Claude Code moves between the tabs on Left and Right (its tabs:previous
// and tabs:next, one tab per key, inactive while the Type something field
// has the pointer; read in the 2.1.304 bundle), so a press sends one
// arrow per tab between the current one and the tab pressed.
export function tabMoves(from: number, to: number): string {
  if (from < 0 || to < 0 || from === to) return '';
  return (to < from ? '\x1b[D' : '\x1b[C').repeat(Math.abs(to - from));
}

// M9 fix 959: the keys Claude Code's AskUserQuestion dialog walks its tabs
// by (its Tabs bindings, read on 2.1.305): Left and Shift+Tab one back,
// Right and Tab one on; 0 for any other key.
export function tabKeyStep(key: string, shift: boolean): -1 | 0 | 1 {
  if (key === 'ArrowLeft' || (key === 'Tab' && shift)) return -1;
  if (key === 'ArrowRight' || key === 'Tab') return 1;
  return 0;
}

// The tab a step lands on from the current one, clamped at the ends as the
// dialog is (on from the last question is Submit, the review); null with no
// current tab.
export function tabStepTo(tabs: readonly AskTab[], step: -1 | 1): number | null {
  const cur = tabs.findIndex((t) => t.current);
  if (cur < 0) return null;
  return Math.min(tabs.length - 1, Math.max(0, cur + step));
}

// The tab a card moved the dialog to. The rows mark the current tab by
// colour alone, so askTabs infers it as the first open one, which is wrong
// once the dialog is back on an answered question; the card keeps the tab
// it moved to as the current one while the dialog draws the question it
// landed on. `from` is the question drawn when the moves were pressed
// (null from the review), `question` the one drawn once they landed (null
// until a read draws another).
export interface AskVisit {
  index: number;
  from: string | null;
  question: string | null;
}

// What a read does to a visit: one in flight is kept while its press is,
// lands on the first read that draws another question, and goes when its
// press ends with the dialog unmoved; one landed is kept while its
// question is drawn (the pointer and a multi-select's ticks change the
// dialog, not its question) or no dialog is (a read between redraws), and
// goes on any other question or the review, the inference back.
export function visitAfter(visit: AskVisit, read: { question: string | null; dialog: boolean; pressing: boolean }): AskVisit | null {
  if (visit.question === null) {
    if (read.question === null || read.question === visit.from) return read.pressing ? visit : null;
    return { ...visit, question: read.question };
  }
  if (!read.dialog) return visit;
  return read.question === visit.question ? visit : null;
}

// An answer on a landed visit: Claude Code moves on to the next tab (its
// set-answer adds one to the question's index, read in the 2.1.304
// bundle), not to the first open one, so the visit follows it there and
// lands again. None without a landed visit.
export function visitAnswered(visit: AskVisit | null): AskVisit | null {
  if (visit === null || visit.question === null) return null;
  return { index: visit.index + 1, from: visit.question, question: null };
}

// The tabs with a landed visit's tab current in place of the inferred one.
export function visitedTabs(tabs: readonly AskTab[], visit: AskVisit | null): AskTab[] {
  if (visit === null || visit.question === null || visit.index >= tabs.length) return [...tabs];
  return tabs.map((t, i) => ({ ...t, current: i === visit.index }));
}
