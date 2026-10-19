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

test('a relative link outside the folder loses its path; one that climbs back in keeps it, and no link is statted (M9 fix 756)', () => {
  const { html, ask } = renderReply('[up](../other.md), [in](docs/PLAN.md) and [back](../repo/docs/PLAN.md)', 'C:\\repo', () => undefined);
  assert.ok(html.includes('<a>up</a>'));
  assert.ok(html.includes('<a data-path="C:\\repo\\docs\\PLAN.md">in</a>'));
  assert.ok(html.includes('<a data-path="C:\\repo\\docs\\PLAN.md">back</a>'));
  assert.deepEqual(ask, []);
});

test('a path outside the folder or with no folder stays plain (M9 fix 716)', () => {
  const all = () => 'file' as const;
  assert.ok(renderReply('`C:/other/x.ts`', 'C:\\repo', all).html.includes('<code>C:/other/x.ts</code>'));
  assert.ok(renderReply('`docs/x.md`', '', all).html.includes('<code>docs/x.md</code>'));
  assert.ok(renderReply('`docs/x`', 'C:\\repo', () => 'other').html.includes('<code>docs/x</code>'));
});

const pictures = (abs: string) => (abs === 'C:\\other\\shots\\a.png' || abs === 'C:\\other\\shots\\frame_864.png' ? ('file' as const) : undefined);
const pictureReply = 'the frame `C:/other/shots/a.png` and C:\\other\\shots\\frame_864.png, see.';

test('a picture outside the folder is a link in a code span and bare in the text once a stat says it is a file (M9 fix 864)', () => {
  const { html } = renderReply(pictureReply, 'C:\\repo', pictures);
  assert.ok(html.includes('<code class="chat-path" data-path="C:\\other\\shots\\a.png">C:/other/shots/a.png</code>'), html);
  assert.ok(html.includes('<span class="chat-path" data-path="C:\\other\\shots\\frame_864.png">C:\\other\\shots\\frame_864.png</span>, see.'), html);
});

test('an unstatted picture is asked for and drawn plain (M9 fix 864)', () => {
  const { html, ask } = renderReply(pictureReply, 'C:\\repo', () => undefined);
  assert.deepEqual(ask, ['C:\\other\\shots\\a.png', 'C:\\other\\shots\\frame_864.png']);
  assert.ok(!html.includes('chat-path'), html);
});

test("a picture in the text resolves a relative path with a folder, and a bare name, another file or a link's text stays plain (M9 fix 864)", () => {
  const reply = 'see img/shot.png, logo.png, C:\\other\\x.ts and [C:\\other\\b.png](https://example.com/x)';
  assert.deepEqual(renderReply(reply, 'C:\\repo', () => undefined).ask, ['C:\\repo\\img\\shot.png']);
  const { html } = renderReply(reply, 'C:\\repo', () => 'file');
  assert.equal(html.match(/chat-path/g)?.length, 1, html);
  assert.ok(html.includes('<span class="chat-path" data-path="C:\\repo\\img\\shot.png">img/shot.png</span>'), html);
  assert.ok(html.includes('<a href="https://example.com/x">C:\\other\\b.png</a>'), html);
});

test('a picture with no folder links only by a drive path (M9 fix 864)', () => {
  const { html } = renderReply('`img/a.png` and C:\\other\\a.png', '', () => 'file');
  assert.ok(html.includes('<code>img/a.png</code>'), html);
  assert.ok(html.includes('<span class="chat-path" data-path="C:\\other\\a.png">C:\\other\\a.png</span>'), html);
});
