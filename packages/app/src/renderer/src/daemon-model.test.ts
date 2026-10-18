import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionInfo, ShellOption } from '@emerald/shared';
import { BROWSER_TOOLBAR_LEVEL, BROWSER_VIEW_LEVEL, CRASHED_TEXT, LEGACY_TAB_ID, TABS_LEVEL, USAGE_FLAG_LEVEL, VIEWS_LEVEL, browserToolbarSupported, browserViewSupported, crashedTitle, daemonLevel, daemonOutdated, layoutForWire, normalizeLayout, normalizeSession, otherHomeText, installedShells, otherShells, outdatedText, tabsSupported, usageFlagSupported, viewsSupported } from './daemon-model.ts';
import { STATS_LEVEL, statsSupported } from './daemon-model.ts';

test('a daemon with no feature level is level 1 and counts as outdated against 2', () => {
  const old = { pid: 7, version: '0.1.0', featureLevel: null, otherHome: null };
  assert.equal(daemonLevel(old), 1);
  assert.equal(daemonOutdated(old, 2), true);
  assert.equal(daemonOutdated({ ...old, featureLevel: 2 }, 2), false);
  assert.equal(daemonOutdated({ ...old, featureLevel: 3 }, 2), false, 'a newer daemon is not a problem the banner knows about');
  assert.equal(daemonOutdated(null, 2), false, 'nothing to say while disconnected');
  assert.match(outdatedText(old, 2), /pid 7.*level 1.*expects 2.*resumed/);
});

test('normalizeSession fills the fields an older daemon does not send and leaves the rest alone', () => {
  const fromOldDaemon = {
    id: 'a',
    kind: 'shell',
    name: 'x',
    autoName: true,
    spawnCwd: 'C:\\x',
    args: [],
    cwd: 'C:\\x',
    state: 'idle',
    stateSince: 1,
    lastEventAt: null,
    stale: false,
    needsInputReason: null,
    errorType: null,
    claudeSessionId: null,
    pid: 1,
    exitCode: null,
    createdAt: 1,
  } as unknown as SessionInfo;
  const filled = normalizeSession(fromOldDaemon);
  assert.equal(filled.branch, null);
  assert.equal(filled.lastPrompt, null);
  assert.equal(filled.lastReply, null);
  assert.equal(filled.model, null);
  assert.equal(filled.contextPercent, null);
  assert.equal(filled.contextWindow, null);
  assert.equal(filled.tokens, null);
  assert.equal(filled.comment, null);
  assert.equal(filled.phase, null);
  assert.equal(filled.color, null);
  assert.equal(filled.title, null);
  assert.deepEqual(filled.team, [], 'a daemon before M46 sent nothing out');
  assert.equal(filled.transcriptPath, null);
  assert.equal(filled.liveReply, null);
  assert.equal(filled.liveTool, null);
  assert.equal(filled.liveVerb, null, 'a daemon before fix 158 read no spinner word');
  assert.deepEqual(filled.commits, [], 'a daemon before M49 recorded no commits');
  assert.equal(filled.startHead, null, 'a daemon before fix 117 knew no start commit');
  assert.equal(filled.lastPromptAt, null, 'a daemon before M73 timed no turn');
  assert.equal(filled.lastReplyAt, null);
  assert.equal(filled.groupCwd, 'C:\\x', 'a daemon before fix 60 groups by the live folder');
  assert.equal(filled.name, 'x');
  assert.equal(filled.shell, null, 'a daemon before fix 624 does not say which shell');
  assert.equal(filled.effort, null, 'a daemon before level 67 (fix 799) sends no effort');
  const current = { ...fromOldDaemon, branch: 'main', lastPrompt: 'p', lastReply: 'r', model: 'Fable', effort: 'high', contextPercent: 42, contextWindow: { size: 200000, used: 84000, cacheRead: 80000, cacheWrite: 3000, fresh: 1000, output: 200 }, tokens: { fresh: 2000, cacheWrite: 6000, cacheRead: 160000, output: 400 }, costUsd: 1.4, comment: 'c', phase: 'todo' as const, color: '#61afef', title: '✳ Claude Code', transcriptPath: 'C:\\t.jsonl', liveReply: 'Reading the log.', liveTool: 'Reading BACKLOG.md', liveVerb: 'Grinding', waitingOn: [], team: [], conversation: null, shell: null, shellCwd: null, remoteSessionId: null, startHead: null, commits: [], lastPromptAt: 7, lastReplyAt: 9, groupCwd: 'C:\\x' };
  assert.deepEqual(normalizeSession(current), current, 'a full record is unchanged');
  assert.equal(normalizeSession({ ...current, state: 'waiting' }).state, 'waiting', 'a known state passes');
  assert.equal(normalizeSession({ ...current, state: 'dreaming' as SessionInfo['state'] }).state, 'idle', 'an unknown state reads as idle');
});

