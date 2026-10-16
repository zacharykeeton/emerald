import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo } from '@emerald/shared';
import { closeTitle, hideTitle, menuHint, paneOnlyItems, sessionPaneMenu, viewPaneMenu } from './pane-menu-model.ts';
import { aSession } from './test-support.ts';

const session = (over: Partial<SessionInfo> = {}): SessionInfo => aSession({ id: 's1', kind: 'claude', name: 'emerald', cwd: 'C:\\work\\emerald', ...over });

// M9 fix 202: the menu's items as one list, the items with a key naming
// their binding so the palette lists them under Keys and only the rest
// under Pane.
test('a session pane lists the menu in order, the key items naming their bindings', () => {
  const items = sessionPaneMenu({ session: session(), sessionId: 's1', zoomed: false, onlyPane: false, splitKind: 'shell', atDefaultFontSize: true });
  assert.deepEqual(
    items.map((i) => i.label),
    ['Split right', 'Split down', 'Focus', 'Reset text size', 'New shell here', 'New Claude session here', 'Rename session', 'Show a session here', 'Find in scrollback', 'Review changes', 'Hide pane', 'Close session'],
  );
  assert.equal(items.find((i) => i.run === 'split-right')?.action, 'split-vertical');
  assert.equal(items.find((i) => i.run === 'split-right')?.title, 'A shell in this folder, beside');
  assert.equal(items.find((i) => i.run === 'split-down')?.title, 'A shell in this folder, below');
  assert.equal(menuHint(items.find((i) => i.run === 'split-right')!), 'Ctrl+Shift+E');
  assert.equal(menuHint(items.find((i) => i.run === 'rename')!), undefined);
  // M9 fix 390: always shown, disabled at the default with a title saying
  // so, and listed under Keys since it doubles the Ctrl+0 chord.
  assert.equal(menuHint(items.find((i) => i.run === 'text-reset')!), 'Ctrl+0');
  assert.equal(items.find((i) => i.run === 'text-reset')?.disabled, true);
  assert.equal(items.find((i) => i.run === 'text-reset')?.title, 'Already at 14 px');
  const changed = sessionPaneMenu({ session: session(), sessionId: 's1', zoomed: false, onlyPane: false, splitKind: 'shell', atDefaultFontSize: false });
  assert.equal(changed.find((i) => i.run === 'text-reset')?.disabled, false);
  assert.equal(changed.find((i) => i.run === 'text-reset')?.title, undefined);
  assert.deepEqual(
    paneOnlyItems(items).map((i) => i.run),
    ['new-claude', 'rename', 'close-session'],
  );
  assert.equal(items.find((i) => i.run === 'new-shell')?.separator, true);
  assert.equal(items.find((i) => i.run === 'close-session')?.title, 'Close: kill emerald and close the pane; it waits under exited for 10 seconds, where Resume brings it back, then leaves the list');
  // The default's Claude, so the title changes though the label does not.
  const claudeDefault = sessionPaneMenu({ session: session(), sessionId: 's1', zoomed: false, onlyPane: false, splitKind: 'claude', atDefaultFontSize: true });
  assert.equal(claudeDefault.find((i) => i.run === 'split-right')?.title, 'A Claude in this folder, beside');
  assert.equal(claudeDefault.find((i) => i.run === 'split-right')?.label, 'Split right');
});

test('an empty pane offers no review or close session, says Close pane, and its only pane has nothing to close', () => {
  const items = sessionPaneMenu({ session: undefined, sessionId: null, zoomed: false, onlyPane: true, splitKind: 'shell', atDefaultFontSize: true });
  assert.ok(!items.some((i) => i.run === 'review' || i.run === 'close-session'));
  const hide = items.find((i) => i.run === 'hide')!;
  assert.equal(hide.label, 'Close pane');
  assert.equal(hide.disabled, true);
  assert.equal(hide.title, 'Nothing to close');
  assert.equal(items.find((i) => i.run === 'zoom')?.disabled, true);
  assert.equal(items.find((i) => i.run === 'rename')?.disabled, true);
  // Always on show, even on an empty pane: its size is its own.
  assert.equal(items.find((i) => i.run === 'text-reset')?.disabled, true);
  // No session, so the split titles drop the folder.
  assert.equal(items.find((i) => i.run === 'split-right')?.title, 'A shell beside');
  assert.equal(items.find((i) => i.run === 'split-down')?.title, 'A shell below');
  // Rename is disabled, so the palette's Pane group would list only the
  // Claude session; the palette leaves the group out for an empty pane.
  assert.deepEqual(
    paneOnlyItems(items).map((i) => i.run),
    ['new-claude'],
  );
  assert.equal(sessionPaneMenu({ session: session(), sessionId: 's1', zoomed: true, onlyPane: true, splitKind: 'shell', atDefaultFontSize: true }).find((i) => i.run === 'zoom')?.label, 'Unfocus');
});

