// M9 fixes 569 to 572 acceptance: the Emerald skin behind its setting. The
// app menu's Skin item flips the window between Classic and Emerald with
// no reload and stores the pick; a reload with Emerald stored has the skin
// on <html> before React renders; each flip tells main, which recolours
// the window ground and the caption overlay and keeps the skin in
// skin.json; and under Emerald the Classic scripts' colour reads give the
// Emerald values, with every token of the Emerald block resolving to its
// own value in the real window. The mark (fix 570), the gem (fix 571) and
// the palettes (fix 572) each have a block of their own below, and so do
// the find bar's highlights across a flip (fix 594). The Classic
// scripts hold the Classic reads; this one holds their Emerald twins.
// The harness runs on Classic by EMERALD_SKIN=classic, which cdp.mjs's
// launch sets (M9 fix 628, Emerald the default otherwise); the last block,
// default, alone unsets it and reads the default.
// Uses a private home and pipe unless the environment already names them.
// Run: npm run verify:skin -w @emerald/app
// One block and what it needs: npm run verify:skin -w @emerald/app -- --only colours
// The block names: npm run verify:skin -w @emerald/app -- --list
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MARK_STEPPING } from './mark-step.mjs';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm9-skin-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m9-skin';
const { blockRunner, CTRL, SHIFT, expect, freshPort, getLayout, harnessClaudeHome, killTree, launch, leaves, repoRoot, sleep, splitWithShell, startFromEmpty, startSession, startShellByKey, step, stopDaemon, zreq } = await import('./cdp.mjs');

// Every block puts the window on the skin it reads with skinTo and leaves
// it on Classic, and makes any sessions it needs, so each runs alone under
// --only; none needs another.
const BLOCKS = [
  { name: 'flip', fixes: ['fix-569'], needs: [] },
  { name: 'first-paint', fixes: ['fix-569'], needs: [] },
  { name: 'chrome', fixes: ['fix-569'], needs: [] },
  { name: 'colours', fixes: ['fix-569'], needs: [] },
  { name: 'mark', fixes: ['fix-570', 'fix-593', 'fix-595', 'fix-626'], needs: [] },
  { name: 'gem', fixes: ['fix-571'], needs: [] },
  { name: 'palette', fixes: ['fix-572'], needs: [] },
  { name: 'find', fixes: ['fix-594'], needs: [] },
  { name: 'monaco', fixes: ['fix-655'], needs: [] },
  { name: 'default', fixes: ['fix-628'], needs: [] },
];
const { block, blocksRun, partial } = blockRunner(BLOCKS);

