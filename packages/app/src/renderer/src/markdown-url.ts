// An image's src in a rendered markdown file (M13), resolved against the
// file's folder. A plain .ts beside MarkdownView.tsx so `node --test`
// reaches it (M9 fix 307's rule). A src with a scheme is left alone:
// markdown-it's own validateLink has already turned away file:,
// javascript: and the like, and the CSP allows no other remote image.
//
// A src that would name a host under file: is refused (M9 fix 478, the
// ledger's M31): `//host/x.png`, and since the URL parser reads a
// backslash as a slash under file:, `\\host`, `/\host` and `\/host` too,
// resolve to file://host/..., which the CSP allows (`img-src ... file:`)
// and Windows reads as a UNC path, an SMB connection to any host with the
// signed-in user's credentials offered. A refused src becomes empty
// rather than staying as written, since the page is itself loaded from
// file: and would resolve the scheme-relative form to the same UNC path;
// an empty src fetches nothing and the alt text shows.
import type { MarkdownIt } from 'markdown-it';

export function imageSrc(folder: string | undefined, src: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src;
  if (folder === undefined) return /^[/\\]{2}/.test(src) ? '' : src;
  return fileUrl(folder, src);
}

// The image rule with the src resolved against the env's folder:
// markdown-it's own rule does the rest (alt text, title), so only the
// attribute is changed before it runs. Shared by the Markdown tab and the
// chat view's replies (M9 fix 716).
export function installImageSrc(md: MarkdownIt): void {
  const renderImage = md.renderer.rules['image'];
  md.renderer.rules['image'] = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const src = token.attrGet('src');
    const folder = (env as { folder?: string }).folder;
    if (typeof src === 'string') token.attrSet('src', imageSrc(folder, src));
    return renderImage !== undefined ? renderImage(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
  };
}

// C:\docs + images/a.png gives file:///C:/docs/images/a.png; the URL
// constructor resolves a leading ../ the way a browser would.
export function fileUrl(folder: string, rel: string): string {
  if (/^[/\\]{2}/.test(rel)) return '';
  const base = `file:///${folder.replace(/\\/g, '/').replace(/\/?$/, '/')}`;
  try {
    const url = new URL(rel, base);
    return url.host === '' ? url.href : '';
  } catch {
    return rel;
  }
}
