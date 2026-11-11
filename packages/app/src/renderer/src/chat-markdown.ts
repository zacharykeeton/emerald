import MarkdownIt from 'markdown-it';
import { installImageSrc } from './markdown-url.ts';
import { drivePathsIn, folderPath, isDrivePath, pathCandidate, resolveIn } from './chat-paths.ts';
import { isImageName } from './chat-model.ts';
import { pathLinkParts, pathLinksIn } from './path-links.ts';

// M9 fix 716: Claude's replies in the chat view, rendered as Markdown.
// The chat's own instance of the Markdown tab's setup (html off, so no
// tag in a reply reaches the DOM; linkify on; a relative image resolved
// against the folder), without the tab's mermaid boxes and heading folds,
// which are wrong for a reply. Pure, so node:test covers it. A picture's
// path is linked wherever it resolves, in a code span or bare in the
// text, other files only inside the folder (M9 fix 864); an absolute
// drive path to a file links wherever it is, a code span, bare text or a
// fenced block (M9 fix 1099), while a relative one keeps those rules.
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
// path link (data-path, and data-line from a :N tail); a picture's path
// is one wherever it resolves (M9 fix 864). One not yet statted is asked
// for, and is plain until the stat answers.
md.renderer.rules['code_inline'] = (tokens, idx, _options, env) => {
  const token = tokens[idx]!;
  const text = md.utils.escapeHtml(token.content);
  const { cwd, known, ask } = env as unknown as ReplyEnv;
  const cand = pathCandidate(token.content);
  const abs = cand === null ? null : isImageName(cand.rel) || isDrivePath(cand.rel) ? resolveIn(cwd, cand.rel) : folderPath(cwd, cand.rel);
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

// A picture's path bare in the text is a link too (M9 fix 864), found by
// the terminal's own rule (path-links.ts: a drive path, or a relative one
// holding a separator) and resolved wherever it points, once a stat says
// it is a file. A link's own text is left to the link.
md.renderer.rules['text'] = (tokens, idx, _options, env) => {
  const content = tokens[idx]!.content;
  let depth = 0;
  for (let i = 0; i < idx; i++) {
    if (tokens[i]!.type === 'link_open') depth++;
    else if (tokens[i]!.type === 'link_close') depth--;
  }
  if (depth > 0) return md.utils.escapeHtml(content);
  const { cwd, known, ask } = env as unknown as ReplyEnv;
  let out = '';
  let at = 0;
  for (const link of pathLinksIn(content)) {
    const { path, line } = pathLinkParts(link.text);
    // M9 fix 1099: an absolute drive path links bare too, at its line.
    if (!isImageName(path) && !isDrivePath(path)) continue;
    const abs = resolveIn(cwd, path);
    if (abs === null) continue;
    const kind = known(abs);
    if (kind === undefined && !ask.includes(abs)) ask.push(abs);
    if (kind !== 'file') continue;
    out += md.utils.escapeHtml(content.slice(at, link.start));
    out += pathSpan(abs, line ?? null, link.text);
    at = link.end;
  }
  return out + md.utils.escapeHtml(content.slice(at));
};

function pathSpan(abs: string, line: number | null, text: string): string {
  const at = line === null ? '' : ` data-line="${line}"`;
  return `<span class="chat-path" data-path="${md.utils.escapeHtml(abs)}"${at}>${md.utils.escapeHtml(text)}</span>`;
}

// M9 fix 1099: a fenced block's content with each drive path a stat calls
// a file wrapped in a link, the rest escaped as the default fence does;
// each path not yet statted is asked once. Passed as the fence's
// highlight, so markdown-it keeps its own <pre><code class="language-x">.
function linkDrivePaths(code: string, env: ReplyEnv): string {
  const { known, ask } = env;
  let out = '';
  let at = 0;
  for (const link of drivePathsIn(code)) {
    const kind = known(link.abs);
    if (kind === undefined && !ask.includes(link.abs)) ask.push(link.abs);
    if (kind !== 'file') continue;
    out += md.utils.escapeHtml(code.slice(at, link.start));
    out += pathSpan(link.abs, link.line, link.text);
    at = link.end;
  }
  return out + md.utils.escapeHtml(code.slice(at));
}

// M9 fix 978: a fenced block sits in a wrapper with a copy button at its
// top right, outside the pre so it stays put while the block scrolls
// sideways. The button is empty (its glyph is CSS), so a reply's
// textContent is what it was; the pre's own trailing newline is dropped
// for the same reason, the wrapper's taking its place.
const fence = md.renderer.rules['fence']!;
md.renderer.rules['fence'] = (tokens, idx, options, env, self) =>
  `<div class="chat-code"><button type="button" class="chat-code-copy" aria-label="Copy" title="Copy"></button>${fence(tokens, idx, { ...options, highlight: (code) => linkDrivePaths(code, env as unknown as ReplyEnv) }, env, self).trimEnd()}</div>\n`;

export function renderReply(text: string, cwd: string, known: Known): { html: string; ask: string[] } {
  const env: ReplyEnv = { cwd, known, ask: [] };
  if (cwd !== '') env.folder = cwd;
  // Trimmed, so a one-paragraph reply reads exactly as its text did.
  const html = md.render(text, env as unknown as Record<string, unknown>).trim();
  return { html, ask: env.ask };
}
