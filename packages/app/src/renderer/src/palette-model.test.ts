import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo } from '@emerald/shared';
import { actionRows, chordsText, isActionQuery, matchSession, moveHighlight, orderRows, rankSessions, segments, subsequence, waitText } from './palette-model.ts';
import { BINDINGS } from './keys-model.ts';
import { sessionPaneMenu } from './pane-menu-model.ts';
import { aSession } from './test-support.ts';

const session = (id: string, over: Partial<SessionInfo> = {}): SessionInfo =>
  aSession({ id, name: id, autoName: true, spawnCwd: `C:\\work\\${id}`, cwd: `C:\\work\\${id}`, groupCwd: `C:\\work\\${id}`, stateSince: 1000, color: '#61afef', createdAt: 1000, ...over });

test('subsequence matches in order, case-insensitively, at the earliest places', () => {
  assert.deepEqual(subsequence('zrc', 'zorca'), [0, 2, 3]); // rename: keep
  assert.deepEqual(subsequence('ZC', 'zorca'), [0, 3]); // rename: keep
  assert.equal(subsequence('zx', 'zorca'), null); // rename: keep
  assert.equal(subsequence('ca', 'zorc'), null); // rename: keep
  assert.deepEqual(subsequence('', 'zorca'), []); // rename: keep
});

test('the field whose match starts earliest wins, the first listed on a tie', () => {
  const s = session('api', { cwd: 'C:\\work\\api', branch: 'main', lastPrompt: 'fix the login page' });
  assert.deepEqual(matchSession(s, 'login')?.field, 'prompt');
  // 'api' starts at 0 in the name and at 8 in the folder.
  assert.deepEqual(matchSession(s, 'api'), { field: 'name', text: 'api', indices: [0, 1, 2] });
  // 'ma' starts at 0 in the branch and nowhere earlier.
  assert.equal(matchSession(s, 'ma')?.field, 'branch');
  assert.equal(matchSession(s, 'zzz'), null);
  assert.equal(matchSession(session('x', { branch: null, lastPrompt: null }), 'q'), null);
});

test('an empty query keeps every session in the order given', () => {
  const rows = rankSessions([session('b'), session('a')], '  ');
  assert.deepEqual(
    rows.map((r) => r.session.id),
    ['b', 'a'],
  );
  assert.ok(rows.every((r) => r.match === null));
});

test('a query keeps the matches, earliest start first, then most recently active', () => {
  const rows = rankSessions(
    [
      session('old-web', { lastEventAt: 100 }),
      session('new-web', { lastEventAt: 900 }),
      session('web', { lastEventAt: 500 }),
      session('db'),
    ],
    'web',
  );
  assert.deepEqual(
    rows.map((r) => r.session.id),
    ['web', 'new-web', 'old-web'],
  );
});

test('segments join adjacent hits so the bold runs are few', () => {
  assert.deepEqual(segments('zorca', [0, 1, 3]), [ // rename: keep
    { text: 'zo', hit: true },
    { text: 'r', hit: false },
    { text: 'c', hit: true },
    { text: 'a', hit: false },
  ]);
  assert.deepEqual(segments('ab', []), [{ text: 'ab', hit: false }]);
});

test('the highlight wraps at both ends and stays put on an empty list', () => {
  assert.equal(moveHighlight(0, -1, 3), 2);
  assert.equal(moveHighlight(2, 1, 3), 0);
  assert.equal(moveHighlight(1, 1, 3), 2);
  assert.equal(moveHighlight(0, 1, 0), 0);
});

// M9 fix 201: the picker opens on the sessions waiting for a person, in
// the jump key's order, and says how long each has waited.
test('an empty query puts the waiting sessions first in wait order and the rest in sidebar order', () => {
  const sessions = [
    session('a'),
    session('b', { state: 'done', stateSince: 5000 }),
    session('c', { state: 'needs-input', stateSince: 8000 }),
    session('d'),
    session('e', { state: 'needs-input', stateSince: 2000 }),
  ];
  const wanting = new Set(['b', 'c', 'e']);
  assert.deepEqual(
    orderRows(sessions, wanting).map((s) => s.id),
    ['e', 'c', 'b', 'a', 'd'],
  );
  assert.deepEqual(
    orderRows(sessions, new Set()).map((s) => s.id),
    ['a', 'b', 'c', 'd', 'e'],
  );
  assert.equal(waitText(sessions[4]!, wanting, 2000 + 4 * 60_000), '4m');
  assert.equal(waitText(sessions[0]!, wanting, 9000), null);
});

