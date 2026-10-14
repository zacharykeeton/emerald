// M5 acceptance, part 2: tmux-style keys. Ctrl+B then a letter drives the
// same actions as the Ctrl+Shift chords, which still work; the prefix shows
// an indicator while armed and Escape cancels it; Ctrl+B twice sends one
// literal Ctrl+B to the shell; Tab and
// Shift+Tab cycle focus; z zooms the focused pane over the whole window
// without touching the layout or the hidden terminals' sizes, and a focus
// move ends the zoom; ? opens the cheat sheet; and a prefix from
// ~/.emerald/config.json takes over after a reload; the jump palette (M21)
// and the find bar (M26) are driven at the end. Starts from an empty
// layout, so run it when no Emerald app is open.
// M9 fix 202: the same box in its action mode. > typed first lists the
// bindings by label with their chords (the prefix as configured) and the
// letters after it filter them; Enter runs the row; Ctrl+Shift+P opens
// it in that mode; the focused pane's menu items no key reaches make a
// Pane group naming its session, absent while the focused pane is empty.
// Run: npm run verify:prefix -w @emerald/app
//
// (The literal Ctrl+B is checked through the shell: Windows PowerShell
// leaves Ctrl+B unbound and echoes it as ^B, so "Write-Output 12", prefix
// twice, "0" shows one ^B and prints 120; pwsh with PSReadLine would move
// the cursor back and print 102 instead. Either way exactly one arrived.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALT, CTRL, SHIFT, expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, startSession, step, stopDaemon, emeraldHome, zreq } from './cdp.mjs';

setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 60 s');
  process.exit(3);
}, 60000);

const configPath = path.join(emeraldHome, 'config.json');
// The user's own config is put back whatever happens below.
const savedConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath) : null;
const restoreConfig = () => {
  if (savedConfig === null) fs.rmSync(configPath, { force: true });
  else fs.writeFileSync(configPath, savedConfig);
};
fs.rmSync(configPath, { force: true });

const focusedIs = (id) => `document.querySelector('.pane.focused')?.dataset.paneId === ${JSON.stringify(id)}`;
const armed = (s) => s.evalJs(`!!document.querySelector('.prefix-armed')`);
const visiblePanes = (s) => s.evalJs(`[...document.querySelectorAll('.pane')].filter(p => p.offsetParent !== null).map(p => p.dataset.paneId)`);
const termCols = (s, paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host')?.emeraldTerm?.cols ?? null`);
const paneWidth = (s, paneId) => s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]').getBoundingClientRect().width`);
const mainWidth = (s) => s.evalJs(`document.querySelector('.splitview').getBoundingClientRect().width`);
const prefix = (s) => s.key('b', 'KeyB', 66, CTRL);
const read = async (s, id) => Buffer.from((await zreq(s, 'session.read', { sessionId: id })).data, 'base64').toString();

// The split that holds a pane directly, or null.
function findHolder(node, paneId) {
  if (node.kind !== 'split') return null;
  if ((node.first.kind === 'pane' && node.first.id === paneId) || (node.second.kind === 'pane' && node.second.id === paneId)) return node;
  return findHolder(node.first, paneId) ?? findHolder(node.second, paneId);
}