test('a view pane offers its own items first: the chrome toggle, the file as a tab, the folder', () => {
  const commits = viewPaneMenu({ kind: 'commits', folder: 'C:\\work', zoomed: false, onlyPane: false, chrome: true, stateKept: true, splitKind: 'shell' });
  assert.deepEqual(
    commits.map((i) => i.label),
    ['Hide the chrome', 'Split right', 'Split down', 'Focus', 'Set folder…', 'Show a session here', 'Close pane'],
  );
  assert.equal(commits.find((i) => i.run === 'split-right')?.title, 'A shell in this folder, beside');
  assert.deepEqual(
    paneOnlyItems(commits).map((i) => i.run),
    ['toggle-chrome', 'set-folder'],
  );
  const old = viewPaneMenu({ kind: 'activity', folder: null, zoomed: false, onlyPane: false, chrome: false, stateKept: false, splitKind: 'claude' });
  assert.equal(old[0]?.label, 'Split right', 'no chrome item on a daemon that does not keep the flag');
  assert.equal(old.find((i) => i.run === 'split-right')?.title, 'A Claude beside', 'the folderless form, on the Claude default');
  assert.ok(!old.some((i) => i.run === 'set-folder'));
  assert.equal(old.find((i) => i.run === 'pick')?.separator, true);
  const file = viewPaneMenu({ kind: 'file', folder: null, zoomed: false, onlyPane: false, chrome: true, stateKept: true, splitKind: 'shell' });
  assert.equal(file[0]?.run, 'open-as-tab');
  assert.equal(file.find((i) => i.run === 'hide')?.title, 'Close this pane; the file stays in the rail');
});

test('the close and hide tooltips', () => {
  assert.equal(closeTitle(undefined, true), 'Nothing to close');
  assert.equal(closeTitle(session({ kind: 'shell' }), true), 'Close: kill emerald and leave the pane empty');
  assert.equal(closeTitle(session({ state: 'exited' }), false), 'Close: forget emerald and close the pane');
  assert.equal(hideTitle(false, true), "Close this pane (Ctrl+Shift+W); the view can be opened again from the rail's Activity tab");
  assert.equal(hideTitle(true, false), 'Empty this pane (Ctrl+Shift+W); the session keeps running and stays in the sidebar');
});

// M9 fix 537: a split gives an empty pane by default, whatever the folder.
test('the Split items say an empty pane on the empty default', () => {
  for (const s of [session(), undefined]) {
    const items = sessionPaneMenu({ session: s, sessionId: s?.id ?? null, zoomed: false, onlyPane: false, splitKind: 'empty', atDefaultFontSize: true });
    assert.equal(items.find((i) => i.run === 'split-right')?.title, 'An empty pane beside');
    assert.equal(items.find((i) => i.run === 'split-down')?.title, 'An empty pane below');
  }
  const view = viewPaneMenu({ kind: 'commits', folder: 'C:\work', zoomed: false, onlyPane: false, chrome: true, stateKept: true, splitKind: 'empty' });
  assert.equal(view.find((i) => i.run === 'split-right')?.title, 'An empty pane beside');
  assert.equal(view.find((i) => i.run === 'split-down')?.title, 'An empty pane below');
});

test('a browser pane has no chrome item and no Open as a tab, and its close says the page goes (M9 fix 659)', () => {
  const page = viewPaneMenu({ kind: 'browser', folder: null, zoomed: false, onlyPane: false, chrome: true, stateKept: true, splitKind: 'shell' });
  assert.deepEqual(page.map((i) => i.label), ['Split right', 'Split down', 'Focus', 'Show a session here', 'Close pane']);
  assert.equal(page.at(-1)!.title, 'Close this pane and its page');
});

// M9 fix 647: the installed shells past the default are items of the
// list, so the menu's Other shell here and the palette read one list.
test('others add a New <shell> here item each after New shell here, none without', () => {
  const gitbash = { id: 'gitbash', label: 'Git Bash', file: 'bash.exe' } as const;
  const cmd = { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe' } as const;
  const base = { session: session(), sessionId: 's1', zoomed: false, onlyPane: false, splitKind: 'shell', atDefaultFontSize: true } as const;
  const items = sessionPaneMenu({ ...base, others: [gitbash, cmd] });
  const labels = items.map((i) => i.label);
  assert.deepEqual(labels.slice(4, 8), ['New shell here', 'New Git Bash here', 'New Command Prompt here', 'New Claude session here']);
  assert.deepEqual(items[5], { run: 'new-shell', shell: 'gitbash', label: 'New Git Bash here', action: null, title: 'Git Bash, bash.exe' });
  assert.deepEqual(
    paneOnlyItems(items).map((i) => i.run),
    ['new-shell', 'new-shell', 'new-claude', 'rename', 'close-session'],
  );
  assert.deepEqual(sessionPaneMenu(base).map((i) => i.label), sessionPaneMenu({ ...base, others: [] }).map((i) => i.label));
  assert.equal(sessionPaneMenu(base).some((i) => i.shell !== undefined), false);
});