// M9 fix 202: the action mode. Typing > first lists the bindings by label
// with their chords, the fuzzy match on the label with its hits, then the
// focused pane's menu items no key reaches, naming the pane's session.
test('>spl lists the two splits with their chords first and the pane group after', () => {
  const pane = { name: 'emerald', items: sessionPaneMenu({ session: session('emerald', { kind: 'claude' }), sessionId: 'emerald', zoomed: false, onlyPane: false, splitKind: 'claude', atDefaultFontSize: true }) };
  assert.equal(isActionQuery('>spl'), true);
  assert.equal(isActionQuery('spl'), false);
  const rows = actionRows('>spl', 'Ctrl+B', pane);
  assert.deepEqual(
    rows.filter((r) => r.kind === 'key').map((r) => r.label),
    ['Split right', 'Split down'],
  );
  assert.equal(rows[0]?.detail, 'Ctrl+Shift+E · Ctrl+B E');
  assert.deepEqual(rows[0]?.match, { field: 'name', text: 'Split right', indices: [0, 1, 2] });
  // Nothing in the pane's own items has s, p, l in order.
  assert.deepEqual(rows.filter((r) => r.kind === 'pane'), []);
  // An empty action query lists every binding, then the pane's items.
  const all = actionRows('>', 'Ctrl+B', pane);
  assert.equal(all.filter((r) => r.kind === 'key').length, BINDINGS.length);
  assert.deepEqual(
    all.filter((r) => r.kind === 'pane').map((r) => [r.kind === 'pane' ? r.run : '', r.label, r.detail]),
    [
      ['new-claude', 'New Claude session here', 'emerald'],
      ['rename', 'Rename session', 'emerald'],
      ['close-session', 'Close session', 'emerald'],
    ],
  );
  assert.ok(all.every((r) => r.match === null));
  // A pane match: the hits are on the pane row's label and the key rows come first.
  const ren = actionRows('>rena', 'Ctrl+B', pane);
  // M9 fix 689: Chat or terminal has r, e, n, a in order too, a key row.
  assert.deepEqual(ren.map((r) => r.label), ['Chat or terminal', 'Rename session']);
  assert.equal(ren[0]?.kind, 'key');
  assert.equal(ren[1]?.kind, 'pane');
  // No pane: the keys alone.
  assert.ok(actionRows('>', 'Ctrl+B', null).every((r) => r.kind === 'key'));
  // A prefix-only binding shows the prefix chord alone.
  const layout = BINDINGS.find((b) => b.action === 'new-layout-tab')!;
  assert.equal(chordsText(layout, 'Ctrl+B'), 'Ctrl+B C');
});

// M9 fix 647: a shell past the default is a pane row naming its shell.
test('>git lists New Git Bash here in the pane group with its shell', () => {
  const others = [{ id: 'gitbash', label: 'Git Bash', file: 'bash.exe' }, { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe' }] as const;
  const pane = { name: 'emerald', items: sessionPaneMenu({ session: session('emerald', { kind: 'claude' }), sessionId: 'emerald', zoomed: false, onlyPane: false, splitKind: 'claude', atDefaultFontSize: true, others }) };
  const git = actionRows('>git', 'Ctrl+B', pane).filter((r) => r.kind === 'pane');
  assert.equal(git.length, 1);
  assert.deepEqual(git[0], { kind: 'pane', run: 'new-shell', shell: 'gitbash', label: 'New Git Bash here', detail: 'emerald', match: git[0]!.match });
  assert.deepEqual(
    actionRows('>', 'Ctrl+B', pane).filter((r) => r.kind === 'pane').map((r) => r.label),
    ['New Git Bash here', 'New Command Prompt here', 'New Claude session here', 'Rename session', 'Close session'],
  );
});