test('an older daemon single tree is read as one tab under a steady id, and edits go back to it as a tree', () => {
  const tree = { root: { kind: 'pane' as const, id: 'p1', sessionId: null, view: null }, focusedPaneId: 'p1', revision: 3 };
  const wrapped = normalizeLayout(tree);
  assert.deepEqual(wrapped, { tabs: [{ id: LEGACY_TAB_ID, name: 'Panes', root: tree.root, focusedPaneId: 'p1' }], currentTabId: LEGACY_TAB_ID, revision: 3 });
  assert.equal(normalizeLayout(wrapped), wrapped, 'a layout with tabs is left as it is');
  const older = { pid: 7, version: '0.1.0', featureLevel: TABS_LEVEL - 1, otherHome: null };
  const newer = { ...older, featureLevel: TABS_LEVEL };
  assert.deepEqual(layoutForWire(wrapped, older), tree, 'the tab on show as the tree an older daemon knows');
  assert.equal(layoutForWire(wrapped, newer), wrapped);
  assert.equal(layoutForWire(wrapped, null), wrapped, 'nothing known about the daemon, so the whole layout');
  assert.equal(tabsSupported(older), false);
  assert.equal(tabsSupported(newer), true);
  assert.equal(tabsSupported(null), false);
});

test('a pane from a daemon before M52 reads view null, a layout that has the field keeps its identity, and views need the level', () => {
  const bare = { tabs: [{ id: 't1', name: 'Panes', root: { kind: 'pane' as const, id: 'p1', sessionId: null } }], currentTabId: 't1', revision: 1 };
  const filled = normalizeLayout(bare as unknown as Parameters<typeof normalizeLayout>[0]);
  assert.deepEqual(filled.tabs[0]!.root, { kind: 'pane', id: 'p1', sessionId: null, view: null });
  assert.equal(normalizeLayout(filled), filled, 'nothing to fill, the same object back');
  const split = {
    tabs: [{ id: 't1', name: 'Panes', root: { kind: 'split' as const, id: 's', direction: 'row' as const, ratio: 0.5, first: { kind: 'pane' as const, id: 'a', sessionId: null, view: null }, second: { kind: 'pane' as const, id: 'b', sessionId: null } }, focusedPaneId: 'a' }],
    currentTabId: 't1',
    revision: 1,
  };
  const half = normalizeLayout(split as unknown as Parameters<typeof normalizeLayout>[0]);
  const root = half.tabs[0]!.root;
  assert.equal(root.kind === 'split' && root.first, split.tabs[0]!.root.first, 'a node already carrying the field is the same object');
  assert.deepEqual(root.kind === 'split' && root.second, { kind: 'pane', id: 'b', sessionId: null, view: null });
  const older = { pid: 7, version: '0.1.0', featureLevel: VIEWS_LEVEL - 1, otherHome: null };
  assert.equal(viewsSupported(older), false);
  assert.equal(viewsSupported({ ...older, featureLevel: VIEWS_LEVEL }), true);
  assert.equal(viewsSupported(null), false);
});

test('a daemon on another home is named with both homes (M9 fix 495)', () => {
  const d = { pid: 7, version: '0.1.494', featureLevel: 57, otherHome: { theirs: 'C:\\elsewhere', mine: 'C:\\mine' } };
  assert.equal(otherHomeText(d), "emmerd on another home: it serves C:\\elsewhere, and this window's home is C:\\mine. Its sessions and layout belong to that home.");
});

