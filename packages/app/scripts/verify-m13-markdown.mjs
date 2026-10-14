// M13 acceptance: markdown tabs. A click on a .md file in the rail opens
// it rendered, with the heading, the list, the fenced block, the table
// and the link in the DOM; a write on disk shows within two seconds and
// the scroll position survives it; Raw shows the Monaco editor and
// Rendered brings the article back; a .json file has no switch; the
// choice survives a reload; typing in a .ts file opens the word suggestion
// box on a solid ground and typing in a markdown file opens none (fix 634).
// Uses a private home and pipe unless the
// environment already names them.
// Run: npm run verify:markdown -w @emerald/app
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['EMERALD_HOME'] ??= path.join(os.tmpdir(), 'emerald-verify', 'm13-home');
process.env['EMERALD_PIPE'] ??= '\\\\.\\pipe\\emmerd-verify-m13';
const { CTRL, expect, freshPort, killTree, launch, sleep, startSession, step, stopDaemon } = await import('./cdp.mjs');

let app = null;
setTimeout(() => {
  console.error('[verify] WATCHDOG: run exceeded 180 s');
  if (app !== null) killTree(app.child);
  stopDaemon();
  setTimeout(() => process.exit(3), 500);
}, 180000);

// The seed: a README with one of everything, long enough to scroll, and a
// JSON file for the no-switch check. Resolved to the long form, as
// verify:files does, since the rail keys paths by what the shell reports.
const seedShort = path.join(os.tmpdir(), 'emerald-verify', `m13-tree-${process.pid}`);
fs.rmSync(seedShort, { recursive: true, force: true });
fs.mkdirSync(seedShort, { recursive: true });
const seed = fs.realpathSync.native(seedShort);
const readme = path.join(seed, 'README.md');
// A .txt holding JSON-shaped text: a .json has a view of its own since
// M9 fix 339, and this file is the one with none.
const hello = path.join(seed, 'hello.txt');
const filler = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of the filler, so the article is taller than the window.`).join('\n\n');
const readmeText = [
  '# Title of the file',
  '',
  'A paragraph with a [link](https://example.com/emerald) and `code`.',
  '',
  '- first item',
  '- second item',
  '- third item',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  filler,
  '',
].join('\n');
fs.writeFileSync(readme, readmeText);
fs.writeFileSync(hello, '{\n  "a": 1\n}\n');

const rowSel = (p) => `.files-row[data-path=${JSON.stringify(p)}]`;
const clickRow = (s, p) => s.evalJs(`document.querySelector(${JSON.stringify(rowSel(p))}).click()`);
const view = (s) => s.evalJs(`document.querySelector('.file-view')?.dataset.view ?? null`);
const hasArticle = (s) => s.evalJs(`!!document.querySelector('.file-view .markdown-view article.markdown')`);
const inArticle = (s, sel) => s.evalJs(`document.querySelectorAll(${JSON.stringify('.markdown ' + sel)}).length`);
const switchTo = (s, which) => s.evalJs(`document.querySelector('.file-view-switch [data-view=${which}]').click()`);
// An occluded window draws no frames and Monaco fills its lines in one,
// so a screenshot forces a frame before the DOM is read.
const shownText = async (s, name) => {
  await s.screenshot(name);
  return (await s.evalJs(`document.querySelector('.file-view .view-lines')?.textContent ?? ''`)).replace(/\u00a0/g, ' ');
};

const s = await launch(freshPort(), { freshState: true });
app = s;
try {
  await s.waitFor(`!!document.querySelector('.empty-pane .empty-start')`, 'empty pane');
  await startSession(s, { kind: 'shell', cwd: seed });
  await s.waitFor(`document.querySelectorAll('.files-row').length === 2`, 'the seed listed');

  // The markdown file opens rendered. The click then the double click
  // pins it (M9 fix 203), so hello.txt below opens beside it rather
  // than into the same preview tab.
  await clickRow(s, readme);
  await s.evalJs(`document.querySelector(${JSON.stringify(rowSel(readme))}).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.state === 'text'`, 'README.md read');
  expect((await view(s)) === 'rendered', `a markdown tab opens rendered (${await view(s)})`);
  expect(await hasArticle(s), 'the article is in the DOM');
  expect((await s.evalJs(`document.querySelector('.markdown h1')?.textContent`)) === 'Title of the file', 'the heading');
  expect((await inArticle(s, 'li')) === 3, `the list items (${await inArticle(s, 'li')})`);
  expect((await inArticle(s, 'pre > code')) === 1, 'the fenced block');
  expect((await inArticle(s, 'table td')) === 2, 'the table');
  expect((await s.evalJs(`document.querySelector('.markdown a')?.getAttribute('href')`)) === 'https://example.com/emerald', 'the link has its href');
  expect((await s.evalJs(`document.querySelector('.markdown code')?.textContent`)) === 'code', 'inline code');
  expect(!(await s.evalJs(`!!document.querySelector('.file-view .monaco-editor')`)) || (await s.evalJs(`document.querySelector('.file-editor').style.visibility === 'hidden'`)), 'the editor is hidden under it');
  expect(await s.evalJs(`document.activeElement?.classList.contains('markdown-view') === true`), 'the keyboard is in the rendered view');
  await s.screenshot('m13-rendered.png');
  step('a markdown file opens rendered with its heading, list, code, table and link');

  // A link goes out through the main process, not to the window. The
  // bridge function is replaced for the run when the bridge allows it;
  // either way the page must stay where it is.
  const stubbed = await s.evalJs(
    `(() => { try { window.emerald.files.openExternal = (u) => { window.__opened = u; return Promise.resolve(); }; return window.emerald.files.openExternal.toString().includes('__opened'); } catch { return false; } })()`,
  );
  const href = await s.evalJs(`location.href`);
  if (stubbed) {
    await s.evalJs(`document.querySelector('.markdown a').click()`);
    await sleep(200);
    expect((await s.evalJs(`window.__opened`)) === 'https://example.com/emerald', 'the click reached openExternal');
    expect((await s.evalJs(`location.href`)) === href, 'the window did not navigate');
    step('a link click goes to openExternal and the window stays put');
  } else {
    step('the bridge is sealed, so the link click is not driven (href checked above)');
  }

  // M9 fix 477: the page opens no window of emerald's. A window.open (what
  // Monaco's Ctrl+click on a URL runs) is denied and its URL goes to the
  // browser through openExternal, which under this private home is a
  // held line in main.log; a middle-click on a link is an auxclick, which
  // the view takes the same way rather than opening a window.
  const mainLog = path.join(process.env['EMERALD_HOME'], 'logs', 'main.log');
  const heldCount = (url) => {
    try {
      return fs.readFileSync(mainLog, 'utf8').split('\n').filter((l) => l.includes(`link held under a private EMERALD_HOME: ${url}`)).length;
    } catch {
      return 0;
    }
  };
  const pageTargets = async () => (await (await fetch(`http://127.0.0.1:${s.port}/json`)).json()).filter((t) => t.type === 'page').map((t) => t.url);
  const openUrl = 'https://example.invalid/x';
  const opened = await s.evalJs(`window.open(${JSON.stringify(openUrl)}) === null ? 'denied' : 'opened'`);
  expect(opened === 'denied', `window.open is denied a window (${opened})`);
  const heldDeadline = Date.now() + 3000;
  while (heldCount(openUrl) === 0 && Date.now() < heldDeadline) await sleep(100);
  expect(heldCount(openUrl) === 1, `window.open's URL went to openExternal, held in main.log (${heldCount(openUrl)})`);
  const targets = await pageTargets();
  expect(targets.length === 1, `one page target after window.open (${targets.join(', ')})`);
  const linkUrl = 'https://example.com/emerald';
  const heldBefore = heldCount(linkUrl);
  await s.evalJs(`window.__opened = null`);
  const prevented = await s.evalJs(`!document.querySelector('.markdown a').dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))`);
  expect(prevented, 'the middle-click default is prevented');
  if (stubbed) {
    await sleep(200);
    expect((await s.evalJs(`window.__opened`)) === linkUrl, 'the middle-click reached openExternal');
  } else {
    const auxDeadline = Date.now() + 3000;
    while (heldCount(linkUrl) === heldBefore && Date.now() < auxDeadline) await sleep(100);
    expect(heldCount(linkUrl) === heldBefore + 1, `the middle-click went to openExternal, held in main.log (${heldBefore} then ${heldCount(linkUrl)})`);
  }
  expect((await pageTargets()).length === 1, 'still one page target after the middle-click');
  expect((await s.evalJs(`location.href`)) === href, 'the window did not navigate');
  step('window.open and a middle-click on a link open no window and go to openExternal');

  // A write on disk shows without a refresh, and the place is kept.
  await s.evalJs(`document.querySelector('.markdown-view').scrollTop = 400`);
  await sleep(200);
  const before = await s.evalJs(`document.querySelector('.markdown-view').scrollTop`);
  expect(before >= 300, `the article scrolled (${before})`);
  fs.writeFileSync(readme, readmeText.replace('# Title of the file', '# Title of the file\n\n## A new section'));
  await s.waitFor(`!!document.querySelector('.markdown h2')`, 'the re-read after a change on disk', 3000);
  expect((await s.evalJs(`document.querySelector('.markdown h2').textContent`)) === 'A new section', 'the new heading is rendered');
  const after = await s.evalJs(`document.querySelector('.markdown-view').scrollTop`);
  expect(Math.abs(after - before) < 5, `the scroll position survived the re-render (${before} then ${after})`);
  step('a change on disk shows in the rendered view within a second with the place kept');

  // Raw is the editor; Rendered brings the article back.
  await switchTo(s, 'raw');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'raw'`, 'Raw picked');
  expect(!(await hasArticle(s)), 'the article is gone');
  expect(await s.evalJs(`document.querySelector('.file-editor').style.visibility === 'visible'`), 'the editor is showing');
  const text = await shownText(s, 'm13-raw.png');
  expect(text.includes('# Title of the file'), `the editor shows the first line: ${text.slice(0, 40)}`);
  expect(await s.evalJs(`!!document.activeElement?.closest('.monaco-editor')`), 'the keyboard is in the editor');
  await switchTo(s, 'rendered');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'rendered'`, 'Rendered picked');
  expect(await hasArticle(s), 'the article is back');
  expect((await s.evalJs(`document.querySelector('.markdown-view').scrollTop`)) >= 300, 'at the place it was left');
  step('Raw shows the Monaco editor and Rendered brings the article back');

  // A file that is not markdown has no switch.
  await clickRow(s, hello);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(hello)} && document.querySelector('.file-view')?.dataset.state === 'text'`, 'hello.txt read');
  expect((await view(s)) === null, 'no view on a plain text tab');
  expect(!(await s.evalJs(`!!document.querySelector('.file-view-switch')`)), 'no switch in its header');
  expect((await shownText(s, 'm13-json.png')).includes('"a": 1'), 'the editor as before');
  step('a file that is not markdown has the editor alone');


  // M9 fix 634: Monaco's word suggestion box. In a window where no .json has
  // opened, typing in a .ts file opens it on a solid ground (the widget's
  // colour is registered in the main chunk now); in a markdown file on Raw
  // typing opens none.
  const wordsTs = path.join(seed, 'words.ts');
  const notesMd = path.join(seed, 'notes.md');
  fs.writeFileSync(wordsTs, 'export const emeraldWidget = 1;\nexport const emeraldWindow = 2;\n');
  fs.writeFileSync(notesMd, '# Notes\n\nThe emeraldWidget and the emeraldWindow in prose.\n');
  await s.waitFor(`document.querySelectorAll('.files-row').length === 4`, 'the two new files listed', 5000);
  const editorOf = (p) => `document.querySelector('.file-view[data-path=' + ${JSON.stringify(JSON.stringify(p))} + '] .file-editor').emeraldEditor`;
  const cursorToEnd = (p) => s.evalJs(`(() => { const e = ${editorOf(p)}; const m = e.getModel(); const n = m.getLineCount(); e.setPosition({ lineNumber: n, column: m.getLineMaxColumn(n) }); e.focus(); })()`);
  const settleSave = async (p) => {
    await s.key('s', 'KeyS', 83, CTRL);
    await s.waitFor(`document.querySelector('.file-view[data-path=' + ${JSON.stringify(JSON.stringify(p))} + ']')?.dataset.dirty === undefined`, 'saved', 3000);
  };
  await clickRow(s, wordsTs);
  await s.waitFor(`document.querySelector('.file-view[data-path=' + ${JSON.stringify(JSON.stringify(wordsTs))} + ']')?.dataset.state === 'text' && !!${editorOf(wordsTs)}?.getModel()`, 'words.ts read', 5000);
  await cursorToEnd(wordsTs);
  await s.waitFor(`!!document.activeElement?.closest('.monaco-editor')`, 'the keyboard in the editor', 3000);
  await s.type('emer');
  await s.waitFor(`!!document.querySelector('.monaco-editor .suggest-widget.visible')`, 'the suggestion box', 3000);
  await s.screenshot('m13-suggest.png');
  const bg = await s.evalJs(`getComputedStyle(document.querySelector('.monaco-editor .suggest-widget.visible')).backgroundColor`);
  expect(bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent', `the suggestion box has a solid ground (${bg})`);
  expect((await s.evalJs(`document.querySelector('.monaco-editor .suggest-widget.visible').textContent`)).includes('emeraldWidget'), 'the box offers emeraldWidget');
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.suggest-widget.visible')`, 'the box closed', 3000);
  await settleSave(wordsTs);
  step('M9 fix 634: typing in a .ts file opens the word suggestion box on a solid ground, in a window where no .json has opened');

  await clickRow(s, notesMd);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(notesMd)} && document.querySelector('.file-view')?.dataset.view === 'rendered'`, 'notes.md rendered', 5000);
  await switchTo(s, 'raw');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'raw' && !!${editorOf(notesMd)}?.getModel()`, 'notes.md on Raw', 5000);
  await cursorToEnd(notesMd);
  await s.waitFor(`!!document.activeElement?.closest('.monaco-editor')`, 'the keyboard in the editor', 3000);
  await s.type('emer');
  await sleep(1500);
  expect(!(await s.evalJs(`!!document.querySelector('.monaco-editor .suggest-widget.visible')`)), 'typing in a markdown file opens no suggestion box');
  const qs = await s.evalJs(`JSON.stringify([${editorOf(notesMd)}.getRawOptions().quickSuggestions ?? null, ${editorOf(notesMd)}.getOption(102)])`);
  expect(JSON.parse(qs)[1].other === 'off', `quickSuggestions is off on the markdown view (${qs})`);
  await settleSave(notesMd);
  await switchTo(s, 'rendered');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'rendered'`, 'notes.md rendered again', 3000);
  step('M9 fix 634: typing in a markdown file on Raw opens no suggestion box');

  // M9 fix 658: a mermaid fence draws as its diagram in a box with a Code |
  // Diagram toggle; a fence that does not parse shows its code and the
  // error; find meets the shown side alone; a .mmd file opens as one box;
  // and the side picked is remembered when the file comes back.
  const diagramsMd = path.join(seed, 'diagrams.md');
  const flowMmd = path.join(seed, 'flow.mmd');
  fs.writeFileSync(diagramsMd, ['# Diagrams', '', '```mermaid', 'graph TD', '  Alpha-->Beta', '  Alpha-->Gamma', '```', '', '```mermaid', 'notadiagram', '  Delta', '```', ''].join('\n'));
  fs.writeFileSync(flowMmd, 'graph LR\n  Kappa-->Lambda\n');
  await s.waitFor(`document.querySelectorAll('.files-row').length === 6`, 'diagrams.md and flow.mmd listed', 5000);
  const box0 = `document.querySelector('.markdown .md-mermaid[data-key="0"]')`;
  const box1 = `document.querySelector('.markdown .md-mermaid[data-key="1"]')`;
  await clickRow(s, diagramsMd);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(diagramsMd)} && document.querySelector('.file-view')?.dataset.view === 'rendered' && document.activeElement?.classList.contains('markdown-view') === true`, 'diagrams.md rendered with the keyboard', 5000);
  expect((await inArticle(s, '.md-mermaid')) === 2, `two mermaid boxes (${await inArticle(s, '.md-mermaid')})`);
  await s.waitFor(`!!document.querySelector('.markdown .md-mermaid[data-key="0"] .md-mermaid-diagram[data-state="drawn"] svg')`, 'box 0 drawn', 15000);
  expect((await s.evalJs(`${box0}.dataset.side`)) === 'diagram', 'box 0 opens on the diagram');
  expect(await s.evalJs(`${box0}.querySelector('pre').hidden`), "box 0's code is hidden");
  expect((await s.evalJs(`${box0}.querySelector('.md-mermaid-diagram').dataset.theme`)) === 'dark', "box 0's diagram is on the dark theme");
  const svgText = await s.evalJs(`${box0}.querySelector('svg').textContent`);
  expect(['Alpha', 'Beta', 'Gamma'].every((w) => svgText.includes(w)), `the diagram's labels (${svgText.slice(0, 80)})`);
  await s.waitFor(`${box1}?.querySelector('.md-mermaid-diagram')?.dataset.state === 'error'`, 'box 1 an error', 15000);
  expect(await s.evalJs(`${box1}.hasAttribute('data-error')`), 'box 1 is marked an error');
  expect(await s.evalJs(`!${box1}.querySelector('pre').hidden && ${box1}.querySelector('pre').textContent.includes('notadiagram')`), "box 1's code is shown");
  expect(await s.evalJs(`${box1}.querySelector('.md-mermaid-toggle').hidden`), "box 1's toggle is hidden");
  const errLine = await s.evalJs(`${box1}.querySelector('.md-mermaid-error')?.textContent ?? ''`);
  expect(errLine.startsWith('Diagram error: '), `the error line (${errLine})`);
  await s.screenshot('m13-mermaid.png');

  // Find: the diagram's labels count and the hidden code does not.
  const countJs = `document.querySelector('.view-find-bar')?.dataset.count`;
  await s.key('f', 'KeyF', 70, CTRL);
  await s.waitFor(`!!document.activeElement?.closest('.view-find-bar') &&document.activeElement?.classList.contains('find-input') === true`, 'the find bar with the keyboard', 3000);
  await s.type('Alpha');
  const svgAlpha = await s.evalJs(`(() => { const w = document.createTreeWalker(${box0}.querySelector('svg'), NodeFilter.SHOW_TEXT); let n = 0; for (let t = w.nextNode(); t !== null; t = w.nextNode()) { if (t.parentElement?.closest('style') !== null) continue; n += t.data.split('Alpha').length - 1; } return n; })()`);
  expect(svgAlpha >= 1, `Alpha is in the diagram's text (${svgAlpha})`);
  await s.waitFor(`${countJs} === ${JSON.stringify(String(svgAlpha))}`, `the find count is the diagram's ${svgAlpha}`, 3000);
  await s.evalJs(`${box0}.querySelector('.md-mermaid-toggle [data-side="code"]').click()`);
  expect((await s.evalJs(`${box0}.dataset.side`)) === 'code', 'box 0 on Code');
  expect(await s.evalJs(`!${box0}.querySelector('pre').hidden && ${box0}.querySelector('.md-mermaid-diagram').hidden`), 'the code shown and the diagram hidden');
  await s.waitFor(`${countJs} === '2'`, "the find count is the code's 2", 3000);
  await s.evalJs(`${box0}.querySelector('.md-mermaid-toggle [data-side="diagram"]').click()`);
  await s.waitFor(`${countJs} === ${JSON.stringify(String(svgAlpha))}`, 'the find count back on the diagram', 3000);
  await s.evalJs(`${box0}.querySelector('.md-mermaid-toggle [data-side="code"]').click()`);
  await s.key('Escape', 'Escape', 27);
  await s.waitFor(`!document.querySelector('.view-find-bar')`, 'the find bar closed', 3000);

  // A .mmd file opens rendered as one box, in the preview tab.
  await clickRow(s, flowMmd);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(flowMmd)} && document.querySelector('.file-view')?.dataset.view === 'rendered' && document.querySelector('.file-view')?.dataset.state === 'text'`, 'flow.mmd read and rendered', 5000);
  expect(await s.evalJs(`!!document.querySelector('.file-view-switch')`), 'the .mmd tab has the switch');
  const mmdArticle = await s.evalJs(`document.querySelector('.markdown')?.innerHTML.slice(0, 300) ?? null`);
  expect((await inArticle(s, '.md-mermaid')) === 1, `one box for the .mmd (${await inArticle(s, '.md-mermaid')}): ${mmdArticle}`);
  await s.waitFor(`document.querySelector('.markdown .md-mermaid-diagram[data-state="drawn"] svg')?.textContent.includes('Kappa') === true`, 'the .mmd drawn', 15000);

  // The side picked on box 0 comes back with the file.
  await clickRow(s, diagramsMd);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(diagramsMd)} && ${box0}?.dataset.side === 'code' && ${box0}?.querySelector('pre').hidden === false`, 'box 0 back on Code', 5000);
  step('M9 fix 658: a mermaid fence draws as a diagram with a Code | Diagram toggle, a broken one shows its code and the error, find meets the shown side alone, a .mmd file opens as one box, and the side is remembered');

  // The choice survives a reload.
  await s.evalJs(`document.querySelector(${JSON.stringify(`.tab[data-tab=${JSON.stringify(readme)}]`)}).click()`);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'rendered'`, 'back on the README, rendered');
  await switchTo(s, 'raw');
  await s.waitFor(`document.querySelector('.file-view')?.dataset.view === 'raw'`, 'Raw again');
  await s.send('Page.reload');
  await sleep(1500);
  await s.waitFor(`document.querySelector('.file-view')?.dataset.path === ${JSON.stringify(readme)} && document.querySelector('.file-view')?.dataset.state === 'text'`, 'the tab is back after a reload');
  expect((await view(s)) === 'raw', `the choice came back (${await view(s)})`);
  expect((await s.evalJs(`JSON.parse(localStorage.getItem('emerald.tabs')).raw`)).join() === readme, 'emerald.tabs lists the raw tab');
  step('the view choice survives a renderer reload');

  step('PASS');
} catch (err) {
  console.error('[verify] FAIL', err);
  await s.screenshot('m13-markdown-fail.png').catch(() => {});
  console.error(s.logs.join(''));
  console.error(s.consoleLog.slice(-15).join('\n'));
  process.exitCode = 1;
} finally {
  s.close();
  killTree(s.child);
  stopDaemon();
  try {
    fs.rmSync(seed, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Left for the next run.
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
