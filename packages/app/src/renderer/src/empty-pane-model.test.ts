import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPath, defaultKind, emptyKey, escapeStep, folderRows, hostRecent, hostRefusal, hostSub, hostTail, hostWaiting, nextTile, onRowShown, resolvePath, parentLabel, shellChoice, setupFigure, shellSub, startLabel, tileTitle, wantsAuthRead } from './empty-pane-model.ts';

test('tileTitle: the folder by name, the whole folder for a drive root, none with no row (M9 fix 705)', () => {
  assert.equal(tileTitle('C:\\code\\emerald'), 'Double-click to start in emerald');
  assert.equal(tileTitle('C:\\'), 'Double-click to start in C:\\');
  assert.equal(tileTitle(null), undefined);
});

test('defaultKind: the split default wins, else the stored kind, else a shell (M9 fix 545)', () => {
  assert.equal(defaultKind('shell', 'claude'), 'shell');
  assert.equal(defaultKind('claude', null), 'claude');
  assert.equal(defaultKind('empty', 'claude'), 'claude');
  assert.equal(defaultKind('empty', null), 'shell');
});

test('folderRows: the split folder first, the recent list after it, each folder once (M9 fix 545)', () => {
  const recent = ['C:\\x', 'c:\\code\\emerald\\', 'C:\\y'];
  assert.deepEqual(folderRows({ split: 'C:\\code\\emerald', recent, home: 'C:\\Users\\Z', picked: null }), [
    { folder: 'C:\\code\\emerald', note: 'split from here' },
    { folder: 'C:\\x', note: null },
    { folder: 'C:\\y', note: null },
  ]);
  assert.deepEqual(folderRows({ split: null, recent, home: 'C:\\Users\\Z', picked: null })[0], { folder: 'C:\\x', note: 'last used' });
  assert.deepEqual(folderRows({ split: null, recent: [], home: 'C:\\Users\\Z', picked: null }), [{ folder: 'C:\\Users\\Z', note: null }]);
  assert.deepEqual(folderRows({ split: null, recent: [], home: null, picked: null }), []);
});

test('folderRows: a pick goes first and the default keeps its note in row 2 (M9 fix 545)', () => {
  const rows = folderRows({ split: 'C:\\code\\emerald', recent: ['C:\\x', 'C:\\picked'], home: null, picked: 'c:/picked' });
  assert.deepEqual(rows, [
    { folder: 'c:/picked', note: 'picked' },
    { folder: 'C:\\code\\emerald', note: 'split from here' },
    { folder: 'C:\\x', note: null },
  ]);
});

test('folderRows: ten recent folders give eight rows (M9 fix 545)', () => {
  const recent = Array.from({ length: 10 }, (_, i) => `C:\\f${i}`);
  const rows = folderRows({ split: null, recent, home: null, picked: null });
  assert.equal(rows.length, 8);
  assert.equal(rows[7]?.folder, 'C:\\f7');
});

test('parentLabel: the parent, home as ~, nothing for a drive root (M9 fix 545)', () => {
  assert.equal(parentLabel('C:\\Users\\Z\\code\\emerald', 'C:\\Users\\Z'), '~\\code');
  assert.equal(parentLabel('c:\\users\\z\\emerald', 'C:\\Users\\Z'), '~');
  assert.equal(parentLabel('D:\\work\\x', 'C:\\Users\\Z'), 'D:\\work');
  assert.equal(parentLabel('C:\\', 'C:\\Users\\Z'), '');
});

test('startLabel: the kind, then the folder by name (M9 fix 545)', () => {
  assert.deepEqual(startLabel('shell', 'C:\\code\\emerald'), { head: 'Start shell', tail: ' in emerald' });
  assert.deepEqual(startLabel('claude', 'C:\\code\\emerald'), { head: 'Start Claude', tail: ' in emerald' });
  assert.deepEqual(startLabel('shell', 'C:\\'), { head: 'Start shell', tail: ' in C:\\' });
});

test('emptyKey: Enter starts, Tab flips, a digit picks a row, arrows move (M9 fix 545)', () => {
  const k = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });
  assert.deepEqual(emptyKey(k('Enter'), 3), { act: 'start' });
  assert.deepEqual(emptyKey(k('Enter', { shiftKey: true }), 3), { act: 'swallow' });
  assert.deepEqual(emptyKey(k('Tab'), 3), { act: 'flip', delta: 1 });
  assert.deepEqual(emptyKey(k('Tab', { shiftKey: true }), 3), { act: 'flip', delta: -1 });
  assert.deepEqual(emptyKey(k('3'), 3), { act: 'row', index: 2 });
  assert.deepEqual(emptyKey(k('3'), 2), { act: 'swallow' });
  assert.equal(emptyKey(k('3', { ctrlKey: true }), 3), null);
  assert.deepEqual(emptyKey(k('ArrowDown'), 3), { act: 'move', delta: 1 });
  assert.equal(emptyKey(k('a'), 3), null);
});

