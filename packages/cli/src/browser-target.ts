import { currentTab, listPanes, paneShowingIn } from '@emerald/shared';
import type { Layout, LayoutTab, PaneNode } from '@emerald/shared';
import { CliError } from './cli-error.ts';
import { shortId } from './resolve.ts';

// The browser pane emmer browser drives (M9 fix 672). --pane names one by
// its id, or by a prefix of 4 characters or more that only one pane
// across every tab starts with; without it the target is the one browser
// pane on the tab holding the caller's own pane, else on the tab in
// front. Every refusal is exit 1, in words that say how to get past it.
export function browserTarget(layout: Layout, own: string | undefined, paneArg: string | undefined): { tab: LayoutTab; pane: PaneNode } {
  if (paneArg !== undefined) {
    const all = layout.tabs.flatMap((tab) => listPanes(tab).map((pane) => ({ tab, pane })));
    let hits = all.filter((h) => h.pane.id === paneArg);
    if (hits.length === 0 && paneArg.length >= 4) hits = all.filter((h) => h.pane.id.startsWith(paneArg));
    if (hits.length === 0) throw new CliError(`no pane ${paneArg}`);
    if (hits.length > 1) throw new CliError(`${paneArg} matches ${hits.length} panes; give more of it`);
    const hit = hits[0]!;
    if (hit.pane.view?.kind !== 'browser') throw new CliError(`pane ${shortId(hit.pane.id)} is not a browser pane`);
    return hit;
  }
  const showing = own === undefined || own === '' ? null : paneShowingIn(layout, own);
  const tab = showing?.tab ?? currentTab(layout);
  const browsers = listPanes(tab).filter((p) => p.view?.kind === 'browser');
  if (browsers.length === 0) throw new CliError(`no browser pane on tab ${tab.name}; emmer browser open <url> makes one`);
  if (browsers.length > 1) {
    const ids = browsers.map((p) => shortId(p.id)).join(', ');
    throw new CliError(`${browsers.length} browser panes on tab ${tab.name} (${ids}); name one with --pane <id>`);
  }
  return { tab, pane: browsers[0]! };
}
