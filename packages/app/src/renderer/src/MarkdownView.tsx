import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';
import { openBeside } from './actions.ts';
import { browserViewSupported } from './daemon-model.ts';
import { parentPath } from './files-model.ts';
import { defaultFolds, foldSections } from './markdown-fold-model.ts';
import type { FoldSection } from './markdown-fold-model.ts';
import { installImageSrc } from './markdown-url.ts';
import { SOURCE_LINE_FLASH_MS, blockAtLine, installSourceLines } from './markdown-source-line.ts';
import { installMermaidFence } from './markdown-mermaid.ts';
import type { MermaidSide, MermaidTheme } from './markdown-mermaid.ts';
import { drawMermaid, showSide } from './mermaid-draw.ts';
import { getState } from './store.ts';

// A markdown file rendered for reading. markdown-it with html off, so no
// tag written in the file reaches the DOM and there is nothing to
// sanitize; linkify on, so a bare URL is a link. A relative image is
// resolved against the file's folder as a file: URL, which the page's
// CSP allows, and one that would name a host is refused (markdown-url.ts,
// M9 fix 478). The scroll container is the outer div, focusable so the
// wheel and the arrow keys scroll it once it has been clicked, and its
// position is kept per file while the app runs, the way monaco.ts keeps
// the editor's view state. Every ## and ### heading folds (M9 fix 272):
// a post-pass over markdown-it's tokens wraps each heading and its
// section in a block, a click on the heading toggles it, and the folds
// are kept per file beside the scroll position. A mermaid fence is a box
// with its diagram and a Code | Diagram toggle (M9 fix 658), the side
// kept per box beside the folds.
const md = new MarkdownIt({ html: false, linkify: true });
installMermaidFence(md);
installImageSrc(md);
installSourceLines(md);

interface ViewState {
  scrollTop: number;
  // The keys of the folded sections (markdown-fold-model.ts), null until
  // the file's first render, which fills in the defaults.
  folded: Set<string> | null;
  // The side picked on each mermaid box, by its ordinal in the file.
  sides: Map<string, MermaidSide>;
}

const views = new Map<string, ViewState>();

function viewState(path: string): ViewState {
  let v = views.get(path);
  if (v === undefined) {
    v = { scrollTop: 0, folded: null, sides: new Map() };
    views.set(path, v);
  }
  return v;
}