test('nextTile walks shell, claude, browser, file and wraps, skipping what the daemon lacks (M9 fixes 666, 990)', () => {
  const both = { browser: true, file: true };
  assert.equal(nextTile('claude', 1, both), 'browser');
  assert.equal(nextTile('browser', 1, both), 'file');
  assert.equal(nextTile('file', 1, both), 'shell');
  assert.equal(nextTile('shell', -1, both), 'file');
  assert.equal(nextTile('claude', 1, { browser: false, file: true }), 'file');
  assert.equal(nextTile('claude', 1, { browser: false, file: false }), 'shell');
  assert.equal(nextTile('shell', -1, { browser: false, file: false }), 'claude');
});

test('cleanPath strips one pair of surrounding quotes and the spaces (M9 fix 990)', () => {
  assert.equal(cleanPath('  "C:\\a b\\x.txt"  '), 'C:\\a b\\x.txt');
  assert.equal(cleanPath("'C:\\x.txt'"), 'C:\\x.txt');
  assert.equal(cleanPath('"C:\\x.txt'), '"C:\\x.txt');
  assert.equal(cleanPath('C:\\x.txt'), 'C:\\x.txt');
});

test('resolvePath: absolute as given, relative from the folder, dots folded (M9 fix 990)', () => {
  assert.equal(resolvePath('C:\\a\\x.txt', 'D:\\w'), 'C:\\a\\x.txt');
  assert.equal(resolvePath('C:/a/./b/../x.txt', null), 'C:\\a\\x.txt');
  assert.equal(resolvePath('src\\index.ts', 'C:\\w'), 'C:\\w\\src\\index.ts');
  assert.equal(resolvePath('..\\y.txt', 'C:\\w\\sub'), 'C:\\w\\y.txt');
  assert.equal(resolvePath('..\\..\\..\\x', 'C:\\w'), 'C:\\x');
  assert.equal(resolvePath('\\top.txt', 'C:\\w'), 'C:\\top.txt');
  assert.equal(resolvePath('\\\\srv\\share\\x.txt', null), '\\\\srv\\share\\x.txt');
  assert.equal(resolvePath('x.txt', null), null);
  assert.equal(resolvePath('', 'C:\\w'), null);
});

// M9 fix 647: the Shell tile starts the picked shell, or the default.
const PS = { id: 'powershell', label: 'Windows PowerShell', file: 'powershell.exe' } as const;
const GB = { id: 'gitbash', label: 'Git Bash', file: 'bash.exe' } as const;
const CMD = { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe' } as const;

test('shellChoice: the stored shell when installed and not the default, else null', () => {
  assert.equal(shellChoice(null, [PS, GB, CMD]), null);
  assert.equal(shellChoice('cmd', [PS, GB, CMD]), CMD);
  assert.equal(shellChoice('gitbash', [PS, CMD]), null);
  assert.equal(shellChoice('powershell', [PS, CMD]), null);
  assert.equal(shellChoice('cmd', []), null);
});

test('startLabel names a picked shell for the shell kind alone', () => {
  assert.deepEqual(startLabel('shell', 'C:\\code\\emerald', CMD), { head: 'Start Command Prompt', tail: ' in emerald' });
  assert.deepEqual(startLabel('claude', 'C:\\code\\emerald', CMD), { head: 'Start Claude', tail: ' in emerald' });
});

test('escapeStep: a path in the box is cleared before anything closes, and a path kept under another tile is not (M9 fix 1010)', () => {
  assert.equal(escapeStep({ actionQuery: false, filePick: true, pathText: 'C:\\a.txt' }), 'clear-path');
  assert.equal(escapeStep({ actionQuery: false, filePick: true, pathText: '  ' }), 'clear-path');
  assert.equal(escapeStep({ actionQuery: false, filePick: true, pathText: '' }), 'close');
  assert.equal(escapeStep({ actionQuery: true, filePick: false, pathText: '' }), 'clear-query-and-close');
  assert.equal(escapeStep({ actionQuery: true, filePick: false, pathText: 'C:\\a.txt' }), 'clear-query-and-close');
  assert.equal(escapeStep({ actionQuery: true, filePick: true, pathText: 'x' }), 'clear-path');
  assert.equal(escapeStep({ actionQuery: false, filePick: false, pathText: '' }), 'close');
});

test('emptyKey: ArrowLeft and ArrowRight move the host pick only with the on row shown (M9 fix 1087)', () => {
  const k = (key: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });
  assert.deepEqual(emptyKey(k('ArrowLeft'), 3, true), { act: 'host', delta: -1 });
  assert.deepEqual(emptyKey(k('ArrowRight'), 3, true), { act: 'host', delta: 1 });
  assert.equal(emptyKey(k('ArrowLeft'), 3), null);
  assert.equal(emptyKey(k('ArrowRight'), 3, false), null);
  assert.equal(emptyKey(k('ArrowRight', { shiftKey: true }), 3, true), null);
  assert.equal(emptyKey(k('ArrowLeft', { ctrlKey: true }), 3, true), null);
  assert.deepEqual(emptyKey(k('ArrowDown'), 3, true), { act: 'move', delta: 1 });
  assert.deepEqual(emptyKey(k('ArrowUp'), 3, true), { act: 'move', delta: -1 });
  assert.deepEqual(emptyKey(k('2'), 3, true), { act: 'row', index: 1 });
  assert.deepEqual(emptyKey(k('9'), 3, true), { act: 'swallow' });
});

