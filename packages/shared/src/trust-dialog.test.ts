import { test } from 'node:test';
import assert from 'node:assert/strict';
import { switchDialog, trustDialog, trustKeys, trustParagraphs } from './trust-dialog.ts';

// The trust dialog as Claude Code 2.1.302 drew it for a fresh folder under
// %TEMP%, read off the daemon's screen at 120 x 30 (M9 fix 808's capture),
// the folder's stamp shortened and the user's name replaced (the public
// export refuses a home path in the tree).
const RULE = '─'.repeat(120);
const CAPTURED = [
  '',
  RULE,
  ' Accessing workspace:',
  '',
  ' C:\\Users\\someone\\AppData\\Local\\Temp\\emerald-verify\\trust-1792',
  '',
  " Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source",
  " project, or work from your team). If not, take a moment to review what's in this folder first.",
  '',
  " Claude Code'll be able to read, edit, and execute files here.",
  '',
  ' Security guide',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
];

test('trustDialog reads the captured dialog: two options in drawn order, the pointer on No, the text from Accessing workspace (M9 fix 808)', () => {
  const d = trustDialog(CAPTURED);
  assert.ok(d);
  assert.deepEqual(d.options, [
    { label: 'No, exit', pick: 'no', pointer: true },
    { label: 'Yes, I trust this folder', pick: 'yes', pointer: false },
  ]);
  assert.equal(d.lines[0], 'Accessing workspace:');
  assert.equal(d.lines[d.lines.length - 1], 'Security guide');
  assert.ok(!d.lines.includes(RULE));
  // Blank runs collapse to one, and none ends the text.
  assert.ok(d.lines.every((l, i) => l !== '' || d.lines[i - 1] !== ''));
  // M9 fix 847: the path is left out, the cards drawing the session's own.
  assert.equal(d.pathDropped, true);
  assert.ok(!d.lines.some((l) => l.includes('trust-1792')), 'the path rows are left out');
});

// M9 fix 881: CAPTURED with each text row rewrapped at 60 columns, as a
// narrower terminal draws it.
const CAPTURED_60 = [
  '',
  RULE,
  ' Accessing workspace:',
  '',
  ' C:\\Users\\someone\\AppData\\Local\\Temp\\emerald-verify\\trust-1792',
  '',
  ' Quick safety check: Is this a project you created or one',
  ' you trust? (Like your own code, a well-known open source',
  ' project, or work from your team). If not, take a moment to',
  " review what's in this folder first.",
  '',
  " Claude Code'll be able to read, edit, and execute files",
  ' here.',
  '',
  ' Security guide',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
];

test('trustParagraphs joins each run of wrapped rows into one line, whatever width the TUI drew (M9 fix 881)', () => {
  const paragraphs = [
    'Accessing workspace:',
    '',
    "Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this folder first.",
    '',
    "Claude Code'll be able to read, edit, and execute files here.",
    '',
    'Security guide',
  ];
  assert.deepEqual(trustParagraphs(trustDialog(CAPTURED)!.lines), paragraphs);
  assert.notDeepEqual(trustDialog(CAPTURED_60)!.lines, trustDialog(CAPTURED)!.lines);
  assert.deepEqual(trustParagraphs(trustDialog(CAPTURED_60)!.lines), paragraphs);
  assert.deepEqual(trustParagraphs(['a', 'b', '', 'c']), ['a b', '', 'c']);
  assert.deepEqual(trustParagraphs(['Accessing workspace:']), ['Accessing workspace:']);
});

test('trustDialog leaves out a path the TUI wrapped onto two rows (M9 fix 847)', () => {
  const wrapped = CAPTURED.flatMap((r) => (r.includes('trust-1792') ? [' C:\\Users\\someone\\AppData\\Local\\Temp\\emerald-verify\\', ' trust-1792'] : [r]));
  const d = trustDialog(wrapped);
  assert.ok(d);
  assert.deepEqual(d.lines, trustDialog(CAPTURED)!.lines);
  assert.equal(d.pathDropped, true);
});

test('trustDialog follows the pointer when it moves to Yes', () => {
  const moved = CAPTURED.map((r) => (r === ' ❯ No, exit' ? '   No, exit' : r === '   Yes, I trust this folder' ? ' ❯ Yes, I trust this folder' : r));
  const d = trustDialog(moved);
  assert.ok(d);
  assert.deepEqual(d.options.map((o) => o.pointer), [false, true]);
});

test('trustKeys moves from the pointer to the pick and confirms', () => {
  const d = trustDialog(CAPTURED)!;
  assert.equal(trustKeys(d, 'no'), '\r');
  assert.equal(trustKeys(d, 'yes'), '\x1b[B\r');
  const onYes = { ...d, options: d.options.map((o) => ({ ...o, pointer: o.pick === 'yes' })) };
  assert.equal(trustKeys(onYes, 'yes'), '\r');
  assert.equal(trustKeys(onYes, 'no'), '\x1b[A\r');
  const none = { ...d, options: d.options.map((o) => ({ ...o, pointer: false })) };
  assert.equal(trustKeys(none, 'yes'), null);
});