const home = os.homedir();
// Shell C's folder; removed once the daemon is down and nothing sits in it.
let jumpDir = null;
let s = await launch(freshPort(), { freshState: true });
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await startSession(s, { kind: 'shell', cwd: home });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell A');
  await sleep(800);
  const p1 = leaves(await getLayout(s))[0];

  // Prefix then e: indicator while armed, split when the letter lands.
  await prefix(s);
  await s.waitFor(`!!document.querySelector('.prefix-armed')`, 'prefix indicator');
  await s.key('e', 'KeyE', 69);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes after prefix e');
  expect(!(await armed(s)), 'indicator gone after the action');
  let l = await getLayout(s);
  expect(l.root.kind === 'split' && l.root.direction === 'row', 'row split');
  const p2 = leaves(l)[1];
  expect(l.focusedPaneId === p2.id, 'new pane focused');
  step('Ctrl+B e split side by side, with the indicator shown while armed');
  await startSession(s, { kind: 'shell', cwd: repoRoot });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'shell B');
  await sleep(800);
  const B = leaves(await getLayout(s))[1].sessionId;

  // Prefix then o stacks a third pane under pane 2; prefix then Escape does nothing.
  await prefix(s);
  await s.key('o', 'KeyO', 79);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'three panes after prefix o');
  l = await getLayout(s);
  const p3 = leaves(l)[2];
  expect(l.root.second.kind === 'split' && l.root.second.direction === 'column' && l.focusedPaneId === p3.id, 'column split, pane 3 focused');
  await prefix(s);
  await s.waitFor(`!!document.querySelector('.prefix-armed')`, 'armed again');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.prefix-armed')`, 'Escape disarmed');
  await sleep(200);
  expect((await getLayout(s)).revision === l.revision, 'Escape changed nothing');
  step('Ctrl+B o stacked a pane; Ctrl+B Escape cancelled');

  // Focus: prefix arrows, prefix Tab both ways, and the plain Ctrl+Tab chords.
  await prefix(s);
  await s.key('ArrowLeft', 'ArrowLeft', 37);
  await s.waitFor(focusedIs(p1.id), 'prefix Left to pane 1');
  await prefix(s);
  await s.key('Tab', 'Tab', 9);
  await s.waitFor(focusedIs(p2.id), 'prefix Tab to pane 2');
  await prefix(s);
  await s.key('Tab', 'Tab', 9, SHIFT);
  await s.waitFor(focusedIs(p1.id), 'prefix Shift+Tab back to pane 1');
  await prefix(s);
  await s.key('Tab', 'Tab', 9, SHIFT);
  await s.waitFor(focusedIs(p3.id), 'prefix Shift+Tab wraps to pane 3');
  await s.key('Tab', 'Tab', 9, CTRL);
  await s.waitFor(focusedIs(p1.id), 'Ctrl+Tab wraps to pane 1');
  await s.key('Tab', 'Tab', 9, CTRL | SHIFT);
  await s.waitFor(focusedIs(p3.id), 'Ctrl+Shift+Tab back to pane 3');
  await s.key('ArrowUp', 'ArrowUp', 38, ALT);
  await s.waitFor(focusedIs(p2.id), 'Alt+Up still works');
  step('cycle focus: prefix Tab, prefix Shift+Tab, Ctrl+Tab and Ctrl+Shift+Tab, wrapping both ways');

  // Zoom pane 2: it fills the window, the others hide, the layout is
  // untouched and the hidden terminals keep their column counts.
  const beforeZoom = await getLayout(s);
  const cols1 = await termCols(s, p1.id);
  const cols2 = await termCols(s, p2.id);
  expect(cols1 !== null && cols2 !== null, 'terminals report columns');
  await prefix(s);
  await s.key('z', 'KeyZ', 90);
  await s.waitFor(`!!document.querySelector('.splitview.zoomed')`, 'zoomed');
  await sleep(400);
  expect(JSON.stringify(await visiblePanes(s)) === JSON.stringify([p2.id]), 'only pane 2 visible');
  const zoomedWidth = await paneWidth(s, p2.id);
  const fullWidth = await mainWidth(s);
  expect(Math.abs(zoomedWidth - fullWidth) < 2, `zoomed pane spans the window: ${zoomedWidth} of ${fullWidth}`);
  const zoomedLayout = await getLayout(s);
  expect(zoomedLayout.revision === beforeZoom.revision && leaves(zoomedLayout).length === 3, 'layout untouched by zoom');
  const cols2Zoomed = await termCols(s, p2.id);
  expect(cols2Zoomed > cols2, `zoomed terminal grew from ${cols2} to ${cols2Zoomed} columns`);
  expect((await termCols(s, p1.id)) === cols1, 'hidden terminal kept its columns');
  await s.screenshot('m5-zoomed.png');
  // Ctrl+Shift+Z toggles it off; the plain chord for zoom works too.
  await s.key('Z', 'KeyZ', 90, CTRL | SHIFT);
  await s.waitFor(`!document.querySelector('.splitview.zoomed')`, 'unzoomed');
  await sleep(400);
  expect((await visiblePanes(s)).length === 3, 'all three panes back');
  expect((await termCols(s, p2.id)) === cols2, `pane 2 refit to its old width: was ${cols2}, zoomed ${cols2Zoomed}, now ${await termCols(s, p2.id)} (pane width ${await paneWidth(s, p2.id)}, pane 1 ${await termCols(s, p1.id)})`);
  // Zoom again, then a focus move ends it, as in tmux.
  await prefix(s);
  await s.key('z', 'KeyZ', 90);
  await s.waitFor(`!!document.querySelector('.splitview.zoomed')`, 'zoomed again');
  await s.key('ArrowLeft', 'ArrowLeft', 37, ALT);
  await s.waitFor(`${focusedIs(p1.id)} && !document.querySelector('.splitview.zoomed')`, 'focus move ended the zoom');
  step(`zoom: pane 2 filled ${fullWidth}px at ${cols2Zoomed} columns, pane 1 stayed at ${cols1}; unzoom and focus-move both restore`);

  // Prefix twice sends one literal Ctrl+B. Windows PowerShell leaves Ctrl+B
  // unbound and echoes it as ^B, so the line shows exactly one ^B and the
  // command still runs.
  await s.key('ArrowRight', 'ArrowRight', 39, ALT);
  await s.waitFor(focusedIs(p2.id), 'pane 2 focused for typing');
  await s.type('Write-Output 12');
  await prefix(s);
  await s.waitFor(`!!document.querySelector('.prefix-armed')`, 'armed before the second prefix');
  await prefix(s);
  await s.waitFor(`!document.querySelector('.prefix-armed')`, 'second prefix disarmed');
  await s.type('0');
  await s.key('Enter', 'Enter', 13);
  // Echoed as ^B (Windows PowerShell) the output is 120 and the echo shows
  // one ^B; taken as cursor-back (pwsh with PSReadLine) the output is 102.
  await s.waitFor(`(async () => { const r = await window.emerald.request('session.read', { sessionId: ${JSON.stringify(B)} }); const t = atob(r.data); return t.includes('120') || t.includes('102'); })()`, 'shell ran the command', 6000);
  // Counted on the screen, not in the stream: ConPTY repaints the whole
  // screen into the stream after a resize, and a refit landing late after
  // the unzoom above showed the typed line, ^B and all, twice.
  const screen = (await zreq(s, 'pty.screen', { sessionId: B })).rows;
  // Over every row: the pane is narrow enough for the typed line to wrap.
  const echoed = screen.join('').split('^B').length - 1;
  const shown = screen.some((r) => r.trim() === '120') ? '120' : screen.some((r) => r.trim() === '102') ? '102' : null;
  expect((shown === '120' && echoed === 1) || (shown === '102' && echoed === 0), `exactly one Ctrl+B reached the shell (printed ${shown}, echoed ${echoed}, screen ${JSON.stringify(screen.filter((r) => r !== ''))})`);
  step(`Ctrl+B Ctrl+B reached the shell as exactly one Ctrl+B (${echoed === 1 ? 'echoed as ^B' : 'moved the cursor'})`);

  // The cheat sheet lists every action; any key closes it; the plain chord opens it too.
  await prefix(s);
  await s.key('?', 'Slash', 191, SHIFT);
  await s.waitFor(`!!document.querySelector('.cheat-sheet')`, 'cheat sheet open');
  const rows = await s.evalJs(`[...document.querySelectorAll('.cheat-sheet tbody tr')].map(r => r.dataset.action)`);
  for (const a of ['split-vertical', 'split-horizontal', 'close-pane', 'toggle-focus', 'focus-next', 'pick-session', 'new-session', 'toggle-sidebar', 'cheat-sheet', 'open-file']) {
    expect(rows.includes(a), `cheat sheet lists ${a}`);
  }
  expect(await s.evalJs(`document.querySelector('.cheat-sheet').textContent.includes('Prefix is Ctrl+B')`), 'sheet names the prefix');
  // M9 fix 31: the punctuation codes print their character, not their code name.
  const tabKeys = await s.evalJs(`[...document.querySelectorAll('.cheat-sheet tbody tr')].filter(r => r.dataset.action === 'next-tab' || r.dataset.action === 'prev-tab').map(r => r.children[1].textContent)`);
  expect(JSON.stringify(tabKeys) === JSON.stringify([']', '[']), `the tab rows print ] and [ after the prefix, got ${JSON.stringify(tabKeys)}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.cheat-sheet')`, 'cheat sheet closed');
  await s.key('?', 'Slash', 191, CTRL | SHIFT);
  await s.waitFor(`!!document.querySelector('.cheat-sheet')`, 'cheat sheet by plain chord');
  await s.key('q', 'KeyQ', 81);
  await s.waitFor(`!document.querySelector('.cheat-sheet')`, 'any key closes it');
  await sleep(200);
  expect(!/PS [^\n]*>\s*q/.test(await read(s, B)), 'q did not reach the shell');
  step(`cheat sheet: ${rows.length} rows, opened by prefix ? and Ctrl+Shift+?, closed by a key`);

  // Plain chords still work: Ctrl+Shift+W closes pane 3.
  await s.key('ArrowDown', 'ArrowDown', 40, ALT);
  await s.waitFor(focusedIs(p3.id), 'pane 3 focused');
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'Ctrl+Shift+W closed pane 3');
  step('plain Ctrl+Shift chords still work');

  // A configured prefix takes over after a reload: Ctrl+Space then e.
  fs.writeFileSync(configPath, JSON.stringify({ prefixKey: 'Ctrl+Space' }) + '\n');
  await s.send('Page.reload');
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'terminals after reload');
  await s.waitFor(`document.activeElement?.className?.includes('xterm') ?? false`, 'terminal focused after reload');
  await sleep(500);
  await prefix(s);
  await sleep(300);
  expect(!(await armed(s)), 'Ctrl+B no longer arms');
  await s.key(' ', 'Space', 32, CTRL);
  await s.waitFor(`document.querySelector('.prefix-armed')?.textContent.startsWith('Ctrl+Space')`, 'Ctrl+Space arms');
  await s.key('e', 'KeyE', 69);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'Ctrl+Space e split');
  step('prefixKey from config.json replaced Ctrl+B with Ctrl+Space');

  // The jump palette (M21). A third shell in a folder with letters the
  // other two lack, hidden so it is listed and not on screen; Ctrl+J over
  // pane 2 opens the picker with the box focused; the letters leave that
  // one row with the hits in bold; Enter puts it in pane 2. Then prefix j
  // opens it again, the repo folder's name finds shell B (off screen now),
  // and Shift+Enter splits pane 2 with B beside it.
  jumpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jump-qq'));
  await startSession(s, { kind: 'shell', cwd: jumpDir });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 3`, 'shell C');
  await sleep(800);
  const C = leaves(await getLayout(s)).find((p) => p.sessionId !== p1.sessionId && p.sessionId !== B).sessionId;
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'pane C hidden');
  const c2 = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(p2.id)}]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(c2.x, c2.y);
  await s.waitFor(focusedIs(p2.id), 'pane 2 focused for the palette');
  await s.key('j', 'KeyJ', 74, CTRL);
  await s.waitFor(`!!document.querySelector('.picker-overlay') && document.activeElement?.classList.contains('palette-input')`, 'Ctrl+J opened the palette with the box focused');
  expect((await s.evalJs(`document.querySelectorAll('.picker-overlay .session-row').length`)) === 3, 'every session listed before typing');
  await s.type('qq');
  await s.waitFor(`document.querySelectorAll('.picker-overlay .session-row').length === 1 && document.querySelector('.picker-overlay .session-row').dataset.sessionId === ${JSON.stringify(C)}`, 'qq leaves shell C');
  expect((await s.evalJs(`document.querySelectorAll('.picker-overlay .session-row b').length`)) === 1, 'the matched letters are bold');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`!document.querySelector('.picker-overlay')`, 'palette closed by Enter');
  l = await getLayout(s);
  expect(leaves(l).find((p) => p.id === p2.id).sessionId === C, 'Enter showed shell C in pane 2');
  expect(!leaves(l).some((p) => p.sessionId === B), 'shell B is off screen now');
  await s.key(' ', 'Space', 32, CTRL);
  await s.key('j', 'KeyJ', 74);
  await s.waitFor(`!!document.querySelector('.picker-overlay') && document.activeElement?.classList.contains('palette-input')`, 'prefix j opened the palette');
  await s.type(path.basename(repoRoot));
  await s.waitFor(`document.querySelectorAll('.picker-overlay .session-row').length === 1 && document.querySelector('.picker-overlay .session-row').dataset.sessionId === ${JSON.stringify(B)}`, 'the repo folder name leaves shell B');
  await s.key('Enter', 'Enter', 13, SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3 && !document.querySelector('.picker-overlay')`, 'Shift+Enter split');
  l = await getLayout(s);
  const beside = leaves(l).find((p) => p.sessionId === B);
  expect(beside !== undefined && l.focusedPaneId === beside.id, 'B is on screen in the new focused pane');
  const holder = findHolder(l.root, p2.id);
  expect(holder !== null && holder.direction === 'row' && holder.first.kind === 'pane' && holder.first.id === p2.id && holder.second.id === beside.id, 'the new pane sits to the right of pane 2');
  step('jump palette: Ctrl+J and prefix j, typing filtered to one row, Enter showed it, Shift+Enter split beside');

  // Find in scrollback (M26). Shell B, in the focused pane, prints thirty
  // numbered lines; prefix / opens the bar on that pane with its box
  // focused; "line 2" is on eleven of them (2 and 20 to 29), the first
  // selected; Enter and Shift+Enter step; Escape closes the bar and the
  // terminal has the keyboard again; Ctrl+Shift+H opens it too; a split
  // starts without one and the key does nothing on an empty pane.
  const findBar = (paneId) => `document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .find-bar')`;
  const findAt = (paneId, index) => `${findBar(paneId)}?.dataset.count === '11' && ${findBar(paneId)}?.dataset.index === ${JSON.stringify(String(index))}`;
  const findFocused = (paneId) => `!!${findBar(paneId)} && document.activeElement?.classList.contains('find-input')`;
  const fp = beside.id;
  // The Ctrl+B pressed to show it no longer arms went to this shell, so
  // its prompt holds a ^B; Escape is PSReadLine's revert-line.
  await s.key('Escape', 'Escape', 27);
  await sleep(200);
  await s.type('1..30 | % { "line $_" }');
  await s.key('Enter', 'Enter', 13);
  const printed = Date.now();
  while (!(await read(s, B)).includes('line 30') && Date.now() - printed < 10000) await sleep(200);
  expect((await read(s, B)).includes('line 30'), 'shell B printed the lines');
  await sleep(300);
  await s.key(' ', 'Space', 32, CTRL);
  await s.key('/', 'Slash', 191);
  await s.waitFor(findFocused(fp), 'prefix / opened the find bar with its box focused');
  expect((await s.evalJs(`document.querySelectorAll('.find-bar').length`)) === 1, 'one bar, on the focused pane');
  await s.type('line 2');
  await s.waitFor(findAt(fp, 1), '1 of 11 after typing');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(findAt(fp, 2), 'Enter moved to 2 of 11');
  expect((await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(fp)}] .term-host').emeraldTerm.getSelection()`)) === 'line 2', 'the active match is selected in the terminal');
  await s.key('Enter', 'Enter', 13, SHIFT);
  await s.waitFor(findAt(fp, 1), 'Shift+Enter back to 1 of 11');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!${findBar(fp)} && (document.activeElement?.className?.includes('xterm') ?? false)`, 'Escape closed the bar and the terminal has the keyboard');
  await s.key('H', 'KeyH', 72, CTRL | SHIFT);
  await s.waitFor(findFocused(fp), 'Ctrl+Shift+H opened the bar');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'split beside the pane with the bar');
  l = await getLayout(s);
  expect(l.focusedPaneId !== fp, 'the new pane is focused');
  // The split rebuilds the terminal of the pane it split (the tree node
  // changes shape), and the bar goes with it; the new pane has none, and
  // the key does nothing on an empty pane.
  await sleep(300);
  expect((await s.evalJs(`document.querySelectorAll('.find-bar').length`)) === 0, 'no bar after the split');
  await s.key('H', 'KeyH', 72, CTRL | SHIFT);
  await sleep(300);
  expect((await s.evalJs(`document.querySelectorAll('.find-bar').length`)) === 0, 'the key does nothing on an empty pane');
  await s.key('ArrowLeft', 'ArrowLeft', 37, ALT);
  await s.waitFor(focusedIs(fp), 'back to the pane with shell B');
  await s.key('H', 'KeyH', 72, CTRL | SHIFT);
  await s.waitFor(findFocused(fp), 'the bar opens again on the old pane');
  expect((await s.evalJs(`document.querySelectorAll('.find-bar').length`)) === 1, 'one bar');
  step('find in scrollback: prefix / and Ctrl+Shift+H, 1 of 11, Enter and Shift+Enter, Escape back to the terminal, a split without a bar');

  // Ctrl+V pastes (M9 fix 92). The clipboard is written through the
  // preload (the scripts' way in), and shell B, still in the focused
  // pane, takes the paste: a command pasted onto the prompt runs on
  // Enter; a raw-stdin reader that asks for bracketed paste gets a
  // two-line paste as one bracketed chunk (the reader prints what it got
  // as JSON after a quiet 300 ms, since ConPTY may hand it over in
  // pieces); with only an image on the clipboard the reader gets the
  // 0x16 byte a terminal sends for Ctrl+V, which is what Claude Code
  // reads an image on. The reader is written as a file, with no
  // backslash in its source, and quits on a q.
  // The pane is one of four across, so a long line wraps: the screen is
  // read as its rows joined, a soft wrap filling its row exactly. The
  // rows come trimmed, so a space that lands at a row's end is lost in
  // the join, and where the wraps fall depends on the prompt's length,
  // the checkout's path (one worktree's longer folder name put the
  // paste's space at a row end of the 7-column pane); the reads compare
  // with every space removed.
  const bs = String.fromCharCode(92);
  const screenRows = async () => (await zreq(s, 'pty.screen', { sessionId: B })).rows;
  const screenText = async () => (await screenRows()).join('');
  const rowWith = (needles) => `(async () => { const r = await window.emerald.request('pty.screen', { sessionId: ${JSON.stringify(B)} }); const t = r.rows.join('').replace(/ /g, ''); return ${JSON.stringify(needles.map((n) => n.replace(/ /g, '')))}.every(n => t.includes(n)); })()`;
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!${findBar(fp)} && (document.activeElement?.className?.includes('xterm') ?? false)`, 'the bar closed for the paste steps');
  await s.evalJs(`window.emerald.clipboard.write('Write-Output pasted-42')`);
  await s.key('v', 'KeyV', 86, CTRL);
  await s.waitFor(rowWith(['Write-Output pasted-42']), 'Ctrl+V pasted the clipboard text onto the prompt', 6000);
  await s.key('Enter', 'Enter', 13);
  // The echo of the command and its output: the word twice.
  await s.waitFor(`(async () => { const r = await window.emerald.request('pty.screen', { sessionId: ${JSON.stringify(B)} }); return r.rows.join('').split('pasted-42').length >= 3; })()`, 'the pasted command ran and printed', 6000);
  const reader = path.join(os.tmpdir(), `emerald-verify-reader-${process.pid}.mjs`);
  fs.writeFileSync(
    reader,
    [
      "const ESC = String.fromCharCode(27); const NL = String.fromCharCode(10);",
      "let got = ''; let timer = null;",
      "process.stdout.write('READER' + NL + ESC + '[?2004h');",
      "process.stdin.setRawMode(true); process.stdin.resume();",
      "process.stdin.on('data', (d) => { got += d.toString(); clearTimeout(timer); timer = setTimeout(() => { process.stdout.write('GOT' + JSON.stringify(got) + NL); if (got.includes('q')) { process.stdout.write(ESC + '[?2004l'); process.exit(0); } got = ''; }, 300); });",
    ].join('\n'),
  );
  await s.type(`node "${reader}"`);
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(rowWith(['READER']), 'the raw-stdin reader is up', 10000);
  await s.evalJs(`window.emerald.clipboard.write(${JSON.stringify('line1' + String.fromCharCode(10) + 'line2')})`);
  await s.key('v', 'KeyV', 86, CTRL);
  await s.waitFor(rowWith(['GOT"', '[200~line1', 'line2', '[201~"']), 'a two-line paste arrived as one bracketed paste', 6000);
  const bracketed = await screenText();
  expect(bracketed.includes('u001b[200~line1' + bs + 'rline2' + bs + 'u001b[201~'), `the newline went as a CR inside the brackets (${bracketed.slice(bracketed.indexOf('GOT'), bracketed.indexOf('GOT') + 60)})`);
  await s.evalJs("window.__pasteCode = null; document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.keyCode === 86) window.__pasteCode = e.code; }, true)");
  await s.evalJs("window.emerald.clipboard.write('dictated-637')");
  await s.key('v', '', 86, CTRL);
  await s.waitFor(rowWith(['GOT"', '[200~dictated-637', '[201~"']), 'a Ctrl+V with no code (a dictation tool\'s) pasted the clipboard text as one bracketed paste', 6000);
  expect((await s.evalJs('window.__pasteCode')) === '', 'the step sent the Ctrl+V with an empty code, the shape a dictation tool sends');
  await s.evalJs(`window.emerald.clipboard.writeImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')`);
  expect((await s.evalJs(`window.emerald.clipboard.read()`)).image === true, 'the clipboard holds an image and no text');
  await s.key('v', 'KeyV', 86, CTRL);
  await s.waitFor(rowWith(['GOT"' + bs + 'u0016"']), 'with only an image on the clipboard the reader got the Ctrl+V byte', 6000);
  await s.type('q');
  await s.waitFor(rowWith(['GOT"q"']), 'the reader quit on q');
  fs.rmSync(reader, { force: true });
  step('M9 fix 92: Ctrl+V pastes the clipboard text, a two-line paste is one bracketed paste, a Ctrl+V with no code (fix 637) pastes too, an image alone sends the Ctrl+V byte through');

  // M9 fix 202: the action palette. The prefix is Ctrl+Space here, so the
  // chords read as the cheat sheet would print them under that prefix.
  const actionRowsRead = () =>
    s.evalJs(`[...document.querySelectorAll('.picker-overlay .action-row')].map((r) => ({ kind: r.dataset.kind, action: r.dataset.action ?? null, run: r.dataset.run ?? null, shell: r.dataset.shell ?? null, label: r.querySelector('.action-label').textContent, detail: r.querySelector('.action-detail').textContent, bold: r.querySelectorAll('b').length }))`);
  const groupsRead = () => s.evalJs(`[...document.querySelectorAll('.picker-overlay .palette-group')].map((g) => g.textContent)`);
  const panesBefore = await s.evalJs(`document.querySelectorAll('.pane').length`);
  await s.key('j', 'KeyJ', 74, CTRL);
  await s.waitFor(`!!document.querySelector('.picker-overlay') && document.activeElement?.classList.contains('palette-input')`, 'Ctrl+J opened the palette for the action mode');
  await s.type('>spl');
  await s.waitFor(`document.querySelector('.picker-overlay .palette-input')?.dataset.mode === 'actions' && document.querySelectorAll('.picker-overlay .action-row[data-kind="key"]').length === 2`, '> put the box in action mode and spl left two key rows');
  const splits = (await actionRowsRead()).filter((r) => r.kind === 'key');
  expect(JSON.stringify(splits.map((r) => [r.kind, r.action, r.label, r.detail])) === JSON.stringify([['key', 'split-vertical', 'Split right', 'Ctrl+Shift+E · Ctrl+Space E'], ['key', 'split-horizontal', 'Split down', 'Ctrl+Shift+O · Ctrl+Space O']]), `the two splits with their chords under the configured prefix, got ${JSON.stringify(splits)}`);
  expect(splits.every((r) => r.bold === 1), `the matched letters are bold in one run, got ${JSON.stringify(splits.map((r) => r.bold))}`);
  // M9 fix 647: a New <shell> here row (Windows PowerShell has s, p, l in order) may follow the keys on a box with another shell.
  expect((await groupsRead())[0] === 'Keys' && (await actionRowsRead()).filter((r) => r.kind === 'pane').every((r) => r.run === 'new-shell'), `the first group is Keys and every pane row is a new-shell row, got ${JSON.stringify(await groupsRead())}`);
  expect((await s.evalJs(`document.querySelectorAll('.picker-overlay .session-row').length`)) === 0, 'no session rows in action mode');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`!document.querySelector('.picker-overlay') && document.querySelectorAll('.pane').length === ${panesBefore + 1}`, 'Enter ran Split right: the palette closed and a pane was added');
  // The new pane is empty and focused, and an empty pane's box is its
  // own content, not an overlay: Ctrl+Shift+P puts > in that box and
  // lists every binding with no Pane group; Escape empties it again.
  const emptyPane = (await getLayout(s)).focusedPaneId;
  const emptySel = `[data-pane-id=${JSON.stringify(emptyPane)}] .empty-pane`;
  const emptyRowsRead = () =>
    s.evalJs(`[...document.querySelectorAll(${JSON.stringify(emptySel + ' .action-row')})].map((r) => ({ kind: r.dataset.kind, action: r.dataset.action ?? null, detail: r.querySelector('.action-detail').textContent, bold: r.querySelectorAll('b').length }))`);
  await s.key('P', 'KeyP', 80, CTRL | SHIFT);
  await s.waitFor(`document.querySelector(${JSON.stringify(emptySel + ' .palette-input')})?.dataset.mode === 'actions' && document.querySelector(${JSON.stringify(emptySel + ' .palette-input')})?.value === '>'`, "Ctrl+Shift+P put > in the empty pane's box");
  const everyKey = await emptyRowsRead();
  expect(everyKey.length >= 30 && everyKey.every((r) => r.kind === 'key' && r.bold === 0), `every binding listed with nothing bold, got ${everyKey.length} rows`);
  expect(everyKey.some((r) => r.action === 'open-actions' && r.detail === 'Ctrl+Shift+P · Ctrl+Space Shift+:'), `the palette lists its own key, got ${JSON.stringify(everyKey.find((r) => r.action === 'open-actions'))}`);
  const emptyGroups = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(emptySel + ' .palette-group')})].map((g) => g.textContent)`);
  expect(JSON.stringify(emptyGroups) === JSON.stringify(['Keys']), `no Pane group on an empty pane, got ${JSON.stringify(emptyGroups)}`);
  await s.key('Escape', 'Escape', 27);
  // M9 fix 548: a miss here says what the pane looked like, to tell a
  // listener that ran with a stale mode (the box still >, the picker
  // closed) from an Escape that never reached it (the picker still open)
  // or one the global handler spent (the prefix armed, the sheet open).
  try {
    await s.waitFor(`document.querySelector(${JSON.stringify(emptySel + ' .palette-input')})?.value === '' && document.querySelectorAll(${JSON.stringify(emptySel + ' .action-row')}).length === 0`, 'Escape emptied the box and the sessions are listed again');
  } catch {
    const seen = await s.evalJs(`(() => {
      const box = document.querySelector(${JSON.stringify(emptySel + ' .palette-input')});
      return {
        value: box?.value ?? null,
        mode: box?.dataset.mode ?? null,
        rows: document.querySelectorAll(${JSON.stringify(emptySel + ' .action-row')}).length,
        active: document.activeElement?.className ?? null,
        picker: document.querySelector(${JSON.stringify(emptySel)})?.dataset.picker ?? null,
        armed: !!document.querySelector('.prefix-armed'),
        sheet: !!document.querySelector('.cheat-sheet'),
      };
    })()`);
    throw new Error(`timed out waiting for Escape emptied the box and the sessions are listed again, saw ${JSON.stringify(seen)}`);
  }
  // On a pane with a session the Pane group follows, naming the session.
  const fpCentre = await s.evalJs(`(() => { const r = document.querySelector('[data-pane-id=${JSON.stringify(fp)}] .term-host').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(fpCentre.x, fpCentre.y);
  await s.waitFor(focusedIs(fp), 'the pane with shell B focused again');
  const bName = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === B).name;
  await s.key('P', 'KeyP', 80, CTRL | SHIFT);
  await s.waitFor(`document.querySelector('.picker-overlay .palette-input')?.dataset.mode === 'actions' && document.querySelectorAll('.picker-overlay .palette-group').length === 2`, 'the palette on a session pane has two groups');
  expect(JSON.stringify(await groupsRead()) === JSON.stringify(['Keys', 'Pane']), `Keys then Pane, got ${JSON.stringify(await groupsRead())}`);
  const paneRows = (await actionRowsRead()).filter((r) => r.kind === 'pane');
  const offered = (await s.evalJs('window.emerald.daemonInfo()')).shells.slice(1);
  expect(JSON.stringify(paneRows.map((r) => [r.run, r.label])) === JSON.stringify([...offered.map((o) => ['new-shell', `New ${o.label} here`]), ['new-claude', 'New Claude session here'], ['rename', 'Rename session'], ['close-session', 'Close session']]), `the menu items no key reaches, got ${JSON.stringify(paneRows)}`);
  expect(paneRows.every((r) => r.detail === bName), `each names the focused pane's session ${bName}, got ${JSON.stringify(paneRows.map((r) => r.detail))}`);
  // Typing after > filters the pane rows too, the keys first.
  await s.type('ren');
  await s.waitFor(`document.querySelectorAll('.picker-overlay .action-row').length >= 1 && [...document.querySelectorAll('.picker-overlay .action-row')].some((r) => r.dataset.run === 'rename')`, 'ren finds Rename session');
  const renRows = await actionRowsRead();
  expect(renRows.findIndex((r) => r.kind === 'pane') === renRows.filter((r) => r.kind === 'key').length, `the key rows come before the pane rows, got ${JSON.stringify(renRows.map((r) => r.kind))}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.picker-overlay')`, 'Escape closed it');
  step('fix 202: >spl listed the two splits with their chords, Enter split the pane, Ctrl+Shift+P opened the action palette, the Pane group named the focused session and was absent on an empty pane');
  // M9 fix 576: an Escape in another pane leaves an empty pane's > query
  // alone (every mounted empty pane used to read every Escape in the window),
  // and the focus inside the empty pane lets its own Escape through with no
  // picker open. The empty pane and shell B's pane are both up here and no
  // picker is open.
  const emptyBox576 = emptySel + ' .palette-input';
  await s.evalJs(`document.querySelector(${JSON.stringify(emptyBox576)}).focus()`);
  await s.type('>spl');
  await s.waitFor(`document.querySelector(${JSON.stringify(emptyBox576)})?.value === '>spl' && document.querySelector(${JSON.stringify(emptyBox576)})?.dataset.mode === 'actions'`, 'the empty pane box holds >spl');
  await s.click(fpCentre.x, fpCentre.y);
  await s.waitFor(focusedIs(fp), 'shell B focused, the empty pane holding >spl');
  await s.key('Escape', 'Escape', 27);
  await sleep(300);
  const kept576 = await s.evalJs(`document.querySelector(${JSON.stringify(emptyBox576)})?.value ?? null`);
  expect(kept576 === '>spl', `an Escape in shell B's pane left the empty pane's action query alone, got ${JSON.stringify(kept576)}`);
  await s.evalJs(`document.querySelector(${JSON.stringify(emptyBox576)}).focus()`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`document.querySelector(${JSON.stringify(emptyBox576)})?.value === '' && document.querySelectorAll(${JSON.stringify(emptySel + ' .action-row')}).length === 0`, "an Escape in the empty pane's own box emptied it");
  step("M9 fix 576: an Escape in another pane leaves an empty pane's > query alone, and an Escape in the empty pane's own box still empties it");
  await s.screenshot('m5-prefix-final.png');
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m5-prefix-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  restoreConfig();
  s.close();
  killTree(s.child);
  stopDaemon();
  // The shells that had the folder as their cwd take a moment to go after
  // the daemon is stopped, and a folder still held gives EPERM; retry as
  // verify:files does, and a folder that outlasts the retries is only a
  // temp folder, not a failed run.
  if (jumpDir !== null) {
    setTimeout(() => {
      try {
        fs.rmSync(jumpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch (err) {
        console.error(`[verify] temp folder left behind: ${jumpDir} (${err.code ?? err})`);
      }
    }, 300);
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 4000);
}