// 360 s for a whole run (330 until the monaco block of M9 fix 655) and
// 180 s under --only. A follower whose block takes the whole run past
// 240 s on a quiet box raises it.
let s = null;
const watchdogMs = partial ? 180000 : 360000;
setTimeout(() => {
  console.error(`[verify] WATCHDOG: run exceeded ${watchdogMs / 1000} s${partial ? ' (--only)' : ''}`);
  if (s !== null) killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, watchdogMs);
step(`watchdog armed at ${watchdogMs / 1000} s${partial ? ' (--only)' : ''}`);

// launch's freshState clears the state files and the profile but not
// main's skin.json, and a stale one would open the window on the last
// run's ground.
const skinFile = path.join(process.env['EMERALD_HOME'], 'skin.json');
fs.rmSync(skinFile, { force: true });
s = await launch(freshPort(), { freshState: true });

// '#rrggbb' to the 'rgb(r, g, b)' a computed style reads.
const rgbOf = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
// What the window computes for a colour value: a probe element's colour.
const resolved = (s, value) =>
  s.evalJs(`(() => { const i = document.createElement('i'); i.style.color = ${JSON.stringify(value)}; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; })()`);
const token = (s, name) => s.evalJs(`getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim()`);
// The window's stdout, where every main-process log() line lands.
const mainLog = () => s.logs.join('');
const countIn = (text, line) => text.split(line).length - 1;
const skinNow = (s) => s.evalJs(`document.documentElement.dataset.skin ?? 'classic'`);
const openAppMenu = async (s) => {
  const c = await s.evalJs(`(() => { const r = document.querySelector('.title-bar-mark').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await s.click(c.x, c.y);
  await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu');
};
// The app menu's skin item, as { label, index, count }, or null.
const skinItem = (s) =>
  s.evalJs(
    `(() => { const items = [...document.querySelectorAll('.app-menu .menu-item')]; const index = items.findIndex((b) => b.querySelector('.menu-label').textContent.startsWith('Skin: ')); return index === -1 ? null : { label: items[index].querySelector('.menu-label').textContent, index, count: items.length, last: items.at(-1).querySelector('.menu-label').textContent }; })()`,
  );
// The person's route to a skin: the app menu's Skin item. Returns at once
// when the window is already on it. Fixes 570 to 572 call this at the top
// of their blocks with 'emerald' and at the end with 'classic'.
async function skinTo(s, skin) {
  if ((await skinNow(s)) === skin) return;
  await openAppMenu(s);
  await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent.startsWith('Skin: ')).click()`);
  await s.waitFor(`(document.documentElement.dataset.skin ?? 'classic') === ${JSON.stringify(skin)}`, `the app menu's Skin item put the window on ${skin}`, 5000);
}
// A node-side poll, for reads off the main log and the home folder.
async function until(fn, what, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const readSkinFile = () => {
  try {
    return JSON.parse(fs.readFileSync(skinFile, 'utf8'));
  } catch {
    return null;
  }
};

const CLASSIC_LINE = 'skin classic: ground #1e1e1e, title bar overlay #202020, symbols #9a9a9a';
const EMERALD_LINE = 'skin emerald: ground #1a1f1d, title bar overlay #1c211f, symbols #9a9a9a';

try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'the empty pane');
  expect((await skinNow(s)) === 'classic', 'the window starts with no data-skin');
  expect((await s.evalJs(`localStorage.getItem('emerald.skin')`)) === 'classic', 'the entry stores the skin it applied, Classic included');
  expect((await token(s, '--focus')) === '#e8a33d', 'the Classic --focus');
  expect((await s.evalJs(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(30, 30, 30)', 'the Classic ground');
  const zColour = await s.evalJs(`getComputedStyle(document.querySelector('.title-bar-mark')).color`);
  expect(zColour === 'rgb(232, 163, 61)', `the Z in --brand, got ${zColour}`);
  expect(mainLog().includes('window opens in the classic skin'), 'main opened the window in Classic');
  await until(() => mainLog().includes(CLASSIC_LINE), "main heard the renderer's start");
  step('M9 fix 569: the window starts on Classic, stored as classic, main told, the Z in --brand');

  await block('flip', async () => {
    await s.evalJs(`window.__skin569 = true`);
    await openAppMenu(s);
    const before = await skinItem(s);
    expect(before !== null && before.label === 'Skin: Classic' && before.last === 'Check for updates', `the skin item reads Skin: Classic with the check item still last, got ${JSON.stringify(before)}`);
    await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')][${before.index}].click()`);
    await s.waitFor(`document.documentElement.dataset.skin === 'emerald'`, 'data-skin emerald', 5000);
    expect((await token(s, '--focus')) === '#3ecf8e', 'the Emerald --focus');
    expect((await s.evalJs(`localStorage.getItem('emerald.skin')`)) === 'emerald', 'emerald.skin stored');
    expect(await s.evalJs(`!document.querySelector('.app-menu')`), 'the menu closed on the click');
    expect(await s.evalJs(`window.__skin569 === true`), 'no reload');
    await openAppMenu(s);
    const after = await skinItem(s);
    expect(after !== null && after.label === 'Skin: Emerald', `the item names Emerald now, got ${JSON.stringify(after)}`);
    await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')][${after.index}].click()`);
    await s.waitFor(`document.documentElement.dataset.skin === undefined`, 'data-skin gone', 5000);
    expect((await token(s, '--focus')) === '#e8a33d', 'the Classic --focus again');
    expect((await s.evalJs(`localStorage.getItem('emerald.skin')`)) === 'classic', 'emerald.skin back to classic');
    step('M9 fix 569: Skin: Classic on the app menu flips the window to Emerald (data-skin, --focus #3ecf8e, emerald.skin stored) with no reload, and Skin: Emerald flips it back');
  });

  await block('first-paint', async () => {
    await skinTo(s, 'emerald');
    const { identifier } = await s.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `document.addEventListener('DOMContentLoaded', () => { window.__firstBg = getComputedStyle(document.body).backgroundColor; window.__firstSkin = document.documentElement.dataset.skin ?? null; }, { once: true });`,
    });
    await s.send('Page.reload');
    await s.waitFor(`!!document.querySelector('.app-body')`, 'the app after the reload', 20000);
    await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'the empty pane after the reload');
    const first = await s.evalJs(`({ bg: window.__firstBg ?? null, skin: window.__firstSkin ?? null })`);
    expect(first.bg === 'rgb(26, 31, 29)' && first.skin === 'emerald', `the body at the Emerald ground and data-skin set by DOMContentLoaded, got ${JSON.stringify(first)}`);
    await s.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await skinTo(s, 'classic');
    step('M9 fix 569: a reload with Emerald stored has the skin on <html> and the body at rgb(26, 31, 29) by DOMContentLoaded, before React renders');
  });

  await block('chrome', async () => {
    const emeraldBefore = countIn(mainLog(), EMERALD_LINE);
    const classicBefore = countIn(mainLog(), CLASSIC_LINE);
    await skinTo(s, 'emerald');
    await until(() => countIn(mainLog(), EMERALD_LINE) === emeraldBefore + 1, "main's emerald line");
    expect(readSkinFile()?.skin === 'emerald', `skin.json reads emerald, got ${JSON.stringify(readSkinFile())}`);
    await skinTo(s, 'classic');
    await until(() => countIn(mainLog(), CLASSIC_LINE) === classicBefore + 1, "main's classic line");
    await until(() => readSkinFile()?.skin === 'classic', 'skin.json back to classic');
    step('M9 fix 569: each flip tells main, which recolours the title bar overlay (#1c211f under Emerald) and the window ground and keeps the skin in skin.json for the next window');
  });

  await block('colours', async () => {
    await startFromEmpty(s);
    await splitWithShell(s, '.pane.focused .pane-split-right');
    await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'two shells side by side');
    const layout = await getLayout(s);
    const focused = layout.focusedPaneId;
    const other = layout.root.kind === 'split' ? [layout.root.first, layout.root.second].find((n) => n.kind === 'pane' && n.id !== focused)?.id : null;
    expect(typeof other === 'string', 'the other pane');
    const focusedSel = `[data-pane-id=${JSON.stringify(focused)}]`;
    await skinTo(s, 'emerald');
    const EMERALD = 'rgb(62, 207, 142)';

    // The titles (verify-m9-fixes.mjs:2347 and :2348's twins).
    const titleStyle = (paneId) =>
      s.evalJs(
        `(() => { const p = document.querySelector('[data-pane-id=${JSON.stringify(paneId)}]'); const t = p.querySelector('.pane-title'); return { focused: p.classList.contains('focused'), bg: getComputedStyle(t).backgroundColor }; })()`,
      );
    const tFocused = await titleStyle(focused);
    const tOther = await titleStyle(other);
    expect(tFocused.focused && tFocused.bg === 'rgb(26, 44, 35)', `the focused title on the Emerald header, got ${JSON.stringify(tFocused)}`);
    expect(!tOther.focused && tOther.bg === 'rgb(33, 40, 37)', `the other title on the Emerald plain header, got ${JSON.stringify(tOther)}`);

    // The header ground just under the ring (:2452's twin), read as pixels.
    const pixels = async (x, y, w, h) => {
      const r = await s.send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 1 } });
      return s.evalJs(
        `new Promise((resolve) => { const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; const out = []; for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]); resolve(out); }; img.src = 'data:image/png;base64,' + ${JSON.stringify(r.data)}; })`,
      );
    };
    const hasPx = (px, [r, g, b]) => px.some(([pr, pg, pb]) => Math.abs(pr - r) < 10 && Math.abs(pg - g) < 10 && Math.abs(pb - b) < 10);
    const ringBox = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(focusedSel)}).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    const underEdge = await pixels(ringBox.x + Math.floor(ringBox.w / 2), ringBox.y + 4, 2, 2);
    expect(hasPx(underEdge, [26, 44, 35]), `the Emerald header ground under the ring, got ${JSON.stringify(underEdge.slice(0, 4))}`);

    // An empty pane's ring and the active tab's top line (:2360, :2361).
    const emptyBefore = await s.evalJs(`document.querySelectorAll('.empty-pane').length`);
    await s.key('E', 'KeyE', 69, CTRL | SHIFT);
    await s.waitFor(`document.querySelector('.pane.focused .empty-pane') !== null`, 'an empty pane split off and focused');
    const emptyRing = await s.evalJs(`getComputedStyle(document.querySelector('.pane.focused'), '::after').borderTopColor`);
    const tabTop = await s.evalJs(`getComputedStyle(document.querySelector('.tab-strip .tab[data-active]')).borderTopColor`);
    expect(emptyRing === EMERALD && tabTop === EMERALD, `an empty focused pane's ring and the tab line in emerald, got ${emptyRing} and ${tabTop}`);
    await s.key('W', 'KeyW', 87, CTRL | SHIFT);
    await s.waitFor(`document.querySelectorAll('.empty-pane').length === ${emptyBefore}`, 'the empty pane closed again');
    await s.evalJs(`document.querySelector(${JSON.stringify(focusedSel)}).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))`);

    // A default button (:2379).
    const button = await s.evalJs(`(() => { const b = document.createElement('button'); b.textContent = 'x'; document.body.append(b); const c = getComputedStyle(b); const out = { bg: c.backgroundColor, ink: c.color }; b.remove(); return out; })()`);
    expect(button.bg === EMERALD && button.ink === 'rgb(4, 32, 15)', `a default button is emerald with its dark ink, got ${JSON.stringify(button)}`);

    // The strip's filler and the active tab's bottom edge (:2415 to :2423),
    // and the tabs script's active tab and + (verify-m11-tabs.mjs:387).
    const edges = await s.evalJs(
      `(() => { const st = document.querySelector('.tab-strip'); const active = st.querySelector('.tab[data-active]'); const add = document.querySelector('.tab-add'); return { filler: getComputedStyle(st, '::after').borderBottomColor, active: getComputedStyle(active).borderBottomColor, add: add === null ? null : getComputedStyle(add).borderBottomColor }; })()`,
    );
    expect(edges.filler === 'rgb(41, 48, 45)' && edges.active === 'rgb(26, 31, 29)', `the strip's hairline and the active tab's edge, got ${JSON.stringify(edges)}`);
    expect(edges.add === null || edges.add === 'rgb(41, 48, 45)', `the + carries the hairline, got ${JSON.stringify(edges)}`);

    // The dialog's folder box and radio, the rename box (:2392 to :2405).
    const focusStyle = (sel) =>
      s.evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); const c = getComputedStyle(el); return { active: document.activeElement === el, border: c.borderColor }; })()`);
    const paneMenu = async (label) => {
      const c = await s.evalJs(`(() => { const r = document.querySelector(${JSON.stringify(focusedSel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await s.rightClick(c.x, c.y);
      await s.waitFor(`!!document.querySelector('.pane-menu')`, `the pane menu for ${label}`);
      await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find(b => b.querySelector('.menu-label').textContent === ${JSON.stringify(label)}).click()`);
    };
    await paneMenu('New Claude session here');
    await s.waitFor(`!!document.querySelector('.dialog.new-session input[name=cwd]')`, 'the new session dialog');
    const cwdBox = await focusStyle('.dialog.new-session input[name=cwd]');
    const radio = await s.evalJs(`getComputedStyle(document.querySelector('.dialog.new-session input[name=kind][value=shell]')).accentColor`);
    expect(cwdBox.active && cwdBox.border === EMERALD && radio === EMERALD, `the folder box border and the radios in emerald, got ${JSON.stringify(cwdBox)} and ${radio}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.dialog.new-session')`, 'Escape closed the dialog');
    await paneMenu('Rename session');
    await s.waitFor(`document.activeElement?.className === 'pane-rename'`, 'the rename box');
    const renameBox = await focusStyle('.pane-rename');
    expect(renameBox.border === EMERALD, `the rename box border in emerald, got ${JSON.stringify(renameBox)}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.pane-rename')`, 'Escape cancelled the rename');

    // A selection keeps the terminal's blue on both skins (:2408, :2409).
    const selection = await s.evalJs(`getComputedStyle(document.querySelector('.sidebar-row-name'), '::selection').backgroundColor`);
    expect(selection === 'rgba(74, 144, 217, 0.3)', `a selected run in the terminal blue, got ${selection}`);

    // The composition view on the skin's ground and ink (:2506).
    const compose = (type, data) =>
      s.evalJs(
        `(() => { const ta = document.querySelector(${JSON.stringify(`${focusedSel} .xterm-helper-textarea`)}); ta.dispatchEvent(new CompositionEvent(${JSON.stringify(type)}, { data: ${JSON.stringify(data)}, bubbles: true })); return true; })()`,
      );
    await compose('compositionstart', '');
    await compose('compositionupdate', 'the quick brown fox jumps over the lazy');
    await s.waitFor(`document.querySelector(${JSON.stringify(`${focusedSel} .composition-view.active`)})?.textContent.length > 20`, 'the composition view shows the string');
    const composed = await s.evalJs(`(() => { const v = document.querySelector(${JSON.stringify(`${focusedSel} .composition-view`)}); return { bg: getComputedStyle(v).backgroundColor, ink: getComputedStyle(v).color }; })()`);
    await compose('compositionend', '');
    expect(composed.bg === 'rgb(26, 31, 29)' && composed.ink === 'rgb(212, 212, 212)', `the composition view on the Emerald ground, got ${JSON.stringify(composed)}`);

    // Reads whose Classic fixture this script would have to rebuild: a
    // probe element carrying the Classic read's selector.
    const probe = (html, sel, prop) =>
      s.evalJs(`(() => { const d = document.createElement('div'); d.innerHTML = ${JSON.stringify(html)}; document.body.append(d); const v = getComputedStyle(d.querySelector(${JSON.stringify(sel)}))[${JSON.stringify(prop)}]; d.remove(); return v; })()`);
    const staged = await probe('<div class="files-row" data-git="staged"><span class="git-letter">A</span></div>', '.git-letter', 'color');
    const modified = await probe('<div class="files-row" data-git="modified"><span class="git-letter">M</span></div>', '.git-letter', 'color');
    expect(staged === 'rgb(157, 180, 200)' && modified === EMERALD, `the git letters in silver-blue and emerald (verify-m10-files.mjs:591, :592), got ${staged} and ${modified}`);
    const debt = await probe('<svg><path class="activity-debt-fill" d="M0,0L1,1"></path></svg>', '.activity-debt-fill', 'fill');
    const gold = await resolved(s, 'var(--blocked)');
    expect(debt === 'rgba(232, 185, 73, 0.16)' && gold === 'rgb(232, 185, 73)', `the debt fill off the gold (verify-m54-activity.mjs:755), got ${debt} and ${gold}`);
    step("M9 fix 569: under Emerald the Classic scripts' colour reads give the emerald values: the titles, the empty ring and tab line, buttons, focus borders and radios, the tab edges, the composition view, the git letters and the debt fill");

    // The whole block live: every name it sets resolves in the window to
    // its own value, so the block wins over the Classic :root for each.
    const css = fs.readFileSync(path.join(repoRoot, 'packages', 'app', 'src', 'renderer', 'src', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const at = css.indexOf(':root[data-skin="emerald"] {');
    expect(at >= 0, 'the Emerald block in style.css');
    const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    const decls = [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
    expect(decls.length > 60, `the block's names, ${decls.length}`);
    const misses = [];
    for (const [name, value] of decls) {
      const got = await resolved(s, `var(${name})`);
      const want = await resolved(s, value);
      if (got !== want) misses.push(`${name}: ${got} for ${want}`);
    }
    expect(misses.length === 0, `every Emerald token resolves to its own value, misses ${JSON.stringify(misses)}`);
    await s.screenshot('m9-skin-colours.png');
    await skinTo(s, 'classic');
    step('M9 fix 569: every token of the Emerald block resolves to its own value in the window');
  });

  // The mark (fix 570): section 11's steps 3, 4 and 5 of the handoff
  // (docs/design/emerald-skin.md). Under Emerald the session mark on a
  // working row cycles the four frames ◇ ◈ ◆ ✦ and rests at the still ◆;
  // the mark's twins of the Classic mark reads (the cell, the frames, the
  // tone); the three history icons (the rail's Sessions tab, a history
  // row, a transcript's file tab) draw the still ◆ rather than the star;
  // and the two sentences that named the Z say "the gem". The block puts
  // the window on Emerald itself with skinTo(s, 'emerald') at its top and
  // back with skinTo(s, 'classic') at its end, and makes any sessions it
  // needs, so it runs alone under --only. Its steps are named for fix
  // 570 and read nothing an earlier block left behind.
  await block('mark', async () => {
    // fix 570 (mark) starts here
    await skinTo(s, 'emerald');
    const home = os.homedir();
    const q = (x) => JSON.stringify(x);

    // Step 1: the sentences and the kind tile, with no session anywhere.
    // The colours block leaves two shells and two panes up in a whole run,
    // and the No sessions block shows only when no session is listed at
    // all, a killed one included, so each is killed and removed (as
    // verify:m9's clear does) and the layout goes back to one empty pane
    // first (the merge of fixes 569 and 570; the block passed under --only
    // alone).
    for (const x of (await zreq(s, 'session.list', {})).sessions) {
      await zreq(s, x.state === 'exited' ? 'session.remove' : 'session.kill', x.state === 'exited' ? { sessionId: x.id } : { sessionId: x.id, remove: true }).catch(() => {});
    }
    const markLayout = await getLayout(s);
    const markPane = leaves(markLayout)[0];
    await zreq(s, 'layout.set', { layout: { ...markLayout, root: { ...markPane, sessionId: null, view: null }, focusedPaneId: markPane.id } });
    await s.waitFor(`!!document.querySelector('.empty-state')`, 'the No sessions block, so the gem sentence can be read', 10000);
    const sentence = await s.evalJs(`document.querySelector('.empty-pane').textContent`);
    expect(sentence.includes('Right-click any pane for more, or the gem at the top left.') && !sentence.includes('the Z at the top left'), `the empty pane says the gem, got ${sentence}`);
    const tile = await s.evalJs(`(() => { const g = document.querySelector('.empty-kind[data-kind="claude"] .empty-kind-glyph'); return { text: g.textContent, glyphs: g.dataset.glyphs ?? null, face: getComputedStyle(g).fontFamily }; })()`);
    expect(tile.text === '◆' && tile.glyphs === 'gem' && tile.face.includes('Segoe UI Symbol'), `the Claude tile draws the gem still, got ${JSON.stringify(tile)}`);
    await s.evalJs(`document.querySelector('.title-bar-mark').click()`);
    await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu');
    await s.evalJs(`[...document.querySelectorAll('.app-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'Key cheat sheet').click()`);
    await s.waitFor(`!document.querySelector('.app-menu') && !!document.querySelector('.cheat-sheet')`, 'Key cheat sheet opened the sheet');
    const ways = await s.evalJs(`document.querySelector('.cheat-sheet .cheat-ways').textContent`);
    expect(ways.includes('on the gem at the top left.') && !ways.includes('the Z at the top left'), `the cheat sheet says the gem, got ${ways}`);
    await s.key('Escape', 'Escape', 27);
    await s.waitFor(`!document.querySelector('.cheat-sheet')`, 'Escape closed the sheet');
    step('M9 fix 570: the empty pane, the cheat sheet and the Claude tile say the gem and draw the ◆ under Emerald');

    // Step 2: three Claude rows from posted hooks.
    await startSession(s, { kind: 'shell', cwd: home });
    await s.waitFor(`document.querySelectorAll('.term-host').length === 1`, 'the first shell');
    await s.key('E', 'KeyE', 69, CTRL | SHIFT);
    await s.waitFor(`document.querySelectorAll('.pane').length === 2`, 'the chord split');
    await startSession(s, { kind: 'shell', cwd: home });
    await s.waitFor(`document.querySelectorAll('.term-host').length === 2`, 'the second shell');
    await s.key('E', 'KeyE', 69, CTRL | SHIFT);
    await s.waitFor(`document.querySelectorAll('.pane').length === 3`, 'the second chord split');
    await startSession(s, { kind: 'shell', cwd: home });
    await s.waitFor(`document.querySelectorAll('.term-host').length === 3`, 'the third shell');
    const [A, B, C] = leaves(await getLayout(s)).map((p) => ({ pane: p.id, id: p.sessionId }));
    expect(A.id && B.id && C.id, 'three panes with sessions');
    const daemonInfo = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
    const post = async (who, tag, payload) => {
      const res = await fetch(`http://127.0.0.1:${daemonInfo.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': daemonInfo.hookToken, 'X-Emerald-Session': who.id },
        body: JSON.stringify({ session_id: `skin-mark-${tag}`, cwd: home, ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    const row = (who) => `.sidebar-row[data-session-id=${q(who.id)}]`;
    for (const [who, tag] of [[A, 'a'], [B, 'b']]) {
      await post(who, tag, { hook_event_name: 'SessionStart', source: 'startup' });
      await post(who, tag, { hook_event_name: 'UserPromptSubmit', prompt: 'gem' });
      await s.waitFor(`document.querySelector(${q(row(who))})?.dataset.working === 'pulse'`, `row ${tag} working`);
    }
    await post(C, 'c', { hook_event_name: 'SessionStart', source: 'startup' });
    await s.waitFor(`!!document.querySelector(${q(row(C) + ' .session-mark')}) && !document.querySelector(${q(row(C) + ' .session-mark')}).dataset.working`, 'row c is a Claude mark at rest');
    const readMark = (sel) =>
      s.evalJs(`(() => {
        const m = document.querySelector(${q(sel)});
        if (!m) return null;
        const still = m.querySelector('.session-mark-still');
        const frames = [...m.querySelector('.session-mark-frames').children];
        return {
          glyphs: m.dataset.glyphs ?? null,
          working: m.dataset.working ?? null,
          frameData: frames.map((f) => f.dataset.glyph ?? '').join(''),
          frameSvgs: frames.filter((f) => f.querySelector('svg')).length,
          still: still.dataset.glyph ?? '',
          stillSvg: still.querySelector('svg') !== null,
          stillVisibility: getComputedStyle(still).visibility,
          cell: m.getBoundingClientRect().height,
          fonts: frames.map((f) => getComputedStyle(f).fontFamily),
          sizes: frames.map((f) => getComputedStyle(f).fontSize),
          pads: frames.map((f) => getComputedStyle(f).paddingTop),
          tops: [still, ...frames].map((f) => getComputedStyle(f).top),
          shift: (() => { const c = m.getBoundingClientRect(); const p = (still.querySelector('svg path') ?? still).getBoundingClientRect(); return (p.top + p.height / 2) - (c.top + c.height / 2); })(),
          stepping: (${MARK_STEPPING})(m),
          own: getComputedStyle(m).animationName,
          shown: frames.filter((f) => getComputedStyle(f).opacity === '1').length,
        };
      })()`);
    // The fourth column is the place's offset, as getComputedStyle reads
    // its top: fix 593 moved the places that read off their text down
    // inside the cell, and M9 fix 626 re-measured them against the whole
    // word's ink at 100, 125 and 150 percent (a place with no rule reads
    // '0px', as the heading does).
    const marks = [
      ['row', `${row(A)} .session-mark`, true, '1px'],
      ['pane title', `[data-pane-id=${q(A.pane)}] .pane-mark`, true, '1px'],
      ['tab', '.tab-panes[data-current] .tab-mark', false, '1px'],
    ];
    const sitsAt = (where, m, want, size = '14.4px') =>
      expect(
        m.fonts.every((f) => f.includes('Segoe UI Symbol')) && m.sizes.every((z) => z === size) && m.pads.every((p) => p === '0px') && m.tops.every((t) => t === want) && Math.abs(m.shift - parseFloat(want)) <= 0.1,
        `the ${where}'s frames are Segoe UI Symbol at ${size} with no padding nudge, the still and the frames at top ${want} and the gem that far below the cell's centre (M9 fixes 593 and 626), got ${JSON.stringify(m)}`,
      );
    for (const [where, sel, mustWork, want] of marks) {
      const m = await readMark(sel);
      expect(m !== null, `the ${where}'s mark exists`);
      const shape = m.glyphs === 'gem' && m.frameData === '◇◈◆✦' && m.frameSvgs === 4 && m.still === '◆' && m.stillSvg && m.cell === 16;
      expect(shape, `the ${where}'s mark is the gem in a 16px cell, got ${JSON.stringify(m)}`);
      sitsAt(where, m, want);
      if (mustWork || m.working === 'true') expect(m.stepping === true && m.shown === 1, `the ${where}'s working mark shows one frame, the root's (fix 767), got ${JSON.stringify(m)}`);
    }
    // The heading and a roster unit read at 0.5px low or less, so they
    // keep the centred gem (fix 593's measurement); the unit is a probe in
    // a roster unit, as the unit probes below are built.
    const heading = await readMark('.sidebar-group-title .roster[data-size="heading"] .session-mark');
    expect(heading !== null, 'the heading mark exists');
    sitsAt('heading', heading, '0px', '11.7px');
    await s.evalJs(`(() => {
      const u = document.createElement('span');
      u.className = 'roster-unit';
      u.id = 'probe-593';
      const m = document.createElement('span');
      m.className = 'session-mark';
      m.dataset.size = 'unit';
      m.dataset.glyphs = 'gem';
      m.innerHTML = '<span class="session-mark-still">◆</span><span class="session-mark-frames"><span>◇</span><span>◈</span><span>◆</span><span>✦</span></span>';
      u.append(m);
      document.querySelector('.sidebar').append(u);
    })()`);
    const unit = await readMark('#probe-593 .session-mark');
    await s.evalJs(`document.getElementById('probe-593').remove()`);
    expect(unit !== null, 'the unit probe exists');
    expect(unit.fonts.every((f) => f.includes('Segoe UI Symbol')) && unit.pads.every((p) => p === '0px') && unit.tops.every((t) => t === '0px') && Math.abs(unit.shift) <= 0.1, `the roster unit's gem is centred in its cell with no offset (M9 fix 593), got ${JSON.stringify(unit)}`);
    step('M9 fixes 593 and 626: under Emerald the gem sits on its text: each mark beside a line of text is offset by its measured top, the pane title, the row, the tab, the heading and the units, re-measured against the whole word');
    const stepRead = () =>
      s.evalJs(`(() => {
        const m = document.querySelector(${q(row(A) + ' .session-mark')});
        const frames = [...m.querySelector('.session-mark-frames').children];
        const shown = frames.map((f) => getComputedStyle(f).opacity === '1');
        return { frame: Number(document.documentElement.dataset.markFrame), shown: shown.indexOf(true), shownCount: shown.filter(Boolean).length, stepping: (${MARK_STEPPING})(m) };
      })()`);
    const r1 = await stepRead();
    await sleep(300);
    const r2 = await stepRead();
    expect(r1.stepping === true && r2.stepping === true && r1.shownCount === 1 && r2.shownCount === 1 && r1.shown === r1.frame && r2.shown === r2.frame && r1.frame !== r2.frame, `the root's frame is the one shown, and the clock runs (fix 767), got ${JSON.stringify([r1, r2])}`);
    const restMark = await readMark(`${row(C)} .session-mark`);
    expect(restMark.working === null && restMark.still === '◆' && restMark.stillVisibility === 'visible', `a resting mark shows the still ◆, got ${JSON.stringify(restMark)}`);
    await post(C, 'c', { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
    await s.waitFor(`!!document.querySelector(${q(row(C) + ' .session-mark[data-tone="needs-input"]')})`, 'row c needs input');
    const needs = await readMark(`${row(C)} .session-mark`);
    expect(needs.own === 'needs-pulse' && needs.still === '◆', `a needs-input mark breathes with its still ◆, got ${JSON.stringify(needs)}`);
    step('M9 fix 570: the Emerald mark: ◇ ◈ ◆ ✦ in Segoe UI Symbol on the row, the title and the tab, one shown and stepping with the clock, ◆ at rest and breathing on needs-input');

    // Step 3: every cell size, the glyph at 90 percent of it, the ink centres.
    const cellRead = (sel) =>
      s.evalJs(`(() => { const m = document.querySelector(${q(sel)}); if (!m) return null; const st = m.querySelector('.session-mark-still'); return { h: m.getBoundingClientRect().height, v: parseFloat(getComputedStyle(m).getPropertyValue('--mark-cell')), f: parseFloat(getComputedStyle(st).fontSize) }; })()`);
    const okCell = (where, c, want) => expect(c !== null && c.h === c.v && (want === null || c.h === want) && Math.abs(c.f - c.h * 0.9) < 0.01, `${where}: the cell, its --mark-cell and a 90 percent glyph, got ${JSON.stringify(c)}`);
    okCell('the row', await cellRead(`${row(A)} .session-mark`), 16);
    okCell('the sidebar heading', await cellRead('.sidebar-group-title .roster[data-size="heading"] .session-mark'), 13);
    okCell('the title bar', await cellRead('.title-bar .roster[data-size="title"] .session-mark'), 12);
    await s.evalJs(`document.querySelector(${q(`[data-pane-id=${q(A.pane)}] .pane-shade-toggle`)}).click()`);
    await s.waitFor(`!!document.querySelector('.pane-shade .session-mark[data-size="face"]')`, 'the shade over the pane');
    const face = await cellRead('.pane-shade .session-mark[data-size="face"]');
    expect(face !== null && [40, 48, 64].includes(face.h), `the shade's face is 40, 48 or 64, got ${JSON.stringify(face)}`);
    okCell('the shade face', face, null);
    await s.evalJs(`document.querySelector(${q(`[data-pane-id=${q(A.pane)}] .pane-shade-toggle`)}).click()`);
    await s.waitFor(`!document.querySelector('.pane-shade')`, 'the shade lifted');
    for (const [family, want] of [[null, 12], ['Fable', 14], ['Sonnet', 10], ['Haiku', 10]]) {
      const c = await s.evalJs(`(() => {
        const m = document.createElement('span');
        m.className = 'session-mark';
        m.dataset.size = 'unit';
        m.dataset.glyphs = 'gem';
        ${family === null ? '' : `m.dataset.family = ${q(family)};`}
        m.innerHTML = '<span class="session-mark-still">◆</span><span class="session-mark-frames"><span>◇</span><span>◈</span><span>◆</span><span>✦</span></span>';
        document.querySelector('.sidebar').append(m);
        const st = m.querySelector('.session-mark-still');
        const r = { h: m.getBoundingClientRect().height, v: parseFloat(getComputedStyle(m).getPropertyValue('--mark-cell')), f: parseFloat(getComputedStyle(st).fontSize) };
        m.remove();
        return r;
      })()`);
      okCell(`the unit probe (${family ?? 'no family'})`, c, want);
    }
    const ink = await s.evalJs(`(() => {
      const ctx = document.createElement('canvas').getContext('2d');
      const out = { check: document.fonts.check('12px "Segoe UI Symbol"'), worst: 0 };
      for (const px of [14.4, 10.8, 11.7, 43.2]) for (const z of [1, 1.25, 1.5]) {
        ctx.font = (px * z) + 'px "Segoe UI Symbol"';
        const hs = [], vs = [];
        for (const g of ['◇', '◈', '◆', '✦']) {
          const t = ctx.measureText(g);
          hs.push((t.actualBoundingBoxRight - t.actualBoundingBoxLeft) / 2 - t.width / 2);
          vs.push((t.actualBoundingBoxDescent - t.actualBoundingBoxAscent) / 2);
        }
        const spread = (a) => Math.max(...a) - Math.min(...a);
        out.worst = Math.max(out.worst, spread(hs), spread(vs)); (out.rows ??= []).push([px, z, +spread(hs).toFixed(3), +spread(vs).toFixed(3)]);
      }
      return out;
    })()`);
    expect(ink.check, 'Segoe UI Symbol is available');
    // The font's own spread (read above) is past 0.5px at 125 and 150 percent, so the
    // frames are drawn SVG (GemFrame); the gate is now that every drawn frame and the
    // still sit on one centre, at each zoom the page can be put to.
    {
      const centres = await s.evalJs(`(() => {
        const m = document.querySelector(${q(row(A) + ' .session-mark')});
        const boxes = [...m.querySelectorAll('.session-mark-frames > span svg'), m.querySelector('.session-mark-still svg')].map((v) => { const r = v.querySelector('path').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
        const spread = (i) => Math.max(...boxes.map((b) => b[i])) - Math.min(...boxes.map((b) => b[i]));
        return { n: boxes.length, dx: spread(0), dy: spread(1) };
      })()`);
      expect(centres.n === 5 && centres.dx <= 0.5 && centres.dy <= 0.5, `the drawn frames share one centre, got ${JSON.stringify(centres)}`);
    }
    step(`M9 fix 570: the Emerald mark keeps every cell size (16, 13, 12, the face, the four unit cells), the glyph at 90 percent, and the four frames' ink centres within 0.5px (the font's spread ${ink.worst.toFixed(3)}px, so the frames are drawn)`);

    // Step 4: one clock.
    const clock = await s.evalJs(`(() => {
      const read = (sel) => { const fr = [...document.querySelector(sel).querySelector('.session-mark-frames').children]; return { idx: fr.findIndex((f) => getComputedStyle(f).opacity === '1'), frame: Number(document.documentElement.dataset.markFrame) }; };
      return [read(${q(row(A) + ' .session-mark')}), read(${q(row(B) + ' .session-mark')})];
    })()`);
    expect(clock[0].idx === clock[1].idx && clock[0].idx !== -1 && clock[0].idx === clock[0].frame, `two working marks share the frame, the root's (fix 767), got ${JSON.stringify(clock)}`);
    step('M9 fix 570: two working Emerald marks show the same frame, on the one clock');

    // Step 5: reduced motion.
    await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await s.waitFor(
        `[${q(row(A))}, ${q(row(B))}].every((r) => { const m = document.querySelector(r + ' .session-mark'); return (${MARK_STEPPING})(m) === false && [...m.querySelector('.session-mark-frames').children].every((f) => getComputedStyle(f).opacity !== '1'); })`,
        'no frame shown under reduced motion',
        3000,
      );
      for (const who of [A, B]) {
        const m = await readMark(`${row(who)} .session-mark`);
        expect(m.stillVisibility === 'visible' && m.still === '◆', `under reduced motion the mark shows its still ◆, got ${JSON.stringify(m)}`);
      }
    } finally {
      await s.send('Emulation.setEmulatedMedia', { features: [] });
    }
    step('M9 fix 570: under prefers-reduced-motion every Emerald mark shows its still ◆');

    // Step 6: the three history icons.
    const HID = 'a5a5a5a5-0000-4000-8000-000000000570';
    const encode = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
    const jl = (o) => `${JSON.stringify(o)}\n`;
    const projectDir = path.join(harnessClaudeHome(process.env['EMERALD_HOME']), 'projects', encode(home));
    fs.mkdirSync(projectDir, { recursive: true });
    const transcript = path.join(projectDir, `${HID}.jsonl`);
    fs.writeFileSync(
      transcript,
      jl({ type: 'ai-title', aiTitle: 'Gem history', sessionId: HID }) +
        jl({ type: 'user', message: { role: 'user', content: 'hello' }, cwd: home, gitBranch: 'main', timestamp: new Date(Date.now() - 60_000).toISOString() }),
    );
    try {
      const tab = await s.evalJs(`(() => { const t = document.querySelector('.rail-tab[data-tab="history"]'); const i = t.querySelector('.files-icon'); const r = i.getBoundingClientRect(); return { svg: !!t.querySelector('svg.files-icon'), tag: i.tagName, gem: i.classList.contains('gem-still'), glyphs: i.dataset.glyphs ?? null, text: i.textContent, face: getComputedStyle(i).fontFamily, w: r.width, h: r.height, color: getComputedStyle(i).color, tabColor: getComputedStyle(t).color }; })()`);
      expect(!tab.svg && tab.tag === 'SPAN' && tab.gem && tab.glyphs === 'gem' && tab.text === '◆' && tab.face.includes('Segoe UI Symbol') && tab.w === 14 && tab.h === 14 && tab.color === tab.tabColor, `the Sessions tab draws the gem still, got ${JSON.stringify(tab)}`);
      const rowSel = `.history-row[data-id="${HID}"]`;
      await s.evalJs(`document.querySelector('.rail-tab[data-tab="history"]').click()`);
      try {
        await s.waitFor(`!!document.querySelector(${q(rowSel)})`, 'the history row', 10000);
      } catch {
        await s.send('Page.reload');
        await s.waitFor(`!!document.querySelector('.tab-strip')`, 'the app after the reload', 20000);
        await s.evalJs(`document.querySelector('.rail-tab[data-tab="history"]').click()`);
        await s.waitFor(`!!document.querySelector(${q(rowSel)})`, 'the history row after a reload', 10000);
      }
      const glyphRead = (sel) =>
        s.evalJs(`(() => { const g = document.querySelector(${q(sel)}); const r = g.getBoundingClientRect(); return { tag: g.tagName, gem: g.classList.contains('gem-still'), glyphs: g.dataset.glyphs ?? null, text: g.textContent, face: getComputedStyle(g).fontFamily, color: getComputedStyle(g).color, w: r.width, h: r.height }; })()`);
      const hg = await glyphRead(`${rowSel} .history-glyph`);
      expect(hg.tag === 'SPAN' && hg.gem && hg.glyphs === 'gem' && hg.text === '◆' && hg.face.includes('Segoe UI Symbol') && hg.w === 12 && hg.h === 12, `the history row draws the gem still, got ${JSON.stringify(hg)}`);
      const facts = await s.evalJs(`getComputedStyle(document.querySelector(${q(rowSel + ' .history-row-facts')})).color`);
      expect(hg.color === facts && facts === 'rgb(138, 138, 138)', `the history row's ◆ is the muted grey of its facts line under Emerald (M9 fix 595), got ${hg.color} and ${facts}`);
      step("M9 fix 595: under Emerald the history row's ◆ is the muted grey of its facts line, not Claude's orange");
      await s.evalJs(`document.querySelector(${q(rowSel + ' .history-row-fold')}).click()`);
      await s.waitFor(`!!document.querySelector(${q(rowSel + ' .history-row-open')})`, 'the unfolded row offers Open');
      await s.evalJs(`document.querySelector(${q(rowSel + ' .history-row-open')}).click()`);
      await s.waitFor(`(document.querySelector('.tab-file[data-active]')?.dataset.tab ?? '').endsWith(${q(HID + '.jsonl')})`, 'the transcript tab is active');
      const tg = await glyphRead('.tab-file[data-active] .tab-icon');
      expect(tg.tag === 'SPAN' && tg.gem && tg.glyphs === 'gem' && tg.text === '◆' && tg.face.includes('Segoe UI Symbol') && tg.w === 14 && tg.h === 14, `the transcript's tab draws the gem still, got ${JSON.stringify(tg)}`);
      await s.evalJs(`document.querySelector('.tab-file[data-active] .tab-close').click()`);
    } finally {
      fs.rmSync(transcript, { force: true });
    }
    step("M9 fix 570: under Emerald the history row, the Sessions tab and a transcript's tab draw the still ◆ in the gem face, no star");

    for (const who of [A, B, C]) await zreq(s, 'session.kill', { sessionId: who.id }).catch(() => {});
    await skinTo(s, 'classic');
    // fix 570 (mark) ends here
  });

  // The gem (fix 571): section 11's step 8 of the handoff and the title
  // bar's twins. Under Emerald the title-bar button is the flush gem at
  // 12px, still: .title-bar-mark holds one svg and no text, where the
  // Classic reads at verify-m9-menus.mjs:502 and verify-m9-fixes.mjs:2667
  // find the Z; its rare glint runs only while the sidebar is collapsed
  // and a session works. The icon itself (5f) is a build-time file with
  // tests of its own. The block puts the window on Emerald itself with
  // skinTo(s, 'emerald') at its top and back with skinTo(s, 'classic') at
  // its end, and makes any sessions it needs, so it runs alone under
  // --only. Its steps are named for fix 571.
  await block('gem', async () => {
    // fix 571 (gem) starts here
    // Its own session, a shell that reads as a Claude row once a hook has
    // posted for it (markKind's lastEventAt): from the empty pane when
    // there is one (--only), else split beside the focused pane, since an
    // earlier block may leave its shells open.
    const gemPaneSessions = async () => {
      const out = [];
      const walk = (n) => (n.kind === 'pane' ? out.push(n.sessionId) : (walk(n.first), walk(n.second)));
      walk((await getLayout(s)).root);
      return out.filter((id) => typeof id === 'string');
    };
    const gemBefore = await gemPaneSessions();
    if (await s.evalJs(`!!document.querySelector('.empty-pane .empty-start')`)) await startFromEmpty(s);
    else await splitWithShell(s, '.pane.focused .pane-split-right');
    await s.waitFor(`document.querySelectorAll('.term-host').length >= ${gemBefore.length + 1}`, 'the gem block has a shell of its own');
    const gemId = (await gemPaneSessions()).find((id) => !gemBefore.includes(id));
    expect(typeof gemId === 'string', 'the gem block found its new session');
    const gemRow = `.sidebar-row[data-session-id=${JSON.stringify(gemId)}]`;
    const gemDaemon = JSON.parse(fs.readFileSync(path.join(process.env['EMERALD_HOME'], 'daemon.json'), 'utf8'));
    const gemPost = async (payload) => {
      const res = await fetch(`http://127.0.0.1:${gemDaemon.hookPort}/hook`, {
        method: 'POST',
        headers: { 'X-Emerald-Token': gemDaemon.hookToken, 'X-Emerald-Session': gemId },
        body: JSON.stringify({ session_id: 'sim-gem-571', cwd: os.homedir(), ...payload }),
      });
      expect(res.status === 204, `sink answered 204 for ${payload.hook_event_name}`);
    };
    await gemPost({ hook_event_name: 'SessionStart', source: 'startup' });
    await gemPost({ hook_event_name: 'UserPromptSubmit', prompt: 'polish the gem' });
    await s.waitFor(`document.querySelector(${JSON.stringify(gemRow)})?.dataset.state === 'working'`, 'the gem block row is working');
    await s.waitFor(`document.querySelector(${JSON.stringify(gemRow)})?.dataset.working === 'pulse'`, 'the gem block row pulses as a Claude row');
    await skinTo(s, 'emerald');

    // (a) The title bar's twins under Emerald (verify-m9-menus.mjs:502,
    // :516 and :540, verify-m9-fixes.mjs:2681).
    const FILLS = ['#57d99c', '#3cc184', '#22905c', '#176a44', '#1c7f51', '#259a63', '#45c98c', '#9ff2c8', '#2fb67a'];
    const gem = await s.evalJs(
      `(() => { const m = document.querySelector('.title-bar-mark'); const st = getComputedStyle(m); const svgs = [...m.children].filter((c) => c.tagName === 'svg'); const svg = svgs[0]; const r = m.getBoundingClientRect(); const bar = document.querySelector('.title-bar').getBoundingClientRect(); return { tag: m.tagName, text: m.textContent.trim(), title: m.getAttribute('title'), region: st.getPropertyValue('app-region') || st.webkitAppRegion || null, cls: m.className, svgs: svgs.length, children: m.children.length, viewBox: svg?.getAttribute('viewBox') ?? null, width: svg?.getAttribute('width') ?? null, height: svg?.getAttribute('height') ?? null, fills: svg ? [...svg.children].filter((c) => c.tagName === 'path').map((p) => p.getAttribute('fill')) : [], w: r.width, h: r.height, inside: r.top >= bar.top && r.bottom <= bar.bottom, barH: bar.height }; })()`,
    );
    expect(gem.tag === 'BUTTON' && gem.text === '' && gem.title === 'Menu' && gem.region === 'no-drag' && gem.cls === 'title-bar-mark', `the gem mark is a no-drag button with a Menu tooltip and no text (${JSON.stringify(gem)})`);
    expect(gem.svgs === 1 && gem.children === 1 && gem.viewBox === '40 40 176 176' && gem.width === '12' && gem.height === '12', `the mark holds one 12px svg on the gem's viewBox (${JSON.stringify(gem)})`);
    expect(JSON.stringify(gem.fills) === JSON.stringify(FILLS), `the svg's paths are the nine flush shapes in paint order, got ${JSON.stringify(gem.fills)}`);
    expect(Math.abs(gem.w - 18) <= 0.5 && Math.abs(gem.h - 18) <= 0.5 && gem.inside, `the gem's button is 18 by 18 inside the ${gem.barH}px row (${gem.w} by ${gem.h})`);
    const gemButtons = await s.evalJs(`[...document.querySelectorAll('.title-bar button')].map((b) => b.className)`);
    expect(JSON.stringify(gemButtons) === JSON.stringify(['title-bar-mark']), `the title row's one button is still the mark, got ${JSON.stringify(gemButtons)}`);
    expect((await s.evalJs(`document.querySelector('.title-bar .title-bar-mark').textContent`)) === '', 'the title bar mark has no text under Emerald');
    const gemCentre = await s.evalJs(`(() => { const r = document.querySelector('.title-bar-mark').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await s.click(gemCentre.x, gemCentre.y);
    await s.waitFor(`!!document.querySelector('.app-menu')`, 'the app menu under the gem');
    const gemMenuBox = await s.evalJs(`(() => { const m = document.querySelector('.app-menu').getBoundingClientRect(); const z = document.querySelector('.title-bar-mark').getBoundingClientRect(); return { under: m.top >= z.bottom - 1, left: Math.abs(m.left - z.left) <= 2 }; })()`);
    expect(gemMenuBox.under && gemMenuBox.left, `the menu hangs from the gem's bottom left (${JSON.stringify(gemMenuBox)})`);
    await s.click(gemCentre.x, gemCentre.y);
    await s.waitFor(`!document.querySelector('.app-menu')`, 'a second click on the gem closes the menu');
    step('M9 fix 571: under Emerald the title-bar mark is the 12px flush gem in an 18px no-drag button, its menu as the Z had it');

    // (b) The glint: off with the sidebar open, on once it is collapsed
    // with a Claude row working, off under reduced motion and after Stop.
    const glintState = () =>
      s.evalJs(`(() => { const m = document.querySelector('.title-bar-mark'); const g = document.querySelector('.title-gem-glint'); const st = g ? getComputedStyle(g) : null; return { glint: m.hasAttribute('data-glint'), name: st?.animationName ?? null, duration: st?.animationDuration ?? null }; })()`);
    const open = await glintState();
    expect(!open.glint && open.name === 'none', `with the sidebar open the gem is still, got ${JSON.stringify(open)}`);
    await s.evalJs(`document.querySelector('.sidebar-collapse').click()`);
    await s.waitFor(`document.querySelector('.sidebar-rail') !== null`, 'the sidebar collapsed');
    await s.waitFor(`document.querySelector('.title-bar-mark').hasAttribute('data-glint')`, 'the gem glints with the sidebar collapsed');
    const running = await glintState();
    expect(running.glint && running.name === 'title-gem-glint' && running.duration === '10s', `the glint runs, 10 s a cycle, got ${JSON.stringify(running)}`);
    // The paint read: a transform moving under a clip inside the row's own
    // overflow: hidden, fix 86's shape. Two captures 150 ms and 450 ms into
    // a cycle, both inside the 600 ms sweep, must differ.
    const gemPaint = async () => {
      const r = await s.evalJs(`(() => { const b = document.querySelector('.title-bar-mark').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; })()`);
      return (await s.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 4 }, fromSurface: true })).data;
    };
    const sweepPair = async () => {
      const t = await s.evalJs(`document.querySelector('.title-gem-glint').getAnimations()[0]?.currentTime ?? 0`);
      await sleep((10000 - (Number(t) % 10000) + 150) % 10000);
      const a = await gemPaint();
      await sleep(300);
      const b = await gemPaint();
      return a !== b;
    };
    let swept = await sweepPair();
    if (!swept) swept = await sweepPair();
    if (swept) step('M9 fix 571: the glint paints, two captures in one sweep differ');
    else step('glint paint read: identical twice (fix 86\'s shape)');
    await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await s.waitFor(`getComputedStyle(document.querySelector('.title-gem-glint')).animationName === 'none'`, 'reduced motion stills the glint');
    expect((await glintState()).glint, 'data-glint stays under reduced motion');
    await s.send('Emulation.setEmulatedMedia', { features: [] });
    await s.waitFor(`getComputedStyle(document.querySelector('.title-gem-glint')).animationName === 'title-gem-glint'`, 'the glint is back with the media restored');
    await gemPost({ hook_event_name: 'Stop', last_assistant_message: 'Done.' });
    await s.waitFor(`!document.querySelector('.title-bar-mark').hasAttribute('data-glint')`, 'Stop ends the glint');
    expect((await glintState()).name === 'none', 'and the band is still');
    step('M9 fix 571: the glint runs only with the sidebar collapsed and a Claude row working, not under reduced motion, not after Stop');

    // (c) Back to Classic, collapsed and working again: the Z, no gem, no
    // glint.
    await gemPost({ hook_event_name: 'UserPromptSubmit', prompt: 'once more' });
    await s.waitFor(`document.querySelector('.title-bar-mark').hasAttribute('data-glint')`, 'the gem glints again');
    await skinTo(s, 'classic');
    const classic = await s.evalJs(`(() => { const m = document.querySelector('.title-bar-mark'); return { text: m.textContent, svg: !!m.querySelector('svg'), glint: m.hasAttribute('data-glint') }; })()`);
    expect(classic.text === 'Z' && !classic.svg && !classic.glint, `under Classic the mark is the Z with no gem and no glint, got ${JSON.stringify(classic)}`);
    await gemPost({ hook_event_name: 'Stop', last_assistant_message: 'Done.' });
    await s.evalJs(`document.querySelector('.sidebar-expand').click()`);
    await s.waitFor(`document.querySelector('.sidebar-collapse') !== null`, 'the sidebar back');
    step('M9 fix 571: back on Classic the mark is the Z again, the glint gone with the skin');
    // fix 571 (gem) ends here
  });

  // The palettes (fix 572): section 11's step 6 of the handoff and the
  // scheme twins. Under Emerald the terminal and the editor wear the
  // emerald gem scheme unless the person picked one, so the reads the
  // colours block leaves out because the scheme sets them inline get
  // their Emerald twins here: the terminal ground pixel
  // (verify-m9-fixes.mjs:2449), the viewport (:2475, var(--pane-bg)), the
  // xterm theme's background (verify-m9-menus.mjs:247 and :251), and the
  // Monaco theme (monaco-theme-model.test.ts:9 to :28 and :53 to :71).
  // The block puts the window on Emerald itself with skinTo(s, 'emerald')
  // at its top and back with skinTo(s, 'classic') at its end, and makes
  // any sessions it needs, so it runs alone under --only. Its steps are
  // named for fix 572.
  await block('palette', async () => {
    // fix 572 (palette) starts here
    await skinTo(s, 'emerald');
    await skinTo(s, 'classic');
    expect((await s.evalJs(`localStorage.getItem('emerald.scheme')`)) === null, 'no scheme is picked when the palette block starts');
    const probeJs = `(() => ({
      hosts: [...document.querySelectorAll('.term-host')].map((h) => ({ bg: h.emeraldTerm.options.theme.background, cursor: h.emeraldTerm.options.theme.cursor, green: h.emeraldTerm.options.theme.green, yellow: h.emeraldTerm.options.theme.yellow, ground: getComputedStyle(h).backgroundColor, viewport: getComputedStyle(h.querySelector('.xterm-viewport')).backgroundColor })),
      root: document.documentElement.dataset.scheme ?? null,
      paneBg: document.documentElement.style.getPropertyValue('--pane-bg'),
      stored: localStorage.getItem('emerald.scheme'),
    }))()`;
    const probe = () => s.evalJs(probeJs);
    const openPaneMenu = async () => {
      await s.evalJs(`(() => { const t = document.querySelector('.term-host').closest('.pane').querySelector('.pane-title'); const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + r.height / 2 })); })()`);
      await s.waitFor(`!!document.querySelector('.pane-menu')`, 'the pane menu');
    };
    // M9 fix 648: the scheme rows are in the list The window opens.
    const menuLabels = () => s.evalJs(`[...document.querySelectorAll('.menu-sub .menu-item')].map((b) => ({ label: b.querySelector('.menu-label').textContent.replace(/^✓/, ''), checked: b.dataset.checked ?? null }))`);
    const openWindowList = async () => {
      await s.evalJs(`[...document.querySelectorAll('.pane-menu .menu-item')].find((b) => b.querySelector('.menu-label').textContent === 'The window').click()`);
      await s.waitFor(`!!document.querySelector('.menu-sub[data-parent="The window"]')`, "the window's scheme list");
    };
    const pickByHand = async (name) => {
      await openPaneMenu();
      await openWindowList();
      await s.evalJs(`[...document.querySelectorAll('.menu-sub .menu-item')].find((b) => b.querySelector('.menu-label').textContent.replace(/^✓/, '') === ${JSON.stringify(name)}).click()`);
      await s.key('Escape', 'Escape', 27);
    };
    const allAre = (key, value, what) => s.waitFor(`${probeJs}.hosts.every((h) => h.${key} === ${JSON.stringify(value)})`, what, 5000);
    const storedIs = (value, what) => s.waitFor(`localStorage.getItem('emerald.scheme') === ${JSON.stringify(value)}`, what, 5000);
    const GEM = '#1a1f1d';

    // (a) the flip re-themes the open terminals, a fresh pane opens in gem.
    await startShellByKey(s);
    await allAre('bg', '#1e1e1e', 'every host on the Classic ground');
    await skinTo(s, 'emerald');
    await allAre('bg', GEM, 'the open terminal re-themed on the flip, no reload');
    const gem = await probe();
    expect(
      gem.hosts.every((h) => h.cursor === '#3ecf8e' && h.green === '#3ecf8e' && h.yellow === '#e8b949' && h.ground === 'rgb(26, 31, 29)' && h.viewport === 'rgb(26, 31, 29)') && gem.root === 'emerald gem' && gem.paneBg === GEM && gem.stored === null,
      `emerald gem on every host, got ${JSON.stringify(gem)}`,
    );
    await startShellByKey(s);
    await allAre('bg', GEM, 'a fresh pane opens on emerald gem');
    const fresh = await probe();
    expect(fresh.hosts.length >= 2 && fresh.hosts.every((h) => h.cursor === '#3ecf8e' && h.green === '#3ecf8e' && h.yellow === '#e8b949' && h.ground === 'rgb(26, 31, 29)'), `the new pane reads the same, got ${JSON.stringify(fresh)}`);
    step('M9 fix 572: with no pick the Emerald skin dresses every terminal in emerald gem on the flip, no reload, and a fresh pane opens in it');

    // (b) the menu's order and checkmark under Emerald.
    await openPaneMenu();
    await openWindowList();
    const rows = await menuLabels();
    expect(
      JSON.stringify(rows.map((l) => l.label)) === JSON.stringify(['emerald gem', 'emerald', 'Dracula', 'One Dark', 'Solarized Dark', 'Tokyo Night']) && rows[0].checked === 'true' && rows.slice(1).every((l) => l.checked === 'false'),
      `emerald gem first and checked, got ${JSON.stringify(rows)}`,
    );
    await s.key('Escape', 'Escape', 27);
    step('M9 fix 572: under Emerald the scheme section lists emerald gem first and checked, emerald second');

    // (c) a pick by hand holds across both flips; the skin's own default clears the key.
    await pickByHand('Solarized Dark');
    await allAre('bg', '#002b36', 'Solarized on every host');
    await storedIs('Solarized Dark', 'Solarized stored');
    await skinTo(s, 'classic');
    await allAre('bg', '#002b36', 'Solarized holds on Classic');
    await storedIs('Solarized Dark', 'still stored on Classic');
    await skinTo(s, 'emerald');
    await allAre('bg', '#002b36', 'Solarized holds on Emerald');
    await pickByHand('emerald');
    await allAre('bg', '#1e1e1e', 'emerald picked by hand under Emerald is Classic’s palette');
    await storedIs('emerald', 'emerald stored under Emerald');
    await skinTo(s, 'classic');
    await allAre('bg', '#1e1e1e', 'it holds on Classic');
    await storedIs('emerald', 'still stored on Classic');
    await pickByHand('emerald');
    await storedIs(null, 'the skin’s own default clears the key');
    await skinTo(s, 'emerald');
    await allAre('bg', GEM, 'with no pick the terminals follow the skin again');
    await pickByHand('emerald gem');
    await storedIs(null, 'emerald gem under Emerald stores nothing');
    await allAre('bg', GEM, 'still gem');
    step("M9 fix 572: a scheme picked by hand holds across both flips; picking the skin's own default clears the key so it follows the skin");

    // (d) a reload with Emerald and no pick opens on gem.
    await s.send('Page.reload');
    await s.waitFor(`!!document.querySelector('.term-host') && document.documentElement.dataset.scheme === 'emerald gem' && document.querySelector('.term-host').emeraldTerm?.options.theme.background === '#1a1f1d'`, 'the reload opens on emerald gem', 20000);
    step('M9 fix 572: a reload under Emerald with no pick opens on emerald gem');
    await skinTo(s, 'classic');
    await storedIs(null, 'the block ends on Classic with no scheme picked');
    // fix 572 (palette) ends here
  });

  // The find bar's highlights across a flip (fix 594). The block makes its
  // own session from one empty pane, as the mark block does, opens the bar
  // on Classic, flips to Emerald and back with the bar open, and reads the
  // decorations the terminal holds: xterm 6 paints a decoration's colour as
  // the cell's background in the renderer, so the element has none to read.
  // A disposed decoration can stay in the service's list (two did on the
  // second flip, isDisposed and their marker at line -1), so the read
  // counts the live ones.
  // It leaves the window on Classic with its session gone, so it runs alone
  // under --only.
  await block('find', async () => {
    // fix 594 (find) starts here
    const fq = (x) => JSON.stringify(x);
    for (const x of (await zreq(s, 'session.list', {})).sessions) {
      await zreq(s, x.state === 'exited' ? 'session.remove' : 'session.kill', x.state === 'exited' ? { sessionId: x.id } : { sessionId: x.id, remove: true }).catch(() => {});
    }
    const findLayout = await getLayout(s);
    const findLeaf = leaves(findLayout)[0];
    await zreq(s, 'layout.set', { layout: { ...findLayout, root: { ...findLeaf, sessionId: null, view: null }, focusedPaneId: findLeaf.id } });
    await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'one empty pane for the find block', 10000);
    await startFromEmpty(s);
    const after = await getLayout(s);
    const pane = after.focusedPaneId;
    const sessionId = leaves(after).find((l) => l.id === pane).sessionId;
    const shellRead = async () => Buffer.from((await zreq(s, 'session.read', { sessionId })).data, 'base64').toString();
    const pollFor = async (needle, ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if ((await shellRead()).includes(needle)) return true;
        await sleep(200);
      }
      return false;
    };
    expect(await pollFor('PS ', 10000), 'the find block shell shows its prompt');
    const print = async () => {
      await s.type("1..5 | % { 'gem' + 'stone' + $_ }");
      await s.key('Enter', 'Enter', 13);
      return pollFor('gemstone5', 10000);
    };
    if (!(await print())) {
      const c = await s.evalJs(`(() => { const r = document.querySelector(${fq(`[data-pane-id=${fq(pane)}] .xterm-screen`)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await s.click(c.x, c.y);
      step('find block: the first print never arrived, clicked the screen and typed again');
      expect(await print(), 'the find block shell printed gemstone1 to gemstone5');
    }
    const hostSel = `[data-pane-id=${fq(pane)}] .term-host`;
    const barSel = `[data-pane-id=${fq(pane)}] .find-bar`;
    await s.key('H', 'KeyH', 72, CTRL | SHIFT);
    await s.waitFor(`!!document.querySelector(${fq(barSel)}) && document.activeElement?.classList.contains('find-input')`, 'Ctrl+Shift+H opened the find bar with its box focused');
    await s.type('gemstone');
    await s.waitFor(`document.querySelector(${fq(barSel)})?.dataset.count === '5' && document.querySelector(${fq(barSel)})?.dataset.index === '1'`, '1 of 5 after typing');
    await s.key('Enter', 'Enter', 13);
    await s.waitFor(`document.querySelector(${fq(barSel)})?.dataset.index === '2'`, 'Enter moved to 2 of 5');
    await s.evalJs(`document.querySelector(${fq(hostSel)}).emeraldTerm.__find594 = true`);
    const findRead = () =>
      s.evalJs(`(() => { const h = document.querySelector(${fq(hostSel)}); const b = document.querySelector(${fq(barSel)}); return { tagged: h.emeraldTerm.__find594 === true, colours: [...h.emeraldTerm._core._decorationService.decorations].filter((d) => !d.isDisposed).map((d) => d.options.backgroundColor), count: b?.dataset.count ?? null, index: b?.dataset.index ?? null, open: !!b }; })()`);
    // Five hits in the match colour and the selected one in the active
    // colour, nothing else, the bar open on 2 of 5 throughout.
    const coloursAre = (match, active) =>
      `(() => { const h = document.querySelector(${fq(hostSel)}); const b = document.querySelector(${fq(barSel)}); const c = [...h.emeraldTerm._core._decorationService.decorations].filter((d) => !d.isDisposed).map((d) => d.options.backgroundColor); return !!b && b.dataset.count === '5' && b.dataset.index === '2' && c.length === 6 && c.filter((x) => x === ${fq(match)}).length === 5 && c.filter((x) => x === ${fq(active)}).length === 1; })()`;
    const classicRead = await findRead();
    expect(classicRead.colours.length === 6 && classicRead.colours.filter((x) => x === '#4a4a2a').length === 5 && classicRead.colours.filter((x) => x === '#7a5a1a').length === 1, `on Classic five hits in #4a4a2a and the selected one in #7a5a1a, got ${JSON.stringify(classicRead)}`);
    await skinTo(s, 'emerald');
    try {
      await s.waitFor(coloursAre('#24402f', '#1d6b47'), 'the flip to Emerald repainted the highlights with the bar open', 3000);
    } catch (err) {
      console.error(`[verify] find read after the flip to Emerald: ${JSON.stringify(await findRead())}`);
      throw err;
    }
    const emeraldRead = await findRead();
    if (!emeraldRead.tagged) step('find block: the flip rebuilt the terminal (the tag is gone); the colour read still holds');
    await s.screenshot('m9-skin-find.png');
    await skinTo(s, 'classic');
    try {
      await s.waitFor(coloursAre('#4a4a2a', '#7a5a1a'), 'the flip back to Classic repainted the highlights, 2 of 5 kept', 3000);
    } catch (err) {
      console.error(`[verify] find read after the flip back to Classic: ${JSON.stringify(await findRead())}`);
      throw err;
    }
    step("M9 fix 594: a skin flip with the find bar open repaints its highlights in the new skin's colours both ways, the count and the selected hit kept");
    await s.evalJs(`document.querySelector(${fq(barSel + ' .find-close')}).click()`);
    await s.waitFor(`!document.querySelector('.find-bar')`, 'the find bar closed');
    await zreq(s, 'session.kill', { sessionId, remove: true }).catch(() => {});
    // fix 594 (find) ends here
  });

  // M9 fix 655: Monaco's suggestion box and find widget wear the Emerald
  // skin. Monaco's --vscode-* variables sit on .monaco-editor at 0,1,0;
  // style.css overrides them under :root[data-skin="emerald"]. Classic is
  // Monaco's own look and is not read here (verify:m13-markdown holds it).
  // The window is whatever find left (Classic, its shell removed), or the
  // fresh one under --only, so it starts as find does.
  await block('monaco', async () => {
    for (const x of (await zreq(s, 'session.list', {})).sessions) {
      await zreq(s, x.state === 'exited' ? 'session.remove' : 'session.kill', x.state === 'exited' ? { sessionId: x.id } : { sessionId: x.id, remove: true }).catch(() => {});
    }
    const monLayout = await getLayout(s);
    const monLeaf = leaves(monLayout)[0];
    await zreq(s, 'layout.set', { layout: { ...monLayout, root: { ...monLeaf, sessionId: null, view: null }, focusedPaneId: monLeaf.id } });
    await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'one empty pane for the monaco block', 10000);
    const seedShort = path.join(os.tmpdir(), 'emerald-verify', `m9-skin-monaco-${process.pid}`);
    fs.rmSync(seedShort, { recursive: true, force: true });
    fs.mkdirSync(seedShort, { recursive: true });
    const seed = fs.realpathSync.native(seedShort);
    const wordsTs = path.join(seed, 'words.ts');
    fs.writeFileSync(wordsTs, 'export const emeraldWidget = 1;\nexport const emeraldWindow = 2;\n');
    try {
      await startSession(s, { kind: 'shell', cwd: seed });
      const after = await getLayout(s);
      const sessionId = leaves(after).find((l) => l.id === after.focusedPaneId).sessionId;
      await s.evalJs(`document.querySelector('.rail-tab[data-tab="files"]').click()`);
      const rowSel = `.files-row[data-path=${JSON.stringify(wordsTs)}]`;
      await s.waitFor(`!!document.querySelector(${JSON.stringify(rowSel)})`, 'the words.ts row', 8000);
      await s.evalJs(`document.querySelector(${JSON.stringify(rowSel)}).click()`);
      const viewSel = `'.file-view[data-path=' + ${JSON.stringify(JSON.stringify(wordsTs))} + ']'`;
      const editorOf = `document.querySelector(${viewSel} + ' .file-editor').emeraldEditor`;
      await s.waitFor(`document.querySelector(${viewSel})?.dataset.state === 'text' && !!${editorOf}?.getModel()`, 'words.ts read', 8000);
      // The skin first: the app menu takes the keyboard from the editor.
      await skinTo(s, 'emerald');
      await s.evalJs(`(() => { const e = ${editorOf}; const m = e.getModel(); const n = m.getLineCount(); e.setPosition({ lineNumber: n, column: m.getLineMaxColumn(n) }); e.focus(); })()`);
      await s.waitFor(`!!document.activeElement?.closest('.monaco-editor')`, 'the keyboard in the editor', 3000);

      const style = (sel, props) => s.evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const c = getComputedStyle(e); return { ${props.map((p) => `${p}: c.${p}`).join(', ')} }; })()`);
      await s.type('emer');
      await s.waitFor(`!!document.querySelector('.monaco-editor .suggest-widget.visible')`, 'the suggestion box', 5000);
      await s.screenshot('m9-skin-monaco-suggest.png');
      const box = await style('.monaco-editor .suggest-widget.visible', ['backgroundColor']);
      const row = await style('.monaco-editor .suggest-widget.visible .monaco-list-row.focused', ['backgroundColor']);
      const letters = await style('.monaco-editor .suggest-widget.visible .monaco-list-row.focused .monaco-highlighted-label .highlight', ['color']);
      const suggestRead = { box, row, letters };
      if (box?.backgroundColor !== 'rgb(33, 40, 37)' || row?.backgroundColor !== 'rgb(39, 48, 44)' || letters?.color !== 'rgb(62, 207, 142)') {
        console.error(`[verify] monaco suggest read: ${JSON.stringify(suggestRead)}`);
      }
      expect(box?.backgroundColor === 'rgb(33, 40, 37)', `the suggestion box is on --title-bg, got ${JSON.stringify(suggestRead)}`);
      expect(row?.backgroundColor === 'rgb(39, 48, 44)', `the selected row is on --row-selected, got ${JSON.stringify(suggestRead)}`);
      expect(letters?.color === 'rgb(62, 207, 142)', `the match letters are in --focus, got ${JSON.stringify(suggestRead)}`);
      step('M9 fix 655: under Emerald the word suggestion box is on --title-bg, its selected row on --row-selected and its match letters in --focus');

      await s.key('Escape', 'Escape', 27);
      await s.waitFor(`!document.querySelector('.suggest-widget.visible')`, 'the box closed', 3000);
      await s.key('s', 'KeyS', 83, CTRL);
      await s.waitFor(`document.querySelector(${viewSel})?.dataset.dirty === undefined`, 'words.ts saved', 3000);
      await s.key('f', 'KeyF', 70, CTRL);
      await s.waitFor(`!!document.querySelector('.monaco-editor .find-widget.visible')`, "Monaco's find widget", 3000);
      await s.type('emerald');
      await s.waitFor(`!!document.querySelector('.monaco-editor .cdr.currentFindMatch') && !!document.querySelector('.monaco-editor .cdr.findMatch:not(.currentFindMatch)')`, 'the current match and another', 5000);
      await s.screenshot('m9-skin-monaco-find.png');
      const widget = await style('.monaco-editor .find-widget.visible', ['backgroundColor']);
      const current = await style('.monaco-editor .cdr.currentFindMatch', ['backgroundColor']);
      const other = await style('.monaco-editor .cdr.findMatch:not(.currentFindMatch)', ['backgroundColor']);
      // Chromium reports a color-mix() as color(srgb r g b / a) or as rgba().
      const parseColour = (str) => {
        const m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(str ?? '');
        if (m) return { rgb: [m[1], m[2], m[3]].map((x) => Math.round(Number(x) * 255)), a: m[4] === undefined ? 1 : Number(m[4]) };
        const r = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(str ?? '');
        if (r) return { rgb: [Number(r[1]), Number(r[2]), Number(r[3])], a: r[4] === undefined ? 1 : Number(r[4]) };
        return null;
      };
      const mix = parseColour(other?.backgroundColor);
      const mixOk = mix !== null && Math.abs(mix.a - 0.6) < 0.02 && [36, 64, 47].every((v, i) => Math.abs(mix.rgb[i] - v) <= 1);
      const findRead = { widget, current, other, mix };
      if (widget?.backgroundColor !== 'rgb(33, 40, 37)' || current?.backgroundColor !== 'rgb(29, 107, 71)' || !mixOk) {
        console.error(`[verify] monaco find read: ${JSON.stringify(findRead)}`);
      }
      expect(widget?.backgroundColor === 'rgb(33, 40, 37)', `the find widget is on --title-bg, got ${JSON.stringify(findRead)}`);
      expect(current?.backgroundColor === 'rgb(29, 107, 71)', `the current match is --find-active, got ${JSON.stringify(findRead)}`);
      expect(mixOk, `the other match is --find-match at 60 percent, got ${JSON.stringify(findRead)}`);
      step('M9 fix 655: under Emerald the find widget is on --title-bg and its matches in --find-active and --find-match');

      await s.key('Escape', 'Escape', 27);
      await skinTo(s, 'classic');
      await zreq(s, 'session.kill', { sessionId, remove: true }).catch(() => {});
    } finally {
      // The killed shell and the rail's watcher can hold the folder a moment
      // (EPERM on Windows, which Node 24 does not retry); it is a temp seed,
      // so give up quietly rather than mask the block's own outcome.
      for (let i = 0; i < 10; i++) {
        try {
          fs.rmSync(seedShort, { recursive: true, force: true });
          break;
        } catch {
          await sleep(500);
        }
      }
    }
  });

  // M9 fix 628: Emerald is the default. A relaunch on a fresh home with
  // no skin.json and EMERALD_SKIN unset (spawn drops a key whose value is
  // undefined) opens on Emerald with no click: main paints it, the renderer
  // asks main, stores it and tells main back.
  await block('default', async () => {
    // The daemon first: freshState deletes daemon.json, and a live daemon
    // then never rewrites it (the stale-daemon trap in CLAUDE.md).
    s.close();
    killTree(s.child);
    stopDaemon();
    fs.rmSync(skinFile, { force: true });
    s = await launch(freshPort(), { freshState: true, env: { EMERALD_SKIN: undefined } });
    await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'the empty pane after the relaunch', 20000);
    expect(mainLog().includes('window opens in the emerald skin'), `main opened the window in Emerald, got ${mainLog().split(/\r?\n/).filter((l) => l.includes('window opens')).join(' | ')}`);
    await until(() => mainLog().includes(EMERALD_LINE), "main heard the renderer's start on Emerald");
    expect((await skinNow(s)) === 'emerald', `data-skin is emerald with no click, got ${await skinNow(s)}`);
    expect((await s.evalJs(`localStorage.getItem('emerald.skin')`)) === 'emerald', "the renderer stored main's answer");
    const ground = await s.evalJs(`getComputedStyle(document.body).backgroundColor`);
    expect(ground === 'rgb(26, 31, 29)', `the Emerald ground, got ${ground}`);
    step('M9 fix 628: a fresh home with no EMERALD_SKIN opens on Emerald with no click, main and the page agreeing, and the renderer stores it');
    await skinTo(s, 'classic');
  });

  step(blocksRun());
  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m9-skin-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
