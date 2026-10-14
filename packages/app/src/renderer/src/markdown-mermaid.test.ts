import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { MERMAID_CACHE_LIMIT, diagramErrorLine, installMermaidFence, isMermaidInfo, mermaidDocument, mermaidThemeFor, remember } from './markdown-mermaid.ts';
import type { MermaidSide } from './markdown-mermaid.ts';

function mdWith(): MarkdownIt {
  const md = new MarkdownIt({ html: false });
  installMermaidFence(md);
  return md;
}

const source = '```mermaid\ngraph TD\n  A-->B & <x>\n```\n';
const src = 'graph TD\n  A--&gt;B &amp; &lt;x&gt;\n';

test('a mermaid fence renders as a box on the diagram side', () => {
  const html = mdWith().render(source);
  assert.equal(
    html,
    '<div class="md-mermaid" data-key="0" data-side="diagram">\n' +
      '<div class="md-mermaid-toggle" role="group" aria-label="Diagram or code"><button type="button" data-side="code">Code</button><button type="button" data-side="diagram" data-active="">Diagram</button></div>\n' +
      `<pre class="md-mermaid-code" hidden><code class="language-mermaid">${src}</code></pre>\n` +
      '<div class="md-mermaid-diagram" data-state="pending"></div>\n' +
      '</div>\n',
  );
});

test('a box remembered on the code side renders the code side', () => {
  const sides = new Map<string, MermaidSide>([['0', 'code']]);
  const html = mdWith().render(source, { mermaid: { next: 0, sides } });
  assert.equal(
    html,
    '<div class="md-mermaid" data-key="0" data-side="code">\n' +
      '<div class="md-mermaid-toggle" role="group" aria-label="Diagram or code"><button type="button" data-side="code" data-active="">Code</button><button type="button" data-side="diagram">Diagram</button></div>\n' +
      `<pre class="md-mermaid-code"><code class="language-mermaid">${src}</code></pre>\n` +
      '<div class="md-mermaid-diagram" data-state="pending" hidden></div>\n' +
      '</div>\n',
  );
});

test('boxes are keyed by their ordinal and other fences are left alone', () => {
  const html = mdWith().render('```mermaid\ngraph TD\n```\n\n```js\nconst x = 1;\n```\n\n```mermaid\ngraph LR\n```\n');
  assert.match(html, /data-key="0"/);
  assert.match(html, /data-key="1"/);
  assert.ok(html.includes('<pre><code class="language-js">const x = 1;\n</code></pre>\n'));
});

test('the info string must start with the word mermaid exactly', () => {
  assert.equal(isMermaidInfo('mermaid'), true);
  assert.equal(isMermaidInfo('mermaid title'), true);
  assert.equal(isMermaidInfo('Mermaid'), false);
  assert.equal(isMermaidInfo('mermaidjs'), false);
  assert.match(mdWith().render('```mermaid title\ngraph TD\n```\n'), /class="md-mermaid"/);
  assert.doesNotMatch(mdWith().render('```Mermaid\ngraph TD\n```\n'), /md-mermaid/);
  assert.doesNotMatch(mdWith().render('```mermaidjs\ngraph TD\n```\n'), /md-mermaid/);
});

test('a .mmd file becomes one fence, its backticks longer than any inside', () => {
  const md = new MarkdownIt();
  const tokens = md.parse(mermaidDocument('graph LR\n  K-->L'), {});
  const fences = tokens.filter((t) => t.type === 'fence');
  assert.equal(fences.length, 1);
  assert.equal(fences[0]!.info, 'mermaid');
  assert.equal(fences[0]!.content, 'graph LR\n  K-->L\n');
  const tricky = 'graph LR\n```\n  A-->B\n';
  const doc = mermaidDocument(tricky);
  assert.ok(doc.startsWith('````mermaid\n'));
  const back = md.parse(doc, {}).filter((t) => t.type === 'fence');
  assert.equal(back.length, 1);
  assert.equal(back[0]!.content, tricky);
});

test('the theme follows the lightness of the ground', () => {
  assert.equal(mermaidThemeFor(null), 'dark');
  assert.equal(mermaidThemeFor('#fdf6e3'), 'default');
  assert.equal(mermaidThemeFor('#282a36'), 'dark');
});

test('the error line is the first line of the message, cut at 200', () => {
  assert.equal(
    diagramErrorLine(new Error('No diagram type detected matching given configuration for text: notadiagram\n  Delta')),
    'Diagram error: No diagram type detected matching given configuration for text: notadiagram',
  );
  const long = diagramErrorLine(new Error('x'.repeat(300)));
  assert.equal(long, `Diagram error: ${'x'.repeat(199)}…`);
  assert.equal(diagramErrorLine('x'), 'Diagram error: x');
});

test('remember drops the oldest past the limit and moves a re-set key to the newest', () => {
  const cache = new Map<string, number>();
  for (let i = 0; i < MERMAID_CACHE_LIMIT; i++) remember(cache, `k${i}`, i);
  remember(cache, 'k0', 0);
  remember(cache, 'extra', 99);
  assert.equal(cache.size, MERMAID_CACHE_LIMIT);
  assert.equal(cache.has('k1'), false);
  assert.equal(cache.has('k0'), true);
  assert.deepEqual([...cache.keys()].slice(-2), ['k0', 'extra']);
});
