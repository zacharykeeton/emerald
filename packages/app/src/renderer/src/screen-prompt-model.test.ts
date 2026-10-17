import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerOptions, askQuestion, ghostSuggestion, isQuestionDialog, promptExcerpt } from './screen-prompt-model.ts';
import { ASK_PRESS_RETRY_MS, dialogKey, freeAnswerKeys, freeOption, freeText, pressOver } from './screen-prompt-model.ts';

// A permission dialog as Claude Code 2.1 draws it, the transcript above
// it, the cursor on the dialog's last row.
const PERMISSION = [
  '● I will edit the file now.',
  '',
  '╭──────────────────────────────────────────────╮',
  '│ Edit file                                    │',
  '│                                              │',
  '│ Do you want to make this edit to session.ts? │',
  '│ ❯ 1. Yes                                     │',
  '│   2. Yes, allow all edits during this session │',
  '│   3. No, and tell Claude what to do differently │',
  '╰──────────────────────────────────────────────╯',
  '',
  '',
];

test('promptExcerpt takes the rows from the last blank row above the cursor to the cursor, the frame stripped', () => {
  const out = promptExcerpt(PERMISSION, { x: 0, y: 9 });
  assert.deepEqual(out, ['Edit file', '', 'Do you want to make this edit to session.ts?', '❯ 1. Yes', '2. Yes, allow all edits during this session', '3. No, and tell Claude what to do differently']);
});

test('promptExcerpt drops trailing blank rows and caps the height', () => {
  const six = ['Edit file', '', 'Do you want to make this edit to session.ts?', '❯ 1. Yes', '2. Yes, allow all edits during this session', '3. No, and tell Claude what to do differently'];
  // M9 fix 777: the excerpt anchors on the dialog's option 1, never the cursor.
  assert.deepEqual(promptExcerpt(PERMISSION, { x: 0, y: 11 }), six, 'a cursor below the dialog still gets the dialog\'s rows');
  const tall = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  assert.equal(promptExcerpt(tall, { x: 0, y: 39 }).length, 14);
  assert.deepEqual(promptExcerpt([], { x: 0, y: 0 }), []);
});

test('answerOptions reads the numbered options with the digit as the key', () => {
  assert.deepEqual(answerOptions(PERMISSION), [
    { key: '1', label: 'Yes' },
    { key: '2', label: 'Yes, allow all edits during this session' },
    { key: '3', label: 'No, and tell Claude what to do differently' },
  ]);
});

test('answerOptions keeps the last list when an older dialog is still on screen', () => {
  const rows = ['1. Old', '2. Older', '', 'Trust this folder?', '❯ 1. Yes, proceed', '  2. No, exit'];
  assert.deepEqual(answerOptions(rows), [
    { key: '1', label: 'Yes, proceed' },
    { key: '2', label: 'No, exit' },
  ]);
});

test('answerOptions gives a y/n pair for a yes-or-no question and nothing otherwise', () => {
  assert.deepEqual(answerOptions(['> 1. Yes', '  2. No']), [{ key: '1', label: 'Yes' }, { key: '2', label: 'No' }], 'a plain > pointer');
  assert.deepEqual(answerOptions(['Overwrite the file? (y/n)']), [
    { key: 'y', label: 'Yes' },
    { key: 'n', label: 'No' },
  ]);
  assert.deepEqual(answerOptions(['What should the function be called?', '> ']), []);
});

