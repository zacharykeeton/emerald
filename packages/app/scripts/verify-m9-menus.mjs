// M9 acceptance, part 1: the mouse can do what the keys do. An empty pane
// offers Split right and Split down; a right click on any pane, terminal
// included, opens a menu with the same actions and their key hints; a
// session pane's title bar has split and close buttons; the sidebar's
// collapse leaves a rail whose button brings it back, and the pane menu's
// Close pane is disabled on the last pane. The sidebar heading's order menu
// and a folder heading's + menu (M32) are listed too, and a layout tab's
// menu (M36) has Rename and Close tab, the latter off on the last tab, and
// the strip has a + after the tabs. Starts from an empty layout, so run it
// when no Emerald app is open.
// Run: npm run verify:menus -w @emerald/app
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { CTRL, SHIFT, expect, freshPort, getLayout, killTree, launch, leaves, sleep, splitWithShell, startSessionByKey, startShellByKey, step, stopDaemon, zreq } from './cdp.mjs';

setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 240 s');
  process.exit(3);
}, 240000);

const read = async (s, id) => Buffer.from((await zreq(s, 'session.read', { sessionId: id })).data, 'base64').toString();

const panes = (s) => s.evalJs(`document.querySelectorAll('.pane').length`);
const centerOf = (s, selector) =>
  s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const menuItems = (s) => s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent + (b.classList.contains('menu-heading') ? ' (heading)' : '') + (b.disabled ? ' (disabled)' : ''))`);
const menuHint = (s, label) =>
  s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)})?.querySelector('.menu-hint')?.textContent ?? null`);
const chooseMenu = async (s, label) => {
  await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
};
const openMenuOn = async (s, paneId) => {
  const c = await centerOf(s, `[data-pane-id=${JSON.stringify(paneId)}]`);
  await s.rightClick(c.x, c.y);
  await s.waitFor(`document.querySelector('.pane-menu')?.dataset.paneId === ${JSON.stringify(paneId)}`, `menu on pane ${paneId.slice(0, 8)}`);
};

