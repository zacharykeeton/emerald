import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReply } from './chat-markdown.ts';

const known = (abs: string) => (abs === 'C:\\repo\\docs\\PLAN.md' ? ('file' as const) : undefined);

test('a reply renders as Markdown with its paths live (M9 fix 716)', () => {
  const reply =
    'Fixed it:\n\n- **Why:** the key\n- see `docs/PLAN.md:12` and [the plan](docs/PLAN.md)\n- and README.md, https://example.com/x, `npm run build` and `src/new.ts`\n\n```ts\nconst x = 1;\n```\n\n<b>raw</b>';
  const { html, ask } = renderReply(reply, 'C:\\repo', known);
  assert.ok(html.includes('<strong>Why:</strong>'), html);
  assert.equal(html.match(/<ul>/g)?.length, 1);
  assert.equal(html.match(/<li>/g)?.length, 3);
  assert.ok(html.includes('<code class="chat-path" data-path="C:\\repo\\docs\\PLAN.md" data-line="12">'), html);
  assert.ok(html.includes('<a data-path="C:\\repo\\docs\\PLAN.md">'), html);
  assert.ok(!/<a[^>]*href="docs/.test(html), html);
  assert.ok(html.includes('<a href="https://example.com/x">'), html);
  assert.ok(!/<a[^>]*>README\.md/.test(html), html);
  assert.ok(html.includes('<code>npm run build</code>'), html);
  assert.deepEqual(ask, ['C:\\repo\\src\\new.ts']);
  assert.ok(html.includes('<pre><code class="language-ts">'), html);
  assert.ok(html.includes('&lt;b&gt;'), html);
  assert.equal(renderReply('Done.', 'C:\\repo', () => undefined).html, '<p>Done.</p>');
});

test('a reply image resolves against the session folder (M9 fix 716)', () => {
  const { html } = renderReply('![shot](img/a.png)', 'C:\\repo', () => undefined);
  assert.ok(html.includes('src="file:///C:/repo/img/a.png"'), html);
});

test('a link with another scheme or an anchor loses its href and gains no path (M9 fix 716)', () => {
  const { html } = renderReply('[mail](mailto:a@b.c) and [top](#x)', 'C:\\repo', () => undefined);
  assert.ok(html.includes('<a>mail</a>'), html);
  assert.ok(html.includes('<a>top</a>'), html);
});

test('a path outside the folder or with no folder stays plain (M9 fix 716)', () => {
  const all = () => 'file' as const;
  assert.ok(renderReply('`C:/other/x.ts`', 'C:\\repo', all).html.includes('<code>C:/other/x.ts</code>'));
  assert.ok(renderReply('`docs/x.md`', '', all).html.includes('<code>docs/x.md</code>'));
  assert.ok(renderReply('`docs/x`', 'C:\\repo', () => 'other').html.includes('<code>docs/x</code>'));
});
