// M2 acceptance, part 1: keybindings, focus by direction, picker, close and
// drag resize against the built app and a real daemon. Starts from an empty
// layout, so run it when no Emerald app is open. Run: npm run verify:keys -w @emerald/app
import path from 'node:path';
import { ALT, CTRL, SHIFT, clickNewShell, expect, freshPort, getLayout, killTree, launch, leaves, repoRoot, sleep, step, stopDaemon, zreq } from './cdp.mjs';

setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 150 s');
  process.exit(3);
}, 150000);

const s = await launch(freshPort(), { freshState: true });
const focusedIs = (id) => `document.querySelector('.pane.focused')?.dataset.paneId === ${JSON.stringify(id)}`;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane')`, 'empty pane');
  await clickNewShell(s);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'first terminal');
  await sleep(1000);
  const p1 = leaves(await getLayout(s))[0];
  step('pane 1 has a shell');

  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes after Ctrl+Shift+E');
  let l = await getLayout(s);
  expect(l.root.kind === 'split' && l.root.direction === 'row', 'row split');
  expect(l.focusedPaneId === leaves(l)[1].id && leaves(l)[1].sessionId === null, 'new empty pane focused');
  step('Ctrl+Shift+E split side by side and focused the new empty pane');

  await clickNewShell(s, repoRoot);
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'second terminal');
  await sleep(800);
  const p2 = leaves(await getLayout(s))[1];
  expect(typeof p2.sessionId === 'string', 'pane 2 has a session');

  await s.key('O', 'KeyO', 79, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'three panes after Ctrl+Shift+O');
  l = await getLayout(s);
  expect(l.root.second.kind === 'split' && l.root.second.direction === 'column', 'column split under pane 2');
  const p3 = leaves(l)[2];
  expect(l.focusedPaneId === p3.id, 'pane 3 focused');
  step('Ctrl+Shift+O stacked a new pane under pane 2');

  await s.key('ArrowLeft', 'ArrowLeft', 37, ALT);
  await s.waitFor(focusedIs(p1.id), 'Alt+Left to pane 1');
  await s.key('ArrowRight', 'ArrowRight', 39, ALT);
  await s.waitFor(focusedIs(p2.id), 'Alt+Right to pane 2');
  await s.key('ArrowDown', 'ArrowDown', 40, ALT);
  await s.waitFor(focusedIs(p3.id), 'Alt+Down to pane 3');
  await s.key('ArrowUp', 'ArrowUp', 38, ALT);
  await s.waitFor(focusedIs(p2.id), 'Alt+Up to pane 2');
  await s.key('ArrowUp', 'ArrowUp', 38, ALT);
  await sleep(300);
  expect((await getLayout(s)).focusedPaneId === p2.id, 'Alt+Up at the top edge stays put');
  step('Alt+Arrows move focus by geometry and stop at edges');

  const marker = 'EMERALD_KEYS_' + Date.now();
  await s.type(`Write-Output ('OUT:' + '${marker}')`);
  await s.key('Enter', 'Enter', 13);
  await sleep(1500);
  const read = async (id) => Buffer.from((await zreq(s, 'session.read', { sessionId: id })).data, 'base64').toString();
  expect((await read(p2.sessionId)).includes('OUT:' + marker), 'marker in pane 2 shell');
  expect(!(await read(p1.sessionId)).includes(marker), 'no marker in pane 1 shell');
  step('typing after keyboard focus changes lands in the focused terminal only');

  // M9 fix 441: copy out of a shell pane. A known line is printed, selected
  // through the terminal handle, and copied by Ctrl+Shift+C and by a
  // right-click; with nothing selected the key does nothing and a
  // right-click pastes; Ctrl+C with no selection still stops the program.
  // The clipboard is read through the main process, never navigator's.
  const hostOf441 = `document.querySelector(${JSON.stringify(`[data-pane-id="${p2.id}"] .term-host`)})`;
  const clip441 = () => s.evalJs(`window.emerald.clipboard.read().then((c) => c.text)`);
  const setClip441 = (text) => s.evalJs(`window.emerald.clipboard.write(${JSON.stringify(text)})`);
  // M9 fix 493: under a private EMERALD_HOME the window's clipboard is its
  // own and starts empty whatever the box's holds, so a right-click that
  // pastes never brings the person's clipboard into a harness shell.
  expect((await clip441()) === null, "the harness window starts on an empty clipboard of its own (M9 fix 493), not the box's");
  const selection441 = () => s.evalJs(`${hostOf441}.emeraldTerm.getSelection()`);
  const copyLine441 = 'copy-' + Date.now();
  const selectLine441 = () =>
    s.evalJs(`(() => { const t = ${hostOf441}.emeraldTerm; const b = t.buffer.active; for (let y = b.length - 1; y >= 0; y--) { const l = (b.getLine(y)?.translateToString(true) ?? '').trim(); if (l === ${JSON.stringify(copyLine441)}) { t.select(0, y, l.length); return t.getSelection(); } } return null; })()`);
  await s.type(`echo ${copyLine441}`);
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`(() => { const b = ${hostOf441}.emeraldTerm.buffer.active; for (let y = 0; y < b.length; y++) if ((b.getLine(y)?.translateToString(true) ?? '').trim() === ${JSON.stringify(copyLine441)}) return true; return false; })()`, 'the copy line on the screen');
  expect((await selectLine441()) === copyLine441, 'the line is selected through the terminal handle');
  await setClip441('before-441');
  await s.key('C', 'KeyC', 67, CTRL | SHIFT);
  await s.waitFor(`window.emerald.clipboard.read().then((c) => c.text === ${JSON.stringify(copyLine441)})`, 'Ctrl+Shift+C copies the selection', 3000);
  step('Ctrl+Shift+C copied the selected line to the clipboard');

  await setClip441('before-441');
  const mid441 = await s.evalJs(`(() => { const { x, y, width, height } = ${hostOf441}.getBoundingClientRect(); return { x: x + width / 2, y: y + height / 2 }; })()`);
  expect((await selectLine441()) === copyLine441, 'the line is selected again');
  await s.rightClick(mid441.x, mid441.y);
  await s.waitFor(`window.emerald.clipboard.read().then((c) => c.text === ${JSON.stringify(copyLine441)})`, 'a right-click with a selection copies it', 3000);
  expect((await selection441()) === '', `the right-click's copy clears the selection, got ${JSON.stringify(await selection441())}`);
  step('a right-click with a selection copied it and cleared it');

  await s.key('C', 'KeyC', 67, CTRL | SHIFT);
  await sleep(400);
  expect((await clip441()) === copyLine441, 'Ctrl+Shift+C with nothing selected leaves the clipboard alone');
  const pasted441 = 'pasted-' + Date.now();
  await setClip441(pasted441);
  await s.rightClick(mid441.x, mid441.y);
  // The prompt line is read whole, its wrapped rows joined: in a narrow
  // pane the prompt (the checkout's path) pushes the pasted word across
  // the row end, and the cursor's row alone held its tail on the main
  // checkout while a worktree's longer path left it whole on one row.
  const promptLine441 = `(() => { const b = ${hostOf441}.emeraldTerm.buffer.active; let y = b.baseY + b.cursorY; while (y > 0 && b.getLine(y)?.isWrapped) y--; let text = ''; for (let i = y; i <= b.baseY + b.cursorY; i++) text += b.getLine(i)?.translateToString(true) ?? ''; return text; })()`;
  await s.waitFor(`${promptLine441}.includes(${JSON.stringify(pasted441)})`, 'a right-click with nothing selected pastes at the prompt', 3000);
  step('with nothing selected Ctrl+Shift+C did nothing and a right-click pasted');

  // The pasted text is still on the prompt; Ctrl+C there is PowerShell's
  // own line cancel, then again over a running program.
  await s.key('c', 'KeyC', 67, CTRL);
  await sleep(500);
  await s.type('Start-Sleep 30');
  await s.key('Enter', 'Enter', 13);
  await sleep(1500);
  await s.key('c', 'KeyC', 67, CTRL);
  const back441 = 'BACK441_' + Date.now();
  await sleep(800);
  await s.type(`Write-Output ('B:' + '${back441}')`);
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`(() => { const b = ${hostOf441}.emeraldTerm.buffer.active; for (let y = 0; y < b.length; y++) if ((b.getLine(y)?.translateToString(true) ?? '').includes(${JSON.stringify('B:' + back441)})) return true; return false; })()`, 'Ctrl+C stopped Start-Sleep and the prompt came back', 8000);
  step('Ctrl+C with no selection still reached the program');

  // M9 fix 441: copy on select, a setting on the pane menu (fix 491 moved it from the shade button's), off
  // by default. A real drag across the line copies it on release only
  // while the setting is on; the setting is put back off after.
  const toggleCopyOnSelect441 = async () => {
    const opened = await s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(`[data-pane-id="${p2.id}"]`)}); if (!el) return false; const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); return true; })()`);
    expect(opened, "the pane menu opens");
    await s.waitFor(`document.querySelector('.pane-menu')?.dataset.paneId === ${JSON.stringify(p2.id)}`, 'the pane menu');
    const was = await s.evalJs(`(() => { const it = [...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent.replace(/^✓/, '') === 'Copy on select'); if (!it) return null; const on = it.dataset.checked === 'true'; it.click(); return on; })()`);
    expect(was !== null, 'Copy on select is on the menu');
    await s.evalJs(`document.querySelector('.pane-menu') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await s.waitFor(`!document.querySelector('.pane-menu')`, 'the pane menu closed', 3000).catch(() => {});
    return was;
  };
  const dragLine441 = async () => {
    const at = await s.evalJs(`(() => { const t = ${hostOf441}.emeraldTerm; const b = t.buffer.active; const scr = ${hostOf441}.querySelector('.xterm-screen').getBoundingClientRect(); const cw = scr.width / t.cols; const ch = scr.height / t.rows; for (let y = b.length - 1; y >= 0; y--) { const l = (b.getLine(y)?.translateToString(true) ?? '').trim(); if (l === ${JSON.stringify(copyLine441)}) { const row = y - b.viewportY; if (row < 0 || row >= t.rows) return null; return { y: scr.y + (row + 0.5) * ch, x0: scr.x + 0.3 * cw, x1: scr.x + (l.length - 0.3) * cw }; } } return null; })()`);
    expect(at !== null, 'the copy line is on the screen to drag across');
    await s.evalJs(`${hostOf441}.emeraldTerm.clearSelection()`);
    await s.mouse('mouseMoved', at.x0, at.y);
    await s.mouse('mousePressed', at.x0, at.y);
    for (let i = 1; i <= 8; i++) await s.mouse('mouseMoved', at.x0 + ((at.x1 - at.x0) * i) / 8, at.y);
    await s.mouse('mouseReleased', at.x1, at.y);
    await sleep(500);
  };
  // The Write-Output above scrolled the line up but it is still on screen
  // in an 80-row-or-so pane; print it again to be sure it is the last one.
  await s.type(`echo ${copyLine441}`);
  await s.key('Enter', 'Enter', 13);
  await sleep(800);
  await setClip441('before-select-441');
  await dragLine441();
  expect((await selection441()) === copyLine441, `the drag selected the line, got ${JSON.stringify(await selection441())}`);
  expect((await clip441()) === 'before-select-441', 'with copy on select off, a drag leaves the clipboard alone');
  expect((await toggleCopyOnSelect441()) === false, 'copy on select starts off');
  await dragLine441();
  await s.waitFor(`window.emerald.clipboard.read().then((c) => c.text === ${JSON.stringify(copyLine441)})`, 'with copy on select on, the release copies the line', 3000);
  expect((await toggleCopyOnSelect441()) === true, 'copy on select was on, now off again');
  await s.evalJs(`${hostOf441}.emeraldTerm.clearSelection()`);
  step('copy on select copies on release only while it is on, and is off again');

  // M9 fix 538: under mouse tracking the right button's press and release
  // never reach the program, so a right-click pastes once (contextmenu's
  // paste) and no report (ESC [ < 2 ...) is sent to the pty. The tracking
  // is switched on in xterm itself (below), so its state is the
  // one a Claude Code pane has.
  // The modes are written to the terminal itself: a shell printing them
  // does not reach xterm through the pty here (the probe read 'none' 1.5 s
  // after a Write-Host of them), and the plan's shell route was the first
  // choice with this as its fallback. Any report would still go to the pty
  // through onData, which is what the step reads.
  const tracking538 = `${hostOf441}.emeraldTerm.modes.mouseTrackingMode !== 'none'`;
  await s.evalJs(`${hostOf441}.emeraldTerm.write(String.fromCharCode(27) + '[?1000h' + String.fromCharCode(27) + '[?1006h')`);
  await s.waitFor(tracking538, 'mouse tracking on', 3000);
  const tracked538 = 'tracked-' + Date.now();
  // A pane menu the earlier right-clicks left up sits at this same point and would take the click.
  await s.evalJs(`document.querySelector('.pane-menu') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'no pane menu over the terminal', 3000);
  await setClip441(tracked538);
  await s.rightClick(mid441.x, mid441.y);
  // The whole buffer, its rows joined (a wrapped word comes back whole): the
  // cursor's row alone read empty while PSReadLine repainted the prompt.
  const bufferText538 = `(() => { const b = ${hostOf441}.emeraldTerm.buffer.active; let text = ''; for (let y = 0; y < b.length; y++) text += b.getLine(y)?.translateToString(true) ?? ''; return text; })()`;
  await s.waitFor(`${bufferText538}.includes(${JSON.stringify(tracked538)})`, 'the right-click under tracking pastes at the prompt', 3000).catch(async (e) => {
    console.log('[verify] fix 538 diag', JSON.stringify({ tail: await s.evalJs(`(() => { const b = ${hostOf441}.emeraldTerm.buffer.active; const rows = []; for (let y = Math.max(0, b.length - 8); y < b.length; y++) rows.push(b.getLine(y)?.translateToString(true) ?? ''); return { rows, cursorY: b.cursorY, baseY: b.baseY, len: b.length }; })()`), clip: await clip441(), menu: await s.evalJs(`document.querySelector('.pane-menu')?.dataset.paneId ?? null`), p2: p2.id }));
    throw e;
  });
  await sleep(600);
  const screen538 = await s.evalJs(bufferText538);
  expect(screen538.split(tracked538).length - 1 === 1, `the word is on the screen once, got ${screen538.split(tracked538).length - 1}`);
  expect(!screen538.includes('[<2;'), 'no mouse report echoed on the screen');
  const readBack538 = Buffer.from((await zreq(s, 'session.read', { sessionId: p2.sessionId })).data, 'base64').toString();
  expect(!readBack538.includes('[<2;'), 'no right-button report reached the pty');
  await s.key('Escape', 'Escape', 27);
  await s.key('c', 'KeyC', 67, CTRL);
  await s.evalJs(`${hostOf441}.emeraldTerm.write(String.fromCharCode(27) + '[?1000l' + String.fromCharCode(27) + '[?1006l')`);
  await s.waitFor(`${hostOf441}.emeraldTerm.modes.mouseTrackingMode === 'none'`, 'mouse tracking off again', 3000);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'the pane menu the right-click opened is closed', 3000).catch(() => {});
  step('M9 fix 538: a right-click under mouse tracking pastes once and no report reaches the program');

  await s.key('S', 'KeyS', 83, CTRL | SHIFT);
  await s.waitFor(`!!document.querySelector('.picker-overlay .empty-pane')`, 'picker overlay');
  await s.screenshot('m2-keys-picker.png');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.picker-overlay')`, 'picker closed');
  step('Ctrl+Shift+S opened the session picker over pane 2, Escape closed it');

  // Picking a session already on screen jumps to its pane instead of showing it twice.
  await s.key('ArrowDown', 'ArrowDown', 40, ALT);
  await s.waitFor(focusedIs(p3.id), 'pane 3 focused');
  const homeName = path.basename(process.env['USERPROFILE'] ?? 'home');
  await s.evalJs(`[...document.querySelectorAll('.empty-pane .session-row')].find(b => b.textContent.includes(${JSON.stringify(homeName)}) && !b.textContent.includes(${JSON.stringify(path.basename(repoRoot))})).click()`);
  await s.waitFor(focusedIs(p1.id), 'jump to the pane already showing the session');
  expect(leaves(await getLayout(s))[2].sessionId === null, 'pane 3 still empty');
  step('picking a session already on screen jumps to its pane');

  await s.key('ArrowRight', 'ArrowRight', 39, ALT);
  await s.key('ArrowDown', 'ArrowDown', 40, ALT);
  await s.waitFor(focusedIs(p3.id), 'pane 3 focused again');
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes after close');
  l = await getLayout(s);
  expect(l.focusedPaneId === p2.id, 'focus fell back to the sibling');
  expect(l.root.second.kind === 'pane' && l.root.second.id === p2.id, 'column split collapsed');
  step('Ctrl+Shift+W closed pane 3 and collapsed the split');

  const g = await s.evalJs(`(() => { const r = document.querySelector('.gutter').getBoundingClientRect(); const c = document.querySelector('.split').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: c.x, width: c.width }; })()`);
  const targetX = g.left + g.width * 0.3;
  await s.mouse('mouseMoved', g.x, g.y);
  await s.mouse('mousePressed', g.x, g.y);
  for (let i = 1; i <= 10; i++) await s.mouse('mouseMoved', g.x + ((targetX - g.x) * i) / 10, g.y);
  await s.mouse('mouseReleased', targetX, g.y);
  await sleep(500);
  const ratio = (await getLayout(s)).root.ratio;
  expect(Math.abs(ratio - 0.3) < 0.02, `ratio near 0.3, got ${ratio}`);
  const firstWidth = await s.evalJs(`document.querySelector('.split-first').getBoundingClientRect().width / document.querySelector('.split').getBoundingClientRect().width`);
  expect(Math.abs(firstWidth - 0.3) < 0.02, `first pane at 30% of width, got ${firstWidth}`);
  step(`drag set the root ratio to ${ratio.toFixed(3)} and the pane follows`);

  // Re-query the gutter: targetX is its left edge and can round onto the pane.
  const gx = await s.evalJs(`(() => { const r = document.querySelector('.gutter').getBoundingClientRect(); return r.x + r.width / 2; })()`);
  await s.mouse('mousePressed', gx, g.y);
  await s.mouse('mouseMoved', g.left - 50, g.y);
  await s.mouse('mouseReleased', g.left - 50, g.y);
  await sleep(400);
  const clamped = (await getLayout(s)).root.ratio;
  expect(clamped === 0.05, `ratio clamped to 0.05, got ${clamped}`);
  step('dragging off the edge clamps the ratio');

  // M9 fix 279: a drag on the outer gutter of three panes in a line leaves
  // the inner divider where it is; only the pane against the gutter changes.
  // The gutter's centre and the box its drag is measured against (its own
  // split's), in window coordinates.
  const gutterOf = async (splitId) =>
    s.evalJs(
      `(() => { const el = document.querySelector(${JSON.stringify(`[data-split-id="${splitId}"]`)}); const r = el.querySelector(':scope > .gutter').getBoundingClientRect(); const c = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: c.x, top: c.y, width: c.width, height: c.height }; })()`,
    );
  const paneRect = async (paneId) => s.evalJs(`document.querySelector(${JSON.stringify(`[data-pane-id="${paneId}"]`)}).getBoundingClientRect().toJSON()`);
  const dragGutter = async (from, toX, toY) => {
    await s.mouse('mouseMoved', from.x, from.y);
    await s.mouse('mousePressed', from.x, from.y);
    for (let i = 1; i <= 10; i++) await s.mouse('mouseMoved', from.x + ((toX - from.x) * i) / 10, from.y + ((toY - from.y) * i) / 10);
    await s.mouse('mouseReleased', toX, toY);
    await sleep(500);
  };

  // Side by side: p1 | (p2 | p4), the root at 0.05 from the clamp above.
  await s.waitFor(focusedIs(p2.id), 'pane 2 focused before the split');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'three panes side by side');
  l = await getLayout(s);
  expect(l.root.second.kind === 'split' && l.root.second.direction === 'row', 'row split under pane 2');
  const rowInner = l.root.second;
  const p4 = leaves(l)[2];
  const innerBefore = await gutterOf(rowInner.id);
  const p4Before = await paneRect(p4.id);
  const rootGutter = await gutterOf(l.root.id);
  await dragGutter(rootGutter, rootGutter.left + rootGutter.width * 0.4, rootGutter.y);
  l = await getLayout(s);
  expect(Math.abs(l.root.ratio - 0.4) < 0.02, `root ratio near 0.4, got ${l.root.ratio}`);
  // The inner box went from 0.95 to 0.6 of the root's and p4 keeps its
  // pixels, so the inner ratio is 1 - 0.5 * 0.95 / 0.6.
  expect(Math.abs(l.root.second.ratio - (1 - (0.5 * 0.95) / 0.6)) < 0.03, `inner ratio rescaled, got ${l.root.second.ratio}`);
  const innerAfter = await gutterOf(rowInner.id);
  expect(Math.abs(innerAfter.x - innerBefore.x) <= 1, `inner divider kept its x: ${innerBefore.x} then ${innerAfter.x}`);
  const p4After = await paneRect(p4.id);
  expect(Math.abs(p4After.width - p4Before.width) <= 1, `pane 4 kept its width: ${p4Before.width} then ${p4After.width}`);
  step('dragging the outer gutter of three panes side by side left the inner divider still');

  // Stacked, the case seen: p1 | ((p2 / p6) / p5), dragging the lower
  // seam. Ctrl+Shift+W folds the row back to p1 | p2 first.
  await s.key('W', 'KeyW', 87, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes after closing pane 4');
  await s.waitFor(focusedIs(p2.id), 'pane 2 focused again');
  await s.key('O', 'KeyO', 79, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'pane 5 under pane 2');
  await s.key('ArrowUp', 'ArrowUp', 38, ALT);
  await s.waitFor(focusedIs(p2.id), 'Alt+Up back to pane 2');
  await s.key('O', 'KeyO', 79, CTRL | SHIFT);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'pane 6 under pane 2');
  l = await getLayout(s);
  const colOuter = l.root.second;
  expect(colOuter.kind === 'split' && colOuter.direction === 'column' && colOuter.first.kind === 'split' && colOuter.first.direction === 'column', 'a column inside the column');
  const colInner = colOuter.first;
  expect(colInner.first.id === p2.id, 'pane 2 is the top of the inner column');
  const p6 = colInner.second;
  const p5 = colOuter.second;
  const topBefore = await gutterOf(colInner.id);
  const p2Before = await paneRect(p2.id);
  const p6Before = await paneRect(p6.id);
  const lowerGutter = await gutterOf(colOuter.id);
  await dragGutter(lowerGutter, lowerGutter.x, lowerGutter.top + lowerGutter.height * 0.7);
  l = await getLayout(s);
  expect(Math.abs(l.root.second.ratio - 0.7) < 0.02, `lower seam near 0.7, got ${l.root.second.ratio}`);
  expect(Math.abs(l.root.second.first.ratio - (0.5 * 0.5) / 0.7) < 0.03, `inner ratio rescaled, got ${l.root.second.first.ratio}`);
  const topAfter = await gutterOf(colInner.id);
  expect(Math.abs(topAfter.y - topBefore.y) <= 1, `upper seam kept its y: ${topBefore.y} then ${topAfter.y}`);
  const p2After = await paneRect(p2.id);
  expect(Math.abs(p2After.height - p2Before.height) <= 1, `pane 2 kept its height: ${p2Before.height} then ${p2After.height}`);
  const p6After = await paneRect(p6.id);
  const p5After = await paneRect(p5.id);
  expect(p6After.height - p6Before.height > lowerGutter.height * 0.15, `pane 6 took the change: ${p6Before.height} then ${p6After.height}`);
  expect(Math.abs(p5After.height - lowerGutter.height * 0.3) < 4, `pane 5 at 30% of the column, got ${p5After.height} of ${lowerGutter.height}`);
  step('dragging the lower seam of three stacked panes left the upper seam still');
  await s.screenshot('m2-keys-final.png');
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m2-keys-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
