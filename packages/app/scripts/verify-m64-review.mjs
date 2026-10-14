// M64 acceptance: the review tab. A temp repo with a committed file and a
// shell session in it that changes the file; Review changes on the row
// menu opens Review · <session> with the session's mark, the branch line,
// the file list and the diff's two sides; the base chips on a branch off
// main with one commit list the committed file under Since main and not
// under HEAD; a hover on a work tree row shows the + in the margin, a
// click opens the box, Keep counts it, Send review types the prompt into
// the shell and clears the comments; the tab comes back with its
// comments after a close and reopen. Uses a private home and pipe unless
// the environment already names them.
// Run: npm run verify:review -w @emerald/app
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm64-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m64';
const { CTRL, SHIFT, expect, freshPort, getLayout, killTree, launch, leaves, sleep, startSession, step, stopDaemon, zreq } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 180 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 180000);

// The repo: one committed file with enough lines that a comment lands on
// a known line, changed in the work tree before the review opens; then a
// branch with one commit of its own for the base chips.
const repoShort = path.join(os.tmpdir(), 'emerald-verify', `m64-repo-${process.pid}`);
fs.rmSync(repoShort, { recursive: true, force: true });
fs.mkdirSync(repoShort, { recursive: true });
const repo = fs.realpathSync.native(repoShort);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'verify');
git('config', 'user.email', 'verify@example.invalid');
git('config', 'commit.gpgsign', 'false');
const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`).join('\n') + '\n';
fs.writeFileSync(path.join(repo, 'notes.txt'), lines(12, 'base'));
fs.writeFileSync(path.join(repo, 'keep.txt'), 'kept\n');
git('add', '.');
git('commit', '-q', '-m', 'seed');
// The work tree change: line 5 rewritten, a line added after 8.
const changed = lines(12, 'base').split('\n');
changed[4] = 'base line 5 changed';
changed.splice(8, 0, 'an added line');
fs.writeFileSync(path.join(repo, 'notes.txt'), changed.join('\n'));

const s = await launch(freshPort(), { freshState: true });
app = s;

const rowSel = (id) => `.sidebar-row[data-session-id=${JSON.stringify(id)}]`;
const centerOf = (sel) => s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const sessionOf = async (paneId) => {
  const layout = await getLayout(s);
  const pane = leaves(layout).find((p) => p.id === paneId);
  return (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === pane.sessionId);
};
const menuItem = (label) => s.evalJs(`(() => { const b = [...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}); return b ? { disabled: b.disabled, hint: b.querySelector('.menu-hint')?.textContent ?? null, title: b.title } : null; })()`);
const clickMenuItem = (label) => s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
const tab = () => s.evalJs(`(() => { const t = document.querySelector('.review-tab'); return t ? { ...t.dataset } : null; })()`);
const files = () => s.evalJs(`[...document.querySelectorAll('.review-file')].map(f => f.dataset.letter + ' ' + f.dataset.rel + (f.dataset.comments ? ' ▪' + f.dataset.comments : ''))`);
const header = () => s.evalJs(`(() => { const h = document.querySelector('.review-header'); return { name: h.querySelector('.review-name').textContent, branch: h.querySelector('.review-branch').textContent, count: h.querySelector('.review-count').textContent.replace('▪', '').trim(), note: h.querySelector('.review-note')?.textContent ?? null, send: !document.querySelector('.review-send').disabled, chips: [...h.querySelectorAll('.review-chip')].map(c => c.textContent + (c.dataset.on ? '*' : '') + (c.disabled ? ' (disabled)' : '')) }; })()`);
const sides = () => s.evalJs(`(() => { const d = document.querySelector('.review-editor')?.emeraldDiff; if (!d) return null; const m = d.getModel(); return m ? { original: m.original.getValue(), modified: m.modified.getValue(), changes: (d.getLineChanges() ?? []).length } : null; })()`);
const screenHas = async (sessionId, text) => (await zreq(s, 'pty.screen', { sessionId })).rows.some((r) => r.includes(text));
const waitScreen = async (sessionId, text, what) => {
  const until = Date.now() + 10000;
  while (Date.now() < until && !(await screenHas(sessionId, text))) await sleep(200);
  expect(await screenHas(sessionId, text), `${what}; the screen ends ${JSON.stringify((await zreq(s, 'pty.screen', { sessionId })).rows.filter((r) => r.trim() !== '').slice(-12))}`);
};

try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  const p1 = leaves(await getLayout(s))[0].id;
  await startSession(s, { kind: 'shell', cwd: repo });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell in pane 1');
  const shell = await sessionOf(p1);
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel(shell.id))})`, 'the shell row');

  // Review changes on the row menu, with the count as its hint.
  const c = await centerOf(`${rowSel(shell.id)} .sidebar-row-name`);
  await s.rightClick(c.x, c.y);
  await s.waitFor(`document.querySelector('.row-menu')?.dataset.sessionId === ${JSON.stringify(shell.id)}`, 'the row menu');
  await s.waitFor(`[...document.querySelectorAll('.row-menu .menu-item')].some(b => b.querySelector('.menu-label').textContent === 'Review changes' && b.querySelector('.menu-hint'))`, 'the item with its count');
  const item = await menuItem('Review changes');
  expect(item !== null && !item.disabled && item.hint === '1 file', `Review changes offered with 1 file, got ${JSON.stringify(item)}`);
  const labels = await s.evalJs(`[...document.querySelectorAll('.row-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent)`);
  expect(labels.indexOf('Review changes') === labels.indexOf('Open transcript') - 1, `Review changes sits above Open transcript: ${labels.join(', ')}`);
  await clickMenuItem('Review changes');
  await s.waitFor(`document.querySelector('.review-tab')?.dataset.state === 'ready'`, 'the review tab');
  const t = await tab();
  expect(t.sessionId === shell.id && t.base === 'head' && t.files === '1', `the tab is the session's, on HEAD, one file: ${JSON.stringify(t)}`);
  const tabText = await s.evalJs(`document.querySelector('.tab-file[data-review] .tab-name')?.textContent ?? null`);
  expect(tabText !== null && tabText.startsWith(`Review · ${shell.name}`), `the strip's tab is Review · ${shell.name}, got ${tabText}`);
  expect(await s.evalJs(`!!document.querySelector('.tab-file[data-review] .tab-mark')`), 'the tab wears the session mark');
  const h = await header();
  expect(h.name === shell.name && h.branch === '⑂ main · 1 file, +2 −1', `the header names the session and the branch line, got ${JSON.stringify(h)}`);
  expect(h.count === '0 comments' && !h.send, 'no comments yet and Send off');
  expect(h.chips.join('|') === 'HEAD*|Since main (disabled)', `HEAD on and Since main off on main, got ${h.chips.join('|')}`);
  expect((await files()).join(',') === 'M notes.txt', `the file list, got ${(await files()).join(',')}`);
  await s.waitFor(`document.querySelector('.review-diff')?.dataset.state === 'ready'`, 'the diff read');
  await s.waitFor(`!!document.querySelector('.review-editor')?.emeraldDiff?.getModel()`, 'the diff models');
  const sd = await sides();
  expect(sd.original.startsWith('base line 1\nbase line 2') && sd.original.includes('base line 5\n') && sd.modified.includes('base line 5 changed') && sd.modified.includes('an added line'), 'the base side is the commit and the work tree side the file');
  await s.waitFor(`(document.querySelector('.review-editor')?.emeraldDiff?.getLineChanges() ?? []).length === 2`, 'two changes computed');
  await s.screenshot('m64-review.png');
  step('Review changes on the row menu opens the tab with the session, the branch line, the file and the diff');

  // The base chips: a branch off main with one commit of its own, and
  // the work tree change still there. Since main lists the committed
  // file too; HEAD lists only the work tree change.
  git('checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'kept\nand committed on the branch\n');
  git('add', 'keep.txt');
  git('commit', '-q', '-m', 'branch work');
  // Back on the tab, the refresh re-pins to the branch's HEAD.
  await s.evalJs(`document.querySelector('.review-refresh').click()`);
  await s.waitFor(`document.querySelector('.review-branch')?.textContent.startsWith('⑂ feature')`, 'the branch line follows the checkout');
  await s.waitFor(`!document.querySelector('.review-chip[data-base="default"]').disabled`, 'Since main offered on a branch');
  expect((await files()).join(',') === 'M notes.txt', `HEAD lists the work tree change only, got ${(await files()).join(',')}`);
  await s.evalJs(`document.querySelector('.review-chip[data-base="default"]').click()`);
  await s.waitFor(`document.querySelector('.review-tab')?.dataset.base === 'default' && document.querySelectorAll('.review-file').length === 2`, 'Since main lists two files');
  expect((await files()).join(',') === 'M keep.txt,M notes.txt', `Since main lists the committed file too, got ${(await files()).join(',')}`);
  const mergeBase = git('merge-base', 'main', 'HEAD');
  expect((await tab()).baseHash === mergeBase, 'the base is the branch point');
  await s.evalJs(`document.querySelector('.review-chip[data-base="head"]').click()`);
  await s.waitFor(`document.querySelectorAll('.review-file').length === 1`, 'back to HEAD, one file');
  step('Since main on a branch lists the committed file against the branch point; HEAD lists the work tree change');

  // The comments: a hover on a work tree row shows the + in its margin
  // and a press there opens the box under the line. The line's place
  // comes from the editor itself; the hover is a DOM mousemove at it,
  // since a CDP move takes seconds in this build (cdp.mjs).
  await s.waitFor(`!!document.querySelector('.review-editor')?.emeraldDiff?.getModel()`, 'the diff models again');
  const place = (line) =>
    s.evalJs(
      `(() => { const m = document.querySelector('.review-editor').emeraldDiff.getModifiedEditor(); const r = m.getDomNode().getBoundingClientRect(); const p = m.getScrolledVisiblePosition({ lineNumber: ${line}, column: 1 }); const li = m.getLayoutInfo(); return { x: r.left + li.glyphMarginLeft + li.glyphMarginWidth / 2, y: r.top + p.top + p.height / 2, cx: r.left + li.contentLeft + 30 }; })()`,
    );
  const hoverAt = async (line) => {
    const p = await place(line);
    await s.evalJs(`(() => { const el = document.elementFromPoint(${p.cx}, ${p.y}); el.dispatchEvent(new MouseEvent('mousemove', { clientX: ${p.cx}, clientY: ${p.y}, bubbles: true })); })()`);
  };
  await hoverAt(5);
  await s.waitFor(`!!document.querySelector('.review-editor .review-glyph-add') && !!document.querySelector('.review-editor .review-hover-line')`, 'the + in the margin and the tinted row');
  const p5 = await place(5);
  await s.click(p5.x, p5.y);
  await s.waitFor(`document.querySelector('.review-comment-box')?.dataset.line === '5'`, 'the box under line 5');
  await s.waitFor(`document.activeElement?.className === 'review-comment-input'`, 'the box has the keyboard', 3000);
  await s.type('this line changed, say why');
  await s.waitFor(`document.querySelector('.review-count')?.textContent.replace('▪', '').trim() === '1 comment'`, 'the count counts the draft');
  await s.evalJs(`document.querySelector('.review-comment-keep').click()`);
  await s.waitFor(`document.querySelector('.review-comment')?.dataset.line === '5' && !document.querySelector('.review-comment-box')`, 'the comment kept as one row');
  expect((await s.evalJs(`document.querySelector('.review-comment-text').textContent`)) === 'this line changed, say why', 'the kept row shows the text');
  await s.waitFor(`!!document.querySelector('.review-editor .review-glyph-mark')`, 'the blue mark in the margin', 3000);
  expect((await files()).join(',') === 'M notes.txt ▪1', `the file row counts its comment, got ${(await files()).join(',')}`);
  expect((await header()).send, 'Send review is live with a comment');
  // A second comment on the added line, blanked beside base line 8 on
  // the base side; Escape cancels a box; edit reopens one.
  const p9 = await place(9);
  await s.click(p9.x, p9.y);
  await s.waitFor(`document.querySelector('.review-comment-box')?.dataset.line === '9'`, 'the box under line 9');
  await s.waitFor(`document.activeElement?.className === 'review-comment-input'`, 'the second box has the keyboard', 3000);
  await s.type('is this line needed');
  await s.key('Enter', 'Enter', 13, CTRL);
  await s.waitFor(`document.querySelectorAll('.review-comment').length === 2`, 'two kept comments');
  expect((await header()).count === '2 comments', 'two comments counted');
  // The two sides stay aligned: the diff editor blanks the base side by
  // the height of a zone under a work tree line, which the editor's own
  // line tops show (they include the zones above a line). The comment on
  // line 5 (changed one for one) sits beside base line 5, so base 5 to
  // 6 gains the row's 20px as work tree 5 to 6 does; the comment on line
  // 9 (the added line) sits beside base line 8, so base 8 to 9 gains the
  // added line's 18px and the row's 20px.
  const GAPS = `(() => { const d = document.querySelector('.review-editor').emeraldDiff; const o = d.getOriginalEditor(); const m = d.getModifiedEditor(); const g = (e, a, b) => e.getTopForLineNumber(b) - e.getTopForLineNumber(a); return { line: g(o, 6, 7), base56: g(o, 5, 6), base89: g(o, 8, 9), work56: g(m, 5, 6), work910: g(m, 9, 10) }; })()`;
  const gaps = await s.evalJs(GAPS);
  // The alignment follows the zones a moment after they change, so it is waited for.
  await s.waitFor(`${GAPS}.base89 === ${GAPS}.line * 2 + 20`, `the base side blanked beside the added line, got ${JSON.stringify(gaps)}`, 5000);
  const settled = await s.evalJs(GAPS);
  expect(settled.base56 === settled.line + 20 && settled.work56 === settled.line + 20 && settled.base89 === settled.line * 2 + 20 && settled.work910 === settled.line + 20, `the base side is blanked beside each comment, got ${JSON.stringify(settled)}`);
  await s.evalJs(`document.querySelector('.review-comment[data-line="9"] .review-comment-edit').click()`);
  await s.waitFor(`document.querySelector('.review-comment-box')?.dataset.line === '9'`, 'edit reopens the box');
  await s.waitFor(`document.activeElement?.className === 'review-comment-input'`, 'the reopened box has the keyboard', 3000);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.review-comment-box') && document.querySelectorAll('.review-comment').length === 2`, 'Escape closes the box and keeps the comment');
  await s.screenshot('m64-review-comments.png');
  step('a hover shows the + in the margin, a press opens the box, Keep and Ctrl+Enter keep a comment as one row with the base side blanked beside it');

  // The comments live on the session: the tab closed and opened again
  // from the pane's menu finds them; the general comment line grows into
  // its box and counts nothing until written.
  await s.evalJs(`document.querySelector('.tab-file[data-review] .tab-close').click()`);
  await s.waitFor(`!document.querySelector('.review-tab') && !document.querySelector('.tab-file[data-review]')`, 'the tab closed');
  const pc = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(p1)}] .term-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.rightClick(pc.x, pc.y);
  await s.waitFor(`document.querySelector('.pane-menu')?.dataset.paneId === ${JSON.stringify(p1)}`, 'the pane menu');
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Review changes').click()`);
  await s.waitFor(`document.querySelector('.review-tab')?.dataset.state === 'ready' && document.querySelectorAll('.review-comment').length === 2`, 'the tab back from the pane menu with its two comments');
  await s.evalJs(`document.querySelector('.review-general-line').click()`);
  await s.waitFor(`!!document.querySelector('.review-general-box')`, 'the general box');
  await s.type('the tests do not cover the empty file');
  await s.waitFor(`document.querySelector('.review-general-box').value.length > 0`, 'the general comment typed');
  expect((await header()).count === '2 comments', 'the general comment is not counted as a line comment');
  step('the tab closed and reopened from the pane menu keeps its comments; the general line grows into its box');

  // Send review: the prompt lands in the shell as typed text (read off
  // the screen for its first line only, since PowerShell parses the rest
  // as one command and its errors scroll the echo away), the note's
  // tooltip carries the whole prompt in the shape the design gives, the
  // comments clear and the general box folds.
  await s.evalJs(`document.querySelector('.review-send').click()`);
  await waitScreen(shell.id, 'Review of 1 file, against HEAD:', 'the prompt head on the shell screen');
  await s.waitFor(`document.querySelector('.review-sent')?.dataset.outcome === 'sent'`, 'the sent note');
  const sentText = await s.evalJs(`document.querySelector('.review-sent').title`);
  const wanted = ['Review of 1 file, against HEAD:', '', 'notes.txt:5', '    base line 5 changed', 'this line changed, say why', '', 'notes.txt:9', '    an added line', 'is this line needed', '', 'Overall: the tests do not cover the empty file'].join('\n');
  expect(sentText === wanted, `the prompt sent, got ${JSON.stringify(sentText)}`);
  await s.waitFor(`document.querySelectorAll('.review-comment').length === 0 && document.querySelector('.review-count')?.textContent.replace('▪', '').trim() === '0 comments'`, 'the comments cleared');
  expect(await s.evalJs(`!document.querySelector('.review-general-box')`), 'the general box folded');
  expect(!(await header()).send, 'Send off again with nothing to send');
  await s.screenshot('m64-review-sent.png');
  step('Send review types the comments into the session as one prompt and clears them');

  // M9 fix 105: an added file. Its base side is blank (no line numbers,
  // no deletion mark on Monaco's one empty line) and the caption says
  // new file; the work tree side has the text.
  fs.writeFileSync(path.join(repo, 'extra.txt'), 'the only line\n');
  await s.evalJs(`document.querySelector('.review-refresh').click()`);
  await s.waitFor(`[...document.querySelectorAll('.review-file')].some(f => f.dataset.letter === 'A' && f.dataset.rel === 'extra.txt')`, 'the untracked file listed as A');
  await s.evalJs(`[...document.querySelectorAll('.review-file')].find(f => f.dataset.rel === 'extra.txt').click()`);
  await s.waitFor(`document.querySelector('.review-diff')?.dataset.rel === 'extra.txt' && document.querySelector('.review-diff')?.dataset.state === 'ready'`, 'the diff of the added file read');
  await s.waitFor(`document.querySelector('.review-editor')?.emeraldDiff?.getModel()?.modified.getValue().startsWith('the only line')`, 'the work tree side has the text');
  await sleep(300);
  expect(await s.evalJs(`document.querySelector('.review-diff').dataset.newFile === 'true'`), 'the diff is marked a new file');
  const baseCaption = await s.evalJs(`document.querySelector('.review-caption').textContent`);
  expect(baseCaption.endsWith('· new file'), `the base caption reads new file, got ${JSON.stringify(baseCaption)}`);
  const baseSide = await s.evalJs(`(() => { const o = document.querySelector('.review-editor .editor.original'); const del = [...o.querySelectorAll('.line-delete, .char-delete')].filter(el => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)'); return { deletes: del.length, numbers: o.querySelectorAll('.line-numbers').length }; })()`);
  expect(baseSide.deletes === 0 && baseSide.numbers === 0, `the base side draws no deletion and no line number, got ${JSON.stringify(baseSide)}`);
  await s.screenshot('m64-review-new-file.png');
  step('fix 105: an added file reads new file with a blank base side');

  // M9 fix 199: the diff one click from a changed row. The rail's Changed
  // list has notes.txt (M), keep.txt (M once written here) and extra.txt
  // (untracked, no letter, so no target); a click on notes.txt's letter
  // brings the session's tab up on that file, keep.txt's moves the same
  // tab to it. Then a commits view pane opened from the rail takes the
  // focus with no session, and the same click opens the folder's own
  // review: the folder's name, no mark, no state word, no Send, the
  // diff's two sides all the same, and the Review line still offered.
  fs.writeFileSync(path.join(repo, 'keep.txt'), 'kept\nand committed on the branch\nand changed again\n');
  const changedRow = (name) => `[...document.querySelectorAll('.files-changed-row')].find((r) => r.dataset.path === ${JSON.stringify(repo + '\\')} + ${JSON.stringify(name)})`;
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.evalJs(`document.querySelector('.files-changed-toggle').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.changed === 'true' && !!${changedRow('keep.txt')} && ${changedRow('keep.txt')}.querySelector('.git-letter').textContent === 'M'`, 'the Changed list with keep.txt changed', 10000);
  const letterCells = await s.evalJs(`[...document.querySelectorAll('.files-changed-row')].map((r) => { const l = r.querySelector('.git-letter'); return r.querySelector('.files-name').textContent + ':' + l.textContent + ':' + (l.dataset.diff ?? '-') + ':' + (l.title || '-'); }).join(',')`);
  expect(letterCells === 'extra.txt::-:-,keep.txt:M:true:Show the diff,notes.txt:M:true:Show the diff', `the letters of changed files are targets with the tooltip, the untracked one is not: ${letterCells}`);
  const reviewTabs = () => s.evalJs(`[...document.querySelectorAll('.tab-file')].filter((t) => t.querySelector('.tab-name')?.textContent.startsWith('Review ·')).length`);
  await s.evalJs(`${changedRow('notes.txt')}.querySelector('.git-letter').click()`);
  await s.waitFor(`document.querySelector('.review-tab')?.dataset.selected === 'notes.txt' && document.querySelector('.review-tab')?.dataset.sessionId === ${JSON.stringify(shell.id)} && document.querySelector('.review-diff')?.dataset.rel === 'notes.txt'`, "the session's review tab on the clicked file", 10000);
  expect((await reviewTabs()) === 1, 'the one review tab');
  expect((await s.evalJs(`document.querySelectorAll('.file-view').length`)) === 1, 'the letter opened no file tab of its own');
  await s.evalJs(`${changedRow('keep.txt')}.querySelector('.git-letter').click()`);
  await s.waitFor(`document.querySelector('.review-tab')?.dataset.selected === 'keep.txt' && document.querySelector('.review-diff')?.dataset.rel === 'keep.txt'`, 'the second letter moves the selection', 10000);
  expect((await reviewTabs()) === 1, 'still the one tab');
  // A view pane: the rail's Activity tab opens the graph in a pane beside
  // the shell, which takes the focus with no session in it.
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="timeline"]').click()`);
  await s.waitFor(`!!document.querySelector('.commits-open-pane')`, 'the open-in-a-pane button', 10000);
  await s.evalJs(`document.querySelector('.commits-open-pane').click()`);
  await s.waitFor(`document.querySelectorAll('.pane[data-view="commits"]').length === 1`, 'a view pane', 10000);
  const viewLeaf = leaves(await getLayout(s)).find((l) => l.view?.kind === 'commits');
  expect(viewLeaf !== undefined, 'the leaf holds the view');
  await s.waitFor(`(async () => { const l = (await window.emerald.request('layout.get', {})).layout; return l.tabs.find((t) => t.id === l.currentTabId).focusedPaneId === ${JSON.stringify(viewLeaf.id)}; })()`, 'the view pane focused');
  await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
  await s.waitFor(`document.querySelector('.files-rail')?.dataset.root === ${JSON.stringify(repo)} && !!${changedRow('keep.txt')}`, "the rail on the view's folder with the Changed list", 10000);
  const reviewLine = await s.evalJs(`document.querySelector('.files-review-line')?.title ?? null`);
  expect(reviewLine !== null && reviewLine.includes('no session here'), `the Review line is offered with no session, saying so: ${reviewLine}`);
  await s.evalJs(`${changedRow('keep.txt')}.querySelector('.git-letter').click()`);
  await s.waitFor(`document.querySelector('.review-tab')?.dataset.folder === ${JSON.stringify(repo)} && document.querySelector('.review-tab')?.dataset.selected === 'keep.txt' && document.querySelector('.review-tab')?.dataset.state === 'ready'`, "the folder's review tab on the file", 10000);
  expect((await reviewTabs()) === 2, "the folder's tab beside the session's");
  const folderHeader = await s.evalJs(`(() => { const h = document.querySelector('.review-header'); return { name: h.querySelector('.review-name').textContent, mark: !!h.querySelector('.review-mark'), state: !!h.querySelector('.review-state'), send: !!h.querySelector('.review-send'), note: h.querySelector('.review-note')?.textContent ?? null, tab: document.querySelector('.tab-file[data-active] .tab-name')?.textContent ?? null, sessionId: document.querySelector('.review-tab').dataset.sessionId ?? null }; })()`);
  expect(folderHeader.name === path.basename(repo) && !folderHeader.mark && !folderHeader.state, `the header names the folder with no mark and no state word: ${JSON.stringify(folderHeader)}`);
  expect(!folderHeader.send && folderHeader.note !== null && folderHeader.note.includes('No session in this folder'), `no Send, the note says why: ${JSON.stringify(folderHeader)}`);
  expect(folderHeader.tab === `Review · ${path.basename(repo)}` && folderHeader.sessionId === null, `the strip names the folder's tab: ${JSON.stringify(folderHeader)}`);
  await s.waitFor(`document.querySelector('.review-diff')?.dataset.rel === 'keep.txt' && !!document.querySelector('.review-editor')?.emeraldDiff?.getModel()`, "the folder review's diff", 10000);
  // Monaco computes the line changes off the main thread a beat after
  // the models land, so wait for them as the first read above does.
  await s.waitFor(`(document.querySelector('.review-editor')?.emeraldDiff?.getLineChanges() ?? []).length >= 1`, "the folder review's change computed", 10000);
  const folderSides = await sides();
  expect(folderSides !== null && folderSides.original.startsWith('kept\nand committed') && folderSides.modified.includes('and changed again') && folderSides.changes >= 1, `two sides with the change between them: ${JSON.stringify(folderSides)}`);
  await s.screenshot('m9-fix199-folder-review.png');
  step("M9 fix 199: a changed row's letter opens the session's review on that file and moves it to the next; with no session the folder's own review opens, no Send");

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m64-review-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  try {
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Left for the next run.
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
