// The pure part of the markdown view's mermaid boxes (M9 fix 658), with
// no DOM and no mermaid at runtime so node:test can cover it. A fence
// whose info string starts with the word `mermaid` renders as a box with
// a Code | Diagram toggle, both sides in the HTML and one hidden; the
// drawing itself is mermaid-draw.ts's, after the HTML is in the page.
import type { MarkdownIt } from 'markdown-it';
import { isDark } from './monaco-theme-model.ts';

export type MermaidSide = 'code' | 'diagram';
export type MermaidTheme = 'dark' | 'default';

// What the fence rule reads off markdown-it's env: the count of mermaid
// fences rendered so far in this file, which is the next box's key, and
// the sides the person picked, kept per file by the view while the app
// runs. The key is the ordinal rather than the text, so editing a diagram
// while it is shown keeps its side.
export interface MermaidEnv {
  next: number;
  sides: ReadonlyMap<string, MermaidSide>;
}

// GitHub's rule: the first word of the info string, exactly `mermaid`.
export function isMermaidInfo(info: string): boolean {
  return info.trim().split(/\s+/)[0] === 'mermaid';
}

// Wraps markdown-it's own fence rule; every other fence goes through it
// unchanged.
export function installMermaidFence(md: MarkdownIt): void {
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    if (!isMermaidInfo(token.info)) {
      return fence !== undefined ? fence(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
    }
    const holder = env as { mermaid?: MermaidEnv };
    if (holder.mermaid === undefined) holder.mermaid = { next: 0, sides: new Map() };
    const key = String(holder.mermaid.next);
    holder.mermaid.next += 1;
    const side: MermaidSide = holder.mermaid.sides.get(key) === 'code' ? 'code' : 'diagram';
    const src = md.utils.escapeHtml(token.content);
    const code = side === 'code';
    return (
      `<div class="md-mermaid" data-key="${key}" data-side="${side}">\n` +
      `<div class="md-mermaid-toggle" role="group" aria-label="Diagram or code">` +
      `<button type="button" data-side="code"${code ? ' data-active=""' : ''}>Code</button>` +
      `<button type="button" data-side="diagram"${code ? '' : ' data-active=""'}>Diagram</button></div>\n` +
      `<pre class="md-mermaid-code"${code ? '' : ' hidden'}><code class="language-mermaid">${src}</code></pre>\n` +
      `<div class="md-mermaid-diagram" data-state="pending"${code ? ' hidden' : ''}></div>\n` +
      `</div>\n`
    );
  };
}

// A .mmd file shown as one fence: the backtick run one longer than the
// longest in the text, so a line of backticks inside cannot close it.
export function mermaidDocument(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  const body = text.endsWith('\n') ? text : `${text}\n`;
  return `${ticks}mermaid\n${body}${ticks}\n`;
}

// The document's ground picks the theme: null is the skin's ground, dark
// under both skins; a file's own scheme names its background.
export function mermaidThemeFor(background: string | null): MermaidTheme {
  if (background === null) return 'dark';
  return isDark(background) ? 'dark' : 'default';
}

const ERROR_LINE_MAX = 200;

// The one line shown under a block that does not parse: mermaid's
// messages run to a quoted copy of the text on later lines.
export function diagramErrorLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  let line = message.split('\n')[0] ?? '';
  if (line.length > ERROR_LINE_MAX) line = `${line.slice(0, ERROR_LINE_MAX - 1)}…`;
  return `Diagram error: ${line}`;
}

// The drawn SVGs and errors by theme and source, so a re-render of an
// unchanged file draws at once; a Map keeps insertion order, so the
// first key is the oldest.
export const MERMAID_CACHE_LIMIT = 64;

export function remember<V>(cache: Map<string, V>, key: string, value: V): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MERMAID_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
