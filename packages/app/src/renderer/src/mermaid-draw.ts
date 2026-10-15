// The drawing half of the markdown view's mermaid boxes (M9 fix 658):
// the boxes come out of markdown-mermaid.ts's fence rule with a pending
// diagram div, and this fills each with mermaid's SVG or an error line.
// mermaid is imported here alone and only by import(), so Vite puts it in
// a chunk of its own and the window's first paint never loads it.
import type { MermaidSide, MermaidTheme } from './markdown-mermaid.ts';
import { diagramErrorLine, remember } from './markdown-mermaid.ts';
import { VIEW_CHANGE_EVENT } from './view-find-model.ts';

type Mermaid = typeof import('mermaid').default;
// What a draw needs of mermaid, so a test can hand in a fake.
export type MermaidLike = Pick<Mermaid, 'initialize' | 'render'>;
type Drawn = { svg: string } | { error: string };

let loading: Promise<Mermaid> | null = null;
let seq = 0;
// By `${theme}\n${source}`, at most MERMAID_CACHE_LIMIT entries
// (markdown-mermaid.ts).
const cache = new Map<string, Drawn>();
// What each diagram div shows now, so a pass over an unchanged page
// leaves it alone.
const shown = new WeakMap<HTMLElement, string>();

function load(): Promise<Mermaid> {
  if (loading === null) {
    loading = import('mermaid').then((m) => m.default);
    loading.catch(() => {
      // A later page tries again.
      loading = null;
    });
  }
  return loading;
}

// mermaid queues its renders but not initialize, so a second pass on
// another theme could initialize between the first pass's awaits and the
// first pass's later boxes would draw on the wrong theme (and be cached
// under the first pass's key). Every render goes through this chain with
// its own initialize in front of it, so none comes between a render and
// its own.
let chain: Promise<unknown> = Promise.resolve();
export function renderThemed(m: MermaidLike, theme: MermaidTheme, id: string, source: string): Promise<{ svg: string }> {
  const run = chain.then(() => {
    // Strict, so DOMPurify cleans the SVG and a label carries no script
    // or link; suppressErrorRendering, so a parse failure throws with
    // mermaid's temporary element gone and no error graphic drawn.
    m.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme });
    return m.render(id, source);
  });
  chain = run.catch(() => undefined);
  return run;
}

function changed(el: HTMLElement) {
  el.dispatchEvent(new Event(VIEW_CHANGE_EVENT, { bubbles: true }));
}

function write(div: HTMLElement, key: string, drawn: Drawn, theme: MermaidTheme) {
  const box = div.closest<HTMLElement>('.md-mermaid');
  if (box === null) return;
  shown.set(div, key);
  if ('svg' in drawn) {
    div.innerHTML = drawn.svg;
    div.setAttribute('data-state', 'drawn');
    div.setAttribute('data-theme', theme);
  } else {
    // The code shows with the line under it, and the toggle goes; the
    // remembered side is left alone for when the fence is fixed.
    box.setAttribute('data-error', '');
    box.querySelector('.md-mermaid-code')?.removeAttribute('hidden');
    box.querySelector('.md-mermaid-toggle')?.setAttribute('hidden', '');
    div.removeAttribute('hidden');
    div.setAttribute('data-state', 'error');
    const line = document.createElement('div');
    line.className = 'md-mermaid-error';
    line.textContent = drawn.error;
    div.replaceChildren(line);
  }
  changed(div);
}

// Draws every box in the article, one at a time in document order, from
// the cache where it can. live() goes false when the view has re-rendered
// or gone, and a draw that finishes after that is dropped.
export async function drawMermaid(article: HTMLElement, theme: MermaidTheme, live: () => boolean, loadMermaid: () => Promise<MermaidLike> = load): Promise<void> {
  const divs = [...article.querySelectorAll<HTMLElement>('.md-mermaid-diagram')];
  if (divs.length === 0) return;
  let mermaid: MermaidLike | null = null;
  for (const div of divs) {
    const source = div.parentElement?.querySelector('.md-mermaid-code code')?.textContent ?? '';
    const key = `${theme}\n${source}`;
    if (shown.get(div) === key) continue;
    const hit = cache.get(key);
    if (hit !== undefined) {
      write(div, key, hit, theme);
      continue;
    }
    if (mermaid === null) {
      try {
        mermaid = await loadMermaid();
      } catch (err) {
        console.warn('[emerald] mermaid failed to load', err);
        if (!live()) return;
        for (const d of divs) {
          if (d.isConnected && d.getAttribute('data-state') === 'pending') write(d, `failed\n${theme}`, { error: 'Diagram error: the diagram library could not be loaded' }, theme);
        }
        return;
      }
      if (!live()) return;
    }
    let drawn: Drawn;
    try {
      const { svg } = await renderThemed(mermaid, theme, `emerald-mermaid-${++seq}`, source);
      drawn = { svg };
    } catch (err) {
      drawn = { error: diagramErrorLine(err) };
    }
    remember(cache, key, drawn);
    // A pass whose view re-rendered stops; a box that left the page alone
    // is skipped.
    if (!live()) return;
    if (!div.isConnected) continue;
    write(div, key, drawn, theme);
  }
}

// Shows one side of a box, from a click on its toggle.
export function showSide(box: HTMLElement, side: MermaidSide): void {
  box.setAttribute('data-side', side);
  for (const b of box.querySelectorAll<HTMLElement>('.md-mermaid-toggle button')) {
    if (b.getAttribute('data-side') === side) b.setAttribute('data-active', '');
    else b.removeAttribute('data-active');
  }
  box.querySelector('.md-mermaid-code')?.toggleAttribute('hidden', side !== 'code');
  box.querySelector('.md-mermaid-diagram')?.toggleAttribute('hidden', side !== 'diagram');
  changed(box);
}