test('startLabel: a remote host adds its name after the folder, This PC adds nothing (M9 fix 1087)', () => {
  assert.deepEqual(startLabel('claude', 'C:\\code\\workflow-studio', null, 'wfs-db'), { head: 'Start Claude', tail: ' in workflow-studio on wfs-db' });
  assert.deepEqual(startLabel('shell', 'C:\\code\\emerald', CMD, 'wfs-db'), { head: 'Start Command Prompt', tail: ' in emerald on wfs-db' });
  assert.deepEqual(startLabel('shell', 'C:\\code\\emerald', null, undefined), { head: 'Start shell', tail: ' in emerald' });
  assert.deepEqual(startLabel('shell', 'C:\\code\\emerald', null, ''), { head: 'Start shell', tail: ' in emerald' });
  assert.equal(hostTail('wfs-db'), ' on wfs-db');
  assert.equal(hostTail(undefined), '');
  assert.equal(hostTail(''), '');
});

test('hostRecent: the host\'s own sessions, latest first, each folder once (M9 fix 1087)', () => {
  const sessions = [
    { host: 'wfs-db', groupCwd: 'C:\\Users\\zacha\\a', lastEventAt: 10, stateSince: 1 },
    { host: 'wfs-db', groupCwd: 'C:\\Users\\zacha\\b', lastEventAt: null, stateSince: 20 },
    { groupCwd: 'C:\\code\\c', lastEventAt: 30, stateSince: 1 },
  ];
  assert.deepEqual(hostRecent(sessions, 'wfs-db'), ['C:\\Users\\zacha\\b', 'C:\\Users\\zacha\\a']);
  const dup = [...sessions, { host: 'wfs-db', groupCwd: 'c:/users/zacha/a/', lastEventAt: 5, stateSince: 1 }];
  assert.deepEqual(hostRecent(dup, 'wfs-db'), ['C:\\Users\\zacha\\b', 'C:\\Users\\zacha\\a']);
  assert.deepEqual(hostRecent(sessions, 'other'), []);
});

test('onRowShown: a host or the open box, and neither Browser nor File picked (M9 fix 1087)', () => {
  assert.equal(onRowShown(0, false, null), false);
  assert.equal(onRowShown(1, false, null), true);
  assert.equal(onRowShown(0, true, null), true);
  assert.equal(onRowShown(1, false, 'browser'), false);
  assert.equal(onRowShown(1, true, 'file'), false);
});

test('escapeStep: an open host box closes before the query or the pane (M9 fix 1087)', () => {
  assert.equal(escapeStep({ actionQuery: false, filePick: false, pathText: '', openBox: true }), 'leave-box');
  assert.equal(escapeStep({ actionQuery: true, filePick: false, pathText: '', openBox: true }), 'leave-box');
});

test('shellSub: the default line with no pick, the swap with one', () => {
  assert.equal(shellSub(null, [PS, CMD]), 'your default shell, nothing else asked');
  assert.equal(shellSub(CMD, [PS, CMD]), 'Command Prompt in place of Windows PowerShell');
});