// M9 fix 777: four screens captured from a real Claude Code 2.1.301 in a
// harness session on 2026-10-15, rows verbatim with trailing spaces
// trimmed. For one question 2.1.301 draws a lone tab row (` ☐ Colour`,
// no arrows and no Submit); for several, `←  ☐ Colour  ☐ Size  ☐ Shape
// ✔ Submit  →` (a heavy check). An answer moves the dialog on to the
// next tab (capture 3), so the first open tab is the current one.
const RULE = '─'.repeat(120);
const DASHES = '╌'.repeat(120);
const ASK_ONE = [
  '› Prompt from the emerald plugin',
  '❯ Use the AskUserQuestion tool to ask me one question, Which colour should the sample button be?, with the header',
  '  Colour and three options, each with a one-line description: Green (matches the brand), Grey (stays quiet), Red (draws',
  '  the eye). Do nothing else.',
  RULE,
  ' ☐ Colour',
  '',
  'Which colour should the sample button be?',
  '',
  '❯ 1. Green',
  '     Matches the brand',
  '  2. Grey',
  '     Stays quiet',
  '  3. Red',
  '     Draws the eye',
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
];
const ASK_TABS = [
  '● User declined to answer questions',
  '  ⎿  · Which colour should the sample button be? (Green / Grey / Red)',
  '',
  '✻ Churned for 3s · done 9:48 PM',
  '',
  '› Prompt from the emerald plugin',
  '❯ Use the AskUserQuestion tool once, with three questions in the one call: headers Colour, Size and Shape, each',
  '  question with three options and a one-line description per option. Do nothing else.',
  RULE,
  '←  ☐ Colour  ☐ Size  ☐ Shape  ✔ Submit  →',
  '',
  'Which colour should the sample button be?',
  '',
  '  1. Green',
  '     Matches the brand',
  '❯ 2. Grey',
  '     Stays quiet',
  '  3. Red',
  '     Draws the eye',
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
];
const ASK_TABS_2 = [
  '✻ Churned for 3s · done 9:48 PM',
  '',
  '› Prompt from the emerald plugin',
  '❯ Use the AskUserQuestion tool once, with three questions in the one call: headers Colour, Size and Shape, each',
  '  question with three options and a one-line description per option. Do nothing else.',
  RULE,
  '←  ☒ Colour  ☐ Size  ☐ Shape  ✔ Submit  →',
  '',
  'Which size should the sample button be?',
  '',
  '❯ 1. Small',
  '     Fits tight toolbars',
  '  2. Medium',
  '     The everyday default',
  '  3. Large',
  '     Easy to hit on touch screens',
  '  4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
];
// A Bash permission under --permission-mode default; its footer is not
// the select chord, and dashed dividers frame the command. The folder in
// option 2 is put in place of the captured one, which named a home.
const BASH_PERMISSION = [
  '✻ Cooked for 31s · done 9:51 PM',
  '',
  '› Prompt from the emerald plugin',
  '❯ Use the Bash tool to run exactly: mkdir ../ask777-probe-dir',
  '',
  '  Creating a probe directory beside the worktree',
  '  ⎿  $ mkdir ../ask777-probe-dir',
  '',
  RULE,
  ' Bash command',
  ' Tip: auto mode handles these prompts for you — choose "switch to auto mode" below',
  ' Create a probe directory beside the worktree',
  DASHES,
  ' mkdir ../ask777-probe-dir',
  DASHES,
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and always allow access to C:\\work from this project',
  '   3. Yes, and switch to auto mode · auto mode handles these prompts for you',
  '   4. No',
  '',
  ' Esc to cancel · Tab to amend',
];

test('askQuestion: one question, its options with their descriptions, no tabs', () => {
  const q = askQuestion(ASK_ONE);
  assert.ok(q !== null);
  assert.equal(q.question, 'Which colour should the sample button be?');
  assert.deepEqual(q.tabs, []);
  assert.deepEqual(q.options.map((o) => o.key), ['1', '2', '3', '4', '5']);
  assert.deepEqual(q.options.map((o) => o.description), ['Matches the brand', 'Stays quiet', 'Draws the eye', '', '']);
  assert.deepEqual(q.options.map((o) => o.pointer), [true, false, false, false, false]);
  assert.equal(q.options[3]!.label, 'Type something.');
  assert.equal(q.options[4]!.label, 'Chat about this');
});

test('askQuestion: three questions, the tabs and the pointer', () => {
  const q = askQuestion(ASK_TABS);
  assert.ok(q !== null);
  assert.deepEqual(q.tabs, [
    { name: 'Colour', state: 'open', current: true },
    { name: 'Size', state: 'open', current: false },
    { name: 'Shape', state: 'open', current: false },
    { name: 'Submit', state: 'submit', current: false },
  ]);
  assert.equal(q.question, 'Which colour should the sample button be?');
  assert.equal(q.options[1]!.pointer, true);
  assert.equal(q.options[1]!.label, 'Grey');
  assert.equal(q.options[1]!.description, 'Stays quiet');
});