// foldOlder: on the What's New tab the batches but the newest start
// folded, so the tab opens on what is new; a plain file opens whole.
// diagramTheme: mermaid's theme for the ground the document sits on, the
// skin's dark one unless the file wears a light scheme of its own.
export function MarkdownView({ path, text, foldOlder = false, diagramTheme = 'dark', paneId, reveal = null, onRevealed }: { path: string; text: string; foldOlder?: boolean; diagramTheme?: MermaidTheme; paneId?: string | undefined; reveal?: { line: number; seq: number } | null; onRevealed?: (seq: number) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<{ el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const folder = parentPath(path);
  const html = useMemo(() => render(text, folder, viewState(path), foldOlder), [text, folder, path, foldOlder]);

  // Draws the mermaid boxes. Declared before the scroll effect so it runs
  // first: a cached diagram is written synchronously, so an unchanged file
  // re-rendered has its height back before the position is put back, and
  // only a new or changed fence waits for mermaid.
  useLayoutEffect(() => {
    const article = articleRef.current;
    if (article === null) return;
    let live = true;
    void drawMermaid(article, diagramTheme, () => live).catch((err: unknown) => console.warn('[emerald] mermaid draw failed', err));
    return () => {
      live = false;
    };
  }, [html, diagramTheme]);

  // A re-render from a change on disk keeps the place: the new tree is in
  // before the position is put back, so the browser never gets to clamp
  // it against an empty article. The cleanup notes the position as well
  // as onScroll does, because a scroll event only arrives on an animation
  // frame and a window behind another gets none, so a position set while
  // the window was covered would otherwise be lost on the next re-render.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    host.scrollTop = viewState(path).scrollTop;
    return () => {
      viewState(path).scrollTop = host.scrollTop;
    };
  }, [html, path]);

  // M9 fix 892: a reveal at a line scrolls to the block holding it, opens
  // the folded sections around it and lights it. Declared after the scroll
  // restore so it wins over the kept position. The attribute on the host
  // stays until the next reveal; the verify scripts read it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const article = articleRef.current;
    if (host === null || article === null || reveal === null) return;
    const blocks = [...article.querySelectorAll<HTMLElement>('[data-source-line]')];
    const target = blocks[blockAtLine(blocks.map((b) => Number(b.dataset['sourceLine'])), reveal.line)];
    if (target !== undefined) {
      for (let fold = target.closest<HTMLElement>('.md-fold[data-folded]'); fold !== null; fold = fold.parentElement?.closest<HTMLElement>('.md-fold[data-folded]') ?? null) {
        if (fold.firstElementChild === target) continue;
        fold.removeAttribute('data-folded');
        viewState(path).folded?.delete(fold.getAttribute('data-key') ?? '');
      }
      const tr = target.getBoundingClientRect();
      const hr = host.getBoundingClientRect();
      host.scrollTop += tr.top - hr.top - Math.max(0, (host.clientHeight - tr.height) / 2);
      viewState(path).scrollTop = host.scrollTop;
      host.dataset['revealed'] = target.dataset['sourceLine'] ?? '';
      if (flashRef.current !== null) {
        clearTimeout(flashRef.current.timer);
        flashRef.current.el.classList.remove('md-line-flash');
      }
      target.classList.add('md-line-flash');
      flashRef.current = { el: target, timer: setTimeout(() => { target.classList.remove('md-line-flash'); flashRef.current = null; }, SOURCE_LINE_FLASH_MS) };
    }
    onRevealed?.(reveal.seq);
  }, [html, path, reveal?.seq]);
  useEffect(() => () => { if (flashRef.current !== null) clearTimeout(flashRef.current.timer); }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host !== null) host.focus();
  }, [path]);

  const onScroll = () => {
    const host = hostRef.current;
    if (host !== null) viewState(path).scrollTop = host.scrollTop;
  };

  // Links go out to the browser, never inside the window; the main
  // process turns away anything but http and https. A click on a folding
  // heading toggles its section in place; the html memo is not remade,
  // since the DOM already shows the fold and the next render from a
  // change on disk reads the set. A Ctrl+click opens one in a browser
  // pane beside the pane the file is in, or beside the focused pane from
  // a file tab (M9 fix 863).
  const openLink = (a: HTMLAnchorElement, beside: boolean) => {
    const href = a.getAttribute('href');
    if (href === null || !/^https?:/i.test(href)) return;
    if (beside && browserViewSupported(getState().daemon)) void openBeside({ kind: 'browser', url: href }, paneId ?? null).catch((err: unknown) => console.warn('[emerald] open link beside failed', err));
    else void window.emerald.files.openExternal(href).catch((err: unknown) => console.warn('[emerald] open link failed', err));
  };
  // A middle-click is an auxclick, not a click, and its default opens the
  // link in a new window (M9 fix 477); it goes to the browser the same way.
  const onAuxClick = (ev: MouseEvent<HTMLDivElement>) => {
    if (ev.button !== 1) return;
    const a = (ev.target as HTMLElement).closest('a');
    if (a === null) return;
    ev.preventDefault();
    openLink(a, false);
  };
  const onClick = (ev: MouseEvent<HTMLDivElement>) => {
    const target = ev.target as HTMLElement;
    const toggle = target.closest<HTMLElement>('.md-mermaid-toggle button');
    if (toggle !== null) {
      const box = toggle.closest<HTMLElement>('.md-mermaid');
      const side = toggle.getAttribute('data-side');
      if (box !== null && !box.hasAttribute('data-error') && (side === 'code' || side === 'diagram')) {
        showSide(box, side);
        viewState(path).sides.set(box.getAttribute('data-key') ?? '', side);
      }
      return;
    }
    const a = target.closest('a');
    if (a !== null) {
      ev.preventDefault();
      openLink(a, ev.ctrlKey);
      return;
    }
    const heading = target.closest('h2, h3');
    if (heading === null) return;
    const fold = heading.parentElement;
    if (fold === null || !fold.classList.contains('md-fold') || fold.firstElementChild !== heading) return;
    const key = fold.getAttribute('data-key') ?? '';
    const state = viewState(path);
    const folded = state.folded ?? new Set<string>();
    if (fold.hasAttribute('data-folded')) {
      fold.removeAttribute('data-folded');
      folded.delete(key);
    } else {
      fold.setAttribute('data-folded', '');
      folded.add(key);
    }
    state.folded = folded;
  };

  return (
    <div className="markdown-view" ref={hostRef} tabIndex={0} onScroll={onScroll} onClick={onClick} onAuxClick={onAuxClick}>
      <article className="markdown" ref={articleRef} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function render(text: string, folder: string, state: ViewState, foldOlder: boolean): string {
  const env = { folder, mermaid: { next: 0, sides: state.sides } };
  const tokens = md.parse(text, env);
  const sections = foldSections(tokens);
  if (state.folded === null) state.folded = defaultFolds(sections, foldOlder);
  return md.renderer.render(wrapSections(tokens, sections, state.folded), md.options, env);
}

// The wrapper tokens spliced in around each section: at one index the
// sections ending there close first, innermost first, then the ones
// opening there open, outermost first, so a ### closes before the ## that
// ends it does and a new ## opens before its first ###. The tokens are
// bare objects with only what the two rules below read.
function wrapSections(tokens: Token[], sections: FoldSection[], folded: Set<string>): Token[] {
  if (sections.length === 0) return tokens;
  const opens = new Map<number, Token[]>();
  const closes = new Map<number, Token[]>();
  const at = (map: Map<number, Token[]>, i: number) => {
    let list = map.get(i);
    if (list === undefined) {
      list = [];
      map.set(i, list);
    }
    return list;
  };
  for (const s of sections) {
    const attrs: [string, string][] = [
      ['class', 'md-fold'],
      ['data-level', String(s.level)],
      ['data-key', s.key],
    ];
    if (folded.has(s.key)) attrs.push(['data-folded', '']);
    at(opens, s.from).push({ type: 'fold_open', tag: 'section', nesting: 1, level: 0, block: true, attrs } as unknown as Token);
    at(closes, s.to).unshift({ type: 'fold_close', tag: 'section', nesting: -1, level: 0, block: true, attrs: null } as unknown as Token);
  }
  const out: Token[] = [];
  for (let i = 0; i <= tokens.length; i++) {
    for (const c of closes.get(i) ?? []) out.push(c);
    for (const o of opens.get(i) ?? []) out.push(o);
    if (i < tokens.length) out.push(tokens[i]!);
  }
  return out;
}

md.renderer.rules['fold_open'] = (tokens, idx, _options, _env, self) => `<section${self.renderAttrs(tokens[idx]!)}>\n`;
md.renderer.rules['fold_close'] = () => '</section>\n';