test('hostRefusal: each reason with its words and act, first match wins (M9 fix 1088)', () => {
  const base = { name: 'wfs-db', refusal: null, setup: null, state: 'up', claude: true as boolean | null };
  assert.deepEqual(hostRefusal({ ...base, os: 'linux' }, 'shell'), { reason: 'linux', text: 'wfs-db runs Linux, and a pane there waits for a Linux build of emerald.', act: null });
  assert.deepEqual(hostRefusal({ ...base, refusal: { kind: 'hostkey', line: 'x' } }, 'shell'), {
    reason: 'hostkey',
    text: 'wfs-db has not been reached from this PC before, so its key is unchecked. Run ssh wfs-db once in a shell here, check the fingerprint it shows, then pick it again.',
    act: 'Open a shell here to run it',
  });
  assert.deepEqual(hostRefusal({ ...base, refusal: { kind: 'ssh', line: 'Permission denied (publickey).' } }, 'shell'), { reason: 'ssh', text: 'wfs-db refused the login: Permission denied (publickey).', act: 'Try again' });
  assert.deepEqual(hostRefusal({ ...base, setup: { phase: 'failed', line: 'disk full' } }, 'shell'), { reason: 'setup', text: 'Setting up wfs-db failed: disk full', act: 'Try again' });
  assert.equal(hostRefusal({ ...base, setup: { phase: 'failed', line: null } }, 'shell')?.text, 'Setting up wfs-db failed: no reason given');
  assert.deepEqual(hostRefusal({ ...base, claude: false }, 'claude'), {
    reason: 'no-claude',
    text: "Claude Code is not on wfs-db's PATH, so a Claude session cannot start there. A shell can. Install Claude Code on wfs-db, then start again.",
    act: 'Start a shell on wfs-db instead',
  });
  assert.equal(hostRefusal({ ...base, os: 'linux', refusal: { kind: 'hostkey', line: 'x' } }, 'shell')?.reason, 'linux');
  assert.equal(hostRefusal({ ...base, refusal: { kind: 'nokit', line: 'x' } }, 'shell'), null);
  assert.equal(hostRefusal({ ...base, setup: { phase: 'failed', line: 'cancelled' } }, 'shell'), null);
  assert.equal(hostRefusal({ ...base, claude: true }, 'claude'), null);
  assert.equal(hostRefusal({ ...base, claude: null }, 'claude'), null);
  assert.equal(hostRefusal({ ...base, claude: false }, 'shell'), null);
});

test('hostSub, setupFigure and hostWaiting (M9 fix 1088)', () => {
  assert.equal(hostSub('setup'), 'setting up');
  assert.equal(hostSub('lost'), 'unreachable');
  assert.equal(hostSub('up'), null);
  assert.equal(setupFigure(35651584, 1000, 13500), '34.0 MB, 12 s');
  assert.equal(setupFigure(0, 1000, 4200), '3 s');
  assert.equal(setupFigure(1048576, 5000, 4000), '1.0 MB, 0 s');
  for (const s of ['connecting', 'setup', 'refused', 'lost']) assert.equal(hostWaiting(s), true);
  for (const s of ['idle', 'up']) assert.equal(hostWaiting(s), false);
});

test('hostSub reads a host\'s sign-in after its line, and wantsAuthRead asks only for kind Claude on an up host at level 81 (M9 fix 1094)', () => {
  assert.equal(hostSub('up', 'wfs-db', { signedIn: false, expiresAt: null }, 1000), 'not signed in on wfs-db');
  assert.equal(hostSub('up', 'wfs-db', { signedIn: true, expiresAt: 1000 }, 1000), 'login expired on wfs-db');
  assert.equal(hostSub('up', 'wfs-db', { signedIn: false, expiresAt: 500 }, 1000), 'login expired on wfs-db');
  assert.equal(hostSub('up', 'wfs-db', { signedIn: true, expiresAt: 2000 }, 1000), null);
  assert.equal(hostSub('up', 'wfs-db', { signedIn: true, expiresAt: null }, 1000), null);
  assert.equal(hostSub('up', 'wfs-db', null, 1000), null);
  assert.equal(hostSub('lost', 'wfs-db', { signedIn: false, expiresAt: null }, 1000), 'unreachable');
  assert.equal(hostSub('setup', 'wfs-db', { signedIn: false, expiresAt: null }, 1000), 'setting up');
  assert.equal(wantsAuthRead('claude', null, 'up', 81), true);
  assert.equal(wantsAuthRead('claude', null, 'up', 80), false);
  assert.equal(wantsAuthRead('claude', null, 'up', null), false);
  assert.equal(wantsAuthRead('shell', null, 'up', 81), false);
  assert.equal(wantsAuthRead('claude', 'file', 'up', 81), false);
  assert.equal(wantsAuthRead('claude', null, 'lost', 81), false);
});
