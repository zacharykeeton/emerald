// Claude Code's folder trust dialog, read off a starting session's screen
// (M9 fix 808). Claude Code 2.1.302 draws it with the shared confirm
// component: no digits on its options, `No, exit` listed first and holding
// the pointer when it opens, so an answer is arrow keys to the wanted row
// and Enter. No hook of the session fires before it is answered, so the
// screen is the only word the daemon has that it is up.

export interface TrustDialog {
  lines: string[];
  options: { label: string; pick: 'yes' | 'no'; pointer: boolean }[];
  // The dialog drew a folder path under its Accessing workspace heading, left out of lines; the cards draw the session's own folder in its place, after lines[0] (M9 fix 847).
  pathDropped: boolean;
}

const YES = 'Yes, I trust this folder';
const NO = ['No, exit', 'No, continue without these permissions'];

// A row without the frame's glyphs around it.
function unframed(row: string): string {
  return row.replace(/^[│╭╮╰╯─\s]+/, '').replace(/[│╭╮╰╯─\s]+$/, '');
}

// The option's words, the pointer taken off.
function optionText(row: string): string {
  return unframed(row).replace(/^❯\s*/, '');
}

export function trustDialog(rows: readonly string[]): TrustDialog | null {
  let yes = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (optionText(rows[i]!) === YES) {
      yes = i;
      break;
    }
  }
  if (yes < 0) return null;
  let no = -1;
  for (let i = Math.max(0, yes - 3); i <= Math.min(rows.length - 1, yes + 3); i++) {
    if (i !== yes && NO.includes(optionText(rows[i]!))) {
      no = i;
      break;
    }
  }
  if (no < 0) return null;
  const order = no < yes ? [no, yes] : [yes, no];
  const options = order.map((i) => {
    const label = optionText(rows[i]!);
    return { label, pick: (i === yes ? 'yes' : 'no') as 'yes' | 'no', pointer: unframed(rows[i]!).startsWith('❯') };
  });
  const first = order[0]!;
  let start = -1;
  for (let i = first - 1; i >= 0; i--) {
    if (rows[i]!.includes('Accessing workspace')) {
      start = i;
      break;
    }
  }
  const heading = start;
  if (start < 0) {
    // No heading: the rows above the options up to the frame's top or a
    // rule, whichever comes first.
    start = first;
    for (let i = first - 1; i >= 0; i--) {
      const row = rows[i]!;
      if (/^\s*[╭─]/.test(row) && unframed(row) === '') break;
      start = i;
    }
  }
  const lines: string[] = [];
  // Under the heading, the first run of rows after its blanks is the
  // folder's path, one row or several where the TUI wrapped a long one;
  // the cards draw the session's own folder there instead (M9 fix 847).
  let path: 'before' | 'in' | 'past' = heading < 0 ? 'past' : 'before';
  let pathDropped = false;
  for (let i = start; i < first; i++) {
    const text = unframed(rows[i]!);
    if (i > heading && path !== 'past') {
      if (text !== '') {
        path = 'in';
        pathDropped = true;
        continue;
      }
      if (path === 'in') path = 'past';
    }
    if (text === '' && (lines.length === 0 || lines[lines.length - 1] === '')) continue;
    lines.push(text);
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return { lines, options, pathDropped };
}

// M9 fix 881: the dialog's text as paragraphs, each run of rows the TUI
// wrapped at its own width joined back into one line, so a card rewraps it
// at its own. A word the TUI broke inside, longer than the row, would read
// with a space in it.
export function trustParagraphs(lines: readonly string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length === 0) return;
    if (out.length > 0) out.push('');
    out.push(run.join(' '));
    run = [];
  };
  for (const line of lines) {
    if (line === '') close();
    else run.push(line);
  }
  close();
  return out;
}

// M9 fix 976: Claude Code's confirmation before a switch of effort level or model that would re-read a cached conversation, read off a resting session's screen; no hook fires while it is up.
export interface SwitchDialog {
  title: 'Change effort level?' | 'Switch model?';
  options: { label: string; pick: 'yes' | 'no'; key: string | null; pointer: boolean }[];
}

const SWITCH_TITLES = ['Change effort level?', 'Switch model?'] as const;
const SWITCH_NO = 'No, go back';
const SWITCH_YES = 'Yes, switch to ';

// A row as a switch option: its words, the digit it is answered by (null
// on the shape drawn without digits) and whether it holds the pointer
// (`❯`, or `>` as the verify stubs draw it).
function switchOption(row: string): { text: string; key: string | null; pointer: boolean } {
  let text = unframed(row);
  const pointer = /^[❯>]/.test(text);
  if (pointer) text = text.slice(1).trimStart();
  const digit = /^(\d)\.\s+/.exec(text);
  if (digit !== null) text = text.slice(digit[0].length);
  return { text, key: digit === null ? null : digit[1]!, pointer };
}

export function switchDialog(rows: readonly string[]): SwitchDialog | null {
  let no = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (switchOption(rows[i]!).text === SWITCH_NO) {
      no = i;
      break;
    }
  }
  if (no < 0) return null;
  let yes = -1;
  for (let i = Math.max(0, no - 3); i <= Math.min(rows.length - 1, no + 3); i++) {
    if (i !== no && switchOption(rows[i]!).text.startsWith(SWITCH_YES)) {
      yes = i;
      break;
    }
  }
  if (yes < 0) return null;
  const top = Math.min(yes, no);
  const bottom = Math.max(yes, no);
  let title: SwitchDialog['title'] | null = null;
  for (let i = top - 1; i >= Math.max(0, top - 12); i--) {
    const text = unframed(rows[i]!);
    const found = SWITCH_TITLES.find((t) => t === text);
    if (found !== undefined) {
      title = found;
      break;
    }
  }
  if (title === null) return null;
  // The dialog takes the prompt box's place, so a prompt box under the
  // options is a reply quoting them, not the dialog.
  for (let i = bottom + 1; i < rows.length; i++) {
    if (/^[❯>](\s|$)/.test(unframed(rows[i]!))) return null;
  }
  const options = [top, bottom].map((i) => {
    const o = switchOption(rows[i]!);
    return { label: o.text, pick: (i === yes ? 'yes' : 'no') as 'yes' | 'no', key: o.key, pointer: o.pointer };
  });
  return { title, options };
}

// The keys that move the pointer to the picked option and confirm it; null
// when no option holds the pointer, since then a key could land anywhere.
// The switch dialog (M9 fix 976) is answered the same way.
export function trustKeys(dialog: { options: readonly { pick: 'yes' | 'no'; pointer: boolean }[] }, pick: 'yes' | 'no'): string | null {
  const from = dialog.options.findIndex((o) => o.pointer);
  const to = dialog.options.findIndex((o) => o.pick === pick);
  if (from < 0 || to < 0) return null;
  const step = to > from ? '\x1b[B' : '\x1b[A';
  return step.repeat(Math.abs(to - from)) + '\r';
}