test('the other shells are the reported ones past the default, on a daemon at level 61 alone (M9 fix 624)', () => {
  const pwsh: ShellOption = { id: 'pwsh', label: 'PowerShell', file: 'pwsh.exe' };
  const powershell: ShellOption = { id: 'powershell', label: 'Windows PowerShell', file: 'powershell.exe' };
  const cmd: ShellOption = { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe' };
  assert.deepEqual(otherShells(null), []);
  assert.deepEqual(otherShells({ pid: 7, version: '0.1.608', featureLevel: 60, otherHome: null, shells: [pwsh, powershell, cmd] }), []);
  assert.deepEqual(otherShells({ pid: 7, version: '0.1.620', featureLevel: 61, otherHome: null, shells: [pwsh, powershell, cmd] }), [powershell, cmd]);
  assert.deepEqual(otherShells({ pid: 7, version: '0.1.620', featureLevel: 61, otherHome: null }), []);
});

test('a browser pane is offered from level 62 on (M9 fix 659)', () => {
  const older = { pid: 7, version: '0.1.0', featureLevel: BROWSER_VIEW_LEVEL - 1, otherHome: null };
  assert.equal(BROWSER_VIEW_LEVEL, 62);
  assert.equal(browserViewSupported(older), false);
  assert.equal(browserViewSupported({ ...older, featureLevel: BROWSER_VIEW_LEVEL }), true);
  assert.equal(browserViewSupported(null), false);
});

test('the usage flag is kept from level 65 on (M9 fix 766)', () => {
  const older = { pid: 7, version: '0.1.0', featureLevel: USAGE_FLAG_LEVEL - 1, otherHome: null };
  assert.equal(USAGE_FLAG_LEVEL, 65);
  assert.equal(usageFlagSupported(older), false);
  assert.equal(usageFlagSupported({ ...older, featureLevel: USAGE_FLAG_LEVEL }), true);
  assert.equal(usageFlagSupported(null), false);
});

test('the Statistics tab is offered from level 70 on (M9 fix 836)', () => {
  const older = { pid: 7, version: '0.1.0', featureLevel: 69, otherHome: null };
  assert.equal(STATS_LEVEL, 70);
  assert.equal(statsSupported(older), false);
  assert.equal(statsSupported({ ...older, featureLevel: 70 }), true);
  assert.equal(statsSupported(null), false);
});

test('the browser toolbar flag is kept from level 71 on (M9 fix 839)', () => {
  const older = { pid: 7, version: '0.1.0', featureLevel: BROWSER_TOOLBAR_LEVEL - 1, otherHome: null };
  assert.equal(BROWSER_TOOLBAR_LEVEL, 71);
  assert.equal(browserToolbarSupported(older), false);
  assert.equal(browserToolbarSupported({ ...older, featureLevel: BROWSER_TOOLBAR_LEVEL }), true);
  assert.equal(browserToolbarSupported(null), false);
});

test('the installed shells are all the reported ones, on a daemon at level 61 alone (M9 fix 647)', () => {
  const pwsh: ShellOption = { id: 'pwsh', label: 'PowerShell', file: 'pwsh.exe' };
  const cmd: ShellOption = { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe' };
  assert.deepEqual(installedShells(null), []);
  assert.deepEqual(installedShells({ pid: 7, version: '0.1.608', featureLevel: 60, otherHome: null, shells: [pwsh, cmd] }), []);
  assert.deepEqual(installedShells({ pid: 7, version: '0.1.620', featureLevel: 61, otherHome: null }), []);
  assert.deepEqual(installedShells({ pid: 7, version: '0.1.620', featureLevel: 61, otherHome: null, shells: [pwsh, cmd] }), [pwsh, cmd]);
});

// M9 fix 815: the crash banner's words are plain; the pid and the code are
// the tooltip's.
test('crashedTitle names the pid and the code, and the banner text names neither', () => {
  assert.equal(crashedTitle({ pid: 17500, code: 'C0000374' }), 'emmerd pid 17500 exited with code 0xC0000374');
  assert.equal(CRASHED_TEXT.includes('0x'), false);
});
