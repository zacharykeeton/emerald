import MarkdownIt from 'markdown-it';
import { installImageSrc } from './markdown-url.ts';
import { folderPath, pathCandidate } from './chat-paths.ts';

// M9 fix 716: Claude's replies in the chat view, rendered as Markdown.
// The chat's own instance of the Markdown tab's setup (html off, so no
// tag in a reply reaches the DOM; linkify on; a relative image resolved
// against the folder), without the tab's mermaid boxes and heading folds,
// which are wrong for a reply. Pure, so node:test covers it.
const md = new MarkdownIt({ html: false, linkify: true });
installImageSrc(md);

type Known = (abs: string) => 'file' | 'other' | undefined;
interface ReplyEnv {
  folder?: string;
  cwd: string;
  known: Known;
  ask: string[];
}

// A link to the web keeps its href; any other link loses it, so a click
// on it navigates nowhere, and a relative one (no scheme, not an anchor)
// that resolves inside the session's folder carries that path as
// data-path, which the view opens in a tab; one that climbs out with `..`
// is a bare link, as a code span outside the folder is plain (M9 fix 756).
// A link is not statted.
md.renderer.rules['link_open'] = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const raw = token.attrGet('href');
  const href = raw === null ? null : String(raw);
  if (href !== null && !/^https?:/i.test(href)) {
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'href');
    const { cwd } = env as unknown as ReplyEnv;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
      const abs = folderPath(cwd, href);
      if (abs !== null) token.attrSet('data-path', abs);
    }
  }
  return self.renderToken(tokens, idx, options);
};

// An inline code span that names a file in the session's folder is a
// path link (data-path, and data-line from a :N tail). One not yet
// statted is asked for, and is plain until the stat answers.
md.renderer.rules['code_inline'] = (tokens, idx, _options, env) => {
  const token = tokens[idx]!;
  const text = md.utils.escapeHtml(token.content);
  const { cwd, known, ask } = env as unknown as ReplyEnv;
  const cand = pathCandidate(token.content);
  const abs = cand === null ? null : folderPath(cwd, cand.rel);
  if (cand !== null && abs !== null) {
    const kind = known(abs);
    if (kind === 'file') {
      const line = cand.line === null ? '' : ` data-line="${cand.line}"`;
      return `<code class="chat-path" data-path="${md.utils.escapeHtml(abs)}"${line}>${text}</code>`;
    }
    if (kind === undefined && !ask.includes(abs)) ask.push(abs);
  }
  return `<code>${text}</code>`;
};

export function renderReply(text: string, cwd: string, known: Known): { html: string; ask: string[] } {
  const env: ReplyEnv = { cwd, known, ask: [] };
  if (cwd !== '') env.folder = cwd;
  // Trimmed, so a one-paragraph reply reads exactly as its text did.
  const html = md.render(text, env as unknown as Record<string, unknown>).trim();
  return { html, ask: env.ask };
}