test('trustDialog reads the form for a folder whose settings pre-approve tools, framed', () => {
  const rows = [
    '╭──────────────────────────────────────────╮',
    '│ Accessing workspace:                     │',
    '│                                          │',
    '│ C:\\code\\project                          │',
    '│                                          │',
    '│ ❯ No, continue without these permissions │',
    '│   Yes, I trust this folder               │',
    '╰──────────────────────────────────────────╯',
  ];
  const d = trustDialog(rows);
  assert.ok(d);
  assert.deepEqual(d.options.map((o) => o.label), ['No, continue without these permissions', 'Yes, I trust this folder']);
  assert.deepEqual(d.lines, ['Accessing workspace:']);
  assert.equal(d.pathDropped, true);
});

test('trustDialog with no heading takes the rows under the rule', () => {
  const rows = ['old output', RULE, ' Is this folder yours?', '', ' ❯ No, exit', '   Yes, I trust this folder'];
  assert.deepEqual(trustDialog(rows)?.lines, ['Is this folder yours?']);
  assert.equal(trustDialog(rows)?.pathDropped, false);
});

test('trustDialog is null for a numbered permission dialog and for the old numbered trust list', () => {
  const permission = [
    '╭──────────────────────────────────────────────╮',
    '│ Edit file                                    │',
    '│ Do you want to make this edit to session.ts? │',
    '│ ❯ 1. Yes                                     │',
    '│   2. Yes, allow all edits during this session │',
    '│   3. No, and tell Claude what to do differently │',
    '╰──────────────────────────────────────────────╯',
  ];
  assert.equal(trustDialog(permission), null);
  assert.equal(trustDialog(['1. Old', '2. Older', '', 'Trust this folder?', '❯ 1. Yes, proceed', '  2. No, exit']), null);
  assert.equal(trustDialog([]), null);
  // Yes alone, or No too far from it, is no dialog.
  assert.equal(trustDialog(['   Yes, I trust this folder']), null);
  assert.equal(trustDialog([' ❯ No, exit', '', '', '', '', '   Yes, I trust this folder']), null);
});

// M9 fix 976: Claude Code 2.1.310's switch confirmation as its bundle draws
// it (component bfe over the shared confirm dr): the confirm row first,
// digits unless overDraft hides them. A capture on a real Claude showed no
// dialog (the typed /effort took the level at once), so the rows are the
// bundle's strings.
const EFFORT_ROWS = [
  'old output',
  RULE,
  ' Change effort level?',
  ' Your next response will be slower and use more tokens',
  '',
  ' This conversation is cached for the current effort level. Switching to high means the full history gets re-read on your next message.',
  '',
  ' ❯ 1. Yes, switch to high',
  '   2. No, go back',
  '',
  ' Enter to confirm · Esc to cancel',
];
const MODEL_ROWS = [
  RULE,
  ' Switch model?',
  ' Your next response will be slower and use more tokens',
  '',
  ' This conversation is cached for the current model. Switching to Opus 5.5 means the full history gets re-read on your next message.',
  '',
  '   Yes, switch to Opus 5.5',
  ' ❯ No, go back',
];

test('switchDialog reads the numbered effort dialog: title, both options in order, their digits, the pointer on Yes (M9 fix 976)', () => {
  assert.deepEqual(switchDialog(EFFORT_ROWS), {
    title: 'Change effort level?',
    options: [
      { label: 'Yes, switch to high', pick: 'yes', key: '1', pointer: true },
      { label: 'No, go back', pick: 'no', key: '2', pointer: false },
    ],
  });
});

test('switchDialog reads the digitless model dialog with the pointer on No, and trustKeys answers it', () => {
  const d = switchDialog(MODEL_ROWS);
  assert.deepEqual(d, {
    title: 'Switch model?',
    options: [
      { label: 'Yes, switch to Opus 5.5', pick: 'yes', key: null, pointer: false },
      { label: 'No, go back', pick: 'no', key: null, pointer: true },
    ],
  });
  assert.equal(trustKeys(d!, 'yes'), '\x1b[A\r');
  assert.equal(trustKeys(d!, 'no'), '\r');
  // The stubs draw the pointer as >.
  assert.equal(switchDialog(['Switch model?', '  Yes, switch to Opus 5.5', '> No, go back'])?.options[1]?.pointer, true);
});

test('switchDialog is null under a prompt box, for the trust dialog, and without its title', () => {
  // A reply quoting the rows, with the prompt box under them.
  assert.equal(switchDialog([...EFFORT_ROWS, RULE, '❯ ', RULE]), null);
  assert.equal(switchDialog(CAPTURED), null);
  assert.equal(switchDialog(EFFORT_ROWS.filter((r) => r !== ' Change effort level?')), null);
  assert.equal(switchDialog([' Change effort level?', '   2. No, go back']), null);
  assert.equal(switchDialog([]), null);
});