// EMERALD_NO_UPDATE for the M9 fix 239 step below: the title row carries
// no update badge while the check is off (a dev build never checks
// either; the flag is what the user's own app would set).
let s = await launch(freshPort(), { freshState: true, env: { EMERALD_NO_UPDATE: '1' } });
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  let layout = await getLayout(s);
  const p1 = leaves(layout)[0].id;

  // The empty pane's own buttons. The only pane has no Close pane button
  // (M9 fix 103): nothing to close.
  expect((await s.evalJs(`document.querySelector('.empty-split-right')?.textContent`)) === 'Split right', 'empty pane offers Split right');
  expect((await s.evalJs(`document.querySelector('.empty-close')`)) === null, 'the only pane shows no Close pane button');
  expect((await s.evalJs(`document.querySelector('.empty-x')`)) === null, 'the only pane shows no corner ×');
  await s.evalJs(`document.querySelector('.empty-split-right').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes after the Split right button');
  layout = await getLayout(s);
  expect(layout.root.kind === 'split' && layout.root.direction === 'row', 'side by side');
  let p2 = leaves(layout)[1].id;
  expect(layout.focusedPaneId === p2, 'the new pane is focused');
  step('Split right button: two panes side by side');

  // A split's empty pane offers Close pane on its split row (M9 fix 103),
  // with the key beside it; a click removes the pane, and the pane left
  // alone loses the button again.
  const closeSel = `[data-pane-id=${JSON.stringify(p2)}] .empty-close`;
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(closeSel)})?.textContent`)) === 'Close pane', 'the split pane offers Close pane');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(closeSel)}).nextElementSibling.textContent`)) === 'Ctrl+Shift+W', 'Close pane shows its key');
  // M9 fix 124: in a pane about 340px wide the split row wraps, and it
  // wraps between a button and its key no longer: every key sits on the
  // same line as its button (the pair is one unit that wraps only within itself), and the row
  // did wrap, so the reading means something. The root split's ratio
  // puts the second pane at that width and is put back after.
  const ratioBefore = layout.root.ratio;
  const surfaceWidth = await s.evalJs(`document.querySelector('.splitview .split').getBoundingClientRect().width`);
  const narrowRatio = Math.min(0.9, Math.max(0.1, 1 - 340 / surfaceWidth));
  // M9 fix 127: two shells in the sidebar alone, so the narrow pane's
  // picker lists them, one named with a hyphenated word and one with
  // four words, the two shapes that wrapped onto three and four lines.
  const pickerNames = ['emerald-ct3-repo', 'Git worktree agent task'];
  const pickerIds = [];
  for (const name of pickerNames) pickerIds.push((await zreq(s, 'session.spawn', { kind: 'shell', cwd: os.homedir(), name, cols: 80, rows: 24 })).session.id);
  const pickerSel = `[data-pane-id=${JSON.stringify(p2)}] .empty-list .session-row`;
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(pickerSel)}).length === 2`, 'the picker lists the two shells');
  await zreq(s, 'layout.set', { layout: { ...layout, root: { ...layout.root, ratio: narrowRatio } } });
  await s.waitFor(`Math.abs(document.querySelector('[data-pane-id=${JSON.stringify(p2)}]').getBoundingClientRect().width - 340) < 12`, 'the second pane about 340px wide');
  const picker = await s.evalJs(`[...document.querySelectorAll(${JSON.stringify(pickerSel)})].map((row) => {
    const name = row.querySelector('.pane-name');
    const folder = row.lastElementChild;
    // The line height is 'normal', so the font size stands in: a second
    // line would put the height past twice it.
    const font = parseFloat(getComputedStyle(name).fontSize);
    return { name: name.textContent, title: name.title, height: name.getBoundingClientRect().height, font, folderCut: folder.scrollWidth > folder.clientWidth, folder: folder.textContent };
  })`);
  expect(picker.length === 2 && picker.every((r) => r.height < r.font * 2), `each picker name on one line at 340px, got ${JSON.stringify(picker)}`);
  expect(picker.every((r) => r.title === r.name && pickerNames.includes(r.name)), `the whole name in the title, got ${JSON.stringify(picker)}`);
  expect(picker.every((r) => r.folderCut), `the folder gives way first, got ${JSON.stringify(picker)}`);
  const pairs = await s.evalJs(`(() => {
    const pane = document.querySelector('[data-pane-id=${JSON.stringify(p2)}]');
    const row = pane.querySelector('.empty-close').closest('.empty-row');
    const tops = [...row.children].map((el) => Math.round(el.getBoundingClientRect().top / 8));
    return {
      width: Math.round(pane.getBoundingClientRect().width),
      lines: new Set(tops).size,
      pairs: [...row.querySelectorAll('.empty-pair')].map((pair) => {
        const b = pair.querySelector('button').getBoundingClientRect();
        const k = pair.querySelector('.muted').getBoundingClientRect();
        return { button: pair.querySelector('button').textContent, key: pair.querySelector('.muted').textContent, sameLine: k.top < b.bottom && k.bottom > b.top && k.left > b.right };
      }),
    };
  })()`);
  expect(pairs.pairs.length === 3 && pairs.pairs.every((x) => x.sameLine), `every key sits beside its button at ${pairs.width}px, got ${JSON.stringify(pairs)}`);
  expect(pairs.lines >= 2, `the row wrapped at ${pairs.width}px so the pairs were tested, got ${JSON.stringify(pairs)}`);
  const narrowed = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...narrowed, root: { ...narrowed.root, ratio: ratioBefore } } });
  // The harness window's surface is about 680px, so the default half is
  // the 340 already; the wait is for the ratio's own width either way.
  await s.waitFor(`Math.abs(document.querySelector('[data-pane-id=${JSON.stringify(p2)}]').getBoundingClientRect().width - ${(1 - ratioBefore) * surfaceWidth}) < 12`, 'the second pane back at its width');
  step(`M9 fix 124: at ${pairs.width}px the split row wrapped onto ${pairs.lines} lines with every key beside its button`);
  step(`M9 fix 127: at ${pairs.width}px the picker keeps ${picker.map((r) => JSON.stringify(r.name)).join(' and ')} on one line each, the folder cut first`);
  for (const id of pickerIds) await zreq(s, 'session.kill', { sessionId: id, remove: true });
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(pickerSel)}).length === 0`, 'the two shells gone again');
  await s.evalJs(`document.querySelector(${JSON.stringify(closeSel)}).click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'one pane after the Close pane button');
  expect((await s.evalJs(`document.querySelector('.empty-close')`)) === null, 'the pane left alone shows no Close pane button');
  step('Close pane button on a split pane that is empty');

  // M9 fix 704: the corner × on a split pane stays put while the body scrolls.
  await s.evalJs(`document.querySelector('.empty-split-right').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes for the corner ×');
  const p704 = leaves(await getLayout(s))[1].id;
  const sel704 = `[data-pane-id=${JSON.stringify(p704)}]`;
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(sel704 + ' .empty-x')})?.textContent`)) === '×', 'the split pane shows the corner ×');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(sel704 + ' .empty-x')})?.title`)) === 'Close pane (Ctrl+Shift+W)', 'the corner × is titled with its key');
  const width704 = await s.evalJs(`window.innerWidth`);
  const read704 = () =>
    s.evalJs(`(() => {
      const pane = document.querySelector(${JSON.stringify(sel704)});
      const x = pane.querySelector('.empty-x').getBoundingClientRect();
      const p = pane.getBoundingClientRect();
      const body = pane.querySelector('.empty-body');
      const foot = pane.querySelector('.empty-foot').getBoundingClientRect();
      const close = pane.querySelector('.empty-close').getBoundingClientRect();
      const cx = x.left + x.width / 2;
      const cy = x.top + x.height / 2;
      return { px: p.left, py: p.top, pr: p.right, pb: p.bottom, xl: x.left, xt: x.top, xr: x.right, xb: x.bottom, cx, cy, footBottom: foot.bottom, closeBottom: close.bottom, sh: body.scrollHeight, ch: body.clientHeight, hit: document.elementFromPoint(cx, cy)?.className ?? null };
    })()`);
  let height704 = 400;
  let r704;
  for (;;) {
    await s.send('Emulation.setDeviceMetricsOverride', { width: width704, height: height704, deviceScaleFactor: 0, mobile: false });
    await sleep(400);
    r704 = await read704();
    if ((r704.footBottom > r704.pb && r704.sh > r704.ch) || height704 <= 250) break;
    height704 -= 50;
  }
  console.log(`[704] window height ${height704}`);
  expect(r704.footBottom > r704.pb && r704.sh > r704.ch, `the foot is out of view at ${height704}px, got ${JSON.stringify(r704)}`);
  expect(r704.xl >= r704.px && r704.xr <= r704.pr && r704.xt >= r704.py && r704.xb <= r704.pb, `the × is inside the pane, got ${JSON.stringify(r704)}`);
  expect(r704.hit === 'empty-x', `the × is what sits at its own centre, got ${JSON.stringify(r704)}`);
  await s.evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel704 + ' .empty-body')}); b.scrollTop = b.scrollHeight; })()`);
  await sleep(200);
  const after704 = await read704();
  expect(Math.abs(after704.xt - r704.xt) <= 1, `the × stays put through a scroll, got ${r704.xt} then ${after704.xt}`);
  expect(after704.closeBottom <= after704.pb + 0.5, `the foot's Close pane is in view after the scroll, got ${JSON.stringify(after704)}`);
  await s.click(after704.cx, after704.cy);
  await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'one pane after the corner ×');
  expect((await s.evalJs(`document.querySelector('.empty-x')`)) === null, 'the pane left alone shows no corner ×');
  await s.send('Emulation.clearDeviceMetricsOverride', {});
  await sleep(300);
  step('M9 fix 704: a split pane shows the corner ×, titled with its key; at 400 px of window the foot is out of view while the × stays put through a scroll, and a click on it closes the pane');

  // Split again for the menu steps below.
  await s.evalJs(`document.querySelector('.empty-split-right').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes again');
  layout = await getLayout(s);
  p2 = leaves(layout)[1].id;

  // The right-click menu on an empty pane. The last section is the
  // terminal's colour schemes (M9 fixes 225, 648): a heading and two rows,
  // This session (off limits with no session in the pane) and The window,
  // each opening a list of the six shipped schemes (emerald gem, the Emerald
  // skin's default, after emerald, M9 fix 572).
  await openMenuOn(s, p2);
  const items = await menuItems(s);
  expect(
    JSON.stringify(items) ===
      JSON.stringify(['Split right', 'Split down', 'Focus', 'Reset text size (disabled)', 'New shell here', 'Other shell here', 'New Claude session here', 'Rename session (disabled)', 'Show a session here', 'Find in scrollback (disabled)', 'Close pane', 'Copy on select', 'Terminal colours (heading)', 'This session (disabled)', 'The window']),
    'menu items, got ' + JSON.stringify(items),
  );
  const look = await s.evalJs(`(() => { const h = document.querySelector('.pane-menu .menu-heading'); const d = [...document.querySelectorAll('.pane-menu button.menu-item')].find((b) => b.disabled); if (!h || !d) return null; const pick = (e) => { const c = getComputedStyle(e); return [c.color, c.fontSize, c.fontFamily].join('|'); }; return { heading: pick(h), button: pick(d) }; })()`);
  expect(look !== null && look.heading === look.button, `the Terminal colours heading wears the disabled look, same colour, size and face, got ${JSON.stringify(look)}`);
  expect((await menuHint(s, 'Split down')) === 'Ctrl+Shift+O', 'Split down shows its key');
  // M9 fix 624: the other installed shells, a list of their own at the
  // row's edge; every box has Windows PowerShell and cmd, so the row is
  // always there on a daemon at 61.
  expect((await menuHint(s, 'Other shell here')) === '›', 'Other shell here opens a list');
  await chooseMenu(s, 'Other shell here');
  await s.waitFor(`!!document.querySelector('.menu-sub')`, 'the other shells list');
  const subLabels = await s.evalJs(`[...document.querySelectorAll('.menu-sub .menu-item .menu-label')].map((l) => l.textContent)`);
  const offered = (await s.evalJs('window.emerald.daemonInfo()')).shells.slice(1).map((o) => o.label);
  expect(JSON.stringify(subLabels) === JSON.stringify(offered) && subLabels.includes('Command Prompt'), `the list is the installed shells past the default, got ${JSON.stringify(subLabels)} against ${JSON.stringify(offered)}`);
  expect(await s.evalJs(`!!document.querySelector('.pane-menu')`), 'the pane menu stays open under its list');
  step('M9 fix 624: the pane menu offers Other shell here after New shell here, and its list is the installed shells past the default');
  await chooseMenu(s, 'Split down');
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'three panes after the menu');
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'menu closed');
  layout = await getLayout(s);
  expect(layout.root.second.kind === 'split' && layout.root.second.direction === 'column', 'pane 2 split stacked');
  const p3 = leaves(layout)[2].id;
  step('Right-click menu: Split down made a third pane');

  // Escape closes the menu without acting. M9 fix 589: the Escape that
  // closes the menu stops there, so the empty pane's action box keeps
  // its query; a second Escape, with no menu up, empties it (fix 202).
  const p3Box = `[data-pane-id=${JSON.stringify(p3)}] .palette-input`;
  await s.evalJs(`document.querySelector(${JSON.stringify(p3Box)}).focus()`);
  await s.type('>split');
  await s.waitFor(`document.querySelector(${JSON.stringify(p3Box)})?.dataset.mode === 'actions' && document.querySelector(${JSON.stringify(p3Box)})?.value === '>split'`, 'the action box holds >split');
  await openMenuOn(s, p3);
  expect(await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p3)}] .empty-pane').contains(document.activeElement)`), 'the keyboard is inside the empty pane under the menu');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'Escape closed the menu');
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(p3Box)})?.value`)) === '>split', `the menu's Escape left the action box its query: ${JSON.stringify(await s.evalJs(`document.querySelector(${JSON.stringify(p3Box)})?.value`))}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`document.querySelector(${JSON.stringify(p3Box)})?.value === ''`, 'a second Escape, with no menu up, empties the box');
  expect((await panes(s)) === 3, 'still three panes');

  // A shell in pane 3 (focused): the title bar gets the buttons, and the
  // menu opens over the terminal too.
  await startSessionByKey(s, { kind: 'shell', cwd: os.homedir() });
  await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'shell in pane 3');
  await sleep(300);
  const c = await centerOf(s, `[data-pane-id=${JSON.stringify(p3)}] .term-host`);
  await s.rightClick(c.x, c.y);
  await s.waitFor(`document.querySelector('.pane-menu')?.dataset.paneId === ${JSON.stringify(p3)}`, 'menu over the terminal');
  await s.screenshot('m9-menus-menu.png');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'menu closed');
  // Five since M63: split right, split down, the shade, hide and close.
  expect((await s.evalJs(`document.querySelectorAll('[data-pane-id=${JSON.stringify(p3)}] .pane-title-actions button').length`)) === 6, 'six title bar buttons (the focus button among them since M9 fix 181)');
  layout = await getLayout(s);
  const s3 = leaves(layout).find((p) => p.id === p3).sessionId;
  // M9 fix 589: a half-typed line in a shell under the pane menu is kept
  // when the menu's Escape closes it. The menu is opened by a dispatched
  // contextmenu on the term-host, since the terminal's own right-click
  // pastes into the line (fix 441); the expression only evaluates to
  // 280091 if the typed half survived the Escape (PSReadLine reverts the
  // line on an Escape that reaches it).
  const promptBy = Date.now() + 10000;
  while (!/PS [^\n]*>/.test(await read(s, s3)) && Date.now() < promptBy) await sleep(200);
  expect(/PS [^\n]*>/.test(await read(s, s3)), 'the shell in pane 3 shows its prompt');
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p3)}] .xterm-helper-textarea').focus()`);
  // The real right-click above pasted the clipboard into the line (fix
  // 441), which the menu's Escape now leaves; an Escape with no menu up
  // reverts whatever is there before the half line is typed.
  await s.key('Escape', 'Escape', 27);
  await sleep(300);
  await s.type('[string](40013*');
  const halfBy = Date.now() + 5000;
  while (!(await read(s, s3)).includes('40013') && Date.now() < halfBy) await sleep(100);
  expect((await read(s, s3)).includes('40013'), 'the half line is echoed');
  await s.evalJs(
    `(() => { const h = document.querySelector('[data-pane-id=${JSON.stringify(p3)}] .term-host'); const b = h.getBoundingClientRect(); h.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 })); })()`,
  );
  await s.waitFor(`document.querySelector('.pane-menu')?.dataset.paneId === ${JSON.stringify(p3)}`, 'the pane menu over the half line');
  expect(
    await s.evalJs(`document.activeElement === document.querySelector('[data-pane-id=${JSON.stringify(p3)}] .xterm-helper-textarea')`),
    'the keyboard stays in the terminal under the menu',
  );
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, "the menu's Escape closed it");
  await s.type('7)');
  await s.key('Enter', 'Enter', 13);
  const lineBy = Date.now() + 5000;
  while (!(await read(s, s3)).includes('280091') && Date.now() < lineBy) await sleep(100);
  const lineTail = (await read(s, s3)).slice(-300);
  expect(lineTail.includes('280091') || (await read(s, s3)).includes('280091'), `the half line survived the menu's Escape and ran: ${JSON.stringify(lineTail)}`);
  step('M9 fix 589: the Escape that closes a menu stops at the menu: an empty pane keeps its query, and a half-typed line in a shell under the pane menu is kept');
  await splitWithShell(s, `[data-pane-id=${JSON.stringify(p3)}] .pane-split-down`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 4`, 'four panes after the title bar button');
  // The title bar menu's Split with shell (a plain click gives an empty
  // pane since M9 fix 537) starts a shell in the new pane, in the same folder.
  await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'a shell in the new pane');
  layout = await getLayout(s);
  const p4 = leaves(layout)[3].id;
  expect(layout.focusedPaneId === p4, 'new pane focused');
  const s4 = leaves(layout)[3].sessionId;
  const sessions = (await zreq(s, 'session.list', {})).sessions;
  expect(s4 !== null && s4 !== s3 && sessions.find((x) => x.id === s4)?.spawnCwd === os.homedir(), 'the new shell is in the same folder as the one it was split from');

  // M9 fixes 244 and 648: a colour scheme for one session. The section's
  // first row, This session, is on offer on a session pane and opens a list;
  // a pick in it lands on the session's record (session.set's scheme),
  // themes that pane's terminal and its own host's ground, and leaves the
  // other pane and the root on the window's pick; the list's checkmark, the
  // row's hint and the heading's tooltip say so. The scheme follows the
  // session into another pane, and the list's The window's clears it.
  const hostOf = (paneId) => `document.querySelector('[data-pane-id=${JSON.stringify(paneId)}] .term-host')`;
  const schemeProbe = (paneId) =>
    s.evalJs(
      `(() => { const host = ${hostOf(paneId)}; return { theme: host.emeraldTerm.options.theme.background, ground: getComputedStyle(host).backgroundColor, viewport: getComputedStyle(host.querySelector('.xterm-viewport')).backgroundColor, name: host.dataset.scheme ?? null, root: document.documentElement.dataset.scheme ?? null, stored: localStorage.getItem('emerald.scheme') }; })()`,
    );
  const menuRows = () => s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].map((b) => ({ label: b.querySelector('.menu-label').textContent.replace(/^✓/, ''), checked: b.dataset.checked ?? null, disabled: b.disabled, title: b.title, hint: b.querySelector('.menu-hint')?.textContent ?? null }))`);
  const subRows = () => s.evalJs(`[...document.querySelectorAll('.menu-sub .menu-item')].map((b) => ({ label: b.querySelector('.menu-label').textContent.replace(/^✓/, ''), checked: b.dataset.checked ?? null, hint: b.querySelector('.menu-hint')?.textContent ?? null }))`);
  const chooseSub = (label) => s.evalJs(`[...document.querySelectorAll('.menu-sub .menu-item')].find((b) => b.querySelector('.menu-label').textContent.replace(/^✓/, '') === ${JSON.stringify(label)}).click()`);
  const openSub = async (label) => {
    await chooseRow(label);
    await s.waitFor(`!!document.querySelector('.menu-sub[data-parent=${JSON.stringify(label)}]')`, `the ${label} list`);
  };
  const rowNamed = (rows, label) => rows.find((r) => r.label === label);
  // chooseMenu above matches the label whole, and a checked row's text
  // starts with the tick.
  const chooseRow = (label) => s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent.replace(/^✓/, '') === ${JSON.stringify(label)}).click()`);
  const sessionScheme = async (id) => (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === id)?.scheme ?? null;
  await openMenuOn(s, p4);
  let rows = await menuRows();
  const sessionRow = rowNamed(rows, 'This session');
  expect(sessionRow !== undefined && sessionRow.disabled === false && sessionRow.hint === "the window's ›", `This session is on offer with the window's scheme as its hint, got ${JSON.stringify(sessionRow)}`);
  expect(rowNamed(rows, 'The window')?.hint === 'emerald ›', `The window carries the window's scheme, got ${JSON.stringify(rowNamed(rows, 'The window'))}`);
  expect(rowNamed(rows, 'This session only') === undefined && rowNamed(rows, "Window's scheme") === undefined, 'the toggle and the clear row are gone');
  // M9 fix 419: New shell here no longer puts the shell over the session
  // the pane is showing, and its tooltip says where the shell lands.
  expect(rowNamed(rows, 'New shell here').title === "A shell in this session's folder, beside it", `New shell here says the shell goes beside the session, got ${JSON.stringify(rowNamed(rows, 'New shell here')?.title)}`);
  await openSub('This session');
  let sub = await subRows();
  expect(JSON.stringify(sub.map((r) => [r.label, r.checked])) === JSON.stringify([["The window's", 'true'], ['emerald', 'false'], ['emerald gem', 'false'], ['Dracula', 'false'], ['One Dark', 'false'], ['Solarized Dark', 'false'], ['Tokyo Night', 'false']]), `the session's list checks The window's alone, got ${JSON.stringify(sub)}`);
  await chooseSub('Solarized Dark');
  await s.waitFor(`${hostOf(p4)}.emeraldTerm.options.theme.background === '#002b36'`, "pane 4's terminal on Solarized Dark");
  expect((await sessionScheme(s4)) === 'Solarized Dark', 'the pick is on the session\'s record');
  expect((await sessionScheme(s3)) === null, 'the other session has none');
  let own = await schemeProbe(p4);
  let other = await schemeProbe(p3);
  expect(own.ground === 'rgb(0, 43, 54)' && own.viewport === 'rgb(0, 43, 54)' && own.name === 'Solarized Dark', `pane 4's host wears the session's ground, got ${JSON.stringify(own)}`);
  expect(other.theme === '#1e1e1e' && other.ground === 'rgb(30, 30, 30)' && other.name === 'emerald', `pane 3's terminal and ground are the window's, got ${JSON.stringify(other)}`);
  expect(own.root === 'emerald' && own.stored === null, `the root and localStorage keep the window's pick, got ${JSON.stringify(own)}`);
  rows = await menuRows();
  sub = await subRows();
  expect(rowNamed(sub, 'Solarized Dark').checked === 'true' && rowNamed(sub, "The window's").checked === 'false', `the list marks the session's scheme, got ${JSON.stringify(sub)}`);
  expect(rowNamed(rows, 'This session').hint === 'Solarized Dark ›', `the row's hint names the scheme, got ${JSON.stringify(rowNamed(rows, 'This session'))}`);
  expect(rowNamed(rows, 'Terminal colours').title.startsWith("This session wears Solarized Dark, its own; the window's pick, in every other pane, is emerald"), `the heading names both, got ${JSON.stringify(rowNamed(rows, 'Terminal colours').title)}`);
  await s.screenshot('m9-fix244-session-scheme.png');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'menu closed');
  // Pane 3's menu: no scheme of its own, and the window's list has the
  // window's pick checked.
  await openMenuOn(s, p3);
  rows = await menuRows();
  expect(rowNamed(rows, 'This session').hint === "the window's ›" && rowNamed(rows, 'The window').hint === 'emerald ›', `pane 3's rows read the window's scheme, got ${JSON.stringify(rows.filter((r) => r.hint !== null))}`);
  await openSub('The window');
  sub = await subRows();
  expect(sub.filter((r) => r.checked === 'true').map((r) => r.label).join() === 'emerald', `the window's list checks emerald alone, got ${JSON.stringify(sub)}`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'menu closed');
  // The session shown in pane 3 as well (M50): its scheme comes with it.
  const withSession = (node, paneId, sessionId) =>
    node.kind === 'pane' ? (node.id === paneId ? { ...node, sessionId } : node) : { ...node, first: withSession(node.first, paneId, sessionId), second: withSession(node.second, paneId, sessionId) };
  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, p3, s4) } });
  await s.waitFor(`${hostOf(p3)}?.emeraldTerm?.options.theme.background === '#002b36' && ${hostOf(p3)}.dataset.scheme === 'Solarized Dark'`, 'the scheme followed the session into pane 3');
  expect((await schemeProbe(p3)).ground === 'rgb(0, 43, 54)', "pane 3's ground followed too");
  layout = await getLayout(s);
  await zreq(s, 'layout.set', { layout: { ...layout, root: withSession(layout.root, p3, s3) } });
  await s.waitFor(`${hostOf(p3)}?.emeraldTerm?.options.theme.background === '#1e1e1e'`, 'pane 3 back on its own shell and the window\'s scheme');
  // The session list's The window's clears the record.
  await openMenuOn(s, p4);
  await openSub('This session');
  await chooseSub("The window's");
  await s.waitFor(`${hostOf(p4)}.emeraldTerm.options.theme.background === '#1e1e1e'`, "pane 4 back on the window's scheme");
  expect((await sessionScheme(s4)) === null, 'the record\'s scheme is cleared');
  await s.waitFor(`[...document.querySelectorAll('.pane-menu .menu-item')].some((b) => b.textContent.startsWith('This session') && b.querySelector('.menu-hint')?.textContent === "the window's ›")`, "This session's hint back to the window's");
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'menu closed');
  step("M9 fix 244 and 648: This session's list puts a pick on the session's record, themes that pane alone and follows the session between panes; The window's clears it");

  // M9 fix 299: a pane menu opened beside the files rail floats above it.
  // The menu renders from the body now, so the rail after the panes view
  // in the DOM no longer paints over it; and any key closes a menu, so
  // Ctrl+PageDown with one open takes the menu with it.
  if (await s.evalJs(`!!document.querySelector('.files-rail-collapsed')`)) {
    await s.evalJs(`document.querySelector('.files-expand').click()`);
  }
  await s.waitFor(`!!document.querySelector('.files-rail')`, 'the files rail open');
  // The title bar nearest the rail, right-clicked 20px in from the rail's
  // left edge.
  const railPress = await s.evalJs(
    `(() => { const rail = document.querySelector('.files-rail').getBoundingClientRect(); const titles = [...document.querySelectorAll('.pane-title')].map((t) => t.getBoundingClientRect()); const t = titles.reduce((a, b) => (b.right > a.right ? b : a)); return { gap: rail.left - t.right, x: rail.left - 20, y: t.y + t.height / 2 }; })()`,
  );
  expect(railPress.gap >= 0 && railPress.gap < 12, `a pane title ends at the rail's left edge, got a gap of ${railPress.gap}px`);
  await s.rightClick(railPress.x, railPress.y);
  await s.waitFor(`!!document.querySelector('.pane-menu')`, 'the pane menu beside the rail');
  expect(await s.evalJs(`document.querySelector('.pane-menu').parentElement === document.body`), 'the menu is a child of the body');
  // What is drawn at the centre of the menu's rightmost 10px, over the
  // rail: the item nearest the menu's middle, not the rail.
  const railTop = await s.evalJs(
    `(() => { const m = document.querySelector('.pane-menu'); const r = m.getBoundingClientRect(); const mid = r.y + r.height / 2; const item = [...m.querySelectorAll('.menu-item')].map((b) => b.getBoundingClientRect()).reduce((a, b) => (Math.abs(b.y + b.height / 2 - mid) < Math.abs(a.y + a.height / 2 - mid) ? b : a)); const el = document.elementFromPoint(r.right - 5, item.y + item.height / 2); const rail = document.querySelector('.files-rail').getBoundingClientRect(); return { overRail: r.right - 5 > rail.left, inMenu: !!el?.closest('.pane-menu'), item: !!el?.closest('.menu-item'), cls: el?.className ?? null }; })()`,
  );
  expect(railTop.overRail, 'the menu reaches over the rail');
  expect(railTop.inMenu && railTop.item, `the point over the rail draws a menu item of the pane menu, got ${JSON.stringify(railTop)}`);
  await s.screenshot('m9-menu-rail.png');
  await s.key('PageDown', 'PageDown', 34, CTRL);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'Ctrl+PageDown closed the menu');
  step('M9 fix 299: the pane menu floats above the files rail from the body, and a key closes it');

  // Since M9 fix 7 the × kills; the − is the hide that keeps the session.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(p3)}] .pane-hide').click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'three panes after the title bar hide');
  layout = await getLayout(s);
  expect(leaves(layout).every((p) => p.id !== p3), 'pane 3 gone');
  expect(leaves(layout).every((p) => p.sessionId !== s3), 'the first shell is off screen but not killed');
  expect((await s.evalJs(`document.querySelectorAll('.sidebar-row').length`)) === 2, 'both shells still listed in the sidebar');
  step('Title bar buttons: Split with shell starts a shell in the same folder, hide keeps the session');

  // Hide the rest from the menu; the last one refuses.
  await openMenuOn(s, p4);
  await chooseMenu(s, 'Hide pane');
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'two panes');
  // Panes 2 and 1 are empty, so the same item reads Close pane there.
  await openMenuOn(s, p2);
  await chooseMenu(s, 'Close pane');
  await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'one pane');
  await openMenuOn(s, p1);
  const last = await menuItems(s);
  expect(last.includes('Close pane (disabled)') && last.includes('Focus (disabled)'), 'close and focus disabled on the last pane, got ' + JSON.stringify(last));
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'menu closed');
  step('Hide pane from the menu, disabled on the last pane');

  // M9 fix 343: the title bar's split buttons give a shell or a Claude,
  // whichever is the default; a right-click offers the other kind once
  // and a checked item sets the default. The title bar only shows once
  // the pane holds a session.
  await startShellByKey(s);
  layout = await getLayout(s);
  const soloPaneId = leaves(layout)[0].id;
  const soloSessionId = leaves(layout)[0].sessionId;
  const splitMenuItems = () =>
    s.evalJs(`[...document.querySelectorAll('.split-menu .menu-item')].map((b) => ({ label: b.querySelector('.menu-label').textContent.replace(/^✓/, ''), checked: b.dataset.checked ?? null, disabled: b.disabled, heading: b.classList.contains('menu-heading') }))`);
  const chooseSplitMenu = (label) =>
    s.evalJs(`[...document.querySelectorAll('.split-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent.replace(/^✓/, '') === ${JSON.stringify(label)}).click()`);
  const rightSel = `[data-pane-id=${JSON.stringify(soloPaneId)}] .pane-split-right`;
  // The pane is in the layout before its spawn answers, and a Claude's
  // spawn takes longer than a shell's, so the session id is waited for.
  const newPaneKind = async () => {
    let extra;
    for (let i = 0; i < 40; i++) {
      const l = await getLayout(s);
      extra = leaves(l).find((p) => p.id !== soloPaneId);
      if (extra?.sessionId) break;
      await sleep(250);
    }
    if (extra === undefined) return { pane: undefined, kind: null };
    const kind = (await zreq(s, 'session.list', {})).sessions.find((x) => x.id === extra.sessionId)?.kind ?? null;
    return { pane: extra, kind };
  };
  const closeExtraPane = async (extraPaneId, extraSessionId) => {
    await zreq(s, 'session.kill', { sessionId: extraSessionId, remove: true });
    await s.waitFor(`document.querySelector('[data-pane-id=${JSON.stringify(extraPaneId)}] .empty-close') !== null`, 'the split pane empties once its session is gone');
    await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(extraPaneId)}] .empty-close').click()`);
    await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'back to the one pane');
  };

  const openSplitMenuHere = async (why) => {
    const btn = await centerOf(s, rightSel);
    await s.rightClick(btn.x, btn.y);
    await s.waitFor(`!!document.querySelector('.split-menu')`, why);
  };
  // A pane that holds nothing, split off the solo pane: no session, the
  // filter box focused (M9 fix 537), and no session started behind it.
  const closeEmptyExtra = async () => {
    const extra = leaves(await getLayout(s)).find((p) => p.id !== soloPaneId);
    await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(extra.id)}] .empty-close').click()`);
    await s.waitFor(`document.querySelectorAll('.pane').length === 1`, 'back to the one pane');
  };
  const expectEmptyExtra = async (what) => {
    await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'a second pane ' + what);
    const extra = leaves(await getLayout(s)).find((p) => p.id !== soloPaneId);
    expect(extra !== undefined && extra.sessionId === null, `the new pane holds no session ${what}, got ${JSON.stringify(extra)}`);
    expect(await s.evalJs(`!!document.querySelector('[data-pane-id=${JSON.stringify(extra.id)}] .empty-pane')`), `the new pane is an empty pane ${what}`);
    await sleep(500);
    expect((await zreq(s, 'session.list', {})).sessions.length === sessionsBefore, `no session started behind the empty pane ${what}`);
    return extra;
  };
  const sessionsBefore = (await zreq(s, 'session.list', {})).sessions.length;

  // Step 1: a plain click gives an empty pane with its filter box focused.
  await s.evalJs(`document.querySelector(${JSON.stringify(rightSel)}).click()`);
  const plain = await expectEmptyExtra('from a plain click');
  await s.waitFor(`document.activeElement?.classList.contains('palette-input') && !!document.activeElement.closest('[data-pane-id=${JSON.stringify(plain.id)}]')`, "the new pane's filter box has focus");
  await closeEmptyExtra();
  step('M9 fix 537: a plain split gives an empty pane with its filter box focused and no session');

  // Step 2: the menu's items.
  await openSplitMenuHere('the split button menu opens');
  expect(await s.evalJs(`!document.querySelector('.pane-menu')`), 'the split menu opens alone, no pane menu over it (M9 fix 536)');
  expect(
    await s.evalJs(`(() => { const first = document.querySelector('.split-menu .menu-item'); const r = first.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.menu-item') === first; })()`),
    "the split menu's first item is on top at its own centre (M9 fix 536)",
  );
  let items343 = await splitMenuItems();
  expect(
    JSON.stringify(items343.map((i) => i.label)) === JSON.stringify(['Split empty', 'Split with shell', 'Split with Claude', 'By default', 'Empty pane', 'Shell', 'Claude']),
    `the split button menu's seven items, got ${JSON.stringify(items343)}`,
  );
  expect(items343[3].heading === true && items343[3].disabled === undefined, 'By default is a menu heading, not a disabled button');
  expect(items343[4].checked === 'true' && items343[5].checked === 'false' && items343[6].checked === 'false', `the default starts on Empty pane, got ${JSON.stringify(items343)}`);

  // Step 3: Split with shell.
  await chooseSplitMenu('Split with shell');
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'a second pane after Split with shell');
  let found = await newPaneKind();
  expect(found.kind === 'shell', `Split with shell started a shell session, got ${JSON.stringify(found)}`);
  await closeExtraPane(found.pane.id, found.pane.sessionId);

  // Step 4: Split with Claude.
  await openSplitMenuHere('the split menu again');
  await chooseSplitMenu('Split with Claude');
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'a second pane after Split with Claude');
  found = await newPaneKind();
  expect(found.kind === 'claude', `Split with Claude started a claude session, got ${JSON.stringify(found)}`);
  await closeExtraPane(found.pane.id, found.pane.sessionId);

  // Step 5: the default set to Claude, then a plain click.
  await openSplitMenuHere('the split menu a third time');
  await chooseSplitMenu('Claude');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.split-menu')`, 'the menu closes, the default set to Claude');
  await s.evalJs(`document.querySelector(${JSON.stringify(rightSel)}).click()`);
  await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'a second pane from the plain button, now on the Claude default');
  found = await newPaneKind();
  expect(found.kind === 'claude', `the plain split now starts a claude session, got ${JSON.stringify(found)}`);
  await closeExtraPane(found.pane.id, found.pane.sessionId);

  // Step 6: Claude reads checked; Split empty still gives an empty pane.
  await openSplitMenuHere('the split menu a fourth time');
  items343 = await splitMenuItems();
  expect(items343[6].checked === 'true' && items343[4].checked === 'false', `Claude now checked, got ${JSON.stringify(items343)}`);
  await chooseSplitMenu('Split empty');
  await expectEmptyExtra('from Split empty');
  await closeEmptyExtra();

  // Step 7: back to the empty default, so the block ends as it found it.
  await openSplitMenuHere('the split menu a fifth time');
  await chooseSplitMenu('Empty pane');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.split-menu')`, 'the menu closes, the default back on the empty pane');
  await s.evalJs(`document.querySelector(${JSON.stringify(rightSel)}).click()`);
  await expectEmptyExtra('from the plain button on the empty default');
  await closeEmptyExtra();

  // The pane the step started with, closed too, so the layout is as found.
  await zreq(s, 'session.kill', { sessionId: soloSessionId, remove: true });
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start') && document.querySelectorAll('.pane').length === 1`, 'back to the empty pane the run started from');
  step('M9 fix 343 and 537: the split menu offers an empty pane, a shell or a Claude for one split and picks the default among the three');

  // The sidebar's own menus (M32): a right click on the heading offers
  // the two orders with the current one marked, and a right click on a
  // folder heading's + offers a Claude session in that folder.
  const header = await centerOf(s, '.sidebar-header');
  await s.rightClick(header.x, header.y);
  await s.waitFor(`!!document.querySelector('.order-menu')`, 'the order menu');
  const orderItems = await s.evalJs(`[...document.querySelectorAll('.order-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent + (b.querySelector('.menu-hint') ? ' (' + b.querySelector('.menu-hint').textContent + ')' : ''))`);
  expect(JSON.stringify(orderItems) === JSON.stringify(['Order: as created (current)', 'Order: by state']), 'order menu items, got ' + JSON.stringify(orderItems));
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.order-menu')`, 'Escape closed the order menu');
  expect((await s.evalJs(`document.querySelectorAll('.sidebar-group-add').length`)) === 1, 'one + for the one folder heading');
  const plus = await centerOf(s, '.sidebar-group-add');
  await s.rightClick(plus.x, plus.y);
  await s.waitFor(`!!document.querySelector('.group-menu')`, 'the + menu');
  const addItems = await s.evalJs(`[...document.querySelectorAll('.group-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent)`);
  expect(JSON.stringify(addItems) === JSON.stringify(['New Claude session here', 'Other shell here', 'Commits in a pane', 'Commits in a tab', 'Statistics in a tab']) && (await s.evalJs(`document.querySelector('.group-menu').dataset.folder`)) === os.homedir(), 'the + menu offers Claude in the folder, the commits view (M52), the commits tab (M61) and the Statistics tab (M9 fix 837), got ' + JSON.stringify(addItems));
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.group-menu')`, 'Escape closed the + menu');
  step('Sidebar menus: the order on the heading, Claude and a commits view on a folder heading\'s +');

  // The sidebar rail.
  await s.key('B', 'KeyB', 66, CTRL | SHIFT);
  await s.waitFor(`!document.querySelector('.sidebar') && !!document.querySelector('.sidebar-rail .sidebar-expand')`, 'rail after Ctrl+Shift+B');
  await s.screenshot('m9-menus-rail.png');
  const rail = await centerOf(s, '.sidebar-expand');
  await s.click(rail.x, rail.y);
  await s.waitFor(`!!document.querySelector('.sidebar') && !document.querySelector('.sidebar-rail')`, 'sidebar back from the rail button');
  await s.evalJs(`document.querySelector('.sidebar-collapse').click()`);
  await s.waitFor(`!!document.querySelector('.sidebar-rail')`, 'rail after the header button');
  await s.evalJs(`document.querySelector('.sidebar-expand').click()`);
  await s.waitFor(`!!document.querySelector('.sidebar')`, 'sidebar back again');
  step('Sidebar rail brings the sidebar back');

  // The layout tab's menu (M36): Rename and Close tab, off on the last tab,
  // then on once + has made a second one, and the strip's + itself.
  const tabItems = (s) => s.evalJs(`[...document.querySelectorAll('.layout-tab-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent + (b.disabled ? ' (disabled)' : ''))`);
  const tabCenter = await centerOf(s, '.tab.tab-panes');
  await s.rightClick(tabCenter.x, tabCenter.y);
  await s.waitFor(`!!document.querySelector('.layout-tab-menu')`, 'the layout tab menu');
  // M63: Shade all and Lift all sit between them, off here since the one pane left is empty.
  expect((await tabItems(s)).join(',') === 'Rename,Shade all (disabled),Lift all (disabled),Move to new window (disabled),Close tab (disabled)', 'Rename, the shade pair off on an empty pane, and a disabled Close tab on the last tab, got ' + JSON.stringify(await tabItems(s)));
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.layout-tab-menu')`, 'tab menu closed');
  expect(await s.evalJs(`!!document.querySelector('.tab-add')`), 'the + after the tabs');
  await s.evalJs(`document.querySelector('.tab-add').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 2`, 'a second tab from the +');
  const second = await centerOf(s, '.tab.tab-panes[data-current]');
  await s.rightClick(second.x, second.y);
  await s.waitFor(`!!document.querySelector('.layout-tab-menu')`, 'the second tab menu');
  expect((await tabItems(s)).join(',') === 'Rename,Shade all (disabled),Lift all (disabled),Move to new window,Close tab', 'Close tab is on with two tabs, got ' + JSON.stringify(await tabItems(s)));
  await s.evalJs(`[...document.querySelectorAll('.layout-tab-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Close tab').click()`);
  await s.waitFor(`document.querySelectorAll('.tab.tab-panes').length === 1`, 'the tab closed from its menu');
  step('Layout tab menu: Rename, Shade all and Lift all (off on an empty pane), Close tab off on the last tab; the + makes one');

  // The app menu on the Z mark (M9 fix 234): the mark is a button and the
  // row's other no-drag spot; a click opens What's new with the build's
  // version as its hint, Key cheat sheet and Run an action... with their
  // keys; What's new opens the tab active, the cheat sheet the sheet, and
  // a second click on the mark closes the menu.
  const appItems = (s) => s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].map(b => b.querySelector('.menu-label').textContent + '|' + (b.querySelector('.menu-hint')?.textContent ?? ''))`);
  const markProbe = await s.evalJs(
    `(() => { const m = document.querySelector('.title-bar-mark'); const st = getComputedStyle(m); return { tag: m.tagName, text: m.textContent.trim(), title: m.getAttribute('title'), region: st.getPropertyValue('app-region') || st.webkitAppRegion || null }; })()`,
  );
  expect(markProbe.tag === 'BUTTON' && markProbe.text === 'Z' && markProbe.title === 'Menu' && markProbe.region === 'no-drag', `the Z mark is a no-drag button with a Menu tooltip (${JSON.stringify(markProbe)})`);
  const mark = await centerOf(s, '.title-bar-mark');
  await s.click(mark.x, mark.y);
  await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu under the Z');
  const version = await s.evalJs(`window.emerald.info().then((i) => i.version)`);
  const pkgVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  expect(version === pkgVersion, `the app says its own package version, not Electron's (${version} vs ${pkgVersion})`);
  const appList = await appItems(s);
  // The fourth item (M9 fix 239) reads the updater, off under EMERALD_NO_UPDATE.
  // Open a file… first (M9 fix 341), its plain chord since M9 fix 364.
  // The skin item (M9 fix 569) sits before the check item, which stays last.
  // New window (M9 fix 866) goes second, the harness daemon being at level 73;
  // the usage record's switch (M9 fix 887) sits after the skin.
  expect(JSON.stringify(appList) === JSON.stringify(['Open a file…|Ctrl+Shift+G', 'New window|', `What's new|${version}`, 'Key cheat sheet|Ctrl+Shift+?', 'Run an action…|Ctrl+Shift+P', 'Skin: Classic|', 'Usage record: off|', 'Check for updates|off in this build']), "Open a file with its chord, New window, What's new with the version, the cheat sheet and the palette with their keys, the skin item, the usage record, Check for updates off, got " + JSON.stringify(appList));
  expect(await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].at(-1).disabled`), 'the check item is disabled while the updater is off');
  const menuBox = await s.evalJs(`(() => { const m = document.querySelector('.app-menu').getBoundingClientRect(); const z = document.querySelector('.title-bar-mark').getBoundingClientRect(); return { under: m.top >= z.bottom - 1, left: Math.abs(m.left - z.left) <= 2 }; })()`);
  expect(menuBox.under && menuBox.left, `the menu hangs from the mark's bottom left (${JSON.stringify(menuBox)})`);
  await s.screenshot('app-menu-234.png');
  await s.click(mark.x, mark.y);
  await s.waitFor(`!document.querySelector('.app-menu')`, 'a second click on the mark closes the menu');
  await s.click(mark.x, mark.y);
  await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu again');
  await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === "What's new").click()`);
  await s.waitFor(`!document.querySelector('.app-menu') && document.querySelector('.whats-new-view')?.dataset.state === 'text' && !!document.querySelector('.tab-file[data-active]')`, "What's new opened the tab active with the notes read", 15000);
  await s.key('w', 'KeyW', 87, CTRL);
  await s.waitFor(`!document.querySelector('.whats-new-view')`, 'Ctrl+W closed the tab');
  await s.click(mark.x, mark.y);
  await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu a third time');
  await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === 'Key cheat sheet').click()`);
  await s.waitFor(`!document.querySelector('.app-menu') && !!document.querySelector('.cheat-sheet')`, 'Key cheat sheet opened the sheet');
  expect(await s.evalJs(`document.querySelector('.cheat-sheet .cheat-ways')?.textContent.includes('Ctrl+Shift+P') && document.querySelector('.cheat-sheet .cheat-ways')?.textContent.includes('the Z at the top left')`), "the sheet names the palette's key and the menu");
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.cheat-sheet')`, 'Escape closed the sheet');
  expect(await s.evalJs(`document.querySelector('.empty-pane')?.textContent.includes('Right-click any pane for more, or the Z at the top left.') === !!document.querySelector('.empty-state')`), 'the Right-click sentence shows only in the No sessions block');
  step("App menu on the Z mark: What's new with the version, the cheat sheet and the palette, the tab and the sheet open from it");
  // M9 fix 887: the usage record's switch is on the app menu, after the skin and before the check; a click flips it and the mark's data-usage, and the speaker's menu no longer lists it.
  const usageItem887 = () => s.evalJs(`(() => { const items = [...document.querySelectorAll('.app-menu .menu-item')]; const i = items.findIndex((b) => b.querySelector('.menu-label').textContent.startsWith('Usage record: ')); return { i, n: items.length, label: items[i]?.querySelector('.menu-label').textContent ?? null, title: items[i]?.getAttribute('title') ?? '' }; })()`);
  await s.click(mark.x, mark.y);
  await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu for the usage switch');
  const usageOff887 = await usageItem887();
  // Item 6 of 8: New window (M9 fix 866) sits second at the harness's level 73.
  expect(usageOff887.i === 6 && usageOff887.n === 8 && usageOff887.label === 'Usage record: off' && usageOff887.title.includes('never sent anywhere') && usageOff887.title.endsWith('Click to turn it on'), `the usage record is item 6 of 8, off, with its title (${JSON.stringify(usageOff887)})`);
  await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')][${usageOff887.i}].click()`);
  await s.waitFor(`!document.querySelector('.app-menu') && document.querySelector('.title-bar-mark')?.dataset.usage === 'on'`, 'the usage switch on from the app menu');
  expect(await s.evalJs(`JSON.parse(localStorage.getItem('emerald.attention')).usage === true`), 'the switch is kept in emerald.attention');
  await s.click(mark.x, mark.y);
  await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu again for the usage switch');
  const usageOn887 = await usageItem887();
  expect(usageOn887.label === 'Usage record: on' && usageOn887.title.endsWith('Click to turn it off'), `the item reads on with the off title (${JSON.stringify(usageOn887)})`);
  await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')][${usageOn887.i}].click()`);
  await s.waitFor(`!document.querySelector('.app-menu') && document.querySelector('.title-bar-mark')?.dataset.usage === 'off'`, 'the usage switch off again');
  const speaker887 = await centerOf(s, '.attention-sound');
  await s.rightClick(speaker887.x, speaker887.y);
  await s.waitFor(`!!document.querySelector('.attention-menu')`, 'the speaker menu open');
  const speakerLabels887 = await s.evalJs(`[...document.querySelectorAll('.attention-menu .menu-label')].map((b) => b.textContent)`);
  expect(speakerLabels887.length === 4 && !speakerLabels887.some((t) => t.startsWith('Usage record')), `the speaker menu holds four labels and no usage record (${JSON.stringify(speakerLabels887)})`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.attention-menu')`, 'the speaker menu closed');
  step("M9 fix 887: Usage record on the app menu after the skin, a click flips it and the mark's data-usage, and the speaker menu holds the sound and notifications alone");
  // M9 fix 239: the title row's buttons are counted whole, and the update
  // badge is not among them while the check is off; the one button is
  // fix 234's mark. A branch adding a button to the row changes the count.
  const titleButtons = await s.evalJs(`[...document.querySelectorAll('.title-bar button')].map((b) => b.className)`);
  expect(titleButtons.length === 1 && titleButtons[0] === 'title-bar-mark', `the title row's one button is the Z mark with the update check off, got ${JSON.stringify(titleButtons)}`);
  expect(await s.evalJs(`document.querySelector('.title-bar-update') === null`), 'no update badge under EMERALD_NO_UPDATE');
  const updateState = await s.evalJs(`window.emerald.update.state()`);
  expect(updateState.phase === 'off' && typeof updateState.current === 'string' && /^\d+\.\d+\.\d+$/.test(updateState.current), `the updater says off and names the build (${JSON.stringify(updateState)})`);
  step('M9 fix 239: no update badge on the title row under EMERALD_NO_UPDATE, the updater off');

  // M9 fix 242: the same window with the updater on and pointed at a port
  // nothing serves (a box that only ever installed by hand); the launch
  // check fails to connect, and the item's hint says so as a fact rather
  // than a fault, on the check the app runs and on a click alike, with
  // no badge and no error phase. The port is one the OS just handed out
  // and let go, so nothing answers on it.
  const emptyPort = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.once('error', reject);
  });
  s.close();
  killTree(s.child);
  s = await launch(freshPort(), { env: { EMERALD_UPDATE_URL: `http://127.0.0.1:${emptyPort}/` } });
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane after the relaunch');
  const noFeed = `no feed at 127.0.0.1:${emptyPort}`;
  await s.waitFor(`window.emerald.update.state().then((u) => u.phase === 'idle' && u.message === ${JSON.stringify(noFeed)})`, `the launch check found no feed (${noFeed})`, 20000);
  expect(await s.evalJs(`document.querySelector('.title-bar-update') === null`), 'no badge for a missing feed');
  await s.click(mark.x, mark.y);
  await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu with the updater on');
  const checkItem = () => s.evalJs(`(() => { const b = [...document.querySelectorAll('.app-menu .menu-item')].at(-1); return { label: b.querySelector('.menu-label').textContent, hint: b.querySelector('.menu-hint')?.textContent ?? '', disabled: b.disabled }; })()`);
  let item = await checkItem();
  expect(item.label === 'Check for updates' && item.hint === noFeed && item.disabled === false, `the check item's hint says where the update stands, got ${JSON.stringify(item)}`);
  await s.screenshot('m9-fix242-no-feed.png');
  await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].at(-1).click()`);
  await s.waitFor(`window.emerald.update.state().then((u) => u.phase === 'idle' && u.message === ${JSON.stringify(noFeed)})`, 'the click met the refused connection and reads no feed, not failed', 20000);
  const clicked = await s.evalJs(`window.emerald.update.state()`);
  expect(clicked.phase === 'idle' && clicked.message === noFeed, `a click that meets no feed stays idle with the fact (${JSON.stringify(clicked)})`);
  expect(await s.evalJs(`document.querySelector('.title-bar-update') === null`), 'still no badge after the click');
  if (await s.evalJs(`!document.querySelector('.app-menu')`)) await s.click(mark.x, mark.y);
  await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu after the click');
  item = await checkItem();
  expect(item.hint === noFeed, `the hint after the click reads the no feed line, got ${JSON.stringify(item)}`);
  await s.click(mark.x, mark.y);
  await s.waitFor(`!document.querySelector('.app-menu')`, 'the menu closed');
  step('M9 fix 242: Check for updates on a box with no feed says no feed at <host>, on the launch check and on a click, no badge');
  await s.screenshot('m9-menus-final.png');

  // M9 fix 624: Command Prompt from Other shell here starts a cmd shell
  // beside the pane. Before fix 647's steps, which start from the pane it leaves.
  const before = new Set((await zreq(s, 'session.list', {})).sessions.map((x) => x.id));
  const focusedPane = (await getLayout(s)).focusedPaneId;
  await openMenuOn(s, focusedPane);
  await chooseMenu(s, 'Other shell here');
  await s.waitFor(`!!document.querySelector('.menu-sub')`, 'the other shells list on the focused pane');
  await s.evalJs(`[...document.querySelectorAll('.menu-sub .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Command Prompt').click()`);
  let cmdRow = null;
  for (let i = 0; i < 100 && cmdRow === null; i++) {
    cmdRow = (await zreq(s, 'session.list', {})).sessions.find((x) => !before.has(x.id) && x.shell === 'cmd') ?? null;
    if (cmdRow === null) await sleep(100);
  }
  expect(cmdRow !== null, 'a new cmd session after Command Prompt');
  await s.waitFor(`!document.querySelector('.pane-menu')`, 'the menu closed after Command Prompt');
  let shown = false;
  for (let i = 0; i < 100 && !shown; i++) {
    shown = leaves(await getLayout(s)).some((p) => p.sessionId === cmdRow.id);
    if (!shown) await sleep(100);
  }
  expect(shown, 'a pane shows the cmd session');
  step('M9 fix 624: Command Prompt from Other shell here starts a cmd shell beside the pane');
  console.log('[verify] layout before fix 647:', JSON.stringify(leaves(await getLayout(s)).map((p) => [p.id.slice(0, 8), p.sessionId?.slice(0, 8) ?? null])));

  // M9 fix 647 (a): the palette lists a shell past the default in its Pane
  // group, and Enter starts it beside the pane.
  const offered647 = (await s.evalJs('window.emerald.daemonInfo()')).shells.slice(1);
  const want = offered647.find((o) => o.id === 'gitbash') ?? offered647.find((o) => o.id === 'cmd');
  expect(want !== undefined, 'a shell past the default is installed');
  const startSessions = new Set((await zreq(s, 'session.list', {})).sessions.map((x) => x.id));
  const cmdPane = leaves(await getLayout(s)).find((p) => p.sessionId === cmdRow.id);
  const cmdCentre = await centerOf(s, `[data-pane-id=${JSON.stringify(cmdPane.id)}] .term-host`);
  await s.click(cmdCentre.x, cmdCentre.y);
  for (let i = 0; i < 50 && (await getLayout(s)).focusedPaneId !== cmdPane.id; i++) await sleep(100);
  expect((await getLayout(s)).focusedPaneId === cmdPane.id, 'the cmd pane focused');
  await s.key('P', 'KeyP', 80, CTRL | SHIFT);
  await s.waitFor(`document.querySelector('.picker-overlay .palette-input')?.dataset.mode === 'actions'`, 'the palette in action mode');
  await s.type(want.id === 'gitbash' ? 'git' : 'prompt');
  const rowSel = `.picker-overlay .action-row[data-kind="pane"][data-shell=${JSON.stringify(want.id)}]`;
  await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel)})`, `the ${want.label} pane row`);
  const shellRow = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(rowSel)}); return { label: r.querySelector('.action-label').textContent, detail: r.querySelector('.action-detail').textContent }; })()`);
  expect(shellRow.label === `New ${want.label} here` && shellRow.detail === cmdRow.name, `the row reads New ${want.label} here and names the session ${cmdRow.name}, got ${JSON.stringify(shellRow)}`);
  for (let i = 0; i < 12 && !(await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.highlighted === 'true'`)); i++) await s.key('ArrowDown', 'ArrowDown', 40);
  expect(await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)})?.dataset.highlighted === 'true'`), 'the shell row is highlighted');
  await s.key('Enter', 'Enter', 13);
  let paletteShell = null;
  for (let i = 0; i < 100 && paletteShell === null; i++) {
    paletteShell = (await zreq(s, 'session.list', {})).sessions.find((x) => !startSessions.has(x.id) && x.shell === want.id) ?? null;
    if (paletteShell === null) await sleep(100);
  }
  expect(paletteShell !== null, `a new ${want.id} session after Enter on the palette row`);
  let paletteShown = false;
  for (let i = 0; i < 100 && !paletteShown; i++) {
    paletteShown = leaves(await getLayout(s)).some((p) => p.sessionId === paletteShell.id);
    if (!paletteShown) await sleep(100);
  }
  expect(paletteShown, 'a pane shows the palette-started shell');
  step('M9 fix 647: >git lists New Git Bash here in the Pane group and Enter starts Git Bash beside the pane');

  // M9 fix 647 (b): the empty pane's Shell tile picks which shell it starts.
  const shells647 = (await s.evalJs('window.emerald.daemonInfo()')).shells;
  // The panes the earlier steps left, split twice more, are narrower than a tile can draw its caret in, so the viewport is widened for these reads (cleared after).
  const viewport647 = await s.evalJs('({ width: innerWidth, height: innerHeight })');
  await s.send('Emulation.setDeviceMetricsOverride', { width: 2400, height: viewport647.height, deviceScaleFactor: 0, mobile: false });
  const emptyFocused = async () => {
    for (let i = 0; i < 100; i++) {
      const id = (await getLayout(s)).focusedPaneId;
      if (await s.evalJs(`!!document.querySelector('[data-pane-id=${JSON.stringify(id)}] .empty-pane[data-mode="empty"]')`)) return id;
      await sleep(100);
    }
    throw new Error('timed out waiting for a focused empty pane');
  };
  const tileRead = (id) =>
    s.evalJs(`(() => { const p = document.querySelector('[data-pane-id=${JSON.stringify(id)}]'); const t = p.querySelector('.empty-kind[data-kind="shell"]'); return { pressed: t.getAttribute('aria-pressed'), sub: t.querySelector('.empty-kind-sub').textContent, caret: !!t.querySelector('.empty-kind-caret'), start: p.querySelector('.empty-start').textContent, stored: localStorage.getItem('emerald.emptyPaneShell') }; })()`);
  // A new pane's box is still settling when it is first measured (the point
  // read at once hit the glyph beside the caret), so the click waits until
  // the caret is the element under its own centre.
  const openCaret = async (id) => {
    const sel = `[data-pane-id=${JSON.stringify(id)}] .empty-kind-caret`;
    let c = null;
    for (let i = 0; i < 50; i++) {
      c = await centerOf(s, sel);
      if (await s.evalJs(`document.elementFromPoint(${c.x}, ${c.y})?.classList.contains('empty-kind-caret') === true`)) break;
      await sleep(100);
    }
    await s.click(c.x, c.y);
    await s.waitFor(`!!document.querySelector('.shell-menu')`, 'the shell menu');
  };
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  const tilePane = await emptyFocused();
  const before647 = await tileRead(tilePane);
  expect(before647.caret && before647.sub === 'your default shell, nothing else asked' && before647.stored === null, `the Shell tile has a caret and no pick, got ${JSON.stringify(before647)}`);
  await openCaret(tilePane);
  const shellMenuRows = await s.evalJs(`[...document.querySelectorAll('.shell-menu .menu-item')].map((b) => ({ label: b.querySelector('.menu-label').textContent.replace('\u2713', ''), checked: b.querySelector('.menu-check')?.textContent !== '', hint: b.querySelector('.menu-hint')?.textContent ?? null }))`);
  expect(JSON.stringify(shellMenuRows.map((r) => r.label)) === JSON.stringify(shells647.map((o) => o.label)), `the menu lists the installed shells, got ${JSON.stringify(shellMenuRows)}`);
  expect(shellMenuRows[0].hint === 'default' && shellMenuRows[0].checked && shellMenuRows.slice(1).every((r) => !r.checked && r.hint === null), `the first is the default and checked alone, got ${JSON.stringify(shellMenuRows)}`);
  await s.screenshot('m9-fix647-shell-tile.png');
  await s.evalJs(`[...document.querySelectorAll('.shell-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent.includes('Command Prompt')).click()`);
  await s.waitFor(`!document.querySelector('.shell-menu')`, 'the shell menu closed');
  const picked = await tileRead(tilePane);
  expect(picked.pressed === 'true' && picked.sub === `Command Prompt in place of ${shells647[0].label}` && picked.start.startsWith('Start Command Prompt in') && picked.stored === 'cmd', `the pick shows on the tile and is stored, got ${JSON.stringify(picked)}`);
  const beforeStart = new Set((await zreq(s, 'session.list', {})).sessions.map((x) => x.id));
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(tilePane)}] .empty-start').click()`);
  let tileSession = null;
  for (let i = 0; i < 100 && tileSession === null; i++) {
    const row = (await zreq(s, 'session.list', {})).sessions.find((x) => !beforeStart.has(x.id) && x.shell === 'cmd') ?? null;
    if (row !== null && leaves(await getLayout(s)).some((p) => p.id === tilePane && p.sessionId === row.id)) tileSession = row;
    else await sleep(100);
  }
  expect(tileSession !== null, 'Start started a cmd session in that pane');
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  const secondEmpty = await emptyFocused();
  // An earlier step left the split default on Claude, so the new pane selects that kind; the Shell tile is clicked, which only selects it.
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(secondEmpty)}] .empty-kind[data-kind="shell"]').click()`);
  const remembered = await tileRead(secondEmpty);
  expect(remembered.start.startsWith('Start Command Prompt in') && remembered.stored === 'cmd', `the next empty pane remembers the pick, got ${JSON.stringify(remembered)}`);
  await openCaret(secondEmpty);
  await s.evalJs(`document.querySelector('.shell-menu .menu-item').click()`);
  await s.waitFor(`!document.querySelector('.shell-menu')`, 'the shell menu closed on the default');
  const cleared = await tileRead(secondEmpty);
  expect(cleared.stored === null && cleared.start.startsWith('Start shell in') && cleared.sub === 'your default shell, nothing else asked', `the default clears the pick, got ${JSON.stringify(cleared)}`);
  // M9 fix 705: a double-click on the caret opens and closes the menu and starts nothing.
  const count705 = (await zreq(s, 'session.list', {})).sessions.length;
  let caret705 = null;
  for (let i = 0; i < 50; i++) {
    caret705 = await centerOf(s, `[data-pane-id=${JSON.stringify(secondEmpty)}] .empty-kind-caret`);
    if (await s.evalJs(`document.elementFromPoint(${caret705.x}, ${caret705.y})?.classList.contains('empty-kind-caret') === true`)) break;
    await sleep(100);
  }
  for (const n of [1, 2]) {
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: caret705.x, y: caret705.y, button: 'left', clickCount: n });
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: caret705.x, y: caret705.y, button: 'left', clickCount: n });
  }
  await sleep(600);
  expect((await zreq(s, 'session.list', {})).sessions.length === count705, 'a double-click on the caret started no session');
  expect(await s.evalJs(`!!document.querySelector('[data-pane-id=${JSON.stringify(secondEmpty)}] .empty-pane[data-mode="empty"]')`), 'the pane is still empty after the caret double-click');
  if (await s.evalJs(`!!document.querySelector('.shell-menu')`)) {
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.shell-menu')`, 'the shell menu closed on Escape');
  }
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(secondEmpty)}] .empty-close').click()`);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(secondEmpty)}]')`, 'the secondEmpty empty pane closed');
  await s.send('Emulation.clearDeviceMetricsOverride', {});
  step("M9 fix 647: the Shell tile's caret picks Command Prompt, Start starts it, the next empty pane remembers it, and the default clears the pick, and a double-click on its caret starts nothing (fix 705)");

  // M9 fix 768: the palette picks the empty pane's shell and the terminal colours.
  const pickRow768 = async (sel) => {
    for (let i = 0; i < 40 && !(await s.evalJs(`document.querySelector(${JSON.stringify(sel)})?.dataset.highlighted === 'true'`)); i++) await s.key('ArrowDown', 'ArrowDown', 40);
    expect(await s.evalJs(`document.querySelector(${JSON.stringify(sel)})?.dataset.highlighted === 'true'`), `${sel} highlighted`);
    await s.key('Enter', 'Enter', 13);
  };
  await s.send('Emulation.setDeviceMetricsOverride', { width: 2400, height: viewport647.height, deviceScaleFactor: 0, mobile: false });
  await s.key('E', 'KeyE', 69, CTRL | SHIFT);
  const empty768 = await emptyFocused();
  const box768 = `[data-pane-id=${JSON.stringify(empty768)}] .empty-pane .palette-input`;
  await s.key('P', 'KeyP', 80, CTRL | SHIFT);
  await s.waitFor(`document.querySelector(${JSON.stringify(box768)})?.dataset.mode === 'actions' && document.querySelector(${JSON.stringify(box768)}).value === '>'`, 'the empty pane in action mode');
  await s.type('shell:');
  const shellSel768 = `[data-pane-id=${JSON.stringify(empty768)}] .action-row[data-kind="shell"]`;
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(shellSel768)}).length === ${shells647.length}`, 'the Shell rows');
  const shellRead768 = await s.evalJs(`(() => ({ rows: [...document.querySelectorAll(${JSON.stringify(shellSel768)})].map((r) => ({ label: r.querySelector('.action-label').textContent, shell: r.dataset.shell, checked: r.dataset.checked ?? null, detail: r.querySelector('.action-detail').textContent })), groups: [...document.querySelectorAll('[data-pane-id=${JSON.stringify(empty768)}] .palette-group')].map((g) => g.textContent) }))()`);
  expect(JSON.stringify(shellRead768.rows.map((r) => r.label)) === JSON.stringify(shells647.map((o) => `Shell: ${o.label}`)), `the Shell rows list the installed shells, got ${JSON.stringify(shellRead768)}`);
  expect(shellRead768.rows[0].checked === 'true' && shellRead768.rows[0].detail === 'default · in use' && shellRead768.rows.slice(1).every((r) => r.checked === null), `the default is checked alone, got ${JSON.stringify(shellRead768)}`);
  expect(JSON.stringify(shellRead768.groups) === JSON.stringify(['Shell']), `the group is Shell alone, got ${JSON.stringify(shellRead768.groups)}`);
  const count768 = (await zreq(s, 'session.list', {})).sessions.length;
  await pickRow768(`${shellSel768}[data-shell="cmd"]`);
  await s.waitFor(`localStorage.getItem('emerald.emptyPaneShell') === 'cmd'`, 'the pick stored');
  const tile768 = await tileRead(empty768);
  expect(tile768.pressed === 'true' && tile768.sub === `Command Prompt in place of ${shells647[0].label}`, `the tile shows the pick, got ${JSON.stringify(tile768)}`);
  expect((await s.evalJs(`document.querySelector(${JSON.stringify(box768)}).value`)) === '', 'the box is empty again');
  expect((await zreq(s, 'session.list', {})).sessions.length === count768, 'a pick starts nothing');
  await s.key('P', 'KeyP', 80, CTRL | SHIFT);
  await s.waitFor(`document.querySelector(${JSON.stringify(box768)})?.dataset.mode === 'actions'`, 'the empty pane in action mode again');
  await s.type('shell:');
  await s.waitFor(`document.querySelectorAll(${JSON.stringify(shellSel768)}).length === ${shells647.length}`, 'the Shell rows again');
  await s.key('Enter', 'Enter', 13);
  await s.waitFor(`localStorage.getItem('emerald.emptyPaneShell') === null`, 'the pick cleared');
  const tileClear768 = await tileRead(empty768);
  expect(tileClear768.sub === 'your default shell, nothing else asked', `the first row clears the pick, got ${JSON.stringify(tileClear768)}`);
  await s.evalJs(`document.querySelector('[data-pane-id=${JSON.stringify(empty768)}] .empty-close').click()`);
  await s.waitFor(`!document.querySelector('[data-pane-id=${JSON.stringify(empty768)}]')`, 'the empty pane closed');
  await s.send('Emulation.clearDeviceMetricsOverride', {});
  step('M9 fix 768: on an empty pane >shell: lists Shell: <name> for each installed shell, the default checked, and Enter on Command Prompt picks it for the Shell tile as the caret does, starting nothing');

  const tileCentre768 = await centerOf(s, `[data-pane-id=${JSON.stringify(tilePane)}] .term-host`);
  await s.click(tileCentre768.x, tileCentre768.y);
  for (let i = 0; i < 50 && (await getLayout(s)).focusedPaneId !== tilePane; i++) await sleep(100);
  expect((await getLayout(s)).focusedPaneId === tilePane, 'the cmd session pane focused');
  const root768 = await s.evalJs('document.documentElement.dataset.scheme');
  const overlayRows768 = `.picker-overlay .action-row[data-kind="scheme"]`;
  const openPalette768 = async (text, count) => {
    await s.key('P', 'KeyP', 80, CTRL | SHIFT);
    await s.waitFor(`document.querySelector('.picker-overlay .palette-input')?.dataset.mode === 'actions'`, 'the palette in action mode');
    await s.type(text);
    await s.waitFor(`document.querySelectorAll(${JSON.stringify(overlayRows768)}).length === ${count}`, `${count} rows for ${text}`);
  };
  await openPalette768('colours:', 6);
  const colours768 = await s.evalJs(`(() => ({ rows: [...document.querySelectorAll(${JSON.stringify(overlayRows768)})].map((r) => ({ label: r.querySelector('.action-label').textContent, scope: r.dataset.scope, scheme: r.dataset.scheme, checked: r.dataset.checked ?? null })), groups: [...document.querySelectorAll('.picker-overlay .palette-group')].map((g) => g.textContent) }))()`);
  const names768 = ['emerald', 'emerald gem', 'Dracula', 'One Dark', 'Solarized Dark', 'Tokyo Night'];
  expect(JSON.stringify(colours768.rows.map((r) => r.scheme)) === JSON.stringify(names768) && colours768.rows.every((r) => r.scope === 'window' && r.label === `Terminal colours: ${r.scheme}`), `the window rows list the six schemes, got ${JSON.stringify(colours768)}`);
  expect(JSON.stringify(colours768.rows.filter((r) => r.checked === 'true').map((r) => r.scheme)) === JSON.stringify([root768]), `the window's scheme is checked alone, got ${JSON.stringify(colours768)}`);
  expect(JSON.stringify(colours768.groups) === JSON.stringify(['Terminal colours']), `the group is Terminal colours alone, got ${JSON.stringify(colours768.groups)}`);
  const target768 = root768 === 'Dracula' ? 'Tokyo Night' : 'Dracula';
  await pickRow768(`.picker-overlay .action-row[data-scope="window"][data-scheme=${JSON.stringify(target768)}]`);
  await s.waitFor(`!document.querySelector('.picker-overlay') && document.documentElement.dataset.scheme === ${JSON.stringify(target768)}`, 'the window on the picked scheme');
  expect((await sessionScheme(tileSession.id)) === null, 'the session has no scheme of its own yet');
  await openPalette768('this session:', 7);
  const session768 = await s.evalJs(`(() => [...document.querySelectorAll(${JSON.stringify(overlayRows768)})].map((r) => ({ label: r.querySelector('.action-label').textContent, scope: r.dataset.scope, checked: r.dataset.checked ?? null })))()`);
  expect(session768.every((r) => r.scope === 'session') && session768[0].label === "This session: The window's" && session768[0].checked === 'true', `the clear row is first and checked, got ${JSON.stringify(session768)}`);
  await pickRow768(`.picker-overlay .action-row[data-scope="session"][data-scheme="Solarized Dark"]`);
  let own768 = null;
  for (let i = 0; i < 50 && own768 !== 'Solarized Dark'; i++) {
    own768 = await sessionScheme(tileSession.id);
    if (own768 !== 'Solarized Dark') await sleep(100);
  }
  expect(own768 === 'Solarized Dark', `the session's record holds Solarized Dark, got ${own768}`);
  await s.waitFor(`${hostOf(tilePane)}.emeraldTerm.options.theme.background === '#002b36'`, "the session's terminal on Solarized Dark");
  await openPalette768('this session:', 7);
  await s.key('Enter', 'Enter', 13);
  let cleared768 = 'x';
  for (let i = 0; i < 50 && cleared768 !== null; i++) {
    cleared768 = await sessionScheme(tileSession.id);
    if (cleared768 !== null) await sleep(100);
  }
  expect(cleared768 === null, 'the clear row empties the session record');
  await openPalette768('colours:', 6);
  await pickRow768(`.picker-overlay .action-row[data-scope="window"][data-scheme=${JSON.stringify(root768)}]`);
  await s.waitFor(`document.documentElement.dataset.scheme === ${JSON.stringify(root768)}`, 'the window back on its scheme');
  step("M9 fix 768: >colours: lists Terminal colours: <name> with the window's checked and Enter sets the window's scheme; >this session: lists This session: The window's and the schemes, and Enter puts Solarized Dark on the session's record and clears it again");
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m9-menus-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