test('askQuestion: after an answer, the next question and the next tab current', () => {
  const q = askQuestion(ASK_TABS_2);
  assert.ok(q !== null);
  assert.deepEqual(q.tabs.map((t) => [t.name, t.state, t.current]), [
    ['Colour', 'answered', false],
    ['Size', 'open', true],
    ['Shape', 'open', false],
    ['Submit', 'submit', false],
  ]);
  assert.equal(q.question, 'Which size should the sample button be?');
  assert.equal(q.options[2]!.description, 'Easy to hit on touch screens');
  // With every question answered, Submit is current; `answered ` is dropped.
  const all = askQuestion(['←  ☒ answered Colour  ☒ Size  ✓ Submit  →', '', 'Ready?', '', '❯ 1. Submit answers', '  2. Cancel', '', 'Enter to select · Tab/Arrow keys to navigate · Esc to cancel']);
  assert.deepEqual(all?.tabs.map((t) => [t.name, t.current]), [['Colour', false], ['Size', false], ['Submit', true]]);
});

test('askQuestion: a permission or another select dialog is not a question', () => {
  assert.equal(askQuestion(BASH_PERMISSION), null);
  assert.equal(askQuestion(PERMISSION), null);
  const select = ['Pick a theme', '', '❯ 1. Dark', '  2. Light', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel'];
  assert.equal(askQuestion(select), null);
  assert.equal(isQuestionDialog(ASK_ONE), true);
  assert.equal(isQuestionDialog(ASK_TABS), true);
  assert.equal(isQuestionDialog(ASK_TABS_2), true);
  assert.equal(isQuestionDialog(BASH_PERMISSION), false);
  assert.equal(isQuestionDialog(PERMISSION), false);
});

// M9 fix 803: two screens captured from a real Claude Code 2.1.302 in a
// harness session on 2026-10-16, rows verbatim with trailing spaces
// trimmed, ASK_ONE's ask. The Type something row's digit put the pointer
// on it with the placeholder kept and the footer gaining the Notepad
// chord (FREE_MOVED); a second digit was typed into the field, one DEL
// cleared it, and the text took the label's place (FREE_TYPED). A short
// text with its Enter in one write submitted, a long one took the Enter as
// a newline in the field.
const FREE_MOVED = [
  '› Prompt from the emerald plugin',
  '❯ Use the AskUserQuestion tool to ask me one question, Which colour should the sample button be?, with the header',
  '  Colour and three options, each with a one-line description: Green (matches the brand), Grey (stays quiet), Red (draws',
  '  the eye). Do nothing else.',
  RULE,
  ' ☐ Colour',
  '',
  'Which colour should the sample button be?',
  '',
  '  1. Green',
  '     Matches the brand.',
  '  2. Grey',
  '     Stays quiet.',
  '  3. Red',
  '     Draws the eye.',
  '❯ 4. Type something.',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · ctrl+g to edit in Notepad · Esc to cancel',
];
const FREE_TYPED = [
  '› Prompt from the emerald plugin',
  '❯ Use the AskUserQuestion tool to ask me one question, Which colour should the sample button be?, with the header',
  '  Colour and three options, each with a one-line description: Green (matches the brand), Grey (stays quiet), Red (draws',
  '  the eye). Do nothing else.',
  RULE,
  ' ☐ Colour',
  '',
  'Which colour should the sample button be?',
  '',
  '  1. Green',
  '     Matches the brand.',
  '  2. Grey',
  '     Stays quiet.',
  '  3. Red',
  '     Draws the eye.',
  '❯ 4. Medium please',
  RULE,
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · ctrl+g to edit in Notepad · Esc to cancel',
];

test('freeOption: the Type something row, or the one before Chat about this once typed into (fix 803)', () => {
  for (const [name, rows] of [['ASK_ONE', ASK_ONE], ['ASK_TABS', ASK_TABS], ['FREE_MOVED', FREE_MOVED], ['FREE_TYPED', FREE_TYPED]] as const) {
    const ask = askQuestion(rows);
    assert.ok(ask !== null, name);
    assert.equal(freeOption(ask)?.key, '4', name);
  }
  assert.equal(freeText(freeOption(askQuestion(FREE_MOVED)!)!), '');
  assert.equal(freeText(freeOption(askQuestion(FREE_TYPED)!)!), 'Medium please');
  // A long text wraps onto a second row, read as the option's description.
  const wrapped = FREE_TYPED.flatMap((r) => (r === '❯ 4. Medium please' ? ['❯ 4. A sage green, light enough for dark text, with a slightly', '     darker border on hover please'] : [r]));
  assert.equal(freeText(freeOption(askQuestion(wrapped)!)!), 'A sage green, light enough for dark text, with a slightly darker border on hover please');
  const select = ['Pick a theme', '', '❯ 1. Dark', '  2. Light', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel'];
  assert.equal(askQuestion(select), null, 'no question, so no free row');
});

test('freeAnswerKeys: the digit unless the pointer is there, then the clears and the text (fix 803)', () => {
  assert.deepEqual(freeAnswerKeys(askQuestion(ASK_ONE)!, 'Medium please'), { move: '4', text: 'Medium please' });
  assert.deepEqual(freeAnswerKeys(askQuestion(FREE_MOVED)!, 'Medium please'), { move: null, text: 'Medium please' });
  const typed = ASK_ONE.map((r) => (r === '  4. Type something.' ? '❯ 4. 444' : r === '❯ 1. Green' ? '  1. Green' : r));
  assert.deepEqual(freeAnswerKeys(askQuestion(typed)!, 'Medium please'), { move: null, text: '\x7f\x7f\x7fMedium please' });
});

// M9 fix 801: one press per dialog, told by the dialog's key.
test('dialogKey: one key per dialog, the pointer left out; null with no dialog (fix 801)', () => {
  const tabs = dialogKey(ASK_TABS, { x: 0, y: 0 });
  assert.ok(tabs !== null);
  const moved = ASK_TABS.map((r) => (r === '  1. Green' ? '❯ 1. Green' : r === '❯ 2. Grey' ? '  2. Grey' : r));
  assert.notDeepEqual(moved, ASK_TABS);
  assert.equal(dialogKey(moved, { x: 0, y: 0 }), tabs, 'an arrow key leaves the dialog the same one');
  assert.notEqual(dialogKey(ASK_TABS_2, { x: 0, y: 0 }), tabs, 'the next tab is another dialog');
  assert.notEqual(dialogKey(BASH_PERMISSION, { x: 1, y: BASH_PERMISSION.length - 1 }), null);
  assert.equal(dialogKey(['', 'ran ask-801', ''], { x: 11, y: 1 }), null);
});

test('pressOver: a read after the press with another dialog, or the same one past the retry (fix 801)', () => {
  const cursor = { x: 0, y: 0 };
  const press = { at: 1000, key: dialogKey(ASK_TABS, cursor) };
  assert.equal(pressOver(press, { rows: ASK_TABS_2, cursor, sentAt: 900 }), false, 'a read sent before the press');
  assert.equal(pressOver(press, { rows: ASK_TABS, cursor, sentAt: 1500 }), false, 'the same dialog, inside the retry');
  assert.equal(pressOver(press, { rows: ASK_TABS_2, cursor, sentAt: 1500 }), true, 'another dialog');
  assert.equal(pressOver(press, { rows: ['', 'ran ask-801', ''], cursor, sentAt: 9000 }), false, 'no dialog drawn');
  assert.equal(pressOver(press, { rows: ASK_TABS, cursor, sentAt: 1000 + ASK_PRESS_RETRY_MS }), true, 'the same dialog past the retry');
  assert.equal(pressOver({ at: 1000, key: null }, { rows: ASK_TABS, cursor, sentAt: 1500 }), true, 'a press on no dialog meets one');
});

test('promptExcerpt: anchored on the dialog, not a stale cursor or the footer', () => {
  // Fails before fix 777: the cursor read gave the conversation row.
  assert.deepEqual(promptExcerpt(PERMISSION, { x: 0, y: 0 }), ['Edit file', '', 'Do you want to make this edit to session.ts?', '❯ 1. Yes', '2. Yes, allow all edits during this session', '3. No, and tell Claude what to do differently']);
  // Fails before fix 777: the cursor on the footer gave the footer alone.
  const bash = promptExcerpt(BASH_PERMISSION, { x: 1, y: BASH_PERMISSION.length - 1 });
  assert.equal(bash[0], 'Bash command');
  assert.equal(bash[bash.length - 1], '4. No');
  assert.ok(bash.includes('mkdir ../ask777-probe-dir'));
});

test('promptExcerpt: a tall dialog keeps its title and question, the middle cut', () => {
  const diff = Array.from({ length: 30 }, (_, i) => `│ ${i + 1} + line ${i} │`);
  // The frame's top is past DIALOG_REACH from option 1, so the run
  // holding option 1 bounds it, the blank row above the dialog.
  const rows = ['● Editing.', '', '╭────────╮', '│ Edit file │', ...diff, '│ Do you want to make this edit? │', '│ ❯ 1. Yes │', '│   2. Yes, allow all │', '│   3. No │', '╰────────╯'];
  const out = promptExcerpt(rows, { x: 0, y: rows.length - 1 });
  assert.equal(out.length, 14);
  assert.equal(out[0], 'Edit file');
  assert.equal(out[3], '…');
  assert.deepEqual(out.slice(-4), ['Do you want to make this edit?', '❯ 1. Yes', '2. Yes, allow all', '3. No']);
});

// M9 fix 779: an empty prompt row as Claude Code draws it, the suggestion
// where the placeholder sits.
const SUGGESTED = ['', '─'.repeat(40), '❯ Run the tests', '─'.repeat(40), '  ⏵⏵ accept edits on (shift+tab to cycle)'];

test('ghostSuggestion reads the ghost on the last prompt row (fix 779)', () => {
  assert.equal(ghostSuggestion({ rows: SUGGESTED, ghost: { y: 2, x: 2, text: 'Run the tests' } }), 'Run the tests');
  assert.equal(ghostSuggestion({ rows: SUGGESTED, ghost: null }), null, 'no ghost');
  assert.equal(ghostSuggestion({ rows: SUGGESTED }), null, 'an older daemon sends no field');
});

test('ghostSuggestion leaves out the stock placeholders (fix 779)', () => {
  for (const text of ['Try "fix lint errors"', 'Press up to edit queued messages', 'Message @alice…']) {
    const rows = [...SUGGESTED];
    rows[2] = `❯ ${text}`;
    assert.equal(ghostSuggestion({ rows, ghost: { y: 2, x: 2, text } }), null, text);
  }
});

test('ghostSuggestion takes no ghost off another row, nor one after typed text (fix 779)', () => {
  const rows = ['❯ earlier', ...SUGGESTED];
  assert.equal(ghostSuggestion({ rows, ghost: { y: 0, x: 2, text: 'earlier' } }), null, 'a row above the last ❯ row');
  const typed = [...SUGGESTED];
  typed[2] = '❯ /compact';
  assert.equal(ghostSuggestion({ rows: typed, ghost: { y: 2, x: 7, text: 'act' } }), null, 'an inline completion');
});

test("ghostSuggestion reads the row from the ghost's start, not the run's end (fix 809)", () => {
  const stock = [...SUGGESTED];
  stock[2] = '❯ Try "fix lint errors"';
  assert.equal(ghostSuggestion({ rows: stock, ghost: { y: 2, x: 2, text: 'Try' } }), null, 'the dim run broken after Try');
  const wrapped = [...SUGGESTED];
  wrapped[2] = '❯ Try "how does';
  assert.equal(ghostSuggestion({ rows: wrapped, ghost: { y: 2, x: 2, text: 'Try' } }), null, 'wrapped onto the next row, no closing quote');
  assert.equal(ghostSuggestion({ rows: SUGGESTED, ghost: { y: 2, x: 2, text: 'Run' } }), 'Run the tests', 'a run cut short');
  const padded = [...SUGGESTED];
  padded[2] = '❯ Run the tests   ';
  assert.equal(ghostSuggestion({ rows: padded, ghost: { y: 2, x: 2, text: 'Run the tests' } }), 'Run the tests', 'trailing spaces');
});
