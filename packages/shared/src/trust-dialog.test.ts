import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trustDialog, trustKeys } from './trust-dialog.ts';

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
  assert.deepEqual(d.lines, ['Accessing workspace:', '', 'C:\\code\\project']);
});

test('trustDialog with no heading takes the rows under the rule', () => {
  const rows = ['old output', RULE, ' Is this folder yours?', '', ' ❯ No, exit', '   Yes, I trust this folder'];
  assert.deepEqual(trustDialog(rows)?.lines, ['Is this folder yours?']);
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
